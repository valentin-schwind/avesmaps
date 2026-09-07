// Sammelfixrunde 07.09.2026, Befund A: DIE WAHL AUS „Wird eingefügt" ERREICHT DEN SERVER.
//
// 💣 GEMESSEN VOR DIESER RUNDE, end-zu-ende:
//     Editor waehlt „Berggipfel"  ->  Knopf sagt „als berggipfel"
//     Stage-Import sendet         :  {"action":"apply","kind":"garetien","run_id":73,"ids":[1]}
//                                    einstellungen: FEHLT · einstellungen_je_item: FEHLT
//     Server                      :  $einstellungen === null  =>  Vorgabe der Art
//     Angelegt                    :  region/gebirge
//   `garetienEingabenFuerServer` hatte KEINEN lebenden Aufrufer mehr. Bis „Neu einfügen" fiel, trug
//   jener Einzelknopf die Wahl mit; der Stage-Import tat es nie. Damit war Punkt 6 der Owner-Liste
//   („dass ein fluss ein bach werden kann") wirkungslos, waehrend die Anzeige das Gegenteil sagte.
//
// 🔴 DIESER TEST LIEST DEN AUSGEFUEHRTEN ANFRAGERUMPF, NICHT DIE VERDRAHTUNG. Ein Quelltexttest
//   („der Fussknopf nennt garetienStageEinstellungenJeItem") kennt keinen Geltungsbereich und
//   haette den Befund nie gefunden: der Aufruf stand ja nirgends. Gefahren wird deshalb
//   `garetienFussknopfKlick` mit einem Spion-`rufe`, und geprueft wird, was in `apply` steht.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-stage-import-rumpf.test.js
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet -- `global.document`
// muss deshalb VOR dem `require` stehen (Vorbild: garetien-naehe-markieren.test.js).

"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }

// ---- Das gefälschte `document`/`window` -- VOR jedem require. ---------------------------------
function macheElement(id) {
	return {
		id: id, hidden: true, disabled: false, innerHTML: "", textContent: "",
		addEventListener() {}, removeEventListener() {},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		contains() { return true; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}
const ELEMENTE = {};
["garetien-detailcol", "garetien-list", "garetien-status-text"].forEach((id) => {
	ELEMENTE[id] = macheElement(id);
});

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const modul = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienStageEinstellungenJeItem,
	garetienEinstellungenJeItemFuerHaeppchen,
	garetienFussknopfKlick,
	garetienZielWahlZu,
	garetienZielWahlVergessen,
} = modul;

wahr(typeof garetienStageEinstellungenJeItem === "function",
	"garetienStageEinstellungenJeItem fehlt im Export");
wahr(typeof garetienEinstellungenJeItemFuerHaeppchen === "function",
	"garetienEinstellungenJeItemFuerHaeppchen fehlt im Export");
wahr(typeof garetienFussknopfKlick === "function", "garetienFussknopfKlick fehlt im Export");

// Ein Objekt so, wie es aus `garetien-liste.php` kommt: Vorschlag (`ziel`/`subtyp`/`kind`) plus
// seine Items. `change_type: "new"` heisst „legt ein Kartenobjekt an".
function objekt(key, ziel, subtyp, itemId, changeType) {
	return {
		key: key, name: key, typ: "Gewaesser", urteil: "neu",
		ziel: ziel, subtyp: subtyp, kind: "",
		items: [{ id: itemId, change_type: changeType || "new", felder: [] }],
	};
}

// =================================================================================================
// A. garetienStageEinstellungenJeItem -- JEDES ITEM BEKOMMT DEN RUMPF SEINES OBJEKTS
// =================================================================================================
garetienZielWahlVergessen();
{
	const a = objekt("a", "region", "sumpf", 1);
	const b = objekt("b", "region", "gebirge", 2);
	// Die Wahl des Editors: `garetienZielWahlZu` liefert den zwischengespeicherten, VERAENDERBAREN
	// Stand -- genau so schreibt auch das <select> der Detailspalte hinein (garetienEingabenAendern,
	// Zweig "zielForm"/"zielArt").
	const wahlA = garetienZielWahlZu(a);
	wahlA.ziel = "path"; wahlA.subtyp = "Flussweg"; wahlA.kind = "";
	const wahlB = garetienZielWahlZu(b);
	wahlB.ziel = "label"; wahlB.subtyp = "berggipfel"; wahlB.kind = "";

	const jeItem = garetienStageEinstellungenJeItem([a, b]);
	tief(Object.keys(jeItem).sort(), ["1", "2"], "je Item ein Eintrag: " + JSON.stringify(jeItem));
	gleich(jeItem["1"].ziel, "path", "Item 1 traegt die Wahl SEINES Objekts");
	gleich(jeItem["1"].subtyp, "Flussweg", "…samt Art");
	gleich(jeItem["2"].ziel, "label", "Item 2 traegt die Wahl SEINES Objekts");
	gleich(jeItem["2"].subtyp, "berggipfel", "…samt Art (der gemeldete Fall: Berggipfel)");
	// 💣 DIE DIFFERENZ IST DIE ZUSICHERUNG: b darf NICHT die Wahl von a tragen. Genau das taete ein
	// gemeinsamer `einstellungen`-Rumpf, und genau deshalb gibt es `einstellungen_je_item`.
	wahr(jeItem["1"].ziel !== jeItem["2"].ziel,
		"zwei Objekte, zwei Rumpfe -- kein gemeinsamer Rumpf ueber die ganze Stage");
	// Die Schluessel sind ZEICHENKETTEN: JSON kennt keine Zahlen als Objektschluessel, und
	// avesmapsGaretienEinstellungenJeItemAusRumpf normalisiert sie serverseitig per (int).
	gleich(typeof Object.keys(jeItem)[0], "string", "die Schluessel sind Zeichenketten");
}

// ---- Ein Objekt OHNE 'new'-Item traegt KEINEN Eintrag ------------------------------------------
// ⚠️ „Nicht genannt" und „ausdruecklich leer" duerfen nicht dasselbe werden: ohne Eintrag faellt
// der Server wie bisher auf die Vorgabe der Art zurueck.
garetienZielWahlVergessen();
{
	const ohneItems = { key: "c", name: "C", ziel: "region", subtyp: "sumpf", items: [] };
	tief(garetienStageEinstellungenJeItem([ohneItems]), {},
		"ein Objekt ohne Vorschlag ist gar nicht dabei");
	// 💣 EIN 'changed'-ITEM EBENSO WENIG, und das ist eine GEMESSENE Verengung:
	// `avesmapsGaretienZielUebersteuern` laeuft serverseitig ueber JEDES Item und formt bei
	// abweichendem `ziel` die Geometrie um -- an einer Namens-/Quellen-Ergaenzung eines
	// BESTEHENDEN Objekts waere das ein Umbau, den niemand bestellt hat. Der Kasten heisst „Wird
	// eingefügt" und beschreibt, was NEU entsteht.
	const ergaenzung = objekt("d", "region", "sumpf", 4, "changed");
	tief(garetienStageEinstellungenJeItem([ergaenzung]), {},
		"eine Ergaenzung an einem bestehenden Objekt bekommt keine Handeingabe");
	// Gegenprobe, sonst waere die Zeile darueber Vakuum: dasselbe Objekt als 'new' ist dabei.
	const neu = objekt("d2", "region", "sumpf", 5, "new");
	tief(Object.keys(garetienStageEinstellungenJeItem([neu])), ["5"],
		"…ein 'new'-Item desselben Zuschnitts sehr wohl");
	tief(garetienStageEinstellungenJeItem(null), {}, "keine Liste, kein Eintrag");
	tief(garetienStageEinstellungenJeItem([null]), {}, "und ein leerer Platz bricht nichts");
}

// ---- Und die Abweichung, die die Verengung begruendet: der Kasten schlaegt den Planeintrag ------
// `garetienZielVorbelegung` traegt die Bergfamilien-Regel (eine kleine Gebirgs-/Huegelflaeche wird
// ein Gipfel), der Planeintrag `after.ziel` nicht -- die zwei koennen also wirklich auseinanderlaufen.
garetienZielWahlVergessen();
{
	const kleinesGebirge = {
		key: "berg", name: "Kleiner Buckel", typ: "Gebirge", urteil: "neu",
		ziel: "region", subtyp: "gebirge", kind: "topographie",
		// Ein Ring von rund 0,25 Meilen² -- unter der Schwelle von 5.
		geometrie: [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]],
		items: [{ id: 77, change_type: "new", felder: [] }],
	};
	gleich(garetienZielWahlZu(kleinesGebirge).ziel, "label",
		"💣 die Vorbelegung weicht vom Planeintrag ab (region -> label) -- genau deshalb darf ein "
		+ "'changed'-Item diesen Rumpf nicht bekommen");
	gleich(String(kleinesGebirge.ziel), "region", "…waehrend der Planeintrag weiter 'region' sagt");
}

// =================================================================================================
// B. garetienEinstellungenJeItemFuerHaeppchen -- NUR die Items DIESES Haeppchens
// =================================================================================================
{
	const alle = { "1": { ziel: "path" }, "2": { ziel: "label" }, "3": { ziel: "region" } };
	tief(garetienEinstellungenJeItemFuerHaeppchen(alle, [1, 3]),
		{ "1": { ziel: "path" }, "3": { ziel: "region" } },
		"💣 das Haeppchen bekommt nur seine eigenen Eintraege");
	gleich(garetienEinstellungenJeItemFuerHaeppchen(alle, [9]), null,
		"🔴 ein Haeppchen ohne Eintrag bekommt `null`, kein leeres Objekt -- der Server liest `{}` "
		+ "als „kein Aufrufer dieser Aufgabe\" und fiele auf den gemeinsamen Rumpf zurueck");
	gleich(garetienEinstellungenJeItemFuerHaeppchen(null, [1]), null, "ohne Woerterbuch: null");
	gleich(garetienEinstellungenJeItemFuerHaeppchen(alle, []), null, "ohne ids: null");
}

// =================================================================================================
// C. DER AUSGEFUEHRTE ANFRAGERUMPF -- der Kern des Befunds
// =================================================================================================
// Ein Spion-`rufe` mit demselben Vertrag wie `avesmapsGaretienRufe`: er loest mit der geparsten
// Antwort auf oder wirft.
function spion(antwortJeAufruf) {
	const rufe = [];
	const f = function (pfad, rumpf) {
		rufe.push(JSON.parse(JSON.stringify(rumpf)));
		return Promise.resolve(antwortJeAufruf(rumpf));
	};
	f.rufe = rufe;
	return f;
}
const APPLY_FERTIG = {
	ok: true, done: true, applied: 1, deleted: 0, stale: 0, skipped: 0, declined: 0,
	processed: 1, remaining: 0,
};

async function pruefeRumpf() {
	// ---- C1: die gewaehlte Art reist WIRKLICH mit ------------------------------------------------
	garetienZielWahlVergessen();
	const gebirge = objekt("ggp:Berge:Buckel", "region", "gebirge", 4711);
	const wahl = garetienZielWahlZu(gebirge);
	wahl.ziel = "label"; wahl.subtyp = "berggipfel"; wahl.kind = "";

	const rufe = spion(function (rumpf) {
		return rumpf.action === "apply" ? APPLY_FERTIG : { ok: true };
	});
	await garetienFussknopfKlick([gebirge], 73, rufe, null);

	const apply = rufe.rufe.filter(function (r) { return r.action === "apply"; });
	gleich(apply.length, 1, "genau ein apply-Ruf: " + JSON.stringify(rufe.rufe));
	const rumpf = apply[0];
	// 🔴 DER GEMESSENE RUMPF, ausgeschrieben -- das ist die Zusicherung des Befunds.
	wahr(rumpf.einstellungen_je_item !== undefined,
		"💣 `einstellungen_je_item` MUSS im apply-Rumpf stehen -- gemessen wurde: "
		+ JSON.stringify(rumpf));
	tief(Object.keys(rumpf.einstellungen_je_item), ["4711"],
		"…unter der Item-Nummer dieses Objekts");
	gleich(rumpf.einstellungen_je_item["4711"].ziel, "label",
		"🔴 die GEWAEHLTE Form reist mit, nicht der Vorschlag 'region'");
	gleich(rumpf.einstellungen_je_item["4711"].subtyp, "berggipfel",
		"🔴 …und die GEWAEHLTE Art: der Editor waehlt „Berggipfel\", und genau das geht hinaus");
	// ⚠️ Der gemeinsame Rumpf bleibt WEG: er gaelte allen Items eines Aufrufs.
	gleich(rumpf.einstellungen, undefined,
		"⚠️ `einstellungen` (ein Rumpf fuer alle) darf der Stage-Import NIE schicken");
	// Und die uebrigen Felder des Rumpfes stehen unveraendert da.
	gleich(rumpf.action, "apply");
	gleich(rumpf.kind, "garetien");
	gleich(rumpf.run_id, 73);
	tief(rumpf.ids, [4711], "🔴 Schadensfall 30.08.2026: `ids` skopiert den Schreibumfang weiter");

	// ---- C2: ZWEI Objekte, ZWEI Rumpfe -- ueber den echten Weg gemessen -------------------------
	garetienZielWahlVergessen();
	const eins = objekt("x1", "region", "sumpf", 11);
	const zwei = objekt("x2", "region", "gebirge", 12);
	const w1 = garetienZielWahlZu(eins); w1.ziel = "path"; w1.subtyp = "Flussweg";
	const w2 = garetienZielWahlZu(zwei); w2.ziel = "label"; w2.subtyp = "berggipfel";
	const rufe2 = spion(function (r) { return r.action === "apply" ? APPLY_FERTIG : { ok: true }; });
	await garetienFussknopfKlick([eins, zwei], 73, rufe2, null);
	const rumpf2 = rufe2.rufe.filter(function (r) { return r.action === "apply"; })[0];
	gleich(rumpf2.einstellungen_je_item["11"].subtyp, "Flussweg", "x1 behaelt seine Wahl");
	gleich(rumpf2.einstellungen_je_item["12"].subtyp, "berggipfel",
		"💣 …und x2 seine -- die Wahl des einen faerbt nicht auf den anderen ab");

	// ---- C3: DER DECKEL -- jedes Haeppchen traegt nur SEINE Einstellungen -----------------------
	// 💣 Der Import laeuft in Haeppchen zu 200 ids. Haengte man das ganze Woerterbuch an jeden Ruf,
	// wuechse der Rumpf mit der Stage, waehrend die id-Liste daneben ausdruecklich gedeckelt ist.
	garetienZielWahlVergessen();
	const viele = [];
	for (let i = 0; i < 250; i++) {
		const o = objekt("m" + i, "region", "sumpf", 1000 + i);
		const w = garetienZielWahlZu(o);
		w.ziel = "label"; w.subtyp = "berggipfel";
		viele.push(o);
	}
	const rufe3 = spion(function (r) { return r.action === "apply" ? APPLY_FERTIG : { ok: true }; });
	await garetienFussknopfKlick(viele, 73, rufe3, null);
	const applys = rufe3.rufe.filter(function (r) { return r.action === "apply"; });
	gleich(applys.length, 2, "250 ids gehen in ZWEI Haeppchen hinaus");
	gleich(Object.keys(applys[0].einstellungen_je_item).length, 200,
		"das erste Haeppchen traegt 200 Eintraege, nicht 250");
	gleich(Object.keys(applys[1].einstellungen_je_item).length, 50,
		"das zweite die uebrigen 50");
	gleich(applys[1].einstellungen_je_item["1000"], undefined,
		"💣 …und KEINEN Eintrag des ersten Haeppchens");
	gleich(applys[0].einstellungen_je_item["1249"], undefined,
		"…und umgekehrt ebenso wenig");

	// ---- C4: ein Haeppchen ganz OHNE Handeingabe nennt den Schluessel gar nicht -----------------
	// (Alle Items 'changed' -> kein Eintrag -> der Schluessel bleibt weg, statt als `{}` zu reisen.)
	garetienZielWahlVergessen();
	const nurErgaenzung = {
		key: "e1", name: "E1", ziel: "region", subtyp: "sumpf",
		items: [{ id: 900, change_type: "changed", felder: ["name", "quelle"] }],
	};
	const rufe4 = spion(function (r) { return r.action === "apply" ? APPLY_FERTIG : { ok: true }; });
	await garetienFussknopfKlick([nurErgaenzung], 73, rufe4, null);
	const rumpf4 = rufe4.rufe.filter(function (r) { return r.action === "apply"; })[0];
	gleich(rumpf4.einstellungen_je_item, undefined,
		"🔴 kein Eintrag heisst: der Schluessel steht gar nicht im Rumpf -- `{}` laese der Server "
		+ "als „keine Handeingaben dieser Aufgabe\" und fiele auf den gemeinsamen Rumpf zurueck");
	// Gegenprobe, sonst waere die Zeile darueber Vakuum: der Ruf ist wirklich hinausgegangen.
	gleich(rumpf4.action, "apply");
	tief(rumpf4.ids, [900], "…mit seinem Item, nur eben ohne Handeingabe");
}

pruefeRumpf().then(function () {
	console.log(`garetien-stage-import-rumpf: ${checks} Pruefungen bestanden.`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
