<?php

declare(strict_types=1);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RUECKBAU-WAECHTER: der Merker `properties.wiki_no_article` und sein Verb kommen NICHT zurueck
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 OWNER-ENTSCHEID 09.09.2026, nach Durchsicht aller 10 Traeger: der Merker wird global
// ausgebaut -- Haekchen, Feld, Leser, Schreiber und Bestandsdaten. Sein Aequivalent ist die
// WIKI-ZUWEISUNG: das Nest `wiki_settlement` / `wiki_path` / `wiki_region` / `wiki_powerline`
// (Feld `wiki_key` bzw. `wiki_url`), NIE `properties.wiki_url` -- die wird abgeleitet.
//
// 💣 WARUM ES DEN MERKER GAB, damit ihn niemand aus Versehen wieder einfuehrt:
// Er war der Notausgang gegen das Namensraten der Kartennutzlast (Discord #38). Bis zum
// 08.09.2026 fuellte `avesmapsEnrichMapFeatureWikiUrl` (api/app/map-features.php) die Adresse aus
// dem NAMEN des Objekts; eine geloeste Zuweisung kam beim naechsten Lesen zurueck. 》Trennen《 hielt
// also nicht, und es brauchte eine zweite, NEGATIVE Aussage. Commit `420f12cfc` hat den Rateweg
// zurueckgebaut -- der Server schlaegt nichts mehr vor, 》Trennen《 haelt von allein, und der Merker
// hat keinen Gegenstand mehr.
//
// ⚠️ DER PREIS IST BENANNT UND GEWOLLT: die Unterscheidung „nachgesehen, es gibt nichts" gegen „hat
// noch niemand angesehen" gibt es nicht mehr. Die 10 Traeger stehen seither wieder auf der
// Beobachtungsliste (10 Objekte, 7 Zeilen -- Drachenblick faellt als Kraftlinie zu einer Zeile
// zusammen). Wer das vermisst, hat KEINEN Fehler gefunden, sondern sieht die Entscheidung.
//
// ⭐ WARUM DIESER TEST EINE EIGENE DATEI IST: der Schutz liegt sonst verteilt in fuenf Testdateien,
// je neben dem, was sie messen. Das ist richtig -- aber wer in einem Jahr fragt „warum gibt es
// hier keinen Knopf 》Kein Wiki-Eintrag《 mehr?", sucht EINE Stelle mit der Begruendung. Dieselbe
// Bauform wie der Rueckbau-Waechter des Kartenarchiv-Tokens (AGENTS.md §11): er nennt beim Namen,
// was gerade verschwindet, und gibt den Owner-Wortlaut aus.
//
// Lauf:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/conflicts/__tests__/kein-wiki-eintrag-ist-weg-test.php

// 💣 GEMESSEN WIRD KOMMENTARFREIER QUELLTEXT, UND DAS IST HIER TRAGEND.
// Dieser Test sucht nach Woertern, die es nicht mehr geben darf -- und genau diese Woerter stehen
// als BEGRUENDUNG in den Kommentaren daneben („HIER STAND DIE WEICHE `$markNoArticle` …"). Roh
// gelesen schlaegt er an seiner eigenen Warnung an: beim ersten Lauf tat er das an vier Stellen.
// Ein Test, der Fliesstext misst, meldet Befunde, die es nicht gibt -- und uebersieht die, die es
// gibt, weil man ihn danach entschaerft.
// ⭐ PHP ueber den TOKENIZER, nicht ueber zwei `preg_replace`: `sync-monitor.php` traegt
// `_internal/wiki/*-Libs` in einem ZEILENkommentar, und ein Blockkommentar-Entferner frisst dort
// 380 Zeilen echten Code (AGENTS.md §11). Fuer JS/CSS genuegt die Zeilenform, weil die gesuchten
// Woerter dort ausschliesslich in ganzen Kommentarzeilen stehen -- ein `//` mitten in einer
// Zeichenkette (`https://`) darf NICHT als Kommentaranfang gelten, deshalb wird nur getrimmt am
// Zeilenanfang geprueft.
$wurzel = dirname(__DIR__, 4);

$rohLies = static function (string $rel) use ($wurzel): string {
    $inhalt = file_get_contents($wurzel . '/' . $rel);
    assert(is_string($inhalt) && $inhalt !== '', "Datei nicht lesbar: $rel");

    return $inhalt;
};

/** PHP-Quelltext ohne Kommentare -- ueber den Tokenizer, nicht ueber Regex. */
$liesPhp = static function (string $rel) use ($rohLies): string {
    $code = '';
    foreach (token_get_all($rohLies($rel)) as $stueck) {
        if (is_array($stueck)) {
            if ($stueck[0] === T_COMMENT || $stueck[0] === T_DOC_COMMENT) {
                continue;
            }
            $code .= $stueck[1];
            continue;
        }
        $code .= $stueck;
    }

    return $code;
};

/** JS/CSS ohne Blockkommentare und ohne reine Kommentarzeilen. */
$liesJs = static function (string $rel) use ($rohLies): string {
    $ohneBlock = preg_replace('~/\*.*?\*/~s', '', $rohLies($rel));
    assert(is_string($ohneBlock), "Blockkommentare nicht entfernbar: $rel");
    $zeilen = preg_split('/\R/', $ohneBlock) ?: [];

    return implode("\n", array_filter($zeilen, static function (string $zeile): bool {
        $t = ltrim($zeile);

        return $t !== '' && strncmp($t, '//', 2) !== 0 && strncmp($t, '*', 1) !== 0;
    }));
};

// ── 1) DAS VERB IST WEG -- an allen drei Stellen, die es hatte ────────────────────────────────
// 💣 Drei Stellen, und eine allein genuegt nicht: die Whitelist im Endpunkt entscheidet, ob der
// Modus ausgefuehrt wird; der Katalog liefert die Beschriftung; der Knopf loest ihn aus. Kaeme
// eine davon zurueck, waere der Zustand halb -- entweder ein Knopf, der eine Absage bekommt,
// oder ein Modus, den kein Knopf mehr ausloest und den trotzdem jemand per Hand schicken kann.
$repair = $liesPhp('api/_internal/conflicts/repair.php');
assert(
    preg_match("/in_array\(\s*\\\$mode,\s*\[[^\]]*'no_wiki'/", $repair) !== 1,
    'der Modus `no_wiki` steht wieder in der Whitelist von avesmapsConflictResolve (repair.php). '
    . 'Er schrieb den Merker `properties.wiki_no_article`, und den liest seit dem 09.09.2026 niemand '
    . 'mehr -- ein Knopf, der ein totes Feld schreibt, ist eine Falle.'
);
assert(
    preg_match('/\$markNoArticle/', $repair) !== 1,
    'der Parameter `$markNoArticle` ist zurueck -- avesmapsConflictUnlinkFeature raeumt den Merker '
    . 'seit dem 09.09.2026 nur noch weg und setzt ihn nie.'
);

$rules = $liesPhp('api/_internal/conflicts/rules.php');
assert(
    strpos($rules, 'Kein Wiki-Eintrag') === false,
    'das Verb "Kein Wiki-Eintrag" steht wieder im Regelkatalog (rules.php)'
);
// 🔴 UND DIE AUSNAHME, DIE ES BEDIENTE, EBENSO. Sie nahm einen Traeger von der Beobachtungsliste
// „Kein Wiki-Schluessel". ⚠️ Sie kollabierte NICHT mit der Zuweisungsfrage eine Zeile darueber:
// dort steht „keine Adresse", hier stand „nachgesehen, es gibt keine". Zwei verschiedene Aussagen.
assert(
    strpos($rules, "no_article") === false,
    'die Ausnahme fuer `no_article` ist in rules.php zurueck -- damit verschwaenden die 10 Traeger '
    . 'wieder von der Beobachtungsliste, und der Owner hat sie ausdruecklich dort haben wollen.'
);

$knopf = $liesJs('js/review/review-conflicts.js');
assert(
    strpos($knopf, '"no_wiki"') === false && strpos($knopf, "'no_wiki'") === false,
    'der Knopf "Kein Wiki-Eintrag" ist in review-conflicts.js zurueck'
);

// ── 2) DAS HAEKCHEN IST WEG -- an ALLEN Objektarten ───────────────────────────────────────────
// 💣 Gezaehlt wird ueber das GANZE Register, nicht ueber eine Namensliste: wer eine neunte
// Objektart anlegt, soll nicht selbst daran denken muessen, sie hier einzutragen. Eine Zahl liest
// sich wie eine vollstaendige Liste, und niemand zaehlt nach.
$register = $liesJs('js/ui/wiki-assign-registry.js');
assert(
    preg_match('/keinArtikelHaken\s*:\s*true/', $register) !== 1,
    'eine Objektart bietet das Haekchen "Kein Wiki-Artikel vorhanden" wieder an. Es ist am '
    . '09.09.2026 mit dem Merker gefallen; wer es zurueckholt, braucht zuerst wieder ein Feld, '
    . 'das es schreibt, und einen neuen Owner-Entscheid.'
);

// ── 3) DER DRITTE ZUSTAND DES PRUEFHAKENS IST WEG ─────────────────────────────────────────────
// ⚠️ Er faerbte einen Traeger BLASS statt voll rot. Mit ihm faellt der Token und seine CSS-Regel;
// die 6 betroffenen Orte tragen seither den vollen Ring.
$regel = $liesJs('js/map-features/wiki-zuweisung.js');
assert(
    strpos($regel, 'GEPRUEFT') === false,
    'der Zustand AVESMAPS_WIKI_ZUWEISUNG_GEPRUEFT ist zurueck (js/map-features/wiki-zuweisung.js)'
);
$tokens = $liesJs('css/base/tokens.css');
assert(
    preg_match('/--color-check-no-wiki-checked\s*:/', $tokens) !== 1,
    'der Token --color-check-no-wiki-checked ist zurueck (css/base/tokens.css)'
);
// ⚠️ Die Gegenprobe gehoert dazu: der VOLLE Ton muss bleiben, sonst waere der Pruefhaken farblos.
assert(
    preg_match('/--color-check-no-wiki\s*:/', $tokens) === 1,
    'der volle Ton --color-check-no-wiki fehlt -- der Pruefhaken "Keine Wiki-Zuweisung" braucht ihn'
);

// ── 4) DIE ARCHIVE BLEIBEN UNBERUEHRT ─────────────────────────────────────────────────────────
// 🔴 Historische Protokollzeilen `conflict_no_article` stehen weiter in `map_audit_log`, und
// audit-detail.php uebersetzt sie. Ein Protokoll ist ein Archiv, sonst waere es keins -- dieselbe
// Regel wie beim Sprungpunkt der Verlaufszeile (AGENTS.md §11). Owner-Entscheid 09.09.2026.
$auditDetail = $rohLies('api/_internal/audit-detail.php');
assert(
    strpos($auditDetail, 'wiki_no_article') !== false,
    'der Uebersetzer fuer `wiki_no_article` ist aus audit-detail.php verschwunden -- dann zeigt der '
    . 'Aenderungsverlauf fuer historische Zeilen einen rohen Feldnamen. Er BLEIBT (Owner 09.09.2026).'
);
// ⚠️ Aber NEU geschrieben wird die Aktion nicht mehr.
assert(
    strpos($repair, "'conflict_no_article'") === false,
    'die Audit-Aktion `conflict_no_article` wird wieder geschrieben (repair.php)'
);

// ── 5) DIE KARTEN-SPALTE IST EINE ANDERE SACHE UND BLEIBT ─────────────────────────────────────
// 🪤 `citymap.no_article` heisst fast gleich und ist es nicht: eine eigene Datenbankspalte der
// Kartensammlung mit eigenem Schreibweg, nicht `properties.wiki_no_article`. Sie war beim
// Owner-Entscheid ausdruecklich AUSGENOMMEN. Ohne diese Zusicherung nimmt sie der naechste
// „Vollstaendigkeitsschub" mit -- und der Karten-Artikelabgleich verliert seinen Riegel.
$citymaps = $liesPhp('api/_internal/app/citymaps.php');
assert(
    strpos($citymaps, 'no_article') !== false,
    'die Spalte `citymap.no_article` ist mit ausgebaut worden -- sie war ausdruecklich ausgenommen '
    . '(Owner 09.09.2026): andere Ablage, andere Objektart, eigener Schreibweg.'
);

echo "kein-wiki-eintrag-ist-weg: alle Zusicherungen erfuellt\n";
