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

// ── 6) UND IM GANZEN HAUS STEHT KEINE LEBENDE ZEILE MEHR ────────────────────────────────────
// 🔴 DIE STAERKSTE ZUSICHERUNG DIESER DATEI, und sie ist bewusst die letzte: die fuenf darueber
// nennen einzelne Stellen beim Namen (das Verb, das Haekchen, der dritte Zustand, das Archiv, die
// Kartenspalte). Diese hier fragt nicht nach Namen, sondern zaehlt -- ueber den GANZEN Baum.
// 💣 EINE LISTE IST EINE ZAHL MIT ANDEREM AUSSEHEN. Genau daran ist der Vorgaenger gescheitert:
// `label-wiki-no-article-test.php` lief ueber eine fest verdrahtete Zwei-Datei-Liste und meldete
// „5 Zuweiser geprueft, alle in Ordnung", waehrend ein sechster in `conflicts/repair.php` ungesehen
// durchlief -- EXIT 0, ganzes Feld gruen. Seine Baum-Bauform ist hier geerbt; sein Gegenstand (der
// Merker am Label) ist mit dem Merker gefallen, seine Datei am 09.09.2026 mit ihm.
// ⚠️ Vier Stellen aus den Einzeltests gehen darin auf, ohne dass sie jemand eintragen muss: der
// Landschaften-Editor, der Flaechen-Dialog auf der Karte, der Kraftlinien-Editor und die
// Antwort-Projektion des Kraftlinien-Endpunkts. Wer eine FUENFTE Oberflaeche baut, ist gedeckt.
//
// 🚩 AM 09.09.2026 GEMESSEN, und die Erwartung stand vor dem Lauf da:
//    PHP unter api/ (ohne Tests):        348 Dateien, GENAU 1 Fundstelle -- `_internal/audit-detail.php`
//    js/ + html/ + css/ (ohne Tests):    405 Dateien, NULL Fundstellen
$phpBaum = static function (string $verzeichnis): array {
    $treffer = [];
    $lauf = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($verzeichnis, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($lauf as $eintrag) {
        $pfad = strtr((string) $eintrag, DIRECTORY_SEPARATOR, '/');
        if (substr($pfad, -4) !== '.php' || str_contains($pfad, '/__tests__/')) {
            continue;
        }
        $treffer[] = $pfad;
    }
    sort($treffer);

    return $treffer;
};

$phpDateien = $phpBaum($wurzel . '/api');
// ⚠️ Die Gegenprobe gegen einen Lauf, der gar nichts findet: eine leere Liste erfuellt jede
// „kommt nicht vor"-Zusicherung. Dieselbe Falle wie das viel zu kleine `find`-Ergebnis des
// Deploy-Tors (AGENTS.md §9) -- eine Zahl, die zu klein ist, sieht wie ein gruenes Feld aus.
assert(count($phpDateien) > 100, 'der api/-Baum wurde nicht gefunden -- nur ' . count($phpDateien) . ' Dateien');

$phpTreffer = [];
foreach ($phpDateien as $datei) {
    $code = '';
    foreach (token_get_all((string) file_get_contents($datei)) as $stueck) {
        if (is_array($stueck)) {
            if ($stueck[0] === T_COMMENT || $stueck[0] === T_DOC_COMMENT) {
                continue;
            }
            $code .= $stueck[1];
            continue;
        }
        $code .= $stueck;
    }
    if (strpos($code, 'wiki_no_article') !== false) {
        $phpTreffer[] = substr($datei, strlen($wurzel) + 1);
    }
}
// 🔴 GENAU DIESE ZWEI, NAMENTLICH -- keine Obergrenze. Eine blosse Obergrenze („hoechstens zwei")
// liesse zu, dass eine davon verschwindet und eine fremde dazukommt, und beide Haelften waeren
// falsch.
//   1. `audit-detail.php` -- der Uebersetzer historischer Protokollzeilen. Er BLEIBT dauerhaft
//      (Owner-Entscheid 09.09.2026, Abschnitt 4): ein Protokoll ist ein Archiv, sonst waere es keins.
//   2. `map/wiki-merker-bereinigung.php` -- die einmalige Bestandsreparatur (Schritt 4). Sie ist der
//      EINZIGE Grund, aus dem der Feldname ueberhaupt noch in lebendem Code stehen darf: sie raeumt
//      ihn weg.
// ⏳ NUMMER 2 IST BEFRISTET UND SOLL WIEDER VERSCHWINDEN. Ist der Bestand bereinigt und die
// Gegenprobe bei `total: 0`, fallen Bibliothek und Endpunkt
// (`api/edit/admin/wiki-merker-bereinigung.php`) -- und DIESE Liste wird wieder einelementig. Wer
// den Lauf entfernt, kommt an dieser Zeile vorbei und weiss, was noch fehlt; wer ihn ewig stehen
// laesst, hat ein Geruest ohne Bauwerk. Dieselbe Bauform wie der Abbau-Vertrag des
// Garetien-Importers.
// 💣 UND DIE REPARATUR IST DER GRUND, WARUM HIER EIN NAME STEHT UND KEINE ZAHL: waere die
// Zusicherung „hoechstens zwei", koennte ein zurueckgekehrter LESER die Stelle der Reparatur
// einnehmen, sobald die faellt -- und der Waechter bliebe gruen.
assert(
    $phpTreffer === ['api/_internal/audit-detail.php', 'api/_internal/map/wiki-merker-bereinigung.php'],
    "im api/-Baum steht wieder lebender Merker-Code (kommentarfrei gemessen):\n  "
    . implode("\n  ", $phpTreffer)
    . "\n  Erwartet sind GENAU zwei: `api/_internal/audit-detail.php` (das Archiv, bleibt) und "
    . '`api/_internal/map/wiki-merker-bereinigung.php` (die einmalige Bestandsreparatur, befristet).'
);

$browserBaum = static function (string $wurzelPfad): array {
    $treffer = [];
    foreach (['js', 'html', 'css'] as $zweig) {
        $ordner = $wurzelPfad . '/' . $zweig;
        if (!is_dir($ordner)) {
            continue;
        }
        $lauf = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($ordner, FilesystemIterator::SKIP_DOTS)
        );
        foreach ($lauf as $eintrag) {
            $pfad = strtr((string) $eintrag, DIRECTORY_SEPARATOR, '/');
            // ⚠️ `third-party/` bleibt draussen: Leaflet und jQuery gehoeren uns nicht, und ein
            // zufaelliges Wort in einer Fremdbibliothek waere ein Fehlschlag ohne Handlung.
            if (preg_match('/\.(js|html|css)$/', $pfad) !== 1
                || str_contains($pfad, '/__tests__/')
                || str_contains($pfad, '/third-party/')) {
                continue;
            }
            $treffer[] = $pfad;
        }
    }
    sort($treffer);

    return $treffer;
};

$browserDateien = $browserBaum($wurzel);
assert(count($browserDateien) > 100, 'der Browser-Baum wurde nicht gefunden -- nur ' . count($browserDateien) . ' Dateien');

// 💣 DER SELBSTTEST DES LESERS, und ohne ihn ist der ganze Abschnitt ein VAKUUM. Auf der
// Browser-Seite gibt es -- anders als bei PHP -- keine erlaubte Fundstelle mehr, die beweist, dass
// der Kommentar-Entferner ueberhaupt noch etwas durchlaesst. Ein kaputtes `preg_replace` gaebe
// hier NULL fuer jede Datei und saehe wie ein perfekt aufgeraeumtes Haus aus.
$kommentarfrei = static function (string $inhalt): string {
    $ohneBlock = preg_replace('~/\*.*?\*/~s', '', $inhalt);
    assert(is_string($ohneBlock), 'Blockkommentare nicht entfernbar');
    $zeilen = preg_split('/\R/', $ohneBlock) ?: [];

    return implode("\n", array_filter($zeilen, static function (string $zeile): bool {
        $t = ltrim($zeile);

        return $t !== '' && strncmp($t, '//', 2) !== 0 && strncmp($t, '*', 1) !== 0;
    }));
};
$probe = "// wiki_no_article steht hier nur als Erklaerung\n/* und keinArtikelHaken auch */\n"
    . "const x = { wiki_no_article: true };\n";
$geprobt = $kommentarfrei($probe);
assert(str_contains($geprobt, 'wiki_no_article: true'), 'der Leser verschluckt echten Code');
assert(substr_count($geprobt, 'wiki_no_article') === 1, 'der Leser laesst Kommentare durch');
assert(!str_contains($geprobt, 'keinArtikelHaken'), 'der Leser laesst Blockkommentare durch');

$browserTreffer = [];
foreach ($browserDateien as $datei) {
    $code = $kommentarfrei((string) file_get_contents($datei));
    // ⚠️ BEIDE Vokabeln: der Server nennt das Feld `wiki_no_article`, das Bauteil und seine
    // Erklaerungen nannten es `keinArtikelHaken` / `keinArtikelGeaendert` / `keinArtikel`. Wer nur
    // eine sucht, findet die Haelfte -- und die Haelfte, die er findet, ist die unwichtigere.
    if (strpos($code, 'wiki_no_article') !== false || strpos($code, 'keinArtikel') !== false) {
        $browserTreffer[] = substr($datei, strlen($wurzel) + 1);
    }
}
assert(
    $browserTreffer === [],
    "im Browser-Baum steht wieder lebender Merker-Code (kommentarfrei gemessen):\n  "
    . implode("\n  ", $browserTreffer)
    . "\n  Der Merker `properties.wiki_no_article` ist am 09.09.2026 global ausgebaut worden "
    . '(Owner-Entscheid); sein Aequivalent ist die WIKI-ZUWEISUNG.'
);

echo 'kein-wiki-eintrag-ist-weg: alle Zusicherungen erfuellt (' . count($phpDateien) . ' PHP-, '
    . count($browserDateien) . " Browser-Dateien im Baumlauf)\n";

