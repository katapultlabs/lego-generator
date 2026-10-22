import type { BrickModel } from '../types';
import type { PartSpec } from './offscreen';

export interface StepItem {
  key: string;
  part: string;
  name: string;
  color: number;
  colorName: string;
  hex: string;
  count: number;
  spec: PartSpec;
}

const lineKey = (part: string, color: number) => `${part}|${color}`;

/** One render spec per (part, color) found in the model. Slopes are shown facing a fixed way. */
export function partSpecs(model: BrickModel): Map<string, PartSpec> {
  const layerH = model.units.layerLdu / model.units.studLdu;
  const hex = new Map(model.palette.map((p) => [p.code, p.hex]));
  const out = new Map<string, PartSpec>();
  for (const b of model.bricks) {
    const k = lineKey(b.part, b.color);
    if (out.has(k)) continue;
    out.set(k, { shape: b.shape ?? 'box', w: b.w, d: b.d, h: b.h ?? 1, hex: hex.get(b.color) ?? '#9a9a9a', layerH });
  }
  return out;
}

/** Parts added in each build step, grouped by (part, color). */
export function buildStepParts(model: BrickModel): Map<number, StepItem[]> {
  const specs = partSpecs(model);
  const names = new Map(model.bom.map((l) => [lineKey(l.part, l.color), l.name]));
  const colors = new Map(model.palette.map((p) => [p.code, p]));
  const byStep = new Map<number, Map<string, StepItem>>();
  for (const b of model.bricks) {
    const k = lineKey(b.part, b.color);
    let m = byStep.get(b.step);
    if (!m) byStep.set(b.step, (m = new Map()));
    const hit = m.get(k);
    if (hit) hit.count++;
    else
      m.set(k, {
        key: k,
        part: b.part,
        name: names.get(k) ?? b.part,
        color: b.color,
        colorName: colors.get(b.color)?.name ?? `color ${b.color}`,
        hex: colors.get(b.color)?.hex ?? '#9a9a9a',
        count: 1,
        spec: specs.get(k)!,
      });
  }
  const out = new Map<number, StepItem[]>();
  for (const [s, m] of byStep) out.set(s, [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
  return out;
}
