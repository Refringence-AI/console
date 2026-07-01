// console-electron/src/main/prompts-catalog.ts
//
// The built-in, read-only curated prompt catalog. These ship in CODE (not in a
// project's prompts.json) so they update with the app and cannot be edited or
// deleted: the user "Clone to my library" to get an editable copy. The bodies
// are repo-grounded and tool-agnostic; the risky ones (migrations, renames,
// dead-code removal, security, deploy) tell the agent to explain or show the
// diff before editing.
import type { PromptEntry, PromptVariable } from './prompts';

// Stable timestamp so built-ins never look "just created" and sort predictably.
const TS = '2026-06-25T00:00:00.000Z';

const t = (name: string, label: string, placeholder: string): PromptVariable => ({ name, type: 'text', label, placeholder });
const ml = (name: string, label: string, placeholder: string): PromptVariable => ({ name, type: 'multiline', label, placeholder });

function b(
    id: string,
    category: string,
    title: string,
    whatWhen: string,
    body: string,
    variables: PromptVariable[],
    tags: string[],
): PromptEntry {
    return {
        id: `builtin-${id}`,
        title,
        whatWhen,
        body,
        variables,
        category,
        tags,
        favorite: false,
        source: 'builtin',
        createdAt: TS,
        updatedAt: TS,
    };
}

export const BUILTIN_PROMPTS: PromptEntry[] = [
    b('explain-error', 'Debug', 'Explain an error',
        "Translates a stack trace into plain words and the smallest fix. Use the moment you hit an error you don't understand.",
        "I hit the error below and don't understand it. In plain words: what it means, the most likely cause in this repo, and the smallest change that fixes it.\nLook at {{file}} first, then anything it imports. Do not edit yet - tell me the fix and which line, then wait for my go.\n\n```\n{{error}}\n```",
        [ml('error', 'Error message or stack trace', 'Paste the full error, including the stack trace'), t('file', 'File the error points at', 'src/server/handler.ts')],
        ['error', 'debug']),

    b('reproduce-bug', 'Debug', 'Reproduce then fix a bug',
        'Forces a failing repro before any change so the fix is provable. Use when behaviour is wrong but nothing throws.',
        "Bug: {{symptom}}\nExpected: {{expected}}\nStart in {{path}}. First write the smallest failing test or a 5-line script that reproduces this, and show me it fails. Only after the repro fails, make the minimal change to make it pass. Keep the diff small and explain why the bug happened in one sentence.",
        [t('symptom', 'What goes wrong', 'Clicking Save shows success but nothing persists'), t('expected', 'What you expected', 'The row should appear in the database'), t('path', 'Where to start looking', 'src/features/save/')],
        ['bug', 'repro']),

    b('local-vs-deployed', 'Debug', 'Works locally, breaks deployed',
        'Hunts environment and config drift, not logic bugs. Use when the same code passes on your machine but fails once shipped.',
        "This works on my machine but fails on {{environment}} with: {{error}}\nAssume the code is correct and the difference is environment: env vars, build flags, file paths, Node or runtime version, missing build step, or case-sensitive imports. List the most likely causes ranked, with the one command or file to check for each. Suggest no code edits until I confirm which one it is.",
        [t('environment', 'Where it breaks', 'Vercel / production / Docker'), ml('error', 'Error or wrong behaviour there', '500 on /api/login, blank in logs')],
        ['deploy', 'env']),

    b('rename-symbol', 'Refactor', 'Rename a symbol everywhere',
        'Renames a function, type, or variable across the repo without changing behaviour. Use when a name is misleading or inconsistent.',
        "Rename {{oldName}} to {{newName}} across the repo. This is a pure rename: no behaviour changes, no new logic. Update every reference, import, and any string that must match. Skip generated files and lockfiles. Show the list of files you'll touch before editing, then make the change and run the type check.",
        [t('oldName', 'Current name', 'getUsr'), t('newName', 'New name', 'getUserById')],
        ['refactor', 'rename']),

    b('untangle-function', 'Refactor', 'Untangle one long function',
        'Splits a single overgrown function into named pieces, behaviour unchanged. Use when one function is too long to follow.',
        "{{symbol}} in {{file}} is too long to follow. Split it into smaller named functions in the same file, keeping behaviour identical. Don't add new dependencies or change the public signature. If you spot a real bug while in there, point it out separately - do not fix it in this pass. Explain the new shape in 2-3 lines, then apply.",
        [t('symbol', 'Function name', 'handleCheckout'), t('file', 'File it lives in', 'src/checkout/index.ts')],
        ['refactor']),

    b('remove-dead-code', 'Refactor', 'Remove dead code safely',
        "Deletes unused code only after proving it's unreferenced. Use during cleanup before a release.",
        "Find code under {{path}} that is never imported or called: unused exports, files, and dependencies. For each, show where you confirmed it has no references before suggesting deletion. Do not remove anything reachable from an entry point, route, config, or test. Give me the list to approve, then delete the approved ones and confirm the build still passes.",
        [t('path', 'Folder to scan', 'src/legacy/')],
        ['refactor', 'cleanup']),

    b('write-test', 'Tests', 'Write a focused test',
        'Adds a single test covering the happy path plus one edge case. Use right after writing or changing a function.',
        "Write a focused test for {{symbol}} in {{file}} using {{framework}}. Cover the happy path and one edge case that's likely to break. Match the style of the existing tests in this repo - find one and follow it. Don't change the code under test. Return only the test file and the command to run it.",
        [t('symbol', 'What to test', 'parsePrice'), t('file', 'File it lives in', 'src/lib/price.ts'), t('framework', 'Test framework', 'vitest')],
        ['test']),

    b('lock-bug-test', 'Tests', 'Add a test that locks a bug',
        "Captures a just-fixed bug as a regression test so it can't return. Use right after fixing something.",
        "I just fixed this bug: {{bug}}\nWrite one regression test that fails on the old behaviour and passes now, so this can't come back silently. Put it next to the related tests and name it after the bug. Show me the test and confirm it passes against the current code.",
        [t('bug', 'The bug you fixed', 'Empty cart still charged shipping')],
        ['test', 'regression']),

    b('fix-flaky-test', 'Tests', 'Make a flaky test reliable',
        'Finds the real source of intermittent failure instead of retrying. Use when a test passes or fails at random.',
        "{{testName}} in {{file}} fails intermittently. Find the actual cause: timing, shared state between tests, real network or clock use, or test order dependence. Explain the cause before changing anything. Fix it properly - no added sleeps, no retry wrappers, no disabling the test. Show the before and after.",
        [t('testName', 'Flaky test name', 'loads user on mount'), t('file', 'Test file', 'src/user/user.test.ts')],
        ['test', 'flaky']),

    b('review-my-changes', 'Code review', 'Review my changes before commit',
        'A second read of your diff for bugs and missed cases before you commit. Use right before staging.',
        "Review the changes I'm about to commit (the working diff). Focus on: logic bugs, unhandled errors, edge cases, and anything that breaks existing callers. Group findings as must-fix vs nice-to-have, each with the file and line. Don't rewrite the code - tell me what to change and why. Skip style nits the formatter already handles.",
        [],
        ['review']),

    b('safe-to-merge', 'Code review', 'Is this safe to merge',
        "A go or no-go read on a change with a clear reason. Use when you have code from a tool or a contributor and aren't sure about it.",
        "Here is a change I didn't fully write: {{summary}}\nReview the diff and tell me plainly - safe to merge, or not yet. List anything that could break data, security, or existing users, ranked by how bad it is. If it's fine, say so in one line. Suggest the smallest fixes for any blockers; don't expand the scope.",
        [t('summary', 'What the change does', 'Adds password reset via email')],
        ['review', 'merge']),

    b('safe-migration', 'Database', 'Write a safe migration',
        'Produces a schema migration with an explicit rollback and zero-downtime notes. Use when you need to change the database shape.',
        "I need to {{change}} on table {{table}} using {{tool}}. Write the migration and a matching down/rollback. Call out anything that locks the table or loses data, and split it into safe steps if needed so existing rows survive. Show me the SQL and the run command before I apply it. Don't touch other tables.",
        [t('change', 'Schema change', "add a nullable 'phone' column"), t('table', 'Table name', 'users'), t('tool', 'Migration tool', 'Prisma / Drizzle / raw SQL')],
        ['database', 'migration']),

    b('backfill-data', 'Database', 'Backfill data without downtime',
        "Plans a batched backfill that won't lock the table or risk the live app. Use when a new column needs values for existing rows.",
        "I added {{column}} to {{table}} and need to fill it for existing rows from {{source}}. Write a backfill that runs in small batches, is safe to re-run if it stops partway, and won't lock the table against live traffic. Explain the batch size choice and how to check progress. Show the script and a dry-run option before any write.",
        [t('column', 'New column', 'full_name'), t('table', 'Table', 'users'), t('source', 'Where the value comes from', 'first_name + last_name')],
        ['database', 'backfill']),

    b('draft-changelog', 'Release', 'Draft a changelog from commits',
        'Turns raw commits into a user-facing changelog grouped by type. Use when cutting a release.',
        "Read the commits since {{lastTag}} and draft a changelog for version {{version}}. Group as Added, Changed, Fixed, and write each line for a user, not a developer. Flag anything that breaks existing behaviour under a Breaking heading at the top. Skip purely internal commits like formatting and dependency bumps. Output Markdown only.",
        [t('lastTag', 'Previous version tag', 'v1.2.0'), t('version', 'New version', 'v1.3.0')],
        ['release', 'changelog']),

    b('pre-release-checklist', 'Release', 'Pre-release checklist',
        "Lists exactly what's left before you can ship this version. Use right before tagging a release.",
        "I'm about to release {{version}}. Based on this repo, give me a short checklist of what must be done first: version bump locations, env vars the new code needs, migrations to run, and a one-line rollback plan. Mark each item done or not-done by checking the repo where you can. Keep it to what actually applies here - no generic advice.",
        [t('version', 'Version to release', 'v1.3.0')],
        ['release', 'checklist']),

    b('readme-quickstart', 'Docs', 'Write the README quickstart',
        "Produces a copy-pasteable setup section that actually matches the repo. Use when new people can't get the project running.",
        "Write a Quickstart for the README of this project: clone, install, required env vars, and the command to run it locally. Read the real package scripts and config - don't invent steps. List every env var the app needs and where to get each value. Keep it to commands a newcomer can paste in order. Output Markdown for the README only.",
        [],
        ['docs', 'readme']),

    b('explain-in-comments', 'Docs', 'Explain this code in comments',
        'Adds short why-comments to a confusing file without touching logic. Use when you inherit code you don\'t follow.',
        "Read {{file}} and add brief comments only where the intent is not obvious - the why, not the what. Don't restate the code, don't change any logic, and don't add a comment to every line. If something looks like a bug or a workaround, mark it clearly. Show me the diff so I can see exactly what you added.",
        [t('file', 'File to document', 'src/auth/session.ts')],
        ['docs', 'comments']),

    b('scan-secrets', 'Security', 'Scan for leaked secrets',
        'Finds keys, tokens, and passwords committed into the repo. Use before making a repo public or after a scare.',
        "Scan this repo for secrets in source: API keys, tokens, passwords, private keys, and connection strings, including in config and committed env files. For each, give the file, the line, and what kind it is. Do not print the full secret value - mask it. Then tell me the steps to rotate each one and how to stop it being committed again. Don't edit anything yet.",
        [],
        ['security', 'secrets']),

    b('review-endpoint', 'Security', 'Review one endpoint for security',
        'Checks a single route for the common web vulnerabilities. Use when an endpoint handles auth, money, or user data.',
        "Review {{endpoint}} in {{file}} for security issues: missing auth or authorization check, injection, unvalidated input, secrets in code, and over-broad data returned. Rank findings by severity with the line for each. For each, give the smallest safe fix. Explain before changing code, and don't expand the change beyond this endpoint.",
        [t('endpoint', 'Route or handler', 'POST /api/transfer'), t('file', 'File it lives in', 'src/api/transfer.ts')],
        ['security', 'review']),

    b('find-slow-part', 'Performance', 'Find the slow part first',
        "Locates the actual bottleneck before changing code. Use when something is slow but you don't know why.",
        "{{action}} is slow - around {{timing}}. Before changing anything, find where the time goes: tell me what to measure or log to confirm the real bottleneck, and where it most likely is in {{path}}. Once we agree on the cause, suggest the smallest fix and the expected gain. No broad rewrites and no new caching layer unless we've proven it's needed.",
        [t('action', 'What feels slow', 'Loading the dashboard'), t('timing', 'How slow', 'about 4 seconds'), t('path', 'Where to look', 'src/dashboard/')],
        ['performance']),

    b('fix-slow-query', 'Performance', 'Fix a slow database query',
        'Diagnoses and fixes one query, with the index or rewrite that explains the win. Use when a page waits on the database.',
        "This query is slow: {{query}}\nExplain why it's slow (missing index, full scan, N+1, fetching too much), then give the fix - usually an index or a rewrite. Show the before and after, and the command to confirm it's faster. Don't add an index without saying which column and why. Flag any migration the fix needs.",
        [ml('query', "The slow query or where it's built", 'SELECT ... or the ORM call')],
        ['performance', 'database']),

    b('plan-feature', 'Plan', 'Plan a feature before building',
        'Turns a vague feature idea into a small, ordered build plan grounded in your repo. Use before you start coding it.',
        "I want to add: {{feature}}\nDon't write code yet. Read the repo, then give me a short plan: the files you'd touch, the order to build in, the data or schema changes, and the riskiest part. Note anything you're unsure about as a question for me. Keep the first version as small as possible while still working end to end.",
        [t('feature', 'What you want to build', 'Let users export their data as CSV')],
        ['plan', 'feature']),

    b('cut-feature', 'Plan', 'Cut a feature down to ship',
        'Strips a big idea to the smallest version a real user can use. Use when a feature is too large to finish.',
        "{{feature}} is too big to finish soon. Propose the smallest version that's still genuinely useful to a user, and list what to drop or fake for now versus do properly. Say what each cut costs later. Ground it in this repo's current shape. End with the one slice I should build first.",
        [t('feature', 'The big feature', 'Full team workspaces with roles')],
        ['plan', 'scope']),

    b('write-agents-md', 'Dev-tool config', 'Write AGENTS.md for this repo',
        'Generates the house-rules file a coding agent reads each session, grounded in your real setup. Use when an agent keeps guessing your conventions.',
        "Read this repo and write an AGENTS.md at the root. Cover only what's true here: how to install, run, build, and test; the folder layout and where things live; the conventions you can infer from existing code; and the commands to verify a change. Keep it short and specific - no generic best-practice filler. Show me the file before writing it.",
        [],
        ['config', 'agents']),

    b('write-rules-file', 'Dev-tool config', 'Write project rules for my AI tool',
        'Creates a rules file (.cursorrules or similar) so your tool stops breaking conventions. Use once, early, per project.',
        "Write a {{ruleFile}} for this repo so a coding agent follows our conventions. Base every rule on real evidence in the code: language and framework, formatting, import style, test command, and folders that are off-limits or generated. State the verify command to run after edits. Keep it to rules that actually apply here. Show me the file before writing it.",
        [t('ruleFile', 'Rules file name', '.cursorrules / .windsurfrules')],
        ['config', 'rules']),

    b('ready-to-deploy', 'Deploy', 'Get this ready to deploy',
        "Lists everything missing between working-locally and live. Use when the app runs for you but you've never shipped it.",
        "I want to deploy this to {{target}} but haven't shipped it before. Read the repo and tell me exactly what's needed: the build command, the start command, every env var with where to set it, and any database step. Flag anything that works locally but will break in production, like hardcoded localhost or missing build output. Give me an ordered checklist, not prose.",
        [t('target', 'Where you want to deploy', 'Vercel / Railway / a VPS')],
        ['deploy']),

    b('add-ci-check', 'Deploy', 'Add a CI check on push',
        'Sets up the smallest pipeline that runs install, build, and test on every push. Use when broken code keeps reaching main.',
        "Add a {{ci}} workflow that runs on every push and pull request: install, build, and test, using this repo's real commands and Node or runtime version. Keep it to one file and the minimum that catches breakage. Don't add deploy steps or secrets yet. Show me the file and explain what each step does in one line before writing it.",
        [t('ci', 'CI system', 'GitHub Actions')],
        ['deploy', 'ci']),
];
