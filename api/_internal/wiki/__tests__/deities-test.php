<?php

declare(strict_types=1);

/**
 * Unit-Test der reinen Gottheiten-Tabelle (api/_internal/wiki/deities.php).
 * Keine Datenbank, kein HTTP, kein Browser.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/deities-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}
if (!function_exists('mb_substr')) {
    fwrite(STDERR, "FATAL: mbstring fehlt, die Tabelle kappt mit mb_substr().\n");
    exit(2);
}

require __DIR__ . '/../deities.php';

// 27 Unterkategorien von „Tempel" + 18 von „Heiligtum", live erhoben 2026-08-15.
assert(count(AVESMAPS_DEITY_CATEGORIES) === 45, 'Tabellengroesse: ' . count(AVESMAPS_DEITY_CATEGORIES));

// ---------------------------------------------------------------- DER NORMALFALL ---
assert(avesmapsDeitiesFromCategories(['Rondra-Tempel']) === ['Rondra']);
assert(avesmapsDeitiesFromCategories(['Heiligtum Rahja']) === ['Rahja']);

// ------------------------------------------------------------------- MEHRWERTIG ---
// 💣 Der Feuersturm-Tempel steht LIVE in zwei Goetter-Kategorien. Ein einzelner String verloere
// hier lautlos die Haelfte -- deshalb ist das Feld eine Liste.
assert(avesmapsDeitiesFromCategories(['Ingerimm-Tempel', 'Rondra-Tempel']) === ['Ingerimm', 'Rondra']);
// Doppelte Nennung derselben Gottheit (Tempel- UND Heiligtum-Kategorie) faellt zusammen.
assert(avesmapsDeitiesFromCategories(['Rondra-Tempel', 'Heiligtum Rondra']) === ['Rondra']);

// ------------------------------------------- DIE DREI, DIE JEDE NAMENSREGEL BRECHEN ---
// 💣 Genau deshalb ist es eine TABELLE und keine Ableitung aus dem Kategorienamen.
assert(avesmapsDeitiesFromCategories(['Rastullah-Bethaus']) === ['Rastullah']);
assert(avesmapsDeitiesFromCategories(['Rur und Gror-Tempel']) === ['Rur und Gror']);
assert(avesmapsDeitiesFromCategories(['Namenloser-Tempel']) === ['Namenloser']);
assert(avesmapsDeitiesFromCategories(['Oktrale']) === ['Zwölfgötter']);

// ------------------------------------------------------------- FREMDES BLEIBT DRAUSSEN ---
// Die Kategorieliste eines Artikels enthaelt Dutzende Eintraege („Aventurien-Artikel",
// „Bauwerk in Grangor", „Index-Dr") -- keiner davon darf eine Gottheit erzeugen.
assert(avesmapsDeitiesFromCategories(['Bauwerk in Grangor', 'Index-Dr', 'Aventurien-Artikel']) === []);
assert(avesmapsDeitiesFromCategories([]) === []);
assert(avesmapsDeitiesFromCategories(['Tempel']) === [], 'die Sammelkategorie ist keine Gottheit');
// Raender werden getrimmt (die API liefert sie sauber, ein Dump-Parser nicht immer).
assert(avesmapsDeitiesFromCategories(['  Rondra-Tempel  ']) === ['Rondra']);

// ------------------------------------------------------------------ SPEICHERN + LESEN ---
assert(avesmapsDeitiesToStored(['Ingerimm', 'Rondra']) === 'Ingerimm,Rondra');
assert(avesmapsDeitiesToStored([]) === '', 'leere Liste -> leerer String, nie null');
assert(avesmapsDeitiesToStored(['', '  ']) === '', 'nur Leeres -> leer');
assert(avesmapsDeitiesFromStored('Ingerimm,Rondra') === ['Ingerimm', 'Rondra']);
assert(avesmapsDeitiesFromStored('') === []);
assert(avesmapsDeitiesFromStored(null) === []);
// ⚠️ Ein von Hand gepflegter Wert darf nicht in leeren Beschriftungen enden.
assert(avesmapsDeitiesFromStored(' Rondra , , Ingerimm ') === ['Rondra', 'Ingerimm']);
// Hin und zurueck ist verlustfrei -- das ist die Zusicherung, auf der Suche und Infobox stehen.
$rund = ['Ingerimm', 'Rondra'];
assert(avesmapsDeitiesFromStored(avesmapsDeitiesToStored($rund)) === $rund);

// -------------------------------------------------------------------- DIE BESCHRIFTUNG ---
assert(avesmapsDeityLabel('Rahja', 'Tempel') === 'Rahja-Tempel');
assert(avesmapsDeityLabel('Rondra', 'Schrein') === 'Rondra-Schrein');
assert(avesmapsDeityLabel('Rur und Gror', 'Tempel') === 'Rur und Gror-Tempel');
// 💣 Fehlt eine Haelfte, bleibt die andere unveraendert -- nie „-Tempel", nie „Rahja-".
assert(avesmapsDeityLabel('', 'Tempel') === 'Tempel');
assert(avesmapsDeityLabel('Rahja', '') === 'Rahja');
assert(avesmapsDeityLabel('', '') === '');
assert(avesmapsDeityLabel('  ', ' Tempel ') === 'Tempel', 'Raender getrimmt');

// ----------------------------------------------------------------- KEINE STILLE KAPPUNG ---
// Die Spalte ist VARCHAR(120); ein absurd langer Wert wird gekappt, nicht abgelehnt -- er ist
// hier immer maschinell erzeugt, und eine Ausnahme wuerde einen ganzen Dump-Lauf stoppen.
$lang = avesmapsDeitiesToStored(array_fill(0, 40, 'Rondra'));
assert(mb_strlen($lang, 'UTF-8') <= AVESMAPS_DEITY_MAX_LENGTH, 'gekappt auf die Spaltenbreite');

echo "deities: alle Zusicherungen erfuellt\n";
