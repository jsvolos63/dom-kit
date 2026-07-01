# @jfs/dom-kit

Shared, dependency-free **DOM / escaping / URL-guard primitives** for the JFS
family of buildless static sites (market-monitor, Surf-Tracker, FlightCheck,
JFS-Sports, Art-Gallery-, Weather, BearsMockDraft, Zepbound-).

The same HTML-escaping, URL-sanitizing, and DOM-building helpers are
hand-rolled in 5–6 sibling repos, each slightly different — and this is the
XSS-sensitive layer where drift means real bugs (a `data:` URL that slips a
guard, a query-string `&` double-escaped into a broken link, a renderer that
forgets `escapeHtml()` at one interpolation point). One tested copy eliminates
a whole class of injection surface. This is the same rationale that produced
[`@jfs/netlify-kit`](https://github.com/jsvolos63/netlify-kit) (serverless
primitives), `@jfs/pwa-kit`, and
[`@jfs/news-kit`](https://github.com/jsvolos63/news-kit) (RSS pipeline). It is
the 4th kit in the family.

Pure ESM, **dependency-free at install and runtime**. `index.js` imports
nothing — the DOM helpers reach for `document` / `DOMParser`, which the browser
supplies at runtime (and a `jsdom` shim supplies in the test only, as a
devDependency).

## Compatibility superset

Apps adopt the kit by **changing import paths, not call sites** — the same rule
`netlify-kit` follows. The sibling apps grew two slightly different families of
URL guard that differ only in their reject fallback, so both are kept
byte-for-byte like their origin rather than collapsed:

- `safeUrl()` (Art-Gallery) rejects to **`"#"`** — for `href` interpolation.
- `sanitizeUrl()` / `sanitizeHref()` (JFS-Sports) reject to **`""`** — for
  `innerHTML` and `setAttribute` respectively.

Same for escaping: one all-5-character escaper is exported under **every** name
the siblings use — `escapeHtml`, `escHtml`, `escAttr` — so no caller changes
behavior. Escaping the single quote too is a strict superset (harmless for the
market-monitor callers that used a 4-char `escHtml`).

The consolidated canonical sources:

- `FlightCheck/src/dom.js` — `escapeHtml`, `$` (getElementById)
- `Art-Gallery-/util.js` — `safeUrl`, `safeImageUrl`, `sanitizeHtml` + `_scrub`
- `JFS-Sports/helpers.js` — `sanitizeUrl` / `sanitizeHref` (the dual split)
- `JFS-Sports/dom.js` — `el()` builder

## Quick start

```js
import { el, escapeHtml, safeUrl, sanitizeHtml } from '@jfs/dom-kit';

// Auto-escaping element builder — no manual escapeHtml() at interpolation points.
const card = el('div', { class: 'card' },
  el('a', { href: safeUrl(item.url), text: item.title }),
  el('p', null, item.summary),          // string child → auto-escaped text node
);
document.body.appendChild(card);

// Escape a value going into an innerHTML string / attribute context.
node.innerHTML = `<span title="${escapeHtml(item.title)}">…</span>`;

// Whitelist-sanitize a pre-formatted description blob before innerHTML.
node.innerHTML = sanitizeHtml(feed.contentHtml);
```

## API

### Group A — pure (no DOM, testable in plain node)

- **`escapeHtml(s)`** — escape `& < > " '`. Nullish → `''`, else `String(s)`.
  Also exported as **`escHtml`** and **`escAttr`** (aliases of the same
  all-5-char function).
- **`safeUrl(url)`** — allow `http(s):`, `mailto:`, protocol-relative
  (`//` → `https:`), and relative (`/ # ?`); everything else → **`"#"`**.
- **`safeImageUrl(url)`** — allow `http(s):`, protocol-relative, `blob:`,
  `data:image/*`; everything else → **`""`** (so the browser issues no
  request).
- **`sanitizeUrl(url)`** — `new URL()` parse, `http(s)` only, return the
  **HTML-escaped** normalized `href`; reject / parse-fail → **`""`**. For
  `innerHTML` interpolation.
- **`sanitizeHref(url)`** — same as `sanitizeUrl` but **not** HTML-escaped; for
  `setAttribute` / `.href` / `.src`, where the DOM stores the value verbatim
  and extra `&`-escaping would corrupt query strings. Reject → **`""`**.

### Group B — DOM-dependent (`document` / `DOMParser` at runtime)

- **`el(tag, attrs, ...children)`** — auto-escaping element builder. Special
  attr keys: `class`→`className`, `text`→`textContent`, `data`→`dataset.*`,
  `on`→`addEventListener`; everything else → `setAttribute` (null values
  skipped). Children: string → text node (auto-escaped), `Node` → appended,
  array → flattened one level, `null`/`false` → skipped.
- **`elem(tag, className, text)`** — Weather-compatible thin wrapper over
  `el()`.
- **`byId(id)`** — `document.getElementById(id)`.
- **`$(sel, root=document)`** / **`$$(sel, root=document)`** —
  `querySelector` / `[...querySelectorAll]` (CSS-selector query).
  **Collision note:** FlightCheck / Weather's `$` is *getElementById*; those
  two migrate as `import { byId as $ }`. Art-Gallery keeps `$` as CSS-query.
- **`sanitizeHtml(html)`** — whitelist sanitizer (DOMParser + `_scrub`
  recursion). Allowed tags: `a abbr b blockquote br cite code dd dl dt em i li
  ol p pre small span strong sub sup u ul`; allowed attrs `href` / `title` only
  (per the allow-map); unknown tags are unwrapped (children kept); `href` runs
  through `safeUrl` and real links get `target="_blank" rel="noopener
  noreferrer"`; comments / PIs dropped.

## Testing

```bash
npm install   # pulls jsdom (devDependency only)
npm test      # node test.mjs
```

The pure Group-A functions are asserted with `node:assert` (security cases
covered explicitly: `javascript:` / `data:` / `vbscript:` rejected; `//host` →
`https://host`; `mailto:` allowed by `safeUrl` but not `sanitizeUrl`; `&`
escaped by `sanitizeUrl` but verbatim through `sanitizeHref`; all 5 chars
escaped). The DOM Group-B functions run against a `jsdom` shim installed on
`globalThis` before importing the kit — `jsdom` over `linkedom` because its
`DOMParser` faithfully synthesizes a full `html/body` document for `text/html`
fragments, which `sanitizeHtml`'s `doc.body.firstChild` relies on.

## Distribution / consumption

These siblings are **buildless** — they load ES modules directly in the browser
and can't `npm install` at runtime. Follow `netlify-kit`'s vendoring model:
consumers pin `github:jsvolos63/dom-kit` in `package.json` and run a small
`scripts/vendor-dom-kit.mjs` that copies `index.js` into the app tree (see
market-monitor's `scripts/vendor-netlify-kit.mjs` + `npm run vendor:sync` /
`vendor:check` CI gate for the exact pattern to replicate). A single
dependency-free `index.js` is what makes that copy trivial.

## Consumer migration checklist (follow-up — not done in this session)

Each is import-path-only except where a call-site note is given. Bump each
repo's shipped version per its `CLAUDE.md` when you touch shell assets.

- **Art-Gallery-** — `util.js` (`escapeHtml`, `safeUrl`, `safeImageUrl`,
  `sanitizeHtml`) + `dom.js`. Keeps `$` as CSS-query.
- **FlightCheck** — `src/dom.js` (`escapeHtml`; `$` → `import { byId as $ }`).
- **JFS-Sports** — `dom.js` (`el`), `helpers.js` (`escapeHtml`, `sanitizeUrl`,
  `sanitizeHref`). These are re-exported from an IIFE/namespace today — verify
  the re-export wiring after swapping the source.
- **Weather** — `js/lib/dom.js` (`$` → `byId`, `elem` → kit `elem`).
- **BearsMockDraft** — `shared.js` (`el` has a *different* `(tag, opts)`
  signature — this one needs **call-site changes**, not just an import swap;
  `escapeText` / `escapeAttr` → `escapeHtml`, `safeUrl`).
- **market-monitor** — `js/utils/escape.js` (`escHtml`, `escAttr` → kit
  aliases). Vendor via the same script pattern it already uses for netlify-kit.

## License

MIT © jsvolos63
