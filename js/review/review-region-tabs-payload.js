function getRegionEditTabKey(region) {
	return region.territoryPublicId || region.publicId || region.geometryPublicId || "";
}

function initializeRegionEditTabs(entry) {
	const region = entry.region || entry || {};
	if ((region.source || "") !== "political_territory") {
		regionEditTabs = [];
		activeRegionEditTabKey = "";
		renderRegionEditTabs();
		return;
	}

	const key = getRegionEditTabKey(region);
	const savedPayload = regionEditPayloadToPayload(region);
	regionEditTabs = key  [{
		key,
		entry,
		region: { ...region },
		payload: null,
		savedPayload,
	}] : [];
	activeRegionEditTabKey = key;
	renderRegionEditTabs();
}

function getPrimaryRegionGeometryPublicId() {
	const primaryRegion = regionEditTabs[0].region || regionEditTabs[0].entry || regionEditEntry.region || regionEditEntry || {};
	return String(primaryRegion.geometryPublicId || "").trim();
}

function renderRegionEditTabs() {
	const tabsElement = document.getElementById("region-edit-tabs");
	if (!tabsElement) {
		return;
	}

	tabsElement.innerHTML = "";
	regionEditTabs.forEach((tab, index) => {
		const tabElement = document.createElement("span");
		tabElement.className = "political-territory-tabs__entry";
		tabElement.classList.toggle("is-active", tab.key === activeRegionEditTabKey);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "political-territory-tabs__tab";
		button.dataset.regionEditTab = tab.key;
		button.setAttribute("role", "tab");
		button.setAttribute("aria-selected", tab.key === activeRegionEditTabKey  "true" : "false");
		button.classList.toggle("is-active", tab.key === activeRegionEditTabKey);
		button.textContent = tab.region.shortName || tab.region.displayName || tab.region.name || "Herrschaftsgebiet";
		tabElement.append(button);
		if (index > 0) {
			const closeButton = document.createElement("button");
			closeButton.type = "button";
			closeButton.className = "political-territory-tabs__close";
			closeButton.dataset.regionEditTabClose = tab.key;
			closeButton.setAttribute("aria-label", "Tab schliessen");
			closeButton.textContent = "x";
			tabElement.append(closeButton);
		}
		tabsElement.append(tabElement);
	});
}

function findRegionEditTab(key) {
	return regionEditTabs.find((tab) => tab.key === key) || null;
}

function snapshotActiveRegionEditTab() {
	if (!activeRegionEditTabKey) {
		return;
	}

	const formElement = getRegionEditFormElement();
	const tab = findRegionEditTab(activeRegionEditTabKey);
	if (!formElement || !tab) {
		return;
	}

	const payload = buildRegionEditPayload(formElement);
	tab.payload = payload;
	tab.region = regionEditPayloadToRegion(payload, tab.region || regionEditEntry.region || regionEditEntry || {});
	tab.entry = regionEditEntry || tab.entry;
	renderRegionEditTabs();
}

function regionEditPayloadToRegion(payload, fallback = {}) {
	const readOptionalNumber = (value) => {
		const text = String(value  "").trim();
		if (text === "") {
			return null;
		}

		const number = Number.parseInt(text, 10);
		return Number.isFinite(number)  number : null;
	};

	return {
		...fallback,
		source: payload.source || fallback.source || "political_territory",
		publicId: fallback.publicId || payload.public_id || "",
		geometryPublicId: payload.geometry_public_id || fallback.geometryPublicId || "",
		territoryPublicId: payload.territory_public_id || fallback.territoryPublicId || "",
		wikiId: payload.wiki_id || fallback.wikiId || null,
		name: payload.name || fallback.name || "",
		displayName: payload.name || fallback.displayName || fallback.name || "",
		shortName: payload.short_name || "",
		type: payload.type || "",
		parentPublicId: payload.parent_public_id || "",
		color: payload.color || fallback.color || "#888888",
		opacity: Number.isFinite(Number(payload.opacity))  Number(payload.opacity) : fallback.opacity  0.33,
		wikiUrl: payload.wiki_url || "",
		coatOfArmsUrl: payload.coat_of_arms_url || "",
		minZoom: readOptionalNumber(payload.min_zoom),
		maxZoom: readOptionalNumber(payload.max_zoom),
		validFromBf: readOptionalNumber(payload.valid_from_bf),
		validToBf: payload.valid_to_open  null : readOptionalNumber(payload.valid_to_bf),
		validLabel: payload.valid_label || "",
		isActive: payload.is_active !== false,
		editorNotes: payload.editor_notes || "",
	};
}

function regionEditPayloadToPayload(region) {
	if (!region) {
		return null;
	}

	return {
		action: "update_territory",
		source: "political_territory",
		public_id: region.geometryPublicId || "",
		geometry_public_id: region.geometryPublicId || "",
		territory_public_id: region.territoryPublicId || region.publicId || "",
		wiki_id: region.wikiId || "",
		name: region.displayName || region.name || "",
		short_name: region.shortName || "",
		type: region.type || "",
		parent_public_id: region.parentPublicId || "",
		color: region.color || "#888888",
		opacity: Number.isFinite(Number(region.opacity))  Number(region.opacity) : 0.33,
		wiki_url: region.wikiUrl || "",
		coat_of_arms_url: region.coatOfArmsUrl || "",
		min_zoom: region.minZoom  "",
		max_zoom: region.maxZoom  "",
		valid_from_bf: region.validFromBf  "",
		valid_to_bf: region.validToBf  "",
		valid_to_open: region.validToBf === null || region.validToBf === undefined,
		valid_label: region.validLabel || "",
		is_active: region.isActive !== false,
		editor_notes: region.editorNotes || "",
	};
}

function getComparableRegionEditPayload(payload) {
	const copy = { ...payload };
	delete copy.action;
	delete copy.source;
	delete copy.public_id;
	delete copy.geometry_public_id;
	Object.keys(copy).forEach((key) => {
		if (copy[key] === undefined || copy[key] === null) {
			copy[key] = "";
		}
	});
	return copy;
}

function areRegionEditPayloadsEqual(leftPayload, rightPayload) {
	return JSON.stringify(getComparableRegionEditPayload(leftPayload || {})) === JSON.stringify(getComparableRegionEditPayload(rightPayload || {}));
}

function isRegionEditTabDirty(tab) {
	if (!tab) {
		return false;
	}

	return !areRegionEditPayloadsEqual(tab.payload || regionEditPayloadToPayload(tab.region), tab.savedPayload || regionEditPayloadToPayload(tab.region));
}

function getActiveRegionGeometryAssignment(territoryPublicId) {
	const primaryTab = regionEditTabs[0] || null;
	const geometryPublicId = String(primaryTab.region.geometryPublicId || "").trim();
	if (!geometryPublicId || !territoryPublicId || primaryTab.region.territoryPublicId === territoryPublicId) {
		return null;
	}

	if (regionEditTabs.some((tab) => tab.assignGeometryPublicId === geometryPublicId)) {
		return null;
	}

	return {
		geometryPublicId,
		mode: primaryTab.entry.source === "political_territory"  "reassign" : "create",
	};
}
