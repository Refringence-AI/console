import { useId } from 'react';
import { cn } from '@/lib/utils';

/** Siri-style prism orb - the Refringence brand mark, animated. Three blurred
 *  radial-gradient blobs (orange -> magenta -> violet -> cyan, the prism
 *  dispersion) orbit on offset axes; an SVG goo filter merges them so the shape
 *  morphs. Pure CSS/SVG, no canvas/three.js. Rendered only while the assistant
 *  is actively streaming (a brand "moment", not ambient chrome). Needs the
 *  `refringence-orb-orbit` keyframe in globals.
 */
export function BirefringenceOrb({ size = 18, className }: { size?: number; className?: string }) {
    const fid = useId().replace(/:/g, '');
    const blobSize = Math.round(size * 0.72);
    const orbit = Math.round(size * 0.18);

    return (
        <span
            className={cn('relative inline-block overflow-hidden rounded-full align-middle', className)}
            style={{ width: size, height: size }}
        >
            <svg width="0" height="0" className="absolute" aria-hidden>
                <defs>
                    <filter id={`oorb-${fid}`}>
                        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
                        <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
                        <feBlend in="SourceGraphic" in2="goo" />
                    </filter>
                </defs>
            </svg>
            <span className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08), rgba(0,0,0,0.35))' }} />
            <span className="absolute inset-0" style={{ filter: `url(#oorb-${fid})` }}>
                <Blob color="#fb923c" duration={3400} delay={0} size={blobSize} orbit={orbit} />
                <Blob color="#c084fc" duration={4000} delay={-1100} size={blobSize} orbit={orbit} />
                <Blob color="#22d3ee" duration={4600} delay={-2200} size={blobSize} orbit={orbit} />
                <Blob color="#f472b6" duration={4200} delay={-3000} size={Math.round(blobSize * 0.9)} orbit={orbit} />
            </span>
            <span className="pointer-events-none absolute inset-0 rounded-full opacity-70 mix-blend-screen" style={{ background: 'radial-gradient(circle at 35% 28%, rgba(255,255,255,0.70), transparent 42%)' }} />
        </span>
    );
}

function Blob({ color, duration, delay, size, orbit }: { color: string; duration: number; delay: number; size: number; orbit: number }) {
    return (
        <span
            className="absolute rounded-full motion-reduce:animate-none"
            style={{
                width: size,
                height: size,
                left: `calc(50% - ${size / 2}px)`,
                top: `calc(50% - ${size / 2}px)`,
                background: `radial-gradient(circle at 50% 50%, ${color} 0%, ${color}AA 35%, transparent 70%)`,
                animation: `refringence-orb-orbit ${duration}ms ease-in-out infinite`,
                animationDelay: `${delay}ms`,
                ['--orbit' as string]: `${orbit}px`,
            }}
        />
    );
}
