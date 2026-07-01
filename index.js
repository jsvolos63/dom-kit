// @jfs/dom-kit — shared, dependency-free DOM / escaping / URL-guard primitives
// for the JFS family of buildless static sites.
//
// Two groups of helpers:
//
//   Group A — PURE (no DOM): escapeHtml / escHtml / escAttr, safeUrl,
//     safeImageUrl, sanitizeUrl, sanitizeHref. Importable and testable in
//     plain node.
//
//   Group B — DOM-dependent: el / elem, byId, $ / $$, sanitizeHtml. These
//     reach for `document` / `DOMParser`, which the browser supplies at
//     runtime (and a DOM shim supplies in tests). This module imports
//     NOTHING — it stays dependency-free at install time.
//
// Compatibility-superset rule (see README): the sibling apps grew slightly
// different helpers for the same idea, so they adopt the kit by changing
// IMPORT PATHS, not call sites. That means we keep BOTH URL-guard fallbacks
// (safeUrl → "#", sanitizeUrl → "") byte-for-byte like their origins, and we
// export one all-5-character escaper under every name the siblings use
// (escapeHtml / escHtml / escAttr).

// ---------------------------------------------------------------------------
// Group A — pure helpers
// ---------------------------------------------------------------------------

// All five HTML-significant characters. The textContent → innerHTML trick
// only escapes <, >, & — quotes are left untouched, which is unsafe in
// attribute contexts. Replacing all five explicitly keeps the helper
// usable as `value="${escapeHtml(x)}"` too, not just inside text nodes.
const HTML_ESCAPES = {
    '&':  '&amp;',
    '<':  '&lt;',
    '>':  '&gt;',
    '"':  '&quot;',
    "'":  '&#39;',
};
const HTML_ESCAPE_REGEX = /[&<>"']/g;

/**
 * Escape a string for safe insertion into innerHTML — including HTML
 * attribute contexts. Coerces non-string values via String() and treats
 * null / undefined as empty so callers don't have to guard upstream.
 */
export function escapeHtml(str) {
    if (str == null) return '';
    const s = typeof str === 'string' ? str : String(str);
    return s.replace(HTML_ESCAPE_REGEX, (ch) => HTML_ESCAPES[ch]);
}
// Aliases — market-monitor uses escHtml/escAttr, JFS-Sports uses escapeHtml.
// Escaping the single quote too is a strict superset (harmless for the
// market-monitor callers that used a 4-char escHtml).
export { escapeHtml as escHtml, escapeHtml as escAttr };

/**
 * Art-Gallery URL guard. Allows http(s):, mailto:, protocol-relative
 * (`//` → https:), and relative (`/`, `#`, `?`). Everything else — including
 * javascript:, data:, vbscript: — collapses to `"#"` so a link never fires a
 * hostile scheme.
 */
export function safeUrl(url) {
    if (url == null) return "#";
    const s = String(url).trim();
    if (!s) return "#";
    // Protocol-relative is treated as https. This check has to run before the
    // single-slash check below, otherwise "//evil.com" would return verbatim
    // and resolve against the current scheme (file://, http://, etc.).
    if (s.startsWith("//")) return "https:" + s;
    // Relative paths and fragments are safe.
    if (s.startsWith("/") || s.startsWith("#") || s.startsWith("?")) return s;
    const lower = s.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:")) {
        return s;
    }
    return "#";
}

/**
 * Allow only http(s), protocol-relative, blob:, and data:image/* URLs as
 * <img src>. Everything else (javascript:, data:text/html, vbscript:, file:,
 * …) returns an empty string so the browser doesn't issue any request.
 */
export function safeImageUrl(url) {
    if (url == null) return "";
    const s = String(url).trim();
    if (!s) return "";
    if (s.startsWith("//")) return "https:" + s;
    const lower = s.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) return s;
    if (lower.startsWith("blob:")) return s;
    if (lower.startsWith("data:image/")) return s;
    return "";
}

/**
 * JFS-Sports URL sanitizer for innerHTML interpolation. Parses with `new
 * URL()`, whitelists http(s) only, and returns the HTML-ESCAPED normalized
 * href. Reject / parse-fail → `""`.
 *
 * Whitelist (not blacklist) so a future protocol can't slip through a missing
 * branch. u.href is the parsed/normalised form; escapeHtml additionally
 * encodes & → &amp; for valid HTML attributes.
 */
export function sanitizeUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        if (u.protocol === 'https:' || u.protocol === 'http:') return escapeHtml(u.href);
        return '';
    } catch {
        return '';
    }
}

/**
 * Like sanitizeUrl, but returns the URL WITHOUT HTML-attribute escaping. Use
 * when passing the value through setAttribute / element.src / element.href,
 * where the DOM stores the attribute verbatim and HTML escaping would
 * over-encode characters like `&` (`http://x.com/?a=1&b=2` → broken).
 * Reject / parse-fail → `""`.
 */
export function sanitizeHref(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
        return '';
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------
// Group B — DOM-dependent helpers
// ---------------------------------------------------------------------------

// Tiny DOM-builder helper used by renderers to replace
// `node.innerHTML = '...'` patterns with structural construction.
// Text-shaped values pass through textContent (auto-escaped),
// eliminating the need for escapeHtml() at every interpolation
// point and removing one whole class of XSS surface area: a
// renderer that forgets `escapeHtml(apiResponseField)` while
// building an HTML string used to ship a working injection
// vector; the same renderer using `el(...)` cannot.
//
// Usage:
//   el('div', { class: 'card' }, el('span', null, 'hello'))
//
// Special attribute keys:
//   class    → element.className
//   text     → element.textContent (shortcut for a single string
//              child; can't be combined with children args)
//   data     → object whose keys/values become element.dataset.*
//             (camelCase keys become data-camel-case attributes
//             per the standard DOMStringMap rules)
//   on       → object whose keys are event names → handler
//             functions. Event delegation via data-action is the
//             default pattern; this is for the rare per-element
//             listener case.
//   Anything else → setAttribute(key, value) when the value is
//                   non-null. null / undefined values are skipped
//                   so `{ title: maybeText }` doesn't emit
//                   `title=""`.
//
// Children:
//   * null / undefined / false → skipped
//   * string                   → text node (auto-escaped)
//   * Node                     → appended as-is
//   * array                    → flattened (one level)
export function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
        for (const k of Object.keys(attrs)) {
            const v = attrs[k];
            if (v == null) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'data') {
                for (const dk of Object.keys(v)) {
                    const dv = v[dk];
                    if (dv != null) node.dataset[dk] = String(dv);
                }
            } else if (k === 'on') {
                for (const ek of Object.keys(v)) {
                    node.addEventListener(ek, v[ek]);
                }
            } else {
                node.setAttribute(k, String(v));
            }
        }
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

/**
 * Weather-compatible thin wrapper over el() — `elem(tag, className, text)` —
 * so Weather migrates without call-site changes.
 */
export function elem(tag, className, text) {
    return el(tag, { class: className || null, text: text == null ? null : text });
}

/** document.getElementById shorthand (FlightCheck & Weather's `$`). */
export const byId = (id) => document.getElementById(id);

/** CSS-selector query shorthand (Art-Gallery-style `$` / `$$`). */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Whitelist-based HTML sanitizer for description blobs that some sources
// supply pre-formatted. Returns a string of HTML safe to assign to
// innerHTML. Anything not on the allow-list — script/style/iframe, on*
// attributes, javascript: URLs, etc. — is dropped.
const _ALLOWED_TAGS = new Set([
    "a", "abbr", "b", "blockquote", "br", "cite", "code", "dd", "dl", "dt",
    "em", "i", "li", "ol", "p", "pre", "small", "span", "strong", "sub",
    "sup", "u", "ul",
]);
const _ALLOWED_ATTRS = {
    a:    new Set(["href", "title"]),
    abbr: new Set(["title"]),
    span: new Set(["title"]),
};

export function sanitizeHtml(html) {
    if (html == null) return "";
    const str = String(html);
    if (!str) return "";
    const doc = new DOMParser().parseFromString(`<div>${str}</div>`, "text/html");
    const root = doc.body.firstChild;
    if (!root) return "";
    _scrub(root);
    return root.innerHTML;
}

function _scrub(node) {
    // Walk children with a snapshot — replacing nodes mutates the live list.
    const kids = Array.from(node.childNodes);
    for (const child of kids) {
        if (child.nodeType === 1 /* Element */) {
            const tag = child.tagName.toLowerCase();
            if (!_ALLOWED_TAGS.has(tag)) {
                // Unwrap unknown tags: keep the children, drop the wrapper. This
                // preserves text content from things like <div>/<font>/<img>.
                while (child.firstChild) node.insertBefore(child.firstChild, child);
                node.removeChild(child);
                continue;
            }
            const allowed = _ALLOWED_ATTRS[tag] || new Set();
            for (const attr of Array.from(child.attributes)) {
                const name = attr.name.toLowerCase();
                if (!allowed.has(name)) {
                    child.removeAttribute(attr.name);
                    continue;
                }
                if (name === "href") {
                    const safe = safeUrl(attr.value);
                    child.setAttribute("href", safe);
                    // Anchor links open in a new tab — give them noopener/noreferrer
                    // so the target page can't reach back via window.opener.
                    if (safe !== "#") {
                        child.setAttribute("target", "_blank");
                        child.setAttribute("rel", "noopener noreferrer");
                    }
                }
            }
            _scrub(child);
        } else if (child.nodeType !== 3 /* Text */ && child.nodeType !== 4 /* CDATA */) {
            // Drop comments, processing instructions, etc.
            node.removeChild(child);
        }
    }
}
