#!/usr/bin/env python3
"""Build the portable Mandarin g2pM asset pack from pinned sources.

Usage:
  python tools/export-mandarin-g2pm.py --cache <download-cache> --out <asset-directory>

The cache is populated only from the exact URLs below and each download is checked against its
pinned SHA-256. The generated pack is private, ignored evaluation data; it is not committed.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

G2PM_COMMIT = "170526efad0a3ef9b55a9ad4579f73218f9be06c"
G2PM_SOURCE_URL = f"https://codeload.github.com/kakaobrain/g2pM/tar.gz/{G2PM_COMMIT}"
G2PM_SOURCE_SHA256 = "709514bb0019998c2978bac24531bde1eeae14cb0bc07b9c14641dbea177921f"
G2PM_WHEEL_URL = "https://files.pythonhosted.org/packages/af/21/dc5b497f09a94a9605e0b8a94ad0e01ae73a2b65109bf5bd325b0814b6a8/g2pM-0.1.2.5-py3-none-any.whl"
G2PM_WHEEL_SHA256 = "9e920b82df4002f96d8679720c7a858d10816d438dbd61b8b6b621a80a976361"

PHRASE_TAG = "v0.20.0"
PHRASE_COMMIT = "6bc96ab093edb5b5c7c1e673e339e7c5f9621558"
PHRASE_URL = f"https://codeload.github.com/mozillazg/phrase-pinyin-data/tar.gz/{PHRASE_COMMIT}"
PHRASE_SHA256 = "f0759e38fa238f1bfecc64ee50dbad8f96777c57b0981e90c6a2d2021d864dd6"
PHRASE_FILE_SHA256 = "7fe2c1f72634b07239ea5f40096f1803b56bd330c6508aa4512259bc4bf1b9cc"

PINYIN_TAG = "v0.16.0"
PINYIN_COMMIT = "fe29ad32bdf352b31a02b9936e537f575432e9a6"
PINYIN_URL = f"https://codeload.github.com/mozillazg/pinyin-data/tar.gz/{PINYIN_COMMIT}"
PINYIN_SHA256 = "96ee3e53630248db03d02711e446426f3965f54fa4e0f179e222bf6f5761b0c2"
K_MANDARIN_8105_SHA256 = "3538219db8ef4809e8de51c82655aedabacbc54f92acbe6a0e6925156f845f76"
PINYIN_FILE_SHA256 = "2342a6f98c85dbc3c8d26aef31744876a36326c6466e51e9a0f16898c36c2011"

OPENCC_VERSION = "1.4.2"
OPENCC_URL = f"https://registry.npmjs.org/opencc-js/-/opencc-js-{OPENCC_VERSION}.tgz"
OPENCC_TGZ_SHA256 = "acde2ed46fecc53eb1c329ff093886bf702975be24ace4caa3d01321167d69c8"
OPENCC_FILE_SHA256 = "85aee197470c6fa5fce207b4d1fe17b178eb8075b622133cd0eaa3c7d75fe16c"

TENSORS = [
    ("embedding.weight", (5398, 64)),
    ("lstm.weight_ih_l0", (128, 64)),
    ("lstm.weight_hh_l0", (128, 32)),
    ("lstm.bias_ih_l0", (128,)),
    ("lstm.bias_hh_l0", (128,)),
    ("lstm.weight_ih_l0_reverse", (128, 64)),
    ("lstm.weight_hh_l0_reverse", (128, 32)),
    ("lstm.bias_ih_l0_reverse", (128,)),
    ("lstm.bias_hh_l0_reverse", (128,)),
    ("logit_layer.0.weight", (32, 64)),
    ("logit_layer.0.bias", (32,)),
    ("logit_layer.2.weight", (876, 32)),
    ("logit_layer.2.bias", (876,)),
]

MARK_TO_TONE = {"\u0304": 1, "\u0301": 2, "\u030c": 3, "\u0300": 4}
NUMBERED = re.compile(r"^[a-züê]+[1-5]$")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(cache: Path, name: str, url: str, expected: str) -> Path:
    path = cache / name
    if path.exists():
        actual = sha256(path.read_bytes())
        if actual != expected:
            raise SystemExit(f"{path} has SHA-256 {actual}, expected {expected}")
        return path
    print(f"fetch {url}", file=sys.stderr)
    request = urllib.request.Request(url, headers={"User-Agent": "cjk-labs-mandarin-g2pm-export"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    actual = sha256(data)
    if actual != expected:
        raise SystemExit(f"{url} returned SHA-256 {actual}, expected {expected}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def numbered_from_marked(marked: str) -> str | None:
    tone = 5
    letters: list[str] = []
    for char in unicodedata.normalize("NFD", marked.strip().lower()):
        if char in MARK_TO_TONE:
            tone = MARK_TO_TONE[char]
        else:
            letters.append(char)
    base = unicodedata.normalize("NFC", "".join(letters)).replace("u:", "ü").replace("v", "ü")
    value = f"{base}{tone}"
    return value if NUMBERED.fullmatch(value) else None


def canonical_numbered(raw: str) -> str | None:
    value = raw.strip().lower().replace("u:", "ü").replace("v", "ü")
    return value if NUMBERED.fullmatch(value) else None


def is_han(text: str) -> bool:
    return bool(text) and all(
        "\u3400" <= char <= "\u4dbf"
        or "\u4e00" <= char <= "\u9fff"
        or "\uf900" <= char <= "\ufaff"
        or "\U00020000" <= char <= "\U0003134f"
        for char in text
    )


def parse_pinyin_file(data: bytes) -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}
    for line in data.decode("utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        match = re.fullmatch(r"U\+([0-9A-Fa-f]+):\s*(.*)", line)
        if not match:
            continue
        char = chr(int(match.group(1), 16))
        readings: list[str] = []
        for raw in match.group(2).split(","):
            value = numbered_from_marked(raw)
            if value and value not in readings:
                readings.append(value)
        if readings:
            rows[char] = readings
    return rows


def parse_phrases(data: bytes) -> dict[str, list[list[str]]]:
    phrases: dict[str, list[list[str]]] = {}
    for line in data.decode("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ": " not in line:
            continue
        key, value = line.split(": ", 1)
        value = value.split("#", 1)[0].strip()
        if not is_han(key):
            continue
        parts = value.split()
        if len(parts) != len(key):
            continue
        readings = [numbered_from_marked(part) for part in parts]
        if any(reading is None for reading in readings):
            continue
        canonical = tuple(readings)  # type: ignore[arg-type]
        bucket = phrases.setdefault(key, [])
        if list(canonical) not in bucket:
            bucket.append(list(canonical))
    return phrases


def parse_opencc(data: bytes) -> dict[str, str]:
    match = re.search(rb'"([^"]*)"', data, re.S)
    if not match:
        raise SystemExit("OpenCC TSCharacters.js has no dictionary body")
    pairs: dict[str, str] = {}
    for pair in match.group(1).decode("utf-8").split("|"):
        fields = pair.split(" ")
        if len(fields) != 2:
            continue
        source, target = fields
        if len(source) == 1 and len(target) == 1 and source != target:
            pairs[source] = target
    return pairs


def read_tar_member(path: Path, suffix: str) -> bytes:
    with tarfile.open(path, "r:gz") as archive:
        for member in archive.getmembers():
            if member.isfile() and member.name.endswith(suffix):
                extracted = archive.extractfile(member)
                if extracted is None:
                    break
                return extracted.read()
    raise SystemExit(f"{path} has no member ending in {suffix}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    cache = args.cache
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    g2pm_wheel = fetch(cache, "g2pM-0.1.2.5-py3-none-any.whl", G2PM_WHEEL_URL, G2PM_WHEEL_SHA256)
    g2pm_source = fetch(cache, f"g2pM-{G2PM_COMMIT}.tar.gz", G2PM_SOURCE_URL, G2PM_SOURCE_SHA256)
    phrase_archive = fetch(cache, f"phrase-pinyin-data-{PHRASE_COMMIT}.tar.gz", PHRASE_URL, PHRASE_SHA256)
    pinyin_archive = fetch(cache, f"pinyin-data-{PINYIN_COMMIT}.tar.gz", PINYIN_URL, PINYIN_SHA256)
    opencc_archive = fetch(cache, f"opencc-js-{OPENCC_VERSION}.tgz", OPENCC_URL, OPENCC_TGZ_SHA256)

    with zipfile.ZipFile(g2pm_wheel) as wheel:
        np_ckpt = wheel.read("g2pM/np_ckpt.pkl")
        char2idx_bytes = wheel.read("g2pM/char2idx.pkl")
        class2idx_bytes = wheel.read("g2pM/class2idx.pkl")
        digest_bytes = wheel.read("g2pM/digest_cedict.pkl")
        license_g2pm = wheel.read("g2pM-0.1.2.5.dist-info/LICENSE")
        g2pm_py = wheel.read("g2pM/g2pM.py")
    if sha256(np_ckpt) != "5b38c21cbaeb5f9b2f5d0bf872487de0fc22f91a3b26189b7d998136d2c8d3ae":
        raise SystemExit("np_ckpt.pkl differs from the pinned receipt")
    if sha256(g2pm_py) != "4a19f9d8cd95d806e13c432e8b573355455c35845dd8fc16ec4fa86a26ca1de4":
        raise SystemExit("g2pM.py differs from the pinned receipt")

    import pickle

    state = pickle.loads(np_ckpt)
    char2idx = pickle.loads(char2idx_bytes)
    class2idx = pickle.loads(class2idx_bytes)
    digest_cedict = pickle.loads(digest_bytes)

    classes = [None] * len(class2idx)
    for label, index in class2idx.items():
        classes[index] = label
    if any(label is None for label in classes):
        raise SystemExit("class2idx is not dense")

    vocab_tokens = [None] * len(char2idx)
    for token, index in char2idx.items():
        vocab_tokens[index] = token
    if any(token is None for token in vocab_tokens):
        raise SystemExit("char2idx is not dense")

    k_mandarin_bytes = read_tar_member(pinyin_archive, "/kMandarin_8105.txt")
    pinyin_bytes = read_tar_member(pinyin_archive, "/pinyin.txt")
    if sha256(k_mandarin_bytes) != K_MANDARIN_8105_SHA256 or sha256(pinyin_bytes) != PINYIN_FILE_SHA256:
        raise SystemExit("pinyin-data file differs from the pinned receipt")
    k_mandarin = parse_pinyin_file(k_mandarin_bytes)
    pinyin = parse_pinyin_file(pinyin_bytes)

    characters: dict[str, tuple[str, list[str], str]] = {}
    for char in set(k_mandarin) | set(pinyin):
        candidates = list(pinyin.get(char, []))
        for reading in k_mandarin.get(char, []):
            if reading not in candidates:
                candidates.append(reading)
        if not candidates:
            continue
        default = (k_mandarin.get(char) or candidates)[0]
        source = "8105" if char in k_mandarin else "pinyin"
        characters[char] = (default, candidates, source)

    phrase_bytes = read_tar_member(phrase_archive, "/large_pinyin.txt")
    if sha256(phrase_bytes) != PHRASE_FILE_SHA256:
        raise SystemExit("large_pinyin.txt differs from the pinned receipt")
    phrases = parse_phrases(phrase_bytes)

    opencc_js = read_tar_member(opencc_archive, "/dist/esm-lib/dict/TSCharacters.js")
    if sha256(opencc_js) != OPENCC_FILE_SHA256:
        raise SystemExit("OpenCC TSCharacters.js differs from the pinned receipt")
    t2s = parse_opencc(opencc_js)

    digest: dict[str, list[str]] = {}
    for char, readings in digest_cedict.items():
        if len(char) != 1 or not is_han(char):
            continue
        canonical: list[str] = []
        for raw in readings:
            value = canonical_numbered(raw)
            if value and value not in canonical:
                canonical.append(value)
        if canonical:
            digest[char] = canonical

    # Model tensors, in a fixed order and little-endian float32.
    model = bytearray()
    tensor_specs = []
    for name, shape in TENSORS:
        if name not in state:
            raise SystemExit(f"checkpoint has no tensor {name}")
        values = np.asarray(state[name], dtype="<f4")
        if tuple(values.shape) != shape:
            raise SystemExit(f"{name} has shape {values.shape}, expected {shape}")
        offset = len(model)
        model.extend(values.tobytes(order="C"))
        tensor_specs.append({"name": name, "offset": offset, "shape": list(shape)})

    vocab = {
        "tokens": vocab_tokens,
        "padIndex": char2idx["<PAD>"],
        "unkIndex": char2idx["<UNK>"],
        "bosIndex": char2idx["시"],
        "eosIndex": char2idx["끝"],
    }
    class_text = "\n".join(classes) + "\n"
    character_text = "".join(
        f"{ord(char):X}\t{default}\t{','.join(candidates)}\t{source}\n"
        for char, (default, candidates, source) in sorted(characters.items(), key=lambda item: ord(item[0]))
    )
    phrase_text = "".join(
        f"{key}\t{' '.join(reading)}\n"
        for key in sorted(phrases)
        for reading in phrases[key]
    )
    t2s_text = "".join(f"{source}\t{target}\n" for source, target in sorted(t2s.items()))

    outputs: dict[str, bytes] = {
        "model.f32": bytes(model),
        "model-vocab.json": (json.dumps(vocab, ensure_ascii=False, separators=(",", ":")) + "\n").encode(),
        "classes.txt": class_text.encode(),
        "characters.tsv": character_text.encode(),
        "digest.json": (json.dumps(digest, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode(),
        "phrases.tsv": phrase_text.encode(),
        "t2s.tsv": t2s_text.encode(),
    }

    licenses = out / "licenses"
    licenses.mkdir(parents=True, exist_ok=True)
    (licenses / "g2pM-LICENSE").write_bytes(license_g2pm)
    (licenses / "phrase-pinyin-data-LICENSE").write_bytes(read_tar_member(phrase_archive, "/LICENSE"))
    (licenses / "pinyin-data-LICENSE").write_bytes(read_tar_member(pinyin_archive, "/LICENSE"))
    (licenses / "opencc-js-LICENSE").write_bytes(read_tar_member(opencc_archive, "/LICENSE"))
    (licenses / "opencc-data-APACHE-2.0.txt").write_bytes(
        read_tar_member(opencc_archive, "/LICENSES/Apache-2.0.txt")
    )
    (licenses / "NOTICE.md").write_text(
        "# Notices for the private Mandarin g2pM prototype pack\n\n"
        "g2pM 0.1.2.5 is Apache-2.0 (kakaobrain/g2pM). Its packaged `digest_cedict.pkl` is a\n"
        "character-reading digest derived upstream from CC-CEDICT; the g2pM package distributes it\n"
        "under its own Apache-2.0 licence. CC-CEDICT is CC BY-SA 4.0\n"
        "(https://creativecommons.org/licenses/by-sa/4.0/). No redistribution.\n\n"
        "phrase-pinyin-data v0.20.0 and pinyin-data v0.16.0 are MIT (mozillazg).\n"
        "`large_pinyin.txt` composes cc_cedict, zdic_cibs, zdic_cybs, pinyin, di and overwrite data.\n"
        "CC-CEDICT rows retain CC BY-SA 4.0 attribution; see the upstream README and LICENSE.\n\n"
        "opencc-js 1.4.2 is MIT AND Apache-2.0. Its bundled dictionary data is generated from\n"
        "opencc-data (Apache-2.0); both licence texts are included. Only `TSCharacters` rows with\n"
        "single-code-point source and target are extracted.\n\n"
        "This pack is private evaluation data. It is not committed or redistributed.\n",
        encoding="utf-8",
    )

    manifest = {
        "schema": "cjk-labs.zh.mandarin-g2pm.manifest.v1",
        "format": "mandarin-g2pm-f32-v1",
        "algorithm": "g2pm-bilstm-f32-v2",
        "model": {
            "file": "model.f32",
            "dtype": "float32",
            "byteOrder": "little-endian",
            "byteLength": len(model),
            "tensors": tensor_specs,
        },
        "files": {
            name: {"sha256": sha256(data), "bytes": len(data)}
            for name, data in outputs.items()
        },
        "sources": [
            {
                "id": "g2pM",
                "version": "0.1.2.5",
                "commit": G2PM_COMMIT,
                "url": G2PM_WHEEL_URL,
                "sha256": G2PM_WHEEL_SHA256,
                "license": "Apache-2.0",
                "licenseUrl": f"https://github.com/kakaobrain/g2pM/blob/{G2PM_COMMIT}/LICENSE",
                "files": ["g2pM/np_ckpt.pkl", "g2pM/char2idx.pkl", "g2pM/class2idx.pkl", "g2pM/digest_cedict.pkl"],
            },
            {
                "id": "g2pM-source",
                "version": "0.1.2.5",
                "commit": G2PM_COMMIT,
                "url": G2PM_SOURCE_URL,
                "sha256": G2PM_SOURCE_SHA256,
                "license": "Apache-2.0",
                "licenseUrl": f"https://github.com/kakaobrain/g2pM/blob/{G2PM_COMMIT}/LICENSE",
                "files": ["g2pM/g2pM.py", "LICENSE"],
            },
            {
                "id": "phrase-pinyin-data",
                "version": PHRASE_TAG,
                "commit": PHRASE_COMMIT,
                "url": PHRASE_URL,
                "sha256": PHRASE_SHA256,
                "license": "MIT",
                "licenseUrl": f"https://github.com/mozillazg/phrase-pinyin-data/blob/{PHRASE_COMMIT}/LICENSE",
                "files": ["large_pinyin.txt"],
            },
            {
                "id": "pinyin-data",
                "version": PINYIN_TAG,
                "commit": PINYIN_COMMIT,
                "url": PINYIN_URL,
                "sha256": PINYIN_SHA256,
                "license": "MIT",
                "licenseUrl": f"https://github.com/mozillazg/pinyin-data/blob/{PINYIN_COMMIT}/LICENSE",
                "files": ["kMandarin_8105.txt", "pinyin.txt"],
            },
            {
                "id": "opencc-js",
                "version": OPENCC_VERSION,
                "url": OPENCC_URL,
                "sha256": OPENCC_TGZ_SHA256,
                "license": "MIT AND Apache-2.0",
                "licenseUrl": "https://github.com/nk2028/opencc-js/blob/main/LICENSE",
                "files": ["dist/esm-lib/dict/TSCharacters.js", "LICENSE", "LICENSES/Apache-2.0.txt"],
            },
        ],
        "policy": {
            "id": "mandarin-g2pm-model-first-v1",
            "summary": "Whole-input exact phrase entry; g2pM for digest-polyphonic characters (original code point when the model vocabulary knows it, else the 1:1 simplified shadow); phrase fill only for non-model positions; else pinyin-data default. No model candidate mask; neutral raw remains 5.",
        },
        "counts": {
            "characters": len(characters),
            "phrases": sum(len(readings) for readings in phrases.values()),
            "t2s": len(t2s),
            "classes": len(classes),
            "vocab": len(vocab_tokens),
            "digest": len(digest),
        },
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    outputs["manifest.json"] = manifest_bytes

    for name, data in outputs.items():
        (out / name).write_bytes(data)

    print(json.dumps({
        "out": str(out),
        "files": {name: {"bytes": len(data), "sha256": sha256(data)} for name, data in sorted(outputs.items())},
        "counts": manifest["counts"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
