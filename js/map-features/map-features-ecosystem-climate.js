// Klimazonen -- der Trennlinien-Editor auf der Karte (Entwurf
// docs/superpowers/specs/2026-08-03-klimazonen-design.md §8.4).
//
// 🔴 DIESE DATEI BEARBEITET LINIEN, NIE FLÄCHEN. Die sieben Bänder sind abgeleitet; sie kommen als
// gewöhnliche Flächen aus dem Loader und werden hier nur neu angefordert, nachdem der Server sie
// nachgerechnet hat. Wer hier anfängt, ein Band anzufassen, baut die zweite Wahrheit ein, die der
// ganze Entwurf vermeidet -- und sie wäre beim nächsten Ableiten stillschweigend wieder weg.
//
// 🔴 KOORDINATEN. Auf dem Draht GeoJSON [x, y]; Leaflet will [lat, lng] = [y, x]. Gedreht wird HIER
// und nur hier (AGENTS.md §5). Norden ist hohes y, Trennlinie 1 liegt also am höchsten.

const CLIMATE_MIN_XY = 0;
const CLIMATE_MAX_XY = 1024;

// Derselbe Mindestabstand, den der Server erzwingt (AVESMAPS_CLIMATE_MIN_GAP). Der Client klemmt damit
// VOR dem Speichern, statt eine Fehlermeldung abzuholen -- aber die Wahrheit steht auf dem Server, und
// der prüft noch einmal: ein zweiter Editor kann die Nachbarlinie inzwischen bewegt haben, und nur der
// Server sieht beide Bewegungen.
const CLIMATE_MIN_GAP = 1;

// Wo der Zonenname sitzt: ein Stück vom Westrand herein, damit er nicht am Kartenrand klebt.
const CLIMATE_NAME_ANCHOR_X = 40;

// Unter dieser Bandhöhe wird der Name weggelassen. Ein Name, der über seine eigene Zone hinausragt,
// beschriftet die Nachbarzone mit.
const CLIMATE_NAME_MIN_HEIGHT = 8;

// ---- reine Rechnerei (unit-getestet, js/map-features/__tests__/ecosystem-climate.test.js) ----------

function climateYAtX(coordinates, x) {
	if (!Array.isArray(coordinates) || coordinates.length === 0) {
		return 0;
	}
	if (x <= coordinates[0][0]) {
		return coordinates[0][1];
	}
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const [ax, ay] = coordinates[index];
		const [bx, by] = coordinates[index + 1];
		if (x >= ax && x <= bx) {
			const span = bx - ax;
			return span <= 0 ? ay : ay + ((x - ax) / span) * (by - ay);
		}
	}
	return coordinates[coordinates.length - 1][1];
}

// Wohin darf dieser Griff senkrecht? `north`/`south` sind die Nachbarlinien als Koordinatenlisten oder
// null (dann gilt der Kartenrand).
//
// 🔴 Der Korridor wird an der Stelle x GEMESSEN, nicht an einem festen Punkt: bei einer schrägen
// Nachbarlinie wäre ein Griff am rechten Rand sonst von deren Höhe am linken Rand geklemmt.
function climateClampVertexY(y, x, north, south) {
	const upper = north ? climateYAtX(north, x) - CLIMATE_MIN_GAP : CLIMATE_MAX_XY;
	const lower = south ? climateYAtX(south, x) + CLIMATE_MIN_GAP : CLIMATE_MIN_XY;
	return Math.max(lower, Math.min(upper, y));
}

// Und waagerecht? Ein Griff darf seine Nachbarn nicht überholen -- sonst wäre x nicht mehr streng
// steigend, und genau daran hängt die ganze Konstruktion (api/_internal/app/climate-zones.php).
function climateClampVertexX(x, previousX, nextX) {
	return Math.max(previousX + CLIMATE_MIN_GAP, Math.min(nextX - CLIMATE_MIN_GAP, x));
}

// An welcher Stelle der Punktliste landet ein Klick bei x?
//
// 🔴 Immer mindestens 1 und höchstens length - 1: die beiden Randpunkte sind Pflicht, und ein Einfügen
// ausserhalb von ihnen schöbe einen aus seiner Ecke -- das Band darunter hörte dann vor dem Kartenrand
// auf und hinterliesse einen Streifen, der zu keiner Zone gehört.
function climateInsertionIndex(coordinates, x) {
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		if (x > coordinates[index][0] && x < coordinates[index + 1][0]) {
			return index + 1;
		}
	}
	return x <= coordinates[0][0] ? 1 : coordinates.length - 1;
}

// ---- Zustand ---------------------------------------------------------------------------------------

let climateDividers = null;      // [{seq, geometry:{type,coordinates}, revision}] -- null = nie geholt
let climateZones = [];           // [{type_key, label, sort_order, region_public_id}]
let climateLineLayers = [];
let climateHandleLayers = [];
let climateNameLayers = [];
let climateSaving = false;
let climateLoading = false;

function climateSay(message, tone) {
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast(message, tone);
	}
}

// Drei Tore, wie überall in dieser Ebene: der Modus, die gewählte Ebene, und der Edit-Modus. Das dritte
// ist hier zwingend -- Bänder ANSEHEN darf jeder Admin, Grenzen ZIEHEN nur im Editiermodus. Dieselbe
// zusätzliche Bedingung tragen die Zeichenwege (context-action, territory-import).
function isClimateEditorActive() {
	return typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive()
		&& typeof getActiveEcosystemLayerKind === "function" && getActiveEcosystemLayerKind() === "klima"
		&& typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE;
}

function climateNeighbourCoordinates(dividerIndex, offset) {
	const neighbour = (climateDividers || [])[dividerIndex + offset];
	return neighbour ? neighbour.geometry.coordinates : null;
}

// ---- Zeichnen --------------------------------------------------------------------------------------

function clearClimateOverlay() {
	[...climateLineLayers, ...climateHandleLayers, ...climateNameLayers].forEach((layer) => {
		if (typeof map !== "undefined" && map && map.hasLayer(layer)) {
			map.removeLayer(layer);
		}
	});
	climateLineLayers = [];
	climateHandleLayers = [];
	climateNameLayers = [];
}

function drawClimateDividerLine(divider, dividerIndex, color) {
	const latlngs = divider.geometry.coordinates.map(([x, y]) => [y, x]);
	const line = L.polyline(latlngs, {
		pane: "ecosystemPaneKlimaLines",
		color,
		weight: 2,
		interactive: true,
	}).addTo(map);
	// Klick auf die Linie setzt einen Punkt. L.DomEvent.stop verhindert, dass derselbe Klick zusätzlich
	// die Karte trifft -- dort hebt er sonst die Flächenauswahl auf.
	line.on("click", (event) => {
		L.DomEvent.stop(event);
		insertClimateVertex(dividerIndex, event.latlng);
	});
	climateLineLayers.push(line);
	return line;
}

function drawClimateHandle(divider, dividerIndex, pointIndex) {
	const position = divider.geometry.coordinates[pointIndex];
	const isEdge = pointIndex === 0 || pointIndex === divider.geometry.coordinates.length - 1;
	const handle = L.marker([position[1], position[0]], {
		draggable: true,
		keyboard: false,
		bubblingMouseEvents: false,
		icon: L.divIcon({
			className: "path-edit-handle-marker ecosystem-edit-handle-marker"
				+ (isEdge ? " ecosystem-climate-handle--pinned" : ""),
			html: '<span class="path-edit-handle-marker__dot"></span>',
			iconSize: [14, 14],
			iconAnchor: [7, 7],
		}),
	}).addTo(map);

	handle.on("drag", (event) => {
		const moved = climateVertexTarget(dividerIndex, pointIndex, isEdge, event.target.getLatLng());
		event.target.setLatLng([moved[1], moved[0]]);
		divider.geometry.coordinates[pointIndex] = moved;
		climateLineLayers[dividerIndex]?.setLatLngs(divider.geometry.coordinates.map(([x, y]) => [y, x]));
	});
	// 💣 Beim `dragend` NICHT synchron neu zeichnen. Genau das hat der Kartenpunkt-Editor gekostet:
	// Speichern anstossen, Antwort abwarten, dann zeichnen (siehe saveClimateDivider).
	handle.on("dragend", () => { void saveClimateDivider(dividerIndex); });

	const element = handle.getElement?.();
	if (element) {
		L.DomEvent.disableClickPropagation(element);
		// 💣 LÖSCHEN HÄNGT AN EINEM NATIVEN LISTENER, nicht an handle.on("dblclick"). An genau dieser
		// Stelle ist der Flächen-Editor schon einmal gescheitert -- der Leaflet-Weg feuert dort nicht
		// zuverlässig (map-features-ecosystem-edit.js, Kommentar an den Ecken-Griffen).
		//
		// 🪤 Nur für die MITTLEREN Griffe. Ein Randgriff bekommt gar keinen Listener: er ist Pflicht,
		// und ein Doppelklick auf ihn soll spürbar nichts tun statt eine Fehlermeldung zu werfen.
		if (!isEdge) {
			element.addEventListener("dblclick", (nativeEvent) => {
				nativeEvent.preventDefault();
				nativeEvent.stopPropagation();
				removeClimateVertex(dividerIndex, pointIndex);
			});
		}
	}
	climateHandleLayers.push(handle);
}

// Der Zonenname am Westrand seines Bandes.
//
// 🔴 KEIN map_features-Label. Ein echtes Karten-Label bräuchte einen neuen Subtyp in der Allowlist,
// liefe durch die Kollisionsauflösung und stünde auf der normalen Karte -- wo eine „Tropische Zone"
// mit echter Geographie um Platz konkurrierte. Der Name gehört zur Ebene und verschwindet mit ihr.
function drawClimateZoneNames() {
	const dividerCount = (climateDividers || []).length;
	climateZones.forEach((zone, zoneIndex) => {
		const north = zoneIndex === 0 ? null : climateNeighbourCoordinates(zoneIndex - 1, 0);
		const south = zoneIndex >= dividerCount ? null : climateNeighbourCoordinates(zoneIndex, 0);
		const top = north ? climateYAtX(north, CLIMATE_NAME_ANCHOR_X) : CLIMATE_MAX_XY;
		const bottom = south ? climateYAtX(south, CLIMATE_NAME_ANCHOR_X) : CLIMATE_MIN_XY;
		if (top - bottom < CLIMATE_NAME_MIN_HEIGHT) {
			return;
		}
		const escape = typeof escapeHtml === "function" ? escapeHtml : ((value) => String(value));
		const marker = L.marker([(top + bottom) / 2, CLIMATE_NAME_ANCHOR_X], {
			pane: "ecosystemPaneKlimaLines",
			interactive: false,
			keyboard: false,
			icon: L.divIcon({
				className: "ecosystem-climate-name",
				html: `<span>${escape(zone.label)}</span>`,
				iconSize: null,
			}),
		}).addTo(map);
		climateNameLayers.push(marker);
	});
}

function drawClimateOverlay() {
	clearClimateOverlay();
	if (typeof map === "undefined" || !map || !Array.isArray(climateDividers)) {
		return;
	}

	// Kein Literal (AGENTS.md §12): der Ton kommt aus dem Token, wie bei jeder anderen gezeichneten
	// Farbe dieser Ebene.
	const color = getComputedStyle(document.documentElement)
		.getPropertyValue("--color-ecosystem-klima-divider").trim();

	climateDividers.forEach((divider, dividerIndex) => drawClimateDividerLine(divider, dividerIndex, color));
	// Griffe ERST, wenn alle Linien liegen: climateLineLayers[dividerIndex] muss beim ersten Ziehen
	// schon da sein, sonst zieht der Griff eine Linie, die er nicht findet.
	climateDividers.forEach((divider, dividerIndex) => {
		divider.geometry.coordinates.forEach((position, pointIndex) => {
			drawClimateHandle(divider, dividerIndex, pointIndex);
		});
	});
	drawClimateZoneNames();
}

// ---- Gesten ----------------------------------------------------------------------------------------

function climateVertexTarget(dividerIndex, pointIndex, isEdge, latlng) {
	const coordinates = climateDividers[dividerIndex].geometry.coordinates;
	// Ein Randgriff behält sein x -- er ist am Kartenrand festgenagelt. Deshalb wird auch der Korridor
	// an seinem ALTEN x gemessen und nicht dort, wo die Maus gerade steht.
	const x = isEdge
		? coordinates[pointIndex][0]
		: climateClampVertexX(latlng.lng, coordinates[pointIndex - 1][0], coordinates[pointIndex + 1][0]);
	const y = climateClampVertexY(
		latlng.lat,
		x,
		climateNeighbourCoordinates(dividerIndex, -1),
		climateNeighbourCoordinates(dividerIndex, 1)
	);
	return [x, y];
}

function insertClimateVertex(dividerIndex, latlng) {
	const divider = climateDividers?.[dividerIndex];
	if (!divider || climateSaving) {
		return;
	}
	const coordinates = divider.geometry.coordinates;
	const index = climateInsertionIndex(coordinates, latlng.lng);
	const x = climateClampVertexX(latlng.lng, coordinates[index - 1][0], coordinates[index][0]);
	const y = climateClampVertexY(
		latlng.lat,
		x,
		climateNeighbourCoordinates(dividerIndex, -1),
		climateNeighbourCoordinates(dividerIndex, 1)
	);
	coordinates.splice(index, 0, [x, y]);
	void saveClimateDivider(dividerIndex);
}

function removeClimateVertex(dividerIndex, pointIndex) {
	const divider = climateDividers?.[dividerIndex];
	if (!divider || climateSaving) {
		return;
	}
	// Die beiden Randpunkte sind Pflicht: ohne sie hört die Linie vor dem Kartenrand auf, und das Band
	// darunter bekäme einen Streifen, der zu keiner Zone gehört. Der Doppelklick-Listener wird für sie
	// gar nicht erst gehängt; dies ist der zweite Riegel, falls jemand die Funktion anderswoher ruft.
	if (pointIndex <= 0 || pointIndex >= divider.geometry.coordinates.length - 1) {
		return;
	}
	divider.geometry.coordinates.splice(pointIndex, 1);
	void saveClimateDivider(dividerIndex);
}

// ---- Laden und Speichern ---------------------------------------------------------------------------

async function loadClimateDividers() {
	if (climateLoading) {
		return;
	}
	climateLoading = true;
	try {
		const result = await postEcosystemEdit("climate_get", {});
		climateDividers = Array.isArray(result?.dividers) ? result.dividers : [];
		climateZones = Array.isArray(result?.zones) ? result.zones : [];
		drawClimateOverlay();
	} finally {
		climateLoading = false;
	}
}

async function saveClimateDivider(dividerIndex) {
	const divider = climateDividers?.[dividerIndex];
	if (!divider || climateSaving) {
		return;
	}
	climateSaving = true;
	try {
		const result = await postEcosystemEdit("climate_save_divider", {
			seq: divider.seq,
			geometry_geojson: divider.geometry,
			expected_revision: divider.revision,
		});
		if (Array.isArray(result?.dividers)) {
			climateDividers = result.dividers;
		}
		drawClimateOverlay();
		// Die Bänder hat der Server nachgerechnet -- sie kommen über den gewöhnlichen Flächenweg zurück.
		if (typeof scheduleEcosystemAreaReload === "function") {
			scheduleEcosystemAreaReload({ immediate: true });
		}
	} catch (error) {
		// 🔴 Bei einem Fehlschlag den SERVERSTAND wiederherstellen, nicht den lokalen behalten. Sonst
		// sieht der Editor eine Linie, die es nicht gibt, und jeder weitere Zug baut darauf auf --
		// inklusive der `revision`, die dann bei jedem Speichern erneut in den 409 läuft.
		console.warn("Klimagrenze konnte nicht gespeichert werden:", error);
		climateSay("Die Trennlinie konnte nicht gespeichert werden: " + (error?.message || ""), "warning");
		climateDividers = null;
	} finally {
		climateSaving = false;
	}
	if (climateDividers === null) {
		await loadClimateDividers().catch(() => { clearClimateOverlay(); });
	}
}

// ---- Eintrittspunkt --------------------------------------------------------------------------------
// Von syncEcosystemPaneStates gerufen, also bei jedem Ebenen- und jedem Moduswechsel. Die Linien räumen
// sich damit bei jeder anderen Lage selbst ab -- es braucht keinen zweiten Aufräumweg.

function syncEcosystemClimateEditor() {
	if (!isClimateEditorActive()) {
		clearClimateOverlay();
		return;
	}
	if (climateDividers === null) {
		void loadClimateDividers().catch((error) => {
			console.warn("Klimazonen konnten nicht geladen werden:", error);
			climateDividers = null;
		});
		return;
	}
	drawClimateOverlay();
}

window.AvesmapsEcosystemClimate = { sync: syncEcosystemClimateEditor };

// Node-Export für die Einheitentests (Hausmuster, wie map-features-ecosystem-boolean.js). Im Browser
// existiert `module` nicht, dort bleiben die Funktionen schlicht global.
if (typeof module !== "undefined" && module.exports) {
	module.exports = { climateYAtX, climateClampVertexY, climateClampVertexX, climateInsertionIndex };
}
