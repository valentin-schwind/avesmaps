// RULING R7 (Fix-Runde 1 zu Aufgabe 2 des Garetien Importers) -- Suche und Filtertrichter werden
// auf dem Reiter „Anzeigen" GESPERRT und der Grund steht SICHTBAR daneben, weil dieser Reiter
// nicht filtert (Entwurf §3.1: die Filterleiste „bleibt sichtbar, wirkt aber ERKENNBAR nur auf die
// drei Server-Reiter").
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §3.1
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-anzeige-filtersperre.test.js
//
// 🔴 WARUM ES DIESE DATEI GIBT: garetienAnzeigeFilterSperreSetzen ruehrt an DOM-Eigenschaften
// (`disabled`, `hidden`), die kein reiner Test messen kann -- dasselbe Muster wie
// garetien-fussknopf-dom.test.js daneben. Gemessen wird am ERGEBNIS in einem gefaelschten
// `document`, UEBER DEN ECHTEN KLICKWEG (den Tab-Klick, nicht ein direkter Funktionsaufruf) --
// nur so zeigt sich, dass ein Reiterwechsel die Sperre wirklich setzt UND wieder aufloest.
// 💣 `hasDocument` wird beim LADEN ausgewertet (`typeof document !== "undefined"`), das
// `document` muss also VOR dem `require` stehen.

"use strict";

const path = require("path");
const assert = require("assert");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

// ---- Das gefaelschte `document` -----------------------------------------------------------------
//
// ⚠️ Absichtlich MAGER (wie im Vorbild): nur die Elemente, um die es hier geht.
function macheElement(id) {
	return {
		id: id,
		hidden: false,
		disabled: false,
		textContent: "",
		innerHTML: "",
		value: "",
		dataset: {},
		_hoerer: {},
		addEventListener(art, fn) {
			this._hoerer[art] = this._hoerer[art] || [];
			this._hoerer[art].push(fn);
		},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}

const ELEMENTE = {};
["garetien-listcol", "garetien-tabs", "garetien-list", "garetien-runline", "garetien-search",
	"garetien-filter-toggle", "garetien-filter-menu", "garetien-anzeige-hinweis",
	"garetien-balance", "garetien-detailcol"]
	.forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: {},
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};

// avesmapsGaretienBalanceZeileText ruft die GETEILTE Bilanzformel als globalen Namen
// (js/review/review-list-balance.js) -- dieselbe Zusage wie bei den acht WikiSync-Listen. Die
// ECHTE Fassung wird geladen, kein Nachbau.
global.avesmapsListBalanceText =
	require(path.resolve(__dirname, "..", "review-list-balance.js")).avesmapsListBalanceText;

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { avesmapsGaretienListeRendern, garetienAnzeigeFilterSperreSetzen, garetienListeSkelettMarkup }
	= mod;

wahr(typeof garetienAnzeigeFilterSperreSetzen === "function",
	"garetienAnzeigeFilterSperreSetzen fehlt im Export");

// Der sichtbare Hinweistext steht im statischen Skelett -- kein Test hier baut ihn nach.
wahr(garetienListeSkelettMarkup().includes(
	"Der Reiter zeigt, was auf der Karte liegt — hier wird nicht gefiltert."
), "der Hinweistext fehlt im Skelett -- ohne ihn ist die Sperre nicht ERKENNBAR, nur wirksam");
wahr(/id="garetien-anzeige-hinweis"[^>]*\bhidden\b/.test(garetienListeSkelettMarkup()),
	"der Hinweis startet VERSTECKT -- auf dem Start-Reiter (ein Server-Reiter) wird ja gefiltert");

const SUCHE = ELEMENTE["garetien-search"];
const FILTER_TOGGLE = ELEMENTE["garetien-filter-toggle"];
const FILTER_MENU = ELEMENTE["garetien-filter-menu"];
const HINWEIS = ELEMENTE["garetien-anzeige-hinweis"];
const TABS = ELEMENTE["garetien-tabs"];

function klickTab(stand) {
	const knopf = { getAttribute: (n) => (n === "data-stand" ? stand : null) };
	const ziel = { closest: (sel) => (sel === ".avm-tab" ? knopf : null) };
	(TABS._hoerer.click || []).forEach((fn) => fn({ target: ziel }));
}

// Eine Runde Microtasks (und danach eine Runde Macrotasks) abwarten -- die echte fetch-Kette in
// avesmapsGaretienListeHolen() haengt mehrere `.then()` hintereinander.
function tickAbwarten() {
	return new Promise((resolve) => { setTimeout(resolve, 0); });
}

async function hauptlauf() {
	// ---- 1. Erster Aufbau (Reiter "offen", direkt gerendert): nichts gesperrt ------------------
	avesmapsGaretienListeRendern({
		objekte: [], reiter: { offen: 5, abgelehnt: 0, uebernommen: 0 }, bilanz: {}, gesamt: 5,
	});
	gleich(SUCHE.disabled, false, "auf einem Server-Reiter bleibt die Suche bedienbar");
	gleich(FILTER_TOGGLE.disabled, false, "und der Filterknopf ebenso");
	gleich(HINWEIS.hidden, true, "der Hinweis bleibt versteckt, solange gefiltert werden kann");

	// Ein zufaellig offen gelassenes Trichter-Panel, um die Schliess-Nebenwirkung zu pruefen.
	FILTER_MENU.hidden = false;

	// ---- 2. Simulierter Tab-Klick auf "Anzeigen" -- der ECHTE Klickweg -------------------------
	//
	// garetienListeSkelettVerdrahten haengt seinen Listener beim ERSTEN Aufbau (oben) an
	// `garetien-tabs`. RULING R5: der Reiter „Anzeigen" fragt nie den Server, sein Zweig in
	// avesmapsGaretienListeHolen() rendert SYNCHRON -- kein `fetch` noetig, keine Wartezeit.
	let fetchAufrufe = 0;
	global.fetch = () => {
		fetchAufrufe++;
		return Promise.resolve({
			json: () => Promise.resolve({
				ok: true, objekte: [], reiter: { offen: 5, abgelehnt: 1, uebernommen: 0 },
				bilanz: {}, gesamt: 1, facetten: {}, angehakt: { new: 0, changed: 0 },
			}),
		});
	};

	klickTab("anzeigen");
	gleich(fetchAufrufe, 0,
		"der Reiter Anzeigen fragt nie den Server (RULING R5) -- die Sperre steht schon, bevor "
		+ "irgendein `fetch` noetig waere");
	gleich(SUCHE.disabled, true, "auf dem Reiter Anzeigen ist die Suche gesperrt");
	gleich(FILTER_TOGGLE.disabled, true, "und der Filterknopf ebenso");
	gleich(HINWEIS.hidden, false, "und der Grund steht SICHTBAR daneben");
	gleich(FILTER_MENU.hidden, true,
		"ein zufaellig offenes Trichter-Panel schliesst mit -- sein Zustand ist ausschliesslich "
		+ "`hidden` (kein zweiter Modulzustand daneben)");

	// ---- 3. Zurueck auf einen Server-Reiter: beide wieder frei ----------------------------------
	klickTab("abgelehnt");
	await tickAbwarten();
	gleich(fetchAufrufe, 1, "ein Server-Reiter fragt wirklich den Server");
	gleich(SUCHE.disabled, false, "die Suche ist nach dem Rueckwechsel wieder frei");
	gleich(FILTER_TOGGLE.disabled, false, "der Filterknopf ebenso");
	gleich(HINWEIS.hidden, true, "und der Hinweis verschwindet wieder");

	// ---- 4. Und noch einmal hin und her, damit die Regel nicht nur EINMAL zufaellig stimmt ------
	klickTab("anzeigen");
	gleich(SUCHE.disabled, true, "ein zweiter Wechsel auf den Reiter Anzeigen sperrt erneut");
	klickTab("offen");
	await tickAbwarten();
	gleich(SUCHE.disabled, false, "und ein zweiter Rueckwechsel gibt erneut frei");
	gleich(HINWEIS.hidden, true, "der Hinweis bleibt konsistent an die Sperre gekoppelt");

	console.log(`garetien-anzeige-filtersperre: ${checks} Pruefungen bestanden.`);
}

hauptlauf().catch((fehler) => {
	console.error(fehler);
	process.exitCode = 1;
});
