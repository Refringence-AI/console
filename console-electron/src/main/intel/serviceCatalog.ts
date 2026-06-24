// console-electron/src/main/intel/serviceCatalog.ts
//
// Curated catalog of the services Console knows how to detect and (later)
// connect. This is DATA, not behaviour: each entry maps a real product to the
// signals that imply it (env key-name patterns, dependency-name patterns,
// config files, .mcp.json server names) plus what Console panel it powers and a
// one-line free-vs-paid note. Detection is a pure function over signals the
// deterministic profiler already gathers; it NEVER reads env values, only names.
//
// The catalog is deliberately curated (~16 entries) rather than exhaustive: the
// value is the mapping (which panel it lights up, the pricing line a newbie
// needs), not breadth. App-internal config keys (MODEL_*, NEXT_PUBLIC_URL, ...)
// are intentionally not matched.
import type {
    DetectedService, ServiceCategory, ServiceConfidence, ServiceEvidence,
} from './types';

export interface ServiceDef {
    id: string;
    name: string;
    category: ServiceCategory;
    powers: string | null;
    pricing: string;
    docsUrl: string;
    envKeyPatterns: RegExp[];
    depPatterns: RegExp[];
    configFiles: string[];
    mcpNames: string[];
}

// Patterns are matched case-insensitively. env patterns are anchored to whole
// key names; dep patterns match anywhere in a package name so scoped packages
// (@sentry/node) and bare names (posthog-js) both hit.
export const SERVICE_CATALOG: ServiceDef[] = [
    {
        id: 'github', name: 'GitHub', category: 'repo', powers: 'Repo + Workboard',
        pricing: 'Free; paid for orgs/advanced features',
        docsUrl: 'https://docs.github.com',
        envKeyPatterns: [/^GITHUB_TOKEN$/i, /^GH_TOKEN$/i, /^GITHUB_[A-Z_]+$/i],
        depPatterns: [/^@octokit\//i, /^probot$/i], configFiles: [], mcpNames: ['github'],
    },
    {
        id: 'vercel', name: 'Vercel', category: 'hosting-frontend', powers: 'Release (deploys)',
        pricing: 'Free hobby; Pro $20/mo',
        docsUrl: 'https://vercel.com/docs',
        envKeyPatterns: [/^VERCEL_[A-Z_]+$/i], depPatterns: [/^vercel$/i, /^@vercel\//i],
        configFiles: ['vercel.json'], mcpNames: ['vercel'],
    },
    {
        id: 'netlify', name: 'Netlify', category: 'hosting-frontend', powers: 'Release (deploys)',
        pricing: 'Free; Pro $19/mo',
        docsUrl: 'https://docs.netlify.com',
        envKeyPatterns: [/^NETLIFY_[A-Z_]+$/i], depPatterns: [/^netlify-cli$/i, /^@netlify\//i],
        configFiles: ['netlify.toml'], mcpNames: ['netlify'],
    },
    {
        id: 'railway', name: 'Railway', category: 'hosting-backend', powers: 'Release (deploys)',
        pricing: 'Usage-based; $5 trial credit',
        docsUrl: 'https://docs.railway.com',
        envKeyPatterns: [/^RAILWAY_[A-Z_]+$/i], depPatterns: [],
        configFiles: ['railway.json', 'railway.toml', 'nixpacks.toml'], mcpNames: ['railway'],
    },
    {
        id: 'fly', name: 'Fly.io', category: 'hosting-backend', powers: 'Release (deploys)',
        pricing: 'Usage-based with a free allowance',
        docsUrl: 'https://fly.io/docs',
        envKeyPatterns: [/^FLY_[A-Z_]+$/i], depPatterns: [],
        configFiles: ['fly.toml'], mcpNames: [],
    },
    {
        id: 'render', name: 'Render', category: 'hosting-backend', powers: 'Release (deploys)',
        pricing: 'Free tier; paid instances from $7/mo',
        docsUrl: 'https://render.com/docs',
        envKeyPatterns: [/^RENDER_[A-Z_]+$/i], depPatterns: [],
        configFiles: ['render.yaml'], mcpNames: [],
    },
    {
        id: 'supabase', name: 'Supabase', category: 'database', powers: 'Data',
        pricing: 'Free tier; Pro $25/mo',
        docsUrl: 'https://supabase.com/docs',
        envKeyPatterns: [/^SUPABASE_[A-Z_]+$/i, /^NEXT_PUBLIC_SUPABASE_[A-Z_]+$/i],
        depPatterns: [/^@supabase\//i], configFiles: ['supabase'], mcpNames: ['supabase'],
    },
    {
        id: 'sentry', name: 'Sentry', category: 'observability', powers: 'Observability (errors)',
        pricing: 'Free 5k errors; Team $26/mo',
        docsUrl: 'https://docs.sentry.io',
        envKeyPatterns: [/^SENTRY_[A-Z_]+$/i, /^NEXT_PUBLIC_SENTRY_[A-Z_]+$/i],
        depPatterns: [/^@sentry\//i], configFiles: ['.sentryclirc'], mcpNames: ['sentry'],
    },
    {
        id: 'posthog', name: 'PostHog', category: 'analytics', powers: 'Overview counters',
        pricing: 'Free 1M events/mo; usage after',
        docsUrl: 'https://posthog.com/docs',
        envKeyPatterns: [/^POSTHOG_[A-Z_]+$/i, /^NEXT_PUBLIC_POSTHOG_[A-Z_]+$/i],
        depPatterns: [/^posthog-js$/i, /^posthog-node$/i], configFiles: [], mcpNames: ['posthog'],
    },
    {
        id: 'plausible', name: 'Plausible', category: 'analytics', powers: 'Overview counters',
        pricing: 'Paid from $9/mo (self-host free)',
        docsUrl: 'https://plausible.io/docs',
        envKeyPatterns: [/^PLAUSIBLE_[A-Z_]+$/i], depPatterns: [/^plausible-tracker$/i],
        configFiles: [], mcpNames: [],
    },
    {
        id: 'stripe', name: 'Stripe', category: 'payment', powers: null,
        pricing: 'Free; per-transaction fee',
        docsUrl: 'https://stripe.com/docs',
        envKeyPatterns: [/^STRIPE_[A-Z_]+$/i, /^NEXT_PUBLIC_STRIPE_[A-Z_]+$/i],
        depPatterns: [/^stripe$/i, /^@stripe\//i], configFiles: [], mcpNames: ['stripe'],
    },
    {
        id: 'slack', name: 'Slack', category: 'comms', powers: 'Workboard',
        pricing: 'Free; Pro per-seat',
        docsUrl: 'https://api.slack.com',
        envKeyPatterns: [/^SLACK_[A-Z_]+$/i], depPatterns: [/^@slack\//i],
        configFiles: [], mcpNames: ['slack'],
    },
    {
        id: 'openai', name: 'OpenAI', category: 'ai-model', powers: 'AI provider',
        pricing: 'Pay-as-you-go per token',
        docsUrl: 'https://platform.openai.com/docs',
        envKeyPatterns: [/^OPENAI_API_KEY$/i, /^OPENAI_[A-Z_]+$/i],
        depPatterns: [/^openai$/i, /^@ai-sdk\/openai$/i], configFiles: [], mcpNames: [],
    },
    {
        id: 'anthropic', name: 'Anthropic', category: 'ai-model', powers: 'AI provider',
        pricing: 'Pay-as-you-go per token',
        docsUrl: 'https://docs.anthropic.com',
        envKeyPatterns: [/^ANTHROPIC_API_KEY$/i, /^ANTHROPIC_[A-Z_]+$/i],
        depPatterns: [/^@anthropic-ai\//i, /^@ai-sdk\/anthropic$/i], configFiles: [], mcpNames: [],
    },
    {
        id: 'google-ai', name: 'Google AI', category: 'ai-model', powers: 'AI provider',
        pricing: 'Free tier; pay-as-you-go per token',
        docsUrl: 'https://ai.google.dev',
        envKeyPatterns: [/^GOOGLE_GENERATIVE_AI_API_KEY$/i, /^GEMINI_API_KEY$/i, /^GOOGLE_API_KEY$/i],
        depPatterns: [/^@ai-sdk\/google$/i, /^@google\/genai$/i, /^@google\/generative-ai$/i], configFiles: [], mcpNames: [],
    },
    {
        id: 'openrouter', name: 'OpenRouter', category: 'ai-model', powers: 'AI provider',
        pricing: 'Pass-through pricing + credits',
        docsUrl: 'https://openrouter.ai/docs',
        envKeyPatterns: [/^OPENROUTER_API_KEY$/i], depPatterns: [/^@openrouter\//i],
        configFiles: [], mcpNames: ['openrouter'],
    },
    {
        id: 'langsmith', name: 'LangSmith', category: 'observability', powers: 'Evals',
        pricing: 'Free dev tier; Plus $39/seat',
        docsUrl: 'https://docs.smith.langchain.com',
        envKeyPatterns: [/^LANGCHAIN_API_KEY$/i, /^LANGSMITH_API_KEY$/i, /^LANGCHAIN_TRACING_V2$/i],
        depPatterns: [/^langsmith$/i], configFiles: [], mcpNames: ['langsmith'],
    },
    {
        id: 'exa', name: 'Exa', category: 'search', powers: null,
        pricing: 'Free credits; usage after',
        docsUrl: 'https://docs.exa.ai',
        envKeyPatterns: [/^EXA_API_KEY$/i], depPatterns: [/^exa-js$/i],
        configFiles: [], mcpNames: ['exa'],
    },
    {
        id: 'elevenlabs', name: 'ElevenLabs', category: 'ai-model', powers: null,
        pricing: 'Free 10k chars/mo; usage after',
        docsUrl: 'https://elevenlabs.io/docs',
        envKeyPatterns: [/^ELEVENLABS_[A-Z_]+$/i], depPatterns: [/^elevenlabs$/i, /^@elevenlabs\//i],
        configFiles: [], mcpNames: ['elevenlabs'],
    },
    {
        id: 'upstash', name: 'Upstash / Redis', category: 'database', powers: null,
        pricing: 'Free tier; usage after',
        docsUrl: 'https://upstash.com/docs',
        envKeyPatterns: [/^UPSTASH_[A-Z_]+$/i, /^REDIS_URL$/i], depPatterns: [/^@upstash\//i, /^ioredis$/i],
        configFiles: [], mcpNames: [],
    },
];

export interface DetectionSignals {
    envNames: string[];
    deps: string[];
    configFiles: string[];
    mcpNames: string[];
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(value));
}

// Pure detection. config / mcp / dep evidence is HIGH confidence (a config file
// or an installed dep or a declared MCP server is strong proof of real use); an
// env-key-only match is MEDIUM (a name in .env.example does not prove use).
export function detectServices(signals: DetectionSignals): DetectedService[] {
    const out: DetectedService[] = [];
    const envNames = signals.envNames;
    const deps = signals.deps.map((d) => d.toLowerCase());
    const configs = new Set(signals.configFiles.map((c) => c.toLowerCase()));
    const mcp = new Set(signals.mcpNames.map((m) => m.toLowerCase()));

    for (const def of SERVICE_CATALOG) {
        const evidence: string[] = [];
        const via = new Set<ServiceEvidence>();

        for (const name of def.mcpNames) {
            if (mcp.has(name.toLowerCase())) { evidence.push(`mcp: ${name}`); via.add('mcp'); }
        }
        for (const cfg of def.configFiles) {
            if (configs.has(cfg.toLowerCase())) { evidence.push(`config: ${cfg}`); via.add('config'); }
        }
        for (const dep of deps) {
            if (matchesAny(dep, def.depPatterns)) { evidence.push(`dep: ${dep}`); via.add('dep'); break; }
        }
        for (const env of envNames) {
            if (matchesAny(env, def.envKeyPatterns)) { evidence.push(`env: ${env}`); via.add('env'); }
        }

        if (via.size === 0) continue;

        // High when any strong signal fired; medium when only env names did.
        const strong = via.has('mcp') || via.has('config') || via.has('dep');
        const confidence: ServiceConfidence = strong ? 'high' : 'medium';
        // Order via strongest-first for the UI.
        const order: ServiceEvidence[] = ['mcp', 'config', 'dep', 'env'];
        out.push({
            id: def.id, name: def.name, category: def.category,
            confidence, via: order.filter((v) => via.has(v)),
            evidence: evidence.slice(0, 6),
            powers: def.powers, pricing: def.pricing, docsUrl: def.docsUrl,
        });
    }

    // Rank: GitHub first, then services that power a panel, then high-confidence,
    // then alphabetical for a stable order.
    return out.sort((a, b) => {
        if (a.id === 'github') return -1;
        if (b.id === 'github') return 1;
        const ap = a.powers ? 0 : 1, bp = b.powers ? 0 : 1;
        if (ap !== bp) return ap - bp;
        const ac = a.confidence === 'high' ? 0 : 1, bc = b.confidence === 'high' ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return a.name.localeCompare(b.name);
    });
}
