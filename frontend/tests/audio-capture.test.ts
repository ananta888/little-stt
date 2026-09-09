import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('captures each sample once, mixes channels, flushes a partial block and stops without feedback', () => {
  let Processor: any;
  const messages: any[] = [];
  runInNewContext(readFileSync(new URL('../public/audio-capture.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = {postMessage: (message: unknown) => messages.push(message), onmessage: null}; },
    registerProcessor: (_: string, processor: any) => { Processor = processor; }, Float32Array,
  });
  const processor = new Processor();
  expect(processor.process([[new Float32Array(5001).fill(1), new Float32Array(5001).fill(-.5)]])).toBe(true);
  processor.port.onmessage({data: 'stop'});
  const audio = messages.filter(message => message.type === 'audio');
  expect(audio.map(message => message.samples.length)).toEqual([4096, 905]);
  expect(audio.every(message => message.samples.every((sample: number) => sample === .25))).toBe(true);
  expect(messages.at(-1).type).toBe('stopped');
  expect(processor.process([[new Float32Array(128)]])).toBe(false);
  expect(messages).toHaveLength(3);
});
