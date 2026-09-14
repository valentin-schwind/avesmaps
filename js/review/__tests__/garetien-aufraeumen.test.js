// Nachbesserung Runde 1 (14.09.2026), Punkt G -- Aufräumen: veralteter CSS-Kommentar, tote
// Deklarationen, Tippfehler, veraltete Testkommentare ("Kasten Eingefügt wird" -- seit Aufgabe 11
// die Blöcke C, D, E).
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-aufraeumen.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8").replace(/\r\n/g, "\n");

let n = 0;
function wahr(b, warum) { n++; assert.ok(b, warum || ""); }
function gleich(ist, soll, warum) { n++; assert.strictEqual(ist, soll, warum || ""); }

// ---- 1. Der CSS-Kommentar ueber `.gi-acts` widerspricht seit Aufgabe 11 der Wirklichkeit ---------
const css = lies("css", "components", "garetien-importer.css");
// 💣 `indexOf(".gi-acts {")` allein träfe zuerst `.gi-block.gi-acts {` (Vertragsblock, Aufgabe 11)
// -- gesucht wird deshalb NACH der Marke "Aufgabe 15", wo die eigenstaendige Regel steht.
const stelleAufgabe15 = css.indexOf("Aufgabe 15: die Handlungsleiste");
wahr(stelleAufgabe15 !== -1, "die Marke „Aufgabe 15“ existiert");
const stelleActs = css.indexOf("\n.gi-acts {", stelleAufgabe15);
wahr(stelleActs !== -1, "die Regel .gi-acts existiert");
const kommentarDavor = css.slice(Math.max(0, stelleActs - 1200), stelleActs);
wahr(!/darf sie im Markup NIE ein Kind von `\.gi-detail` werden/.test(kommentarDavor),
	"🔴 der Kommentar behauptet nicht mehr, F duerfe nie ein Kind von .gi-detail sein: " + kommentarDavor);
wahr(!/ANGEHEFTET, NICHT IM FLUSS/.test(kommentarDavor)
	|| /rollt (mit|seit)|Block F|kein `position: sticky`/i.test(kommentarDavor),
	"…und wenn noch von „angeheftet“ die Rede ist, dann als Rückblick, nicht als geltende Regel");

// ---- 2. `.gi-acts__titel` traegt keine toten Deklarationen mehr ------------------------------------
const stelleTitel = css.indexOf(".gi-acts__titel {");
wahr(stelleTitel !== -1, "die Regel .gi-acts__titel existiert");
const titelRegel = css.slice(stelleTitel, css.indexOf("}", stelleTitel) + 1);
wahr(!/padding-top/.test(titelRegel), "🔴 `padding-top` ist als tote Deklaration entfernt: " + titelRegel);
wahr(!/border-top/.test(titelRegel), "…und `border-top` ebenso: " + titelRegel);
wahr(/flex:\s*1 0 100%/.test(titelRegel), "…aber `flex: 1 0 100%` bleibt -- sie ist nicht tot");

// ---- 3. Der Tippfehler "trueged" ist weg -----------------------------------------------------------
const quelle = lies("js", "review", "review-garetien-importer.js");
gleich(/trueged/.test(quelle), false, "🔴 „trueged“ kommt im Quelltext nicht mehr vor");
wahr(/trügen zwei Felder dieselbe id/.test(quelle), "…richtig geschrieben steht der Satz weiter da");

// ---- 4. Der doppelte Satz -- F wiederholt den Ruecknahme-Grund aus Block A nicht mehr --------------
const knopfMarkupBereich = quelle.slice(
	quelle.indexOf("function garetienHandlungsMarkup"),
	quelle.indexOf("function garetienHandlungsMarkup") + 1500
);
wahr(!/gruende\.push\(k\.grund\)/.test(knopfMarkupBereich),
	"🔴 der Grund wird beim gesperrten „Zurücknehmen“-Knopf nicht mehr in F gesammelt: "
	+ knopfMarkupBereich);

// ---- 5. Testkommentare, die noch den „Kasten Eingefügt wird" nennen (Ruling: fünf Fundstellen) -----
const testDateien = [
	"garetien-einzelansicht.test.js",
	"garetien-vorwaertsknopf.test.js",
	"garetien-endkreuzung-stroemung.test.js",
	"garetien-wiki-suche.test.js",
];
testDateien.forEach(function (datei) {
	const inhalt = lies("js", "review", "__tests__", datei);
	wahr(!/Kasten\s*[„"]Eingefügt wird[„"]?/.test(inhalt),
		"🔴 " + datei + " nennt nicht mehr den „Kasten Eingefügt wird“: " + datei);
});

// ---- 6. Testlücke: ein Bauwerk OHNE Siedlung im Umkreis -- der Spinner steht trotzdem -------------
// Entwurf §5: „Der Umkreis-Spinner steht bei jedem Bauwerk, auch ohne Treffer" -- fände die Suche
// bei 5 Meilen nichts, wäre sonst auch das Feld weg, mit dem man sie auf 12 stellt.
const vm = require("vm");
global.document = global.document || { documentElement: {}, getElementById() { return null; },
	addEventListener() {}, querySelectorAll() { return []; } };
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };
["js/map-features/ecosystem-display.js", "js/map-features/location-zoom-bands.js"].forEach(function (d) {
	vm.runInThisContext(fs.readFileSync(path.join(WURZEL, d), "utf8"), { filename: d });
});
global.avesmapsLabelArtName = require(path.join(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");
const { api } = ladeImporter();

const QUELLE = { label: "Briefspiel (Garetien)" };
const burgOhneSiedlung = {
	key: "ggp:Sonstiges:Burg:Garetien:Burg Verlassen!Burg Verlassen", name: "Burg Verlassen", typ: "Burg",
	ebene: "Sonstiges", stand: "offen", urteil: "neu", wiki: "ggp", ziel: "location", subtyp: "gebaeude",
	kind: "", geometrie: [[3, 3]], quelle: QUELLE, abschnitte: [],
	// 🔴 KEIN `innerorts` -- die Suche fand keine Siedlung. Genau der Fall, den der Spinner braucht.
	items: [{ id: 601, change_type: "new", anlass: "" }],
};
api.avesmapsGaretienStageLeeren();
(async function () {
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: [burgOhneSiedlung], plan_run_id: 9 }) });
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
	api.avesmapsGaretienStageHinzufuegen([burgOhneSiedlung]);
	api.garetienZielwahlSetzen(burgOhneSiedlung, "nichts");
	const mOhneSiedlung = api.garetienDetailMarkup(burgOhneSiedlung, null, false);
	const blockCOhneSiedlung = mOhneSiedlung.slice(
		mOhneSiedlung.indexOf('<span class="gi-block__zahl">C</span>'),
		mOhneSiedlung.indexOf('<span class="gi-block__zahl">F</span>')
	);
	wahr(blockCOhneSiedlung.includes("keine Siedlung innerhalb von"),
		"🔴 der Hinweis „keine Siedlung“ steht: " + blockCOhneSiedlung);
	gleich((blockCOhneSiedlung.match(/id="garetien-umkreis-innerorts"/g) || []).length, 1,
		"🔴 der Umkreis-Spinner steht TROTZDEM, genau einmal: " + blockCOhneSiedlung);
	gleich((blockCOhneSiedlung.match(/data-gi-umkreis="innerorts"/g) || []).length, 1,
		"…mit seinem Bedienelement");
	wahr(!blockCOhneSiedlung.includes('data-gi-feld="innerorts"'),
		"…aber ohne Auswahlliste -- es gibt nichts zur Wahl");
	api.garetienZielwahlVergessen();

	// ---- 7. Testlücke: der Deckungsfall (Zielwahl "ergaenzen") -- Name, Form/Art UND Block D
	// abgeblendet, mit dem Grund aus dem Brief. Fixture wie in garetien-zielwahl-ziele.test.js
	// (natter(), Aufgabe 9/10) -- ein Fluss, der sich mit einem bestehenden Objekt deckt.
	function natter() {
		const abschnitte = [];
		const items = [];
		for (let i = 0; i < 3; i++) {
			const abschnitt = { public_id: "Flussweg-44" + i, name: "Natter" };
			abschnitte.push(abschnitt);
			items.push({ id: 700 + i, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"],
				abschnitt: { public_id: abschnitt.public_id } });
		}
		items.push({ id: 717, change_type: "new", anlass: "zusatz", felder: [] });
		return { key: "ggp:Gewaesser:Fluss:Garetien:Natter!Natter", stand: "offen", urteil: "ergaenzung",
			name: "Natter", typ: "Fluss", wiki: "ggp", ziel: "path", subtyp: "Flussweg", kind: "",
			geometrie: [[1, 1], [2, 2]], quelle: QUELLE, abschnitte: abschnitte, items: items };
	}
	const deckungsfall = natter();
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: [deckungsfall], plan_run_id: 10 }) });
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
	api.avesmapsGaretienStageHinzufuegen([deckungsfall]);
	gleich(api.garetienZielwahlZu(deckungsfall), "ergaenzen",
		"Testvoraussetzung: die Vorbelegung ist wirklich „ergaenzen" + '"');
	const mDeckung = api.garetienDetailMarkup(deckungsfall, null, false);
	const blockCDeckung = mDeckung.slice(
		mDeckung.indexOf('<span class="gi-block__zahl">C</span>'),
		mDeckung.indexOf('<span class="gi-block__zahl">D</span>')
	);
	wahr(blockCDeckung.includes("gi-insert__row--aus")
		&& /data-gi-feld="einfuegeName"[^>]* disabled/.test(blockCDeckung),
		"🔴 der Name ist abgeblendet: " + blockCDeckung);
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(blockCDeckung)
		&& blockCDeckung.includes("gilt nicht für eine Ergänzung"),
		"…Form ebenso, mit dem Grund aus dem Brief: " + blockCDeckung);
	const blockDDeckung = mDeckung.slice(
		mDeckung.indexOf('<span class="gi-block__zahl">D</span>'),
		mDeckung.indexOf('<span class="gi-block__zahl">E</span>')
	);
	wahr(blockDDeckung.includes("gi-insert__row--aus"),
		"🔴 und Block D steht grau und gesperrt da (Entwurf §3: abgeblendet, nicht ausgeblendet): "
		+ blockDDeckung);

	console.log("OK -- garetien-aufraeumen (" + n + " Zusicherungen)");
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
