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
	// 🔴 DER REGLER STEUERT DIE PUNKTZAHL, NICHT DIE TOLERANZ (Owner 2026-07-28, zweite Fassung).
	//
	// Erst bildete er linear auf eine Douglas-Peucker-Toleranz ab, und das ist der Fehler, den man dabei
	// macht: die Antwort der Toleranz auf die Punktzahl ist steil und formabhängig. Mit einem hohen
	// Deckel erledigte das erste Zwanzigstel des Weges alles, mit einem niedrigen kam der Regler nie
	// unter ein paar Dutzend Punkte -- und genau das hat der Owner gemeldet („das Minimum weiter
	// verringern, min. 6 oder so"). Es gab kein Deckel-Paar, das beides konnte.
	//
	// Jetzt sagt der Regler, WIE VIELE Punkte übrig bleiben sollen -- linear von „alle" bis
	// SIMPLIFY_FLOOR_POINTS -- und die passende Toleranz wird gesucht (Bisektion; Douglas-Peucker ist in
	// der Toleranz monoton, also findet sie sicher). Damit ist jeder Millimeter des Reglers gleich viel
	// wert, unabhängig davon, wie die Fläche aussieht.
	const SIMPLIFY_FLOOR_POINTS = 6;
	// 🪤 Ein Ring MUSS drei Ecken behalten. Douglas-Peucker darf einen schmalen Zipfel auf zwei Punkte
	// eindampfen; das wäre kein Polygon mehr, und `update_area_geometry` nähme es an.
	const SIMPLIFY_MIN_RING_POINTS = 3;
	// Die Suche braucht eine Obergrenze, an der sie sicher unter dem Ziel liegt. Die Karte ist 1024
	// Einheiten breit -- mehr als das kann keine Toleranz je brauchen.
	const SIMPLIFY_SEARCH_MAX = 1024;

	let simplifyAreaPublicId = "";
	let simplifyBaseGeometry = null;
	let simplifyPreviewLayer = null;
	let simplifyBusy = false;
	let simplifyHiddenLayer = null;   // die ausgeblendete Originalfläche, solange der Dialog offen ist
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

	// Ein Ring auf (höchstens) `targetCount` Ecken. Der Schlusspunkt wiederholt den ersten (GeoJSON) und
	// wird vor der Rechnung abgeschnitten -- Douglas-Peucker würde ihn sonst als eigenen Punkt behandeln
	// und könnte den Ringschluss verschieben.
	//
	// Gesucht wird die KLEINSTE Toleranz, die das Ziel erreicht: so bleibt von der Form so viel stehen,
	// wie bei dieser Punktzahl überhaupt möglich ist.
	function simplifyRingToCount(ring, targetCount) {
		const open = (ring || []).slice(0, -1);
		const target = Math.max(SIMPLIFY_MIN_RING_POINTS, Math.round(targetCount));
		if (open.length <= target) {
			return ring;                             // schon feiner als gewünscht -- nichts zu tun
		}

		const points = open.map(([x, y]) => L.point(x, y));
		let low = 0;
		let high = 0.01;
		while (high < SIMPLIFY_SEARCH_MAX && L.LineUtil.simplify(points, high).length > target) {
			high *= 2;
		}
		let best = L.LineUtil.simplify(points, high);
		for (let step = 0; step < 24; step += 1) {
			const middle = (low + high) / 2;
			const candidate = L.LineUtil.simplify(points, middle);
			if (candidate.length > target) {
				low = middle;
			} else {
				best = candidate;
				high = middle;
			}
		}
		// Unter drei Ecken lieber gar nicht anfassen als eine kaputte Form abliefern.
		if (!best || best.length < SIMPLIFY_MIN_RING_POINTS) {
			return ring;
		}
		const out = best.map((point) => [point.x, point.y]);
		out.push(out[0].slice());

		return out;
	}

	// Das Ziel je Ring: linear vom Ist-Stand zum Boden. Je RING, nicht für die ganze Fläche -- sonst
	// bekäme ein winziges Loch dasselbe Budget wie der Aussenumriss und verschwände als Erstes.
	function targetPointsForRing(ringLength, strength)  {
		const open = Math.max(0, ringLength - 1);
		const fraction = Math.max(0, Math.min(100, Number(strength) || 0)) / 100;

		return Math.max(SIMPLIFY_MIN_RING_POINTS, Math.round(open + (SIMPLIFY_FLOOR_POINTS - open) * fraction));
	}

	function simplifyGeometry(geometry, strength) {
		if (!geometry || !(Number(strength) > 0)) {
			return geometry;
		}
		const isMulti = geometry.type === "MultiPolygon";
		const polygons = isMulti ? geometry.coordinates : [geometry.coordinates];
		const next = polygons.map((polygon) => (polygon || []).map(
			(ring) => simplifyRingToCount(ring, targetPointsForRing((ring || []).length, strength))
		));

		return isMulti
			? { type: "MultiPolygon", coordinates: next }
			: { type: "Polygon", coordinates: next[0] };
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
		const strength = Number(element("strength")?.value) || 0;
		const result = simplifyGeometry(simplifyBaseGeometry, strength);
		const vorher = countGeometryPoints(simplifyBaseGeometry);
		const nachher = countGeometryPoints(result);

		const readout = element("count");
		if (readout) {
			readout.textContent = strength > 0
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

	// 🔴 Solange der Dialog offen ist, ist die ALTE Fläche weg (Owner 2026-07-28). Sonst liegen zwei
	// Umrisse übereinander -- der alte und die Vorschau -- und man sieht gerade das nicht, worum es geht:
	// wo der Regler Form wegnimmt. Ausgeblendet, nicht entfernt: die Registry und eine offene Auswahl
	// bleiben unberührt, und beim Abbrechen ist alles wieder da, wie es war.
	// 💣 Über eine KLASSE, nicht über setStyle. `ecosystemAreaStyle` kennt nur Farbe und Strichstärke --
	// Deckkraft und Füllung stehen im CSS der Pane. Ein `setStyle({opacity: 0})` liesse sich damit nicht
	// zurücknehmen: das Wiederherstellen hätte die Null einfach stehen lassen (genau so gemessen).
	// Dieselbe Bauart wie applyEcosystemSelectionClass: Zustand als Klasse am <path>, Werte im CSS.
	function setOriginalAreaHidden(publicId, hidden) {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(String(publicId || ""))
			: null;
		const element = typeof layer?.getElement === "function" ? layer.getElement() : null;
		if (!element) {
			return;
		}
		element.classList.toggle("ecosystem-area--simplify-hidden", Boolean(hidden));
		simplifyHiddenLayer = hidden ? layer : null;
	}

	function handleSimplifyKeydown(event) {
		const overlay = document.getElementById(OVERLAY_ELEMENT_ID);
		if (event.key !== "Escape" || !overlay || overlay.hidden) {
			return;
		}
		event.stopPropagation();
		closeSimplifyDialog();                       // Abbrechen: alles bleibt, wie es war
	}

	// ---- Fenster --------------------------------------------------------------------------------------

	function closeSimplifyDialog() {
		const overlay = document.getElementById(OVERLAY_ELEMENT_ID);
		if (overlay) {
			overlay.hidden = true;
		}
		clearSimplifyPreview();
		setOriginalAreaHidden(simplifyAreaPublicId, false);
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
		const strength = Number(element("strength")?.value) || 0;
		if (!(strength > 0)) {
			closeSimplifyDialog();
			return;
		}

		simplifyBusy = true;
		setSimplifyError("");
		try {
			const result = simplifyGeometry(simplifyBaseGeometry, strength);
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
		document.addEventListener("keydown", handleSimplifyKeydown, true);
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
		setOriginalAreaHidden(simplifyAreaPublicId, true);
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
	};
})();
