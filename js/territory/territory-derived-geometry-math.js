// Derived-boundary geometry computation (no UI side effects): union of source
// geometries, contested-split, and inner-boundary edge collection/stitching into a
// MultiLineString. Split out of territory-derived-geometry-editor.js (M5 god-file
// split). Plain global functions called at runtime; shared state referenced cross-script.

// Reine Union ohne UI-Seiteneffekte. Liefert null, wenn keine Quellflächen vorliegen.
// Dies ist die EINE Berechnungslogik, die Vorschau, Save-Hook und Kaskade gemeinsam nutzen.
function unionDerivedSources(response) {
	const sourceGeometries = Array.isArray(response?.source_geometries) ? response.source_geometries : [];
	const clippingGeometries = sourceGeometries
		.map((entry) => geoJsonGeometryToClippingMultiPolygon(entry.geometry))
		.filter((geometry) => Array.isArray(geometry) && geometry.length > 0);

	if (clippingGeometries.length < 1) {
		return null;
	}

	const unionGeometry = normalizeClippingMultiPolygon(
		window.polygonClipping.union(...clippingGeometries),
		"Automatische Außengrenze"
	);
	const geometry = clippingMultiPolygonToGeoJson(unionGeometry);
	return {
		geometry,
		labelCenter: readDerivedGeometryLabelCenter(geometry),
		sourceCount: sourceGeometries.length,
	};
}

// Umstrittene-Gebiete-Split -- Reihenfolge HEILIG: erst Union+Grenzen, DANN schneiden. Die umstrittenen
// Baronien werden nach ihrer ANSPRUCHSTELLER-MENGE gruppiert (sources.contested_claimants) und je Gruppe
// VEREINT -> eine einheitliche, durchgehende Schraffur (Reichsfarbe + Anspruchsteller; Besitzerfarbe setzt
// der Server aufs Reich). Restflaeche = Union MINUS alle Konflikt-Baronien (Loecher -> Terrain). Un-
// umstrittene Baronien sind NICHT in den Stuecken -> keine Streifen, normale Farbe. Liefert {fillRemainder,
// contestedPieces} oder beides null (kein Konflikt). Beruehrt NIE Union/Innengrenzen (schon berechnet).
function computeContestedDerivedSplit(sourcesResponse, unionGeometryGeoJson) {
	const empty = { fillRemainder: null, contestedPieces: null };
	const contestedKeys = new Set(Array.isArray(sourcesResponse?.contested_territory_public_ids) ? sourcesResponse.contested_territory_public_ids : []);
	if (contestedKeys.size < 1 || !window.polygonClipping) return empty;
	const claimantsByTerritory = (sourcesResponse && sourcesResponse.contested_claimants && typeof sourcesResponse.contested_claimants === "object") ? sourcesResponse.contested_claimants : {};
	const sourceGeometries = Array.isArray(sourcesResponse?.source_geometries) ? sourcesResponse.source_geometries : [];
	// Gruppieren nach Anspruchsteller-Menge: key = sortierte claimant-public_ids.
	const groups = new Map(); // key -> { rep, name, clippings: [] }
	const allContestedClipping = [];
	sourceGeometries.forEach((entry) => {
		if (!entry || !contestedKeys.has(entry.territory_public_id)) return;
		const clip = geoJsonGeometryToClippingMultiPolygon(entry.geometry);
		if (!Array.isArray(clip) || clip.length < 1) return;
		allContestedClipping.push(clip);
		const claimants = Array.isArray(claimantsByTerritory[entry.territory_public_id]) ? claimantsByTerritory[entry.territory_public_id].slice().sort() : [];
		const key = claimants.join("|");
		if (!groups.has(key)) groups.set(key, { rep: entry.territory_public_id, name: entry.territory_name || "", clippings: [] });
		groups.get(key).clippings.push(clip);
	});
	if (groups.size < 1) return empty;
	// Je Gruppe die Baronie-Flaechen VEREINEN -> ein Stueck mit durchgehender Schraffur. Repraesentant-
	// territory_public_id: der Server holt darueber die Parteien (alle in der Gruppe teilen dieselben).
	const contestedPieces = [];
	groups.forEach((grp) => {
		let merged = null;
		try {
			const u = grp.clippings.length === 1 ? grp.clippings[0] : window.polygonClipping.union(...grp.clippings);
			merged = clippingMultiPolygonToGeoJson(normalizeClippingMultiPolygon(u, "Konflikt-Flaeche"));
		} catch (error) {
			console.warn("Konflikt-Gruppe Union fehlgeschlagen:", error);
			try { merged = clippingMultiPolygonToGeoJson(normalizeClippingMultiPolygon(grp.clippings[0], "Konflikt-Flaeche")); } catch (e2) { merged = null; }
		}
		if (merged) contestedPieces.push({ territory_public_id: grp.rep, name: grp.name, geometry: merged });
	});
	if (contestedPieces.length < 1) return empty;
	// Restflaeche = Union MINUS alle Konflikt-Baronien. Leer, wenn ALLE Baronien umstritten sind (dann
	// ganz Schraffur/Terrain, keine normale Fuellung). contested_pieces bleiben in jedem Fall erhalten.
	const unionClip = geoJsonGeometryToClippingMultiPolygon(unionGeometryGeoJson);
	let fillRemainder = { type: "MultiPolygon", coordinates: [] };
	try {
		if (Array.isArray(unionClip) && unionClip.length > 0) {
			const remainderClip = window.polygonClipping.difference(unionClip, ...allContestedClipping);
			if (Array.isArray(remainderClip) && remainderClip.length > 0) {
				fillRemainder = clippingMultiPolygonToGeoJson(normalizeClippingMultiPolygon(remainderClip, "Restfläche"));
			}
		}
	} catch (error) {
		console.warn("Konflikt-Split: Restflaeche leer/fehlgeschlagen -> Reich ganz umstritten:", error);
		fillRemainder = { type: "MultiPolygon", coordinates: [] };
	}
	return { fillRemainder, contestedPieces };
}

function buildDerivedBoundaryFromSourceResponse(response) {
	const result = unionDerivedSources(response);
	if (!result) {
		clearDerivedGeometryPreviewLayer();
		setDerivedGeometryThumbnail(null);
		throw new Error("Keine Unterflächen für eine automatische Außengrenze gefunden.");
	}
	return result;
}

// ===== Innengrenzen (Plan-Schritt 1): deduppte Trennlinien der DIREKTEN Kinder =====
// Genau 1 Rekursionstiefe: pro direktem Kind dessen saubere Außenkontur (Union ALLER
// seiner Blatt-Quellen, beliebig tief -> tiefere Nähte werden von der Union aufgelöst),
// dann Segment-Dedup (eine Kante, die sich genau zwei Kinder teilen = Innengrenze) und
// zu Linienzügen gestitcht. Ergebnis = GeoJSON MultiLineString (oder null, wenn < 2
// Kinder oder keine geteilten Kanten). Rendering respektiert separat das Innen-Häkchen.
const INNER_BOUNDARY_SNAP_DECIMALS = 3;

function roundInnerBoundaryCoordinate(value) {
	const factor = Math.pow(10, INNER_BOUNDARY_SNAP_DECIMALS);
	return Math.round(Number(value) * factor) / factor;
}

function innerBoundaryPointKey(point) {
	return roundInnerBoundaryCoordinate(point[0]) + "," + roundInnerBoundaryCoordinate(point[1]);
}

// Alle Ring-Kanten einer GeoJSON-Polygon/MultiPolygon-Geometrie als [a, b]-Punktpaare.
function collectInnerBoundaryEdges(geometry) {
	const polygons = geometry?.type === "Polygon"
		? [geometry.coordinates]
		: geometry?.type === "MultiPolygon"
			? geometry.coordinates
			: [];
	const edges = [];
	polygons.forEach((rings) => (rings || []).forEach((ring) => {
		for (let i = 0; i + 1 < ring.length; i += 1) {
			edges.push([ring[i], ring[i + 1]]);
		}
	}));
	return edges;
}

// Greedy-Stitch: geteilte Kanten (jeweils [a, b], bereits gerundet) zu möglichst langen
// Linienzügen verbinden -> saubere, durchgehende Strich-Phase beim Rendern.
function stitchInnerBoundaryEdges(edges) {
	const keyOf = (point) => point[0] + "," + point[1];
	const adjacency = new Map();
	edges.forEach((edge, index) => {
		const ka = keyOf(edge[0]);
		const kb = keyOf(edge[1]);
		if (!adjacency.has(ka)) adjacency.set(ka, []);
		if (!adjacency.has(kb)) adjacency.set(kb, []);
		adjacency.get(ka).push({ index, to: edge[1], toKey: kb });
		adjacency.get(kb).push({ index, to: edge[0], toKey: ka });
	});

	const used = new Array(edges.length).fill(false);
	const lines = [];
	for (let start = 0; start < edges.length; start += 1) {
		if (used[start]) continue;
		used[start] = true;
		const line = [edges[start][0], edges[start][1]];
		let endKey = keyOf(edges[start][1]);
		for (;;) {
			const next = (adjacency.get(endKey) || []).find((entry) => !used[entry.index]);
			if (!next) break;
			used[next.index] = true;
			line.push(next.to);
			endKey = next.toKey;
		}
		let startKey = keyOf(edges[start][0]);
		for (;;) {
			const prev = (adjacency.get(startKey) || []).find((entry) => !used[entry.index]);
			if (!prev) break;
			used[prev.index] = true;
			line.unshift(prev.to);
			startKey = prev.toKey;
		}
		lines.push(line);
	}
	return lines;
}

// Berechnet die Innengrenzen-MultiLineString eines Ziels aus den Außenkonturen seiner
// DIREKTEN Kinder (plan.children_index) PLUS der Eigenflaeche des Ziels. Liefert null bei < 2 Teilnehmern / keinen geteilten
// Kanten. Pro Kind: Quellen holen + unioncen (Option A) -> saubere Außenkontur.
async function computeInnerBoundaryMultiLineString(targetPublicId, plan) {
	const index = plan && plan.children_index ? plan.children_index : null;
	const childPublicIds = index && Array.isArray(index[targetPublicId]) ? index[targetPublicId] : [];
	const childOutlines = [];

	// Teilnehmer einer Innengrenze sind die Geschwister-Flaechen EINER Ebene: die EIGENE Flaeche
	// des Ziels (falls es eine eigene Geometrie hat) UND die Aussenkontur jedes Kindes mit Geometrie.
	// Dadurch bildet auch ein Knoten MIT Eigenflaeche und nur EINEM Kind eine Innengrenze (Trennlinie
	// Eigenflaeche <-> Kind) statt erst ab zwei Kindern. Nur Knoten MIT Geometrie nehmen teil -> keine
	// Seiteneffekte durch geometrielose Knoten. Frueher: Abbruch bei < 2 Kindern (Guard jetzt unten
	// über childOutlines.length, nachdem Eigenflaeche + Kinder gesammelt sind).
	try {
		const ownSources = await politicalTerritoryRepository.getDerivedGeometrySources(targetPublicId);
		const ownEntries = (Array.isArray(ownSources?.source_geometries) ? ownSources.source_geometries : [])
			.filter((entry) => String(entry?.territory_public_id || "") === String(targetPublicId));
		if (ownEntries.length > 0) {
			const ownResult = unionDerivedSources({ source_geometries: ownEntries });
			if (ownResult && ownResult.geometry) {
				childOutlines.push(ownResult.geometry);
			}
		}
	} catch (error) {
		console.warn("Innengrenzen: Eigenflaeche des Ziels fehlgeschlagen für", targetPublicId, error);
	}
	for (const childPublicId of childPublicIds) {
		try {
			const sources = await politicalTerritoryRepository.getDerivedGeometrySources(childPublicId);
			const result = unionDerivedSources(sources);
			if (result && result.geometry) {
				childOutlines.push(result.geometry);
			}
		} catch (error) {
			console.warn("Innengrenzen: Kind-Außenkontur fehlgeschlagen für", childPublicId, error);
		}
	}
	if (childOutlines.length < 2) {
		return null;
	}

	// Segment-Dedup: jede Kante normalisiert zählen; Kanten mit Zähler === 2 sind von
	// zwei Kindern geteilt = echte Innengrenze. Zähler === 1 = Außenrand (verwerfen).
	const edgeCounts = new Map();
	const edgeCoords = new Map();
	childOutlines.forEach((geometry) => {
		collectInnerBoundaryEdges(geometry).forEach(([a, b]) => {
			const keyA = innerBoundaryPointKey(a);
			const keyB = innerBoundaryPointKey(b);
			if (keyA === keyB) {
				return; // gerundet zusammengefallene Null-Kante
			}
			const edgeKey = keyA < keyB ? keyA + "|" + keyB : keyB + "|" + keyA;
			edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
			if (!edgeCoords.has(edgeKey)) {
				edgeCoords.set(edgeKey, [
					[roundInnerBoundaryCoordinate(a[0]), roundInnerBoundaryCoordinate(a[1])],
					[roundInnerBoundaryCoordinate(b[0]), roundInnerBoundaryCoordinate(b[1])],
				]);
			}
		});
	});

	const sharedEdges = [];
	edgeCounts.forEach((count, edgeKey) => {
		if (count === 2) {
			sharedEdges.push(edgeCoords.get(edgeKey));
		}
	});
	if (sharedEdges.length < 1) {
		return null;
	}

	const lineStrings = stitchInnerBoundaryEdges(sharedEdges).filter((line) => Array.isArray(line) && line.length >= 2);
	if (lineStrings.length < 1) {
		return null;
	}
	return { type: "MultiLineString", coordinates: lineStrings };
}
