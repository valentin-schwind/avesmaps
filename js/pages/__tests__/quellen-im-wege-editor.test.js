// Der Wege-Editor montiert das EINE Quellen-Bauteil -- auf der Abschnitts- UND der Weg-Ebene, als Letztes.
//
// Entwurf: docs/superpowers/specs/2026-09-03-quellen-wege-design.md (§3.4), Mockup docs/quellen-wege-mockup.html.
//
// 🔴 Abschnitt: Getter `state.selected`, Gruppe = die Segmente der Gruppe des gewaehlten Abschnitts, nicht fest.
// 🔴 Weg-Ebene: Anker = erstes Segment, Gruppe = alle Segmente, FEST (alles gilt allen).
// 🔴 „Andere Quelle“ ist an beiden Stellen weg -- Render, Verdrahtung, Entwurf, Rumpf, Modellvergleich.
// 🔴 Der Filter „Quelle“ zaehlt Katalogquellen (`source_count`), nicht mehr das alte Feld.
//
// ⚠️ Das Seitenskript ist eine 3.000-Zeilen-IIFE mit DOM beim Laden; gelesen wird deshalb der Quelltext
// (ohne Kommentare, zeilenendenneutral), das Modell (`wege-editor-model.js`) wird AUSGEFUEHRT.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/quellen-im-wege-editor.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const ohneKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
function rumpfVon(js, kopf) {
	const start = js.indexOf(kopf);
	assert.ok(start >= 0, kopf + " gibt es");
	let tiefe = 0; let ende = -1;
	for (let i = js.indexOf("{", start); i < js.length; i += 1) { if (js[i] === "{") tiefe += 1; else if (js[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i; break; } } }
	return js.slice(start, ende);
}

// ---- 1. Die Seite laedt Bauteil und Blatt, vor dem Seitenskript --------------------------------------------
{
	const html = ohneHtmlKommentare(lies("html/wege-editor.html"));
	assert.ok(/href="\/css\/features\/feature-sources\.css"/.test(html), "feature-sources.css ist verlinkt");
	const reihe = ["/js/ui/source-autocomplete.js", "/js/ui/feature-source-markup.js", "/js/review/review-feature-sources.js", "/js/pages/wege-editor.js"];
	const stellen = reihe.map((src) => html.indexOf('src="' + src + '"'));
	reihe.forEach((src, i) => assert.ok(stellen[i] > 0, src + " wird geladen"));
	for (let i = 1; i < stellen.length; i += 1) assert.ok(stellen[i - 1] < stellen[i], reihe[i - 1] + " vor " + reihe[i]);
}

const js = ohneKommentare(lies("js/pages/wege-editor.js"));
const modell = ohneKommentare(lies("js/pages/wege-editor-model.js"));

// ---- 2. „Andere Quelle“ ist weg ----------------------------------------------------------------------------------
{
	assert.ok(!/other_source/.test(js), "kein other_source mehr im Seitenskript");
	assert.ok(!/other_source/.test(modell), "kein other_source mehr im Modell");
	assert.ok(!/wpSourceUrl|wpGroupSourceUrl/.test(js), "die alten Felder gibt es nicht mehr");
}

// ---- 3. Abschnitt: Quellen als letzter Block vor der Speicherleiste, Mount in wireDetail ---------------------
{
	const render = rumpfVon(js, "function renderDetail()");
	const quellen = render.indexOf('<div class="dt-grp">Quellen</div>');
	assert.ok(quellen > 0, "renderDetail baut die Gruppe „Quellen“");
	assert.ok(render.indexOf('id="wpFeatureSources"', quellen) > quellen, "… mit dem Host wpFeatureSources");
	const wiki = render.indexOf('id="wpWikiAssign"');
	const savebar = render.indexOf('<div class="avm-savebar">');
	assert.ok(wiki > 0 && wiki < quellen && quellen < savebar, "die Quellen stehen nach der Wiki-Zuweisung und vor der Speicherleiste -- als letzter Block");
	const wire = rumpfVon(js, "function wireDetail()");
	const mount = /mountFeatureSourceEditor\(\s*\$\("wpFeatureSources"\),\s*"path",\s*function \(\) \{ return state\.selected; \},\s*\{[^}]*gruppe:[^}]*\}/.exec(wire) || /mountFeatureSourceEditor\(\s*\$\("wpFeatureSources"\),\s*"path",\s*\(\) => state\.selected,\s*\{[^}]*gruppe:/.exec(wire);
	assert.ok(mount, "wireDetail montiert das EINE Bauteil auf path mit Getter state.selected und einer Gruppe");
	assert.ok(/fest:\s*false/.test(wire.slice(wire.indexOf("wpFeatureSources"))), "am Abschnitt ist nichts fest");
	const abMount = wire.slice(wire.indexOf("wpFeatureSources"));
	const rumpf = rumpfVon(abMount, "publicIds: function ()");
	assert.ok(/wpGroupKeyOf\(/.test(rumpf) && /state\.ways\s*\.filter\(/.test(rumpf), "die Gruppe kommt ueber den Modellschluessel aus ALLEN Wegen (state.ways) -- ein Filter darf „alle N Abschnitte“ nicht verkleinern");
	assert.ok(!/visibleWays\(|groupedWays\(|findGroup\(/.test(rumpf), "… und nie aus der gefilterten Liste");
}

// ---- 4. Weg-Ebene: Quellen vor der Speicherleiste, Mount FEST in wireGroupDetail ------------------------------
{
	const render = rumpfVon(js, "function renderGroupDetail(host)");
	const quellen = render.indexOf('<div class="dt-grp">Quellen</div>');
	assert.ok(quellen > 0, "renderGroupDetail baut die Gruppe „Quellen“");
	assert.ok(render.indexOf('id="wpGroupFeatureSources"', quellen) > quellen, "… mit dem Host wpGroupFeatureSources");
	const savebar = render.indexOf('<div class="avm-savebar">');
	assert.ok(quellen < savebar, "vor der Speicherleiste");
	const wire = rumpfVon(js, "function wireGroupDetail()");
	const ab = wire.indexOf("wpGroupFeatureSources");
	assert.ok(ab > 0, "wireGroupDetail montiert auf wpGroupFeatureSources");
	assert.ok(/"path"/.test(wire.slice(ab)), "Objektart path");
	assert.ok(/fest:\s*true/.test(wire.slice(ab)), "auf der Weg-Ebene ist die Gruppe FEST -- alles gilt allen");
	assert.ok(/segments\.map\(function \(s\) \{ return s\.public_id; \}\)/.test(wire.slice(ab)), "die Gruppe sind alle Segmente, ueber ihre public_id");
}

// ---- 5. Der Filter „Quelle“ zaehlt Katalogquellen ---------------------------------------------------------------
{
	const kat = rumpfVon(js, "function sourceCategory(way)");
	assert.ok(/source_count/.test(kat), "sourceCategory liest source_count");
	assert.ok(/return "andere"/.test(kat) && /return "wiki"/.test(kat) && /return "keine"/.test(kat), "die drei Lesarten bleiben");
}

// ---- 6. Das Modell, ausgefuehrt: kein other_source in Stand und Vergleich ---------------------------------------
{
	const vm = require("vm");
	const context = { console, window: {} };
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(lies("js/pages/wege-editor-model.js"), context);
	const segmente = [
		{ public_id: "a", name: "Schattenbachpass", feature_subtype: "Gebirgspass", show_label: false, allowed_transports: ["lightWalker"] },
		{ public_id: "b", name: "Schattenbachpass", feature_subtype: "Gebirgspass", show_label: false, allowed_transports: ["lightWalker"] },
	];
	const stand = context.wpGroupFieldStates(segmente, ["lightWalker", "horseCarriage"]);
	assert.ok(!("other_source" in stand), "der Feldstand kennt other_source nicht mehr");
	const felder = context.wpGroupChangedFields(stand, { name: "Schattenbachpass", show_label: false, feature_subtype: "Gebirgspass", transports: { lightWalker: "an", horseCarriage: "aus" } });
	assert.deepStrictEqual([...felder], [], "nichts angefasst, nichts geaendert -- und kein Phantomfeld other_source");
	assert.strictEqual(context.wpGroupKeyOf({ name: "Schattenbachpass", feature_subtype: "Gebirgspass", wiki_path: null }), "name:Gebirgspass:Schattenbachpass", "wpGroupKeyOf: der Namensschluessel");
	assert.strictEqual(context.wpGroupKeyOf({ name: "x", feature_subtype: "Weg", wiki_path: { wiki_key: "reichsstrasse-2" } }), "wiki:reichsstrasse-2", "wpGroupKeyOf: der Wiki-Schluessel gewinnt");
	assert.strictEqual(context.wpGroupWays(segmente)[0].key, context.wpGroupKeyOf(segmente[0]), "wpGroupWays gruppiert ueber DENSELBEN Schluessel -- keine zweite Rechnung");
	const mitWiki = { public_id: "w", name: "x", feature_subtype: "Weg", wiki_path: { wiki_key: "reichsstrasse-2" } };
	assert.strictEqual(context.wpGroupWays([mitWiki])[0].key, "wiki:reichsstrasse-2", "… auch beim Wiki-Schluessel, wo eine Namensrechnung still etwas anderes ergaebe");
}

console.log("quellen-im-wege-editor: alle Zusicherungen erfuellt");
