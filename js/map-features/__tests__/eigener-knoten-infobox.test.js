// Ein EIGENER Knoten (political_territory ohne Wiki-Artikel, wiki_key `eigener-knoten:knotenNNN`)
// bekommt dieselbe Infobox wie ein regulaeres Herrschaftsgebiet. Owner 19.08.2026, woertlich:
// „wenn sachen fehlen fehlen sie halt, aber alles wegzulassen ist falsch."
//
// Befund: hasRegionWikiInfo() war ZWEI Dinge gleichzeitig -- die Frage „gibt es einen Wiki-Artikel?"
// UND die Weiche „welche Box wird gebaut?" UND das Tor vor dem Detail-Abruf. Fuer einen eigenen
// Knoten ergab das eine Henne-Ei-Schleife: territory-detail.php haette die gepflegten Felder
// geliefert (live gemessen an Ujak: status/ruler/capital_name/climate_zones), wurde aber nur
// abgerufen, wenn schon Wiki-Info da war -- und die kam nur aus eben diesem Abruf. Ergebnis: die
// schlanke Mini-Box mit Name und Typ, sonst nichts.
//
// Ausfuehren: node js/map-features/__tests__/eigener-knoten-infobox.test.js

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const loreSource = fs.readFileSync(path.join(__dirname, "..", "map-features-lore.js"), "utf8");
const regionInfoSource = fs.readFileSync(path.join(__dirname, "..", "map-features-region-info-markup.js"), "utf8");

function escapeHtmlReal(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function makeContext() {
	const context = {
		console,
		window: {
			location: { search: "" },
			localStorage: { getItem: () => null, setItem() {} },
			setTimeout: (fn) => fn(),
			clearTimeout() {},
		},
		document: undefined,
		fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, sections: {}, counts: {}, total: 0 }) }),
		tr: (key, fallback) => fallback,
		escapeHtml: escapeHtmlReal,
		// Nur fuer die Gegenprobe MIT Wiki-Artikel gebraucht (dort entsteht der Teilen-Knopf).
		sharePlaceActionButtonMarkup: () => "",
		locationPopupActionsMarkup: (knoepfe) => knoepfe.join(""),
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(loreSource, context);
	vm.runInContext(regionInfoSource, context);
	return context;
}

// Ujak, live gemessen 19.08.2026: political_territory mit wiki_key „eigener-knoten:knoten098",
// ohne wiki_id/wiki_url/wiki_name, ohne founded/dissolved -- also KEIN einziges der Felder, an
// denen hasRegionWikiInfo haengt.
const eigenerKnoten = {
	source: "political_territory",
	publicId: "geom-ujak",
	territoryPublicId: "6bd01daa-dae5-4033-86b1-666e9b7c6be0",
	name: "Ujak",
	displayName: "Ujak",
	type: "Herrschaftsgebiet",
};

// ---- 1) Die volle Infobox, nicht die Mini-Box --------------------------------------------------
const ohneDetail = makeContext();
assert.ok(!ohneDetail.hasRegionWikiInfo(eigenerKnoten),
	"Vorbedingung: dieser Knoten traegt wirklich keine Wiki-Info -- sonst prueft der Test nichts");

const markupOhneDetail = ohneDetail.createRegionCompactTooltipMarkup(eigenerKnoten);
assert.ok(markupOhneDetail.indexOf('class="region-info-box"') >= 0,
	"ein eigener Knoten bekommt die volle Infobox: " + markupOhneDetail);
assert.ok(markupOhneDetail.indexOf("region-compact-tooltip__content") < 0,
	"und nicht mehr die schlanke Mini-Box: " + markupOhneDetail);

// ---- 2) Die nachgereichten Felder stehen drin, die Wiki-Zeile nicht ----------------------------
// Genau die Antwort, die territory-detail.php fuer Ujak liefert.
const mitDetail = makeContext();
const knotenMitDetail = Object.assign({}, eigenerKnoten, {
	detail: {
		ok: true,
		wiki_key: "eigener-knoten:knoten098",
		fields: { name: "Ujak", status: "Klosterfreiheit", capital_name: "Kloster Ujak", ruler: "Nottel" },
		coat: { url: "", license_status: "", author: "", attribution: "", allowed: false },
	},
});
const markupMitDetail = mitDetail.createRegionCompactTooltipMarkup(knotenMitDetail);

assert.ok(/<dt>Oberhaupt<\/dt>\s*<dd>Nottel<\/dd>/.test(markupMitDetail),
	"das gepflegte Oberhaupt steht in der Box: " + markupMitDetail);
assert.ok(/<dt>Status<\/dt>\s*<dd>Klosterfreiheit<\/dd>/.test(markupMitDetail),
	"der gepflegte Status steht in der Box: " + markupMitDetail);
assert.ok(/<dt>Hauptstadt<\/dt>\s*<dd>Kloster Ujak<\/dd>/.test(markupMitDetail),
	"die gepflegte Hauptstadt steht in der Box: " + markupMitDetail);

// 💣 Ohne Wiki-Artikel ist „Wiki-Eintrag" keine fehlende Angabe, sondern eine FALSCHE: die Zeile
// fiel bisher auf den eigenen Namen zurueck (wikiName || f.name || name) und behauptete damit einen
// Wiki-Eintrag, den es nicht gibt -- den Namen sagt der Kopf der Box ohnehin schon.
assert.ok(markupMitDetail.indexOf("<dt>Wiki-Eintrag</dt>") < 0,
	"ohne Wiki-Artikel entfaellt die Zeile „Wiki-Eintrag\" ganz: " + markupMitDetail);

// Gegenprobe: ein regulaeres Gebiet MIT Wiki-Artikel behaelt sie.
const mitWiki = makeContext();
const markupMitWiki = mitWiki.createRegionCompactTooltipMarkup(Object.assign({}, eigenerKnoten, {
	wikiName: "Fuerstentum Kosch",
	wikiUrl: "https://de.wiki-aventurica.de/wiki/F%C3%BCrstentum_Kosch",
}));
assert.ok(/<dt>Wiki-Eintrag<\/dt>\s*<dd>Fuerstentum Kosch<\/dd>/.test(markupMitWiki),
	"mit Wiki-Artikel bleibt die Zeile stehen: " + markupMitWiki);

// ---- 3) Regression: eine Landschaftsregion ohne Wiki bleibt bei der Mini-Box -------------------
// Die Weiche gilt dem politischen Territorium, nicht jeder Flaeche -- source „map_feature" ist der
// Diskriminator, den normalizeRegionFeature ohnehin schon setzt.
const landschaft = makeContext();
const markupLandschaft = landschaft.createRegionCompactTooltipMarkup({
	source: "map_feature",
	publicId: "regio-1",
	name: "Kosch",
	displayName: "Kosch",
	type: "Landschaft",
});
assert.ok(markupLandschaft.indexOf("region-compact-tooltip__content") >= 0,
	"eine Landschaftsregion ohne Wiki bleibt unveraendert bei der Mini-Box: " + markupLandschaft);
assert.ok(markupLandschaft.indexOf('class="region-info-box"') < 0,
	"und bekommt keine volle Infobox: " + markupLandschaft);

// ---- 4) Verdrahtung: der Detail-Abruf haengt an derselben Weiche -------------------------------
// 💣 Ohne das ist die Box zwar da, aber leer: Oberhaupt, Hauptstadt und Klimazone kommen
// AUSSCHLIESSLICH aus territory-detail.php. Eine Box, die auf die Weiche hoert, waehrend das Tor
// vor dem Abruf weiter hasRegionWikiInfo fragt, ist genau der Zustand vor dieser Aenderung --
// nur mit anderem Rahmen drumherum.
const ohneKommentare = (quelltext) => quelltext
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const lies = (...teile) => ohneKommentare(fs.readFileSync(path.join(ROOT, ...teile), "utf8"));

const infopanel = lies("js", "map-features", "map-features-infopanel.js");
const needsDetailZeile = infopanel.slice(infopanel.indexOf("var needsDetail"), infopanel.indexOf("if (needsDetail)"));
assert.ok(needsDetailZeile.length > 0, "die needsDetail-Weiche steht noch im Infopanel");
assert.ok(/regionShowsFullInfoBox/.test(needsDetailZeile),
	"das Infopanel holt die Detailfelder fuer alles, was die volle Box zeigt: " + needsDetailZeile);
assert.ok(!/hasRegionWikiInfo/.test(needsDetailZeile),
	"und nicht mehr nur fuer Gebiete, die schon Wiki-Info tragen: " + needsDetailZeile);

const tooltipLifecycle = lies("js", "map-features", "map-features-region-tooltip-lifecycle.js");
const enrich = tooltipLifecycle.slice(tooltipLifecycle.indexOf("function enrichRegionTooltipWithWikiDetail"));
assert.ok(/regionShowsFullInfoBox/.test(enrich.slice(0, 400)),
	"und der Klick-Tooltip (Nicht-Panel-Modus) fragt dieselbe Weiche: " + enrich.slice(0, 400));

console.log("eigener-knoten-infobox: OK");
