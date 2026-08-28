// Eine gerade hinzugefuegte Quelle steht sofort in der Infobox -- ohne F5.
//
// 💣 DER BEFUND (Owner 28.08.2026, "ausserdem werden keine quellen gelistet obwohl ich eine
// hinzugefuegt hab"): Die Infobox liest ihre Quellen SYNCHRON aus zwei Fenster-Globals
// (`__sourceCatalog` / `__featureSourceRefs`, js/ui/popups.js:resolveFeatureSourceList). Die werden
// GENAU EINMAL geschrieben -- beim Laden der Kartennutzlast (js/routing/routing.js). Danach ruehrte
// sie niemand mehr an:
//   - Der Quellen-Editor zeichnete nur sein eigenes Fenster neu.
//   - Der Live-Abgleich im Bearbeiten-Modus uebertraegt nur `features`, nie die Quellen.
// Der Helfer dagegen gab es laengst -- syncFeatureSourcesToClientCache -- mit genau EINEM Aufrufer:
// dem Meldungs-Weg fuer Siedlungen. Eine Regel, die einen von zwei Erzeugern bindet, ist keine.
//
// Live nachgemessen: Server, Kartennutzlast und Markup-Bauer waren alle heil; allein der Speicher
// im Browser war alt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/quellen-sofort-sichtbar.test.js
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(REPO, "js", "review", "review-feature-sources.js"), "utf8");
// ⚠️ ZUERST, wie auf jeder der fuenf Seiten mit Quellen-Editor: feature-source-markup.js traegt
// die geteilte Lizenz- und Seitenzahl-Regel, und der Zeilenbauer wirft ohne sie laut (AGENTS.md §11).
const geteilteMarkupQuelle = fs.readFileSync(
	path.join(REPO, "js", "ui", "feature-source-markup.js"), "utf8");

let pruefungen = 0;
const zaehl = () => { pruefungen += 1; };

// Ein Behaelter, der genau die Handgriffe kann, die mountFeatureSourceEditor an ihm ausfuehrt.
function macheBehaelter() {
	const felder = {};
	for (const sel of [".fs-add-url", ".fs-add-label", ".fs-add-type", ".fs-add-kind",
		".fs-add-official", ".fs-add-pages", ".fs-add-license", ".fs-add-attribution"]) {
		felder[sel] = { value: "", checked: false, focus() {}, addEventListener() {} };
	}
	felder[".fs-add-url"].value = "https://de.wiki-aventurica.de/wiki/Ce%C3%A4lan";
	felder[".fs-add-label"].value = "Wiki Aventurica (Insel)";
	felder[".fs-add-type"].value = "sonstiges";
	return {
		innerHTML: "",
		_klick: null,
		addEventListener(typ, fn) { if (typ === "click") { this._klick = fn; } },
		querySelector(sel) { return felder[sel] || null; },
	};
}

const KLICK_AUF_HINZUFUEGEN = { target: { closest: (sel) => (sel === "[data-fs-add-submit]" ? {} : null) } };
const klickAufEntfernen = (sourceId) => ({
	target: {
		closest: (sel) => (sel === "[data-remove-source-id]"
			? { getAttribute: () => String(sourceId) }
			: null),
	},
});

// Baut den Kontext: echtes Modul, gefaelschtes Fenster, gefaelschter Server.
function macheKontext(antworten, fensterZusatz) {
	const gerufen = { refresh: 0, koerper: [] };
	const fenster = Object.assign({ __sourceCatalog: {}, __featureSourceRefs: {} }, fensterZusatz || {});
	fenster.avesmapsRefreshInfopanel = () => { gerufen.refresh += 1; };
	const context = {
		console,
		window: fenster,
		document: { querySelector: () => null },
		fetch: async (url, init) => {
			gerufen.koerper.push(JSON.parse(init.body));
			return { json: async () => antworten.shift() };
		},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(geteilteMarkupQuelle, context);
	vm.runInContext(quelle, context);
	context.__gerufen = gerufen;
	return context;
}

const LABEL_ID = "53022cbf-74ba-4e05-9110-18ff0e3067a0";
const ANTWORT_LEER = { ok: true, wiki_url: "", sources: [] };
const ANTWORT_MIT_QUELLE = {
	ok: true,
	wiki_url: "",
	sources: [{
		source_id: 1322112,
		url: "https://de.wiki-aventurica.de/wiki/Ce%C3%A4lan",
		label: "Wiki Aventurica (Insel)",
		type: "sonstiges",
		official: false,
		pages: "",
		reference_kind: "",
	}],
};
const frisch = (objekt) => JSON.parse(JSON.stringify(objekt));
// 💣 Werte aus dem vm-Kontext tragen DESSEN Array/Object-Prototypen -- `deepStrictEqual` vergleicht
// die mit und meldet "[] !== []". Verglichen wird deshalb ueber den JSON-Umweg.
const alsText = (wert) => JSON.stringify(wert === undefined ? null : wert);

(async () => {
	// ---- 1. Eine Landschafts-Beschriftung: die Quelle landet im Speicher der Karte ------------
	// 🔴 Bewusst NICHT "settlement": genau die Objektart war die einzige, die den Speicher je erreichte.
	const ctx = macheKontext([frisch(ANTWORT_LEER), frisch(ANTWORT_MIT_QUELLE)]);
	const behaelter = macheBehaelter();

	await ctx.mountFeatureSourceEditor(behaelter, "region", () => LABEL_ID, {});
	assert.strictEqual(alsText(ctx.window.__featureSourceRefs["region:" + LABEL_ID]), "[]",
		"schon das Mounten gleicht den Speicher mit der Serverwahrheit ab");
	zaehl();
	const refreshNachMounten = ctx.__gerufen.refresh;

	await behaelter._klick(KLICK_AUF_HINZUFUEGEN);

	assert.strictEqual(alsText(ctx.window.__featureSourceRefs["region:" + LABEL_ID]),
		alsText([{ source_id: 1322112, pages: "", reference_kind: "" }]),
		"nach dem Hinzufuegen muss die Verknuepfung im Kartenspeicher stehen -- sonst zeigt die "
		+ "Infobox erst nach einem Neuladen etwas an");
	zaehl();
	assert.strictEqual(ctx.window.__sourceCatalog[1322112].label, "Wiki Aventurica (Insel)",
		"und die Quelle selbst im geteilten Katalog");
	zaehl();
	assert.ok(ctx.__gerufen.refresh > refreshNachMounten,
		"und das offene Infopanel wird neu gezeichnet -- ohne das sieht der Editor seine Quelle erst "
		+ "beim naechsten Klick auf das Label");
	zaehl();

	// ---- 2. Entfernen nimmt sie wieder heraus -------------------------------------------------
	const ctx2 = macheKontext([frisch(ANTWORT_MIT_QUELLE), frisch(ANTWORT_LEER)]);
	const behaelter2 = macheBehaelter();
	await ctx2.mountFeatureSourceEditor(behaelter2, "region", () => LABEL_ID, {});
	assert.strictEqual(ctx2.window.__featureSourceRefs["region:" + LABEL_ID].length, 1);
	zaehl();
	await behaelter2._klick(klickAufEntfernen(1322112));
	assert.strictEqual(alsText(ctx2.window.__featureSourceRefs["region:" + LABEL_ID]), "[]",
		"nach dem Entfernen darf die Verknuepfung nicht im Speicher stehenbleiben");
	zaehl();

	// ---- 3. Beim ANLEGEN wird nichts geschrieben ----------------------------------------------
	// 💣 Der Puffer (createPendingFeatureSourceStore) vergibt NEGATIVE Platzhalter-Ids fuer ein
	// Objekt, das es serverseitig noch gar nicht gibt. Die in den Kartenspeicher zu legen hiesse,
	// die Infobox auf eine Quelle zeigen zu lassen, die niemand je gespeichert hat.
	const ctx3 = macheKontext([]);
	const behaelter3 = macheBehaelter();
	await ctx3.mountFeatureSourceEditor(behaelter3, "settlement", () => "", {
		store: ctx3.createPendingFeatureSourceStore(),
	});
	await behaelter3._klick(KLICK_AUF_HINZUFUEGEN);
	assert.strictEqual(alsText(Object.keys(ctx3.window.__featureSourceRefs)), "[]",
		"im Anlege-Modus bleibt der Kartenspeicher unberuehrt");
	zaehl();
	assert.strictEqual(ctx3.__gerufen.refresh, 0,
		"und das Panel wird nicht angestossen -- es zeigt das neue Objekt ja noch gar nicht");
	zaehl();

	// ---- 4. Aus einem Editor-iframe heraus zaehlt das HAUPTfenster ----------------------------
	// 💣 Die Editorseiten (html/*.html) sind eigenstaendige iframe-Dokumente IM Kartenfenster. Ihr
	// eigenes `window` traegt die Kartenglobals NICHT -- dorthin geschrieben waere der Abgleich eine
	// stille Nulloperation, und die Karte bliebe genauso alt wie vorher.
	const hauptfenster = { __sourceCatalog: {}, __featureSourceRefs: {} };
	const ctx4 = macheKontext([frisch(ANTWORT_LEER), frisch(ANTWORT_MIT_QUELLE)], { parent: hauptfenster });
	const behaelter4 = macheBehaelter();
	await ctx4.mountFeatureSourceEditor(behaelter4, "region", () => LABEL_ID, {});
	await behaelter4._klick(KLICK_AUF_HINZUFUEGEN);
	assert.strictEqual((hauptfenster.__featureSourceRefs["region:" + LABEL_ID] || []).length, 1,
		"der Abgleich muss im Fenster landen, das die Karte traegt");
	zaehl();

	// ---- 5. Ein fehlgeschlagener Schreibvorgang aendert nichts --------------------------------
	// ⚠️ Die sichere Richtung: lieber ein alter Speicher als ein erfundener.
	const ctx5 = macheKontext([frisch(ANTWORT_MIT_QUELLE), { ok: false, error: "nope" }]);
	const behaelter5 = macheBehaelter();
	await ctx5.mountFeatureSourceEditor(behaelter5, "region", () => LABEL_ID, {});
	const vorher = JSON.stringify(ctx5.window.__featureSourceRefs);
	await behaelter5._klick(klickAufEntfernen(1322112));
	assert.strictEqual(JSON.stringify(ctx5.window.__featureSourceRefs), vorher,
		"eine abgelehnte Antwort darf den Speicher nicht anfassen");
	zaehl();

	console.log("quellen-sofort-sichtbar.test.js: " + pruefungen + " Zusicherungen erfuellt");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
