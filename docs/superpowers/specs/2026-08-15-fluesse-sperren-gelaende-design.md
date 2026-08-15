# Flüsse sperren das Gelände — Entwurf

**Stand:** 15.08.2026 · **Owner:** *„bei der gelegenheit musst du verhindern dass er querfeldein
flüsse überquert"* (`?s=w38RkXYP`) · **Entscheid:** unpassierbar, Absage statt Furt.

## 1. Der Befund

```php
const AVESMAPS_ROUTE_WATER_REGION_TYPES = ['meer', 'see'];      // water-areas.php:55
```

Für den Querfeldein-A\* ist **nur Meer und See** Wasser. Ein Fluss ist bei uns keine Fläche,
sondern ein **`Flussweg`-Weg** — eine Linie in `map_features`, Verkehrsart `river`.
`avesmapsOffroadRasteriseBlocked` sperrt Polygone; eine Linie sieht es nie.

Gemessen live am 15.08.2026: `?s=w38RkXYP` läuft **61,8 Meilen in EINER Querfeldein-Etappe**, quer
über die Rakula, ohne einen Meter Weg. Es ist kein Sonderfall — der Reisende durchwatet jeden Fluss
der Karte, den Großen Fluss eingeschlossen, und nichts im Code spricht dagegen.

## 2. Das Gesetz

Ein Fluss ist im Gelände eine **Wand**, wie Meer und See.

- Gequert wird nur, **wo ein gezeichneter Weg quert** — das ist die Brücke. Sie funktioniert von
  selbst: Wege sind Graph-Kanten und sehen das Gitter nie.
- Ein Kartenpunkt, den ein Fluss von allem abschneidet, bekommt **„nicht erreichbar"** statt einer
  Route. 🔴 Owner-Entscheid: das ist ehrlich und zeigt fehlende Brücken in den Daten. ⚠️ Es ist eine
  Absage, wo heute eine Reise stand — der Absagegrund muss das sagen und darf nicht im allgemeinen
  `no_offroad_route` verschwinden.

## 3. Wo es steht

Die Flussgeometrien sind **bereits geladen**: `$routeNetworkData['paths']`, erkennbar an
`avesmapsGetRouteTransportType($path['subtype']) === 'river'`. ⭐ Keine zweite Datenbankabfrage je
Route — auf Shared Hosting ist das der Unterschied zwischen Fix und Last.

Drei Stellen rastern heute die Sperrebene, alle über **einen** Bauer:

| Stelle | wer |
|---|---|
| `offroad-leg.php:245` | die Kartenpunkt-Anbindung |
| `offroad-leg.php:436` | die direkte Kante zwischen zwei Kartenpunkten |
| `synthetic-refine.php:129` | die Sehnen-Verfeinerung |

Alle drei rufen `avesmapsOffroadRasteriseBlocked($box, $water)`. Der bekommt ein zweites Argument
`$riverLines` und läuft die Linien Zelle für Zelle ab (Bresenham über das Gitter). **Eine Stelle,
drei Nutzer** — dieselbe Bauform wie beim Längenaufschlag.

💣 **Die gerade Linie ist der zweite Ausgang, und sie geht am Raster VORBEI.**
`avesmapsOffroadStraightPathIfDry` fragt `avesmapsRouteChordCrossesWater` gegen die **Polygone**.
Wer nur die Sperrebene repariert, verhindert das Durchwaten unter „Schnellste" und lässt es unter
**„Kürzeste"** unverändert stehen. Sie braucht deshalb einen eigenen Schnitt-Test gegen die
Flusslinien.

## 4. Was ausdrücklich NICHT mitgeht

🔴 `avesmapsRouteChordCrossesWater` wird **nicht** um Flüsse erweitert. Sie trägt außerdem die
Reparaturkanten zwischen losen Graph-Komponenten (`avesmapsFindNearestDryClientComponentConnection`)
und die Umweg-Sehnen. Würden dort plötzlich Flüsse sperren, fände eine abgetrennte Komponente unter
Umständen **gar keine** trockene Verbindung mehr — und läge danach als Insel ohne jede Route da.
Das ist eine Änderung am Fundament des Graphen, kein Fix für eine gemeldete Route.

⚠️ Damit bleibt eine bewusste Ungleichheit: eine Reparaturkante darf einen Fluss queren, eine
Querfeldein-Etappe nicht. Sie steht hier, damit sie später jemand findet, statt sie zu entdecken.

⚠️ **`Seeweg` sperrt nicht.** Seewege laufen über das Meer, das ohnehin gesperrt ist; sie zusätzlich
als Wand zu rastern würde Küstenrouten zerschneiden.

## 5. Fallen

- 💣 **Der Endpunkt muss freigeräumt bleiben.** `avesmapsOffroadFreeAround` räumt heute um die
  Endpunkte herum frei, damit ein Punkt am Ufer überhaupt startet. Ein Kartenpunkt, den jemand
  **auf** einen Fluss klickt, muss weiter funktionieren — und zwar über denselben Weg, nicht über
  eine zweite Sonderregel.
- 💣 **Die Zellbreite IST die Flussbreite.** Eine Linie sperrt die Zellen, durch die sie läuft:
  0,5 Karteneinheiten = 1,5 Meilen. Das ist großzügig für einen Bach und knapp für den Großen Fluss
  — aber es ist EINE Regel ohne Datenfeld, und ein Größenfeld je Fluss wäre ein eigenes Vorhaben
  (Owner hat es heute ausdrücklich verworfen).
- 💣 **Zwei Flüsse, die sich kreuzen, dürfen keine Lücke lassen.** Der Zellenlauf muss jede berührte
  Zelle nehmen, nicht jede zweite — eine einzige durchlässige Zelle an einer Flussmündung macht die
  ganze Wand wirkungslos, und es fällt an genau einer Route auf.
- ⚠️ **Laufzeit:** rund 5.900 Wege, davon die Flusswege, gegen eine Kiste, die meist klein ist. Die
  Rasterung läuft nur über Linien, deren Hüllbox die Kiste schneidet — das ist der Vorfilter, den
  `avesmapsOffroadForEachTouchedCell` für Flächen schon hat. Wird gemessen, nicht angenommen.

## 6. Abnahme — ABLAUF

1. `?s=w38RkXYP` — die Reise darf den Fluss nicht mehr durchwaten: entweder über eine Brücke, oder
   Absage mit dem eigenen Grund.
2. `?s=DnbLPQq2` und `?s=iXYid6eX` — müssen weiterhin über die Straße laufen (der Längenaufschlag
   bleibt unberührt).
3. Dieselbe Reise unter **„Kürzeste"** — die gerade Linie darf ebenfalls nicht durch den Fluss.
4. Ein Kartenpunkt **auf** einem Fluss angeklickt — muss weiter eine Route bekommen.
5. Laufzeit gegen den heutigen Stand.
