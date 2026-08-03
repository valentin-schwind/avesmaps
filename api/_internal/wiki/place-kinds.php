<?php

declare(strict_types=1);

// Der Ortsarten-Katalog: EINE Quelle der Wahrheit fuer „was fuer ein Ort ist das?“.
//
// Diese Liste hat zwei Abnehmer mit sehr verschiedenen Bedürfnissen, und genau deshalb steht sie
// in einer eigenen, winzigen Datei:
//
//   1. Der WIKI-CRAWL (wiki/settlements.php, wiki/dump-category-layer.php) leitet aus ihr
//      wiki_sync_pages.building_type ab, indem er literale [[Kategorie:]]-Links dagegen matcht.
//   2. Der KARTEN-SCHREIBPFAD (map/features.php) rastet den frei getippten Editor-Wert
//      properties.place_kind darauf ein.
//
// Abnehmer 2 darf wiki/settlements.php NICHT laden -- die Datei ist gross, zieht place-scope,
// coat-display und die WikiSync-Kerntabellen nach und macht DDL. Eine reine Konstantendatei
// kostet dagegen nichts und ist ohne Datenbank testbar.
//
// 🔴 DIE REIHENFOLGE IST TRAGEND. avesmapsWikiDumpCategoryAssembleBuildingMap behält den ERSTEN
// Typ, der einen Titel beansprucht (dump-category-layer.php) -- eine spezifische Art muss also vor
// ihrer Sammelkategorie stehen, sonst wird jeder Steinkreis als „Kultstätte" abgelegt und der
// eigene Eintrag ist tote Zeile. Dieselbe Liste speist beide Wege: den (heute aufruferlosen)
// Online-Crawl (der sie zur Laufzeit noch um die Subkategorien von „Bauwerk nach Art" ergaenzt)
// und die lebende Dump-Phase `online_building_map`.
const AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES = [
    'Festung', 'Festungsruine', 'Historische Festung', 'Tempel', 'Turm', 'Ruine', 'Palast', 'Kloster', 'Leuchtturm',
    // Kult- und Höhlenstätten (Owner 2026-07-28, aus dem Abgleich der derographischen Listen).
    // Zuerst die feinen Arten -- Steinkreis, Hexentanzplatz, Heiligtum, Schrein, Toteninsel und
    // Borbarad-Kultstätte sind im Wiki Unterkategorien von „Kultstätte", „Pforte des Grauens" eine
    // von „Unheiligtum". „Tempel" steht schon oben und behält damit seine Seiten wie bisher.
    'Steinkreis', 'Hexentanzplatz', 'Heiligtum', 'Schrein', 'Toteninsel', 'Borbarad-Kultstätte', 'Pforte des Grauens',
    // dann die Sammelkategorien
    'Kultstätte', 'Unheiligtum',
    // und die überschneidungsfreien. „Dungeon" ist kein Wiki-Begriff: dort gibt es nur Höhle und
    // Grotte, und die bleiben getrennt (Owner-Entscheid), damit jede Art heißt wie ihre Kategorie.
    'Höhle', 'Grotte', 'Sphärenruptur', 'Drachenhort', 'Feentor',
    'Bauwerk',
    // -------------------------------------------------------------------------------------------
    // AB HIER: der volle Wiki-Bestand, angehaengt 2026-08-03 fuer das Editor-Feld „Art“
    // (docs/superpowers/specs/2026-08-02-ort-bearbeiten-ortsarten-design.md).
    //
    // 🔴 SIE STEHEN HINTEN, UND DAS IST DER PUNKT. Der Erste, der einen Titel beansprucht, gewinnt
    // (siehe oben) -- alles hinter 'Bauwerk' kann daher keinen einzigen Artikel umklassifizieren,
    // den der Dump heute schon einordnet. avesmapsPlaceKindLegacyPrefix() haelt die ersten 24
    // Eintraege byte-genau fest, damit das so bleibt.
    //
    // Quelle: Wiki-Kategoriebaum, live erhoben 2026-08-02 (Kategorie:Bauwerk nach Art,
    // Kategorie:Bauwerk nach Verwendung, Kategorie:Siedlung nach Art).
    // „Straße" fehlt bewusst: das ist ein WEG, kein Punkt (gehoert in PATH_SUBTYPE_KEYS).
    //
    // Kategorie:Bauwerk nach Art -- die, die noch nicht oben stehen
    'Akademie', 'Amphitheater', 'Arena', 'Binge', 'Brücke', 'Brunnen', 'Damm', 'Deich',
    'Eispalast', 'Fährstation', 'Feggagir', 'Gutshof', 'Hafen', 'Kanalisation', 'Kriegshafen',
    'Labyrinth', 'Luftschiffhafen', 'Mauer', 'Plantage', 'Platz', 'Pyramide', 'Schloss',
    'Stadion', 'Stadttor', 'Statue', 'Theater', 'Therme', 'Tor (Bauwerk)', 'Torbogen', 'Treppe',
    'Zoo', 'Äquadukt',
    // Kategorie:Bauwerk nach Verwendung -- die, die noch nicht oben stehen
    'Archiv', 'Bank', 'Bibliothek', 'Garnison', 'Gestüt', 'Gildenhaus', 'Grabanlage',
    'Kaiserpfalz', 'Karawanserei', 'Kerker', 'Kontor', 'Labor', 'Lagerhaus', 'Museum',
    'Observatorium', 'Remise', 'Siechenhaus', 'Stall', 'Verwaltungsgebäude', 'Wohnhaus',
    'Zeughaus', 'Zunfthaus',
    // Kategorie:Siedlung nach Art -- das sind SIEDLUNGEN mit einer Groesse, keine Bauwerke. Sie
    // stehen hier, weil „Art" im Editor eine Achse fuer JEDE Ortsgroesse ist: eine Oase hat eine
    // Art und eine Groesse. „Ruine" fehlt -- siehe AVESMAPS_PLACE_KIND_HIDDEN.
    'Oase', 'Eshbathya', 'Hof', 'Hof (Thorwal)', 'Zwergenstadt', 'Wehrhof', 'Gut',
    'Unterirdische Siedlung', 'Tiefe Stadt', 'Schwimmende Siedlung', 'Elementare Stadt',
    'Planstadt',
];

// Wie viele Eintraege am Anfang der Liste der Dump-Klassifizierung gehoeren und deshalb weder in
// Inhalt noch Reihenfolge angetastet werden duerfen. Alles danach ist reines Editor-Vokabular.
const AVESMAPS_PLACE_KIND_LEGACY_PREFIX_LENGTH = 24;

// Katalognamen, die der CRAWL braucht, die der EDITOR aber nicht anbieten darf.
// 'Ruine'   -- ist bei uns das eigene Merkmal is_ruined, und die Infobox haengt „(Ruine)" selbst
//              an. Als waehlbare Art gaebe es „Festung" und „Festung + Ruine" doppelt.
// 'Bauwerk' -- die Sammelkategorie ohne Aussage; identisch mit „Feld leer lassen".
const AVESMAPS_PLACE_KIND_HIDDEN = ['Ruine', 'Bauwerk'];

// Laengste Ortsart, die gespeichert wird -- gleich wiki_sync_pages.building_type (VARCHAR(120)),
// damit ein Wert zwischen beiden Welten nie beschnitten wird.
const AVESMAPS_PLACE_KIND_MAX_LENGTH = 120;

// Der unveraenderliche Kopf der Liste. Existiert als Funktion, damit der Test ihn festnageln kann,
// ohne die 90 Eintrage zu duplizieren.
function avesmapsPlaceKindLegacyPrefix(): array {
    return array_slice(AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES, 0, AVESMAPS_PLACE_KIND_LEGACY_PREFIX_LENGTH);
}

// Wege/lineare Infrastruktur, die NICHT als Siedlung/Staette gelistet wird (Strassen laufen ueber den
// Wege-WikiSync). Vergleich gefaltet (Kleinschreibung + ss/ae/oe/ue), damit z. B. „Straße" matcht.
//
// Stand bis 2026-08-03 in settlements.php; hierher gezogen, ohne eine Zeile zu aendern. Sie
// beantwortet dieselbe Frage wie der Katalog daneben -- „ist dieser Name ueberhaupt ein PUNKT auf
// der Karte?" -- und wird jetzt von BEIDEN Abnehmern benutzt: vom Crawl (wie bisher) und von der
// Editor-Liste (neu). Deshalb stehen Mauer/Damm/Deich/Kanalisation/Aequadukt sehr wohl im Katalog
// oben (sie SIND Unterkategorien von „Bauwerk nach Art", der Katalog spiegelt das Wiki ehrlich) --
// dass sie kein waehlbarer Ort sind, sagt diese Funktion, an einer Stelle, fuer alle.
function avesmapsWikiSettlementIsExcludedBuildingType(string $type): bool {
    static $excluded = ['strasse', 'reichsstrasse', 'mauer', 'damm', 'deich', 'kanalisation', 'aequadukt'];
    $folded = str_replace(['ß', 'ä', 'ö', 'ü'], ['ss', 'ae', 'oe', 'ue'], mb_strtolower(trim($type), 'UTF-8'));
    return in_array($folded, $excluded, true);
}

// Die dem Editor angebotenen Arten: der Katalog ohne die versteckten und ohne die lineare
// Infrastruktur. Die Reihenfolge hier ist bedeutungslos -- api/app/place-kinds.php sortiert nach
// gemessener Haeufigkeit.
function avesmapsPlaceKindCatalog(): array {
    $kinds = array_diff(AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES, AVESMAPS_PLACE_KIND_HIDDEN);
    return array_values(array_filter(
        $kinds,
        static fn(string $kind): bool => !avesmapsWikiSettlementIsExcludedBuildingType($kind)
    ));
}

// Rastet einen frei getippten Namen auf seine kanonische Schreibweise ein, case-insensitiv.
// Ohne das kaemen „Brücke", „brücke" und „BRÜCKE" als drei Arten in die Liste -- dieselbe
// Vereinheitlichung, die sources per url_hash macht.
//
// Ein Name, den der Katalog NICHT kennt, wird getrimmt und gekappt durchgelassen: das Vokabular
// soll den Editor nicht blockieren, wenn das Wiki eine Art kennt, die diese Liste noch nicht hat.
// Ein VERSTECKTER Name ergibt '' -- „Ruine" ist is_ruined, keine Art.
//
// PURE. Der Test laeuft ohne Datenbank und ohne Browser.
function avesmapsNormalizePlaceKind(string $value): string {
    $value = trim($value);
    if ($value === '') {
        return '';
    }
    // Was der Editor gar nicht erst anbietet, darf auch nicht per Tippen hereinkommen: „Ruine" ist
    // is_ruined, „Bauwerk" heisst nichts, und „Straße"/„Mauer"/… sind keine Punkte.
    if (avesmapsWikiSettlementIsExcludedBuildingType($value)) {
        return '';
    }
    $needle = mb_strtolower($value, 'UTF-8');
    foreach (AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES as $kind) {
        if ($needle === mb_strtolower($kind, 'UTF-8')) {
            return in_array($kind, AVESMAPS_PLACE_KIND_HIDDEN, true) ? '' : $kind;
        }
    }
    return mb_substr($value, 0, AVESMAPS_PLACE_KIND_MAX_LENGTH, 'UTF-8');
}

// PURE. Katalog + gemessene Haeufigkeiten -> die Antwortzeilen von api/app/place-kinds.php.
//
// Gleichstand und Null fallen auf alphabetisch zurueck, damit das Ende der Liste zwischen zwei
// Anfragen STABIL bleibt: eine Liste, die unter dem Cursor umspringt, ist schlimmer als eine, die
// bloss lang ist. (usort ist seit PHP 8.0 stabil, die Zweitsortierung ist trotzdem explizit --
// sie ist eine Zusage an den Client, keine Nebenwirkung der Implementierung.)
function avesmapsRankPlaceKinds(array $catalog, array $counts): array {
    $ranked = [];
    foreach ($catalog as $kind) {
        $ranked[] = ['kind' => (string) $kind, 'count' => (int) ($counts[$kind] ?? 0)];
    }
    usort($ranked, static function (array $a, array $b): int {
        if ($a['count'] !== $b['count']) {
            return $b['count'] <=> $a['count'];
        }
        return strcmp($a['kind'], $b['kind']);
    });
    return $ranked;
}

// Filtert den Katalog gegen einen Suchbegriff -- dieselbe Regel, die der Client im Speicher
// anwendet, damit beide Seiten dasselbe Ergebnis liefern. Leerer Begriff = alles.
function avesmapsFilterPlaceKinds(array $kinds, string $term): array {
    $term = trim($term);
    if ($term === '') {
        return array_values($kinds);
    }
    $needle = mb_strtolower($term, 'UTF-8');
    return array_values(array_filter($kinds, static function ($kind) use ($needle): bool {
        return mb_strpos(mb_strtolower((string) $kind, 'UTF-8'), $needle) !== false;
    }));
}
