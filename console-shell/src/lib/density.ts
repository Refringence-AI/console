/**
 * Density persistence. Q3f (2026-06-17).
 *
 * Console supports two layout densities: 'compact' (tight rows, smaller
 * gaps - default and what seasoned devs prefer) and 'roomy' (more
 * breathing room, surfaced for newbie persona). Stored in localStorage.
 */

export type Density = 'compact' | 'roomy';

const STORAGE_KEY = 'refringence-console-density';

export function readDensity(): Density {
    if (typeof window === 'undefined') return 'compact';
    try {
        const v = window.localStorage.getItem(STORAGE_KEY);
        if (v === 'compact' || v === 'roomy') return v;
        return 'compact';
    } catch {
        return 'compact';
    }
}

export function writeDensity(density: Density): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, density);
    } catch {
        /* noop */
    }
}
