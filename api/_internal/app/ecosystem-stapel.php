<?php

declare(strict_types=1);

require_once __DIR__ . '/ecosystem-flaeche.php';

// Die Schrittweite zwischen zwei benachbarten Raengen. Luecken, damit „ganz nach vorn"/„ganz nach
// hinten" eine Zahl ausserhalb des bisherigen Bereichs waehlen koennen, ohne alles neu zu nummerieren.
const AVESMAPS_ECOSYSTEM_STACK_STEP = 10;

// Der Rang, den eine NEU angelegte Region dieser Ebene bekommt: ganz vorn.
//
// 🔴 OHNE REGEL GIBT ES KEINEN AUTOMATISCHEN PLATZ MEHR. Bis zum 19.08.2026 sortierte der Browser
// jede Flaeche nach ihrer Groesse ein; seit die Reihenfolge gespeichert ist, braucht eine neue Region
// eine ausdrueckliche Stelle. „Das Neueste liegt obenauf" ist vorhersagbar, und ist es eine grosse
// Flaeche, schiebt der Editor sie mit einem Klick nach hinten. Sie nach Groesse einzusortieren hiesse,
// die abgeschaffte Regel lebte halb weiter -- und beim naechsten Mal wuesste niemand mehr, welche
// Ordnung gerade gilt.
function avesmapsEcosystemNextStackOrder(PDO $pdo, string $kind): int
{
    $statement = $pdo->prepare(
        'SELECT COALESCE(MAX(stack_order), 0) FROM ecosystem_region WHERE kind = :kind AND is_active = 1'
    );
    $statement->execute(['kind' => $kind]);

    return ((int) $statement->fetchColumn()) + AVESMAPS_ECOSYSTEM_STACK_STEP;
}

// ---- Die Startaufstellung ---------------------------------------------------------------------------
//
// 🔴 SIE LAEUFT EINMAL. Bis zum 19.08.2026 rechnete der BROWSER die Stapelreihenfolge bei jedem Laden
// aus der Flaechengroesse (gross unten, klein oben, ecosystemStackingOrder). Owner-Entscheid: „nimm
// das als grundlage fuer die initiale sortierung und loes die regel danach auf." Diese Funktion IST
// diese eine Ausfuehrung; danach ist die gespeicherte Zahl die Wahrheit.
//
// 🔴 SIE VERGIBT NUR AN ZEILEN MIT stack_order = 0. Ein Nachlauf ueber alle Zeilen wuerde eine von
// Hand nach hinten geschobene Region beim naechsten Aufruf wieder einsortieren -- die Regel liefe
// dann weiter, statt aufgeloest zu sein. Das ist der ganze Unterschied zwischen einer
// Startaufstellung und einer stehenden Regel.
//
// ⚠️ JE EBENE (kind) ein eigener Zahlenraum: die vier Ebenen liegen in Leaflet-Panes mit festem
// z-index (js/app/bootstrap.js), eine gemeinsame Nummerierung haette dort keine Bedeutung.
//
// ⭐ Damit ist die Funktion zugleich der Platzanweiser fuer eine NEU angelegte Region: sie steht mit
// stack_order = 0 da, bekommt MAX + Schritt und liegt damit ganz vorn. „Das Neueste liegt obenauf"
// ist vorhersagbar; nach Groesse einzusortieren hiesse, die abgeschaffte Regel lebte halb weiter.
function avesmapsEcosystemSeedStackOrder(PDO $pdo): int
{
    $rows = $pdo->query(
        'SELECT r.id, r.kind, a.geometry_geojson
           FROM ecosystem_region r
           LEFT JOIN ecosystem_area a ON a.region_id = r.id AND a.is_active = 1
          WHERE r.is_active = 1 AND r.stack_order = 0'
    )->fetchAll(PDO::FETCH_ASSOC);
    if ($rows === []) {
        return 0;
    }

    // Region -> Summe der Flaecheninhalte ihrer AKTIVEN Flaechen. Eine Region ohne Flaeche bleibt 0
    // (der LEFT JOIN liefert dann eine Zeile mit NULL) und landet damit ganz oben -- dort verdeckt
    // sie nichts.
    $groesse = [];
    $ebene = [];
    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $ebene[$id] = (string) $row['kind'];
        $geojson = $row['geometry_geojson'];
        $groesse[$id] = ($groesse[$id] ?? 0.0) + avesmapsEcosystemGeometryArea(
            $geojson === null ? null : json_decode((string) $geojson, true)
        );
    }

    $jeEbene = [];
    foreach ($groesse as $id => $flaeche) {
        $jeEbene[$ebene[$id]][] = ['id' => $id, 'flaeche' => $flaeche];
    }

    $geschrieben = 0;
    $schreiben = $pdo->prepare('UPDATE ecosystem_region SET stack_order = :rang WHERE id = :id');
    $hoechster = $pdo->prepare(
        'SELECT COALESCE(MAX(stack_order), 0) FROM ecosystem_region WHERE kind = :kind AND is_active = 1'
    );
    foreach ($jeEbene as $kind => $liste) {
        // Absteigend nach Groesse: die groesste bekommt die kleinste Zahl und liegt damit unten.
        // 🪤 STABIL bei Gleichstand -- danach nach id. Sonst wuerfelte jeder Lauf die Stapelung neu,
        // und ein Klick traefe beim zweiten Mal etwas anderes. Dieselbe Zusicherung, die die
        // abgeschaffte JS-Regel ausdruecklich trug.
        usort($liste, static function (array $links, array $rechts): int {
            return ($rechts['flaeche'] <=> $links['flaeche']) ?: ($links['id'] <=> $rechts['id']);
        });

        // Der hoechste bereits vergebene Rang dieser Ebene ist der Startpunkt -- so reiht sich ein
        // spaeterer Lauf HINTER das Bestehende ein, statt es zu ueberschreiben.
        $hoechster->execute(['kind' => $kind]);
        $rang = (int) $hoechster->fetchColumn();

        foreach ($liste as $eintrag) {
            $rang += AVESMAPS_ECOSYSTEM_STACK_STEP;
            $schreiben->execute(['rang' => $rang, 'id' => $eintrag['id']]);
            $geschrieben++;
        }
    }

    return $geschrieben;
}
