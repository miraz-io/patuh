import { useState, type ReactNode } from "react";
import type { T } from "./i18n.js";
import { Card } from "./ui.js";

export type Overview = {
  pipeline: { registered: number; required: number; assessed: number; complete: number; signed: number };
  matrix: { before: number[][]; after: number[][] };
  controls: { planned: number; inProgress: number; done: number };
  departments: { name: string; counts: Record<"low" | "medium" | "high" | "very-high" | "none", number>; total: number }[];
};
type Tip = { x: number; y: number; title: string; rows: [string, string][] } | null;
type Tips = { show: (e: React.PointerEvent | React.FocusEvent, title: string, rows: [string, string][]) => void; hide: () => void };

// One shared tooltip. Values lead, names follow. Text goes in as React text (never HTML).
function useTip(): Tips & { node: ReactNode } {
  const [tip, setTip] = useState<Tip>(null);
  const show: Tips["show"] = (e, title, rows) => {
    if ("clientX" in e) setTip({ x: e.clientX, y: e.clientY, title, rows });
    else { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); setTip({ x: b.left + b.width / 2, y: b.bottom, title, rows }); }
  };
  const node = tip && <div role="tooltip" className="pointer-events-none fixed z-50 max-w-60 rounded-md border bg-card px-3 py-2 text-xs shadow-md" style={{ left: Math.max(8, Math.min(tip.x + 12, innerWidth - 250)), top: tip.y + 16 }}>
    <div className="mb-1 text-muted-foreground">{tip.title}</div>
    {tip.rows.map(([k, v]) => <div key={k} className="flex gap-2"><span className="font-semibold">{v}</span><span className="text-muted-foreground">{k}</span></div>)}
  </div>;
  return { show, hide: () => setTip(null), node };
}

type TableData = { head: string[]; rows: (string | number)[][] };

// A chart always has a table twin: the same numbers, readable without colour or a pointer.
function ChartCard({ title, sub, t, table, className = "", children }: { title: string; sub: string; t: T; table: TableData; className?: string; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return <Card className={className}>
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="font-medium">{title}</h2><p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{sub}</p></div>
      <div role="group" aria-label={title} className="flex shrink-0 overflow-hidden rounded-md border text-xs">
        {([false, true] as const).map((v) => <button key={String(v)} aria-pressed={asTable === v} onClick={() => setAsTable(v)}
          className={`px-2.5 py-1 ${asTable === v ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>{v ? t.charts.view.table : t.charts.view.chart}</button>)}
      </div>
    </div>
    <div className="mt-4">{asTable
      ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground">{table.head.map((h) => <th key={h} className="py-1.5 pr-4 font-medium">{h}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b last:border-0">{r.map((c, j) => <td key={j} className="py-1.5 pr-4 tabular-nums">{c}</td>)}</tr>)}</tbody></table></div>
      : children}</div>
  </Card>;
}

const Legend = ({ items }: { items: { name: string; color: string }[] }) =>
  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{items.map((i) => <li key={i.name} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: i.color }} />{i.name}</li>)}</ul>;

const Empty = ({ t }: { t: T }) => <p className="py-6 text-center text-sm text-muted-foreground">{t.charts.empty}</p>;

// ---------- DPIA journey: ordered stages, one blue ramp (ordinal), value at the tip ----------
const RAMP = ["var(--viz-250)", "var(--viz-350)", "var(--viz-450)", "var(--viz-550)", "var(--viz-650)"];
export function PipelineChart({ o, t }: { o: Overview; t: T }) {
  const tip = useTip(); const p = o.pipeline, c = t.charts;
  const stages = (["registered", "required", "assessed", "complete", "signed"] as const).map((k) => ({ k, name: c.stages[k], v: p[k] }));
  const max = Math.max(1, p.registered);
  return <ChartCard title={c.journey} sub={c.journeySub} t={t} table={{ head: [c.journey, t.total], rows: stages.map((s) => [s.name, s.v]) }}>
    {p.registered === 0 ? <Empty t={t} /> : <div className="space-y-2.5">
      {stages.map((s, i) => <div key={s.k} className="grid grid-cols-[8.5rem_1fr] items-center gap-3">
        <span className="truncate text-sm text-muted-foreground">{s.name}</span>
        <div className="relative mr-10 h-6">
          <div tabIndex={0} role="img" aria-label={`${s.name}: ${s.v}`} className="absolute inset-y-0.5 left-0 rounded-r-[4px] outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 ring-ring"
            style={{ width: `${(s.v / max) * 100}%`, minWidth: s.v ? 4 : 0, background: RAMP[i] }}
            onPointerMove={(e) => tip.show(e, s.name, [[c.processes, String(s.v)], ...(i ? [[`% ${c.stages.registered.toLowerCase()}`, `${Math.round((s.v / max) * 100)}%`] as [string, string]] : [])])}
            onPointerLeave={tip.hide} onFocus={(e) => tip.show(e, s.name, [[c.processes, String(s.v)]])} onBlur={tip.hide} />
          <span className="absolute top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ left: `calc(${(s.v / max) * 100}% + 8px)` }}>{s.v}</span>
        </div>
      </div>)}
    </div>}
    {tip.node}
  </ChartCard>;
}

// ---------- Controls: one whole split into three ordered parts (tall segmented bar) ----------
export function ControlsChart({ o, t }: { o: Overview; t: T }) {
  const tip = useTip(); const k = o.controls, c = t.charts;
  const total = k.done + k.inProgress + k.planned;
  const parts = [{ name: c.done, v: k.done, color: "var(--viz-550)", ink: "var(--viz-ink-on-dark)" },
    { name: c.inProgress, v: k.inProgress, color: "var(--viz-350)", ink: "var(--viz-ink-on-light)" },
    { name: c.planned, v: k.planned, color: "var(--viz-250)", ink: "var(--viz-ink-on-light)" }];
  return <ChartCard title={c.controls} sub={c.controlsSub} t={t} table={{ head: [c.controls, c.controlsWord], rows: parts.map((p) => [p.name, p.v]) }}>
    {total === 0 ? <Empty t={t} /> : <>
      <div className="mb-3 text-3xl font-semibold">{Math.round((k.done / total) * 100)}%<span className="ml-2 text-sm font-normal text-muted-foreground">{c.done.toLowerCase()} · {total} {c.controlsWord}</span></div>
      <div className="flex h-7 gap-[2px]" role="img" aria-label={parts.map((p) => `${p.name} ${p.v}`).join(", ")}>
        {parts.filter((p) => p.v > 0).map((p) => {
          const pct = (p.v / total) * 100;
          return <div key={p.name} tabIndex={0} className="flex items-center rounded-[4px] pl-2 text-xs font-semibold outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 ring-ring"
            style={{ width: `${pct}%`, background: p.color, color: p.ink }}
            onPointerMove={(e) => tip.show(e, p.name, [[c.controlsWord, String(p.v)], ["%", `${Math.round(pct)}%`]])} onPointerLeave={tip.hide}
            onFocus={(e) => tip.show(e, p.name, [[c.controlsWord, String(p.v)]])} onBlur={tip.hide}>{pct >= 12 ? `${Math.round(pct)}%` : ""}</div>; // too narrow for text: the tooltip and table carry it
        })}
      </div>
      <Legend items={parts.map((p) => ({ name: p.name, color: p.color }))} />
    </>}
    {tip.node}
  </ChartCard>;
}

// ---------- Risk grids: before and after, same colour scale, so the reduction is visible ----------
const HEAT = ["#cde2fb", "#9ec5f4", "#5598e7", "#256abf", "#104281"]; // sequential blue, one hue
const zone = (l: number, s: number, t: T) => { const n = l * s; return t.charts.level[n >= 12 ? "very-high" : n >= 8 ? "high" : n >= 4 ? "medium" : "low"]; };

function HeatGrid({ data, max, title, t, tip }: { data: number[][]; max: number; title: string; t: T; tip: Tips }) {
  const c = t.charts;
  return <div className="min-w-0 flex-1">
    <div className="mb-1.5 text-sm font-medium">{title} <span className="font-normal text-muted-foreground">· {data.flat().reduce((a, b) => a + b, 0)} {c.risksWord}</span></div>
    <div className="grid grid-cols-[1rem_1fr] gap-x-2">
      <div className="grid grid-rows-4 gap-[2px] text-center text-xs text-muted-foreground">{[4, 3, 2, 1].map((s) => <span key={s} className="flex items-center justify-center">{s}</span>)}</div>
      <div className="grid grid-cols-4 gap-[2px]">
        {[3, 2, 1, 0].flatMap((si) => [0, 1, 2, 3].map((li) => {
          const n = data[si][li], idx = Math.min(4, Math.ceil((n / max) * 5) - 1);
          const label = c.cell.replace("{l}", String(li + 1)).replace("{s}", String(si + 1));
          return <div key={`${si}-${li}`} tabIndex={0} role="img" aria-label={`${label}: ${n} ${c.risksWord}`}
            className="flex h-12 items-center justify-center rounded-[4px] text-sm font-semibold outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 ring-ring"
            style={{ background: n ? HEAT[idx] : "var(--muted)", color: idx >= 2 ? "var(--viz-ink-on-dark)" : "var(--viz-ink-on-light)" }}
            onPointerMove={(e) => tip.show(e, label, [[c.risksWord, String(n)], [t.status, zone(li + 1, si + 1, t)]])} onPointerLeave={tip.hide}
            onFocus={(e) => tip.show(e, label, [[c.risksWord, String(n)]])} onBlur={tip.hide}>{n || ""}</div>;
        }))}
      </div>
      <span />
      <div className="mt-1 grid grid-cols-4 gap-[2px] text-center text-xs text-muted-foreground">{[1, 2, 3, 4].map((l) => <span key={l}>{l}</span>)}</div>
    </div>
    <div className="mt-1 flex justify-between pl-6 text-xs text-muted-foreground"><span>{c.likelihood} →</span><span>↑ {c.severity}</span></div>
  </div>;
}

export function RiskChart({ o, t, className = "" }: { o: Overview; t: T; className?: string }) {
  const tip = useTip(); const c = t.charts;
  const max = Math.max(1, ...o.matrix.before.flat(), ...o.matrix.after.flat());
  const rows: (string | number)[][] = [];
  for (let s = 4; s >= 1; s--) for (let l = 1; l <= 4; l++) rows.push([s, l, o.matrix.before[s - 1][l - 1], o.matrix.after[s - 1][l - 1]]);
  const none = o.matrix.before.flat().every((n) => n === 0);
  return <ChartCard className={className} title={c.risk} sub={c.riskSub} t={t} table={{ head: [c.severity, c.likelihood, c.before, c.after], rows }}>
    {none ? <Empty t={t} /> : <>
      <div className="flex flex-col gap-6 sm:flex-row"><HeatGrid data={o.matrix.before} max={max} title={c.before} t={t} tip={tip} /><HeatGrid data={o.matrix.after} max={max} title={c.after} t={t} tip={tip} /></div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><span>{c.lower}</span>
        <span className="flex gap-[2px]">{HEAT.map((h) => <span key={h} className="h-2.5 w-6 rounded-[2px]" style={{ background: h }} />)}</span><span>{c.higher}</span></div>
    </>}
    {tip.node}
  </ChartCard>;
}

// ---------- Residual risk by department: stacked bars in the fixed status colours, worst first ----------
const LEVELS = [
  { k: "very-high", color: "var(--viz-critical)", ink: "var(--viz-ink-on-dark)" },
  { k: "high", color: "var(--viz-serious)", ink: "var(--viz-ink-on-dark)" },
  { k: "medium", color: "var(--viz-warning)", ink: "var(--viz-ink-on-light)" },
  { k: "low", color: "var(--viz-good)", ink: "var(--viz-ink-on-dark)" },
  { k: "none", color: "var(--viz-none)", ink: "var(--viz-ink-on-light)" },
] as const;

export function DepartmentChart({ o, t, className = "" }: { o: Overview; t: T; className?: string }) {
  const tip = useTip(); const c = t.charts;
  const max = Math.max(1, ...o.departments.map((d) => d.total));
  return <ChartCard className={className} title={c.dept} sub={c.deptSub} t={t}
    table={{ head: [t.dept, ...LEVELS.map((l) => c.level[l.k])], rows: o.departments.map((d) => [d.name, ...LEVELS.map((l) => d.counts[l.k])]) }}>
    {o.departments.length === 0 ? <Empty t={t} /> : <>
      <div className="space-y-2.5">{o.departments.map((d) => {
        const segs = LEVELS.filter((l) => d.counts[l.k] > 0);
        return <div key={d.name} className="grid grid-cols-[8.5rem_1fr] items-center gap-3">
          <span className="truncate text-sm text-muted-foreground" title={d.name}>{d.name}</span>
          <div className="mr-10 flex h-5 gap-[2px]" role="img" aria-label={`${d.name}: ${segs.map((l) => `${c.level[l.k]} ${d.counts[l.k]}`).join(", ")}`}>
            {segs.map((l, i) => {
              const pct = (d.counts[l.k] / max) * 100;
              return <div key={l.k} tabIndex={0} className={`flex items-center justify-center text-xs font-semibold outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 ring-ring ${i === segs.length - 1 ? "rounded-r-[4px]" : ""}`}
                style={{ width: `${pct}%`, minWidth: 6, background: l.color, color: l.ink }}
                onPointerMove={(e) => tip.show(e, d.name, [[c.level[l.k], String(d.counts[l.k])], [c.processes, String(d.total)]])} onPointerLeave={tip.hide}
                onFocus={(e) => tip.show(e, d.name, [[c.level[l.k], String(d.counts[l.k])]])} onBlur={tip.hide}>{pct >= 7 ? d.counts[l.k] : ""}</div>; // too narrow for text: tooltip and table carry it
            })}
          </div>
        </div>;
      })}</div>
      <Legend items={LEVELS.map((l) => ({ name: c.level[l.k], color: l.color }))} />
    </>}
    {tip.node}
  </ChartCard>;
}
