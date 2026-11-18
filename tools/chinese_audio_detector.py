"""Local Spotify-only audio language detection. No audio or transcript is saved.

Each request captures one 30 s window, asks Qwen3-ASR for a free transcript and its language
log-odds, then aligns that transcript to the supplied lyric text and scores the aligned span with
ZIPA-small under pinyin and jyutping readings. The reading fit is returned as `phoneFit`; a positive
value means jyutping explains the vocals better. The transcript and audio never leave the process.
"""
import argparse
import json
import math
import os
from pathlib import Path
import re
import select
import signal
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REVISION = "qwen-zipa-phonefit-v1"
MODEL_REVISION = "7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c"
ORIGINS = {"https://xpui.app.spotify.com", "https://open.spotify.com"}
TRACK = re.compile(r"spotify:track:[A-Za-z0-9]{22}\Z")
HAN = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
RATE = 16000
SECONDS = 30
BODY_LIMIT = 128 * 1024
MAX_LINES = 400
MIN_SPAN_CHARS = 8
SPAN_PAD = 3
DEFAULT_ZIPA = "/mnt/data/scratch/spicy-rhyme-limits/zipa"


def command(args):
    return subprocess.check_output(args, text=True, timeout=3)


def playback():
    # MPRIS describes local playback; remote Connect playback has no matching output stream.
    state = command(["gdbus", "call", "--session", "--dest", "org.mpris.MediaPlayer2.spotify",
                     "--object-path", "/org/mpris/MediaPlayer2", "--method",
                     "org.freedesktop.DBus.Properties.GetAll", "org.mpris.MediaPlayer2.Player"])
    track = re.search(r"/com/spotify/track/([A-Za-z0-9]{22})", state)
    position = re.search(r"'Position': <(?:int64 |uint64 )?(\d+)>", state)
    return ("spotify:track:" + track[1] if track else "", "'PlaybackStatus': <'Playing'>" in state,
            int(position[1]) / 1_000_000 if position else None)


def spotify_stream():
    streams = json.loads(command(["pactl", "-f", "json", "list", "sink-inputs"]))
    matches = [s for s in streams if s.get("properties", {}).get("application.name", "").lower() == "spotify"
               and not s.get("corked")]
    if len(matches) != 1:
        raise RuntimeError("One active local Spotify stream is required")
    stream = matches[0]
    sinks = json.loads(command(["pactl", "-f", "json", "list", "sinks"]))
    sink = next(s for s in sinks if s["index"] == stream["sink"])
    monitor = sink.get("monitor_source_name") or sink.get("monitor_source")
    if not isinstance(monitor, str) or not monitor:
        raise RuntimeError("Spotify output monitor is unavailable")
    return stream["index"], monitor


def disconnected(connection):
    if not select.select([connection], [], [], 0)[0]:
        return False
    return connection.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT) == b""


def capture(uri, connection, stopping=None):
    current, playing, position = playback()
    if current != uri or not playing or position is None:
        raise RuntimeError("Requested track is not playing locally")
    stream, monitor = spotify_stream()
    recorder = subprocess.Popen(["parec", "--device=" + monitor, "--monitor-stream=" + str(stream),
                                 "--rate=16000", "--channels=1", "--format=s16le", "--raw"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    chunks = []
    error = []

    def read():
        try:
            chunks.append(recorder.stdout.read(RATE * SECONDS * 2))
        except OSError as exc:
            error.append(exc)

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    started = time.monotonic()
    try:
        while reader.is_alive():
            reader.join(0.5)
            elapsed = time.monotonic() - started
            current, playing, now_position = playback()
            if ((stopping is not None and stopping.is_set()) or disconnected(connection)
                    or current != uri or not playing or now_position is None
                    or abs(now_position - position - elapsed) > 2 or elapsed > SECONDS + 5
                    or spotify_stream() != (stream, monitor)):
                raise RuntimeError("Playback changed during audio capture")
        if error or not chunks or len(chunks[0]) != RATE * SECONDS * 2:
            raise RuntimeError("Incomplete audio window")
        return chunks[0]
    finally:
        recorder.terminate()
        try:
            recorder.wait(timeout=2)
        except subprocess.TimeoutExpired:
            recorder.kill()
            recorder.wait()
        reader.join(2)
        recorder.stdout.close()


def parse_lines(value):
    """Validate the client's per-line readings and return them with aligned syllable arrays."""
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_LINES:
        raise ValueError("Invalid lyric lines")
    lines = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("Invalid lyric line")
        han, py, jp = item.get("han"), item.get("py"), item.get("jp")
        if not isinstance(han, str) or not isinstance(py, list) or not isinstance(jp, list):
            raise ValueError("Invalid lyric line")
        if len(py) != len(han) or len(jp) != len(han):
            raise ValueError("Readings must cover every Han character")
        if any(not isinstance(reading, str) for reading in py) or any(not isinstance(reading, str) for reading in jp):
            raise ValueError("Invalid reading")
        lines.append({"han": han, "py": py, "jp": jp})
    return lines


def align(query, ref):
    """Smith-Waterman on characters; returns the best-matching [start, end) in ref."""
    q, r = query, ref
    rows = [[0] * (len(r) + 1) for _ in range(len(q) + 1)]
    best = (0, 0, 0)
    for i in range(1, len(q) + 1):
        qi = q[i - 1]
        for j in range(1, len(r) + 1):
            h = max(0, rows[i - 1][j - 1] + (2 if qi == r[j - 1] else -1),
                    rows[i - 1][j] - 1, rows[i][j - 1] - 1)
            rows[i][j] = h
            if h > best[0]:
                best = (h, i, j)
    score, i, j = best
    end = j
    while i > 0 and j > 0 and rows[i][j] > 0:
        if rows[i][j] == rows[i - 1][j - 1] + (2 if q[i - 1] == r[j - 1] else -1):
            i, j = i - 1, j - 1
        elif rows[i][j] == rows[i - 1][j] - 1:
            i -= 1
        else:
            j -= 1
    return j, end, score


class ToneConverter:
    def __init__(self):
        import opencc
        self.t2s = opencc.OpenCC("t2s")

    def text(self, value):
        return self.t2s.convert(value)

    def preserving_length(self, value):
        converted = self.t2s.convert(value)
        if len(converted) == len(value):
            return converted
        return "".join(self.t2s.convert(character) for character in value)


class ZipaScorer:
    """ZIPA CTC reading fit; model files and htdemucs are loaded on first use."""
    def __init__(self, model_dir, device):
        self.model_dir = Path(model_dir)
        self.device = device
        self.session = None
        self.fbank = None
        self.vocab = None
        self.demucs = None

    def load(self):
        if self.session is not None:
            return
        import numpy as np
        import onnxruntime as ort
        from lhotse.features.kaldi.extractors import Fbank, FbankConfig
        model_path = self.model_dir / "model.onnx"
        tokens_path = self.model_dir / "tokens.txt"
        if not model_path.is_file() or not tokens_path.is_file():
            raise RuntimeError("ZIPA model files are missing")
        self.vocab = {line.split()[0]: int(line.split()[1])
                      for line in tokens_path.read_text(encoding="utf-8").splitlines() if line.split()}
        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.fbank = Fbank(FbankConfig(num_filters=80, dither=0.0, snip_edges=False))
        self._np = np

    def load_demucs(self):
        if self.demucs is not None:
            return
        from demucs.pretrained import get_model
        self.demucs = get_model("htdemucs").to(self.device).eval()

    def vocals(self, audio):
        import librosa
        import torch
        from demucs.apply import apply_model
        self.load_demucs()
        sample_rate = self.demucs.samplerate
        waveform = torch.tensor(librosa.resample(audio, orig_sr=RATE, target_sr=sample_rate), dtype=torch.float32)
        waveform = torch.stack([waveform, waveform])[None].to(self.device)
        with torch.no_grad():
            sources = apply_model(self.demucs, waveform, device=self.device, split=True, overlap=0.1)[0]
        vocal = sources[self.demucs.sources.index("vocals")].mean(0).cpu().numpy()
        return librosa.resample(vocal, orig_sr=sample_rate, target_sr=RATE)

    def logprobs(self, audio):
        import torch
        features = self.fbank.extract_batch([torch.tensor(audio, dtype=torch.float32)],
                                            sampling_rate=RATE)[0][None]
        output = self.session.run(None, {
            "x": features.numpy(),
            "x_lens": self._np.array([features.shape[1]], self._np.int64),
        })[0][0]
        return torch.log_softmax(torch.tensor(output), -1)

    def nll(self, logprobs, tokens):
        import torch
        if not tokens or len(tokens) > logprobs.shape[0]:
            return None
        return float(torch.nn.functional.ctc_loss(
            logprobs[:, None], torch.tensor([tokens]), torch.tensor([logprobs.shape[0]]),
            torch.tensor([len(tokens)]), blank=0, reduction="sum", zero_infinity=True))

    def fit(self, audio, py, jp):
        """Return (phoneFit, spanChars). A positive fit means jyutping fits the vocals better."""
        import torch
        from ipa import pinyin_ipa, jyutping_ipa, to_tokens
        self.load()
        logprobs = self.logprobs(self.vocals(audio))
        py_tokens = to_tokens("".join(pinyin_ipa(syllable) for syllable in py), self.vocab)
        jp_tokens = to_tokens("".join(jyutping_ipa(syllable) for syllable in jp), self.vocab)
        nll_py = self.nll(logprobs, py_tokens)
        nll_jp = self.nll(logprobs, jp_tokens)
        if nll_py is None or nll_jp is None or logprobs.shape[0] == 0:
            return None
        return (nll_py - nll_jp) / logprobs.shape[0]


class QwenLanguageModel:
    def __init__(self, model_path, device, zipa_path):
        self.model_path = model_path
        self.device = device
        self.model = None
        self.zipa = ZipaScorer(zipa_path, device)
        self.converter = ToneConverter()
        self.alignment_cache = {}

    def load(self):
        if self.model is not None:
            return
        import torch
        from transformers import AutoModelForMultimodalLM, AutoProcessor
        self.processor = AutoProcessor.from_pretrained(self.model_path, local_files_only=True)
        self.model = AutoModelForMultimodalLM.from_pretrained(
            self.model_path, device_map=self.device,
            dtype=torch.bfloat16 if self.device.startswith("cuda") else torch.float32,
            local_files_only=True).eval()

    def score(self, pcm, lines):
        import numpy as np
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        # Reject digital silence before model inference. Instrumentals with no language token stay unknown.
        if float(np.sqrt(np.mean(audio ** 2))) < 0.0001:
            return {"logOdds": None, "phoneFit": None, "spanChars": 0}
        self.load()
        return self.score_samples(audio, lines)

    def language_log_odds(self, tokens, scores):
        import torch
        tokenizer = self.processor.tokenizer
        canto = [tokenizer.encode(s, add_special_tokens=False)[0] for s in (" Cantonese", "Cantonese")]
        mando = [tokenizer.encode(s, add_special_tokens=False)[0] for s in (" Chinese", "Chinese")]
        for token, score in zip(tokens, scores):
            if int(token) in canto + mando or tokenizer.decode([int(token)]).strip().lower().startswith(("canton", "chin")):
                probabilities = torch.log_softmax(score[0].float(), -1)
                result = max(probabilities[i].item() for i in canto) - max(probabilities[i].item() for i in mando)
                return result if math.isfinite(result) else None
        return None

    def aligned_span(self, transcript, han):
        query = self.converter.text("".join(HAN.findall(transcript)))
        if not query or not han:
            return None
        reference = self.converter.preserving_length(han)
        start, end, _score = align(query, reference)
        start, end = max(0, start - SPAN_PAD), min(len(han), end + SPAN_PAD)
        return (start, end) if end > start else None

    def score_samples(self, audio, lines):
        import torch
        processor, model = self.processor, self.model
        # One free decode provides both the language token probabilities and the transcript used
        # to locate the sung passage in the known lyrics.
        inputs = processor.apply_transcription_request(audio=audio).to(model.device, model.dtype)
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=160, do_sample=False,
                                       output_scores=True, return_dict_in_generate=True)
        tokens = generated.sequences[0, inputs["input_ids"].shape[1]:]
        log_odds = self.language_log_odds(tokens, generated.scores)
        raw = processor.tokenizer.decode(tokens, skip_special_tokens=True)
        transcript = raw.split("<asr_text>")[-1]

        han = "".join(line["han"] for line in lines)
        py = [reading for line in lines for reading in line["py"]]
        jp = [reading for line in lines for reading in line["jp"]]
        span = self.aligned_span(transcript, han)
        if span is None:
            return {"logOdds": log_odds, "phoneFit": None, "spanChars": 0}
        start, end = span
        span_chars = end - start
        if span_chars < MIN_SPAN_CHARS:
            return {"logOdds": log_odds, "phoneFit": None, "spanChars": span_chars}
        try:
            phone_fit = self.zipa.fit(audio, py[start:end], jp[start:end])
        except (RuntimeError, ValueError, ImportError, OSError, MemoryError) as exc:
            print(f"Phone fit unavailable: {type(exc).__name__}", flush=True)
            phone_fit = None
        return {"logOdds": log_odds, "phoneFit": phone_fit, "spanChars": span_chars}


class DetectorServer(ThreadingHTTPServer):
    daemon_threads = False
    allow_reuse_address = True

    def __init__(self, address, model):
        super().__init__(address, Handler)
        self.model = model
        self.capture_lock = threading.Lock()
        self.stopping = threading.Event()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def allowed(self):
        return (self.headers.get("Origin") in ORIGINS | {None}
                and self.headers.get("Host") == "127.0.0.1:" + str(self.server.server_port))

    def reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        if self.headers.get("Origin") in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.allowed() or self.path != "/window":
            self.reply(403, {"error": "Forbidden"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "https://xpui.app.spotify.com"))
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        if not self.allowed() or self.path != "/health":
            self.reply(403, {"error": "Forbidden"})
            return
        self.reply(200, {"revision": REVISION, "ready": True,
                         "modelLoaded": self.server.model.model is not None if self.server.model else False})

    def do_POST(self):
        if not self.allowed() or self.path != "/window":
            self.reply(403, {"error": "Forbidden"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= BODY_LIMIT or self.headers.get("Content-Type") != "application/json":
                raise ValueError("Invalid request body")
            self.connection.settimeout(5)
            body = json.loads(self.rfile.read(length))
            uri = body.get("uri", "")
            if not isinstance(uri, str) or not TRACK.fullmatch(uri) or body.get("revision") != REVISION:
                raise ValueError("Invalid track or detector revision")
            lines = parse_lines(body.get("lines"))
        except (ValueError, AttributeError, OSError):
            self.reply(400, {"error": "Invalid request"})
            return
        if not self.server.capture_lock.acquire(blocking=False):
            self.reply(409, {"error": "Audio capture is busy"})
            return
        try:
            pcm = capture(uri, self.connection, self.server.stopping)
            result = self.server.model.score(pcm, lines)
            self.reply(200, {"uri": uri, "revision": REVISION, **result})
        except (RuntimeError, ValueError, ImportError, OSError, subprocess.SubprocessError, StopIteration) as exc:
            print(f"Audio detection unavailable: {type(exc).__name__}: {exc}", flush=True)
            try:
                self.reply(503, {"error": "Local Spotify audio is unavailable"})
            except OSError:
                pass
        finally:
            self.server.capture_lock.release()


def load_cli_lyrics(value):
    if value.lstrip().startswith(("[", "{")):
        data = json.loads(value)
    else:
        data = json.loads(Path(value).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return data.get("uri", ""), parse_lines(data.get("lines"))
    return "", parse_lines(data)


def run_cli(model, args):
    import numpy as np
    import soundfile as sf
    audio, sample_rate = sf.read(args.score_wav, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(1)
    if sample_rate != RATE:
        import librosa
        audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=RATE)
    uri, lines = load_cli_lyrics(args.lyrics)
    model.load()
    result = model.score_samples(audio.astype(np.float32), lines)
    print(json.dumps({"uri": uri, "revision": REVISION, **result}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=os.environ.get("SPICY_AUDIO_MODEL"),
                        help="Local Qwen3-ASR-0.6B-hf snapshot at revision " + MODEL_REVISION)
    parser.add_argument("--zipa", default=os.environ.get("SPICY_ZIPA", DEFAULT_ZIPA),
                        help="Directory with the ZIPA-small ONNX model and tokens.txt")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--port", type=int, default=18767)
    parser.add_argument("--score-wav", help="Score one WAV file and print the reply JSON")
    parser.add_argument("--lyrics", help="Lyric lines JSON, or a path to a JSON file")
    args = parser.parse_args()
    if not args.model or Path(args.model).resolve().name != MODEL_REVISION:
        parser.error("--model must point to the pinned Hugging Face snapshot directory")
    if not Path(args.zipa, "model.onnx").is_file():
        parser.error("--zipa must point to the ZIPA model directory")
    model = QwenLanguageModel(args.model, args.device, args.zipa)
    if args.score_wav:
        if not args.lyrics:
            parser.error("--score-wav requires --lyrics")
        run_cli(model, args)
        return
    server = DetectorServer(("127.0.0.1", args.port), model)

    def stop(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    print(f"Chinese audio detector listening on 127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.stopping.set()
        server.server_close()


if __name__ == "__main__":
    main()
