# Territorien per Kartenklick wählen — „Grenze aus Territorien" (Fall #68)

**Stand:** 2026-08-14 · Owner-Freigabe am Mockup 2026-08-14
**Betrifft:** `js/map-features/map-features-ecosystem-territory-import.js` (Kern),
`js/map-features/map-features-ecosystem-rendering.js` (eine Zeile), `index.html`,
`css/features/ecosystem-layer.css`

## 1. Der Fall

> „Bei der Erstellung von Regionen aus Territoriumsgrenzen die Auswahl per Mausklick auf die
> Territorien auf der Karte ermöglichen. So dass man einfach per Klicken auf der Karte mehrere
> Territorien auswählen kann und diese nicht im Menü einzeln suchen muss." (Fall #68)

Heute öffnet der Dialog einen Baum aus ~945 Gebieten. **Ein** Gebiet ist vorausgewählt — das unter
dem Rechtsklick (`preselectTerritoryAt`). Jedes weitere muss im Baum gesucht werden.

## 2. Was gebaut wird

Drei Dinge, sonst nichts. **Suche und Baum bleiben unverändert** (Owner: „das Rad nicht neu
erfinden").

1. **Die Karte wird zum Auswahlwerkzeug, solange der Dialog offen ist.** Zeiger über ein Gebiet →
   es leuchtet auf und nennt seinen Namen. Klick → dazu. Nochmal Klick → wieder weg.
2. **Der Korb.** Unter dem Baum, direkt über Statuszeile und „Einfügen": ein Kärtchen je Wahl mit
   `×`, dazu „Leeren". Ohne ihn wären die Klicks in 945 Baumzeilen unauffindbar.
3. **Die Grenzen werden sichtbar.** Solange der Dialog offen ist, liegen die Territoriumsumrisse
   dünn über der Karte — im Landschaften-Editor ist von der politischen Ebene sonst nichts zu
   sehen, und ohne Linien wäre das Anklicken Blindfischen.

**Reihenfolge im Fenster** (Owner 2026-08-14): Ebene → suchen/Baum → Korb → Zahlen → Knöpfe. Das
Ergebnis steht direkt über dem Knopf, der es verbraucht.

## 3. Entscheidungen

### 3.1 Der Klick nimmt das TIEFSTE Gebiet, und nur dieses

Über der Baronie liegt das Fürstentum liegt das Reich. Genommen wird die Baronie — dieselbe Regel,
nach der `preselectTerritoryAt` seit 2026-07-28 vorbelegt. Wer das Fürstentum will, hakt es im Baum
an (ein Häkchen dort nimmt seinen Teilbaum mit) oder klickt eine Stelle ohne Kind darüber.

🔴 **Keine einstellbare Rangfolge.** Das ist dieselbe Frage, die die Landschaften-Zielwahl schon
einmal beantwortet hat: eine Prioritätenliste, die niemand bedient, ist eine Einstellung, die alle
falsch verstehen. Der Schwebe-Umriss zeigt VOR dem Klick, was er trifft — das ist die Auflösung.

### 3.2 Der Klick nimmt KEINEN Teilbaum mit, das Häkchen schon

Beim Häkchen im Baum heißt „nimm das Herzogtum" ausdrücklich auch seine Baronien
(`setImportRowChecked`). Auf der Karte lag unter dem Zeiger **ein** Gebiet, nicht seine
Untergliederung. Beide Regeln bleiben, wie sie sind; sie widersprechen sich nicht, weil sie
verschiedene Gesten sind.

Das Entfernen ist der Spiegel: `×` am Kärtchen und ein zweiter Klick auf der Karte nehmen das
Gebiet **samt seiner mitgewählten Nachfahren** wieder heraus — sonst bliebe ein Häkchen stehen, das
niemand gesetzt hat.

### 3.3 Der Korb zeigt WURZELN, nicht jede Zeile

Ein Häkchen an „Mittelreich" wählt ~400 Gebiete. 400 Kärtchen sind kein Korb, sondern eine zweite
Liste. Gezeigt wird deshalb nur, was **keinen gewählten Elternteil** hat; trägt eine Wurzel
gewählte Nachfahren, steht die Zahl leise dahinter: `Fürstentum Kosch +3`.

💣 **Die Kopfzahl bleibt die GESAMTZAHL** (`Gewählt (12)`), damit sie mit der Statuszeile
(`12 Gebiete · …`) übereinstimmt. Zwei verschiedene Zahlen für „wie viele habe ich gewählt" sind
genau der Widerspruch, den jemand als Fehler meldet. Die Summe über alle Kärtchen (1 + `+k`) ergibt
die Kopfzahl — die Anzeige erklärt sich damit selbst.

### 3.4 Der Klick muss die Karte überhaupt erreichen

💣 **Die Landschaftsflächen schlucken ihn sonst.** `map-features-ecosystem-rendering.js` ruft im
Klick-Handler jeder Fläche `L.DomEvent.stopPropagation` — und seit die Ebene fast lückenlos
gezeichnet ist, gibt es kaum noch freie Karte, auf der ein Klick daran vorbeikäme. Genau daran war
schon „Fläche verschieben" unbenutzbar.

Der Ausweg ist der **vorhandene** Erweiterungspunkt, keine zweite Bauart: neben
`AvesmapsEcosystemGeometryOps?.claimsMapClick?.()` tritt
`AvesmapsEcosystemTerritoryImport?.claimsMapClick?.()`. Wahr, solange der Dialog offen ist. Der
Handler steigt dann **ohne** `stop` aus, der Klick läuft weiter zu `map.on("click")`.

⚠️ Der Dialog hat keinen Schleier (`dialog-overlays.css`: `pointer-events: none` an der Hülle) —
diese Voraussetzung ist bereits erfüllt und darf nicht angetastet werden, sonst ist die ganze Geste
tot.

### 3.5 Die Umrisse: Leinwand, Ausschnitt, Deckel

💣 **Nicht als SVG.** 945 Gebiete mit politischer Vertex-Dichte als SVG-Pfade lassen das Schieben
ruckeln. Gezeichnet wird auf einer eigenen `L.canvas()`-Leinwand in `measurementPane`,
`interactive: false` — angeklickt wird nichts davon, die Trefferprüfung rechnet ohnehin gegen die
Geometrie.

Gezeichnet wird nur, was den **sichtbaren Ausschnitt** schneidet, gedeckelt auf
`IMPORT_OUTLINE_LIMIT = 400`, sortiert nach Umschließungs-Fläche absteigend. Wirkung: bei ganzer
Karte sieht man die Reiche, beim Hineinzoomen tauchen die Baronien auf, weil weniger im Ausschnitt
liegen. ⚠️ Der Deckel ist eine Kappung — er wird in der Hinweiszeile **gesagt**
(„… näher heranzoomen"), nicht verschwiegen.

### 3.6 Trefferprüfung: erst der Kasten, dann das Polygon

Bei jeder Zeigerbewegung gegen 945 Polygone zu rechnen ist zu teuer. Je Gebiet wird beim Laden
einmal die Umschließung gerechnet (`ecosystemGeometryBounds`); die Bewegung prüft zuerst den
Kasten und erst bei Treffer `pointInGeometry`. Zusätzlich fällt eine Bewegung auf dieselbe
Kartenstelle sofort durch.

## 4. Bauteile

| Ort | Was |
|---|---|
| `map-features-ecosystem-territory-import.js` | alles Neue: reine Rechnung, Karten-Haken, Umrisse, Korb |
| `map-features-ecosystem-rendering.js` | **eine** Zeile: `claimsMapClick` des Imports mit abfragen |
| `index.html` | Markup für Hinweiszeile, Korb-Kopf und Korb (zwischen Baum und Statuszeile) |
| `css/features/ecosystem-layer.css` | Kärtchen, Korb-Rahmen, Hinweiszeile |
| `__tests__/ecosystem-territory-import.test.js` | die reine Rechnung |

### Reine Funktionen (geprüft)

- `territoryImportHitAt(point, candidates)` → `publicId` des **tiefsten** Treffers oder `""`.
  `candidates` = `[{publicId, depth, bounds, geometry}]`.
- `territoryImportBasketEntries(rows, selection)` → `[{publicId, label, extra}]`, nur Wurzeln der
  Auswahl, `extra` = Zahl der mitgewählten Nachfahren.
- `territoryImportOutlineRows(candidates, view, limit)` → was gezeichnet wird, nach Fläche
  absteigend gedeckelt.

## 5. Was NICHT gebaut wird

- Keine Änderung an Suche, Baum, Häkchenlogik, Vereinigung, Runden, Einfügen.
- Kein zweiter Weg, Territorien zu laden — der Fächer über Zoom 0..6 bleibt, wie er ist, und läuft
  weiter höchstens einmal je Sitzung.
- Keine Rangfolge-Einstellung (§3.1), kein Mehrfachauswahl-Rahmen („Lasso"), kein Umschalten der
  Kartenansicht.

## 6. Abnahme (Handgriffe, keine Maßtabelle)

1. Im Editor mit Landschaften-Ebene rechtsklicken → „aus Territoriumsgrenze". Fenster geht auf,
   Umrisse liegen über der Karte.
2. Zeiger über ein Gebiet → Umriss leuchtet, Name steht daneben.
3. Klick → Kärtchen erscheint im Korb, Häkchen im Baum zieht mit, Vorschau und Statuszeile ziehen
   mit.
4. Zweiter Klick auf dasselbe Gebiet → weg, überall.
5. Drei weitere anklicken, eines über `×` entfernen, „Leeren" drücken.
6. Im Baum ein Fürstentum anhaken → **ein** Kärtchen mit `+n`, Kopfzahl = Statuszeilenzahl.
7. Karte schieben und zoomen, während das Fenster offen ist — nichts hakt, die Umrisse ziehen nach.
8. „Einfügen" → Fläche entsteht wie bisher, danach geht „Fläche vereinfachen" auf.
9. ESC schließt; Umrisse, Schwebe-Umriss und Namensschild sind weg.
