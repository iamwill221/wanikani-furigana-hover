// Replaces kuromoji's XMLHttpRequest dictionary loader with a fetch + native
// DecompressionStream one. Content scripts in MV3 can fetch web_accessible_resources
// reliably; XHR against chrome-extension:// URLs is inconsistent across Chrome versions
// and can trip over the host page's CSP. Re-run after upgrading vendor/kuromoji.js.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "vendor/kuromoji.js";
const NEEDLE = `BrowserDictionaryLoader.prototype.loadArrayBuffer = function (url, callback) {
    var xhr = new XMLHttpRequest();`;

const REPLACEMENT = `BrowserDictionaryLoader.prototype.loadArrayBuffer = function (url, callback) {
    // --- wanikani-furigana-hover patch: fetch instead of XHR (see tools/patch-loader.mjs)
    fetch(url).then(function (res) {
        if (!res.ok) {
            throw new Error("kuromoji dict fetch failed: " + res.status + " " + url);
        }
        if (typeof DecompressionStream === "function" && res.body) {
            var stream = res.body.pipeThrough(new DecompressionStream("gzip"));
            return new Response(stream).arrayBuffer();
        }
        return res.arrayBuffer().then(function (ab) {
            return new zlib.Zlib.Gunzip(new Uint8Array(ab)).decompress().buffer;
        });
    }).then(function (buffer) {
        callback(null, buffer);
    }).catch(function (err) {
        callback(err, null);
    });
};

BrowserDictionaryLoader.prototype.loadArrayBufferViaXhr = function (url, callback) {
    var xhr = new XMLHttpRequest();`;

const src = readFileSync(FILE, "utf8");
if (src.includes("wanikani-furigana-hover patch")) {
  console.log("already patched, nothing to do");
  process.exit(0);
}
if (!src.includes(NEEDLE)) {
  console.error("patch target not found in " + FILE + " - kuromoji internals changed");
  process.exit(1);
}
writeFileSync(FILE, src.replace(NEEDLE, REPLACEMENT));
console.log("patched " + FILE);
