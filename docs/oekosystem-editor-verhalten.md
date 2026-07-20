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

**Rechtsklick auf die Karte → „Landschaftsfläche anlegen".** Kein Knopf in einer
Werkzeugleiste; derselbe Weg wie bei den Territorien.

> **Die aktive Ebene entscheidet, wo die Fläche landet.** Das ist die einzige
> Regel dafür. Wer im Topographie-Modus anlegt, bekommt eine topographische
> Fläche — es gibt keine Nachfrage und keine Auswahlliste.

Es entsteht: eine **neue Region** ohne Namen und ohne Typ, mit **einer** kleinen
Fläche am Klickpunkt. Das Panel öffnet sich, der Fokus steht im Namensfeld.

Eine **zweite Fläche zu einer bestehenden Region** (das Moor in zwei Teilen) wird
nicht über den Rechtsklick angelegt, sondern im Panel: *„weitere Fläche zeichnen"*.
Der Grund ist Zweideutigkeit — beim Rechtsklick ins Leere wäre nicht zu erraten,
zu welcher Region das gehören soll.

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

**Zuweisung aus dem Wiki** ist R4 und läuft über Ziehen-und-Ablegen aus einer
Liste; im Panel bleibt sie als Feld sichtbar. Ohne Zuweisung ist die Region
`origin='own'` — für Gebiete, die es bei uns gibt und im Wiki nicht. Das ist
**kein Mangel**, sondern ein Zustand, der so benannt wird.

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
| Felder im Panel (Name, Typ, Höhe) | eigener Speichern-Knopf mit Statuszeile |

Es gibt **keinen Entwurfszustand** und keinen „ungespeicherte Änderungen"-Dialog.
Geometrie ist entweder gezogen oder nicht. Für die Felder gilt das Muster des
Strömungsfaktors bei den Flusswegen: kleines Feld, eigener Knopf, eigene
Statuszeile, Herkunftsangabe daneben.

## 10. Löschen

**Fläche löschen** — aus dem Panel oder dem Kontextmenü, weich (`is_active=0`).

**Region löschen** — löscht **ihre Flächen mit**, und die Rückfrage sagt wie
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
