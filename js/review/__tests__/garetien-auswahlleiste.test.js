// Aufgabe 9+10 des Garetien Importers (07.09.2026) -- die Auswahl wird handlungsfaehig.
// Brief: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-9-10-brief.md
// Entwurf: docs/superpowers/specs/2026-09-06-garetien-importer-stage-design.md §4 und §5.2
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-auswahlleiste.test.js
//
// 🔴 Gemessen wird die REINE Haelfte (garetienAuswahlleisteZustand, …Markup) UND die Verdrahtung
// am Fake-DOM. Eine Zusicherung, die bloss behauptet, im Quelltext stehe ein `if`, waere Vakuum.

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, dom } = ladeImporter(["garetien-auswahlleiste", "garetien-mark-all"]);
const {
	garetienAuswahlleisteZustand, garetienAuswahlleisteMarkup,
	garetienAlleWaehlenZustand,
} = api;

let checks = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); checks++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); checks++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); checks++; };

[["garetienAuswahlleisteZustand", garetienAuswahlleisteZustand],
	["garetienAuswahlleisteMarkup", garetienAuswahlleisteMarkup],
].forEach(([n, f]) => wahr(typeof f === "function", n + " fehlt im Export"));

// Ein ausgewaehltes Objekt MIT Vorschlag und eines OHNE.
const mitItem = { key: "a", stand: "offen", urteil: "neu", items: [{ id: 1, change_type: "new" }] };
const ohneItem = { key: "b", stand: "offen", urteil: "uebersprungen", items: [] };
const namen = (stand, n, o) => garetienAuswahlleisteZustand(stand, n, o).knoepfe.map((k) => k.name);

// =================================================================================================
// 1. Ohne Auswahl KEINE Leiste -- sie ist der Kontext der Auswahl, keine Dauereinrichtung.
// =================================================================================================
gleich(garetienAuswahlleisteZustand("offen", 0, []).sichtbar, false, "0 gewaehlt -> unsichtbar");
tief(garetienAuswahlleisteZustand("offen", 0, []).knoepfe, [], "und keine Knoepfe");
gleich(garetienAuswahlleisteZustand("offen", 1, [mitItem]).sichtbar, true, "1 gewaehlt -> sichtbar");

// =================================================================================================
// 2. Je Reiter die Knoepfe aus der Tafel des Briefs, IN DIESER REIHENFOLGE.
// =================================================================================================
tief(namen("offen", 2, [mitItem, ohneItem]),
	["auswahl_stage", "auswahl_ablehnen", "auswahl_aufheben"], "Reiter Offen");
tief(namen("stage", 2, [mitItem, ohneItem]),
	["auswahl_entstagen", "auswahl_ablehnen", "auswahl_aufheben"], "Reiter Stage");
tief(namen("uebernommen", 1, [mitItem]),
	["auswahl_ruecknahme", "auswahl_zurueck_offen", "auswahl_aufheben"], "Reiter Uebernommen");
tief(namen("abgelehnt", 1, [mitItem]),
	["auswahl_wieder", "auswahl_aufheben"], "Reiter Abgelehnt");
// Ein unbekannter Reiter bekommt nur den Ausgang -- die zurueckhaltende Richtung.
tief(namen("was-auch-immer", 1, [mitItem]), ["auswahl_aufheben"], "unbekannter Reiter");

// =================================================================================================
// 3. Die Zahl steht in Zeile 2, NIE im Namen (Owner-Wortlaut „Auswahl auf die Stage").
// =================================================================================================
const offen = garetienAuswahlleisteZustand("offen", 3, [mitItem, ohneItem, mitItem]);
const stageKnopf = offen.knoepfe[0];
gleich(stageKnopf.t1, "Auswahl auf die Stage", "der Owner-Wortlaut, ohne Zahl");
gleich(/\d/.test(stageKnopf.t1), false, "keine Ziffer in Zeile 1");
gleich(stageKnopf.t2, "3 Objekte", "die Zahl steht in Zeile 2");
gleich(garetienAuswahlleisteZustand("offen", 1, [mitItem]).knoepfe[0].t2, "1 Objekt", "Einzahl");
offen.knoepfe.forEach((k) => {
	gleich(/\(\d/.test(k.t1), false, "kein Knopf traegt seine Zahl im Namen: " + k.t1);
});

// =================================================================================================
// 4. Toene: „Auswahl ablehnen" rot, „Auswahl auf die Stage" Akzent -- KEINER gefuellt.
// =================================================================================================
gleich(stageKnopf.ton, "accent", "„Auswahl auf die Stage\" traegt den Akzentrahmen, nicht Gruen");
gleich(offen.knoepfe[1].ton, "danger", "„Auswahl ablehnen\" ist rot");
gleich(offen.knoepfe[2].ton, "", "„Auswahl aufheben\" ist neutral");
gleich(garetienAuswahlleisteZustand("uebernommen", 1, [mitItem]).knoepfe[0].ton, "danger",
	"„Zurücknehmen\" ist rot");
["offen", "stage", "uebernommen", "abgelehnt"].forEach((stand) => {
	garetienAuswahlleisteZustand(stand, 2, [mitItem, ohneItem]).knoepfe.forEach((k) => {
		wahr(k.ton !== "main" && k.ton !== "go",
			"kein gefuellter Knopf in der Leiste (" + stand + "/" + k.name + ")");
	});
});
// Und im MARKUP kommt die eine gefuellte Hausklasse nicht vor.
const markupOffen = garetienAuswahlleisteMarkup(offen);
gleich(markupOffen.includes("btn--main"), false, "kein btn--main im Markup der Leiste");

// =================================================================================================
// 5. „Auswahl ablehnen" zaehlt nur, was ein Item traegt -- und sperrt sich, wenn keines dabei ist.
//    ⚠️ Ein Objekt ohne Item traegt nichts bei; es still mitzuzaehlen waere eine Falschaussage.
// =================================================================================================
const ablehnen = (n, o) => garetienAuswahlleisteZustand("offen", n, o).knoepfe[1];
gleich(ablehnen(3, [mitItem, ohneItem, mitItem]).t2, "2 Objekte",
	"nur die zwei mit Vorschlag zaehlen");
gleich(ablehnen(3, [mitItem, ohneItem, mitItem]).gesperrt, false);
gleich(ablehnen(1, [ohneItem]).gesperrt, true, "ohne ein einziges Item gesperrt");
gleich(ablehnen(2, [mitItem, ohneItem]).t2, "1 Objekt", "Einzahl auch hier");

// =================================================================================================
// 6. Das Markup: zwei Zeilen je Knopf, der Name als data-auswahl, gesperrt als `disabled`.
// =================================================================================================
wahr(markupOffen.includes('data-auswahl="auswahl_stage"'), "der Name reist im data-Attribut");
wahr(markupOffen.includes("gi-auswahl__t1"), "Zeile 1 hat ihre eigene Huelle");
wahr(markupOffen.includes("gi-auswahl__t2"), "Zeile 2 auch");
wahr(markupOffen.includes("Auswahl auf die Stage"), "und der Text steht drin");
wahr(garetienAuswahlleisteMarkup(garetienAuswahlleisteZustand("offen", 1, [ohneItem]))
	.includes("disabled"), "ein gesperrter Knopf traegt disabled");
gleich(garetienAuswahlleisteMarkup(garetienAuswahlleisteZustand("offen", 0, [])), "",
	"unsichtbar heisst LEER, nicht eine leere Huelle");
// 💣 UND ZWAR AM `sichtbar`, NICHT NUR AN DER LEEREN KNOPFLISTE. Die Zeile darueber traf beide
//    Bedingungen zugleich und liess die Mutation „prueft nur die Liste" ueberleben (gemessen
//    07.09.2026): ein `hidden`-Kasten MIT Knoepfen darin bleibt fuer ein synthetisches Ereignis
//    erreichbar, und der Verteiler faende sein Ziel.
gleich(garetienAuswahlleisteMarkup({
	sichtbar: false,
	knoepfe: [{ name: "auswahl_ablehnen", t1: "Auswahl ablehnen", t2: "3 Objekte", ton: "danger", gesperrt: false }],
}), "", "💣 `sichtbar: false` liefert LEER, auch wenn Knoepfe danebenstehen");

// =================================================================================================
// 7. „Alle wählen" ist auf der Stage NICHT mehr gesperrt (Owner-Punkt 18).
//    🔴 Die alte Sperre stammt aus der Zeit, in der „Alle markieren" nur Zeilen in die ANZEIGE
//       schob. Heute speist die Auswahl Ablehnen, Von-der-Stage-nehmen und Importieren.
// =================================================================================================
const dreiZeilen = [mitItem, ohneItem, mitItem];
gleich(garetienAlleWaehlenZustand(dreiZeilen, "stage").gesperrt, false,
	"auf der Stage mit Zeilen NICHT gesperrt");
gleich(garetienAlleWaehlenZustand([], "stage").gesperrt, true, "leere Liste bleibt gesperrt");
gleich(garetienAlleWaehlenZustand(dreiZeilen, "offen").gesperrt, false, "auf Offen wie bisher");
gleich(garetienAlleWaehlenZustand([], "offen").gesperrt, true);

// =================================================================================================
// 8. Die DOM-Haelfte: sie fuellt ihren Wirt und versteckt ihn bei 0.
// =================================================================================================
const leiste = dom.el("#garetien-auswahlleiste");
api.garetienAuswahlleisteSetzen(3, [mitItem, ohneItem, mitItem], "offen");
gleich(leiste.hidden, false, "bei Auswahl sichtbar");
wahr(leiste.innerHTML.includes("Auswahl ablehnen"), "und gefuellt");
api.garetienAuswahlleisteSetzen(0, [], "offen");
gleich(leiste.hidden, true, "bei 0 versteckt");
gleich(leiste.innerHTML, "", "und leer -- kein Knopf, den ein Klick noch treffen koennte");

// =================================================================================================
// 9. DER VERTEILER -- er liest die AUSWAHL, nie ein `data-key`.
//    💣 Genau dieser Unterschied ist die Owner-Meldung vom 07.09.2026: „Ablehnen" in der
//    Einzelansicht gehoert dem geoeffneten Objekt, und ein Haekchenklick wechselt das nicht --
//    der Owner hakte „Gramfeldermoor" an und lehnte „Briskenmoor" ab.
// =================================================================================================
const { garetienAuswahlleisteKlick, avesmapsGaretienAuswahlUmschalten,
	avesmapsGaretienAuswahlAufheben, avesmapsGaretienStageHat, avesmapsGaretienStageLeeren,
	avesmapsGaretienStageHinzufuegen } = api;

// Ein Ereignis, das auf einen Leistenknopf zeigt -- so, wie der Browser es zustellt.
const leistenEreignis = (name, gesperrt) => ({
	target: {
		closest(sel) {
			return sel === "[data-auswahl]"
				? { disabled: gesperrt === true, getAttribute: (a) => (a === "data-auswahl" ? name : null) }
				: null;
		},
	},
});

const a = { key: "a", stand: "offen", urteil: "neu", name: "Gramfeldermoor", items: [{ id: 1, change_type: "new" }] };
const b = { key: "b", stand: "offen", urteil: "neu", name: "Briskenmoor", items: [{ id: 2, change_type: "new" }] };
const c = { key: "c", stand: "offen", urteil: "uebersprungen", name: "Perz", items: [] };
const alle = [a, b, c];

// NUR „Gramfeldermoor" ist gewaehlt -- „Briskenmoor" steht daneben und darf NICHT getroffen werden.
avesmapsGaretienAuswahlAufheben();
avesmapsGaretienStageLeeren();
avesmapsGaretienAuswahlUmschalten("a");

let gesendet = [];
let gefragt = [];
const werkzeuge = {
	senden: (rumpf, meldung) => { gesendet.push({ rumpf, meldung }); return "gesendet"; },
	fragen: (text) => { gefragt.push(text); return true; },
};

const ergebnisAblehnen = garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), alle, 7, werkzeuge);
gleich(ergebnisAblehnen, "gesendet", "der Klick geht durch die geteilte Tuer");
gleich(gesendet.length, 1, "genau einmal");
tief(gesendet[0].rumpf.ids, [1],
	"💣 abgelehnt wird DIE AUSWAHL („Gramfeldermoor\"), nicht das Objekt der Einzelansicht");
gleich(gesendet[0].rumpf.action, "decline", "als Ablehnung");
gleich(gefragt.length, 1, "und vorher wird gefragt");
wahr(gefragt[0].includes("1 Objekt"), "die Rueckfrage nennt die Menge: " + gefragt[0]);
wahr(String(gesendet[0].meldung).includes("1 Objekt abgelehnt"),
	"und die Meldung reist MIT durch die Tuer: " + gesendet[0].meldung);

// „Nein" schickt nichts.
gesendet = []; gefragt = [];
gleich(garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), alle, 7,
	{ senden: werkzeuge.senden, fragen: () => false }), null, "ein „Nein\" schickt nichts");
gleich(gesendet.length, 0, "wirklich nichts");

// ⚠️ Objekte OHNE Item tragen nichts bei -- sie werden UEBERSPRUNGEN und in der Meldung GENANNT.
avesmapsGaretienAuswahlUmschalten("c");   // jetzt a + c gewaehlt
gesendet = []; gefragt = [];
garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), alle, 7, werkzeuge);
tief(gesendet[0].rumpf.ids, [1], "das Objekt ohne Item traegt keine id bei");
wahr(String(gesendet[0].meldung).includes("1 ohne Vorschlag übersprungen"),
	"…und wird in der Rueckmeldung GENANNT, nie stillschweigend weggelassen: " + gesendet[0].meldung);
wahr(gefragt[0].includes("unberührt"), "auch die Rueckfrage sagt es: " + gefragt[0]);

// Der Weg auf die Stage und zurueck -- beide client-seitig, beide messbar am ERGEBNIS.
avesmapsGaretienStageLeeren();
gesendet = [];
const aufStage = garetienAuswahlleisteKlick(leistenEreignis("auswahl_stage"), alle, 7, werkzeuge);
gleich(aufStage.anzahl, 2, "beide gewaehlten Objekte kommen auf die Stage");
gleich(avesmapsGaretienStageHat("a"), true, "„Gramfeldermoor\" liegt dort");
gleich(avesmapsGaretienStageHat("b"), false, "💣 „Briskenmoor\" NICHT -- es war nicht gewaehlt");
gleich(gesendet.length, 0, "und es geht nichts an den Server: die Stage ist client-seitig");

const vonStage = garetienAuswahlleisteKlick(leistenEreignis("auswahl_entstagen"), alle, 7, werkzeuge);
gleich(vonStage.anzahl, 2, "und beide wieder herunter");
gleich(avesmapsGaretienStageHat("a"), false, "„Gramfeldermoor\" liegt nicht mehr dort");

// „Auswahl aufheben" leert die Auswahl -- und nur die.
avesmapsGaretienStageHinzufuegen([a]);
const auf = garetienAuswahlleisteKlick(leistenEreignis("auswahl_aufheben"), alle, 7, werkzeuge);
gleich(auf.anzahl, 0, "die Auswahl ist leer");
gleich(avesmapsGaretienStageHat("a"), true,
	"⚠️ die STAGE bleibt -- zwei Mengen, und ein Knopf, der beide leerte, verwischte die Trennung");
avesmapsGaretienStageLeeren();

// ⚠️ `disabled` wird NOCH EINMAL geprueft -- das Attribut ist die Anzeige, nicht der Riegel.
// 💣 UND DIE AUSWAHL MUSS DAFUER GEFUELLT SEIN: mit leerer Auswahl schickte der Verteiler ohnehin
//    nichts (`ids.length === 0`), und die Zusicherung waere Vakuum -- genau das hat die
//    Mutationsprobe vom 07.09.2026 gefunden.
avesmapsGaretienAuswahlUmschalten("a");
gesendet = []; gefragt = [];
gleich(garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen", true), alle, 7, werkzeuge), null,
	"ein gesperrter Knopf tut nichts");
gleich(gesendet.length, 0, "wirklich nichts");
// Die Gegenprobe: OHNE das Attribut schickt derselbe Klick sehr wohl.
gleich(garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), alle, 7, werkzeuge), "gesendet",
	"die Gegenprobe: ohne `disabled` geht derselbe Klick hinaus");
avesmapsGaretienAuswahlAufheben();
// Ein Klick daneben ebenso.
gleich(garetienAuswahlleisteKlick({ target: { closest: () => null } }, alle, 7, werkzeuge), null,
	"ein Klick neben die Leiste tut nichts");

console.log("OK -- " + checks + " Zusicherungen");
