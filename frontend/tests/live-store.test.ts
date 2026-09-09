import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { LiveStore } from '../src/live-store';
import type { LiveChunk } from '../src/live-core';

it('restores pending audio and preserves editable metadata independently of the WAV', async () => {
  const store = new LiveStore(); await store.open(); await store.clear();
  await store.saveSession({id: 's', created: new Date().toISOString(), language: 'de', interval: 300, duration: 1, preview: '', partial: '', words: [], state: 'stopped', warning: ''});
  const chunk: LiveChunk = {id: 'one', sessionId: 's', sequence: 0, windowStart: 0, coreStart: 0, coreEnd: 16000,
    status: 'retry', attempts: 2, retryAt: 0, error: 'offline', preview: 'hallo', suggestion: '', boundaryUncertain: false};
  await store.add(chunk, new Blob(['audio']));
  await store.saveChunks([{...chunk, draft: 'Korrektur'}]); store.close();
  const restored = new LiveStore(); await restored.open();
  expect((await restored.restore()).chunks[0].draft).toBe('Korrektur');
  expect(await (await restored.audio('one'))!.text()).toBe('audio');
  await restored.clear(); expect((await restored.restore()).chunks).toEqual([]);
  expect(await restored.audio('one')).toBeUndefined(); restored.close();
});
