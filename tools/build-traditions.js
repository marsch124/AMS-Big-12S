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
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'traditions.source.json');
const BOOK = path.join(ROOT, 'data', 'book.json');
const OUT = path.join(ROOT, 'data', 'traditions.json');

/* Curly quotes, dashes and stray whitespace differ between what you type and
 * what the typesetter set. Compare on a flattened form of both. This must stay
 * identical to flatten() in build-steps.js and store.js, or the runtime pass
 * will disagree with the build. */
function flatten(text) {
    return String(text)
        .replace(/[‘’ʼ]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
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
        sections[section.id] = section.paragraphs.map(flatten);
    });

    const problems = [];
    let resolvedCount = 0;

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
            if (paragraph.indexOf(needle) === 0) hits.push(index);
        });

        if (hits.length === 1) { resolvedCount++; return hits[0]; }
        if (hits.length === 0) {
            const near = paragraphs.findIndex((p) => p.indexOf(needle.slice(0, 25)) === 0);
            problems.push(where + ': no paragraph in ' + ref.sectionId + ' starts with "' +
                ref.anchor.slice(0, 55) + '"' +
                (near >= 0 ? '\n      did you mean ¶' + near + '? it starts "' +
                    paragraphs[near].slice(0, 55) + '"' : ''));
        } else {
            problems.push(where + ': anchor "' + ref.anchor.slice(0, 45) +
                '" matches ' + hits.length + ' paragraphs in ' + ref.sectionId +
                ' (¶' + hits.join(', ¶') + ') — lengthen it');
        }
        return null;
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
