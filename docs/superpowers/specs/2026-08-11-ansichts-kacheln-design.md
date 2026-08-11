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

Neue Kachel `#map-layer-button` im Bund `#map-corner-actions` (`index.html`),
**über** dem Suchknopf: Ansichten oben, Suche darunter, dann die Reihe
„Neuigkeiten / Hinweise".

Die Reihenfolge ist eine Entscheidung, keine Laune (Owner 11.08.2026): so wächst
das Menü der Kachel ungestört nach oben, während das Suchfeld seinen Weg nach
links behält. Umgekehrt hätte sich beides in die Quere kommen können.

Farbe, Kontur, Radius und Schatten kommen aus der **bestehenden gemeinsamen
Regel** (`css/components/legal-dialog.css`, heute `#map-search-button,
#legal-button, #news-button`). Der Selektor wird **erweitert**, die Werte werden
**nicht abgeschrieben** — dazu steht die Begründung direkt über der Regel.

> 💣 **Es sind ZWEI Regeln, nicht eine.** Die Grundregel und die Hover-Regel zwei
> Absätze darunter. Am 11.08.2026 stand die Suchkachel in der ersten und fehlte
> in der zweiten: sie sah richtig aus und blieb unter dem Zeiger stumm. Wer einen
> Selektor ergänzt, ergänzt beide.

> 💣 **Der Bund wächst um eine Zeile, und der Zoom darüber muss das merken.** Wie
> hoch der Bund baut, sagt `--avesmaps-corner-stack`; `syncMapCornerStack`
> (`js/ui/ui-controls.js`) misst und schreibt sie. Genau diese Kopplung lag am
> 10.08.2026 um 8 px daneben, als die Knöpfe wuchsen. Die neue Zeile wird
> **gemessen**, nicht gerechnet — und die Abnahme sieht auf den Zoom, nicht nur
> auf die Kachel.

## 3 · Verhalten — die Kachel IST das Menü

**Zugeklappt** ist sie eine Kachel: das Bild der aktiven Ansicht, ihr Name
darunter (wie bei Google Maps). Sie ist damit zugleich die Statusanzeige.

**Aufgeklappt** entfaltet sie sich zu einem **2 × 3-Raster** nach oben und nach
links — weg vom Bildschirmrand. Dieselbe Form am Zeiger wie am Telefon; das
Raster baut 204 × 168 px und passt auch auf 375 px Breite.

> 💣 **Die eingestellte Ansicht bleibt beim Aufklappen auf ihrem Fleck** (Owner
> 11.08.2026: „die Position der Kachel darf sich nicht verändern"). Erreicht wird
> das **ohne eine einzige gerechnete Zahl**: die aktive Ansicht ist immer die
> **letzte Zelle** des Rasters, und das Raster hängt mit derselben Polsterung,
> demselben Rahmen und derselben Ecke wie die zugeklappte Kachel. Beide Kästen
> enden am selben Punkt, also *muss* die letzte Zelle auf der Kachel liegen.
> Ein Versatz wäre die Zahl, die beim nächsten Größenwechsel danebenliegt —
> dieselbe Falle wie `--avesmaps-corner-stack` am 10.08.2026. Die übrigen fünf
> füllen die Zellen davor in ihrer festen Reihenfolge.

Jede Zelle trägt Bild und Namen: „Politisch" und „Landschaften" sind aus einem
Daumennagel nicht erratbar. Die aktive Zelle ist golden gerahmt.

**Schließen** durch: Klick auf eine Ansicht, `Esc`, oder Klick irgendwo auf die
Karte.

**Tastatur:** die Zellen sind eine Einfachauswahl (`role="radiogroup"`, je Zelle
`role="radio"` mit `aria-checked`), Pfeiltasten wandern darin.

> 💣 **Keine eigene Tastenbelegung.** Die sechs Ansichten hängen schon an
> `O P K N L I`, und die Liste `SHORTCUTS` in `js/app/keyboard-shortcuts.js` ist
> laut AGENTS.md die **einzige** Quelle — sie ist zugleich die Belegung und der
> Bauplan der Tabelle unter „Hinweise → Bedienhilfen". Wer hier eine Taste
> verdrahtet, baut die Divergenz ein, die dort verhindert werden soll.

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

- **Wohin nach der Erprobung.** Fällt die Auswahlbox ganz weg oder bleibt sie
  für den Planer? Erst nach dem Blick des Owners auf den gebauten Zustand.
- **Die Kachelgröße im Menü** steht bei 60 px (Bild) plus Name; die zugeklappte
  Kachel trägt dasselbe Maß, weil beide dieselbe Zelle sind. Am gebauten Zustand
  zu prüfen, nicht am Mockup.

Entschieden und nicht mehr offen: die sechs Orte (Mockup v5, 11.08.2026), die
Form des Menüs (2 × 3, faltet sich aus der Kachel), die Lage (über der Suche).
Mockup: `docs/layer-kacheln-mockup.html`.
