<?php

declare(strict_types=1);

// Wiki page parsing (infobox -> staging mirror, affiliation/parent chain), split
// out of sync-monitor.php (M5 god-file split). Required by sync-monitor.php; relies
// on its AVESMAPS_WIKI_SYNC_MONITOR_* consts and core helpers, resolved at call time.

// ---------------------------------------------------------------------------
// Commit B: Page-Parsing. Aus dem Infobox-Wikitext (echte Parameter Art/Staat/
// Region/Wappen) einen Wiki-Spiegel-Datensatz bauen und ins Staging (_test)
// upserten. Affiliation = Param `Staat` (politisch, = Elternkette) -> path/root +
// [[Links]] fuer Eltern-Rekursion + Konflikt-Hinweise. Eigenstaendige Stadtstaaten
// (Infobox Siedlung) werden mitgenommen (source_origin=siedlung).
// ---------------------------------------------------------------------------

function avesmapsWikiSyncMonitorFieldKey(string $key): string {
    $key = mb_strtolower(trim($key), 'UTF-8');
    $key = strtr($key, [
        'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'ss',
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e',
        'î' => 'i', 'í' => 'i', 'ô' => 'o', 'ó' => 'o', 'û' => 'u', 'ú' => 'u',
    ]);

    return preg_replace('/[^a-z0-9]+/u', '', $key) ?? '';
}

function avesmapsWikiSyncMonitorNormFields(array $fields): array {
    $norm = [];
    foreach ($fields as $key => $value) {
        $normalizedKey = avesmapsWikiSyncMonitorFieldKey((string) $key);
        if ($normalizedKey !== '' && !isset($norm[$normalizedKey])) {
            $norm[$normalizedKey] = (string) $value;
        }
    }

    return $norm;
}

function avesmapsWikiSyncMonitorField(array $norm, array $aliases): string {
    foreach ($aliases as $alias) {
        if (isset($norm[$alias]) && trim($norm[$alias]) !== '') {
            return $norm[$alias];
        }
    }

    return '';
}

function avesmapsWikiSyncMonitorInfoboxName(string $wikitext): string {
    if (preg_match('/\{\{\s*Infobox\s+([^\n|}]+)/u', $wikitext, $match) === 1) {
        return trim(preg_replace('/\s+/u', ' ', (string) $match[1]) ?? (string) $match[1]);
    }

    return '';
}

// Schneidet GENAU den Infobox-Template-Block per Klammer-Matching aus (nicht den ersten
// beliebigen Template-Block der Seite — grosse Artikel haben davor Wartungs-Templates).
// Byte-basiertes Matching ist sicher: {{ }} sind ASCII, kommen in UTF-8-Folgebytes nie vor.
function avesmapsWikiSyncMonitorExtractInfoboxBlock(string $wikitext): string {
    if (preg_match('/\{\{\s*Infobox\s+/u', $wikitext, $match, PREG_OFFSET_CAPTURE) !== 1) {
        return '';
    }

    $start = (int) $match[0][1];
    $length = strlen($wikitext);
    $depth = 0;
    for ($i = $start; $i < $length - 1; $i++) {
        $pair = substr($wikitext, $i, 2);
        if ($pair === '{{') {
            $depth++;
            $i++;
            continue;
        }
        if ($pair === '}}') {
            $depth--;
            $i++;
            if ($depth === 0) {
                return substr($wikitext, $start, ($i + 1) - $start);
            }
        }
    }

    return substr($wikitext, $start);
}

// Parst die |key=value-Parameter eines Template-Blocks tiefen-bewusst, sodass '|' innerhalb
// verschachtelter {{...}} keine Parameter zerschneidet.
function avesmapsWikiSyncMonitorParseTemplateParams(string $block): array {
    $params = [];
    $currentKey = null;
    $currentValue = '';
    $depth = 0;
    foreach (preg_split('/\R/u', $block) ?: [] as $line) {
        if ($depth === 0 && preg_match('/^\s*\|\s*([^=\n]+?)\s*=\s*(.*)$/u', $line, $match) === 1) {
            if ($currentKey !== null) {
                $params[$currentKey] = $currentValue;
            }
            $currentKey = trim((string) $match[1]);
            $currentValue = (string) $match[2];
        } elseif ($currentKey !== null) {
            $currentValue .= "\n" . $line;
        }

        $opens = (int) preg_match_all('/\{\{/u', $currentValue);
        $closes = (int) preg_match_all('/\}\}/u', $currentValue);
        $depth = max(0, $opens - $closes);
    }
    if ($currentKey !== null) {
        $params[$currentKey] = preg_replace('/\}\}\s*$/u', '', $currentValue) ?? $currentValue;
    }

    return $params;
}

// WICHTIG (Audit 2026-06-01): avesmapsWikiSyncCleanPoliticalTerritoryWikiValue strippt
// {{BF|177}}->"177" und {{Datum|Jahr|Monat|Tag}}->"Jahr Monat Tag" und entfernt damit den
// "BF"-Marker, BEVOR avesmapsWikiSyncBuildPoliticalTemporalPayload die Jahre extrahiert ->
// founded_start_bf wurde 0. Diese Funktion ueberfuehrt die Templates VOR dem Cleaning in
// "JAHR BF", sodass der Payload-Extractor wieder greift. (Vorlage:Datum = Jahr|Monat|Tag.)
function avesmapsWikiSyncMonitorTemporalText(string $rawValue): string {
    $value = trim($rawValue);
    if ($value === '') {
        return '';
    }

    // Negative (v.BF) Jahre KANONISCH als "N v. BF" ausgeben, NICHT "-N BF": der
    // Payload-Extractor erkennt nur "v. BF" als Vor-BF-Marker; ein fuehrendes Minus
    // wuerde sonst verschluckt (-870 BF -> faelschlich +870). DSA-Notation zugleich sauber.
    $value = preg_replace_callback('/\{\{\s*BF\s*\|\s*(-?\d{1,5})[^}]*\}\}/iu', static function (array $match): string {
        $year = (int) $match[1];
        return $year < 0 ? (abs($year) . ' v. BF') : ($year . ' BF');
    }, $value) ?? $value;
    $value = preg_replace_callback('/\{\{\s*Datum\s*\|([^}]*)\}\}/iu', static function (array $match): string {
        $parts = array_map('trim', explode('|', (string) $match[1]));
        $year = $parts[0] ?? '';
        if (preg_match('/^-?\d{1,5}$/', $year) !== 1) {
            return '';
        }
        $yearInt = (int) $year;
        return $yearInt < 0 ? (abs($yearInt) . ' v. BF') : ($yearInt . ' BF');
    }, $value) ?? $value;

    return avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($value);
}

function avesmapsWikiSyncMonitorCoatOfArmsUrl(string $rawValue): string {
    $value = trim($rawValue);
    if ($value === '') {
        return '';
    }

    if (preg_match('/\{\{\s*(?:Boximage|Bild|Infoboxbild|Bildeinbindung)\s*\|\s*([^|}\n]+)/iu', $value, $match) === 1) {
        return avesmapsWikiSyncPoliticalTerritoryFilePathUrl(trim((string) $match[1]));
    }

    return avesmapsWikiSyncExtractPoliticalTerritoryCoatOfArmsUrl($value);
}

function avesmapsWikiSyncMonitorDetectContinent(string $context): string {
    // Sekundaer-/Kolonialgebiete duerfen die Kontinent-Klassifizierung des HEIMAT-Gebiets nicht
    // kapern. Konkreter Bug: Al'Anfa "Geographisch: Meridiana; Kolonien: Uthuria" -> die Uthuria-
    // Kolonie-Erwaehnung setzte das Reich faelschlich auf "Uthuria" (die Needle-Suche unten gewinnt
    // beim ersten Treffer, und 'uthuria' steht vor 'aventurien'). Daher ein Kolonie-Schluesselwort
    // samt unmittelbar folgendem Fremd-Kontinentnamen (max. 2 Zwischenwoerter) VOR dem Keying
    // entfernen -- gebunden, damit weiter hinten stehende Nav-Marker NICHT mitgerissen werden.
    $context = preg_replace(
        '/\b(?:kolonien?|kolonialbesitz|protektorat|au[\x{00df}s]enposten|exklave|dependance)\b'
        . '[\s:,]*(?:\S+\s+){0,2}?'
        . '(?:uthuria|myranor|g[\x{00fc}u]ldenland|gueldenland|rakshazar|riesland|tharun|lahmaria)\b/iu',
        ' ',
        $context
    ) ?? $context;
    $key = avesmapsWikiSyncMonitorFieldKey($context);
    // Ein EXPLIZITER Aventurien-Nav-Marker ({{Nav Staaten Aventurien}}) ist das stärkste, eindeutige
    // Signal und gewinnt VOR der losen Needle-Suche unten -- sonst kapert eine Streu-Erwähnung eines
    // anderen Kontinents die Klassifizierung. Konkreter Bug: "Wiedererstandenes Reich des Horas" trägt
    // {{Nav Staaten Aventurien}}, verweist aber via {{Abgeleitet|...}}/Interwiki auf "Horas (Myranor)"
    // -> wurde fälschlich als Uthuria/Myranor klassifiziert und damit überall (continent='Aventurien')
    // rausgefiltert. (Pendant-Marker anderer Kontinente, z.B. navstaatenmyranor, sind hiervon nicht
    // betroffen, da sie 'navstaatenaventurien' nicht enthalten.)
    if (str_contains($key, 'navstaatenaventurien')) {
        return defined('AVESMAPS_POLITICAL_DEFAULT_CONTINENT') ? AVESMAPS_POLITICAL_DEFAULT_CONTINENT : 'Aventurien';
    }
    $continents = [
        'Myranor / Güldenland' => ['myranor', 'guldenland', 'gueldenland', 'rastabor', 'vesayama'],
        'Rakshazar / Riesland' => ['rakshazar', 'riesland'],
        'Uthuria' => ['uthuria'],
        'Tharun' => ['tharun'],
        'Lahmaria' => ['lahmaria'],
        'Aventurien' => ['aventurien'],
    ];
    foreach ($continents as $continent => $needles) {
        foreach ($needles as $needle) {
            if ($needle !== '' && str_contains($key, $needle)) {
                return $continent;
            }
        }
    }

    return defined('AVESMAPS_POLITICAL_DEFAULT_CONTINENT') ? AVESMAPS_POLITICAL_DEFAULT_CONTINENT : 'Aventurien';
}

// Reine Qualifizierer-/Unabhaengigkeits-Klausel = KEIN Elternteil (umstritten, unabhaengig,
// vakant, ehemals, …). Wird beim Survey aller G/B als systematisches Muster bestaetigt.
function avesmapsWikiSyncMonitorIsQualifierOnly(string $text): bool {
    $key = avesmapsWikiSyncMonitorFieldKey($text);
    if ($key === '') {
        return true;
    }
    foreach ([
        'unabhangig', 'unabh', 'keine', 'unbekannt', 'ungeklart', 'umstritten', 'strittig',
        'vakant', 'niemand', 'souveran', 'eigenstandig', 'eigenstand', 'independent',
        'ehemals', 'ehemalig', 'fruher', 'vormals', 'zuvor', 'ehem',
        'reichsstadt', 'freiestadt', // Status-Marker, kein Eltern-Gebiet (z.B. [[Freie Stadt]])
    ] as $word) {
        if ($key === $word || str_starts_with($key, $word)) {
            return true;
        }
    }

    return false;
}

// Bereinigt ein einzelnes Ketten-Element: Klammer-Zusaetze weg + ERSTER Komma-Teil
// (Survey: der erste Komma-Teil ist immer der echte Name; nur 1/781 hatte ueberhaupt ein
// Komma ohne Qualifizierer, auch das loest korrekt auf).
function avesmapsWikiSyncMonitorCleanAffiliationPart(string $part): string {
    $part = trim(preg_replace('/\([^)]*\)/u', ' ', $part) ?? $part);
    if ($part !== '' && str_contains($part, ',')) {
        $first = trim((string) (explode(',', $part)[0] ?? ''));
        if ($first !== '') {
            $part = $first;
        }
    }

    return trim($part);
}

// (B) Konflikt-Müll: Template-Fragmente (wid|/ex|/evt|/no|, "|837 BF"), reine Datums-/Zahl-Angaben.
function avesmapsWikiSyncMonitorIsConflictJunk(string $value): bool {
    $value = trim($value);
    if ($value === '') {
        return true;
    }
    if (str_contains($value, '|')) {
        return true; // Template-Fragment ({{wid|…}}/{{ex|…}} etc.), das die Bereinigung nicht aufloeste
    }
    if (preg_match('/(?:^\s*-|-\s*$)/u', $value) === 1) {
        return true; // abgeschnittenes Verbund-Fragment ("Königs-")
    }
    if (preg_match('/^(?:ex|wid|evt|no|nz|wd)\b/iu', $value) === 1) {
        return true; // Template-Name ohne Pipe
    }
    // reine Zeit-/Datumsangabe ("22 BF", "1028 BF", "1016-34 BF") ohne echten Namensteil
    $withoutDates = trim((string) preg_replace('/\b\d[\d\-–.\/\s]*(?:v\.?\s*)?BF\b/iu', '', $value));
    if (preg_match('/^\d/u', $value) === 1 || $withoutDates !== $value) {
        return preg_match('/[A-Za-zÄÖÜäöüß]{3,}/u', $withoutDates) !== 1;
    }
    return false;
}

// (C) Präfixe vor einem Anspruchsteller strippen (zuletzt/vermutlich/sowie/nach Aufloesung in/…)
// + ein nachgestelltes "beansprucht" ("zuletzt vom Moghulat Oron beansprucht" -> "Moghulat Oron").
function avesmapsWikiSyncMonitorStripClaimPrefix(string $value): string {
    $value = trim($value);
    $value = trim((string) preg_replace('/^\([^)]*\)\s*/u', '', $value)); // fuehrende Klammer ("(teilweise)") weg
    $prefix = '/^\s*(?:Gebiet\s+)?(?:nach\s+Aufl[oö]sung\s+(?:in\s+)?(?:de[rmsn]\s+)?|beansprucht\s+vo[nm]|teil\s+vo[nm]|teil\s+des|geh[oö]rt\s+zu|zuletzt(?:\s+vo[nm])?|vermutlich|zuvor|sowie|ehemal[a-zäöü]*|vormals|fr[uü]her)(?:\s+de[rmsn])?\s+/iu';
    for ($i = 0; $i < 2; $i += 1) { // bis zu 2x (z.B. "vermutlich zuvor X")
        $next = (string) preg_replace($prefix, '', $value);
        if ($next === $value) {
            break;
        }
        $value = trim($next);
    }
    $value = trim((string) preg_replace('/\s+beansprucht\s*$/iu', '', $value)); // nachgestelltes "beansprucht"
    return trim($value);
}

// (C/E) Eine Anspruchsteller-Klausel in einzelne Parteien zerlegen (Mehrfach-Ansprueche): an Komma/
// Semikolon/"sowie"/"und" trennen. Doppelpunkt-PFADE bleiben ganz (Hierarchie -> Leaf loest der Resolver).
function avesmapsWikiSyncMonitorSplitClaimants(string $value, bool $splitUnd = false): array {
    $value = trim($value);
    if ($value === '') {
        return [];
    }
    // " und " NICHT generell splitten -> sonst zerfallen Verbund-Namen ("Königs- und Großmark",
    // "Born und Walsach"). Nur in expliziten "sowie"-Listen ($splitUnd) trennt "und" Anspruchsteller.
    $pattern = $splitUnd ? '/\s*,\s*|\s*;\s*|\s+sowie\s+|\s+und\s+/iu' : '/\s*,\s*|\s*;\s*|\s+sowie\s+/iu';
    $parts = preg_split($pattern, $value) ?: [$value];
    $out = [];
    foreach ($parts as $part) {
        $part = avesmapsWikiSyncMonitorStripClaimPrefix((string) $part);
        $part = trim((string) preg_replace('/\([^)]*\)/u', ' ', $part)); // Klammer-Zusaetze weg
        $part = trim($part, " \t\n\r\0\x0B.,;");
        if ($part === '' || avesmapsWikiSyncMonitorIsQualifierOnly($part) || avesmapsWikiSyncMonitorIsConflictJunk($part)) {
            continue;
        }
        $out[] = $part;
    }
    return $out;
}

// Parst den politischen Affiliation-String (Param `Staat`). Regel (Survey-validiert):
// In Klauseln auf ';' UND '/' trennen -> erste NICHT-reine-Qualifizierer-Klausel = primaere
// Eltern-Kette ('beansprucht von' davor abschneiden); auf ':'/'>' splitten; je Element
// Klammern weg + erster Komma-Teil. Rest-Klauseln = conflicts. [[Links]] = Eltern-Kandidaten.
function avesmapsWikiSyncMonitorParseAffiliation(string $staatRaw): array {
    $raw = trim($staatRaw);
    if ($raw === '') {
        return ['raw' => '', 'path' => [], 'root' => '', 'links' => [], 'conflicts' => [], 'independent' => false];
    }

    $links = [];
    if (preg_match_all('/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/u', $raw, $linkMatches) !== false) {
        foreach (($linkMatches[1] ?? []) as $linkTarget) {
            $linkTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) $linkTarget);
            $linkKey = avesmapsWikiSyncMonitorFieldKey($linkTitle);
            if ($linkKey === 'freiestadt' || $linkKey === 'reichsstadt') {
                continue; // Status-Marker (z.B. [[Freie Stadt]]) ist kein Eltern-Gebiet
            }
            if ($linkTitle !== '' && avesmapsWikiSyncMonitorIsRelevantTitle($linkTitle)) {
                $links[avesmapsPoliticalSlug($linkTitle)] = $linkTitle;
            }
        }
    }

    $clean = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($raw);

    $conflicts = [];

    // (A) Parenthetische Ansprueche extrahieren, BEVOR die Klammern weggeputzt werden:
    //     "Sokramor (beansprucht von Mittelreich: … Reichsmark Osterfelde)" -> Osterfelde als Konflikt.
    //     Das ist die HAEUFIGSTE Form im Wiki (Grenzregionen) und wurde bisher komplett verschluckt.
    $clean = (string) preg_replace_callback('/\(([^()]*)\)/u', static function (array $matches) use (&$conflicts): string {
        $inner = trim((string) ($matches[1] ?? ''));
        if (preg_match('/beansprucht\s+vo[nm]\b\s*:?\s*(.+)$/iu', $inner, $claim) === 1) {
            foreach (avesmapsWikiSyncMonitorSplitClaimants((string) $claim[1]) as $claimant) {
                $conflicts[] = $claimant;
            }
        }
        return ' '; // Klammer-Inhalt aus dem Eltern-Pfad entfernen
    }, $clean);

    $clauses = array_values(array_filter(
        array_map('trim', preg_split('#\s*[;/]\s*#u', $clean) ?: []),
        static fn(string $clause): bool => $clause !== ''
    ));

    $primary = '';
    foreach ($clauses as $clause) {
        // Zeit-/Historik-Klausel ("bis ING 1021 BF …", "seit 1000 BF …") = KEIN aktueller Elternteil.
        if (preg_match('/^\s*(?:bis|seit)\s+/iu', $clause) === 1) {
            continue;
        }
        // Zusatz-Anspruchsliste ("sowie X und Y") ist IMMER Konflikt, nie Elternteil -- sonst wuerde sie
        // faelschlich zum primaeren Pfad, wenn (wie bei Malqis) kein unstrittiger Elternteil davor steht.
        if (preg_match('/^\s*sowie\b/iu', $clause) === 1) {
            foreach (avesmapsWikiSyncMonitorSplitClaimants($clause, true) as $claimant) { // "und" trennt hier
                $conflicts[] = $claimant;
            }
            continue;
        }
        // (E) "beansprucht von" IRGENDWO in der Klausel (nicht nur am Anfang), inkl. ":"/Komma-Liste mit
        //     mehreren Parteien ("Gebiet (teilweise) beansprucht von: Almada, Horasreich, Kalifat" = Taifas).
        //     Der Text VOR "beansprucht von" ist ggf. der eigentliche Elternteil.
        if (preg_match('/^(.*?)\bbeansprucht\s+vo[nm]\b\s*:?\s*(.+)$/iu', $clause, $claim) === 1) {
            $before = avesmapsWikiSyncMonitorStripClaimPrefix(trim((string) $claim[1]));
            if ($primary === '' && $before !== '' && !avesmapsWikiSyncMonitorIsQualifierOnly($before)
                && preg_match('/^(?:Gebiet|teile?|teilweise)\s*$/iu', $before) !== 1) {
                $primary = $before;
            }
            foreach (avesmapsWikiSyncMonitorSplitClaimants((string) $claim[2]) as $claimant) {
                $conflicts[] = $claimant;
            }
            continue;
        }
        // (C) Praefixe strippen -> dahinter der eigentliche Elternteil bzw. konkurrierende Partei(en).
        $stripped = avesmapsWikiSyncMonitorStripClaimPrefix($clause);
        if ($stripped === '' || avesmapsWikiSyncMonitorIsQualifierOnly($stripped)) {
            continue; // reiner Status-/Zeit-Zusatz (umstritten, ehemalige Reichsstadt …)
        }
        if ($primary === '') {
            $primary = $stripped;
        } else {
            foreach (avesmapsWikiSyncMonitorSplitClaimants($stripped) as $claimant) {
                $conflicts[] = $claimant; // echte konkurrierende Eltern-Klausel(n)
            }
        }
    }

    $path = [];
    foreach (preg_split('/\s*(?::|>|»|›)\s*/u', $primary) ?: [] as $part) {
        $part = avesmapsWikiSyncMonitorCleanAffiliationPart($part);
        if ($part === '' || avesmapsWikiSyncMonitorIsQualifierOnly($part)) {
            continue;
        }
        $path[] = $part;
    }
    $path = array_values(array_unique($path));

    // (B) Konflikte final saeubern: Template-/Datums-Muell raus, Duplikate weg (case-insensitiv).
    $cleanConflicts = [];
    $seenConflict = [];
    foreach ($conflicts as $conflict) {
        $conflict = trim((string) $conflict);
        if ($conflict === '' || avesmapsWikiSyncMonitorIsConflictJunk($conflict) || avesmapsWikiSyncMonitorIsQualifierOnly($conflict)) {
            continue;
        }
        $key = mb_strtolower($conflict);
        if (isset($seenConflict[$key])) {
            continue;
        }
        $seenConflict[$key] = true;
        $cleanConflicts[] = $conflict;
    }

    return [
        'raw' => $clean,
        'path' => $path,
        'root' => $path[0] ?? '',
        'links' => array_values($links),
        'conflicts' => $cleanConflicts,
        'independent' => $path === [],
    ];
}

function avesmapsWikiSyncMonitorParsePage(string $title, string $wikitext, string $canonicalTitle = ''): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    $canonical = $canonicalTitle !== '' ? avesmapsWikiSyncMonitorNormalizeTitle($canonicalTitle) : $title;
    $infobox = avesmapsWikiSyncMonitorInfoboxName($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey($infobox);
    $fields = avesmapsWikiSyncMonitorParseTemplateParams(avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext));
    $norm = avesmapsWikiSyncMonitorNormFields($fields);

    $field = static fn(array $aliases): string => avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(avesmapsWikiSyncMonitorField($norm, $aliases));

    $affiliation = avesmapsWikiSyncMonitorParseAffiliation(
        avesmapsWikiSyncMonitorField($norm, ['staat', 'staatpolitisch', 'zugehorigkeitpolitisch', 'politischezugehorigkeit', 'politisch'])
    );
    $statusText = $field(['status']);

    $isTerritoryInfobox = $infoboxKey !== '' && (
        str_contains($infoboxKey, 'staat')
        || str_contains($infoboxKey, 'herrschaftsgebiet')
        || str_contains($infoboxKey, 'reich')
    );
    $isSettlementInfobox = $infoboxKey !== '' && (
        str_contains($infoboxKey, 'siedlung')
        || str_contains($infoboxKey, 'stadt')
        || str_contains($infoboxKey, 'ort')
    );

    if ($isTerritoryInfobox) {
        $sourceOrigin = 'staat';
    } elseif ($isSettlementInfobox) {
        // Siedlung nur als Herrschaftsgebiet behalten, wenn (a) Reichsstadt-Marker (aktiv ODER
        // ex, z.B. {{Reichsstadt|ex|..}}), (b) Freie-Stadt-Marker (z.B. [[Freie Stadt]] in der
        // Staat-Kette, wie Havena) ODER (c) eigenstaendig/Stadtstaat. Sonst = reine Siedlung
        // (z.B. Nivesel) -> raus. (Nutzer-Regel.)
        $staatRaw = avesmapsWikiSyncMonitorField($norm, ['staat', 'staatpolitisch', 'zugehorigkeitpolitisch', 'politischezugehorigkeit', 'politisch']);
        $isReichsstadt = preg_match('/\{\{\s*Reichsstadt\b/iu', $staatRaw) === 1
            || str_contains(avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $infobox), 'reichsstadt');
        $isFreieStadt = preg_match('/\bFreie\s+Stadt\b/iu', $staatRaw) === 1
            || str_contains(avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $infobox), 'freiestadt');
        $independenceKey = avesmapsWikiSyncMonitorFieldKey($statusText . ' ' . $affiliation['raw']);
        $independentSettlement = $affiliation['independent']
            || str_contains($independenceKey, 'stadtstaat')
            || str_contains($independenceKey, 'eigenstand')
            || str_contains($independenceKey, 'unabh')
            || str_contains($independenceKey, 'souveran');
        if (!$isReichsstadt && !$isFreieStadt && !$independentSettlement) {
            return [
                'is_territory' => false,
                'reason' => 'Infobox ' . ($infobox !== '' ? $infobox : '?') . ' (reine Siedlung)',
                'record' => null,
                'parent_titles' => [],
                'source_origin' => 'siedlung',
            ];
        }
        $sourceOrigin = $isReichsstadt ? 'reichsstadt' : ($isFreieStadt ? 'freiestadt' : 'siedlung');
    } else {
        return [
            'is_territory' => false,
            'reason' => $infobox === '' ? 'kein Infobox' : ('Infobox ' . $infobox),
            'record' => null,
            'parent_titles' => [],
            'source_origin' => 'andere',
        ];
    }

    $name = $field(['name']);
    if ($name === '') {
        $name = $canonical;
    }
    $continent = $field(['kontinent']);
    if ($continent === '') {
        // Kontinent-Marker stehen meist NICHT in der Infobox, sondern als Nav-/Marker-Template
        // oben auf der Seite (z.B. {{Nav Staaten Myranor}}, {{Aventurien}}). Diese Hinweise in den
        // Erkennungs-Kontext geben, sonst faellt alles ohne Region-Feld auf Aventurien (Default).
        $navHints = '';
        if (preg_match_all('/\{\{\s*(Nav\s+[^}|]+|Aventurien|Myranor|G[üu]ldenland|Gueldenland|Rakshazar|Riesland|Tharun|Uthuria|Lahmaria)\b/iu', $wikitext, $navMatches) >= 1) {
            $navHints = implode(' ', $navMatches[1]);
        }
        $continent = avesmapsWikiSyncMonitorDetectContinent(
            $title . ' ' . avesmapsWikiSyncMonitorField($norm, ['region', 'geographisch']) . ' ' . $affiliation['raw'] . ' ' . $navHints
        );
    }

    $german = [
        'Name' => $name,
        'Typ' => $field(['art', 'typ', 'herrschaftsgebiet', 'staatsform']),
        'Kontinent' => $continent,
        'Zugehörigkeit' => $affiliation['raw'],
        'Zugehörigkeit-Root' => $affiliation['root'],
        'Zugehörigkeit-Pfad' => implode(' > ', $affiliation['path']),
        'Zugehörigkeit-JSON' => ['path' => $affiliation['path'], 'source' => 'wiki-sync-monitor', 'source_field' => 'Staat'],
        'Status' => $statusText,
        'Herrschaftsform' => $field(['herrschaftsform']),
        'Hauptstadt' => $field(['hauptstadt']),
        'Herrschaftssitz' => $field(['herrschaftssitz']),
        'Oberhaupt' => $field(['oberhaupt']),
        'Sprache' => $field(['sprache']),
        'Währung' => $field(['wahrung', 'wahrungen']),
        'Handelswaren' => $field(['handelswaren']),
        'Einwohnerzahl' => $field(['einwohnerzahl', 'einwohner']),
        'Gründer' => $field(['grunder']),
        'Gründungsdatum' => avesmapsWikiSyncMonitorTemporalText(avesmapsWikiSyncMonitorField($norm, ['grundungsdatum', 'grundung', 'gegrundet', 'unabhangigkeit', 'entstehung'])),
        'Aufgelöst' => avesmapsWikiSyncMonitorTemporalText(avesmapsWikiSyncMonitorField($norm, ['aufgelost', 'auflosung', 'besetzt', 'untergang', 'ende'])),
        'Geographisch' => $field(['region', 'geographisch']),
        'Blasonierung' => $field(['blasonierung']),
        'Wiki-Link' => avesmapsWikiSyncMonitorPageUrl($canonical),
        'Wappen-Link' => avesmapsWikiSyncMonitorCoatOfArmsUrl(avesmapsWikiSyncMonitorField($norm, ['wappen', 'wappenbild', 'wappendatei', 'wappenbilddatei'])),
    ];

    $record = avesmapsPoliticalNormalizeWikiRecord($german);

    $temporal = avesmapsWikiSyncBuildPoliticalTemporalPayload((string) $record['founded_text'], (string) $record['dissolved_text']);
    $record['founded_text'] = (string) $temporal['founded_text'];
    $record['founded_type'] = (string) $temporal['founded_type'];
    $record['founded_start_bf'] = (int) $temporal['founded_start_bf'];
    $record['founded_end_bf'] = (int) $temporal['founded_end_bf'];
    $record['founded_display_bf'] = (float) $temporal['founded_display_bf'];
    $record['dissolved_text'] = (string) $temporal['dissolved_text'];
    $record['dissolved_type'] = (string) $temporal['dissolved_type'];
    $record['dissolved_start_bf'] = (int) $temporal['dissolved_start_bf'];
    $record['dissolved_end_bf'] = (int) $temporal['dissolved_end_bf'];
    $record['dissolved_display_bf'] = (float) $temporal['dissolved_display_bf'];
    $record['affiliation_root'] = $affiliation['root'];
    $record['affiliation_path_json'] = $affiliation['path'];
    $record['raw_json'] = [
        'source' => 'wiki-sync-monitor',
        'infobox' => $infobox,
        'source_origin' => $sourceOrigin,
        'affiliation' => $affiliation,
    ];

    return [
        'is_territory' => true,
        'reason' => '',
        'record' => $record,
        'parent_titles' => $affiliation['links'],
        'source_origin' => $sourceOrigin,
    ];
}
