# Siedlungseditor — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Task für Task
> umzusetzen. Schritte nutzen Checkbox-Syntax (`- [ ]`) zum Abhaken.
>
> **Sprache:** Plan-Prosa Deutsch; **Code / Bezeichner / Commit-Messages / interne
> API-`message`s Englisch** (UI-Strings Deutsch). Basis: `docs/siedlungseditor-design.md`
> (Design) + `docs/siedlungseditor-brief.md` (Grounding).
>
> ⚠️ **Status/Design-Korrektur (2026-07-11):** Editor ist **gebaut & live**
> (`html/wiki-sync-settlement-editor.html`); dieser Plan ist abgearbeitet/historisch.
> Die in **Step 1** kopierte Palette (`--accent:#0078a8` u. a.) ist **Blau** und
> widerspricht der finalisierten Designsprache (`docs/design-language.md`: kein Blau,
> Tokens aus `css/base/tokens.css`). Nicht als Vorlage übernehmen — Akzent =
> `--color-accent`. Das Blau ist inzwischen entfernt (`--accent` Gold-Braun); die
> volle Token-Migration der lokalen Palette steht noch aus.

**Goal:** Ein neuer Siedlungseditor (3-Spalten-Iframe-Overlay im WikiSync→Siedlungen-Tab),
der Siedlungen per geometrischem Ray-Cast + manuellem Override ihren Herrschaftsgebieten
zuordnet (`properties_json.territory_wiki_key`).

**Architecture:** Der Editor ist ein **Iframe** (`html/wiki-sync-settlement-editor.html`,
inline JS/CSS wie das Schwester-Tool `wiki-sync-monitor.html`, cache-gebustet über
`?v=Date.now()` am Iframe-`src`). Karte, `window.regionData` und Marker leben im
**Elternfenster** — deshalb liegen **Ray-Cast-Engine, PIP-Util und Karten-Filter als
Eltern-Skripte** (von `index.html` geladen, per Deploy content-hash-cache-gebustet). Der
Iframe ist dünne UI und ruft eine kleine, klar definierte Fassade
`window.parent.AvesmapsSettlementAssign`. Persistenz self-healing über
`properties_json` (kein Schema-Migration).

**Tech Stack:** Vanilla JS (kein Build/Bundler), Leaflet 1.9.4 (`L.CRS.Simple`), PHP 8
(strict) + MySQL PDO, STRATO Shared Hosting. Kein Test-Framework im Repo.

---

## Global Constraints

Gelten implizit für **jeden** Task (verbatim aus Design §9 / Brief §0):

- **Nur Edit-Mode.** Öffentliches Frontend bleibt unverändert; Karten-Filter edit-mode-only,
  reversibel, **kein Leck** in die öffentliche Sicht.
- **UI-Strings Deutsch**, Code/Commits/interne `message`s Englisch, `error.code` Englisch.
  Domänen-Slugs (`metropole`…`gebaeude`, `wiki_key`, `BF`) **nie** übersetzen.
- **KERN-INVARIANTE:** Ahnen/Nachfahren **immer** über `parent_wiki_key`, **nie** über
  `affiliation_path`.
- **Persistenz:** `properties_json.territory_wiki_key` (String | null),
  `properties_json.territory_public_id` (String | null),
  `properties_json.territory_source` (`'raycast' | 'manual'`). Self-healing, keine Migration.
- **Tiebreak** bei mehreren Treffern: **tiefste Hierarchie-Ebene** (`parent_wiki_key`-Tiefe);
  sekundär kleinste Fläche. Nicht-Treffer → `territory_wiki_key = null`.
- **Keine Prod-DB-Writes durch den Agent.** Endpunkte + Dry-run bauen/testen (mit
  `dry_run=true`, kein Write); den echten `confirm`-Apply führt der **Owner**.
- **STRATO:** schwere Endpoints **nie loopen**; globaler Ray-Cast **client-seitig**;
  Server-Writes **chunked** (`limit`, `remaining`). Einzel-Request-Probe.
- **Editor-Assets:** `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js`
  (aktuell `"20260707a"`, Format `YYYYMMDDx`) bei jeder Änderung dynamisch geladener
  Editor-Assets bumpen; nach Edit von `inline-host.js` einmal Hard-Reload.
- **Shared Working Tree:** `git status` zuerst, **nur eigene Dateien per Pfad** stagen,
  nie `git add -A`; Push rebase-sicher (`fetch` + `rebase --autostash` + retry), nie
  force-pushen. Remote-SHA nach Push prüfen.
- **Auth (alle Writes):** `avesmapsRequireUserWithCapability('review')`.
- **Response-Envelope** (settlements.php nutzt ihn schon):
  Erfolg `{ ok: true, ... }`; Fehler `{ ok: false, error: { code, message } }`.
- **`properties_json`-Idiom (verbatim):**
  ```php
  $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
  $props['territory_wiki_key'] = $wikiKey;      // etc.
  $revision = avesmapsWikiSyncNextMapRevision($pdo);
  $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id')
      ->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $id]);
  ```

## Testansatz (an die Repo-Realität angepasst)

Es gibt **kein** Test-Framework und die App braucht PHP+MySQL+STRATO-Daten (nicht lokal
lauffähig). Darum drei Verifikations-Modi, je nach Task ausgewiesen:

1. **Pure Logik** (PIP, Nachfahren-Union, Tiebreak-Mapping) → **echte Node-Unit-Tests**
   (`node <datei>`), Dateien Node+Browser-kompatibel (`module.exports` + `window`-Fallback).
   Kein Backend nötig. Fallback ohne Node: dieselben Assertions in der Browser-Konsole.
2. **PHP-Endpoints** → nach Deploy **Einzel-Request-Probe** gegen die Live-Site mit
   `dry_run=true` (kein Write), PowerShell `Invoke-WebRequest`. **Nie loopen.** Den
   `confirm`-Write macht der Owner.
3. **UI** → nach Deploy **manueller Smoke** auf der Live-Site nach der ~1–2-min-Deploy-Wartezeit;
   jeder UI-Task listet konkrete Smoke-Schritte + erwartetes Ergebnis.

Jeder Task endet mit **Commit** (nur eigene Pfade). Deploy passiert per Push auf `master`.

## Datei-Struktur (was entsteht / sich ändert)

**Neu — Eltern-Seite (von `index.html` geladen, deploy-cache-gebustet):**
- `js/map-features/map-features-point-in-polygon.js` — pure PIP-Util (even-odd, MultiPolygon, Löcher).
- `js/map-features/map-features-settlement-territory-assign.js` — Engine +
  Fassade `window.AvesmapsSettlementAssign` (Ray-Cast, Dry-run-Diff, Apply, Karten-Filter).
- `js/map-features/map-features-settlement-context-action.js` — Kontextmenü-Aktion
  „Grenzen berechnen" (lokaler Lauf).
- `js/map-features/__tests__/point-in-polygon.test.js`,
  `js/map-features/__tests__/settlement-territory-tiebreak.test.js` — Node-Tests.

**Neu — Iframe (eine Datei, inline JS/CSS wie `wiki-sync-monitor.html`):**
- `html/wiki-sync-settlement-editor.html` — die 3-Spalten-UI (Baum/Liste/Detail).

**Geändert:**
- `index.html` — „WikiSync & Editor"-Button im Siedlungen-Tab; `<script>`-Tags für die
  3 neuen Eltern-Skripte.
- `js/app/bootstrap.js` — Click-Handler des neuen Buttons.
- `js/review/review-settlement-list.js` — Open-Funktion des Overlays (mirror von
  `openAvesmapsSyncEditorOverlay`).
- `api/edit/wiki/settlements.php` — neue Actions `settlement_editor_list`, `assign_territory`,
  `bulk_assign_territories`, `clear_territory`.
- `js/territory/territory-editor-inline-host.js` — `ASSET_VERSION`-Bump.

**Fassade (Vertrag Iframe ↔ Eltern) — `window.AvesmapsSettlementAssign`:**
```
computeDryRun({ scope }) : Promise<Summary>
    scope = 'global'  |  { territoryPublicId: string }   // 'global' lädt ALLE Zoomstufen
    Summary = { pairs: Pair[], assigned: number, changed: number,
                unassigned: number, skippedManual: number, sample: Row[] }
    Pair = { public_id: string, wiki_key: string|null, territory_public_id: string|null }
apply(pairs, { confirm })  : Promise<{ ok, dry_run, applied, remaining }>
setMapFilter(publicIds: string[]|null) : void      // null = zeige alle (kein Filter)
clearMapFilter() : void
```

---

## Phase 1 — Editor-Shell (Gerüst)

**Ziel-Inkrement:** Der Editor öffnet aus dem Siedlungen-Tab als 3-Spalten-Overlay (leer).

### Task 1.1: Editor-HTML-Gerüst

**Files:**
- Create: `html/wiki-sync-settlement-editor.html`

**Interfaces:**
- Produces: eine standalone HTML-Seite mit Container-ids `#settlementTools` (Toolbar),
  `#settlementStatus` (Statuszeile), Spalten `#seLeft` / `#seMid` / `#seRight`, Panels
  `#seTree` / `#seList` / `#seDetailBody`; globaler `const SETTLEMENT_EDITOR_API =
  "/api/edit/wiki/settlements.php";` und `async function boot()` (Stub).

- [ ] **Step 1: Datei anlegen, Struktur von `wiki-sync-monitor.html` spiegeln.**
  (⚠️ Palette **nicht** übernehmen — kein Blau, Tokens statt Literale; s. Korrektur oben.)
  Kopiere `<head>` + `:root`-Palette + Basis-CSS (`--bg:#f4efe7; --panel:#fff9f4;
  --line:#d8c6b2; --fg:#3f3428; --mut:#6c5a49; --accent:#0078a8; --warn:#b8860b;
  --bad:#9d3a2e; --ok:#2e7d32;`, Font `Faculty Glyphic`) und das `.cols`/`.col`-Flex-Layout
  aus `html/wiki-sync-monitor.html:9–90`. Baue das Grundgerüst gemäß **Mockup v3** dieser
  Session:
  - `<header>` mit `.controls` und drei `.btn2`-Buttons: `#seAssign` („Siedlungen zuordnen",
    `primary`, Untertitel „Ray-Cast über alles"), `#seFilterMap` („Nur Auswahl anzeigen"),
    `#seLocalizeCoats` („Wappen lokalisieren").
  - `<div id="settlementStatus">` mit Status-Text + Kontinent-Dropdown (Muster
    `#contDD`/`#contMenu` aus `wiki-sync-monitor.html:203–206`).
  - `<div class="cols">` mit `#seLeft` (Territorien), `#seMid` (Siedlungen), `#seRight`
    (Eigenschaften) — je `.colhead` + Panel (`#seTree`, `#seList`, `#seDetailBody`).
  - `#seDetailBody`-Placeholder: „In der Mitte eine Siedlung anklicken, um Details zu sehen."
  - Ein leeres `<script>` am Ende mit `const SETTLEMENT_EDITOR_API = "/api/edit/wiki/settlements.php";`,
    `function $(id){return document.getElementById(id);}` und `async function boot(){ /* Phasen füllen */ }`,
    plus `boot();`.
  UI-Strings Deutsch. Noch keine Logik.

- [ ] **Step 2: Verifikation (lokal, ohne Backend).** Öffne die Datei direkt im Browser
  (`file://…/html/wiki-sync-settlement-editor.html`). Erwartet: 3 Spalten in Pergament-Optik,
  Toolbar mit 3 Buttons, leere Panels, keine JS-Konsole-Fehler (API-Fetches gibt es noch nicht).

- [ ] **Step 3: Commit.**
  ```bash
  git add html/wiki-sync-settlement-editor.html
  git commit -m "feat(settlement-editor): scaffold 3-column editor shell (parchment skin)"
  ```

### Task 1.2: Overlay öffnen + Button im Siedlungen-Tab

**Files:**
- Modify: `js/review/review-settlement-list.js` (neue Funktion am Dateiende)
- Modify: `index.html` (Siedlungen-Tab, um `#settlement-list-tabs` herum, ~Zeile 405–411)
- Modify: `js/app/bootstrap.js` (Click-Handler, Muster Zeile 259)

**Interfaces:**
- Consumes: das Overlay-Muster `openAvesmapsSyncEditorOverlay()` (review-wiki-sync.js:1016–1077).
- Produces: `window.openAvesmapsSettlementEditorOverlay()` (baut Overlay + Iframe
  `src="/html/wiki-sync-settlement-editor.html?v="+Date.now()`); Button `#settlement-editor-open`.

- [ ] **Step 1: Open-Funktion.** In `js/review/review-settlement-list.js` eine Funktion
  `openAvesmapsSettlementEditorOverlay()` hinzufügen, die **exakt** das Muster von
  `openAvesmapsSyncEditorOverlay` (review-wiki-sync.js:1016–1077) spiegelt: Overlay-`div`
  (id `avesmaps-settlement-editor-overlay`, CSS-Klassen `political-territory-editor-overlay`/
  `…-dialog`/`…-dialog__frame`/`…-dialog__close`), Iframe-`src` via
  `"/html/wiki-sync-settlement-editor.html?v=" + Date.now()`, Close über `.…__close`-Button
  **und** Backdrop-Klick, `document.body.style.overflow`-Restore.

- [ ] **Step 2: Button einfügen.** In `index.html` in der `.wiki-sync-locations-filterbar`
  (~Zeile 406, nahe `#settlement-list-tabs`) einen Button ergänzen:
  ```html
  <button type="button" id="settlement-editor-open" class="review-panel__btn">🔗 WikiSync &amp; Editor</button>
  ```
  (Klasse an die Nachbar-Buttons im Tab anpassen.)

- [ ] **Step 3: Click-Handler.** In `js/app/bootstrap.js` (Muster Zeile 259):
  ```javascript
  $("#settlement-editor-open").on("click", () => openAvesmapsSettlementEditorOverlay());
  ```

- [ ] **Step 4: `ASSET_VERSION` bumpen** in `js/territory/territory-editor-inline-host.js:23`
  (z. B. `"20260707a"` → `"20260708a"`), da wir Editor-Assets berühren.

- [ ] **Step 5: Commit + Deploy.**
  ```bash
  git add js/review/review-settlement-list.js index.html js/app/bootstrap.js js/territory/territory-editor-inline-host.js
  git commit -m "feat(settlement-editor): open editor overlay from the Siedlungen tab"
  git push origin HEAD:master
  ```

- [ ] **Step 6: Verifikation (Live, nach ~1–2 min).** WikiSync→Siedlungen öffnen, „WikiSync
  & Editor" klicken. Erwartet: Overlay öffnet mit 3-Spalten-Iframe; Schließen-Button und
  Backdrop-Klick schließen es; Hard-Reload einmal nach dem `inline-host.js`-Edit.

---

## Phase 2 — PIP-Engine (pure, TDD)

**Ziel-Inkrement:** Eine getestete, DOM-freie Point-in-Polygon-Bibliothek.

### Task 2.1: PIP-Util

**Files:**
- Create: `js/map-features/map-features-point-in-polygon.js`

**Interfaces:**
- Produces (alle `[lng, lat]`-Koordinaten, GeoJSON-Ringe):
  - `pointInRing([x,y], ring) : boolean` — even-odd crossing-number über einen Ring.
  - `pointInPolygon([x,y], polygonCoords) : boolean` — `polygonCoords[0]` = Außenring,
    `polygonCoords[1..]` = Löcher (drin, wenn im Außenring UND in **keinem** Loch).
  - `pointInGeometry([x,y], geometry) : boolean` — `geometry.type` `Polygon`/`MultiPolygon`.
  - `territoriesContainingPoint([x,y], features) : Array<{ feature, territory_public_id }>`
    — alle Treffer aus einer `regionData`-artigen Feature-Liste (`feature.geometry` +
    `feature.properties.territory_public_id`).
- Node+Browser: am Dateiende
  ```javascript
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { pointInRing, pointInPolygon, pointInGeometry, territoriesContainingPoint };
  }
  if (typeof window !== "undefined") { window.AvesmapsPip = { pointInRing, pointInPolygon, pointInGeometry, territoriesContainingPoint }; }
  ```

- [ ] **Step 1: Failing test schreiben** (siehe Task 2.2, zuerst).

- [ ] **Step 2: Implementieren.** Even-odd Ray-Cast:
  ```javascript
  function pointInRing(point, ring) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function pointInPolygon(point, polygonCoords) {
    if (!polygonCoords || !polygonCoords.length) return false;
    if (!pointInRing(point, polygonCoords[0])) return false;
    for (let h = 1; h < polygonCoords.length; h++) {
      if (pointInRing(point, polygonCoords[h])) return false; // im Loch → draußen
    }
    return true;
  }
  function pointInGeometry(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
    if (geometry.type === "MultiPolygon") return geometry.coordinates.some((poly) => pointInPolygon(point, poly));
    return false;
  }
  function territoriesContainingPoint(point, features) {
    const hits = [];
    for (const f of (features || [])) {
      if (f && f.geometry && pointInGeometry(point, f.geometry)) {
        hits.push({ feature: f, territory_public_id: f.properties && f.properties.territory_public_id });
      }
    }
    return hits;
  }
  ```

- [ ] **Step 3: Test laufen lassen → grün** (siehe Task 2.2).

- [ ] **Step 4: Commit.**
  ```bash
  git add js/map-features/map-features-point-in-polygon.js js/map-features/__tests__/point-in-polygon.test.js
  git commit -m "feat(geo): add pure point-in-polygon util (multipolygon + holes)"
  ```

### Task 2.2: PIP-Node-Test

**Files:**
- Create: `js/map-features/__tests__/point-in-polygon.test.js`

- [ ] **Step 1: Test schreiben** (vor der Implementierung):
  ```javascript
  const assert = require("assert");
  const { pointInPolygon, pointInGeometry } = require("../map-features-point-in-polygon.js");
  const square = [[[0,0],[10,0],[10,10],[0,10],[0,0]]];
  const withHole = [[[0,0],[10,0],[10,10],[0,10],[0,0]], [[3,3],[7,3],[7,7],[3,7],[3,3]]];
  assert.strictEqual(pointInPolygon([5,5], square), true, "center inside");
  assert.strictEqual(pointInPolygon([15,5], square), false, "outside");
  assert.strictEqual(pointInPolygon([5,5], withHole), false, "in hole => outside");
  assert.strictEqual(pointInPolygon([1,1], withHole), true, "in ring, not in hole");
  const multi = { type: "MultiPolygon", coordinates: [square, [[[20,20],[30,20],[30,30],[20,30],[20,20]]]] };
  assert.strictEqual(pointInGeometry([25,25], multi), true, "second polygon");
  assert.strictEqual(pointInGeometry([15,15], multi), false, "between polygons");
  console.log("PIP tests passed");
  ```

- [ ] **Step 2: Laufen lassen.** `node js/map-features/__tests__/point-in-polygon.test.js`
  Erwartet vor der Implementierung: FAIL (Modul/Funktion fehlt). Nach Task 2.1 Step 2:
  `PIP tests passed`. (Ohne Node: dieselben `assert`-Zeilen in der Browser-Konsole nach
  Laden der Util.)

---

## Phase 3 — Persistenz + Endpoints (Dry-run baubar/testbar, Apply = Owner)

**Ziel-Inkrement:** settlements.php liefert die Editor-Liste und schreibt Zuordnungen
(chunked, dry-run-first).

### Task 3.1: `settlement_editor_list` (GET)

**Files:**
- Modify: `api/edit/wiki/settlements.php` (GET-Dispatch ~Zeile 86–98; neue Handler-Funktion)

**Interfaces:**
- Produces: `GET settlements.php?action=settlement_editor_list` →
  `{ ok:true, items:[ Row ], total, on_map, unassigned }` mit
  `Row = { public_id, name, settlement_class, settlement_label, continent, on_map:bool,
  lng:number|null, lat:number|null, territory_wiki_key:string|null,
  territory_public_id:string|null, territory_source:'raycast'|'manual'|null,
  source_category:'wiki'|'andere'|'keine', has_coat:bool, wiki_url:string|null,
  other_source:{url,label}|null }`.

- [ ] **Step 1:** Handler `avesmapsWikiSettlementEditorList(PDO $pdo): array` schreiben.
  Iteriere `map_features` (`feature_type='location'`, aktive), lies je Zeile
  `$props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null)`, extrahiere die
  Row-Felder: `lng/lat` aus `geometry_json` (Point `[lng,lat]`, `json_decode`),
  `territory_*` aus `$props`, `source_category` via bestehender Logik (Wiki-Felder →
  `'wiki'`, `other_source.url` → `'andere'`, sonst `'keine'`), `has_coat` aus `$props['coat']`.
  Envelope `{ ok:true, items, total, on_map, unassigned }`.

- [ ] **Step 2:** In den GET-Dispatch (~Zeile 86–98) einhängen:
  `'settlement_editor_list' => avesmapsWikiSettlementEditorList($pdo),`.

- [ ] **Step 3: Commit + Deploy.**
  ```bash
  git add api/edit/wiki/settlements.php
  git commit -m "feat(api/settlements): add settlement_editor_list action for the editor"
  git push origin HEAD:master
  ```

- [ ] **Step 4: Verifikation (Einzel-Request nach Deploy).**
  ```powershell
  Invoke-WebRequest -UseBasicParsing "https://avesmaps.de/api/edit/wiki/settlements.php?action=settlement_editor_list" | Select-Object -Expand Content | ConvertFrom-Json | Select-Object ok,total,on_map,unassigned
  ```
  Erwartet: `ok=True`, plausible Zahlen. (Auth: als eingeloggter Reviewer im Browser prüfen,
  falls die Probe 401 gibt — dann per Browser-`fetch` mit Session.)

### Task 3.2: `assign_territory` (POST, manueller Override)

**Files:**
- Modify: `api/edit/wiki/settlements.php` (POST-Dispatch ~Zeile 38–66; Handler)

**Interfaces:**
- Produces: `POST settlements.php` `{ action:'assign_territory', public_id, wiki_key,
  territory_public_id?, dry_run?:bool=true, confirm? }` →
  `{ ok, dry_run, applied:bool, target_wiki_key, settlement, revision }`.
  Setzt `territory_source='manual'`.

- [ ] **Step 1:** Handler `avesmapsWikiSettlementAssignTerritory(PDO $pdo, string $publicId,
  string $wikiKey, ?string $territoryPublicId, bool $dryRun): array`. Lade die Zeile per
  `public_id`, schreibe (nur wenn `!$dryRun`) via **`properties_json`-Idiom** (Global
  Constraints): `$props['territory_wiki_key']=$wikiKey; $props['territory_public_id']=
  $territoryPublicId; $props['territory_source']='manual';`. Leerer `wiki_key` → 400
  `{ok:false,error:{code:'missing_wiki_key',message:'...'}}`.

- [ ] **Step 2:** Dispatch: `'assign_territory' => avesmapsWikiSettlementAssignTerritory($pdo,
  (string)($payload['public_id']??''), (string)($payload['wiki_key']??''),
  isset($payload['territory_public_id'])?(string)$payload['territory_public_id']:null,
  !$isApply()),` — `$isApply()` = das bestehende `dry_run`/`confirm`-Muster des Files.

- [ ] **Step 3: Commit + Deploy** (`feat(api/settlements): add assign_territory (manual override)`).

- [ ] **Step 4: Verifikation (Dry-run-Probe, kein Write).**
  ```powershell
  $body = @{ action="assign_territory"; public_id="<EXISTING_ID>"; wiki_key="kosch"; dry_run=$true } | ConvertTo-Json
  Invoke-WebRequest -UseBasicParsing -Method POST -ContentType "application/json" -Body $body "https://avesmaps.de/api/edit/wiki/settlements.php"
  ```
  Erwartet: `ok=True, dry_run=True, applied=False`. **Echten `confirm`-Write macht der Owner.**

### Task 3.3: `bulk_assign_territories` (POST, chunked)

**Files:**
- Modify: `api/edit/wiki/settlements.php`

**Interfaces:**
- Produces: `POST` `{ action:'bulk_assign_territories', pairs:[{public_id, wiki_key,
  territory_public_id}], force?:bool=false, dry_run?:bool=true, confirm?, limit?:int=200 }` →
  `{ ok, dry_run, applied:int, skipped_manual:int, remaining:int }`.
  Setzt `territory_source='raycast'`; überspringt Zeilen mit `territory_source='manual'`
  (außer `force=true`).

- [ ] **Step 1:** Handler `avesmapsWikiSettlementBulkAssignTerritories(PDO $pdo, array $pairs,
  bool $force, bool $dryRun, int $limit): array`. `$limit = max(1, min(200, $limit))`,
  `$batch = array_slice($pairs, 0, $limit)`. Ein `$revision` (`??=`), ein `prepare` außerhalb
  der Schleife, per Zeile: decode props, wenn `!$force && ($props['territory_source']??null)==='manual'`
  → `skipped_manual++; continue;`, sonst setzen + (wenn `!$dryRun`) execute. Rückgabe
  `remaining = max(0, count($pairs) - $limit)`. **Muster:** bulk_connect (settlements.php:1175–1227).

- [ ] **Step 2:** Dispatch einhängen.

- [ ] **Step 3: Commit + Deploy** (`feat(api/settlements): add chunked bulk_assign_territories`).

- [ ] **Step 4: Verifikation (Dry-run-Probe).** Ein `pairs`-Array mit 1–2 echten `public_id`s,
  `dry_run=$true`. Erwartet `ok=True, dry_run=True, applied=0`. Kein Write.

### Task 3.4: `clear_territory` (POST)

**Files:** Modify `api/edit/wiki/settlements.php`

- [ ] **Step 1:** Handler `avesmapsWikiSettlementClearTerritory(PDO $pdo, string $publicId,
  bool $dryRun)`: setzt `territory_wiki_key=null, territory_public_id=null, territory_source=null`
  (bzw. `unset`). Dispatch `'clear_territory' => …`.
- [ ] **Step 2: Commit + Deploy** (`feat(api/settlements): add clear_territory`).
- [ ] **Step 3: Verifikation** Dry-run-Probe, `ok=True, dry_run=True`.

---

## Phase 4 — Links: Territorien-Filter (Baum + Tri-State + Nachfahren-Union)

**Ziel-Inkrement:** Der Baum links filtert die (Platzhalter-)Mitte über Nachfahren-Union.

### Task 4.1: Baum laden + rendern (read-only, Häkchen)

**Files:** Modify `html/wiki-sync-settlement-editor.html` (inline JS)

**Interfaces:**
- Consumes: `GET /api/app/political-territory-wiki.php` → `{ ok, nodes|items }` (Rows mit
  `wiki_key`, `parent_wiki_key`, `name`, `type`).
- Produces: globaler `settlementTree = { byKey: Map<wiki_key, node>, roots: node[] }`,
  `node = { wiki_key, parent_wiki_key, name, children: node[], settlementCount }`.
  `renderSettlementTree()`; `checkedTerritoryKeys = new Set()`.

- [ ] **Step 1:** `loadSettlementTree()` — fetch der Wiki-Tree-Rows, Baum **über
  `parent_wiki_key`** bauen (Kinder an Eltern per `byKey`; Wurzeln = ohne/mit unbekanntem
  Eltern). **KERN-INVARIANTE beachten:** nur `parent_wiki_key`. Rendern als verschachtelte
  `<ul>` mit `<label><input type=checkbox data-wiki-key=…> Name <span class=cnt></span></label>`.

- [ ] **Step 2:** Suche (`#seTree`-Suchfeld) filtert die Baum-Anzeige (Namens-`includes`).

- [ ] **Step 3: Commit** (`feat(settlement-editor): load + render read-only territory tree`).
- [ ] **Verifikation:** Live-Smoke — Baum erscheint links, Häkchen anklickbar, Suche filtert.

### Task 4.2: Nachfahren-Union-Helfer (pure, Test)

**Files:**
- Create: `js/map-features/map-features-settlement-territory-assign.js` (nur den Helfer +
  Export vorerst — Rest in Phase 7)
- Create: `js/map-features/__tests__/settlement-territory-tiebreak.test.js`

**Interfaces:**
- Produces: `descendantWikiKeys(checkedKeys: string[], childrenByParent: Map<string,string[]>)
  : Set<string>` — DFS-Union (inkl. der angehakten Knoten selbst) über `parent_wiki_key`-Kinder.

- [ ] **Step 1: Test schreiben.**
  ```javascript
  const assert = require("assert");
  const { descendantWikiKeys } = require("../map-features-settlement-territory-assign.js");
  const kids = new Map([["staat",["graf"]],["graf",["baronA","baronB"]]]);
  const set = descendantWikiKeys(["graf"], kids);
  assert.ok(set.has("graf") && set.has("baronA") && set.has("baronB"), "descendants incl self");
  assert.ok(!set.has("staat"), "no ancestors");
  console.log("descendant tests passed");
  ```
- [ ] **Step 2: Implementieren** (`descendantWikiKeys` + `module.exports`/`window`-Export).
- [ ] **Step 3: Laufen lassen.** `node js/map-features/__tests__/settlement-territory-tiebreak.test.js`
  → `descendant tests passed`.
- [ ] **Step 4: Commit** (`feat(settlement-editor): add descendant-union helper (parent_wiki_key)`).

### Task 4.3: Tri-State-Kaskade + Filter-Verkopplung

**Files:** Modify `html/wiki-sync-settlement-editor.html`

- [ ] **Step 1:** Checkbox-Change → `checkedTerritoryKeys` pflegen; Ahnenknoten visuell
  `indeterminate=true` setzen (rein UI; über `parent_wiki_key`-Kette via `byKey`).
- [ ] **Step 2:** `visibleByTerritory(row)` = `checkedTerritoryKeys.size===0 ||
  descendantWikiKeys([...checkedTerritoryKeys], childrenByParent).has(row.territory_wiki_key)`.
  In die Mitte-Filterkette einhängen (Mitte kommt in Phase 5; hier gegen Platzhalter-Daten
  testen oder Task nach 5.1 ausführen).
- [ ] **Step 3: Commit** (`feat(settlement-editor): tri-state cascade + descendant filter wiring`).
- [ ] **Verifikation:** Live-Smoke — Grafschaft anhaken markiert Staat `◪`; Mitte zeigt nur
  Siedlungen in dieser Grafschaft/ihren Baronien.

---

## Phase 5 — Mitte: Siedlungsliste (Zwei-Achsen)

**Ziel-Inkrement:** Vollständige gefilterte Siedlungsliste mit Tabs + „Nicht zugeordnet"-Chip.

### Task 5.1: Liste laden + Zeilen rendern

**Files:** Modify `html/wiki-sync-settlement-editor.html`

**Interfaces:**
- Consumes: `settlement_editor_list` (Task 3.1).
- Produces: `settlementItems: Row[]`, `renderSettlementMid()`, `selectedPublicId`.

- [ ] **Step 1:** `loadSettlementItems()` (fetch `settlement_editor_list`). Zeilen-Idiom von
  `review-settlement-list.js:132–170` spiegeln: `<span class="tree-item settlement-list__item"
  data-public-id=…>` + Name + Meta + zweite Zeile Zuordnungsstatus:
  grün `<i>✓</i> <territory-name>` wenn `territory_wiki_key`, sonst
  amber `⚠ nicht zugeordnet`. Territoriumsname via `settlementTree.byKey.get(wiki_key)?.name`.
- [ ] **Step 2:** Row-Klick → `selectedPublicId` setzen, Detail rechts laden (Phase 6).
- [ ] **Step 3: Commit** (`feat(settlement-editor): settlement list with assignment status`).
- [ ] **Verifikation:** Live-Smoke — Liste zeigt Orte mit ✓/⚠.

### Task 5.2: Tabs (on_map) + Filter + „Nicht zugeordnet"-Chip

**Files:** Modify `html/wiki-sync-settlement-editor.html`

**Interfaces:**
- Produces: `listView ('all'|'onmap'|'wiki')`, `typeFilter:Set`, `continentFilter:Set` (Default
  `['Aventurien']`), `sourceFilter:{value}`, `unassignedOnly:boolean`.

- [ ] **Step 1:** Tab-Leiste (Muster review-settlement-list.js:198–200): `Alle`/`Auf Karte`/
  `Nur Wiki` mit Zählern (`data-settlement-view`).
- [ ] **Step 2:** Filter: Suche, Typ (multi), Kontinent (multi), Quelle (single) — Zustände
  wie in `review-settlement-list.js:7–10`. `getItemSourceCategory` (utils.js:198–210) für
  Quelle.
- [ ] **Step 3:** Prominenter Chip `⚠ Nicht zugeordnet (N)` (amber). Aktiv →
  `unassignedOnly=true`, **ignoriert die Baum-Auswahl** (blende `checkedTerritoryKeys`-Wirkung
  aus, solange aktiv) und zeigt nur `on_map && territory_wiki_key==null`. `N` = Live-Count.
- [ ] **Step 4:** Gesamt-Filterkette: `continentMatch && viewMatch(on_map) && searchMatch &&
  typeMatch && sourceMatch && (unassignedOnly ? isGap : visibleByTerritory)`.
- [ ] **Step 5: Commit** (`feat(settlement-editor): view tabs, filters, and unassigned chip`).
- [ ] **Verifikation:** Live-Smoke — Tabs/Chip/Filter kombinieren korrekt; Chip zeigt Lücken.

---

## Phase 6 — Rechts: Detail-Panel (Felder, Overrides, Wappen, Territorium, Andere Quelle)

**Ziel-Inkrement:** Auswahl zeigt Eigenschaften; Territorium manuell überschreibbar.

### Task 6.1: Felder + Override-Render

**Files:** Modify `html/wiki-sync-settlement-editor.html`

**Interfaces:**
- Produces: `SETTLEMENT_DETAIL_FIELDS` (Gruppen), `renderSettlementDetail(row)`,
  `effVal(row,key)`/`isOvr(row,key)` (Muster wiki-sync-monitor.html:619–621).

- [ ] **Step 1:** `SETTLEMENT_DETAIL_FIELDS` als gruppierte Struktur:
  ```javascript
  const SETTLEMENT_DETAIL_FIELDS = [
    { group: "Identität", fields: [ {key:"name",label:"Name"}, {key:"art",label:"Typ"},
      {key:"einwohner",label:"Einwohner"}, {key:"oberhaupt",label:"Oberhaupt"} ] },
    { group: "Lage & Zugehörigkeit", fields: [ {key:"__territory",label:"Territorium",territory:true},
      {key:"region",label:"Region",wiki:true}, {key:"staat",label:"Staat",wiki:true},
      {key:"lage",label:"Lage",wiki:true}, {key:"handelszone",label:"Handelszone"} ] },
    { group: "Wiki & Quelle", fields: [ {key:"__wiki",label:"Wiki",wikiLink:true},
      {key:"__other_source",label:"Andere Quelle",otherSource:true} ] },
  ];
  ```
- [ ] **Step 2:** Override-Render exakt spiegeln (wiki-sync-monitor.html:678, 720): überschriebene
  Felder als `<span class="dt-old">…</span><span class="dt-arrow">→</span><span class="dt-new">…</span>`
  + `<span class="dt-reset" data-reset="<key>">↺</span>`; delegierter Handler `resetField(key)`.
  Wappen-Block oben (Task 6.2); `__territory`/`__wiki`/`__other_source` sind Spezial-Renderer.
- [ ] **Step 3: Commit** (`feat(settlement-editor): grouped detail panel with override rows`).
- [ ] **Verifikation:** Live-Smoke — Auswahl zeigt gruppierte Felder + Override-Pfeile.

### Task 6.2: Wappen-Block + Upload

**Files:** Modify `html/wiki-sync-settlement-editor.html`

**Interfaces:**
- Consumes: `POST /api/edit/wiki/settlement-coat-upload.php` (multipart: `public_id`, `coat`
  Datei; Antwort `{ ok, coat:{url,source,license_status}, revision }`; **kein SVG**, max 2 MB).

- [ ] **Step 1:** Wappen-Block oben im Detail (Vorschau + Lizenz-Punkt + „Ersetzen/hochladen").
  Upload-Dialog wie `#wappenDialog` (wiki-sync-monitor.html:253–276), aber POST an
  `settlement-coat-upload.php` mit `public_id` + `coat`-Datei (kein `wiki_key`, keine URL/SVG).
- [ ] **Step 2: Commit** (`feat(settlement-editor): coat block + upload (settlement-coat-upload)`).
- [ ] **Verifikation:** Live-Smoke — Upload eines PNG setzt das Wappen (Owner testet echten Upload).

### Task 6.3: Territorium-Override + „Andere Quelle"

**Files:** Modify `html/wiki-sync-settlement-editor.html`

**Interfaces:**
- Consumes: `assign_territory` / `clear_territory` (Phase 3); `review-other-source.js`
  (`readOtherSourceFromForm`/`writeOtherSourceToForm`, `{url,label}` → `properties.other_source`).

- [ ] **Step 1:** `__territory`-Renderer: grüner Badge `✓ <name>` + Herkunft
  (`territory_source==='manual'?'manuell':'Ray-Cast · tiefste Ebene'`); „ändern"-Dropdown
  (Territorien-Auswahl aus `settlementTree`) → `POST assign_territory {public_id, wiki_key,
  territory_public_id, confirm:1}`. Bei `!on_map` → „n. v." (kein Ray-Cast ohne Punkt).
  „Entfernen" → `clear_territory`.
- [ ] **Step 2:** `__other_source`-Renderer: `review-other-source.js` einbinden (Skript in den
  Editor laden oder die zwei Funktionen spiegeln), Feld `{url,label}`; nur zeigen, wenn kein
  Wiki zugewiesen (bestehende Sichtbarkeitsregel).
- [ ] **Step 3: Commit** (`feat(settlement-editor): territory override + Andere Quelle field`).
- [ ] **Verifikation:** Live-Smoke — „ändern" setzt `territory_source=manual` (Owner bestätigt
  echten Write); Andere-Quelle speichert `{url,label}`.

---

## Phase 7 — Trigger: Kontextmenü (lokal) + globaler Lauf

**Ziel-Inkrement:** Ray-Cast lokal (Rechtsklick) und global (Toolbar), Dry-run-Diff, Apply-Fassade.

### Task 7.1: Engine + Fassade (Eltern)

**Files:** Modify `js/map-features/map-features-settlement-territory-assign.js`
(zu Task 4.2 dazu)

**Interfaces:**
- Consumes: PIP-Util (`window.AvesmapsPip`), `settlement_editor_list`,
  `political-territories.php?action=layer` (alle Zoomstufen), Wiki-Tree.
- Produces: `window.AvesmapsSettlementAssign = { computeDryRun, apply, setMapFilter, clearMapFilter }`
  (Signaturen siehe „Fassade" oben).

- [ ] **Step 1: `loadAllTerritoryGeometry()`** — **§6.1 Zoom-Culling-Lösung:** alle Stufen
  `POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS=[0..6]` (config.js:341) parallel via
  `political-territories.php?action=layer&year_bf=<jahr>&zoom=<z>&edit_mode=1` fetchen und die
  Features **nach `territory_public_id` deduplizieren** (volle Geometrie-Menge, nicht nur
  sichtbare). Muster: `readPoliticalTerritoryLayerFallbacks` (loader.js:342–393).
- [ ] **Step 2: `deepestHit(hits, treeDepth, areaOf)`** — Tiebreak: unter allen PIP-Treffern
  den mit **größter `parent_wiki_key`-Tiefe** (via Wiki-Tree `getNodePath`-Tiefe / `byKey`);
  bei Gleichstand kleinste Fläche. Mappt `territory_public_id` → `wiki_key` über den Baum
  (Row hat beides). **Pure → Test** (Task 7.1a).
- [ ] **Step 3: `computeDryRun({scope})`** — Geometrie (global: alle; lokal: nur das
  `territoryPublicId` + Nachfahren) × Siedlungspunkte (`lng/lat` aus der Liste, nur `on_map`).
  Pro Punkt PIP → `deepestHit` → `wiki_key`. **Skip** Zeilen mit `territory_source==='manual'`.
  Diff gegen aktuelles `territory_wiki_key`: `assigned` (war null), `changed` (anders),
  `unassigned` (kein Treffer), `skippedManual`. Rückgabe `Summary`.
- [ ] **Step 4: `apply(pairs,{confirm})`** — chunked `POST bulk_assign_territories`
  (Task 3.3), `limit` batchen, bis `remaining==0`. **Der Agent ruft nur `dry_run`;** den
  `confirm`-Lauf startet der Owner.
- [ ] **Step 5:** `index.html` lädt die 3 neuen Eltern-Skripte + PIP (Reihenfolge: PIP zuerst).
  `ASSET_VERSION`-Bump (Editor-Assets berührt).
- [ ] **Step 6: Commit + Deploy** (`feat(settlement-assign): ray-cast engine + parent facade`).

### Task 7.1a: Tiebreak-Test (pure)

**Files:** Modify `js/map-features/__tests__/settlement-territory-tiebreak.test.js`

- [ ] **Step 1:** Test: drei verschachtelte Treffer (Staat/Grafschaft/Baronie) → `deepestHit`
  wählt die Baronie (tiefste Ebene); zwei unverwandte Treffer gleicher Tiefe → kleinste Fläche.
- [ ] **Step 2:** `node …/settlement-territory-tiebreak.test.js` → passed. Commit.

### Task 7.2: Kontextmenü „Grenzen berechnen" (lokal)

**Files:** Create `js/map-features/map-features-settlement-context-action.js`;
Modify `index.html` (Skript laden)

**Interfaces:**
- Consumes: `REGION_CONTEXT_ACTIONS` (map-features.js:536–573), Button-Muster
  (map-features-derived-boundary-context-action.js:7–25), `#region-context-menu`,
  `AvesmapsSettlementAssign.computeDryRun`.

- [ ] **Step 1:** Button `data-region-context-action="compute-settlement-territory"` (Label
  „Siedlungen hier zuordnen") ins `#region-context-menu` einfügen (nach `edit-properties`).
- [ ] **Step 2:** Handler in `REGION_CONTEXT_ACTIONS` registrieren:
  `({regionEntry}) => AvesmapsSettlementAssign.computeDryRun({scope:{territoryPublicId:
  regionEntry.territoryPublicId}}).then(showDryRunSummary)`. `showDryRunSummary` = kleiner
  Bestätigungsdialog; **Apply erst nach Owner-Bestätigung**.
- [ ] **Step 3: Commit + Deploy** (`feat(settlement-assign): context-menu local ray-cast action`).
- [ ] **Verifikation:** Live-Smoke — Rechtsklick auf ein Gebiet → „Siedlungen hier zuordnen"
  → Dry-run-Zusammenfassung erscheint (kein Write).

### Task 7.3: Toolbar „Siedlungen zuordnen" (global) + Dry-run-Dialog im Iframe

**Files:** Modify `html/wiki-sync-settlement-editor.html`

- [ ] **Step 1:** `#seAssign`-Klick → Guard `if(!window.parent.AvesmapsSettlementAssign){toast('Karte nicht bereit');return;}` → `const s = await window.parent.AvesmapsSettlementAssign.computeDryRun({scope:'global'})`.
- [ ] **Step 2:** Dry-run-Dialog **im Iframe** rendern (Modal-Muster): Zusammenfassung
  `zugeordnet s.assigned / geändert s.changed / nicht zugeordnet s.unassigned / übersprungen
  (manuell) s.skippedManual` + Beispiel-Liste `s.sample`. Button „Übernehmen" →
  `window.parent.AvesmapsSettlementAssign.apply(s.pairs,{confirm:true})` — **im Text
  ausweisen: den echten Write bestätigt der Owner.**
- [ ] **Step 3: Commit + Deploy** (`feat(settlement-editor): global assign flow with dry-run dialog`).
- [ ] **Verifikation:** Live-Smoke — „Siedlungen zuordnen" zeigt die Dry-run-Zahlen; „Übernehmen"
  ruft die (chunked) Apply-Fassade (Owner bestätigt echten DB-Write).

---

## Phase 8 — „Nur Auswahl anzeigen" (Karten-Filter)

**Ziel-Inkrement:** Karte zeigt nur die aktuelle Siedlungs-Auswahl; reversibel; kein Leck.

### Task 8.1: Marker-Filter in der Engine

**Files:** Modify `js/map-features/map-features-settlement-territory-assign.js`

**Interfaces:**
- Consumes: bestehendes Marker-Registry (`findLocationMarkerByPublicId(publicId).marker`,
  vgl. review-settlement-list.js:280). **Zuerst kurz das Marker-Sichtbarkeits-Modul groundnen**
  (welche Layer/Registry alle Location-Marker hält), dann implementieren.
- Produces: `setMapFilter(publicIds|null)`, `clearMapFilter()`.

- [ ] **Step 1:** `setMapFilter(ids)` — vorherigen Sichtbarkeits-Zustand einmalig sichern,
  dann nur Marker in `ids` sichtbar lassen (übrige aus dem Layer nehmen / `opacity 0` /
  hidden — je nach gefundenem Mechanismus), Ecken-**Chip** „Gefilterte Ansicht aktiv" einblenden.
- [ ] **Step 2:** `clearMapFilter()` — gesicherten Zustand vollständig wiederherstellen, Chip
  entfernen. **Edit-mode-only, kein persistenter State, kein Leck ins Frontend.**
- [ ] **Step 3: Commit + Deploy** (`feat(settlement-assign): edit-mode-only map selection filter`).

### Task 8.2: Toolbar-Toggle verdrahten

**Files:** Modify `html/wiki-sync-settlement-editor.html`

- [ ] **Step 1:** `#seFilterMap`-Toggle: an → `window.parent.AvesmapsSettlementAssign.setMapFilter(
  <aktuelle gefilterte public_ids der Mitte>)`; aus → `clearMapFilter()`. Button-Zustand spiegeln.
- [ ] **Step 2: Commit + Deploy** (`feat(settlement-editor): wire 'show selection only' toggle`).
- [ ] **Verifikation:** Live-Smoke — Toggle an → nur Auswahl auf der Karte + Chip; Toggle aus
  (oder Overlay schließen) → normale Ansicht vollständig zurück; Reload der öffentlichen Seite
  zeigt **keine** Reste.

---

## Definition of Done (aus Design §10)

1. Editor öffnet als Overlay/Iframe aus dem Siedlungen-Tab; 3 Spalten wie Mockup v3.
2. Links filtert Mitte über Nachfahren-Union (`parent_wiki_key`), Tri-State sichtbar.
3. „Nicht zugeordnet"-Chip + Tabs = Zwei-Achsen-Modell.
4. Rechts: Felder/Overrides/Wappen; Territorium-Override schlägt Ray-Cast (`territory_source`).
5. PIP korrekt (MultiPolygon + Löcher), Tiebreak = tiefste Ebene — **Node-Tests grün**.
6. Globaler Ray-Cast nutzt **volle** Geometrie (kein Zoom-Culling); Dry-run zeigt
   zugeordnet/geändert/nicht-zugeordnet; **Owner bestätigt den Write**.
7. „Nur Auswahl anzeigen" reversibel, kein Leck ins Frontend.
8. `ASSET_VERSION` gebumpt.

## Selbst-Review (vor dem Handoff durchgeführt)

- **Spec-Abdeckung:** Design §2→P1, §3→P1/4/5/6, §4→P3, §5→P4, §6→P2/P7, §7→P8, §8→P5,
  §9-Guardrails→Global Constraints. Keine Lücke offen.
- **Typ-Konsistenz:** `territory_wiki_key`/`territory_public_id`/`territory_source`,
  `computeDryRun/apply/setMapFilter/clearMapFilter`, `Pair`/`Summary`,
  `descendantWikiKeys`/`deepestHit`/`pointInGeometry` — über Tasks hinweg identisch benannt.
- **Bekannte, bewusst gesetzte Diskretion:** das Marker-Sichtbarkeits-Modul (Task 8.1) wird
  **zur Implementierungszeit** kurz gegroundet (der eine untergegroundete Punkt), Vorgehen
  ist vorgegeben (sichern → filtern → wiederherstellen + Chip).
