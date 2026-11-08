import { useEffect, useRef, useState } from 'react';
import { fmtChartVal, weekdayShort } from '../format.js';

const H = 240;
const PAD_T = 32;
const PAD_B = 30;
const PAD_X = 26;

/**
 * Герой страницы детализации: SVG-линия недели, draw-in при монтировании
 * и при смене истории (последний день растёт «живьём» — без ре-анимации).
 */
export default function WeekChart({ week }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const w = en.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = week && week.length === 7
    ? week
    : Array.from({ length: 7 }, (_, i) => ({ date: '', seconds: 0 }));

  // Перерисовка с draw-in — только когда меняется история (дни 1..6);
  // тики играющей сессии меняют лишь последний день.
  const sig = data.slice(0, 6).map((d) => d.seconds).join('|');

  const w = width || 720;
  const plotW = w - PAD_X * 2;
  const plotH = H - PAD_T - PAD_B;
  const baseY = PAD_T + plotH;
  const max = Math.max(60, ...data.map((d) => d.seconds));
  const x = (i) => PAD_X + (plotW * i) / (data.length - 1);
  const y = (v) => PAD_T + plotH * (1 - v / max);

  const line = data
    .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.seconds).toFixed(1)}`)
    .join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${baseY} L${PAD_X} ${baseY} Z`;
  const todayIdx = data.length - 1;

  return (
    <div className="chart" ref={wrapRef}>
      {width > 0 && (
        <svg
          width={w}
          height={H}
          viewBox={`0 0 ${w} ${H}`}
          role="img"
          aria-label="Часы за последние семь дней"
        >
          <g className="chart-grid" aria-hidden="true">
            <line className="chart-base" x1={PAD_X} x2={w - PAD_X} y1={baseY} y2={baseY} />
            <line x1={PAD_X} x2={w - PAD_X} y1={y(max / 2)} y2={y(max / 2)} />
            <line x1={PAD_X} x2={w - PAD_X} y1={PAD_T} y2={PAD_T} />
          </g>

          <path className="chart-area" key={`a-${sig}`} d={area} aria-hidden="true" />
          <path className="chart-line" key={`l-${sig}`} d={line} pathLength="1" aria-hidden="true" />

          {data.map((d, i) => (
            <g key={d.date || i} className={`chart-day${i === todayIdx ? ' is-today' : ''}`}>
              {d.seconds > 0 && (
                <text
                  className={`chart-val mono${i === todayIdx ? ' is-today' : ''}`}
                  x={x(i)}
                  y={y(d.seconds) - 10}
                  textAnchor="middle"
                >
                  {fmtChartVal(d.seconds)}
                </text>
              )}
              {i === todayIdx && (
                <circle className="chart-ring" key={`r-${sig}`} cx={x(i)} cy={y(d.seconds)} r="7" />
              )}
              <circle
                className="chart-dot"
                key={`d-${sig}`}
                style={{ '--i': i }}
                cx={x(i)}
                cy={y(d.seconds)}
                r="3.2"
              />
              <text className="chart-day-label mono" x={x(i)} y={H - 8} textAnchor="middle">
                {weekdayShort(d.date)}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
