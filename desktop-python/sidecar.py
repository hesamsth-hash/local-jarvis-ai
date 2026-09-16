#!/usr/bin/env python3
"""JARVIS sidecar — faster-whisper STT + optional Kokoro TTS on localhost.

A tiny stdlib-only HTTP server (no framework needed) that the web console
auto-detects and uses for higher-quality, lower-memory speech recognition.
Windows-only in practice (Android uses its in-app engines), but it runs
anywhere Python runs.

Endpoints (all localhost, no auth needed on 127.0.0.1):
  GET  /health          -> {"ok":true,"model":"base.en","tts":true|false}
  POST /transcribe      -> multipart/form-data field "audio" (wav/webm)
                           returns {"text": "..."}
  POST /tts             -> {"text": "...", "voice": "af_heart"}
                           returns audio/wav bytes (only if kokoro installed)

Run:  python sidecar.py [--port 8791] [--model base.en]
Stop: Ctrl+C

The console probes /health every send (cheap) and falls back to its built-in
browser Whisper when the sidecar is down — nothing breaks without it.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = "127.0.0.1"
DEFAULT_PORT = 8791
MAX_BODY = 25 * 1024 * 1024  # 25 MB cap on uploads

_state: dict[str, Any] = {"asr": None, "model_id": None, "tts_pipe": None, "tts_voice": None}


def _optional(module: str):
    try:
        return __import__(module)
    except Exception:
        return None


def load_asr(model_id: str):
    """Load faster-whisper lazily; returns (asr, error_message)."""
    if _state["asr"] is not None and _state["model_id"] == model_id:
        return _state["asr"], None
    fw = _optional("faster_whisper")
    if fw is None:
        return None, "faster-whisper isn't installed — pip install faster-whisper"
    try:
        asr = fw.WhisperModel(model_id, device="auto", compute_type="auto")
        _state["asr"] = asr
        _state["model_id"] = model_id
        return asr, None
    except Exception as exc:
        return None, f"Couldn't load the Whisper model: {exc}"


def load_tts():
    """Load kokoro-onnx TTS lazily; returns (pipe, error_message)."""
    if _state["tts_pipe"] is not None:
        return _state["tts_pipe"], None
    ko = _optional("kokoro_onnx")
    if ko is None:
        return None, "kokoro isn't installed — pip install kokoro-onnx onnxruntime"
    try:
        pipe = ko.Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")  # type: ignore[attr-defined]
        _state["tts_pipe"] = pipe
        return pipe, None
    except Exception:
        return None, "Kokoro model files not found next to sidecar.py (kokoro-v1.0.onnx + voices-v1.0.bin)"


# ---------------- multipart parsing (stdlib, small and strict) ----------------

def parse_multipart(body: bytes, content_type: str) -> dict[str, bytes]:
    m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type)
    if not m:
        return {}
    boundary = (m.group(1) or m.group(2) or "").strip().encode()
    parts: dict[str, bytes] = {}
    for segment in body.split(b"--" + boundary):
        seg = segment.strip(b"\r\n")
        if not seg or seg == b"--":
            continue
        if b"\r\n\r\n" not in seg:
            continue
        head, _, payload = seg.partition(b"\r\n\r\n")
        name_m = re.search(rb'name="([^"]+)"', head)
        if name_m:
            parts[name_m.group(1).decode()] = payload.rstrip(b"\r\n")
    return parts


def wav_bytes_from_pcm(pcm24: bytes, sample_rate: int) -> bytes:
    """ Kokoro emits 24 kHz float32 — convert to a 16-bit WAV for transport."""
    import struct

    n = len(pcm24) // 4
    floats = struct.unpack(f"<{n}f", pcm24[: n * 4])
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        frames = bytearray()
        for f in floats:
            s = max(-1.0, min(1.0, f))
            frames += struct.pack("<h", int(s * 32767))
        w.writeframes(bytes(frames))
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "JARVIS-sidecar/1.0"

    # silence per-request logging (the console polls /health constantly)
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _json(self, obj: dict[str, Any], code: int = 200) -> None:
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def _binary(self, data: bytes, ctype: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("bad body size")
        return self.rfile.read(length)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] == "/health":
            self._json({
                "ok": True,
                "model": _state["model_id"] or "unloaded",
                "tts": _state["tts_pipe"] is not None,
                "bridge": "sidecar",
            })
            return
        self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        try:
            if path == "/transcribe":
                ctype = self.headers.get("Content-Type") or ""
                if "multipart/form-data" not in ctype:
                    self._json({"error": "send multipart/form-data with an 'audio' field"}, 400)
                    return
                parts = parse_multipart(self._read_body(), ctype)
                audio = parts.get("audio")
                if not audio:
                    self._json({"error": "missing 'audio' field"}, 400)
                    return
                asr, err = load_asr(_state.get("requested_model") or "base.en")
                if asr is None:
                    self._json({"error": err}, 503)
                    return
                tmp = io.BytesIO(audio)
                segments, info = asr.transcribe(tmp, beam_size=1)
                text = " ".join(s.text for s in segments).strip()
                self._json({"text": text, "language": getattr(info, "language", None)})
                return

            if path == "/tts":
                body = json.loads(self._read_body().decode() or "{}")
                text = (body.get("text") or "").strip()
                if not text:
                    self._json({"error": "missing text"}, 400)
                    return
                pipe, err = load_tts()
                if pipe is None:
                    self._json({"error": err}, 503)
                    return
                samples, sr = pipe.create(
                    text, voice=body.get("voice") or "af_heart", speed=float(body.get("speed") or 1.0)
                )
                import numpy as _np  # kokoro-onnx requires numpy anyway

                pcm = _np.asarray(samples, dtype=_np.float32).tobytes()
                self._binary(wav_bytes_from_pcm(pcm, int(sr)), "audio/wav")
                return

            self._json({"ok": False, "error": "not found"}, 404)
        except ValueError as exc:
            self._json({"error": str(exc)}, 400)
        except Exception as exc:
            self._json({"error": f"sidecar error: {exc}"}, 500)


def main() -> int:
    ap = argparse.ArgumentParser(description="JARVIS sidecar (STT/TTS on localhost)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--model", default="base.en", help="faster-whisper model id (tiny.en, base.en, small…)")
    args = ap.parse_args()
    _state["requested_model"] = args.model

    server = ThreadingHTTPServer((HOST, args.port), Handler)
    print(f"[sidecar] listening on http://{HOST}:{args.port}")
    print(f"[sidecar] model: {args.model} (loads on first transcribe)")
    tts_probe, _ = load_tts()
    print(f"[sidecar] tts: {'ready' if tts_probe else 'not installed (STT still works)'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[sidecar] bye")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
