# Editor-Handbuch — Aufwertung & Aktualisierung

- **Datum:** 2026-07-20
- **Betrifft:** `html/editor-handbuch.html`
- **Vorgänger:** `docs/superpowers/specs/2026-07-07-editor-handbuch-design.md` (Erstbau)

## Ausgangslage

Das Handbuch bildete inhaltlich den Stand **~10.07.2026** ab. Seitdem ~690 Commits.
Drei Befunde machten aus „nachtragen" einen Umbau:

1. **Die Grundannahme stimmte nicht mehr.** Das Handbuch beschrieb durchgehend die
   Popup-Welt („Ein Klick auf die Siedlung öffnet ihr Popup"). Seit 17.07. landet
   ein Klick im **Infopanel**. Damit war der Einstieg fast jeder Anleitung falsch.
2. **Vier Subsysteme fehlten vollständig** (0 Treffer im Volltext): Siedlungseditor,
   Quellen, Abenteuer, Kartensammlung — dazu die Menübänder aller vier Sync-Editoren
   und der „Änderung vorschlagen"-Workflow.
3. **Ein echter Fehler, kein Veralten:** Die Orientierung behauptete, praktisch alle
   Bearbeitungen starteten im Rechtsklick-Menü. Tatsächlich gibt es genau **zwei**
   Kontextmenüs, und das Karten-Menü ist auf leerer Karte, Ort, Kreuzung, Label und
   Weg **identisch** — feature-spezifische Aktionen sitzen im Linksklick-Popup bzw.
   im Infopanel.

## Gliederung (vom Owner vorgegeben)

Sie spiegelt die echte Editor-Navigation: die fünf **Karten-Features** sind die
WikiSync-Reiter, die **Aufgaben** sind die Editor-Panel-Reiter.

```
Erste Schritte      Zugang · Die drei Flächen · Rollen · Goldene Regeln · Erster Durchlauf
Karten-Features     Siedlungen · Territorien · Regionen · Wege · Materialien
                                                          └ Abenteuer · Kartensammlungen
Aufgaben            Bug-System · Meldungen · Bewertungen · Mails · Änderungen · Status
                                                                    └ Editoren · Besucher
Verstehen           Wiki · Sofort live · Graph · Hierarchie · Quellen · Lizenzen · Spoiler · Schalter
Nachschlagen        Auswahllisten · Prüf-Häkchen · Kontextmenüs · Sync-Editoren · Glossar · Hilfe
```

## Stand

- [x] **Phase 1 — Fundament** (`476b7621`). `tokens.css` + `fonts.css` + Theme-Skript;
      die lokalen `--hb-*` sind jetzt Aliasse statt eigener Palette → Hell/Dunkel und
      App-Schrift gratis. Drei Kastentypen (`.hb-tip` / `.hb-warn` / `.hb-check`) statt
      einem gelben `.hb-todo`. Stand-Datum im Kopf.
- [x] **Phase 2 — Gliederung** (`476b7621`). Fünf Ebenen wie oben; Verzeichnis mit allen
      39 Themen in zwei Stufen, mitlaufende Markierung, Filter mit `data-keywords`.
      Regeln stehen nur noch an einer Stelle (`#regeln`).
- [x] **Phase 3 — Tiefe.** Siedlungseditor, Quellen, Abenteuer, Kartensammlung,
      „Änderungen vorschlagen", Wege- und Territorien-Nachträge ausgebaut; Beschriftungen
      wörtlich aus dem Code (drei parallele Code-Abgleiche).
- [x] **Phase 4 — Auffindbarkeit** (`96072e1e`). Dauerhafter „📖 Handbuch"-Link in der
      Kopfleiste von `edit/index.php` neben „Abmelden".
- [x] **Phase 5 — Nicht wieder veralten** (`96072e1e`). AGENTS.md §9: editor-sichtbare
      Änderung → Handbuch im selben Commit. Dazu §11: das Handbuch stand **gar nicht** im
      Doku-Verzeichnis — ein Agent erfuhr nie, dass es existiert. Und §7 verbot pauschal
      handgeschriebene `?v=`, was für `edit/index.php` falscher Rat war (der Stempler
      erreicht keine PHP-Seite); die Ausnahme ist jetzt benannt.

## Was beim Ausbau korrigiert werden musste

Aus drei parallelen Code-Abgleichen. Diese Punkte standen **falsch** im Handbuch oder in
diesem Plan — sie sind der eigentliche Ertrag von Phase 3:

- **Spalten des Siedlungseditors vertauscht.** Richtig: links Territorienbaum, Mitte
  Siedlungsliste, rechts „Eigenschaften & Overrides".
- **„Siedlungen zuordnen" läuft IMMER global.** Baum-Auswahl, Reiter und Filter haben
  keinen Einfluss. Das ist die gefährlichste Eigenschaft des Knopfes und stand nirgends.
  Die Kontextmenü-Variante grenzt nur ein, WELCHE Orte geprüft werden — zugeordnet wird
  weiter in die Tiefe, also ggf. an eine Baronie statt an die angeklickte Grafschaft.
- **„kostenpflichtig" ist kein Häkchen**, sondern eine Auswahl unbekannt/ja/nein je
  Fundort-Zeile. Daneben existiert ein gleichnamiges Häkchen für die ganze Karte.
- **Shop-Link-Priorität ist Ulisses → F-Shop → Wiki → DNB.** Dieser Plan behauptete vorher
  „… → DNB → Wiki". Drei Code-Kommentare behaupten dasselbe Falsche; maßgeblich sind die
  Gruppenüberschrift im Editor und `advLinkMeta`.
- **Der Knopf heißt „Änderungen vorschlagen"** (Plural).
- **Abenteuer-Orte haben genau zwei Rollen** und keine Auswahlliste — ein Umschalter
  „★ Startort" / „☆ Start". Er entscheidet zugleich über den Spoiler.
- **Bilder: Ziehen sortiert nur.** Einen Drag-&-Drop-Upload gibt es nicht.
- **Die Reiter-Zähler im Siedlungseditor sind nur kontinent-skaliert** — sie ändern sich
  nicht mit Suche und Filtern. Sieht wie ein Fehler aus, ist keiner.

## Bewusst NICHT aufgenommen

- **Meisterinformationen-Vorrang bei Abenteuer-Orten** — `docs/abenteuer-mi-places-instruction.md`
  ist eine unabgearbeitete Instruction, im Code existiert nichts davon. Wäre erfundene UI.
- **„Quellen zusammenführen"** — keine Editor-UI, nur ein Endpunkt mit Capability `admin`.
  Owner-Sache.
- **Bruch im Meldungsweg:** Das Meldeformular speichert die gepickte Katalog-ID, der
  Review-Endpunkt gibt sie nicht weiter (`api/edit/reports/locations.php:474-481`), also
  wird der `add_existing`-Zweig von dort nie erreicht. Im Handbuch nur als Symptom
  beschrieben („eine gemeldete Quelle ohne Link geht verloren"), nicht als Mechanik.
  **Offener Bug, eigene Session.**

## Screenshots

Alle sieben stammen vom 07./08.07. — vor Dark Mode und vor dem Infopanel.

- **02-editor-panel** — gegen `index.html:299` geprüft, vier Reiter und drei Unterreiter
  stimmen. **Bleibt**, mit einer Einschränkung: Seit der Link „Tutorial" in
  **„📖 Handbuch"** umbenannt wurde, zeigt die Aufnahme diesen einen Namen veraltet.
  Die Bildunterschrift sagt das ausdrücklich, bis es eine neue Aufnahme gibt.
- **03-hinzufuegen**, **04-verlaufeditieren**, **06-territoriumseditor** — plausibel,
  bleiben vorerst.
- **07-gebiet-menu**, **09-herrschaftsgebieteeditor** — unvollständig (Menü und Menüband
  haben seitdem Einträge bekommen). Bildunterschriften entschärft, ersetzen wäre besser.
- **08-ort-popup** — zeigt die abgelöste Popup-Welt. **Entfernt.**

**Neue Aufnahmen kann eine Agent-Sitzung selbst machen** — alle bisherigen sind so
entstanden (`856d6330`, `72e09f11`, `ce965ef9`, alle mit Claude-Co-Author-Zeile). Der Weg:

1. `preview_start({name: "handbook-preview"})` — die Konfiguration liegt seit Langem in
   `.claude/launch.json` (PHP-Server auf Port **8137**, Wurzel = Repo).
2. Im Pane **`localhost`** benutzen, nicht `127.0.0.1` — letzteres wird abgewiesen.
3. Für Editor-Ansichten die **öffentliche** Karte mit `?edit=1` laden: die Oberfläche
   rendert samt echter Daten, nur Schreibzugriffe scheitern mit 401. Kein Login nötig.

⚠️ **Dabei sparsam sein:** Ein `?edit=1`-Aufruf feuert ~19 parallele PHP-Requests gegen
STRATO; genau das hat den Pool schon zweimal gesättigt. **Einmal** laden, dann rein
клиent-seitig weiterklicken — nicht neu laden für jedes Bild.

⚠️ In dieser Sitzung (2026-07-20) lief `computer{action:"screenshot"}` durchweg in den
30-s-Timeout (fünf Versuche, drei Tabs, `file://` **und** `localhost`), während
`javascript_tool` und `get_page_text` einwandfrei arbeiteten. Die Aufnahmen stehen also
noch aus, aber an der Sitzung, nicht am Zugang.

Sinnvoll wären: Infopanel eines Ortes im Bearbeiten-Modus, der Siedlungseditor, ein
Menüband, der Quellen-Bereich im Bearbeiten-Dialog — plus ein Ersatz für
`02-editor-panel` (zeigt den Link noch als „Tutorial").

## Prüfmittel

Ohne Backend prüfbar und beim Umbau tatsächlich benutzt:

- Ankertest — jeder `href="#…"` muss eine `id` treffen (fand die Navigation vollständig).
- `node --check` auf beide Inline-Skripte **einzeln** (ein `sed`-Bereich über die ganze
  Datei klebt sie zusammen und meldet einen Syntaxfehler, den es nicht gibt).
- **Die Seite über `preview_start({name: "handbook-preview"})` ansehen, nicht über
  `file://`.** Unter `file://` löst der absolute Pfad `/css/base/tokens.css` nicht auf,
  die Seite wirkt ungestylt und der Pane hält obendrein alte Fassungen fest. Über den
  Server stimmt alles: Tokens, Schrift, Bilder. Ich habe das in dieser Sitzung erst spät
  gemerkt und vorher umständlich Tokens per `file://`-`<link>` nachgeladen — unnötig.
- Filter funktional testen. Der erste Entwurf lieferte für „wappen" **null** Treffer,
  weil er nur Überschriften sah; daher `data-keywords`.
