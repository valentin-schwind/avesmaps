// Landschaften (Erprobung) -- drawing an area click by click (plan V3.2).
//
// 🔴 THE MOST EXPENSIVE SINGLE DECISION OF THIS FEATURE. There is no drawing tool in this house:
// createRegionAt() drops a hexagon of radius 10 and saves it immediately. Tracing the Farindel that
// way means bending six corners into shape -- 3 to 5 minutes an area, 42 hours for 500. Click by
// click it is 1 to 2 minutes, so 17. Nothing else in this program moves a number like that.
//
// Behaviour: a click sets a point, the preview runs with the cursor, DOUBLE-CLICK or ENTER finishes,
// ESCAPE cancels. 🔴 Nothing is written until the finish -- that is what keeps "hexagon corpses" out
// of the data, and it is why cancelling is free.
//
// 💣 Two things the template (map-features-path-creation.js:58-104) does NOT provide:
//  1. The rubber band is new. That file has no mousemove handler at all; updatePendingPathCreationLine
//     (:36-56) only draws through the points ALREADY placed. The line that follows the cursor -- and,
//     from the second point on, the closing line back to the start -- is the part that makes drawing
//     bearable, and it had to be built.
//  2. The template is blue: #1452F7 hardcoded at :28 and :48. Copied literally that would walk a
//     foreign UI colour into this layer against AGENTS.md §12. The draft uses --color-marker-active,
//     the token the map already uses for "this is the thing being worked on".
//
// 💣 A double-click fires click, click, dblclick. Without a guard the finishing gesture adds two more
// corners, the second one a pixel off the first -- a spur on every single area. The second click is
// swallowed by position and time below, so the first one still places its corner and dblclick only
// finishes. map.doubleClickZoom is switched off for the duration as well, otherwise finishing also
// zooms the map in.
//
// ⚠️ V3.3 (vertex editor) must NOT open the editing handles straight from the finish: the second
// click of the finishing double-click would land on a handle that has only just appeared, and that
// template's double-click DELETES a corner and saves. Finishing and opening the editor stay decoupled.

const ECOSYSTEM_DRAW_DOUBLE_CLICK_MS = 350;
const ECOSYSTEM_DRAW_DOUBLE_CLICK_PIXELS = 6;

let ecosystemDrawActive = false;
let ecosystemDrawPoints = [];
let ecosystemDrawLine = null;
let ecosystemDrawRubberBand = null;
let ecosystemDrawVertices = null;
let ecosystemDrawLastClick = null;
let ecosystemDrawSaving = false;
// Held when the finish finds no active region: the dialog opens, and a successful create_region
// resumes the save instead of throwing the outline away.
let ecosystemPendingAreaRing = null;

function isEcosystemDrawing() {
	return ecosystemDrawActive;
}

function ecosystemDraftColor() {
	return getComputedStyle(document.documentElement).getPropertyValue("--color-marker-active").trim();
}

// ---- preview ---------------------------------------------------------------------------------------

function clearEcosystemDrawPreview() {
	[ecosystemDrawLine, ecosystemDrawRubberBand, ecosystemDrawVertices].forEach((layer) => {
		if (layer && map.hasLayer(layer)) {
			map.removeLayer(layer);
		}
	});
	ecosystemDrawLine = null;
	ecosystemDrawRubberBand = null;
	ecosystemDrawVertices = null;
}

function updateEcosystemDrawPreview(cursorLatLng) {
	clearEcosystemDrawPreview();
	if (ecosystemDrawPoints.length === 0) {
		return;
	}

	const color = ecosystemDraftColor();
	if (ecosystemDrawPoints.length >= 2) {
		ecosystemDrawLine = L.polyline(ecosystemDrawPoints, {
			pane: "measurementPane",
			color,
			weight: 3,
			opacity: 0.95,
			interactive: false,
			lineCap: "round",
			lineJoin: "round",
		}).addTo(map);
	}

	// The rubber band: cursor -> and, from the second corner on, back to the start, so the shape that
	// would be created is visible BEFORE the finish rather than after it.
	if (cursorLatLng) {
		const band = [ecosystemDrawPoints[ecosystemDrawPoints.length - 1], cursorLatLng];
		if (ecosystemDrawPoints.length >= 2) {
			band.push(ecosystemDrawPoints[0]);
		}
		ecosystemDrawRubberBand = L.polyline(band, {
			pane: "measurementPane",
			color,
			weight: 2,
			opacity: 0.75,
			dashArray: "6 6",
			interactive: false,
		}).addTo(map);
	}

	// The first corner is drawn larger: it is the one the closing line runs to, and on a busy map it
	// is otherwise impossible to tell which one it was.
	ecosystemDrawVertices = L.layerGroup(
		ecosystemDrawPoints.map((point, index) => L.circleMarker(point, {
			pane: "measurementHandlesPane",
			radius: index === 0 ? 6 : 4,
			color,
			weight: 2,
			fillColor: "#ffffff",
			fillOpacity: 0.9,
			interactive: false,
		}))
	).addTo(map);
}

// ---- the gesture -----------------------------------------------------------------------------------

function isEcosystemDrawEchoClick(event) {
	const now = (typeof performance !== "undefined" ? performance.now() : 0);
	const containerPoint = event?.containerPoint;
	const previous = ecosystemDrawLastClick;
	ecosystemDrawLastClick = { containerPoint, at: now };
	if (!previous || !previous.containerPoint || !containerPoint) {
		return false;
	}

	return (now - previous.at) < ECOSYSTEM_DRAW_DOUBLE_CLICK_MS
		&& previous.containerPoint.distanceTo(containerPoint) <= ECOSYSTEM_DRAW_DOUBLE_CLICK_PIXELS;
}

function handleEcosystemDrawClick(event) {
	if (!ecosystemDrawActive || isEcosystemDrawEchoClick(event)) {
		return;
	}
	ecosystemDrawPoints.push(event.latlng);
	updateEcosystemDrawPreview(event.latlng);
}

function handleEcosystemDrawMouseMove(event) {
	if (ecosystemDrawActive && ecosystemDrawPoints.length > 0) {
		updateEcosystemDrawPreview(event.latlng);
	}
}

function handleEcosystemDrawDoubleClick(event) {
	if (!ecosystemDrawActive) {
		return;
	}
	if (event?.originalEvent) {
		L.DomEvent.stop(event);
	}
	void finishEcosystemAreaDrawing();
}

function handleEcosystemDrawKeydown(event) {
	if (!ecosystemDrawActive) {
		return;
	}
	if (event.key === "Escape") {
		event.stopPropagation();
		cancelEcosystemAreaDrawing("Zeichnen abgebrochen — es wurde nichts gespeichert.");
		return;
	}
	if (event.key === "Enter") {
		event.preventDefault();
		event.stopPropagation();
		void finishEcosystemAreaDrawing();
	}
}

// `startLatLng` (V3.4): the map context menu's three "Neue ..." entries sit in the "Hier hinzufügen"
// submenu, so "hier" has to mean something -- the right-clicked point becomes the first corner. Called
// without it (the "Fläche zeichnen" button) the tool starts empty exactly as before.
function startEcosystemAreaDrawing({ startLatLng = null } = {}) {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive() || ecosystemDrawActive) {
		return;
	}

	// V3.3: handles and drawing are never open at once -- a handle sits between the cursor and the map,
	// and a click on one would swallow the corner instead of placing it. Closed WITH a flush, so the last
	// dragged corner is written rather than dropped.
	if (typeof closeEcosystemGeometryEdit === "function") {
		closeEcosystemGeometryEdit({ flush: true });
		setSelectedEcosystemArea?.("");
	}

	ecosystemDrawActive = true;
	ecosystemDrawPoints = [];
	ecosystemDrawLastClick = null;
	map.doubleClickZoom.disable();
	map.getContainer().classList.add("ecosystem-draw-cursor");
	// Everything else on the map stays visible but stops taking clicks -- otherwise a click meant as a
	// corner lands on the river it crosses and never reaches map.on("click"). Same rule the vertex
	// editor uses; the CSS lives in ecosystem-layer.css.
	syncEcosystemMapEditingClass?.();
	map.on("click", handleEcosystemDrawClick);
	map.on("mousemove", handleEcosystemDrawMouseMove);
	map.on("dblclick", handleEcosystemDrawDoubleClick);
	document.addEventListener("keydown", handleEcosystemDrawKeydown, true);
	syncEcosystemDrawButton();
	// The seeded corner is set AFTER the handlers are live, so the preview is drawn by the same code path
	// a clicked corner uses -- and it is not run through the echo-click filter, because it is not a click:
	// the next real click has to count even if it lands on the same spot within 350 ms.
	if (startLatLng) {
		ecosystemDrawPoints.push(L.latLng(startLatLng));
		updateEcosystemDrawPreview(null);
	}
	showFeedbackToast?.("Klicken setzt Punkte. Doppelklick oder Enter schließt ab, Escape bricht ab.");
}

function stopEcosystemAreaDrawing() {
	ecosystemDrawActive = false;
	ecosystemDrawPoints = [];
	ecosystemDrawLastClick = null;
	clearEcosystemDrawPreview();
	if (typeof map !== "undefined" && map) {
		// 💣 NICHT stumpf enable(). Ein abgeschlossenes Zeichnen bleibt in der Landschaften-Ebene, und
		// dort zoomt kein Doppelklick -- sonst wäre der Zoom ausgerechnet nach der Geste wieder scharf,
		// die aus einem Doppelklick besteht. Die eine zuständige Stelle entscheidet
		// (map-features-ecosystem-rendering.js).
		syncEcosystemDoubleClickZoom?.();
		map.getContainer().classList.remove("ecosystem-draw-cursor");
		syncEcosystemMapEditingClass?.();
		map.off("click", handleEcosystemDrawClick);
		map.off("mousemove", handleEcosystemDrawMouseMove);
		map.off("dblclick", handleEcosystemDrawDoubleClick);
	}
	document.removeEventListener("keydown", handleEcosystemDrawKeydown, true);
	syncEcosystemDrawButton();
}

function cancelEcosystemAreaDrawing(message) {
	if (!ecosystemDrawActive) {
		return;
	}
	stopEcosystemAreaDrawing();
	ecosystemPendingAreaRing = null;
	if (message) {
		showFeedbackToast?.(message);
	}
}

async function finishEcosystemAreaDrawing() {
	if (!ecosystemDrawActive) {
		return;
	}

	// GeoJSON [x, y] -- L.CRS.Simple maps lat->y and lng->x, so the swap happens here and only here.
	const ring = normalizeEcosystemDrawnRing(ecosystemDrawPoints.map((point) => [point.lng, point.lat]));
	if (!ring) {
		showFeedbackToast?.("Eine Fläche braucht mindestens drei Punkte.", "warning");
		return;
	}

	stopEcosystemAreaDrawing();
	await saveEcosystemAreaRing(ring);
}

// ---- saving ----------------------------------------------------------------------------------------

// 🔴 JEDE GEZEICHNETE FLÄCHE BEKOMMT IHRE EIGENE REGION (Owner 2026-07-27). Vorher entschied das ein
// Wähler „Aktive Region" über der Karte -- und wer ihn übersah, hängte seinen neuen Wald an „Blautann"
// und bekam ihn nicht wieder los: der Name sitzt auf der Region, ein Umbenennen traf alle ihre Flächen.
// Der Wähler ist deshalb weg, und die Identität wird NACH dem Zeichnen gesetzt, im Eigenschaften-Dialog.
// Dasselbe Muster wie bei Territorien und Siedlungen: erst die Geometrie, dann der Steckbrief.
//
// Die frische Region trägt den Auto-Namen und noch keine Art. Sobald im Dialog eine Art gewählt wird,
// zieht der Auto-Name nach (`Fläche-001` wird zu `Wald-005`) -- das kann er schon, und genau dafür.
async function saveEcosystemAreaRing(ring) {
	if (ecosystemDrawSaving) {
		return;
	}

	const kind = typeof getActiveEcosystemLayerKind === "function" ? getActiveEcosystemLayerKind() : "";
	if (!kind) {
		showFeedbackToast?.("Die Landschaften-Ebene ist nicht bereit.", "warning");
		return;
	}

	// A self-crossing outline is repaired before it is sent; without the library or on a shape
	// polygon-clipping cannot handle, the drawn geometry goes as it is and the server validates.
	const geometry = repairEcosystemGeometry({ type: "Polygon", coordinates: [ring] });

	ecosystemDrawSaving = true;
	const name = ecosystemDraftRegionName();
	try {
		const region = await postEcosystemEdit("create_region", {
			kind,
			name,
			region_type: "",
		});
		const regionPublicId = String(region?.region?.public_id || "");
		if (!regionPublicId) {
			throw new Error("Die Region konnte nicht angelegt werden.");
		}
		const created = await postEcosystemEdit("create_area", {
			region_public_id: regionPublicId,
			geometry_geojson: geometry,
		});
		ecosystemPendingAreaRing = null;
		// 🔴 JEDE Region bekommt automatisch ihr Karten-Label (Owner 2026-07-27) -- am Point of
		// Inaccessibility, mit denselben Eigenschaften wie jedes andere Label.
		//
		// GEZEICHNET wird es von Anfang an, auf allen drei Ebenen (Owner 2026-07-28). Erst war es nur bei
		// der derographischen sichtbar, aus Sorge um ein volles Kartenbild -- die Sorge war unbegruendet,
		// weil das Zoom-Band die Menge ohnehin regelt. Der Haken „Regionname anzeigen" im Dialog schaltet
		// es wieder aus, ohne dass etwas verloren geht.
		// Art ist beim Zeichnen noch leer -- das Label startet als „region" und zieht nach, sobald im
		// Dialog eine Art gewählt wird.
		await createEcosystemRegionLabel(regionPublicId, geometry, name, true, "");

		// 💣 ERST das Label, DANN die Flaechen laden -- diese Reihenfolge ist der ganze Punkt.
		// Umgekehrt (bis 2026-07-28) baute der Reload die Flaechenzeile, bevor createEcosystemRegionLabel
		// den label_public_id der Region gesetzt hatte. Der Dialog oeffnete danach auf einem LEEREN Zeiger:
		// Haken "Regionname anzeigen" aus, Nodix gesperrt -- und beim Speichern legte er ein ZWEITES Label
		// an, weil ohne Zeiger kein Label zu finden war. Genau so entstanden die Dubletten.
		//
		// Ueber den normalen Lesepfad gerendert, nie aus der Antwort: ein Weg auf die Karte, damit eine
		// gezeichnete und eine nachgeladene Flaeche nie verschieden aussehen. Abgewartet, weil der
		// Eigenschaften-Dialog die Flaeche aus der Registry liest, die dieser Reload fuellt.
		if (typeof loadEcosystemAreas === "function") {
			await loadEcosystemAreas();
		}
		if (typeof invalidateEcosystemRegionCache === "function") {
			invalidateEcosystemRegionCache();
		}

		const areaPublicId = String(created?.area?.public_id || "");
		if (areaPublicId && window.AvesmapsEcosystemProperties?.open) {
			void window.AvesmapsEcosystemProperties.open(areaPublicId);
		} else {
			showFeedbackToast?.("Fläche gespeichert.");
		}
	} catch (error) {
		// Der Umriss bleibt erhalten -- nach einem Fehlschlag soll niemand neu zeichnen müssen.
		ecosystemPendingAreaRing = ring;
		showFeedbackToast?.(error?.message || "Die Fläche konnte nicht gespeichert werden.", "warning");
	} finally {
		ecosystemDrawSaving = false;
	}
}

// ---- das Karten-Label einer derographischen Region -------------------------------------------------
// 🔴 Eine derographische Region IST auch eine Beschriftung auf der Karte (Owner 2026-07-27). Das Label
// ist eine gewöhnliche `map_features`-Zeile -- dieselbe, die der Label-Editor bearbeitet -- und trägt
// damit Größe, Rotation, Zoom-Bänder, Priorität und Nodix ohne eine einzige neue Spalte. Verbunden
// wird über `ecosystem_region.label_public_id`; die Spalte gibt es seit V2.1 und hatte bis heute
// KEINEN einzigen Leser im Client.
//
// Anker ist der **Point of Inaccessibility**: der Punkt mit dem grössten Abstand zu allen Kanten, bei
// einem Multipolygon im grössten Teil. `avesmapsComputeLabelPoint` ist der projekteigene
// polylabel-Wrapper aus js/third-party/ -- die Drittanbieter-Datei, nicht das politische Modul, das
// ihn ebenfalls benutzt (Hauptplan, Regel 1).
//
// 🪤 Schlägt das Label fehl, bleibt die FLÄCHE trotzdem stehen. Sie ist das, was gezeichnet wurde;
// eine fehlende Beschriftung ist ärgerlich, eine verlorene Geometrie wäre der Verlust.
// 🔴 DIE DARSTELLUNG IST NICHT ERFUNDEN, SONDERN AM BESTAND GEMESSEN (Owner 2026-07-27): 588 Labels
// live, Median je Subtyp. Zwei Dinge gelten dort AUSNAHMSLOS -- Priorität 3 und Zoom-Band bis 7 --,
// die übrigen zwei folgen der Grösse des Dings: was gross ist (Insel, Gebirge, Meer) steht ab Zoom 2
// und in 20 pt, was klein ist (Wald, See, Gipfel) ab Zoom 4 und in 15/16.
//
// 💣 Die erste Fassung hatte 18 / 0–5 / 3 fest verdrahtet. Das Band war in BEIDE Richtungen falsch:
// bis 5 wäre das Label ab Zoom 6 verschwunden, ab 0 hätte es schon in der Kontinentansicht gestanden.
// Kein einziges vorhandenes Label macht das.
const ECOSYSTEM_LABEL_STYLE_BY_TYPE = {
	insel: { size: 20, minZoom: 2 },
	gebirge: { size: 20, minZoom: 2 },
	meer: { size: 20, minZoom: 2 },
	tal: { size: 18, minZoom: 2 },
	steppe: { size: 18, minZoom: 2 },
	suempfe_moore: { size: 17, minZoom: 3 },
	see: { size: 16, minZoom: 4 },
	wald: { size: 15, minZoom: 4 },
	berggipfel: { size: 15, minZoom: 4 },
};
const ECOSYSTEM_LABEL_STYLE_DEFAULT = { size: 18, minZoom: 2 };   // wie „region", der häufigste Subtyp

function ecosystemLabelStyleFor(regionType) {
	return ECOSYSTEM_LABEL_STYLE_BY_TYPE[String(regionType || "")] || ECOSYSTEM_LABEL_STYLE_DEFAULT;
}

// 🔴 Die Wiki-Landschaft der REGION reist ans Label mit (Owner 2026-07-28). Ein Label, das aus dem
// Regionsdialog entsteht, beschreibt dieselbe Landschaft wie seine Region -- es dort noch einmal von
// Hand zuweisen zu müssen, wäre dieselbe Angabe zweimal, und zwei Angaben driften auseinander.
//
// Die Region speichert nur `wiki_region_key` + `wiki_url`; das Label will den vollen Schnappschuss
// (Name, Art, Beschreibung, Bild — daraus lebt seine Infobox). Also dieselbe Quelle anzapfen, aus der
// der „Sync"-Knopf im Label-Editor schöpft, statt eine zweite Wahrheit zu bauen.
//
// 🪤 Schlägt der Abruf fehl, wird trotzdem verknüpft — nur mager. Der SCHLÜSSEL ist die Verbindung;
// alles andere holt „Sync" nach. Gar nicht zu verknüpfen wäre der schlechtere Ausgang.
async function ecosystemWikiRegionSnapshot(wikiKey, fallbackUrl) {
	const key = String(wikiKey || "").trim();
	if (key === "") {
		return null;
	}
	try {
		const response = await fetch(
			`/api/edit/wiki/regions.php?action=staging_sample&wiki_keys=${encodeURIComponent(key)}&limit=1`,
			{ credentials: "same-origin" }
		);
		const data = await response.json();
		const row = (data.rows || [])[0];
		if (row && typeof labelWikiRegionFromRow === "function") {
			return labelWikiRegionFromRow(row);
		}
	} catch (error) {
		console.warn("Wiki-Schnappschuss für das Region-Label nicht ladbar:", error);
	}

	return { wiki_key: key, wiki_url: String(fallbackUrl || "") };
}

async function createEcosystemRegionLabel(regionPublicId, geometry, text, showName, regionType, wikiRegion = null) {
	if (typeof avesmapsComputeLabelPoint !== "function" || typeof submitMapFeatureEdit !== "function") {
		return;
	}
	const point = avesmapsComputeLabelPoint(geometry);
	if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		showFeedbackToast?.("Für diese Form liess sich kein Beschriftungspunkt bestimmen.", "warning");
		return;
	}

	try {
		// GeoJSON [x, y] -> Leaflet [lat, lng] = [y, x]. Bewusst gedreht (AGENTS.md §5).
		// Der Subtyp des Labels IST die Art der Region -- `wald` ist beides, und der V5-Import hat die
		// beiden Vokabulare schon gleichgesetzt. Ohne Art (frisch gezeichnet) fällt es auf „region".
		const subtype = String(regionType || "") || "region";
		const style = ecosystemLabelStyleFor(subtype);
		const result = await submitMapFeatureEdit({
			action: "create_label",
			text: String(text || ""),
			feature_subtype: subtype,
			size: style.size,
			rotation: 0,
			min_zoom: style.minZoom,
			max_zoom: 7,
			priority: 3,
			show_name: Boolean(showName),
			// Nur mitschicken, wenn die Region wirklich eine Wiki-Landschaft traegt -- ein leer
			// mitgesendetes wiki_region wuerde am Label eine bestehende Zuweisung loeschen.
			...(wikiRegion ? { wiki_region: wikiRegion } : {}),
			// Der Rueckzeiger von Anfang an: eine Flaeche darf mehrere Labels tragen, und ab hier weiss
			// jedes selbst, zu welcher es gehoert. Der Zeiger an der Region bezeichnet daneben weiterhin
			// das PRIMAERE -- das, welches der Regionsdialog verwaltet.
			ecosystem_region_public_id: String(regionPublicId || ""),
			lat: point.y,
			lng: point.x,
		});
		const labelPublicId = String(result?.feature?.properties?.public_id || result?.feature?.public_id || "");
		if (!labelPublicId) {
			return;
		}
		// 💣 Der Server laesst eine Region hoechstens EIN lebendes Label tragen. Weist er hier ab, waere das
		// eben angelegte eine Waise: sichtbar auf der Karte, von keiner Region gekannt, von keinem Dialog
		// erreichbar. Also wieder wegnehmen -- lieber gar kein Label als eines, das niemandem gehoert.
		try {
			await postEcosystemEdit("update_region", { public_id: regionPublicId, label_public_id: labelPublicId });
		} catch (pointerError) {
			try {
				await submitMapFeatureEdit({ action: "delete_feature", public_id: labelPublicId });
			} catch (rollbackError) {
				console.warn("Das ueberzaehlige Label liess sich nicht zuruecknehmen:", rollbackError);
			}
			throw pointerError;
		}
		if (typeof addCreatedLabelFeature === "function") {
			addCreatedLabelFeature(result.feature);
		}
		if (typeof updateRevisionFromEditResponse === "function") {
			updateRevisionFromEditResponse(result);
		}
	} catch (error) {
		console.warn("Das Label der Region konnte nicht angelegt werden:", error);
		// Den Grund des Servers durchreichen, wo er einen nennt -- "traegt bereits ein Label" ist eine
		// Auskunft, mit der ein Editor etwas anfangen kann, "ging nicht" ist keine.
		showFeedbackToast?.(
			error?.message || "Die Fläche steht, aber ihr Label konnte nicht angelegt werden.",
			"warning"
		);
	}
}

// Der Arbeitsname der frischen Region. Ohne Art greift der Rückfall („Fläche-001"); die Art kommt im
// Dialog, und der Haken zieht den Namen dann nach.
function ecosystemDraftRegionName() {
	if (typeof nextEcosystemRegionAutoName !== "function") {
		return "Neue Fläche";
	}
	const namen = typeof ecosystemRegionsByKind !== "undefined" && ecosystemRegionsByKind
		? Object.values(ecosystemRegionsByKind).filter(Array.isArray).flat().map((r) => String(r?.name || ""))
		: [];
	return nextEcosystemRegionAutoName("", namen);
}

// Ein nach einem Fehlschlag gehaltener Umriss wird beim nächsten Versuch weitergereicht.
function resumePendingEcosystemAreaSave() {
	if (!ecosystemPendingAreaRing) {
		return;
	}
	const ring = ecosystemPendingAreaRing;
	ecosystemPendingAreaRing = null;
	void saveEcosystemAreaRing(ring);
}

// ---- der Knopf, den es nicht mehr gibt --------------------------------------------------------------
// „Fläche zeichnen" ist am 2026-07-27 aus der Leiste geflogen; gezeichnet wird über Rechtsklick ->
// „Neue Vegetation" usw. Die Funktion bleibt als NO-OP stehen, weil das Zeichenwerkzeug sie an sechs
// Stellen ruft (Start, Abbruch, Abschluss, Punkt gesetzt ...) und sechs Wächter mehr die Datei nur
// unruhiger machen würden als eine leere Zeile.
function syncEcosystemDrawButton() {
	/* absichtlich leer -- siehe oben */
}
