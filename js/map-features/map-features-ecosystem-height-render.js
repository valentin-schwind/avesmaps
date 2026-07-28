"use strict";

/*
 * Landschaften — das Höhenfeld ZEICHNEN (V8).
 *
 * Canvas-Overlay über den Topographie-Flächen. Muster: map-features-contested-hatch-overlay.js --
 * eigene Pane, `leaflet-zoom-animated`, Neuzeichnen auf moveend/zoomend/viewreset/resize.
 *
 * 🔴 NUR bei aktiver Landschaften-Ebene UND aktiver Topographie. In jeder anderen Lage ist das Canvas
 * leer; das Umschalten der Ebene löscht es also von selbst.
 *
 * 🔴 `is_trial`-Flächen werden MITGEZEICHNET. Beide `gebirge`-Flächen im Livebestand (Stand 2026-07-28:
 * „Finsterkamm" und „Random Berge") sind Erprobungsflächen -- sie auszulassen hiesse, dass die Abnahme
 * eine leere Karte zeigt.
 *
 * 🔴 Farben NUR aus css/base/tokens.css (AGENTS.md §12). Der Prototyp trug seine Rampe als rohe
 * RGB-Tripel im Code (:589); hier steht sie in fünf Token.
 *
 * Liest die Globalen `map`, `L`, `ecosystemLayers`, `labelData` sowie die beiden Höhenmodule.
 */
(function initEcosystemHeightRender() {
	const PANE = "avesmapsEcosystemHeightPane";
	// Rasterschritt in Bildschirmpunkten. Der Prototyp lässt ihn einstellen (:601); hier fest, weil der
	// Wert eine Perf-Entscheidung ist und keine Gestaltungsfrage. 3 px sieht auf HiDPI weich aus und
	// hält die Rechnung bei rund einem Neuntel der Pixelzahl.
	const STEP = 3;
	const RAMP_TOKENS = [
		"--color-ecosystem-height-min",
		"--color-ecosystem-height-max",
	];
	// Zwei Stützstellen, linear dazwischen: schwarz bei 0, weiss beim Weisspunkt. Die alte Fünf-Farben-
	// Rampe hatte ungleiche Stufen, damit nicht jeder Mittelhang schon weiss wurde -- bei einer reinen
	// Graustufe wäre dieselbe Krümmung eine versteckte Behauptung über Höhen, die die Daten nicht hergibt.
	const RAMP_STOPS = [0, 1];
	// 🔴 Der Weisspunkt in SCHRITT, absolut (Owner 2026-07-28). Vorher war der Bezug der höchste Gipfel
	// der TREFFENDEN Fläche, die Skala also je Gebirge eine andere -- ein Grauwert bedeutete nichts, was
	// man zwischen zwei Flächen hätte vergleichen können.
	//
	// 💣 DIES ist die Stellschraube, nicht die Farben. Je höher der Wert, desto dunkler und flacher wird
	// alles darunter: bei 15.000 und Gipfeln, die per Vorgabe auf 5.000 stehen, spielt sich der halbe
	// Bestand im unteren Drittel ab. Wer das Relief „zu dunkel" findet, senkt diese Zahl -- er greift
	// nicht in die Rampe und nicht in die Deckkraft.
	//
	// Die Einheit ist SCHRITT, nicht Meter, und steht wie überall im Namen (avesmapsReadOptionalPeakHeight,
	// features.php): V11 multipliziert Höhen in Kantengewichte und trägt dort eine dokumentierte
	// Einheitenfalle. Der Regler im Label-Dialog läuft 0..20.000, dieser Wert liegt also drin.
	const HEIGHT_WHITE_SCHRITT = 15000;

	function ready() {
		return typeof map !== "undefined" && map && typeof map.createPane === "function" && typeof L !== "undefined";
	}
	if (!ready()) {
		window.setTimeout(initEcosystemHeightRender, 50);
		return;
	}

	if (!map.getPane(PANE)) {
		map.createPane(PANE);
		const created = map.getPane(PANE);
		// Über den Flächenfüllungen der Ökosystem-Panes, unter den Labels (475) -- die Gipfel müssen
		// oben bleiben, sie werden ja gezogen.
		created.style.zIndex = 420;
		created.style.pointerEvents = "none";
	}

	const canvas = document.createElement("canvas");
	canvas.style.position = "absolute";
	canvas.style.pointerEvents = "none";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.transformOrigin = "0 0";
	// Die Deckkraft steht im Token, nicht hier: sie ist eine Gestaltungsgrösse (AGENTS.md §12), und der
	// Schleier soll die Regionsfarbe darunter durchlassen statt sie zu ersetzen.
	canvas.classList.add("leaflet-zoom-animated", "avesmaps-ecosystem-height-canvas");
	map.getPane(PANE).appendChild(canvas);
	const context = canvas.getContext("2d");

	// Der gebaute Stapel, gültig bis sich Flächen oder Gipfel ändern. Neu zu bauen ist teuer (Buckel,
	// Index, Dämpfungsmessung je Fläche); neu zu ZEICHNEN ist es nicht.
	let heightStack = null;
	let stackDirty = true;
	let rampCache = null;
	let lastPaintMs = 0;

	function rampColors() {
		if (rampCache) {
			return rampCache;
		}
		const style = getComputedStyle(document.documentElement);
		rampCache = RAMP_TOKENS.map((token) => {
			const raw = String(style.getPropertyValue(token) || "").trim();
			const hex = /^#([0-9a-f]{6})$/i.exec(raw);
			if (!hex) {
				return [128, 128, 128];
			}
			const value = parseInt(hex[1], 16);
			return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
		});

		return rampCache;
	}

	// Lineare Interpolation zwischen den fünf Stützstellen (Prototyp ramp() :590).
	function rampAt(t) {
		const colors = rampColors();
		const clamped = Math.max(0, Math.min(1, t));
		for (let i = 0; i < RAMP_STOPS.length - 1; i++) {
			const from = RAMP_STOPS[i];
			const to = RAMP_STOPS[i + 1];
			if (clamped <= to) {
				const k = to === from ? 0 : (clamped - from) / (to - from);
				const a = colors[i];
				const b = colors[i + 1];
				return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
			}
		}

		return colors[colors.length - 1];
	}

	function topographyAreas() {
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return [];
		}
		const areas = [];
		ecosystemLayers.forEach((layer) => {
			const area = layer?._ecosystemArea;
			// `is_trial` wird NICHT gefiltert -- siehe Kopf.
			if (area && area.kind === "topographie" && String(area.region_type || "") === "gebirge") {
				areas.push(area);
			}
		});

		return areas;
	}

	// Gipfel als flache Liste in KARTENkoordinaten. 💣 Labels tragen [lat, lng] = [y, x], die Geometrie
	// will [x, y] -- bewusst tauschen (AGENTS.md §5).
	function peakList() {
		if (typeof labelData === "undefined" || !Array.isArray(labelData)) {
			return [];
		}

		return labelData
			.filter((label) => isEcosystemPeakSubtype(label?.labelType))
			.map((label) => ({
				publicId: String(label.publicId || ""),
				x: Number(label.coordinates?.[1]),
				y: Number(label.coordinates?.[0]),
				height: label.heightSchritt === undefined ? null : label.heightSchritt,
			}))
			.filter((peak) => Number.isFinite(peak.x) && Number.isFinite(peak.y));
	}

	function ensureStack() {
		if (!stackDirty && heightStack) {
			return heightStack;
		}
		if (typeof buildEcosystemHeightStack !== "function") {
			return null;
		}
		heightStack = buildEcosystemHeightStack(topographyAreas(), peakList());
		stackDirty = false;

		return heightStack;
	}

	// Von aussen: die Felder sind veraltet.
	function invalidateEcosystemHeightField() {
		stackDirty = true;
		heightStack = null;
	}

	function shouldDraw() {
		return typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive()
			&& typeof getActiveEcosystemLayerKind === "function"
			&& getActiveEcosystemLayerKind() === "topographie";
	}

	function redraw() {
		if (!map.getPane(PANE)) {
			return;
		}
		const size = map.getSize();
		// 💣 Eine Karte ohne Ausdehnung. Kommt vor, bevor das Layout steht, in einem verborgenen Reiter
		// und in jedem Prüfaufbau ohne sichtbaren Rahmen. `createImageData(0, 0)` WIRFT, und der Wurf
		// reisst den ganzen Ebenenwechsel mit -- redraw() hängt an syncEcosystemPaneStates. Erst
		// gemessen, dann gefangen: der Fehler trat beim ersten Prüflauf genau so auf.
		if (!(size.x > 0) || !(size.y > 0)) {
			return;
		}
		const topLeft = map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setPosition(canvas, topLeft);

		// HiDPI: Backing-Store in Geräte-Pixeln, CSS-Größe in Layout-Pixeln.
		const dpr = window.devicePixelRatio || 1;
		const pixelWidth = Math.round(size.x * dpr);
		const pixelHeight = Math.round(size.y * dpr);
		if (canvas.width !== pixelWidth) { canvas.width = pixelWidth; }
		if (canvas.height !== pixelHeight) { canvas.height = pixelHeight; }
		if (canvas.style.width !== size.x + "px") { canvas.style.width = size.x + "px"; }
		if (canvas.style.height !== size.y + "px") { canvas.style.height = size.y + "px"; }
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (!shouldDraw()) {
			return;                          // Canvas ist oben schon geleert -> Ebenenwechsel löscht es
		}

		const stack = ensureStack();
		if (!stack || !Array.isArray(stack.fields) || stack.fields.length === 0) {
			return;
		}

		const started = performance.now();
		const image = context.createImageData(pixelWidth, pixelHeight);
		const data = image.data;
		const fields = stack.fields;
		const window_ = stack.peakWindow;

		// EIN Durchgang über das Raster. Je Rasterpunkt einmal in Kartenkoordinaten umrechnen, dann über
		// die Felder summieren.
		//
		// 🔴 Bezug ist HEIGHT_WHITE_SCHRITT, global und fest (Owner 2026-07-28). Vorher war es `hmax` der
		// treffenden Fläche. Der alte Kommentar hielt dagegen, eine globale Skala färbe beim Verstellen
		// EINER Fläche jede andere um -- das stimmt und ist jetzt gewollt: genau das macht zwei Gebirge
		// überhaupt erst vergleichbar. Solange der Bezug je Fläche galt, sagte ein Grauwert nur „hoch für
		// hier" und nie „hoch".
		// 🔴 PERF: die Projektion EINMAL aufstellen, nicht je Rasterpunkt. `L.CRS.Simple` ist affin und
		// dreht nicht -- Bildschirm-x hängt allein an lng, Bildschirm-y allein an lat. Zwei Stützpunkte
		// genügen also, um daraus eine Schrittweite zu machen. Gemessen kostete
		// `containerPointToLatLng` je Punkt 10,9 ms auf 60.000 Abfragen; so kostet es zwei Aufrufe.
		const originLatLng = map.containerPointToLatLng([0, 0]);
		const stepLatLng = map.containerPointToLatLng([STEP, STEP]);
		const deltaX = (stepLatLng.lng - originLatLng.lng) / STEP;
		const deltaY = (stepLatLng.lat - originLatLng.lat) / STEP;

		for (let sy = 0; sy < size.y; sy += STEP) {
			const y = originLatLng.lat + sy * deltaY;
			for (let sx = 0; sx < size.x; sx += STEP) {
				const x = originLatLng.lng + sx * deltaX;
				const noiseWindow = window_ ? window_.sample(x, y) : 1;
				let height = 0;
				for (let i = 0; i < fields.length; i++) {
					const value = sampleEcosystemHeightField(fields[i], x, y, noiseWindow);
					if (value > 0) {
						height += value;
					}
				}
				// 🔴 `continue` heisst: dieser Punkt bleibt UNBERÜHRT, also alpha 0. Nur so bleibt der
				// Schleier auf die Flächen begrenzt -- ein hier gemaltes Schwarz zöge sich sonst über die
				// ganze Karte, weil „keine Höhe" und „Höhe 0" denselben Grauwert hätten.
				if (height <= 0) {
					continue;
				}
				const color = rampAt(height / HEIGHT_WHITE_SCHRITT);
				const r = color[0], g = color[1], b = color[2];
				// Den Rasterpunkt als STEP×STEP-Block ausfüllen, in Geräte-Pixeln.
				const px0 = Math.round(sx * dpr);
				const py0 = Math.round(sy * dpr);
				const px1 = Math.min(pixelWidth, Math.round((sx + STEP) * dpr));
				const py1 = Math.min(pixelHeight, Math.round((sy + STEP) * dpr));
				for (let py = py0; py < py1; py++) {
					let offset = (py * pixelWidth + px0) * 4;
					for (let px = px0; px < px1; px++) {
						data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
						offset += 4;
					}
				}
			}
		}
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.putImageData(image, 0, 0);
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		lastPaintMs = performance.now() - started;

		// Wo das Budget gegriffen hat, sagt es das Feld -- statt still weniger zu liefern
		// (Prototyp :541-543). Einmal je Neuaufbau, nicht bei jedem Bild.
		fields.forEach((field, index) => {
			if (field.stoppedAtLevel && !field._budgetReported) {
				field._budgetReported = true;
				if (typeof showFeedbackToast === "function") {
					showFeedbackToast(`Höhenfeld „${stack.areaIdsByField[index]}": Detailstufe ${field.stoppedAtLevel} `
						+ "wurde ausgelassen, das Rechenbudget war erschöpft.", "info");
				}
			}
		});
	}

	// ---- Die Invalidierungskante ----------------------------------------------------------------------
	//
	// Jede Gipfeländerung -- verschieben, anlegen, löschen, Höhe eintragen -- macht das Höhenfeld
	// ungültig (oekosystem-editor-leitfaden.md Z. 204-207). Gerufen aus drei Ecken: dem Zug auf der
	// Karte (map-features-labels.js), dem Höhenfeld im Landschaften-Panel und künftig dem Löschen.
	//
	// 🔴 ES WIRD ALLES NEU GEBAUT, NICHT NUR DIE ENTHALTENDE FLÄCHE -- und das ist eine Abweichung vom
	// Plan, die auf zwei Messungen beruht:
	//
	//  1. **Teilweise wäre falsch.** Das Gipfelfenster ist GLOBAL (das ist der Kern von V8), und aus ihm
	//     kommt die Radiusklemme jedes Gipfels: der Abstand zu seinem nächsten Nachbarn. Verschiebt sich
	//     ein Gipfel, kann er der neue nächste Nachbar eines Gipfels in einer ganz anderen Fläche
	//     werden. Nur die enthaltende Fläche neu zu rechnen liesse deren Radius stehen -- ein stiller
	//     Fehler, sichtbar erst als falsche Bergform irgendwo weit weg.
	//  2. **Teilweise wäre die Optimierung der billigen Hälfte.** Gemessen am Livebestand (2 Flächen,
	//     62 Gipfel): Stapel komplett neu = **3,7 ms**, davon das Fenster 0,4 ms. Das anschliessende
	//     Neuzeichnen kostet **36 ms** -- der Neubau ist ein Zehntel dessen, was ohnehin folgt.
	//
	// ⚠️ Das kippt, wenn die Zahl der Gebirgsflächen wächst. Bei den ~60, die der Bestand braucht, läge
	// der Neubau grob bei 110 ms und wäre den Aufwand wert. Dann ist der richtige Schnitt: Fenster immer
	// neu (billig), Felder nur dort, wo der Gipfel lag ODER jetzt liegt, PLUS bei jedem Gipfel, dessen
	// nächster Nachbar sich geändert hat. Vorher nicht -- es wäre Komplexität ohne Gegenwert.
	function invalidateEcosystemHeightForPeak(label) {
		// Welche Flächen es betrifft, wird ERMITTELT, bevor der Stapel weggeworfen wird -- danach ist die
		// Frage nicht mehr beantwortbar. Der Wert ist die Diagnose, nicht die Steuerung.
		let affected = [];
		const x = Number(label?.coordinates?.[1]);
		const y = Number(label?.coordinates?.[0]);
		if (heightStack && Number.isFinite(x) && Number.isFinite(y)
			&& typeof ecosystemHeightFieldsAtPoint === "function") {
			affected = ecosystemHeightFieldsAtPoint(heightStack, x, y);
		}
		invalidateEcosystemHeightField();
		redraw();

		return affected;
	}
	window.invalidateEcosystemHeightForPeak = invalidateEcosystemHeightForPeak;

	map.on("moveend zoomend viewreset resize", redraw);
	// Die Flächen können nach dem ersten Zeichnen eintreffen; ein paar Nachzügler-Durchgänge holen sie.
	[150, 500, 1200].forEach((delay) => window.setTimeout(redraw, delay));

	window.AvesmapsEcosystemHeightRender = {
		redraw,
		invalidate: invalidateEcosystemHeightField,
		lastPaintMs: () => lastPaintMs,
		stack: () => heightStack,
	};
})();
