<?php

declare(strict_types=1);

// „Was ist hier?" -- was an einer angeklickten Kartenstelle liegt.
// Entwurf: docs/superpowers/specs/2026-08-15-was-ist-hier-design.md
//
// REINHEITSVERTRAG (wie climate-membership.php): auf `include` passiert nichts, kein DDL, keine
// Globals. Die Geometrie-Haelfte ist rein und unit-getestet; die DB-Haelfte nimmt ein PDO
// ausdruecklich entgegen und faellt INERT aus -- eine fehlende Tabelle heisst „keine Antwort",
// nie ein 500er auf einem Besucherpfad.
//
// 🔴 KEIN EIGENER PUNKT-IN-POLYGON. avesmapsClimateGeometryContains kann Loecher und
// MultiPolygone und ist getestet; ein zweiter waere die Divergenz, vor der AGENTS §12 warnt.
require_once __DIR__ . '/climate-membership.php';

// Die drei gezeichneten Landschaftsebenen plus die abgeleitete. Reihenfolge = Zeilenfolge im Panel.
const AVESMAPS_WHAT_IS_HERE_KINDS = ['derographisch', 'topographie', 'vegetation', 'klima'];

// 🔴 Fix-Runde 3: Deckel fuer den parent_id-Lauf der Herrschaftskette (siehe
// avesmapsWhatIsHereAncestorChain unten). Die tiefste bekannte Kette hat vier Stufen; 12 ist ein
// grosszuegiger Puffer, der eine defekte/zyklische Elternkette trotzdem nicht endlos laufen laesst --
// dieselbe Schutzhoehe wie der 32er-Deckel in avesmapsWhatIsHereOrderTerritories, nur enger, weil
// dieser Lauf tatsaechlich bis zu 12 zusaetzliche Datenbankzugriffe kosten kann.
const AVESMAPS_WHAT_IS_HERE_MAX_ANCESTOR_DEPTH = 12;

/**
 * REIN: die Treffer eines Punktes -> die Kette BLATT -> WURZEL, entdoppelt.
 *
 * 💣 BLATT ZUERST, und das ist keine Geschmacksfrage: buildSettlementHierarchyMarkup
 * (js/ui/popups.js:863) erwartet genau diese Richtung und dreht selbst um -- dieselbe, die
 * map-features.php einer Siedlung mitgibt. Andersherum geliefert zeigt die Treppe verkehrt.
 *
 * 💣 ENTDOPPELT UEBER public_id DES GEBIETS, nicht ueber die der Geometrie: ein Gebiet kann mit
 * mehreren Geometriezeilen im bbox liegen (am 15.08.2026 auf Maraskan gemessen: zweimal dieselbe
 * Fuerstkomturei), und zwei Stufen desselben Namens sind eine Treppe, die es nicht gibt.
 *
 * ⚠️ DIESE Funktion allein bestimmt die Tiefe NUR INNERHALB der uebergebenen Trefferliste -- sie
 * macht keinen eigenen Elternlauf. 🔴 Fix-Runde 3, KORRIGIERT: bis 15.08.2026 stand hier, das sei
 * Absicht ("ein Vorfahr, dessen Flaeche den Punkt nicht deckt, taucht nicht auf … hier ist es
 * Absicht und kostet keine Abfrage"). Live gemessen war das falsch: Vorfahren wie Grafschaft/
 * Fuerstentum/Kaiserreich sind ABGELEITETE Aussengrenzen (political_territory_derived_geometry,
 * is_aggregate=true) und tragen strukturell NIE eine eigene gezeichnete Flaeche -- die Kette hatte
 * dadurch fast immer nur EINE Stufe statt vier. Die Treppe braucht deshalb zusaetzlich den
 * parent_id-Lauf der Siedlung (api/app/map-features.php, ~Zeile 780-798) -- er laeuft in
 * avesmapsWhatIsHereReadAncestors() weiter unten, ab dem tiefsten Ergebnis DIESER Funktion, und
 * ergaenzt genau die Stufen, die hier fehlen. Diese Funktion selbst bleibt unveraendert: sie dedupt
 * und ordnet weiterhin nur, was tatsaechlich gezeichnete Geometrie traegt (der seltene Fall mehrerer
 * ueberlappender gezeichneter Ebenen, z. B. Baronie UND Grafschaft beide mit eigener Flaeche).
 *
 * @param list<array<string,mixed>> $rows
 * @return list<array<string,mixed>>
 */
function avesmapsWhatIsHereOrderTerritories(array $rows): array
{
    $byPublicId = [];
    $byId = [];
    foreach ($rows as $row) {
        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId === '' || isset($byPublicId[$publicId])) {
            continue;
        }
        $byPublicId[$publicId] = $row;
        $byId[(int) ($row['id'] ?? 0)] = $publicId;
    }

    $tiefe = [];
    foreach ($byPublicId as $publicId => $row) {
        $stufen = 0;
        $eltern = (int) ($row['parent_id'] ?? 0);
        // Deckel: eine zyklische Elternangabe darf hier nicht haengen bleiben.
        while ($eltern !== 0 && isset($byId[$eltern]) && $stufen < 32) {
            $stufen++;
            $eltern = (int) ($byPublicId[$byId[$eltern]]['parent_id'] ?? 0);
        }
        $tiefe[$publicId] = $stufen;
    }

    $kette = array_values($byPublicId);
    usort($kette, static fn(array $a, array $b): int
        => $tiefe[(string) $b['public_id']] <=> $tiefe[(string) $a['public_id']]);

    return $kette;
}

/**
 * REIN: eine Knotenmenge (id -> Zeile) plus eine Start-id -> die Vorfahrenkette ab dort, Blatt -> Wurzel.
 *
 * 🔴 Fix-Runde 3: die Ergaenzung, die avesmapsWhatIsHereOrderTerritories() fehlte. Vorlage ist der
 * parent_id-Lauf der Siedlungs-Herrschaftskette (api/app/map-features.php, ~Zeile 780-798,
 * "Build the current-era ancestor chain") -- hier verallgemeinert auf eine reine Funktion, die eine
 * FERTIGE Knotenmenge entgegennimmt statt sie selbst zu laden. Dadurch ohne Datenbank testbar: eine
 * Testdatei kann eine Knotenmenge von Hand bauen und braucht kein PDO.
 *
 * 💣 GEDECKELT bei AVESMAPS_WHAT_IS_HERE_MAX_ANCESTOR_DEPTH Stufen, mit Besuchsriegel gegen
 * zyklische Elterndaten -- dieselbe Vorsichtsmassnahme wie in der Vorlage (dort ueber wiki_key,
 * hier ueber die id, weil diese Funktion keine "aktuelle Aera"-Aufloesung kennt, siehe unten).
 *
 * ⚠️ KEIN ZEITBEZUG (bewusste Entscheidung, Fix-Runde 3 -- siehe Bericht und Entwurf §3): der Lauf
 * folgt parent_id als Organigramm, nicht als BF-datierte Beziehung. Genau wie die Vorlage in
 * map-features.php, die ueber currentIdByWikiKey IMMER den aktuellsten Knoten je wiki_key waehlt,
 * unabhaengig vom betrachteten Jahr -- nicht wie die BLATT-Abfrage in avesmapsWhatIsHereReadTerritories,
 * die sehr wohl nach valid_from_bf/valid_to_bf filtert (dort gibt es je Punkt oft mehrere GEZEICHNETE
 * Epochen zur Auswahl). Fuer Vorfahren gibt es diese Auswahl strukturell nicht: eine Zeile in
 * political_territory pro Organigramm-Knoten, nicht mehrere Epochen-Geometrien. Ein Filter auf
 * `political_territory.valid_from_bf/valid_to_bf` waere hier zudem riskanter als nuetzlich -- am
 * 15.08.2026 gemessen tragen zwei der drei betroffenen Vorfahren `valid_to_bf = NULL`, und ein
 * Filter haette bei jeder Zeile mit einer engen (oder falsch gepflegten) Zeitspanne die Kette
 * lautlos wieder abgeschnitten: derselbe Fehlerbild, das dieser ganze Fix-Termin gerade behebt, nur
 * eine Ebene hoeher. Weder wird `is_active` geprueft -- die BLATT-Abfrage direkt oberhalb prueft es
 * fuer die Elternzeile (`t.is_active`) ebenfalls nicht, ein Filter hier waere also eine schaerfere
 * Regel fuer Vorfahren als fuer das Blatt selbst.
 *
 * @param array<int,array<string,mixed>> $byId Knoten, indiziert nach id (int)
 * @return list<array<string,mixed>>
 */
function avesmapsWhatIsHereAncestorChain(array $byId, int $startId): array
{
    $chain = [];
    $visited = [];
    $currentId = $startId;
    while ($currentId !== 0 && isset($byId[$currentId]) && !isset($visited[$currentId])
        && count($chain) < AVESMAPS_WHAT_IS_HERE_MAX_ANCESTOR_DEPTH) {
        $visited[$currentId] = true;
        $node = $byId[$currentId];
        $chain[] = $node;
        $currentId = (int) ($node['parent_id'] ?? 0);
    }

    return $chain;
}

/**
 * REIN: die geordnete Kette -> die OEFFENTLICHE Form je Stufe.
 *
 * 💣 `id`/`parent_id` sind interne DB-Identitaeten -- avesmapsWhatIsHereOrderTerritories braucht sie
 * nur fuer die Tiefenrechnung, niemand ausserhalb dieser Datei. Sie in der oeffentlichen Antwort
 * stehen zu lassen hiesse, interne Datenbank-Identitaeten zu veroeffentlichen, die niemand braucht.
 *
 * 🔴 `territory_public_id`, NICHT `public_id`: buildSettlementHierarchyMarkup (js/ui/popups.js:863)
 * liest ueber settlementTerritoryLinkMarkup (Zeile 831) `node.territory_public_id` -- genau das Feld,
 * das api/app/map-features.php:812 fuer denselben Treppentyp baut. Ohne die Umbenennung HIER liefe
 * jeder Gold-Flug-Link der Treppe lautlos ins Leere (data-political-public-id="").
 *
 * ⚠️ `wiki_key` fehlt hier ABSICHTLICH nicht aus Nachlaessigkeit, sondern weil er in der OEFFENTLICHEN
 * Antwort nichts verloren hat -- avesmapsWhatIsHereLoreKeys() liest ihn weiterhin aus der UNGEKUERZTEN
 * Kette (siehe api/app/what-is-here.php: dort laeuft sie VOR dieser Funktion, nicht danach). Wer diese
 * Funktion vor avesmapsWhatIsHereLoreKeys() anwendet, nimmt lore.place jeden Territoriums-Schluessel
 * lautlos weg -- genau der stille Bruch, den diese Funktion selbst fuer die Treppe verhindern soll.
 *
 * @param list<array<string,mixed>> $rows geordnete Kette aus avesmapsWhatIsHereOrderTerritories
 * @return list<array{name:string,short_name:string,type:string,territory_public_id:string,coat_url:string}>
 */
function avesmapsWhatIsHereTerritoryPayload(array $rows): array
{
    return array_map(
        static fn(array $row): array => [
            'name' => (string) ($row['name'] ?? ''),
            'short_name' => (string) ($row['short_name'] ?? ''),
            'type' => (string) ($row['type'] ?? ''),
            'territory_public_id' => (string) ($row['public_id'] ?? ''),
            'coat_url' => (string) ($row['coat_url'] ?? ''),
        ],
        $rows
    );
}

/**
 * REIN: woraus „Natur & Waren" an dieser Stelle bestehen darf.
 *
 * 🔴 DIE DEROGRAPHIE LIEFERT KEINEN `place`-SCHLUESSEL. Ihre Flaeche heisst „Aventurien", und
 * daran haengen 1.167 Lore-Eintraege (lore.php?stats=1). Ihr Schluessel hier hiesse: jeder Punkt
 * der Karte listet dieselben 1.167. Was ueberall gilt, sagt ueber diese Stelle nichts -- dieselbe
 * Begruendung, mit der die Infobox rank-3-Eintraege aus der Vorschau nimmt.
 *
 * ⚠️ In `area` steht sie trotzdem: dort greift die Lebensraum-REGEL gegen die Region, nicht die
 * Ortsverknuepfung eines Wiki-Artikels. Zwei Quellen, zwei Listen, eine Anfrage.
 *
 * @return array{place: list<string>, area: list<string>}
 */
function avesmapsWhatIsHereLoreKeys(array $territories, array $areas): array
{
    $place = [];
    foreach ($territories as $row) {
        $key = avesmapsWhatIsHereLoreKey((string) ($row['wiki_key'] ?? ''));
        if ($key !== '' && !in_array($key, $place, true)) {
            $place[] = $key;
        }
    }

    $area = [];
    foreach ($areas as $row) {
        $publicId = (string) ($row['region_public_id'] ?? '');
        if ($publicId !== '' && !in_array($publicId, $area, true)) {
            $area[] = $publicId;
        }
        if ((string) ($row['kind'] ?? '') === 'derographisch') {
            continue;
        }
        $key = avesmapsWhatIsHereLoreKey((string) ($row['wiki_region_key'] ?? ''));
        if ($key !== '' && !in_array($key, $place, true)) {
            $place[] = $key;
        }
    }

    return ['place' => $place, 'area' => $area];
}

/**
 * REIN: ein gespeicherter Schluessel -> die Form, die lore.php erwartet.
 *
 * ⚠️ Das Praefix `wiki:` muss weg (avesmapsLoreNormalizeKey im Browser tut dasselbe), und was
 * uebrig bleibt, muss dem erlaubten Zeichenvorrat entsprechen -- sonst weist lore.php es ab und
 * die Zeile bleibt still leer.
 */
function avesmapsWhatIsHereLoreKey(string $raw): string
{
    $key = strtolower(trim($raw));
    if (str_starts_with($key, 'wiki:')) {
        $key = substr($key, 5);
    }

    return preg_match('/^[a-z0-9_-]{1,190}$/', $key) === 1 ? $key : '';
}

/**
 * Die Gebiete, in denen der Punkt liegt -- bbox-Vorfilter in SQL, echter Punkttest in PHP.
 *
 * 💣 bbox IST EIN VORFILTER, KEIN TREFFER. Am Seepunkt (640/300) lagen 9 Gebiete im bbox und 0
 * haben den Punkttest bestanden. Wer den bbox-Treffer fuer die Antwort haelt, schreibt vier
 * Herrschaften mitten ins Perlenmeer.
 *
 * 🔴 KEINE ZOOM-FILTERUNG. Der Layer-Endpunkt kappt nach min_zoom/max_zoom, weil er ZEICHNET.
 * Hier wird nicht gezeichnet: das Kaiserreich rendert nur auf Zoom 0-1, ist aber auch auf Zoom 5
 * das Reich dieses Punktes.
 *
 * ⚠️ Inert bei fehlender Tabelle: eine frische Installation hat keinen Politik-Layer, und ein
 * 500er auf dem Besucherpfad waere die falsche Antwort darauf.
 *
 * ⚠️ ABWEICHUNG VOM ENTWURF (geprueft 15.08.2026 gegen sql/political-territories.sql UND live
 * gegen territories-layer.php/territories-read.php, die dieselbe Spalte lesend abfragen): die
 * Basistabelle `political_territory` fuehrt das Wappenfeld als `coat_of_arms_url`, nicht als
 * `coat_url`. Aliasiert auf `coat_url`, damit die Ausgabeform mit dem Entwurf §3 und den
 * Testfixturen uebereinstimmt -- die Tabelle gewinnt beim SPALTENNAMEN, die Ausgabeform bleibt.
 */
function avesmapsWhatIsHereReadTerritories(PDO $pdo, float $x, float $y, int $yearBf): array
{
    try {
        // 🔴 Fix-Runde 2: :x1/:x2 und :y1/:y2 statt je einmal :x/:y. avesmapsCreatePdo
        // (api/_internal/bootstrap.php) setzt PDO::ATTR_EMULATE_PREPARES => false -- bei nativen
        // Prepared Statements lehnt MySQL einen doppelt verwendeten benannten Platzhalter mit
        // SQLSTATE[HY093] ab. Die Ausnahme landete im catch (Throwable) unten und wurde live zu einer
        // stillen leeren Antwort (ok:true, aber territories/landscapes komplett leer). :jahr/:jahr2
        // waren schon getrennt -- das Muster war bekannt, hier nur nicht angewandt.
        $statement = $pdo->prepare(
            'SELECT t.id, t.parent_id, t.public_id, t.wiki_key, t.name, t.short_name, t.type,
                    t.coat_of_arms_url AS coat_url, g.geometry_geojson
               FROM political_territory_geometry g
               JOIN political_territory t ON t.id = g.territory_id
              WHERE g.is_active = 1
                AND g.min_x <= :x1 AND g.max_x >= :x2
                AND g.min_y <= :y1 AND g.max_y >= :y2
                AND (g.valid_from_bf IS NULL OR g.valid_from_bf <= :jahr)
                AND (g.valid_to_bf   IS NULL OR g.valid_to_bf   >= :jahr2)'
        );
        $statement->execute(['x1' => $x, 'x2' => $x, 'y1' => $y, 'y2' => $y, 'jahr' => $yearBf, 'jahr2' => $yearBf]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $treffer = [];
    foreach ($rows as $row) {
        $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
        if (!avesmapsClimateGeometryContains($geometry, $x, $y)) {
            continue;
        }
        unset($row['geometry_geojson']); // 💣 Die Geometrie verlaesst diesen Endpunkt NIE.
        $treffer[] = $row;
    }

    // 🔴 ABWEICHUNG: avesmapsWhatIsHereTerritoryPayload() wird HIER absichtlich NICHT angewandt.
    // api/app/what-is-here.php reicht genau diesen Rueckgabewert ein zweites Mal an
    // avesmapsWhatIsHereLoreKeys() weiter, die je Stufe `wiki_key` braucht (Territorien-Zweig von
    // lore.place). Striche man wiki_key schon hier, verlöre lore.place JEDEN Territoriums-Schluessel
    // lautlos -- genau der stille Bruch, den die neue Funktion fuer die Treppe verhindern soll, waere
    // an anderer Stelle wieder da. avesmapsWhatIsHereTerritoryPayload() laeuft deshalb im Endpunkt,
    // NACH avesmapsWhatIsHereLoreKeys() und NUR fuer das JSON-Feld `territories`.
    $kette = avesmapsWhatIsHereOrderTerritories($treffer);
    if ($kette === []) {
        return [];
    }

    // 🔴 Fix-Runde 3: der Elternlauf schliesst da an, wo die gezeichneten Treffer aufhoeren -- an der
    // SHALLOWSTEN (letzten) Stufe von $kette, nicht an der tiefsten. Im Normalfall (genau ein
    // gezeichneter Treffer) ist das dieselbe Zeile; im seltenen Mehrfachtreffer-Fall (Baronie UND
    // Grafschaft beide mit eigener Flaeche) haengt der Lauf so an die bereits geordnete Kette an,
    // statt eine ihrer Stufen zu ueberspringen oder doppelt zu holen.
    $letzteStufe = $kette[count($kette) - 1];
    $elternId = (int) ($letzteStufe['parent_id'] ?? 0);
    $vorfahren = $elternId !== 0 ? avesmapsWhatIsHereReadAncestors($pdo, $elternId) : [];

    return array_merge($kette, $vorfahren);
}

/**
 * Die Vorfahrenkette EINES Gebiets aus der Datenbank -- reiner parent_id-Lauf, Blatt -> Wurzel,
 * ab genau der id, mit der die Funktion aufgerufen wird (die id selbst ist die erste Stufe der
 * Rueckgabe).
 *
 * 🔴 Fix-Runde 3: der DB-seitige Teil zu avesmapsWhatIsHereAncestorChain() oben. Baut die
 * Knotenmenge SCHRITTWEISE auf -- ein `SELECT … WHERE id = :id`, einmal vorbereitet und je Stufe
 * erneut ausgefuehrt, statt zwoelfmal neu zu prepare'n. Indizierte Primaerschluessel-Zugriffe, also
 * billig, aber trotzdem je Stufe genau EIN Zugriff, nie mehr.
 *
 * ⚠️ Das Statement kann nicht auf einen Rutsch alle Stufen holen (WHERE id IN (…)): die Ober-ids
 * sind erst bekannt, NACHDEM die jeweils vorige Zeile gelesen ist -- ein Elternlauf ist strukturell
 * sequentiell.
 *
 * 💣 Inert wie die Blatt-Abfrage: eine fehlende Tabelle oder ein Verbindungsfehler liefert eine LEERE
 * Kette, nie einen 500er auf dem Besucherpfad -- und wirft NICHT nach aussen. Ein Fehler im
 * Elternlauf darf die bereits gefundenen Blatt-Treffer nicht mit sich reissen; deshalb faengt diese
 * Funktion ihre eigenen Ausnahmen, statt sie an avesmapsWhatIsHereReadTerritories() durchzureichen.
 */
function avesmapsWhatIsHereReadAncestors(PDO $pdo, int $startId): array
{
    try {
        $statement = $pdo->prepare(
            'SELECT id, parent_id, public_id, wiki_key, name, short_name, type,
                    coat_of_arms_url AS coat_url
               FROM political_territory
              WHERE id = :id'
        );
    } catch (Throwable) {
        return [];
    }

    $byId = [];
    $currentId = $startId;
    $besucht = [];
    while ($currentId !== 0 && !isset($besucht[$currentId]) && count($byId) < AVESMAPS_WHAT_IS_HERE_MAX_ANCESTOR_DEPTH) {
        $besucht[$currentId] = true;
        try {
            $statement->execute(['id' => $currentId]);
            $row = $statement->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable) {
            break;
        }
        if ($row === false) {
            break; // Elternkette zeigt auf eine id, die es nicht (mehr) gibt -- Kette endet hier.
        }
        $row['id'] = (int) $row['id'];
        $byId[$row['id']] = $row;
        $currentId = (int) ($row['parent_id'] ?? 0);
    }

    return avesmapsWhatIsHereAncestorChain($byId, $startId);
}

/**
 * Die Landschaftsflaechen, in denen der Punkt liegt -- eine Abfrage fuer alle vier Ebenen.
 *
 * ⚠️ Mehrere Treffer je Ebene sind der NORMALFALL, nicht der Sonderfall: am Landpunkt liegen
 * „Dunkelwald" und „Flusslande" uebereinander. Die Antwort ist deshalb eine Liste je Ebene.
 */
function avesmapsWhatIsHereReadAreas(PDO $pdo, float $x, float $y): array
{
    try {
        // 🔴 Fix-Runde 2: derselbe Fehler wie in avesmapsWhatIsHereReadTerritories() -- :x1/:x2 und
        // :y1/:y2 statt je einmal :x/:y. EMULATE_PREPARES => false erlaubt keinen doppelt
        // verwendeten benannten Platzhalter in einem nativen Prepared Statement (SQLSTATE[HY093]).
        $statement = $pdo->prepare(
            'SELECT r.kind, r.public_id AS region_public_id, r.name AS region_name,
                    r.wiki_region_key, ty.label AS type_label, a.geometry_geojson
               FROM ecosystem_area a
               JOIN ecosystem_region r ON r.id = a.region_id
          LEFT JOIN ecosystem_region_type ty ON ty.type_key = r.region_type AND ty.kind = r.kind
              WHERE a.is_active = 1 AND a.is_trial = 0
                AND a.min_x <= :x1 AND a.max_x >= :x2
                AND a.min_y <= :y1 AND a.max_y >= :y2'
        );
        $statement->execute(['x1' => $x, 'x2' => $x, 'y1' => $y, 'y2' => $y]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $treffer = [];
    foreach ($rows as $row) {
        $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
        if (!avesmapsClimateGeometryContains($geometry, $x, $y)) {
            continue;
        }
        unset($row['geometry_geojson']);
        $treffer[] = $row;
    }

    return $treffer;
}
