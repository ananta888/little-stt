import { describe, it, expect } from 'vitest';
import { WindowAssembler, encodeWav, stitch, textFor, LiveChunk, RATE } from '../src/live-core';

describe('sample-based live audio windows', () => {
  it('sends five-minute cores with continuous overlapping context and flushes the tail', () => {
    const assembler = new WindowAssembler(300, 5, 10);
    const samples = Float32Array.from({length: 6120}, (_, i) => (i % 100) / 100);
    const windows = [];
    for (let i = 0; i < samples.length; i += 127) windows.push(...assembler.push(samples.slice(i, i + 127)));
    windows.push(...assembler.finish());
    expect(windows.map(w => [w.windowStart, w.coreStart, w.coreEnd, w.pcm.length])).toEqual([
      [0, 0, 3000, 3050], [2950, 3000, 6000, 3100], [5950, 6000, 6120, 170],
    ]);
    expect([...windows[0].pcm.slice(2950)]).toEqual([...windows[1].pcm.slice(0, 100)]);
    expect([...windows[1].pcm.slice(3000)]).toEqual([...windows[2].pcm.slice(0, 100)]);
    expect(assembler.finish()).toEqual([]);
  });
  it('flushes a full core plus a short remainder when stopping before right context completes', () => {
    const assembler = new WindowAssembler(300, 5, 1);
    expect(assembler.push(new Float32Array(302))).toEqual([]);
    expect(assembler.finish().map(w => [w.coreStart, w.coreEnd])).toEqual([[0, 300], [300, 302]]);
  });
  it('does not send an empty stop and preserves a very short final recording', () => {
    const assembler = new WindowAssembler();
    expect(assembler.finish()).toEqual([]);
    assembler.push(new Float32Array([1, -1, 0]));
    expect([...assembler.finish()[0].pcm]).toEqual([32767, -32768, 0]);
  });
  it('encodes independently decodable little-endian PCM WAVs', async () => {
    const data = new DataView(await encodeWav(new Int16Array([-32768, 0, 32767])).arrayBuffer());
    expect(data.getUint32(24, true)).toBe(RATE);
    expect(data.getUint32(40, true)).toBe(6);
    expect(data.getInt16(44, true)).toBe(-32768);
    expect(data.getInt16(48, true)).toBe(32767);
  });
});

function chunk(sequence: number, words: [string, number, number][]): LiveChunk {
  const start = sequence * 300;
  return {id: String(sequence), sessionId: 's', sequence, windowStart: Math.max(0, start - 5) * RATE,
    coreStart: start * RATE, coreEnd: (start + 300) * RATE, status: 'done', attempts: 1, retryAt: 0,
    error: '', preview: '', suggestion: '', boundaryUncertain: false,
    result: {session_id: 's', chunk_id: String(sequence), sequence, core_start: start, core_end: start + 300,
      window_start: Math.max(0, start - 5), text: words.map(w => w[0]).join(' '), language: 'de', language_probability: 1,
      model: 'test', duration: 310, segments: [{start, end: start + 300, text: '', avg_logprob: -.1,
        no_speech_prob: .1, compression_ratio: 1, temperature: 0,
        words: words.map(([word, start, end]) => ({word, start, end, probability: .9}))}]}};
}

describe('overlap reconciliation and editing', () => {
  it('aligns a repeated overlap once despite timestamp drift across the exact boundary', () => {
    const a = chunk(0, [['Hallo', 298, 298.5], ['Welt', 299.6, 300.2]]);
    const b = chunk(1, [['Hallo', 298.1, 298.6], ['Welt', 299.9, 300.4], ['weiter', 300.6, 301]]);
    expect(stitch([a, b]).map(textFor).join(' ')).toBe('Hallo Welt weiter');
  });
  it('preserves actual repeated words instead of globally deduplicating text', () => {
    const a = chunk(0, [['ja', 299, 299.2], ['ja', 299.5, 299.7]]);
    const b = chunk(1, [['ja', 299, 299.2], ['ja', 299.5, 299.7], ['ja', 300.5, 300.7]]);
    expect(stitch([a, b]).map(textFor).join(' ')).toBe('ja ja ja');
  });
  it('never overwrites edits, including deliberate empty edits, on late results', () => {
    const a = {...chunk(0, [['Original', 1, 2]]), draft: 'Meine Korrektur'};
    const b = {...chunk(1, [['Weiter', 301, 302]]), draft: ''};
    expect(stitch([b, a]).map(textFor)).toEqual(['Meine Korrektur', '']);
  });
  it('flags conflicting boundary speech and leaves silence unflagged', () => {
    const results = stitch([chunk(0, [['Müller', 299.7, 300.1]]), chunk(1, [['Meier', 299.9, 300.3]])]);
    expect(results.every(c => c.boundaryUncertain)).toBe(true);
    expect(stitch([chunk(0, []), chunk(1, [])]).some(c => c.boundaryUncertain)).toBe(false);
  });
  it('does not merge across missing results', () => {
    const a = chunk(0, [['eins', 1, 2]]), c = chunk(2, [['drei', 601, 602]]);
    expect(stitch([c, a]).map(textFor)).toEqual(['eins', 'drei']);
  });
});
