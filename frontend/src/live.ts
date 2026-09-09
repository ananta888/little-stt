import { Component, OnDestroy, OnInit, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { AudioWindow, encodeWav, INTERVAL, LiveChunk, LiveResult, LiveSessionData, RATE, stitch, textFor, WindowAssembler } from './live-core';
import { LiveStore } from './live-store';
import { MicrophoneCapture } from './live-capture';
import { AudioSource, sourceLabel } from './audio-sources';

@Component({selector: 'app-live', standalone: true, imports: [FormsModule, DecimalPipe], templateUrl: './live.html', styleUrl: './live.css'})
export class LiveComponent implements OnInit, OnDestroy {
  blocked = input(false);
  activity = output<boolean>();
  ready = output<boolean>();
  changed = output<void>();
  opening = signal(false);
  audioIds = signal<Set<string>>(new Set());
  session = signal<LiveSessionData | null>(null);
  chunks = signal<LiveChunk[]>([]);
  phase = signal<'loading' | 'ready' | 'preparing' | 'recording' | 'stopping'>('loading');
  error = signal(''); warning = signal(''); level = signal(0);
  storageReady = signal(false); paused = signal(false); pendingRequest = signal(false);
  expanded = signal<Set<string>>(new Set());
  language = 'de'; interval = INTERVAL; useVosk = true;
  source: AudioSource = 'microphone'; includeMicrophone = false; microphoneId = ''; inputId = '';
  devices = signal<MediaDeviceInfo[]>([]); loadingDevices = signal(false);
  sourceLabel = sourceLabel;
  recording = computed(() => ['preparing', 'recording', 'stopping'].includes(this.phase()));
  pending = computed(() => this.chunks().filter(c => c.status !== 'done').length);
  finalText = computed(() => this.chunks().map(textFor).filter(Boolean).join('\n\n'));
  liveTail = computed(() => {
    const session = this.session(); if (!session) return '';
    const start = (this.chunks().at(-1)?.coreEnd ?? 0) / RATE;
    return [...session.words.filter(w => (w.start + w.end) / 2 >= start).map(w => w.word), session.partial].filter(Boolean).join(' ');
  });
  private store = new LiveStore();
  private capture?: MicrophoneCapture;
  private assembler?: WindowAssembler;
  private saves = Promise.resolve();
  private volatileAudio = new Map<string, Blob>();
  private sending = false;
  saveFailed = signal(false);
  private destroyed = false;
  private timer?: ReturnType<typeof setInterval>;
  private releaseLock?: () => void;
  private request?: AbortController;
  private requestSettled = Promise.resolve();
  private lastPersisted = 0;
  private checkpointBytes = 0;
  private unload = (event: BeforeUnloadEvent) => {
    if (this.recording() || this.volatileAudio.size) { event.preventDefault(); event.returnValue = ''; }
  };
  private online = () => { this.chunks.update(cs => cs.map(c => c.status === 'retry' ? {...c, retryAt: 0} : c)); void this.pump(); };

  async ngOnInit() {
    try {
      if (!navigator.locks) throw new Error('Live-Aufnahmen benötigen einen Browser mit Web Locks, z. B. einen aktuellen Chrome oder Firefox.');
      const acquired = await new Promise<boolean>((resolve, reject) => {
        void navigator.locks.request('little-stt-live-session', {ifAvailable: true}, lock => {
          if (!lock) { resolve(false); return; }
          return new Promise<void>(release => { this.releaseLock = release; resolve(true); });
        }).catch(reject);
      });
      if (!acquired) throw new Error('Die Live-Sitzung ist bereits in einem anderen Tab geöffnet. Bitte dort fortfahren oder den Tab schließen.');
      if (this.destroyed) { this.releaseLock?.(); return; }
      await this.store.open();
      const saved = await this.store.restore();
      if (saved.session) {
        this.session.set({...saved.session, state: 'stopped'});
        this.language = saved.session.language; this.interval = saved.session.interval;
        this.useVosk = saved.session.voskEnabled ?? saved.session.language === 'de';
        this.source = saved.session.audioSource ?? 'microphone'; this.includeMicrophone = saved.session.includeMicrophone ?? false;
        this.warning.set(saved.session.state === 'recording'
          ? 'Unterbrochene Sitzung wiederhergestellt. Vollständige Abschnitte sind gesichert; Audio seit der letzten Abschnittsgrenze muss gegebenenfalls erneut aufgenommen werden. Das Mikrofon bleibt aus.'
          : saved.session.warning);
      }
      this.chunks.set(stitch(saved.chunks.map(c => ({...c, status: c.status === 'processing' ? 'queued' : c.status}))));
      this.storageReady.set(true); this.ready.emit(true); this.phase.set('ready');
      await this.refreshAudio();
      this.timer = setInterval(() => void this.pump(), 1000);
      window.addEventListener('beforeunload', this.unload); window.addEventListener('online', this.online);
      if (this.session()) this.persistSession();
      void this.pump();
    } catch (error) { this.error.set(this.message(error)); this.phase.set('ready'); }
  }

  async start() {
    if (this.blocked() || this.opening() || this.loadingDevices() || !this.storageReady() || this.session() || this.recording()) return;
    this.error.set(''); this.warning.set('');
    const session: LiveSessionData = {id: crypto.randomUUID(), created: new Date().toISOString(), language: this.language,
      interval: Number(this.interval), duration: 0, preview: '', partial: '', words: [], state: 'recording', warning: '',
      voskEnabled: this.useVosk && this.language === 'de', audioSource: this.source,
      includeMicrophone: this.source !== 'microphone' && this.includeMicrophone};
    this.session.set(session); this.assembler = new WindowAssembler(session.interval);
    this.phase.set('preparing'); this.activity.emit(true);
    this.persistSession();
    this.capture = new MicrophoneCapture(samples => {
      const windows = this.assembler!.push(samples);
      this.session.update(s => s && {...s, duration: this.assembler!.total / RATE});
      let sum = 0; for (const sample of samples) sum += sample * sample;
      this.level.set(Math.min(1, Math.sqrt(sum / samples.length) * 5));
      for (const window of windows) this.enqueue(window);
      if (this.assembler!.total - this.lastPersisted > RATE * 5) { this.lastPersisted = this.assembler!.total; this.persistSession(); }
    }, (text, partial, words) => {
      this.session.update(s => s && {...s, preview: text, partial, words});
      this.updatePreviews();
    }, message => { this.warning.set(message); }, message => {
      this.warning.set(message); void this.stop();
    });
    try {
      await this.capture.start(this.useVosk && this.language === 'de', {source: this.source, includeMicrophone: this.includeMicrophone, microphoneId: this.microphoneId, inputId: this.inputId});
      if (this.phase() === 'preparing') this.phase.set('recording');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.error.set(this.message(error));
      await this.stop();
    }
  }

  async loadDevices() {
    if (this.recording() || this.session() || this.loadingDevices() || this.blocked()) return;
    this.loadingDevices.set(true); this.error.set('');
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      // Release the temporary permission probe before enumerating devices.
      stream.getTracks().forEach(t => t.stop());
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      if (!this.destroyed) this.devices.set(inputs);
    } catch (error) { if (!this.destroyed) this.error.set(this.message(error)); }
    finally { stream?.getTracks().forEach(t => t.stop()); this.loadingDevices.set(false); }
  }
  private stopTask?: Promise<void>;
  stop(): Promise<void> { return this.stopTask ??= this.finish(); }
  private async finish() {
    if (!this.capture) return;
    this.phase.set('stopping');
    try { await this.capture.stop(); }
    catch (error) { this.warning.set(this.message(error)); }
    for (const window of this.assembler?.finish() ?? []) this.enqueue(window);
    await this.capture.finishPreview();
    this.capture.disposePreview(); this.capture = undefined; this.assembler = undefined;
    this.updatePreviews();
    this.session.update(s => s && {...s, state: 'stopped', partial: ''});
    this.persistSession(); this.persistChunks();
    await this.saves;
    this.phase.set('ready'); this.level.set(0); this.activity.emit(false);
    void this.pump();
  }

  private enqueue(window: AudioWindow) {
    const session = this.session()!;
    const chunk: LiveChunk = {id: crypto.randomUUID(), sessionId: session.id, sequence: window.sequence,
      windowStart: window.windowStart, coreStart: window.coreStart, coreEnd: window.coreEnd,
      status: 'queued', attempts: 0, retryAt: 0, error: '', preview: '', suggestion: '', boundaryUncertain: false};
    const blob = encodeWav(window.pcm);
    this.volatileAudio.set(chunk.id, blob); this.audioIds.update(ids => new Set([...ids, chunk.id])); this.checkpointBytes += blob.size;
    this.chunks.update(cs => [...cs, chunk]); this.updatePreviews();
    this.save(async () => {
      await this.store.add(this.chunks().find(c => c.id === chunk.id)!, blob);
      this.volatileAudio.delete(chunk.id); this.audioIds.update(ids => new Set([...ids, chunk.id]));
    });
    // Include the final partial window when stopping; never discard a captured window.
    if ((this.pending() >= 12 || this.checkpointBytes >= 512 * 1024 * 1024) && this.phase() === 'recording') {
      this.warning.set('Die lokale Aufnahmegrenze ist erreicht. Die Aufnahme wird gesichert und beendet; ausstehende Abschnitte werden weiter verarbeitet.');
      void this.stop();
    }
    void this.pump();
  }
  private updatePreviews() {
    const words = this.session()?.words ?? [];
    this.chunks.update(cs => cs.map(c => ({...c, preview: words.filter(w => (w.start + w.end) / 2 >= c.coreStart / RATE && (w.start + w.end) / 2 < c.coreEnd / RATE).map(w => w.word).join(' ')})));
  }
  private save(work: () => Promise<void>) {
    this.saves = this.saves.then(work).then(() => { this.changed.emit(); }).catch(error => {
      this.saveFailed.set(true);
      this.error.set(`Lokales Speichern fehlgeschlagen: ${this.message(error)} Bitte Texte/Audio vor dem Schließen exportieren.`);
      if (this.phase() === 'recording' || this.phase() === 'preparing') void this.stop();
    });
  }
  private persistSession() { const s = this.session(); if (s) this.save(() => this.store.saveSession({...s, warning: this.warning()})); }
  private persistChunks() { const chunks = this.chunks(); this.save(() => this.store.saveChunks(chunks)); }

  private async pump() {
    if (this.blocked() || this.opening() || this.sending || this.paused() || !this.storageReady() || this.destroyed) return;
    // Strict FIFO: a failed earlier block is visible and must be retried before later blocks.
    const first = this.chunks().find(c => c.status !== 'done');
    if (!first || first.status === 'failed' || first.retryAt > Date.now()) return;
    this.sending = true; this.pendingRequest.set(true);
    let finishRequest!: () => void;
    this.requestSettled = new Promise<void>(resolve => { finishRequest = resolve; });
    const id = first.id, sessionId = first.sessionId;
    this.patch(id, {status: 'processing', attempts: first.attempts + 1, error: ''});
    this.persistChunks();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.saves;
      if (this.opening() || this.destroyed) return;
      const blob = this.volatileAudio.get(id) ?? await this.store.audio(id);
      if (this.opening() || this.destroyed) return;
      if (!blob) throw new LiveRequestError('Gespeichertes Audio fehlt. Vorhandene Texte exportieren und eine neue Sitzung beginnen.', false);
      const body = new FormData(); body.append('file', blob, `${id}.wav`);
      const fields = {session_id: sessionId, chunk_id: id, sequence: first.sequence, window_start_sample: first.windowStart,
        core_start_sample: first.coreStart, core_end_sample: first.coreEnd, language: this.session()!.language};
      for (const [key, value] of Object.entries(fields)) body.append(key, String(value));
      this.request = new AbortController(); timer = setTimeout(() => this.request?.abort(), 15 * 60 * 1000);
      const response = await fetch('/api/live/transcribe', {method: 'POST', body, signal: this.request.signal});
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = typeof data?.detail === 'string' ? data.detail : `Backend antwortet mit ${response.status}.`;
        throw new LiveRequestError(message, [408, 425, 429].includes(response.status) || response.status >= 500);
      }
      const result: LiveResult = await response.json();
      if (result.chunk_id !== id || result.session_id !== sessionId || result.sequence !== first.sequence
          || result.core_start !== first.coreStart / RATE || result.core_end !== first.coreEnd / RATE || !Array.isArray(result.segments)) {
        throw new LiveRequestError('Backend-Ergebnis passt nicht zu diesem Abschnitt.', false);
      }
      if (this.destroyed || this.session()?.id !== sessionId) return;
      this.patch(id, {status: 'done', result, retryAt: 0, error: ''});
      this.chunks.update(stitch); this.persistChunks();
    } catch (error) {
      if (!this.destroyed && this.session()?.id === sessionId) {
        const retry = !(error instanceof LiveRequestError) || error.retry;
        const delay = Math.min(60, 5 * 2 ** Math.min(first.attempts, 4));
        this.patch(id, {status: retry ? 'retry' : 'failed', error: this.message(error), retryAt: retry ? Date.now() + delay * 1000 : 0});
        this.persistChunks();
      }
    } finally {
      clearTimeout(timer); this.request = undefined; this.sending = false; this.pendingRequest.set(false);
      finishRequest();
      if (!this.destroyed && this.chunks().find(c => c.id === id)?.status === 'done') void this.pump();
    }
  }
  private patch(id: string, patch: Partial<LiveChunk>) { this.chunks.update(cs => cs.map(c => c.id === id ? {...c, ...patch} : c)); }
  edit(id: string, text: string) { if (this.opening()) return; this.patch(id, {draft: text}); this.persistChunks(); }
  useSuggestion(id: string) { if (this.opening()) return; this.patch(id, {draft: undefined}); this.persistChunks(); }
  retry() {
    if (this.opening()) return;
    this.paused.set(false);
    this.chunks.update(cs => cs.map(c => ['retry', 'failed'].includes(c.status) ? {...c, status: 'queued', retryAt: 0, error: ''} : c));
    this.persistChunks(); void this.pump();
  }
  async waitForSaves() { await this.saves; }
  async flush() { await this.saves; if (this.saveFailed()) throw new Error('Die Sitzung konnte nicht vollständig gespeichert werden. Texte und Audio bitte vor dem Wechsel exportieren.'); if (this.volatileAudio.size) throw new Error('Noch nicht gesichertes Audio zuerst herunterladen.'); }
  async retryStorage() {
    if (this.recording() || this.pendingRequest() || this.opening() || !this.session()) return;
    this.opening.set(true); this.paused.set(true);
    try {
      await this.saves;
      await this.store.saveSession({...this.session()!, warning: this.warning()});
      for (const [id, blob] of this.volatileAudio) {
        const chunk = this.chunks().find(c => c.id === id);
        if (chunk) await this.store.add(chunk, blob);
        this.volatileAudio.delete(id);
      }
      await this.store.saveChunks(this.chunks()); this.saveFailed.set(false); this.error.set(''); this.changed.emit();
    } catch (error) { this.saveFailed.set(true); this.error.set(`Lokales Speichern fehlgeschlagen: ${this.message(error)} Bitte Audio oder Texte exportieren.`); }
    finally { this.opening.set(false); this.paused.set(false); void this.pump(); }
  }
  async refreshAudio() {
    if (this.storageReady()) this.audioIds.set(new Set([...(await this.store.library()).audio.map(a => a.id), ...this.volatileAudio.keys()]));
  }
  async newSession() {
    if (!this.storageReady() || this.recording() || this.opening()) return;
    const wasPaused = this.paused();
    this.opening.set(true); this.paused.set(true);
    try {
      // Retire the old request before detaching its session. Its WAV stays durable.
      // The backend may finish inference; reopening retries with the same chunk ID.
      this.request?.abort(); await this.requestSettled;
      this.chunks.update(cs => cs.map(c => ['processing', 'retry'].includes(c.status)
        ? {...c, status: 'queued', retryAt: 0, error: ''} : c));
      this.persistChunks(); await this.flush();
      await this.store.detach(); this.resetSession(); this.phase.set('ready'); this.changed.emit();
      this.paused.set(false);
    } catch (error) { this.error.set(this.message(error)); this.paused.set(wasPaused); }
    finally { this.opening.set(false); }
  }
  async openSession(id: string) {
    if (this.recording() || this.pendingRequest() || this.opening()) return;
    this.opening.set(true); this.paused.set(true);
    try {
      await this.flush();
      const saved = await this.store.openSession(id);
      this.resetSession();
      this.session.set(saved.session ? {...saved.session, state: 'stopped'} : null);
      this.chunks.set(stitch(saved.chunks.map(c => ({...c, status: c.status === 'processing' ? 'queued' : c.status}))));
      if (saved.session) {
        this.language = saved.session.language; this.interval = saved.session.interval;
        this.useVosk = saved.session.voskEnabled ?? saved.session.language === 'de';
        this.source = saved.session.audioSource ?? 'microphone'; this.includeMicrophone = saved.session.includeMicrophone ?? false;
        this.warning.set(saved.session.warning); this.persistSession();
      }
      await this.refreshAudio();
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.opening.set(false); this.paused.set(false); void this.pump(); }
  }
  private resetSession() {
    this.session.set(null); this.chunks.set([]); this.volatileAudio.clear();
    this.error.set(''); this.warning.set(''); this.stopTask = undefined; this.capture = undefined;
    this.checkpointBytes = 0; this.lastPersisted = 0; this.expanded.set(new Set()); this.audioIds.set(new Set());
  }
  async audio(chunk: LiveChunk) {
    try {
      const blob = this.volatileAudio.get(chunk.id) ?? await this.store.audio(chunk.id);
      if (!blob) throw new Error('Audio nicht verfügbar.');
      this.downloadBlob(blob, `live-${chunk.sequence + 1}.wav`);
    } catch (error) { this.error.set(this.message(error)); }
  }
  export(json: boolean) {
    const session = this.session(); if (!session) return;
    const tail = this.liveTail();
    const text = [this.finalText(), tail ? `[Noch nicht mit Whisper nachbearbeitete Vorschau]\n${tail}` : ''].filter(Boolean).join('\n\n');
    const data = json ? JSON.stringify({session, chunks: this.chunks(), text}, null, 2) : text;
    this.downloadBlob(new Blob([data], {type: json ? 'application/json' : 'text/plain;charset=utf-8'}), `live-${session.created.slice(0, 19).replaceAll(':', '-')}.${json ? 'json' : 'txt'}`);
  }
  private downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  textFor = textFor;
  toggleDetails(id: string, event: Event) {
    this.expanded.update(current => {
      const next = new Set(current);
      (event.target as HTMLDetailsElement).open ? next.add(id) : next.delete(id);
      return next;
    });
  }
  voskWords(chunk: LiveChunk) {
    return (this.session()?.words ?? []).filter(word => (word.start + word.end) / 2 >= chunk.coreStart / RATE && (word.start + word.end) / 2 < chunk.coreEnd / RATE);
  }
  time(seconds: number) { return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
  label(chunk: LiveChunk) {
    return {queued: 'Wartet auf Whisper', processing: 'Whisper arbeitet', retry: 'Wiederholung folgt', failed: 'Bitte prüfen', done: 'Mit Whisper nachbearbeitet'}[chunk.status];
  }
  private message(error: unknown) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Audiozugriff oder Bildschirmfreigabe wurde nicht erlaubt. Bitte die Browserfreigabe prüfen.';
    if (error instanceof DOMException && error.name === 'NotFoundError') return 'Keine passende Audioquelle gefunden.';
    if (error instanceof DOMException && error.name === 'AbortError') return 'Anfrage unterbrochen oder Zeitlimit erreicht. Der Abschnitt bleibt gespeichert.';
    if (error instanceof DOMException && error.name === 'NotSupportedError') return 'Dieser Browser unterstützt diese Audiofreigabe nicht. Einen unterstützten Browser oder einen eingerichteten Loopback-Audioeingang verwenden.';
    if (error instanceof DOMException && error.name === 'OverconstrainedError') return 'Der ausgewählte Audioeingang ist nicht verfügbar. Audioeingänge erneut laden und auswählen.';
    return error instanceof Error ? error.message : 'Unerwarteter Fehler.';
  }
  ngOnDestroy() {
    this.destroyed = true; clearInterval(this.timer); this.request?.abort();
    window.removeEventListener('beforeunload', this.unload); window.removeEventListener('online', this.online);
    void this.capture?.stop().finally(() => this.capture?.disposePreview());
    void this.saves.finally(() => { this.store.close(); this.releaseLock?.(); });
  }
}
class LiveRequestError extends Error { constructor(message: string, readonly retry: boolean) { super(message); } }
