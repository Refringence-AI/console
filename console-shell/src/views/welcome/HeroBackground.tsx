import { cn } from '@/lib/utils';
import { AsciiField } from './AsciiField';

/**
 * The ONE sanctioned ambient treatment for the onboarding/tour hero: a subtle
 * ASCII wave field in Console's own ink at very low opacity (radial-masked,
 * reduced-motion safe - see AsciiField), plus a single colorless radial glow.
 * The surface stays calm and never competes with the copy. Working panels never
 * get this; the hero is the exception.
 */
export function HeroBackground({ className }: { className?: string }) {
    return (
        <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden>
            <AsciiField opacity={0.05} cell={28} speed={0.35} />
            {/* One soft colorless glow lifting the upper-left where the copy sits. */}
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage:
                        'radial-gradient(ellipse 60% 50% at 20% 25%, color-mix(in oklab, var(--foreground) 6%, transparent), transparent 70%)',
                }}
            />
        </div>
    );
}
