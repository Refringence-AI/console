import { useEffect, useState } from 'react';
import { BirefringenceOrb } from './BirefringenceOrb';
import { GooeyText } from './GooeyText';

// Refringence-themed streaming verbs (prism dispersion language). Rotates ~3s,
// matching Claude's web cadence. The verb is decorative; the secondary line
// shows the actual current activity (running tool / drafting). Ported from the
// Desktop dock; replaces Console's static "Thinking" pulse dot.
const VERBS = ['Refracting', 'Resolving', 'Diffracting', 'Aligning', 'Phasing', 'Coalescing', 'Polarizing'];
const ROTATION_MS = 3000;

export type StreamActivity =
    | { kind: 'tool'; name: string; summary: string }
    | { kind: 'writing'; preview: string }
    | { kind: 'idle' };

export function StreamingIndicator({ streaming, activity }: { streaming: boolean; activity?: StreamActivity }) {
    const [verb, setVerb] = useState(VERBS[0]);

    useEffect(() => {
        if (!streaming) return;
        setVerb(VERBS[Math.floor(Math.random() * VERBS.length)]);
        const id = setInterval(() => {
            setVerb((prev) => {
                const others = VERBS.filter((v) => v !== prev);
                return others[Math.floor(Math.random() * others.length)];
            });
        }, ROTATION_MS);
        return () => clearInterval(id);
    }, [streaming]);

    if (!streaming) return null;

    let primary = '';
    let secondary = '';
    if (activity?.kind === 'tool') { primary = activity.name; secondary = activity.summary; }
    else if (activity?.kind === 'writing') { primary = 'drafting'; secondary = activity.preview; }

    return (
        <div className="flex items-start gap-2.5 select-none px-1 py-2" data-testid="ai-streaming-indicator">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <BirefringenceOrb size={16} />
                    <GooeyText text={`${verb}…`} fontSizePx={13} className="font-medium text-foreground [letter-spacing:-0.005em]" />
                </div>
                {primary && (
                    <div className="mt-1 ml-[24px] truncate font-mono text-label text-muted-foreground/65">
                        {primary}
                        {secondary && (
                            <>
                                <span className="text-muted-foreground/40"> · </span>
                                <span className="text-muted-foreground/85">{secondary}</span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
