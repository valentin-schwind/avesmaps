const assert = require("assert");
const {
	buildLandscapeLine,
	formatLandscapesForInfobox,
	formatLandscapesForPlanner,
	formatLandscapesForMapLinks,
	landscapeWikiKeyList,
} = require("../map-features-path-landscapes.js");

const near = (actual, expected, why) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, why + " -- erwartet " + expected + ", bekommen " + actual);

// A payload in the exact shape api/app/path-landscapes.php answers with.
const payload = {
	landscapes: {
		"r-weiden": { name: "Weiden", art: "Region", kind: "derographisch", wiki_key: "weiden" },
		"r-finsterkamm": { name: "Finsterkamm", art: "Gebirge", kind: "topographie", wiki_key: "finsterkamm" },
		"r-see-a": { name: "See-042", art: "See", kind: "topographie", wiki_key: "" },
		"r-see-b": { name: "See-107", art: "See", kind: "topographie", wiki_key: "" },
		"r-nameless": { name: "Fläche-011", art: "", kind: "derographisch", wiki_key: "" },
	},
	paths: {
		"p-1": { length: 10, in: [["r-weiden", 10], ["r-finsterkamm", 8.4]] },
		"p-2": { length: 10, in: [["r-weiden", 0.4]] },
		"p-3": { length: 10, in: [["r-see-a", 3], ["r-see-b", 2]] },
		"p-4": { length: 10, in: [["r-nameless", 10]] },
		"p-5": { length: 10, in: [["r-weiden", 10.0004]] },
		"p-6": { length: 0, in: [["r-weiden", 0]] },
		"p-7": { length: 10, in: [["r-gone", 5]] },
		"p-8": { length: 30, in: [["r-finsterkamm", 30]] },
	},
};

// ---- the builder --------------------------------------------------------------------------
let line = buildLandscapeLine(["p-1"], payload);
assert.strictEqual(line.length, 2, "both landscapes of this way");
assert.strictEqual(line[0].name, "Weiden", "the bigger share leads");
near(line[0].share, 1, "the whole way lies in Weiden");
near(line[1].share, 0.84, "and 84 % of it in the Finsterkamm");
assert.strictEqual(line[1].art, "Gebirge", "the kind travels along, for the tooltip");

assert.deepStrictEqual(buildLandscapeLine(["p-2"], payload), [],
	"4 % is below the threshold -- 274 of 3.995 measured hits look like this");

line = buildLandscapeLine(["p-3"], payload);
assert.strictEqual(line.length, 1, "two nameless lakes are ONE entry, not 'See · See'");
assert.strictEqual(line[0].name, "See", "an auto name shows its kind -- the house rule");
near(line[0].share, 0.5, "and their covered lengths add up");

assert.deepStrictEqual(buildLandscapeLine(["p-4"], payload), [],
	"neither a name nor a kind -- there is literally nothing to print");

line = buildLandscapeLine(["p-5"], payload);
near(line[0].share, 1, "rounding may push the sum past the length; the share is capped at 1");

assert.deepStrictEqual(buildLandscapeLine(["p-6"], payload), [],
	"a way of length zero yields no share, and no division by zero");
assert.deepStrictEqual(buildLandscapeLine(["p-7"], payload), [],
	"a region missing from the catalogue is skipped, not crashed on");
assert.deepStrictEqual(buildLandscapeLine(["p-unknown"], payload), [],
	"a way we know nothing about is an empty line, not an error");
assert.deepStrictEqual(buildLandscapeLine([], payload), [], "no ways, no line");
assert.deepStrictEqual(buildLandscapeLine(["p-1"], null), [], "no payload, no line");

// Several ways -- a route, or a water leg made of several ways. Weighted by LENGTH.
line = buildLandscapeLine(["p-1", "p-8"], payload);
assert.strictEqual(line[0].name, "Finsterkamm",
	"8.4 + 30 of 40 beats 10 of 40 -- the longer way carries more weight");
near(line[0].share, 38.4 / 40, "share of the WHOLE distance, not the average of two shares");
near(line[1].share, 10 / 40, "and Weiden covers a quarter of it");

// ---- the writers --------------------------------------------------------------------------
assert.strictEqual(
	formatLandscapesForInfobox(buildLandscapeLine(["p-1"], payload)),
	"Weiden · Finsterkamm (84 %)",
	"100 % carries no number -- it is the median case and would say nothing"
);
assert.strictEqual(
	formatLandscapesForInfobox([{ name: "Weiden", share: 0.93 }]),
	"Weiden",
	"0,93 is still 'the whole leg' -- the 90 % rule"
);
assert.strictEqual(
	formatLandscapesForInfobox([{ name: "Weiden", share: 0.895 }]),
	"Weiden (90 %)",
	"just under the rule the number returns, rounded"
);
assert.strictEqual(formatLandscapesForInfobox([]), "", "an empty line is empty, not 'keine'");

assert.strictEqual(
	formatLandscapesForPlanner(buildLandscapeLine(["p-1"], payload)),
	"Weiden, Finsterkamm",
	"the planner never prints a percentage and never an article"
);
assert.strictEqual(formatLandscapesForPlanner([]), "", "nothing to say, nothing printed");

// ---- the wiki link ----------------------------------------------------------------------------
// 💣 Escaping is NOT a URL check. „javascript:alert(1)" carries no HTML metacharacter, sails
// through any escaper and fires on click. Only a Wiki-Aventurica address may become an href --
// and every name here comes from the wiki, i.e. from foreign content.
const linked = {
	landscapes: {
		"r-ok": { name: "Weiden", art: "Region", wiki_key: "weiden", wiki_url: "https://de.wiki-aventurica.de/wiki/Weiden" },
		"r-js": { name: "Böse", art: "Region", wiki_key: "boese", wiki_url: "javascript:alert(1)" },
		"r-ext": { name: "Fremd", art: "Region", wiki_key: "fremd", wiki_url: "https://evil.example/x" },
		"r-none": { name: "Ohne", art: "Region", wiki_key: "ohne", wiki_url: "" },
		"r-tag": { name: '<img src=x onerror=alert(1)>', art: "Region", wiki_key: "t", wiki_url: "https://de.wiki-aventurica.de/wiki/T" },
	},
	paths: {
		"w-ok": { length: 10, in: [["r-ok", 10]] },
		"w-js": { length: 10, in: [["r-js", 10]] },
		"w-ext": { length: 10, in: [["r-ext", 10]] },
		"w-none": { length: 10, in: [["r-none", 10]] },
		"w-tag": { length: 10, in: [["r-tag", 10]] },
	},
};

assert.strictEqual(
	formatLandscapesForPlanner(buildLandscapeLine(["w-ok"], linked)),
	'<a class="avesmaps-landscape__link" href="https://de.wiki-aventurica.de/wiki/Weiden" target="_blank" rel="noopener">Weiden&#160;↗</a>',
	"ein Wiki-Link mit ↗ -- off-site, also traegt er den Pfeil (AGENTS.md §12)"
);
// 💣 Geschuetztes Leerzeichen vor dem Pfeil, kein gewoehnliches (Owner 2026-07-29): sonst bricht die
// Liste zwischen dem letzten Wort und dem ↗ um und eine Zeile beginnt mit einem nackten „↗,".
assert.ok(
	formatLandscapesForPlanner(buildLandscapeLine(["w-ok"], linked)).indexOf(" ↗") < 0,
	"der Pfeil haengt am Wort, nicht hinter einem umbruchfaehigen Leerzeichen"
);
assert.strictEqual(formatLandscapesForPlanner(buildLandscapeLine(["w-js"], linked)), "Böse",
	"javascript: wird NIE ein href -- der Name bleibt blanker Text");
assert.strictEqual(formatLandscapesForPlanner(buildLandscapeLine(["w-ext"], linked)), "Fremd",
	"eine fremde Adresse auch nicht: nur das Wiki-Präfix wird verlinkt");
assert.strictEqual(formatLandscapesForPlanner(buildLandscapeLine(["w-none"], linked)), "Ohne",
	"ohne Adresse bleibt es Text -- 61 der 177 Regionen haben keinen Wiki-Eintrag");
assert.ok(
	formatLandscapesForPlanner(buildLandscapeLine(["w-tag"], linked)).indexOf("<img") < 0,
	"ein Name mit HTML wird escapt, nicht gerendert"
);
assert.ok(
	formatLandscapesForInfobox(buildLandscapeLine(["w-ok"], linked)).indexOf("avesmaps-landscape__link") >= 0,
	"die Infobox verlinkt denselben Namen -- er darf nicht in einer Fläche Link sein und in der anderen nicht"
);
// Der Anteil bleibt AUSSERHALB des Links: „Weiden ↗ (68 %)", nicht „Weiden (68 %) ↗".
const teil = buildLandscapeLine(["w-ok"], linked);
teil[0].share = 0.68;
const teilMarkup = formatLandscapesForInfobox(teil);
assert.ok(teilMarkup.endsWith("</a> (68 %)"),
	"der Prozentsatz steht hinter dem Link, nicht darin -- bekam: " + teilMarkup);

// ---- the leg row links to OUR map, not the wiki ------------------------------------------------
// Owner 2026-07-29: „bei ‚durch …' nicht der Link zum Wiki sondern auf die Region auf unserer Karte".
const alleVerlinkbar = () => true;
const keineVerlinkbar = () => false;
assert.strictEqual(
	formatLandscapesForMapLinks(buildLandscapeLine(["w-ok"], linked), null, alleVerlinkbar),
	'<button type="button" class="avesmaps-landscape__maplink" data-landscape-region="r-ok">Weiden</button>',
	"ein Knopf auf die eigene Karte, kein <a> ins Wiki"
);
assert.ok(
	formatLandscapesForMapLinks(buildLandscapeLine(["w-ok"], linked), null, alleVerlinkbar).indexOf("↗") < 0,
	"KEIN Pfeil: der markiert den Absprung nach draussen, und hier bleibt man im Haus"
);
assert.strictEqual(
	formatLandscapesForMapLinks(buildLandscapeLine(["w-ok"], linked), null, keineVerlinkbar),
	"Weiden",
	"ohne Beschriftung auf der Karte bleibt der Name Text -- kein Knopf, der nirgends hinfuehrt"
);
assert.strictEqual(
	formatLandscapesForMapLinks(buildLandscapeLine(["w-ok"], linked)),
	"Weiden",
	"ohne Nachschlag gar keine Verlinkung (der Node-Test laedt die Karte nicht)"
);
// Auch hier ist der Name FREMDINHALT -- er wird escapt, nicht gerendert, im Text wie im Attribut.
assert.ok(
	formatLandscapesForMapLinks(buildLandscapeLine(["w-tag"], linked), null, alleVerlinkbar).indexOf("<img") < 0,
	"ein Name mit HTML wird auch als Kartenlink escapt"
);
assert.strictEqual(
	formatLandscapesForMapLinks(buildLandscapeLine(["w-ok", "w-none"], linked), null, alleVerlinkbar).indexOf(", ") > 0,
	true,
	"mehrere Landschaften bleiben eine Komma-Liste wie im Planer-Ton"
);

// ---- every leg names its own, in full ---------------------------------------------------------
// pickFreshLandscapes(list, previousList) used to live here and suppressed whatever the row above had
// already said; the owner withdrew that on 2026-07-29 (an empty row reads as „nothing known", not as
// „unchanged"). What is left to assert is that a line does NOT depend on any predecessor: the same
// ways must always produce the same list, so two neighbouring legs on one road both name it.
const zweimalDieselbenWege = ["p-1", "p-2"];
assert.deepStrictEqual(
	buildLandscapeLine(zweimalDieselbenWege, payload).map((e) => e.name),
	buildLandscapeLine(zweimalDieselbenWege, payload).map((e) => e.name),
	"a leg's line is a pure function of its ways -- no memory of the leg before it"
);
assert.ok(
	buildLandscapeLine(["p-1"], payload).length > 0
	&& buildLandscapeLine(["p-1"], payload).length > 0,
	"asking twice in a row never yields an empty second answer (that was the suppression's job)"
);

// ---- the lore key ---------------------------------------------------------------------------
assert.strictEqual(landscapeWikiKeyList(buildLandscapeLine(["p-1"], payload)), "weiden,finsterkamm",
	"one comma list -> ONE lore request for the whole leg");
assert.strictEqual(landscapeWikiKeyList(buildLandscapeLine(["p-3"], payload)), "",
	"a landscape without a wiki key contributes nothing");

console.log("OK: path-landscapes builder, writers and the per-leg independence");

// ---- Klimazonen gehoeren nicht in „fuehrt durch" (2026-08-03) -------------------------------------
// Seit die sieben Klimabaender gewoehnliche ecosystem_area-Zeilen sind, faellt JEDER Weg beim
// Zugehoerigkeitslauf in genau eines. Ohne den Filter naehme die Aufzaehlung eine Rechengroesse
// zwischen zwei Orte auf: „durch Darpatien, Sichelhag, Gemaessigte Zone".
(function klimaBleibtDraussen() {
	const payload = {
		landscapes: {
			"a": { name: "Darpatien", kind: "derographisch", art: "Provinz" },
			"b": { name: "Gemäßigte Zone", kind: "klima", art: "Gemäßigte Zone" },
			"c": { name: "Sichelhag", kind: "vegetation", art: "Wald" },
		},
		paths: { "p1": { length: 10, in: [["a", 10], ["b", 10], ["c", 4]] } },
	};
	const line = buildLandscapeLine(["p1"], payload);
	const names = line.map((entry) => entry.name);
	assert(names.includes("Darpatien"), "die Provinz bleibt");
	assert(names.includes("Sichelhag"), "der Wald bleibt");
	assert(!names.includes("Gemäßigte Zone"), "💣 die Klimazone nicht -- sie ist keine Landschaft, durch die man reist");
	assert(line.length === 2, "genau zwei Eintraege, nicht drei");
})();

console.log("OK: Klimazonen bleiben aus der Landschaftszeile draussen");
