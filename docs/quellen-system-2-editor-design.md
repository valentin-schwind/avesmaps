# Mehrquellen-System #2 — Editor-Verwaltung (Spec)

> Datum: 2026-07-08. Sprache: Deutsch (Design-Doc). Code/Commits/interne API-Messages Englisch.
> Baut auf #1 (`docs/quellen-system-design.md`): Tabellen `sources` + `feature_sources`, Lese-Endpoint
> `GET /api/app/feature-sources.php`, Infobox-Anzeige. #2 fügt das **Bearbeiten** hinzu.
>
> ⚠️ **Teilweise überholt (2026-07-11) — maßgeblich AGENTS.md §5.** Das System ist **shipped**.
> Seither: **`source_type`** = **8er-Taxonomie** (nicht die 4er-Liste in §A); der Schreib-Endpoint
> ist real **`POST /api/edit/map/feature-sources.php`**; Wiki-abgeleitete Quellen tragen
> `origin='wiki_publication'`, Entfernen = Suppression. `url_hash` als Identität (§A/§B) gilt weiter.

## Ziel

In JEDER Oberfläche, in der ein Kartenelement bearbeitet wird (4 Typen), sollen Quellen **hinzugefügt
und gelöscht** werden können (mehrere pro Element, mit Typ + „offiziell"). Der Wiki-Link bleibt fest
(read-only, aus der Wiki-Zuweisung). Die bestehende einzelne „Andere Quelle" wird **verlustfrei** in
den Katalog übernommen (Owner-Vorgabe: „die Daten dürfen nicht verloren gehen").

## Die 6 Editier-Oberflächen (Ist-Zustand)

| # | Oberfläche | Ort | Speichert via | entity_type / public_id |
|---|---|---|---|---|
| 1 | Siedlung Einzeldialog | `index.html` `#location-edit-overlay` | `update_point` | settlement / map_features.public_id |
| 2 | Weg Einzeldialog | `index.html` `#path-edit-overlay` | `update_path_details` | path / map_features.public_id |
| 3 | Region (map_feature) Einzeldialog | `index.html` `#label-edit-overlay` | `update_label`/`update_region` | region / map_features.public_id |
| 4 | Herrschaftsgebiet Einzeldialog | `index.html` `#region-edit-overlay` | `update_territory` (territories-write.php) | territory / political_territory.public_id |
| 5 | Siedlungseditor-Detail-Panel | `html/wiki-sync-settlement-editor.html` (`dtEdit*`) | `update_point` | settlement / public_id |
| 6 | Territoriums-Editor | `html/political-territory-editor.html` | political write | territory / public_id |

Alle nutzen heute die geteilte `js/review/review-other-source.js` (Prefix-basiert: `readOtherSourceFromForm`/
`writeOtherSourceToForm`/`toggleOtherSourceSection`, DOM `#<prefix>-other-source-{section,url,label,preview}`).

## Architektur

### A) Ein Schreib-Endpoint (deckt alle 4 Typen — entity_public_id ist opak)
`POST /api/app/feature-sources.php` erweitern **oder** neu `POST /api/edit/wiki/feature-sources.php`
(thin dispatcher → interne Logik in `api/_internal/app/feature-sources.php`). **Auth:** capability
`'edit'` (wie `update_point`). **Envelope:** Gold-Contract `{ok:true,...}` / `{ok:false,error:{code,message}}`.

Actions (POST JSON):
- `list` → `{ok:true, sources:[{source_id,url,label,type,official}], wiki_url}` — die Quellen des Elements
  (Katalog-Verknüpfungen **inkl.** noch nicht übernommener `other_source`, mit `source_id` für's Löschen)
  plus der feste Wiki-Link (read-only).
- `add` `{entity_type, entity_public_id, url, label, source_type, is_official}` → **erst other_source-Takeover
  (s. u.), dann** dedup-Upsert in `sources` (url_hash) + `INSERT IGNORE` in `feature_sources` (status
  `approved`, `created_by`=editor). Rückgabe: die aktualisierte `list`.
- `remove` `{entity_type, entity_public_id, source_id}` → **erst other_source-Takeover, dann** DELETE der
  `feature_sources`-Verknüpfung. Rückgabe: die aktualisierte `list`.

`source_type` ∈ `regionalband|abenteuer|briefspiel|sonstiges`. url Pflicht (url_hash = Identität, #1).

### B) other_source-Takeover — ATOMAR, verlustfrei (harte Vorgabe)
`avesmapsFeatureSourcesTakeoverOtherSource(pdo, entityType, publicId)`: für settlement/region/path
(map_features) in **einer Transaktion**:
1. `properties.other_source {url,label}` lesen; wenn leer → no-op.
2. Katalog-Upsert (url_hash) + `INSERT IGNORE feature_sources` (approved) — die Quelle ist jetzt im Katalog.
3. **Erst danach** `properties.other_source` aus `properties_json` entfernen (per `update`-Idiom mit
   `avesmapsNextMapRevision`). Commit. → Es gibt **kein** Fenster, in dem die Quelle nirgends steht.

Wird von `add`/`remove` **vor** der eigentlichen Mutation aufgerufen → sobald ein Editor Quellen anfasst,
ist die alte „Andere Quelle" sicher als managebare Katalog-Quelle drin. Nie-bearbeitete Elemente behalten
`other_source` im Feld (und werden per #1-Merge weiter angezeigt) → auch kein Verlust. **Kein** Bulk-Skript
nötig (das #1-Skript bleibt ungenutzt).

### C) Eine geteilte UI-Komponente
`js/review/review-feature-sources.js` (window-global), **einmal** implementiert, in Parent + beiden
iframes per `<script src>` eingebunden (alles same-origin):
```
mountFeatureSourceEditor(containerEl, entityType, publicIdGetter, opts)
```
- Rendert: **Wiki-Zeile read-only** (feste Wiki-Quelle „Wiki Aventurica ↗", nicht löschbar) + **Quellen-Liste**
  (je Zeile Label ↗ + Typ-Badge + `*` wenn offiziell + `✕`-Löschen) + **Add-Zeile** (URL, Linktext, Typ-
  Dropdown, „offiziell"-Checkbox, „Hinzufügen").
- Lädt via `list`, schreibt via `add`/`remove`, re-rendert aus der Endpoint-Antwort.
- `publicIdGetter` als Funktion, weil manche Dialoge das Element erst beim Öffnen kennen.

### D) Wiki-URL read-only
In allen 6 Oberflächen entfällt das **editierbare** „Wiki-URL"-Feld; der Wiki-Link erscheint als feste
read-only-Zeile in der Komponente (aus der Wiki-Zuweisung bzw. dem vorhandenen `wiki_url`). Setzen/Ändern
des Wiki-Bezugs bleibt dem bestehenden „Wiki-Zuweisen"-Flow vorbehalten (nicht Teil von #2).

## Phasen (subagent-driven, mit Live-Check nach Phase 1)

- **Phase 1 (Fundament + Referenz):** Endpoint (`list`/`add`/`remove` + Takeover) · Komponente
  `review-feature-sources.js` · Einbindung in **eine** Oberfläche (#5 Siedlungseditor-Detail-Panel) →
  **live im Chrome verifizieren** (add/remove, Takeover, Wiki read-only).
- **Phase 2:** die 4 Parent-Einzeldialoge (#1 Siedlung, #2 Weg, #3 Region-map, #4 Herrschaftsgebiet) anschließen.
- **Phase 3:** Territoriums-Editor-iframe (#6).

## Constraints

- **Keine Prod-DB-Writes durch den Agenten.** Die `add`/`remove`-Endpoints sind **Editor-Writes** (der Owner/
  Editoren nutzen sie live über die UI) — der Agent ruft sie nicht selbst mit `confirm` auf. DDL bleibt self-healing.
- **STRATO:** je Aktion eine kleine Query-Gruppe, kein Loop. **Envelope:** Gold-Contract.
- **Sprache:** UI Deutsch via `tr()`; Code/Kommentare Englisch. **Load-Order:** kein top-level `map.on`.
- **Geteilter Checkout:** nur eigene Dateien stagen. **Assets:** neue JS/CSS korrekt versionieren (index.html-
  verlinkt = auto-Stempel; iframe-HTML = `?v=Date.now()`-Selbstbust bzw. ASSET_VERSION je nach Datei).

## Definition of Done

1. `POST` `list`/`add`/`remove` funktionieren (Gold-Envelope, capability-gated), Takeover atomar + verlustfrei.
2. `review-feature-sources.js` mountet in einer Oberfläche; add/remove/rerender live grün im Chrome.
3. Wiki-URL ist überall read-only; „Andere Quelle"-Einzelfeld ist durch die Liste ersetzt.
4. Alle 6 Oberflächen eingebunden (nach Phasen).
5. Owner-Smoke: eine Siedlung mit alter `other_source` bearbeiten → sie erscheint als löschbare Katalog-Quelle,
   Feld geleert, Infobox unverändert; eine zweite Quelle hinzufügen/löschen wirkt in der Infobox.
