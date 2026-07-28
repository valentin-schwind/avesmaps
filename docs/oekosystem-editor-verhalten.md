# Landschaften-Editor — Verhalten und Funktion

> **Es sind zwei Oberflächen, nicht eine.** §1–§7d beschreiben die **Karte** (Modus
> „Landschaften", zeichnen, ziehen, Kontextmenü). §7f beschreibt den **Listen-Editor**
> „Regionen bearbeiten" (`WikiSync → Regionen`), den siebten Listen-Editor des Hauses — dort
> sitzen die Zugehörigkeitsrechnung, die Vorkommen und der Totmannschalter.
>
> Was der Editor **tut**, wenn jemand klickt. Architektur und Bauteile stehen im
> `oekosystem-editor-leitfaden.md`, das Datenmodell in dessen §1, die Bauphasen in
> `oekosystem-r1-auftrag.md` und `oekosystem-r2-auftrag.md`.
>
> Vorführung: **`html/landschaften-modell.html`** (live auf avesmaps.de,
> unverlinkt). Was dort zu sehen ist, ist die Absicht — dieses Dokument schreibt sie
> aus. Rückmeldung der Editoren steht noch aus; wo sie etwas umwirft, gewinnt sie.

## 1. Hineinkommen

Der Modus **„Landschaften"** steht in der Modusliste, sichtbar nur im Edit-Mode.
Wer umschaltet, sieht **die gewohnte Karte weiter**: Kacheln, Wege, Orte,
Beschriftungen. Das ist keine Bequemlichkeit, sondern der Arbeitsvorgang — die
Landschaften werden über das nachgezeichnet, was der Kartograph schon gemalt hat.

Der Modus öffnet mit der Ebene, die zuletzt aktiv war; beim ersten Mal mit
**Topographie**. (Dasselbe Merkverhalten wie bei den Editor-Reitern. Vorsicht: die
dortige Falle war, eine Werteliste zu ergänzen — hier gibt es nur zwei Werte,
und mehr werden es nicht.)

## 2. Was sichtbar ist

| | Darstellung | anklickbar |
|---|---|---|
| Grundkarte, Wege, Orte | unverändert | nach den üblichen Regeln |
| **aktive** Ebene | voll, mit Griffen | **ja** |
| **inaktive** Ebene | blass, ohne Griffe | **nein** |
| Gipfel | nur bei aktiver Topographie | ja, ziehbar |
| Landschafts-Labels | Häkchen, standardmäßig **aus** | nein |

> 🔴 **Die inaktive Ebene wird nicht ausgeblendet, sondern nur stummgeschaltet.**
> Man zeichnet das Gebirge und sieht dabei, wo der Wald liegt. Das ist der
> gesamte Trick, mit dem die Überlappung harmlos wird: es entsteht nie die Frage
> „welches Polygon habe ich erwischt", weil immer nur eine Ebene antwortet.
> Technisch `pointer-events: none` plus halbe Deckkraft auf der ruhenden Pane.

Das **Labels-Häkchen** blendet die Beschriftungen der Standardkarte ein. Es ist
aus, weil die Karte beim Zeichnen ohnehin voll ist — und an, wenn jemand prüfen
will, ob die zugewiesene Wiki-Region wirklich zu dem Namen passt, der darunter
steht.

## 3. Umschalten

Ein Segmentschalter oben, **nur im Landschaften-Modus sichtbar**, dazu eine Taste
(`E` wie Ebene), weil beim Zeichnen ständig gewechselt wird.

Beim Umschalten passiert **nichts Zerstörerisches**: eine laufende Bearbeitung
wird abgeschlossen und gespeichert, nicht verworfen. Die bisher aktive Ebene wird
blass, die andere übernimmt die Klicks. Die Auswahl in der alten Ebene bleibt
erhalten und ist beim Zurückschalten noch da.

## 4. Eine Fläche anlegen

**Rechtsklick auf die Karte → „Neue Vegetation" / „Neue Topographie" / „Neue
Derographische Region".** Kein Knopf in einer Werkzeugleiste; derselbe Weg wie bei
Territorien und Siedlungen.

Danach wird **Punkt für Punkt gezeichnet** (Doppelklick oder Enter schließt ab,
Escape bricht ab). Beim Schließen des Umrisses entsteht eine **eigene Region** mit
Auto-Namen, und der Eigenschaften-Dialog geht auf — als *„Vegetation bearbeiten"*,
*„Topographie bearbeiten"* oder *„Derographische Region bearbeiten"*. Was dort
eingestellt wird, gilt: freier Name, Auto-Name, oder Name samt Wiki-Eintrag.

> ⚠️ **Berichtigt 2026-07-27 — hier stand ein Weg, den es nicht mehr gibt.** Früher
> mussten Region und Zeichnen-Knopf **vor** dem Zeichnen in einer Leiste über der
> Karte gewählt werden („Aktive Region", „Fläche zeichnen", V3.0b/V3.2). Beides ist
> **entfernt**. Der Wähler war eine Falle: der Name sitzt auf der **Region**, eine
> Region trägt viele Flächen — wer ihn übersah, hängte seinen frischen Wald an die
> zuletzt gewählte Region und bekam ihn nicht wieder los, weil ein Umbenennen dann
> **alle** ihre Flächen traf. Der Owner ist am 2026-07-27 genau darüber gestolpert.
>
> Ebenso gestrichen: *„weitere Fläche zeichnen"* für eine zweite Fläche derselben
> Region. Dafür gibt es jetzt **Unterflächen** (§7e) — eine Fläche darf mehrteilig
> sein, und zwei getrennte Stücke werden über *„Mit anderer vereinigen"* zu einer
> Fläche mit Inseln. Das ist dieselbe Sache, ohne den geteilten Namen.

**Jede gezeichnete Fläche bekommt ihre eigene Region.** Das gilt auch für Stücke, die
durch *Zerschneiden* oder *Unterfläche herauslösen* entstehen — sonst trüge das
abgetrennte Stück den Namen seines Ursprungs, und ein späteres Umbenennen träfe beide.
Wer zerschneidet, will zwei Dinge; wollte er eines, hätte er die Fläche mehrteilig
gelassen.

## 4a. Eine Fläche aus Territoriengrenzen (V7)

**Rechtsklick auf die Karte → „Grenze aus Territorien …"** — vierter Eintrag im selben Untermenü
*„Hier hinzufügen"*, hinter den drei *„Neue …"*. Es ist derselbe Vorgang wie §4, nur kommen die
Ecken nicht aus der Hand, sondern aus vorhandenen Herrschaftsgebieten.

> 🔴 **KOPIE, NIE VERKNÜPFUNG.** Die eingefügte Fläche ist ab dem Einfügen ein eigenständiges Objekt.
> Sie merkt sich **nicht**, aus welchen Territorien sie entstand, und sie folgt ihnen **nicht**, wenn
> dort jemand eine Grenze verschiebt. Das ist der Unterschied zwischen den beiden Ebenen: eine
> politische Grenze *ist* eine Linie und wird verhandelt; ein Waldrand ist keine Grenze (§5). Eine
> mitwandernde Landschaftsgrenze wäre eine stille Lüge — der Wald zöge um, weil eine Baronie neu
> vermessen wurde. Wer dafür eine `source_territory_id` einführen will, redet vorher mit dem Owner;
> das ist eine andere Funktion.

Der Dialog fragt vier Dinge, in dieser Reihenfolge:

| | |
|---|---|
| **Ebene der neuen Fläche** | Derographische Region · Vegetation · Topographie. Vorausgewählt ist **derographisch** — politische Grenzen folgen am ehesten der Landgliederung (Owner-Entscheid 2026-07-28). |
| **Gebiet suchen** | Filter über den Baum. Ein Treffer zieht seine **Vorfahren** mit, sonst stünde er in einer Einrückung, die nichts bedeutet. |
| **Der Baum** | Hierarchie aus `parent_public_id`, ein Häkchen je Gebiet. Ein Häkchen **nimmt seinen Teilbaum mit**; das Elternteil zeigt danach einen Teilzustand. |
| **Die Zahlen** | Gewählte Gebiete, Teile, Ecken und die Nutzlast in KB — vor dem Schreiben, nicht danach. |

Das Gebiet **unter dem Klickpunkt** ist vorausgehakt (das tiefste, das ihn enthält) — bei 945
Gebieten ist das der Unterschied zwischen anhaken und suchen. Trifft der Klick nichts, ist nichts
vorausgewählt.

Die **Vereinigung liegt währenddessen als Vorschau auf der Karte**, in derselben Farbe wie die
Vorschau des Vereinfachen-Dialogs. Deshalb hat dieses Fenster — wie jenes — **keinen Schleier**: die
Karte darunter bleibt sichtbar und bedienbar, man kann während der Auswahl zoomen und verschieben.

**Einfügen** legt eine **eigene Region** mit Auto-Namen und ihr Karten-Label an (wie beim Zeichnen,
§4), stellt die Karte auf das Ergebnis — und öffnet **danach den vorhandenen Dialog „Fläche
vereinfachen"** (§7b-Nachbar). Das ist kein Beiwerk: eine übernommene Grenze bringt politische
Vertex-Dichte mit, und die loszuwerden ist der ganze Zweck. Gemessen an 56 Baronien: 2240 rohe Ecken
→ 552 nach der Vereinigung → 150 bei Reglerstellung 75. Das Runden auf vier Nachkommastellen beim
Schreiben nimmt davon unabhängig noch einmal rund ein Drittel der Nutzlast (10,1 statt 15,0 KB).

> 💣 **Die Territorien werden über SIEBEN Anfragen geholt** — sie sind zoom-gebändert, ein einzelner
> Aufruf liefert die meisten nicht. Deshalb läuft der Fächer nur **hinter dieser ausdrücklichen
> Aktion** und **je Sitzung höchstens einmal** (dieselbe Regel wie bei „Zugehörigkeit rechnen",
> §7f). Ein **leeres** Ergebnis wird ausdrücklich *nicht* gemerkt: ein weggebrochener Endpunkt sähe
> sonst für den Rest der Sitzung aus wie „es gibt keine Territorien".
>
> 💣 **Aggregat oder rohe Geometrie ist nicht wählbar.** Der Ladeweg behält eine Geometrie je Gebiet —
> „erste Zoomstufe, die es zeigt, gewinnt". Jede Zeile sagt deshalb, welche es wurde
> (*„Außengrenze"* bzw. *„Grenze"*), statt eine Wahl vorzutäuschen.
>
> 🔴 **Politische Dateien werden gelesen, nie geschrieben** (Owner-Freigabe 2026-07-28 gilt nur für
> den Leseweg). Gelesen wird über `loadAllTerritoryGeometry()`, denselben Helfer, den der
> Siedlungseditor und die Zugehörigkeitsrechnung schon benutzen.

## 5. Eine Fläche bearbeiten

| Geste | Wirkung |
|---|---|
| Klick auf eine Fläche der aktiven Ebene | auswählen, Griffe erscheinen, Panel öffnet |
| Griff ziehen | Ecke verschieben; beim Loslassen gespeichert |
| Strg + Zeigen auf eine Kante | Einfügepunkt erscheint, Klick setzt eine Ecke |
| Doppelklick auf einen Griff | Ecke löschen (Minimum drei) |
| Klick ins Leere | Auswahl aufheben |

> **Keine geteilten Grenzen.** Eine Ecke zu ziehen bewegt **nur diese Fläche**.
> Das ist der bewusste Unterschied zu den Territorien: eine politische Grenze
> zwischen zwei Reichen *ist* eine Linie und muss geteilt sein. Ein Waldrand ist
> keine Grenze — Wald läuft in Steppe aus. Überlappungen und Lücken zwischen
> benachbarten Landschaften sind **erlaubt und normal**; ein Zwang zu
> deckungsgleichen Kanten würde das Zeichnen erschweren, ohne irgendetwas zu
> verbessern.

## 6. Auswählen, wenn sich etwas überlappt

| Fall | Verhalten |
|---|---|
| Fläche der **inaktiven** Ebene darunter | wird ignoriert — sie nimmt keine Klicks |
| Zwei Flächen **derselben** Ebene übereinander | wiederholtes Klicken schaltet durch |
| Eine **Siedlung** an derselben Stelle | die Siedlung gewinnt |

Der letzte Punkt ist keine Höflichkeit, sondern eine Hausregel: jede Ebene fragt
zuerst die Klick-Schlichtung (`docs/click-arbiter-coordination.md`), bevor sie
selbst reagiert. Landschaften reihen sich unten ein.

## 7. Region: benennen, zuordnen, mehrere Flächen

Das Panel zeigt für die ausgewählte Fläche **ihre Region**:

```
Name                     freies Feld
Typ                      Auswahl aus dem Vokabular DIESER Ebene (Leitfaden §1.3)
Wiki-Landschaft          zugewiesen | „ohne Wiki-Eintrag" (ein gültiger Zustand)
Flächen                  Liste; je Eintrag hinspringen und löschen
```

Die **Typenauswahl zeigt nur das Vokabular der eigenen Ebene.** Eine
topographische Region kann nicht „Sumpf" werden. Das ist kein Filter über einer
gemeinsamen Liste, sondern zwei getrennte Listen (`ecosystem_region_type.kind`).

Ohne Zuweisung ist die Region `origin='own'` — für Gebiete, die es bei uns gibt
und im Wiki nicht. Das ist **kein Mangel**, sondern ein Zustand, der so benannt
wird.

> ⚠️ **Berichtigt 2026-07-27.** Hier stand: *„Zuweisung aus dem Wiki ist R4 und
> läuft über **Ziehen-und-Ablegen** aus einer Liste."* Gebaut wurde sie **nicht**
> so, sondern über einen Knopf — in der Liste (§7a) und im Eigenschaften-Dialog
> (§7b). Ziehen-und-Ablegen gibt es in der Regionenliste zwar, es legt aber ein
> **Label** an (`dropRegionOnMap` → Label-Editor) und rührt keine Fläche an.
> Ein Ablegen auf einer Fläche ist damit heute nicht möglich; ob es kommt, ist offen.

## 7b. Eigenschaften einer Fläche ändern (V6b)

**Rechtsklick auf die Fläche → „Eigenschaften …"** (über „Fläche löschen", wie jeder
ungefährliche Eintrag im Haus). Der Dialog zeigt:

```
Identität     Name          freies Feld — außer bei „Auto-Name" (§7d)
              Auto-Name     Haken; gesetzt = der Name ist ein interner Griff
              Regionname anzeigen   Haken; zeichnet das Karten-Label der Region
              Nodix                 Haken; Kraftlinien-Knoten. Sitzt am LABEL (ein Punkt),
                                    daher gesperrt, solange die Region keines hat.
              Art           Auswahl aus dem Vokabular DIESER Ebene
              (dazu: „trägt N Flächen und 1 Label")
Wiki-Landschaft             Zuweisen/Ändern · Sync · Entfernen, mit der vollen Wiki-Auskunft
                            Löschen · Abbrechen · Speichern
```

Er schreibt `update_region` bzw. `delete_region` — beide waren seit V2.3 gebaut und
hatten bis dahin **keinen einzigen Aufrufer**: Name, Art und Wiki-Link ließen sich nur
beim Anlegen setzen, und eine Region war überhaupt nicht löschbar.

> 🪤 **Dieser Dialog bearbeitet die FLÄCHE, nicht das Label.** Der optisch fast gleiche
> *„Region-Label bearbeiten"* (`#label-edit-overlay`) bearbeitet eine **Beschriftung** in
> `map_features` — daher dessen Größe, Rotation, Zoom-Bänder und Priorität, die hier
> alle fehlen: eine Fläche hat keine (§12). Es sind zwei Zeilen in zwei Tabellen.
>
> **Gekoppelt sind sie trotzdem** — über `ecosystem_region.label_public_id`. Bis V6
> stand hier das Gegenteil („wer die Fläche umbenennt, benennt das Label nicht mit
> um"), und das war richtig, solange die beiden nichts voneinander wussten. Seit jede
> Region ihr Label automatisch bekommt, wären zwei Namen für dasselbe Ding schlicht
> ein Fehler: Speichern trägt **Name, Art, Nodix und die Wiki-Landschaft** ans Label weiter.
> Was NICHT durchträgt, sind Größe, Rotation, Zoom-Band und Priorität — die gehören dem
> Label allein und werden in *„Region-Label bearbeiten"* eingestellt.
>
> 💣 **Die Wiki-Zuweisung wandert NUR abwärts.** Hat die Region eine, bekommt das Label sie.
> Hat die Region **keine**, bleibt das Label unangetastet — andersherum löschte jedes Speichern
> einer wiki-losen Region genau die Zuweisung, die *„Label zuweisen"* (§7c) von Hand gesetzt hat.
>
> 💣 **Der Zeiger kann ins Leere zeigen.** Ein Label lässt sich einzeln löschen; die
> Region behält dann ihren `label_public_id`. Der Haken *„Regionname anzeigen"* geht
> daraufhin richtig aus — aber es entscheidet das **Label**, nicht der Zeiger, ob beim
> Wiederanhaken eins angelegt wird. Wer das umdreht, baut den Fehler von 2026-07-27
> nach: der Haken ließ sich setzen und es entstand nichts.
>
> Der Label-Dialog sagt dasselbe von der anderen Seite: **„Dieses Label wird von N Flächen
> getragen"**. Die Zahl kommt aus `list_regions`, nicht aus den geladenen Flächen — die halten
> nur, was gerade im Bild ist, und zählten eine halb aus dem Ausschnitt ragende Region zu klein.
>
> *„Andere Quelle"* ist dort **entfernt** (2026-07-28): das Einzelquellen-Feld von vor dem
> Mehrquellen-System, das Orte im selben Umbau verloren haben. Gespeicherte Werte bleiben liegen,
> weil der Save den Schlüssel nicht mehr mitschickt.

**Sync** übernimmt Name und Art aus der verbundenen Wiki-Landschaft — die Art nur, wenn
das Vokabular dieser Ebene sie kennt (`wald` kann nie auf einer topographischen Region
landen; der Server prüft dasselbe und antwortete sonst mit 400).

⚠️ **Löschen bleibt gesperrt, bis die Flächenzahl feststeht**, und der Knopf sagt das,
solange er zählt. Die Rückfrage nennt die Zahl — *„mit 0 Flächen löschen?"* wäre eine
Entwarnung genau in dem Moment, in dem drei Flächen mit verschwinden.

**Speichern schickt `wiki_url` nur mit, wenn der Link angefasst wurde.** `update_region`
schreibt ausschließlich die Felder, die im Payload stehen; ein immer mitgeschicktes
leeres `wiki_url` würde eine bestehende Zuweisung stillschweigend löschen.

## 7a. Wiki-Region zuweisen (V6)

Die Zuweisung hat **keine eigene Oberfläche**. Sie sitzt in der Liste, die die
Wiki-Regionen ohnehin schon zeigt: **WikiSync → Regionen**. Jede Zeile trägt dort
eine Angabe *„Fläche(n):"* — ein Chip je Landschaftsregion, die an dieser
Wiki-Region hängt, mit ihrer Flächenzahl — und daneben den Knopf
**„Fläche zuweisen"**.

> **Die meisten Zeilen werden „—" zeigen, und das ist richtig so.** Es gibt 1843
> Wiki-Regionen und 124 abgeleitete Flächen; die allermeisten Wiki-Regionen haben
> schlicht kein Kartenpendant.

Der Dialog zeigt **alle** aktiven Landschaftsregionen zur Auswahl, nicht nur die
schon verknüpften — die noch nicht verknüpften zu erreichen ist ja der Zweck.
Bereits zugewiesene sind vorausgewählt; eine Region, die an einer **anderen**
Wiki-Region hängt, sagt das in ihrer Zeile, denn Zuweisen hängt sie um.

Gespeichert wird in **zwei Schritten**: der erste Druck rechnet einen
**Trockenlauf** und zeigt, welche Regionen welchen Schlüssel bekämen; erst der
zweite schreibt. Ändert sich zwischendurch die Auswahl, verfällt die Vorschau —
scharf läuft nur, was auch gezeigt wurde.

> 🔴 **Zuweisen setzt `wiki_url`. Den Schlüssel `wiki_region_key` leitet der
> Server daraus ab** — der Client schickt nie einen. „Eine Wiki-Region auf
> mehrere Flächen" entsteht dadurch, dass **mehrere Regionen denselben Schlüssel
> tragen**; `idx_ecosystem_region_wiki` ist absichtlich ein Index und kein UNIQUE.
>
> **Es wird nichts verschmolzen, nichts verschoben und nichts gelöscht.** Der
> V5-Import hat je Fläche eine eigene Region angelegt (129 Regionen für 131
> Flächen) — „Bilku", „Bilku-Archipel", „Sorak" und „Kossike" sind vier Zeilen,
> die das Wiki als eine kennt. Der geteilte Schlüssel bringt sie zusammen, ohne
> dass jemand entscheiden muss, welcher der vier Namen überlebt: jede Fläche
> bleibt unter ihrem eigenen Namen auffindbar.

Ein leeres `wiki_url` **löscht** die Zuweisung — dasselbe Feld, derselbe Weg
zurück. Ein Zuweisungs-Save fasst `map_revision` nicht an, nur
`ecosystem_revision`.

⚠️ Weicht der aus dem Wiki-Link abgeleitete Schlüssel von dem ab, den die
Listenzeile führt (umbenannter Artikel, Weiterleitung), **sagt die Vorschau das**.
Ohne den Hinweis würde korrekt geschrieben und erschiene trotzdem nie in dieser
Zeile.

## 7c. Label zuweisen (V6c)

Dieselbe Listenzeile trägt einen **zweiten** Knopf: **„Label zuweisen"**. Er tut
für **Karten-Labels**, was „Fläche zuweisen" für Landschaftsflächen tut — und das
sind zwei Zeilen in zwei Tabellen: der eine schreibt
`map_features.properties_json.wiki_region`, der andere `ecosystem_region.wiki_url`.
Was schon verknüpft ist, steht in derselben Zeile bereits als *„Karte:"* bzw.
*„Fläche(n):"*.

Der Dialog ist absichtlich baugleich: **auswählen → Vorschau (Trockenlauf) →
Zuweisen**. Auch hier verfällt die Vorschau, sobald sich die Auswahl ändert.

> 🔴 **Warum das neben der vorhandenen Aktion steht und nicht in ihr.** Die
> Aktion `assign` (der Knopf „⛰ Berge zuordnen") matcht **ausschließlich über den
> Namen**. Ein Label, das anders heißt als seine Wiki-Region, ist darüber
> überhaupt nicht erreichbar — und genau diese Fälle sind der Zweck von V6c. Die
> Namens-Aktion umzubauen hätte den Berge-Bulk mitgerissen; sie bleibt, wie sie ist.

Die Kandidatenliste zeigt **alle aktiven Karten-Labels**, nicht nur die
namensgleichen. Schon verknüpfte sind vorausgewählt; ein Label, das an einer
**anderen** Wiki-Region hängt, sagt das in seiner Zeile, denn Zuweisen hängt es um.

> ⚠️ **Ein Label-Save bumpt `map_revision` — anders als eine Flächen-Zuweisung, und
> das ist richtig so.** Labels reisen im `map-features`-Payload, Flächen nicht. Der
> Bump passiert **einmal pro Aufruf**, nicht je Label. Wer das als Fehler „korrigiert",
> bricht die Aktualisierung der Karte nach dem Zuweisen.

Den Typ-Konflikt-Wächter des Bulks (Label-Subtyp gegen Wiki-„Art") wiederholt
dieser Dialog **bewusst nicht**: hier wählt ein Mensch ausdrücklich aus, und diese
Wahl soll er treffen dürfen. **Eine Zuweisung zu löschen** ist weiterhin Sache des
Label-Editors; ein leerer Schlüssel wird hier abgewiesen.

## 7d. Auto-Name — der Griff, der kein Anzeigename ist

Eine Fläche ohne Karten-Label braucht trotzdem einen Namen, unter dem der Editor sie
wiederfindet. Dieser Name ist **kein Anzeigename**. Der Haken **„Auto-Name"** steht in
beiden Flächen-Dialogen — „Neue Region" und „Fläche bearbeiten" — und wird genauso
gehandhabt wie beim Weg-Editor:

| Haken | Namensfeld | Bedeutung |
|---|---|---|
| gesetzt | gesperrt, trägt `Wald-001` | interner Griff; ein Leser bekommt **die Art** zu sehen („Wald") |
| leer | frei | der **zugewiesene** Name gilt und wird angezeigt |
| **deaktiviert** | frei | eine **Wiki-Landschaft** hängt daran und besitzt den Namen |

Bei einer neuen Region steht der Haken auf **an** — niemand soll sich einen Namen für
einen Wald ausdenken müssen, den das Wiki gar nicht kennt. Die laufende Nummer zählt
**je Art** (`Wald-001`, `Steppe-001`), und ein Artwechsel zieht den Griff mit.

> 🔴 **Nichts davon wird gespeichert. Der Name selbst trägt den Zustand** — er passt auf
> `<Art>-<Zahl>` oder er tut es nicht. Genau so halten es die Wege, und genau darauf
> verlässt sich schon die Rauschfilterung im Konfliktzentrum, die auto-benannte Wege gar
> nicht erst auf die Merkliste lässt. Eine zusätzliche Spalte wäre eine **zweite Wahrheit
> über dieselbe Sache**, und die beiden könnten auseinanderlaufen.
>
> Angenehme Folge: der Haken wird beim Öffnen **abgeleitet**, nicht geladen. „Farindel"
> öffnet ohne Haken und schreibbar, „Wald-001" mit Haken und gesperrt — und das Öffnen
> vergibt **keine neue Nummer**.

⚠️ **Der Bestand ist unangetastet.** Die abgeleiteten Flächen tragen weiter den Namen
des Karten-Labels, aus dem sie entstanden sind (`tools/ecosystem/derive_areas.py`) —
eine Fläche, die aus einem Label entstand, **hat** ein Label, und ihr Name ist damit ein
echter Name. Der Auto-Name ist für die anderen da.

## 7f. Der Listen-Editor „Regionen bearbeiten" (der siebte Editor)

> ⚠️ **Warum 7f und nicht 7e:** §4 verweist auf „Unterflächen (§7e)", einen Abschnitt, den es in
> diesem Dokument **nicht gibt** — ein hängender Verweis von vor dem 2026-07-27. Diese Nummer
> bleibt für ihn reserviert; sie hier zu belegen hieße, den Verweis auf ein anderes Thema zu
> lenken statt ihn zu reparieren.

Alles bisher Beschriebene passiert **auf der Karte**. Daneben gibt es seit dem 2026-07-27 die
**Listensicht**: `WikiSync → Regionen → „Regionen bearbeiten"`. Sie beantwortet die Fragen, die
man auf der Karte nicht sieht — *welche Region hat gar keine Fläche?*, *was liegt in was?* —
und sie ist der Ort, an dem der **Raycast** sichtbar wird.

Bauart wie der sechste Editor: eigene iframe-Seite `html/landschaften-editor.html`, geladen mit
`?v=Date.now()`, gemeinsame Hülle `css/components/editor-shell.css` (`avm-editor-*`), drei
gleich breite Spalten per `display: grid`. Plan:
`docs/superpowers/plans/2026-07-27-landschaften-editor.md`.

> ⚠️ **Der Sync-Knopf des Reiters ist verschwunden — er ist nicht weg, er ist umgezogen.**
> Ein Subjekt hat genau **einen** Knopf (`wikiSyncSubjectButtonId`, `js/review/review-subjects.js`):
> wo es einen Editor gibt, ist es dessen Knopf. „🚨 Syncen" sitzt jetzt im Menüband des Fensters
> und ruft von dort `window.parent.startWikiSyncKindSync("region")` — dieselbe Maschinerie,
> derselbe Fortschritt, dieselbe „Zuletzt gesynct"-Angabe. Genau der Weg, den Siedlungen und
> Kraftlinien vorher gegangen sind. Der alte Knopf steht weiterhin **versteckt** im DOM, weil
> `renderWikiSyncKindProgress` auf seine id zielt.

### Spalte 1 — die Vereinigung, nicht nur das Gezeichnete

**Owner-Entscheid 2026-07-27.** Die Liste zeigt **drei Dinge nebeneinander**, verbunden über
`wiki_key`:

| Zeile kommt von | heißt in „Map-Darstellung" |
|---|---|
| gezeichnete Fläche (`ecosystem_region` + `ecosystem_area`) | **Fläche** |
| Karten-Label (`map_features`) | **Label** |
| beides | **Label + Fläche** |
| Wiki-Region mit **keinem** von beidem | **nicht auf der Karte** |

Die letzte Zeile ist der Grund für die Vereinigung: nur so hat der Filter „Map-Darstellung:
keine" überhaupt etwas zu zeigen — und das ist die Lücke, die man sucht. Gelesen wird aus
**zwei** vorhandenen Pfaden, `list_regions` (Flächen) und `regions.php?action=match`
(Wiki + Labels); ein neuer Endpunkt war nicht nötig.

> 🔴 **Die Art-Reiter (Derographische Region · Vegetation · Topographie) greifen nur auf
> gezeichnete Regionen.** Eine Wiki-Region ohne Fläche hat keine Ebene, also kann sie unter
> keiner stehen — sie erscheint unter „Alle". Dasselbe Verhalten wie „Platziert/Fehlt" anderswo.
>
> ⚠️ **Eine Region ohne Fläche zählt als „nicht auf der Karte", nicht als „Fläche".** Sie steht
> in der Liste und ist auf der Karte nicht da (§10) — das ist kein Fehler, aber es ist auch
> keine Darstellung.

Der Filtertrichter ist der geteilte (`js/ui/filter-menu.js`, **nicht** die Zwillingsfassung
`attachFilterMenu` in `js/app/utils.js` — die hängt an den Globalen des Hauptfensters).
Abschnitte: Wiki · Map-Darstellung · Art (`region_type`) · Kontinent. **Kontinent steht auf
Aventurien** und zählt bewusst nicht als aktiver Filter — das ist die Identität der Karte, keine
Einschränkung; dieselbe Ausnahme macht die Panel-Liste. Ein Reiterwechsel **leert die
Art-Auswahl**, weil jede Ebene ihr eigenes Vokabular hat.

### Spalte 2 — Eigenschaften und „Gemeinsame Regionen mit"

Reihenfolge nach Designsprache-Spec §3.5: Identität → Wiki-Landschaft → Flächen → Zugehörigkeit.
Der **Auto-Name-Zustand wird abgeleitet**, nicht geladen (§7d) — der Name passt auf
`<Art>-<Zahl>` oder er tut es nicht.

Darunter das Ergebnis des **Raycasts**: welche anderen Regionen sich mit dieser überschneiden,
**mit Prozentzahl**, absteigend sortiert. Jeder Eintrag ist ein Knopf und wählt das Paar für
Spalte 3.

> 🔴 **Die Regel: Anteil an der KLEINEREN der beiden Flächen, Schwelle 10 %.**
> „Kleinere von beiden" deckt den Fall ab, dass ein Gebirgszug über mehrere derographische
> Regionen läuft — als „Anteil am Gebirge" gerechnet fiele er überall heraus. Gemessen am
> Muster: eine kleine Fläche vollständig in einer großen ergibt **100 %**; am größeren gemessen
> wären es 6 % und sie verschwände.
>
> **Nicht „≥ 1 Vertex":** das verpasst einen langen Wald, der eine Region quert, ohne eine Ecke
> darin zu haben, und hängt an der `simplify_ratio` der Rasterverfolgung statt an der Geographie.
>
> 🔴 **Gerechnet, nie gespeichert** — wie beim Konfliktzentrum: eine verschobene Grenze
> korrigiert die Antwort von selbst. Keine Spalte, keine Hierarchie; eine Fläche darf zu zwei
> Regionen gehören (§12).

Ausgelöst wird per Menüband-Kachel **„Zugehörigkeit rechnen"**, nicht beim Öffnen: der Lauf liest
**jede** Geometrie im Haus (`api/app/ecosystem-areas.php` **ohne** `bbox`), und dafür soll niemand
allein durchs Öffnen bezahlen. Ein Bounding-Box-Vorfilter verwirft die Paare vorher; gemessen
47 ms für den Live-Bestand.

> ⚠️ **Bei ausgeschaltetem Landschaftsmodul liefert der Lesepfad eine LEERE Liste, keinen
> Fehler.** Der Editor sagt das ausdrücklich, statt „keine Überschneidungen" zu zeigen.

### Spalte 3 — Schnittmenge und Vorkommen

Die **Schnittfläche** des gewählten Paares als Vorschaubild (`ecosystemBooleanGeometry
("intersection", …)`, dieselbe unit-getestete Rechnung wie überall).

> 🪤 **Die Vorlage ist die Territorien-Vorschau** (`js/territory/territory-derived-geometry-editor.js:576`)
> — eine **politische** Datei: abgeschrieben, nie aufgerufen (Hauptplan, Regel 1). Zwei bewusste
> Unterschiede: dort war es immer *union*, hier ist es die *intersection*; und die Farben kommen
> aus Tokens statt aus dem dortigen harten `rgba()`.

Darunter die **Vorkommen** der Region. Die Brücke Vorkommen ↔ Region läuft über die politische
Tabelle `political_territory_wiki.geographic` (`api/_internal/app/lore.php:599`) — **der Editor
fasst sie nicht an**, er ruft den vorhandenen öffentlichen Lesepfad.

> **Geprüft 2026-07-27:** der Parameter ist `GET /api/app/lore.php?place=<schlüssel>`, und
> `<schlüssel>` ist der `wiki_region_key` **ohne** das Präfix `wiki:`, kleingeschrieben — genau
> das, was `avesmapsLoreNormalizeKey` (`js/map-features/map-features-lore.js:91`) erzeugt.
> `&full=1` liefert die vollständigen Listen. Eine Region **ohne** Wiki-Eintrag hat keinen
> Ortsschlüssel; der Editor sagt das, statt eine leere Liste zu zeigen.

### Menüband

| Kachel | Wirkung |
|---|---|
| **🚨 Syncen** | die Sync-Kachel; **einzige** mit Icon und `--primary` |
| **Zugehörigkeit rechnen** | löst den Raycast aus, Zahl der Flächen und Schwelle stehen in der Kachel |
| **Landschaftsmodul AN/AUS** | der Totmannschalter — **erste Oberfläche für `set_enabled` überhaupt** |

> 💣 **`set_enabled` gab es serverseitig seit V2.1 und hatte bis zum 2026-07-27 keinen einzigen
> Aufrufer im Client.** Der Zustand steht **in** der Kachel, nicht daneben, und er kennt drei
> Werte: AN, AUS und **unbekannt** — solange nicht gefragt wurde, behauptet der Schalter nichts.
> Gelesen wird er aus `ecosystem_enabled` des öffentlichen Lesepfads, nicht aus einem Schreibruf.
> **Ausschalten fragt nach** und nennt die Folge: der öffentliche Lesepfad liefert dann keine
> Flächen mehr, die Landschaften verschwinden für alle von der Karte. Gezeichnet bleibt alles.

## 8. Gipfel

Sichtbar bei aktiver Topographie, **alle** — auch die ohne Wiki-Eintrag, die auf
der öffentlichen Karte nicht erscheinen.

| Geste | Wirkung |
|---|---|
| Gipfel ziehen | verschiebt **das Label in `map_features`** — dieselbe Zeile, die der Standard-Layer zeigt |
| Gipfel anklicken | Panel zeigt Name und Höhe |
| Höhe eintragen | schreibt in `properties_json` des Labels |
| Rechtsklick → „Höhenpunkt setzen" | legt ein `berggipfel`-Label **ohne** Wiki-Link an — ein Arbeitspunkt |

> **Es gibt keine zweite Positionsliste.** Der Gipfel ist ein Objekt in zwei
> Ansichten. Wer ihn hier verschiebt, verschiebt ihn auf der Standardkarte, und
> umgekehrt. Deshalb ist auch nichts zu synchronisieren.

⚠️ **Jede Gipfeländerung — verschieben, anlegen, löschen, Höhe ändern — macht die
Vorberechnung der enthaltenden Fläche ungültig.** Derselbe begrenzte Nachlauf wie
bei einer geänderten Geometrie, nur mit dem Label als Auslöser.

## 9. Speichern

| Was | Wann |
|---|---|
| Geometrie (Ecke, Kante, neue Fläche) | **sofort beim Loslassen**, ohne Nachfrage |
| Felder (Name, Typ) | eigener Speichern-Knopf mit Statuszeile — im Dialog aus **§7b** |
| Höhe | noch nicht gebaut (V8, Höhenfeld) |

Es gibt **keinen Entwurfszustand** und keinen „ungespeicherte Änderungen"-Dialog.
Geometrie ist entweder gezogen oder nicht. Für die Felder gilt das Muster des
Strömungsfaktors bei den Flusswegen: kleines Feld, eigener Knopf, eigene
Statuszeile, Herkunftsangabe daneben.

## 10. Löschen

**Fläche löschen** — aus dem Kontextmenü, weich (`is_active=0`).

**Region löschen** — im Eigenschaften-Dialog (§7b). Löscht **ihre Flächen mit**, und
die Rückfrage sagt wie
viele: *„Region ‚Nebelmoor' mit 2 Flächen löschen?"* Eine Region ohne Flächen ist
kein Fehler (sie ist bloß unsichtbar), aber eine Fläche ohne Region kann es nicht
geben.

## 11. Was der Editor bemängelt, ohne zu blockieren

Nichts davon verhindert das Speichern. Es sammelt sich als **Aufgabenliste**,
nach dem Muster des „Fehlt"-Reiters bei den Territorien:

| Befund | warum es auffällt |
|---|---|
| `gebirge`-Fläche **ohne Gipfel** darin | kein Höhenfeld → die Fläche tut nichts |
| Gipfel **in keiner** topographischen Fläche | wirkt nirgends |
| Region **ohne Typ** | kein Abnehmer kann sie auswerten |
| Region **ohne Fläche** | steht in der Liste, ist auf der Karte nicht da |
| Zwei Flächen **derselben** Ebene überlappen sich | erlaubt, aber meist ein Versehen |
| Wiki-Name passt nicht zum Label darunter | Zuweisung vermutlich verrutscht |

## 12. Was der Editor ausdrücklich nicht tut

- **Keine Hierarchie.** Regionen liegen nebeneinander, nicht ineinander. Kein
  Elternteil, keine Vererbung, kein Breadcrumb.
- **Keine Zoom-Bänder.** Was in Zoom 7 gezeichnet wird, gilt in Zoom 1.
- **Keine Gültigkeitsjahre.** Landschaften sind statisch.
- **Keine abgeleiteten Außengrenzen.** Es gibt keine Kinder, aus denen sich etwas
  ableiten ließe.
- **Keine Reisezeiten.** Der Editor zeigt keine Faktoren und keine Routenwirkung.
  Das rechnet ein Stapellauf, und der ist ein *Abnehmer* — er kommt später und
  ändert an diesem Editor nichts.
- **Kein Zugriff auf politische Werkzeuge.** Die Werkzeuge sind Kopien; die
  Territorien werden nicht angefasst (`oekosystem-r2-auftrag.md`, harte Regel).

## 13. Offen, bis die Editoren geantwortet haben

- **`ebene` als Typ** — bleibt nur, wenn es sich anders verhält als „normal".
- **`kueste`** — eine Linie mit Breite, kein Gebiet. Steht auf der Bedeckungsliste,
  weil das Wiki sie führt; ob sie sich als Fläche zeichnen lässt, ist ungeprüft.
- **Taste zum Umschalten** — `E` ist ein Vorschlag, kein Beschluss.
- **Ob Überlappung innerhalb einer Ebene wirklich nur gemeldet und nicht verhindert
  werden soll.**
