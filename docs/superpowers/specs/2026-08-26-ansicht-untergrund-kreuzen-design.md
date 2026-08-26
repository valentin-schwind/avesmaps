# Ansicht × Untergrund kreuzen — Entwurf

**Stand:** 2026-08-26 · **Mockup:** `docs/ansicht-untergrund-mockup.html`
(Build-Produkt, erzeugt von `tools/bau-ansicht-untergrund-mockup.js`)

## 1. Worum es geht

Die fünf Derographie-Ansichten (**Standard · Politisch · Kraftlinien · Landschaften ·
Nur Karte**) sollen mit den Kachelsätzen (**Old · Original · Modern**) frei kreuzbar sein.

🔴 **Heute ist der Untergrund kein eigener Zustand, sondern Beifang der Ansicht.**
`setSelectedMapLayerMode` (`js/map-features/map-features-display-mode.js`) schreibt ihn hart
mit: `original → setMapStyle("old")`, alles andere → `setMapStyle("stylized")`. Der
Kachelsatz-Select `#mapStyleSelect` existiert nur im Editor; im Frontend wird jede Wahl
überschrieben. Ein `?mapstyle=old` in der Adresse wird deshalb beim Laden wieder
weggeschrieben (live gemessen 26.08.2026).

„Original" ist damit gar keine Ansicht, sondern **eine nackte Ansicht und ein Untergrund in
einem Knopf**. Das Aufbrechen heißt: Original verlässt die Ansichtsreihe und wird ein
Untergrund. Aus 6 Ansichten werden 5, dazu 3 Untergründe.

## 2. Die drei Kachelsätze

| Name | Ordner | Was ihn ausmacht |
|---|---|---|
| **Old** | `tiles/old` | die alte Karte **mit aufgedruckten Namen** (GARETH, Vierok, Wiesengrund …) |
| **Original** | `tiles/original` | dieselbe alte Karte **ohne** Namen — das Update vom 26.08.2026 |
| **Modern** | `tiles/stylized` | die neu erzeugte Karte, ebenfalls ohne Namen |

🔴 **Old sieht nur der Editor, im Frontend ist es verborgen** (Owner 26.08.2026). Editoren
dürfen **alles** kombinieren — auch Standard auf Old, denn genau dafür ist es da: die
aufgedruckten Namen mit dem vergleichen, was wir erfasst haben.

💣 **Die Beschriftungen wandern, die Kennungen nicht.** `stylized` bleibt `stylized` (Ordner,
geteilte Links, gemerkte Editor-Einstellung), auch wenn es „Modern" heißt — dieselbe Trennung
wie „Neuigkeiten"/`changelog` (AGENTS.md §11).

🪤 **Verworfene Namen für `stylized`,** damit sie nicht wiederkommen: **„Gemalt"** schreibt die
Arbeit einem Menschen zu, der sie nicht gemacht hat — eine falsche Angabe, keine
Geschmacksfrage. **„Geländekarte"** stünde im Menü direkt neben der Ansicht „Landschaften" und
wäre von ihr nicht zu unterscheiden. **„Illustriert"** klingt nach Design. Ebenfalls verworfen:
Generiert / Erzeugt / Errechnet / Synthetisch. Als Satz gelesen trägt **Old / Original /
Modern**.

## 3. Das Menü — Form E

Zugeklappt bleibt die Kachel unten rechts. Überfahren öffnet die Ansichtsreihe **nach oben**
(der Bund `#map-corner-actions` ist `position: fixed; right; bottom` und wächst nach oben).
Bleibt der Zeiger auf einer Ansicht, fährt **darüber** ein Untermenü heraus: es beginnt als
**eine Kachelbreite genau über dieser Ansicht** und teilt sich in die Untergründe auf.

🔴 **Eine Auswahl schließt das Menü.** Es gibt genau zwei Auswahlen:

| Handlung | Wirkung |
|---|---|
| Untergrund im Untermenü anklicken | wählt **beides** (Ansicht + Untergrund), schließt |
| Ansicht anklicken, **erstes** Mal | hält ihr Untermenü offen — wählt **nicht** |
| dieselbe Ansicht **noch einmal** | wählt sie allein, Untergrund bleibt, schließt |

⭐ **Daraus fällt das Telefon-Verhalten ab.** Ohne Überfahren ist die zweite Stufe anfangs zu,
also öffnet der erste Tipp und der zweite wählt — dasselbe Modell wie am Zeiger, **kein
zweiter Bedienweg**. Das Klick-Festhalten war die Anforderung; die Telefon-Tauglichkeit ist
ihre Folge, kein Zusatz.

### Fallen im Menü

💣 **Die Teilung setzt an der QUELLZELLE an, nicht in der Mitte der Reihe.** Startbreite ist
`--map-layer-tile` (die Silhouette einer Kachel), nie eine abgeschriebene 78 — wächst das
längste Wort, wächst die Zelle. Getragen von `clip-path`, wie das Aufrollen des Hauptrasters:
es verschiebt nicht und blendet nicht.

💣 **Zwischen Ansichtsreihe und Untermenü liegen 6 px Lücke.** Ohne Gegenmaßnahme nimmt ein
`mouseleave` beim Hochfahren die Stufe weg, die der Benutzer gerade ansteuert. **Zwei Riegel,
nicht einer:** eine unsichtbare Brücke (Pseudo-Element der Unterreihe, 10 px nach unten)
schließt die Lücke, und ein **Nachlauf von 260 ms** — derselbe Wert wie beim Hauptmenü — fängt
alles Übrige. Jede Rückkehr bricht ihn ab.

💣 **Beim Überfahren einer Ansicht darf das Menü NICHT neu gezeichnet werden.** Neue Zellen
starten bei `opacity: 0`; ein `zeichneMenue()` im `mouseenter` ließ bei jeder Mausbewegung die
ganze Reihe samt Staffelung erneut aufblenden. Umgehängt wird nur die Marke.

💣 **Eine offene Untergrund-Reihe wandert, sie fächert nicht neu auf.** `left` wird dafür nur
am `.is-open`-Zweig animiert — sonst führe sie beim ersten Erscheinen von links herein.

## 4. Die Kacheln — Vektor über Untergrund

🔴 **Die Ansichten sind Vektoren, keine Aufnahmen.** Eine Aufnahme trägt ihren Untergrund
eingebrannt mit, also bräuchte jede Kreuzung ein eigenes Bild (5×3, später 5×4 …). Ein Vektor
ist untergrundfrei und liegt über **jeder** Kachel: **3 Kacheln + 5 Vektoren = 8 Teile für 15
Kombinationen.** Ein vierter Untergrund kostet ein Bild, eine sechste Ansicht einen Vektor.

⭐ **Damit entfällt die Bedingung, dass alle Ansichten denselben Kartenausschnitt zeigen
müssen** — ein Vektor hat keinen Ort. `tools/layer-tiles/capture.js` nimmt heute jede Ansicht
an einem eigenen Ort auf (Owner-Entscheid 11.08.2026); das bleibt unangetastet.

💣 **Die Farben sind die echten, nicht erfundene:** Orte `--color-marker-settlement`, Grenzen
`#d3d3d3` (Außenkontur aus `map-features-boundary-canvas-overlay.js`), Kraftlinien der
**dreifache Strang** aus `css/features/powerlines.css` (`--aura` `rgba(255,70,90,.42)`, `--mid`
`rgba(255,105,130,.82)`, `--core` `rgba(255,235,240,1)`), Vegetation und Topographie aus den
`--color-ecosystem-*`-Tokens. **Reichsstraße, Straße und Weg haben bewusst kein Token** — ihre
Kartenfarben sind Weiß, Grau und Hellwarm (Vermerk in `tokens.css`).

💣 **Die Straßen sind aus der Vorlagekachel nachgezeichnet** (z3 / `map_17_-17`, der Sternknoten
Gareth), Koordinaten aus dem 256er-Bild geteilt durch 5,33. Weil alle drei Untergründe denselben
Ausschnitt zeigen, deckt sich der Vektor mit den gemalten Straßen jedes Kachelsatzes.
⚠️ **Diese Zahlen gehören zur Vorlagekachel, nicht zur Ansicht** — wechselt der Ausschnitt,
wandern sie mit. Jede Straße mündet in einem Ort; die langen haben deshalb zwei Kurvenstücke.

💣 **Was die Ansicht mit dem Untergrund macht, gehört auf das Bild, nicht auf die Zelle.**
Kraftlinien entsättigt (`saturate(0.1) brightness(0.6)`, der echte Wert aus
`syncPowerlineMapTint`), Landschaften blendet ab (**25 %**, `ECOSYSTEM_UNDERGROUND_FRONTEND`)
— und zwar gegen `--color-ecosystem-underground` (`#d3cec2`), **nicht gegen Weiß**. An der Zelle
gesetzt entsättigte der Filter den Vektor gleich mit, und die Kraftlinien wären grau statt rosa.
⭐ Als Filter auf der Untergrund-Schicht stimmt beides auf **jedem** Kachelsatz — eingebrannt in
eine Aufnahme galt es nur für den einen, auf dem sie entstand.

## 5. Die Beschriftung

**Zweizeilig:** Ansicht oben, Untergrund darunter in `--color-link` bei voller Deckkraft
(gemessen 4,45:1 hell / 7,79:1 dunkel). „Standard · Modern" passt nie in eine Zeile — die Zelle
ist 66 px breit, gebunden an das längste Ansichtswort.

🪤 Verworfen: ein Kürzel (OLD/ORIG/STIL) auf dem Bild. Es hielt die Kachel 15 px flacher,
verlangte aber, drei Kürzel zu lernen. Owner: „kürzel sind hier doof".
🪤 Verworfen: 50 % Deckkraft — gemessen 2,09:1, unter jeder Lesbarkeitsschwelle.

🔴 **Die zweite Zeile blendet aus, sobald das Menü aufklappt.** Im offenen Menü wählt man den
Untergrund in der zweiten Stufe; die Auskunft wäre dort veraltet, kaum dass man hinsieht.
⭐ Das braucht **keinen Zustand im JS**: die Zeile sitzt in den Menüzellen, und `.is-open` kommt
erst im nächsten Bild (das Menü braucht das ohnehin fürs Aufrollen) — sie startet bei 1 und
blendet von selbst auf 0.
⚠️ Damit löst sich auch die Frage nach den leeren Zeilen: offen ist die Zeile überall
unsichtbar, die aktive Zelle bildet keine Ausnahme. Der Platz bleibt reserviert, **sonst springt
die Kachel**.

💣 **Kachel und aktive Zelle müssen gleich hoch sein und dieselbe Kante haben** (5 px Polsterung
+ 1 px Rahmen, beide rechts/unten verankert). Gemessen: Sprung 0/0 px. Die aktive Zelle trägt
denselben Text wie die Kachel — sonst wechselte er an genau der Stelle, die unverändert
dastehen muss.

## 6. Befund für den Bau

🔴 **Die Optik der zugeklappten Kachel hängt an einer ID** — `#map-layer-button`, und zwar in
**zwei** Dateien: Innenmaß in `css/components/map-layer-picker.css`, Farbe/Rahmen/Schatten in der
Eckknöpfe-Regel in `css/components/legal-dialog.css`. Soll das Menü künftig mehrfach vorkommen
(Karte *und* Editoren), trägt eine ID genau ein Vorkommen — die Regeln gehören an die **Klasse**.
Ein globaler `[hidden] { display: none !important }` in `css/base/reset.css` fängt heute, dass
`display: block` das `hidden`-Attribut schlägt.

## 7. Bauschritte

Sichtbare Änderungen gehen **einzeln** live (AGENTS.md §9).

1. **Fundament, unsichtbar.** Der Untergrund wird ein eigener Zustand: `MAP_TILE_STYLES` bekommt
   `original` dazu, dazu ein Planner-State plus URL-Parameter. `setSelectedMapLayerMode` erzwingt
   ihn nur noch, wenn keiner gewählt ist. „Original" bleibt vorerst als Ansicht stehen — es
   verschwindet nichts.
2. **Die zweite Stufe im Menü.** Untergrund-Reihe, Teilung, Klick-Festhalten, Telefon-Weg.
   „Original" ist weiterhin auch Ansicht.
3. **Umstellung.** „Original" verlässt die Ansichtsreihe, alte Links `?mapLayerMode=original`
   werden übersetzt, Old wird auf Editoren beschränkt.
4. **Die Vektorkacheln** samt zweizeiliger Beschriftung.

## 8. Offen

🔧 Ob der erste Klick auf eine Ansicht sie aufklappen (jetziger Stand) oder sofort wählen soll.
Der jetzige Stand hält die Regel „eine Auswahl schließt" sauber; sofortiges Wählen löste beim
Weg über zwei Klicks **zwei** Kartenwechsel aus, und Politisch lädt dabei je ~1,2 MB.
🔧 Die Bewegung selbst ist nur vom Owner beurteilt — der eingebaute Browser rendert ohne
Bildfrequenz, `requestAnimationFrame` feuert dort nicht.
