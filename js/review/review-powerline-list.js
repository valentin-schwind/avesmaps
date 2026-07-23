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
