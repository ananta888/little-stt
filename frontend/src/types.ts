export interface Word { word: string; start: number; end: number; probability: number; }
export interface VoskWord { word: string; start: number; end: number; conf: number; }
export interface Segment {
  start: number; end: number; text: string; avg_logprob: number;
  no_speech_prob: number; compression_ratio: number; temperature: number; words: Word[];
}
export interface Transcript {
  text: string; segments: Segment[]; language: string;
  language_probability: number; duration: number; model: string;
}

export async function checked(response: Response): Promise<Response> {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.detail === 'string' ? data.detail : `Anfrage fehlgeschlagen (${response.status}).`);
  }
  return response;
}
