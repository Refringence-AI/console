// Curated service catalogue for the "suggest + compare" surface. Tier data is
// researched against 2026 official pricing (see the Services panel comparison).
// freeUsable = there is a real $0 path you can ship on; paidFromUsd = the monthly
// dollar a named paid plan starts at (0 means usage-based from $0, no flat fee).

export type ServiceCategory =
    | 'hosting' | 'errors' | 'observability' | 'analytics'
    | 'llm-observability' | 'database' | 'compute';

export interface CatalogService {
    id: string;
    name: string;
    category: ServiceCategory;
    free: string;
    paidFrom: string;
    bestFor: string;
    caveat: string;
    freeUsable: boolean;
    paidFromUsd: number;
}

export const SERVICE_CATEGORIES: { id: ServiceCategory; label: string; need: string }[] = [
    { id: 'hosting', label: 'Hosting & deploy', need: 'Ship the app somewhere' },
    { id: 'errors', label: 'Error monitoring', need: 'Know when production breaks' },
    { id: 'analytics', label: 'Product analytics', need: 'See how it gets used' },
    { id: 'llm-observability', label: 'LLM observability', need: 'Trace + eval AI calls' },
    { id: 'database', label: 'Database', need: 'Store your data' },
    { id: 'observability', label: 'Logs & APM', need: 'Trace requests + metrics' },
    { id: 'compute', label: 'Background compute', need: 'Run jobs + GPU work' },
];

export const SERVICE_CATALOG: CatalogService[] = [
    { id: 'vercel', name: 'Vercel', category: 'hosting', free: '100 GB transfer, 1M edge requests, 1M function calls, unlimited deploys (non-commercial).', paidFrom: '$20/user/mo - 1 TB transfer, team seats, commercial use, $20 usage credit.', bestFor: 'Frontend / Next.js with zero-config git-push deploys.', caveat: 'Pro is usage-based on top of the flat fee; traffic spikes bill $0.15/GB over included.', freeUsable: true, paidFromUsd: 20 },
    { id: 'netlify', name: 'Netlify', category: 'hosting', free: '100 GB bandwidth, 300 build min, 125K functions, unlimited deploy previews.', paidFrom: '$9/mo - 1,000 credits, secret detection, priority support.', bestFor: 'Static sites + Jamstack with polished CI/CD and previews.', caveat: 'Moved to credit-based pricing (2025) - a shared pool that drains unpredictably.', freeUsable: true, paidFromUsd: 9 },
    { id: 'render', name: 'Render', category: 'hosting', free: '750 instance hrs, 100 GB bandwidth, free static sites, free Postgres/Redis.', paidFrom: '$7/mo - always-on Starter instance (no spin-down).', bestFor: 'Backends, cron jobs, databases wanting a true free tier.', caveat: 'Free web services spin down after 15 min idle - multi-second cold starts.', freeUsable: true, paidFromUsd: 7 },
    { id: 'railway', name: 'Railway', category: 'hosting', free: 'One-time $5 trial credit only - no perpetual free tier.', paidFrom: '$5/mo - Hobby includes $5 usage, billed per-second after.', bestFor: 'Full-stack backends + Docker with Heroku-like simplicity.', caveat: 'Removed its free tier in 2023; the $5 credit is consumed within days.', freeUsable: false, paidFromUsd: 5 },
    { id: 'cloudflare-pages', name: 'Cloudflare Pages', category: 'hosting', free: 'Unlimited bandwidth + requests, 500 builds/mo, 100 custom domains.', paidFrom: '$5/mo - 5,000 builds, 5 concurrent, 250 domains.', bestFor: 'Static / JAMstack wanting genuinely unlimited free bandwidth.', caveat: 'Server-side Functions share the Workers 100K req/day free quota.', freeUsable: true, paidFromUsd: 5 },
    { id: 'flyio', name: 'Fly.io', category: 'hosting', free: 'No free tier for new users (legacy allowances grandfathered only).', paidFrom: '~$2/mo - pay-as-you-go from a 256 MB machine, egress $0.02/GB.', bestFor: 'Globally distributed Docker VMs close to users.', caveat: 'Fully metered, no minimum; even stopped machines accrue storage charges.', freeUsable: false, paidFromUsd: 2 },

    { id: 'sentry', name: 'Sentry', category: 'errors', free: '5K errors/mo, 5M spans, 50 replays, 30-day retention, 1 user.', paidFrom: '$26/mo - unlimited users, 50K errors, 90-day retention.', bestFor: 'Errors + tracing + session replay in one tool.', caveat: 'Each product meters separately; overages stack up fast.', freeUsable: true, paidFromUsd: 26 },
    { id: 'bugsnag', name: 'Bugsnag', category: 'errors', free: '7.5K events/mo, 1M spans, unlimited projects, 7-day retention.', paidFrom: 'Modular - buy event packs (50K-3M/mo) + span packs.', bestFor: 'Mobile / frontend crash reporting with stability scores.', caveat: 'Free retention is only 7 days; paid pricing is quote-driven.', freeUsable: true, paidFromUsd: 0 },

    { id: 'posthog', name: 'PostHog', category: 'analytics', free: '1M events, 5K recordings, 1M flag requests, 1-year retention.', paidFrom: '$0 base - pay only per unit above the free allotment.', bestFor: 'All-in-one analytics + replay + flags for startups.', caveat: 'Purely usage-based; costs spike once you blow past the free allotments.', freeUsable: true, paidFromUsd: 0 },
    { id: 'mixpanel', name: 'Mixpanel', category: 'analytics', free: '1M events/mo, unlimited seats, 10K replays, 5 saved reports.', paidFrom: '$0 base then $0.28/1K events after the first 1M.', bestFor: 'Deep behavioral + funnel analytics for product teams.', caveat: 'Free tier caps you at 5 saved reports; cost scales with events.', freeUsable: true, paidFromUsd: 0 },
    { id: 'plausible', name: 'Plausible', category: 'analytics', free: '30-day trial only (open-source edition is free to self-host).', paidFrom: '$9/mo - up to 10K monthly pageviews.', bestFor: 'Privacy-first, cookieless GA alternative.', caveat: 'Paid-only after the trial; the only free path is self-hosting.', freeUsable: false, paidFromUsd: 9 },

    { id: 'langsmith', name: 'LangSmith', category: 'llm-observability', free: '5K traces/mo, 1 seat, 14-day retention.', paidFrom: '$39/seat/mo - 10K traces, unlimited seats, 3 workspaces.', bestFor: 'Tracing + evals for LangChain / LangGraph builders.', caveat: 'Per-seat fee plus trace overages ($2.50/1K) stack.', freeUsable: true, paidFromUsd: 39 },
    { id: 'langfuse', name: 'Langfuse', category: 'llm-observability', free: '50K units/mo, 2 users, 30-day retention (self-host is free).', paidFrom: '$29/mo - 100K units, 90-day retention, unlimited users.', bestFor: 'Open-source LLM tracing + prompt mgmt, self-host or cloud.', caveat: 'Billed on "units" not just traces; long retention needs the $199 tier.', freeUsable: true, paidFromUsd: 29 },

    { id: 'supabase', name: 'Supabase', category: 'database', free: '2 projects, 500 MB DB, 1 GB storage, 5 GB egress.', paidFrom: '$25/mo - 8 GB DB, 100 GB storage, daily backups, no auto-pause.', bestFor: 'All-in-one Postgres backend (auth, storage, realtime).', caveat: 'Free projects pause after ~1 week idle; capped at 2 active.', freeUsable: true, paidFromUsd: 25 },
    { id: 'neon', name: 'Neon', category: 'database', free: '100 projects, 0.5 GB storage + 100 CU-hrs each, 10 branches.', paidFrom: '$0 base - metered: $0.106/CU-hr, $0.35/GB-mo storage.', bestFor: 'Serverless Postgres with instant DB branching.', caveat: 'Free tier bounded by 100 CU-hr/mo + 0.5 GB per project.', freeUsable: true, paidFromUsd: 0 },
    { id: 'planetscale', name: 'PlanetScale', category: 'database', free: 'No free tier (removed April 2024).', paidFrom: '~$5/mo - PS-5 single-node, plus storage/backup/egress.', bestFor: 'Production MySQL/Postgres with non-blocking schema branching.', caveat: 'No free tier; even the smallest DB costs ~$5/mo + metered fees.', freeUsable: false, paidFromUsd: 5 },

    { id: 'datadog', name: 'Datadog', category: 'observability', free: 'Up to 5 hosts, 500+ integrations, 1-day metric retention.', paidFrom: '$15/host/mo - Infra Pro, 15-month retention.', bestFor: 'Unified infra + APM + logs + RUM for larger orgs.', caveat: 'Per-host modular billing causes bill shock; APM needs a paired plan.', freeUsable: true, paidFromUsd: 15 },
    { id: 'axiom', name: 'Axiom', category: 'observability', free: '500 GB ingest/mo, 10 GB-hrs query, 30-day retention, 1 seat.', paidFrom: '$25/mo - 1,000 GB ingest, 100 GB compute, ~100 seats.', bestFor: 'Cheap high-volume log/event storage, flat ingest pricing.', caveat: 'Heavy query workloads add credit-based compute cost.', freeUsable: true, paidFromUsd: 25 },

    { id: 'modal', name: 'Modal', category: 'compute', free: '$30/mo compute credit, 3 seats, 10 concurrent GPUs.', paidFrom: '$0 base - usage-based per-second beyond the credit.', bestFor: 'Serverless GPU/CPU for AI inference + batch, scale to zero.', caveat: 'Per-second billing; heavy GPU jobs spend the $30 credit fast.', freeUsable: true, paidFromUsd: 0 },
    { id: 'inngest', name: 'Inngest', category: 'compute', free: '50K executions/mo, 500K events, 5 concurrent, 24-hr traces.', paidFrom: '$75/mo - 1M+ executions, 100+ concurrency, 7-day traces.', bestFor: 'Durable event-driven workflows + scheduled jobs.', caveat: 'Executions = runs x steps, so multi-step functions burn the free quota.', freeUsable: true, paidFromUsd: 75 },
];

// "Within budget" = free is usable (always fits), OR the named paid plan's flat
// fee is <= the cap. Usage-based-from-$0 services count as fitting any budget.
export function fitsBudget(s: CatalogService, monthlyCap: number): boolean {
    if (s.freeUsable) return true;
    return s.paidFromUsd <= monthlyCap;
}
