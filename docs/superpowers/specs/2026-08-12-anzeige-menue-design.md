# Das Anzeige-Menü (Auge) — Entwurf

**Stand:** 2026-08-12 · **Mockup:** `docs/anzeige-menue-mockup.html` (vier Varianten,
Owner wählte **B**) · **Nachbar-Entwurf:** `docs/superpowers/specs/2026-08-11-ansichts-kacheln-design.md`

---

## 1. Was gebaut wird, in einem Satz

Ein neuer Knopf mit einem **Auge** in der Kartenecke, **über** dem Suchknopf. Er klappt
ein Menü auf, in dem sich Ortsklassen und Kartenebenen einzeln ein- und ausblenden
lassen — im Frontend zehn Schalter, für Editoren zusätzlich Seewege, die fünf
Prüf-Haken und der Mapstil.

**Das Menü ist kein neues Bedienwerk, sondern der neue Ort für ein vorhandenes.** Die
Schalter existieren alle schon; sie stehen heute im Routenplaner und sind dort
größtenteils versteckt.

---

## 2. Warum überhaupt

Im Bearbeiten-Modus lässt sich die Karte seit jeher leerräumen: Wege weg, Labels weg,
Grenzen weg. Ein Besucher kann das nicht — er bekommt, was die gewählte Ansicht
vorgibt, und sonst nichts. Die Schalter dafür sind gebaut, verdrahtet und getestet;
ihnen fehlt nur die Oberfläche.

Gleichzeitig räumt der Routenplaner auf: Die Ortsklassen-Symbole sitzen dort seit
jeher zwischen Reisezielen und Transportmitteln, obwohl sie mit dem Planen einer
Route nichts zu tun haben. Sie sind eine **Karteneinstellung** und gehören zur Karte.

Das ist dieselbe Bewegung, die am 12.08.2026 die Zeile „Derographie" aus dem
Routenplaner in die Ansichts-Kachel geholt hat — ein Bedienelement für eine Sache,
und zwar dort, wo die Sache passiert.

---

## 3. Der Bestand: was es schon gibt

| Schalter | ID | heute sichtbar | wirkt heute |
|---|---|---|---|
| 6 Ortsklassen | `.location-toggle[data-location-type]` | **Frontend + Editor** | ja |
| Wege | `#togglePaths` | nur Editor | ja |
| Labels | `#toggleMapLabels` | nur Editor | **nur im Editor** (dreiwertiger Override) |
| Grenzen | `#toggleTerritoryBorders` | nur Editor | **nur im Editor** (dreiwertiger Override) |
| Flüsse | `#toggleRivers` | nur Editor | ja |
| Seewege | `#toggleSeaPaths` | nur Editor | **nur im Editor** (fest verdrahtet) |
| Prüfen (5 Haken) | `#editorChecks` | nur Editor | nur Editor |
| Mapstil | `#mapStyleSelect` | nur Editor | nur Editor |

Alle stehen in `index.html` in `.display-options` innerhalb von `#search`.

**Die drei „nur im Editor"-Zeilen sind der eigentliche Fund.** Labels und Grenzen
lesen ihren Haken über einen *dreiwertigen* Override:

```js
// js/map-features/map-features-labels.js:714
return IS_EDIT_MODE ? document.getElementById("toggleMapLabels")?.checked : null;
// true = zeigen, false = verbergen, null = kein Haken da (Frontend) -> allein der Modus entscheidet
```

Der Mechanismus „Haken übersteuert den Modus in **beide** Richtungen" ist also fertig
gebaut, kommentiert und im Editor erprobt. Ihn im Frontend zu öffnen kostet **je eine
Zeile** — das `IS_EDIT_MODE ?` fällt weg. Nichts anderes ändert sich, weil `null`
genau der Zustand „ich bin nicht da" war, den es nach dem Umbau nicht mehr gibt.

---

## 4. Was ins Menü kommt

**Öffentlich (jeder Besucher):**

- Gruppe **Orte** — die sechs Ortsklassen
- Gruppe **Ebenen** — Wege · Labels · Grenzen · Flüsse

**Zusätzlich für Editoren:**

- Gruppe **Ebenen** wächst um **Seewege**
- Gruppe **Prüfen** — Kreuzungen · Nodices · Unverbunden · nur Labels mit Region ·
  Kreuzungen ≤ 2 Wege
- Gruppe **Mapstil** — die Auswahlbox

**Bewusst NICHT im Menü:**

- **Flussnamen.** Sie sind heute an die Ansicht gekoppelt (`flussnamen` in
  `FRONTEND_LAYER_MODE_DEFAULTS`) und haben keinen eigenen Haken. Zwei Zeilen
  „Flüsse" und „Flussnamen" nebeneinander wären zwei ähnlich klingende Schalter für
  eine Sache, die der Besucher als eine wahrnimmt. (Owner 2026-08-12.)
- **Geschwindigkeit** (`#showRouteSpeedControl`). Zeigt Pfeile auf der *Route*, nicht
  auf der Karte — steht bei den Transportmitteln richtig.
- **Derographie** (`#mapLayerModeSelect`). Hat seit dem 12.08.2026 die Ansichts-Kachel.

---

## 5. Die Form: Variante B

Das Mockup stellte vier Formen gegenüber; der Owner wählte **B — Auge in jeder
Zeile**, mit der Auflage: *„die icons bzw. das design/die funktionalität der
stadtgrößen beibehalten"*.

**Gruppe „Orte": unverändert.** Dieselben sechs `.location-toggle`-Knöpfe mit den
`icons/realistic/*.webp`, dasselbe Aussehen, dasselbe Verhalten, dieselbe
Kaskadenlogik. Sie **ziehen um, sie werden nicht nachgebaut.**

**Gruppe „Ebenen": Zeile mit Auge.** Jede Zeile trägt links ein Glyph (Weg, Labels,
Fluss, Grenze), in der Mitte den Namen, rechts ein **Auge**, das sich schließt. Aus
ist der auffällige Zustand: Name gedämpft, Glyph blass, Auge durchgestrichen.

Damit zieht sich das Motiv des Knopfes bis in die letzte Zeile durch — die Liste der
geschlossenen Augen *ist* die Liste dessen, was gerade fehlt.

⚠️ **Preis der Entscheidung:** Der Auge-Schalter ist ein `<button aria-pressed>`, keine
Checkbox. Tastaturbedienung, Zustandsansage und Vorlesbarkeit muss er selbst
mitbringen — eine Checkbox hätte das geschenkt bekommen. Das ist der bewusst
akzeptierte Aufpreis für das durchgezogene Motiv.

### Gliederung

Gruppen mit **Trennlinie + Überschrift**, nicht mit Rahmen (AGENTS.md §12). Die
Überschrift in `--color-accent-strong`, `--font-size-caption`, bold, gesperrt,
Großbuchstaben — dasselbe Muster wie `display-options__group-title`. Der Trenner läuft
**full-bleed**: negativer Seitenrand = Polsterung des Menüs.

Die Editor-Gruppen tragen ein kleines „nur Editoren"-Merkmal und stehen **unten**.

---

## 6. Die Bauart: umziehen, nicht nachbauen

💣 **Das ist die tragende Entscheidung des ganzen Entwurfs.**

Die Schalter werden in `index.html` **an ihren neuen Platz verschoben** — nicht
kopiert, nicht gespiegelt, nicht nachgebaut. Jede ID bleibt, was sie ist.

Der Gewinn ist der gesamte Rest des Systems: `$("#togglePaths").is(":checked")`,
`syncPathVisibility()`, `applyFrontendLayerModeDefaults()`, die URL-Persistenz in
`map-features-layer-state.js`, die Aufdeckung im Edit-Modus
(`map-features.js:67–74`, `bootstrap.js:343–368`) — all das findet seine Elemente
**per ID** und ist vom Umzug nicht betroffen. Ein Nachbau hätte einen zweiten Zustand
erzeugt, der bei jedem Ansichtswechsel, jedem geteilten Link und jedem
Editor-Sonderfall neu hätte synchron gehalten werden müssen.

Der Test dafür ist einfach: **Nach dem Umbau darf keine Datei außer `index.html`,
dem neuen Menü-Skript und dem neuen Stylesheet angefasst werden müssen, damit die
Schalter weiter wirken.** (Die zwei Override-Zeilen aus §3 sind die benannte
Ausnahme — sie erweitern die Wirkung, sie reparieren nicht den Umzug.)

### Was im Routenplaner zurückbleibt

`.display-options` bleibt als Hülle bestehen und enthält danach **nur noch** die
versteckte Derographie-Zeile.

🔴 **Sie darf nicht entfernt werden.** Zwei Gründe:

1. `#mapLayerModeSelect` **ist** der Zustand der Ansicht — `getSelectedMapLayerMode()`
   liest ihn, der geteilte Link kommt über ihn an, die Ansichts-Kachel schreibt in ihn.
2. `js/ui/map-layer-picker.js` versteckt die Zeile über
   `select.closest(".display-options__select-row")`. Fiele die Klasse oder der
   Vorfahr weg, liefe das ins Leere — und `?layerPanelActive=0`, der Notausgang der
   Ansichts-Kachel, hätte nichts mehr zurückzuholen.

⚠️ `#mapStyleControl` zieht mit um und **verliert dabei seine
`display-options__*`-Klassen** — es steht dann nicht mehr in den Anzeigeoptionen.

---

## 7. Der Eckbund und seine Höhe

Der Bund `#map-corner-actions` ist eine Spalte. Nach dem Umbau von oben nach unten:

```
[Anzeige-Menü]      ← nur wenn aufgeklappt, IM FLUSS
👁 Anzeige-Knopf     ← neu, ganz oben (Owner: „über dem Suchen button")
🔍 Suchknopf
[Ansichts-Menü]     ← nur wenn aufgeklappt
🃏 Ansichts-Kachel
[Neuigkeiten] [Hinweise]
```

💣 **Im Fluss, nicht schwebend** — derselbe Beschluss wie bei der Ansichts-Kachel und
aus demselben Grund: ein schwebendes Menü legte sich über die Zoom-Knöpfe, die
schlicht dahinter verschwanden. Im Fluss wächst stattdessen der Bund, und der Zoom
darüber liest dessen **gemessene** Höhe (`syncMapCornerStack`) und rückt von allein
mit. Beim Auf- und Zuklappen wird zusätzlich **von Hand nachgemessen** — der
ResizeObserver stellt erst zum nächsten Bild zu, und die Höhe ändert sich jetzt.

### 💣 Der Deckel

Gemessen im Mockup (Bühne 300 × 660 px, ein schmales Telefon im Hochformat):

| Zustand | Menü-Inhalt | Bund gesamt | Anteil der Bühne |
|---|---|---|---|
| Frontend, aufgeklappt | 270 px | 498 px | 75 % |
| **Editor, aufgeklappt** | **653 px** | 582 px (gedeckelt) | 88 % |

Ohne Deckel schöbe das Menü im Editor den Suchknopf, die Ansichts-Kachel und beide
Verweise aus dem Bild. Deshalb:

```css
max-height: min(50vh, 420px);
overflow-y: auto;
overscroll-behavior: contain;
```

⚠️ Relativ zur Schirmhöhe, nicht absolut — ein fester Wert liegt auf dem nächsten
Gerät daneben. `overscroll-behavior: contain` verhindert, dass das Scrollen am Ende
der Liste auf die Karte durchschlägt.

### 💣 Nur ein Menü offen

Öffnet das Anzeige-Menü, **schließt das Ansichts-Menü** — und umgekehrt. Zwei offene
Menüs übereinander addieren ihre Höhen, und der Bund überschreibt den ganzen Schirm.
Beide klappen außerdem bei Escape und bei einem Klick auf die Karte zu.

---

## 8. 💣 Ein Schalter, der nichts bewirken kann, ist deaktiviert — und sagt warum

Nicht jeder Schalter wirkt in jeder Ansicht. Das ist kein Fehler, sondern die Bauart —
aber ein Schalter, der sich umlegen lässt und sichtbar nichts tut, liest sich als
kaputt.

| Ansicht | Orte | Wege | Labels | Grenzen | Flüsse |
|---|---|---|---|---|---|
| Nur Karte | ✓ | ✓ | ✓ | **✗** | ✓ |
| Original | ✓ | ✓ | ✓ | **✗** | ✓ |
| Standard | ✓ | ✓ | ✓ | ✓ | ✓ |
| Politisch | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kraftlinien | **✗** | **✗** | ✓ | **✗** | **✗** |
| Landschaften | ✓ | ✓ | ✓ | ✓ | ✓ |

Die Gründe stehen im Code und sind **nicht** Teil dieses Umbaus:

- **Grenzen ✗:** `TERRITORY_BOUNDARY_MODES = ["political", "deregraphic", "ecosystem"]`
  (`map-features-political-territory-loader.js:18`). In den anderen Ansichten werden
  die Territoriumsdaten **gar nicht geladen** — der Zeichner hätte nichts zu zeichnen.
- **Wege / Flüsse / Orte ✗ in Kraftlinien:** `shouldShowPathOnMap` steigt für
  `powerlines` vor jeder Haken-Prüfung aus („Magiersicht"), und
  `shouldShowLocationMarker` zeigt dort nur Nodices.

**Regel:** Solche Zeilen erscheinen **ausgegraut**, mit einem Titel, der den Grund
nennt („In dieser Ansicht gibt es keine Grenzen"). Der Schalterzustand bleibt
unangetastet — er wird nur nicht bedienbar.

💣 **Der Riegel wird bei JEDEM Ansichtswechsel neu gesetzt, nicht beim Bau des Menüs.**
Ein einmal beim Aufbau gesetztes `disabled` friert ein und ist ab dem nächsten
Ansichtswechsel gelogen — genau der Fehler, den die Transport-Combobox schon einmal
hatte.

---

## 9. Verhältnis zur Ansicht: die Ansicht gewinnt

Bleibt wie heute. Jeder Ansichtswechsel setzt die Schalter auf die Vorgaben des
Zielmodus (`applyFrontendLayerModeDefaults`, `FRONTEND_LAYER_MODE_DEFAULTS`); das
Menü ist die **Abweichung danach**, kein Dauer-Übersteuern. (Owner 2026-08-12.)

Der Unterschied zu heute ist nur, dass man es jetzt **sieht**: die Augen springen beim
Ansichtswechsel zurück. Das ist gewollt — eine Ansicht ist ein Kartenbild, und wer sie
wechselt, will dieses Bild.

🔴 **Kein zweiter Zustand.** Die verlockende dritte Möglichkeit („nur was der Besucher
angefasst hat, klebt") bräuchte ein dauerhaftes Gedächtnis je Schalter. Genau diese
Sorte Gedächtnis war am 05.08.2026 die Ursache dafür, dass Editoren nach den
Landschaften in *jedem* Zielmodus ohne Ortsklassen dastanden.

⚠️ Damit erbt das Menü auch die Lücke in `FRONTEND_LAYER_MODE_DEFAULTS`: die Tabelle
kennt `orte`, `wege` und `flussnamen`, aber **nicht** Labels und Grenzen — die folgen
im Frontend `MAP_LABEL_MODES` / `BOUNDARY_OVERLAY_MODES` über den Zeichner. Nach der
Öffnung der Overrides (§3) müssen die beiden Haken beim Moduswechsel **auch im
Frontend** auf diese Listen gesetzt werden — heute tut das
`syncEditorDisplayTogglesToMode`, und die steigt im Frontend in der ersten Zeile aus.
Ohne diese Änderung bliebe ein einmal umgelegter Haken über den Ansichtswechsel
stehen und widerspräche §9 Satz 1.

---

## 10. Der Riegel: wer sieht was

Die Editor-Gruppen hängen an `IS_EDIT_MODE`, genau wie heute — dieselben Aufrufe in
`map-features.js` und `bootstrap.js`, die die Elemente per ID finden.

⚠️ **Die Gruppen-Hüllen müssen mitverstecken.** Eine Gruppe „Prüfen" mit lauter
versteckten Haken wäre eine Überschrift über einer Trennlinie über nichts. Für
`editorChecksTitle` + `editorChecks` ist das schon so gelöst; **Seewege** und
**Mapstil** brauchen je eine eigene Hülle mit `hidden`, die derselbe Code aufdeckt.

⚠️ „nur Labels mit Region" hängt zusätzlich am Landschaftsmodul (`IS_ECOSYSTEM_ENABLED`)
und wird von `applyEcosystemAccess()` nachgereicht, wenn die Rechteauskunft eintrifft.
Unverändert.

---

## 11. Der Knopf

Ein 48 × 48 großer Knopf mit einem Auge-Glyph (Umriss, `currentColor`,
`--icon-lg`) — Fingermaß, wie der Suchknopf daneben.

💣 **Farbe, Kontur, Radius und Schatten kommen aus der gemeinsamen Eckknopf-Regel in
`css/components/legal-dialog.css`, nicht aus dem neuen Stylesheet.** `#map-display-button`
wird dort in **beide** Selektorlisten eingetragen: in die Grundregel *und* in die
`:hover, :focus-visible`-Regel. Genau das ging bei der Ansichts-Kachel einmal halb
daneben — sie stand in der Grundregel, aber nicht in der Hover-Regel, und blieb als
einziger der Knöpfe unter dem Zeiger stumm.

Aufgeklappt trägt er denselben Schimmer wie ein überfahrener Eckknopf
(`aria-expanded="true"` → `--color-hover-wash` über `--color-panel`).

---

## 12. Sprache

Primär Deutsch (AGENTS.md §8). Neue sichtbare Zeichenketten gehören in die
i18n-Tabelle, nicht in den Code geklebt:

- `display.menu.title` — „Anzeige"
- `display.menu.aria` — „Anzeige einstellen"
- `display.group.places` — „Orte"
- `display.group.layers` — „Ebenen"
- `display.group.checks` — „Prüfen"
- `display.group.mapstyle` — „Mapstil"
- `display.editorOnly` — „nur Editoren"
- `display.layer.{paths,labels,borders,rivers,seapaths}`
- `display.disabled.{borders,paths,rivers,places}` — die Begründungen aus §8

Die Namen der Ortsklassen kommen aus den vorhandenen `data-i18n-title`-Attributen der
`.location-toggle`-Knöpfe und ziehen mit um.

---

## 13. Tastatur

Kein neues Tastenkürzel in dieser Fassung. Die Buchstaben sind knapp, und `A` ist
bereits durch WASD belegt (AGENTS.md §11 — vier Buchstaben, die für keine Ansicht
erreichbar sind).

Im Menü selbst: `Tab` läuft durch die Schalter, `Leertaste`/`Enter` legt um, `Escape`
schließt und gibt den Fokus an den Knopf zurück. Pfeiltasten wandern **nicht** — anders
als beim Ansichts-Menü, das eine Einfachauswahl ist; hier sind es unabhängige Schalter,
und eine Radiogruppen-Bedienung wäre eine falsche Zusage.

---

## 14. Was geprüft wird, bevor es „fertig" heißt

**Abnahme heißt Ablauf, nicht Maß** (AGENTS.md §9). Diese Handgriffe werden ausgeführt
und benannt:

1. Auge anklicken → Menü fährt auf, Zoom-Knöpfe rücken mit, nichts wird verdeckt.
2. Ein Auge schließen (z.B. Wege) → die Wege verschwinden **auf der Karte**, sofort.
3. Ansicht wechseln → die Augen springen auf die Vorgaben des neuen Modus.
4. Auf *Kraftlinien* wechseln → Wege, Flüsse, Grenzen und Orte sind **ausgegraut** mit
   Begründung, nicht bedienbar und nicht gelogen.
5. Ansichts-Menü öffnen während das Anzeige-Menü offen ist → das erste schließt.
6. Am Telefon im Editor: Menü aufklappen → es scrollt in sich, Suchknopf und
   Ansichts-Kachel bleiben im Bild.
7. Routenplaner öffnen → die Anzeige-Sektion ist weg, nichts klafft.
8. Geteilten Link mit `?togglePaths=0` öffnen → das Auge für Wege ist zu.
9. Hell **und** dunkel.

**Automatisch:** `js/map-features/__tests__/layer-mode-defaults.test.js` muss
unverändert grün bleiben — er ist der Beleg, dass §9 hält. Dazu ein neuer Test für den
Riegel aus §8 (Schalterzustand je Ansicht) und für „nur ein Menü offen".

---

## 15. Bauteile

| Datei | Art |
|---|---|
| `index.html` | Umzug der Schalter, neuer Knopf + Menühülle im Eckbund |
| `js/ui/map-display-menu.js` | **neu** — Auf-/Zuklappen, Riegel aus §8, Bundhöhe |
| `css/components/map-display-menu.css` | **neu** — nur, was dieses Menü von den Nachbarn unterscheidet |
| `css/components/legal-dialog.css` | `#map-display-button` in **beide** Selektorlisten |
| `js/map-features/map-features-labels.js` | eine Zeile: Override auch im Frontend |
| `js/map-features/map-features-boundary-canvas-overlay.js` | eine Zeile: dito |
| `js/map-features/map-features-display-mode.js` | `syncEditorDisplayTogglesToMode` gilt auch im Frontend (§9) |
| `js/app/i18n-en.js` | die Zeichenketten aus §12 |

🔴 **`js/ui/map-layer-picker.js` wird nicht angefasst.** Die Datei hat gerade
uncommittete Änderungen aus einer anderen Sitzung (die Ansichts-Kachel geht live). Das
Zusammenspiel „nur ein Menü offen" (§7) wird deshalb **vom neuen Menü aus** gelöst: es
schließt das Ansichts-Menü über dessen vorhandene öffentliche Geste (Klick aufs
Dokument), nicht über einen Eingriff in dessen Code.

---

## 15a. Nachtrag von nach dem Bau (12.08.2026)

Zwei Stellen dieses Entwurfs hat der Bau widerlegt. Sie stehen hier, statt oben
stillschweigend korrigiert zu werden — der Entwurf ist die Abnahmeliste, und eine
Abweichung ohne Begründung ist genau das, was ihn wertlos macht.

**§5 — der „Preis der Entscheidung" entfällt.** Der Entwurf plante den Auge-Schalter
als eigenen `<button aria-pressed>` und nahm dafür in Kauf, Tastatur, Zustandsansage und
Vorlesbarkeit selbst mitbringen zu müssen. Gebaut ist stattdessen **ein `<label>`, das
Sinnbild, Namen, Checkbox und Auge umschließt**: Das Auge ist reine Darstellung
(`:has(.map-display-menu__state:checked)`), der Zustand bleibt die Checkbox mit ihrer
alten ID. Klickfläche, Fokusreihenfolge, Tastatur und Vorlesbarkeit kommen damit vom
Browser, und der Bestand (`$("#togglePaths").is(":checked")`, URL-Persistenz) merkt
nichts. Der Aufpreis war vermeidbar.
⚠️ Die Checkbox wird deshalb **aus dem Bild genommen, nicht versteckt** — `display: none`
nähme ihr den Fokus und machte die Zeile mit der Tastatur unerreichbar.

**§4/§10 — „Seewege" bekommt KEINE eigene Gruppe.** Der Bauplan sah eine vor; das war
falsch. Seewege sind eine Kartenebene wie Wege und Flüsse und stehen in derselben Gruppe
„Ebenen" — eine Überschrift „Seewege" über einer einzigen Zeile „Seewege" hätte nur sich
selbst wiederholt. Versteckt ist die **Zeile**, nicht die Gruppe (§10 gilt unverändert
für „Prüfen" und „Mapstil", die beide mehr als eine Zeile tragen).
💣 Der Riegel aus §8 musste dafür nachziehen: Seewege sind Pfade, die Kraftlinien-Ansicht
sperrt sie also mit. Sie fehlten zunächst in der Tabelle, weil sie erst mit dem
Editor-Teil ins Menü kamen — genau die Lücke, gegen die eine vollständige Tabelle steht.

**Zwei Fallen, die der Entwurf nicht kannte** und die der Bau gefunden hat:

- **Das Aussehen der Ortsklassen hing an `.display-options .location-toggle`.** Wären nur
  die Knöpfe umgezogen, hätten sie ihr Design verloren, ohne dass irgendwo eine Zeile
  fehlt — sie wären unformatiert dagestanden. Die Regeln sind mit nach
  `css/components/map-display-menu.css` gezogen. **Regeln gehören zu ihrem Bauteil.**
- **`data-i18n` setzt `textContent`** (`js/app/i18n.js:68`). An einer Überschrift, die ein
  Kind trägt, löscht es dieses Kind — hier das Merkmal „nur Editoren", und zwar erst beim
  ersten `?lang=en`. Auf Deutsch ist der Fehler unsichtbar.

## 15b. Was gemessen wurde

| Punkt aus §14 | Ergebnis |
|---|---|
| Menü auf, Zoom rückt mit | Bund +275 px, Zoom −275 px — exakt gekoppelt |
| Zeile klicken | Checkbox kippt, Auge und Textfarbe folgen, `change` erreicht den Bestand |
| Ansichtswechsel | alle sechs Ansichten setzen ihre Vorgaben; Hand-Abweichung springt zurück |
| Kraftlinien | Wege, Flüsse, Seewege, Grenzen, Orte gesperrt mit Grund; Labels frei |
| beide Menüs | Auge schließt das Ansichts-Menü und umgekehrt |
| Telefon im Editor | 557 px Inhalt im 406-px-Deckel, scrollt; Bund 631 px, Oberkante 169 px |
| Routenplaner | Lücke von 27 px auf 5 px (der normale Panel-Abstand) |
| `?togglePaths=0` | Haken aus, Auge durchgestrichen |
| hell/dunkel | beide tragen, inkl. Gold und Auge-Ton |

🔧 **Nicht geprüft:** ob die Wege beim Schließen des Auges wirklich von der Karte
verschwinden. Der lokale Server hat keine Kartendaten; belegt ist nur, dass das
`change`-Ereignis den Bestandspfad erreicht. Das ist ein Handgriff für den Owner.

## 16. Offene Frage an den Owner

🔧 **Die Ortsklassen verschwinden aus dem Routenplaner.** Das ist so entschieden
(§1, Owner 2026-08-12) und richtig — aber es ist die einzige Änderung dieses Umbaus,
die einem Bestandsnutzer etwas **wegnimmt**, was er dort seit jeher findet. Falls
das im Betrieb auffällt, ist die kleinste Antwort ein einzeiliger Hinweis im
Routenplaner, der auf das Auge zeigt — kein zweites Bedienelement.
