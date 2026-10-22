// Where was the photo taken from, relative to the generated model?

/**
 * Direction from the model center toward the camera that took the photo, in the GLB's own frame
 * (up = +Y). Looking at the model from this side shows it the way the photo does.
 */
export const PHOTO_VIEW: Record<string, [number, number, number]> = {
  // TRELLIS.2 puts the photo camera on the -X side looking toward +X (screen-right = +Z).
  'trellis-2': [-1, 0, 0],
  // Hunyuan3D puts the photo camera on +Z looking toward -Z (screen-right = +X). Verified.
  'hunyuan-3.1': [0, 0, 1],
};

/** Used for uploaded GLBs and the sample, which carry no generation metadata. */
export const DEFAULT_PHOTO_MODEL = 'trellis-2';

export function photoViewFor(model?: string | null): [number, number, number] {
  return PHOTO_VIEW[model ?? DEFAULT_PHOTO_MODEL] ?? PHOTO_VIEW[DEFAULT_PHOTO_MODEL];
}
