import { LiveChunk, LiveSessionData } from './live-core';
import { AudioInfo, FileTranscript, Folder, LibraryData, liveDocument, Retention, reviewBlocker, TranscriptDocument } from './library-core';

/** Browser-local library. Audio deletion and review changes share one transaction. */
export class LiveStore {
  private db?: IDBDatabase;
  async open() {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('little-stt-live', 2);
      request.onupgradeneeded = event => {
        const db = request.result, tx = request.transaction!;
        if (event.oldVersion < 1) {
          db.createObjectStore('session'); db.createObjectStore('chunks', {keyPath: 'id'}); db.createObjectStore('audio');
        }
        db.createObjectStore('documents', {keyPath: 'id'});
        db.createObjectStore('folders', {keyPath: 'id'});
        db.createObjectStore('audioInfo', {keyPath: 'id'});
        tx.objectStore('chunks').createIndex('sessionId', 'sessionId');
        tx.objectStore('session').get('current').onsuccess = e => {
          const session = (e.target as IDBRequest).result as LiveSessionData | undefined;
          if (session) tx.objectStore('documents').put(liveDocument(session));
        };
        tx.objectStore('chunks').openCursor().onsuccess = e => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor) return;
          const chunk = cursor.value as LiveChunk;
          tx.objectStore('audio').get(chunk.id).onsuccess = e => {
            const blob = (e.target as IDBRequest).result as Blob | undefined;
            if (blob) tx.objectStore('audioInfo').put({id: chunk.id, documentId: chunk.sessionId, bytes: blob.size, name: `live-${chunk.sequence + 1}.wav`});
          };
          cursor.continue();
        };
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Bitte andere little-stt-Tabs schließen und diese Seite neu laden.'));
    });
  }
  private transaction(stores: string[], work: (tx: IDBTransaction, fail: (message: string) => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(stores, 'readwrite');
      let reason: Error | undefined;
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(reason ?? tx.error); tx.onabort = () => reject(reason ?? tx.error);
      const fail = (message: string) => { reason = new Error(message); tx.abort(); };
      try { work(tx, fail); } catch (error) { reason = error as Error; tx.abort(); }
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
    return {session, chunks: session ? chunks.filter(c => c.sessionId === session.id) : []};
  }
  saveSession(session: LiveSessionData) {
    return this.transaction(['session', 'documents'], tx => {
      tx.objectStore('session').put(session, 'current');
      const docs = tx.objectStore('documents');
      docs.get(session.id).onsuccess = e => {
        const doc: TranscriptDocument = (e.target as IDBRequest).result ?? liveDocument(session);
        docs.put({...doc, live: session, updated: new Date().toISOString()});
      };
    });
  }
  saveChunks(chunks: LiveChunk[]) {
    return this.transaction(['chunks', 'documents'], tx => {
      for (const chunk of chunks) {
        const store = tx.objectStore('chunks');
        store.get(chunk.id).onsuccess = e => {
          const previous: LiveChunk | undefined = (e.target as IDBRequest).result;
          store.put(chunk);
          if (previous?.draft !== chunk.draft || previous?.suggestion !== chunk.suggestion) {
            const docs = tx.objectStore('documents');
            docs.get(chunk.sessionId).onsuccess = e => {
              const doc: TranscriptDocument | undefined = (e.target as IDBRequest).result;
              if (doc) docs.put({...doc, approvedAt: undefined, updated: new Date().toISOString()});
            };
          }
        };
      }
    });
  }
  add(chunk: LiveChunk, audio: Blob) {
    return this.transaction(['chunks', 'audio', 'audioInfo'], tx => {
      tx.objectStore('chunks').put(chunk); tx.objectStore('audio').put(audio, chunk.id);
      tx.objectStore('audioInfo').put({id: chunk.id, documentId: chunk.sessionId, bytes: audio.size, name: `live-${chunk.sequence + 1}.wav`} satisfies AudioInfo);
    });
  }
  audio(id: string) { return this.read<Blob | undefined>('audio', id); }
  document(id: string) { return this.read<TranscriptDocument | undefined>('documents', id); }
  async library(): Promise<LibraryData> {
    // One snapshot: counts cannot disagree with an in-flight audio deletion.
    return new Promise((resolve, reject) => {
      const names = ['documents', 'folders', 'chunks', 'audioInfo'];
      const tx = this.db!.transaction(names), requests = names.map(n => tx.objectStore(n).getAll());
      tx.oncomplete = () => resolve({documents: requests[0].result, folders: requests[1].result, chunks: requests[2].result, audio: requests[3].result});
      tx.onerror = () => reject(tx.error);
    });
  }
  async openSession(id: string) {
    const doc = await this.document(id);
    if (!doc?.live) throw new Error('Live-Sitzung nicht gefunden.');
    await this.transaction(['session'], tx => tx.objectStore('session').put(doc.live, 'current'));
    return this.restore();
  }
  detach() { return this.transaction(['session'], tx => tx.objectStore('session').delete('current')); }
  async saveFile(id: string, file: FileTranscript, audio?: Blob) {
    return this.transaction(['documents', 'audio', 'audioInfo'], tx => {
      const docs = tx.objectStore('documents');
      docs.get(id).onsuccess = e => {
        const previous: TranscriptDocument | undefined = (e.target as IDBRequest).result;
        const now = new Date().toISOString();
        const doc: TranscriptDocument = previous ?? {id, kind: 'file', title: file.name, folderId: null, created: now, updated: now, retention: 'after-review'};
        const changed = previous?.file?.final.text !== file.final.text || previous?.file?.final.source !== file.final.source;
        docs.put({...doc, file, approvedAt: changed ? undefined : doc.approvedAt, updated: now});
        // Never resurrect deleted originals on a later text edit.
        if (!previous && audio) {
          tx.objectStore('audio').put(audio, id);
          tx.objectStore('audioInfo').put({id, documentId: id, bytes: audio.size, name: file.name} satisfies AudioInfo);
        }
      };
    });
  }
  updateDocument(id: string, changes: {title?: string; folderId?: string | null; retention?: Retention}) {
    return this.transaction(['documents', 'folders', 'chunks', 'audio', 'audioInfo'], (tx, fail) => {
      const docs = tx.objectStore('documents');
      docs.get(id).onsuccess = e => {
        const doc: TranscriptDocument | undefined = (e.target as IDBRequest).result;
        if (!doc) { fail('Transkript nicht gefunden.'); return; }
        const next = {...doc, ...changes, updated: new Date().toISOString()};
        if (!next.title.trim() || next.title.length > 200) { fail('Bitte einen Titel mit 1 bis 200 Zeichen eingeben.'); return; }
        next.title = next.title.trim();
        const commit = () => {
          if (next.approvedAt && next.retention === 'after-review') { this.deleteAudioIn(tx, next.id); next.audioDeletedAt ??= new Date().toISOString(); }
          docs.put(next);
        };
        if (next.folderId) tx.objectStore('folders').get(next.folderId).onsuccess = e => {
          if (!(e.target as IDBRequest).result) fail('Ordner nicht gefunden.'); else commit();
        }; else commit();
      };
    });
  }
  private deleteAudioIn(tx: IDBTransaction, id: string) {
    tx.objectStore('audioInfo').openCursor().onsuccess = e => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) return;
      if ((cursor.value as AudioInfo).documentId === id) { tx.objectStore('audio').delete(cursor.primaryKey); cursor.delete(); }
      cursor.continue();
    };
  }
  private checkedReview(id: string, action: 'approve' | 'delete-audio') {
    return this.transaction(['documents', 'chunks', 'audio', 'audioInfo'], (tx, fail) => {
      const docs = tx.objectStore('documents');
      docs.get(id).onsuccess = e => {
        const doc: TranscriptDocument | undefined = (e.target as IDBRequest).result;
        if (!doc) { fail('Transkript nicht gefunden.'); return; }
        tx.objectStore('chunks').index('sessionId').getAll(id).onsuccess = e => {
          const reason = reviewBlocker(doc, (e.target as IDBRequest).result);
          if (reason) { fail(reason); return; }
          const now = new Date().toISOString();
          const remove = action === 'delete-audio' || doc.retention === 'after-review';
          if (remove) this.deleteAudioIn(tx, id);
          docs.put({...doc, updated: now, approvedAt: action === 'approve' ? now : doc.approvedAt,
            audioDeletedAt: remove ? now : doc.audioDeletedAt});
        };
      };
    });
  }
  approve(id: string) { return this.checkedReview(id, 'approve'); }
  deleteAudio(id: string) { return this.checkedReview(id, 'delete-audio'); }
  deleteDocument(id: string) {
    return this.transaction(['session', 'documents', 'chunks', 'audio', 'audioInfo'], tx => {
      tx.objectStore('documents').delete(id); this.deleteAudioIn(tx, id);
      tx.objectStore('chunks').index('sessionId').openCursor(id).onsuccess = e => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.objectStore('session').get('current').onsuccess = e => {
        if ((e.target as IDBRequest).result?.id === id) tx.objectStore('session').delete('current');
      };
    });
  }
  saveFolder(folder: Folder) {
    return this.transaction(['folders'], (tx, fail) => {
      const name = folder.name.trim();
      if (!name || name.length > 80) { fail('Bitte einen Ordnernamen mit 1 bis 80 Zeichen eingeben.'); return; }
      tx.objectStore('folders').getAll().onsuccess = e => {
        const folders = (e.target as IDBRequest).result as Folder[];
        if (folders.some(f => f.id !== folder.id && f.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail('Dieser Ordnername existiert bereits.');
        else tx.objectStore('folders').put({...folder, name});
      };
    });
  }
  deleteFolder(id: string) {
    return this.transaction(['folders', 'documents'], tx => {
      tx.objectStore('folders').delete(id);
      tx.objectStore('documents').openCursor().onsuccess = e => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) return;
        if ((cursor.value as TranscriptDocument).folderId === id) cursor.update({...cursor.value, folderId: null});
        cursor.continue();
      };
    });
  }
  /** Used only by isolated tests; the UI deletes individual documents. */
  clear() { return this.transaction(['session', 'documents', 'folders', 'chunks', 'audio', 'audioInfo'], tx => { for (const name of ['session', 'documents', 'folders', 'chunks', 'audio', 'audioInfo']) tx.objectStore(name).clear(); }); }
  close() { this.db?.close(); }
}
