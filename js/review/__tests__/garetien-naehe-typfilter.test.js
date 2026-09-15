// Aufgabe 13 (07.09.2026): DER TYPENFILTER des Naehe-Knopfs -- Auftrag: „einen Filter bzw. ein
// Dropdown, um Objekte gleichen oder eines bestimmten Typs" zu erfassen.
//
// Gepruft werden zwei REINE Funktionen (kein DOM, kein Modulzustand):
//   garetienNaeheGruppen(gefunden, eigenerTyp) -> [{key, label}]
//   garetienNaeheMenge(gefunden, eigenerTyp, wahl) -> die Objekte
// und, integrativ, dass Markup und Klick dieselbe Rechnung benutzen (garetienNaeheAktuelleMenge)
// -- eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-naehe-typfilter.test.js
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet -- `global.document`
// muss deshalb VOR dem `require` stehen (Vorbild: garetien-naehe-markieren.test.js).

"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }

// ---- Das gefälschte `document`/`window` -- VOR jedem require. ---------------------------------
function macheElement(id) {
	return {
		id: id, hidden: true, disabled: false, innerHTML: "", textContent: "",
		addEventListener() {}, removeEventListener() {},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		contains() { return true; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}
const ELEMENTE = {};
["garetien-detailcol", "garetien-list"].forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const modul = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienNaeheGruppen,
	garetienNaeheMenge,
	garetienNaeheWahlAktuell,
	garetienNaeheWahlSetzen,
	garetienNaeheAktuelleMenge,
	garetienNaeheMarkup,
	garetienNaeheBeiBedarfLaden,
	garetienNaeheKlick,
} = modul;

wahr(typeof garetienNaeheGruppen === "function", "garetienNaeheGruppen fehlt im Export");
wahr(typeof garetienNaeheMenge === "function", "garetienNaeheMenge fehlt im Export");

// =================================================================================================
// A. garetienNaeheGruppen / garetienNaeheMenge -- EXAKT der Brief (Zusicherungen 1-4)
// =================================================================================================
// ⚠️ `stand: "offen"` steht an JEDEM Treffer -- waehlbar ist seit dem 15.09.2026, was auf die Stage kann
// (offen und noch nicht dort). Ein Treffer OHNE `stand` waere nicht waehlbar -- so kommt er aus
// `garetien-liste.php` auch nie.
const gefunden = [
	{ key: "a", typ: "Fluss", stand: "offen" }, { key: "b", typ: "Fluss", stand: "offen" },
	{ key: "c", typ: "Bach", stand: "offen" }, { key: "d", typ: "See", stand: "offen" },
];

// 1. Vorgabe ist der EIGENE Typ, und er steht oben.
const g = garetienNaeheGruppen(gefunden, "Fluss");
gleich(g[0].key, "gleich", "die erste Gruppe ist der eigene Typ");
gleich(g[0].label, "gleicher Typ · Fluss (2)", "ihre Beschriftung nennt den Typ und seine Zahl");

// 2. Dann jeder gefundene Typ mit seiner Zahl, zuletzt „alle".
tief(g.slice(1).map((e) => e.label), ["Bach (1)", "Fluss (2)", "See (1)", "alle Typen (4)"],
	"alphabetisch, dann 'alle Typen' am Ende: " + JSON.stringify(g));

// 3. Die Auswahl bestimmt, was gewählt wird -- und die Zahl im Knopf.
tief(garetienNaeheMenge(gefunden, "Fluss", "Bach").map((o) => o.key), ["c"], "'Bach' liefert nur c");
tief(garetienNaeheMenge(gefunden, "Fluss", "gleich").map((o) => o.key), ["a", "b"],
	"'gleich' liefert den eigenen Typ (Fluss)");
gleich(garetienNaeheMenge(gefunden, "Fluss", "alle").length, 4, "'alle' liefert den ganzen Fund");

// 4. Ohne eigenen Typ faellt die Gruppe „gleich" WEG, statt leer dazustehen.
gleich(garetienNaeheGruppen(gefunden, "").some((e) => e.key === "gleich"), false,
	"ohne eigenen Typ gibt es keine 'gleich'-Gruppe");
tief(garetienNaeheGruppen(gefunden, "").map((e) => e.key), ["Bach", "Fluss", "See", "alle"],
	"die uebrigen vier Gruppen bleiben stehen, nur 'gleich' fehlt");

// =================================================================================================
// B. Randfaelle: der eigene Typ kommt unter den Nachbarn gar nicht vor; leerer Fund
// =================================================================================================
const gSee = garetienNaeheGruppen(gefunden, "Ödland");
gleich(gSee[0].label, "gleicher Typ · Ödland (0)",
	"ein eigener Typ, den KEIN Nachbar traegt, bleibt die Vorgabe -- mit (0), nicht weggelassen");
tief(garetienNaeheMenge(gefunden, "Ödland", "gleich"), [], "und waehlt entsprechend nichts aus");

const gLeer = garetienNaeheGruppen([], "Fluss");
tief(gLeer.map((e) => e.label), ["gleicher Typ · Fluss (0)", "alle Typen (0)"],
	"ohne Fund bleiben nur 'gleich' (0) und 'alle Typen (0)' -- keine Typzeilen dazwischen");
gleich(garetienNaeheMenge([], "Fluss", "alle").length, 0, "und 'alle' ist dann ebenfalls leer");

// Ein unbekannter Typ (z. B. eine veraltete Wahl nach einem Objektwechsel) waehlt schlicht nichts.
tief(garetienNaeheMenge(gefunden, "Fluss", "Unbekannt"), [],
	"eine Wahl, die zu keinem gefundenen Typ passt, waehlt nichts aus");

// =================================================================================================
// C. garetienNaeheWahlAktuell -- die Vorgabe ist die ERSTE Gruppe, eine veraltete Wahl faellt zurueck
// =================================================================================================
gleich(garetienNaeheWahlAktuell(g), "gleich", "ohne eigenes Zutun gilt die erste Gruppe (der eigene Typ)");
gleich(garetienNaeheWahlAktuell(garetienNaeheGruppen(gefunden, "")), "Bach",
	"ohne eigenen Typ ist die erste Gruppe der erste (alphabetische) Fund-Typ");

garetienNaeheWahlSetzen("See");
gleich(garetienNaeheWahlAktuell(g), "See", "eine gesetzte, gueltige Wahl gilt");
garetienNaeheWahlSetzen("nicht-vorhanden");
gleich(garetienNaeheWahlAktuell(g), "gleich",
	"eine Wahl, die zu keiner aktuellen Gruppe mehr passt, faellt auf die erste Gruppe zurueck");
garetienNaeheWahlSetzen("");

// =================================================================================================
// D. garetienNaeheMarkup -- das <select> steht da, traegt die Gruppen, und die Knopfzahl folgt der
//    WAHL, nicht der Gesamtzahl (Brief: "Imports in der Nähe wählen (2)", nicht "(24)")
// =================================================================================================
async function pruefeMarkupUndKlick() {
	const echtesFetch = global.fetch;
	try {
		global.fetch = function () {
			return Promise.resolve({
				json: () => Promise.resolve({ ok: true, gefunden: gefunden, radius: 5 }),
			});
		};
		const objekt = { key: "gi:typfilter:1", typ: "Fluss", geometrie: [[1, 1]] };
		garetienNaeheBeiBedarfLaden(objekt);
		await new Promise((fertig) => setTimeout(fertig, 0));

		const markup = garetienNaeheMarkup(objekt);
		wahr(markup.includes('<select class="gi-naehe__typ"'), "das Dropdown fehlt: " + markup);
		wahr(markup.includes("data-naehe-typ"), "das Dropdown braucht sein Erkennungsmerkmal");
		wahr(markup.includes("gleicher Typ · Fluss (2)"), "die eigene Gruppe steht als Option da");
		wahr(markup.includes("alle Typen (4)"), "und 'alle Typen' ebenso");
		// Vorgabe ist "gleich" (2 Treffer) -- die Knopfzahl folgt ihr, nicht der Gesamtzahl (4).
		wahr(markup.includes("Imports in der Nähe wählen (2)"),
			"die Knopfzahl folgt der Wahl (2), nicht dem gesamten Fund (4): " + markup);
		wahr(!markup.includes("Imports in der Nähe wählen (4)"),
			"und NICHT die Gesamtzahl, solange 'gleich' gewaehlt ist: " + markup);

		// Wählt der Editor "Bach" (1 Treffer), folgt die Knopfzahl dieser Wahl.
		garetienNaeheWahlSetzen("Bach");
		const markupBach = garetienNaeheMarkup(objekt);
		wahr(markupBach.includes("Imports in der Nähe wählen (1)"),
			"nach der Wahl 'Bach' zeigt der Knopf (1): " + markupBach);
		wahr(markupBach.includes('value="Bach" selected'), "die Auswahl steht auch im <select>: " + markupBach);

		// ---- D2: der Klick waehlt GENAU die aktuell gefilterte Menge, staged NICHTS.
		modul.avesmapsGaretienAuswahlAufheben();
		modul.avesmapsGaretienStageLeeren();
		function scheinKnopf(disabled) {
			return { disabled: !!disabled, closest(sel) { return sel === "[data-naehe]" ? this : null; } };
		}
		const menge = garetienNaeheAktuelleMenge(objekt);
		tief(menge.map((o) => o.key), ["c"], "die aktuelle Menge ist die gewaehlte Gruppe ('Bach' -> c)");
		const ergebnis = garetienNaeheKlick({ target: scheinKnopf(false) }, menge);
		gleich(ergebnis, 1, "der Klick meldet die Zahl der GEWAEHLTEN (nicht aller gefundenen) Objekte");
		gleich(modul.avesmapsGaretienAuswahlHat("c"), true, "'Bach' (c) ist jetzt ausgewaehlt");
		gleich(modul.avesmapsGaretienAuswahlHat("a"), false, "'Fluss' (a) NICHT -- er war nicht gewaehlt");
		gleich(modul.avesmapsGaretienStageHat("c"), false,
			"und NICHTS davon liegt auf der Stage -- der Knopf stagt nicht mehr (Aufgabe 13)");

		// Auf 'alle' umgestellt waehlt der naechste Klick den GANZEN Fund.
		garetienNaeheWahlSetzen("alle");
		const mengeAlle = garetienNaeheAktuelleMenge(objekt);
		gleich(mengeAlle.length, 4, "'alle' waehlt den ganzen Fund");
		modul.avesmapsGaretienAuswahlAufheben();
		garetienNaeheKlick({ target: scheinKnopf(false) }, mengeAlle);
		["a", "b", "c", "d"].forEach((k) => {
			gleich(modul.avesmapsGaretienAuswahlHat(k), true, "'" + k + "' ist bei 'alle' mit dabei");
		});

		// ---- D3: ein neues Objekt beginnt ohne Wahl -- der Typenfilter des vorigen Objekts darf
		// nicht in die naechste Zeile hineinreisen.
		garetienNaeheWahlSetzen("Bach");
		const zweitesObjekt = { key: "gi:typfilter:2", typ: "See", geometrie: [[9, 9]] };
		garetienNaeheBeiBedarfLaden(zweitesObjekt);
		await new Promise((fertig) => setTimeout(fertig, 0));
		const markupZweites = garetienNaeheMarkup(zweitesObjekt);
		wahr(markupZweites.includes("gleicher Typ · See"),
			"das neue Objekt startet mit SEINEM eigenen Typ vorgewaehlt, nicht mit 'Bach': "
			+ markupZweites);
	} finally {
		if (echtesFetch) { global.fetch = echtesFetch; } else { delete global.fetch; }
	}
}

// =================================================================================================
// E. DIE WÄHLBARKEIT (Owner 15.09.2026) -- die Zahlen des Typenfilters folgen derselben Grenze wie der
//    Klick, und die Grenze ist nicht mehr der Reiter, sondern „kann auf die Stage".
// =================================================================================================
async function pruefeWaehlbarkeit() {
	const echtesFetch = global.fetch;
	try {
		modul.avesmapsGaretienStageLeeren();
		modul.avesmapsGaretienAuswahlAufheben();
		const gemischt = [
			{ key: "f1", typ: "Fluss", stand: "offen" },
			{ key: "f2", typ: "Fluss", stand: "offen" },
			{ key: "s1", typ: "Fluss", stand: "offen" },
			{ key: "f3", typ: "Fluss", stand: "uebernommen" },
			{ key: "b1", typ: "Bach", stand: "abgelehnt" },
		];
		modul.avesmapsGaretienStageHinzufuegen([gemischt[2]]);
		global.fetch = function () {
			return Promise.resolve({
				json: () => Promise.resolve({ ok: true, gefunden: gemischt, radius: 5 }),
			});
		};
		const objekt = { key: "gi:reiter:1", name: "Grosser Fluss", typ: "Fluss", geometrie: [[3, 3]] };
		garetienNaeheBeiBedarfLaden(objekt);
		await new Promise((fertig) => setTimeout(fertig, 0));

		// 🔴 Der Reiter spielt keine Rolle mehr: auf der Stage wie auf „Offen" dieselbe Zahl.
		for (const reiter of ["stage", "offen"]) {
			modul.garetienReiterSetzen(reiter);
			const markup = garetienNaeheMarkup(objekt);
			wahr(markup.includes("Imports in der Nähe wählen (2)"),
				"💣 auf „" + reiter + "\" zaehlt der Knopf die zwei, die auf die Stage koennen: " + markup);
			wahr(markup.includes("gleicher Typ · Fluss (2)") && markup.includes("alle Typen (2)"),
				"die Gruppen folgen derselben Grenze: " + markup);
			wahr(!markup.includes("Bach ("), "eine Art ohne waehlbaren Treffer steht nicht in der Liste");
			wahr(markup.includes("Nicht wählbar: 1 schon auf der Stage, 1 übernommen, 1 abgelehnt."),
				"💣 der Rest wird mit Grund genannt: " + markup);
		}
		tief({ ...modul.garetienNaeheFremdAnzahl(objekt) }, { stage: 1, uebernommen: 1, abgelehnt: 1, sonst: 0 },
			"der Fremd-Leser liefert die Gruende");

		// Der Klick von der Stage aus: Reiter „Offen", die zwei gewaehlt, Ausgangsobjekt sichtbar.
		modul.garetienReiterSetzen("stage");
		const menge = garetienNaeheAktuelleMenge(objekt);
		tief(menge.map((o) => o.key), ["f1", "f2"], "die aktuelle Menge endet an der Waehlbarkeit");
		garetienNaeheKlick({
			target: { disabled: false, closest(sel) { return sel === "[data-naehe]" ? this : null; } },
		}, menge, objekt);
		gleich(modul.avesmapsGaretienFensterZustand().stand, "offen", "🔴 der Klick wechselt auf „Offen\"");
		gleich(modul.avesmapsGaretienAuswahlHat("f1") && modul.avesmapsGaretienAuswahlHat("f2"), true,
			"beide Treffer sind gewaehlt");
		gleich(modul.avesmapsGaretienAuswahlHat("f3"), false, "der uebernommene nicht");
		gleich(modul.avesmapsGaretienAuswahlHat("s1"), false, "der schon gestagte nicht");
		tief([...modul.garetienNaeheAnsichtKeys()], ["gi:reiter:1", "f1", "f2"], "„Offen\" zeigt Anker + Treffer");

		// Der Listenabruf schickt die Schluessel -- nur auf „Offen", nur solange die Ansicht offen ist.
		const rumpfe = [];
		global.fetch = function (url, optionen) {
			rumpfe.push(JSON.parse((optionen && optionen.body) || "{}"));
			return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: [], gesamt: 0 }) });
		};
		try { await modul.avesmapsGaretienListeHolen(); } catch (e) { /* das Zeichnen braucht mehr DOM */ }
		const liste1 = rumpfe.filter((r) => r.action === "liste");
		gleich(liste1.length, 1, "ein Listenabruf");
		tief(liste1[0].keys, ["gi:reiter:1", "f1", "f2"], "🔴 die Naehe-Ansicht reist als `keys`");
		gleich(liste1[0].stand, "offen", "…auf „Offen\"");
		modul.garetienReiterSetzen("uebernommen");
		try { await modul.avesmapsGaretienListeHolen(); } catch (e) { /* s. o. */ }
		const liste2 = rumpfe.filter((r) => r.action === "liste");
		gleich(liste2.length, 2, "ein zweiter Listenabruf");
		gleich(liste2[1].keys, undefined, "🔴 nach dem Reiterwechsel reist KEIN `keys` mehr");
		modul.garetienReiterSetzen("offen");
		modul.avesmapsGaretienAuswahlAufheben();
		modul.avesmapsGaretienStageLeeren();

		// ---- Nur nicht waehlbare Treffer: kein Typenfilter, gesperrter Knopf, ehrlicher Hinweis ----
		global.fetch = function () {
			return Promise.resolve({
				json: () => Promise.resolve({
					ok: true, radius: 5,
					gefunden: [{ key: "z1", typ: "Fluss", stand: "uebernommen" }],
				}),
			});
		};
		const nurFremd = { key: "gi:reiter:2", typ: "Fluss", geometrie: [[4, 4]] };
		garetienNaeheBeiBedarfLaden(nurFremd);
		await new Promise((fertig) => setTimeout(fertig, 0));
		const markupFremd = garetienNaeheMarkup(nurFremd);
		wahr(markupFremd.includes("wählen (0)") && markupFremd.includes("disabled"),
			"ohne waehlbaren Treffer ist der Knopf gesperrt: " + markupFremd);
		wahr(!markupFremd.includes("<select"), "🔴 und es gibt keinen Typenfilter ueber eine leere Menge");
		wahr(markupFremd.includes("Nicht wählbar: 1 übernommen."), "💣 der Hinweis nennt den Grund: " + markupFremd);
		wahr(!markupFremd.includes("Kein weiteres Import-Objekt im Umkreis gefunden"),
			"⚠️ …und behauptet NICHT, es sei nichts gefunden worden");
	} finally {
		if (echtesFetch) { global.fetch = echtesFetch; } else { delete global.fetch; }
	}
}

pruefeMarkupUndKlick().then(pruefeWaehlbarkeit).then(function () {
	console.log(`garetien-naehe-typfilter: ${checks} Pruefungen bestanden.`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
