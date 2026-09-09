import type { LiveVosk } from './live-vosk';
import { VoskWord } from './types';
import { acquireAudio, CaptureOptions, connectAudio, defaultCapture } from './audio-sources';

export class MicrophoneCapture {
  private context?: AudioContext;
  private streams: MediaStream[] = [];
  private node?: AudioWorkletNode;
  private inputs: AudioNode[] = [];
  private vosk?: LiveVosk;
  private abort = new AbortController();
  private active = false;
  private stopping = false;
  private resolveFlush?: () => void;
  private stopPromise?: Promise<void>;

  constructor(private samples: (samples: Float32Array) => void,
              private preview: (text: string, partial: string, words: VoskWord[]) => void,
              private warning: (text: string) => void,
              private interrupted: (text: string) => void) {}

  async start(withVosk: boolean, options: CaptureOptions = defaultCapture) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Audioaufnahme benötigt localhost oder HTTPS und einen unterstützten Browser.');
    this.context = new AudioContext({sampleRate: 16000});
    if (!this.context.audioWorklet || this.context.sampleRate !== 16000) throw new Error('Dieser Browser unterstützt die benötigte Audioaufnahme mit 16 kHz nicht.');
    // getDisplayMedia must run before awaiting resume(), while the click is active.
    const acquisition = acquireAudio(options, this.abort.signal);
    try {
      const [streams] = await Promise.all([acquisition, this.context.resume()]);
      this.streams = streams;
    } catch (error) {
      this.abort.abort();
      void acquisition.then(streams => streams.forEach(s => s.getTracks().forEach(t => t.stop()))).catch(() => {});
      throw error;
    }
    if (this.abort.signal.aborted) { this.stopInputs(); throw new DOMException('Abgebrochen', 'AbortError'); }
    // Also watch the video track: ending the sharing UI ends this recording.
    for (const stream of this.streams) for (const track of stream.getTracks()) {
      track.onended = () => { if (!this.stopping) this.interrupted('Eine Audioquelle oder die Freigabe wurde beendet. Die Aufnahme wird gesichert.'); };
      track.onmute = () => { if (!this.stopping && track.kind === 'audio') this.interrupted('Eine Audioquelle wurde stummgeschaltet oder unterbrochen. Die Aufnahme wird gesichert.'); };
    }
    await this.context.audioWorklet.addModule('/audio-capture.js');
    if (withVosk) {
      try {
        const { LiveVosk } = await import('./live-vosk');
        if (this.abort.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
        this.vosk = new LiveVosk(this.preview, this.warning);
        await this.vosk.load(this.abort.signal);
      } catch (error) {
        this.vosk?.dispose(); this.vosk = undefined;
        if (this.abort.signal.aborted) throw error;
        this.warning(error instanceof Error ? error.message : 'Vosk nicht verfügbar. Whisper läuft weiter.');
      }
    }
    if (this.abort.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    this.node = new AudioWorkletNode(this.context, 'pcm-capture');
    this.node.port.onmessage = ({data}) => {
      if (data.type === 'audio') { this.samples(data.samples); this.vosk?.accept(data.samples); }
      if (data.type === 'stopped') this.resolveFlush?.();
    };
    this.node.onprocessorerror = () => this.interrupted('Audioverarbeitung unterbrochen. Die Aufnahme wird beendet.');
    if (this.streams.some(s => s.getTracks().some(t => t.readyState === 'ended'))) throw new Error('Audioquelle nicht mehr verfügbar. Bitte neu starten.');
    this.inputs = connectAudio(this.context, this.streams, this.node);
    this.node.connect(this.context.destination);
    this.active = true;
    this.context.onstatechange = () => {
      if (this.active && !this.stopping && this.context?.state !== 'running') this.interrupted('Der Browser hat die Audioaufnahme unterbrochen. Der vorhandene Abschnitt wird gesichert.');
    };
  }
  private stopInputs() { this.streams.forEach(s => s.getTracks().forEach(t => t.stop())); }
  stop(): Promise<void> {
    return this.stopPromise ??= this.stopInternal();
  }
  private async stopInternal() {
    this.stopping = true; this.abort.abort();
    // Stop the hardware immediately, but drain already captured worklet messages first.
    this.stopInputs();
    if (this.node) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.warning('Der letzte Audio-Puffer konnte nicht vollständig bestätigt werden. Bitte das Ende prüfen.'); resolve(); }, 2000);
        this.resolveFlush = () => { clearTimeout(timer); resolve(); };
        this.node!.port.postMessage('stop');
      });
    }
    this.active = false; this.inputs.forEach(n => n.disconnect()); this.inputs = []; this.node?.disconnect(); this.node?.port.close();
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
  async finishPreview() {
    if (!this.vosk) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.vosk.finish(), new Promise<void>(resolve => {
      timer = setTimeout(() => {
        this.warning('Vosk konnte die letzten Wörter nicht rechtzeitig abschließen. Whisper erhält das vollständige Audio.');
        this.vosk?.dispose(); resolve();
      }, 15000);
    })]);
    clearTimeout(timer);
  }
  disposePreview() {
    this.vosk?.dispose();
  }
}
