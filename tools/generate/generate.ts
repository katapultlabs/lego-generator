// Photo -> textured GLB via TRELLIS.2 on fal.ai. Needs FAL_KEY in the environment (see .env.example).

import { fal } from '@fal-ai/client';

export const ENDPOINT = 'fal-ai/trellis-2';

export interface GenerateOptions {
  resolution?: '512' | '1024' | '1536';
  seed?: number;
  /** Target vertex count; the brick engine only needs coarse geometry. */
  decimationTarget?: number;
  onLog?: (message: string) => void;
}

export interface GenerateResult {
  glb: ArrayBuffer;
  glbUrl: string;
  requestId: string;
  seconds: number;
}

export async function generateGlb(image: Blob, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const log = opts.onLog ?? (() => {});
  const started = Date.now();
  log('uploading photo');
  const imageUrl = await fal.storage.upload(image);
  log('queued on fal.ai');
  let lastStatus = '';
  const result = await fal.subscribe(ENDPOINT, {
    input: {
      image_url: imageUrl,
      resolution: opts.resolution ?? '1024',
      seed: opts.seed,
      decimation_target: opts.decimationTarget ?? 100_000,
      texture_size: '1024',
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status !== lastStatus) {
        lastStatus = update.status;
        log(update.status === 'IN_QUEUE' ? 'waiting for a GPU' : update.status === 'IN_PROGRESS' ? 'generating 3D model' : 'finishing');
      }
    },
  });
  const glbUrl: string = (result.data as { model_glb: { url: string } }).model_glb.url;
  log('downloading model');
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  return { glb: await res.arrayBuffer(), glbUrl, requestId: result.requestId, seconds: (Date.now() - started) / 1000 };
}
