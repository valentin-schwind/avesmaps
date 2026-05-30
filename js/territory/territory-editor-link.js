"use strict";

const POLITICAL_TERRITORY_DISPLAY_OVERRIDES_API_URL = "/api/edit/political/display-overrides.php";
const POLITICAL_TERRITORY_WIKI_API_URL = "/api/app/political-territory-wiki.php";

let activePoliticalTerritoryEditorRegion = null;
let pendingPoliticalTerritoryEditorFrameSetup = null;
let activePoliticalTerritoryEditorPendingLocalOverride = false;
let activePoliticalTerritoryEditorPromoteNextSave = false;
let activePoliticalTerritoryEditorOverrideFooterSuppressedUntil = 0;
let politicalTerritoryEditorFrameSetupAttempts = 0;
let politicalTerritoryWikiRowsByIdPromise = null;

function createPoliticalTerritoryEditorUrl(regionEntry = {}) {
	const params = new URLSearchParams();
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry);
	const geometryId = String(regionEntry.geometryId || regionEntry.geometry_id || "").trim();
	const territoryPublicId = String(regionEntry.territoryPublicId || regionEntry.territory_public_id || "").trim();
	const wikiKey = String(regionEntry.wikiKey || regionEntry.wiki_key || regionEntry.wikiId || regionEntry.wiki_id || "").trim();
	const name = String(regionEntry.displayName || regionEntry.name || "").trim();
	const color = String(regionEntry.color || "").trim();
	const opacity = Number(regionEntry.opacity);
	const minZoom = regionEntry.minZoom ?? regionEntry.min_zoom ?? "";
	const maxZoom = regionEntry.maxZoom ?? regionEntry.max_zoom ?? "";
	const validFromBf = regionEntry.validFromBf ?? regionEntry.valid_from_bf ?? "";
	const validToBf = regionEntry.validToBf ?? regionEntry.valid_to_bf ?? "";

	if (geometryPublicId) params.set("geometry_public_id", geometryPublicId);
	if (geometryId) params.set("geometry_id", geometryId);
	if (territoryPublicId) params.set("territory_public_id", territoryPublicId);
	if (wikiKey) params.set("wiki_key", wikiKey);
	if (name) params.set("name", name);
	if (color) params.set("color", color);
	if (Number.isFinite(opacity)) params.set("opacity", String(opacity));
	if (minZoom !== "" && minZoom !== null && typeof minZoom !== "undefined") params.set("min_zoom", String(minZoom));
	if (maxZoom !== "" && maxZoom !== null && typeof maxZoom !== "undefined") params.set("max_zoom", String(maxZoom));
	if (validFromBf !== "" && validFromBf !== null && typeof validFromBf !== "undefined") params.set("valid_from_bf", String(validFromBf));
	if (validToBf !== "" && validToBf !== null && typeof validToBf !== "undefined") params.set("valid_to_bf", String(validToBf));
	if (typeof map !== "undefined" && typeof map.getZoom === "function") {
		const currentZoom = Number(map.getZoom());
		if (Number.isFinite(currentZoom)) {
			params.set("current_zoom", String(currentZoom));
		}
	}

	return `/html/political-territory-editor.html${params.toString() ? `?${params.toString()}` : ""}`;
}

function getPoliticalTerritoryEditorGeometryPublicId(regionEntry = {}) {
	return String(regionEntry.geometryPublicId || regionEntry.geometry_public_id || regionEntry.publicId || "").trim();
}

function getPoliticalTerritoryEditorElements() {
	return {
		overlay: document.getElementById("political-territory-editor-overlay"),
		dialog: document.getElementById("political-territory-editor-dialog"),
		closeButton: document.getElementById("political-territory-editor-close"),
		frame: document.getElementById("political-territory-editor-frame"),
		host: document.getElementById("political-territory-editor-host"),
	};
}

function setPoliticalTerritoryEditorOpen(isOpen) {
	const { overlay, dialog } = getPoliticalTerritoryEditorElements();
	if (!overlay) return;
	overlay.hidden = !isOpen;
	if (typeof syncModalDialogBodyState === "function") syncModalDialogBodyState();
	if (isOpen) dialog?.focus();
}

function isPoliticalTerritoryEditorOpen() {
	const { overlay } = getPoliticalTerritoryEditorElements();
	return Boolean(overlay && !overlay.hidden);
}

function closePoliticalTerritoryEditor() {
	const { frame } = getPoliticalTerritoryEditorElements();
	setPoliticalTerritoryEditorOpen(false);
	activePoliticalTerritoryEditorRegion = null;
	pendingPoliticalTerritoryEditorFrameSetup = null;
	activePoliticalTerritoryEditorPendingLocalOverride = false;
	activePoliticalTerritoryEditorPromoteNextSave = false;
	activePoliticalTerritoryEditorOverrideFooterSuppressedUntil = 0;
	politicalTerritoryEditorFrameSetupAttempts = 0;
	if (frame) frame.removeAttribute("src");
	// Inline-Editor: Markup bleibt geladen (Wiederverwendung); nur den Kontext leeren.
	window.AvesmapsPoliticalTerritoryEditorContext = null;
}

function createEmbeddedPoliticalTerritoryEditorUrl(regionEntry = {}) {
	const url = createPoliticalTerritoryEditorUrl(regionEntry);
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}embedded=1`;
}

// Baut das Kontext-Objekt, das der inline geladene Editor statt der iframe-URL liest.
function buildPoliticalTerritoryEditorContext(regionEntry = {}) {
	const context = { embedded: "1" };
	const set = (key, value) => {
		if (value === "" || value === null || typeof value === "undefined") return;
		context[key] = String(value);
	};
	set("geometry_public_id", getPoliticalTerritoryEditorGeometryPublicId(regionEntry));
	set("geometry_id", regionEntry.geometryId ?? regionEntry.geometry_id);
	set("territory_public_id", regionEntry.territoryPublicId ?? regionEntry.territory_public_id);
	set("wiki_key", regionEntry.wikiKey ?? regionEntry.wiki_key ?? regionEntry.wikiId ?? regionEntry.wiki_id);
	set("name", regionEntry.displayName ?? regionEntry.name);
	set("color", regionEntry.color);
	const opacity = Number(regionEntry.opacity);
	if (Number.isFinite(opacity)) set("opacity", opacity);
	set("min_zoom", regionEntry.minZoom ?? regionEntry.min_zoom);
	set("max_zoom", regionEntry.maxZoom ?? regionEntry.max_zoom);
	set("valid_from_bf", regionEntry.validFromBf ?? regionEntry.valid_from_bf);
	set("valid_to_bf", regionEntry.validToBf ?? regionEntry.valid_to_bf);
	if (typeof map !== "undefined" && typeof map.getZoom === "function") {
		const currentZoom = Number(map.getZoom());
		if (Number.isFinite(currentZoom)) set("current_zoom", currentZoom);
	}
	return context;
}

// Feature #1.2: Wenn der aktive Breadcrumb-Knoten gerenderte Geometrie hat, die
// Karte darauf fokussieren; geometrielose (zeilenlose/synthetische) Knoten lassen
// die Ansicht ruhig. Laeuft im Host-Scope (map/regionPolygons/L sind hier global).
let politicalTerritoryEditorActiveNodeFocusBound = false;
let politicalTerritoryEditorFocusToken = 0;

function focusMapOnActiveTerritoryNode(activeNode) {
	try {
		if (!activeNode || typeof map === "undefined") return;
		const territoryPublicId = String(activeNode.territoryPublicId || activeNode.territory_public_id || "").trim();
		if (!territoryPublicId) return; // zeilenloser Knoten / keine Geometrie -> Ansicht ruhig
		if (typeof POLITICAL_TERRITORIES_API_URL === "undefined" || !POLITICAL_TERRITORIES_API_URL) return;

		// Bounding-Box render-unabhaengig vom Backend holen (gerenderte Layer sind
		// zoom-/aggregationsgefiltert und enthalten den aktiven Knoten oft gar nicht).
		const token = ++politicalTerritoryEditorFocusToken;
		const separator = POLITICAL_TERRITORIES_API_URL.indexOf("?") >= 0 ? "&" : "?";
		const url = `${POLITICAL_TERRITORIES_API_URL}${separator}action=territory_bounds&public_id=${encodeURIComponent(territoryPublicId)}`;
		fetch(url, { credentials: "same-origin" })
			.then((response) => (response.ok ? response.json() : null))
			.then((result) => {
				if (token !== politicalTerritoryEditorFocusToken) return; // veraltet (schnelles Blaettern)
				const b = result && result.bounds;
				if (!b) return; // keine Geometrie -> Ansicht ruhig
				// Simple-CRS: lat = y, lng = x.
				const bounds = L.latLngBounds([[b.min_y, b.min_x], [b.max_y, b.max_x]]);
				if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
			})
			.catch(() => {});
	} catch (error) {
		console.warn("Karten-Fokus auf aktiven Knoten fehlgeschlagen:", error);
	}
}

function ensurePoliticalTerritoryEditorActiveNodeFocus() {
	if (politicalTerritoryEditorActiveNodeFocusBound) return;
	const store = window.AvesmapsEditorActiveNode;
	if (!store || typeof store.subscribe !== "function") return;
	politicalTerritoryEditorActiveNodeFocusBound = true;
	store.subscribe(focusMapOnActiveTerritoryNode);
}

function openPoliticalTerritoryEditor(regionEntry = {}) {
	const { overlay, host } = getPoliticalTerritoryEditorElements();
	const inlineHost = window.AvesmapsPoliticalTerritoryEditorInlineHost;
	if (!overlay || !host || !inlineHost) {
		if (typeof openRegionEditDialog === "function") {
			openRegionEditDialog(regionEntry, { title: "Eigenschaften bearbeiten" });
		}
		return;
	}

	activePoliticalTerritoryEditorRegion = regionEntry;
	pendingPoliticalTerritoryEditorFrameSetup = regionEntry;
	activePoliticalTerritoryEditorPendingLocalOverride = false;
	activePoliticalTerritoryEditorPromoteNextSave = false;
	activePoliticalTerritoryEditorOverrideFooterSuppressedUntil = 0;
	politicalTerritoryEditorFrameSetupAttempts = 0;

	// Eingabe ueber das Kontext-Objekt bereitstellen (ersetzt die iframe-URL).
	window.AvesmapsPoliticalTerritoryEditorContext = buildPoliticalTerritoryEditorContext(regionEntry);
	setPoliticalTerritoryEditorOpen(true);

	inlineHost.load()
		.then(() => setupPoliticalTerritoryEditorInline(regionEntry))
		.catch((error) => {
			console.error("Inline-Editor konnte nicht geladen werden:", error);
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast("Editor konnte nicht geladen werden.", "error");
			}
		});
}

// Verdrahtet den inline geladenen Editor direkt (kein iframe-Polling/Monkeypatch).
function setupPoliticalTerritoryEditorInline(regionEntry) {
	const assignmentModule = window.AvesmapsPoliticalTerritoryAssignment;
	if (!assignmentModule || typeof assignmentModule.configure !== "function") {
		politicalTerritoryEditorFrameSetupAttempts += 1;
		if (politicalTerritoryEditorFrameSetupAttempts < 40) {
			window.setTimeout(() => setupPoliticalTerritoryEditorInline(regionEntry), 50);
		}
		return;
	}
	politicalTerritoryEditorFrameSetupAttempts = 0;

	assignmentModule.configure({
		onSave: (value) => savePoliticalTerritoryEditorAssignment(regionEntry, value),
		onUnassign: () => unassignPoliticalTerritoryEditorGeometry(regionEntry),
		onAssignmentLoaded: (assignmentInfo) => handlePoliticalTerritoryEditorAssignmentLoaded(assignmentInfo),
		onCancel: () => closePoliticalTerritoryEditor(),
	});

	ensurePoliticalTerritoryEditorActiveNodeFocus();

	// Wiki-Links im Baum-Meta inline beobachten (zuvor iframe-dokumentbezogen).
	try {
		const hostEl = getPoliticalTerritoryEditorElements().host;
		if (hostEl && !hostEl.dataset.wikiLinkObserverBound) {
			hostEl.dataset.wikiLinkObserverBound = "1";
			const applyWikiLinks = () => {
				for (const link of hostEl.querySelectorAll('[data-role="tree-meta"] a, .tree-item-meta a, .info-box a')) {
					if (link.dataset.wikiLinkBound === "1") continue;
					link.dataset.wikiLinkBound = "1";
					link.setAttribute("target", "_blank");
					link.setAttribute("rel", "noopener noreferrer");
				}
			};
			applyWikiLinks();
			new MutationObserver(applyWikiLinks).observe(hostEl, { childList: true, subtree: true });
		}
	} catch (error) { /* Wiki-Link-Verschoenerung ist optional. */ }

	// Frisch fuer die aktuelle Geometrie laden, falls der Editor schon einmal offen war.
	if (typeof assignmentModule.reload === "function") {
		try { assignmentModule.reload(); } catch (error) { /* erster Lauf laedt selbst */ }
	}
	pendingPoliticalTerritoryEditorFrameSetup = null;
}

function setupPoliticalTerritoryEditorFrame() {
	const { frame } = getPoliticalTerritoryEditorElements();
	const regionEntry = pendingPoliticalTerritoryEditorFrameSetup || activePoliticalTerritoryEditorRegion;
	if (!frame || !regionEntry) return;

	installPoliticalTerritoryEditorOverrideFooter(frame, regionEntry);
	installPoliticalTerritoryEditorTreeMetaWikiLinks(frame);

	const assignmentModule = frame.contentWindow?.AvesmapsPoliticalTerritoryAssignment;
	if (!assignmentModule || typeof assignmentModule.configure !== "function") {
		politicalTerritoryEditorFrameSetupAttempts += 1;
		if (politicalTerritoryEditorFrameSetupAttempts < 40) {
			window.setTimeout(setupPoliticalTerritoryEditorFrame, 100);
		}
		return;
	}

	assignmentModule.configure({
		onSave: (value) => savePoliticalTerritoryEditorAssignment(regionEntry, value),
		onUnassign: () => unassignPoliticalTerritoryEditorGeometry(regionEntry),
		onAssignmentLoaded: (assignmentInfo) => handlePoliticalTerritoryEditorAssignmentLoaded(assignmentInfo),
		onCancel: () => closePoliticalTerritoryEditor(),
	});
	politicalTerritoryEditorFrameSetupAttempts = 0;
	schedulePoliticalTerritoryEditorOverrideFooterRefresh(regionEntry);
	pendingPoliticalTerritoryEditorFrameSetup = null;
}

function handlePoliticalTerritoryEditorAssignmentLoaded(assignmentInfo = {}) {
	const activeGeometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(activePoliticalTerritoryEditorRegion || {});
	const loadedGeometryPublicId = String(assignmentInfo?.geometryPublicId || "").trim();

	if (activeGeometryPublicId && loadedGeometryPublicId && activeGeometryPublicId !== loadedGeometryPublicId) {
		return;
	}

	const hasLocalAssignmentDisplays = Boolean(assignmentInfo?.hasLocalAssignmentDisplays);

	if (hasLocalAssignmentDisplays && isPoliticalTerritoryEditorOverrideFooterSuppressed()) {
		return;
	}

	if (!hasLocalAssignmentDisplays) {
		clearPoliticalTerritoryEditorOverrideFooterSuppression();
	}

	activePoliticalTerritoryEditorPendingLocalOverride = hasLocalAssignmentDisplays;
	syncPoliticalTerritoryEditorOverrideFooterVisibility(hasLocalAssignmentDisplays);
}

function schedulePoliticalTerritoryEditorOverrideFooterRefresh(regionEntry = activePoliticalTerritoryEditorRegion) {
	[0, 150, 500, 1200].forEach((delay) => {
		window.setTimeout(() => {
			void refreshPoliticalTerritoryEditorOverrideFooter(regionEntry);
		}, delay);
	});
}

function getPoliticalTerritoryEditorFrameDocument(frame = getPoliticalTerritoryEditorElements().frame) {
	return frame?.contentDocument || frame?.contentWindow?.document || null;
}

function getPoliticalTerritoryOverrideFooterModule() {
	return window.AvesmapsPoliticalTerritoryOverrideFooter || null;
}
function installPoliticalTerritoryEditorOverrideFooter(frame, regionEntry) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.install === "function") {
		module.install(frame, regionEntry);
	}
}
function installPoliticalTerritoryEditorTreeMetaWikiLinks(frame) {
	const doc = getPoliticalTerritoryEditorFrameDocument(frame);
	if (!doc || doc.__avesmapsTreeMetaWikiLinksInstalled === true) return;
	doc.__avesmapsTreeMetaWikiLinksInstalled = true;

	const style = doc.createElement("style");
	style.textContent = `
		.tree-item-meta a {
			color: inherit;
			font-weight: 700;
			text-decoration: underline;
			text-underline-offset: 2px;
		}
	`;
	doc.head.append(style);

	const update = () => {
		void applyPoliticalTerritoryEditorTreeMetaWikiLinks(frame);
	};

	const observer = new MutationObserver(update);
	const attachObserver = () => {
		const treeView = doc.getElementById("treeView");
		if (!treeView) return false;
		observer.observe(treeView, { childList: true, subtree: true });
		update();
		return true;
	};

	if (!attachObserver()) {
		[150, 500, 1200].forEach((delay) => window.setTimeout(attachObserver, delay));
	}
}

async function loadPoliticalTerritoryWikiRowsById() {
	if (!politicalTerritoryWikiRowsByIdPromise) {
		politicalTerritoryWikiRowsByIdPromise = fetch(POLITICAL_TERRITORY_WIKI_API_URL, {
			method: "GET",
			credentials: "omit",
			headers: { "Accept": "application/json" },
		}).then(async (response) => {
			const payload = await response.json();
			if (!response.ok || payload?.ok === false) {
				throw new Error(payload?.error || `Wiki-Daten konnten nicht geladen werden: HTTP ${response.status}`);
			}
			const rowsById = new Map();
			for (const row of Array.isArray(payload?.items) ? payload.items : []) {
				const rowId = Number(row?.id || 0);
				if (rowId > 0) rowsById.set(rowId, row);
			}
			return rowsById;
		});
	}
	return politicalTerritoryWikiRowsByIdPromise;
}

async function applyPoliticalTerritoryEditorTreeMetaWikiLinks(frame) {
	const doc = getPoliticalTerritoryEditorFrameDocument(frame);
	if (!doc) return;
	const metaElements = [...doc.querySelectorAll("#treeView .tree-item-meta")]
		.filter((meta) => meta instanceof HTMLElement && meta.dataset.wikiLinkFormatted !== "1");
	if (metaElements.length < 1) return;

	let rowsById = null;
	try {
		rowsById = await loadPoliticalTerritoryWikiRowsById();
	} catch (error) {
		console.warn("Wiki-Links fuer Tree-Metadaten konnten nicht geladen werden:", error);
		return;
	}

	for (const meta of metaElements) {
		const text = String(meta.textContent || "").trim();
		const idMatch = text.match(/\bID:\s*(\d+)\b/u);
		if (!idMatch) continue;
		const row = rowsById.get(Number(idMatch[1]));
		const wikiUrl = String(row?.wiki_url || "").trim();
		if (!wikiUrl) continue;

		const innerText = text.replace(/^\(/u, "").replace(/\)$/u, "").trim();
		meta.textContent = "";
		meta.append(doc.createTextNode(`(${innerText}, `));
		const link = doc.createElement("a");
		link.href = wikiUrl;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = "Wiki";
		link.addEventListener("click", (event) => event.stopPropagation());
		meta.append(link, doc.createTextNode(")"));
		meta.dataset.wikiLinkFormatted = "1";
	}
}

function syncPoliticalTerritoryEditorOverrideFooterVisibility(isVisible) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.syncVisibility === "function") {
		module.syncVisibility(isVisible);
		return;
	}
	const doc = getPoliticalTerritoryEditorFrameDocument();
	const footer = doc?.getElementById("political-territory-local-override-footer");
	if (footer) footer.hidden = !isVisible;
}
function suppressPoliticalTerritoryEditorOverrideFooter(durationMs = 2000) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.suppress === "function") {
		module.suppress(durationMs);
		return;
	}
	const duration = Number(durationMs);
	const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 2000;
	activePoliticalTerritoryEditorOverrideFooterSuppressedUntil = Date.now() + safeDuration;
	activePoliticalTerritoryEditorPendingLocalOverride = false;
	syncPoliticalTerritoryEditorOverrideFooterVisibility(false);
}
function clearPoliticalTerritoryEditorOverrideFooterSuppression() {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.clearSuppression === "function") {
		module.clearSuppression();
		return;
	}
	activePoliticalTerritoryEditorOverrideFooterSuppressedUntil = 0;
}
function isPoliticalTerritoryEditorOverrideFooterSuppressed() {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.isSuppressed === "function") {
		return module.isSuppressed();
	}
	return activePoliticalTerritoryEditorOverrideFooterSuppressedUntil > Date.now();
}
async function refreshPoliticalTerritoryEditorOverrideFooter(regionEntry = activePoliticalTerritoryEditorRegion) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.refresh !== "function") {
		return;
	}
	return module.refresh(regionEntry);
}
async function resetPoliticalTerritoryEditorLocalDisplay(regionEntry = activePoliticalTerritoryEditorRegion) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.resetLocalDisplay !== "function") {
		return;
	}
	return module.resetLocalDisplay(regionEntry);
}
async function promotePoliticalTerritoryEditorLocalDisplay(frame = getPoliticalTerritoryEditorElements().frame) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.promoteLocalDisplay !== "function") {
		throw new Error("Die lokale Darstellung konnte nicht global uebernommen werden.");
	}
	return module.promoteLocalDisplay(frame);
}
async function snapshotPoliticalTerritoryEditorGlobals(value = {}) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.snapshotGlobals !== "function") {
		return null;
	}
	return module.snapshotGlobals(value);
}
async function restorePoliticalTerritoryEditorGlobals(snapshotResult) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.restoreGlobals !== "function") {
		return null;
	}
	return module.restoreGlobals(snapshotResult);
}
async function clearPoliticalTerritoryEditorLocalOverrides(geometryPublicId) {
	const module = getPoliticalTerritoryOverrideFooterModule();
	if (typeof module?.clearLocalOverrides !== "function") {
		return null;
	}
	return module.clearLocalOverrides(geometryPublicId);
}
async function savePoliticalTerritoryEditorAssignment(regionEntry, value = {}) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry);
	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Bitte das Herrschaftsgebiet erneut aus der Karte oeffnen.");
	}

	const shouldPromote = activePoliticalTerritoryEditorPromoteNextSave === true;
	activePoliticalTerritoryEditorPromoteNextSave = false;
	const globalSnapshot = shouldPromote ? null : await snapshotPoliticalTerritoryEditorGlobals(value);
	const assignedPath = Array.isArray(value.assignedPath) ? value.assignedPath : [];
	const displays = Array.isArray(value.displays) ? value.displays : [];
	const wikiPublicIds = assignedPath.map((node) => String(node?.wikiKey || "").trim()).filter(Boolean);
	const territoryPublicIds = assignedPath.map((node) => String(node?.territoryPublicId || "").trim()).filter(Boolean);
	const hasAssignedTerritory = assignedPath.length > 0 && (wikiPublicIds.length > 0 || territoryPublicIds.length > 0);
	const display = buildPoliticalTerritoryEditorDisplayPayload(regionEntry, value);
	const validity = buildPoliticalTerritoryEditorValidityPayload(regionEntry, value);
	const displayName = String(display.displayName || display.name || "").trim();
	const shouldCreateTerritoryFromGeometry = !hasAssignedTerritory && displayName !== "";

	const result = await submitPoliticalTerritoryEdit({
		action: "save_geometry_assignment",
		geometry_public_id: geometryPublicId,
		display_only: !hasAssignedTerritory && !shouldCreateTerritoryFromGeometry,
		create_territory_if_missing: shouldCreateTerritoryFromGeometry,
		territory_name: shouldCreateTerritoryFromGeometry ? displayName : "",
		display,
		validity,
		wiki_public_ids: wikiPublicIds,
		territory_public_ids: territoryPublicIds,
		wiki_nodes: buildPoliticalTerritoryEditorWikiNodes(assignedPath, displays, wikiPublicIds),
		assignment: value,
	});

	if (shouldPromote) {
		await syncPoliticalTerritoryEditorAssignmentZooms(value);
		await clearPoliticalTerritoryEditorLocalOverrides(geometryPublicId);
		suppressPoliticalTerritoryEditorOverrideFooter();
	} else {
		await restorePoliticalTerritoryEditorGlobals(globalSnapshot);
	}

	activePoliticalTerritoryEditorPendingLocalOverride = false;
	// Optimistisches Sofort-Update: die soeben gespeicherten Display-Werte des aktiven
	// Knotens als Pending-Override registrieren, damit der naechste Layer-Render sie zeigt,
	// ohne auf einen erneuten Komplettabruf der Territorienliste warten zu muessen.
	const savedTerritoryPublicId = String(
		value.activeDisplayNode?.territoryPublicId
		|| value.activeDisplayNode?.territory_public_id
		|| territoryPublicIds[territoryPublicIds.length - 1]
		|| ""
	).trim();
	if (savedTerritoryPublicId && typeof registerPoliticalTerritoryPendingStyleOverride === "function") {
		registerPoliticalTerritoryPendingStyleOverride(savedTerritoryPublicId, {
			color: display.color,
			opacity: display.opacity,
			minZoom: display.zoomMin,
			maxZoom: display.zoomMax,
		});
	}
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast(shouldPromote ? "Lokale Darstellung global Ã¼bernommen." : result?.message || "Herrschaftsgebiet gespeichert.", "success");
	}
	window.setTimeout(closePoliticalTerritoryEditor, 0);
	return result;
}

async function syncPoliticalTerritoryEditorAssignmentZooms(value = {}) {
	const displays = Array.isArray(value.displays) ? value.displays : [];
	const syncDisplays = displays.filter((display) => String(display?.territoryPublicId || "").trim() !== "");
	if (syncDisplays.length < 1) return null;

	try {
		const response = await fetch("/api/edit/political/assignment-zoom-sync.php", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ displays: syncDisplays }),
		});
		const result = await response.json().catch(() => null);
		if (!response.ok || result?.ok === false) {
			throw new Error(result?.error || "Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden.");
		}
		return result;
	} catch (error) {
		console.warn("Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden:", error);
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(error.message || "Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden.", "warning");
		}
		return null;
	}
}

async function unassignPoliticalTerritoryEditorGeometry(regionEntry) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry);
	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Bitte das Herrschaftsgebiet erneut aus der Karte oeffnen.");
	}

	const result = await submitPoliticalTerritoryEdit({
		action: "unassign_geometry",
		geometry_public_id: geometryPublicId,
	});
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") showFeedbackToast(result?.message || "Zuweisung entfernt.", "success");
	window.setTimeout(closePoliticalTerritoryEditor, 0);
	return result;
}

function buildPoliticalTerritoryEditorDisplayPayload(regionEntry, value = {}) {
	const display = value.display || {};
	const opacity = Number(display.opacity ?? regionEntry.opacity ?? 0.33);
	return {
		name: String(display.name || display.displayName || regionEntry.displayName || regionEntry.name || "").trim(),
		displayName: String(display.displayName || display.name || regionEntry.displayName || regionEntry.name || "").trim(),
		coatOfArmsUrl: String(display.coatOfArmsUrl || display.alternateCoatOfArmsUrl || regionEntry.coatOfArmsUrl || "").trim(),
		zoomMin: parsePoliticalTerritoryEditorNumber(display.zoomMin ?? regionEntry.minZoom ?? regionEntry.min_zoom),
		zoomMax: parsePoliticalTerritoryEditorNumber(display.zoomMax ?? regionEntry.maxZoom ?? regionEntry.max_zoom),
		color: String(display.color || regionEntry.color || "#888888").trim() || "#888888",
		opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.33,
	};
}

function buildPoliticalTerritoryEditorValidityPayload(regionEntry, value = {}) {
	const validity = value.validity || {};
	const endYear = parsePoliticalTerritoryEditorNumber(validity.endYear ?? regionEntry.validToBf ?? regionEntry.valid_to_bf);
	const existsUntilToday = typeof validity.existsUntilToday === "boolean" ? validity.existsUntilToday : endYear === null;
	return {
		startYear: parsePoliticalTerritoryEditorNumber(validity.startYear ?? regionEntry.validFromBf ?? regionEntry.valid_from_bf),
		endYear: existsUntilToday ? null : endYear,
		existsUntilToday,
	};
}

function buildPoliticalTerritoryEditorWikiNodes(assignedPath, displays, wikiPublicIds) {
	return assignedPath.map((node, index) => {
		const display = displays[index] || {};
		return {
			key: wikiPublicIds[index] || node?.wikiKey || node?.territoryPublicId || "",
			territoryPublicId: node?.territoryPublicId || "",
			territoryId: node?.territoryId || null,
			name: display.displayName || node?.label || node?.key || "",
			type: node?.kind || "Herrschaftsgebiet",
			status: "",
			coat_of_arms_url: display.coatOfArmsUrl || "",
			wiki_url: "",
		};
	});
}

function parsePoliticalTerritoryEditorNumber(value) {
	if (value === "" || value === null || typeof value === "undefined") return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function refreshPoliticalTerritoryEditorMapLayer() {
	// Nur den Karten-Layer neu laden. Der Wiki-Optionsbaum aendert sich bei einer
	// Eigenschafts-/Zuweisungs-Bearbeitung nicht und muss hier nicht neu geholt werden.
	if (typeof schedulePoliticalTerritoryLayerReload === "function") schedulePoliticalTerritoryLayerReload({ immediate: true });
}

function getPoliticalTerritoryDragAssignmentModule() {
	return window.AvesmapsPoliticalTerritoryDragAssignment || null;
}
function readWikiSyncTerritoryDragPayload(dataTransfer) {
	const module = getPoliticalTerritoryDragAssignmentModule();
	return typeof module?.readDragPayload === "function" ? module.readDragPayload(dataTransfer) : null;
}
function buildWikiSyncTerritoryAssignmentValueFromPayload(payload) {
	const module = getPoliticalTerritoryDragAssignmentModule();
	if (typeof module?.buildAssignmentValueFromPayload === "function") {
		return module.buildAssignmentValueFromPayload(payload);
	}
	return {
		assignedPath: [],
		editedPath: [],
		displays: [],
		display: {},
		validity: {},
	};
}
async function assignWikiSyncTerritoryPayloadToRegionGeometry(payload, regionEntry) {
	const module = getPoliticalTerritoryDragAssignmentModule();
	if (typeof module?.assignPayloadToRegionGeometry !== "function") {
		throw new Error("Die Drag-and-drop-Zuweisung ist nicht verfuegbar.");
	}
	return module.assignPayloadToRegionGeometry(payload, regionEntry);
}
async function assignWikiSyncTerritoryPayloadInsideLegacyEditor(payload) {
	const module = getPoliticalTerritoryDragAssignmentModule();
	if (typeof module?.assignPayloadInsideLegacyEditor !== "function") {
		return false;
	}
	return module.assignPayloadInsideLegacyEditor(payload);
}
function initializeWikiSyncTerritoryDragAssignment() {
	const module = getPoliticalTerritoryDragAssignmentModule();
	if (typeof module?.initialize === "function") {
		module.initialize();
	}
}
function initializePoliticalTerritoryEditorPopup() {
	const { overlay, closeButton, frame } = getPoliticalTerritoryEditorElements();
	closeButton?.addEventListener("click", closePoliticalTerritoryEditor);
	frame?.addEventListener("load", setupPoliticalTerritoryEditorFrame);
	overlay?.addEventListener("click", (event) => {
		if (event.target === overlay) closePoliticalTerritoryEditor();
	});
	initializeWikiSyncTerritoryDragAssignment();
}

function openPoliticalTerritoryWikiSyncSettings() {
	const openedWindow = window.open("/html/wiki-dom-sync-settings.html", "_blank", "noopener,noreferrer");
	if (!openedWindow && typeof setWikiSyncStatus === "function") {
		setWikiSyncStatus("Popup blockiert: Bitte Popups erlauben oder Link in neuem Tab Ã¶ffnen.", "error");
	}
}

window.startWikiSyncTerritoryRun = function startWikiSyncTerritoryRunFromSettingsLink() {
	if (typeof setWikiSyncStatus === "function") setWikiSyncStatus("Synchronisierungseinstellungen werden geÃ¶ffnet...", "pending");
	openPoliticalTerritoryWikiSyncSettings();
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initializePoliticalTerritoryEditorPopup, { once: true });
} else {
	initializePoliticalTerritoryEditorPopup();
}

window.AvesmapsPoliticalTerritoryEditorLink = {
	createUrl: createPoliticalTerritoryEditorUrl,
	open: openPoliticalTerritoryEditor,
	close: closePoliticalTerritoryEditor,
	isOpen: isPoliticalTerritoryEditorOpen,
};
