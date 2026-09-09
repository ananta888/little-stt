import type { LiveVosk } from './live-vosk';
import { VoskWord } from './types';

export class MicrophoneCapture {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
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

  async start(withVosk: boolean) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofonzugriff benötigt localhost oder HTTPS und einen unterstützten Browser.');
    this.context = new AudioContext({sampleRate: 16000});
    if (!this.context.audioWorklet || this.context.sampleRate !== 16000) throw new Error('Dieser Browser unterstützt die benötigte Audioaufnahme mit 16 kHz nicht.');
    await this.context.resume();
    const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}, video: false});
    if (this.abort.signal.aborted) { stream.getTracks().forEach(t => t.stop()); throw new DOMException('Abgebrochen', 'AbortError'); }
    this.stream = stream;
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
    this.source = this.context.createMediaStreamSource(stream);
    this.source.connect(this.node); this.node.connect(this.context.destination);
    this.active = true;
    for (const track of stream.getAudioTracks()) {
      track.onended = () => { if (!this.stopping) this.interrupted('Das Mikrofon wurde getrennt. Die Aufnahme wird beendet.'); };
      track.onmute = () => { if (!this.stopping) this.interrupted('Das Mikrofon wurde stummgeschaltet oder unterbrochen. Bitte eine neue Aufnahme starten.'); };
    }
    this.context.onstatechange = () => {
      if (this.active && !this.stopping && this.context?.state !== 'running') this.interrupted('Der Browser hat die Audioaufnahme unterbrochen. Der vorhandene Abschnitt wird gesichert.');
    };
  }
  stop(): Promise<void> {
    return this.stopPromise ??= this.stopInternal();
  }
  private async stopInternal() {
    this.stopping = true; this.abort.abort();
    // Stop the hardware immediately, but drain already captured worklet messages first.
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.node) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.warning('Der letzte Audio-Puffer konnte nicht vollständig bestätigt werden. Bitte das Ende prüfen.'); resolve(); }, 2000);
        this.resolveFlush = () => { clearTimeout(timer); resolve(); };
        this.node!.port.postMessage('stop');
      });
    }
    this.active = false; this.source?.disconnect(); this.node?.disconnect(); this.node?.port.close();
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
