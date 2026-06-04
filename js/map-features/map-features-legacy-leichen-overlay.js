/*
 * Editor-Diagnose: zeigt die Konturen der "Datenleichen" an – die alten Legacy-Regionen aus
 * map_features (feature_type='region'), die NICHT aus dem political_territory-System (thomas/valentin)
 * stammen. Rein lesend, nur im Edit-Modus. Ein-/ausschaltbar ueber einen kleinen Button oben rechts.
 *
 * Datenquelle: action=geometry_inventory&legacy_geometry=1 (hinter review-Capability).
 * Zeichnung: rote, gestrichelte Umrisse (keine Fuellung) + Namens-Label je Region.
 */
(function legacyLeichenOverlayModule() {
	if (typeof window === "undefined" || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	if (window.__avesmapsLegacyLeichenOverlayInstalled) {
		return;
	}
	window.__avesmapsLegacyLeichenOverlayInstalled = true;

	let layerGroup = null;
	let loading = false;
	let loadedOnce = false;
	let visible = false;

	function ensurePane() {
		if (typeof map === "undefined" || !map) {
			return null;
		}
		if (!map.getPane("legacyLeichenPane")) {
			const pane = map.createPane("legacyLeichenPane");
			pane.style.zIndex = 645; // ueber den Regionen, unter Markern/Labels
			pane.style.pointerEvents = "none";
		}
		return "legacyLeichenPane";
	}

	function legacyGeometryToLatLngs(geometry) {
		if (!geometry) {
			return [];
		}
		let polygons = [];
		if (geometry.type === "Polygon") {
			polygons = [geometry.coordinates];
		} else if (geometry.type === "MultiPolygon") {
			polygons = geometry.coordinates;
		}
		// Gleiche Konvention wie die Regions-Renderung: GeoJSON [x, y] -> Leaflet [y, x].
		return polygons.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x])));
	}

	function drawLegacyRegions(regions) {
		const pane = ensurePane();
		layerGroup = L.layerGroup();
		(Array.isArray(regions) ? regions : []).forEach((region) => {
			const latlngs = legacyGeometryToLatLngs(region.geometry);
			if (!latlngs.length) {
				return;
			}
			const name = String(region.name || "").replace(/<br\s*\/?\s*>/gi, " ").trim() || "(ohne Name)";
			latlngs.forEach((polyLatLngs) => {
				const polygon = L.polygon(polyLatLngs, {
					pane,
					interactive: false,
					color: "#e02424",
					weight: 2,
					opacity: 0.95,
					dashArray: "6 5",
					fill: false,
				});
				polygon.bindTooltip(`🪦 ${name}`, {
					permanent: true,
					direction: "center",
					className: "legacy-leiche-label",
					opacity: 1,
				});
				layerGroup.addLayer(polygon);
			});
		});
		layerGroup.addTo(map);
	}

	function clearOverlay() {
		if (layerGroup) {
			map.removeLayer(layerGroup);
			layerGroup = null;
		}
	}

	async function enable(button) {
		if (loading) {
			return;
		}
		visible = true;
		if (loadedOnce && layerGroup) {
			layerGroup.addTo(map);
			updateButton(button);
			return;
		}
		loading = true;
		updateButton(button);
		try {
			const url = `${POLITICAL_TERRITORIES_API_URL}?action=geometry_inventory&legacy_geometry=1&limit=2000`;
			const response = await fetch(url, { credentials: "same-origin" });
			const data = await response.json();
			if (!data || data.ok === false) {
				throw new Error((data && (data.error || data.message)) || "Antwort nicht ok");
			}
			clearOverlay();
			drawLegacyRegions(data.legacy_regions || []);
			loadedOnce = true;
		} catch (error) {
			visible = false;
			console.warn("Legacy-Leichen-Konturen konnten nicht geladen werden:", error);
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast("Legacy-Leichen-Konturen konnten nicht geladen werden (eingeloggt?).", "warning");
			}
		} finally {
			loading = false;
			updateButton(button);
		}
	}

	function disable(button) {
		visible = false;
		clearOverlay();
		updateButton(button);
	}

	function updateButton(button) {
		if (!button) {
			return;
		}
		const count = layerGroup ? "" : "";
		button.textContent = loading
			? "🪦 lädt …"
			: (visible ? "🪦 Leichen-Konturen: AN" : "🪦 Leichen-Konturen");
		button.classList.toggle("is-active", visible);
	}

	function installButton() {
		if (typeof map === "undefined" || !map || !POLITICAL_TERRITORIES_API_URL) {
			return;
		}
		if (document.getElementById("legacy-leichen-toggle")) {
			return;
		}
		const button = document.createElement("button");
		button.id = "legacy-leichen-toggle";
		button.type = "button";
		button.title = "Konturen der alten Legacy-Regionen (map_features) ein-/ausblenden – Datenleichen außerhalb des political_territory-Systems";
		Object.assign(button.style, {
			position: "fixed",
			top: "10px",
			right: "10px",
			zIndex: "1200",
			padding: "6px 10px",
			borderRadius: "7px",
			border: "1px solid #b23a3a",
			background: "rgba(255,255,255,0.94)",
			color: "#8c1d1d",
			font: "12px/1.2 system-ui, sans-serif",
			cursor: "pointer",
			boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
		});
		button.addEventListener("click", () => {
			if (visible) {
				disable(button);
			} else {
				void enable(button);
			}
		});
		document.body.appendChild(button);
		updateButton(button);
	}

	[0, 200, 800].forEach((delay) => window.setTimeout(installButton, delay));
	document.addEventListener("DOMContentLoaded", installButton, { once: true });
})();
