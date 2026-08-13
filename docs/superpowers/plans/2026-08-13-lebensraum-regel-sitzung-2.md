# Lebensraum-Regel — Sitzung 2: der Regeleditor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Editor kann im Vorkommen-Fenster eine Lebensraum-Regel anlegen, sehen was sie trifft, sie speichern und wieder löschen — und der Zugehörigkeits-Lauf liefert endlich die Siedlungszeilen, ohne die jede Regel „0 Siedlungen" meldet.

**Architecture:** Die Serverhälfte steht seit Sitzung 1. Diese Sitzung schließt drei Lücken darin (Regeln zurücklesen, Vorschau deckeln, Protokollzeile), ergänzt den Client-Teil des Zugehörigkeits-Laufs in der eigenständigen Seite `html/landschaften-editor.html` und baut dann die Oberfläche im Vorkommen-Fenster nach `docs/vorkommen-regeleditor-mockup.html`.

**Tech Stack:** PHP 8 strict types + PDO/MySQL serverseitig; clientseitig gewachsenes Vanilla-JS ohne Bauschritt (Markup als Zeichenketten), jQuery-UI-Autocomplete, CSS-Token aus `css/base/tokens.css`.

**Entwurf:** `docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md` (§10a nennt den Stand und die Mitnahmen)
**Mockup:** `docs/vorkommen-regeleditor-mockup.html` — es rechnet mit echtem Bestand und ist die Abnahmevorlage
**Sitzung 1:** `docs/superpowers/plans/2026-08-12-lebensraum-regel-sitzung-1.md` (💣 mit der Tabelle ihrer fünf Planfehler am Kopf)

## Was Sitzung 1 hinterlassen hat

| Baustein | Wo | Zusicherung |
|---|---|---|
| `avesmapsLoreRuleEvaluate($terms, $areas, $places, $orderedZoneKeys)` | `api/_internal/app/lore-rule.php` | rein; `['areas' => list<string>, 'places' => list<string>]`, public_ids in Eingabereihenfolge |
| `avesmapsLoreRuleChainIsUnbounded($terms)` | dieselbe Datei | rein; `true`, wenn die Kette leer ist **oder irgendeine Bedingung** nichts einschränkt |
| `avesmapsLoreRuleSave / …Delete / …ReadForEntry` | `api/_internal/app/lore-rule-store.php` | transaktional; Eintragsschlüssel ist bei Save und Delete Pflicht |
| `avesmapsLoreRuleReadAreas / …ReadPlaces / …OrderedZoneKeys` | dieselbe Datei | liefern `[]` statt Ausnahme, wenn Tabellen fehlen |
| `preview_rule` · `save_rule` · `delete_rule` | `api/edit/map/lore.php` | hinter `avesmapsRequireUserWithCapability('edit')`; `preview_rule` schreibt nichts |
| `location_ecosystem` | `api/_internal/app/ecosystem.php` | Tabelle existiert scharf, wird vom Lauf geleert — **aber noch von niemandem gefüllt** |

Eine Bedingung hat überall diese Form:

```
['join_op' => 'und'|'oder', 'area_public_id' => ?string,
 'climate_from' => ?string, 'climate_to' => ?string,
 'types' => list<array{kind: string, region_type: string}>]
```

**Scharf abgenommen am 13.08.2026:** ein angemeldeter `preview_rule` mit „Wald + boreal…gemäßigt" liefert **50 Flächen** und **0 Siedlungen**. Die 50 stimmen mit der Offline-Nachrechnung überein; die 0 ist richtig, solange `location_ecosystem` leer ist. Task 4 macht daraus eine echte Zahl.

## Global Constraints

- **Sichtbare Änderungen gehen EINZELN live, und der Owner sieht jede** (AGENTS.md §9). Tasks 1–3 sind unsichtbar und dürfen zusammen raus. **Task 4 ist im Landschaften-Editor sichtbar, Tasks 5–7 im Vorkommen-Fenster** — jeder dieser beiden Blöcke geht für sich, mit Blick des Owners dazwischen.
- **Abnahme heißt ABLAUF, nicht Maß** (AGENTS.md §9). Vor „fertig" werden die echten Handgriffe ausgeführt und benannt: die Regel anlegen, eine Art suchen, das Band ziehen, speichern, neu laden, wiedersehen, löschen.
- **Nie eine Farbe, einen Radius oder einen Trenner hartkodieren** — immer ein Token aus `css/base/tokens.css` (AGENTS.md §12). Fehlt ein Wert, erst den Token anlegen.
- **Eine Zeilenhandlung ist nie die Haupthandlung der Seite** (AGENTS.md §12): in einer Liste alles weich/outline (`--color-button-soft*`), gefüllt (`--color-button`) nur die eine Haupthandlung des Fensters.
- **Kein DDL und keine `information_schema`-Sonde auf einem heißen Lesepfad** (AGENTS.md §10, Vorfall 17.07.2026).
- **Kein JS-seitiges Überschreiben von Aussehen** — was aussieht, gehört ins CSS.
- **Deutsch bleibt Deutsch** an der Oberfläche; Kommentare, Commit-Texte und `error.code`-Werte englisch oder wie in der Nachbardatei üblich.
- **Tests:** JS nackt (`node <datei>.test.js`), PHP mit `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll <datei>`. Ohne `zend.assertions=1` ist `assert()` ein No-Op.
- **Vor jedem Push das GANZE Testfeld**, nicht nur die eigenen Tests. Ein roter Test lädt nichts hoch — und der Fehlschlag vergiftet danach den `?v=`-Stempel.
- **Geteilter Arbeitsbaum:** nie `git add -A`, `git add .`, `git commit -a`. Nur eigene Pfade, explizit.

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `api/edit/map/lore.php` | drei Aktionen ergänzen/ändern: `list_rules`, Deckel in `preview_rule`, Protokollzeile | 1–3 |
| `api/_internal/app/lore-rule-store.php` | Lesen aller Regeln eines Eintrags samt Namen der genannten Flächen | 1 |
| `api/_internal/app/__tests__/lore-rule-store-test.php` | dazu die Tests | 1 |
| `html/landschaften-editor.html` | Orte laden, Punkt-in-Fläche rechnen, als `location`-Zeilen senden; `location_rows` in der Kachel | 4 |
| `js/map-features/map-features-point-in-polygon.js` | vorhanden, wird nur eingebunden — **nicht ändern** | 4 |
| `js/review/review-lore-rule.js` (neu) | der ganze Regeleditor: Zustand, Markup, Autocomplete, Vorschau | 5–7 |
| `js/review/__tests__/lore-rule-ui.test.js` (neu) | die reinen Teile davon (Satzbau, Suchschlüssel, Zustandsübergänge) | 5–7 |
| `css/features/lore.css` | die Stile der Regelkarte und des Regeleditors | 5–7 |
| `js/review/review-wiki-sync.js` | die Regelkarte in die Ortsliste einhängen, „+ Regel" | 5 |
| `index.html` | das neue Skript einhängen | 5 |

💣 **`js/review/review-wiki-sync.js` ist bereits sehr groß.** Der Regeleditor kommt deshalb in eine **eigene** Datei und wird von dort nur aufgerufen. In `review-wiki-sync.js` ändern sich nur zwei Stellen: der Knopf „+ Regel" und die Stelle, an der die Ortsliste gebaut wird.

---

### Task 1: Regeln zurücklesen

Ohne das kann der Editor eine gespeicherte Regel nicht anzeigen — es ist die Sperre vor allem anderen.

**Files:**
- Modify: `api/_internal/app/lore-rule-store.php` (ans Ende)
- Modify: `api/edit/map/lore.php` (Kopfkommentar + ein `case` vor `default:`)
- Test: `api/_internal/app/__tests__/lore-rule-store-test.php` (vor der `echo`-Zeile)

**Interfaces:**
- Consumes: `avesmapsLoreRuleReadForEntry(PDO $pdo, string $entryWikiKey): array` → `list<array{id: int, relation: string, terms: list<array>}>` (aus Sitzung 1).
- Produces: `avesmapsLoreRuleReadForEntryWithNames(PDO $pdo, string $entryWikiKey): array` — dasselbe, aber jede Bedingung trägt zusätzlich `area_name` (der Name der unter `area_public_id` genannten Fläche, `''` wenn keine oder unbekannt). Produces außerdem die Endpunkt-Aktion `POST { action: "list_rules", wiki_key }` → `{ ok: true, rules: [...] }`.

- [ ] **Step 1: Write the failing test**

Ans Ende von `api/_internal/app/__tests__/lore-rule-store-test.php`, **vor** die `echo`-Zeile:

```php
// Der Editor zeigt „Farindelwald", nicht eine public_id. Der Name kommt beim Lesen dazu,
// damit die Oberflaeche nicht je Bedingung einen zweiten Abruf machen muss.
$pdo->exec("INSERT INTO ecosystem_region (id, public_id, name, kind, region_type, is_active)
            VALUES (901, 'area-farindel-2', 'Farindelwald', 'vegetation', 'wald', 1)");
$named = avesmapsLoreRuleSave($pdo, 'namenstest', [
    ['join_op' => 'und', 'area_public_id' => 'area-farindel-2',
     'climate_from' => null, 'climate_to' => null, 'types' => []],
    ['join_op' => 'oder', 'area_public_id' => null,
     'climate_from' => null, 'climate_to' => null,
     'types' => [['kind' => 'vegetation', 'region_type' => 'wald']]],
], 'verbreitung', 7);

$withNames = avesmapsLoreRuleReadForEntryWithNames($pdo, 'namenstest');
assert(count($withNames) === 1);
assert($withNames[0]['id'] === $named);
assert($withNames[0]['terms'][0]['area_name'] === 'Farindelwald');
// 💣 Eine Bedingung OHNE Flaeche bekommt einen leeren Namen, nie den der Nachbarbedingung --
// genau das passiert, wenn man die Namen ueber den Index statt ueber den Schluessel zuordnet.
assert($withNames[0]['terms'][1]['area_name'] === '');
// Und die uebrigen Felder bleiben unangetastet, die Oberflaeche baut daraus die Kette.
assert($withNames[0]['terms'][1]['types'][0]['region_type'] === 'wald');
assert($withNames[0]['terms'][1]['join_op'] === 'oder');

// Eine geloeschte Flaeche laesst die Regel stehen und den Namen leer -- nicht die Regel
// verschwinden. Sie ist eine Aussage des Editors, kein Verweis, der mitstirbt.
$pdo->exec("UPDATE ecosystem_region SET is_active = 0 WHERE id = 901");
$after = avesmapsLoreRuleReadForEntryWithNames($pdo, 'namenstest');
assert(count($after) === 1 && $after[0]['terms'][0]['area_public_id'] === 'area-farindel-2');
assert($after[0]['terms'][0]['area_name'] === '');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-store-test.php`
Expected: FAIL — `Call to undefined function avesmapsLoreRuleReadForEntryWithNames()`

- [ ] **Step 3: Write minimal implementation**

Ans Ende von `api/_internal/app/lore-rule-store.php`:

```php
/**
 * Wie avesmapsLoreRuleReadForEntry, aber jede Bedingung traegt den NAMEN ihrer Flaeche.
 *
 * Wozu: der Editor zeigt „Farindelwald", nicht eine public_id. Der Name hier dazuzulegen kostet
 * EINE zusaetzliche Abfrage fuer die ganze Antwort -- ihn in der Oberflaeche je Bedingung
 * nachzuschlagen waere ein Abruf je Zeile.
 *
 * ⚠️ Eine geloeschte oder deaktivierte Flaeche laesst die Bedingung STEHEN und den Namen leer.
 * Die Regel ist eine Aussage des Editors, kein Verweis, der mitstirbt; sie verschwinden zu
 * lassen waere stiller Datenverlust.
 *
 * @return list<array{id: int, relation: string, terms: list<array<string,mixed>>}>
 */
function avesmapsLoreRuleReadForEntryWithNames(PDO $pdo, string $entryWikiKey): array
{
    $rules = avesmapsLoreRuleReadForEntry($pdo, $entryWikiKey);
    if ($rules === []) {
        return [];
    }

    $wanted = [];
    foreach ($rules as $rule) {
        foreach ($rule['terms'] as $term) {
            $areaId = $term['area_public_id'] ?? null;
            if ($areaId !== null && $areaId !== '') {
                $wanted[$areaId] = true;
            }
        }
    }

    $names = [];
    if ($wanted !== []) {
        try {
            $keys = array_keys($wanted);
            $placeholders = implode(',', array_fill(0, count($keys), '?'));
            $statement = $pdo->prepare(
                'SELECT public_id, name FROM ecosystem_region
                  WHERE is_active = 1 AND public_id IN (' . $placeholders . ')'
            );
            $statement->execute($keys);
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $names[(string) $row['public_id']] = (string) ($row['name'] ?? '');
            }
        } catch (Throwable) {
            // Oekosystem-Tabellen fehlen -> keine Namen, aber die Regeln bleiben lesbar.
        }
    }

    foreach ($rules as $ruleIndex => $rule) {
        foreach ($rule['terms'] as $termIndex => $term) {
            $areaId = (string) ($term['area_public_id'] ?? '');
            // 💣 Ueber den SCHLUESSEL zuordnen, nie ueber den Index: eine Bedingung ohne Flaeche
            // bekaeme sonst den Namen ihrer Nachbarin.
            $rules[$ruleIndex]['terms'][$termIndex]['area_name'] = $names[$areaId] ?? '';
        }
    }

    return $rules;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/lore-rule-store-test.php`
Expected: `lore-rule-store: OK`

- [ ] **Step 5: Prove the test bites**

Führe diese Mutationen einzeln aus, jeweils Test laufen lassen, Datei wiederherstellen. **Jede muss ROT sein:**
- Die Namen über den Index statt über den Schlüssel zuordnen (`array_values($names)[$termIndex] ?? ''`).
- `AND is_active = 1` aus der Namensabfrage entfernen (der Test mit der deaktivierten Fläche muss anschlagen).

Bleibt eine grün, fehlt ein Testfall — ergänze ihn.

- [ ] **Step 6: Die Endpunkt-Aktion**

In `api/edit/map/lore.php`, in den Kopfkommentar zu den anderen Regel-Aktionen:

```php
// POST { action: "list_rules",   wiki_key }                       -> alle Regeln des Eintrags
```

und vor `default:` im `switch`:

```php
        case 'list_rules': {
            // Lesen, also KEIN avesmapsLoreRuleEnsureTables -- fehlen die Tabellen, gibt es
            // schlicht keine Regeln. Ein DDL im Lesezweig waere die Last aus AGENTS.md §10.
            avesmapsJsonResponse(200, [
                'ok' => true,
                'rules' => avesmapsLoreRuleReadForEntryWithNames($pdo, $wikiKey),
            ]);
            break;
        }
```

⚠️ `avesmapsLoreRuleReadForEntry` fängt fehlende Tabellen **nicht** selbst ab (Sitzung 1 baute sie hinter `EnsureTables`). Prüfe das in der Datei nach: wirft sie bei fehlender Tabelle, dann umschließe den Rumpf von `avesmapsLoreRuleReadForEntryWithNames` mit `try { … } catch (Throwable) { return []; }` und ergänze im Test einen Fall auf einer frischen Datenbank ohne `avesmapsLoreRuleEnsureTables`.

- [ ] **Step 7: Run the whole test field and commit**

```bash
php -l api/edit/map/lore.php
EXT="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll"
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 $EXT "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add api/_internal/app/lore-rule-store.php api/_internal/app/__tests__/lore-rule-store-test.php api/edit/map/lore.php
git commit -m "feat(vorkommen): gespeicherte Regeln zuruecklesen, mit Flaechennamen"
```

---

### Task 2: Die Vorschau deckeln

Heute antwortet `preview_rule` mit **jedem** Treffer namentlich — eine großzügige Regel liefert 777 Flächen und bis zu ~2.800 Siedlungen in einem JSON. Der Abschluss-Review von Sitzung 1 hat das als Sitzung-2-Arbeit zurückgestellt.

**Files:**
- Modify: `api/edit/map/lore.php` (Konstanten oben, `preview_rule`)
- Test: keiner — die Änderung ist eine Kappung in der Antwortformung und wird in Task 7 an der Oberfläche abgenommen. ⚠️ Das ist eine bewusste Ausnahme; sag es im Bericht, statt einen Test zu behaupten.

**Interfaces:**
- Consumes: `avesmapsLoreRuleEvaluate` (Sitzung 1).
- Produces: `preview_rule` antwortet unverändert mit `ok`, `areas`, `places`, `counts` — aber `areas` und `places` sind auf `AVESMAPS_LORE_RULE_PREVIEW_SAMPLE` Einträge gekappt, während `counts` die **vollen** Zahlen trägt.

- [ ] **Step 1: Die Konstante**

Zu den Konstanten oben in `api/edit/map/lore.php` (neben `AVESMAPS_LORE_RULE_MAX_TERMS`):

```php
/**
 * Wie viele Namen die Vorschau je Liste mitschickt.
 *
 * 💣 Die ZAHL in `counts` bleibt vollstaendig, gekappt wird nur die Namensliste. Eine gekappte
 * Zahl waere eine Luege ueber die Reichweite der Regel -- und genau die Reichweite ist der
 * Riegel, den der Editor vor dem Speichern sehen soll.
 */
const AVESMAPS_LORE_RULE_PREVIEW_SAMPLE = 120;
```

- [ ] **Step 2: Die Kappung**

In `preview_rule`, dort wo `$named(...)` die beiden Listen baut, die Ergebnis-Schlüssellisten vorher kappen — die `counts` **vor** der Kappung aus den ungekappten Listen bilden:

```php
            $counts = ['areas' => count($result['areas']), 'places' => count($result['places'])];
            avesmapsJsonResponse(200, [
                'ok' => true,
                'areas' => $named($areas, array_slice($result['areas'], 0, AVESMAPS_LORE_RULE_PREVIEW_SAMPLE)),
                'places' => $named($places, array_slice($result['places'], 0, AVESMAPS_LORE_RULE_PREVIEW_SAMPLE)),
                'counts' => $counts,
                'sample' => AVESMAPS_LORE_RULE_PREVIEW_SAMPLE,
            ]);
```

⚠️ Lies die Stelle vorher: Sitzung 1 hat dort einen Kurzschluss für die leere Kette eingebaut, der dieselbe Antwortform liefert. Er braucht das Feld `sample` ebenfalls, sonst unterscheiden sich die beiden Antworten in ihrer Form — und die Oberfläche müsste zwei Fälle kennen.

- [ ] **Step 3: Prüfen und committen**

```bash
php -l api/edit/map/lore.php
EXT="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll"
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 $EXT "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add api/edit/map/lore.php
git commit -m "feat(vorkommen): die Regelvorschau schickt Zahlen voll und Namen gekappt"
```

---

### Task 3: Die Protokollzeile

`remove_place` im selben Endpunkt schreibt eine Protokollzeile, `save_rule` und `delete_rule` nicht. Eine gelöschte Regel hinterlässt bisher keine Spur.

**Files:**
- Modify: `api/edit/map/lore.php` (`save_rule`, `delete_rule`)

**Interfaces:**
- Consumes: dieselbe Protokollfunktion, die `remove_place` benutzt.
- Produces: nichts Neues nach außen.

⭐ **Dieser Task hat bewusst keinen fertigen Codeblock.** Er greift an eine bestehende Protokollmechanik, deren Funktionsnamen ich nicht gemessen habe — und genau das war in Sitzung 1 die Ursache von vier der fünf Planfehler (ein hingeschriebener Codeblock liest sich wie eine Zusicherung und ist doch nur eine Vermutung). Hier steht deshalb der Prüfbefehl statt der Vermutung.

- [ ] **Step 1: Das vorhandene Muster finden**

Lies in `api/edit/map/lore.php` und `api/_internal/app/lore-edit.php` nach, **wie** `remove_place` protokolliert: welche Funktion, welche Argumente, welche Aktionsbezeichnung. Übernimm genau dieses Muster — **schreib keine zweite Protokollmechanik**. Halte im Bericht fest, welche Funktion es ist.

- [ ] **Step 2: Zwei Aufrufe ergänzen**

In `save_rule` nach dem erfolgreichen `avesmapsLoreRuleSave`, in `delete_rule` nach dem erfolgreichen Löschen. Die Aktionsbezeichnungen: `lore_rule_save` und `lore_rule_delete`.

💣 **Die Bezeichnungen sind WERTE in Datenzeilen, keine Beschriftung.** Sie werden später in Protokolllisten gefiltert und dürfen nachträglich nicht umbenannt werden — dieselbe Regel, die die Tabellennamen der Literatur beim Umbenennen gerettet hat (AGENTS.md §11).

Die Zeile soll erkennbar machen, **welche** Regel: nimm die `rule_id` und den Eintragsschlüssel mit, nicht die ganze Bedingungskette.

⚠️ Protokolliert wird nur der **Erfolg**. Ein abgelehnter Speicherversuch (`rule_matches_everything`, `too_many_terms`) ist kein Vorgang, der in einem Änderungsprotokoll steht.

- [ ] **Step 3: Prüfen und committen**

```bash
php -l api/edit/map/lore.php
EXT="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll"
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 $EXT "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add api/edit/map/lore.php
git commit -m "feat(vorkommen): Regeln anlegen und loeschen hinterlassen eine Protokollzeile"
```

**🔴 Halt nach Task 3.** Tasks 1–3 sind unsichtbar und gehen zusammen live. Push, Remote-SHA prüfen, 2–4 Minuten OPcache abwarten, dann eine einzelne Probe:

```bash
curl -s -X POST "https://avesmaps.de/api/edit/map/lore.php" -H "Content-Type: application/json" -d '{"action":"list_rules","wiki_key":"x"}' -w "\nHTTP %{http_code}\n"
```
Erwartet: **401** (anonym), nicht 500.

---

### Task 4: Die Siedlungszeilen im Zugehörigkeits-Lauf

Ohne sie meldet jede Regel „0 Siedlungen". Die Tabelle `location_ecosystem` existiert seit Sitzung 1 und wird vom Lauf geleert — nur füllt sie niemand.

**Files:**
- Modify: `html/landschaften-editor.html` (Loader, Rechnung, `saveAssignments`, Kachel)
- Modify: `index.html` — **nur prüfen**, nicht ändern (siehe Step 1)
- Test: `js/map-features/__tests__/point-in-geometry.test.js` (neu, falls es noch keinen gibt — prüfe zuerst)

**Interfaces:**
- Consumes: `pointInGeometry(point, geometry)` aus `js/map-features/map-features-point-in-polygon.js` (exportiert auch als `window.AvesmapsPip.pointInGeometry`; die Datei hat ein `module.exports` und ist damit in node prüfbar). `saveAssignments(pathRows, overlapRows, territoryRows, durationMs, onProgress)` in `html/landschaften-editor.html` — sie schneidet die Listen in Häppchen und schickt sie je `kind`.
- Produces: `locationRowsFromAreas(locations, areas)` in derselben Seite → `list<{location: string, area: string}>` (public_ids). `saveAssignments` bekommt die Liste als weiteres Argument und sendet sie als `kind: "location"`.

- [ ] **Step 1: Erst nachsehen, dann bauen**

Beantworte diese vier Fragen und schreib die Antworten in den Bericht:
1. Bindet `html/landschaften-editor.html` `js/map-features/map-features-point-in-polygon.js` schon ein? (`grep -n "point-in-polygon" html/landschaften-editor.html`) Wenn nein, ist ein `<script>`-Tag nötig — sieh dir an, wie die Seite ihre übrigen Skripte einbindet, und mach es genauso.
2. Gibt es für `pointInGeometry` schon einen Test? (`ls js/map-features/__tests__/ | grep -i point`)
3. Welche Felder liefert `/api/locations/` genau? (`curl -s "https://avesmaps.de/api/locations/" | head -c 400` — **eine** Anfrage, nie in einer Schleife.) Erwartet: `locations[]` mit `public_id`, `name`, `is_crossing`, `coordinates: {x, y}`.
4. Wie heißt in der Seite die Konstante für einen API-Pfad, und wo stehen sie? (`grep -n "_API = " html/landschaften-editor.html`)

- [ ] **Step 2: Write the failing test**

`js/map-features/__tests__/point-in-geometry.test.js` — nur anlegen, falls Step 1 keinen vorhandenen fand:

```js
// pointInGeometry traegt in Sitzung 2 die Siedlung-Flaeche-Zuordnung. Das Modul ist alt und
// bewaehrt; dieser Test sichert genau die drei Eigenschaften, auf die sich der Zuordnungslauf
// verlaesst -- nicht mehr.
const assert = require("node:assert");
const { pointInGeometry } = require("../map-features-point-in-polygon.js");

const quadrat = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
assert.strictEqual(pointInGeometry([5, 5], quadrat), true, "innen");
assert.strictEqual(pointInGeometry([15, 5], quadrat), false, "aussen");

// 💣 Zwei getrennte Teile sind EINE Flaeche -- ein Ort im zweiten Teil gehoert dazu. Genau das
// unterscheidet MultiPolygon von Polygon, und die Haelfte der Landschaftsflaechen ist mehrteilig.
const zweiTeile = {
	type: "MultiPolygon",
	coordinates: [
		[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
		[[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]],
	],
};
assert.strictEqual(pointInGeometry([25, 25], zweiTeile), true, "zweiter Teil");
assert.strictEqual(pointInGeometry([15, 15], zweiTeile), false, "zwischen den Teilen");

// 💣 x und y NICHT vertauschen. GeoJSON ist [x, y]; Leaflet spricht [lat, lng] = [y, x], und
// dieser Tausch ist im Haus schon mehrfach danebengegangen (AGENTS.md §5). Ein laengliches
// Rechteck faengt die Verwechslung, ein Quadrat nie.
const breit = { type: "Polygon", coordinates: [[[0, 0], [100, 0], [100, 5], [0, 5], [0, 0]]] };
assert.strictEqual(pointInGeometry([50, 2], breit), true, "x lang, y kurz");
assert.strictEqual(pointInGeometry([2, 50], breit), false, "vertauscht faellt heraus");

console.log("point-in-geometry: OK");
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node js/map-features/__tests__/point-in-geometry.test.js`
Expected: `point-in-geometry: OK` — der Test prüft vorhandenen Code, er darf gleich grün sein. **Beweise trotzdem, dass er beißt:** tausche in `map-features-point-in-polygon.js` testweise `point[0]` und `point[1]`, lass den Test laufen (muss ROT sein), stelle die Datei wieder her.

- [ ] **Step 4: Die Orte laden**

In `html/landschaften-editor.html`, bei den anderen API-Konstanten:

```js
const LOCATIONS_API = "/api/locations/";   // der stabile oeffentliche Vertrag: x/y + is_crossing
```

und bei den anderen Ladern:

```js
// V-Regel (Sitzung 2): die Orte kommen aus dem STABILEN Vertrag, nicht aus einer eigenen
// Abfrage. Er liefert die Koordinaten und beantwortet „ist das eine Kreuzung" mit demselben
// Praedikat wie das Routennetz -- ein Namensvergleich waere hier schon zweimal falsch gewesen.
async function loadLocations() {
	const response = await fetch(LOCATIONS_API, { credentials: "same-origin", headers: { Accept: "application/json" } });
	const data = await response.json();
	if (!response.ok || data.ok === false) {
		throw new Error((data.error && data.error.message) || ("HTTP " + response.status));
	}
	return (Array.isArray(data.locations) ? data.locations : []).filter((entry) => entry && entry.is_crossing !== true);
}
```

Dazu `let allLocations = null;` neben `allAreas` und `allPaths`.

- [ ] **Step 5: Die Zuordnung rechnen**

Neben `overlapRowsFromRaycast()`:

```js
// Siedlung -> Flaeche. Ein Ort ist ein Punkt: er liegt in einer Flaeche oder nicht, es gibt
// keinen Anteil. Deshalb Punkt-in-Polygon statt Verschneidung.
// 💣 Der Kasten-Vorfilter ist nicht Kosmetik, sondern der Grund, dass das laeuft: ohne ihn sind
// es 2.782 Orte x ~830 Flaechen = 2,3 Millionen Polygontests. Dieselbe Ueberlegung wie bei
// boundsOverlap im Raycast oben.
function locationRowsFromAreas(locations, areas) {
	const out = [];
	(locations || []).forEach((location) => {
		const coordinates = location && location.coordinates;
		const x = Number(coordinates && coordinates.x);
		const y = Number(coordinates && coordinates.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) { return; }
		(areas || []).forEach((area) => {
			const bounds = area && area.bounds;
			if (!bounds || x < bounds.min_x || x > bounds.max_x || y < bounds.min_y || y > bounds.max_y) { return; }
			if (!pointInGeometry([x, y], area.geometry)) { return; }
			out.push({ location: String(location.public_id || ""), area: String(area.public_id || "") });
		});
	});
	return out;
}
```

⚠️ `area.public_id` ist die **Fläche**, nicht die Region — der Server löst sie über `ecosystem_area` auf. Prüfe am Payload aus Step 1, dass das Feld wirklich so heißt.

- [ ] **Step 6: Mitsenden**

`saveAssignments` bekommt einen weiteren Parameter `locationRows` und eine weitere Zeile bei den Häppchen:

```js
	slice("location", locationRows);
```

Die Aufrufstelle von `saveAssignments` lädt vorher die Orte (`if (allLocations === null) { allLocations = await loadLocations(); }`) und reicht `locationRowsFromAreas(allLocations, allAreas)` durch. Setz die Statusmeldung entsprechend („Orte werden geladen …", „Orte werden zugeordnet …"), wie die Nachbarschritte es tun.

- [ ] **Step 7: Die Kachel**

`renderAssignmentTile()` zeigt heute Wegabschnitte und Dauer. Ergänze die Siedlungen:

```js
	info.textContent = wegabschnitte + " Wegabschnitte · " + stamp.location_rows + " Orte · "
		+ (stamp.duration_ms / 1000).toFixed(1).replace(".", ",") + " s";
```

⚠️ `location_rows` liefert `assignment_status` seit Sitzung 1 mit. Prüfe das nach (`grep -n "location_rows" api/_internal/app/path-ecosystem.php`), bevor du dich darauf verlässt.

- [ ] **Step 8: Abnahme am echten Ablauf, nicht am Maß**

Öffne `html/landschaften-editor.html` über den Vorschau-Server, drück „Zugehörigkeit rechnen" und **benenne**, was du gesehen hast:
1. Läuft der Lauf durch, ohne Fehler in der Konsole?
2. Nennt die Kachel danach eine Orte-Zahl **größer null**?
3. Steht danach in `assignment_status` ein plausibles `location_rows`?

Halte die Zahl im Bericht fest. **Zum Vergleich, offline gemessen am 12.08.2026: 4.252 Siedlung-Fläche-Zuordnungen bei 2.782 Orten.** Weicht deine Zahl stark ab, ist das ein Befund, kein Rundungsfehler.

⚠️ Was ein Vorschau-Server nicht beantworten kann: ob die Anmeldung im echten Editor-Rahmen greift. Melde das als offene Frage, nicht als bestanden.

- [ ] **Step 9: Testfeld und Commit**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
EXT="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll"
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 $EXT "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add html/landschaften-editor.html js/map-features/__tests__/point-in-geometry.test.js
git commit -m "feat(landschaften): der Zugehoerigkeitslauf ordnet Siedlungen ihren Flaechen zu"
```

**🔴 Halt nach Task 4.** Sichtbare Änderung im Landschaften-Editor (die Kachel nennt eine neue Zahl). Einzeln live, Owner-Blick, und der Owner drückt einmal „Zugehörigkeit rechnen". Erst danach weiter.

---

### Task 5: Die Regelkarte in der Vorkommen-Liste

Ab hier ist es die Oberfläche aus dem Mockup. Zuerst nur **anzeigen**, was gespeichert ist — der Editor kommt in Task 6.

**Files:**
- Create: `js/review/review-lore-rule.js`
- Create: `js/review/__tests__/lore-rule-ui.test.js`
- Modify: `css/features/lore.css` (ans Ende)
- Modify: `js/review/review-wiki-sync.js` (zwei Stellen)
- Modify: `index.html` (ein `<script>`-Tag)

**Interfaces:**
- Consumes: `list_rules` aus Task 1.
- Produces (global, wie die übrigen Bauteile dieses Ordners):
  - `avesmapsLoreRuleSentence(rule, zoneLabels)` — **rein**, baut den deutschen Satz einer Regel als HTML-Zeichenkette. `zoneLabels` ist `{key: label}`.
  - `avesmapsLoreRuleCardMarkup(rule, zoneLabels)` — **rein**, das Markup einer Regelkarte für die Ortsliste.
  - `avesmapsLoreRuleLoad(wikiKey)` — holt die Regeln und legt sie in einem Modulzustand ab.

- [ ] **Step 1: Das Mockup lesen, bevor du Markup schreibst**

Öffne `docs/vorkommen-regeleditor-mockup.html` und sieh dir an, wie eine Regel **zugeklappt** aussieht: die zwei Zeilen (Landschaft, Klima), die Trefferzahl, die Marke „von Hand". Die Klassen im Mockup heißen `rule__*`; im Bau tragen sie das Präfix der Ortsliste (`lore-detail__*`), damit sie zu ihren Nachbarn gehören. **Eine Regel steht als gleichrangige Karte in derselben Liste wie ein Ort — kein eigener Abschnitt, kein eigener Kasten.**

- [ ] **Step 2: Write the failing test**

`js/review/__tests__/lore-rule-ui.test.js`:

```js
// Die reinen Teile des Regeleditors. Sie bauen Text und Markup aus Daten -- genau das ist ohne
// Browser pruefbar, und genau daran ist im Haus schon Escaping danebengegangen.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

// Die echten Globals installieren, keine Fakes: ein gestubbter Escaper wuerde die
// Escaping-Fehler verstecken, um die es hier geht.
const context = { window: {}, document: undefined, console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("js/app/utils.js", "utf8"), context);
vm.runInContext(fs.readFileSync("js/review/review-lore-rule.js", "utf8"), context);

const zoneLabels = {
	polar: "Polare Zone", subpolar: "Subpolare Zone", boreal: "Boreale Zone",
	gemaessigt: "Gemäßigte Zone", subtropen_winterfeucht: "Winterfeuchte Subtropen",
	trockene_subtropen: "Subtropische Steppenzone", subtropisch: "Subtropische Wüstenzone",
	tropisch: "Tropische Zone",
};
const term = (over) => Object.assign(
	{ join_op: "und", area_public_id: null, area_name: "", climate_from: null, climate_to: null, types: [] },
	over
);

// Eine Bedingung, zwei Felder: Art UND Klima.
const einfach = { id: 1, relation: "verbreitung", terms: [term({
	types: [{ kind: "vegetation", region_type: "wald" }],
	climate_from: "boreal", climate_to: "gemaessigt",
})] };
const satz = context.avesmapsLoreRuleSentence(einfach, zoneLabels);
assert.ok(satz.includes("Wald"), "die Art steht im Satz");
assert.ok(satz.includes("Boreale Zone") && satz.includes("Gemäßigte Zone"), "beide Enden der Spanne");
assert.ok(satz.includes("zwischen"), "eine Spanne liest sich als Spanne");

// EINE Zone ist keine Spanne -- „zwischen X und X" waere Kauderwelsch.
const eine = { id: 2, relation: "verbreitung", terms: [term({ climate_from: "boreal", climate_to: "boreal" })] };
const satzEine = context.avesmapsLoreRuleSentence(eine, zoneLabels);
assert.ok(!satzEine.includes("zwischen"), "eine einzelne Zone ohne 'zwischen'");
assert.ok(satzEine.includes("Boreale Zone"));

// Mehrere Arten in EINER Bedingung sind ein ODER, zwei Bedingungen tragen ihr eigenes Wort.
const kette = { id: 3, relation: "verbreitung", terms: [
	term({ types: [{ kind: "vegetation", region_type: "wald" }, { kind: "vegetation", region_type: "suempfe_moore" }] }),
	term({ join_op: "oder", types: [{ kind: "topographie", region_type: "gebirge" }] }),
] };
const satzKette = context.avesmapsLoreRuleSentence(kette, zoneLabels);
assert.ok(satzKette.includes("Wald") && satzKette.includes("Sümpfe und Moore") && satzKette.includes("Gebirge"));
assert.ok(satzKette.includes("oder"), "die Verknuepfung der zweiten Bedingung steht da");

// 💣 Der Flaechenname kommt aus der Datenbank und wird ESCAPED. Ohne das traegt ein Name mit
// spitzer Klammer fremdes Markup in die Editorliste.
const boese = { id: 4, relation: "verbreitung", terms: [term({
	area_public_id: "a1", area_name: '<img src=x onerror="alert(1)">',
})] };
const markup = context.avesmapsLoreRuleCardMarkup(boese, zoneLabels);
assert.ok(!markup.includes("<img"), "der Name darf kein Markup einschleusen");
assert.ok(markup.includes("&lt;img"), "er steht escaped drin");

// Eine leere Regel gibt es nicht -- der Server laesst sie nicht zu. Der Satzbauer darf trotzdem
// nicht werfen, sonst reisst eine kaputte Datenzeile die ganze Liste ab.
assert.doesNotThrow(() => context.avesmapsLoreRuleSentence({ id: 5, relation: "", terms: [] }, zoneLabels));

console.log("lore-rule-ui: OK");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node js/review/__tests__/lore-rule-ui.test.js`
Expected: FAIL — `Cannot find module '../review-lore-rule.js'` bzw. `avesmapsLoreRuleSentence is not a function`

- [ ] **Step 4: Die Datei anlegen**

`js/review/review-lore-rule.js` mit den drei Bausteinen. Halte dich an die Bauart der Nachbardateien in `js/review/`: Markup als Zeichenkette, `escapeHtml` aus `js/app/utils.js` für **jeden** Wert aus der Datenbank, keine Frameworks.

Der Satzbauer folgt dem Mockup:
- je Bedingung: Flächenname („**X** heißt"), Arten („**A** oder **B** ist"), Klima („im Klima **X**" bzw. „im Klima zwischen **X** und **Y**"), verbunden mit „und"
- zwischen Bedingungen: das Wort aus `join_op`
- der ganze Satz beginnt mit „Die Regel liest sich: etwas, das …"

💣 **Die Beschriftungen der Landschaftsarten stehen NICHT in dieser Datei.** Sie kommen aus demselben Katalog wie überall (`ecosystem_region_type`); wo der Client sie herbekommt, klärt Step 5. Eine zweite Liste hier wäre die Divergenz, vor der AGENTS.md §12 warnt — und sie altert unbemerkt, sobald jemand eine Art umbenennt.

- [ ] **Step 5: Woher die Beschriftungen kommen — nachsehen, nicht erfinden**

Beantworte im Bericht: liefert der Payload, den das Vorkommen-Fenster ohnehin lädt, die Art-Beschriftungen schon mit? Sieh nach in `api/app/map-features.php` (Stichwort `climate_zones` — die Klimazonen reisen dort bereits als Vokabular mit) und in `api/_internal/app/ecosystem.php` (`avesmapsEcosystemReadRegionTypes` oder ähnlich). Wenn ja: von dort nehmen. Wenn nein: eine schmale Aktion `region_types` am Ökosystem-Endpunkt ergänzen und das im Bericht als Zusatz kennzeichnen.

- [ ] **Step 6: Run test to verify it passes**

Run: `node js/review/__tests__/lore-rule-ui.test.js`
Expected: `lore-rule-ui: OK`

- [ ] **Step 7: Prove the test bites**

Mutationen, jede muss ROT sein: `escapeHtml` im Namen weglassen · „zwischen" auch bei einer einzelnen Zone schreiben · den `join_op` der zweiten Bedingung ignorieren und immer „und" schreiben.

- [ ] **Step 8: Einhängen**

- `index.html`: ein `<script src="js/review/review-lore-rule.js"></script>` **nach** `js/app/utils.js` und **vor** `js/review/review-wiki-sync.js`. 💣 Die Ladereihenfolge in `index.html` ist ein Vertrag (AGENTS.md §3) — eine spätere Datei kann eine frühere überschreiben. Prüf nach dem Einhängen in der Browser-Konsole, dass `avesmapsLoreRuleSentence` existiert.
- `js/review/review-wiki-sync.js`: dort, wo die Ortsliste gebaut wird (Suchbegriff `lore-detail__places`), die Regelkarten **nach** den Ortskarten anhängen, und der Abschnittstitel wird von „Orte (n)" zu „Vorkommen (n)" mit der Summe aus Orten und Regeln. Der Knopf „+ Regel" kommt neben „+ Ort" (in Task 6 bekommt er seine Funktion; hier ist er `disabled` mit `title="folgt"`).
- `css/features/lore.css`: die Stile der Regelkarte, ans Ende, in der Bauart der Nachbarregeln (Token statt Werte).

- [ ] **Step 9: Abnahme am echten Ablauf**

Über den Vorschau-Server das Vorkommen-Fenster öffnen und **benennen**, was du gesehen hast: öffnet sich der Eintrag, steht der Abschnitt „Vorkommen (n)" da, und erscheint eine gespeicherte Regel als Karte mit ihrem Satz? Ohne Anmeldung kommst du nur bis zum 401 — sag im Bericht, wie weit du gekommen bist, statt es als bestanden zu melden. Ein Bildschirmfoto in hell **und** dunkel gehört dazu (AGENTS.md §12).

- [ ] **Step 10: Testfeld und Commit**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add js/review/review-lore-rule.js js/review/__tests__/lore-rule-ui.test.js css/features/lore.css js/review/review-wiki-sync.js index.html
git commit -m "ui(vorkommen): gespeicherte Lebensraum-Regeln stehen als Karte in der Ortsliste"
```

---

### Task 6: Der Regeleditor

Das Herzstück. Vorlage ist `docs/vorkommen-regeleditor-mockup.html` — es ist lauffähig und rechnet mit echtem Bestand; **bau nicht daneben, bau es nach.**

**Files:**
- Modify: `js/review/review-lore-rule.js`
- Modify: `js/review/__tests__/lore-rule-ui.test.js`
- Modify: `css/features/lore.css`

**Interfaces:**
- Consumes: `avesmapsLoreRuleSentence` (Task 5).
- Produces:
  - `avesmapsLoreRuleTermToggleType(term, value)` — **rein**, fügt `kind/region_type` hinzu oder entfernt es, gibt die neue Bedingung zurück.
  - `avesmapsLoreRuleSearchKey(value)` — **rein**, der Suchschlüssel der Autocomplete-Felder.
  - `avesmapsLoreRuleOpenEditor(wikiKey, rule)` — öffnet den Editor für eine neue (`rule === null`) oder bestehende Regel.

- [ ] **Step 1: Write the failing test**

Ans Ende von `js/review/__tests__/lore-rule-ui.test.js`, **vor** die `console.log`-Zeile:

```js
// 💣 ZWEI Faltungen, nicht eine. NFD-Strippen macht aus „Wüste" ein „wuste", getippt wird aber
// „wueste" -- beide Seiten muessen zusaetzlich durch ue/oe/ae -> u/o/a, sonst findet „wueste"
// die Wueste NICHT. Im Mockup gemessen, nicht vermutet.
const key = context.avesmapsLoreRuleSearchKey;
assert.strictEqual(key("Wüste"), key("wueste"), "beide Schreibweisen treffen sich");
assert.strictEqual(key("Sümpfe und Moore"), key("suempfe und moore"));
assert.strictEqual(key("Große Fluss"), key("grosse fluss"), "das scharfe S faellt auf ss");
assert.notStrictEqual(key("Wald"), key("Steppe"), "verschiedene Arten bleiben verschieden");

// Arten an- und abwaehlen, ohne die uebrige Bedingung anzufassen.
let t = term({ climate_from: "boreal", climate_to: "gemaessigt" });
t = context.avesmapsLoreRuleTermToggleType(t, "vegetation/wald");
assert.strictEqual(t.types.length, 1);
assert.strictEqual(t.types[0].kind, "vegetation");
assert.strictEqual(t.types[0].region_type, "wald");
assert.strictEqual(t.climate_from, "boreal", "das Klima bleibt unberuehrt");

t = context.avesmapsLoreRuleTermToggleType(t, "topographie/gebirge");
assert.strictEqual(t.types.length, 2);
t = context.avesmapsLoreRuleTermToggleType(t, "vegetation/wald");
assert.strictEqual(t.types.length, 1, "dieselbe Art nochmal waehlt sie ab");
assert.strictEqual(t.types[0].region_type, "gebirge", "und zwar die richtige");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node js/review/__tests__/lore-rule-ui.test.js`
Expected: FAIL — `avesmapsLoreRuleSearchKey is not a function`

- [ ] **Step 3: Die reinen Teile**

In `js/review/review-lore-rule.js`:

```js
/* 💣 ZWEI Faltungen, nicht eine: NFD macht aus „Wüste" ein „wuste", getippt wird aber
   „wueste". Beide Seiten laufen zusaetzlich durch ue/oe/ae -> u/o/a, dann treffen sich die
   Schreibweisen. Mit nur NFD findet „wueste" die Wüste NICHT -- im Mockup gemessen.
   💣 Die Kombinationszeichen als \u-Escapes, nie als Literale: als Literale sind sie im
   Quelltext unsichtbar und ueberleben kein Werkzeug, das beim Kopieren normalisiert. */
function avesmapsLoreRuleSearchKey(value) {
	return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
		.replace(/ß/g, "ss")
		.replace(/ue/g, "u").replace(/oe/g, "o").replace(/ae/g, "a")
		.replace(/[^a-z0-9]+/g, " ").trim();
}

/** REIN: eine Art an- oder abwaehlen. Gibt eine NEUE Bedingung zurueck, aendert nichts am Original. */
function avesmapsLoreRuleTermToggleType(term, value) {
	const parts = String(value || "").split("/");
	const next = Object.assign({}, term, { types: (term.types || []).slice() });
	const at = next.types.findIndex((type) => type.kind === parts[0] && type.region_type === parts[1]);
	if (at >= 0) { next.types.splice(at, 1); } else { next.types.push({ kind: parts[0], region_type: parts[1] }); }
	return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node js/review/__tests__/lore-rule-ui.test.js`
Expected: `lore-rule-ui: OK`

- [ ] **Step 5: Prove the test bites**

Mutationen, jede muss ROT sein: die `ue/oe/ae`-Faltung weglassen · beim Abwählen `splice(0, 1)` statt `splice(at, 1)` schreiben · in `Toggle` das Original ändern statt eine Kopie zurückzugeben (dann schlägt der Klima-Assert fehl, sobald man ihn auf das Original prüft — ergänze diesen Fall, falls er nicht anschlägt).

- [ ] **Step 6: Die Oberfläche**

⭐ **Das Mockup IST hier die Vorlage, und zwar als Quelltext.** `docs/vorkommen-regeleditor-mockup.html` enthält den lauffähigen Editor: die Autocomplete-Mechanik, den Klimastreifen, den Satzbauer, den Kettenzustand — alles gegen echten Bestand erprobt. Dieser Plan schreibt den Code deshalb **nicht** noch einmal ab; das wäre eine zweite Fassung, die sofort altert. Öffne das Mockup, lies die Abschnitte und übertrage sie in die Bauart des Hauses (Markup als Zeichenkette mit `escapeHtml`, Stile in `css/features/lore.css` mit Token, keine Inline-Styles). Was im Mockup ein selbstgebautes Vorschlagsmenü ist, wird im Bau jQuery-UI-Autocomplete.

Die Teile, die das Mockup vorgibt:
- **Bedingungen untereinander**, dazwischen ein anklickbarer UND/ODER-Wähler auf einer Trennlinie, darunter „+ Bedingung".
- **Drei Felder je Bedingung:** Flächenname und Landschaftsart als **Suchfelder mit Vorschlagsliste, kein Auswahlraster**; das Gewählte steht als wegklickbare Marke darunter und fällt aus den Vorschlägen. Jeder Vorschlag zeigt Ebene und Flächenzahl.
- **Klimazone als waagerechter Streifen** der acht Zonen (Nord links) plus zwei Auswahlfelder von/bis und „egal".
- **Der Satz** und **die Trefferzahlen** unter allem.

💣 **Das Klima bleibt sichtbar, es wird nicht zur Suche.** Eine Spanne braucht ihre Nachbarn — aus einer Vorschlagsliste gewählt, wählt man über ein Loch, das man nicht sieht.
💣 **Ein gewählter Eintrag, den die Suche wegfiltern würde, bleibt stehen** (im Mockup gestrichelt umrandet) — sonst ist er nicht mehr abwählbar und die Regel trägt eine Bedingung, die niemand sieht.
⚠️ Für die Vorschlagsliste ist **jQuery-UI-Autocomplete** vorhanden und im Haus üblich. Zwei bekannte Fallen: gemischte Eintragsarten in einer Liste, und eine Combobox, die einem Dialog den Fokus klaut. Sieh dir eine bestehende Verwendung an, bevor du eine eigene baust.

- [ ] **Step 7: Abnahme am echten Ablauf, nicht am Maß**

Führe diese Handgriffe aus und benenne jeden einzeln im Bericht:
1. „+ Regel" drücken — geht der Editor auf?
2. „wueste" in die Artsuche tippen — kommen Wüste und Wüstenoase?
3. Eine Art wählen — wird sie zur Marke und verschwindet aus den Vorschlägen?
4. Im Klimastreifen zwei Zonen anklicken — färbt sich die Spanne dazwischen?
5. Liest sich der Satz unten wie ein deutscher Satz?
6. „+ Bedingung", Verknüpfung auf ODER — ändert sich der Satz mit?

Dazu ein Bildschirmfoto in **hell und dunkel**. Was du ohne Anmeldung nicht erreichst, meldest du als offene Frage.

- [ ] **Step 8: Testfeld und Commit**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add js/review/review-lore-rule.js js/review/__tests__/lore-rule-ui.test.js css/features/lore.css
git commit -m "ui(vorkommen): der Regeleditor mit Suchfeldern und Klimaspanne"
```

---

### Task 7: Vorschau, Speichern, Löschen — und der Stand der Rechnung

**Files:**
- Modify: `js/review/review-lore-rule.js`
- Modify: `css/features/lore.css`

**Interfaces:**
- Consumes: `preview_rule`, `save_rule`, `delete_rule` (Sitzung 1), `list_rules` (Task 1), `assignment_status` (liefert `location_rows` und den Stempel).
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Die Vorschau anbinden**

Jede Änderung an der Kette ruft `preview_rule` — **entprellt**, nicht bei jedem Tastendruck. Die Antwort füllt Trefferzahlen und die beiden Namenslisten.

💣 **Eine überholte Antwort darf eine neuere nicht überschreiben.** Wer schnell tippt, bekommt sonst das Ergebnis von vorletzter Eingabe zu sehen. Merke dir je Anfrage eine laufende Nummer und verwirf, was nicht die neueste ist — dasselbe Muster, das die Spotlight-Suche schon benutzt.
⚠️ `counts` trägt die vollen Zahlen, `areas`/`places` sind auf `sample` gekappt (Task 2). Zeig die **Zahl** aus `counts` und schreib unter die Liste, dass sie gekappt ist, wenn `counts.areas > sample`.

- [ ] **Step 2: Speichern und Löschen**

„Regel übernehmen" ist die **einzige gefüllte** Handlung des Fensters (`--color-button`), alles andere weich. Nach dem Speichern: Editor zu, Liste über `list_rules` neu holen, Karte steht da.

💣 **Der Riegel des Servers ist die Wahrheit, nicht der ausgegraute Knopf.** Fängt `save_rule` mit `rule_matches_everything` oder `too_many_terms` zurück, zeig die Meldung — verschluck sie nicht, weil „das kann ja nicht sein".
Beim Löschen eine Rückfrage. Eine Regel kann hunderte Infoboxen betreffen; ein Fehlklick ist teuer.

- [ ] **Step 3: „Zuletzt gerechnet"**

Der Landschaften-Editor zeigt den Stand bereits (`renderAssignmentTile` in `html/landschaften-editor.html`, samt Vergleich „veraltet"). **Bau das nicht nach** — lies dort ab, wie es geht, und zeig dieselbe Aussage klein an der Trefferzahl des Regeleditors:

```
Stand: 13.08.2026 19:04 · aktuell
Stand: 09.08.2026 22:31 · veraltet, bitte neu rechnen
Wird gerade gerechnet …
```

💣 „veraltet" ist ein **Vergleich**, keine Vermutung: der Stempel trägt `ecosystem_revision` und `map_revision` des Laufs, und `assignment_status` liefert die aktuellen mit. Ist `completed` falsch, heißt es „wird gerade gerechnet", und die Trefferzahlen sind dann **nicht** vertrauenswürdig — sag das dort, statt eine 0 zu zeigen.

- [ ] **Step 4: Abnahme am echten Ablauf**

Handgriffe, jeder einzeln benannt:
1. Eine Regel bauen — erscheinen Trefferzahlen, und stimmen sie mit dem Mockup überein (Wald + boreal…gemäßigt → 50 Flächen)?
2. Speichern — geht der Editor zu, steht die Karte in der Liste?
3. Fenster neu laden, Eintrag wieder öffnen — ist die Regel noch da, mit demselben Satz?
4. Die Regel wieder öffnen, eine Bedingung ändern, speichern — ist es **eine** Regel geblieben, nicht zwei?
5. Löschen mit Rückfrage — ist sie weg, und bleibt sie nach dem Neuladen weg?
6. Eine leere Bedingung anlegen und speichern wollen — kommt die Meldung des Servers?

Bildschirmfotos hell und dunkel. Was ohne Anmeldung unerreichbar bleibt, wird als offene Frage gemeldet.

- [ ] **Step 5: Testfeld und Commit**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
git add js/review/review-lore-rule.js css/features/lore.css
git commit -m "ui(vorkommen): Vorschau, Speichern und Loeschen einer Regel samt Rechenstand"
```

**🔴 Halt nach Task 7.** Sichtbare Änderung im Vorkommen-Fenster. Einzeln live, Owner-Blick.

---

## Abnahme dieser Sitzung

- [ ] Das ganze Testfeld (JS + PHP) grün, `php -l` sauber auf jeder berührten PHP-Datei.
- [ ] Die sechs Handgriffe aus Task 7 Step 4 einzeln ausgeführt und **benannt** — nicht „sieht gut aus".
- [ ] Der Zugehörigkeits-Lauf nennt eine Orte-Zahl größer null, und eine Regel meldet danach Siedlungen statt 0.
- [ ] Bildschirmfotos in hell **und** dunkel, gegen `docs/vorkommen-regeleditor-mockup.html` gehalten.
- [ ] Jede Zeile mit 💣 / ⚠️ / 🔴 in diesem Plan einzeln abgehakt: erfüllt, oder ausdrücklich verworfen mit Begründung.
- [ ] Vor dem Push je sichtbarem Block: `usability-konsistenz` (Entwurf gegen Diff) und `usability-design` (Mockup gegen gebauten Zustand).

## 🔧 Owner-Frage, vor Task 4 zu klären

**Die Schwelle, ab der eine Fläche eine Klimazone „berührt", steht an zwei Stellen verschieden:**

| Wo | Wert | Wirkung |
|---|---|---|
| `RAYCAST_THRESHOLD` in `html/landschaften-editor.html:526` | **0,10** | Überschneidungen unter 10 % werden gar nicht erst **gespeichert** |
| `AVESMAPS_CLIMATE_REGION_MIN_SHARE` in `api/_internal/app/climate-membership.php` | **0,05** | Der Server filtert beim **Lesen** bei 5 % |

Damit ist die 5-%-Prüfung unterhalb von 10 % wirkungslos: eine Fläche, die zu 7 % in der Borealen Zone liegt, ist für Regel **und** Infobox-Zeile unsichtbar. Das ist **älter als die Lebensraum-Regel** — die Zeile „Klimazone" hat dieselbe Lücke, seit es sie gibt.

Drei Wege, und es ist eine Owner-Entscheidung, weil der erste den ganzen Bestand neu rechnet:
1. **`RAYCAST_THRESHOLD` auf 0,05 senken.** Dann stimmen beide. Kostet einen vollen Zugehörigkeits-Lauf und ändert auch die Klimazeile bestehender Regionen — mehr Zonen je Fläche, also längere Infobox-Zeilen.
2. **Die Server-Schwelle auf 0,10 heben.** Dann stimmen beide ebenfalls, und nichts wird neu gerechnet — aber die 5 % in der Klimazeile waren eine bewusste Wahl.
3. **So lassen und dokumentieren.** Beide Zahlen bleiben, die effektive Schwelle ist 10 %, und das steht künftig an beiden Stellen im Kommentar.

Ohne Entscheidung gilt Weg 3, weil er nichts verändert.

## Was NICHT in dieser Sitzung ist

- **Die Wirkung in der Infobox** — eine gespeicherte Regel taucht noch nirgends öffentlich auf. Das ist Sitzung 3, zusammen mit der Suche und der Schnittmengen-Hervorhebung.
- **Regeln in der Vorkommen-Liste filtern** („nur mit Regel") — erst sinnvoll, wenn es Regeln gibt.
- 💣 **`avesmapsLoreRuleReadPlaces` unverändert in den Lesepfad übernehmen.** Sie rechnet die Zone je Ort mit Punkt-in-Polygon; für die Editor-Vorschau ist das vertretbar, auf dem öffentlichen Lesepfad ist es genau das, was Entwurf §5 verbietet.
