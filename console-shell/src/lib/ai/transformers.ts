// console-shell/src/lib/ai/transformers.ts
//
// Renderer-side handle on the embed.worker singleton. Spawns the worker
// lazily on first embed() call, multiplexes requests by uuid, and
// returns Float32Array embeddings.

type WorkerOut =
    | { type: 'embedding'; id: string; vector: number[] }
    | { type: 'error'; id: string; error: string };

type Pending = {
    resolve: (v: Float32Array) => void;
    reject: (e: Error) => void;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();

function getWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('../../workers/embed.worker.ts', import.meta.url), {
        type: 'module',
    });
    worker.addEventListener('message', (ev: MessageEvent<WorkerOut>) => {
        const msg = ev.data;
        if (!msg || !msg.id) return;
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.type === 'embedding') {
            p.resolve(new Float32Array(msg.vector));
        } else {
            p.reject(new Error(msg.error));
        }
    });
    worker.addEventListener('error', (ev) => {
        // Reject any in-flight requests on a fatal worker error.
        const err = new Error(ev.message || 'embed worker crashed');
        pending.forEach((p) => p.reject(err));
        pending.clear();
    });
    return worker;
}

export async function embed(text: string): Promise<Float32Array> {
    const w = getWorker();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ type: 'embed', id, text });
    });
}

// FNV-1a 32-bit. Good enough for embedding cache keys; never used for
// anything security-sensitive.
export function tinyHash(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

export interface Embedder {
    embed(text: string): Promise<Float32Array>;
    hash(text: string): string;
}

export const transformersEmbedder: Embedder = {
    embed,
    hash: tinyHash,
};
