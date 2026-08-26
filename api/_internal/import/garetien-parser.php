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

/** "x y, x y, ..." -> [[float, float], ...] */
function avesmapsGaretienParseKoordinaten(string $geo): array
{
    $punkte = [];
    foreach (explode(',', $geo) as $stueck) {
        $zahlen = preg_split('~\s+~', trim($stueck)) ?: [];
        if (count($zahlen) >= 2 && is_numeric($zahlen[0]) && is_numeric($zahlen[1])) {
            $punkte[] = [(float) $zahlen[0], (float) $zahlen[1]];
        }
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
        'geo_art' => preg_match('~^\s*-?\d+(\.\d+)?\s+-?\d+~', $geo) === 1 ? 'koordinaten' : 'verweise',
        'geo' => $geo,
        'roh' => $zeile,
    ];
}
