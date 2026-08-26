# AMS Big 12S

A mobile-first PWA for reading *Alcoholics Anonymous* (the 1939 first edition)
offline, taking notes as you go, and picking up exactly where you stopped.

**Live:** https://marsch124.github.io/AMS-Big-12S/

## Features

- 📖 **Distraction-free reader** — serif or sans, four themes, adjustable size and spacing
- 🔖 **Remembers where you stopped** — down to the paragraph, restored on every launch
- ✎ **Notes on any passage** — tap a paragraph, write a note; it stays attached to those words
- 🔍 **Full-text search** — jump straight from a phrase to the passage it lives in
- 💾 **One-file backup** — notes, bookmarks, position, settings and (optionally) the book text
- 📡 **Fully offline** — everything lives on your device; no account, no server, no tracking

## Installing it on your phone

1. Open the live link above in **Safari** (iOS) or **Chrome** (Android).
2. iOS: **Share → Add to Home Screen**. Android: **Menu → Install app**.
3. Launch it from the home screen. It runs full-screen and works with no signal.

## Loading the book text

The app ships with the table of contents but **no book text**, so you choose
which copy to load.

1. Get a plain-text (`.txt`) copy of the **first edition (1939)**.
2. In the app: **Settings → Book text → Choose text file** (or *Paste text*).
3. The importer splits the text on chapter headings and reports what it found.

### Which edition, and why it matters

The **1939 first edition** is in the public domain in the United States, which
is why it is the edition this app is built around. The **2nd, 3rd and 4th
editions are still under copyright** to A.A. World Services, Inc. — please do
not import or redistribute those without permission.

Copyright status varies by country. Check your own jurisdiction before
redistributing any copy.

### What the importer expects

Plain text with headings on their own line. Both of these work:

```
CHAPTER 5

HOW IT WORKS

Rarely have we seen a person fail...
```

```
THE DOCTOR'S OPINION

We of Alcoholics Anonymous believe...
```

The parser rejoins hard-wrapped lines into paragraphs, drops bare page numbers
and running heads, and recognises the eleven chapters, the foreword and the
doctor's opinion by name so their internal ids stay stable. Anything else it
finds — the personal stories, appendices — becomes its own section
automatically.

### Baking the text into the app instead

If you would rather a fresh install come with the text already loaded, and you
have the right to redistribute your copy:

```bash
node tools/build-book.js path/to/alcoholics-anonymous-1939.txt
```

That rewrites `data/book.json` using the same parser the in-app importer uses.
Commit and push, and every install picks it up.

## Backing up and moving to a new phone

**On the old phone:** Settings → Backup → **Create backup**. On iOS this opens
the share sheet — save it to Files, iCloud Drive, or mail it to yourself. Leave
*Include the book text* ticked and the backup is fully self-contained.

**On the new phone:** install the app, then Settings → Restore → **Choose backup
file**.

- *Keep both, newest wins* — merges with whatever is already there, per note.
- *Replace everything on this device* — wipes first. Use this on a fresh install.

The backup is plain JSON, so it stays readable even without this app:

```json
{
  "app": "AMS Big 12S",
  "schema": 1,
  "exportedAt": "2026-08-26T09:14:00.000Z",
  "includesBookText": true,
  "position": { "sectionId": "ch05", "paraIndex": 12, "ratio": 0.41 },
  "notes": [ { "id": "note-…", "sectionId": "ch05", "paraIndex": 12,
               "anchor": "Rarely have we seen a person fail…",
               "body": "Read this again on a hard day." } ],
  "bookmarks": [ … ],
  "settings": { … }
}
```

Notes store the opening of the paragraph they were written against, so if you
later import a differently formatted copy of the text they re-attach to the
right passage instead of drifting.

## Development

No build step and no dependencies — it is plain HTML, CSS and JavaScript.

```bash
python3 -m http.server 7801
# then open http://127.0.0.1:7801/
```

```
├── index.html          App shell: every screen and sheet
├── manifest.json       PWA metadata
├── sw.js               Service worker (offline shell cache)
├── css/style.css       Themes, layout, reader typography
├── js/
│   ├── parser.js       Plain text → sections (shared with tools/build-book.js)
│   ├── db.js           IndexedDB wrapper
│   ├── store.js        Book, settings, position, notes, bookmarks, search
│   ├── backup.js       Export / restore
│   ├── ui.js           Screens, rendering, event wiring
│   └── app.js          Bootstrap
├── data/book.json      Table of contents (and the text, if you bake it in)
└── tools/
    ├── build-book.js   Bake a text file into data/book.json
    └── make-icons.py   Regenerate the icon set
```

### Where your data lives

| What | Where |
|---|---|
| Notes, bookmarks, imported book text | IndexedDB (`ams-big-12s`) |
| Settings, reading position | IndexedDB, mirrored to `localStorage` for a fast first paint |
| App shell | Cache Storage, via the service worker |

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

The app code is available for personal and non-commercial use. Whatever book
text you import keeps its own copyright status — this repository does not grant
you any rights to it.
