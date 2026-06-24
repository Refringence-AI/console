import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Render untrusted markdown to sanitized HTML for dangerouslySetInnerHTML.
 *
 * Sources are untrusted (GitHub issue/comment bodies, AI output, arbitrary
 * repo .md files), so every markdown -> HTML path must run through DOMPurify.
 * The default DOMPurify config strips event-handler attributes and dangerous
 * URL schemes (javascript:, most data: payloads), which is what we want.
 */
export function renderMarkdown(src: string): string {
    const html = marked.parse(src, { async: false, gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(html);
}

/**
 * Sanitize already-rendered markdown HTML. Used by call sites that need a
 * bespoke marked invocation (e.g. docs callout pre-processing or a different
 * breaks setting) but still must be sanitized before injection.
 */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html);
}
