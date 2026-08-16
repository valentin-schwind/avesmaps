<?php

declare(strict_types=1);

/**
 * Der EINE Lizenzkatalog fuer jeden Bild-Upload in Avesmaps.
 *
 * Bis zum 16.08.2026 trugen fuenf Flaechen fuenf getrennte Vokabulare: Stadtkarten sechs Werte,
 * Siedlungsbilder vier, Territoriums-Wappen zwei, Siedlungs-Wappen einen fest verdrahteten, und die
 * Literatur-Cover gar keinen. citymaps.php:36-37 benannte das Problem schon damals ("three places
 * with nothing keeping them in sync") -- diese Datei beendet es, statt eine sechste Liste danebenzustellen.
 *
 * 💣 KEINE zweite Liste anlegen. Eine neue Flaeche, die Lizenzen braucht, liest hier -- das ist
 * dieselbe Lehre wie beim Quellen-System (AGENTS §5): dort kostete eine eigene `lore_source`-Tabelle
 * eine Schema-Erweiterung, eine Datenmigration und einen kompletten Neutest, gegen zwei Zeilen, die
 * es vorher gekostet haette.
 *
 * ⚠️ Diese Datei hat KEINE Seiteneffekte auf oberster Ebene: kein Bootstrap, keine DB, kein DDL,
 * keine Ausgabe. Nur so kann jeder Endpunkt sie folgenlos `require_once`n -- auch die, die selbst
 * kein PDO aufbauen.
 *
 * Die JS-Entsprechung liegt in js/app/media-licenses.js und wird von
 * js/app/__tests__/media-licenses-parity.test.js Wert fuer Wert gegen DIESE Datei geprueft. Wer hier
 * etwas aendert und dort nicht, faehrt einen roten Test -- und das ist der Sinn der Uebung.
 */

/**
 * Die sieben Kennungen in ANZEIGEREIHENFOLGE (Entwurf §2). Die Reihenfolge ist Teil des Vertrags,
 * nicht bloss eine Schreibweise: die Auswahlfelder der fuenf Editoren bauen sich aus dieser Liste,
 * und der Paritaetstest vergleicht sie Stelle fuer Stelle gegen die JS-Seite.
 *
 * 🔴 Sechs der sieben sind die Kennungen, die die Stadtkarten seit dem 01.08.2026 tragen
 * (AVESMAPS_CITYMAP_LICENSES). Das ist kein Zufall, sondern der Grund, warum die Migration der
 * Karten aus null Zeilen besteht -- nur `cc_by` ist neu.
 *
 * ⚠️ GLEICHER NAME, ANDERE FORM als drueben: js/app/media-licenses.js nennt seine Liste ebenfalls
 * AVESMAPS_MEDIA_LICENSES, fuehrt dort aber OBJEKTE ({value, label, public}), weil ein <option> genau
 * das braucht. Hier sind es blanke Strings, damit in_array() ohne Umweg funktioniert. Wer Code von
 * einer Seite auf die andere traegt, muss die Form mitdenken -- der Paritaetstest vergleicht die
 * Werte, nicht die Struktur.
 */
const AVESMAPS_MEDIA_LICENSES = [
    'unknown_other',
    'public_domain',
    'cc0',
    'cc_by',
    'permission_granted',
    'ai_generated',
    'own_work',
];

/**
 * Die fuenf Werte, unter denen ein Bild im Frontend erscheinen darf.
 *
 * 🔴 `cc_by` und `unknown_other` fehlen hier ABSICHTLICH und werden trotzdem gespeichert: die
 * Namensnennung, die CC-BY verlangt, muesste am Bild selbst stehen, und diese Flaeche gibt es im
 * Frontend nicht (Owner-Entscheid 16.08.2026: Urheber und Kommentar bleiben im Editor). Ein CC-BY-Bild
 * ohne sichtbaren Nachweis zu zeigen waere ein Lizenzverstoss; die Angabe beim Upload wegzuwerfen
 * waere Datenverlust. Gespeichert-aber-still ist der einzige ehrliche dritte Weg.
 *
 * ⚠️ `permission_granted` ist keine Lizenz, sondern eine Erlaubnis: das Werk kann unter beliebiger
 * Lizenz stehen, entscheidend ist die Zustimmung des Urhebers -- ausdruecklich auch ohne genannt zu
 * werden. Deshalb steht es hier, obwohl es ueber die Lizenz des Werks nichts aussagt.
 */
const AVESMAPS_MEDIA_LICENSES_PUBLIC = [
    'public_domain',
    'cc0',
    'permission_granted',
    'ai_generated',
    'own_work',
];

/**
 * Die deutschen Beschriftungen. Schluesselreihenfolge == AVESMAPS_MEDIA_LICENSES (im Test verankert),
 * damit ein Auswahlfeld direkt darueber laufen kann, ohne die Reihenfolge ein zweites Mal zu kennen.
 *
 * ⚠️ Der Zusatz "(nicht oeffentlich)", den die Karten heute an ihrem letzten Eintrag tragen, steht
 * hier NICHT: welche Werte still bleiben, sagt die Liste oben, und ein in die Beschriftung gebackener
 * Hinweis waere eine zweite, konkurrierende Wahrheit. Die Dialoge kennzeichnen die stillen Werte in
 * Phase 4 aus AVESMAPS_MEDIA_LICENSES_PUBLIC heraus.
 */
const AVESMAPS_MEDIA_LICENSE_LABELS = [
    'unknown_other' => 'Unbekannt/Sonstiges',
    'public_domain' => 'Public Domain',
    'cc0' => 'CC0',
    'cc_by' => 'CC-BY',
    'permission_granted' => 'Genehmigung erteilt',
    'ai_generated' => 'Von uns KI-generiert',
    'own_work' => 'Eigene Kreation',
];

/**
 * Vorschlagstext, den die Dialoge in Phase 4 bei der Wahl "Genehmigung erteilt" in ein LEERES
 * Kommentarfeld setzen (nie ueber einen vorhandenen Text).
 *
 * ⚠️ Er steht hier und nicht in den Dialogen, weil er sonst in fuenf Oberflaechen einzeln
 * abgeschrieben wuerde -- und abgeschriebene Texte laufen auseinander (AGENTS §11, die Listenzeile).
 */
const AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE =
    'Urheber ist mit der Nutzung einverstanden, ausdrücklich auch ohne Namensnennung.';

/**
 * Bringt einen beliebigen gespeicherten oder gesendeten Wert auf eine Katalog-Kennung.
 *
 * Alles, was nicht wortgleich im Katalog steht, faellt auf $fallback -- und $fallback selbst wird
 * ebenfalls geprueft. 💣 Ohne diese zweite Pruefung reichte ein Tippfehler in der Vorgabe eines
 * Aufrufers einen katalogfremden Wert in die Datenbank durch, und zwar auf einem Weg, den keine
 * Eingabepruefung sieht.
 *
 * ⚠️ Es wird NICHT kleingeschrieben: 'CC0' ist ein Fehler, keine Schreibvariante. Wer eine
 * Grossschreibung durchliesse, koennte den Wert spaeter nicht mehr vergleichen, ohne ueberall zu
 * normalisieren -- und genau eine dieser Stellen wuerde vergessen.
 */
function avesmapsMediaLicenseNormalize(mixed $value, string $fallback = 'unknown_other'): string
{
    $vorgabe = in_array($fallback, AVESMAPS_MEDIA_LICENSES, true) ? $fallback : 'unknown_other';
    $wert = is_string($value) ? trim($value) : '';

    return in_array($wert, AVESMAPS_MEDIA_LICENSES, true) ? $wert : $vorgabe;
}

/**
 * Darf ein Bild mit diesem Wert im Frontend erscheinen?
 *
 * 🔴 Nimmt bewusst KEINE Vorgabe entgegen. Duerfte ein Aufrufer hier 'ai_generated' als Rueckfall
 * setzen, machte jeder unbekannte String sein Bild oeffentlich -- die Umkehrung der Regel, vor der
 * api/edit/map/citymap-image.php:190-191 seit dem 01.08.2026 warnt ("Normalising FIRST means an
 * unknown string falls to 'unknown_other' and is refused -- never the other way round").
 * Erst normalisieren, dann pruefen. Immer in dieser Reihenfolge.
 */
function avesmapsMediaLicenseIsPublic(mixed $value): bool
{
    return in_array(avesmapsMediaLicenseNormalize($value), AVESMAPS_MEDIA_LICENSES_PUBLIC, true);
}

/**
 * Die deutsche Beschriftung einer Kennung. Ein unbekannter Wert bekommt die von 'unknown_other' --
 * dieselbe Rangfolge wie ueberall, damit eine Oberflaeche nie ein leeres Auswahlfeld zeigt.
 */
function avesmapsMediaLicenseLabel(mixed $value): string
{
    return AVESMAPS_MEDIA_LICENSE_LABELS[avesmapsMediaLicenseNormalize($value)];
}
