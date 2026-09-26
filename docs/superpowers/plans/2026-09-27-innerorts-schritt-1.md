# Innerorts als eigenes Prädikat — Schritt 1 — Implementierungsplan

> **Für ausführende Agenten:** PFLICHT-SKILL: superpowers:subagent-driven-development. Schritte als Checkbox.

**Ziel:** Stadtviertel und Bauwerke gehören über ein Feld „Innerorts" (Wiki-Stand, Override, ↺) zu einer Stadt;
„⊖ Von der Karte nehmen" macht einen Punkt zur Stätte seiner Stadt, „● Auf die Karte setzen" holt ihn zurück;
die Stättenliste führt innerorts-Punkte mit `⊕`-Sprung.

**Spec:** `docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md` (§1–§7, §8 Schritt 1; §4.3 und §7a sind
Schritt 2/3 und hier NICHT zu bauen) · **Mockup (mit Vertrag):** `docs/innerorts-mockup.html`

## Globale Randbedingungen

- Worktree `…/scratchpad/innerorts`, Branch `innerorts-praedikat`; **nie** im Hauptbaum `C:\GIT\avesmaps` arbeiten
  (kein checkout/stash/reset dort, nicht schreiben). Bash startet in `C:\GIT\avesmaps` → `cd` voranstellen.
- Kein Push durch Umsetzer; Commit-Nachricht per Datei, Deutsch, letzte Zeile `Co-Authored-By: …`; Stage per Pfad.
- PHP 8 strict; live MariaDB, Tests SQLite. PDO-Platzhalter nie doppelt im selben Statement (HY093). `Ensure…`-DDL
  vor Transaktionen. Kein `getMessage()` an Clients. Kein `mb_*` in neuen Server-Funktionen.
- Hausumschlag `{ok:true,…}` / `{ok:false,error:{code,message}}`; Meldungen Deutsch, Codes englisch.
- Tokens aus `css/base/tokens.css`, kein Blau; eigene vollständige HTML-Maskierung (`& < > " '`) in neuen Bauteilen.
- Quelltext-Tests zeilenendenneutral und ohne Kommentare; Bauteile AUSFÜHREN statt per Regex lesen.
- Ganzes Testfeld vor jedem Commit (Muster aus `.github/workflows/deploy-avesmaps-strato.yml`, parallel, mit
  Dateizählung); vorbestehend rot nur `api/_internal/linkcheck/__tests__/link-url-test.php`; bis Task 4 zusätzlich
  `tools/mockup-vertrag/__tests__/mockup-vertrag.test.js` (der Vertrag des Mockups wartet auf Task 4).
- `html/editor-handbuch.html` nicht anfassen.
- 🔴 **„Gespeichert ist, was gilt"** (Spec §5): kein Leser rechnet den Wiki-Stand zur Laufzeit nach.
- 🔴 **Ein Objekt, eine Ablage** (Spec §3): „Von der Karte nehmen" legt KEINE Zeile in `settlement_place` an.

---

### Task 1: Bibliothek `api/_internal/app/innerorts.php`

**Files:** Create `api/_internal/app/innerorts.php`, Test `api/_internal/app/__tests__/innerorts-test.php`.

**Interfaces (Produces):**
```php
const AVESMAPS_INNERORTS_KLASSEN = ['gebaeude', 'stadtviertel'];
function avesmapsInnerortsIstKlasse(string $subtype): bool;
function avesmapsInnerortsOrtVon(array $properties): string;          // '' = keiner
function avesmapsInnerortsVonDerKarte(array $properties): bool;
function avesmapsInnerortsWikiStand(PDO $pdo, array $properties): string;  // public_id der Stadt aus dem Artikel, '' = keiner
function avesmapsInnerortsZielPruefen(PDO $pdo, string $ortId, string $eigeneId): ?string; // null = ok, sonst Meldung
function avesmapsInnerortsSetzen(array $properties, string $ortId, string $herkunft): array; // 'wiki'|'manual'; '' löst
function avesmapsInnerortsWikiNachziehen(PDO $pdo, string $publicId, int $userId): bool;  // true = geschrieben
function avesmapsInnerortsVonDerKarteNehmen(PDO $pdo, string $publicId, int $userId): array; // ok|code|message
function avesmapsInnerortsAufDieKarteSetzen(PDO $pdo, string $publicId, int $userId): array;
function avesmapsInnerortsEndgueltigEntfernen(PDO $pdo, string $publicId, int $userId): array; // Merker weg
function avesmapsInnerortsPunkteFuerStaetten(PDO $pdo): array;  // Einträge für in_settlement_places
function avesmapsInnerortsAusWikiLauf(PDO $pdo, bool $apply, int $limit, int $userId): array; // Trockenlauf-Vorgabe
```

Regeln:
- Ablage (Spec §3): `properties.innerorts = {ort: <public_id>}` bzw. zusätzlich `von_der_karte: true`; Herkunft in
  `properties.field_origins.innerorts` (`wiki`|`manual`) — **mit dem vorhandenen Stempler**
  (`api/_internal/map/field-origins.php`), keine Abschrift.
- `avesmapsInnerortsWikiStand`: Artikel-Titel aus `properties.wiki_settlement.title` (sonst `name`) →
  `wiki_sync_pages.standort` dieser Seite (bei Stadtteilen setzt der Dump dort `[[Stadt]]`, siehe
  `api/_internal/wiki/dump-entity-scan.php` ~Z. 914) → Scope-Klassifikator (`avesmapsPlaceScopeClassifyWithIndex`,
  `api/_internal/wiki/place-scope.php`, Index über `avesmapsPlaceScopeLoadIndex`) → nur `inside` → Stadtname →
  **eindeutiger** aktiver Kartenpunkt der Siedlungsklassen (Dorf … Metropole) mit diesem Namen (gefaltet wie der
  Klassifikator) → `public_id`. Jede Unsicherheit → `''`. Fehlende Tabelle/Spalte → `''` (fällt offen aus).
- Zielprüfung: aktiver `location`-Punkt mit Siedlungsklasse, nicht der Punkt selbst.
- `…WikiNachziehen`: liest den Punkt; nur `gebaeude`/`stadtviertel`; ist die Herkunft `manual` → nichts; sonst
  Wiki-Stand setzen (Herkunft `wiki`) oder, wenn `''`, einen bisher wiki-stammenden Wert entfernen; nur bei echter
  Änderung schreiben (`map_features` + `revision` + `map_revision`-Bump nach Hausmuster + Protokoll).
- `…VonDerKarteNehmen`: nur aktiver Punkt mit `innerorts.ort` (sonst `invalid_state`); Kraftlinien-Riegel wie
  `avesmapsDeleteMapFeature` (`avesmapsAssertNoPowerlineAnchoredAt`); `is_active = 0` + Merker; Protokoll
  `take_off_map` mit Vorher-Schnappschuss in der Form, die `avesmapsUndoAuditChange` für `delete_feature` versteht
  (Spalten wie `avesmapsDeleteFeatureUndoColumns`) — Rückgängig muss ohne Sonderfall funktionieren; sonst die
  Undo-Spaltenliste für die neue Aktion ergänzen (eine Zeile) und das im Test belegen.
- `…AufDieKarteSetzen`: nur inaktiver Punkt MIT Merker (sonst `invalid_state`); `is_active = 1`, Merker weg,
  Position unverändert; Protokoll `put_on_map`.
- `…EndgueltigEntfernen`: nur inaktiver Punkt mit Merker; Merker (und `innerorts`) weg, bleibt inaktiv; Protokoll.
- `…PunkteFuerStaetten`: aktive Punkte mit `innerorts.ort` **und** inaktive mit Merker; Eintrag
  `{name, settlement: <Name der Stadt>, type: <place_kind-Label oder „Stadtviertel">, wiki_url, public_id,
  auf_der_karte: bool}`; Stadtname aus dem Stadtpunkt (ein Abfragedurchgang, kein N+1); Stadt nicht (mehr) aktiv →
  Eintrag entfällt.
- Admin-Lauf: alle `gebaeude`/`stadtviertel`-Punkte mit Wiki-Zuweisung, Herkunft nicht `manual`; Trockenlauf
  liefert Anzahl, Stichprobe (Name → Stadt); `apply` schreibt über `…WikiNachziehen`; gedeckelt.

- [ ] Test (SQLite-Fixture nach `api/_internal/app/__tests__/staetten-editor-test.php`; `wiki_sync_pages` mit
  `title, standort`; Punkte, Städte): jede Funktion inkl. Riegel und Fehlercodes; Wiki-Stand für einen Stadtteil
  („[[Gareth]]"), für einen Standort außerhalb (`''`), für eine doppeldeutige Stadt (`''`); `manual` wird nie
  überschrieben; Undo nach `take_off_map` stellt `is_active` und Properties her; Admin-Lauf Trockenlauf schreibt
  nichts.
- [ ] rot → umsetzen → grün; Commit `feat(innerorts): Bibliothek fuer das Feld Innerorts, Von der Karte nehmen und Auf die Karte setzen`.

### Task 2: Server-Verdrahtung

**Files (Modify):** `api/_internal/map/features.php` (`avesmapsUpdatePointFeatureDetails`), `api/edit/map/features.php`,
`api/_internal/wiki/settlements.php` (`avesmapsWikiSettlementAssignTo`, `avesmapsWikiSettlementBulkConnect`),
`api/app/map-features.php`, `api/app/map-search.php`, `api/edit/map/settlement-places.php`; Tests neu.

- [ ] **update_point:** Rumpffeld `innerorts_ort` (string, `''` = keiner) und `innerorts_wiki` (bool, „per ↺ auf
  Wiki-Stand") verarbeiten: nur bei Klasse `gebaeude`/`stadtviertel`; Zielprüfung; Herkunft `manual` bzw. `wiki`;
  bei anderer Ortsgröße `innerorts` entfernen. Rumpf ohne diese Felder → Feld unverändert (alte Clients!). Danach
  `avesmapsInnerortsWikiNachziehen`, wenn sich die Wiki-Zuweisung geändert hat.
- [ ] **Wiki-Zuweisungswege:** nach dem Schreiben von `properties.wiki_settlement` in `AssignTo` und `BulkConnect`
  (und jedem weiteren Schreiber — **per grep auf `'wiki_settlement'` als Schreibschlüssel vollständig erheben** und
  im Bericht auflisten) `avesmapsInnerortsWikiNachziehen` rufen, NACH der eigenen Transaktion. Wächter-Test: zählt
  die Schreiber repoweit und verlangt je Schreiber den Aufruf.
- [ ] **Endpunkt features:** Aktionen `take_off_map`, `put_on_map` (Sperre/Fähigkeit wie `delete_feature`).
- [ ] **Nutzlast:** `avesmapsMapFeaturesInSettlementPlaces` bekommt die dritte Quelle
  `avesmapsInnerortsPunkteFuerStaetten`; abgeleitete (Wiki-)Stätten, deren Artikel-Schlüssel
  (`avesmapsInnerortsArtikelSchluessel`) einem innerorts-Punkt gehört, fallen weg (`avesmapsInnerortsOhneKartenpunkte`
  mit genau dieser Menge — nicht mit allen Kartenpunkten!). `public_id`/`auf_der_karte` reisen mit.
  `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` + 1 mit Kommentar.
- [ ] **Suche:** von der Karte genommene Punkte erscheinen als `in_settlement`-Treffer ihrer Stadt (dieselbe Bauform);
  aktive innerorts-Punkte bleiben normale Treffer. Abgeleitete Treffer desselben Artikels fallen weg.
- [ ] **Stätten-Endpunkt:** `list` liefert zusätzlich die Punkte dieser Stadt als
  `{public_id, name, place_type, wiki_url, origin: 'karte', art: 'punkt', auf_der_karte, gleichnamig_auf_der_karte: false}`;
  `move` bei einem Punkt setzt `innerorts.ort` (Herkunft `manual`); `delete` bei einem Punkt ruft
  `…EndgueltigEntfernen` (nur für von der Karte genommene; aktive → `invalid_state`); neue Aktion `put_on_map`;
  neue Admin-Aktion `innerorts_aus_wiki` (Fähigkeit `admin`, Trockenlauf-Vorgabe).
- [ ] Tests je Punkt (Endpunkt-Verdrahtung per Tokenizer; Nutzlast-Bauer und Suche mit Fixture AUSGEFÜHRT).
- [ ] Commit `feat(innerorts): Server kennt das Feld Innerorts, Von der Karte nehmen und die Staettenliste mit Kartenpunkten`.

### Task 3: Das Feld „Innerorts" in beiden Editoren

**Files:** `index.html` (#location-edit-dialog), `js/review/review-locations.js`, `html/wiki-sync-settlement-editor.html`,
`js/ui/staetten-kasten.js` bzw. neues kleines Bauteil `js/ui/innerorts-feld.js` (eine Fassung für beide Seiten,
Mockup Szenen 1–2), CSS aus dem Mockup-Vertrag in `css/components/staetten-kasten.css`; Tests.

- [ ] Zeile „Innerorts" unter Ortsgröße/Art, nur bei `gebaeude`/`stadtviertel`, beim Ortsgrößenwechsel sofort
  ein-/ausgeblendet. Anzeige nach Wiki-Override-Muster (`js/ui/wiki-feld-herkunft.js`, `.k.ovr`/`.wiki-alt`/`.dt-old`/
  `.dt-reset` bzw. die Entsprechung des Kartendialogs — so, wie Name/Einwohner dort gebaut sind).
- [ ] Ändern: Ortssuche (`attachTypeahead`, Stätten-Endpunkt `action: orte`); `✕` löst; `↺` setzt auf Wiki-Stand
  (sendet `innerorts_wiki: true`). Der Wiki-Stand kommt mit dem Detail des Punkts (vom Server mitliefern:
  `innerorts_wiki_stand` = Stadt-Kennung + Name, berechnet beim LESEN des Editordetails — das ist ein Editor-Lesepfad,
  keine Kartennutzlast).
- [ ] Speichern über die vorhandenen Wege (`buildLocationEditPayload`, `buildSettlementSavePayload`), Felder aus Task 2.
- [ ] Tests (ausgeführt): Sichtbarkeit je Ortsgröße, drei Anzeigezustände, Rumpf beim Speichern, ↺.
- [ ] Commit `feat(innerorts): Feld Innerorts in „Ort bearbeiten" und im Ortseditor`.

### Task 4: Gesten, Stätten-Kasten, `⊕`

**Files:** `js/ui/popups.js` (Kachelband), `js/routing/routing.js` (Klick-Verteiler ~Z. 997),
`js/map-features/map-features-location-editing.js` (neben `deleteLocationMarker`), `js/ui/staetten-kasten.js`,
`js/map-features/map-features-settlement-places.js`, `css/components/staetten-kasten.css`; Tests.

- [ ] Kachel `⊖` „Von der Karte nehmen" (Glyph in `POPUP_ACTION_GLYPHS`) vor „Ort löschen", nur bei `innerorts`;
  Rückfrage-/Meldungstexte wörtlich aus Spec §4.1; nach Erfolg Marker lokal entfernen und Stätten-Index verwerfen.
  „Ort löschen" bei innerorts-Punkten mit dem ergänzten Rückfragetext.
- [ ] Stätten-Kasten: drei Sorten (Spec §6.3, Mockup Szene 5/6): `⊕` springt (`findLocationMarkerByPublicId` +
  Popup), `●` ruft `put_on_map` und fliegt hin, `⇄`/`✕` je Sorte.
- [ ] Infobox-Zeile „Stätten": Einträge mit `auf_der_karte` bekommen `button.innerorts-sprung` „⊕" hinter dem Namen
  (Besucher sehen es); Klick fliegt auf den Punkt und öffnet seine Infobox.
- [ ] CSS-Vertrag aus `docs/innerorts-mockup.html` zeichengleich in `css/components/staetten-kasten.css` →
  `mockup-vertrag.test.js` grün.
- [ ] Tests (ausgeführt) je Punkt. Commit `feat(innerorts): Von der Karte nehmen, Auf die Karte setzen und Sprung aus der Staettenliste`.

### Task 5: Doku (Controller)

- [ ] AGENTS.md §11 Eintrag; Stätten-Spec: falsche Zeile „Heute genau ein Fall: Burg Weißenstein" korrigieren
  (gemessen: der Kartenpunkt liegt ~86 Einheiten entfernt, also kein Treffer); Push nach Gesamtprüfung.
