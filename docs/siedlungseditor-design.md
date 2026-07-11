# Siedlungseditor — Design-Spec (Brainstorming-Ergebnis 2026-07-07)

> **Status:** GEBAUT & live — `html/wiki-sync-settlement-editor.html` (~2150 Z.,
> inkl. Multi-Source-Editor). Dieses Doc ist die historische Design-Spec.
>
> ⚠️ **Design-Korrektur (2026-07-11):** Die unten (§2) genannte Palette mit
> `--accent:#0078a8` ist **Blau** und widerspricht der seither finalisierten
> Designsprache (`docs/design-language.md`: **kein Blau**; immer Tokens aus
> `css/base/tokens.css`; gilt ausdrücklich auch für „the editor"). Die Farbwerte
> hier sind **nicht** maßgeblich — Akzent = Coat-Gold (`--color-accent`), nicht
> `#0078a8`. Der Editor-Code trägt die blaue Palette noch (offener Migrations-
> Rückstand, geteilt mit `wiki-sync-monitor.html` + weiteren Editoren).
> **Grundlage:** `docs/siedlungseditor-brief.md` (gegroundete Datei-/Datenreferenzen,
> die kniffligen Teile, §9-Owner-Entscheidungen). Diese Spec **ergänzt** den Brief um
> die im Brainstorming getroffenen UI-/Komponenten-Entscheidungen; der Brief bleibt die
> Referenz für Datei-Zeilen und Datenmodell.

## 1. Ziel & Scope

Ein neuer **Siedlungseditor**, geöffnet wie der Territoriumseditor über einen
Button im **WikiSync → Siedlungen**-Tab. Er spiegelt den Territoriumseditor
(3 Spalten, Toolbar, Override-System, Wappen), bedient aber **Siedlungen** und
ordnet sie ihren **Herrschaftsgebieten** zu (per Ray-Casting + manuellem Override).

- **Nur Edit-Mode.** Das öffentliche Frontend ändert sich **nicht**. Jeder
  Karten-Filter des Editors ist edit-mode-only, reversibel und darf **nicht** in
  die öffentliche Ansicht lecken.
- **UI-Strings Deutsch**, Code/Commits/interne API-`message`s Englisch,
  `error.code`-Werte Englisch. Domänen-Slugs unangetastet.

## 2. Architektur & Einbettung

- **Neue Standalone-Datei** `html/wiki-sync-settlement-editor.html` (Muster:
  `html/wiki-sync-monitor.html`). Gleiches `.cols`-Flex-Layout + `.btn2`-Toolbar;
  **Farben nach Designsprache** — `css/base/tokens.css` einbinden, die lokalen
  `--bg`/`--panel`/`--line`/`--fg`/`--accent` auf die Tokens mappen; **kein Blau**,
  Akzent = `--color-accent` (Coat-Gold), nicht `#0078a8` (siehe Korrektur oben).
- **Öffnen:** neuer Button „WikiSync & Editor" im Siedlungen-Tab
  (`index.html:407–411`, `js/review/review-settlement-list.js`), der ein Overlay
  mit `<iframe src="/html/wiki-sync-settlement-editor.html?v=…">` baut — analog
  `openAvesmapsSyncEditorOverlay()` (`js/review/review-wiki-sync.js:1016–1077`).
- **Asset-Versionierung:** die dynamisch geladenen Editor-Assets (HTML/CSS/JS)
  hängen an `ASSET_VERSION` in
  `js/territory/territory-editor-inline-host.js` → **bei jeder Änderung bumpen**
  (AGENTS.md §7), plus einmal Hard-Reload nach Edit von `inline-host.js`.

## 3. Layout — drei Spalten (Mockup v2)

Referenz: das inline gerenderte **Mockup v2** dieser Session. Aufbau von oben:

- **Titelzeile:** „Siedlungseditor" + Schließen (Overlay).
- **Toolbar (Menüband):** drei `.btn2`-Buttons (Titel 13 px fett, Untertitel 11 px):
  1. **`Siedlungen zuordnen`** (primär) — globaler Ray-Cast über **alle**
     Siedlungen; öffnet den Dry-run-Dialog (§6).
  2. **`Nur Auswahl anzeigen`** (Toggle) — Karten-Filter (§8).
  3. **`Wappen lokalisieren`** — Bulk-Download gemeinfreier Wappen (Muster
     `btnLocalizeCoats` im Territoriumseditor).
- **Statuszeile:** Status-Text links, globaler **Kontinent-Dropdown** rechts
  (filtert beide Listen; Default Aventurien).

### 3.1 LINKS — Territorien (Filter, read-only)

- Read-only Abbild des bestehenden Baums (`model_tree` /
  `js/territory/territory-wiki-tree.js`, `buildTree` über `parent_wiki_key`).
- **Mehrfachauswahl per Häkchen**, **Tri-State**: `aus` / `gewählt` /
  `teilweise` (Ahnenknoten, wenn ein Nachfahre gewählt ist).
- Suche (in dieser Auswahl). Zähler je Knoten = Anzahl Siedlungen darunter
  (Nachfahren-Aggregat).
- **Kern-Invariante:** Ahnen/Nachfahren **immer** über `parent_wiki_key`,
  **nie** über `affiliation_path`.

### 3.2 MITTE — Siedlungen (flache Liste)

Zwei-Achsen-Modell (die eigentliche Design-Entscheidung dieser Session):

- **Achse `on_map` = Tab-Leiste:** `Alle` / `Auf Karte` / `Nur Wiki` (mit Zählern,
  wie `settlementListView` heute). Reine Wiki-Orte bleiben sichtbar, sind aber
  nicht ray-castbar (§3.3).
- **Achse Zuordnung = kombinierbarer Filter-Chip** „⚠ Nicht zugeordnet (N)"
  (amber) in der Filterzeile — **kein** vierter Tab, weil man „Auf Karte **und**
  nicht zugeordnet" gleichzeitig sehen will.
- Zusätzliche Filter (wie heute, `review-settlement-list.js`): **Suche**, **Typ**
  (Ortsgröße), **Quelle** (`wiki`/`andere`/`keine`); **Kontinent** global in der
  Statuszeile.
- **Zeilen zweizeilig:** Zeile 1 = Name + Typ; Zeile 2 = Zuordnungsstatus,
  grün `✓ <Gebiet>` **oder** amber `⚠ nicht zugeordnet`.
- **Verkopplung mit LINKS:** ein Häkchen an Knoten **N** zeigt Siedlungen, deren
  `territory_wiki_key` in der **Nachfahren-Menge von N** liegt (Union über alle
  angehakten Knoten; DFS über `parent_wiki_key`-Kinder). Die Tri-State-Kaskade
  ist **reine UI** — gefiltert wird über die Nachfahren-Mengen-Prüfung.
- **Chip-Interaktion:** „Nicht zugeordnet" meint On-Map-Orte mit
  `territory_wiki_key = null` (Meer/Lücke/noch nicht gecastet). Reine Wiki-Orte
  zählen **nicht** als Lücke. Chip aktiv + Baum-Auswahl links ist logisch leer →
  der Chip blendet die Baum-Auswahl aus, solange er an ist.

### 3.3 RECHTS — Eigenschaften & Overrides

- **Wappen-Block** oben: Vorschau + Quelle/Lizenz-Punkt + „Ersetzen/hochladen"
  (Muster `settlement-coat-upload.php`, Lizenz-Radio public_domain/CC-BY).
- **Gruppen:** **Identität** / **Lage & Zugehörigkeit** / **Wiki & Quelle**.
  (Abweichung vom §9-Default: Wappen als eigener Block oben statt eigener Gruppe;
  „Overrides" nicht als Gruppe, sondern **inline pro Feld** + Footer-Summe — so wie
  es der Territoriumseditor real tut.)
- **Override-Muster inline:** `<alt> → <neu>`, Badge `✎ manuell`, Reset `↺`,
  `effVal(n,key) = override ?? wiki` (Muster `DETAIL_FIELDS`,
  `wiki-sync-monitor.html:580–708`). Footer: Zahl aktiver Overrides + „alle
  zurücksetzen".
- **Lage & Zugehörigkeit** (der neue Kern):
  - **Territorium** — grüner Badge `✓ <Gebiet>` (Ray-Cast, tiefste Ebene) mit
    Herkunftshinweis; **„ändern"-Dropdown** setzt einen **manuellen Override**
    (Territorium-Auswahl) der den Auto-Wert schlägt.
  - **Region** / **Staat** — Wiki-Freitexte (unverändert, mit Wiki-Badge).
- **Wiki & Quelle:** Wiki-Link + das neue **„Andere Quelle"**-Feld
  (Editoren-weite Einführung `c1c86a0f`/`795d35f2`).

## 4. Datenmodell & Persistenz

Siedlung = `map_features`-Zeile (`feature_type='location'`,
`feature_subtype ∈ {metropole, grossstadt, stadt, kleinstadt, dorf, gebaeude}`);
Metadaten in `properties_json` (`wiki_settlement`, `coat`, Overrides,
`geometry_json` = Point `[lng, lat]`). Details: Brief §4.

**Neue Zuordnung (§9.1 — Owner-entschieden):**

- **`properties_json.territory_wiki_key`** (String, `null` = nicht zugeordnet).
  Kein Schema-Migration, self-healing, wie die bestehenden Map-Overrides.
- Optional zusätzlich **`properties_json.territory_public_id`** als stabile
  Referenz (falls sich ein `wiki_key` mal ändert).
- **Herkunft/Override:** ein Feld hält den Modus fest, damit der manuelle Override
  den Ray-Cast schlägt und der globale Lauf ihn **nicht** überschreibt
  (Vorschlag: `properties_json.territory_source ∈ {raycast, manual}`; im Plan
  final festzurren). Ray-Cast schreibt nur, wo `manual` **nicht** gesetzt ist.

## 5. Territorien-Filter (Containment)

- Pro angehaktem Knoten die **Nachfahren-Menge** per DFS über
  `parent_wiki_key`-Kinder bilden (inkl. Knoten selbst).
- Siedlung sichtbar, wenn ihr `territory_wiki_key` in der **Vereinigung** aller
  Nachfahren-Mengen liegt.
- Beispiel (Owner): Siedlung in *Staat → Grafschaft → Baronie A* ist über A **und**
  Grafschaft **und** Staat sichtbar, **nicht** über Baronie B.

## 6. Ray-Casting (Siedlung → Territorium)

Existiert noch nicht → neu bauen. `polygon-clipping.umd.min.js` ist nur
Boolean-Ops, kein PIP.

- **Algorithmus:** even-odd / crossing-number Point-in-Polygon, **MultiPolygon-fähig**,
  **Loch-Ringe** (innere Ringe) korrekt (Punkt in Loch = außerhalb).
- **Geometrie-Quelle (Client):** `window.regionData` (GeoJSON-FeatureCollection,
  `[lng, lat]`, `properties.territory_public_id`;
  `map-features-political-territory-loader.js:270`).
- **Siedlungs-Punkt:** `map_features.geometry_json` (Point `[lng, lat]`).
- **Tiebreak (§9.2):** bei mehreren Treffern das **tiefste** Territorium
  (spezifischstes) über die **`parent_wiki_key`-Tiefe**. Sekundär (echte
  Überlappung ohne Ahnen-Beziehung): kleinste Fläche. Der Hierarchie-Filter (§5)
  zeigt die Siedlung dann automatisch auch unter allen Ahnen.
- **Nicht-Treffer (§9.3):** `territory_wiki_key` bleibt **null** — nicht raten,
  nicht verstecken; sichtbar über den „Nicht zugeordnet"-Chip.

### 6.1 ⚠ Zoom-Culling-Falle (Pflicht)

Der Layer-Fetch schickt `zoom` mit; der Server **cullt nach `min_zoom`/`max_zoom`**
→ `regionData` enthält nur die **aktuell sichtbaren** Geometrien. Ein **globaler**
Lauf **muss die volle Geometrie-Menge** nutzen: entweder alle Zoomstufen laden
(`POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS`,
`…political-territory-loader.js:350–393`) **oder** einen dedizierten
„alle Geometrien"-Fetch. Sonst bleiben Siedlungen unter gerade ausgeblendeten
Territorien unzugeordnet.

### 6.2 Zwei Trigger

- **Lokal — Rechtsklick „Grenzen berechnen":** neue Kontextmenü-Aktion
  (`map-features-region-context-menu.js`, Trigger `map-features.js:474–487`) —
  nur für den geklickten Bereich / das Territorium.
- **Global — Menüband `Siedlungen zuordnen`:** einmal über **alles** (Muster
  `assign_all` in `api/_internal/wiki/regions.php`, aber **geometrisch** statt
  namensbasiert). Client-seitig **batchen** (STRATO nicht loopen).

### 6.3 Dry-run / Apply (§9.4)

- Vor dem globalen Write ein **Dry-run**: Zusammenfassung
  **zugeordnet / geändert / nicht-zugeordnet** (+ Liste). Manuelle Overrides
  werden ausgewiesen und **nicht** angetastet.
- **Der echte Prod-Write wird vom Owner ausgeführt** (phpMyAdmin/Konsole). Der
  Agent baut die Endpoints + Dry-run, führt **keine** Prod-DB-Writes aus
  (self-healing DDL ok). Save chunked, Muster `assign_to` /
  `api/_internal/political/assignment.php`.

## 7. „Nur Auswahl anzeigen" (Karten-Filter)

- Toggle im Menüband: auf der Live-Karte **nur die aktuelle Siedlungs-Auswahl**
  (Filter-Ergebnis der Mitte-Spalte) zeigen.
- **Chip** in der **Kartenecke** signalisiert „gefilterte Ansicht aktiv".
- **Reversibel** über denselben Toggle; **edit-mode-only**, verändert den
  normalen Layer-/Sichtbarkeits-State **nicht dauerhaft** (kein Leck ins
  öffentliche Frontend).

## 8. API-Oberfläche (Design-Intent)

Ausbau von `api/edit/wiki/settlements.php` (+ `settlement-coat-upload.php`).
Konkrete Signaturen kommen im Implementierungsplan; Muster wie `assign_to`:

- **Zuordnung setzen (manuell/Override):** eine Siedlung → `territory_wiki_key`
  (+ `territory_public_id`, `territory_source='manual'`).
- **Ray-Cast Preview (Dry-run):** liefert Zusammenfassung ohne Write.
- **Ray-Cast Apply (global/lokal):** chunked Write, überspringt `manual`.
- Envelope Richtung Gold-Contract (`{ ok: true|false, … }`), interne
  `message`s Englisch.

## 9. Guardrails & Invarianten (§0)

- **Nur Edit-Mode**, Frontend unangetastet.
- **`parent_wiki_key`** für alle Ahnen/Nachfahren — nie `affiliation_path`.
- **Keine Prod-DB-Writes durch den Agent**; self-healing DDL ok, echte Writes
  führt der Owner.
- **STRATO:** schwere Endpoints nicht loopen; globaler Ray-Cast client-seitig
  batchen; Saves chunked + Dry-run.
- **Shared Working Tree:** nur eigene Dateien per Pfad stagen, nie `git add -A`,
  rebase-sicher pushen. **`ASSET_VERSION`** bei Editor-Asset-Änderungen bumpen.

## 10. Definition of Done (Vorschlag)

1. Editor öffnet als Overlay/Iframe aus dem Siedlungen-Tab; 3 Spalten wie Mockup v2.
2. LINKS filtert MITTE korrekt über Nachfahren-Union (`parent_wiki_key`),
   Tri-State-Kaskade sichtbar.
3. „Nicht zugeordnet"-Chip + Tabs verhalten sich als Zwei-Achsen-Modell.
4. RECHTS zeigt Felder/Overrides/Wappen; Territorium-Override schlägt Ray-Cast.
5. PIP korrekt für MultiPolygon + Löcher; Tiebreak = tiefste Ebene.
6. Globaler Ray-Cast nutzt **volle** Geometrie (kein Zoom-Culling), Dry-run zeigt
   zugeordnet/geändert/nicht-zugeordnet; Owner bestätigt den Write.
7. „Nur Auswahl anzeigen" reversibel, kein Leck ins Frontend.
8. `ASSET_VERSION` gebumpt.

## 11. Bewusst NICHT im ersten Wurf (YAGNI)

- Kein volles Drag&Drop der Siedlungen in den Baum (nur Ray-Cast + Override).
- Keine Änderung an reinen Wiki-Orten außer Anzeige (nicht ray-castbar).
- Keine i18n-Extraktion der neuen Strings über das Nötige hinaus (M8-Thema).
