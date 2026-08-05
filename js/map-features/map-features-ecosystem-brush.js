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
// unter dem Pinsel weg, statt zu malen. Holding SPACE hands dragging back for as long as the key is
// down -- see `brushPanHold` below.

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
	//
	// 🔴 Von 0,28 auf 0,55 erhöht (Owner 2026-07-28): nicht die Ecken JE Stempel waren zu viel, sondern
	// die ZAHL der Stempel -- und jeder hinterlässt seinen Aussenbogen für immer im Umriss. Ein halber
	// Radius Abstand überlappt immer noch kräftig, die Kette bleibt also glatt ohne Perlenschnur-Effekt;
	// die Punktmenge eines Strichs halbiert sich dabei. Wo es trotzdem zu fein wird, dünnt
	// „Fläche vereinfachen" nachträglich aus (map-features-ecosystem-simplify.js).
	const BRUSH_MIN_TRAVEL_RATIO = 0.55;

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
	// 🔴 Held SPACE is the hand instead of the brush (Owner 2026-08-05). Painting owns the left
	// button, so a running brush cannot drag the map -- and the wheel alone does not get you across an
	// area wider than the screen. Holding space parks the tool: dragging comes back, the preview goes
	// away, and releasing hands the brush back unchanged (same area, same size, same undo stack).
	//
	// 💣 It never takes over MID-STROKE. The key arrives while the button is still down often
	// enough -- one hand paints, the other reaches over -- and a stroke torn in half would be saved as
	// whatever happened to be painted at that moment. While `brushStrokeActive`, space does nothing.
	let brushPanHold = false;
	// 🔴 Strg+Z nimmt Strich für Strich zurück (Owner 2026-07-28). Der Stapel hält den Stand VOR jedem
	// Strich; er überlebt das Beenden des Pinsels, damit „alles seit dem Benutzen" auch dann noch
	// zurückgeht, wenn man zwischendurch aus dem Werkzeug raus ist. Geleert wird er erst, wenn der
	// Pinsel auf einer ANDEREN Fläche anfängt -- ein Rückgängig darf nie auf einer Fläche landen, die
	// der Editor gar nicht im Sinn hatte.
	//
	// 💣 Das ist bewusst NICHT die Audit-Historie. Die Regel des Owners (2026-07-26) lautet: das
	// Änderungs-Log wird ausschliesslich per „Rückgängig" am benannten Eintrag zurückgenommen, NIE per
	// Tastenkürzel -- ein Strg+Z, das in die Historie greift, nahm damals zwei Änderungen eines anderen
	// Editors zurück. Dieser Stapel kennt nur die eigenen Striche dieser Sitzung auf DIESER Fläche.
	const BRUSH_UNDO_LIMIT = 40;
	let brushUndoStack = [];
	let brushUndoAreaPublicId = "";
	let brushUndoRevision = null;   // die Revision, die der letzte eigene Schreibvorgang hinterliess

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

	// 🔴 Mehr Ecken bei grossem Pinsel, aber DEUTLICH unterlinear (Owner 2026-07-28, zweite Fassung).
	// Erste Fassung hielt die Kantenlänge konstant (~12 px je Segment) und kam damit auf 48 Ecken bei
	// grossem Radius. Das war zu fein: die Stempel eines Strichs werden vereinigt, und was aussen liegt,
	// bleibt als Stützpunkt in der Fläche -- für immer, in jeder Nutzlast, bei jedem Zeichnen. Ein
	// perfekter Kreis ist ausdrücklich nicht das Ziel; eine Landschaftsgrenze ist keine Kreislinie.
	//
	// Jetzt wächst die Zahl mit der vierten Wurzel-Nähe (Exponent 0,4): 10 px → 6, 40 px → 10,
	// 80 px → 14, ab ~250 px → 20 als Deckel. Ein grosser Stempel ist damit ein grobes Vieleck, und
	// genau das genügt, weil die Kante ohnehin unter dem nächsten Stempel verschwindet.
	// 🔴 Dritte Fassung (Owner 2026-07-28): wieder deutlich glatter. Die zweite war eine Sparfassung gegen
	// die Punktflut -- seit „Fläche vereinfachen" den Umriss nachträglich ausdünnt, ist die Flut kein
	// Argument mehr. Die Kanten dürfen also wieder rund aussehen; wem es zu fein wird, der zieht hinterher
	// einmal am Regler. Der Weg herum wäre der schlechtere: eine Kante, die gar nicht erst entstand, holt
	// keine Vereinfachung zurück.
	//
	// 10 px → 8, 20 px → 12, 40 px → 17, 80 px → 25, ab ~130 px → 32 als Deckel.
	function brushVertexCount(radiusPx) {
		const scaled = Math.round(8 * Math.pow(Math.max(1, radiusPx) / 10, 0.55));

		return Math.max(8, Math.min(32, scaled));
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
		// Parked: neither ring nor outline. A brush circle that follows the pointer without painting
		// anything is a lie about what the next click does.
		if (brushPanHold) {
			return;
		}
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

	// ---- rückgängig -----------------------------------------------------------------------------------

	function pushBrushUndoStep(geometry) {
		if (!geometry) {
			return;
		}
		brushUndoStack.push(JSON.parse(JSON.stringify(geometry)));
		while (brushUndoStack.length > BRUSH_UNDO_LIMIT) {
			brushUndoStack.shift();
		}
	}

	// 💣 Ein Schnappschuss taugt nur zurück, solange die Fläche seither NIEMAND SONST angefasst hat.
	// `expected_revision` schützt hier nicht: Rückgängig schickt die aktuelle Revision mit und würde eine
	// fremde Änderung anstandslos überschreiben -- mit einem Stand von vor ihr. Deshalb merkt sich jeder
	// Schreibvorgang, welche Revision er hinterlassen hat; passt sie nicht mehr, ist der Stapel wertlos
	// und wird verworfen, statt Schaden anzurichten. Das ist die Übersetzung der Owner-Regel von
	// 2026-07-26 auf dieses Werkzeug: das Kürzel nimmt EIGENE Arbeit zurück, nie fremde.
	function brushUndoStackIsStale() {
		const area = areaByPublicId(brushUndoAreaPublicId);
		if (!area) {
			return true;
		}
		return brushUndoRevision !== null && Number(area.geometry_revision) !== brushUndoRevision;
	}

	function canUndoBrush() {
		if (brushUndoStack.length === 0) {
			return false;
		}
		if (brushUndoStackIsStale()) {
			brushUndoStack = [];
			brushUndoRevision = null;
			return false;
		}

		return true;
	}

	// 🪤 Der Strich war bereits GESPEICHERT -- rückgängig heisst hier also nicht „nicht abschicken",
	// sondern den vorigen Stand zurückschreiben. Ein normaler Geometrie-Schreibvorgang mit der aktuellen
	// Revision, kein Eingriff in die Historie: was der Editor selbst gemalt hat, nimmt er selbst zurück.
	async function undoBrushStroke() {
		if (brushSaving) {
			return false;
		}
		const area = areaByPublicId(brushUndoAreaPublicId);
		if (!area || brushUndoStack.length === 0) {
			say("Nichts mehr zum Rückgängigmachen.", "info");
			return false;
		}

		const previous = brushUndoStack.pop();
		brushSaving = true;
		try {
			await postEcosystemEdit("update_area_geometry", {
				public_id: String(area.public_id),
				expected_revision: Number(area.geometry_revision),
				geometry_geojson: previous,
			});
			if (typeof loadEcosystemAreas === "function") {
				await loadEcosystemAreas();
			}
			if (typeof invalidateEcosystemRegionCache === "function") {
				invalidateEcosystemRegionCache();
			}
			const frisch = areaByPublicId(brushUndoAreaPublicId);
			brushWorkingGeometry = areaGeometry(frisch) || previous;
			brushUndoRevision = Number(frisch?.geometry_revision ?? NaN);
			brushDirty = false;
			say(brushUndoStack.length > 0
				? `Strich zurückgenommen — noch ${brushUndoStack.length} zum Zurücknehmen.`
				: "Strich zurückgenommen — das war der erste.", "info");
			return true;
		} catch (error) {
			// Zurück auf den Stapel: ein fehlgeschlagenes Rückgängig darf den Schritt nicht verbrauchen.
			brushUndoStack.push(previous);
			say(error?.message || "Rückgängig ist fehlgeschlagen.", "warning");
			return false;
		} finally {
			brushSaving = false;
			updateBrushPreview(null);
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
			// Ein Strich ist ohnehin EIN Schreibvorgang -- die Klammer trägt hier vor allem die
			// Beschriftung, damit im „Änderungen"-Fenster „Fläche malen" steht und nicht das allgemeine
			// „Fläche bearbeitet". Der Editor soll die Geste wiedererkennen, die er gemacht hat.
			await withEcosystemOperation(brushMode === "eraser" ? "Fläche radieren" : "Fläche malen", async () => {
				await postEcosystemEdit("update_area_geometry", {
					public_id: String(area.public_id),
					expected_revision: Number(area.geometry_revision),
					geometry_geojson: brushWorkingGeometry,
				});
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
			brushUndoRevision = Number(frisch?.geometry_revision ?? NaN);
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
		if (!brushMode || brushPanHold || event.button !== 0) {
			return;
		}
		L.DomEvent.stop(event);
		brushStrokeActive = true;
		brushLastStampPoint = null;
		// Den Stand VOR diesem Strich merken -- nicht nach jedem Stempel: rückgängig gemacht wird ein
		// Strich, nicht eine Mausbewegung. Genau das ist auch die Einheit, in der gespeichert wird.
		pushBrushUndoStep(brushWorkingGeometry);
		const latlng = map.mouseEventToLatLng(event);
		stampAt(latlng);
		brushLastStampPoint = map.latLngToLayerPoint(latlng);
		updateBrushPreview(latlng);
	}

	function handleBrushMouseMove(event) {
		if (!brushMode || brushPanHold) {
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

	function isTypingTarget(target) {
		const tag = target && target.tagName ? String(target.tagName).toUpperCase() : "";

		return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
	}

	function beginPanHold() {
		if (brushPanHold || !brushMode || typeof map === "undefined" || !map) {
			return;
		}
		brushPanHold = true;
		map.dragging.enable();
		const container = map.getContainer();
		container.classList.remove("ecosystem-brush-cursor");
		container.classList.add("ecosystem-brush-pan");
		clearBrushPreview();
	}

	function endPanHold() {
		if (!brushPanHold) {
			return;
		}
		// 🪤 Released mid-drag: let the drag finish first. Taking `dragging` away while Leaflet's own
		// handler is running leaves the map stuck to the pointer, and the next click lands somewhere else.
		if (typeof map !== "undefined" && map && map.dragging?.moving?.()) {
			map.once("dragend", endPanHold);
			return;
		}
		brushPanHold = false;
		if (typeof map === "undefined" || !map) {
			return;
		}
		map.getContainer().classList.remove("ecosystem-brush-pan");
		// Only back to the brush if there still IS one -- stopBrush ends the hold on its way out, and it
		// wants dragging left ON.
		if (brushMode) {
			map.dragging.disable();
			map.getContainer().classList.add("ecosystem-brush-cursor");
			updateBrushPreview(null);
		}
	}

	function handleBrushKeydown(event) {
		if (!brushMode) {
			return;
		}
		if (event.key === "Escape") {
			event.stopPropagation();
			stopBrush("Pinsel beendet.");
			return;
		}
		// 💣 A field being typed into keeps its space -- this handler sits on `document` in the capture
		// phase, so without this check the brush would eat every blank of every name the editor types.
		if ((event.code !== "Space" && event.key !== " ") || isTypingTarget(event.target)) {
			return;
		}
		// Otherwise space scrolls the shell or presses whatever button happens to have focus.
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat || brushStrokeActive) {
			return;
		}
		beginPanHold();
	}

	function handleBrushKeyup(event) {
		// No typing-target check on the way out: if the hold never started, this is a no-op anyway, and a
		// keyup that gets skipped would leave the brush parked for good.
		if (event.code === "Space" || event.key === " ") {
			endPanHold();
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
		document.addEventListener("keyup", handleBrushKeyup, true);
		// 🪤 Alt+Tab with space held never delivers a keyup. Without this the editor comes back to a
		// brush that paints nothing and a map that drags -- and no key left to press to get out of it.
		window.addEventListener("blur", endPanHold);
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
		// 🪤 Der Rückgängig-Stapel gehört der FLÄCHE, nicht dem Werkzeuggang: Pinsel und Radiergummi
		// abwechselnd auf derselben Fläche sind ein Arbeitsgang und sollen sich gemeinsam zurücknehmen
		// lassen. Erst der Wechsel auf eine ANDERE Fläche wirft ihn weg -- ein Strg+Z darf niemals auf
		// einer Fläche landen, an die der Editor gerade gar nicht denkt.
		if (brushUndoAreaPublicId !== brushAreaPublicId) {
			brushUndoStack = [];
			brushUndoAreaPublicId = brushAreaPublicId;
			brushUndoRevision = null;
		}
		brushWorkingGeometry = geometry;
		brushDirty = false;
		bindBrushEvents();
		// A fresh brush never inherits a parked state. A hold still pending from the previous tool
		// would swallow every stroke of this one, and nothing on screen would say why.
		brushPanHold = false;
		map.getContainer().classList.remove("ecosystem-brush-pan");
		map.dragging.disable();
		map.getContainer().classList.add("ecosystem-brush-cursor");
		updateBrushPreview(null);
		say(mode === "eraser"
			? "Radiergummi: ziehen nimmt weg. Leertaste verschiebt die Karte, Strg+Mausrad ändert die Größe, ESC beendet."
			: "Pinsel: ziehen malt Fläche dazu. Leertaste verschiebt die Karte, Strg+Mausrad ändert die Größe, ESC beendet.", "info");
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
		// After brushMode is cleared, so the hold gives the cursor back without re-disabling dragging.
		endPanHold();
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
		// Von der Tastenbindung in map-features-ecosystem-edit.js gerufen -- Strg+Z gehört dort dem
		// ganzen Landschaftsmodus, und dieser Pinsel meldet nur an, dass er etwas zurückzunehmen hat.
		canUndo: canUndoBrush,
		undo: undoBrushStroke,
		undoDepth: () => brushUndoStack.length,
	};
})();
