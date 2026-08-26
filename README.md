# AMS Big 12S

A mobile-first PWA for reading *Alcoholics Anonymous* (the 1939 first edition)
offline, taking notes as you go, and picking up exactly where you stopped.

**Live:** https://marsch124.github.io/AMS-Big-12S/

The complete text ships with the app — install it and start reading, with or
without a signal.

## Features

- 📖 **Distraction-free reader** — serif or sans, four themes, adjustable size and spacing
- 🔖 **Remembers where you stopped** — down to the paragraph, restored on every launch
- ✎ **Notes on any passage** — tap a paragraph, write a note; it stays attached to those words
- 🗣 **Things to bring up** — mark anything for your sponsor or a sponsee, keep a running count of
  what is still waiting, tick it off after the conversation, and copy the list out before a call
- 💭 **Notes of your own** — write down what did not come from a page at all
- 🪜 **The twelve steps** — a page each, with the passages of the book that describe them,
  questions to take to a sponsor, and a dated journal that keeps every pass rather than
  overwriting the last
- 🔍 **Full-text search** — jump straight from a phrase to the passage it lives in
- 💾 **One-file backup** — notes, bookmarks, position, settings and (optionally) the text
- 📡 **Fully offline** — everything lives on your device; no account, no server, no tracking

## Installing it on your phone

1. Open the live link above in **Safari** (iOS) or **Chrome** (Android).
2. iOS: **Share → Add to Home Screen**. Android: **Menu → Install app**.
3. Launch it from the home screen. It runs full-screen and works with no signal.

## Notes, and things to talk about

Tap any paragraph while reading and choose **Add note**. The note stays attached
to the words it was written against, not to a paragraph number, so it survives a
re-import of the text.

Not everything worth keeping comes off a page, though. **+** at the top of the
Notes tab writes a note with no passage behind it — a question that surfaced on
the drive home, something to raise with a sponsee, a reflection that is nobody
else's business.

Any note, from a page or not, can be marked **Bring this up with — my sponsor**
or **my sponsee**:

- the filters at the top of the Notes tab carry a count of what is **still
  waiting** for each conversation;
- a marked note also says so **in the margin while you read**, so it turns up on
  the page as well as in a list;
- **Mark as talked about** stands a point down after the conversation. It keeps
  its place at the bottom of the list with the date on it — nothing is deleted —
  and goes back on the list if there turns out to be more to say;
- **Copy this list** puts everything still waiting on the clipboard, ready to
  paste into a message before a call.

**Reflections** gathers everything written that did not come from a page,
whoever it was for.

## The text

*Alcoholics Anonymous*, first edition, published April 1939 by Works Publishing
Company. **Public domain in the United States.**

43 sections, 1,453 paragraphs, 106,067 words:

| | |
|---|---|
| Front matter | Foreword, The Doctor's Opinion |
| Chapters 1–11 | Bill's Story → A Vision For You |
| Personal Stories | all 29, from The Doctor's Nightmare to Lone Endeavor |

### Provenance, and what is deliberately missing

The text was extracted from the **2011 Dover republication** (ISBN
0-486-48059-3), which reprints the 1939 edition. Two things follow from that,
both worth knowing:

- Dover's edition omits the **two-page Appendix** at the end of the original
  1939 book. A footnote closing *A Vision For You* still points to it. That
  omission is Dover's, not this app's.
- Dover's own **2011 introduction** (© Dick B.) and its biographical notes are
  **still under copyright** and are deliberately excluded. `tools/epub-to-text.py`
  skips them by name; only the 1939 text is here.

Later editions of the book — 2nd, 3rd and 4th — remain under copyright to
A.A. World Services, Inc. Do not import those.

Copyright status varies by country. Check your own jurisdiction before
redistributing any copy.

### Replacing the text

If you would rather use a different copy — a cleaner transcription, or one that
restores the Appendix — **Settings → Book text → Choose text file**. Your notes
survive: each one stores the opening words of the paragraph it was written
against and re-attaches itself to the right passage. Anything that can no longer
be found is flagged rather than silently moved.

To rebuild the bundled copy instead:

```bash
python3 tools/epub-to-text.py yourbook.epub -o data/alcoholics-anonymous-1939.txt
node tools/build-book.js data/alcoholics-anonymous-1939.txt
```

`build-book.js` reports whether every word of the source survived the parse:

```
sections:  43
words:     106,067 of 106,067 body words in the source  (exact — nothing dropped)
```

### What the importer expects

Plain text with headings on their own line. A `#` prefix marks a heading
unambiguously, which is what `epub-to-text.py` emits:

```
# CHAPTER 5

# HOW IT WORKS

Rarely have we seen a person fail...
```

Without `#` markers the parser falls back to guessing from capitalisation. That
works for most public-domain transcriptions but is imperfect — this book sets
whole lines of prose in capitals, and those must stay prose.

The parser rejoins hard-wrapped lines into paragraphs, drops bare page numbers
and running heads (only in unmarked text, where such furniture actually occurs),
and recognises the eleven chapters, the Foreword and the Doctor's Opinion by
name so their internal ids stay stable across re-imports.

## Backing up and moving to a new phone

**On the old phone:** Settings → Backup → **Create backup**. On iOS this opens
the share sheet — save it to Files, iCloud Drive, or mail it to yourself.

**On the new phone:** install the app, then Settings → Restore → **Choose backup
file**.

- *Keep both, newest wins* — merges with whatever is already there, per note.
- *Replace everything on this device* — wipes first. Use this on a fresh install.

Leave *Include the book text* unticked for a small file (the app already ships
with the text); tick it if you are carrying a copy you imported yourself.

The backup is plain JSON, readable without this app:

```json
{
  "app": "AMS Big 12S",
  "schema": 1,
  "exportedAt": "2026-08-26T09:14:00.000Z",
  "includesBookText": false,
  "position": { "sectionId": "ch05", "paraIndex": 12, "ratio": 0.41 },
  "notes": [ { "id": "note-…", "sectionId": "ch05", "paraIndex": 12,
               "anchor": "Rarely have we seen a person fail…",
               "body": "Read this again on a hard day.",
               "tag": "sponsor", "discussedAt": null },
             { "id": "note-…", "sectionId": null, "paraIndex": null, "anchor": "",
               "body": "Ask how much detail step four really needs.",
               "tag": "sponsor", "discussedAt": "2026-08-24T18:30:00.000Z" } ],
  "bookmarks": [ … ],
  "settings": { … }
}
```

## Development

No build step and no dependencies — plain HTML, CSS and JavaScript.

```bash
python3 -m http.server 7801
# then open http://127.0.0.1:7801/
```

```
├── index.html          App shell: every screen and sheet
├── manifest.json       PWA metadata (relative scope, so any path works)
├── sw.js               Service worker (offline shell cache)
├── css/style.css       Themes, layout, reader typography
├── js/
│   ├── parser.js       Plain text → sections (shared with tools/build-book.js)
│   ├── db.js           IndexedDB wrapper
│   ├── store.js        Book, settings, position, notes, bookmarks, search
│   ├── backup.js       Export / restore
│   ├── ui.js           Screens, rendering, event wiring
│   └── app.js          Bootstrap
├── data/
│   ├── book.json                      The parsed book the app reads
│   └── alcoholics-anonymous-1939.txt  The source text it was built from
└── tools/
    ├── epub-to-text.py EPUB → plain text, skipping publisher matter
    ├── build-book.js   Plain text → data/book.json
    └── make-icons.py   Regenerate the icon set
```

### Where your data lives

| What | Where |
|---|---|
| Notes, bookmarks, any text you import | IndexedDB (`ams-big-12s`) |
| Settings, reading position | IndexedDB, mirrored to `localStorage` for a fast first paint |
| App shell and bundled text | Cache Storage, via the service worker |

Nothing leaves the device. Clearing the browser's site data for this app erases
it all — which is what backups are for.

## Privacy

No account, no analytics, no network calls after the app has loaded. Your notes
are yours and stay on your phone.

## Disclaimer

Not affiliated with, endorsed by, or connected to Alcoholics Anonymous World
Services, Inc. "Alcoholics Anonymous" is a registered trademark of A.A.W.S.,
Inc., referred to here only to describe which text this reader is built for.
This app is called AMS Big 12S and uses no A.A.W.S. mark in its own name.

## License

The app code is available for personal and non-commercial use. The 1939 text it
ships with is in the public domain in the United States; its status elsewhere is
yours to check.
