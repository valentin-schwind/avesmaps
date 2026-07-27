/*
 * Landschaften -- die sieben Geometrie-Operationen im Rechtsklickmenü einer Fläche.
 *
 * Vereinigen · Ausschneiden · Ausschneiden-und-behalten · Schnittmenge · Zerschneiden · Herauslösen ·
 * Verschieben. Dieselbe Auswahl, die das Territorien-Menü anbietet (index.html:268-278), auf
 * ecosystem_area statt political_territory_geometry.
 *
 * 🔴 Die RECHNEREI steht nicht hier, sondern in map-features-ecosystem-boolean.js -- rein, ohne Karte,
 * mit Unit-Test. Diese Datei ist nur die GESTE: wer ist Quelle, wer ist Ziel, was wird gespeichert.
 * Die Trennung ist Absicht; die Territorien haben sie auch (edit-ops / boolean-geometry / pipeline).
 *
 * 🔴 Keine politische Datei wird aufgerufen (Hauptplan, Regel 1). `pointInPolygon` ist die eine
 * Ausnahme, und keine echte: map-features-point-in-polygon.js ist ein eigenständiger Rechenhelfer mit
 * eigenem Test, den auch der Siedlungseditor lädt -- kein Herrschaftsgebiete-Modul.
 *
 * 💣 ZWEISTUFIGE OPERATIONEN LAUFEN ÜBER EINEN ZUSTAND, und der muss zuverlässig wieder weggehen.
 * Deshalb bricht ihn ALLES ab, was „ich meine etwas anderes" heißt: Escape, ein Rechtsklick auf die
 * freie Karte, ein Ebenenwechsel. Ein hängengebliebener „jetzt die zweite Fläche anklicken"-Zustand
 * würde den nächsten harmlosen Klick in eine Geometrieänderung verwandeln.
 */
(function initEcosystemGeometryOps() {
	"use strict";

	// Zwei-Flächen-Operationen: Quelle wählen, Ziel anklicken.
	//
	// 🔴 WORTLAUT UND REIHENFOLGE SIND VOM HERRSCHAFTSGEBIETE-MENÜ ABGESCHRIEBEN (index.html:268-278),
	// nicht neu erfunden: „Von anderem ausschneiden" heisst hier „Von anderer ausschneiden", weil eine
	// Fläche weiblich ist -- mehr Unterschied gibt es nicht. Die Editoren bedienen jenes Menü seit
	// Monaten; zwei Vokabulare für dieselbe Geste wäre die eigentliche Zumutung.
	const TARGET_OPERATIONS = [
		{ action: "union", label: "Mit anderer vereinigen" },
		{ action: "difference", label: "Von anderer ausschneiden" },
		{ action: "difference-keep-target", label: "Von anderer ausschneiden und andere beibehalten" },
		{ action: "intersection", label: "Neue von anderer ausschneiden" },
	];

	// Der laufende Zustand. null = nichts vorgemerkt.
	// { operation, sourcePublicId, points?: [{x,y}], moveOrigin?: {x,y}, moveGeometry? }
	let pending = null;
	let lastContextLatLng = null;
	let opsBusy = false;
	let mapHooked = false;

	function say(message, tone) {
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

	// GeoJSON-Koordinaten sind [x, y]; Leaflet rechnet in [lat, lng] = [y, x]. Jeder Übergang wird
	// bewusst gedreht (AGENTS.md §5) -- hier ist die einzige Stelle, an der das passiert.
	function latLngToPoint(latlng) {
		return { x: Number(latlng?.lng), y: Number(latlng?.lat) };
	}

	function areaGeometry(area) {
		const geometry = area?.geometry_geojson || area?.geometry || null;
		if (!geometry || !geometry.type) {
			throw new Error("Diese Fläche hat keine lesbare Geometrie.");
		}
		return geometry;
	}

	// Die Vorschau beim Verschieben: die gezeichnete Form folgt der Maus, gespeichert ist noch nichts.
	// Nur die Leaflet-Ebene wird angefasst, NICHT `area.geometry_geojson` -- die bleibt der zuletzt
	// gespeicherte Stand, damit ein Abbruch etwas hat, worauf er zurückfallen kann.
	function previewGeometry(publicId, geometry) {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(String(publicId || ""))
			: null;
		const latlngs = typeof ecosystemAreaLatLngs === "function" ? ecosystemAreaLatLngs(geometry) : null;
		if (layer && latlngs && typeof layer.setLatLngs === "function") {
			layer.setLatLngs(latlngs);
		}
	}

	// ---- Speichern ---------------------------------------------------------------------------------

	// expected_revision ist Pflicht (avesmapsEcosystemReadExpectedRevision): ohne sie ist der
	// Lese-Vergleich-Schreib-Weg nicht atomar, und zwei Editoren in derselben Sekunde bekämen einen
	// Münzwurf statt einer 409.
	function revisionOf(area) {
		const revision = Number(area?.geometry_revision);
		if (!Number.isInteger(revision) || revision < 1) {
			throw new Error("Diese Fläche ist nicht mehr geladen. Bitte neu laden.");
		}
		return revision;
	}

	async function saveGeometry(area, geometry) {
		await postEcosystemEdit("update_area_geometry", {
			public_id: String(area.public_id),
			expected_revision: revisionOf(area),
			geometry_geojson: geometry,
		});
	}

	async function createArea(area, geometry) {
		await postEcosystemEdit("create_area", {
			region_public_id: String(area.region_public_id || ""),
			geometry_geojson: geometry,
		});
	}

	async function deleteArea(area) {
		await postEcosystemEdit("delete_area", {
			public_id: String(area.public_id),
			expected_revision: revisionOf(area),
		});
	}

	// Nach jedem Schreibvorgang: offene Ecken-Sitzung zu (ohne Nachspülen -- die Geometrie unter ihr ist
	// gerade eine andere geworden), Auswahl los, neu laden. Der Regionen-Cache trägt Flächenzahlen und
	// ist nach create/delete stale.
	function refreshAfterWrite() {
		if (typeof closeEcosystemGeometryEdit === "function") {
			closeEcosystemGeometryEdit({ flush: false });
		}
		if (typeof setSelectedEcosystemArea === "function") {
			setSelectedEcosystemArea("");
		}
		if (typeof invalidateEcosystemRegionCache === "function") {
			invalidateEcosystemRegionCache();
		}
		if (typeof scheduleEcosystemAreaReload === "function") {
			scheduleEcosystemAreaReload({ immediate: true });
		}
	}

	function failed(error) {
		console.error("Geometrieoperation fehlgeschlagen:", error);
		// 409 heißt: jemand anderes war schneller, die lokale Kopie ist wertlos. Nur der Lesepfad kann
		// das klären -- dieselbe Behandlung wie beim Löschen (context-action.js:423).
		if (error?.status === 409 || error?.code === "conflict") {
			if (typeof scheduleEcosystemAreaReload === "function") {
				scheduleEcosystemAreaReload({ immediate: true });
			}
			say("Diese Fläche wurde inzwischen von jemand anderem geändert. Sie wird neu geladen.", "warning");
			return;
		}
		say(error?.message || "Die Geometrieoperation ist fehlgeschlagen.", "warning");
	}

	// ---- Zustand ----------------------------------------------------------------------------------

	function cancelPending({ silent = false } = {}) {
		if (!pending) {
			return;
		}
		const wasMoving = pending.operation === "move";
		if (wasMoving && pending.moveGeometry) {
			// Vorschau zurückdrehen: die Karte zeigt beim Abbrechen wieder den gespeicherten Stand.
			previewGeometry(pending.sourcePublicId, pending.moveGeometry);
		}
		pending = null;
		clearTargetHighlight();
		if (typeof map !== "undefined" && map && typeof map.off === "function") {
			map.off("click", handleMapClick);
			map.off("mousemove", handleMapMouseMove);
		}
		if (!silent) {
			say("Abgebrochen.", "info");
		}
	}

	function startPending(operation, sourcePublicId, extra = {}) {
		cancelPending({ silent: true });
		pending = { operation, sourcePublicId: String(sourcePublicId), ...extra };
		hookMap();
	}

	function hookMap() {
		if (mapHooked || typeof map === "undefined" || !map || typeof map.on !== "function") {
			return;
		}
		mapHooked = true;
		// 🔴 Rechtsklick auf die FREIE Karte gibt die Auswahl frei und bricht ab. Das Layer-eigene
		// contextmenu ruft L.DomEvent.stop (rendering.js:252), erreicht map also nie -- was hier ankommt,
		// ist garantiert ein Klick neben jede Fläche. Ohne das stünde das gewöhnliche Kartenmenü neben
		// einer weiß umrandeten Fläche, die niemand mehr gemeint hat.
		map.on("contextmenu", () => {
			cancelPending({ silent: true });
			if (typeof setSelectedEcosystemArea === "function") {
				setSelectedEcosystemArea("");
			}
		});
	}

	// ---- Ziel-Hervorhebung ---------------------------------------------------------------------------
	// Während eine Zwei-Flächen-Operation läuft, bekommt die Fläche unter der Maus eine goldene Kontur:
	// dieselbe Auskunft, die das Herrschaftsgebiete-Menü gibt („welche erwische ich, wenn ich klicke").
	//
	// Über eine KLASSE, nicht über layer.setStyle wie dort: die Territorien schreiben `#fff4a3` inline
	// ins JS (region-pending-highlight.js:16) und müssen den alten Stil hinterher von Hand
	// wiederherstellen. Eine Klasse kennt der Landschafts-Layer ohnehin (ecosystem-area--selected), sie
	// braucht kein Zurückschreiben und die Farbe steht als Token da, wo Farben hingehören.
	let highlightBound = false;

	function targetHighlightElement(publicId) {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(String(publicId || ""))
			: null;
		return typeof layer?.getElement === "function" ? layer.getElement() : null;
	}

	function clearTargetHighlight() {
		document.querySelectorAll(".ecosystem-area--target")
			.forEach((element) => element.classList.remove("ecosystem-area--target"));
	}

	// Einmal für alle Flächen, delegiert: die Ebenen werden beim Schwenken neu gebaut, ein Listener je
	// Ebene wäre nach dem ersten Nachladen tot.
	//
	// 💣 AUF `document`, NICHT auf `.ecosystem-pane`. Davon gibt es DREI -- eine je Ebene
	// (ECOSYSTEM_KIND_PANES) --, und `querySelector` liefert immer die erste, die derographische. Genau
	// so hing der Listener zuerst an der falschen Pane und die Vegetationsflächen leuchteten nie auf.
	function bindTargetHighlight() {
		if (highlightBound) {
			return;
		}
		highlightBound = true;
		document.addEventListener("mouseover", (event) => {
			if (!pending || pending.operation === "split" || pending.operation === "move") {
				return;
			}
			// Nur Landschaftsflächen -- eine politische Grenze oder ein Weg unter dem Zeiger ist kein Ziel.
			const path = event.target?.closest?.(".ecosystem-pane path.leaflet-interactive");
			if (!path) {
				return;
			}
			// Die Quelle ist nicht ihr eigenes Ziel.
			const sourceElement = targetHighlightElement(pending.sourcePublicId);
			clearTargetHighlight();
			if (path !== sourceElement) {
				path.classList.add("ecosystem-area--target");
			}
		});
		document.addEventListener("mouseout", (event) => {
			const path = event.target?.closest?.(".ecosystem-pane path.leaflet-interactive");
			path?.classList.remove("ecosystem-area--target");
		});
	}

	// ---- Zwei-Flächen-Operationen -------------------------------------------------------------------

	async function completeTargetOperation(targetPublicId) {
		const source = areaByPublicId(pending.sourcePublicId);
		const target = areaByPublicId(targetPublicId);
		const operation = pending.operation;
		cancelPending({ silent: true });
		if (!source || !target) {
			say("Eine der beiden Flächen ist nicht mehr geladen.", "warning");
			return;
		}
		if (source.public_id === target.public_id) {
			say("Bitte eine andere Fläche wählen.", "warning");
			return;
		}

		opsBusy = true;
		try {
			const geometry = ecosystemBooleanGeometry(operation, areaGeometry(source), areaGeometry(target));
			await saveGeometry(source, geometry);
			// Erst danach das Ziel entfernen: schlägt das Speichern fehl, ist noch nichts weg.
			if (ecosystemBooleanConsumesTarget(operation)) {
				await deleteArea(target);
			}
			refreshAfterWrite();
			say("Geometrieoperation gespeichert.", "success");
		} catch (error) {
			failed(error);
		} finally {
			opsBusy = false;
		}
	}

	// ---- Zerschneiden -------------------------------------------------------------------------------

	async function completeSplit(points) {
		const source = areaByPublicId(pending.sourcePublicId);
		cancelPending({ silent: true });
		if (!source) {
			say("Die Fläche ist nicht mehr geladen.", "warning");
			return;
		}

		opsBusy = true;
		try {
			const result = ecosystemSplitGeometry(areaGeometry(source), points[0], points[1]);
			// Der größere Rest behält die Zeile, der Rest wird eine NEUE Fläche derselben Region. Die
			// Region ist bewusst dieselbe: zerschneiden teilt eine Form, nicht eine Zugehörigkeit.
			await saveGeometry(source, result.kept);
			await createArea(source, result.split);
			refreshAfterWrite();
			say("Fläche zerschnitten.", "success");
		} catch (error) {
			failed(error);
		} finally {
			opsBusy = false;
		}
	}

	// ---- Herauslösen --------------------------------------------------------------------------------

	// Welchen TEIL hat der Rechtsklick getroffen? Ohne diese Frage wüsste „Herauslösen" nicht, was es
	// herauslösen soll. Getestet wird gegen den Punkt des Rechtsklicks, nicht gegen eine gemerkte
	// Nummer -- Leaflet nummeriert Ringe nicht so, wie GeoJSON sie ablegt.
	function clickedPartIndex(geometry, point) {
		if (!point || typeof pointInPolygon !== "function") {
			return -1;
		}
		const parts = ecosystemGeometryParts(geometry);
		for (let index = 0; index < parts.length; index++) {
			if (pointInPolygon([point.x, point.y], parts[index])) {
				return index;
			}
		}
		return -1;
	}

	async function runExtract(publicId) {
		const source = areaByPublicId(publicId);
		if (!source) {
			say("Die Fläche ist nicht mehr geladen.", "warning");
			return;
		}

		opsBusy = true;
		try {
			const geometry = areaGeometry(source);
			const index = clickedPartIndex(geometry, lastContextLatLng);
			if (index < 0) {
				say("Bitte mit der rechten Maustaste auf den Teil klicken, der herausgelöst werden soll.", "warning");
				return;
			}
			const result = ecosystemExtractPart(geometry, index);
			await saveGeometry(source, result.remainder);
			await createArea(source, result.extracted);
			refreshAfterWrite();
			say("Teil herausgelöst.", "success");
		} catch (error) {
			failed(error);
		} finally {
			opsBusy = false;
		}
	}

	// ---- Verschieben --------------------------------------------------------------------------------

	async function completeMove() {
		const source = areaByPublicId(pending.sourcePublicId);
		const moved = pending.movedGeometry;
		const original = pending.moveGeometry;
		pending = null;
		if (typeof map !== "undefined" && map) {
			map.off("click", handleMapClick);
			map.off("mousemove", handleMapMouseMove);
		}
		if (!source || !moved) {
			say("Verschieben abgebrochen.", "info");
			return;
		}

		opsBusy = true;
		try {
			await saveGeometry(source, moved);
			refreshAfterWrite();
			say("Fläche verschoben.", "success");
		} catch (error) {
			// Zurück auf den gespeicherten Stand, sonst zeigt die Karte eine Position, die es nicht gibt.
			if (original) {
				previewGeometry(source.public_id, original);
			}
			failed(error);
		} finally {
			opsBusy = false;
		}
	}

	function handleMapMouseMove(event) {
		if (pending?.operation !== "move" || !pending.moveGeometry) {
			return;
		}
		const point = latLngToPoint(event.latlng);
		const moved = ecosystemMoveGeometry(pending.moveGeometry, point.x - pending.moveOrigin.x, point.y - pending.moveOrigin.y);
		pending.movedGeometry = moved;
		previewGeometry(pending.sourcePublicId, moved);
	}

	// ---- Kartenklicks für die zweistufigen Gesten ---------------------------------------------------

	function handleMapClick(event) {
		if (!pending) {
			return;
		}
		if (typeof L?.DomEvent?.stop === "function" && event?.originalEvent) {
			L.DomEvent.stop(event);
		}

		if (pending.operation === "move") {
			void completeMove();
			return;
		}
		if (pending.operation !== "split") {
			return;
		}

		pending.points.push(latLngToPoint(event.latlng));
		if (pending.points.length < 2) {
			say("Zweiten Schnittpunkt setzen.", "info");
			return;
		}
		void completeSplit(pending.points);
	}

	// ---- Die Naht, die rendering.js ruft ------------------------------------------------------------

	// Ein Klick auf eine Fläche, WÄHREND eine Zwei-Flächen-Operation vorgemerkt ist, ist die Zielwahl --
	// nicht das gewohnte Auswählen. Gibt `true` zurück, wenn der Klick verbraucht wurde.
	function handleAreaClick(publicId) {
		// 🪤 Auch wenn nichts vorgemerkt ist: DIESER Klick ist der, der gleich eine Auswahl erzeugt, und
		// der Rechtsklick daneben soll sie wieder freigeben können. Der Kartenhaken muss also spätestens
		// jetzt sitzen -- und `map` gibt es hier garantiert, denn die Fläche liegt darauf.
		hookMap();
		if (!pending || opsBusy) {
			return false;
		}
		if (pending.operation === "split" || pending.operation === "move") {
			return false;                       // die laufen über Kartenklicks, nicht über Flächenklicks
		}
		void completeTargetOperation(publicId);
		return true;
	}

	// ---- Menüeinträge -------------------------------------------------------------------------------

	// 🪤 addEntry hängt JEDEN Eintrag vor „Fläche löschen" -- die Reihenfolge ist also die der
	// Registrierung. Sie folgt Zeile für Zeile dem Territorien-Menü: erst Verschieben und Zerschneiden,
	// DANN die vier booleschen, zuletzt das Herauslösen. Wer hier etwas einschiebt, verschiebt es dort
	// mit.
	function registerEntries() {
		const menu = window.AvesmapsEcosystemAreaMenu;
		if (!menu?.addEntry) {
			return;
		}

		const entry = (action, german, onClick) => menu.addEntry({
			action,
			label: typeof tr === "function" ? tr(`ecosystem.ctxmenu.${action}`, german) : german,
			onClick,
		});

		entry("move", "Verschieben", (publicId) => {
			const area = areaByPublicId(publicId);
			if (!area || !lastContextLatLng) {
				say("Die Fläche ist nicht mehr geladen.", "warning");
				return;
			}
			try {
				startPending("move", publicId, {
					moveGeometry: areaGeometry(area),
					moveOrigin: { x: lastContextLatLng.x, y: lastContextLatLng.y },
				});
			} catch (error) {
				failed(error);
				return;
			}
			if (typeof map !== "undefined" && map) {
				map.on("mousemove", handleMapMouseMove);
				map.on("click", handleMapClick);
			}
			say("Fläche verschieben. Klick speichert, ESC bricht ab.", "info");
		});

		entry("split", "Fläche zerschneiden", (publicId) => {
			startPending("split", publicId, { points: [] });
			if (typeof map !== "undefined" && map) {
				map.on("click", handleMapClick);
			}
			say("Ersten Schnittpunkt setzen. ESC bricht ab.", "info");
		});

		TARGET_OPERATIONS.forEach((operation) => {
			entry(operation.action, operation.label, (publicId) => {
				startPending(operation.action, publicId);
				if (typeof map !== "undefined" && map) {
					map.on("click", handleMapClick);
				}
				bindTargetHighlight();
				say("Jetzt die zweite Fläche anklicken. ESC bricht ab.", "info");
			});
		});

		entry("extract", "Neue Fläche herauslösen", (publicId) => void runExtract(publicId));
	}

	// ---- Verdrahtung --------------------------------------------------------------------------------

	// Den Punkt jedes Rechtsklicks merken -- „Herauslösen" und „Verschieben" brauchen ihn, und das Menü
	// reicht ihn nicht durch. Capture-Phase, weil das Layer-contextmenu den Lauf danach anhält.
	document.addEventListener("contextmenu", (event) => {
		if (typeof map === "undefined" || !map || typeof map.mouseEventToLatLng !== "function") {
			return;
		}
		// 🪤 HIER, nicht erst beim Start einer Operation. `map` entsteht zuletzt (bootstrap.js lädt nach
		// allen map-features-Dateien), also lässt sich der Kartenhaken nicht beim Laden setzen -- und
		// hinge er an startPending, gäbe ein Rechtsklick neben eine bloss ANGEKLICKTE Fläche sie nicht
		// frei, weil nie eine Operation lief. Genau der Fall, um den es geht.
		// Capture läuft vor Leaflets eigenem Container-Listener, der Haken sitzt also rechtzeitig für
		// genau diesen Rechtsklick.
		hookMap();
		try {
			lastContextLatLng = latLngToPoint(map.mouseEventToLatLng(event));
		} catch (error) {
			lastContextLatLng = null;
		}
	}, true);

	// Escape bricht ab. Ohne das bliebe „jetzt die zweite Fläche anklicken" stehen, und der nächste
	// harmlose Klick wäre eine Geometrieänderung.
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && pending) {
			cancelPending();
		}
	}, true);

	// „Neue Fläche herauslösen" hat bei einer EINteiligen Fläche kein Ziel -- es gibt nichts zum
	// Herauslösen, und der Aufruf würde nur mit „das ist der einzige Teil" antworten. Das
	// Herrschaftsgebiete-Menü blendet seinen extract-Eintrag aus demselben Grund aus
	// (map-features-region-context-menu.js:21, `layerCount > 1`). Läuft im Capture, also bevor das
	// Menü sichtbar wird -- sonst blitzte der Eintrag kurz auf.
	// 🪤 Die Fläche kommt aus dem ELEMENT unter dem Zeiger, nicht aus der Auswahl: dieser Listener läuft
	// im Capture und damit VOR dem contextmenu der Ebene, das die Auswahl erst setzt. Über
	// getSelectedEcosystemAreaPublicId() hinge der Eintrag immer eine Fläche hinterher.
	function areaUnderElement(element) {
		if (!element || typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return null;
		}
		for (const layer of ecosystemLayers.values()) {
			if (typeof layer?.getElement === "function" && layer.getElement() === element) {
				return layer._ecosystemArea || null;
			}
		}
		return null;
	}

	document.addEventListener("contextmenu", (event) => {
		const button = document.querySelector('[data-ecosystem-area-action="extract"]');
		if (!button) {
			return;
		}
		const area = areaUnderElement(event.target?.closest?.("path.leaflet-interactive"));
		let parts = 0;
		try {
			parts = area ? ecosystemGeometryParts(areaGeometry(area)).length : 0;
		} catch (error) {
			parts = 0;
		}
		button.hidden = parts < 2;
	}, true);

	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemGeometryOps = {
			handleAreaClick,
			cancel: cancelPending,
			isPending: () => Boolean(pending),
		};
	}

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", registerEntries, { once: true });
		} else {
			registerEntries();
		}
	}
})();
