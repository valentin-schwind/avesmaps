# Die Vektorkarte als semantische Quelle — Übergabe

**Stand:** 18.08.2026 · **Für:** eine Sitzung, die aus diesem Abzug Bildgenerierungs-Prompts baut

## Worum es geht

Avesmaps kann seine ganze Karte als **SVG** ausgeben — nicht als Bild, sondern als
Datenquelle. Jedes Element trägt maschinenlesbar, **was** es ist und **worin** es liegt.
Damit lässt sich ein Prompt bauen, der Wüste von Wald von Gebirge unterscheidet — und,
das ist der eigentliche Zweck, die Bewaldung nach Klima und Relief **variiert**:
tropischer Wald ist Dschungel und Palmen, borealer ist Nadelwald, ein Gebirge in der
Polarzone ist schneebedeckt.

## Wie man einen Abzug bekommt

`/edit/svg-export.php` (Admin). Häkchen **„Semantische Metadaten"** ist voreingestellt an.
Ebenen, Farben, Glättung und Ausgabegröße sind einstellbar; für eine Datenauswertung ist
nichts davon nötig. Ergebnis: 7–10 MB, rund 20.000 Elemente.

## Der Vertrag

Namensraum `xmlns:avm="https://avesmaps.de/ns/export/1"`. An **jedem** Element:

| Attribut | Bedeutung | Beispiele |
|---|---|---|
| `avm:kind` | Objektart | `landschaft`, `weg`, `ort`, `herrschaftsgebiet`, `kraftlinie` |
| `avm:type` | Gelände- bzw. Wegart | `wald`, `gebirge`, `wueste`, `Flussweg`, `metropole` |
| `avm:ebene` | Landschaftsebene | `vegetation`, `topographie`, `klima`, `derographisch` |
| `avm:klima` | Klimazone **am Ort** | `tropisch`, `boreal`, `gemaessigt`, … |
| `avm:relief` | Relief **am Ort** | `gebirge`, `huegelland`, `tal`, `hochebene`, … |
| `avm:hoehe` | höchster Gipfel im Relief, Meter | `9000`, `3500` |
| `avm:name` | Eigenname | `Amdeggynmassiv` |

Im Kopf, in `<desc id="avm-vokabular">`, liegt **JSON**:

- `typen` — jeder vorkommende Typ mit deutschem und englischem Begriff und Anzahl.
  Ein Typ ohne Beschreibung wird trotzdem geführt, markiert mit `unbeschrieben: true`.
- `kombinationen` — die tatsächlich vorkommenden Tupel aus Typ × Relief × Klima ×
  Gipfelhöhe mit Anzahl, absteigend.

**Die Datei erklärt jede Vokabel, die sie benutzt.** Ein Test erzwingt das.

## 🔴 Was NICHT drin ist

**Keine Deutung.** Was „Wald × tropisch" *bedeutet*, steht nicht in der Datei — das ist
Aufgabe des Prompt-Bauers (Owner-Entscheid 16.08.2026). Grund: sonst wäre die SVG ein
Art-Direction-Dokument, und jede Änderung an der Bildsprache verlangte einen neuen Export.
Die SVG liefert Tatsachen, ihr entscheidet, wie sie aussehen.

## Fallen

- 💣 **Die Kombinationsliste gilt nur für DIESEN Abzug.** Editoren ändern täglich etwas;
  sie wird bei jedem Export neu gezählt. Nie abschreiben, immer aus der Datei lesen.
- 💣 **`avm:relief` hängt am Mittelpunkt der Fläche.** Ein Wald, der halb über einem
  Gebirge liegt, dessen Mitte aber daneben, hat *kein* Relief. Systematische
  Unterschätzung bei großen Flächen.
- 💣 **`avm:hoehe` fehlt oft.** Live tragen 36 von 74 Gipfeln eine Höhe; Gebirge ohne
  benannten Gipfel liefern keine. Eine fehlende Angabe ist eine Lücke in den Kartendaten,
  kein Fehler des Exports — nicht auf 0 setzen.
- 💣 **`avm:klima` ist ein Breitenband.** Die Klimazonen sind Nord-Süd-Streifen; die
  Angabe ist exakt, aber sie sagt nichts über Höhenlage. Dafür ist `avm:hoehe` da.
- ⚠️ **Koordinaten sind bereits gespiegelt.** `viewBox="0 0 1024 1024"`, y wächst nach
  UNTEN (SVG-Konvention). Die Kartendaten haben y nach OBEN. Wer Positionen zurück in
  Avesmaps-Koordinaten rechnet, braucht `y_karte = 1024 − y_svg`.
- ⚠️ **Zwei Dialekte.** `illustrator` und `inkscape` unterscheiden sich nur in der
  Benennung (`id` gegen `inkscape:label`); die `avm:`-Attribute sind in beiden gleich.
  Für eine Auswertung ist es egal, welchen man nimmt.
- ⚠️ **Die Datei ist groß.** Einmal parsen (SAX/Streaming), nicht mehrfach mit regulären
  Ausdrücken über 10 MB laufen.

## Ein Element, wie es wirklich aussieht

```svg
<path id="Flaeche-071-d8a1f406-…" inkscape:label="Fläche-071"
      avm:kind="landschaft" avm:type="wald" avm:ebene="vegetation"
      avm:klima="subtropen_winterfeucht" avm:relief="gebirge" avm:hoehe="9000"
      d="…"><title>Fläche-071</title></path>
```

Gelesen: ein Waldstück in einem Gebirge mit 9.000-Meter-Gipfeln, in den
winterfeuchten Subtropen. Was daraus im Bild wird, entscheidet ihr.

## Wo der Code liegt

`js/pages/svg-export-build.js` (reiner Bauer, ohne DOM — dort steht das Vokabular und die
Kontextrechnung), `js/pages/svg-export-page.js` (Kitt), `edit/svg-export.php` (Seite).
Tests: `js/pages/__tests__/svg-export-build.test.js`.
