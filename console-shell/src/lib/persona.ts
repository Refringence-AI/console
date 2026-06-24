/**
 * Persona persistence. Q3c (2026-06-17).
 *
 * Console's first-run flow asks the user whether they're 'new to dev' or
 * 'experienced'. The answer drives several UX defaults:
 *   - explainer hovers (newbie shows, seasoned hides)
 *   - default sidebar collapse state (seasoned collapses, newbie expanded)
 *   - density (seasoned compact, newbie roomy)
 *   - default Ctrl+K placeholder
 *   - onboarding banner visibility
 *
 * Stored in localStorage. The first read also tells us whether to send
 * the user to /welcome (no persona) or straight to /overview.
 */

export type Persona = 'newbie' | 'seasoned';

/**
 * User-facing labels for the two modes. The internal enum values stay
 * 'newbie' / 'seasoned' so persisted state and tests don't churn, but the
 * UI never shows those words (they read as skill-shaming). Guided is the
 * oriented view; Operator is the dense status cockpit.
 */
export const PERSONA_LABEL: Record<Persona, string> = {
    newbie: 'Guided',
    seasoned: 'Operator',
};

const STORAGE_KEY = 'refringence-console-persona';

export function readPersona(): Persona | null {
    if (typeof window === 'undefined') return null;
    try {
        const v = window.localStorage.getItem(STORAGE_KEY);
        if (v === 'newbie' || v === 'seasoned') return v;
        return null;
    } catch {
        return null;
    }
}

export function writePersona(persona: Persona): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, persona);
    } catch {
        /* noop */
    }
}

export function clearPersona(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* noop */
    }
}
