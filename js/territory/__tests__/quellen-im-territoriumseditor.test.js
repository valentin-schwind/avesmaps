// Die Verdrahtung des Quellen-Bauteils im Territoriumseditor -- Markup, Skripte, Bauprodukt.
//
// Entwurf: docs/superpowers/specs/2026-09-03-quellen-herrschaftsgebiete-design.md,
// Mockup docs/quellen-herrschaftsgebiete-mockup.html (sein VERTRAG bindet die Bedienhoehen-Ausnahme
// in css/pages/political-territory-editor.css; dieser Test haelt den Rest).
//
// 🔴 Das reine Modul (territory-quellen-anschluss.js) wird in territory-quellen-anschluss.test.js
// AUSGEFUEHRT. Hier steht, was nur der Quelltext beantworten kann: dass der Editor es an der EINEN
// Stelle ruft, durch die jeder Knotenwechsel geht, dass die Skripte in der richtigen Reihenfolge
// kommen, dass das Feld „Andere Quelle" restlos weg ist -- und dass das gescopte Bauprodukt die
// Modulregeln traegt, sonst sieht der Kasten hier anders aus als an den acht anderen Stellen.
//
// ⚠️ Quelltext wird OHNE Kommentare gelesen (AGENTS.md: ein Test darf nicht an der Warnung
// anschlagen, die vor dem Muster warnt) und zeilenendenneutral (hier CRLF, im Tor LF).
//
// Aus der Wurzel des Repos:  node js/territory/__tests__/quellen-im-territoriumseditor.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (js) => js
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

// ---- 1. Das Markup: die Sektion „Quellen" als LETZTE des Formulars -----------------------------
// 🔴 Owner 03.09.2026: „generell können quellen immer unten/als letztes in den listen auftauchen".
// Die Spaltenweiche (Test 5) legt sie in die Spalte der Wiki-Daten; dort ist sie durch die
// Dokumentreihenfolge die letzte -- nach den Konfliktparteien. Die stabile Sortierung in
// territory-editor-panel-columns.js ordnet unbekannte Sektionen nach Dokumentreihenfolge.
{
	const html = ohneHtmlKommentare(lies("html/political-territory-editor.html"));
	const wiki = html.indexOf('id="infoBox"');
	const konflikt = html.indexOf('id="contestedBlock"');
	const sektion = html.indexOf('id="territoryFeatureSourcesSection"');
	const formEnde = html.indexOf("</form>", wiki);
	assert.ok(wiki > 0, "die Wiki-Datenbox steht im Markup");
	assert.ok(sektion > 0, "die Sektion territoryFeatureSourcesSection steht im Markup");
	assert.ok(sektion > konflikt, "die Sektion steht NACH den Konfliktparteien -- als letzte der Wiki-Daten-Spalte");
	assert.ok(sektion < formEnde, "… und noch IM Formular");
	assert.ok(!/<section[^>]*class="[^"]*manual-data-section/.test(html.slice(html.indexOf("</section>", sektion), formEnde)),
		"nach ihr kommt keine weitere Sektion -- sie ist die letzte");

	const tag = html.slice(html.lastIndexOf("<section", sektion), html.indexOf(">", sektion) + 1);
	assert.ok(/class="[^"]*\bmanual-data-section\b/.test(tag), "dieselbe Sektionsform wie die Nachbarn: " + tag);
	assert.ok(/\shidden(\s|>|=)/.test(tag), "sie startet versteckt -- der Anschluss blendet sie je Knoten ein");
	assert.ok(/aria-label="Quellen"/.test(tag), "aria-label Quellen");

	const rumpf = html.slice(sektion, html.indexOf("</section>", sektion));
	assert.ok(/<h3>Quellen<\/h3>/.test(rumpf), "Ueberschrift „Quellen“");
	assert.ok(rumpf.includes("Quellen wirken <b>sofort</b> — sie brauchen kein „Speichern“."),
		"der Hinweissatz ist zeichengleich der des Beschriftungsdialogs");
	assert.ok(/id="territoryFeatureSources"/.test(rumpf), "der Host des Bauteils");
	assert.ok(/class="manual-data-section-header"/.test(rumpf), "Kopfzeile wie bei den Wiki-Daten");

	["otherSourceFields", "otherSourceUrlInput", "otherSourceLabelInput", "other_source_url", "other_source_label"]
		.forEach((kennung) => assert.ok(!html.includes(kennung), "„Andere Quelle“ ist weg: " + kennung));
}

// ---- 2. Die Standalone-Seite laedt das Bauteil selbst, in der Reihenfolge der anderen Editoren ---
{
	const html = ohneHtmlKommentare(lies("html/political-territory-editor.html"));
	assert.ok(/href="\/css\/features\/feature-sources\.css"/.test(html), "feature-sources.css ist verlinkt");
	const reihe = ["/js/ui/source-autocomplete.js", "/js/ui/feature-source-markup.js",
		"/js/review/review-feature-sources.js", "/js/territory/territory-quellen-anschluss.js",
		"/js/territory/territory-editor-embedded.js"];
	const stellen = reihe.map((src) => html.indexOf('src="' + src + '"'));
	reihe.forEach((src, i) => assert.ok(stellen[i] > 0, src + " wird geladen"));
	for (let i = 1; i < stellen.length; i += 1) {
		assert.ok(stellen[i - 1] < stellen[i], reihe[i - 1] + " kommt vor " + reihe[i]);
	}
}

// ---- 3. Der Inline-Host fuehrt dieselben Skripte, vor dem Editor ------------------------------
{
	const host = ohneKommentare(lies("js/territory/territory-editor-inline-host.js"));
	const liste = host.match(/const EDITOR_SCRIPTS = \[([\s\S]*?)\];/);
	assert.ok(liste, "EDITOR_SCRIPTS steht im Host");
	const eintraege = Array.from(liste[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
	const reihe = ["/js/ui/source-autocomplete.js", "/js/ui/feature-source-markup.js",
		"/js/review/review-feature-sources.js", "/js/territory/territory-quellen-anschluss.js",
		"/js/territory/territory-editor-embedded.js"];
	const stellen = reihe.map((src) => eintraege.indexOf(src));
	reihe.forEach((src, i) => assert.ok(stellen[i] >= 0, src + " steht in EDITOR_SCRIPTS"));
	for (let i = 1; i < stellen.length; i += 1) {
		assert.ok(stellen[i - 1] < stellen[i], reihe[i - 1] + " steht vor " + reihe[i]);
	}
	const version = host.match(/const ASSET_VERSION = "([^"]+)"/);
	assert.ok(version, "ASSET_VERSION steht im Host");
	assert.notStrictEqual(version[1], "20260823a", "ASSET_VERSION ist gebumpt (AGENTS.md §7) -- sonst kommt das alte Editor-Markup aus dem Zwischenspeicher");
}

// ---- 4. Der Editor ruft den Anschluss an der EINEN Stelle, durch die jeder Knotenwechsel geht --
{
	const editor = ohneKommentare(lies("js/territory/territory-editor-embedded.js"));
	assert.ok(!/otherSource/.test(editor), "kein otherSource mehr im Editor -- weder Register, noch Zustand, noch Rumpf");
	const start = editor.indexOf("function renderInfoBox(node) {");
	assert.ok(start > 0, "renderInfoBox gibt es");
	let tiefe = 0; let ende = -1;
	for (let i = editor.indexOf("{", start); i < editor.length; i += 1) {
		if (editor[i] === "{") tiefe += 1;
		else if (editor[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i; break; } }
	}
	const rumpf = editor.slice(start, ende + 1);

	// 🔴 AUSGESCHNITTEN UND AUSGEFUEHRT, nicht gelesen: ein `if (false)` vor dem Aufruf liesse jede
	// Quelltextsuche gruen (die Mutationsprobe hat genau das gezeigt). Was die Funktion an Nachbarn
	// braucht, bekommt sie als Attrappe; gemessen wird nur, ob und womit sie den Anschluss ruft.
	const vm = require("vm");
	function knoten(id) {
		const el = {
			id, innerHTML: "", textContent: "", className: "", hidden: false, style: {}, dataset: {},
			classList: { add() {}, remove() {}, contains() { return false; } },
			appendChild() {}, addEventListener() {}, setAttribute() {}, querySelector() { return null; },
			cloneNode() { return knoten(id); }, replaceWith() {},
		};
		return el;
	}
	const register = new Map();
	const document = {
		getElementById: (id) => { if (!register.has(id)) register.set(id, knoten(id)); return register.get(id); },
		createElement: (tag) => knoten("<" + tag + ">"),
		createTextNode: () => knoten("#text"),
	};
	const aufrufe = [];
	const mountAttrappe = function mountFeatureSourceEditor() {};
	const context = {
		console, document, window: {},
		els: { infoBox: knoten("infoBox"), detailInfo: knoten("detailInfo") },
		escapeHtml: (s) => String(s),
		normalizeText: (s) => String(s == null ? "" : s).trim(),
		formatInfoValue: (v) => String(v),
		getNodePath: (n) => [n],
		appendEffectiveWikiRows() {}, renderContestedBlock() {}, avesmapsCoatSrc: (u) => u,
		encodeURIComponent,
		mountFeatureSourceEditor: mountAttrappe,
		avesmapsTerritoriumQuellenAnschliessen: (opts) => { aufrufe.push(opts); return null; },
	};
	context.globalThis = context;
	vm.createContext(context);
	let renderInfoBox = null;
	for (let versuch = 0; versuch < 40 && !renderInfoBox; versuch += 1) {
		try {
			renderInfoBox = vm.runInContext("(function () { let quellenKnoten = null; " + rumpf + " return renderInfoBox; })()", context);
		} catch (fehler) {
			const t = /^(\w+) is not defined$/.exec(fehler.message);
			if (!t) throw fehler;
			context[t[1]] = function () { return ""; };
		}
	}
	assert.strictEqual(typeof renderInfoBox, "function", "renderInfoBox laesst sich ausschneiden");
	const knotenA = { label: "Sternenbund", row: { public_id: "t-1", wiki_key: "wiki:sternenbund", coat_of_arms_url: "" } };
	for (let versuch = 0; versuch < 40; versuch += 1) {
		try { renderInfoBox(knotenA); break; } catch (fehler) {
			const t = /^(\w+) is not defined$/.exec(fehler.message);
			if (!t) throw fehler;
			context[t[1]] = function () { return ""; };
			aufrufe.length = 0;
		}
	}
	assert.strictEqual(aufrufe.length, 1, "renderInfoBox ruft avesmapsTerritoriumQuellenAnschliessen genau einmal -- der Trichter aller Knotenwechsel");
	const o = aufrufe[0];
	assert.strictEqual(o.node, knotenA, "mit dem gezeigten Knoten");
	assert.strictEqual(o.mount, mountAttrappe, "montiert wird das EINE Bauteil mountFeatureSourceEditor");
	assert.strictEqual(o.sektion, document.getElementById("territoryFeatureSourcesSection"), "die Sektion aus dem Dokument");
	assert.strictEqual(o.host, document.getElementById("territoryFeatureSources"), "der Host aus dem Dokument");
	assert.strictEqual(typeof o.escape, "function", "der Maskierer des Editors reist mit");
	assert.strictEqual(o.aktuellerKnoten(), knotenA, "der Getter liefert den gezeigten Knoten");
	// 💣 Und nach dem naechsten Knoten liefert DERSELBE Getter den neuen -- die lebende Referenz.
	const knotenB = { label: "Freie Hoefe", row: { public_id: "k-41", wiki_key: "eigener-knoten:knoten041" } };
	renderInfoBox(knotenB);
	assert.strictEqual(aufrufe.length, 2);
	assert.strictEqual(o.aktuellerKnoten(), knotenB, "der Getter des ERSTEN Aufrufs zeigt jetzt auf den zweiten Knoten");
}

// ---- 5. Die Spalten: die Quellen stehen in der Spalte der Wiki-Daten ---------------------------
{
	const spalten = ohneKommentare(lies("js/territory/territory-editor-panel-columns.js"));
	const zeile = spalten.split("\n").find((z) => z.includes("#infoBox") && z.includes("#contestedBlock"));
	assert.ok(zeile, "die Spaltenweiche fuer Wiki-Daten und Konfliktparteien steht da");
	assert.ok(zeile.includes("#territoryFeatureSources"), "die Quellen gehen in DIESELBE Spalte wie die Wiki-Daten: " + zeile.trim());
}

// ---- 6. Das gescopte Bauprodukt traegt die Modulregeln -- mechanisch, aus der vierten Quelle ----
{
	const erzeuger = ohneKommentare(lies("tools/scope_editor_css.js"));
	const quellen = erzeuger.match(/const SOURCES = \[([\s\S]*?)\];/);
	assert.ok(quellen, "SOURCES steht im Erzeuger");
	const liste = Array.from(quellen[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
	assert.ok(liste.includes("css/features/feature-sources.css"),
		"css/features/feature-sources.css ist Quelle des Erzeugers -- sonst schlagen die ID-gescopten Elementregeln jede Modulklasse");
	assert.strictEqual(liste[liste.length - 1], "css/features/feature-sources.css",
		"… und zwar die LETZTE, damit die Modulregeln bei gleicher Spezifitaet die spaeteren sind");

	const produkt = lies("css/pages/political-territory-editor-inline.css");
	["#political-territory-editor-host .fs-editor {", "#political-territory-editor-host .fs-row__remove {",
		"#political-territory-editor-host .fs-actions__prim {", "#political-territory-editor-host .fs-scope {"]
		.forEach((regel) => assert.ok(produkt.includes(regel), "das Bauprodukt traegt " + regel));
	const ausnahmen = (produkt.match(/:not\(\.fs-editor \*\)/g) || []).length;
	assert.ok(ausnahmen >= 13, "die drei Bedienhoehen-Regeln nehmen .fs-editor * aus (13 Selektoren), gezaehlt: " + ausnahmen);
}

// ---- 7. 💣 Und KEINE Bedienhoehen-Regel ohne die Ausnahme ist stehen geblieben -----------------
// „A, aber NUR A" braucht zwei Zusicherungen: dass die Ausnahme da ist (der Vertrag im Mockup) und
// dass die alte Regel ohne sie nicht daneben weiterlebt -- die saehe im Diff wie eine harmlose
// Dublette aus und gewaenne mit (1,2,1) trotzdem.
{
	const css = lies("css/pages/political-territory-editor.css").replace(/\/\*[\s\S]*?\*\//g, "");
	const ohneAusnahme = css.match(/button:not\(\.tree-footer-button\):not\(\.breadcrumb-cycle\)\s*[,{]/g) || [];
	assert.deepStrictEqual(ohneAusnahme, [], "jede Bedienhoehen-Regel fuer button traegt :not(.fs-editor *): " + ohneAusnahme.join(" | "));
	const block = css.slice(css.indexOf("--pte-control-h: 32px"), css.indexOf('input[type="color"] {', css.indexOf("--pte-control-h: 32px")));
	["select", 'input[type="text"]', 'input[type="url"]', 'input[type="search"]', 'input[type="number"]'].forEach((sel) => {
		const nackt = new RegExp("(^|\\n)" + sel.replace(/[[\]"]/g, "\\$&") + "\\s*[,{]", "g");
		assert.ok(!nackt.test(block), sel + " im Bedienhoehen-Block traegt die Ausnahme");
	});
}

console.log("quellen-im-territoriumseditor: alle Zusicherungen erfuellt");
