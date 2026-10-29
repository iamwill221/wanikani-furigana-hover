# WaniKani Sentence Practice

A Chrome extension for practicing with WaniKani's example sentences. Hover any
word in a context sentence to see its furigana, listen to the sentence read aloud,
and keep English translations hidden until you click **Show**.

- **Furigana on hover.** Hover any word in a context sentence to see its reading.
- **Spoken sentences.** A speaker button beside each sentence reads it aloud using
  your browser's built-in Japanese voice (no network needed with an installed
  voice). Press another sentence's button to switch.
- **Hidden translations.** English translations start hidden behind a **Show**
  button, one per sentence, in both Context Sentences and Patterns of Use
  (Common Word Combinations). Click again to hide and re-test yourself.

<img width="521" height="167" alt="Screenshot 2026-10-30 080113" src="https://github.com/user-attachments/assets/b215ec98-6f55-46f1-9575-dca44bf9c7e0" />


Readings are generated locally by [kuromoji.js](https://github.com/takuyaa/kuromoji.js)
with the IPADIC dictionary bundled inside the extension. Nothing is sent anywhere,
no API token is needed, and it works offline.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder.
3. Open any WaniKani lesson, vocabulary page, or review item info panel.

Hover a word with a dotted underline and its reading appears above it. Each
translation sits behind its own Show button.

## How it works

Two passes run over every `.context-sentences` block, the wrapper WaniKani uses
for both Context Sentences and Patterns of Use.

- **Translations** are hidden immediately, with no dependency on the dictionary,
  so they never flash visible while kuromoji loads. The text is wrapped in a span
  toggled with `visibility`, not `display`, so the line keeps its box and nothing
  on the page moves when you reveal one. The control is a real `<button>` with
  `aria-expanded`, so Tab and Enter work.
- **Furigana**: `src/content.js` finds the Japanese half of each sentence, tokenizes it,
  and wraps each word in a span carrying its hiragana reading.
- `src/furigana.css` reveals that reading with `::after` and `attr()`. The hover
  itself runs no JavaScript, and the sentence reserves space above every line so
  nothing shifts when a reading appears.
- The dictionary is only fetched once a page actually contains a context sentence.
  First load takes roughly a second; after that, tokenizing is instant.
- Translations are hidden again on every page load, rather than remembering what
  you revealed last time.

## Reading accuracy

Tokenization uses IPADIC, which is good but not perfect. Two guards are in place:

- **Unknown words.** If kuromoji does not recognise a kanji word, its "reading" is
  a guess from character class rather than a lookup. Those are dropped: no furigana
  is better than wrong furigana.
- **Godan volitional forms.** IPADIC contains a few bogus noun entries that swallow
  a whole verb form. 入ろう is listed as a noun read ニュウロウ instead of はいろう.
  When a noun token ends in an お-row kana plus う, the stem is re-tokenized, and the
  correction is only applied if that stem comes back as exactly one verb.

If you spot another bad reading, add it to `OVERRIDES` near the top of
`src/content.js`:

```js
const OVERRIDES = Object.create(null);
OVERRIDES["御手洗"] = "みたらい";
```

Words are merged with their trailing auxiliaries, so 出てきた is one hover target
reading でてきた rather than four separate morphemes.

## Layout

```
manifest.json         MV3 manifest
src/content.js        tokenizing and word wrapping
src/furigana.css      the hover overlay
vendor/kuromoji.js    kuromoji 0.1.2 browser build, patched (see below)
dict/                 IPADIC, 18 MB gzipped
tools/patch-loader.mjs  re-applies the vendor patch after an upgrade
tools/test-extension.mjs  end-to-end test
```

### The vendor patch

kuromoji's browser build loads its dictionary with `XMLHttpRequest`, which is
inconsistent against `chrome-extension://` URLs in MV3 and can trip over the host
page's CSP. `tools/patch-loader.mjs` swaps it for `fetch` plus the native
`DecompressionStream`. The patch is idempotent, and it fails loudly rather than
silently if kuromoji's internals change. After replacing `vendor/kuromoji.js`:

```sh
node tools/patch-loader.mjs
```

### Tests

Needs Playwright and a display (extensions do not load in headless Chromium):

```sh
xvfb-run -a node tools/test-extension.mjs
```

It loads the unpacked extension against a mock WaniKani page carrying both a
Context Sentences section and a Patterns of Use panel. It checks that translations are hidden
before the dictionary loads, every sentence in both sections gets a toggle,
revealing one leaves the others alone and shifts nothing, the button re-hides and
responds to Enter, translation text survives intact, readings are correct in both
sections, hover reveals furigana without moving the line, and sentences injected
after page load are picked up.

## Notes and limits

- The dictionary is the bulk of the ~18 MB folder. That is unavoidable with IPADIC.
- Readings are not filtered by your WaniKani level: every kanji word gets one.
- Hover only for furigana, so it does not help on touch devices beyond
  tap-and-hold. The translation buttons are ordinary taps and work fine.
- There is no reveal-all control; translations are revealed one at a time.
- kuromoji is Apache 2.0; see `vendor/LICENSE-2.0.txt` and `vendor/NOTICE.md`.
