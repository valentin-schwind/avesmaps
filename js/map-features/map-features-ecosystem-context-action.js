/*
 * Landschaften (Erprobung) -- the two context menus of the layer (plan V3.4).
 *
 * 🔴 NEITHER index.html's MENU MARKUP NOR REGION_CONTEXT_ACTIONS IS TOUCHED. This is one
 * self-contained IIFE that (1) injects its three "Neue ..." entries into the existing
 * "Hier hinzufügen" submenu and (2) intercepts clicks on them in the document CAPTURE phase with
 * stopImmediatePropagation(), before the delegated jQuery handler in js/routing/routing.js:637 (bubble
 * phase) can look the action up. Same shape as map-features-settlement-context-action.js:114-116 --
 * that one hooks the region menu, this one the map menu, and the phase is the point in both.
 *
 * 🔴 POLITICAL FILES ARE READ AND COPIED FROM, NEVER CALLED (plan, global rule 1). That includes
 * positionContextMenuElement(): it is a generic six-line viewport clamp, but it lives in
 * map-features-region-context-menu.js, so the clamp below is a copy and not a call. Not purism -- a
 * call is a dependency in the wrong direction, and the "pure maths" exception is exactly how those
 * dependencies get in.
 *
 * There are THREE menus in this house, and this file is where the fourth is born:
 *
 *   #map-context-menu      index.html  right-click on empty map    <- the three "Neue ..." entries
 *   #region-context-menu   index.html  political polygons          <- untouched, not even closed
 *   (none)                             landscape areas             <- built here, delete first
 *
 * The area menu is the prerequisite for V3.6 ("Senden an ...") AND the way back out of an area put in
 * the wrong place, which V3.0b left open on purpose. It is built and owned here, so a sibling feature
 * adds its entry through window.AvesmapsEcosystemAreaMenu.addEntry() -- the one seam this file offers.
 * V3.6 uses it; wrapping open() from outside would be the alternative, and it would break on the next
 * change in here.
 */
(function initEcosystemContextAction() {
	"use strict";

	const AREA_MENU_ELEMENT_ID = "ecosystem-area-context-menu";
	const NEW_AREA_ATTRIBUTE = "data-ecosystem-context-action";
	const AREA_ACTION_ATTRIBUTE = "data-ecosystem-area-action";
	const NEW_AREA_ACTION = "new-area";
	const DELETE_AREA_ACTION = "delete";

	// 🪤 NOT data-ecosystem-kind. syncEcosystemLayerSwitchControls does a DOCUMENT-WIDE
	// querySelectorAll("[data-ecosystem-kind]") (map-features-ecosystem-layer-switch.js:76) and stamps
	// is-active / aria-selected / tabindex on every hit. A menu entry carrying that attribute would be
	// silently treated as a fourth tab of the segment switch.
	const NEW_AREA_KIND_ATTRIBUTE = "data-ecosystem-new-kind";

	// German labels, English keys -- the kind values themselves are domain vocabulary and stay German
	// (AGENTS.md §2). tr() rather than data-i18n because these nodes are injected: the data-i18n walk in
	// js/app/i18n.js runs over the document it finds, and an entry created later would keep its German
	// label under ?lang=en.
	const NEW_AREA_ENTRIES = [
		{ kind: "derographisch", key: "ecosystem.ctxmenu.newDerographisch", label: "Neue Derographische Region" },
		{ kind: "vegetation", key: "ecosystem.ctxmenu.newVegetation", label: "Neue Vegetation" },
		{ kind: "topographie", key: "ecosystem.ctxmenu.newTopographie", label: "Neue Topographie" },
	];

	// The area the open area-menu belongs to. Mirrors activeRegionContextEntry, and like it is read
	// BEFORE the menu is closed -- closing clears it.
	let activeEcosystemAreaMenuPublicId = "";
	let ecosystemAreaMenuMapHooked = false;

	// V3.6 extension point: action -> handler, for entries a SIBLING file hangs into this menu. The menu
	// is built in JS and everything around it is private to this IIFE, so without a registry the only way
	// in from outside would be monkey-patching window.AvesmapsEcosystemAreaMenu.open -- which would run
	// on every open, after the entry was needed, and would break the moment this file changes.
	const areaMenuEntryHandlers = new Map();

	function label(key, german) {
		return typeof tr === "function" ? tr(key, german) : german;
	}

	function say(message, tone) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(message, tone);
		}
	}

	// ---- pure helpers (unit-tested) ------------------------------------------------------------------

	// Which entries of the MAP menu are shown. Both answers are decisions, not conveniences:
	//
	//  - "Neues Herrschaftsgebiet" only in political mode (plan V3.4). It used to be offered in every
	//    mode and forced the mode over on its own (map-features-region-crud.js:159); with a second
	//    area-creating layer in the house that shortcut becomes a way to leave the layer you are working
	//    in without noticing.
	//  - The three "Neue ..." entries are NOT gated on the ecosystem mode -- they are the way INTO it,
	//    so the gate is only "may this editor use the layer at all" (IS_EDIT_MODE + IS_ECOSYSTEM_ENABLED,
	//    the same pair setSelectedMapLayerMode uses to allow the mode in the first place). Offering them
	//    while the mode is refused would produce entries that switch to the default mode instead.
	function ecosystemMapMenuVisibility({ mode = "", isEditMode = false, isEcosystemEnabled = false } = {}) {
		return {
			createRegion: mode === "political",
			newArea: Boolean(isEditMode) && Boolean(isEcosystemEnabled),
		};
	}

	// 💣 expected_revision IS MANDATORY. delete_area answers 400 without it and 409 with a stale one
	// (api/_internal/app/ecosystem.php:468-476, :1165-1172). The value is the geometry_revision the
	// client last read, which rides on layer._ecosystemArea -- so a row that arrived without one must be
	// REFUSED here rather than sent as 0 or undefined, or the failure moves to the server and comes back
	// as a message nobody can act on.
	function ecosystemAreaDeleteRequest(area) {
		const publicId = String(area?.public_id || "").trim();
		const revision = Number(area?.geometry_revision);
		if (!publicId || !Number.isInteger(revision) || revision < 1) {
			return null;
		}

		return { public_id: publicId, expected_revision: revision };
	}

	// Names the area the way the tooltip does, so the confirmation and the thing under the cursor agree.
	// Soft delete is still a delete as far as the editor is concerned: it disappears and only the owner
	// can bring it back, so it is worth a confirm (the house pattern for destructive context actions --
	// map-features-region-context-menu.js:79).
	// 🔴 SIE NENNT DIE FOLGE, BEVOR SIE EINTRITT (Owner 2026-07-28). Seit die letzte Fläche einer Region
	// die Region UND ihre Labels mitnimmt, ist diese Rückfrage die einzige Bremse -- und bis heute stand
	// hier die Entwarnung „Die Region und ihre anderen Flächen bleiben bestehen.", die im gefährlichsten
	// Fall schlicht falsch war.
	//
	// 💣 Am Live-Bestand hat JEDE der 139 Regionen genau EINE Fläche. „Die letzte" ist damit derzeit der
	// Normalfall, nicht der Ausnahmefall -- diese Zeilen sind das, was ein Editor tatsächlich zu lesen
	// bekommt.
	//
	// Die Zahlen kommen aus der Flächenzeile (region_area_count / region_label_count, seit heute im
	// Lesepfad), nicht aus den geladenen Ebenen: die halten nur den Ausschnitt.
	function formatEcosystemAreaDeleteConfirmation(area, kaskade) {
		const regionName = String(area?.region_name || "").trim() || "Ohne Namen";
		const kindLabel = (typeof ECOSYSTEM_KIND_LABELS !== "undefined" && ECOSYSTEM_KIND_LABELS?.[area?.kind])
			|| String(area?.kind || "");
		const areaCount = Number(area?.region_area_count) || 0;
		const labelCount = Number(area?.region_label_count) || 0;
		const kopf = `Fläche aus „${regionName}"${kindLabel ? ` (${kindLabel})` : ""} wirklich löschen?`;

		if (areaCount > 1) {
			const rest = areaCount - 1;
			return [kopf, "", `Die Region und ihre ${rest === 1 ? "andere Fläche" : `anderen ${rest} Flächen`} bleiben bestehen.`].join("\n");
		}

		// 🔴 Ab hier geht es um die LETZTE Fläche, und was dann passiert, entscheidet der Server
		// (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED, im Lesepfad als `cascade_enabled`). Ist die Kaskade aus,
		// bleibt die Region als leere Hülle stehen -- das anzukündigen als „verschwindet mit" wäre
		// genauso falsch wie die alte Entwarnung, nur in die andere Richtung.
		if (!kaskade) {
			// 🪤 0 heisst „unbekannt", nicht „keine": die Fläche, um die es geht, zählt selbst mit. Dann
			// gar keine Aussage über die Region treffen.
			return areaCount <= 0
				? kopf
				: [kopf, "", `Das ist die LETZTE Fläche von „${regionName}" — die Region bleibt bestehen, ohne Fläche.`].join("\n");
		}

		// 🪤 Unbekannte Zahl bei eingeschalteter Kaskade: die Folge offenlassen ist ehrlicher, als sie
		// falsch zu verneinen.
		if (areaCount <= 0) {
			return [kopf, "", "Ist es die letzte Fläche dieser Region, verschwinden die Region und ihre Labels mit."].join("\n");
		}
		if (labelCount <= 0) {
			return [kopf, "", `Das ist die LETZTE Fläche von „${regionName}" — die Region verschwindet mit.`].join("\n");
		}

		return [
			kopf,
			"",
			`Das ist die LETZTE Fläche von „${regionName}" — die Region und ${labelCount === 1 ? "ihr Label" : `ihre ${labelCount} Labels`} verschwinden mit.`,
		].join("\n");
	}

	// ---- the three "Neue ..." entries in the map menu ------------------------------------------------

	function ensureNewAreaMenuEntries() {
		const submenu = document.querySelector('.map-context-menu__group[data-context-action="add-here"] .map-context-submenu');
		if (!submenu || submenu.querySelector(`[${NEW_AREA_ATTRIBUTE}="${NEW_AREA_ACTION}"]`)) {
			return;
		}

		// Built as one fragment and inserted once: three insertAdjacentElement("afterend") calls against
		// the same anchor would put the entries in reverse order.
		const fragment = document.createDocumentFragment();
		NEW_AREA_ENTRIES.forEach((entry) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "map-context-menu__item";
			button.setAttribute(NEW_AREA_ATTRIBUTE, NEW_AREA_ACTION);
			button.setAttribute(NEW_AREA_KIND_ATTRIBUTE, entry.kind);
			// Hidden until the first right-click asks syncMapContextMenuEntries what this mode allows.
			button.hidden = true;
			button.textContent = label(entry.key, entry.label);
			fragment.appendChild(button);
		});

		// After "Neues Herrschaftsgebiet": the two are siblings in kind ("draw a new area"), and putting
		// them last would separate them with nothing in between.
		const anchor = submenu.querySelector('[data-context-action="create-region"]');
		if (anchor) {
			anchor.after(fragment);
			return;
		}
		submenu.appendChild(fragment);
	}

	// Runs on every right-click, in the CAPTURE phase, so it is done before Leaflet's own contextmenu
	// handler calls openMapContextMenu (js/app/bootstrap.js:701) -- which unhides the menu and only THEN
	// measures offsetHeight to clamp it into the viewport. Syncing afterwards would clamp a height that
	// no longer matches the entries.
	function syncMapContextMenuEntries() {
		ensureNewAreaMenuEntries();
		const visibility = ecosystemMapMenuVisibility({
			mode: typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "",
			isEditMode: typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE,
			isEcosystemEnabled: typeof IS_ECOSYSTEM_ENABLED !== "undefined" && IS_ECOSYSTEM_ENABLED,
		});

		const createRegionElement = document.querySelector('.map-context-submenu [data-context-action="create-region"]');
		if (createRegionElement) {
			createRegionElement.hidden = !visibility.createRegion;
		}
		document.querySelectorAll(`[${NEW_AREA_ATTRIBUTE}="${NEW_AREA_ACTION}"]`).forEach((button) => {
			button.hidden = !visibility.newArea;
		});
	}

	// "Neue <Ebene>" = switch to that layer and start drawing there. There is deliberately no
	// drop-a-shape-and-save step: the whole point of V3.2 is that nothing is written until the outline is
	// finished, so this entry can never leave a corpse behind if the editor changes their mind.
	function startNewEcosystemArea(kind, latlng) {
		if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE
			|| typeof IS_ECOSYSTEM_ENABLED === "undefined" || !IS_ECOSYSTEM_ENABLED) {
			return;
		}
		if (typeof setActiveEcosystemLayerKind !== "function" || typeof startEcosystemAreaDrawing !== "function") {
			say("Die Landschaften-Ebene ist nicht bereit.", "warning");
			return;
		}

		// An outline half-drawn in another layer cannot survive the switch -- it is unsaved by design, and
		// the editor just asked for a new one. Said out loud rather than dropped silently.
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing() && typeof cancelEcosystemAreaDrawing === "function") {
			cancelEcosystemAreaDrawing("Vorheriges Zeichnen abgebrochen — es wurde nichts gespeichert.");
		}

		// Kind BEFORE mode: entering the mode syncs the segment switch and refetches the region list for
		// the active kind, so setting it first means one request for the right layer instead of one for
		// the old layer followed by a correction.
		setActiveEcosystemLayerKind(kind);
		if (typeof setSelectedMapLayerMode === "function"
			&& (typeof getSelectedMapLayerMode !== "function" || getSelectedMapLayerMode() !== "ecosystem")) {
			setSelectedMapLayerMode("ecosystem");
		}

		// The mode may have been refused (a foreign link, the dead-man switch): then there is no layer to
		// draw in and starting would hang click handlers on a map that has none.
		if (typeof isEcosystemLayerModeActive === "function" && !isEcosystemLayerModeActive()) {
			say("Die Landschaften-Ebene ist auf diesem Zugang nicht verfügbar.", "warning");
			return;
		}

		// The entry sits in "Hier hinzufügen", so "hier" has to mean something: the right-clicked point
		// becomes the first corner. Without it this would be the only entry in that submenu that ignores
		// where it was opened.
		startEcosystemAreaDrawing({ startLatLng: latlng || null });
	}

	function handleNewAreaMenuClick(event) {
		const actionElement = event.target?.closest?.(`[${NEW_AREA_ATTRIBUTE}="${NEW_AREA_ACTION}"]`);
		if (!actionElement) {
			return false;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		// 💣 Read the position BEFORE closing -- closeMapContextMenu() nulls pendingContextMenuLatLng
		// (js/app/bootstrap.js:627).
		const latlng = typeof pendingContextMenuLatLng !== "undefined" && pendingContextMenuLatLng
			? L.latLng(pendingContextMenuLatLng)
			: null;
		if (typeof closeMapContextMenu === "function") {
			closeMapContextMenu();
		}
		startNewEcosystemArea(actionElement.getAttribute(NEW_AREA_KIND_ATTRIBUTE) || "", latlng);

		return true;
	}

	// ---- the area menu ------------------------------------------------------------------------------

	// Built in JS and parked next to #region-context-menu rather than appended to <body>: same parent,
	// same stacking context, so the .map-context-menu z-index token means the same thing for both. It
	// carries the shared classes and therefore the shared look -- there is no CSS of its own beyond the
	// entry's glyph (css/components/map-context-menu.css).
	function ensureAreaMenuElement() {
		const existing = document.getElementById(AREA_MENU_ELEMENT_ID);
		if (existing) {
			return existing;
		}

		const menu = document.createElement("div");
		menu.id = AREA_MENU_ELEMENT_ID;
		menu.className = "map-context-menu";
		menu.hidden = true;

		const deleteButton = document.createElement("button");
		deleteButton.type = "button";
		deleteButton.className = "map-context-menu__item map-context-menu__item--danger";
		deleteButton.setAttribute(AREA_ACTION_ATTRIBUTE, DELETE_AREA_ACTION);
		deleteButton.textContent = label("ecosystem.ctxmenu.deleteArea", "Fläche löschen");
		menu.appendChild(deleteButton);

		const sibling = document.getElementById("region-context-menu") || document.getElementById("map-context-menu");
		if (sibling?.parentNode) {
			sibling.parentNode.insertBefore(menu, sibling.nextSibling);
		} else {
			document.body.appendChild(menu);
		}

		return menu;
	}

	// Adds one entry to the area menu on behalf of another file (V3.6: "Senden an ..."). Idempotent by
	// action, exactly like ensureAreaMenuElement is by element -- both may run again after a reload of
	// the calling file without producing a second entry.
	//
	// 🪤 INSERTED BEFORE THE FIRST DANGER ENTRY, not appended. "Fläche löschen" is built first here, and
	// an appended entry would land below it; destructive actions belong last in every menu in this house
	// (#region-context-menu ends on `delete` too). The caller must not have to know that.
	function addEcosystemAreaMenuEntry({ action = "", label: entryLabel = "", onClick = null } = {}) {
		const actionName = String(action).trim();
		if (!actionName || typeof onClick !== "function") {
			return null;
		}

		areaMenuEntryHandlers.set(actionName, onClick);

		const menu = ensureAreaMenuElement();
		const existing = menu.querySelector(`[${AREA_ACTION_ATTRIBUTE}="${actionName}"]`);
		if (existing) {
			return existing;
		}

		const button = document.createElement("button");
		button.type = "button";
		button.className = "map-context-menu__item";
		button.setAttribute(AREA_ACTION_ATTRIBUTE, actionName);
		button.textContent = String(entryLabel || actionName);

		const firstDanger = menu.querySelector(".map-context-menu__item--danger");
		if (firstDanger) {
			menu.insertBefore(button, firstDanger);
		} else {
			menu.appendChild(button);
		}

		return button;
	}

	// Copied from positionContextMenuElement (map-features-region-context-menu.js:41-51), NOT called --
	// see the header. Offsets and padding come from js/config.js, so all three menus keep landing in the
	// same spot relative to the cursor.
	function positionAreaMenu(menuElement, clientX, clientY) {
		const padding = typeof MAP_CONTEXT_MENU_VIEWPORT_PADDING !== "undefined" ? MAP_CONTEXT_MENU_VIEWPORT_PADDING : 8;
		const offsetX = typeof MAP_CONTEXT_MENU_OFFSET_X !== "undefined" ? MAP_CONTEXT_MENU_OFFSET_X : 18;
		const offsetY = typeof MAP_CONTEXT_MENU_OFFSET_Y !== "undefined" ? MAP_CONTEXT_MENU_OFFSET_Y : 14;

		menuElement.style.left = "0px";
		menuElement.style.top = "0px";
		const width = menuElement.offsetWidth;
		const height = menuElement.offsetHeight;
		menuElement.style.left = `${Math.max(padding, Math.min(clientX + offsetX, window.innerWidth - width - padding))}px`;
		menuElement.style.top = `${Math.max(padding, Math.min(clientY + offsetY, window.innerHeight - height - padding))}px`;
	}

	function closeEcosystemAreaContextMenu() {
		const menuElement = document.getElementById(AREA_MENU_ELEMENT_ID);
		if (menuElement) {
			menuElement.hidden = true;
		}
		activeEcosystemAreaMenuPublicId = "";
	}

	function isEcosystemAreaContextMenuOpen() {
		const menuElement = document.getElementById(AREA_MENU_ELEMENT_ID);
		return Boolean(menuElement) && !menuElement.hidden;
	}

	// `map` is created LAST (bootstrap.js loads after every map-features file), so this cannot be wired at
	// load time -- the same lazy pattern as hookEcosystemViewportReload. Hooking on first open is enough:
	// the menu is only ever opened from a layer that is already on the map.
	function hookEcosystemAreaMenuMapEvents() {
		if (ecosystemAreaMenuMapHooked || typeof map === "undefined" || !map || typeof map.on !== "function") {
			return;
		}
		ecosystemAreaMenuMapHooked = true;
		// Same three closers the map menu uses (bootstrap.js:709-713): a menu pinned to a viewport
		// position must not stay behind while the map moves out from under it.
		map.on("click", closeEcosystemAreaContextMenu);
		map.on("movestart", closeEcosystemAreaContextMenu);
		window.addEventListener("resize", closeEcosystemAreaContextMenu);
	}

	function openEcosystemAreaContextMenu(area, event) {
		const publicId = String(area?.public_id || "").trim();
		if (!publicId) {
			return;
		}

		// The menu acts on ONE area, so that area is also selected: without it a right-click on an
		// overlapping stack would offer "delete" with nothing on screen saying which one.
		if (typeof setSelectedEcosystemArea === "function") {
			setSelectedEcosystemArea(publicId);
		}
		// A map menu left open from an earlier right-click on empty map would otherwise sit next to this
		// one. #region-context-menu is deliberately NOT closed from here -- that is a political file
		// (global rule 1), and this menu is above it in the z-ladder anyway.
		if (typeof closeMapContextMenu === "function") {
			closeMapContextMenu();
		}

		const menuElement = ensureAreaMenuElement();
		activeEcosystemAreaMenuPublicId = publicId;
		hookEcosystemAreaMenuMapEvents();
		menuElement.hidden = false;
		positionAreaMenu(menuElement, event?.originalEvent?.clientX ?? 0, event?.originalEvent?.clientY ?? 0);
	}

	async function deleteEcosystemArea(publicId) {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(publicId)
			: null;
		const area = layer?._ecosystemArea;
		const request = ecosystemAreaDeleteRequest(area);
		if (!request) {
			// Either the area was panned out of the viewport meanwhile (the loader drops it) or the row
			// arrived without a geometry_revision. Both mean "do not guess" -- see the helper.
			say("Diese Fläche ist nicht mehr geladen. Bitte neu laden.", "warning");
			return;
		}

		if (!window.confirm(formatEcosystemAreaDeleteConfirmation(
			area,
			typeof isEcosystemCascadeEnabled === "function" && isEcosystemCascadeEnabled()
		))) {
			return;
		}

		// 💣 Close the open vertex session WITHOUT flushing. A pending batched save (800 ms) that fires
		// after the delete would hit a row that is already is_active = 0 and come back as a failure toast
		// about an area the editor has just deleted on purpose. Writing corners into something about to
		// be removed buys nothing.
		if (typeof closeEcosystemGeometryEdit === "function") {
			closeEcosystemGeometryEdit({ flush: false });
		}

		try {
			const result = await postEcosystemEdit("delete_area", request);
			// Off the map immediately, then through the normal read path -- the same two steps the drawing
			// tool uses. removeEcosystemAreaLayer also deselects, which is what takes any handles with it.
			if (typeof removeEcosystemAreaLayer === "function") {
				removeEcosystemAreaLayer(publicId);
			}
			// 🔴 War es die letzte Fläche der Region, hat der Server die Region und ihre Labels
			// mitgelöscht. Die Labels müssen SOFORT weg: sie kommen aus der Kartennutzlast, und die lädt
			// dieser Weg nicht neu -- ein Name ohne Fläche stünde sonst bis zum nächsten Seitenaufbau da.
			if (typeof removeEcosystemCascadedLabels === "function") {
				removeEcosystemCascadedLabels(result);
			}
			if (typeof invalidateEcosystemRegionCache === "function") {
				invalidateEcosystemRegionCache();
			}
			if (typeof scheduleEcosystemAreaReload === "function") {
				scheduleEcosystemAreaReload({ immediate: true });
			}
			const mitgegangen = Number(result?.labels_deleted) || 0;
			say(result?.region_deleted
				? `Fläche gelöscht — es war die letzte, also ist die Region${mitgegangen > 0 ? ` mit ${mitgegangen === 1 ? "ihrem Label" : `ihren ${mitgegangen} Labels`}` : ""} mitgegangen.`
				: "Fläche gelöscht.");
		} catch (error) {
			// 409 = somebody else moved this area since it was loaded, so the local copy is worthless and
			// only the read path can settle it. error.code / error.status are on the error since 56f14662
			// (map-features-ecosystem-region-picker.js) precisely so this does not have to match German text.
			if (error?.status === 409 || error?.code === "conflict") {
				if (typeof scheduleEcosystemAreaReload === "function") {
					scheduleEcosystemAreaReload({ immediate: true });
				}
				say("Diese Fläche wurde zwischenzeitlich geändert. Sie wurde neu geladen — bitte erneut löschen.", "warning");
				return;
			}
			console.error("Landschaftsflaeche konnte nicht geloescht werden:", error);
			say(error?.message || "Die Fläche konnte nicht gelöscht werden.", "warning");
		}
	}

	function handleAreaMenuClick(event) {
		const actionElement = event.target?.closest?.(`[${AREA_ACTION_ATTRIBUTE}]`);
		if (!actionElement) {
			return false;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		// 💣 Read BEFORE closing -- closeEcosystemAreaContextMenu() clears it, and every handler below
		// needs to know which area the menu was opened on.
		const publicId = activeEcosystemAreaMenuPublicId;
		const action = actionElement.getAttribute(AREA_ACTION_ATTRIBUTE);
		closeEcosystemAreaContextMenu();
		if (action === DELETE_AREA_ACTION) {
			void deleteEcosystemArea(publicId);
			return true;
		}

		// Registered by a sibling file through addEntry. It gets the public_id and looks the row up
		// itself (layer._ecosystemArea), the same way deleteEcosystemArea does -- a narrow contract that
		// cannot go stale when the area shape changes.
		areaMenuEntryHandlers.get(action)?.(publicId);

		return true;
	}

	// ---- wiring -------------------------------------------------------------------------------------

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", ensureNewAreaMenuEntries, { once: true });
		} else {
			ensureNewAreaMenuEntries();
		}

		// One capture-phase click listener for both menus. Capture is what puts it ahead of the delegated
		// jQuery handlers in the bubble phase (routing.js:637 for the map menu, map-features.js:539 for
		// the region menu); stopImmediatePropagation() is what keeps them from also running.
		document.addEventListener("click", (event) => {
			if (handleAreaMenuClick(event) || handleNewAreaMenuClick(event)) {
				return;
			}
			// A click anywhere else closes the area menu -- and does NOT stop the event, so that click
			// still does whatever it was meant to do. Same manners as the map menu.
			if (isEcosystemAreaContextMenuOpen() && !event.target?.closest?.(`#${AREA_MENU_ELEMENT_ID}`)) {
				closeEcosystemAreaContextMenu();
			}
		}, true);

		// Before Leaflet's own contextmenu handler opens and MEASURES the map menu -- see
		// syncMapContextMenuEntries. Runs for every right-click, including one on an area, which is
		// harmless: it only toggles `hidden` on entries of a menu that stays closed in that case.
		document.addEventListener("contextmenu", syncMapContextMenuEntries, true);

		// Escape closes the menu. Deliberately quiet -- it does not stop propagation, so the layer's own
		// Escape (which drops the selection, map-features-ecosystem-edit.js) still runs and the two
		// together mean "never mind": menu gone, selection gone. That handler is registered earlier and
		// therefore fires first; the order does not change the outcome.
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && isEcosystemAreaContextMenuOpen()) {
				closeEcosystemAreaContextMenu();
			}
		}, true);
	}

	// The one global this file adds -- a namespace object rather than three bare top-level functions,
	// because everything else here lives inside the IIFE and cannot collide with the 164 <script> tags
	// sharing one scope (plan, global rule 6). Called from buildEcosystemAreaLayer (guarded), because that
	// is where an area's layer -- and therefore its contextmenu event -- comes into being.
	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemAreaMenu = {
			open: openEcosystemAreaContextMenu,
			close: closeEcosystemAreaContextMenu,
			isOpen: isEcosystemAreaContextMenuOpen,
			// V3.6 and anything after it: one entry point for adding an entry, so a sibling feature never
			// has to reach into this file's DOM or wrap its open().
			addEntry: addEcosystemAreaMenuEntry,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			ecosystemMapMenuVisibility,
			ecosystemAreaDeleteRequest,
			formatEcosystemAreaDeleteConfirmation,
		};
	}
})();
