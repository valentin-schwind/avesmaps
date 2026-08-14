# Die Rast wird in Portionen abgearbeitet

> Entwurf, 14.08.2026. Nichts davon ist gebaut.
> Anlass: eine Discord-Rückfrage („Wieso ist die Reise- und Rastzeit immer identisch?", 14.08.2026).
> Vorgänger, auf die sich alles stützt: `docs/superpowers/plans/2026-08-03-reisezeitpunkt-instruction.md`
> (der mitlaufende Kalender), `docs/reisekosten-quellenlage.md` (die Übernachtungen),
> `js/routing/__tests__/speed-table-and-rest-rule.test.js` (die heutige Regel als Test).

## 1. Warum

Der Planer rechnet die Rast heute als **Anteil**, nicht als Nacht
([`js/routing/route-result.js:65`](../../../js/routing/route-result.js)):

```
days     = Reisezeit / Reisestunden
Rastzeit = days × 24 − Reisezeit
```

also `Rast = Reisezeit × (24 − Reisestunden) / Reisestunden`. Bei der Voreinstellung von
12 Reisestunden ist der Faktor genau 1 — daher der Eindruck, Reise- und Rastzeit seien
„immer identisch". Sie sind es nur bei 12; bei 16 Reisestunden wäre die Rast halb so lang.

Als **Rate über eine mehrtägige Reise** ist das richtig: ein Reisetag von 12 Marschstunden
verbraucht 24 Stunden Kalender. Falsch wird es, sobald eine Reise **nicht** in vollen
Reisetagen aufgeht — denn für den angebrochenen letzten Tag wird eine volle Rast berechnet,
obwohl man längst angekommen ist:

| Reisezeit | heute | richtig |
|---|---|---|
| 2 h | 4 h | **2 h** (keine Nacht) |
| 10,6 h | 21,2 h | **10,6 h** (keine Nacht) |
| 24 h | 48 h | **36 h** (eine Nacht) |
| 36 h | 72 h | **60 h** (zwei Nächte) |

Der Fehler ist gedeckelt — es ist immer höchstens *eine* Rastportion zu viel, bei
Voreinstellung also ≤ 12 h. Auf kurzen Reisen ist das Faktor 2, und er schlägt auf das
**Ankunftsdatum** durch: der Kalender summiert ausdrücklich `travel_time + rest_time`
([`js/routing/route-plan-calendar.js:8`](../../../js/routing/route-plan-calendar.js)).

⭐ **Die Kostenseite rechnet längst richtig.** `avesmapsTravelCostNightKinds`
([`js/routing/route-costs.js:243`](../../../js/routing/route-costs.js)) geht die Etappen der
Reihe nach durch, summiert die **reine** Reisezeit und setzt bei jedem Vielfachen der
Reisestunden eine Nacht — um zu wissen, ob dort ein Dach steht. Diskrete Nächte, über die
ganze Route kumuliert. Es ist also keine neue Regel zu erfinden: **eine Hälfte des Planers
holt die andere ein.**

## 2. Die Entscheidungen (Owner, 14.08.2026)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Anteil oder Portionen? | **Portionen** — die ersten 12 Stunden werden nicht anteilig verkürzt |
| 2 | Je Etappe oder über die Reise? | **Über die ganze Route**, alle Wege zusammen |
| 3 | Startuhrzeit? | **Nein** — Reisestunden sind nicht an Tageslicht gebunden, man kann auch nachts gehen |
| 4 | Schnellsegler | Rastet nicht **und setzt den Zähler zurück** — man schläft an Bord |
| 5 | Rast nach der Ankunft? | **Nein** — gerastet wird nur, wenn noch Weg vor einem liegt |
| 6 | Nacht mitten in einer Etappe | Wird **in dieser Etappenzeile** ausgewiesen |

Entscheidung 3 ist der Grund, warum dieser Entwurf **keine** Abfahrtszeit einführt, obwohl
die Discord-Runde danach fragte: ohne Bindung an den Tageslauf ändert die Startstunde nichts
am Ergebnis. Der vorhandene „Reisebeginn" (Tag + aventurischer Monat) bleibt, wie er ist —
er steuert die Jahreszeit, nicht die Rast.

## 3. Das Modell

Ein durchlaufendes Band aus Reise und Rast; die Etappen liegen darunter, wo sie liegen:

```
|--- 12 h Reise ---|--- 12 h Rast ---|--- 12 h Reise ---|--- 12 h Rast ---|--- 12 h Reise ---|
| Et. 1 | Et. 2 | Et. 3 |            | Et. 4  |  Et. 5  |                 |     Et. 6    |
                                                                                   ▲ Ankunft
```

Drei kurze Etappen teilen sich einen Reisetag. Eine Nacht kann **mitten in einer Etappe**
liegen. Nach der Ankunft folgt keine Rast mehr.

Ein Zähler läuft über die ganze Route:

```
kein Rastwunsch (24 Reisestunden)?  -> überall 0, wie bisher

zähler = 0
tagesbudget = 24 − Rastportion          (= die eingestellten Reisestunden)

für jede Etappe der Reihe nach:
   ist die Etappe rastbefreit (Schnellsegler)?
        zähler = 0                       -> an Bord geschlafen, keine Rastzeit
        weiter zur nächsten Etappe
   rest = Reisezeit dieser Etappe
   solange rest > 0:
        ist zähler >= tagesbudget?       -> Rastportion buchen, zähler = 0
        stück  = min(rest, tagesbudget − zähler)
        zähler += stück
        rest   −= stück
```

💣 **Die Rast wird VOR dem nächsten Stück gebucht, nicht nach dem letzten.** Das ist der
ganze Trick und der Grund, warum kein Vorausschauen nötig ist: eine Rastportion entsteht nur
in dem Moment, in dem noch etwas zu reisen übrig ist. Wer sie stattdessen bucht, sobald der
Tag voll ist, hängt jeder Reise, die punktgenau mit dem Tagesbudget endet, eine Nacht nach
der Ankunft an.

Nachgerechnet, 12 Reisestunden:

| Reisezeit | Durchlauf | Rast | Gesamt |
|---|---|---|---|
| 2 h | ein Stück, Zähler 2 | 0 h | 2 h |
| 10,6 h | ein Stück, Zähler 10,6 | 0 h | 10,6 h |
| 24 h | 12 → Rast → 12 | 12 h | 36 h |
| 36 h | 12 → Rast → 12 → Rast → 12 | 24 h | 60 h |
| 8 h + Schnellsegler 40 h + 8 h | 8 → Zähler zurück → 8 | 0 h | 56 h |

Für eine Route ganz ohne Schnellsegler ist das geschlossen: `Nächte = ceil(Reisezeit / Reisestunden) − 1`.

## 4. Wo es hingehört

Eine Datei: [`js/routing/route-result.js`](../../../js/routing/route-result.js), Funktion
`buildRouteSteps`. Die Stelle ist bereits die richtige — dort liegen die **fertigen**
Etappen vor (`buildRoutePlanEntries` hat verschmolzen, `applyRouteSeasonGround` hat den
Bodenabzug schon auf die Reisezeit geschlagen). Aus dem heutigen `.map()` mit einer
Etappen-lokalen Rechnung wird ein `.map()` mit einem Zähler, der über die Aufrufe hinweg
stehen bleibt.

Unberührt bleiben:

- **Server und stabiler Vertrag.** `POST /api/route/` nimmt `include_rests` und
  `rest_hours_per_day` nur entgegen und validiert sie
  ([`api/_internal/routing/request.php:41`](../../../api/_internal/routing/request.php)) —
  gerechnet wird die Rast ausschließlich im Client. Keine PHP-Änderung, keine
  Vertragsänderung.
- **Kalender und Zusammenfassung.** Beide summieren `travel_time + rest_time` und ziehen von
  selbst nach.
- **Die Reisekosten** — siehe §5.

## 5. Die Reisekosten ziehen von selbst nach (nachgerechnet, nicht gehofft)

`avesmapsTravelCostRows` bestimmt die Zahl der Nächte als `floor(totalHours / 24)`
([`js/routing/route-costs.js:290`](../../../js/routing/route-costs.js)) und lässt
`avesmapsTravelCostNightKinds` nur noch entscheiden, **wo** diese Nächte liegen (Gasthaus,
an Bord, im Freien). Bezahlt werden ausschließlich die `inn`-Nächte.

Für Landrouten gilt danach exakt: mit `n = ceil(t/T) − 1` und `gesamt = t + n·(24−T)` ist
`floor(gesamt / 24) = n`, weil `gesamt − 24n = t − nT` und `0 < t − nT ≤ T < 24`. **Die
Nachtzahl der Kosten ist also genau die Zahl der gebuchten Rastportionen** — ohne dass in
`route-costs.js` eine Zeile geändert wird.

Für Routen mit Schnellsegler wird sie **besser**: heute rechnet das Beispiel aus §3
(8 h + 40 h + 8 h) mit 72 Gesamtstunden und damit 3 Nächten, künftig mit 56 und damit 2 —
und die beiden Marken bei 12 h und 24 h kumulierter Reisezeit fallen mitten in die
Schiffsetappe, werden also korrekt als `aboard` geführt. Zwei Nächte an Bord, kostenlos.
Das ist die Wirklichkeit der Überfahrt.

🔴 **`route-costs.js` wird in diesem Vorgang NICHT angefasst.** Diese Datei trägt seit dem
03.08.2026 die ausdrückliche Regel, die Nächte aus der Reisezeit zu **lesen** statt sie
selbst zu rechnen — genau damit sie mitwandert, wenn das Reisemodell korrigiert wird. Das
ist jetzt der Fall. Wer hier „mit aufräumt", bricht die Kopplung, die das gerade möglich
macht.

## 6. Was sich sichtbar ändert

- **Kurze Reisen werden etwa halb so lang** (bei 12 Reisestunden). Die 10,6 h aus der
  Discord-Rückfrage stehen künftig als 10,6 h Gesamtzeit da, nicht als 21,1 h.
- **Die Etappentabelle wird ungleichmäßig.** Eine 2-Stunden-Etappe, in die eine Nachtgrenze
  fällt, trägt „12 h Rast", ihre Nachbarn tragen „0 h". Das ist die ehrliche Darstellung des
  Bandes aus §3, aber es ist der augenfälligste Unterschied.
- **Ankunftsdaten rücken nach vorn**, teils um Tage.
- **Übernachtungskosten sinken** auf langen Reisen um bis zu eine Nacht, auf kurzen auf null.

⚠️ Der Erklärtext am Eingabefeld („Reisestunden pro Tag; der Rest des Tages ist Rast …",
`index.html`, i18n-Schlüssel `planner.travelHours.title`) bleibt wahr, ist aber unvollständig.
Er bekommt einen Halbsatz: gerastet wird erst, wenn die Reisestunden aufgebraucht sind und
noch Weg vor einem liegt. Deutsch im Markup, Englisch in
[`js/app/i18n-en.js`](../../../js/app/i18n-en.js) — beide Seiten, sonst steht die englische
Fassung allein auf der alten Erklärung.

## 7. Die Fallen

💣 **Ein Zähler für die Route, nicht je Etappe.** Wer `Nächte = Etappenzeit / Reisestunden`
je Zeile rechnet, bekommt bei einer Route aus lauter kurzen Etappen **nie** eine Nacht, egal
wie lang sie insgesamt ist — und Gareth → Fasar wäre eine Tagesreise. Das ist der Kern der
Owner-Entscheidung 2, und es ist der einzige Weg, auf dem diese Änderung lautlos falsch
werden kann: alle Zahlen bleiben plausibel, nur die Summe ist Unsinn.

💣 **Die Etappen sind zum Zeitpunkt der Rechnung bereits verschmolzen.** `buildRoutePlanEntries`
fasst Segmente zu Anzeige-Etappen zusammen und addiert dabei auch `restTime`
([`js/routing/route-plan.js:648`](../../../js/routing/route-plan.js) und `:705`) — heute
folgenlos, weil dort überall 0 steht. Das muss so bleiben: die Rast entsteht **nach** dem
Verschmelzen. Würde sie vorgezogen, hinge die Zahl der Nächte davon ab, wie viele
Anzeige-Etappen zufällig entstanden sind.

💣 **Zwei bestehende Tests kodieren die alte Regel und gehen rot** — sie bewachen echte, teure
Fehler und dürfen ihre Zähne nicht verlieren:

- [`speed-table-and-rest-rule.test.js:96`](../../../js/routing/__tests__/speed-table-and-rest-rule.test.js)
  (`restsLikeItTravels`) prüft auf einer 3-Meilen-Etappe, dass Rast == Reisezeit. Der Zweck
  war nachzuweisen, dass Flusskahn, Lastensegler und Galeere **überhaupt** rasten (bis
  02.08./03.08.2026 taten sie es nicht und fuhren 24 h am Tag). Neue Form: eine Etappe, die
  lang genug ist, um Nachtgrenzen zu überschreiten — Flusskahn & Co. bekommen ihre Nächte,
  der Schnellsegler keine.
- [`route-season-ground-apply.test.js:130`](../../../js/routing/__tests__/route-season-ground-apply.test.js)
  („mehr Reisezeit heisst mehr Rast") wird zur **Treppe statt zur Geraden**: zusätzliche
  Winterstunden erhöhen die Rast nur, wenn sie eine Nachtgrenze überschreiten. Die Etappe
  muss so gewählt werden, dass der Bodenabzug sie über eine Grenze schiebt — sonst prüft der
  Test nichts mehr.

⚠️ **Der Deploy ist ein Tor.** Vor dem Push läuft das ganze Testfeld, nicht nur diese beiden
(AGENTS §9) — ein roter Test lädt nichts hoch und vergiftet obendrein den `?v=`-Stempel.

## 8. Prüfung

Ein neuer Test neben den beiden umgeschriebenen, gegen den Zähler selbst:

1. **Kurz bleibt kurz:** 2 h Reisezeit → 0 h Rast. (Der Discord-Fall.)
2. **Punktgenaue Ankunft:** Reisezeit == Reisestunden → 0 h Rast, keine Nacht nach der
   Ankunft.
3. **Die Portion kommt:** 24 h → genau eine Rastportion, 36 h Gesamtzeit.
4. **Über Etappen hinweg:** sechs Etappen à 3 h (18 h gesamt) → genau eine Rastportion, und
   sie steht in der Etappe, in der die Grenze liegt — nicht in jeder.
5. **Der Schnellsegler setzt zurück:** 8 h Fuß + 40 h Schnellsegler + 8 h Fuß → 0 h Rast.
6. **Der Schalter bleibt ein Schalter:** ohne Rastwunsch (24 Reisestunden) überall 0.
7. **Die Kosten-Kopplung:** für eine Landroute ist `floor(Gesamtzeit / 24)` gleich der Zahl
   der gebuchten Rastportionen (§5). Diese Invariante trägt die Übernachtungskosten, ohne
   dass die Kostendatei davon weiß — sie gehört festgenagelt.

⚠️ **Abnahme heißt Ablauf, nicht Maß** (AGENTS §9). Vor „fertig" wird eine echte Route im
Browser geplant — kurz (unter einem Reisetag), lang (mehrere Nächte) und eine mit
Schnellsegler — und die Etappentabelle, die Zusammenfassung, das Ankunftsdatum und die
Kostenzeile werden angesehen, nicht nur die Tests.

## 9. Was nicht dazugehört

- **Keine Abfahrtszeit** (Owner-Entscheidung 3).
- **Keine Pausen innerhalb des Reisetages.** Der 12-Stunden-Reisetag der Geographia
  Aventurica enthält die kurzen Rasten bereits; die Rastzeit hier ist das Nachtlager. Ein
  Zwei-Stunden-Marsch kostet 0 Rast, nicht 15 Minuten.
- **Keine Änderung an Tempotabelle, Kalender, Kosten oder Server.** Falsch ist der Tag, mit
  dem gerechnet wird — nicht die Geschwindigkeit, und nicht, wer sie verbraucht.
