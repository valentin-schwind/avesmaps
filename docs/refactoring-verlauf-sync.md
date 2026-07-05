# Instruction: Verlauf-Sync — Wiki-Änderungen an Wegen diff-basiert übernehmen

> Selbstständige Instruction für eine **neue Claude-Code-Session** (Superpowers/SDD).
> Enthält den gesamten nötigen Kontext; die ausführende Session hat NICHT den Kontext
> der Session vom 2026-07-05, in der die Grundlagen gebaut wurden. Alle Anker sind aus
> dem Code bzw. an Produktionsdaten verifiziert.

## 0. Projekt-Kurzkontext

Avesmaps (avesmaps.de) — vanilla-JS-Frontend + PHP 8/MySQL, Leaflet `L.CRS.Simple`,
STRATO Shared Hosting, Deploy per Push auf `master` (~2 min; js/ deployt VOR api/ —
nach Push 2 min warten, bevor PHP-Endpoints geprobt werden). Siehe `AGENTS.md`.
Wege/Flüsse sind `map_features` mit `feature_type='path'`, in Segmente zerlegt.

## 1. Ausgangslage (Stand 2026-07-05 abends)

- **1.659 von 5.080 Segmenten** sind Wiki-Wegen zugewiesen (312 Wege). Zuweisung =
  `properties.wiki_path`-Objekt (JSON, u. a. `wiki_key`, `name`, `wiki_url`) + DB-Spalte
  `name` = kanonischer Wiki-Name (Regel R1; `avesmapsWikiPathEffectiveEditName`).
- Zuweisungen entstanden aus: (a) Owner-Handarbeit im Editor, (b) `assign_all`
  (Namens-Match), (c) der **Verlauf-Pipeline** derselben Session: Staging-`verlauf` →
  Stationskette (nur existierende Karten-Orte) → Etappen-Routing → validierte Writes.
- **Beschriftung/Deep-Link/Suche hängen NUR an der Zuweisung** (Way-Labels rendern
  segmentübergreifend aus `wiki_path.name`; `js/map-features/map-features-way-labels.js`).
  Zuweisen ⇒ beschriftet, Lösen ⇒ entlabelt — automatisch, kein separater Schritt.
- Wege-Staging: `wiki_path_staging` (Spalten u. a. `wiki_key`, `name`, `match_key`,
  `kind` strasse|fluss, `verlauf`, `wiki_url`), gefüllt vom Wege-WikiSync
  (`api/edit/wiki/paths.php`, Panel „Wege"). 596 Zeilen, 273 mit ≥2 Karten-Stationen.

## 2. Ziel

Nach jedem Staging-Refresh (Crawl/Dump) sollen **Verlauf-Änderungen aus dem Wiki**
als **Review-Fälle** erscheinen und **fall-weise** übernommen werden können:

- **Diff-basiert:** Beim Apply wird je Weg ein Hash des `verlauf`-Felds gespeichert
  (im `wiki_path`-JSON der Segmente bzw. einmal je Weg, s. Task 3 — KEIN Schema-Change
  nötig, `properties_json` ist JSON). Der Sync vergleicht Staging-Hash gegen
  gespeicherten Hash; nur geänderte Wege werden neu berechnet.
- **Fall-weise Apply:** Ein Fall = ein Weg. Apply schreibt alle Änderungen des Wegs
  (adds + removes) in einem Zug; segmentweise per Undo rückholbar. Zurückstellen/
  Archivieren wie bei den Hauptstadt-Fällen (Side-Table-Muster, s. Anker).
- **Global nur als Komfort:** „Alle unstrittigen Fälle übernehmen" — ausschließlich
  Fälle ohne Warnflags (alle Stationen gefunden, alle Etappen routbar, keine Kollision
  mit fremd-/owner-kuratierten Segmenten).

### Fall-Typen

| Typ | Bedeutung | Aktionen |
|---|---|---|
| `verlauf_changed` | Kurs-Diff nach Wiki-Edit: +Segmente / −Segmente | Übernehmen / Zurückstellen / Archiv |
| `station_missing` | Verlauf nennt [[Ort]], der als Karten-Ort fehlt | Hinweis (Ort anlegen / Alias / ignorieren) |
| `hops_unroutable` | Etappe im jeweiligen Transportnetz nicht routbar | Hinweis (Netz pflegen / manuell) |
| `course_conflict` | Neuer Kurs beansprucht Segmente eines anderen ODER owner-kuratierten Wegs | IMMER manuell |

## 3. Invarianten & Owner-Entscheidungen (FINAL — nicht „reparieren")

1. **Verlauf-gelistete Orte gehören SAMT Zufahrt zum Weg** — auch Sackgassen
   (Präzedenz: Reichsstraße 1 → Hagens Hof, Owner: „du hast alles richtig gemacht").
   Das Rein-und-über-dieselbe-Kante-raus-Muster (Backtrack) ist KEIN Fehler-Signal
   für Bestandsdaten; es taugt nur als Info-Flag in neuen Diffs.
2. **Owner-kuratierte Segmente werden vom Sync NIE automatisch entfernt** (nur
   `course_conflict`-Fall melden). Owner-kuratiert = `wiki_path.source` fehlt oder
   ≠ `verlauf-sync` (Task 1/2).
3. **Geteilte Trassen:** ein Segment gehört genau EINEM Wiki-Weg. Bestehende fremde
   Zuweisungen bleiben; der Sync legt Lücken an (wie Belen-/Seneb-/Silem-Horas heute).
4. **Transport-Trennung:** Straßen nur Landnetz, Flüsse (`kind='fluss'`) nur Flussnetz,
   Querfeldein/synthetic IMMER aus. Detour-Guard: Etappen mit >15 Segmenten verwerfen.
5. Routing-Graph-Identität (`public_id`, Geometrie, `feature_subtype`) niemals anfassen;
   `show_label` bleibt unberührt (wird von Way-Labels ohnehin ignoriert).
6. Kleine verifizierte Commits auf `master`; Owner-Push-Freigabe gilt; Subagenten
   pushen nie. Wiki: Dump bevorzugen, API ok, keine HTML-Crawls.

## 4. Aufgaben (Reihenfolge)

**T1 — `source`-Feld einführen.** `avesmapsWikiPathBuildAssignObject`
(api/_internal/wiki/paths.php) bzw. die Assign-Flows erhalten einen Herkunfts-Parameter,
der als `wiki_path.source` gespeichert wird: Editor-Picker/Panel-Klick = `editor`,
Verlauf-Sync = `verlauf-sync` (Endpoint-Payload `source`, Whitelist!). Zusätzlich beim
Sync-Apply: `wiki_path.course_hash` (sha1 des Staging-`verlauf`) + `course_hops`
(die Etappen, die DIESES Segment begründen — nötig fürs spätere gezielte Entfernen).

**T2 — Backfill der Pipeline-Zuweisungen vom 2026-07-05.** Empfohlen über
`map_audit_log` (Aktion `wiki_sync_update_point`, Zeitraum 2026-07-05, after_json
enthält `wiki_path`): diese Segmente `source='verlauf-sync'` + `course_hash` des
damaligen Verlaufs nachtragen. Konservative Alternative: Backfill weglassen — dann
gelten alle Bestandszuweisungen als owner-kuratiert und Diffs werden für sie nur als
manuelle Fälle gemeldet (sicher, aber mehr Handarbeit).

**T3 — Diff-Engine serverseitig** (neue GET-Action `verlauf_cases` in
`api/edit/wiki/paths.php` → Funktion in `api/_internal/wiki/paths.php`):
je Staging-Zeile Hash vergleichen; bei Abweichung Kurs neu berechnen —
Stationskette = [[Links]] des `verlauf` ∩ existierende Locations (Parser-Anker:
paths.php ~360-371 extrahiert bereits `stations`); Etappen-Routing über die INTERNE
Engine (`api/_internal/routing/`, dieselbe wie POST /api/route/ — NICHT über HTTP;
`route.segments[]` trägt `public_id`); Soll-Segmentmenge vs. Ist (`wiki_key`-Träger)
diffen; Flags berechnen (missing stations, unroutable hops, conflicts, Detour).
Step-weise/paginiert wie `crawl_step` (STRATO: nie alles in einem Request).

**T4 — Fall-Persistenz.** Side-Table nach dem Muster `political_capital_case_status`
(nur defer/archiv persistiert, „offen" wird berechnet; Anker: Memory/Code zu
`missing_capital`, api/edit/wiki/* + js/review/review-wiki-sync-cases.js).

**T5 — Apply-Backend** (POST-Action `apply_verlauf_case`): adds via `assign_to` mit
`single_segment:true` (IMMER — Namens-Gruppen-Match ist im Sync-Kontext gefährlich),
removes via `clear_assign` mit `single_segment:true` (nur `source='verlauf-sync'`-
Segmente!); `source`/`course_hash`/`course_hops` schreiben; alles auditiert (Undo
läuft: Audit-Helfer trägt seit 2026-07-05 den NEUEN Namen im after_json).
Bulk-Action `apply_verlauf_cases_clean` = Schleife über unstrittige Fälle.

**T6 — Frontend Sub-Reiter** im Wege-Sync-Panel (js/review/review-path-sync.js,
Fall-Listen-Optik wie WikiSync-Cases): Liste nach Typ, je Fall +/-Segmente mit
Namen der begründenden Etappen, Buttons Übernehmen/Zurückstellen/Archiv, oben
„Alle unstrittigen übernehmen". Karten-Diff-Vorschau (add=grün/remove=rot via
Spotlight-Highlight) ist Phase 2. UI deutsch.

## 5. Technische Anker

- Endpoint: `api/edit/wiki/paths.php` (Cap `review`; Actions heute: status, run_status,
  staging_sample, match, search | POST: start_run, crawl_step, clear, assign,
  clear_assign, assign_all, assign_to; `single_segment`-Flag existiert bei assign_to
  UND clear_assign).
- Lib: `api/_internal/wiki/paths.php` — `avesmapsWikiPathAssignTo`,
  `avesmapsWikiPathClearAssign` (beide mit `bool $singleSegment=false`),
  `avesmapsWikiPathRowMatchesWay`, `avesmapsWikiPathBuildAssignObject`,
  Verlauf-Parser ~360-371. Naming: `api/_internal/wiki/path-naming.php`.
- Routing intern: `api/_internal/routing/` (graph.php:917: `path_id` = `public_id`;
  Antwort-Segmente tragen `public_id` + `from_node`/`to_node`/`subtype`).
- Fälle-UI-Muster: `js/review/review-wiki-sync-cases.js`, Side-Table-Muster
  `political_capital_case_status`.
- Way-Labels (nur zur Einordnung, nicht anfassen): `js/map-features/map-features-way-labels.js`.

## 6. Fallen aus der Basis-Session (2026-07-05)

- `route.segments[].path_id` ist die INTERNE Graph-ID — **immer `public_id` nehmen**.
- Namens-Gruppen: `assign_to`/`clear_assign` ohne `single_segment` matchen weg-weit
  (Namens-Key ∪ wiki_key beim Clear) — im Sync-Apply darum immer `single_segment:true`.
- Bei mehreren Wegen in EINEM Lauf: Soll-Mengen VOR dem Schreiben gegeneinander
  deduplizieren (geteilte Trasse sonst vom zweiten Batch überstempelt).
- Frische Snapshots vor Validierung/Write (`api/app/map-features.php`) — Owner
  editiert parallel; Staleness zeigte sich als überraschende applied-Zahlen.
- Browser-Automation: javascript_tool-CDP kappt bei 45 s (lange Jobs fire-and-forget
  mit window-Status + Polling); verstecktes Tab pausiert rAF (Zoom-Messwerte falsch
  negativ — Highlight-/Datenzähler statt getZoom()).
- iconv/Umlaut-Slugs: `wiki_key` kann Umlaute verschlucken (`f-rstenstrasse`) —
  Keys IMMER aus Staging/Suche übernehmen, nie selbst slugifizieren; UUIDs nie aus
  8-Zeichen-Kurzformen raten.
- `php -d extension=mbstring` für Tests, die `sync.php` laden.

## 7. Verifikation (DoD)

1. Wiki-Edit-Simulation: Staging-`verlauf` eines Testwegs ändern (oder echten
   Wiki-Edit + Re-Crawl) → genau EIN `verlauf_changed`-Fall für diesen Weg.
2. Apply des Falls: Soll-Segmente zugewiesen (kanonischer Name, `source='verlauf-sync'`,
   `course_hash` aktuell), entfallene `verlauf-sync`-Segmente gelöst (eigener
   generischer Name); Way-Label/Deep-Link folgen sofort.
3. Owner-kuratiertes Segment im Diff → Apply entfernt es NICHT, Fall zeigt
   `course_conflict`-Flag.
4. `station_missing`/`hops_unroutable` erscheinen als Hinweis-Fälle (Testweg mit
   erfundener Station bzw. Fluss mit Netzlücke).
5. „Alle unstrittigen übernehmen" fasst strittige nicht an.
6. Undo im Änderungs-Verlauf stellt ein per Sync zugewiesenes/gelöstes Segment her.
