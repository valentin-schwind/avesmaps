// Aufgabe 15 des Garetien Importers -- die vier Handlungen: was ein Objekt bekommt, was der Knopf
// hinausschickt, und was er NICHT anbietet.
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md §5.3
// Brief:   .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-15-brief.md
// Mockup:  docs/garetien-importer-mockup.html §5 und §6
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-handlungen.test.js
//
// 🔴 Geprueft werden die REINEN Haelften (garetienHandlungen, …Rumpf, …Markup, garetienHakenPlan)
// UND die zwei Klickverteiler -- letztere nehmen Ereignis, Objektliste, Lauf-Nummer und ihre
// Werkzeuge HEREIN und lassen sich deshalb ohne Browser am ERGEBNIS messen. Die Optik (angeheftete
// Leiste, hell/dunkel) steht in der Abnahme des Berichts.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function tief(ist, soll, warum) {
	assert.deepStrictEqual(ist, soll, warum || "");
	checks++;
}

const {
	garetienHandlungen, garetienHandlungsRumpf, garetienHandlungsMarkup,
	garetienHakenItems, garetienHakenPlan, garetienHakenRumpf,
	garetienGeometrieRueckfrageText, garetienHandlungKlick, garetienHakenKlick,
	garetienDetailMarkup,
	// Aufgabe 9
	garetienRuecknahmeRueckfrageText, garetienRuecknahmeKlick, garetienRuecknahmeZielSatz,
} = mod;

[["garetienHandlungen", garetienHandlungen], ["garetienHandlungsRumpf", garetienHandlungsRumpf],
	["garetienHandlungsMarkup", garetienHandlungsMarkup], ["garetienHakenPlan", garetienHakenPlan],
	["garetienHandlungKlick", garetienHandlungKlick], ["garetienHakenKlick", garetienHakenKlick],
].forEach(([name, fn]) => wahr(typeof fn === "function", name + " fehlt im Export"));

const namen = (objekt) => garetienHandlungen(objekt).map((k) => k.name);
const knopf = (objekt, name) => garetienHandlungen(objekt).filter((k) => k.name === name)[0];

// =================================================================================================
// A. Die Tafel aus dem Brief, Zeile fuer Zeile
// =================================================================================================

// 💣 Das URTEIL entscheidet, nicht die Nachbarschaft. Der Zufluss liegt auf seinem Hauptfluss und
// bekommt trotzdem „Neu einfuegen" -- 34 der 37 Widersprueche sind genau dieser Fall.
const zufluss = {
	key: "ggp:Gewaesser:Bach:Seitenarm", urteil: "zweifel",
	abschnitte: [{ public_id: "w-1", name: "Natter" }],
	items: [{ id: 1, anlass: "zufluss", change_type: "new", selected: false }],
};
const zuflussKnoepfe = namen(zufluss);
wahr(zuflussKnoepfe.includes("neu"), "ein Zufluss ist ein NEUES Objekt");
wahr(!zuflussKnoepfe.includes("name"),
	"ein Zufluss ersetzt nichts -- unser Nachbar ist der Hauptfluss");
wahr(!zuflussKnoepfe.includes("geometrie"),
	"💣 Ein pauschales Ersetzen ersetzte hier die Natter durch ihren Seitenarm -- gueltige id, "
	+ "keine Fehlermeldung.");
tief(zuflussKnoepfe, ["neu", "ablehnen"], "und sonst gibt es beim Zweifel nichts");

// „neu" sieht genauso aus -- es liegt nichts da, es gibt nichts zu ersetzen.
tief(namen({ urteil: "neu", abschnitte: [], items: [{ id: 9, change_type: "new", selected: 1 }] }),
	["neu", "ablehnen"], "„neu\": einfuegen oder ablehnen");

// 🔴 SEIT 31.08.2026 GIBT ES KEIN ERSETZEN MEHR (Owner: „es gibt neu oder nix - kein
// verändern, kein ersetzen"). Hier standen „name", „quelle" und „geometrie" -- alle drei schrieben
// an einem BESTEHENDEN Objekt. Was bleibt, ist derselbe Satz wie bei „neu": einfügen oder
// ablehnen. ⚠️ Die Zeile mit Treffer bleibt importierbar (ihr Zusatz-Item), sie kann nur nichts
// mehr überschreiben.
tief(namen({ urteil: "ergaenzung", abschnitte: [{ public_id: "w-1", name: "x" }], items: [] }),
	["quelle", "neu", "ablehnen"],
	"die Ergaenzung: Quelle ergaenzen, als eigenes Objekt anlegen, oder ablehnen");
// 💣 UND „NAMEN ERSETZEN" / „SEGMENTE ERSETZEN" GIBT ES IN KEINEM URTEIL MEHR. Ohne diese Schleife
// bewiese die Zeile darüber nur, dass EIN Urteil sie los ist -- „widerspruch" trug beide ebenfalls.
["neu", "zweifel", "ergaenzung", "widerspruch", "deckt_sich", "uebersprungen"].forEach((urteil) => {
	const gefunden = namen({ urteil, abschnitte: [{ public_id: "w-1", name: "x" }], items: [] });
	["name", "geometrie"].forEach((verb) => {
		wahr(!gefunden.includes(verb),
			'das Urteil "' + urteil + '" bietet "' + verb + '" nicht mehr an: ' + gefunden.join(", "));
	});
});

// „widerspricht": ihr Artikel trifft, ihre Geometrie nicht. 🔴 Bis zum 31.08.2026 stand hier die
// Geometriefrage vorn („die Reihenfolge ist die Aussage") -- sie ist ein Ersetzen und gibt es nicht
// mehr. Was bleibt: als eigenes Objekt anlegen oder ablehnen.
tief(namen({ urteil: "widerspruch", abschnitte: [{ public_id: "w-1", name: "x" }], items: [] }),
	["quelle", "neu", "ablehnen"],
	"🔴 der Widerspruch bekommt „neu\" (Owner: „widerspricht ist kein grund, dass es nicht trotzdem "
	+ "eingefuegt werden darf\")");

// 🔴 „deckt sich" hat seit 31.08.2026 ZWEI Ausgaenge: es kann auch als EIGENES Objekt angelegt
// werden. Das ist der einzige Ausgang, den das Abschalten des Ersetzens uebriglaesst -- ohne ihn
// waere eine Zeile mit Treffer ueberhaupt nicht mehr importierbar.
tief(namen({ urteil: "deckt_sich", abschnitte: [], items: [] }), ["quelle", "neu", "ablehnen"],
	"„deckt sich\": Quelle ergaenzen, als eigenes Objekt anlegen, oder ablehnen");
tief(namen({ urteil: "uebersprungen", abschnitte: [], items: [] }), ["ablehnen"],
	"„uebersprungen\" ebenso");

// 🔴 Die zurueckhaltende Richtung: fuer ein Urteil, das dieser Code nicht kennt, wird KEINE
// schreibende Handlung angeboten. Eine Tafel, die im Zweifel „Neu einfuegen" zeigte, boete an,
// etwas anzulegen, worueber sie nichts weiss.
tief(namen({ urteil: "brandneue_kategorie", abschnitte: [], items: [] }), ["ablehnen"],
	"ein unbekanntes Urteil bekommt nur den Ausgang, nie eine schreibende Handlung");
tief(namen({ abschnitte: [], items: [] }), ["ablehnen"], "und ein fehlendes Urteil auch");

// =================================================================================================
// 🔴 HIER STANDEN DIE PRUEFSTAENDE DER DREI ERSETZUNGS-VERBEN -- SIE SIND RAUS
// =================================================================================================
// Owner 31.08.2026: „ich will dass du alle 'ersetzungsfunktionen' des importers augenblicklich
// deaktivierst. es gibt kein ersetzen. es gibt neu oder nix - kein verändern, kein ersetzen." Und
// zu diesen Abschnitten ausdrücklich: „die fliegen raus."
//
// Weg sind: B (warum „Ausgewählte Segmente ersetzen" ausgegraut ist), B2 (kein Häkchen ⇒
// gesperrt, N Häkchen ⇒ wirkt auf genau diese N), C („Nur Quelle + Artikel" gegen „Namen
// ersetzen", unterschieden an der Namensspalte). Alle drei prüften Knöpfe, die es nicht mehr
// gibt.
//
// ⚠️ Was NICHT weg ist: die Maschinerie dahinter im Server. Sie steht weiter unter Test
// (garetien-uebernahme-test.php, garetien-abschnitte-vollstaendig-test.php -- beide definieren
// den Schalter ausdrücklich auf `true`), damit eine spätere, korrigierte Fassung nicht bei null
// anfangen muss. Dass sie live AUS ist, steht in garetien-kein-ersetzen-test.php.

// ⚠️ DIE FIXTUREN BLEIBEN -- spaetere Abschnitte (Klickverteiler, Markup, EINE Tuer) messen an
// ihnen weiter, und sie sind ehrliche Abbilder dessen, was garetien-liste.php live liefert: ein
// Objekt mit Ergaenzungs-Items, wie es bis zum 31.08.2026 entstand. Dass daraus keine Knoepfe mehr
// werden, ist genau die Aussage.
const einer = {
	key: "k", urteil: "ergaenzung", wiki: "ggp",
	abschnitte: [{ public_id: "w-5112", name: "", punkte: 12 }],
	geometrie: [[1, 2], [3, 4], [5, 6]],
	items: [
		{ id: 21, anlass: "ergaenzung", felder: ["name", "quelle"], change_type: "changed", selected: 1,
			abschnitt: { public_id: "w-5112", name: "" } },
		{ id: 22, anlass: "geometrie", felder: ["geometrie"], change_type: "changed", selected: 0,
			abschnitt: { public_id: "w-5112", name: "" } },
	],
};
const strasse = {
	key: "ggp:Wege:Reichsstrasse:Angbarer", urteil: "ergaenzung", wiki: "ggp",
	abschnitte: [1, 2, 3, 4, 5, 6].map((n) => ({ public_id: "w-221" + n, name: "Reichsstrasse 3" })),
	items: [1, 2, 3, 4, 5, 6].map((n) => ([
		{ id: 100 + n, anlass: "umbenennung", felder: ["name"], change_type: "changed", selected: 0,
			abschnitt: { public_id: "w-221" + n, name: "Reichsstrasse 3" } },
		{ id: 200 + n, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 1,
			abschnitt: { public_id: "w-221" + n, name: "Reichsstrasse 3" } },
	])).reduce((a, b) => a.concat(b), []),
};

// 🔴 UND DAS IST DIE ZUSICHERUNG, DIE AN IHRE STELLE TRITT: aus einem Objekt mit
// Ergaenzungs-, Umbenennungs- UND Geometrie-Items entstehen KEINE Ersetzungs-Knoepfe mehr.
[["einer", einer], ["strasse", strasse]].forEach(function (paar) {
	const wie = paar[0];
	const objekt = paar[1];
	tief(namen(objekt), ["quelle", "neu", "ablehnen"],
		wie + ": aus Umbenennungs- und Geometrie-Items werden keine Knoepfe mehr");
	["name", "geometrie"].forEach(function (verb) {
		gleich(garetienHandlungsRumpf(verb, objekt, 7), null,
			wie + ': "' + verb + '" schickt nichts mehr hinaus');
	});
});

// ⚠️ UND DIE GEGENPROBE: „Nur Quelle + Artikel" schickt sehr wohl noch etwas -- sonst maesse die
// Schleife darueber nur, dass ueberhaupt nichts mehr geht.
// 🔴 Sie greift bei der STRASSE, deren Quellen-Items GENAU `['quelle']` tragen -- nicht bei
// `einer`, dessen Item `['name','quelle']` traegt. Das ist kein Zufall, sondern eine alte Regel
// dieses Fensters: ein Item, das AUCH den Namen schreibt, wird nie als „Nur Quelle" angeboten
// (AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG.quelle). Sie wirkt heute als zweiter Riegel gegen genau die
// Umbenennung, die abgeschaltet wurde.
wahr(garetienHandlungsRumpf("quelle", strasse, 7) !== null,
	'strasse: "quelle" geht weiterhin hinaus -- sie ist additiv und traegt die Rechtsfolge');
tief(garetienHandlungsRumpf("quelle", strasse, 7).ids, [201, 202, 203, 204, 205, 206],
	"und zwar genau die sechs reinen Quellen-Items");
gleich(garetienHandlungsRumpf("quelle", einer, 7), null,
	'🔴 ein Item, das AUCH den Namen schreibt, wird NICHT als "Nur Quelle" angeboten');


// =================================================================================================
// D. Der Rumpf, der hinausgeht -- und was NICHT hinausgeht
// =================================================================================================

tief(garetienHandlungsRumpf("neu", zufluss, 7),
	{ action: "select", kind: "garetien", run_id: 7, ids: [1], selected: true },
	"„Neu einfuegen\" hakt das new-Item an -- ueber `select`, nicht ueber einen eigenen Weg");
tief(garetienHandlungsRumpf("quelle", strasse, 7).ids, [201, 202, 203, 204, 205, 206],
	"„Nur Quelle + Artikel\" hakt genau die sechs Quellen-Items an");
gleich(garetienHandlungsRumpf("quelle", strasse, 7).selected, true, "sie HAKT AN");

// 🔴 „Namen ersetzen" und „Ausgewählte Segmente ersetzen" schicken NICHTS mehr hinaus (Owner
// 31.08.2026). Die Items liegen weiterhin in der Datenbank -- kein Knopf fasst sie noch an, und
// der Rumpf-Bauer verweigert sie auch dann, wenn jemand den Namen von Hand hineinreicht.
gleich(garetienHandlungsRumpf("name", strasse, 7), null,
	'„Namen ersetzen" schickt nichts mehr hinaus');
gleich(garetienHandlungsRumpf("geometrie", einer, 7), null,
	'„Ausgewählte Segmente ersetzen" schickt nichts mehr hinaus');

// 💣 Ein leerer vierter Ausgang schickt ebenfalls nichts -- der Riegel steht in der Rechnung,
// nicht am `disabled` des Markups.
gleich(garetienHandlungsRumpf("quelle", einer, 7), null,
	'ein Item, das AUCH den Namen schreibt, ist kein "Nur Quelle"');
// 🔴 Und ein Knopf, den dieses Urteil GAR NICHT anbietet, ist ebenfalls kein Schreibweg.
gleich(garetienHandlungsRumpf("quelle", zufluss, 7), null,
	"💣 was die Tafel nicht anbietet, laesst sich auch nicht ueber den Rumpf erzwingen");

// Ablehnen und Wieder-vorschlagen: sie fassen ALLE Items an, auch das Geometrie-Item.
tief(garetienHandlungsRumpf("ablehnen", einer, 7),
	{ action: "decline", kind: "garetien", run_id: 7, ids: [21, 22] },
	"„Ablehnen\" lehnt das ganze Objekt ab -- samt seines Geometrie-Vorschlags");
const abgelehnt = Object.assign({}, einer, { stand: "abgelehnt" });
tief(namen(abgelehnt), ["wieder"],
	"eine abgelehnte Zeile hat genau EINEN Ausgang zurueck -- alles andere waere Arbeit an einem "
	+ "Objekt, das aus dem Vorrat heraus ist");
tief(garetienHandlungsRumpf("wieder", abgelehnt, 7),
	{ action: "undecline", kind: "garetien", run_id: 7, ids: [21, 22] },
	"„Wieder vorschlagen\" nimmt die Ablehnung zurueck -- eine Ablehnung ohne Rueckweg waere ein "
	+ "schwarzes Loch");

// Ein Objekt OHNE Item kann nicht abgelehnt werden -- und der Knopf sagt es.
const deckt = { key: "d", urteil: "deckt_sich", abschnitte: [], items: [] };
gleich(knopf(deckt, "ablehnen").disabled, true,
	"ohne Vorschlag gibt es nichts, worauf eine Ablehnung zeigen koennte");
wahr(/keinen Vorschlag/.test(knopf(deckt, "ablehnen").grund), "und der Grund sagt genau das");
gleich(garetienHandlungsRumpf("ablehnen", deckt, 7), null, "es geht also auch nichts hinaus");

// 🔴 HIER STAND DIE UMSCHALT-REGEL DER GEOMETRIE („nur sie schaltet um, sonst gaebe es keinen
// Rueckweg"). Ihr Knopf ist weg, die Regel damit gegenstandslos.
// ⚠️ Was BLEIBT: die uebrigen Knoepfe haken nur AN, nie ab -- zurueckgenommen wird an der
// Abschnittszeile. Gemessen an „Nur Quelle + Artikel", dem einzigen verbliebenen Bestandsknopf.
gleich(garetienHandlungsRumpf("quelle", strasse, 7).selected, true,
	'„Nur Quelle + Artikel" hakt immer AN, nie ab');

// =================================================================================================
// E. Das Haekchen -- Zeile und Abschnitt bewegen DIESELBE Menge
// =================================================================================================
//
// 💣 Das Geometrie-Item hat seinen eigenen Knopf MIT Rueckfrage und darf ueber kein Haekchen
// gesetzt werden: ein Klick auf eine Listenzeile merkte sonst lautlos einen Geometrie-Ersatz vor.

tief(garetienHakenItems(einer).map((i) => i.id), [21],
	"das Geometrie-Item gehoert keinem Haekchen");
tief(garetienHakenPlan(einer, null), { ids: [21], selected: false },
	"alles angehakt -> der Klick nimmt zurueck");
tief(garetienHakenPlan(Object.assign({}, einer, {
	items: einer.items.map((i) => Object.assign({}, i, { selected: 0 })),
}), null), { ids: [21], selected: true }, "nichts angehakt -> der Klick hakt an");
// Dreiwertig heisst „alle anhaken" -- die aufbauende Richtung.
tief(garetienHakenPlan(strasse, null).selected, true,
	"halb angehakt -> der Klick hakt ALLE an");
gleich(garetienHakenPlan(strasse, null).ids.length, 12,
	"und zwar wirklich alle zwoelf (die Gegenprobe zur Richtung: es sind nicht nur die sechs offenen)");

// Ein Abschnittshaekchen bewegt NUR seinen Abschnitt.
tief(garetienHakenPlan(strasse, "w-2213"), { ids: [103, 203], selected: true },
	"das Haekchen eines Abschnitts bewegt genau dessen zwei Items");
gleich(garetienHakenPlan(einer, "w-9999"), null, "ein unbekannter Abschnitt bewegt nichts");
gleich(garetienHakenPlan(deckt, null), null, "und ein Objekt ohne Item auch nicht");

tief(garetienHakenRumpf(strasse, "w-2213", 7),
	{ action: "select", kind: "garetien", run_id: 7, ids: [103, 203], selected: true },
	"der Rumpf des Abschnittshaekchens geht durch dieselbe Tuer wie alles andere");

// 🔴 Aufgabe 2 (29.08.2026): die ZEILE zeigt seither die MARKIERUNG (`zustand.markiert`), nicht
// mehr den Item-Zustand -- „Markieren aendert nichts" (Owner). garetienHakenItems/-Plan/-Rumpf
// bleiben oben UNVERAENDERT als reine Rechnung stehen (Aufgabe 5 braucht sie fuer den Fussknopf
// „Alle angezeigten einfuegen"), aber die Zeile selbst liest sie nicht mehr: ihr Haekchen kennt
// nur noch an/aus, kein Item-Mix.
wahr(/<input type="checkbox" checked>/.test(mod.garetienZeileMarkup(einer, true)),
	"markiert -> die Zeile der Alke steht angehakt da");
wahr(!/checked/.test(mod.garetienZeileMarkup(einer, false)),
	"unmarkiert -> unangehakt -- UNABHAENGIG davon, dass ihr Luecken-Item fuer sich allein voll "
	+ "angehakt waere");
wahr(!/data-part/.test(mod.garetienZeileMarkup(einer, true)),
	"und nie mehr dreiwertig -- das Geometrie-Item hat mit dem Haekchen der Zeile nichts mehr zu tun");
// ⚠️ Das Leuchten zaehlt weiter ALLE Items und ist UNABHAENGIG von der Markierung: ein
// vorgemerkter Geometrie-Ersatz IST eine Vormerkung und gehoert auf die Karte, markiert oder nicht.
gleich(mod.avesmapsGaretienHatAuswahl({ items: [{ id: 1, anlass: "geometrie", selected: 1 }] }), true,
	"ein angehaktes Geometrie-Item laesst das Objekt leuchten");

// =================================================================================================
// E2. Das Zusatz-Item darf NIE ueber eine Massenhandlung mitlaufen (Schadensfall 30.08.2026)
// =================================================================================================
//
// Owner-Bestellung 30.08.2026: „Alle angezeigten einfuegen" hat 3007 Objekte uebernommen, viele
// davon Dubletten -- weil garetienHakenItems das Zusatz-Item ("trotzdem neu anlegen" trotz
// erkannter Kollision, garetien-plan.php) nicht kannte und `garetienAnzeigeAnhakenIds` es deshalb
// bei jedem Ergaenzungs-Objekt MIT anhakte. Ein Ergaenzungs-Objekt mit Kollision traegt hier DREI
// Items: das legitime Ergaenzungs-Item (unser bestehendes Objekt bekommt die Quelle), das
// Geometrie-Item (eigener Knopf, siehe Abschnitt E) und das Zusatz-Item selbst.
const kollisionsobjekt = {
	key: "k-zusatz-mengen", urteil: "ergaenzung", wiki: "ggp", name: "Krähensee",
	grund: 'Geometrie liegt 0.42 Einheiten von "Krähensee" (anderer Name)',
	abschnitte: [{ public_id: "r-9001", name: "Krähensee alt" }],
	items: [
		{ id: 9500, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 0,
			abschnitt: { public_id: "r-9001", name: "Krähensee alt" } },
		{ id: 9501, anlass: "geometrie", felder: ["geometrie"], change_type: "changed", selected: 0,
			abschnitt: { public_id: "r-9001", name: "Krähensee alt" } },
		{ id: 9502, anlass: "zusatz", felder: [], change_type: "new", selected: 0 },
	],
};

wahr(mod.garetienItemIstZusatz(kollisionsobjekt.items[2]) === true,
	"das dritte Item ist als Zusatz-Item erkennbar");
wahr(mod.garetienItemIstZusatz(kollisionsobjekt.items[0]) === false,
	"das Ergaenzungs-Item ist KEIN Zusatz-Item, obwohl `anlass` denselben Wortstamm traegt");
wahr(mod.garetienItemIstZusatz(kollisionsobjekt.items[1]) === false,
	"und das Geometrie-Item auch nicht");
gleich(mod.garetienItemIstZusatz(null), false, "ein fehlendes Item ist kein Zusatz-Item");

tief(garetienHakenItems(kollisionsobjekt).map((i) => i.id), [9500],
	"🔴 garetienHakenItems liefert NUR das legitime Ergaenzungs-Item -- weder das Geometrie- noch "
	+ "das Zusatz-Item");
tief(garetienHakenPlan(kollisionsobjekt, null), { ids: [9500], selected: true },
	"nichts angehakt -> der Klick hakt an -- und die id des Zusatz-Items (9502) taucht dort NIE auf");

// Gegenprobe: ein ECHTER Neuzugang (kein Treffer, garetien-plan.php haengt dafuer gar kein
// Zusatz-Item an) bleibt VOLLSTAENDIG anhakbar -- die Ausnahme darf den Normalfall nicht treffen,
// sonst waere „Alle angezeigten einfuegen" fuer jeden echten Neuzugang kaputt.
tief(garetienHakenItems(zufluss).map((i) => i.id), [1],
	"ein genuiner 'new'-Neuzugang (anlass:'zufluss', KEIN Zusatz-Item) bleibt vollstaendig erreichbar");

// Und von der Seite der Massenuebernahme selbst: `garetienAnzeigeAnhakenIds` ist die Funktion
// hinter „Alle angezeigten einfuegen" (Aufgabe 5/8). Die Differenz zaehlt: die id des Zusatz-Items
// darf NIE auftauchen, die des echten Neuzugangs IMMER.
const echterNeuzugang = {
	key: "k-echt-neu-mengen", urteil: "neu", abschnitte: [],
	items: [{ id: 9600, anlass: null, change_type: "new", selected: 0 }],
};
const mengeIds = mod.garetienAnzeigeAnhakenIds([kollisionsobjekt, echterNeuzugang]).slice()
	.sort(function (a, b) { return a - b; });
tief(mengeIds, [9500, 9600],
	"🔴 die Massenuebernahme hakt das changed-Item (9500) und den echten Neuzugang (9600) an -- "
	+ "und lässt das Zusatz-Item (9502) aus, obwohl es zum selben Objekt gehoert");
wahr(mengeIds.indexOf(9502) === -1, "explizit: 9502 ist NICHT dabei");

// =================================================================================================
// 🔴 HIER STAND DIE RÜCKFRAGE VOR „AUSGEWÄHLTE SEGMENTE ERSETZEN" -- SIE IST RAUS
// =================================================================================================
// Owner 31.08.2026: „es gibt kein ersetzen." Der Knopf ist weg, seine Rückfrage damit auch. Sie war
// die einzige Stelle, an der garetienGeometrieRueckfrageText geprüft wurde; die Funktion selbst
// bleibt vorerst stehen (sie ist unerreichbar, aber harmlos) und geht mit dem Rückbau des
// Importers.
// ⚠️ Was NICHT weg ist: die Rückfrage vor „trotzdem neu anlegen" (Abschnitt E2) und die vor
// „Zurücknehmen"/„Ablehnen" -- beide gehören Handlungen, die es weiterhin gibt.

// =================================================================================================
// G. Die Klickverteiler -- gemessen am ERGEBNIS
// =================================================================================================

// Eine winzige DOM-Attrappe. Jeder Knoten sagt, auf welche Selektoren er passt; `closest` laeuft
// von innen nach aussen. So misst der Test den ECHTEN Verteiler statt eines Nachbaus.
function kette(knoten) {
	const kandidaten = knoten.map((k) => Object.assign({
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(k.attribute || {}, name)
				? k.attribute[name] : null;
		},
	}, k));
	// 🪤 EHRLICHER `closest`: eine Auswahl kann MEHRERE, kommagetrennte Alternativen tragen
	// (`'[data-handlung="a"], [data-handlung="b"]'`). Die alte Attrappe verglich die ganze
	// Zeichenkette und lieferte bei jeder Erweiterung des Selektors still `null` -- also „der Klick
	// traf nichts", was von „der Knopf tut nichts" nicht zu unterscheiden ist.
	kandidaten[0].closest = function (auswahl) {
		const teile = String(auswahl).split(",").map(function (t) { return t.trim(); });
		for (const k of kandidaten) {
			for (const teil of teile) {
				if ((k.passt || []).indexOf(teil) !== -1) { return k; }
			}
		}
		return null;
	};
	return kandidaten[0];
}

const objekte = [einer, strasse, zufluss, deckt];
let gesendet = [];
const senden = (rumpf) => { gesendet.push(rumpf); return "gesendet"; };
let gefragt = [];
const jaSagen = (text) => { gefragt.push(text); return true; };
const neinSagen = (text) => { gefragt.push(text); return false; };

function handlungsZiel(name, key, options) {
	return kette([Object.assign({
		passt: ["[data-handlung]", "[data-key]"],
		attribute: { "data-handlung": name, "data-key": key },
	}, options || {})]);
}

gesendet = [];
// 🔴 „Nur Quelle + Artikel" ist der einzige Bestandsknopf, der noch etwas hinausschickt.
gleich(garetienHandlungKlick({ target: handlungsZiel("quelle", strasse.key) }, objekte, 7, senden, jaSagen),
	"gesendet", "ein Klick auf „Nur Quelle + Artikel\" schickt");
gleich(gesendet.length, 1, "und zwar genau einmal");
tief(gesendet[0].ids, [201, 202, 203, 204, 205, 206], "mit den Items dieses Knopfes");
gleich(gefragt.length, 0, "er fragt NICHT nach -- er ergaenzt nur, er ersetzt nichts");

// 🔴 UND DIE ZWEI ERSETZUNGS-KNOEPFE SCHICKEN AUCH ÜBER DEN KLICKVERTEILER NICHTS (Owner
// 31.08.2026). Hier stand die Rueckfrage vor „Ausgewaehlte Segmente ersetzen"; es gibt sie nicht
// mehr, weil es den Knopf nicht mehr gibt.
// 💣 Gemessen am KLICK, nicht nur am Rumpf-Bauer: ein Ereignis, das durch alle Verteiler faellt,
// landet zuletzt bei garetienHandlungKlick -- genau dort muss es folgenlos bleiben.
gesendet = []; gefragt = [];
["name", "geometrie"].forEach(function (verb) {
	garetienHandlungKlick({ target: handlungsZiel(verb, strasse.key) }, objekte, 7, senden, jaSagen);
});
gleich(gesendet.length, 0, "🔴 weder „Namen ersetzen\" noch „Segmente ersetzen\" schicken etwas");
gleich(gefragt.length, 0, "und gefragt wird auch nichts mehr");

// Ein ausgegrauter Knopf schickt nichts -- der Riegel steht ZWEIMAL (Anzeige und Rechnung).
gesendet = [];
gleich(garetienHandlungKlick({ target: handlungsZiel("ablehnen", deckt.key, { disabled: true }) },
	objekte, 7, senden, jaSagen), null, "ein ausgegrauter Knopf schickt nichts");
gleich(gesendet.length, 0, "wirklich nichts");
// Und auch OHNE das `disabled`-Attribut nicht -- „disabled\" ist die Anzeige, nicht der Riegel.
gleich(garetienHandlungKlick({ target: handlungsZiel("ablehnen", deckt.key) }, objekte, 7, senden, jaSagen),
	null, "💣 auch ein Klick am `disabled` vorbei schickt nichts -- der Riegel steht in der Rechnung");
gleich(gesendet.length, 0, "und wirklich nichts");

// Ein Klick daneben loest gar nichts aus.
gleich(garetienHandlungKlick({ target: kette([{ passt: [], attribute: {} }]) }, objekte, 7, senden, jaSagen),
	null, "ein Klick neben die Knopfleiste tut nichts");
gleich(garetienHandlungKlick({ target: handlungsZiel("name", "gibtesnicht") }, objekte, 7, senden, jaSagen),
	null, "und ein unbekannter Schluessel auch nicht");
gleich(garetienHandlungKlick({}, objekte, 7, senden, jaSagen), null, "ein Ereignis ohne Ziel ebenso");

// ---- Das Haekchen -- ZWEI AUFRUFER, ZWEI VERSCHIEDENE FRAGEN (RULING R6, Fix-Runde 1) ----------
//
// 🔴 Das ZEILENHAEKCHEN (kein `data-seg`) ist seit Aufgabe 2 ein reiner MARKER (Entwurf §3.2,
// Owner: „Markieren aendert nichts") -- client-seitig, schreibt nichts.
// 🔴 Das ABSCHNITTSHAEKCHEN (traegt `data-seg`, aus garetienAbschnittMarkup) beantwortet eine
// ANDERE Frage -- „welche Items werden UEBERNOMMEN" -- und bleibt UNVERAENDERT ein Schreibweg:
// `selected` auf dem Server, danach `senden`. Beide Faelle laufen durch DIESELBE Funktion
// (`garetienHakenKlick`, zwei Verdrahtungsstellen: Listenkasten UND Einzelansicht) -- der erste
// Bau von Aufgabe 2 hatte nur den einen Fall im Kopf und traf damit, ohne es zu merken, auch den
// anderen. Diese Sektion faehrt beide Pfade durch GENAU DEN Verteiler, den der Klick wirklich
// nimmt.

function hakenZiel(key, seg, options) {
	const feld = Object.assign({ passt: ['input[type="checkbox"]'], attribute: {} }, options || {});
	const traeger = {
		passt: ["[data-key]", ".avm-row"],
		attribute: seg === null ? { "data-key": key } : { "data-key": key, "data-seg": seg },
	};
	return kette([feld, traeger]);
}

// -- Zeilenhaekchen (kein data-seg): markiert, schickt nichts ------------------------------------
gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(strasse.key, null) }, objekte, 7, senden), true,
	"ein Klick auf das Zeilenhaekchen markiert -- er schickt NICHTS mehr");
gleich(gesendet.length, 0, "der Sender wird beim Zeilenhaekchen nicht mehr gerufen");
gleich(mod.avesmapsGaretienMarkierungHat(strasse.key), true, "und der Markierungsstand traegt es");

gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(strasse.key, null) }, objekte, 7, senden), false,
	"ein zweiter Klick auf DASSELBE Zeilenhaekchen nimmt die Markierung zurueck");
gleich(gesendet.length, 0, "wieder: nichts gesendet");

gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(deckt.key, null) }, objekte, 7, senden), true,
	"🔴 DIE TRAGENDE DIFFERENZ: auch ein Objekt OHNE jedes Item (`deckt`, `items: []`) laesst sich "
	+ "markieren -- das war der Konstruktionsfehler, den Aufgabe 2 behebt: 7930 von 8213 Objekten "
	+ "haben ueberhaupt kein Item und konnten vorher nie ein Haekchen tragen");
gleich(gesendet.length, 0, "und wieder nichts gesendet");

gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(deckt.key, null, { disabled: true }) }, objekte, 7, senden),
	null, "ein gesperrtes Haekchen-ELEMENT markiert nichts -- die Anzeige-Sperre bleibt bestehen, "
	+ "unabhaengig vom Item-Zustand");
gleich(gesendet.length, 0, "nichts davon ging hinaus");
gleich(garetienHakenKlick({ target: kette([{ passt: [], attribute: {} }]) }, objekte, 7, senden), null,
	"ein Klick neben ein Haekchen tut nichts");

// -- Abschnittshaekchen (mit data-seg): sendet UNVERAENDERT, ruehrt die Markierung nicht an -------
//
// 🔴 Der Review fand: kein bestehender Test fuhr diesen kombinierten Pfad -- die
// Handlungen-Tests benutzen synthetische DOM-Stubs (wie hier), aber niemand hatte den Fall MIT
// `data-seg` durch GENAU DIESEN Verteiler (garetienHakenKlick) geschickt. Das hier ist dieser Fall.
const vorMarkierung = mod.avesmapsGaretienMarkierungHat(strasse.key);
gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(strasse.key, "w-2213") }, objekte, 7, senden), "gesendet",
	"ein Klick auf ein Abschnittshaekchen sendet weiterhin -- er ist KEIN Marker");
gleich(gesendet.length, 1, "und zwar genau einmal");
tief(gesendet[0], { action: "select", kind: "garetien", run_id: 7, ids: [103, 203], selected: true },
	"mit den Items GENAU dieses Abschnitts, durch dieselbe Tuer wie zuvor (garetienHakenRumpf)");
gleich(mod.avesmapsGaretienMarkierungHat(strasse.key), vorMarkierung,
	"und die Markierung des Objekts bleibt UNBERUEHRT -- das Abschnittshaekchen ist kein Marker");

// Gegenprobe: DASSELBE Objekt, aber OHNE `data-seg` -- markiert, sendet nichts. Die Weiche haengt
// wirklich am Attribut, nicht am Objekt.
gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(strasse.key, null) }, objekte, 7, senden), !vorMarkierung,
	"dasselbe Objekt OHNE `data-seg` nimmt den MARKER-Pfad -- die Weiche haengt am Attribut, nicht "
	+ "am Objekt");
gleich(gesendet.length, 0, "und hier wird, wie beim Zeilenhaekchen, nichts gesendet");

// Und ein Abschnittshaekchen an einem UNBEKANNTEN Abschnitt sendet nichts (garetienHakenRumpf gibt
// null zurueck) -- und ruehrt die Markierung ebenfalls nicht an.
const vorMarkierungEiner = mod.avesmapsGaretienMarkierungHat(einer.key);
gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(einer.key, "w-9999") }, objekte, 7, senden), null,
	"ein unbekannter Abschnitt sendet nichts");
gleich(gesendet.length, 0, "wirklich nichts");
gleich(mod.avesmapsGaretienMarkierungHat(einer.key), vorMarkierungEiner,
	"und die Markierung bleibt unberuehrt -- auch im Fehlschlagfall ist das Abschnittshaekchen "
	+ "kein Marker");

// =================================================================================================
// H. Das Markup: angeheftet, weich, mit sichtbarem Grund
// =================================================================================================

const leiste = garetienHandlungsMarkup(strasse);
wahr(/^<div class="gi-acts">/.test(leiste), "die Leiste ist ein .gi-acts");
wahr(/data-handlung="quelle"/.test(leiste) && /data-key="ggp:Wege:Reichsstrasse:Angbarer"/.test(leiste),
	"jeder Knopf traegt seine Handlung UND seinen Schluessel selbst -- kein Modulzustand daneben");
// 🔴 UND DIE ZWEI ERSETZUNGS-KNOEPFE STEHEN NICHT MEHR IM MARKUP (Owner 31.08.2026). Das ist die
// Zusicherung an der Oberflaeche: ein Knopf, den der Server ablehnt, waere eine Fehlermeldung als
// Bedienelement.
wahr(!/data-handlung="name"/.test(leiste) && !/data-handlung="geometrie"/.test(leiste),
	"weder „Namen ersetzen\" noch „Segmente ersetzen\" stehen noch im Markup: " + leiste);
wahr(/class="btn btn--danger"[^>]*data-handlung="ablehnen"/.test(leiste),
	"„Ablehnen\" traegt --color-danger als SCHRIFT-Klasse, nicht als Fuellung");
wahr(!/btn--main/.test(leiste),
	"🔴 KEINE gefuellte Handlung in der Einzelansicht -- die eine steht im Fuss (AGENTS.md §12)");
wahr(/btn--done[^>]*data-handlung="quelle"/.test(leiste),
	"der erledigte Knopf traegt btn--done");
// 💣 IN DER ABNAHME IM BROWSER GEFUNDEN: „Ablehnen" trug ein ✓ und den gruenen Grund, sobald
// zufaellig ALLE Items angehakt waren -- es las sich als „schon abgelehnt", waehrend in Wahrheit
// das Gegenteil galt (alles vorgemerkt). „Erledigt" heisst ausschliesslich „die Items DIESES
// Knopfes sind vorgemerkt"; eine Ablehnung merkt nichts vor.
const allesGehakt = Object.assign({}, einer, {
	items: einer.items.map((i) => Object.assign({}, i, { selected: 1 })),
});
gleich(knopf(allesGehakt, "ablehnen").erledigt, false,
	"💣 „Ablehnen\" wird NIE erledigt -- ein gruenes ✓ daran laese sich als „schon abgelehnt\"");
// ⚠️ Die Gegenprobe lief bis zum 31.08.2026 ueber „Geometrie ersetzen"; den Knopf gibt es nicht
// mehr. „Nur Quelle + Artikel" tut dasselbe -- gemessen an der STRASSE, deren Quellen-Items GENAU
// `['quelle']` tragen (bei `einer` steht `['name','quelle']`, und ein solches Item wird nie als
// „Nur Quelle" angeboten).
const strasseGehakt = Object.assign({}, strasse, {
	items: strasse.items.map((i) => Object.assign({}, i, { selected: 1 })),
});
gleich(knopf(strasseGehakt, "quelle").erledigt, true,
	"die Gegenprobe: derselbe Zustand macht „Nur Quelle + Artikel\" sehr wohl erledigt");
gleich(knopf(abgelehnt, "wieder").erledigt, false, "und „Wieder vorschlagen\" ebenso wenig");
wahr(!/btn--done[^>]*data-handlung="ablehnen"|data-handlung="ablehnen"[^>]*btn--done/
	.test(garetienHandlungsMarkup(allesGehakt)),
	"und auch im Markup traegt „Ablehnen\" die Klasse nicht");
wahr(/Nur Quelle \+ Artikel \(6\) ✓</.test(leiste), "und sein ✓ steht IM Knopf");
// ⚠️ Der Gegenprobe-Knopf war „Namen ersetzen (0)"; es gibt ihn nicht mehr. „Neu einfuegen"
// traegt in dieser Lage kein Haekchen und ist damit der nicht-erledigte Zeuge.
wahr(!/data-handlung="neu"[^>]*btn--done/.test(leiste),
	"ein nicht erledigter Knopf traegt weder die Klasse noch das Haken-Zeichen");

// 🔴 Ein ausgegrauter Knopf traegt seinen Grund im title -- gemessen am Objekt OHNE Vorschlag,
// dem einzigen, das noch einen gesperrten Knopf erzeugt („Ablehnen" ohne Item).
const leisteAus = garetienHandlungsMarkup(deckt);
wahr(/disabled title="[^"]*keinen Vorschlag/.test(leisteAus),
	"ein ausgegrauter Knopf traegt seinen Grund im title: " + leisteAus);
wahr(/gi-acts__grund/.test(leisteAus) && />Ablehnen: [^<]*keinen Vorschlag/.test(leisteAus),
	"💣 und SICHTBAR daneben -- ein title erscheint nur beim Verweilen, am Telefon nie: " + leisteAus);
// ⚠️ Hier stand bis zum 31.08.2026 die Probe an „Ausgewählte Segmente ersetzen" samt der Regel,
// dass der sichtbare Grund die Auslassungspunkte des Knopfes NICHT mitträgt. Beides ging mit dem
// Knopf; die Regel selbst lebt in AVESMAPS_GARETIEN_HANDLUNG_MIT_RUECKFRAGE weiter und hat heute
// keinen Träger mehr.

wahr(garetienHandlungen(zufluss).every((k) => !k.disabled),
	"die Gegenprobe hat wirklich ein Objekt ohne ausgegrauten Knopf");
wahr(!/gi-acts__grund/.test(garetienHandlungsMarkup(zufluss)),
	"ohne ausgegrauten Knopf steht auch keine Grundzeile da (die DIFFERENZ, nicht nur das Vorhandensein)");

// 🔴 DIE LEISTE IST EIN GESCHWISTER von .gi-detail, nicht ihr Kind: sie haengt als `flex: none` am
// Fuss der Spalte, waehrend die Ansicht darueber rollt. Laege sie IM Rollkasten, stuende die
// Entscheidung bei 13 Abschnitten hinter der Bildlaufleiste -- und bei kurzen Objekten faellt das
// gar nicht auf.
const spalte = garetienDetailMarkup(einer);
wahr(spalte.indexOf('<div class="gi-acts">') > spalte.indexOf('<div class="gi-detail">'),
	"die Leiste steht NACH der Ansicht");
wahr(/<\/div><div class="gi-acts">/.test(spalte),
	"💣 und AUSSERHALB von ihr -- das schliessende </div> der .gi-detail steht davor");
// Ohne Auswahl gibt es auch keine Leiste (ein Knopf ohne Objekt ist ein Knopf ins Leere).
wahr(!garetienDetailMarkup(null).includes("gi-acts"), "ohne Auswahl steht keine Knopfleiste da");

// Escaping, auch hier.
wahr(!garetienHandlungsMarkup({ key: '"><img src=x>', urteil: "neu", abschnitte: [], items: [] })
	.includes("<img"), "der Schluessel wird escaped");

// =================================================================================================
// I. EINE Tuer. Jeder Knopf geht durch sync-plan.php -- nirgends sonst wird geschrieben.
// =================================================================================================
//
// 🪤 KORRIGIERT 28.08.2026. Im Brief stand `quelle.match(/fetch\(\s*["'][^"']*\.php/g)`, und das
// ist ein NULLTEST: `avesmapsGaretienRufe` ruft `fetch(pfad, …)` mit einer VARIABLEN, nie einem
// Literal -- das Muster trifft NICHTS, der forEach laeuft null Mal, und die Zusicherung bestaetigt
// gar nichts. Genau diese Form ist in Aufgabe 11 schon einmal live aufgetreten.
// 💣 Und Kommentare muessen VORHER weg: die Moduldatei erklaert das Wort „fetch(" mehrfach in
// Prosa -- ungestrippt zaehlt der direkte Zaehler zu hoch und ist von Anfang an rot.
const quelle = fs.readFileSync(path.join(WURZEL, "js/review/review-garetien-importer.js"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
gleich((quelle.match(/\bfetch\(/g) || []).length, 1,
	"Geschrieben wird NUR ueber avesmapsGaretienRufe -- ein zweiter fetch( ist ein zweiter Weg.");
const phpAdressen = quelle.match(/["'][^"']*\.php["']/g) || [];
// ⚠️ Die Gegenprobe gehoert dazu: ein Filter belegt die DIFFERENZ, nie das Ergebnis.
wahr(phpAdressen.length > 0, "die Gegenprobe findet selbst gar keine .php-Adresse");
phpAdressen.forEach((treffer) => {
	wahr(/sync-plan\.php|garetien-import\.php/.test(treffer),
		`Ein zweiter Schreibweg: ${treffer}. Geschrieben wird NUR ueber sync-plan.php mit kind:'garetien'.`);
});
wahr(!/garetien-import\.php[\s\S]{0,400}action["']?\s*:\s*["']apply/.test(quelle),
	"Der Import-Endpunkt hat bewusst kein apply -- und bekommt hier auch keins.");

// Eine Ablehnung ist umkehrbar: „Wieder vorschlagen" steht schon im Blatt (data-undecline).
wahr(quelle.includes("undecline"), "eine Ablehnung ohne Rueckweg ist ein schwarzes Loch");

// 🔴 REVISION 29.08.2026 (Aufgabe 8): DIESE DATEI NENNT `apply` JETZT SEHR WOHL. Bis Aufgabe 15
// merkte sie nur vor -- „apply" kam erst durch das Uebernahme-Blatt (Aufgabe 16). Der Owner fand
// genau das kaputt: „kommt eine neue seite, anstatt alle angezeigten einzufuegen" -- der Knopf
// fuegte nicht ein. Seit Aufgabe 8
// (.superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-8-brief.md) rufen „Neu
// einfügen" (garetienNeuKlick) und der Fussknopf (garetienFussknopfEinfuegenKlick) selbst
// `action: "apply"` -- ueber die gemeinsame garetienEinfuegenAusfuehren, NIE ueber einen zweiten
// fetch( (siehe die Zusicherung oben: genau EIN fetch( in der ganzen Datei -- avesmapsGaretienRufe
// bleibt die einzige Tuer, `apply` geht durch dieselbe Tuer wie alles andere).
// 🪤 Gesucht wird das blanke ZEICHENKETTEN-LITERAL: die Aktionen dieser Datei stehen teils in
// einem Bedingungsausdruck (`name === "ablehnen" ? "decline" : "undecline"`), und ein Muster, das
// ein `action:` davor verlangt, faende die nicht -- es waere fuer die falschen Gruende gruen.
wahr(/["']apply["']/.test(quelle),
	"🔴 seit Aufgabe 8 schreibt diese Datei WIRKLICH -- „apply\" MUSS hier stehen, sonst fuegt "
	+ "keiner der beiden Knoepfe je etwas ein");
// Und die uebrigen vier Handlungen (Namen ersetzen/Nur Quelle/Geometrie ersetzen/Ablehnen/Wieder
// vorschlagen) bleiben UNVERAENDERT reines Vormerken -- garetienHandlungsRumpf (Abschnitt D oben)
// baut fuer sie weiterhin nur `select`/`decline`/`undecline`, nie `apply`. Die Gegenprobe: dasselbe
// Muster MUSS an ALLEN fuenf Aktionen anschlagen, die es in dieser Datei gibt.
["select", "liste", "decline", "undecline", "apply"].forEach((aktion) => {
	wahr(new RegExp('["\']' + aktion + '["\']').test(quelle),
		`die Gegenprobe: „${aktion}\" findet dasselbe Muster sehr wohl`);
});

// =================================================================================================
// J. Die Designsprache: keine hartkodierte Farbe, kein Blau, nichts unter 11px
// =================================================================================================

const css = fs.readFileSync(path.join(WURZEL, "css/components/garetien-importer.css"), "utf8");
const acts = css.slice(css.indexOf("Aufgabe 15: die Handlungsleiste"));
wahr(acts.length > 400, "die Gegenprobe: der Abschnitt der Handlungsleiste wurde wirklich gefunden");
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(acts.replace(/\/\*[\s\S]*?\*\//g, "")),
	"keine hartkodierte Farbe -- nur Tokens aus css/base/tokens.css (AGENTS.md §12)");
wahr(!/\b\d+px\b/.test(acts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/1px solid/g, "")),
	"keine hartkodierten Abstaende -- nur --space-*/--radius-* (die 1px-Trennlinie ist die Hausform)");
["--color-danger-soft-text", "--color-success-soft", "--color-divider", "--font-size-caption"]
	.forEach((token) => {
		wahr(acts.includes(token + ")"), `das Token ${token} fehlt in der Handlungsleiste`);
	});

// 💣 UND DIE MESSUNG, DIE DAS ROTE TOKEN ENTSCHIEDEN HAT -- als Zusicherung, nicht als Notiz.
// „Ablehnen" traegt Rot als SCHRIFT auf `--color-button-soft`. Mit `--color-danger` sind das im
// DUNKLEN Thema 3,71:1, unter den 4,5, die AA fuer 12px verlangt -- und im hellen faellt es nicht
// auf (5,64). Die Zahlen kommen hier aus css/base/tokens.css, nicht aus einer Abschrift.
// ⚠️ Der Leser ist absichtlich stumpf: die ERSTE Fassung eines Tokens ist die helle (blankes
// `:root`), die LETZTE die dunkle. Belegt wird das unten dadurch, dass beide sich unterscheiden --
// ein Leser, der zweimal denselben Wert zieht, misst nur ein Thema doppelt.
const tokenCss = fs.readFileSync(path.join(WURZEL, "css/base/tokens.css"), "utf8");
function tokenWerte(name) {
	// 🪤 Gesplittet, NICHT ueber einen aus einer Zeichenkette gebauten Regex: `"\s*"` in einem
	// JS-Stringliteral ist `"s*"`, und genau diese Form hat dieses Vorhaben schon einmal bezahlt.
	// Der Regex unten ist ein LITERAL. ⚠️ Der Doppelpunkt im Splitmuster ist tragend: sonst traefe
	// `--color-danger` auch `--color-danger-soft-text`.
	const werte = tokenCss.split(name + ":").slice(1)
		.map((rest) => (rest.match(/^\s*(#[0-9a-fA-F]{6})/) || [])[1])
		.filter((wert) => !!wert);
	return { hell: werte[0], dunkel: werte[werte.length - 1], anzahl: werte.length };
}
function leuchtdichte(hex) {
	const teile = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
	return 0.2126 * teile[0] + 0.7152 * teile[1] + 0.0722 * teile[2];
}
function kontrast(a, b) {
	const l1 = leuchtdichte(a), l2 = leuchtdichte(b);
	return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}
const grund = tokenWerte("--color-button-soft");
const weich = tokenWerte("--color-danger-soft-text");
const hart = tokenWerte("--color-danger");
// Gegenprobe zuerst: der Leser hat wirklich ZWEI Themen gefunden, nicht zweimal dasselbe.
[["--color-button-soft", grund], ["--color-danger-soft-text", weich], ["--color-danger", hart]]
	.forEach(([name, w]) => {
		wahr(w.anzahl >= 2 && w.hell && w.dunkel && w.hell !== w.dunkel,
			`der Token-Leser findet fuer ${name} kein helles UND dunkles Paar (${w.hell}/${w.dunkel})`);
	});
["hell", "dunkel"].forEach((thema) => {
	wahr(kontrast(weich[thema], grund[thema]) >= 4.5,
		`„Ablehnen\" liest sich im ${thema}en Thema nur mit ${kontrast(weich[thema], grund[thema])}:1 `
		+ "-- AA verlangt 4,5 bei 12px");
});
// Und der BELEG, dass die Zusicherung etwas misst: das urspruenglich vorgesehene Token faellt
// im dunklen Thema durch. Ohne diese Zeile koennte die Schranke jede Farbe durchlassen.
wahr(kontrast(hart.dunkel, grund.dunkel) < 4.5,
	"die Gegenprobe: --color-danger faellt im dunklen Thema wirklich durch -- sonst misst die "
	+ "Schranke darueber nichts");

// 🔴 UND DIE REGEL, DIE DIE LEISTE TRAEGT: `flex: none` an `.avm-col > .gi-acts`. `.avm-col` ist
// eine Flexspalte mit `overflow: hidden`, `.gi-detail` darin rollt (`flex: 1 1 auto`) -- ohne
// `flex: none` an der Leiste schruempfte sie mit, statt fest zu stehen. Das ist die ganze
// Anheftung; es gibt kein `position: sticky`, das man stattdessen suchen koennte.
wahr(/\.gi-win\s+\.avm-col\s*>\s*\.gi-acts\s*\{[^}]*flex:\s*none/.test(acts),
	"💣 die Handlungsleiste ist ANGEHEFTET (`flex: none` als Kind der Spalte) -- sonst laege die "
	+ "Entscheidung bei 13 Abschnitten hinter der Bildlaufleiste");
// Gegenprobe zum Muster darueber: an einer Regel, die es gibt und die KEIN `flex: none` traegt,
// darf es nicht anschlagen -- sonst misst es nur „irgendwo steht ein geschweiftes Klammerpaar".
wahr(!/\.gi-win\s+\.avm-col\s*>\s*\.gi-acts\s*\{[^}]*position:\s*sticky/.test(acts),
	"die Gegenprobe: dasselbe Muster findet in derselben Regel KEIN position: sticky");

// =================================================================================================
// K. Die Lauf-Nummer kommt aus JEDER Listenantwort -- sonst geht jede Handlung ins Leere
// =================================================================================================
//
// 💣 `garetienLaufStarten` (Aufgabe 12b) setzt `planRunId` nur, wenn in DIESER Sitzung
// „Holen & Rechnen" gedrueckt wurde. Wer das Fenster auf einem BESTEHENDEN Lauf oeffnet -- der
// Normalfall, sobald einmal gerechnet ist --, schickte sonst jede Handlung mit `run_id: null`
// hinaus, und der Endpunkt antwortet darauf mit 404 `not_found`: ein Knopf, der richtig gedrueckt
// wurde und eine Fehlermeldung bekommt.
// ⭐ Gemessen wird am ZUSTAND nach einem echten Lauf von avesmapsGaretienListeHolen, nicht an einer
// Zeile im Quelltext -- gefaelscht ist nur `fetch`.

// =================================================================================================
// L. Nach JEDER Handlung wird die Liste NEU GEHOLT -- die tragendste Regel dieser Aufgabe
// =================================================================================================
//
// 🔴 „Der Server ist die Wahrheit ueber `selected`; zwei Buchhaltungen laufen beim ersten Abbruch
// auseinander." Diese Regel war bis zum 28.08.2026 die EINZIGE der vier ohne Zusicherung: eine
// Pruefung ersetzte `.then(() => avesmapsGaretienListeHolen())` durch `.then(() => null)`, und das
// GANZE JS-Feld blieb gruen. Ausfall in der Wirklichkeit: Haekchen und Reiterzahlen laufen lautlos
// von der Datenbank weg.
// ⭐ Gemessen am ERGEBNIS -- an der FOLGE der Anfragen, die wirklich hinausgehen --, nicht an einem
// Spion auf einer modulinternen Referenz (den sieht der interne Aufrufer ohnehin nicht).

function laufMitGefaelschtemFetch(fn) {
	const echt = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt.push({ pfad: String(pfad), rumpf: rumpf });
		return Promise.resolve({
			json: () => Promise.resolve({
				ok: true, plan_run_id: 4711, objekte: [], gesamt: 0, changed: 1,
				bilanz: {}, reiter: {}, facetten: {}, angehakt: { new: 0, changed: 0 },
			}),
		});
	};
	return Promise.resolve(fn(gestellt))
		.then((wert) => { global.fetch = echt; return { gestellt, wert }; })
		.catch((fehler) => { global.fetch = echt; throw fehler; });
}

laufMitGefaelschtemFetch(() => mod.avesmapsGaretienListeHolen()).then(function (a) {
	gleich(a.gestellt.length, 1, "die Gegenprobe: es lief wirklich eine Anfrage");
	gleich(a.gestellt[0].rumpf.action, "liste", "und zwar die Liste");
	gleich(mod.avesmapsGaretienFensterZustand().planRunId, 4711,
		"💣 die Lauf-Nummer der Vorschau kommt aus der Listenantwort -- ohne sie ginge jede "
		+ "Handlung mit run_id: null hinaus und bekaeme 404 `not_found`");

	// --- Der Sender: EIN `select` hinaus, DANN die Liste -------------------------------------
	return laufMitGefaelschtemFetch(() => mod.avesmapsGaretienHandlungSenden(
		{ action: "select", kind: "garetien", run_id: 4711, ids: [11, 12], selected: true }
	));
}).then(function (a) {
	gleich(a.gestellt.length, 2,
		"💣 EIN `select` loest ZWEI Anfragen aus: den Schreibvorgang und das Neuholen der Liste. "
		+ "Faellt das Neuholen weg, rechnet der Browser weiter mit seinem eigenen Stand.");
	tief(a.gestellt.map((r) => r.rumpf.action), ["select", "liste"],
		"und zwar in dieser Reihenfolge -- erst schreiben, dann lesen");
	gleich(a.gestellt[0].pfad, "/api/edit/wiki/sync-plan.php",
		"geschrieben wird durch die Uebernahme-Tuer");
	gleich(a.gestellt[1].pfad, "/api/edit/map/garetien-import.php",
		"und gelesen ueber den EINEN Weg, auf dem die Liste sich aendert");

	// --- Und wenn der Schreibvorgang scheitert, wird NICHT nachgeladen ------------------------
	// ⚠️ Die andere Haelfte derselben Regel: ein Neuholen nach einem Fehlschlag zeigte eine Liste,
	// die den gescheiterten Klick nicht enthaelt, und uebermalte damit die Fehlermeldung.
	const echt = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		gestellt.push(String(pfad));
		return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "nein" } }) });
	};
	return mod.avesmapsGaretienHandlungSenden({ action: "select", kind: "garetien", ids: [1] })
		.then((wert) => { global.fetch = echt; return { gestellt, wert }; });
}).then(function (a) {
	gleich(a.gestellt.length, 1,
		"nach einem gescheiterten Schreibvorgang wird die Liste NICHT nachgeladen");
	gleich(a.wert, null, "und der Sender loest mit null auf, statt die Ablehnung weiterzureichen");

	return pruefeNeuKlick();
}).then(function () {
	// Meldung B (30.08.2026): dieselbe Kette, aus demselben Grund -- auch dieser Lauf manipuliert
	// `global.fetch`.
	return pruefeNeuKlickZusatz();
}).then(function () {
	// 🔴 Angehängt an DIESELBE Kette, nicht als eigenständige IIFE nebenher: beide manipulieren
	// `global.fetch`, und ein zweiter, unabhängig gestarteter Umtausch liefe der noch offenen Kette
	// mit dem FALSCHEN "echt"-Wert ins Gehege -- derselbe Fehlerklasse wie das geteilte `/tmp` bei
	// parallelen Sitzungen, nur hier im selben Prozess.
	return pruefeRuecknahmeSenden();
}).then(function () {
	// =================================================================================================
// 🔴 „ABLEHNEN" NEBEN „ZURUECKNEHMEN" (Owner 31.08.2026)
// =================================================================================================
// „Ich würde gern neben objekten die 'Übernommen' wurde und die Option 'Zurücknehmen' anbieten auch
// gleichzeitig die Option 'Ablehnen' anbieten, wo sie zurückgenommen und in die kategorie ablehnen
// gesteckt werden."

function ablehnenZiel(key) {
	return kette([{
		passt: ['[data-handlung="ruecknahme_ablehnen"]', "[data-handlung]", "[data-key]"],
		attribute: { "data-handlung": "ruecknahme_ablehnen", "data-key": key },
	}]);
}

// --- Das Markup: zwei echte Knöpfe, beide in Gefahrenfarbe.
const markupZwei = garetienHandlungsMarkup(wegUebernommen);
wahr(/<button[^>]*btn--danger[^>]*data-handlung="ruecknahme_ablehnen"/.test(markupZwei),
	"„Ablehnen\" steht als echter Knopf daneben: " + markupZwei);
wahr(/>Ablehnen</.test(markupZwei), "mit dem Wortlaut des Owners");

// --- 💣 UND BEI EINEM 'changed'-OBJEKT STEHT ER GAR NICHT DA. Owner-Entscheid 1 zu
// „Zurücknehmen" gilt unverändert: kein Knopf, ein sichtbarer Grund. Ein gesperrter Zwilling hätte
// die Regel aufgehoben und den Grund doppelt hingeschrieben.
const markupChangedZwei = garetienHandlungsMarkup(changedUebernommen);
wahr(!/<button/.test(markupChangedZwei),
	"ein 'changed'-Objekt bekommt weiterhin GAR KEINEN Knopf: " + markupChangedZwei);
gleich((markupChangedZwei.match(/gi-acts__grund/g) || []).length, 1, "und den Grund genau EINMAL");
gleich((markupChangedZwei.match(/nicht rücknehmbar/g) || []).length, 1,
	"🩤 wirklich einmal, nicht zweimal derselbe Satz: " + markupChangedZwei);

// --- Der Klickverteiler nimmt BEIDE Verben, und nur „Ablehnen" reicht die Ablehn-Menge weiter.
ruecknahmeGesendet = []; gefragt = [];
const sendenDrei = (idsOderId, runId, ablehnenIds) => {
	ruecknahmeGesendet.push([idsOderId, runId, ablehnenIds]);
	return "gesendet-a";
};
gleich(garetienRuecknahmeKlick({ target: ablehnenZiel(wegUebernommen.key) }, objekteN, 7,
	sendenDrei, jaSagen), "gesendet-a", "der Ablehnen-Knopf wird vom selben Verteiler bedient");
tief(ruecknahmeGesendet[0][0], 501, "zurückgenommen wird das rücknehmbare Item");
tief(ruecknahmeGesendet[0][2], [501], "und abgelehnt werden ALLE Items des Objekts");

// --- 🪤 UND DAS MISST ERST AN EINEM OBJEKT MIT ZWEI VERSCHIEDENEN ITEMS ETWAS. Am Gardel oben sind
// „rücknehmbar" und „alle" dieselbe einelementige Menge -- eine Mutation, die die falsche nimmt,
// bliebe dort unentdeckt (genau diese Falle ist in dieser Sitzung schon zweimal zugeschnappt).
// Hier trägt das Objekt ein übernommenes 'new'-Item UND ein nie übernommenes Umbenennungs-Item.
const gemischtUebernommen = {
	key: "gi9:gemischt", name: "Zweiteiler", urteil: "neu", stand: "uebernommen",
	geometrie_typ: "LineString",
	items: [
		{ id: 701, change_type: "new", apply_state: "done", selected: 0 },
		{ id: 702, change_type: "changed", apply_state: null, anlass: "umbenennung",
			felder: ["name"], selected: 0 },
	],
};
tief(knopf(gemischtUebernommen, "ruecknahme_ablehnen").ids, [701],
	"zurückgenommen wird NUR das übernommene 'new'-Item");
tief(knopf(gemischtUebernommen, "ruecknahme_ablehnen").ablehnenIds, [701, 702],
	"🔴 abgelehnt werden BEIDE -- ein Objekt gilt erst als abgelehnt, wenn JEDES Item abgelehnt ist "
	+ "(garetien-liste.php); mit nur dem ersten bliebe es in „Offen\" stehen");
ruecknahmeGesendet = []; gefragt = [];
garetienRuecknahmeKlick({ target: ablehnenZiel(gemischtUebernommen.key) },
	[gemischtUebernommen], 7, sendenDrei, jaSagen);
tief(ruecknahmeGesendet[0][0], 701, "und der Verteiler reicht die zwei Mengen getrennt weiter");
tief(ruecknahmeGesendet[0][2], [701, 702], "-- die Ablehn-Menge ist die vollständige");

// 💣 DIE GEWÖHNLICHE RÜCKNAHME REICHT KEINE ABLEHN-MENGE -- sonst lehnte sie still mit ab.
ruecknahmeGesendet = []; gefragt = [];
garetienRuecknahmeKlick({ target: ruecknahmeZiel(wegUebernommen.key) }, objekteN, 7, sendenDrei, jaSagen);
gleich(ruecknahmeGesendet[0][2], null, "„Zurücknehmen\" lehnt NICHTS ab: " + JSON.stringify(ruecknahmeGesendet[0]));

// --- Die Rückfrage sagt, WOHIN das Objekt fällt -- und die zwei Knöpfe sagen Verschiedenes.
const frageZurueck = garetienRuecknahmeRueckfrageText(wegUebernommen, false);
const frageAblehnen = garetienRuecknahmeRueckfrageText(wegUebernommen, true);
wahr(frageZurueck.includes("zurück nach „Offen“"), "„Zurücknehmen\" führt nach Offen");
wahr(frageAblehnen.includes("„Abgelehnt“"), "„Ablehnen\" führt nach Abgelehnt: " + frageAblehnen);
wahr(!frageAblehnen.includes("zurück nach „Offen“"),
	"🩤 MISS DIE DIFFERENZ: der Ablehn-Text sagt NICHT auch noch „nach Offen\"");
// 🔴 UND ER NENNT DEN RÜCKWEG. Eine Ablehnung ohne Rückweg wäre ein schwarzes Loch (Entwurf §5)
// -- der Knopf „Wieder vorschlagen" steht im Reiter „Abgelehnt", aber wer den Text liest, weiß es
// noch nicht.
wahr(frageAblehnen.includes("Wieder vorschlagen"), "und nennt den Rückweg: " + frageAblehnen);
// ⚠️ Die Folge für die KARTE steht in beiden gleich -- sie ist dieselbe.
wahr(frageAblehnen.includes("aus unserer Karte entfernt") && frageZurueck.includes("aus unserer Karte entfernt"),
	"beide sagen, dass das Objekt von der Karte geht");

// --- Und beim 'quelle'-only-Objekt greift derselbe Unterschied auf dem ANDEREN Grundtext.
// 💣 Der Zielsatz steht deshalb in einer eigenen Funktion: in beide Texte hineingeschrieben
// liefe er beim nächsten Wortlaut auseinander.
gleich(garetienRuecknahmeZielSatz(false).includes("„Offen“"), true, "der Zielsatz für Zurücknehmen");
gleich(garetienRuecknahmeZielSatz(true).includes("„Abgelehnt“"), true, "und der für Ablehnen");
wahr(garetienRuecknahmeZielSatz(true) !== garetienRuecknahmeZielSatz(false),
	"die beiden Sätze sind verschieden -- sonst prüfen die Zeilen darüber eine Konstante");

// --- 💣 UND DIE ZWEI RÜCKNAHME-VERBEN GEHEN NIE ÜBER DIE GETEILTE TÜR HINAUS.
// Fänden sie in garetienHandlungsRumpf einen Rumpf, fiele der Klick bis zu garetienHandlungKlick
// durch und verschickte ein sinnloses `select` an sync-plan.php -- zwei Erzeuger für denselben
// Knopf. Bis zum 31.08.2026 hielt das allein die Reihenfolge der Verdrahtung.
gleich(garetienHandlungsRumpf("ruecknahme", wegUebernommen, 7), null,
	"„Zurücknehmen\" hat hier keinen Rumpf -- es hat seine eigene Tür");
gleich(garetienHandlungsRumpf("ruecknahme_ablehnen", wegUebernommen, 7), null,
	"und „Ablehnen\" ebenso");

console.log(`garetien-handlungen ok -- ${checks} Zusicherungen`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});

// =================================================================================================
// M. Aufgabe 8: „Neu einfügen" schreibt WIRKLICH -- garetienNeuKlick als eigener Verteiler
// =================================================================================================
//
// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-8-brief.md
//
// 🔴 EIN EIGENER VERTEILER, kein sechster Parameter an garetienHandlungKlick (Begruendung an
// seiner Definition). Er wird VOR garetienHandlungKlick gerufen (bindFenster) und meldet per
// Rueckgabewert (eine Promise, oder `null`), ob er den Klick uebernommen hat.

function neuZiel(key, options) {
	return kette([Object.assign({
		passt: ['[data-handlung="neu"]', "[data-handlung]", "[data-key]"],
		attribute: { "data-handlung": "neu", "data-key": key },
	}, options || {})]);
}

async function pruefeNeuKlick() {
	const objekteM = [zufluss]; // urteil "zweifel" -> traegt "neu" (Abschnitt A)

	// Ein fremdes Ziel (kein `data-handlung="neu"`) -- der Verteiler steigt aus, OHNE etwas zu tun.
	gleich(mod.garetienNeuKlick({ target: kette([{ passt: [], attribute: {} }]) }, objekteM, 7), null,
		"ein Klick neben den Knopf tut nichts");
	gleich(mod.garetienNeuKlick({ target: handlungsZiel("name", strasse.key) }, objekteM, 7), null,
		"und ein ANDERER Handlungsknopf (hier: „Namen ersetzen\") auch nicht -- nur „neu\" gehoert ihm");

	// Ein gesperrter Knopf tut nichts.
	gleich(mod.garetienNeuKlick({ target: neuZiel(zufluss.key, { disabled: true }) }, objekteM, 7), null,
		"ein disabled-Knopf loest nichts aus");

	// Ein Objekt ohne "neu"-Item -- garetienHandlungsRumpf liefert null, der Verteiler tut nichts.
	gleich(mod.garetienNeuKlick({ target: neuZiel(deckt.key) }, [deckt], 7), null,
		"ohne einen Vorschlag „neu einfügen\" gibt es nichts zu senden");

	// Der ECHTE Fall: select, DANN WIRKLICH apply, DANN die Bereinigung, DANN die Listenaktualisierung.
	const echtesFetch = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt.push({ pfad: String(pfad), rumpf: rumpf });
		let roh;
		if (rumpf.action === "apply") {
			roh = { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		} else if (rumpf.action === "liste" && rumpf.stand === "uebernommen") {
			roh = { ok: true, objekte: [] };
		} else {
			roh = { ok: true, plan_run_id: 7, gesamt: 0, objekte: [], bilanz: {}, reiter: {}, facetten: {} };
		}
		return Promise.resolve({ json: () => Promise.resolve(roh) });
	};

	const knopfM = neuZiel(zufluss.key);
	const erste = mod.garetienNeuKlick({ target: knopfM }, objekteM, 7);
	wahr(erste && typeof erste.then === "function",
		"der Klick liefert eine Promise zurueck -- er wird wirklich ausgefuehrt");
	gleich(knopfM.disabled, true, "der Knopf sperrt sich SOFORT, synchron");
	gleich(knopfM.textContent, "Fügt ein …", "und traegt seinen Stand in der eigenen Beschriftung");

	// 🔴 Ein zweiter Klick, WAEHREND der erste noch laeuft -- er darf KEINE zweite Sequenz starten.
	const zweite = mod.garetienNeuKlick({ target: neuZiel(zufluss.key) }, objekteM, 7);
	gleich(await zweite, null, "ein zweiter Klick waehrend des Laufens loest nichts aus");

	await erste;
	global.fetch = echtesFetch;

	tief(gestellt.map((a) => a.rumpf.action), ["select", "apply", "liste", "liste"],
		"🔴 select, dann WIRKLICH apply, dann die gezielte Nachlese, dann die Listenaktualisierung "
		+ "-- und NICHTS Zusaetzliches vom zweiten Klick");
	tief(gestellt[0].rumpf.ids, [1], "…mit genau der id des \"neu\"-Items");
	gleich(gestellt[0].rumpf.action, "select", "erst wird angehakt");
	gleich(gestellt[1].rumpf.action, "apply",
		"🔴 die tragende Zusicherung: „Neu einfügen\" schickt apply, nicht bloss ein zweites select");
}

// 🔴 Meldung B (30.08.2026, Owner): „trotzdem neu anlegen" trotz erkannter Kollision -- dieselbe
// Verdrahtung wie oben (garetienNeuKlick), aber mit einer Rückfrage DAVOR, weil das Ziel-Item
// diesmal `anlass:'zusatz'` trägt statt ein genuiner Neuzugang zu sein.
async function pruefeNeuKlickZusatz() {
	const kollision = {
		key: "k-kollision", urteil: "ergaenzung", name: "Krähensee", wiki: "ggp",
		grund: 'Geometrie liegt 0.42 Einheiten von "Krähensee" (anderer Name)',
		abschnitte: [{ public_id: "r-1", name: "Krähensee alt" }],
		items: [
			{ id: 900, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 1,
				abschnitt: { public_id: "r-1", name: "Krähensee alt" } },
			{ id: 901, anlass: "zusatz", felder: [], change_type: "new", selected: 0 },
		],
	};

	wahr(mod.garetienNeuIstZusatz(kollision) === true,
		"ein Zusatz-Item macht 'Neu einfügen' zur begründeten Ausnahme");
	wahr(mod.garetienNeuIstZusatz(einer) === false,
		"ohne Zusatz-Item ist es der normale Fall -- keine Rückfrage nötig");
	wahr(mod.garetienNeuIstZusatz(zufluss) === false,
		"ein GENUINER Neuzugang (kein Treffer) ist ebenfalls KEIN Zusatz-Item");

	gleich(knopf(kollision, "neu").disabled, false, "die Kollision bekommt trotzdem 'Neu einfügen'");
	tief(knopf(kollision, "neu").ids, [901], "und zwar genau das Zusatz-Item, nicht die Ergänzung");

	const zusatzFrage = mod.garetienZusatzRueckfrageText(kollision);
	wahr(zusatzFrage.includes("Krähensee"), "die Rückfrage nennt den Namen");
	wahr(zusatzFrage.includes("0.42 Einheiten"), "und den Grund aus dem Abgleich (Name+Abstand)");
	wahr(zusatzFrage.includes("ZUSÄTZLICH"), "und sagt ausdrücklich, dass ANGELEGT statt ersetzt wird");
	wahr(zusatzFrage.includes("Jetzt wird nur vorgemerkt"), "und dass jetzt noch nichts geschrieben wird");

	// 💣 OHNE BESTÄTIGUNG PASSIERT NICHTS -- und der Klick gilt trotzdem als BEHANDELT (return
	// true), sonst fiele er zu garetienHandlungKlick durch (dieselbe Falle wie bei
	// garetienRuecknahmeKlick, siehe deren Begründung).
	const gefragtNein = [];
	const neinM = (text) => { gefragtNein.push(text); return false; };
	const zielNein = neuZiel(kollision.key);
	gleich(mod.garetienNeuKlick({ target: zielNein }, [kollision], 7, neinM), true,
		"„Nein\" in der Rückfrage gilt als BEHANDELT -- kein Fallthrough zu garetienHandlungKlick");
	gleich(gefragtNein.length, 1, "gefragt wurde");
	gleich(zielNein.disabled, undefined, "und der Knopf wird NICHT gesperrt -- es lief ja nichts");

	// Ohne `fragen`-Funktion überhaupt (ein Verdrahtungsfehler): dieselbe sichere Richtung wie
	// garetienFragen selbst -- im Zweifel geschieht nichts.
	gleich(mod.garetienNeuKlick({ target: neuZiel(kollision.key) }, [kollision], 7), true,
		"ohne 'fragen'-Funktion wird ABGELEHNT, nicht durchgewunken");

	// „Ja": danach läuft DIESELBE echte Sequenz wie beim normalen Neuzugang (select, apply,
	// liste, liste) -- die Rückfrage ändert nichts an DEM, was am Ende geschrieben wird, nur OB.
	const echtesFetch = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt.push({ pfad: String(pfad), rumpf: rumpf });
		let roh;
		if (rumpf.action === "apply") {
			roh = { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		} else if (rumpf.action === "liste" && rumpf.stand === "uebernommen") {
			roh = { ok: true, objekte: [] };
		} else {
			roh = { ok: true, plan_run_id: 7, gesamt: 0, objekte: [], bilanz: {}, reiter: {}, facetten: {} };
		}
		return Promise.resolve({ json: () => Promise.resolve(roh) });
	};
	const gefragtJa = [];
	const jaM = (text) => { gefragtJa.push(text); return true; };
	const lauf = mod.garetienNeuKlick({ target: neuZiel(kollision.key) }, [kollision], 7, jaM);
	wahr(lauf && typeof lauf.then === "function",
		"bei „Ja\" liefert der Klick eine Promise zurück -- er wird wirklich ausgeführt");
	await lauf;
	global.fetch = echtesFetch;
	gleich(gefragtJa.length, 1, "genau EINMAL gefragt");
	tief(gestellt.map((a) => a.rumpf.action), ["select", "apply", "liste", "liste"],
		"nach der Bestätigung läuft dieselbe echte Sequenz wie beim normalen Neuzugang");
	tief(gestellt[0].rumpf.ids, [901], "…mit genau der id des Zusatz-Items, nicht der Ergänzung");
}

// =================================================================================================
// N. Aufgabe 9: „Zurücknehmen" -- ein übernommenes Objekt wieder von der Karte holen
// =================================================================================================
//
// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-9-brief.md
//
// 🔴 Owner-Entscheid 1: ein 'changed'-Objekt bekommt GAR KEINE Rücknahme -- kein Knopf, ein
// sichtbarer Grund an seiner Stelle. Nur ein 'new'-Item hat wirklich ein Objekt ANGELEGT.

const wegUebernommen = {
	key: "gi9:weg", name: "Gardel", urteil: "neu", stand: "uebernommen", geometrie_typ: "LineString",
	items: [{ id: 501, change_type: "new", apply_state: "done", selected: 0 }],
};
const flaecheUebernommen = {
	key: "gi9:see", name: "Mühlsee", urteil: "neu", stand: "uebernommen", geometrie_typ: "Polygon",
	items: [{ id: 502, change_type: "new", apply_state: "done", selected: 0 }],
};
const changedUebernommen = {
	key: "gi9:changed", name: "Alke", urteil: "ergaenzung", stand: "uebernommen", geometrie_typ: "LineString",
	items: [{ id: 503, change_type: "changed", apply_state: "done", anlass: "geometrie",
		felder: ["geometrie"], selected: 0 }],
};

// ---- N.1 Die Tafel: 'new' bekommt einen bedienbaren Knopf, 'changed' gar keinen ------------------
// 🔴 SEIT 31.08.2026 ZWEI (Owner: „neben … 'Zurücknehmen' … auch gleichzeitig die Option
// 'Ablehnen' anbieten, wo sie zurückgenommen und in die kategorie ablehnen gesteckt werden").
tief(namen(wegUebernommen), ["ruecknahme", "ruecknahme_ablehnen"],
	"ein übernommenes 'new'-Objekt hat ZWEI Handlungen: zurücknehmen und ablehnen");
gleich(knopf(wegUebernommen, "ruecknahme_ablehnen").disabled, false, "der Ablehnen-Knopf ist bedienbar");
gleich(knopf(wegUebernommen, "ruecknahme_ablehnen").beschriftung, "Ablehnen",
	"und trägt den Wortlaut des Owners");
// 💣 ZWEI MENGEN: zurückgenommen werden die RÜCKNEHMBAREN Items, abgelehnt ALLE. Ein Objekt
// gilt erst als „abgelehnt", wenn JEDES seiner Items abgelehnt ist (garetien-liste.php) -- mit nur
// den zurückgenommenen bliebe es in „Offen" stehen, und der Knopf hätte sichtbar die halbe Arbeit
// getan.
tief(knopf(wegUebernommen, "ruecknahme_ablehnen").ids, [501], "zurückgenommen wird das 'new'-Item");
tief(knopf(wegUebernommen, "ruecknahme_ablehnen").ablehnenIds,
	wegUebernommen.items.map(function (i) { return i.id; }),
	"abgelehnt werden ALLE Items des Objekts");
gleich(knopf(wegUebernommen, "ruecknahme").disabled, false, "und sie ist bedienbar");
tief(knopf(wegUebernommen, "ruecknahme").ids, [501], "mit der id GENAU dieses 'new'-Items");

// 🔴 UND „Ablehnen" KANN GENAU DANN, WENN „Zurücknehmen" KANN -- keine Bequemlichkeit,
// sondern die Sache selbst: abgelehnt werden kann nur, was vorher von der Karte kommt. Ein Objekt,
// das ein BESTEHENDES verändert hat, stünde sonst in „Abgelehnt", während seine Änderung weiter
// gilt.
// 💣 ES ERSCHEINT DANN GAR NICHT, statt ausgegraut dazustehen: Owner-Entscheid 1 zu
// „Zurücknehmen" lautet „kein Knopf, sondern ein sichtbarer Grund an seiner Stelle", und ein
// gesperrter Zwilling hätte diese Regel aufgehoben UND den Grund doppelt hingeschrieben.
tief(namen(changedUebernommen), ["ruecknahme"],
	"auch ein übernommenes 'changed'-Objekt zeigt die eine Handlung -- als GRUND, nicht als Knopf");
gleich(knopf(changedUebernommen, "ruecknahme").disabled, true,
	"🔴 OWNER-ENTSCHEID 1: ein 'changed'-Objekt bekommt GAR KEINE Rücknahme");
gleich(knopf(changedUebernommen, "ruecknahme").grund, "Verändert ein bestehendes Objekt — nicht rücknehmbar.",
	"und der Grund ist genau der aus dem Brief");
tief(knopf(changedUebernommen, "ruecknahme").ids, [], "und schickt deshalb auch keine id");

// Die Flaeche sieht auf der Tafel genauso aus wie der Weg -- der Unterschied liegt im Markup/Text.
gleich(knopf(flaecheUebernommen, "ruecknahme").disabled, false, "die Flaeche ist ebenso bedienbar");
tief(knopf(flaecheUebernommen, "ruecknahme").ids, [502], "mit ihrer eigenen id");

// ---- N.2 Das Markup: ein Knopf für 'new', GAR KEIN Knopf für 'changed' ---------------------------
const markupWeg = garetienHandlungsMarkup(wegUebernommen);
wahr(/data-handlung="ruecknahme"/.test(markupWeg), "der Weg bekommt einen echten Knopf");
wahr(/<button[^>]*btn--danger[^>]*data-handlung="ruecknahme"/.test(markupWeg),
	"„Zurücknehmen\" trägt --color-danger als Schrift, wie „Ablehnen\"");
wahr(/>Zurücknehmen</.test(markupWeg), "mit der Beschriftung aus dem Brief");

const markupChanged = garetienHandlungsMarkup(changedUebernommen);
wahr(!/<button/.test(markupChanged),
	"🔴 „Kein Knopf, sondern ein sichtbarer Grund an seiner Stelle\" -- hier steht wirklich KEIN <button>");
wahr(/gi-acts__grund/.test(markupChanged) && /nicht rücknehmbar/.test(markupChanged),
	"und der Grund steht trotzdem sichtbar da, nicht nur als Behauptung");

// ---- N.3 Die Rückfrage nennt die Folge beim Namen (Owner-Entscheid 2) ----------------------------
const frageWeg = garetienRuecknahmeRueckfrageText(wegUebernommen);
wahr(frageWeg.includes("Gardel"), "die Rückfrage nennt das Objekt beim Namen");
wahr(frageWeg.includes("zurück nach „Offen“"), "und dass es danach wieder offen ist");
wahr(frageWeg.includes("Änderungen, die seither"),
	"🔴 Owner-Entscheid 2: spätere Bearbeitungen gehen ausdrücklich mit -- die Rückfrage sagt es");
wahr(!frageWeg.includes("Landschaftsregion"), "ein Weg nennt keine Landschaftsregion");

const frageFlaeche = garetienRuecknahmeRueckfrageText(flaecheUebernommen);
wahr(frageFlaeche.includes("Beschriftung") && frageFlaeche.includes("Landschaftsregion")
	&& frageFlaeche.includes("Fläche"),
	"🪤 MISS DIE DIFFERENZ, NICHT NUR IRGENDEINEN TEXT: bei einer Fläche werden alle drei Zeilen "
	+ "namentlich genannt (Brief) -- Beschriftung, Region UND Fläche");
wahr(frageFlaeche.includes("Mühlsee"), "und beim Namen");

// ---- N.4 Der Klickverteiler -- gemessen am ERGEBNIS ----------------------------------------------
function ruecknahmeZiel(key, options) {
	return kette([Object.assign({
		passt: ['[data-handlung="ruecknahme"]', "[data-handlung]", "[data-key]"],
		attribute: { "data-handlung": "ruecknahme", "data-key": key },
	}, options || {})]);
}

const objekteN = [wegUebernommen, flaecheUebernommen, changedUebernommen];

// 💣 OHNE BESTÄTIGUNG PASSIERT NICHTS -- und der Klick gilt trotzdem als "übernommen" (er darf
// nicht weiter zu garetienHandlungKlick durchfallen, siehe die Begründung an der Definition).
gesendet = []; gefragt = [];
let ruecknahmeGesendet = [];
const ruecknahmeSenden = (itemId, runId) => { ruecknahmeGesendet.push([itemId, runId]); return "gesendet-r"; };
gleich(garetienRuecknahmeKlick({ target: ruecknahmeZiel(wegUebernommen.key) }, objekteN, 7,
	ruecknahmeSenden, neinSagen), true, "„Nein\" in der Rückfrage lässt den Klick als „übernommen\" gelten");
gleich(ruecknahmeGesendet.length, 0, "und schickt NICHTS -- ohne Bestätigung passiert nichts");
gleich(gefragt.length, 1, "gefragt wurde trotzdem");

ruecknahmeGesendet = []; gefragt = [];
const ergebnisJa = garetienRuecknahmeKlick({ target: ruecknahmeZiel(wegUebernommen.key) }, objekteN, 7,
	ruecknahmeSenden, jaSagen);
gleich(ergebnisJa, "gesendet-r", "„Ja\" ruft den Sender und reicht sein Ergebnis durch");
tief(ruecknahmeGesendet, [[501, 7]], "mit der id des Items UND der Lauf-Nummer");
wahr(gefragt[0].includes("Gardel"), "gefragt wurde mit der echten Rückfrage, nicht mit „Sind Sie sicher?\"");

// Ein 'changed'-Objekt hat gar kein 'new'-Item -- der Verteiler findet keins und tut nichts.
ruecknahmeGesendet = []; gefragt = [];
gleich(garetienRuecknahmeKlick({ target: ruecknahmeZiel(changedUebernommen.key) }, objekteN, 7,
	ruecknahmeSenden, jaSagen), null, "ohne ein 'new'-Item gibt es nichts zurückzunehmen");
gleich(ruecknahmeGesendet.length, 0, "wirklich nichts gesendet");
gleich(gefragt.length, 0, "und auch nicht gefragt -- der Verteiler bricht vorher ab");

// Ein gesperrter Knopf (DOM-Attribut) tut nichts -- dieselbe Trennung wie bei allen anderen Knöpfen.
ruecknahmeGesendet = [];
gleich(garetienRuecknahmeKlick(
	{ target: ruecknahmeZiel(wegUebernommen.key, { disabled: true }) }, objekteN, 7, ruecknahmeSenden, jaSagen
), null, "ein disabled-Knopf löst nichts aus");
gleich(ruecknahmeGesendet.length, 0, "nichts gesendet");

// Ein Klick auf einen ANDEREN Handlungsknopf gehört diesem Verteiler nicht.
gleich(garetienRuecknahmeKlick({ target: handlungsZiel("ablehnen", deckt.key) }, objekte, 7,
	ruecknahmeSenden, jaSagen), null, "ein anderer Knopf (hier: „Ablehnen\") ist nicht seine Sache");
// Und ein Klick daneben ebenfalls nicht.
gleich(garetienRuecknahmeKlick({ target: kette([{ passt: [], attribute: {} }]) }, objekteN, 7,
	ruecknahmeSenden, jaSagen), null, "ein Klick neben die Knopfleiste tut nichts");
gleich(garetienRuecknahmeKlick({}, objekteN, 7, ruecknahmeSenden, jaSagen), null,
	"ein Ereignis ohne Ziel ebenso");

// ---- N.5 Der Sender geht über die EIGENE Tür (GARETIEN_ENDPUNKT), NIE über sync-plan.php ---------
//
// 🔴 Dieselbe Begründung wie am Sender selbst: die Rücknahme darf nach dem Abbau dieses Fensters
// keine Waise in der geteilten Übernahme-Tür hinterlassen (Auftrag §5.5).
//
// 🔴 ANGEHÄNGT AN DIE VORHANDENE KETTE (siehe deren Ende), NICHT als eigenständige IIFE: beide
// manipulieren `global.fetch`, und ein zweiter, unabhängig gestarteter Umtausch liefe der noch
// offenen Kette mit dem falschen "echt"-Wert ins Gehege.
async function pruefeRuecknahmeSenden() {
	const echtesFetch = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt.push({ pfad: String(pfad), rumpf: rumpf });
		if (rumpf.action === "ruecknahme") {
			return Promise.resolve({ json: () => Promise.resolve({ ok: true, zurueckgenommen: 1, fehler: [] }) });
		}
		return Promise.resolve({
			json: () => Promise.resolve({ ok: true, plan_run_id: 7, gesamt: 0, objekte: [], bilanz: {}, reiter: {}, facetten: {} }),
		});
	};
	await mod.garetienRuecknahmeSenden(501, 7);
	global.fetch = echtesFetch;

	gleich(gestellt.length, 2, "der Sender ruft ruecknahme, DANN holt er die Liste neu");
	gleich(gestellt[0].pfad, "/api/edit/map/garetien-import.php",
		"🔴 NICHT sync-plan.php -- die eigene Tür dieses Fensters");
	gleich(gestellt[0].rumpf.action, "ruecknahme", "mit der Aktion 'ruecknahme'");
	tief(gestellt[0].rumpf.ids, [501], "und der id des Items");
	gleich(gestellt[0].rumpf.run_id, 7, "und der Lauf-Nummer");
	gleich(gestellt[1].rumpf.action, "liste", "danach wird die Liste neu geholt, wie bei jeder Handlung");
}
