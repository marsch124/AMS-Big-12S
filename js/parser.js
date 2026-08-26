/*
 * parser.js — turns a plain-text copy of the book into the app's section model.
 *
 * Runs unchanged in the browser (Settings -> Import book text) and under Node
 * (tools/build-book.js), so there is only ever one parser to keep honest.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BookParser = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Sections we know by name. Matching against this list keeps section ids
    // stable across re-imports, which is what stops notes from being orphaned
    // when the reader swaps in a cleaner copy of the text.
    var CANONICAL = [
        { id: 'foreword',   kind: 'front',   title: 'Foreword',             aliases: ['foreword', 'preface', 'foreword to first edition'] },
        { id: 'doctors-op', kind: 'front',   title: "The Doctor's Opinion", aliases: ["the doctor's opinion", 'the doctors opinion'] },
        { id: 'ch01', kind: 'chapter', number: 1,  title: "Bill's Story",          aliases: ["bill's story", 'bills story'] },
        { id: 'ch02', kind: 'chapter', number: 2,  title: 'There Is A Solution',   aliases: ['there is a solution'] },
        { id: 'ch03', kind: 'chapter', number: 3,  title: 'More About Alcoholism', aliases: ['more about alcoholism'] },
        { id: 'ch04', kind: 'chapter', number: 4,  title: 'We Agnostics',          aliases: ['we agnostics'] },
        { id: 'ch05', kind: 'chapter', number: 5,  title: 'How It Works',          aliases: ['how it works'] },
        { id: 'ch06', kind: 'chapter', number: 6,  title: 'Into Action',           aliases: ['into action'] },
        { id: 'ch07', kind: 'chapter', number: 7,  title: 'Working With Others',   aliases: ['working with others'] },
        { id: 'ch08', kind: 'chapter', number: 8,  title: 'To Wives',              aliases: ['to wives'] },
        { id: 'ch09', kind: 'chapter', number: 9,  title: 'The Family Afterward',  aliases: ['the family afterward', 'the family afterwards'] },
        { id: 'ch10', kind: 'chapter', number: 10, title: 'To Employers',          aliases: ['to employers'] },
        { id: 'ch11', kind: 'chapter', number: 11, title: 'A Vision For You',      aliases: ['a vision for you'] },
        { id: 'stories', kind: 'part', title: 'The Personal Stories', aliases: ['the personal stories', 'personal stories'] }
    ];

    var ALIAS_MAP = (function () {
        var map = {};
        CANONICAL.forEach(function (entry) {
            entry.aliases.forEach(function (alias) { map[alias] = entry; });
        });
        return map;
    })();

    function normalizeKey(line) {
        return line
            .toLowerCase()
            .replace(/[‘’ʼ]/g, "'")
            .replace(/[^a-z0-9' ]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function slugify(text) {
        var slug = text
            .toLowerCase()
            .replace(/[‘’ʼ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
        return slug || 'section';
    }

    function normalizeText(raw) {
        return String(raw)
            .replace(/\r\n?/g, '\n')      // Windows / classic Mac line endings
            .replace(/\f/g, '\n')          // form feeds mark page breaks in most scans
            .replace(/ /g, ' ')       // non-breaking spaces
            .replace(/[ \t]+$/gm, '');
    }

    // A line is dropped outright when it is page furniture rather than text:
    // a bare page number, or the "Alcoholics Anonymous" running head.
    function isNoise(line) {
        if (!line) return false;
        if (/^\d{1,4}$/.test(line)) return true;
        if (/^page\s+\d{1,4}$/i.test(line)) return true;
        if (/^[-–—=_*\s]+$/.test(line)) return true;
        if (normalizeKey(line) === 'alcoholics anonymous') return true;
        return false;
    }

    var ROMAN = /^(?:[ivxlcdm]+)$/i;

    function romanToInt(value) {
        var numerals = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
        var lower = value.toLowerCase();
        var total = 0;
        for (var i = 0; i < lower.length; i++) {
            var current = numerals[lower[i]];
            var next = numerals[lower[i + 1]];
            total += next && current < next ? -current : current;
        }
        return total;
    }

    // "CHAPTER 5", "Chapter Five", "CHAPTER V" — returns the number, else null.
    var WORD_NUMBERS = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
    };

    function chapterMarker(line) {
        var match = /^chapter\s+([a-z0-9]+)\.?$/i.exec(line.trim());
        if (!match) return null;
        var token = match[1];
        if (/^\d+$/.test(token)) return parseInt(token, 10);
        if (WORD_NUMBERS[token.toLowerCase()]) return WORD_NUMBERS[token.toLowerCase()];
        if (ROMAN.test(token)) return romanToInt(token);
        return null;
    }

    function looksLikeHeading(line, previousWasBlank) {
        var trimmed = line.trim();
        if (!trimmed || trimmed.length > 70) return false;
        if (!previousWasBlank) return false;
        if (!/[A-Za-z]/.test(trimmed)) return false;
        if (/[.,;:?!]$/.test(trimmed) && !/[?!]$/.test(trimmed)) return false;
        // All-caps headings are the common case in public-domain transcriptions.
        var letters = trimmed.replace(/[^A-Za-z]/g, '');
        if (letters.length < 3) return false;
        return letters === letters.toUpperCase();
    }

    function titleCase(text) {
        var small = /^(a|an|the|and|but|or|for|nor|of|on|in|to|with|as|at|by|from|is)$/i;
        var words = text.toLowerCase().split(/\s+/);
        return words.map(function (word, index) {
            if (index > 0 && small.test(word)) return word;
            return word.replace(/^([a-z])/, function (m, c) { return c.toUpperCase(); });
        }).join(' ');
    }

    // Blocks of lines separated by blank lines become paragraphs. Lines inside a
    // block are re-joined, undoing the hard wrapping of a plain-text copy.
    function blockToParagraph(lines) {
        var text = '';
        lines.forEach(function (line, index) {
            var piece = line.trim();
            if (index === 0) { text = piece; return; }
            if (/[a-z,]-$/.test(text) && /^[a-z]/.test(piece)) {
                text = text.replace(/-$/, '') + piece;   // rejoin a hyphen-split word
            } else {
                text += ' ' + piece;
            }
        });
        return text.replace(/\s+/g, ' ').trim();
    }

    function parse(rawText, options) {
        options = options || {};
        var warnings = [];
        var lines = normalizeText(rawText).split('\n');

        var sections = [];
        var current = null;
        var block = [];
        var previousWasBlank = true;
        var pendingChapterNumber = null;
        var usedIds = {};

        function startSection(title, meta) {
            flushBlock();
            var key = normalizeKey(title);
            var canonical = ALIAS_MAP[key];
            var id = canonical ? canonical.id : slugify(title);
            if (usedIds[id]) {
                var suffix = 2;
                while (usedIds[id + '-' + suffix]) suffix++;
                id = id + '-' + suffix;
            }
            usedIds[id] = true;

            current = {
                id: id,
                kind: canonical ? canonical.kind : (meta && meta.kind) || 'story',
                title: canonical ? canonical.title : titleCase(title),
                paragraphs: []
            };
            var number = (meta && meta.number) || (canonical && canonical.number);
            if (number) current.number = number;
            sections.push(current);
        }

        function flushBlock() {
            if (!block.length) return;
            var paragraph = blockToParagraph(block);
            block = [];
            if (!paragraph) return;
            if (!current) {
                // Text before the first recognised heading — keep it rather than
                // silently dropping someone's front matter.
                startSection('Front Matter', { kind: 'front' });
            }
            current.paragraphs.push(paragraph);
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var trimmed = line.trim();

            if (!trimmed) { flushBlock(); previousWasBlank = true; continue; }
            if (isNoise(trimmed)) { flushBlock(); previousWasBlank = true; continue; }

            var marker = chapterMarker(trimmed);
            if (marker !== null) {
                flushBlock();
                pendingChapterNumber = marker;
                previousWasBlank = true;
                continue;
            }

            if (pendingChapterNumber !== null) {
                startSection(trimmed, { kind: 'chapter', number: pendingChapterNumber });
                pendingChapterNumber = null;
                previousWasBlank = false;
                continue;
            }

            if (ALIAS_MAP[normalizeKey(trimmed)] || looksLikeHeading(trimmed, previousWasBlank)) {
                startSection(trimmed, null);
                previousWasBlank = false;
                continue;
            }

            block.push(line);
            previousWasBlank = false;
        }
        flushBlock();

        sections = sections.filter(function (section) {
            return section.paragraphs.length > 0 || section.kind === 'part';
        });

        var found = {};
        sections.forEach(function (section) { found[section.id] = true; });
        CANONICAL.forEach(function (entry) {
            if (entry.kind === 'chapter' && !found[entry.id]) {
                warnings.push('Chapter not found in the imported text: ' + entry.title);
            }
        });
        if (!sections.length) warnings.push('No sections were recognised in this text.');

        return { sections: sections, warnings: warnings };
    }

    function wordCount(sections) {
        return sections.reduce(function (total, section) {
            return total + section.paragraphs.reduce(function (sum, paragraph) {
                return sum + paragraph.split(/\s+/).length;
            }, 0);
        }, 0);
    }

    return {
        parse: parse,
        canonical: CANONICAL,
        normalizeKey: normalizeKey,
        slugify: slugify,
        wordCount: wordCount
    };
});
