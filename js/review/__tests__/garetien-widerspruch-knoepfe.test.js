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
gleich(knopf(DROMMSEL, "neu").disabled, true,
	"mit dem toten Einzeleintrag ist „Neu einfügen\" gesperrt");
gleich(knopf(DROMMSEL, "quelle").disabled, true, "und „Quelle + Artikel einfügen\" auch");
wahr(knopf(DROMMSEL, "neu").grund !== "", "💣 und beide sagen, warum -- ein Knopf ohne Grund ist "
	+ "von einem kaputten Knopf nicht zu unterscheiden");
wahr(knopf(DROMMSEL, "quelle").grund !== "", "auch der zweite");
gleich(knopf(DROMMSEL, "ablehnen").disabled, false, "„Ablehnen\" ging schon immer");

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

gleich(knopf(MIT_ANGEBOTEN, "neu").disabled, false,
	"🔴 „Neu einfügen\" ist bedienbar -- ihr Verlauf lässt sich als eigenes Objekt anlegen");
gleich(knopf(MIT_ANGEBOTEN, "quelle").disabled, false,
	"🔴 und „Quelle + Artikel einfügen\" trägt die Quelle an unserem Fluss nach");

// 🔴 DAS ZUSATZ-ITEM IST NIE VORANGEHAKT (Owner: „darf niemals vorangehakt sein"). Eine Dublette
// anzulegen ist die begründete Ausnahme, nicht der bequeme Weg.
gleich(knopf(MIT_ANGEBOTEN, "neu").angehakt, 0, "„Neu einfügen\" startet ungehakt");
// ⚠️ Die Quelle dagegen ist vorangehakt: sie füllt eine LÜCKE und überschreibt nichts.
gleich(knopf(MIT_ANGEBOTEN, "quelle").angehakt, 1, "die Quelle ist vorangehakt");

// 💣 „Quelle" darf das Zusatz-Item NICHT mitnehmen und „neu" nicht das Lücken-Item -- sonst
// änderte ein Klick gleichzeitig unser Objekt UND legte eine Dublette daneben (der Schadensfall
// vom 30.08.2026, 3007 Objekte).
gleich(knopf(MIT_ANGEBOTEN, "quelle").gesamt, 1, "💣 „Quelle\" fasst nur das Lücken-Item");
gleich(knopf(MIT_ANGEBOTEN, "neu").gesamt, 1, "💣 und „Neu einfügen\" nur das Zusatz-Item");

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
gleich(knopf(ZUFLUSS, "neu").disabled, false, "der Zufluss lässt sich weiter anlegen");
gleich(garetienHandlungen(ZUFLUSS).filter(function (h) { return h.name === "quelle"; }).length, 0,
	"⚠️ und bekommt keinen Quellen-Knopf");

console.log("OK garetien-widerspruch-knoepfe: " + checks + " Zusicherungen");
