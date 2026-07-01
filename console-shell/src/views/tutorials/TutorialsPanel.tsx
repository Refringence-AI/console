import { GraduationCap } from 'lucide-react';
import { PanelHeader } from '../_shell/PanelHeader';
import { usePersonaMode } from '../../lib/usePersonaMode';
import { TutorialsNewbie } from './TutorialsNewbie';
import { FeatureTour } from './FeatureTour';

/**
 * Tutorials persona dispatcher. Both personas render the same feature tour;
 * Guided (newbie) gets the roomy auto-advancing version, Operator (seasoned)
 * gets a compact, self-driven one. The old driver.js walkthroughs are gone.
 */
export function TutorialsPanel() {
    const { isNewbie } = usePersonaMode();
    if (isNewbie) return <TutorialsNewbie />;
    return <TutorialsSeasoned />;
}

function TutorialsSeasoned() {
    return (
        <div className="flex h-full flex-col overflow-hidden" data-testid="tutorials-seasoned">
            <PanelHeader
                icon={GraduationCap}
                title="Walk through"
                subtitle="A quick tour of what Console does"
                testid="tutorials-header"
            />
            {/* Center the tour in the content area: a min-h-full flex column lets
                the slide sit vertically balanced when it fits, yet still scroll
                when the viewport is short. This kills the top-hugging dead space. */}
            <div className="flex flex-1 flex-col overflow-auto px-8 py-10">
                <div
                    className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col justify-center"
                    data-testid="tutorials-carousel-section"
                >
                    <FeatureTour />
                </div>
            </div>
        </div>
    );
}
