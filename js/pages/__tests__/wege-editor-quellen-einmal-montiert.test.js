// Der Wege-Editor montiert den Quellenkasten EINMAL je Abschnittsklick -- erst mit der Detail-Antwort.
//
// 💣 Der Befund (AGENTS.md §11, Wege-Quellen, seit 03.09.2026 als „offen“ gefuehrt): selectWay() zeichnet
// die Eigenschaften-Spalte ZWEIMAL -- sofort aus den Listendaten (damit nichts flackert) und noch einmal
// mit der Detail-Antwort (die Landschaften kommen nur von dort). Jeder Aufbau montierte den Quellenkasten,
// und der holt beim Montieren seine Liste vom Server: zwei `list`-Anfragen je Klick, die erste verworfen.
//
// 🔴 Die Regel: `state.detailLaedt` ist zwischen Abruf und Antwort true, und wireDetail() montiert dann
//    nicht. Geloest wird der Riegel im then VOR renderDetail() -- sonst montiert auch der zweite Aufbau
//    nichts -- UND im catch, gefolgt von einem Neuzeichnen: ein Fehlschlag darf die Spalte nicht ohne
//    Kasten stehen lassen, das laese sich wie „dieser Abschnitt hat keine Quellen“.
//
// ⚠️ Das Seitenskript ist eine 3.000-Zeilen-IIFE mit DOM beim Laden; gelesen wird deshalb der Quelltext,
//    ohne Kommentare, zeilenendenneutral, je Funktion ausgeschnitten (dieselbe Form wie
//    quellen-im-wege-editor.test.js). Gegen zwei Mutationen gefahren: Riegel aus der Mount-Bedingung
//    genommen · Loesung im then entfernt -- beide rot.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/wege-editor-quellen-einmal-montiert.test.js
// Mutationsprobe:            WEGE_EDITOR_DATEI=<mutierte Kopie> node …

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const DATEI = process.env.WEGE_EDITOR_DATEI || path.join(WURZEL, "js", "pages", "wege-editor.js");
const lies = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
function rumpfVon(js, kopf) {
	const start = js.indexOf(kopf);
	assert.ok(start >= 0, kopf + " gibt es");
	let tiefe = 0; let ende = -1;
	for (let i = js.indexOf("{", start); i < js.length; i += 1) {
		if (js[i] === "{") tiefe += 1;
		else if (js[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i; break; } }
	}
	assert.ok(ende > start, kopf + " hat einen geschlossenen Rumpf");
	return js.slice(start, ende);
}

const js = ohneKommentare(lies(DATEI));

// ---- 1. Der Zustand kennt den Riegel, und er startet offen -------------------------------------------------
{
	const state = rumpfVon(js, "var state = {");
	assert.ok(/detailLaedt:\s*false/.test(state), "state traegt detailLaedt und startet mit false");
}

// ---- 2. selectWay: Riegel VOR dem Abruf und vor dem ersten Aufbau, geloest im then UND im catch ------------
{
	const sel = rumpfVon(js, "function selectWay(");
	const setzt = sel.indexOf("state.detailLaedt = true");
	const abruf = sel.indexOf("getJson(");
	const ersterAufbau = sel.indexOf("renderDetail()");
	assert.ok(setzt > 0, "selectWay setzt den Riegel");
	assert.ok(abruf > setzt, "… VOR dem Detail-Abruf");
	assert.ok(ersterAufbau > setzt, "… und VOR dem ersten renderDetail() -- sonst montiert der erste Aufbau doch");

	const then = sel.indexOf(".then(", abruf);
	const fang = sel.indexOf(".catch(", then);
	assert.ok(then > 0 && fang > then, "der Abruf hat then und catch");
	const imThen = sel.slice(then, fang);
	const imCatch = sel.slice(fang);

	const loesung = imThen.indexOf("state.detailLaedt = false");
	const zweiterAufbau = imThen.indexOf("renderDetail()");
	assert.ok(loesung > 0, "im then wird der Riegel geloest");
	assert.ok(zweiterAufbau > loesung, "… VOR renderDetail() -- sonst montiert auch der zweite Aufbau nichts, und der Kasten fehlt fuer immer");

	assert.ok(/state\.detailLaedt = false/.test(imCatch), "im catch wird der Riegel ebenfalls geloest");
	assert.ok(/renderDetail\(\)/.test(imCatch), "… und neu gezeichnet: der Kasten kommt auch nach einem Fehlschlag");
}

// ---- 3. wireDetail: der Abschnitts-Mount haengt an der Bedingung ------------------------------------------
{
	const wire = rumpfVon(js, "function wireDetail()");
	const mount = wire.indexOf('mountFeatureSourceEditor($("wpFeatureSources")');
	assert.ok(mount > 0, "wireDetail montiert den Abschnittskasten");
	const bedingung = wire.slice(wire.lastIndexOf("if (", mount), mount);
	assert.ok(/!state\.detailLaedt/.test(bedingung),
		"… nur, wenn das Detail nicht gerade laedt (!state.detailLaedt steht in der Mount-Bedingung)");
	assert.ok(!/detailLaedt/.test(wire.slice(mount)), "hinter dem Mount fasst wireDetail den Riegel nicht mehr an");
}

// ---- 4. Und die Weg-Ebene bleibt unberuehrt: dort gibt es keinen zweiten Aufbau ---------------------------
{
	const gruppe = js.slice(js.indexOf('mountFeatureSourceEditor($("wpGroupFeatureSources")') - 400,
		js.indexOf('mountFeatureSourceEditor($("wpGroupFeatureSources")'));
	assert.ok(!/detailLaedt/.test(gruppe), "der Weg-Ebenen-Mount fragt den Abschnitts-Riegel nicht");
}

console.log("wege-editor-quellen-einmal-montiert: ok");
