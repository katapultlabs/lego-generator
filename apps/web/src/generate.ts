// Client for the photo -> 3D endpoints served by server/api.ts.
//
//   POST /api/generate     multipart: image, subject?, model?  ->  NDJSON stream of
//                          {"type":"log","message"} ... {"type":"done","generation"} | {"type":"error","message"}
//   GET  /api/generations  ->  Generation[] (newest first)

import type { Generation } from './types';

export type GenModelId = 'trellis-2' | 'hunyuan-3.1';

export const GEN_MODELS: { id: GenModelId; label: string; price: string; note: string }[] = [
  { id: 'trellis-2', label: 'TRELLIS.2', price: '~$0.30', note: 'faster' },
  { id: 'hunyuan-3.1', label: 'Hunyuan3D 3.1', price: '~$0.38', note: 'more detail' },
];

export const SUBJECT_SUGGESTIONS = ['bird', 'car', 'motorcycle', 'bicycle', 'house', 'dog', 'cat', 'toy'];

export function modelLabel(id: string): string {
  return GEN_MODELS.find((m) => m.id === id)?.label ?? id;
}

export async function generateFromPhoto(
  file: File,
  opts: { subject: string; model: GenModelId },
  onLog: (message: string) => void,
): Promise<Generation> {
  const form = new FormData();
  form.append('image', file, file.name || 'photo');
  form.append('subject', opts.subject.trim());
  form.append('model', opts.model);

  let res: Response;
  try {
    res = await fetch('/api/generate', { method: 'POST', body: form });
  } catch (err) {
    throw new Error(`Could not reach the generation service (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!res.ok) throw new Error(await describeFailure(res));
  if (!res.body) throw new Error('The generation service did not stream a response.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: Generation | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let msg: { type?: string; message?: string; generation?: Generation };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === 'log' && msg.message) onLog(msg.message);
    else if (msg.type === 'error') throw new Error(msg.message || 'Generation failed.');
    else if (msg.type === 'done' && msg.generation) result = msg.generation;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
    if (done) break;
  }
  handleLine(buffer);

  if (!result) throw new Error('The connection closed before the model was ready. Check the dev server log.');
  return result;
}

export async function fetchGenerations(): Promise<Generation[]> {
  const res = await fetch('/api/generations');
  if (!res.ok) throw new Error(`Could not list generations (HTTP ${res.status}).`);
  return (await res.json()) as Generation[];
}

export async function fetchGlb(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the 3D model (HTTP ${res.status}).`);
  return res.arrayBuffer();
}

async function describeFailure(res: Response): Promise<string> {
  let detail = '';
  try {
    detail = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 240);
  } catch {
    /* ignore */
  }
  if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
    return `The generation service is not available (HTTP ${res.status}).${detail ? ' ' + detail : ''}`;
  }
  if (res.status === 413) return 'That photo is too large. Try a smaller image.';
  return `Generation failed (HTTP ${res.status}).${detail ? ' ' + detail : ''}`;
}
