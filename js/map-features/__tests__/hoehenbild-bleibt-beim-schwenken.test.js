"use strict";

/**
 * BEIM SCHWENKEN BLEIBT DAS HÖHENBILD STEHEN (Owner 05.09.2026: „beim pannen der karte verschwindet
 * das höhenbild für eine weile und kommt dann wieder, soll aber bleiben").
 *
 * 💣 DIE URSACHE WAREN ZWEI DINGE, UND BEIDE LIEFEN BEI JEDEM `moveend`:
 *   1. Der Loader lädt nach Ausschnitt nach und meldete „Höhenfeld veraltet", sobald ein Gebirge in
 *      den Ausschnitt kam oder ihn verliess -- unter V8 richtig (ein globaler Stapel), unter V12
 *      bedeutungslos, weil nur die angeklickte Fläche und ihre echten Überlappungen das Bild tragen.
 *   2. `terrain_ridge_line` wurde per `!==` verglichen -- auf einer LISTE ist das
 *      Referenzgleichheit, und jede Serverantwort bringt ein neues Array. Für jede Fläche mit
 *      Kammlinie lautete die Antwort damit IMMER „hat sich geändert".
 * Und `invalidate()` warf das gemalte Raster weg, also war die Leinwand leer, bis der Rechner nach
 * rund anderthalb Sekunden zurückkam.
 *
 * 🔴 AUSGEFÜHRT, NICHT GELESEN: der Anstrich wird wirklich gefahren, und gemessen wird, ob nach dem
 * Nachladen noch gemalt wird.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const { ecosystemHeightRelevantChange, avesmapsKammlinieText, ecosystemAreaBetrifftHoehenbild }
	= require("../map-features-ecosystem-loader.js");

let gehalten = 0;
function pruefe(name, fn) {
	return Promise.resolve().then(fn)
		.then(() => { gehalten++; console.log("  ok  " + name); })
		.catch((error) => { console.error("  FEHLER  " + name); throw error; });
}

const gebirge = (extra) => Object.assign({
	public_id: "a", kind: "topographie", region_type: "gebirge", geometry_revision: 1,
}, extra || {});

const BOUNDS = { min_x: 0, min_y: 0, max_x: 20, max_y: 20 };

// Der Zeichner mit einer Karten-Attrappe -- dieselbe Bauart wie in gebirgssimulation.test.js.
function zeichner(o) {
	const gemalt = { anstriche: 0 };
	let ersterAnstrich;
	const fertig = new Promise((r) => { ersterAnstrich = r; });
	const ctx2d = {
		setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
		moveTo() {}, lineTo() {}, closePath() {}, fill() {},
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
		putImageData() { gemalt.anstriche++; ersterAnstrich(); },
	};
	const leinwand = { width: 0, height: 0, style: {}, classList: { add() {}, toggle() {} },
		getContext: () => ctx2d };
	const pane = { style: {}, appendChild() {} };
	const ctx = {
		...require("./gebirgs-worker-hilfe.cjs")(),
		console: { log() {}, warn() {}, error() {} },
		Math, Number, String, Array, Object, JSON, Float64Array, Uint8Array, Uint8ClampedArray,
		Infinity, NaN, isFinite, Map, Set, Date, WeakMap,
		performance: { now: () => 0 },
		setTimeout: (fn, ms) => (ms === 300000 ? setTimeout(fn, ms) : 0),
		requestAnimationFrame: () => 0,
		devicePixelRatio: 1,
		map: {
			createPane: () => pane, getPane: () => pane,
			getSize: () => ({ x: 200, y: 160 }),
			containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
			containerPointToLatLng: (p) => ({ lat: p[1] * 0.125, lng: p[0] * 0.125 }),
			on() {}, off() {},
		},
		L: { DomUtil: { setPosition() {} } },
		document: { createElement: () => leinwand,
			currentScript: { src: path.join(WURZEL, "js/map-features/map-features-ecosystem-hydrologie.js") } },
		ecosystemLayers: new Map([["a", { _ecosystemArea: {
			public_id: "a", region_name: "Probegebirge", kind: "topographie", region_type: "gebirge",
			geometry_revision: 1, bounds: BOUNDS,
			geometry: { type: "Polygon", coordinates: [[[1, 1], [19, 1], [19, 19], [1, 19], [1, 1]]] },
			terrain_grain: 4, terrain_levels: 2, terrain_erosion: 0,
		} }]].concat(((o && o.weitere) || []).map((f) => [f.public_id, { _ecosystemArea: f }]))),
		labelData: [{ publicId: "p", labelType: "berggipfel", coordinates: [10, 10], heightSchritt: 3000 }],
		pathData: [],
		isEcosystemLayerModeActive: () => true,
		getActiveEcosystemLayerKind: () => "topographie",
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
	};
	if (o && o.polygonClipping) {
		ctx.polygonClipping = require(path.join(WURZEL, "js/third-party/polygon-clipping.umd.min.js"));
	}
	ctx.window = ctx;
	ctx.globalThis = ctx;
	vm.createContext(ctx);
	for (const datei of [
		"js/map-features/map-features-point-in-polygon.js",
		"js/map-features/map-features-ecosystem-geometry.js",
		"js/map-features/map-features-ecosystem-height-field.js",
		"js/map-features/map-features-ecosystem-hydrologie.js",
		"js/map-features/map-features-ecosystem-height-render.js",
	]) {
		ctx.module = { exports: {} };
		vm.runInContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), ctx, { filename: datei });
	}

	const flaechen = new Map();
	ctx.ecosystemLayers.forEach((eintrag, id) => { flaechen.set(id, eintrag._ecosystemArea); });

	return { api: ctx.window.AvesmapsEcosystemHeightRender, gemalt, fertig, flaechen,
		registry: ctx.ecosystemLayers };
}

async function alles() {
	/* ── 1. Die Regel: was zählt als Änderung? ───────────────────────────────────────────────── */

	await pruefe("eine inhaltsgleiche Kammlinie aus einer neuen Antwort ist KEINE Änderung", () => {
		// 💣 Der Kern des Befunds: dieselbe Linie, aber ein neues Array -- genau das liefert jede
		// Serverantwort beim Nachladen. Per `!==` verglichen war das immer „geändert".
		const linie = [[1, 1], [2, 2], [3, 3]];
		assert.strictEqual(
			ecosystemHeightRelevantChange(
				gebirge({ terrain_ridge_line: linie }),
				gebirge({ terrain_ridge_line: JSON.parse(JSON.stringify(linie)) }),
			), false,
			"eine inhaltsgleiche Kammlinie gilt als Änderung -- dann ist jeder Schwenk ein Neubau");
	});

	await pruefe("eine WIRKLICH geänderte Kammlinie zählt weiter", () => {
		assert.strictEqual(
			ecosystemHeightRelevantChange(
				gebirge({ terrain_ridge_line: [[1, 1], [2, 2]] }),
				gebirge({ terrain_ridge_line: [[1, 1], [2, 9]] }),
			), true, "eine geänderte Kammlinie geht durch");
		assert.strictEqual(
			ecosystemHeightRelevantChange(
				gebirge({ terrain_ridge_line: null }),
				gebirge({ terrain_ridge_line: [[1, 1], [2, 2]] }),
			), true, "eine neu gezeichnete Kammlinie geht durch");
	});

	await pruefe("„keine Linie\" hat genau eine Schreibweise", () => {
		// ⚠️ `null` und die leere Liste sind dasselbe -- sonst meldete der erste Wechsel zwischen
		// beiden eine Änderung, die keine ist.
		assert.strictEqual(avesmapsKammlinieText(null), avesmapsKammlinieText([]));
		assert.strictEqual(
			ecosystemHeightRelevantChange(gebirge({ terrain_ridge_line: null }),
				gebirge({ terrain_ridge_line: [] })), false);
	});

	await pruefe("ein anderer Geländewert bleibt eine Änderung", () => {
		assert.strictEqual(
			ecosystemHeightRelevantChange(gebirge({ terrain_erosion: 1 }), gebirge({ terrain_erosion: 3 })),
			true, "der Erosionsregler geht nicht mehr durch");
	});

	/* ── 2. Der Anstrich: bleibt das Bild stehen? ────────────────────────────────────────────── */

	await pruefe("nach dem Nachladen wird weiter gemalt -- das Bild bleibt stehen", async () => {
		const z = zeichner();
		z.api.setSolid(true, "a");
		z.api.redraw();
		const grenze = setTimeout(() => {}, 0);
		await z.fertig;
		clearTimeout(grenze);
		const vorher = z.gemalt.anstriche;
		assert.ok(vorher > 0, "es wurde ueberhaupt nicht gemalt");

		// Der Schwenk: der Loader meldet „nachgeladen".
		z.api.invalidate(true);
		z.api.redraw();
		assert.ok(z.gemalt.anstriche > vorher,
			"nach dem Nachladen wurde SOFORT nicht mehr gemalt -- genau die Luecke, die der Owner sieht");
	});

	await pruefe("nach einer echten Änderung geht das Bild weg, bis das neue da ist", async () => {
		// 🔴 Die Gegenrichtung, und sie ist Absicht: „Ein stilles Falschbild ist schlimmer als ein
		// fehlendes." Wer einen Regler dreht, darf nicht das alte Relief als Antwort bekommen.
		const z = zeichner();
		z.api.setSolid(true, "a");
		z.api.redraw();
		await z.fertig;
		const vorher = z.gemalt.anstriche;
		z.api.invalidate();
		z.api.redraw();
		assert.strictEqual(z.gemalt.anstriche, vorher,
			"nach einer echten Aenderung stand das alte Bild noch da");
	});

	/* ── 3. Wer berührt das Bild überhaupt? ──────────────────────────────────────────────────── */

	await pruefe("betrifftAnzeige: die angezeigte Fläche und ihre echten Überlappungen -- sonst nichts", () => {
		// 🔴 Der zweite Teil des Befunds: bis zum 05.09.2026 genügte dem Loader, dass IRGENDEIN
		// Gebirge in den Ausschnitt kam. Seit V12 trägt das Bild nur die angeklickte Fläche und ihre
		// echten Überlappungen -- ein Gebirge zweihundert Einheiten weiter kostete einen
		// Erosionslauf für nichts.
		const z = zeichner({ polygonClipping: true, weitere: [
			// überlappt „a" (a reicht bis x = 19)
			{ public_id: "b", kind: "topographie", region_type: "gebirge", geometry_revision: 1,
				bounds: { min_x: 15, min_y: 5, max_x: 31, max_y: 15 },
				geometry: { type: "Polygon", coordinates: [[[16, 6], [30, 6], [30, 14], [16, 14], [16, 6]]] } },
			// liegt weit weg
			{ public_id: "c", kind: "topographie", region_type: "gebirge", geometry_revision: 1,
				bounds: { min_x: 200, min_y: 200, max_x: 220, max_y: 220 },
				geometry: { type: "Polygon", coordinates: [[[201, 201], [219, 201], [219, 219], [201, 219], [201, 201]]] } },
		] });
		const frage = z.api.betrifftAnzeige;
		assert.equal(typeof frage, "function", "der Zeichner beantwortet die Frage gar nicht");
		const flaeche = (id) => z.flaechen.get(id);

		assert.strictEqual(frage(flaeche("a")), false, "ohne angezeigtes Gebirge betrifft nichts das Bild");
		z.api.setSolid(true, "a");
		assert.strictEqual(frage(flaeche("a")), true, "die angezeigte Fläche selbst zählt nicht");
		assert.strictEqual(frage(flaeche("b")), true, "eine echte Überlappung zählt nicht");
		assert.strictEqual(frage(flaeche("c")), false,
			"ein Gebirge weit weg zählt mit -- dann rechnet jeder Schwenk wieder umsonst");
		// 💣 Gefragt wird mit dem OBJEKT: die neu dazugekommene Fläche steht noch nicht in der
		// Registry, die entfernte schon nicht mehr. Eine Frage über die Registry wäre in genau den
		// zwei Fällen blind, um derentwillen es sie gibt.
		assert.strictEqual(frage({ ...flaeche("b"), public_id: "noch-nicht-registriert" }), true,
			"eine überlappende Fläche, die noch nicht in der Registry steht, wird nicht erkannt");
		assert.strictEqual(frage(null), false, "nichts betrifft nichts");

		// 🔴 UND HIER LIEGT DER GRUND FUER DIE KENNUNGSPRUEFUNG -- nicht im Normalfall. Solange die
		// angezeigte Flaeche in der Registry steht, faende der Polygonschnitt sie ohnehin (sie
		// schneidet sich selbst). Faellt sie aber aus dem Ausschnitt, ist sie dort weg, und genau
		// DANN muss ihr Verschwinden das Bild fuer veraltet erklaeren.
		// 🪤 Eine Mutationsprobe hat das aufgedeckt: die erste Fassung dieses Tests fragte nur nach
		// der registrierten Flaeche, und das Streichen der Kennungspruefung blieb gruen.
		z.registry.delete("a");
		assert.strictEqual(frage(flaeche("a")), true,
			"die angezeigte Flaeche zaehlt nicht mehr, sobald sie aus der Registry faellt -- dann bliebe "
			+ "ihr eigenes Verschwinden unbemerkt");
		z.api.setSolid(false);
		assert.strictEqual(frage(flaeche("b")), false, "nach dem Schliessen betrifft wieder nichts das Bild");
	});

	await pruefe("ohne den Zeichner bleibt es beim grosszügigen Verhalten", () => {
		// 🔴 Die sichere Richtung: lieber einmal zu viel gerechnet als ein Bild, das eine Änderung
		// nicht zeigt. Eine gecachte ältere Fassung des Zeichners kennt die Frage nicht.
		const vorher = global.window;
		try {
			global.window = {};
			assert.strictEqual(ecosystemAreaBetrifftHoehenbild(gebirge()), true,
				"ohne Zeichner wird nichts mehr als veraltet gemeldet -- eine Änderung bliebe unsichtbar");
			global.window = { AvesmapsEcosystemHeightRender: { betrifftAnzeige: () => false } };
			assert.strictEqual(ecosystemAreaBetrifftHoehenbild(gebirge()), false, "die Antwort wird nicht gelesen");
		} finally {
			if (vorher === undefined) { delete global.window; } else { global.window = vorher; }
		}
	});

	/* ── 4. Die Verdrahtung ──────────────────────────────────────────────────────────────────── */

	await pruefe("der Loader meldet ein NACHLADEN, keine Änderung", () => {
		// ⚠️ Hier genuegt der Quelltext, und zwar vollstaendig statt stichprobenartig: geprueft wird,
		// dass es im Loader KEINEN Aufruf von `invalidate` ohne `true` mehr gibt. Ein Geltungsbereich
		// kann daran nicht luegen -- es geht um ein Argument, nicht um einen Bezeichner.
		const quelle = fs.readFileSync(
			path.join(WURZEL, "js/map-features/map-features-ecosystem-loader.js"), "utf8",
		).replace(/\r\n/g, "\n").replace(/\/\/[^\n]*/g, "");
		const aufrufe = quelle.match(/invalidate\?\.\([^)]*\)/g) || [];
		assert.ok(aufrufe.length > 0, "der Loader ruft `invalidate` gar nicht mehr");
		for (const aufruf of aufrufe) {
			assert.ok(/\(\s*true\s*\)/.test(aufruf),
				"der Loader ruft " + aufruf + " -- ohne `true` nimmt er beim Schwenken das Bild weg");
		}

		// 💣 EIN Trichter, vier Anlässe. Wird die Veraltet-Marke irgendwo direkt gesetzt, geht die
		// Frage „betrifft das überhaupt das Bild?" an genau dieser Stelle vorbei -- und der nächste
		// Anlass erbt den Fehler. Gezählt wird deshalb vollständig, nicht stichprobenartig.
		const setzt = quelle.match(/heightStackStale\s*=\s*true/g) || [];
		assert.strictEqual(setzt.length, 1,
			"die Veraltet-Marke wird an " + setzt.length + " Stellen gesetzt -- es darf genau eine sein");
		const trichter = quelle.slice(quelle.indexOf("const merkeHoehenbildVeraltet"));
		assert.ok(/ecosystemAreaBetrifftHoehenbild\(/.test(trichter.slice(0, 400)),
			"der Trichter fragt nicht, ob die Fläche das Bild überhaupt berührt");
	});

	console.log("OK: " + gehalten + " Zusicherungen -- das Bild bleibt beim Schwenken.");
}

alles().catch((error) => { console.error(error); process.exitCode = 1; });
