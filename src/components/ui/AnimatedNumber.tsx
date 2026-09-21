import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { cn } from '../../lib/utils';

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

// ─── Smooth Sine Easing ──────────────────────────────────────────────────────
// Perfect ease-in-out: zero velocity at both ends, smooth acceleration/deceleration
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// ─── Single Spinning Digit Reel ──────────────────────────────────────────────
//
// IMPORTANT: the container div below is rendered EMPTY by React — every node
// inside it is created imperatively in the effect and tracked in ribbonRef.
// React never reconciles children of this container, so imperative DOM
// mutations here can never desync the virtual DOM (the previous version
// rendered a React child into the same container and wiped it with
// innerHTML = '', which crashed team dashboards with
// "Failed to execute 'removeChild'" on every realtime score update).

function DigitReel({
  digit,
  duration,
  delay,
  digitHeight,
}: {
  digit: number;
  duration: number;
  delay: number;
  digitHeight: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ribbonRef = useRef<HTMLDivElement | null>(null);
  const prevDigitRef = useRef(digit);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Cancel any running animation
    if (animRef.current) cancelAnimationFrame(animRef.current);

    const prev = prevDigitRef.current;
    prevDigitRef.current = digit;

    const digitChanged = prev !== digit;
    const increasing = digit >= prev && !(prev === 9 && digit === 0);
    const isRollover =
      (prev === 9 && digit === 0) || (prev === 0 && digit === 9);

    let ribbon = ribbonRef.current;
    let needsRebuild = false;

    // Check if current ribbon matches the expected prev digit AND height —
    // a digitHeight change (responsive font resize) invalidates row geometry.
    if (ribbon) {
      const firstRow = ribbon.firstElementChild as HTMLElement | null;
      const rowHeight = firstRow ? parseFloat(firstRow.style.height) : NaN;
      if (
        !firstRow ||
        firstRow.textContent !== String(prev) ||
        Math.abs(rowHeight - digitHeight) > 0.5
      ) {
        needsRebuild = true;
      }
    }

    // Build or rebuild ribbon
    if (!ribbon || needsRebuild) {
      // For rollover (9→0 or 0→9), build a longer ribbon: [prev, prev+/-1, ..., digit]
      if (isRollover) {
        const sequence: number[] = [prev];
        if (increasing) {
          let d = prev;
          while (d !== digit) {
            d = (d + 1) % 10;
            sequence.push(d);
          }
        } else {
          let d = prev;
          while (d !== digit) {
            d = (d + 9) % 10;
            sequence.push(d);
          }
        }
        ribbon = buildRibbon(sequence, digitHeight);
      } else {
        // Simple transition: build a standard 0-9 ribbon
        ribbon = buildRibbon([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], digitHeight);
      }

      // Safe swap: never wipe the container with innerHTML — replace only
      // the node we created and track. If React ever renders a child here
      // (it shouldn't), it is preserved untouched.
      if (ribbonRef.current && ribbonRef.current.parentNode === container) {
        container.replaceChild(ribbon, ribbonRef.current);
      } else {
        container.replaceChildren(ribbon);
      }
      ribbonRef.current = ribbon;
    }

    // Determine target translateY
    const isRibbonFull = !isRollover; // Full 0-9 ribbon
    let targetY: number;

    if (isRibbonFull) {
      // 0-9 ribbon: digit N is at row index N
      targetY = -(digit * digitHeight);
    } else {
      // Custom ribbon: digit is at last row
      const childCount = ribbon.children.length;
      targetY = -((childCount - 1) * digitHeight);
    }

    // Start at prev position (instant, no animation) when the digit changed,
    // or at the target when it didn't (e.g. digitHeight changed on re-layout).
    const startPos = digitChanged
      ? (isRibbonFull ? -(prev * digitHeight) : 0)
      : targetY;
    ribbon.style.transform = `translateY(${startPos}px)`;
    ribbon.style.transition = 'none';

    if (!digitChanged) return; // nothing to animate, ribbon is already in place

    // Animate to target after a tiny settling frame
    let startTs: number | null = null;

    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const elapsed = ts - startTs;

      if (elapsed < delay) {
        animRef.current = requestAnimationFrame(step);
        return;
      }

      const t = Math.min((elapsed - delay) / duration, 1);
      const eased = easeInOutSine(t);
      const y = startPos + (targetY - startPos) * eased;
      ribbon!.style.transform = `translateY(${y}px)`;

      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };

    animRef.current = requestAnimationFrame(step);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [digit, duration, delay, digitHeight]);

  // On unmount, cancel any pending animation frame.
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // React renders the container EMPTY — all content is imperative (see above).
  // Width must be explicit (1ch of the inherited monospace, tabular font):
  // the only child is position:absolute, so without a width this inline-flex
  // collapses to 0px and overflow:hidden makes the digit invisible.
  return (
    <div
      ref={containerRef}
      style={{
        height: `${digitHeight}px`,
        width: '1ch',
        overflow: 'hidden',
        position: 'relative',
        lineHeight: 1,
      }}
      className="inline-flex items-center justify-center"
    />
  );
}

// ─── Build a ribbon element with given digit sequence ────────────────────────

function buildRibbon(sequence: number[], digitHeight: number): HTMLDivElement {
  const ribbon = document.createElement('div');
  ribbon.style.cssText = `position:absolute;top:0;left:0;width:100%;will-change:transform;`;

  for (const d of sequence) {
    const row = document.createElement('div');
    row.style.cssText = `
      height:${digitHeight}px;
      display:flex;align-items:center;justify-content:center;
      font-size:inherit;font-weight:inherit;font-family:inherit;
      color:inherit;line-height:1;
      -webkit-font-smoothing:antialiased;
      -moz-osx-font-smoothing:grayscale;
    `;
    row.textContent = String(d);
    ribbon.appendChild(row);
  }

  return ribbon;
}

// ─── Static Separator Character (comma, dot, etc.) ──────────────────────────

function StaticChar({
  char,
  digitHeight,
}: {
  char: string;
  digitHeight: number;
}) {
  return (
    <div
      style={{
        height: `${digitHeight}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
      }}
      className="inline-flex items-center justify-center"
    >
      {char}
    </div>
  );
}

// ─── Formatting ──────────────────────────────────────────────────────────────

type Token = { type: 'digit'; value: number } | { type: 'sep'; char: string };

function formatWithCommas(n: number): string {
  return n.toLocaleString('en-US');
}

function parseToTokens(formatted: string): Token[] {
  const tokens: Token[] = [];
  for (const ch of formatted) {
    if (ch >= '0' && ch <= '9') {
      tokens.push({ type: 'digit', value: parseInt(ch, 10) });
    } else {
      tokens.push({ type: 'sep', char: ch });
    }
  }
  return tokens;
}

// ─── Main Odometer Component ─────────────────────────────────────────────────

export function AnimatedNumber({
  value,
  duration = 1200,
  className,
  prefix = '',
  suffix = '',
}: AnimatedNumberProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [digitHeight, setDigitHeight] = useState(36);

  // Measure the REAL rendered font size instead of sniffing class names.
  // Class sniffing broke twice: the projector wraps <AnimatedNumber> in a
  // text-7xl div (the component itself gets no className → 36px reels under
  // 72px glyphs → digits cropped in half), and .stat-value is responsive
  // (36px → 48px at md) which no static guess can track. The reel has
  // overflow:hidden, so its height MUST cover the actual em box.
  useLayoutEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    const measure = () => {
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      if (Number.isFinite(fontSize) && fontSize > 0) {
        // 5% headroom over the em box for rounding/antialiasing
        setDigitHeight(Math.ceil(fontSize * 1.05));
      }
    };

    measure();
    // Fires on responsive size changes (md: breakpoints) and font loading.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const formatted = useMemo(() => formatWithCommas(value), [value]);
  const tokens = useMemo(() => parseToTokens(formatted), [formatted]);

  const digitCount = useMemo(() => tokens.filter(t => t.type === 'digit').length, [tokens]);

  const digitPositions = useMemo(() => {
    const positions: number[] = [];
    let idx = 0;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (tokens[i].type === 'digit') {
        positions[i] = idx;
        idx++;
      }
    }
    return positions;
  }, [tokens]);

  const staggerPerColumn = 60;

  return (
    <span
      ref={spanRef}
      className={cn(
        'inline-flex items-center font-mono tabular-nums',
        className,
      )}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {prefix && <span className="mr-1">{prefix}</span>}
      {tokens.map((token, i) => {
        if (token.type === 'digit') {
          const pos = digitPositions[i] ?? 0;
          const delay = (digitCount - 1 - pos) * staggerPerColumn;
          return (
            <DigitReel
              key={i}
              digit={token.value}
              duration={duration}
              delay={delay}
              digitHeight={digitHeight}
            />
          );
        }
        return (
          <StaticChar key={i} char={token.char} digitHeight={digitHeight} />
        );
      })}
      {suffix && <span className="ml-1">{suffix}</span>}
    </span>
  );
}
