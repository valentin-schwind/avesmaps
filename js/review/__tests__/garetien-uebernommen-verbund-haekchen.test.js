// Fixrunde 1 zu Aufgabe 10 des Garetien-Fragmente-Verbunds (Pruefer opus, 10.09.2026).
// Entwurf: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md §7, §8, §10
// Brief:   .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-10-brief.md
//
// Befund 1 (Kritisch): die gefaltete Zeile auf "Uebernommen" verdeckte ihren Verbund statt ihn zu
// vertreten -- ihr Haekchen traf nur den Repraesentanten (data-key des ERSTEN Fragments), die drei
// Geschwister blieben von jeder Auswahl unberuehrt. Der Handgriff "Ganzen Verbund zuruecknehmen"
// (Entwurf §8) ist NUR ueber die vorhandene Mehrfachauswahl erreichbar (§10: "Der Verbund fuegt
// EINEN Knopf hinzu") -- und genau die hatte die Faltung zerstoert.
//
// Befund 2 (Wichtig): die Fragmente-Marke ("⧉ N Fragmente") zaehlte `verbund_n` (aus dem PLAN),
// gefaltet wurde aber nach `verbund_angelegt` (aus dem VERMERK) -- zwei Quellen fuer dieselbe
// Aussage. Sind erst drei von vier Fragmenten uebernommen, sagte die Marke "4", waehrend die Zeile
// fuer 3 stand.
//
// 🔴 BEIDE ZUSICHERUNGEN FUEHREN DEN BAUER AUS und messen am gebauten Markup bzw. am
// Auswahlzustand -- kein Quelltextlesen. Der Pruefer hat ausdruecklich angemerkt, dass KEINE
// bestehende Zusicherung Auswahl oder Zaehler abdeckt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-uebernommen-verbund-haekchen.test.js

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }

const { api, dom } = ladeImporter(["garetien-listcol", "garetien-tabs"]);

wahr(typeof api.garetienUebernommenMitglieder === "function",
	"garetienUebernommenMitglieder fehlt im Export");
wahr(typeof api.garetienHakenKlick === "function", "garetienHakenKlick fehlt im Export");

function fragment(key, stamm, verbundN) {
	return {
		key: key, name: key, ebene: "Waelder", typ: "Wald",
		verbund_angelegt: stamm, verbund_n: verbundN === undefined ? 0 : verbundN,
	};
}

// =================================================================================================
// A. Die REINE Funktion garetienUebernommenMitglieder -- kein DOM.
// =================================================================================================

{
	const objekte = [
		fragment("a1", "Silker Hain"),
		fragment("a2", "Silker Hain"),
		fragment("a3", "Silker Hain"),
		fragment("a4", "Silker Hain"),
		fragment("einzelhof", ""),
	];
	const mitgliederVonA1 = api.garetienUebernommenMitglieder(objekte[0], objekte);
	gleich(mitgliederVonA1.length, 4, "alle vier Fragmente desselben Stamms sind Mitglieder");
	gleich(mitgliederVonA1.map((o) => o.key).join(","), "a1,a2,a3,a4",
		"die Mitglieder stehen in der Reihenfolge der Liste");

	// ⚠️ Egal, WELCHES Mitglied man fragt -- dieselbe Gruppe kommt heraus. Die gefaltete Zeile
	// traegt zwar nur den Schluessel des ERSTEN Fragments, aber ihr Haekchen muss auch dann alle
	// vier finden, wenn irgendein anderes Mitglied als Repraesentant diente.
	const mitgliederVonA3 = api.garetienUebernommenMitglieder(objekte[2], objekte);
	gleich(mitgliederVonA3.length, 4, "auch vom dritten Fragment aus sind es alle vier");

	const einzeln = api.garetienUebernommenMitglieder(objekte[4], objekte);
	gleich(einzeln.length, 1, "ein Objekt ohne Verbund ist sein eigenes einziges Mitglied");
	gleich(einzeln[0].key, "einzelhof");

	gleich(api.garetienUebernommenMitglieder(null, objekte).length, 0,
		"kein Objekt -> keine Mitglieder, kein Wurf");
}

// 💣 ZWEI VERSCHIEDENE Objekte OHNE Verbund duerfen sich nicht gegenseitig als Mitglieder zaehlen,
// nur weil beide denselben (leeren) Stamm "" tragen -- das waere dieselbe Verwechslungsfalle wie
// bei garetienUebernommenFalten ("gesehen" muss je Stamm zaehlen, nicht global), nur eine Ebene
// tiefer. Ohne den fruehen Rueckfall bei leerem Stamm gruppierte der Filter ALLE stammlosen
// Objekte einer Liste zusammen.
{
	const zweiEinzelne = [fragment("x", ""), fragment("y", "")];
	gleich(api.garetienUebernommenMitglieder(zweiEinzelne[0], zweiEinzelne).length, 1,
		"zwei verschiedene Objekte ohne Verbund sind NICHT gegenseitig ihre Mitglieder");
}

// =================================================================================================
// B. garetienHakenKlick: das Haekchen der gefalteten Zeile trifft ALLE Mitglieder.
// =================================================================================================

// Ein Klick-Ereignis auf das Zeilenhaekchen -- derselbe Aufbau, den garetienHakenKlick wirklich
// abfragt (ziel.closest('input[type="checkbox"]') -> feld.closest("[data-key]")), ohne einen
// echten Browser zu brauchen.
function haekchenKlick(schluessel) {
	const traeger = {
		getAttribute(name) {
			if (name === "data-seg") { return null; }
			if (name === "data-key") { return schluessel; }
			return null;
		},
	};
	const feld = {
		disabled: false,
		closest(sel) { return sel === "[data-key]" ? traeger : null; },
	};
	const ziel = {
		closest(sel) { return sel === 'input[type="checkbox"]' ? feld : null; },
	};
	return { target: ziel };
}

function sendenNieGerufen() {
	throw new Error("senden() darf beim Zeilenhaekchen nie gerufen werden -- das ist der Weg der "
		+ "Abschnittshaekchen (data-seg), nicht der Auswahl.");
}

{
	const vier = [
		fragment("ggp:silkerhain:1", "Silker Hain"),
		fragment("ggp:silkerhain:2", "Silker Hain"),
		fragment("ggp:silkerhain:3", "Silker Hain"),
		fragment("ggp:silkerhain:4", "Silker Hain"),
	];

	// Die gefaltete Zeile traegt den Schluessel des ERSTEN Fragments (garetienUebernommenFalten).
	// Ein Klick darauf muss ALLE VIER waehlen, nicht nur das erste.
	api.garetienHakenKlick(haekchenKlick("ggp:silkerhain:1"), vier, 1, sendenNieGerufen);
	wahr(api.avesmapsGaretienAuswahlHat("ggp:silkerhain:1"), "Fragment 1 ist gewaehlt");
	wahr(api.avesmapsGaretienAuswahlHat("ggp:silkerhain:2"),
		"Fragment 2 muss mitgewaehlt sein -- die gefaltete Zeile vertritt den GANZEN Verbund");
	wahr(api.avesmapsGaretienAuswahlHat("ggp:silkerhain:3"), "Fragment 3 ist mitgewaehlt");
	wahr(api.avesmapsGaretienAuswahlHat("ggp:silkerhain:4"), "Fragment 4 ist mitgewaehlt");

	// Sind schon alle vier gewaehlt, waehlt derselbe Klick alle wieder AB -- eine gefaltete Zeile
	// darf nicht wirkungslos aussehen, wenn ein Editor sie erneut anklickt.
	api.garetienHakenKlick(haekchenKlick("ggp:silkerhain:1"), vier, 1, sendenNieGerufen);
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:silkerhain:1"), "Fragment 1 wieder abgewaehlt");
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:silkerhain:2"), "Fragment 2 wieder abgewaehlt");
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:silkerhain:3"), "Fragment 3 wieder abgewaehlt");
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:silkerhain:4"), "Fragment 4 wieder abgewaehlt");

	// Sind nur DREI von vier bereits gewaehlt (Editor hat schon etwas markiert, oder nur ein Teil
	// des Verbunds wurde bisher uebernommen), muss der Klick auf "nicht alle gewaehlt" reagieren
	// und ALLE anwaehlen -- nicht nur das fehlende.
	api.avesmapsGaretienAuswahlUmschalten("ggp:silkerhain:1", vier[0]);
	api.avesmapsGaretienAuswahlUmschalten("ggp:silkerhain:2", vier[1]);
	api.avesmapsGaretienAuswahlUmschalten("ggp:silkerhain:3", vier[2]);
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:silkerhain:4"), "Vorbedingung: Fragment 4 noch offen");
	api.garetienHakenKlick(haekchenKlick("ggp:silkerhain:1"), vier, 1, sendenNieGerufen);
	wahr(api.avesmapsGaretienAuswahlHat("ggp:silkerhain:1"), "nach Teilauswahl: Fragment 1 gewaehlt");
	wahr(api.avesmapsGaretienAuswahlHat("ggp:silkerhain:2"), "nach Teilauswahl: Fragment 2 gewaehlt");
	wahr(api.avesmapsGaretienAuswahlHat("ggp:silkerhain:3"), "nach Teilauswahl: Fragment 3 gewaehlt");
	wahr(api.avesmapsGaretienAuswahlHat("ggp:silkerhain:4"),
		"nach Teilauswahl: auch das vierte, bisher offene Fragment wird angewaehlt");
	api.avesmapsGaretienAuswahlAufheben();
}

// ⚠️ Ein Objekt OHNE Verbund (kein Fragment, das die Faltung ueberhaupt betrifft) verhaelt sich
// weiterhin wie vor Aufgabe 10: das Haekchen trifft NUR dieses eine Objekt. Sonst waere die
// Reparatur eine neue Regression auf den uebrigen Reitern (Offen/Stage/Abgelehnt), wo nichts
// gefaltet wird.
{
	const einzelhof = fragment("ggp:einzelhof", "");
	const andereFragmente = [
		fragment("ggp:andere:1", "Anderer Verbund"),
		fragment("ggp:andere:2", "Anderer Verbund"),
	];
	const alle = [einzelhof].concat(andereFragmente);
	api.garetienHakenKlick(haekchenKlick("ggp:einzelhof"), alle, 1, sendenNieGerufen);
	wahr(api.avesmapsGaretienAuswahlHat("ggp:einzelhof"), "das Einzelobjekt selbst ist gewaehlt");
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:andere:1"),
		"ein FREMDER Verbund in derselben Liste bleibt unberuehrt");
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:andere:2"), "auch dessen zweites Fragment bleibt unberuehrt");
	api.avesmapsGaretienAuswahlAufheben();
}

// =================================================================================================
// C. Der ECHTE Renderweg: das Haekchen der gebauten Zeile zeigt "gesetzt" nur, wenn ALLE
//    Mitglieder gewaehlt sind -- und die Marke zaehlt auf "Uebernommen" die tatsaechlich
//    gefalteten Mitglieder, nie den Plan-Wert `verbund_n`.
// =================================================================================================

function zeileHtml() { return dom.html("#garetien-list"); }

async function mitAntwort(stand, objekte, tun) {
	api.garetienReiterSetzen(stand);
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({
			json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7, reiter: {} }),
		});
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
	tun();
}

(async function () {
	// Drei von vier Fragmenten sind uebernommen (das vierte steht noch "offen" und erscheint auf
	// diesem Reiter deshalb gar nicht) -- `verbund_n` traegt weiterhin die Plan-Zahl 4.
	const dreiVonVier = [
		fragment("ggp:teil:1", "Teilverbund", 4),
		fragment("ggp:teil:2", "Teilverbund", 4),
		fragment("ggp:teil:3", "Teilverbund", 4),
	];

	await mitAntwort("uebernommen", dreiVonVier, function () {
		const html = zeileHtml();
		wahr(html.indexOf("3 Fragmente") > -1,
			"Befund 2: die Marke zaehlt die TATSAECHLICH gefalteten Mitglieder (3): " + html);
		wahr(html.indexOf("4 Fragmente") === -1,
			"Befund 2: die Marke darf NICHT den Plan-Wert verbund_n (4) zeigen: " + html);
		wahr(html.indexOf('<input type="checkbox" checked>') === -1,
			"Befund 1: ohne jede Auswahl ist die gefaltete Zeile NICHT angehakt: " + html);
	});

	// Zwei von drei Mitgliedern werden aussenrum gewaehlt (nicht ueber die Zeile) --
	// die gefaltete Zeile darf sich deshalb noch NICHT als "gesetzt" zeigen.
	api.avesmapsGaretienAuswahlUmschalten("ggp:teil:1", dreiVonVier[0]);
	api.avesmapsGaretienAuswahlUmschalten("ggp:teil:2", dreiVonVier[1]);
	await mitAntwort("uebernommen", dreiVonVier, function () {
		const html = zeileHtml();
		wahr(html.indexOf('<input type="checkbox" checked>') === -1,
			"Befund 1: zwei von drei gewaehlt ist NICHT 'alle gewaehlt' -- die Zeile bleibt "
			+ "unangehakt: " + html);
	});

	// Das dritte Mitglied kommt dazu -- jetzt sind es alle drei, die Zeile zeigt sich gesetzt.
	api.avesmapsGaretienAuswahlUmschalten("ggp:teil:3", dreiVonVier[2]);
	await mitAntwort("uebernommen", dreiVonVier, function () {
		const html = zeileHtml();
		wahr(html.indexOf('<input type="checkbox" checked>') > -1,
			"Befund 1: sind alle drei Mitglieder gewaehlt, zeigt sich die gefaltete Zeile gesetzt: "
			+ html);
	});

	// Ein Klick auf die (jetzt vollstaendig gewaehlte) Zeile nimmt alle drei wieder zurueck.
	api.garetienHakenKlick(haekchenKlick("ggp:teil:1"), dreiVonVier, 7, sendenNieGerufen);
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:teil:1"), "nach dem Klick: Mitglied 1 abgewaehlt");
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:teil:2"), "nach dem Klick: Mitglied 2 abgewaehlt");
	wahr(!api.avesmapsGaretienAuswahlHat("ggp:teil:3"), "nach dem Klick: Mitglied 3 abgewaehlt");

	// Gegenprobe zu Befund 2 auf einem ANDEREN Reiter: dort ist nichts gefaltet, `verbund_n` bleibt
	// die richtige Zahl (Entwurf-Auflage: "auf den uebrigen Reitern bleibt verbund_n richtig").
	await mitAntwort("offen", dreiVonVier, function () {
		const html = zeileHtml();
		wahr(html.indexOf("4 Fragmente") > -1,
			"auf 'offen' bleibt verbund_n (4) die Zahl -- dort ist nichts gefaltet: " + html);
	});

	console.log("OK: " + checks + " Pruefungen (garetien-uebernommen-verbund-haekchen)");
})();
