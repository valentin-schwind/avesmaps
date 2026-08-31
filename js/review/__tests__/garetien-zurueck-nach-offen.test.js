// „Übernommen" zurück nach „Offen" verschieben -- ohne ein Kartenobjekt anzufassen.
//
// Owner 31.08.2026: „die hier sollen zurück nach 'offen' wandern" und, nach der Frage nach den
// Geometrien: „ich glaube geometrien haben sich nicht verändert wir wollen aber 'Übernommen'
// zurück nach 'Offen' verschieben können."
//
// 🔴 DER UNTERSCHIED ZUR RÜCKNAHME IST DAS OBJEKT. Die Rücknahme LÖSCHT, was der Import angelegt
// hat; dieser Knopf löscht nichts. Er setzt `apply_state`, das Häkchen und den dauerhaften Vermerk
// zurück -- mehr nicht.
//
// 💣 DESHALB GILT ER NUR FÜR 'changed'-ITEMS. Ein 'new'-Item hat ein Objekt auf die Karte gebracht;
// es einfach nach „Offen" zurückzuschieben ließe das Objekt dort und böte an, es ein zweites Mal
// anzulegen -- eine Dublette, die niemand mehr als solche erkennt.
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-zurueck-nach-offen.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const tief = (ist, soll, warum) => { assert.deepStrictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById() { return null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienHandlungen, garetienHandlungsMarkup, garetienHandlungsRumpf,
	garetienZurueckOffenBauen, garetienZurueckOffenItems, garetienZurueckOffenKlick,
} = mod;

const namen = (o) => garetienHandlungen(o).map((k) => k.name);

// ---- Eine DOM-Attrappe, deren `closest` mehrere Alternativen versteht ---------------------------
function ziel(handlung, key) {
	const knoten = {
		disabled: false, textContent: "",
		getAttribute(n) {
			return n === "data-handlung" ? handlung : (n === "data-key" ? key : null);
		},
	};
	knoten.closest = function (auswahl) {
		const teile = String(auswahl).split(",").map((t) => t.trim());
		return teile.indexOf('[data-handlung="' + handlung + '"]') !== -1 ? knoten : null;
	};
	return knoten;
}

// =================================================================================================
// 1. Genau der Fall des Owners: übernommen, aber nichts angelegt
// =================================================================================================
// Seine sieben Zeilen sagen „Ergänzung · Geometrie liegt 0.00 Einheiten von '<gleicher Name>'" --
// sie haben ein BESTEHENDES Objekt beschrieben. „Zurücknehmen" ist dort leer („Keines der
// markierten Objekte lässt sich zurücknehmen"), und genau diese Lücke schließt dieser Knopf.
const nurGeaendert = {
	key: "gi:blutmoor", name: "Blutmoor", urteil: "ergaenzung", stand: "uebernommen",
	geometrie_typ: "Polygon",
	items: [{ id: 801, change_type: "changed", apply_state: "done", anlass: "geometrie",
		felder: ["geometrie"], selected: 0 }],
};
tief(namen(nurGeaendert), ["ruecknahme", "zurueck_offen"],
	"„Zurücknehmen\" steht (gesperrt, mit Grund) und „Zurück nach Offen\" daneben");
gleich(garetienZurueckOffenBauen(nurGeaendert).disabled, false, "und er ist bedienbar");
tief(garetienZurueckOffenBauen(nurGeaendert).ids, [801], "mit der id des übernommenen Items");
gleich(garetienZurueckOffenBauen(nurGeaendert).beschriftung, "Zurück nach Offen",
	"und trägt, was er tut");

// 💣 „Ablehnen" steht NICHT dabei: es kann nur, was sich auch zurücknehmen lässt, und hier lässt
// sich nichts zurücknehmen. Ohne diese Zeile könnte der neue Knopf die alte Regel aufgeweicht
// haben, ohne dass es auffällt.
wahr(!namen(nurGeaendert).includes("ruecknahme_ablehnen"),
	"was sich nicht zurücknehmen lässt, lässt sich auch nicht ablehnen: " + namen(nurGeaendert));

// --- Und im Markup steht er als echter Knopf, ohne Gefahrenfarbe: er löscht nichts.
const markup = garetienHandlungsMarkup(nurGeaendert);
wahr(/data-handlung="zurueck_offen"/.test(markup), "der Knopf steht im Markup: " + markup);
wahr(!/btn--danger[^>]*data-handlung="zurueck_offen"/.test(markup),
	"🔴 und NICHT in Gefahrenfarbe -- er nimmt nichts von der Karte");

// =================================================================================================
// 2. 💣 EIN ANGELEGTES OBJEKT BEKOMMT IHN NICHT
// =================================================================================================
// Es einfach nach „Offen" zurückzuschieben ließe das Objekt auf der Karte und böte an, es ein
// zweites Mal anzulegen. Dafür gibt es „Zurücknehmen", das beides zusammen tut.
const angelegt = {
	key: "gi:neu", name: "Praioslob", urteil: "neu", stand: "uebernommen", geometrie_typ: "Point",
	items: [{ id: 901, change_type: "new", apply_state: "done", selected: 0 }],
};
tief(garetienZurueckOffenItems(angelegt), [], "ein 'new'-Item ist keine Buchführungs-Sache");
gleich(garetienZurueckOffenBauen(angelegt), null, "und der Knopf entsteht gar nicht erst");
wahr(!namen(angelegt).includes("zurueck_offen"),
	"er steht bei einem angelegten Objekt nicht in der Leiste: " + namen(angelegt));
// ⚠️ Die Gegenprobe: dort ist „Zurücknehmen" der richtige Weg und auch bedienbar -- sonst hätte
// dieses Objekt gar keinen Ausgang mehr.
wahr(namen(angelegt).includes("ruecknahme"), "dort ist „Zurücknehmen\" der Weg");

// --- 🪤 Ein GEMISCHTES Objekt: ein angelegtes UND ein änderndes Item. Der Knopf nimmt NUR das
// ändernde mit -- schöbe er beide zurück, stünde das angelegte Objekt weiter auf der Karte.
const gemischt = {
	key: "gi:misch", name: "Zweiteiler", urteil: "ergaenzung", stand: "uebernommen",
	items: [
		{ id: 911, change_type: "new", apply_state: "done", selected: 0 },
		{ id: 912, change_type: "changed", apply_state: "done", anlass: "geometrie",
			felder: ["geometrie"], selected: 0 },
	],
};
tief(garetienZurueckOffenBauen(gemischt).ids, [912],
	"💣 nur das ändernde Item wandert zurück, nie das angelegte");

// --- ⚠️ Ein Item, das nie übernommen wurde, ist schon dort, wo es hin soll.
tief(garetienZurueckOffenItems({
	items: [{ id: 921, change_type: "changed", apply_state: null, selected: 1 }],
}), [], "ein nie übernommenes Item wandert nicht");

// =================================================================================================
// 3. Der Klickverteiler -- am ERGEBNIS gemessen
// =================================================================================================
let gesendet = [];
const senden = (ids, runId) => { gesendet.push([ids, runId]); return "verschoben"; };
const objekte = [nurGeaendert, angelegt, gemischt];

gleich(garetienZurueckOffenKlick({ target: ziel("zurueck_offen", nurGeaendert.key) }, objekte, 7, senden),
	"verschoben", "der Klick schickt und reicht sein Ergebnis durch");
tief(gesendet[0], [[801], 7], "mit genau den ids dieses Objekts und der Lauf-Nummer");

// 💣 OHNE RÜCKFRAGE, und das ist Absicht: hier verschwindet nichts. Eine Rückfrage vor einer
// folgenlosen Handlung lehrt, Rückfragen wegzuklicken -- und die eine, die zählt, steht direkt
// daneben am „Zurücknehmen". Gemessen daran, dass der Verteiler gar keinen Frage-Parameter nimmt.
gleich(garetienZurueckOffenKlick.length, 4,
	"der Verteiler nimmt Ereignis, Objekte, Lauf und Sender -- KEINE Rückfrage");

// --- Ein fremder Knopf lässt ihn kalt (sonst fingen zwei Verteiler denselben Klick).
gesendet = [];
gleich(garetienZurueckOffenKlick({ target: ziel("ruecknahme", nurGeaendert.key) }, objekte, 7, senden),
	null, "ein Klick auf „Zurücknehmen\" gehört dem anderen Verteiler");
gleich(gesendet.length, 0, "und schickt hier nichts");

// --- 🔴 UND ER GEHT NIE ÜBER DIE GETEILTE TÜR HINAUS. Fände er in garetienHandlungsRumpf einen
// Rumpf, fiele der Klick bis zu garetienHandlungKlick durch und verschickte ein sinnloses `select`
// an sync-plan.php -- zwei Erzeuger für denselben Knopf.
gleich(garetienHandlungsRumpf("zurueck_offen", nurGeaendert, 7), null,
	"„Zurück nach Offen\" hat hier keinen Rumpf -- es hat seine eigene Tür");

// =================================================================================================
// 4. 🔴 DIE EIGENE TÜR, UND SIE FASST KEIN KARTENOBJEKT AN
// =================================================================================================
const quelle = ohneKommentare(lies("js", "review", "review-garetien-importer.js"));
wahr(/action: "zurueck_offen"/.test(quelle),
	"der Sender ruft die eigene Aktion, nicht die geteilte Übernahme-Vorschau");
const senderRumpf = quelle.slice(quelle.indexOf("function garetienZurueckOffenSenden"));
wahr(/GARETIEN_ENDPUNKT/.test(senderRumpf.slice(0, senderRumpf.indexOf("\n\t}"))),
	"💣 an GARETIEN_ENDPUNKT, nicht an GARETIEN_PLAN_ENDPUNKT -- was die Staging-Tabellen dieses "
	+ "Imports kennt, bleibt im Importer (Abbau-Bedingung §5.5)");
// 💣 UND DER KLICK IST WIRKLICH VERDRAHTET. Ohne diese Zeile könnte der Verteiler tadellos sein
// und von niemandem gerufen werden -- dieselbe Lücke, die in diesem Fenster schon mehrfach
// aufgetreten ist.
wahr(/garetienZurueckOffenKlick\(ereignis, zustand\.objekte, zustand\.planRunId,\s*garetienZurueckOffenSenden\)/
	.test(quelle), "der Klickverteiler ist in bindFenster verdrahtet");

// --- 🔴 SERVERSEITIG DERSELBE RIEGEL. Eine Sperre nur im Browser ist keine.
const server = ohneKommentare(lies("api", "_internal", "import", "garetien-uebernahme.php"));
const funktion = server.slice(server.indexOf("function avesmapsGaretienZurueckAufOffen"));
const rumpf = funktion.slice(0, funktion.indexOf("\n}"));
wahr(/change_type'\] !== 'changed'/.test(rumpf),
	"der Server lässt nur 'changed'-Items zurückwandern: " + rumpf);
// 💣 UND ER LÖSCHT NICHTS. Das ist die tragende Zusicherung dieser Funktion -- ein `DELETE` oder
// ein `is_active = 0` darin wäre genau das, was der Owner ausgeschlossen hat.
wahr(!/DELETE|is_active\s*=\s*0|avesmapsDeleteMapFeature/i.test(rumpf),
	"🔴 sie fasst KEIN Kartenobjekt an: " + rumpf);

console.log(`garetien-zurueck-nach-offen: ${checks} Pruefungen bestanden.`);
