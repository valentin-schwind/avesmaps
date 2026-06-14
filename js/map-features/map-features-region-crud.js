// Region geometry CRUD: extract a part as a new territory, save/update geometry,
// apply the feature response, create a region, delete a region/part (+ confirm and
// hierarchy/option cleanup), shared-boundary vertex move, label-position update.
// Split out of map-features.js (M5 god-file split). Plain classic script: global
// functions called at runtime; shared map-features state referenced cross-script.

async function extractRegionGeometryPartAsNewTerritory(regionEntry, selectedLayer) {
	if (!regionEntry || regionEntry.source !== "political_territory") {
		showFeedbackToast("Herausloesen ist nur für das neue Herrschaftsgebiete-Modell verfügbar.", "warning");
		return;
	}

	const layers = getRegionEntryLayers(regionEntry);
	if (!selectedLayer || !layers.includes(selectedLayer) || layers.length < 2) {
		showFeedbackToast("Zum Herausloesen muss ein Teilpolygon eines Mehrfach-Gebiets ausgewählt sein.", "warning");
		return;
	}

	const extractedGeometry = regionLayersToGeoJsonGeometry([selectedLayer], regionEntry);
	const extractedName = `${regionEntry.name || "Herrschaftsgebiet"} (Teilgebiet)`;

	try {
		await politicalTerritoryRepository.createExtractedTerritory(regionEntry, extractedName, extractedGeometry);

		await deleteRegionGeometryPart(regionEntry, selectedLayer);
		void loadPoliticalTerritoryOptions({ force: true });
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		showFeedbackToast("Teilpolygon als neues Herrschaftsgebiet herausgeloest.", "success");
	} catch (error) {
		console.error("Teilpolygon konnte nicht herausgeloest werden:", error);
		showFeedbackToast(error.message || "Teilpolygon konnte nicht herausgeloest werden.", "warning");
	}
}

// (Region split/move editing moved to map-features-region-edit-ops.js - M5 split.)

function updateRegionLabelPosition(regionEntry) {
	if (regionEntry?.label && regionEntry.layer) {
		if (regionEntry.labelLat !== null && regionEntry.labelLng !== null) {
			regionEntry.label.setLatLng(L.latLng(regionEntry.labelLat, regionEntry.labelLng));
			return;
		}

		const bounds = getRegionEntryBounds(regionEntry);
		regionEntry.label.setLatLng(bounds?.getCenter?.() || regionEntry.layer.getBounds().getCenter());
	}
}

function applySharedBoundaryVertexMove(ownRegion, originalLatLng, targetLatLng) {
	const affectedRegions = new Set();
	regionPolygons.forEach((polygon) => {
		const regionEntry = polygon._regionEntry;
		if (!regionEntry || regionEntry === ownRegion || regionEntry.source !== "political_territory" || regionEntry.isDerivedGeometry === true) {
			// Abgeleitete Außengrenzen NICHT per Shared-Vertex-Edit mitschieben/speichern:
			// sie sind berechnet (update_geometry auf eine Derived-ID -> 400) und werden
			// über "Grenzen berechnen" aktualisiert.
			return;
		}

		const latLngs = polygon.getLatLngs();
		const updateResult = replaceMatchingNestedLatLngs(latLngs, originalLatLng, targetLatLng);
		const changed = updateResult.changed;
		if (!changed) {
			return;
		}

		polygon.setLatLngs(updateResult.latLngs);
		updateRegionLabelPosition(regionEntry);
		affectedRegions.add(regionEntry);
	});

	return Array.from(affectedRegions);
}

async function saveRegionGeometry(regionEntry) {
	if (regionEntry.source === "political_territory") {
		try {
			const result = await updatePoliticalRegionGeometry(regionEntry, regionLayerToGeoJsonGeometry(regionEntry));
			if (result.feature) {
				applyRegionFeatureResponse(regionEntry, result.feature);
			}
			showFeedbackToast("Grenze des Herrschaftsgebiets gespeichert.", "success");
		} catch (error) {
			showFeedbackToast(error.message || "Grenze des Herrschaftsgebiets konnte nicht gespeichert werden.", "warning");
		}
		return;
	}

	if (!isSqlMapFeatureId(regionEntry.publicId)) {
		showFeedbackToast("Region hat keine gültige SQL-ID.", "warning");
		return;
	}
	const coordinates = polygonLatLngsToCoordinates(getRegionOuterLatLngs(regionEntry));
	try {
		const result = await submitMapFeatureEdit({ action: "update_region_geometry", public_id: regionEntry.publicId, coordinates });
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		showFeedbackToast("Regionsgrenze gespeichert.", "success");
	} catch (error) {
		showFeedbackToast(error.message || "Regionsgrenze konnte nicht gespeichert werden.", "warning");
	}
}

async function updatePoliticalRegionGeometry(regionEntry, geometryGeoJson) {
	const result = await politicalTerritoryRepository.updateGeometry(regionEntry, geometryGeoJson);
	void loadChangeLog();
	return result;
}

function applyRegionFeatureResponse(regionEntry, feature) {
	const updatedRegion = normalizeRegionFeature(feature);
	regionEntry.publicId = updatedRegion.publicId || regionEntry.publicId;
	regionEntry.geometryId = updatedRegion.geometryId ?? regionEntry.geometryId ?? null;
	regionEntry.geometryPublicId = updatedRegion.geometryPublicId || regionEntry.geometryPublicId;
	regionEntry.territoryPublicId = updatedRegion.territoryPublicId;
	regionEntry.source = updatedRegion.source || regionEntry.source;
	regionEntry.name = updatedRegion.name || regionEntry.name;
	regionEntry.shortName = updatedRegion.shortName || "";
	regionEntry.type = updatedRegion.type || "";
	regionEntry.color = updatedRegion.color || regionEntry.color;
	regionEntry.opacity = updatedRegion.opacity ?? regionEntry.opacity;
	regionEntry.wikiUrl = updatedRegion.wikiUrl || "";
	regionEntry.wikiId = updatedRegion.wikiId || regionEntry.wikiId || null;
	regionEntry.wikiName = updatedRegion.wikiName || regionEntry.wikiName || "";
	regionEntry.wikiType = updatedRegion.wikiType || regionEntry.wikiType || "";
	regionEntry.status = updatedRegion.status || "";
	regionEntry.wikiAffiliationRaw = updatedRegion.wikiAffiliationRaw || regionEntry.wikiAffiliationRaw || "";
	regionEntry.wikiAffiliationRoot = updatedRegion.wikiAffiliationRoot || regionEntry.wikiAffiliationRoot || "";
	regionEntry.affiliationPath = updatedRegion.affiliationPath || regionEntry.affiliationPath || [];
	regionEntry.parentName = updatedRegion.parentName || "";
	regionEntry.foundedText = updatedRegion.foundedText || "";
	regionEntry.dissolvedText = updatedRegion.dissolvedText || "";
	regionEntry.wikiFoundedText = updatedRegion.wikiFoundedText || regionEntry.wikiFoundedText || "";
	regionEntry.wikiDissolvedText = updatedRegion.wikiDissolvedText || regionEntry.wikiDissolvedText || "";
	regionEntry.wikiCapitalName = updatedRegion.wikiCapitalName || regionEntry.wikiCapitalName || "";
	regionEntry.wikiSeatName = updatedRegion.wikiSeatName || regionEntry.wikiSeatName || "";
	regionEntry.coatOfArmsUrl = updatedRegion.coatOfArmsUrl || "";
	regionEntry.capitalName = updatedRegion.capitalName || "";
	regionEntry.seatName = updatedRegion.seatName || "";
	regionEntry.capitalPlacePublicId = updatedRegion.capitalPlacePublicId || "";
	regionEntry.seatPlacePublicId = updatedRegion.seatPlacePublicId || "";
	regionEntry.validFromBf = updatedRegion.validFromBf;
	regionEntry.validToBf = updatedRegion.validToBf;
	regionEntry.validLabel = updatedRegion.validLabel || "";
	regionEntry.affiliation = updatedRegion.affiliation || "";
	regionEntry.affiliationRoot = updatedRegion.affiliationRoot || "";
	regionEntry.parentPublicId = updatedRegion.parentPublicId || "";
	regionEntry.minZoom = updatedRegion.minZoom;
	regionEntry.maxZoom = updatedRegion.maxZoom;
	regionEntry.revision = updatedRegion.revision || regionEntry.revision || null;
	regionEntry.feature = feature;
	(regionEntry.layers?.length ? regionEntry.layers : [regionEntry.layer]).filter(Boolean).forEach((layer) => {
		layer.setStyle({ color: regionEntry.color, fillColor: regionEntry.color, fillOpacity: regionEntry.opacity });
	});
	regionEntry.label?.setContent(createRegionLabelMarkup(regionEntry, regionEntry.name));
}

async function createRegionAt(latlng) {
	setSelectedMapLayerMode("political");
	const center = L.latLng(latlng);
	const radius = 10;
	const points = Array.from({ length: 6 }, (_, index) => {
		const angle = Math.PI / 3 * index;
		return [center.lng + Math.cos(angle) * radius, center.lat + Math.sin(angle) * radius];
	});
	points.push(points[0]);
	if (POLITICAL_TERRITORIES_API_URL && !politicalTerritoryApiUnavailable) {
		try {
			const result = await submitPoliticalTerritoryEdit({
				action: "create_territory",
				name: "Neues Herrschaftsgebiet",
				short_name: "",
				type: "Herrschaftsgebiet",
				color: "#888888",
				opacity: 0.33,
				valid_to_open: true,
				is_active: true,
				geometry_geojson: {
					type: "Polygon",
					coordinates: [points],
				},
				style_json: {
					fill: "#888888",
					stroke: "#888888",
					fillOpacity: 0.33,
				},
			});
			void loadPoliticalTerritoryOptions();
			if (result.feature) {
				const regionEntry = normalizeRegionFeature(result.feature);
				regionData.push(result.feature);
				addRegionFeatureToMap(result.feature, regionEntry);
				if (getSelectedMapLayerMode() === "political") {
					map.addLayer(regionEntry.layer);
					if (regionEntry.label) {
						map.addLayer(regionEntry.label);
					}
				}
				startRegionGeometryEdit(regionEntry);
			}
			showFeedbackToast("Herrschaftsgebiet erstellt.", "success");
			return;
		} catch (error) {
			console.warn("Herrschaftsgebiet-Erstellung konnte nicht eindeutig bestätigt werden:", error);

			showFeedbackToast(
				error.message || "Herrschaftsgebiet konnte nicht eindeutig erstellt werden. Die Karte wird neu geladen.",
				"warning"
			);

			void loadPoliticalTerritoryOptions();
			schedulePoliticalTerritoryLayerReload();

			return;
		}
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "create_region",
			name: "Neue Region",
			color: "#888888",
			opacity: 0.33,
			wiki_url: "",
			coordinates: [points],
		});
		const regionEntry = normalizeRegionFeature(result.feature);
		regionData.push(result.feature);
		const polygon = L.polygon([points.map(([x, y]) => [y, x])], {
			pane: "regionsPane",
			color: regionEntry.color,
			weight: 2,
			fillColor: regionEntry.color,
			fillOpacity: regionEntry.opacity,
			interactive: IS_EDIT_MODE,
		}).addTo(map);
		polygon._regionEntry = regionEntry;
		regionEntry.layer = polygon;
		bindRegionPolygonEditEvents(polygon, regionEntry);
		regionPolygons.push(polygon);
		const label = L.tooltip({
			permanent: true,
			direction: "center",
			offset: [0, 0],
			opacity: 1,
			className: "region-label",
			pane: "regionLabelsPane",
		})
			.setLatLng(polygon.getBounds().getCenter())
			.setContent(regionEntry.name);
		regionEntry.label = label;
		regionLabels.push(label);
		if (getSelectedMapLayerMode() === "political") {
			map.addLayer(label);
		}
		startRegionGeometryEdit(regionEntry);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
	} catch (error) {
		showFeedbackToast(error.message || "Region konnte nicht erstellt werden.", "warning");
	}
}

async function deleteActiveRegion(selectedLayer = null, selectedPolygonIndex = null) {
	if (!regionEditEntry) return;
	if (regionEditEntry.source === "political_territory") {
		const selectedGeometryLayer = selectedLayer || activeRegionGeometryEdit?.editLayer || regionEditEntry.layer || null;
		const polygonCount = getRegionEntryLayers(regionEditEntry).length;
		if (!window.confirm(createPoliticalRegionDeleteConfirmation(regionEditEntry, polygonCount))) return;
		if (selectedGeometryLayer && polygonCount > 1) {
			try {
				await deleteRegionGeometryPart(regionEditEntry, selectedGeometryLayer);
				showFeedbackToast("Polygon gelöscht.", "success");
			} catch (error) {
				showFeedbackToast(error.message || "Polygon konnte nicht gelöscht werden.", "warning");
			}
			return;
		}

		try {
			const result = await politicalTerritoryRepository.deleteGeometry(regionEditEntry);
			removeRegionEntryFromMap(regionEditEntry);
			if (result.territory_deleted) {
				removePoliticalTerritoryOption(result.territory_public_id || regionEditEntry.territoryPublicId || "");
			}
			regionData = regionData.filter((feature) => {
				const properties = feature.properties || {};
				return properties.geometry_public_id !== regionEditEntry.geometryPublicId
					&& properties.public_id !== regionEditEntry.geometryPublicId
					&& (!result.territory_deleted || properties.territory_public_id !== regionEditEntry.territoryPublicId);
			});
			clearRegionGeometryEdit();
			setRegionEditDialogOpen(false, { resetForm: true });
			schedulePoliticalTerritoryLayerReload({ immediate: true });
			void loadChangeLog();
			showFeedbackToast(result.territory_deleted ? "Letztes Polygon gelöscht, Herrschaftsgebiet entfernt." : "Polygon gelöscht.", "success");
		} catch (error) {
			console.error("Polygon konnte nicht gelöscht werden:", error);
			showFeedbackToast(error.message || "Polygon konnte nicht gelöscht werden.", "warning");
			setRegionEditStatus(error.message || "Polygon konnte nicht gelöscht werden.", "error");
		}
		return;
	}

	if (!window.confirm(`${regionEditEntry.name} wirklich löschen?`)) return;
	if (!isSqlMapFeatureId(regionEditEntry.publicId)) {
		setRegionEditStatus("Diese Region hat keine gültige SQL-ID.", "error");
		return;
	}
	try {
		const result = await submitMapFeatureEdit({ action: "delete_feature", public_id: regionEditEntry.publicId });
		map.removeLayer(regionEditEntry.layer);
		if (regionEditEntry.label) {
			map.removeLayer(regionEditEntry.label);
			regionLabels = regionLabels.filter((label) => label !== regionEditEntry.label);
		}
		regionPolygons = regionPolygons.filter((polygon) => polygon !== regionEditEntry.layer);
		clearRegionGeometryEdit();
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setRegionEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Region gelöscht.", "success");
	} catch (error) {
		setRegionEditStatus(error.message || "Region konnte nicht gelöscht werden.", "error");
	}
}

function createPoliticalRegionDeleteConfirmation(regionEntry, polygonCount) {
	const name = regionEntry.name || "Herrschaftsgebiet";
	if (polygonCount > 1) {
		return `Ausgewähltes Polygon von ${name} wirklich löschen?`;
	}

	return `Letztes Polygon von ${name} wirklich löschen? Das Herrschaftsgebiet wird nur entfernt, wenn danach keine Flaeche mehr existiert.`;
}

function removeRegionEntryFromMap(regionEntry) {
	getRegionEntryLayers(regionEntry).forEach((layer) => map.removeLayer(layer));
	if (regionEntry.label) {
		map.removeLayer(regionEntry.label);
		regionLabels = regionLabels.filter((label) => label !== regionEntry.label);
	}
	regionPolygons = regionPolygons.filter((polygon) => polygon._regionEntry !== regionEntry);
	regionEntry.layers = [];
	regionEntry.layer = null;
	regionEntry.label = null;
}

function removePoliticalTerritoryOption(territoryPublicId) {
	const normalizedPublicId = String(territoryPublicId || "").trim();
	if (normalizedPublicId === "") {
		return;
	}

	politicalTerritoryOptions = politicalTerritoryOptions.filter((territory) => territory.public_id !== normalizedPublicId);
	prunePoliticalTerritoryHierarchy(normalizedPublicId, politicalTerritoryHierarchy);
}

function prunePoliticalTerritoryHierarchy(publicId, nodes) {
	if (!Array.isArray(nodes)) {
		return;
	}

	for (let index = nodes.length - 1; index >= 0; index--) {
		const node = nodes[index];
		if (node?.public_id === publicId) {
			nodes.splice(index, 1);
			continue;
		}
		prunePoliticalTerritoryHierarchy(publicId, node?.children);
	}
}

async function deleteRegionGeometryPart(regionEntry, selectedLayer) {
	const layers = getRegionEntryLayers(regionEntry);
	if (!selectedLayer || !layers.includes(selectedLayer)) {
		throw new Error("Die ausgewählte Teilflaeche wurde nicht gefunden.");
	}

	const remainingLayers = layers.filter((layer) => layer !== selectedLayer);
	if (remainingLayers.length < 1) {
		const result = await politicalTerritoryRepository.deleteGeometry(regionEntry);
		removeRegionEntryFromMap(regionEntry);
		if (result.territory_deleted) {
			removePoliticalTerritoryOption(result.territory_public_id || regionEntry.territoryPublicId || "");
		}
		clearRegionGeometryEdit();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		void loadChangeLog();
		return;
	}

	const result = await updatePoliticalRegionGeometry(regionEntry, regionLayersToGeoJsonGeometry(remainingLayers, regionEntry));
	map.removeLayer(selectedLayer);
	regionPolygons = regionPolygons.filter((polygon) => polygon !== selectedLayer);
	regionEntry.layers = remainingLayers;
	regionEntry.layer = regionEntry.layers[0] || null;
	regionEntry.layers.forEach((layer, index) => {
		layer._regionPolygonIndex = index;
	});
	if (result.feature) {
		applyRegionFeatureResponse(regionEntry, result.feature);
	}

	if (activeRegionGeometryEdit?.editLayer === selectedLayer) {
		clearRegionGeometryEdit();
	}
	updateRegionLabelPosition(regionEntry);
}
