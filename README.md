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
- 🧭 **Starting again** — if abstinence breaks, the three days after it: what to do, somewhere
  to write, and the book to hand
- 🌊 **When a craving comes** — its own row at the top of the home screen, opening a page
  that leads with what to do: a breathing ring to follow, meeting it head on, thinking it
  through, the shower, your own list, the numbers to ring and the two prayers the book
  prints. Start a clock on one, close it when it goes, and keep the list of the ones that
  passed
- 👥 **Meetings** — what you meant to bring up, and the record of the ones you got to
- 📖 **Distraction-free reader** — serif or sans, four themes, adjustable size and spacing
- 🔖 **Remembers where you stopped** — down to the paragraph, restored on every launch, and
  adjustable: start the chapter again, forget where you are, or read somewhere without it
  counting
- 📋 **The rules as they stand** — two lists, what you keep and what you have asked of a
  sponsee, in Settings
- ✎ **Notes on any passage** — tap a paragraph, write a note; it stays attached to those words
- 🎙 **Say something to them** — speak a message to your sponsor, your sponsee or your
  spouse and send it as a text, through the share sheet, or on the clipboard; it saves as
  you go and keeps a record of what went out
- 🤝 **Before we talk** — a page a day for the sponsor conversation and the sponsee one:
  your own questions, what to raise, and notes from the meeting
- 🗣 **Things to bring up** — mark anything for your sponsor, a sponsee or a meeting, keep a
  running count of what is still waiting, tick it off afterwards, and copy the list out first
- 💭 **Notes of your own** — write down what did not come from a page at all
- ⚖️ **The twelve Traditions** — on the same tab as the Steps: what each asks of a group,
  the 1939 passages it grew out of, six questions apiece, and a log of where each one held
  or did not. Their wording is not bundled, and cannot be — see below
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
written, how many of the twelve steps you have worked on, and how many days in a
row you have opened the app — showing up, rather than any particular piece of
work. That last one was seeded from the days you already had something dated
against, so it did not start from one. Each is of exactly what its own screen shows, and a
morning with nothing written says so.

## When you have a craving

**I have a craving** is a row of its own at the top of the home screen, above
everything else on it. That position is deliberate: it is the one thing on that
page nobody should have to look for.

The screen it opens leads with **what to do**, and the book sits below that. The
book is the best thing on the page and it is still reading, and reading is not
what the first minute of one of these is for.

**Do this now** — five things, the body first because it answers quickest:

| | |
|---|---|
| **Breathe** | A ring to follow: four in, hold four, six out. The long end is the out breath, because that is the half that settles a body down. A soft tone on the turn of each breath, so you can follow it with your eyes shut — generated rather than bundled, so it works offline, and there is a switch if you would rather it were quiet. Stop it whenever. |
| **Meet it head on** | Do not argue with it. A few lines, opening where they stand. |
| **Think it through — what happens if** | Past the first one, to the morning after. |
| **Get in the shower** | Cold if you can stand it. |
| **Something else that works** | Your own list, kept in Settings under *What else helps* — seeded with tapping, a workout and meditation, and yours to change. |

**Or reach somebody** — whoever has a number against them in Settings, sponsor
first, plus saying something to them and writing down what is going on.

**Or say it out loud** — the two prayers the book prints, at step three and at
step seven. They open on this page rather than sending you into a chapter to
find them, and there is a way through to the page itself for afterwards. The
words are resolved at runtime from the steps that carry them, so they are the
book's and never a version of them.

Nothing on this page moves you to another screen. Navigation is the last thing
anybody wants in the middle of one, and a row that took you elsewhere would take
the rest of the list with it.

**I am having one now** starts a clock, and the list underneath is the reason the
screen exists at all: in the middle of a craving it is not obvious that it will
end, and the only convincing argument that it will is the run of ones that did.
Entries that ended in a drink are kept too — a list that can only record
victories is not a record.

## Reading somewhere without it counting

The three dots on **Continue reading** offer a third thing: *read without
keeping my place*. For an hour spent somewhere in the book that is not where you
are up to.

Nothing is written while it is on — not on opening a chapter, not as you scroll,
not on leaving. The card stays exactly where it was.

The same applies, without being asked for, to **going to a single passage**:
today's passage, a step's reference, the passage behind a note, a search hit.
Those are an extra reading in the middle of the day, not where you are up to, so
they leave your place alone — and say so while you are there. That look ends the
moment you leave the reader. Opening a whole chapter is reading, and counts. The reader says **Not
keeping your place** at the top the whole time, and one tap there goes back to
keeping it, from wherever you have actually got to. It also switches itself off
when the app is next started, so it cannot quietly stay on for a fortnight.

## The rules

**Settings → Rules** holds two lists: *with my sponsor* — what you have agreed to
keep — and *with my sponsee* — what you have asked of them. Two lists rather than
one, because they are two different conversations.

Each is edited as text, one rule to a line. Blank lines are dropped. An empty
list stays empty: nothing comes back on its own. The sponsor list starts with
four; delete them if they are not yours.

A little formatting is allowed where a word needs the weight: `**two stars**`
makes a phrase **bold**, `*one star*` or `_an underscore_` makes it *italic*.
Everything else is left exactly as typed — text is escaped before it is
formatted, so nothing that looks like a tag is ever run as one.

## Saying something to them

*I want to say something to someone* on the home screen — and a row beside the
numbers to ring on the craving screen, because ringing somebody is not always in
you and a message often is.

**One box, and it is meant to be talked into.** Tap in it, tap the microphone key
on the phone's keyboard, and say the thing out loud; it lands as text you can
change before anybody sees it. Your sponsor, sponsee and spouse sit along the
top — whoever has a name or a number in Settings, sponsor first. Changing your
mind about who it is for keeps what you have written.

**Somewhere to start** offers four openers. The hardest sentence in a message
like this is the first one, and at the moment you most need to send it that is
the sentence you cannot find. They go *in* the box, to be built on or deleted.

**It saves as you type**, not when you leave the field, so a message half worked
out at eleven at night is still there in the morning. The draft lives in the
phone's own storage rather than the database, because that write is synchronous
and survives iOS killing the app without warning — which is exactly the moment
one gets lost. It is deliberately **not** in the backup: a record moves to a new
phone, a half-finished sentence does not need to.

**Three ways out**, and the app takes none of them itself: as a **text** if you
have their number, through the **share sheet** to WhatsApp, Signal or mail, or
onto the **clipboard**. It hands the words to the phone and stands back.

**What you have sent** keeps the last ones — who to, when, and which way each
left. That last part is precise on purpose: the app never learns whether a
message arrived, so the record says *Copied*, *Shared* or *By text* rather than
claiming delivery. Tap one to read it whole, say the same thing again, or delete
it. The list rides the backup with everything else.

**There is no microphone button of ours, and that is a decision.** Dictation on
the phone's own keyboard is the phone's business and largely happens on the
device. A record button in this app would have meant sending your voice to
somebody's server, and nothing here leaves your phone unless you send it.

## Before we talk

*I'm meeting my sponsor* and *I'm meeting my sponsee* each open a page a day for
that conversation.

**The questions differ by who you are talking to**, because one is about you and
the other is about them. Yours: *Am I abstinent? What have I done for myself
today? What have I done for others today? Do I hide anything? How do I feel? Do
I have any questions?* His: the same asked of him, with **Don't know** allowed on
the abstinence question, because sometimes you do not.

**Notes from the meeting** closes both — what you want tomorrow is what was
actually said.

**Copy this page out**, at the foot of either page, turns the day into plain text
for a message before the call or after it. You see the whole thing before
anything is copied, the notes from the meeting can be left out with a tick, and
what you have not answered is counted and said at the end rather than left as a
silence. Nothing is sent by the app — it goes on the clipboard.

Everything saves as you leave a field. There is no Save button to forget when
the phone rings, and coming back in the evening adds to the morning's answers
rather than starting a second copy of them. What you have marked to bring up
sits on the same page, ready to copy out, and the days already written are
underneath.

## If abstinence breaks

A quiet row under the shortcuts opens **Starting again**: the three days after
it. Nothing on that page scolds — somebody opening it has already had the worst
of it.

Each of the three days has a handful of things to do, ticked off as you do them,
and somewhere to write. Day one leads with the doctor, which is the one line
there that is not advice but a fact: coming off drink can be dangerous, and an
app is not the thing that helps with that. The book is on the same page — *The
Doctor's Opinion*, *More About Alcoholism*, *How It Works*.

It asks rather than assumes: the date, because by the time anyone opens this it
may be yesterday, and whether to count your days again from then, because it is
your count and not the app's. You can copy the three days out for your sponsor,
showing what is done and what is not.

The instructions themselves are a suggestion, not A.A. material, and are meant
to be rewritten.

## Meetings

*I'm going to a meeting* opens two things: what you meant to say there, and the
record of the ones you got to.

**To bring up** is the list of notes marked for a meeting — a third thing a note
can be waiting for, alongside your sponsor and your sponsee. Mark one while you
are reading, or write one down on the spot, and copy the list out before you go.
Ticking one off works the same as anywhere else: it keeps its place with the date
on it, and goes back on the list if there turns out to be more to say.

**Copy these out**, at the foot of the page, turns where you have been into plain
text — the last thirty days or all of them, what was worth keeping from each,
and what is still waiting to be brought up if you tick it. The same
tick-what-goes, read-it-first sheet the conversation pages use.

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

## The Twelve Traditions

They share the **Steps** tab, behind a switch that remembers which twelve you
were working. A seventh tab would have squeezed six labels that had already been
made smaller once.

### Why the wording is not here

The Traditions were written in 1946, adopted in 1950, and first appeared in
*Alcoholics Anonymous* at the **second edition (1955)**. The standard commentary
is the **1952 _Twelve Steps and Twelve Traditions_**. Both belong to A.A. World
Services, and neither is the 1939 first edition this app carries — so their
wording is not bundled and must not be. `build-traditions.js` **refuses to
build** a tradition that carries a `text` field, so the decision cannot be
undone by accident later.

Searched, not assumed: the 1939 text contains no "singleness of purpose", no
"group conscience", no "common welfare", no "self-supporting" and no "outside
issues".

### What is here instead

The 1939 Foreword turns out to be the seed of half of them, in three paragraphs:

> We are not an organization in the conventional sense of the word. There are no
> fees nor dues whatsoever. The only requirement for membership is an honest
> desire to stop drinking. We are not allied with any particular faith, sect or
> denomination, nor do we oppose anyone.

That single paragraph is the ground under Traditions 3, 6, 7, 9 and 10. The
paragraph before it — "our alcoholic work is an avocation" — is Tradition 8, and
the one after it, on signing yourself a member rather than by name, is Tradition
11 in all but name.

So each page carries:

- **The sentence it starts from**, at the top, where a step page shows the step's
  own words. Tradition 7 opens on "There are no fees nor dues whatsoever";
  Tradition 3 on "The only requirement for membership is an honest desire to stop
  drinking" — the 1939 text, set in the book's own face, with the chapter it
  comes from one tap away. The note about the missing wording is still on every
  one of the twelve, as the caption underneath.
- **What it asks of a group**, in plain terms. Ours, in the same register as the
  step explanations, and not official A.A. material.
- **The rest of the 1939 passages behind it** — 33 in all, every one resolved
  against the bundled text at build time and again at runtime, so an imported
  copy keeps the links. The opening sentence is not counted twice: the list
  below says how many are left. Traditions 2 and 4 are thin, and those pages say
  so rather than reach.
- **Six questions**, ours, answerable as often as you like. Answering again
  keeps the earlier answer underneath, dated, exactly as on a step.
- **Notes**, dated and never overwritten.

Nothing on those pages is quoted from memory. `tools/build-traditions.js` finds
each opening sentence inside the paragraph it claims, refuses anything it cannot
find, finds twice, or that starts or ends mid-sentence, and ships the book's own
words rather than the ones typed into the source file.

### The log

**Where you have seen them** — where one of the twelve held, or did not. Both go
in: a log that could only record the Traditions working would not be a record of
anything, which is the same reason a craving that ended in a drink is kept. An
entry sits under the Tradition it belongs to and in the shared list, with the
day it happened rather than the day it was written up.

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
│   ├── traditions.source.json         The Traditions material, written by hand
│   ├── traditions.json                Built Traditions, with references resolved
│   ├── daily.source.json              The passages for the home screen, chosen by hand
│   └── daily.json                     Those passages, verified against the book
└── tools/
    ├── epub-to-text.py EPUB → plain text, skipping publisher matter
    ├── build-book.js   Plain text → data/book.json
    ├── build-steps.js  steps.source.json → steps.json, resolving book references
    ├── build-traditions.js  traditions.source.json → traditions.json, same bar
    ├── build-daily.js   daily.source.json → daily.json, verifying every quote
    ├── smoke-test.js   End-to-end browser checks
    └── make-icons.py   Regenerate the icon set
```

### Testing

```bash
python3 -m http.server 7802 &
npm install playwright        # once, not committed
node tools/smoke-test.js      # 503 checks
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
| Messages you have sent from the app | IndexedDB, in its own store, carried by the backup |
| The Traditions log | IndexedDB, in its own store, carried by the backup |
| Settings, reading position | IndexedDB, mirrored to `localStorage` for a fast first paint |
| An unsent message still in the box | `localStorage` only — a synchronous write survives the app being killed, and a draft is not a record to move to a new phone |
| App shell and bundled text | Cache Storage, via the service worker |

Nothing leaves the device. Clearing the browser's site data for this app erases
it all — which is what backups are for.

## Privacy

No account, no analytics, no network calls after the app has loaded. Your notes
are yours and stay on your phone.

## Disclaimer

Also in the app, under **Settings → Disclaimer**.

This app was built by one person for their own use, and is offered exactly as it
is. **No responsibility is taken for anything that follows from using it** — not
for anybody's recovery, not for the suggestions in it, and not for what it does
or fails to do.

**What is in it comes from two places, and neither of them is A.A.** The quoted
passages are from *Alcoholics Anonymous*, first edition, 1939, which is in the
public domain in the United States. Everything else — the explanations, the
questions, the things to do when a craving comes, the plan for the days after a
break — is one member's own experience of the programme, written down. It is not
official A.A. material, it has been approved by nobody, and it is meant to be
argued with rather than obeyed.

**Where the material would have to be copyrighted, it is left out rather than
reproduced.** The Twelve Traditions as they are worded, the 1952 *Twelve Steps
and Twelve Traditions*, and every edition of the book after the first belong to
A.A. World Services and are deliberately not here.

**Nothing here is medical advice.** Coming off drink can be dangerous, and an app
is not the thing that helps with that. If you are physically unwell, ring a
doctor first.

Not affiliated with, endorsed by, or connected to Alcoholics Anonymous World
Services, Inc. "Alcoholics Anonymous" is a registered trademark of A.A.W.S.,
Inc., referred to here only to describe which text this reader is built for.
This app is called AMS Big 12S and uses no A.A.W.S. mark in its own name.

## License

The app code is available for personal and non-commercial use. The 1939 text it
ships with is in the public domain in the United States; its status elsewhere is
yours to check.
