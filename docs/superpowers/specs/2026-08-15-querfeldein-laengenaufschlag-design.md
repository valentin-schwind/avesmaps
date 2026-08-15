# Der Längenaufschlag für Querfeldein — Entwurf

**Stand:** 15.08.2026 · **Owner-Entscheid:** linear, ohne Freibetrag; die Steigung steht im
Fenster „Tempowerte"; die GA soll nicht komplett verletzt werden.

## 1. Der Befund, der das auslöst

Gemeldet am 15.08.2026: `https://avesmaps.de/?s=DnbLPQq2`, zwei Kartenpunkte, **eine** Etappe
über 103,28 Meilen querfeldein, 53,4 Stunden — „gestern ging er noch auf der straße dahin".

Gemessen an der Live-API (`POST /api/route/`, `optimize: fastest`, `groupFoot`):

| Möglichkeit | Kosten |
|---|---|
| querfeldein direkt (34,427 Einheiten ÷ Tempo 2,30) | **14,968** |
| über die Straße (4,79 hin + 14,69 Moorbrück→Gôrmel + 1,53 weg) | **21,00** |

Die Straße *ist* im Angebot — beide Punkte bekommen Ausstiege (30 bzw. 22, billigster 3,44 bzw.
1,40). Sie verliert, weil das Straßennetz dort **43,1 Einheiten für 25 Einheiten Luftlinie**
braucht (72 % Umweg), während die Querfeldein-Linie nur 11 % Umweg macht.

**Warum es kippte:** am 14.08.2026 um 18:38 (`2ae79c2d`) ging das Querfeldein-Tempo von 0,96 auf
**2,30** (GA-Quellenwert, 0,75 der Straße). Bei 0,96 kostete dieselbe Linie 35,9 — die Straße
gewann. Derselbe Commit hinterließ die Frage ausdrücklich offen: *„Ob die Schwelle danach noch
die richtige ist, gehört dem Owner — nach dem Bau an echten Routen nachmessen."* Dies ist diese
Messung.

**Was dazukommt:** in dem Korridor liegt keine Landschaft. Der ganze Zug rechnet mit
Geländefaktor 1,0 und 0 Höhenrastern — 103 Meilen freie, ebene, trockene Wiese.

## 2. Das Gesetz

Eine Querfeldein-Etappe wird mit ihrer eigenen Länge langsamer:

```
zeit_final = zeit_gemessen × min(deckel, 1 + steigung × luftlinie_der_etappe_in_meilen)
```

- **linear**, ohne Freibetrag (Owner-Entscheid). Eine kurze Abkürzung zahlt fast nichts, eine
  Tagesreise ohne Weg zahlt spürbar, ein Gewaltmarsch zahlt viel.
- multipliziert die **gemessene** Zeit, nicht die nackte Strecke ÷ Tempo. Auf langsamem Boden
  wirkt der Aufschlag damit zusätzlich — 100 Meilen Sumpf sind schlimmer als 100 Meilen Wiese.
- 🔴 **Der Bezug ist die EINZELNE Etappe, nicht die Summe der Reise.** Zwei Querfeldein-Etappen
  mit einer Ortschaft dazwischen zahlen weniger als eine durchgehende gleicher Länge — und das
  ist die Absicht, nicht ein Schlupfloch: bestraft wird das ununterbrochene weglose Marschieren
  ohne Nachschub und ohne Orientierungspunkt. Wer unterwegs einen Ort berührt, rastet dort.

### 🔴 Warum die LUFTLINIE und nicht die gelaufene Strecke

Der erste Bau maß die gelaufene Strecke. Ein bestehender Test hat ihn widerlegt, und der Befund
ist tragend: **die Suche ordnet ohne den Aufschlag.** Hängt er an der gelaufenen Länge, bestraft
er nachträglich genau den Bogen, den der A\* zum Zeitsparen geschlagen hat. Gemessen an der
Fixture von `offroad-shortest-test.php` (ein langsamer Streifen quer im Weg): der Zeitmodus ging
außen herum und kam auf **14,01**, der Streckenmodus mitten hindurch auf **12,40** — eine
„schnellste" Etappe, die messbar langsamer ist als eine verworfene. Genau die Lüge, die der
Abschnitt darunter verhindern soll.

An der Luftlinie ist der Aufschlag für ein festes Endpunktpaar eine **Konstante**, und eine
Konstante verschiebt kein Minimum: die Suche bleibt exakt optimal, die gemeldete Zeit bleibt
ehrlich. ⭐ Nebenbei richtig: wer 20 Einheiten um einen See herum muss, zahlt nicht auch noch
einen Längenaufschlag für den See.

⚠️ Der Preis: eine Etappe, die sich zwischen nahen Endpunkten weit windet, zahlt nur für ihre
Luftlinie. Das ist in Kauf genommen — solche Etappen sind über ihre Streckenzeit ohnehin teuer,
und die Alternative wäre ein Optimierer, der nachweislich lügt.

### Warum der Aufschlag in die ZEIT geht und nicht ins Gewicht

Es gibt im Haus bereits ein reines Dijkstra-Gewicht: `AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR`
(×25 der Reparaturkanten), das aus jeder gemeldeten Zahl per `cost_factor` wieder herausgerechnet
werden muss. Ein zweites davon wäre hier **falsch**, nicht nur lästig: stünde der Aufschlag nur
im Gewicht, zeigte der Planer unter „Schnellste Route" eine Reise, deren *angezeigte* Stundenzahl
höher ist als die der verworfenen Alternative. Der Aufschlag ist eine Aussage über die Reise, also
gehört er in die Reisezeit.

⚠️ Folge, ausdrücklich gewollt: unter **„Kürzeste"** ändert der Aufschlag die Wahl **nicht** — dort
ist das Gewicht die Strecke, und 103 Meilen geradeaus *sind* die kürzeste Strecke. Die gemeldete
Zeit trägt den Aufschlag trotzdem. Beides ist richtig.

## 3. Wo er steht — EINE Stelle

`avesmapsOffroadFinishPath` (`api/_internal/routing/offroad-grid.php:685`) ist der gemeinsame
Abschluss **aller** gerasterten Querfeldein-Etappen: Zeilen 372 (die trockene Gerade), 486
(Einzelsuche), 654 (Mehrziel-Suche) und 831 (`avesmapsOffroadStraightPathIfDry`). Dort wird
`distance` und `time` gebildet, dort kommt der Aufschlag drauf.

💣 **Das ist die Antwort auf die Falle vom 14.08.2026** („Querfeldein-Kanten haben VIER Erzeuger,
und die Sperre muss in jedem einzeln stehen", AGENTS.md §11). Sie galt der *Verkehrsmittel-Sperre*,
die vor dem Suchlauf entscheidet. Der Aufschlag sitzt danach, im gemeinsamen Abschluss — und
deshalb genau einmal. Hier steht bewusst **keine Zahl** im Kommentar: die Zahl war damals die Falle.

### Die Ladekette

`terrain-factor.php` verlangt **nichts** (Blatt) und trägt bereits `AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT
= 3.0`. `offroad-grid.php` zieht es schon (Zeile 19). Also wohnen dort:

- `AVESMAPS_OFFROAD_RAMP_PER_MILE` / `AVESMAPS_OFFROAD_RAMP_MAX` — die Rückfallwerte,
- der geltende Zustand plus `avesmapsOffroadRampPrime()` / `avesmapsOffroadRampReset()`,
- `avesmapsOffroadRampFactor(float $distanceMapunits): float` — rein, und der einzige Ort, an
  dem Einheiten in Meilen umgerechnet werden.

🔴 **`offroad-grid.php` darf `travel-values.php` NICHT verlangen.** Die zieht `client-graph.php`,
und das ist der Zirkel. Deshalb der Umweg über das Blatt: `avesmapsTravelValuesPrime()` reicht die
eingestellten Werte an `avesmapsOffroadRampPrime()` weiter — dasselbe Muster, mit dem
`avesmapsTravelValuesSpeed` schon heute ohne PDO auskommt.

## 4. Die Werte

**Steigung 0,6 % je Meile Luftlinie, Deckel 2,0.**

⭐ Die 0,6 sind **gemessen, nicht gewählt**: die gemeldete Route braucht mindestens Faktor 1,4029
(14,968 × Faktor > 21,00). Bei 0,5 % kämen 1,4635 heraus — 4,3 % Luft, und das liegt im Rauschen
der Straßenseite, weil die 21,00 über Moorbrück/Gôrmel gemessen sind und ein besseres
Straßenpaar existieren kann. Bei 0,6 % sind es 1,5562 und 11 % Luft.

Wirkung auf die Etappe (Faktor auf die Reisezeit, **Luftlinie**):

| Etappe | Meilen Luftlinie | Faktor |
|---|---|---|
| kurze Abkürzung | 10 | 1,06 |
| die Abnahme-Route vom 15.08. (Gelände-Teil) | 36,0 | 1,22 |
| **die gemeldete Route** | **92,7** | **1,56** |
| Deckel erreicht | ab 166,7 | 2,00 |

Wirkung auf die Wahl:

- **Gemeldete Route** (gerechnet aus der Live-Messung, §8 misst nach): 14,968 × 1,5562 = **23,3**
  gegen Straße 21,00 → die Straße gewinnt wieder, mit rund 11 % Luft.
- **Abnahme-Route vom 15.08.** (`abgangspunkt-test.php`, **gemessen** am 15.08.2026 durch zwei
  Läufe derselben Fixture, einmal mit und einmal ohne Aufschlag):

  | | Aufteilung (Straße + Gelände) | direkt querfeldein | Abstand |
  |---|---|---|---|
  | ohne Aufschlag | 7,8844 | 8,7568 | 11,1 % |
  | mit Aufschlag | 8,8345 | 11,3838 | **28,8 %** |

  🔴 Der Abgangspunkt vom 15.08. wird durch den Aufschlag nicht zurückgenommen, sondern
  gestärkt — sein Vorsprung hat sich mehr als verdoppelt.

## 5. Die GA

Der Auftrag lautet „nicht komplett gegen die GA verstoßen". Das Gesetz hält sie ein, wo sie etwas
sagt, und weicht nur dort ab, wo sie schweigt:

- Bei **kurzen** Etappen geht der Faktor gegen 1,0 — es bleibt exakt bei GA S. 120–123,
  Querfeldein = 0,75 der Straße.
- Die GA beschreibt einen Geländefaktor, keine **Expedition**. Über 100 Meilen weglos ohne
  Nachschub, ohne Rastplatz und ohne Orientierungspunkt ist kein Fall, den die Tabelle abdeckt.
- Der **Deckel** ist die Zusicherung, dass wir sie nie ganz verlassen: schlimmstenfalls 0,375 der
  Straße — die Hälfte des GA-Werts —, und das erst nach 167 weglosen Meilen Luftlinie.

## 6. Das Fenster „Tempowerte"

Ein neuer Abschnitt **„Querfeldein-Aufschlag"** mit zwei einstellbaren Zeilen:

| Zeile | Einheit | Vorgabe |
|---|---|---|
| Steigung je Meile Luftlinie | % | 0,6 |
| Höchstaufschlag | × | 2,0 |

⚠️ Sie stehen **nicht** in `avesmapsTravelValuesSourceTable()` — das ist die reine GA-Quelle, und
der Aufschlag hat dort keine Zeile. Er ist unsere Rechnung, wie mean_G und der Pass-Normalisierer.
Der Abweichungs-Befund (`avesmapsTravelValuesDeviations`) vergleicht ihn deshalb gegen nichts; die
Zahl der abweichenden Wegtypen bleibt unberührt.

💣 **Der Deckel wird mit-eingestellt, nicht festgenagelt.** Eine Steigung ohne erreichbaren Deckel
ist eine versteckte Kopplung: wer die Steigung verdoppelt, verschiebt die Grenze, ab der sie nicht
mehr wirkt, und sieht es nirgends.

💣 **Der Schreiber liest zurück.** `travel_values` ist der Schlüssel, an dem die stille
MySQL-Kürzung gemessen wurde (AGENTS.md §10); der neue Abschnitt macht den Wert länger. Er läuft
über denselben Weg wie die vorhandenen Abschnitte, also über `avesmapsAppSettingEnsureWideValue()`
und `avesmapsTravelValuesStoredMatches()` — 🔴 und dessen Prüfung darf nicht nur `grid` zählen,
sonst bezeugt sie den neuen Abschnitt nicht.

🔴 **Das ist eine sichtbare Oberflächenänderung** und geht deshalb als **eigener** Commit einzeln
live (AGENTS.md §9), nach dem serverseitigen Teil.

## 7. Fallen

- 💣 **Bestehende Tests, die Zeiten festnageln, verschieben sich.** `abgangspunkt-test.php` hält
  Kosten fest; `offroad-multi-goal-test.php` vergleicht Einzel- gegen Mehrziel-Lauf (beide
  bekommen denselben Faktor, bleibt also gleich); `offroad-shortest-test.php` prüft `>`-Relationen
  (bleiben wahr). Jede betroffene Zahl wird **neu gemessen**, nicht überschlagen.
- 💣 **Ohne Priming gilt die Konstante.** Die Tests rufen `avesmapsOffroadFindPath` direkt. Der
  Rückfall muss der Vorgabewert sein, nicht 0 — sonst verhielte sich ein Test anders als der
  Server, und zwar in die bequeme Richtung.
- ⚠️ **Die Reparaturkanten (×25) bleiben unberührt.** Sie laufen nicht durch das Raster und tragen
  bereits ihr eigenes Gewicht; sie zusätzlich zu belasten hieße, zweimal für dasselbe zu zahlen.
- ⚠️ **Der Umweg-Auslöser** (`detour.php`) vergleicht gefahrene Strecke gegen Luftlinie und liegt
  vor dem Abschluss; er sieht den Aufschlag nicht. Das ist richtig: er entscheidet, ob quer
  überhaupt *gerechnet* wird — ob quer *gewinnt*, entscheidet danach der Dijkstra mit dem Preis.
- 💣 **`distance` bleibt unangetastet.** Nur `time` trägt den Aufschlag. Wer ihn in die Strecke
  legte, machte aus 103 Meilen 157 und löge auf der Etappenkarte.

## 8. Abnahme

**Nicht Maßtabellen, sondern der Ablauf** (AGENTS.md §9):

1. `https://avesmaps.de/?s=DnbLPQq2` öffnen — die Reise muss über die Straße laufen, mit mehreren
   Etappen statt einer, und die Stundenzahl muss zur angezeigten Strecke passen.
2. Salmingen → Kartenpunkt (504.530, 501.076) — muss weiterhin **zwei** Etappen liefern
   (Straße, dann Gelände), also den Abgangspunkt vom 15.08. behalten.
3. Eine kurze Abkürzung (< 15 Meilen Gelände) — darf sich praktisch nicht verändern.
4. Im Fenster „Tempowerte" die Steigung ändern, speichern, neu laden — der Wert muss stehen
   bleiben (Rücklesen) und eine Route muss sich messbar anders verhalten.
