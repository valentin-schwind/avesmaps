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
		// 🔴 Die Kurvenlabels werden HIER platziert, VOR den Orts- und Freilabels -- nicht am Ende
		// beim Zeichnen. Ein Landschaftsname ist heute Teilnehmer dieser Stufe; ihn ans Ende zu
		// haengen, weil er kuenftig auf Canvas gemalt wird, waere eine RANGaenderung, getarnt als
		// Zeichenaenderung: Dorfnamen gewaennen gegen „Schwarze Sichel". Entwurf §7.2 verbietet das
		// ausdruecklich („An der Prioritaetenordnung wird in diesem Vorhaben nichts geaendert").
		// ⚠️ Es geht als MEHRERE kleine Rechtecke entlang der Grundlinie ein, nicht als eine
		// Huellbox -- ein um 297° gedrehtes <img> liefert heute eine stark aufgeblaehte
		// achsenparallele Huelle, die kleinen Kaesten sind die genauere Aussage (Entwurf §7.2).
		// ⚠️ Sie kommen in VIEWPORT-Koordinaten heraus, wie die Rechtecke der Gebietsnamen darueber;
		// die Umrechnung aus den Container-Pixeln des Canvas macht die Funktion selbst, mit dem
		// containerOrigin von oben (siehe dort, und map-features-label-occupancy.js).
		const kurvenRects = typeof avesmapsKurvenlabelPlatzierungen === "function"
			? avesmapsKurvenlabelPlatzierungen(containerOrigin)
			: [];
		// 💣 UND ERST JETZT DEN ALTEN MARKER WEGNEHMEN. Der Riegel in shouldShowLabelMarker haengt am
		// ERGEBNIS der Zeile darueber, und niemand sonst fragt ihn erneut: syncLabelVisibility laeuft
		// nur bei Zoom und Schwenk. Ohne diesen Aufruf stuende der Name nach dem Laden dauerhaft
		// DOPPELT -- gebogen auf der Kurve und waagerecht am Marker daneben.
		// ⚠️ Er steht VOR resolveLabelCollisions, damit getCollisionEntries den abgemeldeten Marker
		// nicht noch einmal als Hindernis mitzaehlt: die Kurve tut das schon, und zwar genauer.
		if (typeof avesmapsSyncKurvenlabelMarker === "function") {
			avesmapsSyncKurvenlabelMarker();
		}
		const occupiedRects = resolveLabelCollisions(regionLabelRects.concat(kurvenRects));

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

// 🔴 translateLabelRect / rectanglesOverlap / expandRect stehen seit 22.08.2026 in
// js/map-features/label-placement.js -- rein, ohne DOM, und dadurch auch vom Vorschaupanel im
// Fenster „Zoombänder" nutzbar. Hier bleiben nur die Teile, die wirklich messen und schreiben.

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

// 🔴 Die Tafel steht in js/map-features/label-placement.js -- geteilt mit dem Vorschaupanel,
// damit dort dieselbe Rangfolge gilt wie hier.
function getLocationNameLabelPriority(entry) {
	return AVESMAPS_LABEL_PRIORITY_BY_TYPE[entry.markerEntry?.locationType] || 50;
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

// Dünner DOM-Mantel: Grundstellung aus den CSS-Variablen lesen, den Rest rechnet
// avesmapsLabelCandidatePlacements (js/map-features/label-placement.js) -- dieselbe Fassung, die
// das Vorschaupanel im Fenster „Zoombänder" ruft.
function getLocationNameLabelOffsets(element, labelRect) {
	return avesmapsLabelCandidatePlacements(
		getLocationNameLabelBaseOffset(element),
		labelRect.width,
		labelRect.height
	);
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

// 🔴 AUFGABE 8B: "Repel" ist jetzt ein globaler Regler im Fenster „Zoombänder" (war die Konstante
// LOCATION_LABEL_COLLISION_PADDING) -- als Vorgabewert-Ausdruck statt einer Konstante, damit ein
// Aufruf ohne explizites `padding` (Orts-/Frei-Label-Pass, `duplicateLabelEntry`) den WIRKSAMEN Wert
// bekommt, nicht den zur Ladezeit eingefrorenen. Der Regionen-Aufruf (resolveRegionLabelCollisions,
// oben) übergibt weiterhin seinen eigenen regionPadding -- unverändert, siehe Bericht.
function measureLabelCollisionRect(element, padding = avesmapsLocationLabelSpacing("repel")) {
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
			// Die Erscheinungsstufe des Namens aus dem Zoomband -- bei gleicher Priorität wird
			// zuerst platziert, was schon länger sichtbar ist.
			minZoom: avesmapsLocationZoomBandMinZoom("label", entry.markerEntry?.locationType) ?? 0,
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
		.map(({ element, group, priority, minZoom }) => {
			const isLocation = element.classList.contains("location-name-label");
			const baseRect = measureLabelRect(element);
			const collisionRect = measureLabelCollisionRect(element);
			const baseOffset = isLocation ? getLocationNameLabelBaseOffset(element) : { x: 0, y: 0 };
			const candidates = isLocation
				? getLocationNameLabelOffsets(element, baseRect)
				: offsetCandidates.map(([offsetX, offsetY]) => ({ dx: offsetX, dy: offsetY }));
			return { element, isLocation, collisionRect, baseOffset, candidates, group, priority, minZoom };
		});

	// 🔴 DER KERN LIEGT IN js/map-features/label-placement.js -- reine Rechteck-Mathe, damit das
	// Vorschaufenster GENAU dieselbe Ordnung zeigt wie die Karte. Hier bleibt das Messen und das
	// Schreiben; dazwischen steht eine Funktion, kein zweites Verfahren.
	const { ergebnisse, belegt } = avesmapsResolveLabelPlacements(
		measured.map(({ isLocation, collisionRect, baseOffset, candidates, group, priority, minZoom }) => ({
			kollisionsRect: collisionRect,
			basisOffset: baseOffset,
			kandidaten: candidates,
			gruppe: group,
			relativ: isLocation,
			// ⚠️ Die Ordnung REIST MIT, statt sich auf die vorherige sort() plus eine stabile
			// Sortierung im Löser zu verlassen. Beides ergäbe heute dasselbe -- aber „es stimmt,
			// weil die Sortierung stabil ist" ist keine Zusicherung, sondern ein Zufall.
			prioritaet: priority,
			minZoom: minZoom,
		})),
		{ seedRects: Array.isArray(seedRects) ? seedRects : [] }
	);
	const writes = measured.map(({ element, isLocation, baseOffset }, i) => ({
		element,
		isLocation,
		baseOffset,
		candidate: ergebnisse[i].kandidat,
		colliding: ergebnisse[i].kollidiert,
	}));
	const acceptedRects = belegt;

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
