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

| A13 | Der Reiter trägt ein Touch-Ziel — der einzige Weg zwischen den Spalten | ✅ Verdrahtungstest 4b |
| A14 | Die 680px-Regel der Fensterhülle gilt NUR dem Sync-Fenster (drei andere unberührt) | ✅ Verdrahtungstest 4e |

⭐ **38 Mutationen gefahren, alle gefangen** (24 im ersten Durchgang, 14 auf die Agentenbefunde).
Zwei entkamen zunächst und haben je eine echte Lücke gezeigt:
- `.avm-tabs {` umbenannt blieb grün, weil die Reihenfolge-Zusicherung ein blankes
  `indexOf(A) < indexOf(B)` war — und `-1 < irgendwas` ist wahr. **Die `-1`-Falle aus AGENTS.md §9**,
  eine Etage weiter: erst die Stellen prüfen, dann vergleichen.
- Die zweite Mutation (attach-Ergebnis in eine `const`) hatte gar nicht gegriffen; von Hand
  angewandt wird sie gefangen.

## 3a. Fallen beim Bau

- 💣 **`--avm-col-pad` ist ein ZWEIwert**, und dieser Punkt war **zweimal falsch** — das zweite Mal
  gefunden von der Konsistenzprüfung, nachdem der erste Fund schon als behoben galt:
  1. Der erste Bau polsterte die Leiste mit `padding: 0 var(--avm-col-pad)`. Daraus werden DREI
     Werte (`0 8px 12px`): oben 0, seitlich 8, **unten 12**. Nicht die gemeinte Kante, und unten
     ein Polster, das niemand bestellt hat.
  2. 🪤 Die Korrektur schrieb daraufhin `--space-12` (14px) hin, begründet mit „der Seiteneinzug ist
     überall 14" — **und das gilt hier nicht.** Der globale Token steht auf
     `var(--space-6) var(--space-10)` = 8px/**12**px; die 14px-Fassungen sind Überschreibungen an
     **Fensterhüllen im ELTERNdokument** (`political-territory-editor-overlay.css` und sechs
     Geschwister). **Custom Properties kreuzen keine iframe-Grenze** — eine Editorseite im iframe
     liest den globalen Wert. Die Leiste stand damit 2px neben den Spaltentiteln, also genau das
     Gegenteil der Garantie, die der Kommentar behauptete. ⭐ Die Lehre: eine Zahl, die man aus
     einem Token **rechnen** kann, wird nicht abgeschrieben — der Test liest die Seitenkomponente
     von `--avm-col-pad` aus `tokens.css` und hält das Polster der Leiste dagegen.
- ⚠️ Beim PHP-Testlauf zuerst **30 statt 410 Dateien** gefahren und „null rot" gemeldet — genau die
  Klammer-Falle, die AGENTS.md §9 ausschreibt (`find A -o \( B \) -print0` bindet `-print0` nur an
  die zweite Gruppe). Die Gegenprobe ist die Dateizahl, und nur sie.
- 🪤 **Ein Markdown-Reflex im CSS-Kommentar hat einen FREMDEN Test rot gemacht.** Die Betonung
  `8px/**12**px` enthält `/*` — `js/app/__tests__/css-comment-balance.test.js` zählt Öffnungen
  gegen Schließungen und meldete „nicht geschlossener Kommentar" am Dateiende von
  `editor-body.css`. Genau der Fall aus AGENTS.md §9: „Wer nur seine eigenen Tests laufen lässt,
  sieht so etwas nie: die Datei, die bricht, gehört jemand anderem." ⭐ In einem CSS-Kommentar wird
  betont, indem man das Wort ausschreibt — und der Deploy ist ein Tor, ein roter Test lädt nichts
  hoch.

## 3c. Was die zwei Prüfagenten gefunden haben (alles nachgebaut)

`usability-konsistenz` und `usability-design`, gefahren vor dem Push (AGENTS.md §9). Sieben echte
Befunde; **die zwei schwersten hat kein Test und kein eigener Blick gesehen**:

1. 🔴 **Die zwei Klassen der Fensterhülle tragen VIER Fenster, nicht eines.**
   `.political-territory-editor-overlay` / `.political-territory-editor-dialog` stehen wortgleich am
   Gebietsdialog (`index.html:438`), an „Literatur bearbeiten" und „Karten bearbeiten"
   (`review-settlement-list.js:852/925`) und am Sync-Editor. Die erste Fassung der 680px-Regel war
   klassenweit — sie hätte den Gebietsdialog umgestellt, **den der Entwurf in §1 ausdrücklich
   ausnimmt**, und den zwei anderen Rand und Radius genommen, während ihre Inline-Maße blieben:
   ein randloses Fenster mit 12px Luft. ⭐ Jetzt ist die Regel auf `#avesmaps-sync-editor-overlay`
   gescopt, und das Grundmaß der drei anderen steht unverändert daneben. **Einengen, nicht
   mitziehen:** bildschirmfüllend wäre für sie eine halbe Verbesserung — außen randlos, innen
   unverändert eng, weil ihre Seiten wie alle zwölf Editorseiten keine Media-Query haben.
2. 🔴 **Der Reiter war kleiner als die Zeilen, die er erschließt.** `.avm-tab` ist für einen Zeiger
   gebaut (`padding: var(--space-4) 1px`, `min-height: 0` → ~27px bei 1px seitlichem Polster), und
   am Telefon ist er der **einzige** Weg zwischen den Spalten. Der Befund wog doppelt: derselbe
   Umbau forderte für die Menübandkacheln daneben ausdrücklich 44px — zwei Maße für dieselbe Frage
   in einem Commit. Ebenso `.row`/`.node`: gerechnet ~35px bzw. ~31px statt 44.
   ⭐ Daraus ist der Token **`--avm-touch-h: 44px`** entstanden: die 44 stand im Haus schon an
   **vier** Stellen als eigene Zahl (`media-license-fields.css`, `review-panel.css`,
   `place-extras.css` zweimal); eine fünfte wäre die Divergenz, die §12 verbietet. Die vier
   Altstellen sind bewusst nicht nachgezogen (unbestellter Umbau) — wer eine anfasst, holt sie her.
   💣 Der Selektor ist `.avm-spalten-reiter .avm-tab` (0,2,0), nie `.avm-tab`: jene Klasse trägt die
   Reiterzeilen von elf anderen Oberflächen.
3. 💣 **`.col + .col` hinterließ eine tote Trennlinie.** Ein Geschwister-Selektor liest den
   DOM-Baum, nicht die Sichtbarkeit: `display: none` an der Spalte davor nimmt die Linie nicht
   zurück. Auf „Modell" und „Details" blieb ein 1px-Strich am linken Rand der einzigen sichtbaren
   Spalte — und seit das Fenster randlos ist, sichtbar am Bildschirmrand. Den
   Einzelspalten-Zustand erzeugt erst dieser Umbau; die Regel selbst ist älter.
4. 💣 **Die Übernahme-Vorschau hat VIER verschachtelte Polster, und das äußere allein löst
   nichts.** Der erste Bau verkleinerte nur `.sync-plan-host` (18 → 8) — und tat das im
   `<style>`-Block der Seite, also als lautlose Überstimmung eines geteilten Bauteils, **wovor
   dieselbe Seite 20 Zeilen darüber ausdrücklich warnt**. Übrig blieben drei innere 18er
   (`summary`, `.rows`, `.gate`): effektiv 8+18 = 26px je Seite, von 366px Breite 14 %. ⭐ Die
   Regel steht jetzt im Blatt des Bauteils (`sync-plan-sheet.css`) — keine Überstimmung, sondern
   seine eigene Regel, und alle vier Polster zusammen, weil sie EINE Kante bilden.
5. ⚠️ **`select#filter` fehlte das `min-width: 0`, das sein Nachbar seit jeher hat** — mit
   derselben Begründung, die eine Zeile darüber ausgeschrieben steht („der Filter-Trichter wird aus
   der schmalen Spalte hinausgedrückt, gemessen 50px"). Ein Flex-Kind mit `min-width: auto`
   schrumpft nicht unter seine Inhaltsbreite, und „🗑 Papierkorb (aussortiert)" ist die längste
   seiner zehn Optionen. Die Filterzeile bricht jetzt zusätzlich um.
6. ⚠️ **`.colfoot` bekam nicht die Behandlung, die derselbe Umbau dem Menüband gibt** — drei
   Knöpfe zu je ~100px zerlegten „🔗 Namensgleiche vorschlagen" in vier Zeilen. „Lesbar schlägt
   gleich hoch" gilt auch dort.
7. 🔧 **Zwei Geschwister-Overlays tragen dieselbe Inline-Style-Falle weiter**
   (`review-settlement-list.js:861/934`). Nicht behoben — siehe Befund 1 und §4: ihr Inneres ist
   nicht umgebaut, also wäre nur die Hülle richtig. Notiert, damit der nächste Schritt dort anfängt.

## 3b. Gemessen (gerechnet, nicht im Browser)

- Menüband am 390px-Telefon: 2 Spalten × 3 Reihen ≈ **200px**. Darunter bleiben bei 780px
  Bildschirmhöhe **~500px Arbeitsfläche (64%)**, bei 844px ~564px (66%).
- Die `?v=`-Gegenprobe aus §7 ist gefahren: **keine** der vier handgestempelten `.php`-Seiten
  (`admin/index.php`, `edit/index.php`, `edit/backup.php`, `edit/svg-export.php`) erreicht eine der
  geänderten Dateien — auch nicht über die `@import`-Kette (alle vier hängen an `edit.css`, die
  `editor-page.css` nie einbindet). `ASSET_VERSION` in `territory-editor-inline-host.js` ebenso
  nicht: dessen Asset-Liste enthält keine davon.

## 3d. 🔴 Der Befund aus der Live-Abnahme: das Blatt gehört NEBEN sein Bauteil, nicht hinter eine Kette

Owner-Bilder vom 13.09.2026, 01:13 und 01:31, nach dem Deploy. Sie zeigen einen Zustand, der mit
der neuen `editor-body.css` **in keiner Fensterbreite möglich** ist:

- Die Reiterleiste ist **gebaut**, „Lücken" ist als aktiver Reiter markiert — und im zweiten Bild
  springt sie nach „Aus dem Editor geöffnet: „Nordhjaldor"" selbst auf **„Details"**. Das ganze
  JavaScript samt `selectKey`-Trichter läuft also.
- Aber die Leiste liegt **über** der Statuszeile statt darüber im Fluss, und **alle drei Spalten**
  stehen weiter da.

Über 680px wäre die Leiste unsichtbar (`display: none`), unter 680px stünde eine Spalte. Sichtbare
Leiste *plus* drei Spalten gibt es nur, wenn `.avm-spalten-reiter` und `.avm-spalte-aus` in der
geladenen Datei **fehlen** — und dann trägt `.avm-tabs` allein, ohne `flex: 0 0 auto`, also
schrumpft die Leiste in der `height: 100vh`-Spalte auf null und ihr Inhalt überlappt. Genau das Bild.

**Drei Verdächtige geprüft, alle drei entlastet:**
- Die Stempel-Kette ist korrekt: `editor-page.css` ging von `07d930d904` auf `bcd87a48f8`,
  `editor-body.css` von `cda4ab0cb4` auf `2f5b79a268` (Stamper lokal gegen beide Stände gefahren).
  `verify-stamped-chain.py` bestätigt sie.
- Die Datei stand in der Änderungsliste des Deploys (`git diff --name-only --diff-filter=ACMRT
  a99564b 211e1dc`), `css` ist in der Allowlist → sie war im Paket.
- Keine konkurrierende `.avm-tabs`-Regel in einem der Blätter, die der Monitor lädt.

🔴 **Der Unterschied, der es zeigt, steht im selben Deploy:** die **neue** Datei
`editor-spalten-reiter.js` lief sofort, die **geänderte** `editor-body.css` nicht. Eine neue Datei
KANN nicht gecacht sein — eine geänderte hinter einem `@import` schon. Der Monitor erreicht
`editor-body.css` nur über `editor-page.css` und dessen `@import`: ein Verweis mehr, und damit eine
Gelegenheit mehr.

⭐ **Die Regeln stehen deshalb jetzt in `css/components/editor-spalten-reiter.css`, mit eigenem
`<link>` an der Seite** — Bauteil und Blatt unter demselben Namen, wie `karten-abzug.js` +
`karten-abzug.css`. Das war ohnehin die Hausform; die Ablage in `editor-body.css` hatte nur das
schwächere Argument („die Reihenfolge zu `.avm-tabs` muss nachlesbar sein").

💣 **Und damit trägt die Spezifität, nicht die Ladereihenfolge:** `.avm-tabs.avm-spalten-reiter`
(0,2,0) schlägt `.avm-tabs` (0,1,0) unabhängig davon, welches Blatt später lädt. Einklassig läge sie
gleichauf — „eine Regel, die nur über die Ladereihenfolge gilt, ist keine Regel". Dieselbe Hausform
wie `.modal-box.wide` im Monitor. Der Test prüft beide Klassen und verbietet den Rückfall nach
`editor-body.css` ausdrücklich.

⚠️ **Ob die alte Fassung noch aus dem Browser-Cache kam oder vom Server, ist nicht geklärt** — von
dieser Sitzung ist avesmaps.de nicht erreichbar (Egress-Policy). Die neue Ablage macht die Frage
gegenstandslos: ein Pfad, den es vorher nicht gab, kann nicht alt sein.

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
