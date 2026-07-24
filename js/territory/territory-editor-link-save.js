// Political-territory editor save/assignment: save/unassign a geometry assignment,
// sync breadcrumb zooms across geometries, build display/validity/wiki-node payloads.
// Split out of territory-editor-link.js (M5 god-file split). Plain global functions
// called at runtime; shared editor state referenced cross-script.

async function savePoliticalTerritoryEditorAssignment(regionEntry, value = {}) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry);
	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Bitte das Herrschaftsgebiet erneut aus der Karte öffnen.");
	}

	const shouldPromote = activePoliticalTerritoryEditorPromoteNextSave === true;
	activePoliticalTerritoryEditorPromoteNextSave = false;
	const globalSnapshot = shouldPromote ? null : await snapshotPoliticalTerritoryEditorGlobals(value);
	const assignedPath = Array.isArray(value.assignedPath) ? value.assignedPath : [];
	const displays = Array.isArray(value.displays) ? value.displays : [];
	const wikiPublicIds = assignedPath.map((node) => String(node?.wikiKey || "").trim()).filter(Boolean);
	const territoryPublicIds = assignedPath.map((node) => String(node?.territoryPublicId || "").trim()).filter(Boolean);
	const hasAssignedTerritory = assignedPath.length > 0 && (wikiPublicIds.length > 0 || territoryPublicIds.length > 0);
	const display = buildPoliticalTerritoryEditorDisplayPayload(regionEntry, value);
	const validity = buildPoliticalTerritoryEditorValidityPayload(regionEntry, value);
	const displayName = String(display.displayName || display.name || "").trim();
	const shouldCreateTerritoryFromGeometry = !hasAssignedTerritory && displayName !== "";

	// Aktiver Wiki-Knoten OHNE eigene Geometrie: nur die Eigenschaften per wiki_key
	// speichern (legt bei Bedarf on-demand eine political_territory-Zeile an), ohne die
	// geöffnete Geometrie anzufassen. Knoten mit eigener Geometrie laufen den normalen
	// Zuweisungspfad unten. Drag'n'drop-Zuweisung (assignedPath gefuellt) ebenfalls unten.
	const activeNodeRef = value.activeDisplayNode || {};
	const activeWikiKey = String(activeNodeRef.wikiKey || activeNodeRef.wiki_key || "").trim();
	const activeNodeHasGeometry = activeNodeRef.hasGeometry === true;
	if (activeWikiKey && !activeNodeHasGeometry && assignedPath.length === 0) {
		const wikiNodeResult = await submitPoliticalTerritoryEdit({
			action: "save_wiki_node_settings",
			wiki_key: activeWikiKey,
			display,
			validity,
		});
		refreshPoliticalTerritoryEditorMapLayer();
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(wikiNodeResult?.message || "Eigenschaften gespeichert.", "success");
		}
		window.setTimeout(closePoliticalTerritoryEditor, 0);
		return wikiNodeResult;
	}

	const result = await submitPoliticalTerritoryEdit({
		action: "save_geometry_assignment",
		geometry_public_id: geometryPublicId,
		display_only: !hasAssignedTerritory && !shouldCreateTerritoryFromGeometry,
		create_territory_if_missing: shouldCreateTerritoryFromGeometry,
		territory_name: shouldCreateTerritoryFromGeometry ? displayName : "",
		display,
		validity,
		wiki_public_ids: wikiPublicIds,
		territory_public_ids: territoryPublicIds,
		wiki_nodes: buildPoliticalTerritoryEditorWikiNodes(assignedPath, displays, wikiPublicIds),
		assignment: value,
	});

	if (shouldPromote) {
		await syncPoliticalTerritoryEditorAssignmentZooms(value);
		await clearPoliticalTerritoryEditorLocalOverrides(geometryPublicId);
		suppressPoliticalTerritoryEditorOverrideFooter();
	} else {
		await restorePoliticalTerritoryEditorGlobals(globalSnapshot);
	}

	activePoliticalTerritoryEditorPendingLocalOverride = false;
	// Optimistisches Sofort-Update: die soeben gespeicherten Display-Werte des aktiven
	// Knotens als Pending-Override registrieren, damit der nächste Layer-Render sie zeigt,
	// ohne auf einen erneuten Komplettabruf der Territorienliste warten zu müssen.
	const savedTerritoryPublicId = String(
		value.activeDisplayNode?.territoryPublicId
		|| value.activeDisplayNode?.territory_public_id
		|| territoryPublicIds[territoryPublicIds.length - 1]
		|| ""
	).trim();
	if (savedTerritoryPublicId && typeof registerPoliticalTerritoryPendingStyleOverride === "function") {
		registerPoliticalTerritoryPendingStyleOverride(savedTerritoryPublicId, {
			color: display.color,
			opacity: display.opacity,
			minZoom: display.zoomMin,
			maxZoom: display.zoomMax,
		});
	}
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast(shouldPromote ? "Lokale Darstellung global übernommen." : result?.message || "Herrschaftsgebiet gespeichert.", "success");
	}
	window.setTimeout(closePoliticalTerritoryEditor, 0);
	return result;
}

async function syncPoliticalTerritoryEditorAssignmentZooms(value = {}) {
	const displays = Array.isArray(value.displays) ? value.displays : [];
	// Existierende Gebiete OHNE expliziten Zoom (zoomMin/zoomMax null) NICHT synchronisieren -> ihre manuell
	// gesetzten Zoomstufen bleiben erhalten. Default-Zoom gilt nur für neu erzeugte Gebiete (die haben hier
	// noch keine territoryPublicId und werden ohnehin über die Zuweisung selbst angelegt).
	const syncDisplays = displays.filter((display) =>
		String(display?.territoryPublicId || "").trim() !== "" && (display?.zoomMin != null || display?.zoomMax != null));
	if (syncDisplays.length < 1) return null;

	try {
		const response = await fetch("/api/edit/political/assignment-zoom-sync.php", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ displays: syncDisplays }),
		});
		const result = await response.json().catch(() => null);
		if (!response.ok || result?.ok === false) {
			throw new Error(apiErrorMessage(result, "Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden."));
		}
		return result;
	} catch (error) {
		console.warn("Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden:", error);
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(error.message || "Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden.", "warning");
		}
		return null;
	}
}

async function unassignPoliticalTerritoryEditorGeometry(regionEntry) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry);
	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Bitte das Herrschaftsgebiet erneut aus der Karte öffnen.");
	}

	const result = await submitPoliticalTerritoryEdit({
		action: "unassign_geometry",
		geometry_public_id: geometryPublicId,
	});
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") showFeedbackToast(result?.message || "Zuweisung entfernt.", "success");
	window.setTimeout(closePoliticalTerritoryEditor, 0);
	return result;
}

function buildPoliticalTerritoryEditorDisplayPayload(regionEntry, value = {}) {
	const display = value.display || {};
	const opacity = Number(display.opacity ?? regionEntry.opacity ?? 0.33);
	return {
		name: String(display.name || display.displayName || regionEntry.displayName || regionEntry.name || "").trim(),
		displayName: String(display.displayName || display.name || regionEntry.displayName || regionEntry.name || "").trim(),
		coatOfArmsUrl: String(display.coatOfArmsUrl || display.alternateCoatOfArmsUrl || regionEntry.coatOfArmsUrl || "").trim(),
		zoomMin: parsePoliticalTerritoryEditorNumber(display.zoomMin ?? regionEntry.minZoom ?? regionEntry.min_zoom),
		zoomMax: parsePoliticalTerritoryEditorNumber(display.zoomMax ?? regionEntry.maxZoom ?? regionEntry.max_zoom),
		color: String(display.color || regionEntry.color || "#888888").trim() || "#888888",
		opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.33,
	};
}

function buildPoliticalTerritoryEditorValidityPayload(regionEntry, value = {}) {
	const validity = value.validity || {};
	const endYear = parsePoliticalTerritoryEditorNumber(validity.endYear ?? regionEntry.validToBf ?? regionEntry.valid_to_bf);
	const existsUntilToday = typeof validity.existsUntilToday === "boolean" ? validity.existsUntilToday : endYear === null;
	return {
		startYear: parsePoliticalTerritoryEditorNumber(validity.startYear ?? regionEntry.validFromBf ?? regionEntry.valid_from_bf),
		endYear: existsUntilToday ? null : endYear,
		existsUntilToday,
	};
}

function buildPoliticalTerritoryEditorWikiNodes(assignedPath, displays, wikiPublicIds) {
	return assignedPath.map((node, index) => {
		const display = displays[index] || {};
		return {
			key: wikiPublicIds[index] || node?.wikiKey || node?.territoryPublicId || "",
			territoryPublicId: node?.territoryPublicId || "",
			territoryId: node?.territoryId || null,
			name: display.displayName || node?.label || node?.key || "",
			type: node?.kind || "Herrschaftsgebiet",
			status: "",
			coat_of_arms_url: display.coatOfArmsUrl || "",
			wiki_url: "",
		};
	});
}

function parsePoliticalTerritoryEditorNumber(value) {
	if (value === "" || value === null || typeof value === "undefined") return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}
