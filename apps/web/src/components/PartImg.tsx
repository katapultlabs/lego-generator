import { useEffect, useRef, useState } from 'react';
import { loadPartImage, partKey, peekPartImage, type PartSpec } from '../lib/offscreen';
import type { StepItem } from '../lib/steps';

/** A rendered thumbnail of one part in its color. Rendered lazily, once it scrolls near the viewport. */
export function PartImg({ spec, alt = '', className }: { spec: PartSpec; alt?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = partKey(spec);
  const [url, setUrl] = useState<string | null>(() => peekPartImage(spec));

  useEffect(() => {
    const cached = peekPartImage(spec);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(null);
    const el = ref.current;
    if (!el) return;
    let dead = false;
    let asked = false;
    const io = new IntersectionObserver(
      (es) => {
        if (asked || !es.some((e) => e.isIntersecting)) return;
        asked = true;
        io.disconnect();
        loadPartImage(spec).then((u) => !dead && setUrl(u), () => {});
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => {
      dead = true;
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <span ref={ref} className={`partimg${className ? ` ${className}` : ''}`}>
      {url ? <img src={url} alt={alt} draggable={false} /> : <i className="partimg-ph" style={{ background: spec.hex }} />}
    </span>
  );
}

/** Small "parts for this step" box: thumbnail + count for each distinct part. */
export function Callout({ items, compact }: { items: StepItem[]; compact?: boolean }) {
  return (
    <ul className={`callout${compact ? ' compact' : ''}`}>
      {items.map((it) => (
        <li key={it.key} title={`${it.name} (${it.colorName})`}>
          <PartImg spec={it.spec} alt={it.name} />
          <b>{it.count}&times;</b>
        </li>
      ))}
    </ul>
  );
}
