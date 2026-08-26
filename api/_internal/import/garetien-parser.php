<?php

declare(strict_types=1);

// Liest die Avesmaps-Exportseiten von garetien.de und koschwiki.de.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §1
//
// 🔴 REIN: kein I/O, keine Datenbank, kein Netz. Der Abruf steht in garetien-abruf.php,
// damit dieser Teil ohne Server testbar bleibt.

/** HTML einer Exportseite -> Zeilentext. */
function avesmapsGaretienSeitentext(string $html): string
{
    if (preg_match('~<div class="mw-parser-output">(.*?)(?:<!--\s*NewPP|</div>\s*<noscript)~s', $html, $t) === 1) {
        $html = $t[1];
    }
    $html = preg_replace('~</?(p|br)\s*/?>~i', "\n", $html) ?? $html;
    $html = preg_replace('~<[^>]+>~', '', $html) ?? $html;

    return html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/** Trennt an Komma ODER Schraegstrich -- beide Formen kommen in den Daten vor. */
function avesmapsGaretienParseVerweise(string $geo): array
{
    $teile = preg_split('~\s*/\s*|\s*,\s*~', trim($geo)) ?: [];

    return array_values(array_filter(array_map('trim', $teile), static fn(string $s): bool => $s !== ''));
}

/**
 * Koordinatenliste -> [[float, float], ...]
 *
 * 💣 ES GIBT ZWEI SCHREIBWEISEN, und der Entwurf kennt nur eine. GGP schreibt
 * "x y, x y" (Leerzeichen im Paar, Komma zwischen den Paaren), das KoschWiki bei zwei
 * Zeilen "x;y; x;y" -- Semikolon an BEIDEN Stellen. Gemessen 26.08.2026: 287 Zeilen in der
 * ersten Form, 2 in der zweiten (Angbarer See mit 69 Punkten und seine Insel mit 9).
 *
 * ⚠️ Und das Semikolon ist ausgerechnet unser FELDtrenner. Es geht nur gut, weil
 * avesmapsGaretienParseZeile() alles ab Feld 4 wieder zusammensetzt statt beim ersten
 * Semikolon aufzuhoeren -- wer das "vereinfacht", verliert diese zwei Zeilen erneut.
 *
 * ⭐ Deshalb wird hier nicht an Trennzeichen zerlegt, sondern es werden die ZAHLEN der Reihe
 * nach gelesen und paarweise genommen. Das ist gegen beide Schreibweisen dasselbe Verfahren.
 * Gegenprobe an den echten Daten: auf allen 287 Zeilen der ersten Form Punkt fuer Punkt
 * identisch zur zerlegenden Fassung -- ein Zusatz, kein Umbau.
 */
function avesmapsGaretienParseKoordinaten(string $geo): array
{
    if (preg_match_all('~-?\d+(?:\.\d+)?~', $geo, $treffer) === false) {
        return [];
    }
    $zahlen = $treffer[0];
    $anzahl = count($zahlen);
    $punkte = [];
    for ($i = 0; $i + 1 < $anzahl; $i += 2) {
        $punkte[] = [(float) $zahlen[$i], (float) $zahlen[$i + 1]];
    }

    return $punkte;
}

/** Eine Zeile der Exportseite. null = Steuerzeile oder unbrauchbar. */
function avesmapsGaretienParseZeile(string $zeile): ?array
{
    $zeile = trim($zeile);
    if ($zeile === '' || str_starts_with($zeile, 'K:')) {
        return null;
    }
    $felder = explode(';', $zeile);
    if (count($felder) < 4) {
        return null;
    }
    $kopf = $felder[0];
    $geo = trim(implode(';', array_slice($felder, 3)));

    // Kopf: Typ:[Namensraum:]Artikel!Anzeige -- der Namensraum fehlt, wenn der Artikel im
    // Hauptnamensraum liegt; Artikel und Anzeige fehlen, wenn es keinen Artikel gibt.
    [$typ, $rest] = array_pad(explode(':', $kopf, 2), 2, '');
    $teile = explode(':', $rest);
    $namensraum = count($teile) > 1 ? array_shift($teile) : '';
    $benennung = implode(':', $teile);
    [$artikel, $anzeige] = array_pad(explode('!', $benennung, 2), 2, null);
    if ($anzeige === null) {
        // Kein "!": es gibt keinen Artikel, der Text IST der Anzeigename.
        $anzeige = $artikel;
        $artikel = '';
    }
    [$lodmin, $lodmax] = array_pad(explode('!', $felder[1], 2), 2, '');

    return [
        'typ' => trim($typ),
        'namensraum' => trim($namensraum),
        'artikel' => trim((string) $artikel),
        'anzeige' => trim((string) $anzeige),
        'lodmin' => trim($lodmin),
        'lodmax' => trim($lodmax),
        'extra' => trim($felder[2]),
        // 💣 Das Trennzeichen im Paar ist Leerzeichen ODER Semikolon (siehe
        // avesmapsGaretienParseKoordinaten). Ohne das ";" hier gelten die zwei
        // Kosch-Zeilen als Verweisliste, und weil eine unaufloesbare Verweisliste einfach
        // nichts ergibt, verschwindet der Angbarer See lautlos aus dem Import.
        'geo_art' => preg_match('~^\s*-?\d+(\.\d+)?[\s;]+-?\d+~', $geo) === 1 ? 'koordinaten' : 'verweise',
        'geo' => $geo,
        'roh' => $zeile,
    ];
}
