"use strict";

/**
 * Der Speicherlauf des Gebirgsrasters -- der Owner am 04.09.2026: beim Speichern des Gebirges
 * hochladen.
 *
 * 🔴 GEPRUEFT WIRD DIE KETTE, NICHT DIE ABSICHT. Ein Regex ueber den Quelltext ("ruft hochladen")
 * saehe eine Zeile und wuesste nichts ueber ihre Reihenfolge, ihre Kodierung oder darueber, ob der
 * Aufruf ueberhaupt erreicht wird. Deshalb wird der Uploader hier AUSGEFUEHRT.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");
const ohneKommentare = (text) => text
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let bestanden = 0;
const offen = [];
const pruefe = (name, fn) => {
	offen.push((async () => fn())().then(() => {
		bestanden++;
		console.log("  ok  " + name);
	}, (fehler) => {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}));
};

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. DER UPLOADER -- wirklich gefahren, mit einem Schreibweg als Attrappe
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// Die Karte gibt es hier nicht; gebaut wird eine Umgebung mit genau den Globals, die das
// Render-Modul zur Laufzeit liest. 💣 KEIN Proxy als Attrappe: einer, der jeden Bezeichner
// beantwortet, verschluckt genau den ReferenceError, um dessentwillen dieser Test existiert -- das
// hat die Landschafts-Regression vom 03.09.2026 zwei Stunden lang unsichtbar gemacht.
function ladeRenderModul(schreibweg, extra) {
	const gerufen = [];
	// 🔴 `window` IST der Kontext, kein eigenes Objekt -- die Hausform (siehe
	// `gebirgssimulation.test.js`). Ein getrenntes `window` laesst jede `window.X = …`-Zuweisung des
	// Moduls ins Leere laufen, und der Export fehlt, ohne dass irgendetwas wirft.
	const sandkasten = {
		console: { warn() {}, log() {}, error() {} },
		document: {
			createElement: () => ({
				getContext: () => null,
				style: {},
				classList: { add() {}, remove() {}, toggle() {} },
			}),
		},
		setTimeout: () => 0,
		requestAnimationFrame: () => 0,
		performance: { now: () => 0 },
		devicePixelRatio: 1,
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
		// 🪤 OHNE `map` UND `L` STEIGT DIE IIFE SOFORT WIEDER AUS (`ready()`, height-render.js:83) --
		// sie legt dann keinen Export an und wirft dabei NICHT. Der Test sah „das Modul gibt kein
		// hochladen heraus" und las sich wie ein fehlender Export, war aber eine fehlende Karte.
		map: {
			createPane: () => ({ style: {}, appendChild() {} }),
			getPane: () => ({ style: {}, appendChild() {} }),
			getSize: () => ({ x: 200, y: 160 }),
			getZoom: () => 4,
			containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
			containerPointToLatLng: (p) => ({ lat: p[1] * 0.1, lng: p[0] * 0.1 }),
			latLngToContainerPoint: () => ({ x: 0, y: 0 }),
			on() {}, off() {},
		},
		L: { DomUtil: { setPosition() {} } },
		ecosystemLayers: new Map(),
		pathData: [],
		isEcosystemLayerModeActive: () => true,
		getActiveEcosystemLayerKind: () => "topographie",
		Math, Number, String, Array, Object, JSON, Promise, isFinite, Buffer, Error,
		Infinity, NaN, Map, Set, Date,
		Uint8Array, Uint8ClampedArray, Uint16Array, Float64Array, Float32Array, Int32Array,
		// Die Karte, so weit der Uploader sie braucht.
		pointInGeometry: (punkt, geometrie) => geometrie.pruefe(punkt[0], punkt[1]),
		ecosystemHeightSeed: () => 4242,
		// Die Gipfelweiche der Karte -- dieselbe Liste wie `ECOSYSTEM_PEAK_SUBTYPES`.
		isEcosystemPeakSubtype: (art) => art === "berggipfel" || art === "vulkan",
		postEcosystemEdit: (aktion, rumpf) => {
			gerufen.push({ aktion, rumpf });

			return schreibweg(aktion, rumpf);
		},
	};
	Object.assign(sandkasten, extra || {});
	sandkasten.window = sandkasten;
	sandkasten.globalThis = sandkasten;
	const kontext = vm.createContext(sandkasten);
	// Die Kodierregel und der Trichter -- in derselben Reihenfolge wie in index.html.
	for (const datei of [
		"js/map-features/map-features-ecosystem-heightmap-raster.js",
		"js/map-features/map-features-ecosystem-hydrologie.js",
		"js/map-features/map-features-ecosystem-height-render.js",
	]) {
		sandkasten.module = { exports: {} };
		vm.runInContext(lies(datei), kontext, { filename: datei });
	}

	return { kontext, sandkasten, gerufen };
}

const GEOMETRIE = { pruefe: (x, y) => x >= 1 && x <= 19 && y >= 1 && y <= 19 };
const FLAECHE = {
	public_id: "flaeche-1",
	geometry_revision: 3,
	geometry_geojson: GEOMETRIE,
	bounds: { min_x: 0, min_y: 0, max_x: 20, max_y: 20 },
};
const UMGEBUNG = {
	topographyAreas: () => [FLAECHE],
	labelData: [],
	ecosystemGeometryArea: () => 100,
};

pruefe("der Upload laeuft durch und schickt ein vollstaendiges Raster", async () => {
	const { sandkasten, gerufen } = ladeRenderModul(() => Promise.resolve({ written: 1 }), UMGEBUNG);
	const modul = sandkasten.window.AvesmapsEcosystemHeightRender;
	assert.ok(typeof modul?.hochladen === "function", "das Modul gibt kein `hochladen` heraus");

	const ergebnis = await modul.hochladen(FLAECHE);
	assert.strictEqual(gerufen.length, 1, "es wurde nicht genau einmal geschrieben");
	assert.strictEqual(gerufen[0].aktion, "heightmap_put", "falsche Aktion");
	// 🔴 DIE SIEBEN PFLICHTFELDER DES ENDPUNKTS. Fehlt eines, wirft er InvalidArgumentException --
	// und zwar erst live, weil ein Test, der nur `written > 0` prueft, die Attrappe fragt statt des
	// Endpunkts. Die Liste steht in `avesmapsTerrainHeightmapPut`.
	for (const feld of ["area", "width", "height", "cell_size", "origin_x", "origin_y", "samples"]) {
		assert.ok(gerufen[0].rumpf[feld] !== undefined && gerufen[0].rumpf[feld] !== null,
			"das Feld `" + feld + "` fehlt im Rumpf");
	}
	assert.strictEqual(gerufen[0].rumpf.area, "flaeche-1");
	assert.ok(ergebnis.hochgeladen, "der Erfolg wurde nicht gemeldet");
});

pruefe("die Zellweite ist die des SPEICHERS, nicht die der Anzeige", async () => {
	// 💣 Die Anzeige darf einen Deckel tragen (grobes Raster beim Ziehen am Regler). Der Speicherlauf
	// darf ihn NICHT erben -- sonst liegt in der Wegfindung ein Gelaende mit vier- bis achtfacher
	// Zellweite, und die Wegfindung liest ein Gebirge, das der Editor nie gesehen hat.
	const { sandkasten, gerufen } = ladeRenderModul(() => Promise.resolve({ written: 1 }), UMGEBUNG);
	await sandkasten.window.AvesmapsEcosystemHeightRender.hochladen(FLAECHE);
	assert.ok(Math.abs(gerufen[0].rumpf.cell_size - 0.25) < 1e-9,
		"die Zellweite ist " + gerufen[0].rumpf.cell_size + " statt 0,25");
	// 20 Einheiten Spanne / 0,25 + 1 = 81 Zellen je Kante.
	assert.strictEqual(gerufen[0].rumpf.width, 81, "die Breite passt nicht zur Zellweite");
	assert.strictEqual(gerufen[0].rumpf.height, 81, "die Hoehe passt nicht zur Zellweite");
});

pruefe("der Ursprung ist der des GERECHNETEN Rasters, nicht der geschnappte des Gitterbauers", async () => {
	// 💣 `ecosystemHeightmapGrid` schnappt den Ursprung auf ein Vielfaches der Zellweite
	// (`Math.floor(min_x / cell) * cell`), `baueRaster` nimmt `bounds.min_x` roh. Beide liefern
	// dieselbe ZELLZAHL -- wer den falschen meldet, verschiebt das ganze Gebirge um bis zu eine Zelle
	// gegen die Karte, und zwar lautlos.
	const schraeg = Object.assign({}, FLAECHE, {
		bounds: { min_x: 0.1, min_y: 0.1, max_x: 20.1, max_y: 20.1 },
	});
	const { sandkasten, gerufen } = ladeRenderModul(() => Promise.resolve({ written: 1 }),
		Object.assign({}, UMGEBUNG, { topographyAreas: () => [schraeg] }));
	await sandkasten.window.AvesmapsEcosystemHeightRender.hochladen(schraeg);
	assert.ok(Math.abs(gerufen[0].rumpf.origin_x - 0.1) < 1e-9,
		"der Ursprung ist " + gerufen[0].rumpf.origin_x + " statt 0,1 -- hier wurde der geschnappte "
		+ "Gitterursprung gemeldet, und das Gebirge liegt um eine Zelle daneben");
});

pruefe("die Proben sind uint16, geklemmt, und ausserhalb der Flaeche null", async () => {
	const { sandkasten, gerufen } = ladeRenderModul(() => Promise.resolve({ written: 1 }),
		Object.assign({}, UMGEBUNG, {
			// 🪤 Die Feldnamen sind die der KARTE, nicht die der Datenbank: `peakList()` liest
			// `labelType`, `coordinates` als [lat, lng] (also [y, x]!) und `heightSchritt`. Mit den
			// SQL-Namen gefuellt bleibt die Liste leer, und das Raster ist ueberall null -- was sich
			// wie ein kaputter Uploader liest und eine falsche Fixture ist.
			labelData: [{
				publicId: "gipfel-1",
				labelType: "berggipfel",
				coordinates: [10, 10],
				heightSchritt: 3000,
			}],
		}));
	await sandkasten.window.AvesmapsEcosystemHeightRender.hochladen(FLAECHE);
	const rumpf = gerufen[0].rumpf;
	const roh = Buffer.from(rumpf.samples, "base64");
	assert.strictEqual(roh.length, rumpf.width * rumpf.height * 2,
		"die Byte-Zahl passt nicht zu 2 Byte je Zelle");
	const werte = new Uint16Array(roh.buffer, roh.byteOffset, roh.length / 2);
	// 🔴 Die Ecke liegt ausserhalb der Flaeche und MUSS 0 sein -- daran haengt die
	// Fusshoehen-Invariante, ueber die sich zwei ueberlappende Gebirge verschmelzen.
	assert.strictEqual(werte[0], 0, "die Ecke ausserhalb der Flaeche traegt Hoehe");
	let groesster = 0;
	for (let k = 0; k < werte.length; k++) { groesster = Math.max(groesster, werte[k]); }
	assert.ok(groesster > 0, "das ganze Raster ist null");
	assert.ok(groesster <= 65535, "ein Wert ueberschreitet die uint16-Klemme");
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. DIE REIHENFOLGE -- erst die Regler, dann das Raster
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("der Upload steht NACH update_area_terrain, nie davor", () => {
	// 💣 DIE REIHENFOLGE IST TRAGEND, und sie ist hier nicht ausfuehrbar zu pruefen (der Dialog
	// braucht das ganze Kartendokument). Gemessen wird sie deshalb am Quelltext -- aber an den
	// POSITIONEN zweier Aufrufe, nicht am Vorhandensein einer Zeile.
	// Der Grund: der Server stempelt das Raster mit einem Fingerabdruck aus den Reglern, die IN DER
	// DATENBANK stehen. Ginge das Raster zuerst hinaus, traege es den Abdruck der alten Werte und
	// gaelte im selben Moment als veraltet -- der Editor sieht sein neues Gelaende, die Wegfindung
	// rechnet mit dem alten, und nichts meldet einen Fehler.
	const quelle = ohneKommentare(lies("js/map-features/map-features-ecosystem-properties.js"));
	const speichern = quelle.indexOf('postEcosystemEdit("update_area_terrain"');
	const hochladen = quelle.indexOf(".hochladen?.(area)");
	assert.ok(speichern > 0, "der Regler-Speicherweg wurde nicht gefunden");
	assert.ok(hochladen > 0, "der Upload wird beim Speichern gar nicht gerufen");
	assert.ok(speichern < hochladen,
		"der Upload steht VOR dem Speichern der Regler -- das Raster traegt dann den Fingerabdruck "
		+ "der alten Werte und gilt sofort als veraltet");
});

pruefe("ein Zuruecksetzen auf Automatik laedt NICHTS hoch", () => {
	// ⚠️ Auf Automatik zurueck heisst: die Flaeche hat keine eigenen Werte mehr. Ein Raster dazu
	// hochzuladen waere ein Widerspruch -- es traegt genau die Einstellung, die gerade zurueckgenommen
	// wurde.
	const quelle = ohneKommentare(lies("js/map-features/map-features-ecosystem-properties.js"));
	const hochladen = quelle.indexOf(".hochladen?.(area)");
	const riegel = quelle.lastIndexOf("if (reset)", hochladen);
	assert.ok(riegel > 0 && riegel < hochladen,
		"vor dem Upload steht kein reset-Riegel -- ein Zuruecksetzen laedt ein Raster hoch");
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   3. DIE KODIERREGEL WOHNT AN EINER STELLE
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("die Kodierung wird GETEILT, nicht nachgebaut", () => {
	// 🔴 `ecosystemHeightmapToBase64` und ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT sind die Kodierregel
	// (uint16 little-endian, base64 in 8-KB-Bloecken, Klemme bei 65.535). Sie muss mit
	// `avesmapsHeightmapDecode` in PHP uebereinstimmen. Eine zweite Fassung im Render-Modul waere die
	// zweite Wahrheit, und ihr Fehler saehe aus wie ein kaputtes Gebirge, nicht wie ein Kodierfehler.
	const render = ohneKommentare(lies("js/map-features/map-features-ecosystem-height-render.js"));
	assert.ok(render.includes("ecosystemHeightmapToBase64("),
		"das Render-Modul benutzt den geteilten Kodierer nicht");
	assert.ok(!/function\s+ecosystemHeightmapToBase64/.test(render),
		"das Render-Modul definiert eine EIGENE Fassung des Kodierers");
	assert.ok(!/btoa\s*\(/.test(render),
		"das Render-Modul kodiert selbst nach base64, statt den geteilten Weg zu nehmen");

	// 💣 UND DIE DATEI MUSS GELADEN SEIN, sonst ist der Aufruf zur Laufzeit ein ReferenceError.
	// "Die Datei ist eingebunden" reicht nicht -- sie muss VOR dem Render-Modul stehen.
	// ⚠️ Kommentare werden gestrippt: ein Dateipfad in einem HTML-Kommentar ist fuer ein indexOf ein
	// frueheres script-Tag, und genau daran ist `zoomstufe-anzeige.test.js` schon umgefallen.
	const html = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
	const kodierer = html.indexOf("map-features-ecosystem-heightmap-raster.js");
	const renderTag = html.indexOf("map-features-ecosystem-height-render.js");
	assert.ok(kodierer > 0, "index.html laedt die Kodier-Datei nicht");
	assert.ok(kodierer < renderTag, "die Kodier-Datei steht NACH dem Render-Modul");
});

Promise.allSettled(offen).then(() => {
	if (!process.exitCode) {
		console.log("\n" + bestanden + " Zusicherungen gehalten.");
	}
});
