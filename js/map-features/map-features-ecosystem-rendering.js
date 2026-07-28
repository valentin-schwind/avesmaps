// Landschaften (Erprobung) -- turning one area row from GET /api/app/ecosystem-areas.php into a
// Leaflet layer (plan V3.0, step 4). Nothing here fetches, schedules or owns the registry; the loader
// (map-features-ecosystem-loader.js) does that and hands single rows in here.
//
// 🔴 COORDINATE ORDER. The wire format is GeoJSON: positions are [x, y] and the API returns exactly
// what was POSTed (api/_internal/app/ecosystem.php header). Leaflet's L.CRS.Simple wants
// [lat, lng] = [y, x] (AGENTS.md §5) -- so the swap happens HERE, in the client, and nowhere else.
//
// 🔴 NO HARDCODED COLOURS (AGENTS.md §12). The three kind tones are tokens in css/base/tokens.css and
// are read back out of the computed style, the same way the location canvas layer reads
// --color-marker-active (map-features-location-canvas-layer.js:27). A literal here would be the
// fourth place the same brown is written down.

// Display order of the segment switch AND the pane stack, low to high: the derographic containers
// (continents, islands) sit at the bottom, topography on top. German values on purpose -- they are
// domain vocabulary like PATH_SUBTYPE_KEYS, not translatable words (AGENTS.md §2, plan "Namensgebung").
const ECOSYSTEM_KINDS = ["derographisch", "vegetation", "topographie"];

const ECOSYSTEM_KIND_LABELS = {
	derographisch: "Derographische Region",
	vegetation: "Vegetation",
	topographie: "Topographie",
};

// Die Ebene als BESTIMMUNGSWORT, für zusammengesetzte Titel: „Vegetations-Fläche bearbeiten",
// „Derographie-Label bearbeiten". Eigene Tabelle statt einer Ableitung aus ECOSYSTEM_KIND_LABELS --
// die trägt die Ebene als Substantiv („Derographische Region"), und „Derographische Region-Label"
// wäre kein Deutsch. Die Wörter sind die des Owners (2026-07-28), nicht gebeugte Varianten davon.
const ECOSYSTEM_KIND_PREFIX = {
	derographisch: "Derographie",
	vegetation: "Vegetations",
	topographie: "Topographie",
};

// Der Titel eines Bearbeitungsfensters. `subject` ist "flaeche" oder "label".
//
// 🪤 Ohne Ebene bleibt es beim allgemeinen Titel: ein Kontinent, ein Meer oder ein freier Kartentitel
// gehört zu keiner Landschaftsebene, und „Vegetations-Label bearbeiten" darüberzuschreiben wäre eine
// Zuordnung, die es nicht gibt. Dasselbe gilt, solange die Zugehörigkeit noch nicht aufgelöst ist --
// deshalb wird der Titel zweistufig gesetzt (erst neutral, dann verfeinert).
function ecosystemDialogTitle(kind, subject) {
	const noun = String(subject) === "label" ? "Label" : "Fläche";
	const prefix = ECOSYSTEM_KIND_PREFIX[String(kind || "")] || "";

	return prefix === "" ? `${noun} bearbeiten` : `${prefix}-${noun} bearbeiten`;
}

const ECOSYSTEM_KIND_PANES = {
	derographisch: "ecosystemPaneDerographisch",
	vegetation: "ecosystemPaneVegetation",
	topographie: "ecosystemPaneTopographie",
};

const ECOSYSTEM_KIND_COLOR_TOKENS = {
	derographisch: "--color-ecosystem-derographisch",
	vegetation: "--color-ecosystem-vegetation",
	topographie: "--color-ecosystem-topographie",
};

// The public_id of the area the editor last clicked, or "" for none. Only an area in the ACTIVE pane
// can ever get here -- the resting panes do not take pointer events at all (see the CSS).
let selectedEcosystemAreaPublicId = "";

function isKnownEcosystemKind(kind) {
	return ECOSYSTEM_KINDS.includes(String(kind || ""));
}

function readEcosystemColorToken(token) {
	return token ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() : "";
}

// The tone of one area. Vegetation carries a tone per region_type -- Wald green, Wüste sand, Sümpfe
// murky (Owner 2026-07-26) -- because it is the layer that draws real ground cover; the other two draw
// containers and relief and get one colour each.
//
// The type token is derived BY RULE from the type_key, so a newly seeded type needs a token in
// tokens.css and nothing else: there is no type list in this file that could fall behind
// ecosystem_region_type. A type without a token, or a region without a type, falls back to the layer's
// base tone.
function ecosystemAreaColor(kind, regionType) {
	// One rule for every layer, not a special case for vegetation: topography draws relief AND water,
	// which no map has ever painted in one colour, and derographic containers may want the same
	// treatment tomorrow. A type without a token falls through to the layer's base tone, so adding a
	// tone is adding a token -- there is no type list in this file that could fall behind
	// ecosystem_region_type.
	if (kind && regionType) {
		const typeColor = readEcosystemColorToken(`--color-ecosystem-${kind}-${String(regionType).replace(/_/g, "-")}`);
		if (typeColor) {
			return typeColor;
		}
	}

	return readEcosystemColorToken(ECOSYSTEM_KIND_COLOR_TOKENS[kind]);
}

// GeoJSON Polygon | MultiPolygon -> Leaflet latlngs, [x, y] -> [y, x]. A Polygon becomes a
// single-part MultiPolygon so both shapes take one code path (the server normalizes the same way).
function ecosystemAreaLatLngs(geometry) {
	const type = String(geometry?.type || "");
	const coordinates = geometry?.coordinates;
	if (!Array.isArray(coordinates) || coordinates.length === 0) {
		return null;
	}

	const parts = type === "Polygon" ? [coordinates] : (type === "MultiPolygon" ? coordinates : null);
	if (!parts) {
		return null;
	}

	const latlngs = parts.map((part) => (Array.isArray(part) ? part : []).map(
		(ring) => (Array.isArray(ring) ? ring : []).map(([x, y]) => [Number(y), Number(x)])
	));

	// A ring that lost its numbers somewhere would render as NaN and silently take the whole pane's
	// SVG with it -- refuse the row instead (the same guard the route pan learned the hard way).
	const hasBrokenPosition = latlngs.some((part) => part.some(
		(ring) => ring.length < 3 || ring.some(([lat, lng]) => !Number.isFinite(lat) || !Number.isFinite(lng))
	));

	return hasBrokenPosition ? null : latlngs;
}

// 🔴 COLOUR ONLY. fill-opacity and stroke-opacity belong to the matrix in css/features/ecosystem-layer.css
// and are deliberately NOT passed here: they depend on the pane's state (resting / active / selected),
// and a second set of numbers in JS would have to be kept in step with that table forever. Leaflet writes
// its style as SVG presentation ATTRIBUTES, which CSS outranks, so the stylesheet wins cleanly.
// The contour of an area. Derographic and topographic areas carry their own, markedly darker line
// (Owner 2026-07-26) -- a wash at 30% opacity does not tell you where the boundary runs, and those two
// are the layers whose edges you trace against the terrain. Vegetation has no contour token: its tone
// already varies per region_type, so its contour follows that tone. A missing token means "use the
// fill", which is why this is one lookup and not a second colour table.
function ecosystemAreaContourColor(kind, regionType) {
	return readEcosystemColorToken(`--color-ecosystem-${kind}-contour`) || ecosystemAreaColor(kind, regionType);
}

// Läuft gerade irgendeine Bearbeitung? Eine Frage, mehrere Werkzeuge -- Zeichnen, Pinsel/Radiergummi,
// der Ecken-Editor und die Gesten aus dem Kontextmenü (verschieben, zerschneiden, boolesch).
function isEcosystemEditingInProgress() {
	if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
		return true;
	}
	if (window.AvesmapsEcosystemBrush?.isActive?.()) {
		return true;
	}
	if (typeof activeEcosystemGeometryEdit !== "undefined" && activeEcosystemGeometryEdit) {
		return true;
	}
	if (window.AvesmapsEcosystemGeometryOps?.isPending?.()) {
		return true;
	}

	return false;
}

function ecosystemAreaStyle(kind, regionType) {
	return {
		color: ecosystemAreaContourColor(kind, regionType),
		fillColor: ecosystemAreaColor(kind, regionType),
		weight: 2,
	};
}

// Selection is a class on the path, not a style: the matrix in the stylesheet turns it into the
// stronger fill and the full contour. Re-applied after every (re)build, because a rebuilt layer gets a
// fresh <path> element.
function applyEcosystemSelectionClass(layer) {
	const element = typeof layer?.getElement === "function" ? layer.getElement() : null;
	if (!element) {
		return;
	}
	element.classList.toggle("ecosystem-area--selected", layer._ecosystemArea?.public_id === selectedEcosystemAreaPublicId);
}

// 🔴 DIE ART STEHT HIER MIT IHRER BEZEICHNUNG, NICHT MIT IHREM SCHLÜSSEL (Owner 2026-07-28). Bis heute
// stand `region_type` im Zettel -- das ist ein Verbindungsschlüssel (`wald`, `suempfe_moore`) und
// kleingeschrieben, weil Schlüssel so aussehen. Im Zettel las sich das wie ein Tippfehler. Die
// lesbare Form kommt aus `ecosystem_region_type.label` und reist seit heute als `region_type_label`
// im Lesepfad mit (api/_internal/app/ecosystem.php). Fehlt sie, bleibt der Schlüssel stehen -- besser
// ein Schlüssel als ein leerer Zettel.
//
// 🔴 DIE ZAHLEN KOMMEN VOM SERVER. Die geladenen Ebenen halten nur, was im Ausschnitt liegt (der
// Endpunkt filtert nach bbox); daraus gezählt hiesse der Zettel „Flächen im Bild" und änderte seine
// Aussage beim Verschieben der Karte. Dieselbe Lehre steht an der Trägerzeile im Label-Dialog.
//
// Der Zusatz „· Erprobung" ist am 2026-07-28 entfallen (Owner: „das Erprobungs-Kennzeichen kann
// insgesamt raus — die brauchen wir weder in den Flächen noch im Derographiemenü"). Die Spalte
// `is_trial` bleibt vorerst in der Datenbank; sie wird hier nur nicht mehr angezeigt.
function formatEcosystemAreaTooltip(area) {
	const regionName = String(area?.region_name || "").trim() || "Ohne Namen";
	const kindLabel = ECOSYSTEM_KIND_LABELS[area?.kind] || String(area?.kind || "");
	const typeLabel = String(area?.region_type_label || area?.region_type || "").trim();
	const areaCount = Number(area?.region_area_count) || 0;
	const labelCount = Number(area?.region_label_count) || 0;

	return `${regionName} (${typeLabel ? `${typeLabel}, ` : ""}${kindLabel}) · Flächen (${areaCount}) und Labels (${labelCount})`;
}

// ---- Stapelreihenfolge (Owner 2026-07-28, Punkt 9) --------------------------------------------------
//
// 🔴 GROSS UNTEN, KLEIN OBEN. Derographische Regionen verschachteln sich: Kontinent ⊃ Insel ⊃ Provinz.
// Alle Flächen einer Ebene liegen in EINER SVG-Gruppe, und dort gewinnt, wer zuletzt gezeichnet wurde --
// also die Ladereihenfolge. Eine grosse Fläche, die zufällig nach ihrer kleinen kam, deckte diese
// vollständig zu UND nahm ihren Klick. Nach Flächeninhalt gestapelt liegt die enthaltene Fläche immer
// obenauf und ist immer erreichbar.
//
// 🪤 STABIL bei Gleichstand. Zwei gleich grosse Flächen behalten ihre Eingangsreihenfolge -- sonst
// würfelte jedes Nachladen die Stapelung neu, und ein Klick träfe beim zweiten Mal etwas anderes.
// Array.prototype.sort IST seit ES2019 stabil; der Index-Vergleich macht es unabhängig davon explizit.
//
// Rein und ohne Leaflet, damit die Regel prüfbar ist: der Aufrufer holt die Flächen in dieser
// Reihenfolge nach vorn (bringToFront), womit die kleinste zuletzt und damit ganz oben landet.
function ecosystemStackingOrder(areas) {
	const list = Array.isArray(areas) ? areas : [];
	const measured = list.map((area, index) => ({
		publicId: String(area?.public_id || ""),
		index,
		// Eine Fläche ohne brauchbare Geometrie zählt als 0 und landet damit ganz oben -- oben ist der
		// ungefährliche Platz: sie verdeckt nichts, sie ist nur selbst erreichbar.
		size: typeof ecosystemGeometryArea === "function" ? (Number(ecosystemGeometryArea(area?.geometry)) || 0) : 0,
	})).filter((entry) => entry.publicId !== "");

	measured.sort((left, right) => (right.size - left.size) || (left.index - right.index));

	return measured.map((entry) => entry.publicId);
}

// Die berechnete Reihenfolge auf die Karte anwenden. Getrennt von der Regel, weil hier Leaflet ins
// Spiel kommt und die Regel ohne Karte testbar bleiben soll.
function applyEcosystemStackingOrder() {
	if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return;
	}
	const areas = [];
	ecosystemLayers.forEach((layer) => {
		if (layer?._ecosystemArea) {
			areas.push(layer._ecosystemArea);
		}
	});
	// Je Ebene getrennt: die drei Panes sind ohnehin gestapelt (derographisch unten, Topographie oben),
	// und eine gemeinsame Sortierung über alle drei würde nur innerhalb jeder Pane wirken -- aber die
	// Reihenfolge dazwischen unnötig durcheinanderbringen.
	ECOSYSTEM_KINDS.forEach((kind) => {
		ecosystemStackingOrder(areas.filter((area) => String(area?.kind || "") === kind)).forEach((publicId) => {
			ecosystemLayers.get(publicId)?.bringToFront?.();
		});
	});
}

// Selecting is what proves "only the active layer answers" (plan V3.0, step 7). It is deliberately
// the whole of the interaction in V3.0 -- the vertex editor is V3.3 and the context menu is V3.4.
function setSelectedEcosystemArea(publicId) {
	const nextId = String(publicId || "");
	if (nextId === selectedEcosystemAreaPublicId) {
		return;
	}

	const previousId = selectedEcosystemAreaPublicId;
	selectedEcosystemAreaPublicId = nextId;
	[previousId, nextId].forEach((id) => {
		const layer = id && ecosystemLayers instanceof Map ? ecosystemLayers.get(id) : null;
		if (layer) {
			applyEcosystemSelectionClass(layer);
		}
	});

	// V3.3: the selection IS the vertex-edit session -- a selected area grows handles, a deselected one
	// loses them and flushes whatever is still pending. Routing it through here means switching the
	// layer, leaving the mode and clearing the registry all close an open edit without any of them
	// having to know the editor exists. Guarded, so V3.0's behaviour survives the file being absent.
	if (typeof syncEcosystemGeometryEdit === "function") {
		syncEcosystemGeometryEdit();
	}
	syncEcosystemDoubleClickZoom();
}

// 🔴 IN DER LANDSCHAFTEN-EBENE ZOOMT EIN DOPPELKLICK ÜBERHAUPT NICHT (Owner 2026-07-27).
//
// Zuerst hing das an drei Zuständen -- ausgewählt, in Bearbeitung, im Zeichnen. Das war zu fein
// gedacht: der Doppelklick ist in dieser Ebene eine ARBEITSGESTE und sonst nichts. Er schliesst eine
// Zeichnung ab, öffnet den Ecken-Editor, löscht eine Ecke, beendet eine Sitzung. Jeder Doppelklick,
// der keine davon trifft, ist ein Verklicken -- und die Antwort darauf war ein Zoomsprung, der die
// Karte unter der Arbeit wegzieht. Es gibt in dieser Ebene keinen Doppelklick, der Zoom BEDEUTEN soll.
//
// 💣 EINE Stelle entscheidet. Leaflets doubleClickZoom zählt nicht mit, also darf niemand sonst
// enable() rufen: der Ecken-Editor tat das beim Schliessen und machte den Zoom damit mitten in der
// Arbeit wieder scharf. Die anderen rufen jetzt diese Funktion.
function syncEcosystemDoubleClickZoom() {
	if (typeof map === "undefined" || !map || !map.doubleClickZoom) {
		return;
	}
	const inEcosystemLayer = typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive();
	// Zeichnen und Ecken-Bearbeitung sind ohnehin nur dort möglich; sie stehen trotzdem hier, damit die
	// Antwort auch dann stimmt, wenn der Moduswechsel noch nicht durchgelaufen ist.
	const editing = typeof activeEcosystemGeometryEdit !== "undefined" && Boolean(activeEcosystemGeometryEdit);
	const drawing = typeof isEcosystemDrawing === "function" && isEcosystemDrawing();
	if (inEcosystemLayer || editing || drawing) {
		map.doubleClickZoom.disable();
	} else {
		map.doubleClickZoom.enable();
	}
}

function getSelectedEcosystemAreaPublicId() {
	return selectedEcosystemAreaPublicId;
}

// One area row -> one Leaflet layer, or null when the row is unusable. The caller registers it.
function buildEcosystemAreaLayer(area) {
	const kind = String(area?.kind || "");
	const paneName = ECOSYSTEM_KIND_PANES[kind];
	const latlngs = ecosystemAreaLatLngs(area?.geometry);
	if (!paneName || !latlngs) {
		return null;
	}

	const layer = L.polygon(latlngs, {
		pane: paneName,
		// Every area stays interactive; whether it actually answers is decided by the PANE it sits in
		// (see .ecosystem-pane--resting in css/features/ecosystem-layer.css). That is the whole reason
		// there are three panes: switching must not have to rebuild layers.
		interactive: true,
		...ecosystemAreaStyle(kind, area.region_type),
	});

	layer._ecosystemArea = area;
	layer.bindTooltip(formatEcosystemAreaTooltip(area), { sticky: true, direction: "top" });
	// 🔴 WÄHREND EINER BEARBEITUNG SCHWEIGT ER (Owner 2026-07-28). Der Tooltip ist eine Auskunft für den,
	// der die Karte LIEST -- beim Malen, Zeichnen, Ziehen oder Eckenschieben klebt er am Zeiger, verdeckt
	// genau die Stelle, an der gearbeitet wird, und beantwortet eine Frage, die niemand gestellt hat.
	//
	// 🪤 Am `tooltipopen` abgefangen und nicht an den Zuständen vorbei entschieden: die Bearbeitung kann
	// beginnen, während er schon offen steht, und sie kann enden, ohne dass der Zeiger sich bewegt. Hier
	// wird beides richtig -- er geht sofort zu und kommt erst wieder, wenn wirklich nichts mehr läuft.
	layer.on("tooltipopen", () => {
		if (isEcosystemEditingInProgress()) {
			layer.closeTooltip();
		}
	});
	layer.on("click", (event) => {
		// 💣 While the drawing tool is running, a click on an existing area is a CORNER, not a
		// selection -- so this handler must neither select nor stop the event, or no area could ever
		// be drawn across another one. Overlap and nesting are normal here (Schneckenkamm lies inside
		// the Windhagberge), so that case is the rule, not the exception.
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		if (event?.originalEvent && typeof L?.DomEvent?.stopPropagation === "function") {
			L.DomEvent.stopPropagation(event);
		}
		// Der Schwebezettel hat seine Arbeit getan, sobald geklickt wurde -- er ist eine Vorschau auf das,
		// was der Klick trifft. Er bleibt sonst stehen und legt sich über das, was danach aufgeht.
		layer.closeTooltip?.();
		// 🔴 Läuft gerade eine Zwei-Flächen-Operation, IST dieser Klick die Zielwahl -- nicht das
		// gewohnte Auswählen. Dieselbe Bauart wie der isEcosystemDrawing()-Riegel oben: eine Geste, die
		// den Klick schon vergeben hat, bekommt ihn zuerst. Gewacht, damit diese Datei ohne
		// map-features-ecosystem-geometry-ops.js weiterläuft.
		if (window.AvesmapsEcosystemGeometryOps?.handleAreaClick?.(area.public_id)) {
			return;
		}
		// In „Alle" antworten alle drei Ebenen. Wer hier eine Fläche anklickt, meint sie -- und meint
		// damit auch ihre Ebene: die Arbeitsebene zieht mit, sonst legte das nächste „Neue Vegetation"
		// oder das nächste Zeichnen in einer Ebene an, die niemand mehr im Blick hat. „Alle" bleibt dabei
		// stehen, und die Auswahl überlebt (der Wechsel räumt sie in diesem Modus nicht weg).
		if (typeof isEcosystemShowAllLayers === "function" && isEcosystemShowAllLayers()
			&& typeof setActiveEcosystemLayerKind === "function" && area.kind) {
			setActiveEcosystemLayerKind(area.kind);
		}
		setSelectedEcosystemArea(area.public_id);
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(formatEcosystemAreaTooltip(area));
		}
	});

	// V3.3: DOUBLE-CLICK opens the vertex editor -- a single click still only selects (owner
	// 2026-07-26). Not merely taste: opening on the selection would let the FIRST click of a
	// double-click raise the handles and the second one land on a handle that has just appeared, and a
	// double-click on a handle deletes a corner. That is the collision V3.2 flagged for the drawing
	// tool. Stopping the event also keeps it from reaching the map, where doubleClickZoom would fire and
	// where a double-click means "finish editing".
	layer.on("dblclick", (event) => {
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		if (event?.originalEvent) {
			L.DomEvent.stop(event);
		}
		// Already editing? Then a double-click on an EDGE inserts one corner there (owner 2026-07-26).
		if (typeof handleEcosystemEditEdgeDoubleClick === "function" && handleEcosystemEditEdgeDoubleClick(event)) {
			return;
		}
		// 💣 And a double-click anywhere ELSE inside an area already being edited does NOTHING. Calling
		// open again would close and re-open the session, which throws the undo stack away -- a second
		// double-click would silently cost every step you could still have taken back.
		if (typeof isEcosystemGeometryEditOpen === "function" && isEcosystemGeometryEditOpen(area.public_id)) {
			return;
		}
		if (typeof openEcosystemGeometryEdit === "function") {
			openEcosystemGeometryEdit(area.public_id);
		}
	});

	// V3.4: a landscape area has its OWN context menu (delete first, "Senden an ..." from V3.6). Stopping
	// the event is what keeps #map-context-menu from opening on top of it -- Leaflet would otherwise carry
	// the contextmenu on to map.on("contextmenu") (js/app/bootstrap.js:701), and L.DomEvent.stop is also
	// what suppresses the browser's own menu, since the map handler that normally does that never runs.
	//
	// 💣 While DRAWING it bails without stopping, exactly like the click handler above: a right-click is
	// not a corner, so the map menu staying reachable is the status quo, and swallowing the event here
	// would be a rule about a gesture this file has no opinion on.
	layer.on("contextmenu", (event) => {
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
			return;
		}
		if (!window.AvesmapsEcosystemAreaMenu) {
			return;
		}
		if (event?.originalEvent) {
			L.DomEvent.stop(event);
		}
		// 💣 VOR dem Öffnen des Menüs. Der Zettel ist `sticky` und hängt am Zeiger -- genau dort, wo das
		// Menü aufgeht. Er verdeckte sonst die oberen Einträge (Owner-Screenshot 2026-07-27).
		layer.closeTooltip?.();
		window.AvesmapsEcosystemAreaMenu.open(area, event);
	});

	return layer;
}

// Node-Export für die Einheitentests (Hausmuster, wie map-features-ecosystem-boolean.js). Im Browser
// existiert `module` nicht, dort bleiben die Funktionen schlicht global.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_KINDS,
		ECOSYSTEM_KIND_LABELS,
		ECOSYSTEM_KIND_PREFIX,
		ecosystemDialogTitle,
		formatEcosystemAreaTooltip,
		ecosystemStackingOrder,
	};
}
