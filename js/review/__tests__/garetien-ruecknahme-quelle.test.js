// Meldung (30.08.2026, Owner): „Übernommen (312) -- mach die rückgängig -- und lass mich die
// dinger rückgängig machen". Der Reiter „Übernommen" zeigte 312 Objekte, deren einziger Knopf
// „0 von 312" meldete: `garetienRuecknahmeItem` liess bis dahin GENAU 'new'-Items zu, und alle 312
// Objekte sind 'changed'-Items mit `felder: ['quelle']` -- ein bestehendes Objekt bekam NUR eine
// Quellenangabe angehängt, nichts an Name oder Geometrie wurde berührt
// (avesmapsGaretienErgaenzungAnwenden tut in diesem Fall ausschliesslich
// avesmapsGaretienQuelleAnlegen). Die alte Begründung des Riegels ("ein 'changed'-Item hat ein
// bestehendes Objekt verändert, sein Löschen wäre Datenverlust") trifft auf DIESE 312 nicht zu.
//
// Diese Datei prüft die ENGERE, nicht die AUFGEHOBENE Regel: ein 'changed'-Item wird rücknehmbar
// GENAU DANN, wenn `felder` NICHTS ausser 'quelle' nennt -- 'name' oder 'geometrie' irgendwo in
// `felder` hält den alten Riegel unverändert aufrecht (miss die Differenz, Auftrag).
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-ruecknahme-quelle.test.js
"use strict";

const path = require("path");
const assert = require("assert");

let checks = 0;
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }

// Kein `global.document` noetig -- dieselbe Lage wie garetien-handlungen.test.js: die geprueften
// Bausteine sind reine Funktionen bzw. Klickverteiler, die ihr DOM-Ziel als Parameter bekommen.
const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienItemIstQuelleNur,
	garetienRuecknahmeFaehig,
	garetienRuecknahmeItems,
	garetienRuecknahmeItem,
	garetienRuecknahmeBauen,
	garetienRuecknahmeRueckfrageText,
	garetienRuecknahmeKlick,
	garetienRuecknahmeSenden,
	garetienRuecknahmeMengeZustand,
	garetienRuecknahmeMengeRueckfrageText,
	avesmapsGaretienMarkierungUmschalten,
	avesmapsGaretienMarkierungHat,
} = mod;

[
	"garetienItemIstQuelleNur", "garetienRuecknahmeFaehig", "garetienRuecknahmeItems",
	"garetienRuecknahmeItem", "garetienRuecknahmeBauen", "garetienRuecknahmeRueckfrageText",
	"garetienRuecknahmeKlick", "garetienRuecknahmeSenden", "garetienRuecknahmeMengeZustand",
	"garetienRuecknahmeMengeRueckfrageText",
].forEach(function (name) { wahr(typeof mod[name] === "function", name + " fehlt im Export"); });

// ---- Derselbe Ziel-Bauer wie garetien-handlungen.test.js (kein DOM, ein Objekt mit `.closest`) --
function kette(knoten) {
	const kandidaten = knoten.map((k) => Object.assign({
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(k.attribute || {}, name)
				? k.attribute[name] : null;
		},
	}, k));
	kandidaten[0].closest = function (auswahl) {
		for (const kandidat of kandidaten) {
			if ((kandidat.passt || []).indexOf(auswahl) !== -1) { return kandidat; }
		}
		return null;
	};
	return kandidaten[0];
}
function ruecknahmeZiel(key, options) {
	return kette([Object.assign({
		passt: ['[data-handlung="ruecknahme"]', "[data-handlung]", "[data-key]"],
		attribute: { "data-handlung": "ruecknahme", "data-key": key },
	}, options || {})]);
}
const jaSagen = (text) => { gefragt.push(text); return true; };
const neinSagen = (text) => { gefragt.push(text); return false; };
let gefragt = [];

// =================================================================================================
// 1. garetienItemIstQuelleNur -- REIN: `felder` ist GENAU ['quelle'], nichts mehr und nichts weniger
// =================================================================================================
gleich(garetienItemIstQuelleNur({ felder: ["quelle"] }), true, "genau EIN Feld, und das ist 'quelle'");
gleich(garetienItemIstQuelleNur({ felder: ["name", "quelle"] }), false,
	"🪤 MISS DIE DIFFERENZ: ein Lücken-Item mit Name UND Quelle bleibt gesperrt");
gleich(garetienItemIstQuelleNur({ felder: ["geometrie"] }), false, "Geometrie allein ist keine Quelle");
gleich(garetienItemIstQuelleNur({ felder: [] }), false, "eine leere Liste ist kein 'nur Quelle'");
gleich(garetienItemIstQuelleNur({}), false, "ein Item ganz ohne `felder` ist keine Ausnahme");
gleich(garetienItemIstQuelleNur(null), false, "null wirft nicht, ist einfach falsch");

// =================================================================================================
// 2. garetienRuecknahmeFaehig -- die Vereinigung aus 'new'+done und 'changed'+quelle-only+done
// =================================================================================================
gleich(garetienRuecknahmeFaehig({ change_type: "new", apply_state: "done" }), true,
	"ein 'new'-Item bleibt rücknehmbar (Owner-Entscheid 1, unveraendert)");
gleich(garetienRuecknahmeFaehig({ change_type: "new", apply_state: "failed" }), false,
	"ein 'new'-Item, das nie uebernommen wurde, ist nicht rücknehmbar");
gleich(garetienRuecknahmeFaehig({ change_type: "changed", apply_state: "done", felder: ["quelle"] }), true,
	"🔴 DIE NEUE AUSNAHME: 'changed' + GENAU ['quelle'] + 'done'");
gleich(garetienRuecknahmeFaehig({ change_type: "changed", apply_state: "done", felder: ["name", "quelle"] }), false,
	"'changed' mit Name UND Quelle bleibt gesperrt -- die alte Regel gilt unveraendert");
gleich(garetienRuecknahmeFaehig({ change_type: "changed", apply_state: "done", felder: ["geometrie"] }), false,
	"'changed' mit Geometrie bleibt gesperrt");
gleich(garetienRuecknahmeFaehig({ change_type: "changed", apply_state: null, felder: ["quelle"] }), false,
	"ein 'quelle'-only-Item, das nie uebernommen wurde, ist nicht rücknehmbar");
gleich(garetienRuecknahmeFaehig(null), false, "kein Item ist nicht rücknehmbar");

// =================================================================================================
// 3. Die Fixtures -- die Meldung selbst: ein Objekt mit EINEM 'quelle'-Item, eines mit MEHREREN
//    (ein mehrteiliger Weg, an dem garetien.de mehrere Abschnitte demselben Artikel zuordnet --
//    live gemessen 372 Items an 312 Objekten, ein Teil der Objekte traegt also mehr als eines).
// =================================================================================================
const wegNeu = {
	key: "gq:neu", name: "Gardel", urteil: "neu", stand: "uebernommen", geometrie_typ: "LineString",
	items: [{ id: 601, change_type: "new", apply_state: "done", selected: 0 }],
};
const wegQuelleEins = {
	key: "gq:quelle-eins", name: "Alkstrasse", urteil: "ergaenzung", stand: "uebernommen",
	geometrie_typ: "LineString",
	items: [{ id: 602, change_type: "changed", apply_state: "done", anlass: "ergaenzung",
		felder: ["quelle"], selected: 0 }],
};
// 🔴 EIN MEHRTEILIGER WEG: ZWEI eigenstaendige 'quelle'-Items desselben Objekts, je ein anderer
// Abschnitt (unterschiedliche entity_public_id serverseitig, hier nicht sichtbar -- die Liste
// gruppiert nach Objekt, nicht nach Abschnitt). `avesmapsGaretienListeObjektStand` erklaert das
// Objekt schon "uebernommen", sobald IRGENDEIN Item 'done' ist -- eine Ruecknahme, die nur EINES
// zuruecksetzt, liesse das Objekt faelschlich "uebernommen" stehen.
const wegQuelleMehrfach = {
	key: "gq:quelle-mehrfach", name: "Reichsstrasse Zwei", urteil: "ergaenzung", stand: "uebernommen",
	geometrie_typ: "LineString",
	items: [
		{ id: 603, change_type: "changed", apply_state: "done", anlass: "ergaenzung",
			felder: ["quelle"], selected: 0 },
		{ id: 604, change_type: "changed", apply_state: "done", anlass: "ergaenzung",
			felder: ["quelle"], selected: 0 },
	],
};
const wegGemischt = {
	key: "gq:gemischt", name: "Alke", urteil: "ergaenzung", stand: "uebernommen", geometrie_typ: "LineString",
	items: [{ id: 605, change_type: "changed", apply_state: "done", anlass: "ergaenzung",
		felder: ["name", "quelle"], selected: 0 }],
};
const wegGeometrie = {
	key: "gq:geometrie", name: "Diagonale", urteil: "widerspruch", stand: "uebernommen", geometrie_typ: "LineString",
	items: [{ id: 606, change_type: "changed", apply_state: "done", anlass: "geometrie",
		felder: ["geometrie"], selected: 0 }],
};
// Eine Landschaftsflaeche mit 'quelle'-only-Item -- die Rueckfrage darf hier NICHT von
// Beschriftung/Region/Flaeche sprechen (das gilt nur der LOESCHUNG eines 'new'-Objekts).
const flaecheQuelle = {
	key: "gq:flaeche-quelle", name: "Testmoor", urteil: "ergaenzung", stand: "uebernommen", geometrie_typ: "Polygon",
	items: [{ id: 607, change_type: "changed", apply_state: "done", anlass: "ergaenzung",
		felder: ["quelle"], selected: 0 }],
};

// =================================================================================================
// 4. garetienRuecknahmeItems / garetienRuecknahmeItem -- PLURAL, nicht nur das erste Item
// =================================================================================================
tief(garetienRuecknahmeItems(wegQuelleEins).map((i) => i.id), [602], "genau das eine 'quelle'-Item");
tief(garetienRuecknahmeItems(wegQuelleMehrfach).map((i) => i.id), [603, 604],
	"🔴 MISS DIE DIFFERENZ: BEIDE 'quelle'-Items, nicht nur das erste");
tief(garetienRuecknahmeItems(wegGemischt), [], "ein Lücken-Item bleibt aussen vor");
tief(garetienRuecknahmeItems(wegGeometrie), [], "ein Geometrie-Item ebenso");
gleich(garetienRuecknahmeItem(wegQuelleMehrfach).id, 603, "…und das Singular bleibt das ERSTE davon");
gleich(garetienRuecknahmeItem(wegGemischt), null, "…null, wenn nichts rücknehmbar ist");

// =================================================================================================
// 5. garetienRuecknahmeBauen -- der Knopf (oder der Grund an seiner Stelle)
// =================================================================================================
gleich(garetienRuecknahmeBauen(wegQuelleEins).disabled, false, "'quelle'-only bekommt einen Knopf");
tief(garetienRuecknahmeBauen(wegQuelleEins).ids, [602], "mit der id des einen Items");

gleich(garetienRuecknahmeBauen(wegQuelleMehrfach).disabled, false, "auch der mehrteilige Weg bekommt einen Knopf");
tief(garetienRuecknahmeBauen(wegQuelleMehrfach).ids, [603, 604],
	"🔴 MISS DIE DIFFERENZ: der Knopf trägt BEIDE ids -- ein Klick muss BEIDE Items zurücksetzen, "
	+ "sonst bliebe das Objekt wegen des jeweils anderen Items weiter 'uebernommen'");

gleich(garetienRuecknahmeBauen(wegGemischt).disabled, true,
	"🔴 DIE ALTE REGEL GILT UNVERAENDERT: Name UND Quelle -- kein Knopf");
gleich(garetienRuecknahmeBauen(wegGemischt).grund, "Verändert ein bestehendes Objekt — nicht rücknehmbar.");
tief(garetienRuecknahmeBauen(wegGemischt).ids, [], "und keine id");

gleich(garetienRuecknahmeBauen(wegGeometrie).disabled, true, "Geometrie bleibt ebenso gesperrt");

gleich(garetienRuecknahmeBauen(wegNeu).disabled, false, "🔄 Regression: 'new' bleibt wie zuvor bedienbar");
tief(garetienRuecknahmeBauen(wegNeu).ids, [601]);

// =================================================================================================
// 6. garetienRuecknahmeRueckfrageText -- ZWEI GRUNDVERSCHIEDENE FOLGEN, ZWEI TEXTE
// =================================================================================================
const frageQuelle = garetienRuecknahmeRueckfrageText(wegQuelleEins);
wahr(frageQuelle.includes("Alkstrasse"), "die Rückfrage nennt das Objekt beim Namen");
wahr(frageQuelle.includes("Quellenangabe"), "und sagt, dass es um die QUELLENANGABE geht");
wahr(frageQuelle.includes("bleibt unverändert auf der Karte"),
	"🔴 UND SIE SAGT AUSDRÜCKLICH, DASS DAS OBJEKT BLEIBT -- der alte Text ('wird aus unserer "
	+ "Karte entfernt') wäre hier schlicht falsch");
wahr(!frageQuelle.includes("wird aus unserer Karte entfernt"),
	"…die alte Loeschungs-Formulierung darf hier nicht auftauchen");
wahr(frageQuelle.includes("zurück nach „Offen“"), "und dass es danach wieder offen ist");

const frageFlaecheQuelle = garetienRuecknahmeRueckfrageText(flaecheQuelle);
wahr(frageFlaecheQuelle.includes("Quellenangabe"),
	"🔴 MISS DIE DIFFERENZ: der GEOMETRIETYP entscheidet die Formulierung NICHT -- eine Flaeche "
	+ "mit 'quelle'-only-Item bekommt den QUELLEN-Text, nicht den Loeschungs-Text mit "
	+ "Beschriftung/Region/Flaeche");
wahr(!frageFlaecheQuelle.includes("Landschaftsregion"),
	"…die Flaechen-Loeschungsformulierung ('Beschriftung, Landschaftsregion und Fläche') fehlt hier");

const frageNeu = garetienRuecknahmeRueckfrageText(wegNeu);
wahr(frageNeu.includes("wird aus unserer Karte entfernt"),
	"🔄 Regression: der 'new'-Text bleibt die Loeschungs-Formulierung");
wahr(!frageNeu.includes("Quellenangabe"), "…und nennt keine Quellenangabe");

// =================================================================================================
// 7. garetienRuecknahmeKlick -- am ERGEBNIS gemessen: EIN Item -> Skalar, MEHRERE -> Array
// =================================================================================================
let ruecknahmeGesendet;
const ruecknahmeSenden = (idsOderId, runId) => { ruecknahmeGesendet = [idsOderId, runId]; return "gesendet"; };
const objekteQ = [wegNeu, wegQuelleEins, wegQuelleMehrfach, wegGemischt, wegGeometrie];

ruecknahmeGesendet = undefined; gefragt = [];
const ergebnisEins = garetienRuecknahmeKlick(
	{ target: ruecknahmeZiel(wegQuelleEins.key) }, objekteQ, 9, ruecknahmeSenden, jaSagen
);
gleich(ergebnisEins, "gesendet", "„Ja“ ruft den Sender und reicht sein Ergebnis durch");
tief(ruecknahmeGesendet, [602, 9],
	"🔄 Regression: EIN Item bleibt eine nackte Zahl, keine Ein-Element-Liste");
wahr(gefragt[0].includes("Quellenangabe"), "gefragt wurde mit dem QUELLEN-Wortlaut, nicht dem Loeschungstext");

ruecknahmeGesendet = undefined; gefragt = [];
const ergebnisMehr = garetienRuecknahmeKlick(
	{ target: ruecknahmeZiel(wegQuelleMehrfach.key) }, objekteQ, 9, ruecknahmeSenden, jaSagen
);
gleich(ergebnisMehr, "gesendet");
tief(ruecknahmeGesendet, [[603, 604], 9],
	"🔴 MISS DIE DIFFERENZ: MEHRERE Items gehen als ARRAY hinaus -- BEIDE ids, in einem Aufruf");

ruecknahmeGesendet = undefined; gefragt = [];
gleich(garetienRuecknahmeKlick(
	{ target: ruecknahmeZiel(wegGemischt.key) }, objekteQ, 9, ruecknahmeSenden, jaSagen
), null, "ohne rücknehmbares Item passiert nichts -- der alte Riegel wirkt weiter");
gleich(ruecknahmeGesendet, undefined, "nichts gesendet");
gleich(gefragt.length, 0, "und auch nicht gefragt");

ruecknahmeGesendet = undefined; gefragt = [];
gleich(garetienRuecknahmeKlick(
	{ target: ruecknahmeZiel(wegQuelleEins.key) }, objekteQ, 9, ruecknahmeSenden, neinSagen
), true, "„Nein“ gilt als behandelt -- kein Fallthrough zu garetienHandlungKlick");
gleich(ruecknahmeGesendet, undefined, "und schickt nichts");

// =================================================================================================
// 8. garetienRuecknahmeSenden -- eine Liste bleibt eine Liste, ein Skalar wird verpackt
// =================================================================================================
async function pruefeSendenArray() {
	const echtesFetch = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt.push({ pfad: String(pfad), rumpf: rumpf });
		if (rumpf.action === "ruecknahme") {
			return Promise.resolve({ json: () => Promise.resolve({ ok: true, zurueckgenommen: 2, fehler: [] }) });
		}
		return Promise.resolve({
			json: () => Promise.resolve({ ok: true, plan_run_id: 9, gesamt: 0, objekte: [], bilanz: {}, reiter: {}, facetten: {} }),
		});
	};
	await garetienRuecknahmeSenden([603, 604], 9);
	global.fetch = echtesFetch;

	gleich(gestellt.length, 2, "ruecknahme, dann die Liste neu");
	gleich(gestellt[0].rumpf.action, "ruecknahme");
	tief(gestellt[0].rumpf.ids, [603, 604], "🔴 MISS DIE DIFFERENZ: eine übergebene Liste bleibt UNVERPACKT dieselbe Liste");
	gleich(gestellt[0].rumpf.run_id, 9);

	// Und derselbe Sender mit einem SKALAR -- Rückwärtskompatibilität mit der bestehenden
	// Verdrahtung (garetien-handlungen.test.js prüft dasselbe für das 'new'-Item).
	const gestellt2 = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt2.push(rumpf);
		if (rumpf.action === "ruecknahme") {
			return Promise.resolve({ json: () => Promise.resolve({ ok: true, zurueckgenommen: 1, fehler: [] }) });
		}
		return Promise.resolve({
			json: () => Promise.resolve({ ok: true, plan_run_id: 9, gesamt: 0, objekte: [], bilanz: {}, reiter: {}, facetten: {} }),
		});
	};
	await garetienRuecknahmeSenden(602, 9);
	global.fetch = echtesFetch;
	tief(gestellt2[0].ids, [602], "ein Skalar wird weiterhin in eine Ein-Element-Liste verpackt");
}

// =================================================================================================
// 9. garetienRuecknahmeMengeZustand / …RueckfrageText -- eine markierte Menge kann BEIDE Sorten
//    mischen ('new'-Löschung UND 'quelle'-only), und ein Objekt kann MEHRERE ids beisteuern
// =================================================================================================
function pruefeMenge() {
	avesmapsGaretienMarkierungUmschalten(wegNeu.key);
	avesmapsGaretienMarkierungUmschalten(wegQuelleMehrfach.key);

	const stand = garetienRuecknahmeMengeZustand([wegNeu, wegQuelleMehrfach, wegGemischt], "uebernommen");
	gleich(stand.markiert, 2, "zwei markiert");
	gleich(stand.ruecknehmbar, 2,
		"🔴 GEZÄHLT WERDEN OBJEKTE, NICHT ITEMS: der mehrteilige Weg zählt als EIN rücknehmbares Objekt");
	tief(stand.ids, [601, 603, 604],
		"🔴 MISS DIE DIFFERENZ: `ids` sammelt ALLE Items ÜBER ALLE Objekte hinweg FLACH -- eine "
		+ "id vom 'new'-Objekt UND BEIDE ids des mehrteiligen 'quelle'-Objekts");
	gleich(stand.beschriftung, "Markierte zurücknehmen (2 von 2)");

	const frageGemischt = garetienRuecknahmeMengeRueckfrageText([wegNeu, wegQuelleMehrfach]);
	wahr(frageGemischt.includes("werden aus unserer Karte entfernt"),
		"die Loeschungs-Haelfte (wegNeu) steht drin");
	wahr(frageGemischt.includes("wird nur die Quellenangabe entfernt"),
		"…und die Quellen-Haelfte (wegQuelleMehrfach) ebenso -- eine gemischte Menge nennt BEIDE Folgen");

	const frageNurQuelle = garetienRuecknahmeMengeRueckfrageText([wegQuelleMehrfach]);
	wahr(frageNurQuelle.includes("wird nur die Quellenangabe entfernt"));
	wahr(!frageNurQuelle.includes("werden aus unserer Karte entfernt"),
		"eine REINE Quellen-Menge behauptet nicht, dass Objekte von der Karte verschwinden");

	// Aufraeumen -- die Markierung ist Modulzustand und wuerde sonst in nachfolgenden Zusicherungen
	// dieser Datei nachwirken.
	avesmapsGaretienMarkierungUmschalten(wegNeu.key);
	avesmapsGaretienMarkierungUmschalten(wegQuelleMehrfach.key);
	gleich(avesmapsGaretienMarkierungHat(wegNeu.key), false, "sauber abgeraeumt");
}

pruefeSendenArray().then(function () {
	pruefeMenge();
	console.log("garetien-ruecknahme-quelle.test.js: " + checks + " Zusicherungen OK");
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
