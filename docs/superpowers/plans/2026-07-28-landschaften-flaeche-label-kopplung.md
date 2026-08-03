# Landschaften — Fläche und Label als ein Ding: Umsetzungsplan

Spezifikation: `docs/superpowers/specs/2026-07-28-landschaften-flaeche-label-kopplung-design.md`
Freigabe des Owners: 2026-07-28 („leg los").

**Ziel:** Eine Landschaftsfläche und ihre Beschriftungen verhalten sich wie ein Ding —
Eigenschaften wandern in beide Richtungen, Löschungen nehmen die Gegenseite mit,
Flächen-Labels verschwinden nie durch Kollision, und verschachtelte derographische Flächen
bleiben erreichbar.

**Architektur:** Der Server löst die Zugehörigkeit auf und legt sie in beide Nutzlasten (T1, T2);
die Löschkaskade sitzt an **einer** serverseitigen Stelle, sodass alle Client-Gesten sie erben
(T3). Der Client baut darauf: Tooltip, Titel, Stapelung, Kollision, Rückrichtung, Rückfragen.

**Technik:** PHP 8 + PDO (kein Framework), Vanilla-JS ohne Build. Tests sind schlichte
`assert`-Skripte nach Hausmuster.

## Globale Randbedingungen

- **Deutsch bleibt die Oberfläche**, neue Zeichenketten über `tr(key, deutscherRückfall)` (AGENTS §8).
- **Keine hartkodierten Farben/Radien** (AGENTS §12) — hier nicht berührt, aber es wird nichts eingeführt.
- **Kein `git add -A`** — nur eigene Pfade, einzeln (AGENTS §9).
- **Keine Schleifen gegen STRATO** — Abnahme mit Einzelanfragen (CLAUDE.md).
- **`ASSET_VERSION` ist nicht betroffen** (keine dynamisch geladenen Editor-Assets, AGENTS §7).
- **Beide Nutzlast-Versionen steigen** (`AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION`,
  `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION`) — sonst hält ein ETag-Cache die alte Form fest.
- **Handbuch nicht anfassen** (AGENTS §9); stattdessen nennt jede Commit-Betreffzeile die
  editor-sichtbare Wirkung.

Testkommandos:

```bash
node js/map-features/__tests__/<name>.test.js
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/<name>-test.php
```

---

## T1 — Flächen-Lesepfad liefert Artbezeichnung und beide Zählungen

**Dateien:** `api/_internal/app/ecosystem.php`, `api/app/ecosystem-areas.php`,
Test `api/_internal/app/__tests__/ecosystem-area-decoration-test.php`

**Produziert:** `avesmapsEcosystemDecorateAreaRows(array $rows, array $typeLabels, array $areaCounts, array $labelCounts): array`
— rein, ohne PDO. Setzt je Zeile `region_type_label`, `region_area_count`, `region_label_count`.
Fehlt eine Bezeichnung, bleibt der Schlüssel stehen (nie leer). Fehlt eine Zahl, ist sie `0`.

Die drei Eingaben holt der Endpunkt in drei kleinen Abfragen (kein N+1):
Typbezeichnungen aus `ecosystem_region_type`, Flächenzahl per `GROUP BY region_id` über aktive
`ecosystem_area`, Labelzahl über `map_features` (Labels mit
`properties.ecosystem_region_public_id`) vereinigt mit `ecosystem_region.label_public_id`.

`AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION` 1 → 2.

**Abnahme:** Test grün; live liefert `/api/app/ecosystem-areas.php` die drei Felder.

---

## T2 — Kartennutzlast trägt die Regionszugehörigkeit an jedem Label

**Dateien:** `api/app/map-features.php`, Test `api/_internal/app/__tests__/label-region-membership-test.php`

**Produziert:** `avesmapsMapFeaturesLabelRegionByPublicId(array $regionRows): array`
— rein: aus `[{public_id, label_public_id}]` wird `label_public_id => region_public_id`.

Beim Aufbau der Label-Ausgabe wird `properties.ecosystem_region_public_id` gesetzt, **falls
noch leer**, aus dieser Tabelle. Der am Label gespeicherte Zeiger hat Vorrang.
Gewacht: fehlende Ecosystem-Tabellen → Feld entfällt, Verhalten wie bisher.

`AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` steigt.

**Abnahme:** Test grün; live tragen ~137 Labels das Feld statt 10.

---

## T3 — Die Löschkaskade, serverseitig, an einer Stelle

**Dateien:** `api/_internal/app/ecosystem.php`, `api/_internal/map/features.php`,
Test `api/_internal/app/__tests__/ecosystem-cascade-test.php`

**Produziert:**
- `avesmapsEcosystemCascadeTriggered(string $removed, int $areasLeft, int $labelsLeft): bool`
  — rein. `$removed` ∈ `area|label`. Wahr genau dann, wenn eine Fläche entfernt wurde und
  keine mehr übrig ist, **oder** ein Label entfernt wurde und keines mehr übrig ist.
  💣 Nie auf den Zustand allein: `('area', 3, 0)` ist **falsch** — sonst rissen die zwei
  Regionen ohne Label (`Wald-001`, `Wald-002`) beim ersten Anfassen mit.
- `avesmapsEcosystemCascadeAfterRemoval(PDO $pdo, string $regionPublicId, string $removed, int $userId): array`
  — zählt nach, fragt die reine Funktion, und löscht bei Wahr in **einer** Transaktion:
  restliche Flächen, restliche Labels, Regionszeile; Audit-Zeile je Objekt; danach
  `avesmapsNextEcosystemRevision` **und** `avesmapsNextMapRevision`.

**Aufrufpunkte:** `avesmapsDeleteEcosystemArea` (nach dem Flächen-Soft-Delete),
`avesmapsDeleteEcosystemRegion` (Label-Hälfte ergänzen), `avesmapsDeleteMapFeature`
(nur `feature_type = 'label'` mit Region).

**Abnahme:** Test grün (alle vier Kombinationen plus die zwei Fallen); live erst nach Deploy.

---

## T4 — Tooltip

**Dateien:** `js/map-features/map-features-ecosystem-rendering.js`,
Test `js/map-features/__tests__/ecosystem-tooltip.test.js`

> 🔴 **Zurückgenommen am 2026-08-03** (Owner): „Eisenwald (Gebirge)" reicht. Die Ebene und die
> Zählung sind aus dem Zettel raus, die Form ist jetzt `Name (Art)` — ohne Art tritt die Ebene
> an ihre Stelle, ohne beides bleibt nur der Name. Der Rest dieses Abschnitts beschreibt den
> Stand vom 2026-07-28.

**Produziert:** `formatEcosystemAreaTooltip(area)` →
`Mein Wald 1 (Wald, Vegetation) · Flächen (3) und Labels (2)`
Artbezeichnung aus `region_type_label`, Rückfall auf `region_type`; ohne Art entfällt der
Klammerteil davor wie bisher. Datei bekommt einen gewachten `module.exports` (Hausmuster).

---

## T5 — Dialogtitel je Ebene

**Dateien:** `js/map-features/map-features-ecosystem-rendering.js` (Tabelle),
`js/map-features/map-features-ecosystem-properties.js`, `js/review/review-labels.js`,
Test `js/map-features/__tests__/ecosystem-dialog-titles.test.js`

**Produziert:**
- `ECOSYSTEM_KIND_PREFIX = { derographisch: "Derographie", vegetation: "Vegetations", topographie: "Topographie" }`
- `ecosystemDialogTitle(kind, subject)` mit `subject` ∈ `flaeche|label` →
  „Vegetations-Fläche bearbeiten" / „Derographie-Label bearbeiten".
  Unbekannte/leere Ebene → „Fläche bearbeiten" / „Label bearbeiten".

Der Label-Titel wird zweistufig gesetzt: neutral beim Öffnen, verfeinert in
`renderLabelCarrierNote`, sobald die Region bekannt ist.

---

## T6 — Flächen-Labels kollidieren nicht weg

**Dateien:** `js/map-features/map-features-label-collisions.js`,
Test `js/map-features/__tests__/label-collision-pinning.test.js`

**Produziert:** `labelCollisionPinned(group)` → `Boolean(group)`. In `getCollisionEntries` je
Eintrag mitgeführt; in `resolveLabelCollisions` bekommt ein festgesetzter Eintrag nie
`is-colliding`, sondern `candidates[0]`. Sein Rechteck wandert weiterhin nach `acceptedRects`,
damit fremde Labels ihm ausweichen.

Die Gruppe kommt jetzt direkt aus `label.ecosystemRegionPublicId` (T2) statt über
`ecosystemRegionOfLabel` — dadurch wirkt es auch im Lesemodus.

---

## T7 — Größensortierung der Flächen

**Dateien:** `js/map-features/map-features-ecosystem-loader.js`,
`js/map-features/map-features-ecosystem-geometry.js` (nur lesend),
Test `js/map-features/__tests__/ecosystem-stacking.test.js`

**Produziert:** `ecosystemStackingOrder(areas)` → `public_id`-Liste, **absteigend** nach
`ecosystemGeometryArea`. Der Aufrufer ruft in dieser Reihenfolge `bringToFront()`, sodass die
kleinste Fläche zuletzt und damit obenauf landet. Gleich große Flächen behalten ihre
Eingangsreihenfolge (stabil), damit ein Neuladen nicht die Stapelung würfelt.

Gerufen nach jedem Laden und nach jedem Einzel-Neubau einer Fläche.

---

## T8 — Label schreibt an seine Fläche zurück

**Dateien:** `js/review/review-editor-submit.js`, neues Modul
`js/map-features/map-features-ecosystem-label-writeback.js` (+ `index.html`-Einbindung),
Test `js/map-features/__tests__/ecosystem-label-writeback.test.js`

**Produziert:** `ecosystemRegionWriteBackPayload(label, region)` → `null`, wenn nichts zu tun ist,
sonst `{ public_id, name?, region_type?, wiki_url? }`. Regeln, geprüft im Test:
- unveränderter Name/Art → nicht enthalten;
- leeres Wiki am Label → `wiki_url` **nicht** enthalten (löscht nie die Zuweisung der Region);
- gesetztes, abweichendes Wiki → enthalten;
- Größe/Drehung/Zoom/Priorität → **nie** enthalten;
- Label ohne Region → `null`.

Der Aufrufer schickt das per `update_region` und ruft danach `applyRegionToLabels` für die
Geschwister. Scheitern ist eine Meldung, kein Rücklauf.

---

## T9 — Rückfragen nennen die Folge, Labels laden nach

**Dateien:** `js/map-features/map-features-ecosystem-context-action.js`,
`js/map-features/map-features-labels.js`, `js/map-features/map-features-ecosystem-geometry-ops.js`,
`js/map-features/map-features-ecosystem-properties.js`,
Test `js/map-features/__tests__/ecosystem-delete-confirmations.test.js`

**Produziert:**
- `formatEcosystemAreaDeleteConfirmation(area)` — nennt bei der **letzten** Fläche, dass Region
  und N Labels mitgehen; sonst die schlichte Fassung.
- `formatEcosystemLabelDeleteConfirmation(labelText, region)` — nennt beim **letzten** Label,
  dass die Region mit M Flächen mitgeht.
- `refreshAfterWrite` (geometry-ops) lädt die Labels mit nach, damit ein durch eine boolesche
  Operation mitgelöschtes Label sofort von der Karte geht.

---

## Selbstprüfung gegen die Spezifikation

| Spez | Aufgabe |
|---|---|
| §3.1 Zugehörigkeitsfeld | T2 |
| §3.2 Artbezeichnung + Zählungen | T1 |
| §4.1 Punkt 1 Rückrichtung | T8 |
| §4.2 Punkte 2/3 Titel | T5 |
| §4.3 Punkt 4 Tooltip | T4 |
| §4.4 Punkte 5/6/8 Kaskade | T3 (Server), T9 (Rückfragen + Nachladen) |
| §4.5 Punkt 7 Kollision | T6 |
| §5.1 Größensortierung | T7 |
| §5.2 Label als Anfasser | T6 (macht es verlässlich) + Bestand `selectEcosystemAreaOfLabel` |
| §6 Quellen | Phase 2, **nicht** in diesem Plan |

Reihenfolge: T1 → T2 → T3 → T4 → T5 → T7 → T6 → T8 → T9.
T4 hängt an T1, T6 an T2, T9 an T3.
