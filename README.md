# AMS Big 12S

A mobile-first PWA for reading *Alcoholics Anonymous* (the 1939 first edition)
offline, taking notes as you go, and picking up exactly where you stopped.

**Live:** https://marsch124.github.io/AMS-Big-12S/

The complete text ships with the app — install it and start reading, with or
without a signal.

## Features

- 🏠 **A home screen** — the day count, the time and the date, a passage from the book for
  today, where you stopped, the reasons you might have opened the app, and an honest count of
  what you have done
- 🌊 **A craving screen** — start a clock on one, close it when it goes, and keep the list of
  the ones that passed; your sponsor a tap away
- 👥 **Meetings** — what you meant to bring up, and the record of the ones you got to
- 📖 **Distraction-free reader** — serif or sans, four themes, adjustable size and spacing
- 🔖 **Remembers where you stopped** — down to the paragraph, restored on every launch, and
  adjustable: start the chapter again, or forget where you are altogether
- 📋 **The rules as they stand** — two lists, what you keep and what you have asked of a
  sponsee, in Settings
- ✎ **Notes on any passage** — tap a paragraph, write a note; it stays attached to those words
- 🗣 **Things to bring up** — mark anything for your sponsor, a sponsee or a meeting, keep a
  running count of what is still waiting, tick it off afterwards, and copy the list out first
- 💭 **Notes of your own** — write down what did not come from a page at all
- 🪜 **The twelve steps** — a page each: the passages of the book that describe them,
  questions to take to a sponsor that keep every earlier answer dated, dated notes on every
  pass, and the work that step actually asks for — inventory tables, an amends list two
  steps write into, a daily rhythm, a record of who you have sat with
- 📤 **A step you can take out** — copy any step to the clipboard for a sponsor, ticking
  what goes and seeing it in full before it leaves
- 🔍 **Full-text search** — jump straight from a phrase to the passage it lives in
- 💾 **One-file backup** — notes, bookmarks, position, settings and (optionally) the text
- 📡 **Fully offline** — everything lives on your device; no account, no server, no tracking

## Installing it on your phone

1. Open the live link above in **Safari** (iOS) or **Chrome** (Android).
2. iOS: **Share → Add to Home Screen**. Android: **Menu → Install app**.
3. Launch it from the home screen. It runs full-screen and works with no signal.

## The home screen

The app opens here rather than in the contents, because reading is not the only
reason anyone picks it up.

**Whether you have been here** sits just under the day count: how long since you
actually read or wrote something. Opening the app does not count — standing in
the doorway is not the practice. It stays grey for a day or two, takes the accent
colour after that, and goes red past a week. The day count itself is *not*
coloured, on purpose: a low number there is not a warning.

**The day count** sits at the top. Set the first day in **Settings → Counting
the days** and it counts inclusively, so the day you set it reads *1 day* —
which is how anybody says it. Leave the date empty and the counter is not there
at all; there is no nought on the home screen. Tapping it goes back to the date.

**Today's passage** is one passage from the book, the same one all day, changing
at midnight. Tap it to read it where it sits in the chapter. There are 94 of
them, so one comes round again about every three months.

They are chosen by hand and then **verified against the text before they ship**.
`tools/build-daily.js` finds each quote in `data/book.json`, refuses to build if
one matches nothing or matches in two places, and writes out the book's own
characters rather than the ones that were typed — so a slip in the typing becomes
a failed build rather than a misquotation on the front page. Nothing on that card
was written from memory.

```bash
node tools/build-daily.js          # data/daily.source.json → data/daily.json
node tools/build-daily.js --check  # validate only, write nothing
```

**What brings you here** is a handful of shortcuts written in the first person,
because that is how the reason arrives — not "notes" but *I want to write
something down*. Meeting your sponsor or your sponsee opens the list of points
still waiting for that conversation, with the count on the tile beforehand.
Every one of them goes somewhere. When a new tile is added ahead of what it
does, it says "Not built yet" when tapped rather than doing nothing quietly.

**Where you have got to** is four counts: how far through the book, what you have
written, how many of the twelve steps you have worked on, and how many days you
are running on a daily step. Each is of exactly what its own screen shows, and a
morning with nothing written says so.

## When you have a craving

*I have cravings* opens a screen with three things on it, in the order they tend
to be wanted.

**Something to do this minute.** Ring somebody — sponsor, sponsee or spouse.
Put their numbers in **Settings → People you can ring** and whoever has one is a
tap away; leave them all empty and the screen offers to take you there instead.
The sponsee is on that list on purpose: the book's own answer to a shaky evening
is to work with another alcoholic. The numbers are kept on the device like
everything else and are used for nothing but those buttons. Or write down what is
going on, which puts a note on the list for your sponsor. Or open *More About
Alcoholism*, which is the chapter on exactly this.

**Something from the book**, drawn from eleven passages chosen for this moment
and weighted towards what to do rather than what is wrong with you. Verified
word for word, the same as the daily passage.

**A record of this one.** One tap starts a clock, one tap closes it. That is the
part worth having: in the middle of a craving it is not obvious that it will
end, and the only convincing argument that it will is the list of the ones that
did — so the screen leads with how many there have been and how long the longest
ran.

The record can also say that you drank. A list that only holds victories is not
a record, and the count stops claiming every one passed the moment one did not.
Cravings ride the normal backup, like everything else.

## The rules

**Settings → Rules** holds two lists: *with my sponsor* — what you have agreed to
keep — and *with my sponsee* — what you have asked of them. Two lists rather than
one, because they are two different conversations.

Each is edited as text, one rule to a line. Blank lines are dropped. An empty
list stays empty: nothing comes back on its own. The sponsor list starts with
four; delete them if they are not yours.

## Meetings

*I'm going to a meeting* opens two things: what you meant to say there, and the
record of the ones you got to.

**To bring up** is the list of notes marked for a meeting — a third thing a note
can be waiting for, alongside your sponsor and your sponsee. Mark one while you
are reading, or write one down on the spot, and copy the list out before you go.
Ticking one off works the same as anywhere else: it keeps its place with the date
on it, and goes back on the list if there turns out to be more to say.

**Where you have been** is the day, which meeting, whether you spoke, and
anything worth keeping. It counts them — how many in all, how many in the last
thirty days, how many you spoke at — because nobody remembers in March how many
they got to in January. The meetings you already go to are offered as chips
rather than typed out again, which keeps the same meeting under the same name.

## Notes, and things to talk about

Tap any paragraph while reading and choose **Add note**. The note stays attached
to the words it was written against, not to a paragraph number, so it survives a
re-import of the text.

Not everything worth keeping comes off a page, though. **+** at the top of the
Notes tab writes a note with no passage behind it — a question that surfaced on
the drive home, something to raise with a sponsee, a reflection that is nobody
else's business.

Any note, from a page or not, can be marked **Bring this up with — my sponsor**,
**my sponsee** or **a meeting**:

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

## Working the steps

The **Steps** tab holds a page for each of the twelve. Every page carries the
step as the 1939 edition prints it, a plain explanation of what it asks, the
passages of the book that describe it — several, where the book makes its case
in more than one place — and questions to take to a sponsor.

Those questions are answerable, and **answering again keeps the earlier
answer**. The new one sits on top with its date; the old ones fold underneath.
A question you have no use for can be put away without touching what you wrote
against it, and you can add questions of your own.

**Notes on this step** are separate from the answers — a note each time you
read or work the step, newest first, long ones folded until you open them.

### The work of each step

Below that is the work that particular step asks for, and it differs by step
because the steps do:

| | |
|---|---|
| 1, 2 | Two lists kept side by side, with items that can move across — which is what step two is for |
| 3, 7 | The prayer as the book prints it, with a date kept every time it is taken |
| 4 | Three inventory tables — resentments, fears, conduct — fillable one card at a time or readable as a grid |
| 5 | A record that the telling happened, dated by the day it happened, with what was held back folded away |
| 6 | The defects step four named, carried through and asked about once each however many times they were written |
| 8 | The amends list, names carried over from step four's conduct pass |
| 9 | The same list, annotated — status, outcome and the date you chose. It never makes a second list |
| 10, 11 | A daily rhythm rather than a piece of work: the last fortnight at a glance, with a streak counted from yesterday so it is not a reprimand each morning |
| 12 | Who you have sat with and what came of it — recordable before you know how it went |

The list of twelve shows what has been done on each: questions answered, notes
written, how much of that step's own work is there, and the day it was last
worked. A step with nothing written says nothing rather than showing a row of
noughts.

### Taking a step out

**Copy this step out**, at the foot of any step page, turns what you have
written into plain text for a message or an email before a call. You tick what
goes — answers, notes, the step's work, and whether the earlier answers travel
with the latest — and the whole text is shown before anything is copied.

Step five's *what I held back* is left out unless it is ticked by name, and
starts unticked every time. The page folds it away; a copy button should not
quietly undo that.

Nothing is sent by the app. It goes on the clipboard, and where it goes after
that is your doing.

### Where the step material comes from

The explanations and questions were written for this app. They are **not
official A.A. material**, not from the 1952 *Twelve Steps and Twelve
Traditions*, and are meant to be disagreed with. Only the quoted step wording
and the linked passages come from the book.

Each link is stored as the opening words of the passage, exactly as a note is.
`tools/build-steps.js` resolves those against the text at build time and
**refuses to build** if one matches nothing or matches more than one paragraph;
the app resolves them again at runtime, so they survive importing a different
copy of the text.

```bash
node tools/build-steps.js          # data/steps.source.json → data/steps.json
node tools/build-steps.js --check  # validate only, write nothing
```

```
steps:      12 present, 12 written, 0 still stubs
references: 85 resolved, all unambiguous
questions:  96
```

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
  "meetings": [ { "id": "meet-…", "on": "2026-08-25", "where": "Tuesday, Kolpinghaus",
                  "shared": true, "what": "The fear goes before the willingness does." } ],
  "cravings": [ { "id": "crav-…", "startedAt": "2026-08-25T19:04:00.000Z",
                  "endedAt": "2026-08-25T19:16:00.000Z", "outcome": "passed",
                  "what": "Rowed with Anna about nothing." } ],
  "stepPrefs": { "hidden": { "s4-q3": true },
                 "custom": { "step01": [ { "id": "s1-own-…", "text": "…" } ] } },
  "inventory": [ { "id": "inv-…", "stepId": "step08", "tableId": "amends-list",
                   "values": { "who": "Anna", "harm": "…", "outcome": "…" },
                   "states": { "step08": "willing", "step09": "made" },
                   "on": "2026-08-16" } ],
  "settings": { … }
}
```

Everything written in the steps section rides the same backup: the answers and
step notes are notes like any other, `stepPrefs` carries the questions you put
away and the ones you added, and `inventory` carries every row of every step's
work. A backup written before a kind of work existed restores without wiping
what is on the device.

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
│   ├── store.js        Book, settings, position, notes, bookmarks, steps, search
│   ├── backup.js       Export / restore
│   ├── ui.js           Screens, rendering, event wiring
│   └── app.js          Bootstrap
├── data/
│   ├── book.json                      The parsed book the app reads
│   ├── alcoholics-anonymous-1939.txt  The source text it was built from
│   ├── steps.source.json              The step material, written by hand
│   ├── steps.json                     Built steps, with book references resolved
│   ├── daily.source.json              The passages for the home screen, chosen by hand
│   └── daily.json                     Those passages, verified against the book
└── tools/
    ├── epub-to-text.py EPUB → plain text, skipping publisher matter
    ├── build-book.js   Plain text → data/book.json
    ├── build-steps.js  steps.source.json → steps.json, resolving book references
    ├── build-daily.js   daily.source.json → daily.json, verifying every quote
    ├── smoke-test.js   End-to-end browser checks
    └── make-icons.py   Regenerate the icon set
```

### Testing

```bash
python3 -m http.server 7802 &
npm install playwright        # once, not committed
node tools/smoke-test.js      # 277 checks
```

It drives a real browser against the served copy and asserts the things that
matter: the bundled text is complete, notes and bookmarks persist, the reading
position survives a reload, every step's work saves and round-trips through a
backup, and the whole book is readable with the network switched off.
`CHROMIUM_PATH` points at a browser binary if Playwright cannot find one;
`SHOT_DIR` writes screenshots.

### Where your data lives

| What | Where |
|---|---|
| Notes, answers, bookmarks, any text you import | IndexedDB (`ams-big-12s`) |
| Every row of every step's work | IndexedDB, in its own store — structured records, not prose |
| Questions you put away or added | IndexedDB, carried explicitly by the backup |
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
