import { Model } from 'vosk-browser';
import { checked, VoskWord } from './types';

export async function preview(file: File, update: (text: string, words: VoskWord[], progress: number) => void,
                              status: (text: string) => void): Promise<{text: string; words: VoskWord[]}> {
  status('Audio im Browser lesen …');
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    try {
      decoded = await context.decodeAudioData(await file.arrayBuffer());
    } catch {
      status('Format wird im Backend zu WAV konvertiert …');
      const body = new FormData(); body.append('file', file);
      const response = await checked(await fetch('/api/audio/wav', {method: 'POST', body}));
      decoded = await context.decodeAudioData(await response.arrayBuffer());
    }
  } finally { await context.close(); }
  if (decoded.duration > 900) throw new Error('Maximal 15 Minuten pro Datei.');
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource(); source.buffer = decoded;
  source.connect(offline.destination); source.start();
  const mono = (await offline.startRendering()).getChannelData(0);
  status('Deutsches Vosk-Modell laden …');
  const url = new URL('/models/vosk-de.tar.gz', location.href).href;
  const head = await fetch(url, {method: 'HEAD'});
  if (!head.ok || head.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Vosk-Modell fehlt. Bitte python3 scripts/download_vosk.py ausführen.');
  }
  const model = new Model(url, -1);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Vosk-Modell konnte nicht rechtzeitig geladen werden.')), 120000);
      model.on('load', message => { clearTimeout(timer); message.event === 'load' && message.result ? resolve() : reject(new Error('Vosk-Modell konnte nicht geladen werden.')); });
      model.on('error', () => { clearTimeout(timer); reject(new Error('Vosk-Modell konnte nicht geladen werden.')); });
    });
    status('Vorschau entsteht im Browser …');
    const recognizer = new model.KaldiRecognizer(16000);
    recognizer.setWords(true);
    const words: VoskWord[] = [];
    let text = '', offset = 0, finishing = false;
    return await new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const send = () => {
        clearTimeout(timer);
        timer = setTimeout(() => reject(new Error('Vosk antwortet nicht mehr. Bitte erneut versuchen.')), 60000);
        if (offset >= mono.length) { finishing = true; recognizer.retrieveFinalResult(); }
        else {
          const end = Math.min(offset + 16000, mono.length);
          recognizer.acceptWaveformFloat(mono.subarray(offset, end), 16000);
          offset = end;
        }
      };
      recognizer.on('error', () => { clearTimeout(timer); reject(new Error('Vosk konnte die Aufnahme nicht verarbeiten.')); });
      recognizer.on('result', message => {
        if (message.event !== 'result') return;
        if (message.result.text) text = [text, message.result.text].filter(Boolean).join(' ');
        words.push(...(message.result.result ?? []));
        update(text, [...words], Math.round(offset / mono.length * 100));
        if (finishing) { clearTimeout(timer); recognizer.remove(); resolve({text, words}); }
        else send();
      });
      recognizer.on('partialresult', message => {
        if (message.event !== 'partialresult') return;
        update([text, message.result.partial].filter(Boolean).join(' '), [...words], Math.round(offset / mono.length * 100));
        send();
      });
      send();
    });
  } finally { model.terminate(); }
}
