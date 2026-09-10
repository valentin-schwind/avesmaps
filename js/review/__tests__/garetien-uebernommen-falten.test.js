// Aufgabe 10 des Garetien-Fragmente-Verbunds -- "Uebernommen" zeigt einen Verbund als EINE Zeile.
// Entwurf: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md §7
// Brief:   .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-10-brief.md
//
// 🔴 EIGENE ABWEICHUNG DIESER SITZUNG: der Brief nennt eine Funktion `garetienAnzeigenAntwortBauen`,
// die es im echten Code NICHT gibt (weder unter diesem noch einem verwandten Namen). Der einzige
// Ort, an dem eine frische `action:'liste'`-Antwort zu Listenzeilen wird, ist
// `avesmapsGaretienListeRendern` (schreibt `#garetien-list`). Dieser Test faehrt deshalb GENAU
// DIESEN Weg -- den echten Serverabruf ueber `avesmapsGaretienListeHolen` mit einer gefaelschten
// `fetch`-Antwort -- statt eine nichtexistente Funktion direkt aufzurufen.
//
// Teil A prueft die REINE Funktion `garetienUebernommenFalten` isoliert.
// Teil B fuehrt den ganzen Renderweg AUS und misst am gebauten DOM (`#garetien-list`.innerHTML),
// wie viele Zeilen (`data-key="..."`) wirklich stehen -- nicht am Quelltext.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-uebernommen-falten.test.js

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }

const { api, dom } = ladeImporter(["garetien-listcol", "garetien-tabs"]);

wahr(typeof api.garetienUebernommenFalten === "function",
	"garetienUebernommenFalten fehlt im Export");

// =================================================================================================
// A. Die REINE Funktion, isoliert -- kein DOM.
// =================================================================================================

function fragment(key, stamm) {
	return { key: key, name: key, ebene: "Waelder", typ: "Wald", verbund_angelegt: stamm };
}

{
	const objekte = [
		fragment("ggp:silkerhain:1", "Silker Hain"),
		fragment("ggp:silkerhain:2", "Silker Hain"),
		fragment("ggp:silkerhain:3", "Silker Hain"),
		fragment("ggp:einzelhof", ""),
	];
	const gefaltet = api.garetienUebernommenFalten(objekte);
	gleich(gefaltet.length, 2, "drei Fragmente eines Verbunds + ein Einzelobjekt -> zwei Zeilen");
	gleich(gefaltet[0].key, "ggp:silkerhain:1",
		"der ERSTE Vermerk gewinnt -- die erste Zeile des Verbunds bleibt stehen");
	gleich(gefaltet[1].key, "ggp:einzelhof", "das Objekt ohne Verbund faellt nie heraus");
}

// ⚠️ Zwei VERSCHIEDENE Verbuende in derselben Liste duerfen sich nicht gegenseitig verschlucken --
// `gesehen` muss je Stamm zaehlen, nicht global nach der ersten Fuellung.
{
	const objekte = [
		fragment("a1", "Silker Hain"),
		fragment("b1", "Reichsforst"),
		fragment("a2", "Silker Hain"),
		fragment("b2", "Reichsforst"),
	];
	const gefaltet = api.garetienUebernommenFalten(objekte);
	gleich(gefaltet.length, 2, "zwei Verbuende -> zwei Zeilen, nicht eine");
	gleich(gefaltet.map((o) => o.key).join(","), "a1,b1", "je Stamm die ERSTE Zeile");
}

// Eine leere/undefinierte Liste faellt nicht um.
gleich(api.garetienUebernommenFalten([]).length, 0, "leere Liste -> leere Liste");
gleich(api.garetienUebernommenFalten(undefined).length, 0, "undefined -> leere Liste, kein Wurf");

// Ein Objekt ganz ohne das Feld (nicht nur mit leerem String) bleibt ebenfalls stehen.
{
	const objekte = [{ key: "x", name: "x" }, { key: "y", name: "y" }];
	gleich(api.garetienUebernommenFalten(objekte).length, 2,
		"Objekte ohne verbund_angelegt zaehlen als 'kein Verbund' und bleiben beide stehen");
}

// =================================================================================================
// B. Der ECHTE Renderweg: avesmapsGaretienListeHolen -> avesmapsGaretienListeRendern -> #garetien-list.
//
// 🔴 Nur auf dem Reiter „Uebernommen" wird gefaltet -- ein anderer Reiter mit demselben Feld
// (theoretisch moeglich, praktisch nie: das Feld traegt server-seitig nur ein uebernommenes
// Objekt) zeigt weiterhin jedes Fragment.
// =================================================================================================

function zeilenSchluessel() {
	const html = dom.html("#garetien-list");
	const treffer = html.match(/data-key="[^"]*"/g) || [];
	return treffer.map((t) => t.slice('data-key="'.length, -1));
}

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
	const vierFragmente = [
		fragment("ggp:silkerhain:1", "Silker Hain"),
		fragment("ggp:silkerhain:2", "Silker Hain"),
		fragment("ggp:silkerhain:3", "Silker Hain"),
		fragment("ggp:silkerhain:4", "Silker Hain"),
	];

	await mitAntwort("uebernommen", vierFragmente, function () {
		const keys = zeilenSchluessel();
		gleich(keys.length, 1,
			"vier Fragmente EINES Verbunds auf 'Uebernommen' -> genau EINE gerenderte Zeile: "
			+ keys.join(","));
		gleich(keys[0], "ggp:silkerhain:1", "gezeigt wird die Zeile des ERSTEN Vermerks");
	});

	// Derselbe Datensatz auf "offen" bleibt UNGEFALTET -- die Faltung gilt nur "Uebernommen".
	await mitAntwort("offen", vierFragmente, function () {
		const keys = zeilenSchluessel();
		gleich(keys.length, 4,
			"dieselben vier Fragmente auf 'offen' -> vier Zeilen, keine Faltung: " + keys.join(","));
	});

	// Ein gemischter Fall auf "Uebernommen": zwei Verbuende plus ein Einzelobjekt -> drei Zeilen.
	const gemischt = [
		fragment("a1", "Silker Hain"),
		fragment("a2", "Silker Hain"),
		fragment("b1", "Reichsforst"),
		fragment("b2", "Reichsforst"),
		fragment("c1", ""),
	];
	await mitAntwort("uebernommen", gemischt, function () {
		const keys = zeilenSchluessel();
		gleich(keys.length, 3, "zwei Verbuende + ein Einzelobjekt -> drei Zeilen: " + keys.join(","));
		gleich(keys.join(","), "a1,b1,c1", "je Verbund die erste Zeile, plus das Einzelobjekt");
	});

	console.log("OK: " + checks + " Pruefungen (garetien-uebernommen-falten)");
})();
