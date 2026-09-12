# Der Territorien-Editor am Telefon — Entwurf

**Auftrag** (Owner 12.09.2026, mit Bild vom Telefon): „kannst du den editor halbwegs so machen
dass ich ihn aufm handy irgendwie benutzen kann"

Gemeint ist das Fenster **„Territorien bearbeiten"** — `html/wiki-sync-monitor.html`, geöffnet als
iframe im Overlay `#avesmaps-sync-editor-overlay` (`openAvesmapsSyncEditorOverlay`,
`js/review/review-wiki-sync.js`). Nicht der Gebietsdialog (`html/political-territory-editor.html`),
der trägt seine Media-Queries seit jeher.

🔴 **Die Seite hat NULL Media-Queries** — gemessen 12.09.2026 über alle zwölf Editorseiten: keine
einzige hat eine. Es fehlt also keine Feinjustierung, es fehlt die Regel überhaupt.

## 1. Was am Bild kaputt ist (fünf Befunde, alle am Markup nachgemessen)

1. **Drei Spalten in einem 366px breiten Fenster.** `.col { flex: 1 1 0 }` teilt exakt zu Dritteln
   → je ~110px. Alle drei Überschriften abgeschnitten („Hierarchiemod…"), jede Listenzeile
   mehrzeilig, der Detailtext senkrecht gestapelt. 💣 Der Kommentar an `.row .nm` (Zeile 120–133)
   hat das schon gerechnet: unter **rund 607px Fensterbreite** fällt der Abdeckungskreis der
   Listenzeile auf eine zweite Zeile, „kein Telefon nötig, ein nicht maximiertes Fenster genügt".
2. **Das Menüband ist unlesbar.** `.controls { grid-auto-flow: column; grid-auto-columns:
   minmax(0,1fr) }` erzwingt fünf Kacheln in EINER Zeile, und `.btn2 .t1` trägt `nowrap` +
   Ellipsis. Am Bild: „1 · 🚨 …", „2 · Hi…", „3 · Ü…", „Wap…", „🔗 Li…". Wer die Reihenfolge
   nicht kennt, weiß von keinem dieser fünf Knöpfe, was er tut.
3. **Die Statuszeile läuft aus dem Fenster.** `#status { white-space: nowrap; display: flex }`
   mit `#statusText`, zwei Meldespannen und dem Kontinent-Trichter am Ende.
4. **Die zwei Drop-Zonen fressen die Spalten** („✕ Hierher ziehen = aussortieren (kein
   Herrschaftsgebiet)", „▶ Hierher ziehen = zur Wurzel machen (Eltern entfernen)") — am Bild je
   vier bis fünf Zeilen. 🔴 Und sie sind am Touch-Gerät **nicht ausführbar**: die Seite fährt
   HTML5-Drag'n'drop (`dragstart`/`dragover`/`drop`), das kennt kein Touch.
5. **Das Fenster füllt den Bildschirm nicht.** `political-territory-editor-overlay.css` hat für
   ≤680px längst `padding: 8px` und `calc(100vw - 16px)` — aber `openAvesmapsSyncEditorOverlay`
   setzt Breite und Höhe als **Inline-Style**, und der schlägt jede Media-Query.

## 2. Die Lösung

### 2.1 Aus den drei Spalten werden drei REITER

Ein geteiltes Bauteil `js/ui/editor-spalten-reiter.js` baut über dem Spalten-Wirt eine Reiterleiste
und zeigt unter der Schwelle genau eine Spalte.

- 🔴 **Die Hausform, nicht eine neue:** `.avm-tabs` / `.avm-tab` (Unterstrich) aus
  `css/components/editor-body.css`. AGENTS.md §12: „Reiter = T3 (Owner 04.09.2026): im Fenster
  Unterstrich, frei auf der Karte gefüllter Umschalter — der ORT entscheidet." Ein Reiter IM
  Fenster ist ein Unterstrich-Reiter. Es entsteht **keine zehnte Rezeptur**.
- 🔴 **Der Riegel ist die FENSTERBREITE, nicht `html.avesmaps-phone`.** Zwei Gründe, und beide
  sind tragend: (a) gefragt ist „haben drei Spalten Platz", nicht „ist das ein Telefon" — ein auf
  600px gezogenes Desktopfenster hat genau dasselbe Problem; (b) die Klasse kommt aus
  `js/app/runtime-state.js`, und **die lädt nur `index.html`** — im iframe-Dokument des Monitors
  gibt es sie gar nicht. Ein `html.avesmaps-phone` im Monitor wäre eine Regel, die nie greift.
- 🔴 **Die Schwelle ist 680px — dieselbe Zahl, die das Overlay dieses Fensters schon führt**
  (`political-territory-editor-overlay.css:47`). EINE Zahl für dieselbe Frage statt einer zweiten,
  die beim nächsten Nachjustieren auseinanderläuft. Sie liegt mit einer Stufe Luft über dem
  gemessenen Bruch bei ~607px. ⚠️ Die zwei Riegel messen zwei verschiedene Kästen (Bildschirm
  gegen Fensterinhalt); zwischen ~680 und ~704px Bildschirmbreite sind die Reiter schon an,
  während das Fenster noch seinen Rand hat. Gewollt — die Reiter folgen dem Platz IM Fenster.
- 💣 **JS setzt nur eine Klasse, CSS entscheidet, ob sie wirkt.** Die versteckte Spalte bekommt
  `.avm-spalte-aus`, und `display: none` steht **in** der Media-Query. Damit gibt es keinen
  Zustand, der beim Drehen oder Größerziehen auseinanderläuft: über 680px sind alle drei Spalten
  da, ohne dass ein Ereignis abgewartet werden muss.
- 💣 **Deshalb NICHT `hidden`.** `[hidden] { display: none !important }` (`css/base/reset.css`
  global, in den Editorseiten `editor-page.css`) gilt in JEDER Breite — die zwei Spalten wären
  auch am 1400px-Fenster weg, und ein `!important` nimmt keine Media-Query zurück.
- 💣 **Der Trichter ist `selectKey`** (`html/wiki-sync-monitor.html:918) — die EINE Stelle, die
  `selectedKey` setzt, `.sel` markiert und `renderDetail()` ruft; alle fünf Aufrufer gehen durch
  sie. Ein Klick in Liste oder Baum springt von dort auf „Details". Ohne das füllt sich eine
  unsichtbare Spalte, und es sieht aus wie ein verschluckter Klick.
- ⚠️ Der Sprung gilt nur, **wenn die Reiter wirklich wirken** — das Bauteil fragt dafür die
  gerechnete Sichtbarkeit seiner Leiste, nicht seine eigene Schwellenzahl ein zweites Mal.
- ⚠️ Ein zweiter `attach`-Aufruf auf demselben Wirt gibt die vorhandene Steuerung zurück (wie
  `avesmapsRibbonMenuAttach`) — die Doppelanmeldung, die das Sammelmenü am 23.08.2026 gekostet hat.
- Kurznamen als `data-reiter` am `.col`: **Lücken · Modell · Details**. Die vollen Überschriften
  („Noch nicht modellierte Herrschaftsgebiete" …) bleiben in der Spalte stehen.

### 2.2 Das Menüband bricht um

`grid-auto-flow: column` → `repeat(auto-fit, minmax(150px, 1fr))`, und `.btn2 .t1` darf umbrechen
(`white-space: normal`). Aus „2 · Hi…" wird „2 · Hierarchie rechnen" über zwei Zeilen. 🔴 Lesbar
schlägt gleich hoch: die Ellipsis war für acht Kacheln NEBENEINANDER gedacht (der Kommentar sagt
das), und nebeneinander stehen sie hier nicht mehr.

### 2.3 Die Statuszeile umbricht

`flex-wrap: wrap`, `white-space: normal`, `min-height` fällt auf `auto`. Der Kontinent-Trichter
rutscht in die zweite Zeile statt aus dem Fenster.

### 2.4 Am TOUCH-Gerät fallen die Drop-Zonen, und die Zeilen werden treffbar

- 🔴 **Riegel `(hover: none) and (pointer: coarse)`** — dieselbe Bedingung, mit der
  `css/components/fenster.css:224` den Zieh-Griff abnimmt, und aus demselben Grund, den sie dort
  ausschreibt: „Also genau dort keinen Griff — nicht an der Bildschirmbreite, denn ein Tablet ist
  breit UND tastbedient; der Griff wäre dort eine Behauptung, die niemand einlöst." Ein Kasten,
  der zum Ziehen auffordert, wo nichts gezogen werden kann, ist genau so eine Behauptung.
- Mit ihnen fällt `cursor: grab` an `.row`/`.node` (dieselbe Lüge, eine Etage kleiner), und
  `.row`/`.node` bekommen ein Touch-Ziel statt 4px Polster.
- ⚠️ **Das nimmt keine Funktion weg, die es dort gab** — aussortieren und „zur Wurzel machen"
  waren am Telefon nie ausführbar. Es bleibt ein offener Punkt (§4), keine Regression.

### 2.5 Das Fenster füllt am Telefon den Bildschirm

Die zwei Inline-Zeilen in `openAvesmapsSyncEditorOverlay` wandern nach
`political-territory-editor-overlay.css` unter `#avesmaps-sync-editor-overlay` — damit greift die
680px-Regel, die dort längst steht, endlich auch für dieses Fenster. Darunter zusätzlich: kein
Overlay-Polster, kein Radius, `100vw`/`100vh`.
💣 Als CSS-Regel, nicht als zweite Media-Query im JS: ein Inline-Style ist die eine Form, gegen die
eine Media-Query nicht gewinnt — genau daran ist dieses Fenster gescheitert.

## 3. Abnahmeliste (jede Zeile einzeln abgehakt)

| # | Zusicherung | Stand |
|---|---|---|
| A1 | Unter 680px zeigt der Monitor eine Reiterleiste und genau EINE Spalte | ✅ Test 1 |
| A2 | Über 680px stehen alle drei Spalten, keine Reiterleiste, kein JS-Ereignis nötig | ✅ Verdrahtungstest 4 |
| A3 | Die Leiste trägt `.avm-tabs`/`.avm-tab` — keine zehnte Reiter-Rezeptur | ✅ Test 3 |
| A4 | Ein Klick in Liste oder Baum springt auf „Details" (über `selectKey`, nicht am Aufrufer) | ✅ Verdrahtungstest 1 (`selectKey` wird GEFAHREN) |
| A5 | Der Sprung bleibt aus, solange die Reiter nicht wirken (breites Fenster) | ✅ Test 5 |
| A6 | Versteckt wird per Klasse, NIE per `hidden` | ✅ Test 2 + Verdrahtungstest 4 |
| A7 | Zweiter `attach` auf demselben Wirt → dieselbe Steuerung, kein zweiter Zuhörer | ✅ Test 7 |
| A8 | Menüband: fünf Kacheln umbrechend, `.t1` vollständig lesbar | ✅ Verdrahtungstest 5 |
| A9 | Statuszeile umbricht, der Kontinent-Trichter bleibt im Fenster | ✅ Verdrahtungstest 5 |
| A10 | Am Touch: keine Drop-Zonen, kein `cursor: grab`, Zeilen mit Touch-Ziel | ✅ Verdrahtungstest 5 |
| A11 | Das Fenster füllt am Telefon den Bildschirm (keine Inline-Maße mehr) | ✅ Verdrahtungstest 6 |
| A12 | Das ganze Testfeld grün (Muster des Workflows) | ✅ 544 JS / 410 PHP, null rot |

⭐ **24 Mutationen gefahren, alle gefangen.** Zwei entkamen zunächst und haben je eine echte Lücke
gezeigt:
- `.avm-tabs {` umbenannt blieb grün, weil die Reihenfolge-Zusicherung ein blankes
  `indexOf(A) < indexOf(B)` war — und `-1 < irgendwas` ist wahr. **Die `-1`-Falle aus AGENTS.md §9**,
  eine Etage weiter: erst die Stellen prüfen, dann vergleichen.
- Die zweite Mutation (attach-Ergebnis in eine `const`) hatte gar nicht gegriffen; von Hand
  angewandt wird sie gefangen.

## 3a. Zwei Fallen beim Bau, beide vor dem ersten Browser gefunden

- 💣 **`--avm-col-pad` ist ein ZWEIwert** (`var(--space-6) var(--space-12)` = 8px 14px). Der erste
  Bau polsterte die Leiste mit `padding: 0 var(--avm-col-pad)` — daraus wird `0 8px 14px`, also
  oben 0, seitlich 8 und **unten 14**. Die Leiste stand 6px links von den Spaltentiteln und trug
  ein Polster, das niemand bestellt hatte. Es sieht nach einem Versehen im Abstand aus, nicht nach
  einem falschen Token, und ein Browser hätte es kaum verraten. Richtig ist `--space-12`, der
  Seiteneinzug dieses Hauses, und der ist ein EINwert.
- ⚠️ Beim PHP-Testlauf zuerst **30 statt 410 Dateien** gefahren und „null rot" gemeldet — genau die
  Klammer-Falle, die AGENTS.md §9 ausschreibt (`find A -o \( B \) -print0` bindet `-print0` nur an
  die zweite Gruppe). Die Gegenprobe ist die Dateizahl, und nur sie.

## 3b. Gemessen (gerechnet, nicht im Browser)

- Menüband am 390px-Telefon: 2 Spalten × 3 Reihen ≈ **200px**. Darunter bleiben bei 780px
  Bildschirmhöhe **~500px Arbeitsfläche (64%)**, bei 844px ~564px (66%).
- Die `?v=`-Gegenprobe aus §7 ist gefahren: **keine** der vier handgestempelten `.php`-Seiten
  (`admin/index.php`, `edit/index.php`, `edit/backup.php`, `edit/svg-export.php`) erreicht eine der
  geänderten Dateien — auch nicht über die `@import`-Kette (alle vier hängen an `edit.css`, die
  `editor-page.css` nie einbindet). `ASSET_VERSION` in `territory-editor-inline-host.js` ebenso
  nicht: dessen Asset-Liste enthält keine davon.

## 4. Offen

- 🔧 **Aussortieren und „zur Wurzel machen" gehen am Telefon weiterhin nicht** — sie hängen an
  HTML5-Drag'n'drop. Der Weg dorthin wäre ein Tipp-Weg („Knoten wählen → Ziel wählen"), und das
  ist ein eigenes Stück Arbeit, keine Media-Query.
- 🔧 **Nicht auf einem echten Telefon abgenommen.** Diese Sitzung hat keinen Browser und keinen
  Zugang zu avesmaps.de; gemessen ist am Markup und am Regelwerk, gefahren ist das Testfeld.
  Bildschirmtastatur und echtes Touch-Verhalten kann hier niemand beantworten (AGENTS.md §9:
  „Was ein Emulator nicht beantworten kann, wird als offene Frage gemeldet, nicht als bestanden").
- 🔧 **Die anderen elf Editorseiten bleiben unberührt.** Das Bauteil ist geteilt, damit der nächste
  eine Zeile kostet — verdrahtet ist es hier, weil sichtbare Änderungen einzeln live gehen (§9).
