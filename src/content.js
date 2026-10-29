/*
 * WaniKani Sentence Practice
 *
 * Wraps each word of a context sentence in a span carrying its hiragana
 * reading, then lets CSS reveal that reading on hover. The reveal is pure
 * CSS (::after + attr()), so no JavaScript runs during the interaction and
 * nothing reflows when a reading appears.
 */
(() => {
  "use strict";

  // Japanese halves of WaniKani context sentences, wherever they appear:
  // lesson pages, vocab item pages, and the item-info panel during reviews.
  const SENTENCE_SELECTOR = '.context-sentences [lang="ja"], .context-sentence [lang="ja"]';

  const DONE = "wkfhDone";          // dataset flag on finished sentences
  const WORD_CLASS = "wkfh-word";
  const READING_ATTR = "data-wkfh-reading";

  // Context Sentences and Patterns of Use share this markup, so one pass covers both.
  const SENTENCE_BLOCK = ".context-sentences, .context-sentence";
  const ENGLISH_SELECTOR = "[data-english]";
  const EN_DONE = "wkfhEnDone";

  // 々 〇, CJK unified + ext A, compatibility ideographs, and ext B via surrogates.
  const HAS_KANJI = /[々〇㐀-䶿一-鿿豈-﫿]|[\uD840-\uD87F][\uDC00-\uDFFF]/;

  // Hand-checked corrections for words IPADIC gets wrong. Keyed by surface
  // form, values in hiragana. Add entries here when you spot a bad reading.
  const OVERRIDES = Object.create(null);

  // Trailing morphemes that belong to the word in front of them, so hovering
  // 出てきた reveals でてきた rather than just で over 出.
  const IS_SUFFIX = (t) =>
    t.pos === "助動詞" ||
    t.pos_detail_1 === "接尾" ||
    (t.pos === "動詞" && t.pos_detail_1 === "非自立") ||
    (t.pos === "助詞" && t.pos_detail_1 === "接続助詞" && /^[てでた]/.test(t.surface_form));

  // Godan volitional: IPADIC has a few bogus noun entries that swallow the
  // whole form (入ろう is listed as a noun read ニュウロウ). Re-tokenizing
  // without the final う recovers the verb stem. Guarded tightly: the stem
  // must come back as exactly one verb, so real nouns like 向こう are left
  // alone or map to an identical reading.
  const VOLITIONAL_TAIL = /[おこそとのほもよろごぞどぼ]う$/;

  function repairVolitional(token, tokenizer) {
    if (token.pos !== "名詞" || !VOLITIONAL_TAIL.test(token.surface_form)) return null;
    const stem = tokenizer.tokenize(token.surface_form.slice(0, -1));
    if (stem.length !== 1 || stem[0].pos !== "動詞" || !stem[0].reading) return null;
    return stem[0].reading + "ウ";
  }

  const kataToHira = (s) =>
    s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  // Collapse a token stream into hoverable word units with resolved readings.
  function toUnits(tokens, tokenizer) {
    const units = [];
    for (const token of tokens) {
      const surface = token.surface_form;

      if (units.length && IS_SUFFIX(token)) {
        const prev = units[units.length - 1];
        prev.surface += surface;
        // Suffixes are kana, so their own surface is a safe fallback.
        if (prev.reading !== null) prev.reading += token.reading || surface;
        continue;
      }

      // An UNKNOWN token's reading is guessed from character class, not looked
      // up. A wrong reading is worse than none in a learning tool, so drop it.
      const guessed = token.word_type === "UNKNOWN" && HAS_KANJI.test(surface);
      const reading = guessed ? null : repairVolitional(token, tokenizer) || token.reading || null;

      units.push({ surface, reading });
    }
    return units;
  }

  /* ---------- English translations: hidden until revealed ---------- */

  let enSeq = 0;

  // The text keeps its space (visibility, not display) so revealing a
  // translation never pushes the sentences below it around.
  function hideEnglish(enEl) {
    const text = document.createElement("span");
    text.className = "wkfh-en-text";
    text.id = "wkfh-en-" + ++enSeq;
    while (enEl.firstChild) text.appendChild(enEl.firstChild);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "wkfh-toggle";
    button.setAttribute("aria-controls", text.id);

    const render = (shown) => {
      enEl.classList.toggle("wkfh-en--shown", shown);
      button.setAttribute("aria-expanded", String(shown));
      button.textContent = shown ? "Hide" : "Show";
      button.setAttribute(
        "aria-label",
        (shown ? "Hide" : "Show") + " the English translation"
      );
    };

    button.addEventListener("click", (event) => {
      // The collocation panels are tab content; keep the click to ourselves.
      event.preventDefault();
      event.stopPropagation();
      render(!enEl.classList.contains("wkfh-en--shown"));
    });

    enEl.classList.add("wkfh-en");
    render(false);
    enEl.appendChild(button);
    enEl.appendChild(text);
  }

  // Runs without the dictionary, so translations are hidden the moment the
  // page renders rather than a second later.
  function scanEnglish() {
    for (const block of document.querySelectorAll(SENTENCE_BLOCK)) {
      for (const enEl of block.querySelectorAll(ENGLISH_SELECTOR)) {
        if (enEl.dataset[EN_DONE]) continue;
        enEl.dataset[EN_DONE] = "1";
        try {
          hideEnglish(enEl);
        } catch (err) {
          console.warn("[WaniKani Sentence Practice] could not hide translation:", err);
        }
      }
    }
  }

  /* ---------- Spoken sentences ---------- */

  const SPEAK_DONE = "wkfhSpeakDone";
  const SPEAK_RATE = 0.85; // a touch slower than native speed, easier to follow
  const SPEAKER_ICON =
    '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'd="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

  // Voices load asynchronously in Chrome, so look one up at click time.
  function japaneseVoice() {
    const voices = speechSynthesis.getVoices();
    return voices.find((v) => v.lang === "ja-JP") || voices.find((v) => /^ja\b/i.test(v.lang)) || null;
  }

  function speak(text, button) {
    speechSynthesis.cancel(); // a new sentence replaces the one still playing
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = SPEAK_RATE;
    const voice = japaneseVoice();
    if (voice) utterance.voice = voice;

    const done = () => button.classList.remove("wkfh-speak--playing");
    utterance.onend = done;
    utterance.onerror = done;
    button.classList.add("wkfh-speak--playing");
    speechSynthesis.speak(utterance);
  }

  function addSpeaker(sentenceEl) {
    // Read the sentence now, while it is still plain text: the furigana pass
    // only wraps words in spans, but this keeps the button out of the equation.
    const text = sentenceEl.textContent.replace(/\s+/g, "").trim();
    if (!text) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "wkfh-speak";
    button.setAttribute("aria-label", "Play sentence audio");
    button.title = "Play sentence audio";
    button.innerHTML = SPEAKER_ICON;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      speak(text, button);
    });

    sentenceEl.appendChild(button);
  }

  function scanSpeakers() {
    if (!("speechSynthesis" in window)) return;
    for (const el of document.querySelectorAll(SENTENCE_SELECTOR)) {
      if (el.dataset[SPEAK_DONE]) continue;
      el.dataset[SPEAK_DONE] = "1";
      try {
        addSpeaker(el);
      } catch (err) {
        console.warn("[WaniKani Sentence Practice] could not add audio button:", err);
      }
    }
  }

  /* ---------- Furigana ---------- */

  let tokenizerPromise = null;

  // Built lazily: the IPADIC dictionary is ~18 MB gzipped, so it is only
  // fetched once a page actually shows a context sentence.
  function getTokenizer() {
    if (tokenizerPromise) return tokenizerPromise;
    tokenizerPromise = new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji failed to load"));
        return;
      }
      kuromoji
        .builder({ dicPath: chrome.runtime.getURL("dict/") })
        .build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)));
    });
    tokenizerPromise.catch(() => {
      // Let a later sentence retry rather than wedging the whole page.
      tokenizerPromise = null;
    });
    return tokenizerPromise;
  }

  // Replace one text node with a run of per-word spans.
  function decorateTextNode(textNode, tokenizer) {
    const text = textNode.nodeValue;
    if (!text || !HAS_KANJI.test(text)) return;

    const frag = document.createDocumentFragment();
    for (const unit of toUnits(tokenizer.tokenize(text), tokenizer)) {
      const { surface } = unit;
      const reading = OVERRIDES[surface] || (unit.reading ? kataToHira(unit.reading) : "");

      // A reading only helps where there is kanji to read, and where it
      // actually differs from what is already on screen.
      if (!HAS_KANJI.test(surface) || !reading || reading === surface) {
        frag.appendChild(document.createTextNode(surface));
        continue;
      }

      const span = document.createElement("span");
      span.className = WORD_CLASS;
      span.setAttribute(READING_ATTR, reading);
      span.textContent = surface;
      frag.appendChild(span);
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }

  function decorate(sentenceEl, tokenizer) {
    // Walk text nodes rather than rewriting innerHTML, so any markup
    // WaniKani puts inside a sentence survives untouched.
    const walker = document.createTreeWalker(sentenceEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement && node.parentElement.classList.contains(WORD_CLASS)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });

    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    for (const n of nodes) decorateTextNode(n, tokenizer);

    sentenceEl.classList.add("wkfh-ready");
  }

  async function scanFurigana() {
    const pending = [...document.querySelectorAll(SENTENCE_SELECTOR)].filter(
      (el) => !el.dataset[DONE]
    );
    if (!pending.length) return;

    // Claim them up front so a MutationObserver burst cannot queue them twice.
    for (const el of pending) el.dataset[DONE] = "1";

    let tokenizer;
    try {
      tokenizer = await getTokenizer();
    } catch (err) {
      console.warn("[WaniKani Sentence Practice] dictionary unavailable:", err);
      for (const el of pending) delete el.dataset[DONE];
      return;
    }

    for (const el of pending) {
      try {
        decorate(el, tokenizer);
      } catch (err) {
        console.warn("[WaniKani Sentence Practice] could not decorate sentence:", err);
      }
    }
  }

  // WaniKani is a Turbo app: sentences arrive on navigation and when the
  // item-info panel opens mid-review, so watch instead of scanning once.
  let queued = false;
  function queueScan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scanEnglish();
      scanSpeakers();
      scanFurigana();
    });
  }

  new MutationObserver(queueScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener("turbo:load", queueScan);
  scanEnglish();
  scanSpeakers();
  queueScan();
})();
