import { GraduationCap } from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { FeatureTour } from './FeatureTour';

/**
 * Guided-mode walk-through: a friendly intro line above the centered, browsable
 * feature walk-through. Step through with the arrows at your own pace.
 */
export function TutorialsNewbie() {
    return (
        <div className="flex h-full flex-col overflow-hidden" data-testid="tutorials-newbie">
            <PanelHeader
                icon={GraduationCap}
                title="Walk through"
                subtitle="A short tour of what Console does"
                testid="tutorials-header"
            />
            <div className="flex flex-1 flex-col overflow-y-auto px-8 py-12">
                <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col justify-center gap-8">
                    <p className="mx-auto max-w-prose text-center text-body leading-relaxed text-muted-foreground">
                        Take a minute to see what each part of Console does. Step through with the
                        arrows at your own pace.
                    </p>
                    <FeatureTour />
                </div>
            </div>
        </div>
    );
}
