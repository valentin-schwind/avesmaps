# Die Landschafts-Ebenen wandern in den Kartenfächer

**Owner-Auftrag vom 09.09.2026.** Die Toggle-Leiste über der Karte („Alle · Derographie ·
Vegetation · Topographie · Klimazonen") verschwindet für Besucher und wird zum Untermenü von
„Landschaften" im Kartenfächer. Die drei Untergründe fallen dort weg, weil der Untergrund in den
Landschaften ohnehin auf 0 % steht. Editoren behalten die Leiste **und** bekommen denselben Fächer (bis zum 14.09.2026 stand hier
„den erweiterten" — die dritte Stufe ist gefallen, §0 Punkt 2). Dazu: Flüsse und Seen tragen denselben Wasserton, den der SVG-Abzug längst führt.

**Nachtrag vom selben Tag:** Orte, Wege, Labels, Grenzen und Gewässer sind in allen fünf Ebenen
an — und die eigene Wahl des Besuchers schlägt diese Vorgabe (§3). Damit fällt die „ruhige
Zeichenfläche", die vier der fünf Ebenen seit dem 05.08.2026 waren.

Vorgänger-Entwürfe, die dieser hier fortschreibt (nicht ersetzt):
`2026-08-11-ansichts-kacheln-design.md` (die Kachel) und
`2026-08-26-ansicht-untergrund-kreuzen-design.md` (die zweite Stufe).
Mockup: `docs/ansicht-untergrund-mockup.html` — **Build-Produkt** aus
`tools/bau-ansicht-untergrund-mockup.js`, wird erweitert, nicht durch ein zweites ersetzt.

## 0 · Die Owner-Entscheide dieses Tages

1. Untergrund im Frontend: **alle fünf Ebenen auf 0 %** (heute nur „Alle"; die vier anderen 25 %).
2. 🔴 **Überholt am 14.09.2026.** Hier stand: „Der Untergrund bleibt für Editoren erreichbar — als
   dritte Stufe im Fächer." Der Owner hat sie gestrichen, „es braucht also bei landschaften kein 3. untermenü (Old Original Modern)": in den
   Landschaften ist der Untergrund für Besucher ganz aus, weil Wege, Flüsse und Grenzen die Konturen
   ansichtsübergreifend tragen; der Editor stellt seinen Untergrund über den Regler in
   `#ecosystem-controls`. **Es gibt keine dritte Stufe — für niemanden.**
3. Der Wasserton **#4c89c6 gilt in allen Ansichten**, nicht nur in den Landschaften.
4. „Fluss als Kontur" heißt: **#4c89c6 ist die Linienfarbe des Flusses**; die weiße Umrandung
   bleibt im Bearbeiten-Modus zusätzlich darum, samt Strömungspfeilen.
5. **Das Meer bleibt anders** — es bekommt den Wasserton ausdrücklich nicht (§5).
6. **Orte, Wege, Labels, Grenzen und Gewässer sind in allen fünf Ebenen an** (§3) —
7. **…und die eigene Wahl des Besuchers schlägt diese Vorgabe, für den ganzen Besuch** (§3.3).
8. Der **Editor** behält in den Landschaften seine leere Zeichenfläche (§3.3).
9. **Die zugeklappte Kachel zeigt das BILD der gewählten Ebene**, nicht immer das von „Alle" (§1,
   Nachtrag vom 14.09.2026).

⚠️ Hier steht bewusst keine Zahl im Titel. Die Liste ist an einem Tag von vier auf acht gewachsen,
und eine Zahl in einer Überschrift liest sich wie eine vollständige Liste — dieses Repo protokolliert
mehrfach, was das kostet.

## 1 · Zwei Stufen, eine Regel

Stufe 1 ist unverändert (Standard · Politisch · Kraftlinien · Landschaften · Nur Karte).

🔴 **Stufe 2 ist ab jetzt pro Ansicht verschieden** — das ist der Umbau. Bis heute war sie
ausnahmslos „der Untergrund"; künftig zeigt sie, *was diese Ansicht zu wählen hat*:

| Ansicht | Stufe 2 |
|---|---|
| Landschaften | Alle · Derographie · Vegetation · Topographie · Klimazonen |
| alle anderen | Original · Modern (· Old nur im Editor) |

🔴 **DIE EINE REGEL, DIE BEIDE STUFEN TRÄGT: eine Zelle mit Untermenü ÖFFNET es, eine ohne
WÄHLT.** Das ist heute schon die Regel zwischen Stufe 1 und 2 (`waehle()`: „ein Klick auf eine
Ansicht hält ihre zweite Stufe offen"); sie greift eine Etage tiefer, ohne dass eine zweite Regel
dazukommt. Daraus fällt alles Übrige ab:

- Besucher **und Editor**: erster Klick auf „Vegetation" wählt sofort — unter der Zelle liegt nichts.
- Telefon (kein Überfahren): erster Tipp öffnet, zweiter wählt — derselbe Weg wie am Zeiger, kein
  zweiter Bedienweg. Die Zusage aus dem Entwurf vom 26.08.2026 bleibt damit heil.

**Der Editor behält seine Reiterleiste** (Owner-Auftrag vom 09.09.2026). 🔴 Bis zum 14.09.2026 stand
hier als Begründung, sie sei sein Ein-Klick-Weg gegen die zwei Klicks der dritten Stufe. Die Stufe ist
gefallen, die Leiste bleibt — als Owner-Entscheid, nicht als Ausgleich; sie ist derselbe Zustand wie
der Fächer (§2).

🔴 **Keine dritte Stufe — für niemanden** (Owner 14.09.2026, §0 Punkt 2). Hier stand bis dahin „keine
dritte Stufe für Besucher" samt einem `IS_EDIT_MODE`-Riegel für die des Editors; beides entfällt.
Ein Menü, das in den Landschaften einen Untergrund wählt, der für Besucher ohnehin aus ist, ist kein
Menü — und der Editor hat seinen Regler.

🔴 **Überholt am 14.09.2026 — die zweite Montage ist entfallen.** Die Stufe bleibt EINE Instanz, die je
Ansicht einen anderen Inhalt baut (Ebenen über Landschaften, Untergründe sonst); ein Bauteil mit einem
einzigen Aufrufer wäre Umbau ohne Gewinn. Stehen bleibt der Hinweis auf die Namen: sie sind auf
„Untergrund" gemünzt, und wer sie anfasst, benennt sie nach der Stufe, nicht nach ihrem Inhalt.
Der Absatz von vorher, zum Nachlesen: **Die Stufe wird ein BAUTEIL, das zweimal montiert wird.** Heute steckt sie als eine einzige
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
12.08.2026).

💣 **Zwischen den Stufen liegen 6 px, und die brauchen ZWEI Riegel** — die unsichtbare Brücke im
CSS (`::after`, `bottom: -10px`, innerhalb des `clip-path`-Überhangs) und den Nachlauf im JS. Das
gilt für die Grenze zwischen Stufe 1 und Stufe 2. Eine Brücke ohne die andere ist ein Menü, das beim
Hochfahren zuklappt.

🔴 **Entfallen mit der dritten Stufe (14.09.2026)** — und gilt wieder, falls je eine kommt:
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

🔴 **Und das BILD folgt ebenso** (Owner 14.09.2026, „wenn ich auf ein element draufklick z.B. derographie steht ‚Landschaften Derographie' dran, aber nicht das icon (das ist von ‚alle')"):
die zugeklappte Kachel und die Landschaften-Zelle der ersten Stufe tragen den Vektor der GEWÄHLTEN
Ebene — `OVERLAYS.ecosystem` nur, wenn „Alle" gewählt ist. Die Zelle trägt ihn auch, wenn gerade eine
andere Ansicht gilt: sie zeigt, was ein Klick auf Landschaften bringt, denn die Ebene bleibt gemerkt.
💣 **Name und Bild kommen aus EINER Auskunft** (`aktiveEbene()`) — zwei getrennte Leser sind genau der
gemeldete Fehler: „Derographie" als Name, das Bild von „Alle" daneben.
⚠️ Die aktive Zelle liegt beim Aufklappen auf dem Fleck der Kachel; trüge sie ein anderes Bild, wechselte
es dort sichtbar.

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

## 3 · Die Landschaftsansicht zeigt alles — und die Wahl des Nutzers schlägt die Vorgabe

**Owner-Nachtrag vom 09.09.2026:** „auch die sollen in allen landschaftsansichten default aktiviert
und sichtbar sein - aber ausgeblendet werden, wenn der front-end nutzer aktiv was anderes tut
(anzeige)."

### 3.1 Was beim Betreten an ist

Genau die zehn Schalter des Anzeige-Menüs, die der Owner aufgezählt hat — die sechs Ortsklassen und
die vier Zeilen der Gruppe „Ebenen":

| | Schalter |
|---|---|
| Orte | `metropole` · `grossstadt` · `stadt` · `kleinstadt` · `dorf` · `gebaeude` |
| Ebenen | `togglePaths` · `toggleMapLabels` · `toggleTerritoryBorders` · `toggleRivers` |

⭐ **„bis zu besondere Bauwerke/Stätten" ist keine eigene Objektart**, sondern die Beschriftung der
letzten Ortsklasse `gebaeude` (`index.html`, `data-location-type="gebaeude"`). Es sind also alle
sechs, und die Liste ist `LOCATION_TYPE_VISIBILITY_ORDER` — nicht abgeschrieben.

🔴 **Damit stirbt die „ruhige Zeichenfläche".** Bis heute galt sie für vier der fünf Ebenen
(`ECOSYSTEM_FRONTEND_PROFILE_RUHIG`: Orte, Wege und Grenzen ausdrücklich aus, Untergrund 25 %) und
nur „Alle" zeigte die volle Karte. Der Nachtrag hebt den Unterschied auf: **alle fünf Ebenen
bekommen dasselbe Profil.**

💣 **Und dann fällt der Tisch, statt mit fünf gleichen Zeilen stehenzubleiben.**
`ECOSYSTEM_FRONTEND_PROFILES` + `ECOSYSTEM_FRONTEND_PROFILE_RUHIG` + `ECOSYSTEM_RIVER_KINDS` waren
drei Tabellen für die Frage „was zeigt DIESE Ebene". Die Frage gibt es nicht mehr. Eine Tabelle mit
überall gleichen Werten liest sich wie eine Entscheidung, die jemand getroffen hat, und lädt zum
Differenzieren ein, das hier ausdrücklich nicht gewollt ist. Übrig bleibt **ein** Profil:

```js
{ orte: true, wege: true, labels: true, grenzen: true, fluesse: true, untergrund: 0 }
```

### 3.2 Untergrund 0 % in allen fünf Ebenen

Die Kachelebene wird **abgehängt**, nicht nur ausgeblendet (`syncEcosystemBaseTiles`) — Leaflet
fordert sonst Bilder an, die niemand sieht. ⭐ Nebenbei ein Wegfall von Kachelabrufen in vier von
fünf Ebenen. Übrig bleibt `--color-ecosystem-underground` (#d3cec2), darauf die Flächen.

### 3.3 Die Wahl des Nutzers gilt für den ganzen Besuch

🔴 **Owner-Entscheid: für den ganzen Besuch, nicht nur bis zum Verlassen.** Sobald der Besucher
INNERHALB der Landschaften einen der zehn Schalter selbst anfasst, gilt seine Lage — auch beim
Wechsel der Ebene und beim Wiederbetreten der Landschaften. Die Vorgabe greift genau einmal je
Besuch: beim ersten Betreten.

⭐ Das ist keine neue Denkweise, sondern die Ausweitung einer, die schon dasteht. Am Fluss-Haken
steht seit dem 23.08.2026: „Der Haken bleibt dabei benutzbar (Owner-Entscheid): der Wechsel setzt
ihn, die nächste eigene Entscheidung sticht ihn — bis zum nächsten Wechsel." Genau dieses „bis zum
nächsten Wechsel" fällt weg.

💣 **DIE TRAGENDE FALLE: unser eigenes Setzen darf nicht als Nutzerwahl zählen.** Das Profil setzt
`checked` und feuert `change` von Hand — daran hängen die Zeichner (`syncPathVisibility`, die
Grenz-Leinwand). Ein Zuhörer, der jedes `change` als „der Nutzer hat gewählt" verbucht, schriebe im
selben Zug die Vorgabe als Nutzerwahl fest; ab da wäre das Profil für den Rest des Besuchs
wirkungslos, **und es sähe völlig richtig aus** — die Karte zeigt ja genau, was die Vorgabe wollte.
Auffallen würde es erst beim zweiten Betreten, und niemand brächte es damit in Verbindung.

🔴 **Die Weiche ist `event.isTrusted`** — `false` für alles, was `dispatchEvent` erzeugt, `true` nur
für eine echte Hand. Kein Merker, der über eine asynchrone Grenze auslaufen kann, und er hält auch
gegen die anderen programmatischen Schreiber dieser Haken (URL-Persistenz `?togglePaths=0`,
`applyFrontendLayerModeDefaults`). ⚠️ Dass ein Klick auf die `<label>`-Zeile wirklich ein
vertrauenswürdiges `change` am `<input>` erzeugt, wird **im Browser gemessen**, nicht angenommen;
hält es nicht, ist der Rückfall ein Riegel um das eigene Schreiben (`schreibtSelbst`), und dann
gehört an ihn der Kommentar, warum nicht `isTrusted`.

⚠️ **Die Ortsklassen sind keine Checkboxen**, sondern jQuery-Knöpfe mit `is-active`; ein
programmatisches `toggleClass` feuert dort ohnehin nichts. Für sie hört der Zuhörer auf den
`click` der `.location-toggle`-Knöpfe — und auch das ist eine echte Hand oder gar nichts.

⭐ **Ein „nur beim Betreten anwenden" braucht es NICHT — und das ist die eigentliche Vereinfachung.**
Der naheliegende Weg wäre gewesen, das Anwenden am Ebenenwechsel zu unterdrücken (es hängt an
`syncEcosystemPaneStates` und läuft heute bei jedem). Nötig ist das nicht: die Appliers fragen nicht
mehr die Vorgabe, sondern **das Soll** — und das IST ab der ersten eigenen Entscheidung die Wahl des
Nutzers. Ein erneutes Anwenden schreibt dann seine eigene Lage zurück und ist ein Leerlauf
(`haken.checked === soll` steigt aus, ohne ein Ereignis zu feuern). Damit fällt ein Mechanismus weg
statt dazuzukommen:

```js
function ecosystemAnzeigeSoll() {
	const profil = ecosystemFrontendProfile();      // null = Editor oder andere Ansicht
	return profil ? (ecosystemAnzeigeWahl || profil) : null;
}
```

💣 **Die Ortsklassen werden dabei aktiv EINGESCHALTET, nicht bloß „nicht weggenommen".** Heute
fragt `syncEcosystemSettlementVisibility` nur, ob sie *zurücktreten* sollen (`nimmtOrte`); für
„Alle" tut sie schlicht nichts, und der Besucher sieht dort, was er ohnehin eingestellt hatte. Für
„default aktiviert und sichtbar" reicht das nicht — die Funktion bekommt den dritten Zustand
„leihen **und setzen**".

⚠️ **Das Ausleihen und Zurückgeben bleibt unberührt.** Beim Verlassen bekommt der Besucher seinen
Stand von VOR den Landschaften zurück (`ecosystemSettlementMemory`, `ecosystemRiverMemory`) — sonst
säße er in „Standard" mit einer Lage, die er nie gewählt hat. Die Wahl aus den Landschaften lebt
daneben und kommt beim nächsten Betreten zum Zug. **Zwei Gedächtnisse mit zwei verschiedenen
Fragen** („was hatte er vorher" / „was will er in den Landschaften"), und sie dürfen nicht
zusammengelegt werden.
🪤 `js/review/__tests__/garetien-import-sicht.test.js` nagelt das Ausleihen fest — ein fremder Test,
der beim Zusammenlegen umfiele.

🔴 **Der Editor behält die leere Zeichenfläche** (Owner-Entscheid 09.09.2026).
`ecosystemFrontendProfile()` gibt für ihn weiterhin `null` zurück — „hier wird nichts angefasst";
er hat seine Schalter und seinen Regler gleich daneben. Diese Unterscheidung ist die Begründung des
ganzen Profils und bleibt.

⚠️ `GRUND_DECKKRAFT.ecosystem` im Fächer (heute 0,25) fällt auf 0: die Landschaften-Kachel und die
fünf Ebenenzellen zeigen den Pergamentgrund, kein Kachelbild. Ein Vorschaubild, das etwas anderes
ankündigt als die Karte zeigt, ist genau die Falle, vor der `tools/layer-tiles/capture.js` warnt.
Für den Editor mit Regler auf 25 % weicht die Vorschau damit ab — gewollt: die Zelle zeigt die
Ansicht, nicht seine persönliche Einstellung.

## 4 · Fünf Vektoren, vier davon neu

Bauform wie die bestehenden `OVERLAYS`: 48×48, echte Farben aus `css/base/tokens.css`, ausgefranste
Ränder, kein Kachelbild darunter.

⭐ **„Alle" ist der `ecosystem`-Vektor** — dieselbe Zeichnung wie die Landschaften-Kachel der ersten
Stufe. Es sind also vier eigene Ebenen-Vektoren statt fünf, und das Untermenü kann von der Kachel
darüber nicht abdriften.

🔴 **„Alle" setzt sich aus „Derographie", „Vegetation" und „Topographie" zusammen** (Owner
14.09.2026, am gerenderten Bild abgenommen: „du musst dir fuer die icons merken").
`OVERLAYS.ecosystem` ist GENAU: die Flächengruppe aus `eco_derographisch` + `eco_vegetation` +
`eco_topographie` + die gestrichelte Grenzgruppe aus `eco_derographisch` — die Grenzen zuoberst,
sonst verschwinden sie unter Wald und Gebirge. Die Klimazonen gehören nicht hinein, und „Alle"
trägt nichts Eigenes (kein eigenes Wasser, kein eigener Hügel). Wer eine Ebene ändert, ändert
„Alle" mit — `tools/__tests__/ansicht-untergrund-vektoren-zwilling.test.js` hält die Summe fest
und nennt den Teil, der abweicht.

| Zelle | Was der Ausschnitt zeigt | Töne |
|---|---|---|
| Alle | = die Landschaften-Kachel: Derographie-Flächen, Vegetation, Topographie, zuoberst die Derographie-Grenzen | die Töne der drei Ebenen |
| Derographie | Drei Gebiete treffen sich in einem Punkt, Kontur gestrichelt als Konvention der Ebene (auf der Karte nur im Bearbeiten-Modus zu sehen), drei zarte Füllungen | `#575757`, Kontur `#2e2e2e` |
| Vegetation | Grasland und Wald, zufällig-eckig aus einem Rauschfeld (Samen 101), vom Owner aus Vorschauen gewählt | `#5f7d33` `#3f6b2c` |
| Topographie | Drei große Gebirgsflecken über den Rand, ein unregelmäßiger See mit dünnem, geschlängeltem Fluss, der unten aus der Kachel läuft (See und Fluss ein Pfad) — aus Rauschfeldern erzeugt | `#7a6c5e` `#4c89c6` |
| Klimazonen | waagerechte Bänder, kalt oben nach warm unten | `#cfe0eb` … `#c65e2e` |

💣 **Die Farben sind die ECHTEN, jede aus der Stelle, die sie auf der Karte zeichnet** — dieselbe
Zusage wie bei den bestehenden Vektoren. Wer sie „aufräumt", macht die Zelle zu einem Symbol, das
etwas anderes ankündigt als die Karte zeigt.

🔴 **Korrigiert 14.09.2026:** Diese Zeile behauptete „die einzige ohne Füllung" — inzwischen tragen
die drei Flächen der Derographie-Zelle je eine eigene, zarte Füllopazität (.13 / .2 / .09), damit der
Behälter auf 48 px lesbar bleibt (ungefüllt läse sich die Zelle als „nicht geladen"). Und seit
demselben Tag trägt auch die Zelle „Alle" dieselbe gestrichelte Grenzlinien-Gruppe, weil sie alle
Ebenen zeigt. Was bleibt: **nur** die derographische Fläche wird per Konvention gestrichelt
gezeichnet, nie durchgezogen — ⚠️ zu sehen ist die Kontur auf der Karte aber nur im Bearbeiten-Modus
und nur in einer einzelnen Ebene, nie in „Alle" (`--eco-contour`, `css/features/ecosystem-layer.css`).
Für die Füllung gilt auf der KARTE: in ihrer eigenen Ansicht füllt die Fläche mit 0,16, ungefüllt (0)
bleibt sie nur in „Alle".

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
  keine dritte Stufe, auch nicht im Editor; die eine Regel („mit Untermenü öffnet, ohne wählt") auf
  beiden Stufen; Kachel und Landschaften-Zelle tragen Name UND Bild der gewählten Ebene;
  `nth-child`-Staffelung deckt fünf Zellen; die CSS-Zuklappzeit und `BLENDE_ZU_MS` bleiben gekoppelt.
- **Neu** `js/ui/__tests__/landschaften-untermenue.test.js` — der Fächer schreibt den Ebenenzustand
  ausschließlich über die Reiter (Spion auf `#ecosystem-layer-switch`), nie über eine eigene
  Variable; „Alle" geht über `[data-ecosystem-show-all]`, nicht über einen `kind`.
- **Neu** `js/map-features/__tests__/wasserton.test.js` — die vier Schreibstellen gegen
  `--color-water` aus `tokens.css`, gelesen, nicht abgeschrieben.
- `js/map-features/__tests__/ecosystem-frontend-profil.test.js` — erweitert: **ein** Profil statt
  zweier, alle zehn Schalter an, Untergrund 0 %, Kacheln abgehängt, Editor unberührt.
- **Neu** `js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js` — der Kern von §3.3,
  wirklich ausgeführt statt gelesen: ein `change` mit `isTrusted: false` verbucht **keine**
  Nutzerwahl, eines mit `isTrusted: true` schon; ein Ebenenwechsel wendet die Vorgabe **nicht**
  erneut an; das Verlassen gibt den Stand von vor den Landschaften zurück, während die
  Landschafts-Wahl daneben stehen bleibt; das zweite Betreten nimmt sie und nicht die Vorgabe.
  🪤 Attrappen ohne Proxy — ein Proxy, der jeden Bezeichner beantwortet, verschluckt genau den
  Fehler, den dieser Test finden soll (die Lehre vom 03.09.2026).
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

- 🔧 Der Ablauf mit angemeldeter Sitzung: Reiterleiste und Fächer als EIN Zustand sind bis zur Abnahme
  nur am Mockup und im Browser ohne Editor-Rechte geprüft.
- 🔧 Ob fünf Ebenenzellen am Telefon in zwei Reihen oder in einer schmalen bleiben, entscheidet
  der Blick am Gerät — die Media Query ist vorbereitet, die Wahl nicht getroffen.
- 🔧 Ob der See dem Fluss auch im BILD gleichen soll (Deckkraft 1), ist eine Owner-Frage; §5.
