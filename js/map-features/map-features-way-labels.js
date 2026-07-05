// Way-Labels (Kanal A): wiki-zugewiesene Wege (properties.wiki_path.wiki_key) werden als GANZER Weg
// beschriftet statt pro Segment — sichtbare Segmente werden über ihre Endpunkte zu Ketten verkettet
// (Verzweigungen = Kettenschnitt), der Wegname wird dann alle ~WAY_LABEL_SCREEN_INTERVAL_PX
// Bildschirm-Pixel entlang jeder Kette gezeichnet (Integration in
// map-features-path-label-canvas-overlay.js). Diese Datei enthält NUR die reinen, testbaren Helfer;
// Projektion/Zeichnen bleibt im Overlay (siehe tools/paths/test-way-labels.mjs).

// Toleranz (Karteneinheiten) für Phase 2 von buildWayLabelChains (Lücken-Brücken zwischen freien
// Ketten-Enden). Gemessen auf Produktionsdaten: Fließkomma-Rauschen ~0.001, kürzestes Segment 2.32,
// mediane Segmentlänge 7.84 (Kronstraße: 10 von 24 Segmenten KÜRZER als 7), echte Ortsstoß-Lücken
// bis ~6.2. Deshalb darf NICHT pauschal jeder Endpunkt auf 7 Einheiten gesnappt werden: Segmente
// kürzer als eps kollabieren dabei zu Self-Loops (eigene zwei Endpunkte = ein Knoten, Grad +2) und
// Orts-Knoten schlucken 3+ Enden (Grad >= 3 -> Verzweigungsschnitt überall; live: 40 Ketten aus 50
// Segmenten). Stattdessen: Phase 1 verkettet strikt (0.01-Raster, weit über dem Rauschen und weit
// unter der Mindest-Segmentlänge), Phase 2 überbrückt nur noch OFFENE Ketten-Enden bis zu dieser
// Distanz.
const WAY_LABEL_CHAIN_GAP_EPS = 7;

// Rundet eine [x,y]-Koordinate auf 2 Nachkommastellen -> stabiler Verkettungs-Key für Phase 1
// (striktes Verketten). 0.01-Raster: das gemessene Fließkomma-Rauschen (~0.001) liegt weit
// darunter (rundet auf denselben Key), die kürzeste Segmentlänge (2.32) weit darüber (kein
// Self-Merge möglich).
function wayLabelEndpointKey(coord) {
	const x = Number(coord?.[0]);
	const y = Number(coord?.[1]);
	return `${x.toFixed(2)}:${y.toFixed(2)}`;
}

// Verkettet Weg-Segmente in ZWEI Phasen zu geordneten Ketten (fortlaufende Beschriftungs-Läufe).
// Eingabe: [{id, coordinates:[[x,y],...]}, ...] (rohe Segment-Geometrie, ein Eintrag pro
// sichtbarem Segment DESSELBEN Wegs). Ausgabe: Array von Ketten, jede Kette ein geordnetes Array
// von {id, coordinates, reversed}.
// Phase 1 (striktes Verketten):
//   - Adjazenz über die (auf 2 Nachkommastellen gerundeten) Endpunkt-Keys beider Segment-Enden.
//   - Ketten starten an Endpunkten mit Grad 1 (offenes Ende); bleiben nur Grad-2+-Knoten übrig
//     (reine Schleife), startet die Kette an einem beliebigen unbesuchten Segment.
//   - An einem Knoten mit Grad > 2 (Verzweigung) ENDET die Kette dort -- sie läuft nicht durch die
//     Verzweigung hindurch (Branch = Schnitt). Jedes Segment wird genau einmal verwendet.
// Phase 2 (Lücken-Brücken, handgezeichnete Ortsstoß-Lücken):
//   - Freie Enden = Ketten-Außenenden, deren Phase-1-Knoten Grad 1 hat (echt offene Enden).
//     Verzweigungs-Enden (Grad > 2) sind NICHT frei -- eine Brücke dort würde den bewussten
//     Verzweigungsschnitt rückgängig machen.
//   - Iterativ wird das global NÄCHSTE Paar freier Enden VERSCHIEDENER Ketten mit euklidischem
//     Abstand <= eps (Default WAY_LABEL_CHAIN_GAP_EPS) zu einer Kette verschmolzen (bei Bedarf
//     wird eine Kette gedreht, damit Ende->Anfang anschließt); die Außenenden der verschmolzenen
//     Kette sind die neuen freien Enden. Nie eine Kette mit sich selbst verbrücken (kein
//     künstlicher Ringschluss). O(k^2) pro Iteration, k = Ketten EINES Wegs (<= wenige Dutzend).
// Pur -- keine Globals, kein DOM.
function buildWayLabelChains(segments, eps) {
	const list = Array.isArray(segments) ? segments : [];
	if (!list.length) {
		return [];
	}
	const bridgeEps = Number.isFinite(eps) && eps > 0 ? eps : WAY_LABEL_CHAIN_GAP_EPS;

	// ===== Phase 1: striktes Verketten über (gerundet) exakt geteilte Endpunkte =====

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
	let chains = [];

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

	// ===== Phase 2: Lücken-Brücken zwischen freien (offenen) Ketten-Enden =====

	// Kette umdrehen: Einträge in umgekehrter Reihenfolge, jedes reversed-Flag gekippt.
	const reverseChain = (chain) => chain.slice().reverse().map((entry) => ({
		id: entry.id,
		coordinates: entry.coordinates,
		reversed: !entry.reversed,
	}));

	// Die beiden Außen-Endpunkte einer Kette (respektiert reversed): start = führender Punkt des
	// ersten Eintrags, end = schließender Punkt des letzten Eintrags.
	const chainOuterEnds = (chain) => {
		const firstEntry = chain[0];
		const firstCoords = firstEntry.coordinates;
		const lastEntry = chain[chain.length - 1];
		const lastCoords = lastEntry.coordinates;
		return {
			start: firstEntry.reversed ? firstCoords[firstCoords.length - 1] : firstCoords[0],
			end: lastEntry.reversed ? lastCoords[0] : lastCoords[lastCoords.length - 1],
		};
	};

	for (;;) {
		// Freie Enden einsammeln: nur Außenenden, deren Phase-1-Knoten Grad 1 hat (echt offen).
		// Verzweigungs-Enden (Grad > 2) bleiben geschnitten; Ring-Schlusspunkte (Grad 2) scheiden
		// zusätzlich über die "verschiedene Ketten"-Bedingung unten aus.
		const freeEnds = [];
		chains.forEach((chain, chainIndex) => {
			const ends = chainOuterEnds(chain);
			[["start", ends.start], ["end", ends.end]].forEach(([which, pt]) => {
				if (degreeOf(wayLabelEndpointKey(pt)) === 1) {
					freeEnds.push({ chainIndex, which, pt });
				}
			});
		});

		// Global nächstes Paar freier Enden VERSCHIEDENER Ketten innerhalb bridgeEps suchen.
		let best = null;
		for (let a = 0; a < freeEnds.length; a += 1) {
			for (let b = a + 1; b < freeEnds.length; b += 1) {
				const endA = freeEnds[a];
				const endB = freeEnds[b];
				if (endA.chainIndex === endB.chainIndex) {
					continue; // nie eine Kette mit sich selbst verbrücken (kein künstlicher Ringschluss)
				}
				const d = Math.hypot(endA.pt[0] - endB.pt[0], endA.pt[1] - endB.pt[1]);
				if (d <= bridgeEps && (!best || d < best.dist)) {
					best = { a: endA, b: endB, dist: d };
				}
			}
		}
		if (!best) {
			break;
		}

		// Verschmelzen: so orientieren, dass die beiden gefundenen Enden Ende->Anfang aneinanderstoßen;
		// die verbrückten Enden werden dadurch innere Gelenke, die Außenenden der neuen Kette sind die
		// bisherigen Gegen-Enden (und damit die freien Enden der nächsten Iteration).
		const chainA = chains[best.a.chainIndex];
		const chainB = chains[best.b.chainIndex];
		let mergedChain;
		if (best.a.which === "end" && best.b.which === "start") {
			mergedChain = chainA.concat(chainB);
		} else if (best.a.which === "end" && best.b.which === "end") {
			mergedChain = chainA.concat(reverseChain(chainB));
		} else if (best.a.which === "start" && best.b.which === "start") {
			mergedChain = reverseChain(chainA).concat(chainB);
		} else {
			// best.a.which === "start" && best.b.which === "end"
			mergedChain = chainB.concat(chainA);
		}
		chains = chains.filter((_, idx) => idx !== best.a.chainIndex && idx !== best.b.chainIndex);
		chains.push(mergedChain);
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

// PERF: baut EINMAL pro Redraw die Werte, die isWayLabelEligible sonst pro Pfad neu abfragen würde
// (getSelectedMapLayerMode()/jQuery-Toggle-Lookup/map.getZoom() -- bei ~5000 Pfaden pro Redraw sonst
// ~5000-faches Neu-Abfragen derselben Werte). Gleiches Muster wie currentPathVisibilityContext()
// (map-features-display-mode.js). Browser-only -- kein reiner Helfer, daher wie isWayLabelEligible
// selbst nicht Teil der extractFunction-Unit-Tests.
function buildWayLabelEligibilityContext() {
	return {
		powerlines: typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "powerlines",
		pathsToggle: typeof $ === "function" ? $("#togglePaths").is(":checked") : true,
		riverLabels: pathRiverLabelsVisible,
		zoomOk: map.getZoom() >= LOCATION_NAME_LABEL_CONFIG.dorf.minZoom,
	};
}

// Ist dieser Pfad für Kanal-A-Way-Labels zulässig? Wie isPathLabelVisibleAtCurrentZoom
// (map-features-path-labels.js), aber OHNE die show_label-Bedingung (Kanal A ignoriert
// show_label bewusst -- der Weg wird als Ganzes beschriftet) und ZUSÄTZLICH nur, wenn ein
// Wiki-Weg zugewiesen ist (wiki_path.wiki_key). ctx = buildWayLabelEligibilityContext(), einmal pro
// Redraw gebaut (siehe dort) -- hier bleiben nur die PRO-Pfad-Teile: wiki_key-Prüfung und die
// Fluss-vs-Straße-Weiche (welcher ctx-Toggle zählt). Browser-only (map/$/Globals) -- kein reiner
// Helfer, daher nicht Teil der extractFunction-Unit-Tests (wie isPathLabelVisibleAtCurrentZoom
// selbst auch nicht unit-getestet ist).
function isWayLabelEligible(path, ctx) {
	if (!path?.properties?.wiki_path?.wiki_key) {
		return false;
	}
	// Kraftlinien-Modus: keine Wege-/Fluss-Namen (Magiersicht; nur Kraftlinien-Namen werden gezeichnet).
	if (ctx.powerlines) {
		return false;
	}
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const isRiver = pathSubtype === "Flussweg" || pathSubtype === "Seeweg";
	if (isRiver) {
		if (!ctx.riverLabels) {
			return false;
		}
	} else if (!ctx.pathsToggle) {
		// Wege-/Straßen-Labels folgen weiterhin ihrer Pfad-Sichtbarkeit (#togglePaths).
		return false;
	}
	// Wie Straßen-/Fluss-Labels: erst ab dorf.minZoom (Zoom 4) zeigen.
	return ctx.zoomOk;
}
