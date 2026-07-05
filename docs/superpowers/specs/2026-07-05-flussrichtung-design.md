# Design: Flussrichtung & asymmetrisches Fluss-Routing

> Owner-approved design (2026-07-05, brainstorming session). Language note: this spec is
> German because it captures owner decisions verbatim; code comments/commits stay English.
> Execution: fresh session via superpowers:writing-plans + SDD. Builds directly on the
> Verlauf-Sync feature (docs/refactoring-verlauf-sync.md, deployed bbc15c02).

## 1. Ziel & Owner-Anforderungen (FINAL)

Reisen gegen die Flussrichtung sollen langsamer sein als flussabwärts.

1. **Nur Flüsse mit zugewiesenem Wiki-Verlauf** (erfolgreich gesynct/ableitbar) bekommen
   die Richtung **automatisch**. Beispiel: Havena → Angbar = flussaufwärts auf dem Großen Fluss.
2. **Richtungspfeile im Editmode** auf den Flüssen, damit Editoren die Richtung prüfen können.
3. **Strömungsfaktor editierbar**, Default **1,5** — editierbar sobald ein Wiki-Weg
   gefunden/zugewiesen ist (und ebenso bei manuell gerichteten Flüssen). Der Faktor gehört
   IMMER dem Owner; Syncs überschreiben ihn nie.
4. **Flüsse ohne klare Richtung** (Konflikte, nicht im Wiki, …) verhalten sich wie heute
   (symmetrisch), können aber **manuell** gerichtet werden. **Sobald der Wiki-Verlauf
   zugewiesen/gesynct ist, gilt die Wiki-Richtung** (überschreibt manuelle Richtung).

Geklärte Detail-Entscheidungen:
- **Faktor-Modell:** flussaufwärts = Zeit ×Faktor (Default 1,5); flussabwärts = exakt die
  heutige Zeit. Bestehende Routen ändern sich nur bergauf. Folge (gewollt): Hinweg ≠ Rückweg,
  auch in der Zeitanzeige des Planers.
- **Edit-Ort:** Editor-Detailpanel des Wegs (Editmode → Fluss-Segment anklicken → Details).
- **Granularität:** Richtung nur **weg-weit** umdrehbar (kein Einzelsegment-Flip).

## 2. Datenmodell (Ansatz A — beschlossen)

Pro Fluss-Segment ein neues Objekt in `properties` (KEIN Schema-Change, `properties_json`
ist JSON; Geometrie/`public_id`/`feature_subtype`/`name`-Spalte werden NIE angefasst):

```json
"flow": { "dir": "forward" | "reverse", "factor": 1.5, "source": "verlauf-sync" | "editor" }
```

- `dir` ist **relativ zur gezeichneten Linienrichtung des Segments** (`forward` = fließt in
  Koordinatenreihenfolge). Entgegengesetzt gezeichnete Nachbarsegmente sind damit KEIN
  Sonderfall — sie tragen schlicht unterschiedliche `dir`-Werte; die Fließrichtung entlang
  des Flusses bleibt konsistent.
- `flow` fehlt oder `dir` fehlt ⇒ Segment symmetrisch wie heute (Anforderung 4).
- `factor` ist semantisch weg-weit (Writes fächern weg-weit auf), gespeichert je Segment,
  Clamp **[1.0, 3.0]**, fehlend ⇒ 1,5 wird angenommen sobald `dir` gesetzt ist.
- `source` steuert den Vorrang: Sync-Ableitung schreibt `verlauf-sync` und darf manuelle
  (`editor`) Richtungen überschreiben (Anforderung 4 letzter Satz); der Faktor wird von der
  Ableitung NIE angefasst.
- Verworfen: (B) zentrale Tabelle je Fluss (Richtung MUSS pro Segment relativ zur
  Zeichenrichtung vorliegen; Join beim Graph-Aufbau wäre teuer/fragil), (C) Geometrie
  normalisieren (verletzt die Geometrie-Invariante; Invariante wäre unsichtbar und zerbricht
  beim nächsten Neuzeichnen).

## 3. Ableitung aus dem Wiki-Verlauf

Wiederverwendet die komplette Verlauf-Sync-Maschinerie (`api/_internal/wiki/path-verlauf.php`):
Stationskette aus dem Staging-`verlauf` (Konvention: **Quelle → Mündung**), Etappen-Routing
über die interne Engine (Flussnetz-only, Querfeldein-Postfilter, Detour-Guard).

- **Orientierung je Segment:** Beim Ablaufen einer Etappe wird je durchlaufenem Segment
  bestimmt, ob es in Koordinatenreihenfolge oder entgegen durchquert wurde ⇒ `dir`.
  Technischer Anker (Umsetzungs-Session verifizieren!): Router-Segmente
  (`avesmapsBuildClientRouteDiagnosticSegments`, api/_internal/routing/client-graph.php:430)
  tragen `geometry` + `from_node`/`to_node` — Orientierung robust bestimmbar durch Vergleich
  der Segment-`geometry`-Endpunkte mit der gespeicherten LineString des map_features-Rows
  (erste/letzte Koordinate gleich ⇒ forward, gespiegelt ⇒ reverse).
- **Sicherheitsregeln:** `dir` nur auf Segmenten, die von den routbaren Etappen in GENAU
  einer Richtung durchlaufen werden. Mehrdeutig durchlaufene Segmente, Sackgassen-Zufahrten
  (Backtrack) und Segmente ohne routbare Etappe bleiben OHNE `dir` (symmetrisch; im Editmode
  pfeillos sichtbar). Nicht routbare Etappen liefern keine Richtung.
- **Qualifikation:** Ein Weg qualifiziert sich über Wiki-Zuordnung (`wiki_path.wiki_key`) +
  Staging-`verlauf` mit ≥2 auffindbaren Stationen — UNABHÄNGIG von `wiki_path.source`
  (auch owner-kuratierte Flüsse wie der Große Fluss bekommen so ihre Richtung; die Ableitung
  ändert nur `flow`, nie die Zuordnung).
- **Auslöser:**
  1. Neue POST-Action `derive_flow` `{wiki_key, dry_run, confirm}` — ein Weg.
  2. Neue POST-Action `derive_flow_all` `{cursor, limit, dry_run, confirm}` — zeitboxed/
     paginiert (Muster `verlauf_cases`) für den Erstlauf über alle Wiki-Flüsse (~200).
  3. Integration in `apply_verlauf_case`: nach dem Übernehmen eines Falls für einen Fluss
     wird die Richtung des Wegs mit abgeleitet (Wiki-Vorrang, Anforderung 4).
- Endpoint: `api/edit/wiki/paths.php` (Cap `review`), Lib-Erweiterung in
  `api/_internal/wiki/path-verlauf.php` (oder Schwester-Datei `path-flow.php`, wenn die
  Datei zu groß wird). Dry-run/confirm-Gating wie alle Write-Actions.

## 4. Routing (beide Engines identisch!)

- **Server:** `api/_internal/routing/client-graph.php` — Kanten werden bereits explizit in
  beide Richtungen eingetragen (`avesmapsAddClientCompatiblePathConnection`, ~Zeile 83;
  Speed-Tabelle `AVESMAPS_ROUTE_CLIENT_SPEED_TABLE` ~Zeile 10). Neu: Fluss-Kante
  (Domain river) mit `flow.dir` ⇒ Richtung GEGEN die Strömung bekommt Zeitkosten ×`factor`;
  MIT der Strömung unverändert.
- **Client:** die Browser-Routing-Engine unter `js/routing/` (Graph-Aufbau + Dijkstra) muss
  die IDENTISCHE Regel bekommen — das Routing läuft client- und serverseitig, beide lesen
  `properties.flow` aus denselben map-features-Daten.
- Gilt NUR für Fluss-Transportmittel auf `Flussweg`-Kanten; `Seeweg`, Land, Querfeldein
  unverändert. Der Malus wirkt auf die ZEIT-Kosten (`fastest` + Zeitanzeige); die
  Distanz (`shortest`) bleibt symmetrisch.
- Regressionstest-Pflicht: Flüsse ohne `flow` liefern exakt heutige Kosten (beide Engines).

## 5. Pfeile im Editmode

Kleine Richtungspfeile entlang aller `Flussweg`-Segmente MIT `flow.dir`, **nur im Editmode**
sichtbar. Canvas-Rendering (Performance-Muster der bestehenden Overlays), zoomabhängige
Dichte, Ausrichtung = `dir` angewandt auf die Segment-Geometrie. Segmente ohne Richtung
zeigen keine Pfeile — Editoren sehen so sofort, wo Unklarheit herrscht (Anforderung 2).
⚠️ Umsetzungs-Session: prüfen, ob die Editmode-Anzeige zu den dynamisch geladenen
Editor-Assets gehört (`ASSET_VERSION`-Falle, AGENTS.md §7) oder zur auto-gestempelten Haupt-JS.

## 6. Editor-Detailpanel (Edit-UI)

Bei Fluss-Segmenten drei neue Elemente (deutsch):
- Anzeige **„Strömung:"** `bekannt (aus Wiki)` / `bekannt (manuell)` / `unbekannt`.
- Button **„Richtung umdrehen (ganzer Fluss)"** — invertiert `dir` weg-weit; schreibt
  `source: editor`. Bei Flüssen OHNE bisherige Richtung heißt der Button **„Richtung
  festlegen"**: die Segmentkette wird geometrisch von einem losen Ende her durchlaufen und
  konsistent orientiert (welches Ende, ist egal — der Editor prüft die Pfeile und drückt bei
  Bedarf einmal „umdrehen"). Segmente außerhalb der zusammenhängenden Kette (Abzweige)
  bleiben ohne Richtung. Ein Flip auf einem wiki-gerichteten Fluss ist erlaubt (source wird
  `editor`), wird aber vom nächsten Sync-Apply wieder auf die Wiki-Richtung gesetzt
  (Anforderung 4).
- Zahlenfeld **„Strömungsfaktor"** (Default 1,5; Clamp 1,0–3,0; gilt weg-weit).

Backend: neue POST-Action `set_flow` `{public_id, flip?|dir?, factor?, dry_run, confirm}`,
weg-weite Zielmenge über die vorhandene Weg-Identität (`avesmapsWikiPathRowMatchesWay`:
Namens-Match-Key ∪ wiki_key) — bei einzeln stehenden generisch benannten Segmenten trifft
das bewusst nur dieses Segment. Alle Writes auditiert
(`avesmapsWikiSyncFetchAuditRow` + `avesmapsWikiSyncAuditFeaturePropsChange`, Name unverändert),
einzeln undo-fähig.

## 7. Nicht-Ziele / Abgrenzung

- KEINE Pfeile im normalen Anzeige-Modus (nur Editmode; öffentliches Feature später denkbar).
- KEIN Einzelsegment-Flip (Owner-Entscheidung).
- KEINE Änderung an Seewegen, Landrouten, Querfeldein, `shortest`-Distanzen.
- KEINE Geometrie-/Namens-/Identitäts-Writes.
- Kanon-Feinkalibrierung der Faktoren je Transportmittel bleibt außen vor (ein Faktor je
  Weg für alle Fluss-Transportmittel; vgl. vertagte TIME_SCALE_FACTOR-Kalibrierung).

## 8. Verifikation (DoD)

1. `derive_flow` auf dem Großen Fluss: alle Kurs-Segmente bekommen `dir` (gemischte
   Zeichenrichtungen ⇒ gemischte forward/reverse-Werte, aber konsistente Fließrichtung);
   Pfeile im Editmode zeigen durchgehend Richtung Havena (Mündung).
2. Route Angbar→Havena (abwärts): Zeit exakt wie heute. Havena→Angbar (aufwärts):
   Flussetappen ×1,5 — Client- und Server-Routing liefern dasselbe.
3. Faktor im Detailpanel auf z. B. 2,0 ändern ⇒ Aufwärtszeit skaliert; Audit-Eintrag da;
   Undo stellt her.
4. Manuell gerichteter Nicht-Wiki-Fluss: Flip wirkt; anschließender Sync-Apply eines
   Wiki-Flusses überschreibt manuelle Richtung, Faktor bleibt.
5. Regression: Flüsse ohne `flow` und alle Landrouten liefern exakt heutige Zeiten.
6. STRATO: `derive_flow_all` läuft zeitboxed bis `complete`, Einzelrequests.

## 9. Anker-Kurzliste für die Planung

- Verlauf-Sync-Lib: `api/_internal/wiki/path-verlauf.php` (Routing-Kontext-Builder,
  Etappen-Router, `avesmapsWikiPathVerlaufReadAssignments`, Timebox-/Cursor-Muster).
- Endpoint: `api/edit/wiki/paths.php` (Action-Dispatch, dry-run-Gating, Cache-Invalidation).
- Routing Server: `api/_internal/routing/client-graph.php`; Client: `js/routing/`.
- Weg-Identität: `avesmapsWikiPathRowMatchesWay` (api/_internal/wiki/paths.php:756).
- Audit: `avesmapsWikiSyncAuditFeaturePropsChange` (api/_internal/wiki/locations-helpers.php:183).
- Tests: `tools/paths/test-path-verlauf-engine.php`-Muster (pure Funktionen, CLI).
- Fallen: Router-Segmente tragen KEIN `name`-Feld; `path_id` nie verwenden (nur `public_id`);
  2 min Deploy-Wartezeit vor PHP-Probes; Classifier blockt Agent-Browser-Writes (Owner-Schritte
  einplanen).
