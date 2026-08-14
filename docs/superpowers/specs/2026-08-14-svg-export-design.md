# Karte als SVG herunterladen

**Stand:** 14.08.2026 · **Zustand:** Entwurf, noch nicht gebaut

Wege, Grenzen und Siedlungspositionen sind heute nur über die API erreichbar —
wer sie als Grafik will, muss sich die Endpunkte selbst zusammensuchen und die
Geometrie selbst zeichnen. Dieser Entwurf gibt Admins einen Knopf, der die ganze
Karte als **bearbeitbare Vektorgrafik** ausgibt: Ebenen als Gruppen, jedes
Element benannt, geöffnet in Illustrator oder Inkscape sofort weiterverwendbar.

Zweck ist ausdrücklich das **Gestalten** — ein Poster, eine gedruckte Karte, eine
eigene Fassung —, nicht der Datenaustausch. Wer Daten will, nimmt weiter die API.

---

## 1 · Wo der Knopf sitzt

In der Kopfleiste der Edit-Shell (`edit/index.php`), hinter dem
Datenbank-Backup, mit demselben Riegel und demselben Hinweis:

```
📖 Handbuch    💾 Datenbank-Backup [nur Admins]    ↧ Karte als SVG [nur Admins]    [Abmelden]
```

Gate `avesmapsUserCan($currentUser, 'admin')` im PHP **und** im Endpunkt der
Seite — derselbe Zweiklang wie beim Backup. Der Marker `nur Admins`
(`css/components/scope-hint.css`) sagt es laut, weil ein Editor den Eintrag gar
nicht sieht und ein Admin daneben sonst nicht wüsste, was dem anderen fehlt.

> ⚠️ **Ein monochromes Zeichen, kein drittes Emoji.** Die Hausregel seit dem
> 13.08.2026 sind monochrome Zeichen für Editorwerkzeuge; die zwei Emoji in
> dieser Leiste (📖, 💾) stehen dort als **offener Punkt**, weil der gemeinsame
> Satz kein Zeichen für „Handbuch" und „Backup" hat und man dafür Vokabular
> erfinden müsste. Für „herunterladen" muss man nichts erfinden — der Pfeil nach
> unten ist da. `↧` (U+21A7) statt ⬇️, damit die Leiste nicht ein drittes Mal
> bunt wird.

## 2 · Die Seite

`edit/svg-export.php`, in einem neuen Reiter geöffnet — Bauart und Riegel von
`edit/backup.php` abgeschaut.

Inhalt: eine Ankreuzliste der acht Ebenen (**alles vorangehäkelt**), darunter
ein Knopf „SVG erzeugen" und eine Statuszeile. Kein Fortschrittsbalken mit
Serverlauf wie beim Backup — hier rechnet der Browser, und der Weg ist kurz
genug für eine Zeile Text.

**Nur holen, was angekreuzt ist.** Ist „Landschaften & Küste" abgewählt, wird
`ecosystem-areas.php` gar nicht erst gerufen.

> ⚠️ `political-territories.php?action=layer` ist ein bekannter Perf-Brennpunkt
> (AGENTS.md §10: DDL + Metadaten-Proben vor dem Cache-Lesen, N+1 über die
> Gebietstabelle). **Eine** Anfrage, nie in einer Schleife — CLAUDE.md, und der
> Grund dafür ist ein echter Ausfall gewesen.

## 3 · Was in der Datei steht

Acht Ebenen, in genau dieser Reihenfolge. In SVG liegt das Erste **unten**:

| # | Ebene | Untergruppen | Quelle |
|---|---|---|---|
| 1 | Landschaften & Küste | Derographisch · Vegetation · Topographie · Klima | `ecosystem-areas.php?kind=…` |
| 2 | Regionen | — | `map-features.php` |
| 3 | Herrschaftsgebiete | nach Rang | `political-territories.php?action=layer` |
| 4 | Flüsse | — | `map-features.php` |
| 5 | Wege | Reichsstraße · Straße · Pfad · Gebirgspass · Wüstenpfad · Flussweg · Seeweg | `map-features.php` |
| 6 | Kraftlinien | — | `map-features.php` |
| 7 | Orte | Metropole · Großstadt · Stadt · Kleinstadt · Dorf · Gebäude | `map-features.php` |
| 8 | Beschriftungen | Orte · Wege · Gebiete · Regionen | `map-features.php` |

**Die Untergruppen sind der eigentliche Nutzen.** Eine Farbe zu ändern trifft
dann *alle Reichsstraßen* — nicht 462 einzeln angefasste Linien. Deshalb hängt
der Stil an der Gruppe und **nie** am Einzelelement.

**Ebene 1 und Ebene 2 sind zwei verschiedene Dinge**, trotz ähnlicher Namen:
„Landschaften" sind die Flächen der Landschaften-Ebene (`ecosystem_region` —
Kontinente, Meere, Wälder, Klimazonen), „Regionen" ist die klassische
Regionen-Ebene aus `map_features`. Sie kommen aus zwei Tabellen und zwei
Endpunkten und bleiben deshalb zwei Gruppen.

**Landmasse und Küste kommen aus Ebene 1.** Die Landschaften-Ebene führt
`kontinent`, `insel`, `meer`, `see` und `kueste` als Flächen — ohne sie schweben
Wege und Orte im Leeren. (Dieselben Typen, aus denen die Landprüfung von
„Hierher reisen" ihre Antwort zieht; siehe `api/_internal/routing/land-areas.php`.)

**Nicht dabei: Kreuzungen.** Das sind Routing-Knoten mit Namen wie
`Kreuzung-1873` — kartografisch nichts, und ihre Geometrie steckt ohnehin in den
Wegen.

## 4 · Wie die Elemente heißen

Jedes Element trägt **drei** Namensträger, weil die beiden Zielprogramme
verschiedene lesen:

```svg
<g inkscape:groupmode="layer" inkscape:label="Wege" id="layer-wege">
  <g inkscape:label="Reichsstraße" id="wege-reichsstrasse"
     stroke="…" stroke-width="1.4" fill="none">
    <path id="weg-reichsstrasse-gareth-wehrheim-p1042"
          inkscape:label="Reichsstraße Gareth–Wehrheim"
          d="…"><title>Reichsstraße Gareth–Wehrheim</title></path>
```

| Träger | wer liest ihn | Form |
|---|---|---|
| `id` | Illustrator (als Objektname), SVG selbst (für `<textPath href>`) | reines ASCII, eindeutig, mit angehängter öffentlicher Kennung |
| `inkscape:label` | Inkscape (als Objektname) | der echte Name, mit Umlauten |
| `<title>` | alles andere, Browser-Tooltip, Barrierefreiheit | der echte Name |

Die Ebenengruppen tragen zusätzlich `inkscape:groupmode="layer"` — das ist es,
was Inkscape aus einer Gruppe eine **Ebene** macht. Illustrator liest die oberste
Gruppenebene ohnehin als Ebene.

> 💣 **Die ASCII-Faltung hier ist NICHT die `wiki_key`-Faltung.** Die
> (`avesmapsFoldToAscii`, `api/_internal/text/ascii-fold.php`) bildet den Server
> nach: Umlaute verlieren ihren Grundbuchstaben, `Fürstentum Kosch` wird
> `f-rstentum-kosch`. Sie darf laut AGENTS.md §5 nie „schöner" gemacht werden,
> weil jede Änderung eine Datenmigration über ~10 Tabellen ist. Hier entsteht ein
> **neuer, eigener Namensraum**, der nirgends joint und nie in eine Zeile
> geschrieben wird — also normal falten (`ü` → `ue`) und die öffentliche Kennung
> anhängen, damit zwei gleichnamige Orte zwei `id` bekommen. Das gehört als
> Kommentar an die Funktion, sonst greift der Nächste nach der falschen.

## 5 · Beschriftungen

Echter Text, kein Pfad. Ortsnamen als `<text>` am Ankerpunkt, Wegnamen über
SVGs eigenen Mechanismus:

```svg
<textPath href="#weg-reichsstrasse-gareth-wehrheim-p1042">Reichsstraße Gareth–Wehrheim</textPath>
```

Das ist der Grund, warum die Wege-`id` stabil und ASCII sein muss: die
Beschriftungsebene zeigt darauf. Beide Programme können `<textPath>`.

> ⚠️ **Exportiert werden ALLE Namen** — auch die, die die Karte gerade wegen
> Kollision versteckt. „Wie die Karte aussieht" hat für Beschriftungen keine
> einzelne Antwort: welche sichtbar sind, hängt an der Zoomstufe und am
> Kollisionslöser. Wer gestaltet, will alle haben und löscht selbst. Die
> gekrümmte Führung entlang des Weges übernimmt `<textPath>`; die
> Kollisionsauflösung der Karte wird **nicht** nachgebaut.

## 6 · Wie es aussieht

Wie die Karte. Wer die Datei öffnet, soll Avesmaps sehen und nicht bei Null
anfangen.

**Farben kommen aus `css/base/tokens.css`** — die Seite lädt die Token-Datei und
liest die Werte zur Laufzeit per `getComputedStyle` aus. Damit gibt es **keinen
zweiten Farbsatz**; ändert sich ein Token, ändert sich der Export mit. Das ist
AGENTS.md §12 wörtlich: nie eine Farbe hartkodieren.

> ⚠️ **Gelesen wird im Kitt, nicht im Bauer.** `getComputedStyle` braucht ein
> DOM, und der Bauer hat per Vertrag keins (§8). Also liest
> `svg-export-page.js` die Token einmal aus und **reicht die fertige Farbtafel
> als Parameter** in den Bauer. Das ist zugleich, was den Test einfach macht: er
> gibt eine erfundene Tafel hinein und prüft, dass sie an den Gruppen landet.

**Linienstärken sind die eine Ausnahme** und brauchen eine kleine eigene
Tabelle: die echten Stärken der Karte kommen aus der Zoomstufe, und eine
Vektordatei hat keine. Also ein Satz fester Werte für 1024 Einheiten
Kantenlänge — an **einer** Stelle im reinen Bauer, als benannte Konstante, nicht
verteilt über die Ebenen.

## 7 · Koordinaten

> 💣 **Die Falle, die alles still um 1024 verschiebt.** GeoJSON speichert
> `[x, y]`; Leaflets `L.CRS.Simple` rechnet `[lat, lng] = [y, x]` und lässt lat
> **nach oben** wachsen — deshalb tragen die Kacheldateien negative y
> (`map_x_-y`, AGENTS.md §10). SVG lässt y **nach unten** wachsen.

```
svg_x = x
svg_y = 1024 − y          (IMG_HEIGHT aus js/config.js)
```

`viewBox="0 0 1024 1024"`.

**Prüfbefehl vor dem ersten Zeichnen:** einen Ort im hohen Norden und einen im
tiefen Süden aus dem Payload greifen und bestätigen, dass der **nördliche das
größere `y`** trägt. Stimmt das nicht, steht die Karte auf dem Kopf — und das
sieht man einer 30-MB-Datei nicht an, bevor sie in einem Programm offen ist.

## 8 · Bauteile

| Datei | Aufgabe |
|---|---|
| `edit/svg-export.php` | Seite, Admin-Riegel, Ankreuzliste. Handgestempeltes `?v=` |
| `css/pages/svg-export.css` | Stil, ausschließlich Token |
| `js/pages/svg-export-build.js` | **Reiner Bauer:** Payloads + Auswahl → Liste von Textstücken. Kein DOM, kein `fetch`, kein `document` |
| `js/pages/svg-export-page.js` | Der Kitt: holen, Fortschritt, Blob, Download |
| `js/pages/__tests__/svg-export-build.test.js` | Node-Test gegen den reinen Bauer |

**Der Schnitt zwischen Bauer und Kitt ist der Punkt, an dem das Ding prüfbar
wird.** Eine reine Funktion ohne Browser braucht im Test kein DOM und keine
Netzwerkattrappe — sie bekommt einen erfundenen Payload und gibt Text zurück.

> 💣 **Der `?v=`-Stempel muss von Hand kommen.** Der Deploy stempelt alles, was
> von `index.html` oder `html/*.html` erreichbar ist — eine `.php`-Seite unter
> `/edit/` erreicht er **nie**. `edit/backup.php` macht es deshalb genauso
> (`css/pages/db-backup.css?v=20260729-backup`). Das ist AGENTS.md §7 Regel 3,
> die eine Ausnahme vom Verbot handgeschriebener `?v=`. Ohne sie serviert der
> Browser Admins nach jeder Änderung das alte Skript.

`edit`, `js` und `css` stehen alle im Deploy-Allowlist
(`.github/workflows/deploy-avesmaps-strato.yml`) — es braucht keinen neuen
Eintrag.

## 9 · Ablauf

1. Ankreuzen, „SVG erzeugen" drücken.
2. Die Seite holt **nur** die Endpunkte der angekreuzten Ebenen.
3. Der Bauer arbeitet **Ebene für Ebene**, dazwischen ein Atemzug an den Browser
   (`await new Promise(r => setTimeout(r))`), damit die Statuszeile mitläuft
   statt einzufrieren: „Wege … 3.721 von 3.721".
4. `new Blob(teile)` aus der Stückliste — **nie** ein einziger 30-MB-String durch
   Aneinanderhängen.
5. Download über `URL.createObjectURL` und `<a download>`, Dateiname
   `avesmaps-karte-JJJJ-MM-TT.svg`, danach `revokeObjectURL`.

## 10 · Größe

Der Kartendaten-Payload allein ist 21 MB JSON, die Landschaftsflächen sind die
eckenreichsten Formen im Bestand. Die volle Datei landet grob bei **20–40 MB**.

**Koordinaten auf zwei Nachkommastellen.** Bei 1024 Einheiten Kantenlänge ist das
ein Hundertstel Bildpunkt — unsichtbar, und es halbiert die Datei grob.

**Die Geometrie wird nicht vereinfacht.** Das ist eine bearbeitbare Karte, keine
Vorschau; wer vereinfachen will, tut das im Grafikprogramm mit dem Regler, den
er dafür hat. Wem die Datei zu groß ist, der kreuzt Ebenen ab — genau dafür
gibt es die Liste.

## 11 · Recht

Die Datei trägt `<metadata>` und `<desc>` mit Projektname, Quell-URL und der
**Kartenpaket-Lizenz** aus `NOTICE.md`. Dieselbe Regel wie in `fb763021`: die
Lizenz reist mit. Eine SVG geht nach draußen — sie muss ohne die Website
erklären können, woher sie kommt und was damit erlaubt ist.

## 12 · Abnahme

**Der Test** (am kleinen, erfundenen Payload):

- alle acht Ebenengruppen vorhanden, in der richtigen Reihenfolge
- jede `id` eindeutig und reines ASCII
- `inkscape:label` trägt die Umlaute unversehrt
- der bekannte Punkt landet nach der Spiegelung, wo er hingehört
- `<metadata>` führt die Lizenz
- eine **abgewählte** Ebene erzeugt keine Gruppe
- `<textPath href>` zeigt auf eine `id`, die in der Datei wirklich existiert

> 💣 **Vor dem Push das GANZE Testfeld, nicht nur dieses.** Ein roter Test lädt
> **nichts** hoch — und der Fehlschlag vergiftet danach den `?v=`-Stempel, weil
> der nächste grüne Lauf die nie hochgeladenen Dateien für aktuell hält
> (AGENTS.md §9). Der Lauf ist der aus dem Workflow:
> `for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done`

**Die echten Handgriffe** — ein grüner Test ist kein Beleg, dass die Datei
etwas taugt (AGENTS.md §9, „Abnahme heißt ABLAUF"):

1. Datei erzeugen, herunterladen.
2. In **Inkscape** öffnen: acht Ebenen im Ebenenfenster, Namen lesbar,
   Umlaute nicht zerschossen.
3. In **Illustrator** öffnen (falls verfügbar): Objektnamen da, Gruppen als
   Ebenen erkannt.
4. Karte **richtig herum** — Norden oben.
5. Eine Gruppe anfassen: eine Farbänderung trifft alle Reichsstraßen auf einmal.
6. Eine Ebene abwählen, neu erzeugen, prüfen dass sie fehlt und die Datei
   kleiner ist.

⚠️ Steht kein Illustrator zur Verfügung, wird das als **offene Frage gemeldet**,
nicht als bestanden.

## 13 · Was ausdrücklich nicht gebaut wird

- **kein Ausschnitt** — immer die ganze Welt; Zuschneiden an der Kante ist ein
  eigenes Problem und im Grafikprogramm eine Maske
- **kein serverseitiger Lauf** — PHP müsste das Aussehen der Karte ein zweites
  Mal festlegen (die Divergenz, gegen die §12 geschrieben ist), und ein 40-MB-
  String im PHP-Speicher auf STRATO ist genau die Falle aus CLAUDE.md
- **kein zweiter, neutraler Stil** — zwei Stilpfade laufen auseinander
- **kein Knopf auf der öffentlichen Karte** — das wäre eine sichtbare Änderung
  für jeden Besucher, für nichts
- **keine Kreuzungen, kein PNG, keine Geometrie-Vereinfachung**

## 14 · Handbuch

Die Änderung ist für Editoren sichtbar (ein neuer Eintrag in der Leiste, auch
wenn nur Admins ihn sehen). Nach AGENTS.md §9 wird das Handbuch **nicht** in
diesem Zug angefasst — es gehört der nächtlichen Routine
`avesmaps-handbuch-pflege`. Die Pflicht hier ist eine Commit-Betreffzeile, die
die sichtbare Wirkung benennt, damit die Routine sie im `git log` findet.
