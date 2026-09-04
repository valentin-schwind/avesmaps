/* 🪤 04.09.2026 Stempel-Heilung nach einem abgebrochenen Deploy -- die Begruendung steht in css/components/fenster.css. */
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
// Button and window title read the same words, "Landschaften bearbeiten" (spec §2; umbenannt am
// 24.08.2026 -- 🔴 nur die BESCHRIFTUNG, der Schluessel `ecosystem.editor.title` bleibt. Where the label was
// already reserved "as soon as it exists").
window.openAvesmapsEcosystemEditorOverlay = window.openAvesmapsEcosystemEditorOverlay || function openAvesmapsEcosystemEditorOverlay() {
	const overlayId = "avesmaps-ecosystem-editor-overlay";
	// 💣 The language has to be handed over explicitly. The iframe has its OWN location.search
	// (just ?v=…), so js/app/i18n.js inside it would never see the host's ?lang=en and would fall
	// back to German -- an English app with a German editor window. The localStorage fallback
	// (the DE|EN toggle) does carry across same-origin, but ?lang=en alone does not.
	const buildSrc = () => {
		const lang = (typeof window.avesmapsActiveLang === "string") ? window.avesmapsActiveLang : "";
		return "/html/landschaften-editor.html?v=" + Date.now() + (lang ? "&lang=" + encodeURIComponent(lang) : "");
	};
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
	dialog.className = "avm-editor-dialog avm-fenster avm-fenster--werkzeug";
	// 🔴 role="dialog" IST die Zieh-Verdrahtung: js/ui/dialog-drag.js delegiert am Dokument und
	//    erkennt ein Fenster genau daran. Ohne das Attribut zeigt der Kopf seinen Griff und den
	//    Greif-Zeiger, und nichts bewegt sich -- ein Versprechen ohne Mechanik.
	// 💣 NICHT zusaetzlich avesmapsEditorDialogZiehbar rufen: das Fenster zoege dann doppelt so
	//    weit wie der Zeiger (dieselbe Doppelanmeldung wie beim Sammelmenue im Menueband).
	dialog.setAttribute("role", "dialog");
	// tr() only in the HOST document: js/app/i18n.js is loaded here, not in the editor iframe.
	// German is the default and stays it; ?lang=en swaps in js/app/i18n-en.js (AGENTS.md §8).
	const t = (key, german) => (typeof tr === "function" ? tr(key, german) : german);
	const closeOverlay = () => { overlay.hidden = true; document.body.style.overflow = ""; };
	// 🔴 EIN Bauteil fuer alle sieben Fenster-Koepfe (js/ui/fenster-kopf.js). Hier stand bis zum
	//    04.09.2026 die vierte von sieben Abschriften desselben Blocks.
	const kopfteile = avesmapsFensterKopf(t("ecosystem.editor.title", "Landschaften bearbeiten"), {
		wirtsklasse: "avm-editor-dialog__header",
		schliessenAria: t("ecosystem.editor.closeAria", "Schließen"),
		aufSchliessen: closeOverlay,
	});
	const header = kopfteile.kopf;
	const closeButton = kopfteile.schliessen;
	const frame = document.createElement("iframe");
	frame.className = "avm-editor-dialog__frame";
	frame.src = buildSrc();
	frame.title = t("ecosystem.editor.frameTitle", "Landschaften-Editor");
	dialog.appendChild(header);
	dialog.appendChild(frame);
	overlay.appendChild(dialog);
	// 🔴 Das geteilte Bauteil, nicht die Abschrift: es prueft DRUCK UND LOSLASSEN. Ein blosses
	//    `event.target === overlay` schliesst auch dann, wenn jemand IM Fenster markiert und dabei
	//    ueber den Rand hinauszieht -- bei einem Editorfenster mit Formular ist das teuer.
	avesmapsDialogHintergrundSchliessen(overlay, closeOverlay);
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};
