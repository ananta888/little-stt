import io
import wave
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import main

client = TestClient(main.app)


def audio(seconds=2, rate=16000):
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(bytes(seconds * rate * 2))
    return output.getvalue()


@pytest.fixture
def metadata():
    return dict(session_id=str(uuid4()), chunk_id=str(uuid4()), sequence=1,
                window_start_sample=159_000, core_start_sample=160_000, core_end_sample=180_000)


def response():
    return {'text': 'Hallo Welt', 'language': 'de', 'language_probability': .99, 'model': 'test', 'duration': 2,
            'segments': [{'start': .1, 'end': 1.9, 'text': 'Hallo Welt', 'words': [
                {'word': 'Hallo', 'start': .1, 'end': 1, 'probability': .95},
                {'word': 'Welt', 'start': 1, 'end': 1.9, 'probability': .9}]}]}


def test_live_timestamps_idempotency_and_identity_conflict(monkeypatch, metadata):
    calls = []

    def transcribe(file, language):
        calls.append(language)
        return deepcopy(response())

    monkeypatch.setattr(main, 'transcribe', transcribe)
    first = client.post('/api/live/transcribe', data=metadata, files={'file': ('live.wav', audio())})
    assert first.status_code == 200
    result = first.json()
    assert result['session_id'] == metadata['session_id']
    assert result['chunk_id'] == metadata['chunk_id']
    assert result['segments'][0]['words'][0]['start'] == pytest.approx(10.0375)
    assert result['core_start'] == 10
    assert result['core_end'] == 11.25
    repeated = client.post('/api/live/transcribe', data=metadata, files={'file': ('live.wav', audio())})
    assert repeated.json() == result
    assert calls == ['de']
    changed = client.post('/api/live/transcribe', data={**metadata, 'language': 'en'}, files={'file': ('live.wav', audio())})
    assert changed.status_code == 409


@pytest.mark.parametrize('field,value', [('core_end_sample', 160_000), ('core_end_sample', 300_000),
                                        ('window_start_sample', 0), ('core_start_sample', -1), ('sequence', -1)])
def test_invalid_boundaries_never_run_whisper(monkeypatch, metadata, field, value):
    monkeypatch.setattr(main, 'transcribe', lambda *args: pytest.fail('Whisper must not run'))
    result = client.post('/api/live/transcribe', data={**metadata, field: value}, files={'file': ('live.wav', audio())})
    assert result.status_code == 422


def test_invalid_pcm_format(metadata):
    assert client.post('/api/live/transcribe', data=metadata, files={'file': ('live.wav', audio(rate=8000))}).status_code == 415
    assert client.post('/api/live/transcribe', data=metadata, files={'file': ('live.wav', b'invalid')}).status_code == 415
    assert client.post('/api/live/transcribe', data=metadata, files={'file': ('live.wav', audio()[:-10])}).status_code == 400


def test_full_five_minute_window(monkeypatch):
    monkeypatch.setattr(main, 'transcribe', lambda *args: response())
    meta = dict(session_id=str(uuid4()), chunk_id=str(uuid4()), sequence=1,
                window_start_sample=295 * 16000, core_start_sample=300 * 16000, core_end_sample=600 * 16000)
    assert client.post('/api/live/transcribe', data=meta, files={'file': ('live.wav', audio(seconds=310))}).status_code == 200


def test_temporary_failure_can_retry(monkeypatch, metadata):
    def busy(*args):
        raise HTTPException(503, 'busy')
    monkeypatch.setattr(main, 'transcribe', busy)
    assert client.post('/api/live/transcribe', data=metadata, files={'file': ('live.wav', audio())}).status_code == 503
    assert metadata['chunk_id'] not in main.live_pending
    monkeypatch.setattr(main, 'transcribe', lambda *args: response())
    assert client.post('/api/live/transcribe', data=metadata, files={'file': ('live.wav', audio())}).status_code == 200
