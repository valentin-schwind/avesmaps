# Das Tor: der Wege-Subtyp `Bach` und fünf neue Ortsarten

> **Für Agenten:** PFLICHT-SUB-SKILL: `superpowers:subagent-driven-development` zum Ausführen,
> `superpowers:test-driven-development` je Aufgabe. Schritte tragen `- [ ]`.

**Ziel:** Die zwei Dinge bauen, ohne die Stufe 1 des Garetien-Imports nicht übernommen werden
darf — sonst liegen **143 von 289** Objekten als *befahrbare* Flusswege in der Karte.

**Auftrag:** Owner 27.08.2026 — *„führe die neue kategorie ‚Bach' ein — das sind wie flusswege,
die aber nicht befahren werden können"* und *„Gasthaus … genauso wie Burg, Pfalz, Magierturm,
Stadtviertel"*. Bestellt am 29.08.2026: „bau das tor".

**Spec:** `docs/superpowers/specs/2026-08-27-garetien-typinventar-und-mapping.md` §1.4 / §1.5 / §3.3

---

## 🔴 Was sich gegenüber der Spec geändert hat — ZUERST LESEN

Die Spec nennt in §1.4 eine offene Entwurfsfrage: *„ein Bach ist weder befahrbar noch begehbar —
er ist gar kein Reiseweg. Wird er (a) eine vierte Transport-Domäne ohne Verkehrsmittel, oder (b)
gar keine Graph-Kante?"*

⭐ **Die Frage löst sich auf: BEIDES ist schon gebaut, die Spec kannte es nur nicht.** Am
29.08.2026 am Code nachgemessen:

| gemessen | Stelle |
|---|---|
| **Die vierte Domäne `'none'` EXISTIERT** und ist gültig | `avesmapsReadTransportDomain` (`api/_internal/map/features.php:230`) lässt `['land','river','sea','none']` durch |
| **Sie ergibt eine LEERE Verkehrsmittelliste** | `avesmapsAllowedTransportOptionsForDomain`, `default => []` (`:215`) |
| **Eine leere Liste ist MASSGEBLICH**, nicht „nichts eingetragen" | `avesmapsClientRoutePathAllowedTransports` (`client-graph.php:1718-1733`): *„a list — INCLUDING an empty one — is authoritative … no transport at all may use this path (e.g. the upper Raller)"* |
| **Ein Bach ist automatisch KEINE Wand** | `avesmapsCollectRouteRiverBarrierLines` (`offroad-grid.php:989`) filtert auf `avesmapsGetRouteTransportType(...) === 'river'`; für `Bach` liefert die Funktion `'unknown'` (`network-data.php:190-203`) — **keine Änderung nötig** |
| **Ein Subtyp-Sonderfall hat schon einen Haken** | `avesmapsAllowedTransportOptionsForPathSubtype` (`:219`) behandelt `Wuestenpfad` genau so |

🔴 **Also: KEINE neue Domäne, KEINE Graph-Operation, KEIN Eingriff in die Sperrregel.** Der Bach
bekommt `transport_domain = 'none'`, daraus fällt die leere Verkehrsmittelliste, und der
vorhandene Riegel in **allen vier** Querfeldein-Erzeugern (AGENTS.md §11) greift von selbst.

💣 **DAS IST DIE GEFÄHRLICHSTE STELLE DES GANZEN VORHABENS.** `SPEED_TABLE[t]?.[type] || 1` macht
aus einer **fehlenden** Tempozelle klaglos **Tempo 1** (AGENTS.md §11, „Die Tempowerte gelten auch
für die Karte"). Ein Bach hat keine Tempozelle. Er darf deshalb **nie** bis zur Tempoabfrage
kommen — der Transportriegel muss **vorher** greifen. Aufgabe 3 misst genau das.

## Global Constraints

- 💣 Kommentare, Commit-Botschaften und neue Texte auf **DEUTSCH** (AGENTS.md §8).
- 💣 `PATH_SUBTYPE_KEYS` und die Ortsarten sind **Datenschlüssel** — niemals übersetzen (§2).
- 💣 Nie eine Farbe hartkodieren: erst das Token in `css/base/tokens.css`, **hell UND dunkel**.
- 💣 **Geteilter Arbeitsbaum:** nie `git add -A`, nur eigene Pfade.
- 💣 Vor jedem Commit das **ganze** Feld, beide Sprachen, mit der Klammer um beide Gruppen,
  Dateizahl gegenzählen. Vorbestehend rot ist genau einer: `linkcheck/link-url-test.php`.
  🪤 Nach dem `git add` fahren — der Abbau-Wächter liest `git ls-files`.
- 🔴 Sichtbare Änderungen gehen **einzeln** live (AGENTS.md §9).
- 🪤 Ein Quelltext-Test darf **Kommentare nicht mitlesen** — in diesem Projekt achtmal zugeschlagen.
- 🪤 Eine Zahl im Kommentar liest sich wie eine vollständige Liste; schreib die **Zusicherung**
  und wie man sie nachprüft. Sechsmal falsch gewesen.

---

## Teil A — der Wege-Subtyp `Bach`

### Aufgabe 1: Der Schlüssel, die Domäne und die Farbe

**Dateien:** `js/config.js` · `api/_internal/map/features.php` · `css/base/tokens.css` ·
Test `js/map-features/__tests__/bach-subtyp.test.js` ·
Test `api/_internal/map/__tests__/bach-domaene-test.php`

- [ ] **Schritt 1: Der fallende Test**

```js
// 🔴 EIN BACH IST KEIN REISEWEG. Gemessen am ERGEBNIS der Hausfunktionen, nicht an der Liste.
wahr(PATH_SUBTYPE_KEYS.includes("Bach"), "Bach fehlt in den Wegarten");
// 💣 Die Reihenfolge ist Bestand: `Bach` gehoert ans ENDE, sonst verschiebt sich jede Liste,
// die ueber PATH_SUBTYPE_KEYS iteriert (svg-export-build.js zeichnet in dieser Reihenfolge).
gleich(PATH_SUBTYPE_KEYS[PATH_SUBTYPE_KEYS.length - 1], "Bach");
// Und die Gegenprobe, ohne die die Zeile darueber nichts filtert:
gleich(PATH_SUBTYPE_KEYS.indexOf("Flussweg"), 6, "die acht vorhandenen behalten ihre Plaetze");
```

PHP dazu:

```php
assert(avesmapsDefaultTransportDomainForPathSubtype('Bach') === 'none');
assert(avesmapsAllowedTransportOptionsForPathSubtype('Bach') === []);
// 🔴 DIE GEGENPROBE, ohne die beide Zeilen nichts belegen: der Flussweg behaelt seine zwei Boote.
assert(avesmapsAllowedTransportOptionsForPathSubtype('Flussweg') === ['riverSailer', 'riverBarge']);
// ⚠️ Und `none` muss durch die Normalisierung kommen, sonst faellt sie auf `land` zurueck.
assert(avesmapsReadTransportDomain('none', 'Bach') === 'none');
```

- [ ] **Schritt 2: Fehlschlag bestätigen** — 🔴 die Ausgaben wirklich sehen.
- [ ] **Schritt 3: Bauen** — `'Bach'` ans Ende von `PATH_SUBTYPE_KEYS`; in
      `avesmapsDefaultTransportDomainForPathSubtype` ein `'Bach' => 'none'` **vor** dem
      `default`; Token `--color-path-bach` in **beiden** Themen.
      ⚠️ Die Farbe leitet sich vom Flussweg ab (heller, blasser — ein Bach ist schmaler und soll
      den Fluss nicht überschreien), ist aber ein **eigenes** Token: eine geteilte Farbe liefe
      beim nächsten Umton auseinander.
- [ ] **Schritt 4: Grün bestätigen · Schritt 5: Commit**

### Aufgabe 2: Zeichnen, Beschriften, Fließpfeile

**Dateien:** `js/map-features/map-features-path-rendering.js` ·
`map-features-path-labels.js` · `map-features-river-flow-arrows.js` ·
`js/pages/svg-export-farben.js` · `js/pages/svg-export-build.js` · `js/app/i18n-en.js` ·
Test `js/map-features/__tests__/bach-zeichnen.test.js`

🔴 **Ein Bach ist ein GEWÄSSER und wird wie eines gelesen** (Owner: „wie flusswege"): dieselbe
Familie, dieselbe Beschriftungsform, **mit** Fließpfeilen, wenn er eine Richtung trägt.
`map-features-river-flow-arrows.js:120` prüft heute `!== "Flussweg"` — daraus wird eine
Zugehörigkeit zur Gewässerfamilie, **an einer Stelle**, nicht zwei verglichene Zeichenketten.
⚠️ Dünner als ein Flussweg (eigener Eintrag in den Strichbreiten), damit die Karte nicht kippt.
💣 `svg-export-build.js` zeichnet **in der Reihenfolge von `PATH_SUBTYPE_KEYS`** und nennt „die
acht Wegarten" — die Zahl im Kommentar wird zur **Zusicherung ohne Zahl** umgeschrieben.

- [ ] Test · RED · bauen · GREEN · **Abnahme im Browser: einen Bach wirklich sehen**, hell und
      dunkel · Commit

### Aufgabe 3: 🔴 Der Riegel — ein Bach ist auf KEINE Weise befahrbar

**Dateien:** Test `api/_internal/routing/__tests__/bach-nicht-befahrbar-test.php`

💣 **Die Aufgabe, um die es beim ganzen Tor geht.** Gemessen wird am **Ergebnis einer echten
Route**, nicht an einer Konstanten.

- [ ] **Schritt 1: Der Test**

```php
// 🔴 KEIN Verkehrsmittel darf einen Bach benutzen -- alle drei Domaenen durchgefahren.
foreach (['groupFoot', 'riverSailer', 'cargoShip', 'horseCarriage'] as $mittel) {
    assert(avesmapsIsClientTransportAllowedForPath('Bach', $mittel, $bachPfad) === false);
}
// 💣 UND DIE EIGENTLICHE GEFAHR: er darf nie bis zur Tempoabfrage kommen.
// `SPEED_TABLE[t]?.[type] || 1` macht aus einer fehlenden Zelle klaglos Tempo 1.
// Gemessen an der gebauten ROUTE: ein Bach zwischen zwei Orten darf keine Kante ergeben.
```

🔴 **Und die Gegenprobe:** derselbe Aufbau mit `Flussweg` **ergibt** eine Kante. Ohne sie belegt
der Test nur, dass die Fixture nichts enthält.

- [ ] **Schritt 2: Fehlschlag oder GRÜN?** ⚠️ Er kann sofort grün sein — dann ist das der
      **Beleg**, dass Aufgabe 1 genügt hat, und der Test bleibt als Wächter. Das ist **kein**
      Grund, ihn wegzulassen: er hält die Zusicherung fest, nicht die Arbeit.
- [ ] Commit

### Aufgabe 4: Der Wege-Editor

**Dateien:** `js/pages/wege-editor.js` (`SUBTYPES`, `WATER_SUBTYPES`) ·
`js/pages/wege-editor-model.js` (`WP_SPEEDS`) · `css/pages/wege-editor.css` ·
Test `js/pages/__tests__/bach-im-wege-editor.test.js`

💣 **`WP_SPEEDS` ist die dritte Spiegelung der Tempotabelle** (`js/config.js`,
`AVESMAPS_ROUTE_CLIENT_SPEED_TABLE`, `WP_SPEEDS`). Der Kommentar dort sagt: eine ohne die anderen
zu ändern macht `wege-editor-model.test.js` rot — *„that is its job"*.
🔴 **Ein Bach bekommt in KEINER der drei eine Zeile** — er hat kein Tempo. Meldet der
Spiegel-Test das als Ungleichheit, ist **er** anzupassen, nicht die Tabelle: die Zusicherung
lautet „die drei sind gleich", und drei gleiche Tabellen ohne Bach erfüllen sie.
⚠️ `WATER_SUBTYPES` bekommt den Bach (Fließrichtung ist ein Gewässerfeld).

- [ ] Test · RED · bauen · GREEN · **Abnahme: einen Weg im Editor auf `Bach` stellen** · Commit

---

## Teil B — die fünf Ortsarten

### Aufgabe 5: Gasthaus · Burg · Pfalz · Magierturm · Stadtviertel

**Dateien:** `api/_internal/wiki/place-kinds.php` ·
Test `api/_internal/wiki/__tests__/fuenf-neue-ortsarten-test.php`

⭐ **Klein, weil die Liste dafür gebaut ist.** `avesmapsPlaceKindCatalog()` leitet die Editorliste
ab, `avesmapsNormalizePlaceKind` lässt einen unbekannten Namen ohnehin durch.

🔴 **ANS ENDE, und nur ans Ende.** Die Konstante trägt eine Reihenfolge-Regel: *„Der Erste, der
einen Titel beansprucht, gewinnt"*, und `avesmapsPlaceKindLegacyPrefix()` hält die ersten 24
Einträge **byte-genau** fest. Alles Angehängte kann keinen Artikel umklassifizieren, den der Dump
heute schon einordnet.
⚠️ **Keine der fünf existiert bisher** — am 29.08.2026 gezählt, je 0 Treffer. Verwandte gibt es
(`Palast`, `Schloss`, `Kaiserpfalz`, `Turm`, `Festung`); sie werden **nicht** zusammengelegt, weil
jede Art heißen soll wie ihre Wiki-Kategorie (Owner-Entscheid zu Höhle/Grotte).

- [ ] **Schritt 1: Der Test**

```php
foreach (['Gasthaus', 'Burg', 'Pfalz', 'Magierturm', 'Stadtviertel'] as $art) {
    assert(in_array($art, avesmapsPlaceKindCatalog(), true), $art . ' fehlt im Katalog');
    assert(avesmapsNormalizePlaceKind(mb_strtolower($art)) === $art, $art . ' rastet nicht ein');
}
// 🔴 DIE TRAGENDE ZUSICHERUNG: die 24 geschuetzten Eintraege stehen unveraendert VORNE.
```

- [ ] Schritt 2: RED · Schritt 3: die fünf **ans Ende** anhängen, mit Quellenvermerk ·
      Schritt 4: GREEN · Schritt 5: Commit

### Aufgabe 6: Der Importer trägt sie ein

**Dateien:** `api/_internal/import/garetien-abgleich.php` (`AVESMAPS_GARETIEN_TYP_MAP`) ·
Test dort

- [ ] `'Bach' => 'Bach'` statt `=> 'Flussweg'` und die fünf Ortsarten eintragen.
- [ ] 🔴 **Die Zusicherung, die das Tor schliesst:** ein Bach der Fixture wird als `Bach`
      übernommen, **nicht** als `Flussweg` — und die Gegenprobe, dass ein echter Fluss weiter
      `Flussweg` wird.
- [ ] Commit · **danach ist Stufe 1 übernehmbar.**

---

## Was NICHT dazugehört

- 🔴 Der Wiki-Dump zieht `Kategorie:Bach` **später** nach (Owner: „sobald der neue dump da ist").
- 🔴 Die Zoombänder für den Bach: die Tafel ist admin-einstellbar (AGENTS.md §11), er erbt
  zunächst die Werte des Flusswegs.
- 🔧 Ob die 143 Bäche der Stufe 1 die Karte optisch überladen, beantwortet nur der Owner-Blick.
