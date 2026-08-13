// Landschaftsregion-Infobox (labelWikiInfoboxMarkup, map-features-labels.js): der Aufruf von
// buildLoreMarkup muss die public_id der REGION mitschicken, sonst kann der Server nie eine
// hinterlegte Vorkommen-Regel ("Wald, boreal-gemaessigt") gegen diese Flaeche pruefen.
// ecosystemRegionOfLabel(label) (map-features-ecosystem-region-store.js) liefert das Regionsobjekt --
// dessen public_id ist es, NICHT eine Flaechen-Id. Gleiche vm-Bauart wie lore-place-ref.test.js /
// lore-key.test.js: beide Dateien sind blanke <script>-Globals ohne module.exports.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const loreSource = fs.readFileSync(path.join(__dirname, "..", "map-features-lore.js"), "utf8");
const labelsSource = fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8");

// escapeHtml/tr sind in der echten App laengst geladene Globals (index.html-Reihenfolge); hier
// reichen einfache, aber ECHTE Implementationen -- ein Stub, der immer "" liefert, wuerde jede
// Zeile leer melden und den Test wertlos machen.
function escapeHtmlReal(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Baut einen frischen vm-Kontext, laedt darin ECHT map-features-lore.js (buildLoreMarkup) und
// ECHT map-features-labels.js (labelWikiInfoboxMarkup) -- so prueft der Test das tatsaechlich
// erzeugte data-lore-area-Attribut, nicht eine Behauptung darueber. ecosystemRegionOfLabel kommt
// als Stub herein, weil map-features-ecosystem-region-store.js selbst einen geladenen
// Regionsbestand braucht, den dieser Test nicht aufbauen will.
function makeContext(ecosystemRegionOfLabel) {
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
	};
	if (typeof ecosystemRegionOfLabel === "function") {
		context.ecosystemRegionOfLabel = ecosystemRegionOfLabel;
	}
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(loreSource, context);
	vm.runInContext(labelsSource, context);
	return context;
}

const label = { publicId: "label-1", text: "Finsterkamm", wikiRegion: { wiki_key: "finsterkamm", name: "Finsterkamm" } };

// ---- mit Flaeche: die public_id der REGION landet als area im Container -----------------------
const mitFlaeche = makeContext(() => ({ public_id: "region-42" }));
const markupMitFlaeche = mitFlaeche.labelWikiInfoboxMarkup(label);
assert.ok(markupMitFlaeche.indexOf('data-lore-area="region-42"') >= 0,
	"die von ecosystemRegionOfLabel gelieferte public_id muss im data-lore-area-Attribut ankommen");

// ---- ohne Flaeche (ecosystemRegionOfLabel liefert null, Label ohne Zuordnung): NICHTS aendert sich
const ohneFlaeche = makeContext(() => null);
const markupOhneFlaeche = ohneFlaeche.labelWikiInfoboxMarkup(label);
assert.ok(markupOhneFlaeche.indexOf('data-lore-area=""') >= 0,
	"ohne Flaeche bleibt area leer -- wie vor dieser Aenderung");

// ---- verteidigend: ecosystemRegionOfLabel ist (wie im Bericht gefordert) nicht garantiert geladen.
// Ohne die typeof-Wache wuerfe der bloße Aufruf einen ReferenceError und risse die GANZE Infobox mit.
const ohneFunktion = makeContext(undefined);
assert.strictEqual(typeof ohneFunktion.ecosystemRegionOfLabel, "undefined",
	"Testaufbau: ecosystemRegionOfLabel darf in diesem Kontext gar nicht existieren");
const markupOhneFunktion = ohneFunktion.labelWikiInfoboxMarkup(label);
assert.ok(markupOhneFunktion.indexOf('data-lore-area=""') >= 0,
	"fehlt ecosystemRegionOfLabel als Funktion ganz, bleibt die Infobox unveraendert -- kein Absturz");

// Regression: "ohne Flaeche" und "Funktion fehlt ganz" muessen BYTE-GLEICH sein -- die typeof-Wache
// darf den sichtbaren Zustand nicht veraendern, nur den Absturz verhindern.
assert.strictEqual(markupOhneFlaeche, markupOhneFunktion,
	"null-Rueckgabe und fehlende Funktion muessen dieselbe Infobox ergeben");

console.log("label-lore-area: OK");
