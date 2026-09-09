import '@angular/compiler';
import 'fake-indexeddb/auto';
import { createEnvironmentInjector, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveComponent } from '../src/live';
import { LiveChunk, LiveResult } from '../src/live-core';

const disposals: (() => void)[] = [];
afterEach(() => { disposals.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });

async function fixture() {
  vi.stubGlobal('window', new EventTarget());
  const injector = createEnvironmentInjector([], null as unknown as EnvironmentInjector);
  const component = runInInjectionContext(injector, () => new LiveComponent());
  await component['store'].open(); await component['store'].clear(); component.storageReady.set(true);
  component.session.set({id: 's', created: '', duration: 1, interval: 300, language: 'de', preview: '', partial: '', words: [], state: 'stopped', warning: ''});
  await component['store'].saveSession(component.session()!);
  const chunk: LiveChunk = {id: 'c', sessionId: 's', sequence: 0, windowStart: 0, coreStart: 0, coreEnd: 16000,
    status: 'queued', attempts: 0, retryAt: 0, error: '', preview: 'Vorschau', suggestion: '', boundaryUncertain: false};
  component.chunks.set([chunk]); await component['store'].add(chunk, new Blob(['wav']));
  disposals.push(() => { component.ngOnDestroy(); injector.destroy(); });
  return component;
}
function result(): LiveResult {
  return {session_id: 's', chunk_id: 'c', sequence: 0, window_start: 0, core_start: 0, core_end: 1,
    text: 'Ergebnis', language: 'de', language_probability: 1, model: 'test', duration: 1,
    segments: [{start: 0, end: 1, text: 'Ergebnis', words: [{word: 'Ergebnis', start: 0, end: 1, probability: .9}],
      avg_logprob: -.1, no_speech_prob: .1, compression_ratio: 1, temperature: 0}]};
}

it('keeps an edit made while Whisper was running and persists both versions', async () => {
  const component = await fixture();
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r; })); vi.stubGlobal('fetch', fetcher);
  const pending = component['pump'](); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  component.edit('c', 'Meine Korrektur');
  resolve(Response.json(result())); await pending; await component['saves'];
  expect(component.finalText()).toBe('Meine Korrektur');
  expect(component.chunks()[0].suggestion).toBe('Ergebnis');
  expect((await component['store'].restore()).chunks[0].draft).toBe('Meine Korrektur');
});

it('retries a busy backend using the same chunk identity and never appends duplicate results', async () => {
  const component = await fixture();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({detail: 'busy'}, {status: 503})).mockResolvedValueOnce(Response.json(result()));
  vi.stubGlobal('fetch', fetcher);
  await component['pump'](); expect(component.chunks()[0].status).toBe('retry');
  component.retry(); await vi.waitFor(() => expect(component.chunks()[0].status).toBe('done')); await component['saves'];
  expect(component.chunks()).toHaveLength(1);
  const requests = fetcher.mock.calls.map(call => (call[1].body as FormData).get('chunk_id'));
  expect(requests).toEqual(['c', 'c']); expect(component.finalText()).toBe('Ergebnis');
});

it('rejects responses for a different recording and pauses on permanent validation errors', async () => {
  const component = await fixture(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({...result(), session_id: 'other'})));
  await component['pump'](); await component['saves'];
  expect(component.chunks()[0].status).toBe('failed'); expect(component.chunks()[0].result).toBeUndefined();
  expect(component.finalText()).toBe('Vorschau');
  await component['pump'](); expect(fetch).toHaveBeenCalledOnce();
});

it('retains the WAV after an offline failure and sends no requests while paused', async () => {
  const component = await fixture(); const fetcher = vi.fn().mockRejectedValue(new TypeError('offline')); vi.stubGlobal('fetch', fetcher);
  component.paused.set(true); await component['pump'](); expect(fetcher).not.toHaveBeenCalled();
  component.paused.set(false); await component['pump'](); await component['saves'];
  expect(component.chunks()[0].status).toBe('retry'); expect(await (await component['store'].audio('c'))!.text()).toBe('wav');
});

it('recovers a WAV and edited text after a storage quota failure without discarding either', async () => {
  const component = await fixture();
  component.saveFailed.set(true); component['volatileAudio'].set('c', new Blob(['recovered audio']));
  component.chunks.set([{...component.chunks()[0], status: 'done', draft: 'Nicht verlieren'}]);
  const add = vi.spyOn(component['store'], 'add').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
  await expect(component.flush()).rejects.toThrow('nicht vollständig gespeichert');
  await component.retryStorage(); expect(component.saveFailed()).toBe(true); expect(component['volatileAudio'].size).toBe(1);
  await component.retryStorage(); expect(component.saveFailed()).toBe(false); expect(component['volatileAudio'].size).toBe(0);
  expect(await (await component['store'].audio('c'))!.text()).toBe('recovered audio');
  expect((await component['store'].restore()).chunks[0].draft).toBe('Nicht verlieren');
  expect(add).toHaveBeenCalledTimes(2); await expect(component.flush()).resolves.toBeUndefined();
});
