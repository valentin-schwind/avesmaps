<?php

declare(strict_types=1);

function avesmapsLoadRouteMapData(array $config): array {
	$pdo = avesmapsCreatePdo($config['database'] ?? []);
	$revision = avesmapsFetchRouteMapRevision($pdo);
	$features = avesmapsFetchRouteMapFeatures($pdo);

	return [
		'features' => $features,
		'revision' => $revision,
		'feature_count' => count($features),
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
