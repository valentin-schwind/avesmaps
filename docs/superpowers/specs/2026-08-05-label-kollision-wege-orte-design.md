# Gemeinsame Kollisionsstrategie: Wegnamen ↔ Ortsnamen

**Stand:** 2026-08-05 · Entwurf, offline gegen echte Daten gemessen · Owner-Entscheid „Variante A" liegt vor

## 1. Das Problem

Weg- und Flussnamen legen sich über Ortsnamen (Owner-Meldung 2026-08-05 mit Screenshot:
„Reichsstraße 1" quer über „Wehrheim", „Reichsstraße" quer über „Eslamsroden").

Ursache ist keine Fehlberechnung, sondern **zwei getrennte Beschriftungswelten, die einander nicht
kennen**:

| | Ortsnamen, Landschafts-/Meerestitel, Gebietsnamen | Weg- und Flussnamen |
|---|---|---|
| Technik | DOM-Marker (`<img>` im `divIcon`) | Glyphen auf einem Canvas-Overlay |
| Auflösung | `js/map-features/map-features-label-collisions.js`, zwei Pässe pro Frame | `map-features-path-label-canvas-overlay.js`, `redraw()` |
| kennt | einander (seit `18c91df1` auch über die Passgrenze) | **nur sich selbst** (`acceptedWayLabelBoxes`, nur Kanal A) |
| Koordinaten | Viewport (`getBoundingClientRect`) | Container-Pixel (`map.latLngToContainerPoint`) |

Gemessen über die ganze Karte bei Zoom 4: von 575 gezeichneten Wegnamen liegen **362 über einem
Ortsnamen oder Landschaftstitel** — 63 %.

## 2. Die Entscheidung

**Eine Belegungskarte pro Bild, eine feste Rangfolge.** Wer zuerst platziert ist, ist Hindernis für
alle danach:

1. Gebietsnamen (Territorien) — wie heute
2. Landschafts-/Meerestitel (freie Karten-Labels, Priorität 1000+) — wie heute
3. **Ortsnamen** — wie heute, aber ihre Endlage wird jetzt veröffentlicht
4. **NEU: Weg- und Flussnamen ganz zuletzt** — sie sehen alles, was schon steht

**Ein Wegname weicht NICHT zur Seite aus.** Seine einzige erlaubte Freiheit ist, **an der eigenen
Linie entlangzurutschen** (±300 px, in 12-px-Schritten) — die Schrift bleibt exakt auf ihrem Weg.
Findet er dort keine freie Stelle, wird die Platzierung **weggelassen** (Owner-Entscheid „Variante A",
2026-08-05). Ein Weg trägt seinen Namen ohnehin alle ~600 px erneut (`WAY_LABEL_SCREEN_INTERVAL_PX`),
die nächste Wiederholung übernimmt.

Die Rutschweite ist kein Zufallswert: 300 px ist die halbe Wiederholungsstrecke — weiter zu rutschen
liefe in den Platz der Nachbarplatzierung. Gemessen bestätigt: 0 px → 445 weggelassen, 150 px → 249,
**300 px → 220**, 600 px → 211. Ab der halben Strecke bringt Weiterrutschen fast nichts mehr.

## 3. Die Messung (offline, echte Daten, vor jeder Zeile Produktivcode)

Prüfseite `verify-labelkollision.html` (nicht im Repo — wie alle `verify-*`-Seiten lokal). Sie lädt die
**echten** Quellfunktionen per `<script src>` (`getCatmullRomSplineCoordinates`, `buildWayLabelChains`,
`computeWayLabelIntervalOffsets`, `renderMapLabelToImage`, `getLocationMarkerSize`,
`getLocationNameLabelSize`) und **einen** Abruf von `api/app/map-features.php` (2775 Siedlungen,
692 Landschafts-/Meerestitel, 1933 beschriftbare Wege). Gezählt wird per SAT-Test **gedrehter
Buchstabenkästen** gegen die Label-Kästen — genau das, was man auf der Karte als Überlagerung sieht.

### Ergebnis, ganze Karte

| | Zoom 4 heute | Zoom 4 Strategie | Zoom 5 heute | Zoom 5 Strategie |
|---|---|---|---|---|
| Wegnamen gezeichnet | 575 | 453 | 1002 | **1012** |
| davon über einem Namen | **362** | **0** | **411** | **0** |
| am eigenen Weg verschoben | — | 229 | — | 414 |
| weggelassen | — | 220 | — | 109 |

Bei Zoom 5 zeichnet die Strategie **mehr** Namen als heute und hat trotzdem keine einzige
Überlagerung: das Entlangrutschen löst nebenbei Selbstkollisionen auf, an denen heute Platzierungen
stillschweigend ausfallen.

### Der Preis, geprüft statt geschätzt

Bei Zoom 4 verschwinden 86 Wegnamen ganz aus der Karte. Gegenprobe: **alle 86 sind Namen, die heute an
JEDER ihrer Stellen unter einem Ortsnamen liegen** — sie sind heute nie lesbar. Es geht kein einziger
lesbarer Name verloren.

### Verworfene Varianten (gemessen, nicht vermutet)

- **Kollisionskästen der Ortsnamen schrumpfen** (Halo-Polster abziehen), um weniger wegzulassen:
  bringt 37 Namen mehr, holt aber **119 echte Überlappungen zurück**. Verworfen.
- **Nur Ortsnamen meiden, die großen Landschaftstitel ignorieren:** 490 statt 453 gezeichnet, aber
  86 Namen liegen dann weiter über „GREIFENER LAND" & Co. Verworfen — die Titel sind ebenso Text.
- **Wegnamen ZUERST setzen, Ortsnamen weichen aus** (sie haben zwölf Ausweichplätze): erreicht
  591 Wegnamen bei 0 Überlappungen, **kostet aber 503 zusätzlich ausgeblendete Ortsnamen**
  (444 → 947). Verworfen: Orte sind der Inhalt dieser Karte, Wegnamen die Beschriftung.
- **Kleiner senkrechter Versatz** (Name eine Zeilenhöhe über/unter die Linie): hebt Zoom 4 von 453 auf
  531 gezeichnete Namen. **Nicht gebaut** — der Owner hat festgelegt, dass Straßennamen auf ihrer
  Straße liegen. Bleibt als Stellgröße dokumentiert, falls er es sehen will.

### Kosten pro Bild

Nicht über die ganze Karte, sondern in einem echten Fenster (1400 × 800 px), fünf Läufe, bester Wert:

| Ausschnitt | Ortsnamen im Bild | Ketten im Bild | Strategie gesamt |
|---|---|---|---|
| Wehrheim, Zoom 4 | 102 | 14 | **2,7 ms** |
| Gareth, Zoom 4 (dichteste Stelle) | 104 | 21 | **4,3 ms** |
| Gareth, Zoom 5 | 40 | 9 | 1,7 ms |
| Havena, Zoom 5 | 22 | 1 | 0,0 ms |

Zum Vergleich: `redraw()` projiziert heute schon jeden Stützpunkt aller Wege — die Zusatzkosten liegen
im einstelligen Millisekundenbereich und damit unter dem, was das Overlay ohnehin tut.

## 4. Architektur

### 4.1 Neue Datei: `js/map-features/map-features-label-occupancy.js`

Die Belegungskarte als eigenes, testbares Ding — ein Gitter über den Bildschirm (Zellen 128 px), Kästen
hängen in allen Zellen, die sie berühren.

```
avesmapsLabelOccupancy = {
  reset(),                 // pro Bild EINMAL, am Anfang des DOM-Passes
  add(rect),               // {left, top, right, bottom} in CONTAINER-Pixeln
  hits(rect) -> rect[],    // nur die Kästen der berührten Zellen
  isEmpty()
}
```

💣 **Es gibt zwei Koordinatensysteme.** Die DOM-Auflösung misst mit `getBoundingClientRect` — das sind
**Viewport**-Koordinaten. Das Canvas-Overlay rechnet in **Container**-Pixeln
(`map.latLngToContainerPoint`). Beim Veröffentlichen wird einmal pro Pass der Ursprung des
Kartencontainers abgezogen (`map.getContainer().getBoundingClientRect()`, ein Aufruf, nicht einer je
Label). Wer das vergisst, verschiebt jedes Hindernis um den Versatz der Karte auf der Seite — und
bekommt Ausweichentscheidungen, die *fast* stimmen.

### 4.2 `map-features-label-collisions.js` veröffentlicht seine Endlage

`resolveLabelCollisions()` hat die Rechtecke bereits (`acceptedRects`) — sie werden heute nur
weggeworfen. Neu: nach der Schreibphase wandern sie in die Belegungskarte.

- Ausgeblendete Labels (`is-colliding`) gehen **nicht** hinein — sie sind kein Hindernis.
- Die Gebietsnamen-Rechtecke (`seedRects` aus `resolveRegionLabelCollisions`) ebenfalls hinein:
  Wegnamen weichen damit auch Reichsnamen aus.
- 💣 `reset()` läuft am **Anfang** des Passes, nicht am Ende. Sonst bleibt bei einem frühen `return`
  (keine Labels sichtbar) die Belegung des letzten Bildes stehen, und Wegnamen weichen Geistern aus.

### 4.3 Reihenfolge im Bild

`scheduleLabelCollisionResolution()` wird zum **einen Taktgeber** der Beschriftung:

```
rAF: reset() → Gebietsnamen → Ortsnamen/freie Labels → veröffentlichen → Canvas-Overlay redraw()
```

Das Overlay behält seine eigenen `moveend/zoomend/viewreset/resize`-Zeichnungen, **überspringt sie
aber, wenn für dieses Bild schon ein Kollisionspass ansteht** (`labelCollisionFrameId !== null`) — sonst
zeichnet es zweimal pro Bild, einmal davon mit den Rechtecken des Vorbildes. Reihenfolge der
Ereignis-Zuhörer: `js/app/bootstrap.js` hängt sich vor dem Overlay ein, der Pass ist also bereits
angemeldet, wenn das Overlay drankommt.

⚠️ Während der CSS-Zoom-Animation (`cssZoomActive`) zeichnet das Overlay wie bisher nicht — unverändert.

### 4.4 `map-features-path-label-canvas-overlay.js`: rutschen statt stur setzen

`drawGlyphsAlong` rechnet die Glyphenlagen bereits aus (`run.glyphs`) und zeichnet sie **im selben
Zug**. Für den Ausweichtest brauchen wir die Lagen **vor** dem Zeichnen. Also aufgeteilt:

- `layoutGlyphsAlong(pts, chars, widths, ls, perpOffset, fontSize)` → reine Glyphenliste (pur, testbar)
- `drawGlyphsAlong(...)` ruft sie auf und malt — **eine** Rechnung, kein zweiter Pfad.

Je Platzierung (Kanal A wie Kanal B):

```
Sollstelle = findCalmLabelCenter(...)                      // unverändert, #18
für versatz in [0, +12, -12, +24, -24, … ±300]:
    fenster = sliceLabelWindow(kette, sollstelle + versatz)
    glyphen = layoutGlyphsAlong(fenster, …)
    wenn glyphen die eigene Kette nicht doppeln
      und kein Buchstabenkasten die Belegungskarte trifft:
        zeichnen, Kasten in die Belegungskarte, fertig
sonst: Platzierung weglassen
```

Trefferprüfung zweistufig, damit sie billig bleibt: erst die grobe Hülle der Platzierung gegen das
Gitter (`hits`), dann nur gegen diese wenigen Kästen der genaue SAT-Test je Buchstabe.

💣 **Der Zuschlag aus #18 darf weiterhin nie über das Stück hinausschieben** — das Rutschen ändert nur,
*wo* das Fenster ausgeschnitten wird, nicht wie `drawGlyphsAlong` darin arbeitet. Die Zusicherung von
`tools/paths/test-path-label-bend-relief.mjs` und Fall #34 bleibt unangetastet.

### 4.5 Stellgrößen (in `map-features-path-labels.js`)

| Größe | Vorgabe | Wirkung |
|---|---|---|
| `PATH_LABEL_DODGE_SLIDE_PX` | 300 | Rutschweite an der eigenen Linie |
| `PATH_LABEL_DODGE_STEP_PX` | 12 | Schrittweite der Suche |

**Kein Rückfallschalter** (Owner-Entscheid 2026-08-05). Ein „0 = wie früher" war angeboten und wurde
abgelehnt: die alte Lage ist keine, in die man zurückwollte.

## 5. Was NICHT geändert wird

- Die Leitlinie bleibt die sichtbare Linie (Variante B, 2026-06-10) — der Name liegt weiter exakt auf
  seinem Weg.
- Kein senkrechter Versatz, keine neue Schriftgröße, keine neue Optik.
- Die Ortsnamen-Auflösung selbst bleibt Zeile für Zeile, wie sie ist — sie **veröffentlicht** nur, was
  sie ohnehin ausgerechnet hat.
- Kraftlinien-Namen (nur im Kraftlinien-Modus, dort gibt es keine Wegnamen) bleiben außen vor.

## 6. Tests

- `tools/paths/test-label-occupancy.mjs` (neu, `extractFunction` wie die übrigen `tools/paths`-Tests):
  Gitter legt einen Kasten in alle berührten Zellen; `hits` liefert Nachbarn und übersieht keinen;
  `reset` leert wirklich; SAT erkennt einen gedrehten Buchstaben über einem Rechteck und meldet keinen
  Fehltreffer bei Berührung an der Kante.
- `tools/paths/test-path-label-dodge.mjs` (neu): die Rutschentscheidung als reine Funktion —
  freie Stelle → Versatz 0; belegte Sollstelle → nächster freier Schritt; alles belegt → weggelassen;
  `SLIDE_PX = 0` → exakt das alte Verhalten.
- Bestehende Tests müssen grün bleiben: `test-path-label-orientation.mjs` (Fall #34),
  `test-path-label-bend-relief.mjs`, `test-way-labels.mjs`.

## 7. Gebaut und nachgemessen (2026-08-05)

Nicht nur offline: in der **echten Anwendung**, mit dem echten Kartenabzug lokal ausgeliefert. Gezählt
wurden Schrift-Bildpunkte auf dem Wegnamen-Canvas, die innerhalb eines Ortsnamen-Kastens liegen — also
am fertigen Bild, nicht am Modell.

| Ausschnitt | vorher (Belegungskarte leer) | nachher |
|---|---|---|
| Wehrheim, Zoom 4 | 2368 Schriftpunkte, **1060 auf einem Ortsnamen** | 1306 Schriftpunkte, **1** |
| Wehrheim, Zoom 5 | 2505, **570** | 1710, **2** |
| Gareth, Zoom 4 | 2451, **1065** | 1314, **1** |
| Gareth, Zoom 5 | 2492, **625** | 1665, **0** |

Kosten am dichtesten Punkt der Karte (Gareth, Zoom 4, 149 Ortsnamen im Bild): `redraw()` 18,2 ms → 24,7 ms,
Veröffentlichen der Rechtecke < 0,01 ms. `redraw()` läuft auf `moveend`/`zoomend`, nicht je Einzelbild.

Tests: `tools/paths/test-label-occupancy.mjs` (19 Prüfungen), `tools/paths/test-path-label-dodge.mjs`
(8), dazu unverändert grün `test-path-label-orientation.mjs` (#34), `test-path-label-bend-relief.mjs`,
`test-way-labels.mjs`. Die beiden letztgenannten mussten ihre Sandbox nachziehen, weil
`drawGlyphsAlong` jetzt geteilt ist.

## 8. Offene Punkte

- Der senkrechte Versatz (siehe §3) liegt gemessen vor, ist aber bewusst nicht Teil dieser Fassung.
- Die Gebiets-/Reichsnamen des politischen Layers waren in der Offline-Messung nicht enthalten (eigener
  Endpunkt). Live sind sie zusätzliche Hindernisse — die gemessene Verbesserung ist also die
  konservative Untergrenze, nicht die Obergrenze.
