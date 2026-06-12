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

## Offene Entscheidungen / Risiken (die vorsichtigen Punkte)
- **Niedrige Zoomstufen / Aggregat-Hüllen:** Schraffieren wir nur auf der **eigenen Ebene** (Vorschlag) oder
  „bubbled" ein Konflikt in die Eltern-Hülle hoch? → vorerst nur eigene Ebene (einfachste, klarste Variante).
- **Claimant-Farbe:** Streifen brauchen Farbe → Claimant sollte ein **echtes Territorium** (mit Farbe) sein.
  Reine Wiki-Knoten ohne `political_territory` hätten keine. Nur Territorien erlauben, oder Farbe ableiten?
- **Besitzer als Streifen?** Annahme: Besitzer-Farbe **ist** einer der Streifen (er beansprucht es auch). (bestätigen)
- **Wiki-Import** der Ansprüche aus wiki-aventurica = **eigene, spätere Phase** (erst manuell, dann Import).

## Phasen & Fortschritt
- [~] **Phase 0 — Rendering-Spike** (wegwerfbar, mini-HTML, kein Avesmaps): Optik + Performance der Schraffur
  beweisen, bevor Daten/UI/Risiko genommen wird. → `docs/spikes/umstrittene-gebiete-schraffur-spike.html`
- [ ] **Phase 1 — Daten + Editor-UI**: claims-Tabelle, lese/schreib-Endpoints, „Konfliktpartei"-Block, manuell
  hinzufügen/entfernen, Canvas-Overlay live.
- [ ] **Phase 2 — WikiSync-Schutz** (+ optional Wiki-Import der Ansprüche).

## Fortschrittslog
- **2026-06-11:** Konzept festgehalten (diese Datei). Rendering-Spike als eigenständiges Mini-HTML erstellt
  (Canvas-Schraffur, N Farben, Streifenbreite/Winkel/Deckkraft, Nachbar-Kontext) → Optik-Entscheidung offen.
