"use strict";
// Wege-Editor: der Kasten „Wiki-Weg" am Abschnitt und auf der Weg-Ebene (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md
// §9.5, §9.6). Seit Lieferung 2 (Owner 15.09.2026, „Gleiche zusammenfassen" + „Je Zeile bearbeitbar") steht auf der Weg-Ebene
// statt EINES Bauteils eine Zeile je Hauptzuweisung (js/ui/wiki-weg-zeilen.js); jede schreibt GENAU ihre Abschnitte.
// AUSGEFUEHRT: die echte Seite in einem Sandkasten (dieselbe Bauform wie js/ui/__tests__/wiki-assign-weg.test.js), der Kasten der
// Weg-Ebene ist eine kleine DOM-Attrappe, die das gezeichnete Markup wirklich liest.
// Aus der Wurzel: node js/pages/__tests__/wege-editor-wiki-kasten.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const ruhe = () => new Promise((fertig) => setTimeout(fertig, 20));

function attrappe(name) {
	return {
		id: name, tagName: "DIV", value: "", checked: false, disabled: false, hidden: false,
		textContent: "", innerHTML: "", className: "", dataset: {}, style: {}, options: [],
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener() {},
		appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
		hasAttribute() { return false; },
		closest() { return null; },
		querySelector() { return attrappe("q"); },
		querySelectorAll() { return []; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
		focus() {}, dispatchEvent() { return true; }, contains() { return true; },
	};
}

/** Der Kasten der Weg-Ebene: liest beim Zeichnen die <details>-Zeilen und den Anhang-Platz aus dem Markup. */
function zeilenHost() {
	const b = attrappe("wpGroupWikiAssign");
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
					index: Number(m[1]), open: Boolean(m[2]), platz, zuhoerer: {},
					getAttribute: (n) => (n === "data-wiki-weg-zeile" ? m[1] : null),
					addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
					removeEventListener() {},
					querySelector: (sel) => (sel === "[data-wiki-weg-zeile-host]" ? platz : null),
				};
			});
			this.anhangPlatz = this._html.includes("data-wiki-weg-zeilen-anhang") ? { kinder: [], appendChild(kind) { this.kinder.push(kind); } } : null;
		},
	});
	return b;
}

/** Eine Zeile aufklappen, wie der Browser es meldet: `open` setzen, dann `toggle`. */
function aufklappen(details) {
	details.open = true;
	details.zuhoerer.toggle({ target: details });
}

const WEGE = [
	{ public_id: "p-1", name: "Alte Straße", echter_name: "Alte Straße", feature_subtype: "Strasse", show_label: true, allowed_transports: ["caravan"],
		transport_seasons: {}, wiki_path: { wiki_key: "alte-strasse", name: "Alte Straße", wiki_url: "https://x/Alte" },
		wiki_path_weitere: [], flow_direction: "", has_profile: true, bbox: [0, 0, 1, 0] },
	{ public_id: "p-2", name: "Alte Straße", echter_name: "Alte Straße", feature_subtype: "Strasse", show_label: true, allowed_transports: ["caravan"],
		transport_seasons: {}, wiki_path: { wiki_key: "alte-strasse", name: "Alte Straße", wiki_url: "https://x/Alte" },
		wiki_path_weitere: [], flow_direction: "", has_profile: true, bbox: [1, 0, 2, 0] },
	// R22: ein Abschnitt OHNE Hauptzuweisung, der noch eine weitere traegt (§9.5: die Zeile bleibt mit ✕ stehen).
	{ public_id: "p-3", name: "Einsamer Pfad", echter_name: "Einsamer Pfad", feature_subtype: "Pfad", show_label: true, allowed_transports: ["lightWalker"],
		transport_seasons: {}, wiki_path: null,
		wiki_path_weitere: [{ wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" }],
		flow_direction: "", has_profile: false, bbox: [5, 5, 6, 5] },
	// Fixrunde: ein zweiteiliger Weg OHNE Wiki-Zuweisung -- im Reiter „Fehlt" sichtbar, bis er einen Artikel bekommt.
	{ public_id: "p-4", name: "Neuer Weg", echter_name: "Neuer Weg", feature_subtype: "Weg", show_label: true, allowed_transports: ["caravan"],
		transport_seasons: {}, wiki_path: null, wiki_path_weitere: [], flow_direction: "", has_profile: true, bbox: [8, 0, 9, 0] },
	{ public_id: "p-5", name: "Neuer Weg", echter_name: "Neuer Weg", feature_subtype: "Weg", show_label: true, allowed_transports: ["caravan"],
		transport_seasons: {}, wiki_path: null, wiki_path_weitere: [], flow_direction: "", has_profile: true, bbox: [9, 0, 10, 0] },
];

// Die kanonischen Namen, die `assign_to` den Abschnitten gibt (R1).
const WIKI_NAMEN = { "alte-strasse": "Alte Straße", baerenstieg: "Bärenstieg" };

function sandkasten(weitereWege) {
	const elemente = { wpGroupWikiAssign: zeilenHost() };
	const gesendet = [];
	const fragen = [];
	// Je Sandkasten ein eigener Bestand: `assign_to`/`clear_assign`/`remove_weitere` schreiben ihn wie der Server.
	const wege = JSON.parse(JSON.stringify(WEGE.concat(weitereWege || [])));
	const dokument = {
		readyState: "complete",
		getElementById(id) { if (!elemente[id]) { elemente[id] = attrappe(id); } return elemente[id]; },
		querySelector() { return attrappe("q"); },
		querySelectorAll() { return []; },
		createElement(t) { return attrappe(t); },
		addEventListener() {},
		body: attrappe("body"), documentElement: attrappe("html"),
	};
	const kasten = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
		String, Array, Object, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, Set, Map,
		encodeURIComponent, decodeURIComponent, Promise, Event: function () {},
		document: dokument,
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		confirm: (text) => { fragen.push(String(text)); return true; },
		fetch(url, opt) {
			const rumpf = opt && opt.body ? JSON.parse(opt.body) : null;
			gesendet.push({ url: String(url), rumpf });
			let antwort = { ok: true };
			const ziele = rumpf ? (Array.isArray(rumpf.public_ids) ? rumpf.public_ids : [rumpf.public_id]) : [];
			if (String(url).indexOf("action=list") !== -1) { antwort = { ok: true, ways: JSON.parse(JSON.stringify(wege)), summary: { total: wege.length }, calibration: null }; }
			else if (String(url).indexOf("action=detail") !== -1) { antwort = { ok: true, length_units: 10, terrain: null, landscapes: [] }; }
			else if (rumpf && rumpf.action === "assign_to") {
				const name = WIKI_NAMEN[rumpf.wiki_key] || rumpf.wiki_key;
				wege.forEach((w) => {
					if (ziele.indexOf(w.public_id) === -1 || (w.wiki_path && w.wiki_path.wiki_key === rumpf.wiki_key)) { return; }
					w.wiki_path = { wiki_key: rumpf.wiki_key, name, wiki_url: "https://x/" + rumpf.wiki_key };
					w.name = name;
					// Der Server liefert den echten Namen mit (avesmapsWikiPathEchterName): nach dem Zuweisen der des Artikels.
					w.echter_name = name;
				});
				antwort = { ok: true, type_ok: true, applied: ziele.length, wiki_name: name, segments_updated: [] };
			}
			else if (rumpf && rumpf.action === "clear_assign") {
				// R2: jeder getroffene Abschnitt bekommt einen eigenen Maschinennamen -- und gehoert damit zu keiner Strasse mehr.
				wege.forEach((w, i) => {
					if (ziele.indexOf(w.public_id) === -1) { return; }
					w.wiki_path = null;
					w.name = w.feature_subtype + "-" + (900 + i);
					w.echter_name = "";
				});
				antwort = { ok: true, applied: ziele.length, segments: ziele.length, segments_updated: [] };
			}
			else if (rumpf && rumpf.action === "update_path_group_details") { antwort = { ok: true, written: 2 }; }
			else if (rumpf && rumpf.action === "remove_weitere") {
				wege.forEach((w) => {
					if (ziele.indexOf(w.public_id) !== -1) { w.wiki_path_weitere = (w.wiki_path_weitere || []).filter((e) => e.wiki_key !== rumpf.wiki_key); }
				});
				antwort = { ok: true, applied: ziele.length, skipped: [] };
			}
			return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(antwort) });
		},
		gemounted: [],
		weitereMounts: [],
		zeilenMounts: [],
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	["js/ui/filter-menu.js", "js/routing/travel-calendar.js", "js/pages/wege-editor-model.js", "js/ui/listen-statuskreis.js",
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js", "js/ui/wiki-assign-weg.js",
		"js/ui/wiki-weitere-kasten.js", "js/ui/wiki-weg-zeilen.js"].forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), kasten, { filename: datei });
	});
	vm.runInContext("var echterMount = avesmapsWikiAssignMount;"
		+ "avesmapsWikiAssignMount = function (b, o) { gemounted.push({ host: b, opts: o }); return echterMount(b, o); };"
		+ "var echterWeitere = avesmapsWikiWeitereKastenMount;"
		+ "avesmapsWikiWeitereKastenMount = function (h, o) { weitereMounts.push({ host: h, opts: o }); return echterWeitere(h, o); };"
		+ "var echteZeilen = avesmapsWikiWegZeilenMount;"
		+ "avesmapsWikiWegZeilenMount = function (h, o) { zeilenMounts.push({ host: h, opts: o }); return echteZeilen(h, o); };", kasten);
	vm.runInContext(fs.readFileSync(path.join(WURZEL, "js/pages/wege-editor.js"), "utf8"), kasten, { filename: "wege-editor.js" });
	return { kasten, elemente, gesendet, fragen };
}

const zeile = (attribute) => {
	const ziel = attrappe("row");
	ziel.closest = (sel) => (sel === ".avm-row" ? ziel : null);
	ziel.getAttribute = (n) => (Object.prototype.hasOwnProperty.call(attribute, n) ? attribute[n] : null);
	return ziel;
};
const letztes = (liste) => liste[liste.length - 1];

/** Fixrunde: den zweiteiligen „Neuer Weg" auf der Weg-Ebene waehlen -- nach `einrichten` (Reiter, Suche) -- und zuweisen. */
async function neuenWegZuweisen(einrichten) {
	const f = sandkasten();
	await ruhe();
	einrichten(f);
	f.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Neuer Weg" }), preventDefault() {} });
	await ruhe();
	const g = letztes(f.kasten.gemounted);
	assert.strictEqual(g.host, f.elemente.wpGroupWikiAssign.details[0].platz,
		"Vorbedingung: die Weg-Ebene von „Neuer Weg“ ist gewaehlt, ihre einzige Zeile offen");
	f.gesendet.length = 0;
	await g.opts.zuweisen({ wiki_key: "baerenstieg", name: "Bärenstieg", werte: {} });
	await ruhe();
	const zuweisung = f.gesendet.find((x) => x.rumpf && x.rumpf.action === "assign_to");
	assert.ok(zuweisung, "Vorbedingung: zugewiesen");
	assert.deepStrictEqual([...zuweisung.rumpf.public_ids], ["p-4", "p-5"]);
	return f;
}

/** Fixrunde: nach dem Zuweisen darf die Spalte nie mit einer Gruppe stehen bleiben, die es in der Liste nicht mehr gibt. */
function pruefeRueckfallAufAnker(f, wo) {
	assert.ok(f.gesendet.some((x) => x.url.indexOf("action=detail&public_id=p-4") !== -1),
		wo + ": die neue Gruppe ist ausgeblendet -- dann faellt die Auswahl auf den Ankerabschnitt, wie beim Entfernen: "
		+ JSON.stringify(f.gesendet.map((x) => x.url)));
	const danach = letztes(f.kasten.gemounted);
	assert.strictEqual(danach.host, f.elemente.wpWikiAssign, wo + ": danach steht der Kasten des Abschnitts, nicht der tote der Weg-Ebene");
	assert.strictEqual(danach.opts.laden().artikel.wiki_key, "baerenstieg", wo + ": und er kennt die neue Zuweisung (kein „Kein Weg gewählt.“)");
	assert.ok(!f.elemente.wpDetail.innerHTML.includes("Ganzer Weg"), wo + ": die Maske der Weg-Ebene ist abgeraeumt");
}

(async () => {
	const s = sandkasten();
	await ruhe();

	// ---- 1. Abschnitt: EIN Kasten, die weiteren Zuweisungen in seinem Anhang (unveraendert) -----------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-id": "p-1" }), preventDefault() {} });
	await ruhe();
	assert.ok(!s.elemente.wpDetail.innerHTML.includes('id="wpWikiWeitere"'), "der zweite Kasten am Abschnitt ist gefallen");
	const abschnitt = letztes(s.kasten.gemounted);
	assert.strictEqual(abschnitt.host, s.elemente.wpWikiAssign);
	assert.ok(abschnitt.opts.anhang, "der Kasten „Wiki-Weg“ bekommt einen Anhang");
	const weitereAbschnitt = letztes(s.kasten.weitereMounts);
	assert.strictEqual(weitereAbschnitt.host, abschnitt.opts.anhang, "die weiteren Zuweisungen haengen GENAU in diesem Anhang");
	assert.ok(!("haupt" in weitereAbschnitt.opts), "keine Hauptzeile");
	assert.notStrictEqual(weitereAbschnitt.opts.liste, false, "am Abschnitt bleibt die Liste mit ✕ im Anhang");
	assert.ok(!("wpWikiWeitere" in s.elemente), "niemand fragt mehr nach #wpWikiWeitere");
	assert.strictEqual(s.kasten.zeilenMounts.length, 0, "am Abschnitt keine Zeilenliste");
	// 🔴 SEIT 15.09.2026 (R1 umgekehrt, der Wegname gehoert dem Editor): am zugewiesenen Abschnitt ist der Name frei und „Wegname
	// anzeigen" steht da; nur der Auto-Name bleibt aus (er erzeugte einen Maschinennamen). Hier stand bis dahin die Sperre samt Hinweis
	// „„Weg anzeigen“ entfällt: die Beschriftung übernimmt das Way-Label des zugewiesenen Wiki-Weges.“
	const abschnittHtml = s.elemente.wpDetail.innerHTML;
	assert.ok(/id="wpName"/.test(abschnittHtml) && !/id="wpName"[^>]*readonly/.test(abschnittHtml), "der Abschnitt sperrt den Namen wieder");
	assert.ok(/id="wpShowLabel"/.test(abschnittHtml) && abschnittHtml.includes("Wegname anzeigen"), "„Wegname anzeigen“ fehlt am Wiki-Weg");
	assert.ok(/id="wpAutoName"[^>]*disabled/.test(abschnittHtml), "der Auto-Name ist am Wiki-Weg waehlbar -- er schriebe einen Maschinennamen");
	assert.ok(!abschnittHtml.includes("entfällt"), "der alte Hinweis „… entfällt“ steht noch da");

	// ---- 2. Weg-Ebene einer EINIGEN Strasse: EINE Zeile, aufgeklappt, darin das geteilte Bauteil ------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	assert.ok(s.elemente.wpDetail.innerHTML.includes('id="wpGroupWikiAssign"'), "die Weg-Ebene traegt den Kasten „Wiki-Weg“");
	assert.ok(!s.elemente.wpDetail.innerHTML.includes('id="wpGroupWikiWeitere"'), "der alte Einzelkasten ist gefallen");
	const kasten = s.elemente.wpGroupWikiAssign;
	const zeilenMount = letztes(s.kasten.zeilenMounts);
	assert.strictEqual(zeilenMount.host, kasten, "die Zeilenliste steht im Kasten der Weg-Ebene");
	assert.strictEqual(zeilenMount.opts.skin, "dt");
	assert.strictEqual(kasten.details.length, 1, "eine einige Strasse: EINE Zeile");
	assert.strictEqual(kasten.details[0].open, true, "… von Anfang an aufgeklappt -- der Normalfall sieht aus wie vorher");
	assert.ok(kasten.innerHTML.includes("2 Abschnitte · Abschnitt 1–2"), kasten.innerHTML.slice(0, 600));
	const gruppe = letztes(s.kasten.gemounted);
	assert.strictEqual(gruppe.host, kasten.details[0].platz, "das geteilte Bauteil haengt in der Zeile");
	assert.strictEqual(gruppe.opts.subject, "weg");
	assert.strictEqual(gruppe.opts.skin, "dt");
	const weitereGruppe = letztes(s.kasten.weitereMounts);
	assert.strictEqual(weitereGruppe.host, zeilenMount.opts.anhang, "der Kasten der weiteren Zuweisungen haengt EINMAL unter den Zeilen");
	assert.deepStrictEqual(kasten.anhangPlatz.kinder, [weitereGruppe.host]);
	assert.strictEqual(weitereGruppe.opts.umfangText(), "die ganze Straße");
	assert.strictEqual(weitereGruppe.opts.liste, false, "ohne eigene Liste -- die weiteren Zuweisungen stehen mit ✕ in den Zeilen");
	// R22: auch auf der Weg-Ebene reist das abgeschaffte `haupt` nicht mehr mit.
	assert.ok(!("haupt" in weitereGruppe.opts), "keine Hauptzeile auf der Weg-Ebene");
	assert.deepStrictEqual([...weitereGruppe.opts.abschnitte().map((a) => a.public_id)], ["p-1", "p-2"]);
	assert.strictEqual(gruppe.opts.laden().artikel.wiki_key, "alte-strasse", "der Stand des ersten Abschnitts der Zeile");

	// ---- 3. Zuweisen in der Zeile: GENAU ihre Abschnitte, ohne Rueckfrage, die Auswahl bleibt auf der Strasse -------------------
	s.gesendet.length = 0;
	s.fragen.length = 0;
	await gruppe.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} });
	await ruhe();
	const zuweisung = s.gesendet.find((g) => g.rumpf && g.rumpf.action === "assign_to");
	assert.ok(zuweisung, JSON.stringify(s.gesendet.map((g) => g.url)));
	assert.deepStrictEqual([...zuweisung.rumpf.public_ids], ["p-1", "p-2"], "Zuweisen gilt GENAU den Abschnitten der Zeile");
	assert.strictEqual(zuweisung.rumpf.public_id, "p-1");
	assert.strictEqual(s.fragen.length, 0, "Zuweisen fragt nicht -- keine Zeile schreibt auf Abschnitte einer anderen");
	assert.ok(s.elemente.wpDetail.innerHTML.includes("Ganzer Weg"), "die Auswahl bleibt auf der ganzen Strasse");

	// ---- 5. Sync auf der Weg-Ebene: das Sammel-Speichern schickt wiki_uebernommen ---------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	const gruppe3 = letztes(s.kasten.gemounted);
	gruppe3.opts.syncUebernehmen([{ karte: "feature_subtype", neu: "Reichsstrasse" }]);
	s.gesendet.length = 0;
	s.elemente.wpGroupSave.zuhoerer.click({ target: s.elemente.wpGroupSave, preventDefault() {} });
	await ruhe();
	const sammel = s.gesendet.find((g) => g.rumpf && g.rumpf.action === "update_path_group_details");
	assert.ok(sammel, JSON.stringify(s.gesendet.map((g) => g.rumpf)));
	assert.deepStrictEqual([...sammel.rumpf.fields], ["feature_subtype"]);
	assert.deepStrictEqual([...(sammel.rumpf.wiki_uebernommen || [])], ["feature_subtype"],
		"ohne wiki_uebernommen stempelte der Server die Uebernahme als „von uns“ (§9.5)");

	// ---- 5b. Sync holt den NAMEN in die Weg-Ebene (seit 15.09.2026) -- und das Sammel-Speichern schreibt ihn auf alle -----------
	// Owner: „Zuweisen setzt den Wiki-Namen wie heute; danach übernimmt ihn nur noch „Sync“ auf Knopfdruck.“
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	letztes(s.kasten.gemounted).opts.syncUebernehmen([{ karte: "name", neu: "Alte Reichsstraße" }]);
	assert.ok(/id="wpGroupName"[^>]*value="Alte Reichsstraße"/.test(s.elemente.wpDetail.innerHTML),
		"nach Sync zeigt das Namensfeld wieder den Vergleichsstand statt des Entwurfs: " + s.elemente.wpDetail.innerHTML.slice(0, 800));
	s.gesendet.length = 0;
	s.elemente.wpGroupSave.zuhoerer.click({ target: s.elemente.wpGroupSave, preventDefault() {} });
	await ruhe();
	const sammelName = s.gesendet.find((g) => g.rumpf && g.rumpf.action === "update_path_group_details");
	assert.ok(sammelName, JSON.stringify(s.gesendet.map((g) => g.rumpf)));
	assert.deepStrictEqual([...sammelName.rumpf.fields], ["name"], "der geholte Name wird nicht als angefasstes Feld geschrieben");
	assert.strictEqual(sammelName.rumpf.name, "Alte Reichsstraße");
	assert.deepStrictEqual([...(sammelName.rumpf.wiki_uebernommen || [])], ["name"], "der geholte Name reist nicht als Wiki-Uebernahme");

	// ---- 5c. „— gemischt lassen —“ ist keine Luecke (Review M2) -----------------------------------------------------------------------
	// Ein leeres Namensfeld der Weg-Ebene heisst gemischt (groupDraft.name === null). Der Zustand der Zeile muss dann den Artikelnamen
	// liefern -- sonst hakt die Sync-Vorschau den Artikelnamen fuer alle Abschnitte vor.
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	s.elemente.wpGroupName.value = "";
	s.elemente.wpGroupName.zuhoerer.input({ target: s.elemente.wpGroupName });
	const zustandGemischt = letztes(s.kasten.gemounted).opts.laden();
	assert.strictEqual(zustandGemischt.kartenwerte.name, "Alte Straße",
		"die Weg-Ebene meldet „gemischt lassen“ als leeren Namen -- die Sync-Vorschau hakte den Artikelnamen vor");

	// ---- 6. Ungespeicherte Weg-Ebene-Eingaben werden benannt, nicht still verworfen ------------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	const gruppe4 = letztes(s.kasten.gemounted);
	gruppe4.opts.syncUebernehmen([{ karte: "feature_subtype", neu: "Reichsstrasse" }]);
	const gruppe4b = letztes(s.kasten.gemounted);
	s.kasten.confirm = (text) => { s.fragen.push(String(text)); return false; };
	s.fragen.length = 0;
	s.gesendet.length = 0;
	let abgelehnt = false;
	await gruppe4b.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} }).catch(() => { abgelehnt = true; });
	assert.ok(abgelehnt && s.fragen.length === 1 && s.fragen[0].includes("ungespeicherte"), "gefragt und abgelehnt: " + JSON.stringify(s.fragen));
	assert.ok(!s.gesendet.some((g) => g.rumpf && g.rumpf.action === "assign_to"), "abgelehnt heisst: nichts geschickt");
	s.kasten.confirm = (text) => { s.fragen.push(String(text)); return true; };

	// ---- 7. R22: ✕ an einer weiteren Zuweisung OHNE Hauptzuweisung schreibt „remove_weitere“ ---------------------------
	// §9.5: die weiteren Zuweisungen bleiben stehen, wenn die Hauptzuweisung geht -- sonst waeren sie nicht mehr zu entfernen.
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-id": "p-3" }), preventDefault() {} });
	await ruhe();
	const einsam = letztes(s.kasten.gemounted);
	const weitereEinsam = letztes(s.kasten.weitereMounts);
	assert.strictEqual(weitereEinsam.host, einsam.opts.anhang, "auch ohne Hauptzuweisung haengt der Kasten im Anhang");
	assert.ok(weitereEinsam.host.innerHTML.includes('data-weitere-weg="b-renpfad"'),
		"die weitere Zuweisung steht mit ✕ da, obwohl der Abschnitt keine Hauptzuweisung hat: " + weitereEinsam.host.innerHTML);
	assert.ok(!weitereEinsam.host.innerHTML.includes("data-weitere-suche"), "ohne Hauptzuweisung kein Suchfeld (§2.2 Nr. 1)");
	s.gesendet.length = 0;
	const kreuz = { dataset: { weitereWeg: "b-renpfad" } };
	weitereEinsam.host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-weg]" ? kreuz : null) }, preventDefault() {} });
	await ruhe();
	const entfernt = s.gesendet.find((g) => g.rumpf && g.rumpf.action === "remove_weitere");
	assert.ok(entfernt, "das ✕ loest den Entfernen-Schreibweg aus: " + JSON.stringify(s.gesendet.map((g) => g.rumpf || g.url)));
	assert.strictEqual(entfernt.rumpf.wiki_key, "b-renpfad");
	assert.deepStrictEqual([...entfernt.rumpf.public_ids], ["p-3"]);

	// ---- 4. Entfernen in der Zeile einer einigen Strasse: EINE Frage, dann public_ids, dann der Ankerabschnitt ------------
	{
		const e = sandkasten();
		await ruhe();
		e.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
		await ruhe();
		const zeileE = letztes(e.kasten.gemounted);
		e.gesendet.length = 0;
		e.fragen.length = 0;
		await zeileE.opts.loesen();
		await ruhe();
		assert.strictEqual(e.fragen.length, 1, "genau eine Rueckfrage");
		assert.ok(e.fragen[0].includes("allen 2 Abschnitten") && e.fragen[0].includes("zerfällt"), e.fragen[0]);
		const loesen = e.gesendet.filter((g) => g.rumpf && g.rumpf.action === "clear_assign");
		assert.strictEqual(loesen.length, 1, "kein Trockenlauf mit „nur dieser Abschnitt?“ auf der Weg-Ebene");
		assert.deepStrictEqual([...loesen[0].rumpf.public_ids], ["p-1", "p-2"]);
		assert.ok(e.gesendet.some((g) => g.url.indexOf("action=detail&public_id=p-1") !== -1),
			"danach ist der Ankerabschnitt gewaehlt -- die ganze Strasse ist zerfallen");
	}

	// ---- 8. Fixrunde: Zuweisen im Reiter „Fehlt“ -- die neue Gruppe ist ausgeblendet ------------------------------------
	// 💣 findGroup ist GEFILTERT: nach der Zuweisung faellt „name:Bärenstieg“ aus dem Reiter „Fehlt“. Bis zur Fixrunde kehrte
	// selectGroup still zurueck, und die Spalte stand mit einem Entwurf da, dessen Gruppe es nicht mehr gab.
	const fehlt = await neuenWegZuweisen((f) => {
		f.elemente.wpTabs.children = [];
		const reiter = attrappe("tab");
		reiter.getAttribute = (n) => (n === "data-view" ? "missing" : null);
		f.elemente.wpTabs.zuhoerer.click({ target: { closest: (sel) => (sel === ".avm-tab" ? reiter : null) }, preventDefault() {} });
	});
	pruefeRueckfallAufAnker(fehlt, "Reiter „Fehlt“");

	// ---- 9. Fixrunde: dasselbe, wenn eine SUCHE die umbenannte Gruppe verbirgt -----------------------------------------
	const gesucht = await neuenWegZuweisen((f) => {
		f.elemente.wpSearch.zuhoerer.input({ target: { value: "Neuer" } });
	});
	pruefeRueckfallAufAnker(gesucht, "Suche „Neuer“");

	// ---- 10. Fixrunde, Gegenprobe: ohne Filter wird die neue Gruppe gewaehlt, nicht der Anker --------------------------
	const offen = await neuenWegZuweisen(() => {});
	const offenDanach = letztes(offen.kasten.gemounted);
	assert.strictEqual(offenDanach.host, offen.elemente.wpGroupWikiAssign.details[0].platz,
		"ohne Filter bleibt die Weg-Ebene gewaehlt -- jetzt als name:Bärenstieg, in ihrer einzigen Zeile");
	assert.strictEqual(offenDanach.opts.laden().artikel.wiki_key, "baerenstieg");
	assert.ok(!offen.gesendet.some((x) => x.url.indexOf("action=detail") !== -1), "kein Rueckfall, wenn die Gruppe sichtbar ist");

	// ---- 11. Lieferung 2: eine GEMISCHTE Strasse -- zwei Zeilen, jede fuer genau ihre Abschnitte -----------------------------
	// „Alte Straße" bekommt zwei Abschnitte OHNE Zuweisung und mit anderer Wegart; einer traegt eine weitere Zuweisung.
	const ohneZuweisung = (id, x, weitere) => ({ public_id: id, name: "Alte Straße", echter_name: "Alte Straße", feature_subtype: "Weg",
		show_label: true, allowed_transports: ["caravan"], transport_seasons: {}, wiki_path: null, wiki_path_weitere: weitere || [],
		flow_direction: "", has_profile: true, bbox: [x, 0, x + 1, 0] });
	const gemischtWege = () => [ohneZuweisung("p-6", 3, [{ wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" }]), ohneZuweisung("p-7", 4)];
	{
		const g = sandkasten(gemischtWege());
		await ruhe();
		g.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
		await ruhe();
		const gKasten = g.elemente.wpGroupWikiAssign;
		assert.strictEqual(gKasten.details.length, 2, "zwei Zeilen sichtbar");
		assert.ok(gKasten.details.every((d) => !d.open), "beide zugeklappt");
		assert.ok(gKasten.innerHTML.includes("Alte Straße ↗</a>") && gKasten.innerHTML.includes("2 Abschnitte · Abschnitt 1–2"), gKasten.innerHTML);
		assert.ok(gKasten.innerHTML.includes(">keine<") && gKasten.innerHTML.includes("2 Abschnitte · Abschnitt 3–4"), "„keine“ zuletzt, mit ihren Nummern");
		assert.ok(gKasten.innerHTML.includes("Bärenpfad auf 1"), "die weiteren Zuweisungen dieser Abschnitte mit „auf K“");
		// 🔴 SEIT 15.09.2026 KEINE NAMENSSPERRE MEHR (R1 umgekehrt, Owner am Gruppendialog „Bärenpfad": „der wegname lässt sich nicht
		// ändern. wenn ich umbenenne, soll das beim speichern für alle abschnitte gelten"). Hier stand „die Namenssperre bleibt: eine
		// Zeile traegt eine Zuweisung" -- umgestellt, nicht geloescht: dieselbe Strasse, dieselbe Zuweisung, die Gegenaussage.
		assert.ok(/id="wpGroupName"/.test(g.elemente.wpDetail.innerHTML) && !/id="wpGroupName"[^>]*readonly/.test(g.elemente.wpDetail.innerHTML),
			"die Weg-Ebene sperrt den Namen wieder, obwohl er dem Editor gehoert");
		assert.ok(/id="wpGroupShowLabel"/.test(g.elemente.wpDetail.innerHTML) && g.elemente.wpDetail.innerHTML.includes("Wegname anzeigen"),
			"„Wegname anzeigen“ fehlt an einer Strasse mit Zuweisung -- der Editor haette keine Kontrolle ueber die Kartenschrift");
		assert.deepStrictEqual([...letztes(g.kasten.weitereMounts).opts.abschnitte().map((a) => a.public_id)], ["p-1", "p-2", "p-6", "p-7"],
			"der Kasten der weiteren Zuweisungen gilt der ganzen Strasse");
		assert.strictEqual(letztes(g.kasten.weitereMounts).opts.hauptKey(), "alte-strasse",
			"… und bietet die Suche an, sobald eine Zeile eine Zuweisung traegt -- nicht nur, wenn der westlichste Abschnitt eine hat");

		// ✕ an der weiteren Zuweisung der Zeile „keine": GENAU deren Traeger in dieser Zeile.
		g.gesendet.length = 0;
		const knopf = { getAttribute: (n) => (n === "data-wiki-weg-weitere" ? "b-renpfad" : null),
			closest: (sel) => (sel === "[data-wiki-weg-zeile]" ? gKasten.details[1] : null) };
		gKasten.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-wiki-weg-weitere]" ? knopf : null) }, preventDefault() {} });
		await ruhe();
		const weg = g.gesendet.find((x) => x.rumpf && x.rumpf.action === "remove_weitere");
		assert.ok(weg, "das ✕ der Zeile schreibt: " + JSON.stringify(g.gesendet.map((x) => x.rumpf || x.url)));
		assert.strictEqual(weg.rumpf.wiki_key, "b-renpfad");
		assert.deepStrictEqual([...weg.rumpf.public_ids], ["p-6"], "✕ entfernt die weitere Zuweisung von den Abschnitten DIESER Zeile");
		assert.ok(g.elemente.wpDetail.innerHTML.includes("Ganzer Weg") && !gKasten.innerHTML.includes("Bärenpfad"), "neu gezeichnet, Auswahl bleibt");

		// Aufklappen der Zeile „keine" montiert das Bauteil.
		const vorher = g.kasten.gemounted.length;
		const keine = gKasten.details[1];
		aufklappen(keine);
		assert.strictEqual(g.kasten.gemounted.length, vorher + 1, "Aufklappen montiert das Bauteil");
		const gKeine = letztes(g.kasten.gemounted);
		assert.strictEqual(gKeine.host, keine.platz, "… in genau dieser Zeile");
		assert.strictEqual(gKeine.opts.laden().artikel, null, "der Stand des ersten Abschnitts der Zeile: keine Zuweisung");

		// Fixrunde L2: „Sync" in einer Zeile einer GEMISCHTEN Strasse lehnt ab -- sonst schriebe das Sammel-Speichern den Wegtyp dieses
		// Artikels samt Herkunft „wiki" auf ALLE Abschnitte, auch auf die der anderen Zeile. Ein Nein laesst den Entwurf unberuehrt.
		let syncNein = null;
		try { await Promise.resolve(gKeine.opts.syncUebernehmen([{ karte: "feature_subtype", neu: "Reichsstrasse" }])); } catch (fehler) { syncNein = fehler; }
		assert.ok(syncNein && /gemischter Straße/.test(syncNein.message), "Sync lehnt bei mehreren Zeilen ab: " + (syncNein && syncNein.message));
		g.gesendet.length = 0;
		g.elemente.wpGroupSave.zuhoerer.click({ target: g.elemente.wpGroupSave, preventDefault() {} });
		await ruhe();
		assert.ok(!g.gesendet.some((x) => x.rumpf && x.rumpf.action === "update_path_group_details"),
			"… und nichts ist im Entwurf gelandet: " + JSON.stringify(g.gesendet.map((x) => x.rumpf || x.url)));

		// Zuweisen in „keine": GENAU p-6, p-7 -- ohne die Rueckfrage „gemischte Strasse" aus Lieferung 1.
		g.fragen.length = 0;
		g.gesendet.length = 0;
		await gKeine.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} });
		await ruhe();
		const zuw = g.gesendet.filter((x) => x.rumpf && x.rumpf.action === "assign_to");
		assert.strictEqual(zuw.length, 1);
		assert.deepStrictEqual([...zuw[0].rumpf.public_ids], ["p-6", "p-7"], "Zuweisen in der Zeile „keine“ schickt GENAU deren public_ids");
		assert.strictEqual(zuw[0].rumpf.public_id, "p-6", "Anker ist der erste Abschnitt der Zeile");
		assert.strictEqual(g.fragen.length, 0, "keine Rueckfrage");
		// Nach dem Schreiben: die Liste ist neu gebildet, die Auswahl bleibt auf der ganzen Strasse.
		assert.ok(g.elemente.wpDetail.innerHTML.includes("Ganzer Weg"), "die Auswahl bleibt auf der ganzen Strasse");
		assert.strictEqual(g.elemente.wpGroupWikiAssign.details.length, 1, "die Abschnitte sind in die Zeile „Alte Straße“ gewandert");
		assert.ok(g.elemente.wpGroupWikiAssign.innerHTML.includes("4 Abschnitte · Abschnitt 1–4"), g.elemente.wpGroupWikiAssign.innerHTML.slice(0, 500));
	}
	{
		// Entfernen in der zugewiesenen Zeile: fragt mit der Zahl DIESER Zeile, ein Nein schreibt nichts, ein Ja GENAU ihre Abschnitte.
		const h = sandkasten(gemischtWege());
		await ruhe();
		h.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
		await ruhe();
		aufklappen(h.elemente.wpGroupWikiAssign.details[0]);
		const hZeile = letztes(h.kasten.gemounted);
		assert.strictEqual(hZeile.opts.laden().artikel.wiki_key, "alte-strasse");
		h.fragen.length = 0;
		h.gesendet.length = 0;
		h.kasten.confirm = (text) => { h.fragen.push(String(text)); return false; };
		let nein = false;
		await hZeile.opts.loesen().catch(() => { nein = true; });
		assert.ok(nein && h.fragen.length === 1, "abgebrochen ist abgelehnt: " + JSON.stringify(h.fragen));
		assert.ok(h.fragen[0].includes("2 der 4 Abschnitte") && h.fragen[0].includes("nicht mehr zur Straße"), h.fragen[0]);
		assert.ok(!h.gesendet.some((x) => x.rumpf && x.rumpf.action === "clear_assign"), "ein Nein schreibt nichts");
		h.kasten.confirm = (text) => { h.fragen.push(String(text)); return true; };
		h.fragen.length = 0;
		await hZeile.opts.loesen();
		await ruhe();
		assert.strictEqual(h.fragen.length, 1, "Entfernen fragt immer -- einmal");
		const clears = h.gesendet.filter((x) => x.rumpf && x.rumpf.action === "clear_assign");
		assert.strictEqual(clears.length, 1);
		assert.deepStrictEqual([...clears[0].rumpf.public_ids], ["p-1", "p-2"], "Entfernen schickt clear_assign mit GENAU den public_ids der Zeile");
		// R2 hat p-1 und p-2 generisch benannt -- sie gehoeren nicht mehr zur Strasse. Die Strasse (p-6, p-7) bleibt gewaehlt.
		assert.ok(h.elemente.wpDetail.innerHTML.includes("Ganzer Weg"), "die Auswahl bleibt auf der ganzen Strasse");
		const hKasten = h.elemente.wpGroupWikiAssign;
		assert.strictEqual(hKasten.details.length, 1, "neu gebildet: nur noch die Zeile „keine“");
		assert.ok(hKasten.innerHTML.includes(">keine<") && hKasten.innerHTML.includes("2 Abschnitte · Abschnitt 1–2"), hKasten.innerHTML.slice(0, 500));
	}

	// ---- 12. Die Seite laedt das Bauteil -- vor js/pages/wege-editor.js ------------------------------------------------------
	const seite = fs.readFileSync(path.join(WURZEL, "html/wege-editor.html"), "utf8").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
	const zeilenTag = seite.indexOf('<script src="/js/ui/wiki-weg-zeilen.js"></script>');
	assert.ok(zeilenTag > seite.indexOf('<script src="/js/ui/wiki-assign.js"></script>') && zeilenTag < seite.indexOf('<script src="/js/pages/wege-editor.js"></script>'),
		"html/wege-editor.html laedt js/ui/wiki-weg-zeilen.js nach dem Bauteil und vor dem Wege-Editor");

	console.log("wege-editor-wiki-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
