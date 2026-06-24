// console-electron/src/main/ai/providers/stream.ts
//
// Shared streaming loop for every provider. The five backends differ only
// in how they build their `model` handle; once they have one, the call into
// streamText + the textStream iteration + error routing is identical, so it
// lives here once instead of five times. Errors are routed to onError (then
// onDone) rather than thrown, so nothing crosses the IPC boundary as a throw.
import type { LanguageModel, ModelMessage } from 'ai';
import type { StreamParams } from '../ModelProvider';

export async function streamWithModel(
    ai: typeof import('ai'),
    model: LanguageModel,
    params: StreamParams,
): Promise<void> {
    try {
        // ChatMessage {role, content:string} is a structural subset of the
        // SDK's ModelMessage union, so the cast is sound for text-only chat.
        const hasTools = params.tools && Object.keys(params.tools).length > 0;
        // Cast streamText to a minimal local signature: the AI SDK v6 tool +
        // result types are deep enough that letting tsc infer them OOMs the build.
        const streamText = ai.streamText as unknown as (opts: {
            model: LanguageModel;
            system?: string;
            messages: ModelMessage[];
            abortSignal?: AbortSignal;
            tools?: Record<string, unknown>;
            stopWhen?: unknown;
        }) => { fullStream: AsyncIterable<Record<string, unknown>> };
        const result = streamText({
            model,
            system: params.system,
            messages: params.messages as ModelMessage[],
            abortSignal: params.signal,
            ...(hasTools ? { tools: params.tools, stopWhen: ai.stepCountIs(8) } : {}),
        });
        // fullStream carries text, tool-call, and tool-result parts; the SDK
        // auto-executes tool.execute() and feeds results back across steps.
        for await (const part of result.fullStream) {
            const type = part.type as string;
            if (type === 'text-delta') {
                params.onTextDelta((part.text as string) ?? (part.textDelta as string) ?? '');
            } else if (type === 'tool-call') {
                params.onToolCall?.({ id: part.toolCallId as string, name: part.toolName as string, input: part.input ?? part.args });
            } else if (type === 'tool-result') {
                params.onToolResult?.({ id: part.toolCallId as string, name: part.toolName as string, output: part.output ?? part.result });
            } else if (type === 'error') {
                const e = part.error;
                params.onError(e instanceof Error ? e.message : String(e));
            }
        }
        params.onDone();
    } catch (err) {
        // An aborted request lands here too; the renderer already knows it
        // cancelled, so report it as a benign cancellation rather than a fault.
        if (params.signal.aborted) {
            params.onDone();
            return;
        }
        params.onError(err instanceof Error ? err.message : String(err));
        params.onDone();
    }
}
