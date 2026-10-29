import { createRequire } from "node:module";

// Resolve playwright from the project, a global install, or NODE_PATH.
const require = createRequire(import.meta.url);
const pw = (() => {
  for (const id of ["playwright", "/opt/npm-tools/node_modules/playwright"]) {
    try { return require(id); } catch { /* try the next one */ }
  }
  throw new Error("playwright not found - npm i -D playwright, or set NODE_PATH");
})();
const { chromium } = pw;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EXT = dirname(dirname(fileURLToPath(import.meta.url)));

// Real markup from a WaniKani vocab lesson: a Context Sentences section and a
// Patterns of Use tab panel. Both wrap sentences in .context-sentences.
const MOCK = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>WaniKani / Lessons</title></head><body>
<section class="subject-section" data-name="contextSentences">
  <h2 class="subject-section__title"><span class="subject-section__title-text">Context Sentences</span></h2>
  <section class="subject-section__content">
    <div class="context-sentences">
      <p class="wk-text" lang="ja" data-japanese="">はやく中に入ろう。</p>
      <p class="wk-text" data-english="">Let's go inside quickly.</p>
    </div>
    <div class="context-sentences">
      <p class="wk-text" lang="ja" data-japanese="">川の中からビキニの女が出てきた。</p>
      <p class="wk-text" data-english="">A woman in a bikini came out of the river.</p>
    </div>
  </section>
</section>
<section class="subject-section">
  <section class="subject-section__content">
    <div class="subject-collocations" data-controller="collocations">
      <ul>
        <li class="subject-collocations__pattern-collocation" id="collocations-1-0" role="tabpanel">
          <div class="context-sentences">
            <p class="wk-text" lang="ja" data-japanese="">中から出てくる</p>
            <p class="wk-text" data-english="">to come out from inside</p>
          </div>
          <div class="context-sentences">
            <p class="wk-text" lang="ja" data-japanese="">中からきこえる</p>
            <p class="wk-text" data-english="">to hear a sound coming from inside</p>
          </div>
        </li>
      </ul>
    </div>
  </section>
</section>
<div id="anchor">anchor</div>
</body></html>`;

const fail = [];
const check = (name, ok, detail) => {
  if (!ok) fail.push(name + (detail ? ": " + detail : ""));
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "wkfh-")), {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("Sentence Practice")) noise.push(m.text());
});
await page.route("https://www.wanikani.com/**", (route) =>
  route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: MOCK })
);
await page.goto("https://www.wanikani.com/subject-lessons/test", { waitUntil: "domcontentloaded" });

console.log("\nEnglish translations");
await page.waitForSelector(".wkfh-toggle", { timeout: 15000 });

// Hiding must not wait on the 18 MB dictionary.
const furiganaReadyYet = await page.$$eval(".wkfh-word", (e) => e.length);
check("hidden before the dictionary finishes loading", furiganaReadyYet === 0,
  `${furiganaReadyYet} furigana spans present`);

const toggles = await page.$$eval(".wkfh-toggle", (els) => els.length);
check("a toggle on every translation, both sections", toggles === 4, `${toggles} toggles`);

const initial = await page.$$eval(".wkfh-en-text", (els) =>
  els.map((e) => getComputedStyle(e).visibility)
);
check("all translations start hidden", initial.every((v) => v === "hidden"), initial.join(","));

const texts = await page.$$eval(".wkfh-en-text", (els) => els.map((e) => e.textContent));
check("translation text preserved", texts[0] === "Let's go inside quickly." &&
  texts[3] === "to hear a sound coming from inside", JSON.stringify(texts));

const labels = await page.$$eval(".wkfh-toggle", (els) =>
  els.map((e) => e.textContent + "/" + e.getAttribute("aria-expanded"))
);
check("buttons labelled Show and collapsed", labels.every((l) => l === "Show/false"), labels.join(" "));

console.log("\nRevealing");
const anchorBefore = await page.locator("#anchor").boundingBox();
await page.locator(".wkfh-toggle").first().click();
await page.waitForTimeout(150);

const afterClick = await page.$$eval(".wkfh-en-text", (els) =>
  els.map((e) => getComputedStyle(e).visibility)
);
check("clicked sentence revealed", afterClick[0] === "visible", afterClick[0]);
check("other sentences untouched", afterClick.slice(1).every((v) => v === "hidden"),
  afterClick.join(","));

const anchorAfter = await page.locator("#anchor").boundingBox();
check("page does not shift on reveal", anchorBefore.y === anchorAfter.y,
  `${anchorBefore.y} -> ${anchorAfter.y}`);

const firstLabel = await page.locator(".wkfh-toggle").first()
  .evaluate((e) => e.textContent + "/" + e.getAttribute("aria-expanded"));
check("button flips to Hide and expanded", firstLabel === "Hide/true", firstLabel);

// Re-hide, so the sentence can be used for practice again.
await page.locator(".wkfh-toggle").first().click();
await page.waitForTimeout(150);
const reHidden = await page.$eval(".wkfh-en-text", (e) => getComputedStyle(e).visibility);
check("re-hides on second click", reHidden === "hidden", reHidden);

// Keyboard: the control is a real button, so Enter must work.
await page.locator(".wkfh-toggle").nth(2).focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(150);
const kbd = await page.$$eval(".wkfh-en-text", (els) =>
  els.map((e) => getComputedStyle(e).visibility)
);
check("keyboard reveals the collocation translation", kbd[2] === "visible", kbd.join(","));

// The content script runs in an isolated world, so speechSynthesis cannot be
// stubbed from here. Check the controls exist and are safe to press instead.
console.log("\nSpoken sentences");
const speakers = await page.$$eval(".wkfh-speak", (els) =>
  els.map((e) => e.tagName + "/" + e.getAttribute("aria-label"))
);
check("an audio button on every sentence, both sections",
  speakers.length === 4 && speakers.every((s) => s === "BUTTON/Play sentence audio"),
  speakers.join(" "));

await page.locator(".wkfh-speak").first().click();
await page.waitForTimeout(150);
const sentenceText = await page.$eval('[lang="ja"]', (e) => e.textContent);
check("audio button leaves the sentence text intact", sentenceText === "はやく中に入ろう。", sentenceText);

console.log("\nFurigana");
await page.waitForSelector(".wkfh-word", { timeout: 60000 });
const words = await page.$$eval(".wkfh-word", (els) =>
  els.map((e) => e.textContent + "=" + e.getAttribute("data-wkfh-reading"))
);
check("readings correct in context sentences",
  words.includes("入ろう=はいろう") && words.includes("出てきた=でてきた"), words.join(" "));
check("readings applied inside collocation panels too",
  words.filter((w) => w.startsWith("中=なか")).length >= 3, words.join(" "));

const target = page.locator(".wkfh-word", { hasText: "入ろう" }).first();
const boxBefore = await target.boundingBox();
const idle = await target.evaluate((e) => getComputedStyle(e, "::after").opacity);
await target.hover();
await page.waitForTimeout(250);
const hovered = await target.evaluate((e) => getComputedStyle(e, "::after").opacity);
const boxAfter = await target.boundingBox();
check("hover reveals furigana", idle === "0" && hovered !== "0", `${idle} -> ${hovered}`);
check("line does not move on hover", JSON.stringify(boxBefore) === JSON.stringify(boxAfter));

// A sentence added after load: the review item-info panel case.
await page.evaluate(() => {
  const d = document.createElement("div");
  d.className = "context-sentences";
  d.innerHTML = '<p class="wk-text" lang="ja" data-japanese="">昨日、新しい車を買いました。</p>' +
                '<p class="wk-text" data-english="">I bought a new car yesterday.</p>';
  document.body.appendChild(d);
});
await page.waitForTimeout(1500);
const late = await page.evaluate(() => {
  const d = document.body.lastElementChild;
  return {
    words: [...d.querySelectorAll(".wkfh-word")].map((e) => e.textContent + "=" + e.getAttribute("data-wkfh-reading")),
    hidden: getComputedStyle(d.querySelector(".wkfh-en-text")).visibility,
    toggles: d.querySelectorAll(".wkfh-toggle").length,
    speakers: d.querySelectorAll(".wkfh-speak").length,
  };
});
check("late sentence gets furigana", late.words.includes("買いました=かいました"), late.words.join(" "));
check("late sentence translation hidden with a toggle",
  late.hidden === "hidden" && late.toggles === 1, JSON.stringify(late));
check("late sentence gets an audio button", late.speakers === 1, JSON.stringify(late));

check("no console errors", noise.length === 0, noise.join(" | "));

await ctx.close();
console.log("\n" + (fail.length ? `${fail.length} FAILED:\n - ` + fail.join("\n - ") : "all checks passed"));
process.exit(fail.length ? 1 : 0);
