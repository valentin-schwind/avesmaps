# Status-Statistiken: Balken, Mouseover, Stundenachse, Klarnamen

**Stand:** 2026-08-13 · **Fläche:** Editor → Reiter *Status* → Unterreiter *Besucher*
(`js/review/review-visitor-analytics.js`, `css/components/visitor-analytics.css`)

Fünf Punkte aus einem Owner-Durchgang durch das Besucher-Dashboard. Kein neues
Feature — vier Reparaturen und eine Beschriftungsachse.

---

## 1. 💣 Die Balken sind unsichtbar (alle acht Listen)

**Befund.** `.va-row__fill` ist ein `<span>` ohne `display`, also `display: inline` — und
auf Inline-Elemente wirken `width` und `height` **nicht**. Der Balken ist damit ein
nulldimensionales Element mit Hintergrundfarbe. Die Prozentbreite, die `vaBars()` als
Inline-Style schreibt, ist korrekt gerechnet und wird vom Layout schlicht ignoriert.

Betroffen ist **jede** Karte, die `vaBars()` zeichnet: Top-Suchbegriffe, Referrer,
Beliebteste Routen, Beliebte Orte, Transportmittel, Routenoptionen, Sprache,
Anzeige-Optionen.

**Der Gegenbeweis steht drei Zeilen höher:** `.va-geo-fill` (die Länderbalken unter
„Herkunft", gebaut von `renderGeoCountries()`) trägt `display: block` — und genau diese
Karte funktioniert. Zwei Balkensorten, eine mit und eine ohne die Zeile.

**Behebung.** `display: block` auf `.va-row__fill`.

⚠️ Die Farben bleiben, wie sie sind. Der Kommentar direkt darüber hält fest, dass die
Serienfarben eine kategoriale Datenpalette und eine bewusste Ausnahme von der
Token-Regel sind (Owner 2026-07-11).

## 2. Mouseover mit den konkreten Zahlen im Liniendiagramm

`vaLine()` zeichnet zwei Kurven ohne jede Beschriftung der einzelnen Tage; die
Y-Achse nennt nur `0` und das Maximum, die X-Achse drei Datumsstempel.

**Behebung.** Je Tag ein unsichtbares Feld über die volle Diagrammhöhe mit einem
`<title>`: „12.08.2026 — Aufrufe: 1.234 · Eindeutige: 567".

- 💣 **Die Punkte selbst taugen nicht als Ziel** (`r="2.6"`). Das Feld ist eine
  Spaltenbreite breit, also überall auf der Kurve treffbar.
- 💣 **`fill="transparent"`, nicht `fill="none"`.** Nur eine Füllung fängt
  Zeigerereignisse; `none` lässt sie durch und der Tooltip erschiene nie.
- 💣 **Die Felder stehen als Letztes im Markup.** SVG kennt kein `z-index`, es gewinnt
  die Dokumentreihenfolge.

## 3. Uhrzeiten als Spaltennamen bei „Aktivste Zeiten" — in Ortszeit

**Befund.** `vaHeatmap()` zeichnet 7×24 Zellen ohne Stundenachse. Man sieht ein Muster
und kann es nicht lesen.

💣 **Die Stunde steht als UTC in der Datenbank** — `api/app/track.php` schreibt
`(int) gmdate('G')`. Eine Achse, die „14" an eine UTC-Spalte schreibt, wäre im
deutschen Sommer durchgehend zwei Stunden falsch.

**Behebung.** Vor dem Zeichnen auf die Zeitzone des Browsers umrechnen, **mitsamt
Wochentag**: UTC Montag 23 Uhr ist Dienstag 1 Uhr. Darüber eine Kopfzeile mit den
Stunden 0, 3, 6, 9, 12, 15, 18, 21 — bei 400 px Panelbreite bleiben ~11,8 px je Spalte,
24 Zahlen passen nicht, jede dritte passt bequem. Die Karte heißt danach
**„Aktivste Zeiten (Ortszeit)"**.

⚠️ **Bekannte Ungenauigkeit, bewusst in Kauf genommen:** der Versatz von *heute* gilt
für den ganzen Zeitraum. Über die Sommerzeitgrenze hinweg liegt die Achse um eine
Stunde daneben — harmloser als die zwei Stunden, die sie sonst dauerhaft danebenläge.

⚠️ Nebenbei: die Sonntagszeile bekommt ihr `title` (sie ist als einzige ohne gebaut).

## 4. „ecosystem" und „original" stehen als interne Schlüssel in der Kartenansicht

**Befund.** `VA_MAP_MODE_LABELS` kennt vier der sechs Ansichten. `original` und
`ecosystem` fehlen, also fällt `vaPrettyMapMode()` auf den Slug zurück.

**Behebung.** Die Tabelle **entfällt**. Die Beschriftungen kommen aus den `<option>`
von `#mapLayerModeSelect`.

💣 **Warum nicht einfach zwei Zeilen nachtragen:** für diese sechs Ansichten gilt, dass
sie nur in den `<option>` stehen und nie ein zweites Mal (AGENTS.md §11,
Ansichts-Kachel). Diese Tabelle *war* die zweite Stelle, und sie ist genau so
auseinandergelaufen. Das Dashboard läuft im selben Dokument wie das `<select>`.

⚠️ Ein zurückgezogener Modus hat keine `<option>` mehr und fällt weiterhin auf seinen
Schlüssel zurück. Das ist gewollt: ein roher Schlüssel ist ehrlicher als eine geratene
Beschriftung.

## 5. Nicht in dieser Runde

🔧 **Der Ring „Kartenansicht" hat vier Farben für sechs mögliche Ansichten**
(`cols[i % cols.length]`), Segment 5 und 6 wiederholen also 1 und 2. Das bestand schon
vorher und wird durch Punkt 4 nur sichtbarer. Es *jetzt* mit zwei erfundenen Farbtönen
zu füllen wäre falsch: die gerechnete Grenze der Projektpalette liegt bei vier Reihen,
und eine fünfte Reihe wird abgewiesen, nicht bedient. Die Zuordnung trägt ohnehin die
Legende im Klartext, nicht die Farbe allein. Owner-Entscheid, getrennt.

---

## Abnahme (Ablauf, nicht Maß)

Im Editor, Reiter *Status* → *Besucher*:

1. Referrer, Beliebteste Routen, Beliebte Orte zeigen **sichtbare** Balken; der längste
   füllt die Spur ganz.
2. „Weitere Kennzahlen" aufklappen → Transportmittel, Routenoptionen, Sprache,
   Anzeige-Optionen ebenso.
3. Mit der Maus über das Diagramm „Aktivität über Zeit" fahren → Datum und beide Zahlen
   erscheinen, auch zwischen den Punkten.
4. „Aktivste Zeiten (Ortszeit)" trägt eine Stundenzeile; eine Zelle unter der Maus nennt
   Tag, Stundenspanne und Zahl — auch in der Sonntagszeile.
5. Der Ring „Kartenansicht" nennt „Landschaften" und „Original", nirgends `ecosystem`
   oder `original`.

Automatisch: `js/review/__tests__/visitor-analytics-render.test.js`, und vor dem Push
das **ganze** Testfeld (AGENTS.md §9).
