# Editoren am Telefon — Übergabe aus der zurückgebauten Sitzung (13.09.2026)

> Diese Sitzung hat den Territorien-Sync-Monitor allein für das Telefon umgebaut, live geschickt und
> auf Owner-Entscheid **wieder zurückgebaut**. Was bleibt, ist die Messung und der Grund. Der
> Auftrag für die Nachfolge steht in
> **`docs/superpowers/plans/2026-09-13-editoren-mobil-prompt.md`**.

## 1. Warum zurückgebaut

Owner, 13.09.2026, nach dem dritten Blick aufs Telefon:

> „dann macht ein einziger umbau für telefone keinen sinn. du brauchst ein generelles konzept alle
> editoren für mobil geräte zu optimieren"

Und die Richtungsentscheidung, die den gebauten Ansatz ersetzt:

> „die idee ist dass das 3 spalten layout generell nicht nebeneinander sondern untereinander steht"

🔴 **Damit ist die Reiter-Lösung dieser Sitzung verworfen** — nicht weil sie nicht funktionierte
(sie tat es, siehe §4), sondern weil sie eine Antwort für **eine** von acht Oberflächen war und
weil der Owner **Stapeln** will, nicht Umschalten. Ein gestapeltes Layout zeigt alle drei Spalten
untereinander; Reiter verstecken zwei davon. Das ist ein anderes Produkt, keine Variante.

Zurückgebaut wurde vollständig: die Commits `50fd23b`, `b21600b`, `c393e93` und ihre Merges
`211e1dc`, `3837984`.

## 2. Die Messung — vier Layout-Vokabulare über acht Editoroberflächen

Gemessen am 13.09.2026 über alle Editorseiten. **Das ist die Zahl, die das Konzept bestimmt:**

| Oberfläche | Spalten-Vokabular | Spalten | Menüband | `.avm-row` | `@media` |
|---|---|---|---|---|---|
| `wiki-sync-monitor.html` („Territorien bearbeiten") | `.cols`/`.col` | 3 | `.controls` | – | 0 |
| `wiki-sync-settlement-editor.html` | `.cols`/`.col` | 3 | `.controls` | – | 0 |
| `wiki-sync-powerline-editor.html` | `.cols`/`.col` | 3 | `.controls` | 5 | 0 |
| `wege-editor.html` | `.avm-cols`/`.avm-col` | 3 | `.avm-ribbon` | – | 0 |
| `landschaften-editor.html` | `.avm-cols`/`.avm-col` | 3 | `.avm-ribbon` | 6 | 0 |
| `citymap-editor.html` | `.ce-panels`/`.ce-panel` | – | – | 4 | 0 |
| `game-literature-editor.html` | `.ae-panels`/`.ae-panel` | – | – | 4 | 0 |
| `political-territory-editor.html` | `.layout`/`.panel` | – | – | – | 0 |

🔴 **KEINE EINZIGE EDITORSEITE HAT EINE MEDIA-QUERY.** Es fehlt keine Feinjustierung, es fehlt die
Regel überhaupt. (Die 2 in der ersten Zeile sind die dieser Sitzung und sind zurückgebaut.)

🔴 **Vier Vokabulare für dasselbe Layout:**
- **A — `.cols`/`.col`/`.controls`** (drei Seiten): seitenlokal in jedem `<style>`-Block definiert,
  Zeile für Zeile ähnlich, aber nirgends geteilt.
- **B — `.avm-cols`/`.avm-col`/`.avm-ribbon`** (zwei Seiten): die Hausform aus
  `css/components/editor-body.css`. Sie ist das Ziel, auf das die anderen zeigen sollten.
- **C — eigene Präfixe** (zwei Seiten): `.ce-*` und `.ae-*`, zweispaltige Panel-Anordnungen.
- **D — der Inline-Host** (`political-territory-editor.html`): `.layout`/`.panel`/`.detail-stack`.

💣 **Und D ist gar kein iframe.** `js/territory/territory-editor-inline-host.js` hat den früheren
iframe aufgelöst: das Markup wird per `fetch` geholt, der `.app-container` herausgeschnitten und mit
`host.innerHTML` ins Hauptdokument gesetzt. Er lebt also im Dokument von `index.html`, mit dessen
Tokens, dessen `reset.css` und dessen `html.avesmaps-phone`-Klasse — die sieben anderen nicht.
⚠️ **Beide werden im Code „Territoriumseditor" genannt** (`js/ui/wiki-feld-herkunft.js` meint den
Monitor, AGENTS.md meint den Gebietsdialog). Wer den Namen liest, muss die Datei prüfen.

⚠️ Alle sieben iframe-Editoren werden gleich geöffnet: `document.createElement("iframe")` in
`js/review/review-{path-editor,ecosystem,settlement,wiki-sync,powerline}-list.js`, in einem Overlay
mit den Klassen `.political-territory-editor-overlay` / `.political-territory-editor-dialog`.
💣 **Diese zwei Klassen tragen VIER Fenster** (Gebietsdialog aus `index.html:438`, „Literatur
bearbeiten" und „Karten bearbeiten" aus `review-settlement-list.js:852/925`, der Sync-Editor).
Eine klassenweite Regel dort trifft alle vier — diese Sitzung hat das erst durch eine Prüfung
gemerkt, nachdem der Diff schon freigegeben war.

## 3. Die Fallen, die diese Sitzung wirklich getroffen hat

Jede einzelne hat Zeit gekostet und wird die Nachfolge sonst genauso treffen.

### 3.1 🔴 Ein Feature-Branch geht NICHT live, und niemand sagt es
Der Deploy hängt an `push: branches: [master]`. Diese Sitzung entwickelte auf
`claude/editor-mobile-usability-bkiyy7`, pushte, meldete „so sieht es jetzt am Telefon aus" — und
der Owner sah nichts, weil nichts live war. **Wer auf einem Branch arbeitet, sagt beim ERSTEN Push,
dass damit nichts live geht.**

### 3.2 💣 Ein Inline-Style schlägt jede Media-Query
`openAvesmapsSyncEditorOverlay` setzte `dialog.style.width/height`. Die 680px-Regel in
`political-territory-editor-overlay.css` stand seit jeher da und war für dieses Fenster **wirkungslos**.
Das war der eigentliche Grund, warum das Fenster am Telefon einen Rand behielt.

### 3.3 💣 Eine GEÄNDERTE Datei hinter einem `@import` kam nicht an, eine NEUE sofort
Der schwerste Befund, und er kam aus einem Owner-Bild: das JavaScript lief vollständig (Reiterleiste
gebaut, Sprung auf „Details" funktionierte), aber die geänderten CSS-Regeln wirkten nicht. Sie lagen
in `editor-body.css`, die eine Editorseite nur über `editor-page.css` und dessen `@import` erreicht.
Im **selben** Deploy lief die neue Datei `editor-spalten-reiter.js` sofort.
- ⚠️ Die Stempel-Kette war nachgemessen KORREKT (`editor-page.css` 07d930d904 → bcd87a48f8,
  `editor-body.css` cda4ab0cb4 → 2f5b79a268; `verify-stamped-chain.py` grün), und die Datei stand in
  der Änderungsliste des Deploys. Woran es lag — Browser-Cache oder Server — ist **nicht geklärt**:
  von der Sitzung aus ist avesmaps.de nicht erreichbar (Egress-Policy).
- ⭐ Die Abhilfe war strukturell: ein eigenes Blatt mit eigenem `<link>` an der Seite. **Einen Pfad,
  den es vorher nicht gab, kann niemand alt vorliegen haben.** Für den Umbau der sieben Seiten heißt
  das: das neue Theme gehört in eine **neue Datei mit eigenem `<link>`**, nicht als Ergänzung in ein
  bestehendes Blatt hinter der Import-Kette.

### 3.4 💣 `--avm-col-pad` ist ein ZWEIwert, und der Wert war zweimal falsch
`padding: 0 var(--avm-col-pad)` ergibt aus `var(--space-6) var(--space-10)` die drei Werte
`0 8px 12px` — oben 0, seitlich 8, **unten 12**. Die Korrektur schrieb dann `--space-12` (14px) hin,
begründet mit „der Seiteneinzug ist überall 14" — und **das gilt im iframe nicht**: der globale Token
steht seitlich auf 12, die 14er sind Überschreibungen an Fensterhüllen im **Elterndokument**, und
**Custom Properties kreuzen keine iframe-Grenze**. ⭐ Eine Zahl, die man aus einem Token rechnen kann,
wird nicht abgeschrieben — der Test las am Ende die Seitenkomponente aus `tokens.css`.

### 3.5 💣 `.col + .col` hinterlässt eine tote Trennlinie
Ein Geschwister-Selektor liest den DOM-Baum, nicht die Sichtbarkeit: `display: none` an der Spalte
davor nimmt `border-left` nicht zurück. **Für ein gestapeltes Layout gilt dasselbe eine Achse
weiter** — aus dem linken Trenner muss ein oberer werden, sonst steht er quer.

### 3.6 💣 Touch-Ziele: es gab keinen Token, und 44px stand viermal als eigene Zahl da
`.avm-tab` ist für einen Zeiger gebaut (~27px hoch, 1px seitliches Polster), `.row`/`.node` ~31–35px.
Die 44 lag schon in `media-license-fields.css`, `review-panel.css` und zweimal in `place-extras.css`.
Diese Sitzung hat `--avm-touch-h: 44px` in `tokens.css` angelegt — **mit dem Rückbau ist er wieder
weg**. Das Konzept sollte ihn erneut anlegen und die vier Altstellen dabei mitnehmen.

### 3.7 💣 Vier verschachtelte Polster, und das äußere allein löst nichts
`.sync-plan-host` (18px) plus drei innere 18er in `summary`, `.rows`, `.gate` = 26px je Seite von
366px Breite. Wer nur die Hülle verkleinert, schreibt einen Kommentar, der mehr behauptet, als er tut.

### 3.8 🪤 Zwei Testfeld-Fallen, beide aus AGENTS.md §9 und beide trotzdem passiert
- `find api tools \( A \) -o \( B \) -print0` bindet `-print0` nur an die zweite Gruppe: **30 statt
  410 Dateien** gefahren, Meldung „null rot". **Die Gegenprobe ist die Dateizahl, und nur sie.**
- `8px/**12**px` in einem CSS-Kommentar enthält `/*` und hat `css-comment-balance.test.js` rot
  gemacht — ein Test, der jemand anderem gehört. In einem CSS-Kommentar wird nicht mit Sternchen
  betont.

### 3.9 🪤 Eine Zusicherung mit `indexOf(A) < indexOf(B)` ist die `-1`-Falle
Blieb grün, als A ganz verschwand (`-1 < irgendwas`). Erst die Stellen prüfen, dann vergleichen.
Gefunden von der Mutationsprobe, nicht vom Autor.

## 4. Was funktioniert HAT (und als Baustein taugt)

Damit die Nachfolge es nicht zweimal erfindet — der Code liegt im Verlauf von `50fd23b`/`c393e93`:

- **Ein Klassen-Umschalter statt eines JS-Zustands:** das JS setzt in jeder Breite eine Klasse, das
  `display: none` steht **in** der Media-Query. Damit läuft beim Drehen oder Größerziehen kein
  Zustand auseinander, und es braucht **keinen `resize`-Zuhörer**. 💣 Und nie `hidden` —
  `[hidden] { display: none !important }` gilt in jeder Breite und nimmt keine Query zurück.
- **Der Riegel ist die FENSTERBREITE, nicht `html.avesmaps-phone`.** Zwei Gründe: gefragt ist „hat
  der Inhalt Platz", nicht „ist das ein Telefon" (ein schmal gezogenes Desktopfenster hat dasselbe
  Problem); und die Klasse kommt aus `js/app/runtime-state.js`, **die nur `index.html` lädt** — im
  iframe gibt es sie nicht. ⚠️ Für den Touch-Riegel gilt das Gegenteil: `(hover: none) and
  (pointer: coarse)`, dieselbe Bedingung, mit der `fenster.css` den Zieh-Griff abnimmt.
- **Der Sprung gehört in den Trichter, nicht an die Aufrufstellen.** `selectKey` ist im Monitor die
  eine Stelle, durch die alle fünf Aufrufer gehen.
- **Spezifität statt Ladereihenfolge:** zwei Klassen (`.avm-tabs.avm-spalten-reiter`, 0,2,0) machen
  ein Blatt unabhängig davon, welche Datei zuerst lädt.

## 5. Was diese Sitzung NICHT konnte

- 🔧 **Kein Browser, kein Zugang zu avesmaps.de** (Egress-Policy, `curl` → HTTP 000). Alles ist am
  Markup gemessen, an den Tokens gerechnet und über das Testfeld gefahren. **Jede Aussage über
  Bildschirmtastatur, echtes Touch-Verhalten oder die Live-Auslieferung stammt vom Owner, nicht aus
  einer Messung.** Die Nachfolge sollte klären, ob sie einen Browser hat — das ändert die
  Abnahmeform grundlegend.
- 🔧 **Drag'n'drop bleibt am Telefon unmöglich** (HTML5-DnD kennt kein Touch). Im Monitor hängen
  daran „aussortieren" und „zur Wurzel machen"; die Drop-Zonen wurden am Touch-Gerät ausgeblendet.
  Ein Tipp-Weg („Knoten wählen → Ziel wählen") ist ein eigenes Stück Arbeit.
