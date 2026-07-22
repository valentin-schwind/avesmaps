function getPowerlineLatLngs(powerline) {
	const fromEntry = findLocationMarkerByPublicId(powerline.properties?.from_public_id);
	const toEntry = findLocationMarkerByPublicId(powerline.properties?.to_public_id);
	if (fromEntry && toEntry) {
		return [fromEntry.marker.getLatLng(), toEntry.marker.getLatLng()];
	}
	return powerline.geometry.coordinates.map(([x, y]) => L.latLng(y, x));
}

function getPowerlinePublicId(powerline) {
	return powerline?.properties?.public_id || powerline?.id || "";
}

function getPowerlineDisplayName(powerline) {
	return String(powerline?.properties?.name || "Kraftlinie").trim() || "Kraftlinie";
}

// Eine Kraftlinie liegt als VIELE powerline-Zeilen in der Karte (Basiliuslinie = 14 Segmente,
// Faecher der Macht = 11). Der Name ist das einzige Band zwischen ihnen -- dieselbe
// 1-zu-N-Form wie bei Strassen. Namenlose Segmente bilden bewusst KEINE Gruppe, sonst
// waeren sie alle eine einzige Linie.
function getPowerlineSegmentsSharingName(powerline) {
	const name = String(powerline?.properties?.name || "").trim();
	if (name === "") {
		return [];
	}
	return powerlineData.filter((entry) => String(entry?.properties?.name || "").trim() === name);
}

// Nachbarschaft ueber die Nodix-Endpunkte aller Segmente einer Linie.
function buildPowerlineAdjacency(segments) {
	const adjacency = new Map();
	segments.forEach((segment) => {
		const from = segment?.properties?.from_public_id || "";
		const to = segment?.properties?.to_public_id || "";
		if (!from || !to) {
			return;
		}
		if (!adjacency.has(from)) {
			adjacency.set(from, []);
		}
		if (!adjacency.has(to)) {
			adjacency.set(to, []);
		}
		adjacency.get(from).push(to);
		adjacency.get(to).push(from);
	});
	return adjacency;
}

// Eine reine Kreuzung ist kein Ziel, das man benennen kann: mehrere Segmente heissen heute
// woertlich "Kreuzung - Kreuzung", und "Verbindet: Kreuzung <-> Kreuzung" waere Laerm.
function isNamedPowerlineEndpoint(publicId) {
	const entry = findLocationMarkerByPublicId(publicId);
	if (!entry || entry.locationType === CROSSING_LOCATION_TYPE) {
		return false;
	}
	return String(entry.name || "").trim() !== "";
}

// Vom Kettenende nach innen laufen, bis ein benannter Punkt kommt.
function walkToNamedPowerlineEndpoint(adjacency, startPublicId) {
	const visited = new Set();
	let current = startPublicId;
	while (current && !visited.has(current)) {
		visited.add(current);
		if (isNamedPowerlineEndpoint(current)) {
			return current;
		}
		current = (adjacency.get(current) || []).find((id) => !visited.has(id)) || "";
	}
	return "";
}

// Die Gestalt der GANZEN Linie, nicht des angeklickten Segments: wer die Basiliuslinie anklickt,
// will nicht wissen, welchen von sechzehn Hops er getroffen hat.
//
// 💣 AM LIVE-BESTAND GEMESSEN (2026-07-22, 162 Segmente / 61 Namen): Kraftlinien sind KEINE
// Straengen wie Strassen. 54 Namen sind Straenge (2 Enden), 6 sind VERZWEIGT (bis zu 6 Enden --
// Basiliuslinie, Yaquirlinie, Elementares Hexagramm, Strick des Schwarzen Mannes) und einer ist
// ein RING (0 Enden, Hexenband(-schleife)). Eine erste Fassung verlangte genau zwei Enden und gab
// sonst nichts zurueck -- das schwieg ausgerechnet die groessten Linien tot, 44 von 162 Segmenten.
// Darum beschreibt diese Funktion die Topologie, statt sie abzulehnen.
//
// @return {{segmentCount:number, endpointIds:string[], stationIds:string[], isRing:boolean}|null}
function getPowerlineTopology(powerline) {
	const segments = getPowerlineSegmentsSharingName(powerline);
	if (segments.length === 0) {
		return null;
	}
	const adjacency = buildPowerlineAdjacency(segments);
	const chainEnds = [...adjacency.keys()].filter((id) => (adjacency.get(id) || []).length === 1);

	// Jedes Kettenende nach innen laufen lassen, bis ein BENANNTER Punkt kommt (reine Kreuzungen
	// ueberspringen). Mehrere Enden koennen auf denselben benannten Punkt zulaufen -> dedupliziert.
	const endpointIds = [];
	chainEnds.forEach((endId) => {
		const named = walkToNamedPowerlineEndpoint(adjacency, endId);
		if (named && !endpointIds.includes(named)) {
			endpointIds.push(named);
		}
	});

	// Alles Benannte dazwischen -- das traegt den Ring (der gar keine Enden hat) und macht auch
	// bei Straengen sichtbar, woran die Linie unterwegs vorbeikommt.
	const stationIds = [...adjacency.keys()].filter((id) => !endpointIds.includes(id) && isNamedPowerlineEndpoint(id));

	return {
		segmentCount: segments.length,
		endpointIds,
		stationIds,
		isRing: chainEnds.length === 0,
	};
}

// Rueckwaertskompatibel: der saubere Zwei-Enden-Fall (54 der 61 Namen).
function getPowerlineSpanEndpointIds(powerline) {
	const topology = getPowerlineTopology(powerline);
	if (!topology || topology.endpointIds.length !== 2) {
		return null;
	}
	return { fromPublicId: topology.endpointIds[0], toPublicId: topology.endpointIds[1] };
}

function createPowerlineStrandLatLngs(latLngs, strandIndex, timeSeconds = 0) {
	if (latLngs.length < 2) {
		return latLngs;
	}

	const start = latLngs[0];
	const end = latLngs[latLngs.length - 1];
	const dx = end.lng - start.lng;
	const dy = end.lat - start.lat;
	const length = Math.sqrt(dx * dx + dy * dy) || 1;
	const tx = dx / length;
	const ty = dy / length;
	const nx = -ty;
	const ny = tx;
	const segmentCount = Math.max(2, Math.round(POWERLINE_RENDER_CONFIG.segmentCount));
	const phase = strandIndex * POWERLINE_RENDER_CONFIG.phaseStep;
	const normalScale = POWERLINE_RENDER_CONFIG.normalScales[strandIndex % POWERLINE_RENDER_CONFIG.normalScales.length];
	const waveOffset = POWERLINE_RENDER_CONFIG.waveOffsets[strandIndex % POWERLINE_RENDER_CONFIG.waveOffsets.length];
	const points = [];

	for (let index = 0; index <= segmentCount; index++) {
		const t = index / segmentCount;
		const envelope = Math.sin(Math.PI * t);
		const normalWave = Math.sin(index * 0.62 + phase) * envelope * 4.5;
		const tangentWave = Math.sin(index * 1.17 + phase) * envelope * 0.8;
		const tremorWave = Math.sin(
			timeSeconds * POWERLINE_RENDER_CONFIG.tremorNormalSpeed
			+ index * POWERLINE_RENDER_CONFIG.tremorNormalFrequency
			+ phase * POWERLINE_RENDER_CONFIG.tremorPhaseMultiplier
		) * envelope * POWERLINE_RENDER_CONFIG.tremorNormalAmplitude;
		const tremorTangent = Math.sin(
			timeSeconds * POWERLINE_RENDER_CONFIG.tremorTangentSpeed
			+ index * POWERLINE_RENDER_CONFIG.tremorTangentFrequency
			+ phase
		) * envelope * POWERLINE_RENDER_CONFIG.tremorTangentAmplitude;
		// "Störung": zwei überlagerte, hochfrequente + schnelle Sinus quer zur Linie -> flackernder Interferenz-Look.
		const interferenceSpeed = POWERLINE_RENDER_CONFIG.interferenceSpeed || 0;
		const interference = (
			Math.sin(index * 2.6 + timeSeconds * interferenceSpeed + phase * 3.3)
			+ 0.6 * Math.sin(index * 4.1 - timeSeconds * interferenceSpeed * 1.7 + phase)
		) * envelope * (POWERLINE_RENDER_CONFIG.interferenceAmplitude || 0);
		const normalOffset = (normalWave + tremorWave + interference + waveOffset * envelope) * normalScale;

		points.push(L.latLng(
			start.lat + dy * t + ny * normalOffset + ty * (tangentWave + tremorTangent),
			start.lng + dx * t + nx * normalOffset + tx * (tangentWave + tremorTangent)
		));
	}

	return points;
}

function getPowerlineRenderStyles() {
	const styles = [];

	for (let strikeIndex = 0; strikeIndex < POWERLINE_RENDER_CONFIG.strandCount; strikeIndex++) {
		styles.push(
			{
				className: `powerline powerline--aura powerline--strike-${strikeIndex + 1}`,
				weight: 10,
				opacity: 0.34,
				strandIndex: strikeIndex,
			},
			{
				className: `powerline powerline--mid powerline--strike-${strikeIndex + 1}`,
				weight: 4.6,
				opacity: 0.72,
				strandIndex: strikeIndex,
			},
			{
				className: `powerline powerline--core powerline--strike-${strikeIndex + 1}`,
				weight: 1.5,
				opacity: 0.98,
				strandIndex: strikeIndex,
			}
		);
	}

	return styles;
}

function shouldPowerlineNameBeDisplayed(powerline) {
	return powerline?.properties?.show_label === true || powerline?.properties?.show_label === 1 || powerline?.properties?.show_label === "1";
}

function isPowerlineLabelVisibleAtCurrentZoom(powerline) {
	return shouldPowerlineNameBeDisplayed(powerline) && map.getZoom() >= 2;
}

function getPowerlineLabelStyle() {
	return {
		fill: "rgba(255, 196, 214, 0.98)",
		stroke: "transparent",
		strokeWidth: "0",
		paintOrder: "fill",
		fontFamily: '"Faculty Glyphic", Georgia, "Times New Roman", serif',
		fontSize: `${Math.max(18, getLocationNameLabelSize("dorf") + 7)}px`,
		fontWeight: "500",
		letterSpacing: "0",
	};
}

function getReadablePowerlineLabelLatLngCoordinates(latLngCoords) {
	if (latLngCoords.length < 2) {
		return latLngCoords;
	}

	const startPoint = map.latLngToLayerPoint(latLngCoords[0]);
	const endPoint = map.latLngToLayerPoint(latLngCoords[latLngCoords.length - 1]);
	return endPoint.x < startPoint.x ? [...latLngCoords].reverse() : latLngCoords;
}

function refreshPowerlineLayerText(powerline) {
	const labelLine = powerline?._labelLine;
	if (!labelLine?.setText) {
		return;
	}

	if (typeof PATH_LABELS_ON_CANVAS !== "undefined" && PATH_LABELS_ON_CANVAS) {
		// Kraftlinien-Namen zeichnet das Canvas-Overlay -> hier nur einen evtl. alten SVG-Text entfernen.
		labelLine.removeText?.();
		return;
	}

	if (!isPowerlineLabelVisibleAtCurrentZoom(powerline)) {
		labelLine.removeText?.();
		return;
	}

	labelLine.setText(getPowerlineDisplayName(powerline), {
		className: "path-name-text path-name-text--powerline",
		offset: "50%",
		textAnchor: "middle",
		dy: "-10",
		style: getPowerlineLabelStyle(),
	});
}

function syncPowerlineLabels() {
	powerlineData.forEach(refreshPowerlineLayerText);
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
	}
}

// Die beiden Enden als Gold-Links. Markup und Klick-Ziel sind exakt die des Weges
// (pathItemStationLinkMarkup, js/map-features/map-features-path-item-links.js), und der Handler
// haengt global am document (js/routing/routing.js) -- Kraftlinien benutzen ihn einfach mit.
// „Anzeigen": zoomt auf die Ausdehnung der GANZEN Linie, nicht auf das angeklickte Segment --
// dieselbe Geste wie beim Weg (show-whole-path). Bei einer einsegmentigen Linie ist es schlicht
// ein Zoom auf dieses eine Stück, also nie falsch.
function showWholePowerlineFromInfobox(powerline) {
	const segments = getPowerlineSegmentsSharingName(powerline);
	const latLngs = [];
	(segments.length > 0 ? segments : [powerline]).forEach((segment) => {
		getPowerlineLatLngs(segment).forEach((latLng) => latLngs.push(latLng));
	});
	if (latLngs.length === 0 || typeof map === "undefined") {
		return;
	}
	const bounds = L.latLngBounds(latLngs);
	if (!bounds.isValid()) {
		return;
	}
	map.fitBounds(bounds, { padding: [60, 60], maxZoom: 4 });
}

function powerlineShowActionButtonMarkup(powerline) {
	return popupActionButtonMarkup({
		label: (typeof tr === "function" ? tr("popup.showWholePowerline", "Anzeigen") : "Anzeigen"),
		className: "location-popup__action-button--accent",
		iconMarkup: '<img class="location-popup__action-img" src="icons/sextant.webp" alt="" width="20" height="20" />',
		attributes: {
			"data-popup-action": "show-whole-powerline",
			"data-public-id": getPowerlinePublicId(powerline),
		},
	});
}

function powerlinePlaceLinkMarkup(publicId) {
	const entry = findLocationMarkerByPublicId(publicId);
	const name = String(entry?.name || "").trim();
	if (name === "") {
		return "";
	}
	return '<button type="button" class="location-popup__station-link" '
		+ `data-station-kind="location" data-station-ref="${escapeHtml(publicId)}">`
		+ `${escapeHtml(name)}</button>`;
}

function powerlinePlaceLinksMarkup(publicIds, separator, limit) {
	const links = (publicIds || []).map(powerlinePlaceLinkMarkup).filter((markup) => markup !== "");
	if (links.length === 0) {
		return "";
	}
	const cap = limit || links.length;
	const shown = links.slice(0, cap).join(separator);
	return links.length > cap ? `${shown} …` : shown;
}

// "Verbindet": bei zwei Enden das vertraute A ↔ B, bei einer verzweigten Linie ALLE ihre Enden.
// Ein Ring hat keine -- der wird ueber "Verlaeuft ueber" beschrieben.
function powerlineSpanMarkup(powerline) {
	const topology = getPowerlineTopology(powerline);
	if (!topology || topology.endpointIds.length === 0) {
		return "";
	}
	if (topology.endpointIds.length === 2) {
		const from = powerlinePlaceLinkMarkup(topology.endpointIds[0]);
		const to = powerlinePlaceLinkMarkup(topology.endpointIds[1]);
		return (from !== "" && to !== "") ? `${from} ↔ ${to}` : "";
	}
	return powerlinePlaceLinksMarkup(topology.endpointIds, " · ");
}

// Infobox der Kraftlinie -- gleiche .region-info-box-Huelle wie Weg/Region/Gebiet, damit sie
// Trenner, Breite und Padding der .settlement-popup-Styles erbt. Leere Zeilen fallen weg.
function powerlineInfoboxMarkup(powerline) {
	const row = (dtLabel, valueHtml) => {
		if (!valueHtml || String(valueHtml).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${valueHtml}</dd></div>`;
	};
	const topology = getPowerlineTopology(powerline);
	let rows = "";
	rows += row("Verbindet", powerlineSpanMarkup(powerline));
	// Die benannten Punkte dazwischen. Traegt den RING (der gar keine Enden hat) und zeigt auch bei
	// Straengen, woran die Linie unterwegs vorbeikommt. Gedeckelt, damit die Box nicht ausufert.
	rows += row("Verläuft über", powerlinePlaceLinksMarkup(topology?.stationIds || [], " · ", 12));
	// Immer wahr und immer verfuegbar -- und die einzige Zeile, die eine Linie ohne einen einzigen
	// benannten Punkt noch traegt.
	if (topology && topology.segmentCount > 1) {
		const ringNote = topology.isRing ? " · geschlossener Ring" : "";
		rows += row("Abschnitte", escapeHtml(`${topology.segmentCount}${ringNote}`));
	}
	// Was der Wiki-Abgleich beigesteuert hat. Liegt in einem EIGENEN Nest (properties.wiki_powerline),
	// damit der Sync die handgesetzten Felder nie ueberschreibt -- dasselbe Verhaeltnis wie
	// properties.wiki_path beim Weg. Leer, solange niemand "Kraftlinien syncen" gedrueckt hat.
	const wiki = (powerline?.properties?.wiki_powerline) || {};
	rows += row("Stärke", escapeHtml(String(wiki.staerke || "").trim()));
	rows += row("Affinität", escapeHtml(String(wiki.affinitaet || "").trim()));
	rows += row("Länge", escapeHtml(String(wiki.laenge || "").trim()));
	rows += row("Regionen", escapeHtml(String(wiki.regionen || "").trim()));
	// Handgetipptes schlaegt Wiki -- wer etwas selbst geschrieben hat, will es auch lesen.
	const description = String(powerline?.properties?.description || "").trim()
		|| String(wiki.description || "").trim();
	rows += row("Beschreibung", escapeHtml(description));
	// Multi-source system: die Zeile traegt den Wiki-Link UND die Katalog-Quellen, offizielle zuerst.
	// Auch hier gewinnt der handgesetzte Link vor dem aus dem Wiki.
	const wikiUrl = String(powerline?.properties?.wiki_url || "").trim()
		|| String(wiki.wiki_url || "").trim();
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine(
			"powerline",
			getPowerlinePublicId(powerline),
			wikiUrl,
			"location-popup__wiki-link"
		)
		: "";
	if (rows === "" && sourceMarkup === "") {
		return "";
	}
	return '<div class="region-info-box region-info-box--settlement">'
		+ `<dl class="region-info-box__data">${rows}</dl>`
		+ sourceMarkup
		+ "</div>";
}

function createPowerlinePopupMarkup(powerline) {
	const name = getPowerlineDisplayName(powerline);
	const typeLabel = tr("spotlight.type.powerline", "Kraftlinie");
	// 16:9-Kopfbild wie beim Weg. EIN Bild fuer alle Kraftlinien -- es gibt keine Subtypen.
	// showHeaderIcon bleibt false: das Bild ersetzt den Icon-Kopf ohnehin (js/ui/popups.js), und
	// faellt es je aus, ist ein titelloser Kopf besser als das Dorf-Icon aus locationIconMarkup.
	const headerImg = typeof infoHeaderImageMarkup === "function"
		? infoHeaderImageMarkup("powerline", name, typeLabel)
		: "";
	return locationPopupMarkup({
		name,
		locationType: "dorf",
		locationTypeLabel: typeLabel,
		headerImageMarkup: headerImg,
		showHeaderIcon: false,
		showDescription: false,
		showWikiLink: false,
		showType: true,
		actionsMarkup: (function () {
			// Besucher bekommen dieselben zwei Gesten wie beim Weg: die ganze Linie zeigen und
			// eine Änderung vorschlagen. Vorher hatte das Band NUR im Editor Inhalt.
			// „Link teilen" fehlt bewusst: Wege teilen über ihren Wiki-Deeplink (?strasse=/?fluss=),
			// für Kraftlinien gibt es keinen solchen Parameter -- ein Knopf, der nichts Auflösbares
			// erzeugt, wäre schlimmer als keiner.
			const buttons = [powerlineShowActionButtonMarkup(powerline)];
			const suggestSpec = typeof buildSuggestChangeButtonSpec === "function"
				? buildSuggestChangeButtonSpec({
					entityType: "powerline",
					entityId: getPowerlinePublicId(powerline),
					name,
					reportType: "kraftlinie",
					label: (typeof tr === "function" ? tr("popup.suggestChange", "Änderungen vorschlagen") : "Änderungen vorschlagen"),
				})
				: null;
			if (suggestSpec) {
				buttons.push(popupActionButtonMarkup(suggestSpec));
			}
			if (IS_EDIT_MODE) {
				buttons.push(popupActionButtonMarkup({
					label: "Bearbeiten",
					attributes: {
						"data-popup-action": "edit-powerline-details",
						"data-public-id": getPowerlinePublicId(powerline),
					},
				}));
				buttons.push(popupActionButtonMarkup({
					label: "Kraftlinie löschen",
					className: "location-popup__action-button--danger",
					attributes: {
						"data-popup-action": "delete-powerline",
						"data-public-id": getPowerlinePublicId(powerline),
					},
				}));
			}
			return buttons.length ? locationPopupActionsMarkup(buttons) : "";
		})() + powerlineInfoboxMarkup(powerline),
	});
}

function refreshPowerlineLayerPopup(powerline) {
	// KEIN bindPopup mehr (Owner 2026-07-22): eine Kraftlinie gehoert ins INFOPANEL, nicht in die
	// schwebende Kiste. bindPopup oeffnet automatisch und liesse sich weder vom Panel noch vom
	// Klick-Schiedsrichter abfangen -- Leaflet feuert alle click-Listener. Wir merken uns darum nur
	// Markup + Optionen und entscheiden im click-Handler (createPowerlineLayer), genau wie der Weg
	// es tut (refreshPathLayerPopup, map-features-path-rendering.js).
	powerline._popupMarkup = createPowerlinePopupMarkup(powerline);
	// Die Optionen gelten nur noch fuer den Rueckfall ohne Panel: "settlement-popup" loest die
	// Breite auf 400px, "floating-location-popup" gibt die Kachel-Optik.
	powerline._popupOptions = {
		minWidth: 320,
		maxWidth: 400,
		className: (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE)
			? "settlement-popup floating-location-popup"
			: "settlement-popup",
	};
}

function createPowerlineLayer(powerline) {
	const latLngs = getPowerlineLatLngs(powerline);
	const labelLine = L.polyline(getReadablePowerlineLabelLatLngCoordinates(latLngs), {
		pane: "labelsPane",
		color: "transparent",
		weight: 1,
		opacity: 0,
		interactive: false,
		lineCap: "round",
		lineJoin: "round",
	});
	// Breite, unsichtbare Hit-Linie auf der Basisgeometrie: die sichtbaren Straenge sind nur 1,5px
	// breit und wabern animiert -> kaum treffbar (Forum-Feedback). Die Hit-Linie faengt Klicks
	// stabil entlang der ganzen Linie ein; die Kern-Straenge bleiben zusaetzlich interaktiv.
	const hitLine = L.polyline(latLngs, {
		pane: "powerlinesPane",
		className: "powerline powerline--hit",
		color: "#000",
		opacity: 0,
		weight: 22,
		interactive: true,
		lineCap: "round",
		lineJoin: "round",
	});
	hitLine._powerlineHitLine = true;
	const layers = [labelLine, hitLine];
	const interactiveLines = [hitLine];
	getPowerlineRenderStyles().forEach(({ strandIndex, ...style }) => {
		const layer = L.polyline(createPowerlineStrandLatLngs(latLngs, strandIndex, powerlineAnimationTimeSeconds), {
			pane: "powerlinesPane",
			color: "#ff5f82",
			lineCap: "round",
			lineJoin: "round",
			interactive: style.className.includes("powerline--core"),
			...style,
		});
		layer._powerlineStrandIndex = strandIndex;
		layers.push(layer);
		if (layer.options.interactive) {
			interactiveLines.push(layer);
		}
	});
	const group = L.layerGroup(layers);
	powerline._layerGroup = group;
	powerline._labelLine = labelLine;
	powerline._interactiveLines = interactiveLines;
	interactiveLines.forEach((line) => {
		line.on("click", (event) => {
			// Klick-Schiedsrichter zuerst: Kraftlinien enden an Nodix-ORTEN, ein Klick nahe dem
			// Endpunkt gehoert dem Ort, nicht der Linie (docs/click-arbiter-coordination.md).
			if (typeof window.avesmapsTryOpenLocationAtContainerPoint === "function"
					&& window.avesmapsTryOpenLocationAtContainerPoint(event.containerPoint)) {
				L.DomEvent.stop(event);
				return;
			}
			// Der Normalfall: Info ins rechte Panel.
			if (typeof window.avesmapsShowPowerlineInInfopanel === "function"
					&& window.avesmapsShowPowerlineInInfopanel(powerline)) {
				return;
			}
			// Nur ohne Panel: schwebendes Popup als Rueckfall (bindPopup-Ersatz).
			if (powerline._popupMarkup && typeof map !== "undefined") {
				L.popup(powerline._popupOptions || {})
					.setLatLng(event.latlng)
					.setContent(powerline._popupMarkup)
					.openOn(map);
			}
		});
	});
	refreshPowerlineLayerPopup(powerline);
	refreshPowerlineLayerText(powerline);
	return group;
}

function normalizePowerlineFeature(feature) {
	const properties = feature.properties || {};
	return {
		id: feature.id || properties.public_id || "",
		geometry: feature.geometry,
		properties,
	};
}

function syncPowerlineVisibility() {
	const showPowerlines = getSelectedMapLayerMode() === "powerlines";
	powerlineLayers.forEach((layer) => map[showPowerlines ? "addLayer" : "removeLayer"](layer));
	if (showPowerlines) {
		ensurePowerlineAnimationLoop();
	} else {
		stopPowerlineAnimationLoop();
	}
	// Kraftlinien-Namen auf dem Canvas-Overlay neu zeichnen (Moduswechsel blendet sie ein/aus).
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
	}
}

function refreshPowerlineLayers(timeSeconds = powerlineAnimationTimeSeconds) {
	powerlineData.forEach((powerline) => {
		if (!powerline._layerGroup) {
			return;
		}
		const latLngs = getPowerlineLatLngs(powerline);
		powerline._layerGroup.eachLayer((layer) => {
			if (layer === powerline._labelLine) {
				layer.setLatLngs?.(getReadablePowerlineLabelLatLngCoordinates(latLngs));
				return;
			}
			if (layer._powerlineHitLine) {
				layer.setLatLngs?.(latLngs);
				return;
			}
			const strandIndex = layer._powerlineStrandIndex || 0;
			layer.setLatLngs?.(createPowerlineStrandLatLngs(latLngs, strandIndex, timeSeconds));
		});
		refreshPowerlineLayerText(powerline);
	});
}

function stopPowerlineAnimationLoop() {
	if (powerlineAnimationFrameId !== null) {
		window.cancelAnimationFrame(powerlineAnimationFrameId);
		powerlineAnimationFrameId = null;
	}
	powerlineAnimationLastFrameMs = 0;
}

function shouldAnimatePowerlines() {
	return POWERLINE_RENDER_CONFIG.animationEnabled
		&& getSelectedMapLayerMode() === "powerlines"
		&& powerlineData.length > 0
		&& document.visibilityState === "visible";
}

function tickPowerlineAnimation(frameTimeMs) {
	if (!shouldAnimatePowerlines()) {
		stopPowerlineAnimationLoop();
		return;
	}

	if (powerlineAnimationLastFrameMs === 0) {
		powerlineAnimationLastFrameMs = frameTimeMs;
	}

	const elapsedMs = frameTimeMs - powerlineAnimationLastFrameMs;
	if (elapsedMs >= POWERLINE_RENDER_CONFIG.frameIntervalMs) {
		powerlineAnimationLastFrameMs = frameTimeMs;
		// Waehrend Leaflets CSS-Zoom-Animation (Buttons/Scroll/Pinch) die Strang-Geometrie NICHT neu setzen:
		// setLatLngs projiziert sonst jeden Frame auf den noch alten Zoom und ueberschreibt die Zoom-Transform
		// der SVG-Polylinien -> die Linien bleiben stehen und "poppen" erst am zoomend ans Ziel. map._animatingZoom
		// markiert genau dieses CSS-Zoom-Fenster; pausiert skalieren die Linien nativ mit (wie Wege/Grenzen) und
		// Leaflet re-projiziert am zoomend selbst. Bei flyTo/setView ist _animatingZoom false -> der Loop laeuft
		// normal weiter und folgt pro Frame der echten Projektion. lastFrameMs setzen wir trotzdem, damit nach
		// dem Zoom kein Zeit-Sprung im Puls entsteht.
		if (!map._animatingZoom) {
			powerlineAnimationTimeSeconds += Math.min(elapsedMs, 120) / 1000;
			refreshPowerlineLayers(powerlineAnimationTimeSeconds);
		}
	}

	powerlineAnimationFrameId = window.requestAnimationFrame(tickPowerlineAnimation);
}

function ensurePowerlineAnimationLoop() {
	if (powerlineAnimationFrameId !== null || !shouldAnimatePowerlines()) {
		return;
	}
	powerlineAnimationLastFrameMs = 0;
	powerlineAnimationFrameId = window.requestAnimationFrame(tickPowerlineAnimation);
}

const preparePowerlineData = (data) => {
	powerlineLayers.forEach((layer) => map.removeLayer(layer));
	powerlineLayers = [];
	powerlineData = data.features
		.filter((feature) => feature.geometry.type === "LineString" && feature.properties?.feature_type === "powerline")
		.map(normalizePowerlineFeature);
	powerlineData.forEach((powerline) => {
		const layer = createPowerlineLayer(powerline);
		powerlineLayers.push(layer);
	});
	syncPowerlineVisibility();
};

function applyLivePowerlineFeature(feature) {
	const publicId = feature.id || feature.properties?.public_id || "";
	const existingPowerline = findPowerlineByPublicId(publicId);
	if (existingPowerline?._layerGroup) {
		map.removeLayer(existingPowerline._layerGroup);
		powerlineLayers = powerlineLayers.filter((layer) => layer !== existingPowerline._layerGroup);
		powerlineData = powerlineData.filter((powerline) => powerline !== existingPowerline);
	}
	const powerline = normalizePowerlineFeature(feature);
	const layer = createPowerlineLayer(powerline);
	powerlineData.push(powerline);
	powerlineLayers.push(layer);
	syncPowerlineVisibility();
}

function findPowerlineByPublicId(publicId) {
	return powerlineData.find((powerline) => (powerline.id || powerline.properties?.public_id) === publicId) || null;
}

function getConnectedPowerlinesForPublicId(publicId) {
	return powerlineData.filter((powerline) => powerline.properties?.from_public_id === publicId || powerline.properties?.to_public_id === publicId);
}

function getPowerlineConnectedLocationPublicIds() {
	const publicIds = new Set();
	powerlineData.forEach((powerline) => {
		const fromPublicId = powerline.properties?.from_public_id;
		const toPublicId = powerline.properties?.to_public_id;
		if (fromPublicId) {
			publicIds.add(fromPublicId);
		}
		if (toPublicId) {
			publicIds.add(toPublicId);
		}
	});
	return publicIds;
}

function applyPowerlineFeatureResponse(powerline, feature) {
	const updatedPowerline = normalizePowerlineFeature(feature);
	powerline.geometry = updatedPowerline.geometry;
	powerline.properties = updatedPowerline.properties;
	powerline.id = updatedPowerline.id;
	refreshPowerlineLayerPopup(powerline);
	refreshPowerlineLayers();
	// Steht diese Kraftlinie gerade im Panel, muss das Gespeicherte auch dort ankommen -- sonst
	// zeigt das Panel nach dem Speichern noch den alten Namen/die alte Beschreibung.
	if (typeof window.avesmapsRefreshInfopanel === "function") {
		window.avesmapsRefreshInfopanel();
	}
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
	}
}

function clearPendingPowerlineCreation() {
	pendingPowerlineCreationStart = null;
	refreshAllLocationMarkerPopups();
	labelMarkers.forEach((entry) => refreshLabelMarkerPopup(entry));
}

function startPowerlineCreationFromEndpoint(endpoint) {
	if (!isEligiblePowerlineEndpoint(endpoint)) {
		showFeedbackToast("Kraftlinien können nur an Nodix-Orten starten.", "warning");
		return;
	}
	pendingPowerlineCreationStart = endpoint;
	refreshAllLocationMarkerPopups();
	labelMarkers.forEach((entry) => refreshLabelMarkerPopup(entry));
	showFeedbackToast(`Start-Nodix: ${endpoint.name}. Ziel-Nodix anklicken.`, "info");
}

async function completePendingPowerlineAtEndpoint(endEndpoint) {
	const startEndpoint = pendingPowerlineCreationStart;
	if (!startEndpoint || !isEligiblePowerlineEndpoint(endEndpoint) || startEndpoint.publicId === endEndpoint.publicId) {
		showFeedbackToast("Bitte zwei verschiedene Nodix-Orte verbinden.", "warning");
		return;
	}
	clearPendingPowerlineCreation();
	try {
		const result = await submitMapFeatureEdit({
			action: "create_powerline",
			from_public_id: startEndpoint.publicId,
			to_public_id: endEndpoint.publicId,
		});
		applyLivePowerlineFeature(result.feature);
		locationConnectivityIndex = null;
		updateRevisionFromEditResponse(result);
		setSelectedMapLayerMode("powerlines");
		syncPowerlineVisibility();
		showFeedbackToast(`Kraftlinie ${startEndpoint.name} -> ${endEndpoint.name} erstellt.`, "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht erstellt werden:", error);
		showFeedbackToast(error.message || "Kraftlinie konnte nicht erstellt werden.", "warning");
	}
}

// Live-Tuning der Kraftlinien-Animation ("Wabern"), nur mit ?powerlinetune=1 (oben rechts). Die rAF-Schleife
// liest POWERLINE_RENDER_CONFIG pro Frame -> Slider wirken sofort. Nur im Modus „Kraftlinien" sichtbar/aktiv.
// OK schreibt nach window.__avesmapsPowerlineTuning (zum Übernehmen als Default).
(function initPowerlineTuningPanel() {
	let on = false;
	try { on = new URLSearchParams(window.location.search).has("powerlinetune"); } catch (e) { on = false; }
	if (!on || !document.body) return;
	const cfg = (typeof POWERLINE_RENDER_CONFIG !== "undefined") ? POWERLINE_RENDER_CONFIG : null;
	if (!cfg) return;
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;right:12px;top:12px;z-index:99999;background:rgba(28,28,28,0.92);color:#fff;font:12px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);width:230px;";
	const title = document.createElement("div");
	title.textContent = "Kraftlinien-Wabern"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
	panel.appendChild(title);
	// Checkbox: Animation an/aus
	const animLabel = document.createElement("label");
	animLabel.style.cssText = "display:flex;align-items:center;gap:6px;margin:0 0 8px;cursor:pointer;";
	const animInput = document.createElement("input");
	animInput.type = "checkbox"; animInput.checked = !!cfg.animationEnabled;
	animInput.addEventListener("change", () => {
		cfg.animationEnabled = animInput.checked;
		try {
			if (animInput.checked) { if (typeof ensurePowerlineAnimationLoop === "function") ensurePowerlineAnimationLoop(); }
			else if (typeof stopPowerlineAnimationLoop === "function") { stopPowerlineAnimationLoop(); }
		} catch (e) { /* noop */ }
	});
	const animText = document.createElement("span"); animText.textContent = "Wabern an";
	animLabel.appendChild(animInput); animLabel.appendChild(animText);
	panel.appendChild(animLabel);
	const slider = (label, min, max, step, value, apply) => {
		const wrap = document.createElement("div"); wrap.style.marginBottom = "7px";
		const head = document.createElement("div"); head.style.cssText = "display:flex;justify-content:space-between;margin-bottom:2px;";
		const name = document.createElement("span"); name.textContent = label;
		const val = document.createElement("span"); val.textContent = value;
		head.appendChild(name); head.appendChild(val);
		const input = document.createElement("input");
		input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value; input.style.width = "100%";
		input.addEventListener("input", () => { val.textContent = input.value; apply(parseFloat(input.value)); });
		wrap.appendChild(head); wrap.appendChild(input);
		panel.appendChild(wrap);
	};
	slider("Amplitude (quer)", 0, 8, 0.1, cfg.tremorNormalAmplitude, (v) => { cfg.tremorNormalAmplitude = v; });
	slider("Tempo (quer)", 0, 2.5, 0.05, cfg.tremorNormalSpeed, (v) => { cfg.tremorNormalSpeed = v; });
	slider("Amplitude (längs)", 0, 3, 0.05, cfg.tremorTangentAmplitude, (v) => { cfg.tremorTangentAmplitude = v; });
	slider("Tempo (längs)", 0, 2.5, 0.05, cfg.tremorTangentSpeed, (v) => { cfg.tremorTangentSpeed = v; });
	slider("Frequenz (quer)", 0, 1.5, 0.01, cfg.tremorNormalFrequency, (v) => { cfg.tremorNormalFrequency = v; });
	slider("Störung Stärke", 0, 6, 0.1, cfg.interferenceAmplitude || 0, (v) => { cfg.interferenceAmplitude = v; });
	slider("Störung Tempo", 0, 8, 0.1, cfg.interferenceSpeed || 0, (v) => { cfg.interferenceSpeed = v; });
	slider("Segmente (Glätte)", 4, 24, 1, cfg.segmentCount, (v) => { cfg.segmentCount = v; });
	slider("Bildtakt (ms/Frame)", 12, 60, 1, cfg.frameIntervalMs, (v) => { cfg.frameIntervalMs = v; });
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		const result = {
			animationEnabled: cfg.animationEnabled,
			tremorNormalAmplitude: cfg.tremorNormalAmplitude,
			tremorNormalSpeed: cfg.tremorNormalSpeed,
			tremorTangentAmplitude: cfg.tremorTangentAmplitude,
			tremorTangentSpeed: cfg.tremorTangentSpeed,
			tremorNormalFrequency: cfg.tremorNormalFrequency,
			interferenceAmplitude: cfg.interferenceAmplitude,
			interferenceSpeed: cfg.interferenceSpeed,
			segmentCount: cfg.segmentCount,
			frameIntervalMs: cfg.frameIntervalMs,
		};
		window.__avesmapsPowerlineTuning = result;
		console.log("[Kraftlinien-Wabern] " + JSON.stringify(result));
		okBtn.textContent = "✓ gemerkt"; setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
	});
	panel.appendChild(okBtn);
	const hint = document.createElement("div");
	hint.textContent = "Modus Kraftlinien wählen, damit die Animation läuft."; hint.style.cssText = "opacity:0.6;margin-top:6px;";
	panel.appendChild(hint);
	document.body.appendChild(panel);
})();

async function deletePowerlineFeature(powerline) {
	if (!powerline) {
		return;
	}

	if (!window.confirm(`${getPowerlineDisplayName(powerline)} wirklich löschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: getPowerlinePublicId(powerline),
		});
		map.removeLayer(powerline._layerGroup);
		powerlineLayers = powerlineLayers.filter((layer) => layer !== powerline._layerGroup);
		powerlineData = powerlineData.filter((entry) => entry !== powerline);
		locationConnectivityIndex = null;
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPowerlineEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Kraftlinie gelöscht.", "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht gelöscht werden:", error);
		showFeedbackToast(error.message || "Kraftlinie konnte nicht gelöscht werden.", "warning");
	}
}
