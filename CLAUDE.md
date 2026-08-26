# AMS Big 12S

An offline-first PWA for reading *Alcoholics Anonymous* (1939 first edition),
taking notes, and resuming where the reader stopped. Built for Martin's iPhone;
a sibling to his `AMS-Instructions` app.

- **Repo:** `marsch124/AMS-Big-12S` (public), default branch `main`
- **Live:** https://marsch124.github.io/AMS-Big-12S/ — GitHub Pages, deploy from
  `main` / root. It is **on**; pushing to `main` republishes automatically.
- **Current version:** 1.2 (`APP_VERSION` in `js/app.js` *and* `sw.js`)

## Non-negotiables

**Never write book text from memory.** People quote this book precisely. A
plausible paraphrase is worse than a blank page, because nothing signals which
sentences drifted. Text only ever enters via a real source file.

**Only the 1939 first edition.** It is public domain in the US. The 2nd, 3rd and
4th editions are under copyright to A.A. World Services — never bundle or import
those. The bundled text came from the 2011 Dover republication; Dover's own 2011
introduction (© Dick B.) and biographical notes are still under copyright and
are excluded by name in `tools/epub-to-text.py`.

**Dover omits the original two-page Appendix.** A footnote closing *A Vision For
You* still refers to it. That dangling reference is faithful to the source, not
a bug. It is documented in the app's About panel and the README.

**The app name uses no A.A.W.S. mark.** It was deliberately renamed from
"AMS Big Book" to "AMS Big 12S" — "Big Book" is an A.A.W.S. trademark. Where
prose needs to name the book, use the actual title *Alcoholics Anonymous*, not
the nickname.

## Layout

```
index.html          Every screen and bottom sheet, in one shell
manifest.json       PWA metadata — paths are RELATIVE ("./"), see below
sw.js               Service worker: offline shell + book cache
css/style.css       Themes (sepia/light/dark/auto), reader typography
js/parser.js        Plain text → sections. Shared with tools/build-book.js
js/db.js            IndexedDB wrapper
js/store.js         Book, settings, position, notes, bookmarks, search
js/backup.js        Export / restore
js/ui.js            Screens, rendering, all event wiring
js/app.js           Bootstrap
data/book.json                      Parsed book the app reads (~577 KB)
data/alcoholics-anonymous-1939.txt  Source text book.json was built from
tools/epub-to-text.py  EPUB → plain text, skipping publisher matter
tools/build-book.js    Plain text → data/book.json
tools/smoke-test.js    34 end-to-end browser checks
tools/make-icons.py    Regenerate the PWA icon set
```

No build step, no framework, no dependencies. Plain ES5-ish JS in IIFEs
attaching globals (`DB`, `Store`, `Backup`, `UI`, `BookParser`).

## Running and testing

```bash
python3 -m http.server 7802 &
npm install playwright                    # once, not committed
node tools/smoke-test.js                  # 34 checks, expect 34/34
```

`CHROMIUM_PATH` overrides the browser binary; `SHOT_DIR` writes screenshots.
In a Claude Code container: `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

**Run the smoke test before every push.** It is the only thing standing between
a refactor and a broken reader on someone's phone.

## Rebuilding the text

```bash
python3 tools/epub-to-text.py book.epub -o data/alcoholics-anonymous-1939.txt
node tools/build-book.js data/alcoholics-anonymous-1939.txt
```

`build-book.js` reconciles output against source word by word. The current build
reports **`106,067 of 106,067 body words (exact — nothing dropped)`**. If that
line ever shows a shortfall, a heading guess has swallowed a line of prose —
investigate, do not accept it.

Expected shape: **43 sections, 1,453 paragraphs, 106,067 words** — Foreword,
The Doctor's Opinion, chapters `ch01`–`ch11`, the `stories` part divider, and 29
story sections.

## Things that bit me, so they do not bite again

**Headings are marked with `# `, not guessed.** `epub-to-text.py` emits
`# TITLE`. When any `# ` marker is present, `parser.js` disables the all-caps
heuristic entirely (`usesExplicitHeadings`). Guessing had promoted two lines of
*prose* to sections — a capitalised question in *We Agnostics*, a Herbert
Spencer attribution in *An Artist's Concept* — splitting both chapters and
losing the lines. The heuristic still exists for unmarked text pasted by hand.

**`isNoise()` is gated on `aggressive`.** Page-number and running-head stripping
runs only for unmarked text. It was matching the Foreword's closing signature,
"ALCOHOLICS ANONYMOUS.", and deleting it.

**Reading position saves at four moments,** not just on scroll: on opening a
chapter, on scroll (debounced 400 ms), on leaving the reader, and on
`pagehide` / `visibilitychange`. The original only saved on scroll, so any
chapter short enough to fit one screen was never remembered. iOS kills
backgrounded PWAs without a `visibilitychange`, hence `pagehide`.

**Notes are anchored by text, not index.** Each stores `anchor` — the first 80
characters of its paragraph. `Store.resolveNote()` checks the stored index
first, then searches by anchor, then marks the note `orphan`. This is what lets
a reader swap in a differently formatted copy without their notes drifting.
Never "clean up" orphans by deleting them.

**Small caps come from the EPUB's markup.** The print edition opens chapters
with a drop cap plus small capitals; taken literally that yields "RARELY have we
seen". `epub-to-text.py` lowercases only `<span class="smallcaps">` and
`<small>`, leaving genuine capitals (ALCOHOLICS ANONYMOUS in chapter two,
"S. S." in *A Business Man's Recovery*) alone.

**`manifest.json` uses relative paths (`"./"`).** Absolute `/AMS-Big-Book/`
paths broke PWA install the moment the repo was renamed. Do not reintroduce an
absolute `start_url` or `scope`.

**`book.isImported` vs `book.textIncluded`.** `textIncluded` means there is text
to read from any source; `isImported` means the *reader* supplied it. Only
`isImported` may offer "Go back to the bundled copy" — otherwise the app offers
to remove text the reader never imported.

**Bump three things together when assets change:** `APP_VERSION` in `js/app.js`,
`APP_VERSION` and `CACHE_NAME` in `sw.js`, and the `?v=N` query on any changed
asset in *both* `index.html` and the `SHELL` list in `sw.js`. Miss the cache
name and installed copies keep serving stale files.

## Icons

Tab bar and sheet icons are inline SVG line art inheriting `currentColor`, so
they follow the theme. They replaced a mix of colour emoji and text glyphs that
rendered inconsistently and could not be themed. Draw against a render, not by
eye — the first quill read as a leaf until its shaft extended past the blade as
a nib, and vertical sliders collapsed into stubs where the knobs broke the
tracks. `tools/make-icons.py` generates the PWA app icons (pure-Python PNG, no
Pillow).

## Environment notes

Outbound HTTPS is blocked by org egress policy for nearly everything —
`WebFetch` included. `WebSearch` works (server-side). npm/PyPI bypass the proxy.
GitHub works for git and the MCP tools, but the GitHub App **cannot create
repositories** (403) and there is no Pages API tool; Martin does those in the
browser. He uses **GitHub Desktop on a Mac**, so explain git work in those terms
rather than as CLI commands.

## Style

Martin wants finished work, not options to choose between. Write plain, warm
copy in the UI — the app is used by someone in recovery, so avoid clinical or
jargon-heavy phrasing. British spelling in prose. Verify by rendering and
looking, not by assuming.
