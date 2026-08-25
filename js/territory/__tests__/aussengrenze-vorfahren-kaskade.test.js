// "Grenzen berechnen" auf einem BLATT muss die Aussengrenze des Elterngebiets neu rechnen.
//
// 💣 Der Befund (25.08.2026, Owner: "Grenzen berechnen aktualisiert nicht mehr die Aussengrenzen.
// beispiel: nostria und mittelreich"): Koenigreich Nostrias Huelle stand seit dem 12.06.2026
// unveraendert da und wich um 18,68 Flaecheneinheiten von der Union ihrer Quellflaechen ab, waehrend
// das Kaiserreich am selben Tag um 16:37 sauber durchlief. Der Unterschied ist die BAUFORM, nicht
// der Code: zwischen Baronie und Kaiserreich liegen Grafschaft und Herzogtum -- also Aggregate mit
// eigener Huelle, auf denen der Rechtsklick landet. Nostrias sieben Kinder sind alle Blaetter; dort
// landet der Klick auf dem Blatt selbst.
//
// Und ein Blatt MIT Eltern bekommt keine eigene Aussengrenze -- richtig so. Nur brach
// generateOrUpdateDerivedBoundaryForTerritory dort mit `return null` ab, und zwar VOR dem
// Kaskadenblock. Der Server bietet die Arbeit ausdruecklich an; live gemessen fuer "Koenigsland
// Nostria":
//     recompute_targets:    Koenigreich Nostria
//     ancestors_to_refresh: Koenigreich Nostria
// Der Client warf sie weg. Aus Sicht des Editors tat der Knopf nichts.
//
// 🔴 Geprueft wird die VERDRAHTUNG, nicht ein Praedikat: die echte Datei laeuft in einer Sandbox,
// gestubbt sind nur die Geometrie-Mathematik und die Darstellungs-Helfer. Steuerfluss
// (generateOrUpdateDerivedBoundaryForTerritory, die Kaskade, isOwnDerivedBoundaryForbidden,
// findPlanNode) bleibt echt -- eine getestete Funktion, die niemand aufruft, war hier schon
// zweimal der Fehler.
//
// Lauf (aus dem Repo-Wurzelverzeichnis):
//   node js/territory/__tests__/aussengrenze-vorfahren-kaskade.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let checks = 0;
const pruefe = (bedingung, warum) => { assert.ok(bedingung, warum); checks++; };

const quelle = fs.readFileSync(
	path.join(__dirname, "..", "territory-derived-geometry-editor.js"),
	"utf8"
);

// --- Der Datenstand: Koenigsland Nostria (Blatt mit Eltern) unter Koenigreich Nostria (Wurzel) ---
const BLATT = "758ba101-910f-4a21-95d4-4422ebc72766";  // Koenigsland Nostria
const WURZEL = "5a9c98a9-8d50-4e7c-80a1-1ad180f54dc9"; // Koenigreich Nostria
const AGGREGAT = "58058dc8-91e7-43a5-aae8-dede1ee4d8ca"; // Grafschaft Bredenhag (reiner Container)

// ⚠️ Der Plan des Servers fuehrt Vorfahren NICHT in plan_nodes -- nur den Teilbaum. Genau so kommt
// er live an (gemessen 25.08.2026), und darauf ruht die fail-open-Regel von
// isOwnDerivedBoundaryForbidden(null) === false.
function planFuerBlatt() {
	return {
		ok: true,
		territory_public_id: BLATT,
		plan_nodes: [{
			territory_public_id: BLATT,
			name: "Königsland Nostria",
			parent_id: 1715,
			direct_geometry_count: 1,
			child_boundary_source_count: 0,
			can_generate_boundary: true,
		}],
		recompute_targets: [{ territory_public_id: WURZEL, name: "Königreich Nostria" }],
		ancestors_to_refresh: [{ territory_public_id: WURZEL, name: "Königreich Nostria" }],
		warnings: [],
		blocking_warnings: [],
	};
}

function planFuerAggregat() {
	return {
		ok: true,
		territory_public_id: AGGREGAT,
		plan_nodes: [{
			territory_public_id: AGGREGAT,
			name: "Grafschaft Bredenhag",
			parent_id: 4711,
			direct_geometry_count: 0,
			child_boundary_source_count: 8,
			can_generate_boundary: true,
		}],
		recompute_targets: [
			{ territory_public_id: AGGREGAT, name: "Grafschaft Bredenhag" },
			{ territory_public_id: WURZEL, name: "Königreich Nostria" },
		],
		ancestors_to_refresh: [{ territory_public_id: WURZEL, name: "Königreich Nostria" }],
		warnings: [],
		blocking_warnings: [],
	};
}

function baueSandbox(plan) {
	const protokoll = { gespeichert: [], geloescht: [], status: [], toast: [], layerReloads: 0 };

	const elemente = new Map();
	const stubElement = () => ({
		checked: false, disabled: false, value: "", textContent: "", innerHTML: "",
		hidden: false, style: {}, dataset: {},
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		closest() { return null; }, querySelector() { return null; },
		querySelectorAll() { return []; }, appendChild() {}, insertAdjacentHTML() {},
		insertAdjacentElement() {}, setAttribute() {}, removeAttribute() {},
		toggleAttribute() {}, addEventListener() {}, getContext() { return null; },
	});

	const sandbox = {
		console: { log() {}, warn() {}, error() {} },
		setTimeout,
		document: {
			readyState: "complete",
			head: stubElement(),
			body: stubElement(),
			getElementById(id) {
				if (!elemente.has(id)) elemente.set(id, stubElement());
				return elemente.get(id);
			},
			createElement: stubElement,
			addEventListener() {},
		},
		// jQuery-Bereitschaftshaken am Dateiende -- der Panelaufbau gehoert nicht zum Pruefgegenstand.
		$: () => ({ ready() {} }),
		politicalTimelineYear: 1049,
		regionEditEntry: null,
		map: null,
		showFeedbackToast: (text) => protokoll.toast.push(String(text)),
		schedulePoliticalTerritoryLayerReload: () => { protokoll.layerReloads += 1; },
		loadChangeLog: () => {},
		// --- Geometrie-Mathematik (eigene Datei, eigene Tests) ---
		unionDerivedSources: () => ({ geometry: { type: "MultiPolygon", coordinates: [] }, labelCenter: { lng: 1, lat: 2 }, sourceCount: 1 }),
		buildDerivedBoundaryFromSourceResponse: () => ({ geometry: { type: "MultiPolygon", coordinates: [] }, labelCenter: { lng: 1, lat: 2 }, sourceCount: 1 }),
		computeContestedDerivedSplit: () => ({ fillRemainder: null, contestedPieces: null }),
		computeInnerBoundaryMultiLineString: async () => null,
		normalizeClippingMultiPolygon: (wert) => wert,
		roundGeometryCoordinate: (wert) => wert,
		politicalTerritoryRepository: {
			async getDerivedGeometryPlan() { return plan; },
			async getDerivedGeometrySources(id) {
				return { territory_public_id: id, source_geometries: [{ territory_public_id: id, geometry: { type: "Polygon", coordinates: [] } }], source_count: 1 };
			},
			async getDerivedGeometry() { return { derived_geometry: { show_inner_boundaries: true } }; },
			async saveDerivedGeometry(payload) {
				protokoll.gespeichert.push(String(payload && payload.territory_public_id));
				return { derived_geometry: { public_id: "neu-" + protokoll.gespeichert.length } };
			},
			async deleteDerivedGeometry(id) { protokoll.geloescht.push(String(id)); return { ok: true }; },
		},
	};
	sandbox.window = sandbox;
	sandbox.polygonClipping = { union: () => [], difference: () => [], xor: () => [] };
	sandbox.requestAnimationFrame = (fn) => { fn(); return 0; };

	vm.createContext(sandbox);
	vm.runInContext(quelle, sandbox, { filename: "territory-derived-geometry-editor.js" });

	// Darstellung stumm schalten -- NACH dem Lauf, damit die echten Deklarationen ueberschrieben
	// werden. Steuerfluss und Praedikate bleiben unangetastet.
	sandbox.setDerivedGeometryEditorStatus = (text) => protokoll.status.push(String(text));
	sandbox.setDerivedGeometryEditorProgress = () => {};
	sandbox.setDerivedGeometryEditorBusy = () => {};
	sandbox.setDerivedGeometryThumbnail = () => {};
	sandbox.drawDerivedGeometryPreview = () => {};
	sandbox.clearDerivedGeometryPreviewLayer = () => {};
	sandbox.applyDerivedGeometryLeafLock = () => {};

	return { sandbox, protokoll };
}

(async () => {
	// ── Die Wache muss Zaehne haben ──────────────────────────────────────────────────────────────
	{
		const { sandbox } = baueSandbox(planFuerBlatt());
		pruefe(
			typeof sandbox.window.AvesmapsDerivedBoundaryEditor?.generateOrUpdateForTerritory === "function",
			"Die echte Datei ist geladen und stellt generateOrUpdateForTerritory bereit."
		);
		pruefe(
			sandbox.isOwnDerivedBoundaryForbidden({ parent_id: 1715, direct_geometry_count: 1, child_boundary_source_count: 0 }) === true,
			"Gegenprobe: das Blatt MIT Eltern gilt im echten Praedikat wirklich als gesperrt."
		);
		pruefe(
			sandbox.isOwnDerivedBoundaryForbidden(null) === false,
			"Gegenprobe: ein fehlender Plan-Knoten (so kommen Vorfahren an) bleibt fail OPEN."
		);
	}

	// ── 1. Der Kern: Blatt geklickt -> das ELTERNGEBIET wird neu gerechnet ───────────────────────
	{
		const { sandbox, protokoll } = baueSandbox(planFuerBlatt());
		const ergebnis = await sandbox.window.AvesmapsDerivedBoundaryEditor.generateOrUpdateForTerritory(
			BLATT,
			{ drawPreview: false, applyToSubregions: true }
		);

		pruefe(
			protokoll.gespeichert.includes(WURZEL),
			"Ein Klick auf das Blatt muss die Aussengrenze des Elterngebiets neu berechnen und speichern."
		);
		pruefe(
			!protokoll.gespeichert.includes(BLATT),
			"Das Blatt selbst bekommt weiterhin KEINE eigene Aussengrenze."
		);
		pruefe(
			protokoll.geloescht.includes(BLATT),
			"Eine faelschlich vorhandene Blatt-Huelle wird weiterhin entfernt."
		);
		pruefe(ergebnis === null, "Der Rueckgabewert des Blatt-Zweigs bleibt null (kein eigener Speicherstand).");
		pruefe(protokoll.layerReloads > 0, "Die Karte wird nach der Kaskade neu geladen.");
		pruefe(
			protokoll.status.some((text) => /Übergebiet/.test(text)),
			"Die Statuszeile nennt, dass ein Uebergebiet nachgezogen wurde -- sonst sieht der Lauf aus wie 'nichts getan'."
		);
	}

	// ── 2. Keine Regression: der normale Weg zieht die Vorfahren weiter mit ──────────────────────
	{
		const { sandbox, protokoll } = baueSandbox(planFuerAggregat());
		await sandbox.window.AvesmapsDerivedBoundaryEditor.generateOrUpdateForTerritory(
			AGGREGAT,
			{ drawPreview: false, applyToSubregions: true }
		);

		pruefe(
			protokoll.gespeichert.includes(AGGREGAT),
			"Ein reiner Container bekommt weiterhin seine eigene Aussengrenze."
		);
		pruefe(
			protokoll.gespeichert.includes(WURZEL),
			"Und seine Vorfahren werden weiterhin nachgezogen."
		);
		pruefe(
			protokoll.gespeichert.indexOf(AGGREGAT) < protokoll.gespeichert.indexOf(WURZEL),
			"Reihenfolge bleibt: erst das Ziel, dann die Vorfahren -- ein Vorfahre, der vor seinem Kind rechnet, vereinigt einen alten Stand."
		);
	}

	// ── 3. Ein Blatt OHNE Vorfahren-Arbeit bleibt eine ruhige Absage ─────────────────────────────
	{
		const plan = planFuerBlatt();
		plan.recompute_targets = [];
		plan.ancestors_to_refresh = [];
		const { sandbox, protokoll } = baueSandbox(plan);
		await sandbox.window.AvesmapsDerivedBoundaryEditor.generateOrUpdateForTerritory(
			BLATT,
			{ drawPreview: false, applyToSubregions: true }
		);

		pruefe(protokoll.gespeichert.length === 0, "Ohne Vorfahren im Plan wird nichts gespeichert.");
		pruefe(
			protokoll.status.some((text) => /keine eigene Außengrenze/.test(text)),
			"Dann steht dort weiterhin die Erklaerung, warum ein Blatt keine eigene Grenze bekommt."
		);
	}

	console.log(`aussengrenze-vorfahren-kaskade: ${checks} Zusicherungen gruen`);
})().catch((error) => {
	console.error(error && error.message ? error.message : error);
	process.exit(1);
});
