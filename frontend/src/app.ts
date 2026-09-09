import { Component, OnDestroy, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { checked, Transcript, VoskWord } from './types';
import { LiveComponent } from './live';
import { LibraryComponent } from './library';
import { LiveStore } from './live-store';
import { FileTranscript, TranscriptDocument } from './library-core';

@Component({
  selector: 'app-root', standalone: true, imports: [FormsModule, DecimalPipe, LiveComponent, LibraryComponent],
  templateUrl: './app.html',
})
export class AppComponent implements OnDestroy {
  mode = signal<'file' | 'live' | 'library'>('file');
  live = viewChild(LiveComponent);
  libraryReady = signal(false); libraryRevision = signal(0); libraryBusy = signal(false);
  storedFileId = signal<string | null>(null); storedName = signal(''); fileSaving = signal(false);
  saveStatus = signal('');
  private store = new LiveStore(); private storeOpened?: Promise<void>;
  private fileSaves = Promise.resolve();
  private fileSaveFailed = false;
  private unload = (event: BeforeUnloadEvent) => {
    if (this.fileSaving() || this.fileSaveFailed) { event.preventDefault(); event.returnValue = ''; }
  };
  prepareLibrary = async (id?: string) => {
    await this.live()?.waitForSaves(); await this.fileSaves;
    if (id === undefined || id === this.live()?.session()?.id) await this.live()?.flush();
    if (this.fileSaveFailed && (id === undefined || id === this.storedFileId())) throw new Error('Datei-Transkript zuerst erneut speichern oder exportieren. Audio anderer Transkripte kann zum Freigeben von Platz gelöscht werden.');
  };
  libraryChanged() { this.libraryRevision.update(n => n + 1); }
  private openStore() { return this.storeOpened ??= this.store.open(); }

  liveActive = signal(false);
  file = signal<File | null>(null);
  audioUrl = signal('');
  busy = signal(false);
  merging = signal(false);
  error = signal('');
  voskStatus = signal('Bereit für deine Aufnahme');
  whisperStatus = signal('Bereit für deine Aufnahme');
  voskError = signal('');
  whisperError = signal('');
  voskText = signal('');
  voskWords = signal<VoskWord[]>([]);
  voskProgress = signal(0);
  whisper = signal<Transcript | null>(null);
  finalText = signal('');
  finalSource = signal('Whisper');
  llmEnabled = signal(false);
  backend = signal('Backend wird geprüft …');
  tab = signal<'final' | 'compare' | 'details'>('final');
  language = 'de';
  useVosk = true;

  constructor() {
    window.addEventListener('beforeunload', this.unload);
    fetch('/api/health').then(checked).then(r => r.json()).then(data => {
      this.backend.set(`Whisper ${data.whisper_model} · lokal`);
      this.llmEnabled.set(data.llm_enabled);
    }).catch(() => this.backend.set('Backend nicht erreichbar · Port 8000 prüfen'));
  }

  select(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.setFile(file);
  }

  drop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file && !this.busy() && !this.merging() && !this.fileSaving() && !this.libraryBusy()) this.setFile(file);
  }

  setFile(file: File) {
    this.error.set('');
    if (!file.size || file.size > 100 * 1024 * 1024) {
      this.error.set('Bitte eine nicht leere Datei mit maximal 100 MB wählen.'); return;
    }
    if (this.fileSaveFailed && !window.confirm('Das letzte Transkript konnte nicht gespeichert werden. Trotzdem eine andere Datei öffnen? Bitte benötigte Texte vorher exportieren.')) return;
    this.fileSaveFailed = false;
    this.storedFileId.set(null); this.storedName.set(''); this.saveStatus.set('');
    URL.revokeObjectURL(this.audioUrl());
    this.file.set(file); this.audioUrl.set(URL.createObjectURL(file));
    this.reset();
  }

  reset() {
    this.voskText.set(''); this.voskWords.set([]); this.voskProgress.set(0);
    this.whisper.set(null); this.finalText.set(''); this.finalSource.set('Whisper');
    this.voskError.set(''); this.whisperError.set('');
    this.voskStatus.set('Bereit für deine Aufnahme'); this.whisperStatus.set('Bereit für deine Aufnahme');
    this.tab.set('final');
  }

  async start() {
    const file = this.file();
    if (!file || this.busy() || this.merging() || this.fileSaving() || this.libraryBusy()) return;
    this.storedFileId.set(null); this.saveStatus.set('');
    this.reset(); this.error.set(''); this.busy.set(true);
    const language = this.language;
    const runVosk = this.useVosk && language === 'de';
    this.voskStatus.set(runVosk ? 'Wird vorbereitet …' : 'Übersprungen');
    this.whisperStatus.set('Transkribiert … beim ersten Start wird das Modell geladen.');
    const whisperTask = (async () => {
      try {
        const body = new FormData(); body.append('file', file); body.append('language', language);
        const response = await checked(await fetch('/api/transcribe', {method: 'POST', body}));
        const result: Transcript = await response.json();
        this.whisper.set(result); this.finalText.set(result.text);
        this.whisperStatus.set(result.text ? 'Transkription abgeschlossen' : 'Keine Sprache erkannt');
      } catch (error) { this.whisperError.set(this.message(error)); this.whisperStatus.set('Fehlgeschlagen'); }
    })();
    const voskTask = (async () => {
      if (!runVosk) return;
      try {
        const { preview } = await import('./vosk');
        await preview(file, (text, words, progress) => {
          this.voskText.set(text); this.voskWords.set(words); this.voskProgress.set(progress);
        }, text => this.voskStatus.set(text));
        this.voskStatus.set(this.voskText() ? 'Vorschau abgeschlossen' : 'Keine Sprache erkannt');
      } catch (error) { this.voskError.set(this.message(error)); this.voskStatus.set('Fehlgeschlagen'); }
    })();
    await Promise.allSettled([whisperTask, voskTask]);
    if (!this.whisper()?.text && this.voskText()) {
      this.finalText.set(this.voskText());
      this.finalSource.set(this.voskError() ? 'Vosk · unvollständige Vorschau' : 'Vosk · Vorschau');
    }
    this.busy.set(false);
    if (this.whisper() || this.voskText()) await this.persistFile();
  }

  async merge() {
    if (!this.whisper()?.text || !this.voskText() || this.voskError() || this.busy() || this.merging()) return;
    this.merging.set(true); this.error.set('');
    try {
      const response = await checked(await fetch('/api/merge', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({vosk_text: this.voskText(), whisper_text: this.whisper()!.text}),
      }));
      const result = await response.json();
      this.finalText.set(result.text); this.finalSource.set(`LLM · ${result.model} · bitte prüfen`); this.tab.set('final');
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.merging.set(false); }
    await this.persistFile();
  }

  editFinal(text: string) {
    this.finalText.set(text); this.finalSource.set('Manuell bearbeitet'); void this.persistFile();
  }
  async persistFile() {
    if (!this.libraryReady()) { this.saveStatus.set('Bibliothek nicht verfügbar. Ergebnis bitte exportieren.'); return; }
    const id = this.storedFileId() ?? crypto.randomUUID(); this.storedFileId.set(id);
    const file: FileTranscript = {name: this.file()?.name ?? (this.storedName() || 'Transkript'),
      vosk: {text: this.voskText(), words: this.voskWords(), error: this.voskError() || null},
      whisper: this.whisper(), whisperError: this.whisperError() || null, final: {text: this.finalText(), source: this.finalSource()}};
    this.storedName.set(file.name);
    const audio = this.file() ?? undefined;
    this.fileSaving.set(true); this.saveStatus.set('Wird in der Bibliothek gespeichert …');
    const next = this.fileSaves.then(async () => {
      await this.openStore(); await this.store.saveFile(id, file, audio); this.fileSaveFailed = false;
      this.saveStatus.set('In der Bibliothek gespeichert · Freigabe und Audio-Aufbewahrung dort verwalten.'); this.libraryChanged();
    });
    this.fileSaves = next.catch(error => { this.fileSaveFailed = true; this.saveStatus.set('Speichern fehlgeschlagen. Bitte erneut speichern oder exportieren.'); this.error.set(this.message(error)); });
    await this.fileSaves;
    // A following edit may still be writing; wait for that tail before unlocking.
    const tail = this.fileSaves; await tail; if (this.fileSaves === tail) this.fileSaving.set(false);
  }
  async newLiveRecording() {
    if (!this.libraryReady() || this.liveActive() || this.live()?.opening() || this.busy() || this.merging() || this.fileSaving() || this.libraryBusy()) return;
    this.libraryBusy.set(true);
    try { await this.live()?.newSession(); this.mode.set('live'); }
    finally { this.libraryBusy.set(false); }
  }
  async openDocument(doc: TranscriptDocument) {
    if (this.liveActive() || this.live()?.pendingRequest() || this.busy() || this.merging() || this.libraryBusy() || this.fileSaving()) return;
    this.libraryBusy.set(true);
    try {
      await this.prepareLibrary();
      if (doc.live) { await this.live()?.openSession(doc.id); this.mode.set('live'); return; }
      if (!doc.file) return;
      await this.openStore();
      const current = await this.store.document(doc.id); if (!current?.file) return;
      const file = current.file, audio = await this.store.audio(doc.id);
      URL.revokeObjectURL(this.audioUrl()); this.audioUrl.set(audio ? URL.createObjectURL(audio) : '');
      this.file.set(audio ? new File([audio], file.name, {type: audio.type}) : null);
      this.reset(); this.storedFileId.set(doc.id); this.storedName.set(file.name);
      this.voskText.set(file.vosk.text); this.voskWords.set(file.vosk.words); this.voskError.set(file.vosk.error ?? '');
      this.whisper.set(file.whisper); this.whisperError.set(file.whisperError ?? ''); this.finalText.set(file.final.text); this.finalSource.set(file.final.source);
      this.voskStatus.set('Gespeichertes Ergebnis'); this.whisperStatus.set(file.whisperError ? 'Fehlgeschlagen · gespeicherte Vorschau' : 'Gespeichertes Ergebnis');
      this.saveStatus.set('Aus der Bibliothek geöffnet · Änderungen werden automatisch gespeichert.'); this.error.set(''); this.mode.set('file');
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.libraryBusy.set(false); }
  }
  async documentChanged(id: string) {
    this.libraryChanged(); await this.live()?.refreshAudio();
    if (this.live()?.session()?.id === id) {
      await this.openStore();
      if (!await this.store.document(id)) await this.live()?.newSession();
    }
    if (this.storedFileId() === id) {
      await this.openStore();
      const doc = await this.store.document(id);
      if (!doc) {
        this.storedFileId.set(null); this.storedName.set(''); this.file.set(null); this.reset(); this.saveStatus.set('');
        URL.revokeObjectURL(this.audioUrl()); this.audioUrl.set('');
      } else if (!await this.store.audio(id)) {
        this.file.set(null); URL.revokeObjectURL(this.audioUrl()); this.audioUrl.set('');
        this.saveStatus.set('Transkript gespeichert · Originalaufnahme gelöscht.');
      }
    }
  }

  download(json = false) {
    const data = json ? JSON.stringify({file: this.file()?.name ?? this.storedName(), vosk: {text: this.voskText(), words: this.voskWords(), error: this.voskError() || null},
      whisper: this.whisper(), whisperError: this.whisperError() || null, final: {text: this.finalText(), source: this.finalSource()}}, null, 2) : this.finalText();
    const url = URL.createObjectURL(new Blob([data], {type: json ? 'application/json' : 'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url;
    a.download = `${(this.file()?.name ?? this.storedName()).replace(/\.[^.]+$/, '') || 'transkript'}.${json ? 'json' : 'txt'}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  time(seconds: number) { return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
  message(error: unknown) { return error instanceof Error ? error.message : 'Ein unerwarteter Fehler ist aufgetreten.'; }
  ngOnDestroy() { window.removeEventListener('beforeunload', this.unload); URL.revokeObjectURL(this.audioUrl()); void this.fileSaves.finally(() => this.store.close()); }
}
