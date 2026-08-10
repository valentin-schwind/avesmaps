# Das Frontend am Telefon — Fingermaße, Höhenbudget, und der Weg zur Karte

**Stand:** 2026-08-10 · **Gemessen:** live auf avesmaps.de bei 375×812 und 360×640, DPR 2,
`pointer: coarse` · **Owner-Abstimmung:** 2026-08-10 — Zoomtasten entfallen (§7 C2), die
schwebende Box entfällt (§5.3), Panels in voller Höhe mit den vorhandenen Laschen statt eines
Schließkreuzes (§5.1–5.2); das „Blatt von unten" ist damit verworfen (§8)

> Umfang: **nur das Frontend.** Die Editoren (`css/pages/*`, `edit/`, `html/*-editor.html`)
> bleiben unberührt — dort wird am Schreibtisch gearbeitet. Wo eine Regel unter
> `@media (pointer: coarse)` steht, greift sie auf einem Tablet auch im Editor; das ist
> hingenommen, aber nicht Gegenstand der Abnahme.

---

## 1. Der Anlass

Die Seite ist am Telefon benutzbar, aber sie ist nicht **für** das Telefon gebaut. Die Frage
war, was genau fehlt. Die Antwort ist nicht „responsive Design fehlt" — das Fundament steht
(§2) —, sondern: **jedes Maß der Oberfläche ist ein Mausmaß**, und an einer Stelle hält ein
Riegel dagegen, der am Telefon in die falsche Richtung wirkt.

## 2. Was schon da ist

Das ist mehr, als der erste Blick vermuten lässt, und es ist an den richtigen Stellen:

- **`avesmapsIsPhoneViewport()`** ([`runtime-state.js:244`](../../../js/app/runtime-state.js)) —
  `pointer: coarse` **und** Kurzseite ≤ 600 px. Erkennt Telefone in beiden Lagen, schließt
  Tablets aus, kein UA-Sniffing. Drei Nutzer: Routenplaner startet eingeklappt, Editorpanel
  startet eingeklappt, und `getRouteFitBoundsOptions` reserviert am Telefon **keine**
  Panelbreite ([`route-plan.js:83`](../../../js/routing/route-plan.js)).
- Infopanel `min(400px, 100vw − 64px)`; Eckknopf-Stapel unter 599 px über **eine** Zahl
  (`--avesmaps-corner-stack`).
- **Touch-Sortierung der Wegpunkte** — `touchstart` → `MouseEvent`-Brücke für jQuery-UI
  ([`route-planner-toggle.js:60`](../../../js/ui/route-planner-toggle.js)).
- Dialog-Verschieben **bewusst nur Maus und Stift** ([`dialog-drag.js`](../../../js/ui/dialog-drag.js)).
- **HiDPI korrekt:** alle fünf Canvas mit `dpr`-Backing-Store (750 px für 375 CSS-px).
- `viewport`-Meta und `theme-color` gesetzt; **kein horizontaler Overflow** (375 = 375).
- `dvh` statt `vh` an den beiden Stellen, wo die Browserleiste sonst hineinregiert.
- **Die Spotlight-Suche ist bereits in Handymaßen gebaut:** Feld 50 px hoch, Schrift 20 px.

Was fehlt, ist also keine Grundlage, sondern eine **Maßschicht** darüber.

## 3. Der Befund in Zahlen

| | gemessen |
|---|---|
| Bedienelemente im Routenplaner unter 44 px | **25 von 31** (18 unter 32 px Höhe) |
| Zoom +/− | **26 × 26 px** — die einzige Zoomhilfe neben Pinch |
| Wegpunkt-✕ · ⓘ-Knopf · Checkbox | 24×24 · 16×16 · **14×14** |
| Schriftgröße aller Eingabefelder | **12–13,3 px** (< 16 ⇒ iOS zoomt beim Fokus und kehrt nicht zurück) |
| Trefferkreis eines **Dorfes** bei Zoom 6 (dort endet das Markerschema) | **24 px Ø** — erreicht auf keiner Stufe Fingergröße |
| Routenplaner auf 360×640, beide Gruppen offen | **766 px hoch** in 640 px Schirm |
| Karte, die neben dem offenen Planer bleibt | **10 px** (360er Schirm) / 25 px (375er) |
| Auslöser der Suche | **zwei** — Tastenkürzel und Langdruck-Kontextmenü. Kein sichtbarer Knopf. |

Die Breakpoints im Frontend liegen auf **sechs** verschiedenen Schwellen (380 / 420 / 520 /
599 / 640 / 760 px); einen definierten gibt es nicht. Die größte Frontend-Datei,
[`route-planner.css`](../../../css/features/route-planner.css) mit 1.481 Zeilen, hat **keine**
Breiten-Media-Query.

## 4. 💣 Der tragende Fund: die Höhen sind ein Budget, kein Geschmack

Der naheliegende Bau — „unter `pointer: coarse` alle Steuerhöhen auf 44 px" — **macht die Lage
am Telefon schlimmer**, nicht besser. Der Grund steht als Kommentar im Quelltext
([`route-planner.css:339`](../../../css/features/route-planner.css)):

> „24, nicht 32. 💣 Aufgeklappt müssen beide Gruppen zusammen unter die 754 px bleiben […]
> Sobald Oberfläche + 26 über die Panelhöhe geht, bekommt das GANZE Panel einen Scrollbalken —
> und der liegt dann über allem."

Nachgemessen am 03.08. bei 1280×800: **eine Optionszeile kostet 36 px** (25 px Feld + 11 px
Zeilenlücke), und bei vier Wegpunkten fällt der Balken. Die 24/25/32 px sind also gegen einen
Überlauf gerechnet — auf einem **800 px hohen Desktopfenster**.

Am Telefon ist dieses Budget längst gesprengt, und der Riegel dagegen wirkt verkehrt herum.
`#search` trägt am Desktop `max-height: 95vh` und `overflow-y: auto`; die Handy-Regel in
[`map-layout.css:49`](../../../css/layout/map-layout.css) **hebt** sie auf
`calc(140dvh − 20px)` an. 140 dvh ist mehr als der Schirm — die Grenze greift nie, das Panel
scrollt **nicht**, und stattdessen scrollt die **Seite**. Gemessen auf 360×640:

| | heute | mit `100dvh − 20px` |
|---|---|---|
| Panelhöhe | 766 px | 620 px |
| ragt unter den Rand | **136 px** | 0 |
| Panel scrollt | nein | **ja** (731 → 620) |
| **Seite** scrollt (Karte fährt weg) | **ja** | nein |

**Daraus folgt die Reihenfolge des ganzen Vorhabens:** erst bekommt der Planer eine Höhe, in
der er scrollen *kann*, dann die Fingermaße. Andersherum wächst er von 766 px auf über 1.000 px
und die halbe Oberfläche wird unerreichbar.

---

## 5. Block 0 — Die Panels am Telefon *(Owner-Entscheid 2026-08-10)*

Drei Festlegungen, die zusammengehören. Sie ersetzen das ursprünglich vorgeschlagene „Blatt von
unten" (§8) durch die einfachere Form, die die Oberfläche schon kennt.

### 5.1 In der Höhe Vollbild

Beide Panels laufen am Telefon von Kante zu Kante und scrollen in sich selbst:

```
@media (max-width: 640px) {
    #search { top: 0; height: 100dvh; max-height: none; }   /* war: top 10, max-height 140dvh */
    .avesmaps-infopanel { top: 0; bottom: 0; }              /* war: top 10, bottom 14 */
}
```

Das löst §4 nebenbei und sauberer als eine korrigierte `max-height`: `#search` trägt bereits
`overflow-y: auto`, es fehlte nur eine Höhe, an der das greift. ⚠️ Die 140 dvh war kein
Versehen, sondern ein Ausweichen vor dem Scrollbalken aus §4. Der Balken ist am Telefon das
kleinere Übel — er liegt über einem Panel, das man ohnehin scrollt, während die wegfahrende
Karte den Bezugspunkt kostet. `#overview` behält seine eigene Grenze und scrollt weiter für
sich.

### 5.2 Die 64-px-Gasse — und warum kein X nötig ist

Zur Wahl stand ein Schließkreuz oder die vorhandenen Randlaschen. **Die Laschen genügen — es
fehlt ihnen nur die Gasse**, und die Messung sagt, warum es heute nicht so aussieht:

| auf 360 px Schirm | Panelbreite | Lasche auf dem Schirm |
|---|---:|---:|
| Infopanel (`min(400px, 100vw − 64px)`) | 296 px | **30 von 30 px** |
| Routenplaner (fest `350px`) | 350 px | **10 von 30 px** |

Die Lasche des Planers ist 30 px breit und sitzt bei `left: 350px` — auf einem 360er Schirm
ragen zwei Drittel davon aus dem Bild. Das Infopanel hat die Lösung längst: eine Breitenformel,
die 64 px stehen lässt. Der Planer bekommt dieselbe:

```
#search { width: min(350px, calc(100vw - 64px)); }
```

💣 **Eine Formel für beide Panels, nicht zwei ähnliche.** Sie gehört als Token neben
`--avesmaps-ip-w` (`--avesmaps-panel-gutter: 64px`), sonst laufen die beiden Zahlen beim
nächsten Anfassen auseinander — genau das Muster, vor dem AGENTS.md §12 warnt. Ein X wäre
danach der **zweite** Weg hinaus und damit eine Bedienfrage mehr, keine weniger.

### 5.3 Die schwebende Box entfällt am Telefon

Ein Tipp auf einen Ort öffnet heute **zweierlei**: die schlanke schwebende Box auf der Karte
*und* das gefüllte Infopanel
([`location-marker-entry.js:239`](../../../js/map-features/map-features-location-marker-entry.js)
— „leave the floating box OPEN on the map"). Die Box misst `minWidth: 320` / `maxWidth: 400`;
das Panel daneben ist auf 360 px Schirm 296 px breit. **Die Box liegt vollständig dahinter.**

Am groben Zeiger entfällt sie: der Aufruf übergibt `{ floating: true }` nur noch, wenn Platz
dafür ist. Das Panel trägt ohnehin die vollständige Auskunft, die Box nur Kopf, Route/Teilen
und die Bewertungszeile.

🔴 **Nicht mitreißen: `location-lookup.js:342`.** Der zweite Aufrufer von `{ floating: true }`
ist „nächster Ort" — dort ist die Box die **einzige** Antwortfläche, kein Doppel. Sie fällt
unter dieselbe Verdeckung (`.slim-location-popup` geht unter 760 px auf volle Breite), aber die
Abhilfe ist eine andere und gehört in einen eigenen Schritt. Wer hier pauschal nach
`floating: true` greift, nimmt dem Werkzeug seine Ausgabe.

## 6. Block A — Die Maßschicht in den Tokens

**Das Problem, das den Bau bestimmt:** die Höhen sind heute **162 harte Pixelwerte** im
Frontend-CSS (`features/` 110, `components/` 51, `layout/` 1), davon 23 allein in
`route-planner.css`. Es gibt eine `--icon-*`-Familie, aber **keinen einzigen Token für eine
Steuerhöhe**. Ein `@media (pointer: coarse)`-Block in `tokens.css` überschriebe deshalb heute
nichts.

Also: **erst die Token anlegen, dann die Bedienelemente darauf umstellen, dann greift die
Fingerschicht an einer Stelle.** Genau die Reihenfolge, die AGENTS.md §12 verlangt („Need a
value with no token? Add the token first").

**Neue Token in [`tokens.css`](../../../css/base/tokens.css)** (neben `--icon-*`):

```
--control-h-sm:    24px;  /* Klappzeile, ✕ am Wegpunkt, ⓘ */
--control-h:       32px;  /* Wegpunktfeld, Combobox, Knopf */
--control-h-lg:    36px;  /* die Suchfeldzeile */
--control-h-field: 25px;  /* Zahlen- und Datumsfeld der Optionen */
--font-size-control: var(--font-size-small);  /* 12px — was Felder heute tragen */
--tap-min: auto;          /* Mindest-Fingerfläche einer Zeile */
```

**Die Fingerschicht — ein Block, sechs Zeilen:**

```
@media (pointer: coarse) {
    :root {
        --control-h-sm: 40px;  --control-h: 44px;  --control-h-lg: 48px;
        --control-h-field: 44px;
        --font-size-control: 16px;   /* 🔴 die iOS-Zoom-Schwelle, kein Geschmackswert */
        --tap-min: 44px;
    }
}
```

**Umzustellen sind nur die Bedienelemente auf dem Fingerweg**, nicht alle 162 Werte: Wegpunkt-
zeile, Wegpunktfeld, ✕, ⓘ, Comboboxen, Klappzeilen, Zahlen-/Datumsfeld, Monats- und
Unterkunft-Select, „Ziel hinzufügen", Sprach- und Themenumschalter. Rund 40 Regeln in
~8 Dateien. Alles andere (Bilder, Trenner, Zeitleisten) bleibt, wie es ist.

💣 **Die Checkboxen wachsen NICHT.** 14 × 14 px ist die native Box; sie zu vergrößern
verzieht die Zeile. Jede sitzt bereits in einem `<label>` — die Fläche ist also die **Zeile**,
gemessen 90–142 px breit, aber bei den drei Reiseoptionen nur **15 px hoch**. Die Regel gehört
deshalb an die Zeile (`min-height: var(--tap-min)`), nicht an die Box.

💣 **Warum nicht ein eigenes `touch.css` am Ende der Kette?** Weil das ein zweiter Ort wäre,
an dem Steuermaße stehen — genau die Divergenz, vor der AGENTS.md §12 warnt und die das
generierte `-inline.css` dreimal vorgeführt hat. Ein Token, den alle lesen, kann nicht
auseinanderlaufen.

⚠️ **Die Schriftgröße muss dort stehen, wo sie gewinnt.** Ein Basisselektor
(`input, select { font-size: 16px }`) verliert gegen jede Komponentenregel
(`.planner-lodging__select { font-size: 12px }`, 0,1,0 gegen 0,0,1). Deshalb liest die
Komponente `var(--font-size-control)` und die Fingerschicht hebt den Token — nicht umgekehrt.

⚠️ **Das Höhenbudget aus §4 wird damit am Desktop nicht angefasst** (`pointer: fine` ⇒ alle
Werte unverändert). Am Telefon wächst der Planer — und darf das, weil Block 0 vorher greift.
Gegenprobe gehört in die Abnahme: 360×640, fünf Wegpunkte, beide Gruppen offen.

## 7. Block C — Die Karte selbst bedienbar machen

Drei unabhängige Maßnahmen. Keine hängt an A oder B.

### C1 — Die Suche bekommt einen sichtbaren Auslöser

Heute hat `openSpotlightSearch()` genau zwei Wege: das Tastenkürzel (F / Leertaste) und den
Kontextmenü-Eintrag „Suchen" per Rechtsklick bzw. Langdruck. Am Telefon gibt es keine Tastatur,
und ein Langdruck ist eine unsichtbare Geste. Ausgerechnet die Fläche, die als einzige schon
Handymaße hat, ist die am schwersten erreichbare.

**Vorschlag: eine Suchleiste oben**, volle Breite minus Rand, links um die Breite der
Routenplaner-Lasche eingerückt (30 px), nur unter `pointer: coarse` sichtbar. Sie ist kein
zweites Suchfeld — ein Tippen öffnet das bestehende Spotlight-Overlay. Oben, weil dort jede
Kartenanwendung sie hat und weil die untere rechte Ecke bereits Zoom, „Neuigkeiten" und
„Hinweise" trägt.

**Alternative** (falls der Owner die Kartenfläche oben frei halten will): ein dritter Knopf im
Eckbund `#map-corner-actions`. ⚠️ Dann stapelt der Bund unter 599 px dreifach, und
`--avesmaps-corner-stack` muss mitwachsen — die Zahl ist bewusst die **eine** Stelle dafür
(AGENTS.md §11), und [`map-corner-actions.test.js`](../../../js/app/__tests__/map-corner-actions.test.js)
hält sie fest.

### C2 — Die Zoomtasten entfallen *(Owner-Entscheid 2026-08-10)*

Nicht vergrößern — **weglassen**. Am Finger ist die Zwei-Finger-Geste die Zoomhilfe; zwei
26-px-Kacheln daneben sind ein Mausrelikt, das Kartenfläche kostet.

```
@media (pointer: coarse) { .leaflet-control-zoom { display: none; } }
```

⚠️ **Ausblenden, nicht weglassen bei `L.control.zoom(...).addTo(map)`**
([`bootstrap.js:134`](../../../js/app/bootstrap.js)). Der Control bleibt am Zeiger, und
[`map-corner-actions.test.js`](../../../js/app/__tests__/map-corner-actions.test.js) prüft, dass
`.avesmaps-infopanel-mode .leaflet-control-zoom` in `infopanel.css` platziert wird — eine
JS-seitige Entscheidung ließe die Regel als tote Zusicherung stehen.

✅ **Das löst einen Konflikt auf, den A und C sonst gehabt hätten.** „Neuigkeiten" und
„Hinweise" sind heute 31 px hoch; sobald Block A ihnen `--tap-min` gibt, stimmt die 40 px in
`--avesmaps-corner-stack` nicht mehr — und der Zoom, der seinen Abstand aus dieser Zahl
rechnet, säße auf der Knopfreihe. Fällt der Zoom am Finger weg, liest die Zahl dort niemand
mehr; sie gilt nur noch am Zeiger, wo Block A nichts ändert. **Der Bund braucht trotzdem seine
Höhe** — er wächst mit `--tap-min` von 31 auf 44 px, und `--avesmaps-corner-stack` gehört im
selben Zug an die Steuerhöhe gebunden statt neu geraten. ⚠️ Sie hängt an `:root`, **nicht** an
`.avesmaps-infopanel-mode` allein — die Modusklasse sitzt an `<html>` **und** `<body>`, und die
body-Kopie überschriebe sonst den schmalen Fall (AGENTS.md §11, genau so schon einmal gemessen).

### C3 — Orte antippbar machen

Der Trefferkreis ist heute `core · 1,33 + 3` px
([`location-canvas-layer.js:297`](../../../js/map-features/map-features-location-canvas-layer.js),
zweimal derselbe Ausdruck). Aus dem Größenschema gerechnet erreicht ein **Dorf auf keiner
Zoomstufe** Fingergröße (Zoom 6: 24 px Ø), eine Metropole erst ab Zoom 5.

**Vorschlag:** die beiden Ausdrücke werden **eine** Konstante, und am groben Zeiger bekommt sie
einen Boden:

```
hitRadius = max(core * (1 + KONTUR) + SLACK, IST_GROBER_ZEIGER ? 16 : 0)
```

⚠️ **16, nicht 22.** Bei 4.653 Orten überlappen sich die Kreise sonst großflächig. Das ist
technisch harmlos — die Schleife nimmt ohnehin den **nächsten** Treffer —, aber ein zu großer
Boden lässt einen Tipp auf leere Karte einen Ort weit weg öffnen. 16 px (32 px Ø) ist der
Startwert; er ist zu messen, nicht zu glauben.

**Alternative, eleganter, teurer:** Trefferfläche = Marker **∪** Namenslabel. Das Label ist
breit und bereits klickbar ([`map-features-labels.js:524`](../../../js/map-features/map-features-labels.js)),
womit ein Dorf ohne jede neue Zahl fingergroß würde. Eigener Schritt.

## 8. Verworfen: der Planer als Blatt von unten

Der erste Entwurf schlug vor, `#search` am Telefon von **unten** einfahren zu lassen, in drei
Rasten (Griff · halb · ganz). **Zurückgestellt am 2026-08-10 zugunsten von §5.**

Der Grund ist nicht Aufwand, sondern Sparsamkeit: das Blatt hätte einen zweiten Öffnungs- und
Schließmechanismus neben die vorhandenen Randlaschen gestellt, eine neue Rasten-Logik gebraucht
und `getRouteFitBoundsOptions`, `--avesmaps-corner-stack` sowie die jQuery-`animate({left})`
angefasst. §5 erreicht dasselbe Ziel — Panel in voller Höhe, Karte nicht verdeckt, ein Weg
hinein und hinaus — mit einer Breitenformel, die im Haus schon steht.

⚠️ Sollte es später doch kommen, ist die Vorbedingung dieselbe wie vorher: **keine Regel
schreiben, die „links" oder „350 px" voraussetzt.** §5.2 erfüllt das bereits (die Formel nennt
keine Seite).

---

## 9. Reihenfolge und Abnahme

| | Block | hängt an | Abnahme |
|---|---|---|---|
| 1 | **0** Panels (§5.1–5.3) | — | 360×640, 5 Wegpunkte: Panel läuft randlos, scrollt in sich, Seite nicht; Lasche 30 von 30 px sichtbar; ein Tipp auf einen Ort öffnet **eine** Fläche |
| 2 | **A** Maßschicht | 0 | kein Bedienelement des Fingerwegs unter 44 px; Desktop 1280×800 **pixelgleich** |
| 3 | **C1–C3** Karte | — | Suche mit einem Tipp erreichbar; kein Zoom-Control am Finger; Dorf bei Zoom 4 treffbar |
| — | **B** Blatt | verworfen (§8) | — |

**Die Desktop-Gegenprobe ist die wichtigste Abnahme des ganzen Vorhabens.** Alles unter
`pointer: coarse` darf am Zeiger nachweislich nichts ändern — das Höhenbudget aus §4 hängt
daran.

## 10. Zusicherungen

Quelltext-Tests im Haus-Muster (`js/app/__tests__/*.test.js` lesen CSS und behaupten über den
Inhalt):

1. **Die Gasse ist EINE Zahl.** Der 64-px-Rand steht als Token, und **beide** Panelbreiten
   lesen ihn. Mutation: eine zweite Datei schreibt `100vw - 64px` von Hand ⇒ rot. Das ist die
   Zusicherung, die §5.2 überhaupt trägt — zwei Formeln driften, ein Token nicht.
2. **`140dvh` kommt nicht zurück.** `#search` trägt unter 640 px keine `max-height` über
   `100dvh`. Mutation: die alte Regel wieder eingesetzt ⇒ rot.
3. **Kein zweiter Ort für Steuermaße.** Es gibt genau **einen** `@media (pointer: coarse)`-Block
   mit `--control-h*`, und er steht in `tokens.css`. Mutation: dieselben Token in einer zweiten
   Datei ⇒ rot.
4. **Die iOS-Schwelle.** `--font-size-control` ist unter `pointer: coarse` ≥ 16 px, und keine
   umgestellte Komponente schreibt daneben noch eine eigene `font-size` auf ein Feld.
5. **Die schwebende Box hat zwei Aufrufer, und nur einer wird still.** `{ floating: true }` in
   `location-marker-entry.js` hängt an einer Zeigerprüfung, der in `location-lookup.js`
   **nicht**. Mutation: den Riegel auch dorthin ⇒ rot („nächster Ort" verlöre seine Ausgabe,
   §5.3).
6. **Der Trefferboden steht einmal.** Der Ausdruck aus C3 kommt in
   `location-canvas-layer.js` **einmal** vor (heute zweimal).

💣 **Beim Schreiben dieser Zusicherungen:** in diesem Haus haben Quelltext-Tests schon dreimal
auf den erklärenden **Kommentar** angeschlagen statt auf den Code (AGENTS.md §11,
`changelog-token-gate-test.php`). Nie auf einen Bezeichner prüfen — immer auf die Regel samt
Wert, und die Kommentare vorher herausschneiden.

## 11. Was ausdrücklich nicht dazugehört

- **Die Editoren.** Kein `css/pages/*`, kein `edit/`, kein `html/*-editor.html`.
- **Ein `?mobile=`-Schalter.** Die Unterscheidung ist der Zeiger, nicht eine Adresse.
- **Ein Breakpoint-Aufräumen.** Die sechs Schwellen (§3) sind Unordnung, aber keine, die am
  Telefon weh tut. Eigene Sitzung, wenn überhaupt.
- **Eine PWA / ein Manifest.** Andere Frage, anderer Entwurf.
- **`ASSET_VERSION`.** Betrifft nur dynamisch geladene Editor-Dateien (AGENTS.md §7) — hier
  stampelt der Deploy.
