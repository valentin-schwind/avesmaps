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
	garetienRuecknahmeRueckfrageText, garetienRuecknahmeKlick,
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

// „Ergaenzung": wir haben es, sie wissen mehr -- mit dem vierten Ausgang.
// 🔴 Meldung B (30.08.2026, Owner): „neu" steht seither MIT dabei -- „trotzdem neu anlegen" ist
// die begruendete Ausnahme und steht deshalb VOR „ablehnen", aber NACH den drei uebrigen.
tief(namen({ urteil: "ergaenzung", abschnitte: [{ public_id: "w-1", name: "x" }], items: [] }),
	["name", "quelle", "geometrie", "neu", "ablehnen"],
	"bei der Ergaenzung steht „Namen ersetzen\" vorn, „Nur Quelle + Artikel\" daneben, „neu\" "
	+ "als begruendete Ausnahme vor „ablehnen\"");

// „widerspricht": ihr Artikel trifft, ihre Geometrie nicht -- die GEOMETRIEFRAGE steht vorn.
tief(namen({ urteil: "widerspruch", abschnitte: [{ public_id: "w-1", name: "x" }], items: [] }),
	["geometrie", "name", "ablehnen"],
	"beim Widerspruch steht die Geometriefrage VORN -- die Reihenfolge ist die Aussage");

// „deckt sich" kann nur abgelehnt werden -- die Zeile steht da, damit die Zahl nachpruefbar bleibt.
tief(namen({ urteil: "deckt_sich", abschnitte: [], items: [] }), ["ablehnen"],
	"„deckt sich\" hat genau einen Ausgang");
tief(namen({ urteil: "uebersprungen", abschnitte: [], items: [] }), ["ablehnen"],
	"„uebersprungen\" ebenso");

// 🔴 Die zurueckhaltende Richtung: fuer ein Urteil, das dieser Code nicht kennt, wird KEINE
// schreibende Handlung angeboten. Eine Tafel, die im Zweifel „Neu einfuegen" zeigte, boete an,
// etwas anzulegen, worueber sie nichts weiss.
tief(namen({ urteil: "brandneue_kategorie", abschnitte: [], items: [] }), ["ablehnen"],
	"ein unbekanntes Urteil bekommt nur den Ausgang, nie eine schreibende Handlung");
tief(namen({ abschnitte: [], items: [] }), ["ablehnen"], "und ein fehlendes Urteil auch");

// =================================================================================================
// B. Der ausgegraute Knopf sagt, WARUM
// =================================================================================================

// 🔴 Meldung A (30.08.2026, Owner): „Geometrie ersetzen" (jetzt „Ausgewählte Segmente ersetzen")
// ist NICHT MEHR bei mehreren getroffenen Abschnitten pauschal ausgegraut -- garetien-plan.php
// legt seit dieser Meldung ein Geometrie-Item JE LEGITIMEM Abschnitt an, und die Handlung wirkt
// auf GENAU die ANGEHAKTEN. Ohne ein angehaktes Häkchen hat sie trotzdem kein Ziel.
const fuenf = {
	key: "k", urteil: "ergaenzung",
	abschnitte: [1, 2, 3, 4, 5].map((n) => ({ public_id: "w-" + n, name: "x" })), items: [],
};
const geo = knopf(fuenf, "geometrie");
wahr(geo && geo.disabled === true, "fuenf Abschnitte, aber KEINER angehakt -- kein Ziel");
wahr(/kein Abschnitt ist angehakt/.test(geo.grund), "ein ausgegrauter Knopf muss sagen, warum");
wahr(!/5 Abschnitte/.test(geo.grund),
	"💣 die alte Begruendung (Anzahl statt Auswahl) darf nicht wiederkehren");

// Die Gegenprobe: bei GENAU EINEM angehakten Abschnitt mit Geometrie-Item ist er bedienbar. Ohne
// sie belegte die Zeile darueber nur, dass irgendetwas ausgegraut ist.
//
// 🔴 Meldung A: JEDES Item traegt jetzt `abschnitt` (wie es garetien-liste.php live tut,
// `item.after.abschnitt`) -- garetienAngehakteAbschnittIds braucht es, um ein Geometrie-Item
// seinem Abschnitt zuzuordnen.
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
gleich(knopf(einer, "geometrie").disabled, false,
	"EIN angehakter Abschnitt mit Geometrie-Vorschlag -- der Knopf ist bedienbar");
gleich(knopf(einer, "geometrie").grund, "", "und dann steht kein Grund da");

// Ein Abschnitt ist angehakt, aber KEIN Geometrie-Item liegt vor (ein Lauf von vor dem Nachzug):
// ausgegraut, mit einem ANDEREN Grund -- „kein Abschnitt ist angehakt" waere hier eine Luege.
const ohneGeoItem = Object.assign({}, einer, { items: [einer.items[0]] });
gleich(knopf(ohneGeoItem, "geometrie").disabled, true, "ohne Geometrie-Vorschlag ist er aus");
wahr(/Geometrie-Vorschlag/.test(knopf(ohneGeoItem, "geometrie").grund),
	"und der Grund nennt den fehlenden Vorschlag, nicht die Abschnittsauswahl");
wahr(!/kein Abschnitt ist angehakt/.test(knopf(ohneGeoItem, "geometrie").grund),
	"die zwei Gruende duerfen nicht ineinander rutschen -- hier IST ja etwas angehakt");

// =================================================================================================
// B2. Die DIFFERENZ: kein Haekchen -> gesperrt · N Haekchen -> wirkt auf GENAU diese N
// =================================================================================================
//
// 🔴 Das ist der Kern von Meldung A: der Owner widerspricht der alten Regel ausdruecklich -- „die
// angehakten Haekchen SIND das Ziel". Fuenf Abschnitte, von denen ZWEI angehakt sind (ihr
// Quellen-Item ist voll selektiert) -- der Knopf muss GENAU deren zwei Geometrie-Items nennen,
// nicht alle fuenf und nicht null.
function garetienTestAbschnitt(nummer, quelleAngehakt) {
	const publicId = "w-mehr-" + nummer;
	const basis = { public_id: publicId, name: "x" };
	return {
		abschnitt: basis,
		items: [
			{ id: 8000 + nummer, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed",
				selected: quelleAngehakt ? 1 : 0, abschnitt: basis },
			{ id: 9000 + nummer, anlass: "geometrie", felder: ["geometrie"], change_type: "changed",
				selected: 0, abschnitt: basis },
		],
	};
}
const fuenfTeileKeinsAngehakt = [1, 2, 3, 4, 5].map((n) => garetienTestAbschnitt(n, false));
const fuenfObjektBasis = {
	key: "k-mehr", urteil: "ergaenzung", wiki: "ggp",
	abschnitte: fuenfTeileKeinsAngehakt.map((t) => t.abschnitt),
};
function garetienTestObjektMit(teile) {
	return Object.assign({}, fuenfObjektBasis, {
		items: teile.map((t) => t.items).reduce((a, b) => a.concat(b), []),
	});
}

const keinsAngehakt = garetienTestObjektMit(fuenfTeileKeinsAngehakt);
gleich(knopf(keinsAngehakt, "geometrie").disabled, true,
	"fuenf Abschnitte, echte Geometrie-Items -- aber KEINER angehakt: immer noch kein Ziel");
tief(knopf(keinsAngehakt, "geometrie").ids, [], "und wirklich KEIN Item wird angeboten");

const zweiAngehakt = garetienTestObjektMit(
	fuenfTeileKeinsAngehakt.map((t, i) => (i === 0 || i === 1
		? garetienTestAbschnitt(i + 1, true)
		: t))
);
const geoZwei = knopf(zweiAngehakt, "geometrie");
gleich(geoZwei.disabled, false, "ZWEI angehakte Abschnitte -- die Handlung hat ein Ziel");
gleich(geoZwei.grund, "", "und dann steht kein Grund da");
tief(geoZwei.ids.slice().sort(function (a, b) { return a - b; }), [9001, 9002],
	"und sie wirkt auf GENAU die zwei angehakten Abschnitte -- nicht auf alle fuenf getroffenen");
gleich(geoZwei.beschriftung, "Ausgewählte Segmente ersetzen (0) …",
	"„(0)\": keines der zwei Ziel-Items ist SELBST schon vorgemerkt -- die Zahl zaehlt Vormerkungen, "
	+ "nicht Ziel-Abschnitte");

// Ein DRITTER Abschnitt kommt dazu -- die Menge waechst mit, es ist keine feste Zweierregel.
const dreiAngehakt = garetienTestObjektMit(
	fuenfTeileKeinsAngehakt.map((t, i) => (i === 0 || i === 1 || i === 2
		? garetienTestAbschnitt(i + 1, true)
		: t))
);
tief(knopf(dreiAngehakt, "geometrie").ids.slice().sort(function (a, b) { return a - b; }),
	[9001, 9002, 9003],
	"DREI angehakte Abschnitte -> die Handlung wirkt auf genau drei Geometrie-Items");

// Und die Gegenprobe zur Rumpf-Seite: der Rumpf schickt GENAU diese Ziel-Ids hinaus.
tief(garetienHandlungsRumpf("geometrie", zweiAngehakt, 7).ids.slice().sort(function (a, b) { return a - b; }),
	[9001, 9002], "der Rumpf traegt dieselbe Menge wie der Knopf, kein Nachbau daneben");

// Und OHNE getroffenen Abschnitt wieder ein dritter Grund.
wahr(/keinen Abschnitt von uns getroffen/.test(
	garetienHandlungen({ urteil: "widerspruch", abschnitte: [], items: [] })
		.filter((k) => k.name === "geometrie")[0].grund),
	"ohne Treffer gibt es keine Geometrie zu ersetzen -- und der Grund sagt genau das");

// Jeder ausgegraute Knopf traegt einen Grund -- ausnahmslos.
[fuenf, ohneGeoItem, { urteil: "deckt_sich", abschnitte: [], items: [] },
	{ urteil: "neu", abschnitte: [], items: [] }].forEach((objekt) => {
	garetienHandlungen(objekt).forEach((k) => {
		wahr(!k.disabled || k.grund.length > 10,
			`der Knopf „${k.name}" ist aus und sagt nicht warum`);
	});
});
// Gegenprobe zur Schleife darueber: sie darf nicht deshalb gruen sein, weil sie NICHTS Ausgegrautes
// gesehen hat. 🪤 Genau diese Form -- eine Schleife, deren Fixture den Zweig nie erreicht -- hat
// dieses Vorhaben schon bezahlt.
// Aufgeschluesselt, damit die Zahl nachrechenbar bleibt statt abgeschrieben zu werden:
// 🔴 Meldung B (30.08.2026): "ergaenzung" traegt seither auch "neu" -- ohne ein 'new'-Item ist
// das ein FUENFTER/DRITTER ausgegrauter Knopf bei fuenf/ohneGeoItem.
// fuenf 5 (name/quelle/geometrie/neu/ablehnen, alle ohne Item bzw. ohne Ziel) · ohneGeoItem 3
// (quelle/geometrie/neu) · deckt_sich 1 (ablehnen) · neu-ohne-Item 2 (neu/ablehnen) = 11.
tief([fuenf, ohneGeoItem, { urteil: "deckt_sich", abschnitte: [], items: [] },
	{ urteil: "neu", abschnitte: [], items: [] }]
	.map((o) => garetienHandlungen(o).filter((k) => k.disabled).length), [5, 3, 1, 2],
	"die Schleife hat bei JEDEM der vier Objekte ausgegraute Knoepfe gesehen");

// =================================================================================================
// C. „Nur Quelle + Artikel" -- unterschieden an der NAMENSSPALTE, nicht am Anlass
// =================================================================================================
//
// 🔴 „Es ist dieselbe Handlung wie ‚Namen ersetzen', nur mit abgewaehlter Namensspalte" (Brief).
// Ein Luecken-Item traegt bei uns `felder: ['name','quelle']` und den Anlass 'ergaenzung' -- am
// ANLASS gemessen landete es unter „Nur Quelle", und der Knopf schriebe den Namen mit, den sein
// eigener Name ausschliesst. Genau die Falle, die dieses Werkzeug ueberall sonst vermeidet.

// Die Alke (Mockup §6a): EIN namenloser Abschnitt, Luecken-Item mit name+quelle, vorangehakt.
gleich(knopf(einer, "name").beschriftung, "Namen ersetzen (1)",
	"das Luecken-Item schreibt einen Namen -- Mockup §6a zeigt „Namen ersetzen (1) ✓\"");
gleich(knopf(einer, "name").erledigt, true, "und es ist angehakt, also erledigt");
gleich(knopf(einer, "quelle").beschriftung, "Nur Quelle + Artikel (0)",
	"an der Alke gaebe es keinen Gewinn OHNE den Namen");
gleich(knopf(einer, "quelle").disabled, true, "also ist der vierte Ausgang dort aus");

// Die Angbarer Reichsstrasse (Mockup §6d): sechs benannte Abschnitte, je ein Umbenennungs-Item
// (ungehakt) und ein reines Quellen-Item (vorangehakt).
const strasse = {
	key: "ggp:Wege:Reichsstrasse:Angbarer", urteil: "ergaenzung", wiki: "ggp",
	abschnitte: [1, 2, 3, 4, 5, 6].map((n) => ({ public_id: "w-221" + n, name: "Reichsstraße 3" })),
	items: [1, 2, 3, 4, 5, 6].map((n) => ([
		{ id: 100 + n, anlass: "umbenennung", felder: ["name"], change_type: "changed", selected: 0,
			abschnitt: { public_id: "w-221" + n, name: "Reichsstraße 3" } },
		{ id: 200 + n, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 1,
			abschnitt: { public_id: "w-221" + n, name: "Reichsstraße 3" } },
	])).reduce((a, b) => a.concat(b), []),
};
gleich(knopf(strasse, "name").beschriftung, "Namen ersetzen (0)",
	"Mockup §6d: sechs Umbenennungen, keine angehakt -- „(0)\"");
gleich(knopf(strasse, "name").gesamt, 6, "sie sind trotzdem alle sechs da");
gleich(knopf(strasse, "name").disabled, false, "und der Knopf ist bedienbar");
gleich(knopf(strasse, "quelle").beschriftung, "Nur Quelle + Artikel (6)",
	"Mockup §6d: sechs reine Quellen-Items, alle vorangehakt -- „(6) ✓\"");
gleich(knopf(strasse, "quelle").erledigt, true, "und damit erledigt");
// 💣 Die Mengen duerfen sich NICHT ueberschneiden: sonst schriebe „Nur Quelle" den Namen mit.
tief(knopf(strasse, "name").ids.filter((id) => knopf(strasse, "quelle").ids.includes(id)), [],
	"kein Item gehoert beiden Knoepfen -- „nur Quelle\" heisst OHNE den Namen");

// 🔴 „(n)" ist die Zahl der ANGEHAKTEN, nicht der moeglichen: sonst stuende an der Reichsstrasse
// „Namen ersetzen (6)", obwohl keine einzige Umbenennung vorgemerkt ist.
const strasseEineGehakt = Object.assign({}, strasse, {
	items: strasse.items.map((i) => (i.id === 101 ? Object.assign({}, i, { selected: 1 }) : i)),
});
gleich(knopf(strasseEineGehakt, "name").beschriftung, "Namen ersetzen (1)",
	"eine angehakte Umbenennung macht aus „(0)\" ein „(1)\"");
gleich(knopf(strasseEineGehakt, "name").erledigt, false,
	"aber erst wenn ALLE angehakt sind, ist der Knopf erledigt");

// =================================================================================================
// D. Der Rumpf, der hinausgeht -- und was NICHT hinausgeht
// =================================================================================================

tief(garetienHandlungsRumpf("neu", zufluss, 7),
	{ action: "select", kind: "garetien", run_id: 7, ids: [1], selected: true },
	"„Neu einfuegen\" hakt das new-Item an -- ueber `select`, nicht ueber einen eigenen Weg");
tief(garetienHandlungsRumpf("name", strasse, 7).ids, [101, 102, 103, 104, 105, 106],
	"„Namen ersetzen\" hakt genau die sechs Umbenennungen an");
tief(garetienHandlungsRumpf("quelle", strasse, 7).ids, [201, 202, 203, 204, 205, 206],
	"„Nur Quelle + Artikel\" genau die sechs Quellen-Items");
gleich(garetienHandlungsRumpf("name", strasse, 7).selected, true, "sie HAKEN AN");

// 💣 Ein ausgegrauter Knopf schickt NICHTS. Der Riegel steht in der Rechnung, nicht am `disabled`
// des Markups -- `disabled` ist die Anzeige.
gleich(garetienHandlungsRumpf("geometrie", fuenf, 7), null,
	"„Ausgewählte Segmente ersetzen\" ohne angehakten Abschnitt schickt gar nichts");
gleich(garetienHandlungsRumpf("quelle", einer, 7), null, "und ein leerer vierter Ausgang auch nicht");
// 🔴 Und ein Knopf, den dieses Urteil GAR NICHT anbietet, ist ebenfalls kein Schreibweg.
gleich(garetienHandlungsRumpf("geometrie", zufluss, 7), null,
	"💣 was die Tafel nicht anbietet, laesst sich auch nicht ueber den Rumpf erzwingen");
gleich(garetienHandlungsRumpf("name", zufluss, 7), null,
	"beim Zufluss gibt es nichts umzubenennen -- unser Nachbar ist der Hauptfluss");

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

// 🔴 NUR DIE GEOMETRIE SCHALTET UM -- sie ist die einzige Handlung ohne eigenes Haekchen.
gleich(garetienHandlungsRumpf("geometrie", einer, 7).selected, true,
	"ungehakt -> anhaken");
const geoGehakt = Object.assign({}, einer, {
	items: einer.items.map((i) => (i.id === 22 ? Object.assign({}, i, { selected: 1 }) : i)),
});
gleich(garetienHandlungsRumpf("geometrie", geoGehakt, 7).selected, false,
	"schon angehakt -> der zweite Druck nimmt die Vormerkung zurueck (Mockup §8: „rueckgaengig: ja\")");
// Die Gegenprobe: „Namen ersetzen" schaltet NICHT um -- dort nimmt das Abschnittshaekchen zurueck.
gleich(garetienHandlungsRumpf("name", einer, 7).selected, true,
	"ein erledigtes „Namen ersetzen\" hakt weiterhin AN, es schaltet nicht um");

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
// F. Die Rueckfrage nennt die Folge beim Namen
// =================================================================================================

const frage = garetienGeometrieRueckfrageText(einer);
wahr(frage.includes("w-5112"), "die Rueckfrage nennt, WAS ersetzt wuerde");
wahr(frage.includes("garetien.de"), "und WOHER der neue Verlauf kommt");
wahr(/3 Stützpunkte/.test(frage), "und wie gross ihre Fassung ist");
wahr(frage.includes("Jetzt wird nur vorgemerkt"),
	"💣 und dass jetzt noch nichts geschrieben wird -- „Sind Sie sicher?\" sagt gar nichts");
wahr(garetienGeometrieRueckfrageText(Object.assign({}, einer, { wiki: "kosch" }))
	.includes("koschwiki.de"),
	"der Wirt kommt aus garetienWikiLabel, nicht aus einer zweiten Tafel");
wahr(garetienGeometrieRueckfrageText(einer).includes("ohne Namen"),
	"ein namenloser Abschnitt wird auch in der Rueckfrage so genannt");

// 🔴 Meldung A (30.08.2026, Owner): SEIT MEHRERE ABSCHNITTE ZUGLEICH ANGEHAKT SEIN KOENNEN, NENNT
// DIE RUECKFRAGE DEREN ZAHL -- "abschnitte[0]" war das ganze Bild nur, solange hoechstens einer
// angehakt sein konnte. ⚠️ Sie muss auch sagen, dass ALLE denselben Verlauf bekommen -- sonst
// liest sich die Rueckfrage wie eine Aufteilung, die es nicht gibt.
const frageZwei = garetienGeometrieRueckfrageText(zweiAngehakt);
wahr(/2 Abschnitte/.test(frageZwei), "die Rueckfrage nennt die ZAHL der betroffenen Abschnitte");
wahr(frageZwei.includes("w-mehr-1") && frageZwei.includes("w-mehr-2"),
	"und nennt BEIDE angehakten Abschnitte beim Namen");
wahr(!frageZwei.includes("w-mehr-3"),
	"der dritte, NICHT angehakte Abschnitt wird nicht genannt");
wahr(frageZwei.includes("Jetzt wird nur vorgemerkt"),
	"dieselbe Zusicherung gilt auch bei mehreren angehakten Abschnitten");

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
	kandidaten[0].closest = function (auswahl) {
		for (const k of kandidaten) {
			if ((k.passt || []).indexOf(auswahl) !== -1) { return k; }
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
gleich(garetienHandlungKlick({ target: handlungsZiel("name", strasse.key) }, objekte, 7, senden, jaSagen),
	"gesendet", "ein Klick auf „Namen ersetzen\" schickt");
gleich(gesendet.length, 1, "und zwar genau einmal");
tief(gesendet[0].ids, [101, 102, 103, 104, 105, 106], "mit den Items dieses Knopfes");
gleich(gefragt.length, 0, "„Namen ersetzen\" fragt NICHT nach -- es ersetzt keine Geometrie");

// 💣 Die Rueckfrage kommt VOR dem Senden. Sagt der Editor Nein, geht NICHTS hinaus.
gesendet = []; gefragt = [];
gleich(garetienHandlungKlick({ target: handlungsZiel("geometrie", einer.key) }, objekte, 7, senden, neinSagen),
	null, "„Nein\" in der Rueckfrage bricht ab");
gleich(gesendet.length, 0, "und dann geht NICHTS hinaus");
gleich(gefragt.length, 1, "gefragt wurde trotzdem");

gesendet = []; gefragt = [];
garetienHandlungKlick({ target: handlungsZiel("geometrie", einer.key) }, objekte, 7, senden, jaSagen);
gleich(gesendet.length, 1, "„Ja\" schickt");
gleich(gesendet[0].selected, true, "und hakt an");

// 💣 Das ZURUECKNEHMEN fragt nicht -- die sichere Richtung fragt niemanden.
gesendet = []; gefragt = [];
garetienHandlungKlick({ target: handlungsZiel("geometrie", geoGehakt.key) }, [geoGehakt], 7, senden, neinSagen);
gleich(gesendet.length, 1, "eine Vormerkung zurueckzunehmen geht auch gegen ein „Nein\" durch");
gleich(gesendet[0].selected, false, "und nimmt zurueck");
gleich(gefragt.length, 0, "gefragt wurde dabei gar nicht");

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
wahr(/data-handlung="name"/.test(leiste) && /data-key="ggp:Wege:Reichsstrasse:Angbarer"/.test(leiste),
	"jeder Knopf traegt seine Handlung UND seinen Schluessel selbst -- kein Modulzustand daneben");
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
gleich(knopf(allesGehakt, "geometrie").erledigt, true,
	"die Gegenprobe: derselbe Zustand macht „Geometrie ersetzen\" sehr wohl erledigt");
gleich(knopf(abgelehnt, "wieder").erledigt, false, "und „Wieder vorschlagen\" ebenso wenig");
wahr(!/btn--done[^>]*data-handlung="ablehnen"|data-handlung="ablehnen"[^>]*btn--done/
	.test(garetienHandlungsMarkup(allesGehakt)),
	"und auch im Markup traegt „Ablehnen\" die Klasse nicht");
wahr(/Nur Quelle \+ Artikel \(6\) ✓</.test(leiste), "und sein ✓ steht IM Knopf");
wahr(!/data-handlung="name"[^>]*btn--done/.test(leiste) && !/Namen ersetzen \(0\) ✓/.test(leiste),
	"ein nicht erledigter Knopf traegt weder die Klasse noch das Haken-Zeichen");

const leisteAus = garetienHandlungsMarkup(fuenf);
wahr(/disabled title="[^"]*kein Abschnitt ist angehakt/.test(leisteAus),
	"ein ausgegrauter Knopf traegt seinen Grund im title");
wahr(/gi-acts__grund/.test(leisteAus)
	&& />Ausgewählte Segmente ersetzen \(0\): [^<]*kein Abschnitt ist angehakt/.test(leisteAus),
	"💣 und SICHTBAR daneben -- ein title erscheint nur beim Verweilen, am Telefon nie");
// Die DIFFERENZ: der Zufluss hat NUR bedienbare Knoepfe (neu + ablehnen), und dann steht auch
// keine Grundzeile da. ⚠️ Die Reichsstrasse taugt dafuer NICHT -- keiner ihrer sechs Abschnitte
// ist VOLLSTAENDIG angehakt (die Umbenennung steht ungehakt neben der vorangehakten Quelle), ihr
// „Ausgewählte Segmente ersetzen" ist also sehr wohl ausgegraut.
// ⚠️ Der sichtbare Grund traegt die Auslassungspunkte des Knopfes NICHT mit -- „Ausgewählte
// Segmente ersetzen (0) …: kein Abschnitt ist angehakt …" liest sich wie ein abgebrochener Satz.
wahr(/>Ausgewählte Segmente ersetzen \(0\): /.test(leisteAus),
	"der sichtbare Grund nennt den Knopf ohne seine Auslassungspunkte");
wahr(/Ausgewählte Segmente ersetzen \(0\) …</.test(leisteAus),
	"die Gegenprobe: auf dem KNOPF stehen sie weiterhin -- sie kuendigen die Rueckfrage an");

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
tief(namen(wegUebernommen), ["ruecknahme"], "ein übernommenes 'new'-Objekt hat GENAU eine Handlung");
gleich(knopf(wegUebernommen, "ruecknahme").disabled, false, "und sie ist bedienbar");
tief(knopf(wegUebernommen, "ruecknahme").ids, [501], "mit der id GENAU dieses 'new'-Items");

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
