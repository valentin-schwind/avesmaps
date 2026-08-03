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

// Unter dieser Bandhöhe (Karteneinheiten) wird der Name weggelassen. Ein Name, der über seine eigene
// Zone hinausragt, beschriftet die Nachbarzone mit.
// Der ABSTAND zum Kartenrand steht dagegen im CSS (`.ecosystem-climate-name`, padding-left): er ist ein
// Pixelmaß und soll beim Zoomen nicht mitwachsen.
const CLIMATE_NAME_MIN_HEIGHT = 8;

// ---- reine Rechnerei (unit-getestet, js/map-features/__tests__/ecosystem-climate.test.js) ----------

function climateClampToMap(value) {
	return Math.max(CLIMATE_MIN_XY, Math.min(CLIMATE_MAX_XY, value));
}

// Schneiden sich die Strecken a1-a2 und b1-b2? Wortgleich zu avesmapsClimateSegmentsCross in
// api/_internal/app/climate-zones.php -- der Client soll dasselbe verbieten wie der Server, sonst zieht
// man eine Linie, die beim Loslassen abgelehnt wird.
function climateSegmentsCross(a1, a2, b1, b2) {
	const orient = (p, q, r) => {
		const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
		return Math.abs(value) < 1e-9 ? 0 : (value > 0 ? 1 : 2);
	};
	const onSegment = (p, q, r) =>
		q[0] <= Math.max(p[0], r[0]) + 1e-9 && q[0] >= Math.min(p[0], r[0]) - 1e-9
		&& q[1] <= Math.max(p[1], r[1]) + 1e-9 && q[1] >= Math.min(p[1], r[1]) - 1e-9;

	const o1 = orient(a1, a2, b1), o2 = orient(a1, a2, b2);
	const o3 = orient(b1, b2, a1), o4 = orient(b1, b2, a2);
	if (o1 !== o2 && o3 !== o4) {
		return true;
	}
	return (o1 === 0 && onSegment(a1, b1, a2)) || (o2 === 0 && onSegment(a1, b2, a2))
		|| (o3 === 0 && onSegment(b1, a1, b2)) || (o4 === 0 && onSegment(b1, a2, b2));
}

// Würde dieser Punkt an dieser Stelle etwas kaputt machen?
//
// 🔴 SEIT DEN ÜBERHÄNGEN IST DAS DIE GANZE REGEL (Owner 2026-08-03). Vorher klemmten zwei Schranken:
// y zwischen den Nachbarlinien, x zwischen den Nachbarpunkten. Beide setzten voraus, dass jede Linie
// eine Funktion y(x) ist -- und genau das verbot die Blase um die Wüste Khôm.
//
// An ihre Stelle tritt der Test, um den es wirklich geht: die beiden Strecken AN DIESEM PUNKT dürfen
// weder eine andere Strecke derselben Linie noch eine der Nachbarlinien schneiden. Alles andere ist
// erlaubt -- auch zurücklaufen, auch senkrecht.
//
// Geprüft werden nur die beiden betroffenen Strecken, nicht die ganze Linie: alles andere hat sich
// nicht bewegt und war vorher gültig.
function climateVertexWouldCross(coordinates, pointIndex, candidate, neighbours) {
	const probe = coordinates.slice();
	probe[pointIndex] = candidate;

	const betroffen = [];
	if (pointIndex > 0) { betroffen.push([pointIndex - 1, pointIndex]); }
	if (pointIndex < probe.length - 1) { betroffen.push([pointIndex, pointIndex + 1]); }

	for (const [from, to] of betroffen) {
		// gegen die eigene Linie, ohne die anstossenden Strecken (die teilen naturgemäss einen Punkt)
		for (let index = 0; index < probe.length - 1; index += 1) {
			if (index >= from - 1 && index <= to) { continue; }
			if (climateSegmentsCross(probe[from], probe[to], probe[index], probe[index + 1])) {
				return true;
			}
		}
		// gegen die Nachbarlinien
		for (const nachbar of (neighbours || [])) {
			if (!Array.isArray(nachbar)) { continue; }
			for (let index = 0; index < nachbar.length - 1; index += 1) {
				if (climateSegmentsCross(probe[from], probe[to], nachbar[index], nachbar[index + 1])) {
					return true;
				}
			}
		}
	}

	return false;
}

// An welcher Stelle der Punktliste landet ein Klick?
//
// 🔴 Über den ABSTAND zur Strecke, nicht mehr über den x-Bereich: mit einem Überhang deckt derselbe x
// mehrere Strecken ab, und „die erste, deren Bereich passt" wäre dann geraten.
//
// 🔴 Immer mindestens 1 und höchstens length - 1: die beiden Randpunkte sind Pflicht, und ein Einfügen
// ausserhalb von ihnen schöbe einen aus seiner Ecke -- das Band darunter hörte dann vor dem Kartenrand
// auf und hinterliesse einen Streifen, der zu keiner Zone gehört.
function climateInsertionIndex(coordinates, x, y) {
	let beste = 1;
	let bester = Infinity;
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const [ax, ay] = coordinates[index];
		const [bx, by] = coordinates[index + 1];
		const dx = bx - ax, dy = by - ay;
		const laenge = dx * dx + dy * dy;
		const t = laenge === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / laenge));
		const abstand = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
		if (abstand < bester) {
			bester = abstand;
			beste = index + 1;
		}
	}
	return beste;
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

// 🔴 ZWEI Fragen, nicht eine (Owner 2026-08-03: „die labels auch im frontend anzeigen").
//
//   SICHTBAR   = Modus + gewählte Ebene. Dann werden die ZONENNAMEN gezeichnet -- sie sind die Auskunft
//                der Ebene, und ohne sie ist ein farbiges Band eine Farbe ohne Aussage.
//   BEARBEITBAR = zusätzlich IS_EDIT_MODE. Erst dann kommen Trennlinien und Griffe dazu.
//
// Die Trennung ist der ganze Punkt: im Frontend soll man die Zonen LESEN, nicht ihre Konstruktion
// sehen. Dieselbe Linie, an der auch die Konturen hängen (ecosystem-pane--editable im Layer-Switch).
function isClimateLayerVisible() {
	// 🪤 „Alle" ist ausdrücklich AUSGENOMMEN (Owner 2026-08-03). Dort nimmt sich die Klima-Ebene ganz
	// zurück -- 10 % Füllung, klickdurchlässig --, weil es in „Alle" um die Überlappungen der
	// gezeichneten Ebenen geht; sieben Zonennamen quer darüber wären dann Beiwerk.
	//
	// 💣 Ohne diese Zeile hinge es am GEMERKTEN Ebenenwert: „Alle" lässt ihn stehen, also wären die
	// Namen mal da und mal nicht, je nachdem was zuletzt gewählt war. Das ist kein Zustand, den man
	// erklären kann.
	if (typeof isEcosystemShowAllLayers === "function" && isEcosystemShowAllLayers()) {
		return false;
	}

	return typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive()
		&& typeof getActiveEcosystemLayerKind === "function" && getActiveEcosystemLayerKind() === "klima";
}

function isClimateEditorActive() {
	return isClimateLayerVisible() && typeof IS_EDIT_MODE !== "undefined" && Boolean(IS_EDIT_MODE);
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

// Wo sitzt der Name eines Bandes? An seiner WESTKANTE, mittig zwischen oberer und unterer Grenze.
//
// 🔴 Aus der FLÄCHE gerechnet, nicht aus den Trennlinien. Die Namen sollen auch im Frontend stehen, und
// dort gibt es die Trennlinien nicht: sie kommen vom Editor-Endpunkt. Die Bänder dagegen reisen im
// öffentlichen Flächen-Payload, mitsamt ihrem Regionsnamen -- also ist die Fläche die richtige Quelle.
//
// Die Rechnung ist exakt statt geschätzt: ein Band beginnt und endet auf dem Kartenrand, sein Ring hat
// bei x = 0 deshalb GENAU zwei Ecken (oben links und unten links). Deren Mitte ist die Bandmitte an der
// Westkante. Ein `bounds`-Mittelwert wäre bei einer schrägen Grenze daneben.
function climateAreaWestEdgeSpan(geometry) {
	const parts = geometry?.type === "MultiPolygon" ? geometry.coordinates : [geometry?.coordinates];
	let min = null;
	let max = null;
	(parts || []).forEach((polygon) => {
		(polygon?.[0] || []).forEach((position) => {
			if (Math.abs(Number(position?.[0]) - CLIMATE_MIN_XY) > 0.5) {
				return;
			}
			const y = Number(position[1]);
			if (!Number.isFinite(y)) {
				return;
			}
			min = min === null ? y : Math.min(min, y);
			max = max === null ? y : Math.max(max, y);
		});
	});
	return min === null ? null : { min, max };
}

// Der Zonenname am Westrand seines Bandes.
//
// 🔴 KEIN map_features-Label. Ein echtes Karten-Label bräuchte einen neuen Subtyp in der Allowlist,
// liefe durch die Kollisionsauflösung und stünde auf der normalen Karte -- wo eine „Tropische Zone"
// mit echter Geographie um Platz konkurrierte. Der Name gehört zur Ebene und verschwindet mit ihr.
function drawClimateZoneNames() {
	if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return;
	}
	const escape = typeof escapeHtml === "function" ? escapeHtml : ((value) => String(value));
	ecosystemLayers.forEach((layer) => {
		const area = layer?._ecosystemArea;
		if (!area || area.kind !== "klima") {
			return;
		}
		const span = climateAreaWestEdgeSpan(area.geometry);
		// Kein Rand getroffen (kann nur ein Fremdkörper in dieser Ebene sein) oder das Band ist zu
		// dünn: dann lieber kein Name als einer, der in die Nachbarzone ragt und sie mitbeschriftet.
		if (!span || span.max - span.min < CLIMATE_NAME_MIN_HEIGHT) {
			return;
		}
		const name = String(area.region_name || "").trim();
		if (name === "") {
			return;
		}
		const marker = L.marker([(span.min + span.max) / 2, CLIMATE_MIN_XY], {
			pane: "ecosystemPaneKlimaLines",
			interactive: false,
			keyboard: false,
			icon: L.divIcon({
				className: "ecosystem-climate-name",
				html: `<span>${escape(name)}</span>`,
				iconSize: null,
			}),
		}).addTo(map);
		climateNameLayers.push(marker);
	});
}

function drawClimateOverlay() {
	clearClimateOverlay();
	if (typeof map === "undefined" || !map || !isClimateLayerVisible()) {
		return;
	}

	// Die NAMEN immer, sobald die Ebene sichtbar ist -- auch ohne Editiermodus. Sie hängen an den
	// geladenen Flächen, nicht an den Trennlinien, und brauchen deshalb keinen Editor-Aufruf.
	drawClimateZoneNames();

	// Trennlinien und Griffe NUR im Editiermodus. Im Frontend soll man die Zonen lesen, nicht ihre
	// Konstruktion sehen -- dieselbe Linie, an der auch die Konturen hängen.
	if (!isClimateEditorActive() || !Array.isArray(climateDividers)) {
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
}

// ---- Gesten ----------------------------------------------------------------------------------------

// Die Nachbarlinien dieser Trennlinie, als Koordinatenlisten -- gegen die wird geprüft.
function climateNeighbourList(dividerIndex) {
	return [climateNeighbourCoordinates(dividerIndex, -1), climateNeighbourCoordinates(dividerIndex, 1)]
		.filter(Boolean);
}

// Wohin darf dieser Griff?
//
// 🔴 „Es stoppt" bleibt das Verhalten, nur die Bedingung ist eine andere: würde der neue Punkt eine
// Linie schneiden lassen, folgt der Griff einfach nicht und bleibt an seiner letzten gültigen Stelle.
// Der Editor merkt das als Widerstand -- genau wie vorher an der Nachbarlinie, nur ohne die Regel,
// dass x steigen muss.
function climateVertexTarget(dividerIndex, pointIndex, isEdge, latlng) {
	const coordinates = climateDividers[dividerIndex].geometry.coordinates;
	// Ein Randgriff behält sein x -- er ist am Kartenrand festgenagelt und darf nur senkrecht.
	const x = isEdge ? coordinates[pointIndex][0] : climateClampToMap(latlng.lng);
	const y = climateClampToMap(latlng.lat);
	const kandidat = [x, y];

	// 🪤 Der Mindestabstand am WESTRAND wird weiter eingehalten -- dort entscheidet sich, welche Linie
	// über welcher liegt (avesmapsClimateAssertOrder), und ein Randgriff, der die Nachbarin überholt,
	// kehrte die Reihenfolge um.
	if (pointIndex === 0) {
		const north = climateNeighbourCoordinates(dividerIndex, -1);
		const south = climateNeighbourCoordinates(dividerIndex, 1);
		const oben = north ? north[0][1] - CLIMATE_MIN_GAP : CLIMATE_MAX_XY;
		const unten = south ? south[0][1] + CLIMATE_MIN_GAP : CLIMATE_MIN_XY;
		kandidat[1] = Math.max(unten, Math.min(oben, kandidat[1]));
	}

	return climateVertexWouldCross(coordinates, pointIndex, kandidat, climateNeighbourList(dividerIndex))
		? coordinates[pointIndex]
		: kandidat;
}

function insertClimateVertex(dividerIndex, latlng) {
	const divider = climateDividers?.[dividerIndex];
	if (!divider || climateSaving) {
		return;
	}
	const coordinates = divider.geometry.coordinates;
	// Die nächstliegende Strecke, nicht der x-Bereich: mit einem Überhang deckt derselbe x mehrere
	// Strecken ab.
	const index = climateInsertionIndex(coordinates, latlng.lng, latlng.lat);
	coordinates.splice(index, 0, [climateClampToMap(latlng.lng), climateClampToMap(latlng.lat)]);
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
	if (!isClimateLayerVisible()) {
		clearClimateOverlay();
		return;
	}
	// 🪤 IMMER zuerst zeichnen, auch wenn gleich noch geladen wird. Die Namen hängen an den Flächen und
	// sind sofort da; sie auf die Antwort des Editor-Endpunkts warten zu lassen hiesse, sie im Frontend
	// gar nicht zu zeigen -- dort wird er nie gerufen.
	drawClimateOverlay();

	// Die Trennlinien braucht nur der Editiermodus, und nur dort wird der Endpunkt gerufen.
	if (isClimateEditorActive() && climateDividers === null && !climateLoading) {
		void loadClimateDividers().catch((error) => {
			console.warn("Klimazonen konnten nicht geladen werden:", error);
			climateDividers = null;
		});
	}
}

window.AvesmapsEcosystemClimate = { sync: syncEcosystemClimateEditor };

// Node-Export für die Einheitentests (Hausmuster, wie map-features-ecosystem-boolean.js). Im Browser
// existiert `module` nicht, dort bleiben die Funktionen schlicht global.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		climateSegmentsCross, climateVertexWouldCross, climateInsertionIndex,
		climateClampToMap, climateAreaWestEdgeSpan,
	};
}
