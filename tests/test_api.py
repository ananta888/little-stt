import io
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import main

client = TestClient(main.app)


def wav_bytes(seconds=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(44100)
        wav.writeframes(np.zeros((int(seconds * 44100), 2), dtype="<i2").tobytes())
    return output.getvalue()


def test_convert_stereo_to_browser_pcm():
    response = client.post("/api/audio/wav", files={"file": ("voice.wav", wav_bytes())})
    assert response.status_code == 200
    with wave.open(io.BytesIO(response.content)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()) == (1, 2, 16000, 16000)


@pytest.mark.parametrize("content,status", [(b"", 400), (b"not audio", 415)])
def test_invalid_audio(content, status):
    assert client.post("/api/audio/wav", files={"file": ("bad.ogg", content)}).status_code == status


def test_duration_and_upload_limits(monkeypatch):
    monkeypatch.setattr(main, "MAX_SECONDS", 0.1)
    assert client.post("/api/audio/wav", files={"file": ("long.wav", wav_bytes())}).status_code == 413
    monkeypatch.setattr(main, "MAX_BYTES", 2)
    assert client.post("/api/audio/wav", files={"file": ("big.wav", b"123")}).status_code == 413


def test_transcribe_preserves_word_and_segment_scores(monkeypatch):
    def transcribe(audio, **options):
        assert audio.dtype == np.float32 and len(audio) == 16000
        assert options["language"] is None
        assert options["word_timestamps"] and options["vad_filter"]
        word = SimpleNamespace(word=" Hallo", start=0.1, end=0.6, probability=0.87)
        segment = SimpleNamespace(start=0.1, end=0.6, text=" Hallo", avg_logprob=-0.2,
                                  no_speech_prob=0.01, compression_ratio=1.1, temperature=0, words=[word])
        return iter([segment]), SimpleNamespace(language="de", language_probability=0.98)

    monkeypatch.setattr(main, "model", SimpleNamespace(transcribe=transcribe))
    response = client.post("/api/transcribe", files={"file": ("test.wav", wav_bytes())}, data={"language": "auto"})
    assert response.status_code == 200
    result = response.json()
    assert result["text"] == "Hallo"
    assert result["segments"][0]["words"][0]["probability"] == 0.87
    assert result["segments"][0]["avg_logprob"] == -0.2
    assert result["language_probability"] == 0.98


def test_busy_and_failure_release_lock(monkeypatch):
    with main.inference_lock:
        assert client.post("/api/transcribe", files={"file": ("test.wav", wav_bytes())}).status_code == 503
    assert client.post("/api/transcribe", files={"file": ("bad", b"bad")}).status_code == 415
    assert not main.inference_lock.locked()


def test_merge_disabled(monkeypatch):
    monkeypatch.setattr(main, "OLLAMA_MODEL", "")
    assert client.post("/api/merge", json={"vosk_text": "hallo", "whisper_text": "Hallo."}).status_code == 503


@pytest.mark.parametrize("result,status", [
    ({"message": {"content": "Hallo."}, "done_reason": "stop"}, 200),
    ({"message": {"content": ""}}, 502),
    ({"message": {"content": "abgebrochen"}, "done_reason": "length"}, 502),
])
def test_merge_results(monkeypatch, result, status):
    monkeypatch.setattr(main, "OLLAMA_MODEL", "test-model")
    response = main.httpx.Response(200, json=result, request=main.httpx.Request("POST", "http://localhost/api/chat"))
    with patch.object(main.httpx.AsyncClient, "post", new=AsyncMock(return_value=response)):
        actual = client.post("/api/merge", json={"vosk_text": "hallo", "whisper_text": "Hallo."})
    assert actual.status_code == status
    if status == 200:
        assert actual.json() == {"text": "Hallo.", "source": "llm", "model": "test-model"}
