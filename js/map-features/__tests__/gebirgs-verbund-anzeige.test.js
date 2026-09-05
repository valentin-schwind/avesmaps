"use strict";

/**
 * DER VERBUND WIRD GEZEIGT, NICHT NUR GERECHNET (Owner 05.09.2026).
 *
 * „ich will bei der ansicht nur die höhenfelder des angeklickten gebirges sehen. die anderen sollen
 * verwendet werden (max bei overlapping) aber nicht angezeigt" -- und unmittelbar danach, an
 * Finsterkamm und Schwarzkuppen: „bei überlappungen kann man gerne auch das andere gebirge
 * angezeigt bekommen, damit man den übergang sieht".
 *
 * Daraus wird EINE Regel: gezeigt wird die angeklickte Fläche und jede, die sie WIRKLICH überlappt.
 *
 * 🔴 AUSGEFÜHRT, NICHT GELESEN. Der Befund, der zu diesem Test führte, war live sichtbar und in
 * jedem Quelltext-Test unsichtbar: die Leinwand malte das RECHENgebiet (`drin` = eigene Fläche plus
 * Nachbarn) und schnitt es am Hüllrechteck der aktiven Fläche schnurgerade ab. Nachgemessen im
 * Screenshot vom 05.09.2026: alle vier geraden Kanten lagen auf dem bbox der Roten Sichel
 * (gemessen 167/150/923/922 gegen 162/145/921/921) -- und die beiden gezeigten Gebirge berührten
 * sie nicht einmal.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
let gehalten = 0;

function pruefe(name, fn) {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (error) {
		console.error("  FEHLER  " + name);
		throw error;
	}
}

/* ── Die Karte: drei Gebirge in bekannter Lage ─────────────────────────────────────────────────
   A  die angeklickte Fläche, mit ZWEI Löchern
   B  überlappt A wirklich (x 16..18) -- wird gezeigt
   C  teilt nur das HÜLLRECHTECK mit A und berührt sie nie -- wird nicht gezeigt
                                                                                                */

const LOCH_FREI = [[5, 5], [9, 5], [9, 9], [5, 9], [5, 5]];        // Loch in A, von niemandem gedeckt
const LOCH_UNTER_B = [[16.2, 6.5], [17.8, 6.5], [17.8, 9], [16.2, 9], [16.2, 6.5]];  // Loch in A, B liegt darüber

const FLAECHE_A = {
	public_id: "a", region_name: "Gebirge A", kind: "topographie", region_type: "gebirge",
	geometry_revision: 1, bounds: { min_x: 0, min_y: 0, max_x: 20, max_y: 20 },
	geometry: { type: "Polygon", coordinates: [
		[[2, 2], [18, 2], [18, 18], [2, 18], [2, 2]], LOCH_FREI, LOCH_UNTER_B,
	] },
	terrain_grain: 4, terrain_levels: 2, terrain_erosion: 0,
};
const FLAECHE_B = {
	public_id: "b", region_name: "Gebirge B", kind: "topographie", region_type: "gebirge",
	geometry_revision: 1, bounds: { min_x: 15, min_y: 5, max_x: 31, max_y: 15 },
	geometry: { type: "Polygon", coordinates: [[[16, 6], [30, 6], [30, 14], [16, 14], [16, 6]]] },
	terrain_grain: 4, terrain_levels: 2, terrain_erosion: 0,
};
// 💣 C liegt im Hüllrechteck von A (18,5 < 20), berührt A (bis 18) aber nirgends. Genau diese Lage
// hat der Befund vom 05.09.2026 als „Nachbarn" gezeichnet.
const FLAECHE_C = {
	public_id: "c", region_name: "Gebirge C", kind: "topographie", region_type: "gebirge",
	geometry_revision: 1, bounds: { min_x: 18.5, min_y: 18.5, max_x: 29, max_y: 29 },
	geometry: { type: "Polygon", coordinates: [[[19, 19], [28, 19], [28, 28], [19, 28], [19, 19]]] },
	terrain_grain: 4, terrain_levels: 2, terrain_erosion: 0,
};

const GIPFEL_A = 3000;
const GIPFEL_B = 4000;
const LABELS = [
	{ publicId: "p-a", labelType: "berggipfel", coordinates: [12, 10], heightSchritt: GIPFEL_A },
	{ publicId: "p-b", labelType: "berggipfel", coordinates: [10, 24], heightSchritt: GIPFEL_B },
	{ publicId: "p-c", labelType: "berggipfel", coordinates: [24, 24], heightSchritt: 5000 },
];

const BREITE = 340;
const HOEHE = 300;
const EINHEIT = 0.1;                        // Kartenkoordinaten je Bildpunkt

/* ── Der Lauf ─────────────────────────────────────────────────────────────────────────────────── */

// 🔴 ZWEIMAL, MIT UND OHNE GESPIEGELTES y. Die echte Karte spiegelt y (Leaflet zählt lat nach oben,
// die Leinwand y nach unten), die Attrappe eines Tests tut das leicht nicht -- und die Maske hängt
// an der UMLAUFRICHTUNG der Ringe, die sich beim Spiegeln umdreht. Ein Test in nur einer Lage
// bestätigt eine Richtungsregel, die in der anderen Lage jedes Loch aufreißt.
async function lauf(gespiegelt) {
	const gemalt = { anzahl: 0, pixel: null };
	let anstrich;
	const fertig = new Promise((resolve) => { anstrich = resolve; });
	let pfad = null;
	const maske = { pfad: null, regel: null };
	const ctx2d = {
		setTransform() {}, clearRect() {}, save() {}, restore() {},
		beginPath() { pfad = []; },
		moveTo(x, y) { pfad.push([[x, y]]); },
		lineTo(x, y) { pfad[pfad.length - 1].push([x, y]); },
		closePath() {},
		fill(regel) { maske.regel = regel; maske.pfad = pfad.map((ring) => ring.slice()); },
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
		putImageData(bild) { gemalt.anzahl++; gemalt.pixel = bild.data; anstrich(); },
	};
	const leinwand = {
		width: 0, height: 0, style: {}, classList: { add() {}, toggle() {} },
		getContext: () => ctx2d,
	};
	const pane = { style: {}, appendChild() {} };
	const karte = {
		createPane: () => pane,
		getPane: () => pane,
		getSize: () => ({ x: BREITE, y: HOEHE }),
		containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
		containerPointToLatLng: (p) => ({
			lat: gespiegelt ? (HOEHE * EINHEIT) - (p[1] * EINHEIT) : p[1] * EINHEIT,
			lng: p[0] * EINHEIT,
		}),
		on() {}, off() {},
	};

	// 🔴 ATTRAPPEN OHNE PROXY -- ein Proxy, der jeden Bezeichner beantwortet, verschluckt genau die
	// ReferenceError, um derentwillen dieser Test ausführt statt zu lesen (Lehre vom 03.09.2026).
	const ctx = {
		...require("./gebirgs-worker-hilfe.cjs")(),
		console: { log() {}, warn() {}, error() {} },
		Math, Number, String, Array, Object, JSON, Float64Array, Uint8Array, Uint8ClampedArray,
		Infinity, NaN, isFinite, Map, Set, Date,
		performance: { now: () => 0 },
		setTimeout: (fn, verzoegerung) => (verzoegerung === 300000 ? setTimeout(fn, verzoegerung) : 0),
		requestAnimationFrame: () => 0,
		devicePixelRatio: 1,
		map: karte,
		L: { DomUtil: { setPosition() {} } },
		document: {
			createElement: () => leinwand,
			currentScript: { src: path.join(WURZEL, "js/map-features/map-features-ecosystem-hydrologie.js") },
		},
		polygonClipping: require(path.join(WURZEL, "js/third-party/polygon-clipping.umd.min.js")),
		ecosystemLayers: new Map([
			["a", { _ecosystemArea: FLAECHE_A }],
			["b", { _ecosystemArea: FLAECHE_B }],
			["c", { _ecosystemArea: FLAECHE_C }],
		]),
		labelData: LABELS,
		pathData: [],
		isEcosystemLayerModeActive: () => true,
		getActiveEcosystemLayerKind: () => "topographie",
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
	};
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

	const zeichner = ctx.window.AvesmapsEcosystemHeightRender;
	assert.ok(zeichner && typeof zeichner.setSolid === "function", "der Zeichner ist nicht da");
	// ⚠️ Graustufen, damit dieser Test die DECKUNG misst und nicht die Physik: hier wird jeder Punkt
	// gemalt, an dem der Verbund überhaupt etwas zu sagen hat. Sonst hinge eine Zusicherung über die
	// Naht daran, ob das Feld dort zufällig über null liegt.
	zeichner.setSolid(true, "a");
	zeichner.setGrayscale(true);
	zeichner.redraw();
	const zeitlimit = setTimeout(() => anstrich(), 20000);
	await fertig;
	clearTimeout(zeitlimit);
	assert.ok(gemalt.anzahl > 0, "es wurde gar nicht gemalt");

	return { pixel: gemalt.pixel, maske, weisspunkt: zeichner.whitePoint(), gespiegelt };
}

/* ── Messwerkzeuge ────────────────────────────────────────────────────────────────────────────── */

function zuBild(ergebnis, x, y) {
	return [
		x / EINHEIT,
		ergebnis.gespiegelt ? ((HOEHE * EINHEIT) - y) / EINHEIT : y / EINHEIT,
	];
}

// Anteil der gemalten Bildpunkte in einem Kartenrechteck.
function anteilGemalt(ergebnis, x0, y0, x1, y1) {
	const [ax, ay] = zuBild(ergebnis, x0, y0);
	const [bx, by] = zuBild(ergebnis, x1, y1);
	const vonX = Math.ceil(Math.min(ax, bx));
	const bisX = Math.floor(Math.max(ax, bx));
	const vonY = Math.ceil(Math.min(ay, by));
	const bisY = Math.floor(Math.max(ay, by));
	let alle = 0;
	let voll = 0;
	for (let py = vonY; py <= bisY; py++) {
		for (let px = vonX; px <= bisX; px++) {
			alle++;
			if (ergebnis.pixel[(((py * BREITE) + px) * 4) + 3] > 0) { voll++; }
		}
	}

	return alle ? voll / alle : 0;
}

// Die Windungszahl des aufgezeichneten Maskenpfads -- das, was `fill("nonzero")` auswertet.
function windungszahl(pfad, px, py) {
	let wn = 0;
	for (const ring of pfad) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const a = ring[j];
			const b = ring[i];
			const kreuz = ((b[0] - a[0]) * (py - a[1])) - ((px - a[0]) * (b[1] - a[1]));
			if (a[1] <= py) {
				if (b[1] > py && kreuz > 0) { wn++; }
			} else if (b[1] <= py && kreuz < 0) { wn--; }
		}
	}

	return wn;
}

// Dieselbe Frage nach der Even-Odd-Regel -- die Regel, die hier FALSCH wäre.
function kreuzungszahl(pfad, px, py) {
	let treffer = 0;
	for (const ring of pfad) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const a = ring[j];
			const b = ring[i];
			if (((a[1] > py) !== (b[1] > py))
				&& (px < (((b[0] - a[0]) * (py - a[1])) / ((b[1] - a[1]) || Number.EPSILON)) + a[0])) {
				treffer++;
			}
		}
	}

	return treffer;
}

function inMaske(ergebnis, x, y) {
	const [px, py] = zuBild(ergebnis, x, y);

	return windungszahl(ergebnis.maske.pfad, px, py) !== 0;
}

/* ── Die Zusicherungen ────────────────────────────────────────────────────────────────────────── */

async function alles() {
	for (const gespiegelt of [false, true]) {
		const lage = gespiegelt ? "gespiegelte Karte" : "aufrechte Karte";
		const e = await lauf(gespiegelt);

		pruefe("[" + lage + "] die angeklickte Fläche wird gemalt", () => {
			assert.ok(anteilGemalt(e, 10, 11, 14, 15) > 0.9,
				"das eigene Gebirge ist nicht gemalt (" + anteilGemalt(e, 10, 11, 14, 15).toFixed(2) + ")");
		});

		pruefe("[" + lage + "] der überlappende Nachbar wird AUSSERHALB der eigenen Fläche gezeigt", () => {
			// 🔴 Der Owner-Auftrag vom 05.09.2026, wörtlich messbar: B liegt bei x = 21..29 ganz
			// ausserhalb von A (A endet bei 18) und muss trotzdem im Bild stehen.
			const anteil = anteilGemalt(e, 21, 8, 29, 12);
			assert.ok(anteil > 0.9,
				"der überlappende Nachbar fehlt im Bild (" + anteil.toFixed(2) + ") -- ohne ihn ist der "
				+ "Übergang nicht zu sehen");
			// 💣 Und er muss auch in der MASKE stehen. Der Anstrich allein genügt nicht: die Maske
			// schneidet danach weg, was nicht in ihr liegt -- eine Maske aus nur der eigenen Fläche
			// nähme den Nachbarn wieder heraus, und im Bild bliebe genau der alte Zustand.
			assert.ok(inMaske(e, 25, 10), "der Nachbar liegt nicht in der Maske");
		});

		pruefe("[" + lage + "] eine Fläche, die nur das Hüllrechteck teilt, wird NICHT gezeigt", () => {
			// 💣 Genau der Befund vom 05.09.2026: C berührt A nie, lag aber in ihrem Hüllrechteck.
			const anteil = anteilGemalt(e, 20, 20, 27, 27);
			assert.strictEqual(anteil, 0,
				"eine Fläche ohne Polygonschnitt wird mitgemalt (" + anteil.toFixed(2) + ") -- die "
				+ "Nachbarschaft hängt wieder am Rechteck");
			assert.ok(!inMaske(e, 24, 24), "und sie steht sogar in der Maske");
		});

		pruefe("[" + lage + "] ausserhalb aller Flächen bleibt die Leinwand leer", () => {
			assert.strictEqual(anteilGemalt(e, 0.2, 0.2, 1.8, 1.8), 0,
				"im Hüllrechteck von A, aber ausserhalb jeder Fläche, steht Farbe");
			assert.ok(!inMaske(e, 1, 1), "die Maske reicht über alle Flächen hinaus");
		});

		pruefe("[" + lage + "] die Maske ist die VEREINIGUNG -- der Überlapp fällt nicht als Loch heraus", () => {
			// 💣 DER RIEGEL GEGEN `evenodd`: im Überlapp ist die Windungszahl 2. Wer die Maske in
			// EINEM Pfad mit `evenodd` füllt, löscht ausgerechnet das Stück, um dessentwillen der
			// Nachbar gezeigt wird. Beide Regeln werden hier gegeneinander ausgewertet.
			const [px, py] = zuBild(e, 17, 12);
			assert.notStrictEqual(windungszahl(e.maske.pfad, px, py), 0,
				"der Überlapp liegt nicht in der Maske");
			assert.strictEqual(kreuzungszahl(e.maske.pfad, px, py) % 2, 0,
				"die Even-Odd-Regel sähe den Überlapp hier NICHT als Loch -- dann ist diese "
				+ "Zusicherung blind und der Aufbau taugt nicht als Riegel");
			assert.strictEqual(e.maske.regel, "nonzero",
				"gefüllt wird mit " + JSON.stringify(e.maske.regel) + " statt mit \"nonzero\"");
			assert.ok(anteilGemalt(e, 16.5, 10.5, 17.5, 13) > 0.9, "im Überlapp steht keine Farbe");
		});

		pruefe("[" + lage + "] ein Loch bleibt ein Loch -- ausser der Nachbar liegt darüber", () => {
			// ⭐ Das ist die zweite Hälfte der Umlaufrichtung: +1 (B) +1 (Aussenring A) -1 (Loch A).
			assert.strictEqual(anteilGemalt(e, 6, 6, 8, 8), 0,
				"das ungedeckte Loch in A ist zugemalt");
			assert.ok(!inMaske(e, 7, 7), "das ungedeckte Loch in A steht in der Maske");
			assert.ok(anteilGemalt(e, 16.5, 7, 17.5, 8.5) > 0.9,
				"das Loch in A, über dem B liegt, bleibt leer -- der Anstrich fragt nur das eigene Feld");
			assert.ok(inMaske(e, 17, 7.75),
				"das Loch in A, über dem B liegt, ist aus der Maske geschnitten");
		});

		pruefe("[" + lage + "] die Höhenskala gehört der angeklickten Fläche", () => {
			// 🔴 Owner-Vorschlag angenommen 05.09.2026: der Weisspunkt ist das Maximum ÜBER IHRE
			// Zellen. B ist mit 4000 höher und läuft oben weiss aus -- die Zahlen unter der Skala
			// meinen weiterhin die Fläche, deren Regler danebenstehen.
			assert.ok(e.weisspunkt < GIPFEL_B * 0.9,
				"der Weisspunkt (" + e.weisspunkt.toFixed(0) + ") trägt die Höhe des Nachbarn (" + GIPFEL_B + ")");
			assert.ok(Math.abs(e.weisspunkt - GIPFEL_A) < GIPFEL_A * 0.2,
				"der Weisspunkt (" + e.weisspunkt.toFixed(0) + ") ist nicht das Maximum der eigenen "
				+ "Fläche (" + GIPFEL_A + ")");
		});
	}

	console.log("OK: " + gehalten + " Zusicherungen -- der Verbund wird gezeigt, das Rechteck nicht.");
}

alles().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
