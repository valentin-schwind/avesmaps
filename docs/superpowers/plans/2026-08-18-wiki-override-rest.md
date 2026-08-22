# Bauplan · Wiki-Override, was noch fehlt: Region · Landschaftslabel · Weg

> **Angelegt 18.08.2026, am 22.08.2026 gegen den Code nachgemessen und an vier Stellen korrigiert
> (§6).** Ersetzt für die verbleibenden Stufen den Plan
> `docs/superpowers/plans/2026-08-17-wiki-override-ort.md` — jener beschreibt den Ort, ist
> abgearbeitet, und seine Layout-Anweisungen sind vom Owner überholt worden (§2).
> Entwurf: `docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md`.

## 1 · Wo das Ding wirklich steht — am 22.08.2026 gemessen, nicht erinnert

| Objektart | Wiki-Felder | Zustand |
|---|---:|---|
| ort | 5 | **live** (Ortseditor + Kartendialog) |
| literatur | 10 | **live**, samt Reparatur der kaputten `field_origins` |
| territorium | 4 | hatte es schon (`metadata_overrides_json`) |
| **landschaft** | **2** | Server stempelt · **beide Oberflächen fehlen** |
| **landschaftslabel** | **2** | Server stempelt · **Oberfläche fehlt** |
| **weg** | **1 (+1)** | nichts gebaut |
| kraftlinie · karte | 0 | bekommen nichts — dort landet kein Wiki-Wert auf einem Kartenfeld |

**24 Kartenziele**, am 22.08. aus dem Feldregister neu gezählt (Zeilen mit `karte !== ""`) —
unverändert gegenüber dem 17.08., obwohl 93 fremde Commits dazwischenliegen.

## 2 · 🔴 Was gegenüber dem ALTEN Plan (17.08.) gilt

1. **50 | 50 statt drei Spalten.** Owner 17.08.2026, wörtlich: „50% | 50% · Text
   --durchgestrichener text-- ↺ | Eingabe". Der durchgestrichene Wiki-Stand steht IN der
   Beschriftung, links; das Eingabefeld bekommt die andere Hälfte. Die Token `--avm-wiki-alt-w`
   und `--avm-wiki-input-min` sind ersatzlos gefallen, ebenso die Zelle `.dt-alt`.
2. **Zwei Bauformen — und das CSS entscheidet, welche gilt, nicht das Markup:**
   - Beschriftung **links** → `.dt-grid--wiki`, zwei gleiche Hälften, Wiki-Stand in der `.k`-Zelle.
   - Beschriftung **oben** → `.wiki-alt` in der Beschriftung.
   🪤 Der Literatur-Editor sieht im Markup aus wie ein Kartendialog, ist im CSS aber ein Flex-ROW
   mit fester Beschriftungsspalte — die falsche Annahme brach „ISBN (für DNB)" auf drei Zeilen.
3. **Das Listensymbol ist KEINE offene Pflicht.** Gebaut und am selben Tag zurückgenommen
   (`94889119` — „die Raute fällt weg, der grüne Kreis sagt das längst").

## 3 · 💣 Der Befund, der diesen Plan dringend macht — am 22.08. erneut bestätigt

**Die Serverhälfte für Landschaft und Label IST auf `master` und live**, obwohl ihr Commit
„ABSICHTLICH NICHT auf master" heißt (`85cd1e62`). Sie ist beim Push des AGENTS.md-Commits als
darunterliegender Commit der Kette mitgereist. Ein Commit-Betreff ist keine Sperre.

Am 22.08. nachgemessen, beide Hälften unverändert:
- `avesmapsEcosystemApplyRegionFieldOrigins` und `AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS` stehen da.
- **Keine** der fünf offenen Oberflächen schickt `wiki_uebernommen`.

Folge: jedes Speichern, das `name`/`region_type` bzw. `text`/`feature_subtype` ändert, stempelt
`manual` — auch wenn der **Sync-Knopf** die Änderung verursacht hat.
🔴 Die Richtung ist die sichere (ein falsches `manual` überschützt, es verliert nichts), und
**nichts liest die Daten heute**. Aber es sammelt sich falsches Wissen an.

**Entscheidung:** Oberflächen nachziehen statt Serverhälfte zurückbauen.

## 4 · Die Aufgaben

### 🆕 Aufgabe 0a · EIN Stylesheet, bevor irgendetwas dazukommt (Owner 22.08.2026)

Owner: „wichtig wär mir, dass du ein einheitliches stylesheet hast." Gemessen: **hat es nicht.**
Die Override-Regeln stehen ZWEIMAL — `.dt-grid--wiki`, `.dt-old`, `.dt-reset`, `.k.ovr`,
`.wiki-alt` in `css/components/editor-page.css`, und `.wiki-alt` samt Anhang noch einmal in
`css/components/location-report-dialog.css`. Die Klassennamen sind gleich, die Regeln doppelt.

🔴 Grund ist echt, nicht Nachlässigkeit: ein Editorfenster ist ein eigenes Dokument und lädt
`css/styles.css` nie; `index.html` lädt `editor-page.css` nie. Aber genau dafuer hat das Haus ein
MUSTER, und es steht wörtlich im Kopf von `editor-page.css`: „erneut zu deklarieren hiesse,
denselben Wert an zwei Stellen zu führen; genau das hat diese Datei einmal beendet."

⭐ Zwei Vorbilder, beide gelöst: `css/components/editor-row.css` (die geteilte Listenzeile) und
`css/components/map-status-circle.css` („drei Wirte") — je EINE Datei, importiert von
`editor-page.css` UND `css/styles.css`.

**Zu tun, vor allem anderen:**
- Neue Datei `css/components/wiki-override.css` mit ALLEN Regeln des Overrides — beide Bauformen.
- `@import url("wiki-override.css");` im Kopf von `css/components/editor-page.css` (⚠️ ein
  `@import` muss VOR jeder Regel stehen — deshalb oben, neben dem für `editor-row.css`).
- `@import url("components/wiki-override.css");` in `css/styles.css`.
- Die doppelten Blöcke aus beiden Dateien entfernen.
- Test `js/pages/__tests__/wiki-override-eine-quelle.test.js` mit **zwei Hälften**, wie beim
  Wappen-Fall (🪤 hier stand `css/__tests__/…`; dort **fährt die CI nie** — ihr Muster lautet
  `find js tools …`, `css/` kommt darin nicht vor. Vorbild ist
  `js/pages/__tests__/editor-row-single-source.test.js`, das aus demselben Grund CSS prüft):
  1. keine der Regeln steht mehr ausserhalb von `wiki-override.css`, und
  2. **beide** Welten binden die Datei ein.
  💣 Nur die erste Hälfte zu prüfen ist der Fehler von `avesmapsCoatSrc`: eine geteilte Datei, die
  nur EIN Dokument lädt, ist keine geteilte Datei — dort kostete es die IP-Sperre.
- ⚠️ **Sichtbar ändert sich nichts.** Reines Zusammenlegen; der Beleg ist das volle Testfeld plus
  ein Blick auf beide Bauformen im gerenderten Zustand.

🔴 **Warum ZUERST:** die Stufen 2–5 fassen fünf weitere Oberflächen an. Ohne diesen Schritt stünde
dieselbe Regel danach an zwei Orten und würde von fünf Oberflächen benutzt — die Divergenz, die
dieses Feature gerade beseitigen soll, eingebaut in das Feature selbst.

### Aufgabe 0 · Die Merkliste zuerst, die Anzeige danach
Je Oberfläche zuerst `wiki_uebernommen` in den Speicher-Rumpf, dann die Zeile. Damit hört das
Falschstempeln beim ersten Deploy auf, auch wenn die Anzeige noch nicht sitzt.
⚠️ Für die Landschaft sind es **zwei** Oberflächen; eine allein genügt nicht.

### Aufgabe 1 · 🆕 Die Herkunft muss beim Landschafts-Editor erst ANKOMMEN
**Am 22.08. gemessen, und es ändert die Arbeit:** `list_regions` gibt `properties_json`
**absichtlich nicht** heraus. Der Kommentar an der Projektion sagt warum: *„die Oberflächen
brauchen die Antwort, nicht die Ablage, und ein `properties_json` auf der Leitung wäre die
Einladung, dort noch etwas anderes hineinzuschreiben."* Der dritte Zustand reist deshalb als
BOOLEAN (`wiki_no_article`), serverseitig aus der Ablage abgeleitet.

🔴 Also **dieselbe Bauform für die Herkunft**: eine fertige, auf die zwei Kartenfelder gefilterte
Karte `field_origins` in die Projektion (`api/_internal/app/ecosystem.php`, neben
`wiki_no_article`) — **nicht** das rohe `properties_json`.
⚠️ Der alte Plan sagte „die Oberfläche muss `field_origins` nur noch in ihre Quelle legen". Das war
falsch: die Daten sind gar nicht auf der Leitung.

### Aufgabe 2 · Landschaft — Editorfenster (`html/landschaften-editor.html`)
Bauform `.dt-grid`, Rezept **50/50**. Die zwei Zeilen heißen dort **Name** und **Art**
(`regionEditBlock`, `data-f="name"` / `data-f="type"` — am 22.08. bestätigt).
Datenweg `avesmapsWikiAssignLandschaftZustand` gibt `herkunft` bereits heraus.
🔴 Die Klimazone hat eine **gesperrte** Art (`gesperrt.region_type`, weiterhin vorhanden); dort
darf kein ↺ erscheinen.

### Aufgabe 3 · Landschaft — Kartendialog „Fläche bearbeiten"
`js/map-features/map-features-ecosystem-properties.js` + `index.html`
(`.ecosystem-properties-dialog__field`, Beschriftung **oben** → `.wiki-alt`).
✅ **Keine CSS-Kopie nötig** (am 22.08. gemessen): `location-report-dialog.css` kommt über
`css/styles.css` in `index.html`, `.wiki-alt` ist dort also schon da. Die Sorge des alten Plans
vor einer dritten Fassung ist gegenstandslos.

### Aufgabe 4 · Landschaftslabel — Label-Dialog
`js/review/review-label-wiki.js` + `index.html` (`location-report-form__field`, Beschriftung oben).
✅ **Die Herkunft ist schon auf der Leitung**: die Label-Projektion im Browser liest
`properties.*` direkt (`map-features-labels.js`), der Kartenpayload filtert nichts weg. Es fehlt
nur die Zeile `fieldOrigins: properties.field_origins || null` — kein Server-Eingriff.
Felder: `text`, `feature_subtype`. Nutzlast: `buildLabelEditPayload`.

### Aufgabe 5 · Weg — und er ist der aufwendigste, nicht der kleinste
Zwei Oberflächen: `js/pages/wege-editor.js` (`.dt-grid` → 50/50) und der Kartendialog
`#path-edit-*` (Beschriftung oben → `.wiki-alt`).

💣 **ZWEI Schreibwege, nicht einer** — am 22.08. zur Laufzeit gezählt (fünf Funktionen schreiben
`feature_subtype` in `map_features`, zwei davon gehören dem Weg):
- `avesmapsUpdatePathFeatureDetails` — ein Abschnitt.
- `avesmapsUpdatePathGroupDetails` — die **Weg-Ebene** (19.08.2026): schreibt `name`,
  `feature_subtype` und `properties_json` in einer Schleife über ALLE Abschnitte einer
  Namensgruppe. Die Herkunft muss dort **je Abschnitt** gestempelt werden.
⭐ Der Gruppen-Schreiber führt bereits eine Liste „was jemand angefasst hat"
(`AVESMAPS_PATH_GROUP_FIELDS` + `fields` im Rumpf) — genau die Angabe, die der Stempler braucht.

🔴 **Der Name ist die eigene Überlegung dieser Stufe:** ihn schreibt `assign_to` serverseitig auf
den ganzen Namensverbund. Er ist damit per Definition aus dem Wiki — die Herkunft dafür gehört an
die Zuweisung, nicht an das Speichern des Formulars.

### Aufgabe 6 · Das Tor
🆕 **Der Deploy fährt ein BREITERES PHP-Muster als AGENTS.md §9.** Der Workflow läuft
`find api tools \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \)`
— also **jede** `.php` unter `__tests__`, nicht nur `*-test.php`. Gemessen am 22.08.:

| Lauf | Anzahl | rot |
|---|---:|---|
| JS (`*.test.js` unter `__tests__`) | 211 | 0 |
| **PHP nach CI-Muster** | **244** | 1 (`linkcheck/link-url-test.php`, echter DNS-Abruf) |
| `tools/wikidump/test-*.php` | 21 | 0 |
| `.mjs` unter `tools/` | 21 | **4 — vorbestehend** |

⚠️ **Die vier roten `.mjs` sind KEIN Deploy-Tor.** Der Workflow sagt es ausdrücklich: sie „would
block every deploy. They need fixing before they can be added". Sie stehen hier, damit niemand sie
für eine eigene Regression hält: `test-place-scope-filter`, `test-route-leg-popup`,
`test-wiki-sync-verb-row`, `test-client-route-flow`.

## 5 · Die Abhak-Liste

- [x] **EIN Stylesheet zuerst** — `wiki-override.css`, importiert von BEIDEN Welten (A0a) · live 22.08.2026
- [x] Der Stylesheet-Test hat ZWEI Hälften: nirgends sonst · und beide Welten laden ihn (A0a)
- [x] Jede Oberfläche schickt `wiki_uebernommen`, **bevor** ihre Anzeige gebaut wird (A0) · alle fünf Objektarten live 22.08.2026
- [x] Beide Landschafts-Oberflächen, nie nur eine · Merkliste live 22.08.2026 in beiden
- [x] Landschaft: die Herkunft als **fertige Antwort** projizieren, nie `properties_json` (A1) · live 22.08.2026
- [x] Bauform aus dem **CSS** bestimmt, nicht aus dem Markup (§2.2) · Landschaft live 22.08.2026
- [x] Keine dritte `.wiki-alt`-Kopie — sie ist über `styles.css` schon da (A3) · nur EIN neuer Wirt für die braune Beschriftung
- [x] Klimazone: kein ↺ auf der gesperrten Art (A2) · in BEIDEN Landschafts-Oberflächen
- [x] Weg: **beide** Schreibwege stempeln, der Gruppen-Schreiber je Abschnitt (A5) · es waren **DREI** — der Anlegefall kam dazu, gefunden vom Wachtest
- [x] Weg: die Herkunft des Namens hängt an `assign_to`, nicht am Formular (A5)
- [x] Kein geratener Feldname — jeder Payload-Schlüssel vorher gemessen
- [x] Jede neue Zusicherung EINZELN mutiert, roter Lauf mit echter Meldung festgehalten · 🪤 drei Zusicherungen überlebten ihre erste Mutation und mussten geschärft werden
- [x] Testfeld gegen die Baseline aus A6, **mit dem CI-Muster**, nicht dem aus §9 · PHP 246/1 (vorbestehend), JS 217/0, wikidump 21/0
- [x] **Vor dem Push `git log origin/master..HEAD` lesen** — eine Kette nimmt alles mit (§3) · vor jedem der sieben Pushes

## 6 · 🪤 Was am 22.08.2026 gegenüber der Fassung vom 18.08. korrigiert wurde

Vier Annahmen sind an der Wirklichkeit gemessen worden; drei waren falsch. Sie stehen hier, damit
die Korrektur nicht als „war schon immer so" verschwindet:

1. **„Die Oberfläche muss `field_origins` nur noch in ihre Quelle legen"** (Landschaft) — falsch.
   `list_regions` gibt die Ablage bewusst nicht heraus; es braucht eine Projektion (A1).
2. **„Erst prüfen, ob eine dritte `.wiki-alt`-Kopie nötig ist"** — geprüft, nicht nötig (A3).
3. **„Weg: erst messen, ob es mehr als einen Schreibweg gibt"** — gemessen: **zwei**, und der
   zweite schreibt eine ganze Namensgruppe (A5). Der Weg ist damit die aufwendigste Stufe, nicht
   die kleinste; der alte Plan führte ihn als „ein Feld".
5. **„Die Regeln stehen ZWEIMAL“** — es waren **DREI**: `.ae-field > label.has-wiki-ovr`
   stand zusätzlich inline in `html/game-literature-editor.html`. Mit entfernt.
6. **„Sichtbar ändert sich nichts“** — fast. Beim Zusammenlegen gemessen: das ↺ trug in der
   Editor-Fassung `margin-left: var(--space-4)` **zusätzlich** zum 4px-`gap` von `.wiki-alt`, im
   Kartendialog nie — 10px gegen 4px. Vereinheitlicht auf den `gap`; die Editoren rücken ihr ↺
   um 6px nach links, sonst nichts. A/B am gerenderten Zustand gemessen, beide Bauformen,
   inklusive einer überlangen Zeile (die war vorher wie nachher auf `…` gekappt).
7. 💣 **Die Kaskade dreht sich beim `@import` um.** Ein `@import` muss vor jeder Regel stehen,
   die geteilte Datei steht also **oben** — und damit käme `.dt-grid` (0,1,0) **nach**
   `.dt-grid--wiki` (0,1,0) und gewänne bei `grid-template-columns`: die 50/50-Zeile fiele
   lautlos auf 130px|1fr zurück, bei der `.k`-Zelle kollidiert `white-space` genauso. Deshalb
   heißt die Regel `.dt-grid.dt-grid--wiki` (0,2,0). Für jede weitere Regel, die in eine
   geteilte, oben importierte Datei wandert, ist das die erste Frage.

4. **Baseline** — das Muster aus AGENTS.md §9 ist schmaler als das des Deploys (235 gegen 244
   Dateien), und es gibt vier vorbestehend rote `.mjs`, die kein Tor sind (A6).
