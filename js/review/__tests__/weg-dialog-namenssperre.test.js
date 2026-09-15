"use strict";
// DIE NAMENSSPERRE IM KARTENDIALOG „Weg bearbeiten" IST GEFALLEN -- der Wegname gehoert dem Editor.
// Owner 15.09.2026, mit Bild des Gruppendialogs „Bärenpfad" (Name grau gesperrt): „der wegname lässt sich nicht ändern. wenn ich
// umbenenne, soll das beim speichern für alle abschnitte gelten. außerdem will man mit "Wegname anzeigen" (chechbox) die kontrolle
// haben, ob der name auf der karte angezeigt werden soll". Auf Rueckfrage gewaehlt: „Editor bestimmt" -- Zuweisen setzt den
// Artikelnamen, danach holt ihn nur noch „Sync".
// 🔴 UMGESTELLT, NICHT GELOESCHT: diese Datei hielt bis dahin die Sperre fest („gesperrt, sobald IRGENDEIN Abschnitt eine
// Hauptzuweisung traegt", Fixrunde Lieferung 1). Dieselben Faelle stehen hier mit der Gegenaussage -- dazu die Stellen, an denen die
// Sperre sonst still zurueckkaeme: die Vorbelegung, der Rumpf, das Feld nach dem Zuweisen und „Sync".
// AUSGEFUEHRT: syncPathAutoNameControls, pathEditNameVorbelegung, populatePathEditForm, buildPathEditPayload (review-paths.js),
// pathWikiCurrentAssignment, pathWikiSyncNachbarn, pathWikiZuweisen, pathWikiSyncUebernehmen (review-path-wiki.js) und der echte
// getPathTitleName samt shouldShowRoutePathDisplayName -- aus dem Quelltext geschnitten und gegen eine Formular-Attrappe gefahren.
// Aus der Wurzel: node js/review/__tests__/weg-dialog-namenssperre.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const funktion = (text, name) => {
	const a = text.indexOf("\nfunction " + name + "(");
	const b = a >= 0 ? a : text.indexOf("\nasync function " + name + "(");
	assert.ok(b >= 0, "Funktion fehlt: " + name);
	const e = text.indexOf("\n}\n", b);
	return text.slice(b, e + 3);
};
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
const W = require(path.join(WURZEL, "js/ui/wiki-assign-weg.js"));
const PFADE = lies("js/review/review-paths.js");
const WIKI = lies("js/review/review-path-wiki.js");
const DOMAIN = lies("js/map-features/map-features-path-domain.js");
const KNOTEN = lies("js/routing/route-node.js");

const feld = (werte) => Object.assign({ value: "", readOnly: false, disabled: false, checked: false, required: false, options: [],
	dispatchEvent() { return true; } }, werte || {});
const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" };
const BAERENPFAD = { wiki_key: "baerenpfad", name: "Bärenpfad" };
const pfad = (id, wiki, extra) => ({ properties: Object.assign({ public_id: id, display_name: "Reichsstraße 2", feature_subtype: "Reichsstrasse", wiki_path: wiki }, extra || {}) });

function kontext(stand) {
	const zeigeLabel = { hidden: false };
	const elemente = {
		"path-edit-name": feld({ value: stand.name === undefined ? "" : stand.name }),
		"path-edit-type": feld({ value: stand.typ || "Reichsstrasse", options: [{ value: "Reichsstrasse" }, { value: "Pfad" }] }),
		"path-edit-autoname": feld({ checked: stand.autoname === true }),
		"path-edit-show-label": Object.assign(feld(), { closest: (sel) => (sel === "label" ? zeigeLabel : null) }),
		"path-edit-public-id": feld(),
	};
	const log = { post: [], status: [], abweichungen: 0 };
	const k = {
		console, JSON, Math, Number, String, Array, Object, Boolean, RegExp, Error, Set, Map, Promise, encodeURIComponent, decodeURIComponent,
		document: { getElementById: (id) => elemente[id] || null },
		Event: function (typ) { this.type = typ; },
		FormData: function (formular) { this.get = (n) => (Object.prototype.hasOwnProperty.call(formular.werte, n) ? formular.werte[n] : null); },
		pathEditFeature: stand.feature || null,
		pathEditGruppe: stand.gruppe || null,
		pathWikiUebernommen: new Set(),
		wpGruppeHauptzuweisungen: M.wpGruppeHauptzuweisungen,
		avesmapsWikiAssignWegKanonischerName: W.avesmapsWikiAssignWegKanonischerName,
		avesmapsWikiAssignWegZuweisungsKoerper: W.avesmapsWikiAssignWegZuweisungsKoerper,
		avesmapsWikiAssignWegAntwortPruefen: W.avesmapsWikiAssignWegAntwortPruefen,
		avesmapsWikiAssignWegSyncWerte: W.avesmapsWikiAssignWegSyncWerte,
		normalizePathSubtype: (wert) => String(wert || "Weg"),
		getNextPathDisplayName: () => "Reichsstrasse-99",
		getPathDisplayNameOrGenerated: (name) => String(name || "").trim() || "Reichsstrasse-99",
		getDefaultTransportDomainForPathSubtype: () => "land",
		getPathDisplayName: (p) => p.properties.display_name || p.properties.original_name || "Weg",
		getPathEditFormElement: () => ({}),
		acquireFeatureSoftLock: async () => {},
		shouldPathNameBeDisplayed: (p) => p.properties.show_label === true,
		pathIstBach: () => false,
		syncPathTransportOptions: () => {}, resetPathWikiUebernommen: () => {}, renderPathFlowSection: () => {},
		mountPathEditFeatureSources: () => {}, pathEditUmfangZeigen: () => {}, mountPathWikiWeitere: () => {},
		pathWikiZeichneAbweichungen: () => { log.abweichungen += 1; },
		setPathEditStatus: (text) => { log.status.push(text); },
		showFeedbackToast: () => {},
		applyWikiPathSegmentsUpdate: () => {},
		pathWikiPost: async (rumpf) => {
			log.post.push(rumpf);
			return { ok: true, type_ok: true, applied: 2, wiki_name: "Bärenpfad", wiki_display_name: "Bärenpfad", segments_updated: [] };
		},
	};
	vm.createContext(k);
	vm.runInContext([
		funktion(KNOTEN, "getRoutePathDisplayName"), funktion(KNOTEN, "escapeRouteDisplayRegex"), funktion(KNOTEN, "shouldShowRoutePathDisplayName"),
		funktion(DOMAIN, "getPathTitleName"),
		funktion(WIKI, "pathWikiElement"), funktion(WIKI, "pathWikiCurrentFeaturePublicId"), funktion(WIKI, "pathWikiCurrentAssignment"),
		funktion(WIKI, "pathWikiSyncNachbarn"), funktion(WIKI, "pathWikiZuweisen"), funktion(WIKI, "pathWikiSyncUebernehmen"),
		funktion(PFADE, "syncPathAutoNameControls"), funktion(PFADE, "pathEditNameVorbelegung"), funktion(PFADE, "populatePathEditForm"),
		funktion(PFADE, "buildPathEditPayload"),
		// renderPathWikiReference ruft im Dialog pathWikiSyncNachbarn -- genau das, was hier die Beschriftung verstecken koennte.
		"function renderPathWikiReference() { pathWikiSyncNachbarn(); }",
	].join("\n"), k);
	return { k, elemente, zeigeLabel, log, rufe: (ausdruck) => vm.runInContext(ausdruck, k) };
}

// ---- 1. Die ganze Strasse: frei, auch wenn Abschnitte eine Zuweisung tragen (Befund-Fall der alten Sperre) ------------------
{
	const rs6 = pfad("rs-6", RS2); const rs7 = pfad("rs-7", null); const rs8 = pfad("rs-8", RS2);
	const z = kontext({ feature: rs7, gruppe: { pfade: [rs6, rs7, rs8] }, name: "Reichsstraße 2" });
	z.rufe("syncPathAutoNameControls()");
	assert.strictEqual(z.elemente["path-edit-name"].readOnly, false, "das Namensfeld der ganzen Strasse ist wieder gesperrt");
	assert.strictEqual(z.elemente["path-edit-name"].value, "Reichsstraße 2", "der Wert bleibt, was der Dialog hineinschrieb");
	assert.strictEqual(z.elemente["path-edit-autoname"].checked, false, "fuer die ganze Strasse gibt es keinen Auto-Name");

	// Eine uneinige Strasse bleibt „gemischt" -- kein Artikelname, den niemand angefasst hat.
	const uneins = kontext({ feature: rs6, gruppe: { pfade: [rs6, rs7, rs8] }, name: "" });
	uneins.rufe("syncPathAutoNameControls()");
	assert.strictEqual(uneins.elemente["path-edit-name"].readOnly, false);
	assert.strictEqual(uneins.elemente["path-edit-name"].value, "", "gemischt bleibt gemischt");
}

// ---- 2. Der Abschnitt mit Zuweisung: frei, der getippte Name bleibt, nur der Auto-Name ist aus -----------------------------------
{
	const z = kontext({ feature: pfad("rs-6", RS2), gruppe: null, name: "Alte Reichsstraße", autoname: true });
	z.rufe("syncPathAutoNameControls()");
	assert.strictEqual(z.elemente["path-edit-name"].readOnly, false, "am Abschnitt mit Zuweisung ist das Feld wieder gesperrt");
	assert.strictEqual(z.elemente["path-edit-name"].value, "Alte Reichsstraße", "die Sperre schreibt wieder den Artikelnamen ins Feld");
	assert.strictEqual(z.elemente["path-edit-autoname"].disabled, true, "der Auto-Name erzeugte am Wiki-Weg einen Maschinennamen -- er bleibt aus");
	assert.strictEqual(z.elemente["path-edit-autoname"].checked, false);

	const ohne = kontext({ feature: pfad("rs-7", null), gruppe: null, name: "Reichsstraße 2", autoname: false });
	ohne.rufe("syncPathAutoNameControls()");
	assert.strictEqual(ohne.elemente["path-edit-name"].readOnly, false);
	assert.strictEqual(ohne.elemente["path-edit-autoname"].disabled, false, "ohne Zuweisung bleibt der Auto-Name waehlbar");
}

// ---- 3. „Wegname anzeigen" steht an jedem Wiki-Weg da ----------------------------------------------------------------------------
{
	const z = kontext({ feature: pfad("rs-6", RS2), gruppe: null });
	z.rufe("pathWikiSyncNachbarn()");
	assert.strictEqual(z.zeigeLabel.hidden, false, "pathWikiSyncNachbarn blendet „Wegname anzeigen“ an einem Wiki-Weg wieder aus");
}

// ---- 4. Das Oeffnen: Vorbelegung, Haekchen, keine Sperre -------------------------------------------------------------------------
{
	// Ein Altsegment mit Maschinennamen trotz Zuweisung: im Feld steht, was die Karte zeigt (der Artikel), nicht die Nummer.
	const alt = pfad("rs-16", RS2, { display_name: "Reichsstrasse-16", show_label: true });
	const z = kontext({ feature: null, gruppe: null });
	z.k.alt = alt;
	z.rufe("populatePathEditForm(alt)");
	assert.strictEqual(z.elemente["path-edit-name"].value, "Reichsstraße 2", "ein Maschinenname landet im Feld statt des Kartentitels");
	assert.strictEqual(z.elemente["path-edit-name"].readOnly, false);
	assert.strictEqual(z.zeigeLabel.hidden, false, "populatePathEditForm blendet „Wegname anzeigen“ am Wiki-Weg aus");
	assert.strictEqual(z.elemente["path-edit-show-label"].checked, true, "das Haekchen zeigt den gespeicherten Stand");

	// Ein umbenannter zugewiesener Abschnitt: sein eigener Name, nicht der Artikel.
	const umbenannt = pfad("bp-1", BAERENPFAD, { display_name: "Alter Bärenpfad", feature_subtype: "Pfad", show_label: false });
	const u = kontext({ feature: null, gruppe: null });
	u.k.umbenannt = umbenannt;
	u.rufe("populatePathEditForm(umbenannt)");
	assert.strictEqual(u.elemente["path-edit-name"].value, "Alter Bärenpfad", "die Vorbelegung ersetzt den eigenen Namen durch den Artikel");
	assert.strictEqual(u.elemente["path-edit-show-label"].checked, false, "ein abgehakter Wiki-Weg zeigt das Haekchen leer");
	assert.strictEqual(u.zeigeLabel.hidden, false);
}

// ---- 5. Der Rumpf: gespeichert wird, was im Feld steht ---------------------------------------------------------------------------
{
	const z = kontext({ feature: pfad("bp-1", BAERENPFAD, { feature_subtype: "Pfad" }), gruppe: null });
	// „autoname" fehlt: ein gesperrtes Haekchen reist in FormData nicht mit.
	z.k.formular = { werte: { public_id: "bp-1", name: "Alter Bärenpfad", feature_subtype: "Pfad", show_label: "on" }, querySelectorAll: () => [] };
	const rumpf = z.rufe("buildPathEditPayload(formular)");
	assert.strictEqual(rumpf.name, "Alter Bärenpfad", "der Rumpf schickt wieder den Artikelnamen statt des getippten (R1-„defense in depth“)");
	assert.strictEqual(rumpf.show_label, true, "„Wegname anzeigen“ reist an einem Wiki-Weg mit");
}

// ---- 6. Zuweisen setzt den Artikelnamen -- also steht er danach im Feld ----------------------------------------------------------
(async () => {
	const z = kontext({ feature: pfad("rs-7", null, { display_name: "Alter Weg" }), gruppe: null, name: "Alter Weg" });
	await z.rufe("pathWikiZuweisen({ wiki_key: 'baerenpfad', roh: null })");
	assert.strictEqual(z.log.post.length, 1);
	assert.strictEqual(z.elemente["path-edit-name"].value, "Bärenpfad",
		"nach dem Zuweisen steht der alte Name im Feld -- das naechste Speichern drehte die Zuweisung still zurueck");

	// ---- 7. „Sync" holt den Artikelnamen ins Feld -- und merkt es sich --------------------------------------------------------------
	const s = kontext({ feature: pfad("bp-1", BAERENPFAD, { display_name: "Alter Bärenpfad" }), gruppe: null, name: "Alter Bärenpfad", typ: "Reichsstrasse" });
	s.rufe("pathWikiSyncUebernehmen([{ karte: 'name', neu: 'Bärenpfad' }, { karte: 'feature_subtype', neu: 'Pfad' }])");
	assert.strictEqual(s.elemente["path-edit-name"].value, "Bärenpfad", "Sync holt den Namen nicht ins Feld");
	assert.strictEqual(s.elemente["path-edit-type"].value, "Pfad");
	assert.deepStrictEqual([...s.rufe("Array.from(pathWikiUebernommen)")].sort(), ["feature_subtype", "name"],
		"ohne Merkliste stempelte der Server den geholten Namen als „von uns“");

	const nurName = kontext({ feature: pfad("bp-1", BAERENPFAD), gruppe: null, name: "Alter Bärenpfad", typ: "Reichsstrasse" });
	nurName.rufe("pathWikiSyncUebernehmen([{ karte: 'name', neu: 'Bärenpfad' }])");
	assert.strictEqual(nurName.elemente["path-edit-name"].value, "Bärenpfad");
	assert.strictEqual(nurName.elemente["path-edit-type"].value, "Reichsstrasse", "nur der Name angehakt: der Wegtyp bleibt");
	assert.deepStrictEqual([...nurName.rufe("Array.from(pathWikiUebernommen)")], ["name"]);

	// 💣 Erst pruefen, dann schreiben: ein unbekannter Wegtyp laesst auch den Namen stehen.
	const halb = kontext({ feature: pfad("bp-1", BAERENPFAD), gruppe: null, name: "Alter Bärenpfad" });
	assert.throws(() => halb.rufe("pathWikiSyncUebernehmen([{ karte: 'name', neu: 'Bärenpfad' }, { karte: 'feature_subtype', neu: 'Gibtsnicht' }])"),
		/Gibtsnicht/);
	assert.strictEqual(halb.elemente["path-edit-name"].value, "Alter Bärenpfad", "eine abgelehnte Uebernahme liess den Namen halb im Formular");
	assert.deepStrictEqual([...halb.rufe("Array.from(pathWikiUebernommen)")], []);
	assert.throws(() => halb.rufe("pathWikiSyncUebernehmen([{ karte: 'art', neu: 'Pfad' }])"), /Keine übernehmbare/);

	console.log("weg-dialog-namenssperre.test.js: ok");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
