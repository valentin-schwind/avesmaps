# Max. Drift — ein Deckel für das Abheben der Ortsnamen

Stand: 22.08.2026, live mit dem Commit dieses Tages.
Vorgeschichte: `2026-08-16-zoombaender-design.md` (Aufgabe 8b, die drei Abstände).

## 1. Anlass

Owner: „die veränderung des versatzes in den zoombändern hat keinerlei auswirkung auf die
verschiebung der angezeigten siedlungslabels."

Nachgemessen, live: die Kette war **intakt** — Wert gespeichert (`versatz: 0`), Endpunkt ohne
Cache, ausgeliefertes JS = Repo, `avesmapsLocationLabelSpacing("versatz") === 0` zur Laufzeit, und
ein erzwungener Wechsel 0 → 8 bewegte 21 von 47 Labels. Kein Fehler.

Der Befund war ein anderer: **Reichweite**. Über z3–z7 um Nordhag lagen von 125 Labels nur **14**
(11 %) auf einer Stelle, die der Versatz überhaupt anfasst; 107 standen in der ungestörten
Grundstellung `right`. Und bei den 14 ist der Versatz nur ein Zuschlag auf die Zeilenhöhe. Ein
Regler, dessen Wirkung 11 % der Fälle um ein Viertel verschiebt, liest sich als „tut nichts".

Owner darauf: „ich will den maximalen versatz, den ein label zur vermeidung einer kollision geht
einstellen können … diese versuchen eine kollision zu vermeiden und driften und diesen drift will
ich begrenzen bis sie verschwinden."

## 2. Was Drift ist — und was er NICHT ist

**Drift = der senkrechte Spalt zwischen der Markermitte und dem Namenskasten.**
Null, solange der Kasten den Punkt überdeckt.

```
drift = max(0, |dy| - labelHeight / 2)
```

🪤 **Der erste Entwurf maß falsch** und ist hier als Warnung festgehalten: er nahm den Abstand zur
**Grundstellung** und kam für den Seitenwechsel („links") auf 133 px Median, bis 203 px. Owner:
„ich versteh nicht warum markierungen mitreingenommen werden, es geht nur um labels, die an den
markierungen kleben". Genau: ein Name, der auf die andere Seite seines Punktes springt, **klebt
weiter** — er ist nicht abgedriftet. Ein Deckel auf das Grundstellungs-Maß hätte zuerst
weggeschnitten, was noch klebt.

💣 **Waagerecht zählt nicht.** Ein viermal so breiter Name driftet kein Stück.

Belegt: bei `dy = 0` liegt der Kasten senkrecht **mittig** auf dem Marker — live gemessen an einer
Kleinstadt, Marker bei y = 359, Kasten 345…373. Das Modell wurde an drei unabhängigen Stellen
gegengeprüft (rechts-oben 19, oben-mittig 30, unten-mittig 8 — die Messung liefert jeweils denselben
Wert minus dem durchsichtigen Halo-Rand des Label-Bildes).

Damit fallen die zwölf Ausweichstellen bei Höhe 22 und Versatz 8 in vier Gruppen:

| Stellen | Drift |
|---|---|
| rechts, rechts-hoch/-runter, links, links-hoch/-runter | 0 — klebt |
| unten mittig | 8 |
| rechts-oben/-unten, links-oben/-unten | 19 (Höhe/2 + Versatz) |
| oben mittig | 30 (Höhe + Versatz) |

🪤 **Und die Schieflage, die dabei auffällt:** „oben mittig" hält 30 px Abstand, „unten mittig" nur
8 — `verticalCenterOffset` steckt in der oberen Formel einmal zu viel. Das ist **Bestand, nicht
Entwurf**, und es ist in `zoombaender-drift.test.js` festgenagelt. Ein enger Deckel macht es
sichtbar: unterhalb von 30 weichen Namen nur noch nach unten aus. Bewusst **nicht** in diesem Zug
repariert — eine sichtbare Änderung geht einzeln live (AGENTS.md §9).

## 3. Wie der Deckel wirkt

Eine Stelle, deren Drift über dem Deckel liegt, wird **gar nicht erst probiert**. Bleibt darunter
nichts frei, fällt das Label auf den vorhandenen Ausblend-Weg (`is-colliding`) — „begrenzen, bis sie
verschwinden".

💣 Gefiltert wird **im Löser**, nicht in `getLocationNameLabelOffsets`: `candidates[0]` trägt den
Rückfall für das ausgeblendete Label, eine gekürzte Liste hätte dort ein Loch. `candidates[0]` ist
die Grundstellung mit Drift 0 und deshalb bei jedem Deckel erlaubt.

⚠️ **Nur Siedlungsnamen.** Freie Kartenlabels (Kontinente, Meere, Landschaften) haben ihre eigene
Kandidatenliste ohne `drift` und dürfen laut Regel nie ausgeblendet werden.

Gemessen an den Live-Daten (Versatz auf der Vorgabe 8):

| Zoom | Deckel ≤ 12 | Deckel ≥ 20 |
|---|---|---|
| z5 | 59 sichtbar, 4 weg, größter Drift 0 | 62 sichtbar, 1 weg, größter Drift 19 |
| z6 | 28 sichtbar, 1 weg, größter Drift 0 | 29 sichtbar, 0 weg, größter Drift 18 |

## 4. Schranke und Vorgabe

`drift` bekommt eine **eigene** Schranke `0…90`; Spalt/Repel/Versatz bleiben bei `0…20`
(`AVESMAPS_LOCATION_LABEL_SPACING_LIMITS_BY_KEY`). Ohne sie wäre jeder Deckel über 20 lautlos auf
die Vorgabe zurückgefallen, und der Regler hätte an seinem oberen Ende nichts getan.

💣 **Die 90 ist gerechnet, und zwei Griffe davor waren falsch.** Der größte erreichbare Drift ist
`labelHeight + versatz`. `labelHeight` ist die Höhe des **gerenderten** Label-Bildes samt Halo, nicht
die Schriftgröße: live gemessen an 80 Labels über z3/z5/z7 höchstens **2,182 px je pt**.

- bei den heutigen Schriftgrößen (max. 19 pt): rund **50 px** — dort arbeitet der Regler
- bei der obersten erlaubten Schriftgröße (30 pt): 65,5 + 20 = **85,5 px**

Erster Griff 80 lag **unter** dem Maximum und hätte beim Ausliefern geschnitten. Zweiter Griff 120
lag darüber, hätte aber **fünf Sechstel des Reglerwegs wirkungslos** gemacht — genau der Befund aus
§1, ein zweites Mal. 90 deckt das Maximum und lässt gut die Hälfte des Wegs auf dem Bereich liegen,
in dem sich etwas bewegt.

**Vorgabe 90** — über jedem erreichbaren Drift, schneidet beim Ausliefern also nichts weg.

⚠️ Der Server führt bewusst **keine Schlüsselliste** und prüft deshalb mit **einer** Schranke, der
weitesten (0…90). Er prüft die Form, der Browser die Bedeutung und klemmt jeden Schlüssel gegen
seine eigene, engere Schranke — dieselbe Arbeitsteilung wie bei marker/label, wo der Server die
Klassennamen ebenfalls nicht kennt.

## 5. Bauteile

- `js/map-features/location-zoom-bands.js` — Vorgabe, Schranke je Schlüssel
- `js/map-features/map-features-label-collisions.js` — Driftwert je Stelle, Schnitt im Löser
- `html/wiki-sync-settlement-editor.html` — der vierte Regler „Max. Drift"
- `api/_internal/app/zoom-bands.php` — geweitete Formschranke

Tests: `js/map-features/__tests__/zoombaender-drift.test.js` (Formel, Schranken **und** Verdrahtung
in Löser und Fenster — ein grüner Rechentest beweist nichts, solange niemand den Wert liest),
angepasst `zoombaender-abstaende.test.js`, `zoombaender-abstaende-dialog.test.js`,
`api/_internal/app/__tests__/zoom-bands-test.php`.

## 6. Offen

- 🔧 Die Oben/Unten-Schieflage aus §2 — eigener Zug, eigener Blick.
- 🔧 Der gespeicherte `versatz: 0` des Owners bleibt unangetastet; er kollabiert vier der zwölf
  Stellen auf ihre Nachbarn. Ob das gewollt ist, ist eine eigene Frage.
