# Die Ansichts-Icons (`icons/layer-tiles/`)

Sechs Bilder, 128 px, WebP — je eines für die sechs Derographie-Ansichten. Sie sitzen auf der
Ansichts-Kachel in der Kartenecke (`?layerPanelActive=1`, Entwurf:
`docs/superpowers/specs/2026-08-11-ansichts-kacheln-design.md`).

| Datei | Ansicht | Herkunft |
|---|---|---|
| `none.webp` | Nur Karte | Aufnahme · Gebirge, 628/628, Zoom 5 |
| `original.webp` | Original | Aufnahme · alte Karte, 660/476, Zoom 5 |
| `political.webp` | Politisch | **vom Owner gestaltet** (`img/politisches_icon.png`) |
| `deregraphic.webp` | Standard | Aufnahme · Straßen + Orte, 534/555, Zoom 5 |
| `powerlines.webp` | Kraftlinien | Aufnahme · Linie + Nodix, 534/555, Zoom 5 |
| `ecosystem.webp` | Landschaften | **vom Owner gestaltet** (`img/landschaften_icon.png`) |

## Neu aufnehmen

`avesmaps.de` öffnen, `capture.js` komplett in die Browser-Konsole einfügen, dann:

```js
avesLayerTiles.alle()            // die vier aufgenommenen, als Download
avesLayerTiles.eine("powerlines")
```

Die Dateien nach `icons/layer-tiles/` legen. 🔴 `political` und `ecosystem` werden übersprungen —
die beiden sind gestaltet, nicht aufgenommen, und ihre Quellen liegen unter `img/`.

## Wann

💣 **Die Bilder sind statisch und veralten stumm.** Ändert sich der Kartenstil, die Farbgebung des
politischen Layers oder die Magiersicht der Kraftlinien, zeigen die Icons weiter den alten Stand —
und niemandem fällt es auf, weil ein Icon immer *irgendwie* plausibel aussieht. Anlässe:

- neue Kachelsätze unter `tiles/` (die Kartenpipeline liegt in einem eigenen Repo),
- geänderte Deckung/Farben im politischen Layer oder in den Landschaften,
- geänderte Werte in `syncPowerlineMapTint` (die Entsättigung der Kraftlinien-Ansicht).

## Die drei Fallen

Alle drei wurden beim ersten Bauen getreten und sind im Kopf von `capture.js` ausführlich begründet.

1. 💣 **Anonym ist eine Frage der EBENEN, nicht des Ortes.** Aufgenommen wird eine Allowlist von
   Panes. `regionLabels`, `labels`, `pathLabelCanvas` und `mapDecorations` stehen absichtlich nicht
   drin — was nicht in der Liste steht, kann keinen Namen ins Bild tragen.

2. 💣 **Die Gebietsnamen SIND Bilder.** In der `regionLabels`-Pane liegen die Namen als
   `data:`-PNG (gerasterter Text), die Wappen dagegen als Datei unter `/uploads/wappen/`. Ein
   „alle Bilder dieser Pane zeichnen" holt jeden Namen zurück. Gefiltert wird deshalb nach der
   **Bildquelle**.

3. 💣 **Jede Datenebene baut sich stufenweise auf** — die politische Außengrenze steht zuletzt
   (AGENTS.md §10). Eine Aufnahme nach fester Wartezeit mischt neue Farben mit alten Grenzen: die
   weißen Konturen laufen quer durch die Flächen. Genau daran scheiterten die ersten Versuche
   (Owner, 11.08.2026: „die politischen Grenzen sind nicht in den Farbregionen"). `capture.js`
   wartet, **bis sich nichts mehr ändert**, und warnt in der Konsole, wenn es nicht ruhig wurde.

⚠️ Zwei kleinere, ebenfalls im Code begründet: eine serialisierte SVG-Ebene trägt ihre CSS-Regeln
nicht mit (die Landschaften stehen auf `fill-opacity="0.2"` im Attribut, während CSS `0.72`
durchsetzt — die Flächen kommen sonst blass heraus), und ohne `viewBox` zeichnet sie in ihre
eigenen, weit außerhalb liegenden Koordinaten und das Bild bleibt leer.

⚠️ Fremde Bildquellen vergiften die Leinwand: nach einem einzigen `drawImage` von einer anderen
Herkunft wirft `toDataURL()` für **alles**. `capture.js` überspringt sie deshalb.
