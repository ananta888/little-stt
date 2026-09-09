import { Model, KaldiRecognizer } from 'vosk-browser';
import { VoskWord } from './types';

export class LiveVosk {
  private recognizer?: KaldiRecognizer;
  private model?: Model;
  private queue: Float32Array[] = [];
  private pending = false;
  private closing = false;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private resolveEnd?: () => void;
  private words: VoskWord[] = [];
  private text = '';
  constructor(private update: (text: string, partial: string, words: VoskWord[]) => void,
              private failure: (message: string) => void) {}

  async load(signal: AbortSignal) {
    const url = new URL('/models/vosk-de.tar.gz', location.href).href;
    const response = await fetch(url, {method: 'HEAD', signal});
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Vosk-Modell fehlt. Download-Skript ausführen. Whisper bleibt verfügbar.');
    this.model = new Model(url, -1);
    await new Promise<void>((resolve, reject) => {
      const end = (error?: Error) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => end(new DOMException('Abgebrochen', 'AbortError'));
      const timer = setTimeout(() => end(new Error('Vosk-Modell lädt zu lange. Whisper bleibt verfügbar.')), 120000);
      signal.addEventListener('abort', abort, {once: true});
      this.model!.on('load', message => end(message.event === 'load' && message.result ? undefined : new Error('Vosk-Modell konnte nicht geladen werden.')));
      this.model!.on('error', () => end(new Error('Vosk-Modell konnte nicht geladen werden.')));
      if (signal.aborted) abort();
    });
    if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    this.recognizer = new this.model.KaldiRecognizer(16000);
    this.recognizer.setWords(true);
    this.recognizer.on('error', () => this.fail('Vosk ist ausgefallen. Die Mikrofonaufnahme und Whisper laufen weiter.'));
    this.recognizer.on('result', message => {
      if (this.closed || message.event !== 'result') return;
      this.text = [this.text, message.result.text].filter(Boolean).join(' ');
      this.words.push(...(message.result.result ?? []));
      this.update(this.text, '', [...this.words]);
      this.acknowledge();
    });
    this.recognizer.on('partialresult', message => {
      if (this.closed || message.event !== 'partialresult') return;
      this.update(this.text, message.result.partial, [...this.words]);
      this.acknowledge();
    });
    this.model.on('error', () => this.fail('Vosk ist ausgefallen. Whisper läuft weiter.'));
  }
  accept(samples: Float32Array) {
    if (this.closed || this.closing) return;
    // At 16 kHz each block is 256 ms. Never let a stalled WASM worker grow without bound.
    if (this.queue.length >= 120) { this.fail('Vosk ist über 30 Sekunden im Rückstand und wurde angehalten. Whisper läuft weiter.'); return; }
    this.queue.push(samples); this.pump();
  }
  private finalSent = false;
  private pump() {
    if (this.pending || this.closed || !this.recognizer) return;
    const samples = this.queue.shift();
    if (!samples && !this.closing) return;
    this.pending = true;
    this.timer = setTimeout(() => this.fail('Vosk antwortet nicht mehr. Whisper läuft weiter.'), 60000);
    if (samples) this.recognizer.acceptWaveformFloat(samples, 16000);
    else { this.finalSent = true; this.recognizer.retrieveFinalResult(); }
  }
  private acknowledge() {
    clearTimeout(this.timer); this.pending = false;
    if (this.finalSent) this.dispose(); else this.pump();
  }
  async finish() {
    if (this.closed || !this.recognizer) { this.dispose(); return; }
    this.closing = true;
    await new Promise<void>(resolve => { this.resolveEnd = resolve; this.pump(); });
  }
  private fail(message: string) { this.failure(message); this.dispose(); }
  dispose() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); this.queue = [];
    // vosk-browser 0.0.8's public terminate() dereferences the WASM model even
    // if loading failed. Terminate its Worker directly to also release failed
    // or cancelled loads. Keep this adapter covered when upgrading the library.
    if (this.model) (this.model as unknown as {worker: Worker}).worker.terminate();
    this.resolveEnd?.();
  }
}
