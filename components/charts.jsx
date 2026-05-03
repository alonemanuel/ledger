// Hand-rolled SVG chart primitives for the dashboard.
const { useState, useMemo, useRef, useEffect } = React;

// ── LINE / AREA CHART ──────────────────────────────────────────────────────
function LineChart({ data, height = 220, color = 'var(--accent)', fill = true, padding = { l: 56, r: 16, t: 16, b: 28 }, yTicks = 4, onHover, formatY, tooltipExtra }) {
  const wrapRef = useRef(null);
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
  const xs = data.map((_, i) => padding.l + (i / Math.max(1, data.length - 1)) * innerW);
  const vals = data.map(d => d.value);
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 1);
  const range = maxV - minV || 1;
  const y = (v) => padding.t + (1 - (v - minV) / range) * innerH;

  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const areaPath = `${path} L${xs[xs.length-1].toFixed(1)},${(padding.t + innerH).toFixed(1)} L${xs[0].toFixed(1)},${(padding.t + innerH).toFixed(1)} Z`;

  const ticks = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = minV + (range * i) / yTicks;
    ticks.push({ v, y: y(v) });
  }

  const [hover, setHover] = useState(null);
  const handleMove = (e) => {
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
            <text x={padding.l - 8} y={t.y + 3} textAnchor="end" className="chart-axis">{formatY ? formatY(t.v) : Math.round(t.v).toLocaleString()}</text>
          </g>
        ))}
        {data.map((d, i) => (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) && (
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
          <div className="tt-value">{formatY ? formatY(data[hover].value) : Fin.fmtILS(data[hover].value)}</div>
          {tooltipExtra && tooltipExtra(data[hover])}
        </div>
      )}
    </div>
  );
}

// ── STACKED / GROUPED BAR ──────────────────────────────────────────────────
function StackedBar({ data, keys, colors, height = 240, padding = { l: 56, r: 16, t: 16, b: 28 }, formatY = Fin.fmtILS, formatLabel, labelKey = 'ym', labelFor }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(Math.max(320, e.contentRect.width)); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const innerW = w - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const totals = data.map(d => keys.reduce((s, k) => s + (d[k] || 0), 0));
  const maxV = Math.max(...totals, 1);
  const barW = (innerW / data.length) * 0.7;
  const gap = (innerW / data.length) * 0.3;
  const [hover, setHover] = useState(null); // { i, k }
  const fmtKey = labelFor || ((k) => k.replace(/_/g, ' '));

  const ticks = [];
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
            <text x={padding.l - 8} y={t.y + 3} textAnchor="end" className="chart-axis">{formatY(t.v, { compact: true })}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padding.l + i * (barW + gap) + gap/2;
          let yCursor = padding.t + innerH;
          return (
            <g key={i}>
              {keys.map(k => {
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
              <span className="tt-val">{formatY(data[i][k] || 0)}</span>
            </div>
            <div className="tt-total">Total {formatY(totals[i])}</div>
          </div>
        );
      })()}
    </div>
  );
}

// ── PAIRED INCOME-VS-EXPENSE BAR + NET LINE ────────────────────────────────
function PairedBars({ data, height = 260, padding = { l: 56, r: 16, t: 16, b: 28 } }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(Math.max(320, e.contentRect.width)); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const innerW = w - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const maxV = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);
  const slotW = innerW / data.length;
  const barW = slotW * 0.32;
  const [hover, setHover] = useState(null);

  const ticks = [];
  for (let i = 0; i <= 4; i++) ticks.push({ v: (maxV*i)/4, y: padding.t + (1 - i/4) * innerH });
  // net line, scaled to same axis but offset differently
  const netMax = Math.max(...data.map(d => Math.abs(d.income - d.expense)), 1);
  const netY = (v) => padding.t + innerH/2 - (v / netMax) * (innerH/2 - 4);

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.l} x2={w-padding.r} y1={t.y} y2={t.y} stroke="var(--rule)" strokeDasharray="2 3"/>
            <text x={padding.l - 8} y={t.y + 3} textAnchor="end" className="chart-axis">{Fin.fmtILS(t.v, { compact: true })}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padding.l + i * slotW + slotW/2;
          const incH = (d.income/maxV) * innerH;
          const expH = (d.expense/maxV) * innerH;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover == null || hover === i ? 1 : 0.5}>
              <rect x={cx - barW - 2} y={padding.t + innerH - incH} width={barW} height={incH} fill="oklch(58% 0.08 140)"/>
              <rect x={cx + 2}        y={padding.t + innerH - expH} width={barW} height={expH} fill="oklch(58% 0.09 30)"/>
              {(i % Math.ceil(data.length/12) === 0) && (
                <text x={cx} y={height - 8} textAnchor="middle" className="chart-axis">{Fin.fmtMonth(d.ym, { short: true })}</text>
              )}
            </g>
          );
        })}
        {/* net cashflow line */}
        <path
          d={data.map((d, i) => {
            const cx = padding.l + i * slotW + slotW/2;
            const v = d.income - d.expense;
            return `${i === 0 ? 'M' : 'L'}${cx.toFixed(1)},${netY(v).toFixed(1)}`;
          }).join(' ')}
          fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="0" opacity="0.65"
        />
      </svg>
      {hover != null && (() => {
        const d = data[hover];
        return (
          <div className="chart-tooltip" style={{ left: Math.min(w - 220, padding.l + hover * slotW + 12), top: 8 }}>
            <div className="tt-label">{Fin.fmtMonth(d.ym)}</div>
            <div className="tt-row"><span className="tt-swatch" style={{ background: 'oklch(58% 0.08 140)' }}></span><span className="tt-key">Income</span><span className="tt-val">{Fin.fmtILS(d.income)}</span></div>
            <div className="tt-row"><span className="tt-swatch" style={{ background: 'oklch(58% 0.09 30)' }}></span><span className="tt-key">Expense</span><span className="tt-val">{Fin.fmtILS(d.expense)}</span></div>
            <div className="tt-total">Net {Fin.fmtSigned(d.income - d.expense)}</div>
          </div>
        );
      })()}
    </div>
  );
}

// ── DOUGHNUT ───────────────────────────────────────────────────────────────
function Donut({ entries, size = 200, thickness = 26, total, centerLabel, centerValue, hover, onHover }) {
  const t = total ?? entries.reduce((s, e) => s + e.value, 0);
  const r = size/2 - 2;
  const ri = r - thickness;
  const cx = size/2, cy = size/2;
  let acc = 0;
  const segs = entries.map((e, i) => {
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
        <text x={cx} y={cy + 16} textAnchor="middle" className="donut-value">{centerValue}</text>
      </svg>
    </div>
  );
}

// ── SPARKLINE ──────────────────────────────────────────────────────────────
function Sparkline({ values, w = 100, h = 26, color = 'currentColor' }) {
  if (!values.length) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const r = max - min || 1;
  const pts = values.map((v, i) => {
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

// ── TREEMAP (squarified-ish, simple slice-and-dice) ────────────────────────
function Treemap({ items, width = 600, height = 260 }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  // simple slice-and-dice alternating
  const layout = [];
  let x = 0, y = 0, w = width, h = height;
  let horizontal = w > h;
  let remaining = items.slice().sort((a, b) => b.value - a.value);
  let remainTotal = total;
  while (remaining.length) {
    const it = remaining.shift();
    const frac = it.value / remainTotal;
    if (horizontal) {
      const ww = w * frac;
      layout.push({ ...it, x, y, w: ww, h });
      x += ww; w -= ww;
    } else {
      const hh = h * frac;
      layout.push({ ...it, x, y, w, h: hh });
      y += hh; h -= hh;
    }
    horizontal = !horizontal;
    remainTotal -= it.value;
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="treemap" preserveAspectRatio="none">
      {layout.map((it, i) => (
        <g key={i}>
          <rect x={it.x} y={it.y} width={it.w} height={it.h} fill={it.color} stroke="var(--bg)" strokeWidth="1"/>
          {it.w > 56 && it.h > 28 && (
            <>
              {it.icon && it.w > 80 && it.h > 50 && (
                <foreignObject x={it.x + 8} y={it.y + 8} width="16" height="16">
                  <Icon name={it.icon} size={14} color="var(--bg)"/>
                </foreignObject>
              )}
              <text x={it.x + 8} y={it.y + (it.icon && it.w > 80 && it.h > 50 ? 38 : 18)} className="tm-label">{it.label}</text>
              <text x={it.x + 8} y={it.y + (it.icon && it.w > 80 && it.h > 50 ? 54 : 34)} className="tm-value">{Fin.fmtILS(it.value, { compact: true })}</text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

Object.assign(window, { LineChart, StackedBar, PairedBars, Donut, Sparkline, Treemap });
