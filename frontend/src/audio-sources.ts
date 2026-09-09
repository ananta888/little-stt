export type AudioSource = 'microphone' | 'tab' | 'system' | 'input';
export interface CaptureOptions {
  source: AudioSource; includeMicrophone: boolean; microphoneId?: string; inputId?: string;
}
export const sourceLabel = (source: AudioSource) => ({microphone: 'Mikrofon', tab: 'Browser-Tab', system: 'Systemton / Bildschirm', input: 'Loopback-Audioeingang'})[source];
export const defaultCapture: CaptureOptions = {source: 'microphone', includeMicrophone: false};

/** Start the display picker synchronously inside the user's click, before any await. */
export async function acquireAudio(options: CaptureOptions, signal: AbortSignal): Promise<MediaStream[]> {
  const streams: MediaStream[] = [];
  const stop = () => streams.forEach(s => s.getTracks().forEach(t => t.stop()));
  const cancelled = () => { if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError'); };
  const accept = async (promise: Promise<MediaStream>) => {
    const stream = await promise; streams.push(stream); cancelled();
    if (!stream.getAudioTracks().some(t => t.readyState === 'live')) throw new Error('Die gewählte Quelle liefert keinen Ton. Im Freigabedialog „Audio teilen“ aktivieren oder einen Loopback-Audioeingang wählen.');
    return stream;
  };
  const mic = () => navigator.mediaDevices.getUserMedia({video: false, audio: {
    ...(options.microphoneId ? {deviceId: {exact: options.microphoneId}} : {}),
    channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  }});
  signal.addEventListener('abort', stop, {once: true});
  try {
    cancelled();
    if (options.source === 'microphone') await accept(mic());
    else {
      if (options.source === 'input') {
        if (!options.inputId) throw new Error('Bitte zuerst Audioeingänge laden und den Loopback-Eingang auswählen.');
        if (options.includeMicrophone && !options.microphoneId) throw new Error('Bitte für die Mischung ein separates Mikrofon auswählen.');
        await accept(navigator.mediaDevices.getUserMedia({video: false, audio: {
          deviceId: {exact: options.inputId}, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        }}));
      } else {
        if (!navigator.mediaDevices.getDisplayMedia) throw new Error('Dieser Browser bietet keine Tonfreigabe an. Einen unterstützten Browser oder „Loopback-Audioeingang“ verwenden.');
        const request = {video: {displaySurface: options.source === 'tab' ? 'browser' : 'monitor'},
          audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false}, selfBrowserSurface: 'exclude',
          systemAudio: options.source === 'system' ? 'include' : 'exclude',
          surfaceSwitching: 'exclude'};
        const shared = await accept(navigator.mediaDevices.getDisplayMedia(request));
        const surface = shared.getVideoTracks()[0]?.getSettings().displaySurface;
        if (options.source === 'tab' && surface && surface !== 'browser') throw new Error('Für „Browser-Tab“ bitte einen Tab auswählen. Für den gesamten Laptop-Ton „Systemton / Bildschirm“ wählen.');
        if (options.source === 'system' && surface && surface !== 'monitor') throw new Error('Für Systemton bitte „Gesamter Bildschirm“ mit Audio auswählen. Tab- oder Fensterton ist nicht der gesamte Laptop-Ton.');
      }
      cancelled();
      if (options.includeMicrophone) {
        const microphone = await accept(mic());
        const firstId = streams[0].getAudioTracks()[0].getSettings().deviceId;
        if (firstId && firstId === microphone.getAudioTracks()[0].getSettings().deviceId) throw new Error('Audioeingang und zusätzliches Mikrofon sind dasselbe Gerät. Bitte unterschiedliche Eingänge wählen.');
      }
    }
    cancelled();
    if (streams.some(s => s.getTracks().some(t => t.readyState === 'ended'))) throw new Error('Die Audiofreigabe wurde während der Vorbereitung beendet. Bitte neu starten.');
    return streams;
  } catch (error) { stop(); signal.removeEventListener('abort', stop); throw error; }
}

/** Audio only. Both sources share the context clock, and the worklet emits silence. */
export function connectAudio(context: AudioContext, streams: MediaStream[], destination: AudioNode): AudioNode[] {
  const nodes: AudioNode[] = [];
  try {
    for (const stream of streams) {
      const source = context.createMediaStreamSource(new MediaStream([stream.getAudioTracks()[0]]));
      const gain = context.createGain(); gain.gain.value = 1 / streams.length;
      nodes.push(source, gain); source.connect(gain); gain.connect(destination);
    }
    return nodes;
  } catch (error) { nodes.forEach(n => n.disconnect()); throw error; }
}
