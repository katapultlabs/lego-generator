import { useEffect, useState } from 'react';
import { GEN_MODELS, SUBJECT_SUGGESTIONS, modelLabel, type GenModelId } from '../generate';
import type { Generation } from '../types';
import { Card } from './Panel';

/** Confirm card shown after choosing a photo: what is it, which 3D model, then Generate. */
export function SetupCard({
  photoUrl,
  fileName,
  subject,
  model,
  onSubject,
  onModel,
  onGenerate,
  onCancel,
}: {
  photoUrl: string;
  fileName: string;
  subject: string;
  model: GenModelId;
  onSubject: (s: string) => void;
  onModel: (m: GenModelId) => void;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const chosen = GEN_MODELS.find((m) => m.id === model)!;
  return (
    <div className="overlay">
      <form
        className="setup"
        onSubmit={(e) => {
          e.preventDefault();
          onGenerate();
        }}
      >
        <div className="setup-photo">
          <img src={photoUrl} alt="Chosen photo" />
        </div>
        <div className="setup-body">
          <small className="filename" title={fileName}>{fileName}</small>
          <label className="setup-label" htmlFor="subject">What is it?</label>
          <input
            id="subject"
            className="text"
            type="text"
            value={subject}
            placeholder="e.g. bird, car, house"
            autoFocus
            autoComplete="off"
            onChange={(e) => onSubject(e.target.value)}
          />
          <div className="chips">
            {SUBJECT_SUGGESTIONS.map((s) => (
              <button type="button" key={s} className={`chip${subject.trim().toLowerCase() === s ? ' on' : ''}`} onClick={() => onSubject(s)}>
                {s}
              </button>
            ))}
          </div>
          <small className="hint">Naming it helps cut the right thing out of the photo. Leave empty to pick the most prominent object.</small>

          <span className="setup-label">3D model</span>
          <div className="choices" role="radiogroup" aria-label="3D model">
            {GEN_MODELS.map((m) => (
              <button
                type="button"
                key={m.id}
                role="radio"
                aria-checked={m.id === model}
                className={`choice${m.id === model ? ' on' : ''}`}
                onClick={() => onModel(m.id)}
              >
                <b>{m.label}</b>
                <small>{m.price} - {m.note}</small>
              </button>
            ))}
          </div>

          <div className="row">
            <button type="button" className="btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn primary">Generate ({chosen.price})</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  return <>{Math.max(0, Math.floor((now - since) / 1000))}s</>;
}

const sentence = (m: string) => m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? '' : '...');

/** Live list of generation steps: finished ones get a check, the current one a spinner. */
export function ProgressCard({ photoUrl, steps, startedAt, model }: { photoUrl: string | null; steps: string[]; startedAt: number; model: GenModelId }) {
  return (
    <div className="overlay">
      <div className="progress">
        <div className="progress-head">
          {photoUrl && <img src={photoUrl} alt="" />}
          <div>
            <b>Building your 3D model</b>
            <small>{modelLabel(model)} - <span className="tabular"><Elapsed since={startedAt} /></span> elapsed</small>
          </div>
        </div>
        <ol className="steps" aria-live="polite">
          {steps.map((s, i) => {
            const current = i === steps.length - 1;
            return (
              <li key={i} className={current ? 'current' : 'done'}>
                {current ? <span className="spinner" /> : <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                <span>{sentence(s)}</span>
              </li>
            );
          })}
        </ol>
        <small className="hint">This usually takes a minute or two. Keep this tab open.</small>
      </div>
    </div>
  );
}

function Thumb({ src, label, cutout }: { src: string | null; label: string; cutout?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <figure className="srcfig">
      <div className={`thumb big${cutout ? ' checker' : ''}`}>
        {src && !broken ? <img src={src} alt={label} className={cutout ? 'contain' : ''} onError={() => setBroken(true)} /> : <span>{src ? '?' : '-'}</span>}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function SourceCard({
  name,
  photoUrl,
  cutoutUrl,
  generation,
  hasMesh,
  busy,
  onUpload,
  onSample,
}: {
  name: string | null;
  photoUrl: string | null;
  cutoutUrl: string | null;
  generation: Generation | null;
  hasMesh: boolean;
  busy: boolean;
  onUpload: () => void;
  onSample: () => void;
}) {
  return (
    <Card title="Source">
      {photoUrl || cutoutUrl ? (
        <div className="srcthumbs">
          <Thumb src={photoUrl} label="Photo" />
          {cutoutUrl && <Thumb src={cutoutUrl} label="Cutout" cutout />}
        </div>
      ) : null}
      <div className="source">
        {!photoUrl && !cutoutUrl && <div className="thumb"><span>{hasMesh ? '3D' : '?'}</span></div>}
        <div className="source-info">
          <b title={name ?? ''}>{generation?.subject ? generation.subject : (name ?? 'Nothing loaded yet')}</b>
          <small>
            {generation
              ? `${modelLabel(generation.model)}, cut out with ${generation.segmenter}, ${Math.round(generation.seconds)} s`
              : photoUrl ? 'Photo' : hasMesh ? 'Loaded 3D mesh' : 'Photo or .glb'}
          </small>
        </div>
      </div>
      <div className="row">
        <button className="btn primary" onClick={onUpload} disabled={busy}>Upload</button>
        <button className="btn" onClick={onSample} disabled={busy}>Try sample</button>
      </div>
    </Card>
  );
}

export function GalleryCard({
  items,
  activeId,
  disabled,
  onPick,
}: {
  items: Generation[] | null;
  activeId: string | null;
  disabled: boolean;
  onPick: (g: Generation) => void;
}) {
  if (!items || items.length === 0) return null;
  return (
    <Card title="Past generations" aside={<span className="muted">{items.length} saved, free to reload</span>}>
      <div className="gallery">
        {items.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`gal${g.id === activeId ? ' on' : ''}`}
            disabled={disabled}
            onClick={() => onPick(g)}
            title={`${g.subject || 'untitled'} - ${modelLabel(g.model)} - ${new Date(g.createdAt).toLocaleString()}`}
          >
            <img src={g.photoUrl} alt={g.subject || 'generation'} loading="lazy" />
            <span>{g.subject || 'untitled'}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
