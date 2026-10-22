import type { BrickModel } from '../types';

export function saveBlob(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function bomToCsv(model: BrickModel): string {
  const colors = new Map(model.palette.map((p) => [p.code, p]));
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = ['part,name,color_code,color_name,color_hex,count'];
  for (const l of [...model.bom].sort((a, b) => b.count - a.count)) {
    const c = colors.get(l.color);
    rows.push([l.part, q(l.name), l.color, q(c?.name ?? ''), c?.hex ?? '', l.count].join(','));
  }
  return rows.join('\n') + '\n';
}
