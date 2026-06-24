import { useCallback, useEffect, useState } from 'react';
import { readPersona, writePersona, type Persona } from './persona';

/**
 * Persona-mode hook. Reads the persisted persona on mount and syncs
 * across components via a window event so that flipping persona in one
 * panel updates every other mounted view immediately.
 *
 * Defaults to 'seasoned' when nothing is stored (the current default
 * UX). Persisting via setPersona broadcasts the change.
 */

const PERSONA_EVENT = 'console-persona-change';

export function usePersonaMode(): {
    persona: Persona;
    isNewbie: boolean;
    isSeasoned: boolean;
    setPersona: (p: Persona) => void;
} {
    const [persona, setPersonaState] = useState<Persona>(() => readPersona() ?? 'seasoned');

    useEffect(() => {
        function onChange(e: Event) {
            const detail = (e as CustomEvent<Persona>).detail;
            if (detail === 'newbie' || detail === 'seasoned') {
                setPersonaState(detail);
            } else {
                setPersonaState(readPersona() ?? 'seasoned');
            }
        }
        function onStorage(e: StorageEvent) {
            if (e.key === 'refringence-console-persona') {
                setPersonaState(readPersona() ?? 'seasoned');
            }
        }
        window.addEventListener(PERSONA_EVENT, onChange);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(PERSONA_EVENT, onChange);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const setPersona = useCallback((p: Persona) => {
        writePersona(p);
        setPersonaState(p);
        window.dispatchEvent(new CustomEvent<Persona>(PERSONA_EVENT, { detail: p }));
    }, []);

    return {
        persona,
        isNewbie: persona === 'newbie',
        isSeasoned: persona === 'seasoned',
        setPersona,
    };
}
