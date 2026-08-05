// Kraftlinien-Editor overlay -- the sixth list editor. Same shared shell
// (css/components/editor-shell.css, avm-editor-* classes) as the settlement editor
// (openAvesmapsSettlementEditorOverlay in review-settlement-list.js), its own self-contained iframe
// page html/wiki-sync-powerline-editor.html loaded with ?v=Date.now() (no ASSET_VERSION -- the host
// cache-busts the document; the deploy stamps the CSS/JS it links). A powerline is line-centric but
// segment-backed; the editor page groups over the shared name and delegates topology to
// js/map-features/powerline-topology.js. Design: docs/superpowers/specs/2026-07-23-kraftlinien-editor-design.md
//
// Optional preselect by line NAME: the map popup's "Bearbeiten" opens this editor already on the
// clicked line (§11) via postMessage into the same-origin iframe.
window.openAvesmapsPowerlineEditorOverlay = window.openAvesmapsPowerlineEditorOverlay || function openAvesmapsPowerlineEditorOverlay(preselectName) {
	const overlayId = "avesmaps-powerline-editor-overlay";
	const buildSrc = () => "/html/wiki-sync-powerline-editor.html?v=" + Date.now();
	const postSelect = (frame) => {
		const name = (preselectName == null ? "" : String(preselectName)).trim();
		if (!name || !frame || !frame.contentWindow) {
			return;
		}
		try { frame.contentWindow.postMessage({ avesmapsPowerlineSelect: name }, location.origin); } catch (e) { /* noop */ }
	};
	let overlay = document.getElementById(overlayId);
	if (overlay) {
		overlay.hidden = false;
		document.body.style.overflow = "hidden";
		postSelect(overlay.querySelector("iframe"));
		return;
	}
	overlay = document.createElement("div");
	overlay.id = overlayId;
	overlay.className = "avm-editor-overlay";
	const dialog = document.createElement("div");
	dialog.className = "avm-editor-dialog";
	const header = document.createElement("div");
	header.className = "avm-editor-dialog__header";
	const headingEl = document.createElement("h2");
	headingEl.textContent = "Kraftlinien bearbeiten";
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "avm-editor-dialog__close";
	closeButton.setAttribute("aria-label", "Schließen");
	closeButton.textContent = "✕";
	const closeOverlay = () => { overlay.hidden = true; document.body.style.overflow = ""; };
	closeButton.addEventListener("click", closeOverlay);
	header.appendChild(headingEl);
	header.appendChild(closeButton);
	const frame = document.createElement("iframe");
	frame.className = "avm-editor-dialog__frame";
	frame.src = buildSrc();
	frame.title = "Kraftlinien-Editor";
	// A newly built iframe is not loaded yet -- post the preselect once it is.
	frame.addEventListener("load", () => postSelect(frame));
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};

// The editor iframe asks the parent to fly the live map to a node ("◎ auf Karte zeigen" in the
// Knoten column). Kept here rather than in the iframe because only the parent holds the map + marker
// index. No-op if the map is not ready or the node is not on the map.
window.avesmapsFlyToLocationPublicId = window.avesmapsFlyToLocationPublicId || function avesmapsFlyToLocationPublicId(publicId) {
	try {
		if (typeof findLocationMarkerByPublicId !== "function" || typeof map === "undefined" || !map) {
			return;
		}
		const entry = findLocationMarkerByPublicId(publicId);
		if (entry && entry.marker && typeof entry.marker.getLatLng === "function") {
			map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.6 });
		}
	} catch (e) { /* noop */ }
};

// ---------------------------------------------------------------------------------------------
// Panel list (WikiSync „Kraftlinien" tab): the ~40 lines grouped by name, so the tab shows a list
// like every other subject instead of a static hint. Double-clicking a line switches the map to
// powerline mode and zooms to it. Read straight from the app's powerlineData (no API -- a powerline
// is many segments sharing a name), grouped with the same shared topology helpers the editor uses.
// The loader is wired in setWikiSyncPanelTab (review-wiki-sync.js); rendering also re-runs when the
// data (re)loads (preparePowerlineData / applyLivePowerlineFeature).
// ---------------------------------------------------------------------------------------------
let avesmapsPowerlineSyncFilterText = "";

function avesmapsPowerlinePanelNodeName(publicId) {
	if (typeof findLocationMarkerByPublicId !== "function") { return ""; }
	const entry = findLocationMarkerByPublicId(publicId);
	return entry ? String(entry.name || "").trim() : "";
}

function avesmapsPowerlinePanelSpanText(topology) {
	if (!topology) { return ""; }
	if (topology.endpointIds.length === 2) {
		const a = avesmapsPowerlinePanelNodeName(topology.endpointIds[0]);
		const b = avesmapsPowerlinePanelNodeName(topology.endpointIds[1]);
		return (a && b) ? (a + " ↔ " + b) : "";
	}
	if (topology.isRing) { return "geschlossener Ring"; }
	if (topology.endpointIds.length > 0) { return topology.endpointIds.length + " Enden"; }
	return "";
}

// Group all powerline segments by name and attach the shared topology. Sorted by name (de).
function avesmapsPowerlinePanelGroups() {
	const all = (typeof powerlineData !== "undefined" && Array.isArray(powerlineData)) ? powerlineData : [];
	const byName = new Map();
	all.forEach((segment) => {
		const name = String((segment && segment.properties && segment.properties.name) || "").trim();
		if (name === "") { return; }
		if (!byName.has(name)) { byName.set(name, []); }
		byName.get(name).push(segment);
	});
	const lookup = (typeof powerlineAppNodeLookup === "function") ? powerlineAppNodeLookup : (() => null);
	return [...byName.entries()].map(([name, segments]) => ({
		name,
		segments,
		topology: (typeof avesmapsPowerlineTopology === "function") ? avesmapsPowerlineTopology(segments, lookup) : null,
	})).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

// Render the list into #powerline-sync-list. Idempotent: re-run on data load, tab switch, search.
function renderPowerlineSyncList() {
	const list = document.getElementById("powerline-sync-list");
	if (!list) { return; }
	const esc = (typeof escapeHtml === "function") ? escapeHtml : ((s) => String(s == null ? "" : s));
	const groups = avesmapsPowerlinePanelGroups();
	const summary = document.getElementById("powerline-sync-summary");
	if (summary) {
		const segCount = (typeof powerlineData !== "undefined" && Array.isArray(powerlineData)) ? powerlineData.length : 0;
		summary.textContent = groups.length + " Kraftlinien · " + segCount + " Segmente";
	}
	if (groups.length === 0) {
		list.innerHTML = '<div class="wikisync-itemlist__empty" style="padding:8px;color:var(--color-text-muted);">Keine Kraftlinien geladen.</div>';
		return;
	}
	const term = avesmapsPowerlineSyncFilterText.trim().toLowerCase();
	const visible = term ? groups.filter((g) => g.name.toLowerCase().indexOf(term) !== -1) : groups;
	if (visible.length === 0) {
		list.innerHTML = '<div class="wikisync-itemlist__empty" style="padding:8px;color:var(--color-text-muted);">Nichts gefunden.</div>';
		return;
	}
	list.innerHTML = visible.map((g) => {
		const nodeCount = g.topology ? g.topology.adjacency.size : 0;
		const span = avesmapsPowerlinePanelSpanText(g.topology);
		const meta = nodeCount + " Nodices · " + g.segments.length + " Segmente" + (span ? " · " + span : "");
		return '<div class="tree-item region-sync__item powerline-sync__item" data-powerline-name="' + esc(g.name) + '"'
			+ ' title="Doppelklick: im Kraftlinienmodus auf diese Linie zoomen" style="cursor:pointer;">'
			+ '<span class="tree-item-name">' + esc(g.name) + '</span>'
			+ '<span class="tree-item-meta">' + esc(meta) + '</span>'
			+ '</div>';
	}).join("");
}

// Double-click a line -> powerline mode + zoom to the whole line (delegated, attached once).
document.addEventListener("dblclick", (event) => {
	const target = event.target;
	const row = (target && target.closest) ? target.closest(".powerline-sync__item[data-powerline-name]") : null;
	if (!row) { return; }
	const name = String(row.getAttribute("data-powerline-name") || "").trim();
	const all = (typeof powerlineData !== "undefined" && Array.isArray(powerlineData)) ? powerlineData : [];
	const rep = all.find((s) => String((s && s.properties && s.properties.name) || "").trim() === name);
	if (!rep) { return; }
	if (typeof setSelectedMapLayerMode === "function") { setSelectedMapLayerMode("powerlines"); }
	if (typeof showWholePowerlineFromInfobox === "function") { showWholePowerlineFromInfobox(rep); }
});

// Search box over the list (same document-input pattern as review-path-sync.js's #path-sync-filter).
document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "powerline-sync-filter") {
		avesmapsPowerlineSyncFilterText = event.target.value || "";
		renderPowerlineSyncList();
	}
});
