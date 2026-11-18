import importlib.util
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("detector", ROOT / "tools/chinese_audio_detector.py")
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)

ipa_spec = importlib.util.spec_from_file_location("ipa", ROOT / "tools/ipa.py")
ipa = importlib.util.module_from_spec(ipa_spec)
ipa_spec.loader.exec_module(ipa)

LINES = [{"han": "你好香港", "py": ["ni", "hao", "xiang", "gang"], "jp": ["nei", "hou", "hoeng", "gong"]}]


class HelperTests(unittest.TestCase):
    def test_capture_rejects_other_track_and_paused_playback(self):
        for state in (("other", True, 10), ("track", False, 10)):
            with patch.object(detector, "playback", return_value=state), patch.object(detector.subprocess, "Popen") as popen:
                with self.assertRaises(RuntimeError):
                    detector.capture("track", None)
                popen.assert_not_called()

    def test_only_spotify_output_is_selected(self):
        streams = [dict(index=1, sink=4, corked=False, properties={"application.name": "Other app"}),
                   dict(index=2, sink=4, corked=False, properties={"application.name": "Spotify"})]
        for field in ("monitor_source_name", "monitor_source"):
            sinks = [dict(index=4, **{field: "output.monitor"})]
            with patch.object(detector, "command", side_effect=[json.dumps(streams), json.dumps(sinks)]):
                self.assertEqual(detector.spotify_stream(), (2, "output.monitor"))
        with patch.object(detector, "command", side_effect=[json.dumps(streams), json.dumps([dict(index=4)])]):
            with self.assertRaises(RuntimeError):
                detector.spotify_stream()
        with patch.object(detector, "command", return_value=json.dumps(streams[:1])):
            with self.assertRaises(RuntimeError):
                detector.spotify_stream()

    def test_ipa_maps_cover_the_measured_readings(self):
        for pinyin, expected in (("wen", "wən"), ("you", "jou"), ("wei", "wei")):
            self.assertEqual(ipa.pinyin_ipa(pinyin), expected)
        for jyutping, expected in (("nei", "nei"), ("hou", "hou"), ("gong", "kɔŋ")):
            self.assertEqual(ipa.jyutping_ipa(jyutping), expected)

    def test_alignment_finds_the_sung_lyric_span(self):
        query = "我爱这少年"
        reference = "念自由我爱这少年讽刺吗这花开吗我爱"
        start, end, _score = detector.align(query, reference)
        self.assertEqual((start, end), (3, 8))

    def test_request_lines_validate_length_and_bounds(self):
        self.assertEqual(detector.parse_lines(LINES), LINES)
        self.assertEqual(detector.parse_lines(None), [])
        for bad in ([{"han": "你好", "py": ["ni"], "jp": ["nei", "hou"]}],
                    [{"han": "", "py": [], "jp": []}] * (detector.MAX_LINES + 1),
                    [{"han": "你好", "py": "ni", "jp": ["nei", "hou"]}]):
            with self.assertRaises(ValueError):
                detector.parse_lines(bad)

    def test_http_boundary_and_no_audio_for_rejected_requests(self):
        server = detector.DetectorServer(("127.0.0.1", 0), None)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        url = f"http://127.0.0.1:{server.server_port}"
        uri = "spotify:track:" + "a" * 22
        body = json.dumps({"uri": uri, "revision": detector.REVISION, "lines": LINES}).encode()
        try:
            with urllib.request.urlopen(url + "/health") as response:
                self.assertEqual(json.load(response)["revision"], detector.REVISION)
            with patch.object(detector, "capture") as capture:
                too_many = json.dumps({"uri": uri, "revision": detector.REVISION, "lines": [LINES[0]] * (detector.MAX_LINES + 1)}).encode()
                for origin, data, expected in (
                    ("https://example.com", body, 403),
                    ("https://xpui.app.spotify.com", b"{}", 400),
                    ("https://xpui.app.spotify.com", too_many, 400),
                    ("https://xpui.app.spotify.com", b"x" * (detector.BODY_LIMIT + 1), 400),
                ):
                    request = urllib.request.Request(url + "/window", data, {"Origin": origin, "Content-Type": "application/json"})
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(request)
                    self.assertEqual(error.exception.code, expected)
                capture.assert_not_called()
            server.model = type("FakeModel", (), {
                "score": lambda _self, _pcm, _lines: {"logOdds": -6.0, "phoneFit": 0.041, "spanChars": 12},
            })()
            with patch.object(detector, "capture", return_value=b"pcm") as capture:
                request = urllib.request.Request(url + "/window", body,
                                                 {"Origin": "https://xpui.app.spotify.com", "Content-Type": "application/json"})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://xpui.app.spotify.com")
                    self.assertEqual(json.load(response), {
                        "uri": uri, "revision": detector.REVISION,
                        "logOdds": -6.0, "phoneFit": 0.041, "spanChars": 12,
                    })
                capture.assert_called_once()
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == "__main__":
    unittest.main()
