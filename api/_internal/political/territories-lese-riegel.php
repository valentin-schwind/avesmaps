<?php

declare(strict_types=1);

// Welche Anmeldung braucht eine GET-Aktion von api/app/political-territories.php?
//
// 🔴 DER BEFUND (14.09.2026, Owner-Entscheid „edit"): bis dahin gab JEDE GET-Aktion ausser den drei
// Protokoll-Lesern jedem anonymen Aufrufer heraus, was sie hatte -- `wiki_list` allein 193 rohe
// Wappenadressen von Wiki Aventurica (live gemessen), `list`/`get`/`hierarchy`/`debug`/`audit` die
// Wappenadresse aus political_territory samt editor_notes, `get`/`debug` die ganze Wiki-Zeile mit
// raw_json, `geometry_assignment` die Wappenadresse aus der Stilangabe der Geometrie. Alles am
// Lizenz-Gate (avesmapsResolveGatedCoat) und am Wappen-Notaus (app/coat-display.php) vorbei,
// NOTICE.md. Die Karte braucht davon nur `layer`, und die geht durch beide.
//
// ⭐ EINE POSITIVLISTE, KEINE SPERRLISTE: eine neue GET-Aktion ist ohne jeden Handgriff Editoren
// vorbehalten -- dieselbe Ueberlegung wie beim Schreib-Riegel im Endpunkt. Wer hier eine Aktion
// oeffentlich macht, prueft vorher, ob ihre Antwort ein Wappen, eine Notiz oder eine Wiki-Rohzeile traegt.
//
// ⚠️ Die drei Protokoll-Leser bleiben bei `review`, wie seit jeher: Reviewer lesen das Fenster
// „Aenderungen" und das Geometrie-Inventar. Ihre eigene Pruefung im Endpunkt bleibt stehen; der
// Riegel zieht die Absage fuer Anonyme nur VOR die Datenbank.
//
// Rein: keine Datenbank, keine Sitzung, keine Ausgabe.
// Test: api/_internal/__tests__/politik-lesepfade-riegel-test.php.

const AVESMAPS_POLITICAL_OEFFENTLICHE_LESEAKTIONEN = ['layer'];
const AVESMAPS_POLITICAL_REVIEW_LESEAKTIONEN = ['change_log', 'geometry_inventory', 'geometry_collision'];

/**
 * @return string|null  null = oeffentlich, sonst die Faehigkeit fuer avesmapsUserCan()
 */
function avesmapsPoliticalLeseStufe(string $action): ?string {
    if (in_array($action, AVESMAPS_POLITICAL_OEFFENTLICHE_LESEAKTIONEN, true)) {
        return null;
    }
    if (in_array($action, AVESMAPS_POLITICAL_REVIEW_LESEAKTIONEN, true)) {
        return 'review';
    }

    return 'edit';
}
