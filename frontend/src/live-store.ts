import { LiveChunk, LiveSessionData } from './live-core';

/** Only the current session is retained. Blobs are separate from editable metadata. */
export class LiveStore {
  private db?: IDBDatabase;
  async open() {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('little-stt-live', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('session');
        request.result.createObjectStore('chunks', {keyPath: 'id'});
        request.result.createObjectStore('audio');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Bitte andere little-stt-Tabs schließen.'));
    });
  }
  private transaction(stores: string[], work: (tx: IDBTransaction) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      work(tx);
    });
  }
  private read<T>(store: string, key?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store), request = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async restore(): Promise<{session?: LiveSessionData; chunks: LiveChunk[]}> {
    const [session, chunks] = await Promise.all([this.read<LiveSessionData>('session', 'current'), this.read<LiveChunk[]>('chunks')]);
    return {session, chunks};
  }
  saveSession(session: LiveSessionData) { return this.transaction(['session'], tx => tx.objectStore('session').put(session, 'current')); }
  saveChunks(chunks: LiveChunk[]) { return this.transaction(['chunks'], tx => { for (const chunk of chunks) tx.objectStore('chunks').put(chunk); }); }
  add(chunk: LiveChunk, audio: Blob) {
    return this.transaction(['chunks', 'audio'], tx => { tx.objectStore('chunks').put(chunk); tx.objectStore('audio').put(audio, chunk.id); });
  }
  audio(id: string) { return this.read<Blob | undefined>('audio', id); }
  clear() { return this.transaction(['session', 'chunks', 'audio'], tx => { for (const name of ['session', 'chunks', 'audio']) tx.objectStore(name).clear(); }); }
  close() { this.db?.close(); }
}
