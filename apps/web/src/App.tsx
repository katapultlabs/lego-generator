import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { brickify, loadMesh, toLdraw } from './engine';
import { fetchGenerations, fetchGlb, generateFromPhoto, type GenModelId } from './generate';
import { photoViewFor } from './photoView';
import { bomToCsv, saveBlob } from './lib/download';
import type { BrickModel, BrickifyOptions, Generation, PhotoMode, ViewMode } from './types';
import { Viewer } from './components/Viewer';
import { BomCard, DownloadsCard, OptionsCard, Segmented, StatsCard } from './components/Panel';
import { GalleryCard, ProgressCard, SetupCard, SourceCard } from './components/Generate';

const DEFAULT_OPTS: BrickifyOptions = { studs: 32, layer: 'brick', hollow: 0, smooth: 0, attempts: 6, upAxis: 'y', colorCount: 8, vivid: 1.3 };
const SAMPLE_URL = '/samples/beetle.glb';
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

const isGlb = (b: ArrayBuffer) => {
  const m = new Uint8Array(b, 0, Math.min(4, b.byteLength));
  return m.length === 4 && m[0] === 0x67 && m[1] === 0x6c && m[2] === 0x54 && m[3] === 0x46;
};

export default function App() {
  const [opts, setOpts] = useState<BrickifyOptions>(DEFAULT_OPTS);
  const [model, setModel] = useState<BrickModel | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [meshVersion, setMeshVersion] = useState(0);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [gallery, setGallery] = useState<Generation[] | null>(null);
  const [photoMode, setPhotoMode] = useState<PhotoMode>('photo');
  const [turn, setTurn] = useState(0);
  const [photoViewTick, setPhotoViewTick] = useState(0);

  // photo chosen but not generated yet
  const [staged, setStaged] = useState<{ file: File; url: string } | null>(null);
  const [subject, setSubject] = useState('');
  const [genModel, setGenModel] = useState<GenModelId>('trellis-2');
  const [progress, setProgress] = useState<{ steps: string[]; startedAt: number; model: GenModelId } | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<ViewMode>('bricks');
  const [stepRaw, setStepRaw] = useState(0);
  const [followEnd, setFollowEnd] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const loadToken = useRef(0);
  const dragDepth = useRef(0);
  const photoUrlRef = useRef<string | null>(null);
  const meshUrlRef = useRef<string | null>(null);

  const total = model?.stats.steps ?? 0;
  const step = followEnd ? total : Math.min(stepRaw, total);
  const stepRef = useRef(step);
  stepRef.current = step;

  // ------------------------------------------------------------ loading
  const adoptMesh = useCallback(async (buf: ArrayBuffer, name: string, photo: string | null, cutout: string | null, gen: Generation | null) => {
    const token = ++loadToken.current;
    setBusy('Reading 3D mesh...');
    setError(null);
    try {
      if (!isGlb(buf)) throw new Error('That does not look like a .glb file.');
      const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
      await loadMesh(buf);
      if (token !== loadToken.current) { URL.revokeObjectURL(url); return; }
      if (meshUrlRef.current) { useGLTF.clear(meshUrlRef.current); URL.revokeObjectURL(meshUrlRef.current); }
      if (photoUrlRef.current && photoUrlRef.current !== photo) URL.revokeObjectURL(photoUrlRef.current);
      meshUrlRef.current = url;
      photoUrlRef.current = photo;
      setMeshUrl(url);
      setPhotoUrl(photo);
      setCutoutUrl(cutout);
      setGeneration(gen);
      setTurn(0);
      setPhotoViewTick((n) => n + 1);
      history.replaceState(null, '', gen ? `?gen=${encodeURIComponent(gen.id)}` : location.pathname);
      setSourceName(name);
      setModel(null);
      setPlaying(false);
      setFollowEnd(true);
      setExploded(false);
      setMeshVersion((v) => v + 1);
    } catch (e) {
      if (token === loadToken.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === loadToken.current) setBusy(null);
    }
  }, []);

  const clearStaged = useCallback(() => {
    setStaged((s) => {
      if (s) URL.revokeObjectURL(s.url);
      return null;
    });
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.glb') || file.type === 'model/gltf-binary') {
        clearStaged();
        await adoptMesh(await file.arrayBuffer(), file.name, null, null, null);
      } else if (file.type.startsWith('image/') || IMAGE_EXT.test(lower)) {
        // Let the user confirm subject + model before spending money.
        setError(null);
        setStaged((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { file, url: URL.createObjectURL(file) };
        });
      } else {
        setError(`Unsupported file "${file.name}". Drop a photo (jpg, png, webp, heic) or a .glb.`);
      }
    },
    [adoptMesh, clearStaged],
  );

  const generate = useCallback(async () => {
    if (!staged) return;
    setError(null);
    setProgress({ steps: ['Uploading photo'], startedAt: Date.now(), model: genModel });
    try {
      const g = await generateFromPhoto(staged.file, { subject, model: genModel }, (m) =>
        setProgress((p) => (p && p.steps[p.steps.length - 1].toLowerCase() !== m.toLowerCase() ? { ...p, steps: [...p.steps, m] } : p)),
      );
      setProgress(null);
      clearStaged();
      void fetchGenerations().then(setGallery, () => {});
      setBusy('Loading 3D model...');
      await adoptMesh(await fetchGlb(g.glbUrl), g.subject || staged.file.name, g.photoUrl, g.cutoutUrl, g);
    } catch (e) {
      setProgress(null);
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [staged, subject, genModel, adoptMesh, clearStaged]);

  const loadGeneration = useCallback(
    async (g: Generation) => {
      setError(null);
      setBusy('Loading saved model...');
      try {
        clearStaged();
        await adoptMesh(await fetchGlb(g.glbUrl), g.subject || g.id, g.photoUrl, g.cutoutUrl, g);
      } catch (e) {
        setBusy(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [adoptMesh, clearStaged],
  );

  const loadSample = useCallback(async () => {
    setError(null);
    setBusy('Loading sample...');
    try {
      clearStaged();
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error(`Sample not found (HTTP ${res.status}).`);
      const buf = await res.arrayBuffer();
      if (!isGlb(buf)) throw new Error('Sample file is missing: put beetle.glb in public/samples/.');
      await adoptMesh(buf, 'beetle.glb', '/samples/beetle.jpg', null, null);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [adoptMesh, clearStaged]);

  // gallery + ?gen=<id> on first load
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const wanted = new URLSearchParams(location.search).get('gen');
    fetchGenerations().then(
      (list) => {
        setGallery(list);
        if (!wanted) return;
        const g = list.find((x) => x.id === wanted);
        if (g) void loadGeneration(g);
        else setError(`No saved generation "${wanted}".`);
      },
      (e) => {
        if (wanted) setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, [loadGeneration]);

  // ------------------------------------------------------------ brickify (debounced)
  useEffect(() => {
    if (!meshVersion) return;
    let cancelled = false;
    setComputing(true);
    const t = setTimeout(async () => {
      try {
        const m = await brickify(opts);
        if (cancelled) return;
        setModel(m);
        setError(null);
        setComputing(false);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof Error && e.message === 'superseded') return;
        setComputing(false);
        setError(`Brick engine failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [opts, meshVersion]);

  // ------------------------------------------------------------ playback
  useEffect(() => {
    if (!playing || total === 0) return;
    const ms = Math.min(650, Math.max(150, 5200 / total));
    const id = setInterval(() => {
      const next = stepRef.current + 1;
      if (next >= total) {
        setFollowEnd(true);
        setPlaying(false);
      } else {
        setFollowEnd(false);
        setStepRaw(next);
      }
    }, ms);
    return () => clearInterval(id);
  }, [playing, total]);

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (step >= total) {
      setStepRaw(0);
      setFollowEnd(false);
    }
    setPlaying(true);
  };
  const onSlider = (v: number) => {
    setPlaying(false);
    if (v >= total) setFollowEnd(true);
    else { setFollowEnd(false); setStepRaw(v); }
  };
  const showAll = () => { setPlaying(false); setFollowEnd(true); };

  // ------------------------------------------------------------ drag & drop
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) void handleFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [handleFile]);

  // ------------------------------------------------------------ downloads
  const baseName = (sourceName ?? 'model').replace(/\.[^.]+$/, '');
  const dlJson = () => model && saveBlob(`${baseName}-bricks.json`, JSON.stringify(model, null, 2), 'application/json');
  const dlCsv = () => model && saveBlob(`${baseName}-parts.csv`, bomToCsv(model), 'text/csv');
  const dlLdr = async () => {
    if (!model) return;
    try {
      saveBlob(`${baseName}.ldr`, await toLdraw(model), 'text/plain');
    } catch (e) {
      setError(`LDraw export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const empty = !meshUrl && !busy && !staged && !progress;
  const photoView = useMemo(() => photoViewFor(generation?.model), [generation]);
  const meshOnly = !!meshUrl && !model; // show the source mesh until the first brick model arrives

  return (
    <div className="app">
      <main className="stage">
        <Viewer
          model={model}
          meshUrl={meshUrl}
          view={meshOnly ? 'mesh' : view}
          step={step}
          exploded={exploded}
          upAxis={opts.upAxis}
          recenter={recenter}
          photoViewTick={photoViewTick}
          photoView={photoView}
          photoUrl={photoUrl}
          cutoutUrl={cutoutUrl}
          photoMode={photoMode}
          turn={turn}
          onMeshError={setError}
        />

        <div className="brand">
          <span className="logo"><i /><i /></span>
          <div>
            <b>Brickify</b>
            <small>photo to brick model</small>
          </div>
        </div>

        {meshUrl && (
          <div className="viewbar">
            <Segmented<ViewMode>
              value={view}
              onChange={setView}
              options={[
                { value: 'mesh', label: 'Source mesh' },
                { value: 'bricks', label: 'Bricks' },
                { value: 'both', label: 'Both' },
              ]}
            />
            <div className="viewrow">
              <Segmented<PhotoMode>
                value={photoMode}
                onChange={setPhotoMode}
                options={[
                  { value: 'photo', label: 'Photo', disabled: !photoUrl },
                  { value: 'cutout', label: 'Cutout', disabled: !cutoutUrl },
                  { value: 'off', label: 'Off' },
                ]}
              />
              <button className="chip raised" onClick={() => setPhotoViewTick((n) => n + 1)} title="Fly the camera back to where the photo was taken from">Photo view</button>
              <button className="chip raised" onClick={() => setTurn((n) => n + 1)} title="Rotate the model 90 degrees if it faces the wrong way">Turn 90&deg;</button>
            </div>
          </div>
        )}

        {computing && meshUrl && (
          <div className="pill"><span className="spinner" /> computing...</div>
        )}

        {empty && (
          <div className="empty">
            <div className="stack" aria-hidden>
              <i style={{ background: '#f2cd37' }} />
              <i style={{ background: '#0055bf' }} />
              <i style={{ background: '#c91a09' }} />
            </div>
            <h1>Turn a photo into a brick model</h1>
            <p>Drop a photo or a .glb anywhere, or pick one below. You get a stud-accurate model, build steps and a parts list.</p>
            <div className="row">
              <button className="btn primary" onClick={() => fileInput.current?.click()}>Choose photo or .glb</button>
              <button className="btn" onClick={loadSample}>Try sample</button>
            </div>
          </div>
        )}

        {staged && !progress && (
          <SetupCard
            photoUrl={staged.url}
            fileName={staged.file.name}
            subject={subject}
            model={genModel}
            onSubject={setSubject}
            onModel={setGenModel}
            onGenerate={generate}
            onCancel={clearStaged}
          />
        )}

        {progress && staged && <ProgressCard photoUrl={staged.url} steps={progress.steps} startedAt={progress.startedAt} model={progress.model} />}

        {busy && (
          <div className="busy">
            <div className="stack spin" aria-hidden>
              <i style={{ background: '#f2cd37' }} />
              <i style={{ background: '#0055bf' }} />
              <i style={{ background: '#c91a09' }} />
            </div>
            <p>{busy}</p>
          </div>
        )}

        {model && (view === 'bricks' || view === 'both') && (
          <div className="playbar">
            <button className="icon" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play build'} title={playing ? 'Pause' : 'Play build'}>
              {playing ? (
                <svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
              )}
            </button>
            <input type="range" min={0} max={total} step={1} value={step} onChange={(e) => onSlider(Number(e.target.value))} aria-label="Build step" />
            <span className="stepnum">{step} / {total}</span>
            <button className="chip" onClick={showAll} disabled={step >= total}>Show all</button>
            <button className={`chip${exploded ? ' on' : ''}`} onClick={() => setExploded((x) => !x)} aria-pressed={exploded}>Explode</button>
            <button className="chip" onClick={() => setRecenter((n) => n + 1)} title="Re-frame the camera">Recenter</button>
          </div>
        )}

        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">x</button>
          </div>
        )}

        {dragging && (
          <div className="dropzone">
            <div>
              <b>Drop to build</b>
              <span>photo (jpg, png, webp, heic) or .glb</span>
            </div>
          </div>
        )}
      </main>

      <aside className="panel">
        <SourceCard
          name={sourceName}
          photoUrl={photoUrl}
          cutoutUrl={cutoutUrl}
          generation={generation}
          hasMesh={!!meshUrl}
          busy={!!busy || !!progress}
          onUpload={() => fileInput.current?.click()}
          onSample={loadSample}
        />
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif,.glb,model/gltf-binary"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void handleFile(f);
          }}
        />
        <GalleryCard items={gallery} activeId={generation?.id ?? null} disabled={!!busy || !!progress} onPick={loadGeneration} />

        <OptionsCard opts={opts} onChange={setOpts} computing={computing} disabled={!meshUrl} />

        {model && <StatsCard model={model} stale={computing} />}
        {model && <BomCard model={model} />}
        <DownloadsCard disabled={!model} onJson={dlJson} onLdraw={dlLdr} onCsv={dlCsv} />
      </aside>
    </div>
  );
}
