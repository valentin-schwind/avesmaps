# Die Zeichenflächen der Karte — Technik, Schärfe, Blenden

> Stand: 24.08.2026. Entstanden aus einer Sitzung, in der vier Runden damit vergingen, dass
> „blenden" falsch verstanden wurde. Dieses Dokument existiert, damit das niemand wiederholt.

## §1 Die eine Regel

**Was Geometrie ist, steht. Was Schrift ist, blendet.**

| | |
|---|---|
| **blendet beim Zoomschritt** | Grenzbeschriftungen · Wege- und Flussnamen · Siedlungsnamen · Landschaftsnamen |
| **skaliert stufenlos mit** | Kacheln · Grenzlinien · Wege · Flüsse · Territoriums- und Landschaftsflächen · Ortsmarkierungen |

🔴 Owner-Entscheid, wörtlich: *„kannst du die grenzen, straßen und flüsse selber (nicht die labels!)
stabil halten? labels sollen schön ein und ausblenden"* und *„nur labels sollen ein- und
ausblenden"*.

🪤 **Die Blende ist kein Ersatz für Mitskalieren.** Die Ortsmarkierungen hatten seit Juni eine
Blende, weil ihr Canvas beim Zoom nicht mitskalierte — sie hat den Sprung **verdeckt**, nicht
behoben. Seit `058e92a4` skaliert der Canvas mit (`leaflet-zoom-animated` + `setTransform` im
`zoomanim`), und die Blende ist weg. Wer irgendwo ein „Ploppen" mit einer Blende zudeckt, sollte
zuerst prüfen, ob die Fläche überhaupt mitskaliert.

## §2 Was „blenden" hier heißt — und was nicht

💣 **Zwei Bedeutungen, und die Verwechslung hat diese Sitzung vier Runden gekostet.**

1. **Weicher Bandrand** — ein Element beginnt schwach, wenn es auf seiner Zoomstufe erscheint.
   Das tun die Ortsmarkierungen (Größenrampe ab 1,33 px) und die Grenzlinien
   (`BOUNDARY_WEAK_ALPHA_BY_ZOOM`: 0 / 0,15 / 0,30 / 0,50 / 1).
2. **Zeitanimation am Zoomschritt** — das Bild geht weg und kommt weich zurück, damit der
   Inhaltswechsel (andere Lage, andere Schriftgröße) nicht als Schnitt im Bild steht.

🔴 **Gemeint war (2).** Owner, wörtlich: *„ich will, dass die grenzbeschriftungen animiert
einblenden von z4 (0) --> z5 (0.75) in keine ahnung wieviel millisekunden"* — und später, zum
Kernproblem: *„von zoom 6 auf 7 (beide eingeblendet) springts"*.

🪤 Ein Versuch, (1) als abgestufte Deckkraft je Zoomstufe zu bauen (`f6667300`), wurde am selben
Tag zurückgenommen (`3d8131b8`): er machte die Beschriftung auf z4 und z5 **dauerhaft blasser**,
statt nur ihren Rand zu glätten.

⚠️ **Eine Zahl in einer Beschreibung ist kein neuer Grenzwert.** Aus „von z4 (0) → z5 (0,75)" wurde
zuerst fälschlich `TERRITORY_LABEL_MIN_ZOOM = 5`; die Schwelle liegt weiterhin bei **z4**, geblendet
wird beim Schritt z3 → z4.

## §3 Die Flächen im Einzelnen

| Fläche | Technik | Deckel Zeigergerät | Deckel Telefon | Blende |
|---|---|---|---|---|
| Grenzlinien | Canvas | **1** | 2 | keine (Geometrie) |
| Grenzbeschriftungen | Canvas (2 Flächen) | **1** | 2 | Überblendung, 350 ms |
| Wege- und Flussnamen | Canvas (2 Flächen) | `Infinity` | 2 | Überblendung, 350 ms |
| Siedlungs- und Landschaftsnamen | DOM (Bild-Icons) | 2 | 2 | Überblendung per Pane-Klon, 350 ms |
| Territoriumsnamen (politisch) | DOM | — | — | CSS-Blende, unverändert |
| Ortsmarkierungen | Canvas | `Infinity` | 2 | keine — skaliert mit |
| Wege, Flüsse, Flächen | SVG | — | — | keine — skalieren nativ |
| Schraffur · Höhenmodell · Fluss- und Tempo-Pfeile | Canvas | `Infinity` | `Infinity` | **offen** |

⚠️ Die Grenzen stehen auf Deckel **1**, weil der Owner den weicheren, „bitmapigen" Ton wollte
(*„das sieht so schön aus"*); die Wegenamen bleiben scharf (*„bei straßen und flüssen sieht
canvasdpr=1.5 besser aus"*). 🔴 **Zwei Schrift-Canvasse, zwei Vorgaben — wer sie angleicht, nimmt
eine am Bild getroffene Entscheidung zurück.**

## §4 Die Schärfe: eine Regel, fünf Leser

`avesmapsCanvasDpr(deckelZeiger)` in **`js/app/runtime-state.js`**, direkt neben
`avesmapsIsPhoneViewport()` — der EINEN Definition von „Telefon" im Haus (grober Zeiger UND
Bildschirm-**Kurzseite** ≤ 600 px, damit ein quer gehaltenes Telefon eins bleibt).

💣 **Sie steht dort, weil sie vorher viermal verteilt stand** — und das war messbar
auseinandergelaufen. Auf einem iPhone mit `devicePixelRatio 3` zeichneten Wegenamen und
Ortsmarkierungen mit 3×, Siedlungs-, Landschafts- und Grenznamen mit 2×. Auf demselben Bild.
Owner: *„sicher dass alle gleich scharf sind?"* — nein, waren sie nicht.

- Jede Fläche behält ihren **eigenen** Deckel für Zeigergeräte. Geteilt ist **nur** die Telefon-Regel.
- 🔴 **Die verworfene Variante bleibt als Option:** volle Geräteauflösung überall entsteht durch
  `avesmapsPhoneCanvasMaxDpr = Infinity` — eine Zuweisung, kein Aufrufer muss angefasst werden.
  Für die geplanten globalen Einstellungen ist das der Schalter.
- ⚠️ Der Grund für den Deckel war **nicht** die Schärfe, sondern der **Speicher**: Siedlungs- und
  Landschaftsnamen werden als Bilder gerendert und zwischengespeichert, bei 3× ist jedes Bild
  2,25-mal so groß. Wer die Option auf `Infinity` stellt, misst den Bild-Cache mit.
- ⚠️ **Pro Zeichnen auswerten, nie einmal merken:** ein Telefon wird gedreht, und ein Desktopfenster
  lässt sich auf Telefonbreite ziehen (bleibt aber Zeigergerät).
- ⚠️ Alle fünf Wirte UND `runtime-state.js` werden ausschließlich von `index.html` geladen (geprüft
  24.08.2026). Wer eine der Dateien woanders einbindet, prüft das — sonst steht dort `undefined`.

## §5 Die Überblendung: zwei Bauformen

### §5.1 Canvas — zwei Flächen, Rollentausch

💣 **Mit EINER Fläche ist „gleichzeitig" unmöglich:** sie verliert ihr altes Bild in dem Moment, in
dem sie das neue zeichnet. Es kann dort nur nacheinander gehen. Zwei Flächen halten altes und neues
Bild zugleich; gezeichnet wird in die **hintere**, danach tauschen die Zeiger — kein `drawImage`
über die volle Fläche.

💣 **Und neu zeichnen geht nicht:** ein `redraw()` blockiert live gemessen **52–99 ms** (Pan bei z5).
Eine 350-ms-Blende Bild für Bild wären 5–10 Redraws. Die Deckkraft **eines** Elements animiert
dagegen der Compositor, ohne den Hauptthread anzufassen.

💣 **Die ausgehende Fläche wird NICHT neu ausgerichtet.** Sie trägt noch die Zoom-Transform aus dem
`zoomanim` und sitzt damit richtig; ein `setPosition` darauf ließe das alte Bild im Moment des
Ausblendens verspringen. Nur die Fläche, in die gezeichnet wird, bekommt Position, Größe und Clear.

⚠️ **Getauscht wird NUR nach einem Zoomschritt.** Ein Pan zeichnet in dieselbe Fläche weiter — dort
gibt es nichts zu überblenden, und ein Rollentausch wäre ein Flackern ohne Anlass.

### §5.2 DOM — ein Klon des Panes

💣 **Genau eine Eigenschaft macht es einfach: die Label-Panes tragen KEINE eigene Transform.** Der
Zoom hängt am `_mapPane`, und die Panes sind dessen Kinder. Ein Klon des Panes, als Geschwister
danebengelegt, skaliert während der Zoom-Animation deshalb **gratis** mit — nichts nachzurechnen,
nichts synchron zu halten. Der Klon hält das alte Schriftbild, während das echte Pane neu bestückt
wird.

💣 **Ein hartes Netz, schon im `zoomanim` gespannt.** Die Blende hängt an `requestAnimationFrame`.
Feuert das nie, bliebe der Klon für immer stehen — und auf der Karte stünde **doppelte Schrift**.
Nach 2 s verschwindet er in jedem Fall, und das Pane geht auf sichtbar.

💣 Immer nur **ein** Klon: jeder `zoomanim` räumt zuerst den vorigen weg. Der Klon verliert die
Klasse `map-labels-pane` (sonst griffe die CSS-Blende auch auf ihm) und bekommt
`pointer-events: none`.

## §6 Die drei Fallen, die es zweimal gebraucht hat

💣 **`transition` ist EINE Eigenschaft.** Wer sie setzt, setzt sie ganz.

- Die Einblendung setzte anfangs `transition: transform 250ms, opacity …` — also nach **jedem**
  Redraw, nicht nur nach einem Zoom. Die Transform-Transition überlebte den Zoom, und weil
  `L.DomUtil.setPosition` die Canvas per `transform` verschiebt, animierte **jeder Pan** die Position
  nach. Owner: *„wenn ich mit der maus panne, ziehen die 2x nach"*. Genau dagegen löschen die
  `moveend`-Handler die Transition — die Einblendung hatte den Schutz zwei Bilder später aufgehoben.
  **Die Transform-Transition gehört ausschließlich in den `zoomanim`-Handler.**
- Bei den Grenznamen steht die Blende in **CSS** (`css/features/map-labels.css`), bei den Wegenamen
  **inline** — kein Schlendrian, sondern erzwungen: deren `zoomanim`-Handler setzt
  `canvas.style.transition` seit jeher selbst, und inline gewinnt gegen CSS.
- Im Wegenamen-Overlay steht `devicePixelRatio` an **zwei gekoppelten** Stellen: die Canvas-Größe und
  der Halo-Multiplikator (`shadowBlur` zählt in Gerätepixeln). Wer nur die Größe deckelt, bekommt
  einen zu starken Schein um jeden Namen — und das liest sich nicht als Fehler, sondern als Geschmack.

💣 **Die Blende startet zwei `requestAnimationFrame` NACH dem Redraw.** Am `zoomend` blockiert der
Hauptthread live gemessen 215 ms (Standard), 692 ms (Landschaften), 836 ms (Politisch); bei reinen
Kacheln 0 ms. Ein dort gestarteter Übergang verstreicht **vollständig, ohne dass ein Bild davon
gezeichnet wird**, und ist fertig, sobald wieder gezeichnet werden kann — er sieht dann aus wie ein
Sprung. Genau der Befund *„blippt und ist dann woanders"*.

⚠️ Die DOM-Labels waren davon nie betroffen: sie müssen beim Einblenden nicht neu gezeichnet werden,
ein Weg schon (Leaflet schreibt allen ~900 Pfaden neue Koordinaten). Dieser Unterschied war der
Schlüssel zur Diagnose — Owner: *„in der politischen ansicht faden die labels aber schön"*.

## §7 Die Stellschrauben

| Parameter | wirkt auf | Vorgabe |
|---|---|---|
| `?labelfade=<ms>` / `?labelfadeout=<ms>` | Grenzbeschriftungen | 350 / 120 |
| `?wegefade=<ms>` / `?wegefadeout=<ms>` | Wege- und Flussnamen | 350 / 120 |
| `?crossfade=0` | alle drei Schrift-Ebenen: zurück auf „erst aus, dann ein" | Überblendung an |
| `?canvasdpr=<zahl>` | alle Canvasse, schlägt jede Vorgabe | — |
| `?phonedpr=voll` / `?phonedpr=<zahl>` | der Telefon-Deckel | 2 |
| `?borderlabels=0` | Gebietsnamen ganz aus | an |
| `?labeltune=1` | Panel: Offset, Schriftgröße, Stützpunkt-Dichte je Zoom | — |

⚠️ Die Dauer der DOM-Pane-Überblendung (350 ms) steht **fest** in `js/app/bootstrap.js` und hat
keinen Parameter. Wenn sie je verstellt werden soll, gehört sie in dieselbe Reihe wie die anderen.

## §7a Offener Entwurf: der Zoomschritt aus einem Guss

🔧 **`docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md`** — Owner-Ziel vom
26.08.2026: eine Kurve und eine Dauer für ALLE Animationen (ease-in-out, 250 ms), alles beginnt bei
`zoomanim` t = 0, und die Marker-Skalierungen sollen aufeinander abgestimmt werden.

💣 **Der Kernbefund steht dort und nicht hier: die Kurven sind bereits einheitlich, die
AMPLITUDEN nicht.** Während der Animation skaliert alles um Faktor 2, aber nichts außer den Kacheln
wächst zwischen zwei Stufen wirklich um 2 — beim Landen schnappt jedes Element um einen anderen
Betrag zurück, von **+5 % (Marker Gebäude) bis −82 % (Wegename)**. Das ist der Grund für den
Eindruck „nicht synchron“.

🩤 Und eine Hypothese, die **gemessen und entkräftet** wurde: der fehlende
`will-change: transform` auf den Canvas-Ebenen ist gegenstandslos — sie tragen `translate3d` und
werden dadurch ohnehin befördert.

## §8 Offen

- 🔧 **Vier Canvas-Ebenen ohne Blende:** Schraffur, Höhenmodell, Fluss- und Tempo-Pfeile. Sie zeichneten
  in den geprüften Ansichten 0 Pixel, deshalb unangetastet — sie schneiden beim Zoomschritt weiterhin um.
- 🔧 **Kein hartes Netz bei den Canvas-Überblendungen.** Der DOM-Klon hat eins (2 s); bei den zwei
  Canvas-Ebenen fehlt es. Der Ausfall wäre dort „unsichtbar" statt „doppelt", also weniger schlimm.
- 🔧 **Die Ortsmarkierungen wachsen während der Zoom-Animation mit** und springen am `zoomend` auf
  ihre Größe für die neue Stufe zurück — dasselbe, was Kacheln und Grenzen tun. Wer das gegenrechnen
  will, tut es im `zoomanim` des Marker-Canvas.
- 🔧 **`regionLabelsPane`** (Territoriumsnamen in der politischen Ansicht) bleibt bei der CSS-Blende.
  Der Owner hat sie ausdrücklich als richtig bezeichnet; sie stand nicht auf der Liste.

## §8a 💣 Leaflet steht während der Animation schon auf der ZIELSTUFE

**Die wichtigste Tatsache für jeden, der während des Zooms zeichnen will.** Aus
`js/third-party/leaflet.js` (1.9.4, minifiziert):

```
_animateZoom: … this.fire("zoomanim",{center,zoom,noUpdate}),
              … this._move(this._animateToCenter, this._animateToZoom, void 0, !0),
              setTimeout(this._onZoomTransitionEnd, 250)
```

und `_move` setzt `this._zoom = zoom` **und** `this._pixelOrigin = this._getNewPixelOrigin(center)`.

🔴 **Unmittelbar nachdem `zoomanim` gefeuert hat, ist Leaflets interner Zustand am Ziel.** Die
250 ms Animation laufen mit `map.getZoom()` = Zielstufe; nur das *Bild* interpoliert über die
CSS-Transform. Daraus folgt:

- **Im `zoomanim`-Handler selbst** ist `map.getZoom()` noch die Quellstufe — das Ereignis feuert
  vor `_move`. Das ist das einzige Zeitfenster, in dem man die Quellstufe noch sieht.
- **Ein `requestAnimationFrame` später** liefert `latLngToLayerPoint` bereits **Ziel**-Koordinaten
  — während die Canvas-Overlays die Transform tragen, die Quell- auf Zielkoordinaten abbildet.
  Wer dort zeichnet, transformiert **doppelt**.

💣 Genau daran ist am 26.08.2026 die Marker-Gegenrechnung gescheitert (Rückbau `b1bd8df7`, live
gemeldet als *„ortsmarkierungen springen wild umher"* und *„zeigt während dem zoom ortschaften an,
die zwischen den beiden levels überhaupt nicht sichtbar sein sollten"*). Es waren nie fremde
Ortschaften — es waren die richtigen an der doppelten Entfernung.

⭐ **Zwei gangbare Wege, und sie sind nicht austauschbar:**
1. **Lage einfrieren** — die Bildschirmlage einmal im `zoomanim` aufnehmen und während der
   Animation nur ablesen (`_friereLagenEin`, `map-features-location-canvas-layer.js`). Richtig für
   Flächen, deren Inhalt sich **nicht** neu anordnet; nebenbei billiger, weil pro Bild alle
   Projektionen entfallen. Gewacht von `js/map-features/__tests__/marker-zoom-koordinaten.test.js`.
2. **Für die Zielstufe zeichnen und die Fläche gegenrechnen** — nötig, wenn der Inhalt selbst
   anders wird (Beschriftungen: andere Schriftgröße, andere Lage, andere Kollisionslösung). Braucht
   Start- *und* Endversatz und ist die riskantere Stelle; Entwurf
   `docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md` §5.

⚠️ **Das Zeichnen selbst kostet nichts** — im zeichnenden Browser gemessen (26.08.2026, echter
Zoomschritt): 0 / 5 / 18 Neuzeichnungen des Marker-Canvas ergeben **denselben** Median von 16,7 ms
je Bild. Das schlechteste Bild (~140 ms) ist die Hauptthread-Blockade am `zoomend` und liegt auch
ohne jede Neuzeichnung an. Wer eine Bildschleife hier aus Kostengründen scheut, scheut das Falsche.

## §9 Messfallen — für den nächsten, der hier misst

🪤 **Und die teuerste zuerst, weil sie wie eine Messung aussieht: ein Browsertab im HINTERGRUND
zeichnet nicht.** `performance.now()` um eine Zeichenfunktion misst dort nur den JS-Anteil — die
Malarbeit und der Texture-Upload passieren nie. Am 26.08.2026 wurde daraus „0,2 ms je `_redraw()`"
und eine Designentscheidung; im zeichnenden Browser war die Wahrheit „kostet gar nichts", also
etwas ganz anderes. Ebenso unbrauchbar sind dort **alle** bildabhängigen Messungen:
`requestAnimationFrame` feuert nicht, CSS-Übergänge starten nicht, und **`zoomanim` feuert
überhaupt nicht** — `map.setZoom(4)` bleibt schlicht stehen (nachgemessen).
⭐ Vor jeder Messung zuerst `document.visibilityState` und einen rAF-Zähler erheben. 0 Bilder
heißt: jede Zahl über Zeichnen, Layout oder Animation ist ungültig. Statische
`getComputedStyle`-Werte ohne laufenden Übergang und rein synchrone Rechnungen bleiben gültig.

🪤 Drei Fehlmessungen in einer Sitzung, alle beim Prüfenden, nicht im Code:

- **`getComputedStyle` liefert veraltete Werte, wenn die Seite keine Bilder erzeugt.** In einer nicht
  eingeblendeten Browser-Ansicht laufen CSS-Übergänge gar nicht los; die Inline-`style.opacity` stimmt,
  die berechnete hinkt einen Schritt hinterher. Das sieht wie ein Fehler aus und ist keiner.
  ⭐ **Verlässlich sind: Inline-Werte, Transition-Ereignisse (`transitionrun`/`transitionend`) und
  `MutationObserver`** — die hängen nicht am Rendering.
- **Ein CSSOM-Lauf muss `@import`-Blätter betreten** (`rule.styleSheet`, nicht `rule.cssRules`) —
  sonst findet er die halbe Stilkette nicht. Und **in Chrome hat JEDE `CSSStyleRule` ein (leeres)
  `cssRules`** (CSS-Nesting): ein `if (r.cssRules)` überspringt damit sämtliche Regeln. Erst den
  Selektor prüfen, dann verschachteln.
- **Ein Canvas ist EIN DOM-Knoten, egal ob es nichts oder vierzig Namen zeichnet.** Wer Zeichenflächen
  per DOM-Zählung inventarisiert, rechnet alles Canvas systematisch klein. ⭐ Die Pixel zählen
  (`getImageData`), nicht die Knoten.
