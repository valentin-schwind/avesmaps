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

## 2. Was Drift ist

**Drift = die Luftlinie von der Normalstellung zur gewählten Ausweichstelle — waagerecht wie
senkrecht.** Die Normalstellung ist „rechts neben dem Punkt"; sie hat Drift 0 und ist bei jedem
Deckel erlaubt.

```
drift = hypot(dx - baseOffset.x, dy - baseOffset.y)
```

🪤 **Das Maß war einen Tag lang falsch, und die Korrektur ist der Kern dieses Entwurfs.** Die erste
Fassung zählte nur den **senkrechten** Anteil, mit der Begründung, ein Seitenwechsel „klebe ja
weiter am Punkt, nur auf der anderen Seite". Am Bildschirm stimmt das nicht. Der Owner hat es an
**„Nordhag (Weiden)"** gezeigt:

| Zoom | Stelle | Was man sieht |
|---|---|---|
| z6 | `right` | Name klebt 8 px am Punkt — **„normal"** |
| z4 | `left` | Name auf der anderen Seite; sein **Anfang** liegt 170 px vom Punkt — **„zu weit weg"** |

Der Seitenwechsel rückt den Namen um seine **eigene Breite** weg. Ein Deckel, der ihn nicht sieht,
kann das sichtbarste Wegrücken überhaupt nicht verhindern — und genau das war der Grund, warum der
Regler beim ersten Anlauf für den Owner wieder „nichts tat".

Bei Breite 99, Höhe 22, Spalt 14 und Versatz 8 ergibt das:

| Stellen | Drift |
|---|---|
| rechts (Normalstellung) | 0 |
| rechts hoch/runter | 8 (der Versatz) |
| rechts oben/unten | 30 (Höhe + Versatz) |
| mittig unter / über dem Punkt | 66 / 76 |
| **links (Seitenwechsel)** | **127** — live 78 bis 203, Median 123 |
| links oben/unten | 130,5 |

🔴 **Die Ordnung ist das eigentliche Versprechen:** senkrechtes Ausweichen ist billig, der
Seitenwechsel teuer. Nur so kann ein mittlerer Deckel das eine erlauben und das andere verbieten.
Bei **60** bleiben genau die fünf senkrechten Stellen übrig.

🔧 **Offen und bewusst nicht gebaut:** die 79–86 % der Namen, die in der Normalstellung stehen und
nie ausweichen, fasst dieser Regler nicht an — kein Kollisions-Regler kann das. Wer ihre Lage
einstellen will (höher, tiefer, über dem Punkt statt daneben), braucht einen eigenen Regler.

## 3. Wie der Deckel wirkt

Eine Stelle, deren Drift über dem Deckel liegt, wird **gar nicht erst probiert**. Bleibt darunter
nichts frei, fällt das Label auf den vorhandenen Ausblend-Weg (`is-colliding`) — „begrenzen, bis sie
verschwinden".

💣 Gefiltert wird **im Löser**, nicht in `getLocationNameLabelOffsets`: `candidates[0]` trägt den
Rückfall für das ausgeblendete Label, eine gekürzte Liste hätte dort ein Loch. `candidates[0]` ist
die Grundstellung mit Drift 0 und deshalb bei jedem Deckel erlaubt.

⚠️ **Nur Siedlungsnamen.** Freie Kartenlabels (Kontinente, Meere, Landschaften) haben ihre eigene
Kandidatenliste ohne `drift` und dürfen laut Regel nie ausgeblendet werden.

Gemessen an den Live-Daten, „weit weg" = Drift über 60 px:

| Zoom | Deckel 300 (Vorgabe) | Deckel 60 | Deckel 0 |
|---|---|---|---|
| z4 | 12 sichtbar, 1 weit weg | 11 sichtbar, **0 weit weg** | 11 sichtbar, 2 verschwunden |
| z5 | 61 sichtbar, 0 weit weg | 61 sichtbar, 0 weit weg | 52 sichtbar, 11 verschwunden |
| z6 | 28 sichtbar, 1 weit weg | 27 sichtbar, **0 weit weg** | 23 sichtbar, 6 verschwunden |

Ein Deckel von 60 kostet also **einen** Namen je Ausschnitt und beseitigt jedes Wegrücken. Der
Abnahmefall: „Nordhag (Weiden)" bei z4 steht mit Deckel 300 mittig über dem Punkt, sein Anfang
84 px daneben; ab Deckel 60 verschwindet er, statt wegzurücken.

## 4. Schranke und Vorgabe

`drift` bekommt eine **eigene** Schranke `0…300`; Spalt/Repel/Versatz bleiben bei `0…20`
(`AVESMAPS_LOCATION_LABEL_SPACING_LIMITS_BY_KEY`). Ohne sie wäre jeder Deckel über 20 lautlos auf
die Vorgabe zurückgefallen.

💣 **Die Spanne richtet sich nach dem Seitenwechsel, und der hängt an der Namenslänge** — nicht an
einer festen Geometrie. Live gemessen 78 bis 203 px; der größte über den ganzen Bestand erreichbare
Wert (längster Name je Ortsklasse in **deren** größter Schrift, 2882 Namen) ist **287 px**
(„Firun-Tempel unter dem Hängenden Gletscher"). Vorgabe **300** liegt darüber und schneidet nichts
weg; die Arbeit des Reglers passiert zwischen 0 und 203, also auf gut zwei Dritteln seines Weges.

⚠️ Drei Griffe waren nötig, und die ersten beiden waren aus demselben Grund falsch: 80 lag **unter**
dem Maximum (die Vorgabe hätte geschnitten), 120 lag darüber, hätte aber den halben Reglerweg
wirkungslos gemacht — und ein Regler ohne spürbare Wirkung ist genau der Befund aus §1. Eine Spanne
muss **beides**: das Maximum decken und nicht viel darüber hinausreichen.

⚠️ Der Server führt bewusst **keine Schlüsselliste** und prüft deshalb mit **einer** Schranke, der
weitesten (0…300). Er prüft die Form, der Browser die Bedeutung.

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

- 🔧 Eine Schieflage im Bestand, beim Messen gefunden: „mittig darüber" hält 30 px senkrechten
  Abstand, „mittig darunter" nur 8 — `verticalCenterOffset` steckt in der oberen Formel einmal zu
  viel. Eigener Zug, eigener Blick.
- 🔧 Ein Regler für die Namen, die NIE ausweichen (79–86 %) — siehe §2. Das ist der Regler, den der
  Owner am 22.08.2026 gewählt hat („Alle Namen"); er ist noch nicht gebaut.
- 🔧 Der gespeicherte `versatz: 0` des Owners bleibt unangetastet; er kollabiert vier der zwölf
  Stellen auf ihre Nachbarn. Ob das gewollt ist, ist eine eigene Frage.
