# Die Höhenskala im Topographie-Dialog (Fall #79)

**Stand:** 2026-08-18 · **Mockup:** `docs/hoehenskala-mockup.html` · **Fall:** #79 (Tigersprung,
17.08.2026, Ideensystem) · **Owner-Entscheide:** im Text mit 🔴 markiert.

## 1. Der Fall

> „Wenn ich Topographie-Flächen editiere, sehe ich Flächen in Graustufen. Hell ist hoch, dunkel ist
> niedrig. Aber wie hoch ist wie hell?"

Alrik im Anschluss, wörtlich: *„Mir reichen die Graustufen! Ich muss sie nur interpretieren können."*
und *„Das ist ein (Kontroll-)Schritt, den ich als Editor machen können muss."*

Gebaut wird also eine **Ablesehilfe, keine neue Darstellung.** An der gemalten Karte ändert sich
nichts.

## 2. Was heute tatsächlich passiert (gemessen, nicht gelesen)

Alle Zahlen live an avesmaps.de gemessen, 18.08.2026, über
`AvesmapsEcosystemHeightRender.stack()` und `getImageData` auf dem Höhen-Canvas.

**Die Graustufen erscheinen nur bei offenem Flächendialog.** `shouldDraw()`
(`map-features-ecosystem-height-render.js:253`) verlangt `solidMode`; ohne Dialog liegt gar kein
Höhenfeld auf der Karte (Owner-Entscheid 29.07.2026). Es gibt also **eine** Darstellung zu erklären,
nicht zwei — die Erdton-Rampe `rampAt()` ist derzeit unerreichbar.

**Der Weißpunkt ist der höchste Gipfel ALLER geladenen Gebirgsflächen**, nicht `HEIGHT_WHITE_SCHRITT`
und nicht der Gipfel der bearbeiteten Fläche:

```js
const reference = solidMode
    ? Math.max(HEIGHT_WHITE_SCHRITT * 0.02, ...stackFieldsHmax(stack))   // :298
    : HEIGHT_WHITE_SCHRITT;
```

`stack.fields` kommt aus `buildEcosystemHeightStack(topographyAreas(), …)` — also aus **allen**
`ecosystemLayers` mit `kind === "topographie"` und `region_type === "gebirge"`. Die Farbe ist im
Bearbeiten-Modus **linear**: `color = 255 · min(1, höhe / reference)`.

Gemessen bei Zoom 3 (10 Gebirge im Bild, Weißpunkt 9.000):

| Gebirge | hmax | hellster Pixel | Vorhersage 255·hmax/9000 |
|---|---|---|---|
| Raschtulswall | 9.000 | 254 | 255 |
| Koschberge | 5.000 | 135 | 142 |
| Eisenwald | 2.000 | 55 | 57 |

**Der Weißpunkt wandert mit dem Bildausschnitt.** Der Loader holt nach `bbox` + 25 % Rand
(`map-features-ecosystem-loader.js:51`). Derselbe Eisenwald:

| Ausschnitt | Felder im Stapel | Weißpunkt | hellster Pixel |
|---|---|---|---|
| Zoom 3, halbes Mittelaventurien | 10 | 9.000 | **55** |
| Zoom 7, Eisenwald allein | 1 | 2.000 | **235** |

⚠️ Es wandert vor allem beim **Zoomen**, nicht bei jedem Schwenk: der Raschtulswall blieb über vier
Ausschnitte hinweg im Bild. Praktisch heißt das — wer nah an einer Fläche arbeitet, hat oft nur sie
im Bild und sieht sie voll ausleuchten; das ist der Zustand, den der Owner im Discord mit „mach ich
gerade alles gleich weiß" beschrieben hat.

🔴 **Diese Darstellung wird NICHT geändert** (Owner 18.08.2026). Ein fester Weißpunkt machte die
kleinen Gebirge wieder flach und schwarz — genau das Problem, das die Normalisierung löst. Die
Skala **beschriftet** das Wandern, statt es zu verstecken.

## 3. Ort und Form

🔴 **Im Dialog, zwischen den Gelände-Reglern und den Gipfeln** (Owner 18.08.2026). Ein eigener
`.label-wiki-reference`-Block mit dem Titel **„Höhenskala"** — dieselbe Hülle wie „Gelände" und
„Gipfel" daneben.

🔴 **Waagerechter Balken, Gipfelnamen schräg darüber** (Owner 18.08.2026, „B is cool"). Die
senkrechte Alternative war 76 px flacher und benannte alle Gipfel, wurde aber verworfen.

Aufbau von oben nach unten:

1. schräge Gipfelbeschriftungen (52°, enden je an ihrer Marke)
2. Gipfelmarken (Dreiecke) über dem Balken
3. der Graubalken, schwarz → weiß, 16 px hoch
4. fünf Achsenwerte: 0 / ¼ / ½ / ¾ / Weißpunkt, auf 50 gerundet (die Auflösung der Regler)
5. ein Satz: „Werte in Schritt. **Weiß = 9.000** — der höchste Gipfel im Bildausschnitt. Was höher
   liegt, wird nicht heller."

## 4. Die Regeln, die tragen

🔴 **Der Bezugswert kommt aus dem Zeichner, er wird nie nachgerechnet.** `redraw()` meldet den
tatsächlich benutzten `reference` nach jedem Malen. Eine zweite Rechnung wäre eine zweite Wahrheit,
und die Legende erklärte irgendwann eine andere Karte als die sichtbare.

💣 **Ein Gipfel ohne erfasste Höhe zählt als `ECOSYSTEM_HEIGHT_PLACEHOLDER` (5.000)** — genau das
tut der Feldbau (`map-features-ecosystem-height-field.js:516-518`). Wer ihn in der Skala auslässt
oder auf 0 setzt, zeigt ihn woanders, als die Karte ihn malt.

💣 **Die Marke lügt nicht.** Am Gipfelmittelpunkt löscht das Gipfelfenster das Rauschen, die gemalte
Höhe **ist** dort die eingetragene Gipfelhöhe (`…-height-field.js:510-512`). Deshalb darf die Marke
überhaupt auf einen Grauton zeigen.

🔴 **Gekürzt wird der Name, nie die Höhe** (Owner 18.08.2026: „die höhe sollte noch lesbar sein").
Name und Zahl sind zwei Elemente; `text-overflow: ellipsis` sitzt am Namen, die Zahl ist
`flex: none`. 💣 In **einem** Element fräße die Ellipse zuerst die Zahl — sie steht hinten. Dieselbe
Falle wie beim Wiki-Override (AGENTS.md §11).

💣 **Wie kurz, entscheidet der Platz.** Ein Text der Länge L unter 52° ragt `L · cos(52°)` nach
links. Bei einer Marke weit links liefe er aus dem Fenster; der Name wird deshalb auf das gekürzt,
was bis zum Rand passt. Reicht selbst die Zahl allein nicht, **kippt die Zeile nach rechts oben**
(spiegelbildlich) statt zu überlaufen.

💣 **Zusammengefasst wird nach PLATZ, nicht nach Gleichheit.** Zwei Schriftlinien unter 52° stehen
`Δx · sin(52°)` auseinander, die Zeile ist 14 px hoch ⇒ enger als **18 px waagerecht** stoßen sie
zusammen (gemessen 18.08.2026; bei Weißpunkt 9.000 sind das rund 390 Schritt). Solche Nachbarn
teilen sich **eine Beschriftung**:

- gleiche Höhe → „2 Gipfel · 5.000"
- verschiedene Höhen → „2 Gipfel · 2.450–2.600" (⚠️ eine einzelne Zahl wäre dort falsch)
- vollständige Namen immer im `title`

💣 **Gleiche Höhen sind der NORMALFALL, kein Sonderfall.** Jeder Gipfel ohne erfasste Höhe liegt auf
5.000; im Raschtulswall sind das zwei von vier. Zwei Beschriftungen exakt übereinander sähen aus wie
eine, und wer Marken zählt, käme auf eine andere Zahl als die Gipfelliste zwei Zeilen tiefer.
⚠️ Einen der Namen willkürlich vorzuziehen („Raschtul Kandscharot +1") wäre eine Aussage, die die
Daten nicht hergeben.

💣 **Die Marken bleiben einzeln, nur die BESCHRIFTUNGEN werden gruppiert.** Ein Dreieck ist 8 px
breit und kollidiert erst darunter; zwei Marken 18 px auseinander sind unterscheidbar, ihre Texte
nicht. Nur **exakt** gleiche Höhen ergeben eine gemeinsame (etwas breitere) Marke.

💣 **Die Marken stehen ÜBER dem Balken, nie auf ihm.** Als Strich auf dem Verlauf ist eine braune
Marke im dunklen Drittel unsichtbar — und dort sitzen die Gipfel im häufigsten Fall (niedrige Fläche
neben hohem Nachbarn). Über dem Balken stehen sie auf der Panelfarbe und tragen in beiden Themen.

⚠️ **Der Graubalken ist grau, und das ist kein Verstoß gegen AGENTS.md §12.** Er zeigt DATEN (die
gemalten Graustufen), keine Bedienoberfläche — dieselbe Ausnahme wie die Landschaften-Wassertöne.
Er muss dem Canvas exakt entsprechen: linear von `#000` nach `#fff`.

## 5. Bauteile

| Datei | Rolle |
|---|---|
| `js/map-features/ecosystem-hoehenskala.js` | **neu** — reiner Rechner: Gruppierung, Positionen, Beschriftungstexte. Kein DOM, kein `fetch`. |
| `js/map-features/map-features-ecosystem-height-render.js` | gibt den benutzten `reference` heraus und meldet jedes Malen |
| `js/map-features/map-features-ecosystem-properties.js` | Verdrahtung: baut die Skala im Dialog, kürzt nach gemessenem Platz |
| `index.html` | Markup des Abschnitts + `<script>` |
| `css/features/ecosystem-layer.css` | Stil |
| `js/map-features/__tests__/hoehenskala.test.js` | **neu** — Test des Rechners |

**Aktualisiert wird bei jedem Malen**, aber nur **neu gebaut**, wenn sich Weißpunkt oder Gipfel
geändert haben — `redraw()` läuft bei jeder Kartenbewegung.

## 6. Bewusst nicht gebaut

- Kein fester Weißpunkt, keine Änderung an der gemalten Karte (§2).
- Keine Legende außerhalb des Dialogs — ohne Dialog gibt es keine Graustufen zu erklären.
- Keine Marke für die Durchschnittshöhe: sie ist kein Punkt, den die Karte an einer bestimmten
  Stelle malt, sondern ein Mittelwert über die Fläche. Eine Marke dafür wäre eine Behauptung.
- Kein `data-i18n` am Balken über die vorhandene Praxis hinaus — die Landschaften-Oberfläche ist
  insgesamt noch nicht übersetzt (gehört zu M8).
