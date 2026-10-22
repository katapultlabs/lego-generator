// Data contract shared with the Rust/WASM brick engine (serialized as camelCase JSON).

export type LayerKind = 'brick' | 'plate';

export interface PaletteEntry {
  code: number;
  name: string;
  hex: string;
}

export interface Brick {
  part: string;
  /** Grid cell of the min corner. A brick occupies x..x+w (X), layer y, z..z+d (Z). y is up. */
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  /** Palette code. */
  color: number;
  /** 1-based build step. */
  step: number;
}

export interface BomLine {
  part: string;
  name: string;
  color: number;
  count: number;
}

export interface BrickStats {
  bricks: number;
  voxels: number;
  layers: number;
  steps: number;
  floatingBricks: number;
  components: number;
  attempts: number;
  millis: number;
}

export interface BrickModel {
  version: number;
  units: {
    /** LDU per stud (20). */
    studLdu: number;
    /** LDU per layer (24 brick, 8 plate). */
    layerLdu: number;
    layer: LayerKind;
  };
  /** Grid size: x,z in studs, y in layers. */
  dims: { x: number; y: number; z: number };
  palette: PaletteEntry[];
  bricks: Brick[];
  bom: BomLine[];
  stats: BrickStats;
  warnings: string[];
}

export interface BrickifyOptions {
  studs: number;
  layer: LayerKind;
  hollow: number;
  smooth: number;
  attempts: number;
  upAxis: 'y' | 'z';
  /** Max distinct colors after reduction; 0 = no reduction. */
  colorCount: number;
  /** Saturation boost before matching to the palette, 1.0 (none) to 2.0. */
  vivid: number;
}

/** A saved generation (mirrors `Generation` in server/api.ts). */
export interface Generation {
  id: string;
  createdAt: string;
  subject: string;
  model: string;
  segmenter: string;
  seconds: number;
  photoUrl: string;
  cutoutUrl: string;
  glbUrl: string;
}

/** What the source photo is shown as in the 3D scene. */
export type PhotoMode = 'photo' | 'cutout' | 'off';

export type ViewMode = 'mesh' | 'bricks' | 'both';
