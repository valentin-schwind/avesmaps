# Route-Wegpunkt-Marker (Design)

Stand: 2026-07-14 · Status: umgesetzt

## Ziel

Die Route soll auf der Karte **besser sichtbar** sein. Bisher markierten permanent
geöffnete Infoboxen die Wegpunkte — sie verdeckten großflächig die Karte und die
Route selbst. Stattdessen:

- **Deutliche Wegpunkt-Marker** auf der Karte, die ihre **Rolle** zeigen
  (Start / Zwischenziel / Ziel).
- Die **Infobox erscheint beim Überfahren** eines Markers und verschwindet wieder.

## Marker

| Rolle | Grafik | Anker |
|---|---|---|
| Start (erster Wegpunkt) | rote Scheibe mit Ring (`waypoint-start.webp`) | Mitte |
| Zwischenziel | gelbe Scheibe (`waypoint-between.webp`) | Mitte |
| Ziel (letzter Wegpunkt) | roter Tropfen (`waypoint-end.webp`) | **Spitze unten** |

Bei nur einem gesetzten Wegpunkt gilt die Start-Rolle; ein Ziel gibt es erst ab
zwei Wegpunkten.

**Strikter Scope (Bug #10):** Marker bekommen **nur die echten, vom Nutzer
gesetzten Wegpunkte** (`selectedLocations`) — niemals die Kreuzungen und
Durchgangsorte der berechneten Route. Die liegen als kleine Punkte (weißer Ring,
dunkler Kern) auf der Linie und bleiben unverändert. Diese Regel ist der Grund,
warum die Markierung überhaupt ruhig wirkt; sie darf nicht aufgeweicht werden —
im ersten Versuch bekam jede Kreuzung eine Grafik, und genau das machte die Karte
unruhig.

## Konfiguration

Beide Macharten sind gebaut und per Flag umschaltbar (`js/config.js`), jeweils
zusätzlich per URL-Parameter überschreibbar, um sie live zu vergleichen:

| Flag | Werte | Default | URL-Override |
|---|---|---|---|
| `ROUTE_WAYPOINT_MARKER_MODE` | `vector` \| `image` | **`vector`** | `?routemarkers=image` |
| `ROUTE_WAYPOINT_MARKER_SIZE` | `small` \| `medium` \| `large` | **`medium`** | `?routemarkersize=large` |

Größen in px (Start / Zwischen / Ziel-**Höhe**):

| Stufe | Start | Zwischen | Ziel |
|---|---|---|---|
| `small` | 26 | 21 | 36 |
| `medium` | 34 | 27 | 46 |
| `large` | 44 | 35 | 58 |

`image` nutzt die gemalten WebPs, `vector` ein maßgleiches Inline-SVG (scharf auf
jedem DPI, per CSS umfärbbar). Die Rollen-Geometrie ist in beiden Modi identisch.

## Hover-Verhalten

- **Mouseover** auf einen Marker öffnet die Wegpunkt-Infobox
  (`buildRoutePopupHtml` — unverändert, inklusive „Anzeigen“, „Reiseziel
  entfernen“, „Link teilen“). Sie behält damit auch ihr Aussehen: die Klasse
  `floating-location-popup` färbt sie über `var(--color-panel)`, sie folgt also
  weiterhin dem Theme.
- Sie **bleibt offen**, solange die Maus auf dem Marker **oder** auf der Infobox
  ist. Eine Schließverzögerung (`ROUTE_WAYPOINT_POPUP_CLOSE_DELAY_MS`) überbrückt
  die Lücke dazwischen — sonst wären die Buttons unklickbar.
- **Klick pinnt** die Infobox fest: sie bleibt offen, bis man sie schließt. Auf
  Touch-Geräten (kein Hover) ist das der reguläre Weg.
- Die Typ-Zeile nennt zusätzlich die Rolle: „Dorf · Startpunkt“.

> **Nicht auf die Event-Reihenfolge verlassen.** Ob die Box offen bleibt, wird über
> **expliziten Zustand** entschieden („Maus auf Marker?“, „Maus auf Box?“, „gepinnt?“)
> — nicht danach, ob `mouseout` vor `mouseenter` eintrifft. Sobald die Infobox den
> Marker überlappt (bei `large` realistisch), feuert `mouseenter` der Box **vor**
> `mouseout` des Markers; eine reine Timer-Logik setzt dann den Schließ-Timer, den
> niemand mehr aufhebt — die Box klappt zu, während die Maus darin steht, und ihre
> Buttons sind unerreichbar. Beide Reihenfolgen sind im Testharness abgedeckt.

## Warum der erste Versuch scheiterte (fbb5565b, 2026-07-10)

Derselbe Ansatz wurde schon einmal gebaut und mit dem Urteil *„render wrong and
look bad“* zurückgerollt (`1d95facd`). Die Ursachen waren **nicht** die Grafiken:

1. **Falscher Anker durch quadratische Quelle.** `icons/pin.webp` war 80×80 px
   quadratisch — der Tropfen lag mit Leerraum darin. Der Code erzwang
   `iconSize: [30, 37]`, wodurch das Bild **verzerrt** wurde und der Anker
   `[15, 37]` auf Leerraum statt auf die Tropfenspitze zeigte.
2. **Zu geringe Auflösung.** 80 px Quelle für einen 28–37-px-Marker ist auf
   HiDPI-Displays sichtbar matschig.
3. **Icons an jeder Kreuzung** (erst nachträglich per `41e5d479` eingegrenzt).

Gegenmaßnahmen hier: die WebPs stammen aus 915–1167-px-Quellen, sind auf 128 px
Kantenlänge normiert und **eng beschnitten** — der Tropfen ist 75×128 mit echtem
Seitenverhältnis, sein Anker sitzt auf der tatsächlichen Spitze; die Scheiben sind
quadratisch zentriert (Anker = Mitte). Der Bug-#10-Scope gilt von Anfang an.

> **Auflösungsgrenze:** 128 px deckt alle drei Größenstufen bis
> `devicePixelRatio` 2 scharf ab (44 px × 2 = 88). Bei DPR 3 und Stufe `large`
> wird leicht hochskaliert. Falls das auffällt: Quellen neu auf 192 px rendern.

## Ersetzte Mechanik

- Die permanenten `L.popup`s aus `addTooltip(...)` entfallen für Wegpunkte.
- Die dekorativen weißen `circleMarker` (`ROUTE_NODE_STYLE`) entfallen — die
  Wegpunkt-Marker treten an ihre Stelle.
- Der Temp-Marker-Mechanismus (`routeWaypointTempMarkerEntries`) blendete den
  darunterliegenden Ortsmarker ein, solange die Infobox offen war. Mit einem
  sichtbaren Wegpunkt-Marker darüber ergäbe das **zwei Symbole übereinander** —
  genau die „unruhige Optik“ von damals. Er ist deshalb abgeschaltet.

## Nicht betroffen

Das **Distanz-Messwerkzeug** (gepunktete weiße Linie + Drag-Handles,
`MEASUREMENT_LINE_STYLE` / `measurementHandlesPane`) ist ein eigenständiges System
ohne Bezug zum Routing und bleibt unberührt.
