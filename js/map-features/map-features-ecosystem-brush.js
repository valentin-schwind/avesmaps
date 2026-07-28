// Landschaften -- Pinsel und Radiergummi auf einer bestehenden Fläche (Owner 2026-07-28).
//
// 🔴 WARUM ES DAS GIBT. Ecke für Ecke zu zeichnen ist für einen sauberen Umriss richtig, aber für die
// häufigste Arbeit falsch: „der Wald geht hier noch zwanzig Meilen weiter" ist keine Ecken-Frage. Der
// Pinsel malt Fläche dazu, der Radiergummi nimmt weg -- beides auf der AUSGEWÄHLTEN Fläche, und beides
// erzeugt NIE eine neue. Es ist dieselbe boolesche Rechnung wie im Kontextmenü, nur mit einem Kreis als
// zweitem Operanden statt einer zweiten Fläche.
//
// 💣 EIN Schreibvorgang je Strich, nicht je Mausbewegung. Der Strich wird vollständig im Client
// gerechnet (polygon-clipping, dieselbe Bibliothek wie die Menü-Operationen) und erst beim Loslassen
// gespeichert -- sonst wären es fünfzig `update_area_geometry` in zwei Sekunden, jedes mit eigener
// Revision, und das zweite bekäme eine 409 vom ersten.
//
// 💣 Maus-Ereignisse am CONTAINER, nicht an der Karte. Die Flächen-Layer schlucken Klicks
// (stopPropagation, damit im Landschaftsmodus immer nur eine Ebene antwortet) -- ein `map.on("mousedown")`
// erreichte den Pinsel also nicht, sobald der Zeiger über der Fläche steht, was beim Malen der
// Normalfall ist. Am Container in der Capture-Phase sieht er alles, bevor irgendein Layer davon weiss.
//
// 🪤 Kartenziehen wird ausgeschaltet, solange gemalt wird: sonst schiebt der erste Strich die Karte
// unter dem Pinsel weg, statt zu malen.

(() => {
	// Der Radius lebt in BILDSCHIRM-Pixeln, nicht in Kartenkoordinaten: ein Pinsel soll sich beim Zoomen
	// gleich anfühlen, und die Feinheit des Kreises richtet sich danach, wie gross er GEZEICHNET ist.
	const BRUSH_MIN_RADIUS_PX = 6;
	const BRUSH_MAX_RADIUS_PX = 400;
	const BRUSH_DEFAULT_RADIUS_PX = 40;
	// Strg+Rad ändert den Durchmesser in Schritten -- multiplikativ, nicht additiv: von 8 auf 12 ist
	// gefühlt derselbe Sprung wie von 200 auf 300, additiv wäre das eine unmerklich und das andere brutal.
	const BRUSH_RADIUS_STEP = 1.18;
	// Erst weitermalen, wenn der Zeiger ein Stück gewandert ist. Ohne das rechnet jede Mausbewegung eine
	// Vereinigung, obwohl der neue Kreis fast deckungsgleich im alten liegt.
	const BRUSH_MIN_TRAVEL_RATIO = 0.28;

	let brushMode = "";                       // "" | "brush" | "eraser"
	let brushAreaPublicId = "";
	let brushRadiusPx = BRUSH_DEFAULT_RADIUS_PX;
	let brushWorkingGeometry = null;          // der Stand des laufenden Strichs, noch ungespeichert
	let brushStrokeActive = false;
	let brushLastStampPoint = null;
	let brushDirty = false;
	let brushSaving = false;
	let brushCursorLayer = null;
	let brushResultLayer = null;
	let brushBound = false;

	function say(message, tone = "info") {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(message, tone);
		}
	}

	function areaByPublicId(publicId) {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(String(publicId || ""))
			: null;

		return layer?._ecosystemArea || null;
	}

	function areaGeometry(area) {
		return area?.geometry_geojson || area?.geometry || null;
	}

	// 🔴 Wenige Ecken bei kleinem, viele bei grossem Pinsel (Owner 2026-07-28). Nicht aus Sparsamkeit:
	// ein 8-Eck mit 10 px Radius ist von einem Kreis nicht zu unterscheiden, ein 8-Eck mit 300 px ist
	// sichtbar ein Achteck. Umgekehrt wären 48 Ecken je Stempel bei einem kleinen Pinsel tausende
	// Stützpunkte in einer Fläche, die niemand braucht -- und jede davon reist für immer mit.
	//
	// Bindeglied ist die Kantenlänge: rund 12 px je Segment, gedeckelt auf 8..48.
	function brushVertexCount(radiusPx) {
		const bySegment = Math.round((2 * Math.PI * Math.max(1, radiusPx)) / 12);

		return Math.max(8, Math.min(48, bySegment));
	}

	// Der Stempel als GeoJSON-Polygon in KARTENkoordinaten. Gerechnet wird über Layer-Punkte, damit der
	// Kreis auf dem Bildschirm rund ist -- und GeoJSON speichert [x, y], Leaflet liefert [lat, lng] =
	// [y, x] (AGENTS.md §5), die Drehung passiert hier bewusst.
	function brushStampGeometry(latlng, radiusPx) {
		const center = map.latLngToLayerPoint(latlng);
		const count = brushVertexCount(radiusPx);
		const ring = [];
		for (let index = 0; index < count; index += 1) {
			const angle = (index / count) * 2 * Math.PI;
			const point = L.point(
				center.x + Math.cos(angle) * radiusPx,
				center.y + Math.sin(angle) * radiusPx
			);
			const corner = map.layerPointToLatLng(point);
			ring.push([corner.lng, corner.lat]);
		}
		ring.push(ring[0].slice());

		return { type: "Polygon", coordinates: [ring] };
	}

	// ---- Vorschau -------------------------------------------------------------------------------------

	function clearBrushPreview() {
		[brushCursorLayer, brushResultLayer].forEach((layer) => {
			if (layer && map.hasLayer(layer)) {
				map.removeLayer(layer);
			}
		});
		brushCursorLayer = null;
		brushResultLayer = null;
	}

	function brushColor() {
		const token = brushMode === "eraser" ? "--color-danger" : "--color-marker-active";

		return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
	}

	function geometryToLatLngs(geometry) {
		const polygons = geometry?.type === "MultiPolygon" ? geometry.coordinates : [geometry?.coordinates || []];

		return polygons.map((polygon) => (polygon || []).map((ring) => (ring || []).map(([x, y]) => [y, x])));
	}

	// Der laufende Strich wird MITGEZEICHNET. Ohne das malt man blind und sieht das Ergebnis erst nach dem
	// Speichern -- und ein Pinsel, dessen Wirkung man erst hinterher sieht, ist kein Pinsel.
	function updateBrushPreview(latlng) {
		clearBrushPreview();
		const color = brushColor();
		if (brushWorkingGeometry) {
			brushResultLayer = L.polygon(geometryToLatLngs(brushWorkingGeometry), {
				pane: "measurementPane",
				color,
				weight: 2,
				opacity: 0.9,
				fillOpacity: 0.25,
				interactive: false,
			}).addTo(map);
		}
		if (latlng) {
			brushCursorLayer = L.polygon(geometryToLatLngs(brushStampGeometry(latlng, brushRadiusPx)), {
				pane: "measurementHandlesPane",
				color,
				weight: 2,
				opacity: 0.95,
				dashArray: brushMode === "eraser" ? "5 5" : null,
				fillOpacity: 0.12,
				interactive: false,
			}).addTo(map);
		}
	}

	// ---- Malen ----------------------------------------------------------------------------------------

	function stampAt(latlng) {
		const stamp = brushStampGeometry(latlng, brushRadiusPx);
		const operation = brushMode === "eraser" ? "difference" : "union";
		try {
			brushWorkingGeometry = ecosystemBooleanGeometry(operation, brushWorkingGeometry, stamp);
			brushDirty = true;
		} catch (error) {
			// 🪤 Der Radiergummi läuft absichtlich in den Plausibilitätsriegel, wenn er die letzte Fläche
			// wegnehmen würde ("Die Operation ergibt keine Fläche"). Das ist kein Fehlschlag des Strichs,
			// sondern seine Grenze: der bisherige Stand bleibt stehen, gesagt wird es einmal.
			if (brushStrokeActive) {
				brushStrokeActive = false;
				say(brushMode === "eraser"
					? "Weiter geht es nicht — eine Fläche ganz wegzuradieren geht nur über „Fläche löschen“."
					: (error?.message || "Der Strich konnte nicht gerechnet werden."), "warning");
			}
		}
	}

	async function finishStroke() {
		brushStrokeActive = false;
		brushLastStampPoint = null;
		if (!brushDirty || brushSaving) {
			return;
		}
		const area = areaByPublicId(brushAreaPublicId);
		if (!area || !brushWorkingGeometry) {
			return;
		}

		brushSaving = true;
		try {
			await postEcosystemEdit("update_area_geometry", {
				public_id: String(area.public_id),
				expected_revision: Number(area.geometry_revision),
				geometry_geojson: brushWorkingGeometry,
			});
			brushDirty = false;
			if (typeof loadEcosystemAreas === "function") {
				await loadEcosystemAreas();
			}
			if (typeof invalidateEcosystemRegionCache === "function") {
				invalidateEcosystemRegionCache();
			}
			// Nach dem Neuladen ist die Flächenzeile eine andere -- der Strich muss auf dem FRISCHEN Stand
			// weitergehen, sonst rechnet der nächste gegen eine Revision, die es nicht mehr gibt.
			const frisch = areaByPublicId(brushAreaPublicId);
			brushWorkingGeometry = areaGeometry(frisch) || brushWorkingGeometry;
		} catch (error) {
			say(error?.message || "Der Strich konnte nicht gespeichert werden.", "warning");
			// Verworfen wird NICHTS: der Editor sieht seinen Stand weiter und kann es erneut versuchen.
		} finally {
			brushSaving = false;
			updateBrushPreview(null);
		}
	}

	// ---- Ereignisse -----------------------------------------------------------------------------------

	function handleBrushMouseDown(event) {
		if (!brushMode || event.button !== 0) {
			return;
		}
		L.DomEvent.stop(event);
		brushStrokeActive = true;
		brushLastStampPoint = null;
		const latlng = map.mouseEventToLatLng(event);
		stampAt(latlng);
		brushLastStampPoint = map.latLngToLayerPoint(latlng);
		updateBrushPreview(latlng);
	}

	function handleBrushMouseMove(event) {
		if (!brushMode) {
			return;
		}
		const latlng = map.mouseEventToLatLng(event);
		if (brushStrokeActive) {
			const point = map.latLngToLayerPoint(latlng);
			const travel = brushLastStampPoint ? point.distanceTo(brushLastStampPoint) : Infinity;
			if (travel >= brushRadiusPx * BRUSH_MIN_TRAVEL_RATIO) {
				stampAt(latlng);
				brushLastStampPoint = point;
			}
		}
		updateBrushPreview(latlng);
	}

	function handleBrushMouseUp(event) {
		if (!brushMode || !brushStrokeActive) {
			return;
		}
		L.DomEvent.stop(event);
		void finishStroke();
	}

	// Strg+Rad ändert den Durchmesser. 💣 Das Ereignis MUSS gestoppt werden, sonst zoomt die Karte
	// gleichzeitig -- und ein Pinsel, der beim Grösserstellen die Karte wegzieht, ist unbenutzbar.
	function handleBrushWheel(event) {
		if (!brushMode || !event.ctrlKey) {
			return;
		}
		L.DomEvent.stop(event);
		event.preventDefault();
		const richtung = event.deltaY < 0 ? BRUSH_RADIUS_STEP : 1 / BRUSH_RADIUS_STEP;
		brushRadiusPx = Math.max(BRUSH_MIN_RADIUS_PX, Math.min(BRUSH_MAX_RADIUS_PX, brushRadiusPx * richtung));
		updateBrushPreview(map.mouseEventToLatLng(event));
	}

	function handleBrushKeydown(event) {
		if (brushMode && event.key === "Escape") {
			event.stopPropagation();
			stopBrush("Pinsel beendet.");
		}
	}

	function bindBrushEvents() {
		if (brushBound || typeof map === "undefined" || !map) {
			return;
		}
		const container = map.getContainer();
		// Capture: die Flächen-Layer schlucken sonst genau die Ereignisse, die der Pinsel braucht.
		container.addEventListener("mousedown", handleBrushMouseDown, true);
		container.addEventListener("mousemove", handleBrushMouseMove, true);
		container.addEventListener("mouseup", handleBrushMouseUp, true);
		container.addEventListener("wheel", handleBrushWheel, { capture: true, passive: false });
		document.addEventListener("keydown", handleBrushKeydown, true);
		brushBound = true;
	}

	// ---- Ein und aus ----------------------------------------------------------------------------------

	function startBrush(mode, publicId) {
		const area = areaByPublicId(publicId);
		const geometry = areaGeometry(area);
		if (!area || !geometry) {
			say("Die Fläche ist nicht mehr geladen.", "warning");
			return;
		}
		if (typeof closeEcosystemGeometryEdit === "function") {
			// Griffe und Pinsel nie gleichzeitig: ein Griff läge zwischen Zeiger und Fläche.
			closeEcosystemGeometryEdit({ flush: true });
		}

		brushMode = mode;
		brushAreaPublicId = String(publicId || "");
		brushWorkingGeometry = geometry;
		brushDirty = false;
		bindBrushEvents();
		map.dragging.disable();
		map.getContainer().classList.add("ecosystem-brush-cursor");
		updateBrushPreview(null);
		say(mode === "eraser"
			? "Radiergummi: ziehen nimmt weg. Strg+Mausrad ändert die Größe, ESC beendet."
			: "Pinsel: ziehen malt Fläche dazu. Strg+Mausrad ändert die Größe, ESC beendet.", "info");
	}

	function stopBrush(message) {
		if (!brushMode) {
			return;
		}
		// Ein noch nicht gespeicherter Strich geht NICHT verloren -- dieselbe Regel wie beim Ecken-Editor:
		// wer die Maus losgelassen hat, hat gespeichert; wer mitten im Strich abbricht, auch.
		if (brushDirty) {
			void finishStroke();
		}
		brushMode = "";
		brushAreaPublicId = "";
		brushStrokeActive = false;
		brushLastStampPoint = null;
		clearBrushPreview();
		if (typeof map !== "undefined" && map) {
			map.dragging.enable();
			map.getContainer().classList.remove("ecosystem-brush-cursor");
		}
		if (message) {
			say(message, "info");
		}
	}

	function registerBrushEntries() {
		const menu = window.AvesmapsEcosystemAreaMenu;
		if (!menu?.addEntry) {
			return;
		}
		menu.addEntry({
			action: "brush",
			label: typeof tr === "function" ? tr("ecosystem.ctxmenu.brush", "Fläche malen") : "Fläche malen",
			onClick: (publicId) => startBrush("brush", publicId),
		});
		menu.addEntry({
			action: "eraser",
			label: typeof tr === "function" ? tr("ecosystem.ctxmenu.eraser", "Fläche radieren") : "Fläche radieren",
			onClick: (publicId) => startBrush("eraser", publicId),
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", registerBrushEntries);
	} else {
		registerBrushEntries();
	}

	window.AvesmapsEcosystemBrush = {
		start: startBrush,
		stop: stopBrush,
		isActive: () => brushMode !== "",
		radius: () => brushRadiusPx,
		vertexCount: brushVertexCount,
		stampGeometry: brushStampGeometry,
	};
})();
