# Gebirgssimulation V12 — Bauplan

**Stand:** 2026-09-04 · **Owner-GO:** „das wollen wir. das bauen." (am Bild von Roter Sichel und
Finsterkamm) · **Werkbank:** `docs/gebirge-hydrologie-mockup.html` · **Rechnung:**
`js/map-features/map-features-ecosystem-hydrologie.js`

> **Erfolg ist gemessen, nicht behauptet:** (1) das Kartenbild sieht aus wie das abgenommene Mockup,
> (2) die GUI kennt die Regler. Alles andere ist Mittel zum Zweck.

---

## 0. Was schon steht

Die Rechnung ist fertig und im Mockup abgenommen. Der Trichter `avesmapsGebirgsRasterBauen(eingabe)`
fährt die Kette:

```
Gipfelkerne → lösen → Kamm → lösen → Bergform ADDIEREN → Rauschen
            → TÄLER ABZIEHEN (Flüsse + Seen) → Erosion
```

Gemessen (Rote Sichel / Finsterkamm): Gipfel **0,0000** · Rand **0** · Fluss 3.881 / 1.445
(von 61.657 / 20.220) · See 477 / 34 (von 2.811 / 0) · Täler auf 40 % / 10 % der Fläche.

---

## 1. Die Regler — was es gibt und was fehlt

| Regler | Spalte | heute | V12 braucht |
|---|---|---|---|
| Erhebungen | `terrain_grain` | ✅ | Körnung des Grundrauschens |
| Erosion | `terrain_levels` | ✅ | **zwei Bedeutungen** — siehe 💣 |
| Maximalhöhe | `terrain_avg_height` | ✅ | Niveau ohne Gipfel |
| Durchschnittshöhe | `terrain_mean_height` | ✅ | (V8-Rest, in V12 ohne Wirkung) |
| **Bergform** | `terrain_bergform` | ❌ | Kegelradius je Gipfel |
| **Rauschen** | `terrain_rauschen` | ❌ | Stärke des Grundrauschens |
| **Talbreite** | `terrain_talbreite` | ❌ | halbe Talbreite |
| **Einschnitt** | `terrain_einschnitt` | ❌ | wie tief ein Lauf sich eingräbt |
| **Kamm-Sattel** | `terrain_sattel` | ❌ | Durchhang zwischen zwei Gipfeln |

💣 **`terrain_levels` trägt heute ZWEI Bedeutungen** — die Beschriftung sagt „Erosion", der Wert
speist in V12 sowohl die fbm-Oktaven als auch die Zahl der Erosionsschritte. Das wird getrennt:
`terrain_levels` bleibt die **Erosionsstufe** (0–5, so heißt der Regler), die Oktaven bekommen ihren
Wert aus der Körnung. Ohne diese Trennung ändert ein Regler zwei Dinge.

⚠️ **`terrain_bergform` ist heute nicht nur ungeregelt, sondern schaltet die Rechnung ab:**
`undefined` → `rad0 = 0` → `addiereGipfelkegel` kehrt sofort zurück. Bis die Spalte existiert, gibt
es keine Bergform.

---

## 2. Die Schritte

### A — GUI (Owner-Teil 2)
1. **Fünf Spalten** in `ecosystem_area`, nach dem vorhandenen Muster (`ALTER TABLE … ADD COLUMN …
   NULL`, `NULL` = ableiten). `api/_internal/app/ecosystem.php`: DDL, Nutzlast-SELECT, Schreibpfad,
   Rücklesen.
2. **Markup** in `index.html`, Abschnitt `#ecosystem-properties-terrain`. 🔴 **Kompakt** — neun
   Regler in der heutigen Bauform wären eine Wand. Zwei Gruppen: „Gebirge" (Erhebungen, Bergform,
   Rauschen, Kamm-Sattel, Maximalhöhe) und „Wasser & Erosion" (Talbreite, Einschnitt, Erosion),
   die zweite als natives `<details>` — dieselbe Rezeptur wie „n weitere Quellen" und das Fenster
   „Hinweise", damit Strg+F den Text findet.
3. **`TERRAIN_FIELDS`** in `map-features-ecosystem-properties.js` um die fünf erweitern; der Rest
   (Rendern, Zurücksetzen, Speichern, Auto-Erkennung) läuft über diese eine Liste.
4. **Knopf „Höhenfeld erzeugen"** neben „Auf Automatik zurück" — rechnet die offene Fläche und lädt
   ihr Raster hoch.
5. **Kein Schleier.** 💣 Die vorhandene Regel gilt `#ecosystem-properties-overlay`, und **das
   Element gibt es seit dem 25.08.2026 nicht mehr** — der Dialog ist `#landschaft-dialog-overlay`.
   Der bekommt `background: transparent` + `pointer-events: none` (Kinder `auto`).
   ⚠️ Das gilt dann allen drei Reitern des vereinigten Fensters, nicht nur dem Gelände-Teil.

### B — Darstellung (Owner-Teil 3)
6. `map-features-ecosystem-height-render.js`: Streiflicht aus dem Raster, **nur die Fläche mit
   offenem Dialog**, Pane 420 → **249** (unter `roadsPane` 400 und `ecosystemPaneTopographie` 250).
7. 💣 **Die Regler-Vorschau kostet 1,5 s je Rasterbau.** Beim Ziehen wird das je Frame gerechnet.
   Also: grobes Raster (`deckel`) während des Ziehens, feines beim Loslassen.

### C — Wegfindung (Owner-Teil 1)
8. `paths-geometry.php` um `feature_subtype` + `flow.dir` + `is_bach` erweitern (additiv).
9. `ecosystem-areas.php` um `curve_label_line` erweitern.
10. `runHeightmaps()` fährt den Trichter statt `buildEcosystemHeightStack`.
11. 🔴 **Die offene Frage:** ein gespeichertes Raster trägt vertraglich nur das EIGENE Feld, der
    Leser summiert überlappende (`avesmapsHeightmapSampleSum`). Der Trichter liefert eine absolute
    Höhe. **Vor Schritt 10 messen:** wie hoch steht das Feld an der äußersten Innenzelle, und was
    macht das an den 22 überlappenden Gebirgspaaren? Ergibt die Messung einen sichtbaren Sprung,
    ist das eine Owner-Entscheidung (Leser summiert nicht mehr / Umrechnung in ein Eigenfeld).

### D — Absicherung
12. `js/map-features/__tests__/gebirgssimulation.test.js` — die Invarianten, **ausgeführt**, nicht
    per Regex gelesen. Mutationsprobe je tragender Stelle.
13. Ganzes Testfeld nach dem Muster des Deploy-Workflows.

---

## 3. Die Fallen, die dieser Bau schon einmal gestellt hat

- 💣 **Ein Kommentar, der eine Absicht beschreibt.** „vor -heightmap-raster.js, das ihr Ergebnis
  speichert" stand da, während die Editorseite das Modul gar nicht lud.
- 💣 **Eine tote CSS-Regel** für den Zustand gehalten (`#ecosystem-properties-overlay`).
- 💣 **Eine Variable aus einem entfernten Block** (`fields`, `stack`) — `node --check` bleibt grün,
  der ReferenceError kommt zur Laufzeit und verhindert, dass der Dialog überhaupt aufgeht.
- 💣 **Feste Zellzahl statt Zellweite** — 41 von 69 Rastern wären beim Speichern abgewiesen worden.
- 💣 **Nach der Erosion zurechtbiegen** statt gar nicht erodieren — Rauheit 269 statt 171, im Bild
  ein Wurmnetz.
- 🪤 **Zwei Messungen desselben Namens.** „Rand" hieß in meiner Probe „außerhalb der Fläche", im
  Mockup „innerhalb mit Relief 0". Die zweite ist die richtige, und nur sie fand die 169,7 Schritt.
- 🪤 **Der Konsolenpuffer des Browser-Panes überlebt Navigationen** und sortiert Fehler vor die Logs.
  Trennmarke setzen, dann neu laden.
