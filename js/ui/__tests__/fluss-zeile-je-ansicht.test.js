// Fall #129 (Discord, 15.09.2026): „Flüsse und Seen" versprach in „Standard" etwas, das kein Code
// halten kann -- dort sind die Seen ins Kachelbild gemalt, eine Seeflaeche gibt es nur in den
// Landschaften. Die Zeile heisst deshalb nur dort „Flüsse und Seen", sonst „Flüsse", und ihr Titel
// sagt warum (Owner-Entscheid 15.09.2026).
//
// Geprueft wird das VERHALTEN: js/ui/map-display-menu.js laeuft wirklich, gegen ein Attrappen-DOM,
// und jeder Ansichtswechsel wird ueber den MutationObserver ausgeloest, an dem auch der Riegel haengt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/fluss-zeile-je-ansicht.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

const MENUE_QUELLE = read("js", "ui", "map-display-menu.js");

const MIT_SEEN = "Flüsse und Seen";
const OHNE_SEEN = "Flüsse";
const HINWEIS = "Seen sind in dieser Ansicht Teil der Kartengrafik und lassen sich nicht ausblenden.";
const SPERRGRUND_KRAFTLINIEN = "Die Kraftlinien-Ansicht zeigt nur Nodices und Kraftlinien.";

function ohneKommentare(quelle) {
	return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function attrappe() {
	const attrs = {};
	const klassen = new Set();
	return {
		setAttribute(k, v) { attrs[k] = String(v); },
		getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
		removeAttribute(k) { delete attrs[k]; },
		hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
		get title() { return attrs.title || ""; },
		set title(v) { attrs.title = String(v); },
		classList: {
			add(c) { klassen.add(c); },
			remove(c) { klassen.delete(c); },
			toggle(c, an) { if (an) { klassen.add(c); } else { klassen.delete(c); } },
			contains(c) { return klassen.has(c); },
		},
		addEventListener() {},
		contains() { return false; },
		focus() {},
	};
}

function baueZeile(name, schluessel) {
	const zeile = attrappe();
	const box = attrappe();
	const span = attrappe();
	box.disabled = false;
	span.textContent = name;
	span.setAttribute("data-i18n", schluessel);
	box.closest = (sel) => (sel === ".map-display-menu__row" ? zeile : null);
	zeile.querySelector = (sel) => (sel === ".map-display-menu__name" ? span : null);
	return { zeile, box, span };
}

function starte({ modus, tr } = {}) {
	const zustand = { modus };
	const zeilen = {
		togglePaths: baueZeile("Wege", "display.layer.paths"),
		toggleMapLabels: baueZeile("Labels", "display.layer.labels"),
		toggleTerritoryBorders: baueZeile("Grenzen", "display.layer.borders"),
		toggleRivers: baueZeile(MIT_SEEN, "display.layer.rivers"),
		toggleSeaPaths: baueZeile("Seewege", "display.layer.seapaths"),
		toggleOpenPathEnds: baueZeile("Offene Wegenden", "display.check.openPathEnds"),
	};
	const elemente = {
		"map-display-button": attrappe(),
		"map-display-menu": attrappe(),
		mapLayerModeLabel: attrappe(),
	};
	Object.keys(zeilen).forEach((id) => { elemente[id] = zeilen[id].box; });

	let beobachter = null;
	const kontext = {
		document: {
			readyState: "complete",
			getElementById: (id) => elemente[id] || null,
			addEventListener() {},
		},
		MutationObserver: function (rueckruf) { beobachter = rueckruf; this.observe = () => {}; },
		getSelectedMapLayerMode: () => zustand.modus,
		setTimeout: () => 0,
		clearTimeout: () => {},
		requestAnimationFrame: () => 0,
		console,
	};
	if (tr) {
		kontext.tr = tr;
	}
	kontext.window = kontext;
	vm.createContext(kontext);
	vm.runInContext(MENUE_QUELLE, kontext, { filename: "map-display-menu.js" });
	assert.ok(typeof beobachter === "function", "der Riegel haengt an einem MutationObserver");

	return {
		fluss: zeilen.toggleRivers,
		labels: zeilen.toggleMapLabels,
		wechsle(neu) { zustand.modus = neu; beobachter(); },
	};
}

// ---- A. „Standard": die Zeile verspricht keine Seen und sagt warum ------------------------------
{
	const menue = starte({ modus: "deregraphic" });
	assert.strictEqual(menue.fluss.span.textContent, OHNE_SEEN,
		"in „Standard“ heisst die Zeile „Flüsse“ -- die Seen stehen dort im Kachelbild");
	assert.strictEqual(menue.fluss.span.getAttribute("data-i18n"), "display.layer.riversOnly",
		"und traegt den passenden i18n-Schluessel (sonst schreibt ?lang=en „Rivers and lakes“ zurueck)");
	assert.strictEqual(menue.fluss.zeile.title, HINWEIS, "ihr Titel erklaert, warum die Seen fehlen");
	assert.strictEqual(menue.fluss.box.disabled, false, "und der Haken bleibt bedienbar -- er wirkt auf die Fluesse");

	// ---- B. In die Landschaften: dort traegt der Haken die Seen wirklich -------------------------
	menue.wechsle("ecosystem");
	assert.strictEqual(menue.fluss.span.textContent, MIT_SEEN, "in den Landschaften heisst sie „Flüsse und Seen\"");
	assert.strictEqual(menue.fluss.span.getAttribute("data-i18n"), "display.layer.rivers",
		"mit dem alten i18n-Schluessel");
	assert.ok(!menue.fluss.zeile.hasAttribute("title"), "und ohne Hinweis -- dort gibt es nichts zu erklaeren");

	// ---- C. Zurueck: der Hinweis kommt wieder (die Riegel-Schleife loescht `title` VORHER) --------
	menue.wechsle("political");
	assert.strictEqual(menue.fluss.span.textContent, OHNE_SEEN, "zurueck in „Politisch\": wieder „Flüsse\"");
	assert.strictEqual(menue.fluss.zeile.title, HINWEIS, "und der Hinweis ist wieder da");

	// ---- D. Kraftlinien: der SPERRGRUND schlaegt den Hinweis ------------------------------------
	menue.wechsle("powerlines");
	assert.strictEqual(menue.fluss.box.disabled, true, "in „Kraftlinien\" ist der Haken gesperrt");
	assert.strictEqual(menue.fluss.zeile.title, SPERRGRUND_KRAFTLINIEN,
		"und der Titel nennt den Sperrgrund, nicht den Seen-Hinweis");
	assert.strictEqual(menue.fluss.span.textContent, OHNE_SEEN, "die Beschriftung ist trotzdem „Flüsse\"");

	menue.wechsle("ecosystem");
	assert.strictEqual(menue.fluss.box.disabled, false, "aus „Kraftlinien\" in die Landschaften: wieder bedienbar");
	assert.ok(!menue.fluss.zeile.hasAttribute("title"), "ohne Sperrgrund und ohne Hinweis");
	assert.strictEqual(menue.fluss.span.textContent, MIT_SEEN, "und wieder „Flüsse und Seen\"");

	// ---- E. Jede Ansicht mit Kacheln heisst „Flüsse", auch eine unbekannte -----------------------
	["none", "original", "deregraphic", "political", "powerlines", "", "eine-neue-ansicht"].forEach((modus) => {
		menue.wechsle(modus);
		assert.strictEqual(menue.fluss.span.textContent, OHNE_SEEN,
			`Ansicht "${modus}": „Flüsse" -- nur eine ausdruecklich eingetragene Ansicht verspricht Seen`);
	});

	// ---- F. Die Nachbarzeilen bleiben unberuehrt -------------------------------------------------
	assert.strictEqual(menue.labels.span.textContent, "Labels", "die Labels-Zeile behaelt ihre Beschriftung");
	assert.strictEqual(menue.labels.span.getAttribute("data-i18n"), "display.layer.labels",
		"und ihren i18n-Schluessel");
	assert.ok(!menue.labels.zeile.hasAttribute("title"), "und bekommt keinen fremden Hinweis");
}

// ---- G. Beschriftung und Hinweis laufen ueber tr() --------------------------------------------
{
	const menue = starte({ modus: "deregraphic", tr: (schluessel) => `«${schluessel}»` });
	assert.strictEqual(menue.fluss.span.textContent, "«display.layer.riversOnly»",
		"die Beschriftung kommt aus der Sprachtabelle, nicht als festes Deutsch");
	assert.strictEqual(menue.fluss.zeile.title, "«display.hint.lakesInTiles»", "der Hinweis ebenso");
	menue.wechsle("ecosystem");
	assert.strictEqual(menue.fluss.span.textContent, "«display.layer.rivers»", "und in den Landschaften der alte Schluessel");
}

// ---- H. Beide neuen Schluessel stehen auf Englisch da ------------------------------------------
const englisch = read("js", "app", "i18n-en.js");
assert.ok(/"display\.layer\.riversOnly"\s*:\s*"Rivers"/.test(englisch), "i18n-en.js: display.layer.riversOnly = „Rivers\"");
assert.ok(/"display\.hint\.lakesInTiles"\s*:\s*"[^"]+"/.test(englisch), "i18n-en.js: display.hint.lakesInTiles ist hinterlegt");

// ---- I. Gekoppelter Wert: die Tabelle nennt GENAU die Ansicht, in der Seeflaechen gezeichnet werden --
// 💣 Faengt: jemand benennt die Landschafts-Ansicht um oder traegt eine Kachel-Ansicht ein. Die
// Seeflaechen gibt es nur, solange isEcosystemLayerModeActive wahr ist.
const tabelle = ohneKommentare(MENUE_QUELLE).match(/var SEEN_ALS_FLAECHE = \{([^}]*)\};/);
assert.ok(tabelle, "map-display-menu.js traegt die Tabelle SEEN_ALS_FLAECHE");
assert.deepStrictEqual([...tabelle[1].matchAll(/(\w+)\s*:/g)].map((t) => t[1]), ["ecosystem"],
	"und darin genau die Landschaften");
const ebenenSchalter = ohneKommentare(read("js", "map-features", "map-features-ecosystem-layer-switch.js"));
const modusFrage = ebenenSchalter.match(/function isEcosystemLayerModeActive\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(modusFrage && /===\s*"ecosystem"/.test(modusFrage[0]),
	"und das ist dieselbe Ansicht, in der die Landschaftsebene (und damit jede Seeflaeche) gezeichnet wird");

console.log("fluss-zeile-je-ansicht.test.js: alles gruen");
