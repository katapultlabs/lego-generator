// Photo -> cutout -> textured GLB on fal.ai.
//
// Image-to-3D models treat everything in the frame as the object, so a bird on a branch in
// front of foliage comes back as a painted slab. We cut the subject out first: SAM 3 with a
// text prompt when we know what the subject is, BiRefNet (most salient object) otherwise.

import { execFileSync } from 'node:child_process';
import { fal } from '@fal-ai/client';

/** FAL_KEY from the environment, else the macOS Keychain item `lego-generator-fal` (see README). */
export function falKey(): string | undefined {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  if (process.platform !== 'darwin') return undefined;
  try {
    const args = ['find-generic-password', '-s', 'lego-generator-fal', '-a', 'FAL_KEY', '-w'];
    return execFileSync('security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const key = falKey();
if (key) fal.config({ credentials: key });

export const MODELS = {
  'trellis-2': { endpoint: 'fal-ai/trellis-2', label: 'TRELLIS.2', approxUsd: 0.3 },
  'hunyuan-3.1': { endpoint: 'fal-ai/hunyuan-3d/v3.1/pro/image-to-3d', label: 'Hunyuan3D 3.1', approxUsd: 0.375 },
} as const;
export type ModelId = keyof typeof MODELS;

export interface GenerateOptions {
  /** What to cut out of the photo ("bird", "car"); empty = most salient object. */
  subject?: string;
  model?: ModelId;
  resolution?: '512' | '1024' | '1536';
  seed?: number;
  onLog?: (message: string) => void;
}

export interface GenerateResult {
  glb: ArrayBuffer;
  glbUrl: string;
  /** Transparent PNG of the subject that was sent to the 3D model. */
  cutout: ArrayBuffer;
  cutoutUrl: string;
  model: ModelId;
  segmenter: 'sam-3' | 'birefnet';
  requestId: string;
  seconds: number;
}

type ImageOut = { url: string };

async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

/** Run a fal endpoint, logging status transitions instead of every poll. */
async function run<T>(endpoint: string, input: Record<string, unknown>, log: (m: string) => void, busy: string) {
  let last = '';
  const result = await fal.subscribe(endpoint, {
    input,
    logs: true,
    onQueueUpdate: (u) => {
      if (u.status === last) return;
      last = u.status;
      log(u.status === 'IN_QUEUE' ? 'waiting for a GPU' : u.status === 'IN_PROGRESS' ? busy : 'finishing');
    },
  });
  return { data: result.data as T, requestId: result.requestId };
}

export async function cutout(imageUrl: string, subject: string | undefined, log: (m: string) => void) {
  if (subject?.trim()) {
    log(`finding "${subject}" in the photo`);
    const { data } = await run<{ image?: ImageOut; masks: ImageOut[]; scores?: number[] }>(
      'fal-ai/sam-3/image',
      { image_url: imageUrl, prompt: subject.trim(), apply_mask: true, include_scores: true, output_format: 'png' },
      log,
      'segmenting',
    );
    const score = data.scores?.[0] ?? 0;
    if (data.image?.url && data.masks.length && score > 0.3) {
      log(`found it (confidence ${score.toFixed(2)})`);
      return { url: data.image.url, segmenter: 'sam-3' as const };
    }
    log(`could not find "${subject}"; falling back to automatic cutout`);
  }
  log('cutting out the main subject');
  const { data } = await run<{ image: ImageOut }>(
    'fal-ai/birefnet/v2',
    { image_url: imageUrl, model: 'General Use (Heavy)', operating_resolution: '1024x1024', output_format: 'png' },
    log,
    'removing background',
  );
  return { url: data.image.url, segmenter: 'birefnet' as const };
}

export async function generateGlb(image: Blob, opts: GenerateOptions = {}): Promise<GenerateResult> {
  if (!key) throw new Error('No fal.ai key: set FAL_KEY or add the Keychain item (see README).');
  const log = opts.onLog ?? (() => {});
  const model = opts.model ?? 'trellis-2';
  const started = Date.now();

  log('uploading photo');
  const photoUrl = await fal.storage.upload(image);
  const cut = await cutout(photoUrl, opts.subject, log);

  const { endpoint, label } = MODELS[model];
  const input: Record<string, unknown> =
    model === 'trellis-2'
      ? {
          image_url: cut.url,
          resolution: opts.resolution ?? '1024',
          seed: opts.seed,
          decimation_target: 100_000,
          texture_size: '1024',
        }
      : { input_image_url: cut.url, generate_type: 'Normal' };
  const { data, requestId } = await run<{ model_glb: { url: string } }>(endpoint, input, log, `building 3D model with ${label}`);

  log('downloading model');
  const [glb, cutoutBytes] = await Promise.all([download(data.model_glb.url), download(cut.url)]);
  return {
    glb,
    glbUrl: data.model_glb.url,
    cutout: cutoutBytes,
    cutoutUrl: cut.url,
    model,
    segmenter: cut.segmenter,
    requestId,
    seconds: (Date.now() - started) / 1000,
  };
}
