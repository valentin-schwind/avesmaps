# Bauplan · Wiki-Override, was noch fehlt: Region · Landschaftslabel · Weg

> **Stand 18.08.2026.** Ersetzt für die verbleibenden Stufen den Plan
> `docs/superpowers/plans/2026-08-17-wiki-override-ort.md` — jener beschreibt den Ort, ist
> abgearbeitet, und seine Layout-Anweisungen sind vom Owner überholt worden (siehe §2).
> Entwurf: `docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md`.

## 1 · Wo das Ding wirklich steht — am 18.08.2026 gemessen, nicht erinnert

| Objektart | Wiki-Felder | Zustand |
|---|---:|---|
| ort | 5 | **live** (Ortseditor + Kartendialog) |
| literatur | 10 | **live**, samt Reparatur der kaputten `field_origins` |
| territorium | 4 | hatte es schon (`metadata_overrides_json`) |
| **landschaft** | **2** | Server stempelt · **beide Oberflächen fehlen** |
| **landschaftslabel** | **2** | Server stempelt · **Oberfläche fehlt** |
| **weg** | **1 (+1)** | nichts gebaut |
| kraftlinie · karte | 0 | bekommen nichts — dort landet kein Wiki-Wert auf einem Kartenfeld |

Die Zahlen sind am 18.08.2026 neu aus dem Feldregister gezählt (Zeilen mit `karte !== ""`), nicht
aus dem Entwurf übernommen: **24 Kartenziele, unverändert** gegenüber dem 17.08.

## 2 · 🔴 Was sich seit dem alten Plan geändert hat

1. **50 | 50 statt drei Spalten.** Owner 17.08.2026, wörtlich: „50% | 50% · Text
   --durchgestrichener text-- ↺ | Eingabe". Der durchgestrichene Wiki-Stand steht IN der
   Beschriftung, links; das Eingabefeld bekommt die andere Hälfte. Die Token `--avm-wiki-alt-w`
   und `--avm-wiki-input-min` sind ersatzlos gefallen, ebenso die Zelle `.dt-alt`.
   **Aufgabe 5 des alten Plans beschreibt die verworfene Fassung.**
2. **Zwei Bauformen — und das CSS entscheidet, welche gilt, nicht das Markup:**
   - Beschriftung **links** neben dem Feld → `.dt-grid--wiki`, zwei gleiche Hälften, Wiki-Stand
     in der `.k`-Zelle. So im **Ortseditor** und im **Landschaften-Editor**.
   - Beschriftung **oben** über dem Feld → `.wiki-alt` in der Beschriftung. So in den
     **Kartendialogen**.
   🪤 Der Literatur-Editor sieht im Markup aus wie ein Kartendialog (`<label>` vor dem
   Bedienelement), ist im CSS aber ein Flex-ROW mit fester Beschriftungsspalte — die falsche
   Annahme brach „ISBN (für DNB)" auf drei Zeilen.
3. **Das Listensymbol ist KEINE offene Pflicht mehr.** Der Owner-Dauerauftrag vom 17.08. („immer
   parallel Wiki-Zuweisung und Listen-Update") wurde gebaut und am selben Tag zurückgenommen
   (`94889119` — „die Raute fällt weg, der grüne Kreis sagt das längst").
   `js/review/review-list-wikistatus.js` existiert auf `master` nicht mehr.

## 3 · 💣 Der Befund, der diesen Plan dringend macht

**Die Serverhälfte für Landschaft und Label IST auf `master` und seit dem 17.08. live** — obwohl
ihr Commit „ABSICHTLICH NICHT auf master" heißt (`85cd1e62`). Sie ist beim Push des
AGENTS.md-Commits als darunterliegender Commit der Kette mitgereist.

Das ist die Falle aus `geteilter-baum-push-nimmt-fremde-commits-mit`: **ungepusht heißt nicht
geschützt, sondern abflugbereit** — wer eine Commit-Kette pusht, pusht die ganze Kette. Ein
Commit-Betreff, der „nicht auf master" sagt, ist keine Sperre; er ist eine Bitte an jemanden, der
den Betreff liest. Gelesen hat ihn niemand, weil `git push origin HEAD:master` nicht liest.

Was das heute anrichtet, gemessen:

- **Kein sichtbarer Schaden.** Nichts LIEST die neuen Herkünfte: `git grep field_origins` findet
  für Landschaft und Label ausschließlich Schreibstellen. Die Sync-Vorschau der Landschaft bekommt
  kein `field_origins` in ihre Quelle, `herkunft` bleibt leer, das Vorhäkeln verhält sich wie
  vorher.
- ⚠️ **Aber es sammelt sich falsches Wissen an.** Jedes Speichern, das `name`/`region_type` bzw.
  `text`/`feature_subtype` ändert, stempelt `manual` — auch wenn der **Sync-Knopf** der Landschaft
  die Änderung verursacht hat. Sobald die Oberflächen kommen, behauptet die Zeile für diese Felder
  „von uns", obwohl sie aus dem Wiki stammen.
- 🔴 **Die Richtung ist die sichere:** ein falsches `manual` überschützt, es verliert nichts. Es
  löst sich auf, sobald jemand das Feld mit ↺ zurückholt oder es erneut ändert.

**Entscheidung:** die Oberflächen nachziehen statt die Serverhälfte zurückbauen — ein Rückbau
kostet dieselbe Arbeit und ließe die bereits geschriebenen Einträge trotzdem stehen.

## 4 · Die Aufgaben

### Aufgabe 0 · Die Merkliste zuerst, die Anzeige danach
Je Oberfläche zuerst `wiki_uebernommen` in den Speicher-Rumpf, dann die Zeile. Damit hört das
Falschstempeln beim ersten Deploy auf, auch wenn die Anzeige noch nicht sitzt.
⚠️ Für die Landschaft sind es **zwei** Oberflächen; eine allein genügt nicht (die Falle vom
14.08.: eine Regel, die einen von zwei Erzeugern bindet, ist keine).

### Aufgabe 1 · Landschaft — Editorfenster (`html/landschaften-editor.html`)
- Bauform: `.dt-grid`, Rezept **50/50**. Die zwei Zeilen heißen dort **Name** und **Art**
  (`regionEditBlock`, `data-f="name"` / `data-f="type"`).
- Datenweg: `avesmapsWikiAssignLandschaftZustand` gibt `herkunft` bereits heraus (liegt auf
  master) — die Oberfläche muss `field_origins` nur noch in ihre Quelle legen.
- ⚠️ **Erst messen, was `list_regions` wirklich liefert**, bevor auf `region.properties`
  zugegriffen wird. Zweimal in dieser Sitzung war ein geratener Feldname der Fehler
  (`state.detail.wiki_kandidat`, `location.properties` — letzteres existierte gar nicht).
- 🔴 Die Klimazone hat eine **gesperrte** Art (`gesperrt.region_type`); dort darf kein ↺
  erscheinen — der Server lehnt die Änderung ohnehin ab.

### Aufgabe 2 · Landschaft — Kartendialog „Fläche bearbeiten"
`js/map-features/map-features-ecosystem-properties.js` + `index.html`
(`.ecosystem-properties-dialog__field`, Beschriftung **oben** → `.wiki-alt`-Rezept).
⚠️ Die Stilregeln dieses Dialogs stehen in `css/features/ecosystem-layer.css` — **erst prüfen, ob
`location-report-dialog.css` ohnehin mitgeladen wird**, sonst entstünde eine dritte Kopie
derselben `.wiki-alt`-Regeln. Zwei sind die Obergrenze.

### Aufgabe 3 · Landschaftslabel — Label-Dialog
`js/review/review-label-wiki.js` + `index.html` (`location-report-form__field`, Beschriftung oben
→ `.wiki-alt`; die Regeln stehen dort bereits, weil der Ort-Kartendialog sie nutzt).
Felder: `text`, `feature_subtype`. Nutzlast: `buildLabelEditPayload`.

### Aufgabe 4 · Weg
Zwei Oberflächen (`js/pages/wege-editor.js`, `js/review/review-path-wiki.js`), ein Kartenziel
(`feature_subtype`) plus `name`.
🔴 **Der Name ist die eigene Überlegung dieser Stufe:** ihn schreibt `assign_to` **serverseitig auf
den ganzen Namensverbund** (R1, `api/_internal/wiki/paths.php`). Er ist damit per Definition aus
dem Wiki — die Herkunft dafür gehört an die Zuweisung, nicht an das Speichern des Formulars.
⚠️ Erst messen, wo `map_features.properties_json` eines Wegs geschrieben wird und ob es dafür mehr
als einen Weg gibt. Vorbild: die Laufzeitzählung in `field-origins-test.php`, die beim Ort den
zweiten Schreibweg fand, den der Autor übersehen hatte.

### Aufgabe 5 · Das Tor
Ganzes Testfeld, alle drei Läufe. **Baseline am 18.08.2026 auf `master`: 188 JS grün · 191 PHP mit
genau einem vorbestehend roten (`linkcheck/link-url-test.php`, echter DNS-Abruf) · 21 Wikidump
grün.** Jeder weitere rote Test ist eine Regression.

## 5 · Die Abhak-Liste

- [ ] Jede Oberfläche schickt `wiki_uebernommen`, **bevor** ihre Anzeige gebaut wird (A0)
- [ ] Beide Landschafts-Oberflächen, nie nur eine
- [ ] Bauform aus dem **CSS** bestimmt, nicht aus dem Markup (§2.2)
- [ ] Keine dritte `.wiki-alt`-Kopie ohne Messung (A2)
- [ ] Kein geratener Feldname — jeder Zugriff auf einen Payload-Schlüssel vorher gemessen
- [ ] Klimazone: kein ↺ auf der gesperrten Art
- [ ] Weg: die Herkunft des Namens hängt an `assign_to`, nicht am Formular
- [ ] Jede neue Zusicherung EINZELN mutiert, roter Lauf mit echter Meldung festgehalten
- [ ] Ganzes Testfeld gegen die Baseline aus A5
- [ ] **Vor dem Push `git log origin/master..HEAD` lesen** — eine Kette nimmt alles mit (§3)
