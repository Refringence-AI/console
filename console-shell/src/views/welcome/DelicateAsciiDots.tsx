import { useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

// Ported from flocast's sign-in background: a canvas field of braille glyphs
// driven by interfering sine waves, gently reactive to the pointer (hover ripple
// + click waves). Adapted for Console: fills its parent (not a fixed 40rem),
// typed, and honours prefers-reduced-motion (one static frame, no loop). Kept
// deliberately subtle for the onboarding left panel via low opacity at the call
// site.

interface DelicateAsciiDotsProps {
    /** Solid fill behind the glyphs (match the panel so it blends). */
    backgroundColor?: string;
    /** Glyph colour as an "r, g, b" triplet (alpha is applied per cell). */
    textColor?: string;
    gridSize?: number;
    animationSpeed?: number;
    className?: string;
}

interface Wave {
    x: number;
    y: number;
    frequency: number;
    amplitude: number;
    phase: number;
    speed: number;
}

interface GridCell {
    char: string;
    opacity: number;
}

const CHARS =
    '⣧⣩⣪⣫⣬⣭⣮⣯⣱⣲⣳⣴⣵⣶⣷⣹⣺⣻⣼⣽⣾⣿⠁⠂⠄⠈⠐⠠⡀⢀⠃⠅⠘⠨⠊⠋⠌⠍⠎⠏⠑⠒⠓⠔⠕⠖⠗⠙⠚⠛⠜⠝⠞⠟⠡⠢⠣⠤⠥⠦⠧⠩⠪⠫⠬⠭⠮⠯⠱⠲⠳⠴⠵⠶⠷⠹⠺⠻⠼⠽⠾⠿⡁⡂⡃⡄⡅⡆⡇⡉⡊⡋⡌⡍⡎⡏⡑⡒⡓⡔⡕⡖⡗⡙⡚⡛⡜⡝⡞⡟⢁⢂⢃⢄⢅⢆⢇⢉⢊⢋⢌⢍⢎⢏⢑⢒⢓⢔⢕⢖⢗⢙⢚⢛⢜⢝⢞⢟⣀⣁⣂⣃⣄⣅⣆⣇⣉⣊⣋⣌⣍⣎⣏⣑⣒⣓⣔⣕⣖⣗⣙⣚⣛⣜⣝⣞⣟';

export function DelicateAsciiDots({
    backgroundColor = '#ffffff',
    textColor = '120, 120, 130',
    gridSize = 92,
    animationSpeed = 0.45,
    className,
}: DelicateAsciiDotsProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const mouseRef = useRef({ x: 0, y: 0 });
    const wavesRef = useRef<Wave[]>([]);
    const timeRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const clickWaves = useRef<Array<{ x: number; y: number; time: number; intensity: number }>>([]);
    const dimsRef = useRef({ width: 0, height: 0 });
    const startRef = useRef(0);

    const resize = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const rect = container.getBoundingClientRect();
        dimsRef.current = { width: rect.width, height: rect.height };
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
    }, []);

    const draw = useCallback((now: number) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        const { width, height } = dimsRef.current;
        if (width === 0 || height === 0) return;

        timeRef.current += animationSpeed * 0.016;
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);

        const cellW = width / gridSize;
        const cellH = height / gridSize;
        const mGX = mouseRef.current.x / cellW;
        const mGY = mouseRef.current.y / cellH;
        const mouseWave: Wave = { x: mGX, y: mGY, frequency: 0.3, amplitude: 1, phase: timeRef.current * 2, speed: 1 };
        const allWaves = wavesRef.current.concat(mouseWave);

        const fontSize = Math.min(cellW, cellH) * 0.8;
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                let total = 0;
                for (const w of allWaves) {
                    const dx = x - w.x;
                    const dy = y - w.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const falloff = 1 / (1 + dist * 0.1);
                    total += Math.sin(dist * w.frequency - timeRef.current * w.speed + w.phase) * w.amplitude * falloff;
                }
                // Click ripples.
                for (const cw of clickWaves.current) {
                    const age = now - cw.time;
                    if (age >= 4000) continue;
                    const dx = x - cw.x;
                    const dy = y - cw.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    const radius = (age / 4000) * gridSize * 0.8;
                    const band = gridSize * 0.15;
                    if (Math.abs(d - radius) < band) {
                        const strength = (1 - age / 4000) * cw.intensity;
                        total += strength * (1 - Math.abs(d - radius) / band) * Math.sin((d - radius) * 0.5);
                    }
                }
                const mDist = Math.sqrt((x - mGX) ** 2 + (y - mGY) ** 2);
                if (mDist < gridSize * 0.3) {
                    total += (1 - mDist / (gridSize * 0.3)) * 0.8 * Math.sin(timeRef.current * 3);
                }
                if (Math.abs(total) <= 0.2) continue;
                const norm = (total + 2) / 4;
                const ci = Math.min(CHARS.length - 1, Math.max(0, Math.floor(norm * (CHARS.length - 1))));
                const opacity = Math.min(0.9, Math.max(0.4, 0.4 + norm * 0.5));
                ctx.fillStyle = `rgba(${textColor}, ${opacity})`;
                ctx.fillText(CHARS[ci] || CHARS[0], x * cellW + cellW / 2, y * cellH + cellH / 2);
            }
        }
        clickWaves.current = clickWaves.current.filter((w) => now - w.time < 4000);
    }, [animationSpeed, backgroundColor, gridSize, textColor]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        wavesRef.current = Array.from({ length: 4 }, () => ({
            x: gridSize * (0.25 + Math.random() * 0.5),
            y: gridSize * (0.25 + Math.random() * 0.5),
            frequency: 0.2 + Math.random() * 0.3,
            amplitude: 0.5 + Math.random() * 0.5,
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 0.5,
        }));
        resize();

        const onResize = () => resize();
        const onMove = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };
        const onDown = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const { width, height } = dimsRef.current;
            clickWaves.current.push({
                x: ((e.clientX - rect.left) / width) * gridSize,
                y: ((e.clientY - rect.top) / height) * gridSize,
                time: performance.now(),
                intensity: 2,
            });
        };
        window.addEventListener('resize', onResize);
        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mousedown', onDown);

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        startRef.current = performance.now();
        if (reduced) {
            // One static frame, no loop.
            draw(performance.now());
        } else {
            const loop = (t: number) => {
                draw(t);
                rafRef.current = requestAnimationFrame(loop);
            };
            rafRef.current = requestAnimationFrame(loop);
        }

        return () => {
            window.removeEventListener('resize', onResize);
            canvas.removeEventListener('mousemove', onMove);
            canvas.removeEventListener('mousedown', onDown);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            timeRef.current = 0;
            clickWaves.current = [];
        };
    }, [draw, resize, gridSize]);

    return (
        <div ref={containerRef} className={cn('relative h-full w-full overflow-hidden', className)} style={{ backgroundColor }}>
            <canvas ref={canvasRef} className="block h-full w-full" />
        </div>
    );
}
