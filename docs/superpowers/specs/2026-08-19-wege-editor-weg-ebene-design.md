# Der Wege-Editor bekommt eine Weg-Ebene

**Entwurf, 19.08.2026** · Mockup: `docs/wege-editor-weg-ebene-mockup.html` (Owner: „wow so isses
perfekt")

Betroffen: `html/wege-editor.html`, `js/pages/wege-editor.js`, `js/pages/wege-editor-model.js`,
`api/edit/map/paths-editor.php`, `api/_internal/map/features.php`.

---

## 1. Anlass

Owner, wörtlich: „im moment kann ich nicht auf einen einzelnen eintrag klicken z.b. der
schattenbachpass. für die editoren war/ist es mühselig alle abschnitte zu konfigurieren."

Ein Weg ist auf der Karte in Abschnitte zerlegt — der Schattenbachpass in acht, die Reichsstraße 1
in 26. Der Editor zeigt sie gruppiert, aber **bearbeiten** lässt sich nur ein Abschnitt. Wer einem
Pass die Kutsche verbieten will, klickt sich achtmal durch dieselbe Maske.

Drei Dinge, alle im Mockup:

1. Die Weg-Zeile wird auswählbar; ihre Eigenschaften gelten für alle Abschnitte.
2. Das Höhenprofil zeigt den **ganzen** Weg, nicht nur einen Abschnitt.
3. Die Menübandkachel „Wiki zuweisen" fällt weg.

---

## 2. Befund: was heute schon für den ganzen Weg gilt

Gemessen am Code, nicht vermutet — das Gefühl des Owners („ich glaube das tun sie teilweise") war
richtig, und zwar für genau zwei Dinge:

| Feld | Reichweite heute | Wo |
|---|---|---|
| `transport_seasons` (Gangbarkeitsfenster) | **ganzer Wiki-Weg** | `avesmapsApplyTransportSeasonsToWikiSiblings`, `api/_internal/map/features.php` |
| Wiki-Zuweisung (`assign_to` / `clear_assign`) | **ganze Namensgruppe** | `api/_internal/wiki/paths.php`, `single_segment` ist die Ausnahme |
| `feature_subtype` (Wegtyp) | nur dieser Abschnitt | `avesmapsUpdatePathFeatureDetails` |
| `allowed_transports` | nur dieser Abschnitt | ebenda |
| `other_source`, `show_label`, `name` | nur dieser Abschnitt | ebenda |

⭐ **Der Sammel-Schreibweg ist also kein neues Konzept, sondern die Ausweitung eines vorhandenen.**
Das Vorbild steht fertig da und wird nachgefahren, nicht neu erfunden: je Segment gegen dessen
eigenen Zustand gefiltert, nichts anfassen, was sich nicht ändert, je Segment eine eigene
Protokollzeile.

---

## 3. Die Auswahl

Die Gruppenzeile (`.wp-group`) trägt heute nur die Aufklapp-Geste. Sie bekommt zusätzlich die
Auswahl:

- **Klick auf die Zeile** wählt den Weg *und* klappt ihn auf (er muss offen sein, sonst sieht man
  nicht, worauf man gerade schreibt).
- **Klick auf den Pfeil** (`.wp-group__twist`) klappt nur, ohne die Auswahl zu ändern —
  `stopPropagation`. Das ist die Geste, die es heute schon gibt; sie darf nicht verschwinden.
- Der Zustand ist `state.selected` **oder** `state.selectedGroup`, nie beides. Ein Wechsel setzt
  das jeweils andere auf `null`.

🔴 **Ein einteiliger Weg bekommt KEINE Weg-Ebene.** `wpGroupWays` liefert für ihn eine Gruppe mit
einem Segment, und `renderList` zeichnet dafür schon heute die Segmentzeile statt eines
Gruppenkopfs („die Zeile IST der Weg"). Zwei Masken für dasselbe Objekt wären eine Divergenz, die
auf ihren ersten Unterschied wartet — bei einem Abschnitt gilt weiter die Abschnittsmaske.
⚠️ Am Livebestand ist das die Mehrheit der Zeilen: 4160 Namensgruppen auf 3721 Wege
(`js/ui/listen-statuskreis.js`), die meisten einteilig.

---

## 4. Die Sammel-Eigenschaften

Die mittlere Spalte zeigt dieselben Felder wie heute, mit einem Kopfband darüber, das den
Geltungsbereich benennt, und einer Speicherleiste, die ihn wiederholt („Speichern für 8
Abschnitte"). Owner-gesehen im Mockup.

### 4.1 DIE EINE REGEL

💣 **Geschrieben wird nur, was der Editor ANGEFASST hat.** Ein Sammel-Speichern, das alle Felder
schreibt, macht jede gewollte Ausnahme platt — und zwar lautlos, weil das Formular alle Felder
mitschickt.

Das ist keine theoretische Sorge: derselbe Fehler ist am 17.08.2026 in
`avesmapsUpsertGameLiterature` gemessen worden (jedes *mitgeschickte* Feld wurde auf `manual`
gestempelt, nach einem Speichern trug dort jedes Feld „von Hand"). Die Lehre steht in AGENTS.md §11
und gilt hier wörtlich.

Umsetzung: der Client schickt **`fields`** — die Liste der Feldnamen, die er wirklich setzen will.
Was nicht drinsteht, wird nicht angefasst.

### 4.2 Die drei Zustände je Feld

| Feld | gleich in allen Abschnitten | uneins |
|---|---|---|
| `feature_subtype` | Wert steht im Wähler | zusätzliche, **vorausgewählte** Option „— gemischt lassen —" |
| `allowed_transports` (je Fahrtyp) | Haken an/aus | Haken **halb** (`indeterminate`) + Zähler „2 von 8" |
| `other_source`, `name`, `show_label` | Wert steht im Feld | leer, Platzhalter „gemischt" |

⚠️ **Der halbe Haken ist ein eigener Wert, kein „aus".** Bleibt er halb, steht der Fahrtyp nicht in
`fields` und kein Abschnitt ändert sich. Ein Klick macht ihn voll oder leer, und *dann* gilt er für
alle. Ein `indeterminate`-Haken, den ein Klick auf „aus" zieht, hätte im Schattenbachpass die
Kutsche in zwei Abschnitten stillschweigend gelöscht.

💣 **Der Zähler gehört IN die Namenszelle** (`.dt-tt__name`), nicht als dritte Zelle daneben.
`.dt-tt` ist ein Flex mit `flex-wrap: wrap` und rechts fest breiten Zeitfeldern; eine dritte Zelle
drückt die Zeile in den Umbruch — im Mockup gemessen: 56 px statt 31, und genau dieser Befund steht
schon als Warnung an der `.dt-tt`-Regel in `css/components/editor-page.css`.

### 4.3 Der Wegtyp bestimmt, welche Fahrtypen überhaupt dastehen

⚠️ `wpVerkehrsdomaene(feature_subtype)` entscheidet, ob die Land- oder die Wasser-Fahrtypen
angezeigt werden. Bei „gemischt" wird die Domäne des **ersten** Abschnitts genommen — und wenn eine
Gruppe Land und Wasser mischt, wird die Fahrtyp-Liste ganz weggelassen samt Hinweis, statt eine
falsche Hälfte anzubieten.

✅ **Belegt, 19.08.2026:** es gibt genau zwei solche Gruppen — „Knüppeldamm von Drôl nach Port
Corrad" (9 Abschnitte) und „Angra" (2). Der Fall ist damit nicht vorsorglich gebaut, sondern
gemessen (§12).

---

## 5. Der Schreibweg

Neue Aktion **`update_path_group_details`** in `api/edit/map/features.php`, Fähigkeit `edit` wie
`update_path_details`.

```
{ action: "update_path_group_details",
  public_ids: ["…", "…"],          // die Abschnitte, wie der Editor sie zeigt
  fields: ["feature_subtype", "allowed_transports"],
  feature_subtype: "Gebirgspass",
  allowed_transports: [...], … }
```

💣 **Der Client schickt die `public_ids`, der Server bildet die Gruppe NICHT nach.** Die
Gruppierungsregel steht in `wpGroupWays` (`wiki_key`, sonst Art+Name) — sie serverseitig zu
wiederholen wäre die zweite Wahrheit, vor der AGENTS.md §5 warnt, und sie liefe beim ersten
geänderten Namen auseinander.
⚠️ Der Preis: eine Liste kann veralten, wenn jemand parallel ein Segment umhängt. Der Server prüft
deshalb je Zeile `feature_type = 'path' AND is_active = 1` und überspringt still, was nicht mehr
passt; die Antwort nennt die Zahl der wirklich geschriebenen Abschnitte.

Weiter wie beim vorhandenen Geschwister-Schreiber:

- **Nichts anfassen, was sich nicht ändert** — sonst hebt ein Speichern ohne Änderung die Revision
  jedes Segments und schickt jedem warmen Client die halbe Karte neu.
- **Je Segment eine eigene Protokollzeile** (`avesmapsWriteMapAuditLog`), nicht eine für den
  ganzen Weg: das Rückgängig arbeitet auf Feature-Ebene, ein Sammelvermerk ließe sieben von acht
  Änderungen außerhalb der Historie stehen.
- **Eine Revision für den ganzen Lauf.**

🔴 `transport_seasons` bleibt beim alten Weg (`avesmapsApplyTransportSeasonsToWikiSiblings`) — es
propagiert bereits über den `wiki_key` und darf nicht zusätzlich über die `public_ids` laufen, sonst
schreiben zwei Regeln dasselbe Feld mit verschiedener Reichweite.

---

## 6. Das Gesamt-Höhenprofil

Neue Aktion **`group_detail`** in `api/edit/map/paths-editor.php`: nimmt die `public_ids`, liefert
je Abschnitt, was `detail` heute für einen liefert — plus die **Endpunkte** der Geometrie, die die
heutige Antwort nicht enthält (sie gibt nur `piece_lengths` heraus).

### 6.1 Die Kette

Die Abschnitte liegen in der Liste nach `bbox`-Ecke sortiert — das ordnet sie *ungefähr* von West
nach Ost und ist für eine Kurve **nicht** gut genug. Gebaut wird eine echte Kette:

1. Endpunkte zu Knoten zusammenfassen, die **näher als 0,001 Einheiten (3 Meter)**
   beieinanderliegen.
   🪤 Hier stand „auf 5 Nachkommastellen runden (dieselbe Rundung, mit der
   `avesmapsAddClientCompatiblePathConnection` Wege an Orten teilt)" — beim Bau an den Daten
   gemessen und **zweifach widerlegt**: die Zahl ist zu fein (sie fängt 1 % statt 19 %, §12),
   und eine Rundung ist überhaupt keine Toleranz, sondern ein Raster. Die Begründung steht in
   §12 und an der Konstante `WP_CHAIN_TOLERANZ`.
2. Segmente sind Kanten; die Kette ist der Pfad durch sie.
3. Ein Knoten mit **einer** Kante ist ein Ende, mit **zwei** ein Durchgang, mit **drei oder mehr**
   eine Verzweigung.

💣 **Ein Segment, das rückwärts in der Kette liegt, muss GEDREHT werden** — und Drehen heißt hier
mehr als die Stückliste umkehren. Die vier Zahlen je Wegstück sind
`[Anstieg, Abstieg, steiler Anstieg, steiler Abstieg]` **in Speicherrichtung**
(`avesmapsTerrainProfileForLine`, `api/_internal/app/terrain-store.php`); gedreht wird zu
`[Abstieg, Anstieg, steiler Abstieg, steiler Anstieg]`, also paarweise getauscht. Wer nur die Liste
umdreht, bekommt eine Kurve, die bergauf läuft, wo der Weg bergab geht — und die Zahl darunter
stimmt trotzdem, weil die Summen sich nicht ändern. Es fällt also nicht auf.

### 6.2 Wenn die Kette bricht

⚠️ Verzweigungen und Lücken sind der Normalfall, nicht die Ausnahme: „Reichsstraße 1" trägt 26
Segmente über den halben Kontinent.

- **Mehrere Teilketten** → jede bekommt ihre eigene Kurve, untereinander, mit der Zahl ihrer
  Abschnitte. Kein Zusammenkleben über die Lücke.
- **Verzweigung** → die längste Kette wird gezeichnet, die Abzweige darunter genannt.
- Der Kasten sagt in einem Satz, was er zeigt („8 Abschnitte, lückenlos" bzw. „3 Teilstücke, nicht
  verbunden").

🔴 **Eine erfundene Verbindung ist schlimmer als ein fehlendes Bild.** Wo die Kette nicht aufgeht,
wird das gesagt, nicht überbrückt.

### 6.3 Was der Kasten zeigt

Umschalter mit drei Stufen (heute zwei): **Ganzer Weg · je Abschnitt · je Wegstück**.

- *Ganzer Weg*: die Kurve über die Kette, Abschnittsgrenzen gestrichelt mit Nummer.
  ⚠️ Beschriftet wird nur, wo Platz ist — ein 1,9-Meilen-Abschnitt neben einem 28,7-Meilen-Abschnitt
  bekommt keine Nummer ins Bild.
- *je Abschnitt*: eine Tabelle (`.wp-tab-num`), eine Zeile je Abschnitt, Summenzeile
  `is-reference` — dieselbe Form wie die heutige Wegstück-Tabelle.
- *je Wegstück*: unverändert die heutige Tabelle, jetzt über alle Abschnitte.

Die Kennzahlen darunter gelten dem ganzen Weg. Neu dabei: **höchster Punkt über Start** (bei einem
Pass die Zahl, die man sucht) und **Abschnitte · Wegstücke**.

💣 Die Zeitfaktoren des ganzen Weges werden aus den **Summen** gerechnet, nicht aus den
Abschnittsfaktoren gemittelt: `wpLeistungsFactor` ist ohne Deckel additiv, mit Deckel nicht — die
Begründung steht wörtlich an der Funktion (`options.capped`). Ein Mittelwert über gedeckelte
Faktoren wäre eine andere Zahl als der Faktor des Ganzen.

---

## 7. „Wiki zuweisen" fällt weg

Die Kachel löst `assign_all` aus — den Massenlauf, der jeden Abschnitt mit passendem Namen mit
seinem Wiki-Weg verknüpft. Owner: „ist glaub nicht mehr nötig."

Er hat recht, und der Grund steht im Code: seit dem 16.08.2026 sitzt die Zuweisung im geteilten
Bauteil in der Eigenschaften-Spalte, und `assign_to` erfasst dort **ohne** `single_segment` ohnehin
die ganze Namensgruppe. Der Massenlauf war die Erstbefüllung.

🔴 **Nur die Kachel geht, nicht die Maschinerie.** `assign_all` bleibt serverseitig, und
`js/ui/wiki-massenzuweisung.js` trägt denselben Ablauf für den Landschaften-Editor. Die Kachel hatte
bis zum 16.08.2026 gar keinen Aufrufer — dieser Zustand kehrt zurück, mit einem Vermerk an der
Stelle, damit ihn niemand als Lücke „repariert".

⚠️ Damit stehen fünf Kacheln im Menüband. Das trägt das Grid von selbst
(`grid-auto-columns: minmax(0, 1fr)`), die Beschriftungen werden nur breiter.

---

## 8. Nebenbei: ein Bestandsfehler

Die Wegeliste hat eine waagerechte Bildlaufleiste — auf dem Screenshot des Owners vom 19.08.2026
unten links zu sehen, im Mockup nachgemessen: 12 px Überbreite.

Ursache: `.avm-row` trägt `width: 100%` (`css/components/editor-row.css`, eingeführt für die
`<button>`-Zeilen zweier anderer Editoren), und `.wp-segment` setzt zusätzlich
`margin-left: var(--space-10)`. Volle Breite plus Rand.

Fix: `.wp-segment { width: auto; }`. ⚠️ **Nicht** `width: 100%` an `.avm-row` entfernen — dann
verlieren Literatur- und Karteneditor ihre Zeilenbreite.

---

## 9. Die Fallen auf einen Blick

1. 💣 Nur angefasste Felder schreiben — sonst macht ein Sammel-Speichern jede Ausnahme platt.
2. 💣 Der halbe Haken ist ein Wert, kein „aus".
3. 💣 Der Server bildet die Gruppe nicht nach; der Client schickt die `public_ids`.
4. 💣 Ein gedrehtes Segment tauscht seine vier Profilzahlen **paarweise**, nicht nur die Reihenfolge.
5. 💣 Zeitfaktoren des Ganzen aus den Summen, nie als Mittel über gedeckelte Abschnittsfaktoren.
6. 💣 Der „gemischt"-Zähler gehört in die Namenszelle, sonst bricht die Zeile um.
7. 🔴 `transport_seasons` behält seinen alten Propagationsweg — keine zweite Regel auf dasselbe Feld.
8. 🔴 Einteilige Wege behalten die Abschnittsmaske.
9. 🔴 Eine gebrochene Kette wird gezeigt, nicht überbrückt.

---

## 10. Auslieferung — vier Züge, nicht einer

🔴 AGENTS.md §9: sichtbare Änderungen gehen **einzeln** live, und der Owner sieht jede. Das hier ist
Editor-Oberfläche, also gilt es. Reihenfolge, jeder Zug für sich lauffähig:

| Zug | Inhalt | sichtbar |
|---|---|---|
| 1 | Bestandsfehler §8 (`width: auto`) + Kachel „Wiki zuweisen" raus (§7) | ja, klein |
| 2 | Auswahl der Weg-Ebene + Sammel-Eigenschaften + Schreibweg (§3–§5) | ja, das Herzstück |
| 3 | Gesamt-Höhenprofil samt Kettenbau (§6) | ja |
| 4 | Die zwei Messungen aus §12 nachtragen | nein |

⚠️ Zug 2 ist nicht weiter teilbar: eine auswählbare Weg-Zeile ohne Schreibweg ist eine Maske, deren
Speichern-Knopf lügt.

---

## 11. Tests

| Test | Zusichert |
|---|---|
| `js/pages/__tests__/wege-gruppe-felder.test.js` | „gemischt" wird erkannt; ein halber Haken landet **nicht** in `fields` |
| `js/pages/__tests__/wege-gruppe-kette.test.js` | Kettenbau: geschlossene Kette, Lücke → zwei Teilketten, Verzweigung; ein gedrehtes Segment tauscht `[a,d,sa,sd]` → `[d,a,sd,sa]` |
| `js/pages/__tests__/wege-gruppe-profil.test.js` | Faktor des Ganzen aus Summen == Faktor der ungedeckelten Rechnung; Mittelwert weicht ab (der Zeuge) |
| `api/_internal/map/__tests__/wege-gruppe-schreiben-test.php` | nur `fields` werden geschrieben; unveränderte Segmente bekommen keine neue Revision; je Segment eine Protokollzeile; eine tote `public_id` wird still übersprungen |

---

## 12. Gemessen (19.08.2026, am Livebestand)

Die beiden offenen Punkte sind beantwortet — ein einziger Abruf des öffentlichen
Kartenpayloads (5994 Wege), ausgewertet mit demselben `wpGroupWays`/`wpChainSegments`, das der
Editor fährt.

### Wie viele Wege bekommen die Weg-Ebene überhaupt?

| | |
|---|---|
| Namensgruppen gesamt | **4157** |
| davon einteilig (behalten die Abschnittsmaske) | 3741 |
| davon mehrteilig (**bekommen die Weg-Ebene**) | **416** |

### Wie oft geht die Kurve durch?

| | |
|---|---|
| eine durchgehende Kette | **143** (34 %) |
| mehrere Teilstücke | **273** (66 %) |

🔴 **Die mehrteilige Kurve ist der Normalfall, nicht der Ausnahmefall** — zwei Drittel. Der
Entwurf hat das vermutet; jetzt ist es gezählt. Die Ursache ist fast immer eine **Lücke**
(236 Gruppen), nicht eine Verzweigung (0 allein, 55 mit beidem): die Segmente einer
Reichsstraße hängen schlicht nicht aneinander. Damit ist die getrennte Darstellung keine
Notlösung für einen Randfall, sondern das, was man meistens sieht.

### 💣 Und der Befund, der den Bau geändert hat: die Toleranz

Freie Enden derselben Gruppe liegen **entweder winzig auseinander oder weit** — dazwischen ist
fast nichts:

| Abstand zum nächsten freien Ende | Anteil |
|---|---|
| unter 0,001 Einheiten (3 Meter) | **19 %** |
| unter 0,01 Einheiten | 20 % |
| unter 0,1 Einheiten | 22 % |
| Median | **4,12 Einheiten (12,4 Meilen)** |

Die erste Gruppe ist Zeichenungenauigkeit, die zweite sind echte Lücken. §6.1 wollte auf fünf
Nachkommastellen runden (die Zahl aus `client-graph.php`) — das fängt **1 %** und ließe 362
offensichtlich gemeinte Verbindungen zerfallen. Gebaut ist deshalb eine Toleranz von **0,001
Einheiten**.

💣 **Und sie ist eine DISTANZ, keine Rundung.** Der erste Bau rundete beide Punkte und verglich
die Ergebnisse. Das ist ein Raster, keine Toleranz: `10,0` und `10,0005` fallen in verschiedene
Zellen und finden sich nicht, während `10,0004` und `10,0006` sich finden — ob zwei Enden
zusammengehören, hinge dann davon ab, *wo* sie liegen, nicht *wie weit* sie auseinander sind.
Gefunden hat das der Test, nicht der Autor. Gebaut ist jetzt ein Gitter mit Maschenweite =
Toleranz und einer 3×3-Sonde (dasselbe Verfahren wie das Segment-Gitter des
Kreuzungs-Prüfhakens); Laufzeit für alle 4157 Gruppen: 0,24 s.

⚠️ Eine feinere Verbindung ergibt **nicht** überall weniger Teilstücke: wo zwei Enden
verschmelzen, entsteht mitunter ein Knoten mit drei Kanten, und dort endet die Kette zu Recht.
Gemessen: „Reichsstraße 3" 20 → 2 Teilstücke, „Reichsstraße 1" 8 → 13. Die Zahl der
Teilstücke ist kein Gütemaß; behauptet wird in keinem Fall etwas Falsches.

### Mischt eine Gruppe Land- und Wasserabschnitte?

**Ja, zweimal:** „Knüppeldamm von Drôl nach Port Corrad" (9 Abschnitte) und „Angra" (2). Der
Sonderfall aus §4.3 ist damit belegt und nicht bloß vorsorglich gebaut — bei beiden lässt der
Editor die Fahrtyp-Liste weg und sagt, warum.

### Weiterhin offen

- 🔧 **Kein Handgriff lief je gegen die echte Datenbank oder im Browser.** Der Sammel-Schreibweg
  ist gegen eine SQLite-Karte gefahren, die Oberfläche in einem Sandkasten gebootet und
  geklickt — aber niemand hat mit angemeldeter Sitzung einen Weg ausgewählt und gespeichert.
- 🔧 Ob die Weg-Ebene auch die **Flussrichtung** sammeln soll. Bewusst draußen: sie ist je
  Segment eine Richtung entlang der gezeichneten Geometrie, und „alle gleich" hat dort keine
  Bedeutung.
