<?php

declare(strict_types=1);

// Der EINE Widerspruchsriegel des dritten Zustands („Kein Wiki-Artikel vorhanden").
//
// 💣 WARUM DAS EINE EIGENE DATEI IST -- und nicht mehr bloss ein Absatz in features.php: seit dem
// 16.08.2026 braucht ihn auch die LANDSCHAFT (avesmapsUpdateEcosystemRegion,
// api/_internal/app/ecosystem.php), und die liegt hinter api/app/ecosystem-areas.php auf dem
// OEFFENTLICHEN Leseweg der Karte. `require_once` von features.php (3.471 Zeilen) dorthin waere ein
// Fremdkoerper im heissesten Pfad, den diese Ebene hat -- AGENTS.md §10 fuehrt genau solche
// Zusatzlasten als Bremsen. Die Regel selbst ist sechs Zeilen; sie zieht um, statt sich zu
// verdoppeln.
//
// 🔴 EINE Stelle, drei Leser: die Schreibwege duerfen den Widerspruch nicht verschieden begruenden.
// Er wird ABGELEHNT, nicht aufgeloest -- ein stummer Vorrang waere eine Regel, die niemand kennt,
// und der Merker wird an drei Stellen gelesen (Editor, Konfliktzentrum, Abgleich).
//
// ⚠️ Der Satz nennt die Objektart und den AUSWEG, weil beide je Oberflaeche verschieden heissen: bei
// der Kraftlinie steht ein Adressfeld im Formular („den Link leeren"), beim Ort und bei der
// Landschaft steht dort ein Zuweisungskasten und gar kein Adressfeld mehr („die Zuweisung
// entfernen"). Eine gemeinsame Formulierung waere fuer eine der beiden ein Rat ins Leere.
function avesmapsAssertWikiClaimNotContradictory(string $wikiUrl, bool $noArticle, string $subjekt, string $ausweg): void {
    if ($noArticle && trim($wikiUrl) !== '') {
        throw new InvalidArgumentException(
            $subjekt . ' kann nicht gleichzeitig einen Wiki-Artikel haben und keinen. ' . $ausweg
        );
    }
}
