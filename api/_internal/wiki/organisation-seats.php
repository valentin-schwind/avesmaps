<?php

declare(strict_types=1);

// Die Sitze einer Handelsorganisation -- Handelsgesellschaften, Bankhäuser, Reedereien.
// ===========================================================================================
// Sie tragen {{Infobox Organisation}} und haben deshalb KEIN |Standort=, sondern |Hauptsitz=
// und |Weitere Sitze=. Damit brechen sie das Innerorts-Modell: ein Objekt dort hat EINEN Ort,
// und sein Titel ist der Schlüssel. „Nordlandbank" liegt aber an 35 Orten.
//
// Diese Datei ist der reine PARSER: Wikitext rein, Liste von {Ort-Rohtext, Rolle} raus. Sie
// löst KEINE Ortsnamen auf und kennt die Karte nicht.
//
// ⭐ DAS IST DER GANZE TRICK. Der Rohtext geht unverändert an place-scope.php, das seit dem
// 27.07.2026 gegen die echten Kartenorte auflöst -- dieselbe Maschine, die |Standort= bewertet.
// Ein eigener Auflöser hier wäre eine zweite Fassung derselben Regel, und er würde an den
// Formen scheitern, die das Feld tatsächlich enthält (gemessen 2026-08-16):
//
//   [[Festum]]                                            einfach
//   [[Zorgan]]: [[Mondsilberpalast]]                      Ortskette, wie bei |Standort=
//   [[Bethana|Bethana]]                                   Pipe-Link
//   Kontore: [[Havena (Siedlung)|Havena]], …              Freitext-Präfix vor der Liste
//   [[Festum]] <small>(Hauptsitz bis [[1027 BF]])</small> 💣 ein JAHR als Link
//
// 💣 Die letzte Form ist der Grund für diese Arbeitsteilung: wer blind alle [[…]] einsammelt,
// macht aus „1027 BF" einen Sitz. place-scope verwirft ihn, weil es keine Siedlung dieses
// Namens auf der Karte gibt -- der Schutz ist bereits gebaut und muss nur benutzt werden.

// Die Rollen. „hauptsitz" beantwortet „wo sitzt die Nordlandbank WIRKLICH" -- bei 35 Filialen
// ist das die eigentliche Frage.
const AVESMAPS_ORG_SEAT_ROLE_MAIN = 'hauptsitz';
const AVESMAPS_ORG_SEAT_ROLE_BRANCH = 'zweigsitz';

// Wortmarken, die einen AUFGELÖSTEN Sitz kennzeichnen. Fünf Artikel führen solche (gemessen
// 2026-08-16). Eine Filiale, die es nicht mehr gibt, gehört nicht in die Stadt-Infobox.
// ⚠️ Am STÜCK geprüft, nicht am ganzen Feld: „…, [[Mendena]] <small>(ehemals)</small>, …"
// darf nur Mendena entwerten, nicht die ganze Liste. Dieselbe Lehre wie bei den Nähe-Markern
// in place-scope.php (feldweit gelesen kippte dort ein einzelnes „östlich von" alles).
const AVESMAPS_ORG_SEAT_DEAD_MARKERS = ['ehemals', 'ehemalig', 'aufgelöst', 'aufgeloest', 'zerstört', 'zerstoert'];

/**
 * PURE: zerlegt ein Sitz-Feld in seine einzelnen Sitz-STÜCKE.
 *
 * Getrennt wird an Komma und Semikolon -- aber NUR ausserhalb von [[…]], sonst zerrisse
 * „[[Ort, mit Komma]]" in zwei Hälften. Freitext-Präfixe („Kontore:", „Handelsstationen:")
 * bleiben am Stück kleben; das stört nicht, weil place-scope ohnehin nur die Links liest.
 *
 * @return list<string> Rohstücke, Reihenfolge wie im Feld, leere entfernt
 */
function avesmapsOrgSeatSplitField(string $value): array
{
    $stuecke = [];
    $aktuell = '';
    $tiefe = 0;
    $len = strlen($value);
    for ($i = 0; $i < $len; $i++) {
        $c = $value[$i];
        if ($c === '[' && $i + 1 < $len && $value[$i + 1] === '[') {
            $tiefe++;
            $aktuell .= '[[';
            $i++;
            continue;
        }
        if ($c === ']' && $i + 1 < $len && $value[$i + 1] === ']') {
            $tiefe = max(0, $tiefe - 1);
            $aktuell .= ']]';
            $i++;
            continue;
        }
        if ($tiefe === 0 && ($c === ',' || $c === ';')) {
            $stuecke[] = $aktuell;
            $aktuell = '';
            continue;
        }
        $aktuell .= $c;
    }
    $stuecke[] = $aktuell;

    return array_values(array_filter(
        array_map('trim', $stuecke),
        static fn(string $s): bool => $s !== '' && str_contains($s, '[[')
    ));
}

/**
 * PURE: trägt dieses Stück einen Hinweis, dass der Sitz aufgelöst ist?
 */
function avesmapsOrgSeatIsDead(string $stueck): bool
{
    $klein = mb_strtolower($stueck, 'UTF-8');
    foreach (AVESMAPS_ORG_SEAT_DEAD_MARKERS as $marke) {
        if (str_contains($klein, $marke)) {
            return true;
        }
    }
    return false;
}

/**
 * PURE: die Sitze aus dem Wikitext EINER Organisationsseite.
 *
 * Liest |Hauptsitz= (Rolle hauptsitz) und |Weitere Sitze= (Rolle zweigsitz). Der Ortstext
 * bleibt ROH -- die Auflösung gegen die Karte macht place-scope.php beim Lesen.
 *
 * 💣 Doppelte Orte fallen zusammen, und der HAUPTSITZ gewinnt: nennt ein Artikel denselben
 * Ort in beiden Feldern, ist er der Hauptsitz. Ohne diese Regel entschiede die Reihenfolge
 * der Felder im Wikitext, welche Rolle in der Infobox steht.
 *
 * @return list<array{raw:string, role:string}>
 */
function avesmapsOrgSeatsFromWikitext(string $wikitext): array
{
    $felder = [
        'Hauptsitz' => AVESMAPS_ORG_SEAT_ROLE_MAIN,
        'Weitere Sitze' => AVESMAPS_ORG_SEAT_ROLE_BRANCH,
    ];
    $sitze = [];
    foreach ($felder as $feld => $rolle) {
        if (preg_match('/^\s*\|\s*' . preg_quote($feld, '/') . '\s*=\s*(.*)$/mu', $wikitext, $treffer) !== 1) {
            continue;
        }
        foreach (avesmapsOrgSeatSplitField(trim($treffer[1])) as $stueck) {
            if (avesmapsOrgSeatIsDead($stueck)) {
                continue;
            }
            $sitze[] = ['raw' => $stueck, 'role' => $rolle];
        }
    }

    return $sitze;
}

/**
 * PURE: die Art der Organisation aus |Art= („[[Handelsgesellschaft]]" -> „Handelsgesellschaft").
 * Leer, wenn das Feld fehlt -- der Aufrufer setzt dann seine eigene Ersatzangabe.
 *
 * ⚠️ Bewusst NICHT avesmapsNormalizePlaceKind: „Handelsgesellschaft" steht (noch) nicht im
 * Ortsarten-Katalog, und ein Wert, den der Katalog nicht kennt, käme dort ungekürzt wieder
 * heraus -- der Umweg brächte nichts und verbände zwei Vokabulare, die getrennt bleiben sollen.
 */
function avesmapsOrgSeatArt(string $wikitext): string
{
    if (preg_match('/^\s*\|\s*Art\s*=\s*(.*)$/mu', $wikitext, $treffer) !== 1) {
        return '';
    }
    $wert = trim(str_replace(['[[', ']]'], '', $treffer[1]));
    // „[[Handelsgesellschaft]] / [[Bankhaus]]" -> die erste Nennung; die Infobox zeigt eine Art.
    $wert = trim(explode('/', $wert)[0]);
    // Ein Pipe-Link „Ziel|Anzeige" -> die Anzeige, das ist der gebräuchliche Name.
    if (str_contains($wert, '|')) {
        $teile = explode('|', $wert);
        $wert = trim(end($teile));
    }
    return mb_substr($wert, 0, 120, 'UTF-8');
}
