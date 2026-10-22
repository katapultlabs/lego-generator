import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BrickModel } from '../types';
import { ModelRenderer } from '../lib/offscreen';
import { buildStepParts, partSpecs, type StepItem } from '../lib/steps';
import { Segmented } from './Panel';
import { Callout, PartImg } from './PartImg';
import './instructions.css';

// Print rules are nested under `html` so the same text drives both @media print and the on-screen
// "Print preview" (class `print-preview` on <html>).
const COMMON_RULES = `
  & body { overflow: visible !important; height: auto !important; background: #fff !important; }
  & #root, & .app, & .stage { display: block !important; position: static !important; height: auto !important; width: auto !important; overflow: visible !important; background: #fff !important; }
  & .panel, & .stage > *:not(.booklet), & .no-print { display: none !important; }
  & .booklet { position: static !important; overflow: visible !important; padding: 0 !important; background: #fff !important; }
  & .sheet { width: 297mm !important; height: 210mm !important; aspect-ratio: auto !important; }
  & * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
const PRINT_ONLY = `
  & .sheet { margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; }
  & .sheet:last-of-type { break-after: auto; page-break-after: auto; }
  & .preview-exit { display: none !important; }
`;
const PRINT_CSS = `@page { size: 297mm 210mm; margin: 0; }
@media print { html { ${COMMON_RULES} ${PRINT_ONLY} } }
html.print-preview { ${COMMON_RULES} & .booklet { background: #bdb6a4 !important; padding: 16px 0 !important; } & .sheet { margin: 0 auto 16px !important; } & .preview-exit { display: block; } }`;

const PER_PAGE_OPTIONS: { value: '1' | '2' | '4'; label: string }[] = [
  { value: '1', label: '1 step / page' },
  { value: '2', label: '2 / page' },
  { value: '4', label: '4 / page' },
];
const TILES_PER_SHEET = 12;

const fmt = (n: number) => n.toLocaleString('en-US');

interface Props {
  model: BrickModel;
  title: string;
  photoUrl: string | null;
  photoView: [number, number, number];
  upAxis: 'y' | 'z';
  turn: number;
  /** The Model | Instructions switch, shown in the toolbar. */
  modeSwitch: ReactNode;
}

export function Instructions({ model, title, photoUrl, photoView, upAxis, turn, modeSwitch }: Props) {
  const [perPage, setPerPage] = useState<'1' | '2' | '4'>('2');
  const [preview, setPreview] = useState(false);
  const [prep, setPrep] = useState<{ done: number; total: number } | null>(null);
  const [version, setVersion] = useState(0);
  const [renderer, setRenderer] = useState<ModelRenderer | null>(null);
  const [hero, setHero] = useState<string | null>(null);
  const cancelPrep = useRef(false);

  // one shared offscreen renderer per model
  const size = perPage === '2' ? { w: 660, h: 780 } : { w: 1020, h: 600 };
  useEffect(() => {
    const r = new ModelRenderer(model, { photoView, upAxis, turn, size });
    setRenderer(r);
    setHero(null);
    setPrep(null);
    let dead = false;
    void r.hero().then((u) => !dead && setHero(u), () => {});
    return () => {
      dead = true;
      cancelPrep.current = true;
      r.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, photoView, upAxis, turn, size.w, size.h]);

  // print stylesheet + preview class
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'booklet-print-css';
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('print-preview', preview);
    // paper is 297mm (about 1123px) wide; shrink the preview to fit narrow windows
    const fit = () => {
      document.body.style.zoom = preview ? String(Math.min(1, (window.innerWidth - 24) / 1123)) : '';
    };
    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      root.classList.remove('print-preview');
      document.body.style.zoom = '';
    };
  }, [preview]);

  const stepParts = useMemo(() => buildStepParts(model), [model]);
  const specs = useMemo(() => partSpecs(model), [model]);
  const colors = useMemo(() => new Map(model.palette.map((p) => [p.code, p])), [model]);
  const bom = useMemo(() => [...model.bom].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), [model]);
  const totalSteps = model.stats.steps;
  const per = Number(perPage);

  const stepSheets = useMemo(() => {
    const sheets: number[][] = [];
    for (let s = 1; s <= totalSteps; s += per) sheets.push(Array.from({ length: Math.min(per, totalSteps - s + 1) }, (_, k) => s + k));
    return sheets;
  }, [totalSteps, per]);
  const tileSheets = useMemo(() => {
    const sheets: (typeof bom)[] = [];
    for (let i = 0; i < bom.length; i += TILES_PER_SHEET) sheets.push(bom.slice(i, i + TILES_PER_SHEET));
    return sheets;
  }, [bom]);

  const layerH = model.units.layerLdu / model.units.studLdu;
  const cm = (v: number) => (Math.round(v * 0.8 * 10) / 10).toString();
  const sizeStuds = `${model.dims.x} × ${model.dims.z} studs`;
  const sizeCm = `${cm(model.dims.x)} × ${cm(model.dims.z)} × ${cm(model.dims.y * layerH)} cm`;
  const heightLabel = model.units.layer === 'brick' ? `${model.dims.y} bricks tall` : `${model.dims.y} plates tall`;
  const parts = model.stats.bricks;

  const printAll = useCallback(async () => {
    if (!renderer) return;
    cancelPrep.current = false;
    setPrep({ done: 0, total: totalSteps });
    await renderer.prepareAll((done, total) => setPrep({ done, total }), () => cancelPrep.current);
    if (cancelPrep.current) return;
    setVersion((v) => v + 1);
    setPrep(null);
    await new Promise((r) => setTimeout(r, 150)); // let the images land in the DOM
    window.print();
  }, [renderer, totalSteps]);

  return (
    <div className="booklet" data-per-page={perPage}>
      <div className="booklet-bar no-print">
        {modeSwitch}
        <div className="bar-group">
          <span className="muted">Layout</span>
          <Segmented value={perPage} onChange={setPerPage} options={PER_PAGE_OPTIONS} />
        </div>
        <span className="bar-spacer" />
        <span className="muted">{fmt(totalSteps)} steps &middot; {fmt(parts)} parts</span>
        <button className="chip raised" onClick={() => setPreview(true)} title="Show the pages as they will print">Print preview</button>
        <button className="btn primary" onClick={() => void printAll()} disabled={!renderer || !!prep}>Print / Save PDF</button>
      </div>
      <button className="chip raised preview-exit" onClick={() => setPreview(false)}>Exit print preview</button>

      {/* ---------------------------------------------------------- cover */}
      <section className="sheet cover" data-page="cover">
        <div className="cover-band">
          <span className="cover-logo"><i /><i /></span>
          <b>Brickify</b>
          <span className="cover-kind">Building instructions</span>
        </div>
        <h1 className="cover-title">{title}</h1>
        <div className="cover-hero">
          {hero ? <img src={hero} alt={`Finished ${title}`} /> : <span className="skeleton"><i /></span>}
        </div>
        {photoUrl && (
          <figure className="cover-photo">
            <img src={photoUrl} alt="Source photo" />
            <figcaption>The photo this is built from</figcaption>
          </figure>
        )}
        <ul className="cover-facts">
          <li><b>{fmt(parts)}</b><span>parts</span></li>
          <li><b>{fmt(totalSteps)}</b><span>steps</span></li>
          <li><b>{sizeStuds}</b><span>{heightLabel}</span></li>
          <li><b>&asymp; {sizeCm}</b><span>1 stud = 0.8 cm</span></li>
        </ul>
      </section>

      {/* ---------------------------------------------------------- parts inventory */}
      {tileSheets.map((tiles, si) => (
        <section className="sheet inventory" key={`inv-${si}`} data-page="inventory">
          <header className="sheet-head">
            <h2>Parts you need</h2>
            <span>{fmt(bom.length)} kinds &middot; {fmt(parts)} pieces{tileSheets.length > 1 ? ` · ${si + 1}/${tileSheets.length}` : ''}</span>
          </header>
          <ul className="tiles-grid">
            {tiles.map((l) => {
              const spec = specs.get(`${l.part}|${l.color}`);
              const c = colors.get(l.color);
              return (
                <li className="ptile" key={`${l.part}-${l.color}`}>
                  {spec ? <PartImg spec={spec} alt={l.name} /> : <span className="partimg" />}
                  <div className="ptile-text">
                    <b className="ptile-count">{fmt(l.count)}&times;</b>
                    <span className="ptile-name">{l.name}</span>
                    <small>
                      <i className="dot" style={{ background: c?.hex ?? '#999' }} />
                      {c?.name ?? `Color ${l.color}`}
                    </small>
                    <small className="ids">
                      <span>LDraw {l.part} / color {l.color}</span>
                      {l.bricklinkPart && <span>BrickLink {l.bricklinkPart}{l.bricklinkColor != null ? ` / color ${l.bricklinkColor}` : ''}</span>}
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* ---------------------------------------------------------- build steps */}
      {renderer &&
        stepSheets.map((steps) => (
          <section className={`sheet steps n${per}`} key={`steps-${steps[0]}-${per}`} data-page={`steps-${steps[0]}`}>
            {steps.map((s) => (
              <StepCell key={s} renderer={renderer} step={s} total={totalSteps} items={stepParts.get(s) ?? []} version={version} />
            ))}
          </section>
        ))}

      {prep && (
        <div className="prep no-print" role="status">
          <div className="prep-card">
            <b>Preparing {fmt(prep.total)} pages&hellip;</b>
            <div className="prep-bar"><i style={{ width: `${(prep.done / Math.max(1, prep.total)) * 100}%` }} /></div>
            <span className="muted">{fmt(prep.done)} / {fmt(prep.total)} rendered. The print dialog opens when this finishes.</span>
            <button className="btn" onClick={() => { cancelPrep.current = true; setPrep(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepCell({ renderer, step, total, items, version }: { renderer: ModelRenderer; step: number; total: number; items: StepItem[]; version: number }) {
  return (
    <article className="cell" data-step={step}>
      <header className="cell-head">
        <b className="stepno">{step}</b>
        <Callout items={items} />
        <span className="cell-of">{step} / {total}</span>
      </header>
      <StepImage renderer={renderer} step={step} version={version} />
    </article>
  );
}

/** Renders its step image only once it is near the viewport (or already cached). */
function StepImage({ renderer, step, version }: { renderer: ModelRenderer; step: number; version: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(() => renderer.peek(step));

  useEffect(() => {
    const cached = renderer.peek(step);
    if (cached) {
      setUrl(cached);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let dead = false;
    let active = false;
    let retries = 0;
    const request = () => {
      void renderer.step(step).then(
        (u) => {
          if (dead) return;
          if (u) setUrl(u);
          else if (active && retries++ < 4) setTimeout(() => active && !dead && request(), 60);
        },
        () => {},
      );
    };
    const io = new IntersectionObserver(
      (es) => {
        const on = es.some((e) => e.isIntersecting);
        if (on && !active) {
          active = true;
          renderer.want(step);
          request();
        } else if (!on && active) {
          active = false;
          renderer.release(step);
        }
      },
      { rootMargin: '700px 0px' },
    );
    io.observe(el);
    return () => {
      dead = true;
      io.disconnect();
      if (active) renderer.release(step);
    };
  }, [renderer, step, version]);

  return (
    <div className="cell-img" ref={ref}>
      {url ? <img src={url} alt={`Step ${step}`} draggable={false} /> : <span className="skeleton"><i /></span>}
    </div>
  );
}
