import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Fin } from '../data/helpers.ts';
import { Icon } from './icons.tsx';
// Hand-rolled SVG chart primitives for the dashboard.

// ── TIME RANGE FILTER ──────────────────────────────────────────────────────
interface TimeRangeFilterProps {
  value: string;
  onChange: (v: string) => void;
  options?: string[];
}
function TimeRangeFilter({ value, onChange, options = Fin.RANGE_OPTIONS }: TimeRangeFilterProps) {
  return (
    <div className="seg time-range">
      {options.map(opt => (
        <button
          key={opt}
          className={value === opt ? 'on' : ''}
          onClick={() => onChange(opt)}
        >{opt}</button>
      ))}
    </div>
  );
}

// ── LINE / AREA CHART ──────────────────────────────────────────────────────
interface DataPoint {
  ym: string;
  value: number;
  [key: string]: any;
}

interface ChartPadding {
  l: number;
  r: number;
  t: number;
  b: number;
}

interface LineChartProps {
  data: DataPoint[];
  height?: number;
  color?: string;
  fill?: boolean;
  padding?: ChartPadding;
  yTicks?: number;
  onHover?: (idx: number | null, d: DataPoint | null) => void;
  formatY?: (v: number) => string;
  tooltipExtra?: (d: DataPoint) => React.ReactNode;
}

function LineChart({ data, height = 220, color = 'var(--accent)', fill = true, padding = { l: 56, r: 16, t: 16, b: 28 }, yTicks = 4, onHover, formatY, tooltipExtra }: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(320, e.contentRect.width));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const innerW = w - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const xs = data.map((_: DataPoint, i: number) => padding.l + (i / Math.max(1, data.length - 1)) * innerW);
  const vals = data.map((d: DataPoint) => d.value);
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 1);
  const range = maxV - minV || 1;
  const y = (v: number) => padding.t + (1 - (v - minV) / range) * innerH;

  const path = data.map((d: DataPoint, i: number) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const areaPath = `${path} L${xs[xs.length-1].toFixed(1)},${(padding.t + innerH).toFixed(1)} L${xs[0].toFixed(1)},${(padding.t + innerH).toFixed(1)} Z`;

  const ticks: { v: number; y: number }[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = minV + (range * i) / yTicks;
    ticks.push({ v, y: y(v) });
  }

  const [hover, setHover] = useState<number | null>(null);
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.round(((x - padding.l) / innerW) * (data.length - 1));
    const idx = Math.max(0, Math.min(data.length - 1, i));
    setHover(idx);
    onHover?.(idx, data[idx]);
  };

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} onMouseMove={handleMove} onMouseLeave={() => { setHover(null); onHover?.(null, null); }}>
        <defs>
          <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.l} x2={w - padding.r} y1={t.y} y2={t.y} stroke="var(--rule)" strokeDasharray="2 3"/>
            <text x={padding.l - 8} y={t.y + 3} textAnchor="end" className="chart-axis private">{formatY ? formatY(t.v) : Math.round(t.v).toLocaleString()}</text>
          </g>
        ))}
        {data.map((d: DataPoint, i: number) => (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) && (
          <text key={i} x={xs[i]} y={height - 8} textAnchor="middle" className="chart-axis">{Fin.fmtMonth(d.ym, { short: true })}</text>
        ))}
        {fill && <path d={areaPath} fill="url(#lc-fill)"/>}
        <path d={path} fill="none" stroke={color} strokeWidth="1.5"/>
        {hover != null && (
          <g>
            <line x1={xs[hover]} x2={xs[hover]} y1={padding.t} y2={padding.t + innerH} stroke="var(--ink)" strokeOpacity="0.3" strokeDasharray="2 2"/>
            <circle cx={xs[hover]} cy={y(data[hover].value)} r="4" fill="var(--bg)" stroke={color} strokeWidth="1.5"/>
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="chart-tooltip" style={{ left: Math.min(w - 240, Math.max(0, xs[hover] + 12)), top: 8 }}>
          <div className="tt-label">{Fin.fmtMonth(data[hover].ym)}</div>
          <div className="tt-value private">{formatY ? formatY(data[hover].value) : Fin.fmtILS(data[hover].value)}</div>
          {tooltipExtra && tooltipExtra(data[hover])}
        </div>
      )}
    </div>
  );
}

// ── STACKED / GROUPED BAR ──────────────────────────────────────────────────
interface StackedBarProps {
  data: Record<string, any>[];
  keys: string[];
  colors: Record<string, string>;
  height?: number;
  padding?: ChartPadding;
  formatY?: (v: number, opts?: { compact?: boolean }) => string;
  formatLabel?: (v: string) => string;
  labelKey?: string;
  labelFor?: (k: string) => string;
}

function StackedBar({ data, keys, colors, height = 240, padding = { l: 56, r: 16, t: 16, b: 28 }, formatY = Fin.fmtILS, formatLabel, labelKey = 'ym', labelFor }: StackedBarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(Math.max(320, e.contentRect.width)); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const innerW = w - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const totals = data.map((d: Record<string, any>) => keys.reduce((s: number, k: string) => s + (d[k] || 0), 0));
  const maxV = Math.max(...totals, 1);
  const barW = (innerW / data.length) * 0.7;
  const gap = (innerW / data.length) * 0.3;
  const [hover, setHover] = useState<{ i: number; k: string } | null>(null);
  const fmtKey = labelFor || ((k: string) => k.replace(/_/g, ' '));

  const ticks: { v: number; y: number }[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = (maxV * i) / 4;
    ticks.push({ v, y: padding.t + (1 - i/4) * innerH });
  }

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.l} x2={w - padding.r} y1={t.y} y2={t.y} stroke="var(--rule)" strokeDasharray="2 3"/>
            <text x={padding.l - 8} y={t.y + 3} textAnchor="end" className="chart-axis private">{formatY(t.v, { compact: true })}</text>
          </g>
        ))}
        {data.map((d: Record<string, any>, i: number) => {
          const x = padding.l + i * (barW + gap) + gap/2;
          let yCursor = padding.t + innerH;
          return (
            <g key={i}>
              {keys.map((k: string) => {
                const v = d[k] || 0;
                const h = (v / maxV) * innerH;
                yCursor -= h;
                const yPos = yCursor;
                const segActive = hover && hover.i === i && hover.k === k;
                const otherDim = hover && (hover.k !== k);
                return (
                  <rect key={k} x={x} y={yPos} width={barW} height={h}
                    fill={colors[k]}
                    opacity={otherDim ? 0.18 : (segActive ? 1 : (hover ? 0.85 : 1))}
                    stroke={segActive ? 'var(--ink)' : 'none'} strokeWidth={segActive ? 1 : 0}
                    onMouseEnter={() => v > 0 && setHover({ i, k })}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: v > 0 ? 'pointer' : 'default', transition: 'opacity .12s' }}/>
                );
              })}
              {(i % Math.ceil(data.length/12) === 0) && (
                <text x={x + barW/2} y={height - 8} textAnchor="middle" className="chart-axis">{formatLabel ? formatLabel(d[labelKey]) : Fin.fmtMonth(d[labelKey], { short: true })}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (() => {
        const i = hover.i, k = hover.k;
        const x = padding.l + i * (barW + gap) + gap/2;
        return (
          <div className="chart-tooltip" style={{ left: Math.min(w - 220, x + barW + 12), top: 8 }}>
            <div className="tt-label">{Fin.fmtMonth(data[i][labelKey])}</div>
            <div className="tt-row">
              <span className="tt-swatch" style={{ background: colors[k] }}></span>
              <span className="tt-key">{fmtKey(k)}</span>
              <span className="tt-val private">{formatY(data[i][k] || 0)}</span>
            </div>
            <div className="tt-total">Total <span className="private">{formatY(totals[i])}</span></div>
          </div>
        );
      })()}
    </div>
  );
}

// ── PAIRED INCOME-VS-EXPENSE BAR + NET LINE ────────────────────────────────
interface PairedBarDataPoint {
  ym: string;
  income: number;
  expense: number;
  investment?: number;
}

interface PairedBarsProps {
  data: PairedBarDataPoint[];
  height?: number;
  padding?: ChartPadding;
  onBarClick?: (ym: string) => void;
  activeYm?: string | null;
}

function PairedBars({ data, height = 260, padding = { l: 56, r: 16, t: 16, b: 28 }, onBarClick, activeYm }: PairedBarsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(Math.max(320, e.contentRect.width)); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const innerW = w - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const totalOut = (d: PairedBarDataPoint) => d.expense + (d.investment || 0);
  const maxV = Math.max(...data.map(d => Math.max(d.income, totalOut(d))), 1);
  const slotW = innerW / data.length;
  const barW = slotW * 0.32;
  const [hover, setHover] = useState<number | null>(null);

  const INCOME_COLOR = 'oklch(58% 0.08 140)';
  const EXPENSE_COLOR = 'oklch(58% 0.09 30)';
  const INV_COLOR = (Fin && Fin.INVESTMENT_COLOR) || 'oklch(60% 0.11 240)';

  const ticks: { v: number; y: number }[] = [];
  for (let i = 0; i <= 4; i++) ticks.push({ v: (maxV*i)/4, y: padding.t + (1 - i/4) * innerH });
  const netMax = Math.max(...data.map(d => Math.abs(d.income - totalOut(d))), 1);
  const netY = (v: number) => padding.t + innerH/2 - (v / netMax) * (innerH/2 - 4);
  const anyInvestment = data.some(d => (d.investment || 0) > 0);

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.l} x2={w-padding.r} y1={t.y} y2={t.y} stroke="var(--rule)" strokeDasharray="2 3"/>
            <text x={padding.l - 8} y={t.y + 3} textAnchor="end" className="chart-axis private">{Fin.fmtILS(t.v, { compact: true })}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padding.l + i * slotW + slotW/2;
          const incH = (d.income/maxV) * innerH;
          const expH = (d.expense/maxV) * innerH;
          const invH = ((d.investment || 0)/maxV) * innerH;
          const baseY = padding.t + innerH;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
               onClick={() => onBarClick?.(d.ym)}
               style={{ cursor: onBarClick ? 'pointer' : 'default' }}
               opacity={hover == null || hover === i ? 1 : 0.5}>
              {activeYm === d.ym && (
                <rect x={cx - barW - 5} y={padding.t} width={barW * 2 + 14} height={innerH}
                  fill="var(--accent)" opacity="0.08" rx="3"/>
              )}
              <rect x={cx - barW - 2} y={baseY - incH} width={barW} height={incH} fill={INCOME_COLOR}/>
              <rect x={cx + 2}        y={baseY - expH} width={barW} height={expH} fill={EXPENSE_COLOR}/>
              {invH > 0 && (
                <rect x={cx + 2} y={baseY - expH - invH} width={barW} height={invH} fill={INV_COLOR}/>
              )}
              {(i % Math.ceil(data.length/12) === 0) && (
                <text x={cx} y={height - 8} textAnchor="middle" className="chart-axis">{Fin.fmtMonth(d.ym, { short: true })}</text>
              )}
            </g>
          );
        })}
        <path
          d={data.map((d, i) => {
            const cx = padding.l + i * slotW + slotW/2;
            const v = d.income - totalOut(d);
            return `${i === 0 ? 'M' : 'L'}${cx.toFixed(1)},${netY(v).toFixed(1)}`;
          }).join(' ')}
          fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="0" opacity="0.65"
        />
      </svg>
      {hover != null && (() => {
        const d = data[hover];
        const inv = d.investment || 0;
        return (
          <div className="chart-tooltip" style={{ left: Math.min(w - 220, padding.l + hover * slotW + 12), top: 8 }}>
            <div className="tt-label">{Fin.fmtMonth(d.ym)}</div>
            <div className="tt-row"><span className="tt-swatch" style={{ background: INCOME_COLOR }}></span><span className="tt-key">Income</span><span className="tt-val private">{Fin.fmtILS(d.income)}</span></div>
            <div className="tt-row"><span className="tt-swatch" style={{ background: EXPENSE_COLOR }}></span><span className="tt-key">Expense</span><span className="tt-val private">{Fin.fmtILS(d.expense)}</span></div>
            {anyInvestment && (
              <div className="tt-row"><span className="tt-swatch" style={{ background: INV_COLOR }}></span><span className="tt-key">Savings</span><span className="tt-val private">{Fin.fmtILS(inv)}</span></div>
            )}
            <div className="tt-total">Net <span className="private">{Fin.fmtSigned(d.income - d.expense - inv)}</span></div>
          </div>
        );
      })()}
    </div>
  );
}

// ── DOUGHNUT ───────────────────────────────────────────────────────────────
interface DonutEntry {
  value: number;
  color: string;
  label: string;
}

interface DonutProps {
  entries: DonutEntry[];
  size?: number;
  thickness?: number;
  total?: number;
  centerLabel?: string;
  centerValue?: string;
  hover?: number | null;
  onHover?: (i: number | null) => void;
}

function Donut({ entries, size = 200, thickness = 26, total, centerLabel, centerValue, hover, onHover }: DonutProps) {
  const t = total ?? entries.reduce((s, e) => s + e.value, 0);
  const r = size/2 - 2;
  const ri = r - thickness;
  const cx = size/2, cy = size/2;
  let acc = 0;
  const segs = entries.map((e) => {
    const a0 = (acc / t) * Math.PI * 2 - Math.PI/2;
    acc += e.value;
    const a1 = (acc / t) * Math.PI * 2 - Math.PI/2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + Math.cos(a0)*r, y0 = cy + Math.sin(a0)*r;
    const x1 = cx + Math.cos(a1)*r, y1 = cy + Math.sin(a1)*r;
    const xi0 = cx + Math.cos(a0)*ri, yi0 = cy + Math.sin(a0)*ri;
    const xi1 = cx + Math.cos(a1)*ri, yi1 = cy + Math.sin(a1)*ri;
    const d = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${ri},${ri} 0 ${large} 0 ${xi0},${yi0} Z`;
    return { d, color: e.color, label: e.label, value: e.value };
  });
  return (
    <div className="donut-wrap">
      <svg width={size} height={size}>
        {segs.map((s, i) => (
          <path key={i} d={s.d} fill={s.color}
            opacity={hover == null || hover === i ? 1 : 0.3}
            onMouseEnter={() => onHover && onHover(i)}
            onMouseLeave={() => onHover && onHover(null)}
            style={{ cursor: onHover ? 'pointer' : 'default', transition: 'opacity .15s' }}/>
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="donut-label">{centerLabel}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="donut-value private">{centerValue}</text>
      </svg>
    </div>
  );
}

// ── SPARKLINE ──────────────────────────────────────────────────────────────
interface SparklineProps {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
}

function Sparkline({ values, w = 100, h = 26, color = 'currentColor' }: SparklineProps) {
  if (!values.length) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const r = max - min || 1;
  const pts = values.map((v: number, i: number) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / r) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} className="spark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2"/>
    </svg>
  );
}

// ── SQUARIFIED TREEMAP (Bruls/Huijin/van Wijk — keeps rects close to square) ─
interface TreemapItem {
  value: number;
  label: string;
  color: string;
  icon?: string;
  [key: string]: any;
}

interface LayoutItem extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarify(items: TreemapItem[], x0: number, y0: number, x1: number, y1: number): LayoutItem[] {
  const layout: LayoutItem[] = [];
  let remaining = items.slice().sort((a, b) => b.value - a.value);
  let rect = { x0, y0, x1, y1 };

  const worst = (row: TreemapItem[], side: number, scale: number) => {
    if (row.length === 0) return Infinity;
    let sum = 0, max = 0, min = Infinity;
    for (const it of row) {
      const a = it.value * scale;
      sum += a;
      if (a > max) max = a;
      if (a < min) min = a;
    }
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  while (remaining.length) {
    const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
    const side = Math.min(w, h);
    const remainArea = w * h;
    const remainTotal = remaining.reduce((s, i) => s + i.value, 0) || 1;
    const scale = remainArea / remainTotal;

    let row: TreemapItem[] = [];
    let i = 0;
    while (i < remaining.length) {
      const candidate = [...row, remaining[i]];
      if (row.length && worst(candidate, side, scale) > worst(row, side, scale)) break;
      row = candidate;
      i++;
    }

    const rowSum = row.reduce((s, it) => s + it.value, 0);
    const rowArea = rowSum * scale;
    if (w >= h) {
      const colW = rowArea / h;
      let yc = rect.y0;
      for (const it of row) {
        const ih = (it.value * scale) / colW;
        layout.push({ ...it, x: rect.x0, y: yc, w: colW, h: ih });
        yc += ih;
      }
      rect = { x0: rect.x0 + colW, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
    } else {
      const rowH = rowArea / w;
      let xc = rect.x0;
      for (const it of row) {
        const iw = (it.value * scale) / rowH;
        layout.push({ ...it, x: xc, y: rect.y0, w: iw, h: rowH });
        xc += iw;
      }
      rect = { x0: rect.x0, y0: rect.y0 + rowH, x1: rect.x1, y1: rect.y1 };
    }
    remaining = remaining.slice(row.length);
  }
  return layout;
}

interface TreemapProps {
  items: TreemapItem[];
  height?: number;
}

function Treemap({ items, height = 320 }: TreemapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(Math.max(320, e.contentRect.width)); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => squarify(items, 0, 0, w, height), [items, w, height]);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;

  return (
    <div ref={wrapRef} className="chart-wrap treemap-wrap">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="treemap">
        {layout.map((it, i) => {
          const big = it.w > 80 && it.h > 50;
          const showLabel = it.w > 56 && it.h > 28;
          const dim = hover != null && hover !== i;
          return (
            <g key={i}
               onMouseEnter={() => setHover(i)}
               onMouseLeave={() => setHover(null)}
               style={{ cursor: 'pointer', transition: 'opacity .12s' }}
               opacity={dim ? 0.4 : 1}>
              <rect x={it.x} y={it.y} width={it.w} height={it.h}
                    fill={it.color}
                    stroke={hover === i ? 'var(--ink)' : 'var(--bg)'}
                    strokeWidth={hover === i ? 1.5 : 1}/>
              {showLabel && (
                <>
                  {it.icon && big && (
                    <foreignObject x={it.x + 8} y={it.y + 8} width="16" height="16">
                      <Icon name={it.icon} size={14} color="var(--bg)"/>
                    </foreignObject>
                  )}
                  <text x={it.x + 8} y={it.y + (big ? 38 : 18)} className="tm-label">{it.label}</text>
                  <text x={it.x + 8} y={it.y + (big ? 54 : 34)} className="tm-value private">{Fin.fmtILS(it.value, { compact: true })}</text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && layout[hover] && (() => {
        const it = layout[hover];
        const tipX = Math.min(w - 220, it.x + it.w + 8);
        const tipY = Math.max(0, Math.min(height - 80, it.y));
        return (
          <div className="chart-tooltip" style={{ left: tipX, top: tipY }}>
            <div className="tt-label">{it.label}</div>
            <div className="tt-value private">{Fin.fmtILS(it.value)}</div>
            <div className="tt-sub"><span className="private">{Fin.fmtPct(it.value / total)}</span> of total</div>
          </div>
        );
      })()}
    </div>
  );
}

export { TimeRangeFilter, LineChart, StackedBar, PairedBars, Donut, Sparkline, Treemap };
