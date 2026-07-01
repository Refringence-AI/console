// console-electron/src/main/spend-attribution.ts
//
// Pure attribution over AI usage events. No network; no Date calls.
// The caller passes sampledAt so this module is side-effect-free and
// fully testable without faking time.
//
// Public surface: attributeSpend(events, windowDays?, sampledAt)

// ── Input ────────────────────────────────────────────────────────────────────

export interface UsageEvent {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    route?: string;
    sessionId?: string;
    at: string; // ISO 8601
}

// ── Pricing table ─────────────────────────────────────────────────────────────
// USD per 1 000 000 tokens (input, output separately).
// 'unknown' is a sentinel entry with 0 cost and a flag.

interface ModelPrice {
    inputPer1M: number;
    outputPer1M: number;
}

const MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
    'gpt-4o':              { inputPer1M: 2.50,  outputPer1M: 10.00 },
    'gpt-4o-mini':         { inputPer1M: 0.15,  outputPer1M: 0.60  },
    'o1':                  { inputPer1M: 15.00, outputPer1M: 60.00 },
    'claude-opus-4':       { inputPer1M: 15.00, outputPer1M: 75.00 },
    'claude-sonnet-4':     { inputPer1M: 3.00,  outputPer1M: 15.00 },
    'claude-haiku':        { inputPer1M: 0.25,  outputPer1M: 1.25  },
    'gemini-1.5-pro':      { inputPer1M: 1.25,  outputPer1M: 5.00  },
    'gemini-1.5-flash':    { inputPer1M: 0.075, outputPer1M: 0.30  },
    'unknown':             { inputPer1M: 0,     outputPer1M: 0     },
} as const;

// ── Output types ──────────────────────────────────────────────────────────────

export interface TokenTotals {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface CostUsd {
    input: number;
    output: number;
    total: number;
}

export interface SpendTotal {
    tokens: TokenTotals;
    costUsd: CostUsd;
}

export interface ByModelEntry {
    model: string;
    provider: string;
    tokens: TokenTotals;
    costUsd: CostUsd;
    pricingUnknown: boolean;
}

export interface ByRouteEntry {
    route: string;
    tokens: TokenTotals;
    costUsd: CostUsd;
    eventCount: number;
}

export interface BySessionEntry {
    sessionId: string;
    tokens: TokenTotals;
    costUsd: CostUsd;
    eventCount: number;
}

export interface SpendReport {
    total: SpendTotal;
    byModel: ByModelEntry[];
    byRoute: ByRouteEntry[];
    bySession: BySessionEntry[];
    unknownModels: string[];
    windowDays: number;
    sampledAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeCost(inputTokens: number, outputTokens: number, price: ModelPrice): CostUsd {
    const input  = (inputTokens  / 1_000_000) * price.inputPer1M;
    const output = (outputTokens / 1_000_000) * price.outputPer1M;
    return {
        input:  Math.round(input  * 1_000_000) / 1_000_000,
        output: Math.round(output * 1_000_000) / 1_000_000,
        total:  Math.round((input + output) * 1_000_000) / 1_000_000,
    };
}

function safeTokens(input: number, output: number): TokenTotals {
    const i = Number.isFinite(input)  && input  >= 0 ? Math.round(input)  : 0;
    const o = Number.isFinite(output) && output >= 0 ? Math.round(output) : 0;
    return { inputTokens: i, outputTokens: o, totalTokens: i + o };
}

function addTokens(a: TokenTotals, b: TokenTotals): TokenTotals {
    return {
        inputTokens:  a.inputTokens  + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        totalTokens:  a.totalTokens  + b.totalTokens,
    };
}

function addCost(a: CostUsd, b: CostUsd): CostUsd {
    const input  = a.input  + b.input;
    const output = a.output + b.output;
    return {
        input:  Math.round(input  * 1_000_000) / 1_000_000,
        output: Math.round(output * 1_000_000) / 1_000_000,
        total:  Math.round((input + output) * 1_000_000) / 1_000_000,
    };
}

const ZERO_TOKENS: TokenTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
const ZERO_COST:   CostUsd     = { input: 0, output: 0, total: 0 };

function priceFor(model: string): { price: ModelPrice; unknown: boolean } {
    if (Object.prototype.hasOwnProperty.call(MODEL_PRICING, model)) {
        return { price: MODEL_PRICING[model], unknown: false };
    }
    return { price: MODEL_PRICING['unknown'], unknown: true };
}

// Filter events to those within windowDays of sampledAt.
// Events with an unparseable `at` value are included (conservative).
function inWindow(event: UsageEvent, windowDays: number, sampledAtMs: number): boolean {
    const t = Date.parse(event.at);
    if (!Number.isFinite(t)) return true;
    const cutoffMs = sampledAtMs - windowDays * 24 * 60 * 60 * 1000;
    return t >= cutoffMs;
}

// ── Core function ─────────────────────────────────────────────────────────────

export function attributeSpend(
    events: UsageEvent[],
    windowDays: number = 30,
    sampledAt: string,
): SpendReport {
    const safeWindowDays = Number.isFinite(windowDays) && windowDays > 0
        ? Math.min(Math.round(windowDays), 3650)
        : 30;

    const sampledAtMs = Date.parse(sampledAt);
    const useWindow   = Number.isFinite(sampledAtMs);

    const filtered = Array.isArray(events)
        ? events.filter((e) => e && typeof e === 'object' && !useWindow
            ? true
            : inWindow(e, safeWindowDays, sampledAtMs))
        : [];

    // Accumulators keyed by model/route/session
    const modelMap    = new Map<string, ByModelEntry>();
    const routeMap    = new Map<string, ByRouteEntry>();
    const sessionMap  = new Map<string, BySessionEntry>();
    const unknownSet  = new Set<string>();

    let grandTokens = { ...ZERO_TOKENS };
    let grandCost   = { ...ZERO_COST };

    for (const evt of filtered) {
        const model    = typeof evt.model    === 'string' && evt.model.trim()    ? evt.model.trim()    : 'unknown';
        const provider = typeof evt.provider === 'string' && evt.provider.trim() ? evt.provider.trim() : 'unknown';
        const route    = typeof evt.route    === 'string' && evt.route.trim()    ? evt.route.trim()    : '(none)';
        const session  = typeof evt.sessionId === 'string' && evt.sessionId.trim() ? evt.sessionId.trim() : '(none)';

        const tokens = safeTokens(evt.inputTokens, evt.outputTokens);
        const { price, unknown } = priceFor(model);
        const cost = safeCost(tokens.inputTokens, tokens.outputTokens, price);

        if (unknown) unknownSet.add(model);

        grandTokens = addTokens(grandTokens, tokens);
        grandCost   = addCost(grandCost, cost);

        // by model
        const mk = `${provider}::${model}`;
        const existing = modelMap.get(mk);
        if (existing) {
            existing.tokens = addTokens(existing.tokens, tokens);
            existing.costUsd = addCost(existing.costUsd, cost);
        } else {
            modelMap.set(mk, {
                model,
                provider,
                tokens: { ...tokens },
                costUsd: { ...cost },
                pricingUnknown: unknown,
            });
        }

        // by route
        const re = routeMap.get(route);
        if (re) {
            re.tokens = addTokens(re.tokens, tokens);
            re.costUsd = addCost(re.costUsd, cost);
            re.eventCount += 1;
        } else {
            routeMap.set(route, { route, tokens: { ...tokens }, costUsd: { ...cost }, eventCount: 1 });
        }

        // by session
        const se = sessionMap.get(session);
        if (se) {
            se.tokens = addTokens(se.tokens, tokens);
            se.costUsd = addCost(se.costUsd, cost);
            se.eventCount += 1;
        } else {
            sessionMap.set(session, { sessionId: session, tokens: { ...tokens }, costUsd: { ...cost }, eventCount: 1 });
        }
    }

    return {
        total: { tokens: grandTokens, costUsd: grandCost },
        byModel:   [...modelMap.values()].sort((a, b) => b.costUsd.total - a.costUsd.total),
        byRoute:   [...routeMap.values()].sort((a, b) => b.costUsd.total - a.costUsd.total),
        bySession: [...sessionMap.values()].sort((a, b) => b.costUsd.total - a.costUsd.total),
        unknownModels: [...unknownSet].sort(),
        windowDays: safeWindowDays,
        sampledAt,
    };
}

// Expose the pricing table for UI display (names only, not a secret).
export function listKnownModels(): string[] {
    return Object.keys(MODEL_PRICING).filter((m) => m !== 'unknown');
}
