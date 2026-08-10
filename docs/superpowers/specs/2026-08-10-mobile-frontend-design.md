# Das Frontend am Telefon — Fingermaße, Höhenbudget, und der Weg zur Karte

**Stand:** 2026-08-10 · **Gemessen:** live auf avesmaps.de bei 375×812 und 360×640, DPR 2,
`pointer: coarse` · **Owner-Abstimmung:** offen

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

**Daraus folgt die Reihenfolge des ganzen Vorhabens:** erst der Riegel, dann die Fingermaße.
Andersherum wächst der Planer von 766 px auf über 1.000 und die halbe Oberfläche wird
unerreichbar.

---

## 5. Block 0 — Der Riegel (Voraussetzung, ~3 Zeilen)

Am Telefon endet der Planer am unteren Bildrand und scrollt in sich selbst.

```
@media (max-width: 640px) {
    #search { max-height: calc(100dvh - 20px); }   /* war: 140dvh */
}
```

⚠️ Die 140 war kein Versehen, sondern ein Ausweichen vor genau dem Scrollbalken, den §4
beschreibt. Der Balken ist am Telefon aber das kleinere Übel: er liegt über einem Panel, das
man ohnehin scrollt — die wegfahrende Karte kostet den Bezugspunkt. `#overview` behält seine
eigene Grenze (`min(80vh, 100dvh − 320px)`), scrollt also weiter für sich; das bleibt.

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

### C2 — Zoomtasten in Fingergröße

`.avesmaps-infopanel-mode .leaflet-control-zoom a` steht auf 26 px — auf ausdrücklichen
Owner-Wunsch („gerne kleiner"). Unter `pointer: coarse` auf `--tap-min`; der Wunsch bleibt
damit für die Maus gültig.

💣 **Hier greifen A und C ineinander, und die Richtung ist leicht zu verwechseln.** Der Zoom
liest den Bund (`bottom: calc(12px + var(--avesmaps-corner-stack))`), nicht umgekehrt — ein
größerer Zoom wächst also nach oben und lässt den Bund in Ruhe. Aber „Neuigkeiten" und
„Hinweise" sind heute **31 px** hoch; sobald Block A ihnen `--tap-min` gibt, stimmt die 40 in
`--avesmaps-corner-stack` nicht mehr, und der Zoom setzt sich auf die Knopfreihe. Die Zahl
gehört deshalb im selben Zug an die Steuerhöhe gebunden statt neu geraten. ⚠️ Sie hängt an
`:root`, **nicht** an `.avesmaps-infopanel-mode` allein — die Modusklasse sitzt an `<html>`
**und** `<body>`, und die body-Kopie überschriebe sonst den schmalen Fall (AGENTS.md §11, genau
so schon einmal gemessen).

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

## 8. Block B — Der Planer als Blatt von unten *(eigene Sitzung)*

Am Telefon ist der Planer 350 px breit und lässt **10 px Karte** übrig: man plant blind. Die
Form stimmt nicht — eine Seitenleiste ist eine Desktopform.

**Richtung:** auf `avesmapsIsPhoneViewport()` fährt `#search` von **unten** statt von links, in
drei Rasten — Griff (~72 px, Zusammenfassung plus „Route planen") · halb (50 dvh) · ganz
(90 dvh). Die Karte bleibt oben sichtbar, und `getRouteFitBoundsOptions` bekäme erstmals einen
sinnvollen `paddingBottomRight` statt der heutigen Null.

Das ist der größte Eingriff (Lasche, jQuery-`animate({left})`, `#overview`-Grenze, Fokus,
`--avesmaps-corner-stack`) und gehört **nicht** in dieselbe Sitzung wie 0 / A / C. Hier steht
er nur, damit A und C ihn nicht verbauen: **beide dürfen keine Regel schreiben, die „links"
oder „350 px" voraussetzt.**

---

## 9. Reihenfolge und Abnahme

| | Block | hängt an | Abnahme |
|---|---|---|---|
| 1 | **0** Riegel | — | 360×640, 5 Wegpunkte: Panel scrollt, Seite nicht, Karte steht |
| 2 | **A** Maßschicht | 0 | kein Bedienelement des Fingerwegs unter 44 px; Desktop 1280×800 **pixelgleich** |
| 3 | **C1–C3** Karte | — | Suche mit einem Tipp erreichbar; Zoom ≥ 44 px; Dorf bei Zoom 4 treffbar |
| — | **B** Blatt | eigene Sitzung | — |

**Die Desktop-Gegenprobe ist die wichtigste Abnahme des ganzen Vorhabens.** Alles unter
`pointer: coarse` darf am Zeiger nachweislich nichts ändern — das Höhenbudget aus §4 hängt
daran.

## 10. Zusicherungen

Quelltext-Tests im Haus-Muster (`js/app/__tests__/*.test.js` lesen CSS und behaupten über den
Inhalt):

1. **Der Riegel bleibt.** `#search` trägt unter 640 px eine `max-height`, die `100dvh` nicht
   übersteigt. Mutation: zurück auf `140dvh` ⇒ rot.
2. **Kein zweiter Ort für Steuermaße.** Es gibt genau **einen** `@media (pointer: coarse)`-Block
   mit `--control-h*`, und er steht in `tokens.css`. Mutation: dieselben Token in einer zweiten
   Datei ⇒ rot.
3. **Die iOS-Schwelle.** `--font-size-control` ist unter `pointer: coarse` ≥ 16 px, und keine
   umgestellte Komponente schreibt daneben noch eine eigene `font-size` auf ein Feld.
4. **Der Trefferboden steht einmal.** Der Ausdruck aus C3 kommt in
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
