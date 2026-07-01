// console-shell/src/lib/ai/registry.ts
//
// Central AI capability registry. The renderer asks for embeddings,
// suggestions, explainers, and categorisation through this module and
// never reaches for a specific tier directly.
//
// Tier preference is persisted in localStorage under
// 'refringence-console-ai-tier'. Settings writes the user-facing
// vocabulary ('on-device' | 'on-device-optional-cloud' | 'cloud-first');
// internally we collapse to a binary { on-device-only | allow-cloud }
// because the rule branches care only whether cloud is permitted.

import { transformersEmbedder, type Embedder } from './transformers';
import {
    suggestNextRule,
    explainRule,
    categorizeRule,
    type NextSuggestion,
    type OverviewState,
} from './rules';

export type AiTier = 'on-device-only' | 'allow-cloud';

const TIER_KEY = 'refringence-console-ai-tier';

// Settings writes one of these three values. Map them to the binary
// internal AiTier. 'on-device' and the default ('') resolve to
// on-device-only; the two cloud-aware options resolve to allow-cloud.
function readTier(): AiTier {
    if (typeof localStorage === 'undefined') return 'on-device-only';
    const v = localStorage.getItem(TIER_KEY);
    if (v === 'allow-cloud' || v === 'on-device-optional-cloud' || v === 'cloud-first') {
        return 'allow-cloud';
    }
    return 'on-device-only';
}

function cloudAvailable(): boolean {
    return readTier() === 'allow-cloud';
}

export function getAiTier(): AiTier {
    return readTier();
}

export function setAiTier(tier: AiTier): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TIER_KEY, tier);
}

/**
 * Returns the active embedder. T0 currently means Transformers.js BGE
 * small in a web worker. There is no T4 embedder - cloud embeddings are
 * an explicit non-goal for this round.
 */
export async function ensureEmbeddings(): Promise<Embedder> {
    return transformersEmbedder;
}

export async function suggestNext(state: OverviewState): Promise<NextSuggestion[]> {
    const rule = suggestNextRule(state);
    if (!cloudAvailable()) return rule;
    // T4 stub: cloud suggestions are not wired yet. Return the rule
    // output annotated so the caller can show a "cloud preview pending"
    // affordance if it wants to.
    return rule.map((s) => ({
        ...s,
        rationale: `${s.rationale} (cloud refinement pending: T4 not wired)`,
    }));
}

export async function explain(label: string): Promise<string> {
    const rule = explainRule(label);
    if (!cloudAvailable()) return rule;
    return `${rule}\n\n(cloud explainer pending: T4 not wired)`;
}

export async function categorize(text: string, candidates: string[]): Promise<string> {
    const rule = categorizeRule(text, candidates);
    // No cloud branch worth stubbing for categorisation - the cost is
    // not worth the latency hit when rules already produce a label.
    return rule;
}

export type { NextSuggestion, OverviewState } from './rules';
export type { Embedder } from './transformers';
