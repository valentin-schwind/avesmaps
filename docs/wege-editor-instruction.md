# Wege-Editor — Bauauftrag

> **Auftrag an eine neue Session.** Stand: 2026-08-02. Der Wege-Editor ist der **achte**
> Sync-Editor. Er hat einen Vorläufer, dem er in Aufbau und Verhalten folgen soll: den
> **Regionen-/Landschaften-Editor** (`html/landschaften-editor.html`, der siebte).
>
> 🔴 **ERST EIN VOLLSTÄNDIGES MOCKUP, DANN BAUEN.** Der Owner will das Mockup sehen, bevor
> irgendetwas verdrahtet wird. Vorbild: `docs/siedlungseditor-mockup.html`.

---

## 1. Wo er andockt

`js/review/review-subjects.js:68` hält den Platz schon frei:

```js
{ key: "paths", label: "Wege", syncButtonId: "wiki-sync-sync-path",
  editorButtonId: null, syncKind: "path", views: WIKI_SYNC_PATH_VIEWS },
```

`editorButtonId: null` ist die Lücke. Im Reiter **Editor → WikiSync → Wege** entsteht der Knopf
**„Wege bearbeiten"**, genau wie „Regionen bearbeiten" es beim siebten Editor tut. Das
**„🚨 Syncen" zieht dabei ins Menüband des neuen Fensters um** und verschwindet aus dem Reiter —
dieselbe Bewegung wie bei Siedlungen, Kraftlinien und Regionen.

⚠️ `WIKI_SYNC_PATH_VIEWS` sind die vorhandenen Reiter der Wegeliste. **Ergänze die Werteliste
nicht** — die Reiter-Kaskade ist an dieser Stelle schon einmal gebrochen worden.

---

## 2. Die drei Spalten

Wie beim siebten Editor: Liste links, Eigenschaften Mitte, Anschauung rechts.

**Spalte 1 — Liste + Filter.** Alle Wege, mit den Reitern und dem **Filter-Trichter**, die der
Reiter „Wege" heute schon hat. Übernimm die geteilte Trichter-Komponente, baue keine zweite.
🔴 Der Trichter kennt eine Panel-Jahr-Falle — prüfe, wie der Regionen-Editor sie löst.

**Spalte 2 — Eigenschaften.** Das, was heute „Wege bearbeiten" öffnet, vollständig editierbar.
Dazu **neu**: die **Zugehörigkeit** des Weges (durch welche Landschaften er führt). Die Rechnung
dafür existiert bereits — `map-features-path-landscapes.js` und die Kachel „Zugehörigkeit rechnen"
des Landschaften-Editors. **Nicht neu implementieren, wiederverwenden.**

**Spalte 3 — Höhenprofil als Diagramm.** Der Weg als Höhenkurve über die Länge, in zwei Auflösungen:
**Gesamtweg** und **je Segment**. Datenquelle ist `path_terrain.profile_json` — vier Zahlen je
Wegstück `[Anstieg, Abstieg, steiler Anstieg, steiler Abstieg]` in Schritt, in **Speicherrichtung**.
💣 `profile_json` enthält **keine absoluten Höhen**, nur Differenzen je Wegstück. Die Kurve entsteht
durch Aufsummieren — der Startpunkt ist frei wählbar, also beschrifte die Achse als *relative* Höhe.
💣 Und es gibt **keine Länge** in `path_terrain`; die kommt aus `geometry_json`.

💣 **DREI GLEICHE SPALTEN.** `flex: 1 1 0` erzeugt sie *nicht* — border-box und Inhaltsmindestbreite
brechen die Gleichheit. Siehe die Designsprache-Spec, §11.1 trägt gemessene Zahlen.

---

## 3. Das Menüband

Kachelmuster wie im Landschaften-Editor — **der Status steht im Knopf**, nicht daneben:

```html
<button type="button" class="avm-tile" id="…" title="…">
  <span class="t1">Beschriftung</span>
  <span class="t2" id="…Info">noch nicht gerechnet</span>
</button>
```

| Kachel | Herkunft |
|---|---|
| **🚨 Wege syncen** | zieht aus dem Reiter um; `t2` trägt das **letzte Sync-Datum** wie bei den anderen |
| **Zugehörigkeit rechnen** | aus dem Landschaften-Editor (`ecoRaycast`) — dort **bleiben**, hier zusätzlich |
| **Wegprofile rechnen** | **wandert** aus dem Landschaften-Editor (`ecoProfiles`) hierher |
| **Wegprofile kalibrieren** | **neu**, siehe §4 |
| **Funktionen anzeigen** | **neu**, siehe §5 |

💣 **„Letzte Sync" ist LAUF-basiert, nicht zeilenbasiert** — beim `$done` stempeln, nicht beim
letzten geschriebenen Datensatz. Diese Verwechslung ist in diesem Projekt schon passiert.

---

## 4. „Wegprofile kalibrieren" — das eigentlich Neue

Bestimmt den globalen Skalierungsfaktor `c`, der das Reisemodell an die DSA-Regel bindet, und
**speichert die Akkumulation**. Die Herleitung steht in der Sitzung vom 01./02.08.; hier das
Nötige.

**Die Rechnung.** Über die Referenzmenge **G = alle Wege des Typs „Straße"** (die ×1,0-Kategorie,
um die DSAs Multiplikatorentabelle gebaut ist):

```
c = 30 · Σ(lᵢ · Fᵢ) / Σlᵢ          i ∈ G
```

`F` ist der **Zeitfaktor** (≥ 1), nicht die Geschwindigkeit. 💣 Wer Geschwindigkeiten mittelt,
verfehlt das Ziel — am Zweisegment-Beispiel um 56 %.

Zusätzlich je Wegart `j` der Mittelwert `mean_j(F)`, damit später
`mⱼ = μⱼ · mean_j(F) / mean_G(F)` gebildet werden kann (μⱼ = DSA-Multiplikator). Das ist die
Formel, die die **Doppelzählung** auflöst: heute trägt ein Gebirgspass den Kategorieabschlag *und*
den Steigungsfaktor.

**Der Ort ist der Profillauf.** `avesmapsTerrainProfileStep` in `api/_internal/app/terrain-store.php`
läuft ohnehin über **jeden** Landweg genau einmal und hat die Geometrie in der Hand — und nur dort
liegt die **Länge** vor, die `path_terrain` nicht speichert. Eine reine SQL-Abfrage kann `c` also
gar nicht berechnen. Akkumuliere in `path_terrain_stamp` (Einzelzeile, summiert schon
`ways_seen`/`ways_with_profile`).

**Fünf Fallen, alle belegt:**

1. 💣 **Nur beim `$done` schreiben.** Der Lauf ist fortsetzbar und kann liegenbleiben; bis dahin
   gilt das alte `c`. Eine halbe Eichung verstellt das Tempo der ganzen Karte.
2. 💣 **Wege ohne Rasterberührung bekommen keine Zeile** (Bounding-Box-Vorfilter). Gemessen wird
   also über **vermessene** Wege. Das ist richtig so — `F = 1` heißt dort „unbekannt", nicht
   „eben" — aber es muss im Bericht stehen.
3. 💣 **Ungedeckelt akkumulieren.** Ohne Deckel ist der längengewichtete Mittelwert über Kanten
   **bit-identisch** mit dem Wert des ganzen Weges (Additivität). Der Deckel 4,0 bricht das — im
   Einzelfall um bis zu +119 % —, trifft aber nur 20 von 4.080 Richtungen (0,49 %), und der
   Profillauf kennt die Kantengrenzen gar nicht.
4. 💣 **Beide Richtungen gleich gewichten.** Vorwärts `ascent + steep_descent`, rückwärts
   `descent + steep_ascent`, beide aus denselben gespeicherten Summen.
5. 💣 **`c` ist eine stille Systemkonstante.** Ändert sie sich, ändert sich das Tempo der ganzen
   Karte, ohne dass jemand etwas angeklickt hat. Alten und neuen Wert im Ergebnis nennen, und die
   `map_revision` mitführen, bei der sie entstand — das Wegenetz ändert sich zwischen zwei Läufen.

⚠️ **Inert bauen.** Die Kalibrierung rechnet, speichert und berichtet — sie darf **keine einzige
Reisezeit ändern**, solange der Owner Kurve und `mⱼ` nicht entschieden hat.

---

## 5. „Funktionen anzeigen"

Öffnet die Diagramme, die zeigen, wie das Modell **gerade** aussieht. Mindestens:

- **Zeitfaktor über Neigung**, −45 % bis +45 %, mit Deckel und der Kante bei 20 % Gefälle.
- **Meilen/h über Neigung** je Transportmittel, wählbar nach Wegtyp.
- **Verteilung der gemessenen Neigungen** je Wegart — das ist die Datenlage, die `c` bestimmt.
- Das Ergebnis der letzten Kalibrierung: `c`, `mean_G(F)`, `mean_j(F)` je Wegart.

Achsen in **Prozent** und **Faktor** beziehungsweise **Meilen/h**, nicht in Rohgrößen. Farben
ausschließlich aus `css/base/tokens.css` — **kein Blau**, nichts hartkodiert.

---

## 6. Regeln, die für jeden Editor dieses Projekts gelten

- **Designsprache:** `docs/superpowers/specs/2026-07-22-editor-designsprache-design.md` und
  `docs/design-language.md`. Die Spec ist ein Arbeitspapier und war mehrfach falsch — **gegen den
  Code prüfen**, nicht glauben.
- **Hülle:** die Overlay-Maße stehen als JS-Inline-Style (`min(1400px, calc(100vw - 24px))` ×
  `min(880px, calc(100vh - 24px))`), viermal wortgleich kopiert. Hülle ≠ Inhalt.
- 💣 **Ein neues Overlay-Fenster braucht seine ID in DREI Listen** — sonst fehlen Verschiebbarkeit,
  z-index oder Schließverhalten. Siehe die Checkliste im Kraftlinien-/Regionen-Editor.
- 💣 **Overlay-iframes werden beim Wiederöffnen stale.** Der siebte Editor löst das; kopiere seine
  Lösung, statt eine zu erfinden.
- 💣 **Globals im falschen Frame.** Der Edit-Shell-iframe hat seinen eigenen `window`.
- **Leere Zustände** ausformulieren („noch nicht gerechnet — Kachel im Menüband"), nie leer lassen.
- ⚠️ **`ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` bumpen**, wenn dynamisch
  geladene Editor-Assets sich ändern. Und `edit/index.php` verlinkt `css/pages/edit.css` mit einem
  **handgeschriebenen** `?v=` — bei Änderungen an `edit.css` von Hand hochzählen.
- 🔴 **`html/editor-handbuch.html` NICHT anfassen.** Es gehört einer nächtlichen Routine. Deine
  Pflicht ist nur ein Commit-Betreff, der die sichtbare Wirkung nennt („neuer Wege-Editor",
  „‚Wegprofile rechnen' ist umgezogen").
- **Geteilter Arbeitsbaum:** nie `git add -A`, nur eigene Dateien mit explizitem Pfad. Eigenen
  Worktree aus `origin/master`, den Hauptbaum nicht umstellen.

---

## 7. Abgabe

1. **Zuerst das Mockup** — statisch, alle drei Spalten, das Menüband mit allen fünf Kacheln, die
   Diagramme mit Beispieldaten. Dem Owner zeigen, **dann** weiterbauen.
2. Danach der Editor, in dieser Reihenfolge: Hülle + Spalten → Liste/Filter → Eigenschaften →
   Höhenprofil → Menüband → Kalibrierung → Funktionen.
3. Tests für alles, was rechnet. Besonders für §4: der Mittelungsfehler aus Falle 3 ist genau die
   Sorte, die stumm bleibt.

**Nicht in diesem Auftrag enthalten** und ausdrücklich offen: welche wissenschaftliche
Steigungsfunktion verwendet wird, ob die DSA-Wegtypfaktoren die typische Steigung schon enthalten,
und ob `mⱼ` umgestellt wird. Der Editor **misst und zeigt** — entschieden wird danach.
