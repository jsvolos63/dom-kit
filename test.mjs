// Tests for @jfs/dom-kit. Run with `node test.mjs`.
//
// Group A (pure) functions are tested with no DOM. Group B (DOM-dependent)
// functions get a DOM shim from `jsdom` (a devDependency only — index.js
// itself imports nothing). We install `document` / `DOMParser` on globalThis
// BEFORE importing the kit so the DOM-reaching helpers resolve the globals at
// call time. jsdom is used over linkedom because its DOMParser faithfully
// synthesizes a full html/body document for `text/html` fragments — which is
// what sanitizeHtml's `doc.body.firstChild` relies on (matching browsers).

import assert from 'node:assert/strict';

// --- Install a DOM shim on globals (devDependency only) --------------------
const { JSDOM } = await import('jsdom');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
const { document, DOMParser } = window;
globalThis.document = document;
globalThis.DOMParser = DOMParser;

const {
    escapeHtml, escHtml, escAttr,
    safeUrl, safeImageUrl, sanitizeUrl, sanitizeHref,
    el, elem, byId, $, $$, sanitizeHtml,
} = await import('./index.js');

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
}

console.log('Group A — pure helpers');

// --- escapeHtml (all 5 chars) ----------------------------------------------
test('escapeHtml escapes all five significant characters', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});
test('escapeHtml treats null/undefined as empty string', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
});
test('escapeHtml coerces non-strings via String()', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(0), '0'); // not treated as nullish
});
test('escHtml and escAttr are aliases of the all-5 escaper', () => {
    assert.equal(escHtml, escapeHtml);
    assert.equal(escAttr, escapeHtml);
    assert.equal(escAttr(`'`), '&#39;');
});

// --- safeUrl (Art-Gallery semantics: reject → "#") -------------------------
test('safeUrl rejects javascript:/data:/vbscript: → "#"', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '#');
    assert.equal(safeUrl('data:text/html,<script>'), '#');
    assert.equal(safeUrl('vbscript:msgbox(1)'), '#');
    assert.equal(safeUrl('JavaScript:alert(1)'), '#'); // case-insensitive
});
test('safeUrl promotes protocol-relative //host → https://host', () => {
    assert.equal(safeUrl('//evil.com'), 'https://evil.com');
});
test('safeUrl allows http(s), mailto, and relative/fragment', () => {
    assert.equal(safeUrl('http://x.com'), 'http://x.com');
    assert.equal(safeUrl('https://x.com'), 'https://x.com');
    assert.equal(safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
    assert.equal(safeUrl('/path'), '/path');
    assert.equal(safeUrl('#frag'), '#frag');
    assert.equal(safeUrl('?q=1'), '?q=1');
});
test('safeUrl null/empty → "#"', () => {
    assert.equal(safeUrl(null), '#');
    assert.equal(safeUrl('   '), '#');
});

// --- safeImageUrl (reject → "") --------------------------------------------
test('safeImageUrl allows data:image/* but rejects other data:', () => {
    assert.equal(safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    assert.equal(safeImageUrl('data:text/html,<script>'), '');
});
test('safeImageUrl allows http(s), protocol-relative, blob:; rejects mailto/js', () => {
    assert.equal(safeImageUrl('https://x.com/a.png'), 'https://x.com/a.png');
    assert.equal(safeImageUrl('//cdn.com/a.png'), 'https://cdn.com/a.png');
    assert.equal(safeImageUrl('blob:abc'), 'blob:abc');
    assert.equal(safeImageUrl('mailto:a@b.com'), '');
    assert.equal(safeImageUrl('javascript:alert(1)'), '');
});

// --- sanitizeUrl (JFS semantics: HTML-escaped, reject → "") ----------------
test('sanitizeUrl rejects mailto: (http(s) only) → ""', () => {
    assert.equal(sanitizeUrl('mailto:a@b.com'), '');
    assert.equal(sanitizeUrl('javascript:alert(1)'), '');
    assert.equal(sanitizeUrl('not a url'), '');
});
test('sanitizeUrl HTML-escapes & in query strings', () => {
    assert.equal(sanitizeUrl('http://x.com/?a=1&b=2'), 'http://x.com/?a=1&amp;b=2');
});
test('sanitizeUrl falsy → ""', () => {
    assert.equal(sanitizeUrl(''), '');
    assert.equal(sanitizeUrl(null), '');
});

// --- sanitizeHref (verbatim, reject → "") ----------------------------------
test('sanitizeHref keeps & verbatim (no HTML escaping)', () => {
    assert.equal(sanitizeHref('http://x.com/?a=1&b=2'), 'http://x.com/?a=1&b=2');
});
test('sanitizeHref rejects non-http(s) → ""', () => {
    assert.equal(sanitizeHref('mailto:a@b.com'), '');
    assert.equal(sanitizeHref('javascript:alert(1)'), '');
});

console.log('Group B — DOM-dependent helpers');

// --- el() auto-escaping + special keys -------------------------------------
test('el() auto-escapes string children', () => {
    const a = el('a', { href: '#', text: '<script>bad</script>' });
    assert.equal(a.tagName.toLowerCase(), 'a');
    assert.equal(a.textContent, '<script>bad</script>');
    // Rendered as escaped entities, not a live element.
    assert.ok(a.innerHTML.includes('&lt;script&gt;'));
    assert.ok(!a.innerHTML.includes('<script>'));
});
test('el() maps class/text/data and skips null attrs', () => {
    const d = el('div', { class: 'card', data: { fooBar: 'x', skip: null }, title: null });
    assert.equal(d.className, 'card');
    assert.equal(d.dataset.fooBar, 'x');
    assert.equal(d.dataset.skip, undefined);
    assert.equal(d.hasAttribute('title'), false);
});
test('el() on: attaches an event listener that fires', () => {
    let fired = 0;
    const b = el('button', { on: { click: () => { fired++; } } });
    b.dispatchEvent(new window.Event('click'));
    assert.equal(fired, 1);
});
test('el() flattens array children one level and skips null/false', () => {
    const ul = el('ul', null, [el('li', null, 'a'), null, false, el('li', null, 'b')]);
    assert.equal(ul.querySelectorAll('li').length, 2);
});

// --- elem() wrapper --------------------------------------------------------
test('elem(tag, className, text) wraps el()', () => {
    const s = elem('span', 'lbl', 'hi');
    assert.equal(s.className, 'lbl');
    assert.equal(s.textContent, 'hi');
});

// --- byId / $ / $$ ---------------------------------------------------------
test('byId / $ / $$ query the document', () => {
    document.body.innerHTML = '<div id="root"><p class="x">1</p><p class="x">2</p></div>';
    assert.equal(byId('root').tagName.toLowerCase(), 'div');
    assert.equal($('.x').textContent, '1');
    assert.equal($$('.x').length, 2);
    // $/$$ accept a root scope
    assert.equal($$('.x', byId('root')).length, 2);
});

// --- sanitizeHtml whitelist + unknown-tag unwrap ---------------------------
test('sanitizeHtml unwraps unknown tags but keeps their text', () => {
    // The wrapper the sanitizer parses is `<div>${str}</div>`, so top-level
    // nodes of `str` are the ones _scrub visits directly.
    const out = sanitizeHtml('hello <script>alert(1)</script><div>kept</div>world');
    assert.ok(!/<div>/i.test(out));    // unknown block tag unwrapped
    assert.ok(!/<script>/i.test(out)); // script tag unwrapped (its raw text stays)
    assert.ok(out.includes('hello'));
    assert.ok(out.includes('kept'));   // unwrapped div's text preserved
    assert.ok(out.includes('world'));
});
test('sanitizeHtml keeps allowed tags and drops disallowed attrs', () => {
    const out = sanitizeHtml('<p onclick="x()">hi <b>bold</b></p>');
    assert.ok(/<p>/i.test(out));
    assert.ok(!/onclick/i.test(out));
    assert.ok(/<b>bold<\/b>/i.test(out));
});
test('sanitizeHtml runs href through safeUrl + adds noopener on real links', () => {
    const bad = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    assert.ok(bad.includes('href="#"'));
    assert.ok(!/target=/i.test(bad)); // "#" links get no target/rel
    const good = sanitizeHtml('<a href="https://x.com" title="t">x</a>');
    assert.ok(good.includes('href="https://x.com"'));
    assert.ok(/rel="noopener noreferrer"/i.test(good));
    assert.ok(/target="_blank"/i.test(good));
    assert.ok(good.includes('title="t"'));
});
test('sanitizeHtml nullish/empty → ""', () => {
    assert.equal(sanitizeHtml(null), '');
    assert.equal(sanitizeHtml(''), '');
});

console.log(`\nAll ${passed} tests passed.`);
