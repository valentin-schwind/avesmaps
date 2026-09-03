// Die Quelle einer Meldung: der Link ist die Quelle -- und beide Community-Formulare rufen dieselbe Regel.
//
// Entwurf docs/superpowers/specs/2026-09-03-quellen-meldeformular-design.md §2, §3. Owner 03.09.2026:
// „sowohl änderungen als auch neue vorschläge müssen das mit dem link machen … die sollen einfach den link
// pasten“; die Abdeckung „kann man dem melder anbieten (optional, genau wie seite, lizenz …)“; der Satz
// „Kennen wir schon“ beim Melder: „nein, verwirrt nur“.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/meldung-quellen.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const M = require(path.join(WURZEL, "js/review/meldung-quellen.js"));

// ---- 1. Die Regel, ausgefuehrt ------------------------------------------------------------------------------
{
	const aus = M.avesmapsMeldungQuelleAusEingabe;
	// Der Link ist die Quelle.
	let e = aus({ ref: " https://wiki.punin.de/Baronie_Bitterbusch ", pages: "12" });
	assert.strictEqual(e.ok, true, "ein Link ist eine Quelle");
	assert.deepStrictEqual(e.quelle, { source_id: 0, url: "https://wiki.punin.de/Baronie_Bitterbusch", label: "", pages: "12", reference_kind: "", license: "", attribution: "" },
		"… mit Seite, ohne Art, ohne offiziell: " + JSON.stringify(e.quelle));
	// Der Treffer aus dem Katalog ist eine Quelle, auch ohne Link.
	e = aus({ ref: "Die Flusslande", source_id: 812, pick_label: "Die Flusslande", pages: "40-41" });
	assert.strictEqual(e.ok, true, "ein Katalogtreffer ist eine Quelle");
	assert.deepStrictEqual([e.quelle.source_id, e.quelle.url, e.quelle.label], [812, "", "Die Flusslande"], "… per Kennung, ohne Adresse");
	// Ein Titel ohne Treffer ist keine Quelle -- die Absage ist benannt.
	e = aus({ ref: "Die Flusslande" });
	assert.deepStrictEqual(e, { ok: false, grund: "kein_link" }, "ein Titel ohne Treffer wird abgelehnt");
	e = aus({ ref: "Die Flusslande", source_id: 812, pick_label: "Die Flusslande (alt)" });
	assert.strictEqual(e.ok, false, "weitertippen nach dem Treffer nimmt die Zeile zurueck -- der Titel passt nicht mehr zum Treffer");
	assert.deepStrictEqual(aus({ ref: "" }), { ok: false, grund: "leer" }, "nichts eingegeben: leer");
	assert.deepStrictEqual(aus({}), { ok: false, grund: "leer" }, "gar nichts: leer, kein Wurf");
	assert.strictEqual(aus({ ref: "ftp://x/y" }).ok, false, "nur http(s) ist ein Link");
	assert.strictEqual(aus({ ref: "https://x/y z" }).ok, false, "eine Adresse mit Leerzeichen ist keine");
	// Die Angebote reisen mit -- und nur die Angebote: Art und offiziell gibt es hier nicht.
	e = aus({ ref: "https://x/y", title: " Baronie Hirschfurten ", reference_kind: "erwaehnung", license: "cc-by-sa-4.0", attribution: "VolkoV", type: "abenteuer", official: true });
	assert.deepStrictEqual(e.quelle, { source_id: 0, url: "https://x/y", label: "Baronie Hirschfurten", pages: "", reference_kind: "erwaehnung", license: "cc-by-sa-4.0", attribution: "VolkoV" },
		"Titel, Abdeckung, Lizenz, Namensnennung als Angebote; `type` und `official` fallen weg: " + JSON.stringify(e.quelle));
	assert.strictEqual(aus({ ref: "https://x/y", reference_kind: "wichtig" }).quelle.reference_kind, "", "eine unbekannte Abdeckung faellt auf leer");
	assert.strictEqual(aus({ ref: "https://x/y", title: "a".repeat(300) }).quelle.label.length, 200, "der Titel ist auf 200 gekappt");
	assert.strictEqual(M.avesmapsMeldungQuelleIstLink("HTTPS://X.de/a"), true, "Gross-/Kleinschreibung egal");
}

// ---- 2. Die Anzeige in der Liste des Melders ----------------------------------------------------------------
{
	const a = M.avesmapsMeldungQuelleAnzeige;
	assert.deepStrictEqual(a({ url: "https://www.garetien.de/index.php/Baronie_Hirschfurten", pages: "12" }),
		{ text: "garetien.de/index.php/Baronie_Hirschfurten", url: "https://www.garetien.de/index.php/Baronie_Hirschfurten", ausKatalog: false, pages: "12" },
		"ohne Titel zeigt die Zeile die Adresse ohne Schema und www");
	assert.deepStrictEqual(a({ url: "https://x/y", label: "Titel vom Melder" }).text, "Titel vom Melder", "mit Titel den Titel");
	assert.strictEqual(a({ source_id: 812, url: "", label: "Die Flusslande" }).ausKatalog, true, "ein Katalogtreffer traegt die Marke „aus dem Katalog“");
	assert.strictEqual(a({ source_id: 812, url: "https://x/y", label: "X" }).ausKatalog, false, "… eine Adresse nicht");
}

// ---- 3. Das Meldeformular in index.html: die Zeile, die Falte, die Absage -- und nichts Altes mehr -------------
{
	const html = ohneHtmlKommentare(lies("index.html"));
	for (const id of ["report-source-ref", "report-source-pages", "report-source-add-btn", "report-source-mehr", "report-source-title", "report-source-kind", "report-source-license", "report-source-attribution", "report-source-note", "location-report-sources-list"]) {
		assert.ok(html.includes('id="' + id + '"'), "das Formular hat #" + id);
	}
	for (const alt of ["report-source-label", "report-source-url", "report-source-type", "report-source-official"]) {
		assert.ok(!html.includes('id="' + alt + '"'), "das Altfeld #" + alt + " ist weg");
	}
	const block = html.slice(html.indexOf('id="report-source-ref"'), html.indexOf('id="report-source-note"'));
	assert.ok(/<details id="report-source-mehr" class="report-sources__mehr">\s*<summary/.test(block), "die Angebote stehen in einer nativen Falte");
	assert.ok(!/<details[^>]*open/.test(block), "… die zu ist");
	assert.ok(!/offiziell|Quellenart|report-source-type/.test(block), "kein „offiziell“, keine Art im Block des Melders");
	assert.ok(!/Kennen wir schon/.test(html), "kein Satz „Kennen wir schon“ (Owner: „verwirrt nur“)");
	assert.ok(/<p id="report-source-note" class="report-sources__note" role="status" aria-live="polite" hidden>/.test(html), "die Absage hat ihre Zeile, als Statusfeld");
	// Das Regelmodul laedt VOR beiden Formularen.
	const modul = html.indexOf('src="js/review/meldung-quellen.js"');
	assert.ok(modul > 0, "meldung-quellen.js wird geladen");
	assert.ok(modul < html.indexOf('src="js/review/review-locations.js"') && modul < html.indexOf('src="js/map-features/map-features-citymaps-suggest.js"'), "… vor beiden Formularen");
	assert.ok(html.indexOf('src="js/ui/feature-source-markup.js"') < modul, "… und die Lizenztafel (feature-source-markup.js) davor");
}

// ---- 4. Beide Formulare rufen DIESELBE Regel, kein Formular kennt Art oder offiziell mehr ------------------------
{
	const orte = ohneKommentare(lies("js/review/review-locations.js"));
	const karten = ohneKommentare(lies("js/map-features/map-features-citymaps-suggest.js"));
	assert.ok(/meldungQuellenRegel\("avesmapsMeldungQuelleAusEingabe"\)\(readLocationReportSourceInputs\(\)\)/.test(orte), "das Meldeformular baut seine Quelle ueber die Regel");
	assert.ok(/require\("\.\/meldung-quellen\.js"\)\[name\]/.test(orte) && /throw new Error\("meldung-quellen\.js fehlt/.test(orte),
		"… per Weiterreicher: unter Node geholt, im Browser global, ohne stillen Rueckfall");
	assert.ok(/avesmapsMeldungQuelleAusEingabe\(\{/.test(karten), "der Kartenvorschlag auch");
	assert.ok(!/report-source-label|report-source-url|report-source-type|report-source-official/.test(orte), "das Meldeformular liest keine Altfelder");
	assert.ok(!/source-type|source-official|citymap-suggest-source-url|citymap-suggest-source-label/.test(karten), "der Kartenvorschlag kennt Art, offiziell, Link-Feld und Namensfeld nicht mehr");
	assert.ok(/official:|type:/.test(orte) === false || !/\bofficial:\s*Boolean/.test(orte), "das Meldeformular schickt kein `official`");
	assert.ok(!/official: Boolean\(overlay/.test(karten) && !/type: val\(overlay, "citymap-suggest-source-type"\)/.test(karten), "der Kartenvorschlag schickt weder `official` noch `type`");
	// Die Absage ist hoerbar: der Knopf kehrt nicht mehr still zurueck.
	assert.ok(/showLocationReportSourceNote\(locationReportSourceRejectionText\(ergebnis\.grund\)\)/.test(orte), "die Absage wird gesagt, mit ihrem Grund");
	assert.ok(/suggestSourceFromForm\(overlay\)\.ok/.test(karten), "… auch im Kartenvorschlag, vor dem Senden");
	// Der Treffer aus dem Katalog: Kennung UND Titel merken, Tippen setzt beides zurueck.
	assert.ok(/locationReportPickedLabel = String\(item\.label \|\| ""\)/.test(orte) && /locationReportPickedLabel = "";/.test(orte), "das Meldeformular merkt sich den Titel des Treffers und vergisst ihn beim Tippen");
	assert.ok(/suggestPickedLabel = String\(item\.label \|\| ""\)/.test(karten) && /suggestPickedLabel = "";/.test(karten), "der Kartenvorschlag ebenso");
	// Die Lizenzliste kommt aus der EINEN Tafel.
	assert.ok(/Object\.keys\(FEATURE_SOURCE_LICENSES\)/.test(orte) && /Object\.keys\(FEATURE_SOURCE_LICENSES\)/.test(karten), "beide Lizenzlisten kommen aus FEATURE_SOURCE_LICENSES");
	// Die Verdrahtung: Enter in den neuen Feldern, Lizenzliste beim Start.
	const boot = ohneKommentare(lies("js/app/bootstrap.js"));
	assert.ok(/\$\("#report-source-ref, #report-source-pages, #report-source-title, #report-source-attribution"\)\.on\("keydown"/.test(boot), "Enter legt die Quelle an -- in den neuen Feldern");
	assert.ok(/initLocationReportSourceLicenseOptions\(\);/.test(boot), "die Lizenzliste wird beim Start gefuellt");
	assert.ok(/\$\("#report-source-add-btn"\)\.on\("click", addLocationReportSourceFromInputs\)/.test(boot), "der Knopf ist verdrahtet");
	const flow = ohneKommentare(lies("js/review/review-report-flow.js"));
	assert.ok(/getElementById\("report-source-ref"\)\?\.focus\(\)/.test(flow), "die Pflichtpruefung beim Absenden fokussiert das neue Feld");
}

// ---- 4b. Die Vorschlagsliste zeigt dem Melder keine Art und kein „offiziell“ (Regel 2) -------------------------------
{
	const vm = require("node:vm");
	const ctx = { window: {}, document: undefined, console };
	ctx.globalThis = ctx;
	vm.createContext(ctx);
	vm.runInContext(lies("js/ui/source-autocomplete.js"), ctx);
	const state = { items: [{ source_id: 1, label: "Geographia Aventurica", url: "https://x", type: "regionalspielhilfe", official: true, uses: 1319 }], activeIndex: 0, query: "Geo" };
	const editor = ctx.renderSourceAutocompleteHtml(state, {});
	const melder = ctx.renderSourceAutocompleteHtml(state, { ohneMarken: true });
	assert.ok(editor.includes('class="sac-badge"') && editor.includes("sac-badge--official"), "der Editor sieht Art und „offiziell“ weiter");
	assert.ok(!melder.includes("sac-badge"), "mit `ohneMarken` weder Art noch „offiziell“: " + melder);
	// ⚠️ Der Titel traegt die Treffer-Hervorhebung („<mark>Geo</mark>graphia“) -- gemessen wird ohne Tags.
	assert.ok(melder.replace(/<[^>]+>/g, "").includes("Geographia Aventurica") && melder.includes("an 1319 Orten"), "… Titel und Verbreitung bleiben: " + melder);
	const orte = ohneKommentare(lies("js/review/review-locations.js"));
	const karten = ohneKommentare(lies("js/map-features/map-features-citymaps-suggest.js"));
	assert.ok(/attachSourceAutocomplete\(refInput, \{\s*ohneMarken: true,/.test(orte), "das Meldeformular bestellt die Liste ohne Marken");
	assert.ok(/attachSourceAutocomplete\(sourceLabel, \{\s*ohneMarken: true,/.test(karten), "der Kartenvorschlag auch");
	assert.ok(/ohneMarken: options\.ohneMarken === true/.test(ohneKommentare(lies("js/ui/source-autocomplete.js"))), "die Option reist bis in den Bauer");
	// Die Sammel-Absage beim Absenden sagt nicht mehr „Name genügt“.
	const flow = ohneKommentare(lies("js/review/review-report-flow.js"));
	assert.ok(!/Name genügt/.test(flow) && /den Link zur Seite, in der es steht/.test(flow), "die Sammel-Absage nennt den Link, nicht den Namen");
	assert.ok(/throw new Error\("meldung-quellen\.js fehlt/.test(karten), "der Kartenvorschlag wirft laut ohne das Regelmodul");
	// Keine toten Regeln des Sechs-Felder-Formulars mehr.
	const css = lies("css/components/location-report-dialog.css");
	assert.ok(!/report-sources__type|report-sources__kind|report-sources__add-row2|report-sources__official|report-sources__add > input/.test(css), "die toten CSS-Regeln sind weg");
}

// ---- 5. Jede Beschriftung des Blocks hat ihren englischen Text ------------------------------------------------
{
	const html = ohneHtmlKommentare(lies("index.html"));
	const block = html.slice(html.indexOf('data-i18n="report.sectionSources"'), html.indexOf('data-i18n="report.sectionMore"') + 40);
	const en = lies("js/app/i18n-en.js");
	const schluessel = Array.from(block.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)).map((m) => m[1]);
	assert.ok(schluessel.length >= 12, "der Block traegt seine Schluessel (" + schluessel.length + ")");
	for (const k of new Set(schluessel)) {
		assert.ok(en.includes('"' + k + '"'), "englischer Text fuer " + k);
	}
	assert.ok(en.includes('"report.sourceNeedRef"') && en.includes('"report.sourceNeedLink"') && en.includes('"report.sourceFromCatalog"'), "… auch fuer die Saetze aus dem Skript");
}

console.log("meldung-quellen: alle Zusicherungen erfuellt");
