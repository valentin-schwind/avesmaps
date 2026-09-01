<?php

declare(strict_types=1);

/**
 * Einen EIGENEN Knoten (`eigener-knoten:knotenNNN`) nachtraeglich an einen Wiki-Artikel binden.
 *
 * Entwurf: docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md
 *
 * 🔴 DER WIKI-KNOTEN GEWINNT (Owner 02.09.2026, zweimal so entschieden). Die Zielzeile ist das
 * Gebiet mit dem Wiki-Schluessel -- sie wird angelegt, wenn es sie noch nicht gibt. Die eigene
 * Zeile wandert danach in den Papierkorb (`is_active = 0`, weich und umkehrbar). Damit WECHSELT
 * die public_id, und genau deshalb muessen die Ziele aus dem Entwurf §4 mitwandern.
 *
 * 💣 DIE WANDERUNG GEHT DURCH GENAU EINE FUNKTION -- avesmapsEigenerKnotenBindungAnwenden.
 * Die Ziele je an ihrer eigenen Aufrufstelle zu erledigen ist die Bauform, die dieses Haus schon
 * dreimal bezahlt hat (Verkehrsmittel-Sperre 14.08.2026, Ausstiegsregel 15.08.2026,
 * Ketten-Deaktivierung 16.08.2026). Hier steht bewusst KEINE ZAHL: eine Zahl liest sich wie eine
 * vollstaendige Liste, und niemand zaehlt nach. Die Liste steht im Entwurf und wird von
 * __tests__/eigener-knoten-wiki-bindung-ziele-test.php gegen diesen Code gehalten.
 */

require_once __DIR__ . '/../political/territory.php';

/**
 * REIN: die Uebernahme-Vorschau je Feld.
 *
 * 🔴 Die drei Zustaende und ihre Vorbelegung sind die Hausregel des Wiki-Overrides (17.08.2026),
 * angewandt auf den Sonderfall "bei einem eigenen Knoten ist JEDES Feld ein Override":
 *   gleich      -> vorangehakt, der Override faellt weg, das Feld ist kuenftig Wiki-gepflegt
 *   abweichend  -> NICHT vorangehakt, bleibt "von uns"
 *   luecke      -> vorangehakt, das Wiki fuellt
 * Ohne die erste Zeile kaeme aus dem Wiki nie etwas an.
 *
 * ⚠️ Beidseitig leere Felder fallen heraus -- sie tragen keine Entscheidung.
 */
function avesmapsEigenerKnotenBindungVorschau(array $overrides, array $wikiRow): array
{
    $zeilen = [];
    foreach (avesmapsWikiSyncMonitorEditableFields() as $feld => $label) {
        $eigen = trim((string) ($overrides[$feld] ?? ''));
        $wiki = trim((string) ($wikiRow[$feld] ?? ''));
        if ($eigen === '' && $wiki === '') {
            continue;
        }
        if ($eigen === $wiki) {
            $zustand = 'gleich';
        } elseif ($eigen === '') {
            $zustand = 'luecke';
        } else {
            $zustand = 'abweichend';
        }
        $zeilen[] = [
            'field' => $feld,
            'label' => $label,
            'own' => $eigen,
            'wiki' => $wiki,
            'state' => $zustand,
            'default_checked' => $zustand !== 'abweichend',
        ];
    }

    return $zeilen;
}
