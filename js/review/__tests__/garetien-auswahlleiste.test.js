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

const { api, dom } = ladeImporter(["garetien-auswahlleiste", "garetien-mark-all",
	// 🔴 Fixrunde 1 (C3): fuer Abschnitt 13 wird die Liste WIRKLICH gezeichnet -- nur so
	// entsteht der delegierte Zuhoerer auf der Leiste (garetienListeSkelettVerdrahten).
	"garetien-listcol", "garetien-tabs", "garetien-search", "garetien-chips",
	"garetien-neutral-hinweis", "garetien-anzeige-hinweis", "garetien-detailcol",
	"garetien-apply", "garetien-apply-hint", "garetien-zentrieren-alle", "garetien-anzeige-clear",
	"garetien-filter-toggle", "garetien-filter-menu"]);
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
	// 🔴 FIXRUNDE 1 (C1, 07.09.2026): der Verteiler reicht die ids GETRENNT heraus, weil der
	// Sender sie in Haeppchen zerlegt -- `api/edit/wiki/sync-plan.php` kappt eine laengere Liste
	// stillschweigend bei 200, und die Leiste meldete trotzdem die volle Zahl.
	sendenMenge: (rumpf, ids, meldung) => { gesendet.push({ rumpf, ids, meldung }); return "gesendet"; },
	fragen: (text) => { gefragt.push(text); return true; },
};

const ergebnisAblehnen = garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), alle, 7, werkzeuge);
gleich(ergebnisAblehnen, "gesendet", "der Klick geht durch die geteilte Tuer");
gleich(gesendet.length, 1, "genau einmal");
tief(gesendet[0].ids, [1],
	"💣 abgelehnt wird DIE AUSWAHL („Gramfeldermoor\"), nicht das Objekt der Einzelansicht");
gleich(gesendet[0].rumpf.action, "decline", "als Ablehnung");
gleich(gefragt.length, 1, "und vorher wird gefragt");
wahr(gefragt[0].includes("1 Objekt"), "die Rueckfrage nennt die Menge: " + gefragt[0]);
wahr(String(gesendet[0].meldung).includes("1 Objekt abgelehnt"),
	"und die Meldung reist MIT durch die Tuer: " + gesendet[0].meldung);

// „Nein" schickt nichts.
gesendet = []; gefragt = [];
gleich(garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), alle, 7,
	{ sendenMenge: werkzeuge.sendenMenge, fragen: () => false }), null, "ein „Nein\" schickt nichts");
gleich(gesendet.length, 0, "wirklich nichts");

// ⚠️ Objekte OHNE Item tragen nichts bei -- sie werden UEBERSPRUNGEN und in der Meldung GENANNT.
avesmapsGaretienAuswahlUmschalten("c");   // jetzt a + c gewaehlt
gesendet = []; gefragt = [];
garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), alle, 7, werkzeuge);
tief(gesendet[0].ids, [1], "das Objekt ohne Item traegt keine id bei");
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

// =================================================================================================
// 10. FIXRUNDE 1 / D1: JEDER Knopf der Leiste traegt das Wort „Auswahl".
// =================================================================================================
// 🔴 Vier von ihnen standen bis zum 07.09.2026 ZEICHENGLEICH auch in der Einzelansicht rechts und
// meinten dort etwas anderes: EIN Objekt statt der Auswahl. Genau diese Verwechslung ist die
// Owner-Meldung, die diesen ganzen Schritt ausgeloest hat.
["offen", "stage", "uebernommen", "abgelehnt"].forEach((stand) => {
	garetienAuswahlleisteZustand(stand, 2, [mitItem, ohneItem]).knoepfe.forEach((k) => {
		wahr(k.t1.indexOf("Auswahl") !== -1,
			"jeder Leistenknopf traegt „Auswahl\": " + stand + "/" + k.name + " -> " + k.t1);
	});
});
// 🔴 „Auswahl aus der Karte zurücknehmen" ist eine GEMESSENE ABWEICHUNG vom Auftrag, der schlicht
// „Auswahl zurücknehmen" verlangte: dieser Knopf steht auf dem Reiter „Übernommen" NEBEN „Auswahl
// aufheben", und „zurücknehmen" liest sich dort wie „die Auswahl zurückziehen". Genau diese
// Kollision hat die Fixrunde 2 zu Aufgabe 9 im Fuss schon einmal beseitigt (I4, „Import
// zurücknehmen" statt „Auswahl zurücknehmen") -- der gefaehrlichere der beiden Knoepfe muss sagen,
// WORAUS er zurueckholt.
{
	const uebernommen = garetienAuswahlleisteZustand("uebernommen", 2, [mitItem, ohneItem]);
	const namenDort = uebernommen.knoepfe.map((k) => k.t1);
	wahr(namenDort[0].indexOf("aus der Karte") !== -1,
		"💣 der Ruecknahme-Knopf sagt, WORAUS er zurueckholt: " + namenDort[0]);
	gleich(new Set(namenDort).size, namenDort.length,
		"…und keine zwei Knoepfe eines Reiters heissen gleich");
}

// =================================================================================================
// 11. FIXRUNDE 1 / C2: JEDER Knopf zaehlt ueber die Objekte, die er WIRKLICH bewegen kann.
// =================================================================================================
// 💣 Gemessen am 07.09.2026: Reiter „Übernommen", 3 gewaehlt, keines ruecknehmbar -- der Fussknopf
// stand gesperrt mit sichtbarem Grund, der Leistenknopf daneben BEDIENBAR und rot, und sein Klick
// blieb wortlos. Genau der stille Klick, den dieser Schritt beseitigen soll.
const uebernommenOhneRuecknahme = {
	key: "u1", stand: "uebernommen", name: "Nicht ruecknehmbar",
	// ⚠️ `felder: ["name","quelle"]`, NICHT nur "quelle" -- ein reines Quellen-Item waere
	// ruecknehmbar (garetienItemIstQuelleNur), und die Zusicherung darunter waere Vakuum.
	items: [{ id: 21, change_type: "changed", felder: ["name", "quelle"], apply_state: "done" }],
};
const uebernommenMitRuecknahme = {
	key: "u2", stand: "uebernommen", name: "Ruecknehmbar",
	items: [{ id: 22, change_type: "new", felder: [], apply_state: "done", entity_public_id: "Region-7" }],
};
{
	const nurUnruecknehmbar = garetienAuswahlleisteZustand("uebernommen", 3, [uebernommenOhneRuecknahme]);
	const r = nurUnruecknehmbar.knoepfe[0];
	gleich(r.name, "auswahl_ruecknahme");
	gleich(r.t2, "0 Objekte", "💣 gezaehlt wird, was WIRKLICH ruecknehmbar ist -- nicht die Auswahlgroesse");
	gleich(r.gesperrt, true, "…und dann ist der Knopf gesperrt statt bedienbar-und-wirkungslos");
	wahr(r.grund !== "", "…mit sichtbarem Grund: " + r.grund);
	// Die Gegenprobe: mit einem ruecknehmbaren Objekt geht er auf.
	const mitR = garetienAuswahlleisteZustand("uebernommen", 1, [uebernommenMitRuecknahme]).knoepfe[0];
	gleich(mitR.t2, "1 Objekt");
	gleich(mitR.gesperrt, false, "sonst waere die Sperre oben Vakuum");
	gleich(mitR.grund, "", "ein bedienbarer Knopf nennt keinen Grund");
	// „Zurück nach Offen" zaehlt seine eigene Menge -- ein 'new'-Objekt hat dort nichts.
	const zurueck = garetienAuswahlleisteZustand("uebernommen", 1, [uebernommenMitRuecknahme]).knoepfe[1];
	gleich(zurueck.name, "auswahl_zurueck_offen");
	gleich(zurueck.gesperrt, true, "ein neu angelegtes Objekt faellt nicht „zurück nach Offen\"");
	const zurueck2 = garetienAuswahlleisteZustand("uebernommen", 1, [uebernommenOhneRuecknahme]).knoepfe[1];
	gleich(zurueck2.gesperrt, false, "ein geaendertes schon -- sonst waere die Zeile darueber Vakuum");
}
// ⚠️ „Auswahl aufheben" ist der EINZIGE ohne Zaehler-Eintrag: er raeumt die ganze Auswahl ab, auch
// die Zeilen, die ein Filter ausblendet.
gleich(garetienAuswahlleisteZustand("offen", 3, []).knoepfe[2].gesperrt, false,
	"„Auswahl aufheben\" kann auch, wenn kein gewaehltes Objekt sichtbar ist");
gleich(garetienAuswahlleisteZustand("offen", 3, []).knoepfe[2].t2, "3 Objekte");
// …und „Auswahl auf die Stage" zaehlt ALLE gewaehlten (D4: auch ein Objekt ohne Vorschlag landet
// wirklich dort, „nur Ansicht") -- gemessen an der Menge, nicht an der Auswahlgroesse.
gleich(garetienAuswahlleisteZustand("offen", 2, [mitItem, ohneItem]).knoepfe[0].t2, "2 Objekte",
	"⚠️ „Auswahl auf die Stage\" zaehlt auch das Objekt ohne Vorschlag -- es landet wirklich dort");

// Der GRUND steht auch SICHTBAR im Markup, nicht nur im Zustand -- ein `title` an einem gesperrten
// Knopf erscheint in Chrome nie.
{
	const markup = garetienAuswahlleisteMarkup(
		garetienAuswahlleisteZustand("uebernommen", 3, [uebernommenOhneRuecknahme])
	);
	wahr(markup.indexOf('class="gi-auswahlleiste__grund"') !== -1,
		"der Grund steht als eigener Absatz unter den Knoepfen");
	wahr(markup.indexOf("data-grund=") !== -1,
		"💣 …und AM KNOPF, damit der Klickweg dieselbe Zeichenkette liest wie die Anzeige");
	// ⚠️ Entdoppelt: „Ablehnen" und „Wieder vorschlagen" teilen sich ihren Grund.
	const doppelt = garetienAuswahlleisteMarkup(garetienAuswahlleisteZustand("offen", 1, [ohneItem]));
	const treffer = doppelt.split('class="gi-auswahlleiste__grund"').length - 1;
	gleich(treffer, 1, "hoechstens EIN Grund-Absatz je Leiste");
	// Ein bedienbarer Knopf traegt gar kein data-grund.
	gleich(garetienAuswahlleisteMarkup(garetienAuswahlleisteZustand("offen", 1, [mitItem]))
		.indexOf("data-grund="), -1, "ein bedienbarer Knopf nennt keinen Grund");
}

// =================================================================================================
// 12. FIXRUNDE 1 / C2: DER STILLE AUSGANG DER LEISTE MELDET SEINEN GRUND.
// =================================================================================================
// 💣 `garetienStillerAusgangMelden` gab es nur im ANDEREN Klickweg (garetienHandlungKlick) --
// „eine Regel, die einen von zwei Klickwegen bindet, ist keine Regel".
const { garetienAuswahlStillerAusgangText, garetienStillerAusgangText } = api;
wahr(typeof garetienAuswahlStillerAusgangText === "function",
	"garetienAuswahlStillerAusgangText fehlt im Export");
const knopfAttrappe = (name, grund) => ({
	getAttribute: (a) => (a === "data-auswahl" ? name : (a === "data-grund" ? grund : null)),
});
{
	const text = garetienAuswahlStillerAusgangText(
		knopfAttrappe("auswahl_ruecknahme", "keines der gewählten Objekte lässt sich zurücknehmen")
	);
	wahr(text.indexOf("Auswahl aus der Karte zurücknehmen") !== -1,
		"die Meldung nennt den Knopf: " + text);
	wahr(text.indexOf("geht nicht") !== -1, "…und sagt, dass er nicht kann");
	wahr(text.indexOf("zurücknehmen") !== -1, "…und den Grund");
}
// 🔴 DER RIEGEL: nur ein Knopf, der einen GRUND nennt, meldet ihn auch. Ohne Grund bleibt es still.
gleich(garetienAuswahlStillerAusgangText(knopfAttrappe("auswahl_stage", "")), "",
	"🔴 ohne Grund keine Meldung -- eine erfundene waere schlimmer als keine");
gleich(garetienAuswahlStillerAusgangText(knopfAttrappe("auswahl_stage", null)), "");
gleich(garetienAuswahlStillerAusgangText(null), "", "und ohne Knopf erst recht nichts");
// ⚠️ Derselbe Riegel gilt seit jeher im anderen Klickweg -- er war bis zur Fixrunde 1 UNGEPRUEFT.
gleich(garetienStillerAusgangText("stage", { key: "x", name: "X", urteil: "neu", items: [] }), "",
	"🔴 auch dort: ein Knopf ohne Grund (der Vorwaertsknopf ist nie gesperrt) meldet nichts");
wahr(garetienStillerAusgangText("ablehnen", { key: "x", name: "X", urteil: "neu", items: [] })
	.indexOf("geht nicht") !== -1,
	"…und einer MIT Grund meldet ihn -- sonst waere die Zeile darueber Vakuum");

// Der ECHTE Klickweg schreibt ihn in die Statuszeile.
{
	avesmapsGaretienAuswahlAufheben();
	avesmapsGaretienAuswahlUmschalten("u1");
	dom.el("#garetien-status-text").textContent = "";
	const ereignisMitGrund = {
		target: {
			closest(sel) {
				return sel === "[data-auswahl]"
					? knopfAttrappe("auswahl_ruecknahme", "keines der gewählten Objekte lässt sich zurücknehmen")
					: null;
			},
		},
	};
	let ruecknahmeGerufen = 0;
	const ergebnis = garetienAuswahlleisteKlick(ereignisMitGrund, [uebernommenOhneRuecknahme], 7, {
		ruecknahme: () => { ruecknahmeGerufen++; return Promise.resolve(null); },
	});
	gleich(ergebnis, null, "der Klick richtet nichts aus");
	gleich(ruecknahmeGerufen, 0, "💣 …und geht gar nicht erst an den Verteiler");
	wahr(dom.text("#garetien-status-text").indexOf("geht nicht") !== -1,
		"💣 ABER ER SAGT ES: " + dom.text("#garetien-status-text"));
	avesmapsGaretienAuswahlAufheben();
}

// =================================================================================================
// 12b. SAMMELFIXRUNDE 07.09.2026 / BEFUND B: ALLE SECHS GRUND-TEXTE, WORTGENAU.
// =================================================================================================
// 💣 `auswahl_stage` und `auswahl_entstagen` grauten bei 0 aus, OHNE einen Grund zu nennen, und ihr
//   Klickweg meldete nichts -- waehrend die vier Nachbarn beides taten. Der Kommentar an
//   AVESMAPS_GARETIEN_AUSWAHL_GRUND behauptete, das koenne nicht sein („ihre Sperre heisst ‚nichts
//   gewaehlt', und dann gibt es die Leiste gar nicht"). Messbar falsch: die Auswahl UEBERLEBT einen
//   Filterwechsel (nur `garetienReiterSetzen` leert sie), die Leiste haengt an der GLOBALEN Auswahl,
//   diese zwei Knoepfe zaehlen ueber die SICHTBAREN.
// 🔴 UND ALLE SECHS WERDEN WORTGENAU FESTGENAGELT. Zwei der vier alten Texte waren UNGEPRUEFT: auf
//   `""` gesetzt blieb das Feld gruen (`auswahl_zurueck_offen`, `auswahl_wieder`) -- ein Grund, den
//   niemand misst, ist ein Grund, den niemand vermisst.
const GRUND_NICHT_SICHTBAR = "keines der gewählten Objekte steht in dieser Ansicht — "
	+ "ein Filter blendet sie gerade aus";
{
	// Der erreichbare Zustand: 3 global gewaehlt, KEINES davon in der Ansicht.
	const stageKnopf = garetienAuswahlleisteZustand("offen", 3, []).knoepfe[0];
	gleich(stageKnopf.name, "auswahl_stage");
	gleich(stageKnopf.t2, "0 Objekte", "gezaehlt wird ueber die SICHTBAR gewaehlten");
	gleich(stageKnopf.gesperrt, true, "…und dann ist der Knopf gesperrt");
	gleich(stageKnopf.grund, GRUND_NICHT_SICHTBAR, "💣 …MIT Grund, wie seine vier Nachbarn");

	const entstagenKnopf = garetienAuswahlleisteZustand("stage", 3, []).knoepfe[0];
	gleich(entstagenKnopf.name, "auswahl_entstagen");
	gleich(entstagenKnopf.grund, GRUND_NICHT_SICHTBAR, "💣 …und derselbe Fall auf dem Reiter Stage");

	// Gegenprobe, sonst waeren die zwei Zeilen darueber Vakuum: mit einem sichtbaren Objekt gehen
	// beide auf und nennen KEINEN Grund.
	gleich(garetienAuswahlleisteZustand("offen", 1, [mitItem]).knoepfe[0].gesperrt, false);
	gleich(garetienAuswahlleisteZustand("offen", 1, [mitItem]).knoepfe[0].grund, "");
	gleich(garetienAuswahlleisteZustand("stage", 1, [mitItem]).knoepfe[0].gesperrt, false);
	gleich(garetienAuswahlleisteZustand("stage", 1, [mitItem]).knoepfe[0].grund, "");

	// ---- Und die vier alten, wortgenau. -----------------------------------------------------------
	gleich(garetienAuswahlleisteZustand("offen", 1, [ohneItem]).knoepfe[1].grund,
		"keines der gewählten Objekte trägt einen Vorschlag", "auswahl_ablehnen");
	gleich(garetienAuswahlleisteZustand("abgelehnt", 1, [ohneItem]).knoepfe[0].grund,
		"keines der gewählten Objekte trägt einen Vorschlag", "auswahl_wieder");
	gleich(garetienAuswahlleisteZustand("uebernommen", 3, [uebernommenOhneRuecknahme]).knoepfe[0].grund,
		"keines der gewählten Objekte lässt sich zurücknehmen — sie haben ein bestehendes Objekt "
		+ "verändert", "auswahl_ruecknahme");
	gleich(garetienAuswahlleisteZustand("uebernommen", 1, [uebernommenMitRuecknahme]).knoepfe[1].grund,
		"keines der gewählten Objekte wurde übernommen", "auswahl_zurueck_offen");
}

// ---- Und der KLICKWEG der zwei meldet ihn auch -- ausgefuehrt, nicht gelesen. ------------------
// 💣 Bis zur Sammelfixrunde liefen beide Zweige auch mit leerer Liste durch und gaben
//   `{handlung, anzahl: 0}` zurueck: ein Klick, der nichts tut und nichts sagt.
{
	const knopfMitGrund = (name) => ({
		target: {
			closest(sel) {
				return sel === "[data-auswahl]"
					? {
						disabled: false,
						getAttribute: (attr) => (attr === "data-auswahl" ? name
							: (attr === "data-grund" ? GRUND_NICHT_SICHTBAR : null)),
					}
					: null;
			},
		},
	});
	["auswahl_stage", "auswahl_entstagen"].forEach(function (name) {
		avesmapsGaretienAuswahlAufheben();
		avesmapsGaretienStageLeeren();
		// Gewaehlt ist etwas -- es steht nur nicht in der hereingereichten (gefilterten) Ansicht.
		avesmapsGaretienAuswahlUmschalten("nicht-sichtbar");
		dom.el("#garetien-status-text").textContent = "";
		const ergebnis = garetienAuswahlleisteKlick(knopfMitGrund(name), [], 7, {});
		gleich(ergebnis, null, name + ": der Klick richtet nichts aus");
		gleich(avesmapsGaretienStageHat("nicht-sichtbar"), false, name + ": …und bewegt die Stage nicht");
		wahr(dom.text("#garetien-status-text").indexOf("geht nicht") !== -1,
			"💣 " + name + " SAGT ES: " + dom.text("#garetien-status-text"));
		wahr(dom.text("#garetien-status-text").indexOf(GRUND_NICHT_SICHTBAR) !== -1,
			"…mit demselben Satz, der sichtbar unter der Leiste steht");
	});
	// Gegenprobe: mit einem sichtbaren Objekt geht „Auswahl auf die Stage" den normalen Weg.
	avesmapsGaretienAuswahlAufheben();
	avesmapsGaretienStageLeeren();
	avesmapsGaretienAuswahlUmschalten("a");
	const echt = garetienAuswahlleisteKlick(knopfMitGrund("auswahl_stage"), [mitItem], 7, {});
	gleich(echt && echt.anzahl, 1, "sonst waere der stille Ausgang oben Vakuum");
	avesmapsGaretienStageLeeren();
	avesmapsGaretienAuswahlAufheben();
}

// =================================================================================================
// 13. FIXRUNDE 1 / C1: „Auswahl ablehnen" KAPPT NICHT MEHR -- und meldet nur, was wirklich geht.
// =================================================================================================
// 💣 `api/edit/wiki/sync-plan.php` schneidet `ids` bei AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT (200) ab,
// ohne Fehler und ohne Hinweis -- fuer `decline` UND `undecline`. Mit 250 gewaehlten Objekten stand
// „250 Objekte abgelehnt." da, waehrend 50 unberuehrt blieben. Die kleinste Zeilenstufe der Liste
// ist 1000; das ist der Normalfall, kein Randfall.
{
	const viele = [];
	for (let i = 0; i < 250; i++) {
		viele.push({ key: "v" + i, stand: "offen", urteil: "neu", name: "V" + i,
			items: [{ id: 1000 + i, change_type: "new" }] });
	}
	avesmapsGaretienAuswahlAufheben();
	viele.forEach((o) => avesmapsGaretienAuswahlUmschalten(o.key));
	const geschickt = [];
	const ergebnis = garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), viele, 7, {
		sendenMenge: (rumpf, ids, meldung) => { geschickt.push({ rumpf, ids, meldung }); return "ok"; },
		fragen: () => true,
	});
	gleich(ergebnis, "ok");
	gleich(geschickt.length, 1, "EIN Aufruf -- das Zerlegen macht der Sender, nicht der Verteiler");
	gleich(geschickt[0].ids.length, 250,
		"💣 ALLE 250 ids gehen hinaus -- vorher waren es 200, und gemeldet wurden trotzdem 250");
	wahr(String(geschickt[0].meldung).indexOf("250 Objekte abgelehnt") !== -1,
		"…und die Meldung stimmt damit wieder: " + geschickt[0].meldung);
	avesmapsGaretienAuswahlAufheben();
}
// Und der SENDER zerlegt wirklich -- ausgefuehrt, nicht gelesen.
(async function () {
	const { garetienMengeSendenMitMeldung } = api;
	wahr(typeof garetienMengeSendenMitMeldung === "function", "garetienMengeSendenMitMeldung fehlt");
	const rufe = [];
	const ids = [];
	for (let i = 1; i <= 450; i++) { ids.push(i); }
	dom.el("#garetien-status-text").textContent = "";
	await garetienMengeSendenMitMeldung(
		{ action: "decline", kind: "garetien", run_id: 7 }, ids, "450 Objekte abgelehnt.",
		function (rumpf) { rufe.push(rumpf); return Promise.resolve({ ok: true }); },
		// 💣 DER LISTENLAUF LEERT DIE STATUSZEILE -- genau das tut `avesmapsGaretienListeRendern`
		//    ueber `garetienStatusRuhe`. Ohne diese Zeile ist die Zusicherung darunter VAKUUM: eine
		//    Meldung, die VOR dem Listenlauf gesetzt wird, ueberlebt eine untaetige Attrappe genauso.
		//    Gemessen 07.09.2026 -- die Mutation „Meldung vor den Listenlauf" hatte den Test
		//    zunaechst ueberlebt.
		function () { dom.el("#garetien-status-text").textContent = ""; return Promise.resolve(null); }
	);
	gleich(rufe.length, 3, "💣 450 ids gehen in DREI Haeppchen zu hoechstens 200 hinaus");
	gleich(rufe[0].ids.length, 200);
	gleich(rufe[2].ids.length, 50);
	gleich(rufe.reduce((n, r) => n + r.ids.length, 0), 450, "…und keine einzige id faellt weg");
	gleich(rufe[0].action, "decline", "die uebrigen Felder des Rumpfes reisen unveraendert mit");
	gleich(dom.text("#garetien-status-text"), "450 Objekte abgelehnt.",
		"💣 die Meldung steht NACH dem Listenlauf -- davor setzte der Renderer sie sofort zurueck");

	// ===============================================================================================
	// 14. FIXRUNDE 1 / C3: DIE AUSWAHL UEBERLEBT DEN REITERWECHSEL NICHT -- am ECHTEN Zuhoerer.
	// ===============================================================================================
	// 💣 Entwurf §4 sagt es ausdruecklich: sie gehoert zur ANSICHT, nicht zum Objekt. Gemessen am
	// 07.09.2026: Reiter „Abgelehnt", 3 global gewaehlt, 0 davon sichtbar -> die Leiste stand da, ihr
	// Knopf war bedienbar, und der Klick blieb wortlos.
	const objekteFuerLauf = [
		{ key: "r1", stand: "offen", urteil: "neu", name: "R1", items: [{ id: 501, change_type: "new" }] },
		{ key: "r2", stand: "offen", urteil: "neu", name: "R2", items: [{ id: 502, change_type: "new" }] },
	];
	avesmapsGaretienAuswahlAufheben();
	avesmapsGaretienStageLeeren();
	// 🔴 Über die ECHTE Tür: `zustand.objekte` entsteht ausschliesslich in
	// `avesmapsGaretienListeHolen` -- ein blosses `avesmapsGaretienListeRendern` zeichnet zwar,
	// laesst den Modulzustand aber leer, und der Klickverteiler bekaeme eine leere Objektliste.
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: objekteFuerLauf, plan_run_id: 7 }) });
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
	const leisteEl = dom.el("#garetien-auswahlleiste");
	const zuhoerer = (leisteEl._hoerer.click || [])[0];
	wahr(typeof zuhoerer === "function",
		"die Leiste muss ueberhaupt einen delegierten Zuhoerer tragen -- sonst misst der Rest nichts");
	objekteFuerLauf.forEach((o) => avesmapsGaretienAuswahlUmschalten(o.key));
	gleich(api.avesmapsGaretienFensterZustand().auswahl.length, 2, "Zeuge: zwei sind gewaehlt");
	wahr(api.avesmapsGaretienFensterZustand().stand !== "stage", "Zeuge: und der Reiter steht woanders");
	zuhoerer(leistenEreignis("auswahl_stage"));
	gleich(api.avesmapsGaretienFensterZustand().stand, "stage",
		"der ECHTE Klick legt sie auf die Stage und wechselt den Reiter");
	gleich(api.avesmapsGaretienFensterZustand().auswahl.length, 0,
		"💣 UND DIE AUSWAHL IST DANACH LEER -- sie gehoert der Ansicht (Entwurf §4)");
	gleich(avesmapsGaretienStageHat("r1"), true, "…die Objekte liegen aber sehr wohl auf der Stage");
	avesmapsGaretienStageLeeren();
	avesmapsGaretienAuswahlAufheben();

	console.log("OK -- " + checks + " Zusicherungen");
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
