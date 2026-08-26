# Der Zoomschritt soll aus einem Guss sein — Entwurf und Übergabe

> Stand 26.08.2026. Übergabe an eine **neue Sitzung**: die vorige hat gemessen, zweimal gebaut und
> einmal zurückgebaut. Alle Zahlen hier sind an den **ausgelieferten** Dateien gemessen, nicht aus
> dem Gedächtnis. Vorwissen: **`docs/kartenflaechen-und-zoomblenden.md`** — dort steht, welche Fläche
> auf welcher Technik liegt und was heute blendet.

## §0 Das Ziel (Owner, 26.08.2026, wörtlich)

> „das ziel ist: beim zoomen soll ein maximal konsistenter übergang herrschen zwischen allen
> elementen die zwischen zoomstufen bleiben, und elemente die ausblenden, z.b. ortslabels,
> regionenlabels, etc. sollen bei zoomanim t = 0 beginnen auszublenden und die anderen einzublenden.
> alle sollen diesselbe kubische bezier ease-in-ease out animation von 250 ms bekommen. eine zahl für
> alle animationen. und natürlich wärs perfekt, wenn du die prozentskalierungen der marker exakt
> aufeinander abstimmen könntest"

Daraus vier Forderungen:

1. **Eine Kurve, eine Dauer, für alles.** Cubic-Bezier ease-in-ease-out, 250 ms. Eine Zahl.
2. **Alles beginnt bei `zoomanim`, t = 0.** Ausblenden und Einblenden gleichzeitig, nicht nacheinander.
3. **Maximal konsistenter Übergang** für alles, was zwischen zwei Stufen bestehen bleibt.
4. **Die Marker-Skalierungen aufeinander abstimmen.**

🔴 Punkt 1 ändert die heutige Kurve: gebraucht wird `ease-in-out`, heute läuft die Skalierung auf
`cubic-bezier(0,0,0.25,1)` (Leaflets eigene, ein reines *ease-out*). Das ist eine bewusste Abkehr von
Leaflets Vorgabe und betrifft **auch die Kacheln** — sonst wäre der Guss wieder gebrochen.

## §1 Was heute in einem Zoomschritt passiert

| Zeitpunkt | Was | Dauer | Quelle |
|---|---|---|---|
| Mausrad | Leaflet entprellt | 40 ms | `wheelDebounceTime: 40` |
| | 60 px Rad = eine Stufe | — | `wheelPxPerZoomLevel: 60`, `zoomSnap`/`zoomDelta` = 1 |
| **t = 0** `zoomstart` → `zoomanim` | Klasse `leaflet-zoom-anim` aufs `_mapPane`; **Zielstufe steht fest** | — | `event.zoom`, `event.center` |
| 0 … 250 | Kacheln, SVG, alle Canvas-Overlays **skalieren** | 250 ms `cubic-bezier(0,0,0.25,1)` | `leaflet.css` + 4 eigene Stellen |
| 0 … 250 | Kacheln selbst: **kein** eigener Übergang | `transition: none` | `leaflet.css`, bewusst |
| 0 … 100 | Orts-, Landschafts-, Territoriumsnamen (DOM) blenden aus | 100 ms `ease-out` | `map-labels.css` |
| 0 … 120 | Grenz-/Wegenamen blenden aus — **nur bei `?crossfade=0`** | 120 ms `ease-out` | `…_FADE_OUT_MS` |
| **t = 250** `zoomend` | Klasse fällt, alles wird neu gezeichnet | **215 / 692 / 836 ms Blockade** | gemessen: Standard / Landschaften / Politisch |
| danach + 2 Bilder | Grenznamen überblenden | 350 ms `ease` | `?labelfade` |
| danach + 2 Bilder | Wege-/Flussnamen überblenden | 350 ms `ease` | `?wegefade` |
| danach + 2 Bilder | Orts-/Landschaftsnamen überblenden (Pane-Klon) | 350 ms `ease`, fest | `bootstrap.js` |
| Notnagel | Klon verschwindet spätestens | 2000 ms | Sicherheitsnetz |
| beim Nachladen | neue Kacheln blenden ein | 200 ms **linear** (JS) | Leaflet, `(now − loaded) / 200` |

**Summe in der politischen Ansicht: rund 1,4 s vom Radschubs bis zur Ruhe** — davon ist die mittlere
Portion keine Animation, sondern Stillstand.

## §2 Die Easing-Kurven heute

**Die Skalierung ist bereits einheitlich.** Fünf Stellen setzen sie, alle identisch:

| Wo | Wert |
|---|---|
| `leaflet.css` — `.leaflet-zoom-anim .leaflet-zoom-animated` | `transform 0.25s cubic-bezier(0,0,0.25,1)` |
| `map-features-boundary-canvas-overlay.js` — `TERRITORY_ZOOM_TRANSFORM` | `transform 250ms cubic-bezier(0,0,0.25,1)` |
| `map-features-path-label-canvas-overlay.js` — `PATH_LABEL_ZOOM_TRANSFORM` | dito |
| `map-features-location-canvas-layer.js` — `_onZoomAnim` | dito |
| `css/features/map-labels.css` — `.leaflet-zoom-anim .avesmaps-border-label-canvas` | dito |

**Die Blenden sind es nicht.** Fünf verschiedene Kurven, gewachsen statt entschieden:

| Was | Dauer | Kurve |
|---|---|---|
| Grenz-, Wege-, Orts-/Landschaftsnamen (Überblendung) | 350 ms | `ease` |
| Label-Panes, altes Ausblenden | 100 ms | `ease-out` |
| Label-Panes, altes Einblenden | 200 ms | `ease-in` |
| `?crossfade=0`-Pfad | 120 ms | `ease-out` |
| Kachel-Einblendung | 200 ms | **`linear`** (JS, kein CSS) |
| Popups | 200 ms | `linear` |

⚠️ Die Kachel-Einblendung ist **kein CSS** — sie läuft als rAF-Schleife in Leaflet
(`Math.min(1, (now − tile.loaded) / 200)`). Sie auf eine gemeinsame Kurve zu bringen heißt, in
Leaflet einzugreifen oder sie in Kauf zu nehmen.

## §3 💣 DER KERN: die Amplituden laufen auseinander, nicht die Kurven

Während der 250 ms skaliert **alles um denselben Faktor 2** (eine Zoomstufe). Aber **nichts außer den
Kacheln wächst zwischen zwei Stufen wirklich um 2.** Am `zoomend` schnappt jedes Element auf seinen
echten Wert — jedes um einen anderen Betrag. Schritt **z4 → z5**:

| Element | z4 | z5 | echter Faktor | Sprung beim Landen |
|---|---|---|---|---|
| Kacheln | — | — | **2,000** | **keiner** |
| Marker Gebäude | 2,80 | 5,90 | 2,107 | **+5 %** |
| Marker Dorf | 4,86 | 9,28 | 1,909 | −5 % |
| Marker Kleinstadt | 7,70 | 13,82 | 1,795 | −11 % |
| Marker Stadt | 11,07 | 18,79 | 1,697 | −18 % |
| Straße · Weg · Pfad · Pass · Wüstenpfad (Breite) | 0,6 | 1,0 | 1,667 | −20 % |
| Reichsstraße (Breite) | 1,2 | 1,8 | 1,500 | −33 % |
| Marker Großstadt | 18,52 | 27,18 | 1,468 | −36 % |
| Marker Metropole | 26,60 | 37,62 | 1,414 | −41 % |
| Grenzlinie außen | 3 px | 4 px | 1,333 | **−50 %** |
| Grenzname Schrift | 9 px | 11 px | 1,222 | **−64 %** |
| Grenzname Versatz | 10 px | 12 px | 1,200 | **−67 %** |
| Wegename Schrift | 10 | 11 | 1,100 | **−82 %** |

**Von +5 % bis −82 %, alles im selben Augenblick.** Das ist der Grund, warum der Übergang „nicht
synchron" aussieht — die Kurve ist überall dieselbe, aber die Karte überzeichnet 250 ms lang jedes
Element unterschiedlich stark und korrigiert das schlagartig am Ende.

🪤 **Der schlimmste Schritt ist z6 → z7.** Alle Zoombänder wiederholen dort ihren z6-Wert (z. B.
Metropole `… 53.2 53.2`), der echte Faktor ist also **1,0** — das Bild skaliert ×2 und schnappt um
**−100 %** zurück. Grund: `maxZoom: 7`, aber die Tafeln sind für z0–z6 gepflegt und z7 erbt z6.

### §3.1 Die Marker: sechs Klassen, sechs konstante Wachstumsfaktoren

Jede Klasse wächst **geometrisch mit ihrem eigenen Faktor** — das ist kein Zufall, sondern die Form
der Tafel:

| Klasse | Faktor je Zoomstufe | z0 … z6 (live gemessen, px) |
|---|---|---|
| Metropole | **1,414** (= √2) | 6,65 · 9,4 · 13,3 · 18,81 · 26,6 · 37,62 · 53,2 |
| Großstadt | 1,468 | 3,99 · 5,86 · 8,6 · 12,62 · 18,52 · 27,18 · 39,9 |
| Stadt | 1,697 | 1,33 · 2,26 · 3,84 · 6,52 · 11,07 · 18,79 · 31,92 |
| Kleinstadt | 1,795 | — · 1,33 · 2,39 · 4,29 · 7,7 · 13,82 · 24,82 |
| Dorf | 1,909 | — · — · 1,33 · 2,54 · 4,86 · 9,28 · 17,74 |
| Gebäude | 2,106 | — · — · — · 1,33 · 2,8 · 5,9 · 12,42 |

Kleine Klassen wachsen schneller (sie starten alle bei 1,33 px und müssen aufholen), große langsamer.

🔴 **„Exakt aufeinander abstimmen" heißt: ein gemeinsamer Faktor — und der müsste 2,0 sein**, denn
nur dann fällt der Sprung beim Landen komplett weg. ⚠️ **Das ist eine Bildentscheidung, keine
Aufräumarbeit:** bei Faktor 2 bleibt das Größenverhältnis der Klassen über alle Stufen konstant, und
eine Referenzstufe legt alles andere fest. Wählt man z5 als Referenz, wird die Metropole bei z0
0,29 px statt 6,65 px — sie verschwindet. Wählt man z0, wird sie bei z6 425 px. **Ein einziger
Faktor über neun Stufen ist mit dem heutigen Bild nicht vereinbar**; realistisch ist ein Kompromiss
(z. B. Faktor 2 nur über die Stufen, auf denen alle Klassen sichtbar sind, plus ein gestauchter
Anlauf). Das gehört vor den Bau entschieden, nicht in ihn hinein.

⚠️ Die Zoombänder sind **Daten, keine Konstanten** — `app_setting` `location_zoom_bands`, ein Admin
stellt sie im Ortseditor. Die Zahlen oben sind der Livestand vom 24.08.2026. Wer sie ändert, ändert
sie **dort**, nicht im Code; die Vorgabe steht in `js/map-features/location-zoom-bands.js`.

## §4 Die Compositor-Frage — gemessen und ENTKRÄFTET

Vermutung war: `leaflet.css` setzt `svg.leaflet-zoom-animated { will-change: transform }`, unsere
Canvas-Overlays haben das nicht — also skaliert SVG glatt und Canvas ruckelt.

**Gemessen 26.08.2026 an der Live-Seite: die Vermutung trägt nicht.**

| | `will-change` | Transform |
|---|---|---|
| SVG (Wege, Flächen) | `transform` | `translate3d(…) scale(…)` |
| alle 8 Canvas-Flächen | `auto` | `translate3d(…)` |

`translate3d` befördert in Chrome ohnehin auf eine eigene Compositor-Ebene. Der fehlende
`will-change`-Hinweis ist damit weitgehend gegenstandslos. **Kein Handlungsbedarf** — und ein Beleg
dafür, dass die Ursache in §3 liegt, nicht hier.

🪤 **Nebenbefund, der bei einer `zoomanim`-Blende zur Falle wird:** zwei der acht Canvasse tragen
**gar keine** Transform — jeweils die *hintere* der beiden Überblendungsflächen (Grenznamen,
Wegenamen). Sie sind unsichtbar, werden aber beim nächsten Rollentausch zur vorderen. Wer im
`zoomanim` beide Flächen transformiert, muss die hintere vorher ausrichten.

## §5 Was schon bezahlt ist — Fallen, die nicht zweimal kosten dürfen

💣 **`transition` ist EINE Eigenschaft.** Wer sie setzt, setzt sie ganz.
- Eine im Einblenden gesetzte **Transform**-Transition überlebt den Zoom, und weil
  `L.DomUtil.setPosition` per `transform` verschiebt, **animiert danach jeder PAN die Position nach**.
  Owner: „wenn ich mit der maus panne, ziehen die 2x nach". Zweimal passiert (`e85b31d1`, dann noch
  einmal im Parallel-Versuch). **Die Transform-Transition gehört ausschließlich in den
  `zoomanim`-Handler**, und die `moveend`-Handler löschen sie — auf **allen** Flächen, auch der
  gerade unsichtbaren.
- Bei den Grenznamen steht die Blende in **CSS**, bei den Wegenamen **inline** — erzwungen, weil
  deren `zoomanim`-Handler `style.transition` seit jeher selbst setzt und inline gegen CSS gewinnt.

💣 **Am `zoomend` blockiert der Hauptthread 215–836 ms.** Ein dort gestarteter Übergang verstreicht
vollständig, **ohne dass ein Bild davon gezeichnet wird**, und ist fertig, sobald wieder gezeichnet
werden kann — er sieht aus wie ein Sprung („blippt und ist dann woanders"). Deshalb startet heute
jede Blende **zwei `requestAnimationFrame` nach** dem Redraw. ⚠️ Wenn nach §0 alles bei `zoomanim`
startet, entfällt dieses Problem — dann läuft nichts mehr durch die Blockade.

💣 **Eine Canvas hat nur EINE Deckkraft.** Grenzlinien und Grenznamen mussten dafür auf zwei Flächen
getrennt werden. Und **überblenden geht nur mit zwei Flächen je Ebene**, weil eine ihr altes Bild
verliert, sobald sie das neue zeichnet.

💣 **Neu zeichnen statt blenden geht nicht:** ein `redraw()` kostet gemessen **52–99 ms**.

⭐ **Aber der Zoom überlebt das Rechnen.** Er ist eine CSS-Transform-Transition und läuft auf dem
Compositor — ein `zoomanim`-Handler darf zeichnen, ohne die Bewegung anzuhalten. **Das ist die
Grundlage für §0 Punkt 2.**

🪤 **Der Parallel-Versuch vom 26.08. (`ed1e2e93`) ist zurückgenommen (`3a08450a`).** Er zeichnete das
neue Bild schon im `zoomanim` für die Zielstufe — der Ansatz war richtig und ist der Weg zu §0. Er
scheiterte an zwei Dingen: der Transform-Transition inline (siehe oben, Pan zog nach) und daran, dass
die **Gegenrechnung** ungeprüft blieb. Der Code steht im Commit und ist als Vorlage brauchbar; die
drei Wachen darin (`labelsVorabGezeichnet`, die Flaggen-Weiche, die Restzeit-Rechnung) waren
notwendig und sind es weiterhin.

💣 **Die Gegenrechnung ist die riskanteste Stelle des ganzen Vorhabens.** Ein Bild, das für die
Zielstufe gezeichnet wurde, liegt in Ziel-Koordinaten, während die Karte noch auf der alten Stufe
steht. Die Fläche muss dort **starten**, wo die künftige linke obere Ecke jetzt liegt, auf `1/scale`
geschrumpft, und auf ihren Platz nach dem Zoom animieren:
`start = map.latLngToLayerPoint(zielEcke)`, Maßstab `1/scale` · `ende =
map._latLngToNewLayerPoint(zielEcke, zielZoom, zielCenter)`, Maßstab `1`.
⚠️ Ungeprüft. Sitzt sie falsch, gleiten die Namen aus der falschen Richtung oder in falscher Größe
herein — und **das sieht nur ein Auge**, kein Test.

## §6 Was zu tun ist

1. **Eine Kurve, eine Zahl.** Ein Token oder eine Konstante, gelesen von allen sieben Stellen aus §2.
   🔴 `ease-in-out` statt Leaflets `cubic-bezier(0,0,0.25,1)` — und **auch für die Kacheln**, sonst
   ist der Guss an der auffälligsten Fläche gebrochen. ⚠️ Das heißt, Leaflets eigene Regel zu
   überschreiben; sie steht in `css/third-party/leaflet.css` und ist Fremdcode — überschreiben, nicht
   editieren.
2. **Alles startet bei `zoomanim`.** Ausblendende Ebenen (Orts-, Regionen-, Territoriumsnamen) dort
   auf 0; bleibende Ebenen dort auf ihren Zielwert. Das neue Bild muss dafür im `zoomanim` gezeichnet
   werden (§5, Vorlage `ed1e2e93`).
   ⚠️ **Die DOM-Label-Panes können nicht mitskalieren** — sie tragen weder eigene Transform noch
   `leaflet-zoom-animated` (gemessen). Für sie heißt „bei t=0 ausblenden" genau das, was heute schon
   passiert; sie können nur *verschwinden*, nicht *mitgehen*.
3. **Die Amplituden angleichen** (§3). Der größte Hub im Bild, und die einzige Änderung, die den
   Sprung wirklich beseitigt statt ihn zu verstecken. Reihenfolge nach Ausreißer: Wegename (−82 %),
   Grenzname-Versatz (−67 %), Grenzname-Schrift (−64 %), Grenzlinie (−50 %), Marker-Spreizung.
4. **z6 → z7 entscheiden** (§3, 🪤). Heute schnappt dort alles um −100 % zurück.

## §7 Messfallen — für den, der das prüft

🪤 Vier Fehlmessungen in der Vorsitzung, alle beim Prüfenden:

- **`getComputedStyle` liefert veraltete Werte, wenn die Seite keine Bilder erzeugt.** In einer nicht
  eingeblendeten Browser-Ansicht laufen CSS-Übergänge gar nicht los. ⭐ Verlässlich sind
  **Inline-Werte**, **Transition-Ereignisse** (`transitionrun`/`transitionend`) und
  **`MutationObserver`** — die hängen nicht am Rendering.
- **Ohne Frames startet Leaflet die Zoom-Animation gar nicht** — `zoomanim` feuert dann nie, und der
  ganze Pfad ist unprüfbar. Wer messen will, braucht eine **sichtbare** Browser-Ansicht.
- **Ein CSSOM-Lauf muss `@import`-Blätter betreten** (`rule.styleSheet`, nicht `rule.cssRules`), und
  **in Chrome hat jede `CSSStyleRule` ein leeres `cssRules`** (CSS-Nesting) — ein `if (r.cssRules)`
  überspringt damit sämtliche Regeln. Erst den Selektor prüfen.
- **Ein Canvas ist EIN DOM-Knoten, egal ob es nichts oder vierzig Namen zeichnet.** Wer
  Zeichenflächen per DOM-Zählung inventarisiert, rechnet alles Canvas systematisch klein. ⭐ Pixel
  zählen (`getImageData`), nicht Knoten.
- 💣 **Der Arbeitsbaum kann WEIT hinter `origin/master` liegen** — mehrere Sitzungen teilen
  diesen einen Checkout, und am 26.08.2026 stand er 97 Commits davor und 421 dahinter. Wer Dateien
  daraus liest, liest dann alten Code, ohne dass irgendetwas danach aussieht; ein Verweis auf eine
  frisch angelegte Datei läuft ins Leere. ⭐ Vor dem ersten Lesen einmal
  `git fetch && git rev-list --left-right --count HEAD...origin/master` — steht dort nicht `0 0`,
  dann über einen Worktree von `origin/master` arbeiten oder mit `git show origin/master:<pfad>`
  lesen.
- ⚠️ **Und beim Deploy: `gh run list --limit 1` trifft nicht zwingend den eigenen Lauf.** Nach SHA
  filtern; sonst belegt ein fremder grüner Lauf die eigene, noch gar nicht hochgeladene Datei.

## §8 Offene Fragen

- 🔧 **Die 836 ms Blockade in der politischen Ansicht** sind der größte Einzelposten im Zoomschritt
  und noch unerklärt: dort liegt **kein Weg und keine Landschaftsfläche** im DOM. Verdacht:
  Grenzen-Canvas plus `schedulePoliticalTerritoryLayerReload`. Ungemessen.
- 🔧 **Vier Canvas-Ebenen ohne Blende** (Schraffur, Höhenmodell, Fluss- und Tempo-Pfeile) — sie
  zeichneten in den geprüften Ansichten 0 Pixel und blieben deshalb unangetastet.
- 🔧 **Kein hartes Netz bei den Canvas-Überblendungen.** Der DOM-Klon hat eins (2 s).
- 🔧 **Die Kachel-Einblendung (200 ms linear)** lässt sich ohne Eingriff in Leaflet nicht auf die
  gemeinsame Kurve bringen.

## §9 Die Stellschrauben, die es schon gibt

| Parameter | wirkt auf | Vorgabe |
|---|---|---|
| `?labelfade` / `?labelfadeout` | Grenzbeschriftungen | 350 / 120 ms |
| `?wegefade` / `?wegefadeout` | Wege- und Flussnamen | 350 / 120 ms |
| `?crossfade=0` | alle drei Schrift-Ebenen zurück auf „erst aus, dann ein" | Überblendung an |
| `?canvasdpr=<zahl>` | alle Canvasse, schlägt jede Vorgabe | — |
| `?phonedpr=voll` / `<zahl>` | Telefon-Deckel | 2 |
| `?borderlabels=0` | Gebietsnamen aus | an |
| `?labeltune=1` | Panel: Offset, Schriftgröße, Dichte je Zoom | — |

⚠️ Die DOM-Pane-Überblendung (350 ms) steht **fest** in `js/app/bootstrap.js` und hat keinen
Parameter.
