// „Neue Quelle einfuegen" ist eine FALTE -- zu beim Oeffnen, zu nach jedem Eintrag, die Bestaetigung
// steht darunter.
//
// Owner 03.09.2026: „alle boxen unter einem klapptext verschwinden ("Neue Quelle einfügen"), damit die
// formularfelder sonst nich alle riesengroß sichtbar sind" -- und dann: „klapptext zu beim öffnen und
// nach dem eintrag, […] auch im ortseditor mit klapptext (immer mit klappe zu)".
// Mockup: docs/quellen-neue-quelle-mockup.html (Karte 2).
//
// 🔴 EIN Bauteil, neun Montagestellen: die Falte liegt im geteilten Bauer (renderFeatureSourceEditorHtml),
// deshalb hat sie jeder Wirt -- Territoriumseditor, Ortseditor, Sync-Monitor, Kartendialoge -- ohne eine
// Zeile bei sich. Ein Wirt, der sie nicht will, muesste den Bauer umgehen; genau das gibt es nicht.
//
// 💣 DIE BESTAETIGUNG STEHT AUSSERHALB DER FALTE. Nach einem Eintrag zeichnet das Bauteil aus der
// Serverantwort neu, und die Falte ist dann wieder zu -- stuende „Hinzugefuegt: „X"." darin, verschwaende
// sie genau in dem Moment, in dem sie gebraucht wird (die Meldung vom 03.09.2026 frueh, 625c20f84).
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-neue-quelle-falte.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const modul = require(path.join(WURZEL, "js/review/review-feature-sources.js"));
const render = modul.renderFeatureSourceEditorHtml;
const tr = (k, f) => f;
const esc = (v) => String(v);

const ZUSTAND = {
	wiki_url: "https://de.wiki-aventurica.de/wiki/Sternenbund",
	sources: [
		{ source_id: 917, url: "https://www.ulisses-ebooks.de/de/product/223225/", label: "Aventurischer Bote Nr. 185", type: "aventurischer_bote", official: true, origin: "wiki_publication", reference_kind: "ausfuehrlich", pages: "4, 2" },
		{ source_id: 5, url: "https://www.westlande.de/index.php?title=Sternenbund", label: "Sternenbund", type: "briefspiel", official: false, origin: "manual", license: "cc-by-sa-4.0" },
	],
};

// ---- 1. Die Falte: nativ, zu, mit Hinweis und Formular darin -------------------------------------------
const html = render(ZUSTAND, { escape: esc, tr });
{
	const falte = html.indexOf('<details class="fs-add-fold">');
	assert.ok(falte > 0, "es gibt die Falte fs-add-fold, als natives <details>");
	assert.ok(!/<details class="fs-add-fold"[^>]*\sopen/.test(html), "sie ist ZU -- beim Oeffnen des Kastens wie nach jedem Eintrag");
	const ende = html.indexOf("</details>", falte);
	const rumpf = html.slice(falte, ende);
	assert.ok(rumpf.includes('<summary class="fs-add-fold__toggle">Neue Quelle einfügen</summary>'), "der Klapptext heisst „Neue Quelle einfügen“");
	assert.ok(rumpf.includes('<div class="fs-hint">'), "der Hinweistext liegt IN der Falte -- er erklaert das Eintragen");
	assert.ok(rumpf.includes('class="fs-row fs-row--add"'), "das Eingabeformular liegt IN der Falte");
	assert.ok(rumpf.includes("fs-scope"), "… samt seinen drei Reichweiten-Kaesten");
	assert.ok(rumpf.includes('data-fs-add-submit'), "… und dem Speichern-Knopf");
	assert.ok(html.indexOf('<summary class="fs-add-fold__toggle">') < html.indexOf('<div class="fs-hint">'), "der Klapptext steht VOR dem Hinweis");
}

// ---- 2. Die Bestaetigung steht AUSSERHALB der Falte, danach -----------------------------------------------
{
	const falteEnde = html.indexOf("</details>", html.indexOf('<details class="fs-add-fold">'));
	const note = html.indexOf('data-fs-note');
	assert.ok(note > falteEnde, "die Meldezeile [data-fs-note] steht NACH der Falte -- sichtbar, auch wenn die Falte zu ist");
	assert.strictEqual((html.match(/data-fs-note/g) || []).length, 1, "genau eine Meldezeile");
	assert.ok(html.indexOf("</details>", falteEnde + 1) === -1 || html.indexOf('data-fs-note') < html.indexOf("</details>", falteEnde + 1), "… und nicht in einer zweiten Falte");
}

// ---- 3. Die Reihenfolge: Wiki-Zeile, Quellen, dann erst die Falte ---------------------------------------
{
	const wiki = html.indexOf("fs-row--wiki");
	const zeile = html.indexOf('data-source-id="5"');
	const falte = html.indexOf('<details class="fs-add-fold">');
	assert.ok(wiki > 0 && wiki < zeile && zeile < falte, "Wiki-Zeile, dann die Quellen, dann die Falte -- das Eintragen steht unter den Quellen");
}

// ---- 4. Der Klappkasten der LISTE bleibt, was er war -- die Falte ist kein zweiter .fs-more --------------
{
	assert.ok(!html.includes('<details class="fs-more">'), "bei zwei Quellen gibt es keinen Listen-Klappkasten (das hat quellenliste-klappen.test.js festgenagelt)");
	const viele = render({ wiki_url: "", sources: Array.from({ length: 8 }, (_, i) => ({ source_id: i + 1, url: "https://x/" + i, label: "Q" + i, type: "roman", official: true, origin: "manual" })) }, { escape: esc, tr });
	assert.strictEqual((viele.match(/<details class="fs-more">/g) || []).length, 1, "bei acht Quellen genau EIN Listen-Klappkasten …");
	assert.strictEqual((viele.match(/<details class="fs-add-fold">/g) || []).length, 1, "… und genau EINE Falte fuers Eintragen");
	assert.ok(viele.indexOf("<details class=\"fs-more\">") < viele.indexOf('<details class="fs-add-fold">'), "der Listen-Klappkasten steht vor der Falte");
}

// ---- 5. Kein Zustand: `open` kommt aus GENAU EINER Stelle, und die ist die Meldung ---------------------
// 🔴 Die EINE Ausnahme von „immer zu" (seit dem Meldeformular-Umbau, Entwurf 2026-09-03-quellen-meldeformular
// §5.4): solange Quellen aus einer MELDUNG warten, steht die Falte offen, damit der Editor das vorbelegte
// Formular sieht. Das `open` haengt an `meldung.offen` -- einem Wert, den der Mount aus seiner Warteschlange
// ableitet -- und an keinem zweiten Merker; ohne Meldung gibt es weiterhin keine offene Falte (Abschnitt 1),
// und nach der letzten gemeldeten Quelle zeichnet das Bauteil aus der Antwort neu, also zu.
{
	const quelle = lies("js/review/review-feature-sources.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
	const stellen = quelle.replace(/\.fs-add-fold\[open\]/g, "").match(/fs-add-fold[^\n]*\bopen\b[^\n]*/g) || [];
	assert.strictEqual(stellen.length, 1, "GENAU EINE Stelle haengt `open` an die Falte: " + JSON.stringify(stellen));
	assert.ok(/\(offen \? " open" : ""\)/.test(stellen[0]), "… und sie ist an `offen` gebunden, nicht fest: " + stellen[0]);
	assert.ok(/const offen = Boolean\(meldung && meldung\.offen === true\);/.test(quelle), "`offen` ist NUR die Meldung -- kein zweiter Merker");
	assert.ok(!/\.open\s*=/.test(quelle), "kein Skript, das `.open` setzt -- die Falte hat keinen Modulzustand");
	// Ausgefuehrt: mit wartender Meldung offen, samt Zeile IN der Falte; ohne Meldung zu.
	const mit = render(ZUSTAND, { escape: esc, tr, meldung: { offen: true, zeile: '<p class="fs-add-queue">Quelle 1 von 2</p>' } });
	assert.ok(/<details class="fs-add-fold" open>/.test(mit), "mit wartender Meldung steht die Falte offen");
	const f = mit.indexOf('<details class="fs-add-fold"');
	const z = mit.indexOf('<p class="fs-add-queue">');
	assert.ok(z > f && z < mit.indexOf("</details>", f), "… und die Warteschlangen-Zeile steht IN der Falte");
	assert.ok(z < mit.indexOf('class="fs-row fs-row--add"'), "… ueber der Eingabezeile");
	assert.ok(!/<details class="fs-add-fold"[^>]*\sopen/.test(render(ZUSTAND, { escape: esc, tr, meldung: { offen: false, zeile: "" } })), "meldung.offen === false: zu");
}

// ---- 6. Die Rezeptur ist die des Listen-Klappkastens -- ein zweiter Name, keine zweite Regel -------------
{
	const css = lies("css/features/feature-sources.css").replace(/\/\*[\s\S]*?\*\//g, "");
	assert.ok(/\.fs-more,\s*\.fs-add-fold\s*\{/.test(css), ".fs-add-fold haengt an der Trennlinien-Regel von .fs-more");
	assert.ok(/\.fs-more__toggle,\s*\.fs-add-fold__toggle\s*\{/.test(css), ".fs-add-fold__toggle haengt an der Klapptext-Regel von .fs-more__toggle");
	assert.ok(/\.fs-more\[open\] > \.fs-more__toggle::before,\s*\.fs-add-fold\[open\] > \.fs-add-fold__toggle::before/.test(css), "… samt der Drehung des Dreiecks");
	// ⚠️ Gesucht wird eine Regel, deren EINZIGER Selektor die Falte ist -- am Ende einer Selektorliste
	// (`.fs-more__toggle,\n.fs-add-fold__toggle {`) darf sie stehen, das ist die geteilte Regel.
	const eigen = css.match(/(?:^|\}|\*\/)\s*\.fs-add-fold__toggle\s*\{[^}]*\}/g) || [];
	assert.deepStrictEqual(eigen, [], "KEINE eigene Regel fuer .fs-add-fold__toggle -- das waere die zweite Rezeptur");
}

// ---- 7. Ausgefuehrt: nach einem Eintrag ist die Falte wieder zu ------------------------------------------
// Der Mount zeichnet aus der Serverantwort neu; eine Dokument-Attrappe reicht, um das zu sehen.
{
	const quelle = lies("js/review/review-feature-sources.js");
	const markup = lies("js/ui/feature-source-markup.js");
	const anfragen = [];
	function element() {
		const el = { innerHTML: "", hidden: false, textContent: "", value: "", classList: { add() {}, remove() {}, contains() { return false; } },
			addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
			appendChild() {}, removeChild() {}, setAttribute() {}, getAttribute() { return null; }, focus() {}, dataset: {}, style: {} };
		return el;
	}
	const behaelter = element();
	const context = {
		console, window: {}, document: { querySelector: () => null, createElement: element, body: element(), addEventListener() {}, removeEventListener() {} },
		fetch: async (url, init) => {
			const body = JSON.parse(init.body); anfragen.push(body.action);
			return { ok: true, json: async () => ({ ok: true, sources: ZUSTAND.sources, wiki_url: ZUSTAND.wiki_url, revision: 1 }) };
		},
		setTimeout, clearTimeout, URL, module: undefined,
	};
	context.window = context; context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(markup + "\n" + quelle, context);
	(async () => {
		await context.mountFeatureSourceEditor(behaelter, "territory", () => "t-1", {});
		assert.ok(behaelter.innerHTML.includes('<details class="fs-add-fold">'), "nach dem Laden: Falte da …");
		assert.ok(!/<details class="fs-add-fold"[^>]*\sopen/.test(behaelter.innerHTML), "… und zu");
		console.log("quellen-neue-quelle-falte: alle Zusicherungen erfuellt");
	})().catch((fehler) => { console.error(fehler); process.exit(1); });
}
