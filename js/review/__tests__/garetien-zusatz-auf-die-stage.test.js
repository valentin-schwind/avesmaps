// Fixrunde 1 zu Aufgabe 9+10 des Garetien Importers (07.09.2026), BEFUND B3:
// „für 528 Objekte verspricht der neue Vorwärtsknopf etwas, das der Import nicht tut".
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-zusatz-auf-die-stage.test.js
//
// 💣 DER BEFUND, WOERTLICH GEMESSEN. Mit dem Wegfall von „Neu einfügen" (Owner-Punkt 12) hat das
// ZUSATZ-Item („trotzdem neu anlegen", Owner-Meldung B vom 30.08.2026) seinen einzigen Zugang
// verloren. Sichtbar wurde das als WIDERSPRUCH zwischen zwei Lesern desselben Objekts:
//
//     garetienStageUebernahmeIds:  []                       -> der Import schreibt NICHTS
//     Vorwaertsknopf:              „Auf die Stage | als Flussweg"  -> verspricht das Gegenteil
//     Fussknopf:                   „Stage importieren (0 von 1)"
//
// 🔴 UND DIE ZAHL AUS DEM AUFTRAG WAR ZUR HAELFTE FALSCH -- am Dump vom 04.09.2026 nachgezaehlt
// (Lauf 73, der offene Lauf mit 4.294 Items, dieselbe Zahl, die der Auftrag nennt):
//
//     3.385 Objekte  echtes NEU (Haken-Item mit change_type 'new')
//         4 Objekte  nur ERGAENZUNG (Quelle), ohne Zusatz-Item
//       334 Objekte  ERGAENZUNG **und** Zusatz-Item      <-- die gemischte Lage
//       194 Objekte  NUR das Zusatz-Item                 <-- die Lage aus B3
//     -----
//       528 Objekte tragen ein Zusatz-Item (12,3 % der Items) -- die Zahl des Auftrags stimmt,
//                   aber „bei allen 528 ist es das EINZIGE" gilt nur fuer 194.
//
// 💣 Haette die Stage bei den 334 gemischten BEIDE Items uebernommen, ergaenzte ein Import die
// Quelle am getroffenen Objekt UND legte daneben eine Dublette an -- exakt der Schadensfall vom
// 30.08.2026 („hat unsere ganze karte zerstoert", 3007 Objekte), nur ueber einen neuen Knopf.
// Deshalb: das Zusatz-Item zaehlt NUR, wenn es der einzige Weg nach vorn ist.

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter(["garetien-apply", "garetien-apply-hint"]);
const {
	garetienStageVorhaben, garetienStageItems, garetienStagePlan,
	garetienStageZeile2, garetienStageKnopfBauen, garetienStageKlick,
	garetienZusatzRueckfrageText, garetienZusatzObjekte, garetienZusatzMengeRueckfrageText,
	garetienUebernahmeKnopfZustand, garetienAuswahlleisteKlick,
	garetienStageUebernahmeIds, garetienStageAnhakenIds,
	avesmapsGaretienStageLeeren, avesmapsGaretienStageHat,
	avesmapsGaretienAuswahlUmschalten, avesmapsGaretienAuswahlAufheben,
} = api;
// ⚠️ `garetienStageNeuIds` liegt als einzige der drei Sammler unter `__test` -- sie kam mit
// Aufgabe 3 dazu, als dort schon gebuendelt wurde.
const { garetienStageNeuIds } = api.__test;

let checks = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); checks++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); checks++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); checks++; };

[["garetienStageVorhaben", garetienStageVorhaben], ["garetienStageItems", garetienStageItems],
	["garetienStagePlan", garetienStagePlan], ["garetienZusatzObjekte", garetienZusatzObjekte],
	["garetienZusatzMengeRueckfrageText", garetienZusatzMengeRueckfrageText],
].forEach(([n, f]) => wahr(typeof f === "function", n + " fehlt im Export"));
gleich(api.garetienNeuIstZusatz, undefined,
	"🔴 `garetienNeuIstZusatz` ist gefallen -- die Frage beantwortet garetienStageVorhaben, und "
	+ "zwar ENGER (nur wenn das Zusatz-Item allein steht)");

// Die vier Lagen aus der Messung oben, als Fixture.
const nurZusatz = {
	key: "z", stand: "offen", urteil: "deckt_sich", name: "Gernat", ziel: "path", subtyp: "Flussweg",
	grund: "trotz Nähe zu „Flussweg-5112“",
	items: [{ id: 61, anlass: "zusatz", change_type: "new", felder: [] }],
};
const gemischt = {
	key: "g", stand: "offen", urteil: "deckt_sich", name: "Birkentau", ziel: "region",
	items: [
		{ id: 71, anlass: "ergaenzung", change_type: "changed", felder: ["quelle"] },
		{ id: 72, anlass: "zusatz", change_type: "new", felder: [] },
	],
};
const echtNeu = {
	key: "n", stand: "offen", urteil: "neu", name: "Blutmoor", ziel: "region", subtyp: "suempfe_moore",
	items: [{ id: 81, change_type: "new", felder: [] }],
};
const nurErgaenzung = {
	key: "e", stand: "offen", urteil: "ergaenzung", name: "Auer",
	items: [{ id: 91, anlass: "ergaenzung", change_type: "changed", felder: ["quelle"] }],
};
const ohneAlles = { key: "o", stand: "offen", urteil: "uebersprungen", name: "Perz", items: [] };

// =================================================================================================
// 1. DIE EINE WEICHE -- vier Lagen, vier Antworten.
// =================================================================================================
gleich(garetienStageVorhaben(echtNeu), "neu");
gleich(garetienStageVorhaben(nurErgaenzung), "ergaenzung");
gleich(garetienStageVorhaben(nurZusatz), "zusatz");
gleich(garetienStageVorhaben(gemischt), "ergaenzung",
	"💣 GEMISCHT ZAEHLT ALS ERGAENZUNG -- das Zusatz-Item bleibt draussen, solange ein legitimes "
	+ "Item danebensteht (334 der 528 Objekte des Laufs 73)");
gleich(garetienStageVorhaben(ohneAlles), "nichts");
gleich(garetienStageVorhaben(null), "nichts", "ohne Objekt wird nichts behauptet");

// Das Geometrie-Item hat seinen eigenen Knopf mit Rueckfrage und kommt in KEINER Lage mit.
const nurGeometrie = {
	key: "geo", stand: "offen", urteil: "deckt_sich", name: "Rakula",
	items: [{ id: 95, anlass: "geometrie", change_type: "changed", felder: ["geometrie"] }],
};
gleich(garetienStageVorhaben(nurGeometrie), "nichts", "ein Geometrie-Item ist kein Stage-Vorhaben");
tief(garetienStageItems(nurGeometrie), [], "…und traegt auch keine Items bei");

// =================================================================================================
// 2. DIE ITEM-MENGE FOLGT DER WEICHE -- und mit ihr ALLE DREI Sammler.
//    💣 `apply` schreibt ausschliesslich, was `selected = 1` traegt (avesmapsSyncPlanPendingItems,
//    sync-plan.php): Anhaken und Uebernehmen muessen deshalb DIESELBE Menge nennen.
// =================================================================================================
tief(garetienStageItems(nurZusatz).map((i) => i.id), [61]);
tief(garetienStageItems(gemischt).map((i) => i.id), [71], "💣 NUR das Ergaenzungs-Item");
tief(garetienStageUebernahmeIds([nurZusatz]), [61],
	"🔴 der Schreibumfang traegt das Zusatz-Item -- sonst tut „Stage importieren\" nichts");
tief(garetienStageAnhakenIds([nurZusatz]), [61],
	"💣 UND DER SELECT-SCHRITT AUCH -- ein Item, das nie angehakt wurde, erreicht `apply` nie");
tief(garetienStageNeuIds([nurZusatz]), [61],
	"…und „Rückgängig\" findet es, sonst staende das angelegte Objekt ohne Rueckweg da");
tief(garetienStageUebernahmeIds([gemischt]), [71],
	"💣 beim gemischten Objekt bleibt es draussen -- sonst Ergaenzung UND Dublette in einem Import");
tief(garetienStageAnhakenIds([gemischt]), [71]);
tief(garetienStageNeuIds([gemischt]), [], "…und ein 'changed' legt ohnehin nichts Neues an");

// Die Toggle-Regel ist DIESELBE wie beim Zeilenhaekchen -- ein vollstaendig angehaktes Objekt
// braucht kein neues Anhaken.
gleich(garetienStagePlan(nurZusatz).selected, true, "ungehakt -> anhaken");
gleich(garetienStagePlan({ key: "z2", items: [{ id: 62, anlass: "zusatz", change_type: "new", selected: 1 }] }).selected,
	false, "schon angehakt -> die Toggle-Richtung dreht, wie bei garetienHakenPlan");
gleich(garetienStagePlan(ohneAlles), null, "ohne Items gibt es keinen Plan");

// =================================================================================================
// 3. DER KNOPF SAGT JETZT DIE WAHRHEIT -- vier Lagen, vier zweite Zeilen.
// =================================================================================================
gleich(garetienStageZeile2(echtNeu, false), "als suempfe_moore");
gleich(garetienStageZeile2(nurZusatz, false), "zusätzlich als Flussweg",
	"🔴 „zusätzlich\" IST die Aussage -- der Abgleich hat etwas gefunden, und es kommt trotzdem dazu");
gleich(garetienStageZeile2(nurZusatz, true), "liegt zusätzlich als Flussweg");
gleich(garetienStageZeile2(gemischt, false), "ergänzt nur die Quelle",
	"💣 die gemischte Lage legt NICHTS an -- „als Fläche\" waere die Beschreibung einer anderen Handlung");
gleich(garetienStageZeile2(nurErgaenzung, false), "ergänzt nur die Quelle");
gleich(garetienStageZeile2(nurErgaenzung, true), "liegt für die Quelle");
gleich(garetienStageZeile2(ohneAlles, false), "nur Ansicht");
gleich(garetienStageKnopfBauen(nurZusatz).zeile2, "zusätzlich als Flussweg",
	"…und der Bauer reicht sie durch");

// =================================================================================================
// 4. DER FUSSKNOPF ZAEHLT DAS ZUSATZ-OBJEKT MIT -- sonst stuende „0 von 1" neben einem Knopf,
//    der „als Flussweg" verspricht (genau der gemeldete Widerspruch).
// =================================================================================================
{
	const stand = garetienUebernahmeKnopfZustand([nurZusatz]);
	gleich(stand.beschriftung, "Stage importieren (1 von 1)");
	gleich(stand.gesperrt, false);
	gleich(stand.hinweis, "", "kein Grund noetig -- es gibt etwas zu tun");
}
{
	// ⚠️ Und der GRUND, wenn wirklich nichts da ist, sagt jetzt das Richtige. Vorher stand dort
	// „für ihre Art gibt es in diesem Lauf noch keine Zuordnung" -- fuer die 528 schlicht falsch.
	const stand = garetienUebernahmeKnopfZustand([ohneAlles]);
	gleich(stand.beschriftung, "Stage importieren (0 von 1)");
	gleich(stand.gesperrt, true);
	wahr(stand.hinweis.indexOf("nichts gefunden") !== -1,
		"der Grund benennt den Abgleich, nicht eine „Zuordnung fuer die Art\": " + stand.hinweis);
	gleich(stand.hinweis.indexOf("keine Zuordnung"), -1,
		"🔴 die alte, falsche Begruendung ist weg");
}

// =================================================================================================
// 5. MIT RUECKFRAGE -- einzeln. „Auf die Stage" ist die ausdrueckliche Wahl, die „Neu einfügen" war.
// =================================================================================================
const ziel = (handlung, key) => ({
	closest(sel) {
		return sel.indexOf(handlung) !== -1
			? { disabled: false, getAttribute: (a) => (a === "data-handlung" ? handlung : key) }
			: null;
	},
});
avesmapsGaretienStageLeeren();
{
	const gefragt = [];
	const ergebnis = garetienStageKlick({ target: ziel("stage", "z") }, [nurZusatz], (t) => {
		gefragt.push(t); return true;
	});
	gleich(gefragt.length, 1, "es wird gefragt");
	wahr(gefragt[0].indexOf("ZUSÄTZLICH angelegt") !== -1, "und die Rueckfrage nennt die Folge");
	wahr(gefragt[0].indexOf("Stage importieren") !== -1,
		"💣 …und WANN es passiert: erst beim Import, nicht bei diesem Klick");
	gleich(gefragt[0].indexOf("jetzt sofort"), -1,
		"🔴 der alte Satz („wird jetzt sofort angelegt\") beschriebe eine Handlung, die es nicht mehr gibt");
	gleich(ergebnis.handlung, "stage");
	gleich(avesmapsGaretienStageHat("z"), true, "…und es liegt danach auf der Stage");
}
avesmapsGaretienStageLeeren();
{
	const ergebnis = garetienStageKlick({ target: ziel("stage", "z") }, [nurZusatz], () => false);
	gleich(avesmapsGaretienStageHat("z"), false, "ein „Nein\" legt nichts hin");
	wahr(ergebnis && ergebnis.handlung === "stage_abgelehnt",
		"💣 der Klick gilt trotzdem als UEBERNOMMEN -- sonst faellt er weiter zu garetienHandlungKlick "
		+ "durch und verschickt ein sinnloses `select`");
}
// ⚠️ Ohne Rueckfragemoeglichkeit geschieht NICHTS -- dieselbe Hausregel wie bei garetienFragen.
avesmapsGaretienStageLeeren();
garetienStageKlick({ target: ziel("stage", "z") }, [nurZusatz], null);
gleich(avesmapsGaretienStageHat("z"), false, "ohne `fragen` bleibt es liegen");
// …und ein Objekt OHNE Zusatz-Item wird nie gefragt.
{
	const gefragt = [];
	garetienStageKlick({ target: ziel("stage", "n") }, [echtNeu], (t) => { gefragt.push(t); return true; });
	gleich(gefragt.length, 0, "ein normaler Neuzugang fragt niemanden");
	gleich(avesmapsGaretienStageHat("n"), true);
}
avesmapsGaretienStageLeeren();

// =================================================================================================
// 6. UND IN DER MENGE -- „eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel".
// =================================================================================================
tief(garetienZusatzObjekte([echtNeu, nurZusatz, gemischt]).map((o) => o.key), ["z"],
	"nur das Objekt, dessen einziges Item ein Zusatz ist");
{
	const text = garetienZusatzMengeRueckfrageText([nurZusatz]);
	wahr(text.indexOf("1 Objekt") !== -1, "die Rueckfrage nennt die Zahl");
	wahr(text.indexOf("„Gernat\"") !== -1 || text.indexOf("Gernat") !== -1, "…und den Namen");
	wahr(text.indexOf("Rest der Auswahl") !== -1,
		"⚠️ …und sagt, dass ein „Abbrechen\" nur DIESE Objekte liegenlaesst");
}

const leistenEreignis = (name) => ({
	target: {
		closest(sel) {
			return sel === "[data-auswahl]"
				? { disabled: false, getAttribute: (a) => (a === "data-auswahl" ? name : null) }
				: null;
		},
	},
});
const alle = [echtNeu, nurZusatz];
avesmapsGaretienAuswahlAufheben();
avesmapsGaretienStageLeeren();
avesmapsGaretienAuswahlUmschalten("n");
avesmapsGaretienAuswahlUmschalten("z");
{
	const gefragt = [];
	const ergebnis = garetienAuswahlleisteKlick(leistenEreignis("auswahl_stage"), alle, 7, {
		fragen: (t) => { gefragt.push(t); return true; },
	});
	gleich(gefragt.length, 1, "EINE Rueckfrage fuer die ganze Menge, nicht eine je Objekt");
	gleich(ergebnis.anzahl, 2, "beide kommen auf die Stage");
	gleich(ergebnis.uebersprungen, 0);
	gleich(avesmapsGaretienStageHat("z"), true);
}
avesmapsGaretienStageLeeren();
{
	const ergebnis = garetienAuswahlleisteKlick(leistenEreignis("auswahl_stage"), alle, 7,
		{ fragen: () => false });
	gleich(ergebnis.anzahl, 1, "⚠️ ein „Nein\" verwirft NUR die Zusatz-Objekte");
	gleich(ergebnis.uebersprungen, 1, "…und sagt, wie viele liegenblieben");
	gleich(avesmapsGaretienStageHat("n"), true, "der Rest der Auswahl kommt trotzdem auf die Stage");
	gleich(avesmapsGaretienStageHat("z"), false, "das Zusatz-Objekt nicht");
}
avesmapsGaretienStageLeeren();
avesmapsGaretienAuswahlAufheben();

console.log("OK -- " + checks + " Zusicherungen");
