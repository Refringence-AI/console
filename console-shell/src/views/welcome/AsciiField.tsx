import { useEffect, useRef } from 'react';

/**
 * The ONE sanctioned ambient treatment for onboarding (replaces the static
 * dot-grid). A single canvas drawing braille glyphs in a slow wave-interference
 * field, in Console's own ink at very low opacity and radial-masked toward the
 * edges, so it never competes with the copy. No mouse interaction (calm, not a
 * toy). Honors prefers-reduced-motion: it paints one still frame and stops.
 *
 * Adapted to Console's restrained light-default aesthetic - palette-constrained
 * (foreground ink only), cheap (one rAF loop, sparse grid), masked.
 */

// Sparse braille set - dotty, organic, never reads as text.
const CHARS = '⠁⠂⠄⠈⠐⠠⡀⢀⠃⠅⠆⠉⠊⠌⠒⠔⠢⠤⡂⡄⡈⢂⢄⠓⠖⠦⡆⢆⠼⠿⣀⣄⣆⣧⣶⣷⣿';

export function AsciiField({
  className,
  cell = 26,
  opacity = 0.06,
  speed = 0.4,
  ink: inkProp,
}: {
  className?: string;
  cell?: number;
  opacity?: number;
  speed?: number;
  /** Override the auto-detected ink (e.g. "235, 235, 238" for a dark panel). */
  ink?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dark = document.documentElement.classList.contains('dark');
    const ink = inkProp ?? (dark ? '235, 235, 238' : '38, 38, 40');

    let cols = 0;
    let rows = 0;
    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;

    // A few slow background waves seeded once.
    const waves = Array.from({ length: 4 }, (_, i) => ({
      x: 0.2 + 0.6 * ((i * 0.37) % 1),
      y: 0.2 + 0.6 * ((i * 0.61) % 1),
      freq: 0.18 + 0.12 * ((i * 0.29) % 1),
      amp: 0.6 + 0.4 * ((i * 0.53) % 1),
      phase: i * 1.7,
      spd: 0.5 + 0.4 * ((i * 0.41) % 1),
    }));

    function resize() {
      const r = canvas!.getBoundingClientRect();
      w = r.width;
      h = r.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      ctx!.font = `${Math.floor(cell * 0.82)}px "Geist Mono", ui-monospace, monospace`;
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';
    }

    function frame() {
      ctx!.clearRect(0, 0, w, h);
      t += speed * 0.016;
      const cx = cols / 2;
      const cy = rows / 2;
      const maxR = Math.hypot(cx, cy);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let v = 0;
          for (const wv of waves) {
            const dx = x - wv.x * cols;
            const dy = y - wv.y * rows;
            const d = Math.sqrt(dx * dx + dy * dy);
            v += Math.sin(d * wv.freq - t * wv.spd + wv.phase) * wv.amp / (1 + d * 0.08);
          }
          if (Math.abs(v) < 0.35) continue;
          // Radial edge fade so the field stays calm behind the card.
          const edge = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / maxR);
          const a = opacity * Math.min(1, (Math.abs(v) - 0.35) * 1.4) * (0.35 + 0.65 * edge);
          if (a < 0.01) continue;
          const ch = CHARS[Math.min(CHARS.length - 1, Math.floor(((v + 2) / 4) * (CHARS.length - 1)))];
          ctx!.fillStyle = `rgba(${ink}, ${a})`;
          ctx!.fillText(ch, x * cell + cell / 2, y * cell + cell / 2);
        }
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    }

    resize();
    frame();
    const onResize = () => { resize(); if (reduce) frame(); };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [cell, opacity, speed, inkProp]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
