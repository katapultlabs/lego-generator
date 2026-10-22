// Client for the photo -> GLB endpoint (server side is implemented elsewhere).
//
//   POST /api/generate   multipart/form-data, field "image" = the photo
//   200  -> model/gltf-binary body (raw GLB bytes)
//        or application/json { glbUrl | url: string } pointing at a GLB, or { glb: <base64> }
//   !200 -> text or JSON { error | message } describing the failure

const SLOW_HINT_MS = 8000;

export async function generateFromPhoto(file: File, onProgress?: (msg: string) => void): Promise<ArrayBuffer> {
  const say = (m: string) => onProgress?.(m);
  const form = new FormData();
  form.append('image', file, file.name || 'photo');

  say('Uploading photo...');
  const slowTimer = setTimeout(() => say('Building a 3D model from your photo (this can take a minute)...'), SLOW_HINT_MS);

  let res: Response;
  try {
    res = await fetch('/api/generate', { method: 'POST', body: form });
  } catch (err) {
    clearTimeout(slowTimer);
    throw new Error(`Could not reach the generation service (${err instanceof Error ? err.message : String(err)}).`);
  }
  clearTimeout(slowTimer);

  if (!res.ok) throw new Error(await describeFailure(res));

  say('Downloading 3D model...');
  const type = (res.headers.get('content-type') ?? '').toLowerCase();

  if (type.includes('application/json')) {
    const body = (await res.json()) as { glbUrl?: string; url?: string; glb?: string; error?: string };
    if (body.error) throw new Error(body.error);
    const link = body.glbUrl ?? body.url;
    if (link) {
      const r2 = await fetch(link);
      if (!r2.ok) throw new Error(`Could not download the generated model (HTTP ${r2.status}).`);
      return assertGlb(await r2.arrayBuffer());
    }
    if (body.glb) {
      const bin = atob(body.glb);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return assertGlb(bytes.buffer);
    }
    throw new Error('The generation service returned JSON without a model.');
  }

  return assertGlb(await res.arrayBuffer());
}

function assertGlb(buf: ArrayBuffer): ArrayBuffer {
  const m = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (m.length < 4 || m[0] !== 0x67 || m[1] !== 0x6c || m[2] !== 0x54 || m[3] !== 0x46) {
    throw new Error('The generation service did not return a valid GLB file.');
  }
  return buf;
}

async function describeFailure(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: string; message?: string; detail?: string };
      detail = j.error ?? j.message ?? j.detail ?? text;
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
    return `The generation service is not available (HTTP ${res.status}).${detail ? ' ' + detail : ''}`;
  }
  if (res.status === 413) return 'That photo is too large. Try a smaller image.';
  if (res.status === 415) return 'That image format is not supported.';
  return `Generation failed (HTTP ${res.status}).${detail ? ' ' + detail : ''}`;
}
