#!/usr/bin/env node
/*
 * build-daily.js — verify the daily passages against the book, into data/daily.json.
 *
 *   node tools/build-daily.js
 *   node tools/build-daily.js --check      # validate only, write nothing
 *
 * data/daily.source.json is written by hand: a list of quotes, and nothing else.
 * This finds each one in data/book.json and records where it lives, so the home
 * screen can show a passage a day and open the reader at the paragraph it came
 * from.
 *
 * It is deliberately unforgiving, for the same reason build-steps.js is: people
 * quote this book precisely. A quote that matches nothing, or matches in two
 * places, is an error, and nothing is written. The text that ships is copied
 * out of book.json rather than out of the source file, so what the app shows is
 * the book's own words even if a typo crept into the typing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'daily.source.json');
const BOOK = path.join(ROOT, 'data', 'book.json');
const OUT = path.join(ROOT, 'data', 'daily.json');

/* The same flattening build-steps.js uses — curly quotes, dashes and runs of
 * whitespace differ between what you type and what the typesetter set. This one
 * also keeps a map back to the original string, so the exact printed words can
 * be cut out of the paragraph once a match is found. */
function flattenWithMap(text) {
    const source = String(text);
    let flat = '';
    const map = [];
    let lastWasSpace = false;

    for (let i = 0; i < source.length; i++) {
        let ch = source[i];
        if (/\s/.test(ch)) {
            if (lastWasSpace || flat === '') continue;
            lastWasSpace = true;
            flat += ' ';
            map.push(i);
            continue;
        }
        lastWasSpace = false;
        if ('‘’ʼ'.indexOf(ch) !== -1) ch = "'";
        else if ('“”'.indexOf(ch) !== -1) ch = '"';
        else if ('–—'.indexOf(ch) !== -1) ch = '-';
        flat += ch.toLowerCase();
        map.push(i);
    }

    // Trailing space would never be part of a match, but drop it for tidiness.
    while (flat.endsWith(' ')) { flat = flat.slice(0, -1); map.pop(); }
    return { flat: flat, map: map };
}

function flatten(text) {
    return flattenWithMap(text).flat;
}

function loadJson(file, label) {
    if (!fs.existsSync(file)) fail('missing ' + label + ': ' + path.relative(ROOT, file));
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        fail('could not parse ' + label + ': ' + error.message);
    }
}

function fail(message) {
    console.error('Error: ' + message);
    process.exit(1);
}

function main(argv) {
    const checkOnly = argv.includes('--check');

    const source = loadJson(SOURCE, 'daily source');
    const book = loadJson(BOOK, 'book');

    // Every paragraph of the book, flattened once, with the map home.
    const haystack = [];
    book.sections.forEach((section) => {
        section.paragraphs.forEach((paragraph, index) => {
            const flat = flattenWithMap(paragraph);
            haystack.push({
                sectionId: section.id,
                sectionTitle: section.title,
                paraIndex: index,
                text: paragraph,
                flat: flat.flat,
                map: flat.map
            });
        });
    });

    const problems = [];

    /*
     * One list of quotes, checked and located. A quote may appear in two lists
     * — the book only says a thing once, and the daily rotation and the craving
     * screen are read in different moods — but never twice in the same one.
     */
    function verify(listName, entries) {
        const seen = {};
        const passages = [];

        (entries || []).forEach((entry, n) => {
            const where = listName + ' ' + (n + 1);
            const needle = flatten(entry.quote);

            if (!needle) { problems.push(where + ': empty quote'); return; }
            if (needle.length < 30) {
                problems.push(where + ': "' + entry.quote + '" is too short to be sure of — lengthen it');
                return;
            }
            if (seen[needle]) {
                problems.push(where + ': the same quote is already in the list at ' + seen[needle]);
                return;
            }
            seen[needle] = where;

            const hits = [];
            haystack.forEach((para) => {
                let at = para.flat.indexOf(needle);
                while (at !== -1) {
                    hits.push({ para: para, at: at });
                    at = para.flat.indexOf(needle, at + 1);
                }
            });

            if (hits.length === 0) {
                // Almost always a typo in the typing rather than a passage the book
                // does not contain, so say which paragraph came closest.
                const stem = needle.slice(0, 28);
                const near = haystack.find((para) => para.flat.indexOf(stem) !== -1);
                problems.push(where + ': not in the book — "' + entry.quote.slice(0, 60) + '"' +
                    (near ? '\n      closest is ' + near.sectionId + ' ¶' + near.paraIndex +
                            ': "' + near.text.slice(0, 90) + '"' : ''));
                return;
            }
            if (hits.length > 1) {
                problems.push(where + ': "' + entry.quote.slice(0, 45) + '" appears ' + hits.length +
                    ' times (' + hits.map((h) => h.para.sectionId + ' ¶' + h.para.paraIndex).join(', ') +
                    ') — lengthen it so it can only mean one of them');
                return;
            }

            const hit = hits[0];

            // A quote cut off mid-sentence reads as a bug on the home screen, and a
            // quote that starts mid-sentence puts words in the book's mouth. Both
            // are typing slips rather than choices, so neither is allowed through.
            if (!/[.!?\u201d\u2019"']$/.test(entry.quote.trim())) {
                problems.push(where + ': ends mid-sentence — "…' + entry.quote.slice(-45) + '"');
                return;
            }
            if (!/^[\u201c"'(]?[A-Z]/.test(entry.quote.trim())) {
                problems.push(where + ': starts mid-sentence — "' + entry.quote.slice(0, 45) + '…"');
                return;
            }

            const from = hit.para.map[hit.at];
            const to = hit.para.map[hit.at + needle.length - 1];
            const exact = hit.para.text.slice(from, to + 1);

            passages.push({
                text: exact,
                sectionId: hit.para.sectionId,
                sectionTitle: hit.para.sectionTitle,
                paraIndex: hit.para.paraIndex,
                // The opening of the paragraph, the way a note anchors itself, so the
                // app can find the passage again in a differently formatted copy.
                anchor: hit.para.text.replace(/\s+/g, ' ').trim().slice(0, 80)
            });
        });


        return passages;
    }

    const passages = verify('passage', source.passages);
    const craving = verify('craving passage', source.craving);

    if (problems.length) {
        console.error('\n' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') +
            ' — nothing was written:\n');
        problems.forEach((p) => console.error('  ✗ ' + p));
        console.error('');
        process.exit(1);
    }

    const built = {
        schema: source.schema,
        title: source.title,
        edition: source.edition,
        builtAt: new Date().toISOString(),
        passages: passages,
        craving: craving
    };

    if (!checkOnly) {
        fs.writeFileSync(OUT, JSON.stringify(built, null, 1) + '\n', 'utf8');
    }

    const bySection = {};
    passages.forEach((p) => { bySection[p.sectionTitle] = (bySection[p.sectionTitle] || 0) + 1; });

    console.log(checkOnly ? 'Checked ' + path.relative(ROOT, SOURCE)
                          : 'Wrote ' + path.relative(ROOT, OUT));
    console.log('  passages: ' + passages.length + ' verified word for word, all unambiguous');
    console.log('  a passage repeats every ' + passages.length + ' days');
    console.log('  craving:  ' + craving.length + ' verified the same way');
    console.log('');
    Object.keys(bySection).forEach((title) => {
        console.log('   ' + String(bySection[title]).padStart(3) + '  ' + title);
    });
}

main(process.argv);
