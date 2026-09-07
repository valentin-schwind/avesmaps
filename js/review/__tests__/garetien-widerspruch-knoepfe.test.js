// Der Artikel-Widerspruch bekommt seine zwei Knöpfe zurück -- die NAHT zwischen Planbau und
// Knopfleiste.
//
// 🔴 DIE FALLE, DIE DIESEN FALL ERZEUGT HAT: beide Hälften waren für sich richtig, nur die Naht
// dazwischen nicht. Die Anzeige-Tafel (AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL) bietet dem Urteil
// „widerspruch" seit langem `["quelle", "neu", "ablehnen"]` an -- mit dem Owner-Zitat darüber:
// „widerspricht ist kein grund, dass es nicht trotzdem eingefügt werden darf". Der Planbau baute
// aber nie ein Item, das diese zwei Knöpfe hätten finden können: der Artikel-Widerspruch wurde ein
// einzelnes 'changed' OHNE geschriebenes Feld. Beide Knöpfe standen also da und waren beide
// ausgegraut -- und das sah aus wie ein Verbot, obwohl es eine Lücke war.
//
// Owner 02.09.2026, Fall „Drommsel": „ich kanns aber nicht importieren, weil du denkst, es ist
// falsch."
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-widerspruch-knoepfe.test.js

"use strict";

const assert = require("assert");
const path = require("path");

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { garetienHandlungen } = mod;

let checks = 0;
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function tief(ist, soll, warum) {
	assert.deepStrictEqual(ist, soll, warum);
	checks++;
}
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}

assert.strictEqual(typeof garetienHandlungen, "function",
	"garetienHandlungen muss exportiert sein");

function knopf(objekt, name) {
	const treffer = garetienHandlungen(objekt).filter(function (h) { return h.name === name; });
	assert.strictEqual(treffer.length, 1, "genau ein Knopf „" + name + "\"");
	return treffer[0];
}

// Die Drommsel, wie sie aus garetien-liste.php kommt: unser Fluss ist getroffen (der Artikel
// trifft), ihre Geometrie liegt 25 Meilen daneben.
const DROMMSEL = {
	key: "ggp|Gewaesser|Drommsel",
	name: "Drommsel",
	urteil: "widerspruch",
	stand: "offen",
	grund: "Artikel trifft „Drommsel“, liegt aber 25,0 Meilen entfernt",
	abschnitte: [{ public_id: "a771eba8", name: "Drommsel", punkte: 16 }],
	// Der heutige Stand: GENAU EIN Item -- der Einzeleintrag des Planbaus. Er ist ein 'changed'
	// auf unser getroffenes Objekt und schreibt KEIN Feld. Deshalb war „Ablehnen" bedienbar (es
	// gibt ein Item, auf das der Vermerk zeigen kann) und die zwei schreibenden Knöpfe nicht.
	items: [{
		id: 4710, change_type: "changed", anlass: "artikel_widerspruch", felder: [],
		selected: 0, abschnitt: null,
	}],
};

// =================================================================================================
// 1. DER ZUSTAND, DEN DER OWNER GEMELDET HAT
// =================================================================================================
// 💣 DIESE HÄLFTE MUSS ROT WERDEN, WENN JEMAND DEN PLANBAU ZURÜCKDREHT. Mit dem toten
// Einzeleintrag allein sind beide schreibenden Knöpfe gesperrt -- die Zeile hat dann nur
// „Ablehnen", und genau das war die Sackgasse. Der Test hält den Zustand fest, damit die
// Zusicherung darunter etwas bedeutet.
// 🔴 UMGEBAUT AM 07.09.2026: „Neu einfügen" und „Bei X Quelle + Artikel einfügen" sind gefallen
// (Owner-Punkt 12) -- angelegt wird ueber die Stage. Gemessen wird derselbe Sachverhalt jetzt an
// den ITEMS, die der Stage-Import wirklich schreibt (`garetienStageUebernahmeIds`), statt an zwei
// Knoepfen, die es nicht mehr gibt. Die Aussage ist dieselbe: mit dem toten Einzeleintrag gibt es
// nichts anzulegen und nichts zu ergaenzen.
tief(mod.garetienStageUebernahmeIds([DROMMSEL]), [4710],
	"mit dem toten Einzeleintrag traegt die Stage nur den Vermerk selbst");
gleich(mod.garetienHakenItems(DROMMSEL).filter(function (i) {
	return String(i.change_type) === "new";
}).length, 0, "…und KEIN anzulegendes Objekt -- genau das war die Sackgasse");
gleich(knopf(DROMMSEL, "ablehnen").disabled, false, "„Ablehnen\" ging schon immer");
gleich(knopf(DROMMSEL, "stage").disabled, false,
	"und ansehen darf man die Zeile auch dann -- der Vorwaertsknopf ist nie gesperrt");

// =================================================================================================
// 2. MIT DEN ZWEI ITEMS AUS DEM VIERTEN AUSGANG
// =================================================================================================
// Genau die Form, die avesmapsGaretienEintraegeFuerUrteil seit dem 02.09.2026 liefert:
// ein Lücken-Item (Quelle, an UNSEREM getroffenen Objekt) und ein Zusatz-Item („trotzdem neu
// anlegen", `entity_public_id` NULL).
const MIT_ANGEBOTEN = Object.assign({}, DROMMSEL, {
	items: [
		{
			id: 4711, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"],
			selected: 1, abschnitt: { public_id: "a771eba8", name: "Drommsel" },
		},
		{
			id: 4712, change_type: "new", anlass: "zusatz", felder: [],
			selected: 0, abschnitt: null,
		},
	],
});

// 🔴 Die Quellen-Ergaenzung erreicht die Karte weiterhin -- ueber die Stage. Genau das war die
// Messung, mit der „Bei X Quelle + Artikel einfügen" am 07.09.2026 gestrichen werden DURFTE:
// `garetienStageUebernahmeIds` traegt das Luecken-Item, und der Server nimmt es an
// (AVESMAPS_GARETIEN_ERGAENZUNG_FELDER, garetien-uebernahme.php).
tief(mod.garetienStageUebernahmeIds([MIT_ANGEBOTEN]), [4711],
	"🔴 die Quelle an unserem Fluss reist ueber die Stage -- sonst waere die Handlung unerreichbar");

// 💣 UND DAS ZUSATZ-ITEM REIST NICHT MIT. `garetienHakenItems` schliesst es aus -- das ist der
// Riegel aus dem Schadensfall vom 30.08.2026 (3007 Objekte, viele davon Dubletten), und er gilt
// unveraendert: ein Sammellauf darf nie gleichzeitig unser Objekt aendern UND eine Dublette
// danebenlegen.
// 🔧 OFFEN, und beim Streichen von „Neu einfügen" am 07.09.2026 ausdruecklich gemessen: damit hat
// das Zusatz-Item („trotzdem neu anlegen") derzeit GAR KEINEN Erzeuger mehr -- sein einziger war
// jener Knopf. Es kommt zurueck, sobald die Stage je Objekt eine FORM traegt (Entwurf §5.1); bis
// dahin ist die sichere Richtung, dass keine Dublette entsteht.
gleich(mod.garetienStageUebernahmeIds([MIT_ANGEBOTEN]).indexOf(4712), -1,
	"💣 das Zusatz-Item bleibt aussen vor -- der Riegel des Schadensfalls vom 30.08.2026");
gleich(mod.garetienHakenItems(MIT_ANGEBOTEN).length, 1,
	"💣 genau EIN Item traegt die Stage: das Luecken-Item");

// =================================================================================================
// 3. DER ZUFLUSS BLEIBT, WIE ER WAR
// =================================================================================================
// ⚠️ Er ist im Staging derselbe 'widerspricht', steht aber unter „zweifel" und hat seit jeher
// genau einen Ausgang: sein eigenes 'new'. Ein Quellen-Knopf an ihm schriebe auf SEINEN
// HAUPTFLUSS -- deshalb geht er gar nicht erst durch den vierten Ausgang.
const ZUFLUSS = {
	key: "ggp|Gewaesser|Seitenarm", name: "Seitenarm der Alke", urteil: "zweifel", stand: "offen",
	abschnitte: [],
	items: [{ id: 815, change_type: "new", anlass: null, felder: [], selected: 0 }],
};
tief(mod.garetienStageUebernahmeIds([ZUFLUSS]), [815],
	"der Zufluss lässt sich weiter anlegen -- sein eigenes 'new' reist ueber die Stage");
gleich(garetienHandlungen(ZUFLUSS).filter(function (h) { return h.name === "quelle"; }).length, 0,
	"⚠️ und bekommt keinen Quellen-Knopf (den gibt es seit dem 07.09.2026 nirgends mehr)");

console.log("OK garetien-widerspruch-knoepfe: " + checks + " Zusicherungen");
