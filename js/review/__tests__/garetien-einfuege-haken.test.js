// Die zwei Häkchen „“ und „“ (Owner 09.09.2026).
//
// Owner, wörtlich: „hier ist der button irgendwie falsch beschriftet ‚Auf die Stage - ergänzt nur
// die Quelle' macht erstmal keinen sinn, weil auf der stage ist auf der stage, erst dann
// entscheide ich ob es nur die quelle ergänzt und selbst da kann man sich ja immer noch
// entscheiden, ob es auf die karte soll oder innerorts platziert wird. […] man will unterscheiden
// als ‚Als Quelle einfügen' oder ‚Neu einfügen' und damit es keine verwirrtung mit dem button
// ‚Stage importieren' gibt, sollten das häkchen sein. ‚Neu einfügen' importiert dabei immer die
// quelle mit (‚Als Quelle einfügen' auto on). ‚Neu einfügen' verschwindet und ist nicht möglich,
// wenn der ort innerorts ist."
//
// 🔴 DIE STAGE WIRD DAMIT NEUTRAL. Bis hierher LEITETE `garetienStageVorhaben` ab, was beim Import
// passiert, und der Knopf trug die Ableitung als Unterzeile. Jetzt sagen es zwei Häkchen, und der
// Schreibumfang folgt IHNEN -- Anzeige und Wirkung koennen nicht mehr auseinanderlaufen, weil es
// nur noch eine Quelle gibt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-einfuege-haken.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter();
let n = 0;
function pruefe(bedingung, was) { n++; assert.ok(bedingung, was); }

// Ein Objekt, das sich deckt: ein Quellen-Item (changed) und ein Zusatz-Item (new).
function objektErgaenzung() {
	return {
		key: "ggp:Ortschaften_3:Gebaeude:Garetien:Untergraser Bogenhaus!Untergras",
		stand: "offen", urteil: "ergaenzung",
		items: [
			// Die ECHTE Item-Form: `anlass` und `felder` liegen am Item, nicht in `after`
			// (garetienItemAnlass / garetienItemSchreibt). Erfunden waere sie hier ein Test, der
			// eine Struktur prueft, die nie ankommt.
			{ id: 1, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"] },
			{ id: 2, change_type: "new", anlass: "zusatz", felder: [] },
		],
	};
}
// Ein reiner Neuzugang.
function objektNeu() {
	return { key: "ggp:Gewaesser:Fluss:Garetien:Gardel!Gardel",
		items: [{ id: 3, change_type: "new", anlass: "", felder: ["quelle"] }] };
}

api.garetienEinfuegeWahlVergessen();

// =================================================================================================
// A. Die Vorbelegung -- sie ist der heutige Zustand, nicht eine neue Behauptung
// =================================================================================================
// ⚠️ Ohne diese Zusicherung waere der Umbau eine stille Verhaltensaenderung: wer nichts anhakt und
// „“ drueckt, muss genau das bekommen, was er vor dem 09.09.2026 bekommen haette.

let w = api.garetienEinfuegeWahl(objektErgaenzung());
pruefe(w.quelle === true, "eine Ergaenzung ist vorangehakt -- wie bisher");
pruefe(w.neu === false, "aber NICHT das Zusatz-Item: „“ bleibt eine Wahl");

w = api.garetienEinfuegeWahl(objektNeu());
pruefe(w.neu === true, "ein Neuzugang ist vorangehakt");
pruefe(w.quelle === true, "und bringt seine Quelle mit");

// =================================================================================================
// B. „“ schaltet „“ mit an
// =================================================================================================
const o = objektErgaenzung();
api.garetienEinfuegeWahlSetzen(o, "neu", true);
w = api.garetienEinfuegeWahl(o);
pruefe(w.neu === true && w.quelle === true,
	"Owner: „“");

// 💣 Und die Quelle laesst sich dann NICHT einzeln abwaehlen -- sonst stuende ein Haken, der
// nichts bewirkt, und der naechste Import legte doch eine Quelle an.
api.garetienEinfuegeWahlSetzen(o, "quelle", false);
w = api.garetienEinfuegeWahl(o);
pruefe(w.quelle === true, "solange „“ steht, bleibt die Quelle gebunden");

// Erst wenn „“ faellt, ist die Quelle wieder frei.
api.garetienEinfuegeWahlSetzen(o, "neu", false);
api.garetienEinfuegeWahlSetzen(o, "quelle", false);
w = api.garetienEinfuegeWahl(o);
pruefe(w.neu === false && w.quelle === false, "ohne „“ ist die Quelle wieder abwaehlbar");

// =================================================================================================
// C. Innerorts nimmt „“ weg
// =================================================================================================
// 🔴 `innerorts` und `neu` sind DIESELBE Item-Menge, nur ein anderer Zielort
// (AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG: „innerorts ist kein anderer Vorschlag, sondern ein anderer
// ZIELORT fuer denselben"). Steht eine Stadt im Feld „“, kann „“ nicht
// zugleich gelten -- der Haken verschwindet, statt eine Wahl anzubieten, die es nicht gibt.
const innerorts = {
	key: "ggp:Ortschaften_3:Tempel:Garetien:Rondratempel zu Uslenried!Rondratempel",
	items: [{ id: 4, change_type: "new", anlass: "", felder: ["quelle"] }],
	ziel: "location", subtyp: "gebaeude",
	innerorts: { public_id: "stadt-1", name: "Uslenried", meilen: 0.3,
		kandidaten: [{ public_id: "stadt-1", name: "Uslenried", meilen: 0.3, nennt_name: true }] },
};
pruefe(api.garetienNeuMoeglich(innerorts) === true, "auf die Karte: „“ steht zur Wahl");
api.garetienInnerortsWahlSetzen(innerorts, "stadt-1");
pruefe(api.garetienNeuMoeglich(innerorts) === false,
	"mit gewaehlter Stadt verschwindet „“");
// ⚠️ Und die Wahl darf nicht als gesetzter Haken UEBERLEBEN -- sonst legte der Import doch ein
// Kartenobjekt an, waehrend der Haken gar nicht mehr sichtbar ist.
pruefe(api.garetienEinfuegeWahl(innerorts).neu === false,
	"ein unmoeglicher Haken zaehlt nicht, auch wenn er vorher gesetzt war");
api.garetienInnerortsWahlSetzen(innerorts, "");
pruefe(api.garetienNeuMoeglich(innerorts) === true, "zurueck auf „“: der Haken kommt wieder");

// =================================================================================================
// D. Der Schreibumfang folgt den Häkchen -- die eigentliche Zusicherung
// =================================================================================================
// 💣 A bis C koennen gruen sein, waehrend `garetienStageItems` weiter der alten Ableitung folgt.
// Dann stimmt die Anzeige und der Import tut etwas anderes -- genau der Befund B3 vom 07.09.2026,
// nur andersherum.
const s = objektErgaenzung();
api.garetienEinfuegeWahlVergessen();
let ids = api.garetienStageItems(s).map(function (i) { return i.id; });
assert.deepStrictEqual(ids, [1], "vorangehakt: nur die Quelle"); n++;

api.garetienEinfuegeWahlSetzen(s, "neu", true);
ids = api.garetienStageItems(s).map(function (i) { return i.id; }).sort();
assert.deepStrictEqual(ids, [1, 2], "mit „“: das Zusatz-Item kommt dazu"); n++;

api.garetienEinfuegeWahlSetzen(s, "neu", false);
api.garetienEinfuegeWahlSetzen(s, "quelle", false);
assert.deepStrictEqual(api.garetienStageItems(s), [], "nichts angehakt, nichts geschrieben"); n++;

// =================================================================================================
// E. Der Knopf behauptet nichts mehr
// =================================================================================================
// 🔴 Owner: „“. Die Unterzeile „“ nahm eine
// Entscheidung vorweg, die jetzt die Häkchen treffen.
const knoepfe = api.garetienHandlungen(objektErgaenzung());
const stage = knoepfe.filter(function (k) { return k.name === "stage"; })[0];
pruefe(!!stage, "der Stage-Knopf steht weiterhin da");
pruefe(stage.beschriftung === "Auf die Stage", "und heisst nur noch so: " + stage.beschriftung);
pruefe(!stage.zeile2, "ohne Unterzeile -- die Häkchen sagen, was passiert: "
	+ JSON.stringify(stage.zeile2));

// =================================================================================================
// F. Das Markup -- die Häkchen stehen wirklich da, aber erst auf der Stage
// =================================================================================================
// 💣 A bis E prüfen die REGELN. Ohne diesen Abschnitt könnten sie alle stimmen, während der Kasten
// gar keine Häkchen zeigt -- der Editor sähe nur einen Knopf, der jetzt auch noch schweigt.
api.garetienEinfuegeWahlVergessen();
api.avesmapsGaretienStageLeeren();

// 🔴 VOR DER STAGE STEHT NICHTS DA (Owner 09.09.2026: „sollen erst kommen wenn es auf der stage
// ist"). Das ist die Reihenfolge seiner eigenen Begründung: „auf der stage ist auf der stage, ERST
// DANN entscheide ich, ob es nur die quelle ergänzt."
pruefe(api.garetienEinfuegeHakenMarkup(objektErgaenzung()) === "",
	"vor der Stage zeigt der Kasten keine Häkchen");

const aufStage = objektErgaenzung();
api.avesmapsGaretienStageHinzufuegen([aufStage]);
let mk = api.garetienEinfuegeHakenMarkup(aufStage);
pruefe(mk.indexOf("Als Quelle einfügen") !== -1, "auf der Stage: das Quellen-Häkchen steht da");
pruefe(mk.indexOf("Neu einfügen") !== -1, "und „Neu einfügen“ daneben");
pruefe(mk.indexOf('data-gi-feld="einfuegeQuelle"') !== -1, "mit dem Feldnamen, den der Handler liest");
pruefe(mk.indexOf('data-gi-feld="einfuegeNeu"') !== -1, "beide");

// 🔴 Innerorts: „Neu einfügen" FEHLT GANZ, nicht ausgegraut.
const innerortsAufStage = Object.assign({ stand: "offen", urteil: "neu" }, innerorts);
api.avesmapsGaretienStageHinzufuegen([innerortsAufStage]);
api.garetienInnerortsWahlSetzen(innerortsAufStage, "stadt-1");
mk = api.garetienEinfuegeHakenMarkup(innerortsAufStage);
pruefe(mk.indexOf("Neu einfügen") === -1,
	"mit gewählter Stadt fehlt der Haken ganz -- kein ausgegrauter Rest: " + mk);
api.garetienInnerortsWahlSetzen(innerortsAufStage, "");

// ⚠️ Ein übernommenes Objekt bekommt keine Häkchen -- dort gibt es nichts mehr zu entscheiden.
const uebernommen = Object.assign(objektErgaenzung(), { stand: "uebernommen" });
api.avesmapsGaretienStageHinzufuegen([uebernommen]);
pruefe(api.garetienEinfuegeHakenMarkup(uebernommen) === "",
	"ein übernommenes Objekt zeigt keine Häkchen");

// =================================================================================================
// G. Die Knöpfe stehen in einer EIGENEN Zeile unter den Häkchen
// =================================================================================================
// 🔴 Owner 09.09.2026: „Von der Stage nehmen + Ablehnen soll in eine 2. Zeile unter die checkboxen".
// 💣 Die eigene Hülle ist tragend: `.gi-acts` ist eine umbrechende Flex-Zeile, und ohne sie stehen
// die Knöpfe als Geschwister der Häkchen-Absätze -- der Umbruch zieht sie dann neben einen Haken.
api.garetienEinfuegeWahlVergessen();
const leiste = api.garetienHandlungsMarkup(aufStage);
const iHaken = leiste.indexOf('data-gi-feld="einfuegeQuelle"');
const iKnoepfe = leiste.indexOf('gi-acts__knoepfe');
pruefe(iHaken !== -1 && iKnoepfe !== -1, "beide stehen in der Leiste");
pruefe(iHaken < iKnoepfe, "und die Häkchen ZUERST -- die Knöpfe darunter");
pruefe(leiste.indexOf("Von der Stage nehmen") > iKnoepfe,
	"„Von der Stage nehmen“ steht in der Knopfzeile");
pruefe(leiste.indexOf("Ablehnen") > iKnoepfe, "„Ablehnen“ auch");
api.avesmapsGaretienStageLeeren();

// =================================================================================================
// H. Das Quellen-Häkchen verschwindet NIE beim Abhaken von „Neu einfügen"
// =================================================================================================
// Owner-Meldung 09.09.2026: „‚Neu einfügen‘ abhäkeln sorgt übrigens dafür, dass ‚Als Quelle
// einfügen‘ verschwindet. […] das gibt keinen sinn."
//
// 💣 Der Fall ist der REINE NEUZUGANG: dort gibt es kein eigenes Quellen-Item (die Quelle reist im
// `new`-Item mit), also war die Zeile nur sichtbar, SOLANGE der Haken stand -- und fiel im selben
// Klick weg, der sie freigeben sollte.
api.garetienEinfuegeWahlVergessen();
api.avesmapsGaretienStageLeeren();
const neuAufStage = objektNeu();
neuAufStage.stand = "offen";
neuAufStage.urteil = "neu";
api.avesmapsGaretienStageHinzufuegen([neuAufStage]);

let m = api.garetienEinfuegeHakenMarkup(neuAufStage);
pruefe(m.indexOf("Als Quelle einfügen") !== -1, "mit „Neu einfügen“: das Quellen-Häkchen steht da");

api.garetienEinfuegeWahlSetzen(neuAufStage, "neu", false);
m = api.garetienEinfuegeHakenMarkup(neuAufStage);
pruefe(m.indexOf("Als Quelle einfügen") !== -1,
	"OHNE „Neu einfügen“ steht es IMMER NOCH da -- es verschwindet nicht: " + m);
pruefe(m.indexOf("Neu einfügen") !== -1, "und „Neu einfügen“ selbst auch");

// ⚠️ SICHTBAR heisst nicht WÄHLBAR: ein Neuzugang ohne „Neu einfügen“ hat kein Ziel, an das eine
// Quelle könnte -- die Zeile bleibt gesperrt, statt einen Haken ohne Wirkung anzubieten.
const zeileQuelle = m.slice(0, m.indexOf("Als Quelle einfügen"));
pruefe(zeileQuelle.lastIndexOf("disabled") > zeileQuelle.lastIndexOf("<input"),
	"und ist gesperrt, weil es nichts zu ergänzen gibt");
api.avesmapsGaretienStageLeeren();

console.log("OK -- " + n + " Zusicherungen");
