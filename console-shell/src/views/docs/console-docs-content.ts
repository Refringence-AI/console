import { marked } from 'marked';
import pages from './console-docs-content.json';
import { sanitizeHtml } from '@/lib/markdown';

/**
 * The in-app documentation: one entry per page, each with a GUIDED and an
 * OPERATOR markdown body. Generated from the real product surface (see the
 * commit that added console-docs-content.json). Rendered by DocsPanel; no live
 * component projections, no dotted-canvas / live-badge framing.
 */
export interface DocPage {
    key: string;
    title: string;
    guided: string;
    operator: string;
}

export const DOC_PAGES: DocPage[] = pages as DocPage[];

marked.setOptions({ gfm: true, breaks: false });

/**
 * Render a doc body to HTML. GitHub-style alert blocks ("> [!INFO] Title") are
 * folded into a bold-titled blockquote, which the [data-testid="docs-body"]
 * blockquote rules in globals.css style as a callout.
 */
export function renderDocMarkdown(md: string): string {
    const withCallouts = md.replace(/^>\s*\[!(\w+)\]\s*(.*)$/gm, '> **$2**');
    return sanitizeHtml(marked.parse(withCallouts, { async: false }) as string);
}
