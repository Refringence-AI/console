import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface PanelErrorBoundaryProps {
    name?: string;
    children: ReactNode;
}

interface PanelErrorBoundaryState {
    error: Error | null;
}

/**
 * Per-panel error boundary.
 *
 * A thrown panel renders a contained fallback instead of white-screening
 * the whole app. The shell (TopBar, Sidebar, other routes) keeps running.
 *
 * Reset strategy: ConsoleShell keys this boundary on the route pathname,
 * so navigating away from a crashed panel clears the error. The local
 * "Reload panel" button also clears state in place.
 */
export class PanelErrorBoundary extends Component<
    PanelErrorBoundaryProps,
    PanelErrorBoundaryState
> {
    state: PanelErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('[PanelErrorBoundary]', this.props.name ?? 'panel', error, info);
    }

    private reset = (): void => {
        this.setState({ error: null });
    };

    render(): ReactNode {
        const { error } = this.state;
        if (!error) {
            return this.props.children;
        }

        return (
            <div data-testid="panel-error-boundary" className="flex h-full w-full items-center justify-center p-6">
                <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-7 text-center">
                    <AlertTriangle className="h-8 w-8 text-muted-foreground" />
                    <div className="text-sm font-semibold text-foreground">
                        This panel hit an error.
                    </div>
                    {this.props.name && (
                        <div className="text-xs text-muted-foreground">{this.props.name}</div>
                    )}
                    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-background px-3 py-2 text-left font-mono text-[11px] text-muted-foreground">
                        {error.message || String(error)}
                    </pre>
                    <div className="mt-1 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={this.reset}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reload panel
                        </button>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                            Reload app
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
