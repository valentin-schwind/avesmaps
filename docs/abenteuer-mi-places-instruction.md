# Abenteuer — Meisterinformationen-Orte Instruction (MI-Präzedenz)

> **Für die ausführende Session:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (empfohlen)
> oder `superpowers:executing-plans`, Task für Task. Schritte mit `- [ ]` abhaken.
> **Kontext:** `docs/abenteuer-editor-p4-sync-plan.md` (gebaute Basis: `adventures`-Dump-Phase +
> owner-getriggerte `sync_adventures`-Reconcile, override-sicher). Diese Instruction erweitert NUR die
> Orts-Datenquelle innerhalb dieser bestehenden Phase — **keine neue Phase, kein UI-Change.**

**Goal:** Abenteuer-Wiki-Seiten (`{{Infobox Produkt}}`) tragen ein flaches `Ort`-Feld (Komma-Liste
Wikilinks). Viele Abenteuer haben zusätzlich eine `<Titel>/Meisterinformationen`-Unterseite mit einem
eigenen `{{Infobox MI}}`-Template und STRUKTURIERTEN Ortsfeldern (`Startort`/`VorkommendeOrte`/`Endort`/
`VorkommendeRegionen`) — reichhaltiger als `Ort` (echter Start/Ziel/Zwischenstationen/Regionen statt einer
flachen Liste). **MI hat Vorrang**, wenn beides existiert. Owner-Vorgabe: „mir egal wieviel Unterseiten es
sind" — kein Vorabcheck über die Trefferquote, einfach bauen.

**Verifizierte reale Fixture** (echte MediaWiki `action=parse`-API, 2026-07-13, NICHT HTML-Crawl —
`https://de.wiki-aventurica.de/de/api.php?action=parse&page=Aus%20der%20Asche/Meisterinformationen&prop=wikitext&format=json&formatversion=2`):

```
{{Infobox MI
|GeeigneteHelden=
|UngeeigneteHelden=
|Spieldauer=
|AP=1900-2200
|Zeitspanne=
|Startort=[[Gareth]]
|VorkommendeOrte=[[Elenvina]], [[Honingen]], [[Winhall]]
|Endort= [[Punin]]
|VorkommendeRegionen='''[[Albernia]]''', [[Almada]], [[Königreich Garetien]], [[Nordmarken]]
|Spezies=
|VorkommendeProf=
|Spielhilfen=[[Inoffizielle Spielhilfe/Kampagnen#Jahr des Feuers|Sammlung inoffzieller Spielhilfen für JdF]]
|Links=
}}
```

Beachte: `VorkommendeRegionen` mischt Fettung (`'''[[Albernia]]'''`) mit normalen Wikilinks, `Endort` hat
ein führendes Leerzeichen nach `=` — beides bereits von der bestehenden `avesmapsWikiParseAdventurePlaceList()`
toleriert (Wikilink-Regex, sieht keine Fettung/Whitespace), also keine neue Parser-Logik pro Feld nötig,
nur die Feld-NAMEN sind neu.

## Vorabcheck — Ergebnis: Erweiterung, keine Parser-Neuentwicklung

Vorhandene Bausteine (WIEDERVERWENDEN, nicht neu bauen):

- `avesmapsWikiParseAdventurePlaceList(string $ort): array` (`api/_internal/wiki/publication-parsing.php:204`)
  — Wikilink-Liste in Quellreihenfolge; funktioniert pro Feld unverändert (Startort/Endort sind
  Ein-Element-Listen).
- `avesmapsWikiSyncMonitorExtractInfoboxBlock`/`InfoboxName`/`FieldKey`/`ParseTemplateParams`
  (`api/_internal/wiki/sync-monitor-parsing.php:17/50/61/90`) — generischer Infobox-Extraktor, NICHT
  namensgefiltert; `avesmapsWikiParseProductInfobox` (`publication-parsing.php:258`) guardet selbst über
  `FieldKey(InfoboxName(block)) === 'produkt'` — dasselbe Muster liefert `'mi'` für `{{Infobox MI}}`.
- `avesmapsAdventureBuildCatalogStep` (`api/_internal/wiki/adventure-sync.php:255-347`) — EIN
  Full-Dump-Scan-Loop für die komplette `adventures`-Phase (jede Dump-Phase scannt unabhängig den ganzen
  Dump). MI-Erkennung kommt als zweiter Zweig NEBEN dem bestehenden `Produkt`-Zweig (`:290-332`), damit es
  KEINEN zusätzlichen vollständigen Dump-Pass kostet.
- `avesmapsAdventurePlacePlan`/`avesmapsAdventureReconcileEntity` (`:103`/`:553`) — bleiben BYTE-FÜR-BYTE
  unverändert; sie kennen nur `desiredPlaces` (Liste `{sort_order,raw_name,role}`), nicht deren Herkunft.

Fehlt: ein `{{Infobox MI}}`-Parser, eine zweite Herkunfts-Spalte im Place-Staging und eine
Präzedenz-Auswahl beim Lesen (MI > Ort).

## Architektur-Entscheidung: Präzedenz beim LESEN, nicht beim SCHREIBEN

Dump-Seiten sind NICHT garantiert in Eltern→Kind-Reihenfolge (`Aus der Asche` vor oder nach
`Aus der Asche/Meisterinformationen` — beides passiert im selben Scan-Lauf, aber die relative Reihenfolge
ist Dump-Layout, nicht garantiert). Deshalb:

- Ort-Staging und MI-Staging laufen NEBENEINANDER in derselben Tabelle (neue Spalte `source` ∈
  `'ort'|'mi'`); jede Seite schreibt NUR ihre eigenen `source`-Zeilen (eigener DELETE+INSERT-Scope) —
  unabhängig davon, welche der beiden Seiten zuerst gescannt wird, überschreibt keine die andere.
- Die Präzedenz wird beim RECONCILE-Read entschieden (`avesmapsAdventureDesiredPlaces`): MI-Zeilen
  zuerst versuchen, nur wenn keine existieren auf Ort-Zeilen zurückfallen. Robust unabhängig von
  Scan-Reihenfolge und Resume-Zustand.

## Invarianten (Pflicht)

- **MI hat Vorrang** vor Ort, wenn eine MI-Unterseite existiert und mindestens einen Ort-Wikilink liefert;
  sonst Fallback auf Ort (unverändertes Verhalten für Abenteuer ohne MI-Unterseite).
- **Reihenfolge strikt**: `Startort` (role=start, sort_order 0) → `VorkommendeOrte` → `Endort` →
  `VorkommendeRegionen`, alle role=play, in Feld-Reihenfolge, NICHT umsortieren/dedupen.
- **Scan-Reihenfolge-Unabhängigkeit**: Ort- und MI-Staging-Schreiber dürfen sich NIE gegenseitig löschen
  (getrennter `source`-Scope in DELETE/INSERT/UNIQUE KEY).
- **Override-Sicherheit unverändert**: `avesmapsAdventurePlacePlan`/`ReconcileEntity` bleiben unangetastet;
  manuelle/community/suppressed Places sind weiterhin NIE betroffen — die MI-Erweiterung ändert nur, WELCHE
  Wiki-Liste als `desiredPlaces` eingespeist wird, nicht WIE sie override-sicher reconciled wird.
- **Dump-basiert, KEINE HTML-Crawls** (Betreiber-Policy); Verifikation der Feldnamen NUR über die echte
  MediaWiki-`action=parse`-API, niemals generisches WebFetch auf die Artikel-Seite (siehe Fixture oben).
- **STRATO**: keine neue Phase, kein zusätzlicher Full-Scan — der bestehende `adventures`-Phasen-Loop wird
  nur um einen zweiten Zweig erweitert (gleiches Zeitbudget `AVESMAPS_WIKI_DUMP_STEP_SECONDS`).
- **Kein UI-Change nötig**: der bestehende „Abenteuer Syncen & Editieren"-Button
  (`index.html`, `data-wiki-sync-panel-section="adventures"`) triggert bereits „Dump holen" (baut jetzt auch
  MI-Staging) + `sync_adventures` (liest jetzt MI-first) — keine neuen Endpoints/Buttons.

## Datei-Landkarte

| Datei | Aktion |
|---|---|
| `api/_internal/wiki/adventure-sync.php` | **ändern** — `source`-Spalte + Migration, `avesmapsWikiParseAdventureMiInfobox`, `avesmapsAdventureMiParentTitle`, Scan-Erweiterung, `avesmapsAdventureDesiredPlaces`-Präzedenz |
| `api/_internal/wiki/__tests__/adventure-sync-test.php` | **ändern** — Tests für die 2 neuen reinen Funktionen (echte „Aus der Asche"-Fixture) |
| `docs/abenteuer-instruction.md` / `AGENTS.md` §11 | **ändern** — Pointer auf diese Instruction nach Umsetzung |

---

### Task 1: Staging-Schema erweitern (`source`-Spalte, self-healing)

**Files:** Modify `api/_internal/wiki/adventure-sync.php` (`avesmapsEnsureAdventureStagingTables`, `:171-220`).

**Produces:** `wiki_adventure_place_staging` bekommt `source VARCHAR(8) NOT NULL DEFAULT 'ort'`; UNIQUE KEY
wird `(adventure_wiki_key, source, sort_order)` (statt `(adventure_wiki_key, sort_order)`).

- [ ] **Step 1 — CREATE TABLE direkt in der Zielform** anpassen (`:191-199`), damit ein echter Erststart
  (leere DB) nicht erst migrieren muss:
  ```php
  $pdo->exec(
      "CREATE TABLE IF NOT EXISTS wiki_adventure_place_staging (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          adventure_wiki_key VARCHAR(190) NOT NULL,
          source VARCHAR(8) NOT NULL DEFAULT 'ort',
          sort_order INT NOT NULL,
          raw_name VARCHAR(300) NOT NULL,
          UNIQUE KEY uq (adventure_wiki_key, source, sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  );
  ```
- [ ] **Step 2 — Self-healing ALTER** für bereits existierende Staging-Tabellen, direkt nach dem
  bestehenden `cover_source`-Block anhängen (`:213-219`), gleiches Muster (`$columnExists`-Closure ist
  schon da, wiederverwenden):
  ```php
  try {
      if (!$columnExists($pdo, 'wiki_adventure_place_staging', 'source')) {
          $pdo->exec(
              "ALTER TABLE wiki_adventure_place_staging
                  ADD COLUMN source VARCHAR(8) NOT NULL DEFAULT 'ort',
                  DROP INDEX uq,
                  ADD UNIQUE KEY uq (adventure_wiki_key, source, sort_order)"
          );
      }
  } catch (Throwable) {
      // Erststart: die Tabelle wurde von Step 1 gerade erst in der NEUEN Form angelegt, columnExists
      // ist dann bereits true -> dieser Block laeuft nur bei einer schon existierenden Alt-Tabelle.
  }
  ```
  `ADD COLUMN … DEFAULT 'ort'` befüllt bestehende Zeilen automatisch mit `'ort'`, also sind alle heute
  schon gestagten Ort-Zeilen nach der Migration korrekt markiert.
- [ ] **Step 3 — `php -l api/_internal/wiki/adventure-sync.php`** → „No syntax errors". Kein DB-Zugriff in
  dieser Task nötig (reine DDL-Textänderung; gegen eine echte STRATO-DB self-healing erst beim ersten
  „Dump holen" nach Deploy geprüft — NICHT lokal gegen Prod testen, siehe STRATO-Caution in `AGENTS.md`).

---

### Task 2: `{{Infobox MI}}`-Parser + Scan-Erweiterung (TDD)

**Files:** Modify `api/_internal/wiki/adventure-sync.php`; Modify `api/_internal/wiki/__tests__/adventure-sync-test.php`.

**Produces (reine Funktionen, DB-frei):**
- `avesmapsAdventureMiParentTitle(string $pageTitle): ?string` — `null`, wenn der Titel nicht auf
  `/Meisterinformationen` endet, sonst der abgeschnittene Eltern-Titel.
- `avesmapsWikiParseAdventureMiInfobox(string $wikitext): ?array` — `null`, wenn keine `{{Infobox MI}}` im
  Text, sonst `['places' => list<string>]` (Wikilink-Ziele, Reihenfolge `Startort, VorkommendeOrte, Endort,
  VorkommendeRegionen`).

- [ ] **Step 1 — Test schreiben (MUSS fehlschlagen)**, in `adventure-sync-test.php` anhängen (echte
  „Aus der Asche"-Fixture von oben, inkl. Fettungs-/Leerzeichen-Macken):
  ```php
  // ----------------------------------------------------------- MI-PARENT-TITLE ---
  assert(avesmapsAdventureMiParentTitle('Aus der Asche/Meisterinformationen') === 'Aus der Asche');
  assert(avesmapsAdventureMiParentTitle('Aus der Asche') === null);
  assert(avesmapsAdventureMiParentTitle('/Meisterinformationen') === null); // leerer Elternteil -> null
  echo "mi-parent-title ok\n";

  // ----------------------------------------------------------- MI-INFOBOX-PARSER ---
  // Reale "Aus der Asche/Meisterinformationen"-Infobox (action=parse API, 2026-07-13). Fettung um
  // Albernia + fuehrendes Leerzeichen bei Endort sind ECHTE Wikitext-Macken -- der Parser muss beides
  // schlucken (avesmapsWikiParseAdventurePlaceList toleriert das bereits pro Feld).
  $miWt = <<<'WT'
  {{Infobox MI
  |Startort=[[Gareth]]
  |VorkommendeOrte=[[Elenvina]], [[Honingen]], [[Winhall]]
  |Endort= [[Punin]]
  |VorkommendeRegionen='''[[Albernia]]''', [[Almada]], [[Königreich Garetien]], [[Nordmarken]]
  }}
  WT;
  $mi = avesmapsWikiParseAdventureMiInfobox($miWt);
  assert($mi !== null);
  assert($mi['places'] === ['Gareth', 'Elenvina', 'Honingen', 'Winhall', 'Punin', 'Albernia', 'Almada', 'Königreich Garetien', 'Nordmarken']);
  assert(avesmapsWikiParseAdventureMiInfobox("{{Infobox Produkt\n|Titel=X\n}}") === null); // andere Infobox -> null
  assert(avesmapsWikiParseAdventureMiInfobox('') === null);
  echo "mi-infobox ok\n";
  ```
- [ ] **Step 2 — Fail-Lauf:** `php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring
  api/_internal/wiki/__tests__/adventure-sync-test.php` → Erwartung: Fatal „call to undefined function".
- [ ] **Step 3 — Implementieren**, z. B. direkt neben `avesmapsAdventurePlaceNameKey` (`:84`):
  ```php
  const AVESMAPS_ADVENTURE_MI_PAGE_SUFFIX = '/Meisterinformationen';

  /** PURE: der Eltern-Titel einer MI-Unterseite, oder null wenn $pageTitle keine ist. */
  function avesmapsAdventureMiParentTitle(string $pageTitle): ?string
  {
      if (!str_ends_with($pageTitle, AVESMAPS_ADVENTURE_MI_PAGE_SUFFIX)) {
          return null;
      }
      $parent = substr($pageTitle, 0, -strlen(AVESMAPS_ADVENTURE_MI_PAGE_SUFFIX));
      return $parent !== '' ? $parent : null;
  }

  /**
   * Parses a "<Titel>/Meisterinformationen" subpage's {{Infobox MI}} block into an ORDERED place list:
   * Startort (role=start at sort_order 0) first, then VorkommendeOrte, Endort, VorkommendeRegionen (all
   * role=play) -- richer than the flat Produkt-infobox "Ort" field, and given PRECEDENCE over it (see
   * avesmapsAdventureDesiredPlaces). Reuses avesmapsWikiParseAdventurePlaceList() per field -- it already
   * tolerates bold markup and stray whitespace around wikilinks (verified against a real MI page).
   */
  function avesmapsWikiParseAdventureMiInfobox(string $wikitext): ?array
  {
      $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
      $infoboxKey = avesmapsWikiSyncMonitorFieldKey(avesmapsWikiSyncMonitorInfoboxName($block));
      if ($block === '' || $infoboxKey !== 'mi') {
          return null;
      }
      $params = avesmapsWikiSyncMonitorParseTemplateParams($block);

      $places = array_merge(
          avesmapsWikiParseAdventurePlaceList((string) ($params['Startort'] ?? '')),
          avesmapsWikiParseAdventurePlaceList((string) ($params['VorkommendeOrte'] ?? '')),
          avesmapsWikiParseAdventurePlaceList((string) ($params['Endort'] ?? '')),
          avesmapsWikiParseAdventurePlaceList((string) ($params['VorkommendeRegionen'] ?? ''))
      );

      return ['places' => $places];
  }
  ```
- [ ] **Step 4 — Grün-Lauf.**
- [ ] **Step 5 — Scan-Loop erweitern** (`avesmapsAdventureBuildCatalogStep`, `:255-347`). Ort- und
  MI-Zweig teilen sich EIN Insert/Delete-Statement-Paar mit `:src`-Parameter (ersetzt `:275-280`):
  ```php
  $deletePlaces = $pdo->prepare(
      'DELETE FROM wiki_adventure_place_staging WHERE adventure_wiki_key = :wk AND source = :src'
  );
  $insertPlace = $pdo->prepare(
      'INSERT INTO wiki_adventure_place_staging (adventure_wiki_key, source, sort_order, raw_name)
       VALUES (:wk, :src, :so, :rn)
       ON DUPLICATE KEY UPDATE raw_name = VALUES(raw_name)'
  );
  ```
  `$pageTitle` VOR die if/elseif ziehen (heute erst in Zeile 294 gelesen, INNERHALB des Produkt-Zweigs):
  ```php
  $pageTitle = (string) ($page['title'] ?? '');
  $wikitext = (string) ($page['wikitext'] ?? '');
  if (stripos($wikitext, 'Produkt') !== false && (int) ($page['ns'] ?? 0) === 0 && ($page['redirect'] ?? null) === null) {
      // … bestehender Produkt-Zweig (:290-332) UNVERAENDERT, ausser: beide bestehenden
      // $deletePlaces->execute([...]) (:319) / $insertPlace->execute([...]) (:326) Aufrufe
      // brauchen zusaetzlich 'src' => 'ort' im Argument-Array.
  } elseif ((int) ($page['ns'] ?? 0) === 0 && ($page['redirect'] ?? null) === null) {
      $parentTitle = avesmapsAdventureMiParentTitle($pageTitle);
      if ($parentTitle !== null) {
          $mi = avesmapsWikiParseAdventureMiInfobox($wikitext);
          if (is_array($mi) && $mi['places'] !== []) {
              $wikiKey = avesmapsPublicationCatalogWikiKeyForTitle($parentTitle);
              if ($wikiKey !== '') {
                  $deletePlaces->execute(['wk' => $wikiKey, 'src' => 'mi']);
                  $sortOrder = 0;
                  foreach ($mi['places'] as $rawName) {
                      $rawName = trim((string) $rawName);
                      if ($rawName === '') {
                          continue;
                      }
                      $insertPlace->execute(['wk' => $wikiKey, 'src' => 'mi', 'so' => $sortOrder, 'rn' => mb_substr($rawName, 0, 300, 'UTF-8')]);
                      $sortOrder++;
                  }
                  // KEIN $found++ hier -- $found zaehlt wiki_adventure_catalog-Upserts (avesmapsAdventureCountCatalog-
                  // relevant); die MI-Zeile schreibt nur Place-Staging, keinen Katalog-Row. pages_scanned zaehlt die
                  // Unterseite trotzdem mit (bereits oben im Loop-Head inkrementiert).
              }
          }
      }
  }
  ```
  Titel-Suffix-Check ist billig (kein Wikitext-Scan) — Produkt- und MI-Titel schließen sich ohnehin aus,
  `elseif` ist rein klarstellend.
- [ ] **Step 6 — `php -l`**, dann Test erneut grün. **Commit** (nur `adventure-sync.php` +
  `__tests__/adventure-sync-test.php`).

---

### Task 3: Präzedenz beim Reconcile (`avesmapsAdventureDesiredPlaces`)

**Files:** Modify `api/_internal/wiki/adventure-sync.php` (`avesmapsAdventureDesiredPlaces`, `:531-543`).

- [ ] **Step 1 — Query auf `source` einschränken, MI zuerst versuchen, sonst Ort-Fallback:**
  ```php
  function avesmapsAdventureDesiredPlaces(PDO $pdo, string $wikiKey): array
  {
      $stmt = $pdo->prepare(
          'SELECT sort_order, raw_name FROM wiki_adventure_place_staging
            WHERE adventure_wiki_key = :wk AND source = :src ORDER BY sort_order ASC'
      );
      $rows = [];
      foreach (['mi', 'ort'] as $source) {
          $stmt->execute(['wk' => $wikiKey, 'src' => $source]);
          $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
          if ($rows !== []) {
              break; // MI hat Vorrang -- nur wenn KEINE MI-Zeilen existieren, auf Ort zurueckfallen
          }
      }
      $out = [];
      foreach ($rows as $row) {
          $sortOrder = (int) $row['sort_order'];
          $out[] = ['sort_order' => $sortOrder, 'raw_name' => (string) $row['raw_name'], 'role' => $sortOrder === 0 ? 'start' : 'play'];
      }
      return $out;
  }
  ```
  Diese Funktion ist NICHT DB-frei (nimmt `PDO $pdo` entgegen) → kein Platz im reinen Unit-Test-Kern; die
  Präzedenz wird stattdessen end-to-end verifiziert (Step 2), nicht per PHP-Assert-Skript.
- [ ] **Step 2 — `php -l`.** Kein lokaler DB-Test (STRATO-Caution: keine schweren Endpoints
  probieren/loopen) — Verifikation erst beim nächsten ECHTEN Owner-Lauf „Dump holen" + „Abenteuer syncen"
  (🔧 Owner-Aktion — wie der gesamte Rest von Phase 4 ist auch dieser Pfad bis dahin E2E-ungetestet, siehe
  `docs/abenteuer-editor-p4-sync-plan.md` Status-Header). Danach stichprobenartig `adventure_place` für
  `wiki_key = avesmapsPublicationCatalogWikiKeyForTitle('Aus der Asche')` prüfen: erwartet 9 Zeilen
  (Gareth role=start, dann Elenvina/Honingen/Winhall/Punin/Albernia/Almada/Königreich Garetien/Nordmarken
  role=play), NICHT die alte flache `Ort`-Liste.
- [ ] **Step 3 — Commit.**

## Nacharbeit (nach Umsetzung + erstem echten Sync)

- `AGENTS.md` §11 Abenteuer-Absatz: Satz ergänzen, dass MI-Unterseiten (wenn vorhanden) Vorrang vor der
  flachen `Ort`-Liste haben, mit Pointer auf diese Instruction.
- Owner-Stichprobe wie in Task 3 Step 2 — dieser Agent baut nur, der Prod-Reconcile-Lauf ist
  owner-getriggert (gleiche Regel wie der Rest von Phase 4).
