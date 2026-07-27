/*
 * Landschaften (Erprobung) -- the one-time notice shown the FIRST time an editor enters the layer
 * (plan V3.5).
 *
 * Why a run-through and not a warning: "eine Warnung ohne Konsequenz wird weggeklickt", and the editors
 * start drawing immediately. So the notice hands out three concrete steps -- draw ONE area, pan, reload,
 * is it still there -- instead of asking for care. Whoever follows them has verified the whole
 * persistence chain on a single area before drawing a series that might have to be thrown away.
 *
 * The other two thirds of V3.5 are already standing and are deliberately NOT rebuilt here:
 * the mode entry is permanently named "Landschaften (Erprobung)", and is_trial is decided SERVER-side
 * (api/_internal/app/ecosystem.php:960-962 via :304-307). A client that sent is_trial itself would
 * switch that protection off -- "a client that never heard of the trial cannot smuggle a permanent area
 * into a trial run or the other way round".
 *
 * ⭐ "Already seen" is NEW in this project. All existing avesmaps.* localStorage keys are PREFERENCES
 * (tab, layer, map view, theme, language); none of them records that something was shown once. This key
 * borrows their SHAPE (namespaced, try/catch) but not their meaning -- so the next reader does not go
 * looking for a pattern that is not there.
 *
 * 🔴 The overlay shell (position, scrim, stacking) is NOT styled by this feature. A new overlay <div>
 * inherits NOTHING: #ecosystem-intro-overlay is entered into the three selector lists in
 * css/components/dialog-overlays.css (:19 hidden, :35 fixed + scrim, :63 z-index). Miss one and the
 * dialog renders static, transparent and in the middle of the document flow.
 */
(function () {
	const OVERLAY_ELEMENT_ID = "ecosystem-intro-overlay";
	const DIALOG_ELEMENT_ID = "ecosystem-intro-dialog";
	const CONFIRM_ELEMENT_ID = "ecosystem-intro-confirm";
	const CLOSE_ELEMENT_ID = "ecosystem-intro-close";

	const ECOSYSTEM_INTRO_STORAGE_KEY = "avesmaps.ecosystem.introSeen";
	const ECOSYSTEM_INTRO_SEEN_VALUE = "1";

	let introBound = false;
	// Second gate next to localStorage, and not redundant: with storage blocked (private mode, hardened
	// profile) readSeen() keeps answering false, and the notice would come back on EVERY mode entry --
	// and switching modes is something an editor does constantly. Dismissed once is dismissed for this
	// page load, whether or not the write landed.
	let dismissedThisSession = false;

	function readEcosystemIntroSeen() {
		try {
			return window.localStorage?.getItem(ECOSYSTEM_INTRO_STORAGE_KEY) === ECOSYSTEM_INTRO_SEEN_VALUE;
		} catch (error) {
			// Blocked storage is not an error worth a console line -- same call as in
			// map-features-ecosystem-layer-switch.js:23-39.
			return false;
		}
	}

	function markEcosystemIntroSeen() {
		try {
			window.localStorage?.setItem(ECOSYSTEM_INTRO_STORAGE_KEY, ECOSYSTEM_INTRO_SEEN_VALUE);
		} catch (error) {
			// see above -- dismissedThisSession carries the rest of this page load
		}
	}

	// The whole "einmalig" contract in one place, free of DOM and storage so it can be tested. Written on
	// DISMISS, not on open: a notice whose point is that it gets READ must survive a reload that happened
	// before anyone read it.
	function shouldShowEcosystemIntro({ seen = false, dismissedInSession = false, modeActive = false, dialogOpen = false } = {}) {
		return Boolean(modeActive) && !seen && !dismissedInSession && !dialogOpen;
	}

	function isEcosystemIntroDialogOpen() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		return Boolean(overlayElement) && !overlayElement.hidden;
	}

	// Wohin der Fokus nach dem Hinweis geht. Zurück kann er nicht -- den Dialog hat kein Knopf geöffnet,
	// sondern der Moduswechsel.
	//
	// 🪤 Früher landete er auf „Fläche zeichnen". Den Knopf gibt es seit dem 2026-07-27 nicht mehr; die
	// erste Handlung ist jetzt ein RECHTSKLICK auf die Karte, und darauf kann man keinen Fokus setzen.
	// Er wird deshalb abgelegt, statt auf einem Element zu bleiben, das gerade verschwunden ist.
	function restoreFocusAfterEcosystemIntro() {
		const active = document.activeElement;
		if (active && typeof active.blur === "function") {
			active.blur();
		}
	}

	function closeEcosystemIntroDialog() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement || overlayElement.hidden) {
			return;
		}
		overlayElement.hidden = true;
		dismissedThisSession = true;
		markEcosystemIntroSeen();
		restoreFocusAfterEcosystemIntro();
	}

	function bindEcosystemIntroDialog() {
		if (introBound) {
			return;
		}
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement) {
			return;
		}

		introBound = true;
		document.getElementById(CONFIRM_ELEMENT_ID)?.addEventListener("click", closeEcosystemIntroDialog);
		document.getElementById(CLOSE_ELEMENT_ID)?.addEventListener("click", closeEcosystemIntroDialog);
		// Click on the scrim closes; a click inside the dialog must not.
		overlayElement.addEventListener("click", (event) => {
			if (event.target === overlayElement) {
				closeEcosystemIntroDialog();
			}
		});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && isEcosystemIntroDialogOpen()) {
				event.stopPropagation();
				closeEcosystemIntroDialog();
			}
		});
	}

	// Called from syncEcosystemVisibility() -- the ONE entry point of the layer, which also runs on the
	// state restore after F5. Not bootstrap.js: the notice belongs to entering the layer, not to loading
	// the page.
	function maybeShowEcosystemIntro() {
		const modeActive = typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive();
		if (!shouldShowEcosystemIntro({
			seen: readEcosystemIntroSeen(),
			dismissedInSession: dismissedThisSession,
			modeActive,
			dialogOpen: isEcosystemIntroDialogOpen(),
		})) {
			return;
		}

		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement) {
			return;
		}
		bindEcosystemIntroDialog();
		overlayElement.hidden = false;

		// 💣 DEFERRED, and measured in the browser -- focusing here directly does not stick. The usual way
		// into this mode is the layer combobox, and ui-controls.js:474-476 does
		// `$(select).trigger("change"); closeTransportMenu(); control.buttonElement.focus();` -- the change
		// handler runs SYNCHRONOUSLY, so the whole chain down to this line happens on line 474 and line 476
		// then pulls focus back to the button. The modal would stand open with the keyboard behind its own
		// scrim. setTimeout and not requestAnimationFrame: rAF does not fire in a hidden tab.
		window.setTimeout(() => {
			if (!isEcosystemIntroDialogOpen()) {
				return;
			}
			// The confirm button, not the shell: it makes Enter dismiss straight away, and role="dialog" +
			// aria-labelledby/-describedby still get the title and the steps announced on the way in.
			(document.getElementById(CONFIRM_ELEMENT_ID) || document.getElementById(DIALOG_ELEMENT_ID))?.focus();
		}, 0);
	}

	// One global, a namespace object -- everything else here stays inside the IIFE and cannot collide with
	// the 164 <script> tags sharing one scope (plan, global rule 6).
	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemIntro = {
			maybeShow: maybeShowEcosystemIntro,
			close: closeEcosystemIntroDialog,
			isOpen: isEcosystemIntroDialogOpen,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { shouldShowEcosystemIntro };
	}
})();
