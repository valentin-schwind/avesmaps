"use strict";
// Die Einhaengestelle `anhang` des Wiki-Zuweisungs-Bauteils (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5).
// 🔴 Der Golden-Master (fixtures/wiki-assign-markup-ohne-anhang.json) ist VOR der Aenderung erzeugt: ohne `anhang` muss das
// Markup aller acht Objektarten in beiden Huellen und fuenf Zustaenden Zeichen fuer Zeichen gleich bleiben.
// Aus der Wurzel: node js/ui/__tests__/wiki-assign-anhang.test.js
// 💣 EIN Erzeuger fuer die Fixture, und das ist DIESER Test: `node js/ui/__tests__/wiki-assign-anhang.test.js --schreiben`
// schreibt sie aus `faelle(undefined)` neu. Gueltig nur aus einem UNVERAENDERTEN js/ui/wiki-assign.js
// (`git diff --quiet -- js/ui/wiki-assign.js`) -- oder wenn eine Markup-Aenderung beabsichtigt ist; dann steht der Grund
// im Commit. Eine nebenbei neu geschriebene Fixture haelt nichts mehr fest.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const R = require("../wiki-assign-registry.js");
const A = require("../wiki-assign.js");
global.avesmapsWikiAssignSubject = R.avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = require("../wiki-assign-diff.js").avesmapsWikiAssignDiff;

const FIXTURE = path.join(__dirname, "fixtures", "wiki-assign-markup-ohne-anhang.json");
const SCHREIBEN = process.argv.includes("--schreiben");
const NEU_ERZEUGEN = "beabsichtigt? dann node js/ui/__tests__/wiki-assign-anhang.test.js --schreiben (und den Grund im Commit nennen)";

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
		console.log("Nur gueltig aus einem unveraenderten js/ui/wiki-assign.js (git diff --quiet -- js/ui/wiki-assign.js) oder bei beabsichtigter, im Commit begruendeter Markup-Aenderung.");
		return;
	}
	const golden = require(FIXTURE);

	// ---- 1. Golden-Master: ohne Anhang (und mit anhang:false) Zeichen fuer Zeichen gleich ----------------------
	const ohne = faelle(undefined);
	assert.strictEqual(Object.keys(golden).length, 80, "der Golden-Master deckt 8 Objektarten × 2 Huellen × 5 Zustaende");
	assert.deepStrictEqual(Object.keys(ohne).sort(), Object.keys(golden).sort(), "eine Objektart kam dazu oder fiel weg -- Fixture neu erzeugen, BEVOR das Bauteil geaendert wird: node js/ui/__tests__/wiki-assign-anhang.test.js --schreiben");
	for (const [schluessel, markup] of Object.entries(golden)) {
		assert.strictEqual(ohne[schluessel], markup, "ohne anhang hat sich das Markup geaendert: " + schluessel + " -- " + NEU_ERZEUGEN);
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
	// Mit Behaelter: nur ein Platz IM EIGENEN Behaelter zaehlt. `closest` laeuft ueber den Behaelter hinaus -- haengt das
	// Bauteil selbst in einem fremden Anhang, faende es dessen Platz und hielte jedes eigene Ereignis fuer fremd.
	const eigenerPlatz = { name: "eigener-platz" };
	const fremderPlatz = { name: "fremder-platz" };
	const eigenerBehaelter = { contains: (knoten) => knoten !== fremderPlatz };
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({ closest: (s) => (s === "[data-wa-anhang]" ? eigenerPlatz : null) }, eigenerBehaelter), true, "der eigene Platz zaehlt");
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({ closest: (s) => (s === "[data-wa-anhang]" ? fremderPlatz : null) }, eigenerBehaelter), false, "der Platz eines AEUSSEREN Kastens zaehlt nicht");
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({ closest: (s) => (s === "[data-wa-anhang]" ? fremderPlatz : null) }, {}), true, "ohne `contains` am Behaelter bleibt es beim closest-Befund");

	// ---- 4. Der Mount: Umhaengen nach jedem Neuzeichnen, Ereignisse aus dem Anhang gehoeren dem Wirt ----------------
	let fetches = 0;
	global.fetch = async () => { fetches += 1; return { ok: true, json: async () => ({ rows: [] }) }; };
	// Wie im DOM: `innerHTML` nimmt den eingehaengten Anhang mit, `appendChild` haengt ihn wieder ein.
	let eingehaengt = false;
	const platz = { kinder: [], appendChild(kind) { this.kinder.push(kind); eingehaengt = true; return kind; } };
	// Ein Suchfeld IM Anhang (der Kasten „Weitere Wiki-Zuweisungen“ traegt eins) -- fuer `querySelector` nur da, solange
	// der Anhang haengt.
	const anhangFeld = { fokussiert: 0, value: "", focus() { this.fokussiert += 1; }, setSelectionRange() {} };
	let html = "";
	let schreibungen = 0;
	const behaelter = {
		get innerHTML() { return html; },
		set innerHTML(wert) { html = String(wert); schreibungen += 1; eingehaengt = false; },
		textContent: "", zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete this.zuhoerer[typ]; },
		contains() { return true; },
		querySelector(sel) {
			if (sel === "[data-wa-anhang]") { return html.includes("data-wa-anhang") ? platz : null; }
			if (sel === "[data-wa-suche]") { return eingehaengt ? anhangFeld : null; }
			return null;
		},
	};
	const anhang = { name: "anhang-des-wirts" };
	let geloest = 0;
	const st = A.avesmapsWikiAssignMount(behaelter, {
		subject: "weg", skin: "dt", anhang,
		// `wegtyp` weicht vom Kartenwert ab -- damit hat die Sync-Vorschau unten eine Zeile.
		laden: () => ({ artikel: { name: "Reichsstraße 2", wiki_url: "https://x/R", wiki_key: "reichsstrasse-2", werte: { wegtyp: "Strasse" } }, kartenwerte: { feature_subtype: "Reichsstrasse" } }),
		zuweisen: () => {}, loesen: () => { geloest += 1; }, syncUebernehmen: () => {},
	});
	await warten(0);
	assert.strictEqual(st.bereit, true);
	assert.deepStrictEqual(platz.kinder, [anhang], "nach dem ersten Zeichnen haengt das Element des Wirts im Platz");
	assert.strictEqual(anhangFeld.fokussiert, 0, "ein Suchfeld IM Anhang bekommt beim Zeichnen nicht den Fokus des Bauteils -- eingehaengt wird erst NACH dem Fokusblock");

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
	assert.strictEqual(anhangFeld.fokussiert, 0, "auch beim Wiedereinhaengen kein Fokus ins Anhang-Feld");

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

	// 🔴 Das `change` braucht einen Zustand, in dem das Bauteil darauf WIRKLICH neu zeichnen wuerde: eine Sync-Zeile. Im
	// Ruhezustand ohne Sync-Zeilen steigt `aufAenderung` auch OHNE Riegel aus -- dort pruefte die Zusicherung nichts.
	behaelter.zuhoerer.click(aktion("sync", false));
	await warten(0);
	assert.ok(behaelter.innerHTML.includes("data-wa-sync-haken"), "die Sync-Vorschau zeigt eine Zeile (Wegtyp „Strasse“ gegen „Reichsstrasse“)");
	const hakenZiel = (ausAnhang) => ({
		closest: (s) => (s === "[data-wa-anhang]" && ausAnhang ? {} : null),
		hasAttribute: (name) => name === "data-wa-sync-haken",
		getAttribute: () => "0",
		checked: true,
	});
	const schreibungenVorher = schreibungen;
	behaelter.zuhoerer.change({ target: hakenZiel(true) });
	assert.strictEqual(schreibungen, schreibungenVorher, "ein change im Anhang zeichnet das Bauteil nicht neu");
	behaelter.zuhoerer.change({ target: hakenZiel(false) });
	assert.strictEqual(schreibungen, schreibungenVorher + 1, "Gegenprobe: dasselbe change AUSSERHALB des Anhangs zeichnet neu -- sonst pruefte die Zeile darueber nichts");

	st.zerstoeren();

	// ---- 5. Ein Bauteil IN einem fremden Anhang: dessen Platz ist nicht seiner --------------------------------------
	// `closest("[data-wa-anhang]")` findet von innen den Platz des AEUSSEREN Kastens. Ohne `behaelter.contains(platz)`
	// ignorierte das innere Bauteil jedes eigene Ereignis -- alle fuenf Zuhoerer einzeln, denn jeder fragt den Riegel selbst.
	const aussenPlatz = { name: "platz-des-aeusseren-kastens" };
	let innenHtml = "";
	let innenSchreibungen = 0;
	const innen = {
		get innerHTML() { return innenHtml; },
		set innerHTML(wert) { innenHtml = String(wert); innenSchreibungen += 1; },
		textContent: "", zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete this.zuhoerer[typ]; },
		contains(knoten) { return knoten !== aussenPlatz; },
		querySelector() { return null; },
	};
	let innenGeloest = 0;
	const stInnen = A.avesmapsWikiAssignMount(innen, {
		subject: "weg", skin: "dt",
		laden: () => ({ artikel: { name: "Reichsstraße 2", wiki_url: "https://x/R", wiki_key: "reichsstrasse-2", werte: { wegtyp: "Strasse" } }, kartenwerte: { feature_subtype: "Reichsstrasse" } }),
		zuweisen: () => {}, loesen: () => { innenGeloest += 1; }, syncUebernehmen: () => {},
	});
	await warten(0);
	assert.strictEqual(stInnen.bereit, true);
	const imAussenAnhang = (weitere) => (s) => (s === "[data-wa-anhang]" ? aussenPlatz : (weitere[s] || null));

	innen.zuhoerer.click({ target: { closest: imAussenAnhang({ "[data-wa-aktion]": { getAttribute: () => "sync" } }) }, preventDefault() {} });
	await warten(0);
	assert.ok(innenHtml.includes("data-wa-sync-haken"), "click: das innere Bauteil oeffnet seine Sync-Vorschau");

	let innenVorher = innenSchreibungen;
	innen.zuhoerer.change({ target: { closest: imAussenAnhang({}), hasAttribute: (name) => name === "data-wa-sync-haken", getAttribute: () => "0", checked: true } });
	assert.strictEqual(innenSchreibungen, innenVorher + 1, "change: das innere Bauteil zeichnet seinen Haken neu");

	innenVorher = innenSchreibungen;
	innen.zuhoerer.keydown({ key: "Escape", preventDefault() {}, target: { closest: imAussenAnhang({}), hasAttribute: (name) => name === "data-wa-suche" } });
	assert.strictEqual(innenSchreibungen, innenVorher + 1, "keydown: Escape gehoert dem inneren Bauteil");

	let innenGedrueckt = 0;
	innen.zuhoerer.mousedown({ button: 0, preventDefault() { innenGedrueckt += 1; }, target: { closest: imAussenAnhang({ "[data-wa-treffer]": { getAttribute: () => "0" } }) } });
	assert.strictEqual(innenGedrueckt, 1, "mousedown: der Druck auf einen inneren Treffer gehoert dem inneren Bauteil");

	const innenFetches = fetches;
	innen.zuhoerer.input({ target: { closest: imAussenAnhang({}), hasAttribute: (name) => name === "data-wa-suche", value: "bär" } });
	await warten(250);
	assert.strictEqual(fetches, innenFetches + 1, "input: Tippen im inneren Suchfeld startet die innere Suche");

	innen.zuhoerer.click({ target: { closest: imAussenAnhang({ "[data-wa-aktion]": { getAttribute: () => "entfernen" } }) }, preventDefault() {} });
	await warten(0);
	assert.strictEqual(innenGeloest, 1, "click: „Entfernen“ im inneren Bauteil loest");

	stInnen.zerstoeren();
	console.log("wiki-assign-anhang.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
