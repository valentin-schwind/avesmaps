// Landschaften (Erprobung) -- loading the areas of the current viewport and keeping the registry in
// sync with them (plan V3.0, steps 2, 3 and 6). All three `kind` arrive in ONE request; the endpoint
// joins them from the region and does not need three calls.
//
// 🔴 OWN DEBOUNCE, OWN TIMER, OWN REGISTRY. Not schedulePoliticalTerritoryLayerReload, not
// regionPolygons, not clearRenderedRegionLayers -- the reasons are spelled out at the top of
// map-features-ecosystem-visibility.js and are the whole design of this layer. clearRenderedRegionLayers
// in particular empties regionPolygons on EVERY moveend; an area parked in there would have vanished
// from the registry after the first pan while its layer stayed on the map.
//
// 💣 DEDUPE BY public_id. This runs again on every pan, and the same area comes back every time.
// Without keying, the third pan leaves every area on the map three times over -- the stutter nobody
// notices at 5 areas and everybody notices at 300. Hence ecosystemLayers is a Map (runtime-state.js).

const ECOSYSTEM_RELOAD_DEBOUNCE_MS = 250;

let ecosystemAreaReloadTimeoutId = null;
// Monotonic: a slow response for an old viewport must not overwrite a newer one during fast panning.
let ecosystemAreaRequestToken = 0;
let ecosystemViewportReloadHooked = false;
// Löscht das Entfernen der letzten Fläche bzw. des letzten Labels die ganze Region mit? Der Server
// entscheidet das (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED); hier steht nur, was er zuletzt gesagt hat.
//
// 💣 DREI Zustände, nicht zwei: `null` heisst „noch nie gehört". Das ist kein Randfall -- die
// Regionsliste kommt aus `list_regions` (Editor-Endpunkt), das Flag dagegen aus
// `api/app/ecosystem-areas.php`, und das wird nur geladen, wenn jemand die Landschaftsebene betritt.
// Ein Label lässt sich aber überall löschen. Genau dann weiss der Client die Region, aber nicht das
// Flag.
//
// 🔴 UNBEKANNT WIRD WIE „EIN" BEHANDELT (siehe die Rückfragen). Die beiden Fehlrichtungen sind nicht
// gleich teuer: zu viel anzukündigen kostet einen Schreck, zu wenig kostet eine Fläche, die
// wortlos verschwindet. Nur ein ausdrückliches `false` vom Server darf beruhigen.
let ecosystemCascadeEnabledOnServer = null;

function isEcosystemCascadeEnabled() {
	return ecosystemCascadeEnabledOnServer;
}
// The ecosystem_revision of the last answer. Every write bumps it, so a change is the cheap signal that
// anything cached ALONGSIDE the areas -- the region picker's rows and their area counts -- is stale.
// null = nothing seen yet, so the first answer never counts as a change.
let ecosystemLastSeenRevision = null;

// bbox=min_x,min_y,max_x,max_y in GeoJSON order. L.CRS.Simple maps lat->y and lng->x, so west/east are
// the X bounds and south/north the Y bounds. 25% padding, the same cushion the path viewport culling
// uses, so an area does not pop in at the edge of the frame.
function currentEcosystemBoundingBoxParam() {
	if (typeof map === "undefined" || !map || typeof map.getBounds !== "function") {
		return "";
	}

	const bounds = map.getBounds().pad(0.25);
	const values = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
	if (!values.every((value) => Number.isFinite(value))) {
		return "";
	}

	return values.map((value) => value.toFixed(2)).join(",");
}

function removeEcosystemAreaLayer(publicId) {
	if (!(ecosystemLayers instanceof Map)) {
		return;
	}
	const layer = ecosystemLayers.get(publicId);
	if (!layer) {
		return;
	}

	if (typeof map !== "undefined" && map && map.hasLayer(layer)) {
		map.removeLayer(layer);
	}
	ecosystemLayers.delete(publicId);
	if (typeof getSelectedEcosystemAreaPublicId === "function" && getSelectedEcosystemAreaPublicId() === publicId) {
		setSelectedEcosystemArea("");
	}
}

// Step 6: leaving the mode empties OUR registry and nothing else.
// 🔴 regionPolygons is not touched here, not even read.
function clearEcosystemAreaLayers() {
	if (ecosystemAreaReloadTimeoutId !== null) {
		window.clearTimeout(ecosystemAreaReloadTimeoutId);
		ecosystemAreaReloadTimeoutId = null;
	}
	// Invalidates any request still in flight, so a late answer cannot repopulate an emptied registry.
	ecosystemAreaRequestToken += 1;
	// Re-entering the mode refetches the regions anyway; without this reset the first answer after the
	// return would compare against a revision from before and order a second, pointless refetch.
	ecosystemLastSeenRevision = null;

	if (ecosystemLayers instanceof Map) {
		Array.from(ecosystemLayers.keys()).forEach(removeEcosystemAreaLayer);
		ecosystemLayers.clear();
	}
	if (typeof setSelectedEcosystemArea === "function") {
		setSelectedEcosystemArea("");
	}
}

// syncEcosystemServerStateNote ist am 2026-08-01 mit dem Totmannschalter entfallen: sie meldete
// ausschliesslich, dass app_setting['ecosystem_enabled'] auf '0' steht. Ohne den Schalter gibt es
// diesen Zustand nicht mehr, und ein Hinweis, der nie erscheinen kann, ist keiner.

function applyEcosystemAreaPayload(payload) {
	// 🔴 Nimmt das Löschen der letzten Fläche die ganze Region mit? Das entscheidet der SERVER
	// (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED), und die Rückfragen im Editor müssen es wissen -- sonst
	// kündigen sie ein Mitlöschen an, das nicht stattfindet. Eine Rückfrage, die übertreibt, wird
	// genauso schnell weggeklickt wie eine, die untertreibt.
	ecosystemCascadeEnabledOnServer = payload?.cascade_enabled === true;

	// A changed revision means somebody wrote -- a new area, a renamed region, a deletion. The region
	// picker caches its rows including each region's area count, and that count is exactly what goes
	// wrong first: draw an area and the row keeps saying "0 Flächen" until the mode is re-entered.
	// This is the one signal that says "refetch", and it stays quiet when nothing changed.
	const revision = Number(payload?.revision || 0);
	if (ecosystemLastSeenRevision !== null && revision !== ecosystemLastSeenRevision
		&& typeof invalidateEcosystemRegionCache === "function") {
		invalidateEcosystemRegionCache();
	}
	ecosystemLastSeenRevision = revision;

	const areas = Array.isArray(payload?.areas) ? payload.areas : [];
	const seenPublicIds = new Set();
	// 💣 V8: Ob der HÖHENSTAPEL neu gebaut werden muss. Siehe die Begründung unten am redraw-Aufruf.
	// Wird nur gesetzt, wenn sich an einer für das Höhenfeld erheblichen Fläche wirklich etwas ändert --
	// ein Neubau kostet live rund 306 ms, das darf nicht bei jedem Schwenk laufen.
	let heightStackStale = false;

	areas.forEach((area) => {
		const publicId = String(area?.public_id || "");
		if (!publicId) {
			return;
		}
		seenPublicIds.add(publicId);

		const existingLayer = ecosystemLayers.get(publicId);
		if (existingLayer) {
			const previous = existingLayer._ecosystemArea;
			// Same geometry and same kind -> the layer on the map is still the right one. Only the
			// descriptive fields (region name, type, trial flag) are refreshed.
			if (previous && previous.geometry_revision === area.geometry_revision && previous.kind === area.kind) {
				// Die Geometrie steht, aber die Geländewerte können sich geändert haben -- eine
				// Geländespeicherung bumpt `geometry_revision` NICHT. Ohne diese Prüfung übernähme die
				// billige Abzweigung neue Werte ins Flächenobjekt, während der Stapel mit den alten
				// weiterrechnet: zwei Wahrheiten, und die sichtbare wäre die falsche.
				if (ecosystemHeightRelevantChange(previous, area)) {
					heightStackStale = true;
				}
				existingLayer._ecosystemArea = area;
				if (typeof existingLayer.setTooltipContent === "function") {
					existingLayer.setTooltipContent(formatEcosystemAreaTooltip(area));
				}
				// The tone follows region_type for vegetation, so an area whose region was re-typed has
				// to be recoloured -- but only then. Restyling every area on every pan would be N
				// attribute writes per pan for nothing.
				if (previous.region_type !== area.region_type) {
					existingLayer.setStyle(ecosystemAreaStyle(area.kind, area.region_type));
				}
				return;
			}
			if (ecosystemAreaAffectsHeightField(previous)) {
				heightStackStale = true;
			}
			removeEcosystemAreaLayer(publicId);
		}

		const layer = buildEcosystemAreaLayer(area);
		if (!layer) {
			console.warn("Landschaftsflaeche konnte nicht gezeichnet werden:", publicId);
			return;
		}
		// 🔴 HIER kommt die Fläche NEU dazu -- genau der Fall, an dem die Ingrakuppen hingen.
		if (ecosystemAreaAffectsHeightField(area)) {
			heightStackStale = true;
		}
		ecosystemLayers.set(publicId, layer);
		layer.addTo(map);
		// Only now does the <path> element exist. A rebuilt area that was selected has to get its class
		// back, otherwise saving a geometry would silently drop the selection ring.
		applyEcosystemSelectionClass(layer);
		// Dasselbe für die hervorgehobene Region (Owner 2026-08-04): auch sie ist eine Klasse am
		// <path>, und ein neu gebautes Band bekäme sie sonst nicht zurück. Ein Klimaband ist zwar
		// kartenbreit und fällt deshalb praktisch nie aus dem Ausschnitt -- aber „praktisch nie" ist
		// kein Grund, den einen Fall offen zu lassen, in dem seine Geometrie sich ändert.
		if (typeof applyEcosystemHighlightClass === "function") {
			applyEcosystemHighlightClass(layer);
		}
	});

	// Gone from the answer = gone from the viewport (the endpoint filters by bbox overlap). Removing
	// them is what keeps the registry bounded instead of growing with every pan.
	// V3.3 needs NO hook here, and that is worth writing down because the opposite looks obvious. An open
	// vertex edit holds ONE layer object, so a rebuild would strand its handles -- but every path that
	// rebuilds or drops a layer goes through removeEcosystemAreaLayer above, which deselects, and the
	// deselect runs setSelectedEcosystemArea -> syncEcosystemGeometryEdit -> the session closes AND
	// flushes its pending write. That is what saves the corner somebody dragged just before panning the
	// area out of the viewport. A layer whose geometry_revision is unchanged keeps its object (the cheap
	// branch above), so an undisturbed session is never touched at all.
	Array.from(ecosystemLayers.keys()).forEach((publicId) => {
		if (!seenPublicIds.has(publicId)) {
			// Vor dem Entfernen fragen -- danach ist das Flächenobjekt weg.
			if (ecosystemAreaAffectsHeightField(ecosystemLayers.get(publicId)?._ecosystemArea)) {
				heightStackStale = true;
			}
			removeEcosystemAreaLayer(publicId);
		}
	});

	// 💣 V8: DAS HÖHENFELD NEU ZEICHNEN, sobald die Flächen da sind. Ohne diesen Aufruf blieb die
	// Topographie leer, bis der Editor zufällig verschob -- und genau so wurde es gemeldet
	// („die höhen sind immer noch nicht sichtbar").
	//
	// Die Ursache ist eine Reihenfolge, die von aussen unsichtbar ist: das Relief zeichnet auf
	// `moveend/zoomend/viewreset/resize` plus drei Nachzügler-Durchgänge beim Seitenstart. Die Flächen
	// kommen aber ERST, wenn jemand die Landschaften-Ebene betritt -- lange nach den Nachzüglern --,
	// und das Betreten feuert kein Karten-Ereignis. Der Stapel merkte sich sein Nichts richtigerweise
	// als „veraltet", nur fragte ihn niemand mehr.
	//
	// Live gemessen (2026-07-28): 9 Flächen geladen, `fields: 0`, und ein blankes `redraw()` ohne jede
	// Invalidierung lieferte sofort 2 Felder und 868.876 gemalte Pixel. Es fehlte nur der Anstoss.
	//
	// Hier und nicht im Höhenmodul: DIESE Stelle weiss, wann die Flächen vollständig sind. Ein Poller
	// dort drüben wäre die schlechtere Antwort auf dieselbe Frage.
	//
	// 💣 UND DAS `invalidate()` DAVOR IST DER EIGENTLICHE PUNKT (2026-07-29, Owner: „jetzt gehen die
	// Ingrakuppen wieder nicht"). Der Kommentar oben stimmt nur für den ERSTEN Fall: ein LEERER Stapel
	// merkt sich selbst als veraltet (`stackDirty = fields.length === 0`), deshalb genügte damals ein
	// blankes `redraw()`. Sobald er einmal gefüllt ist, steht `stackDirty` auf false -- und bleibt es,
	// denn gesetzt wird es sonst NUR im Eigenschaften-Dialog. Jede Fläche, die danach beim Schwenken
	// nachlädt, wurde gegen den ALTEN Stapel gezeichnet und war unsichtbar. Genau so gemeldet: nach dem
	// Bearbeiten einer Fläche ging es (der Dialog invalidiert), nach dem Schwenken nach Süden nicht mehr.
	//
	// 🪤 NICHT bedingungslos invalidieren. Der Stapelbau kostet am Livebestand rund 306 ms; bei jedem
	// `moveend` neu zu bauen hiesse, das Schwenken für eine Fläche zu bezahlen, die sich nicht geändert
	// hat. Das Flag oben wird nur gesetzt, wenn eine für das Höhenfeld erhebliche Fläche dazukommt,
	// verschwindet oder ihre Geländewerte wechselt.
	if (heightStackStale) {
		window.AvesmapsEcosystemHeightRender?.invalidate?.();
	}
	window.AvesmapsEcosystemHeightRender?.redraw?.();

	// 🔴 Gross unten, klein oben (Owner 2026-07-28, Punkt 9). Alle Flächen einer Ebene liegen in EINER
	// SVG-Gruppe, und dort gewinnt die Ladereihenfolge -- eine derographische Region, die zufällig nach
	// der kleineren kam, deckte diese vollständig zu und nahm ihren Klick gleich mit. Hier, nach dem
	// Hinzufügen UND nach dem Entfernen: ein Neubau hängt seinen Pfad hinten an, also stimmt die
	// Reihenfolge sonst schon nach dem ersten Schwenk nicht mehr.
	if (typeof applyEcosystemStackingOrder === "function") {
		applyEcosystemStackingOrder();
	}

	// Welche Labels in dieser Ebene blass sind, hängt an genau dieser Registry: ein Label ist „eigen",
	// wenn eine geladene Fläche der aktiven Art darauf zeigt. Nach jedem Nachladen kann sich das also
	// geändert haben -- ohne diesen Aufruf bliebe ein gerade erst hereingepanntes Waldlabel blass.
	if (typeof syncEcosystemLabelMuting === "function") {
		syncEcosystemLabelMuting();
	}

	// Die Zonennamen der Klimazonen hängen an genau dieser Registry: sie werden aus der FLÄCHE gerechnet
	// (Westkante, Bandmitte), nicht aus den Trennlinien -- nur so stehen sie auch im Frontend, wo der
	// Editor-Endpunkt nie gerufen wird. Nach jedem Nachladen kann sich also geändert haben, welche Bänder
	// da sind und wo sie liegen; ohne diesen Aufruf bliebe ein frisch abgeleitetes Band namenlos.
	window.AvesmapsEcosystemClimate?.sync?.();
}

async function loadEcosystemAreas() {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return;
	}
	if (!ECOSYSTEM_AREAS_API_URL || typeof map === "undefined" || !map || !(ecosystemLayers instanceof Map)) {
		return;
	}

	const boundingBox = currentEcosystemBoundingBoxParam();
	const requestUrl = boundingBox
		? `${ECOSYSTEM_AREAS_API_URL}?bbox=${encodeURIComponent(boundingBox)}`
		: ECOSYSTEM_AREAS_API_URL;
	const requestToken = (ecosystemAreaRequestToken += 1);

	try {
		const response = await fetch(requestUrl, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const payload = await readJsonResponse(response, null);

		// A newer pan already started (or the mode was left) -- this answer describes a viewport that
		// no longer exists.
		if (requestToken !== ecosystemAreaRequestToken) {
			return;
		}
		if (!response.ok || payload?.ok !== true) {
			console.warn("Landschaftsflaechen konnten nicht geladen werden:", apiErrorMessage(payload, `HTTP ${response.status}`));
			return;
		}

		applyEcosystemAreaPayload(payload);
	} catch (error) {
		console.warn("Landschaftsflaechen konnten nicht geladen werden:", error);
	}
}

function scheduleEcosystemAreaReload({ immediate = false } = {}) {
	if (ecosystemAreaReloadTimeoutId !== null) {
		window.clearTimeout(ecosystemAreaReloadTimeoutId);
		ecosystemAreaReloadTimeoutId = null;
	}

	if (immediate) {
		void loadEcosystemAreas();
		return;
	}

	ecosystemAreaReloadTimeoutId = window.setTimeout(() => {
		ecosystemAreaReloadTimeoutId = null;
		void loadEcosystemAreas();
	}, ECOSYSTEM_RELOAD_DEBOUNCE_MS);
}

// Wired lazily instead of in bootstrap.js, following the __pathViewportCullingHooked pattern
// (map-features-display-mode.js): `map` is created LAST, after every map-features file has loaded, so
// there is no top-level moment at which map.on() could be called from here. syncEcosystemVisibility
// runs from setSelectedMapLayerMode, which restorePlannerState calls once the map data has arrived.
// Trägt diese Fläche überhaupt zum Höhenfeld bei? 🔴 Dieselbe Bedingung wie `topographyAreas()` in
// map-features-ecosystem-height-render.js. Sie steht damit an zwei Stellen, und das ist der Preis dafür,
// dass der Loader nicht ins Höhenmodul greifen muss -- wer die eine ändert, ändert die andere mit.
function ecosystemAreaAffectsHeightField(area) {
	return Boolean(area) && String(area.kind || "") === "topographie"
		&& String(area.region_type || "") === "gebirge";
}

// Hat sich an einer Fläche etwas geändert, das das Höhenfeld anders rechnen lässt?
//
// 💣 `geometry_revision` genügt NICHT. Eine Geländespeicherung (`update_area_terrain`) bumpt sie nicht,
// die Werte reisen aber im nächsten Ladevorgang mit -- ohne diese Prüfung übernähme der Loader sie ins
// Flächenobjekt, während der Höhenstapel mit den alten weiterrechnet.
function ecosystemHeightRelevantChange(previous, next) {
	if (ecosystemAreaAffectsHeightField(previous) !== ecosystemAreaAffectsHeightField(next)) {
		return true;                          // z. B. Art von „gebirge" weg oder hin
	}
	if (!ecosystemAreaAffectsHeightField(next)) {
		return false;                         // für das Höhenfeld ohnehin bedeutungslos
	}

	return ["terrain_grain", "terrain_levels", "terrain_avg_height", "terrain_mean_height"]
		.some((feld) => (previous?.[feld] ?? null) !== (next?.[feld] ?? null));
}

function hookEcosystemViewportReload() {
	if (ecosystemViewportReloadHooked || typeof map === "undefined" || !map || typeof map.on !== "function") {
		return;
	}
	ecosystemViewportReloadHooked = true;
	map.on("moveend zoomend", () => scheduleEcosystemAreaReload());
}

if (typeof module !== "undefined" && module.exports) {
	// Nur die zwei reinen Entscheidungsfunktionen -- der Rest des Moduls hängt an Leaflet und der Karte.
	module.exports = { ecosystemAreaAffectsHeightField, ecosystemHeightRelevantChange };
}
