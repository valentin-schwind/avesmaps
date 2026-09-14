"use strict";

/*
 * Aufgabe 6 des Fragmente-Verbunds -- „Der Import: Anfuehrer und Teil".
 * Brief: .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-6-brief.md
 *
 * 🔴 EIGENE ERGAENZUNG DIESER SITZUNG, NICHT IM BRIEF GEFORDERT. Der Brief nennt fuer Aufgabe 6
 * nur den PHP-Test; die Client-Aenderung (`garetienEingabenFuerServer` haengt bei einem
 * zusammengelegten Verbund das Feld `verbund` an) blieb dort unverifiziert. Ohne diesen Test
 * waere die einzige Instanz, die je gezeigt hat, dass der Rumpf wirklich beim Server ankommt,
 * ein manueller Blick in den Diff -- dieselbe Klasse Luecke, die die Fixrunden von Aufgabe 3-5
 * schon mehrfach gefunden haben ("beide Haelften gruen, die Naht ungeprueft").
 *
 * Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-rumpf.test.js
 */

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter();

function fragmente() {
	// Aufgabe 6 (14.09.2026): Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
	const verbund = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: 2,
		ziel: "region", subtyp: "wald" };
	return [
		Object.assign({ key: "ggp:silkerhain:eins" }, verbund),
		Object.assign({ key: "ggp:silkerhain:zwei" }, verbund),
	];
}

// ---- A. Ein Einzelobjekt (kein Verbund) traegt KEIN `verbund`-Feld -----------------------------
(function () {
	api.garetienVerbundVergessen();
	api.avesmapsGaretienStageLeeren();
	api.garetienNameWahlVergessen();

	const einzeln = { key: "ggp:weidicht", ebene: "Waelder", typ: "Wald" };
	const rumpf = api.garetienEingabenFuerServer(einzeln);
	gleich("verbund" in (rumpf || {}), false,
		"ein Objekt ohne Verbund schickt kein `verbund`-Feld: " + JSON.stringify(rumpf));
})();

// ---- B. Ein Verbund-Fragment OHNE Zusammenlegung traegt ebenfalls KEIN `verbund`-Feld ----------
// 💣 `garetienVerbundSchluessel` ist fuer beide Fragmente NICHT leer (verbund_n >= 2) -- das
// `verbund`-Feld haengt trotzdem nur am ZUSAMMENGELEGTEN Verbund. Wer die vier Fragmente einzeln
// auf die Stage legt (ohne "Verbund auf die Stage" zu druecken), bekommt vier eigenstaendige
// Objekte -- der Server soll sie dann NICHT ueber apply_note zusammensuchen.
(function () {
	api.garetienVerbundVergessen();
	api.avesmapsGaretienStageLeeren();
	api.garetienNameWahlVergessen();

	const [m1] = fragmente();
	assert.notStrictEqual(api.garetienVerbundSchluessel(m1), "",
		"Testaufbau: m1 gehoert zu einem erkennbaren Verbund");
	assert.ok(!api.garetienVerbundIstZusammen(api.garetienVerbundSchluessel(m1)),
		"Testaufbau: der Verbund ist NICHT zusammengelegt");

	const rumpf = api.garetienEingabenFuerServer(m1);
	gleich("verbund" in (rumpf || {}), false,
		"ein nicht zusammengelegtes Fragment schickt kein `verbund`-Feld: " + JSON.stringify(rumpf));
})();

// ---- C. Ein zusammengelegter Verbund traegt den STAMM, nicht den Client-Schluessel -------------
(function () {
	api.garetienVerbundVergessen();
	api.avesmapsGaretienStageLeeren();
	api.garetienNameWahlVergessen();

	const [m1, m2] = fragmente();
	const schluessel = api.garetienVerbundSchluessel(m1);
	// 🔴 Aufgabe 6: Zusammenlegen legt NICHT mehr auf -- erst auflegen, dann zusammenlegen.
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
	assert.ok(api.garetienVerbundIstZusammen(schluessel), "Testaufbau: jetzt zusammengelegt");

	const rumpf1 = api.garetienEingabenFuerServer(m1);
	gleich(rumpf1.verbund, "Silker Hain",
		"der Rumpf traegt den STAMM (nicht 'verbund:Waelder|Wald|Silker Hain'): "
		+ JSON.stringify(rumpf1));

	// ⚠️ UND JEDES Mitglied traegt IHN, nicht nur das erste -- der Server braucht ihn an jedem
	// Item, um den Anfuehrer wiederzufinden (avesmapsGaretienVerbundRegion sucht ueber die
	// GANZE Laufliste, aber nur Items, die den Rumpf mitschicken, koennen ueberhaupt zu einem
	// Zweitglied werden).
	const rumpf2 = api.garetienEingabenFuerServer(m2);
	gleich(rumpf2.verbund, "Silker Hain", "das zweite Mitglied traegt denselben Stamm");
})();

// ---- D. Der Verbund reist NEBEN dem Namen, nicht statt seiner ----------------------------------
// 💣 Regression, die die woertliche Brief-Fassung eingebaut haette: `return Object.assign({},
// rumpf, {verbund: ...})` (ohne `mitName`) wuerfe eine von Hand gesetzte Namenswahl beim
// Zusammenlegen weg, weil `rumpf` (ohne Namen) statt des Ergebnisses mit Namen verwendet wuerde.
(function () {
	api.garetienVerbundVergessen();
	api.avesmapsGaretienStageLeeren();
	api.garetienNameWahlVergessen();

	const [m1, m2] = fragmente();
	const schluessel = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
	api.garetienNameWahlSetzen(m1, "Silker Forst");

	const rumpf = api.garetienEingabenFuerServer(m2);
	gleich(rumpf.name, "Silker Forst",
		"der Name des Verbunds reist WEITERHIN mit, wenn zusaetzlich `verbund` angehaengt wird: "
		+ JSON.stringify(rumpf));
	gleich(rumpf.verbund, "Silker Hain", "…und `verbund` steht daneben, nicht anstelle dessen");
})();

api.garetienVerbundVergessen();
api.avesmapsGaretienStageLeeren();
api.garetienNameWahlVergessen();

console.log(`garetien-verbund-rumpf: ${checks} Pruefungen bestanden.`);
