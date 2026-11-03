import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "./i18n.js";
import { TXT } from "./i18n.js";
import type { Page, Tour } from "./tours.js";
import { Btn } from "./ui.js";

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8, W = 360;
const find = (target?: string) => (target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null);
const toRect = (el: HTMLElement): Rect => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; };
const same = (a: Rect | null, b: Rect | null) => (!a || !b ? a === b : a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

// A guided tour: moves between screens, scrolls to each part, glides a cursor there and explains it.
// show(page) is supplied by the app so the tour can navigate for you.
export function TourPlayer({ tour, lang, show, onClose }: { tour: Tour; lang: Lang; show: (p: Page) => void; onClose: (completed: boolean) => void }) {
  const t = TXT[lang];
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [clicking, setClicking] = useState(false);
  const [back, setBack] = useState(false); // arrived by pressing Back: do not auto-click again, or the user could never go back
  const step = tour.steps[i], last = i === tour.steps.length - 1;
  const [missing, setMissing] = useState(false); // the step's target never appeared (e.g. an empty workspace): plain Next instead
  const auto = !!step.click && !back && !missing; // the cursor drives this step
  const waits = !!step.wait && !missing; // the user must click the highlighted item
  const autoRef = useRef(false); autoRef.current = auto;
  const el = useRef<HTMLElement | null>(null);
  const iRef = useRef(0); iRef.current = i;
  useEffect(() => setMissing(false), [i]);

  const go = useCallback((n: number) => {
    if (n < 0) return;
    setBack(n < iRef.current);
    if (n >= tour.steps.length) onClose(true); else setI(n);
  }, [tour.steps.length, onClose]);

  // Move to the step's screen, wait for its target, then scroll and track it.
  useEffect(() => {
    let dead = false; const timers: number[] = []; let raf = 0; let off = () => {};
    setRect(null); el.current = null; setClicking(false);
    show(step.page);
    const t0 = Date.now();
    const poll = () => {
      if (dead) return;
      const found = find(step.target);
      if (!step.target || found) {
        el.current = found;
        if (found) {
          const tall = found.getBoundingClientRect().height > innerHeight * 0.6;
          found.scrollIntoView({ block: tall ? "start" : "center", behavior: "smooth" });
          const loop = () => { if (dead || !el.current) return; const r = toRect(el.current); setRect((p) => (same(p, r) ? p : r)); raf = requestAnimationFrame(loop); };
          raf = requestAnimationFrame(loop);
          // read the position after the smooth scroll has mostly finished, not before
          timers.push(window.setTimeout(() => { const r = toRect(found); setCursor({ x: r.left + Math.min(r.width / 2, 160), y: r.top + Math.min(r.height / 2, 36) }); }, 650));
          if (autoRef.current) {
            timers.push(window.setTimeout(() => setClicking(true), 1800));
            timers.push(window.setTimeout(() => { found.click(); }, 2000));
            timers.push(window.setTimeout(() => go(i + 1), 3000));
          }
          if (step.wait) {
            const onClick = () => timers.push(window.setTimeout(() => go(i + 1), 250));
            found.addEventListener("click", onClick, { once: true });
            off = () => found.removeEventListener("click", onClick);
          }
        }
      } else if (Date.now() - t0 < 4000) timers.push(window.setTimeout(poll, 60));
      else setMissing(true); // target never appeared: show a centred note with a normal Next instead of blocking the tour
    };
    timers.push(window.setTimeout(poll, 120));
    return () => { dead = true; timers.forEach(clearTimeout); cancelAnimationFrame(raf); off(); };
  }, [i, step, show, go]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      else if (!auto && !waits && e.key === "ArrowRight") go(i + 1); // not Enter: a focused Next button already handles it
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [i, auto, waits, go, onClose]);

  // Popover position: beside the target when there is room, otherwise docked bottom right.
  const vw = innerWidth, vh = innerHeight;
  let pos: React.CSSProperties = { left: (vw - Math.min(W, vw - 24)) / 2, top: vh * 0.28 };
  if (rect) {
    const tall = rect.height > vh * 0.5;
    if (tall || vw < 760) pos = { right: 16, bottom: 16 };
    else if (rect.left + rect.width + W + 32 < vw) pos = { left: rect.left + rect.width + 20, top: Math.max(12, Math.min(rect.top, vh - 280)) };
    else if (rect.top + rect.height + 260 < vh) pos = { left: Math.max(12, Math.min(rect.left, vw - W - 12)), top: rect.top + rect.height + 16 };
    else pos = { left: Math.max(12, Math.min(rect.left, vw - W - 12)), bottom: vh - rect.top + 16 };
  }
  const block = "fixed z-[60]";
  const guard = waits && rect; // on "your turn" steps the highlighted item stays clickable
  return (
    <>
      {rect ? <div className="pointer-events-none fixed z-[55] rounded-lg transition-all duration-300"
        style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px rgba(0,0,0,.6), 0 0 0 2px var(--ring)" }} />
        : <div className="pointer-events-none fixed inset-0 z-[55] bg-black/60" />}
      {guard ? <>
        <div className={block} style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top - PAD) }} />
        <div className={block} style={{ top: rect.top + rect.height + PAD, left: 0, right: 0, bottom: 0 }} />
        <div className={block} style={{ top: rect.top - PAD, left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 }} />
        <div className={block} style={{ top: rect.top - PAD, left: rect.left + rect.width + PAD, right: 0, height: rect.height + PAD * 2 }} />
      </> : <div className={`${block} inset-0`} />}
      {cursor && <div className="pointer-events-none fixed z-[70]" style={{ left: cursor.x, top: cursor.y, transition: "left .9s cubic-bezier(.4,0,.2,1), top .9s cubic-bezier(.4,0,.2,1)" }}>
        {clicking && <span className="absolute -left-3 -top-3 size-7 animate-ping rounded-full bg-sky-400/60" />}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1.5"><path d="M4 2l16 9-7 2-3 7z" /></svg>
      </div>}
      <div role="dialog" aria-live="polite" className="fixed z-[80] rounded-lg border bg-card p-4 shadow-xl" style={{ ...pos, width: Math.min(W, vw - 24) }}>
        <div className="mb-1 text-xs text-muted-foreground">{tour.title[lang]} · {i + 1}/{tour.steps.length}</div>
        <div className="font-semibold">{step.title[lang]}</div>
        <p className="mt-1 text-sm text-muted-foreground">{step.body[lang]}</p>
        {waits && <p className="mt-2 text-sm font-medium">{t.tryIt}</p>}
        <div className="mt-3 flex items-center justify-between">
          <Btn variant="outline" onClick={() => onClose(false)}>{t.skip}</Btn>
          <div className="flex gap-2">
            <Btn variant="outline" disabled={i === 0} onClick={() => go(i - 1)}>{t.prev}</Btn>
            {!waits && !auto && <Btn onClick={() => go(i + 1)}>{last ? t.finish : t.next}</Btn>}
          </div>
        </div>
      </div>
    </>
  );
}
