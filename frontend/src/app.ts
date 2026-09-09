import { Component, OnDestroy, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { checked, Transcript, VoskWord } from './types';
import { LiveComponent } from './live';

@Component({
  selector: 'app-root', standalone: true, imports: [FormsModule, DecimalPipe, LiveComponent],
  templateUrl: './app.html',
})
export class AppComponent implements OnDestroy {
  mode = signal<'file' | 'live'>('file');
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
    if (file && !this.busy() && !this.merging()) this.setFile(file);
  }

  setFile(file: File) {
    this.error.set('');
    if (!file.size || file.size > 100 * 1024 * 1024) {
      this.error.set('Bitte eine nicht leere Datei mit maximal 100 MB wählen.'); return;
    }
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
    if (!file || this.busy() || this.merging()) return;
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
  }

  download(json = false) {
    const data = json ? JSON.stringify({file: this.file()?.name, vosk: {text: this.voskText(), words: this.voskWords(), error: this.voskError() || null},
      whisper: this.whisper(), final: {text: this.finalText(), source: this.finalSource()}}, null, 2) : this.finalText();
    const url = URL.createObjectURL(new Blob([data], {type: json ? 'application/json' : 'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url;
    a.download = `${this.file()?.name.replace(/\.[^.]+$/, '') || 'transkript'}.${json ? 'json' : 'txt'}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  time(seconds: number) { return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
  message(error: unknown) { return error instanceof Error ? error.message : 'Ein unerwarteter Fehler ist aufgetreten.'; }
  ngOnDestroy() { URL.revokeObjectURL(this.audioUrl()); }
}
