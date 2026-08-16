# Lizenzangaben Phase 2 (Migration) — Bauplan

> **Für agentische Umsetzer:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Checkboxen (`- [ ]`).

**Entwurf:** `docs/superpowers/specs/2026-08-16-lizenzangaben-vereinheitlichung-design.md` (§6)
**Vorgänger:** Phase 1 ist live (`b2f7fb62`, `676c6132`, `5bbdf210`) — der Katalog existiert,
benutzt ihn aber noch niemand.

**Ziel:** Die Bestandswerte aller fünf Flächen auf den gemeinsamen Katalog bringen und jeden Upload
mit „wer" und „wann" versehen — **ohne dass ein einziges Bild seine Sichtbarkeit wechselt.**

**Bauart:** Ein Zuordnungs-Kern ohne Datenbank (rein rechnend, damit die tragende Zusicherung
testbar ist), darauf ein resumierbarer Lauf mit Vorschau. Die Dialoge bleiben unberührt (Phase 4),
die Gates bleiben unberührt (Phase 3).

**Technik:** PHP 8 (`declare(strict_types=1)`), PDO/MySQL, Tests mit `assert()` gegen SQLite.

## Globale Vorgaben

Gelten für **jede** Aufgabe:

- **Kommentare und Commit-Nachrichten auf Deutsch** (AGENTS §8). Katalog-Kennungen und
  `error.code`-Werte bleiben englisch.
- **Der Baum ist geteilt: niemals `git add -A`, `git add .` oder `git commit -a`** (AGENTS §9).
  Vor jedem Commit `git status`, nur eigene Pfade einzeln stagen. ⚠️ In dieser Arbeitskopie liegt
  regelmäßig unfertige Arbeit anderer Sitzungen — sie bleibt liegen, auch wenn sie Tests rot färbt.
- **Vor dem Push läuft das GANZE Testfeld.** 💣 Sind rote Tests dabei, die **nicht** zu den eigenen
  Dateien gehören, ist das kein Freibrief und kein eigener Befund: dann in einem separaten
  Arbeitsbaum auf dem Commit-Stand prüfen (`git worktree add --detach <scratchpad>/pruefbaum HEAD`),
  denn nur der belegt, was der Push wirklich überträgt.
- **Die sieben Kennungen sind gesetzt** und stehen in `api/_internal/media-license.php`:
  `unknown_other`, `public_domain`, `cc0`, `cc_by`, `permission_granted`, `ai_generated`, `own_work`.
  Öffentlich sind fünf; `cc_by` und `unknown_other` **nicht**.
- 🔴 **Die tragende Zusicherung dieser Phase: kein Bild wechselt seine Sichtbarkeit.** Sie ist ein
  Test, keine Absichtserklärung (Aufgabe 1).
- 🔴 **Diese Phase baut KEIN Gate ein und ändert keines.** `AVESMAPS_COAT_PUBLIC_LICENSES` bleibt
  auf `['public_domain']`, die Siedlungs-Wappen bleiben ungegated. Das ist Phase 3 — und sie darf
  erst laufen, wenn diese hier durch ist (Entwurf §9, 💣).
- **Kein Dialog wird angefasst** (Phase 4). Kein `?v=` von Hand.

---

## Warum die Reihenfolge dieser Phase scharf ist

Der Katalog kennt bewusst keine Alias-Zuordnung: `avesmapsMediaLicenseNormalize('own')` liefert
`unknown_other`, also **nicht öffentlich**. Die Siedlungs-Wappen stehen heute nur deshalb auf der
Karte, weil es dort gar kein Gate gibt. Zwischen dieser Phase und Phase 3 liegt also ein Fenster, in
dem der Bestand bereits Katalogwerte trägt, aber noch niemand ihn prüft — das ist der sichere
Zustand. Die umgekehrte Reihenfolge wäre der stille Ausfall.

---

## Dateien dieser Phase

| Datei | Verantwortung |
|---|---|
| `api/_internal/media-license-migration.php` | **neu** — die Alias-Zuordnung je Fläche, rein rechnend, ohne DB. Hier lebt das Wissen über die alten Vokabulare; der Katalog bleibt frei davon. |
| `api/_internal/__tests__/media-license-migration-test.php` | **neu** — der Abnahmefall: jeder Altwert jeder Fläche, Sichtbarkeit vorher == nachher. |
| `api/_internal/media-license-migration-run.php` | **neu** — der Lauf: liest den Bestand, baut die Vorschau, schreibt auf Freigabe. Resumierbar. |
| `api/_internal/__tests__/media-license-migration-run-test.php` | **neu** — der Lauf gegen eine SQLite-Fixture: Vorschau schreibt nichts, Anwendung ist idempotent. |
| `api/edit/admin/media-license-migration.php` | **neu** — Endpunkt (admin), `dry_run` als Vorgabe. |
| `api/_internal/app/game-literature.php` | ändern — fünf `cover_*`-Spalten nachrüsten. |
| `api/_internal/app/citymaps.php` | ändern — sechs `*_author` / `*_uploaded_*`-Spalten nachrüsten. |
| `api/_internal/wiki/sync-monitor-licenses.php` | ändern — der Parser schreibt `cc_by` statt `attribution_required`. |

---

## Aufgabe 1: Der Zuordnungs-Kern und die tragende Zusicherung

Die wichtigste Aufgabe der Phase. Sie hat keine Datenbank, damit die Zusicherung ohne Fixture
beweisbar ist.

**Dateien:**
- Neu: `api/_internal/media-license-migration.php`
- Test: `api/_internal/__tests__/media-license-migration-test.php`

**Schnittstellen:**
- Verbraucht aus Phase 1: `avesmapsMediaLicenseNormalize()`, `avesmapsMediaLicenseIsPublic()`,
  `AVESMAPS_MEDIA_LICENSES` aus `api/_internal/media-license.php`.
- Liefert:
  - `AVESMAPS_MEDIA_LICENSE_SURFACES` — `list<string>`:
    `['settlement_coat', 'territory_coat', 'settlement_image', 'citymap', 'cover']`
  - `avesmapsMediaLicenseMigrateLegacy(string $surface, mixed $legacy): string`
  - `avesmapsMediaLicenseLegacyWasPublic(string $surface, mixed $legacy): bool`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `api/_internal/__tests__/media-license-migration-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Der ABNAHMEFALL der Migration. Keine DB, kein HTTP. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/media-license-migration-test.php
 *
 * 🔴 Die tragende Zusicherung steht im Abschnitt "kein Bild wechselt seine Sichtbarkeit". Sie ist der
 * Grund, warum die Zuordnung ueberhaupt eine eigene, DB-freie Datei bekommt: eine Migration, die still
 * ein paar hundert Wappen abschaltet, ist von einer geglueckten nicht zu unterscheiden, bis es
 * jemandem auffaellt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../media-license-migration.php';

// ---- die Zuordnung je Flaeche ---------------------------------------------------------------------
// 💣 Sie ist NICHT global: 'own' heisst bei den Siedlungs-Wappen "von einem Editor hochgeladen" und
// die Editoren haben diese Wappen mit KI erzeugt (Owner 16.08.2026) -- derselbe String bei einer
// anderen Flaeche hiesse nichts dergleichen. Deshalb traegt jede Zuordnung ihre Flaeche.
assert(avesmapsMediaLicenseMigrateLegacy('settlement_coat', 'own') === 'ai_generated');
assert(avesmapsMediaLicenseMigrateLegacy('settlement_coat', 'public_domain') === 'public_domain');
assert(avesmapsMediaLicenseMigrateLegacy('settlement_coat', '') === 'unknown_other');

assert(avesmapsMediaLicenseMigrateLegacy('territory_coat', 'attribution_required') === 'cc_by');
assert(avesmapsMediaLicenseMigrateLegacy('territory_coat', 'unknown') === 'unknown_other');
assert(avesmapsMediaLicenseMigrateLegacy('territory_coat', 'public_domain') === 'public_domain');
assert(avesmapsMediaLicenseMigrateLegacy('territory_coat', null) === 'unknown_other');

// Cover hatten ueberhaupt kein Feld -- der Lauf setzt den Wert, die Zuordnung liefert ihn.
assert(avesmapsMediaLicenseMigrateLegacy('cover', '') === 'permission_granted');
assert(avesmapsMediaLicenseMigrateLegacy('cover', null) === 'permission_granted');

// Siedlungsbilder und Stadtkarten tragen bereits Katalogwerte: unveraendert durchreichen.
foreach (['public_domain', 'cc0', 'ai_generated', 'unknown_other'] as $wert) {
    assert(avesmapsMediaLicenseMigrateLegacy('settlement_image', $wert) === $wert);
}
foreach (['public_domain', 'cc0', 'ai_generated', 'permission_granted', 'own_work', 'unknown_other'] as $wert) {
    assert(avesmapsMediaLicenseMigrateLegacy('citymap', $wert) === $wert);
}
// Ein leeres Siedlungsbild ist historisch ai_generated (Legacy-Strings zaehlten so, map-features.php:408).
assert(avesmapsMediaLicenseMigrateLegacy('settlement_image', '') === 'ai_generated');

// ---- Idempotenz ------------------------------------------------------------------------------------
// 🔴 Der Lauf ist resumierbar und darf abbrechen und neu starten duerfen. Ein zweiter Durchgang ueber
// bereits zugeordnete Zeilen muss folgenlos sein -- sonst waere jeder Wiederanlauf ein Datenrisiko.
foreach (AVESMAPS_MEDIA_LICENSE_SURFACES as $flaeche) {
    foreach (AVESMAPS_MEDIA_LICENSES as $kennung) {
        assert(
            avesmapsMediaLicenseMigrateLegacy($flaeche, $kennung) === $kennung,
            "nicht idempotent: {$flaeche}/{$kennung}"
        );
    }
}

// ---- eine unbekannte Flaeche ist ein Programmierfehler, kein Datenfall ------------------------------
// 💣 Sie faellt auf unknown_other = NICHT oeffentlich. Faellt sie auf etwas Oeffentliches, macht ein
// Tippfehler im Flaechennamen stillschweigend Bilder sichtbar.
assert(avesmapsMediaLicenseMigrateLegacy('gibtsnicht', 'own') === 'unknown_other');
assert(avesmapsMediaLicenseMigrateLegacy('gibtsnicht', 'public_domain') === 'public_domain');

// ---- KEIN BILD WECHSELT SEINE SICHTBARKEIT ---------------------------------------------------------
// 🔴 DER ABNAHMEFALL. Fuer jeden Altwert jeder Flaeche: war er vorher sichtbar, ist er es nachher --
// und war er unsichtbar, bleibt er es. avesmapsMediaLicenseLegacyWasPublic bildet den Zustand VOR
// dieser Phase ab, mit den Gates, wie sie am 16.08.2026 tatsaechlich standen.
$bestand = [
    // Flaeche            Altwert                  war sichtbar?
    ['settlement_coat',   'own',                   true],   // ⚠️ ungegated: JEDER Wert war sichtbar
    ['settlement_coat',   'public_domain',         true],
    ['settlement_coat',   '',                      false],  // ohne coat-Objekt gibt es kein Bild
    ['territory_coat',    'public_domain',         true],   // das Gate liess nur diesen durch
    ['territory_coat',    'attribution_required',  false],
    ['territory_coat',    'unknown',               false],
    ['territory_coat',    '',                      false],
    ['settlement_image',  'public_domain',         true],
    ['settlement_image',  'cc0',                   true],
    ['settlement_image',  'ai_generated',          true],
    ['settlement_image',  'unknown_other',         false],
    ['citymap',           'public_domain',         true],
    ['citymap',           'cc0',                   true],
    ['citymap',           'ai_generated',          true],
    ['citymap',           'permission_granted',    true],
    ['citymap',           'own_work',              true],
    ['citymap',           'unknown_other',         false],
    ['cover',             '',                      true],   // ⚠️ kein Feld, kein Gate: immer sichtbar
];
foreach ($bestand as [$flaeche, $altwert, $warSichtbar]) {
    assert(
        avesmapsMediaLicenseLegacyWasPublic($flaeche, $altwert) === $warSichtbar,
        "Vorher-Zustand falsch abgebildet: {$flaeche}/{$altwert}"
    );
    $neu = avesmapsMediaLicenseMigrateLegacy($flaeche, $altwert);
    assert(
        avesmapsMediaLicenseIsPublic($neu) === $warSichtbar,
        "SICHTBARKEIT GEWECHSELT: {$flaeche}/{$altwert} -> {$neu}"
    );
}

echo "media-license-migration-test: OK (" . count($bestand) . " Bestandsfaelle, keiner wechselt die Sichtbarkeit)\n";
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/media-license-migration-test.php
```

Erwartet: **Fehlschlag** mit `Failed to open stream` für `api/_internal/media-license-migration.php`.

- [ ] **Schritt 3: Die Datei schreiben**

Datei `api/_internal/media-license-migration.php`:

```php
<?php

declare(strict_types=1);

/**
 * Die Alias-Zuordnung der Phase 2: alte Lizenzwerte -> Katalog-Kennungen, je Flaeche.
 *
 * 💣 WARUM DAS NICHT IM KATALOG STEHT (api/_internal/media-license.php): der Katalog traegt bewusst
 * KEINE Aliase. Wuerde er 'own' kennen, muesste jeder kuenftige Leser mitraten, ob ein Wert eine
 * Kennung oder ein historischer Rest ist -- und ein Alias, den niemand mehr braucht, faellt nie wieder
 * heraus. Das Wissen ueber die fuenf alten Vokabulare lebt deshalb hier, in der Datei, die es benutzt.
 *
 * 💣 UND SIE IST NICHT GLOBAL. Derselbe String heisst je nach Flaeche etwas anderes: 'own' bedeutet
 * bei den Siedlungs-Wappen "von einem Editor hochgeladen" -- fest verdrahtet in
 * settlement-coat-upload.php:98 --, und diese Wappen haben die Editoren nach und nach mit KI erzeugt
 * (Owner 16.08.2026), weshalb er zu 'ai_generated' wird und nicht zu 'own_work'. Eine Tabelle ohne
 * Flaeche haette diesen Unterschied verschluckt.
 *
 * ⚠️ Keine DB, kein Bootstrap, keine Seiteneffekte -- damit der Abnahmefall
 * (api/_internal/__tests__/media-license-migration-test.php) ohne Fixture beweisbar ist.
 */

require_once __DIR__ . '/media-license.php';

/**
 * Die fuenf Flaechen. Sie sind Bezeichner dieses Umbaus, keine Datenbankwerte -- nichts speichert sie.
 */
const AVESMAPS_MEDIA_LICENSE_SURFACES = [
    'settlement_coat',
    'territory_coat',
    'settlement_image',
    'citymap',
    'cover',
];

/**
 * Die Aliase je Flaeche. Was hier nicht steht, geht durch die normale Normalisierung.
 *
 * 🔴 territory_coat: 'attribution_required' faellt auf 'cc_by', und mit ihm CC-BY-SA, CC-BY-NC/ND,
 * generisches "Creative Commons" und GFDL -- der Wiki-Parser wirft sie alle in denselben Status
 * (sync-monitor-licenses.php:154-172). Folgenlos: sie sind saemtlich "nicht angezeigt", und die genaue
 * Bezeichnung bleibt im Klartextfeld coat_of_arms_license stehen. Es geht also keine Information
 * verloren, nur eine Unterscheidung, die der Katalog bewusst nicht anbietet.
 */
const AVESMAPS_MEDIA_LICENSE_LEGACY_ALIASES = [
    'settlement_coat' => [
        'own' => 'ai_generated',
    ],
    'territory_coat' => [
        'attribution_required' => 'cc_by',
        'unknown' => 'unknown_other',
    ],
    'settlement_image' => [],
    'citymap' => [],
    'cover' => [],
];

/**
 * Die Vorgabe je Flaeche fuer einen leeren oder fehlenden Wert -- das ist NICHT dieselbe Frage wie der
 * Alias. Ein leeres Feld heisst je Flaeche etwas anderes:
 *
 *   settlement_image  ai_generated       Legacy-Eintraege waren blanke URL-Strings und zaehlten seit je
 *                                        als ai_generated (api/app/map-features.php:408).
 *   cover             permission_granted Die Cover hatten ueberhaupt kein Feld und zeigen Ulisses-
 *                                        Produktcover: Genehmigung unter den Fan-Regeln (NOTICE.md),
 *                                        derselbe Wert, den die Karten-Vorschauen aus dem Wiki tragen
 *                                        (citymaps.php:2228). Owner-Entscheid 16.08.2026.
 *   citymap           unknown_other      Die Karten hatten diese Vorgabe schon, und zwar bewusst als
 *                                        NICHT-freien Wert (citymaps.php:49-51).
 *   die Wappen        unknown_other      Kein coat-Objekt heisst: es gibt gar kein Bild.
 */
const AVESMAPS_MEDIA_LICENSE_LEGACY_EMPTY_DEFAULT = [
    'settlement_coat' => 'unknown_other',
    'territory_coat' => 'unknown_other',
    'settlement_image' => 'ai_generated',
    'citymap' => 'unknown_other',
    'cover' => 'permission_granted',
];

/**
 * Ein Altwert einer Flaeche -> seine Katalog-Kennung.
 *
 * 🔴 IDEMPOTENT: ein Wert, der bereits eine Kennung ist, kommt unveraendert zurueck. Der Lauf ist
 * resumierbar und darf abbrechen; ein zweiter Durchgang ueber schon zugeordnete Zeilen muss folgenlos
 * sein, sonst waere jeder Wiederanlauf ein Datenrisiko.
 *
 * 💣 Eine unbekannte FLAECHE faellt auf 'unknown_other', nie auf etwas Oeffentliches: sonst machte ein
 * Tippfehler im Flaechennamen stillschweigend Bilder sichtbar. Ein bereits gueltiger Katalogwert
 * kommt aber auch dann durch -- er braucht die Flaeche nicht.
 */
function avesmapsMediaLicenseMigrateLegacy(string $surface, mixed $legacy): string
{
    $wert = is_string($legacy) ? trim($legacy) : '';

    // Schon eine Kennung? Dann ist nichts zu tun -- unabhaengig von der Flaeche (Idempotenz).
    if (in_array($wert, AVESMAPS_MEDIA_LICENSES, true)) {
        return $wert;
    }

    $vorgabe = AVESMAPS_MEDIA_LICENSE_LEGACY_EMPTY_DEFAULT[$surface] ?? 'unknown_other';
    if ($wert === '') {
        return $vorgabe;
    }

    $aliase = AVESMAPS_MEDIA_LICENSE_LEGACY_ALIASES[$surface] ?? [];
    if (array_key_exists($wert, $aliase)) {
        return $aliase[$wert];
    }

    // Ein unbekannter Nicht-Leerwert ist keine Vorgabefrage: er ist ungeklaert und damit still.
    return 'unknown_other';
}

/**
 * War ein Bild mit diesem Altwert VOR Phase 2 im Frontend sichtbar?
 *
 * 🔴 Das ist der halbe Abnahmefall und bildet die Gates ab, wie sie am 16.08.2026 tatsaechlich
 * standen -- nicht, wie sie sein sollten:
 *
 *   settlement_coat   KEIN GATE. properties.coat ging ungefiltert an die Karte
 *                     (api/app/map-features.php:464 kennt nur den An/Aus-Schalter), also war JEDER
 *                     gesetzte Wert sichtbar. Das Gate kommt erst in Phase 3.
 *   territory_coat    Nur 'public_domain' (AVESMAPS_COAT_PUBLIC_LICENSES, coat-url.php:45).
 *   settlement_image  Die vier Werte aus settlement-images.php:34, ohne 'unknown_other'.
 *   citymap           AVESMAPS_CITYMAP_LICENSES_FREE (citymaps.php:40) -- alles ausser 'unknown_other'.
 *   cover             KEIN FELD und kein Gate: ein vorhandenes Cover war immer sichtbar.
 *
 * ⚠️ Ein leerer Wert heisst bei den Wappen "es gibt gar kein Bild" -- unsichtbar, weil nichts da ist.
 * Bei den Covern heisst er das NICHT (dort gab es nie ein Feld); der Aufrufer fragt nur fuer Cover,
 * die eine cover_url tragen.
 */
function avesmapsMediaLicenseLegacyWasPublic(string $surface, mixed $legacy): bool
{
    $wert = is_string($legacy) ? trim($legacy) : '';

    return match ($surface) {
        'settlement_coat' => $wert !== '',
        'territory_coat' => $wert === 'public_domain',
        'settlement_image' => in_array(
            $wert !== '' ? $wert : 'ai_generated',
            ['public_domain', 'cc0', 'ai_generated'],
            true
        ),
        'citymap' => in_array(
            $wert,
            ['public_domain', 'cc0', 'ai_generated', 'permission_granted', 'own_work'],
            true
        ),
        'cover' => true,
        default => false,
    };
}
```

- [ ] **Schritt 4: Test laufen lassen und grün sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/media-license-migration-test.php
```

Erwartet: `media-license-migration-test: OK (18 Bestandsfaelle, keiner wechselt die Sichtbarkeit)`.

- [ ] **Schritt 5: Belegen, dass die Vorher-Zustände stimmen**

Der Abnahmefall ist nur so viel wert wie seine Vorher-Spalte. Die drei Gates gegen den echten Code
prüfen und das Ergebnis in den Bericht schreiben:

```bash
grep -n "AVESMAPS_COAT_PUBLIC_LICENSES = " api/_internal/coat-url.php
grep -n "AVESMAPS_CITYMAP_LICENSES_FREE = " api/_internal/app/citymaps.php
grep -n -A 3 "settlementCoatsEnabled)" api/app/map-features.php
```

Erwartet: `['public_domain']` · die fünf freien Karten-Werte · der Siedlungs-Wappen-Block, der nur
`unset($properties['coat'])` beim Kill-Switch tut und **keine Lizenz prüft**.

- [ ] **Schritt 6: Committen**

```bash
git add api/_internal/media-license-migration.php api/_internal/__tests__/media-license-migration-test.php
git commit -m "feat(lizenzen): die Zuordnung der Bestandswerte -- und der Beweis, dass nichts verschwindet"
```

---

## Aufgabe 2: Die neuen Spalten

**Dateien:**
- Ändern: `api/_internal/app/game-literature.php` (bei der bestehenden Spalten-Nachrüstung, Zeile ~107)
- Ändern: `api/_internal/app/citymaps.php` (bei der bestehenden `$columnExists`-Kette, Zeile ~267 ff.)

**Schnittstellen:**
- Liefert an Aufgabe 4: die Spalten `adventure.cover_license`, `.cover_author`, `.cover_note`,
  `.cover_uploaded_by`, `.cover_uploaded_at` sowie `citymap.map_license_author`,
  `.map_uploaded_by`, `.map_uploaded_at`, `.thumb_license_author`, `.thumb_uploaded_by`,
  `.thumb_uploaded_at`.

- [ ] **Schritt 1: Die Cover-Spalten nachrüsten**

In `api/_internal/app/game-literature.php` die bestehende `foreach`-Zeile erweitern. **Vorher lesen** —
die Liste steht dort schon und darf nicht ersetzt, nur ergänzt werden:

```bash
grep -n "link_ulisses' => 'VARCHAR(500)'" api/_internal/app/game-literature.php
```

Die fünf neuen Einträge kommen an das Ende derselben Zuordnung:

```php
'cover_license' => 'VARCHAR(24)', 'cover_author' => 'VARCHAR(190)',
'cover_note' => 'VARCHAR(2000)', 'cover_uploaded_by' => 'VARCHAR(190)',
'cover_uploaded_at' => 'DATETIME',
```

💣 **`VARCHAR(190)` für den Urheber, nicht kürzer.** Eine stille MySQL-Kürzung ist von „nie
gespeichert" nicht zu unterscheiden — die Lehre aus `app_setting.setting_value` (AGENTS §10).
⚠️ Alle fünf sind `NULL`-fähig (die Schleife hängt `NULL` an) — es gibt keinen Vorgabewert in der
DDL, den Wert setzt der Lauf aus Aufgabe 4. Ein `NOT NULL DEFAULT 'unknown_other'` wäre hier falsch:
es machte jedes Cover ohne Lauf still unsichtbar, sobald Phase 3 ein Gate baut.

- [ ] **Schritt 2: Die Karten-Spalten nachrüsten**

In `api/_internal/app/citymaps.php`, im Stil der dortigen `$columnExists`-Prüfungen, sechs Blöcke:

```php
// Urheber und Hochlade-Protokoll je Slot (Phase 2 der Lizenz-Vereinheitlichung). Der Urheber ist
// EDITORWISSEN und verlaesst die Oberflaeche nicht (Owner 16.08.2026) -- er steht neben der Lizenz,
// nicht statt ihrer, und ersetzt insbesondere nicht map_license_note.
foreach ([
    'map_license_author' => 'VARCHAR(190)',
    'map_uploaded_by' => 'VARCHAR(190)',
    'map_uploaded_at' => 'DATETIME',
    'thumb_license_author' => 'VARCHAR(190)',
    'thumb_uploaded_by' => 'VARCHAR(190)',
    'thumb_uploaded_at' => 'DATETIME',
] as $spalte => $typ) {
    if (!$columnExists($spalte)) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN ' . $spalte . ' ' . $typ . ' NULL');
    }
}
```

⚠️ **`$columnExists` prüfen, bevor du es benutzt** — es ist in dieser Datei eine lokale Closure mit
einem Argument. Nachsehen:

```bash
grep -n "columnExists = " api/_internal/app/citymaps.php
```

- [ ] **Schritt 3: 💣 Die Rückfälle in den Lesepfaden**

**Das ist der Schritt, an dem diese Aufgabe stillschweigend scheitern kann.** Die DDL läuft im Haus
per self-healing — aber nur, wenn jemand die Schema-Funktion aufruft. Ein Lesepfad, der eine noch
nicht angelegte Spalte selektiert, fällt in sein `try/catch` und liefert eine **leere Liste**: ein
stiller Live-Ausfall, der wie „keine Daten" aussieht.

Jeden neuen `SELECT`, der eine dieser Spalten nennt, mit `'' AS spalte` absichern — oder die Spalte
gar nicht erst in den öffentlichen Lesepfad aufnehmen. ⚠️ Für diese Phase gilt: **keiner der neuen
Werte wird gelesen.** Die Spalten werden nur geschrieben (Aufgabe 4) und in Phase 4 im Editor
angezeigt. Belege das:

```bash
grep -rn "cover_license\|cover_uploaded\|license_author\|_uploaded_by\|_uploaded_at" api/ js/ --include=*.php --include=*.js | grep -v "__tests__" | grep -v "media-license-migration"
```

Erwartet: nur die zwei DDL-Stellen aus Schritt 1 und 2. Findet der Befehl einen `SELECT`, gehört dort
ein Rückfall hin, bevor du weitergehst.

- [ ] **Schritt 4: Testfeld und Commit**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" >/dev/null || echo "ROT: $t"; done
```

Erwartet: nur `api/_internal/linkcheck/__tests__/link-url-test.php` (vorbestehend, echter DNS-Abruf).

```bash
git add api/_internal/app/game-literature.php api/_internal/app/citymaps.php
git commit -m "feat(lizenzen): Spalten fuer Urheber und Hochlade-Protokoll bei Covern und Karten"
```

---

## Aufgabe 3: Der Wiki-Lizenzparser schreibt `cc_by`

Ohne diesen Schritt holt der nächste Wiki-Abgleich `attribution_required` zurück in den frisch
migrierten Bestand.

**Dateien:**
- Ändern: `api/_internal/wiki/sync-monitor-licenses.php` (`avesmapsWikiSyncMonitorParseLicense`)
- Ändern: `api/_internal/wiki/__tests__/coat-license-parsing-test.php`

- [ ] **Schritt 1: Den Bestand sichten**

```bash
grep -n "attribution_required" api/_internal/wiki/sync-monitor-licenses.php
grep -rn "attribution_required" api/ js/ tools/ --include=*.php --include=*.js
```

Der erste Befehl zeigt die Schreibstellen im Parser (fünf Zweige: CC-BY, CC-BY-SA, CC-BY-NC/ND,
generisches „Creative Commons", GFDL). Der zweite zeigt **alle** Leser — jeder davon muss danach
`cc_by` verstehen. ⚠️ `avesmapsWikiSyncMonitorUploadCoat:318` ist einer: seine Erlaubnisliste
`['public_domain', 'attribution_required']` wird in Phase 4 durch den Katalog ersetzt; **für diese
Aufgabe wird sie nur um `'cc_by'` ergänzt**, damit der Upload zwischen den Phasen nicht bricht.

- [ ] **Schritt 2: Den Test zuerst umstellen**

In `api/_internal/wiki/__tests__/coat-license-parsing-test.php` jede Erwartung
`'attribution_required'` auf `'cc_by'` ändern. Test laufen lassen — er muss **rot** werden:

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/coat-license-parsing-test.php
```

- [ ] **Schritt 3: Den Parser umstellen**

Jedes `$status = 'attribution_required';` wird `$status = 'cc_by';`. Der begründende Kommentar
darüber kommt mit — er nennt heute den alten Wert:

```php
// 🔴 Fuenf Lizenzformen, EIN Status: CC-BY, CC-BY-SA, CC-BY-NC/ND, generisches "Creative Commons"
// und GFDL fallen saemtlich auf 'cc_by'. Das ist kein Genauigkeitsverlust, den man beheben sollte:
// alle fuenf sind "wird gespeichert, aber nicht gezeigt" (Entwurf §2), und die genaue Bezeichnung
// bleibt im Klartextfeld coat_of_arms_license stehen. Bis 16.08.2026 hiess der Status
// 'attribution_required'; er wurde in Phase 2 auf die Katalog-Kennung umgestellt.
```

Ebenso die Zeile in `avesmapsWikiSyncMonitorUploadCoat`:

```php
if (!in_array($license, ['public_domain', 'attribution_required', 'cc_by'], true)) {
```

⚠️ **`attribution_required` bleibt dort vorerst stehen.** Ein Editor, dessen Browser die alte
Editorseite gecacht hat, sendet noch den alten Wert; ihn abzulehnen wäre ein Fehler, den niemand
versteht. Die Liste wird in Phase 4 durch den Katalog ersetzt.

- [ ] **Schritt 4: Grün und committen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/coat-license-parsing-test.php
git add api/_internal/wiki/sync-monitor-licenses.php api/_internal/wiki/__tests__/coat-license-parsing-test.php
git commit -m "feat(lizenzen): der Wiki-Parser schreibt cc_by -- sonst holt der naechste Abgleich den Altwert zurueck"
```

---

## Aufgabe 4: Der Migrationslauf mit Vorschau

**Dateien:**
- Neu: `api/_internal/media-license-migration-run.php`
- Test: `api/_internal/__tests__/media-license-migration-run-test.php`
- Neu: `api/edit/admin/media-license-migration.php`

**Schnittstellen:**
- Verbraucht aus Aufgabe 1: `avesmapsMediaLicenseMigrateLegacy()`,
  `avesmapsMediaLicenseLegacyWasPublic()`.
- Liefert: `avesmapsMediaLicenseMigrationRun(PDO $pdo, array $options = []): array` mit
  `['ok' => bool, 'dry_run' => bool, 'surfaces' => array<string, array{gelesen:int, geaendert:int,
  beispiele:list<array>}>, 'sichtbarkeitswechsel' => list<array>]`

- [ ] **Schritt 1: Die vier Fundstellen des Bestands aufnehmen**

Bevor du Code schreibst: nachsehen, wo die Altwerte wirklich liegen. Schreib die Ausgabe in den
Bericht.

```bash
grep -n "license_status" api/edit/wiki/settlement-coat-upload.php api/_internal/wiki/settlements.php | head
grep -n "coat_of_arms_license_status" api/_internal/wiki/sync-monitor-identity.php | head -4
grep -n "cover_url\|field_origins_json" api/_internal/app/game-literature.php | head -6
```

Es sind vier Orte, und der dritte ist der, den man übersieht:

1. **Siedlungs-Wappen:** `map_features.properties_json` → `coat.license_status` (JSON, kein Feld).
2. **Territoriums-Wappen, Staging:** `political_territory_wiki_test.coat_of_arms_license_status`.
3. 💣 **Territoriums-Wappen, Override:** `wiki_territory_model.metadata_overrides_json` →
   `coat_of_arms_license_status`. **Der Override schlägt das Staging** (`coat-url.php:63`) — wer nur
   die Spalte migriert, lässt den wirksamen Wert stehen und die Migration wirkt bei genau den
   Gebieten nicht, die jemand von Hand angefasst hat.
4. **Cover:** `adventure.cover_license` (neu, leer) — Quelle ist `cover_url` plus
   `field_origins_json.cover_url`.

⚠️ Siedlungsbilder und Stadtkarten tragen bereits Katalogwerte und werden **nicht angefasst**. Der
Lauf liest sie trotzdem und zählt sie — als Beleg, dass dort nichts zu tun ist.

- [ ] **Schritt 2: Den Test zuerst schreiben**

Datei `api/_internal/__tests__/media-license-migration-run-test.php`. Er baut eine SQLite-Fixture mit
je zwei Zeilen pro Fläche und prüft drei Dinge:

```php
<?php

declare(strict_types=1);

/**
 * Der Migrationslauf gegen eine SQLite-Fixture. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/__tests__/media-license-migration-run-test.php
 *
 * 🔴 Drei Zusicherungen, und die erste ist die wichtigste:
 *   1. Die VORSCHAU schreibt in KEINE Tabelle. Ein Lauf, der beim Hinsehen schon aendert, ist keine
 *      Vorschau -- und der Editor haette keine Gelegenheit, den Abbruch zu waehlen.
 *   2. Die Anwendung ist IDEMPOTENT. Zweiter Lauf: 0 Aenderungen.
 *   3. Der Override schlaegt das Staging -- beide werden migriert, nicht nur die Spalte.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../media-license-migration-run.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT,
    properties_json TEXT, revision INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1)');
$pdo->exec('CREATE TABLE political_territory_wiki_test (id INTEGER PRIMARY KEY, wiki_key TEXT,
    coat_of_arms_url TEXT, coat_of_arms_license_status TEXT)');
$pdo->exec('CREATE TABLE wiki_territory_model (id INTEGER PRIMARY KEY, wiki_key TEXT,
    metadata_overrides_json TEXT)');
$pdo->exec('CREATE TABLE adventure (id INTEGER PRIMARY KEY, public_id TEXT, cover_url TEXT,
    field_origins_json TEXT, cover_license TEXT, cover_author TEXT, cover_note TEXT,
    cover_uploaded_by TEXT, cover_uploaded_at TEXT)');
// ⚠️ Die citymap-Tabelle gehoert in die Fixture, obwohl an ihr nichts zu aendern ist: ihr Sammler
// laeuft trotzdem, und ohne Tabelle braeuchte er ein try/catch -- das waere genau der inerte
// Fehlerschlucker, an dem "Was ist hier?" einen ok:true mit leerem Inhalt geliefert hat (AGENTS §11).
$pdo->exec('CREATE TABLE citymap (id INTEGER PRIMARY KEY, public_id TEXT,
    map_license TEXT, thumb_license TEXT)');
$pdo->exec("INSERT INTO citymap (public_id, map_license, thumb_license)
    VALUES ('karte-1', 'public_domain', 'unknown_other')");

// Ein KI-Wappen eines Editors (sichtbar, weil ungegated) und ein Wiki-Wappen.
$pdo->exec("INSERT INTO map_features (public_id, feature_type, properties_json) VALUES
    ('ort-1', 'location', '" . json_encode(['coat' => ['url' => '/uploads/wappen/own/a.png', 'source' => 'own', 'license_status' => 'own']]) . "'),
    ('ort-2', 'location', '" . json_encode(['coat' => ['url' => '/x.png', 'source' => 'wiki', 'license_status' => 'public_domain']]) . "')");
// Ein gemeinfreies Gebiet, ein namensnennungspflichtiges.
$pdo->exec("INSERT INTO political_territory_wiki_test (wiki_key, coat_of_arms_url, coat_of_arms_license_status) VALUES
    ('wiki:a', '/a.png', 'public_domain'), ('wiki:b', '/b.png', 'attribution_required')");
// 💣 Ein Gebiet, dessen wirksame Lizenz im OVERRIDE steht -- die Staging-Spalte sagt etwas anderes.
$pdo->exec("INSERT INTO wiki_territory_model (wiki_key, metadata_overrides_json) VALUES
    ('wiki:a', '" . json_encode(['coat_of_arms_license_status' => 'attribution_required']) . "')");
// Ein Wiki-Cover und ein von Hand hochgeladenes.
$pdo->exec("INSERT INTO adventure (public_id, cover_url, field_origins_json) VALUES
    ('abt-1', '/uploads/questcovers/x.jpg', '" . json_encode(['cover_url' => 'wiki']) . "'),
    ('abt-2', '/uploads/questcovers/own/y.jpg', '" . json_encode(['cover_url' => 'manual']) . "')");

// ---- 1. die Vorschau schreibt nichts ---------------------------------------------------------------
// Eine Zuordnung Tabelle -> beobachtete Spalte, EINMAL definiert und zweimal benutzt: vorher lesen,
// nachher lesen, vergleichen. (Ein zweites, von Hand nachgezogenes Mapping waere genau die Sorte
// Doppelung, die spaeter auseinanderlaeuft.)
$beobachtet = [
    'map_features' => 'properties_json',
    'political_territory_wiki_test' => 'coat_of_arms_license_status',
    'wiki_territory_model' => 'metadata_overrides_json',
    'adventure' => 'cover_license',
];
$abzug = static function (PDO $pdo, array $beobachtet): array {
    $stand = [];
    foreach ($beobachtet as $tabelle => $spalte) {
        $stand[$tabelle] = (string) $pdo
            ->query("SELECT group_concat(COALESCE({$spalte}, 'NULL')) FROM {$tabelle}")
            ->fetchColumn();
    }
    return $stand;
};

$vorher = $abzug($pdo, $beobachtet);
$vorschau = avesmapsMediaLicenseMigrationRun($pdo, ['dry_run' => true]);
assert($vorschau['ok'] === true);
assert($vorschau['dry_run'] === true);
assert($abzug($pdo, $beobachtet) === $vorher, 'DIE VORSCHAU HAT GESCHRIEBEN');
assert($vorschau['sichtbarkeitswechsel'] === [], 'Vorschau meldet einen Sichtbarkeitswechsel');
// Die Vorschau muss die Arbeit trotzdem GEZAEHLT haben -- sonst waere "nichts geschrieben" auch dann
// wahr, wenn sie schlicht nichts gefunden hat.
// Fuenf: ort-1 ('own') · Staging wiki:b · Override wiki:a · abt-1 · abt-2. NICHT ort-2, wiki:a-Staging,
// karte-1 -- die tragen bereits Kennungen.
$angekuendigt = 0;
foreach ($vorschau['surfaces'] as $s) { $angekuendigt += (int) $s['geaendert']; }
assert($angekuendigt === 5, "Vorschau kuendigt {$angekuendigt} statt 5 Aenderungen an");
assert($vorschau['surfaces']['citymap']['geaendert'] === 0, 'an den Karten ist nichts zu tun');
assert($vorschau['surfaces']['citymap']['gelesen'] > 0, 'der Karten-Sammler hat gar nicht gelesen');

// ---- 2. die Anwendung ordnet zu --------------------------------------------------------------------
$lauf = avesmapsMediaLicenseMigrationRun($pdo, ['dry_run' => false]);
assert($lauf['ok'] === true && $lauf['dry_run'] === false);

$ort1 = json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id='ort-1'")->fetchColumn(), true);
assert($ort1['coat']['license_status'] === 'ai_generated');
assert(($ort1['coat']['source'] ?? '') === 'own', 'source darf die Migration nicht anfassen');

assert($pdo->query("SELECT coat_of_arms_license_status FROM political_territory_wiki_test WHERE wiki_key='wiki:b'")->fetchColumn() === 'cc_by');

// 💣 der Override, nicht nur die Spalte
$ov = json_decode((string) $pdo->query("SELECT metadata_overrides_json FROM wiki_territory_model WHERE wiki_key='wiki:a'")->fetchColumn(), true);
assert($ov['coat_of_arms_license_status'] === 'cc_by', 'der Override wurde nicht migriert');

assert($pdo->query("SELECT cover_license FROM adventure WHERE public_id='abt-1'")->fetchColumn() === 'permission_granted');
assert($pdo->query("SELECT cover_author FROM adventure WHERE public_id='abt-1'")->fetchColumn() === 'Ulisses');
// ⚠️ Ein von Hand hochgeladenes Cover bekommt KEINEN erfundenen Urheber.
assert($pdo->query("SELECT cover_license FROM adventure WHERE public_id='abt-2'")->fetchColumn() === 'permission_granted');
assert(($pdo->query("SELECT cover_author FROM adventure WHERE public_id='abt-2'")->fetchColumn() ?: '') === '');

// ---- 3. idempotent ----------------------------------------------------------------------------------
$zweiter = avesmapsMediaLicenseMigrationRun($pdo, ['dry_run' => false]);
$summe = 0;
foreach ($zweiter['surfaces'] as $s) { $summe += (int) $s['geaendert']; }
assert($summe === 0, "zweiter Lauf hat {$summe} Zeilen geaendert -- nicht idempotent");

echo "media-license-migration-run-test: OK\n";
```

- [ ] **Schritt 3: Den Lauf schreiben**

Datei `api/_internal/media-license-migration-run.php`. Der Rahmen und die erste Fläche vollständig;
die anderen drei folgen derselben Form (ihre Fundstellen stehen darunter, jede mit ihrer Eigenheit).

💣 **Zwei Durchgänge, nicht einer.** Erst wird ALLES gesammelt und geprüft, dann erst geschrieben.
Ein Lauf, der Zeile für Zeile prüft und schreibt, hätte bei der zwanzigsten Zeile schon neunzehn
geschrieben — und die Sperre unten käme zu spät.

```php
<?php

declare(strict_types=1);

/**
 * Der Migrationslauf der Phase 2: bringt die Bestandswerte der vier betroffenen Fundstellen auf den
 * Katalog. Erst zeigen, dann schreiben.
 *
 * 🔴 DIE SPERRE IST DER ZWECK DIESER DATEI. Findet der Lauf auch nur EINE Zeile, deren Sichtbarkeit
 * sich durch die Zuordnung aendern wuerde, schreibt er GAR NICHTS -- auch nicht die unauffaelligen
 * Zeilen. Ein Bestandswert, den avesmapsMediaLicenseMigrateLegacy() nicht kennt, ist genau der Fall,
 * fuer den sie da ist: er faellt auf unknown_other, und ein bis dahin sichtbares Bild verschwaende
 * still. Ein halb gelaufener Umbau ist schlimmer als ein nicht gelaufener.
 */

require_once __DIR__ . '/media-license-migration.php';
require_once __DIR__ . '/wiki/sync.php'; // avesmapsWikiSyncNextMapRevision, avesmapsWikiSyncEncodeJson

/**
 * @param array{dry_run?: bool, batch_limit?: int} $options
 * @return array{ok: bool, dry_run: bool, surfaces: array<string, array{gelesen: int, geaendert: int,
 *         beispiele: list<array<string, string>>}>, sichtbarkeitswechsel: list<array<string, string>>}
 */
function avesmapsMediaLicenseMigrationRun(PDO $pdo, array $options = []): array
{
    $dryRun = ($options['dry_run'] ?? true) !== false;   // ⚠️ Vorgabe ist die VORSCHAU
    $limit = max(1, min(2000, (int) ($options['batch_limit'] ?? 200)));
    @set_time_limit(60);

    $bericht = [];
    $wechsel = [];
    $vorgemerkt = [];   // je Flaeche die Aenderungen, die den zweiten Durchgang ueberlebt haben
    // Jeder Sammler liefert: ['flaeche' => …, 'aenderungen' => list<['id','alt','neu','schreiben'=>callable]>]
    foreach ([
        'settlement_coat' => 'avesmapsMediaLicenseCollectSettlementCoats',
        'territory_coat' => 'avesmapsMediaLicenseCollectTerritoryCoats',
        'cover' => 'avesmapsMediaLicenseCollectCovers',
        'settlement_image' => 'avesmapsMediaLicenseCollectSettlementImages',
        'citymap' => 'avesmapsMediaLicenseCollectCitymaps',
    ] as $flaeche => $sammler) {
        $funde = $sammler($pdo, $limit);
        $geaendert = [];
        foreach ($funde as $fund) {
            $neu = avesmapsMediaLicenseMigrateLegacy($flaeche, $fund['alt']);
            if ($neu === $fund['alt']) {
                continue; // schon zugeordnet -- Idempotenz
            }
            // 🔴 DIE SPERRE. Beide Modi, immer, vor jedem Schreibvorgang.
            if (avesmapsMediaLicenseLegacyWasPublic($flaeche, $fund['alt']) !== avesmapsMediaLicenseIsPublic($neu)) {
                $wechsel[] = ['flaeche' => $flaeche, 'id' => (string) $fund['id'],
                              'alt' => (string) $fund['alt'], 'neu' => $neu];
                continue;
            }
            $geaendert[] = $fund + ['neu' => $neu];
        }
        $bericht[$flaeche] = [
            'gelesen' => count($funde),
            'geaendert' => count($geaendert),
            'beispiele' => array_map(
                static fn(array $f): array => ['id' => (string) $f['id'], 'alt' => (string) $f['alt'], 'neu' => $f['neu']],
                array_slice($geaendert, 0, 5)
            ),
        ];
        $vorgemerkt[$flaeche] = $geaendert;
    }

    // 🔴 Ein einziger Wechsel haelt den GANZEN Lauf an -- nicht nur seine Flaeche.
    if ($wechsel !== [] || $dryRun) {
        return ['ok' => true, 'dry_run' => true, 'surfaces' => $bericht, 'sichtbarkeitswechsel' => $wechsel];
    }

    foreach ($vorgemerkt as $flaeche => $geaendert) {
        foreach ($geaendert as $fund) {
            ($fund['schreiben'])($pdo, $fund['neu']);
        }
    }
    // ⚠️ Ohne neue Revision haelt ein Client seinen gecachten Payload fuer aktuell (ETag in
    // api/app/map-features.php sitzt auf map_revision).
    if (($bericht['settlement_coat']['geaendert'] ?? 0) > 0 || ($bericht['settlement_image']['geaendert'] ?? 0) > 0) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }

    return ['ok' => true, 'dry_run' => false, 'surfaces' => $bericht, 'sichtbarkeitswechsel' => []];
}

/**
 * Siedlungs-Wappen: properties_json -> coat.license_status. Kein Feld, sondern JSON -- deshalb lesen,
 * dekodieren, im Speicher aendern, zurueckschreiben.
 *
 * ⚠️ NUR license_status wird angefasst. `source` ('own'/'wiki') bleibt, wie er ist: er sagt, WOHER das
 * Bild kam, nicht unter welcher Lizenz -- und avesmapsWikiSettlementSyncCoats:408 entscheidet an ihm,
 * ob ein Wiki-Abgleich ein eigenes Wappen ueberschreiben darf.
 *
 * @return list<array{id: int, alt: string, schreiben: callable}>
 */
function avesmapsMediaLicenseCollectSettlementCoats(PDO $pdo, int $limit): array
{
    $zeilen = $pdo->query(
        "SELECT id, properties_json FROM map_features
         WHERE is_active = 1 AND properties_json LIKE '%\"coat\"%' LIMIT " . $limit
    );
    $funde = [];
    foreach (($zeilen ? $zeilen->fetchAll(PDO::FETCH_ASSOC) : []) as $zeile) {
        $props = json_decode((string) ($zeile['properties_json'] ?? ''), true);
        if (!is_array($props) || !is_array($props['coat'] ?? null)) {
            continue;
        }
        $id = (int) $zeile['id'];
        $funde[] = [
            'id' => $id,
            'alt' => (string) ($props['coat']['license_status'] ?? ''),
            'schreiben' => static function (PDO $pdo, string $neu) use ($id, $props): void {
                $props['coat']['license_status'] = $neu;
                $pdo->prepare('UPDATE map_features SET properties_json = :pj WHERE id = :id')
                    ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'id' => $id]);
            },
        ];
    }

    return $funde;
}
```

Die vier übrigen Sammler folgen exakt dieser Form. Ihre Fundstellen und je eine Eigenheit:

| Sammler | Quelle | Eigenheit |
|---|---|---|
| `…CollectTerritoryCoats` | `political_territory_wiki_test.coat_of_arms_license_status` **und** `wiki_territory_model.metadata_overrides_json` → `coat_of_arms_license_status` | 💣 **Zwei Fundstellen, eine Fläche.** Der Override schlägt das Staging (`coat-url.php:63`) — wer nur die Spalte migriert, lässt den wirksamen Wert stehen. Beide liefern eigene Einträge; die `id` trägt zur Unterscheidung ein Präfix (`staging:<wiki_key>` / `override:<wiki_key>`). |
| `…CollectCovers` | `adventure` mit `cover_url <> ''`; `field_origins_json.cover_url` unterscheidet `wiki` von `manual` | ⚠️ Der Urheber „Ulisses" wird **nur** bei `wiki` gesetzt. Ein von Hand hochgeladenes Cover bekommt `permission_granted` ohne Urheber — ein erfundener wäre später von einem echten nicht zu unterscheiden. `alt` ist hier immer `''` (die Spalte ist neu). |
| `…CollectSettlementImages` | `map_features.properties_json` → `images[].license` | ⚠️ Ändert **nichts** — die Werte sind bereits Kennungen. Der Sammler existiert, damit `gelesen` die Zahl belegt und `geaendert` beweisbar 0 ist. Legacy-Einträge sind blanke URL-**Strings** statt Objekte (`map-features.php:390`); für die ist `alt` = `''` und das Ziel `ai_generated` — also ebenfalls keine Änderung am gespeicherten Objekt. |
| `…CollectCitymaps` | `citymap.map_license`, `.thumb_license` | ⚠️ Ändert ebenfalls nichts; zwei Einträge je Zeile (ein Slot je Eintrag). |

⚠️ **Resumierbar wie die Wartungsläufe im Haus:** `batch_limit` je Aufruf (Vorgabe 200),
`@set_time_limit`, und der Rückgabewert nennt über `gelesen`, wie viel der Durchgang gesehen hat.
Muster: `avesmapsWikiSyncMonitorEnrichLicenses` in `api/_internal/wiki/sync-monitor-licenses.php:196`.

⚠️ **Vor dem Bauen prüfen, wie die zwei geerbten Funktionen wirklich heißen** — der Rahmen oben ruft
sie:

```bash
grep -rn "function avesmapsWikiSyncNextMapRevision\|function avesmapsWikiSyncEncodeJson" api/_internal/
```

- [ ] **Schritt 4: Test grün**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/__tests__/media-license-migration-run-test.php
```

- [ ] **Schritt 5: Der Endpunkt**

`api/edit/admin/media-license-migration.php`, im Stil von `api/edit/admin/database-backup.php`
(vorher lesen). 🔴 **`dry_run` ist die Vorgabe** — der Lauf schreibt nur, wenn der Aufrufer
ausdrücklich `dry_run: false` sendet. Fähigkeit: `admin`. Antwortumschlag nach `api/README.md`
(`{"ok": true, ...}` bzw. `{"ok": false, "error": {"code", "message"}}`).

- [ ] **Schritt 6: Committen**

```bash
git add api/_internal/media-license-migration-run.php api/_internal/__tests__/media-license-migration-run-test.php api/edit/admin/media-license-migration.php
git commit -m "feat(lizenzen): der Migrationslauf -- erst zeigen, dann schreiben, und niemals bei Sichtbarkeitswechsel"
```

---

## Aufgabe 5: Das Hochlade-Protokoll

⚠️ **Diese Aufgabe ist abtrennbar.** Blockiert nichts, und ob sich der `uploaded_by`-Abgleich lohnt,
entscheidet die gemessene Trefferquote im Vorschaulauf (Entwurf §10, offener Punkt). Fällt sie sehr
niedrig aus, ist der Teilschritt zu verwerfen — das Datum allein bleibt trotzdem nützlich.

**Dateien:**
- Ändern: `api/_internal/media-license-migration-run.php`
- Ändern: `api/_internal/__tests__/media-license-migration-run-test.php`

- [ ] **Schritt 1: Das Datum aus der Datei**

Für jede der vier Ablagen `filemtime` über die im Datensatz stehende URL:
`/uploads/wappen/own/`, `/uploads/siedlungen/`, `/uploads/kartensammlungen/`, `/uploads/questcovers/`.

💣 **Der Lauf muss auf dem SERVER laufen** — diese Verzeichnisse liegen nicht im Repo (`ls uploads/`
zeigt nur Dumps und Backups). Lokal findet er nichts und meldet das korrekt als „0 Datumsangaben",
nicht als Fehler.
💣 **Kein `filemtime` auf einen ungeprüften Pfad.** Die URL kommt aus der Datenbank und ist an
mehreren Stellen editierbar; ohne Prüfung auf das erwartete Präfix und gegen `..` ist das ein
Pfadausbruch. `api/edit/map/game-literature-cover.php:142-146` macht es vor.

- [ ] **Schritt 2: Der Name aus dem Protokoll**

Nur für die Siedlungs-Wappen — die anderen drei Flächen haben keine vergleichbare Spur.
`map_audit_log` trägt `feature_id`, `action`, `actor_user_id`, `before_json`, `after_json`,
`created_at`. Gesucht: `action = 'wiki_sync_update_point'`, deren `after_json` ein
`properties_json.coat.source === 'own'` trägt, das im `before_json` fehlt oder eine andere URL hat.

💣 **Die beiden JSON-Seiten haben nicht dieselbe Form.** `before_json` ist die rohe Zeile — dort ist
`properties_json` ein **String**. `after_json` wird gebaut — dort ist es ein **Array**
(`api/_internal/wiki/locations-helpers.php:187-201`). Wer beide gleich behandelt, findet auf einer
Seite immer nichts und hält die Trefferquote für schlecht.

⚠️ **Der Treffer ist nicht garantiert:** die Aktion ist generisch, das Protokoll kann beschnitten
sein. Wo nichts gefunden wird, bleibt das Feld **leer** — kein Platzhaltername, keine Annahme. Ein
erfundener Eintrag wäre später von einem echten nicht zu unterscheiden und machte das Protokoll als
Nachweis wertlos.

- [ ] **Schritt 3: Die Trefferquote melden**

Der Rückgabewert nennt je Fläche `datum_gefunden`, `name_gefunden`, `gesamt`. Die Vorschau zeigt sie,
bevor irgendetwas geschrieben wird — das ist die Zahl, an der die Lohnt-sich-Frage entschieden wird.

- [ ] **Schritt 4: Test erweitern und committen**

Die Fixture um eine `map_audit_log`-Tabelle mit je einer passenden und einer nicht passenden Zeile
erweitern; prüfen, dass der Name nur bei der passenden gesetzt wird und sonst leer bleibt.

```bash
git add api/_internal/media-license-migration-run.php api/_internal/__tests__/media-license-migration-run-test.php
git commit -m "feat(lizenzen): Hochlade-Protokoll -- Datum aus der Datei, Name nur wo er belegbar ist"
```

---

## Aufgabe 6: Abschluss

- [ ] **Schritt 1: Der eigene Entwurf als Abhakliste**

Jede 💣/⚠️/🔴-Zeile aus Entwurf §6 und aus den globalen Vorgaben dieses Plans einzeln abhaken —
erfüllt, oder ausdrücklich verworfen mit Begründung (AGENTS §9):

- [ ] kein Bild wechselt seine Sichtbarkeit (Test **und** Laufzeitsperre)
- [ ] `'own'` → `ai_generated`, nicht `own_work`
- [ ] `attribution_required` → `cc_by`, `unknown` → `unknown_other`
- [ ] Cover → `permission_granted`; Urheber „Ulisses" nur bei Wiki-Herkunft
- [ ] der Override wird migriert, nicht nur die Staging-Spalte
- [ ] der Wiki-Parser schreibt `cc_by`
- [ ] `VARCHAR(190)` für den Urheber; keine `NOT NULL DEFAULT`-Spalte
- [ ] kein neuer Lesepfad ohne Rückfall
- [ ] kein Gate gebaut oder geändert, kein Dialog angefasst

- [ ] **Schritt 2: Das ganze Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" >/dev/null || echo "ROT: $t"; done
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
```

Erwartet: nur `api/_internal/linkcheck/__tests__/link-url-test.php`. 💣 Sind andere rote Tests dabei,
die **nicht** zu den eigenen Dateien gehören: in einem separaten Arbeitsbaum auf dem Commit-Stand
nachprüfen, bevor du sie dir zuschreibst oder ignorierst.

- [ ] **Schritt 3: Push**

```bash
git status --short
git fetch origin && git rebase origin/master && git push origin master && git fetch origin --quiet && git log --oneline -1 origin/master
```

⚠️ Bricht der Rebase mit „You have unstaged changes" ab, liegt fremde Arbeit im Baum: **nicht**
`--autostash`. Stattdessen separater Arbeitsbaum, `cherry-pick` der eigenen Commits, dort testen und
`git push origin HEAD:master`. ⚠️ Liegt ein fremder, noch nicht gepushter Commit zwischen
`origin/master` und den eigenen, wird er **nicht** mitgenommen — wann fremde Arbeit live geht,
entscheidet die Sitzung, der sie gehört.

- [ ] **Schritt 4: 🔧 DU (Owner): der Vorschaulauf auf dem Server**

Der Code ist damit live, **aber nichts ist migriert** — der Endpunkt schreibt nur auf ausdrückliche
Freigabe. Der Owner ruft die Vorschau auf und sieht sich an:

- die Zahlen je Fläche (wie viele Zeilen werden wie zugeordnet)
- `sichtbarkeitswechsel` — 🔴 **muss leer sein.** Ist er es nicht, wird nichts angewendet und der
  Befund gemeldet: dann trägt der Bestand einen Wert, den Aufgabe 1 nicht kennt.
- die Trefferquote des Hochlade-Protokolls (entscheidet die Lohnt-sich-Frage aus Entwurf §10)

Erst danach der Lauf mit `dry_run: false`.

- [ ] **Schritt 5: Nichts weiter tun**

🔴 Phase 2 endet hier. **Phase 3 (die Gates) darf erst beginnen, wenn der Anwendungslauf durch ist** —
vorher wäre `'own'` noch nicht `ai_generated`, und das Gate ließe die Siedlungswappen still
verschwinden (Entwurf §9).

---

## Was diese Phase ausdrücklich NICHT tut

- **Kein Gate wird gebaut oder geändert.** `AVESMAPS_COAT_PUBLIC_LICENSES` bleibt `['public_domain']`,
  die Siedlungs-Wappen bleiben ungegated (Phase 3).
- **Kein Dialog** bekommt ein Auswahlfeld, kein Urheber-Feld, keine Protokollzeile (Phase 4).
- **`NOTICE.md` und `LEGAL.md`** bleiben unangetastet (Phase 3, mit Owner-Blick auf den Wortlaut).
- **Siedlungsbilder und Stadtkarten** werden gelesen und gezählt, aber nicht geändert — sie tragen
  bereits Katalogwerte.
- **Der Anwendungslauf selbst** wird nicht von einer Sitzung ausgelöst. Er ist eine Owner-Handlung
  nach gesehener Vorschau.
