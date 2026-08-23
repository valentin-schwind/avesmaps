# Die Vektorkarte als semantische Quelle — Übergabe

**Stand:** 22.08.2026 · **Für:** eine Sitzung, die aus diesem Abzug Bildgenerierungs-Prompts baut

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

## Wie eine MASCHINE einen Abzug bekommt (seit 23.08.2026)

Ohne Browser-Login, ohne Admin-Cookie:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $AVESMAPS_SVG_API_TOKEN" \
  -o avesmaps-latest.svg \
  https://avesmaps.de/api/svg-export.php
```

Geliefert wird der **jeweils neueste** Abzug: Inkscape-Dialekt, 32768 x 32768,
`viewBox="0 0 1024 1024"`, alle Ebenen, volle Semantik, nichts geglättet — also genau die
Einstellung, die für eine Auswertung gebraucht wird.

Die Fassungsstempel stehen auch als Kopfzeilen, man muss die 8 MB also nicht parsen, um zu
wissen, ob sich etwas geändert hat: `X-Avesmaps-Kartenfassung`,
`X-Avesmaps-Landschaftsfassung`, `X-Avesmaps-Exported-At`, `X-Avesmaps-Quelle`.

💣 **Prüfsumme: `X-Avesmaps-SHA256`, nicht der `ETag`.** Gemessen 23.08.2026: vor STRATO sitzt
etwas, das die Antwort umschreibt (`Vary: X-Forwarded-For,…`) und dabei `ETag` **und**
`Content-Length` verwirft — die Antwort kommt `chunked` an. Das trifft jede PHP-Antwort dieses
Projekts, nicht nur diese. Eigene `X-`Kopfzeilen überleben, deshalb reist derselbe sha256 dort
ein zweites Mal mit (ohne Anführungszeichen, aus demselben Wert abgeleitet).
⚠️ Auch `Content-Length` fehlt dann — wer einen Fortschrittsbalken baut, hat keine Gesamtgröße.
⭐ **`If-None-Match` nimmt BEIDE Formen** — den ETag in Anführungszeichen und den blanken
sha256 aus `X-Avesmaps-SHA256`. Schick einfach den Wert zurück, den du bekommen hast; ein
unveränderter Abzug antwortet dann `304` und wird gar nicht erst übertragen.

- `401 unauthorized` — Token fehlt **oder** ist falsch (von außen nicht zu unterscheiden)
- `404 export_not_available` — es liegt noch kein Abzug bereit
- `503 export_not_configured` — der Schlüssel fehlt **auf dem Server**

⚠️ **Der Abzug der Routine ist bis zu 24 h alt** (der Owner kann jederzeit einen frischen
hinterlegen). Er entsteht nachts um 03:17 UTC in der CI, nicht beim
Abruf — und das ist Absicht: der Bauer ist JavaScript, ihn in PHP nachzubauen wäre eine
zweite Wahrheit über das Kartenbild (AGENTS.md §5) und ~21 MB JSON je Abruf auf einem
Shared Hosting. Wer taggenau sein muss, vergleicht `avm:kartenfassung` mit `revision` aus
`/api/app/map-features.php`.

🔑 Den Token setzt der Owner in `api/config.local.php` unter `svg_export.token` — dort, wo
die Token dieses Projekts gesammelt sind. Er kann **nur** diesen einen Export lesen, sonst
nichts; Hinterlegen braucht einen **anderen** (`svg_export.deposit_token`). Er gehört nie in
eine Adresse (Serverprotokoll, Referrer, Browserverlauf) — der Endpunkt liest ausschließlich
den `Authorization`-Kopf und weist einen Token als URL-Parameter ab.

⚠️ **Es gibt ZWEI Erzeuger, und `X-Avesmaps-Quelle` sagt welcher** — `routine` (nächtlich)
oder `manuell` (der Owner hat ihn sofort angestoßen). 🔴 **Beide bauen mit denselben
Einstellungen**: inkscape, 32768², alle Ebenen, volle Semantik, nichts geglättet. Bei gleichem
Datenstand sind die beiden Dateien deshalb byte-identisch; die Angabe ist Herkunft, keine
Warnung über die Geometrie.
## Der Vertrag

Namensraum `xmlns:avm="https://avesmaps.de/ns/export/1"`. An jedem Element (⚠️ `avm:ebene` nur an Flächen, 904 von 10.084):

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
Tests: `js/pages/__tests__/svg-export-build.test.js` und
`js/pages/__tests__/svg-export-ortsgroessen.test.js` (der Maßstab der Ortszirkel — die
einzige Stelle, an der Bauer und Zoombänder-Tafel zusammenkommen).

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

`avm:radius` in viewBox-Einheiten. ⚠️ **Darstellungsradius, keine gemessene Stadtausdehnung** —
Avesmaps speichert Orte als Punkte; niemand hat je die Fläche von Gareth erhoben.
Metropole 0,2078 · Großstadt 0,1559 · Stadt 0,1247 · Kleinstadt 0,097 · Dorf 0,0693 ·
Gebäude 0,0485. Eine unbekannte Ortsklasse bekommt 0,08.

🔴 **Seit 22.08.2026 hat die Zahl einen MASSSTAB, und er ist eine andere Größenordnung
als vorher.** Sie ist jetzt die Größe, die die Karte dem Ort auf ihrer höchsten Zoomstufe
gibt (Zoombänder-Tafel bei z7, umgerechnet über `2^7` Bildpunkte je Karteneinheit) — davor
waren es sechs gegriffene Zahlen (2,2 … 0,6), unter denen eine Metropole **13,2 Meilen**
breit war und ein Dorf 4,2. Bei 1 Karteneinheit = 3 Meilen ergibt das jetzt: Metropole
1,25 Meilen (rund 2,0 km), Dorf 0,42 (rund 670 m). **Wer die alten Radien in einem
Prompt oder Renderer verankert hat, muss nachziehen — die Faktoren sind rund 1/10.**

⚠️ Verstellt ein Admin die Zoombänder, wandert diese Zahl mit; sie gilt wie `avm:breite`
für **diesen** Abzug. Bleibt die Serverantwort aus, greift dieselbe Tafel als Vorgabe —
der Maßstab ist derselbe, nur ohne Übersteuerung.

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

---

## Nachtrag 2 — nach der Messung der Bild-Pipeline (18.08.2026)

Sie hat den Abzug gegen den 32k-Render gehalten. Was dabei herauskam, steht hier, weil
es nirgends sonst nachlesbar wäre.

### Bestätigt

Die Geometrie ist deckungsgleich: **IoU 96,3 %** unter der Meermaske, 99,95 % aller
meerfarbenen Rasterpixel liegen in den Polygonen, die 32-px-Kette stimmt **ohne**
Korrekturfaktor. Die Zählungen im Kopf-JSON: 0 von 47 Typen weichen ab.

### 🔴 Malreihenfolge ist fürs BILD — für die Auswertung Ebenen getrennt halten

Gemessen: **29,4 % der Waldfläche wird von Topographie überdeckt**, 18,3 Punkte davon
von Gebirge; Sümpfe 30,1 %, Steppe 40,4 %. Wer die Ebenen zur Malreihenfolge flachrechnet,
verliert ein Drittel des Waldes — ausgerechnet den **Bergwald**, also genau die
Kombination, für die dieser Export gemacht ist.

Die Dokumentordnung sagt, was oben liegt. Sie sagt **nicht**, was da ist. Für eine
Label-Karte gehören die Ebenen getrennt ausgewertet, nicht übereinandergestempelt.

### Flussbreite: der Kern ist ein Drittel

`avm:breite` ist die **Kernbreite** (Flussweg 0,094 = 3 px). Der Kachel-Renderer zieht
4 px Kern und mit dem hellen Mantel **8 px** — Faktor 2,7. Neu ist deshalb
`avm:mantel_breite`, immer angegeben, auch wenn keine Kontur gezeichnet wird.
💣 **Sie ist die Mantelbreite der LEAFLET-Karte (5 px), nicht die des Kachel-Renderers
(8 px).** Zwei Renderer, zwei Breiten. Wer sie gleichsetzt, irrt um 60 %.

### Klimabänder: die Korrektur war zu streng

Die *Hüllboxen* überlappen — das bleibt richtig. Die **Polygone** sind aber praktisch
eine Partition: 96,49 % der Karte in genau einer Zone, 3,46 % in zweien, 0,05 % in
dreien; 2.832 von 2.847 Orten tragen das Klima ihrer Zone. **Als exakte Einordnung
taugen sie.** Der Vorfilter über `klimabaender` bleibt trotzdem sinnvoll.

### Der Export kennt mehr Orte als die Karte zeigt

Der Renderer zeichnet **63 % der Ortspunkte nicht** — gestaffelt nach Größe: Metropole
0 %, Großstadt 3 %, Stadt 30 %, Kleinstadt 35 %, Dorf 70 %, Gebäude 82 %. Das ist eine
Darstellungsschwelle (Zoombänder), kein Fassungsversatz. ⚠️ **Export und Renderer haben
verschiedene Auswahlregeln** — der Export liefert *alle* Orte, ungefiltert.

💣 **Das bleibt so, obwohl der Export seit 22.08.2026 aus derselben Tafel liest.** Die
Zoombänder sagen zweierlei: **ab wann** ein Ort erscheint und **wie groß** er dann ist.
Der Export übernimmt nur das Zweite. Die Erscheinungsstufe zu übernehmen hieße, aus einer
Datenquelle ein Kartenbild zu machen — und ein Häkchen „Dörfer" würde nichts mehr
liefern. Wer eine Auswahl wie die Karte will, filtert selbst über `avm:type`.

### Behoben

- 💣 **Doppelte ids bei den Passmarken.** Sie standen sechsmal mit denselben vier ids in
  der Datei. Jetzt trägt jede die Kennung ihrer Ebene (`layer-orte-passmarke-1`).
  Der Eindeutigkeitstest lief an einem Dokument *ohne* Passmarken — ein Test, der den
  Schalter nicht setzt, prüft ihn nicht.
- `avm:ebene` sitzt an **904 von 10.084** Elementen, nicht an jedem: nur Flächen haben
  eine Landschaftsebene. Die Beschreibung sagt das jetzt.

### Offen, und nicht auf dieser Seite lösbar

- **Der PNG-Renderer trägt keinen Fassungsstempel.** Ein Stempel, den nur eine Seite
  trägt, beantwortet die Frage halb. Die Revisionen liegen im SVG-Kopf; sie müssten
  dort ebenso ins Bild oder daneben.
- **Markerfarbe:** SVG `#e33b35`, Renderer `[241,75,83]` = `#f14b53`. Zwei Töne für
  dieselbe Sache; welcher gilt, ist eine Frage an den Renderer.
- **Nur 72,1 % der gezeichneten Markerfläche** liegt in einem SVG-Ortskreis, bei
  vierfachem Radius sättigt es bei 79,9 %. Ohne Stempel auf beiden Seiten nicht
  entscheidbar, ob das Versatz ist oder der Renderer noch etwas anderes in Markerrot malt.
