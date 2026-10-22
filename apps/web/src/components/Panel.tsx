import type { ReactNode } from 'react';
import type { BrickModel, BrickifyOptions, LayerKind } from '../types';

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  vertical,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  vertical?: boolean;
}) {
  return (
    <div className={`seg${vertical ? ' vertical' : ''}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : ''}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="field">
      <span className="field-top">
        <span>{label}</span>
        <b>{format ? format(value) : value}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field toggle">
      <span className="field-top">
        <span>{label}</span>
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </span>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function OptionsCard({
  opts,
  onChange,
  computing,
  disabled,
}: {
  opts: BrickifyOptions;
  onChange: (o: BrickifyOptions) => void;
  computing: boolean;
  disabled: boolean;
}) {
  const set = <K extends keyof BrickifyOptions>(k: K, v: BrickifyOptions[K]) => onChange({ ...opts, [k]: v });
  return (
    <Card
      title="Build options"
      aside={computing ? <span className="computing"><i /><i /><i /> computing</span> : undefined}
    >
      <fieldset disabled={disabled}>
        <Slider label="Resolution" hint="Model width in studs. More studs, more detail, more bricks." value={opts.studs} min={8} max={96} onChange={(v) => set('studs', v)} format={(v) => `${v} studs`} />
        <div className="field">
          <span className="field-top"><span>Piece height</span></span>
          <Segmented<LayerKind>
            value={opts.layer}
            onChange={(v) => set('layer', v)}
            vertical
            options={[
              { value: 'mixed', label: 'Bricks + plates (detailed)' },
              { value: 'brick', label: 'Bricks only' },
              { value: 'plate', label: 'Plates only' },
            ]}
          />
        </div>
        <Toggle label="Smooth with slopes" hint="Fill stair-step corners with 30 degree slope pieces." value={opts.slopes} onChange={(v) => set('slopes', v)} />
        <Slider label="Parts per step" hint="How many parts each instruction step adds." value={opts.stepSize} min={4} max={30} onChange={(v) => set('stepSize', v)} />
        <Slider label="Hollow" hint="Keep only an outer shell to save parts." value={opts.hollow} min={0} max={3} onChange={(v) => set('hollow', v)} format={(v) => (v === 0 ? 'solid' : `shell ${v}`)} />
        <Slider label="Smooth" hint="Round off stair-steps in the voxels." value={opts.smooth} min={0} max={3} onChange={(v) => set('smooth', v)} format={(v) => (v === 0 ? 'off' : String(v))} />
        <Slider label="Colors" hint="Merge similar colors into this many. Fewer colors, simpler build." value={opts.colorCount} min={0} max={12} onChange={(v) => set('colorCount', v)} format={(v) => (v === 0 ? 'auto' : String(v))} />
        <Slider label="Color boost" hint="Punch up dull photo colors before matching bricks." value={opts.vivid} min={1} max={2} step={0.1} onChange={(v) => set('vivid', Math.round(v * 10) / 10)} format={(v) => `${v.toFixed(1)}x`} />
        <Slider label="Attempts" hint="Random tilings tried; the sturdiest wins." value={opts.attempts} min={1} max={16} onChange={(v) => set('attempts', v)} />
        <div className="field">
          <span className="field-top"><span>Up axis of mesh</span></span>
          <Segmented<'y' | 'z'>
            value={opts.upAxis}
            onChange={(v) => set('upAxis', v)}
            options={[{ value: 'y', label: 'Y up' }, { value: 'z', label: 'Z up' }]}
          />
        </div>
      </fieldset>
    </Card>
  );
}

export function StatsCard({ model, stale, onShowLoose }: { model: BrickModel; stale: boolean; onShowLoose?: () => void }) {
  const s = model.stats;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const tiles: { label: string; value: string; bad?: boolean }[] = [
    { label: 'Parts', value: fmt(s.bricks) },
    { label: 'Steps', value: fmt(s.steps) },
    { label: 'Floating', value: fmt(s.floatingBricks), bad: s.floatingBricks > 0 },
    { label: 'Components', value: fmt(s.components) },
  ];
  return (
    <Card title="Stats" aside={<span className="muted">{model.dims.x} x {model.dims.z} studs, {model.dims.y} layers &middot; {fmt(s.millis)} ms</span>}>
      <div className={`tiles${stale ? ' stale' : ''}`}>
        {tiles.map((t) =>
          t.bad && onShowLoose ? (
            <button key={t.label} type="button" className="tile bad link" onClick={onShowLoose} title="Highlight the loose parts in the 3D view">
              <b>{t.value}</b>
              <span>{t.label} (show)</span>
            </button>
          ) : (
            <div key={t.label} className={`tile${t.bad ? ' bad' : ''}`}>
              <b>{t.value}</b>
              <span>{t.label}</span>
            </div>
          ),
        )}
      </div>
      {model.warnings.length > 0 && (
        <ul className="warnings">
          {model.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function BomCard({ model }: { model: BrickModel }) {
  const colors = new Map(model.palette.map((p) => [p.code, p]));
  const lines = [...model.bom].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const total = lines.reduce((n, l) => n + l.count, 0);
  return (
    <Card title="Parts list" aside={<span className="total">{total.toLocaleString('en-US')} pieces</span>}>
      <ul className="bom">
        {lines.map((l) => {
          const c = colors.get(l.color);
          return (
            <li key={`${l.part}-${l.color}`}>
              <span className="swatch" style={{ background: c?.hex ?? '#999' }} title={c?.name} />
              <span className="bom-name">
                {l.name}
                <small>#{l.part}{l.bricklinkPart && l.bricklinkPart !== l.part ? ` (BL ${l.bricklinkPart})` : ''} - {c?.name ?? `color ${l.color}`}</small>
              </span>
              <b>{l.count.toLocaleString('en-US')}</b>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function DownloadsCard({
  onJson,
  onLdraw,
  onCsv,
  onBricklink,
  disabled,
}: {
  onJson: () => void;
  onLdraw: () => void;
  onCsv: () => void;
  onBricklink: () => void;
  disabled: boolean;
}) {
  return (
    <Card title="Download">
      <div className="dl">
        <button type="button" className="btn ghost wide" disabled={disabled} onClick={onBricklink}>BrickLink wanted list (.xml)<small>Order the parts</small></button>
        <button type="button" className="btn ghost" disabled={disabled} onClick={onLdraw}>.ldr<small>LDraw / Studio</small></button>
        <button type="button" className="btn ghost" disabled={disabled} onClick={onCsv}>.csv<small>Parts list</small></button>
        <button type="button" className="btn ghost" disabled={disabled} onClick={onJson}>.json<small>Model data</small></button>
      </div>
      <p className="hint dl-help">Upload at bricklink.com &rarr; Want &rarr; Upload. BrickLink also accepts the .ldr file directly.</p>
    </Card>
  );
}
