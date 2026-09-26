# Stätten löschen und umhängen — Implementierungsplan

> **Für ausführende Agenten:** PFLICHT-SKILL: superpowers:subagent-driven-development (empfohlen) oder
> superpowers:executing-plans. Schritte als Checkbox (`- [ ]`).

**Ziel:** Gespeicherte Stätten (`settlement_place`) lassen sich in „Ort bearbeiten" und im Ortseditor löschen
und an einen anderen Ort hängen.

> 🔴 **Änderung 26.09.2026 (Owner):** Die Regel „Kartenpunkt schlägt Innerorts" ist gestrichen — innerorts ist
> ein unabhängiges Prädikat und wird ein eigener Auftrag (Teil 2, Variante B). **Task 2 entfällt.** Task 1 ist
> gebaut und behält die reinen Hilfen `avesmapsInnerortsArtikelSchluessel/…KartenArtikel/…OhneKartenpunkte`
> für Teil 2. Im Endpunkt entfällt das Feld `auf_der_karte`, im Bauteil der Hinweis „liegt auf der Karte …"
> und der Nachsatz der grauen Zeile.

**Architektur:** Reine PHP-Funktionen in `api/_internal/app/settlement-places.php` (Regel, Liste, Umhängen,
Ortssuche, Namensnachbarn), ein Editor-Endpunkt `api/edit/map/settlement-places.php`, ein Browser-Bauteil
`js/ui/staetten-kasten.js` + `css/components/staetten-kasten.css`, eingebaut an zwei Stellen.

**Tech:** PHP 8 strict (MySQL/MariaDB live, SQLite in Tests), Vanilla-JS ohne Build, Node-Tests ohne Framework.

**Spec:** `docs/superpowers/specs/2026-09-26-staetten-loeschen-umhaengen-design.md` ·
**Mockup (mit Vertrag):** `docs/staetten-kasten-mockup.html`

## Globale Randbedingungen

- Gebaut wird im Worktree `…/scratchpad/staetten` (Branch `staetten-editor`), **nie** im Hauptbaum
  `C:\GIT\avesmaps` (abgetrennter, veralteter Ast; dort weder checkout noch stash noch Schreiben).
- Kommentare, Meldungen, Commit-Texte **Deutsch**; `error.code` englisch. Commit-Nachricht per Datei
  (`git commit -F`), letzte Zeile `Co-Authored-By: …`; danach `git log -1 --format=%B` lesen.
- **Kein Push durch Umsetzer.** Der Controller pusht.
- Farben/Abstände nur über Tokens aus `css/base/tokens.css`; kein Blau in der Oberfläche.
- PDO-Platzhalter nie doppelt im selben Statement (`ATTR_EMULATE_PREPARES=false`, HY093).
- `Ensure…`-DDL immer **vor** einer Transaktion.
- Kein `mb_*` in neuen Server-Funktionen (mbstring ist nicht garantiert) — `strtolower` genügt, beide Seiten
  werden gleich normalisiert.
- PHP-Tests: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll <datei>`.
- Ganzes Testfeld vor jedem Commit (Muster aus `.github/workflows/deploy-avesmaps-strato.yml`, parallel,
  mit Dateizählung); Nulllinie: rot nur `api/_internal/linkcheck/__tests__/link-url-test.php`.
- Quelltext-Tests zeilenendenneutral (`.replace(/\r\n/g, "\n")`) und **ohne Kommentare** lesen
  (Tokenizer bzw. Kommentar-Strip), Bauteile **ausführen** statt per Regex lesen.
- `html/editor-handbuch.html` nicht anfassen.

---

### Task 1: Server-Bibliothek

**Files:**
- Modify: `api/_internal/app/settlement-places.php`
- Test: `api/_internal/app/__tests__/staetten-editor-test.php` (neu)

**Interfaces (Produces):**
```php
const AVESMAPS_STAETTEN_NAMENSNACHBAR_RADIUS = 5.0;          // Karteneinheiten (= 15 Meilen)
function avesmapsInnerortsArtikelSchluessel(string $url): string;
function avesmapsInnerortsKartenArtikelAusZeilen(array $rows): array;   // array<string,true>
function avesmapsInnerortsKartenArtikel(PDO $pdo): array;              // array<string,true>, faellt offen aus: []
function avesmapsInnerortsOhneKartenpunkte(array $zeilen, array $kartenArtikel): array; // Zeilen mit 'wiki_url'
function avesmapsSettlementPlaceListForSettlement(PDO $pdo, string $ortId): array;
function avesmapsSettlementPlaceMove(PDO $pdo, string $publicId, string $zielId, int $userId): array;
function avesmapsSettlementPlaceOrteSuchen(PDO $pdo, string $q, int $limit = 12): array;
function avesmapsSettlementPlaceNamensnachbarn(PDO $pdo, string $ortId): array; // array<string,true> kleingeschriebene Namen
```

- [ ] **Schritt 1: `require_once __DIR__ . '/../wiki/place-scope.php';`** oben in `settlement-places.php`
  (für `AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES` = Dorf … Metropole). Vorher prüfen, dass `place-scope.php`
  keine Seiteneffekte hat und nicht per blankem `require` von einer Datei geladen wird, die auch
  `settlement-places.php` lädt (`git grep -n "place-scope.php"`); sonst die Liste lokal zitieren und
  per Test gegen die Konstante halten.
- [ ] **Schritt 2: Test schreiben** — SQLite-Fixture wie `settlement-places-test.php` (Klasse, die
  MySQL-DDL schluckt), mit `map_features (id, public_id, feature_type, feature_subtype, name,
  properties_json, min_x, min_y, is_active)` und `settlement_place` (Schema dort abschreiben). Fälle:
  1. Schlüssel: `https://www.de.wiki-aventurica.de/wiki/Burg%20Aarkopf` und
     `https://de.wiki-aventurica.de/wiki/Burg_Aarkopf` ergeben denselben Schlüssel; `''` → `''`;
     kein Wirt → `''`.
  2. `…KartenArtikelAusZeilen`: nur `feature_type = location`, aktive, mit
     `properties_json.wiki_settlement.wiki_url`; kaputtes JSON wird übersprungen.
  3. `…KartenArtikel($pdo)` liefert dieselbe Menge wie `…AusZeilen` über dieselbe Fixture.
  4. `…OhneKartenpunkte`: Zeile mit zugewiesener Adresse fällt; **namensgleiche** Zeile mit anderer
     Adresse bleibt; Zeile ohne `wiki_url` bleibt.
  5. `ListForSettlement`: nur aktive, nur dieser Ort, nach Name sortiert, Felder
     `public_id,name,place_type,wiki_url,origin`.
  6. `Move`: Erfolg (Ort-Kennung, Ortsname = Name des Zielpunkts, `updated_at` geändert, Stempel
     `avesmapsSettlementPlaceReadStamp` ändert sich); `not_found` (unbekannt / inaktiv);
     `invalid_target` (Ziel ist Kreuzung/`gebaeude`, inaktiv, unbekannt, gleich dem eigenen Ort);
     `name_taken` (aktive gleichnamige am Ziel); `name_taken_deleted` (inaktive gleichnamige am Ziel);
     in allen Fehlerfällen bleibt die Zeile unverändert.
  7. `Deactivate` setzt jetzt auch `updated_at`.
  8. `OrteSuchen`: nur aktive Siedlungsklassen, Präfixtreffer vor Innentreffern, Deckel greift, `%`/`_`
     im Suchwort werden wörtlich gesucht, `lage` = `properties_json.wiki_settlement.region` sonst `''`;
     `q` unter 2 Zeichen → `[]`.
  9. `Namensnachbarn`: gleichnamiger Punkt 3 Einheiten entfernt → enthalten; 8 Einheiten → nicht;
     der Ort selbst zählt nicht.
- [ ] **Schritt 3: Test laufen lassen** → rot (Funktionen fehlen).
- [ ] **Schritt 4: Implementieren.**
  ```php
  /**
   * Der Vergleichsschluessel einer Wiki-Adresse fuer „ist dieser Artikel einem Kartenpunkt zugewiesen?".
   * Wirt ohne www., Pfad dekodiert, Leerzeichen = Unterstrich, klein. Kein mb_*: beide Seiten gehen
   * hier durch, ein nicht gefaltetes Umlaut-Grossbuchstabe trifft sich also selbst.
   */
  function avesmapsInnerortsArtikelSchluessel(string $url): string
  {
      $url = trim($url);
      if ($url === '') {
          return '';
      }
      $teile = parse_url($url);
      if (!is_array($teile) || empty($teile['host'])) {
          return '';
      }
      $wirt = strtolower((string) preg_replace('~^www\.~i', '', (string) $teile['host']));
      $pfad = rawurldecode((string) ($teile['path'] ?? ''));
      $abfrage = isset($teile['query']) ? '?' . rawurldecode((string) $teile['query']) : '';

      return strtolower($wirt . str_replace(' ', '_', $pfad . $abfrage));
  }
  ```
  - `…KartenArtikelAusZeilen($rows)`: je Zeile `feature_type === 'location'`, `is_active` (fehlt = aktiv),
    `properties_json` dekodieren (String oder Array), `wiki_settlement.wiki_url` → Schlüssel ≠ '' → Menge.
  - `…KartenArtikel($pdo)`:
    ```php
    $sql = "SELECT JSON_EXTRACT(properties_json, '$.wiki_settlement.wiki_url') AS u FROM map_features
             WHERE feature_type = 'location' AND is_active = 1 AND properties_json LIKE '%wiki_settlement%'";
    ```
    Ergebnis per `trim($u, '"')` (MariaDB liefert gequotet, SQLite nicht), dann `stripcslashes`-frei:
    **`json_decode('"' . … . '"')`** nur wenn gequotet — ein Test muss eine Adresse mit `/`-Escape
    (`https:\/\/…`) abdecken. `try/catch (Throwable)` → `[]` (fällt offen aus: dann zeigt die Liste wie
    bisher alles, nie weniger).
  - `…OhneKartenpunkte`: `array_values(array_filter(…))` über `wiki_url`.
  - `ListForSettlement`: `SELECT public_id, name, place_type, wiki_url, origin FROM settlement_place WHERE
    settlement_public_id = :ort AND is_active = 1 ORDER BY name`; fehlende Tabelle → `[]`.
  - `Move`: Rückgabe `['ok' => true, 'ziel_name' => …, 'alter_ort' => …]` oder `['ok' => false, 'code' =>
    'not_found'|'invalid_target'|'name_taken'|'name_taken_deleted', 'message' => <deutscher Satz>]`.
    Ablauf: `avesmapsSettlementPlaceEnsureSchema($pdo)` **vor** `beginTransaction()`; Stätte lesen
    (`is_active = 1`); Zielpunkt lesen (`feature_type='location' AND is_active=1 AND feature_subtype IN
    (…Siedlungsklassen…)`, Platzhalter einzeln erzeugen), `zielId === settlement_public_id` →
    `invalid_target`; Namenskollision am Ziel prüfen (`SELECT is_active FROM settlement_place WHERE
    settlement_public_id = :ziel AND name = :name`); `UPDATE settlement_place SET settlement_public_id =
    :ziel, settlement_name = :zielname, updated_at = :t WHERE public_id = :pid`, `:t =
    (new DateTimeImmutable())->format('Y-m-d H:i:s.v')`; commit; bei Throwable rollBack + weiterwerfen.
    Meldungen: „Die Stätte gibt es nicht (mehr)." · „Das Ziel ist kein Ort auf der Karte." · „In
    {Ziel} gibt es schon eine Stätte „{Name}". Nichts wurde geändert." · „In {Ziel} gab es schon eine
    gelöschte Stätte „{Name}". Nichts wurde geändert."
  - `Deactivate`: `SET is_active = 0, updated_at = :t` (gleiches `:t`-Format).
  - `OrteSuchen`: `q = trim`, `< 2` Zeichen → `[]`; `LIKE :m ESCAPE '!'` mit `!`, `%`, `_` durch `!`
    maskiert, `LIMIT 60`; in PHP: Präfix (strtolower-Vergleich) zuerst, dann Name; `array_slice(0,
    $limit)`; Felder `public_id, name, subtype (= feature_subtype), lage`.
  - `Namensnachbarn`: Ortspunkt (`min_x, min_y`) lesen; nicht gefunden → `[]`; `SELECT name, min_x, min_y
    FROM map_features WHERE feature_type = 'location' AND is_active = 1 AND public_id <> :ort AND min_x
    BETWEEN :x0 AND :x1 AND min_y BETWEEN :y0 AND :y1` (vier getrennte Platzhalter), dann echte
    Distanz `≤ AVESMAPS_STAETTEN_NAMENSNACHBAR_RADIUS`; Menge `strtolower(trim(name))`.
- [ ] **Schritt 5: Test grün**, dazu `settlement-places-test.php` und
  `api/_internal/wiki/__tests__/in-settlement-search-test.php` weiter grün.
- [ ] **Schritt 6: Commit** `feat(staetten): Bibliothek fuer Loeschen, Umhaengen und die Regel „Kartenpunkt schlaegt Innerorts"`.

### ~~Task 2: Die Regel an beiden Erzeugern~~ — ENTFÄLLT (siehe Änderung oben; nicht umsetzen)

**Files:**
- Modify: `api/app/map-features.php` (`avesmapsMapFeaturesInSettlementPlaces` ~Z. 206;
  `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` ~Z. 181 um **1** erhöhen, Kommentar mit Grund)
- Modify: `api/app/map-search.php` (~Z. 97 / ~Z. 388)
- Test: `api/_internal/app/__tests__/staetten-regel-verdrahtung-test.php` (neu)

**Interfaces:** Consumes `avesmapsInnerortsKartenArtikel`, `…AusZeilen`, `…OhneKartenpunkte` aus Task 1.

- [ ] **Schritt 1: Test** (Quelltext per `token_get_all`, Kommentare raus):
  - `avesmapsMapFeaturesInSettlementPlaces` ruft `avesmapsInnerortsKartenArtikel(` und filtert **beide**
    Listen (`$registryRows` und `$storedPlaces`) mit `avesmapsInnerortsOhneKartenpunkte(` **bevor**
    `avesmapsBuildInSettlementPlaceList(` gerufen wird.
  - `map-search.php` filtert `$inSettlementRows` mit `avesmapsInnerortsOhneKartenpunkte(` und
    `avesmapsInnerortsKartenArtikelAusZeilen($rows)` **vor** `avesmapsBuildInSettlementSearchEntries(`.
  - `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` ist größer als der Wert vor diesem Commit (den Wert aus
    `git show HEAD:api/app/map-features.php` lesen).
  - Zusätzlich ausführend: `avesmapsBuildInSettlementPlaceList` mit gefilterten Zeilen aus einer kleinen
    Fixture — die zugewiesene Stätte fehlt, die namensgleiche bleibt.
- [ ] **Schritt 2: rot**, **Schritt 3: umsetzen.** In `map-features.php`: nach dem Laden beider Listen
  ```php
  $kartenArtikel = avesmapsInnerortsKartenArtikel($pdo);
  $storedPlaces = avesmapsInnerortsOhneKartenpunkte($storedPlaces, $kartenArtikel);
  $registryRows = avesmapsInnerortsOhneKartenpunkte($registryRows, $kartenArtikel);
  ```
  (vor dem `if ($registryRows === [] && $storedPlaces === [])`). In `map-search.php` direkt vor der
  Innerorts-Schleife `$inSettlementRows = avesmapsInnerortsOhneKartenpunkte($inSettlementRows,
  avesmapsInnerortsKartenArtikelAusZeilen($rows));`. Beide Dateien müssen `settlement-places.php` laden
  (prüfen; `map-features.php` tut es schon). Kommentar an beiden Stellen: Owner 26.09.2026, „Orte, die auf
  der Karte platziert sind, sind nicht innerorts", beide Erzeuger, kein Namensvergleich.
- [ ] **Schritt 4: grün** + `in-settlement-search-test.php`, `offmap-search-test.php`,
  `settlement-places-test.php` und alle Tests unter `api/app/__tests__` bzw. `api/_internal/app/__tests__`,
  die `map-features.php`/`map-search.php` lesen (`grep -l "map-features.php\|map-search.php"`).
- [ ] **Schritt 5: Commit** `fix(staetten): Orte auf der Karte erscheinen nicht mehr zusaetzlich als Staette ihrer Stadt`.

### Task 3: Editor-Endpunkt

**Files:**
- Create: `api/edit/map/settlement-places.php`
- Test: `api/_internal/app/__tests__/staetten-endpunkt-test.php` (neu)

- [ ] **Schritt 1: Endpunkt** nach dem Muster von `api/edit/map/zoom-bands.php`:
  `require __DIR__ . '/../../_internal/auth.php';` + `require_once` für `_internal/app/settlement-places.php`;
  CORS, `OPTIONS` → 204, nur `POST`, `avesmapsRequireUserWithCapability('edit')`,
  `avesmapsReadJsonRequest()`, `action` (40 Zeichen), `avesmapsCreatePdo`.
  - `list`: `settlement_public_id` Pflicht (sonst 400 `invalid_request`) → Antwort
    `staetten` = je Zeile + `gleichnamig_auf_der_karte` (`strtolower(trim(name))` in `…Namensnachbarn`).
  - `delete`: `public_id` Pflicht; `avesmapsSettlementPlaceEnsureSchema` davor;
    `avesmapsSettlementPlaceDeactivate` → false ⇒ 404 `not_found`; sonst Ort der Stätte **vorher** lesen
    und dessen neue Liste zurückgeben.
  - `move`: `public_id`, `ziel_public_id` Pflicht; Ergebnis von `…Move`; Fehler → HTTP 404
    (`not_found`), 422 (`invalid_target`), 409 (`name_taken`, `name_taken_deleted`) mit der Meldung;
    Erfolg → `staetten` (Liste des **alten** Ortes), `ziel_name`.
  - `orte`: `q` → `orte`.
  - Unbekannte Aktion → 400 `invalid_action`. Auffang-`catch` → 500 `server_error` mit festem Satz, **nie**
    `getMessage()`.
  - Die Listen-Antwort entsteht in EINER Hilfsfunktion im Endpunkt (`avesmapsStaettenEndpunktListe($pdo,
    $ortId)`), die alle drei Aktionen rufen.
- [ ] **Schritt 2: Test** (Quelltext per Tokenizer, ohne Kommentare): Fähigkeit `edit`; nur POST; alle vier
  Aktionen vorhanden; kein `getMessage`; Ensure steht vor jedem Schreibaufruf; die drei Antwortwege
  rufen dieselbe Listenfunktion; Fehlercodes ↔ HTTP-Status wie oben. `php -l`.
- [ ] **Schritt 3: grün, Commit** `feat(staetten): Editor-Endpunkt zum Loeschen und Umhaengen gespeicherter Staetten`.

### Task 4: Das Bauteil „Stätten"

**Files:**
- Create: `css/components/staetten-kasten.css` — **Vertragsblock aus `docs/staetten-kasten-mockup.html`
  zeichengleich** übernehmen (Kopfkommentar: wozu, Mockup-Verweis; Regel „die fs-Klassen werden
  mitbenutzt").
- Create: `js/ui/staetten-kasten.js`
- Test: `js/ui/__tests__/staetten-kasten.test.js` (neu; Bauteil mit gefälschtem DOM/`fetch` AUSGEFÜHRT)

**Interfaces (Produces):**
```js
// global (klassisches Skript), und unter Node per module.exports
function mountStaettenKasten(host, opts)
//   opts: { ortPublicId: string, ortName: string, sektion: Element|null, escape?: fn,
//           fetchImpl?: fn, win?: Window, attachTypeaheadImpl?: fn }
//   -> Promise, erfüllt nach dem ersten Zeichnen
function staettenKastenWikiZahl(ortName, gespeicherteNamen, win) // -> number|null (null = Liste nicht erreichbar)
function staettenKastenNutzlastNachziehen(win, art, staette, alterOrt, zielName) // art: "loeschen"|"umhaengen"
```

**Verhalten** (Spec §5, Mockup Szenen 1–5):
- Markup je Stätte: `.avm-row` (bei offener Falte zusätzlich `fs-row--open`) › `.avm-row__text` ›
  `.avm-row__l1` (Name `.avm-row__name`, Art `.avm-row__kind`) + `.avm-row__l2` (Link auf die Wiki-Adresse,
  Text = Wirt ohne `www.` + ` ↗`, `target="_blank" rel="noopener noreferrer"`; Klasse `warn` und Anhang
  „ · gleichnamiger Punkt auf der Karte" bei `gleichnamig_auf_der_karte`;
  kein weiterer Hinweis) + `.st-aktionen` mit `button.fs-row__edit[data-st-aktion=umhaengen]`
  „⇄" (`aria-label="Umhängen"`, `title="An einen anderen Ort hängen"`) und
  `button.fs-row__remove[data-st-aktion=loeschen]` „✕" (`aria-label="Löschen"`, `title="Stätte löschen"`).
  Alles durch `escape`.
- Genau **eine** Falte offen (`.st-falte` direkt nach der Zeile). Umhängen: `input.st-falte__suche`
  (`type=search`, `placeholder="Neuer Ort …"`), angebunden über `attachTypeahead` (global aus
  `js/ui/source-autocomplete.js`, `minChars: 2`) mit `search: (q, signal) => POST {action:"orte", q}` →
  `orte`; `renderHtml` → `.sac-head` „Orte auf der Karte" + `ul.sac-list` mit `li.sac-item`
  (`.sac-name` mit `<mark>` um den Treffer, `.sac-uses` „Ortsklasse · Lage"; Ortsklasse über
  `avesmapsOrtsklassenLabel`/`LOCATION_TYPE_CONFIG` falls vorhanden, sonst der Schlüssel); `onPick` merkt
  das Ziel und zeigt „„{Name}" nach **{Ziel}** umhängen?" + `.fs-actions` mit `.fs-actions__sek`
  „Abbrechen" und `.fs-actions__prim` „Umhängen" (vor der Wahl: Primärknopf `disabled`). Löschen:
  Satz „Stätte „{Name}" löschen? Sie verschwindet aus der Infobox von {Ort}; ihre Quellen bleiben an ihr
  hängen." + Abbrechen/Löschen.
- Nach Erfolg: Liste aus der Antwort neu zeichnen, Falte zu, Meldezeile `p.fs-add-note.fs-add-note--ok
  [role=status]` („Gelöscht: „{Name}"." / „Umgehängt: „{Name}" liegt jetzt in {Ziel}."),
  `staettenKastenNutzlastNachziehen(…)`. Nach Fehler: Meldezeile `p.fs-add-note` mit `error.message`,
  Falte bleibt offen. Netzfehler: „Keine Verbindung zum Server. Nichts wurde geändert."
- Graue Zeile `p.st-wiki`: `n = staettenKastenWikiZahl(…)`; `n === null` → keine Zeile; `n > 0` und
  gespeicherte vorhanden → „+ {n} weitere aus dem Wiki — hier nicht bearbeitbar."; keine gespeicherten →
  „{n} Stätten aus dem Wiki — hier nicht bearbeitbar." (Einzahl „1 Stätte aus dem Wiki — …"). 
- Sichtbarkeit: 0 gespeicherte **und** (`n === null` oder `n === 0`) → `sektion.hidden = true`; sonst
  `false`. Während `list` lädt: `sektion.hidden = false` und `p.st-wiki` „Stätten werden geladen …".
  Liefert `list` einen Fehler: Meldezeile, Sektion bleibt sichtbar.
- `staettenKastenWikiZahl`: Liste = `win.avesmapsInSettlementPlaces`, sonst (in `try`, fremde Herkunft
  wirft) `win.parent.avesmapsInSettlementPlaces` wenn `win.parent !== win`; keine Array-Liste → `null`.
  Schlüssel über `win.avesmapsStaettenSchluessel` (bzw. Elternfenster) falls Funktion, sonst
  `String(x).trim().toLowerCase()`. Zählt Einträge des Ortes, deren Namensschlüssel **nicht** unter den
  gespeicherten ist.
- `staettenKastenNutzlastNachziehen`: dasselbe Zielfenster; erster Eintrag mit gleichem Namen+Ort:
  `loeschen` → `splice`, `umhaengen` → `settlement = zielName`; danach `avesmapsStaettenIndex = null`
  am Zielfenster und `avesmapsRefreshInfopanel()` falls Funktion. Alles in `try` — ein Fehler hier darf
  den Schreiberfolg nicht als Fehler melden.
- Wiedermontage: `host.__staettenAbbau` (vorigen Typeahead lösen, Zuhörer weg) wird am Anfang gerufen.
  Zuhörer per Delegation am `host`.
- [ ] **Schritt 1: Test** (ausführend, eigenes Mini-DOM oder das Muster aus
  `js/review/__tests__/quellen-*.test.js`): Ruhezustand (3 Zeilen, Hinweise, graue Zeile), Falte
  Umhängen (Suche ruft `orte`, Wahl zeigt Satz, Primärknopf erst danach aktiv, Absenden schickt `move`
  mit beiden Kennungen), Löschen (Rückfrage, `delete`), Erfolg (Neuzeichnen, Meldung, Nutzlast
  nachgezogen, `avesmapsStaettenIndex` null, Infopanel gerufen), Fehler (Meldung, Falte offen),
  Sektion verborgen bei 0/0 und bei 0/`null`, iframe-Fall (Liste nur am `parent`), Escape (Name mit `<`).
- [ ] **Schritt 2: rot, Schritt 3: umsetzen, Schritt 4: grün** + `node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js` grün.
- [ ] **Schritt 5: Commit** `feat(staetten): Bauteil „Staetten" mit Loeschen und Umhaengen`.

### Task 5: Einbau an beiden Stellen

**Files:**
- Modify: `index.html` — (a) vor `<div class="label-edit-section"><div class="label-edit-section-title">Quellen</div>` (~Z. 1446) einfügen:
  `<div class="label-edit-section" id="location-edit-staetten-sektion" hidden><div class="label-edit-section-title">Stätten</div><div id="location-edit-staetten"></div></div>`;
  (b) Skript nur für Editoren, direkt nach der Zeile mit `review-feature-sources.js` (~Z. 3788):
  `<template data-nur-editor><script src="js/ui/staetten-kasten.js"></script></template><script>avesmapsNurEditorSkripte()</script>`.
  💣 Vorher `avesmapsNurEditorSkripte` lesen: lädt es die Vorlagen in Reihenfolge, und lädt
  `source-autocomplete.js` (Z. ~3779) für Besucher mit? Das Bauteil braucht `attachTypeahead` erst
  beim Öffnen der Falte, nicht beim Laden.
- Modify: `css/styles.css` — `@import url("components/staetten-kasten.css");` neben `editor-row.css`.
- Modify: `js/review/review-locations.js` — neue Funktion `mountLocationEditStaetten()` direkt nach
  `mountLocationEditFeatureSources()` gerufen (~Z. 596): Sektion `#location-edit-staetten-sektion` erst
  verbergen; Kennung aus `#location-edit-public-id`, Name aus `#location-edit-name`; leer oder
  `typeof mountStaettenKasten !== "function"` → Sektion bleibt verborgen, Ende; sonst
  `mountStaettenKasten(host, { ortPublicId, ortName, sektion, escape: escapeHtml })`.
- Modify: `html/wiki-sync-settlement-editor.html` — (a) `<link rel="stylesheet" href="/css/components/staetten-kasten.css" />`
  neben `feature-sources.css` (~Z. 809) und `<script src="/js/ui/staetten-kasten.js"></script>` nach
  `review-feature-sources.js` (~Z. 814); (b) in `buildSettlementEditFormHtml` ein Feld `staetten` =
  `detail.on_map === true` ? `<div id="dtStaettenSektion" hidden><div class="dt-grp">Stätten</div><div id="dtStaetten"></div></div>` : `""`;
  (c) in der Zusammensetzung (~Z. 2250) `form.staetten` direkt **vor** `form.sources`; (d) in
  `renderSettlementDetail` direkt nach dem `mountFeatureSourceEditor`-Aufruf (~Z. 1771), unter
  **demselben** Rennwächter: `if (typeof mountStaettenKasten === "function" && $("dtStaetten") &&
  selectedPublicId) mountStaettenKasten($("dtStaetten"), { ortPublicId: selectedPublicId, ortName:
  (payload.detail.properties || {}).name || "", sektion: $("dtStaettenSektion"), escape: settlementEscape });`
- Test: `js/ui/__tests__/staetten-kasten-verdrahtung.test.js` (neu)

- [ ] **Schritt 1: Test** — index.html: Sektion existiert, `hidden`, steht **vor** der Quellen-Sektion,
  Skript im `data-nur-editor`-Template nach `review-feature-sources.js`; `styles.css` importiert die Datei;
  `mountLocationEditStaetten` wird direkt nach `mountLocationEditFeatureSources` gerufen (Funktion
  ausschneiden und mit Attrappen AUSFÜHREN: ohne Kennung bleibt die Sektion verborgen und das Bauteil
  wird nicht gerufen; mit Kennung wird es mit Name+Kennung gerufen); Ortseditor: Link + Skript da,
  `form.staetten` vor `form.sources`, Montage im Rennwächter-Block (Kommentare gestrippt, Reihenfolge
  per Index). Zeilenendenneutral.
- [ ] **Schritt 2: rot, Schritt 3: umsetzen, Schritt 4: grün** + ganzes Testfeld.
- [ ] **Schritt 5: Browser-Sichtprüfung lokal** (`docs-static`-Muster, PHP-Server auf den Worktree): das
  Mockup und ein Bauteil-Testaufbau hell/dunkel — die echte Montage braucht eine Sitzung und wird live
  abgenommen (Task 6).
- [ ] **Schritt 6: Commit** `feat(staetten): Staetten in „Ort bearbeiten" und im Ortseditor loeschen und umhaengen`.

### Task 6: Doku, Push, Abnahme (Controller)

- [ ] AGENTS.md §11: ein Eintrag „Stätten löschen und umhängen" (Endpunkt; ein Bauteil, zwei Montagestellen;
  fs-Klassen mitbenutzt; Nutzlast-Index-Falle; Verweis auf den offenen Teil 2 „innerorts als Prädikat").
  Commit `docs(staetten): …`.
- [ ] Push in EINEM Schritt über einen Wegwerf-Worktree (alles zusammen, denn ohne Task 2 ist nur die
  Oberfläche sichtbar) — Deploy abwarten, Besucher-Karte + Konsole prüfen.
- [ ] Owner-Abnahme (Ablauf): Burg Weißenstein-Hinweis sehen, eine Stätte umhängen und die Infobox
  beider Orte ansehen, eine löschen.
