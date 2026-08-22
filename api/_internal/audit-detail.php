<?php

declare(strict_types=1);

/**
 * „Was hat dieser Schritt getan?" -- die Erklaerzeile im Fenster „Aenderungen".
 *
 * Das Protokoll hat den Vorher- und den Nachher-Stand jeder Aenderung immer schon gespeichert; das
 * Fenster zeigte davon nichts und liess den Editor vor „Ort geaendert" stehen, ohne zu sagen, WAS
 * geaendert wurde. Hier wird aus den zwei Schnappschuessen ein deutscher Satz.
 *
 * 🔴 DIE KARTEN-SEITE FRAGT NICHT SELBST, WELCHE FELDER EINE AKTION ANFASST -- sie bekommt die
 * Liste von `avesmapsUndoColumnsForAuditAction()` gereicht, also von genau der Funktion, die beim
 * „Rueckgaengig" auch wirklich zurueckschreibt. Eine eigene Tabelle daneben wuerde driften, und
 * dann verspraeche die Zeile etwas anderes, als der Knopf tut -- die Frage des Owners war woertlich,
 * welcher Schritt rueckgaengig gemacht wird.
 *
 * ⭐ Das ist zugleich der Grund, warum hier NICHT Schluessel gegen Schluessel verglichen wird:
 * `before_json` ist die ROHE Datenbankzeile, `after_json` ein von Hand gebautes Paket, in dem
 * `is_nodix`, `show_label` & Co. aus dem `properties_json` HERAUSGEHOBEN sind. Ein Vergleich ueber
 * alle Schluessel des Pakets meldete jeden dieser Herausgehobenen bei JEDEM Speichern als geaendert,
 * weil die Datenbankzeile ihn oben nicht kennt. Weil die Undo-Spalten aber ausnahmslos ECHTE
 * Tabellenspalten sind (`name`, `feature_subtype`, `geometry_json`, `properties_json`, `style_json`),
 * stehen beide Seiten unter demselben Namen -- und `properties_json` wird als GANZES verglichen,
 * seine Innereien danach einzeln.
 *
 * PURITAETSVERTRAG: nebenwirkungsfrei beim Einbinden, kein PDO, kein I/O. Die Namen der
 * Herrschaftsgebiete reicht der Aufrufer als Abbildung herein -- nachschlagen tut er sie selbst.
 */

// Die Umrechnung Karteneinheit -> Meile. 💣 Sie steht NICHT zweimal da: das ist die Konstante des
// Reisemodells, und der Puritaetsvertrag jener Datei erlaubt das Einbinden ohne Nebenwirkung.
require_once __DIR__ . '/routing/terrain-factor.php';

/**
 * Beschriftungen der Felder. ⚠️ Bewusst NUR die, die im Protokoll wirklich vorkommen -- ein
 * erfundener Eintrag waere ein Versprechen, das keine Zeile einloest. Was hier fehlt, wird
 * gezaehlt („und 2 weitere"), nie mit seinem technischen Schluessel gezeigt: die Zeile liest ein
 * Editor, kein Programmierer.
 */
const AVESMAPS_AUDIT_FIELD_LABELS = [
    'name' => 'Name',
    'feature_subtype' => 'Art',
    'style_json' => 'Darstellung',
    'show_label' => 'Beschriftung',
    'description' => 'Beschreibung',
    'wiki_url' => 'Wiki-Artikel',
    'wiki_no_article' => 'Wiki-Merker',
    'is_nodix' => 'Nodix',
    'is_ruined' => 'Ruine',
    'is_hidden' => 'Verborgen',
    'einwohner' => 'Einwohner',
    'lage' => 'Lage',
    'oberhaupt' => 'Oberhaupt',
    'place_kind' => 'Stättenart',
    'other_source' => 'Quelle',
    'coat_of_arms_url' => 'Wappen',
    'transport_domain' => 'Verkehrsraum',
    'allowed_transports' => 'Verkehrsmittel',
    'transport_seasons' => 'Jahreszeiten',
    'min_zoom' => 'Zoomstufen',
    'max_zoom' => 'Zoomstufen',
    'valid_from_bf' => 'Gültigkeit',
    'valid_to_bf' => 'Gültigkeit',
    'territory_id' => 'Zuordnung',
];

/**
 * Schluessel, die zwar wandern, aber nichts aussagen. `field_origins` schreibt sich als FOLGE jeder
 * Feldaenderung fort -- mitgezaehlt stuende in jeder Zeile ein Feld zu viel.
 */
const AVESMAPS_AUDIT_IGNORED_PROPERTY_KEYS = ['field_origins'];

/** Hoechstens so viele Feldnamen stehen ausgeschrieben da, der Rest wird gezaehlt. */
const AVESMAPS_AUDIT_FIELD_NAME_LIMIT = 3;

function avesmapsAuditFieldLabel(string $key): string
{
    return AVESMAPS_AUDIT_FIELD_LABELS[$key] ?? '';
}

/**
 * PUR: aus den geaenderten Schluesseln wird „Name, Einwohner geändert" bzw. „3 Felder geändert".
 * Unbekannte Schluessel werden gezaehlt, nicht benannt.
 */
function avesmapsAuditFieldsPhrase(array $keys): string
{
    $benannt = [];
    $unbenannt = 0;
    foreach ($keys as $key) {
        $label = avesmapsAuditFieldLabel((string) $key);
        if ($label === '') {
            $unbenannt += 1;
            continue;
        }
        // ⚠️ Zwei Schluessel duerfen dieselbe Beschriftung tragen (min_zoom/max_zoom sind EINE
        // Angabe fuer den Leser). Ein Duplikat ist deshalb kein weiteres Feld, sondern nichts.
        if (!in_array($label, $benannt, true)) {
            $benannt[] = $label;
        }
    }

    if ($benannt === [] && $unbenannt === 0) {
        return '';
    }
    if ($benannt === []) {
        return $unbenannt === 1 ? '1 Feld geändert' : $unbenannt . ' Felder geändert';
    }

    $ueberzaehlig = max(0, count($benannt) - AVESMAPS_AUDIT_FIELD_NAME_LIMIT) + $unbenannt;
    $text = implode(', ', array_slice($benannt, 0, AVESMAPS_AUDIT_FIELD_NAME_LIMIT));
    if ($ueberzaehlig > 0) {
        $text .= ' und ' . $ueberzaehlig . ' weitere';
    }

    return $text . ' geändert';
}

/** Die Teile einer Erklaerzeile werden mit dem Mittelpunkt verbunden, wie ueberall im Panel. */
function avesmapsAuditJoinParts(array $parts): string
{
    return implode(' · ', array_values(array_filter(
        array_map(static fn(mixed $part): string => trim((string) $part), $parts),
        static fn(string $part): bool => $part !== ''
    )));
}

/** PUR: JSON-Text wird zu einem Array, alles andere bleibt, wie es ist. */
function avesmapsAuditNormalizeValue(mixed $value): mixed
{
    if (!is_string($value)) {
        return $value;
    }

    $trimmed = trim($value);
    if ($trimmed === '' || ($trimmed[0] !== '{' && $trimmed[0] !== '[')) {
        return $value;
    }

    $decoded = json_decode($trimmed, true);

    return is_array($decoded) ? $decoded : $value;
}

/**
 * PUR: Haben sich zwei Werte wirklich unterschieden? ⚠️ Die zwei Seiten kommen aus verschiedenen
 * Welten -- links die Datenbank (alles Text, `null` fuer leer), rechts PHP-Werte aus der Anfrage
 * (`true`, `0`, `''`). Ohne Angleichung meldet jede Zeile Aenderungen, die niemand gemacht hat.
 */
function avesmapsAuditValuesDiffer(mixed $left, mixed $right): bool
{
    $l = avesmapsAuditNormalizeValue($left);
    $r = avesmapsAuditNormalizeValue($right);

    if (is_array($l) || is_array($r)) {
        return json_encode(avesmapsAuditSortDeep($l)) !== json_encode(avesmapsAuditSortDeep($r));
    }

    return avesmapsAuditScalarText($l) !== avesmapsAuditScalarText($r);
}

function avesmapsAuditScalarText(mixed $value): string
{
    if ($value === null) {
        return '';
    }
    if (is_bool($value)) {
        return $value ? '1' : '0';
    }
    if (is_float($value)) {
        return rtrim(rtrim(number_format($value, 6, '.', ''), '0'), '.');
    }

    return (string) $value;
}

/** PUR: Schluessel sortieren, damit zwei gleiche Objekte in anderer Reihenfolge gleich bleiben. */
function avesmapsAuditSortDeep(mixed $value): mixed
{
    if (!is_array($value)) {
        return $value;
    }

    $sorted = [];
    $keys = array_keys($value);
    sort($keys, SORT_STRING);
    foreach ($keys as $key) {
        $sorted[(string) $key] = avesmapsAuditSortDeep($value[$key]);
    }

    return $sorted;
}

/** PUR: wie viele Koordinatenpaare stecken in einer GeoJSON-Geometrie? */
function avesmapsAuditCountCoordinatePairs(mixed $geometry): int
{
    $geometry = avesmapsAuditNormalizeValue($geometry);
    if (!is_array($geometry)) {
        return 0;
    }

    $count = 0;
    avesmapsAuditWalkCoordinates($geometry['coordinates'] ?? null, $count);

    return $count;
}

function avesmapsAuditWalkCoordinates(mixed $node, int &$count): void
{
    if (!is_array($node) || $node === []) {
        return;
    }

    if (is_numeric($node[0] ?? null) && is_numeric($node[1] ?? null)) {
        $count += 1;

        return;
    }

    foreach ($node as $child) {
        avesmapsAuditWalkCoordinates($child, $count);
    }
}

/** PUR: der erste Punkt einer Geometrie, oder null. */
function avesmapsAuditFirstPoint(mixed $geometry): ?array
{
    $geometry = avesmapsAuditNormalizeValue($geometry);
    if (!is_array($geometry)) {
        return null;
    }

    $node = $geometry['coordinates'] ?? null;
    while (is_array($node) && $node !== []) {
        if (is_numeric($node[0] ?? null) && is_numeric($node[1] ?? null)) {
            return [(float) $node[0], (float) $node[1]];
        }
        $node = $node[0] ?? null;
    }

    return null;
}

/**
 * PUR: was eine Geometrie-Aenderung getan hat. Ein Verschieben nennt die Strecke, alles andere die
 * Zahl der Stuetzpunkte -- beides ist am Schnappschuss ablesbar und nichts davon geraten.
 */
function avesmapsAuditGeometryPhrase(string $action, mixed $before, mixed $after): string
{
    $basis = str_starts_with($action, 'undo_') ? substr($action, 5) : $action;
    if ($basis === 'move_point' || $basis === 'move_label') {
        $von = avesmapsAuditFirstPoint($before);
        $nach = avesmapsAuditFirstPoint($after);
        if ($von === null || $nach === null) {
            return 'verschoben';
        }
        $meilen = sqrt((($nach[0] - $von[0]) ** 2) + (($nach[1] - $von[1]) ** 2))
            * AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT;

        // Unter einer Zehntelmeile eine Zahl zu nennen taeuscht eine Genauigkeit vor, die die
        // gerundeten Koordinaten nicht haben.
        return $meilen < 0.05
            ? 'kaum verschoben'
            : 'um ' . number_format($meilen, 1, ',', '.') . ' Meilen verschoben';
    }

    $vorher = avesmapsAuditCountCoordinatePairs($before);
    $nachher = avesmapsAuditCountCoordinatePairs($after);
    if ($vorher > 0 && $nachher > 0 && $vorher !== $nachher) {
        return $vorher . ' → ' . $nachher . ' Stützpunkte';
    }

    return 'Verlauf geändert';
}

/**
 * Die Erklaerzeile einer Karten-Aenderung.
 *
 * @param array $undoColumns Die Spalten, die „Rueckgaengig" fuer diese Aktion zurueckschreibt.
 *                           Leer heisst: kein Knopf, keine Erklaerung -- die Aktionsbeschriftung
 *                           („Ort erstellt", „Objekt gelöscht") sagt bereits alles.
 */
function avesmapsMapAuditDetailText(string $action, array $before, array $after, array $undoColumns): string
{
    if ($undoColumns === [] || $after === []) {
        return '';
    }

    $teile = [];
    $felder = [];
    foreach ($undoColumns as $column) {
        $column = (string) $column;
        // ⚠️ Steht die Spalte nicht im Nachher-Stand, wird NICHT geraten. Ein aelterer Eintrag darf
        // schweigen; „geändert" zu behaupten waere schlimmer als nichts zu sagen.
        if (!array_key_exists($column, $after)) {
            continue;
        }

        $vorher = $before[$column] ?? null;
        $nachher = $after[$column];
        if (!avesmapsAuditValuesDiffer($vorher, $nachher)) {
            continue;
        }

        if ($column === 'geometry_json') {
            $teile[] = avesmapsAuditGeometryPhrase($action, $vorher, $nachher);
            continue;
        }
        if ($column === 'properties_json') {
            foreach (avesmapsAuditChangedPropertyKeys($vorher, $nachher) as $key) {
                $felder[] = $key;
            }
            continue;
        }

        $felder[] = $column;
    }

    $felderText = avesmapsAuditFieldsPhrase($felder);
    if ($felderText !== '') {
        array_unshift($teile, $felderText);
    }

    return avesmapsAuditJoinParts($teile);
}

/** PUR: welche Schluessel eines Eigenschaften-Objekts haben sich geaendert (in beide Richtungen)? */
function avesmapsAuditChangedPropertyKeys(mixed $before, mixed $after): array
{
    $vorher = avesmapsAuditNormalizeValue($before);
    $nachher = avesmapsAuditNormalizeValue($after);
    $vorher = is_array($vorher) ? $vorher : [];
    $nachher = is_array($nachher) ? $nachher : [];

    $keys = array_unique(array_merge(array_keys($vorher), array_keys($nachher)));
    sort($keys, SORT_STRING);

    $geaendert = [];
    foreach ($keys as $key) {
        if (in_array((string) $key, AVESMAPS_AUDIT_IGNORED_PROPERTY_KEYS, true)) {
            continue;
        }
        if (avesmapsAuditValuesDiffer($vorher[$key] ?? null, $nachher[$key] ?? null)) {
            $geaendert[] = (string) $key;
        }
    }

    return $geaendert;
}

/**
 * PUR: die Erklaerzeile einer Herrschaftsgebiets-Aenderung.
 *
 * Der Schnappschuss der politischen Seite hat eine andere Form als der der Karte: er traegt eine
 * Abbildung `geometries` (Schluessel = oeffentliche Kennung der Flaeche) und `territories`.
 * Gezaehlt werden nur AKTIVE Flaechen -- eine Loeschung setzt `is_active` auf 0 und laesst die
 * Zeile stehen, „2 Flächen → 2 Flächen" waere also die Unwahrheit.
 */
function avesmapsPoliticalAuditDetailText(array $before, array $after): string
{
    $vorher = avesmapsPoliticalAuditActiveGeometries($before);
    $nachher = avesmapsPoliticalAuditActiveGeometries($after);

    if (count($vorher) !== count($nachher)) {
        return avesmapsPoliticalAuditAreaCountText(count($vorher))
            . ' → ' . avesmapsPoliticalAuditAreaCountText(count($nachher));
    }

    // Genau eine Flaeche auf beiden Seiten, und es ist dieselbe: dann laesst sich sagen, WAS an ihr
    // anders ist. Bei mehreren waere jede Zuordnung geraten.
    $teile = [];
    if (count($vorher) === 1 && array_keys($vorher) === array_keys($nachher)) {
        $key = array_key_first($vorher);
        $felder = [];
        foreach (['valid_from_bf', 'valid_to_bf', 'min_zoom', 'max_zoom', 'territory_id', 'style_json'] as $feld) {
            if (avesmapsAuditValuesDiffer($vorher[$key][$feld] ?? null, $nachher[$key][$feld] ?? null)) {
                $felder[] = $feld;
            }
        }
        if (avesmapsAuditValuesDiffer($vorher[$key]['geometry_geojson'] ?? null, $nachher[$key]['geometry_geojson'] ?? null)) {
            $teile[] = avesmapsAuditGeometryPhrase('update_geometry', $vorher[$key]['geometry_geojson'] ?? null, $nachher[$key]['geometry_geojson'] ?? null);
        }
        $felderText = avesmapsAuditFieldsPhrase($felder);
        if ($felderText !== '') {
            array_unshift($teile, $felderText);
        }
    }

    $gebiete = avesmapsPoliticalAuditTerritoryPhrase($before, $after);
    if ($gebiete !== '') {
        $teile[] = $gebiete;
    }

    return avesmapsAuditJoinParts($teile);
}

/** PUR: die aktiven Flaechen eines Schnappschusses, nach oeffentlicher Kennung. */
function avesmapsPoliticalAuditActiveGeometries(array $payload): array
{
    $geometries = is_array($payload['geometries'] ?? null) ? $payload['geometries'] : [];
    $aktiv = [];
    foreach ($geometries as $publicId => $snapshot) {
        if (is_array($snapshot) && (int) ($snapshot['is_active'] ?? 0) === 1) {
            $aktiv[(string) $publicId] = $snapshot;
        }
    }

    return $aktiv;
}

function avesmapsPoliticalAuditAreaCountText(int $count): string
{
    if ($count < 1) {
        return 'keine Fläche';
    }

    return $count === 1 ? '1 Fläche' : $count . ' Flächen';
}

/** PUR: ein Herrschaftsgebiet selbst kann in derselben Geste stillgelegt oder geweckt werden. */
function avesmapsPoliticalAuditTerritoryPhrase(array $before, array $after): string
{
    $vorher = is_array($before['territories'] ?? null) ? $before['territories'] : [];
    $nachher = is_array($after['territories'] ?? null) ? $after['territories'] : [];

    $stillgelegt = 0;
    $geweckt = 0;
    foreach ($nachher as $publicId => $snapshot) {
        if (!is_array($snapshot) || !is_array($vorher[$publicId] ?? null)) {
            continue;
        }
        $vorherAktiv = (int) ($vorher[$publicId]['is_active'] ?? 0) === 1;
        $nachherAktiv = (int) ($snapshot['is_active'] ?? 0) === 1;
        if ($vorherAktiv && !$nachherAktiv) {
            $stillgelegt += 1;
        }
        if (!$vorherAktiv && $nachherAktiv) {
            $geweckt += 1;
        }
    }

    if ($stillgelegt > 0) {
        return $stillgelegt === 1 ? 'Gebiet stillgelegt' : $stillgelegt . ' Gebiete stillgelegt';
    }
    if ($geweckt > 0) {
        return $geweckt === 1 ? 'Gebiet wieder aktiv' : $geweckt . ' Gebiete wieder aktiv';
    }

    return '';
}
