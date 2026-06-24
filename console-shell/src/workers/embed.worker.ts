// console-shell/src/workers/embed.worker.ts
//
// Web worker that hosts a Transformers.js feature-extraction pipeline
// for Xenova/bge-small-en-v1.5. Lazy-loads on first message; subsequent
// embed calls reuse the same pipeline.
//
// Protocol:
//   in:  { type: 'embed'; id: string; text: string }
//   out: { type: 'embedding'; id: string; vector: number[] }
//        { type: 'error'; id: string; error: string }

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Lock to remote-only by default; the renderer can flip this if it has
// shipped weights to a static path.
env.allowLocalModels = false;
env.useBrowserCache = true;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!pipelinePromise) {
        pipelinePromise = pipeline(
            'feature-extraction',
            'Xenova/bge-small-en-v1.5',
        ) as Promise<FeatureExtractionPipeline>;
    }
    return pipelinePromise;
}

type InMsg = { type: 'embed'; id: string; text: string };

self.addEventListener('message', async (ev: MessageEvent<InMsg>) => {
    const msg = ev.data;
    if (!msg || msg.type !== 'embed') return;
    const { id, text } = msg;
    try {
        const extractor = await getPipeline();
        // pooling: 'mean' + normalize: true is the recommended BGE recipe.
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        // output.data is a Float32Array; ship as a plain array for the
        // structured-clone boundary.
        const vector = Array.from(output.data as Float32Array);
        (self as unknown as Worker).postMessage({ type: 'embedding', id, vector });
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        (self as unknown as Worker).postMessage({ type: 'error', id, error });
    }
});
