"use strict";

(function initDerivedGeometryIframeEditor() {
	const WRITE_API_URL = window.AvesmapsPoliticalTerritoryEditorApi?.writeApiUrl || "/api/app/political-territories.php?debug_errors=1";
	let state = createEmptyState();

	function createEmptyState(overrides = {}) {
		return {
			targetKey: "",
			resolvedTargetKey: "",
			territoryPublicId: "",
			geometry: null,
			labelCenter: null,
			existingPublicId: "",
			sourceGeometries: [],
			canShowInnerBoundaries: true,
			leafLocked: false,
			dirty: false,
			...overrides,
		};
	}

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
			throw new Error(apiErrorMessage(payload, `Herrschaftsgebiet-API antwortet mit HTTP ${response.status}.`));
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
		const manualDataColumns = document.querySelector(".manual-data-columns");
		const manualDataForm = document.querySelector(".manual-data-box");
		const targetContainer = manualDataColumns || manualDataForm;
		if (!targetContainer) return;

		const panelHtml = `
			<section id="derivedGeometryPanel" class="manual-data-section derived-geometry-panel" aria-label="Automatische Außengrenzen">
				<h3>Geometrie</h3>
				<label class="manual-data-checkbox">
					<input id="derivedGeometryEnabledInput" type="checkbox">
					<span>Außengrenzen darstellen</span>
				</label>
				<label class="manual-data-checkbox" id="derivedGeometryInnerBoundariesLabel">
					<input id="derivedGeometryInnerBoundariesInput" type="checkbox">
					<span>Innengrenzen darstellen</span>
				</label>
				<label class="manual-data-checkbox" id="derivedGeometryRecursiveLabel">
					<input id="derivedGeometryRecursiveInput" type="checkbox">
					<span>Für alle Unterregionen übernehmen</span>
				</label>
				<small class="derived-geometry-mode-note">Erzeugt die Außengrenze des oben ausgewählten Gebiets (inkl. automatischer Aktualisierung der Übergebiete). Mit aktivem Häkchen werden auch die Außengrenzen der Unterregionen neu berechnet.</small>
				<div id="derivedGeometryPreviewRow" class="derived-geometry-preview-row" hidden>
					<div id="derivedGeometryThumbnail" class="derived-geometry-thumbnail" aria-label="Vorschau der Außengrenze"></div>
					<p id="derivedGeometryStatus" class="note" role="status" aria-live="polite"></p>
				</div>
			</section>
		`;

		if (manualDataColumns) {
			// B: Geometrie-Panel ganz nach oben im Spalten-Panel.
			manualDataColumns.insertAdjacentHTML("afterbegin", panelHtml);
		} else {
			targetContainer.insertAdjacentHTML("beforeend", panelHtml);
		}

		// B: Thumbnail (Vorschau) direkt unter die Überschrift, ÜBER "Außengrenzen darstellen".
		(function moveThumbnailAboveControls() {
			const panel = document.getElementById("derivedGeometryPanel");
			const heading = panel?.querySelector("h3");
			const previewRow = document.getElementById("derivedGeometryPreviewRow");
			if (heading && previewRow) {
				heading.insertAdjacentElement("afterend", previewRow);
			}
		})();

		document.getElementById("derivedGeometryEnabledInput")?.addEventListener("change", () => {
			state.dirty = true;
			updateModeNote();
			void syncPreview().catch(handlePreviewError);
		});
		document.getElementById("derivedGeometryInnerBoundariesInput")?.addEventListener("change", () => {
			state.dirty = true;
			renderPreview();
		});
		document.getElementById("derivedGeometryRecursiveInput")?.addEventListener("change", () => { state.dirty = true; });
		setPreviewVisible(false);
		updateInnerBoundaryControl();

		// #4: Disable-Zustand auch bei reinem Breadcrumb-Wechsel (ohne Quellen-Reload/dedup)
		// aktualisieren, damit "letztes Element" zuverlässig erkannt wird.
		const breadcrumbForControl = document.getElementById("manualEditPath");
		if (breadcrumbForControl && breadcrumbForControl.dataset.derivedInnerControlObserver !== "1") {
			breadcrumbForControl.dataset.derivedInnerControlObserver = "1";
			new MutationObserver(() => updateInnerBoundaryControl()).observe(breadcrumbForControl, {
				attributes: true,
				attributeFilter: ["class"],
				childList: true,
				subtree: true
			});
		}
	}

	function injectStyles() {
		if (document.getElementById("derivedGeometryIframeStyles")) return;
		const style = document.createElement("style");
		style.id = "derivedGeometryIframeStyles";
		style.textContent = `
			.derived-geometry-panel { gap: 10px; }
			.derived-geometry-preview-row { display: grid; grid-template-columns: 1fr; gap: 8px; align-items: start; }
			.derived-geometry-thumbnail { display: grid; place-items: center; min-height: 116px; border: 1px solid var(--border, #c8bda8); border-radius: 8px; background: rgba(255,255,255,0.55); color: #5b432b; font-size: 12px; overflow: hidden; }
			.derived-geometry-thumbnail svg { width: 100%; max-width: 180px; height: 110px; }
			.derived-geometry-inner-boundaries-disabled,
			.derived-geometry-recursive-control { opacity: .5; cursor: not-allowed; }
			.derived-geometry-mode-note { display: block; color: var(--muted, #806c59); font-size: 11px; line-height: 1.35; }
		`;
		document.head.append(style);
	}

	function getTargetKey(value = window.AvesmapsPoliticalTerritoryEditorForm?.readAssignmentValue?.()) {
		// Den tatsaechlich aktiven (im Breadcrumb hervorgehobenen) Knoten bevorzugen: nach dem
		// Durchwechseln eines Breadcrumb-Geschwisters (cycleBreadcrumbSegment) liegt dieser Knoten
		// in einem ANDEREN Teilbaum als der zugewiesene Pfad. readRootSelection/readActiveNode sucht
		// den aktiven Knoten dann im (stalen) assignedPath, findet ihn nicht und fällt auf dessen
		// tiefsten Knoten zurück -> die Vorschau zeigte eine fremde Unterregion. activeDisplayNode
		// spiegelt dagegen zuverlaessig den editierten/hervorgehobenen Knoten.
		const active = value?.activeDisplayNode || null;
		const activeKey = normalizeText(
			active?.territoryPublicId
			|| active?.territory_public_id
			|| active?.wikiKey
			|| active?.wiki_key
			|| active?.key
			|| ""
		);
		if (activeKey) return activeKey;
		const root = window.AvesmapsPoliticalTerritoryEditorForm?.readRootSelection?.(value);
		return normalizeText(
			root?.territoryPublicId
			|| root?.wikiKey
			|| window.AvesmapsEditorContext?.param?.("territory_public_id", "")
			|| ""
		);
	}

	function readResolvedSaveTargetKey(fallbackTargetKey = "") {
		return normalizeText(state.territoryPublicId || state.resolvedTargetKey || fallbackTargetKey);
	}

	function setPreviewVisible(visible) {
		const previewRow = document.getElementById("derivedGeometryPreviewRow");
		if (previewRow) previewRow.hidden = !visible;
	}

	function setStatus(message = "", type = "") {
		const status = document.getElementById("derivedGeometryStatus");
		if (!status) return;
		status.textContent = message;
		status.dataset.status = type;
	}

	function updateInnerBoundaryCapability(sourceResponse = null) {
		if (!sourceResponse || typeof sourceResponse !== "object") {
			state.canShowInnerBoundaries = true;
			updateInnerBoundaryControl();
			return;
		}
		const descendantCount = Number(sourceResponse.descendant_territory_count);
		const sourceMode = String(sourceResponse.source_mode || "").trim();
		state.canShowInnerBoundaries = !(sourceMode === "target_territory" || sourceMode === "geometry_context_target_territory" || sourceMode === "geometry_fallback" || Number.isFinite(descendantCount) && descendantCount < 1);
		updateInnerBoundaryControl();
	}

	function isActiveNodeLastBreadcrumb() {
		const labels = document.querySelectorAll("#political-territory-editor-host .breadcrumb-segment .breadcrumb-label");
		if (!labels.length) return false;
		const active = document.querySelector("#political-territory-editor-host .breadcrumb-label.is-active");
		return Boolean(active) && active === labels[labels.length - 1];
	}

	function updateInnerBoundaryControl() {
		const input = document.getElementById("derivedGeometryInnerBoundariesInput");
		const label = document.getElementById("derivedGeometryInnerBoundariesLabel");
		if (!input) return;
		// #4: Im LETZTEN Breadcrumb-Element (oder einem Blatt ohne Unterflächen) sind "Innengrenzen
		// darstellen" + "Für alle Unterregionen übernehmen" wirkungslos -> beide deaktivieren.
		const disableControls = !state.canShowInnerBoundaries || isActiveNodeLastBreadcrumb();
		input.disabled = disableControls;
		if (disableControls) {
			input.checked = false;
		}
		label?.classList.toggle("derived-geometry-inner-boundaries-disabled", disableControls);
		const recursiveInput = document.getElementById("derivedGeometryRecursiveInput");
		const recursiveLabel = document.getElementById("derivedGeometryRecursiveLabel");
		if (recursiveInput) {
			recursiveInput.disabled = disableControls;
			if (disableControls) recursiveInput.checked = false;
			recursiveLabel?.classList.toggle("derived-geometry-recursive-control", disableControls);
		}
		updateModeNote();
	}

	// Erklärt im Info-Feld unter den Haekchen den konkreten Fall des aktiven Knotens.
	function updateModeNote() {
		const note = document.querySelector(".derived-geometry-mode-note");
		if (!note) return;
		const enabled = document.getElementById("derivedGeometryEnabledInput")?.checked === true;
		const sourceCount = Array.isArray(state.sourceGeometries) ? state.sourceGeometries.length : 0;
		if (!state.canShowInnerBoundaries) {
			note.textContent = "Blatt ohne Unterflächen: keine Innengrenzen und keine eigene abgeleitete Außengrenze – die Grenze ist die eigene Quellfläche.";
			return;
		}
		const parts = [];
		parts.push(sourceCount > 0 ? `Außengrenze = Vereinigung von ${sourceCount} Unterflächen.` : "Außengrenze = Vereinigung der Unterflächen.");
		parts.push("„Innengrenzen darstellen“ zeigt die Trennlinien dazwischen (aus = verschmolzene Fläche).");
		parts.push("„Für alle Unterregionen übernehmen“ berechnet zusätzlich die Außengrenzen der Untergebiete neu.");
		if (!enabled) {
			parts.push("Außengrenze ist derzeit aus – beim Speichern wird sie entfernt; die Optionen darüber wirken dann nicht.");
		}
		note.textContent = parts.join(" ");
	}

	function handlePreviewError(error) {
		console.warn("Außengrenzen-Vorschau konnte nicht berechnet werden:", error);
		if (!state.geometry) {
			setThumbnail(null);
			drawParentPreview(null);
		}
		setPreviewVisible(true);
		setStatus(error.message || "Außengrenze konnte nicht berechnet werden.", "error");
	}

	async function loadForCurrentTerritory(value = null) {
		ensurePanel();
		const targetKey = getTargetKey(value || undefined);
		state = createEmptyState({ targetKey });
		{ const e = document.getElementById("derivedGeometryEnabledInput"); if (e) e.disabled = false; } // Sperre vom vorherigen Knoten lösen
		document.getElementById("derivedGeometryInnerBoundariesInput").checked = false;
		updateInnerBoundaryControl();
		if (!targetKey) {
			document.getElementById("derivedGeometryEnabledInput").checked = false;
			setPreviewVisible(false);
			setThumbnail(null);
			setStatus("", "");
			return;
		}

		void loadSourceGeometriesForPreview(targetKey);
		try {
			const response = await fetchDerivedGeometry(targetKey);
			const derived = response?.derived_geometry || null;
			state.territoryPublicId = response?.territory_public_id || "";
			state.resolvedTargetKey = response?.territory_public_id || response?.target_key || "";
			if (!derived) {
				document.getElementById("derivedGeometryEnabledInput").checked = false;
				// #C: Vorschau NICHT verstecken – die Quellflächen-Füllung (loadSourceGeometriesForPreview)
				// zeigt weiterhin die Geometrie des Knotens; nur die Außenkontur fehlt.
				setStatus("", "");
				return;
			}
			document.getElementById("derivedGeometryEnabledInput").checked = true;
			document.getElementById("derivedGeometryInnerBoundariesInput").checked = derived.show_inner_boundaries !== false;
			updateInnerBoundaryControl();
			state.existingPublicId = derived.public_id || "";
			state.geometry = derived.geometry || null;
			state.labelCenter = readLabelCenter(derived.geometry || null, derived);
			state.dirty = false;
			setPreviewVisible(true);
			renderPreview();
			setStatus("Gespeicherte Außengrenze geladen.", "success");
		} catch (error) {
			console.warn("Außengrenze konnte nicht geladen werden:", error);
			setPreviewVisible(true);
			setStatus(error.message || "Außengrenze konnte nicht geladen werden.", "error");
		}
		// Blatt-Ebene (Nicht-Root mit eigenem Polygon, geteilte Plan-Regel) darf keine eigene Außengrenze
		// haben -> "Außengrenzen darstellen" sperren + eine ggf. noch gespeicherte (redundante) entfernen.
		try {
			const lock = await Promise.resolve(window.AvesmapsDerivedBoundaryEditor?.isOwnBoundaryForbiddenForTerritory?.(targetKey));
			if (lock && state.targetKey === targetKey) {
				state.leafLocked = lock.forbidden === true;
				const enabledInput = document.getElementById("derivedGeometryEnabledInput");
				if (enabledInput) { if (state.leafLocked) enabledInput.checked = false; enabledInput.disabled = !!state.leafLocked; }
				updateInnerBoundaryControl();
				if (state.leafLocked && lock.hasActiveBoundary) {
					await submitDerivedGeometry({ action: "delete_derived_geometry", target_key: readResolvedSaveTargetKey(targetKey) }).catch(() => {});
					const host = window.AvesmapsEditorContext?.host?.() || window.parent;
					host?.schedulePoliticalTerritoryLayerReload?.({ immediate: true });
				}
			}
		} catch (lockError) { /* Sperre ist best-effort */ }
	}

	async function loadSourceGeometriesForPreview(targetKey) {
		try {
			const response = await fetchDerivedGeometrySources(targetKey);
			state.sourceGeometries = Array.isArray(response?.source_geometries) ? response.source_geometries : [];
			state.territoryPublicId = response?.territory_public_id || state.territoryPublicId || "";
			state.resolvedTargetKey = response?.territory_public_id || response?.target_key || state.resolvedTargetKey || "";
			updateInnerBoundaryCapability(response);
			// #C: Geometrie-Vorschau immer zeigen, sobald der Knoten Quellflächen hat (unabhängig von Außengrenze).
			if (state.sourceGeometries.length > 0) setPreviewVisible(true);
			renderPreview();
		} catch (error) {
			console.warn("Quellgeometrien für die Vorschau konnten nicht geladen werden:", error);
		}
	}

	async function syncPreview() {
		if (!document.getElementById("derivedGeometryEnabledInput")?.checked) {
			// #C: "Außengrenzen darstellen" aus -> nur die Außenkontur entfällt; die Geometrie-Füllung
			// (Quellflächen) bleibt sichtbar.
			state.geometry = null;
			state.labelCenter = null;
			setThumbnail(null, state.sourceGeometries);
			drawParentPreview(null);
			setStatus("", "");
			setPreviewVisible(state.sourceGeometries.length > 0);
			return null;
		}
		setPreviewVisible(true);
		return rebuildPreview();
	}

	async function rebuildPreview() {
		const targetKey = getTargetKey();
		if (!targetKey) throw new Error("Kein Breadcrumb-Territorium ausgewählt.");
		if (!window.polygonClipping?.union) throw new Error("Polygon-Clipping-Bibliothek ist nicht geladen.");
		setStatus("Außengrenze wird berechnet...", "pending");
		const response = await fetchDerivedGeometrySources(targetKey);
		const sources = Array.isArray(response?.source_geometries) ? response.source_geometries : [];
		updateInnerBoundaryCapability(response);
		const clippingInputs = sources.map((entry) => geometryToClippingMultiPolygon(entry.geometry)).filter((entry) => entry.length > 0);
		if (clippingInputs.length < 1) throw new Error("Keine Unterflächen für eine Außengrenze gefunden.");
		const unionGeometry = normalizeClippingMultiPolygon(window.polygonClipping.union(...clippingInputs));
		const geometry = clippingMultiPolygonToGeoJson(unionGeometry);
		state.targetKey = targetKey;
		state.territoryPublicId = response?.territory_public_id || state.territoryPublicId || "";
		state.resolvedTargetKey = response?.territory_public_id || response?.target_key || state.resolvedTargetKey || targetKey;
		state.geometry = geometry;
		state.labelCenter = readLabelCenter(geometry);
		state.sourceGeometries = sources;
		state.dirty = true;
		renderPreview();
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

	function renderPreview() {
		setThumbnail(state.geometry, state.sourceGeometries);
		drawParentPreview(state.geometry);
	}

	function geometryToPolygons(geometry) {
		if (geometry?.type === "Polygon") return [geometry.coordinates];
		if (geometry?.type === "MultiPolygon") return geometry.coordinates;
		return [];
	}

	function pathForRing(ring, bounds, scale, padding, height) {
		return `${ring.map((coordinate, index) => {
			const x = padding + (Number(coordinate[0]) - bounds.minX) * scale;
			const y = height - padding - (Number(coordinate[1]) - bounds.minY) * scale;
			return `${index === 0 ? "M" : "L"}${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`;
		}).join(" ")} Z`;
	}

	function normalizeSourceColor(entry) {
		const color = String(entry?.color || entry?.fill || entry?.stroke || "").trim();
		return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color) ? color : "#5b432b";
	}

	function readBoundsOfGeometries(geometries) {
		let bounds = null;
		for (const geometry of geometries) {
			const next = readBounds(geometry);
			if (!next) continue;
			bounds = bounds
				? { minX: Math.min(bounds.minX, next.minX), maxX: Math.max(bounds.maxX, next.maxX), minY: Math.min(bounds.minY, next.minY), maxY: Math.max(bounds.maxY, next.maxY) }
				: next;
		}
		return bounds;
	}

	function setThumbnail(geometry, sourceGeometries = []) {
		const container = document.getElementById("derivedGeometryThumbnail");
		if (!container) return;
		const sources = Array.isArray(sourceGeometries) ? sourceGeometries : [];
		// #C: Das Thumbnail zeigt IMMER die (mit der Farbe gefüllte) Geometrie des Knotens, sofern
		// vorhanden. "Außengrenzen darstellen"/"Innengrenzen darstellen" ändern nur die KONTUR.
		const fillSources = sources.length > 0 ? sources : (geometry ? [{ geometry, color: "#5b432b" }] : []);
		const boundsGeometries = fillSources.map((source) => source.geometry);
		if (geometry) boundsGeometries.push(geometry);
		const bounds = readBoundsOfGeometries(boundsGeometries);
		if (!bounds) { container.innerHTML = `<span>Keine Geometrie zugewiesen</span>`; return; }
		const width = 180, height = 110, padding = 8;
		const scale = Math.min((width - padding * 2) / Math.max(0.000001, bounds.maxX - bounds.minX), (height - padding * 2) / Math.max(0.000001, bounds.maxY - bounds.minY));
		const fillPaths = fillSources.flatMap((source) => geometryToPolygons(source.geometry).flatMap((polygon) => polygon.map((ring) => ({ path: pathForRing(ring, bounds, scale, padding, height), color: normalizeSourceColor(source) }))));
		const outerEnabled = document.getElementById("derivedGeometryEnabledInput")?.checked === true;
		const outerPath = (outerEnabled && geometry) ? geometryToPolygons(geometry).flatMap((polygon) => polygon.map((ring) => pathForRing(ring, bounds, scale, padding, height))).join(" ") : "";
		const showInnerBoundaries = state.canShowInnerBoundaries && document.getElementById("derivedGeometryInnerBoundariesInput")?.checked === true;
		const innerPaths = showInnerBoundaries
			? sources.flatMap((source) => geometryToPolygons(source.geometry).flatMap((polygon) => polygon.map((ring) => pathForRing(ring, bounds, scale, padding, height))))
			: [];
		container.innerHTML = `
			<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Geometrie-Vorschau">
				${fillPaths.map((entry) => `<path d="${entry.path}" fill="${entry.color}" fill-opacity="0.5" stroke="none"></path>`).join("")}
				${outerPath ? `<path d="${outerPath}" fill="none" stroke="currentColor" stroke-width="2"></path>` : ""}
				${innerPaths.map((path) => `<path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1" stroke-dasharray="3 2"></path>`).join("")}
			</svg>
		`;
	}
	function drawParentPreview(geometry) {
		try {
			const host = window.AvesmapsEditorContext?.host?.() || window.parent;
			if (typeof host?.drawDerivedGeometryPreview === "function") {
				host.drawDerivedGeometryPreview(geometry);
			}
		} catch (error) {
			console.warn("Karten-Vorschau konnte nicht aktualisiert werden:", error);
		}
	}
	async function saveIfNeeded(context = {}) {
		// Schutz gegen den Teufelskreis: nur eingreifen, wenn der Nutzer den
		// Außengrenzen-Bereich in DIESER Editor-Sitzung bewusst geändert hat.
		// Sonst würde ein normales Speichern (z. B. nur Farbe/Name) die bestehende
		// Außengrenze versehentlich per delete_derived_geometry deaktivieren, weil
		// das Häkchen beim Öffnen über einen Blattknoten faelschlich aus war.
		if (!state.dirty) return null;
		const enabled = document.getElementById("derivedGeometryEnabledInput")?.checked === true;
		const targetKey = getTargetKey(context.value);
		if (!targetKey) return null;
		if (!enabled) {
			state.dirty = false; return submitDerivedGeometry({ action: "delete_derived_geometry", target_key: readResolvedSaveTargetKey(targetKey) });
		}
		// Außengrenze erzeugen/aktualisieren läuft IMMER über die geteilte Kaskaden-Engine
		// (Modul B, AvesmapsDerivedBoundaryEditor) — gleiches Verhalten wie der Rechtsklick:
		// Ziel + Ancestors, mit Häkchen auch Unterregionen, Blatt-Skip, Inner-Flag.
		const saveTargetKey = readResolvedSaveTargetKey(targetKey);
		const cascadeEngine = window.AvesmapsDerivedBoundaryEditor;
		if (!cascadeEngine || typeof cascadeEngine.generateOrUpdateForTerritory !== "function") {
			throw new Error("Außengrenzen-Kaskade ist nicht verfügbar (AvesmapsDerivedBoundaryEditor nicht geladen).");
		}
		state.dirty = false;
		return cascadeEngine.generateOrUpdateForTerritory(saveTargetKey, {
			applyToSubregions: document.getElementById("derivedGeometryRecursiveInput")?.checked === true,
			drawPreview: false,
			showInnerBoundaries: state.canShowInnerBoundaries && document.getElementById("derivedGeometryInnerBoundariesInput")?.checked === true,
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
