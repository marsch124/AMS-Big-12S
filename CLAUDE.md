# AMS Big 12S

An offline-first PWA for reading *Alcoholics Anonymous* (1939 first edition),
taking notes, keeping the points to raise with a sponsor or a sponsee, and
resuming where the reader stopped. Built for Martin's iPhone; a sibling to his
`AMS-Instructions` app.

- **Repo:** `marsch124/AMS-Big-12S` (public), default branch `main`
- **Live:** https://marsch124.github.io/AMS-Big-12S/ — GitHub Pages, deploy from
  `main` / root. It is **on**; pushing to `main` republishes automatically.
- **Current version:** 1.19 (`APP_VERSION` in `js/app.js` *and* `sw.js`)

## Where this is up to

The twelve-step section is being built in phases. The full design plan, with the
anatomy of a step page and what each step's own work needs, is at
https://claude.ai/code/artifact/b467fb04-03e9-4f26-aa77-7f8f18b8c433

| | | |
|---|---|---|
| Phase 1 | done | `steps.source.json` format, `build-steps.js`, step 1 written |
| Phase 2 | done | Steps tab, list of twelve, step page: wording, explanation, references, questions |
| Phase 3 | done | Dated notes per step, folded when long |
| Phase 4 | done | Answerable questions keeping every earlier answer; hide, add your own |
| Phase 5 | **done** | Writing the twelve. **All twelve are written. 83 references resolve, none ambiguous. No stubs remain.** |
| Phase 6 | **in progress** | Each step's own work — block 5 below. **Built: `inventory-tables` (4), `amends-list` (8), `amends-progress` (9), `daily-entries` (10), `daily-practice` (11), `prayer` (3, 7), `two-lists` (1, 2). Three kinds still declared-only, so three of twelve steps show no work section.** |
| Phase 7 | to do | Progress on the list, copy a step out for a sponsor, docs, v2.0 |

**Audited 2026-08-27 against the running app, not from memory.** Every step page
was opened in a browser and checked for a work section. Nine of twelve now show one
(1, 2, 3, 4, 7, 8, 9, 10, 11); three do not (5, 6, 12), because their declared
`work.kind` has no branch in `renderStepWork()`. The dispatcher hides the section
rather than showing an empty one, so this is invisible unless you go looking.

Remaining kinds, smallest first:

| kind | steps | note |
|---|---|---|
| `sittings` | 5 | Who, when, and what was held back. **Was missing from this list until the audit** — do not lose it again. |
| `carried-defects` | 6 | Annotates step 4's rows exactly as step 9 annotates step 8's. |
| `people-worked-with` | 12 | Ties to the sponsee tag the Notes tab already has. |

Also open, all Phase 7:

- **The Steps list undercounts.** Its per-step number comes from
  `Store.notesForStep()`, which deliberately excludes answers and work rows.
  Answer eight questions on step 1 and the row still shows nothing. Progress on
  the list needs to count notes, answers and work together.
- **No way to copy a step out** for a sponsor — never started.
- **README** still describes the Steps tab in Phase 2 terms: no mention of the
  inventory tables, the amends list, or the daily practice.
- **The plan artifact** (linked above) predates all of this and still reads as
  though nothing is built.

**One smoke check guards the hide-when-unbuilt behaviour**, currently pointed at
step five. When five is built, repoint it at another unbuilt step rather than
deleting it — it is the only thing proving an unbuilt kind hides its section
instead of showing an empty one.

**`build-steps.js` resolves `work.prayerRef` too**, as of 1.18. Work modules can
point into the book, and until then only `text` and `references` were validated —
a typo in a work passage would have failed silently at run time instead of at
build time.

Build them by adding a branch in `renderStepWork()` in `ui.js`. Step 4's build is
the pattern to copy: rows in their own IndexedDB store, carried explicitly by
`backup.js`, an empty row refused, and a smoke test that covers the backup round
trip *both* ways — including that a backup written before the kind existed does
not wipe what is on the device.

After that, phase 7: progress on the steps list, copying a step out for a
sponsor, docs, v2.0.

**Phase 6, per step.** All twelve now declare a `work` kind: `two-lists` (1, 2),
`prayer` (3, 7), `inventory-tables` (4), `sittings` (5), `carried-defects` (6),
`amends-list` (8), `amends-progress` (9), `daily-entries` (10), `daily-practice`
(11), `people-worked-with` (12). **Only `inventory-tables` has a renderer.** `renderStepWork()`
in `ui.js` hides the whole work section for a kind it cannot draw, so steps 1, 2,
3 and 5 show no work section at all rather than an empty one — build the next
kind by adding a branch there. What each needs: 1 two lists of evidence; 2 what cannot be accepted yet
and what has shifted; 3 and 7 a prayer with a date kept each time; **4 three
inventory tables — resentments, fears, conduct — the largest build here**; 5 who
you sat with and what was held back; 6 the defects from step 4 carried through;
8 the amends list, names carried from step 4; 9 the same list with status and
outcome, lives for years; 10 short daily entries, a different rhythm; 11 the
morning and evening prompts plus a practice log; 12 who you have worked with.

**The step text disagrees with itself in one place.** Step five as printed in
*How It Works* says "the exact nature of our wrongs"; *Into Action* says
"defects" when it takes the step up again. Both are in the 1939 text as Dover
sets it — checked, not a transcription slip. Step 5's explanation says so rather
than quietly picking one.

**The evening review is filed under step eleven, not step ten (1.15).** *Into
Action* ¶42 opens step eleven, and ¶43 — "When we retire at night, we
constructively review our day" — follows it, although its content reads like
step ten and most people work it there. Step 11 carries it, and step 11's
explanation says plainly that the arrangement is the book's rather than a
mistake in this app. Do not quietly move it to step 10.

**One word of the book text has been corrected, on purpose (1.14).** *Into
Action* ¶36 read "Wé are going to know a new freedom and happiness" — a stray
acute from the EPUB conversion, sitting in the middle of the promises. Martin
asked for it to be fixed. It was corrected in
`data/alcoholics-anonymous-1939.txt` and `book.json` rebuilt from it, never
patched in the app, and the rebuild still reports 106,067 of 106,067 with one
paragraph changed by one word. **This is the only such change, and the bar for
another one is the same: an artifact of conversion, demonstrably not the printed
page, fixed at the source and rebuilt.** The other two accents in the whole text,
protegé and fiancée, are the book's own and must stay.

**Step 9's promises are the ones printed in the amends (1.13).** *Into Action*
¶36, "If we are painstaking about this phase of our development" — they belong to
step nine in this edition, not to a later chapter, and step 9 links them there.

**Steps 6 and 7 are short on purpose (1.12).** Martin asked for this
explicitly, after being shown the alternative. The 1939 text gives the two of
them 134 words in total — *Into Action* ¶11 is step six, ¶12 is the step-seven
prayer and ends "We have then completed step seven" — and nothing else. "Entirely
ready" appears once in the whole book, in the step list itself; "defects of
character" twice. So they carry four references each and three paragraphs rather
than four, and the shortness is the point. Do not pad them out later, and in
particular do not reach for the 1952 *Twelve Steps and Twelve Traditions*, which
is where nearly all the familiar step 6 and 7 teaching comes from and is out of
bounds. The eight questions per step are unchanged: those are ours, not the
book's, and are where the value on these two pages actually is.

**A row can be written by two steps (1.16).** Step 9 records onto the row step 8
made, and step 6 will do the same to step 4's. Three things make that safe and
none of them is optional. `states` is a **map keyed by step id**
(`{step08:'willing', step09:'made'}`) because the two steps ask different
questions of the same row and a single field would have them overwriting each
other. `values` is flat and shared, so `build-steps.js` **refuses to build** when
a step and the step named in its `from` use the same field id — that guard has a
test. And the annotating step never deletes: step 9 hides the delete button, and
step 8 asks before removing a name that carries step 9's record. `on` is the
reader's chosen date, deliberately not `createdAt` — an amend made last week can
be recorded today.

**Step four's inventory is built (1.11).** Three tables, the columns taken from
the grudge list the book prints plus the "where were we to blame" turn. Two views
of the same rows: cards to fill in (stacked fields, the view you dictate into)
and a grid to read back (side by side, scrolling inside its own box). Rows live
in their own IndexedDB store, not in the note store — they are structured
records, not prose, and bending them into a note would have disturbed
`isStandalone()`, `isLooseNote()` and the counted lists that depend on them.
`DB_VERSION` is 2; the upgrade is guarded by `objectStoreNames.contains`, so an
existing install gains the store and keeps everything else.

**Settled already — do not re-ask.** Sponsor (not "spindrift", a transcription
slip). Chapter-and-passage references, no page numbers: the Dover pagination does
not match the edition people quote. Explanations in my voice, editable by him.
Step 4 gets full tables, not free text. Step work rides the normal backup, with a
plain warning at the moment of export. **No lock and no encryption** — asked and
declined explicitly.

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
js/db.js            IndexedDB wrapper (meta, book, notes, bookmarks, inventory)
js/store.js         Book, settings, position, notes, bookmarks, search
js/backup.js        Export / restore
js/ui.js            Screens, rendering, all event wiring
js/app.js           Bootstrap
data/book.json                      Parsed book the app reads (~577 KB)
data/alcoholics-anonymous-1939.txt  Source text book.json was built from
data/steps.source.json              Step material, written by hand
data/steps.json                     Built steps with references resolved
tools/epub-to-text.py  EPUB → plain text, skipping publisher matter
tools/build-book.js    Plain text → data/book.json
tools/build-steps.js   steps.source.json → steps.json, resolving book references
tools/smoke-test.js    146 end-to-end browser checks
tools/make-icons.py    Regenerate the PWA icon set
```

No build step, no framework, no dependencies. Plain ES5-ish JS in IIFEs
attaching globals (`DB`, `Store`, `Backup`, `UI`, `BookParser`).

## Running and testing

```bash
python3 -m http.server 7802 &
npm install playwright                    # once, not committed
node tools/smoke-test.js                  # 146 checks, expect 146/146
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

**Step notes fold by measurement, not by character count.** `applyClamp()`
clamps, measures `scrollHeight` against `clientHeight`, and unclamps again if the
note fits — so the "Show all" control only ever appears on a note that actually
has more to show. Dictated notes run to hundreds of words; guessing from string
length gets it wrong at both ends.

**The reader remembers where it was opened from.** `current.readerFrom` (and
`readerFromStep`) are set in `openReader()` only when arriving from another
screen, so chapter-to-chapter moves inside the reader do not overwrite it.
Without this, following a reference out of a step and pressing back dumped you
on the Read tab.

**A step's notes and its answers are both notes, told apart by `questionId`.**
Both carry `stepId`; only an answer carries `questionId`. `notesForStep()`
excludes answers deliberately — they belong under the question that prompted
them, not in the step's journal — and anything counting one must not count the
other. Answering again writes a *new* note rather than editing the old one, so
the history is the record.

**Question preferences are not notes.** Hidden and custom questions live in
`meta.stepPrefs` (`{hidden: {qid: true}, custom: {stepId: [{id, text}]}}`), and
`backup.js` carries them explicitly — without that, a restore would resurrect
questions the reader had put away and drop the ones they wrote. Putting a
question away never deletes its answers; `Store.questionText()` resolves a
hidden question's text so an answer on the Notes tab still shows what it
answered.

**One note store, four kinds of note.** A step journal entry is a note with a
`stepId` and no `sectionId`. That makes it *standalone* by `isStandalone()`,
which is right for `resolveNote()` but wrong for the Reflections list — so
`isLooseNote()` (standalone **and** no `stepId`) is what the "own" filter and its
count both use. Any chip's number must be of exactly what its own list shows: the
first cut counted Reflections with `isStandalone`, and the badge read 2 over an
empty list.

**One note store, three kinds of note.** A note carries `sectionId` +
`paraIndex` + `anchor` when it was written against a passage, and `sectionId:
null` when it was written straight onto the Notes tab — the things that do not
come out of a page. `tag` (`''`, `'sponsor'`, `'sponsee'`) is who it is waiting
for; `discussedAt` is when it was ticked off, and is never cleared by deleting
anything. `Store.isStandalone()` is the test; `Store.resolveNote()` returns a
passage-less note untouched rather than calling it an orphan. Do not split these
into a second store — one store is what makes a passage note and a talking point
the same object, searchable together and carried by the same backup.

**Step references are anchored the same way notes are, and resolved twice.**
`tools/build-steps.js` resolves each anchor against `book.json` at build time and
refuses to write anything if one matches nothing or matches more than one
paragraph. `Store.resolveStepRef()` resolves it *again* at runtime, trusting the
anchor over the stored index, so links survive the reader importing their own
copy. The two `flatten()` implementations — one in the build script, one in
`store.js` — must stay identical or the runtime pass will disagree with the
build. A reference that cannot be found is shown as unavailable, never opened at
a guessed paragraph.

**Question ids are load-bearing.** Answers will be stored against `s1-q1` and
friends, so renaming an id orphans what was written against it. Adding and
hiding questions is safe; renumbering is not. The build rejects duplicates.

**`Store.stepText()` strips the leading numeral** for display — the book prints
"1.We admitted", which is right in the reader and wrong on a page already headed
"Step 1". The reader still shows the paragraph exactly as printed.

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

## Writing the step material

**Register: keep the edge.** Martin chose this deliberately over two plainer
alternatives. The explanations mostly describe, but turn and address the reader
directly where the step warrants it — closer to how a sponsor talks than how a
manual reads. Steps 1–3 are the reference: "The delusion that we are like other
people has to be smashed. Not managed, not worked around. Smashed."; "It asks you
to stop insisting you already know."; "What is the part you are quietly keeping
back? There usually is one." Do not sand this down.

Four short paragraphs of explanation, five to seven verified references, eight
questions. Never assert what the book says without checking it — quote or link
instead. The material is not official A.A. text and must never be presented as
though it were.

## Style

Martin wants finished work, not options to choose between. Write plain, warm
copy in the UI — the app is used by someone in recovery, so avoid clinical or
jargon-heavy phrasing. British spelling in prose. Verify by rendering and
looking, not by assuming.
