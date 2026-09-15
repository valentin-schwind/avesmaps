"use strict";
// Kartendialog „Weg bearbeiten" fuer die GANZE Strasse: im Kasten „Wiki-Weg" stehen die Zeilen je Hauptzuweisung -- und bleiben stehen.
//
// 💣 DER BEFUND (live gemessen 15.09.2026, Bearbeiten-Modus, Reichsstraße 2 mit 67 Abschnitten): beim Oeffnen stand statt der zwei
// Zeilen (49 + 18) der alte Einzelkasten des angeklickten Abschnitts da. populatePathEditFormGruppe -> populatePathEditForm ->
// renderPathWikiReference montierte das Bauteil in #path-wiki-assign-host, renderPathWikiGruppenZeilen baute es im selben Zug ab und
// zeichnete die Zeilen in denselben Behaelter -- und die Fortsetzung von `neuLaden` des abgebauten Bauteils (eine Zusage, auch bei
// synchronem `laden`) zeichnete danach den alten Kasten darueber. Von Hand gerufen standen die Zeilen, weil dann kein Ladelauf mehr
// unterwegs war.
//
// Zwei Riegel, beide hier AUSGEFUEHRT gegen die echten Dateien (Muster: weg-dialog-wiki-kasten.test.js):
//   A. die Wurzel im Bauteil (js/ui/wiki-assign.js, `zerstoert`) -- renderPathWikiReference und renderPathWikiGruppenZeilen direkt
//      hintereinander, mit synchronem und mit verzoegertem `laden`;
//   B. der Gruppendialog montiert den Kasten des Abschnitts gar nicht erst (review-paths.js, `ganzeStrasse`) -- populatePathEditFormGruppe
//      samt populatePathEditForm wirklich gefahren;
//   C. die Infobox zieht nach einer Zuweisung in einer Zeile trotzdem GENAU EINMAL nach -- das abgebaute Bauteil tut es nicht mehr, die
//      Zeilen tun es selbst (pathWikiNachZeilenSchreiben).
// Aus der Wurzel: node js/review/__tests__/weg-dialog-zeilen-nach-einzelkasten.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
// 🪤 Mit vorangestelltem Zeilenumbruch: populatePathEditForm stand bis zum 15.09.2026 in der ERSTEN Zeile von review-paths.js, und
// ein Suchmuster `\nfunction …` fand es dort nie -- der Test fiel dann an „Funktion fehlt" statt am Befund.
const funktion = (roh, name) => {
	const text = "\n" + roh;
	let a = text.indexOf("\nasync function " + name + "(");
	if (a < 0) { a = text.indexOf("\nfunction " + name + "("); }
	assert.ok(a >= 0, "Funktion fehlt: " + name);
	const e = text.indexOf("\n}\n", a);
	return text.slice(a, e + 3);
};
const QUELLE = lies("js/review/review-path-wiki.js");
const PFADE_QUELLE = lies("js/review/review-paths.js");

const warte = (ms) => new Promise((fertig) => setTimeout(fertig, ms || 0));

function attrappe(name) {
	return {
		id: name, innerHTML: "", textContent: "", value: "", checked: false, disabled: false, hidden: false, required: false,
		indeterminate: false, placeholder: "", dataset: {}, zuhoerer: {}, firstChild: null,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; }, removeEventListener(typ) { delete this.zuhoerer[typ]; },
		appendChild() {}, insertBefore() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return attrappe(name + "-label"); }, querySelector() { return attrappe("q"); }, querySelectorAll() { return []; },
		focus() {}, contains() { return true; },
	};
}

/** Der Behaelter #path-wiki-assign-host -- wie in weg-dialog-wiki-kasten.test.js: `innerHTML` wird zu <details>-Attrappen. */
function zeilenHost() {
	const b = attrappe("path-wiki-assign-host");
	b.details = [];
	b.anhangPlatz = null;
	b._html = "";
	b.querySelectorAll = (sel) => (sel === "[data-wiki-weg-zeile]" ? b.details : []);
	b.querySelector = (sel) => (sel === "[data-wiki-weg-zeilen-anhang]" ? b.anhangPlatz : null);
	b.removeEventListener = function (typ, fn) { if (this.zuhoerer[typ] === fn) { delete this.zuhoerer[typ]; } };
	Object.defineProperty(b, "innerHTML", {
		get() { return this._html; },
		set(wert) {
			this._html = String(wert);
			this.details = [...this._html.matchAll(/<details class="wiki-weg-zeile" data-wiki-weg-zeile="(\d+)"( open)?>/g)].map((m) => {
				const platz = attrappe("platz-" + m[1]);
				return {
					open: Boolean(m[2]), platz, zuhoerer: {},
					getAttribute: (n) => (n === "data-wiki-weg-zeile" ? m[1] : null),
					addEventListener(typ, fn) { this.zuhoerer[typ] = fn; }, removeEventListener() {},
					querySelector: (sel) => (sel === "[data-wiki-weg-zeile-host]" ? platz : null),
				};
			});
			this.anhangPlatz = this._html.includes("data-wiki-weg-zeilen-anhang") ? { kinder: [], appendChild(kind) { this.kinder.push(kind); } } : null;
		},
	});
	return b;
}

function scheinZiel(merkmal, wert) {
	const element = { getAttribute: (n) => (n === merkmal ? wert : null), hasAttribute: (n) => n === merkmal, value: "" };
	element.closest = (sel) => (sel === "[" + merkmal + "]" ? element : null);
	return element;
}

const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://x/RS2" };
const kartenPfad = (id, wiki) => ({ properties: { public_id: id, display_name: "Reichsstraße 2", feature_subtype: "Reichsstrasse",
	wiki_path: wiki, wiki_path_weitere: [] } });
const gemischt = () => [kartenPfad("rs-6", RS2), kartenPfad("rs-7", null), kartenPfad("rs-8", RS2), kartenPfad("rs-9", null)];
const einig = () => [kartenPfad("rs-6", RS2), kartenPfad("rs-7", RS2), kartenPfad("rs-8", RS2)];
const ZEILEN_HUELLE = '<div class="label-wiki-reference wiki-weg-zeilen">';

function kontext(pfade) {
	const log = { laden: 0, abweichungen: 0, infobox: 0, post: [], nachGruppe: 0, zurueckgehalten: [] };
	const host = zeilenHost();
	const elemente = {};
	const element = (id) => {
		if (id === "path-wiki-assign-host") { return host; }
		if (!elemente[id]) { elemente[id] = attrappe(id); }
		return elemente[id];
	};
	const k = { console, Promise, JSON, Math, Date, Number, String, Array, Object, Boolean, RegExp, Error, Map, Set, isFinite, isNaN,
		parseInt, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, gemounted: [] };
	k.window = k;
	k.globalThis = k;
	vm.createContext(k);
	["js/pages/wege-editor-model.js", "js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-weg.js", "js/ui/wiki-weitere-kasten.js", "js/ui/wiki-weg-zeilen.js", "js/review/path-gruppe.js"].forEach((datei) => {
		vm.runInContext(lies(datei), k, { filename: datei });
	});
	vm.runInContext("var echterMount = avesmapsWikiAssignMount;"
		+ "avesmapsWikiAssignMount = function (b, o) { gemounted.push({ host: b, opts: o }); return echterMount(b, o); };", k);
	Object.assign(k, {
		document: { getElementById: element, querySelectorAll: () => [], createElement: () => attrappe("neu") },
		pathEditFeature: null, pathEditGruppe: null, pathWikiAssign: null, pathGruppeVerdrahtet: true,
		// Die Suche des Bauteils (Objektart `weg` sucht beim Server).
		fetch: async () => ({ ok: true, json: async () => ({ rows: [{ name: "Reichsstraße 2", wiki_key: "reichsstrasse-2", wiki_url: "https://x/RS2" }] }) }),
		avesmapsRefreshInfopanel: () => { log.infobox += 1; },
		// populatePathEditForm / populatePathEditFormGruppe (review-paths.js)
		getPathEditFormElement: () => attrappe("path-edit-form"),
		normalizePathSubtype: (wert) => String(wert || "Weg"),
		acquireFeatureSoftLock: async () => {},
		getPathDisplayName: (p) => p.properties.display_name,
		shouldPathNameBeDisplayed: () => true,
		getPathAllowedTransports: () => [],
		pathIstBach: () => false,
		syncPathTransportOptions: () => {}, syncPathAutoNameControls: () => {}, resetPathWikiUebernommen: () => {},
		renderPathFlowSection: () => {}, mountPathEditFeatureSources: () => {}, pathEditUmfangZeigen: () => {}, mountPathWikiWeitere: () => {},
		pathEditGruppenModus: () => {}, pathEditTransportSchluessel: () => [], getTransportOptionsForPathSubtype: () => [],
		pathGruppeHakenGeaendert: () => {},
		avesmapsWegGruppenSchluessel: () => "name:Reichsstraße 2",
		getPathPublicId: (p) => p.properties.public_id,
		// Die Abweichungszeile am Wegtyp: gezaehlt, nicht gezeichnet.
		pathWikiZeichneAbweichungen: () => { log.abweichungen += 1; },
		// Werte, die renderPathWikiReference beim Montieren liest -- am Abschnitt, hier nicht Gegenstand.
		pathWikiZuweisen: async () => {}, pathWikiLoesen: async () => {}, pathWikiSyncUebernehmen: () => {},
		pathWikiWeitereAnhang: () => null,
		// Die Zeilen schreiben (review-path-wiki.js)
		pathWikiPost: async (rumpf) => {
			log.post.push(rumpf);
			const ids = Array.isArray(rumpf.public_ids) ? rumpf.public_ids : [];
			return { ok: true, type_ok: true, applied: ids.length, segments: ids.length, wiki_name: "Reichsstraße 2", segments_updated: [] };
		},
		applyWikiPathSegmentsUpdate: () => {},
		pathEditGruppeNachWikiSchreiben: () => { log.nachGruppe += 1; },
		pathWikiWeitereUebernehmen: () => {},
		pollLiveMapUpdates: () => Promise.resolve(),
		showFeedbackToast: () => {},
		confirm: () => true,
	});
	vm.runInContext(["pathWikiElement", "pathWikiCurrentFeaturePublicId", "pathWikiCurrentAssignment", "pathWikiZustand", "pathWikiSyncNachbarn",
		"pathWikiGruppenZeilen", "pathWikiZeileZustand", "pathWikiGruppenZeilenNeuZeichnen", "pathWikiNachZeilenSchreiben", "pathWikiZeileZuweisen",
		"pathWikiZeileLoesen", "pathWikiZeileWeitereEntfernen", "renderPathWikiGruppenZeilen", "renderPathWikiReference"]
		.map((name) => funktion(QUELLE, name)).join("\n")
		+ funktion(PFADE_QUELLE, "populatePathEditForm") + funktion(PFADE_QUELLE, "populatePathEditFormGruppe")
		// Seit 15.09.2026 belegt populatePathEditForm das Namensfeld ueber diesen Helfer vor (der Titel der Karte statt einer Nummer).
		+ funktion(PFADE_QUELLE, "pathEditNameVorbelegung"), k);
	// Das echte `laden` des Abschnitts, gezaehlt -- und auf Wunsch zurueckgehalten, bis der Test es freigibt.
	const echtesLaden = k.pathWikiZustand;
	const zaehlend = (verzoegert) => {
		k.pathWikiZustand = () => {
			log.laden += 1;
			if (!verzoegert) { return echtesLaden(); }
			return new Promise((aufloesen) => { log.zurueckgehalten.push(() => aufloesen(echtesLaden())); });
		};
	};
	return { k, log, host, zaehlend, rufe: (name) => vm.runInContext(name, k) };
}

function pruefeZeilen(fall, z, anzahl) {
	assert.ok(z.host.innerHTML.startsWith(ZEILEN_HUELLE),
		fall + ": im Kasten stehen die Zeilen der ganzen Strasse, nicht der alte Kasten des Abschnitts -- innerHTML: " + z.host.innerHTML.slice(0, 120));
	assert.strictEqual(z.host.details.length, anzahl, fall + ": eine Zeile je Hauptzuweisung");
}

(async () => {
	// ---- A. Die Wurzel im Bauteil: der abgebaute Kasten des Abschnitts zeichnet nicht ueber die Zeilen -------------------------------
	for (const verzoegert of [false, true]) {
		const fall = "A (" + (verzoegert ? "verzoegertes" : "synchrones") + " laden)";
		const pfade = gemischt();
		const z = kontext(pfade);
		z.zaehlend(verzoegert);
		z.k.pathEditFeature = pfade[1];
		z.k.pathEditGruppe = { pfade, stand: {}, schluessel: "name:Reichsstraße 2" };
		// Die Reihenfolge von populatePathEditFormGruppe bis zum 15.09.2026: erst der Kasten des Abschnitts, dann die Zeilen.
		z.rufe("renderPathWikiReference")();
		assert.strictEqual(z.log.laden, 1, fall + ": der Kasten des Abschnitts laedt (sonst prueft der Rest nichts)");
		z.rufe("renderPathWikiGruppenZeilen")();
		pruefeZeilen(fall + ", sofort", z, 2);
		z.log.zurueckgehalten.forEach((freigeben) => freigeben());
		await warte();
		await warte();
		pruefeZeilen(fall + ", nach dem Ladelauf", z, 2);
		await warte(50);
		pruefeZeilen(fall + ", spaeter", z, 2);
	}

	// ---- B. Der Gruppendialog montiert den Kasten des Abschnitts gar nicht erst ------------------------------------------------------
	for (const verzoegert of [false, true]) {
		const fall = "B (" + (verzoegert ? "verzoegertes" : "synchrones") + " laden)";
		const pfade = gemischt();
		const z = kontext(pfade);
		z.zaehlend(verzoegert);
		z.rufe("populatePathEditFormGruppe")(pfade[1], pfade);
		const einzelkaesten = z.k.gemounted.filter((eintrag) => eintrag.host === z.host);
		assert.strictEqual(einzelkaesten.length, 0, fall + ": kein Kasten des Abschnitts in #path-wiki-assign-host");
		assert.strictEqual(z.log.laden, 0, fall + ": also auch kein `laden` des Abschnitts");
		assert.strictEqual(z.log.abweichungen, 1, fall + ": die Abweichungszeile am Wegtyp wird weiter gezeichnet, wie mit dem Kasten");
		pruefeZeilen(fall + ", sofort", z, 2);
		z.log.zurueckgehalten.forEach((freigeben) => freigeben());
		await warte();
		await warte();
		pruefeZeilen(fall + ", nach dem Ladelauf", z, 2);
		assert.strictEqual(z.k.pathEditGruppe.pfade.length, 4, fall + ": der Grundstand der ganzen Strasse steht");
	}
	// Gegenprobe: am einzelnen Abschnitt bleibt der Kasten, wie er war.
	{
		const pfade = gemischt();
		const z = kontext(pfade);
		z.zaehlend(false);
		z.rufe("populatePathEditForm")(pfade[0]);
		assert.strictEqual(z.k.gemounted.filter((eintrag) => eintrag.host === z.host).length, 1, "am Abschnitt montiert populatePathEditForm den Kasten");
		assert.strictEqual(z.log.laden, 1);
		await warte();
		assert.ok(z.host.innerHTML.startsWith('<div class="label-wiki-reference">') && z.host.innerHTML.includes("Reichsstraße 2"),
			"… und er zeichnet seinen Stand: " + z.host.innerHTML.slice(0, 120));
	}

	// ---- C. Zuweisen in einer Zeile: die Zeilen zeichnen sich neu, die Infobox zieht GENAU EINMAL nach -----------------------------
	{
		const pfade = einig();
		const z = kontext(pfade);
		z.k.pathEditFeature = pfade[0];
		z.k.pathEditGruppe = { pfade, stand: {}, schluessel: "name:Reichsstraße 2" };
		z.rufe("renderPathWikiGruppenZeilen")();
		pruefeZeilen("C", z, 1);
		const zeile = z.host.details[0];
		const bauteil = z.k.gemounted[z.k.gemounted.length - 1];
		assert.strictEqual(bauteil.host, zeile.platz, "C: die einzige Zeile ist offen und traegt das Bauteil");
		await warte();
		// Durch das Bauteil: Suche oeffnen, Treffer waehlen (ein `click` ohne Zeiger, wie Enter).
		zeile.platz.zuhoerer.click({ target: scheinZiel("data-wa-aktion", "zuweisen"), detail: 0, preventDefault() {} });
		await warte();
		await warte();
		zeile.platz.zuhoerer.click({ target: scheinZiel("data-wa-treffer", "0"), detail: 0, preventDefault() {} });
		for (let i = 0; i < 6; i += 1) { await warte(); }
		assert.deepStrictEqual(z.log.post.map((r) => [r.action, [...r.public_ids]]), [["assign_to", ["rs-6", "rs-7", "rs-8"]]], "C: die Zeile schreibt ihre Abschnitte");
		assert.strictEqual(z.log.nachGruppe, 1, "C: der Vergleichsstand der Strasse wird neu gerechnet");
		assert.notStrictEqual(z.host.details[0], zeile, "C: die Zeilen sind neu gezeichnet -- das Bauteil der alten Zeile ist abgebaut");
		assert.strictEqual(zeile.platz.innerHTML, "", "C: das abgebaute Bauteil zeichnet nach seiner Zuweisung nicht mehr in seinen alten Platz: "
			+ zeile.platz.innerHTML.slice(0, 120));
		assert.strictEqual(z.log.infobox, 1, "C: die Infobox zieht nach der Zuweisung genau einmal nach -- von den Zeilen, nicht vom abgebauten Bauteil");
		pruefeZeilen("C, danach", z, 1);
	}

	console.log("weg-dialog-zeilen-nach-einzelkasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
