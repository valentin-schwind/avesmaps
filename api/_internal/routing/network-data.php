<?php

declare(strict_types=1);

function avesmapsBuildRouteNetworkData(array $routeMapData): array {
	$locations = [];
	$paths = [];
	$statistics = [
		'location_count' => 0,
		'path_count' => 0,
		'river_count' => 0,
		'sea_count' => 0,
		'land_count' => 0,
		'unknown_count' => 0,
		'subtype_counts' => [],
	];

	$clientPathIndex = 0;
	// 💣 DER KREUZUNGS-ZAEHLER IST WEG, und das ist der ganze Befund A13 (b). Er machte aus dem
	// Namen eine POSITION: `Kreuzung-1` bis `Kreuzung-2084`, bei jeder Anfrage neu durchgezaehlt --
	// eine eingefuegte oder geloeschte Kreuzung benannte bis zu 2.083 Knoten um. Der Name kommt
	// jetzt aus der Zeilen-Id und haengt an nichts mehr, was sich nebenan aendern kann.
	$features = is_array($routeMapData['features'] ?? null) ? $routeMapData['features'] : [];
	foreach ($features as $feature) {
		if (!is_array($feature)) {
			continue;
		}

		$clientPathId = '';
		if (avesmapsIsClientRenderableRoutePath($feature)) {
			$clientPathIndex++;
			$clientPathId = 'path-' . $clientPathIndex;
		}

		if (avesmapsIsRouteLocation($feature)) {
			$locations[] = avesmapsBuildRouteLocationData($feature);
			$statistics['location_count']++;
			continue;
		}

		if (!avesmapsIsRoutePath($feature)) {
			continue;
		}

		$pathData = avesmapsBuildRoutePathData($feature, $clientPathId);
		$paths[] = $pathData;
		$statistics['path_count']++;
		$subtypeKey = (string) $pathData['subtype'];
		$statistics['subtype_counts'][$subtypeKey] = (int) ($statistics['subtype_counts'][$subtypeKey] ?? 0) + 1;

		$transportType = avesmapsGetRouteTransportType($pathData['subtype']);
		if ($transportType === 'river') {
			$statistics['river_count']++;
		} elseif ($transportType === 'sea') {
			$statistics['sea_count']++;
		} elseif ($transportType === 'land') {
			$statistics['land_count']++;
		} else {
			$statistics['unknown_count']++;
		}
	}

	return [
		'locations' => $locations,
		'paths' => $paths,
		'statistics' => $statistics,
	];
}

function avesmapsIsRouteLocation(array $feature): bool {
	$geometry = is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [];
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	$name = trim((string) ($properties['name'] ?? ''));
	return (string) ($geometry['type'] ?? '') === 'Point'
		&& $name !== ''
		&& (string) ($properties['feature_type'] ?? '') !== 'label';
}

// ⚠️ avesmapsIsRouteCrossingLocation() stand hier und ist am 06.08.2026 mit dem Kreuzungs-Zaehler
// weggefallen (A13 b). Sie war seine Huelle -- sie packte nur `$feature['properties']` aus und
// reichte an das Praedikat unten weiter. Ohne Zaehler hatte sie keinen Aufrufer mehr ausser ihrem
// eigenen Test, und eine Funktion, die nur noch von ihrem Test am Leben gehalten wird, ist toter
// Code mit gruenem Anstrich.

// Ist dieses Objekt eine Kreuzung? EIN Praedikat, und das ist der Punkt (Befund A13 c).
//
// 💣 DIESELBE FRAGE WURDE IN DERSELBEN SCHLEIFE ZWEIMAL BEANTWORTET: avesmapsIsRouteCrossingLocation
// zaehlte den Zaehler hoch, und avesmapsBuildRouteLocationData entschied mit einer EIGENEN,
// woertlich abgeschriebenen Namenspruefung ueber das Umbenennen. Solange beide gleich lauteten,
// fiel es nicht auf. Waeren sie je auseinandergelaufen, haette eine Zeile `Kreuzung-5` geheissen,
// ohne dass der Zaehler weiterrueckt -- und die naechste Kreuzung haette denselben Namen bekommen.
// Ortsnamen sind Graph-Schluessel; zwei Knoten mit einem Namen ist kein Anzeigefehler.
//
// ⚠️ Die drei Stufen sind die des CLIENTS (js/map-features/map-features-location-lookup.js:62-77),
// nicht neu erfunden: erst `feature_type` (junction|crossing), dann der Subtyp, dann der Name.
// Der Server prueft bisher nur die dritte. Am Vollbestand gemessen (06.08.2026, 5.575
// Punkt-Objekte): 2.084 sind nach BEIDEN Kriterien eine Kreuzung, **0** nur nach dem einen und
// **0** nur nach dem anderen. Diese Aenderung aendert heute also keinen einzigen Namen -- sie
// macht die Deckung verbindlich, statt sie dem Zufall zu ueberlassen.
//
// 🔴 Was sie NICHT tut: die Namen bleiben Positionsnummern. `Kreuzung-1` bis `Kreuzung-2084`
// werden bei jeder Anfrage neu durchgezaehlt, eine eingefuegte Kreuzung verschiebt alle
// folgenden. Das zu beheben heisst, 2.084 Namen im stabilen Vertrag zu aendern (A13 a/b) -- eine
// Owner-Entscheidung, und diese Zeilen nehmen sie nicht vorweg.
function avesmapsRoutePropertiesAreCrossing(array $properties): bool {
	$read = static function (array $properties, array $keys): string {
		foreach ($keys as $key) {
			$value = $properties[$key] ?? null;
			if (is_string($value) && trim($value) !== '') {
				return trim($value);
			}
		}

		return '';
	};

	$featureType = strtolower($read($properties, ['feature_type']));
	if ($featureType === 'junction' || $featureType === 'crossing') {
		return true;
	}

	// ⚠️ Dieselbe Schluesselreihenfolge wie der Client. `settlement_class` steht vor
	// `feature_subtype`, weil er sie so liest -- eine andere Reihenfolge waere eine zweite Regel.
	$subtype = strtolower($read($properties, ['location_type', 'settlement_class', 'feature_subtype', 'locationType']));
	if ($subtype === 'crossing') {
		return true;
	}

	return strncmp((string) ($properties['name'] ?? ''), 'Kreuzung', strlen('Kreuzung')) === 0;
}

// Ist dieser gespeicherte Name ein PLATZHALTER -- also ersetzbar? (Befund A13 b, Owner 06.08.2026.)
//
// 💣 DIESE LISTE IST AUSGESCHRIEBEN UND NICHT GERATEN, und daran haengt, ob sich Kreuzungen
// spaeter benennen lassen. Bis heute benannte der Server JEDE Kreuzung um, bedingungslos -- ein von
// Hand vergebener Name waere also ausgerechnet dort weggeworfen worden, wo Namen Graph-Schluessel
// sind und im Reiseplan stehen. Jetzt gilt: Platzhalter werden ersetzt, ein echter Name bleibt.
// „Kreuzungen benennen" ist damit reine Dateneingabe und keine Aenderung am stabilen Vertrag mehr.
//
// Die drei Formen, die im Bestand vorkommen:
//   * `Kreuzung`           -- was avesmapsCreateCrossingFeature() heute vergibt (features.php:1431)
//   * `Kreuzung-<Ziffern>` -- was frueher gespeichert wurde
//   * `Kreuzung-auto-<n>`  -- ~200 Altzeilen, die der strengere Client-Test bewusst NICHT trifft
//
// ⚠️ Alles andere ist ein echter Name. „Kreuzung am Ochsenwasser" faellt hier durch und bleibt
// stehen -- das ist der ganze Zweck.
function avesmapsRouteCrossingNameIsPlaceholder(string $name): bool {
	return preg_match('/^Kreuzung(?:-auto)?(?:-\d+)?$/i', trim($name)) === 1;
}

// Der Name, unter dem eine Kreuzung im Routennetz gefuehrt wird.
//
// 🔴 ORTSNAMEN SIND GRAPH-SCHLUESSEL. Zwei Knoten unter einem Namen sind eine falsche Route, kein
// Anzeigefehler -- deshalb muss das Ergebnis EINDEUTIG sein. `map_features.id` ist ein
// Primaerschluessel und leistet das von Bauart wegen; die frueher benutzte Laufnummer leistete es
// auch, war dafuer aber eine POSITION: eine eingefuegte Kreuzung verschob alle folgenden Namen.
//
// 💣 NUMERISCH, UND DAS IST KEINE GESCHMACKSFRAGE. `normalizeNodeName` im Client
// (js/map-features/map-features.js:232) streicht `Kreuzung-<Ziffern>` weg, damit der Reiseplan
// Kreuzungen als etappeninterne Stuetzpunkte schluckt statt sie als Stationen zu zeigen. Eine UUID
// im Namen wuerde dort nicht greifen -- und die Etappenanzeige begaenne, sich zu aendern. Sie darf
// sich nicht aendern (Owner 06.08.2026).
//
// ⚠️ Der Rueckfall ohne brauchbare Id nimmt die oeffentliche Kennung. Er sieht in der Etappenliste
// haesslich aus -- und genau darum geht es: ohne ihn hiessen ALLE betroffenen Kreuzungen
// `Kreuzung-0`, also mehrere Knoten gleich, also falsche Routen. Ein sichtbarer Fehler ist besser
// als ein stiller.
function avesmapsRouteCrossingName(array $properties): string {
	$internalId = (int) ($properties['internal_id'] ?? 0);
	if ($internalId > 0) {
		return 'Kreuzung-' . $internalId;
	}

	$publicId = trim((string) ($properties['public_id'] ?? ''));

	return $publicId !== '' ? 'Kreuzung-' . $publicId : (string) ($properties['name'] ?? '');
}

function avesmapsIsRoutePath(array $feature): bool {
	return avesmapsIsClientRenderableRoutePath($feature);
}

function avesmapsIsClientRenderableRoutePath(array $feature): bool {
	$geometry = is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [];
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	return (string) ($geometry['type'] ?? '') === 'LineString'
		&& (string) ($properties['feature_type'] ?? '') !== ('power' . 'line');
}

function avesmapsGetRouteTransportType(string $subtype): string {
	$normalizedSubtype = avesmapsNormalizeRouteSubtypeKey($subtype);
	if (in_array($normalizedSubtype, ['pfad', 'weg', 'strasse', 'reichsstrasse', 'gebirgspass', 'wuestenpfad'], true)) {
		return 'land';
	}
	if ($normalizedSubtype === 'flussweg') {
		return 'river';
	}
	if ($normalizedSubtype === 'seeweg') {
		return 'sea';
	}

	return 'unknown';
}

function avesmapsNormalizeRouteSubtypeKey(string $subtype): string {
	$normalizedSubtype = strtolower(trim($subtype));
	$normalizedSubtype = str_replace(['ä', 'ö', 'ü', 'ß'], ['ae', 'oe', 'ue', 'ss'], $normalizedSubtype);

	return $normalizedSubtype;
}

function avesmapsResolveRoutePathSubtype(array $properties): string {
	$featureSubtype = trim((string) ($properties['feature_subtype'] ?? ''));
	$displayName = trim((string) ($properties['display_name'] ?? ''));
	$originalName = trim((string) ($properties['original_name'] ?? ''));
	$name = trim((string) ($properties['name'] ?? ''));
	$subtypeCandidate = $featureSubtype !== '' ? $featureSubtype : ($displayName !== '' ? $displayName : ($originalName !== '' ? $originalName : ($name !== '' ? $name : 'Weg')));

	return avesmapsNormalizeClientRouteSubtype($subtypeCandidate);
}

function avesmapsBuildRouteLocationData(array $feature): array {
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	$name = (string) ($properties['name'] ?? '');
	// 💣 ZWEI BEDINGUNGEN, UND DIE ZWEITE IST NEU (Befund A13 b, Owner 06.08.2026): eine Kreuzung
	// wird nur umbenannt, wenn ihr gespeicherter Name ein PLATZHALTER ist. Ein von Hand vergebener
	// Name bleibt stehen -- vorher warf diese Zeile ihn weg.
	if (avesmapsRoutePropertiesAreCrossing($properties) && avesmapsRouteCrossingNameIsPlaceholder($name)) {
		$name = avesmapsRouteCrossingName($properties);
	}

	return [
		'id' => (string) ($feature['id'] ?? $properties['public_id'] ?? ''),
		'public_id' => (string) ($properties['public_id'] ?? ''),
		'name' => $name,
		'subtype' => (string) ($properties['feature_subtype'] ?? ''),
		// ⚠️ Reicht die ERSTE Stufe des Kreuzungs-Praedikats weiter (junction|crossing). Ohne sie
		// koennte api/locations/index.php nur Subtyp und Name fragen -- und liefe damit genau in die
		// Teil-Pruefung zurueck, die Befund A13 (c) beseitigt hat. Verlaesst den Server nicht: die
		// Antwort dort wird aus einer eigenen, ausgeschriebenen Feldliste gebaut.
		'feature_type' => (string) ($properties['feature_type'] ?? ''),
		'geometry' => is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [],
		'properties' => is_array($properties['properties'] ?? null) ? $properties['properties'] : [],
	];
}

function avesmapsBuildRoutePathData(array $feature, string $clientPathId = ''): array {
	$properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
	$routeSubtype = avesmapsResolveRoutePathSubtype($properties);
	// The decoded properties_json is NESTED under properties.properties in the route map
	// feature shape (avesmapsFetchRouteMapFeatures) -- flow lives inside it, not top-level.
	$nestedProperties = is_array($properties['properties'] ?? null) ? $properties['properties'] : [];

	return [
		'id' => (string) ($feature['id'] ?? $properties['public_id'] ?? ''),
		'public_id' => (string) ($properties['public_id'] ?? ''),
		// 🔴 V11: the way's OWN revision, threaded through on purpose. map-data.php puts it in
		// properties.revision, and this builder used to drop it -- so path_terrain.path_revision
		// would have compared against nothing. It is the way's own counter, NOT the global
		// map_revision: that one is bumped by settlement, label, source and sync writes too, and
		// peaks are `berggipfel` LABELS in map_features, so one peak height would have invalidated
		// every way at once.
		'revision' => (int) ($properties['revision'] ?? 0),
		'client_path_id' => $clientPathId,
		'name' => $routeSubtype,
		'subtype' => $routeSubtype,
		'geometry' => is_array($feature['geometry'] ?? null) ? $feature['geometry'] : [],
		'properties' => $nestedProperties,
		// Flussrichtung spec §2: properties.flow, needed by the graph builder.
		'flow' => is_array($nestedProperties['flow'] ?? null) ? $nestedProperties['flow'] : null,
	];
}
