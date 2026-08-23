// „das tooltip löscht sich oft nicht" (Owner 23.08.2026) -- der Schwebezettel, der zum zweiten Mal
// stehen blieb.
//
// 🔴 URSACHE, im Browser gemessen: „Nur diese Region zeigen" (20.08.2026) setzt alle uebrigen
// Flaechenpfade auf **`display: none`** (`.ecosystem-isolation … { display: none }`,
// css/features/ecosystem-layer.css). Ein Element, das unter dem Zeiger VERSCHWINDET, bekommt vom
// Browser kein `mouseout` mehr -- und ein Leaflet-Tooltip geht von selbst NUR bei `mouseout` zu.
// Gemessen: Zettel offen, andere Region isoliert, Pfad auf `display:none`, `isTooltipOpen() === true`.
//
// 💣 DAS IST DIESELBE URSACHE WIE AM 2026-08-04, NUR EIN NEUER ERZEUGER. Damals waren es die Panes auf
// `pointer-events: none`; die Reparatur sitzt seither in syncEcosystemPaneStates und setLayerPicking.
// Der Kommentar in ecosystem-layer.css:1358 hat den naechsten woertlich vorhergesagt („a fifth will
// appear, and nobody will remember this file") -- und die Isolation ist er. Ein VERSTECKTES Element ist
// derselbe Fall wie ein klickdurchlaessiges: der Zettel erfaehrt nie, dass die Maus weg ist.
//
// ⚠️ Und deshalb NICHT pauschal: wendeIsolationAn laeuft nach JEDEM Nachladen (der Loader ruft es bei
// jedem Schwenk). Wer dort blind schliesst, nimmt dem Leser bei jedem Schwenk den Zettel unter seinem
// Zeiger weg -- und Leaflet holt ihn erst wieder, wenn man die Flaeche verlaesst und neu betritt.
// Geschlossen wird nur, wenn sich wirklich etwas an der Sichtbarkeit geaendert hat.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const quelle = fs.readFileSync(
	path.join(__dirname, "..", "map-features-ecosystem-stapel.js"), "utf8");

// ---- Die Buehne: gerade so viel Karte, dass wendeIsolationAn laufen kann ------------------------

function klassenListe(start = []) {
	const menge = new Set(start);
	return {
		menge,
		add: (k) => menge.add(k),
		remove: (k) => menge.delete(k),
		contains: (k) => menge.has(k),
		toggle(k, an) {
			const soll = an === undefined ? !menge.has(k) : Boolean(an);
			if (soll) { menge.add(k); } else { menge.delete(k); }
			return soll;
		},
	};
}

function welt({ huelleKlassen = [], pfadKlassen = [], regionAmPfad = "r-1" } = {}) {
	const geschlossen = [];
	const huelle = { classList: klassenListe(huelleKlassen) };
	const pfad = { classList: klassenListe(pfadKlassen) };
	const layer = { _path: pfad, _ecosystemArea: { region_public_id: regionAmPfad, region_name: "Testwald" } };
	const context = {
		console,
		Map,
		Set,
		Array,
		Number,
		String,
		Boolean,
		Object,
		JSON,
		Math,
		module: { exports: {} },
		document: {
			readyState: "complete",
			getElementById: () => null,
			querySelectorAll: () => [],
			addEventListener: () => {},
			createElement: () => ({ classList: klassenListe(), style: {}, addEventListener: () => {}, appendChild: () => {} }),
		},
		map: { getContainer: () => huelle },
		ecosystemLayers: new Map([["f-1", layer]]),
		closeAllEcosystemAreaTooltips: () => geschlossen.push("zu"),
	};
	context.window = {};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(quelle, context);

	const stapel = context.window.AvesmapsEcosystemStapel;
	assert.ok(stapel && typeof stapel.wendeIsolationAn === "function",
		"wendeIsolationAn wird nicht herausgegeben -- ohne sie prueft dieser Test nichts");
	return { stapel, huelle, pfad, geschlossen };
}

// ---- 1. Die Isolation faellt weg: die versteckten Flaechen kommen zurueck -----------------------
//
// Der Zustand aus dem Screenshot: die Karte ist wieder vollstaendig, und zwei Zettel stehen trotzdem
// noch da. Sie stammen aus dem Augenblick, in dem ihre Flaeche verschwand.

const zurueck = welt({ huelleKlassen: ["ecosystem-isolation"] });
zurueck.stapel.wendeIsolationAn();
assert.ok(!zurueck.huelle.classList.contains("ecosystem-isolation"),
	"Vorbedingung: ohne isolierte Region faellt die Markierung von der Huelle");
assert.deepStrictEqual(zurueck.geschlossen, ["zu"],
	"💣 wenn die Isolation faellt, muessen die Schwebezettel zu -- sonst bleibt der Zettel der Flaeche "
		+ "stehen, die waehrend der Isolation unter dem Zeiger verschwunden war");

// ---- 2. Auch die einzelne Flaechen-Markierung zaehlt --------------------------------------------
//
// Die Huelle kann schon richtig stehen und trotzdem eine Flaeche ihre Markierung verlieren (etwa
// nachgeladene Pfade). Auch das ist ein Sichtbarkeitswechsel.

const markierung = welt({ pfadKlassen: ["ecosystem-area--isoliert"] });
markierung.stapel.wendeIsolationAn();
assert.ok(!markierung.pfad.classList.contains("ecosystem-area--isoliert"),
	"Vorbedingung: die Markierung faellt");
assert.deepStrictEqual(markierung.geschlossen, ["zu"],
	"💣 auch eine einzelne Flaeche, die ihre Sichtbarkeit wechselt, schliesst die Zettel");

// ---- 3. Nichts geaendert, nichts angefasst ------------------------------------------------------
//
// ⚠️ DIE ANDERE HAELFTE DER REGEL. wendeIsolationAn laeuft nach JEDEM Nachladen -- bei jedem Schwenk.
// Wer dort blind schliesst, nimmt dem Leser den Zettel unter seinem Zeiger weg, und Leaflet holt ihn
// erst zurueck, wenn man die Flaeche verlaesst und neu betritt. Der haeufigste Fall ist genau dieser:
// keine Isolation, nichts zu tun.

const ruhe = welt();
ruhe.stapel.wendeIsolationAn();
ruhe.stapel.wendeIsolationAn();
assert.deepStrictEqual(ruhe.geschlossen, [],
	"⚠️ ohne Aenderung an der Sichtbarkeit bleibt der Zettel stehen -- sonst kostet jeder Schwenk ihn");

console.log("ok - ecosystem-isolation-zettel");
