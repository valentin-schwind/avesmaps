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
	// Wert eine Perf-Entscheidung ist und keine Gestaltungsfrage.
	//
	// 🔴 4 statt 3 (Owner-Entscheid 2026-07-28: „die auflösung etwas zu reduzieren"). Die Antwort auf ein
	// erschöpftes Rechenbudget ist hier gröber zu rechnen, nicht das Budget zu erhöhen -- ein Höhenfeld
	// ist ein weiches Gebilde aus überlagerten Buckeln, dem ein Pixel mehr Kantenlänge nichts nimmt.
	// Der Aufwand fällt quadratisch: 4 px kostet rund 44 % weniger Abfragen als 3 px (1/16 statt 1/9
	// der Pixel), und das kommt genau den Reglern zugute, die jetzt beim Ziehen live neu bauen.
	const STEP = 4;
	const RAMP_TOKENS = [
		"--color-ecosystem-height-0",
		"--color-ecosystem-height-1",
		"--color-ecosystem-height-2",
		"--color-ecosystem-height-3",
		"--color-ecosystem-height-4",
	];
	// 🔴 Die ungleichen Stützstellen des Prototyps (:589), auf Owner-Wunsch zurück. Der Übergang ins
	// Firn sitzt spät (0,8), damit nicht jeder Mittelhang schon weiss wird.
	//
	// Ein früherer Einwand gegen diese Krümmung lautete, sie sei bei einer reinen Graustufe eine
	// versteckte Behauptung über Höhen. Er trägt hier nicht mehr: die Skala ist nicht mehr die
	// Datenaussage (die steht in height_schritt), sondern ausdrücklich eine Lesehilfe, und eine
	// Lesehilfe darf ihre Auflösung dorthin legen, wo man sie braucht.
	const RAMP_STOPS = [0, 0.25, 0.55, 0.8, 1];
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
	// 🔴 EINE DARSTELLUNGSSKALA, KEINE AUSSAGE ÜBER DIE DATEN (Owner-Entscheid 2026-07-28).
	//
	// Weiss heisst „5.000 Schritt ODER MEHR". Darüber wird gekappt: ein 13.000er sieht aus wie ein
	// 10.000er. Das ist ein bewusster Tausch, und der Owner hat ihn richtig begründet -- oben ist die
	// Auflösung verschenkt (den Unterschied sieht niemand), unten entscheidet sie alles (1.000 gegen
	// 5.000 ist Hügel gegen Wall, und genau dort wohnt der Bestand).
	//
	// 💣 DIE ZAHL BLEIBT DIE WAHRHEIT. V11 rechnet Reisezeiten aus `height_schritt`, NIE aus einem
	// Grauwert. Solange das gilt, darf die Anzeige klemmen und stauchen, ohne dass ein Berg dadurch
	// niedriger wird. Wer das je umdreht -- Kantengewichte aus dem gemalten Bild ziehen -- macht aus
	// einer Lesehilfe eine Datenquelle und aus dieser Kappung einen stillen Höhenverlust.
	const HEIGHT_WHITE_SCHRITT = 5000;
	// Ab dieser Höhe ist der Schleier voll deckend. Bewusst die VORGABEHÖHE eines Gipfels
	// (ECOSYSTEM_HEIGHT_DEFAULT): ein unbearbeiteter Gipfel soll deutlich zu sehen sein, sonst prüft
	// niemand, was er noch eintragen muss. Darüber ändert sich nur noch die FARBE, Richtung Weiss --
	// ein 10.000er ist damit heller als ein 5.000er, obwohl beide voll decken.
	// Deckkraft und Farbe fallen jetzt zusammen: bei 5.000 ist beides am Anschlag. Die Konstante
	// bleibt getrennt, weil die zwei Fragen es sind -- wer den Weisspunkt verschiebt, soll nicht
	// unbeabsichtigt auch die Lesbarkeit verschieben.
	const HEIGHT_FULL_VEIL_SCHRITT = 5000;

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
	// Solange der Flächendialog offen ist: volle Deckung statt höhenabhängigem Alpha.
	let solidMode = false;

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

	// Welche (Fläche, Stufe) schon gemeldet wurde. Ausserhalb der Felder, damit ein Neubau sie nicht
	// vergisst -- beim Reglerziehen entstehen sonst Dutzende gleicher Meldungen.
	const budgetReported = new Set();

	// Der Name, den der Editor kennt -- nicht die UUID.
	function areaName(publicId) {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(String(publicId || ""))
			: null;

		return String(layer?._ecosystemArea?.region_name || publicId || "Ohne Namen");
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
		// 💣 EIN LEERES ERGEBNIS WIRD NICHT GEMERKT. Die Flächen kommen erst, wenn jemand die
		// Landschaften-Ebene betritt -- die Nachzügler-Durchgänge beim Seitenstart (150/500/1200 ms)
		// laufen also über eine LEERE `ecosystemLayers`. Wurde dieses Nichts als „sauber" abgelegt, baute
		// der Stapel nie wieder, und die Topographie blieb für den Rest der Sitzung leer.
		//
		// Am Livestand genau so gemessen (2026-07-28): 9 Flächen geladen, davon 2 Gebirge, und trotzdem
		// `fields: 0` -- ein `invalidate()` von Hand liess sofort 2 Felder und 1.005.335 gemalte Pixel
		// erscheinen. Die eigene Abnahme hatte das nicht gefunden, weil sie die Flächen VOR dem ersten
		// Zeichnen einspeiste und damit nie den echten Ablauf durchlief.
		//
		// Dieselbe Regel steht in V7 für den Territorien-Fächer, aus demselben Grund.
		stackDirty = !heightStack || heightStack.fields.length === 0;

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
				// 🔴 DIE HÖHE STEUERT AUCH DIE DECKKRAFT, nicht nur die Farbe (Owner 2026-07-28:
				// „es soll der Eindruck entstehen, dass beim Klicken nur das Höhenmodell der Berge
				// sichtbar wird").
				//
				// Vorher lag der Schleier mit voller Alpha über der Fläche und war unten fast schwarz --
				// beim Aktivieren wurde ein warm brauner Gebirgszug zu einem dunklen Fleck, und die
				// Geländekacheln darunter verschwanden mit. Das las sich als „die Fläche schaltet um",
				// nicht als „das Höhenmodell kommt dazu".
				//
				// Jetzt: bei Höhe 0 ist der Schleier DURCHSICHTIG -- die Fläche sieht aus wie im Ruhezustand
				// --, und er verdichtet sich mit der Höhe bis zum Weisspunkt. Der Fuss eines Gebirges bleibt
				// also unangetastet, die Kuppen leuchten auf. Zusätzlich beginnt die Rampe nicht mehr bei
				// Schwarz, sondern bei der Grundfarbe der Fläche selbst (--color-ecosystem-height-min), damit
				// auch der halbdurchsichtige Bereich dazwischen die Fläche nicht eintrübt.
				const t = Math.max(0, Math.min(1, height / HEIGHT_WHITE_SCHRITT));
				const color = rampAt(t);
				const r = color[0], g = color[1], b = color[2];
				// 🔴 FARBE und DECKKRAFT haben verschiedene Bezugsgrössen, und das ist Absicht.
				//
				// Die Farbe trägt die absolute Skala bis HEIGHT_WHITE_SCHRITT -- ein Grauwert bedeutet
				// überall dieselbe Höhe. Die Deckkraft trägt die LESBARKEIT und ist bei
				// HEIGHT_FULL_VEIL_SCHRITT voll. Beides an denselben Bezug zu hängen ging schief: bei
				// einem Weisspunkt von 15.000 erreicht ein Gipfel der Vorgabehöhe 5.000 nur ein Drittel
				// der Skala, das Alpha blieb bei 147/255 und wurde von der CSS-Deckkraft noch einmal
				// halbiert -- effektiv 32 %. Über flachem Braun sah das noch nach etwas aus, über den
				// texturierten Geländekacheln war das Relief WEG (vom Owner gemeldet 2026-07-28).
				//
				// Wer den Schleier kräftiger oder schwächer will, greift hier; wer die Bedeutung der
				// Graustufen ändern will, bei HEIGHT_WHITE_SCHRITT. Die zwei Fragen sind getrennt.
				const veil = Math.min(1, Math.sqrt(t) / Math.sqrt(HEIGHT_FULL_VEIL_SCHRITT / HEIGHT_WHITE_SCHRITT));
				// Im Vollton-Modus deckt jedes Feldpixel voll. Die FARBE folgt weiter der Höhe -- man soll
				// beim Einstellen die Form lesen, nicht durch sie hindurch auf die Kacheln schauen.
				const alpha = solidMode ? 255 : Math.round(255 * veil);
				// Den Rasterpunkt als STEP×STEP-Block ausfüllen, in Geräte-Pixeln.
				const px0 = Math.round(sx * dpr);
				const py0 = Math.round(sy * dpr);
				const px1 = Math.min(pixelWidth, Math.round((sx + STEP) * dpr));
				const py1 = Math.min(pixelHeight, Math.round((sy + STEP) * dpr));
				for (let py = py0; py < py1; py++) {
					let offset = (py * pixelWidth + px0) * 4;
					for (let px = px0; px < px1; px++) {
						data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = alpha;
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
		// 💣 Zwei Dinge, die beim ersten Anlauf falsch waren und beide vom Owner gemeldet wurden:
		//
		// 1. Die Meldung nannte die `public_id`. „Höhenfeld fad7a250-0918-…" sagt einem Menschen nichts
		//    -- dort gehört der Name der Region hin, so wie ihn der Tooltip und der Dialog zeigen.
		// 2. Die Wiederholungssperre hing am FELD-Objekt. Seit die Geländeregler live vorschauen, wird
		//    der Stapel bei jedem Zieh-Bild neu gebaut: neue Objekte, Sperre weg, ein Toast je Bild.
		//    Sie hängt jetzt an (Fläche + Stufe) und überlebt den Neubau.
		fields.forEach((field, index) => {
			if (!field.stoppedAtLevel) {
				return;
			}
			const areaId = stack.areaIdsByField[index];
			const schluessel = areaId + "@" + field.stoppedAtLevel;
			if (budgetReported.has(schluessel)) {
				return;
			}
			budgetReported.add(schluessel);
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(`Höhenfeld „${areaName(areaId)}": Detailstufe ${field.stoppedAtLevel} wurde `
					+ "ausgelassen, das Rechenbudget war erschöpft. Weniger Detailstufen oder eine gröbere "
					+ "Körnung bleiben im Budget.", "info");
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

	// Von aussen: den Schleier abschalten, SOLANGE der Flächendialog offen ist (Owner 2026-07-28:
	// „sie soll einfach nicht transparent sein, solange der dialog offen ist").
	//
	// 💣 KEIN ZEITGEBER. Eine frühere Fassung schaltete ihn je Reglerbewegung für 900 ms ab und liess
	// ihn danach zurückkommen -- dadurch wurde die Fläche beim Regeln immer wieder durchsichtig und
	// flackerte unter der Hand. Der Zustand gehört an das OFFENE FENSTER, nicht an die einzelne
	// Bewegung: wer den Dialog offen hat, stellt ein und will durchgehend sehen, was er einstellt.
	function setHeightCanvasSolid(on) {
		const next = Boolean(on);
		if (next === solidMode) {
			return;
		}
		solidMode = next;
		canvas.classList.toggle("avesmaps-ecosystem-height-canvas--solid", solidMode);
		// 💣 NEU ZEICHNEN, nicht nur umklassen. Die Deckkraft steckt an ZWEI Stellen: in der CSS-Opazität
		// des Canvas UND im Alpha JE PIXEL, das der Höhe folgt (0 Schritt = durchsichtig). Nur die Klasse
		// zu tauschen liess das Feld an niedrigen Stellen weiter durchscheinen -- genau die Meldung
		// „werden immer noch nicht voll deckend". Das Pixel-Alpha entsteht in der Malschleife, also muss
		// sie noch einmal laufen.
		redraw();
	}

	window.AvesmapsEcosystemHeightRender = {
		redraw,
		invalidate: invalidateEcosystemHeightField,
		setSolid: setHeightCanvasSolid,
		lastPaintMs: () => lastPaintMs,
		stack: () => heightStack,
	};
})();
