# Feature: Umstrittene Gebiete (Schraffur mehrerer Anspruchsteller)

**Status:** KONZEPT · Phase 0 (Rendering-Spike)
**Letzte Aktualisierung:** 2026-06-11

---

## Ziel (was wir wollen)
Ein Gebiet hat einen **Besitzer** (= bestehende Zuweisung / Eltern-Kette). Zusätzlich können **andere
Reiche Ansprüche** auf dasselbe Gebiet erheben (in wiki-aventurica hinterlegt). Ein solches Gebiet ist
**„umstritten"** und soll als **diagonale Schraffur** dargestellt werden, die **abwechselnd zwischen den
Farben aller beanspruchenden Reiche** wechselt.

Bedienung:
- Konfliktparteien **hinzufügen/entfernen nur im Territoriums-Editor** (Dropdown/Picker; beliebiger Knoten
  aus der Liste). Mit der ersten zusätzlichen Partei wird das Gebiet automatisch „umstritten", mit der
  letzten entfernten wieder normal.
- Die **Schnell-Liste** im Editor-Panel unterstützt das **NICHT** (bleibt reines Drag&Drop auf ein Gebiet).
- **WikiSync & Editor** der Herrschaftsgebiete sollen davon **nicht groß beeinträchtigt** werden — außer wo
  sie es wissen müssen (v. a. Modellübernahme darf Claims nicht löschen; optional Wiki-Import der Ansprüche).

## Architektur-Vorschlag (3 sauber getrennte Schichten)
Leitgedanke: das bestehende **Besitz-Modell und WikiSync nicht anfassen** — Claims sind rein additiv.

1. **Daten — eigene Tabelle, Besitz unangetastet**
   `political_territory_claim`: `territory_id`, `claimant_territory_id` *oder* `claimant_wiki_key`,
   `sort_order` (Streifen-Reihenfolge), `source` (`manual`/`wiki`), `is_active`, audit-Felder.
   Der **Besitzer** bleibt die normale Zuweisung. **„Umstritten" ist abgeleitet** (hat ≥1 aktiven Claim) —
   kein extra Status, der synchron gehalten werden muss.

2. **Rendering — eigenes Canvas-Overlay (empfohlen), die SVG-Fills NICHT anfassen**
   Gebiets-Füllungen sind heute SVG-`L.polygon`. SVG-Pattern-Fills für Schraffur sind in Leaflet fummelig
   (setStyle setzt Farbe statt Pattern; bei Re-Render weg). Sauberer: ein neues Canvas-Overlay (wie das
   Grenzen-/Pfad-Label-Overlay) zeichnet nur für die **wenigen umstrittenen** Gebiete diagonale Streifen,
   die durch die Claim-Farben (inkl. Besitzer) rotieren, geclippt aufs Polygon. Volle Kontrolle (N Farben,
   Streifenbreite, Winkel), unabhängig vom Fill, performant (umstritten = Ausnahme, nicht 577 Gebiete).

3. **UI — „Konfliktpartei"-Block im Territoriums-Editor**
   Nur wenn das Gebiet zugewiesen ist: Bereich „Umstritten mit …" mit Picker (beliebiger Knoten) + Liste der
   Parteien mit Farb-Swatch und „✕ entfernen". Kein separater „Status zuerst"-Schritt.

## Bestätigte Spezifikation (2026-06-11, Spike abgenommen)
- **Streifenfarben = `territory.color`** der Anspruchsteller → ein Claimant muss ein **echtes Territorium** (mit
  Farbe) sein.
- **Streifenbreite 20px, Winkel 45°** (Werte aus dem Spike).
- **Deckkraft je Streifen = `territory.opacity`** des jeweiligen Knotens (jede Partei mit ihrer eigenen
  Transparenz).
- **Grenzen-Darstellung bleibt unverändert** — die Schraffur ist ein **eigenes** Overlay; das Grenzen-Overlay
  wird NICHT angefasst.

## Render-Entscheidung: Option A — Füllung ausschneiden (2026-06-12 bestätigt)
Das umstrittene Gebiet wird **aus der Füllung ausgeschnitten** (transparentes Fenster), die Schraffur zeichnet
dort über das **Basis-Kartenbild** (nicht über die Reichsfarbe → kein Matsch). **Machbar als reiner Render-Cut
ohne Geometrie-Operation**, weil der Layer (`territories-layer.php:240-279`) jede Quell-Geometrie auf JEDER
Zoomstufe einzeln zeichnet (bei Tiefzoom nur auf den Vorfahren **umgefärbt**; eigene `geometry_public_id` →
kein Dedup, Zeile 827-829). Die „solide Reichsfläche" ist also N gleichfarbige Nachbarpolygone — wir setzen nur
das Polygon des umstrittenen Gebiets auf `fillOpacity:0`. **Grenzen-Linie bleibt unberührt** (eigenes Canvas-
Overlay, liest abgeleitete Daten). Overlay erkennt das Gebiet bei Tiefzoom über `aggregate_source_territory_public_id`.
- Verworfen: Option B (nur drüberlegen) → Basis × Reichsfüllung × Streifen = trübe Mischfarben.

## Offene Entscheidungen / Risiken (noch offen)
- **Besitzer als Streifen?** Annahme: ja — der Besitzer beansprucht es auch, seine Farbe ist einer der Streifen.
  (final bestätigen)
- **Wiki-Import** der Ansprüche aus wiki-aventurica = **eigene, spätere Phase** (erst manuell, dann Import).

## Bestehende Konflikt-Daten aus WikiSync (Untersuchung 2026-06-12)
**Befund:** Der Wiki-Crawl extrahiert Ansprüche **bereits** — keine neue Quelle nötig.
- Backend: `avesmapsWikiSyncMonitorParseAffiliation` (sync-monitor.php:962) zieht aus dem `Staat`-Feld
  „beansprucht von/vom …"-Klauseln + konkurrierende Eltern-Klauseln als `conflicts[]`. Gespeichert in
  Staging-Spalte `parent_conflict_json` (Array `{name, wiki_key, resolved}`), an den Editor geliefert als
  `node.conflicts` (nur **Namen**, Freitext) + `node.has_conflict` (Filter „Konflikte (platziert)").
- **Aber verrauscht:** von 1392 Knoten sind 49 als Konflikt markiert (47 platziert), davon nur **22 Gebiete
  mit einem sauberen, auflösbaren Anspruch** (Claimant-Name matcht ein vorhandenes Territorium → hat Farbe).
  Der Rest ist Template-Müll (`wid|Angbar`, `ex|1022 bis 1028 BF`), Status-Wörter („Landstadt") oder
  Zeit-/Historik-Klauseln („zuletzt Königreich Albernia", „vermutlich …").
- **Saubere Beispiele:** Beyrounat Al'Rabat → Emirat Adamantija; Baronie Gadang/Gorbingen/Hengefeldt →
  Markgrafschaft Perricum; Bergfreischaft Ilderasch/Kibrom/Olrong → Bergkönigreich Lorgolosch;
  Emirat Korushan/Adamantija → Sultanat Khunchom. ~10 distinkte Anspruchsteller-Reiche.

**Konsequenz fürs Datenmodell:**
- Anspruchsteller braucht eine **Farbe** → muss auf ein **`political_territory`** auflösen
  (`claimant_territory_id`). Der Wiki-Name ist nur Saat/Vorschlag, nicht direkt renderbar.
- **Kein Auto-Import** der 49 Roh-Konflikte (zu viel Müll). Stattdessen: der Wiki-`conflicts`-Eintrag wird im
  Editor-Picker als **Vorschlag** angezeigt („Wiki nennt: Markgrafschaft Perricum — übernehmen?"), Nutzer
  bestätigt → sauberer manueller Claim. Passt zu „beim Vorschlag vorsichtig sein".

## Phasen & Fortschritt
- [x] **Phase 0 — Rendering-Spike** ABGENOMMEN: Optik bestätigt (20px / 45° / voll abwechselnd; Farben +
  Deckkraft aus dem Territorium). → `docs/spikes/umstrittene-gebiete-schraffur-spike.html`
- [x] **Phase 1b — Canvas-Overlay** GEBAUT + LIVE BEWIESEN: `js/map-features/map-features-contested-hatch-overlay.js`
  (in index.html eingebunden). Eigenständig/additiv, Grenzen + SVG-Flächen unangetastet, HiDPI, Zoom/Pan-Redraw.
  Datenquelle: `feature.properties.contestedParties` (Phase 1a) **oder** `window.__avesmapsContestedClaims[territory_public_id]`
  (Test). Live an Herzogtum Tobrien verifiziert (rot/blau/gelb, sauber geclippt, Nachbarn/Grenzen unberührt).
- [~] **Phase 1a — Daten + Endpoints**: Tabelle `political_territory_claim` **ANGELEGT** (Lazy-Ensure in
  `api/_internal/political/territory.php` + kanonisch in `sql/political-territories.sql`). Nur `territory_id`
  + `claimant_territory_id` (+ sort_order/source/claimant_wiki_key/is_active/audit) — **keine** FK zu
  Geometrie/Grenzen (beide aus `territory_id` abgeleitet), Hauskonvention: Plain-Index + Soft-Delete, keine
  FK-Constraints. OFFEN: add/remove/list-Endpoints, Layer liefert `contestedParties` (color+opacity je Partei).
- [ ] **Phase 1c — Editor-UI**: „Konfliktpartei"-Block (Picker beliebiger Knoten + Liste + entfernen).
- [ ] **Phase 2 — WikiSync-Schutz** (+ optional Wiki-Import der Ansprüche).

## Fortschrittslog
- **2026-06-11:** Konzept festgehalten (diese Datei). Rendering-Spike als eigenständiges Mini-HTML erstellt
  (Canvas-Schraffur, N Farben, Streifenbreite/Winkel/Deckkraft, Nachbar-Kontext).
- **2026-06-11 (2):** Spike abgenommen. Bestätigt: Streifenfarben = `territory.color`, Breite **20px**,
  Winkel **45°**, Deckkraft = `territory.opacity`, **Grenzen unangetastet** (eigenes Overlay). → bereit für
  Phase 1.
- **2026-06-11 (3):** **Phase 1b gebaut + live bewiesen.** Overlay `map-features-contested-hatch-overlay.js`
  (commit 3c2d360f) + in index.html eingebunden. Live an Herzogtum Tobrien per Test-Override (`window.__avesmapsContestedClaims`)
  verifiziert: diagonale Schraffur (20px/45°, 3 Parteifarben), sauber aufs Polygon geclippt, Nachbarn + Grenzen
  unberührt, halbtransparent. → Nächster Schritt: Phase 1a (Daten/Endpoints, CREATE TABLE braucht Nutzer-OK).
