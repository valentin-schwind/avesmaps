async function saveRegionEditTab(tab) {
	if (!tab) {
		return null;
	}

	const payload = tab.payload || regionEditPayloadToPayload(tab.region);
	const result = await submitPoliticalTerritoryEdit(payload);
	let latestResult = result;
	const liveRegion = tab.entry && typeof tab.entry === "object"
		? tab.entry
		: tab.region && typeof tab.region === "object"
			? tab.region
			: {};
	if (result.feature) {
		applyRegionFeatureResponse(liveRegion, result.feature);
	}
	if (result.territory) {
		const savedRegion = normalizePoliticalTerritoryForRegionEdit(result.territory, result.wiki || null);
		const territoryMetadata = { ...savedRegion };
		delete territoryMetadata.publicId;
		delete territoryMetadata.geometryPublicId;
		delete territoryMetadata.feature;
		delete territoryMetadata.layer;
		delete territoryMetadata.layers;
		delete territoryMetadata.label;
		delete territoryMetadata.handles;
		Object.assign(liveRegion, tab.region || {}, territoryMetadata);
		if (result.feature) {
			liveRegion.feature = result.feature;
		}
	}
	tab.region = liveRegion;
	tab.entry = liveRegion;
	updateRegionAssignmentBreadcrumbChain(payload.territory_public_id || liveRegion.territoryPublicId || "", result.territory || null, result.wiki || null);
	if (tab.assignGeometryPublicId && payload.territory_public_id) {
		latestResult = tab.assignGeometryMode === "create"
			? await submitPoliticalTerritoryEdit({
				action: "create_geometry",
				territory_public_id: payload.territory_public_id,
				source: "editor",
				geometry_geojson: regionLayerToGeoJsonGeometry(tab.entry || regionEditEntry),
				valid_from_bf: payload.valid_from_bf,
				valid_to_bf: payload.valid_to_bf,
				valid_to_open: payload.valid_to_open,
				style_json: {
					fill: payload.color,
					stroke: payload.color,
					fillOpacity: payload.opacity,
				},
			})
			: await submitPoliticalTerritoryEdit({
				action: "assign_geometry",
				geometry_public_id: tab.assignGeometryPublicId,
				territory_public_id: payload.territory_public_id,
			});
		if (latestResult.feature) {
			if ((tab.entry || regionEditEntry)?.source === "political_territory") {
				applyRegionFeatureResponse(liveRegion, latestResult.feature);
			}
		}
		liveRegion.geometryPublicId = latestResult.geometry?.public_id || tab.assignGeometryPublicId;
		tab.assignGeometryPublicId = "";
		tab.assignGeometryMode = "";
	}
	const territoryPublicId = String(tab.region?.territoryPublicId || payload.territory_public_id || "").trim();
	if (payload.action === "update_territory" && territoryPublicId) {
		if (typeof registerPoliticalTerritoryPendingStyleOverride === "function") {
			registerPoliticalTerritoryPendingStyleOverride(territoryPublicId, {
				color: payload.color,
				opacity: payload.opacity,
				minZoom: payload.min_zoom,
				maxZoom: payload.max_zoom,
			});
		}
		await syncPoliticalTerritoryDisplayStyles(territoryPublicId);
	}
	tab.savedPayload = getComparableRegionEditPayload(payload);
	tab.payload = null;
	if (tab.key === activeRegionEditTabKey) {
		regionEditEntry = liveRegion || tab.entry || tab.region || regionEditEntry;
		populateRegionEditForm(liveRegion || regionEditEntry, { preserveTabs: true });
		renderRegionEditTabs();
	}
	if (Array.isArray(latestResult?.assignment_chain) && latestResult.assignment_chain.length > 0) {
		applyPersistedRegionAssignmentChain(latestResult.assignment_chain, territoryPublicId || liveRegion.territoryPublicId || "");
	}
	if (regionAssignmentWikiPath.length > 0) {
		storeRegionAssignmentBreadcrumbCaches(regionAssignmentWikiPath, regionAssignmentEnsuredChain, territoryPublicId || regionAssignmentActiveWikiPublicId);
	}
	return latestResult;
}

function normalizePoliticalTerritoryForRegionEdit(territory, wiki = null) {
	return {
		source: "political_territory",
		publicId: territory.public_id || "",
		geometryPublicId: "",
		territoryPublicId: territory.public_id || "",
		wikiId: territory.wiki_id || wiki?.id || null,
		name: normalizeParentheticalSpacing(territory.name || ""),
		displayName: normalizeParentheticalSpacing(territory.name || ""),
		shortName: territory.short_name || "",
		type: normalizeParentheticalSpacing(territory.type || wiki?.type || "Herrschaftsgebiet"),
		parentPublicId: territory.parent_public_id || "",
		parentName: territory.parent_name || "",
		color: territory.color || "#888888",
		opacity: territory.opacity ?? 0.33,
		wikiUrl: territory.wiki_url || wiki?.wiki_url || "",
		coatOfArmsUrl: territory.coat_of_arms_url || wiki?.coat_of_arms_url || "",
		minZoom: territory.min_zoom ?? null,
		maxZoom: territory.max_zoom ?? null,
		validFromBf: territory.valid_from_bf ?? null,
		validToBf: territory.valid_to_bf ?? null,
		validLabel: territory.valid_label || "",
		isActive: territory.is_active !== false,
		editorNotes: territory.editor_notes || "",
		wikiName: territory.wiki_name || wiki?.name || "",
		wikiType: normalizeParentheticalSpacing(territory.wiki_type || wiki?.type || territory.type || ""),
		wikiAffiliationRaw: territory.wiki_affiliation_raw || wiki?.affiliation_raw || "",
		wikiAffiliationRoot: territory.wiki_affiliation_root || wiki?.affiliation_root || "",
		wikiFoundedText: territory.wiki_founded_text || wiki?.founded_text || "",
		wikiDissolvedText: territory.wiki_dissolved_text || wiki?.dissolved_text || "",
		wikiCapitalName: territory.wiki_capital_name || wiki?.capital_name || "",
		wikiSeatName: territory.wiki_seat_name || wiki?.seat_name || "",
		assignmentChain: Array.isArray(territory.assignment_chain) ? clonePoliticalTerritoryChain(territory.assignment_chain) : [],
	};
}

async function openRegionEditTabForTerritory(territoryPublicId, { assignGeometry = true } = {}) {
	snapshotActiveRegionEditTab();
	const existingTab = findRegionEditTab(territoryPublicId);
	if (existingTab) {
		activeRegionEditTabKey = territoryPublicId;
		populateRegionEditForm(existingTab.region, { preserveTabs: true });
		renderRegionEditTabs();
		return;
	}

	try {
		setRegionEditStatus("Herrschaftsgebiet wird geladen...", "pending");
		const response = await fetchPoliticalTerritories({ action: "get", public_id: territoryPublicId });
		const region = normalizePoliticalTerritoryForRegionEdit({
			...(response.territory || {}),
			assignment_chain: response.assignment_chain || [],
		}, response.wiki || null);
		const geometryAssignment = assignGeometry ? getActiveRegionGeometryAssignment(territoryPublicId) : null;
		const assignGeometryPublicId = geometryAssignment?.geometryPublicId || "";
		if (assignGeometryPublicId) {
			region.geometryPublicId = assignGeometryPublicId;
		}
		const tab = {
			key: territoryPublicId,
			entry: assignGeometryPublicId ? regionEditTabs[0]?.entry || regionEditEntry || region : region,
			region,
			payload: null,
			savedPayload: regionEditPayloadToPayload(region),
			assignGeometryPublicId,
			assignGeometryMode: geometryAssignment?.mode || "",
		};
		regionEditTabs.push(tab);
		activeRegionEditTabKey = territoryPublicId;
		populateRegionEditForm(region, { preserveTabs: true });
		renderRegionEditTabs();
		setRegionEditStatus();
	} catch (error) {
		console.error("Herrschaftsgebiet konnte nicht geladen werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht geladen werden.", "error");
	}
}

async function activatePrimaryRegionEditTabForTerritory(territoryPublicId) {
	if (!territoryPublicId) {
		return;
	}

	const primaryTab = regionEditTabs[0] || null;
	const currentTerritoryId = primaryTab?.region?.territoryPublicId || "";
	if (currentTerritoryId === territoryPublicId) {
		activeRegionEditTabKey = primaryTab?.key || territoryPublicId;
		if (primaryTab) {
			populateRegionEditForm(primaryTab.region, { preserveTabs: true });
			renderRegionEditTabs();
		}
		return;
	}

	setRegionEditStatus("Herrschaftsgebiet wird geladen...", "pending");
	const response = await fetchPoliticalTerritories({ action: "get", public_id: territoryPublicId });
	const region = normalizePoliticalTerritoryForRegionEdit({
		...(response.territory || {}),
		assignment_chain: response.assignment_chain || [],
	}, response.wiki || null);
	region.geometryPublicId = primaryTab?.region?.geometryPublicId || primaryTab?.entry?.geometryPublicId || "";
	const tab = {
		key: territoryPublicId,
		entry: primaryTab?.entry || regionEditEntry || region,
		region,
		payload: null,
		savedPayload: regionEditPayloadToPayload(region),
		assignGeometryPublicId: region.geometryPublicId || "",
		assignGeometryMode: region.geometryPublicId ? "assign" : "",
	};
	regionEditTabs.push(tab);
	activeRegionEditTabKey = territoryPublicId;
	populateRegionEditForm(region, { preserveTabs: true });
	renderRegionEditTabs();
	setRegionEditStatus();
}
