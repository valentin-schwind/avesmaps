# Design: Der Editor merkt sich die zuletzt offene Reiter-Kaskade

**Datum:** 2026-07-17 · **Status:** freigegeben, NICHT gebaut
**Auftraggeber-Zitat:** *„Merk dir immer wo ich als editor zuletzt war (letzte offene menükaskade sollte
nach einem refresh erhalten bleiben). wenn ich auf wikisync -> materialien -> karten klicke und dann F5
mach sollte ich wieder da landen."*

## 1. Warum

Die Reiter-Erinnerung **existiert schon** (`initializeReviewPanelTabState`, `js/ui/ui-controls.js:542`) und
merkt sich Ebene 1 korrekt. Der Fall des Owners scheitert an Ebene 2 und 3:

Der Klick-Handler prüft jeden Wert gegen eine **hartkodierte Werteliste**:

```js
const wikiSyncTabValues = ["locations", "territories", "regions", "paths"];   // "adventures" fehlt
...
if (!allowedValues.includes(value)) return;   // -> "Materialien" wird nie gespeichert
```

Der Reiter „Materialien" trägt intern den Schlüssel `adventures` (`index.html:379`) — er steht nicht in der
Liste, also steigt der Handler mit `return` aus, **bevor** er speichert. Ebene 3 (Abenteuer/Karten) hat gar
keinen Handler.

Die Liste ist nicht nur unvollständig, sie ist die **Fehlerursache selbst**: Sie muss bei jedem neuen Reiter
von Hand nachgezogen werden, und genau das ist beim Materialien-Reiter unterblieben. Ein Design, das dieselbe
Liste nur ergänzt, wartet auf denselben Fehler.

## 2. Was gemerkt wird

Alle sechs Reiter-Familien des Editorpanels — sie sind alle nach demselben Muster gebaut (Buttons mit einem
`data-*`-Schlüssel, die `is-active` auf Button + Section umschalten):

| Ebene | Attribut | Werte | Storage-Key |
|---|---|---|---|
| 1 | `data-editor-panel-tab` | review, changes, wiki-sync, presence | `avesmaps.review.activeTab` *(bestehend)* |
| 2 | `data-wiki-sync-panel-tab` | locations, territories, regions, paths, **adventures** | `avesmaps.review.wikiSync.activeTab` *(bestehend)* |
| 2 | `data-review-subtab` | reports, ratings, mails | `avesmaps.review.reports.activeTab` *(neu)* |
| 2 | `data-status-subtab` | editoren, besucher | `avesmaps.review.status.activeTab` *(neu)* |
| 3 | `data-material-subtab` | adventures, **citymaps** | `avesmaps.review.material.activeTab` *(neu)* |
| 3 | `data-mail-tab` | empfangen, gesendet | `avesmaps.review.mail.activeTab` *(neu)* |

Die zwei bestehenden Keys **behalten ihre Namen** — der aktuelle Stand des Owners überlebt den Umbau.

Die Werte-Spalte ist **Dokumentation, kein Code**. Sie steht nirgends im JS (siehe §3).

## 3. Das Verfahren

**Eine Tabelle** beschreibt die sechs Familien — Attribut, dataset-Key, Storage-Key, Ebene. Sie ist der
einzige Ort, an dem eine Familie deklariert wird.

**Das DOM ist die Wahrheit, nicht eine Werteliste.** Ein Wert ist genau dann gültig, wenn es einen Button
`[<attribut>="<wert>"]` gibt. Damit wird ein neuer Reiter ab dem Moment gemerkt, in dem er in `index.html`
steht — ohne eine Zeile JS. Der Fehler aus §1 kann strukturell nicht wiederkehren.

**Speichern:** *ein* delegierter Klick-Listener für alle sechs Familien. Er liest den `data-*`-Wert und legt
ihn unter dem Storage-Key ab. Er ersetzt die Schleife in `bindPersistedTabClickHandler`.

**Wiederherstellen: den gemerkten Button echt klicken** (`button.click()`), in der Reihenfolge Ebene 1 → 2 → 3.

Der echte Klick ist die tragende Entscheidung. Die sechs Familien werden von **vier verschiedenen Dateien**
geschaltet, und nur zwei haben eine aufrufbare Funktion (`setEditorPanelTab`, `setWikiSyncPanelTab`); Mails
(`js/review/review-mail.js:193`), Status (`js/review/review-visitor-analytics.js:10`) und die beiden
Pill-Familien (`js/app/bootstrap.js:300`, `js/app/bootstrap.js:312`) sind reine Inline-Handler. Ein Klick
nimmt **denselben Pfad wie der Nutzer** — inklusive der Nebenwirkungen, die sonst vergessen würden: das
Nachladen der Karten-Liste hängt am Klick-Handler (`js/app/bootstrap.js:320`) und passiert dadurch beim
Wiederherstellen automatisch mit. Wiederherstell- und Klick-Pfad können nicht auseinanderlaufen, weil es
nur einen gibt.

### Die Regeln, in dieser Reihenfolge

1. **Nur im Edit-Modus** (`IS_EDIT_MODE`). Unverändert.
2. **URL schlägt Speicher.** Ist `?reviewTab=` / `?wikiSyncTab=` gesetzt und gültig, gewinnt der URL-Wert.
3. **Ungültiger Wert → vergessen.** Gibt es keinen passenden Button (Reiter umbenannt/entfernt), wird nichts
   geklickt und der Key aus dem Speicher entfernt. Der HTML-Standard (`is-active` im Markup) bleibt stehen.
   Jede Ebene prüft für sich: Stirbt „Materialien", landet der Owner trotzdem wieder in WikiSync.
4. **Schon aktiv → nicht klicken.** Trägt der Ziel-Button bereits `is-active`, passiert nichts. Das
   verhindert einen überflüssigen Fetch bei jedem Laden (Ebene 1 „review" ist der HTML-Standard, und
   `bootstrap.js` lädt die Meldungen ohnehin schon). Ohne gespeicherten Stand fällt **kein einziger** Klick —
   die App verhält sich exakt wie heute.
5. **Nach `DOMContentLoaded`.** Bleibt wie gehabt (`initializeReviewUiEnhancements`); `bootstrap.js` wird
   vorher geparst, die Reihenfolge stimmt heute schon.

### Alle sechs Reiter sind statisch

Keine der sechs Familien ist capability-gated oder wird dynamisch versteckt — alle Buttons stehen fest in
`index.html`. Ein fehlender Button bedeutet deshalb *immer* „Deploy hat den Reiter entfernt/umbenannt" und
nie „gerade nicht sichtbar". Regel 3 darf den Wert also gefahrlos verwerfen.

## 4. Adresszeile

**Der URL-Schreiber wird entfernt.** `updateReviewPanelTabUrlParameter` (`js/ui/ui-controls.js:517`) schreibt
heute bei *jedem* Reiter-Klick `?reviewTab=…&wikiSyncTab=…` per `history.replaceState` in die Adresszeile.
Das verletzt die Owner-Policy „Die Adresszeile wird von der App NIE automatisch umgeschrieben" (FINAL,
2026-07-06). `git log` belegt: Der Code ist älter als die Policy — der Task-14-Rückbau hat
`syncPlannerStateToUrl` gesäubert und diesen Editor-Pfad übersehen. Kein bewusster Sonderfall, ein Rest.

**Das Lesen bleibt.** `?reviewTab=` / `?wikiSyncTab=` funktionieren als eingehende Deep-Links weiter — das
entspricht der Policy („Eingehende Links werden weiterhin GELESEN; der Rückbau betrifft nur das SCHREIBEN").

**Bewusste Folge:** Ein per Deep-Link geöffneter Reiter wird zum neuen „zuletzt hier", weil der
Wiederherstell-Klick ihn speichert. Das ist gewollt und entspricht „merk dir, wo ich zuletzt war".

**Keine neuen Parameter.** Die vier neuen Familien bekommen *keine* URL-Parameter — sie leben nur im
`localStorage`.

## 5. Was nicht gemerkt wird

Owner-Entscheidung „nur die Reiter-Kaskade":

- **Kein** Scroll, **keine** Listenauswahl (z. B. die konkrete Karte), **keine** Suchfelder/Filter.
- **Auf/zu bleibt unangetastet.** `restoreReviewPanelState` (`js/review/review-panels.js:93`) merkt sich nur,
  ob das Panel offen ist, und hat mit den Reitern nichts zu tun. Wird nicht angefasst.

## 6. Tests

`tools/paths/test-review-tab-cascade.mjs`, nach dem Muster der Nachbartests (Quelle per `vm` laden,
Browser-Globals stubben, kein jsdom, kein Build). Gestubbt werden `document` (querySelector/querySelectorAll
mit Button-Attrappen, die `click()` protokollieren), `localStorage` und `window.location`/`history`.

Gepinnt wird:

1. Gespeichert `adventures` → der Materialien-Button wird geklickt *(die Regression aus §1)*.
2. Gespeichert `citymaps` (Ebene 3) → geklickt.
3. Toter Wert → kein Klick, Key entfernt.
4. Bereits aktiver Wert → kein Klick.
5. URL-Parameter schlägt gespeicherten Wert.
6. **`history.replaceState` wird nie gerufen** — pinnt die Policy aus §4 gegen eine künftige Session, die
   den „fehlenden URL-Sync" für einen Bug hält.
7. Reihenfolge: Ebene 1 vor 2 vor 3.

Ende-zu-Ende (nur der Owner, im echten Browser): WikiSync → Materialien → Karten → F5 → wieder dort.

## 7. Umfang

| Datei | Änderung |
|---|---|
| `js/ui/ui-controls.js` | Kern: Tabelle statt Wertelisten, delegierter Speicher-Listener, Wiederherstellen per Klick, `updateReviewPanelTabUrlParameter` raus |
| `tools/paths/test-review-tab-cascade.mjs` | neu |

Sonst nichts. `index.html`, `bootstrap.js`, `review-panels.js`, `review-wiki-sync.js`, `review-mail.js` und
`review-visitor-analytics.js` bleiben unberührt — deren Klick-Handler sind genau das, was wiederverwendet
wird. Kein `ASSET_VERSION`-Bump nötig (keine dynamisch geladenen Editor-Assets betroffen).

## 8. Fallen

- **Der Wiederherstell-Klick löst den Speicher-Listener mit aus** und schreibt denselben Wert zurück.
  Idempotent, unschädlich — aber beim Lesen des Codes irritierend.
- **Nebeneffekt, dem Owner bekannt:** Wer dauerhaft auf „Materialien → Karten" stehen bleibt, holt bei
  *jedem* Editor-F5 den Karten-Katalog nach (vorher Standard „Siedlungen", Katalog nur auf Zuruf). Ein Fetch
  pro Reload, kein Loop — STRATO-unkritisch.
- **`.click()` feuert auch auf Buttons in einem `hidden`-Elternteil** — genau deshalb funktioniert das
  Wiederherstellen von Ebene 3, bevor der Nutzer die Section je gesehen hat.
