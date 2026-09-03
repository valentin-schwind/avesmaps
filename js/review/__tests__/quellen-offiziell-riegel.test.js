// Der „offiziell“-Riegel im Bauteil: `is_official_chosen` reist nur mit, wenn jemand den Haken ANGEFASST hat.
//
// 💣 Warum (03.09.2026, Abnahmelauf von Schritt 3): das Eintragen einer bekannten Adresse schrieb den Kanon-Haken
// des Formulars katalogweit in die Zeile -- „Geographia Aventurica“ (1.319 Objekte) fiel von ja auf nein, ohne dass
// jemand den Haken beruehrt hatte. Der Server schreibt seither nur bei ausdruecklicher Wahl (dieselbe Regel wie
// `source_type_chosen`), und diese Wahl entsteht HIER: am change-Ereignis des Hakens, vermerkt am Element.
// 🔴 Die Vorbelegung aus dem Korpus (`haken.checked = true` ohne Ereignis) ist KEINE Wahl.
// 🔴 Die Meldung nennt eine Verweigerung („pflegt der Wiki-Abgleich“).
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-offiziell-riegel.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(REPO, "js", "review", "review-feature-sources.js"), "utf8");
const geteilteMarkupQuelle = fs.readFileSync(path.join(REPO, "js", "ui", "feature-source-markup.js"), "utf8");

function macheBehaelter() {
	const felder = {};
	for (const sel of [".fs-add-url", ".fs-add-label", ".fs-add-type", ".fs-add-kind", ".fs-add-official", ".fs-add-pages", ".fs-add-license", ".fs-add-attribution"]) {
		felder[sel] = { value: "", checked: false, dataset: {}, focus() {}, addEventListener() {}, matches(s) { return s === sel; } };
	}
	felder["[data-fs-note]"] = { textContent: "", hidden: true };
	felder["[data-fs-picked]"] = { hidden: true };
	felder[".fs-add-url"].value = "https://www.f-shop.de/search?sSearch=10291";
	felder[".fs-add-label"].value = "Geographia Aventurica";
	return {
		innerHTML: "", felder, _klick: null, _change: null,
		addEventListener(typ, fn) { if (typ === "click") { this._klick = fn; } if (typ === "change") { this._change = fn; } },
		querySelector(sel) { return felder[sel] || null; },
		querySelectorAll() { return []; },
	};
}
const KLICK_HINZU = { target: { closest: (sel) => (sel === "[data-fs-add-submit]" ? {} : null) } };

function macheKontext() {
	const gerufen = { koerper: [] };
	const context = {
		console,
		window: { __sourceCatalog: {}, __featureSourceRefs: {} },
		document: { querySelector: () => null },
		attachSourceAutocomplete: () => () => {},
		fetch: async (url, init) => { gerufen.koerper.push(JSON.parse(init.body)); return { json: async () => ({ ok: true, wiki_url: "", sources: [] }) }; },
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(geteilteMarkupQuelle, context);
	vm.runInContext(quelle, context);
	context.__gerufen = gerufen;
	return context;
}

(async () => {
	// ---- 1. Unberuehrter Haken: keine Wahl, auch wenn er (vorbelegt) angehakt ist ---------------------------
	const ctx = macheKontext();
	const b = macheBehaelter();
	await ctx.mountFeatureSourceEditor(b, "path", () => "seg-1", {});
	assert.ok(typeof b._change === "function", "das Bauteil hoert am Behaelter auf change -- dort entsteht die Wahl");
	await b._klick(KLICK_HINZU);
	let hinzu = ctx.__gerufen.koerper[ctx.__gerufen.koerper.length - 1];
	assert.strictEqual(hinzu.action, "add");
	assert.strictEqual(hinzu.is_official, false);
	assert.strictEqual(hinzu.is_official_chosen, false, "niemand hat den Haken angefasst: keine Wahl");
	// Vorbelegung ohne Ereignis (so setzt die Korpus-Auskunft den Haken):
	b.felder[".fs-add-official"].checked = true;
	await b._klick(KLICK_HINZU);
	hinzu = ctx.__gerufen.koerper[ctx.__gerufen.koerper.length - 1];
	assert.strictEqual(hinzu.is_official, true, "der Wert reist mit -- eine NEUE Zeile braucht ihn");
	assert.strictEqual(hinzu.is_official_chosen, false, "… aber eine Vorbelegung ohne Ereignis ist KEINE Wahl -- genau die Falle vom 03.09.2026");

	// ---- 2. Angefasst: die Wahl reist mit ------------------------------------------------------------------------
	b._change({ target: b.felder[".fs-add-official"] });
	await b._klick(KLICK_HINZU);
	hinzu = ctx.__gerufen.koerper[ctx.__gerufen.koerper.length - 1];
	assert.strictEqual(hinzu.is_official_chosen, true, "nach dem change-Ereignis am Haken ist es eine Wahl");
	// Ein change an einem ANDEREN Feld ist keine Wahl des Hakens:
	const b2 = macheBehaelter();
	const ctx2 = macheKontext();
	await ctx2.mountFeatureSourceEditor(b2, "path", () => "seg-1", {});
	b2._change({ target: b2.felder[".fs-add-license"] });
	await b2._klick(KLICK_HINZU);
	assert.strictEqual(ctx2.__gerufen.koerper[ctx2.__gerufen.koerper.length - 1].is_official_chosen, false, "ein change an der Lizenz waehlt den Haken nicht");

	// ---- 3. Die Meldung nennt die Verweigerung -----------------------------------------------------------------
	const tr = (k, f) => f;
	const verweigert = ctx.featureSourceLinkedMessage({ source_id: 58, label: "Geographia Aventurica", typed_label: "", official_changed: false, official_now: true, official_refused: true }, tr);
	assert.ok(verweigert.includes("pflegt bei dieser Quelle der Wiki-Abgleich"), "verweigert: der Satz sagt, wer den Wert pflegt");
	assert.ok(!verweigert.includes("steht jetzt auf"), "… und behauptet keine Aenderung");
	const geaendert = ctx.featureSourceLinkedMessage({ source_id: 58, label: "X", typed_label: "", official_changed: true, official_now: false, official_refused: false }, tr);
	assert.ok(geaendert.includes("steht jetzt auf nein") && !geaendert.includes("Wiki-Abgleich"), "geaendert: der alte Satz, ohne Verweigerung");
	const still = ctx.featureSourceLinkedMessage({ source_id: 58, label: "X", typed_label: "", official_changed: false, official_now: true, official_refused: false }, tr);
	assert.ok(!still.includes("steht jetzt auf") && !still.includes("Wiki-Abgleich"), "unveraendert: nur „verknuepft statt neu angelegt“");

	console.log("quellen-offiziell-riegel: alle Zusicherungen erfuellt");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
