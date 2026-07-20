# Editor-Handbuch — Auftrag: fehlende Screenshots

- **Datum:** 2026-07-20
- **Betrifft:** `html/editor-handbuch.html`, `html/screenshots/`
- **Kontext:** `docs/superpowers/plans/2026-07-20-editor-handbuch-aufwertung.md`

## Ausgangslage

Das Handbuch hat nach dem Ausbau (Phasen 1–5) **1138 Zeilen und sechs Bilder**. Die
Bilder liegen alle in den Kapiteln, die es schon 2026-07-07 gab. Die in Phase 3
dazugekommenen Kapitel — Siedlungseditor, Quellen, Abenteuer, Kartensammlung,
Änderungsmeldungen — sind die längsten des Dokuments und haben **kein einziges Bild**.

**Die vorhandenen sechs bleiben unverändert.** Owner-Entscheidung vom 2026-07-20; sie
sind gut und werden nicht ersetzt. Auch `02-editor-panel` bleibt, obwohl es den Link
noch als „Tutorial" zeigt — die Bildunterschrift sagt das ausdrücklich dazu.

Dieser Auftrag beschreibt also **ausschließlich Neuaufnahmen**.

## Wie man drankommt

Die Aufnahmen macht eine Agent-Sitzung selbst; alle bisherigen sind so entstanden
(`856d6330`, `72e09f11`, `ce965ef9`). Es braucht **keinen** Editor-Login.

1. Für die Handbuchseite selbst: `preview_start({name: "handbook-preview"})` — die
   Konfiguration liegt in `.claude/launch.json` (PHP auf Port **8137**, Wurzel = Repo).
2. Für alle Editor-Ansichten: die **öffentliche** Karte mit `?edit=1` laden. Die
   komplette Editor-Oberfläche rendert samt echter Daten; nur Schreibzugriffe scheitern
   mit 401. Siehe `docs/…` bzw. die Notiz „Editor-UI ohne Login prüfbar".
3. Im Pane **`localhost`** schreiben, nicht `127.0.0.1` — letzteres wird abgewiesen.

> 💣 **`?edit=1` feuert ~19 parallele PHP-Requests gegen STRATO.** Genau das hat den
> Worker-Pool schon zweimal gesättigt (siehe `docs`-Notiz zum Vorfall 2026-07-17).
> **Einmal laden, dann nur noch klicken.** Nicht für jedes Bild neu laden, nicht in
> Schleife, und keine Massenläufe anstoßen, nur um etwas „im Zustand" zu fotografieren.

> ⚠️ In der Sitzung vom 2026-07-20 lief `computer{action:"screenshot"}` durchweg in den
> 30-Sekunden-Timeout (fünf Versuche, drei Tabs, `file://` **und** `localhost`), während
> `javascript_tool` und `get_page_text` einwandfrei arbeiteten. Falls das wieder
> auftritt: Es liegt an der Sitzung, nicht am Zugang — neue Sitzung starten.

## Konventionen

- **Ablage:** `html/screenshots/`, Namen fortlaufend ab `10-`, kleingeschrieben,
  Bindestriche, keine Umlaute (die vorhandenen Dateien halten sich daran).
- **Format:** PNG. Breite **1000–1600 px** genügt; die Seite skaliert auf
  `max-width: 100%`. `04-verlaufeditieren.png` ist mit 1907×1295 und 3 MB zu groß
  geraten — bitte nicht als Vorbild nehmen, **Ziel unter 600 KB**.
- **Ausschnitt:** eng am Gegenstand. Nicht der ganze Bildschirm, sondern das Panel, der
  Dialog oder die Zeile, um die es geht — plus so viel Rand, dass man sie wiederfindet.
- **Theme:** hell. Die vorhandenen sind hell, und Hell ist der Standard.
- **Nichts Privates im Bild:** keine echten Benutzernamen anderer Editoren, keine
  Mail-Adressen, keine Melder-Namen aus echten Meldungen. Wo so etwas im Ausschnitt
  liegt, anderen Ausschnitt wählen oder die Stelle unkenntlich machen.
- **Einbau:** je Bild eine `<figure class="hb-shot">` mit `<img alt="…">` und
  `<figcaption>` an der genannten Stelle. Der `alt`-Text beschreibt den Inhalt sachlich
  und **ohne Umlaute** (so halten es die vorhandenen); die Bildunterschrift darf
  Umlaute und Anführungszeichen haben.

## Die Aufnahmen, nach Nutzen sortiert

### 1. `10-infopanel-bearbeiten.png` — höchste Priorität

- **Was:** Das **Infopanel** rechts, geöffnet für eine Siedlung, im Bearbeiten-Modus,
  mit sichtbarem Knopf **„Bearbeiten"**.
- **Warum:** Das Handbuch erklärt in „Die drei Flächen" und im „ersten Durchlauf", dass
  fast jede Änderung hier beginnt. Dazu gibt es aktuell **kein** Bild — das alte
  `08-ort-popup` zeigte die abgelöste Popup-Welt und wurde entfernt. Das ist die größte
  Lücke im Dokument.
- **Weg:** Karte mit `?edit=1` → Linksklick auf eine Siedlung.
- **Im Bild sichtbar sein muss:** Name des Ortes, ein, zwei Inhaltszeilen, der Knopf
  **„Bearbeiten"**, gern auch **„Änderungen vorschlagen"**.
- **Kommt in:** Abschnitt **Erste Schritte → Die drei Flächen**, direkt hinter der
  Aufzählung der drei Flächen (vor dem Kasten „Häufiges Missverständnis").

### 2. `11-siedlungseditor.png`

- **Was:** Der **Siedlungseditor** als Ganzes, alle drei Spalten erkennbar: links
  Territorienbaum, Mitte Siedlungsliste mit den Reitern „Alle / Platziert / Fehlt",
  rechts „Eigenschaften & Overrides". Oben das Menüband.
- **Warum:** Das längste Kapitel des Handbuchs, komplett bebilderungslos — und ich hatte
  die Spalten in der ersten Fassung selbst vertauscht. Ein Bild verhindert genau das.
- **Weg:** Editor-Panel → WikiSync → Siedlungen → **„Siedlungen Syncen & Editieren"**.
- **Im Bild sichtbar sein muss:** die drei Spaltenüberschriften und das Menüband. Lieber
  etwas weiter aufziehen als ein Detail groß.
- **Kommt in:** **Karten-Features → Siedlungen → „Der Siedlungseditor"**, direkt unter
  dem Absatz, der die drei Spalten benennt.

### 3. `12-siedlungen-zuordnen.png`

- **Was:** Der Dialog **„Siedlungen zuordnen"** mit der Vorschau: die vier Zähler
  („Zugeordnet", „Geändert", „Nicht zugeordnet", „Übersprungen (manuell)"), die
  Beispielliste *Name → Zielterritorium* und die Knöpfe „Abbrechen" / „Übernehmen".
- **Warum:** Der riskanteste Knopf, an den ein Editor herankommt, und er läuft **immer
  global**. Wer die Vorschau einmal gesehen hat, klickt sie nicht weg.
- **Weg:** Im Siedlungseditor auf **„Siedlungen zuordnen"**. Der Dialog ist ein reiner
  Trockenlauf und schreibt nichts.
- > ⚠️ **„Übernehmen" NICHT drücken.** Nur die Vorschau fotografieren, dann „Abbrechen".
- **Kommt in:** **Siedlungen → „Siedlungen zuordnen"**, unmittelbar vor dem roten Kasten
  „Der Lauf ist immer global".

### 4. `13-bilder-lizenz.png`

- **Was:** Die **Bildergalerie** in der rechten Spalte mit dem **aufgeklappten
  Lizenz-Dropdown**, so dass alle vier Werte lesbar sind — besonders
  „Von uns KI-generiert" (die Voreinstellung) und
  „Unbekannt/CC/Sonstiges (nicht öffentlich)".
- **Warum:** Die einzige Stelle im Handbuch mit rechtlicher Tragweite. Der Text warnt,
  dass die Voreinstellung eine Aussage ist; das Bild macht es unmissverständlich.
- **Weg:** Siedlungseditor → eine Siedlung mit Bildern → Lizenzfeld aufklappen.
- **Kommt in:** **Siedlungen → „Bilder"**, beim roten Kasten zur Voreinstellung.

### 5. `14-quellen-editor.png`

- **Was:** Der Bereich **„Quellen"** im Dialog „Siedlung bearbeiten": eine, zwei
  bestehende Quellenzeilen (gern eine aus der Gruppe **„Aus dem Wiki (automatisch)"**)
  und die Eingabezeile mit URL / Quellenname / Seite(n) / Typ / Abdeckung / „offiziell".
- **Warum:** Ein ganzes Subsystem, ausführlich beschrieben, ohne Bild. Vor allem die
  Abdeckung ist erklärungsbedürftig, weil sie beim Leser die Reiter steuert.
- **Weg:** Linksklick auf eine Siedlung → „Bearbeiten" → zum Abschnitt „Quellen"
  scrollen. Am besten ein Ort mit mehreren Quellen.
- **Kommt in:** **Verstehen → Quellen**, bei „Die Eingabezeile".
- **Schön wäre zusätzlich, kein Muss:** dasselbe Feld mit **offener
  Autocomplete-Liste** („Aus dem Quellenkatalog", mit Typ-Schild und „an n Orten") als
  `15-quellen-autocomplete.png`, für den Kasten über die Dublettenfalle.

### 6. `16-menueband.png`

- **Was:** Ein **Menüband** eines der vier Sync-Editoren, ganz — die Kacheln nebeneinander
  mit ihren Unterzeilen, inklusive der 🚨-Kachel und eines AN/AUS-Schalters. Der
  Abenteuer- oder der Karteneditor eignen sich am besten, weil ihre Bänder deckungsgleich
  sind und beide Sorten Kachel zeigen.
- **Warum:** Das Handbuch beschreibt die Kacheln in einer Tabelle. Ein Bild erklärt in
  einer Sekunde, was „Menüband" überhaupt heißt.
- **Weg:** WikiSync → Materialien → Abenteuer → **„Abenteuer Syncen & Editieren"**.
- > ⚠️ **Keine Kachel drücken**, nur fotografieren. „🚨 …", „Vorschauen holen" und die
  > AN/AUS-Schalter wirken sofort und teils serverweit.
- **Kommt in:** **Nachschlagen → Die vier Sync-Editoren**, unter dem einleitenden Absatz.

### 7. `17-abenteuer-orte.png`

- **Was:** Die **Orte-Liste** im Abenteuereditor: mehrere Zeilen, mindestens eine mit
  **„★ Startort"** und eine mit **„☆ Start"**, die ▲▼-Knöpfe und die Legende darunter
  („★ = beginnt hier (Spoiler-frei) · übrige = spielt hier (Spoiler) …").
- **Warum:** Dieser eine Umschalter entscheidet über den Spoiler. Der Unterschied
  zwischen gefülltem und leerem Stern ist im Text schwer zu vermitteln, im Bild sofort da.
- **Weg:** Abenteuereditor → ein Abenteuer mit mehreren Orten wählen.
- **Kommt in:** **Materialien → Abenteuer → „Die Orte"**, beim roten Spoiler-Kasten.

### 8. `18-karten-fundorte.png`

- **Was:** Die Gruppe **„Wo gibt es die Karte?"** im Kartensammlungs-Editor: mehrere
  Fundort-Zeilen mit den Spalten „Fundort" / „URL" / „kostenpflichtig", und das
  Dreiwert-Feld gut lesbar. Ideal wäre eine Karte, bei der eine Zeile „ja" und eine
  andere „nein" oder „unbekannt" steht.
- **Warum:** Die häufigste Fehlbedienung im ganzen Editor — „kostenpflichtig" hängt an
  der Zeile, nicht an der Karte, und ist kein Häkchen.
- **Weg:** WikiSync → Materialien → Karten → **„Kartensammlung Syncen & Editieren"** →
  eine Karte mit mehreren Fundorten.
- **Kommt in:** **Materialien → Kartensammlungen → „Wo gibt es die Karte?"**, beim roten
  Kasten.

### 9. `19-aenderungsmeldung.png`

- **Was:** Ein geöffneter Bearbeiten-Dialog, der aus einer **Änderungsmeldung** heraus
  aufgerufen wurde — mit den **rot umrandeten** abweichenden Feldern und, wenn vorhanden,
  der Quellen-Gruppe „Aus der Meldung (wird beim Speichern übernommen)".
- **Warum:** Der rote Rahmen ist die zentrale Orientierungshilfe dieses Arbeitsschritts.
- **Weg:** Editor-Panel → Meldungen → eine Änderungsmeldung → **„Bearbeiten"**.
- > ⚠️ **Nicht speichern.** Der Dialog trägt eine vorgeschlagene Position bereits
  > eingetragen; „Speichern" würde den Ort verschieben. Nach der Aufnahme „Abbrechen".
- > ⚠️ Melder-Namen sind personenbezogen — Ausschnitt so wählen, dass keiner im Bild ist,
  > oder unkenntlich machen.
- **Kommt in:** **Aufgaben → Meldungen → „Eine Änderungsmeldung bearbeiten"**.
- **Hinweis:** Hängt davon ab, dass gerade eine passende Meldung offen ist. Wenn keine
  da ist, entfällt das Bild — nicht künstlich eine erzeugen.

## Abschluss

- Für jedes gelieferte Bild die `<figure>` an der genannten Stelle einbauen, `alt` und
  `figcaption` schreiben.
- Danach den Ankertest und die Tag-Balance laufen lassen (siehe „Prüfmittel" im
  Hauptplan) und die Seite einmal über `handbook-preview` ansehen.
- Das **Stand-Datum** in der Kopfleiste der Seite mitziehen.
- Bilder, die nicht zustande kommen, ersatzlos weglassen — **kein Platzhalter**. Ein
  leerer Kasten ist schlechter als kein Kasten; die Erstfassung hatte das und es hat
  niemandem geholfen.
