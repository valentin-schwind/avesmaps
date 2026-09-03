# Quellen am Herrschaftsgebiet — das EINE Bauteil auch für Territorien

**Stand:** 03.09.2026 · **Betrifft:** Territoriumseditor (`html/political-territory-editor.html`,
eingebettet über `js/territory/territory-editor-inline-host.js`), Kartendialog „Herrschaftsgebiet
bearbeiten" (`#region-edit-dialog`), das gescopte Bauprodukt `css/pages/political-territory-editor-inline.css`
**Anlass:** Owner — „ob du das system so bauen kannst, dass praktisch alle sich des moduls bedienen
können und wir nur noch EINE implementierung haben" · „es soll auf eigenen und normalen knoten
möglich sein weitere quellen hinzufügen"
**Mockup:** `docs/quellen-herrschaftsgebiete-mockup.html` (trägt den Vertrag, §4)
**Schritt 1 von 4** des Fahrplans in AGENTS.md §11 („Der Quellenkasten hat EINE Zeilenform") —
danach Wege, Altquellen, Landschaften, jeder Schritt einzeln live.

---

## 1 · Befund — gemessen, nicht angenommen

**Die Leseseite ist längst da.** Live-Nutzlast vom 03.09.2026 (`GET /api/app/map-features.php`,
ein Abruf): **879** Herrschaftsgebiete tragen **6.633** Quellenverweise unter
`feature_sources["territory:<public_id>"]`, alle drei Abdeckungsarten (1.027 ausführlich, 3.388
ergänzend, 2.218 Erwähnungen), alle aus dem Wiki-Publikationsabgleich. Die Infobox zeichnet sie seit
Monaten: `renderFeatureSourceLine("territory", regionEntry.territoryPublicId, …)`
(`js/map-features/map-features-region-info-markup.js:213`). `territory` steht in beiden
Endpunkt-Whitelists, `avesmapsFeatureSourcesReadWikiUrl` liest den festen Wiki-Link aus
`political_territory.wiki_url`, `avesmapsFeatureSourcesReadRevision` gibt für `territory` bewusst
`null` (keine `map_features`-Zeile), und jeder Schreibvorgang bumpt `map_revision`
(`feature-sources.php:1047`, `:1611`). **Der Server braucht für diesen Schritt keine Zeile.**

**Die Schreibseite fehlt an ZWEI Oberflächen, und die eine davon ist tot.**

1. **Territoriumseditor** (`html/political-territory-editor.html:84`): das Feld „Andere Quelle" liegt
   in der Sektion „Anzeige", die `hidden` trägt, und blendet sich zusätzlich aus, sobald der Knoten
   einen `wiki_key` hat (`territory-editor-embedded.js:1647`, seit `c1c86a0f9`, 07.07.2026). Einen
   `wiki_key` hat seit dem 05.06.2026 (`d6c693555`) jeder Knoten mit Datensatz, ein eigener trägt
   `eigener-knoten:knotenNNN`. Das Feld war damit **für keinen Knoten je erreichbar**. Seine Ablage
   `display_style.otherSource` (`assignment.php:31/68/186/217`, `territories-read.php:1056`,
   `territories-write.php:40`) liest kein öffentlicher Endpunkt. 🔧 Wie viele Reste dort liegen, ist von
   außen nicht messbar (kein DB-Zugang); die Zahl ändert die Entscheidung nicht (Owner: nicht migrieren).
2. **Kartendialog** (`index.html:2350-2360`): „Andere Quelle" + Linktext, gelesen nur für den
   `update_region`-Rumpf (Kartenregionen aus `map_features`) — **davon gibt es in der Nutzlast null**
   (12.211 Merkmale: location, crossing, path, junction, label, powerline). Für ein Herrschaftsgebiet
   (`update_territory`) reist das Feld gar nicht erst mit.

**Wer den Dialog überhaupt sieht.** Das Kontextmenü „Eigenschaften" ruft
`AvesmapsPoliticalTerritoryEditorLink.open` (`map-features.js:845`); nur ohne Overlay, Host oder
Inline-Host fällt `openPoliticalTerritoryEditor` auf `openRegionEditDialog` zurück
(`territory-editor-link.js:166`). In der laufenden Karte ist der Dialog also der **Rückfall** — echt,
aber nicht der erste Weg (so schon `js/ui/wiki-assign-territorium.js:39`). Er wird trotzdem angeschlossen,
weil bestellt und weil es einen Mount-Aufruf kostet.

**Der Knoten hat den Schlüssel schon.** Die Baumzeilen aus `?action=model_tree` tragen
`public_id` = `political_territory.public_id` (`sync-monitor-tree.php:310`), der Editor liest sie als
`node.row.public_id` (`createDefaultDisplayState`). Eigene Knoten sind Zeilen in `political_territory`
wie jede andere — sie haben eine `public_id`, nur keinen Wiki-Artikel. Ein **abgeleiteter Gruppenknoten**
(`node.row` fehlt, „Abgeleiteter Gruppenknoten" in der Wiki-Datenbox) hat keinen Datensatz und kann
keine Quelle tragen.

**Die Falle, die das Mockup gemessen hat: das gescopte Bauprodukt.** Der Inline-Host lädt
`political-territory-editor-inline.css`, in dem JEDE Regel unter `#political-territory-editor-host`
steht (`tools/scope_editor_css.js`). Elementregeln des Editors bekommen damit Spezifität (1,0,1) und
mehr — `button {…}`, `select {…}`, `a {…}`, `p {…}` — und die Bedienhöhen-Regeln
(`button:not(.tree-footer-button):not(.breadcrumb-cycle)`, `select, input[type="text"], …`;
`political-territory-editor.css:1510-1530`) sogar **(1,2,1)**. Das Quellen-Bauteil ist mit Klassen
gebaut, (0,1,0) bis (0,2,0). Naiv montiert wird das ✕ ein 32 px hoher, gefüllter, fetter Knopf, ✎
ebenso, jedes Feld bekommt Editorhöhe und -polster — der Quellenkasten sähe im Territoriumseditor anders
aus als an den acht anderen Montagestellen. Genau die Divergenz, für die es `tools/mockup-vertrag`
und den Prüfer `mockup-treue` gibt.

---

## 2 · Was gebaut wird

### 2.1 Territoriumseditor — eine Sektion „Quellen", ein reines Anschluss-Modul

🔴 **Owner-Entscheid nach dem Entwurf (03.09.2026): „generell können quellen immer unten/als letztes in
den listen auftauchen".** Der Editor ist zweispaltig (`territory-editor-panel-columns.js` sortiert alle
Sektionen in zwei Spalten; Wiki-Daten und Konfliktparteien rechts, alles andere links). Die Sektion
„Quellen" kommt in die **rechte Spalte als LETZTE** — die Spaltenweiche nennt `#territoryFeatureSources`
neben `#infoBox` und `#contestedBlock`, und die stabile Sortierung (unbekannte Überschriften ans Ende,
Dokumentreihenfolge) macht sie zur letzten, weil sie im Markup die letzte Sektion des Formulars ist.
Markup in `html/political-territory-editor.html`, **nach** dem Konfliktparteien-Block, vor `</form>`:

```html
<section class="manual-data-section" aria-label="Quellen" id="territoryFeatureSourcesSection" hidden>
  <div class="manual-data-section-header"><h3>Quellen</h3><span class="note">Quellen wirken <b>sofort</b> — sie brauchen kein „Speichern“.</span></div>
  <div id="territoryFeatureSources"></div>
</section>
```

Der Hinweissatz ist **zeichengleich** der des Beschriftungsdialogs (`index.html:2259`): das Bauteil
schreibt bei jedem Klick, die Speicherleiste des Editors unten hat damit nichts zu tun.

Ein neues, reines Modul `js/territory/territory-quellen-anschluss.js` (kein DOM-Aufbau, kein
`fetch`, kein Modulzustand — dieselbe Bauform wie `wiki-zuweisung.js` neben
`map-features-wiki-zuweisung-check.js`):

```
avesmapsTerritoriumQuellenAnschliessen({ sektion, host, node, mount, escape })
  → node.row.public_id leer  ⇒ sektion.hidden = true, kein Mount, gibt null zurück
  → sonst                     ⇒ sektion.hidden = false; host wird durch einen frischen Klon ersetzt
                                 (Zuhörer-Stapelung, wie Orts- und Beschriftungsdialog);
                                 mount(frisch, "territory", getter, { escape }); gibt den Klon zurück
```

Der **Getter liest bei jeder Anfrage** die `public_id` des dann aktuellen Knotens (aus einer vom Aufrufer
gereichten Funktion `aktuellerKnoten()`), nie einen beim Mounten eingefrorenen Wert — sonst schriebe
ein Klick im Pfad die Quelle auf den zuletzt geöffneten Knoten (dieselbe Regel steht wörtlich an
allen Montagestellen). `territory-editor-embedded.js` ruft das Modul am Ende von `renderInfoBox(node)`
— der EINE Trichter, durch den jeder Knotenwechsel geht (`selectNode`, Breadcrumb, Baum,
`showNodeDetails`).

Der Inline-Host führt die drei Modulskripte **vor** `territory-editor-embedded.js` in
`EDITOR_SCRIPTS` (`source-autocomplete.js`, `feature-source-markup.js`, `review-feature-sources.js`);
`loadScriptOnce` überspringt sie, weil `index.html` sie längst hat — die Liste ist der Vertrag des
Hosts, nicht die Skriptliste der Karte. Die Standalone-Seite lädt dieselben drei plus
`css/features/feature-sources.css`, wie `html/wiki-sync-settlement-editor.html`. `ASSET_VERSION`
wird gebumpt (AGENTS.md §7).

### 2.2 Das gescopte Bauprodukt trägt die Modulregeln — mechanisch

`tools/scope_editor_css.js` bekommt `css/features/feature-sources.css` als **vierte Quelle**. Jede
`.fs-*`-Regel steht damit auch als `#political-territory-editor-host .fs-…` im Bauprodukt, mit
(1,1,0) und mehr, und schlägt die Elementregeln des Editors. Keine zweite Rezeptur: dieselbe Datei,
eingefaltet; `node tools/scope_editor_css.js` erzeugt neu, Test A von
`tools/__tests__/scope-editor-css.test.js` hält Produkt und Erzeuger zusammen. Der Erzeuger kennt
`@media` und `@container` (rekursiv) — im Probelauf 0 leckende Selektoren.

Die drei Bedienhöhen-Regeln (`political-territory-editor.css:1510-1530`) nehmen `.fs-editor *` aus:

```css
button:not(.tree-footer-button):not(.breadcrumb-cycle):not(.fs-editor *),
select:not(.fs-editor *),
input[type="text"]:not(.fs-editor *), … { min-height: var(--pte-control-h); border-radius: var(--radius-md); }
button:not(.tree-footer-button):not(.breadcrumb-cycle):not(.fs-editor *) { padding: 0 var(--space-8); }
select:not(.fs-editor *), input[type="text"]:not(.fs-editor *), … { padding: 0 var(--space-6); }
```

Warum nicht `:where()` um den ganzen Block (Spezifität auf null): dann gewännen die eigenen
Klassenregeln des Editors (`.breadcrumb button`, `.drop-zone-unassign-button`) plötzlich gegen die
Bedienhöhe — eine sichtbare Änderung an Stellen, um die es hier nicht geht. Die Ausnahme ist
**beweisbar lokal**: sie ändert nur, was innerhalb von `.fs-editor` steht. Das ist der
**VERTRAG** des Mockups (§4).

### 2.3 Kartendialog — derselbe Kasten wie im Orts- und Beschriftungsdialog

🔴 **Owner-Entscheid (03.09.2026): „können die quellen ganz nach unten (nicht zwischen die felder
reinpfrimeln)".** Der Kasten steht deshalb NICHT an der Stelle des alten Feldes, sondern nach dem
letzten Feld („Redaktioneller Kommentar"), vor Statuszeile und Knopfleiste; `#region-edit-other-source-section`
fällt ersatzlos. In `index.html`:

```html
<div class="label-edit-section political-territory-field"><div class="label-edit-section-title">Quellen</div>
  <p class="location-report-form__status">Quellen wirken <b>sofort</b> — sie brauchen kein „Speichern“.</p>
  <div id="region-edit-feature-sources"></div>
</div>
```

Montiert in `populateRegionEditForm` (`review-region-dialog-population.js`) — dem einen Ort, durch den
Öffnen, Reiterwechsel (`review-region-events.js`), Zuweisung (`review-region-assignment-ui.js`) und
Nach-dem-Speichern (`review-region-save-flow.js`, fünf Stellen) alle gehen. Klon-Ersatz wie überall.
Objektart nach `source`: `political_territory` → `("territory", #region-edit-territory-public-id)`,
sonst `("region", #region-edit-public-id)` — die alte öffentliche Vertragsform für Kartenregionen. Der
Getter liest das versteckte Feld bei jeder Anfrage.

### 2.4 Was wegfällt — ohne Migration (Owner)

| Wo | Was |
|---|---|
| `html/political-territory-editor.html:84` | `#otherSourceFields` samt beiden Eingaben |
| `territory-editor-embedded.js` | `els.otherSource*` (:125-127), `otherSource` in `createEmptyDisplayState`, `createDefaultDisplayState`, `saveCurrentDisplayState`, `applyDisplayStateToForm`, `readDisplayStateFromForm`, `normalizeIncomingDisplayState`, im Rumpf von `save_geometry_assignment` und im Kontext-Export (:1509–2933, acht Stellen); der Riegel `otherSourceFields.hidden` (:1645-1648) |
| `index.html` | `#region-edit-other-source-section` mit Adresse, Linktext, Vorschau |
| `review-region-dialog-population.js:25-27`, `review-region-submit-flow.js:37` | `writeOtherSourceToForm("region-edit")` / `readOtherSourceFromForm("region-edit")` |
| `api/_internal/political/assignment.php` (Lesen der Anzeige UND der Schreibpfad von `save_geometry_assignment`, der den Link prüfte und in `style_json` legte), `territories-read.php`, `territories-write.php` | `otherSource` im `display_style` — Lesen, Normalisieren, Schreiben. 🪤 Der Entwurf zählte hier zuerst „4×" für `assignment.php`; das war ein `head -20` auf dem Grep, keine Zählung — gefunden hat den fünften Block der Test, nicht der Autor |

Gespeicherte `otherSource`-Reste bleiben als inerte JSON-Schlüssel liegen, bis die Geometrie das
nächste Mal gespeichert wird — dann verwirft die Normalisierung sie. Ein alter, zwischengespeicherter
Editor, der `display.otherSource` noch mitschickt, trifft auf denselben Ignorierpfad wie jeder
unbekannte Schlüssel: kein 400, kein Fehler.

**Bleibt:** `js/review/review-other-source.js` (Wege und Beschriftungen bis zu Schritt 2 und 4), der
`update_region`-Rumpf ohne `other_source` (der Server räumt das Feld beim Speichern ab, nachdem der
Mount den Takeover in den Katalog gefahren hat — dieselbe Ordnung wie beim Ortsdialog).

---

## 3 · Was NICHT gebaut wird

- Keine Änderung an der Infobox, am Endpunkt, an der Tabelle. Die Zählung „Quelle" im Baumfilter des
  Editors (`sync-monitor-tree.php:161`) erneuert sich beim nächsten Laden des Baums, nicht sofort — wie
  jede andere Zeile dort.
- Keine Migration von `display_style.otherSource`. Wer die Zahl wissen will:
  `SELECT COUNT(*) FROM political_territory_geometry WHERE display_style LIKE '%"otherSource":{"url":"http%'`.
- Kein Wiki-Assign, kein Listensymbol — das Bauteil ist der Quellenkasten, nicht die Zuweisung.
- Der Vorschlagskasten `appendProposedFeatureSources` (Gemeinschaftsmeldungen) bleibt dem Ortsdialog;
  Territorien haben keinen Meldeweg mit Quellenvorschlag.

---

## 4 · Was bindet

| Zusage | Wächter |
|---|---|
| Bedienhöhen-Regeln nehmen `.fs-editor *` aus, zeichengleich | **VERTRAG** im Mockup → `css/pages/political-territory-editor.css`, `tools/mockup-vertrag/__tests__/mockup-vertrag.test.js` (Deploy-Tor) |
| `feature-sources.css` ist Quelle des Erzeugers; Produkt trägt `#political-territory-editor-host .fs-editor` | `js/territory/__tests__/quellen-im-territoriumseditor.test.js` (liest `SOURCES` und das Produkt) |
| Produkt == Erzeugerausgabe | `tools/__tests__/scope-editor-css.test.js` (bestehend) |
| Sektion, Host, Hinweissatz im Markup; kein `otherSource*` mehr in HTML, JS, PHP | `quellen-im-territoriumseditor.test.js` + `api/_internal/political/__tests__/display-style-ohne-andere-quelle-test.php` (Normalisierung wirft `otherSource` weg, wirklich ausgeführt) |
| Mount mit `"territory"` + `row.public_id`; Getter liest den AKTUELLEN Knoten; Klon-Ersatz; Gruppenknoten → Sektion versteckt, kein Mount | `js/territory/__tests__/territory-quellen-anschluss.test.js` (das Modul wird mit gefälschtem DOM **ausgeführt**, gegen Mutationen gefahren) |
| `renderInfoBox` ruft das Modul; Inline-Host listet die drei Skripte vor `embedded`; Standalone-Seite lädt sie und das CSS; `ASSET_VERSION` gebumpt | `quellen-im-territoriumseditor.test.js` |
| Kartendialog: Host statt Sektion, Mount in `populateRegionEditForm`, Objektart nach `source`, kein `readOtherSourceFromForm("region-edit")` | `js/review/__tests__/quellen-im-herrschaftsgebiet-dialog.test.js` |
| `andere-quelle-immer-sichtbar.test.js` verliert `region-edit` aus seiner Liste — mit dem Grund im Test | Anpassung |

---

## 5 · Abnahmeliste (vor „fertig" einzeln abhaken)

- 💣 **Der Getter liest bei JEDER Anfrage** den aktuellen Knoten. Ein eingefrorener Wert schreibt auf den
  vorigen Knoten — an drei Montagestellen steht die Warnung wörtlich, hier gilt sie doppelt, weil der
  Pfad (Breadcrumb) den Knoten wechselt, ohne dass sich ein Dialog öffnet.
- 💣 **Klon-Ersatz vor jedem Mount**, und `__fsDetachAutocomplete` zuerst: die Vorschlagsliste hängt am
  Dokument und überlebte den Austausch sonst als Waise (`review-labels.js:855`).
- 💣 **Die Ausnahme steht an ALLEN DREI Bedienhöhen-Regeln**, nicht nur am Polster: `min-height: 32px`
  und der Radius sitzen in der ersten Regel — ohne sie wird das 20-px-✕ ein 32-px-Kasten, und das
  Polster allein sieht dann „fast richtig" aus.
- 💣 **Produkt neu erzeugen** (`node tools/scope_editor_css.js`) NACH beiden CSS-Änderungen, und
  `ASSET_VERSION` bumpen — sonst kommt das alte Blatt aus dem Zwischenspeicher, und der Kasten sieht
  live aus wie die Karte „Naiv montiert".
- 💣 **`hidden` an der Sektion, nie `display:none` per Stil** — der Editor blendet seine Sektionen
  über das Attribut ein und aus (`deferred-subtree-checkbox[hidden]`); ein zweiter Mechanismus daneben
  ist der Zustand, der auseinanderläuft.
- ⚠️ **Ein Gruppenknoten versteckt die Sektion** (Vorschlag; Owner-Frage 2 im Mockup). Wird stattdessen
  ein Satz gewünscht, ist das eine Zeile im Modul, nicht im Editor.
- ⚠️ **Die Standalone-Seite lädt `feature-sources.css` ungescopt** — dort greifen die Editorregeln mit
  (0,0,1), das Bauteil mit (0,1,0): kein Erzeuger nötig. Beide Ladewege im Test.
- ⚠️ **Mutationen**, gegen die die Tests gefahren werden: Getter eingefroren · kein Klon-Ersatz ·
  Gruppenknoten mountet trotzdem · Mount mit `"region"` statt `"territory"` · Ausnahme nur an einer der
  drei Regeln · `feature-sources.css` aus `SOURCES` gestrichen · `renderInfoBox` ohne Aufruf ·
  `otherSource` in `assignment.php` wieder normalisiert.
- 🔴 **Abnahme heißt Ablauf** (AGENTS.md §9): im Browser Gebiet öffnen → Sektion sichtbar → Quelle
  eintragen → Zeile erscheint → Infobox des Gebiets zeigt sie ohne Neuladen → Knoten im Pfad wechseln →
  Kasten zeigt den anderen Knoten → eigener Knoten: Kasten da, keine Wiki-Zeile. Was ohne Sitzung nicht
  geht, wird als offen gemeldet.
- 🔧 **Offen beim Owner:** Platz der Sektion (unter Wiki-Daten oder vor der Speicherleiste); Gruppenknoten
  (verstecken oder Satz); drei Korpora umbenennen (punin.de → Almada Wiki, westlande.de → AlberniaWiki,
  kahet-ni-kemi.de → Káhet Ni Kemi).
