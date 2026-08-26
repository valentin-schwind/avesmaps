# Landschaften: „Label ausblenden“ statt „Label löschen“

**Stand:** 2026-08-19 · **Anlass:** Discord-Fälle #80 und #81 (Thomas) · **Mockup:**
`docs/landschaften-loeschen-mockup.html`

## 1 · Der Anlass

> **Thomas:** „Landschaftsmodus: Wenn man auf Label löschen geht, löscht er auch zu gleich die
> dazugehörige Ebene.“
> **Owner:** „das is gewollt — dass es keine toten labels gibt.“
> **Thomas:** „ist aber andersrum. labels löscht ebene, nicht ebene löscht label. […] oder nenn es
> Label und Ebene löschen“

Die Kaskade ist richtig und bleibt. Falsch war nur, dass ein Knopf namens „Label löschen“ eine
Landschaft mitnimmt und die einzige Bremse davor ein Fließtext in einem `window.confirm` ist, den
man wegklickt.

## 2 · Der Ist-Zustand, gemessen

Nichts davon ist Vermutung; jede Zeile ist am Code nachgesehen.

- **Die Warnung gibt es längst.** `deleteLabelEntry` (`js/map-features/map-features-labels.js:915`)
  ruft `formatEcosystemLabelDeleteConfirmation`
  (`js/map-features/map-features-ecosystem-label-writeback.js:145`), und deren Wortlaut ist
  vollständig: *„Das ist das LETZTE Label von „Farindel“ — die Region und ihre 3 Flächen verschwinden
  mit.“* Sie hat den Fall nicht verhindert.
- **Der sanfte Weg gibt es längst.** Der Haken „Regionname anzeigen“ (`index.html:974`) setzt
  `show_name` am Label; ein Label mit `show_name === false` wird nicht gezeichnet
  (`map-features-labels.js:788`). Ort, Größe, Drehung und Zoom-Band bleiben erhalten. Er sitzt zwei
  Klicks tief im Eigenschaftendialog der Fläche, wo ihn niemand vermutet.
- 💣 **„Das letzte Label“ ist der NORMALFALL, nicht die Ausnahme.** Am Livebestand hat jede der 139
  Regionen genau eine Fläche (Messung im Kommentar an
  `map-features-ecosystem-context-action.js:180`). Jeder Löschklick führt heute in die Kaskade.
- **Es gibt genau EINEN Client-Löschweg** mit zwei Auslösern: `deleteLabelEntry`, erreicht über den
  Popup-Knopf (`js/routing/routing.js:1270`) und über `deleteActiveLabel` am Label-Dialog
  (`js/app/bootstrap.js:642`). Nachgezählt, nicht vermutet — die Vier-Erzeuger-Falle aus AGENTS.md
  §11 greift hier nicht. `js/review/review-labels.js` ist eine Darstellungs-Vorschau, kein Löschweg.

## 3 · Die Regel

🔴 **Owner-Entscheid 19.08.2026, wörtlich:**

> „lösch ich eine fläche ist auch das label weg, aber ich werde gewarnt
> lösch ich ein label wird es innerhalb der fläche deaktiviert (Label anzeigen aus)“

In einem Satz, mit den Ausnahmen aus §5:

> **„Label löschen“ blendet aus statt zu löschen, wenn dabei sonst eine Fläche verloren ginge —
> sonst löscht es wie bisher.**

🔴 Und der zugehörige Entscheid zur Endgültigkeit: **wer die Fläche behält, behält auch ihr Label.**
Ein ausgeblendetes Label wird man nur über „Fläche löschen“ endgültig los. Das ist der Preis dafür,
dass eine namenlose Fläche gar nicht erst entstehen kann.

## 4 · Was gebaut wird

### 4.1 Die Weiche im Löschweg

In `deleteLabelEntry`, vor der Rückfrage. Ausgeblendet wird genau dann, wenn **alle vier** Punkte
zutreffen:

1. das Label gehört zu einer Landschaftsregion (`ecosystemRegionOfLabel` liefert eine Zeile),
2. es ist ihr letztes (`ecosystemLabelCountOfRegion() === 1`),
3. die Region hat mindestens eine Fläche (siehe Falle F1),
4. die Kaskade ist nicht ausdrücklich abgeschaltet (siehe Falle F3).

Dann: `update_label` mit `public_id`, `text`, `feature_subtype`, `show_name: false` — statt
`delete_feature`. Sonst: alles wie heute.

⭐ Der Server schreibt nur, was mitkommt (`array_key_exists`, `api/_internal/map/features.php:3223`);
der Aufruf braucht keinen Darstellungssatz und keine `expected_revision`. ⚠️ `text` und
`feature_subtype` müssen trotzdem mit — sie werden unbedingt geschrieben (`features.php:3177`), und
ihre Herkunft wird nur gestempelt, wenn sie sich wirklich ändern. Unverändert mitgeschickt heißt
also: kein Stempel.

### 4.2 Die Beschriftung

Der Menübauer (`js/ui/popups.js:775`) fragt dieselbe Weiche und beschriftet danach:

| Fall | Beschriftung | Glyph |
|---|---|---|
| letztes Label einer Fläche | **Label ausblenden** | ◌ |
| jedes andere Label | Label löschen | ✕ |

⭐ Dasselbe Muster fährt die Außenhülle schon:
`deleteLabel: isSourceless ? "Außenhülle löschen" : "Löschen"`
(`js/map-features/map-features-region-interactivity.js:60`). Ein Knopf, der sagt, was er tut.

💣 Das Glyph wechselt mit. `POPUP_ACTION_GLYPHS` (`js/ui/popups.js:22`) hält daran fest, dass jedes
Zeichen genau eine Bedeutung hat — ✕ heißt löschen und darf nicht für Ausblenden stehen.

### 4.3 Die Rückmeldung

Kein Rückfragefenster: der Handgriff ist verlustfrei und umkehrbar. Stattdessen ein Toast, und der
**muss den Rückweg nennen**:

> Name ausgeblendet — die Fläche bleibt.
> *Wieder einschalten: Eigenschaften → „Regionname anzeigen“*

💣 Ohne diesen zweiten Satz hat der Editor einen Namen von der Karte genommen und keine Vorstellung,
wo er ihn wiederfindet — das ausgeblendete Label ist ab sofort nicht mehr anklickbar (§2), der
Rückweg führt zwingend über den Rechtsklick auf die **Fläche**. Genau diese Unauffindbarkeit hat den
Fall überhaupt erst erzeugt.

### 4.4 Die Fläche bleibt unangetastet

„Fläche löschen“ behält Verhalten *und* Form: die bestehende `window.confirm`-Warnung aus
`formatEcosystemAreaDeleteConfirmation` (`map-features-ecosystem-context-action.js:230`) nennt Region
und Labels bereits vollständig.

🔴 **Owner-Entscheid: kein neues Dialog-Bauteil.** Das Mockup zeigt beide Formen (A: heutiges
`confirm`, B: Hausform); gewählt ist A. Mit der neuen Label-Regel kann Thomas' Unfall nicht mehr
passieren, und wer „Fläche löschen“ klickt, weiß, dass er eine Fläche löscht. Ein Hausdialog wäre
Politur — und es gibt 25 weitere `window.confirm` im Projekt, die dann genauso dran wären. Das ist
ein eigenes Vorhaben, nicht dieses.

## 5 · Die Fälle, vollständig

| # | Fall | Verhalten |
|---|---|---|
| 1 | Letztes Label, Region hat Flächen, Kaskade an | **ausblenden**, kein Dialog, Toast |
| 2 | Eines von mehreren Labels | löschen wie heute, schlichte Rückfrage |
| 3 | Letztes Label, Region hat **keine** Fläche | löschen wie heute (Falle F1) |
| 4 | Label ohne Landschaftsregion | löschen wie heute, schlichte Rückfrage |
| 5 | Kaskade abgeschaltet (`cascade_enabled === false`) | löschen wie heute (Falle F3) |
| 6 | Kaskaden-Flag unbekannt (`null`) | **ausblenden** — sichere Richtung (Falle F3) |
| 7 | Label trägt Kraftlinien | ausblenden **erlaubt**, löschen weiter gesperrt (Falle F2) |
| 8 | Label ist bereits ausgeblendet | tritt nicht auf — unsichtbar heißt nicht anklickbar |
| 9 | „Region löschen“ im Eigenschaftendialog | unverändert, nimmt Labels mit, Rückfrage nennt die Zahl |

## 6 · Fallen

### F1 💣 Eine Region OHNE Fläche wäre eine Sackgasse

Die Kaskade beim Label hängt an `labelsLeft <= 0` und **nicht** daran, ob es Flächen gibt
(`avesmapsEcosystemCascadeTriggered`, `api/_internal/app/ecosystem.php:2599`). Eine Region ohne
Fläche verliert heute mit ihrem letzten Label auch ihre Zeile.

Blendete man dort stattdessen aus, bliebe eine Region ohne Fläche mit einem unsichtbaren Label
stehen — **und niemand käme je wieder heran**: das Label wird nicht gezeichnet, ist also nicht
anklickbar (`map-features-labels.js:788`), und der Eigenschaftendialog hat genau einen Einstieg, den
Kontextmenü-Eintrag einer Fläche (`map-features-ecosystem-properties.js:1648`). Kein Marker, keine
Fläche, kein Weg zurück.

Das ist die verwaiste Außenhülle vom 16.08.2026 in Grün, und dazu gibt es einen Owner-Satz:
„es darf doch auf der map keine elemente geben über die ich keine kontrolle mehr habe.“

→ **Ausblenden nur, wenn die Region mindestens eine aktive Fläche hat.** Sonst ist das Löschen des
letzten Labels ein Aufräumen, kein Verlust.

### F1b 🪤 `area_count` fehlt ≠ `area_count` ist 0

`ecosystemRegionOfLabel` gibt bei ungeladenen Regionslisten die Notfallantwort `{ public_id }` zurück
— ohne `name`, ohne `area_count` (`map-features-ecosystem-region-store.js:224`). `Number(undefined)
|| 0` ist `0`, und nach F1 hieße das „keine Fläche, also löschen“ — die **gefährliche** Richtung, in
genau dem Moment, in dem der Client nichts weiß.

→ Der Löschweg lädt die Regionslisten, bevor er entscheidet — wie
`ecosystemPushLabelChangesToRegion` es bereits tut
(`await Promise.all(ECOSYSTEM_KINDS.map(loadEcosystemRegions))`,
`map-features-ecosystem-label-writeback.js:87`). Fehlt `area_count` danach immer noch, gilt
**ausblenden**: lieber ein Label zu viel behalten als eine Landschaft verlieren.

Dieselbe Lehre steht schon zweimal im Haus („0 heisst unbekannt, nicht keines“, in beiden
Bestätigungs-Formatierern).

### F2 💣 Der Nodix-Riegel bewacht das Löschen, nicht das Ausblenden

`refusePowerlineAnchoredDeletion` (`js/map-features/map-features-powerlines.js:644`) steht heute ganz
vorn in `deleteLabelEntry`, vor der Rückfrage. Unverändert ließe sich ein Nodix-Label mit
angehängter Kraftlinie nicht einmal *ausblenden* — obwohl der Anker dabei vollständig erhalten
bleibt.

→ Der Riegel wandert **hinter** die Weiche: er gilt weiter für jedes echte Löschen und nicht mehr
fürs Ausblenden.

⚠️ Der Preis, ausdrücklich benannt: ein ausgeblendetes Nodix-Label ist ein **unsichtbarer**
Kraftlinien-Endpunkt. Die Linie wird gezeichnet, ihr Knoten nicht. Das ist hinnehmbar (die Kraftlinie
selbst bleibt sichtbar und anklickbar), aber es ist neu.

### F3 💣 Ist die Kaskade aus, gibt es nichts zu schützen

`AVESMAPS_ECOSYSTEM_CASCADE_ENABLED` ist ein globaler Serverschalter und reist im Lesepfad als
`cascade_enabled` mit (`api/app/ecosystem-areas.php:138`, gelesen in
`map-features-ecosystem-loader.js:109`). Steht er auf `false`, nimmt das letzte Label gar nichts mit
— dann wäre Ausblenden Bevormundung.

→ `false` ⇒ löschen wie heute. **Nur ein ausdrückliches `false`.** `null` heißt „das Flag ist hier nie
angekommen“ (es reist mit den Flächen, und die lädt nur die Landschaftsebene) — dann gilt die sichere
Richtung: ausblenden. Dieselbe Asymmetrie wie in den beiden bestehenden Bestätigungs-Formatierern,
nur eine Stufe schärfer, weil hier nicht ein Satz falsch wird, sondern eine Landschaft.

### F4 💣 Der sanfte Weg wird bei mehreren Labels NICHT angeboten

Der Haken „Regionname anzeigen“ wirkt über `applyRegionToLabels` auf **alle** Labels der Region
(`map-features-ecosystem-properties.js:1326`). Böte der Knopf „ausblenden“ auch bei drei Labels an,
hätte dasselbe Wort zwei Reichweiten — eines gegen alle. Beim letzten Label sind beide dasselbe, und
die Divergenz entsteht gar nicht erst.

Das ist zugleich der Grund, warum es *kein* Dialog mit Auswahl wird: „Label löschen, Fläche behalten“
sähe auf der Karte identisch aus wie „ausblenden“, bezahlt mit dem Verlust von Ort, Größe, Drehung
und Zoom-Band — derselbe Anblick für Datenverlust.

## 7 · Was ausdrücklich nicht gebaut wird

- **Kein „Fläche verbergen“.** `ecosystem_area` hat keinen Sichtbarkeitsschalter (`is_active` ist
  Löschen; `is_trial` ist seit 01.08.2026 tot, `ecosystem.php:3008`). Absichtlich: eine unsichtbare
  Fläche **wirkt weiter** — in `ecosystem_region_overlap`, `path_ecosystem`, „Was ist hier?“, den
  Klimazonen und als Gelände der Routenfindung. „Nicht zeichnen“ und „nicht wirken“ sind zwei
  Features, und eines ohne das andere ist eine Falle mit demselben Wort drauf.
- **Kein Dialog-Bauteil**, siehe §4.4.
- **Keine Änderung an der Kaskade selbst**, weder client- noch serverseitig.
- **Keine Handbuch-Änderung.** Die nächtliche Routine `avesmaps-handbuch-pflege` liest den Commit
  (AGENTS.md §9). Das Commit-Subject muss die sichtbare Wirkung nennen, etwa:
  `fix(landschaften): das letzte Label wird ausgeblendet statt geloescht`.

## 8 · Tests

Neu in `js/map-features/__tests__/`:

- **`landschaften-label-ausblenden.test.js`** — die Weiche als reine Funktion, ein Fall je Zeile aus
  §5. Die Zusicherungen, die wehtun: Fall 3 löscht (F1), Fall 6 blendet aus (F3), und eine Region
  **ohne** `area_count` blendet aus statt zu löschen (F1b).
- Erweiterung von `ecosystem-label-writeback.test.js` um die Beschriftungsweiche (§4.2): „Label
  ausblenden“ nur im Fall 1.
- Ein Verdrahtungstest, dass `refusePowerlineAnchoredDeletion` im Ausblende-Zweig **nicht** und im
  Löschzweig **doch** gefragt wird (F2). Eine getestete Weiche, die niemand aufruft, ist die Falle
  aus `gruener-test-beweist-nichts-ohne-verdrahtung`.

⚠️ Vor dem Push läuft das **ganze** Testfeld, JS und PHP, samt der `tools/wikidump/test-*.php`, die
das Muster aus AGENTS.md §9 nicht findet.

## 9 · Offene Punkte

- 🔧 **Der Ablauf im Browser mit angemeldeter Sitzung steht aus** — kein Handgriff dieser Änderung
  ist je gegen die echte Datenbank gelaufen. Abzunehmen sind die Handgriffe, nicht die Maße
  (AGENTS.md §9): Label anklicken → „Label ausblenden“ → Name weg, Fläche da → Rechtsklick auf die
  Fläche → Eigenschaften → Haken zurück → Name wieder da.
- 🔧 **Nebenbefund, nicht Teil dieses Auftrags:** `avesmapsClimateAssertNotDerived` bewacht
  `create/delete_region` und `create/update/delete_area`, aber **nicht** die Kaskade
  (`avesmapsEcosystemCascadeAfterRemoval` deaktiviert per `UPDATE`, nicht über `delete_region`).
  Trägt eine Klima-Region ein Label, reißt dessen Löschung heute ein abgeleitetes Band mit, obwohl
  `delete_region` genau dafür gesperrt ist. Diese Änderung entschärft das eher, als dass sie es
  verursacht. Ungemessen ist, ob es Klima-Regionen mit Labels überhaupt gibt.
- 🔧 **Kein `data-i18n`** an der neuen Beschriftung — „Label löschen“ ist heute ebenfalls hart
  deutsch in `popups.js`. Gehört zu M8, nicht hierher.
