"use strict";

(function initDerivedGeometryIframeEditor() {
	const WRITE_API_URL = window.AvesmapsPoliticalTerritoryEditorApi?.writeApiUrl || "/api/app/political-territories.php?debug_errors=1";
	let state = {
		targetKey: "",
		territoryPublicId: "",
		geometry: null,
		labelCenter: null,
		existingPublicId: "",
		dirty: false,
	};

	function normalizeText(value) {
		return window.AvesmapsPoliticalTerritoryEditorForm?.normalizeText?.(value)
			|| String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function apiUrl(params = {}) {
		const separator = WRITE_API_URL.includes("?") ? "&" : "?";
		const search = new URLSearchParams(params);
		return `${WRITE_API_URL}${separator}${search.toString()}`;
	}

	async function readJson(response) {
		const payload = await response.json().catch(() => ({}));
		if (!response.ok || payload?.ok === false) {
			throw new Error(payload?.error || `Herrschaftsgebiet-API antwortet mit HTTP ${response.status}.`);
		}
		return payload;
	}

	async function fetchDerivedGeometry(targetKey) {
		const response = await fetch(apiUrl({ action: "derived_geometry", target_key: targetKey }), {
			method: "GET",
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		return readJson(response);
	}

	async function fetchDerivedGeometrySources(targetKey) {
		const response = await fetch(apiUrl({ action: "derived_geometry_sources", target_key: targetKey }), {
			method: "GET",
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		return readJson(response);
	}

	async function submitDerivedGeometry(payload) {
		const response = await fetch(WRITE_API_URL, {
			method: "PATCH",
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});
		return readJson(response);
	}

	function ensurePanel() {
		if (document.getElementById("derivedGeometryPanel")) return;
		const manualDataForm = document.querySelector(".manual-data-box");
		if (!manualDataForm) return;
		manualDataForm.insertAdjacentHTML("beforeend", `
			<section id="derivedGeometryPanel" class="manual-data-section derived-geometry-panel" aria-label="Automatische Außengrenzen">
				<div class="manual-data-section-header">
					<h3>Geometrie</h3>
					<button id="derivedGeometryRefreshButton" class="secondary" type="button">Vorschau neu berechnen</button>
				</div>
				<label class="manual-data-checkbox">
					<input id="derivedGeometryEnabledInput" type="checkbox">
					<span>Außengrenzen darstellen</span>
				</label>
				<label class="manual-data-checkbox">
					<input id="derivedGeometryDescendantsInput" type="checkbox" disabled>
					<span>Für alle Unterregionen erzeugen <small>folgt im nächsten Schritt</small></span>
				</label>
				<div class="manual-data-grid">
					<div class="manual-data-field">
						<label for="derivedGeometryZoomFromInput">Außengrenze Zoom von</label>
						<input id="derivedGeometryZoomFromInput" type="number" min="0" max="6" step="1">
					</div>
					<div class="manual-data-field">
						<label for="derivedGeometryZoomToInput">Außengrenze Zoom bis</label>
						<input id="derivedGeometryZoomToInput" type="number" min="0" max="6" step="1">
					</div>
				</div>
				<div class="derived-geometry-preview-row">
					<div id="derivedGeometryThumbnail" class="derived-geometry-thumbnail"><span>Keine Vorschau</span></div>
					<p id="derivedGeometryStatus" class="note" role="status" aria-live="polite"></p>
				</div>
			</section>
		`);

		document.getElementById("derivedGeometryEnabledInput")?.addEventListener("change", () => {
			state.dirty = true;
			void syncPreview().catch(handlePreviewError);
		});
		document.getElementById("derivedGeometryRefreshButton")?.addEventListener("click", () => {
			state.dirty = true;
			void rebuildPreview().catch(handlePreviewError);
		});
		["derivedGeometryZoomFromInput", "derivedGeometryZoomToInput"].forEach((id) => {
			document.getElementById(id)?.addEventListener("input", () => { state.dirty = true; });
		});
	}

	function injectStyles() {
		if (document.getElementById("derivedGeometryIframeStyles")) return;
		const style = document.createElement("style");
		style.id = "derivedGeometryIframeStyles";
		style.textContent = `
			.derived-geometry-panel { margin-top: 12px; }
			.derived-geometry-preview-row { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 12px; align-items: center; }
			.derived-geometry-thumbnail { display: grid; place-items: center; min-height: 116px; border: 1px solid var(--border, #c8bda8); border-radius: 8px; background: rgba(255,255,255,0.55); color: #5b432b; font-size: 12px; }
			.derived-geometry-thumbnail svg { width: 180px; height: 110px; }
			@media (max-width: 720px) { .derived-geometry-preview-row { grid-template-columns: 1fr; } }
		`;
		document.head.append(style);
	}

	function getTargetKey(value = window.AvesmapsPoliticalTerritoryEditorForm?.readAssignmentValue?.()) {
		const root = window.AvesmapsPoliticalTerritoryEditorForm?.readRootSelection?.(value);
		return normalizeText(
			root?.territoryPublicId
			|| root?.wikiKey
			|| new URLSearchParams(window.location.search).get("territory_public_id")
			|| ""
		);
	}

	function setStatus(message = "", type = "") {
		const status = document.getElementById("derivedGeometryStatus");
		if (!status) return;
		status.textContent = message;
		status.dataset.status = type;
	}

	function handlePreviewError(error) {
		console.warn("Außengrenzen-Vorschau konnte nicht berechnet werden:", error);
		setThumbnail(null);
		drawParentPreview(null);
		setStatus(error.message || "Außengrenze konnte nicht berechnet werden.", "error");
	}

	async function loadForCurrentTerritory(value = null) {
		ensurePanel();
		const targetKey = getTargetKey(value || undefined);
		state = { targetKey, territoryPublicId: "", geometry: null, labelCenter: null, existingPublicId: "", dirty: false };
		if (!targetKey) {
			document.getElementById("derivedGeometryEnabledInput").checked = false;
			setThumbnail(null);
			setStatus("Kein Breadcrumb-Territorium ausgewählt.", "info");
			return;
		}
		document.getElementById("derivedGeometryZoomFromInput").value = document.getElementById("zoomFromInput")?.value || "";
		document.getElementById("derivedGeometryZoomToInput").value = document.getElementById("zoomToInput")?.value || "";
		setStatus("Bestehende Außengrenze wird geprüft...", "pending");
		try {
			const response = await fetchDerivedGeometry(targetKey);
			const derived = response?.derived_geometry || null;
			state.territoryPublicId = response?.territory_public_id || "";
			if (!derived) {
				document.getElementById("derivedGeometryEnabledInput").checked = false;
				setThumbnail(null);
				setStatus(response?.territory_public_id ? "Keine gespeicherte Außengrenze." : "Noch keine gespeicherte Außengrenze; Ziel wird beim Speichern angelegt.", "info");
				return;
			}
			document.getElementById("derivedGeometryEnabledInput").checked = true;
			document.getElementById("derivedGeometryZoomFromInput").value = derived.min_zoom ?? "";
			document.getElementById("derivedGeometryZoomToInput").value = derived.max_zoom ?? "";
			state.existingPublicId = derived.public_id || "";
			state.geometry = derived.geometry || null;
			state.labelCenter = readLabelCenter(derived.geometry || null, derived);
			setThumbnail(state.geometry);
			drawParentPreview(state.geometry);
			setStatus("Gespeicherte Außengrenze geladen.", "success");
		} catch (error) {
			console.warn("Außengrenze konnte nicht geladen werden:", error);
			setStatus(error.message || "Außengrenze konnte nicht geladen werden.", "error");
		}
	}

	async function syncPreview() {
		if (!document.getElementById("derivedGeometryEnabledInput")?.checked) {
			state.geometry = null;
			state.labelCenter = null;
			setThumbnail(null);
			drawParentPreview(null);
			setStatus("Außengrenze wird beim Speichern deaktiviert.", "info");
			return null;
		}
		return rebuildPreview();
	}

	async function rebuildPreview() {
		const targetKey = getTargetKey();
		if (!targetKey) throw new Error("Kein Breadcrumb-Territorium ausgewählt.");
		if (!window.polygonClipping?.union) throw new Error("Polygon-Clipping-Bibliothek ist nicht geladen.");
		setStatus("Außengrenze wird berechnet...", "pending");
		const response = await fetchDerivedGeometrySources(targetKey);
		const sources = Array.isArray(response?.source_geometries) ? response.source_geometries : [];
		const clippingInputs = sources.map((entry) => geometryToClippingMultiPolygon(entry.geometry)).filter((entry) => entry.length > 0);
		if (clippingInputs.length < 1) throw new Error("Keine Unterflächen für eine Außengrenze gefunden.");
		const unionGeometry = normalizeClippingMultiPolygon(window.polygonClipping.union(...clippingInputs));
		const geometry = clippingMultiPolygonToGeoJson(unionGeometry);
		state.targetKey = targetKey;
		state.territoryPublicId = response?.territory_public_id || "";
		state.geometry = geometry;
		state.labelCenter = readLabelCenter(geometry);
		state.dirty = true;
		setThumbnail(geometry);
		drawParentPreview(geometry);
		setStatus(`${sources.length} Unterflächen vereinigt.`, "success");
		return geometry;
	}

	function geometryToClippingMultiPolygon(geometry) {
		if (geometry?.type === "Polygon") return normalizeClippingMultiPolygon([geometry.coordinates]);
		if (geometry?.type === "MultiPolygon") return normalizeClippingMultiPolygon(geometry.coordinates);
		return [];
	}
	function normalizeClippingMultiPolygon(multiPolygon) {
		if (!Array.isArray(multiPolygon)) return [];
		return multiPolygon.filter((polygon) => Array.isArray(polygon) && Array.isArray(polygon[0]) && polygon[0].length >= 4);
	}
	function clippingMultiPolygonToGeoJson(multiPolygon) {
		if (!Array.isArray(multiPolygon) || multiPolygon.length < 1) throw new Error("Die Ergebnisgeometrie ist leer.");
		return multiPolygon.length === 1 ? { type: "Polygon", coordinates: multiPolygon[0] } : { type: "MultiPolygon", coordinates: multiPolygon };
	}
	function collectCoordinates(value, coordinates = []) {
		if (!Array.isArray(value)) return coordinates;
		if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
			coordinates.push([Number(value[0]), Number(value[1])]);
			return coordinates;
		}
		value.forEach((entry) => collectCoordinates(entry, coordinates));
		return coordinates;
	}
	function readBounds(geometry) {
		const coordinates = collectCoordinates(geometry?.coordinates || []);
		if (coordinates.length < 1) return null;
		return {
			minX: Math.min(...coordinates.map(([x]) => x)),
			maxX: Math.max(...coordinates.map(([x]) => x)),
			minY: Math.min(...coordinates.map(([, y]) => y)),
			maxY: Math.max(...coordinates.map(([, y]) => y)),
		};
	}
	function readLabelCenter(geometry, derived = {}) {
		const labelLng = Number(derived.label_lng);
		const labelLat = Number(derived.label_lat);
		if (Number.isFinite(labelLng) && Number.isFinite(labelLat)) return { lng: labelLng, lat: labelLat };
		const bounds = readBounds(geometry);
		return bounds ? { lng: (bounds.minX + bounds.maxX) / 2, lat: (bounds.minY + bounds.maxY) / 2 } : null;
	}
	function setThumbnail(geometry) {
		const container = document.getElementById("derivedGeometryThumbnail");
		if (!container) return;
		const bounds = readBounds(geometry);
		if (!bounds) { container.innerHTML = `<span>Keine Vorschau</span>`; return; }
		const width = 180, height = 110, padding = 8;
		const scale = Math.min((width - padding * 2) / Math.max(0.000001, bounds.maxX - bounds.minX), (height - padding * 2) / Math.max(0.000001, bounds.maxY - bounds.minY));
		const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
		const path = polygons.flatMap((polygon) => polygon.map((ring) => `${ring.map((coordinate, index) => {
			const x = padding + (Number(coordinate[0]) - bounds.minX) * scale;
			const y = height - padding - (Number(coordinate[1]) - bounds.minY) * scale;
			return `${index === 0 ? "M" : "L"}${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`;
		}).join(" ")} Z`)).join(" ");
		container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Abgeleitete Außengrenze"><path d="${path}" fill="rgba(201,169,104,.45)" stroke="currentColor" stroke-width="1.5"></path></svg>`;
	}
	function drawParentPreview(geometry) {
		try {
			if (typeof window.parent?.drawDerivedGeometryPreview === "function") {
				window.parent.drawDerivedGeometryPreview(geometry);
			}
		} catch (error) {
			console.warn("Karten-Vorschau konnte nicht aktualisiert werden:", error);
		}
	}
	async function saveIfNeeded(context = {}) {
		const enabled = document.getElementById("derivedGeometryEnabledInput")?.checked === true;
		const targetKey = getTargetKey(context.value);
		if (!targetKey) return null;
		if (!enabled) {
			if (!state.dirty && !state.existingPublicId) return null;
			return submitDerivedGeometry({ action: "delete_derived_geometry", target_key: targetKey });
		}
		const geometry = state.geometry || await rebuildPreview();
		const labelCenter = state.labelCenter || readLabelCenter(geometry);
		return submitDerivedGeometry({
			action: "save_derived_geometry",
			target_key: targetKey,
			geometry_geojson: geometry,
			label_lng: labelCenter?.lng ?? null,
			label_lat: labelCenter?.lat ?? null,
			min_zoom: normalizeText(document.getElementById("derivedGeometryZoomFromInput")?.value || ""),
			max_zoom: normalizeText(document.getElementById("derivedGeometryZoomToInput")?.value || ""),
			is_active: true,
		});
	}

	function install() {
		ensurePanel();
		injectStyles();
		window.AvesmapsPoliticalTerritoryEditorSave?.registerAfterSaveHook?.(async (context) => {
			await saveIfNeeded(context);
			return context.result;
		});
		void loadForCurrentTerritory();
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
	else install();

	window.AvesmapsPoliticalDerivedGeometryEditor = { loadForCurrentTerritory, rebuildPreview, saveIfNeeded, getTargetKey };
})();
