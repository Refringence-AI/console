import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { useStartOver } from '../../lib/startOver';

/**
 * "Start over" reset, shown in both Settings variants. Clears the mode, the
 * active project, and the first-run flags, then reopens the welcome wizard.
 * Saved connections + API keys are kept (they live in the main process, not
 * localStorage). Two-click confirm so it is not a footgun. `roomy` bumps the
 * type + spacing to match the Guided (newbie) Settings cards.
 */
export function StartOverCard({ roomy = false }: { roomy?: boolean }) {
    const startOver = useStartOver();
    const [confirming, setConfirming] = useState(false);

    const titleCls = roomy ? 'text-section' : 'text-card-title';
    const bodyCls = roomy ? 'text-body leading-relaxed' : 'text-small';

    return (
        <Card data-testid="settings-start-over" className={roomy ? 'gap-4 p-5' : 'gap-3 p-5'}>
            <div className="flex flex-col gap-1">
                <h2 className={`${titleCls} text-foreground`}>Start over</h2>
                <p className={`${bodyCls} text-muted-foreground`}>
                    Clears your mode, active project, and first-run setup, then reopens the
                    welcome flow. Saved connections and API keys are kept.
                </p>
            </div>
            {confirming ? (
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={startOver}
                        data-testid="settings-start-over-confirm"
                    >
                        Yes, start over
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
                        Cancel
                    </Button>
                </div>
            ) : (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setConfirming(true)}
                >
                    <RotateCcw className="h-4 w-4" />
                    Start over
                </Button>
            )}
        </Card>
    );
}
