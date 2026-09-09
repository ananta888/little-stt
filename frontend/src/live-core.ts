import { Transcript, VoskWord, Word } from './types';

export const RATE = 16000;
export const INTERVAL = 300;
export const CONTEXT = 5;
export interface AudioWindow {
  sequence: number; windowStart: number; coreStart: number; coreEnd: number; pcm: Int16Array;
}
export interface LiveResult extends Transcript {
  session_id: string; chunk_id: string; sequence: number;
  window_start: number; core_start: number; core_end: number;
}
export interface LiveChunk {
  id: string; sessionId: string; sequence: number; windowStart: number; coreStart: number; coreEnd: number;
  status: 'queued' | 'processing' | 'retry' | 'failed' | 'done';
  attempts: number; retryAt: number; error: string; result?: LiveResult;
  preview: string; draft?: string; suggestion: string; boundaryUncertain: boolean;
}
export interface LiveSessionData {
  id: string; created: string; language: string; interval: number; duration: number;
  voskEnabled?: boolean;
  preview: string; partial: string; words: VoskWord[];
  state: 'recording' | 'stopped'; warning: string;
}

/** Sample counts, rather than timers, determine every boundary. Buffer stays bounded. */
export class WindowAssembler {
  private parts: Int16Array[] = [];
  private bufferStart = 0;
  total = 0;
  coreStart = 0;
  private sequence = 0;
  constructor(readonly interval = INTERVAL, readonly context = CONTEXT, readonly rate = RATE) {
    if (interval <= context || context < 0 || interval > 300) throw new Error('Ungültiges Aufnahmeintervall.');
  }
  push(samples: Float32Array): AudioWindow[] {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * (samples[i] < 0 ? 32768 : 32767));
    this.parts.push(pcm); this.total += pcm.length;
    const windows: AudioWindow[] = [];
    while (this.total >= this.coreStart + (this.interval + this.context) * this.rate) {
      windows.push(this.extract(this.coreStart + this.interval * this.rate, this.coreStart + (this.interval + this.context) * this.rate));
    }
    return windows;
  }
  finish(): AudioWindow[] {
    const windows: AudioWindow[] = [];
    while (this.coreStart < this.total) {
      const end = Math.min(this.coreStart + this.interval * this.rate, this.total);
      windows.push(this.extract(end, Math.min(this.total, end + this.context * this.rate)));
    }
    return windows;
  }
  private extract(coreEnd: number, windowEnd: number): AudioWindow {
    const start = Math.max(0, this.coreStart - this.context * this.rate);
    const joined = new Int16Array(this.total - this.bufferStart);
    let offset = 0;
    for (const part of this.parts) { joined.set(part, offset); offset += part.length; }
    const window = {sequence: this.sequence++, windowStart: start, coreStart: this.coreStart, coreEnd,
      pcm: joined.slice(start - this.bufferStart, windowEnd - this.bufferStart)};
    this.coreStart = coreEnd;
    const keep = Math.max(0, coreEnd - this.context * this.rate);
    this.parts = [joined.slice(keep - this.bufferStart)]; this.bufferStart = keep;
    return window;
  }
}

export function encodeWav(pcm: Int16Array): Blob {
  const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return new Blob([buffer], {type: 'audio/wav'});
}

const middle = (word: Word) => (word.start + word.end) / 2;
const normalized = (word: Word) => word.word.toLocaleLowerCase('de').replace(/[^\p{L}\p{N}]/gu, '');
function tokens(result: LiveResult): Word[] {
  return result.segments.flatMap(segment => segment.words.length ? segment.words : segment.text.trim() ?
    // No invented confidence: segment fallback is marked as unavailable in JSON.
    [{word: segment.text, start: segment.start, end: segment.end, probability: NaN}] : []);
}

/** Align matching words near a seam. Preserve repetitions outside the shared audio. */
export function stitch(chunks: LiveChunk[]): LiveChunk[] {
  const ordered = [...chunks].sort((a, b) => a.sequence - b.sequence);
  const groups: {chunks: LiveChunk[]; words: Word[]; uncertain: Set<string>}[] = [];
  for (const chunk of ordered) {
    if (!chunk.result) continue;
    const previous = groups.at(-1), last = previous?.chunks.at(-1);
    const right = tokens(chunk.result);
    if (!previous || !last || last.coreEnd !== chunk.coreStart) {
      groups.push({chunks: [chunk], words: right, uncertain: new Set()}); continue;
    }
    const left = previous.words, boundary = chunk.coreStart / RATE;
    let best: {i: number; j: number; cost: number} | undefined;
    for (let i = left.length - 1; i >= 0 && middle(left[i]) >= boundary - CONTEXT - 1; i--) {
      for (let j = 0; j < right.length && middle(right[j]) <= boundary + CONTEXT + 1; j++) {
        if (!normalized(left[i]) || normalized(left[i]) !== normalized(right[j]) || Math.abs(middle(left[i]) - middle(right[j])) > 1) continue;
        const pair = i > 0 && j > 0 && normalized(left[i - 1]) === normalized(right[j - 1]);
        const cost = Math.abs(middle(left[i]) - boundary) + Math.abs(middle(left[i]) - middle(right[j])) + (pair ? 0 : 2);
        if (!best || cost < best.cost) best = {i, j, cost};
      }
    }
    if (best) previous.words = [...left.slice(0, best.i + 1), ...right.slice(best.j + 1)];
    else {
      previous.words = [...left.filter(w => middle(w) < boundary), ...right.filter(w => middle(w) >= boundary)];
      // Silence at the boundary needs no warning. Conflicting speech needs review.
      if (left.some(w => w.end > boundary - 1) && right.some(w => w.start < boundary + 1)) {
        previous.uncertain.add(last.id); previous.uncertain.add(chunk.id);
      }
    }
    previous.chunks.push(chunk);
  }
  const suggestions = new Map<string, {text: string; uncertain: boolean}>();
  for (const group of groups) for (const chunk of group.chunks) {
    const words = group.words.filter(w => middle(w) >= chunk.coreStart / RATE && middle(w) < chunk.coreEnd / RATE);
    suggestions.set(chunk.id, {text: words.map(w => w.word.trim()).join(' '), uncertain: group.uncertain.has(chunk.id)});
  }
  return ordered.map(chunk => ({...chunk, suggestion: suggestions.get(chunk.id)?.text ?? '',
    boundaryUncertain: suggestions.get(chunk.id)?.uncertain ?? false}));
}

export function textFor(chunk: LiveChunk): string {
  return chunk.draft !== undefined ? chunk.draft : chunk.result ? chunk.suggestion : chunk.preview;
}
