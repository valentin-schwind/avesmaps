// Landschaften (Erprobung) -- "which region does the next drawn area go into?" (plan V3.0b).
//
// 🔴 WHY THIS EXISTS AT ALL. One region carries MANY areas (owner decision 1), so create_area demands a
// region_public_id and refuses an unknown or inactive one with 400. Without a picker, the drawing tool
// (V3.2) would produce nameless geometry. This is the smallest thing that makes V3's own acceptance
// criterion -- "a NAMED area" -- reachable; the full three-column landscape editor is V6.
//
// Two ways, no more: pick an existing region of the active kind, or create one. The active region is
// remembered PER kind, so flipping the segment switch flips the region with it.
//
// 🔴 The region list comes from api/edit/map/ecosystem.php (action list_regions), behind the `edit`
// capability -- NOT from the public read path (which would widen the public surface for an editor
// question) and NOT from the political layer (plan, global rule 1).

const ECOSYSTEM_ACTIVE_REGION_STORAGE_KEY = "avesmaps.ecosystem.activeRegion";

// kind -> array of regions / region types, as last answered by list_regions. null = never loaded.
let ecosystemRegionsByKind = {};
let ecosystemRegionTypesByKind = {};
let ecosystemRegionPickerBound = false;
// Monotonic, same reason as in the area loader: a slow answer for a kind the editor has already left
// must not repaint the picker.
let ecosystemRegionRequestToken = 0;
let ecosystemRegionDialogBusy = false;

function readStoredEcosystemRegionIds() {
	try {
		const stored = JSON.parse(window.localStorage?.getItem(ECOSYSTEM_ACTIVE_REGION_STORAGE_KEY) || "{}");
		return stored && typeof stored === "object" ? stored : {};
	} catch (error) {
		return {};
	}
}

function storeEcosystemRegionIds() {
	try {
		window.localStorage?.setItem(ECOSYSTEM_ACTIVE_REGION_STORAGE_KEY, JSON.stringify(activeEcosystemRegionId || {}));
	} catch (error) {
		// blocked storage -- the picker still works, it just forgets across reloads
	}
}

function getActiveEcosystemRegionId(kind = getActiveEcosystemLayerKind()) {
	if (!activeEcosystemRegionId || typeof activeEcosystemRegionId !== "object") {
		activeEcosystemRegionId = {};
	}
	// Hydrated lazily on first read, exactly like the active kind: runtime-state.js may not assume
	// localStorage is readable at load time.
	if (!Object.prototype.hasOwnProperty.call(activeEcosystemRegionId, kind)) {
		const stored = readStoredEcosystemRegionIds();
		activeEcosystemRegionId[kind] = String(stored[kind] || "");
	}

	return String(activeEcosystemRegionId[kind] || "");
}

function setActiveEcosystemRegionId(publicId, kind = getActiveEcosystemLayerKind()) {
	getActiveEcosystemRegionId(kind); // makes sure the object is hydrated before we write into it
	activeEcosystemRegionId[kind] = String(publicId || "");
	storeEcosystemRegionIds();
}

async function postEcosystemEdit(action, payload = {}) {
	if (!ECOSYSTEM_EDIT_API_URL) {
		throw new Error("Der Landschaften-Editor ist auf diesem Host nicht erreichbar.");
	}

	const response = await fetch(ECOSYSTEM_EDIT_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ action, ...payload }),
	});
	const result = await readJsonResponse(response, null);

	if (!response.ok || result?.ok !== true) {
		throw new Error(apiErrorMessage(result, `${action} fehlgeschlagen (${response.status}).`));
	}

	return result;
}

function formatEcosystemRegionOptionLabel(region) {
	const name = String(region?.name || "").trim() || "Ohne Namen";
	const typeLabel = (ecosystemRegionTypesByKind[region?.kind] || [])
		.find((type) => type.type_key === region?.region_type)?.label || "";
	const areaCount = Number(region?.area_count || 0);
	const areaText = areaCount === 1 ? "1 Fläche" : `${areaCount} Flächen`;

	return typeLabel ? `${name} (${typeLabel}, ${areaText})` : `${name} (${areaText})`;
}

function renderEcosystemRegionOptions() {
	const selectElement = document.getElementById("ecosystem-region-select");
	if (!selectElement) {
		return;
	}

	const kind = getActiveEcosystemLayerKind();
	const regions = ecosystemRegionsByKind[kind];
	selectElement.innerHTML = "";

	if (!Array.isArray(regions)) {
		selectElement.appendChild(new Option("Regionen werden geladen …", "", true, true));
		selectElement.disabled = true;
		return;
	}

	selectElement.disabled = false;
	if (regions.length === 0) {
		// An empty state that says what to do next, not just that something is empty.
		selectElement.appendChild(new Option("Noch keine Region — bitte anlegen", "", true, true));
		setActiveEcosystemRegionId("", kind);
		return;
	}

	// A remembered region that has since been deleted must not stay selected: create_area would answer
	// 400 and the editor would have no idea why. Fall back to the first one.
	const storedId = getActiveEcosystemRegionId(kind);
	const activeId = regions.some((region) => region.public_id === storedId) ? storedId : regions[0].public_id;
	regions.forEach((region) => {
		selectElement.appendChild(new Option(formatEcosystemRegionOptionLabel(region), region.public_id, false, region.public_id === activeId));
	});
	selectElement.value = activeId;
	setActiveEcosystemRegionId(activeId, kind);
}

async function loadEcosystemRegions(kind, { force = false } = {}) {
	if (!isKnownEcosystemKind(kind) || (!force && Array.isArray(ecosystemRegionsByKind[kind]))) {
		return;
	}

	const requestToken = (ecosystemRegionRequestToken += 1);
	try {
		const result = await postEcosystemEdit("list_regions", { kind });
		if (requestToken !== ecosystemRegionRequestToken) {
			return;
		}
		ecosystemRegionsByKind[kind] = Array.isArray(result.regions) ? result.regions : [];
		ecosystemRegionTypesByKind[kind] = Array.isArray(result.region_types) ? result.region_types : [];
	} catch (error) {
		if (requestToken !== ecosystemRegionRequestToken) {
			return;
		}
		// An empty list, not a missing one: without this the picker would sit on "wird geladen …"
		// forever and every retry would look like a hang. The console keeps the real reason.
		ecosystemRegionsByKind[kind] = [];
		ecosystemRegionTypesByKind[kind] = [];
		console.warn("Landschafts-Regionen konnten nicht geladen werden:", error);
	}

	if (kind === getActiveEcosystemLayerKind()) {
		renderEcosystemRegionOptions();
	}
}

// Every write bumps ecosystem_revision, and the area loader sees that in the payload head. When it
// changes, the cached region rows are stale -- above all their area counts, which is what the row shows.
// Dropping ALL kinds, not just the active one: a switch to another layer must not hand back a count from
// before the write.
function invalidateEcosystemRegionCache() {
	ecosystemRegionsByKind = {};
	ecosystemRegionTypesByKind = {};
	syncEcosystemRegionPicker({ refresh: true });
}

// Called on every mode change and on every layer switch (map-features-ecosystem-layer-switch.js).
// `refresh` only on ENTERING the mode: the row carries each region's area count, and that goes stale as
// soon as areas are drawn. Flipping the segment switch reads the cache instead -- switching layers is
// something an editor does constantly, and it must not put a query on STRATO every time.
function syncEcosystemRegionPicker({ refresh = false } = {}) {
	bindEcosystemRegionPicker();
	renderEcosystemRegionOptions();
	void loadEcosystemRegions(getActiveEcosystemLayerKind(), { force: refresh });
}

// ---- the "new region" dialog -------------------------------------------------------------------------

function setEcosystemRegionDialogError(message) {
	const errorElement = document.getElementById("ecosystem-region-error");
	if (!errorElement) {
		return;
	}
	errorElement.textContent = String(message || "");
	errorElement.hidden = !message;
}

function openEcosystemRegionDialog() {
	const overlayElement = document.getElementById("ecosystem-region-overlay");
	const typeSelect = document.getElementById("ecosystem-region-type");
	const nameInput = document.getElementById("ecosystem-region-name");
	if (!overlayElement || !typeSelect || !nameInput) {
		return;
	}

	const kind = getActiveEcosystemLayerKind();
	// 🔴 The Art list comes from ecosystem_region_type through list_regions -- never from a list written
	// into the client. The server validates writes against exactly the same rows
	// (avesmapsEcosystemAssertRegionType), so a hardcoded copy here could only ever drift into 400s.
	typeSelect.innerHTML = "";
	typeSelect.appendChild(new Option("— ohne Art —", "", true, true));
	(ecosystemRegionTypesByKind[kind] || []).forEach((type) => {
		typeSelect.appendChild(new Option(type.label, type.type_key));
	});

	document.getElementById("ecosystem-region-form")?.reset();
	typeSelect.value = "";
	setEcosystemRegionDialogError("");
	overlayElement.hidden = false;
	document.getElementById("ecosystem-region-dialog")?.focus();
	nameInput.focus();
}

function closeEcosystemRegionDialog() {
	const overlayElement = document.getElementById("ecosystem-region-overlay");
	if (overlayElement) {
		overlayElement.hidden = true;
	}
	document.getElementById("ecosystem-region-new")?.focus();
}

function isEcosystemRegionDialogOpen() {
	const overlayElement = document.getElementById("ecosystem-region-overlay");
	return Boolean(overlayElement) && !overlayElement.hidden;
}

async function submitEcosystemRegionDialog(event) {
	event?.preventDefault();
	if (ecosystemRegionDialogBusy) {
		return;
	}

	const kind = getActiveEcosystemLayerKind();
	const name = String(document.getElementById("ecosystem-region-name")?.value || "").trim();
	const regionType = String(document.getElementById("ecosystem-region-type")?.value || "");
	const wikiUrl = String(document.getElementById("ecosystem-region-wiki-url")?.value || "").trim();

	if (name === "") {
		setEcosystemRegionDialogError("Bitte einen Namen eingeben.");
		document.getElementById("ecosystem-region-name")?.focus();
		return;
	}

	const saveButton = document.getElementById("ecosystem-region-save");
	ecosystemRegionDialogBusy = true;
	if (saveButton) {
		saveButton.disabled = true;
		saveButton.textContent = "Wird angelegt …";
	}

	try {
		// 🔴 wiki_url travels, wiki_region_key does NOT. The key is derived server-side from the URL
		// through the fixed fold table (AGENTS.md §5); slugifying in the client would invent a second,
		// subtly different derivation and break every join built on it.
		const result = await postEcosystemEdit("create_region", {
			kind,
			name,
			region_type: regionType,
			wiki_url: wikiUrl,
		});

		const created = result.region || {};
		// Insert locally instead of refetching: the answer already carries the full row, and the new
		// region has no areas yet.
		const regions = Array.isArray(ecosystemRegionsByKind[kind]) ? ecosystemRegionsByKind[kind] : [];
		ecosystemRegionsByKind[kind] = regions.concat([{ ...created, area_count: 0 }]);
		setActiveEcosystemRegionId(created.public_id || "", kind);
		renderEcosystemRegionOptions();
		closeEcosystemRegionDialog();
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(`Region „${name}" angelegt.`);
		}
	} catch (error) {
		setEcosystemRegionDialogError(error?.message || "Die Region konnte nicht angelegt werden.");
	} finally {
		ecosystemRegionDialogBusy = false;
		if (saveButton) {
			saveButton.disabled = false;
			saveButton.textContent = "Anlegen";
		}
	}
}

function bindEcosystemRegionPicker() {
	if (ecosystemRegionPickerBound) {
		return;
	}
	const selectElement = document.getElementById("ecosystem-region-select");
	const overlayElement = document.getElementById("ecosystem-region-overlay");
	if (!selectElement || !overlayElement) {
		return;
	}

	ecosystemRegionPickerBound = true;
	selectElement.addEventListener("change", () => setActiveEcosystemRegionId(selectElement.value));
	document.getElementById("ecosystem-region-new")?.addEventListener("click", openEcosystemRegionDialog);
	document.getElementById("ecosystem-region-close")?.addEventListener("click", closeEcosystemRegionDialog);
	document.getElementById("ecosystem-region-cancel")?.addEventListener("click", closeEcosystemRegionDialog);
	document.getElementById("ecosystem-region-form")?.addEventListener("submit", submitEcosystemRegionDialog);
	// Click on the scrim closes; a click inside the dialog must not.
	overlayElement.addEventListener("click", (event) => {
		if (event.target === overlayElement) {
			closeEcosystemRegionDialog();
		}
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isEcosystemRegionDialogOpen()) {
			event.stopPropagation();
			closeEcosystemRegionDialog();
		}
	});
}
