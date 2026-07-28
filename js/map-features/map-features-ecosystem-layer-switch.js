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

// Active pane: visible and takes clicks. The two resting ones: drawn at 0% fill AND 0% contour, so you
// only ever see the layer you are working in (Owner 2026-07-26, third pass). They stay on the map as
// layers -- switching back is a class swap, not a reload -- and stay click-through, so the question
// "which polygon did I just hit" cannot arise even while something invisible lies underneath.
function syncEcosystemPaneStates() {
	if (typeof map === "undefined" || !map || typeof map.getPane !== "function") {
		return;
	}

	const activeKind = getActiveEcosystemLayerKind();
	const showAll = isEcosystemShowAllLayers();
	ECOSYSTEM_KINDS.forEach((kind) => {
		const pane = map.getPane(ECOSYSTEM_KIND_PANES[kind]);
		if (!pane) {
			return;
		}
		// In „Alle" ist JEDE Ebene aktiv: sichtbar und anklickbar. Die Hausregel „immer nur eine Ebene
		// antwortet" (§2) wird hier bewusst ausgesetzt -- ihr Zweck ist, beim ZEICHNEN die Frage „welches
		// Polygon habe ich erwischt" gar nicht erst entstehen zu lassen, und „Alle" ist der Modus, in dem
		// man genau diese Überlappungen sehen WILL. Was ein Klick trifft, sagt danach die weisse
		// Auswahlkontur.
		pane.classList.toggle("ecosystem-pane--active", showAll || kind === activeKind);
		pane.classList.toggle("ecosystem-pane--resting", !showAll && kind !== activeKind);
		// Eigene Klasse für „Alle", statt es aus „alle drei sind aktiv" zu erraten: das CSS braucht den
		// Modus, um die derographischen Flächen dort zurückzunehmen (siehe ecosystem-layer.css).
		pane.classList.toggle("ecosystem-pane--showall", showAll);
	});

	// Owner 2026-07-26: Karten-Labels benennen die DEROGRAPHISCHE Ebene. Beim Zeichnen von Vegetation
	// oder Topographie sind die fremden davon Störung, und schlimmer: sie liegen (gewollt) über den
	// Flächen und schlucken den Klick, der dem Polygon darunter galt.
	// Owner 2026-07-27: das Klick-Durchreichen bleibt hier an der Pane -- es gilt für ALLE Labels, auch
	// die eigenen, denn ein Regionslabel sitzt am Point of Inaccessibility und damit mitten auf seiner
	// eigenen Fläche. Das Blassmachen ist dagegen ans einzelne Label gewandert (siehe unten).
	const labelsPane = map.getPane("labelsPane");
	if (labelsPane) {
		labelsPane.classList.toggle("ecosystem-labels-dimmed",
			isEcosystemLayerModeActive() && !showAll && activeKind !== "derographisch");
	}
	syncEcosystemLabelMuting();
	// V8: das Relief hängt an derselben Frage wie die Panes -- welche Ebene liegt vorn. Es zeichnet sich
	// bei jeder anderen Lage leer, das Umschalten löscht es also von selbst.
	window.AvesmapsEcosystemHeightRender?.redraw?.();
}

// 🔴 Welche Labels sind in der gerade bearbeiteten Ebene FREMD? Nur die werden blass. Seit jede Region
// ihr eigenes Label hat (label_public_id), gehört zu JEDER Ebene ein Teil der Beschriftungen -- ein
// Waldlabel in der Vegetationsebene blass zu zeichnen war der Fehler, den der Owner gemeldet hat.
//
// Die Zugehörigkeit steht in den geladenen FLÄCHEN: jede trägt ihr `label_public_id` und ihren `kind`.
// Ein Label ohne Fläche (Siedlungen, Gipfel, die grosse Mehrheit) gehört zu keiner Ebene und bleibt
// blass -- ausser in der derographischen, in der noch nie gedimmt wurde.
// Ist dieses Label ein Gipfel? Über `labelData` und nicht über den Marker, weil die Frage auch
// gestellt wird, bevor ein Marker existiert (createLabelIcon baut das Icon mit).
function isEcosystemPeakLabel(labelPublicId) {
	const publicId = String(labelPublicId || "");
	if (!publicId || typeof labelData === "undefined" || !Array.isArray(labelData)) {
		return false;
	}

	return labelData.some((label) => String(label?.publicId || "") === publicId
		&& String(label?.labelType || "") === "berggipfel");
}

// Ein Gipfel in der Topographie-Ebene: sichtbar, anklickbar und direkt ziehbar. Die Klasse hebt für
// ihn die Klickdurchlässigkeit der Labels-Pane wieder auf (css/features/ecosystem-layer.css).
function isEcosystemPeakActive(labelPublicId) {
	return typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive()
		&& getActiveEcosystemLayerKind() === "topographie"
		&& isEcosystemPeakLabel(labelPublicId);
}

function isEcosystemLabelMuted(labelPublicId) {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return false;
	}
	if (isEcosystemShowAllLayers()) {
		return false;
	}
	const activeKind = getActiveEcosystemLayerKind();
	if (activeKind === "derographisch") {
		return false;
	}
	const publicId = String(labelPublicId || "");
	// 🔴 V8: ein `berggipfel` ist in der TOPOGRAPHIE kein fremdes Label, sondern deren Arbeitspunkt.
	// Er trägt die Höhe, aus der das Höhenfeld entsteht (oekosystem-editor-leitfaden.md §1.4), und wer
	// ihn blass und klickdurchlässig macht, macht genau das unbedienbar, was diese Ebene bearbeitet.
	// Die Regel gilt NUR für diesen einen Subtyp -- jeder andere behält sein heutiges Verhalten.
	if (activeKind === "topographie" && isEcosystemPeakLabel(publicId)) {
		return false;
	}
	if (!publicId || typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return true;
	}
	let eigen = false;
	ecosystemLayers.forEach((layer) => {
		const area = layer?._ecosystemArea;
		if (area && area.kind === activeKind && String(area.label_public_id || "") === publicId) {
			eigen = true;
		}
	});
	return !eigen;
}

// 💣 Die Klasse muss ins ICON, nicht nur aufs Element: `syncLabelIcons` baut das Icon bei jedem
// Zoomwechsel neu und `syncLabelMarkerVisibility` hängt Marker aus und wieder ein. Beides ersetzt das
// DOM-Element -- eine Klasse, die nur dort sässe, wäre nach dem ersten Zoom weg. `createLabelIcon`
// ruft dafür `ecosystemLabelMutedClass()` auf.
function ecosystemLabelMutedClass(label) {
	return (isEcosystemLabelMuted(label?.publicId) ? " map-label--eco-muted" : "")
		+ (isEcosystemPeakActive(label?.publicId) ? " map-label--eco-peak" : "");
}

// 🔴 Ziehen ohne Zwischenschritt (V8). Ausserhalb der Topographie braucht ein Label erst den
// Verschiebemodus, damit ein Fehlgriff beim Kartenziehen nicht gleich etwas verrückt. In dieser Ebene
// ist das Verschieben der Gipfel aber die Hauptarbeit -- dort jedes Mal erst ein Menü aufzumachen wäre
// dieselbe Zumutung wie ein Zeichenmodus, den man vor jedem Strich einschaltet.
//
// 💣 Nicht in setLabelMoveActive einhängen: das nimmt eine Sperre und wirft eine Toast-Meldung. Beim
// Ebenenwechsel liefen daraus so viele Sperren und Meldungen, wie Gipfel im Bild sind.
function syncEcosystemPeakDragging() {
	if (typeof labelMarkers === "undefined" || !Array.isArray(labelMarkers)) {
		return;
	}
	labelMarkers.forEach((entry) => {
		const dragging = entry?.marker?.dragging;
		// 🪤 Nur Gipfel anfassen. Ein anderes Label kann gerade im gewöhnlichen Verschiebemodus stehen
		// (setLabelMoveActive, mit Sperre); es hier mit abzuschalten risse dem Editor das Label unter
		// der Maus weg, bloss weil er nebenbei die Ebene gewechselt hat.
		if (!dragging || !isEcosystemPeakLabel(entry.label?.publicId)) {
			return;
		}
		if (isEcosystemPeakActive(entry.label?.publicId)) {
			dragging.enable();
		} else {
			dragging.disable();
		}
	});
}

// Und der Weg andersherum: beim Ebenenwechsel sollen die schon gezeichneten Labels sofort umschalten,
// ohne auf einen Icon-Neubau zu warten.
function syncEcosystemLabelMuting() {
	if (typeof labelMarkers === "undefined" || !Array.isArray(labelMarkers)) {
		return;
	}
	labelMarkers.forEach((entry) => {
		const element = typeof entry?.marker?.getElement === "function" ? entry.marker.getElement() : null;
		if (element) {
			element.classList.toggle("map-label--eco-muted", isEcosystemLabelMuted(entry.label?.publicId));
			element.classList.toggle("map-label--eco-peak", isEcosystemPeakActive(entry.label?.publicId));
		}
	});
	syncEcosystemPeakDragging();
}

// ---- underground opacity (Owner 2026-07-26) --------------------------------------------------------
// The painted terrain and the drawn areas are hard to tell apart, so the base tiles can be faded out
// towards white until the areas stand alone. 0% looks like no base map at all.
//
// 🔴 On the tilePane, NOT on baseTileLayer.getContainer(). setMapStyle() DESTROYS and recreates that
// container on every style switch (bootstrap.js) -- which is exactly why syncPowerlineMapTint has to be
// re-applied there. The pane survives, so this needs no second call site and cannot fall out of sync.
const ECOSYSTEM_UNDERGROUND_STORAGE_KEY = "avesmaps.ecosystem.undergroundOpacity";
// 50%, not 100% (Owner 2026-07-26): the layer is entered to draw on it, and at full strength the
// painted terrain and the drawn areas are hard to tell apart -- which is what the slider exists for.
// Half is where the terrain still guides the pen without competing with it. The slider stays, so
// anyone who wants the full map back is one drag away.
const ECOSYSTEM_UNDERGROUND_DEFAULT = 50;

// 🪤 The raw string is checked for "nothing stored" BEFORE the number conversion. Number(null) is 0 --
// a perfectly finite 0 that passes a 0..100 range check, so converting first made an editor entering
// the layer for the very first time land on 0% and stare at a blank white map. Same shape of trap as
// the active kind, which starts empty for the mirror-image reason.
function readStoredEcosystemUndergroundOpacity() {
	try {
		const raw = window.localStorage?.getItem(ECOSYSTEM_UNDERGROUND_STORAGE_KEY);
		if (raw === null || raw === undefined || String(raw).trim() === "") {
			return ECOSYSTEM_UNDERGROUND_DEFAULT;
		}
		const stored = Number(raw);
		return Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : ECOSYSTEM_UNDERGROUND_DEFAULT;
	} catch (error) {
		return ECOSYSTEM_UNDERGROUND_DEFAULT;
	}
}

function storeEcosystemUndergroundOpacity(percent) {
	try {
		window.localStorage?.setItem(ECOSYSTEM_UNDERGROUND_STORAGE_KEY, String(percent));
	} catch (error) {
		// blocked storage -- the slider still works, it just forgets across reloads
	}
}

// `active` false restores the map completely: this must never leak into the other view modes, where a
// half-faded base map would look like a broken tile server.
function applyEcosystemUndergroundOpacity(active) {
	if (typeof map === "undefined" || !map || typeof map.getPane !== "function") {
		return;
	}

	const tilePane = map.getPane("tilePane");
	const container = typeof map.getContainer === "function" ? map.getContainer() : null;
	const percent = active ? readStoredEcosystemUndergroundOpacity() : 100;

	if (tilePane) {
		tilePane.style.opacity = percent >= 100 ? "" : String(percent / 100);
	}
	if (container) {
		// The white shows THROUGH the fading tiles, so it has to sit behind them. Set after
		// setSelectedMapLayerMode has written its own background, which is why this runs from
		// syncEcosystemControlsVisibility and not from the mode setter.
		container.style.background = (active && percent < 100)
			? getComputedStyle(document.documentElement).getPropertyValue("--color-ecosystem-underground").trim()
			: "";
	}
}

function syncEcosystemUndergroundControl() {
	const rangeElement = document.getElementById("ecosystem-underground-range");
	const valueElement = document.getElementById("ecosystem-underground-value");
	const percent = readStoredEcosystemUndergroundOpacity();
	if (rangeElement) {
		rangeElement.value = String(percent);
	}
	if (valueElement) {
		valueElement.textContent = `${percent} %`;
	}
}

function setEcosystemUndergroundOpacity(percent) {
	const normalized = Math.max(0, Math.min(100, Math.round(Number(percent))));
	if (!Number.isFinite(normalized)) {
		return;
	}
	storeEcosystemUndergroundOpacity(normalized);
	syncEcosystemUndergroundControl();
	applyEcosystemUndergroundOpacity(true);
}

// ---- „Alle" -- alle drei Ebenen gleichzeitig zeigen (Owner 2026-07-27) -----------------------------
// 🔴 EIN ANZEIGE-FLAG, KEIN VIERTER `kind`. Der Ebenen-Zustand reist zum Server (list_regions,
// create_region), und AVESMAPS_ECOSYSTEM_KINDS kennt genau drei Werte -- „alle" gäbe dort 400, und
// isKnownEcosystemKind lehnt ihn ab, sodass der gemerkte Wert still auf die Vorgabe zurückfiele. Die
// gemerkte Arbeitsebene bleibt also erhalten, „Alle" ändert nur, was SICHTBAR und anklickbar ist.
//
// Zweck: Überlappungen sehen. Genau dafür waren die ruhenden Ebenen auf 0 % gesetzt -- das macht das
// Zeichnen ruhig, verbirgt aber, dass ein Wald über einen See läuft.
const ECOSYSTEM_SHOW_ALL_STORAGE_KEY = "avesmaps.ecosystem.showAllLayers";
let ecosystemShowAllLayers = null;   // null = noch nicht aus dem Speicher geholt

function isEcosystemShowAllLayers() {
	if (ecosystemShowAllLayers === null) {
		try {
			ecosystemShowAllLayers = window.localStorage?.getItem(ECOSYSTEM_SHOW_ALL_STORAGE_KEY) === "1";
		} catch (error) {
			ecosystemShowAllLayers = false;
		}
	}
	return ecosystemShowAllLayers;
}

function setEcosystemShowAllLayers(on) {
	ecosystemShowAllLayers = Boolean(on);
	try {
		window.localStorage?.setItem(ECOSYSTEM_SHOW_ALL_STORAGE_KEY, ecosystemShowAllLayers ? "1" : "0");
	} catch (error) {
		// gesperrter Speicher -- der Schalter wirkt trotzdem, er überlebt nur kein Neuladen
	}
	syncEcosystemLayerSwitchControls();
	syncEcosystemPaneStates();
}

function syncEcosystemLayerSwitchControls() {
	const activeKind = getActiveEcosystemLayerKind();
	const showAll = isEcosystemShowAllLayers();
	document.querySelectorAll("[data-ecosystem-kind]").forEach((tabElement) => {
		// In „Alle" trägt KEINE Ebenen-Kachel die Hervorhebung -- sonst sähe es aus, als sei sie allein
		// aktiv, während alle drei antworten. Die gemerkte Arbeitsebene bleibt darunter bestehen.
		const isActive = !showAll && tabElement.dataset.ecosystemKind === activeKind;
		tabElement.classList.toggle("is-active", isActive);
		tabElement.setAttribute("aria-selected", isActive ? "true" : "false");
		// Roving tabindex: one stop for the whole tablist, arrow keys move inside it.
		tabElement.tabIndex = isActive ? 0 : -1;
	});
	document.querySelectorAll("[data-ecosystem-show-all]").forEach((tabElement) => {
		tabElement.classList.toggle("is-active", showAll);
		tabElement.setAttribute("aria-selected", showAll ? "true" : "false");
		tabElement.tabIndex = showAll ? 0 : -1;
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

	// 🪤 In „Alle" NICHT abwählen. Der Grund unten gilt dort nicht -- es gibt keine ruhende Pane, die
	// Fläche bleibt sichtbar und anklickbar. Ohne diese Bedingung verlöre ein Klick auf eine Fläche
	// einer ANDEREN Ebene seine eigene Auswahl sofort wieder: der Klick stellt die Arbeitsebene um, und
	// das Umstellen räumte die gerade getroffene Auswahl weg.
	if (changed && !isEcosystemShowAllLayers() && typeof setSelectedEcosystemArea === "function") {
		// The selected area just moved into a resting pane, where it can no longer be clicked away.
		setSelectedEcosystemArea("");
	}
	// V3.0b: the active region is remembered per kind, so switching the layer switches the region the
	// next drawn area goes into. Guarded because V3.0 ships without the picker.
	if (changed && typeof syncEcosystemRegionCache === "function") {
		syncEcosystemRegionCache();
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
		if (event.target?.closest?.("[data-ecosystem-show-all]")) {
			setEcosystemShowAllLayers(true);
			return;
		}
		const tabElement = event.target?.closest?.("[data-ecosystem-kind]");
		if (tabElement) {
			// Eine Ebene zu wählen heisst, „Alle" zu verlassen -- die Kacheln sind EINE Auswahl, nicht ein
			// Schalter neben drei Knöpfen. Erst das Flag, dann die Ebene: sonst räumte der Wechsel noch
			// unter der alten Bedingung die Auswahl weg.
			setEcosystemShowAllLayers(false);
			setActiveEcosystemLayerKind(tabElement.dataset.ecosystemKind);
		}
	});
	switchElement.addEventListener("keydown", handleEcosystemLayerSwitchKeydown);

	// `input`, not `change`: the whole point of the slider is watching the terrain go while dragging.
	document.getElementById("ecosystem-underground-range")
		?.addEventListener("input", (event) => setEcosystemUndergroundOpacity(event.target.value));
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

	// Both effects are restored on the way OUT, before the early return: a half-faded base map or a
	// dimmed label pane left behind in "Politisch" would read as a broken map, not as a setting.
	applyEcosystemUndergroundOpacity(shouldShow);
	// 🔴 Auf BEIDEN Wegen. Der Doppelklick-Zoom ist in dieser Ebene aus und muss beim Verlassen wieder
	// an sein -- eine Karte, die nach einem Moduswechsel nicht mehr auf Doppelklick zoomt, wäre für
	// jeden ausserhalb des Editors einfach kaputt. Deshalb vor dem frühen Return und danach.
	if (typeof syncEcosystemDoubleClickZoom === "function") {
		syncEcosystemDoubleClickZoom();
	}
	if (!shouldShow) {
		syncEcosystemPaneStates();
		return;
	}

	syncEcosystemLayerSwitchControls();
	syncEcosystemUndergroundControl();
	syncEcosystemPaneStates();
	// V3.0b: the region picker lives in the same box and follows the active kind. Entering the mode
	// refetches, so the area counts in the row are the current ones.
	if (typeof syncEcosystemRegionCache === "function") {
		syncEcosystemRegionCache({ refresh: true });
	}
}
