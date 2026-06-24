// console-shell/src/lib/onboarding/useMount.ts
//
// Drives the streamed "mount + study" intel flow: starts the mount for a
// project root and exposes the live step checklist + the profile the instant
// the deterministic build finishes. Used by the onboarding Study step. Clones
// the runner/useRunner listener pattern over the intel mount events.

import { useEffect, useState } from 'react';
import { bridge, type ProjectProfile } from '../bridge';

export type MountStepStatus = 'pending' | 'active' | 'done';
export interface MountStepState { id: string; label: string; status: MountStepStatus }

function markActive(steps: MountStepState[], current: string): MountStepState[] {
    return steps.map((s) => {
        if (s.id === current) return { ...s, status: 'active' };
        if (s.status === 'active') return { ...s, status: 'done' };
        return s;
    });
}

export function useMount(root: string | null, enabled: boolean): {
    steps: MountStepState[];
    profile: ProjectProfile | null;
    done: boolean;
    error: string | null;
} {
    const [steps, setSteps] = useState<MountStepState[]>([]);
    const [profile, setProfile] = useState<ProjectProfile | null>(null);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || !root) return;
        let active = true;
        let myMountId: string | null = null;
        setSteps([]); setProfile(null); setDone(false); setError(null);
        const mine = (id: string) => myMountId === null || id === myMountId;

        const offStep = bridge.intel.onMountStep((e) => {
            if (!active || !mine(e.mountId)) return;
            if (e.phase === 'init' && e.steps) {
                setSteps(e.steps.map((s) => ({ id: s.id, label: s.label, status: 'pending' })));
            } else if (e.phase === 'step' && e.current) {
                setSteps((cur) => markActive(cur, e.current!));
            }
        });
        const offProfile = bridge.intel.onMountProfile((e) => {
            if (!active || !mine(e.mountId)) return;
            setProfile(e.profile);
            setSteps((cur) => cur.map((s) => ({ ...s, status: 'done' as const })));
        });
        const offDone = bridge.intel.onMountDone((e) => {
            if (!active || !mine(e.mountId)) return;
            if (e.ok && e.profile) setProfile(e.profile);
            else if (e.error) setError(e.error);
            setDone(true);
        });

        void bridge.intel.mountStart(root).then((r) => { if (active) myMountId = r.mountId; });

        return () => { active = false; offStep(); offProfile(); offDone(); };
    }, [root, enabled]);

    return { steps, profile, done, error };
}
