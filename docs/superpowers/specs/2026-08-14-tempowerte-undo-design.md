# Tempowerte rückgängig machen — Entwurf

**Stand:** 14.08.2026 · **Anlass:** Owner, nach dem ersten Rücksetzer im Fenster „Tempowerte"
**Vorgeschichte:** `docs/superpowers/specs/2026-08-07-tempowerte-design.md` · Schritt 2 live seit 14.08.

> Dies ist ein **Entwurf**. Gebaut ist davon nichts.

---

## 1. Der Anlass, in einem Satz

„Da standen 6 Werte weichen ab, jetzt hab ich rückgesetzt, aber weiß nicht welche Werte sich
verändert haben."

Seit dem 14.08. beantwortet das Fenster die zweite Hälfte: jede bewegte Zeile trägt ihr
„war 3,45", die Meldung nennt die Zahl. **Die erste Hälfte ist offen** — man sieht, was passiert
ist, und kann es nicht zurücknehmen.

🔴 **Und der Hebel ist größer, als er aussieht.** Der Klick auf „Alle Wegtypen auf die GA-Werte
zurücksetzen" hat **26 Zellen** über alle sechs Landreisemittel bewegt, nicht fünf. Jede davon ist
eine Reisezeit auf jeder gezeichneten Straße der Karte.

---

## 2. Was heute schreibt, und wie unumkehrbar es ist

| Handlung | schreibt | umkehrbar |
|---|---|---|
| Ein Feld ändern | nichts | ja, `↩` an der Zeile · „Abbrechen" |
| **„Speichern"** | `app_setting['travel_values']` (eine Zeile JSON) | **nein** |
| **Abschnitts-Rücksetzer** | dasselbe, **sofort und ohne Nachfrage** | **nein** |
| Landschaften-Rücksetzer | `ecosystem_region_type.terrain_speed_factor` | **nein** |

⚠️ **Der Rücksetzer ist die gefährlichste Taste des Fensters** und sieht aus wie die harmloseste:
weich, klein, in der Zeile. Er fasst mehr Werte auf einmal an als jede andere Geste im Editor.

---

## 3. Was es schon gibt — und warum es nicht reicht

`map_audit_log` bekommt **je Schreibvorgang eine Zeile** mit `before_json` und `after_json`
(`travel_values_save` / `travel_values_reset`, `feature_id = NULL`). Der Vorzustand ist also
**bereits vollständig gespeichert**.

💣 **Aber nur das Raster.** `before_json` trägt heute `['grid' => …]` und sonst nichts — die
Landschaftsspalte, die Bodenwerte und die beiden Einzelzahlen stehen nicht darin. Ein Undo auf
dieser Grundlage stellte das Raster her und ließe alles andere stehen, ohne es zu sagen. **Das ist
schlimmer als kein Undo**, weil es Vollständigkeit behauptet.

⭐ Der Weg ist trotzdem der richtige: **erst das Protokoll vollständig machen, dann daraus
zurückrollen.** Ein zweiter Speicher für Vorzustände wäre eine zweite Wahrheit neben einem, der
schon existiert.

---

## 4. Der Vorschlag

### 4.1 Das Protokoll trägt den GANZEN Zustand

`before_json` und `after_json` bekommen dieselbe Form, die auch abgelegt wird — plus die
Landschaften:

```
{ "values": { grid, day_miles, path_factors, ground_penalties, river_ratio,
              calibration_target_miles },
  "landscapes": [ {kind, type_key, factor}, … ] }
```

🔴 **Die Form kommt aus `avesmapsTravelValuesStorableShape()`**, nicht aus einer zweiten Liste.
Genau daran ist der Endpunkt schon einmal fast auseinandergelaufen; die Funktion existiert, weil
zwei Abschriften beim nächsten neuen Abschnitt divergieren.

### 4.2 Eine Zeile zurücknehmen

Neue Aktion `undo` am bestehenden Endpunkt:

1. Die **jüngste** `travel_values_*`-Zeile aus `map_audit_log` lesen.
2. Ihr `before_json` als eingehende Nutzlast durch **denselben** Pfad schicken, den „Speichern"
   nimmt (`avesmapsTravelValuesApplyIncoming` + `avesmapsTravelValuesWriteLandscapes`).
3. Die Rückleseprobe wie beim Speichern; erst dann gilt es.
4. **Eine eigene Protokollzeile** `travel_values_undo` schreiben.

💣 **Ein Undo ist ein Schreibvorgang, keine Zeitreise.** Es darf die zurückgenommene Zeile nicht
löschen und nicht als „erledigt" markieren — sonst weiß hinterher niemand mehr, dass es sie gab.
Zweimal Undo nimmt dann das Undo zurück, und das ist richtig so: es ist ein Redo, ohne dass man
eines bauen muss.

⚠️ **Kein Stapel, keine Tiefe.** Ein Undo-Stapel über eine geteilte Datenbank ist eine Falle: zwei
Editoren, zwei Stapel, eine Wahrheit. Die Kette im Protokoll ist der Stapel — sie ist geteilt, sie
ist dauerhaft, und sie überlebt einen Neustart.

### 4.3 Im Fenster

Nach jedem Schreibvorgang steht in der Leiste, was es tat, **und daneben**:

> Auf die GA-Werte zurückgesetzt und gespeichert — 26 Werte geändert (…).  **[Rückgängig]**

- Weich/outline, nicht gefüllt — die Haupthandlung bleibt „Speichern".
- Sie verschwindet beim Neuladen des Fensters. ⚠️ Der Endpunkt nimmt trotzdem **immer** die
  jüngste Zeile, nicht die aus der Anzeige: sonst nähme ein Klick auf einem alten Bildschirm etwas
  zurück, das inzwischen jemand anders geschrieben hat.
- 🔴 Zeigt das Protokoll eine **fremde** jüngste Zeile (anderer Benutzer, andere Sitzung), sagt der
  Knopf das, statt sie stillschweigend zurückzunehmen: *„Zuletzt hat <Name> geschrieben — dessen
  Änderung zurücknehmen?"*

---

## 5. Vier Fallen, die beim Bauen greifen werden

1. 💣 **Ein leeres `before_json` ist kein Vorzustand, sondern eine Lücke.** Zeilen aus der Zeit vor
   dieser Änderung tragen nur das Raster. Der Endpunkt muss sie **erkennen und ablehnen**
   („diese Änderung ist zu alt zum Zurücknehmen"), nicht teilweise anwenden.
2. 💣 **Die Landschaften liegen in einer anderen Tabelle als das Raster.** Ein Undo, das nur
   `app_setting` zurückschreibt, lässt `terrain_speed_factor` stehen — und beim Landschaften-
   Rücksetzer ist das *der ganze* Vorgang. Beide Hälften oder keine.
3. ⚠️ **`travel_values_stamp` muss mitwandern.** Er ist der Stempel, an dem der Routen-Endpunkt
   hängt; ein Undo, das ihn nicht hebt, sieht für jeden späteren Leser aus wie „nie passiert".
4. 💣 **Kein DDL zwischen `beginTransaction` und `commit`.** `avesmapsAppSettingSet` legt seine
   Tabelle an und ist damit DDL — der Handler hat heute keine Transaktion, und er soll auch keine
   bekommen, ohne dass jemand diese Zeile liest.

---

## 6. Was der Entwurf ausdrücklich NICHT vorschlägt

- **Kein Bestätigen-Dialog vor dem Rücksetzer.** Er wäre die vierte Rückfrage im Editor und wird
  nach zwei Wochen weggeklickt, ohne gelesen zu werden. Ein verlässliches Rückgängig ist die
  bessere Antwort auf dieselbe Angst.
- **Kein Undo für einzelne Zellen.** Die Zeile im Protokoll ist ein Schreibvorgang; eine Zelle
  daraus herauszulösen hieße, einen Zustand herzustellen, den es nie gab.
- **Kein Undo über mehrere Schritte in einem Klick.** Zweimal drücken ist zweimal nachdenken.

---

## 7. Aufwand, ehrlich geschätzt

| Teil | Umfang |
|---|---|
| Protokoll vollständig (§4.1) | klein — eine Funktion, ein Aufrufer |
| Aktion `undo` (§4.2) | mittel — der Schreibpfad existiert, neu ist das Lesen der jüngsten Zeile |
| Knopf + fremde Zeile (§4.3) | klein |
| Tests | die vier Fallen aus §5, jede einzeln |

⚠️ **Der erste Teil lohnt sich auch ohne den Rest.** Ein vollständiges `before_json` kostet wenig
und macht jeden Schreibvorgang nachvollziehbar — auch wenn nie jemand den Knopf baut.

---

## 8. Was der Owner entscheiden muss

1. **Ganz oder nur §4.1?** Das vollständige Protokoll allein ist billig und schon nützlich.
2. **Fremde Änderung zurücknehmen dürfen?** Der Vorschlag fragt nach. Alternative: gar nicht
   erlauben.
3. **Reicht die Kette im Protokoll**, oder soll ein Undo die zurückgenommene Zeile auch sichtbar
   machen (eine Liste „letzte Änderungen an den Tempowerten")? Die Daten lägen dafür bereit.
