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

💣 **Die Label-Panes tragen KEINE eigene Transform.** Ein Klon des Panes, als Geschwister
danebengelegt, hält das alte Schriftbild, während das echte Pane neu bestückt wird — nichts
nachzurechnen, nichts synchron zu halten.

🔴 **Hier stand, der Klon „skaliere während der Zoom-Animation gratis mit, weil der Zoom am
`_mapPane` hängt". Das war FALSCH und ist am 26.08.2026 nachgemessen:** `_mapPane` trägt während des
Zooms `translate3d(0px, 0px, 0px)` — **es skaliert überhaupt nicht.** Leaflet zoomt über einen
`leaflet-proxy` und über die Transform der einzelnen `leaflet-zoom-animated`-Ebenen; ein Pane ohne
diese Klasse bekommt nichts davon ab. Der Satz stand vier Wochen da und behauptete das Gegenteil
dessen, was die Karte tat.
⚠️ Das war zugleich die Erklärung für den Owner-Befund *„ortslabels ziehen überhaupt nicht nach"* —
und für den späteren *„es wird das ausgeblendet, was nicht auf der KARTE stabil war, sondern im
screen"*.

⭐ **Seit 26.08.2026 bekommt der Klon deshalb seine EIGENE Zoom-Transform**, dieselbe, die auch die
Canvas-Overlays tragen — er klebt beim Ausblenden an der Karte statt am Bildschirm. Owner nach dem
Ausliefern: *„ortnamen sind jetzt stabil auf der karte!"* Drei Fallen dabei:
- 💣 **Bezugspunkt ist der URSPRUNG des Layer-Koordinatensystems** (`layerPointToLatLng([0, 0])`),
  nicht das Kartenzentrum: die Kinder des Klons stehen in Layer-Punkten der Quellstufe, und nur über
  deren Nullpunkt stimmt die Abbildung auf die Zielstufe.
- 💣 **`transform-origin: 0 0`** — sonst skaliert der Klon um seine MITTE. Leaflet setzt das sonst
  über die Klasse `leaflet-zoom-animated`, die ein Pane nicht trägt.
- 💣 **Transform und Deckkraft in EINER Deklaration** — `transition` ist EINE Eigenschaft; zwei
  Zuweisungen löschen einander aus, und eines von beidem spränge hart.

🪤 **Die Trennlinie, an der der Owner es gesehen hat, ist Canvas gegen DOM:** *„gebirge machen es
richtig, die restlichen label kleben noch am bildschirm."* Die Gebirgsnamen sind Kurvenbeschriftungen
auf einer **Canvas** — die bekommt ihre Transform seit jeher. Alles im **DOM-Pane** bekam keine.

💣 **UND DIE ZWEITE MESSUNG IST DIE WICHTIGERE: Leaflet setzt die Beschriftungen des echten Panes
schon im `zoomanim` auf ihre ZIELpositionen um.** Gemessen an derselben Beschriftung im selben
Augenblick:

| | 1. Beschriftung |
|---|---|
| Klon (altes Bild) | `translate3d(1675px, 212px)` |
| echtes Pane | `translate3d(2290px, -183px)` |

Beide halten **denselben** Beschriftungssatz (227 Stück) — das Pane wird erst am `zoomend` neu
bestückt. Es sind also zweimal die ALTEN Namen, an zwei verschiedenen Stellen. Der Grund ist
wieder §8a: Leaflets interner Zustand steht direkt nach dem `zoomanim`-Ereignis auf der Zielstufe,
und seine Marker positionieren sich daraufhin um.

🔴 **Folge, und sie ist die Ursache jeder doppelten Beschriftung:** jeder Augenblick, in dem Klon
und Pane **beide** sichtbar sind, zeigt dieselbe Schrift an zwei Stellen. Nicht „alt gegen neu" —
zweimal alt. Genau das hat der Owner am 26.08.2026 berichtet: *„wenn ich von einer zoomstufe 4 auf 5
wechsel, wo ein label in 5 verschwindet, seh ichs trotzdem kurz doppelt"* — eine Beschriftung, die
es auf der Zielstufe gar nicht gibt, **kann** nicht mit ihrer neuen Fassung doppeln.

💣 **Ein hartes Netz, schon im `zoomanim` gespannt.** Die Blende hängt an `requestAnimationFrame`.
Feuert das nie, bliebe der Klon für immer stehen — und auf der Karte stünde **doppelte Schrift**.
Nach 2 s verschwindet er in jedem Fall, und das Pane geht auf sichtbar.

💣 Immer nur **ein** Klon: jeder `zoomanim` räumt zuerst den vorigen weg. Der Klon verliert die
Klasse `map-labels-pane` (sonst griffe die CSS-Blende auch auf ihm) und bekommt
`pointer-events: none`.

🔴 **Seit 26.08.2026 blendet der Klon ab `zoomanim` t = 0 aus, nicht erst nach dem Zoom.** Owner,
wörtlich: *„können wir die stadtlabels nicht ausblenden im moment wo der zoom beginnt (nicht erst
danach)"* — der Befund davor: *„ich zoom rein, alle label bleiben an ihrer stelle, DANN blenden sie
aus"*. Der Klon skaliert dabei weiter mit; er wird nur zunehmend durchsichtig.
💣 **Ohne erzwungenen Zwischenstand (`void klon.offsetWidth`) gibt es keinen Übergang** — der
Browser fasst `opacity 1` und `opacity 0` im selben Tick zusammen, und der Klon verschwindet **hart**.
Das liest sich wie ein Fehler in der Blende und ist einer im Setzen. ⭐ `?labelparallel=0` stellt den
Stand von vorher her.

🔴 **Und das EINblenden kann NICHT mitwandern — das ist eine Grenze, keine offene Aufgabe.**
Ein Leaflet-Marker setzt beim `setIcon` seine Position über `map.latLngToLayerPoint` neu. Während der
Animation steht Leaflets Zustand schon auf der Zielstufe (§8a), das Pane trägt aber die
Quelle-auf-Ziel-Transform seines Elternteils — die neuen Namen wären **doppelt transformiert**,
genau der Fehler, der am 26.08.2026 die Marker-Gegenrechnung gekostet hat. Es scheitert **nicht am
Preis**: `syncLabelIcons` kostet 16,2 ms im Median (JS-Anteil, an 159 Beschriftungen gemessen).
⭐ Wer es doch will, braucht ein **zweites, gegengerechnetes Pane**: die neuen Namen dort aufbauen,
es wie eine Canvas-Fläche vom künftigen Eckpunkt auf `1/scale` starten lassen, einblenden, am
`zoomend` tauschen. Das ist der Canvas-Weg auf DOM übertragen — ein Umbau, keine Stellschraube.
⚠️ Bei den **Canvas**-Ebenen (Grenznamen, Wege-/Flussnamen) geht das volle Überblenden dagegen: dort
wird in eine Fläche gezeichnet, die man als Ganzes gegenrechnen kann.

## §5a 💣 „Blende gesetzt" heißt NICHT „Blende läuft ab jetzt"

**Die Falle, die am 26.08.2026 doppelte Beschriftungen erzeugt hat** — vom Owner per
Bildschirmaufzeichnung belegt: *„AVENTURIEN"* stand für einen Moment **zweimal** da, senkrecht
versetzt, einmal in der alten und einmal in der neuen Beschriftungslage.

Die Rechnung dagegen war eindeutig: die ausgehende Ebene blendet ab `zoomanim` t = 0 über 250 ms
aus, das neue Bild kommt erst nach dem `zoomend` — **kein Überlappen möglich**. Der Fehler steckte
nicht in der Rechnung, sondern in einer unausgesprochenen Annahme:

> Eine CSS-Blende beginnt **nicht**, wenn man sie setzt, sondern beim nächsten **Stilabgleich**.

Und der Hauptthread ist beim Zoomstart damit beschäftigt, sämtliche Ebenen zu zeichnen. Startet die
Blende 100 ms zu spät, steht die alte Schrift beim `zoomend` noch bei 0,4 — und die neue kommt
darüber. Zwei Bilder mit **verschobenem Inhalt**, beide halb sichtbar: doppelte Schrift.

💣 **UND DIE ZWEITE HÄLFTE, DIE DEN FEHLER ERST ERKLÄRT HAT: `style.transition = ""` schaltet
keinen Übergang ab.** Es entfernt nur die *inline*-Angabe — danach gilt wieder die CSS-Regel.
Im Klon-Code stand seit Monaten:

```js
pane.style.transition = "";   // gemeint war „kein Übergang"
pane.style.opacity = "0";     // gemeint war „sofort weg"
```

Das Pane **blendete** also, statt zu springen. 🪤 Fünf Monate lang fiel das nicht auf, weil die
CSS-Regel `100ms` sagte. Als sie am 26.08.2026 auf die gemeinsame Zoomdauer gezogen wurde, blendete
das Pane über die **volle** Bewegung — im Gleichschritt mit dem Klon, und damit war jede
Beschriftung doppelt zu sehen. Gemessen vom Owner:

```
    0 ms | Klon 1.00 | Pane 1.00   <-- BEIDE SICHTBAR
  740 ms | Klon 0.96 | Pane 0.96   <-- BEIDE SICHTBAR
```

🔴 **Die Vereinheitlichung hat den Fehler nicht verursacht, sie hat ihn sichtbar gemacht.** Wer eine
CSS-Dauer zusammenführt, ändert damit jede Stelle mit, die sich stillschweigend auf ihre alte Kürze
verlassen hat. ⭐ Vorher `git grep 'style.transition = ""'` im selben Wirkungskreis.
⚠️ Und ein fester Timer daneben (Sicherheitsnetz, Aufräumer) muss **mit der Dauer wachsen** — die
feste 2-Sekunden-Frist des Klons feuerte unter `?zoomlupe` mitten in die laufende Bewegung.

⭐ **Die Regel, die daraus folgt:** wer zwei Übergänge gegeneinander plant, darf nicht mit dem
Zeitpunkt der *Zuweisung* rechnen. Garantiert ist nur, was man erzwingt. Die ausgehende Ebene wird
deshalb beim Einblenden **hart auf 0 gesetzt** statt überblendet — ihre Blende hatte sie beim
Zoomstart; was davon noch läuft, hat dort nichts mehr zu suchen. Drei Stellen, eine Ursache:
`labelHinten` (Grenznamen), `hinten` (Wegenamen), und der DOM-**Klon** wird entfernt, bevor das
Pane einblendet.

💣 **Die Inline-Transition muss SOFORT wieder weg.** `transition` ist EINE Eigenschaft und inline
gewinnt: ein stehengebliebenes `transition: none` löschte die CSS-Blendenregel aus
`css/features/map-labels.css` **dauerhaft und lautlos** aus — die Beschriftungen blendeten danach
nie wieder.
💣 **Und der erzwungene Zwischenstand (`void flaeche.offsetWidth`) dazwischen ist tragend**: ohne
ihn fasst der Browser `transition: none`, das Nullsetzen und die Rücknahme zu einem Schritt
zusammen, und das harte Setzen wirkt nicht.
⚠️ Nur im parallelen Pfad. Bei `?labelparallel=0` / `?crossfade=0` **ist** die Überblendung das
Gewollte — dort fängt das Ausblenden erst in diesem Moment an.

🪤 **Warum eine Überblendung überhaupt doppelt zeigt:** sie blendet zwei Bilder gegeneinander, und
zwischen zwei Zoomstufen hat sich die Lage jeder Beschriftung verschoben. Solange beide sichtbar
sind, sieht man beide Fassungen. Das ist keine Fehlfunktion, sondern die Eigenschaft des Mittels —
und der Grund, warum „erst ganz raus, dann rein" ruhiger aussieht als eine echte Überblendung.

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
- 🔴 **Und die dritte Zahlung (26.08., nachts): der Abbruch wirkt auch OHNE neuen Wert.** Eine
  laufende Transition, deren Eigenschaft aus der `transition`-Liste fällt, wird abgebrochen und
  springt auf ihren Endwert — auch wenn niemand die Eigenschaft selbst anfasst. Im Wegenamen-Overlay
  meldete das Vorabzeichnen (`zoomanim`, `?parallelfade=1`) über `zeichneJetzt()` die Doppel-rAF von
  `pfadLabelBlendeEin()` an; die feuerte ~2 Bilder später, setzte `transition = "opacity …"` und
  brach damit die Transform-Transition der Gegenrechnung ab — die neue Schrift klebte am Bildschirm,
  während die Karte weiterzoomte („straßen und flüsse sind wieder kaputt"). ⭐ **Eine geteilte
  Blendefunktion, die über rAF verzögert feuert, muss wissen, in welchem Kontext sie aufwacht** —
  seither läuft sie beim Vorabzeichnen nicht (`if (!fuerZiel)`), gewacht von
  `js/map-features/__tests__/wegenamen-parallelblende-ablauf.test.js` (ein Prüfstand, der die
  rAF-Warteschlange als Bilder abarbeitet — der Quelltext-Test daneben konnte das nie sehen).

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
| `?labelparallel=0` | Siedlungs-/Landschaftsnamen: zurück auf „erst zoomen, dann ausblenden" | Ausblenden ab t = 0 |
| `?markerscale=0` | Ortsmarker: Größen-Gegenrechnung während des Zooms aus | an |
| `?labelbedarf=1` | Regions-/Landschaftsnamen: rastern erst beim Sichtbarwerden | **aus** (Versuch) |

🔬 **`?labelbedarf=1` ist ein VERSUCH, Vorgabe AUS — über die Umstellung entscheidet der Owner.**
`prepareLabelData` rastert bei der Vorgabe jede Beschriftung sofort (eine Canvas plus ein synchrones
`toDataURL()`) und baut im Ansichtsmodus zusätzlich jedes Popup-Markup. Mit dem Schalter bekommt eine
Beschriftung erst einen leeren Platzhalter — dasselbe Muster, das die ~3000 Siedlungsnamen daneben
längst fahren (`createLocationNameLabelEntry`). **Live gemessen 27.08.2026** (avesmaps.de, Ausschnitt
1440×900, Startzoom 3):

| | Vorgabe | `?labelbedarf=1` |
|---|---|---|
| beim Start gerastert | **982** | **80** |
| Popups im Voraus gebaut | 982 | 0 |
| Einträge in `labelMarkers` | 982 | 982 |
| gezeichnete Beschriftungen | 80 | 80 — **zeichengleich**, Text/Bildmaße/Lage einzeln verglichen |

⭐ Die Bilanz dazu läuft in **beiden** Zuständen: `avesmapsLabelBilanz()` in der Konsole
(`js/map-features/label-bedarf.js`, Vorbild `avesmapsZeichenBilanz()`). Wer nur den neuen Zustand
misst, vergleicht zwei Messungen, die verschieden zustande kamen.
💣 **`labelMarkers` bleibt vollzählig und sofort** — `preparePathData` läuft direkt danach und baut
aus genau dieser Liste den Verlinkungs-Index seiner Weg-Popups (`map-features-path-item-links.js`).
Gespart wird das BILD und das POPUP-Markup, nie der Eintrag. Live gegengeprüft: die Index-Signatur
ist in beiden Zuständen `2889:4968:6034:982`, und „Trollzacken → Goldene Bucht“ bleibt verlinkt.
💣 **Gerastert wird VOR dem `addTo(map)`** — die Kollisionsauflösung misst Rechtecke, und ein
Platzhalter mit den Maßen 0 verschöbe die Ortsnamen um ihn herum ins Leere. Ein Marker auf der Karte
trägt ausnahmslos sein echtes Bild; der Test hält das im Karten-Doppel selbst fest.
⚠️ **Was die Messung NICHT beantwortet:** sie lief in einem Tab mit `visibilityState: "hidden"`. Die
absoluten Millisekunden (`prepareLabelData` 17.141 → 1.355 ms) sind dort um rund Faktor 10 gedrosselt
— belastbar ist das VERHÄLTNIS, nicht der Betrag. Zum Bild selbst sagt die Messung nichts: kein
Screenshot, keine fps, keine Zoomanimation (§2 und `[[bei-bewegung-zaehlt-nur-das-auge]]`).

🔴 **Die Dauer und die Kurve sind seit 26.08.2026 EINE Zahl für alles** —
`AVESMAPS_ZOOM_DAUER_MS` und `AVESMAPS_ZOOM_KURVE` (`cubic-bezier(0.42, 0, 0.58, 1)`, also
`ease-in-out`) in **`js/map-features/zoom-uebergang.js`**, als Token gespiegelt in
`css/features/zoom-uebergang.css`. Hier stand vorher, die 350 ms des DOM-Klons seien fest und ohne
Parameter; sie sind ersatzlos gefallen.
💣 **Die 250 sind nicht frei wählbar**: Leaflet zählt sie selbst
(`setTimeout(this._onZoomTransitionEnd, 250)` im minifizierten Fremdcode). Eine andere Dauer liefe
an Leaflets eigenem Ende vorbei.
🔴 **Seit 27.08.2026 sind es 500 ms, nicht mehr 250** (Owner, nachdem er die Zeitlupe zum Hinsehen
benutzt hatte: „Zoomlupe=2 ist etwas angenehmer — kann man das zum default machen?"). Damit gehen
die zwei Uhren auseinander, und **der Ausgleich dafür ist tragend**: `zoom-uebergang.js` schiebt
Leaflets Ende um die Differenz nach, sonst räumte Leaflet MITTEN in die laufende Bewegung.
Die Bedingung nennt die zwei Uhren (`AVESMAPS_ZOOM_DAUER_MS > AVESMAPS_LEAFLET_ZOOM_ENDE_MS`)
statt eines Parameters — so fällt sie von selbst weg, wenn jemand die Basis wieder auf Leaflets
Zahl stellt.
🔴 **Fremdcode wird dafür NICHT gepatcht** — eine Zahl in einer minifizierten Fremddatei wäre beim
nächsten Leaflet-Update lautlos wieder 250. `zoom-uebergang.test.js` hält
`AVESMAPS_LEAFLET_ZOOM_ENDE_MS` gegen die echte Zeichenfolge in `leaflet.js`; genau dort bräche
ein Update den Zoom sonst still.
⚠️ **Erwartete Nebenwirkung:** `_onZoomTransitionEnd` stößt BEIDES an — das Aufräumen UND das
Nachladen der Kacheln. Wer das eine schiebt, schiebt das andere mit: die Kacheln der neuen Stufe
kommen 250 ms später, solange steht am Rand ein grauer Saum. Bewusst nicht behoben, weil die
Trennung Leaflet-Interna nachbauen hieße. Fällt der Saum auf, ist das die Stelle.
⚠️ **`?zoomlupe=<faktor>` multipliziert die neue Basis** — `?zoomlupe=2` sind seither 1000 ms.

✅ **SECHZEHN VOLL-NEUZEICHNUNGEN JE ZOOMSCHRITT — seit 27.08.2026 vier.** Grenzen- und
Schraffur-Overlay hängen beide an `moveend zoomend viewreset resize`, und Leaflet feuert am
Zoomende **beide**: der Handler lief zweimal, zeichnete zweimal voll und meldete je drei blinde
Nachzieh-Timer an (120/350/800 ms). Macht 2 + 6 = 8 **je Overlay**, also sechzehn — die „acht" aus
dem Perf-Bericht war pro Fläche gezählt. Bei 52–99 ms je Zeichnung sind das rund **0,8 s** pro
Zoomschritt.
⭐ `js/map-features/zeichen-buendel.js` bündelt sie: der Doppelaufruf wird EINE Zeichnung im
nächsten Bild, und die drei Timer zeichnen nur noch bei neuem Datenstand. Gemessen (beide Male mit
demselben Zähler `avesmapsZeichenBilanz()`): **16 → 4**.
🔴 **Geprüft wird die IDENTITÄT von `regionData`, kein Inhaltsvergleich** — der Loader weist bei
jedem Laden ein frisches Array zu, die Referenz wechselt also genau dann, wenn neue Daten da sind;
ein Vergleich über ~1000 Flächen wäre teurer als das Zeichnen, das er spart. Wirft der Datenstand,
wird im Zweifel GEZEICHNET.
🔴 **Ohne `requestAnimationFrame` wird sofort gezeichnet** — keine stille Ausweiche, sondern eine
Fähigkeitsprüfung: ohne nächstes Bild gibt es nichts zu bündeln. Der Fall trifft Test-VMs, nie
einen Browser; ohne ihn wirft der Bündler dort.
⚠️ **`?zoombuendel=0` stellt den alten Zustand her und bleibt** — er ist die Vergleichsgrundlage
für jede spätere Messung an dieser Stelle.
⭐ Der Weg dorthin ist die Lehre: erst als Versuch hinter `?zoombuendel=1` live (Vorgabe AUS), dann
der Blick des Owners („das beste was ich bisher gesehen hab"), dann die Vorgabe. Warum das nötig
war, steht in der Falle darunter.

🪤 **EIN VERSUCH, DER MESSBAR BESSER WAR UND SICHTBAR SCHLECHTER — 27.08.2026.** Gemeldet war
„die straßen/flüsse ziehen manchmal kurz hinter", und die Messung dazu stimmt bis heute: das
Vorabzeichnen der Wegenamen blockiert die `zoomanim`-**Zustellung** 25–87 ms, und in derselben
Zustellung setzen **157 Zuhörer** ihre Transform — die Kacheln auf Platz 4, unsere Canvas-Flächen
auf 5–7, der SVG-Renderer mit **Straßen und Flüssen** auf 9–11. Eine CSS-Transition beginnt beim
nächsten Stilabgleich, ein `void offsetWidth` mittendrin startet also die Uhr für alle davor.
Das Verschieben in einen `queueMicrotask` drückte die Zustellung auf Median **12,8 ms** (Boden ohne
Vorabzeichnen: 13,9 ms) — und machte das Bild **schlechter**: „beim reinzoomen liegen die strassen
erst vor dann hinter ihrem untergrund pendant", also eine andere BewegungsFORM statt bloßem
Nachhinken. Zurückgenommen.
🔴 **Die Lehre ist nicht „geht nicht", sondern: hier zählt die Zahl nicht.** Wer es erneut versucht,
braucht zuerst einen Browser, in dem er die Bewegung WIRKLICH SIEHT. In einem Hintergrund-Tab läuft
kein Bild: Transitions stehen auf ihrem Startwert, `map.setZoom()` mit Animation kommt nicht an,
und jede Messung bestätigt nur die eigene Annahme.
⚠️ **Und der gemeldete Fehler sieht aus wie eine falsche KURVE, ist aber keiner** — die Kurven
wurden an allen Flächen ausgelesen und sind identisch. Unter ease-in-out ist ein Start-Versatz am
Anfang null, in der Mitte am größten und am Ende wieder null; mit `avesmapsZoomEasing` gerechnet
sind 25 ms Versatz **8,6 %** der Zoomstrecke, 87 ms **29,4 %** (linear wären es konstante 5 bzw.
17,4 %). „Erst vor, dann hinter" ist dagegen etwas anderes und noch ungeklärt.
✅ **Was aus dem Versuch BLEIBT:** die letzte abweichende Kurve des Zoomschritts ist weg — die
Grenzbeschriftungen blendeten ihre DECKKRAFT mit `ease-out` (`css/features/map-labels.css`); die
Transform-Hälfte war am 26.08. auf die Token gezogen worden, die andere nicht. Die DAUER bleibt
eigen (`--border-label-fade-out`, der Anteil des Ausblendens am Blendenbudget).
Gewacht von `js/map-features/__tests__/zoom-kurve-einheitlich.test.js`.
💣 **Die Kurve stand an ACHT Stellen**, nicht an den fünf, die der Entwurf zählte — Schraffur,
Fluss- und Tempopfeile fehlten in der Liste. Wer eine Zeichenfläche ergänzt, die beim Zoom
mitskaliert, trägt sie in `js/map-features/__tests__/zoom-uebergang.test.js` ein; sonst ist sie die
neunte mit einer eigenen Kurve.

## §7a Offener Entwurf: der Zoomschritt aus einem Guss

🔧 **`docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md`** — Owner-Ziel vom
26.08.2026: eine Kurve und eine Dauer für ALLE Animationen (ease-in-out; damals 250 ms, seit dem
27.08.2026 500), alles beginnt bei
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
ganze Animation läuft mit `map.getZoom()` = Zielstufe; nur das *Bild* interpoliert über die
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
