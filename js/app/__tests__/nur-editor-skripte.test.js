// Editor-Code nur fuer Editoren: der Lader (js/app/nur-editor.js) und seine Verdrahtung in index.html.
//
// Drei Dinge werden festgehalten:
//   A. der Lader setzt die Vorlage NUR im Editor ein -- und faellt offen aus, nie geschlossen;
//   B. jede Vorlage steht so da, dass der Lader sie findet, und keine Datei wird doppelt geladen;
//   C. ruft ein Skript, das JEDER laedt, einen Namen aus einer Vorlage, dann ist die Stelle entweder
//      per `typeof` geschuetzt oder unten in ERLAUBT beim Namen freigegeben -- und nie als Wert
//      durchgereicht (`.on("submit", name)` wertet den Namen schon beim Laden aus).
//
// 💣 WARUM C SO GENAU HINSIEHT: der erste Bau (14.09.2026) liess js/review/ aus der Pruefung, weil „die
// review-Dateien nur im Editor laufen". Live warf daraufhin JEDER Besucherstart: preparePowerlineData
// (Kartendaten, fuer alle) -> renderPowerlineSyncList (review-powerline-list.js, damals fuer alle
// geladen) -> avesmapsListBalanceRender (aus einer Vorlage). Eine review-Datei, die jeder laedt, ist
// Besucher-Code -- wer sie ruft, sieht man ihr nicht an.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8");

// ---------------------------------------------------------------------------------------------
// A. Den Lader wirklich ausfuehren.
// ---------------------------------------------------------------------------------------------
const LADER = lies("js/app/nur-editor.js");

function fahre({ editMode, vorlage, ohneAufruf = false }) {
	const geschrieben = [];
	const fehler = [];
	const kontext = vm.createContext({
		document: {
			currentScript: ohneAufruf ? null : { previousElementSibling: vorlage },
			write(text) { geschrieben.push(text); },
		},
		console: { error(meldung) { fehler.push(String(meldung)); } },
	});
	// Wie im Browser: IS_EDIT_MODE ist ein `const` eines FRUEHEREN Skripts (js/config.js).
	if (editMode !== undefined) {
		vm.runInContext("const IS_EDIT_MODE = " + JSON.stringify(editMode) + ";", kontext);
	}
	vm.runInContext(LADER, kontext);
	vm.runInContext("avesmapsNurEditorSkripte();", kontext);
	return { geschrieben, fehler };
}

const INNEN = '<script src="js/review/a.js?v=abc"></script><script src="js/review/b.js?v=def"></script>';
const vorlage = (attribut = true, tagName = "TEMPLATE") => ({
	tagName,
	innerHTML: INNEN,
	hasAttribute: (name) => attribut && name === "data-nur-editor",
});

{
	const r = fahre({ editMode: true, vorlage: vorlage() });
	assert.deepStrictEqual(r.geschrieben, [INNEN],
		"Im Editor muss der Inhalt der Vorlage unveraendert eingesetzt werden -- samt Stempel und Reihenfolge");
	assert.deepStrictEqual(r.fehler, []);
}
{
	const r = fahre({ editMode: false, vorlage: vorlage() });
	assert.deepStrictEqual(r.geschrieben, [], "Ein Besucher darf die Editor-Skripte nicht laden");
	assert.deepStrictEqual(r.fehler, [], "Beim Besucher ist Schweigen der Normalfall, kein Fehler");
}
{
	const r = fahre({ editMode: undefined, vorlage: vorlage() });
	assert.deepStrictEqual(r.geschrieben, [INNEN],
		"Fehlt IS_EDIT_MODE, wird geladen: ein Besucher mit zu viel Code ist harmlos, ein Editor ohne seinen Code kaputt");
}
for (const [fall, v] of [["ein <div> davor", vorlage(true, "DIV")], ["ein <template> ohne data-nur-editor", vorlage(false)], ["nichts davor", null]]) {
	const r = fahre({ editMode: true, vorlage: v });
	assert.deepStrictEqual(r.geschrieben, [], fall + ": es darf nichts eingesetzt werden");
	assert.strictEqual(r.fehler.length, 1, fall + ": das muss LAUT gemeldet werden, sonst fehlt still eine Editorfunktion");
}
{
	const r = fahre({ editMode: true, vorlage: vorlage(), ohneAufruf: true });
	assert.deepStrictEqual(r.geschrieben, []);
	assert.strictEqual(r.fehler.length, 1, "Ohne document.currentScript (Aufruf nicht aus einem <script>) laut melden, nicht werfen");
}

// ---------------------------------------------------------------------------------------------
// B. Die Verdrahtung in index.html.
// ---------------------------------------------------------------------------------------------
// Kommentare zuerst weg: sie nennen Dateipfade, und ein Pfad im Kommentar ist fuer jede
// indexOf-Messung ein frueheres Tag (AGENTS.md §11, Hintergrundklick).
const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");

const VORLAGE_RE = /<template data-nur-editor>([\s\S]*?)<\/template>(\s*<script>[^<]*<\/script>)?/g;
const vorlagen = [...seite.matchAll(VORLAGE_RE)];
assert.ok(vorlagen.length > 0, "index.html traegt keine einzige Vorlage -- dann prueft dieser Test nichts");

const nurEditor = [];
for (const v of vorlagen) {
	const tags = v[1].match(/<script src="[^"]+"><\/script>/g) || [];
	assert.strictEqual(v[1].replace(/<script src="[^"]+"><\/script>/g, "").trim(), "",
		"In einer Vorlage stehen nur Skript-Tags, sonst nichts: " + v[0].slice(0, 120));
	assert.ok(tags.length > 0, "Leere Vorlage: " + v[0].slice(0, 120));
	assert.ok(v[2] && v[2].trim() === "<script>avesmapsNurEditorSkripte()</script>",
		"Direkt hinter jeder Vorlage muss der Aufruf stehen, sonst laedt der Editor diese Dateien nie: " + v[0].slice(0, 120));
	for (const t of tags) nurEditor.push(t.match(/src="([^"?]+)/)[1]);
}

const aufrufe = seite.match(/<script>\s*avesmapsNurEditorSkripte\(\)\s*<\/script>/g) || [];
assert.strictEqual(aufrufe.length, vorlagen.length, "Jeder Aufruf gehoert zu genau einer Vorlage");

const ladeTag = '<script src="js/app/nur-editor.js"></script>';
assert.strictEqual(seite.split(ladeTag).length - 1, 1, "Der Lader wird genau einmal eingebunden");
assert.ok(seite.indexOf('<script src="js/config.js"></script>') < seite.indexOf(ladeTag),
	"Der Lader steht nach js/config.js -- dort entsteht IS_EDIT_MODE");
assert.ok(seite.indexOf(ladeTag) < vorlagen[0].index, "Der Lader steht vor der ersten Vorlage");

const ausserhalb = seite.replace(VORLAGE_RE, "");
for (const datei of nurEditor) {
	assert.ok(!ausserhalb.includes('src="' + datei + '"'),
		datei + " steht in einer Vorlage UND als normales Skript -- der Editor luede es doppelt");
	assert.ok(fs.existsSync(path.join(WURZEL, datei)), datei + " gibt es nicht");
}

// Die review-Dateien des Besucher-Ablaufs „Ort melden" beim Namen -- beim Fehlschlag sagt diese Zeile,
// WAS dann kaputt waere.
for (const besucher of ["js/review/review-pending.js", "js/review/review-report-flow.js", "js/review/review-locations.js",
	"js/review/meldung-quellen.js", "js/review/review-core.js", "js/review/review-status.js"]) {
	assert.ok(!nurEditor.includes(besucher), besucher + " laeuft beim Besucher (Ort melden) -- es darf in keiner Vorlage stehen");
}

// ---------------------------------------------------------------------------------------------
// C. Aufrufe von aussen in Vorlagen-Namen.
// ---------------------------------------------------------------------------------------------
// ERLAUBT: Stellen, die NUR im Editor laufen, von Hand geprueft. Ein Name steht hier nur, wenn jede
// seiner Nennungen in der Datei erst beim Ereignis ausgewertet wird (Pfeil-/Funktionshuelle an einem
// Element, das nur der Editor sieht, oder im IS_EDIT_MODE-Zweig).
const ERLAUBT = {
	"js/app/bootstrap.js": [
		// IS_EDIT_MODE-Zweig des Starts
		"loadWikiSyncCases",
		// Hintergrundklick-Tafel: Schliesser fuer Overlays, die nur der Editor oeffnet
		"setWikiSyncResolveDialogOpen", "closeWikiSyncDumpCredentialsPrompt", "setWikiSyncConflictsDialogOpen",
		"setWikiSyncLoreDialogOpen",
		// Knoepfe des WikiSync-Panels und der Editorfenster (Panel nur im Editor sichtbar)
		"startWikiSyncTerritoryRun", "openAvesmapsSettlementEditorOverlay", "openAvesmapsGameLiteratureEditorOverlay",
		"openAvesmapsCitymapEditorOverlay", "openAvesmapsPowerlineEditorOverlay", "openAvesmapsEcosystemEditorOverlay",
		"openAvesmapsPathEditorOverlay", "startWikiSyncDumpRead", "startWikiSyncKindSync", "startWikiSyncGameLiteratureSync",
		"startWikiSyncLoreSync", "submitWikiSyncDumpCredentials", "setWikiSyncPanelTab", "setWikiSyncFilterQuery",
		"setWikiSyncTerritoryFilterQuery", "setWikiSyncTerritoryMapStatus", "handleWikiSyncCaseActionClick",
		"startWikiSyncPowerlines",
		// Konfliktzentrum und Aufloesen-Dialog
		"loadConflicts", "setConflictDialogMinimized", "conflictMinimized", "conflictFilter", "renderConflicts",
		"applyWikiSyncResolvePreset", "openWikiSyncResolveWikiLink", "syncWikiSyncResolveLinkButton",
		"handleWikiSyncResolveFormSubmit",
		// Gebietsdialog: Formular, Regler, Elternfilter, Schliessen (Klick, Hintergrund, Escape nur bei offenem Dialog)
		"setRegionEditDialogOpen", "handleRegionEditFormSubmit", "syncRegionOpacityOutput", "syncRegionCoatPreview",
		"syncRegionValidToControls", "updateRegionParentFilter",
		// Wege-, Kraftlinien-, Beschriftungs- und Ortsformular: Huellen, Regler, Schliessen (Klick,
		// Hintergrund, Escape nur, wenn review-core den Dialog als offen meldet -- das kann nur der Editor)
		"setPathEditDialogOpen", "setPowerlineEditDialogOpen", "setLabelEditDialogOpen",
		"handleLocationEditFormSubmit", "handlePathEditFormSubmit", "handlePowerlineEditFormSubmit",
		"handleLabelEditFormSubmit", "syncLabelZoomRangeOutputs", "syncLabelZoomNumberInputs",
		"syncLabelPriorityOutput", "syncPathAutoNameControls", "syncPathTransportOptions",
		// Seitenleiste: IS_EDIT_MODE-Zweig des Starts und ihre eigenen Knoepfe (nur im Editor sichtbar)
		"restoreReviewPanelState", "loadReviewReports", "loadChangeLog", "sendEditorPresenceHeartbeat",
		"startEditorPresenceHeartbeat", "startReviewReportsPolling", "refreshActiveEditorPanel",
		"avesmapsForceTerritoryClaim", "setEditorPanelTab", "toggleReviewPanel",
	],
	// Das Eigenschaften-Fenster der Landschaften: es oeffnet nur ueber das Flaechenmenue, und das geht nur
	// bei canEditEcosystemOnMap() auf (map-features-ecosystem-rendering.js) -- ein Besucher erreicht keine
	// dieser Stellen. Die Zuweisung haengt am Mount (typeof-geschuetzt), die Quellen ebenso.
	"js/map-features/map-features-ecosystem-properties.js": [
		"avesmapsWikiAssignLandschaftAntwortPruefen", "avesmapsWikiAssignLandschaftZustand",
		"avesmapsWikiAssignLandschaftArtikel", "avesmapsWikiAssignLandschaftSyncWerte",
		"avesmapsWikiAssignLandschaftSyncLeer", "avesmapsWikiAssignMount", "avesmapsWikiAssignLandschaftTreffer",
		// angezeigteWikiRegion hat genau einen Aufrufer: wikiAssignZustand, das `laden` des Wiki-Kastens im Editordialog
		"avesmapsWikiAssignLandschaftGespeichert",
		"mountFeatureSourceEditor",
		// ecosystemZeichneWikiAbweichungen steigt vorher per typeof auf beide aus (mehr als fuenf Zeilen darueber)
		"avesmapsWikiFeldStand", "avesmapsWikiAssignSubject",
	],
	// Der Ortseditor (nicht das Meldeformular): der Quellenkasten wird dort erst nach einem
	// typeof-Ausstieg gemountet, der mehr als fuenf Zeilen darueber steht.
	"js/review/review-locations.js": ["mountFeatureSourceEditor"],
	// Zuhoerer auf Knoepfen, die NUR die Seitenleiste erzeugt (Meldungskarten, Bewertungsliste,
	// Aenderungsverlauf in review-panels.js / review-panels-change-log.js) -- ein Besucher hat sie nie im DOM.
	"js/routing/routing.js": [
		"findReviewReportFromElement", "focusReviewReport", "focusReviewRatingLocation", "moderateReviewRating",
		"focusChangeLogEntry", "undoChangeLogEntry", "isCommentReport", "clearReviewReportMarker",
		"loadReviewReports", "isLocationReport", "isCitymapReport", "isCitymapLinkReport",
	],
	// assignWikiSyncTerritoryPayloadInsideLegacyEditor: bricht vorher per typeof auf
	// ensurePoliticalTerritoryChainFromWikiPath ab (dieselbe Vorlage) -- die Zeilen danach laufen nur,
	// wenn der Gebietsdialog geladen ist. Ausgeloest nur per Drag aus dem WikiSync-Baum (Editor).
	"js/territory/territory-drag-assignment.js": [
		"storeRegionAssignmentBreadcrumbCaches", "renderRegionAssignment", "activatePrimaryRegionEditTabForTerritory",
		"ensurePoliticalTerritoryChainFromWikiPath",
	],
};

function ohneJsKommentare(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}
const esc = (n) => n.replace(/\$/g, "\\$");

const namen = new Map(); // Name -> Datei
for (const datei of nurEditor) {
	const text = ohneJsKommentare(lies(datei));
	const re = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)|(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)/gm;
	for (const m of text.matchAll(re)) {
		const name = m[1] || m[2] || m[3];
		if (name.length > 3) namen.set(name, datei);
	}
}
assert.ok(namen.size > 0, "Die Namenssuche findet keine Definition -- dann waere Teil C leer");

function jsDateien(verzeichnis, aus = []) {
	for (const e of fs.readdirSync(path.join(WURZEL, verzeichnis), { withFileTypes: true })) {
		const rel = verzeichnis + "/" + e.name;
		if (e.isDirectory()) {
			if (e.name === "__tests__" || e.name === "third-party") continue;
			jsDateien(rel, aus);
		} else if (e.name.endsWith(".js")) {
			aus.push(rel);
		}
	}
	return aus;
}

// Geprueft wird, was index.html einem Besucher WIRKLICH laedt: die Skript-Tags ausserhalb der Vorlagen.
// Dateien wie js/pages/wege-editor.js gehoeren zu eigenen Seiten unter html/, die ihre Wiki-Zuweisung selbst
// einbinden -- sie koennen den Start von index.html nicht brechen und schluegen hier nur falsch an.
const besucherSkripte = [...ausserhalb.matchAll(/<script[^>]*\ssrc="([^"?#]+)/g)].map((m) => m[1].replace(/^\//, ""));
assert.ok(besucherSkripte.length > 100, "index.html nennt kaum Skripte ausserhalb der Vorlagen -- dann prueft Teil C nichts");
const quellen = besucherSkripte
	.filter((rel) => rel.startsWith("js/") && !rel.startsWith("js/third-party/") && rel !== "js/app/nur-editor.js" && !nurEditor.includes(rel))
	.filter((rel) => fs.existsSync(path.join(WURZEL, rel)))
	.map((rel) => [rel, ohneJsKommentare(lies(rel))]);
quellen.push(["index.html", ausserhalb]);
for (const pflicht of ["js/app/bootstrap.js", "js/map-features/map-features-powerlines.js", "js/routing/routing.js"]) {
	assert.ok(quellen.some(([rel]) => rel === pflicht), pflicht + " muss unter den geprueften Dateien sein");
}

const namensRe = new RegExp("(^|[^\\w$.])(" + [...namen.keys()].map(esc).join("|") + ")(?![\\w$])", "g");
const fensterRe = new RegExp("(?:window|globalThis)\\.(" + [...namen.keys()].map(esc).join("|") + ")(?![\\w$])(\\s*\\()?", "g");

const verstoesse = [];
const genutzteFreigaben = new Set();
for (const [rel, text] of quellen) {
	const zeilen = text.split(/\r?\n/);
	for (let i = 0; i < zeilen.length; i++) {
		const z = zeilen[i];
		// Fuenf Zeilen zurueck: das Haus schuetzt auch per fruehem Ausstieg
		// (`if (typeof x !== "function") { …; return; }` und der Aufruf drei, vier Zeilen darunter).
		const umgebung = zeilen.slice(Math.max(0, i - 5), i + 1).join("\n");
		const geschuetzt = (n) => new RegExp("typeof\\s+(?:(?:window|globalThis)\\.)?" + esc(n) + "(?![\\w$])").test(umgebung);
		// window.X lesen wirft nie; window.X = ... ist eine Definition. Nur window.X(...) braucht Schutz.
		for (const m of z.matchAll(fensterRe)) {
			if (m[2] && !geschuetzt(m[1]) && !(ERLAUBT[rel] || []).includes(m[1])) {
				verstoesse.push(rel + ":" + (i + 1) + " ruft window." + m[1] + "() ungeschuetzt (" + namen.get(m[1]) + ")");
			}
		}
		for (const m of z.matchAll(namensRe)) {
			const n = m[2];
			if (geschuetzt(n)) continue;
			if (new RegExp("[(,]\\s*" + esc(n) + "\\s*[,)]").test(z)) {
				verstoesse.push(rel + ":" + (i + 1) + " reicht " + n + " als WERT durch -- das wertet den Namen beim Laden aus (" + namen.get(n) + ")");
				continue;
			}
			if ((ERLAUBT[rel] || []).includes(n)) {
				genutzteFreigaben.add(rel + " " + n);
				continue;
			}
			verstoesse.push(rel + ":" + (i + 1) + " nennt " + n + " ungeschuetzt (" + namen.get(n) + ")");
		}
	}
}
assert.deepStrictEqual(verstoesse, [],
	"Diese Namen gibt es nur im Editor. Ein Skript, das jeder laedt, darf sie nur per `typeof`-Schutz rufen oder "
	+ "an einer Stelle, die nachweislich nur im Editor laeuft -- dann gehoert der Name in ERLAUBT.");

const verwaist = [];
for (const [rel, liste] of Object.entries(ERLAUBT)) {
	for (const n of liste) if (!genutzteFreigaben.has(rel + " " + n)) verwaist.push(rel + " " + n);
}
assert.deepStrictEqual(verwaist, [], "Diese Freigaben gelten nichts mehr (Name nicht mehr in einer Vorlage oder nicht mehr genannt) -- streichen");

console.log("nur-editor-skripte: ok (" + vorlagen.length + " Vorlagen, " + nurEditor.length + " Dateien, " + namen.size + " Namen, " + quellen.length + " Skripte geprueft, " + genutzteFreigaben.size + " Freigaben)");
