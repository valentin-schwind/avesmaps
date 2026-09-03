// Der Kartendialog „Herrschaftsgebiet bearbeiten" montiert das EINE Quellen-Bauteil.
//
// Entwurf: docs/superpowers/specs/2026-09-03-quellen-herrschaftsgebiete-design.md (§2.3),
// Mockup docs/quellen-herrschaftsgebiete-mockup.html.
//
// 🔴 populateRegionEditForm wird hier WIRKLICH AUSGEFUEHRT, gegen eine Dokument-Attrappe: was
// die Funktion an Rueststoff braucht (zwei Dutzend Helfer der Nachbardateien), bekommt sie als
// Leerlauf -- jeder ReferenceError beim Lauf wird zu einem weiteren Leerlauf, bis die Funktion
// durchlaeuft. Gemessen wird nur der Mount: Ziel, Objektart, Getter.
//
// 💣 Der Getter liest das versteckte Feld bei JEDER Anfrage. Der Dialog hat Reiter, und jeder
// Reiterwechsel befuellt das Formular neu -- ein beim Mounten eingefrorener Wert schriebe die
// Quelle auf das zuvor geoeffnete Gebiet.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-im-herrschaftsgebiet-dialog.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const ohneKommentare = (js) => js
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");

// ---- 1. Das Markup: der Kasten des Orts- und Beschriftungsdialogs, an der Stelle von „Andere Quelle"
{
	const html = ohneHtmlKommentare(lies("index.html"));
	const dialog = html.indexOf('id="region-edit-dialog"');
	const ende = html.indexOf("</form>", dialog);
	const rumpf = html.slice(dialog, ende);
	assert.ok(dialog > 0 && ende > dialog, "der Dialog steht in index.html");
	const host = rumpf.indexOf('id="region-edit-feature-sources"');
	assert.ok(host > 0, "der Host region-edit-feature-sources steht im Dialog");
	// ⚠️ Der Titel traegt `label-edit-section-title` -- gesucht wird der KASTEN, nicht sein Praefix.
	// 🔴 Und der Kasten traegt KEIN `political-territory-field`: die Sichtbarkeitsweiche
	// (syncRegionTerritoryFieldVisibility) versteckt damit alle Gebietsfelder fuer eine Kartenregion --
	// der Mount bedient die aber (`region` + public_id), und ein montierter, versteckter Kasten waere
	// ein toter Zweig (Nebenbefund des Konsistenz-Pruefers, 03.09.2026).
	const kasten = rumpf.lastIndexOf('<div class="label-edit-section"><div class="label-edit-section-title">Quellen</div>', host);
	assert.ok(kasten > 0, "der Host liegt in einem .label-edit-section ohne political-territory-field");
	assert.ok(!rumpf.slice(kasten, host).includes("</label>"), "zwischen Kastenanfang und Host steht kein anderes Feld");
	const kastenRumpf = rumpf.slice(kasten, host);
	assert.ok(/<div class="label-edit-section-title">Quellen<\/div>/.test(kastenRumpf), "Ueberschrift „Quellen“");
	assert.ok(kastenRumpf.includes("Quellen wirken <b>sofort</b> — sie brauchen kein „Speichern“."),
		"der Hinweissatz ist zeichengleich dem des Beschriftungsdialogs");
	["region-edit-other-source-section", "region-edit-other-source-url", "region-edit-other-source-label",
		"region-edit-other-source-preview"].forEach((kennung) =>
		assert.ok(!html.includes(kennung), "„Andere Quelle“ ist aus dem Dialog raus: " + kennung));
	// 🔴 Der Kasten steht GANZ UNTEN -- nach dem letzten Feld, vor Statuszeile und Knopfleiste.
	// Owner 03.09.2026: „können die quellen ganz nach unten (nicht zwischen die felder reinpfrimeln),
	// generell können quellen immer unten/als letztes in den listen auftauchen".
	const letztesFeld = rumpf.indexOf('id="region-edit-notes"');
	const status = rumpf.indexOf('id="region-edit-status"');
	assert.ok(letztesFeld > 0 && status > 0, "letztes Feld und Statuszeile stehen im Dialog");
	assert.ok(letztesFeld < host, "der Kasten steht NACH dem letzten Feld (Redaktioneller Kommentar)");
	assert.ok(host < status, "… und VOR der Statuszeile");
}

// ---- 2. Niemand liest oder schreibt „Andere Quelle" fuer diesen Dialog mehr --------------------
{
	const bevoelkern = ohneKommentare(lies("js/review/review-region-dialog-population.js"));
	const absenden = ohneKommentare(lies("js/review/review-region-submit-flow.js"));
	assert.ok(!bevoelkern.includes('writeOtherSourceToForm("region-edit"'), "das Befuellen kennt das Feld nicht mehr");
	assert.ok(!absenden.includes('readOtherSourceFromForm("region-edit"'), "das Absenden liest es nicht mehr");
	assert.ok(!/other_source/.test(absenden), "kein other_source im Rumpf -- der Server raeumt das Feld beim Speichern ab, nachdem der Mount den Takeover gefahren hat");
}

// ---- 3. populateRegionEditForm, ausgefuehrt: der Mount ------------------------------------------
function dokumentAttrappe(werte) {
	const elemente = new Map();
	function element(id) {
		if (elemente.has(id)) return elemente.get(id);
		const el = {
			id,
			value: werte[id] || "",
			hidden: false,
			checked: false,
			textContent: "",
			classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
			cloneNode(tief) { assert.strictEqual(tief, false, "flacher Klon"); const k = element("__klon:" + id); k.id = id; return k; },
			replaceWith(neu) { el.ersetztDurch = neu; elemente.set(id, neu); },
			ersetztDurch: null,
			querySelectorAll: () => [],
			querySelector: () => null,
			addEventListener() {},
		};
		elemente.set(id, el);
		return el;
	}
	return {
		getElementById: (id) => element(id),
		querySelectorAll: () => [],
		querySelector: () => null,
		element,
	};
}

function fahre(quelle, region, werte) {
	const aufrufe = [];
	const document = dokumentAttrappe(werte);
	const context = {
		console,
		document,
		window: {},
		mountFeatureSourceEditor: (ziel, art, getter, opts) => { aufrufe.push({ ziel, art, getter, opts }); },
		escapeHtml: (s) => String(s),
		normalizeParentheticalSpacing: (s) => s,
		Math,
		String,
		Number,
		Array,
		Object,
	};
	context.window = context;
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(quelle, context);
	// Alles, was die Funktion an Nachbarn braucht, als Leerlauf -- Fehler fuer Fehler, bis sie durchlaeuft.
	for (let versuch = 0; versuch < 60; versuch += 1) {
		try {
			vm.runInContext("populateRegionEditForm(" + JSON.stringify({ region }) + ", { preserveTabs: true });", context);
			return { aufrufe, document };
		} catch (fehler) {
			const treffer = /^(\w+) is not defined$/.exec(fehler.message);
			if (!treffer) throw fehler;
			context[treffer[1]] = function () { return ""; };
		}
	}
	throw new Error("populateRegionEditForm laeuft auch nach 60 Leerlaeufen nicht durch");
}

const quelle = lies("js/review/review-region-dialog-population.js");

// Ein Herrschaftsgebiet: Objektart territory, Schluessel aus dem versteckten Feld.
{
	const { aufrufe, document } = fahre(quelle,
		{ source: "political_territory", publicId: "geo-1", territoryPublicId: "t-1", name: "Sternenbund" }, {});
	assert.strictEqual(aufrufe.length, 1, "genau EIN Mount je Befuellen");
	assert.strictEqual(aufrufe[0].art, "territory");
	assert.strictEqual(aufrufe[0].getter(), "t-1", "der Getter liest #region-edit-territory-public-id");
	assert.strictEqual(typeof aufrufe[0].opts.escape, "function");
	const host = document.element("region-edit-feature-sources");
	assert.strictEqual(aufrufe[0].ziel, host, "montiert wird auf den KLON, der den alten Host ersetzt hat");
	assert.strictEqual(host.id, "region-edit-feature-sources");
	// 💣 Der Getter liest bei JEDER Anfrage: ein Reiterwechsel schreibt das Feld um.
	document.element("region-edit-territory-public-id").value = "t-2";
	assert.strictEqual(aufrufe[0].getter(), "t-2", "nach dem Reiterwechsel gilt das neue Gebiet");
}

// Eine Kartenregion (map_feature): der alte oeffentliche Vertrag -- region + map_features-public_id.
{
	const { aufrufe } = fahre(quelle, { source: "map_feature", publicId: "r-9", name: "Steppe" }, {});
	assert.strictEqual(aufrufe.length, 1);
	assert.strictEqual(aufrufe[0].art, "region");
	assert.strictEqual(aufrufe[0].getter(), "r-9", "der Getter liest #region-edit-public-id");
}

// 💣 Kein Stapeln: das zweite Befuellen loest die Vorschlagsliste des ersten und ersetzt den Host erneut.
{
	const document = dokumentAttrappe({});
	let geloest = 0;
	document.element("region-edit-feature-sources").__fsDetachAutocomplete = () => { geloest += 1; };
	const aufrufe = [];
	const context = { console, document, window: {}, mountFeatureSourceEditor: (ziel) => aufrufe.push(ziel), escapeHtml: String, normalizeParentheticalSpacing: (s) => s };
	context.window = context; context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(quelle, context);
	const region = JSON.stringify({ region: { source: "political_territory", publicId: "g", territoryPublicId: "t-1" } });
	for (let versuch = 0; versuch < 60; versuch += 1) {
		try { vm.runInContext("populateRegionEditForm(" + region + ", { preserveTabs: true }); populateRegionEditForm(" + region + ", { preserveTabs: true });", context); break; }
		catch (fehler) { const t = /^(\w+) is not defined$/.exec(fehler.message); if (!t) throw fehler; context[t[1]] = function () { return ""; }; }
	}
	assert.strictEqual(aufrufe.length, 2, "zwei Befuellungen, zwei Mounts");
	assert.notStrictEqual(aufrufe[0], aufrufe[1], "jeder Mount bekommt einen frischen Host");
	assert.strictEqual(geloest, 1, "die Vorschlagsliste des ERSTEN Mounts wurde vor dem Austausch geloest");
}

console.log("quellen-im-herrschaftsgebiet-dialog: alle Zusicherungen erfuellt");
