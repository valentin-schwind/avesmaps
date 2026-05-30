let derivedGeometryEditorState = {
	territoryPublicId: "",
	existingPublicId: "",
	geometry: null,
	labelCenter: null,
	previewLayer: null,
	dirty: false,
	loading: false,
};

function ensureDerivedGeometryEditorPanel() {
	if (document.getElementById("region-edit-derived-geometry-panel")) {
		return;
	}

	const zoomGrid = document.getElementById("region-edit-max-zoom")?.closest?.(".location-report-form__grid");
	if (!zoomGrid) {
		return;
	}

	zoomGrid.insertAdjacentHTML("afterend", `
		<section id="region-edit-derived-geometry-panel" class="political-territory-derived-geometry-panel political-territory-field" hidden>
			<div class="political-territory-derived-geometry-panel__header">
				<h3>Geometrie</h3>
				<button id="region-edit-derived-geometry-refresh" class="location-report-form__button location-report-form__button--secondary" type="button">Außengrenze erzeugen/aktualisieren</button>
			</div>
			<label class="location-report-form__checkbox">
				<input id="region-edit-derived-geometry-enabled" name="derived_geometry_enabled" type="checkbox" />
				<span>Außengrenzen darstellen</span>
			</label>
			<label class="location-report-form__checkbox">
				<input id="region-edit-derived-geometry-all-descendants" name="derived_geometry_all_descendants" type="checkbox" disabled />
				<span>Für alle Unterregionen übernehmen <small>folgt nach dem Einzelgebiet-Durchstich</small></span>
			</label>
			<div class="location-report-form__grid">
				<label class="location-report-form__field">
					<span>Außengrenze Zoom von</span>
					<input id="region-edit-derived-geometry-min-zoom" name="derived_geometry_min_zoom" type="number" min="0" max="6" step="1" />
				</label>
				<label class="location-report-form__field">
					<span>Außengrenze Zoom bis</span>
					<input id="region-edit-derived-geometry-max-zoom" name="derived_geometry_max_zoom" type="number" min="0" max="6" step="1" />
				</label>
			</div>
			<div class="political-territory-derived-geometry-preview">
				<div id="region-edit-derived-geometry-thumbnail" class="political-territory-derived-geometry-thumbnail" aria-label="Vorschau der Außengrenze"></div>
				<div class="political-territory-derived-geometry-status-box">
					<p id="region-edit-derived-geometry-status" class="location-report-form__status" role="status" aria-live="polite"></p>
					<progress id="region-edit-derived-geometry-progress" class="political-territory-derived-geometry-progress" max="100" value="0" hidden></progress>
				</div>
			</div>
		</section>
	`);

	document.getElementById("region-edit-derived-geometry-enabled")?.addEventListener("change", () => {
		derivedGeometryEditorState.dirty = true;
		void syncDerivedGeometryEditorPreview();
	});
	document.getElementById("region-edit-derived-geometry-refresh")?.addEventListener("click", () => {
		void generateOrUpdateDerivedBoundaryForCurrentEditorRegion();
	});
	document.getElementById("region-edit-derived-geometry-min-zoom")?.addEventListener("input", () => {
		derivedGeometryEditorState.dirty = true;
	});
	document.getElementById("region-edit-derived-geometry-max-zoom")?.addEventListener("input", () => {
		derivedGeometryEditorState.dirty = true;
	});
}

function resetDerivedGeometryEditor() {
	clearDerivedGeometryPreviewLayer();
	derivedGeometryEditorState = {
		territoryPublicId: "",
		existingPublicId: "",
		geometry: null,
		labelCenter: null,
		previewLayer: null,
		dirty: false,
		loading: false,
	};
	const panel = document.getElementById("region-edit-derived-geometry-panel");
	if (panel) {
		panel.hidden = true;
	}
	setDerivedGeometryEditorStatus();
	setDerivedGeometryEditorProgress(0, false);
	setDerivedGeometryThumbnail(null);
}

function syncDerivedGeometryEditorForRegion(region) {
	ensureDerivedGeometryEditorPanel();
	const panel = document.getElementById("region-edit-derived-geometry-panel");
	const source = String(region?.source || "").trim();
	const territoryPublicId = String(region?.territoryPublicId || region?.publicId || "").trim();
	if (!panel || source !== "political_territory" || !territoryPublicId) {
		resetDerivedGeometryEditor();
		return;
	}

	panel.hidden = false;
	clearDerivedGeometryPreviewLayer();
	derivedGeometryEditorState = {
		territoryPublicId,
		existingPublicId: "",
		geometry: null,
		labelCenter: null,
		previewLayer: null,
		dirty: false,
		loading: true,
	};

	document.getElementById("region-edit-derived-geometry-enabled").checked = false;
	document.getElementById("region-edit-derived-geometry-all-descendants").checked = false;
	document.getElementById("region-edit-derived-geometry-min-zoom").value = region?.minZoom ?? "";
	document.getElementById("region-edit-derived-geometry-max-zoom").value = region?.maxZoom ?? "";
	setDerivedGeometryThumbnail(null);
	setDerivedGeometryEditorProgress(0, false);
	setDerivedGeometryEditorStatus("Bestehende Außengrenze wird geprüft...", "pending");

	void politicalTerritoryRepository.getDerivedGeometry(territoryPublicId)
		.then((response) => {
			if (derivedGeometryEditorState.territoryPublicId !== territoryPublicId) {
				return;
			}
			const derivedGeometry = response?.derived_geometry || null;
			derivedGeometryEditorState.loading = false;
			if (!derivedGeometry) {
				setDerivedGeometryEditorStatus("Keine gespeicherte Außengrenze. Aktiviere die Option, um eine Vorschau zu erzeugen.", "info");
				return;
			}
			document.getElementById("region-edit-derived-geometry-enabled").checked = true;
			document.getElementById("region-edit-derived-geometry-min-zoom").value = derivedGeometry.min_zoom ?? "";
			document.getElementById("region-edit-derived-geometry-max-zoom").value = derivedGeometry.max_zoom ?? "";
			derivedGeometryEditorState.existingPublicId = derivedGeometry.public_id || "";
			derivedGeometryEditorState.geometry = derivedGeometry.geometry || null;
			derivedGeometryEditorState.labelCenter = readDerivedGeometryLabelCenter(derivedGeometry.geometry || null, derivedGeometry);
			derivedGeometryEditorState.dirty = false;
			drawDerivedGeometryPreview(derivedGeometry.geometry || null);
			setDerivedGeometryThumbnail(derivedGeometry.geometry || null);
			setDerivedGeometryEditorStatus("Gespeicherte Außengrenze geladen.", "success");
		})
		.catch((error) => {
			if (derivedGeometryEditorState.territoryPublicId !== territoryPublicId) {
				return;
			}
			derivedGeometryEditorState.loading = false;
			console.error("Derived geometry konnte nicht geladen werden:", error);
			setDerivedGeometryEditorStatus(error.message || "Außengrenze konnte nicht geladen werden.", "error");
		});
}

async function syncDerivedGeometryEditorPreview() {
	if (!document.getElementById("region-edit-derived-geometry-enabled")?.checked) {
		clearDerivedGeometryPreviewLayer();
		setDerivedGeometryThumbnail(null);
		setDerivedGeometryEditorStatus("Außengrenze wird beim Speichern deaktiviert.", "info");
		derivedGeometryEditorState.geometry = null;
		derivedGeometryEditorState.labelCenter = null;
		return;
	}

	await rebuildDerivedGeometryEditorPreview();
}

async function rebuildDerivedGeometryEditorPreview() {
	const territoryPublicId = getDerivedGeometryEditorTerritoryPublicId();
	if (!territoryPublicId) {
		setDerivedGeometryEditorStatus("Kein Herrschaftsgebiet für die Außengrenze ausgewählt.", "error");
		return null;
	}
	if (!window.polygonClipping) {
		setDerivedGeometryEditorStatus("Polygon-Clipping-Bibliothek ist nicht geladen.", "error");
		return null;
	}

	setDerivedGeometryEditorProgress(12, true);
	setDerivedGeometryEditorStatus("Außengrenze wird aus Unterflächen berechnet...", "pending");
	const response = await politicalTerritoryRepository.getDerivedGeometrySources(territoryPublicId);
	const result = buildDerivedBoundaryFromSourceResponse(response);
	setDerivedGeometryEditorProgress(78, true);

	derivedGeometryEditorState.territoryPublicId = territoryPublicId;
	derivedGeometryEditorState.geometry = result.geometry;
	derivedGeometryEditorState.labelCenter = result.labelCenter;
	derivedGeometryEditorState.dirty = true;
	drawDerivedGeometryPreview(result.geometry);
	setDerivedGeometryThumbnail(result.geometry);
	setDerivedGeometryEditorProgress(100, false);
	setDerivedGeometryEditorStatus(`${result.sourceCount} Unterflächen zu einer Außengrenze vereinigt.`, "success");

	return result.geometry;
}

// Reine Union ohne UI-Seiteneffekte. Liefert null, wenn keine Quellflächen vorliegen.
// Dies ist die EINE Berechnungslogik, die Vorschau, Save-Hook und Kaskade gemeinsam nutzen.
function unionDerivedSources(response) {
	const sourceGeometries = Array.isArray(response?.source_geometries) ? response.source_geometries : [];
	const clippingGeometries = sourceGeometries
		.map((entry) => geoJsonGeometryToClippingMultiPolygon(entry.geometry))
		.filter((geometry) => Array.isArray(geometry) && geometry.length > 0);

	if (clippingGeometries.length < 1) {
		return null;
	}

	const unionGeometry = normalizeClippingMultiPolygon(
		window.polygonClipping.union(...clippingGeometries),
		"Automatische Außengrenze"
	);
	const geometry = clippingMultiPolygonToGeoJson(unionGeometry);
	return {
		geometry,
		labelCenter: readDerivedGeometryLabelCenter(geometry),
		sourceCount: sourceGeometries.length,
	};
}

function buildDerivedBoundaryFromSourceResponse(response) {
	const result = unionDerivedSources(response);
	if (!result) {
		clearDerivedGeometryPreviewLayer();
		setDerivedGeometryThumbnail(null);
		throw new Error("Keine Unterflächen für eine automatische Außengrenze gefunden.");
	}
	return result;
}

// Liest das bestehende Innengrenzen-Flag eines Ziels, damit Neuberechnung/Kaskade es
// ERHALTEN statt es hart auf false zu klobbern (sonst verliert ein Elterngebiet beim
// Bearbeiten eines Kindes seine bewusste "Innengrenzen an"-Wahl). Default false nur,
// wenn das Ziel noch keine Außengrenze hat (neue Außengrenze = innen aus).
async function readExistingShowInnerBoundaries(territoryPublicId) {
	try {
		const existing = await politicalTerritoryRepository.getDerivedGeometry(territoryPublicId);
		const derived = existing?.derived_geometry;
		if (derived) {
			return derived.show_inner_boundaries !== false;
		}
	} catch (error) {
		// Fallback unten.
	}
	return false;
}

// Berechnet und speichert die Außengrenze EINES Targets ohne UI-/Vorschau-Seiteneffekte.
// Wird von der Kaskade benutzt, um Ancestors (und optional Unterregionen) mitzuziehen.
async function recomputeDerivedBoundaryForTargetSilently(targetPublicId, plan) {
	const sources = await politicalTerritoryRepository.getDerivedGeometrySources(targetPublicId);
	const result = unionDerivedSources(sources);
	if (!result) {
		return { skipped: true };
	}
	const showInnerBoundaries = await readExistingShowInnerBoundaries(targetPublicId);
	await politicalTerritoryRepository.saveDerivedGeometry({
		territory_public_id: targetPublicId,
		geometry_geojson: result.geometry,
		label_lng: result.labelCenter?.lng ?? null,
		label_lat: result.labelCenter?.lat ?? null,
		// Leeres Zoom-Band: das Backend uebernimmt das globale Band des Territoriums.
		min_zoom: "",
		max_zoom: "",
		// Inner-Flag des Ziels ERHALTEN (Default false nur für neue Außengrenzen, s. readExistingShowInnerBoundaries).
		show_inner_boundaries: showInnerBoundaries,
		source_revision: findDerivedBoundaryPlanSourceRevision(plan, targetPublicId),
		is_active: true,
	});
	return { saved: true };
}

async function generateOrUpdateDerivedBoundaryForCurrentEditorRegion() {
	const territoryPublicId = getDerivedGeometryEditorTerritoryPublicId();
	if (!territoryPublicId) {
		setDerivedGeometryEditorStatus("Kein Herrschaftsgebiet für die Außengrenze ausgewählt.", "error");
		return null;
	}

	return generateOrUpdateDerivedBoundaryForTerritory(territoryPublicId, {
		regionEntry: regionEditEntry,
		applyToSubregions: document.getElementById("region-edit-derived-geometry-all-descendants")?.checked === true,
		drawPreview: true,
	});
}

async function generateOrUpdateDerivedBoundaryForRegion(regionEntry, options = {}) {
	const territoryPublicId = String(regionEntry?.territoryPublicId || regionEntry?.publicId || "").trim();
	if (!territoryPublicId) {
		showFeedbackToast("Das Herrschaftsgebiet hat keine Territory-ID.", "warning");
		return null;
	}

	return generateOrUpdateDerivedBoundaryForTerritory(territoryPublicId, { ...options, regionEntry });
}

async function generateOrUpdateDerivedBoundaryForTerritory(territoryPublicId, options = {}) {
	if (!window.polygonClipping) {
		throw new Error("Polygon-Clipping-Bibliothek ist nicht geladen.");
	}

	const applyToSubregions = options.applyToSubregions === true;
	const shouldDrawPreview = options.drawPreview !== false;
	const selectedYearBf = Number.isFinite(Number(options.selectedYearBf))
		? Number(options.selectedYearBf)
		: Number.isFinite(Number(politicalTimelineYear)) ? Number(politicalTimelineYear) : null;
	const regionEntry = options.regionEntry || null;
	const targetName = regionEntry?.name || "Herrschaftsgebiet";
	if (!shouldDrawPreview) {
		clearDerivedGeometryPreviewLayer();
	}
	setDerivedGeometryEditorBusy(true);
	setDerivedGeometryEditorProgress(5, true);
	setDerivedGeometryEditorStatus(`${targetName}: Boundary-Plan wird geladen...`, "pending");
	showFeedbackToast("Außengrenze wird erzeugt...", "info");

	try {
		const plan = await politicalTerritoryRepository.getDerivedGeometryPlan(territoryPublicId, { selectedYearBf, applyToSubregions });
		if (Array.isArray(plan?.blocking_warnings) && plan.blocking_warnings.length > 0) {
			throw new Error(plan.blocking_warnings[0]?.message || "Boundary-Plan hat blockierende Warnungen.");
		}
		setDerivedGeometryEditorProgress(22, true);
		setDerivedGeometryEditorStatus(`${targetName}: Quellflächen werden geladen...`, "pending");

		const sources = await politicalTerritoryRepository.getDerivedGeometrySources(territoryPublicId);
		setDerivedGeometryEditorProgress(44, true);
		setDerivedGeometryEditorStatus(`${targetName}: Polygon-Union wird berechnet...`, "pending");
		await waitForNextFrame();
		const result = buildDerivedBoundaryFromSourceResponse(sources);
		setDerivedGeometryEditorProgress(76, true);
		setDerivedGeometryEditorStatus(`${targetName}: Außengrenze wird gespeichert...`, "pending");

		const sourceRevision = findDerivedBoundaryPlanSourceRevision(plan, territoryPublicId);
		const showInnerBoundaries = await readExistingShowInnerBoundaries(territoryPublicId);
		const saved = await politicalTerritoryRepository.saveDerivedGeometry({
			territory_public_id: territoryPublicId,
			geometry_geojson: result.geometry,
			label_lng: result.labelCenter?.lng ?? null,
			label_lat: result.labelCenter?.lat ?? null,
			min_zoom: "",
			max_zoom: "",
			// Inner-Flag des Ziels ERHALTEN (Default false nur für neue Außengrenzen, s. readExistingShowInnerBoundaries).
			show_inner_boundaries: showInnerBoundaries,
			source_revision: sourceRevision,
			is_active: true,
		});

		derivedGeometryEditorState.territoryPublicId = territoryPublicId;
		derivedGeometryEditorState.geometry = result.geometry;
		derivedGeometryEditorState.labelCenter = result.labelCenter;
		derivedGeometryEditorState.existingPublicId = saved?.derived_geometry?.public_id || derivedGeometryEditorState.existingPublicId || "";
		derivedGeometryEditorState.dirty = false;
		document.getElementById("region-edit-derived-geometry-enabled") && (document.getElementById("region-edit-derived-geometry-enabled").checked = true);
		if (shouldDrawPreview) {
			drawDerivedGeometryPreview(result.geometry);
		}
		setDerivedGeometryThumbnail(result.geometry);
		setDerivedGeometryEditorProgress(100, false);
		setDerivedGeometryEditorStatus(`${result.sourceCount} Unterflächen vereinigt und gespeichert.`, "success");
		// Kaskade: betroffene Übergebiete (Ancestors) und bei applyToSubregions die
			// Unterregionen aus dem Plan bottom-up neu berechnen und speichern. So aktualisiert
			// eine Änderung an einem Kind automatisch die Außengrenze des Elterngebiets.
			const cascadeTargets = (Array.isArray(plan?.recompute_targets) ? plan.recompute_targets : [])
				.map((entry) => String(entry?.territory_public_id || "").trim())
				.filter((publicId) => publicId && publicId !== territoryPublicId);
			let cascadeSaved = 0;
			for (const cascadeTargetPublicId of cascadeTargets) {
				try {
					const cascadeResult = await recomputeDerivedBoundaryForTargetSilently(cascadeTargetPublicId, plan);
					if (cascadeResult && cascadeResult.saved) cascadeSaved += 1;
				} catch (cascadeError) {
					console.warn("Kaskaden-Neuberechnung fehlgeschlagen für", cascadeTargetPublicId, cascadeError);
				}
			}
			if (cascadeSaved > 0) {
				setDerivedGeometryEditorStatus(`Außengrenze gespeichert; ${cascadeSaved} Übergebiet(e) automatisch aktualisiert.`, "success");
			}
			schedulePoliticalTerritoryLayerReload({ immediate: true });
		void loadChangeLog();
		showFeedbackToast("Außengrenze erzeugt/aktualisiert.", "success");
		return saved;
	} catch (error) {
		console.error("Außengrenze konnte nicht erzeugt werden:", error);
		setDerivedGeometryEditorProgress(0, false);
		setDerivedGeometryEditorStatus(error.message || "Außengrenze konnte nicht erzeugt werden.", "error");
		showFeedbackToast(error.message || "Außengrenze konnte nicht erzeugt werden.", "warning");
		throw error;
	} finally {
		setDerivedGeometryEditorBusy(false);
	}
}

function findDerivedBoundaryPlanSourceRevision(plan, territoryPublicId) {
	const nodes = Array.isArray(plan?.plan_nodes) ? plan.plan_nodes : [];
	const targetNode = nodes.find((node) => String(node?.territory_public_id || "") === String(territoryPublicId || ""));
	return String(targetNode?.source_revision_hint || "").trim();
}

function readDerivedBoundaryMinZoom(regionEntry) {
	return String(document.getElementById("region-edit-derived-geometry-min-zoom")?.value || regionEntry?.minZoom || "").trim();
}

function readDerivedBoundaryMaxZoom(regionEntry) {
	return String(document.getElementById("region-edit-derived-geometry-max-zoom")?.value || regionEntry?.maxZoom || "").trim();
}

function waitForNextFrame() {
	return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function getDerivedGeometryEditorTerritoryPublicId() {
	return String(
		document.getElementById("region-edit-territory-public-id")?.value
		|| derivedGeometryEditorState.territoryPublicId
		|| regionEditEntry?.territoryPublicId
		|| regionEditEntry?.publicId
		|| ""
	).trim();
}

function geoJsonGeometryToClippingMultiPolygon(geometry) {
	if (!geometry || typeof geometry !== "object") {
		return [];
	}
	if (geometry.type === "Polygon") {
		return normalizeClippingMultiPolygon([geometry.coordinates], "Quellgeometrie");
	}
	if (geometry.type === "MultiPolygon") {
		return normalizeClippingMultiPolygon(geometry.coordinates, "Quellgeometrie");
	}
	return [];
}

function drawDerivedGeometryPreview() {
	// Karten-Vorschau-Overlay entfernt (Nutzerwunsch 2026-05-30): die gestrichelte
	// Parent-Vorschau auf der Karte doppelte die echte gerenderte Außengrenze (Doppellinie)
	// und blieb nach dem Speichern stehen. Feedback über mögliche Lücken gibt jetzt nur noch
	// das Thumbnail im Editor (setDerivedGeometryThumbnail). Wir entfernen nur etwaige Alt-Layer.
	clearDerivedGeometryPreviewLayer();
}

function clearDerivedGeometryPreviewLayer() {
	if (derivedGeometryEditorState.previewLayer && map?.hasLayer?.(derivedGeometryEditorState.previewLayer)) {
		map.removeLayer(derivedGeometryEditorState.previewLayer);
	}
	derivedGeometryEditorState.previewLayer = null;
}

function readDerivedGeometryLabelCenter(geometry, derivedGeometry = {}) {
	const labelLng = Number(derivedGeometry.label_lng);
	const labelLat = Number(derivedGeometry.label_lat);
	if (Number.isFinite(labelLng) && Number.isFinite(labelLat)) {
		return { lng: labelLng, lat: labelLat };
	}
	const bounds = calculateGeoJsonGeometryBounds(geometry);
	if (!bounds) {
		return null;
	}
	return {
		lng: (bounds.minX + bounds.maxX) / 2,
		lat: (bounds.minY + bounds.maxY) / 2,
	};
}

function calculateGeoJsonGeometryBounds(geometry) {
	const coordinates = [];
	collectGeoJsonCoordinatePairs(geometry?.coordinates, coordinates);
	if (coordinates.length < 1) {
		return null;
	}
	const xValues = coordinates.map((coordinate) => coordinate[0]);
	const yValues = coordinates.map((coordinate) => coordinate[1]);
	return {
		minX: Math.min(...xValues),
		minY: Math.min(...yValues),
		maxX: Math.max(...xValues),
		maxY: Math.max(...yValues),
	};
}

function collectGeoJsonCoordinatePairs(value, coordinates) {
	if (!Array.isArray(value)) {
		return;
	}
	if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
		coordinates.push([Number(value[0]), Number(value[1])]);
		return;
	}
	value.forEach((entry) => collectGeoJsonCoordinatePairs(entry, coordinates));
}

function setDerivedGeometryThumbnail(geometry) {
	const container = document.getElementById("region-edit-derived-geometry-thumbnail");
	if (!container) {
		return;
	}
	if (!geometry) {
		container.innerHTML = `<span>Keine Vorschau</span>`;
		return;
	}
	const bounds = calculateGeoJsonGeometryBounds(geometry);
	if (!bounds) {
		container.innerHTML = `<span>Keine Vorschau</span>`;
		return;
	}
	const width = 180;
	const height = 110;
	const padding = 8;
	const spanX = Math.max(0.000001, bounds.maxX - bounds.minX);
	const spanY = Math.max(0.000001, bounds.maxY - bounds.minY);
	const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
	const pathData = geoJsonGeometryToSvgPaths(geometry, bounds, scale, padding, height).join(" ");
	container.innerHTML = `
		<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Abgeleitete Außengrenze">
			<path d="${pathData}" fill="rgba(201, 169, 104, 0.45)" stroke="currentColor" stroke-width="1.5" />
		</svg>
	`;
}

function geoJsonGeometryToSvgPaths(geometry, bounds, scale, padding, height) {
	const polygons = geometry?.type === "Polygon"
		? [geometry.coordinates]
		: geometry?.type === "MultiPolygon"
			? geometry.coordinates
			: [];
	return polygons.flatMap((polygon) => polygon.map((ring) => {
		const commands = ring.map((coordinate, index) => {
			const x = padding + (Number(coordinate[0]) - bounds.minX) * scale;
			const y = height - padding - (Number(coordinate[1]) - bounds.minY) * scale;
			return `${index === 0 ? "M" : "L"}${roundGeometryCoordinate(x)} ${roundGeometryCoordinate(y)}`;
		});
		return `${commands.join(" ")} Z`;
	}));
}

function setDerivedGeometryEditorStatus(message = "", type = "") {
	const status = document.getElementById("region-edit-derived-geometry-status");
	if (!status) {
		return;
	}
	status.textContent = message;
	status.dataset.status = type;
}

function setDerivedGeometryEditorProgress(value = 0, visible = false) {
	const progress = document.getElementById("region-edit-derived-geometry-progress");
	if (!progress) {
		return;
	}
	progress.value = Math.max(0, Math.min(100, Number(value) || 0));
	progress.hidden = !visible;
}

function setDerivedGeometryEditorBusy(isBusy) {
	derivedGeometryEditorState.loading = isBusy;
	document.getElementById("region-edit-derived-geometry-refresh")?.toggleAttribute("disabled", isBusy);
	document.getElementById("region-edit-derived-geometry-enabled")?.toggleAttribute("disabled", isBusy);
}

async function saveDerivedGeometryEditorIfNeeded() {
	const panel = document.getElementById("region-edit-derived-geometry-panel");
	if (!panel || panel.hidden) {
		return null;
	}
	const territoryPublicId = getDerivedGeometryEditorTerritoryPublicId();
	if (!territoryPublicId) {
		return null;
	}
	const enabled = document.getElementById("region-edit-derived-geometry-enabled")?.checked === true;
	if (!enabled) {
		if (!derivedGeometryEditorState.dirty && !derivedGeometryEditorState.existingPublicId) {
			return null;
		}
		return politicalTerritoryRepository.deleteDerivedGeometry(territoryPublicId);
	}

	let geometry = derivedGeometryEditorState.geometry;
	if (!geometry || derivedGeometryEditorState.territoryPublicId !== territoryPublicId) {
		geometry = await rebuildDerivedGeometryEditorPreview();
	}
	if (!geometry) {
		throw new Error("Die Außengrenze konnte nicht berechnet werden.");
	}
	const labelCenter = derivedGeometryEditorState.labelCenter || readDerivedGeometryLabelCenter(geometry);
	return politicalTerritoryRepository.saveDerivedGeometry({
		territory_public_id: territoryPublicId,
		geometry_geojson: geometry,
		label_lng: labelCenter?.lng ?? null,
		label_lat: labelCenter?.lat ?? null,
		min_zoom: String(document.getElementById("region-edit-derived-geometry-min-zoom")?.value || "").trim(),
		max_zoom: String(document.getElementById("region-edit-derived-geometry-max-zoom")?.value || "").trim(),
		is_active: true,
	});
}

function injectDerivedGeometryEditorStyles() {
	if (document.getElementById("derived-geometry-editor-styles")) {
		return;
	}
	const style = document.createElement("style");
	style.id = "derived-geometry-editor-styles";
	style.textContent = `
		.political-territory-derived-geometry-panel {
			display: grid;
			gap: 10px;
			padding: 12px;
			border: 1px solid var(--color-border, #c8bda8);
			border-radius: var(--radius-md, 8px);
			background: rgba(255, 250, 240, 0.55);
		}
		.political-territory-derived-geometry-panel__header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
		}
		.political-territory-derived-geometry-panel__header h3 {
			margin: 0;
			font-size: 15px;
		}
		.political-territory-derived-geometry-preview {
			display: grid;
			grid-template-columns: 190px minmax(0, 1fr);
			gap: 10px;
			align-items: center;
		}
		.political-territory-derived-geometry-status-box {
			display: grid;
			gap: 6px;
		}
		.political-territory-derived-geometry-progress {
			width: 100%;
			height: 10px;
		}
		.political-territory-derived-geometry-thumbnail {
			display: grid;
			place-items: center;
			min-height: 116px;
			border: 1px solid var(--color-border, #c8bda8);
			border-radius: var(--radius-sm, 6px);
			background: rgba(255, 255, 255, 0.58);
			color: #5b432b;
			font-size: 12px;
		}
		.political-territory-derived-geometry-thumbnail svg {
			width: 180px;
			height: 110px;
		}
		@media (max-width: 680px) {
			.political-territory-derived-geometry-preview {
				grid-template-columns: 1fr;
			}
		}
	`;
	document.head.appendChild(style);
}

$(document).ready(() => {
	injectDerivedGeometryEditorStyles();
	ensureDerivedGeometryEditorPanel();
});

window.AvesmapsDerivedBoundaryEditor = {
	generateOrUpdateForRegion: generateOrUpdateDerivedBoundaryForRegion,
	generateOrUpdateForTerritory: generateOrUpdateDerivedBoundaryForTerritory,
};
