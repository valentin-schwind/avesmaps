# Das Frontend am Telefon — Fingermaße, Höhenbudget, und der Weg zur Karte

**Stand:** 2026-08-10 · **Gemessen:** live auf avesmaps.de bei 375×812 und 360×640, DPR 2,
`pointer: coarse` · **Owner-Abstimmung:** 2026-08-10 — Zoomtasten entfallen (§7 C2), die
schwebende Box entfällt (§5.3), Panels in voller Höhe mit den vorhandenen Laschen statt eines
Schließkreuzes (§5.1–5.2), die iOS-Schwelle vorgezogen (§6 A1), die Suche nimmt den Sitz des
Zooms (§7 C1), Trefferflächen **insgesamt** unter der Bedingung „Flächen bleiben unberührt"
(§7 C3a–d), Ortsnamen klickbar **auch am Desktop** (§7 C3b), einheitliche Abschlüsse als
Block D (§7b); das „Blatt von unten" ist verworfen (§8)

> Umfang: **nur das Frontend.** Die Editoren (`css/pages/*`, `edit/`, `html/*-editor.html`)
> bleiben unberührt — dort wird am Schreibtisch gearbeitet. Wo eine Regel unter
> `@media (pointer: coarse)` steht, greift sie auf einem Tablet auch im Editor; das ist
> hingenommen, aber nicht Gegenstand der Abnahme.
>
> ⚠️ **Zwei Maßnahmen sind ausdrücklich nicht auf das Telefon beschränkt** (beide Owner
> 2026-08-10): klickbare Ortsnamen (§7 C3b) gelten auch am Zeiger, und die einheitlichen
> Abschlüsse (§7b Block D) sind sogar überwiegend eine Zeiger-Sache. Beide werden auch am
> Desktop abgenommen. Sie stehen hier, weil sie dieselben Stylesheets betreffen.

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

### A1 — Die iOS-Schwelle zuerst *(Owner 2026-08-10: „wichtiger Punkt")*

Von allem in diesem Entwurf ist dies der kleinste Handgriff mit der größten Wirkung, und er
steht deshalb **vor** den Höhen: `--font-size-control` auf 16 px am groben Zeiger. Darunter
zoomt Safari beim Fokus in jedes Feld hinein und **kehrt nicht zurück** — der Nutzer landet in
einer vergrößerten Karte, die er von Hand zurückschieben muss, und zwar bei jeder einzelnen
Eingabe: Wegpunkt, Stunden/Tag, Reisetag, Monat, Unterkunft.

⚠️ **Die Schriftgröße muss dort stehen, wo sie gewinnt.** Ein Basisselektor
(`input, select { font-size: 16px }`) verliert gegen jede Komponentenregel
(`.planner-lodging__select { font-size: 12px }`, 0,1,0 gegen 0,0,1). Deshalb liest die
Komponente `var(--font-size-control)` und die Fingerschicht hebt den Token — nicht umgekehrt.

🔴 **Nicht über `maximum-scale=1` / `user-scalable=no` im Viewport-Meta.** Das ist der erste
Vorschlag, den man zu diesem Problem findet, und er ist falsch: er nimmt **allen** das
Aufziehen der Karte, also genau die Geste, die nach §7 C2 die einzige Zoomhilfe ist — und
neuere iOS-Fassungen ignorieren ihn ohnehin. Der heutige Tag (`width=device-width,
initial-scale=1.0`) bleibt unangetastet.

⚠️ **16 px ist eine Schwelle, kein Richtwert** — 15,5 px zoomt. Wer den Token später „aus
Gründen der Dichte" auf 15 senkt, holt den Fehler vollständig zurück, ohne dass es auffällt,
solange niemand ein iPhone anfasst. Zusicherung 4 in §10 bewacht genau das.

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

**Der Einwand des Owners ist berechtigt: es ist kein Platz für einen Suchknopf.** Aber es wird
gerade welcher frei. Mit §7 C2 verlässt der Zoom-Control die untere rechte Ecke — 30 × 56 px,
direkt über dem Knopfbund, im Daumenbereich einer Hand.

**Vorschlag: die Suche nimmt den Sitz, den der Zoom räumt.** Ein Knopf von 48 × 48 px an genau
der Stelle, an der heute `+`/`−` stehen, nur unter `pointer: coarse`. Die Rechnung geht auf,
weil es ein **Tausch** ist und keine Zugabe: die Zahl der Bedienelemente auf der Karte bleibt
gleich, die Fläche praktisch auch (1.680 gegen 2.304 px²), und die Mechanik steht schon — der
Knopf setzt sich mit `bottom: calc(12px + var(--avesmaps-corner-stack))` über den Bund, so wie
der Zoom es tat.

Gestalt nach Hausrecht (AGENTS.md §12): **quadratisch mit `--radius-md`, keine Pille**, und als
einziges Element auf der Karte **gefüllt** (`--color-button`) — „Neuigkeiten" und „Hinweise"
sind weich/outline. Damit trägt die Ecke sichtbar eine Rangfolge: eine Handlung, zwei Verweise.
Nur eine Lupe, dazu `aria-label="Suchen"`; ein Wort daneben bräuchte Breite, die es nicht gibt.

⚠️ **Der Knopf öffnet nichts Neues.** Er ruft `openSpotlightSearch()` — dieselbe Fläche, die
schon 50 px hoch ist und mit 20 px setzt. Es entsteht kein zweites Suchfeld.

⚠️ **Bei offenem Panel verschwindet er mit dem Rest der Kartenbedienung.** Am Telefon läuft ein
offenes Panel über die volle Höhe und lässt 64 px Karte (§5) — dort ist kein Knopf mehr sinnvoll
bedienbar. 🔧 Wie sich der Eckbund heute bei offenem Infopanel verhält, ist **nicht belegt**:
die Regel `right: calc(var(--avesmaps-ip-w) + 12px)` griff in der Simulation nicht (gerechnet
308 px, gemessen 12 px), aber die Simulation bekam das Panel auch nicht wirklich auf. Vor dem
Bauen im echten Ablauf messen — davon hängt ab, ob „ausblenden" eine Änderung ist oder nur das
Festschreiben dessen, was ohnehin passiert.

**Verworfene Alternativen.** *Eine Suchleiste oben* (der erste Entwurf): kostet dauerhaft
Kartenhöhe, auch wenn niemand sucht. *Ein dritter Knopf im Bund*: „Suchen · Neuigkeiten ·
Hinweise" misst ~250 px, stapelt unter 599 px dreifach — und die Suche stünde optisch als
dritter Verweis da statt als die eine Handlung. ⚠️ Der Bund bliebe dann auch an
`--avesmaps-corner-stack` gebunden, das
[`map-corner-actions.test.js`](../../../js/app/__tests__/map-corner-actions.test.js) festhält.
*Die Geste beibehalten und erklären*: ein Langdruck, den man erklären muss, ist keiner.

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

### C3a — Punkte: der Trefferboden für Ortsmarker

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

### C3b — Ortsnamen werden klickbar, **auch am Desktop** *(Owner-Entscheid 2026-08-10)*

🔴 **Korrektur zum ersten Entwurf.** Dort stand, das Ortslabel sei „breit und bereits klickbar".
Das gilt für **Regions**labels (`.map-label`). Der **Ortsname** ist doppelt gesperrt:
`interactive: false` am Marker
([`location-name-labels.js:155`](../../../js/map-features/map-features-location-name-labels.js))
**und** `pointer-events: none` im CSS. Und zwar absichtlich — der Kommentar in
[`map-labels.css:508`](../../../css/features/map-labels.css) sagt warum:

> „`.location-name-label` teilt sich jene Regel und bleibt bewusst inert: dort ist der
> Siedlungs-MARKER das Klickziel, nicht seine Beschriftung — beide klickbar zu machen hiesse,
> zwei Treffer uebereinanderzulegen."

**Diese Begründung trägt hier nicht, und das ist der ganze Punkt.** Zwei Treffer übereinander
sind ein Problem, wenn sie **verschiedene** Dinge öffnen. Marker und Name eines Ortes sind
dasselbe Ding: „Gareth" und der Punkt darunter führen beide nach Gareth. Es sind keine zwei
Ziele, sondern **ein Ziel mit zwei Teilen** — und der zweite ist der breitere.

**Umzustellen:** `interactive: true`, `pointer-events: auto`, und ein Klickpfad, der **exakt
denselben** Aufruf macht wie der Marker (nicht ein zweiter Popup-Bauer daneben — sonst laufen
die beiden Auskünfte über einen Ort auseinander).

✅ **Kein Geisterklick bei verdeckten Namen:** `.is-colliding` ist `display: none`
([`map-labels.css:45`](../../../css/features/map-labels.css)), nicht `opacity: 0`. Ein
weggekollidiertes Label ist aus dem Trefferbaum heraus — die Falle, die es hier geben könnte,
gibt es nicht.

⚠️ **Der Bearbeitungsmodus ist gesondert zu prüfen.** `body.edit-mode .map-label` setzt schon
heute `cursor: move` + `pointer-events: auto` fürs Ziehen. Ortsnamen bekommen dort erstmals
beides — der Klickpfad darf das Ziehen nicht abfangen.

⚠️ **Kein `pointer: coarse`-Riegel.** Owner ausdrücklich: auch am Zeiger. Damit gehört dieser
Punkt **nicht** in die Fingerschicht und wird auch am Desktop abgenommen.

### C3c — Linien: ja, aber sparsam

Nur **202 von ~5.650** Wegen sind überhaupt klickbar
(`interactive: IS_EDIT_MODE || pathHasWiki(path)`). Die klickbare Breite ist die der Kontur —
bei Zoom 3 gemessen: 5,85 px für die dicksten, 2,4 px, 1,2 px für die dünnsten. Am Finger
(~2,5 mm bei 5,85 px) ist das nicht zu treffen.

💣 **Hier kostet jeder Pixel etwas, anders als bei Punkten.** Ein Weg ist ein Streifen quer
über die Karte. Gibt man ihm 44 px Trefferbreite, gehört ein Band von ±19 px links und rechts
**jedes** Weges nicht mehr dem Gebiet darunter. Bei 202 sichtbaren Wegen ist die Karte damit
mit Wege-Bändern gepflastert, und ein Tipp auf eine Grafschaft trifft die Straße, die zufällig
hindurchläuft. Das ist genau das, was der Owner ausgeschlossen hat.

**Vorschlag:** kein flacher Boden, sondern ein **Vielfaches der gezeichneten Breite**, gedeckelt
— `hitWeight = min(20, max(gezeichnet, gezeichnet × 3))`. Das erhält die Rangfolge
(Reichsstraße breit, Pfad schmal), lässt das Band überall schmaler als die halbe Fingerbreite
und nimmt dem Gebiet darunter ~7 px statt ~19. ⚠️ Der Faktor und der Deckel sind **zu messen**;
gebaut wird er als unsichtbare dritte Linie über der Kontur, nicht durch Verbreitern der
sichtbaren (sonst ändert sich das Kartenbild).

🔧 **Falls dir auch das zu viel Eingriff ist:** C3c weglassen und nur C3a + C3b bauen. Ein Weg
trägt seinen Namen als Label, und Labels werden mit C3b ohnehin klickbar — dann ist der
**Name** das Trefferziel des Weges, und die Fläche darunter bleibt vollständig unangetastet.
Das ist die sparsamste Fassung und sie erfüllt deine Bedingung ohne jede Abwägung.

### C3d — Flächen bleiben, wie sie sind

Territorien, Landschaften, Klimabänder: **keine Änderung, und es gibt auch keine zu machen.**
Die Trefferfläche eines Polygons *ist* seine Fläche — ein „Boden" hieße, sie nach außen zu
schieben und den Nachbarn zu bestehlen. Bei geschachtelten Gebieten wäre das aktiv schädlich;
die bekannte Eigenheit „Eltern-Hülle frisst Klicks der Kinder" ist genau dieser Fehler, nur
schon vorhanden.

✅ **Die Bedingung des Owners ist strukturell erfüllt, nicht nur zugesagt.** Die Pane-Reihenfolge
ordnet die Flächen ohnehin ganz unten ein — gemessen: `regionsPane` 200, `ecosystemPane`
250–253, gegen `roadsPane` 400, `locationCanvasPane` 499, `labelsPane` 650. Punkte und Namen
liegen darüber und nehmen ihnen nichts, was sie nicht heute schon nähmen. **Nur C3c greift
wirklich in die Fläche darunter** — deshalb steht dort ein Deckel und ein Ausstieg.

## 7b. Block D — Einheitliche Abschlüsse *(Owner 2026-08-10, mit Beleg-Screenshot)*

Owner: „uneinheitliche Abschlüsse beseitigen wie z. B. hier beim Panel und den Buttons." Am
Zeiger sichtbar, aber es ist eine Stylesheet-Frage und gehört auf dieselbe Liste.

**Der Befund im Screenshot ist exakt greifbar.** Drei knopfartige Flächen in einer Bildecke,
drei verschiedene Abschlüsse:

| Fläche | heute | Quelle |
|---|---|---|
| „Neuigkeiten" / „Hinweise" | `--radius-sm` = **5 px** | [`legal-dialog.css:449`](../../../css/components/legal-dialog.css) |
| Zoom `+` / `−` | **4 px** | `css/third-party/leaflet.css:286` (`.leaflet-bar`) |
| „Alle anzeigen" | `--radius-md` = **8 px** | Hausregel |

**Es gibt hier nichts zu entscheiden — die Designsprache hat es schon entschieden.** AGENTS.md
§12: *„Buttons … radius `--radius-md`"*. Zwei der drei folgen ihr nicht. Die Panel-Hülle
dagegen ist richtig (`--radius-sm`, laut `tokens.css` „mirrored panel shell + tiniest chips") —
**der Unterschied Panel↔Knopf ist gewollt, der Unterschied Knopf↔Knopf nicht.**

### Der Umfang dahinter

| | Frontend-CSS |
|---|---:|
| `border-radius` **mit** Token | 167 |
| `border-radius` **ohne** Token | **135** |
| verschiedene harte Werte | **11** — bei drei definierten Stufen |

Aufschlüsselung der harten Werte: `6px` (24×) · `999px` (22×) · `8px` (21×) · `50%` (20×) ·
`4px` (11×) · `0` (9×) · `5px` (5×) · `12px` (5×) · dazu 3px, 2px, 10px, 9px, 7px, 1px.

💣 **26 davon schreiben den Wert eines Tokens von Hand ab** — 21× `8px` (das ist `--radius-md`)
und 5× `5px` (das ist `--radius-sm`). Die sehen heute richtig aus und sind genau die Sorte
Divergenz, vor der §12 warnt: wer den Token je verstellt, verstellt sie nicht mit.

### Drei Schritte, absteigend nach Sicherheit

1. **Die 26 abgeschriebenen Werte werden Token.** Mechanisch, **null sichtbare Änderung**, und
   das ist beweisbar (gerechneter Wert vorher = nachher). Der billigste Teil.
2. **Knopfartige Flächen auf `--radius-md`**, wie §12 es sagt — das ist der sichtbare Teil und
   der, den der Owner gemeldet hat.
3. **`999px` und `50%` werden einzeln beurteilt, nicht gefegt.** Ein runder Punkt, ein
   Wappenrahmen, ein Zählerkreis dürfen rund sein; ein *Knopf* darf es nach §12 nicht („no
   pill shapes"). Das ist eine Durchsicht von 42 Stellen, kein Suchen-und-Ersetzen.

⚠️ **Der Zoom-Abschluss steht in einer Fremddatei.** `css/third-party/leaflet.css` wird **nicht**
angefasst; die Korrektur gehört in die eigene Ebene — `map-layout.css` überschreibt dort schon
heute die Zoom-**Farben**, das ist der Präzedenzfall und der richtige Ort. 🔧 Nebenbei: nach §7
C2 verschwindet der Zoom am Finger ohnehin, dieser Punkt ist also rein für den Zeiger.

🔴 **Ein dokumentierter Sonderfall bleibt stehen:**
[`editor-page.css:408`](../../../css/components/editor-page.css) hält fest, dass dort `6px` der
**absichtliche** Wert ist und *nicht* `--radius-sm` (5) oder `--radius-md` (8). Er liegt
ohnehin im Editor und damit außerhalb des Umfangs — aber wer die Zählung oben als Arbeitsliste
liest, muss ihn kennen. ⚠️ Er ist auch der Beleg dafür, dass die 135 **nicht** alle Fehler
sind; die Liste ist ein Ausgangspunkt für eine Durchsicht, keine Abarbeitungsvorschrift.

---

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
| 1 | **A1** iOS-Schwelle (§6) | — | iPhone: Fokus in jedes Feld des Planers, **kein** Hineinzoomen. Der billigste Schritt, deshalb der erste |
| 2 | **0** Panels (§5.1–5.3) | — | 360×640, 5 Wegpunkte: Panel läuft randlos, scrollt in sich, Seite nicht; Lasche 30 von 30 px sichtbar; ein Tipp auf einen Ort öffnet **eine** Fläche |
| 3 | **A** Maßschicht (Rest) | 0 | kein Bedienelement des Fingerwegs unter 44 px; Desktop 1280×800 **pixelgleich** |
| 4 | **C2 → C1** Ecke | A | erst räumt der Zoom, dann zieht die Suche ein — in dieser Reihenfolge, sonst stehen kurz drei Dinge übereinander |
| 5 | **C3b** Ortsnamen klickbar | — | **auch am Desktop:** Klick auf „Gareth" öffnet dasselbe wie der Punkt darunter; ein weggekollidierter Name fängt nichts; Ziehen im Editmodus unverändert |
| 6 | **C3a** Trefferboden Punkte | — | Dorf bei Zoom 4 treffbar, ohne dass ein Tipp auf leere Karte einen Ort weit weg öffnet |
| 7 | **C3c** Linien *(optional)* | C3b | ein Weg am Finger treffbar; **Gegenprobe: eine Grafschaft neben einem Weg öffnet weiter die Grafschaft** |
| — | **C3d** Flächen | — | nichts zu tun (§7 C3d) |
| 8 | **D** Abschlüsse (§7b) | — | **Zeiger-Sache.** D1 (26 Token) beweisbar ohne Bildänderung; D2: die drei Knöpfe der Bildecke tragen einen Abschluss; D3: keine Pille an einem Knopf |
| — | **B** Blatt | verworfen (§8) | — |

⚠️ **C3b vor C3a**, obwohl beide dasselbe Ziel haben: der breite Name nimmt dem Boden unter dem
Punkt einen Teil seiner Arbeit ab. Wer zuerst den Boden setzt, misst ihn gegen eine Karte, auf
der das Label noch nicht hilft — und wählt ihn zu groß.

💣 **A1 ist von A abtrennbar, der Rest nicht.** Die Schriftgröße wächst nach innen und rührt
das Höhenbudget aus §4 nicht an — sie kann vor Block 0 gehen. Jede **Höhe** dagegen wartet auf
Block 0.

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
4. **Die iOS-Schwelle.** `--font-size-control` ist unter `pointer: coarse` **≥ 16 px** (nicht
   „gesetzt", sondern der Wert), und keine umgestellte Komponente schreibt daneben noch eine
   eigene `font-size` auf ein Feld. Zweite Hälfte: `index.html` trägt **kein**
   `maximum-scale` / `user-scalable` im Viewport-Meta — der falsche Fix aus §6 A1 darf nicht
   still nachwachsen. Mutation: Token auf 15 px ⇒ rot; `maximum-scale=1` ergänzt ⇒ rot.
5. **Die schwebende Box hat zwei Aufrufer, und nur einer wird still.** `{ floating: true }` in
   `location-marker-entry.js` hängt an einer Zeigerprüfung, der in `location-lookup.js`
   **nicht**. Mutation: den Riegel auch dorthin ⇒ rot („nächster Ort" verlöre seine Ausgabe,
   §5.3).
6. **Der Trefferboden steht einmal.** Der Ausdruck aus C3a kommt in
   `location-canvas-layer.js` **einmal** vor (heute zweimal).
7. **Name und Punkt öffnen dasselbe.** Der Klickpfad des Ortslabels ruft **denselben** Bauer wie
   der Marker — kein zweiter Popup-Aufbau daneben. Mutation: eigener Aufruf im Label-Pfad ⇒ rot.
   Das ist die Zusicherung, die C3b überhaupt vertretbar macht: zwei Trefferflächen sind nur
   dann ein Ziel, wenn sie nachweislich dieselbe Auskunft öffnen.
8. **Flächen bleiben unberührt.** Weder `regionsPane` noch die `ecosystemPane*` bekommen eine
   Trefferzugabe, und C3c hat einen Deckel. Mutation: ein Boden auf einem Polygon-Layer ⇒ rot
   (Owner-Bedingung 2026-08-10).
9. **Kein Token-Wert steht doppelt.** Keine Frontend-CSS-Datei schreibt `border-radius: 8px`
   oder `5px` als Literal — das sind die Werte von `--radius-md` und `--radius-sm`. Mutation:
   eines der 26 zurückschreiben ⇒ rot. ⚠️ Die Prüfung liest nur `border-radius`-**Deklarationen**
   und schneidet Kommentare heraus: `editor-page.css` **beschreibt** den 6-px-Sonderfall in
   Prosa und nennt dabei beide Tokenwerte — die Falle aus §10 unten, hier bereits gestellt
   (meine eigene Zählung hat die Kommentarzeile zuerst mitgezählt).

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
