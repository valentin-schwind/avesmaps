<?php

declare(strict_types=1);

// Die Gottheit einer Kultstätte -- die DRITTE Achse neben Ortsgröße (feature_subtype) und
// Ortsart (properties.place_kind). Sie beantwortet Discord-Fall #54 (Drachenschuppe, 27.07.2026):
// „wo liegt eigentlich der nächste [Gottheit]-Schrein? Und gibt es in Darpatien eigentlich
// Rahja-Schreine außerhalb von Rommilys?"
//
// 🔴 KEINE Ortsart. „Rahja-Tempel" als place_kind hätte „Rahja-Schrein" zu einer zweiten,
// unverbundenen Art gemacht, und die 29 Schreine hätten gar keine bekommen -- sie tragen im Wiki
// keine Götter-Kategorie. Eine Achse, ein Feld: dieselbe Trennung, die am 2026-08-03 die
// Ortsgröße von der Ortsart getrennt hat (docs/…/2026-08-02-ort-bearbeiten-ortsarten-design.md).
//
// 💣 EINE TABELLE, KEINE ABLEITUNG. Wer aus dem Kategorienamen rechnen will, muss an
// „Rastullah-Bethaus", „Oktrale" und „Rur und Gror-Tempel" scheitern -- drei Formen, die jede
// Regel brechen, die für die anderen 42 gilt.
//
// 💣 Und sie steht NICHT im Wikitext. Geprüft am 2026-08-15: „Drachentempel" ist laut API in
// Kategorie:Rondra-Tempel, sein Quelltext enthält keinen solchen Link -- die Kategorie kommt über
// eine Vorlage. Der Dump-Pfad kann die Gottheit deshalb prinzipiell nicht selbst sehen; sie kommt
// aus der Kategorie-Schicht (dump-category-layer.php) und reist als Override mit.
//
// Quelle: die Unterkategorien von „Kategorie:Tempel" (27) und „Kategorie:Heiligtum" (18), live
// erhoben am 2026-08-15 über list=categorymembers.
const AVESMAPS_DEITY_CATEGORIES = [
    'Angrosch-Tempel' => 'Angrosch',
    'Aves-Tempel' => 'Aves',
    'Boron-Tempel' => 'Boron',
    'Chrysir-Tempel' => 'Chrysir',
    'Efferd-Tempel' => 'Efferd',
    'Firun-Tempel' => 'Firun',
    'Hesinde-Tempel' => 'Hesinde',
    'Ifirn-Tempel' => 'Ifirn',
    'Ingerimm-Tempel' => 'Ingerimm',
    'Kor-Tempel' => 'Kor',
    'Mada-Tempel' => 'Mada',
    'Marbo-Tempel' => 'Marbo',
    'Mokoscha-Tempel' => 'Mokoscha',
    'Namenloser-Tempel' => 'Namenloser',
    'Nandus-Tempel' => 'Nandus',
    // ⚠️ Ein Oktral ist ein Zwölfgötter-Sammeltempel, kein Gott -- die einzige Zeile dieser Liste,
    // die eine DEUTUNG enthält statt einer Ablesung. Zwei Artikel betroffen (Stand 15.08.2026).
    'Oktrale' => 'Zwölfgötter',
    'Peraine-Tempel' => 'Peraine',
    'Phex-Tempel' => 'Phex',
    'Praios-Tempel' => 'Praios',
    'Rahja-Tempel' => 'Rahja',
    'Rastullah-Bethaus' => 'Rastullah',
    'Rondra-Tempel' => 'Rondra',
    'Rur und Gror-Tempel' => 'Rur und Gror',
    'Shinxir-Tempel' => 'Shinxir',
    'Swafnir-Tempel' => 'Swafnir',
    'Travia-Tempel' => 'Travia',
    'Tsa-Tempel' => 'Tsa',
    'Heiligtum Boron' => 'Boron',
    'Heiligtum Chrysir' => 'Chrysir',
    'Heiligtum Efferd' => 'Efferd',
    'Heiligtum Firun' => 'Firun',
    'Heiligtum Hesinde' => 'Hesinde',
    'Heiligtum Ingerimm' => 'Ingerimm',
    'Heiligtum Mada' => 'Mada',
    'Heiligtum Namenloser' => 'Namenloser',
    'Heiligtum Nandus' => 'Nandus',
    'Heiligtum Phex' => 'Phex',
    'Heiligtum Praios' => 'Praios',
    'Heiligtum Rahja' => 'Rahja',
    'Heiligtum Rastullah' => 'Rastullah',
    'Heiligtum Rondra' => 'Rondra',
    'Heiligtum Simia' => 'Simia',
    'Heiligtum Tairach' => 'Tairach',
    'Heiligtum Travia' => 'Travia',
    'Heiligtum Tsa' => 'Tsa',
];

// Längste gespeicherte Gottheitenliste -- gleich der Spaltenbreite wiki_sync_pages.deity.
const AVESMAPS_DEITY_MAX_LENGTH = 120;

// Trennzeichen der mehrwertigen Speicherung. Ein Komma, weil keine Gottheit eines trägt
// (geprüft: „Rur und Gror" ist der einzige mehrteilige Name, und er kommt ohne aus).
const AVESMAPS_DEITY_SEPARATOR = ',';

/**
 * PURE: die Gottheiten aus der Kategorieliste eines Artikels.
 *
 * 💣 MEHRWERTIG. Der Feuersturm-Tempel steht live in „Ingerimm-Tempel" UND „Rondra-Tempel"; ein
 * einzelner String verlöre hier lautlos die Hälfte. Reihenfolge wie übergeben, Doppelte fallen
 * zusammen (eine Stätte kann Tempel- und Heiligtum-Kategorie derselben Gottheit tragen).
 *
 * @param list<string> $categoryNames Kategorien OHNE „Kategorie:"-Präfix
 * @return list<string>
 */
function avesmapsDeitiesFromCategories(array $categoryNames): array {
    $found = [];
    foreach ($categoryNames as $name) {
        $deity = AVESMAPS_DEITY_CATEGORIES[trim((string) $name)] ?? null;
        if ($deity !== null && !in_array($deity, $found, true)) {
            $found[] = $deity;
        }
    }
    return $found;
}

/**
 * PURE: die Liste als Speicherwert („Ingerimm,Rondra"). Leere Liste -> leerer String, nie null:
 * dieselbe Zeile wird auch für Bauwerke ohne Gottheit geschrieben.
 *
 * @param list<string> $deities
 */
function avesmapsDeitiesToStored(array $deities): string {
    $clean = array_values(array_filter(array_map('trim', $deities), static fn(string $d): bool => $d !== ''));
    return mb_substr(implode(AVESMAPS_DEITY_SEPARATOR, $clean), 0, AVESMAPS_DEITY_MAX_LENGTH, 'UTF-8');
}

/**
 * PURE: der Speicherwert zurück in eine Liste. Verträgt Leerzeichen und leere Glieder, damit ein
 * von Hand gepflegter Wert nicht in leeren Beschriftungen endet.
 *
 * @return list<string>
 */
function avesmapsDeitiesFromStored(?string $stored): array {
    return array_values(array_filter(
        array_map('trim', explode(AVESMAPS_DEITY_SEPARATOR, (string) $stored)),
        static fn(string $d): bool => $d !== ''
    ));
}

/**
 * PURE: die Beschriftung „Rahja-Tempel" aus Gottheit + Ortsart.
 *
 * 💣 Fehlt eine Hälfte, bleibt die andere unverändert -- eine Zeile „-Tempel" oder „Rahja-" wäre
 * schlimmer als die alte Zeile „Tempel". Beide leer ergibt leer, nie einen nackten Bindestrich.
 */
function avesmapsDeityLabel(string $deity, string $placeKind): string {
    $deity = trim($deity);
    $placeKind = trim($placeKind);
    if ($deity === '' || $placeKind === '') {
        return $deity !== '' ? $deity : $placeKind;
    }
    return $deity . '-' . $placeKind;
}
