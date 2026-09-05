# Kontrastaudit — das helle Gold und das Knopfpaar

**Stand: 2026-08-13.** Anlass: ein `usability-design`-Review der Lebensraum-Regel (Task 7,
`js/review/review-lore-rule.js` / `css/features/lore.css`) meldete zwei Kontrastbefunde. Beide
sind nachgerechnet — und beide sind **keine Befunde dieser Sitzung**, sondern Eigenschaften
zweier Token aus `css/base/tokens.css`, die app-weit wirken.

**🔧 Dieses Dokument ändert nichts.** Es rechnet und legt dem Owner zwei Entscheidungen vor.

---

## ✅ Entscheidung zu Befund 1 — Owner 05.09.2026 („ja")

**Umgesetzt, aber eine Stufe tiefer als hier empfohlen: `--color-accent-strong: #7e651d`,
`--color-link: #79611b`** (Commit vom 05.09.2026).

💣 **Die Prämisse von §4.1 war beim Umsetzen bereits überholt.** Das Audit empfahl `#82681e` und
zählte dafür die Flächen, auf denen im August nachweisbar Gold-*Text* stand — `--color-button-soft`
war keine davon. Seit dem **04.09.2026** ist sie eine: die zugeklappte Leiste des Rahmenkastens
trägt ihre Aufschrift darauf (Routenplaner). Dort hätte `#82681e` nur **4,39** gegeben. `#7e651d`
misst **5,49 / 5,17 / 4,90 / 4,73 / 4,73 / 4,61** auf panel / -soft / page-bg / -muted / pill /
button-soft — alle sechs über AA.

⭐ **Die Lehre daraus steht jetzt als Test:** eine Kontrastzahl gilt einer **Paarung**, nicht einer
Farbe. Wer eine Aufschrift auf eine neue Fläche setzt, macht eine bestandene Messung ungültig, ohne
die Farbe anzufassen. `js/app/__tests__/goldkontrast.test.js` misst deshalb beide Goldtöne gegen
**alle sechs** Flächen bei jedem Lauf — und zusätzlich die Ordnung Aufschrift > Link > Hover.

⚠️ **Nicht umgesetzt, bewusst:** `--color-panel-active` (#e7ddc9) bleibt mit 4,14 darunter — dort
steht laut §2 kein Gold-Text. Und `.wp-dist__seg--4` hat **keinen** eigenen Wert bekommen, obwohl
§4.1 das verlangt: der Balken ist seit dem Audit als **tot** nachgewiesen (er steht nur in
`css/pages/wege-editor.css` und im Mockup, in keinem Markup und keinem JS). Sein Abstand zu
`--seg--5` fällt damit rechnerisch von 1,63 auf 1,12 — sichtbar für niemanden. Wer den Balken je
belebt, pinnt vorher beide Segmente.

**Befund 2 (Knopfpaar) bleibt offen** — dazu gab es keine Entscheidung.

---

## 1. Verfahren

WCAG 2.1, Relativluminanz nach sRGB-Formel, keine Alpha-Verrechnung (alle beteiligten Werte
sind deckend). Gemessen gegen die echten Hexwerte aus `css/base/tokens.css`, beide Themes.

Maßstäbe:

| Kriterium | verlangt | gilt für |
|---|---|---|
| 1.4.3 Kontrast (Minimum) | **4,5:1** | Normaltext |
| 1.4.3, Großtext | 3:1 | ≥ 24 px, **oder** ≥ 18,66 px **fett** |
| 1.4.11 Nicht-Text-Kontrast | 3:1 | Bedienelement-Grenzen, Zustandsanzeigen, bedeutungstragende Grafik |

💣 **`--font-size-subhead` (16 px) fett ist KEIN Großtext.** Die Schwelle liegt bei 18,66 px
fett. Sämtliche Gold-Überschriften des Hauses stehen auf 15–16 px und schulden damit die
vollen 4,5:1 — nicht 3:1.

## 2. Befund 1 — `--color-accent-strong` auf hellen Flächen

### Die Zahlen

Hell, `#9c7f22`, gegen jede Fläche, auf der es im CSS tatsächlich steht:

| Fläche | Hex | Kontrast | 4,5:1? |
|---|---|---|---|
| `--color-panel` | `#fffdf9` | **3,78:1** | ✗ |
| `--color-panel-soft` | `#faf6ee` | **3,56:1** | ✗ |
| `--color-page-bg` | `#f3f0e8` | **3,37:1** | ✗ |
| `--color-panel-muted` | `#f1ece1` | **3,26:1** | ✗ |
| `--color-pill` | `#f3ecd9` | **3,25:1** | ✗ |
| `--color-button-soft` | `#efe9db` | **3,17:1** | ✗ |
| `--color-panel-active` | `#e7ddc9` | **2,85:1** | ✗ |

🔴 **Keine einzige helle Fläche des Hauses erreicht 4,5:1.** Damit ist die Fläche für das
Urteil gleichgültig: jede Gold-Textstelle im hellen Theme fällt durch, egal wo sie steht.
Die Spanne 2,85–3,78 entscheidet nur noch darüber, *wie weit* nachgeschärft werden muss.

Dunkel, `#dcc77e`: 5,59:1 (auf `--color-panel-active`) bis 9,82:1 (auf `--color-page-bg`).
**Im dunklen Theme ist nichts zu tun.**

Zum Vergleich auf `--color-panel`: `--color-text` 14,50 · `--color-text-strong` 12,19 ·
`--color-text-muted` 5,60 · **`--color-link` 4,45** · `--color-accent` 2,49 (steht nie als Text).

⚠️ **`--color-link` verfehlt AA um 0,05.** Dieselbe Farbfamilie, derselbe Fehlermodus — und es
ist der Grund, warum Befund 1 nicht allein an `--color-accent-strong` repariert werden kann
(siehe §4.1).

### Die Fundstellen

`--color-accent-strong` steht an **51 Deklarationen** in 19 CSS-Dateien (+ 7 Kommentare,
2 Definitionen). Davon 40 × `color:`, 6 × Rahmen, 2 × `background:`, 3 × `fill`/`stroke`.

**Text — fällt unter AA (35 Stellen, alle im hellen Theme):**

| Datei:Zeile | Selektor | Größe |
|---|---|---|
| `css/components/changelog-dialog.css:88` | `.changelog-month` | 16 px fett |
| `css/components/editor-page.css:396` | `.avm-col__title` | 16 px fett |
| `css/components/editor-page.css:663` | `.pl-hint b` | geerbt |
| `css/components/legal-dialog.css:128` | `.legal-action__title` | 15 px fett |
| `css/components/legal-dialog.css:293` | `.legal-dialog__group` (das `<summary>`) | 15 px fett |
| `css/components/legal-dialog.css:475` | `.pipeline-figure__box--last .pipeline-figure__label` | 14 px (SVG-Text) |
| `css/components/location-report-dialog.css:129` | `.report-section__title` | 11 px fett |
| `css/components/location-report-dialog.css:365` | `…__service-note` | 12 px |
| `css/components/map-display-menu.css:139` | `.map-display-menu__title` | 11 px fett |
| `css/components/region-sync.css:1167` | `.capital-list__ambiguous` | 11 px kursiv |
| `css/components/source-autocomplete.css:70` | `.sac-name mark` | 12 px fett |
| `css/components/source-autocomplete.css:83` | `.sac-badge--official` | 10 px |
| `css/features/feature-sources.css:186` | `.fs-add-picked` | 11 px auf `-muted` → 3,26 |
| `css/features/feature-sources.css:249` | `.fs-src-star` | Stern-Glyphe |
| `css/features/feature-sources.css:317, :321` | `.fs-src-tab.is-active`, `… .fs-src-n` | geerbt |
| `css/features/lore.css:358` | `.lore-dlg__coltitle` | 16 px fett |
| `css/features/lore.css:609` | `.lore-detail__section:first-child` | 16 px |
| `css/features/lore.css:713` | `.lore-detail__rule-and`, `…__rule-or-tag` | 11 px fett |
| `css/features/lore.css:900` | `.lore-rule-joiner__select` | 11 px fett |
| `css/features/lore.css:964` | `.lore-rule-token` | 12 px auf `-muted` → 3,26 |
| `css/features/lore.css:1104` | `.lore-rule-sentence b` | geerbt |
| `css/features/lore.css:1142` | `.lore-rule-hits__count` | 12 px fett ← **der gemeldete** |
| `css/features/place-extras.css:204` | `.avesmaps-adv__placeholder` | 10,5 px |
| `css/features/route-options-info.css:77` | `.roi-tag--search` | geerbt |
| `css/features/route-options-info.css:108` | `.roi-table th:first-child` | geerbt |
| `css/features/transport-speed-info.css:145` | `.tsi-matrix th.tsi-corner` | geerbt |
| `css/features/transport-speed-info.css:235` | `.tsi-wtitle` | 12 px fett |
| `css/features/transport-speed-info.css:333` | `.tsi-sources b` | geerbt |
| `css/pages/landschaften-editor.css:84` | `.eco-partner__share` | geerbt |
| `css/pages/political-territory-editor.css:1593` | `.manual-data-section h3` | geerbt |
| `css/pages/political-territory-editor-inline.css:1597` | dieselbe Regel (💣 **Bauprodukt**, siehe AGENTS §10) | geerbt |
| `css/pages/wege-editor.css:76` | `.wp-share__value` | geerbt, fett |
| `css/pages/wege-editor.css:105` | `.wp-facts dd b` | geerbt, fett |
| `css/pages/wege-editor.css:131` | `.wp-fn h3` | 16 px fett |
| `css/pages/wege-editor.css:193` | `.wp-tab-num tr.is-reference td` | 13 px fett |

**Besteht — Großtext (3:1 genügt):**
`css/pages/wege-editor.css:210` `.wp-c__value` — 30 px fett auf `--color-panel-soft`, 3,56:1 ✓

**Besteht — Glyphe/Icon, kein Text (1.4.11, 3:1 genügt):**
`transport-speed-info.css:85` `.tsi-i` (ⓘ, `aria-hidden="true"`) · `map-display-menu.css:232`
`__eye` (SVG) · `place-extras.css:66` `…__thumb:hover` · `landschaften-editor.css:133`
`.eco-thumb` — je 3,56–3,78:1 ✓

**Besteht — Rahmen, Füllung, Zustandsanzeige (1.4.11, 3:1 genügt):**
`feature-sources.css:316` (Aktiv-Reiter) · `route-options-info.css:76` ·
`lore.css:711, :897, :961, :1098` · `legal-dialog.css:330` (das Aufklapp-Dreieck) ·
`legal-dialog.css:466` (SVG-`stroke`) · `wege-editor.css:100` `.wp-dot` ·
`tokens.css:444` `--color-check-accent` (Häkchen + Rahmen) — je 3,26–3,78:1 ✓

⚠️ **Eine Ausnahme, unabhängig von allem hier:** `wege-editor.css:181` `.wp-dist__seg--4` ist
ein Balkensegment einer *sequenziellen* Rampe. Gegen seinen Nachbarn `--seg--5`
(`--color-accent-brown` `#7a5a3a`) steht es **heute schon bei 1,63:1** — unter den 3:1, die
1.4.11 für benachbarte bedeutungstragende Grafik verlangt. Das ist ein bestehender Mangel,
keine Folge einer Änderung, und §4.1 macht ihn schlimmer.

## 3. Befund 2 — `--color-button` gegen `--color-button-soft`

### Die gemeldeten Zahlen stimmen

Dunkel: Füllung `#6b6456` gegen `#3a362c` = **2,05:1**, Rahmen `#7a7361` gegen `#585142` =
**1,67:1**. Beides nachgerechnet und bestätigt.

### Das Kriterium stimmt nicht

💣 **1.4.11 vergleicht ein Bauteil mit seinem HINTERGRUND, nicht zwei Bauteile miteinander.**
„Gefüllt neben weich" ist eine *Rangfolge* — die regelt WCAG gar nicht. Was WCAG regelt, ist
die Erkennbarkeit jedes einzelnen Knopfs, und die Beschriftung beider Knöpfe besteht in
beiden Themes:

| | hell | dunkel |
|---|---|---|
| Text auf gefüllt | 6,47:1 ✓ | 4,95:1 ✓ |
| Text auf weich | 7,04:1 ✓ | 9,27:1 ✓ |

### Die Zahl, die wirklich zählt — und sie ist größer als gemeldet

Gegen `--color-panel`, die Fläche, auf der diese Knöpfe stehen:

| | hell | dunkel |
|---|---|---|
| gefüllte Füllung | 7,28:1 ✓ | **2,31:1 ✗** |
| gefüllter Rahmen | — | **2,87:1 ✗** |
| weiche Füllung | **1,19:1 ✗** | **1,13:1 ✗** |
| weicher Rahmen | **1,82:1 ✗** | **1,72:1 ✗** |

🔴 **Der weiche Knopf hat in BEIDEN Themes keine wahrnehmbare Grenze** — das ist kein
Dunkelmodus-Problem und erst recht keines der Lebensraum-Regel. Im dunklen Theme hat auch der
gefüllte keine. Das Tokenpaar trägt die „eine gefüllte Handlung, Rest weich"-Konvention aus
AGENTS §12 und steht in **15 CSS-Dateien**: `editor-page`, `legal-dialog`,
`location-report-dialog`, `sync-plan-sheet`, `ecosystem-layer`, `location-popups-markers`,
`lore`, `place-extras`, `review-panel`, `route-planner`, `admin`, `db-backup`, `edit`,
`political-territory-editor`(+`-inline`).

⚠️ Ob das ein AA-Verstoß *ist*, hängt an der Lesart von 1.4.11: wird ein Knopf durch seine
Beschriftung erkannt, verlangt die Norm keine Rahmenschwelle; ist der Rahmen die einzige
Anzeige, verlangt sie 3:1. Beide Knöpfe hier tragen Text. Die strenge Lesart lässt fast alles
durchfallen, die milde nichts. **Das ist eine Hausentscheidung, keine Rechenaufgabe.**

### Und die Rangfolge, als reine Designbeobachtung

Der Abstand gefüllt↔weich beträgt hell **6,11:1**, dunkel **2,05:1**. Das „eine gefüllte
Handlung"-Signal ist im dunklen Theme messbar dreimal schwächer. Hell ist der Hauptknopf ein
dunkler Block auf weißem Grund (7,28:1 zur Fläche); dunkel ist er ein leicht hellerer Block
auf dunklem Grund (2,31:1).

💣 **Und er lässt sich nicht einfach aufhellen.** `--color-button-text` `#f5ebd7` auf
`#6b6456` steht bei 4,95:1 — 0,45 über AA. Schon `#827a67` (Füllung 3,18:1 zur Fläche) drückt
die Beschriftung auf 3,60:1 und damit unter AA. Füllung und Schrift müssen gemeinsam wandern
oder gar nicht.

## 4. Empfehlung

### 4.1 Gold: das Token nachschärfen, nicht 35 Ausnahmen bauen

35 Fundstellen einzeln auszunehmen wäre genau die Divergenz, vor der AGENTS §12 warnt — und
die nächste Gold-Überschrift, die jemand schreibt, wäre wieder falsch. Der Wert gehört ins
Token.

Kandidaten (hell), gemessen auf allen Flächen, die Gold-Text wirklich trägt:

| Kandidat | panel | soft | page-bg | muted | pill | button-soft |
|---|---|---|---|---|---|---|
| `#9c7f22` (heute) | 3,78 | 3,56 | 3,37 | 3,26 | 3,25 | 3,17 |
| `#866c1f` | 4,95 | 4,66 | 4,41 | 4,27 | 4,26 | 4,15 |
| **`#82681e`** | **5,24** | **4,93** | **4,67** | **4,52** | **4,51** | 4,39 |
| `#7e651d` | 5,49 | 5,17 | 4,90 | 4,73 | 4,73 | 4,61 |

`#82681e` deckt alle Flächen ab, auf denen Gold-Text im CSS nachweisbar steht
(`panel`, `-soft`, `page-bg`, `-muted`, `pill`). `#866c1f` reicht nur für `panel`/`-soft`.

**Was die Änderung sonst noch anfasst — durchgerechnet:**

- **Alle 15 Nicht-Text-Stellen** (Rahmen, Häkchen, Dreieck, SVG-Strich, Punkt, Icon-Glyphen) steigen von
  3,26–3,78 auf 4,4–5,2. Kein Verlust.
- **Keine Textumkehr-Gefahr:** `--color-accent-strong` steht an genau zwei Stellen als
  `background` (`legal-dialog.css:330` Dreieck, `wege-editor.css:181` Balken) — **auf keiner
  davon steht Text**. Dunkler machen kann hier nichts brechen.
- 💣 **`--color-link` muss mitwandern.** Heute ist Link (`#8f7326`, 4,45:1) minimal dunkler
  als Gold (`#9c7f22`, 3,78:1). Mit `#82681e` wäre Gold dunkler als der Link — die Rampe
  kippt, und der Link bliebe als einziges Textgold unter AA. Vorschlag: `#8a6f20`
  (4,72:1 auf `panel`, 4,45:1 auf `-soft`) oder gleich mit auf denselben Wert.
- 💣 **`.wp-dist__seg--4` braucht einen eigenen, festgenagelten Wert.** Gegen `--seg--5`
  (`#7a5a3a`) fällt es von heute 1,63:1 auf **1,18:1** — die letzten beiden Stufen der
  sequenziellen Rampe wären nicht mehr zu unterscheiden. Präzedenzfall steht in `tokens.css`:
  Diagrammfarben und Kartenmarker sind eigene, festgenagelte Token, weil sie Daten codieren
  und nicht Chrom. Das Segment gehört in dieselbe Klasse.
- **Dunkel: nichts anfassen.** `#dcc77e` steht zwischen 5,59 und 9,82.

🔧 **DU entscheidest:** (a) `#82681e` — alle Flächen ≥ 4,5, das Gold wird sichtbar
erdiger/bronzener; oder (b) `#866c1f` — näher am heutigen Ton, aber `-muted`/`pill`/`button-soft`
bleiben bei 4,15–4,27 knapp darunter; oder (c) es bleibt wie es ist, mit der bewussten
Feststellung, dass die Gold-Beschriftungen des Hauses AA nicht erfüllen.

### 4.2 Knöpfe: die Füllungen in Ruhe lassen

Die Füllungen tragen die Designsprache und stehen in 15 Dateien; sie anzufassen ist ein
Redesign, kein Kontrastfix. Wenn die Grenze kommen soll, kommt sie über die **Rahmen** — das
ist die einzige billige Stellschraube:

| Token | heute | Vorschlag | zur Fläche |
|---|---|---|---|
| hell `--color-button-soft-border` | `#cdbda0` (1,82) | `#948a76` | **3,36** (auf `-soft`: 3,16) |
| dunkel `--color-button-soft-border` | `#585142` (1,72) | `#8b8170` | **3,53** (auf `-soft`: 3,24) |
| dunkel `--color-button-border` | `#7a7361` (2,87) | `#807865` | **3,09** |

⚠️ **Das ist eine sichtbare Änderung an jeder Oberfläche des Hauses** — jeder Nebenknopf
bekommt eine deutlich dunklere Kontur. Nach AGENTS §9: ein Commit, ein Push, dein Blick.

Für die *Rangfolge* im Dunkeln (2,05 gegen 6,11 im Hellen) gibt es nur einen Weg, und der ist
ein Entwurf, keine Zahlenkorrektur: ein **goldener Hauptknopf mit dunkler Schrift**
(`--color-accent` `#cfb767` auf Panel = 6,86:1, Schrift `#241d14` darauf = 8,42:1). Das wäre
ein Bruch mit „Hauptaktion gefüllt in `--color-button`" aus §12 — nur auf ausdrückliche
Ansage.

### 4.3 Für die Lebensraum-Regel selbst: nichts zu tun

`.lore-rule-hits__count` ist kein Fehler aus Task 7, sondern die 35. Instanz eines
Token-Werts von 2026. Eine Ausnahme allein in `lore.css` würde die Datei aus der Designsprache
herauslösen und den Rest des Hauses unrepariert lassen.

## 5. Nachrechnen

Die Zahlen stammen aus einem Skript, kein Augenmaß. Wiederholbar in drei Zeilen:

```js
const s = c => (c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const L = h => 0.2126 * s(parseInt(h.slice(1, 3), 16)) + 0.7152 * s(parseInt(h.slice(3, 5), 16)) + 0.0722 * s(parseInt(h.slice(5, 7), 16));
const K = (a, b) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);
```
