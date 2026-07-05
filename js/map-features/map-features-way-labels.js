// Way-Labels (Kanal A): wiki-zugewiesene Wege (properties.wiki_path.wiki_key) werden als GANZER Weg
// beschriftet statt pro Segment — sichtbare Segmente werden über ihre Endpunkte zu Ketten verkettet
// (Verzweigungen = Kettenschnitt), der Wegname wird dann alle ~WAY_LABEL_SCREEN_INTERVAL_PX
// Bildschirm-Pixel entlang jeder Kette gezeichnet (Integration in
// map-features-path-label-canvas-overlay.js). Diese Datei enthält NUR die reinen, testbaren Helfer;
// Projektion/Zeichnen bleibt im Overlay (siehe tools/paths/test-way-labels.mjs).

// Rundet eine [x,y]-Koordinate auf 4 Nachkommastellen -> stabiler Verkettungs-Key (Toleranz gegen
// Fließkomma-Rauschen zwischen Segment-Endpunkten, die geometrisch denselben Knoten meinen).
function wayLabelEndpointKey(coord) {
	const x = Number(coord?.[0]);
	const y = Number(coord?.[1]);
	return `${x.toFixed(4)}:${y.toFixed(4)}`;
}

// Verkettet Weg-Segmente über ihre Endpunkte zu geordneten Ketten (fortlaufende Beschriftungs-
// Läufe). Eingabe: [{id, coordinates:[[x,y],...]}, ...] (rohe Segment-Geometrie, ein Eintrag pro
// sichtbarem Segment DESSELBEN Wegs). Ausgabe: Array von Ketten, jede Kette ein geordnetes Array
// von {id, coordinates, reversed}. Regeln:
//   - Adjazenz über die (gerundeten) Endpunkt-Keys beider Segment-Enden.
//   - Ketten starten an Endpunkten mit Grad 1 (offenes Ende); bleiben nur Grad-2+-Knoten übrig
//     (reine Schleife), startet die Kette an einem beliebigen unbesuchten Segment.
//   - An einem Knoten mit Grad > 2 (Verzweigung) ENDET die Kette dort -- sie läuft nicht durch die
//     Verzweigung hindurch (Branch = Schnitt). Jedes Segment wird genau einmal verwendet.
//   - Einzelne, isolierte Segmente (kein passender Nachbar bzw. nur über eine Verzweigung
//     erreichbar) werden zu Ein-Segment-Ketten.
// Pur -- keine Globals, kein DOM.
function buildWayLabelChains(segments) {
	const list = Array.isArray(segments) ? segments : [];
	if (!list.length) {
		return [];
	}

	// Für jedes Segment die zwei Endpunkt-Keys vorab berechnen.
	const endpointsBySegment = list.map((segment) => {
		const coords = segment?.coordinates || [];
		const start = coords[0];
		const end = coords[coords.length - 1];
		return { startKey: wayLabelEndpointKey(start), endKey: wayLabelEndpointKey(end) };
	});

	// Adjazenz: Endpunkt-Key -> Liste von {segmentIndex, atStart} (welches Ende dort liegt).
	const touchesByKey = new Map();
	const addTouch = (key, segmentIndex, atStart) => {
		if (!touchesByKey.has(key)) {
			touchesByKey.set(key, []);
		}
		touchesByKey.get(key).push({ segmentIndex, atStart });
	};
	endpointsBySegment.forEach((ep, i) => {
		addTouch(ep.startKey, i, true);
		addTouch(ep.endKey, i, false);
	});
	const degreeOf = (key) => (touchesByKey.get(key) || []).length;

	const used = new Array(list.length).fill(false);
	const chains = [];

	// Setzt an einem gegebenen (unbenutzten) Segment + Richtung an und läuft vorwärts, solange am
	// jeweils neuen Kettenende genau EIN weiteres unbenutztes Segment anschließt (Grad <= 2 dort).
	function walkFrom(startSegmentIndex, startReversed) {
		const chain = [];
		let currentIndex = startSegmentIndex;
		let currentReversed = startReversed;
		for (;;) {
			used[currentIndex] = true;
			const coords = list[currentIndex]?.coordinates || [];
			chain.push({ id: list[currentIndex].id, coordinates: coords, reversed: currentReversed });

			const ep = endpointsBySegment[currentIndex];
			const trailingKey = currentReversed ? ep.startKey : ep.endKey;
			// Verzweigung (Grad > 2) -> Kette endet hier, nicht hindurchlaufen.
			if (degreeOf(trailingKey) > 2) {
				break;
			}
			const touches = touchesByKey.get(trailingKey) || [];
			const next = touches.find((t) => !used[t.segmentIndex]);
			if (!next) {
				break; // offenes Ende oder Nachbar bereits verbraucht
			}
			// Nächstes Segment muss so orientiert werden, dass es am trailingKey ANFÄNGT.
			currentIndex = next.segmentIndex;
			currentReversed = !next.atStart; // atStart=true -> Segment beginnt bereits dort -> nicht umkehren
		}
		return chain;
	}

	// Pass 1: Ketten an offenen Enden (Grad 1) starten -- ergibt die "natürliche" Leserichtung.
	for (let i = 0; i < list.length; i += 1) {
		if (used[i]) {
			continue;
		}
		const ep = endpointsBySegment[i];
		if (degreeOf(ep.startKey) === 1) {
			chains.push(walkFrom(i, false));
		} else if (degreeOf(ep.endKey) === 1) {
			chains.push(walkFrom(i, true));
		}
	}

	// Pass 2: übrige unbesuchte Segmente (reine Schleifen ohne Grad-1-Ende, oder Segmente, die nur
	// über eine Verzweigung erreichbar sind) -- an einem beliebigen unbesuchten Segment starten.
	for (let i = 0; i < list.length; i += 1) {
		if (!used[i]) {
			chains.push(walkFrom(i, false));
		}
	}

	return chains;
}

// Berechnet Mittelpunkt-Offsets (px entlang der Kette) für wiederholte Label-Platzierungen im
// festen Bildschirm-Intervall. totalLenPx = Gesamtlänge der Kette in Bildschirm-Pixeln, intervalPx
// = Ziel-Abstand zwischen Label-Mitten, textLenPx = gemessene Breite des Namens (px). Regeln:
//   - Kette kürzer als textLenPx*1.15 (zu wenig Luft für auch nur ein Label) -> [].
//   - Kette kürzer als intervalPx*1.5 (zu kurz für mehr als ein Label) -> EIN Label mittig.
//   - Sonst: Zentren im intervalPx-Abstand, erstes bei intervalPx/2, jeweils mit Spanne
//     [c - textLenPx/2, c + textLenPx/2] innerhalb von [8, totalLenPx - 8] gehalten.
// Pur.
function computeWayLabelIntervalOffsets(totalLenPx, intervalPx, textLenPx) {
	const total = Number(totalLenPx) || 0;
	const interval = Number(intervalPx) || 0;
	const textLen = Number(textLenPx) || 0;

	if (total < textLen * 1.15) {
		return [];
	}
	if (interval <= 0 || total < interval * 1.5) {
		return [total / 2];
	}

	const halfText = textLen / 2;
	const lowBound = 8 + halfText;
	const highBound = total - 8 - halfText;
	const offsets = [];
	for (let center = interval / 2; center <= total; center += interval) {
		offsets.push(Math.min(Math.max(center, lowBound), highBound));
	}
	return offsets;
}

// Ist dieser Pfad für Kanal-A-Way-Labels zulässig? Wie isPathLabelVisibleAtCurrentZoom
// (map-features-path-labels.js), aber OHNE die show_label-Bedingung (Kanal A ignoriert
// show_label bewusst -- der Weg wird als Ganzes beschriftet) und ZUSÄTZLICH nur, wenn ein
// Wiki-Weg zugewiesen ist (wiki_path.wiki_key). Browser-only (map/$/Globals) -- kein reiner
// Helfer, daher nicht Teil der extractFunction-Unit-Tests (wie isPathLabelVisibleAtCurrentZoom
// selbst auch nicht unit-getestet ist).
function isWayLabelEligible(path) {
	if (!path?.properties?.wiki_path?.wiki_key) {
		return false;
	}
	// Kraftlinien-Modus: keine Wege-/Fluss-Namen (Magiersicht; nur Kraftlinien-Namen werden gezeichnet).
	if (typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "powerlines") {
		return false;
	}
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const isRiver = pathSubtype === "Flussweg" || pathSubtype === "Seeweg";
	if (isRiver) {
		if (!pathRiverLabelsVisible) {
			return false;
		}
	} else if (typeof $ === "function" && !$("#togglePaths").is(":checked")) {
		// Wege-/Straßen-Labels folgen weiterhin ihrer Pfad-Sichtbarkeit (#togglePaths).
		return false;
	}
	// Wie Straßen-/Fluss-Labels: erst ab dorf.minZoom (Zoom 4) zeigen.
	const minZoom = LOCATION_NAME_LABEL_CONFIG.dorf.minZoom;
	return map.getZoom() >= minZoom;
}
