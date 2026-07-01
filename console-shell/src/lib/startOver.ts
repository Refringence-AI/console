// Reset the first-run state and return to onboarding.
//
// Clears the mode (persona), the active project, and both onboarding flags
// (global + per-window), then routes to the welcome wizard so Console opens
// as it does for a brand-new user. Saved connections and API keys live in the
// main process (safeStorage), NOT localStorage, so they are intentionally left
// untouched. Backs the Settings "Start over" action.

import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { clearPersona } from './persona';
import { clearActiveProject } from './activeProject';
import { clearOnboarded } from './onboarded';
import { clearOnboardedForWindow } from './onboardedWindow';

export function useStartOver(): () => void {
    const navigate = useNavigate();
    return useCallback(() => {
        clearPersona();
        clearActiveProject();
        clearOnboarded();
        clearOnboardedForWindow();
        navigate('/welcome');
    }, [navigate]);
}
