# Die Landschafts-Ebenen wandern in den Kartenfächer

**Owner-Auftrag vom 09.09.2026.** Die Toggle-Leiste über der Karte („Alle · Derographie ·
Vegetation · Topographie · Klimazonen") verschwindet für Besucher und wird zum Untermenü von
„Landschaften" im Kartenfächer. Die drei Untergründe fallen dort weg, weil der Untergrund in den
Landschaften ohnehin auf 0 % steht. Editoren behalten die Leiste **und** bekommen den erweiterten
Fächer. Dazu: Flüsse und Seen tragen denselben Wasserton, den der SVG-Abzug längst führt.

Vorgänger-Entwürfe, die dieser hier fortschreibt (nicht ersetzt):
`2026-08-11-ansichts-kacheln-design.md` (die Kachel) und
`2026-08-26-ansicht-untergrund-kreuzen-design.md` (die zweite Stufe).
Mockup: `docs/ansicht-untergrund-mockup.html` — **Build-Produkt** aus
`tools/bau-ansicht-untergrund-mockup.js`, wird erweitert, nicht durch ein zweites ersetzt.

## 0 · Die vier Owner-Entscheide dieses Tages

1. Untergrund im Frontend: **alle fünf Ebenen auf 0 %** (heute nur „Alle"; die vier anderen 25 %).
2. Der Untergrund bleibt für Editoren erreichbar — als **dritte Stufe** im Fächer.
3. Der Wasserton **#4c89c6 gilt in allen Ansichten**, nicht nur in den Landschaften.
4. „Fluss als Kontur" heißt: **#4c89c6 ist die Linienfarbe des Flusses**; die weiße Umrandung
   bleibt im Bearbeiten-Modus zusätzlich darum, samt Strömungspfeilen.

## 1 · Drei Stufen, eine Regel

Stufe 1 ist unverändert (Standard · Politisch · Kraftlinien · Landschaften · Nur Karte).

🔴 **Stufe 2 ist ab jetzt pro Ansicht verschieden** — das ist der Umbau. Bis heute war sie
ausnahmslos „der Untergrund"; künftig zeigt sie, *was diese Ansicht zu wählen hat*:

| Ansicht | Stufe 2 | Stufe 3 |
|---|---|---|
| Landschaften | Alle · Derographie · Vegetation · Topographie · Klimazonen | die drei Untergründe, **nur im Editor** |
| alle anderen | Original · Modern (· Old nur im Editor) | — |

🔴 **DIE EINE REGEL, DIE ALLE DREI STUFEN TRÄGT: eine Zelle mit Untermenü ÖFFNET es, eine ohne
WÄHLT.** Das ist heute schon die Regel zwischen Stufe 1 und 2 (`waehle()`: „ein Klick auf eine
Ansicht hält ihre zweite Stufe offen"); sie greift eine Etage tiefer, ohne dass eine zweite Regel
dazukommt. Daraus fällt alles Übrige ab:

- Besucher: erster Klick auf „Vegetation" wählt sofort — unter der Zelle liegt nichts.
- Editor: erster Klick öffnet Stufe 3, zweiter wählt „Landschaften + Vegetation" mit dem
  eingestellten Untergrund.
- Telefon (kein Überfahren): erster Tipp öffnet, zweiter wählt — derselbe Weg wie am Zeiger, kein
  zweiter Bedienweg. Die Zusage aus dem Entwurf vom 26.08.2026 bleibt damit heil.

⭐ **Und das ist die Begründung dafür, dass der Editor seine Reiterleiste behält** — sie ist sein
Ein-Klick-Weg zur Ebene, während der Fächer ihm zwei Klicks abverlangt. Die Leiste ist keine
Altlast, sondern die Gegenleistung für die dritte Stufe.

🔴 **Keine dritte Stufe für Besucher.** Ihr Untergrund steht auf 0 %; ein Menü, das etwas
Unsichtbares wählt, ist kein Menü. Der Riegel ist `IS_EDIT_MODE`, gelesen an derselben Stelle, an
der heute „Old" gefiltert wird — und er fällt **geschlossen** aus: ohne die Auskunft keine dritte
Stufe.

💣 **Die Stufe wird ein BAUTEIL, das zweimal montiert wird.** Heute steckt sie als eine einzige
fest verdrahtete Instanz in `start()`: `grundReihe`, `stufeZwei`, `stufeZweiOffen`, `stufeTimer`,
`stufeAufTimer`, `zeichneGrundReihe`, `positioniereStufeZwei`, `oeffneStufeZwei`,
`schliesseStufeZwei`, `stufeZweiSpaeterSchliessen`, `verdrahteStufeZwei`, `markiereQuelle` — zwölf
Namen, jeder auf „Untergrund" gemünzt. Eine zweite Etage durch Abschreiben wäre die siebte
Listenzeilen-Rezeptur dieses Hauses. Stattdessen: `macheStufe({ quelleContainer, inhalt, ueber })`
liefert `{ element, oeffne, schliesse, spaeterSchliessen, verdrahte, zeichne }`; Stufe 2 und
Stufe 3 sind zwei Aufrufe davon. Die Zeitkonstanten (`SCHWEBE_AUF_MS`, `SCHWEBE_ZU_MS`,
`BLENDE_ZU_MS`) bleiben die geteilten, die sie seit dem 26.08.2026 sind.

💣 **Der Offen-Zustand jeder Stufe steht in einer VARIABLEN**, nie in `is-open` und nie in
`hidden` — die Klasse kommt erst im nächsten Bild, `hidden` erst nach dem Zuklappen. Der Fehler ist
in diesem Menü schon zweimal bezahlt worden (15.08.2026, und beim Anzeige-Menü daneben am
12.08.2026); mit einer dritten Stufe gäbe es ihn dreifach.

💣 **Zwischen den Stufen liegen 6 px, und die brauchen ZWEI Riegel** — die unsichtbare Brücke im
CSS (`::after`, `bottom: -10px`, innerhalb des `clip-path`-Überhangs) und den Nachlauf im JS. Das
gilt für jede Grenze, also künftig für zwei. Eine Brücke ohne die andere ist ein Menü, das beim
Hochfahren zuklappt.

💣 **Stufe 3 wird GEMESSEN positioniert, nicht gerechnet.** Stufe 2 sitzt auf
`bottom: calc(100% + 6px)` der Hülle; Stufe 3 müsste also `100% + 6px + Höhe(Stufe 2) + 6px`
tragen. Die Höhe der zweiten Reihe hängt an ihrer Beschriftung und ist keine Konstante — sie wird
aus dem `getBoundingClientRect()` der offenen Stufe 2 gelesen, wie `positioniereStufeZwei` es
heute schon für die waagerechte Lage tut. Eine abgeschriebene Zahl wäre beim ersten längeren
Ebenennamen falsch, und zwar still.

💣 **Die Staffelung der Zellen steht als `nth-child(2..4)` im CSS** — genau drei Untergründe. Mit
fünf Ebenen fehlen zwei Stufen, und die letzten beiden Zellen blendeten ohne Versatz auf. Sie
werden auf `nth-child(2..6)` erweitert.

⚠️ **Breite:** die Hauptreihe fällt unter 390 px auf drei Spalten (`--map-layer-spalten`,
gerechnete Grenze aus dem Entwurf vom 26.08.2026). Fünf Ebenenzellen treffen dieselbe Grenze und
folgen derselben Media Query; die Spaltenzahl ist die tatsächliche Anzahl, keine feste Zahl.

**Zweite Zeile der zugeklappten Kachel:** sie nennt heute den Untergrund. Künftig nennt sie *das,
was die zweite Stufe dieser Ansicht wählt* — bei Landschaften also die Ebene („Landschaften /
Vegetation"). Der Untergrund gehört dort nicht hin: er sagt nichts mehr aus.

## 2 · Der Zustand bleibt die Reiterleiste

💣 **Der Fächer legt KEINEN zweiten Ebenen-Zustand an.** Die Wahrheit ist und bleibt
`activeEcosystemLayerKind` / `isEcosystemShowAllLayers()`, bedient über die Reiter
`[data-ecosystem-kind]` bzw. `[data-ecosystem-show-all]`. Der Fächer **klickt den passenden Reiter
an** — derselbe Weg wie beim `#mapStyleSelect`, kein zweiter. Damit laufen `setActiveEcosystemLayerKind`,
`syncEcosystemPaneStates`, das Merken im `localStorage`, die aria-Zustände und die Besucherzählung
(`js/app/visitor-tracking.js` horcht auf `#ecosystem-layer-switch`) ohne eine einzige neue Zeile mit.

🔴 **Die Leiste bleibt deshalb im DOM, auch wenn der Besucher sie nicht sieht.** Sie wird
versteckt, nicht entfernt. Wer sie für Besucher aus dem Markup nähme, müsste den ganzen
Ebenen-Zustand ein zweites Mal bauen.

⚠️ **Versteckt wird `.ecosystem-layer-row`, NICHT `#ecosystem-controls`.** In dem Behälter sitzt
auch die Meldung „Ebene ist abgeschaltet" (servergesteuert), und die geht den Besucher genauso an
wie den Editor. Der Untergrund-Regler und der Stapel-Knopf darin sind bereits editor-gebunden.

⚠️ **Wählt der Fächer eine Ebene, wird die Ansicht mitgewählt** — wie beim Untergrund heute: eine
Bewegung für eine Kombination. Steht die Karte noch nicht auf „Landschaften", geht der Weg über
`#mapLayerModeSelect` (`change`), nicht über einen eigenen Aufruf.

## 3 · Untergrund 0 % in allen fünf Ebenen

`ECOSYSTEM_FRONTEND_PROFILE_RUHIG.untergrund` fällt von 25 auf 0. Damit gilt für den Besucher in
jeder Landschaftsansicht, was heute nur „Alle" gilt: die Kachelebene wird **abgehängt**, nicht nur
ausgeblendet (`syncEcosystemBaseTiles`) — Leaflet fordert sonst Bilder an, die niemand sieht.
⭐ Nebenbei ein Wegfall von Kachelabrufen in vier von fünf Ebenen.

Übrig bleibt `--color-ecosystem-underground` (#d3cec2), darauf die Flächen.

🔴 **Der Editor behält Regler und Kacheln.** `ecosystemFrontendProfile()` gibt für ihn weiterhin
`null` zurück — „hier wird nichts angefasst". Diese Unterscheidung ist die Begründung der ganzen
Tabelle und bleibt unberührt.

⚠️ `GRUND_DECKKRAFT.ecosystem` im Fächer (heute 0,25) fällt auf 0: die Landschaften-Kachel und die
fünf Ebenenzellen zeigen den Pergamentgrund, kein Kachelbild. Ein Vorschaubild, das etwas anderes
ankündigt als die Karte zeigt, ist genau die Falle, vor der `tools/layer-tiles/capture.js` warnt.
Für den Editor mit Regler auf 25 % weicht die Vorschau damit ab — gewollt: die Zelle zeigt die
Ansicht, nicht seine persönliche Einstellung.

## 4 · Fünf Vektoren, vier davon neu

Bauform wie die bestehenden `OVERLAYS`: 48×48, echte Farben aus `css/base/tokens.css`, ausgefranste
Ränder, kein Kachelbild darunter.

⭐ **„Alle" ist der vorhandene `ecosystem`-Vektor, unverändert wiederverwendet.** „Alle" *ist* alle
Ebenen übereinander — es sind also vier neue statt fünf, und das Untermenü kann von der
Landschaften-Kachel darüber nicht abdriften.

| Zelle | Was der Ausschnitt zeigt | Töne |
|---|---|---|
| Alle | = die Landschaften-Kachel | (unverändert) |
| Derographie | Regionsumrisse, **ungefüllt** — die Ebene zeichnet Behälter, keine Fläche | `#575757`, Kontur `#2e2e2e` |
| Vegetation | Wald, Grasland, Steppe, ein Fleck Wüste | `#3f6b2c` `#8fbf6a` `#a8bd8a` `#e0c74e` |
| Topographie | Gebirge, Hügel, See, Meer | `#7a6c5e` `#7d8f6e` `#4c89c6` `#2d5f8a` |
| Klimazonen | waagerechte Bänder, kalt oben nach warm unten | `#cfe0eb` … `#c65e2e` |

💣 **Die Farben sind die ECHTEN, jede aus der Stelle, die sie auf der Karte zeichnet** — dieselbe
Zusage wie bei den bestehenden Vektoren. Wer sie „aufräumt", macht die Zelle zu einem Symbol, das
etwas anderes ankündigt als die Karte zeigt.

⚠️ **Die Derographie-Zelle ist die einzige ohne Füllung**, und das ist Information: die Ebene ruht
ungefüllt auf der Karte (`--color-ecosystem-derographisch`, „grey, and unfilled while it rests").
Eine gefüllte graue Fläche wäre hübscher und falsch.

## 5 · Ein Wasserton: #4c89c6

Neuer Token `--color-water: #4c89c6` in `css/base/tokens.css` ist die Wahrheit;
`--color-ecosystem-topographie-see` liest ihn (`var(--color-water)`). Vier Stellen tragen den Wert
hartkodiert und ziehen mit:

1. `getPathStyleColors` → `centerColors.Flussweg` (`js/map-features/map-features.js`) — die
   **Linienfarbe**, in allen Ansichten
2. die Strömungspfeile (`js/map-features/map-features-river-flow-arrows.js`)
3. der Landschafts-Vektor im Fächer (`js/ui/map-layer-picker.js`) und sein Zwilling im
   Mockup-Generator
4. `SVGX_WAY_COLORS` (`js/pages/svg-export-build.js`, Flussweg **und** Bach) — der Rückfall folgt
   der Karte

💣 **Statt eines fünften Ortes für dieselbe Zahl hält ein TEST alle vier gegen `--color-water`.**
Genau diese Kopplung steht heute als Kommentar in `tokens.css` („Wer den Fluss umtönt, zieht diese
Zeile nach — sonst fällt das Paar lautlos auseinander, und der Bruch sieht wieder wie Absicht
aus"). Ein Kommentar hat noch nie einen Wert nachgezogen; ein Test tut es.

🔴 **Die weiße Kontur samt Pfeilen bleibt unberührt.** `avesmapsFlussKonturSichtbar()` entscheidet
weiter, wer sie sieht (Editor, oder jede Ansicht außerhalb der Landschaften) — und die
`outlineOpacity = 0`-Zeile steht weiterhin **vor** dem Prüfhaken „Offene Wegenden", sonst löschte
sie dessen Befund für jeden Fluss.

🔴 **DAS MEER BLEIBT ANDERS** (Owner 09.09.2026, ausdrücklich: „achte darauf dass meere noch anders
sind"). `--color-ecosystem-topographie-meer` behält `#2d5f8a`, die Küste ihr Türkis `#3f9e9a`, der
Seeweg sein `#2f7dd3`. Den neuen Ton tragen genau **drei** Dinge: die Flusslinie, der Bach und die
Seefläche. Nachgemessen, dass das Meer nirgends am See hängt: es hat in jeder Tafel seinen eigenen
Token, und das einzige `["see","meer",…]` im Haus steht in `svg-export-build.js` — es regelt die
ZEICHENREIHENFOLGE (Wasser zuletzt), nicht die Farbe. Wer die vier je zu einem `waterKeys`-Ton
zusammenzieht, färbt das Meer mit.

**Unberührt außerdem:** die Wegearten-Farben der Editorliste (`--color-path-flussweg`,
`--color-path-bach`) — die kodieren Daten in einer Liste, mit gemessenen Abständen zu ihren
Nachbarn.

**Der Bach folgt von selbst:** er ist ein Flussweg mit Häkchen und liest denselben `centerColor`;
schmaler gezeichnet wird er, nicht anders gefärbt.

⚠️ **Gleich ist der WERT, nicht das Bild.** Die Seefläche liegt mit der Deckkraft ihrer Ebene auf
der Karte (0,5 aus der Tafel „Darstellung"), die Flusslinie deckt voll — der See bleibt blasser.
Das ist derselbe bewusste Rest wie am 07.09.2026, und die Deckkraft gehört dem Editor und seiner
Tafel, nicht diesem Ton. Sie lässt sich dort je Flächenart auf 1 stellen.

⚠️ **Die Vorgaben des SVG-Abzugs bleiben stehen** (`SVGX_COLOR_PRESETS`), obwohl sie nach diesem
Umbau denselben Wert tragen wie die Karte. Sie sind zweimal ausdrücklich bestellt (15.08. und
08.09.2026); der Abzug übernimmt die REGEL der Karte, nicht ihren Wert, und diese Zeilen sind der
Beleg dafür. Der Kommentar dort, der #6ec6ff als „das hellere Blau der Karte" nennt, wird
richtiggestellt — samt der Zusicherung in `svg-export-farben.test.js`, die heute darauf beruht,
dass die beiden Blau **verschieden** sind.

## 6 · Was NICHT dazugehört

- Die gewählte Ebene reist weiterhin **nicht** im geteilten Link mit (sie liegt im `localStorage`).
  Nicht bestellt.
- Die Deckkraft der Seeflächen wird nicht angefasst (§5).
- Die Reiterleiste des Editors ändert ihre Form nicht.
- Kein Umbau der rund 25 älteren Menü-Abschriften im Haus.

## 7 · Tests

- `js/ui/__tests__/map-layer-picker.test.js` — erweitert: Stufe 2 ist pro Ansicht verschieden;
  Stufe 3 nur im Editor; die eine Regel („mit Untermenü öffnet, ohne wählt") auf allen drei Stufen;
  `nth-child`-Staffelung deckt fünf Zellen; die CSS-Zuklappzeit und `BLENDE_ZU_MS` bleiben gekoppelt.
- **Neu** `js/ui/__tests__/landschaften-untermenue.test.js` — der Fächer schreibt den Ebenenzustand
  ausschließlich über die Reiter (Spion auf `#ecosystem-layer-switch`), nie über eine eigene
  Variable; „Alle" geht über `[data-ecosystem-show-all]`, nicht über einen `kind`.
- **Neu** `js/map-features/__tests__/wasserton.test.js` — die vier Schreibstellen gegen
  `--color-water` aus `tokens.css`, gelesen, nicht abgeschrieben.
- `js/map-features/__tests__/ecosystem-frontend-profil.test.js` — erweitert: alle fünf Ebenen auf
  0 %, Kacheln abgehängt, Editor unberührt.
- `js/pages/__tests__/svg-export-farben.test.js` / `…/svg-export-build.test.js` — nachgezogen.
- **Neu** `tools/__tests__/ansicht-untergrund-mockup.test.js` — das ausgelieferte Mockup ist
  zeichengleich mit der Ausgabe seines Generators. So einen Wächter gibt es für das gescopte
  Editor-CSS (`scope-editor-css.test.js`), für dieses Build-Produkt bisher nicht — und von Hand
  hineingeschriebene Regeln wirken sofort und sind beim nächsten Lauf weg.

Das Mockup trägt seine gekoppelten Werte als **VERTRAG** (`tools/mockup-vertrag`): die 6-px-Lücke
samt Brückenhöhe, die Zahl der gestaffelten Zellen, den Wasserton. Geändert wird dann IM Mockup,
nicht im Produktivcode.

Jeder neue Test wird gegen Mutationen gefahren, bevor er als Beleg zählt.

## 8 · Offene Punkte

- 🔧 Der Ablauf mit angemeldeter Sitzung: die dritte Stufe ist bis zur Abnahme nur am Mockup und im
  Browser ohne Editor-Rechte geprüft.
- 🔧 Ob fünf Ebenenzellen am Telefon in zwei Reihen oder in einer schmalen bleiben, entscheidet
  der Blick am Gerät — die Media Query ist vorbereitet, die Wahl nicht getroffen.
- 🔧 Ob der See dem Fluss auch im BILD gleichen soll (Deckkraft 1), ist eine Owner-Frage; §5.
