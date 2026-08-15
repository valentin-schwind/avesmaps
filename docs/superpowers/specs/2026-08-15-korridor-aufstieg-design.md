# Der Korridor-Aufstieg — auf einen Weg unterwegs aufsteigen

**Stand:** 15.08.2026 · **Owner-Entscheid:** Korridor-**Band**, nicht nur echte Kreuzungen.

## 1. Der Befund

Owner, 15.08.2026, zu `?s=DnbLPQq2`: *„was ich in meinem beispiel nicht verstehe ist, dass er
sogar eine straße kreuzt und trotzdem querfeldein bleibt"* — und auf dem Bild davor lief die
Querfeldein-Linie über rund 100 Meilen **parallel** zur Straße Nadoret → Wallerheim → Lacuna →
Ferdok, ohne sie je zu betreten.

Es ist kein Rechenfehler. Es ist eine Lücke, und sie ist am Code belegt.

## 2. Was heute passiert

`avesmapsAttachOffroadPointToGraph` (`offroad-leg.php`) sammelt Ausstiegskandidaten
**ausschließlich um den Punkt herum**:

```php
$candidateSets  = avesmapsCollectClientLandPathExitCandidates($graph, $x, $y, AVESMAPS_ROUTE_CLIENT_ANCHOR_LIMIT);
$nodeCandidates = avesmapsFindNearestOffroadExitNodes($graph, $locations, $x, $y);
```

und filtert sie danach über die Reichweitenschranke:

```php
$reference = $nodeCandidates !== [] ? $nodeCandidates[0]['distance'] : $nearestVertexDistance;
$reach     = max($reference * AVESMAPS_ROUTE_OFFROAD_EXIT_DISTANCE_FACTOR, $reference);   // × 2,5
```

Eine Straße, die 15 Einheiten mitten in der Reise entlangläuft oder gequert wird, liegt weit
außerhalb beider Bedingungen. **Sie ist für diese Reise nicht vorhanden.** Der Reisende läuft
nicht an ihr vorbei — er kennt sie nicht.

⚠️ Der Längenaufschlag vom selben Tag heilt das *Symptom* (die Reise nimmt jetzt gleich am Anfang
die Straße), nicht die Lücke: sobald in der Mitte einer Reise ein Weg günstiger wäre als das
Gelände daneben, wird er weiterhin nicht angeboten.

## 3. Das Korridor-Band

Zusätzlich zu den Kandidaten um die Endpunkte werden Kandidaten **entlang der Luftlinie zwischen
den beiden Endpunkten der Reise** gesammelt:

- Die Strecke A→B wird alle `AVESMAPS_ROUTE_CORRIDOR_SAMPLE_MAPUNITS` abgetastet.
- Um jede Abtaststelle werden Wege innerhalb von `AVESMAPS_ROUTE_CORRIDOR_BAND_MAPUNITS`
  eingesammelt, **entdoppelt über die Kanten-`id`** (derselbe Weg wird von vielen Abtaststellen
  gesehen).
- Je gefundenem Weg kommen die Stützpunkte im Band als Schnitte dazu — dieselbe Form wie heute
  (`['segment_index', 't', 'x', 'y']`), also derselbe Teiler und derselbe Kantenbauer.
- Gedeckelt auf `AVESMAPS_ROUTE_CORRIDOR_PATH_LIMIT` Wege, nach Abstand zur Luftlinie sortiert.

🔴 **Ein Band, keine Kreuzungsliste.** Nur echte Schnittpunkte zu nehmen wäre billiger und
präziser — und hätte den gemeldeten Fall **nicht** gelöst: die Straße nach Ferdok wurde nie
gekreuzt. Owner-Entscheid vom 15.08.2026, nach genau dieser Gegenüberstellung.

🔴 **Die Reichweitenschranke gilt für Korridor-Kandidaten NICHT.** Sie misst gegen den nächsten
Ortsknoten *am Punkt* und ist der Grund, warum es diese Lücke gibt. Korridor-Kandidaten haben ihre
eigene Grenze: das Band. ⚠️ Die Schranke selbst bleibt für die Endpunkt-Kandidaten **unverändert** —
sie hat am 14.08.2026 drei Fassungen gekostet, und ihre Lehre („eine relative Schranke braucht
einen Maßstab, der nicht mitwandert") gilt weiter.

⭐ **Der Längenaufschlag macht das bezahlbar und selbstbegrenzend.** Ein Aufstieg 15 Einheiten von
A entfernt kostet eine Querfeldein-Etappe von 15 Einheiten *samt* Aufschlag; der Dijkstra bevorzugt
damit von selbst den früheren Aufstieg. Ohne ihn wäre das Band ein Angebot ohne Gegengewicht.

## 4. 🔴 Die tragende Umstellung: erst sammeln, dann EINMAL teilen, dann suchen

`response.php` bindet die Endpunkte heute **nacheinander** an:

```php
foreach (['from', 'to'] as $side) { … avesmapsAttachOffroadPointToGraph($clientGraph, …); }
```

Jeder Durchgang teilt Wege. Heute ist das tragbar, weil die beiden Punkte verschiedene Wege in
ihrer Nähe haben. **Mit dem Korridor-Band wollen beide Endpunkte dieselben Wege** — es ist
derselbe Korridor. Der zweite Durchgang liefe dann über einen Graphen, in dem diese Wege bereits
in Teilstücke zerschnitten sind: sein Sammler sähe nicht mehr die Kante, sondern ihre Hälften,
seine Stützpunktliste wäre eine andere, und `avesmapsSplitClientPathAtPoints` bekäme Schnitte für
eine Kante, die es so nicht mehr gibt.

💣 Genau diese Klasse Fehler hat am 14./15.08.2026 zweimal zugeschlagen — die doppelt geteilte
Straße mit zwei unverbundenen Fußpunkten, und die Kennungs-Kollision `wp-mslice-<Zielknoten>`, die
ein ganzes Wegstück lautlos aus dem Angebot warf. Beide Male war die Ursache dieselbe: **der zweite
Sammler lief über den bereits geteilten Graphen.**

Deshalb wird der Aufrufer in zwei Phasen zerlegt:

1. **Sammeln** — für beide Endpunkte, auf dem **ungeteilten** Graphen: Endpunkt-Kandidaten wie
   heute, plus die Korridor-Kandidaten (einmal berechnet, von beiden Seiten benutzt).
2. **Teilen** — je Weg **ein** Aufruf von `avesmapsSplitClientPathAtPoints` mit der **Vereinigung**
   aller Schnitte beider Endpunkte. Der Teiler kann das bereits (k Schnitte, ein Durchgang); er
   wurde am 15.08. genau dafür gebaut.
3. **Suchen** — danach je Endpunkt ein `avesmapsOffroadFindPathsFromPoint` über die entstandenen
   Knoten, wie heute.

⚠️ `avesmapsSplitClientPathAtAnchor` (der Einzelteiler) bleibt unangetastet: er trägt den
Wegpunkt-Anker und seine vier Tests.

## 5. Kosten und der Riegel

Der Mehrziel-Lauf vom Endpunkt muss jetzt Kandidaten erreichen, die bis zur halben Reiselänge
entfernt liegen. Die Suchkiste spannt damit über den ganzen Korridor — dieselbe Größenordnung wie
die Kiste der direkten Kante, die bei zwei Kartenpunkten ohnehin gebaut wird. Der Dijkstra läuft
aber deutlich weiter, bis das letzte Ziel erreicht ist.

Drei Riegel:

- 🔴 **Ein Tor:** Korridor-Kandidaten entstehen nur, wenn die Luftlinie zwischen den Endpunkten
  `AVESMAPS_ROUTE_CORRIDOR_MIN_AIR_MAPUNITS` überschreitet. Kurze Reisen brauchen sie nicht und
  sollen nichts dafür zahlen.
- **Ein Deckel** auf die Zahl der Wege (`…_PATH_LIMIT`) und, wie heute, auf die Stützpunkte je Weg
  (`AVESMAPS_ROUTE_OFFROAD_EXIT_VERTEX_LIMIT` = 24).
- 💣 **Jede Kappung meldet sich** in der Antwort (`corridor_paths_capped`, `corridor_vertices_capped`).
  Eine stille Kappung liest sich wie „mehr gab es nicht".

⚠️ **Die Laufzeit wird GEMESSEN, bevor irgendetwas live geht** — an der gemeldeten Route und an
einer kurzen Reise, gegen den heutigen Stand. STRATO ist Shared Hosting; die Zahl entscheidet, ob
Tor und Deckel richtig stehen. Der Bauplan trägt diesen Schritt als eigene Aufgabe.

## 6. Fallen

- 💣 **Ein Korridor-Kandidat auf einem Weg, der zum Ziel gar nicht führt, ist kein Fehler.** Er ist
  ein Angebot; der Dijkstra verwirft es. Wer hier vorfiltert („nur Wege in Zielrichtung"), baut
  eine zweite Heuristik neben den Optimierer — genau die Bauform, die am 15.08. den Ausstieg
  verhindert hat.
- 💣 **Die Verkehrsmittel-Sperre gilt auch hier.** `avesmapsIsClientTransportAllowedForPath` muss
  jeden Korridor-Kandidaten passieren, sonst steigt die Kutsche mitten im Gelände auf einen
  Saumpfad. Vier Erzeuger, vier Prüfungen — und im Kommentar steht **keine Zahl** (die Zahl war
  am 14.08. die Falle).
- 💣 **Versteckte Orte bleiben draußen.** Der Sammler bekommt weiterhin
  `$clientGraph['candidate_locations']`, nie die rohe Ortsliste.
- ⚠️ **Nur Landwege.** Fluss- und Seewege sind keine Aufstiegsziele für einen Fußgänger; die
  bestehende Landwege-Prüfung des Ankersammlers gilt unverändert.
- ⚠️ **Der Korridor ist die Luftlinie, nicht die gefundene Route.** Er wird gebraucht, *bevor* eine
  Route existiert. Das ist derselbe Grund, aus dem der Längenaufschlag die Luftlinie misst.

## 7. Abnahme — ABLAUF, nicht Maßtabelle

1. `?s=DnbLPQq2` und `?s=iXYid6eX`: die Reise muss weiterhin über die Straße laufen, und der
   Aufstieg soll **früher** liegen als heute (heute 28,4 bzw. rund 30 Meilen Gelände am Anfang).
2. Eine Reise, deren Endpunkte beide fern jedes Wegs liegen, aber deren Mitte an einer Straße
   vorbeiführt — sie muss die Straße jetzt benutzen. **Dieser Fall ist der eigentliche Abnahmefall
   und wird am Livebestand gesucht, nicht erfunden.**
3. Eine kurze Reise unter dem Tor: Etappen und Kosten müssen **unverändert** sein.
4. Laufzeit gegen den heutigen Stand, an allen dreien.
5. Der Blick im Browser: die gezeichnete Linie muss am Aufstiegspunkt sauber auf den Weg treffen,
   und die Etappenliste muss „Anschlusspunkt" / „Abgangspunkt" richtig benennen.

## 8. Offen

- 🔧 Die vier Konstanten (Tor, Abtastschritt, Bandbreite, Wegdeckel) bekommen im Entwurf
  Startwerte, die der Owner nach der Messung entscheidet — wie bei der Reichweitenschranke.
- 🔧 Ob der Korridor auch den **Wegpunkt-Anker** und die **Umweg-Sehnen** bedienen soll (die zwei
  übrigen Erzeuger, deren Kandidatenauswahl seit dem 15.08. als eng vermerkt ist), bleibt eine
  eigene Frage. Dieser Entwurf fasst nur die Kartenpunkt-Anbindung an.
