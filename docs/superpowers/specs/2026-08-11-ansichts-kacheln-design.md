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
| Ort | Seitenleiste `#search`, Zeile „Derographie" | Ecke unten rechts, unter der Suchkachel |
| Form | Auswahlbox mit Symbol + Namen | Kachel, die eine Reihe von sechs Kacheln aufklappt |
| Sichtbar ohne Planer | nein | ja |
| Bild je Ansicht | gezeichnetes Symbol (`icons/*Karte.webp`) | Ausschnitt der echten Karte in dieser Ansicht |

Die sechs Ansichten selbst ändern sich **nicht**: `none` (Nur Karte),
`original`, `political`, `deregraphic` (Standard), `powerlines`, `ecosystem`.

## 2 · Wo es sitzt

Neue Kachel `#map-layer-button` als **zweite Zeile** des Bundes
`#map-corner-actions` (`index.html`): Suche oben, Ansichten darunter, dann die
Reihe „Neuigkeiten / Hinweise".

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

## 3 · Verhalten

**Zugeklappt** zeigt die Kachel das Bild der **aktiven** Ansicht. Sie ist damit
zugleich die Statusanzeige — man sieht, worin man steckt, ohne zu klicken.

**Klick** fährt sechs Kacheln nach links aus. Jede trägt ihr Bild und ihren
Namen darunter: „Politisch" und „Landschaften" sind aus einem Daumennagel nicht
erratbar, die Namen bleiben stehen. Die aktive Kachel ist golden gerahmt.

**Schließen** durch: erneuter Klick auf die Kachel, Klick auf eine Ansicht,
`Esc`, oder Klick irgendwo auf die Karte.

**Schmale Schirme:** die Reihe bricht auf 2×3 um. Sechs Kacheln mit Namen sind
breiter als ein Telefon.

**Tastatur:** die Kacheln sind eine Einfachauswahl (`role="radiogroup"`, je
Kachel `role="radio"` mit `aria-checked`), Pfeiltasten wandern darin.

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

Sechs Bilder, 128 px (für 64 px Anzeige), als WebP unter `icons/layer-tiles/`.
Statisch — wie bei Google Maps, deren Ebenen-Kacheln ebenfalls fertige Bilder
sind und keine lebenden Karten.

**Hergestellt aus der echten Karte.** Die Kachelpyramide liegt im Repo
(`tiles/stylized`, `tiles/old`, Zoom 0–5). Umrechnung:

```
Kanten je Zoom z:  4 · 2^z          (z0 = 4×4 … z5 = 128×128)
1 Kachel entspricht: 256 / 2^z Karteneinheiten
Kachel (x, r) deckt: x·U … (x+1)·U  waagerecht
                     r·U … (r+1)·U  senkrecht
```

💣 Die Dateien tragen ein **negatives** y (`map_<x>_-<reihe>.webp`, AGENTS.md
§10), und die Reihen beginnen bei **1**, nicht bei 0.

**Anonym — und wo das nichts kostet.** Namen sind auf dieser Karte **keine
Bilddaten**: sie sind Canvas-Overlays, die vor der Aufnahme abgeschaltet werden.
Der stilisierte Kachelsatz trägt nachweislich keine einzige Schrift (geprüft an
der zusammengesetzten Gesamtkarte). Für fünf der sechs Ansichten ist Anonymität
damit geschenkt.

> 💣 **„Original" ist die Ausnahme, und dort hilft kein Schalter.** Der alte
> Kachelsatz ist ein Scan mit **eingebrannter** Schrift, über Land dicht. Anonym
> wird dieses Bild allein durch die **Wahl des Ausschnitts** — Waldinneres,
> Gebirge, Küstenlinie ohne Ortsnamen. Darauf, dass Schrift bei 64 px ohnehin
> Matsch ist, verlassen wir uns nicht.

**Je Ansicht ein eigener Ort** (Entscheidung des Owners, 11.08.2026): Politisch
an einem Grenzverlauf, Landschaften an einer Vegetationskante, Kraftlinien an
einer Linie, und so fort. Die Kandidaten werden **vor** der Festlegung als
Mockup gezeigt.

> 💣 **Statische Bilder veralten stumm.** Ändert sich der Kartenstil, zeigen die
> Kacheln weiter die alte Karte, und niemand bemerkt es — dieselbe Bauart, mit
> der der Änderungsverlauf fünf Tage lang seine Saat zeigte. Das
> Aufnahmeverfahren kommt deshalb als Werkzeug samt Notiz ins Repo, nicht als
> einmaliger Handgriff.

⚠️ Die `?v=`-Stempel der neuen Bilder setzt der Deploy von allein (alles, was von
`index.html` aus erreichbar ist). **Niemals von Hand schreiben** (AGENTS.md §7).

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

- **Die sechs Orte.** Werden am Mockup entschieden, nicht hier.
- **Kachelgröße.** 64 px ist der Vorschlag; am Mockup zu prüfen, ob ein
  Kartenausschnitt darin noch etwas erzählt.
- **Wohin nach der Erprobung.** Fällt die Auswahlbox ganz weg oder bleibt sie
  für den Planer? Erst nach dem Blick des Owners auf den gebauten Zustand.
