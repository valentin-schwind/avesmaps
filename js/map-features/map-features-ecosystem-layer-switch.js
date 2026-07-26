// Landschaften (Erprobung) -- the segment switch "Derographische Region · Vegetation · Topographie"
// (plan V3.0, steps 1 and 5). It owns exactly two things: which kind is ACTIVE, and how the three
// panes look because of it. It never loads and never re-renders a layer.
//
// 🔴 THREE VISIBILITY GATES, NOT ONE. The template (#political-timeline) hangs on
// `getSelectedMapLayerMode() === "political"` AND an edit/read-only gate
// (map-features-political-timeline.js:19). Copying only the mode check would show this switch to an
// anonymous visitor who landed in the mode through somebody else's link. The dead-man switch has a
// station here (plan, global rule 4, station 6): mode + IS_EDIT_MODE + IS_ECOSYSTEM_ENABLED.
//
// 🔴 Switching does NOT reload and does NOT drop anything. All three layers stay on the map; only the
// pane classes change, which is why `pointer-events` had to be a pane property in the first place.
// (Once V3.3 brings a vertex editor, an open edit has to be committed BEFORE the switch runs -- there
// is no edit session to protect yet, so there is nothing to hook here now.)

const ECOSYSTEM_ACTIVE_KIND_STORAGE_KEY = "avesmaps.ecosystem.activeKind";

// Vegetation first: that is where most of the drawing work is (plan V3.0, step 1).
const ECOSYSTEM_DEFAULT_KIND = "vegetation";

let ecosystemLayerSwitchBound = false;

function readStoredEcosystemLayerKind() {
	try {
		const stored = window.localStorage?.getItem(ECOSYSTEM_ACTIVE_KIND_STORAGE_KEY) || "";
		return isKnownEcosystemKind(stored) ? stored : ECOSYSTEM_DEFAULT_KIND;
	} catch (error) {
		// Blocked storage (private mode, hardened profile) is not an error worth a console line.
		return ECOSYSTEM_DEFAULT_KIND;
	}
}

function storeEcosystemLayerKind(kind) {
	try {
		window.localStorage?.setItem(ECOSYSTEM_ACTIVE_KIND_STORAGE_KEY, kind);
	} catch (error) {
		// see above
	}
}

function getActiveEcosystemLayerKind() {
	if (!isKnownEcosystemKind(activeEcosystemLayerKind)) {
		activeEcosystemLayerKind = readStoredEcosystemLayerKind();
	}
	return activeEcosystemLayerKind;
}

// The three gates. Everything visible in this feature asks this one question.
function isEcosystemLayerModeActive() {
	return typeof getSelectedMapLayerMode === "function"
		&& getSelectedMapLayerMode() === "ecosystem"
		&& typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE
		&& typeof IS_ECOSYSTEM_ENABLED !== "undefined" && IS_ECOSYSTEM_ENABLED;
}

// Active pane: full opacity, takes clicks. The two resting ones: pale and click-through, so the
// question "which polygon did I just hit" cannot arise while three layers overlap.
function syncEcosystemPaneStates() {
	if (typeof map === "undefined" || !map || typeof map.getPane !== "function") {
		return;
	}

	const activeKind = getActiveEcosystemLayerKind();
	ECOSYSTEM_KINDS.forEach((kind) => {
		const pane = map.getPane(ECOSYSTEM_KIND_PANES[kind]);
		if (!pane) {
			return;
		}
		pane.classList.toggle("ecosystem-pane--active", kind === activeKind);
		pane.classList.toggle("ecosystem-pane--resting", kind !== activeKind);
	});
}

function syncEcosystemLayerSwitchControls() {
	const activeKind = getActiveEcosystemLayerKind();
	document.querySelectorAll("[data-ecosystem-kind]").forEach((tabElement) => {
		const isActive = tabElement.dataset.ecosystemKind === activeKind;
		tabElement.classList.toggle("is-active", isActive);
		tabElement.setAttribute("aria-selected", isActive ? "true" : "false");
		// Roving tabindex: one stop for the whole tablist, arrow keys move inside it.
		tabElement.tabIndex = isActive ? 0 : -1;
	});
}

function setActiveEcosystemLayerKind(kind, { focusTab = false } = {}) {
	if (!isKnownEcosystemKind(kind)) {
		return;
	}

	const changed = kind !== getActiveEcosystemLayerKind();
	activeEcosystemLayerKind = kind;
	storeEcosystemLayerKind(kind);
	syncEcosystemLayerSwitchControls();
	syncEcosystemPaneStates();

	if (changed && typeof setSelectedEcosystemArea === "function") {
		// The selected area just moved into a resting pane, where it can no longer be clicked away.
		setSelectedEcosystemArea("");
	}
	// V3.0b: the active region is remembered per kind, so switching the layer switches the region the
	// next drawn area goes into. Guarded because V3.0 ships without the picker.
	if (changed && typeof syncEcosystemRegionPicker === "function") {
		syncEcosystemRegionPicker();
	}

	if (focusTab) {
		const activeTab = document.querySelector(`[data-ecosystem-kind="${kind}"]`);
		activeTab?.focus();
	}
}

function handleEcosystemLayerSwitchKeydown(event) {
	const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
	if (!keys.includes(event.key)) {
		return;
	}

	event.preventDefault();
	const currentIndex = ECOSYSTEM_KINDS.indexOf(getActiveEcosystemLayerKind());
	const lastIndex = ECOSYSTEM_KINDS.length - 1;
	let nextIndex = currentIndex;

	if (event.key === "Home") {
		nextIndex = 0;
	} else if (event.key === "End") {
		nextIndex = lastIndex;
	} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
		nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
	} else {
		nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
	}

	setActiveEcosystemLayerKind(ECOSYSTEM_KINDS[nextIndex], { focusTab: true });
}

function bindEcosystemLayerSwitch() {
	if (ecosystemLayerSwitchBound) {
		return;
	}
	const switchElement = document.getElementById("ecosystem-layer-switch");
	if (!switchElement) {
		return;
	}

	ecosystemLayerSwitchBound = true;
	switchElement.addEventListener("click", (event) => {
		const tabElement = event.target?.closest?.("[data-ecosystem-kind]");
		if (tabElement) {
			setActiveEcosystemLayerKind(tabElement.dataset.ecosystemKind);
		}
	});
	switchElement.addEventListener("keydown", handleEcosystemLayerSwitchKeydown);
}

// Called by syncEcosystemVisibility on every mode change -- the one entry point this feature has.
function syncEcosystemControlsVisibility() {
	const controlsElement = document.getElementById("ecosystem-controls");
	if (!controlsElement) {
		return;
	}

	bindEcosystemLayerSwitch();
	const shouldShow = isEcosystemLayerModeActive();
	controlsElement.hidden = !shouldShow;

	if (!shouldShow) {
		return;
	}

	syncEcosystemLayerSwitchControls();
	syncEcosystemPaneStates();
}
