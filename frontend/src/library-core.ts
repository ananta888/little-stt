import { LiveChunk, LiveSessionData, RATE, textFor } from './live-core';
import { Transcript, VoskWord } from './types';

export type Retention = 'after-review' | 'keep';
export interface Folder { id: string; name: string; }
export interface FileTranscript {
  name: string; vosk: {text: string; words: VoskWord[]; error: string | null};
  whisper: Transcript | null; whisperError?: string | null; final: {text: string; source: string};
}
export interface TranscriptDocument {
  id: string; kind: 'live' | 'file'; title: string; folderId: string | null;
  created: string; updated: string; retention: Retention; approvedAt?: string;
  audioDeletedAt?: string; live?: LiveSessionData; file?: FileTranscript;
}
export interface AudioInfo { id: string; documentId: string; bytes: number; name: string; }
export interface LibraryData { documents: TranscriptDocument[]; folders: Folder[]; chunks: LiveChunk[]; audio: AudioInfo[]; }
export function liveDocument(session: LiveSessionData): TranscriptDocument {
  return {id: session.id, kind: 'live', title: `Live ${new Date(session.created).toLocaleString('de-DE')}`,
    folderId: null, created: session.created, updated: session.created, retention: 'after-review', live: session};
}
export function documentText(doc: TranscriptDocument, chunks: LiveChunk[]): string {
  if (doc.file) return doc.file.final.text;
  const ordered = chunks.filter(c => c.sessionId === doc.id).sort((a, b) => a.sequence - b.sequence);
  const end = (ordered.at(-1)?.coreEnd ?? 0) / RATE;
  const tail = doc.live?.words.filter(w => (w.start + w.end) / 2 >= end).map(w => w.word).join(' ');
  return [...ordered.map(textFor), tail ? `[Unvollständige Vorschau]\n${tail}` : ''].filter(Boolean).join('\n\n');
}
export function reviewBlocker(doc: TranscriptDocument, chunks: LiveChunk[]): string {
  if (doc.kind === 'file') return doc.file ? '' : 'Das Datei-Ergebnis fehlt.';
  if (doc.live?.state === 'recording') return 'Zuerst die Aufnahme beenden.';
  const own = chunks.filter(c => c.sessionId === doc.id);
  if (!own.length) return 'Es sind keine abgeschlossenen Audioabschnitte vorhanden.';
  if (own.some(c => c.status !== 'done')) return 'Zuerst alle Whisper-Aufträge abschließen.';
  if ((doc.live?.duration ?? 0) * RATE > Math.max(...own.map(c => c.coreEnd)) + 1) return 'Die Aufnahme enthält einen unterbrochenen, ungesicherten Rest. Bitte Texte exportieren; keine vollständige Freigabe möglich.';
  return '';
}
export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
