// map-features-lore.js is a browser file without module.exports (index.html loads it with a
// <script> tag). Same harness shape as powerline-span.test.js: globals, then runInThisContext.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// The containers the module is supposed to find. querySelectorAll gets the real selector
// ('[data-lore-place="<key>"]'), so the stub matches on the key inside it -- that keeps the
// module's own selector under test instead of replacing it with an agreement.
const containers = [];
const makeContainer = (attributes) => {
	const own = Object.assign({}, attributes);
	const element = {
		innerHTML: "",
		getAttribute: (name) => (name in own ? own[name] : null),
		setAttribute: (name, value) => { own[name] = value; },
	};
	containers.push({ element, key: own["data-lore-place"] });
	return element;
};

global.window = {
	location: { search: "" },
	localStorage: { getItem: () => null, setItem() {} },
	setTimeout: (fn) => fn(),
	clearTimeout() {},
};
global.localStorage = global.window.localStorage;
global.document = {
	querySelectorAll: (selector) => containers
		.filter((entry) => selector.indexOf('"' + entry.key + '"') >= 0)
		.map((entry) => entry.element),
	addEventListener() {},
	documentElement: {},
};
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
global.MutationObserver = function () { this.observe = () => {}; };
global.AbortController = function () { this.abort = () => {}; this.signal = null; };

const loreFile = path.join(__dirname, "..", "map-features-lore.js");
vm.runInThisContext(fs.readFileSync(loreFile, "utf8"), { filename: loreFile });

// ---- the key ---------------------------------------------------------------------------------
assert.strictEqual(avesmapsLoreNormalizeKey("darpatien"), "darpatien", "a single key is untouched");
assert.strictEqual(avesmapsLoreNormalizeKey("darpatien,reichsforst"), "darpatien,reichsforst",
	"a comma list survives -- api/app/lore.php has split on commas since it was written");
assert.strictEqual(avesmapsLoreNormalizeKey("darpatien, reichsforst"), "darpatien,reichsforst",
	"blanks around the comma are trimmed");
assert.strictEqual(avesmapsLoreNormalizeKey("Darpatien,REICHSFORST"), "darpatien,reichsforst",
	"lower cased, like before");
assert.strictEqual(avesmapsLoreNormalizeKey("darpatien,,"), "darpatien", "empty parts are dropped");
assert.strictEqual(avesmapsLoreNormalizeKey("darpatien,darpatien"), "darpatien",
	"the same place twice is asked for once");
assert.strictEqual(avesmapsLoreNormalizeKey("darpatien,<script>"), "darpatien",
	"the bad part falls, the good one stays -- one broken name must not silence the whole leg");
assert.strictEqual(avesmapsLoreNormalizeKey("<script>"), "", "nothing usable -> no key, no request");
assert.strictEqual(avesmapsLoreNormalizeKey("wiki:darpatien"), "darpatien",
	"the wiki: prefix is still stripped");
assert.strictEqual(avesmapsLoreNormalizeKey("wiki:darpatien,name:reichsforst"), "darpatien,reichsforst",
	"and it is stripped per part, not only from the first");
assert.strictEqual(avesmapsLoreNormalizeKey(""), "", "empty stays empty");
assert.strictEqual(avesmapsLoreNormalizeKey(null), "", "null stays empty");
assert.strictEqual(avesmapsLoreNormalizeKey("a".repeat(191)), "",
	"the length limit still holds for a single part");

// ---- the row selection -------------------------------------------------------------------------
const data = {
	ok: true,
	total: 3,
	sections: {
		ware: [{ name: "Garether Bier", wiki_url: "", rank: 0 }],
		fauna: [{ name: "Waldwolf", wiki_url: "", rank: 0 }],
		flora: [{ name: "Blautanne", wiki_url: "", rank: 0 }],
	},
	counts: { ware: 1, fauna: 1, flora: 1 },
};

const settlement = makeContainer({ "data-lore-place": "punin" });
avesmapsLoreFillContainers("punin", "Punin", data);
assert.ok(settlement.innerHTML.indexOf("Waren") >= 0,
	"a settlement keeps its goods row -- the leg's choice must not have taken it along");
assert.ok(settlement.innerHTML.indexOf("Fauna") >= 0 && settlement.innerHTML.indexOf("Flora") >= 0,
	"and its fauna and flora");

const leg = makeContainer({ "data-lore-place": "leg-1", "data-lore-kinds": "flora|fauna" });
avesmapsLoreFillContainers("leg-1", "Etappe", data);
assert.strictEqual(leg.innerHTML.indexOf("Waren"), -1,
	'a leg shows no goods row (owner 2026-07-29: "Flora und Fauna is richtig")');
assert.ok(leg.innerHTML.indexOf("Fauna") >= 0 && leg.innerHTML.indexOf("Flora") >= 0,
	"but both of the two it should");
assert.ok(leg.innerHTML.indexOf("Waldwolf") >= 0 && leg.innerHTML.indexOf("Blautanne") >= 0,
	"with their entries, not just the labels");

// The settlement must still be right AFTER the leg was filled -- a module-level list that got
// edited would only show up on the second pass.
avesmapsLoreFillContainers("punin", "Punin", data);
assert.ok(settlement.innerHTML.indexOf("Waren") >= 0,
	"and it is still right after a leg was rendered in between");

// ---- the container carries the choice ------------------------------------------------------------
const markup = buildLoreMarkup({ key: "darpatien,reichsforst", name: "Etappe", kinds: "flora|fauna" });
assert.ok(markup.indexOf('data-lore-fetch="darpatien,reichsforst"') >= 0,
	"the comma list reaches the container, so ONE request covers the whole leg");
assert.ok(markup.indexOf('data-lore-kinds="flora|fauna"') >= 0, "and so does the row choice");
assert.ok(buildLoreMarkup({ key: "punin", name: "Punin" }).indexOf('data-lore-kinds=""') >= 0,
	"a caller that says nothing gets the empty choice, which means: all rows");

console.log("OK: lore comma keys and the per-container row selection");
