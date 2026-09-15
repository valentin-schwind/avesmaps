"use strict";
// Die Einhaengestelle `anhang` des Wiki-Zuweisungs-Bauteils (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5).
// 🔴 Der Golden-Master (fixtures/wiki-assign-markup-ohne-anhang.json) ist VOR der Aenderung erzeugt: ohne `anhang` muss das
// Markup aller acht Objektarten in beiden Huellen und fuenf Zustaenden Zeichen fuer Zeichen gleich bleiben.
// Aus der Wurzel: node js/ui/__tests__/wiki-assign-anhang.test.js
// 💣 EIN Erzeuger fuer die Fixture, und das ist DIESER Test: `node js/ui/__tests__/wiki-assign-anhang.test.js --schreiben`
// schreibt sie aus `faelle(undefined)` neu. Nur gueltig, solange js/ui/wiki-assign.js dabei UNVERAENDERT ist
// (`git diff --quiet -- js/ui/wiki-assign.js`) -- eine aus dem geaenderten Bauteil erzeugte Fixture haelt nichts mehr fest.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const R = require("../wiki-assign-registry.js");
const A = require("../wiki-assign.js");
global.avesmapsWikiAssignSubject = R.avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = require("../wiki-assign-diff.js").avesmapsWikiAssignDiff;

const FIXTURE = path.join(__dirname, "fixtures", "wiki-assign-markup-ohne-anhang.json");
const SCHREIBEN = process.argv.includes("--schreiben");

const warten = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

function faelle(mitAnhang) {
	const aus = {};
	for (const subject of Object.keys(R.AVESMAPS_WIKI_ASSIGN_REGISTRY)) {
		const e = R.avesmapsWikiAssignSubject(subject);
		const werte = {};
		(e.felder || []).forEach((f) => { if (f && f.wiki) { werte[f.wiki] = "W-" + f.wiki; } });
		const artikel = { name: "Artikel", wiki_url: "https://de.wiki-aventurica.de/wiki/Artikel", wiki_key: "artikel", werte };
		const zustaende = {
			offen: [{ artikel: null }, { modus: "offen", listenId: "probe" }],
			zugewiesen: [{ artikel }, { modus: "zugewiesen", listenId: "probe" }],
			zugewiesenUngespeichert: [{ artikel }, { modus: "zugewiesen", listenId: "probe", ungespeichert: true }],
			suche: [{ artikel }, { modus: "suche", listenId: "probe", suchtext: "Art", treffer: [{ name: "Treffer", wiki_url: "", wiki_key: "t", werte }] }],
			sync: [{ artikel }, { modus: "sync", listenId: "probe", syncZeilen: [] }],
		};
		for (const skin of ["dt", "label-wiki"]) {
			for (const [name, [daten, ui]] of Object.entries(zustaende)) {
				const uiMit = mitAnhang === undefined ? ui : Object.assign({}, ui, { anhang: mitAnhang });
				aus[subject + "|" + skin + "|" + name] = A.avesmapsWikiAssignMarkup(A.avesmapsWikiAssignModell(e, daten, uiMit), A.avesmapsWikiAssignSkin(skin));
			}
		}
	}
	return aus;
}

(async () => {
	// ---- 0. Schreibmodus: die Fixture aus dem Bauteil, wie es JETZT ist ------------------------------------------
	if (SCHREIBEN) {
		const aus = faelle(undefined);
		fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
		fs.writeFileSync(FIXTURE, JSON.stringify(aus, null, 1) + "\n");
		console.log(Object.keys(aus).length + " Faelle -> " + path.relative(process.cwd(), FIXTURE));
		console.log("Nur gueltig, wenn js/ui/wiki-assign.js dabei unveraendert war (git diff --quiet -- js/ui/wiki-assign.js).");
		return;
	}
	const golden = require(FIXTURE);

	// ---- 1. Golden-Master: ohne Anhang (und mit anhang:false) Zeichen fuer Zeichen gleich ----------------------
	const ohne = faelle(undefined);
	assert.strictEqual(Object.keys(golden).length, 80, "der Golden-Master deckt 8 Objektarten × 2 Huellen × 5 Zustaende");
	assert.deepStrictEqual(Object.keys(ohne).sort(), Object.keys(golden).sort(), "eine Objektart kam dazu oder fiel weg -- Fixture neu erzeugen, BEVOR das Bauteil geaendert wird");
	for (const [schluessel, markup] of Object.entries(golden)) {
		assert.strictEqual(ohne[schluessel], markup, "ohne anhang hat sich das Markup geaendert: " + schluessel);
	}
	const aus = faelle(false);
	for (const [schluessel, markup] of Object.entries(golden)) {
		assert.strictEqual(aus[schluessel], markup, "anhang:false aendert das Markup: " + schluessel);
	}

	// ---- 2. Mit Anhang: genau ein Platz in den Ruhezustaenden, direkt VOR der Schreibzeile; in Suche/Sync keiner ----
	const mit = faelle(true);
	for (const [schluessel, markup] of Object.entries(mit)) {
		const zustand = schluessel.split("|")[2];
		const plaetze = markup.split("<div data-wa-anhang></div>").length - 1;
		if (zustand === "suche" || zustand === "sync") {
			assert.strictEqual(plaetze, 0, "kein Anhang in Suche/Sync-Vorschau: " + schluessel);
			assert.strictEqual(markup, golden[schluessel], "Suche/Sync bleiben auch mit anhang unveraendert: " + schluessel);
			continue;
		}
		assert.strictEqual(plaetze, 1, "genau ein Platz: " + schluessel);
		const platz = markup.indexOf("<div data-wa-anhang></div>");
		const schreibzeile = markup.indexOf("data-wa-schreibzeile");
		assert.ok(schreibzeile > platz, "der Platz steht UEBER der Schreibzeile („wirkt sofort“ gilt dem ganzen Kasten): " + schluessel);
		assert.strictEqual(markup.replace("<div data-wa-anhang></div>", ""), golden[schluessel], "sonst aendert sich nichts: " + schluessel);
	}

	// ---- 3. Der reine Ereignis-Riegel: `closest`, nicht `contains` -------------------------------------------------
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({ closest: (s) => (s === "[data-wa-anhang]" ? {} : null) }), true);
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({ closest: () => null, contains: () => true }), false, "`contains` zaehlt nicht");
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang(null), false);
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({}), false);

	// ---- 4. Der Mount: Umhaengen nach jedem Neuzeichnen, Ereignisse aus dem Anhang gehoeren dem Wirt ----------------
	let fetches = 0;
	global.fetch = async () => { fetches += 1; return { ok: true, json: async () => ({ rows: [] }) }; };
	const platz = { kinder: [], appendChild(kind) { this.kinder.push(kind); return kind; } };
	const behaelter = {
		innerHTML: "", textContent: "", zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete this.zuhoerer[typ]; },
		contains() { return true; },
		querySelector(sel) { return sel === "[data-wa-anhang]" && this.innerHTML.includes("data-wa-anhang") ? platz : null; },
	};
	const anhang = { name: "anhang-des-wirts" };
	let geloest = 0;
	const st = A.avesmapsWikiAssignMount(behaelter, {
		subject: "weg", skin: "dt", anhang,
		laden: () => ({ artikel: { name: "Reichsstraße 2", wiki_url: "https://x/R", wiki_key: "reichsstrasse-2", werte: {} }, kartenwerte: { feature_subtype: "Reichsstrasse" } }),
		zuweisen: () => {}, loesen: () => { geloest += 1; }, syncUebernehmen: () => {},
	});
	await warten(0);
	assert.strictEqual(st.bereit, true);
	assert.deepStrictEqual(platz.kinder, [anhang], "nach dem ersten Zeichnen haengt das Element des Wirts im Platz");

	const aktion = (name, ausAnhang) => ({
		target: { closest: (sel) => (sel === "[data-wa-anhang]" ? (ausAnhang ? {} : null) : (sel === "[data-wa-aktion]" ? { getAttribute: () => name } : null)) },
		preventDefault() {},
	});
	behaelter.zuhoerer.click(aktion("aendern", false));
	await warten(0);
	assert.ok(!behaelter.innerHTML.includes("data-wa-anhang"), "in der Suche steht kein Platz");
	assert.strictEqual(platz.kinder.length, 1, "in der Suche wird nichts eingehaengt");
	behaelter.zuhoerer.click(aktion("abbrechen", false));
	await warten(0);
	assert.strictEqual(platz.kinder.length, 2, "zurueck im Ruhezustand wird DASSELBE Element wieder eingehaengt");
	assert.strictEqual(platz.kinder[1], anhang);

	behaelter.zuhoerer.click(aktion("entfernen", true));
	await warten(0);
	assert.strictEqual(geloest, 0, "ein Klick aus dem Anhang loest keine Aktion des Bauteils aus");

	const fetchesVorher = fetches;
	behaelter.zuhoerer.input({ target: { closest: (s) => (s === "[data-wa-anhang]" ? {} : null), hasAttribute: () => true, value: "bär" } });
	await warten(250);
	assert.strictEqual(fetches, fetchesVorher, "Tippen im Suchfeld des Anhangs startet keine Suche des Bauteils");

	const kinderVorher = platz.kinder.length;
	behaelter.zuhoerer.keydown({ key: "Escape", preventDefault() {}, target: { closest: (s) => (s === "[data-wa-anhang]" ? {} : null), hasAttribute: () => true } });
	assert.strictEqual(platz.kinder.length, kinderVorher, "Escape im Anhang zeichnet das Bauteil nicht neu");

	let gewaehlt = 0;
	behaelter.zuhoerer.mousedown({ button: 0, preventDefault() { gewaehlt += 1; }, target: { closest: (s) => (s === "[data-wa-anhang]" ? {} : (s === "[data-wa-treffer]" ? { getAttribute: () => "0" } : null)) } });
	assert.strictEqual(gewaehlt, 0, "ein Druck im Anhang wird nicht als Trefferwahl verbraucht");

	behaelter.zuhoerer.change({ target: { closest: (s) => (s === "[data-wa-anhang]" ? {} : null), hasAttribute: () => true, getAttribute: () => "0", checked: true } });
	assert.strictEqual(platz.kinder.length, kinderVorher, "ein change im Anhang zeichnet das Bauteil nicht neu");

	st.zerstoeren();
	console.log("wiki-assign-anhang.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
