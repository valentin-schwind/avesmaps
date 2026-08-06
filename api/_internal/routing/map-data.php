<?php

declare(strict_types=1);

// ⚠️ $pdo ist optional und neu: wer die Revision schon gelesen hat (fuer einen ETag, bevor diese
// teure Ladung ueberhaupt beginnt), reicht seine Verbindung durch, statt eine zweite zu oeffnen --
// auf einem Host mit max_user_connections zaehlt das. Kein bestehender Aufrufer aendert sich.
function avesmapsLoadRouteMapData(array $config, ?PDO $pdo = null): array {
	$pdo = $pdo ?? avesmapsCreatePdo($config['database'] ?? []);
	$revision = avesmapsFetchRouteMapRevision($pdo);
	$features = avesmapsFetchRouteMapFeatures($pdo);

	return [
		'features' => $features,
		'revision' => $revision,
		'feature_count' => count($features),
		// ⚠️ V11: handed back rather than opened a second time. The terrain switch and path_terrain
		// read naively would be two to three connections per route, on hosting with
		// max_user_connections. Returning it is one line; a new key breaks no existing caller.
		'pdo' => $pdo,
	];
}

function avesmapsFetchRouteMapRevision(PDO $pdo): int {
	$statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
	$revision = $statement !== false ? $statement->fetchColumn() : false;
	if ($revision === false) {
		return 0;
	}

	return (int) $revision;
}

function avesmapsFetchRouteMapFeatures(PDO $pdo): array {
	$statement = $pdo->prepare(
		'SELECT
			id,
			public_id,
			feature_type,
			feature_subtype,
			name,
			geometry_type,
			geometry_json,
			properties_json,
			style_json,
			revision,
			updated_at
		FROM map_features
		WHERE is_active = 1
			AND feature_type <> \'powerline\'
		ORDER BY sort_order ASC, id ASC'
	);
	$statement->execute();

	return array_map(
		static function (array $row): array {
			return [
				'type' => 'Feature',
				'id' => (string) ($row['public_id'] ?? ''),
				'geometry' => avesmapsDecodeRouteMapJsonColumn($row['geometry_json'] ?? null),
				'properties' => [
					// 💣 DIE INTERNE ZEILEN-ID, UND SIE BLEIBT SERVERSEITIG. Sie ist der einzige
					// unveraenderliche, NUMERISCHE Schluessel eines Kartenobjekts -- gebraucht wird
					// sie fuer den Kreuzungsnamen `Kreuzung-<id>` (Befund A13 b): eine UUID waere
					// zwar auch stabil, aber `normalizeNodeName` streicht nur `Kreuzung-<Ziffern>`,
					// und mit einer UUID im Namen begaenne die Etappenanzeige, Kreuzungen als
					// Stationen zu zeigen. Genau das darf sie nicht (Owner 06.08.2026).
					//
					// ⚠️ Sie steht in den AEUSSEREN properties, und das ist der Punkt: der Bauer der
					// Ortsdaten reicht nur `properties['properties']` (die inneren) an den Client
					// weiter -- dieser Wert verlaesst den Server also nicht. Sichtbar wird von ihm
					// nur die Zahl im Kreuzungsnamen.
					'internal_id' => (int) ($row['id'] ?? 0),
					'public_id' => (string) ($row['public_id'] ?? ''),
					'feature_type' => (string) ($row['feature_type'] ?? ''),
					'feature_subtype' => (string) ($row['feature_subtype'] ?? ''),
					'name' => (string) ($row['name'] ?? ''),
					'geometry_type' => (string) ($row['geometry_type'] ?? ''),
					'properties' => avesmapsDecodeRouteMapJsonColumn($row['properties_json'] ?? null),
					'style' => avesmapsDecodeRouteMapJsonColumn($row['style_json'] ?? null),
					'revision' => (int) ($row['revision'] ?? 0),
					'updated_at' => (string) ($row['updated_at'] ?? ''),
				],
			];
		},
		$statement->fetchAll()
	);
}

function avesmapsDecodeRouteMapJsonColumn(mixed $value): array {
	if ($value === null || $value === '') {
		return [];
	}

	if (is_array($value)) {
		return $value;
	}

	try {
		$decodedValue = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
	} catch (JsonException) {
		return [];
	}

	return is_array($decodedValue) ? $decodedValue : [];
}
