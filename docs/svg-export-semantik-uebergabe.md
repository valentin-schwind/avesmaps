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

---

## Nachtrag 18.08.2026 — für die Bild-Pipeline

Auf Rückfragen der Sitzung, die daraus SPADE-Label-Karten baut. Alles Folgende ist
gebaut und live.

### Fassungsstempel (die wichtigste Ergänzung)

Am Wurzelelement:

```
avm:kartenfassung="76178"        map-features.php, revision
avm:landschaftsfassung="21358"   ecosystem-areas.php, revision
avm:exportiert="2026-08-18T…Z"
avm:einheit_px="32"              Pixel je viewBox-Einheit bei der gewählten Größe
avm:geglaettet="nein"            Linien
avm:flaechen_geglaettet="nein"   Flächen
```

🔴 **Vektor und Raster gelten nur zusammen, wenn beide dieselbe `revision` tragen.**
Die Zahlen kommen aus den Endpunkten, nicht aus einer Uhr.

### Stabile Kennung

`avm:id` ist die `public_id` der Datenbank. Sie überlebt Umbenennung und Neuexport —
die XML-`id` nicht, die trägt den Namen, damit Illustrator und Inkscape etwas Lesbares
zeigen. Für Abzugsvergleiche also **immer `avm:id`**.

### Gezeichnete Breite

Wege tragen `avm:breite` (und `avm:kontur_breite`, wenn eine Kontur gezeichnet wird) in
viewBox-Einheiten. ⚠️ Das ist die Breite **dieses** Abzugs; sie folgt dem
Linienstärke-Regler. In Pixeln: `avm:breite × avm:einheit_px`.

### Orte

`avm:radius` in viewBox-Einheiten. ⚠️ **Darstellungsradius, keine Stadtausdehnung** —
Avesmaps speichert Orte als Punkte. Metropole 2,2 · Großstadt 1,7 · Stadt 1,3 ·
Kleinstadt 1,0 · Dorf 0,7 · Gebäude 0,6.

### Wasser

Kein eigenes `kind` — Wasser sind Flächen der Ebene `topographie` mit
`avm:type` ∈ `meer`, `see`, `kueste`, `flussdelta`, plus die Linien `Flussweg` und
`Seeweg` unter `kind="weg"`. 🔴 **Die Flüsse liegen UNTER den Wasserflächen** (eigene
Zeichenreihenfolge, siehe unten), damit ein Fluss im See verschwindet statt ihn zu queren.

### Klimabänder

`klimabaender` im Vokabular gibt je Zone `y_von`/`y_bis`. 💣 **Das sind Hüllboxen und sie
überlappen sich kräftig** (gemessen: polar 0…141, subpolar 102…290, boreal 145…408) — die
Trennlinien dürfen zurücklaufen. Als **Vorfilter** brauchbar, zur Einordnung nicht.
⭐ Exakt geht es trotzdem: die Bandpolygone liegen selbst in der Datei
(`avm:ebene="klima"`), punktgenau verschneidbar.

### Malreihenfolge

`reihenfolge` im Vokabular sagt es zu: **Dokumentordnung**, was später steht liegt oben.
Keine z-Angabe, keine Sortierung, die das überstimmt.

### Matrix jetzt nach Fläche

`kombinationen` trägt `anzahl` **und** `flaeche` (viewBox-Einheiten²) und ist nach Fläche
sortiert — 500 Waldflecken und 3 Waldmeere zählen gleich, wirken aber nicht gleich.

### Zur Zentroid-Falle bei `avm:relief`

Sie entschärft sich von selbst: **die Topographie-Polygone werden mitexportiert**
(`avm:ebene="topographie"`, Typen `gebirge`, `huegelland`, `tal`, `hochebene`, `tiefebene`,
`schlucht`, `wadi`). `avm:relief` ist Bequemlichkeit; wer genau sein will, verschneidet selbst.

### Was NICHT geliefert wird

- **Kein Datenhash über die Kartendaten.** Es gibt nur die `revision`-Zähler. Ein Hash,
  der zum PNG-Renderer passt, müsste dort erst gestempelt werden — das ist eine Änderung
  am Renderer, nicht am Export.
- **Keine echte Ortsausdehnung.** Existiert in den Daten nicht.
- **Keine Flussbreite aus dem PNG-Renderer.** `avm:breite` ist die Breite des SVG-Abzugs.
  Ob der Raster-Renderer dieselbe zieht, ist ungeprüft — das gehört gemessen, bevor
  jemand Label und Bild zur Deckung bringt.
