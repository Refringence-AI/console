// console-shell/src/lib/cmdk/semantic-rank.ts
//
// Tier 0 semantic re-ranking for the Cmd-K palette. The query is
// embedded fresh on every call; item embeddings are cached by id so
// the catalogue is only embedded once per session.
//
// If the embedder rejects (worker crashed, model failed to load), we
// fall back to returning items in their original order with score 0,
// so the palette never breaks on an AI fault.

import { ensureEmbeddings } from '../ai/registry';

const itemEmbeddingCache = new Map<string, Float32Array>();

function cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function rankBySemanticSimilarity(
    query: string,
    items: Array<{ id: string; text: string }>,
): Promise<Array<{ id: string; score: number }>> {
    if (!query.trim() || items.length === 0) {
        return items.map((it) => ({ id: it.id, score: 0 }));
    }

    let embedder;
    try {
        embedder = await ensureEmbeddings();
    } catch {
        return items.map((it) => ({ id: it.id, score: 0 }));
    }

    try {
        const queryVec = await embedder.embed(query);

        const itemVecs = await Promise.all(
            items.map(async (it) => {
                const cached = itemEmbeddingCache.get(it.id);
                if (cached) return { id: it.id, vec: cached };
                const v = await embedder.embed(it.text);
                itemEmbeddingCache.set(it.id, v);
                return { id: it.id, vec: v };
            }),
        );

        const scored = itemVecs.map(({ id, vec }) => ({
            id,
            score: cosine(queryVec, vec),
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored;
    } catch {
        return items.map((it) => ({ id: it.id, score: 0 }));
    }
}
