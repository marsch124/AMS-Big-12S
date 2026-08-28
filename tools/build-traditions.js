#!/usr/bin/env node
/*
 * build-traditions.js — resolve the Traditions material's book references into
 * data/traditions.json.
 *
 *   node tools/build-traditions.js
 *   node tools/build-traditions.js --check      # validate only, write nothing
 *
 * The same job build-steps.js does, and deliberately the same unforgiving one:
 * an anchor that matches nothing, or matches more than one paragraph, is an
 * error, and the build exits non-zero rather than shipping a link that opens
 * the wrong passage.
 *
 * One thing this build enforces that build-steps.js does not, because the
 * Traditions are not in this book: nothing here may carry the wording of a
 * Tradition. They were written in 1946 and first printed in the book at the
 * second edition, which is under copyright to A.A. World Services and is out of
 * bounds for this app. Each Tradition is named by its topic — "Membership",
 * "Anonymity" — and everything else on the page is either ours or quoted from
 * the 1939 text. A `text` field on a tradition is refused outright, so that
 * decision cannot be undone by accident later.
 *
 * Exactly one reference per Tradition carries a `seed`: the sentence in that
 * passage the Tradition was later built on, which the page shows at the top in
 * the slot where a step shows its own wording. It is held to the same bar
 * build-daily.js holds its quotes to — found in its own paragraph, once, whole
 * sentences — and the words that ship are cut out of book.json rather than out
 * of the source file, so a typo in the typing cannot reach the screen.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'traditions.source.json');
const BOOK = path.join(ROOT, 'data', 'book.json');
const OUT = path.join(ROOT, 'data', 'traditions.json');

/* Curly quotes, dashes and stray whitespace differ between what you type and
 * what the typesetter set. Compare on a flattened form of both. The flat string
 * must stay identical to flatten() in build-steps.js and store.js, or the
 * runtime pass will disagree with the build.
 *
 * The map alongside it is build-daily.js's trick: it remembers where every
 * flattened character came from, so once a seed matches, the book's own
 * punctuation and capitals can be cut straight out of the paragraph. */
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

    const source = loadJson(SOURCE, 'traditions source');
    const book = loadJson(BOOK, 'book');

    const sections = {};
    book.sections.forEach((section) => {
        sections[section.id] = section.paragraphs.map((paragraph) => {
            const flat = flattenWithMap(paragraph);
            return { text: paragraph, flat: flat.flat, map: flat.map };
        });
    });

    const problems = [];
    let resolvedCount = 0;
    let seedCount = 0;

    function resolve(ref, where) {
        const paragraphs = sections[ref.sectionId];
        if (!paragraphs) {
            problems.push(where + ': no section "' + ref.sectionId + '" in the book');
            return null;
        }
        const needle = flatten(ref.anchor);
        if (!needle) {
            problems.push(where + ': empty anchor');
            return null;
        }
        const hits = [];
        paragraphs.forEach((paragraph, index) => {
            if (paragraph.flat.indexOf(needle) === 0) hits.push(index);
        });

        if (hits.length === 1) { resolvedCount++; return hits[0]; }
        if (hits.length === 0) {
            const near = paragraphs.findIndex((p) => p.flat.indexOf(needle.slice(0, 25)) === 0);
            problems.push(where + ': no paragraph in ' + ref.sectionId + ' starts with "' +
                ref.anchor.slice(0, 55) + '"' +
                (near >= 0 ? '\n      did you mean ¶' + near + '? it starts "' +
                    paragraphs[near].flat.slice(0, 55) + '"' : ''));
        } else {
            problems.push(where + ': anchor "' + ref.anchor.slice(0, 45) +
                '" matches ' + hits.length + ' paragraphs in ' + ref.sectionId +
                ' (¶' + hits.join(', ¶') + ') — lengthen it');
        }
        return null;
    }

    /* The seed is quoted at the top of a Tradition's page, at the weight a step
     * page gives the step's own wording, so it is held to build-daily.js's bar
     * rather than a reference's: found inside its own paragraph, found once,
     * and whole sentences at both ends. A half-sentence would put words in the
     * book's mouth, which is the one thing this section cannot afford. What
     * ships is cut out of book.json, so a typo in the typing never reaches the
     * screen. */
    function verifySeed(ref, where) {
        const quote = String(ref.seed || '').trim();
        if (!quote) { problems.push(where + ': empty'); return; }
        // The anchor already failed and has already been complained about.
        if (ref.paraIndex === null) return;
        if (quote.length < 30) {
            problems.push(where + ': too short to be sure of — "' + quote + '"');
            return;
        }

        const para = sections[ref.sectionId][ref.paraIndex];
        const needle = flatten(quote);
        const at = para.flat.indexOf(needle);

        if (at === -1) {
            problems.push(where + ': not in ' + ref.sectionId + ' ¶' + ref.paraIndex +
                ' — "' + quote.slice(0, 60) + '"' +
                '\n      that paragraph reads "' + para.text.slice(0, 90) + '"');
            return;
        }
        if (para.flat.indexOf(needle, at + 1) !== -1) {
            problems.push(where + ': appears twice in its own paragraph — lengthen it');
            return;
        }
        if (!/[.!?\u201d\u2019"']$/.test(quote)) {
            problems.push(where + ': ends mid-sentence — "…' + quote.slice(-45) + '"');
            return;
        }
        if (!/^[\u201c"'(]?[A-Z]/.test(quote)) {
            problems.push(where + ': starts mid-sentence — "' + quote.slice(0, 45) + '…"');
            return;
        }

        const from = para.map[at];
        const to = para.map[at + needle.length - 1];
        ref.seedText = para.text.slice(from, to + 1);
        delete ref.seed;
        seedCount++;
    }

    const seenQuestionIds = {};

    const traditions = source.traditions.map((tradition) => {
        const label = 'tradition ' + tradition.number;

        // The bar this build exists to hold. Nothing may carry the wording.
        if (tradition.text) {
            problems.push(label + ': carries a "text" field. The Traditions are not in the ' +
                '1939 edition and their wording is under copyright — this app names the ' +
                'topic and quotes the 1939 ground, and nothing else.');
        }
        if (!tradition.topic) {
            problems.push(label + ': has no topic to be named by');
        }

        (tradition.questions || []).forEach((q) => {
            if (!q.id) problems.push(label + ': a question has no id');
            // Ids are load-bearing: answers are stored against them, so a
            // duplicate would have two questions sharing one history.
            else if (seenQuestionIds[q.id]) problems.push(label + ': duplicate question id "' + q.id + '"');
            seenQuestionIds[q.id] = true;
        });

        if (!(tradition.explanation || []).length) {
            problems.push(label + ': has no explanation');
        }

        // Every Tradition must show its 1939 ground or say plainly that there is
        // none. A page with neither would leave the reader guessing which it is.
        const references = (tradition.references || []).map((ref, i) =>
            Object.assign({}, ref, { paraIndex: resolve(ref, label + ' reference ' + (i + 1)) }));
        if (!references.length && !tradition.noGround) {
            problems.push(label + ': no references and no "noGround" note — say which it is');
        }

        // One of those passages is the sentence the Tradition was later built
        // on, and the page opens with it where a step opens with its own
        // wording. Exactly one: none leaves that slot empty again, and two
        // means nobody decided which is the headline.
        const seeded = references.filter((ref) => ref.seed !== undefined);
        if (!tradition.noGround) {
            if (!seeded.length) {
                problems.push(label + ': no reference carries a "seed" — mark the sentence ' +
                    'this one grew out of, or set "noGround" to say there is none');
            } else if (seeded.length > 1) {
                problems.push(label + ': ' + seeded.length + ' references carry a "seed" — ' +
                    'the page shows one, so pick one');
            }
        }
        seeded.forEach((ref, i) => verifySeed(ref,
            label + ' seed' + (seeded.length > 1 ? ' ' + (i + 1) : '')));

        return Object.assign({}, tradition, { references: references });
    });

    if (traditions.length !== 12) {
        problems.push('expected twelve traditions, found ' + traditions.length);
    }

    if (problems.length) {
        console.error('\n' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + ':\n');
        problems.forEach((p) => console.error('  - ' + p));
        console.error('');
        process.exit(1);
    }

    const output = {
        schema: source.schema || 1,
        title: source.title,
        edition: source.edition || '',
        wordingNote: source.wordingNote || '',
        authorNote: source.authorNote || '',
        traditions: traditions
    };

    const questions = traditions.reduce((n, t) => n + (t.questions || []).length, 0);
    console.log('Traditions: ' + traditions.length);
    console.log('References resolved: ' + resolvedCount + ' (none ambiguous)');
    console.log('Seed passages verified: ' + seedCount + ' (cut from the book, not the source)');
    console.log('Questions: ' + questions);
    console.log('No tradition carries the wording — topics only.');

    if (checkOnly) {
        console.log('\n--check: nothing written.');
        return;
    }
    fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
    console.log('\nWrote ' + path.relative(ROOT, OUT));
}

main(process.argv.slice(2));
