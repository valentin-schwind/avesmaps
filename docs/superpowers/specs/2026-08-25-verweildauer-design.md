# Verweildauer — wie lange ein Besuch dauert

**Entwurf, 25.08.2026.** Owner-Wunsch: „außerdem wollten wir wissen wielang die nutzer
durchschnittlich auf der seite sind. wichtig wär uns ein max 12h histogramm mit median und
durchschnitt."

Mockup: `docs/besucherstatistik-verweildauer-mockup.html` (Abschnitt 2), vom Owner abgenommen
(„Verweildauer perfekt"). Teil 1 desselben Mockups — die Editoren-Linie — ist am 25.08.2026
getrennt live gegangen (`c300d3e9`).

---

## 1 · Was gemessen wird, und warum genau das

**Gemessen wird die Zeit, in der die Karte im Vordergrund stand.** Nicht „der Tab war offen".

🔴 **Das ist keine Wahl, sondern die einzige messbare Größe.** Der Anwesenheits-Ping in
`js/app/visitor-tracking.js` schweigt, sobald `document.visibilityState !== "visible"` — und das ist
richtig so, weil Browser die Uhren eines Hintergrundtabs ohnehin ausbremsen. Ein Tab, der seit
gestern im Hintergrund liegt, ist für den Server von einem geschlossenen nicht zu unterscheiden.

⚠️ Und selbst wenn er es wäre, wollten wir es nicht: ein über Nacht offener Tab wäre ein
Neun-Stunden-Besuch. Der Median, den der Owner sehen will, ist die Zahl, die davon als erste kippt.

**Owner-Entscheid 25.08.2026:** „Karte vor Augen".

## 2 · Woher die Daten kommen — es gibt sie schon fast

Der Anwesenheits-Ping läuft seit 20.07.2026 (`api/app/heartbeat.php`, Tabelle `visitor_live`):

| | heute |
|---|---|
| Takt | alle 60 s, **nur** bei sichtbarem Tab und nur, solange die letzte Bedienung < 15 min her ist |
| Zustände | `active` (Bedienung < 2 min her) · `reading` · `hidden` (einmalig beim Wegschalten) · `gone` (bei `pagehide`) |
| Zeile | ein Datensatz je anonymem Tages-Hash: `visitor_hash`, `actor_type`, `state`, `last_seen` |
| Fenster | 150 s gilt als anwesend, nach 15 min räumt der Purge die Zeile weg |

Es fehlt **eine einzige Spalte**: wann der Besuch angefangen hat.

```sql
ALTER TABLE visitor_live ADD COLUMN first_seen DATETIME NOT NULL;
```

Der Rest ist Buchführung.

## 3 · Wann ein Besuch endet — drei Ausgänge, EIN Buchhalter

Ein Besuch („Lauf") endet auf drei Wegen:

1. **`gone`** — der `pagehide`-Ping. Der genaue Fall: Dauer = jetzt − `first_seen`.
2. **Neustart** — ein Ping kommt, aber `last_seen` der Zeile ist älter als das Anwesenheitsfenster
   (150 s). Der vorige Lauf ist unbemerkt zu Ende gegangen: alten Lauf buchen, neuen beginnen.
3. **Purge** — eine Zeile, die seit 15 min nichts mehr gemeldet hat, wird gebucht und gelöscht.

💣 **Alle drei gehen durch dieselbe Funktion** `avesmapsVisitorFinishLiveRun()`. Das ist die Lehre
vom 14.08.2026 (Verkehrsmittel-Sperre in zwei von vier Erzeugern) und vom 15.08. (Ausstiegsregel in
einem von vier): **eine Regel, die einen von mehreren Erzeugern bindet, ist keine Regel.** Hier wäre
der Preis ein Histogramm, das je nach Ausgang zählt oder nicht — und das sieht wie ein Datenmangel
aus, nicht wie ein Fehler.

💣 **Der Purge muss buchen, BEVOR er löscht.** Heute löscht er nur
(`avesmapsVisitorPurgeLive`). Wer die Reihenfolge dreht, verliert genau die Läufe, deren
`pagehide`-Beacon nicht ankam — und das sind auf Mobilgeräten die meisten.

💣 **Gebucht wird auf den Tag von `first_seen`, nie auf den Tag der Buchung.** Ein Lauf, der um
23:58 endet und um 00:14 weggeräumt wird, gehört in den Vortag. `avesmapsVisitorIncrement` schreibt
heute fest `UTC_DATE()`; es bekommt einen optionalen Tagesparameter, der auf `UTC_DATE()`
zurückfällt — kein Aufrufer ändert sich.

💣 **`first_seen` darf vom `ON DUPLICATE KEY UPDATE` nicht überschrieben werden.** Der bestehende
Upsert in `avesmapsVisitorRecordLive` setzt jedes Feld neu; nähme er `first_seen` mit, wäre jeder
Besuch genau einen Ping lang und das Histogramm hätte genau einen Balken.

⚠️ **Kosten: eine zusätzliche Leseabfrage je Ping** (Primärschlüssel-Zugriff), damit der Neustart
erkannt wird. Ohne sie verschmelzen der Morgen- und der Abendbesuch desselben Anschlusses zu **einem
Besuch von zwölf Stunden** — der Tages-Hash ist derselbe. Der Ping schrieb bisher einmal und las
nie; das wird 1 Schreiben + 1 Lesen. Bei ~20 Anwesenden sind das 20 Indexzugriffe je Minute.
🔴 Bewusst **nicht** dem Client überlassen (ein Flag „ich fange neu an"): fällt es aus, verschmelzen
die Besuche lautlos, und lautlos falsch ist schlimmer als ein Indexzugriff.

## 4 · Wie die Dauer gespeichert wird

Drei Zeilen je Tag und `actor_type` in `visitor_metric` — keine neue Tabelle, keine Migration:

| `metric` | `dimension` | `count` | wofür |
|---|---|---|---|
| `dwell` | Untergrenze des Korbs in Sekunden, fünfstellig (`"00030"`) | Anzahl Besuche | das Histogramm |
| `dwell_seconds` | `''` | Summe der Sekunden | der **exakte** Durchschnitt |
| `dwell_sessions` | `''` | Anzahl Besuche | der Nenner dazu |

**Die Körbe sind fein gespeichert und grob gezeigt.** `avesmapsVisitorDwellBucket(int $seconds)`
ist die einzige Stelle, die die Einteilung kennt:

- bis 5 min: 10-Sekunden-Schritte (30 Körbe)
- bis 60 min: 1-Minuten-Schritte (55 Körbe)
- bis 12 h: 5-Minuten-Schritte (132 Körbe)
- darüber: ein Überlaufkorb (`"43200"`)

⭐ **Warum fein:** die Anzeige darf ihre elf Balken später anders schneiden, ohne die Geschichte neu
zu deuten. Und der Median wird aus Körben **interpoliert** — bei 10-Sekunden-Körben am kurzen Ende
ist er auf zehn Sekunden genau, bei Minutenkörben wäre er es auf eine Minute, und die halbe Wahrheit
über einen Median von 2:25 min ist keine.

⚠️ Möglich sind ~218 Körbe je Tag und Sorte; tatsächlich getroffen werden bei ~100 Besuchen am Tag
höchstens 100. `count` ist `INT UNSIGNED`, und `dwell_seconds` kann pro Tageszeile nicht über einen
Tagesbetrag hinauswachsen — kein Überlauf.

💣 **Die Korb-Funktion ist rein und ohne Datenbank prüfbar.** Dieselbe Trennung wie bei
`avesmapsVisitorMergeEditorRows` (Teil 1): eine SQLite-Fixture könnte `TIMESTAMPDIFF` und
`DATE_SUB(UTC_DATE(), …)` nicht ausführen, und die Abfrage dafür umzuschreiben hieße, den Test gegen
die Produktion zu drehen (AGENTS.md §9, Fehler 1093).

## 5 · Der Leser und die Karte

`avesmapsVisitorReadDwell(PDO, string $actorType, int $days)` liefert
`{ buckets: [{from_seconds, count}], sessions, seconds_total }` und reist in
`api/app/visitor-metrics.php` als `dwell` mit.

⭐ Weil der Leser die Sorte kennt, bekommen **beide Unterreiter** ihre eigene Karte — die
Verweildauer der Editoren ist keine Dublette (anders als die Editoren-Linie aus Teil 1, siehe deren
Begründung im Code).

Die Karte steht unter „Aktivität über Zeit" und sieht aus wie im Mockup:

- Kopf „Verweildauer", drei Kacheln: **Median · Durchschnitt · Besuche**
- elf Balken, nach rechts breiter werdend (`<1 · 1–2 · 2–5 · 5–10 · 10–20 · 20–45 · 45–90 min ·
  1,5–3 · 3–6 · 6–12 · >12 h`), eine Farbe für alle
- **Median** als durchgezogener, **Durchschnitt** als gestrichelter Strich, beide in Tinte
  (`--color-text-strong`) mit einer Fassung in der Kartenfarbe darunter
- Fußnote: „Zeit mit der Karte im Vordergrund. Ohne Klick, Tastendruck oder Zoom endet die Messung
  nach 15 Minuten."

💣 **Eine Farbe für alle Balken, KEINE sequenzielle Leiter.** Die Hausleiter
`--color-accent → -accent-strong → -accent-brown` ist nicht themenfest: `--color-accent-brown` ist
hell `#7a5a3a` (dunkelbraun) und dunkel `#c9a97e` (helles Tan). Im Dunkelmodus gemessen:
`rgb(207,183,103)` gegen `rgb(201,169,126)` — die Leiter kehrt sich um und ist keine mehr. Hier
trägt ohnehin allein die Höhe die Aussage; eine Farbleiter täuschte eine zweite vor.

💣 **Die zwei Striche brauchen eine Fassung.** Tinte über einem goldenen Balken hat im dunklen Thema
1,7:1 Kontrast (dort ist beides hell). Eine breitere Linie in `--color-panel` darunter trennt sie in
beiden Themen; gemessen 12:1 Tinte gegen Fassung, 3,78:1 (hell) und 8,08:1 (dunkel) Balken gegen
Karte.

💣 **Der Strich sitzt anteilig in SEINEM Korb, nicht linear auf der Achse.** Die Achse ist nicht
linear in Minuten — ein Median von 2:25 min gehört auf 14 % der Breite des Korbs „2–5", nicht auf
2/720 der Gesamtbreite.

⚠️ **Zwei Zeilen Beschriftung im Wechsel**, waagerecht — gedreht passte sie zwar auch, war bei 9 px
aber mühsam zu lesen, und lesen soll man sie.

## 6 · Der Client: eine Zeile

`wheel` kommt als Lebenszeichen dazu (`pointerdown` und `keydown` gibt es schon).

💣 **Zoomen ist heute keine Bedienung.** Wer die Karte zehn Minuten lang nur mit dem Mausrad
erkundet, gilt nach 15 Minuten als weg — und das ist genau der Besucher, dessen Verweildauer
interessiert. Ohne diese Zeile misst das Histogramm eine Bedienungsart weg.

Sonst ändert sich am Client nichts: der `gone`-Beacon existiert, den Rest rechnet der Server.

## 7 · Was die Zahlen NICHT sagen — gehört in den Entwurf, nicht in eine Fußnote

1. 🔴 **Sie fangen bei null an.** Rückwirkend gibt es keine Verweildauer; die Vergangenheit ist
   nicht rekonstruierbar. Die ersten Tage sehen aus wie die rechte Karte im Mockup.
2. 🔴 **Reines Lesen wird nach 15 Minuten abgeschnitten.** Der Riegel stammt aus dem
   Anwesenheits-Ping („ein über Nacht vergessener Tab soll keinen Phantom-Leser melden") und bleibt.
   Wer die Karte bedient — klickt, schiebt, zoomt —, setzt ihn zurück; wer sie 40 Minuten reglos
   anschaut, ist von jemandem, der weggegangen ist, nicht zu unterscheiden. **Die sichere Richtung
   ist die kürzere Zahl.**
3. ⚠️ **Ein verlorener `gone`-Beacon rundet den Lauf auf den letzten Ping ab** — Fehler höchstens
   60 s, immer nach unten.
4. ⚠️ **Eine Pause von mehr als 150 s zählt als zwei Besuche.** Auch das ist die kürzende Richtung.
5. ⚠️ **Am ganz kurzen Ende ist die Genauigkeit gemischt:** kommt der `pagehide` an, steht dort die
   echte Sekundenzahl; kommt er nicht an, steht 0. Beides landet im Korb „unter 10 s", der Balken
   stimmt also — nur der Median innerhalb dieses Korbs ist dort geraten.

## 8 · Datenschutz

Kein neues personenbezogenes Datum. `visitor_live` trägt bereits den anonymen Tages-Hash und einen
Endzeitpunkt; dazu kommt ein Anfangszeitpunkt **derselben** Zeile. Die Aufbewahrung ändert sich
nicht: die Live-Zeile stirbt weiter nach 15 Minuten, dauerhaft bleibt nur der Tagesaggregat-Zähler,
und der trägt keine Identität.

🔧 **Owner:** die Aufzählung im Hinweise-Fenster („was wir aggregiert erheben") sollte „Verweildauer"
mitnennen. Ein Satz, keine neue Rechtsgrundlage.

## 9 · Bauteile

| Datei | was |
|---|---|
| `api/_internal/analytics/visitor-analytics.php` | `first_seen` im DDL, `avesmapsVisitorDwellBucket` (rein), `avesmapsVisitorFinishLiveRun`, Purge bucht, Upsert schützt `first_seen`, `avesmapsVisitorReadDwell`, Tagesparameter an `avesmapsVisitorIncrement` |
| `api/app/heartbeat.php` | Neustart erkennen, `gone` bucht vor dem Löschen |
| `api/app/visitor-metrics.php` | `dwell` in die Antwort |
| `js/app/visitor-tracking.js` | `wheel` als Lebenszeichen |
| `js/review/review-visitor-analytics.js` | `vaDwell` (Histogramm + zwei Striche), Karte, drei Kacheln |
| `css/components/visitor-analytics.css` | `.va-hist__*` |

**Tests:** `avesmapsVisitorDwellBucket` (Ränder jeder Stufe, Überlauf), die Median-Interpolation und
die Strich-Position im Korb (JS, rein), die Buchung auf den Tag von `first_seen`, und — die
tragendste Zusicherung — **dass alle drei Ausgänge durch denselben Buchhalter gehen**
(Laufzeitzählung der Aufrufer, wie in `field-origins-test.php`).

## 10 · Offen

🔧 Das Ganze ist datenbankgebunden und lokal nicht gegen echte Daten prüfbar — wie beim
Anwesenheits-Ping 2026-07-20 sieht erst der Owner im Panel, ob die Zahl steht. Der Weg dorthin: nach
dem Deploy ein paar Minuten die Karte offen lassen, dann Tab schließen, dann im Panel nachsehen.
