/*
 * Extracted region overlap selection helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

function getRegionLayerGeometryPublicId(layer) {
	return String(layer?._regionEntry?.geometryPublicId || layer?._regionEntry?.publicId || "").trim();
}

function isLatLngInsideRegionRing(latlng, ring) {
	if (!Array.isArray(ring) || ring.length < 3) {
		return false;
	}

	const testLat = Number(latlng?.lat);
	const testLng = Number(latlng?.lng);
	if (!Number.isFinite(testLat) || !Number.isFinite(testLng)) {
		return false;
	}

	let inside = false;
	for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
		const currentPoint = ring[index];
		const previousPoint = ring[previousIndex];
		const currentLat = Number(currentPoint?.lat);
		const currentLng = Number(currentPoint?.lng);
		const previousLat = Number(previousPoint?.lat);
		const previousLng = Number(previousPoint?.lng);

		if (!Number.isFinite(currentLat) || !Number.isFinite(currentLng) || !Number.isFinite(previousLat) || !Number.isFinite(previousLng)) {
			continue;
		}

		const intersects = ((currentLat > testLat) !== (previousLat > testLat))
			&& (testLng < ((previousLng - currentLng) * (testLat - currentLat) / ((previousLat - currentLat) || Number.EPSILON)) + currentLng);
		if (intersects) {
			inside = !inside;
		}
	}

	return inside;
}

function isLatLngInsideRegionLayer(layer, latlng) {
	if (!layer || !latlng) {
		return false;
	}

	const normalizedLatLng = L.latLng(latlng);
	if (!layer.getBounds?.().contains?.(normalizedLatLng)) {
		return false;
	}

	const layerPoint = map.latLngToLayerPoint(normalizedLatLng);
	if (typeof layer._containsPoint === "function" && layer._map) {
		return layer._containsPoint(layerPoint);
	}

	const rings = layer.getLatLngs?.();
	if (!Array.isArray(rings) || rings.length < 1 || !Array.isArray(rings[0])) {
		return false;
	}

	if (!isLatLngInsideRegionRing(normalizedLatLng, rings[0])) {
		return false;
	}

	for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
		if (isLatLngInsideRegionRing(normalizedLatLng, rings[ringIndex])) {
			return false;
		}
	}

	return true;
}

function getOverlappingPoliticalRegionLayersAtLatLng(latlng, preferredLayer = null) {
	const normalizedLatLng = L.latLng(latlng);
	const candidates = [];

	regionPolygons.forEach((layer) => {
		const candidateRegion = layer?._regionEntry;
		if (!candidateRegion || candidateRegion.source !== "political_territory") {
			return;
		}

		if (isLatLngInsideRegionLayer(layer, normalizedLatLng)) {
			candidates.push(layer);
		}
	});

	if (candidates.length < 2) {
		return candidates;
	}

	const uniqueCandidates = [];
	const seenLayerIds = new Set();
	candidates.forEach((layer) => {
		const layerId = L.stamp(layer);
		if (seenLayerIds.has(layerId)) {
			return;
		}
		seenLayerIds.add(layerId);
		uniqueCandidates.push(layer);
	});

	const hasPreferredLayer = preferredLayer && uniqueCandidates.includes(preferredLayer);
	const orderedCandidates = hasPreferredLayer
		? [preferredLayer, ...uniqueCandidates.filter((layer) => layer !== preferredLayer)]
		: [...uniqueCandidates];

	const headLayer = orderedCandidates[0] || null;
	const tailLayers = orderedCandidates.slice(1).sort((leftLayer, rightLayer) => {
		const leftGeometry = getRegionLayerGeometryPublicId(leftLayer) || `layer:${L.stamp(leftLayer)}`;
		const rightGeometry = getRegionLayerGeometryPublicId(rightLayer) || `layer:${L.stamp(rightLayer)}`;
		return leftGeometry.localeCompare(rightGeometry, "de");
	});

	const orderedResult = headLayer ? [headLayer, ...tailLayers] : tailLayers;

	// Idiotensicher: Liegt unter dem Klick eine Quellfläche, biete NUR die Quelle(n) als
	// Klickziel an — die per bringToFront() darüberliegende Außengrenzen-Kontur fängt keine
	// Innenklicks mehr ab (1 Klick = Quelle, kein Durchklicken nötig). Liegt KEINE Quelle
	// darunter (z. B. niedriger Zoom, Quellen ausgeblendet), bleibt die Außengrenze die
	// (einzige) Auswahl. Die Außengrenze selbst bleibt über das Kontextmenü „erzeugen/
	// aktualisieren" (resolveBoundaryActionRegion ermittelt sie aus der Quelle) erreichbar.
	const sourceLayers = orderedResult.filter((layer) => layer?._regionEntry?.isDerivedGeometry !== true);
	const derivedLayers = orderedResult.filter((layer) => layer?._regionEntry?.isDerivedGeometry === true);
	return sourceLayers.length > 0 ? sourceLayers : derivedLayers;
}

function resolveOverlappingRegionLayerSelection(latlng, fallbackLayer = null) {
	const normalizedLatLng = L.latLng(latlng);
	const candidateLayers = getOverlappingPoliticalRegionLayersAtLatLng(normalizedLatLng, fallbackLayer);
	// Den ermittelten Kandidaten (nach Quelle-bevorzugter Filterung) dem rohen angeklickten
	// Layer vorziehen: fallbackLayer ist die oberste angeklickte Geometrie (oft die per
	// bringToFront() darüberliegende Außengrenze). Stünde fallbackLayer zuerst, gewänne bei
	// genau 1 Kandidat (der Quelle) trotzdem die angeklickte Außengrenze -> falsche Auswahl.
	const fallbackResultLayer = candidateLayers[0] || fallbackLayer || null;

	if (candidateLayers.length < 2) {
		recentRegionOverlapSelection = null;
		return {
			layer: fallbackResultLayer,
			total: Math.max(candidateLayers.length, fallbackResultLayer ? 1 : 0),
			index: 0,
		};
	}

	const signature = candidateLayers
		.map((layer) => getRegionLayerGeometryPublicId(layer) || `layer:${L.stamp(layer)}`)
		.join("|");
	let nextIndex = 0;
	const now = Date.now();
	if (recentRegionOverlapSelection && recentRegionOverlapSelection.signature === signature && now - recentRegionOverlapSelection.timestamp <= REGION_OVERLAP_SELECTION_TIMEOUT_MS) {
		const previousPoint = map.latLngToContainerPoint(recentRegionOverlapSelection.latlng);
		const currentPoint = map.latLngToContainerPoint(normalizedLatLng);
		if (previousPoint.distanceTo(currentPoint) <= REGION_OVERLAP_SELECTION_MAX_PIXEL_DISTANCE) {
			nextIndex = (recentRegionOverlapSelection.index + 1) % candidateLayers.length;
		}
	}

	recentRegionOverlapSelection = {
		signature,
		index: nextIndex,
		latlng: normalizedLatLng,
		timestamp: now,
	};

	return {
		layer: candidateLayers[nextIndex] || fallbackResultLayer,
		total: candidateLayers.length,
		index: nextIndex,
	};
}

function announceOverlappingRegionSelection(selection) {
	if (!selection || selection.total < 2 || typeof showFeedbackToast !== "function") {
		return;
	}

	const selectedRegion = selection.layer?._regionEntry || {};
	const geometryLabelParts = [];
	if (selectedRegion.geometryId !== null && selectedRegion.geometryId !== undefined) {
		geometryLabelParts.push(`#${selectedRegion.geometryId}`);
	}
	if (selectedRegion.geometryPublicId) {
		geometryLabelParts.push(selectedRegion.geometryPublicId);
	}

	const geometrySuffix = geometryLabelParts.length > 0 ? ` (${geometryLabelParts.join(" / ")})` : "";
	showFeedbackToast(`Ueberlagerte Geometrien: ${selection.index + 1}/${selection.total}${geometrySuffix}`, "info");
}
