# Avesmaps design language

One warm, *aventurian* visual language shared by **every** surface — the route
planner (left, `#search`), the infobox panel (right, `.avesmaps-infopanel`),
dialogs, popups, the editor. Warm browns, parchment, coat-of-arms gold. **No
blue** — it reads as a foreign UI kit and is what made the panels diverge.

## The one rule

**Never hardcode a colour, size, radius, spacing, or divider. Always use a token
from `css/base/tokens.css`.** If the value you need has no token yet, add the token
first, then use it. A colour written as a literal in two places is divergence
waiting to happen — it is how the infobox and route planner drifted apart.

## Tokens — the single source of truth (`css/base/tokens.css`)

| Group | Tokens |
|---|---|
| Surfaces | `--color-page-bg`, `--color-page-bg-deep` (editor backdrop), `--color-panel` (white card), `--color-panel-soft` (grouped bg), `--color-panel-muted` |
| Text | `--color-text`, `--color-text-strong`, `--color-text-muted`, `--color-placeholder` |
| Lines | `--color-border` (hairline), `--color-border-strong`, `--color-divider` (section separator — the *same* everywhere) |
| Button · primary (filled) | `--color-button`, `--color-button-text`, `--color-button-border`, `--color-button-hover`, `--color-button-active` |
| Button · secondary (soft/outline) | `--color-button-soft`, `--color-button-soft-text`, `--color-button-soft-border`, `--color-button-soft-hover`, `--color-button-soft-active` |
| Accent · links | `--color-accent` (coat gold), `--color-accent-strong`, `--color-link` (gold-brown — links are **never** blue), `--color-link-hover` |
| Pills / tags | `--color-pill`, `--color-pill-border`, `--color-pill-text` |
| Interaction · focus/states | `--color-focus` (+ `--focus-ring` recipe), `--color-hover-wash`, `--color-active-wash`, `--color-disabled-bg` / `-text` / `-border` |
| Typography | `--font-size-caption` … `--font-size-display` (7 rungs), `--leading-tight` / `-snug` / `-normal`, `--font-weight-regular` / `-bold`, `--font-ui` |
| Spacing | `--space-2` … `--space-24` (9 steps: 2/4/6/8/10/12/16/20/24) |
| Radius | `--radius-sm` 5px (panel shell), `--radius-md` 8px (all controls), `--radius-lg` 10px (menus/cards) |
| Icons | `--icon-sm` 16 / `--icon-md` 20 (UI glyphs) · `--icon-lg` 24 / `--icon-xl` 40 / `--icon-2xl` 48 / `--icon-hero` 130 (imagery) |
| Status · markers · elevation | `--color-danger`, `--color-success`, `--color-marker-destination`, `--color-marker-active` (clicked settlement → gold-yellow fill), `--shadow-panel`, `--shadow-dialog`, `--shadow-button-hover` / `--shadow-button-hover-strong` (button hover lift — strong = filled main action), the stacking ladder, low → high: `--z-map-ui` 1000 / `--z-dialog` 1450 / `--z-dialog-high` 1460 (map context menu) / `--z-editor-overlay` 1500 (the iframe editor tools) / `--z-dialog-over-editor` 3000 (a dialog opened from inside an editor) / `--z-modal` 5000 |
| Review stars | `--color-star` (filled glyph, warm coat-gold), `--color-star-muted` (empty-star track) — rating summary + write-dialog picker; both carry a dark value |

## Themes — light & dark

The palette direction is **C ("Heller / Papier")**: a light, neutral parchment
with warm taupe-brown controls and a restrained coat-gold. Light is the default
(`:root`). A full dark theme is defined under `:root[data-theme="dark"]` — the
same warm family on a deep parchment-brown canvas, cream text, and a warm gold
kept deliberately calm — ~12% desaturated from the light gold so it reads warm on
dark instead of neon.

Dark is **opt-in**, deliberately *not* `prefers-color-scheme`: the map tiles are
light, so auto-dark panels would clash over them. Every colour token carries a
dark value, so components that reference tokens (never literals) get both themes
in sync from this one file.

## Typography

`--font-ui` is Faculty Glyphic. **Two weights only** — `--font-weight-regular`
(400) and `--font-weight-bold` (700); never 500 / 600 / 800. Seven size rungs
with an 11px floor:

| Token | px | Line-height | Use |
|---|---|---|---|
| `--font-size-caption` | 11 | snug | section labels (bold + caps), pills, meta |
| `--font-size-small` | 12 | snug | dense secondary text — distances, counts, options |
| `--font-size-body` | 13 | snug | default controls — buttons, selects, tabs |
| `--font-size-reading` | 14 | normal | reading text — infobox type + description, inputs |
| `--font-size-subhead` | 16 | snug | subheaders |
| `--font-size-title` | 20 | tight | dialog / panel titles |
| `--font-size-display` | 22 | tight | infobox hero name |

Line-heights: `--leading-tight` 1.15 (titles/display), `--leading-snug` 1.25
(controls/labels), `--leading-normal` 1.45 (reading). Nothing renders below 11px —
the old 9–10.5px micro sizes come up to `--font-size-caption`.

## Spacing & radius

Spacing uses one value-named scale — **2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24**
(`--space-2` … `--space-24`, where the name is the pixel value). Always reach for
a step; a stray `7px` or `11px` is how rhythm drifts. Old odd values fold to the
nearest step. The divider gaps are scale steps: `--divider-gap` = `--space-12`,
`--divider-gap-tight` = `--space-6`.

Radius has **three** rungs: `--radius-sm` 5px (the mirrored panel shell + the
tiniest chips), `--radius-md` 8px (**all** controls — buttons, inputs, selects,
pills, list rows), `--radius-lg` 10px (menus, cards, autocomplete). The old
4/6/7/9px radii fold in — controls to `--radius-md`, floating surfaces to
`--radius-lg`. No pill / `999px` shapes anywhere.

## Fenster — es gibt ZWEI Bauarten, und eine Regel entscheidet

Owner-Entscheid 04.09.2026 („wir haben unterschiedliche fenster- und UI-stile … das fängt
damit an, dass titelleisten anders aussehen, dass buttons mal links mal rechts sind,
unterschiedlich groß"). Mockup: **`docs/fensterformen-mockup.html`**.

Vermessen wurde vorher über alle CSS-Dateien: **13** Rezepturen für den Schließknopf in
sechs sichtbaren Formen, **9** Polsterwerte für die Kopfzeile (sechs davon als nackte Zahl),
**4** Titelgrößen (15 · 16 · 17 · 20 — zwei auf keiner Skalenstufe), Hüllen-Radius quer
gemischt, Kopflinie mal `--color-border` mal `--color-divider`, Einklappen in zwei Fenstern
mit zwei Verhalten. Verschieben dagegen ist nirgends auseinandergelaufen — weil es **einen**
Erzeuger hat (`js/ui/dialog-drag.js`). Das ist der ganze Unterschied.

### Die Regel, welche Bauart gilt

- **Werkzeugfenster** — bleibt offen, während man daneben arbeitet; trägt ein Menüband oder
  eine Fußleiste; ist einklappbar. (Garetien Importer, die vier Editoren, Konflikte,
  Social Hub, Natur & Waren, Tempowerte, Kartensammlung, Übernahme-Vorschau.)
- **Blatt** — kurzes Formular: ausfüllen, speichern, weg. (Ort melden, Weg / Kraftlinie /
  Beschriftung bearbeiten, Rezension, Hinweise, Neuigkeiten.)

💣 Die Regel ist wichtiger als die Wahl. Vorher gab es beide Bauarten und **keine** Regel —
deshalb hat jeder neue Dialog geraten, und „Natur & Waren" hat sich per ID-Regel nachträglich
eine Titelleiste an ein Blatt geschraubt.

### Die Maße — sie existieren bereits als `--avm-*`, es fehlte nur, dass alle sie benutzen

🔴 **Kein eigener Token-Satz für Fenster.** Die Maße stehen längst in `css/base/tokens.css`
und tragen die vier Editoren. Ein zweiter Satz Namen für dieselben Zahlen wäre genau die
Divergenz, um die es hier geht — der erste Entwurf hatte ihn und wurde zurückgenommen.

| Token | px | Gilt für |
|---|---|---|
| `--avm-kopf-pad` | 6 / **14** | Kopfleiste · Fußleiste — *neu, der einzige neue Name* |
| `--avm-ribbon-pad` | 10 / **14** | Menüband |
| `--avm-col-pad` | 8 / **14** | Rumpf und Spalten — *heute 8 / 12, zieht auf 14 nach* |
| `--avm-status-pad` | 6 / **14** | Statuszeile · Listenkopf |
| `--avm-row-pad` | 4 / 6 | Listenzeile |
| `--avm-ribbon-gap` | 6 | zwischen Kacheln, Knöpfen, Feldern |
| `--avm-control-h` | 32 | Knopf · Feld · Auswahl · Schließknopf |

**Der Seiteneinzug ist überall 14** — schon heute die Mehrheit (Menüband und Statuszeile
tragen 14, nur die Spalten stehen auf 12). **Genau dieser eine Wert zieht nach**, danach läuft
eine senkrechte Linie durch jedes Fenster.

💣 **`--space-N` ist NICHT N Pixel** — die Skala trägt global +2 (`--space-12` = 14px), und
`tokens.css` sagt das direkt über den Editor-Tokens. Ein Mockup, das sich wörtliche Werte
definiert, ist auf jeder Kante 2px neben der Produktion und lässt sich nicht nachbauen, ohne
es zu verfehlen. Genau das ist dem zweiten Entwurf passiert.

🔴 **Die Hülle hat `padding: 0`** — jede Zone trägt ihr Polster selbst. Das ist die tragende
Zeile: dadurch läuft jeder Trenner **von Kante zu Kante ohne negative Außenränder**, der
Seiteneinzug ist an einer Stelle je Zone nachzuzählen, und Blatt und Fenster benutzen
dieselben Zonen. Für Fenster ersetzt das die „full-bleed = negativer Seitenrand"-Regel
unter *Divider mechanics* (die gilt weiter für Panels wie die Infobox, die echtes
Hüllenpolster haben).

⚠️ **Die Bandhöhe steht bewusst in keiner Tafel** — sie ist das Ergebnis aus Polster und
Inhalt. Gemessen: Kopfleiste **44,7** (32er Elemente + 2×6), Menüband **68,7** (48er Kacheln +
2×10 + Linie), Fußleiste **44,7**. Wer eine davon als `height` setzt, schneidet beim nächsten
zweizeiligen Element etwas ab.

💣 **Das senkrechte Polster folgt der Bedienhöhe des Bandes, das waagerechte niemals.**
Kopf- und Fußleiste tragen 32px-Elemente → `--avm-kopf-pad` (**6** / 14); das Menüband trägt
48px-Kacheln → `--avm-ribbon-pad` (**10** / 14). Das **waagerechte** bleibt in allen Bändern
**14** — daran hängt die eine Kante, und die ist der Kern der Tafel; wer dort 12 schreibt,
nimmt sie zurück.

⚠️ `--avm-kopf-pad` ist der **einzige** neue Token dieses Umbaus (Owner 04.09.2026: „kannst du
die titelleisten insgesamt weniger hoch machen"). Gemessen war die Leiste vorher
10 + 32 + 10 = **52,7 px** — kein Rest einer entfernten Linie, wie es aussah, sondern schlicht
zu viel Luft: der Titel misst 18,4 px und hatte 17 px darüber und darunter.

### Der Trenner unter der Kopfleiste ist DURCHGEHEND — und der Titel bekommt keinen

🔴 Owner 04.09.2026: „ich will den komischen unter dem titel nicht haben — SONDERN DEN
DURCHGEHENDEN". Die Kopfleiste trägt ihre Linie **immer** und über die **volle** Breite —
auch wenn ein Menüband folgt, das seine eigene hat. Der **Titel selbst** bekommt nie eine.

💣 **Und die Falle heißt: eine generische Elementregel, die in ein Bauteil hineinreicht.**
Der Titel ist ein `<h2>`; ein `h2 { border-bottom }` aus dem umgebenden Dokument legt damit
eine zweite, **kurze** Linie unter das Wort — im Mockup gemessen 350 von 469 px, eingerückt
und ohne Aussage. Genau daran ist die erste Fassung dieses Abschnitts gescheitert: der Bericht
wurde für die Menüband-Linie gehalten und die **falsche** entfernt.
⭐ Die Lehre gilt über den Trenner hinaus: **wer ein Bauteil zeigt oder baut, hält
Element-Selektoren aus seinem Inneren heraus** — im Mockup per `body > h2`, im Produktivcode
per Klassenregel am Bauteil. Sonst misst man etwas anderes als das, was ausgeliefert wird.

### Das Menüband ist `.avm-tile`, nicht etwas Neues

🔴 Owner 04.09.2026: „bei den kacheln solltest du dich an das typische design der
editor-kacheln halten. nicht wieder was neues machen". `.avm-ribbon` / `.avm-tile` / `.t1` /
`.t2` / `.avm-tile--primary` stehen in `css/components/editor-body.css` und werden
**unverändert** übernommen: Raster mit gleich breiten Spuren, `min-height: 48px`, Titel fett
in `--font-size-body`, Unterzeile in `--font-size-caption`, nur die Haupthandlung gefüllt.

💣 **`:where()` in `:where(.avm-editor-body) button` ist TRAGEND** — es steuert null
Spezifität bei. Ohne die Klammer hat der Selektor (0,1,1) und schlägt `.avm-tile` (0,1,0):
gemessen kollabiert die Kachel von 48px auf 32, verliert ihr Polster und trägt die weiche
Knopffarbe statt `--primary`. Der Kommentar steht seit jeher über der Regel — und der Autor
dieses Abschnitts ist beim Abschreiben trotzdem hineingelaufen. **Eine Regel abschreiben
heißt, sie ganz abzuschreiben**; das Weglassen der scheinbar überflüssigen Klammer war schon
die Divergenz.

### Was die Bauarten unterscheidet — und sonst nichts

|  | Werkzeugfenster | Blatt |
|---|---|---|
| Hülle | `--radius-sm` · `--color-border-strong` | `--radius-lg` · `--color-border` |
| Schließknopf | gefasst (`--color-button-soft` + `-border`), 32×32 | nackt, **ebenfalls 32×32** |
| Einklappen | ja | nein |
| Titelgröße | `--font-size-subhead` | `--font-size-subhead` — **dieselbe** |
| Griff `⁝⁝` | ja | ja — **jedes Fenster trägt ihn** |
| Polster, Trenner, Kacheln, Fuß | identisch | identisch |

- **Die Kopflinie ist `--color-divider`**, nie `--color-border` — wie jede Abschnittslinie.
- **Der Titel ist `--font-size-subhead` (16), in beiden Bauarten** (Owner 04.09.2026: „die
  titelleiste im Blatt sollte dieselbe größe haben wie im fenster"). 15px, 17px und 20px
  fallen ersatzlos weg. Ein Zusatz hinter dem Titel („— Beitrag verfassen") ist Beiwerk in
  `--color-text-muted`, nie Titel.
- **Die Fußleiste hat EINE Rezeptur** für beide Bauarten und für beide Fälle. Rechtsbündig
  entsteht aus `margin-left: auto` an der Hauptgruppe, **nicht** aus einem zweiten
  `justify-content`: gibt es links nichts, rutscht die Gruppe von selbst nach rechts; gibt es
  links Massenhandlungen, bleiben sie links. Ein Modifier „nur rechts" wäre die nächste
  Rezeptur. 💣 Der `gap` steht an der **Leiste**, nicht an den Knöpfen — sonst kleben sie
  aneinander, sobald jemand die Leiste ohne `display: flex` aufbaut (Owner-Befund 04.09.2026).
- **Einklappen kann nur ein Werkzeugfenster**, es **bleibt stehen, wo es steht**, und der
  Knopf ist derselbe gefasste 32×32 wie das ✕ (Glyphe `−` auf, `□` zu). 💣 Ein Selektor
  (`.is-minimized > :not(.<kopfleiste>)`), nie eine Liste der Zonen — eine Liste veraltet
  lautlos, und die nächste Zone stünde eingeklappt sichtbar da.

### Scrollen — Kopf und Fuß stehen, nur der Inhalt läuft

🔴 Owner 04.09.2026: „fenster bei denen ich außerdem scrollen will, sollen nicht über die
volle höhe sondern nur über den inhalt, also alles unter header und über footer scrollen.
schlimmstes beispiel ist ‚Ort bearbeiten', wo ich über alles scrollen muss, um zum speichern
zu kommen und den titel aus den augen verliere".

Die Hülle bekommt `overflow: hidden`, der Rumpf `flex: 1 1 auto; min-height: 0; overflow: auto`.
Damit bleiben Titel und Speichern-Knopf immer im Blick, und die Bildlaufleiste sitzt **im**
Rumpf statt über der Titelzeile.

💣 **`min-height: 0` ist tragend, nicht Kosmetik.** Ein Flex-Kind hat als Vorgabe
`min-height: auto` und schrumpft **nicht** unter seinen Inhalt — ohne die Zeile wächst der
Rumpf über die Fensterhöhe hinaus, `overflow: auto` greift nie, und stattdessen scrollt wieder
die Hülle.

⚠️ Gemessen sind es **drei** Regeln, die es heute falsch machen:
`.location-report-dialog` (rund **14** Fenster, „Ort bearbeiten" darunter), `.avm-modal` und
`.ecosystem-transfer-dialog`. Alle übrigen sind bereits richtig gebaut — es ist kein Umbau,
sondern das Entfernen von drei `overflow-y: auto`.

### Der Griff `⁝⁝`

🔴 **Jedes Fenster ist verschiebbar und trägt den Griff** (Owner 04.09.2026: „Du kannst alle
Fenster dragbar machen. Auch Landschaften bearbeiten und andere hinweise. trotzdem kann das ⁝⁝
bleiben, damit für jeden klar, dass man das verschieben kann"). Es gibt also keine
Unterscheidung „verschiebbar / nicht" mehr.

🔴 **Und er verschwindet, wo nicht gezogen wird — ohne dass jemand etwas setzen muss.**
`js/ui/dialog-drag.js` steigt bei `event.pointerType === "touch"` aus; genau diese Bedingung
steht als `@media (hover: none) and (pointer: coarse)` im Bauteil. Damit kann kein neues Fenster
sie vergessen.

💣 **Keine Klasse `is-draggable`.** Der erste Entwurf verlangte eine, die `dialog-drag.js` hätte
setzen müssen — ein Fenster, bei dem es jemand vergisst, trüge dann keinen Griff, obwohl es sich
schieben lässt, und niemand käme darauf, warum. Und **nicht** an der Bildschirmbreite
(`html.avesmaps-phone`): ein Tablet ist breit *und* tastbedient.

💣 **Die Kopfleiste braucht `user-select: none`** — das kam bislang aus der Sammelregel in
`css/components/dialog-overlays.css`, und die kennt nur `__head`/`-head`. Wer eine Zone nach der
Form benennt, prüft **beide** Erzeuger: den Zieh-Mechanismus *und* seine CSS-Gegenstelle.

🪤 Dieser Absatz stand hier bis zum 04.09.2026 falsch herum — er nannte die verworfene Klasse,
während der Code längst die Media-Query trug. Ein Regelwerk, das einen Mechanismus beschreibt,
den es nicht gibt, lässt die nächste Sitzung etwas bauen, das niemand braucht.

💣 **Kein negatives `letter-spacing`.** Der alte Griff war `⣿⣿` (Braille) und brauchte
`-0.12em`, damit die Blöcke zusammenrücken. Bei `⁝⁝` (U+205D, zweimal) frisst derselbe Wert
den Zwischenraum: im Browser gemessen **4,9 px statt 8,8** — aus zwei Punktspalten wird eine,
und der Griff liest sich als Doppelpunkt. Abgeschriebene Werte überleben den Wechsel ihres
Gegenstands nicht.

### Listen — ein Zeilenmaß für alle

🔴 Owner 04.09.2026: „genauso wie die margins/paddings von listen. jedes sieht anders aus. ich
weiß dass listen unterschiedliche funktionen können/haben, **aber der style sollte einheitlich
sein**". Gemessen: **26** Listenzeilen-Rezepturen mit eigenem Polster — `7px 8px` · `7px 11px` ·
`12px 0` · `9px 0` · `5px 7px` · `6px 9px` · `4px 0`, dazu drei mit hartem
`border-radius: 6px`.

**Die Zeile ist `.avm-row`** (`css/components/editor-row.css`): `--avm-row-pad`, gap
`--space-6`, `--radius-md`, 1px durchsichtiger Rand für den Auswahlzustand, zwei Zeilen
(`__name` fett, `__l2` in `--font-size-caption` gedämpft). Die **Funktion** darf sich
unterscheiden — Statuskreis, Vorschaubild, Aufklapp-Pfeil, Zieh-Griff, Zähler —, das
**Skelett** nicht.

⚠️ Das ist **kein neuer Vorschlag, sondern das Fertigstellen eines angefangenen**: AGENTS.md
§11 sagt seit dem 14.08.2026 „Die Listenzeile — es gibt ZWEI, und das ist die Obergrenze".
Die Regel hat gehalten, wo jemand sie kannte, und sonst nicht.

### Reiter — Unterstrich im Fenster, gefüllter Umschalter auf der Karte

🔴 Owner-Entscheid 04.09.2026: **T3**. Gemessen waren es **neun** Rezepturen in zwei
Grundformen, und dieselben fünf Beschriftungen (Alle · Derographie · Vegetation · Topographie ·
Klimazonen) standen auf der Karte gefüllt und im Landschaften-Editor als Unterstrich.

- **Reiter** — wechselt die *Ansicht* desselben Inhalts **in einem Fenster** →
  `.avm-tabs` / `.avm-tab` (Unterstrich 2px in `--color-text-strong`, aktiv fett,
  Polster `--space-4 1px`).
- **Umschalter** — ist eine *Einstellung* und steht **frei auf der Karte** →
  `.ecosystem-layer-switch` (gefüllt in `--color-button`).

Welche gilt, entscheidet der **Ort**, nicht der Geschmack — dieselbe Bauweise wie Fenster und
Blatt. Die sieben übrigen fallen weg, darunter die zwei mit Guide-Verstößen:
`.wiki-sync-substatus__tab` (Pille `999px`, 12px, `font-weight: 600`) und
`.fs-src-tab` (11,5px).

⚠️ Der Grund, warum der Umschalter gefüllt bleiben **darf**, obwohl `--color-button` sonst die
Haupthandlung ist: er steht nicht in einem Fenster, wo er mit „Speichern" oder „Syncen"
konkurrieren könnte, sondern frei über Kacheln und Wald — dort ist ein 2px-Unterstrich nicht
lesbar. Wer ihn je in ein Fenster holt, macht ihn zum Reiter.

### Wappen und Vorschaubilder in Listen — die Texte stehen bündig

🔴 Owner 04.09.2026: „wenn es wappen/thumbs in einer liste gibt sind die texte bündig
untereinander, d.h. einträge ohne haben abstand nach links." Der Platz wird **reserviert**,
nicht gefüllt.

💣 **Die Breite ist EIN Token** (`--avm-row-bild-w`), den Bild und Platzhalter beide lesen.
Zwei Zahlen wären genau die Divergenz, die die Regel verhindern soll: wer das Bild breiter
macht und den Platzhalter vergisst, bekommt eine Liste, in der die Hälfte der Namen versetzt
steht — sichtbar, aber nicht erklärbar.

🔴 **Die LISTE entscheidet, nicht die Zeile:**
`.avm-list:has(.avm-row__bild) .avm-row:not(:has(.avm-row__bild))::before`. Sobald irgendwo
ein Bild steht, rücken alle Zeilen ein. Als Klasse am Markup wäre es eine Regel, die man
vergessen kann — und man merkt es erst bei der ersten bildlosen Zeile.

⚠️ Die **Höhe** gehört der Liste, nicht dem Bauteil. Am Bestand gemessen (04.09.2026, nicht aus
dem Mockup abgeschrieben — dort standen 62×88 und 48×34, die es nirgends gibt): das Wappen im
Ortseditor ist **22×22** (`.se-row-coat`), das Buchcover **32×45** (`.ae-item__thumb`, hochkant),
die Kartenvorschau **56×40** (`.ce-item__thumb`, quer).

✅ **Die Regel selbst GILT heute schon** — alle drei Listen reservieren den Platz auch ohne Bild
(`.se-row-coat--empty` gestrichelt, sonst ein Platzhalter-SVG im immer vorhandenen `<span>`). Die
Texte stehen also bündig.
🔧 **Offen ist die Zusammenlegung**: `.avm-row` hat bis heute keinen `__bild`-Platz, es sind drei
eigene Rezepturen. Sie zu einer zu machen ändert am Bild NICHTS und fasst drei Editor-Listenbauer
an — das ist ein eigener Durchgang, kein Nebeneffekt.

⭐ Gemessen: ohne die Regel springt die Textkante 58,7 / 20,7 / 58,7 / 20,7 (38px in jeder
zweiten Zeile), mit ihr steht sie viermal auf 58,7. Der `:has`-Preis an **2000 Zeilen**:
41,1 ms mit, 47,5 ms ohne — der Unterschied liegt im Rauschen. Die größte betroffene Liste im
Bestand ist die Literatur mit 2.003 Einträgen.

### Die Bildlaufleiste gehört dem FENSTER, nicht dem Dokument

⚠️ Fünf Rezepturen in zwei Formen, und der Unterschied ist **dokumentbasiert, nicht gewollt**:
`base.css` (7px, `--radius-sm`, ohne Rand) gilt in `index.html` — also für die Karte **und
alle ihre Fenster**; `editor-page.css` (10px, Pille, 2px Rand) gilt in den vier Editor-iframes.
`lore.css` und die zwei `political-territory-editor*`-Dateien tragen **drei Abschriften** der
zweiten, per ID gescoped — sie existieren **nur**, weil ihre Fenster in `index.html` leben und
`base.css` sie sonst auf 7px zieht.

⭐ **Eine Regel am Fenster** (`.avm-fenster *::-webkit-scrollbar`, 10px, Pille, 2px Rand in der
Track-Farbe) — dann sieht ein Fenster gleich aus, egal wo es lebt, und die drei Abschriften
fallen ersatzlos weg. Der Rand ist in der Track-Farbe, nicht transparent: er schneidet den
Daumen optisch schmaler, ohne die Trefferfläche zu verkleinern.

🔧 **Offen:** ob die **Seite selbst** (Karte, Infopanel, Routenplaner) bei 7px bleibt oder
mitzieht. Das ist für jeden Besucher sichtbar und braucht einen eigenen Entscheid.

### Der Listenkopf — die Zeile über der Liste

🔴 Owner 04.09.2026: „über listen seh ich auch immer wieder so fehlerchen und inkonsistente
header (falsch hier: Meldungen)". Gemessen: **40** Rezepturen für die Zeile über einer Liste
(Zähler · Filter · Suche · Aktionen).

Der Listenkopf trägt `--avm-status-pad` (6/14); **links** der Zähler in
`--font-size-caption` / `--color-text-muted`, **rechts** die Aktionen — jede als Symbolknopf
`--avm-control-h` im Quadrat mit `--radius-md` und weichem Umriss, dieselbe Form wie das ✕ im
Fenster. Damit stehen Filter und Neu-laden gleich hoch nebeneinander.

💣 Der **Neu-laden-Knopf** existiert zweimal in zwei Formen, und die aus „Meldungen"
(`.review-panel__refresh-btn`) verstößt gegen **vier** Regeln dieses Guides: `15px` steht auf
keiner Skalenstufe · `--radius-sm` ist die Hülle, **alle Bedienelemente** sind `--radius-md` ·
`--color-link` gehört Links, nicht Knopfglyphen · `padding: 1px 9px` erreicht die Bedienhöhe
nicht (~19px statt 32). Die aus „Mails" (`.mail-inbox__refresh`) ist nackt und 16px — näher
dran, aber ohne Trefferfeld.

⚠️ Allein für „n Einträge neben einer Liste" stehen **sechs** Größen im Bestand:
`--font-size-caption` · `--font-size-small` · `12px` · `13px` · `11,5px` · `11px`.
Es bleibt `--font-size-caption`.

### Ein Bauteil, nicht dreizehn Abschriften

⭐ Kopfleiste und Schließknopf bekommen je **eine** Rezeptur, die alle Fenster benutzen — so
wie `dialog-drag.js` es beim Verschieben längst macht. Ohne das ist die Reihe in einem halben
Jahr wieder krumm; genau das hat dieses Repo bei den Listenzeilen (sieben Rezepturen), der
Wiki-Zuweisung (sechs Fassungen) und dem Reichweiten-Rahmen (vier) schon dreimal bezahlt.

## Component rules

- **Text colour by role — one token per role, never per element.** Pick a text
  colour from the element's *role* and use that token everywhere; don't invent a
  shade for one spot. Primary / content text → `--color-text`; secondary &
  explanatory prose, captions, meta, table / axis labels → `--color-text-muted`;
  titles, emphasised labels, inline emphasis → `--color-text-strong`; section /
  card headings → `--color-accent-strong` (gold). Two colours for the same role in
  one view is the bug — an intro paragraph darker than a later one, or a table's
  two header axes drawn differently (the speed-info dialog did both).
- **Button hierarchy.** The main action is *filled* (`--color-button` /
  `--color-button-text`); everything else is *soft/outline* (`--color-button-soft`
  + `--color-button-soft-border`). Radius `--radius-md`. No pill/`999px` shapes.
- **Button states** (both tiers): **hover** shifts to `--color-button-hover` /
  `--color-button-soft-hover` with a 1px lift + slightly stronger shadow;
  **active/pressed** drops to `--color-button-active` / `--color-button-soft-active`
  with an inset shadow and no lift; **focus-visible** adds the focus ring
  **composed with** the element's own shadow — `box-shadow: var(--focus-ring),
  <elevation>`, never `var(--focus-ring)` alone (that would drop the elevation) — a
  warm gold glow, never the blue UA ring; set `outline: none` alongside it;
  **disabled** uses
  `--color-disabled-bg` / `-text` / `-border` with no shadow and
  `cursor: not-allowed` — use sparingly, prefer keeping actions enabled.
- **Action-button tiles (infobox).** In the settlement infobox — floating map box
  *and* right panel — the action buttons are **square icon tiles**, not inline
  pills: icon **centred on top**, label **centred below** (`flex-direction: column`
  + centre both axes), fixed size (`width: 90px; min-height: 60px`), label may wrap,
  the bar wraps to a new row on overflow. Icons sit in a centred slot sized to the
  icon: full-colour **image icons** (the aventurian `img/menu/*.webp` set) render
  **36×36** (`.location-popup__action-img`); emoji/glyph placeholders keep a smaller
  box (`.location-popup__action-icon`). The **tile may grow to fit the icon — but keep
  it moderate** (≈36px icon in the ~90×60 tile); don't oversize the tile chasing a
  bigger icon. The flex row (`align-items: stretch`) equalises tile heights, so a
  mixed row (image icon next to a `+`/🔗 placeholder) still lines up. Fill hierarchy still holds (main action
  filled, rest soft); the tile row is framed by dividers (header divider above,
  section divider below). Exception: the inline "Bewertung schreiben" in the rating
  row stays a normal inline button. Impl: `.floating-location-popup` /
  `.avesmaps-infopanel .location-popup__action-button` in `location-popups-markers.css`.
- **Selection wash.** Hoverable/selectable rows (route entries, combobox options,
  marker toggles) tint with `--color-hover-wash` (hover) and `--color-active-wash`
  (selected), plus a `--color-border-strong` edge — not a filled-button look. This
  replaces the old bright-yellow `rgba(255,216,88,…)` washes.
- **Group by divider, not by box.** Separate sections with a `--color-divider`
  line + heading — do **not** wrap each section in a framed panel (dense panels
  like the infobox turn into a box-stack). This is a **grouping-style change**
  (framed box → line + heading), **not a layout restructure**: the controls and
  their order stay exactly where they are; only the box chrome (bg + border +
  radius) turns into a divider + heading. E.g. the route planner's
  Transportmittel / Routenoptionen boxes become divider-grouped *in place*.
- **Peer sections share one grouping treatment.** Divider-grouping stays the
  default; cards are the exception for self-contained blocks (menus, autocomplete,
  the route result, the speed-info travel cards). But within one set of sibling
  sections, pick **one** treatment for all — never mix carded and bare peers (the
  speed-info dialog had Fluss-/Meerreise as cards but Landreise bare). And one role
  uses **one class**, not two (a card title styled by both `.tsi-section` and
  `.tsi-wtitle` was a duplicate).
- **Reichweiten-Rahmen (`.fs-scope`) — die EINE Ausnahme vom Kasten-Verbot, und sie
  hat GENAU EINE Rezeptur.** Wo ein Formular Felder trägt, die **verschieden weit
  wirken**, wird jede Reichweite umrahmt und die Aufschrift sitzt AUF dem Rahmen.
  Der Rahmen sagt hier nicht „das gehört zusammen“ (dafür gibt es die Trennlinie
  eine Zeile weiter oben), sondern **„bis hierher reicht, was du änderst“** — und
  genau dafür ist eine Linie zu schwach. Owner 02.09.2026.
  - **Ein Bauteil, nie abgeschrieben.** `avesmapsSourceScopeFrame()` +
    `.fs-scope` / `__head` / `__title` / `__reach` / `__fields`. Wer einen zweiten
    Rahmen braucht, ruft es; wer die Werte kopiert, baut die Divergenz.
    💣 Genau das ist am 02.09.2026 passiert: **vier** Rezepturen für eine Form
    (`.fs-adresse`, `.fs-eintrag`, `.fs-korpus`, `.fs-edit__group`), im Browser
    gemessen 10px/normal gegen 11px/fett, 8px gegen 10px Polster, solid gegen
    dashed — und in **zwei** von ihnen stand mein eigener Kommentar „dieselben
    Werte wie `.fs-korpus`, eine zweite Rezeptur wäre die Divergenz“. Die Warnung
    hinschreiben ersetzt das Bauteil nicht. Dieselbe Lehre wie bei der Listenzeile
    (sieben Rezepturen) und der Wiki-Zuweisung (sechs Fassungen), AGENTS.md §11.
  - **Anlegen und Bearbeiten sind DASSELBE Formular.** Gleiche Reichweiten,
    gleiche Namen, gleiche Reihenfolge, gleiche Form — der einzige Unterschied ist,
    was schon ausgefüllt ist. ⚠️ Zwei Formulare, in die man dasselbe eintippt und
    die verschieden aussehen, sind der Fehler, nicht der Sonderfall.
  - **Eine Kontur, kein Vokabular aus Konturen.** Durchgezogen überall.
    🚩 Der Versuch, `solid` „hier fängst du an“ und `dashed` „so weit reicht es“
    bedeuten zu lassen, war eine erfundene Bedeutung, die niemand liest — sie hat
    nur die zwei Formulare verschieden aussehen lassen.
  - **Die Aufschrift ist 11px/700/Versalien** in `--color-accent-brown` (11px ist
    die Untergrenze aus §Typography; die Eingabezeile stand auf 10). Eine
    **Reichweitenangabe** daneben („40 Quellen · 51 Objekte“) ist 11px/400,
    `--color-text-muted`, **ohne** Versalien — ein Eigenname in Versalien
    („ALBERNIAWIKI“) liest sich wie eine Kennung.
  - **Nichts im Rahmen darf seiner Aufschrift widersprechen.** Ein Bedienelement
    „nur diese Quelle“ im Rahmen „Gilt für den ganzen Korpus“ hebt die Aufschrift
    auf. Eine Ausnahme gehört an den **Fuß** des Rahmens, einmal und benannt, nie
    je Feld wiederholt.
  - **Die Knopfleiste ist in beiden gleich:** Haupthandlung *gefüllt*, Rest
    *weich*, `--radius-md`, und sie heißt **„Speichern“** — nicht „Hinzufügen“,
    „Verknüpfen“ oder was der Zustand gerade tut. Der Zustand steht in der
    Rückmeldung, nicht auf dem Knopf.
- **`border` vs `divider` are not interchangeable.** `--color-border` is for
  *control and panel edges* (solid hairline); `--color-divider` is for *section
  separators inside a panel* (soft). A section line is **always** the divider —
  the infobox header line uses the divider, not the border.
- **Divider mechanics (hard rules):** exactly **one** 1px line per section, never
  doubled; always **full-bleed** — negative side-margin equal to the container's
  horizontal padding, so the line runs edge to edge; **symmetric** spacing above
  and below via `--divider-gap` (reading sections, e.g. infobox) or
  `--divider-gap-tight` (dense control groups, e.g. route planner). After any
  width or padding change, **measure the line and screenshot it.**
- **Symmetric insets — left gap equals right gap.** A control/row sits the same
  distance from its container's left edge as from the right. Common breakages: a
  control narrower than its grid cell, or fixed grid tracks whose `gap` makes
  `col1 + gap + col2` exceed the content width so the last column overflows the
  right inset. Fix with a flexible track (`minmax(0,1fr)`) and let the control fill
  it; after any layout change, **measure both insets — they must match.**
- **Links** use `--color-link`; **hover** → `--color-link-hover` with a thicker
  underline; **focus** the shared `var(--focus-ring)`. Never blue.
- **External links carry a trailing `↗`.** Any link that leaves the site (Wiki
  Aventurica, source URLs, publication links, any off-domain target) **always**
  gets a trailing `↗` (U+2197) so it's clear it opens elsewhere; in-app /
  same-site links do **not**. Apply it once — a shared external-link treatment or
  an auto `a[href^="http"]:not([href*="avesmaps"])::after { content: " ↗"; }` —
  never hand-typed per link, so it stays consistent everywhere.
- **Long words hyphenate — they don't hard-break.** Flowing text and names (settlement
  name / type / description, territory + region title / subtitle, attribute values) use
  `hyphens: auto` + `overflow-wrap: break-word`, so long German compounds break at syllable
  boundaries with a soft hyphen instead of mid-word. Relies on `<html lang="de">` (set).
  Where the browser ships no hyphenation dictionary (Electron, in-app webviews) it falls
  back to the clean hard break — never worse than before (pure progressive enhancement).
  Apply to prose / names only — never buttons, pills, numbers, codes, or `dt` labels.
- **No blue = UI chrome only.** The no-blue rule covers panels, controls, links and
  menus. Three deliberate, code-commented exceptions stay and must **not** be
  "corrected": the *edit-in-progress* handles (path-edit dots,
  `REGION_EDIT_EDGE_COLOR`), the analytics chart's categorical data palette
  (`#2a78d6` / `#4a3aa7`), and the **water tones of the Landschaften layer**
  (`--color-ecosystem-topographie-see` / `-meer` / `-kueste`, plus the blue-green
  `-vegetation-tundra`) — they encode state / data, not chrome. Water in warm brown
  is unreadable to anyone who has ever looked at a map, and the map's own rivers
  have been blue all along.
- **Selects / inputs**: `--color-panel` background (flat — never the native grey
  browser control), `--color-border` + `--radius-md`; **hover** →
  `--color-border-strong`; **focus / open** → border-strong + `var(--focus-ring)`;
  **disabled** → the disabled tokens; placeholders use `--color-placeholder`.
  Combobox options tint with the selection wash.
- **Filters above sorting.** In a control bar that carries both, the filter row
  sits **above** the sort row — filtering narrows the set, sorting orders what
  remains (standard UI convention). The sort row is prefixed with a muted
  `Sortierung:` label. The adventures "Alle anzeigen" dialog stacks its controls
  as view toggle → filter bar → sort row.
- **Pills** (publication tags, counts): `--color-pill*`, `--radius-md`.
- **Panels** stay white with mirrored `--radius-sm` corners + shadow — already good.
- **Icons — two classes.** *UI glyphs* (add, remove, close, chevron, arrows, drag,
  zoom) are monochrome, **one consistent outline style**, drawn in `currentColor`
  so they follow text + theme — they may also take `--color-text-muted` or
  `--color-accent`, never a new colour; sizes `--icon-sm` (dense inline) /
  `--icon-md` (standard). Stop mixing CSS shapes and unicode characters — settle on
  one outline set. *Content imagery* (settlement-type icons, transport icons,
  region icons, coats of arms) are the **existing full-colour assets** — keep and
  reuse them **frameless** (no surrounding tile, background, or border — the icon
  sits directly in its row or header), `object-fit: contain`, decorative ones
  `pointer-events: none`; they are **never** recoloured to currentColor. Canonical sizes: `--icon-lg` 24
  (inline / transport), `--icon-xl` 40 (map-display type toggles), `--icon-2xl` 48
  (infobox type fallback), `--icon-hero` 130 (coat / logo).

## Route & waypoint markers

The waypoint timeline is a drag-grip + a column of connected markers (hollow
circles in `--color-text-muted` joined by a dotted line) + an input + a remove
control. The **destination pin** (last waypoint) uses `--color-marker-destination`
— a heraldic red matching the red map location markers. This red is the *one*
intentionally saturated accent; everything else stays in the warm-brown / gold
family. Route legs (`route-plan-entry`) are quiet rows that use the selection wash
(hover / active), never a framed box.

## Building something new

Reach for the tokens above and the nearest existing component as a template;
match the warmth and the divider-not-box grouping. If you need a colour that
isn't a token yet, **add the token** — don't invent a literal.
