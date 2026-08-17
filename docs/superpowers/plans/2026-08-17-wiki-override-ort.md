# Bauplan · Wiki-Override, Stufe 1: der Ort

> Entwurf: `docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md`.
> Mockup: `docs/wiki-override-mockup.html`. Zweig: `worktree-wiki-override`.
> Stufen 2–5 (Literatur · Landschaft · Label · Weg) bekommen je einen eigenen Plan, wenn diese
> Stufe live und vom Owner gesehen ist (AGENTS.md §9).

## Reihenfolge der Aufgaben

Jede Aufgabe endet grün, bevor die nächste beginnt. Aufgaben 1–3 sind unsichtbar (Fundament),
4–6 sind die Oberfläche, 7 ist das Tor.

---

### Aufgabe 1 · Der reine Rechner `js/ui/wiki-feld-herkunft.js`

**Was:** `avesmapsWikiFeldStand(felder, kartenwerte, wikiwerte, herkunft)` →
`{ [kartenfeld]: { wikiWert, abweicht, herkunft } }`.

- Nur Zeilen mit `karte !== ""`.
- Normalisierung **wortgleich** zu `avesmapsWikiAssignDiffNormalize` (`String(x ?? "").trim()`).
- `herkunft` ist `""`, wenn die Karte nichts sagt.

**Prüfbefehl gegen Bestehendes** (der Entwurf verlangt ihn, nicht raten):
```bash
grep -n "function avesmapsWikiAssignDiffNormalize" -A 3 js/ui/wiki-assign-diff.js
```

**Test** `js/ui/__tests__/wiki-feld-herkunft.test.js`:
- gleicher Wert → `abweicht === false`
- `null` gegen `""` → **kein** Unterschied (die Normalisierungsprobe)
- Anzeige-Zeile (`karte: ""`) kommt im Ergebnis **nicht** vor
- Herkunft ohne Eintrag → `""`, nicht `"wiki"`

**Mutation (einzeln):** `.trim()` entfernen → `" 5.900"` gegen `"5.900"` muss rot werden.

---

### Aufgabe 2 · `avesmapsWikiAssignDiff`: vierter Parameter wird die Herkunftskarte

**Was:** `handgesetzt: string[]` → `herkunft: {feld: "manual"|"wiki"}`; neue Regel 4 aus §2.6
(Herkunft `wiki` ⇒ vorangehakt, Grund `""`).

Neue Prüfreihenfolge, und sie IST die Regel:
1. gleich → nicht gelistet · 2. Wiki leer → nie gehakt · 3. `manual` → nie gehakt ·
**4. `wiki` → gehakt** · 5. Karte gefüllt → nicht gehakt · 6. Karte leer → gehakt

⚠️ **Kein Rückfall auf die Array-Form.** Genau zwei Stellen ziehen mit:
`js/ui/wiki-assign.js:1328` und `js/ui/wiki-assign-literatur.js:250`
(`avesmapsWikiAssignLiteraturHandgesetzt` → `…Herkunft`).

**Prüfbefehl:**
```bash
grep -rn "handgesetzt" --include=*.js --include=*.html . | grep -v node_modules
```
Danach darf kein Treffer außerhalb von Kommentaren übrig sein, der die Array-Form benutzt.

**Test:** `js/ui/__tests__/wiki-assign-diff.test.js` erweitern —
- `wiki` auf gefülltem Kartenwert → `gehakt === true`, `grund === ""`
- `manual` sticht `wiki`, falls beides je gleichzeitig auftauchte (Reihenfolgeprobe)
- leeres Herkunftsobjekt → **exakt das heutige Verhalten** (die Nicht-Regressions-Probe)

**Mutation (einzeln):** Regel 4 vor Regel 3 schieben → die Reihenfolgeprobe muss rot werden.

---

### Aufgabe 3 · Serverseitig: der Stempler + sein Aufruf in `update_point`

**Neu:** `api/_internal/map/field-origins.php` mit
```php
avesmapsFieldOriginsStempeln(array $bestand, array $vorher, array $nachher, array $ausWiki): array
```
Rein. Nur geänderte Felder; `wiki` wenn in `$ausWiki`, sonst `manual`. Ein Feld, dessen Wert gleich
bleibt, wird **nicht angefasst** (Fall #72).

**Aufruf:** `avesmapsUpdatePointFeatureDetails` (`api/_internal/map/features.php`).
Die fünf Felder: `name`, `feature_subtype` (Spalten) + `einwohner`, `lage`, `oberhaupt`
(`AVESMAPS_POINT_WIKI_TEXT_FIELDS`). Payload-Schlüssel: `wiki_uebernommen: string[]`.

💣 **Die Kappung passiert VOR dem Vergleich.** `avesmapsApplyPointWikiFields` schneidet auf
200/300/200 Zeichen; verglichen wird der **gespeicherte** Wert, sonst meldet ein Feld ewig
„geändert", das der Server gerade selbst gekürzt hat.

💣 **`$ausWiki` wird gegen die Feldliste gefiltert**, nie roh übernommen — ein Client, der
`"geometry"` hineinschriebe, darf keine Herkunft für etwas setzen, das kein Wiki-Feld ist.

**Test** `api/_internal/map/__tests__/field-origins-test.php`:
- unverändertes Feld → Bestand unverändert (die Fall-#72-Probe)
- geändertes Feld ohne `wiki_uebernommen` → `manual`
- geändertes Feld MIT → `wiki`
- fehlender Schlüssel `wiki_uebernommen` → alles `manual` (die sichere Richtung, §2.1)
- ein Feld in `$ausWiki`, das gar nicht in der Feldliste steht → wird ignoriert

**Mutation (einzeln):** die Gleichheitsprüfung entfernen → die Fall-#72-Probe muss rot werden.

**Zusicherung „je Schreibweg einer", ohne Zahl im Kommentar:** ein Test zählt zur Laufzeit die
Funktionen im `api/`-Baum, die `AVESMAPS_POINT_WIKI_TEXT_FIELDS` schreiben, und verlangt für jede
einen Stempel-Aufruf.

---

### Aufgabe 4 · Der Datenweg des Orts liest die Herkunft

`js/ui/wiki-assign-ort.js`: `avesmapsWikiAssignOrtZustand` gibt `herkunft` aus
`properties.field_origins` heraus.

🔴 Der Vertrag bleibt: im Fehlerfall **ablehnen**, nie mit Leerem auflösen.

---

### Aufgabe 5 · Editorfenster `html/wiki-sync-settlement-editor.html`

- `buildSettlementEditFormHtml`: die fünf Wiki-Zeilen bekommen die dritte Rasterspalte
  (`.dt-grid--wiki`, `.dt-alt`), Beschriftung `.k.ovr` bei `manual`, `↺`.
- `↺`-Klick → Feldwert = Wiki-Wert, Feld in die Merkliste `ortWikiUebernommen`, Meldung
  „Aus dem Wiki übernommen — noch nicht gespeichert."
- `settlementWikiAssignSyncUebernehmen` trägt die übernommenen Felder in dieselbe Merkliste.
- `buildSettlementSavePayload` schickt `wiki_uebernommen`.
- Nach erfolgreichem Speichern: Merkliste leeren.

**CSS:** `.dt-grid--wiki` / `.dt-alt` nach `css/components/editor-page.css` (dort steht `.dt-grid`).
⚠️ **Nicht** in `political-territory-editor-inline.css` — das ist ein Bauprodukt (§10).
Token `--avm-wiki-input-min` nach `css/base/tokens.css`, neben `--avm-field-label-w`.

**Test** `js/pages/__tests__/ort-wiki-override-form.test.js`: aus einem Zustand mit Herkunft die
Zeilen bauen und prüfen — braune Beschriftung nur bei `manual`, `↺` nur wo es abweicht, `.dt-alt`
leer wo nichts abweicht.

---

### Aufgabe 6 · Kartendialog `#location-edit-overlay`

Zweite Hülle: `.location-report-form__field` (Beschriftung **oben**, gemessen `index.html:1298-1336`).
Dieselbe Dreiteilung in ihrer Bauform — **die Regel wird abgeschrieben, nicht das CSS.**
`buildLocationEditPayload` (`js/review/review-locations.js`) schickt `wiki_uebernommen`.

---

### Aufgabe 7 · Das Tor

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```
⚠️ Vorbestehend rot ist genau einer: `api/_internal/linkcheck/__tests__/link-url-test.php` (echter
DNS-Abruf). Jeder weitere ist eine Regression.

Danach `usability-konsistenz` (Entwurf gegen Diff) und `usability-design` (Mockup gegen Baustand,
hell UND dunkel), dann Commit + Push, dann der Blick des Owners.

## Die 💣/⚠️/🔴-Liste dieses Plans, zum Abhaken vor „fertig"

- [ ] Normalisierung wortgleich zur Diff-Rechnung (A1)
- [ ] Kein Rückfall auf die Array-Form von `handgesetzt` (A2)
- [ ] Leere Herkunft ⇒ exakt heutiges Vorhäkel-Verhalten (A2)
- [ ] Kappung vor dem Vergleich (A3)
- [ ] `$ausWiki` gegen die Feldliste gefiltert (A3)
- [ ] Fehlender Payload-Schlüssel ⇒ `manual`, nie `wiki` (A3)
- [ ] Unverändertes Feld ⇒ Bestand unangetastet (A3, Fall #72)
- [ ] Schreibwege zur Laufzeit gezählt, keine Zahl im Kommentar (A3)
- [ ] `laden` lehnt im Fehlerfall ab (A4)
- [ ] CSS in die Quelle, nicht ins Bauprodukt (A5)
- [ ] Eingabefeld ≥ 50 %, `clamp()`-Oberschranke gegen den Überlauf (A5)
- [ ] Auslassungspunkte am Text, nicht an der Zelle (A5)
- [ ] ↺ wird nie mitgekappt (A5)
- [ ] Zwei Hüllen, nicht drei (A6)
- [ ] Jede neue Zusicherung EINZELN mutiert (alle)
- [ ] Ganzes Testfeld grün, alle drei Läufe (A7)
