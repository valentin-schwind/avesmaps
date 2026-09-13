# Auftrag: ein Mobil-Theme für ALLE Editoren

> **Das hier ist der Prompt für eine neue Sitzung.** Alles ab „## PROMPT" kann als erste Nachricht
> übergeben werden; der Rest dieser Datei ist die Begründung, warum er so geschnitten ist.
>
> Vorgeschichte und Messung: **`docs/superpowers/plans/2026-09-13-editoren-am-telefon-uebergabe.md`**
> — die Nachfolge liest sie ZUERST, sie enthält die Bestandsaufnahme und neun Fallen, die eine
> Sitzung bereits bezahlt hat.

---

## PROMPT

Du baust für **Avesmaps** (`/home/user/avesmaps`) ein **Mobil-Theme für alle Editoren**.

### 0. Zuerst lesen, bevor du irgendetwas anfasst

1. `AGENTS.md` — der Projektbrief. Besonders **§7** (Asset-Versionierung), **§9** (Dev-Konventionen:
   einzeln live, das ganze Testfeld, geteilter Checkout) und **§12** (Designsprache, Tokens, Fenster).
2. `docs/design-language.md` — die Designsprache im Detail.
3. **`docs/superpowers/plans/2026-09-13-editoren-am-telefon-uebergabe.md`** — die Übergabe der
   Sitzung, die diesen Auftrag ausgelöst hat. Sie enthält die vollständige Bestandsmessung und die
   Fallen. **Lies sie ganz.** Jede ihrer neun Fallen wird dich sonst genauso treffen.

### 1. Der Auftrag

Owner, 13.09.2026, wörtlich:

> „du brauchst ein generelles konzept alle editoren für mobil geräte zu optimieren"
>
> „die idee ist dass das 3 spalten layout generell nicht nebeneinander sondern untereinander steht"

🔴 **Die Richtungsentscheidung ist getroffen und steht nicht zur Debatte: die Spalten werden
GESTAPELT, nicht in Reiter gelegt.** Eine Vorgängersitzung hat Reiter gebaut (funktionierte,
Owner-Bilder belegen es) und der Owner hat sie verworfen — gestapelt sieht man alle drei Bereiche,
Reiter verstecken zwei davon. Wenn du beim Bauen zu dem Schluss kommst, dass Stapeln irgendwo nicht
trägt, **legst du es dem Owner vor, statt es eigenmächtig umzudrehen.**

**Umfang: acht Editoroberflächen.** Sieben laufen in einem `<iframe>`, eine (der Gebietsdialog) inline
im Hauptdokument. Keine einzige hat heute eine Media-Query.

### 2. Der Bestand (gemessen 13.09.2026 — nachmessen, nicht glauben)

| Oberfläche | Spalten-Vokabular | Sp. | Menüband | `.avm-row` |
|---|---|---|---|---|
| `wiki-sync-monitor.html` („Territorien bearbeiten") | `.cols`/`.col` | 3 | `.controls` | – |
| `wiki-sync-settlement-editor.html` | `.cols`/`.col` | 3 | `.controls` | – |
| `wiki-sync-powerline-editor.html` | `.cols`/`.col` | 3 | `.controls` | 5 |
| `wege-editor.html` | `.avm-cols`/`.avm-col` | 3 | `.avm-ribbon` | – |
| `landschaften-editor.html` | `.avm-cols`/`.avm-col` | 3 | `.avm-ribbon` | 6 |
| `citymap-editor.html` | `.ce-panels`/`.ce-panel` | – | – | 4 |
| `game-literature-editor.html` | `.ae-panels`/`.ae-panel` | – | – | 4 |
| `political-territory-editor.html` (inline, kein iframe) | `.layout`/`.panel` | – | – | – |

🔴 **VIER Vokabulare für dasselbe Layout.** Das ist die erste Frage, die dein Entwurf beantworten
muss: vereinheitlichst du sie auf die Hausform `.avm-cols`/`.avm-col` (dann ist der Umbau größer,
aber das Theme ist eine Datei), oder bedienst du alle vier (dann ist das Theme eine Sammlung von
Selektorlisten, die beim nächsten Editor veraltet)? **Beides ist vertretbar — entscheide begründet
und lege die Begründung dem Owner vor.**

⚠️ Der Gebietsdialog (`political-territory-editor.html`) ist **kein iframe**: sein Markup wird per
`fetch` geholt und mit `host.innerHTML` in `index.html` montiert
(`js/territory/territory-editor-inline-host.js`). Er lebt im Hauptdokument — mit dessen `reset.css`
und der Klasse `html.avesmaps-phone`, die die sieben anderen NICHT haben.

### 3. Zwingende Randbedingungen (jede ist bezahlt worden)

- 💣 **Der Breiten-Riegel misst das DOKUMENT, nicht das Gerät.** Im iframe ist das die Fensterbreite
  — genau richtig, denn gefragt ist „hat der Inhalt Platz". `html.avesmaps-phone` kommt aus
  `js/app/runtime-state.js`, **die nur `index.html` lädt**; im iframe gäbe es sie nie.
- 💣 **Der Touch-Riegel ist ein ANDERER:** `(hover: none) and (pointer: coarse)` — dieselbe
  Bedingung, mit der `css/components/fenster.css` den Zieh-Griff abnimmt. Ein Tablet ist breit UND
  tastbedient. Wer die zwei Riegel zusammenzieht, liegt in einer Richtung immer falsch.
- 💣 **Das Theme gehört in eine NEUE Datei mit eigenem `<link>` je Seite** — nicht als Ergänzung in
  ein Blatt hinter der `@import`-Kette von `editor-page.css`. Begründung: Falle 3.3 der Übergabe.
  Einen Pfad, den es vorher nicht gab, kann niemand alt vorliegen haben.
- 💣 **Regeln gewinnen über SPEZIFITÄT, nie über Ladereihenfolge.** Zwei Klassen statt einer, wenn
  die Hausform dieselbe Klasse belegt.
- 💣 **Sichtbarkeit über eine Klasse, deren `display: none` IN der Media-Query steht** — nie über
  `hidden` (`[hidden] { display: none !important }` gilt in jeder Breite). So braucht es keinen
  `resize`-Zuhörer und es läuft kein Zustand auseinander.
- 💣 **`--avm-col-pad` ist ein ZWEIwert** (`var(--space-6) var(--space-10)`). `padding: 0 var(…)`
  ergibt daraus drei Werte. Und der globale Seitenwert ist **12**, nicht 14 — die 14er sind
  Überschreibungen im Elterndokument, und **Custom Properties kreuzen keine iframe-Grenze**.
- 💣 **`.col + .col { border-left }` ist ein Geschwister-Selektor** und kennt keine Sichtbarkeit. Im
  gestapelten Layout muss aus dem linken Trenner ein oberer werden.
- 💣 **Touch-Ziele brauchen einen Token.** 44px liegt heute viermal als eigene Zahl im Haus
  (`media-license-fields.css`, `review-panel.css`, `place-extras.css` ×2). Lege
  `--avm-touch-h: 44px` in `css/base/tokens.css` an und nimm die vier Altstellen mit.
- ⚠️ **Die Fensterhülle:** `.political-territory-editor-overlay` / `.political-territory-editor-dialog`
  tragen **vier** Fenster. Eine klassenweite Regel dort trifft alle vier. Und drei Öffner setzen
  Breite/Höhe als **Inline-Style** (`review-wiki-sync.js`, `review-settlement-list.js` ×2) — dagegen
  gewinnt keine Media-Query; die Maße gehören ins CSS.
- ⚠️ **Drag'n'drop funktioniert am Touch-Gerät nicht** (HTML5-DnD). Im Monitor hängen daran zwei
  Drop-Zonen. Entscheide begründet, was am Telefon damit passiert — und melde es als offenen Punkt,
  wenn du keinen Ersatzweg baust.

### 4. Der Ablauf — sechs Phasen, in dieser Reihenfolge

**Phase 1 — Bestand messen.** Für jede der acht Oberflächen: Layout-Klassen, Spaltenzahl, Menüband,
Statuszeile, Listenzeilen, Fenstermaße, Öffner. Die Tabelle in §2 ist der Startpunkt, **nicht das
Ergebnis** — miss nach. Zusätzlich: Welche Bedienelemente sind heute unter 44px? Welche Texte
kürzen mit Ellipsis? Wo stehen feste Pixelbreiten?

**Phase 2 — Entwurf.** Schreib ihn nach `docs/superpowers/specs/<datum>-editoren-mobil-design.md`,
in der Hausform (💣/⚠️/🔴/⭐/🪤-Zeilen, jede Entscheidung begründet). Er muss beantworten:
- Vereinheitlichung der vier Vokabulare: ja/nein, und was das kostet.
- Die Schwelle: **eine** Zahl, an einer Stelle definiert, von allen gelesen.
- Reihenfolge der gestapelten Bereiche — und ob sie je Editor gleich ist.
- Was mit dem Menüband, der Statuszeile, den Filterzeilen und den Fußleisten passiert.
- Was am Touch-Gerät zusätzlich gilt (Trefferflächen, Drop-Zonen, Zieh-Griffe).
- Die Fenstermaße der sieben iframes und des Inline-Hosts.
- **Eine Abnahmeliste A1…An**, jede Zeile einzeln prüfbar.
🔴 **Der Entwurf ist die Abnahmeliste** (AGENTS.md §9). Jede 💣/⚠️/🔴-Zeile wird vor „fertig"
einzeln abgehakt — erfüllt oder ausdrücklich verworfen mit Begründung.

**Phase 3 — Mockup + Owner-Freigabe.** Ein bedienbares `docs/<name>-mockup.html`, das den
gestapelten Zustand bei 390px UND den heutigen bei 1400px zeigt, in hell und dunkel. **Leg es dem
Owner vor, bevor du eine Zeile Produktivcode anfasst.** Diese Entscheidung betrifft acht sichtbare
Oberflächen; sie ist zu teuer, um sie im Code zu klären.

**Phase 4 — Bauen, Seite für Seite.** 🔴 **Sichtbare Änderungen gehen EINZELN live, und der Owner
sieht jede** (AGENTS.md §9 — am 10.08.2026 kosteten neun Mobil-Commits am Stück vier Regressionen).
Beginne mit **einer** Seite als Pilot, hol den Blick des Owners, dann die übrigen.

**Phase 5 — Multiagentische Eigenvalidierung.** Siehe §5.

**Phase 6 — Live und Nachweis.** Nach jedem Push: Deploy-Lauf abwarten und die Schritte prüfen
(`Run the unit tests`, `Stamp asset versions`, `Deploy package`). Erst dann dem Owner melden.

### 5. Multiagentische Eigenvalidierung — was, wann, wogegen

Das Projekt hält dafür eigene Sub-Agenten bereit. Setze sie **während** des Bauens ein, nicht als
Schlussritual:

| Wann | Agent | Fragestellung |
|---|---|---|
| Vor **jedem** Commit | `usability-konsistenz` | Hält der Diff jede 💣/⚠️/🔴-Zeile seines Entwurfs? Sind gekoppelte Werte gemeinsam gewandert? **Gewinnt die Regel überhaupt** (Spezifität, Ladereihenfolge, Inline-Styles)? Trifft sie **übersehene Wirte**? |
| Während des Bauens | `mockup-treue` | Stimmt der gebaute Zustand mit dem Mockup-Vertrag überein — Werte, Bauteile, Beschriftungen, Reihenfolge? Hat eine alte Rezeptur überlebt? |
| Vor **jedem** Push | `usability-design` | Designsprache (§12): Tokens statt Literale, kein Blau in der Chrome, Rangfolge in hell UND dunkel, Touch-Ziele. Wurde etwas versprochen und nicht gebaut? Ist am schmalen Fenster noch etwas kaputt, das der Diff nicht anfasst? |
| Bei jeder neuen Zusicherung | *Mutationsprobe* (selbst, kein Agent) | Jede Mutation MUSS mindestens einen Test rot machen. Ein Test, der eine Mutation überlebt, ist ein Vakuum. |

🔴 **Nimm die Agentenbefunde ernst, aber nicht blind.** In der Vorgängersitzung waren von sieben
Befunden fünf echt und schwerwiegend (darunter beide, die kein Test gefunden hätte) — einer beruhte
auf einem falsch gelesenen Tokenwert. **Prüf jeden Befund selbst nach, bevor du ihn umsetzt.**

⭐ **Die zwei Befunde, die kein Test fand, waren beide von der Sorte „die Regel trifft mehr, als du
denkst"** — eine klassenweite CSS-Regel, die vier Fenster erwischte, und ein Bedienelement, das
kleiner war als das, was es erschließt. Frag die Agenten gezielt danach.

### 6. Das Tor — vor jedem Push

Ein einziger roter Test lädt **nichts** hoch. Fahre **beide** Muster des Workflows,
**mit der äußeren Klammer** (sonst fährt der Lauf einen Bruchteil und meldet „null rot"):

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 \
  | tee >(tr -dc '\0' | wc -c) | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'

find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 \
  | tee >(tr -dc '\0' | wc -c) | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```

⭐ **Die Gegenprobe ist die DATEIZAHL** (13.09.2026: 542 JS / 410 PHP, null rot). Eine Zahl, die viel
zu klein ist, ist der einzige Unterschied zwischen dieser Falle und einem grünen Feld.
⚠️ Bei einem unerwarteten Roten **wie** bei einem unerwarteten Grünen: erst nachzählen, dann glauben.

### 7. Git und Deploy

- Der Hauptcheckout ist **geteilt**: `git status` zuerst, nur eigene Dateien nach explizitem Pfad
  stagen, **nie** `git add -A`. `git add` und `git commit` in EINEM Zug.
- Kommentare, Commits und Doku auf **Deutsch** (§8).
- Deploy löst **nur** ein Push auf `master` aus. Arbeitest du auf einem Branch, **sag dem Owner beim
  ersten Push, dass damit nichts live geht** — das hat in der Vorgängersitzung einen ganzen Zyklus
  gekostet.
- Vor dem Push auf `master`: prüfen, ob ein Lauf `in_progress` oder `pending` ist — ein wartender
  Lauf wird vom nächsten Push ersetzt und seine Dateien lädt nie jemand.
- Für den Push in einen geteilten Baum: Wegwerf-Worktree
  (`git worktree add --detach <scratch>/pushwt origin/master`, dort mergen, `git push origin HEAD:master`,
  `git worktree remove`). Der Hauptbaum bleibt byte-identisch.
- **`ASSET_VERSION`** in `js/territory/territory-editor-inline-host.js` bumpen, **wenn** du eine der
  dynamisch geladenen Editor-Assets änderst. Prüf die Liste dort, statt zu raten.
- **Kein `?v=` von Hand** — außer an einer `.php`-Seite, die der Stamper nicht erreicht
  (`grep -n '?v=' <die .php-Seite, die deine Datei lädt>`).

### 8. Wovon du dich NICHT abbringen lässt

- Der Owner will **gestapelt**, nicht Reiter. (§1)
- **Eine** Schwelle, an **einer** Stelle. Drei eigene Zahlen laufen beim ersten Nachjustieren
  auseinander.
- **Keine hartkodierten Farben, Radien, Abstände** — Token oder neuer Token (§12).
- Der Umbau ist **nicht fertig, wenn die Maße stimmen**. AGENTS.md §9: „Abnahme heißt ABLAUF, nicht
  Maß." Benenne die echten Handgriffe, die du ausgeführt hast — und melde als offene Frage, was du
  ohne Browser oder ohne echtes Gerät nicht beantworten kannst.

### 9. Was am Ende dasteht

1. Der Entwurf unter `docs/superpowers/specs/` mit abgehakter Abnahmeliste.
2. Das Mockup unter `docs/`.
3. Das Theme als eigene Datei(en) plus je ein `<link>` in den acht Oberflächen.
4. Tests, die die tragenden Zusicherungen **ausführen**, nicht den Quelltext lesen — und gegen
   Mutationen gefahren sind. (🪤 Ein Regex kennt keinen Geltungsbereich: ein Bauer wird
   AUSGEFÜHRT, nicht gelesen. Das hat dieses Haus am 03.09.2026 zwei Stunden ohne Kartenbeschriftungen
   gekostet.)
5. Eine ehrliche Liste offener Punkte — insbesondere alles, was ohne echtes Gerät ungeprüft blieb.

---

## Warum der Prompt so geschnitten ist

- **Phase 3 (Mockup + Freigabe) vor jedem Produktivcode** ist die teuerste Lehre der
  Vorgängersitzung: sie hat gebaut, live geschickt, und der Owner hat die Richtung danach
  umgedreht. Acht Oberflächen sind zu teuer, um die Richtung im Code zu klären.
- **Die Bestandstabelle steht drin, ist aber als „nachmessen" markiert.** Sie spart der Nachfolge
  eine Stunde und darf sie trotzdem nicht zum Abschreiben verleiten — dieselbe Regel, mit der
  AGENTS.md jede notierte Zahl versieht.
- **Die Fallen stehen in der Übergabe, nicht im Prompt**, damit der Prompt bedienbar bleibt. Der
  Prompt verweist auf sie und macht das Lesen zur Vorbedingung.
- **Die Agenten stehen mit ihrer Fragestellung da, nicht nur mit ihrem Namen.** „Lass die Agenten
  laufen" produziert Zustimmung; eine konkrete Frage produziert Befunde.
