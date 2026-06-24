import { useEffect } from 'react';

/**
 * Zero-DOM side-effect component. Mounts a window keydown listener for
 * Ctrl+K / Cmd+K and invokes onToggle. Returns null.
 */
export default function CommandPaletteHotkey({ onToggle }: { onToggle: () => void }) {
    useEffect(() => {
        function handler(ev: KeyboardEvent) {
            const isK = ev.key === 'k' || ev.key === 'K';
            if (isK && (ev.ctrlKey || ev.metaKey)) {
                ev.preventDefault();
                onToggle();
            }
        }
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onToggle]);
    return null;
}
