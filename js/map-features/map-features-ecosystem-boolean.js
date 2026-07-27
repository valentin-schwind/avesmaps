// Landschaften — boolesche Operationen auf Flächen (verschmelzen, abziehen, schneiden).
//
// 🔴 WARUM DAS HIER STEHT UND NICHT DEN TERRITORIEN-KERN RUFT. `calculateRegionBooleanGeometry`
// (map-features-region-boolean-geometry.js) rechnet dasselbe und wäre die naheliegende Wiederverwendung
// — sie ruft am Ende aber `debugRegionBooleanOperation`, und das schickt unter `?debugMap` einen POST
// an den POLITISCHEN Endpunkt (`submitPoliticalTerritoryEdit`). Eine Landschaftsoperation, die dem
// Herrschaftsgebiete-Modell schreibt, verstösst gegen Regel 1 des Hauptplans — schmal, aber echt.
//
// Was NICHT abgeschrieben wird: die Verschneidung selbst. Die kommt aus derselben Bibliothek
// (`window.polygonClipping`), es gibt keine zweite Fassung davon. Abgeschrieben sind drei
// Ungleichungen zur Plausibilitätsprüfung — und die prüfen hier gegen `ecosystemGeometryArea`, die
// eigene, schon getestete Flächenfunktion, statt gegen die politische Kopie.
//
// 💣 ALLES HIER MUSS MULTIPOLYGONE VERTRAGEN, in beide Richtungen. Eine Vereinigung zweier getrennter
// Flächen ERZEUGT eine Exklave, ein Abzug mitten hinein ERZEUGT eine Enklave, ein Schnitt quer
// hindurch ZERLEGT eine Fläche in zwei. Der Server nimmt das an (owner decision 1: „a single area may
// itself be a MultiPolygon", api/_internal/app/ecosystem.php:346), und der Unit-Test daneben fährt
// genau diese vier Fälle plus den Rückweg ab.

"use strict";

// Die Reihenfolge ist die des Kontextmenüs. „difference" zieht das Ziel von der Quelle ab.
const ECOSYSTEM_BOOLEAN_OPERATIONS = [
	{ operation: "union", label: "Mit anderer Fläche vereinigen" },
	{ operation: "difference", label: "Von anderer Fläche ausschneiden" },
	{ operation: "difference-keep-target", label: "Ausschneiden und andere behalten" },
	{ operation: "intersection", label: "Schnittmenge mit anderer Fläche" },
];

// 🔴 Vereinigung und einfacher Abzug fressen ihr Ziel: bei der Vereinigung gäbe es die verschmolzene
// Form sonst zweimal, beim Abzug ist das Ziel die Schablone und meist ein Wegwerf-Umriss.
// `difference-keep-target` ist die Variante, die den See stehen lässt, aus dem der Wald geschnitten
// wurde — dieselbe Unterscheidung wie bei den Territorien.
function ecosystemBooleanConsumesTarget(operation) {
	return operation === "union" || operation === "difference";
}

// GeoJSON Polygon|MultiPolygon -> die Liste von Teilen, die polygon-clipping erwartet. Es ist exakt
// dieselbe Form, deshalb reicht der vorhandene Zerleger.
function ecosystemGeometryToClipping(geometry, label) {
	const parts = ecosystemGeometryParts(geometry);
	if (!Array.isArray(parts) || parts.length === 0) {
		throw new Error(`${label} enthält keine gültige Fläche.`);
	}
	return parts;
}

// Die Liste von Teilen zurück nach GeoJSON. Ein Teil -> Polygon, mehrere -> MultiPolygon: der Typ
// folgt der FORM, nicht der Eingabe. Genau so normalisiert der Server auch (:428).
function ecosystemClippingToGeometry(parts) {
	if (!Array.isArray(parts) || parts.length === 0) {
		throw new Error("Die Operation ergibt keine Fläche.");
	}
	return parts.length === 1
		? { type: "Polygon", coordinates: parts[0] }
		: { type: "MultiPolygon", coordinates: parts };
}

// Plausibilitätsprüfung nach dem Muster von validateRegionBooleanResult. Sie fängt nicht Rundungs-,
// sondern Denkfehler: ein Abzug, der WÄCHST, ist kein Abzug. Epsilon relativ zur Eingabe, weil die
// Karte 0..1024 gross ist und absolute Schranken je nach Flächengrösse mal zu streng, mal wirkungslos
// wären.
function assertEcosystemBooleanPlausible(operation, sourceGeometry, targetGeometry, resultGeometry) {
	const sourceArea = ecosystemGeometryArea(sourceGeometry);
	const targetArea = ecosystemGeometryArea(targetGeometry);
	const resultArea = ecosystemGeometryArea(resultGeometry);
	const epsilon = Math.max(0.01, (sourceArea + targetArea) * 0.000001);

	if (!(resultArea > 0)) {
		throw new Error("Die Operation ergibt keine Fläche.");
	}
	if ((operation === "difference" || operation === "difference-keep-target") && resultArea - sourceArea > epsilon) {
		throw new Error("Das Abzugs-Ergebnis ist größer als die Ausgangsfläche.");
	}
	if (operation === "intersection" && resultArea - Math.min(sourceArea, targetArea) > epsilon) {
		throw new Error("Die Schnittmenge ist größer als eine der beiden Flächen.");
	}
	if (operation === "union" && resultArea + epsilon < Math.max(sourceArea, targetArea)) {
		throw new Error("Das Verschmelzungs-Ergebnis ist kleiner als eine der Ausgangsflächen.");
	}
}

// Quelle ⊕ Ziel -> neue Geometrie für die QUELLE. Wirft, statt etwas Leeres zu liefern: eine leere
// Geometrie würde `update_area_geometry` anstandslos annehmen und die Fläche beim Speichern löschen.
function ecosystemBooleanGeometry(operation, sourceGeometry, targetGeometry) {
	const clipping = typeof window !== "undefined" ? window.polygonClipping : null;
	if (!clipping) {
		throw new Error("Die Polygon-Clipping-Bibliothek ist nicht geladen.");
	}

	const source = ecosystemGeometryToClipping(sourceGeometry, "Die Ausgangsfläche");
	const target = ecosystemGeometryToClipping(targetGeometry, "Die Zielfläche");

	let result;
	if (operation === "union") {
		result = clipping.union(source, target);
	} else if (operation === "difference" || operation === "difference-keep-target") {
		result = clipping.difference(source, target);
	} else if (operation === "intersection") {
		result = clipping.intersection(source, target);
	} else {
		throw new Error("Unbekannte Geometrieoperation: " + operation);
	}

	const geometry = ecosystemClippingToGeometry(result);
	assertEcosystemBooleanPlausible(operation, sourceGeometry, targetGeometry, geometry);
	return geometry;
}

// ---- Zerschneiden ------------------------------------------------------------------------------------
// Zwei Punkte spannen eine Linie auf; die Linie wird zu einem haarfeinen Rechteck verlängert und
// abgezogen. Abgeschrieben von buildRegionSplitCutterGeometry (map-features-region-edit-ops.js:203) --
// derselbe Kniff, aber ohne Leaflet: dort kommen die Punkte als L.latLng herein, hier als {x, y} in
// Kartenkoordinaten, weil dieser Kern ohne Karte testbar bleiben soll.
//
// Die Verlängerung über die Bounding Box hinaus ist der eigentliche Trick: eine Schnittlinie, die nur
// bis zum Klickpunkt reicht, trennt die Fläche nicht, sondern kerbt sie nur ein.
function ecosystemSplitCutterGeometry(geometry, startPoint, endPoint) {
	const dx = endPoint.x - startPoint.x;
	const dy = endPoint.y - startPoint.y;
	const lineLength = Math.hypot(dx, dy);
	if (!(lineLength > 0)) {
		throw new Error("Die Schnittlinie braucht zwei verschiedene Punkte.");
	}

	const bounds = ecosystemGeometryBounds(geometry);
	const diagonal = Math.max(
		Math.hypot(bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y),
		lineLength
	);
	const extension = diagonal * 2;
	const halfWidth = Math.max(diagonal * 0.0002, 0.25);
	const unitX = dx / lineLength;
	const unitY = dy / lineLength;
	const normalX = -unitY * halfWidth;
	const normalY = unitX * halfWidth;
	const fromX = startPoint.x - unitX * extension;
	const fromY = startPoint.y - unitY * extension;
	const toX = endPoint.x + unitX * extension;
	const toY = endPoint.y + unitY * extension;

	return [[[
		[fromX + normalX, fromY + normalY],
		[toX + normalX, toY + normalY],
		[toX - normalX, toY - normalY],
		[fromX - normalX, fromY - normalY],
		[fromX + normalX, fromY + normalY],
	]]];
}

// Fläche entlang der Linie zerschneiden. Liefert `kept` (bleibt auf der vorhandenen Zeile) und `split`
// (wird eine neue Fläche). Der GRÖSSERE Rest behält die alte Zeile — so bleibt die ursprüngliche
// Identität dort, wo die meiste Fläche liegt, statt zufällig mitzuwandern.
//
// 🔴 Es gilt nur als Schnitt, wenn hinterher MEHR Teile da sind als vorher. Sonst hat die Linie die
// Fläche bloss angeritzt, und ein stillschweigendes „nichts passiert" wäre die schlechteste Antwort.
function ecosystemSplitGeometry(geometry, startPoint, endPoint) {
	const clipping = typeof window !== "undefined" ? window.polygonClipping : null;
	if (!clipping) {
		throw new Error("Die Polygon-Clipping-Bibliothek ist nicht geladen.");
	}

	const source = ecosystemGeometryToClipping(geometry, "Die Ausgangsfläche");
	const cutter = ecosystemSplitCutterGeometry(geometry, startPoint, endPoint);
	const pieces = clipping.difference(source, cutter);
	if (!Array.isArray(pieces) || pieces.length <= source.length) {
		throw new Error("Die Schnittlinie trennt die Fläche nicht vollständig.");
	}

	const sorted = pieces
		.map((part) => ({ part, area: ecosystemGeometryArea({ type: "Polygon", coordinates: part }) }))
		.sort((left, right) => right.area - left.area)
		.map((entry) => entry.part);

	// Der grösste Teil bleibt; alles andere wandert gemeinsam in die neue Fläche. „Alles andere" statt
	// „der zweite Teil": ein Schnitt durch ein mehrteiliges Gebilde kann drei Stücke hinterlassen.
	return {
		kept: ecosystemClippingToGeometry([sorted[0]]),
		split: ecosystemClippingToGeometry(sorted.slice(1)),
	};
}

// ---- Herauslösen ------------------------------------------------------------------------------------
// EINEN Teil eines mehrteiligen Gebildes zur eigenen Fläche machen. Das ist die Umkehrung der
// Vereinigung und der Grund, warum sie ungefährlich ist: was zusammengewachsen ist, lässt sich wieder
// trennen. Löcher reisen mit ihrem Teil -- ein Ring gehört zu genau einem Teil.
function ecosystemExtractPart(geometry, partIndex) {
	const parts = ecosystemGeometryToClipping(geometry, "Die Fläche");
	const index = Number(partIndex);
	if (!Number.isInteger(index) || index < 0 || index >= parts.length) {
		throw new Error("Diesen Teil gibt es nicht.");
	}
	if (parts.length < 2) {
		// Sonst bliebe eine Fläche ohne Geometrie zurück, und update_area_geometry nähme das an.
		throw new Error("Das ist der einzige Teil dieser Fläche — es bleibt nichts übrig.");
	}

	return {
		extracted: ecosystemClippingToGeometry([parts[index]]),
		remainder: ecosystemClippingToGeometry(parts.filter((_, position) => position !== index)),
	};
}

// ---- Alle Unterflächen vereinigen -------------------------------------------------------------------
// Ein Abzug hinterlässt eine Fläche, die aus mehreren Stücken besteht; berühren sie einander, sollen die
// inneren Kanten weg und eine Umrisslinie übrigbleiben. Das ist die Vereinigung ALLER Teile mit sich
// selbst -- kein zweites Objekt beteiligt.
//
// 🪤 Getrennt liegende Stücke bleiben getrennt. Eine Vereinigung schliesst keine Lücke, sie verschmilzt
// nur, was sich berührt oder überlappt. Der Aufrufer muss das melden können, deshalb steht die Teilzahl
// vorher und nachher im Ergebnis statt bloss der Geometrie.
function ecosystemMergeParts(geometry) {
	const clipping = typeof window !== "undefined" ? window.polygonClipping : null;
	if (!clipping) {
		throw new Error("Die Polygon-Clipping-Bibliothek ist nicht geladen.");
	}

	const parts = ecosystemGeometryToClipping(geometry, "Die Fläche");
	if (parts.length < 2) {
		throw new Error("Diese Fläche besteht nur aus einer Unterfläche.");
	}

	const merged = clipping.union([parts[0]], ...parts.slice(1).map((part) => [part]));
	const result = ecosystemClippingToGeometry(merged);

	return { geometry: result, before: parts.length, after: ecosystemGeometryParts(result).length };
}

// ---- Verschieben ------------------------------------------------------------------------------------
// Jeder Ring jedes Teils um denselben Versatz. Löcher eingeschlossen -- ein verschobener Wald, der
// seine Lichtung stehen lässt, wäre der Fehler, den man erst drei Zooms später sieht.
function ecosystemMoveGeometry(geometry, deltaX, deltaY) {
	const dx = Number(deltaX) || 0;
	const dy = Number(deltaY) || 0;
	const parts = ecosystemGeometryToClipping(geometry, "Die Fläche").map((part) =>
		part.map((ring) => ring.map((point) => [point[0] + dx, point[1] + dy]))
	);

	return ecosystemClippingToGeometry(parts);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_BOOLEAN_OPERATIONS,
		ecosystemBooleanConsumesTarget,
		ecosystemBooleanGeometry,
		ecosystemGeometryToClipping,
		ecosystemClippingToGeometry,
		ecosystemSplitCutterGeometry,
		ecosystemSplitGeometry,
		ecosystemExtractPart,
		ecosystemMergeParts,
		ecosystemMoveGeometry,
	};
}
