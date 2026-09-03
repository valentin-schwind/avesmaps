// Der Client-Zwischenspeicher der Quellen traegt den KORPUSSCHLUESSEL -- und die Infobox stellt danach
// weiter den Korpusnamen vorn, ohne Neuladen.
//
// 💣 DER BEFUND (Owner 03.09.2026, „wenn ich in 'Ort bearbeiten' speicher steht noch der titel - nicht der
// korpus - im frontend […] wenn ich die seite aktualisiere stimmts"): syncFeatureSourcesToClientCache
// schrieb url/label/official/type/license/attribution in `__sourceCatalog` -- aber kein `corpus`. Die
// Infobox (js/ui/popups.js: resolveFeatureSourceList kopiert `source.corpus`, feature-source-markup.js:
// `corpora[s.corpus]`) fand damit keinen Korpus mehr und zeigte den Titel („Apfeldorn") statt des
// Korpusnamens („AlberniaWiki"). Es brauchte nicht einmal ein Speichern: schon das Oeffnen des Quellen-
// Editors schreibt seine Liste in den Zwischenspeicher. Dieselbe Klasse wie Lizenz und Namensnennung
// davor (der Kommentar im Schreiber warnt seit dem 28.08. genau davor) -- die Nutzlast traegt `corpus`
// als SCHLUESSEL, die Editor-Liste als OBJEKT (`corpus.corpus_key`), und der Schreiber muss uebersetzen.
//
// Ausgefuehrt, nicht gelesen: die echte Sync-Funktion, der echte Leser aus popups.js (ausgeschnitten)
// und der echte Zeilenbauer der Infobox.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-korpus-im-client-cache.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");

// resolveFeatureSourceList aus popups.js ausschneiden -- die Funktion, die die Infobox mit Zeilen versorgt.
function ausschnitt(quelle, name) {
	const start = quelle.indexOf("function " + name + "(");
	assert.ok(start >= 0, name + " steht in popups.js");
	const ende = quelle.indexOf("\n}\n", start);
	return quelle.slice(start, ende + 3);
}

function macheKontext(corpora) {
	const context = { console, window: null, globalThis: null, module: undefined, require: undefined, document: { createElement: () => ({ style: {} }) }, tr: (k, f) => f };
	context.window = context; context.globalThis = context;
	context.__sourceCorpora = corpora;
	vm.createContext(context);
	vm.runInContext(lies("js/ui/feature-source-markup.js"), context);
	vm.runInContext(lies("js/review/review-feature-sources.js"), context);
	vm.runInContext(ausschnitt(lies("js/ui/popups.js"), "resolveFeatureSourceList"), context);
	return context;
}

// Die Zeile, wie sie der Editor-Endpunkt liefert (avesmapsListFeatureSourcesForEdit): corpus als OBJEKT.
const ZEILE = { source_id: 4711, url: "https://www.westlande.de/albernia/index.php?title=Apfeldorn", label: "Apfeldorn", type: "briefspiel", official: false, origin: "manual",
	pages: "", reference_kind: "", license: "cc-by-sa-4.0", attribution: "",
	corpus: { corpus_key: "westlande.de", label: "AlberniaWiki", known: true, form: "belegstelle", source_type: "briefspiel", license: "cc-by-sa-4.0", attribution: "", is_official: false, sources: 12, objects: 30 } };
const WERK = { source_id: 4712, url: "https://ulisses-ebooks.de/product/1", label: "Geographia Aventurica", type: "regionalspielhilfe", official: true, origin: "wiki_publication", pages: "88", reference_kind: "erwaehnung", license: "", attribution: "", corpus: null };

// ---- 1. Die Nutzlast kannte den Korpus: der Eintrag traegt den Schluessel, die Infobox den Korpusnamen -----
{
	const ctx = macheKontext({ "westlande.de": { label: "AlberniaWiki", form: "belegstelle" } });
	ctx.syncFeatureSourcesToClientCache("settlement", "ort-1", [ZEILE, WERK]);
	assert.strictEqual(ctx.__sourceCatalog[4711].corpus, "westlande.de", "der Zwischenspeicher-Eintrag traegt den Korpusschluessel (Nutzlast-Form: Schluessel, nicht Objekt)");
	assert.strictEqual(ctx.__sourceCatalog[4712].corpus, "", "eine Zeile ohne Korpus traegt einen leeren Schluessel");
	assert.strictEqual(ctx.__sourceCatalog[4711].license, "cc-by-sa-4.0", "… Lizenz weiter dabei");
	const zeilen = ctx.resolveFeatureSourceList("settlement", "ort-1");
	assert.strictEqual(zeilen.length, 2, "der Leser der Infobox findet beide Verweise");
	assert.strictEqual(zeilen[0].corpus, "westlande.de", "… und reicht den Schluessel durch");
	const html = ctx.buildSourceListMarkup("", zeilen, { corpora: ctx.__sourceCorpora });
	assert.ok(html.includes("AlberniaWiki"), "die Infobox stellt den KORPUSNAMEN vorn: " + html.slice(0, 300));
	assert.ok(!/fs-src-title[^<]*<a[^>]*>Apfeldorn/.test(html), "… nicht den Titel „Apfeldorn“ als Namen der Zeile");
	assert.ok(html.includes("Geographia Aventurica"), "das Werk behaelt seinen Titel vorn");
}

// ---- 2. Die Nutzlast kannte den Korpus NICHT (in dieser Sitzung angelegt): der Sync lehrt das Woerterbuch ---
{
	const ctx = macheKontext({});
	ctx.syncFeatureSourcesToClientCache("settlement", "ort-1", [ZEILE]);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.__sourceCorpora["westlande.de"])), { label: "AlberniaWiki", form: "belegstelle", source_type: "briefspiel", license: "cc-by-sa-4.0", attribution: "", is_official: false },
		"das Korpora-Woerterbuch des Fensters lernt den Korpus aus der Editor-Zeile");
	const html = ctx.buildSourceListMarkup("", ctx.resolveFeatureSourceList("settlement", "ort-1"), { corpora: ctx.__sourceCorpora });
	assert.ok(html.includes("AlberniaWiki"), "… und die Infobox zeigt ihn sofort: " + html.slice(0, 300));
}

// ---- 3. Ein unbekannter Wirt (known=false) ueberschreibt keinen bekannten Korpus, bleibt aber Titel vorn -----
{
	const ctx = macheKontext({ "westlande.de": { label: "AlberniaWiki", form: "belegstelle" } });
	const fremd = Object.assign({}, ZEILE, { corpus: { corpus_key: "westlande.de", label: "westlande.de", known: false, form: "" } });
	ctx.syncFeatureSourcesToClientCache("settlement", "ort-1", [fremd]);
	assert.strictEqual(ctx.__sourceCorpora["westlande.de"].label, "AlberniaWiki", "ein Platzhalter (known=false) ueberschreibt den bekannten Korpus nicht");
	const ctx2 = macheKontext({});
	ctx2.syncFeatureSourcesToClientCache("settlement", "ort-1", [fremd]);
	assert.strictEqual(ctx2.__sourceCorpora["westlande.de"].form, "", "… ohne Woerterbuch wird er als Platzhalter eingetragen (form leer)");
	const html = ctx2.buildSourceListMarkup("", ctx2.resolveFeatureSourceList("settlement", "ort-1"), { corpora: ctx2.__sourceCorpora });
	assert.ok(/Apfeldorn/.test(html) && !/>westlande\.de </.test(html), "… und die Infobox zeigt den Titel, nie den blossen Schluessel als Namen");
}

// ---- 4. Der Verteiler-Weg (by_entity) traegt denselben Schluessel ------------------------------------------------
{
	const ctx = macheKontext({});
	ctx.syncFeatureSourcesToClientCache("path", "seg-1", [ZEILE], { "seg-1": [{ source_id: 4711, pages: "3", reference_kind: "" }], "seg-2": [{ source_id: 4711, pages: "", reference_kind: "" }] });
	assert.strictEqual(ctx.__sourceCatalog[4711].corpus, "westlande.de", "auch ueber by_entity kommt der Schluessel in den Katalog");
	assert.strictEqual(ctx.resolveFeatureSourceList("path", "seg-2")[0].corpus, "westlande.de", "… und jede Kennung liest ihn");
}

console.log("quellen-korpus-im-client-cache: alle Zusicherungen erfuellt");
