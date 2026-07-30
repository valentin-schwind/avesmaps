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
	// ⚠️ Der Abstand muss GRÖSSER sein als der längste Pfeil (ARROW_UNIT_PX · 1,3 = 34), sonst laufen
	// zwei Pfeile ineinander und die Länge ist wieder nicht ablesbar. Der Prototyp nahm 34 bei
	// kürzeren Pfeilen.
	const ARROW_SPACING_PX = 44;
	// Länge bei unverändertem Tempo (relative Geschwindigkeit 1,0). Alles andere ist ein Vielfaches
	// davon — siehe arrowLength().
	const ARROW_UNIT_PX = 26;
	// 🔴 FEST, nicht mitwachsend. Eine Spitze, die mit der Länge skaliert, frisst den Unterschied auf.
	const ARROW_HEAD_PX = 5;
	const ARROW_HEAD_HALF_PX = 3.7;
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

		// 🔴 DIE LÄNGE IST PROPORTIONAL ZUR RELATIVEN GESCHWINDIGKEIT, ohne Sockel. „Halb so schnell"
		// heißt „halb so lang", sonst ist die Länge nicht ablesbar, sondern nur vorhanden.
		//
		// 💣 Die erste Fassung hatte `7 + 14 · rel` und war GENAU DARAN unlesbar (Owner, 2026-07-30:
		// „die jetzigen Dinger kann ich gar nicht interpretieren"). Zwei Fehler auf einmal: der Sockel
		// von 7 px drückte die Spannweite über den echten Bestand auf 13…23 px zusammen, also weniger
		// als Faktor 2 — und gezeichnet wurde ein GEFÜLLTES DREIECK, dessen Breite mit der Länge
		// mitwuchs. Ein Dreieck, das in beide Richtungen skaliert, liest sich als „derselbe Pfeil, etwas
		// größer", nicht als Länge. Deshalb jetzt Schaft + feste Spitze, wie im Prototyp
		// (html/landschaften-modell.html:707: eine `line` mit `marker-end`).
		function arrowLength(relative) {
			// Geklemmt nach unten, damit ein Faktor 4,0 kein unsichtbarer Punkt wird, und nach oben,
			// damit ein Pfeil nie in seinen Nachbarn läuft (ARROW_SPACING_PX).
			const clamped = Math.max(0.26, Math.min(1.3, relative));
			return clamped * ARROW_UNIT_PX;
		}

		function arrowColor(relative, palette) {
			if (relative < 1 - NEUTRAL_BAND) { return palette.slower; }
			if (relative > 1 + NEUTRAL_BAND) { return palette.faster; }
			return palette.neutral;
		}

		// Schaft + feste Spitze. 🔴 DIE SPITZE WÄCHST NICHT MIT: nur so trägt der Schaft die Aussage.
		// Über den echten Bestand ergibt das Pfeile von ~7 px (steilster Pass der Karte, Faktor 3,48)
		// über 26 px (unverändertes Tempo) bis ~32 px (schnellste Abfahrt) — bei fester Spitze bleibt
		// vom kürzesten fast nur sie übrig, und genau das ist die Aussage.
		function drawArrow(x, y, angle, length, color, palette, viewWidth, viewHeight) {
			if (x < -40 || y < -40 || x > viewWidth + 40 || y > viewHeight + 40) {
				return;
			}
			const tip = length * 0.5;
			const tail = -tip;
			const shaftEnd = tip - ARROW_HEAD_PX;
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(angle);

			// Heller Saum ZUERST und über beides, damit der Pfeil auf der 7 px breiten Routenlinie
			// lesbar bleibt statt in ihr zu verschwinden.
			//
			// 💣 `butt`, NICHT `round`, und schmal: ein runder Saum von 5,4 px ragt an beiden Enden ~2,7 px
			// über den Pfeil hinaus und hängt damit JEDEM Pfeil denselben Sockel an — gemessen drückte das
			// das sichtbare Längenverhältnis von 4,5× auf 2,8×. Das ist genau der Fehler, den die feste
			// Spitze oben vermeidet, nur eine Ebene tiefer.
			ctx.lineCap = "butt";
			ctx.lineJoin = "miter";
			ctx.miterLimit = 2;
			ctx.strokeStyle = palette.halo;
			ctx.lineWidth = 3.6;
			ctx.beginPath();
			ctx.moveTo(tail, 0);
			ctx.lineTo(Math.max(tail, shaftEnd), 0);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(tip, 0);
			ctx.lineTo(shaftEnd, -ARROW_HEAD_HALF_PX);
			ctx.lineTo(shaftEnd, ARROW_HEAD_HALF_PX);
			ctx.closePath();
			ctx.stroke();

			// Und derselbe Pfeil in der Farbe darüber.
			ctx.strokeStyle = color;
			ctx.fillStyle = color;
			ctx.lineWidth = 2.6;
			if (shaftEnd > tail) {
				ctx.beginPath();
				ctx.moveTo(tail, 0);
				ctx.lineTo(shaftEnd, 0);
				ctx.stroke();
			}
			ctx.beginPath();
			ctx.moveTo(tip, 0);
			ctx.lineTo(shaftEnd, -ARROW_HEAD_HALF_PX);
			ctx.lineTo(shaftEnd, ARROW_HEAD_HALF_PX);
			ctx.closePath();
			ctx.fill();
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

		// 🔴 DIE ETAPPENGEOMETRIE LIEGT IN DER GESPEICHERTEN ECKENFOLGE DES WEGES, NICHT IN FAHRTRICHTUNG.
		// Läuft die Route einen Weg rückwärts, tauscht der Server Anstieg und Gefälle
		// (`avesmapsRouteReverseTerrain`), dreht die Geometrie aber NICHT — für eine gezeichnete Linie ist
		// die Richtung gleichgültig. Für einen PFEIL ist sie alles.
		//
		// 💣 Genau daran zeigte die erste Fassung ein Viertel der Route verkehrt (Owner, 2026-07-30:
		// „warum sind die umgedreht?"). Auf Gareth → Thorwal sind **11 von 45** Etappen rückwärts
		// gespeichert, darunter die ganze Koschberge-Querung. Der Faktor war dabei richtig — nur der Pfeil
		// zeigte bergab, wo es bergauf ging.
		//
		// Die Richtung steht in KEINEM Feld des Client-Segments: `buildServerRouteSegment` übernimmt die
		// Server-Geometrie unverändert und führt from/to nicht mit. Sie folgt aber aus der VERKETTUNG —
		// drawRoute() bekommt die Etappen in Reisefolge, also muss jede dort anfangen, wo die vorige
		// endete. Das ist selbsttragend und braucht keine zusätzlichen Daten.
		//
		// ⭐ Gegen den Livebestand geprüft: die Verkettung findet genau die Etappen 13–17, dieselben fünf,
		// die beim Offline-Vergleich getauschte Anstiegswerte hatten.
		function orientToTravelDirection(list) {
			if (list.length < 2) {
				// Eine einzige Etappe hat keinen Nachbarn, an dem sie sich ausrichten könnte. Speicher-
				// reihenfolge ist dann die einzige Auskunft — und ohne Nachbar fällt keine Unstimmigkeit auf.
				return;
			}
			const squaredDistance = (a, b) => {
				const dx = a[0] - b[0];
				const dy = a[1] - b[1];
				return dx * dx + dy * dy;
			};
			const ends = (coordinates) => [coordinates[0], coordinates[coordinates.length - 1]];

			// Die erste Etappe hat keine vorige: sie richtet sich daran aus, welches ihrer Enden dem
			// Anschluss der ZWEITEN näher liegt.
			const [secondStart, secondEnd] = ends(list[1].stored);
			const nearestToSecond = (point) => Math.min(squaredDistance(point, secondStart), squaredDistance(point, secondEnd));
			const [firstStart, firstEnd] = ends(list[0].stored);
			list[0].reversed = nearestToSecond(firstStart) < nearestToSecond(firstEnd);
			let cursor = list[0].reversed ? firstStart : firstEnd;

			for (let index = 1; index < list.length; index++) {
				const [start, end] = ends(list[index].stored);
				if (squaredDistance(end, cursor) < squaredDistance(start, cursor)) {
					list[index].reversed = true;
					cursor = start;
				} else {
					list[index].reversed = false;
					cursor = end;
				}
			}
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

			const drawables = [];
			entries.forEach(({ segment }) => {
				const rawCoordinates = segment.geometry?.coordinates;
				if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
					return;
				}
				drawables.push({ segment, stored: displayCoordinatesFor(segment, rawCoordinates), reversed: false });
			});
			orientToTravelDirection(drawables);

			drawables.forEach(({ segment, stored, reversed }) => {
				const relative = relativeSpeed(segment.properties);
				const length = arrowLength(relative);
				const color = arrowColor(relative, palette);
				// 🔴 IN FAHRTRICHTUNG, nicht in Speicherreihenfolge — siehe orientToTravelDirection.
				const coordinates = reversed ? [...stored].reverse() : stored;

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
