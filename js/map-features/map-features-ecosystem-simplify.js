// Landschaften -- „Fläche vereinfachen" (Owner 2026-07-28).
//
// 🔴 WARUM ES DAS GIBT. Der Pinsel setzt Stempel entlang des Zuges, und was von jedem Stempel aussen
// liegt, bleibt nach der Vereinigung als Stützpunkt im Umriss -- für immer, in jeder Nutzlast, bei jedem
// Zeichnen. Die Zahl der Ecken je Stempel ist schon niedrig; es ist die MENGE der Stempel, die sich
// summiert. Ein Regler, der den Umriss nachträglich ausdünnt, ist die ehrlichere Antwort als ein
// automatisches Ausdünnen beim Malen: der Editor sieht, was er verliert, und entscheidet es selbst.
//
// 🔴 KEINE neue Bibliothek. Leaflet bringt Douglas-Peucker mit (`L.LineUtil.simplify`) -- dieselbe
// Vereinfachung, mit der es seine eigenen Polylinien zeichnet.
//
// 💣 Gerechnet wird in KARTENkoordinaten (0..1024), nicht in Bildschirmpunkten. Sonst hinge das
// Ergebnis am Zoom, unter dem der Dialog zufällig geöffnet wurde: derselbe Regler ergäbe herangezoomt
// eine feine und herausgezoomt eine grobe Fläche. Die Toleranz ist damit ein Mass in der Welt, nicht
// auf dem Schirm.

(() => {
	const OVERLAY_ELEMENT_ID = "ecosystem-simplify-overlay";
	// Der Regler ist linear 0..100 und wird auf diese Toleranz abgebildet.
	//
	// 🔴 Der Deckel ist GEMESSEN, nicht geschätzt. An einer dichten Pinselform (400 Punkte) drückte eine
	// Toleranz von 1,0 auf 17 Punkte -- aber schon 0,05 brachte 88 und 0,1 brachte 50. Der ganze nützliche
	// Bereich lag damit in den ersten fünf Prozent des Reglers, der Rest war totes Ende. Mit 0,12 verteilt
	// sich dieselbe Spanne über den ganzen Weg, und der Regler tut auf jedem Stück etwas.
	//
	// Die Karte ist 1024 Einheiten breit, eine Landschaft misst Dutzende: 0,12 ist eine Toleranz, die
	// Wellen glättet und Buchten stehen lässt. Die Flächenabweichung blieb über die ganze Spanne unter
	// einem Prozent.
	const SIMPLIFY_MAX_TOLERANCE = 0.12;
	// 🪤 Ein Ring MUSS drei Ecken behalten. Douglas-Peucker darf einen schmalen Zipfel auf zwei Punkte
	// eindampfen; das wäre kein Polygon mehr, und `update_area_geometry` nähme es an.
	const SIMPLIFY_MIN_RING_POINTS = 3;

	let simplifyAreaPublicId = "";
	let simplifyBaseGeometry = null;
	let simplifyPreviewLayer = null;
	let simplifyBusy = false;
	let simplifyBound = false;

	function element(suffix) {
		return document.getElementById(`ecosystem-simplify-${suffix}`);
	}

	function say(message, tone = "info") {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(message, tone);
		}
	}

	function areaByPublicId(publicId) {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(String(publicId || ""))
			: null;

		return layer?._ecosystemArea || null;
	}

	// ---- die Rechnung ---------------------------------------------------------------------------------

	function countGeometryPoints(geometry) {
		const polygons = geometry?.type === "MultiPolygon" ? geometry.coordinates : [geometry?.coordinates || []];

		return polygons.reduce(
			(sum, polygon) => sum + (polygon || []).reduce((inner, ring) => inner + Math.max(0, (ring || []).length - 1), 0),
			0
		);
	}

	// Ein Ring, ausgedünnt. Der Schlusspunkt wiederholt den ersten (GeoJSON) und wird vor der Rechnung
	// abgeschnitten -- Douglas-Peucker würde ihn sonst als eigenen Punkt behandeln und könnte den
	// Ringschluss verschieben.
	function simplifyRing(ring, tolerance) {
		const open = (ring || []).slice(0, -1);
		if (open.length <= SIMPLIFY_MIN_RING_POINTS) {
			return ring;
		}
		const points = open.map(([x, y]) => L.point(x, y));
		let simplified = L.LineUtil.simplify(points, tolerance);
		// Zu weit gegangen: dann lieber diesen Ring unangetastet lassen als eine kaputte Form abliefern.
		if (simplified.length < SIMPLIFY_MIN_RING_POINTS) {
			return ring;
		}
		const out = simplified.map((point) => [point.x, point.y]);
		out.push(out[0].slice());

		return out;
	}

	function simplifyGeometry(geometry, tolerance) {
		if (!geometry || !(tolerance > 0)) {
			return geometry;
		}
		const isMulti = geometry.type === "MultiPolygon";
		const polygons = isMulti ? geometry.coordinates : [geometry.coordinates];
		const next = polygons.map((polygon) => (polygon || []).map((ring) => simplifyRing(ring, tolerance)));

		return isMulti
			? { type: "MultiPolygon", coordinates: next }
			: { type: "Polygon", coordinates: next[0] };
	}

	function toleranceFromSlider(value) {
		const strength = Math.max(0, Math.min(100, Number(value) || 0));

		return (strength / 100) * SIMPLIFY_MAX_TOLERANCE;
	}

	// ---- Vorschau -------------------------------------------------------------------------------------

	function clearSimplifyPreview() {
		if (simplifyPreviewLayer && map.hasLayer(simplifyPreviewLayer)) {
			map.removeLayer(simplifyPreviewLayer);
		}
		simplifyPreviewLayer = null;
	}

	function geometryToLatLngs(geometry) {
		const polygons = geometry?.type === "MultiPolygon" ? geometry.coordinates : [geometry?.coordinates || []];

		return polygons.map((polygon) => (polygon || []).map((ring) => (ring || []).map(([x, y]) => [y, x])));
	}

	// Der Regler zeigt sein Ergebnis SOFORT auf der Karte -- eine Zahl allein sagt niemandem, ob die Bucht
	// noch da ist, die er behalten wollte.
	function renderSimplifyPreview() {
		clearSimplifyPreview();
		const tolerance = toleranceFromSlider(element("strength")?.value);
		const result = simplifyGeometry(simplifyBaseGeometry, tolerance);
		const vorher = countGeometryPoints(simplifyBaseGeometry);
		const nachher = countGeometryPoints(result);

		const readout = element("count");
		if (readout) {
			readout.textContent = tolerance > 0
				? `${vorher} → ${nachher} Punkte (${Math.max(0, vorher - nachher)} weniger)`
				: `${vorher} Punkte — der Regler steht auf 0, es ändert sich nichts.`;
		}
		simplifyPreviewLayer = L.polygon(geometryToLatLngs(result), {
			pane: "measurementPane",
			color: getComputedStyle(document.documentElement).getPropertyValue("--color-marker-active").trim(),
			weight: 2,
			opacity: 0.95,
			fillOpacity: 0.2,
			interactive: false,
		}).addTo(map);

		return result;
	}

	// ---- Fenster --------------------------------------------------------------------------------------

	function closeSimplifyDialog() {
		const overlay = document.getElementById(OVERLAY_ELEMENT_ID);
		if (overlay) {
			overlay.hidden = true;
		}
		clearSimplifyPreview();
		simplifyAreaPublicId = "";
		simplifyBaseGeometry = null;
	}

	function setSimplifyError(message) {
		const errorElement = element("error");
		if (!errorElement) {
			return;
		}
		errorElement.textContent = String(message || "");
		errorElement.hidden = !message;
	}

	async function submitSimplify(event) {
		event?.preventDefault();
		if (simplifyBusy) {
			return;
		}
		const area = areaByPublicId(simplifyAreaPublicId);
		if (!area) {
			setSimplifyError("Die Fläche ist nicht mehr geladen.");
			return;
		}
		const tolerance = toleranceFromSlider(element("strength")?.value);
		if (!(tolerance > 0)) {
			closeSimplifyDialog();
			return;
		}

		simplifyBusy = true;
		setSimplifyError("");
		try {
			const result = simplifyGeometry(simplifyBaseGeometry, tolerance);
			await postEcosystemEdit("update_area_geometry", {
				public_id: String(area.public_id),
				expected_revision: Number(area.geometry_revision),
				geometry_geojson: result,
			});
			const vorher = countGeometryPoints(simplifyBaseGeometry);
			const nachher = countGeometryPoints(result);
			closeSimplifyDialog();
			if (typeof loadEcosystemAreas === "function") {
				await loadEcosystemAreas();
			}
			if (typeof invalidateEcosystemRegionCache === "function") {
				invalidateEcosystemRegionCache();
			}
			say(`Vereinfacht: ${vorher} → ${nachher} Punkte.`, "success");
		} catch (error) {
			setSimplifyError(error?.message || "Die Fläche konnte nicht vereinfacht werden.");
		} finally {
			simplifyBusy = false;
		}
	}

	function bindSimplifyDialog() {
		if (simplifyBound) {
			return;
		}
		element("strength")?.addEventListener("input", renderSimplifyPreview);
		element("form")?.addEventListener("submit", submitSimplify);
		element("cancel")?.addEventListener("click", () => closeSimplifyDialog());
		element("close")?.addEventListener("click", () => closeSimplifyDialog());
		simplifyBound = true;
	}

	function openSimplifyDialog(publicId) {
		const area = areaByPublicId(publicId);
		const geometry = area?.geometry_geojson || area?.geometry || null;
		if (!area || !geometry) {
			say("Die Fläche ist nicht mehr geladen.", "warning");
			return;
		}
		const overlay = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlay) {
			return;
		}

		bindSimplifyDialog();
		simplifyAreaPublicId = String(publicId || "");
		simplifyBaseGeometry = geometry;
		setSimplifyError("");
		const slider = element("strength");
		if (slider) {
			slider.value = "0";                      // jedes Mal bei null anfangen, nie beim letzten Wert
		}
		overlay.hidden = false;
		renderSimplifyPreview();
		element("strength")?.focus();
	}

	function registerSimplifyEntry() {
		const menu = window.AvesmapsEcosystemAreaMenu;
		if (!menu?.addEntry) {
			return;
		}
		menu.addEntry({
			action: "simplify",
			label: typeof tr === "function" ? tr("ecosystem.ctxmenu.simplify", "Fläche vereinfachen") : "Fläche vereinfachen",
			onClick: (publicId) => openSimplifyDialog(publicId),
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", registerSimplifyEntry);
	} else {
		registerSimplifyEntry();
	}

	window.AvesmapsEcosystemSimplify = {
		open: openSimplifyDialog,
		close: closeSimplifyDialog,
		// Für die Prüfung: die reine Rechnung, ohne Fenster und ohne Karte.
		simplifyGeometry,
		countGeometryPoints,
		toleranceFromSlider,
	};
})();
