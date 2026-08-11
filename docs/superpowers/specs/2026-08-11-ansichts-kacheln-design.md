# Ansichts-Kacheln statt Auswahlbox (`?layerPanelActive=1`)

**Stand:** 11.08.2026 · **Zustand:** Entwurf, Erprobung hinter einem Prüf-Schalter

Die sechs Ansichten der Karte („Derographie") stecken heute in einer Auswahlbox
in der Seitenleiste des Routenplaners. Wer die Karte ansieht, ohne den Planer
aufzuklappen, findet sie nicht. Dieser Entwurf stellt sie als Kacheln in die
Ecke der Karte — dieselbe Bewegung, die Google Maps für seine Ebenen benutzt.

Erprobt wird hinter `?layerPanelActive=1`. Ohne den Schalter bleibt alles, wie
es ist.

---

## 1 · Was es ersetzt

| | heute | mit Kacheln |
|---|---|---|
| Ort | Seitenleiste `#search`, Zeile „Derographie" | Ecke unten rechts, über der Suchkachel |
| Form | Auswahlbox mit Symbol + Namen | Kachel, die sich zu einem 2 × 3-Raster auffaltet |
| Sichtbar ohne Planer | nein | ja |
| Bild je Ansicht | gezeichnetes Symbol (`icons/*Karte.webp`) | Kartenausschnitt in dieser Ansicht (`icons/layer-tiles/`) |

Die sechs Ansichten selbst ändern sich **nicht**: `none` (Nur Karte),
`original`, `political`, `deregraphic` (Standard), `powerlines`, `ecosystem`.

## 2 · Wo es sitzt

Kachel `#map-layer-button` im Bund `#map-corner-actions` (`index.html`), **unter**
dem Suchknopf: Suche oben, Ansichten darunter, dann die Reihe „Neuigkeiten /
Hinweise".

Farbe, Kontur, Radius und Schatten kommen aus der **bestehenden gemeinsamen
Regel** (`css/components/legal-dialog.css`). Der Selektor wird **erweitert**, die
Werte werden **nicht abgeschrieben**.

> 💣 **Es sind ZWEI Regeln, nicht eine.** Die Grundregel und die Hover-Regel zwei
> Absätze darunter. Am 11.08.2026 stand die Suchkachel in der ersten und fehlte
> in der zweiten: sie sah richtig aus und blieb unter dem Zeiger stumm.
> `touch-scale.test.js` prüft seither **beide** Listen für **jeden** Eckknopf.

## 3 · Verhalten — die Kachel IST das Menü

**Zugeklappt** ist sie eine Kachel: das Bild der aktiven Ansicht, ihr Name
darunter. Sie ist damit zugleich die Statusanzeige.

**Aufgeklappt** faltet sie sich auf: am Zeiger eine **Reihe zu sechst** (402 px),
am Telefon **2 × 3** (204 × 168 px). Eine Form, zwei Aufteilungen — der Umbruch
ist eine einzige Media-Query auf `grid-template-columns`.

> 💣 **Die eingestellte Ansicht bleibt beim Aufklappen auf ihrem Fleck** (Owner
> 11.08.2026). Erreicht **ohne eine gerechnete Zahl**: die aktive Ansicht ist
> immer die **letzte Zelle**, und Kachel wie Raster tragen dieselbe Polsterung,
> denselben Rahmen und dieselbe Unterkante. Beide Kästen enden am selben Punkt,
> also *muss* die letzte Zelle auf der Kachel liegen. Gemessen: `[1140, 899,
> 60, 63]` vor wie nach dem Klick. Ein Versatz wäre die Zahl, die beim nächsten
> Größenwechsel danebenliegt — dieselbe Falle wie `--avesmaps-corner-stack`.

> 💣 **Das Raster steht IM FLUSS, es schwebt nicht.** Der erste Bau ließ es über
> der Ecke schweben — und es legte sich beim Aufklappen über die Zoom-Knöpfe, die
> dahinter schlicht verschwanden (vom Owner gesehen, nicht vom Test). Im Fluss
> wächst stattdessen der Bund, und der Zoom liest dessen **gemessene** Höhe.
> Gemessen: Stack = Bundhöhe + 6 in allen drei Zuständen (zu 166/172, auf
> 235/241, wieder zu 165/171).
> ⚠️ Es gibt dafür einen `ResizeObserver` — der wird aber erst zum nächsten Bild
> zugestellt, und die Höhe ändert sich **jetzt**. Deshalb misst der Picker beim
> Auf- und Zuklappen zusätzlich von Hand nach.

**Am Telefon** schiebt das hohe Raster den Suchknopf nach oben (gemessen 635 →
567) und lässt ihn beim Zuklappen zurückfallen — ebenfalls ohne eine Zahl, das
tut der Fluss von allein.

**Blende:** 120 ms Ein-/Ausblenden mit 4 px Versatz. ⚠️ `display` lässt sich nicht
überblenden — das Raster wird erst sichtbar geschaltet und im **nächsten Bild**
angeblendet. Und die Kachel kommt erst **nach** der Ausblende zurück: wären beide
gleichzeitig im Fluss, wäre der Bund kurz doppelt hoch und der Suchknopf ruckte.
`prefers-reduced-motion` schaltet die Blende ab.

**Schließen** durch: Klick auf eine Ansicht, `Esc`, oder Klick auf die Karte.

**Tastatur:** Einfachauswahl (`role="radiogroup"`, je Zelle `role="radio"` mit
`aria-checked`), Pfeiltasten wandern darin.

> 💣 **Keine eigene Tastenbelegung.** Die sechs Ansichten hängen an `O P K N L I`,
> und `SHORTCUTS` in `js/app/keyboard-shortcuts.js` ist die **einzige** Quelle.

⚠️ Eine gesperrte Ansicht bleibt gesperrt: fehlt der Politik-Endpunkt, ist das
`<option>` `disabled` — und die Zelle ist es genauso, wie der Knopf der
Auswahlbox. Die Wahrheit steht im `<option>`, die Zelle ist nur seine Darstellung.

## 4 · Der Zustand — es gibt keinen zweiten

Die Kacheln rufen `setSelectedMapLayerMode(modus)`
(`js/map-features/map-features-display-mode.js`) — dieselbe Funktion, die die
Auswahlbox ruft. Rückwärts hört die Kachel auf denselben Wechsel und zieht ihr
Bild und die goldene Markierung nach.

> 💣 **Die Zeile verschwindet, das `<select>` bleibt.** `#mapLayerModeSelect`
> *ist* der Zustand: `getSelectedMapLayerMode()` liest es, `setSelected…`
> schreibt es, und der geteilte Link (`?mapLayerMode=…`) läuft über
> `restorePlannerState` genau dort hinein. Ausgeblendet wird die **Zeile**
> (`.display-options__select-row`), nie das Element.

Der Prüf-Schalter selbst wird **nicht** in die Adresszeile zurückgeschrieben
(`syncPlannerStateToUrl` fasst ihn nicht an). Er ist eine Erprobung, kein
teilbarer Zustand. Gelesen wird er tolerant (`1`, `true`, leer = an).

## 5 · Die Icons

Sechs Bilder, 128 px, WebP, unter `icons/layer-tiles/`. Statisch — wie bei Google Maps, deren
Ebenen-Kacheln ebenfalls fertige Bilder sind und keine lebenden Karten.

**Vier davon sind Aufnahmen der laufenden Karte**, je Ansicht an einem eigenen Ort (Owner
11.08.2026). **Zwei sind vom Owner gestaltet**: „Politisch" (Grenzen mit einem
Avesmaps-Wappen statt eines echten — nennt kein Reich und ist trotzdem etwas fürs Auge) und
„Landschaften" (Waldinseln, Fluss, Steppe und Meer in einem Bild). Werkzeug, Orte und
Wiederholanleitung: **`tools/layer-tiles/`**.

| Ansicht | Bild | Herkunft |
|---|---|---|
| Nur Karte | `none.webp` | Aufnahme, Gebirge 628/628 Zoom 5 — bewusst menschenleer |
| Original | `original.webp` | Aufnahme, alte Karte 660/476 Zoom 5 |
| Politisch | `political.webp` | Owner |
| Standard | `deregraphic.webp` | Aufnahme, Straßen + Orte 534/555 Zoom 5 |
| Kraftlinien | `powerlines.webp` | Aufnahme, Linie + Nodix 534/555 Zoom 5 |
| Landschaften | `ecosystem.webp` | Owner |

**Anonym ist eine Frage der EBENEN, nicht des Ortes.** Aufgenommen wird eine Allowlist von Leaflet-
Panes; die Namens-Panes (`regionLabels`, `labels`, `pathLabelCanvas`, `mapDecorations`) stehen nicht
darin. Was nicht in der Liste steht, kann keinen Namen ins Bild tragen — das ist die ganze Regel,
und sie hält, ohne dass jemand den Ausschnitt prüfen muss.

> 💣 **Die Gebietsnamen SIND Bilder.** In der `regionLabels`-Pane liegen die Namen als `data:`-PNG
> (gerasterter Text, 429 von 508 Bildern), die Wappen dagegen als Datei unter `/uploads/wappen/`.
> Ein „alle Bilder dieser Pane zeichnen" — die naheliegende Art, Wappen ohne Namen zu bekommen —
> holt jeden Namen zurück. Gefiltert wird nach der **Bildquelle**.

> 💣 **Jede Datenebene baut sich stufenweise auf, die politische Außengrenze zuletzt** (AGENTS.md
> §10). Eine Aufnahme nach fester Wartezeit mischt neue Farben mit alten Grenzen: die weißen
> Konturen laufen quer durch die Flächen. Genau daran scheiterten die ersten Aufnahmen, gesehen vom
> Owner („die politischen Grenzen sind nicht in den Farbregionen"), nicht vom Werkzeug. Gewartet
> wird jetzt, **bis sich die Ebene nicht mehr ändert**, und die Konsole warnt, wenn es nicht ruhig
> wurde.

> 💣 **Statische Bilder veralten stumm.** Ändert sich der Kartenstil, zeigen die Icons weiter die
> alte Karte, und niemandem fällt es auf — ein Icon sieht immer *irgendwie* plausibel aus. Deshalb
> liegt das Aufnahme-Werkzeug samt Anlässen im Repo (`tools/layer-tiles/README.md`) und nicht in
> einer Sitzung.

⚠️ Für „Original" gilt zusätzlich die Ortswahl: der alte Kachelsatz ist ein Scan mit **eingebrannter**
Schrift, über Land dicht. Dort hilft keine Ebenen-Liste, nur ein schriftfreier Ausschnitt.

⚠️ Die `?v=`-Stempel der Bilder setzt der Deploy von allein (alles, was von `index.html` aus
erreichbar ist). **Niemals von Hand schreiben** (AGENTS.md §7).

## 6 · Was nicht gebaut wird

- **Keine sechs Mini-Leaflets.** Eine lebende Karte je Kachel wäre das
  ehrlichste Bild und sechs Karteninstanzen teuer. Die Perf-Geschichte dieses
  Projekts ist voll davon.
- **Kein Overlay-Fenster.** Die Kacheln stehen in der Ecke, nicht in einem
  Dialog — damit entfällt auch die Pflicht, `#…-overlay` in die drei
  Selektorlisten in `dialog-overlays.css` einzutragen.
- **Keine neue Ansicht.** Es sind dieselben sechs.
- **Kein zweiter Zustand, keine zweite Tastenbelegung.**

## 7 · Abnahme

Nicht gemessen, sondern **ausgeführt** — mit dem Zeiger und am schmalen Schirm,
in **hell und dunkel**:

1. Kachel anklicken → die Reihe fährt aus, die aktive Ansicht ist markiert.
2. Jede der sechs anklicken → die Karte wechselt sichtbar, die zugeklappte
   Kachel zeigt danach das neue Bild.
3. Seite neu laden mit `?mapLayerMode=powerlines&layerPanelActive=1` → die
   Kachel steht auf Kraftlinien (der geteilte Link geht durch das `<select>`).
4. Ohne `?layerPanelActive=1` → Auswahlbox wie bisher, keine Kachel.
5. Zoom-Control über dem Bund: sitzt bündig, springt beim Auf- und Zuklappen
   nicht (die 8-px-Falle).
6. Suche und die beiden Verweisknöpfe daneben unverändert erreichbar.
7. Tastatur: `O P K N L I` schalten weiter, die Reihe lässt sich mit den
   Pfeiltasten durchwandern, `Esc` schließt.

⚠️ Was ein Emulator nicht beantwortet — echtes Touch-Verhalten, Daumenweite —
wird als offene Frage gemeldet, nicht als bestanden.

## 8 · Offene Punkte

🔧 **Nur noch einer: der Prüf-Schalter.** Fällt `?layerPanelActive=1` weg — und
mit ihm die Auswahlbox im Planer — oder bleiben beide? Das ist eine
Owner-Entscheidung: ohne Schalter sehen ALLE Besucher die Kachel und finden die
Zeile „Derographie" nicht mehr an ihrem Platz.

Erledigt und nicht mehr offen:

- die sechs Orte und Bilder (`icons/layer-tiles/`, Werkzeug in `tools/layer-tiles/`);
- die Form: Reihe zu sechst am Zeiger, 2 × 3 am Telefon, Kachel unter der Suche;
- die Zellenbreite: **66 px**, gebunden an das längste Wort („Landschaften"), nicht
  an das Bild — bei 60 stand überall „Landschaft…";
- die Blende: Hülle blendet, Zellen bewegen sich, die aktive nie;
- Englisch: die Namen kommen aus den `<option>` und werden mit ihnen übersetzt,
  Tooltip und Vorlese-Text stehen als `view.tile.*` in der Tabelle;
- die vier Kopplungen hängen an einem Test (`js/ui/__tests__/map-layer-picker.test.js`),
  fünf Mutationen gegengeprüft.

Mockup: `docs/layer-kacheln-mockup.html` — es liest die echten Stilregeln ein und
kann deshalb nicht vom gebauten Zustand abweichen.
