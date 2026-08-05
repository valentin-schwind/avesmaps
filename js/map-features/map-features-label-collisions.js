function scheduleLabelCollisionResolution() {
	if (labelCollisionFrameId !== null) {
		return;
	}

	labelCollisionFrameId = window.requestAnimationFrame(() => {
		labelCollisionFrameId = null;
		// Den Versatz des Kartencontainers ZUERST lesen -- danach schreiben die Paesse, und ein
		// getBoundingClientRect nach dem Schreiben erzwaenge einen zusaetzlichen Reflow (siehe
		// readLabelOccupancyOrigin).
		const containerOrigin = typeof readLabelOccupancyOrigin === "function" ? readLabelOccupancyOrigin() : null;
		// Regionenlabels zuerst aufloesen; ihre finalen Rechtecke dann als feste Hindernisse an den
		// Orts-/Frei-Label-Pass geben, damit Staedtenamen unter Regionenlabels auf die Gegenseite ausweichen.
		const regionLabelRects = resolveRegionLabelCollisions();
		const occupiedRects = resolveLabelCollisions(regionLabelRects);

		// Dieser Pass ist der Taktgeber der GESAMTEN Beschriftung: erst steht die DOM-Seite (Gebiets-,
		// Landschafts- und Ortsnamen), dann erfaehrt die Canvas-Seite, wo kein Platz mehr ist, und
		// zeichnet ihre Weg-/Flussnamen als LETZTE -- sie sind die einzigen, die nur an ihrer eigenen
		// Linie ausweichen koennen. Umgekehrt (Wegnamen zuerst) waere messbar schlechter: die Ortsnamen
		// haben zwoelf Ausweichplaetze, verlieren aber bei ~500 zusaetzlichen Hindernissen 503 von ihnen
		// ganz (gemessen 2026-08-05, docs/superpowers/specs/2026-08-05-label-kollision-wege-orte-design.md).
		publishLabelOccupancy(occupiedRects, containerOrigin);
		if (window.AvesmapsPathLabelCanvasOverlay && typeof window.AvesmapsPathLabelCanvasOverlay.redraw === "function") {
			window.AvesmapsPathLabelCanvasOverlay.redraw();
		}
	});
}

// Territorie-Labels: gegenseitiges Abstoßen bis zu einer max. "Tension" (Verschiebung),
// damit sie sich nicht überlappen. Eigener Pass (eigene acceptedRects) -> stört Orts-/Frei-
// Label-Declutter nicht. Wird NICHT versteckt: passt nichts innerhalb der Tension, bleibt
// das Label zentriert (kleineres Übel als ein fehlendes Gebiets-Label).
// Max. Verschiebung (Repel) in px, bis ein Label ausweicht. Passt es selbst dann nicht kollisionsfrei,
// wird es AUSGEBLENDET (statt zentriert ueberlappend stehen zu bleiben). Live justierbar via ?labelrepel=20.
const REGION_LABEL_MAX_TENSION = (() => {
	const match = /[?&]labelrepel=([0-9.]+)/.exec(typeof location !== "undefined" ? location.search : "");
	const value = match ? parseFloat(match[1]) : 20;
	return Number.isFinite(value) && value >= 0 ? value : 20;
})();
const REGION_LABEL_TENSION_STEP = 7;   // Ring-Schrittweite

function getRegionLabelOffsetCandidates() {
	const candidates = [{ dx: 0, dy: 0 }];
	const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
	for (let radius = REGION_LABEL_TENSION_STEP; radius <= REGION_LABEL_MAX_TENSION; radius += REGION_LABEL_TENSION_STEP) {
		for (const [unitX, unitY] of directions) {
			// Volle vertikale Reichweite: breite Labels überlappen oft stark horizontal,
			// aber nur wenig vertikal -> ein vertikaler Versatz ist der kürzeste Ausweg.
			candidates.push({ dx: unitX * radius, dy: unitY * radius });
		}
	}
	return candidates;
}

// Ein Label-Offset ist ein reiner CSS-Pixel-Translate (.region-label__content bzw. die
// per left/top verschobene Orts-Label-span). Die verschobene Box ist also die gemessene
// Box, nur um (dx, dy) verschoben -> wir können Kandidaten in JS berechnen, statt nach
// jedem Offset erneut getBoundingClientRect aufzurufen (Layout-Thrashing, ~12k erzwungene
// Reflows pro Zoom). measure-once -> rechnen -> einmal schreiben.
function translateLabelRect(rect, dx, dy) {
	return {
		left: rect.left + dx,
		right: rect.right + dx,
		top: rect.top + dy,
		bottom: rect.bottom + dy,
		width: rect.width,
		height: rect.height,
	};
}

function resolveRegionLabelCollisions() {
	const labels = typeof regionLabels !== "undefined" && Array.isArray(regionLabels) ? regionLabels : [];
	const entries = labels
		.filter((label) => label && typeof label.getElement === "function" && map.hasLayer(label) && label.getElement())
		.map((label) => ({ element: label.getElement(), priority: Number(label._regionLabelPriority) || 0 }));
	if (entries.length === 0) {
		return [];
	}

	// Schreibphase 1: alle Offsets auf 0 zurücksetzen UND alle wieder einblenden (ein vorheriger Pass kann
	// Labels ausgeblendet haben) -> Basis-Box bei Offset 0 messen.
	entries.forEach(({ element }) => { setLabelElementOffset(element, 0, 0); element.style.visibility = ""; });

	// Lesephase: jede Box GENAU EINMAL messen (gebatcht -> ein Reflow statt tausender).
	const regionPadding = typeof REGION_LABEL_COLLISION_PADDING !== "undefined" ? REGION_LABEL_COLLISION_PADDING : LOCATION_LABEL_COLLISION_PADDING;
	const measured = entries.map(({ element, priority }) => ({ element, priority, base: measureLabelCollisionRect(element, regionPadding) }));

	const candidates = getRegionLabelOffsetCandidates();
	const acceptedRects = [];
	const writes = [];
	measured
		.sort((left, right) => right.priority - left.priority)
		.forEach(({ element, base }) => {
			if (base.width <= 0 || base.height <= 0) {
				writes.push({ element, dx: 0, dy: 0, hide: false });
				return;
			}
			let chosen = null;
			for (const candidate of candidates) {
				const rect = translateLabelRect(base, candidate.dx, candidate.dy);
				if (!acceptedRects.some((acceptedRect) => rectanglesOverlap(rect, acceptedRect))) {
					acceptedRects.push(rect);
					chosen = candidate;
					break;
				}
			}
			if (!chosen) {
				// Repel-Limit erschöpft -> Label AUSBLENDEN (statt zentriert überlappen zu lassen).
				// Ein verstecktes Label blockiert nachfolgende NICHT -> KEIN acceptedRects-Eintrag.
				writes.push({ element, dx: 0, dy: 0, hide: true });
			} else {
				writes.push({ element, dx: chosen.dx, dy: chosen.dy, hide: false });
			}
		});

	// Schreibphase 2: gewählte Offsets + Sichtbarkeit in einem Rutsch anwenden (kein Reflow bis zum nächsten Lesen).
	writes.forEach(({ element, dx, dy, hide }) => {
		setLabelElementOffset(element, dx, dy);
		element.style.visibility = hide ? "hidden" : "";
	});
	// Versteckte Labels NICHT als Hindernisse an den Orts-/Frei-Label-Pass geben.
	return acceptedRects;
}

function rectanglesOverlap(firstRect, secondRect) {
	return firstRect.left < secondRect.right
		&& firstRect.right > secondRect.left
		&& firstRect.top < secondRect.bottom
		&& firstRect.bottom > secondRect.top;
}

function expandRect(rect, padding) {
	return {
		left: rect.left - padding,
		right: rect.right + padding,
		top: rect.top - padding,
		bottom: rect.bottom + padding,
		width: rect.width + padding * 2,
		height: rect.height + padding * 2,
	};
}

function getLocationNameLabelPriority(entry) {
	const priorities = {
		metropole: 100,
		grossstadt: 90,
		stadt: 80,
		kleinstadt: 70,
		dorf: 60,
		gebaeude: 60,
	};
	return priorities[entry.markerEntry?.locationType] || 50;
}

function getLabelOffsetCandidates() {
	return [
		[0, 0],
		[8, 0],
		[-8, 0],
		[0, -8],
		[0, 8],
		[12, -6],
		[-12, -6],
		[12, 6],
		[-12, 6],
	];
}

function setLabelElementOffset(element, offsetX, offsetY) {
	element.style.setProperty("--label-offset-x", `${offsetX}px`);
	element.style.setProperty("--label-offset-y", `${offsetY}px`);
}

function getLocationNameLabelBaseOffset(element) {
	const labelElement = element.querySelector("img") || element.querySelector("span");
	const style = labelElement ? window.getComputedStyle(labelElement) : null;
	return {
		x: parseFloat(style?.getPropertyValue("--location-label-offset-x")) || LOCATION_LABEL_GAP,
		y: parseFloat(style?.getPropertyValue("--location-label-offset-y")) || 0,
	};
}

function getLocationNameLabelOffsets(element, labelRect) {
	const baseOffset = getLocationNameLabelBaseOffset(element);
	const labelWidth = labelRect.width;
	const labelHeight = labelRect.height;
	const scaledGap = Math.max(LOCATION_LABEL_GAP, Math.abs(baseOffset.x));
	const smallShift = LOCATION_LABEL_SHIFT_SMALL;
	const verticalCenterOffset = -labelHeight / 2;

	return [
		{ name: "right", dx: baseOffset.x, dy: baseOffset.y },
		{ name: "right-up", dx: baseOffset.x, dy: baseOffset.y - smallShift },
		{ name: "right-down", dx: baseOffset.x, dy: baseOffset.y + smallShift },
		{ name: "top-right", dx: baseOffset.x, dy: baseOffset.y - labelHeight - smallShift },
		{ name: "bottom-right", dx: baseOffset.x, dy: baseOffset.y + labelHeight + smallShift },
		{ name: "left", dx: -labelWidth - scaledGap, dy: baseOffset.y },
		{ name: "left-up", dx: -labelWidth - scaledGap, dy: baseOffset.y - smallShift },
		{ name: "left-down", dx: -labelWidth - scaledGap, dy: baseOffset.y + smallShift },
		{ name: "top-left", dx: -labelWidth - scaledGap, dy: baseOffset.y - labelHeight - smallShift },
		{ name: "bottom-left", dx: -labelWidth - scaledGap, dy: baseOffset.y + labelHeight + smallShift },
		{ name: "top", dx: -labelWidth / 2, dy: verticalCenterOffset - labelHeight - smallShift },
		{ name: "bottom", dx: -labelWidth / 2, dy: verticalCenterOffset + labelHeight + smallShift },
	];
}

function setLabelElementChosenOffset(element, isLocation, baseOffset, candidate) {
	// Orts-Labels: left/top = location-label-offset + label-offset; Kandidat ist die Zielposition
	// relativ zum Marker, der angewandte --label-offset also (Kandidat - Basis-Offset). Frei-Labels:
	// Kandidat ist direkt der Offset.
	if (isLocation) {
		setLabelElementOffset(element, candidate.dx - baseOffset.x, candidate.dy - baseOffset.y);
		return;
	}
	setLabelElementOffset(element, candidate.dx, candidate.dy);
}

function getLabelCollisionTarget(element) {
	if (element.classList.contains("location-name-label")) {
		// Sichtbarer Text steckt jetzt in einem <img> (Canvas-gerendert); Fallback span (Alt-Pfad).
		return element.querySelector("img") || element.querySelector("span") || element;
	}
	if (element.classList.contains("region-label")) {
		// Der sichtbare (und per --label-offset verschobene) Teil ist der Inhalt.
		return element.querySelector(".region-label__content") || element;
	}
	if (element.classList.contains("map-label")) {
		// Freie Karten-Labels (Kontinente/Meere/Landschaften): sichtbarer Text steckt jetzt in einem
		// <img> (Canvas-gerendert); das aeussere Element ist 0x0 -> sonst ignoriert die Kollision sie komplett.
		return element.querySelector("img") || element.querySelector("span") || element;
	}
	return element;
}

function measureLabelRect(element) {
	return getLabelCollisionTarget(element).getBoundingClientRect();
}

function measureLabelCollisionRect(element, padding = LOCATION_LABEL_COLLISION_PADDING) {
	const rect = measureLabelRect(element);
	if (rect.width <= 0 || rect.height <= 0) {
		return rect;
	}

	return expandRect(rect, padding);
}

function getCollisionEntries() {
	const freeLabelEntries = labelMarkers
		.filter((entry) => map.hasLayer(entry.marker))
		.map((entry) => ({
			element: entry.marker.getElement(),
			// Freie Karten-Labels (Kontinente/Meere/Landschaften) sind feste Landmarken -> hohe Prioritaet
			// ueber allen Staedten, damit sie zuerst platziert werden und Staedtenamen ihnen ausweichen.
			priority: 1000 + (Number(entry.label.priority) || 3),
			minZoom: Number(entry.label.minZoom) || 0,
			// 🔴 Labels DERSELBEN Flaeche duerfen einander ueberlappen (Owner 2026-07-28). Ein Gebirge wie
			// der Finsterkamm traegt seinen Namen im Norden UND im Sueden; dass die beiden sich beim Zoomen
			// zeitweise beruehren, ist kein Konflikt, sondern derselbe Name an zwei Stellen. Ohne diese
			// Ausnahme blendet die Aufloesung eine der beiden aus -- und genau dafuer wurden sie angelegt.
			//
			// 🔴 DER SERVER LOEST DIE ZUGEHOERIGKEIT AUF, deshalb steht sie zuerst am Label selbst
			// (properties.ecosystem_region_public_id, api/_internal/app/ecosystem-label-link.php). Das ist
			// der einzige Weg, auf dem der LESEMODUS sie ueberhaupt kennt: ecosystemRegionOfLabel braucht
			// die Regionsliste, und die liegt hinter der `edit`-Berechtigung. Der Aufloeser bleibt als
			// Rueckfall stehen -- fuer den Moment nach einer Bearbeitung, in dem eine frisch angelegte
			// Zuordnung noch nicht durch die Kartennutzlast gereist ist.
			group: String(entry.label.ecosystemRegionPublicId || "")
				|| (typeof ecosystemRegionOfLabel === "function"
					? String(ecosystemRegionOfLabel(entry.label)?.public_id || "")
					: ""),
		}));
	const locationLabelEntries = locationNameLabels
		.filter((entry) => map.hasLayer(entry.marker))
		.map((entry) => ({
			element: entry.marker.getElement(),
			priority: getLocationNameLabelPriority(entry),
			minZoom: LOCATION_NAME_LABEL_CONFIG[entry.markerEntry?.locationType]?.minZoom || 0,
			group: "",                                 // Orte gehoeren zu keiner Flaeche
		}));

	return [...locationLabelEntries, ...freeLabelEntries].filter(({ element }) => element);
}

function resolveLabelCollisions(seedRects = []) {
	const visibleEntries = getCollisionEntries();
	const offsetCandidates = getLabelOffsetCandidates();

	// Schreibphase 1: alle Offsets zurücksetzen, damit die Basis-Box bei Offset 0 gemessen wird.
	visibleEntries.forEach(({ element }) => {
		element.classList.remove("is-colliding");
		setLabelElementOffset(element, 0, 0);
	});

	// Lesephase: jedes Label GENAU EINMAL messen + Kandidaten vorberechnen (gebatcht -> ein Reflow
	// statt N x Kandidaten erzwungener Reflows). Kandidaten werden anschließend rein in JS getestet.
	const measured = visibleEntries
		.sort((left, right) => {
			const priorityDiff = right.priority - left.priority;
			return priorityDiff || left.minZoom - right.minZoom;
		})
		.map(({ element, group }) => {
			const isLocation = element.classList.contains("location-name-label");
			const baseRect = measureLabelRect(element);
			const collisionRect = measureLabelCollisionRect(element);
			const baseOffset = isLocation ? getLocationNameLabelBaseOffset(element) : { x: 0, y: 0 };
			const candidates = isLocation
				? getLocationNameLabelOffsets(element, baseRect)
				: offsetCandidates.map(([offsetX, offsetY]) => ({ dx: offsetX, dy: offsetY }));
			return { element, isLocation, collisionRect, baseOffset, candidates, group };
		});

	// Mit den Regionenlabel-Rechtecken vorbelegen -> Orts-/Frei-Labels weichen ihnen aus (Gegenseite).
	const acceptedRects = Array.isArray(seedRects) ? seedRects.slice() : [];
	const writes = [];
	measured.forEach(({ element, isLocation, collisionRect, baseOffset, candidates, group }) => {
		if (collisionRect.width <= 0 || collisionRect.height <= 0) {
			writes.push({ element, isLocation, baseOffset, candidate: candidates[0], colliding: false });
			return;
		}

		let chosen = null;
		for (const candidate of candidates) {
			// Translation in px relativ zur bei Offset 0 gemessenen Basis-Box.
			const translateX = isLocation ? (candidate.dx - baseOffset.x) : candidate.dx;
			const translateY = isLocation ? (candidate.dy - baseOffset.y) : candidate.dy;
			const rect = translateLabelRect(collisionRect, translateX, translateY);
			// Ein Rechteck der EIGENEN Flaeche zaehlt nicht als Hindernis -- siehe getCollisionEntries.
			// Die Vorbelegung (seedRects) hat kein group und blockiert weiterhin jeden.
			const blockiert = acceptedRects.some((acceptedRect) => {
				if (group !== "" && acceptedRect.group === group) {
					return false;
				}
				return rectanglesOverlap(rect, acceptedRect);
			});
			if (!blockiert) {
				acceptedRects.push({ ...rect, group });
				chosen = candidate;
				break;
			}
		}

		if (chosen) {
			writes.push({ element, isLocation, baseOffset, candidate: chosen, colliding: false });
			return;
		}

		// 🔴 EIN FLAECHEN-LABEL WIRD NIE AUSGEBLENDET (Owner 2026-07-28). Fuer Siedlungen und freie
		// Labels ist Verstecken die richtige Antwort auf Gedraenge -- es gibt viele davon, und der eine
		// fehlende Ortsname faellt nicht ins Gewicht. Eine Landschaft ist etwas anderes: ihr Label ist
		// der einzige garantierte Anfasser ihrer Flaeche. Verschwindet es, ist eine vollstaendig von
		// einer groesseren ueberdeckte Flaeche gar nicht mehr erreichbar -- genau das, was die
		// Groessensortierung und dieser Punkt gemeinsam loesen sollen.
		//
		// Es weicht weiterhin aus, solange irgendein Platz frei ist (die Schleife oben lief ja); es
		// bleibt nur stehen, wenn keiner frei war. Und sein Rechteck wandert TROTZDEM in acceptedRects,
		// damit fremde Labels ihm ausweichen -- es ist sichtbar, also ist es ein Hindernis.
		const gesetzt = group !== "";
		if (gesetzt) {
			const rect = translateLabelRect(
				collisionRect,
				isLocation ? (candidates[0].dx - baseOffset.x) : candidates[0].dx,
				isLocation ? (candidates[0].dy - baseOffset.y) : candidates[0].dy
			);
			acceptedRects.push({ ...rect, group });
		}
		writes.push({ element, isLocation, baseOffset, candidate: candidates[0], colliding: !gesetzt });
	});

	// Schreibphase 2: gewählte Offsets + Kollisions-Klasse in einem Rutsch anwenden.
	writes.forEach(({ element, isLocation, baseOffset, candidate, colliding }) => {
		setLabelElementChosenOffset(element, isLocation, baseOffset, candidate);
		if (colliding) {
			element.classList.add("is-colliding");
		}
	});

	// Die Endlage zurueckgeben: Gebietsnamen (die Vorbelegung) plus jedes tatsaechlich gesetzte Label.
	// Ausgeblendete stehen NICHT drin -- ein verstecktes Label ist kein Hindernis. Der Aufrufer schiebt
	// das in die gemeinsame Belegungskarte, damit die Weg-/Flussnamen ihnen ausweichen koennen
	// (map-features-label-occupancy.js).
	return acceptedRects;
}
