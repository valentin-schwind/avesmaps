// Der Sync-Monitor („Wiki-Daten und Eigene Overrides") montiert das EINE Quellen-Bauteil -- ganz unten.
//
// Owner 03.09.2026: „bei Wiki-Daten und Eigene Override fehlts noch" und „im syncmonitor, wie im
// territoriumseditor mit klapptext". Mockup: docs/quellen-neue-quelle-mockup.html (Karte 3).
//
// 🔴 Zehnte Montagestelle, dieselben vier Regeln wie ueberall: Objektart `territory`, Schluessel
// `political_territory.public_id` (hier `n.public_id` aus dem model_tree, sync-monitor-tree.php:310),
// Getter liest bei JEDER Anfrage den dann gewaehlten Knoten, der vorige Host wird geloest, bevor
// innerHTML ihn wegwirft. Und: als LETZTE Gruppe des Panels -- Quellen stehen ueberall unten.
//
// ⚠️ Der Monitor ist EINE Datei mit einem 1.800-Zeilen-Seitenskript; renderDetail liest ein
// Dutzend Modulvariablen. Dieser Test liest deshalb den Quelltext (ohne Kommentare, zeilenendenneutral)
// und schneidet renderDetail aus -- der Mount selbst (mountFeatureSourceEditor) ist in
// quellen-neue-quelle-falte.test.js und quellen-art-korrigieren.test.js AUSGEFUEHRT.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-im-sync-monitor.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const seite = lies("html/wiki-sync-monitor.html");
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const ohneJsKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");

// ---- 1. Die Seite laedt Bauteil und Blatt selbst, in der Reihenfolge der anderen Editorseiten -----
{
	const html = ohneHtmlKommentare(seite);
	assert.ok(/href="\/css\/features\/feature-sources\.css"/.test(html), "feature-sources.css ist verlinkt");
	const reihe = ["/js/ui/source-autocomplete.js", "/js/ui/feature-source-markup.js", "/js/review/review-feature-sources.js"];
	const stellen = reihe.map((src) => html.indexOf('src="' + src + '"'));
	reihe.forEach((src, i) => assert.ok(stellen[i] > 0, src + " wird geladen"));
	assert.ok(stellen[0] < stellen[1] && stellen[1] < stellen[2], "source-autocomplete vor feature-source-markup vor review-feature-sources");
	// Das Seitenskript, das den Mount ruft, kommt NACH den dreien.
	const seitenskript = html.indexOf("function renderDetail()");
	assert.ok(seitenskript > stellen[2], "das Seitenskript mit renderDetail steht hinter den Modulskripten");
}

// ---- 2. renderDetail: der Kasten als LETZTE Gruppe, nur mit public_id, nur im Ansichtsmodus ------
{
	const js = ohneJsKommentare(seite);
	const start = js.indexOf("function renderDetail(){");
	assert.ok(start > 0, "renderDetail gibt es");
	let tiefe = 0; let ende = -1;
	for (let i = js.indexOf("{", start); i < js.length; i += 1) {
		if (js[i] === "{") tiefe += 1; else if (js[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i; break; } }
	}
	const rumpf = js.slice(start, ende);
	const editRueckkehr = rumpf.indexOf("if(editMode){");
	const block = rumpf.indexOf("const quellenBlock");
	assert.ok(block > 0, "renderDetail baut den quellenBlock");
	assert.ok(editRueckkehr > 0 && editRueckkehr < block, "der Bearbeiten-Modus kehrt VOR dem Kasten zurueck -- dort geht es um die Wiki-Felder");
	assert.ok(/const quellenBlock = \(n\.public_id && typeof mountFeatureSourceEditor === 'function'\)/.test(rumpf),
		"nur ein Knoten MIT public_id (und geladenem Bauteil) bekommt den Kasten");
	assert.ok(rumpf.includes("'<div class=\"dt-grp\">Quellen</div><div id=\"dtFeatureSources\"></div>'"),
		"die Gruppe heisst „Quellen“ und hat die Bauform des Ortseditors (.dt-grp)");
	const innerHtml = /box\.innerHTML = head \+ lic \+ coatRow \+ `[^`]*` \+ `[^`]*` \+ bindung \+ quellenBlock;/.exec(rumpf);
	assert.ok(innerHtml, "der Kasten haengt als LETZTES Stueck am Panel -- nach bindung");
	const mount = /mountFeatureSourceEditor\(\$\('dtFeatureSources'\), 'territory', \(\) => \{\s*const aktuell = selectedKey \? BYKEY\.get\(selectedKey\) : null;\s*return \(aktuell && aktuell\.public_id\) \|\| '';\s*\}, \{ escape: esc \}\)/.exec(rumpf);
	assert.ok(mount, "montiert wird das EINE Bauteil auf territory, und der Getter liest bei JEDER Anfrage den gewaehlten Knoten (selectedKey/BYKEY)");
	// ⚠️ DAS Einsetzen des Panels -- nicht das erste `box.innerHTML =` im Rumpf: die Leer- und die
	// Bearbeiten-Rueckkehr darueber setzen es auch (und stehen VOR dem Kasten, das prueft Zeile oben).
	const einsetzen = rumpf.indexOf("box.innerHTML = head + lic");
	assert.ok(einsetzen > 0, "das Panel wird mit head + lic + … eingesetzt");
	assert.ok(rumpf.indexOf("mountFeatureSourceEditor(") > einsetzen, "montiert wird NACH dem Einsetzen des Markups");
	assert.ok(/const alterQuellenHost = \$\('dtFeatureSources'\);\s*if \(alterQuellenHost && typeof alterQuellenHost\.__fsDetachAutocomplete === 'function'\) \{ alterQuellenHost\.__fsDetachAutocomplete\(\); \}/.test(rumpf),
		"der vorige Host wird geloest, BEVOR innerHTML ihn wegwirft");
	assert.ok(rumpf.indexOf("alterQuellenHost.__fsDetachAutocomplete()") < einsetzen, "… und zwar davor");
}

console.log("quellen-im-sync-monitor: alle Zusicherungen erfuellt");
