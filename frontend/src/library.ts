import { Component, OnDestroy, computed, effect, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LiveStore } from './live-store';
import { AudioInfo, bytes, documentText, Folder, LibraryData, Retention, reviewBlocker, TranscriptDocument } from './library-core';

@Component({selector: 'app-library', standalone: true, imports: [FormsModule, DatePipe], templateUrl: './library.html', styleUrl: './library.css'})
export class LibraryComponent implements OnDestroy {
  canRecord = input(false); newRecording = output<void>();
  enabled = input(false); visible = input(false); revision = input(0); locked = input(false);
  prepare = input<(id: string) => Promise<void>>(async () => {});
  openDocument = output<TranscriptDocument>(); changed = output<string>(); activity = output<boolean>();
  data = signal<LibraryData>({documents: [], folders: [], chunks: [], audio: []});
  selectedId = signal(''); folder = signal('all'); search = signal(''); status = signal('all');
  error = signal(''); notice = signal(''); busy = signal(false);
  estimate = signal<StorageEstimate | null>(null); persistent = signal<boolean | null>(null);
  player = signal<{url: string; id: string} | null>(null);
  newFolder = ''; title = ''; folderName = '';
  private store = new LiveStore(); private opened?: Promise<void>; private destroyed = false;
  selected = computed(() => this.data().documents.find(d => d.id === this.selectedId()));
  audioBytes = computed(() => this.data().audio.reduce((sum, a) => sum + a.bytes, 0));
  folders = computed(() => [...this.data().folders].sort((a, b) => a.name.localeCompare(b.name, 'de')));
  documents = computed(() => {
    const query = this.search().trim().toLocaleLowerCase('de');
    return this.data().documents.filter(d => (this.folder() === 'all' || (this.folder() === 'none' ? !d.folderId : d.folderId === this.folder()))
      && (this.status() === 'all' || (this.status() === 'approved' ? !!d.approvedAt : this.status() === 'pending' ? !!reviewBlocker(d, this.data().chunks) : !d.approvedAt))
      && (!query || `${d.title}\n${this.text(d)}`.toLocaleLowerCase('de').includes(query)))
      .sort((a, b) => b.updated.localeCompare(a.updated));
  });
  constructor() {
    effect(() => {
      const enabled = this.enabled(), visible = this.visible(); this.revision();
      if (enabled && visible) void this.refresh();
    });
  }
  async refresh() {
    try {
      await (this.opened ??= this.store.open());
      const data = await this.store.library(); if (this.destroyed) return;
      this.data.set(data);
      if (this.selectedId() && !this.selected()) this.selectedId.set('');
      if (this.folder() !== 'all' && this.folder() !== 'none' && !data.folders.some(f => f.id === this.folder())) this.folder.set('all');
      const [estimate, persistent] = await Promise.all([
        navigator.storage?.estimate?.().catch(() => null) ?? null,
        navigator.storage?.persisted?.().catch(() => null) ?? null,
      ]);
      this.estimate.set(estimate); this.persistent.set(persistent);
    } catch (error) { this.error.set(this.message(error)); }
  }
  choose(doc: TranscriptDocument) { this.closePlayer(); this.selectedId.set(doc.id); this.title = doc.title; this.error.set(''); this.notice.set(''); }
  chooseFolder(id: string) { this.folder.set(id); this.selectedId.set(''); this.closePlayer(); this.folderName = this.folders().find(f => f.id === id)?.name ?? ''; }
  private async run(work: () => Promise<void>, id = '', message = '') {
    if (this.busy() || this.locked() || !this.enabled()) return;
    this.busy.set(true); this.activity.emit(true); this.error.set(''); this.notice.set('');
    try { await this.prepare()(id); await work(); this.changed.emit(id); await this.refresh(); this.notice.set(message); }
    catch (error) { this.error.set(this.message(error)); }
    finally { this.busy.set(false); this.activity.emit(false); }
  }
  addFolder() {
    const folder: Folder = {id: crypto.randomUUID(), name: this.newFolder};
    void this.run(async () => { await this.store.saveFolder(folder); this.newFolder = ''; this.chooseFolder(folder.id); this.folderName = folder.name.trim(); });
  }
  renameFolder() { void this.run(() => this.store.saveFolder({id: this.folder(), name: this.folderName})); }
  removeFolder() {
    if (!window.confirm('Ordner entfernen? Seine Transkripte bleiben unter „Ohne Ordner“ erhalten.')) return;
    void this.run(() => this.store.deleteFolder(this.folder()));
  }
  rename(doc: TranscriptDocument) { void this.run(() => this.store.updateDocument(doc.id, {title: this.title}), doc.id); }
  move(doc: TranscriptDocument, folderId: string | null) { void this.run(() => this.store.updateDocument(doc.id, {folderId}), doc.id); }
  retention(doc: TranscriptDocument, retention: Retention) {
    if (doc.approvedAt && retention === 'after-review' && this.size(doc.id)
      && !window.confirm('Dieses Transkript ist bereits freigegeben. Gespeicherte Originalaufnahmen jetzt endgültig löschen?')) return;
    void this.run(async () => { this.closePlayer(); await this.store.updateDocument(doc.id, {retention}); }, doc.id);
  }
  approve(doc: TranscriptDocument) {
    const message = doc.retention === 'keep' ? 'Text als geprüft freigeben? Die Originalaufnahmen bleiben gespeichert.'
      : 'Text als geprüft freigeben und gespeicherte Originalaufnahmen endgültig löschen? Texte und Modellwerte bleiben erhalten.';
    if (!window.confirm(message)) return;
    void this.run(async () => { this.closePlayer(); await this.store.approve(doc.id); }, doc.id, 'Transkript freigegeben.');
  }
  removeAudio(doc: TranscriptDocument) {
    if (!window.confirm('Gespeicherte Originalaufnahmen endgültig löschen? Texte und Modellwerte bleiben erhalten.')) return;
    void this.run(async () => { this.closePlayer(); await this.store.deleteAudio(doc.id); }, doc.id, 'Gespeicherte Originalaufnahmen gelöscht.');
  }
  remove(doc: TranscriptDocument) {
    if (!window.confirm(`„${doc.title}“ mit allen Texten und gespeicherten Aufnahmen endgültig löschen?`)) return;
    void this.run(async () => { this.closePlayer(); await this.store.deleteDocument(doc.id); }, doc.id, 'Transkript gelöscht.');
  }
  async persist() {
    try {
      if (!navigator.storage?.persist) throw new Error('Dieser Browser unterstützt diese Speicheranfrage nicht.');
      const granted = await navigator.storage.persist(); this.persistent.set(granted);
      this.notice.set(granted ? 'Der Browser schützt diesen Speicher vor automatischer Verdrängung. Exporte bleiben als Sicherung sinnvoll.' : 'Der Browser hat keinen dauerhaften Speicherschutz erteilt. Bitte wichtige Transkripte exportieren.');
    } catch (error) { this.error.set(this.message(error)); }
  }
  async play(audio: AudioInfo) {
    try {
      this.closePlayer(); const blob = await this.store.audio(audio.id);
      if (!blob) throw new Error('Die Aufnahme ist nicht mehr gespeichert.');
      this.player.set({url: URL.createObjectURL(blob), id: audio.id});
    } catch (error) { this.error.set(this.message(error)); }
  }
  async downloadAudio(audio: AudioInfo) {
    try { const blob = await this.store.audio(audio.id); if (!blob) throw new Error('Audio nicht mehr vorhanden.'); this.download(blob, audio.name); }
    catch (error) { this.error.set(this.message(error)); }
  }
  export(doc: TranscriptDocument, json = false) {
    const text = this.text(doc);
    const content = json ? JSON.stringify({version: 1, document: doc, chunks: this.data().chunks.filter(c => c.sessionId === doc.id), text}, null, 2) : text;
    this.download(new Blob([content], {type: json ? 'application/json' : 'text/plain;charset=utf-8'}), `${doc.title.replace(/[\\/:*?"<>|]/g, '-')}.${json ? 'json' : 'txt'}`);
  }
  private download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private closePlayer() { const player = this.player(); if (player) URL.revokeObjectURL(player.url); this.player.set(null); }
  text(doc: TranscriptDocument) { return documentText(doc, this.data().chunks); }
  blocker(doc: TranscriptDocument) { return reviewBlocker(doc, this.data().chunks); }
  size(id: string) { return this.data().audio.filter(a => a.documentId === id).reduce((sum, a) => sum + a.bytes, 0); }
  audio(id: string) { return this.data().audio.filter(a => a.documentId === id); }
  count(id: string | null) { return this.data().documents.filter(d => d.folderId === id).length; }
  folderLabel(doc: TranscriptDocument) { return this.folders().find(f => f.id === doc.folderId)?.name ?? 'Ohne Ordner'; }
  bytes = bytes;
  private message(error: unknown) { return error instanceof Error ? error.message : 'Lokale Bibliothek konnte nicht gespeichert werden.'; }
  ngOnDestroy() { this.destroyed = true; this.closePlayer(); void this.opened?.finally(() => this.store.close()); }
}
