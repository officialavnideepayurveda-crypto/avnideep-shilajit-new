/**
 * Parser-based HTML sanitisation for admin-authored blog content.
 *
 * The previous implementation stripped dangerous markup with regular
 * expressions, which misses entity-encoded payloads (`&lt;svg onload&gt;`),
 * malformed nesting and attribute-encoded handlers. sanitize-html parses the
 * document (htmlparser2) and rebuilds it from an allowlist, so anything not
 * explicitly permitted is dropped.
 *
 * Runs in Cloudflare Pages Functions (Workers runtime, nodejs_compat flag).
 */
import sanitizeHtml from 'sanitize-html';

const OPTIONS = {
  allowedTags: [
    'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    '*': [],
  },
  // No data:, javascript:, vbscript: or protocol-relative URLs.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Drop the contents of elements that must never survive, rather than
  // leaving their text behind.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, rel: 'noopener noreferrer' },
    }),
  },
};

export function sanitizeBlogHtml(html) {
  return sanitizeHtml(String(html == null ? '' : html), OPTIONS);
}

export default sanitizeBlogHtml;
