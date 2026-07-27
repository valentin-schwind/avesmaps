# Landschaften-Editor — Verhalten und Funktion

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
              Art           Auswahl aus dem Vokabular DIESER Ebene
              (dazu: wie viele Flächen die Region trägt)
Wiki-Landschaft             Zuweisen/Ändern · Sync · Entfernen, mit der vollen Wiki-Auskunft
                            Löschen · Abbrechen · Speichern
```

Er schreibt `update_region` bzw. `delete_region` — beide waren seit V2.3 gebaut und
hatten bis dahin **keinen einzigen Aufrufer**: Name, Art und Wiki-Link ließen sich nur
beim Anlegen setzen, und eine Region war überhaupt nicht löschbar.

> 🪤 **Dieser Dialog bearbeitet die FLÄCHE, nicht das Label.** Der optisch fast gleiche
> *„Region bearbeiten"* (`#label-edit-overlay`) bearbeitet eine **Beschriftung** in
> `map_features` — daher dessen Größe, Rotation, Zoom-Bänder und Priorität, die hier
> alle fehlen: eine Fläche hat keine (§12). Es sind zwei Zeilen in zwei Tabellen.
> **Wer die Fläche umbenennt, benennt das Karten-Label nicht mit um.**
> `ecosystem_region.label_public_id` könnte beide koppeln, tut es heute nicht.

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
