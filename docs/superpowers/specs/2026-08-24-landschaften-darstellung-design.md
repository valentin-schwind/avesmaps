# Der Landschaften-Editor und das Fenster „Darstellung"

**Stand 24.08.2026.** Entwurf, vom Owner am Prototyp abgenommen.
Prototyp: `docs/landschaften-darstellung-mockup.html` (lauffähig, liest echte Tokens und echte
Geometrien).

---

## §0 Kurzfassung

Der siebte Listen-Editor heißt künftig **„Landschaften bearbeiten"**, verliert eine Kachel, bekommt
ein neues Recht — und ein neues Fenster **„Darstellung"**, in dem steht, wie Landschaftsflächen und
ihre Namen auf der Karte aussehen.

Fünf Dinge:

1. Umbenennungen: „Regionen bearbeiten" → **„Landschaften bearbeiten"**, „Zoombänder" (unter Orte) →
   **„Darstellung"**.
2. Die Kachel **„Wiki zuweisen" fällt weg**.
3. **„Kurven rechnen" darf jeder Editor**, und der einmalige Umstelllauf fliegt raus.
4. Das neue Fenster **„Darstellung"** mit vier Reitern.
5. Im Beschriftungsdialog erscheinen die Vorgaben als **Marke auf dem Regler**.

---

## §1 Umbenennungen — Beschriftung wandert, Kennung nicht

| Heute | Künftig | Ort |
|---|---|---|
| „Regionen bearbeiten" | **„Landschaften bearbeiten"** | Knopf `#ecosystem-editor-open` in `index.html`, Fenstertitel in `html/landschaften-editor.html`, Überschrift in `js/review/review-ecosystem-list.js` |
| „Zoombänder" | **„Darstellung"** | Knopf `#seZoomBands` in `html/wiki-sync-settlement-editor.html` |

🔴 **Nur die Beschriftung.** `ecosystem.editor.title`, `seZoomBands`, `zoomBandsState`, sämtliche
Dateinamen und der i18n-Schlüsselraum bleiben, wie sie sind — dieselbe Trennung wie bei
„Neuigkeiten"/`changelog` (AGENTS.md §11). Der Deploy löscht nie; eine umgetaufte Adresse ließe eine
gecachte Seite ins Leere greifen.

⚠️ Damit heißen **zwei Kacheln „Darstellung"** und zeigen Verschiedenes — unter „Orte" die
Ortsklassen, unter „Landschaften" die Landschaften. Das war schon in
`2026-08-22-kurvenbeschriftung-design.md` §6 so entschieden und ist gewollt: der Ort sagt, worum es
geht. Die `title`-Zeile muss es trotzdem aussprechen, sonst ist es eine Falle für den Editor.

---

## §2 „Wiki zuweisen" fällt weg

Die Kachel `#ecoAssignAll` löst den Massenlauf `assign_all` aus. Owner: *„erfüllt aktuell keine
Funktion mehr"* — und das stimmt, aus demselben Grund wie beim Wege-Editor am 19.08.2026: seit dem
16.08.2026 sitzt die Zuweisung im geteilten Bauteil in der Eigenschaften-Spalte, und der Massenlauf
war die Erstbefüllung.

🔴 **Nur die Kachel geht, nicht die Maschinerie.** `assign_all` bleibt serverseitig, und
`js/ui/wiki-massenzuweisung.js` bleibt liegen. An der Stelle gehört ein Vermerk hin, damit niemand
den fehlenden Aufrufer als Lücke „repariert" — genau diesen Zustand hatte die Kachel schon einmal
(bis 16.08.2026), und ein Jahr lang sah toter Code wie eine Bedienung aus
(`refreshRegionBergStatus`, siehe `js/review/review-region-sync.js`).

---

## §3 „Kurven rechnen" darf jeder Editor

Die Kachel `#ecoCurves` (seit 23.08.2026) verlangt heute `admin`. Owner: *„ich möchte, dass ‚Kurven
rechnen' von jedem Editor verwendet werden kann"* — gemeint ist die **Person**, nicht ein zweiter
Ort für den Knopf.

* Endpunkt `api/edit/map/curve-labels-run.php`: Fähigkeit `admin` → **`edit`**.
* Der `title` der Kachel sagt heute „Nur Admin"; der Satz fällt.

🔴 **Und der einmalige Umstelllauf fliegt raus.** Er schaltet beim ERSTEN Lauf jede Fläche ein, deren
Name von Hand gedreht ist (rund 56). Owner: *„das einmalige Mapping kann weg, ich habe den Button
gedrückt."* Betroffen sind der `rollout`-Zweig im Endpunkt und seine Auswertung in
`runCurveLabels()`.

⚠️ Ein Lauf, der beim ersten Mal etwas anderes tut als beim zweiten, ist auf Dauer eine Falle — der
nächste Leser hält den toten Zweig für aktiv. Der Zustandsmerker in `app_setting` bleibt stehen (der
Deploy löscht nie), er wird nur nicht mehr gelesen.

---

## §4 Das Menüband danach

Sieben Kacheln, unverändert in der Zahl:

**🚨 Syncen · Zugehörigkeit rechnen · Höhenraster rechnen · Wegprofile rechnen ·
Geländeabhängiges Reisen · Kurven rechnen · Darstellung**

⚠️ `.avm-ribbon` ist ein Grid mit `grid-auto-columns: minmax(0, 1fr)`; die Zahl trägt sich selbst,
enger wird nur die Beschriftung. Der ganze Satz gehört ins `title`.

---

## §5 Das Fenster „Darstellung"

Form der Zoombänder (`modal-box wide`, 980 px, Erklärabsatz, Abschnitte mit Überschrift, unten
Speichern/Zurücksetzen). Darin **vier Reiter**, dieselben wie im Editor:
**Derographie · Vegetation · Topographie · Klimazonen**.

### §5.1 Eine Tabelle für Fläche UND Name

🔴 Owner 23.08.2026: *„mach aus ‚Flächen — Ton und Deckkraft' und ‚Namen — Farbe' eine Tabelle."*

| Spalte | Inhalt |
|---|---|
| Art | Beschriftung + Schlüssel |
| Fläche · Ton | Farbfeld + Hexwert |
| Fläche · Deckkraft | Regler **und** Zahlenfeld, beide in Prozent |
| Fläche · Vorschau | der Ton auf der echten Deckkraft über dem Kartengrund |
| Name · Farbe | Farbfeld + Hexwert |
| Name · Muster | der echte Name in echter Schrift **auf seiner eigenen Fläche** |
| ↺ | Zeile auf Vorgabe |

💣 **Die zwei Vokabulare decken sich NICHT, und die Tabelle sagt es.** Flächenarten kommen aus
`AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED` (33), Namensarten aus dem Beschriftungsdialog
(`#label-edit-subtype`, 31). Was auseinanderfällt:

* **`insel`** ist in der Topographie eine Fläche, sein Name steht unter Derographie → „— kein
  eigener Name —".
* **`fluss`, `berggipfel`, `vulkan`, `ebene`** haben einen Namen, aber keine Flächenart → „— keine
  Flächenart —", gekennzeichnet mit `°`.
* **Klimazonen** haben acht Flächen und keinen eigenen Namenston → „— Ton der Zone —".

⚠️ Die Zuordnung der vier `°`-Arten zu einem Reiter ist eine **Anzeige-Gruppierung für dieses
Fenster**, kein zweites Vokabular und kein Datenschlüssel. Wer sie glättet, erfindet eine Beziehung.

### §5.2 Die globale Deckkraft

Über der Tabelle ein Häkchen **„Eine Deckkraft für die ganze Ebene"** samt Regler und Zahlenfeld.

🔴 **Es ist der AUSGANGSZUSTAND, nicht die Ausnahme.** Heute hat die Karte genau das: eine Deckkraft
je Ebene, und zwar — gemessen in `css/features/ecosystem-layer.css` —

| Ebene | heutige Deckkraft der aktiven Fläche |
|---|---|
| Derographie | **0,16** |
| Vegetation | **0,72** |
| Topographie | **0,72** |
| Klimazonen | **0,30** |

💣 Es ist also **nicht eine Zahl für alle**. Wer „global" als einen Wert über alle vier Ebenen baut,
zieht diese vier zusammen — und die 0,16 der derographischen Behälter ist Absicht, keine
Nachlässigkeit. **„Global" heißt: für diese Ebene.**

💣 **Der globale Wert überschreibt die Zeilenwerte, er löscht sie nicht.** Ein Häkchen ist keine
Datenänderung. Die Zeilenregler bleiben stehen und zeigen weiter ihren eigenen Wert, nur stumm; das
Abnehmen gibt die Arbeit unverändert zurück. Am Prototyp nachgemessen: Zeile auf 15 %, global an,
global aus → die 15 % steht noch da.

⚠️ **„Ruhend = unsichtbar" bleibt unangetastet.** Der Regler ersetzt nur die Deckkraft der AKTIVEN
Ebene. Sonst läge über „Alle" wieder das Farbnetz, das AGENTS.md §12 ausdrücklich abgeschafft hat.

### §5.3 Das Zoomband je Art

🔴 Owner 24.08.2026: *„was spricht dagegen es wie bei ‚Orte bearbeiten' zu machen?"* — nichts. Die
Bauform ist die von `renderZoomBandLegend` / `makeZoomBandStageButton`: Farbstrich, Name,
`z0…z7`-Leiste, `aus`, Rücksetzer.

💣 **EIN Unterschied, und er ist der Grund, warum es keine Abschrift ist: die Siedlungen haben EIN
Ende, die Landschaftsnamen ZWEI.** Dort setzt ein Klick die eine Erscheinungsstufe, und die Kurve
läuft von da bis zMax. Eine Landschaftsbeschriftung hat `min_zoom` **und** `max_zoom`, und das aus
gutem Grund: **ein Kontinentname soll beim Hineinzoomen verschwinden.** Wer das Siedlungsmodell eins
zu eins übernimmt, verliert das obere Ende und damit die halbe Aussage.

Deshalb:

* Die Leiste färbt den **ganzen Bereich** als Strecke, nicht eine Stufe.
* **Ein Klick zieht das nähere Ende.** Kein Modus, kein Umschalt-Klick, keine zweite Leiste.
  ⚠️ Bei Gleichstand gewinnt „ab" — eine Regel muss auch in der Mitte entscheiden, sonst hängt das
  Ergebnis an Rundung.
* **`aus`** = die Art trägt nirgends einen Namen. 🔴 Kodiert als `bis < ab`, nicht als eigener
  Schalter: ein dritter Zustand neben den zwei Enden wäre eine dritte Wahrheit über dieselbe Sache.
* 🔴 **z8 erbt z7** — die Karte kennt Stufe 8 nicht (`maxZoom: 7`), dieselbe Regel wie bei den
  Zoombändern.

**Vorgabe: z0–z7 für jede Art** — die heutigen Werte aus `index.html`. Bewusst keine erfundene
Staffelung je Art: die hat nie jemand entschieden, und eine geratene Vorgabe sähe aus wie eine.

Der Größenplot zeichnet jede Kurve **nur durch ihr Band**. Eine Art, die bei z3 verschwindet, hat bei
z4 keine Schriftgröße; eine durchgezogene Linie dorthin behauptete einen Wert, den es nicht gibt —
dieselbe Regel wie `null` in den Zoombändern.

### §5.4 Der Median — unser Werkzeug, nicht ihres

Je Zeile ein Knopf **„Median ermitteln"**, rechts von `aus`. Nach dem Messen heißt er
`Median z3–z7`, die betroffenen Stufen bekommen einen Saum, und daneben erscheint **„übernehmen"**.

🔴 **Zwei Verben, zwei Knöpfe.** Messen schreibt nichts, Übernehmen setzt die Vorgabe. Ein Knopf, der
beides täte, nähme dem Owner die Entscheidung ab, die er gerade erst sichtbar gemacht hat.

🔴 **Der Median erreicht die Editoren NIE** (Owner 24.08.2026: *„wir ermitteln den median, der wert,
den die editoren sehen ist der wert aus der zoombandeinstellung"*). Er ist das Werkzeug, mit dem wir
die Vorgabe festlegen. Eine Median-Marke im Beschriftungsdialog hieße „richte dich nach dem
Durchschnitt" — das Gegenteil einer Vorgabe: sie zementierte den Bestand, statt ihn zu lenken.

🪤 Im Prototyp stand eine solche graue Marke kurzzeitig und ist am selben Tag wieder gefallen. Der
Vermerk steht im Code, damit sie niemand „ergänzt".

🔧 **Die Medianwerte im Prototyp sind Beispiele, nicht gemessen** — siehe §9.

### §5.5 Die Schriftgröße

Ein ziehbarer Plot, Bauform der Zoombänder: eine Kurve je Art über z0…z8, linear von 4 bis 30 pt.
Jede Kurve trägt den Ton ihrer eigenen Art.

🔴 **Das Feld „Größe" am einzelnen Label fällt weg** (Owner, erste Sitzung). Die Größe wird global je
Art und Zoomstufe.

💣 **DAS FELD BLEIBT ALS `hidden` STEHEN.** Der Payload liest `formData.get("size")`, und OHNE das
Feld schriebe jedes Speichern eine 0 über den gespeicherten Wert. Das ist wörtlich dieselbe Falle,
die zwei Zeilen darüber schon für `rotation` dokumentiert ist (`index.html`, Kurvenbeschriftung §8).
Der Wert ist zugleich der einzige Rückweg, falls die Sache je zurückgebaut wird.

⚠️ **Die Vorgabe kann das heutige Bild NICHT Ziffer für Ziffer reproduzieren** — die einzige Stelle
im ganzen Entwurf, an der die Zoombänder-Regel nicht gilt. Heute trägt jedes Label seine eigene
Grundgröße (12–50, Vorgabe 18); es gibt keine Kurve je Art, die man abschreiben könnte. Die Vorgabe
ist die echte Formel aus `getScaledLabelSize` bei Grundgröße 18:

| z0 | z1 | z2 | z3 | z4 | z5 | z6 | z7 | z8 |
|---|---|---|---|---|---|---|---|---|
| 9 | 11 | 13 | 14 | 16 | 18 | 19 | 21 | 21 |

**Jedes Label, das heute nicht auf 18 steht, ändert beim Ausliefern sichtbar seine Größe.** Das ist
der Preis dafür, dass die Größe global wird; nachgestellt wird je Art im Fenster.

💣 **Auswahl schaltet das Ziehen frei.** In der Vorgabestellung sind alle Kurven deckungsgleich —
zwölf Punkte konkurrieren um denselben Klick, und man müsste „erst alle darüberliegenden
wegschaufeln" (Owner). Deshalb: sobald eine Art gewählt ist (über ihren Namen in der Bandtabelle oder
rechts am Plot), nimmt **nur sie** noch Zeiger an. Ohne Auswahl bleibt alles anfassbar. Gemessen: 108
anfassbare Punkte vorher, 9 danach.

🪤 **Die Namen am rechten Rand müssen aufgefächert werden.** Sie standen auf der Höhe ihres letzten
Wertes — und in der Vorgabestellung lagen dadurch alle zwölf exakt aufeinander. Ein Diagramm, dessen
Beschriftung genau dann versagt, wenn noch niemand etwas verstellt hat, versagt beim ersten Blick.
Also: nach Zielhöhe sortieren, mit Mindestabstand auseinanderschieben, am unteren Rand zurückfalten,
Anschlusslinie zum Kurvenende. Der Name hängt am **letzten sichtbaren** Wert, nicht stur an z8.

⌨️ Mit gewählter Art: **← →** wechselt die Zoomstufe, **↑ ↓** verstellt den Wert (Umschalt: großer
Schritt).

### §5.6 Die Kurvenfeinheiten

Die zwölf Werte aus `2026-08-22-kurvenbeschriftung-design.md` §6.1, bisher Konstanten in
`js/map-features/curve-label-fit.js`. Damit ist **Plan 4** jenes Entwurfs erledigt.

🔴 **Die Vorgaben werden AUS DEM MODUL gelesen** (`AVESMAPS_CURVE_LABEL_DEFAULTS`), nicht
abgeschrieben. Eine zweite Tabelle wäre genau die Divergenz, gegen die der ganze Abschnitt
argumentiert.

Dazu eine **Vorschau** (Owner 23.08.2026): ein Auswahlfeld mit den drei Gebirgen (Drachensteine,
Koschberge, Schwarze Sichel) und den drei Wäldern aus `docs/kurvenlabel-referenzdaten.js`, darauf die
gerechnete Mittelachse und der Name. ⭐ Sie benutzt die **echte** Rechenstrecke, nicht eine dritte
Abschrift — siehe §7.

⚠️ **Zwei der zwölf wirken in der Vorschau nicht sichtbar** (Mindestabstand zweier Namen,
Ausweichweg): sie brauchen einen Fall, den ein einzelner Name auf einer freien Fläche nicht
herstellt. Das gehört ausgesprochen, statt einen Regler zu zeigen, der scheinbar nichts tut.

### §5.7 Klimazonen haben ihren eigenen Zuschnitt

🔴 Owner 24.08.2026. Auf dem Reiter **entfallen** Zoomband/Schriftgröße, der Editor-Ausschnitt, die
Vorschau und die Kurvenfeinheiten. Übrig bleibt Ton und Deckkraft der acht Bänder; die Überschrift
sagt dort „Flächen — Ton und Deckkraft".

Grund: Klimabänder tragen keine `map_features`-Beschriftung. Ihr Name kommt aus
`map-features-ecosystem-climate.js` und nimmt seinen Ton aus **derselben** Quelle wie die Fläche
(`ecosystemAreaColor`) — ein Farbwert färbt beides, und das ist heute schon so.

⚠️ **Die Tabelle aus §5.1 behält ihre Namensspalten**, sie zeigen dort „— Ton der Zone —". Nur die
vier eigenständigen Abschnitte entfallen. Wer stattdessen die Spalten wegnimmt, baut eine zweite
Tabellenform für einen Reiter — und damit die Divergenz, die §5.1 gerade beseitigt hat.

⚠️ Die Kurvenfeinheiten gelten weiter für **alle** Ebenen; sie sind hier nur nicht erreichbar, nicht
abgeschaltet. Ein Abschnitt, der auf jeder Ebene steht und auf einer nichts bedeutet, ist keine
Vollständigkeit, sondern eine Falle.

---

## §6 Was der Editor sieht — die Marke auf dem Regler

🔴 Owner 24.08.2026, am Screenshot des Beschriftungsdialogs: *„ich will, dass die Editoren
default-werte zu den zoombändern bekommen. Die zoombänder können sie ändern."*

**Die Regler bleiben, die Vorgabe wird sichtbar.** Jeder betroffene Balken im Beschriftungsdialog
trägt eine **Marke** dort, wo der Vorgabewert dieser Art liegt. Der Editor stellt weiter frei ein —
er sieht nur, wovon er abweicht. Unter dem Block steht, bei welchen Feldern dieses Label abweicht.

Betroffen sind die vier Felder, die im Fenster als Vorgabe geführt werden:

| Feld | Spanne | Vorgabe heute |
|---|---|---|
| Max. Namen | 1–3 | 1 |
| Sichtbar ab Zoom | 0–7 | 0 |
| Sichtbar bis Zoom | 0–7 | 7 |
| Priorität | 1–5 | 3 |

💣 **Die Marke sitzt UNTER dem Balken, nicht darauf** — auf dem Balken verdeckt der Reglerknopf sie
genau dann, wenn Wert und Vorgabe übereinstimmen, also im häufigsten Fall.

💣 **Die Umrechnung Wert → Position ist nicht `pct` der Breite.** Der Knopf hat eine Breite, sein
Mittelpunkt wandert nur über `100% − Knopfbreite`. Ohne die Korrektur steht die Marke an beiden Enden
sichtbar daneben — und an den Enden liegen die interessanten Werte (z0, z7).

### 🔴 Das Modell ist gemischt, und das ist Absicht

| | |
|---|---|
| Flächenfarbe, Deckkraft, Namensfarbe, Schriftgröße | **Die Tafel gilt.** Kein **Bedienelement** mehr am einzelnen Label — das Feld `size` bleibt als `hidden` stehen, siehe §5.5. |
| Sichtbar ab/bis Zoom, Max. Namen, Priorität | **Die Tafel rät.** Der Editor entscheidet, sieht aber die Marke. |

Begründet: Größe und Farbe sollen über die ganze Karte einheitlich sein, sonst sieht sie
zusammengewürfelt aus. Wo ein Label steht und wann es erscheint, hängt am Einzelfall — das weiß nur
der Editor, der die Stelle kennt.

---

## §7 Die Rechenstrecke liegt EINMAL

🔴 Für die Kurvenvorschau brauchte der Prototyp dieselbe Rechnung (Chordal Axis, Glättung,
Begradigung), die `docs/kurvenlabel-mockup.html` inline als 400-Zeilen-IIFE trug. Statt einer zweiten
Abschrift ist sie herausgelöst nach **`docs/kurvenlabel-pipeline.js`**; beide Prototypen laden sie.

⚠️ **Sie ist nicht die Produktion.** Live rechnet der **Server** die Kurve
(`api/_internal/app/curve-labels.php`), und der Browser passt nur den Text darauf ein
(`curve-label-fit.js`). Die Pipeline ist der abgenommene Prototyp desselben Verfahrens — wer eine
Zahl von dort gegen eine von der Karte hält, vergleicht zwei verschiedene Läufe.

⭐ Das echte Fenster ruft für die Vorschau **die Produktionsmodule**, nicht die Pipeline.

---

## §8 Rechte und Ablage — abgeschrieben, nicht erfunden

Muster der Zoombänder (AGENTS.md §11):

* Ablage in **einem** `app_setting`-Schlüssel (plus `_stamp`).
* **Schreiben `admin`, Ansehen `edit`.** Für einen Editor stehen die Bedienelemente gesperrt da und
  statt „Speichern" ein Hinweis.
* Öffentlicher Leser fällt **offen** aus: jeder Fehler ⇒ Vorgabe, **kein DDL** im Lesepfad.
* 💣 Der Schreibvorgang **liest zurück** — dieselbe stille MySQL-Kürzung, an der der Speichern-Knopf
  der Tempowerte wochenlang nichts tat (AGENTS.md §10).
* **Zurücksetzen LÖSCHT die Zeile**, statt eine Kopie der Vorgabe zu hinterlassen (die veraltete
  sonst).
* Gespeichert wird **nur die Abweichung**, nie eine Kopie der Vorgabe.

🔴 **Farben bleiben Tokens.** Die rund 20 heutigen Namenstöne und die 33 Flächentöne werden **nicht**
ins JavaScript kopiert. Das Fenster speichert nur Abweichungen; wo nichts gesetzt ist, gilt weiter
`tokens.css` bzw. `map-labels.css`. Sonst stünde jede Farbe zweimal da und die zwei liefen
auseinander (AGENTS.md §12).

⚠️ Damit weicht der Entwurf bewusst von den Zoombändern ab, wo das JS-Modul die einzige Quelle der
Vorgaben ist: dort sind es Zahlen, hier sind es Farben — und Farben gehören in Tokens.

---

## §9 Fallen, die beim Bauen des Prototyps gemessen wurden

* 🪤 **Das Namensmuster war unlesbar.** Es lag auf dem hellen Landschaften-Untergrund, und fast jede
  Labelfarbe ist hell. Gemessen: alle zwölf Muster bei Kontrast **1,0 – 1,25**. Zwei Änderungen, beide
  näher an der Karte: der Grund ist die **eigene Fläche** (Wald 1,22 → **4,86**), und der Name bekommt
  die **Kontur**, die der Canvas live zieht (`strokeWidth = fontSizePx * strokeRatio`) — nicht einen
  weichen Schatten. Mit Schatten allein blieben fünf blasse Arten bei 1,2–1,7.
  ⚠️ **Ein Kontrastverhältnis misst eine Kontur nicht.** Die Zahl bleibt niedrig, obwohl der Name
  liest. Wer hier „optimiert", sollte hinsehen statt zu rechnen.
* 💣 **`table-layout: fixed` braucht die leere Zelle.** Eine Zeile ohne „übernehmen"-Knopf hat sonst
  eine Spalte weniger, und alles rechts davon rutscht um eine Spalte — genau die Ausrichtung, wegen
  der die Tabelle entstanden ist.
* 💣 **Regler und Zahlenfeld teilen Einheit und Grenzen.** Ein Regler in 0…1 neben einem Feld in
  Prozent klemmt beim ersten Anfassen jeden getippten Wert stumm auf 1 %.
* 💣 **Doppelt belegte Zeile braucht zwei eindeutige Trefferflächen.** In der Bandtabelle wählt der
  **Name** die Art für den Plot, eine **Stufe** stellt das Band.
* 🪤 **Eine ausgeblendete Browser-Ansicht meldet Viewport-Breite 0**, und `scrollWidth − 0` sieht wie
  ein Überlauf von 622 px aus. Containerrelativ messen, nicht gegen den Viewport.
* 💣 **`selArt` muss beim Reiterwechsel fallen.** Sie überlebte ihn und zeigte auf eine Art, die es im
  neuen Reiter nicht gibt — der Editor-Ausschnitt stand auf „wald", auch unter Klimazonen.
* 💣 **`typeof`, nicht der blanke Bezeichner.** Ein nicht deklariertes `curveLabelLineLength` wirft
  beim bloßen Lesen einen ReferenceError.

---

## §10 Abnahme

Nicht am Zahlenblatt, sondern am Ablauf (AGENTS.md §9). Vor „fertig" ausgeführt und benannt:

1. Fläche färben, Deckkraft ziehen — Vorschaustreifen und Karte folgen.
2. Häkchen „global" an/aus — der Zeilenwert ist danach **unverändert** da.
3. Eine Art wählen, im Plot einen Punkt ziehen, mit ← → durch die Stufen.
4. Ein Band beschneiden — die Kurve endet, der Name im Plot wandert mit.
5. `aus` — die Art trägt nirgends einen Namen.
6. „Median ermitteln" → „übernehmen" → die Marke im Beschriftungsdialog springt mit.
7. Speichern, Fenster schließen, neu laden — steht es noch?
8. Ein Label im echten Dialog öffnen: steht die Marke, wo sie soll?
9. Ein Label speichern, das nie angefasst wurde: ist seine gespeicherte **Größe** noch da? (§5.5)
10. Alles in **hell UND dunkel**.

⚠️ Was ein Prototyp nicht beantworten kann, wird als offene Frage gemeldet, nicht als bestanden.

---

## §11 Offene Punkte

* 🔧 **Die echten Medianwerte.** Der Prototyp führt Beispielzahlen und sagt es bei jedem Druck
  ausdrücklich. Echt wird das mit einer Abfrage über `map_features` (Median von `min_zoom`,
  `max_zoom`, `curve_label_max`, `priority` je `feature_subtype`, über rund 900 Beschriftungen). Bis
  dahin darf niemand die Zahlen für gemessen halten.
* 🔧 **„Median für alle Arten ermitteln"** — im Topographie-Reiter sind es 14 Zeilen. Ein Knopf im
  Abschnittskopf wäre eine Kleinigkeit; der Owner hat ihn nicht gefordert.
* 🔧 **Der Arbeitsordner hinkt hinterher.** Der lokale `master` steht 63 Commits vor und **200 hinter**
  `origin/master`. „Kurven rechnen" und die zwei Kurvenmodule gibt es lokal gar nicht. Das wird
  aufgelöst, **bevor** eine Zeile Produktionscode entsteht.
* 🔧 **`?lang=en`.** Das Fenster emittiert noch kein `data-i18n` (gehört zu M8).
* ⚠️ **Die Vorgabewerte je Art sind bewusst uniform** (z0–z7, 1, 3). Sobald die Mediane vorliegen,
  gehört eine Runde dazu, in der der Owner sie Art für Art ansieht.

---

## §12 Bauteile (erwartet)

| Zweck | Datei |
|---|---|
| Vorgaben + Auflösung (einzige Quelle) | `js/map-features/ecosystem-display.js` *(neu)* |
| Öffentlicher Leser | `api/app/ecosystem-display.php` *(neu)* |
| Schreiber (`admin`) | `api/edit/map/ecosystem-display.php` *(neu)* |
| Speicher-Fundament | `api/_internal/app/ecosystem-display.php` *(neu)* |
| Das Fenster | `html/landschaften-editor.html` + `css/pages/landschaften-editor.css` |
| Marke im Beschriftungsdialog | `index.html`, `js/review/review-labels.js` |
| Größe global statt je Label | `js/map-features/map-features-labels.js` (`getScaledLabelSize`) |
| Flächenton/Deckkraft | `js/map-features/map-features-ecosystem-rendering.js`, `css/features/ecosystem-layer.css` |
| Kurvenwerte | `js/map-features/curve-label-fit.js` (`AVESMAPS_CURVE_LABEL_DEFAULTS`) |
| Prototyp | `docs/landschaften-darstellung-mockup.html`, `docs/kurvenlabel-pipeline.js` |

---

## §13 Entschieden am 23./24.08.2026

| Frage | Entscheidung |
|---|---|
| „Kurven rechnen" — Person oder Ort? | **Person**: Recht `admin` → `edit`, Kachel bleibt, wo sie ist |
| Zwölf Kurvenwerte ins selbe Fenster? | **Ja**, ein Ort für „wie sehen Landschaften aus" |
| Label-Tafel wonach sortiert? | **Je Art, in vier Reitern** |
| Namensfarbe je Zoomstufe? | **Nein** — „die farben bleiben gleich", eine Farbe je Art |
| Zwei Listen oder eine Tabelle? | **Eine Tabelle** |
| „global" — Ebene oder alle vier? | **Diese Ebene**, Häkchen anfangs **an** (= heutiger Zustand) |
| Zoomband wie bei „Orte bearbeiten"? | **Ja**, aber mit **zwei** Enden statt einem |
| Zoomband bindend oder Vorgabe? | **Vorgabe** — der Editor darf abweichen, sieht die Marke |
| Median: unsere Zahl oder ihre? | **Unsere.** Er erreicht die Editoren nie |
| Klimazonen | Nur Fläche — kein Zoomband, kein Editor-Ausschnitt, keine Vorschau, keine Kurvenfeinheiten |
