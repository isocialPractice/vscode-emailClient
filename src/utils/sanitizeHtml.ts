/**
 * Conservative HTML sanitizer for rendering email bodies inside the webview.
 *
 * This is the first of two defense layers: the webview's Content-Security-
 * Policy (script-src limited to a per-load nonce, no frames, images limited
 * to data: URIs) blocks execution and remote loads even if a pattern slips
 * through here. Remote images are intentionally blocked, matching the
 * privacy default of desktop email clients.
 */

const BLOCKED_TAGS = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'meta',
  'base',
  'link',
];

export function sanitizeEmailHtml(html: string): string {
  let out = html;

  // Remove blocked elements together with their content where they can have
  // content, then any stray open/close tags.
  for (const tag of BLOCKED_TAGS) {
    const paired = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi');
    const single = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
    out = out.replace(paired, '').replace(single, '');
  }

  // Remove HTML comments (can hide conditional payloads).
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  // Strip inline event handlers: onclick, onerror, onload, ...
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // Neutralize scriptable URL schemes in href/src/action attributes.
  out = out.replace(
    /\s(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi,
    ' $1=$2#$2'
  );

  return out;
}

/** Plain-text body to minimal, escaped HTML (used when no HTML part exists). */
export function textToHtml(text: string): string {
  return `<pre class="plain-body">${escapeHtml(text)}</pre>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
