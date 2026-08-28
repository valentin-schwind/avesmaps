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
tief(namen({ urteil: "ergaenzung", abschnitte: [{ public_id: "w-1", name: "x" }], items: [] }),
	["name", "quelle", "geometrie", "ablehnen"],
	"bei der Ergaenzung steht „Namen ersetzen\" vorn, und „Nur Quelle + Artikel\" daneben");

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

// „Geometrie ersetzen" ist bei mehreren Abschnitten AUSGEGRAUT: garetien-plan.php legt das
// Geometrie-Item nur bei GENAU EINEM getroffenen Abschnitt an, weil „ersetzen" sonst kein
// wohldefiniertes Ziel hat.
const fuenf = {
	key: "k", urteil: "ergaenzung",
	abschnitte: [1, 2, 3, 4, 5].map((n) => ({ public_id: "w-" + n, name: "x" })), items: [],
};
const geo = knopf(fuenf, "geometrie");
wahr(geo && geo.disabled === true, "bei fuenf Abschnitten hat „ersetze die Geometrie\" kein Ziel");
wahr(/5 Abschnitte/.test(geo.grund), "ein ausgegrauter Knopf muss sagen, warum");

// Die Gegenprobe: bei GENAU EINEM Abschnitt mit Geometrie-Item ist er bedienbar. Ohne sie belegte
// die Zeile darueber nur, dass irgendetwas ausgegraut ist.
const einer = {
	key: "k", urteil: "ergaenzung", wiki: "ggp",
	abschnitte: [{ public_id: "w-5112", name: "", punkte: 12 }],
	geometrie: [[1, 2], [3, 4], [5, 6]],
	items: [
		{ id: 21, anlass: "ergaenzung", felder: ["name", "quelle"], change_type: "changed", selected: 1 },
		{ id: 22, anlass: "geometrie", felder: ["geometrie"], change_type: "changed", selected: 0 },
	],
};
gleich(knopf(einer, "geometrie").disabled, false,
	"EIN getroffener Abschnitt mit Geometrie-Vorschlag -- der Knopf ist bedienbar");
gleich(knopf(einer, "geometrie").grund, "", "und dann steht kein Grund da");

// Ein Abschnitt, aber KEIN Geometrie-Item (ein Lauf von vor dem Nachzug): ausgegraut, mit einem
// ANDEREN Grund -- „ihr Objekt trifft 1 Abschnitt" waere hier eine Luege.
const ohneGeoItem = Object.assign({}, einer, { items: [einer.items[0]] });
gleich(knopf(ohneGeoItem, "geometrie").disabled, true, "ohne Geometrie-Vorschlag ist er aus");
wahr(/Geometrie-Vorschlag/.test(knopf(ohneGeoItem, "geometrie").grund),
	"und der Grund nennt den fehlenden Vorschlag, nicht die Abschnittszahl");
wahr(!/trifft 1 Abschnitt/.test(knopf(ohneGeoItem, "geometrie").grund),
	"die zwei Gruende duerfen nicht ineinander rutschen");

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
// fuenf 4 (name/quelle/geometrie/ablehnen, alle ohne Item bzw. ohne Ziel) · ohneGeoItem 2
// (quelle/geometrie) · deckt_sich 1 (ablehnen) · neu-ohne-Item 2 (neu/ablehnen) = 9.
tief([fuenf, ohneGeoItem, { urteil: "deckt_sich", abschnitte: [], items: [] },
	{ urteil: "neu", abschnitte: [], items: [] }]
	.map((o) => garetienHandlungen(o).filter((k) => k.disabled).length), [4, 2, 1, 2],
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
	"„Geometrie ersetzen\" bei fuenf Abschnitten schickt gar nichts");
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

// 🔴 Die ANZEIGE der Zeile muss dieselbe Menge meinen wie ihr Klick. Ein Haekchen, dessen Zustand
// und dessen Wirkung verschiedene Mengen meinen, ist die teuerste Art von Bedienelement: an der
// Alke koennte es sonst NIE voll werden (1 von 2) -- und ein Klick auf die Zeile merkte lautlos
// einen Geometrie-Ersatz vor.
wahr(/<input type="checkbox" checked>/.test(mod.garetienZeileMarkup(einer)),
	"die Zeile der Alke steht VOLL angehakt da, obwohl ihr Geometrie-Item ungehakt ist");
wahr(!/data-part/.test(mod.garetienZeileMarkup(einer)),
	"und eben NICHT dreiwertig -- das Geometrie-Item zaehlt im Haekchen nicht mit");
// ⚠️ Das Leuchten zaehlt weiter ALLE Items: ein vorgemerkter Geometrie-Ersatz IST eine Vormerkung
// und gehoert auf die Karte.
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

// ---- Das Haekchen ------------------------------------------------------------------------------

function hakenZiel(key, seg, options) {
	const feld = Object.assign({ passt: ['input[type="checkbox"]'], attribute: {} }, options || {});
	const traeger = {
		passt: ["[data-key]", ".avm-row"],
		attribute: seg === null ? { "data-key": key } : { "data-key": key, "data-seg": seg },
	};
	return kette([feld, traeger]);
}

gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(strasse.key, null) }, objekte, 7, senden), "gesendet",
	"ein Klick auf das Zeilenhaekchen schickt");
tief(gesendet[0], { action: "select", kind: "garetien", run_id: 7,
	ids: [101, 201, 102, 202, 103, 203, 104, 204, 105, 205, 106, 206], selected: true },
	"halb angehakt -> alle zwoelf anhaken, durch dieselbe Tuer");

gesendet = [];
garetienHakenKlick({ target: hakenZiel(strasse.key, "w-2213") }, objekte, 7, senden);
tief(gesendet[0].ids, [103, 203], "ein Abschnittshaekchen bewegt nur seinen Abschnitt");

gesendet = [];
gleich(garetienHakenKlick({ target: hakenZiel(deckt.key, null, { disabled: true }) }, objekte, 7, senden),
	null, "ein gesperrtes Haekchen schickt nichts");
gleich(garetienHakenKlick({ target: hakenZiel(deckt.key, null) }, objekte, 7, senden), null,
	"und ein Objekt ohne Items auch nicht");
gleich(gesendet.length, 0, "nichts davon ging hinaus");
gleich(garetienHakenKlick({ target: kette([{ passt: [], attribute: {} }]) }, objekte, 7, senden), null,
	"ein Klick neben ein Haekchen tut nichts");

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
wahr(/disabled title="[^"]*5 Abschnitte/.test(leisteAus),
	"ein ausgegrauter Knopf traegt seinen Grund im title");
wahr(/gi-acts__grund/.test(leisteAus) && />Geometrie ersetzen: [^<]*5 Abschnitte/.test(leisteAus),
	"💣 und SICHTBAR daneben -- ein title erscheint nur beim Verweilen, am Telefon nie");
// Die DIFFERENZ: der Zufluss hat NUR bedienbare Knoepfe (neu + ablehnen), und dann steht auch
// keine Grundzeile da. ⚠️ Die Reichsstrasse taugt dafuer NICHT -- sie trifft sechs Abschnitte, ihr
// „Geometrie ersetzen" ist also sehr wohl ausgegraut.
// ⚠️ Der sichtbare Grund traegt die Auslassungspunkte des Knopfes NICHT mit -- „Geometrie
// ersetzen …: ihr Objekt trifft …" liest sich wie ein abgebrochener Satz.
wahr(/>Geometrie ersetzen: /.test(leisteAus),
	"der sichtbare Grund nennt den Knopf ohne seine Auslassungspunkte");
wahr(/Geometrie ersetzen …</.test(leisteAus),
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

// 🔴 Und NICHTS in dieser Datei nennt `apply` -- das ist Aufgabe 16, hinter der zweiten
// Bestaetigung des Blattes. „Im Zweifel vormerken, nie schreiben."
// 🪤 Gesucht wird das blanke ZEICHENKETTEN-LITERAL, nicht `action: "apply"`: die drei Aktionen
// dieser Datei stehen teils in einem Bedingungsausdruck (`name === "ablehnen" ? "decline" :
// "undecline"`), und ein Muster, das ein `action:` davor verlangt, faende genau die nicht --
// es waere gruen, weil es die falsche Form sucht.
wahr(!/["']apply["']/.test(quelle),
	"💣 Aufgabe 15 merkt vor. Geschrieben wird erst durch das Uebernahme-Blatt (Aufgabe 16).");
// Gegenprobe zur Zeile darueber: dasselbe Muster MUSS an den Aktionen anschlagen, die es gibt --
// inklusive der zwei, die in einem Bedingungsausdruck stehen.
["select", "liste", "decline", "undecline"].forEach((aktion) => {
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
["--color-danger", "--color-success-soft", "--color-divider", "--font-size-caption"].forEach((token) => {
	wahr(acts.includes(token), `das Token ${token} fehlt in der Handlungsleiste`);
});

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

const echterFetch = global.fetch;
const gestellt = [];
global.fetch = function (pfad, optionen) {
	gestellt.push({ pfad: String(pfad), rumpf: JSON.parse((optionen && optionen.body) || "{}") });
	return Promise.resolve({
		json: () => Promise.resolve({
			ok: true, plan_run_id: 4711, objekte: [], gesamt: 0,
			bilanz: {}, reiter: {}, facetten: {}, angehakt: { new: 0, changed: 0 },
		}),
	});
};

mod.avesmapsGaretienListeHolen().then(function () {
	global.fetch = echterFetch;
	gleich(gestellt.length, 1, "die Gegenprobe: es lief wirklich eine Anfrage");
	gleich(gestellt[0].rumpf.action, "liste", "und zwar die Liste");
	gleich(mod.avesmapsGaretienFensterZustand().planRunId, 4711,
		"💣 die Lauf-Nummer der Vorschau kommt aus der Listenantwort -- ohne sie ginge jede "
		+ "Handlung mit run_id: null hinaus und bekaeme 404 `not_found`");

	console.log(`garetien-handlungen ok -- ${checks} Zusicherungen`);
}).catch(function (fehler) {
	global.fetch = echterFetch;
	console.error(fehler);
	process.exitCode = 1;
});
