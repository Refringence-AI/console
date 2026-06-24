import { useEffect, useState, type ReactNode } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { bridge } from '../../lib/bridge';

/**
 * Minimize / maximize / close, rendered in the DOM (not the OS overlay).
 * Replacing Electron's titleBarOverlay removes the OS-drawn caption band
 * entirely, so there is no colour seam / rectangle around the buttons in any
 * theme. The buttons opt out of the window drag region via the no-drag rule in
 * globals.css (header[data-testid="top-bar"] button).
 */
export function WindowControls() {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        let active = true;
        // Guard the bridge calls: in a non-Electron context (browser dev / SSR)
        // the bridge is not wired and these throw synchronously - don't let that
        // crash the surrounding view.
        try {
            bridge.window.isMaximized().then((m) => { if (active) setMaximized(m); }).catch(() => {});
            const off = bridge.window.onMaximizeChange((m) => setMaximized(m));
            return () => { active = false; off(); };
        } catch {
            return () => { active = false; };
        }
    }, []);

    return (
        <div className="flex items-stretch self-stretch" data-testid="window-controls">
            <ControlButton label="Minimize" onClick={() => { void bridge.window.minimize(); }}>
                <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
            </ControlButton>
            <ControlButton
                label={maximized ? 'Restore' : 'Maximize'}
                onClick={() => { void bridge.window.toggleMaximize().then(setMaximized).catch(() => {}); }}
            >
                {maximized
                    ? <Copy className="h-3 w-3" strokeWidth={1.5} />
                    : <Square className="h-3 w-3" strokeWidth={1.5} />}
            </ControlButton>
            <ControlButton label="Close" onClick={() => { void bridge.window.close(); }} danger>
                <X className="h-4 w-4" strokeWidth={1.5} />
            </ControlButton>
        </div>
    );
}

function ControlButton({
    label, onClick, danger, children,
}: {
    label: string;
    onClick: () => void;
    danger?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            data-testid={`window-${label.toLowerCase()}`}
            className={
                'flex w-[46px] items-center justify-center text-muted-foreground transition-colors ' +
                (danger
                    ? 'hover:bg-[#e11d48] hover:text-white'
                    : 'hover:bg-foreground/[0.07] hover:text-foreground')
            }
        >
            {children}
        </button>
    );
}
