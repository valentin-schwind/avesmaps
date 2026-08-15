// Das Panel von „Was ist hier?" -- die Zeilenordnung, die Wegfall-Regel, und (Fix-Runde 6) das
// Kopfbild wirklich ausgefuehrt.
//
// Ausfuehren: node js/map-features/__tests__/what-is-here-panel.test.js
//
// 💣 Der erste Teil prueft den QUELLTEXT, nicht einen gerenderten Browser -- und deshalb ohne
// Kommentare. Die Prosa in diesen Dateien beschreibt genau das, wonach gesucht wird; ein Treffer im
// Kommentar ist kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts
// haelt. Der zweite Teil (ab „DAS KOPFBILD, AUSGEFUEHRT") laedt die echte Funktion in eine
// vm-Sandbox und RUFT sie auf -- ein Quelltest haette den Befund, um den es dort geht, nie gefunden
// (der Funktionsname stand schon vorher im Text, nur an der falschen Stelle im Code benutzt).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const quelle = ohneKommentare(fs.readFileSync(
	path.join(ROOT, "js", "map-features", "map-features-what-is-here.js"), "utf8"));

// 🔴 Waren · Fauna · Flora -- das ist AVESMAPS_LORE_ROWS (map-features-lore.js), keine eigene
// Liste. Das Panel darf die Reihenfolge nicht selbst noch einmal aufschreiben.
assert.ok(!/["']Fauna["']/.test(quelle),
	"das Panel schreibt keine Lore-Zeile selbst -- buildLoreMarkup baut alle drei");
assert.ok(/buildLoreMarkup/.test(quelle), "es benutzt den vorhandenen Lore-Container");

// 🔴 „Klimazone" steht IMMER direkt unter Flora, also NACH dem Lore-Block (Owner 2026-08-03).
assert.ok(quelle.indexOf("buildLoreMarkup") < quelle.indexOf("avesmapsClimateRowMarkup"),
	"Klimazone kommt nach den Lore-Zeilen");

// 🔴 Die Treppe wird UNVERAENDERT geliehen und erwartet Blatt -> Wurzel.
assert.ok(/buildSettlementHierarchyMarkup/.test(quelle), "die vorhandene Treppe, kein Nachbau");
assert.ok(!/location-popup__breadcrumb-row/.test(quelle),
	"das Panel baut keine eigenen Treppenstufen");

// 🔴 Eine Zeile ohne Antwort faellt weg, sie steht nie als Strich da.
assert.ok(!/>—</.test(quelle) && !/"—"/.test(quelle), "kein Gedankenstrich als Platzhalter");

// 💣 Das Kopfbild kommt aus der VORHANDENEN Tabelle, nicht aus einer zweiten hier.
assert.ok(/regionHeaderImageBasename/.test(quelle), "INFO_HEADER_IMAGE_BY_ART wird benutzt");
assert.ok(!/wald\.webp|meer\.webp|insel\.webp/.test(quelle), "keine Bildnamen von Hand");

// ---------------------------------------------------------------- DAS KOPFBILD, AUSGEFUEHRT ------
// 🔴 Fix-Runde 6, Befund B: der Live-Befund war „Kopfbild faellt an Land auf region.webp zurueck,
// statt wald.webp zu nehmen" -- die alte Fassung nahm vegetation[0] blind. Ein Quelltest, der nur
// nachsieht, ob „regionHeaderImageBasename" irgendwo im Text vorkommt (wie oben), haette das NIE
// gefunden -- der Name stand schon vorher da, nur einmal statt in einer Schleife aufgerufen. Diese
// Zusicherungen fuehren avesmapsWhatIsHereHeaderImageBasename() deshalb wirklich aus: popups.js
// (die echte INFO_HEADER_IMAGE_BY_ART-Tabelle) und map-features-what-is-here.js in eine gemeinsame
// vm-Sandbox geladen, keine Attrappe der Tabelle.
function ladeKopfbildFunktion() {
	const sandbox = {
		console,
		window: {},
		document: { querySelector: () => null, querySelectorAll: () => [] },
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "ui", "popups.js"), "utf8"),
		sandbox, { filename: "popups.js" });
	vm.runInContext(
		fs.readFileSync(path.join(ROOT, "js", "map-features", "map-features-what-is-here.js"), "utf8"),
		sandbox, { filename: "map-features-what-is-here.js" }
	);
	return sandbox.avesmapsWhatIsHereHeaderImageBasename;
}

const kopfbild = ladeKopfbildFunktion();
assert.strictEqual(typeof kopfbild, "function", "avesmapsWhatIsHereHeaderImageBasename ist geladen");

// 🔴 DER FALL, UM DEN ES GEHT: genau die am Landpunkt gemessene Reihenfolge -- „Flusslande" zuerst
// (type_label „Flussland/Flusstal", nicht in INFO_HEADER_IMAGE_BY_ART), „Dunkelwald" (type_label
// „Wald") an zweiter Stelle. Das Kopfbild MUSS der zweite Treffer sein, nicht der erste.
assert.strictEqual(
	kopfbild({
		vegetation: [
			{ region_name: "Flusslande", type_label: "Flussland/Flusstal" },
			{ region_name: "Dunkelwald", type_label: "Wald" },
		],
	}),
	"wald",
	"der erste Vegetationstreffer ohne Bild wird uebersprungen, der zweite (Wald) gewinnt"
);

// Ein einzelner, erkannter Vegetationstreffer bleibt der einfache Fall (unveraendertes Verhalten).
assert.strictEqual(kopfbild({ vegetation: [{ type_label: "Wald" }] }), "wald",
	"ein einzelner erkannter Treffer greift weiterhin direkt");

// ⚠️ Der Seepunkt bleibt unveraendert richtig: KEINE Vegetation, die Topographie traegt das Bild.
assert.strictEqual(
	kopfbild({ vegetation: [], topographie: [{ region_name: "Weite See", type_label: "Meer" }] }),
	"meer",
	"ohne Vegetation greift die Topographie -- der Seepunkt-Fall darf nicht brechen"
);

// Auch in der Topographie zaehlt der ERSTE Treffer, der wirklich ein Bild ergibt.
assert.strictEqual(
	kopfbild({
		vegetation: [],
		topographie: [
			{ region_name: "Namenloses Etwas", type_label: "Unbekannter Typ" },
			{ region_name: "Weite See", type_label: "Meer" },
		],
	}),
	"meer",
	"dieselbe Regel gilt auch fuer die Topographie-Liste"
);

// Nichts erkannt -> der allgemeine Rueckfall, nicht undefined/Absturz.
assert.strictEqual(kopfbild({ vegetation: [{ type_label: "Unbekannt" }] }), "region",
	"kein Treffer irgendwo -> der allgemeine Rueckfall \"region\"");
assert.strictEqual(kopfbild({}), "region", "ganz ohne Landschaftsdaten -> derselbe Rueckfall");

console.log("what-is-here-panel: alles gruen");
