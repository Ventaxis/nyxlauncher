import { useEffect, useRef, useState } from 'react';

function prefersReduced() {
  return (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Плавный count-up числа (400ms, rAF, ease-out cubic).
 * Анимируется только при смене target; при reduced-motion — мгновенно.
 * @param {number} target
 * @param {number} [duration]
 * @returns {number}
 */
export function useCountUp(target, duration = 400) {
  const to = Number.isFinite(target) ? target : 0;
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = to;
    if (from === to) {
      setValue(to);
      return undefined;
    }
    if (prefersReduced()) {
      setValue(to);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - p) ** 3;
      setValue(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);

  return value;
}
