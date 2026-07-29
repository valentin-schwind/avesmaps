// Der Kringel vor dem Einrasten — für den TERRITORIEN-Editor (Owner 2026-07-29, nach dem
// Landschaften-Vertex-Snap `a71d2616`).
//
// 🔴 DER SNAP SELBST IST HIER NICHT NEU. `findNearestRegionSnapPoint` zieht eine losgelassene Ecke seit
// jeher auf die Ecke oder Kante eines fremden Gebiets, und Strg löst sie davon (die Laufzeit-Fassung in
// map-features-region-vertex-detach-edit.js:370 wählt den Snap nur, wenn NICHT detached wird). Was
// gefehlt hat, ist die Ankündigung: Man ließ los und die Ecke sprang irgendwohin. Diese Datei fügt genau
// das hinzu und fasst am Verhalten nichts an.
//
// ⚠️ Deshalb steht sie ALLEIN und nicht in einer der beiden Kopien von `refreshRegionEditHandles`
// (map-features-region-edit-handles.js und die zur Laufzeit injizierte Fassung, die gewinnt). Beide
// rufen dieselben zwei Funktionen; eine dritte Kopie derselben Zeichenlogik wäre genau die Dublette, an
// der dieses Modul schon einmal auseinandergelaufen ist.
//
// 💣 Die Vorschau ist `interactive: false` und liegt auf `measurementHandlesPane`. Klickbar wäre sie ein
// Deckel über dem Griff, den man gerade zieht.

// Wie im Landschafts-Editor: eine Ecke ist eine Entscheidung, ein Kantenpunkt nur die Linie dazwischen.
// Der Ring sagt, welches von beidem gleich passiert — durchgezogen und größer für eine Ecke,
// gestrichelt und kleiner für einen Kantenpunkt.
const REGION_EDIT_SNAP_PREVIEW_VERTEX_RADIUS = 11;
const REGION_EDIT_SNAP_PREVIEW_EDGE_RADIUS = 8;

function clearRegionEditSnapPreview() {
	const session = typeof activeRegionGeometryEdit !== "undefined" ? activeRegionGeometryEdit : null;
	const layer = session?.snapPreviewLayer;
	if (layer && typeof map !== "undefined" && map && map.hasLayer(layer)) {
		map.removeLayer(layer);
	}
	if (session) {
		session.snapPreviewLayer = null;
	}
}

// Wohin die Ecke beim Loslassen springen würde, samt Art. Bewusst über dieselben zwei Helfer, aus denen
// auch `findNearestRegionSnapPoint` besteht (Ecke zuerst, dann Kante) — die Vorschau kann so nicht
// etwas anderes anzeigen, als der Snap dann tut. Ein eigener Suchlauf wäre eine zweite Wahrheit.
function findRegionEditSnapPreviewTarget(latLng, ownRegion) {
	if (typeof findNearestRegionVertex === "function") {
		const vertex = findNearestRegionVertex(latLng, ownRegion);
		if (vertex) {
			return { latLng: vertex, kind: "vertex" };
		}
	}
	if (typeof findNearestRegionEdgePoint === "function") {
		const edgePoint = findNearestRegionEdgePoint(latLng, ownRegion);
		if (edgePoint) {
			return { latLng: edgePoint, kind: "edge" };
		}
	}

	return null;
}

// Wird aus dem `drag`-Handler beider Kopien gerufen. `isDetaching` = Strg hält die Ecke frei; dann darf
// auch kein Ring versprechen, dass sie einrastet.
function renderRegionEditSnapPreview(latLng, isDetaching) {
	const session = typeof activeRegionGeometryEdit !== "undefined" ? activeRegionGeometryEdit : null;
	if (!session || typeof map === "undefined" || !map) {
		return;
	}

	clearRegionEditSnapPreview();
	if (isDetaching || !latLng) {
		return;
	}

	const target = findRegionEditSnapPreviewTarget(latLng, session.regionEntry);
	if (!target) {
		return;
	}

	// Derselbe Ton wie die Griffe: das „wird gerade bearbeitet"-Blau, die dokumentierte Ausnahme der
	// Designsprache. Über das Token, damit Griffring und Kringel nicht auseinanderlaufen.
	const color = getComputedStyle(document.documentElement).getPropertyValue("--color-edit-handle").trim();
	session.snapPreviewLayer = L.circleMarker(target.latLng, {
		pane: "measurementHandlesPane",
		radius: target.kind === "vertex" ? REGION_EDIT_SNAP_PREVIEW_VERTEX_RADIUS : REGION_EDIT_SNAP_PREVIEW_EDGE_RADIUS,
		color,
		weight: 3,
		opacity: 0.95,
		fill: false,
		dashArray: target.kind === "vertex" ? null : "4 4",
		interactive: false,
	}).addTo(map);
}
