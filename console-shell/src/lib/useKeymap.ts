import { useEffect } from 'react';
import { useNavigate } from 'react-router';

/**
 * Linear-style g-prefix navigation chords for the Operator cockpit.
 *
 * Press 'g' then a letter to jump to a panel; press '?' to open the
 * shortcuts help. The handler is global (document-level) but yields
 * while the user is typing in an input/textarea/contenteditable or
 * while the palette is open, so it never steals real keystrokes.
 *
 * The chord buffer ('g' was pressed) clears after a short timeout so a
 * stray 'g' never sticks.
 */

export interface KeyChord {
    /** Second key after the 'g' prefix, e.g. 'o' in "g o". */
    key: string;
    to: string;
    label: string;
}

export const NAV_CHORDS: KeyChord[] = [
    { key: 'o', to: '/overview', label: 'Overview' },
    { key: 'w', to: '/issues', label: 'Workboard' },
    { key: 'r', to: '/repo', label: 'Repo' },
    { key: 'a', to: '/arch', label: 'Architecture' },
    { key: 'p', to: '/pipeline', label: 'Pipeline' },
    { key: 's', to: '/services', label: 'Services' },
    { key: 'b', to: '/library', label: 'Library' },
    { key: 'l', to: '/release', label: 'Release' },
    { key: 'y', to: '/observability', label: 'Observability' },
    { key: 'c', to: '/activity', label: 'Activity' },
    { key: 't', to: '/tutorials', label: 'Walk through' },
    { key: 'd', to: '/docs', label: 'Docs' },
    { key: ',', to: '/settings', label: 'Settings' },
];

function isEditableTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return el.isContentEditable;
}

export function useKeymap({
    enabled,
    onShowHelp,
}: {
    enabled: boolean;
    onShowHelp: () => void;
}): void {
    const navigate = useNavigate();

    useEffect(() => {
        if (!enabled) return;

        let awaitingG = false;
        let resetTimer: ReturnType<typeof setTimeout> | null = null;

        const clearChord = () => {
            awaitingG = false;
            if (resetTimer) {
                clearTimeout(resetTimer);
                resetTimer = null;
            }
        };

        function onKeyDown(e: KeyboardEvent) {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (isEditableTarget(e.target)) return;

            if (awaitingG) {
                const chord = NAV_CHORDS.find((c) => c.key === e.key.toLowerCase());
                clearChord();
                if (chord) {
                    e.preventDefault();
                    navigate(chord.to);
                }
                return;
            }

            if (e.key === '?') {
                e.preventDefault();
                onShowHelp();
                return;
            }

            if (e.key.toLowerCase() === 'g') {
                awaitingG = true;
                resetTimer = setTimeout(clearChord, 1500);
            }
        }

        document.addEventListener('keydown', onKeyDown);
        return () => {
            clearChord();
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [enabled, navigate, onShowHelp]);
}
