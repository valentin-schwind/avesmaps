// Die Editorzeile zeigt vorn, was der Besucher sieht -- ueber die EINE Namensregel der Infobox.
//
// Owner 03.09.2026 (Bild: Editorzeile „Apfeldorn“ gegen Infobox „AlberniaWiki“): „kannst du bei der
// auflistung von quellen im backend den titel grundsätzlich an dem anpassen, was im frontend zu sehen
// ist? die editoren sagen, dass sie verwirrt sind, dass das was anderes steht.“ Und: „du kannst den
// ‚Titel‘ in den Tooltip des links verlagern z.B. ‚Baronie Hirschfurten - Garetien-Wiki‘“.
//
// 🔴 Die Regel gibt es GENAU EINMAL (featureSourceVornName, js/ui/feature-source-markup.js); die Infobox
//   und der Zeilenbauer des Editors rufen sie. Dieser Test haelt beide Erzeuger gegeneinander -- zur
//   LAUFZEIT, nicht nur am Quelltext: eine zweite Fassung der Regel wuerde hier auffallen, sobald sie
//   anders rechnet.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellenzeile-name-vorn.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const markup = require(path.join(WURZEL, "js/ui/feature-source-markup.js"));
const editor = require(path.join(WURZEL, "js/review/review-feature-sources.js"));
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tr = (_k, f) => f;

// ---- 1. Die Regel selbst ----------------------------------------------------------------------------------
{
	const { featureSourceVornName } = markup;
	assert.strictEqual(typeof featureSourceVornName, "function", "die Regel ist exportiert");
	assert.deepStrictEqual(
		featureSourceVornName({ label: "Baronie Hirschfurten", url: "https://www.garetien.de/x" }, { label: "Garetien-Wiki", form: "belegstelle" }),
		{ vorn: "Garetien-Wiki", titel: "Baronie Hirschfurten", korpusName: "Garetien-Wiki", eigenerTitel: "Baronie Hirschfurten" },
		"Belegstelle: der Korpusname vorn, der Seitentitel als Zusatz");
	assert.deepStrictEqual(
		featureSourceVornName({ label: "Geographia Aventurica", url: "https://f-shop.de/y" }, { label: "F-Shop", form: "werk" }).vorn,
		"Geographia Aventurica", "Werk: der Titel vorn");
	assert.strictEqual(
		featureSourceVornName({ label: "Geographia Aventurica", url: "https://f-shop.de/y" }, { label: "F-Shop", form: "werk" }).titel,
		"", "… und kein Zusatz -- er stuende doppelt");
	assert.strictEqual(featureSourceVornName({ label: "Ohne Korpus" }, null).vorn, "Ohne Korpus", "ohne Korpus: der Titel");
	assert.strictEqual(featureSourceVornName({ label: "", url: "https://x/y" }, null).vorn, "https://x/y", "ohne Titel: die Adresse");
	assert.strictEqual(featureSourceVornName({ label: "AlberniaWiki" }, { label: "AlberniaWiki", form: "belegstelle" }).titel, "",
		"heisst die Seite wie der Korpus, gibt es keinen Zusatz");
	assert.strictEqual(featureSourceVornName({ label: "X" }, { label: "Wirt", form: "" }).vorn, "X",
		"ein Korpus ohne entschiedene Form verhaelt sich wie ein Werk");
	assert.deepStrictEqual(featureSourceVornName(null, null).vorn, "", "nichts: kein Wurf");
}

// ---- 2. Die Editorzeile: vorn der Besuchername, der Titel im Tooltip ------------------------------------------
{
	const zeile = (source) => editor.renderFeatureSourceRow(source, esc, tr, true);
	const beleg = zeile({ source_id: 5, url: "https://www.garetien.de/index.php/Baronie_Hirschfurten", label: "Baronie Hirschfurten",
		type: "briefspiel", official: false, corpus: { corpus_key: "garetien.de", label: "Garetien-Wiki", form: "belegstelle", known: true } });
	assert.ok(beleg.includes(">Garetien-Wiki ↗</a>"), "Belegstelle: der Korpusname ist der Linktext: " + beleg);
	assert.ok(beleg.includes(' title="Baronie Hirschfurten — Garetien-Wiki"'), "… der Seitentitel steht im Tooltip, mit dem Korpusnamen dahinter");
	assert.ok(!beleg.includes(">Baronie Hirschfurten ↗"), "… und nicht mehr vorn");
	assert.ok(beleg.includes('<a class="fs-row__link" href="https://www.garetien.de/index.php/Baronie_Hirschfurten"'),
		"der Link zeigt weiter auf die genaue Seite, und die Klasse bleibt (quellen-verteiler.test.js pinnt sie)");

	const werk = zeile({ source_id: 6, url: "https://www.f-shop.de/search?sSearch=10291", label: "Geographia Aventurica",
		type: "regionalspielhilfe", official: true, corpus: { corpus_key: "f-shop.de", label: "F-Shop", form: "werk", known: true } });
	assert.ok(werk.includes(">Geographia Aventurica ↗</a>"), "Werk: der Titel bleibt vorn");
	assert.ok(!/<a class="fs-row__link"[^>]*title=/.test(werk), "… ohne Tooltip");

	const ohne = zeile({ source_id: 7, url: "https://x/y", label: "Freie Quelle", type: "sonstiges", official: false });
	assert.ok(ohne.includes(">Freie Quelle ↗</a>") && !/<a class="fs-row__link"[^>]*title=/.test(ohne), "ohne Korpus: wie bisher");

	// Die Marke „12 von 56 Abschnitten“ (Verteiler) bleibt am umbrechenden Link, jetzt mit dem Besuchernamen.
	const marke = zeile({ source_id: 8, url: "https://www.garetien.de/w", label: "Reichsstrasse 3", type: "briefspiel", official: false,
		segments: 12, segments_of: 56, corpus: { corpus_key: "garetien.de", label: "Garetien-Wiki", form: "belegstelle", known: true } });
	assert.ok(marke.includes('<a class="fs-row__link fs-row__link--marke"') && marke.includes(">Garetien-Wiki ↗")
		&& marke.includes(' title="Reichsstrasse 3 — Garetien-Wiki"'), "mit Marke: Modifikator, Besuchername und Tooltip zusammen: " + marke);

	// Ein Anfuehrungszeichen im Titel darf den Tooltip nicht sprengen.
	const zitat = zeile({ source_id: 9, url: "https://www.garetien.de/z", label: 'Burg "Falkenstein"', type: "briefspiel", official: false,
		corpus: { corpus_key: "garetien.de", label: "Garetien-Wiki", form: "belegstelle", known: true } });
	assert.ok(zitat.includes(' title="Burg &quot;Falkenstein&quot; — Garetien-Wiki"'), "der Tooltip wird maskiert");
}

// ---- 3. Beide Erzeuger rechnen DIESELBE Regel -- zur Laufzeit gegeneinander gehalten ---------------------------
{
	const quelle = { source_id: 3, url: "https://www.westlande.de/albernia/index.php?title=Apfeldorn", label: "Apfeldorn", type: "briefspiel", official: false };
	const korpora = { "westlande.de": { label: "AlberniaWiki", form: "belegstelle" } };
	const infobox = markup.buildSourceListMarkup("", [Object.assign({ corpus: "westlande.de" }, quelle)], { corpora: korpora, escape: esc });
	const zeile = editor.renderFeatureSourceRow(Object.assign({ corpus: { corpus_key: "westlande.de", label: "AlberniaWiki", form: "belegstelle" } }, quelle), esc, tr, true);
	const linktext = (html) => (html.match(/<a class="fs-(?:src-a|row__link)"[^>]*>([^<]*?)\s*(?:<span|↗)/) || [])[1] || "";
	assert.strictEqual(linktext(infobox).trim(), "AlberniaWiki", "die Infobox zeigt den Korpusnamen: " + infobox.slice(0, 300));
	assert.strictEqual(linktext(zeile).trim(), "AlberniaWiki", "die Editorzeile zeigt DENSELBEN Namen");
	assert.ok(/<dt>Titel<\/dt><dd>Apfeldorn<\/dd>/.test(infobox), "die Infobox legt den Titel ins ⓘ …");
	assert.ok(zeile.includes(' title="Apfeldorn — AlberniaWiki"'), "… der Editor in den Tooltip");
}

// ---- 4. Der Editor rechnet NICHT selbst: die Regel steht einmal, und sie wird bei jedem Aufruf nachgeschlagen --
{
	const editorQuelle = fs.readFileSync(path.join(WURZEL, "js/review/review-feature-sources.js"), "utf8").replace(/\r\n/g, "\n");
	const markupQuelle = fs.readFileSync(path.join(WURZEL, "js/ui/feature-source-markup.js"), "utf8").replace(/\r\n/g, "\n");
	const ohneKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
	assert.strictEqual((ohneKommentare(markupQuelle).match(/form === "belegstelle"/g) || []).length, 1,
		"die Belegstellen-Regel steht im Infobox-Bauer genau EINMAL -- in featureSourceVornName");
	assert.ok(!/form === "belegstelle"/.test(ohneKommentare(editorQuelle)), "… und im Editor gar nicht: er reicht durch");
	assert.ok(/require\("\.\.\/ui\/feature-source-markup\.js"\)\.featureSourceVornName/.test(editorQuelle)
		&& /typeof featureSourceVornName === "function" \? featureSourceVornName : null/.test(editorQuelle),
		"der Weiterreicher schlaegt bei jedem Aufruf nach, in beiden Ladewegen");
	assert.ok(/throw new Error\("feature-source-markup\.js fehlt -- sie traegt die Regel, welcher Name vorn steht"\)/.test(editorQuelle),
		"… und ohne die Datei wirft er laut, statt eine Ersatzfassung zu rechnen");
	assert.ok(/kopf\("sources\.colTitle", "Quelle"\)/.test(editorQuelle), "die Spaltenueberschrift heisst „Quelle“, nicht mehr „Titel“");
}

console.log("quellenzeile-name-vorn: alle Zusicherungen erfuellt");
