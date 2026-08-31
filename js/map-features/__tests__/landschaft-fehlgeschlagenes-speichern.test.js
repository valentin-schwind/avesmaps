// Ein fehlgeschlagenes Flächen-Speichern (Systemtest B15).
//
// 🪤 DER BEFUND: der `catch` hielt den gezeichneten Umriss in `ecosystemPendingAreaRing` und
// versprach im Kommentar „nach einem Fehlschlag soll niemand neu zeichnen müssen". Eingelöst hat es
// nie jemand -- `resumePendingEcosystemAreaSave` war die einzige Funktion, die ihn wieder eingereicht
// hätte, und sie wurde NIRGENDS gerufen (Bezeichner-Häufigkeit über alle getrackten Dateien: genau 1,
// die Deklaration). Der gemerkte Ring verfiel still beim nächsten Escape oder beim nächsten Erfolg.
//
// 💣 UND NAIV NACHGEBAUT WÄRE ER SCHLIMMER ALS SEIN FEHLEN -- gemessen, nicht vermutet: ein Speichern
// sind ZWEI Aufrufe (create_region, dann create_area) ohne Klammer darum. Scheitert der zweite, steht
// die Region schon; ein zweiter Anlauf mit demselben Ring legt eine WEITERE an und lässt die erste
// ohne Fläche liegen. Abschnitt C fährt genau das und hält die Zahl fest.
//
// Deshalb ist das Versprechen gefallen statt eingelöst worden, und dieser Test nagelt fest, was an
// seine Stelle getreten ist: der Editor ERFÄHRT den Fehlschlag, und es bleibt nichts Gemerktes
// zurück, das ein späterer Speichervorgang heimlich mitschickt.
//
// ZUR LAUFZEIT gefahren: der echte Zeichenweg (start -> Klicks -> finish -> save) läuft im
// vm-Kontext gegen eine Attrappe von `postEcosystemEdit`.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-fehlgeschlagenes-speichern.test.js
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⭐ Zeilenenden-neutral (AGENTS.md §9): Arbeitskopie CRLF, CI LF.
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
const ZEICHNER = "js/map-features/map-features-ecosystem-draw.js";
let checks = 0;

// ---- Bühne ----------------------------------------------------------------------------------------

// Eine Karte, die nur mitschreibt -- dieselbe Attrappe wie in werkzeug-klick-toleranz.test.js.
function baueMap() {
	const handler = new Map();
	return {
		on(t, f) { if (!handler.has(t)) handler.set(t, []); handler.get(t).push(f); },
		off(t, f) { const l = handler.get(t) || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); },
		addLayer() {}, removeLayer() {}, hasLayer: () => false,
		getContainer: () => ({ classList: { add() {}, remove() {} } }),
		dragging: { _draggable: { options: { clickTolerance: 3 } } },
		doubleClickZoom: { enable() {}, disable() {}, enabled() { return false; } },
	};
}

// `antwort(aktion)` entscheidet je Aufruf: ein Error wird abgelehnt, alles andere aufgelöst.
function baueBuehne(antwort) {
	const gesendet = [];
	const toasts = [];
	const ebene = () => ({ addTo() { return this; } });
	let uhr = 0;

	const kontext = {
		console, JSON, Math, Number, String, Boolean, Array, Object, Promise, Map,
		document: { addEventListener() {}, removeEventListener() {}, documentElement: {} },
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
		map: baueMap(),
		L: {
			latLng: (a, b) => (typeof a === "object" ? { lat: a.lat, lng: a.lng } : { lat: a, lng: b }),
			polyline: ebene, circleMarker: ebene, layerGroup: ebene,
			DomEvent: { stop() {} },
		},
		// 💣 Die Uhr muss WACHSEN: `isEcosystemDrawEchoClick` schluckt sonst jeden Klick nach dem
		// ersten als Echo des Doppelklicks, und die Fläche bekäme nie ihre drei Ecken.
		performance: { now: () => (uhr += 1000) },
		isEcosystemLayerModeActive: () => true,
		closeEcosystemGeometryEdit() {}, setSelectedEcosystemArea() {},
		syncEcosystemMapEditingClass() {}, syncEcosystemDoubleClickZoom() {},
		clearEcosystemEditSnapPreview() {}, renderEcosystemEditSnapPreview() {},
		ecosystemEditSnapTarget: () => null, isEcosystemEditDetachModifier: () => false,
		showFeedbackToast: (text, art) => { toasts.push({ text, art }); },
		avesmapsWerkzeugKlickToleranzAnheben() {}, avesmapsWerkzeugKlickToleranzZuruecknehmen() {},
		getActiveEcosystemLayerKind: () => "vegetation",
		repairEcosystemGeometry: (g) => g,
		normalizeEcosystemDrawnRing: (ring) => (ring.length >= 3 ? [...ring, ring[0]] : null),
		nextEcosystemRegionAutoName: () => "Flaeche-100",
		ecosystemRegionsByKind: {},
		loadEcosystemAreas: () => Promise.resolve(),
		invalidateEcosystemRegionCache() {},
		postEcosystemEdit: (aktion, rumpf) => {
			gesendet.push({ aktion, rumpf });
			const wert = antwort(aktion);
			return wert instanceof Error ? Promise.reject(wert) : Promise.resolve(wert);
		},
	};
	kontext.window = {};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(lies(ZEICHNER), kontext);

	// Eine Ecke setzen heisst: den ECHTEN Klick-Handler fahren. Die Container-Punkte liegen weit
	// auseinander, sonst greift der Echo-Filter des Doppelklicks.
	const klick = (x, y) => kontext.handleEcosystemDrawClick({
		latlng: { lat: y, lng: x },
		containerPoint: { x, y, distanceTo: (o) => Math.hypot(o.x - x, o.y - y) },
	});
	const zeichneUndSpeichere = async (ecken) => {
		kontext.startEcosystemAreaDrawing();
		ecken.forEach(([x, y]) => klick(x, y));
		await kontext.finishEcosystemAreaDrawing();
	};

	const aktionen = () => gesendet.map((e) => e.aktion);

	return { kontext, gesendet, toasts, zeichneUndSpeichere, aktionen };
}

const DREIECK = [[10, 10], [200, 10], [200, 200]];
const ZWEITES_DREIECK = [[300, 300], [400, 300], [400, 400]];
const scheitert = () => new Error("Serverfehler beim Anlegen.");

async function main() {
	// ── A. DER EDITOR ERFÄHRT DEN FEHLSCHLAG ─────────────────────────────────────────────────────
	// Das ist die ehrliche Zusage, die an die Stelle des uneingelösten Versprechens getreten ist.
	// Wer den Fehler hier je schluckt, nimmt dem Editor das EINZIGE Signal, dass nichts gespeichert
	// wurde -- und dann ist der Verlust wirklich still.
	{
		const b = baueBuehne(() => scheitert());
		await b.zeichneUndSpeichere(DREIECK);
		assert.deepStrictEqual(b.aktionen(), ["create_region"],
			"der Speicherversuch läuft wirklich los"); checks++;
		const letzter = b.toasts[b.toasts.length - 1];
		assert.strictEqual(letzter.art, "warning",
			"ein Fehlschlag meldet sich als Warnung -- nie stumm, nie als Erfolg"); checks++;
		assert.match(letzter.text, /Serverfehler beim Anlegen\./,
			"…und reicht den Grund des Servers durch, wo er einen nennt"); checks++;
	}

	// ── B. ES BLEIBT NICHTS GEMERKTES ZURÜCK ─────────────────────────────────────────────────────
	// 💣 Der Kern von B15. Ein zweiter Speichervorgang darf NICHT heimlich einen alten Umriss
	// mitschicken -- und schon gar nicht einen, den der Editor längst vergessen hat.
	{
		const b = baueBuehne(() => scheitert());
		await b.zeichneUndSpeichere(DREIECK);
		b.gesendet.length = 0;
		await b.zeichneUndSpeichere(ZWEITES_DREIECK);
		assert.deepStrictEqual(b.aktionen(), ["create_region"],
			"der zweite Versuch ist EIN frischer Anlauf, kein nachgereichter Ring"); checks++;

		// 🪤 Und die Gegenprobe auf den Bezeichner selbst: taucht wieder ein gehaltener Umriss auf,
		// muss ihn jemand RUFEN. Genau diese Zählung hat B15 belegt.
		const quelle = lies(ZEICHNER);
		assert.ok(!/ecosystemPendingAreaRing/.test(quelle),
			"kein gehaltener Umriss mehr im Zeichner"); checks++;
		assert.ok(!/resumePendingEcosystemAreaSave/.test(quelle),
			"…und kein Wiedereinreicher, den niemand ruft"); checks++;
	}

	// ── C. WARUM ER NICHT NAIV ZURÜCKKOMMEN DARF ─────────────────────────────────────────────────
	// 🔴 Diese Messung IST die Begründung der Entscheidung und steht deshalb im Test, nicht nur im
	// Kommentar: create_region gelingt, create_area scheitert -- die Region steht dann schon. Ein
	// zweiter Anlauf mit demselben Ring legt eine ZWEITE an. Wer das Versprechen einlösen will, muss
	// zuerst die schon angelegte Region WIEDERVERWENDEN.
	{
		let regionen = 0;
		const b = baueBuehne((aktion) => {
			if (aktion !== "create_region") {
				return scheitert();
			}
			regionen += 1;
			return { region: { public_id: `reg-${regionen}` } };
		});
		await b.zeichneUndSpeichere(DREIECK);
		assert.deepStrictEqual(b.aktionen(), ["create_region", "create_area"],
			"ein Speichern sind ZWEI Aufrufe"); checks++;
		assert.strictEqual(regionen, 1,
			"…und nach dem Teilausfall steht die Region bereits"); checks++;

		// Der zweite Anlauf -- genau so, wie ein Wiedereinreicher ihn gefahren hätte.
		await b.zeichneUndSpeichere(DREIECK);
		assert.strictEqual(regionen, 2,
			"ein zweiter Anlauf legt eine WEITERE Region an -- die erste bliebe ohne Fläche liegen"); checks++;
	}

	// ── D. KEINE TOTE FUNKTION IM ZEICHNER ───────────────────────────────────────────────────────
	// ⭐ Die allgemeine Form von B15: eine Funktion, die niemand ruft, ist ein Versprechen ohne
	// Einlöser. Gezählt wird über ALLE getrackten Dateien -- ein Aufruf kann auch in einer .php-Seite
	// oder als Attributwert in einer .html stehen.
	{
		const quelle = lies(ZEICHNER);
		const namen = [...quelle.matchAll(/^(?:async )?function (\w+)\(/gm)].map((m) => m[1]);
		assert.ok(namen.length > 15,
			"die Funktionsliste des Zeichners wurde wirklich gefunden"); checks++;

		const dateien = execFileSync("git", ["ls-files"], { cwd: wurzel, encoding: "utf8" })
			.split("\n")
			.filter((datei) => /\.(js|mjs|html|php)$/.test(datei));
		// 🪤 Eine ungetrackte Datei fiele hier heraus -- deshalb ist der Zähler eine UNTERGRENZE, und
		// die Richtung ist die sichere: ein übersehener Aufruf macht den Test rot, nie fälschlich grün.
		const text = dateien.map((datei) => {
			try {
				return fs.readFileSync(path.join(wurzel, datei), "utf8");
			} catch {
				return "";
			}
		}).join("\n");

		const ungerufen = namen.filter(
			(name) => (text.match(new RegExp(`\\b${name}\\b`, "g")) || []).length <= 1
		);
		assert.deepStrictEqual(ungerufen, [],
			"jede Funktion des Zeichners wird auch gerufen -- sonst ist der fehlende Aufruf der Fehler"); checks++;
	}

	console.log(`ok -- ${checks} Zusicherungen`);
}

main().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
