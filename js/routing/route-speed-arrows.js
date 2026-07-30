// V12: Geschwindigkeitspfeile auf der GEPLANTEN ROUTE, EDIT MODE ONLY.
//
// 🔴 WARUM NUR AUF DER ROUTE, und nicht über die ganze Karte (wie es der Hauptplan für V12 vorsah).
// Owner-Entscheid 2026-07-30: „ich will die Geschwindigkeitsänderung ja auch nur sehen, wenn ich eine
// Route im Editmode plane." Das ist die deutlich bessere Eingrenzung, aus drei Gründen:
//
//  - Eine geplante Route TRÄGT ihre Faktoren schon. Über die ganze Karte bräuchte es einen neuen
//    Leseweg für `path_terrain` — es gibt heute keinen, der Profile für beliebige Wege herausgibt.
//  - Die Wasserregel ist in der Routenantwort bereits angewandt (`avesmapsRouteAttachTerrain`). Ein
//    eigener Leser über `path_terrain` fände die noch liegenden Wasserzeilen und zeichnete Pfeile,
//    die der Router nie anwendet.
//  - Über die ganze Karte wären 97 % der Wegstücke gleichförmig (gemessen: nur 3,05 % tragen einen
//    Faktor ≠ 1). Auf der Route schaut der Editor genau dorthin, wo er gerade etwas geändert hat.
//
// 🔴 DIE PFEILLÄNGE ZEIGT DIE RELATIVE GESCHWINDIGKEIT, nicht die absolute. Ein Gebirgspass ist mit
// 1,5 Meilen/h immer langsamer als eine Reichsstraße mit 4,5 — das steht in der Tempotabelle und ist
// nicht die Frage. Die Frage ist „bremst MEIN Gebirge diese Etappe?", also der Faktor, den Gelände und
// Strömung auf die Grundgeschwindigkeit der Wegart legen. Kurzer, rotbrauner Pfeil = ja.
//
// Aufbau abgeschrieben von map-features-river-flow-arrows.js: eine Canvas-Pane, feste Pfeildichte in
// BILDSCHIRMpixeln (damit ergibt sich die Dichte je Zoomstufe von selbst), `map` entsteht in
// bootstrap.js ZULETZT — also pollen, bis es da ist.
(function initRouteSpeedArrowOverlay() {
	"use strict";

	const PANE_NAME = "avesmapsRouteSpeedArrowPane";
	// Dicht genug, dass eine kurze Etappe mindestens einen Pfeil bekommt; der Prototyp
	// (html/landschaften-modell.html:705) nahm 34.
	const ARROW_SPACING_PX = 34;
	// Unter diesem Verhältnis gilt eine Etappe als gebremst bzw. beschleunigt. 2 % Totband, damit
	// Rundungsreste nicht die halbe Route einfärben.
	const NEUTRAL_BAND = 0.02;

	function ready() {
		// typeof map.createPane: bis bootstrap.js die Leaflet-Karte zuweist, löst der globale Name
		// `map` auf das #map-DOM-Element auf — wahr, aber ohne Leaflet-API.
		return typeof map !== "undefined" && map && typeof map.createPane === "function"
			&& typeof L !== "undefined" && typeof IS_EDIT_MODE !== "undefined";
	}

	function start() {
		if (!ready()) {
			window.setTimeout(start, 100);
			return;
		}
		if (!IS_EDIT_MODE) {
			return;
		}

		if (!map.getPane(PANE_NAME)) {
			map.createPane(PANE_NAME);
			const pane = map.getPane(PANE_NAME);
			// Über der Routenlinie (routePane 450), unter der Messung (measurementPane 460): die Pfeile
			// gehören sichtbar zur Route, dürfen aber nichts überdecken, was darüber liegt.
			pane.style.zIndex = 455;
			pane.style.pointerEvents = "none";
		}
		const canvas = document.createElement("canvas");
		canvas.style.position = "absolute";
		canvas.style.top = "0";
		canvas.style.left = "0";
		canvas.style.pointerEvents = "none";
		canvas.style.transformOrigin = "0 0";
		canvas.classList.add("leaflet-zoom-animated");
		map.getPane(PANE_NAME).appendChild(canvas);
		const ctx = canvas.getContext("2d");
		let canvasTopLeftLatLng = null;

		function toggledOn() {
			const toggle = document.querySelector("#showRouteSpeed");
			return Boolean(toggle && toggle.checked);
		}

		// 💣 Die Farben kommen JEDES MAL frisch aus den Tokens, nie gecached: die Karte hat einen
		// Hell/Dunkel-Umschalter, und ein gecachter Wert überlebt ihn und zeigt danach die Farbe des
		// anderen Themes. Ein Neuzeichnen kostet ohnehin nur diese drei Abfragen.
		function tokens() {
			const style = window.getComputedStyle(document.documentElement);
			const read = (name, fallback) => {
				const value = style.getPropertyValue(name).trim();
				return value === "" ? fallback : value;
			};
			return {
				slower: read("--color-danger", "#9d3a2e"),
				faster: read("--color-success", "#2f7d3a"),
				neutral: read("--color-text-muted", "#6b6153"),
				halo: read("--color-panel", "#fffaf0"),
			};
		}

		// Der Faktor, den Gelände UND Strömung auf die Grundgeschwindigkeit legen. Beides multipliziert
		// die Zeit, also teilt beides die Geschwindigkeit.
		function slowdownFactor(properties) {
			const terrain = Number(properties?.terrain_time_factor);
			const flow = Number(properties?.flow_time_factor);
			const t = Number.isFinite(terrain) && terrain > 0 ? terrain : 1;
			const f = Number.isFinite(flow) && flow > 0 ? flow : 1;
			return t * f;
		}

		// 1,0 = wie die Wegart es vorsieht. Kleiner = langsamer.
		function relativeSpeed(properties) {
			return 1 / slowdownFactor(properties);
		}

		function arrowLength(relative) {
			// Bei 1,0 sind es 21 px. Geklemmt, damit ein Faktor 4,0 keinen unsichtbaren Punkt und ein
			// Faktor 0,81 keinen Balken ergibt.
			const clamped = Math.max(0.3, Math.min(1.45, relative));
			return 7 + 14 * clamped;
		}

		function arrowColor(relative, palette) {
			if (relative < 1 - NEUTRAL_BAND) { return palette.slower; }
			if (relative > 1 + NEUTRAL_BAND) { return palette.faster; }
			return palette.neutral;
		}

		function drawArrow(x, y, angle, length, color, palette, viewWidth, viewHeight) {
			if (x < -30 || y < -30 || x > viewWidth + 30 || y > viewHeight + 30) {
				return;
			}
			const half = Math.max(2.6, length * 0.24);
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(angle);
			ctx.beginPath();
			ctx.moveTo(length * 0.5, 0);
			ctx.lineTo(-length * 0.5, -half);
			ctx.lineTo(-length * 0.5, half);
			ctx.closePath();
			ctx.fillStyle = color;
			// Heller Saum wie bei den Flusspfeilen, damit der Pfeil auf der Routenlinie lesbar bleibt
			// statt in ihr zu verschwinden.
			ctx.strokeStyle = palette.halo;
			ctx.lineWidth = 1.4;
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}

		// Die Pfeile müssen auf DERSELBEN Anzeige-Kurve sitzen wie die gezeichnete Route
		// (smoothLineCoordinatesForDisplay -> Catmull-Rom). Über die rohen Ecken gelaufen liegen sie in
		// Kurven sichtbar neben der Linie. Zwischenspeicher je Segmentobjekt.
		const smoothedCache = new WeakMap();
		function displayCoordinatesFor(segment, rawCoordinates) {
			if (typeof smoothLineCoordinatesForDisplay !== "function" || typeof VISUAL_LINE_CATMULL_ROM_CONFIG === "undefined") {
				return rawCoordinates;
			}
			const cached = smoothedCache.get(segment);
			if (cached && cached.source === rawCoordinates) {
				return cached.smoothed;
			}
			const smoothed = smoothLineCoordinatesForDisplay(rawCoordinates, VISUAL_LINE_CATMULL_ROM_CONFIG);
			smoothedCache.set(segment, { source: rawCoordinates, smoothed });
			return smoothed;
		}

		function routeSegments() {
			// currentRouteSegmentLayers ist die Liste, die drawRoute() gerade auf die Karte gelegt hat —
			// dieselben Objekte, dieselbe Reihenfolge. Damit zeigen die Pfeile nie eine andere Route als
			// die sichtbare.
			if (typeof currentRouteSegmentLayers === "undefined" || !Array.isArray(currentRouteSegmentLayers)) {
				return [];
			}
			return currentRouteSegmentLayers.filter((entry) => entry && entry.segment);
		}

		function redraw() {
			const size = map.getSize();
			const topLeft = map.containerPointToLayerPoint([0, 0]);
			L.DomUtil.setPosition(canvas, topLeft);
			canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);
			const dpr = window.devicePixelRatio || 1;
			const pixelWidth = Math.round(size.x * dpr);
			const pixelHeight = Math.round(size.y * dpr);
			if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
			if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
			if (canvas.style.width !== size.x + "px") canvas.style.width = size.x + "px";
			if (canvas.style.height !== size.y + "px") canvas.style.height = size.y + "px";
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			if (!toggledOn()) {
				return;
			}
			const entries = routeSegments();
			if (entries.length === 0) {
				return;
			}
			const palette = tokens();

			entries.forEach(({ segment }) => {
				const rawCoordinates = segment.geometry?.coordinates;
				if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
					return;
				}
				const relative = relativeSpeed(segment.properties);
				const length = arrowLength(relative);
				const color = arrowColor(relative, palette);
				const coordinates = displayCoordinatesFor(segment, rawCoordinates);

				let carried = 0;
				let previousPoint = map.latLngToContainerPoint(L.latLng(coordinates[0][1], coordinates[0][0]));
				let drawn = 0;
				for (let i = 1; i < coordinates.length; i++) {
					const point = map.latLngToContainerPoint(L.latLng(coordinates[i][1], coordinates[i][0]));
					const dx = point.x - previousPoint.x;
					const dy = point.y - previousPoint.y;
					const span = Math.hypot(dx, dy);
					if (span > 0) {
						const angle = Math.atan2(dy, dx);
						let offset = ARROW_SPACING_PX - carried;
						while (offset <= span) {
							const t = offset / span;
							drawArrow(previousPoint.x + dx * t, previousPoint.y + dy * t, angle, length, color, palette, size.x, size.y);
							drawn++;
							offset += ARROW_SPACING_PX;
						}
						carried = (carried + span) % ARROW_SPACING_PX;
					}
					previousPoint = point;
				}
				// ⚠️ Eine Etappe, die auf dem Bildschirm kürzer ist als der Pfeilabstand, bekäme sonst
				// KEINEN Pfeil — und das sind auf einer Bergstrecke genau die interessanten: kurz, steil,
				// stark gebremst. Also mindestens einen, in ihrer Mitte.
				if (drawn === 0) {
					const first = map.latLngToContainerPoint(L.latLng(coordinates[0][1], coordinates[0][0]));
					const last = map.latLngToContainerPoint(L.latLng(coordinates[coordinates.length - 1][1], coordinates[coordinates.length - 1][0]));
					const dx = last.x - first.x;
					const dy = last.y - first.y;
					if (Math.hypot(dx, dy) > 1) {
						drawArrow((first.x + last.x) / 2, (first.y + last.y) / 2, Math.atan2(dy, dx), length, color, palette, size.x, size.y);
					}
				}
			});
		}

		map.on("moveend zoomend viewreset resize", () => {
			canvas.style.transition = "";
			redraw();
		});
		map.on("zoomanim", (event) => {
			if (!canvasTopLeftLatLng || typeof map._latLngToNewLayerPoint !== "function") {
				return;
			}
			canvas.style.transition = "transform 250ms cubic-bezier(0,0,0.25,1)";
			const scale = map.getZoomScale(event.zoom);
			const offset = map._latLngToNewLayerPoint(canvasTopLeftLatLng, event.zoom, event.center);
			L.DomUtil.setTransform(canvas, offset, scale);
		});

		document.querySelector("#showRouteSpeed")?.addEventListener("change", () => {
			window.setTimeout(redraw, 0);
		});
		// Der Theme-Umschalter färbt die Pfeile mit: sie holen ihre Farben bei jedem Neuzeichnen frisch.
		document.querySelector(".theme-toggle-btn")?.addEventListener("click", () => {
			window.setTimeout(redraw, 0);
		});

		// drawRoute() ruft das nach jedem Zeichnen auf — auch beim Löschen, dann malt es nichts.
		window.avesmapsRedrawRouteSpeedArrows = redraw;
		[200, 800, 2000].forEach((delay) => window.setTimeout(redraw, delay));
	}

	start();
})();
