import { usePersonaMode } from '../../lib/usePersonaMode';
import { ChatPanel } from './ChatPanel';
import { AiWizard } from './AiWizard';

/**
 * /ai persona dispatcher. Guided gets the step-by-step wizard; Operator
 * gets the minimal chat. Same backend, two front doors.
 */
export function AiPanel() {
    const { isNewbie } = usePersonaMode();
    return isNewbie ? <AiWizard /> : <ChatPanel />;
}

export default AiPanel;
