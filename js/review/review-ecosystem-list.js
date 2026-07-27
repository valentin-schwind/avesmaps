// Landschaften-Editor overlay -- the SEVENTH list editor, and the one the code had been holding a
// slot open for: js/review/review-subjects.js carried `editorButtonId: null` on the `regions` row
// with a comment naming exactly this gap. Plan: docs/superpowers/plans/2026-07-27-landschaften-editor.md
//
// Built like the SIXTH (openAvesmapsPowerlineEditorOverlay in review-powerline-list.js), not like the
// four older ones:
//   * the shared shell css/components/editor-shell.css with the avm-editor-* classes -- NOT the
//     political-territory-editor-* classes, which four editors still wear although only one of them
//     is the territory editor (spec §1.2: "the hull exists, but it lies about its name"). A new
//     editor has no legacy to carry.
//   * its own self-contained iframe page html/landschaften-editor.html, loaded with ?v=Date.now():
//     the host invalidates the DOCUMENT itself, the deploy stamps the CSS/JS it links. Never
//     ASSET_VERSION -- that governs the dynamically loaded TERRITORY editor assets (AGENTS.md §7).
//
// Button and window title read the same words, "Regionen bearbeiten" (spec §2, where the label was
// already reserved "as soon as it exists").
window.openAvesmapsEcosystemEditorOverlay = window.openAvesmapsEcosystemEditorOverlay || function openAvesmapsEcosystemEditorOverlay() {
	const overlayId = "avesmaps-ecosystem-editor-overlay";
	const buildSrc = () => "/html/landschaften-editor.html?v=" + Date.now();
	let overlay = document.getElementById(overlayId);
	if (overlay) {
		overlay.hidden = false;
		document.body.style.overflow = "hidden";
		return;
	}
	overlay = document.createElement("div");
	overlay.id = overlayId;
	overlay.className = "avm-editor-overlay";
	const dialog = document.createElement("div");
	dialog.className = "avm-editor-dialog";
	const header = document.createElement("div");
	header.className = "avm-editor-dialog__header";
	// tr() only in the HOST document: js/app/i18n.js is loaded here, not in the editor iframe.
	// German is the default and stays it; ?lang=en swaps in js/app/i18n-en.js (AGENTS.md §8).
	const t = (key, german) => (typeof tr === "function" ? tr(key, german) : german);
	const headingEl = document.createElement("h2");
	headingEl.textContent = t("ecosystem.editor.title", "Regionen bearbeiten");
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "avm-editor-dialog__close";
	closeButton.setAttribute("aria-label", t("ecosystem.editor.closeAria", "Schließen"));
	closeButton.textContent = "✕";
	const closeOverlay = () => { overlay.hidden = true; document.body.style.overflow = ""; };
	closeButton.addEventListener("click", closeOverlay);
	header.appendChild(headingEl);
	header.appendChild(closeButton);
	const frame = document.createElement("iframe");
	frame.className = "avm-editor-dialog__frame";
	frame.src = buildSrc();
	frame.title = t("ecosystem.editor.frameTitle", "Landschaften-Editor");
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};
