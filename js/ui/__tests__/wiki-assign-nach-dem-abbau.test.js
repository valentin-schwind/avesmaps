// 💣 EIN ABGEBAUTES BAUTEIL ZEICHNET UND SCHREIBT NIE MEHR.
//
// ANLASS (live gemessen 15.09.2026, Bearbeiten-Modus, Reichsstraße 2 mit 67 Abschnitten). Der Kartendialog „Weg bearbeiten"
// fuer die GANZE Strasse sollte im Kasten „Wiki-Weg" eine Zeile je Hauptzuweisung zeigen -- und zeigte den alten Einzelkasten des
// angeklickten Abschnitts. Die Spur: populatePathEditFormGruppe -> populatePathEditForm -> renderPathWikiReference (montiert das
// Bauteil in #path-wiki-assign-host) -> renderPathWikiGruppenZeilen (baut es ab und zeichnet die Zeilen in DENSELBEN Behaelter).
// `neuLaden` setzt aber IMMER in einer Zusage fort, auch bei einem synchronen `laden` -- die Fortsetzung des abgebauten Bauteils
// kam also NACH den Zeilen und zeichnete den alten Kasten darueber. `zerstoeren` nahm die Zuhoerer ab und leerte den Behaelter;
// eine Zusage, die schon unterwegs war, erreichte das nicht.
//
// 🔴 Die Regel gilt JEDER asynchronen Fortsetzung, nicht nur `laden`: Suche, zuweisen, loesen, verwerfen, syncUebernehmen -- sie
// kehren still zurueck, bevor sie zeichnen oder Zustand aendern. Eine Regel, die einen von mehreren Erzeugern bindet, ist keine.
// ⚠️ Auch die Infobox zieht ein abgebautes Bauteil nicht mehr nach: wer es waehrend seines eigenen Schreibens abbaut (die Zeilen
// der ganzen Strasse, review-path-wiki.js), zieht sie selbst nach -- dort gesichert in weg-dialog-zeilen-nach-einzelkasten.test.js.
//
// Run: node js/ui/__tests__/wiki-assign-nach-dem-abbau.test.js
"use strict";

const assert = require("assert");
const { avesmapsWikiAssignSubject } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
global.avesmapsWikiAssignSubject = avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;
// Der Nachzieher der Infobox -- ein abgebautes Bauteil darf ihn nicht mehr rufen.
let infobox = 0;
global.window = { avesmapsRefreshInfopanel: () => { infobox += 1; } };
const { avesmapsWikiAssignMount } = require("../wiki-assign.js");

const warte = (ms) => new Promise((fertig) => setTimeout(fertig, ms || 0));

/** Eine Zusage, die der Test von aussen aufloest oder ablehnt -- genau der Zustand „schon unterwegs". */
function zurueckgehalten() {
	const z = {};
	z.zusage = new Promise((aufloesen, ablehnen) => { z.aufloesen = aufloesen; z.ablehnen = ablehnen; });
	return z;
}

/** Der Behaelter: zaehlt JEDEN Schreibvorgang auf innerHTML und textContent. */
function scheinBehaelter() {
	const zuhoerer = {};
	let html = "";
	let text = "";
	const b = {
		schreibungen: 0,
		get innerHTML() { return html; },
		set innerHTML(wert) { html = String(wert); b.schreibungen += 1; },
		get textContent() { return text; },
		set textContent(wert) { text = String(wert); b.schreibungen += 1; },
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		// Keine Trefferliste im DOM: `zeichneTreffer` faellt dann auf das volle Zeichnen zurueck -- auch das ist ein Schreibvorgang.
		querySelector() { return null },
		querySelectorAll() { return []; },
		contains() { return true; },
		feuere(typ, ziel) {
			if (zuhoerer[typ]) {
				zuhoerer[typ]({ target: ziel, detail: 0, button: 0, preventDefault() {}, stopPropagation() {} });
			}
		},
	};
	return b;
}

function scheinZiel(merkmal, wert) {
	const element = {
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
		value: "",
	};
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

const KRAFTLINIE_STAND = () => ({
	artikel: null,
	kartenwerte: {},
	listen: { wiki_articles: [{ name: "Gareth", wiki_url: "https://x/Gareth", wiki_key: "gareth" }] },
});
const KRAFTLINIE_ZUGEWIESEN = () => Object.assign(KRAFTLINIE_STAND(), {
	artikel: { name: "Gareth", wiki_url: "https://x/Gareth", wiki_key: "gareth", werte: {} },
});

/** Montiert und zaehlt die Rueckrufe des Wirts. Jeder Schreib-Rueckruf gibt eine zurueckgehaltene Zusage zurueck. */
function montiere(optionen) {
	const behaelter = scheinBehaelter();
	const rufe = { laden: 0, zuweisen: 0, loesen: 0, verwerfen: 0, syncUebernehmen: 0 };
	const offen = {};
	const schreibend = (name) => () => {
		rufe[name] += 1;
		offen[name] = zurueckgehalten();
		return offen[name].zusage;
	};
	const steuerung = avesmapsWikiAssignMount(behaelter, Object.assign({
		subject: "kraftlinie",
		skin: "dt",
		zuweisen: schreibend("zuweisen"),
		loesen: schreibend("loesen"),
		verwerfen: schreibend("verwerfen"),
		syncUebernehmen: schreibend("syncUebernehmen"),
	}, optionen, {
		laden: () => {
			rufe.laden += 1;
			return optionen.laden();
		},
	}));
	return { behaelter, steuerung, rufe, offen };
}

/** Nach dem Abbau: kein Schreibvorgang mehr, kein geglueckter Ladestand, kein weiterer Rueckruf, keine Infobox. */
function pruefeStill(fall, t, schreibungenNachAbbau, rufeNachAbbau, infoboxNachAbbau) {
	assert.strictEqual(t.behaelter.schreibungen, schreibungenNachAbbau,
		fall + ": das abgebaute Bauteil hat noch in seinen Behaelter geschrieben -- innerHTML jetzt: " + JSON.stringify(t.behaelter.innerHTML.slice(0, 120)));
	assert.strictEqual(t.behaelter.innerHTML, "", fall + ": der Behaelter bleibt leer");
	assert.strictEqual(t.behaelter.textContent, "", fall + ": keine Fehlermeldung im Behaelter");
	assert.deepStrictEqual(Object.assign({}, t.rufe), rufeNachAbbau, fall + ": kein weiterer Rueckruf des Wirts");
	assert.strictEqual(infobox, infoboxNachAbbau, fall + ": die Infobox zieht ein abgebautes Bauteil nicht nach");
}

(async () => {
	let faelle = 0;

	// ── 1) DER LIVE-FALL: `laden` SYNCHRON, Abbau im selben Zug ─────────────────────────────────────────────────────────
	// Genau so rief der Gruppendialog: renderPathWikiReference (synchrones pathWikiZustand) und direkt danach
	// renderPathWikiGruppenZeilen, das den Kasten abbaut und den Behaelter neu fuellt.
	{
		const t = montiere({ laden: KRAFTLINIE_ZUGEWIESEN });
		t.steuerung.zerstoeren();
		const nachAbbau = t.behaelter.schreibungen;
		const rufe = Object.assign({}, t.rufe);
		await warte();
		pruefeStill("synchrones laden", t, nachAbbau, rufe, 0);
		assert.strictEqual(t.steuerung.bereit, false, "ein abgebautes Bauteil wird durch einen verspaeteten Ladelauf nicht „bereit“");
		assert.strictEqual(t.steuerung.lies(), null, "… und `lies()` bleibt ohne Schreibwert");
		faelle++;
	}

	// ── 2) `laden` ZURUECKGEHALTEN: aufloesen, ablehnen, mit NICHTS aufloesen ───────────────────────────────────────────
	for (const [fall, beenden] of [
		["laden loest nach dem Abbau auf", (z) => z.aufloesen(KRAFTLINIE_ZUGEWIESEN())],
		["laden lehnt nach dem Abbau ab", (z) => z.ablehnen(new Error("HTTP 500"))],
		["laden loest nach dem Abbau mit null auf", (z) => z.aufloesen(null)],
	]) {
		const z = zurueckgehalten();
		const t = montiere({ laden: () => z.zusage });
		await warte();
		assert.strictEqual(t.behaelter.schreibungen, 0, fall + ": vor der Antwort zeichnet das Bauteil nichts (sonst prueft der Rest nichts)");
		t.steuerung.zerstoeren();
		const nachAbbau = t.behaelter.schreibungen;
		const rufe = Object.assign({}, t.rufe);
		beenden(z);
		await warte();
		await warte();
		pruefeStill(fall, t, nachAbbau, rufe, 0);
		assert.strictEqual(t.steuerung.bereit, false, fall + ": nicht bereit");
		faelle++;
	}

	// ── 3) `neuLaden()` NACH DEM ABBAU ruft `laden` gar nicht erst ──────────────────────────────────────────────────────
	{
		const t = montiere({ laden: KRAFTLINIE_STAND });
		await warte();
		t.steuerung.zerstoeren();
		const nachAbbau = t.behaelter.schreibungen;
		await t.steuerung.neuLaden();
		await warte();
		pruefeStill("neuLaden nach dem Abbau", t, nachAbbau, { laden: 1, zuweisen: 0, loesen: 0, verwerfen: 0, syncUebernehmen: 0 }, 0);
		faelle++;
	}

	// ── 4) SUCHE aus einer mitgegebenen Liste: die Antwort kommt als Zusage, der Abbau im selben Zug ────────────────────
	{
		const t = montiere({ laden: KRAFTLINIE_STAND });
		await warte();
		t.behaelter.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
		t.steuerung.zerstoeren();
		const nachAbbau = t.behaelter.schreibungen;
		const rufe = Object.assign({}, t.rufe);
		await warte();
		pruefeStill("Listen-Suche", t, nachAbbau, rufe, 0);
		faelle++;
	}

	// ── 5) SUCHE beim Server: `fetch` zurueckgehalten -- Antwort und Fehlschlag nach dem Abbau ──────────────────────────
	for (const [fall, beenden] of [
		["Server-Suche antwortet nach dem Abbau", (z) => z.aufloesen({ ok: true, json: async () => ({ rows: [{ name: "Reichsstraße 2", wiki_key: "reichsstrasse-2" }] }) })],
		["Server-Suche scheitert nach dem Abbau", (z) => z.ablehnen(new Error("Netzabbruch"))],
	]) {
		const z = zurueckgehalten();
		let abrufe = 0;
		global.fetch = () => { abrufe += 1; return z.zusage; };
		const t = montiere({ subject: "weg", laden: () => ({ artikel: null, kartenwerte: { feature_subtype: "Strasse" } }) });
		await warte();
		t.behaelter.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
		assert.strictEqual(abrufe, 1, fall + ": die Suche laeuft (sonst prueft der Rest nichts)");
		t.steuerung.zerstoeren();
		const nachAbbau = t.behaelter.schreibungen;
		const rufe = Object.assign({}, t.rufe);
		beenden(z);
		await warte();
		await warte();
		pruefeStill(fall, t, nachAbbau, rufe, 0);
		faelle++;
	}

	// ── 6) DIE TIPP-UHR: nach dem Abbau geht keine Suche mehr ab ────────────────────────────────────────────────────────
	{
		let abrufe = 0;
		global.fetch = () => { abrufe += 1; return new Promise(() => {}); };
		const t = montiere({ subject: "weg", laden: () => ({ artikel: null, kartenwerte: {} }) });
		await warte();
		t.behaelter.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
		const vorher = abrufe;
		const feld = scheinZiel("data-wa-suche", "");
		feld.value = "Reichs";
		t.behaelter.feuere("input", feld);
		t.steuerung.zerstoeren();
		await warte(260);
		assert.strictEqual(abrufe, vorher, "die Tipp-Uhr eines abgebauten Bauteils schickt keine Suche mehr ab");
		faelle++;
	}

	// ── 7) ZUWEISEN, LOESEN, VERWERFEN, SYNC: der Wirt antwortet nach dem Abbau -- Ja und Nein ─────────────────────────
	const aktionen = [
		// [Rueckruf, Stand, Klicks bis zum Rueckruf]
		["zuweisen", KRAFTLINIE_STAND, [["data-wa-aktion", "zuweisen"], ["data-wa-treffer", "0"]]],
		["loesen", KRAFTLINIE_ZUGEWIESEN, [["data-wa-aktion", "entfernen"]]],
		["verwerfen", KRAFTLINIE_ZUGEWIESEN, [["data-wa-aktion", "verwerfen"]]],
		["syncUebernehmen", KRAFTLINIE_ZUGEWIESEN, [["data-wa-aktion", "sync"], ["data-wa-aktion", "sync-uebernehmen"]]],
	];
	for (const [rueckruf, stand, klicks] of aktionen) {
		for (const antwort of ["aufloesen", "ablehnen"]) {
			const fall = rueckruf + " (" + antwort + ") nach dem Abbau";
			infobox = 0;
			const t = montiere({ laden: stand });
			await warte();
			for (const [merkmal, wert] of klicks) {
				t.behaelter.feuere("click", scheinZiel(merkmal, wert));
				await warte();
			}
			assert.strictEqual(t.rufe[rueckruf], 1, fall + ": der Rueckruf laeuft (sonst prueft der Rest nichts)");
			t.steuerung.zerstoeren();
			const nachAbbau = t.behaelter.schreibungen;
			const rufe = Object.assign({}, t.rufe);
			if (antwort === "aufloesen") {
				t.offen[rueckruf].aufloesen();
			} else {
				t.offen[rueckruf].ablehnen(new Error("Der Server sagt nein."));
			}
			await warte();
			await warte();
			// 💣 Bei `verwerfen` hiesse ein zweiter `laden`-Ruf: das Bauteil laedt nach dem Abbau neu und zeichnet.
			pruefeStill(fall, t, nachAbbau, rufe, 0);
			faelle++;
		}
	}

	// ── 8) GEGENPROBE: ein NICHT abgebautes Bauteil zeichnet weiter ─────────────────────────────────────────────────────
	// 💣 Ohne sie waere ein Riegel, der immer zuschlaegt, ebenfalls gruen -- und jeder Kasten im Haus bliebe leer.
	{
		infobox = 0;
		const z = zurueckgehalten();
		const t = montiere({ laden: () => z.zusage });
		z.aufloesen(KRAFTLINIE_ZUGEWIESEN());
		await warte();
		assert.ok(t.behaelter.innerHTML.includes("Gareth"), "ohne Abbau zeichnet der Ladelauf: " + t.behaelter.innerHTML.slice(0, 120));
		assert.strictEqual(t.steuerung.bereit, true);
		t.behaelter.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
		await warte();
		t.offen.loesen.aufloesen();
		await warte();
		await warte();
		assert.strictEqual(infobox, 1, "ohne Abbau zieht das Loesen die Infobox nach");
		assert.strictEqual(t.steuerung.lies().wiki_key, "", "… und uebernimmt die Loesung in seinen Stand");
		faelle++;
	}

	console.log("OK - wiki-assign-nach-dem-abbau: " + faelle + " Faelle, ein abgebautes Bauteil zeichnet und schreibt nicht mehr");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
