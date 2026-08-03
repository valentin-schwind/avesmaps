# Gangbarkeit je Fahrtyp — ein Modell statt Sonderfälle

**Abgenommen:** Owner, 2026-08-03.
**Ersetzt:** den Kopfzeilen-Entwurf in `docs/superpowers/plans/2026-08-03-reisezeitpunkt-instruction.md`
Phase 3 (dort korrigiert).

---

## 1. Was falsch war

Der Server speichert die Gangbarkeit seit dem ersten Tag **je Transportmittel**:
`properties.transport_seasons = { transportKey: {from_month, from_day, to_month, to_day} }`
(`api/_internal/routing/transport-season.php`, Client-Spiegel `js/routing/transport-season.js`,
156 Fälle paritätsgeprüft).

Zusammengequetscht haben es nur die beiden **Bearbeitungsoberflächen**: sie schrieben *ein* Fenster
auf *alle* angehakten Mittel — im Karten-Dialog als eigene Zeile „Gangbar (saisonal)", die gar nicht
an den Haken darüber hing, im Sync-Editor als Block „von/bis" unter der Hakenliste.

Daraus folgte eine Kette, die keiner brauchte:

1. ein gemeinsames Fenster ⇒ es braucht eine **Kopfzeile**, die alle setzt,
2. eine Kopfzeile mit Zustand ⇒ sie muss melden, wenn eine Zeile **abweicht**
   („— zwei Zeilen weichen ab"),
3. eine Abweichung ⇒ es braucht ein **Sonderfall**-Verhalten, wie eine einzelne Zeile ausschert.

Nimmt man Schritt 1 weg, fallen 2 und 3 ersatzlos weg. Owner 2026-08-03: *„ich will keine
sonderfälle, sondern ein generelles modell der befahrbarkeit von strecken."*

## 2. Das Modell

**Eine Zeile je Fahrtyp. Der Haken sagt ob, die Zeit dahinter sagt wann.**

| Zeile | bedeutet |
|---|---|
| kein Haken | fährt hier **nie** |
| Haken + „ganzjährig" | **immer** offen (der gewöhnliche Weg, und heute jeder) |
| Haken + Monat | nur in diesem **Fenster** offen, außerhalb gesperrt |

Es gibt keine Kopfzeile, kein „für alle setzen", keine Abweichungsmeldung. Eine Zeile weiß selbst,
wann sie offen ist.

**Eine Regel fürs Ausgrauen, einmal formuliert: ein Feld ist grau und tot, wenn es nichts bedeuten
kann.**

- Zeile nicht angehakt → alle vier Zeitfelder grau (die Zeit eines nie fahrenden Mittels ist leer).
- Zeile angehakt, „ganzjährig" → Tag, bis-Monat, bis-Tag grau (das Fenster ist keins).
- Zeile angehakt, Monat gewählt → alle vier bedienbar.

Vorbild ist der Reisebeginn im Routenplaner
(`.route-planner-options-panel input[type="number"]:disabled` in `css/features/route-planner.css`):
`--color-panel-muted`, `--color-divider`, `--color-text-muted`, `cursor: not-allowed`. 💣 `disabled`
allein reicht im dunklen Thema **nicht** — der Browser graut ein helles Feld sichtbar aus, ein
dunkles kaum.

**Die Werte bleiben beim Ausgrauen stehen.** Wer versehentlich einen Haken entfernt und ihn wieder
setzt, findet sein Fenster vor. Gespeichert wird es trotzdem nicht — das entscheidet allein der
Server (siehe §4).

## 3. Die Oberfläche

Tabellenform, in **beiden** Editoren dieselbe:

```
Erlaubte Transportmittel                              gangbar
☑ Karawane               [ganzjährig ▾] [ 1] bis [Praios ▾] [30]
☑ Reisegruppe zu Fuss    [Praios     ▾] [ 1] bis [Efferd ▾] [30]
☐ Kutsche                [ganzjährig ▾] [ 1] bis [Praios ▾] [30]
```

- **Karten-Dialog „Weg bearbeiten"** (`index.html` → `#path-edit-transport-options`, Logik
  `js/review/review-path-seasons.js`): die Zeitfelder stehen rechts in der Zeile.
- **Sync-Editor „Wege bearbeiten"** (`js/pages/wege-editor.js`): dieselbe Zeile in der schmalen
  dritten Spalte; die Zeitfelder umbrechen unter den Namen, wenn der Platz nicht reicht.

Die Monatsnamen werden **nicht** neu aufgeschrieben: der Karten-Dialog klont die `<option>`-Liste
aus dem Reisebeginn des Routenplaners (`#travelStartMonth`), der Sync-Editor nimmt
`TRAVEL_CALENDAR_MONTHS` aus `js/routing/travel-calendar.js`. Eine Wahrheit über das aventurische
Jahr, und unter `?lang=en` von selbst richtig.

**Sichtbar an jedem Weg** (Owner 2026-08-03). Bisher erschien der Zeitteil nur an einem Wiki-Weg der
Art „Pass" und an Wasserwegen — das war selbst ein Sonderfall. Eine Reichsstraße sagt jetzt eben
sechsmal „ganzjährig"; genau so sieht ein allgemeines Modell aus, wenn nichts Besonderes gilt.
Gespeichert wird dadurch **nichts** Zusätzliches.

## 4. Was sich am Server ändert: nichts

`avesmapsReadTransportSeasons(value, allowedTransports)` erzwingt das Modell bereits:

- ein Fenster auf einem **nicht angehakten** Mittel wird verworfen (tote Daten, die am Tag des
  nächsten Hakens wieder aufwachen würden),
- ein Fenster über das **ganze Jahr** wird verworfen — „ganzjährig" ist die **Abwesenheit** eines
  Fensters, nicht ein Fenster über zwölf Monate. Zweimal gespeichert wären es zwei Antworten auf
  eine Frage.

`avesmapsApplyTransportSeasonsToWikiSiblings` trägt das Ergebnis auf **alle Segmente desselben
`wiki_path.wiki_key`** und filtert dabei je Segment gegen dessen eigene `allowed_transports`. Ein
Pass ist bei uns eine Kette aus bis zu zwölf Stücken; ein Fenster an nur einem davon wäre ein Loch,
durch das der Router fährt.

## 5. Was ersatzlos entfällt

- `#path-edit-season` samt `#path-edit-season-*`-Feldern und Hinweiszeile in `index.html`.
- `pathSeasonAppliesTo()` / `PATH_SEASON_WATER_SUBTYPES` / `pathSeasonStoredWindow()` in
  `js/review/review-path-seasons.js` — die Sichtbarkeitsweiche und das „irgendein Fenster genügt".
- Der `wikiArt === "pass" || isWater(...)`-Zweig samt `.dt-season`-Block und `seasonWindowOf()` in
  `js/pages/wege-editor.js`.
- Die geplante Kopfzeile „Alle gangbar" mitsamt Rückwärtslesen und Abweichungsmeldung — sie wurde
  nie gebaut und wird es auch nicht.

## 6. Prüfen

1. **Pass:** „Schattenbachpass" öffnen. Nur „Reisegruppe zu Fuss" und „Zu Fuss" anhaken, beiden
   Praios 1 – Efferd 30 geben, speichern, neu laden — beide Zeilen stehen wieder da, die vier
   ungehakten sind grau.
2. **Gewöhnlicher Weg:** eine Reichsstraße öffnen. Sechs Zeilen, alle „ganzjährig", je drei graue
   Felder. Speichern ändert nichts: `transport_seasons` bleibt **abwesend** (nicht `{}` mit
   Ganzjahresfenstern).
3. **Jahreswechsel:** Peraine 1 – Boron 30 an einer Zeile setzen, speichern, neu laden — der Wert
   steht (Tag 271 bis Tag 150, läuft über den Jahreswechsel; fünf der zehn belegten Fenster tun das).
4. **Geschwister:** ein Segment eines Wiki-Weges speichern, ein anderes Segment desselben Weges
   öffnen — dasselbe Fenster steht dort.
5. **Grau ist wirklich tot:** in eine graue Zeile klicken/tippen ändert nichts, und beim Speichern
   entsteht daraus kein Eintrag.
6. `node js/review/__tests__/path-transport-options.test.js` bleibt grün (die Weiche „angeboten vs.
   vorausgewählt" ist unberührt).
