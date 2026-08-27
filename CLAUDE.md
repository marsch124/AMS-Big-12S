# AMS Big 12S

An offline-first PWA for reading *Alcoholics Anonymous* (1939 first edition),
taking notes, keeping the points to raise with a sponsor or a sponsee, and
resuming where the reader stopped. Built for Martin's iPhone; a sibling to his
`AMS-Instructions` app.

- **Repo:** `marsch124/AMS-Big-12S` (public), default branch `main`
- **Live:** https://marsch124.github.io/AMS-Big-12S/ — GitHub Pages, deploy from
  `main` / root. It is **on**; pushing to `main` republishes automatically.
- **Publishing is not a question to put to Martin.** Finish the work, run the
  smoke test, and if it is green, merge to `main` and tell him it is live and
  what changed. He gave standing permission on 2026-08-27 and does not want the
  branch-and-merge step in front of him: he cannot read a diff on a phone, and
  the suite is the real gate. Only hold a change back if he asked for that piece
  of work to be held. A bad release is reverted, not prevented by asking.
- **Current version:** 2.19 (`APP_VERSION` in `js/app.js` *and* `sw.js`)

## Where this is up to

The twelve-step section was built in phases, all of them now done. The design
plan — the anatomy of a step page and what each step's own work needs, kept up
to date with what was actually built — is at
https://claude.ai/code/artifact/b467fb04-03e9-4f26-aa77-7f8f18b8c433

| | | |
|---|---|---|
| Phase 1 | done | `steps.source.json` format, `build-steps.js`, step 1 written |
| Phase 2 | done | Steps tab, list of twelve, step page: wording, explanation, references, questions |
| Phase 3 | done | Dated notes per step, folded when long |
| Phase 4 | done | Answerable questions keeping every earlier answer; hide, add your own |
| Phase 5 | **done** | Writing the twelve. **All twelve are written. 85 references resolve, none ambiguous. No stubs remain.** |
| Phase 6 | **done** | Each step's own work. **All ten kinds built; all twelve steps show a work section.** |
| Phase 7 | **done** | Honest progress on the list, copying a step out, docs, **v2.0** |

**The twelve-step section is finished.** Nothing from the plan is outstanding.
Work on it now is new work, not a phase.

**Audited 2026-08-27 against the running app, not from memory.** Every step page
was opened in a browser and checked. All twelve show their own work, every
declared `work.kind` has a branch in `renderStepWork()`, and the dispatcher still
hides the section for a kind it does not know — a smoke check proves that
directly by handing it a bogus kind, rather than by pointing at an unbuilt step
as it used to. Keep that check: it is the only thing standing behind the
hide-when-unbuilt behaviour.

**The steps list counts three things, and `Store.stepProgress()` is the only
place that decides.** It counted notes alone until 2.0, so answering eight
questions and filling in an inventory left the row reading as untouched — the
app telling the reader they had not done something they had. Notes, answers and
work rows count together; anything showing progress must go through
`stepProgress()` rather than counting one of them again by hand.

**Each work kind names its own rows** — `work.count` in `steps.source.json`,
`{one, many}` — because "3 entries" is true of all ten kinds and so says
nothing. `build-steps.js` **refuses to build** a work block without one: a name
that exists in a single place is a name that gets forgotten. `Store.workCount()`
counts a step's own rows, except where the step annotates another's (step 9),
where it counts the rows it has written on — otherwise step 9 would read as
finished the moment step 8 had names in it.

**Copying a step out is composed in `store.js`, never scraped from the page.**
`Store.stepAsText(step, opts)` walks the questions, notes and rows directly,
because the page folds things away and shows the last five of a log — right for
reading, wrong for a copy someone will rely on. The reader ticks what goes and
sees the whole text before anything is copied. This is the only route by which
what has been written can leave the phone, so nothing may be added to that text
that the reader has not been shown.

**A field marked `"private": true` in the source never leaves without being
asked for by name.** Step five's `heldBack` is the one. The toggle carries the
field's own words, and resets to off on every open. If another private field is
ever added, the flag is the mechanism — do not rely on a default staying put.

**Step six does not annotate step four's rows**, unlike step nine on step
eight's. The same defect appears in several rows and deserves one answer, so
`Store.carriedDefects()` groups identical entries case-insensitively and step six
keeps rows of its own, created lazily on first touch. Cell values are carried
whole and never split on punctuation — guessing where to cut "selfish,
frightened" would put words in the reader's mouth. Its `work.from` names
`columns` rather than a `work`, so the build's field-id collision check skips it,
which is right: it writes nothing into step four.

**`openInvSheet()` is the one row editor for every table-shaped module.** A spec
may name its inputs `columns` (step four) or `fields` (step five), and may set
`dated: true` to get a date of its own — a sitting happened on a day, and that
day is not the day it was typed up. Extend it rather than writing a second
editor.

**`build-steps.js` resolves `work.prayerRef` too**, as of 1.18. Work modules can
point into the book, and until then only `text` and `references` were validated —
a typo in a work passage would have failed silently at run time instead of at
build time.

**The ten kinds of work, and which steps use them:** `two-lists` (1, 2),
`prayer` (3, 7), `inventory-tables` (4), `sittings` (5), `carried-defects` (6),
`amends-list` (8), `amends-progress` (9), `daily-entries` (10), `daily-practice`
(11), `people-worked-with` (12). Each is a branch in `renderStepWork()` in
`ui.js`. If an eleventh is ever needed, step 4's build is the pattern to copy:
rows in their own IndexedDB store, carried explicitly by `backup.js`, an empty
row refused, a `count` naming its rows, and a smoke test covering the backup
round trip *both* ways — including that a backup written before the kind existed
does not wipe what is on the device.

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

## The home screen (2.1)

**The app opens on `#screen-home`; the contents is `#screen-library`, on the Read
tab.** Martin asked for a front page: "the app has evolved, and it's not just
about reading". Six tabs now, and the tab labels are a shade smaller for it.
Anything that wants the table of contents — a test, a link, a back button — has
to ask for `library`, not `home`.

**A passage a day, and it is never written from memory.** `data/daily.source.json`
is a hand-picked list of quotes and nothing else. `tools/build-daily.js` finds
each one in `book.json`, **refuses to build** on a quote that matches nothing or
matches twice, and writes the *book's* characters into `daily.json` by mapping
the flattened match back to the original — so what ships is the book's own text
even if a curly quote was typed straight. It also refuses a quote that starts or
ends mid-sentence, which is always a slip rather than a choice. Same bar as
`build-steps.js`, for the same reason: people quote this book precisely. 94
passages, so one repeats about every three months.

**The passage is picked by the local day, not at random.** `Store.passageForDay()`
indexes on `dayNumber()`, which is `Date.UTC(y, m, d) / 86400000` — whole days
off the reader's calendar date, so a clock going back an hour in October cannot
hand back yesterday's passage. The same day gives the same passage all day, which
is the point: a passage you can carry around is worth more than a fresh one every
time the app opens. The paragraph is re-resolved at runtime through
`resolveStepRef()`, so the link still lands on the right words in an imported
copy, and the card says the passage is missing rather than opening a guess.

**`renderContinueCard(prefix)` draws one card into two screens.** Home passes
`home-continue`, the contents passes `continue`. There is deliberately no second
copy of that logic — the second copy is the one that falls behind.

**The streak belongs to `Store.stepStreak()`, and `dayISO`/`shiftDay` live in the
store.** The home screen and the step page were both counting days; two
implementations of "what day is it" would eventually disagree. `ui.js` keeps thin
wrappers that call through.

**No shortcut tile is a placeholder any more.** All of them — *I have cravings*
(2.2), *I'm going to a meeting* (2.3) and *I want to say something to someone*
(2.19) — were built. Seven tiles now. The machinery is still there:
a tile whose name `runShortcut()` does not know falls through to "Not built yet
— this one is a place held open", and `is-soon` dashes its border. Use that for
the next tile added ahead of what it does, and never wire a new tile to
something approximate instead of asking Martin what it should do.

## The craving screen (2.2)

**The record is the feature.** `#screen-craving` shows a passage and three
things to do, but the reason it exists is the list at the bottom: in the middle
of a craving it is not obvious that it will end, and the only convincing
argument that it will is the run of ones that did. So a row is written when it
*starts*, closable in one tap, and the summary leads with the count and the
longest. Do not turn this into a mood tracker or a scoring system — no streaks
of "clean days", no congratulation.

**`outcome: 'drank'` is not an oversight.** A list that can only record
victories is not a record, and step ten asks for the other kind too. The summary
says "every one of them passed" only while that is true, and switches to "n of m
passed" the moment it is not. Never quietly hide or exclude a drank row.

**Cravings have a store of their own (`DB_VERSION` 3).** Structured records, so
they follow step four's pattern rather than being bent into a note: their own
IndexedDB store guarded by `objectStoreNames.contains`, carried explicitly by
`backup.js` in both directions, and a smoke check that a backup written *before*
the store existed restores without emptying it. They are deliberately **not** in
the inventory store — they belong to no step, and `rowsForWork()` /
`workCount()` filter by `stepId`.

**At most one craving is open.** `Store.startCraving()` hands back the open one
rather than writing a second; `Store.openCraving()` takes the newest unclosed row
if two ever exist (two tabs, a restore).

**The sponsor's number lives in settings**, as `sponsorName` / `sponsorPhone`,
because it is one person and one number and settings already ride the backup. It
is used for exactly one thing — the `tel:` link on this screen — and the button
offers to take you to Settings when it is empty rather than doing nothing.
Non-dialling characters are stripped for the href only; the row shows the number
as it was typed.

**`tickOnTheMinute(paint)` is shared** by the home clock and the "so far" line
here. One timer, one painter at a time, stopped by `showScreen` for every screen
that does not keep time.

**The craving passages are a second verified list in the same file.**
`daily.source.json` carries `passages` and `craving`; `build-daily.js` verifies
both with the same unforgiving rules and dedupes *within* a list only — a quote
may legitimately serve both, since the book only says a thing once. The craving
set is picked at random rather than by the day (never the same one twice
running), because it is not read once a day at a set time.

**The clock ticks on the minute and only while home is on screen.** `startClock()`
waits out the remainder of the current minute and then goes hourly-honest at
60000ms; `showScreen` stops it for every other screen, and `visibilitychange`
re-renders the whole home screen on return — a phone left open overnight would
otherwise wake showing yesterday's date and yesterday's passage.

**Each count is of exactly what its own screen shows** — the same rule the Notes
chips follow. "Notes written" is `state.notes.length` because that is what the
Notes tab's All list contains, answers included. "Steps worked on" goes through
`Store.stepProgress()`, never a hand count.

**Settled already — do not re-ask.** Publishing: green suite, then merge and say
so. Sponsor (not "spindrift", a transcription
slip). Chapter-and-passage references, no page numbers: the Dover pagination does
not match the edition people quote. Explanations in my voice, editable by him.
Step 4 gets full tables, not free text. Step work rides the normal backup, with a
plain warning at the moment of export. **No lock and no encryption** — asked and
declined explicitly.

## The rules, and adjusting your place (2.8)

**Two lists of rules, in Settings** (2.9): `sponsorRules` and `sponseeRules`,
arrays of strings, driven by the `RULE_LISTS` map — add a third list by
extending that map and the markup, not by branching. Edited as text, one to a
line, because a handful of short lines does not need a row editor and a textarea
is faster on a phone. Blank lines are dropped on save; an empty list is a choice
and is kept, so clearing one does not bring the defaults back.

**`richText()` escapes first and formats second, and that order is the whole
safety of it** (2.11). Nothing typed can become a tag, because the only `<` in
the output is one the function put there. Martin asked for "rich text"; what he
got is `**bold**` and `*italics*` rendered in the list, edited in the same plain
box. A contenteditable editor with a toolbar was the other reading — a great
deal of fragile machinery on a phone to make one word heavier. If he asks again
for a toolbar, he has heard the argument and it is his call. Applied only to the
rules so far; notes and the rest are still plain text.

**They were on the home screen in 2.8 and Martin moved them to Settings** — "I
can remember them after a couple of days". Do not put them back on the home
screen without being asked. `loadSettings()` migrates the old single `rules`
key onto the sponsor list; leave that migration in place, it costs nothing and
an install that skipped 2.9 would otherwise lose what was written.

**A jump to one passage passes `justLooking: true` (2.12).** Today's passage, a
step reference, a step's prayer passage, the passage behind a note, a search
hit — all of them set `looking`, which `recordPosition()` guards on exactly as
it guards on `browsing`. Reading today's passage used to drag *Continue reading*
onto it, percentage and all, which was the bug Martin reported. Every one of
those call sites also passes `highlight: true`; that correspondence is not the
mechanism and must not be relied on — a new jump to a passage needs the flag
written out. Opening a whole chapter (contents, prev/next, the craving screen's
chapter row) is reading, and counts.

`looking` clears in `showScreen()` when you leave the reader, *after*
`flushPosition()` has been called and refused — order matters there. `browsing`,
set by hand, outlasts it.

**Browsing is guarded in one place (2.10).** `recordPosition()` is the only
route by which a reading position is ever written — opening a chapter, the
debounced scroll, leaving the reader, `pagehide` — so the `browsing` flag is
checked there and nowhere else. Any new save path must go through it too, or
browsing will leave a trail through the new door.

**Browsing is in memory only, on purpose.** It dies when the app is next
started, because a mode that quietly persisted for a fortnight would lose weeks
of position tracking without anyone noticing. It is also never invisible: the
reader carries the `#browsing` strip the whole time it is on, and turning it off
from inside the reader records where you have actually got to, since that is
what "keep it again" means standing on a page.

**The continue card is a card with a button in it.** `.continue-card` is a div
holding `.continue-main` (the whole face, which resumes) and `.continue-adjust`
(the corner control, which opens the sheet). A button inside a button is invalid
HTML, which is why it is shaped this way — do not collapse it back.

**`Store.clearPosition()` clears the localStorage mirror too.** Removing only the
IndexedDB record would let `loadPosition()` find the mirror at the next boot and
put the card straight back.

## Saying something to them (2.19)

**The app sends nothing, and the record says so.** A message leaves by a `sms:`
link, `navigator.share`, or the clipboard, and `how` records which of the three.
The app never learns whether it arrived, so the list says *By text* / *Shared* /
*Copied* and the heading is "What you have sent" rather than any claim of
delivery. Do not "improve" this into a delivery status — there is nothing behind
it to be true.

**There is deliberately no Web Speech API and no microphone button.** Martin
asked to *dictate* a message; the answer is a box the phone's own keyboard
dictation is good at, not `webkitSpeechRecognition`. That API ships audio to
Apple's or Google's servers, which would break the promise made in `db.js`'s own
header, in the About panel and in the README — nothing leaves the device unless
the reader sends it — and it is unreliable in an installed PWA on iOS besides.
The keyboard's dictation is largely on-device and is what he already uses (step
four's card view is "the view you dictate into"). If he asks again for a record
button, he has heard the argument and it is his call.

**The draft is in `localStorage`, not IndexedDB, and that is the point.**
`MESSAGE_DRAFT_KEY` is written synchronously, so it survives iOS killing a
backgrounded PWA — which is exactly when a half-written message is lost. The
reading position keeps its mirror there for the same reason. It is written on a
400 ms debounce, on `visibilitychange`, on `pagehide` and on leaving the screen.
It is deliberately **not** in the backup: a record moves to a new phone, a
half-finished sentence does not, and a smoke check holds that.

**A record is written only when the message actually leaves.** An empty box
writes nothing, and a draft is never in the list — the same rule
`checkinIsEmpty()` follows for an untouched day. `saveMessage()` rejects an empty
text rather than storing one.

**`messages` is a store of its own (`DB_VERSION` 7)** — the sixth to follow the
pattern: guarded upgrade, carried by `backup.js` both ways, and a check that a
backup written before the store existed restores without emptying it. Not bent
into the note store, and the reason is not just shape: a note tagged `sponsor` is
something *still waiting to be said*, and one of these has been said already.

**Who you can write to is derived, not configured.** `Store.messagePeople()`
reads the same `sponsor`/`sponsee`/`spouse` name and phone pairs from settings
that `RING_PEOPLE` rings, in the same order and for the same reasons, and filters
to those with a name or a number. A name alone is enough — the share sheet does
not need a number, only a text message does, and the screen says so with a row
that goes to Settings rather than a button that cannot work. Add a fourth role by
extending `MESSAGE_PEOPLE` and `RING_PEOPLE`, not by branching.

**`updateMessageSendState()` runs on every keystroke; `renderMessageSend()` does
not.** The word count and the `sms:` href follow the box, but rebuilding the rows
under the reader's finger would be both wasteful and rude. Only a change of
person rebuilds them.

**The openers are openers, not messages.** Four of them, in `store.js` as
`MESSAGE_OPENERS` alongside `CHECKIN_SPECS`, because the hardest sentence is the
first one. They append to the box to be edited, and never replace what is there.
Changing who the message is for keeps the words too — a smoke check holds both.

## The craving log and the three days (2.18)

**The offer is made once, and it takes a no.** Saving a craving as having ended
in a drink opens `#drank-sheet`. "Not now" closes it and nothing more is said.
What stays is `#craving-offer`, a quiet row on the craving screen, and only for
three days — the length of the thing being offered. After that it goes on its
own rather than sitting there as a reproach.

**Nothing about it reaches the home screen.** The app noticing is one thing; the
app bringing it up every morning is another. `broken-note` keeps its two states
(open, or resting) and knows nothing about the craving log. If that ever changes,
change it deliberately.

**A break remembers its entry, and that memory is the off switch.**
`breaks.cravingId` is the link. `Store.cravingNeedingPlan()` returns the most
recent drank entry only when no break is open, none is linked to it, and it is
within three days — so `breakForCraving()` is what stops the offer coming back,
not a dismissed flag. Declining leaves no record at all, which is the point.

**`offerThreeDays(saved)` checks the entry is the one just written**
(`wanted.id !== craving.id` bails). Editing a drank entry from months ago must
not reopen the offer.

**The date is carried over, not asked twice** — `openBounceSheet(craving)`
prefills from the entry's day and says where it came from. It is still an input
he can change, and the `soberSince` question is untouched: see below.

**`cravingId` rides the backup like any other field**, and `breakAsText` can put
what was written at the time under "What led to it" — the only part of that text
written before the event rather than after it. It is an option, off-able, like
everything else in a copy sheet.

**`.do-row` sets `display: flex`, which beats the browser's own `[hidden]`.**
Any row that is hidden some of the time needs an explicit `[hidden]` rule; the
file already does this for `.passage-card`, `.continue-card`, `.tabbar` and the
rest. `.do-row[hidden]` was added in 2.18 after a smoke check found the offer row
permanently on screen.

## Starting again (2.17)

**Nothing on that page scolds.** Somebody opening it has already had the worst
of it, and a page that tutted at them would be shut and not opened again. No
"you were doing so well", no lost-streak language, no red. The home row is quiet
and full width rather than one of the tiles: findable at the worst moment,
not shouted every morning.

**`BOUNCE_PLAN` is Martin's to rewrite.** It is written in his register, it is
explicitly not A.A. material, and the one line in it that is not a suggestion is
the doctor on day one — coming off drink can be dangerous and an app is not the
thing that helps with that. Keep that line first, and keep it a fact rather than
a warning. If he asks for the plan to be editable in the app, that is the rules
pattern (`settings`, a textarea, one to a line).

**It asks rather than assumes.** The date (by the time anybody opens this it may
be yesterday) and whether to reset `soberSince` (his count, not the app's). Never
reset the day counter silently — a smoke check holds that.

**Day one is the day it happened**, counted inclusively like `daysAbstinent()`.
Past three days it keeps counting and the page says so rather than pretending the
plan is still running. A break stays open until closed by hand, because a fourth
day that needs the page still has it.

**The bounce screen borrows `.checkin-field` and `.checkin-label`**, so any test
querying those must scope to `#checkin-fields`. That caught the suite out once.

## Copying things out (2.16)

**`openCopySheet(config)` is the one sheet** for everything but a step: a title,
a list of `{key, label, on}` toggles, a `compose(opts)` that returns the text,
and an optional `note()` for the line under the preview. The check-in page and
the meeting page both go through it. A step keeps `#share-sheet`, which does
more (private fields, per-part options, its own title).

**Every composer lives in `store.js`** — `stepAsText`, `checkinAsText`,
`meetingsAsText`, `copyTalkList`'s list. Never scrape the screen: the page folds
things away, shows the last twelve of a log, and is arranged for filling in
rather than for reading.

**`meetingSummaryLine()` and `meetingDayText()` moved to the store in 2.16** so
the screen and the copy cannot come to different conclusions about the same
list. The prose is shared; only the layout differs.

## Before we talk (2.14)

**The questions are Martin's own, and they are asymmetric on purpose.** The
sponsor list is about him; the sponsee list is the same ground asked about
someone else, with a third answer — *Don't know* — on the abstinence question,
because you often do not. Both close with *Notes from the meeting*. Do not
"tidy" the two lists into one shared set: the asymmetry is the point.

**The questions live in `store.js` as `CHECKIN_SPECS`** (moved there in 2.15), not
in `ui.js`, because `Store.checkinAsText()` composes the copy from them and that
composer must not scrape the page — the same rule as `stepAsText()`, for the same
reason: the page is arranged for filling in, a copy is arranged for reading. What
is unanswered is counted and stated at the end rather than left as a silence.
`ui.js` reads the spec through `Store.checkinSpec(who)`.

**One record per person per day**, found by the day rather than created afresh —
coming back in the evening adds to the morning's answers instead of starting a
second copy. `Store.saveCheckin(who, on, patch)` merges: only what is passed
changes.

**No Save button, on purpose.** Fields save on `change`, which fires when the
field is left. A form filled in five minutes before a phone call must not be
losable by putting the phone down. `checkinIsEmpty()` keeps untouched days out
of the history rather than out of the store.

**`checkins` is a store of its own (`DB_VERSION` 5)** — the fifth to follow the
same pattern: guarded upgrade, carried by `backup.js` both ways, and a check
that an older backup does not empty it.

## Days running (2.13)

**It counts days the app was opened, not days a step was worked.** Martin asked
for that explicitly — "more or less, that I've opened the app". The step ten and
eleven runs still exist on their own step pages via `Store.stepStreak()`; the
home tile no longer uses them, and `dailyRun()` was removed rather than left
lying about.

**`meta.visits` is a plain list of local dates**, not a running total, so a run,
a best run or a month's tally can all be worked out later without having had the
foresight to count them at the time. `recordVisit()` runs last in `Store.init()`
— it seeds a first list from every dated thing on the device, and that seeding
reads notes, bookmarks, inventory, cravings, meetings and the position, so they
all have to be loaded before it. It also runs on `visibilitychange`, for a phone
left open across midnight.

**Two different questions, and they can disagree.** "Nothing read or written for
9 days" is about *doing*; days running is about *showing up*. Opening the app
counts for one and deliberately not for the other. That is not an inconsistency
— do not "fix" it by making them agree.

**Backups union the days on merge.** A day either happened or it did not, and two
devices can each know days the other does not.

## Whether you have been here (2.7)

**Only reading and writing count as activity.** `Store.lastActivity()` takes the
newest timestamp across position, notes, bookmarks, inventory, cravings and
meetings. Opening the app is deliberately not activity — the question the line
answers is whether the practice is still happening, and standing in the doorway
is not the practice. A smoke check holds that line.

**That line is coloured; the day count is not.** Grey to one day, `--accent` to
six, `--danger` at seven and beyond. The abstinence count above it stays plain
whatever it says: a low number there is not a warning, and an app that turns
somebody's third day red is scolding them. Martin raised colour-coding the day
count and this is the answer given — if he asks again, he has heard the argument
and it is his call.

**Three numbers, one panel.** `sponsorName`/`sponsorPhone`,
`sponsee…`, `spouse…` in settings, rendered by a loop over
`['sponsor','sponsee','spouse']` in both directions — add a fourth role by
extending that list and `RING_PEOPLE`, not by writing more branches. The craving
screen builds one row per person who has a number, sponsor first; with none set
it shows a single row that goes to `#settings-people`.

## The day count (2.6)

**Counted inclusively, and that is deliberate.** `Store.daysAbstinent()` returns
`dayNumber(today) - dayNumber(first) + 1`, so the day it is set reads *1 day*.
Day nought is not a thing anybody says, and day one is the one worth counting
most. A future date returns 0 rather than a negative number.

**No date, no counter.** The row turns into a dashed invitation rather than
showing a nought — the same reasoning as the placeholder tiles. Never show a
zero day count on the home screen.

**It lives in settings** (`soberSince`, a `YYYY-MM-DD` string), so it rides the
backup with everything else. There is deliberately no history of previous counts
and no "reset" button: resetting is editing the date, and what a relapse looks
like in this app is a craving recorded with `outcome: 'drank'`. If a history of
runs is ever wanted, that is a new feature — ask first.

## Times (2.5)

**Twenty-four hours everywhere, and `clockTime()` is the only place that
decides.** Built by hand rather than by `toLocaleTimeString`: with `hour12`
off, some locales still render midnight as "24:00", and the point of this is
that there is no a.m. or p.m. anywhere in the app. `formatDate()` and
`timeOfDay()` both go through it.

**The Settings tab carries the running version** (`#tab-version`, filled from
`APP_VERSION` in `bind()`, not from the markup). 8px, `--text-dim`, and
absolutely positioned so it cannot push the icon or the label about — and not
the accent colour, so it stays quiet when that tab is lit.

## The meeting screen (2.3)

**A note can now be waiting for a meeting.** `tag` takes `''`, `'sponsor'`,
`'sponsee'` and now `'meeting'` — the third is an ordinary tag, so
`waitingFor()`, the chips, `copyTalkList()` and the pills all work by the same
route. `copyTalkList(notes, tag)` takes the tag explicitly now rather than
reading `notesFilter`, because the meeting screen copies the list without any
filter being lit.

**`noteCard()` is used on two screens.** The meeting screen shows the same card
as the Notes tab, so a point can be ticked off where you are standing. That is
why its "talked about" handler re-renders the meeting screen as well —
`refreshAfterNoteChange()` does the same. Do not fork a second, smaller card:
one card to keep right.

**Meetings have a store of their own (`DB_VERSION` 4)**, following cravings and
step four: guarded upgrade, carried explicitly by `backup.js` both ways, and a
smoke check that an older backup restores without emptying it.

**Dated by the day, not the minute.** A meeting happened on a Tuesday; writing it
up on Wednesday morning does not make it Wednesday's. Same reasoning as step
five's `dated: true` sittings.

**`Store.usualPlaces()` is derived, not configured.** There is no schedule of
regular meetings to maintain — the chips in the sheet are the distinct `where`
values already recorded, newest first. That keeps the same meeting under the
same name, which is the only thing that makes the count mean anything. If a
real schedule (weekday, time, address) is ever wanted, that is a new feature and
a new store, not a widening of this one.

**The count is the point, and it is plain.** How many in all, how many in the
last thirty days, how many you spoke at. No streaks, no targets, nothing about
90 in 90 — the app does not set anyone a quota.

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
js/db.js            IndexedDB wrapper (meta, book, notes, bookmarks, inventory,
                    cravings, meetings, checkins, breaks, messages)
js/store.js         Book, settings, position, notes, bookmarks, search
js/backup.js        Export / restore
js/ui.js            Screens, rendering, all event wiring
js/app.js           Bootstrap
data/book.json                      Parsed book the app reads (~577 KB)
data/alcoholics-anonymous-1939.txt  Source text book.json was built from
data/steps.source.json              Step material, written by hand
data/steps.json                     Built steps with references resolved
data/daily.source.json              Home-screen passages, chosen by hand
data/daily.json                     Those passages, verified against the book
tools/epub-to-text.py  EPUB → plain text, skipping publisher matter
tools/build-book.js    Plain text → data/book.json
tools/build-steps.js   steps.source.json → steps.json, resolving book references
tools/build-daily.js   daily.source.json → daily.json, verifying every quote
tools/smoke-test.js    382 end-to-end browser checks
tools/make-icons.py    Regenerate the PWA icon set
```

No build step, no framework, no dependencies. Plain ES5-ish JS in IIFEs
attaching globals (`DB`, `Store`, `Backup`, `UI`, `BookParser`).

## Running and testing

```bash
python3 -m http.server 7802 &
npm install playwright                    # once, not committed
node tools/smoke-test.js                  # 382 checks, expect 382/382
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

**`closeSheets()` closes every `.sheet`, not a list of ids.** It used to name
five of them, so the share sheet added in 2.0 stayed open behind whatever came
next — `openSheet()` calls `closeSheets()` first, and a sheet missing from that
list simply never closed. A new bottom sheet needs only the `sheet` class on it.

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

**A note's `tag` is who it is waiting for, and there are three.** `'sponsor'`,
`'sponsee'`, `'meeting'`, or `''` for nobody. Anything that switches on the tag
must handle all three — `TAG_SHORT`, `FILTER_LABELS`, `EMPTY_COPY`, the counts
in `renderNoteFilters()`, `renderNotesActions()` and the hint under the chips in
the note sheet. The first cut of the meeting tag missed the hint and it told the
reader to "leave both off" with three chips on screen.

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
