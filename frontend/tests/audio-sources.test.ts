import { afterEach, expect, it, vi } from 'vitest';
import { acquireAudio } from '../src/audio-sources';
function track(kind: 'audio' | 'video', deviceId = '', surface = 'browser') {
  const value = {kind, readyState: 'live', getSettings: () => ({deviceId, displaySurface: surface}), stop: vi.fn(() => { value.readyState = 'ended'; })};
  return value;
}
function stream(audio = true, surface = 'browser', deviceId = '') {
  const tracks = [track('video', '', surface), ...(audio ? [track('audio', deviceId)] : [])];
  return {getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio'), getVideoTracks: () => tracks.filter(t => t.kind === 'video')} as unknown as MediaStream;
}
function setup() {
  const display = stream(), microphone = stream(true, '', 'mic');
  const getDisplayMedia = vi.fn().mockResolvedValue(display), getUserMedia = vi.fn().mockResolvedValue(microphone);
  vi.stubGlobal('navigator', {mediaDevices: {getDisplayMedia, getUserMedia}});
  return {display, microphone, getDisplayMedia, getUserMedia, controller: new AbortController()};
}
afterEach(() => vi.unstubAllGlobals());
it('opens the display picker in the click turn and captures tab audio without ever requesting a microphone', async () => {
  const f = setup(); const promise = acquireAudio({source: 'tab', includeMicrophone: false}, f.controller.signal);
  expect(f.getDisplayMedia).toHaveBeenCalledOnce(); expect(f.getUserMedia).not.toHaveBeenCalled();
  expect(await promise).toEqual([f.display]);
  expect(f.getDisplayMedia.mock.calls[0][0]).toMatchObject({audio: {suppressLocalAudioPlayback: false}, systemAudio: 'exclude', video: {displaySurface: 'browser'}});
  f.controller.abort(); expect(f.display.getTracks().every(t => t.readyState === 'ended')).toBe(true);
});
it('adds the selected microphone as a separate stream and stops both on abort', async () => {
  const f = setup();
  expect(await acquireAudio({source: 'tab', includeMicrophone: true, microphoneId: 'mic'}, f.controller.signal)).toEqual([f.display, f.microphone]);
  expect(f.getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({exact: 'mic'});
  f.controller.abort(); expect([...f.display.getTracks(), ...f.microphone.getTracks()].every(t => t.readyState === 'ended')).toBe(true);
});
it('rejects sharing without audio and releases the screen rather than falling back to the microphone', async () => {
  const f = setup(), silent = stream(false); f.getDisplayMedia.mockResolvedValue(silent);
  await expect(acquireAudio({source: 'system', includeMicrophone: true}, f.controller.signal)).rejects.toThrow('keinen Ton');
  expect(f.getUserMedia).not.toHaveBeenCalled(); expect(silent.getVideoTracks()[0].readyState).toBe('ended');
});
it.each([['tab', 'monitor'], ['system', 'browser']] as const)('rejects a mismatched surface for %s', async (source, surface) => {
  const f = setup(), wrong = stream(true, surface); f.getDisplayMedia.mockResolvedValue(wrong);
  await expect(acquireAudio({source, includeMicrophone: false}, f.controller.signal)).rejects.toThrow('bitte');
  expect(wrong.getTracks().every(t => t.readyState === 'ended')).toBe(true);
});
it('releases sharing if the optional microphone permission is refused', async () => {
  const f = setup(); f.getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  await expect(acquireAudio({source: 'tab', includeMicrophone: true}, f.controller.signal)).rejects.toMatchObject({name: 'NotAllowedError'});
  expect(f.display.getTracks().every(t => t.readyState === 'ended')).toBe(true);
});
it('stops sharing immediately when cancelled during the microphone prompt, then stops a late microphone', async () => {
  const f = setup(); let resolve!: (s: MediaStream) => void;
  f.getUserMedia.mockImplementation(() => new Promise(r => { resolve = r; }));
  const pending = acquireAudio({source: 'tab', includeMicrophone: true}, f.controller.signal);
  await vi.waitFor(() => expect(f.getUserMedia).toHaveBeenCalled()); f.controller.abort();
  expect(f.display.getTracks().every(t => t.readyState === 'ended')).toBe(true);
  resolve(f.microphone); await expect(pending).rejects.toMatchObject({name: 'AbortError'});
  expect(f.microphone.getTracks().every(t => t.readyState === 'ended')).toBe(true);
});
it('releases a screen stream that arrives after cancelling its picker', async () => {
  const f = setup(); let resolve!: (s: MediaStream) => void;
  f.getDisplayMedia.mockImplementation(() => new Promise(r => { resolve = r; }));
  const pending = acquireAudio({source: 'tab', includeMicrophone: false}, f.controller.signal);
  f.controller.abort(); resolve(f.display); await expect(pending).rejects.toMatchObject({name: 'AbortError'});
  expect(f.display.getTracks().every(t => t.readyState === 'ended')).toBe(true);
});
it('requires an explicit loopback input and disables speech processing for that source', async () => {
  const f = setup();
  await expect(acquireAudio({source: 'input', includeMicrophone: false}, f.controller.signal)).rejects.toThrow('auswählen');
  expect(f.getUserMedia).not.toHaveBeenCalled();
  await acquireAudio({source: 'input', inputId: 'loopback', includeMicrophone: false}, f.controller.signal);
  expect(f.getDisplayMedia).not.toHaveBeenCalled(); expect(f.getUserMedia).toHaveBeenCalledOnce();
  expect(f.getUserMedia.mock.calls[0][0].audio).toEqual({deviceId: {exact: 'loopback'}, echoCancellation: false, noiseSuppression: false, autoGainControl: false});
});
it('rejects adding the same loopback device again through a microphone alias', async () => {
  const f = setup();
  await expect(acquireAudio({source: 'input', inputId: 'loopback', microphoneId: 'alias', includeMicrophone: true}, f.controller.signal)).rejects.toThrow('dasselbe Gerät');
  expect(f.microphone.getTracks().every(t => t.readyState === 'ended')).toBe(true);
});
