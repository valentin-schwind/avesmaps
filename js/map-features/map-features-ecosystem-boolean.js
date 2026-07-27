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
	{ operation: "union", label: "Mit Fläche verschmelzen …" },
	{ operation: "difference", label: "Fläche abziehen …" },
	{ operation: "intersection", label: "Schnittmenge mit Fläche …" },
];

// 🔴 Nur die Vereinigung frisst ihr Ziel — sonst gäbe es die verschmolzene Form zweimal. Abziehen und
// Schneiden lassen das Ziel STEHEN: wer einen See aus einem Wald schneidet, will den See behalten.
// (Die Territorien kennen dafür zwei Varianten, `difference` und `difference-keep-target`. Hier gibt
// es nur die behaltende — ein Landschaftsobjekt stillschweigend zu löschen ist nie das Erwartete.)
function ecosystemBooleanConsumesTarget(operation) {
	return operation === "union";
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
	if (operation === "difference" && resultArea - sourceArea > epsilon) {
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
	} else if (operation === "difference") {
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

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_BOOLEAN_OPERATIONS,
		ecosystemBooleanConsumesTarget,
		ecosystemBooleanGeometry,
		ecosystemGeometryToClipping,
		ecosystemClippingToGeometry,
	};
}
