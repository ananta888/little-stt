import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { LiveStore } from '../src/live-store';
import { LiveChunk, LiveSessionData } from '../src/live-core';
import { FileTranscript } from '../src/library-core';
const stores: LiveStore[] = [];
afterEach(() => stores.splice(0).forEach(s => s.close()));
const session = (id = 's'): LiveSessionData => ({id, created: new Date().toISOString(), language: 'de', interval: 300, duration: 1, preview: '', partial: '', words: [], state: 'stopped', warning: ''});
const chunk = (id = 'c', sessionId = 's'): LiveChunk => ({id, sessionId, sequence: 0, windowStart: 0, coreStart: 0, coreEnd: 16000,
  status: 'done', attempts: 1, retryAt: 0, error: '', preview: 'Vorschau', draft: 'Geprüfter Text', suggestion: 'Whisper', boundaryUncertain: false});
const file: FileTranscript = {name: 'aufnahme.ogg', vosk: {text: 'hallo', words: [], error: null}, whisper: null, final: {text: 'Hallo.', source: 'Manuell'}};
async function fixture() { const store = new LiveStore(); stores.push(store); await store.open(); await store.clear(); return store; }
async function live(store: LiveStore, id = 's') { await store.saveSession(session(id)); await store.add(chunk(`${id}-c`, id), new Blob(['audio'])); }

it('keeps multiple sessions and only restores the selected session, including retry audio', async () => {
  const store = await fixture(); await live(store, 'one');
  await store.saveChunks([{...chunk('one-c', 'one'), status: 'retry'}]);
  await store.detach(); expect((await store.restore()).session).toBeUndefined();
  await live(store, 'two');
  expect((await store.restore()).chunks.map(c => c.sessionId)).toEqual(['two']);
  const selected = await store.openSession('one');
  expect(selected.chunks[0].status).toBe('retry'); expect(await (await store.audio('one-c'))!.text()).toBe('audio');
  expect((await store.library()).documents).toHaveLength(2);
});
it('atomically approves and deletes only the reviewed document audio, retaining text and other recordings', async () => {
  const store = await fixture(); await live(store, 'one'); await live(store, 'two');
  await store.approve('one');
  expect((await store.document('one'))!.approvedAt).toBeTruthy(); expect(await store.audio('one-c')).toBeUndefined();
  expect((await store.openSession('one')).chunks[0].draft).toBe('Geprüfter Text');
  expect(await store.audio('two-c')).toBeDefined(); expect((await store.library()).audio).toHaveLength(1);
});
it('keeps audio on request, deletes when switched after approval, and never resurrects originals on editing', async () => {
  const store = await fixture(); await store.saveFile('file', file, new Blob(['original']));
  await store.updateDocument('file', {retention: 'keep'}); await store.approve('file');
  expect(await store.audio('file')).toBeDefined();
  await store.updateDocument('file', {retention: 'after-review'}); expect(await store.audio('file')).toBeUndefined();
  await store.saveFile('file', {...file, final: {text: 'Neue Korrektur', source: 'Manuell'}}, new Blob(['original']));
  expect((await store.document('file'))!.approvedAt).toBeUndefined();
  expect((await store.document('file'))!.file!.final.text).toBe('Neue Korrektur'); expect(await store.audio('file')).toBeUndefined();
});
it.each(['queued', 'processing', 'retry', 'failed'] as const)('never reviews or removes audio needed by a %s job', async status => {
  const store = await fixture(); await live(store);
  await store.saveChunks([{...chunk('s-c'), status}]);
  await expect(store.approve('s')).rejects.toThrow('Whisper'); await expect(store.deleteAudio('s')).rejects.toThrow('Whisper');
  expect(await store.audio('s-c')).toBeDefined(); expect((await store.document('s'))!.approvedAt).toBeUndefined();
});
it('rejects approval during recording or with an interrupted unsaved tail', async () => {
  const store = await fixture(); await live(store);
  await store.saveSession({...session(), state: 'recording'}); await expect(store.approve('s')).rejects.toThrow('Aufnahme beenden');
  await store.saveSession({...session(), duration: 2}); await expect(store.approve('s')).rejects.toThrow('ungesicherten Rest');
  expect(await store.audio('s-c')).toBeDefined();
});
it('revokes live approval on edits and preserves metadata while the active session saves', async () => {
  const store = await fixture(); await live(store); await store.updateDocument('s', {title: 'Besprechung', retention: 'keep'});
  await store.approve('s'); await store.saveChunks([{...chunk('s-c'), draft: ''}]); await store.saveSession(session());
  const doc = (await store.document('s'))!;
  expect(doc.approvedAt).toBeUndefined(); expect(doc.title).toBe('Besprechung'); expect(doc.retention).toBe('keep');
  expect((await store.restore()).chunks[0].draft).toBe(''); expect(await store.audio('s-c')).toBeDefined();
});
it('moves files and live sessions and removes a folder without deleting its contents', async () => {
  const store = await fixture(); await live(store); await store.saveFile('f', file, new Blob(['ogg']));
  await store.saveFolder({id: 'folder', name: 'Projekt'});
  await store.updateDocument('s', {folderId: 'folder'}); await store.updateDocument('f', {folderId: 'folder'});
  await expect(store.saveFolder({id: 'other', name: ' projekt '})).rejects.toThrow('existiert');
  await expect(store.updateDocument('s', {folderId: 'missing'})).rejects.toThrow('Ordner nicht gefunden');
  await store.saveFolder({id: 'folder', name: 'Gespräche'}); await store.deleteFolder('folder');
  const data = await store.library(); expect(data.documents).toHaveLength(2); expect(data.folders).toHaveLength(0);
  expect(data.documents.every(d => d.folderId === null)).toBe(true); expect(data.audio).toHaveLength(2);
});
it('deletes a document with its audio and active pointer without touching another session', async () => {
  const store = await fixture(); await live(store, 'one'); await live(store, 'two');
  await store.deleteDocument('two'); expect((await store.restore()).session).toBeUndefined();
  const data = await store.library(); expect(data.documents.map(d => d.id)).toEqual(['one']);
  expect(data.chunks.map(c => c.sessionId)).toEqual(['one']); expect(data.audio.map(a => a.documentId)).toEqual(['one']);
});
it('migrates an existing v1 session and WAV without changing its contents', async () => {
  await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase('little-stt-live'); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); });
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('little-stt-live', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('session'); r.result.createObjectStore('chunks', {keyPath: 'id'}); r.result.createObjectStore('audio'); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  await new Promise<void>(resolve => { const tx = old.transaction(['session', 'chunks', 'audio'], 'readwrite');
    tx.objectStore('session').put(session(), 'current'); tx.objectStore('chunks').put(chunk()); tx.objectStore('audio').put(new Blob(['legacy']), 'c'); tx.oncomplete = () => resolve(); });
  old.close(); const store = new LiveStore(); stores.push(store); await store.open();
  expect((await store.restore()).chunks[0].draft).toBe('Geprüfter Text');
  const data = await store.library(); expect(data.documents[0].id).toBe('s'); expect(data.audio[0].bytes).toBe(6);
  expect(await (await store.audio('c'))!.text()).toBe('legacy'); expect(data.documents[0].retention).toBe('after-review');
});

it('keeps the existing review when a file is saved again without changes', async () => {
  const store = await fixture(); await store.saveFile('f', file, new Blob(['ogg'])); await store.approve('f');
  const approved = (await store.document('f'))!.approvedAt;
  await store.saveFile('f', file, new Blob(['must not resurrect']));
  expect((await store.document('f'))!.approvedAt).toBe(approved); expect(await store.audio('f')).toBeUndefined();
});
