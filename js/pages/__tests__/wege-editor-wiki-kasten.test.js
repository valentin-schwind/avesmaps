"use strict";
// Wege-Editor: EIN Kasten „Wiki-Weg" am Abschnitt und auf der Weg-Ebene (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md
// §9.5, §9.6). AUSGEFUEHRT: die echte Seite in einem Sandkasten (dieselbe Bauform wie js/ui/__tests__/wiki-assign-weg.test.js).
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
	const elemente = {};
	const gesendet = [];
	const fragen = [];
	// Je Sandkasten ein eigener Bestand: `assign_to` schreibt ihn wie der Server (R1 benennt um, wiki_path wird gesetzt).
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
			if (String(url).indexOf("action=list") !== -1) { antwort = { ok: true, ways: JSON.parse(JSON.stringify(wege)), summary: { total: wege.length }, calibration: null }; }
			else if (String(url).indexOf("action=detail") !== -1) { antwort = { ok: true, length_units: 10, terrain: null, landscapes: [] }; }
			else if (rumpf && rumpf.action === "assign_to") {
				const name = WIKI_NAMEN[rumpf.wiki_key] || rumpf.wiki_key;
				const ziele = Array.isArray(rumpf.public_ids) ? rumpf.public_ids : [rumpf.public_id];
				wege.forEach((w) => {
					if (ziele.indexOf(w.public_id) === -1 || (w.wiki_path && w.wiki_path.wiki_key === rumpf.wiki_key)) { return; }
					w.wiki_path = { wiki_key: rumpf.wiki_key, name, wiki_url: "https://x/" + rumpf.wiki_key };
					w.name = name;
					// Der Server liefert den echten Namen mit (avesmapsWikiPathEchterName): nach R1 der des Artikels.
					w.echter_name = name;
				});
				antwort = { ok: true, type_ok: true, applied: ziele.length, wiki_name: name, segments_updated: [] };
			}
			else if (rumpf && rumpf.action === "clear_assign") { antwort = { ok: true, applied: 2, segments: 2, segments_updated: [] }; }
			else if (rumpf && rumpf.action === "update_path_group_details") { antwort = { ok: true, written: 2 }; }
			else if (rumpf && rumpf.action === "remove_weitere") { antwort = { ok: true, applied: 1, skipped: [] }; }
			return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(antwort) });
		},
		gemounted: [],
		weitereMounts: [],
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	["js/ui/filter-menu.js", "js/routing/travel-calendar.js", "js/pages/wege-editor-model.js", "js/ui/listen-statuskreis.js",
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js", "js/ui/wiki-assign-weg.js",
		"js/ui/wiki-weitere-kasten.js"].forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), kasten, { filename: datei });
	});
	vm.runInContext("var echterMount = avesmapsWikiAssignMount;"
		+ "avesmapsWikiAssignMount = function (b, o) { gemounted.push({ host: b, opts: o }); return echterMount(b, o); };"
		+ "var echterWeitere = avesmapsWikiWeitereKastenMount;"
		+ "avesmapsWikiWeitereKastenMount = function (h, o) { weitereMounts.push({ host: h, opts: o }); return echterWeitere(h, o); };", kasten);
	vm.runInContext(fs.readFileSync(path.join(WURZEL, "js/pages/wege-editor.js"), "utf8"), kasten, { filename: "wege-editor.js" });
	return { kasten, elemente, gesendet, fragen };
}

const zeile = (attribute) => {
	const ziel = attrappe("row");
	ziel.closest = (sel) => (sel === ".avm-row" ? ziel : null);
	ziel.getAttribute = (n) => (Object.prototype.hasOwnProperty.call(attribute, n) ? attribute[n] : null);
	return ziel;
};

/** Fixrunde: den zweiteiligen „Neuer Weg" auf der Weg-Ebene waehlen -- nach `einrichten` (Reiter, Suche) -- und zuweisen. */
async function neuenWegZuweisen(einrichten) {
	const f = sandkasten();
	await ruhe();
	einrichten(f);
	f.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Neuer Weg" }), preventDefault() {} });
	await ruhe();
	const g = f.kasten.gemounted[f.kasten.gemounted.length - 1];
	assert.strictEqual(g.host, f.elemente.wpGroupWikiAssign, "Vorbedingung: die Weg-Ebene von „Neuer Weg“ ist gewaehlt");
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
	const danach = f.kasten.gemounted[f.kasten.gemounted.length - 1];
	assert.strictEqual(danach.host, f.elemente.wpWikiAssign, wo + ": danach steht der Kasten des Abschnitts, nicht der tote der Weg-Ebene");
	assert.strictEqual(danach.opts.laden().artikel.wiki_key, "baerenstieg", wo + ": und er kennt die neue Zuweisung (kein „Kein Weg gewählt.“)");
	assert.ok(!f.elemente.wpDetail.innerHTML.includes("Ganzer Weg"), wo + ": die Maske der Weg-Ebene ist abgeraeumt");
}

(async () => {
	const s = sandkasten();
	await ruhe();

	// ---- 1. Abschnitt: EIN Kasten, die weiteren Zuweisungen in seinem Anhang -------------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-id": "p-1" }), preventDefault() {} });
	await ruhe();
	assert.ok(!s.elemente.wpDetail.innerHTML.includes('id="wpWikiWeitere"'), "der zweite Kasten am Abschnitt ist gefallen");
	const abschnitt = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	assert.strictEqual(abschnitt.host, s.elemente.wpWikiAssign);
	assert.ok(abschnitt.opts.anhang, "der Kasten „Wiki-Weg“ bekommt einen Anhang");
	const weitereAbschnitt = s.kasten.weitereMounts[s.kasten.weitereMounts.length - 1];
	assert.strictEqual(weitereAbschnitt.host, abschnitt.opts.anhang, "die weiteren Zuweisungen haengen GENAU in diesem Anhang");
	assert.ok(!("haupt" in weitereAbschnitt.opts), "keine Hauptzeile");
	assert.ok(!("wpWikiWeitere" in s.elemente), "niemand fragt mehr nach #wpWikiWeitere");

	// ---- 2. Weg-Ebene: ein EIGENER Kasten „Wiki-Weg“ mit Anhang ---------------------------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	assert.ok(s.elemente.wpDetail.innerHTML.includes('id="wpGroupWikiAssign"'), "die Weg-Ebene traegt den Kasten „Wiki-Weg“");
	assert.ok(!s.elemente.wpDetail.innerHTML.includes('id="wpGroupWikiWeitere"'), "der alte Einzelkasten ist gefallen");
	const gruppe = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	assert.strictEqual(gruppe.host, s.elemente.wpGroupWikiAssign);
	assert.strictEqual(gruppe.opts.subject, "weg");
	const weitereGruppe = s.kasten.weitereMounts[s.kasten.weitereMounts.length - 1];
	assert.strictEqual(weitereGruppe.host, gruppe.opts.anhang);
	assert.strictEqual(weitereGruppe.opts.umfangText(), "die ganze Straße");
	// R22: auch auf der Weg-Ebene reist das abgeschaffte `haupt` nicht mehr mit.
	assert.ok(!("haupt" in weitereGruppe.opts), "keine Hauptzeile auf der Weg-Ebene");
	assert.deepStrictEqual([...weitereGruppe.opts.abschnitte().map((a) => a.public_id)], ["p-1", "p-2"]);
	const zustand = gruppe.opts.laden();
	assert.strictEqual(zustand.artikel.wiki_key, "alte-strasse", "der Stand der Gruppe");

	// ---- 3. Zuweisen auf der Weg-Ebene: genau ihre Abschnitte -------------------------------------------------------
	s.gesendet.length = 0;
	await gruppe.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} });
	await ruhe();
	const zuweisung = s.gesendet.find((g) => g.rumpf && g.rumpf.action === "assign_to");
	assert.ok(zuweisung, JSON.stringify(s.gesendet.map((g) => g.url)));
	assert.deepStrictEqual([...zuweisung.rumpf.public_ids], ["p-1", "p-2"], "Zuweisen gilt GENAU den Abschnitten der Gruppe (§9.6)");
	assert.strictEqual(zuweisung.rumpf.public_id, "p-1");

	// ---- 4. Entfernen auf der Weg-Ebene: EINE Frage, dann public_ids, dann der Ankerabschnitt ----------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	const gruppe2 = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	s.gesendet.length = 0;
	s.fragen.length = 0;
	await gruppe2.opts.loesen();
	await ruhe();
	assert.strictEqual(s.fragen.length, 1, "genau eine Rueckfrage");
	assert.ok(s.fragen[0].includes("allen 2 Abschnitten") && s.fragen[0].includes("zerfällt"), s.fragen[0]);
	const loesen = s.gesendet.filter((g) => g.rumpf && g.rumpf.action === "clear_assign");
	assert.strictEqual(loesen.length, 1, "kein Trockenlauf mit „nur dieser Abschnitt?“ auf der Weg-Ebene");
	assert.deepStrictEqual([...loesen[0].rumpf.public_ids], ["p-1", "p-2"]);
	assert.ok(s.gesendet.some((g) => g.url.indexOf("action=detail") !== -1), "danach ist der Ankerabschnitt gewaehlt -- die Gruppe ist zerfallen");

	// ---- 5. Sync auf der Weg-Ebene: das Sammel-Speichern schickt wiki_uebernommen ---------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	const gruppe3 = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	gruppe3.opts.syncUebernehmen([{ karte: "feature_subtype", neu: "Reichsstrasse" }]);
	s.gesendet.length = 0;
	s.elemente.wpGroupSave.zuhoerer.click({ target: s.elemente.wpGroupSave, preventDefault() {} });
	await ruhe();
	const sammel = s.gesendet.find((g) => g.rumpf && g.rumpf.action === "update_path_group_details");
	assert.ok(sammel, JSON.stringify(s.gesendet.map((g) => g.rumpf)));
	assert.deepStrictEqual([...sammel.rumpf.fields], ["feature_subtype"]);
	assert.deepStrictEqual([...(sammel.rumpf.wiki_uebernommen || [])], ["feature_subtype"],
		"ohne wiki_uebernommen stempelte der Server die Uebernahme als „von uns“ (§9.5)");

	// ---- 6. Ungespeicherte Weg-Ebene-Eingaben werden benannt, nicht still verworfen ------------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	const gruppe4 = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	gruppe4.opts.syncUebernehmen([{ karte: "feature_subtype", neu: "Reichsstrasse" }]);
	s.kasten.confirm = (text) => { s.fragen.push(String(text)); return false; };
	s.fragen.length = 0;
	s.gesendet.length = 0;
	let abgelehnt = false;
	await gruppe4.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} }).catch(() => { abgelehnt = true; });
	assert.ok(abgelehnt && s.fragen.length === 1 && s.fragen[0].includes("ungespeicherte"), "gefragt und abgelehnt: " + JSON.stringify(s.fragen));
	assert.ok(!s.gesendet.some((g) => g.rumpf && g.rumpf.action === "assign_to"), "abgelehnt heisst: nichts geschickt");

	// ---- 7. R22: ✕ an einer weiteren Zuweisung OHNE Hauptzuweisung schreibt „remove_weitere“ ---------------------------
	// §9.5: die weiteren Zuweisungen bleiben stehen, wenn die Hauptzuweisung geht -- sonst waeren sie nicht mehr zu entfernen.
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-id": "p-3" }), preventDefault() {} });
	await ruhe();
	const einsam = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	const weitereEinsam = s.kasten.weitereMounts[s.kasten.weitereMounts.length - 1];
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
	const offenDanach = offen.kasten.gemounted[offen.kasten.gemounted.length - 1];
	assert.strictEqual(offenDanach.host, offen.elemente.wpGroupWikiAssign, "ohne Filter bleibt die Weg-Ebene gewaehlt -- jetzt als name:Bärenstieg");
	assert.strictEqual(offenDanach.opts.laden().artikel.wiki_key, "baerenstieg");
	assert.ok(!offen.gesendet.some((x) => x.url.indexOf("action=detail") !== -1), "kein Rueckfall, wenn die Gruppe sichtbar ist");

	// ---- 11. Owner 15.09.2026: die Strasse ist der NAME und kann GEMISCHT sein -- Zuweisen fragt dann, ein Nein schreibt nichts ----
	// „Alte Straße" bekommt einen dritten Abschnitt OHNE Zuweisung und mit anderer Wegart.
	const gemischt = sandkasten([{ public_id: "p-6", name: "Alte Straße", echter_name: "Alte Straße", feature_subtype: "Weg", show_label: true,
		allowed_transports: ["caravan"], transport_seasons: {}, wiki_path: null, wiki_path_weitere: [], flow_direction: "", has_profile: true,
		bbox: [3, 0, 4, 0] }]);
	await ruhe();
	gemischt.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "name:Alte Straße" }), preventDefault() {} });
	await ruhe();
	const gGemischt = gemischt.kasten.gemounted[gemischt.kasten.gemounted.length - 1];
	assert.strictEqual(gGemischt.host, gemischt.elemente.wpGroupWikiAssign, "Vorbedingung: die gemischte Strasse steht auf der Weg-Ebene");
	assert.deepStrictEqual([...gemischt.kasten.weitereMounts[gemischt.kasten.weitereMounts.length - 1].opts.abschnitte().map((a) => a.public_id)],
		["p-1", "p-2", "p-6"], "die Strasse umfasst den Abschnitt ohne Zuweisung und mit anderer Wegart");
	assert.strictEqual(gGemischt.opts.laden().artikel.wiki_key, "alte-strasse", "der Kasten nennt die Zuweisung, die in der Strasse steht");
	gemischt.kasten.confirm = (text) => { gemischt.fragen.push(String(text)); return false; };
	gemischt.fragen.length = 0;
	gemischt.gesendet.length = 0;
	let nein = false;
	await gGemischt.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} }).catch(() => { nein = true; });
	assert.ok(nein, "abgebrochen ist abgelehnt");
	assert.strictEqual(gemischt.fragen.length, 1, "genau eine Rueckfrage");
	assert.ok(gemischt.fragen[0].includes("verschiedene Wiki-Zuordnungen") && gemischt.fragen[0].includes("allen 3 Abschnitten"), gemischt.fragen[0]);
	assert.ok(!gemischt.gesendet.some((x) => x.rumpf && x.rumpf.action === "assign_to"), "ein Nein schreibt nichts");
	// Fixrunde L1: auch Entfernen sagt bei einer gemischten Strasse, dass ein Teil gar keine Zuordnung traegt.
	gemischt.fragen.length = 0;
	let entfernenNein = false;
	await gGemischt.opts.loesen().catch(() => { entfernenNein = true; });
	assert.ok(entfernenNein && gemischt.fragen.length === 1, JSON.stringify(gemischt.fragen));
	assert.ok(gemischt.fragen[0].includes("allen 3 Abschnitten") && gemischt.fragen[0].includes("1 davon trägt keine Zuordnung"), gemischt.fragen[0]);
	assert.ok(!gemischt.gesendet.some((x) => x.rumpf && x.rumpf.action === "clear_assign"), "ein Nein schreibt nichts");
	gemischt.kasten.confirm = (text) => { gemischt.fragen.push(String(text)); return true; };
	await gGemischt.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} });
	await ruhe();
	const ja = gemischt.gesendet.find((x) => x.rumpf && x.rumpf.action === "assign_to");
	assert.ok(ja, "ein Ja schreibt");
	assert.deepStrictEqual([...ja.rumpf.public_ids], ["p-1", "p-2", "p-6"], "... auf alle Abschnitte der Strasse");
	// Gegenprobe: die einige Strasse (Abschnitt 3) fragte nicht -- s.fragen blieb dort leer bis zum Entfernen.

	console.log("wege-editor-wiki-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
