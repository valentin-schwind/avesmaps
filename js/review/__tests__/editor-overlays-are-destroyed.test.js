const assert = require("assert");
const fs = require("fs");
const path = require("path");

// ===== THE RULE UNDER TEST =====
// An editor overlay carries an IFRAME. Hiding it instead of removing it keeps that iframe alive --
// with its state, its timers and its requests to the server. Two findings came out of that one habit:
//   * A17: an adventure created in the editor was missing from the list on re-open, because the same
//     page instance was shown again with its old in-memory list -- "0 von 1352" while the endpoint
//     answered 1353, and only F5 cleared it. The form says "save first, then assign places", which
//     that made impossible.
//   * A18: the windows stacked. At the end of a test run: three dead editors behind zero visible
//     windows, each with its own state, its own timers and its own polling.
// The `?v=" + Date.now()` in the iframe path looked like a cache-bust but only ever applied to the
// FIRST open.
//
// This test is written against the DIRECTORY, not against a list of files, so an editor added
// tomorrow is covered without anyone remembering to add it here.

const reviewDir = path.join(__dirname, "..");
const files = fs.readdirSync(reviewDir).filter((name) => name.endsWith(".js"));
assert.ok(files.length > 5, "the review directory is readable and non-trivial");

const iframeHosts = files.filter((name) =>
	fs.readFileSync(path.join(reviewDir, name), "utf8").includes('createElement("iframe")')
);
assert.ok(
	iframeHosts.length >= 5,
	`expected the known iframe-bearing overlay hosts, found ${iframeHosts.length}: ${iframeHosts.join(", ")}`
);

const offenders = [];
iframeHosts.forEach((name) => {
	const source = fs.readFileSync(path.join(reviewDir, name), "utf8");
	// Every `overlay.hidden = true` inside a file that builds an iframe overlay is the old habit.
	// A plain dialog (no iframe) may hide itself -- those files are simply not in this list.
	const hides = (source.match(/overlay\.hidden\s*=\s*true/g) || []).length;
	const removes = (source.match(/overlay\.remove\(\)/g) || []).length;
	const frames = (source.match(/createElement\("iframe"\)/g) || []).length;
	if (removes < frames) {
		offenders.push(`${name}: ${frames} iframe overlay(s) but only ${removes} remove() -- ${hides} still hide`);
	}
});
assert.deepStrictEqual(
	offenders,
	[],
	"every overlay that builds an iframe must destroy it on close, not hide it:\n  " + offenders.join("\n  ")
);

// 💣 The one file that carries BOTH kinds: review-wiki-sync.js builds the sync editor (iframe) and a
// credentials prompt (plain dialog). The prompt may hide; the editor may not. Asserted by counting
// rather than by naming lines, so moving either one does not silently disable the check.
const wikiSync = fs.readFileSync(path.join(reviewDir, "review-wiki-sync.js"), "utf8");
assert.strictEqual(
	(wikiSync.match(/createElement\("iframe"\)/g) || []).length,
	(wikiSync.match(/overlay\.remove\(\)/g) || []).length,
	"the sync editor destroys its overlay"
);
assert.ok(
	/overlay\.hidden\s*=\s*true/.test(wikiSync),
	"while the credentials prompt, which has no iframe, still merely hides -- that is correct and this "
		+ "assert exists so the two are not conflated by a blanket search-and-replace"
);

// The close handler must still release the scroll lock: removing the overlay does not undo a style set
// on document.body, and a page that cannot scroll after closing an editor is worse than a stale list.
iframeHosts.forEach((name) => {
	const source = fs.readFileSync(path.join(reviewDir, name), "utf8");
	const closers = source.match(/overlay\.remove\(\);[\s\S]{0,120}/g) || [];
	closers.forEach((chunk) => {
		assert.ok(
			/document\.body\.style\.overflow\s*=\s*""/.test(chunk),
			`${name}: every overlay.remove() releases the body scroll lock right after it`
		);
	});
});

console.log(`editor-overlays-are-destroyed ok (${iframeHosts.length} hosts checked)`);
