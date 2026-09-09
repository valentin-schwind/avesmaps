# Das Kanon-Etikett nach einem Quellen-Nachtrag — Reparaturplan

> **Für agentische Bearbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Die Schritte tragen
> Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Ein Objekt, dem der Editor gerade eine Quelle eingetragen hat, zeigt sein RICHTIGES
Kanon-Etikett — und kann, wenn ein künftiger Nachtragsweg das Etikett vergisst, per Konstruktion
kein falsches mehr behaupten.

**Architektur:** Zwei Riegel, getrennt abnehmbar. (A) Jede Quellen-Schreibaktion liefert das neue
Etikett je betroffener Kennung mit; der EINE Client-Nachtrag trägt es in die Kanon-Tafel ein —
setzen oder löschen, wie es der Wiki-Zuweisungsweg seit dem 02.09.2026 tut. (B) Ein nachgetragener
Schlüssel ist markiert, und für einen markierten Schlüssel OHNE ausdrücklichen Kanon-Eintrag gilt
die Vorgabe „offiziell" nicht mehr — er bekommt kein Etikett. (B) allein behebt den gemeldeten
Fehler; (A) macht die Anzeige richtig statt nur nicht falsch.

**Tech-Stack:** PHP 8 (strict types) + PDO, Vanilla-JS ohne Build, Node-Tests (`node <datei>`),
PHP-Tests (`php -d zend.assertions=1 …`).

**Spec:** `docs/superpowers/specs/2026-08-27-kanon-etikett-design.md` (der Kanon-Entwurf; dieser
Plan repariert seine Umsetzung, er ändert die Regel nicht). Die Rangfolge selbst steht in
AGENTS.md §11, Abschnitt „Das Kanon-Etikett folgt der WIKI-ZUWEISUNG".

## Der Befund, gegen den gebaut wird

Live gemessen am 09.09.2026 an der Landschaftsfläche „Schwanenbruch"
(`ecosystem:d32b9090-5b87-4037-9d45-c16fa90933b2`):

| Zustand | `renderFeatureKanonBadge` |
|---|---|
| mit Kanon-Tafeleintrag (nach F5) | „Inoffiziell │ Briefspiel" ✅ |
| Tafeleintrag entfernt (= Zustand direkt nach dem Quellen-Nachtrag) | **„Offiziell"** ❌ |

`syncFeatureSourcesToClientCache` schreibt `window.__featureSourceRefs`, fasst
`window.__featureKanon` aber nicht an (im Browser geprüft: `/__featureKanon/.test(fn)` → `false`).
`resolveFeatureKanon` liest „Verweise da + keine Abweichung" als Vorgabe `offiziell`.

## Global Constraints

- **Deutsch.** Kommentare, Commit-Betreffs und Testnamen sind deutsch (AGENTS.md §8).
- **Keine Zahl in einem Kommentar, die eine Liste bemisst.** Aufzählungen werden ausgeschrieben,
  nie gezählt („eine Regel, die einen von N Erzeugern bindet, ist keine Regel", AGENTS.md §11).
- **`AVESMAPS_ASSET_VERSION` bumpen.** `js/review/review-feature-sources.js` wird vom
  Territorien-Inline-Host **dynamisch** geladen
  (`js/territory/territory-editor-inline-host.js:41`) — ohne Bump serviert der Browser die alte
  Fassung (AGENTS.md §7).
- **KEIN `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION`-Bump.** `api/app/map-features.php` wird nicht
  angefasst; die Nutzlast bleibt zeichengleich. Wer sie doch anfasst, bumpt.
- **Kein `?v=` von Hand** irgendwo (AGENTS.md §7).
- **Vor jedem Push das GANZE Testfeld**, mit den Mustern des Workflows, parallel (AGENTS.md §9).
- **Nur eigene Pfade stagen.** Der Checkout ist geteilt; `git status` lesen, `git add <pfad>`
  einzeln, nie `git add -A`. `git add` und `git commit` in EINEM Zug (AGENTS.md §9).
- **Sichtbare Änderungen gehen EINZELN live.** Aufgabe 5 und Aufgabe 6 sind je ein eigener Push
  mit Owner-Blick dazwischen.
- **Nicht in diesem Plan:** die 446 Landschaftsflächen ohne Kanon-Eintrag und die Frage, ob
  `avesmapsFeatureSourcesKanonLeerEintraege` `ecosystem` weiter ausnimmt. Das ist ein eigener
  Befund und eine Owner-Entscheidung.

## Dateiübersicht

| Datei | Verantwortung nach dem Umbau |
|---|---|
| `api/_internal/app/feature-sources.php` | **Neu:** `avesmapsFeatureSourcesKanonFuerMehrere` — EIN Rechner für N Kennungen samt Namensraum aus der Datenbank. `avesmapsFeatureSourcesKanonFuerEines` wird ein dünner Aufruf davon (keine zweite Rechnung). |
| `api/edit/map/feature-sources.php` | Hängt `kanon_je_kennung` an seine EINE Antwortstelle — für jede Aktion auf einmal. |
| `api/_internal/import/garetien-uebernahme.php` | Hängt `kanon` an jeden `quellen_neu`-Eintrag. |
| `js/review/review-feature-sources.js` | `syncFeatureSourcesToClientCache` schreibt beide Tafeln und markiert die nachgetragenen Schlüssel. |
| `js/ui/popups.js` | `resolveFeatureKanon`: ein markierter Schlüssel ohne Kanon-Eintrag bekommt kein Etikett. |
| `js/review/review-garetien-importer.js` | Reicht das mitgelieferte `kanon` durch. |

---

### Task 1: Ein Rechner für viele Kennungen

**Warum zuerst:** `avesmapsFeatureSourcesKanonFuerEines` lädt Katalog UND Verweise VOLLSTÄNDIG —
ihr eigener Docblock warnt: „Wer sie je in eine Schleife stellt, baut genau die Last, vor der
CLAUDE.md warnt." Der Wege-Verteiler schickt bis zu 250 Kennungen in EINER Anfrage, der
Garetien-Import viele Objekte je Lauf. Ohne diese Aufgabe wäre der Fix ein Lastproblem.

**Der zweite Grund:** Der Endpunkt kennt die `wikiUrl` nicht — anders als der
Wiki-Zuweisungsweg, der sie gerade geschrieben hat. Ohne Namensraum verlöre ein **zugewiesenes**
Objekt sein „offiziell" und bekäme „inoffiziell │ Briefspiel" — eine neue Regression, schlimmer
als die alte. Der Namensraum kommt deshalb aus der Datenbank, **durch denselben Rechner**
(`avesmapsMapFeaturesWikiNamespaces`), nur mit Zeilen aus einer anderen Quelle.

**Files:**
- Modify: `api/_internal/app/feature-sources.php` (neue Funktionen vor
  `avesmapsFeatureSourcesKanonFuerEines`, Zeile ~3319; diese Funktion wird ersetzt)
- Test: `api/_internal/app/__tests__/kanon-nachtrag-test.php` (neu)

**Interfaces:**
- Produces:
  - `avesmapsFeatureSourcesWikiNamespacesFuerKennungen(PDO $pdo, string $entityType, array $publicIds): array`
    → `["<entityType>:<public_id>" => int]`
  - `avesmapsFeatureSourcesKanonFuerMehrere(PDO $pdo, string $entityType, array $publicIds, array $wikiUrlJeKennung = []): array`
    → `["<public_id>" => array{kanon:string,…}|null]`, jede angefragte Kennung ist enthalten
  - `avesmapsFeatureSourcesKanonFuerEines(…): ?array` — Signatur unverändert

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `api/_internal/app/__tests__/kanon-nachtrag-test.php`:

```php
<?php
declare(strict_types=1);

// Der Kanon-Nachtrag nach einer QUELLEN-Schreibaktion.
//
// 🚩 Owner-Meldung 09.09.2026 mit Bild (Landschaft „Schwanenbruch"): der Kopf sagte OFFIZIELL,
// die einzige Quelle darunter „INOFFIZIELL │ Briefspiel". Der Server hatte richtig abgeleitet --
// die Auskunft erreichte den Browser nur nie, weil der Client-Nachtrag die Verweise schreibt und
// die Kanon-Tafel nicht.

require_once __DIR__ . '/../feature-sources.php';
require_once __DIR__ . '/../../wiki/namespaces.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec("CREATE TABLE sources (
    id INTEGER PRIMARY KEY, url TEXT, url_hash TEXT, label TEXT, source_type TEXT,
    is_official INTEGER DEFAULT 0, corpus_key TEXT, license TEXT, attribution TEXT,
    created_at TEXT DEFAULT '2026-09-09 00:00:00'
)");
$pdo->exec("CREATE TABLE feature_sources (
    id INTEGER PRIMARY KEY, entity_type TEXT, entity_public_id TEXT, source_id INTEGER,
    status TEXT DEFAULT 'approved', reference_kind TEXT DEFAULT '', pages TEXT DEFAULT '',
    note TEXT DEFAULT '', origin TEXT DEFAULT 'manual'
)");
$pdo->exec("CREATE TABLE map_features (
    id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, properties_json TEXT,
    is_active INTEGER DEFAULT 1
)");
$pdo->exec("CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_key TEXT, wiki_url TEXT, is_active INTEGER DEFAULT 1
)");
$pdo->exec("CREATE TABLE political_territory_wiki (id INTEGER PRIMARY KEY, wiki_key TEXT, wiki_url TEXT)");

$pdo->exec("INSERT INTO sources (id, url, label, source_type, is_official) VALUES
    (1, 'https://www.garetien.de/index.php/Garetien:Schwanenbruch', 'Schwanenbruch auf garetien.de', 'briefspiel', 0),
    (2, 'https://ulisses.de/geographia', 'Geographia Aventurica', 'regionalspielhilfe', 1)");

// A: eine Landschaftsflaeche mit EINER inoffiziellen Quelle, ohne Wiki-Zuweisung -- der gemeldete Fall.
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('ecosystem', 'eco-A', 1)");
// B: ein Ort mit derselben inoffiziellen Quelle, ABER mit Hauptraum-Zuweisung -- er bleibt offiziell.
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('settlement', 'ort-B', 1)");
$pdo->exec("INSERT INTO map_features (public_id, feature_type, properties_json) VALUES
    ('ort-B', 'location', '" . json_encode([
        'public_id' => 'ort-B', 'feature_type' => 'location',
        'wiki_settlement' => ['wiki_key' => 'wiki:gareth', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Gareth'],
    ]) . "')");
// C: ein Ort mit einer PUBLIKATION als einziger Quelle -- Publikationen machen keinen Kanon.
$pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, reference_kind) VALUES ('settlement', 'ort-C', 2, 'publikation')");
// D: eine Kennung ohne jede Quelle.

$tafel = avesmapsFeatureSourcesKanonFuerMehrere($pdo, 'ecosystem', ['eco-A']);
assert(($tafel['eco-A']['kanon'] ?? null) === 'inoffiziell', 'A: inoffizielle Quelle -> inoffiziell');
assert(($tafel['eco-A']['bezeichner_type'] ?? null) === 'briefspiel', 'A: die ART ist der Bezeichner');

$tafel = avesmapsFeatureSourcesKanonFuerMehrere($pdo, 'settlement', ['ort-B', 'ort-C', 'ort-D']);
assert(($tafel['ort-B']['kanon'] ?? null) === 'offiziell',
    'B: die Hauptraum-ZUWEISUNG schlaegt die inoffizielle Quelle (Rangfolge 08.09.2026)');
assert(array_key_exists('ort-C', $tafel) && $tafel['ort-C'] === null,
    'C: eine Publikation macht keinen Kanon -- und "kein Etikett" wird AUSDRUECKLICH gemeldet');
assert(array_key_exists('ort-D', $tafel) && $tafel['ort-D'] === null,
    'D: jede ANGEFRAGTE Kennung steht in der Tafel, auch die ohne Quelle');

// 💣 Der Einzel-Aufruf ist ein duenner Aufruf des Mehrfach-Rechners, keine zweite Rechnung.
$einzeln = avesmapsFeatureSourcesKanonFuerEines($pdo, 'ecosystem', 'eco-A', '');
assert($einzeln == ($tafel2 = avesmapsFeatureSourcesKanonFuerMehrere($pdo, 'ecosystem', ['eco-A']))['eco-A'],
    'Einzel- und Mehrfachweg liefern dasselbe');
$rumpf = (new ReflectionFunction('avesmapsFeatureSourcesKanonFuerEines'));
$quelle = implode('', array_slice(
    file($rumpf->getFileName()), $rumpf->getStartLine() - 1, $rumpf->getEndLine() - $rumpf->getStartLine() + 1
));
assert(strpos($quelle, 'avesmapsFeatureSourcesKanonFuerMehrere') !== false,
    'KanonFuerEines geht durch den Mehrfach-Rechner -- eine zweite Ableitung waere die Divergenz, '
    . 'an der die Rangfolge schon einmal auseinandergelaufen ist');
assert(strpos($quelle, 'avesmapsFeatureSourcesDeriveKanon') === false,
    'KanonFuerEines leitet NICHTS mehr selbst ab');

// Die uebergebene Adresse schlaegt die Datenbank: der Wiki-Zuweisungsweg hat sie gerade geschrieben
// und kennt sie genauer als ein zweiter Lesevorgang.
$tafel = avesmapsFeatureSourcesKanonFuerMehrere(
    $pdo, 'settlement', ['ort-B'], ['ort-B' => 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Gareth']
);
assert(($tafel['ort-B']['kanon'] ?? null) === 'inoffiziell',
    'die uebergebene Adresse gewinnt gegen die gespeicherte');

echo "kanon-nachtrag-test: OK\n";
```

- [ ] **Schritt 2: Test fahren, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/kanon-nachtrag-test.php
```

Erwartet: `Call to undefined function avesmapsFeatureSourcesKanonFuerMehrere()`.

- [ ] **Schritt 3: Den Namensraum-Leser schreiben**

In `api/_internal/app/feature-sources.php`, direkt VOR
`avesmapsFeatureSourcesKanonFuerEines` (Zeile ~3319):

```php
/**
 * DER WIKI-NAMENSRAUM EINZELNER OBJEKTE -- aus der Datenbank statt aus der fertigen Nutzlast.
 *
 * 🔴 SIE LEITET NICHTS SELBST AB. Sie holt die Rohzeilen, bringt sie in die Form, die
 * avesmapsMapFeaturesWikiNamespaces erwartet, und laesst DIESE Funktion entscheiden -- dieselbe,
 * die auch die Kartennutzlast fuellt. Eine zweite Lesart des Zuweisungsnests waere genau die
 * Divergenz, an der die Rangfolge zwischen ns 222 und Quellzeile schon einmal auseinandergelaufen
 * ist (31.08.-02.09.2026).
 *
 * ⚠️ AUS DER ROHZEILE, und das ist seit dem 09.09.2026 zulaessig: die Ableitung liest das
 * ZUWEISUNGSNEST (`properties.wiki_settlement` und Geschwister), nie die angereicherte
 * `properties.wiki_url` -- und das Nest steht unveraendert im gespeicherten `properties_json`.
 * Der Rateweg, der `wiki_url` per Namensabgleich gefuellt hat, ist mit e25f7e408 zurueckgebaut.
 *
 * ⚠️ Territorien haben kein `map_features`-Gegenstueck; fuer sie gilt der vorhandene Leser
 * avesmapsPoliticalTerritoryWikiNamespaces, aus dem hier nur die gefragten Kennungen genommen
 * werden. Er liest die ganze Tabelle -- das ist derselbe Preis, den auch
 * avesmapsFeatureSourcesKanonFuerEines zahlt, und aus demselben Grund vertretbar: der einzige
 * Aufrufer ist eine EDITOR-Schreibaktion, nicht der oeffentliche Lesepfad.
 *
 * @param list<string> $publicIds
 * @return array<string, int> "<entityType>:<public_id>" => Namensraum
 */
function avesmapsFeatureSourcesWikiNamespacesFuerKennungen(
    PDO $pdo,
    string $entityType,
    array $publicIds
): array {
    $ids = array_values(array_unique(array_filter(array_map(
        static fn($id): string => trim((string) $id),
        $publicIds
    ), static fn(string $id): bool => $id !== '')));
    if ($entityType === '' || $ids === []) {
        return [];
    }

    if ($entityType === 'territory') {
        $alle = avesmapsPoliticalTerritoryWikiNamespaces($pdo);
        $out = [];
        foreach ($ids as $id) {
            $key = 'territory:' . $id;
            if (isset($alle[$key])) {
                $out[$key] = $alle[$key];
            }
        }

        return $out;
    }

    // Der Feature-Typ zu dieser Objektart -- dieselbe Tafel, nur andersherum gelesen.
    $featureType = array_search($entityType, AVESMAPS_MAP_FEATURES_KANON_ENTITY_TYPE_BY_FEATURE_TYPE, true);
    if ($featureType === false) {
        // ⚠️ ecosystem, citymap, lore: der Kanon-Leser kennt fuer sie kein Zuweisungsnest. Kein
        // Namensraum heisst „keine Aussage" -- die Quellen entscheiden allein, wie bisher.
        return [];
    }

    $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
    try {
        $statement = $pdo->prepare(
            "SELECT public_id, feature_type, properties_json
               FROM map_features
              WHERE is_active = 1 AND feature_type = ? AND public_id IN ($platzhalter)"
        );
        $statement->execute(array_merge([$featureType], $ids));
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $fehler) {
        // ⚠️ Protokolliert, nicht geschluckt: ein SQL-Fehler saehe sonst exakt aus wie „kein Objekt
        // ist zugewiesen" -- die HY093-Falle von „Was ist hier?" (AGENTS.md §11).
        error_log('avesmapsFeatureSourcesWikiNamespacesFuerKennungen: ' . $fehler->getMessage());

        return [];
    }

    $features = [];
    foreach ($rows as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        // Die zwei Felder, an denen der geteilte Rechner das Objekt erkennt -- die gespeicherte
        // Zeile fuehrt sie nicht zwingend im JSON.
        $properties['feature_type'] = (string) ($row['feature_type'] ?? '');
        $properties['public_id'] = (string) ($row['public_id'] ?? '');
        $features[] = ['properties' => $properties];
    }

    return avesmapsMapFeaturesWikiNamespaces($features);
}
```

- [ ] **Schritt 4: Den Mehrfach-Rechner schreiben und `KanonFuerEines` darauf zurückführen**

Direkt darunter (und der bestehende Rumpf von `avesmapsFeatureSourcesKanonFuerEines`, Zeilen
3319–3359, wird durch den dünnen Aufruf unten ersetzt — der Docblock darüber bleibt stehen und
bekommt den Zusatz):

```php
/**
 * DAS KANON-ETIKETT VIELER OBJEKTE -- fuer die Antwort einer Quellen-Schreibaktion.
 *
 * 🚩 Owner-Meldung 09.09.2026 mit Bild: die Landschaft „Schwanenbruch" trug am Kopf OFFIZIELL und
 * darunter ihre einzige Quelle als „INOFFIZIELL │ Briefspiel". Der Client-Nachtrag
 * (syncFeatureSourcesToClientCache) schreibt die Verweise, und resolveFeatureKanon liest
 * „Verweise da + keine Abweichung" als Vorgabe „offiziell". Diese Funktion liefert die fehlende
 * Haelfte.
 *
 * 💣 EIN RECHNER FUER N KENNUNGEN, weil der Wege-Verteiler bis zu AVESMAPS_PATH_GROUP_MAX_SEGMENTS
 * Kennungen in EINER Anfrage schickt. Katalog und Verweise werden EINMAL geladen; die
 * Einzelfassung darunter ruft nur noch hier herein. avesmapsFeatureSourcesKanonFuerEines in eine
 * Schleife zu stellen waere die Last, vor der CLAUDE.md warnt -- ihr eigener Docblock sagt es.
 *
 * 🔴 JEDE ANGEFRAGTE KENNUNG STEHT IN DER TAFEL, auch mit `null`. `null` heisst „kein Etikett" und
 * ist eine AUSKUNFT, kein fehlender Wert: der Client loescht daraufhin seinen Tafeleintrag. Ein
 * FEHLENDER Schluessel hiesse dort „nicht gefragt" und liesse den alten Eintrag stehen.
 *
 * @param list<string> $publicIds
 * @param array<string, string> $wikiUrlJeKennung  Adressen, die der Aufrufer GERADE geschrieben hat.
 *        Sie schlagen die gespeicherten -- er kennt sie genauer als ein zweiter Lesevorgang, der mit
 *        ihm um die Reihenfolge konkurrierte.
 * @return array<string, array{kanon:string, bezeichner_label?:string, bezeichner_type?:string, bezeichner_count?:int}|null>
 */
function avesmapsFeatureSourcesKanonFuerMehrere(
    PDO $pdo,
    string $entityType,
    array $publicIds,
    array $wikiUrlJeKennung = []
): array {
    $entityType = trim($entityType);
    $ids = array_values(array_unique(array_filter(array_map(
        static fn($id): string => trim((string) $id),
        $publicIds
    ), static fn(string $id): bool => $id !== '')));
    if ($entityType === '' || $ids === []) {
        return [];
    }

    $raeume = avesmapsFeatureSourcesWikiNamespacesFuerKennungen($pdo, $entityType, $ids);
    foreach ($wikiUrlJeKennung as $id => $wikiUrl) {
        $key = $entityType . ':' . trim((string) $id);
        $ns = avesmapsWikiNamespaceFromWikiUrlMitHauptraum(trim((string) $wikiUrl));
        if ($ns !== null) {
            $raeume[$key] = $ns;
        } else {
            // Eine ausdruecklich LEERE Adresse ist die Ruecknahme einer Zuweisung -- dann darf der
            // gespeicherte Raum nicht weitergelten, sonst saehe der Editor sein eigenes Entfernen nicht.
            unset($raeume[$key]);
        }
    }

    $alleRefs = avesmapsLoadFeatureSourceRefs($pdo);
    $refs = [];
    foreach ($ids as $id) {
        $key = $entityType . ':' . $id;
        if (isset($alleRefs[$key])) {
            $refs[$key] = $alleRefs[$key];
        }
    }

    $kanon = avesmapsFeatureSourcesDeriveKanon(avesmapsLoadFeatureSourceCatalog($pdo), $refs, $raeume);

    $out = [];
    foreach ($ids as $id) {
        $key = $entityType . ':' . $id;
        if (isset($kanon[$key])) {
            $out[$id] = $kanon[$key];
            continue;
        }
        // „Kein Etikett" -- ausdruecklich, nie durch Weglassen (siehe 🔴 oben).
        $out[$id] = null;
    }

    return $out;
}
```

Und der Rumpf von `avesmapsFeatureSourcesKanonFuerEines` wird zu:

```php
function avesmapsFeatureSourcesKanonFuerEines(
    PDO $pdo,
    string $entityType,
    string $publicId,
    string $wikiUrl
): ?array {
    $entityType = trim($entityType);
    $publicId = trim($publicId);
    if ($entityType === '' || $publicId === '') {
        return null;
    }
    // 💣 KEINE ZWEITE ABLEITUNG. Diese Funktion ist seit dem 09.09.2026 ein duenner Aufruf des
    // Mehrfach-Rechners; ihre eigene Fassung stand ab dem 02.09.2026 daneben und war der Grund,
    // warum der Quellen-Weg beim naechsten Bedarf uebersehen wurde.
    $tafel = avesmapsFeatureSourcesKanonFuerMehrere($pdo, $entityType, [$publicId], [$publicId => $wikiUrl]);

    return $tafel[$publicId] ?? null;
}
```

- [ ] **Schritt 5: Test fahren, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/kanon-nachtrag-test.php
```

Erwartet: `kanon-nachtrag-test: OK`

- [ ] **Schritt 6: Den bestehenden Kanon-Test gegenfahren** (er nagelt die Rangfolge fest — er
      darf sich nicht bewegen)

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/kanon-etikett-test.php
```

Erwartet: unverändert grün.

- [ ] **Schritt 7: Commit**

```bash
git add api/_internal/app/feature-sources.php api/_internal/app/__tests__/kanon-nachtrag-test.php && git commit -F- <<'MSG'
refactor(quellen): EIN Kanon-Rechner fuer viele Kennungen -- der Einzelweg ruft ihn nur noch

Vorbereitung fuer den Nachtrag des Kanon-Etiketts nach einer Quellen-Schreibaktion. Der
Wege-Verteiler schickt bis zu 250 Kennungen in einer Anfrage; avesmapsFeatureSourcesKanonFuerEines
laedt Katalog und Verweise vollstaendig und darf deshalb nie in einer Schleife stehen.

Der Namensraum kommt neu aus der Datenbank, aber durch DENSELBEN Rechner
(avesmapsMapFeaturesWikiNamespaces) -- ohne ihn verloere ein zugewiesenes Objekt sein "offiziell",
sobald jemand ihm eine inoffizielle Quelle eintraegt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: Der Quellen-Endpunkt liefert das Etikett mit

**Warum an dieser einen Stelle:** `api/edit/map/feature-sources.php` hat für **alle** Aktionen
genau EINE Antwortstelle (`avesmapsJsonResponse(200, $result)`). Hängte der Anbau an den
Aktions-Zweigen, wäre er beim nächsten Zweig vergessen — dieselbe Begründung wie beim Trichter
`renderLoreDetail` (AGENTS.md §11) und wie beim Client-Nachtrag, der genau deshalb an Zeile 1782
sitzt und nicht an den Klick-Handlern.

**Files:**
- Modify: `api/edit/map/feature-sources.php:344` (die Antwortstelle)
- Test: `api/_internal/app/__tests__/kanon-nachtrag-test.php` (Abschnitt anfügen)

**Interfaces:**
- Consumes: `avesmapsFeatureSourcesKanonFuerMehrere` (Task 1)
- Produces: Antwortfeld `kanon_je_kennung` → `{"<public_id>": {kanon:…}|null}`; fehlt bei den
  Sammelläufen ohne Kennung

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

An `api/_internal/app/__tests__/kanon-nachtrag-test.php` anfügen (vor der Schlusszeile `echo`):

```php
// ---- Der Endpunkt haengt das Etikett an SEINE EINE Antwortstelle --------------------------------
// 💣 Am Quelltext geprueft, nicht am HTTP-Ablauf: der Endpunkt verlangt eine Sitzung mit Faehigkeit,
// und ein zweiter Erzeuger neben der einen Antwortstelle ist genau das, was hier verhindert wird.
$endpunkt = file_get_contents(__DIR__ . '/../../../edit/map/feature-sources.php');
$antwortStellen = preg_match_all('/avesmapsJsonResponse\(\s*200\s*,/', $endpunkt);
assert($antwortStellen === 1,
    'Der Endpunkt hat GENAU EINE Erfolgs-Antwortstelle -- an einer zweiten waere der Anbau '
    . 'beim naechsten Aktions-Zweig vergessen (Trichter-Regel, AGENTS.md §11)');
assert(strpos($endpunkt, 'avesmapsFeatureSourcesKanonFuerMehrere') !== false,
    'Der Endpunkt fragt den Mehrfach-Rechner');
assert(preg_match('/kanon_je_kennung/', $endpunkt) === 1,
    'Er haengt genau EIN Feld an, unter genau EINEM Namen');
// Der Anbau steht VOR der Antwortstelle -- danach waere er wirkungslos.
assert(strpos($endpunkt, 'kanon_je_kennung') < strrpos($endpunkt, 'avesmapsJsonResponse(200'),
    'Der Anbau steht vor der Antwort');
```

- [ ] **Schritt 2: Test fahren, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/kanon-nachtrag-test.php
```

Erwartet: FAIL bei „Der Endpunkt fragt den Mehrfach-Rechner".

- [ ] **Schritt 3: Den Anbau schreiben**

In `api/edit/map/feature-sources.php`, unmittelbar vor `avesmapsJsonResponse(200, $result);`
(Zeile 344):

```php
    // DAS KANON-ETIKETT DER BETROFFENEN OBJEKTE -- die zweite Haelfte des Client-Nachtrags.
    //
    // 🚩 Owner-Meldung 09.09.2026 mit Bild: „Schwanenbruch" trug am Kopf OFFIZIELL und darunter
    // seine einzige Quelle als „INOFFIZIELL │ Briefspiel". syncFeatureSourcesToClientCache schreibt
    // die Verweise in den Kartenspeicher, und resolveFeatureKanon (js/ui/popups.js) liest
    // „Verweise da + keine Abweichung" als Vorgabe „offiziell". Ohne diese Zeilen kippt jedes frisch
    // bequellte Objekt auf OFFIZIELL, bis die Seite neu laedt -- am schlimmsten genau dann, wenn die
    // eingetragene Quelle INOFFIZIELL ist.
    //
    // 🔴 AN DER EINEN ANTWORTSTELLE, nicht in den Aktions-Zweigen: dort waere er beim naechsten
    // Zweig vergessen. Dieselbe Begruendung, aus der der Client-Nachtrag am Trichter haengt und
    // nicht an den Klick-Handlern.
    //
    // ⚠️ Die Sammellaeufe (die Uebernahmen und der Wegquellen-Verteiler) nennen KEINE Kennung und
    // bekommen deshalb nichts angehaengt -- sie beruehren Tausende Objekte, und der Browser, der
    // sie ausloest, zeigt keines davon.
    if (is_array($result) && $entityType !== '' && ($entityPublicIds !== [] || $entityPublicId !== '')) {
        $result['kanon_je_kennung'] = avesmapsFeatureSourcesKanonFuerMehrere(
            $pdo,
            $entityType,
            $entityPublicIds !== [] ? $entityPublicIds : [$entityPublicId]
        );
    }

```

- [ ] **Schritt 4: Test fahren, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/kanon-nachtrag-test.php
```

Erwartet: `kanon-nachtrag-test: OK`

- [ ] **Schritt 5: Die Nachbartests des Endpunkts gegenfahren**

```bash
for t in api/_internal/app/__tests__/quellen-*.php api/_internal/app/__tests__/kanon-*.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done
```

Erwartet: keine Ausgabe.

- [ ] **Schritt 6: Commit**

```bash
git add api/edit/map/feature-sources.php api/_internal/app/__tests__/kanon-nachtrag-test.php && git commit -F- <<'MSG'
fix(quellen): jede Quellen-Schreibaktion liefert das neue Kanon-Etikett mit

Owner-Meldung 09.09.2026 (Landschaft "Schwanenbruch"): Kopf OFFIZIELL, einzige Quelle darunter
INOFFIZIELL | Briefspiel. Der Anbau sitzt an der EINEN Antwortstelle des Endpunkts, damit ihn kein
kuenftiger Aktions-Zweig vergessen kann.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: Der Garetien-Importer liefert das Etikett mit

**Warum eigene Aufgabe:** Er ist der **zweite** Weg in denselben Client-Nachtrag — und der, über
den der gemeldete Fall gelaufen ist (`quellen_neu` trägt die garetien.de-Quellen). Er geht nicht
durch den Endpunkt aus Task 2, sondern baut seine Antwort selbst.

**Files:**
- Modify: `api/_internal/import/garetien-uebernahme.php` (der `quellen_neu`-Bauer, Zeile ~1836–1844)
- Test: `api/_internal/import/__tests__/garetien-kanon-mitreist-test.php` (neu)

**Interfaces:**
- Consumes: `avesmapsFeatureSourcesKanonFuerMehrere` (Task 1)
- Produces: jeder `quellen_neu`-Eintrag trägt zusätzlich `kanon` → `{kanon:…}|null`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `api/_internal/import/__tests__/garetien-kanon-mitreist-test.php`:

```php
<?php
declare(strict_types=1);

// Die Uebernahme reicht das Kanon-Etikett mit -- sonst zeigt das frisch importierte Objekt
// „OFFIZIELL", obwohl seine einzige Quelle ein Briefspiel ist (Owner-Meldung 09.09.2026).
//
// 💣 Am Quelltext geprueft: der Uebernahme-Lauf braucht die volle Import-Fixture, und gefragt ist
// hier die VERDRAHTUNG -- reist das Feld ueberhaupt mit? Die Ableitung selbst haelt
// api/_internal/app/__tests__/kanon-nachtrag-test.php fest.

$quelle = file_get_contents(__DIR__ . '/../garetien-uebernahme.php');
assert(is_string($quelle), 'Die Uebernahme ist lesbar');

// Kommentare heraus, sonst schlaegt die Pruefung an der Warnung an, die vor dem Muster warnt.
$code = '';
foreach (token_get_all($quelle) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $code .= is_array($token) ? $token[1] : $token;
}

assert(strpos($code, "'quellen_neu'") !== false, 'Der Bauer heisst weiterhin quellen_neu');
assert(strpos($code, 'avesmapsFeatureSourcesKanonFuerMehrere') !== false,
    'Die Uebernahme fragt den Mehrfach-Rechner -- nicht KanonFuerEines in einer Schleife: '
    . 'der laedt Katalog und Verweise je Aufruf vollstaendig');
assert(preg_match("/'kanon'\s*=>/", $code) === 1,
    'Jeder quellen_neu-Eintrag traegt genau EIN Kanon-Feld');
assert(strpos($code, 'avesmapsFeatureSourcesKanonFuerEines') === false,
    'KanonFuerEines steht hier nicht -- er ist der Einzelweg und gehoert nicht in einen Massenlauf');

echo "garetien-kanon-mitreist-test: OK\n";
```

- [ ] **Schritt 2: Test fahren, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-kanon-mitreist-test.php
```

Erwartet: FAIL bei „Die Uebernahme fragt den Mehrfach-Rechner".

- [ ] **Schritt 3: Den Anbau schreiben**

In `api/_internal/import/garetien-uebernahme.php` wird der `quellen_neu`-Bauer (die Stelle, an der
`'sources' => avesmapsListFeatureSourcesForEdit(…)` gefüllt wird) um das Etikett ergänzt. Die
Kennungen werden dafür **nach Objektart gebündelt** und in einem Aufruf je Art gerechnet:

```php
    // DAS KANON-ETIKETT DER FRISCH BEQUELLTEN OBJEKTE -- die zweite Haelfte des Client-Nachtrags.
    //
    // 🚩 Owner-Meldung 09.09.2026: eine importierte Landschaft trug am Kopf OFFIZIELL, waehrend
    // darunter ihre einzige Quelle als „INOFFIZIELL │ Briefspiel" stand. Der Nachtrag
    // (garetienQuellenNachtragen -> syncFeatureSourcesToClientCache) schreibt die Verweise in den
    // Kartenspeicher; ohne das Etikett daneben faellt resolveFeatureKanon auf die Vorgabe zurueck,
    // und die heisst „offiziell".
    //
    // 💣 GEBUENDELT JE OBJEKTART, nie je Eintrag: avesmapsFeatureSourcesKanonFuerEines laedt
    // Katalog UND Verweise vollstaendig -- in der Schleife eines Massenlaufs waere das genau die
    // Last, vor der CLAUDE.md warnt.
    $kennungenJeArt = [];
    foreach ($quellenRueck as $eintrag) {
        $art = (string) ($eintrag['entity_type'] ?? '');
        $id = (string) ($eintrag['public_id'] ?? '');
        if ($art !== '' && $id !== '') {
            $kennungenJeArt[$art][] = $id;
        }
    }
    $kanonJeArt = [];
    foreach ($kennungenJeArt as $art => $kennungen) {
        $kanonJeArt[$art] = avesmapsFeatureSourcesKanonFuerMehrere($pdo, $art, $kennungen);
    }
    foreach ($quellenRueck as $i => $eintrag) {
        $art = (string) ($eintrag['entity_type'] ?? '');
        $id = (string) ($eintrag['public_id'] ?? '');
        // 🔴 AUSDRUECKLICH `null`, nie weggelassen: der Client loescht darauf seinen Tafeleintrag.
        // Ein FEHLENDER Schluessel hiesse „nicht gefragt" und liesse den alten Eintrag stehen.
        $quellenRueck[$i]['kanon'] = $kanonJeArt[$art][$id] ?? null;
    }
```

Falls `feature-sources.php` in dieser Datei noch nicht eingebunden ist, kommt das `require_once`
an den Dateikopf zu den übrigen.

- [ ] **Schritt 4: Test fahren, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-kanon-mitreist-test.php
```

Erwartet: `garetien-kanon-mitreist-test: OK`

- [ ] **Schritt 5: Die Importer-Tests gegenfahren**

```bash
for t in $(find api/_internal/import -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done
```

Erwartet: keine Ausgabe.

- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/import/garetien-uebernahme.php api/_internal/import/__tests__/garetien-kanon-mitreist-test.php && git commit -F- <<'MSG'
fix(garetien): die Uebernahme reicht das Kanon-Etikett mit

Der zweite Weg in denselben Client-Nachtrag -- und der, ueber den der gemeldete Fall lief. Das
Etikett wird je Objektart gebuendelt gerechnet, nicht je Eintrag: der Einzelweg laedt Katalog und
Verweise vollstaendig und gehoert nicht in einen Massenlauf.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: Der EINE Client-Nachtrag schreibt beide Tafeln

**Das ist die Reparatur selbst.** `syncFeatureSourcesToClientCache` ist der einzige Schreiber von
`window.__featureSourceRefs` — alle drei Nachtragswege (Quellen-Editor-Trichter, angenommene
Gemeinschaftsmeldung, Garetien-Übernahme) münden hier. Er bekommt das Kanon-Wörterbuch und trägt
es ein: **setzen oder löschen**, wie es `review-settlement-wiki.js` seit dem 02.09.2026 für die
Wiki-Zuweisung tut.

**Files:**
- Modify: `js/review/review-feature-sources.js` (Signatur und Rumpf von
  `syncFeatureSourcesToClientCache`, Zeile ~3073–3133; die Aufrufstellen 1782 und ~3034)
- Modify: `js/review/review-garetien-importer.js` (der Durchreicher, ~Zeile 6277)
- Modify: `js/territory/territory-editor-inline-host.js` (`ASSET_VERSION`)
- Test: `js/review/__tests__/kanon-nachtrag-tafel.test.js` (neu)

**Interfaces:**
- Consumes: `kanon_je_kennung` (Task 2), `quellen_neu[].kanon` (Task 3)
- Produces:
  - `syncFeatureSourcesToClientCache(entityType, entityPublicId, editorSources, byEntity, kanonJeKennung)`
    — fünfter Parameter, `{"<public_id>": {kanon:…}|null}`; fehlt er, wird **nichts** in die
    Kanon-Tafel geschrieben und der Riegel aus Task 5 greift
  - `window.__featureSourceRefsNachgetragen` → `{"<typ>:<public_id>": true}`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/review/__tests__/kanon-nachtrag-tafel.test.js`:

```js
"use strict";

// Der Client-Nachtrag schreibt BEIDE Tafeln.
//
// 🚩 Owner-Meldung 09.09.2026 mit Bild (Landschaft „Schwanenbruch"): Kopf OFFIZIELL, einzige Quelle
// darunter „INOFFIZIELL │ Briefspiel". syncFeatureSourcesToClientCache schrieb die Verweise und
// liess die Kanon-Tafel unberuehrt; resolveFeatureKanon liest „Verweise da + keine Abweichung" als
// Vorgabe „offiziell".

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const modul = require(path.join(__dirname, "..", "review-feature-sources.js"));
const sync = modul.syncFeatureSourcesToClientCache || global.syncFeatureSourcesToClientCache;
assert.strictEqual(typeof sync, "function", "der Nachtrag ist erreichbar");

function frischesFenster() {
  return {
    __sourceCatalog: {},
    __sourceCorpora: {},
    __featureSourceRefs: {},
    __featureKanon: { vorgabe: "offiziell", abweichungen: {} },
  };
}
const quelleA = { source_id: 1, url: "https://garetien.de/x", label: "X", official: false, type: "briefspiel" };

// --- A: ein Etikett wird GESETZT ---------------------------------------------------------------
let w = frischesFenster();
global.window = w;
sync("ecosystem", "eco-A", [quelleA], null, { "eco-A": { kanon: "inoffiziell", bezeichner_type: "briefspiel" } });
assert.deepStrictEqual(w.__featureKanon.abweichungen["ecosystem:eco-A"],
  { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
  "A: das mitgelieferte Etikett steht in der Tafel");
assert.strictEqual(w.__featureSourceRefs["ecosystem:eco-A"].length, 1, "A: der Verweis steht auch da");

// --- B: `null` LOESCHT den Eintrag --------------------------------------------------------------
// Ein Objekt, dessen letzte kanonrelevante Quelle entfernt wurde, hat KEIN Etikett mehr. Bliebe der
// alte Eintrag stehen, behauptete der Kopf eine Herkunft, die die Liste darunter nicht mehr deckt.
w = frischesFenster();
w.__featureKanon.abweichungen["settlement:ort-B"] = { kanon: "inoffiziell" };
global.window = w;
sync("settlement", "ort-B", [{ source_id: 2, url: "https://u.de/g", label: "G", official: true, type: "regionalspielhilfe" }],
  null, { "ort-B": null });
assert.ok(!("settlement:ort-B" in w.__featureKanon.abweichungen),
  "B: `null` loescht den Eintrag, statt ihn stehen zu lassen");

// --- C: `by_entity` -- jede Kennung bekommt IHR Etikett -----------------------------------------
w = frischesFenster();
global.window = w;
sync("path", "weg-1", [quelleA],
  { "weg-1": [{ source_id: 1 }], "weg-2": [{ source_id: 1 }] },
  { "weg-1": { kanon: "inoffiziell" }, "weg-2": { kanon: "offiziell" } });
assert.deepStrictEqual(w.__featureKanon.abweichungen["path:weg-1"], { kanon: "inoffiziell" }, "C: weg-1");
assert.deepStrictEqual(w.__featureKanon.abweichungen["path:weg-2"], { kanon: "offiziell" }, "C: weg-2");
assert.ok(Array.isArray(w.__featureSourceRefs["path:weg-2"]),
  "C: die by_entity-Weiche schreibt weiterhin JE Kennung -- nie die Vereinigung an alle");

// --- D: die MARKE, an der der Riegel aus popups.js haengt ---------------------------------------
w = frischesFenster();
global.window = w;
sync("ecosystem", "eco-D", [quelleA]);
assert.strictEqual(w.__featureSourceRefsNachgetragen["ecosystem:eco-D"], true,
  "D: ein nachgetragener Schluessel ist markiert -- daran erkennt resolveFeatureKanon, dass die "
  + "Vorgabe fuer ihn nicht gilt");
assert.ok(!("ecosystem:eco-D" in w.__featureKanon.abweichungen),
  "D: ohne mitgeliefertes Etikett wird NICHTS in die Kanon-Tafel geschrieben");

// --- E: die Aufrufwege reichen das Etikett wirklich durch ---------------------------------------
// 🪤 Kommentare heraus, sonst schlaegt die Pruefung an der Warnung an, die vor dem Muster warnt.
function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const code = ohneKommentare(fs.readFileSync(path.join(__dirname, "..", "review-feature-sources.js"), "utf8"))
  + ohneKommentare(fs.readFileSync(path.join(__dirname, "..", "review-garetien-importer.js"), "utf8"));
const stellen = code.split("syncFeatureSourcesToClientCache(").slice(1)
  .concat(code.split("abgleich(").slice(1));
let geprueft = 0;
for (const treffer of stellen) {
  const args = treffer.slice(0, treffer.indexOf(")"));
  if (args.startsWith("entityType, entityPublicId, editorSources")) { continue; }  // die Definition
  if (args.trim() === "" || /^function/.test(args)) { continue; }
  assert.ok(/kanon/i.test(args),
    "E: jeder Aufruf reicht das Kanon-Woerterbuch durch -- sonst faellt genau dieser Weg auf den "
    + "Riegel zurueck und zeigt gar kein Etikett: " + args);
  geprueft++;
}
assert.ok(geprueft >= 3, "E: die Aufrufwege sind noch da (gefunden: " + geprueft + ")");

console.log("kanon-nachtrag-tafel: OK");
```

- [ ] **Schritt 2: Test fahren, Fehlschlag bestätigen**

```bash
node js/review/__tests__/kanon-nachtrag-tafel.test.js
```

Erwartet: FAIL bei A („das mitgelieferte Etikett steht in der Tafel").

- [ ] **Schritt 3: Den Nachtrag umbauen**

In `js/review/review-feature-sources.js`: die Signatur bekommt einen fünften Parameter, der
`@param`-Block darüber wird ergänzt:

```js
/**
 * @param {object} [kanonJeKennung]  Das KANON-ETIKETT je Kennung, wie es die Schreibaktion
 *   zurueckgegeben hat: `{"<public_id>": {kanon:…}|null}`. `null` heisst „kein Etikett" und
 *   LOESCHT den Tafeleintrag -- eine Auskunft, kein fehlender Wert.
 *
 * 🚩 Owner-Meldung 09.09.2026 mit Bild (Landschaft „Schwanenbruch"): Kopf OFFIZIELL, einzige Quelle
 * darunter „INOFFIZIELL │ Briefspiel". Diese Funktion schrieb bis dahin NUR die Verweise, und
 * resolveFeatureKanon (js/ui/popups.js) liest „Verweise da + keine Abweichung" als Vorgabe
 * „offiziell" -- also kippte jedes frisch bequellte Objekt auf OFFIZIELL, bis die Seite neu lud.
 * Es ist dieselbe Klasse wie Lizenz, Namensnennung und Korpusschluessel darueber: wer dem
 * Kartenspeicher ein Feld gibt, gibt es diesem Nachtrag mit.
 */
function syncFeatureSourcesToClientCache(entityType, entityPublicId, editorSources, byEntity, kanonJeKennung) {
```

Der bisherige frühe `return` in der `by_entity`-Weiche wird aufgelöst, damit **beide** Wege durch
den Tafel-Teil laufen — die Weiche merkt sich nur noch, welche Kennungen sie angefasst hat:

```js
  // Die Kennungen, die dieser Aufruf wirklich angefasst hat.
  const kennungen = byEntity && typeof byEntity === "object" && !Array.isArray(byEntity)
    ? Object.keys(byEntity)
    : [entityPublicId];

  if (byEntity && typeof byEntity === "object" && !Array.isArray(byEntity)) {
    for (const [kennung, verweise] of Object.entries(byEntity)) {
      ziel.__featureSourceRefs[`${entityType}:${kennung}`] = (Array.isArray(verweise) ? verweise : [])
        .filter((v) => v && v.source_id !== undefined && v.source_id !== null)
        .map((v) => ({ source_id: v.source_id, pages: v.pages || "", reference_kind: v.reference_kind || "" }));
    }
  } else {
    ziel.__featureSourceRefs[`${entityType}:${entityPublicId}`] = refs;
  }

  ziel.__featureSourceRefsNachgetragen = ziel.__featureSourceRefsNachgetragen || {};
  ziel.__featureKanon = ziel.__featureKanon || { vorgabe: "", abweichungen: {} };
  ziel.__featureKanon.abweichungen = ziel.__featureKanon.abweichungen || {};

  for (const kennung of kennungen) {
    const schluessel = `${entityType}:${kennung}`;
    // 💣 DIE MARKE IST DER RIEGEL, und sie wird IMMER gesetzt -- auch ohne mitgeliefertes Etikett.
    // resolveFeatureKanon laesst die Vorgabe „offiziell" fuer einen markierten Schluessel ohne
    // ausdruecklichen Eintrag nicht mehr gelten. Ein kuenftiger Nachtragsweg, der das Etikett
    // vergisst, bekommt damit „kein Etikett" statt eines falschen -- die sichere Richtung,
    // strukturell statt per Vereinbarung.
    ziel.__featureSourceRefsNachgetragen[schluessel] = true;
    if (!kanonJeKennung || typeof kanonJeKennung !== "object" || !(kennung in kanonJeKennung)) {
      continue;
    }
    const etikett = kanonJeKennung[kennung];
    if (etikett && typeof etikett === "object") {
      ziel.__featureKanon.abweichungen[schluessel] = etikett;
    } else {
      // 🔴 LOESCHEN, nicht stehenlassen: „kein Etikett" ist eine Auskunft. Dasselbe Paar aus Setzen
      // und Loeschen wie in review-settlement-wiki.js, wo es seit dem 02.09.2026 fuer die
      // Wiki-Zuweisung steht.
      delete ziel.__featureKanon.abweichungen[schluessel];
    }
  }
}
```

Die Aufrufstellen reichen das Wörterbuch durch:

```js
// js/review/review-feature-sources.js:1782 (der Trichter des Editors)
      syncFeatureSourcesToClientCache(entityType, publicId, data.sources, data.by_entity, data.kanon_je_kennung);

// js/review/review-feature-sources.js:~3034 (die angenommene Gemeinschaftsmeldung)
  syncFeatureSourcesToClientCache("settlement", entityPublicId, data.sources, null, data.kanon_je_kennung);

// js/review/review-garetien-importer.js:~6277 (die Uebernahme)
      abgleich(eintrag.entity_type, eintrag.public_id, eintrag.sources || [], null,
        // 🔴 Das Etikett reist je Eintrag mit (api/_internal/import/garetien-uebernahme.php). Ein
        // Eintrag OHNE `kanon` faellt bewusst auf den Riegel zurueck und zeigt gar keins.
        Object.prototype.hasOwnProperty.call(eintrag, "kanon") ? { [eintrag.public_id]: eintrag.kanon } : undefined);
```

- [ ] **Schritt 4: Test fahren, grün bestätigen**

```bash
node js/review/__tests__/kanon-nachtrag-tafel.test.js
```

Erwartet: `kanon-nachtrag-tafel: OK`

- [ ] **Schritt 5: Die vier bestehenden Nachbartests gegenfahren**

```bash
for t in js/review/__tests__/quellen-sofort-sichtbar.test.js js/review/__tests__/quellen-korpus-im-client-cache.test.js js/review/__tests__/garetien-quelle-mitreist.test.js js/review/__tests__/quellen-verteiler.test.js; do node "$t" >/dev/null || echo "ROT: $t"; done
```

Erwartet: keine Ausgabe. **Bricht einer, ist der aufgelöste `return` der `by_entity`-Weiche
schuld** — sie darf die Verweise nicht doppelt schreiben und die Anker-Zeile nicht zusätzlich
setzen (sonst stünde die Vereinigung an allen Abschnitten, genau der Fehler, gegen den `by_entity`
gebaut wurde).

- [ ] **Schritt 6: `ASSET_VERSION` bumpen**

`js/territory/territory-editor-inline-host.js:24` — `const ASSET_VERSION = "20260909a";`
Ohne den Bump serviert der Browser dem Territoriums-Editor die alte `review-feature-sources.js`,
und dort bliebe der Fehler stehen.

- [ ] **Schritt 7: Commit**

```bash
git add js/review/review-feature-sources.js js/review/review-garetien-importer.js js/territory/territory-editor-inline-host.js js/review/__tests__/kanon-nachtrag-tafel.test.js && git commit -F- <<'MSG'
fix(quellen): der Nachtrag schreibt beide Tafeln -- ein frisch bequelltes Objekt sagt nicht mehr "offiziell"

Owner-Meldung 09.09.2026 mit Bild (Landschaft "Schwanenbruch"): Kopf OFFIZIELL, einzige Quelle
darunter INOFFIZIELL | Briefspiel. syncFeatureSourcesToClientCache schrieb nur die Verweise;
resolveFeatureKanon liest "Verweise da + keine Abweichung" als Vorgabe "offiziell".

Der Nachtrag markiert seine Schluessel zusaetzlich -- daran haengt der Riegel in popups.js.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: Der Riegel — ein nachgetragener Schlüssel kann kein falsches Etikett mehr behaupten

**Das ist die Antwort auf „damit es nicht wieder passieren kann".** Tasks 2–4 machen die Anzeige
richtig; diese Aufgabe macht es unmöglich, sie auf dieselbe Weise wieder falsch zu machen. Danach
gilt: ein Verweis, den irgendein Nachtragsweg in den Kartenspeicher schreibt, kann aus der Vorgabe
**kein** „offiziell" mehr erzeugen. Wer künftig einen vierten Nachtragsweg baut und das Etikett
vergisst, bekommt „kein Etikett" — die sichere Richtung, strukturell statt per Vereinbarung.

**Files:**
- Modify: `js/ui/popups.js` (`resolveFeatureKanon`, Zeile 225–241)
- Test: `js/ui/__tests__/kanon-nachgetragen-riegel.test.js` (neu)

**Interfaces:**
- Consumes: `window.__featureSourceRefsNachgetragen` (Task 4)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/ui/__tests__/kanon-nachgetragen-riegel.test.js`:

```js
"use strict";

// DER RIEGEL: die Vorgabe „offiziell" gilt nicht fuer einen NACHGETRAGENEN Verweis.
//
// 🚩 Owner-Meldung 09.09.2026 mit Bild: die Landschaft „Schwanenbruch" trug am Kopf OFFIZIELL,
// waehrend darunter ihre einzige Quelle als „INOFFIZIELL │ Briefspiel" stand. Ursache war nicht die
// Ableitung -- die war richtig --, sondern dass der Client-Nachtrag die Verweise schreibt und die
// Kanon-Tafel nicht, und dass ein FEHLENDER Tafeleintrag „offiziell" bedeutet.
//
// 🔴 Dieser Test sichert die Eigenschaft, die den Fehler unwiederholbar macht: Verweise ohne
// ausdrueckliches Etikett ergeben KEIN Etikett, sobald sie nachgetragen sind. Er darf nie
// „aufgeraeumt" werden, weil er scheinbar dasselbe prueft wie kanon-ohne-etikett.test.js -- jener
// prueft die NUTZLAST, dieser den NACHTRAG.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "..", "popups.js"), "utf8");

// Die Funktion ausschneiden und AUSFUEHREN -- ein Regex ueber den Quelltext kennt keinen
// Geltungsbereich, und genau daran ist am 03.09.2026 eine Regression zwei Stunden live geblieben.
const start = quelle.indexOf("function resolveFeatureKanon");
assert.ok(start > 0, "resolveFeatureKanon ist auffindbar");
const rumpf = quelle.slice(start);
// Zeilenendenneutral schneiden: hier CRLF, in der CI LF (AGENTS.md §9).
const ende = rumpf.search(/\n\}/);
assert.ok(ende > 0, "das Funktionsende ist auffindbar");
const code = rumpf.slice(0, ende + 2);

function fahre(fensterZustand) {
  const kontext = { window: fensterZustand, module: { exports: {} } };
  vm.createContext(kontext);
  vm.runInContext(code + "\nmodule.exports = resolveFeatureKanon;", kontext);
  return kontext.module.exports;
}

const refs = { "ecosystem:eco-A": [{ source_id: 1 }] };
const kanon = { vorgabe: "offiziell", abweichungen: {} };

// --- A: OHNE Marke gilt die Vorgabe weiter -- das ist der Zustand der Kartennutzlast ------------
let loeser = fahre({ __featureKanon: kanon, __featureSourceRefs: refs });
assert.deepStrictEqual(loeser("ecosystem", "eco-A"), { kanon: "offiziell" },
  "A: ein Verweis AUS DER NUTZLAST folgt weiter der Vorgabe -- daran haengen rund 5000 Objekte, "
  + "die deshalb keinen eigenen Eintrag brauchen");

// --- B: MIT Marke und OHNE Eintrag gibt es KEIN Etikett -----------------------------------------
loeser = fahre({
  __featureKanon: kanon,
  __featureSourceRefs: refs,
  __featureSourceRefsNachgetragen: { "ecosystem:eco-A": true },
});
assert.strictEqual(loeser("ecosystem", "eco-A"), null,
  "B: DER RIEGEL -- ein nachgetragener Verweis ohne ausdrueckliches Etikett bekommt keins. "
  + "Ein kuenftiger Nachtragsweg, der das Etikett vergisst, zeigt damit nichts statt etwas Falsches");

// --- C: MIT Marke UND Eintrag gilt der Eintrag ---------------------------------------------------
loeser = fahre({
  __featureKanon: { vorgabe: "offiziell", abweichungen: { "ecosystem:eco-A": { kanon: "inoffiziell", bezeichner_type: "briefspiel" } } },
  __featureSourceRefs: refs,
  __featureSourceRefsNachgetragen: { "ecosystem:eco-A": true },
});
assert.deepStrictEqual(loeser("ecosystem", "eco-A"), { kanon: "inoffiziell", bezeichner_type: "briefspiel" },
  "C: der ausdrueckliche Eintrag schlaegt den Riegel -- sonst waere Task 4 wirkungslos");

// --- D: ein nachgetragenes OFFIZIELLES Objekt behaelt sein Etikett -------------------------------
loeser = fahre({
  __featureKanon: { vorgabe: "offiziell", abweichungen: { "settlement:ort-D": { kanon: "offiziell" } } },
  __featureSourceRefs: { "settlement:ort-D": [{ source_id: 2 }] },
  __featureSourceRefsNachgetragen: { "settlement:ort-D": true },
});
assert.deepStrictEqual(loeser("settlement", "ort-D"), { kanon: "offiziell" },
  "D: „offiziell" muss AUSDRUECKLICH mitreisen, sobald ein Schluessel markiert ist -- deshalb "
  + "liefert der Server es mit, statt sich auf die Vorgabe zu verlassen");

// --- E: ohne Verweise weiterhin kein Etikett ----------------------------------------------------
loeser = fahre({ __featureKanon: kanon, __featureSourceRefs: {}, __featureSourceRefsNachgetragen: {} });
assert.strictEqual(loeser("ecosystem", "eco-X"), null, "E: unbelegt bleibt unbeschriftet");

// --- F: die WAECHTERPRUEFUNG -- es gibt genau EINEN Schreiber der Verweistafel -------------------
// 💣 Der Riegel wirkt nur, solange jeder Schreiber von __featureSourceRefs auch die Marke setzt.
// Ein zweiter Schreiber anderswo umginge ihn lautlos -- und genau so ist der Fehler entstanden:
// ein neuer LESER (das Kanon-Etikett, 01.09.2026) kam an eine Tafel, deren Schreiber niemand
// inventarisiert hatte.
function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const wurzel = path.join(__dirname, "..", "..", "..");
const schreiber = [];
(function suche(verzeichnis) {
  for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const p = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      if (eintrag.name === "__tests__" || eintrag.name === "third-party" || eintrag.name === "node_modules") { continue; }
      suche(p);
    } else if (eintrag.name.endsWith(".js")) {
      const text = ohneKommentare(fs.readFileSync(p, "utf8"));
      // Eine ZUWEISUNG in die Tafel, nicht ein Lesen daraus.
      if (/__featureSourceRefs\s*(\[[^\]]*\]\s*)?=[^=]/.test(text)) {
        schreiber.push(path.relative(wurzel, p).replace(/\\/g, "/"));
      }
    }
  }
})(path.join(wurzel, "js"));

assert.deepStrictEqual(schreiber.sort(), ["js/review/review-feature-sources.js", "js/routing/routing.js"],
  "F: genau ZWEI Schreiber -- routing.js legt die Tafel beim Laden der Nutzlast an, "
  + "review-feature-sources.js traegt nach und setzt dabei die Marke. Ein dritter Schreiber "
  + "umginge den Riegel: er gehoert durch syncFeatureSourcesToClientCache. Gefunden: " + schreiber.join(", "));

console.log("kanon-nachgetragen-riegel: OK");
```

- [ ] **Schritt 2: Test fahren, Fehlschlag bestätigen**

```bash
node js/ui/__tests__/kanon-nachgetragen-riegel.test.js
```

Erwartet: FAIL bei B („DER RIEGEL") — heute gibt die Funktion dort `{kanon:"offiziell"}` zurück.

- [ ] **Schritt 3: Den Riegel schreiben**

In `js/ui/popups.js`, in `resolveFeatureKanon` — zwischen dem `abweichung`-Zweig und dem
Vorgabe-Rückfall:

```js
	const abweichung = kanon.abweichungen && kanon.abweichungen[key];
	if (abweichung) {
		return abweichung;
	}
	const refs = refsMap && refsMap[key];
	if (!Array.isArray(refs) || refs.length === 0) {
		return null; // unbelegt -- die Vorgabe gilt fuer dieses Objekt nicht
	}
	// 💣 UND SIE GILT AUCH NICHT FUER EINEN NACHGETRAGENEN VERWEIS.
	//
	// 🚩 Owner-Meldung 09.09.2026 mit Bild: die Landschaft „Schwanenbruch" trug am Kopf OFFIZIELL,
	// waehrend darunter ihre einzige Quelle als „INOFFIZIELL │ Briefspiel" stand. Der Grund war
	// nicht die Ableitung -- die war richtig --, sondern diese Zeile: syncFeatureSourcesToClientCache
	// traegt nach einer Schreibaktion Verweise in die Tafel nach, und ein FEHLENDER Kanon-Eintrag
	// hiess hier „offiziell". Ein frisch bequelltes Objekt kippte damit auf OFFIZIELL -- am
	// schlimmsten genau dann, wenn die eingetragene Quelle INOFFIZIELL ist.
	//
	// 🔴 DER NACHTRAG LIEFERT SEIT DEM 09.09.2026 DAS ETIKETT MIT, und dann greift der Zweig oben.
	// Diese Zeile ist der Riegel FUER DEN FALL, DASS ER ES EINMAL NICHT TUT: „kein Etikett" statt
	// eines falschen. Sie ist der Grund, warum derselbe Fehler nicht ein zweites Mal entstehen
	// kann -- ein kuenftiger vierter Nachtragsweg erbt sie, ohne davon zu wissen.
	//
	// ⚠️ Die Vorgabe bleibt fuer alles gueltig, was aus der NUTZLAST kommt (dort haengen rund 5000
	// Objekte daran, die deshalb keinen eigenen Eintrag brauchen). Der Unterschied ist die Herkunft
	// des Verweises, nicht sein Inhalt.
	const nachgetragen = typeof window !== "undefined" ? window.__featureSourceRefsNachgetragen : null;
	if (nachgetragen && nachgetragen[key]) {
		return null;
	}
	return kanon.vorgabe ? { kanon: kanon.vorgabe } : null;
```

- [ ] **Schritt 4: Test fahren, grün bestätigen**

```bash
node js/ui/__tests__/kanon-nachgetragen-riegel.test.js
```

Erwartet: `kanon-nachgetragen-riegel: OK`

- [ ] **Schritt 5: Mutationsprobe — drei Mutationen, alle müssen gefangen werden**

Jede einzeln einbauen, Test fahren, Rot bestätigen, zurücknehmen:

1. `if (nachgetragen && nachgetragen[key])` → `if (false)` → B muss rot werden.
2. `return null;` im Riegel → `return kanon.vorgabe ? { kanon: kanon.vorgabe } : null;` → B rot.
3. In `review-feature-sources.js` die Zeile `ziel.__featureSourceRefsNachgetragen[schluessel] = true;`
   löschen → `kanon-nachtrag-tafel.test.js` Fall D rot.

Bleibt eine davon grün, prüft der Test nicht, was er behauptet.

- [ ] **Schritt 6: Commit**

```bash
git add js/ui/popups.js js/ui/__tests__/kanon-nachgetragen-riegel.test.js && git commit -F- <<'MSG'
fix(karte): die Vorgabe "offiziell" gilt nicht mehr fuer einen nachgetragenen Verweis

Der Riegel hinter der Reparatur: ein Verweis, den ein Nachtragsweg in den Kartenspeicher schreibt,
kann aus der Vorgabe kein "offiziell" mehr erzeugen. Liefert der Weg sein Etikett mit, gilt das
Etikett; tut er es nicht, gibt es keins statt eines falschen.

Damit ist der gemeldete Fehler nicht nur behoben, sondern auf demselben Weg nicht wiederholbar --
auch nicht von einem kuenftigen vierten Nachtragsweg, der davon nichts weiss.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: Abnahme am echten Ablauf

**Kein Maß, sondern Ablauf** (AGENTS.md §9): die Prüfseite, die Rechtecke misst, belegt nichts.
Abgenommen wird an den Handgriffen, die der Owner gemeldet hat.

**Files:** keine — diese Aufgabe misst.

- [ ] **Schritt 1: Das GANZE Testfeld, mit den Mustern des Workflows, parallel**

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > /tmp/rot-js.txt; cat /tmp/rot-js.txt
```

```bash
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > /tmp/rot-php.txt; cat /tmp/rot-php.txt
```

- [ ] **Schritt 2: Die Dateizahl gegenzählen — ein unerwartet grüner Lauf wird nicht geglaubt**

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
```

Erwartet: mindestens 473 (JS) und 377 (PHP) — die Zahlen wachsen mit jedem Test, maßgeblich ist,
dass sie nicht plötzlich klein sind. Eine viel zu kleine Zahl ist der einzige Unterschied zwischen
diesem Fehler und einem grünen Feld (AGENTS.md §9). Vorbestehend rot bleibt
`linkcheck/link-url-test.php` (echter DNS-Abruf).

- [ ] **Schritt 3: Vor dem Push die Warteschlange lesen**

```bash
gh run list --limit 3
```

Ein `in_progress` **und** ein `pending` heißen warten — auch der Lauf einer anderen Sitzung
(AGENTS.md §9, der abgebrochene wartende Lauf).

- [ ] **Schritt 4: Push und Deploy abwarten**

```bash
git push origin master && git log -1 --format=%H origin/master
```

Danach ~1–2 min warten und die Remote-SHA prüfen.

- [ ] **Schritt 5: Der Ablauf im Browser, als BESUCHER (kein `edit=1`)**

Die Live-Seite laden, Konsole lesen (AGENTS.md §11: nach jedem Push, der die Karte berührt), und
an der gemeldeten Fläche gegenmessen:

```js
window.renderFeatureKanonBadge('ecosystem', 'd32b9090-5b87-4037-9d45-c16fa90933b2')
```

Erwartet: „Inoffiziell │ Briefspiel", keine Konsolenfehler.

Und den Riegel am selben Objekt prüfen:

```js
window.__featureSourceRefsNachgetragen = { 'ecosystem:d32b9090-5b87-4037-9d45-c16fa90933b2': true };
const sicher = window.__featureKanon.abweichungen['ecosystem:d32b9090-5b87-4037-9d45-c16fa90933b2'];
delete window.__featureKanon.abweichungen['ecosystem:d32b9090-5b87-4037-9d45-c16fa90933b2'];
const r = window.renderFeatureKanonBadge('ecosystem', 'd32b9090-5b87-4037-9d45-c16fa90933b2');
window.__featureKanon.abweichungen['ecosystem:d32b9090-5b87-4037-9d45-c16fa90933b2'] = sicher;
delete window.__featureSourceRefsNachgetragen;
r;   // erwartet: "" -- vor der Reparatur stand hier "Offiziell"
```

- [ ] **Schritt 6: 🔧 DU (Owner): der Handgriff mit angemeldeter Sitzung**

Der Teil, den keine Messung von hier ersetzen kann — er braucht Login und Schreibrecht:

1. Im Editor eine Landschaftsfläche **ohne** Quelle öffnen → Kopf trägt kein Etikett.
2. Im Kasten „Quellen" eine **inoffizielle** Quelle eintragen (z. B. eine garetien.de-Adresse).
3. **Ohne** F5: der Kopf muss sofort „INOFFIZIELL │ Briefspiel" zeigen — nicht „OFFIZIELL",
   und auch nicht nichts.
4. Dieselbe Quelle wieder entfernen → das Etikett verschwindet, ohne F5.
5. Einen Garetien-Import mit mindestens einem neuen Objekt fahren → dessen Infobox zeigt
   sofort das richtige Etikett.
6. Ein Objekt **mit** Wiki-Zuweisung im Hauptraum bequellen → es bleibt „OFFIZIELL"
   (die Zuweisung schlägt die Quelle — hier würde ein Fehler in Task 1 sichtbar).

- [ ] **Schritt 7: Den Befund in AGENTS.md §11 nachtragen**

Ein Absatz im Abschnitt „Das Kanon-Etikett folgt der WIKI-ZUWEISUNG": dass der Nachtrag beide
Tafeln schreibt, dass ein nachgetragener Verweis die Vorgabe nicht mehr auslöst, und **warum** —
mit dem Datum und dem gemeldeten Fall. Keine Zahl, die eine Liste bemisst.

---

## Selbstprüfung des Plans

**Deckung:** Der gemeldete Fehler wird von Task 4 (richtig anzeigen) und Task 5 (nicht wiederholbar)
gedeckt; Tasks 1–3 liefern, was Task 4 dafür braucht. Task 6 nimmt ab.

**Reihenfolge:** 1 → 2 → 3 → 4 → 5. Task 4 ist ohne 2 und 3 funktionslos (es käme kein Wörterbuch
an), aber nicht schädlich — der Riegel aus Task 5 macht daraus „kein Etikett", nie ein falsches.
Task 5 allein hinter Task 4 zu schieben wäre ebenfalls gültig; zusammen ist es dicht.

**Typen:** `kanon_je_kennung` (Server) → fünfter Parameter `kanonJeKennung` (Client) →
`__featureKanon.abweichungen[<typ>:<id>]`. Der Garetien-Weg liefert `kanon` je Eintrag und wird im
Durchreicher in dieselbe Wörterbuchform gebracht. `null` heißt überall „kein Etikett" und löscht.

**Bewusst nicht enthalten:** die 446 Landschaftsflächen ohne Kanon-Eintrag; die Frage, ob
`avesmapsFeatureSourcesKanonLeerEintraege` `ecosystem` weiter ausnimmt (ihr Kommentar sagt, der
Kanon-Leser kenne Landschaften nicht — gemessen tragen 40 `ecosystem`-Schlüssel sehr wohl einen
abgeleiteten Eintrag). Das ist ein eigener Befund und eine Owner-Entscheidung.

---

## Ausgeführt am 09.09.2026 — was abwich

Alle sechs Aufgaben sind gebaut und live (`266acfe90` … `8050e2ef1`). Drei Dinge liefen anders als
geplant, jedes aus einer Messung:

1. **Der Rechner ist in KERN und TÜR geschnitten**, nicht nur gebündelt. Der geplante SQLite-Test
   hätte **nichts** geprüft: `avesmapsLoadFeatureSourceRefs` und `…Catalog` tragen beide
   `COLLATE utf8mb4_unicode_ci` und geben auf SQLite still `[]` zurück (gemessen, bevor der Test
   geschrieben war). `avesmapsFeatureSourcesKanonAusEingaben` ist deshalb rein und wird wirklich
   gefahren.
2. **Die Semantik `['kanon' => '']` gegen `null` blieb erhalten.** Der Plan wollte für „Publikation,
   also kein Kanon" ein `null`; der bestehende Einzelweg liefert dort seit dem 02.09. den
   ausdrücklichen Leer-Eintrag, und ihn zu vereinfachen hätte die Wiki-Zuweisung mitgebrochen.
3. **Der Namensraum-Leser kam dazu** (`avesmapsFeatureSourcesWikiNamespacesFuerKennungen`) — ohne
   ihn verlöre ein zugewiesenes Objekt sein „offiziell", sobald jemand ihm eine inoffizielle Quelle
   einträgt.

**Zwei Fallen beim Bau**, beide in AGENTS.md §11 nachgetragen: die vm-Prototyp-Falle
(`deepStrictEqual` gegen ein Objekt aus einem `vm`-Kontext) und ein fremder Test, der den Wortlaut
„ruft `DeriveKanon`" festnagelte und damit eine Umbauform verbot, die seine Absicht strenger erfüllt.

**Gemessen:** 12 von 13 anwendbaren Mutationen gefangen (die dreizehnte ist nachweislich neutral);
Testfeld 521 JS + 405 PHP, ein vorbestehend roter (`linkcheck/link-url-test.php`, echter DNS-Abruf).
Live als Besucher gegengemessen: Normalfall „Inoffiziell │ Briefspiel", nachgetragen ohne Etikett
„(kein Etikett)" — vorher „Offiziell" —, Nutzlast-Weg unverändert „Offiziell", Konsole fehlerfrei.

🔧 **Offen bleibt Schritt 6 der Abnahme:** die sechs Handgriffe mit angemeldeter Sitzung.
