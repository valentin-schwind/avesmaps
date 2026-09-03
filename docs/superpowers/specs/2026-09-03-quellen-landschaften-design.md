# Quellen an der Landschaft — die Fläche trägt sie, die Beschriftung zeigt sie

**Stand:** 03.09.2026 · **Schritt 5 von 5** des Quellen-Umbaus (nach Herrschaftsgebieten, Wegen, Altquellen) ·
**Betrifft:** Beschriftungsdialog (`#label-edit-dialog`, `js/review/review-labels.js`), Flächendialog auf der Karte
(`js/map-features/map-features-ecosystem-properties.js`), Landschaften-Editor (`html/landschaften-editor.html`),
Kartennutzlast (`api/app/map-features.php`, `api/_internal/app/feature-sources.php`), Wiki-Publikationsabgleich
(`api/_internal/wiki/publication-sync.php`), Bindung Beschriftung ↔ Fläche (`api/_internal/app/ecosystem.php`,
`api/_internal/map/features.php`)
**Anlass:** Owner — „LANDSCHAFTEN: die Quelle gehört zur Landschaft: `entity_type ecosystem` + `region_public_id`;
freie Beschriftungen bleiben `region` + `map_features.public_id`; nie beides."
**Mockup:** `docs/quellen-landschaften-mockup.html` (kein neues CSS, darum kein VERTRAG-Block — die Kästen sind die
bestehenden)

---

## 1 · Befund — gemessen an der Live-Nutzlast vom 03.09.2026

| Was | Zahl |
|---|---|
| Beschriftungen (`feature_type = label`) · an eine Landschaft gebunden (`ecosystem_region_public_id`) · frei | 1.011 · **782** · 229 |
| Gebundene Beschriftungen mit Quellen · Verweise | **487** · 6.976 |
| … Ziel-Landschaften · davon mit 2–3 quellentragenden Beschriftungen | **477** (272 Topographie, 127 Vegetation, 78 derographisch) · 8 |
| … Verweise nach Zusammenführung je Landschaft · Dubletten (dieselbe Quelle an zwei Beschriftungen einer Fläche) | 6.811 · 165 |
| Freie Beschriftungen mit Quellen · Verweise (bleiben) | **189** · 1.316 — Berggipfel 43, `region` 35, Wald 22, Vulkan 19, Tal 13, Fluss 12, Sümpfe 11, Insel 8, Auen 6, Steppe 5 … |
| Landschaften (`ecosystem_region`) · ohne Beschriftung | 1.415 · **646** — die können heute GAR KEINE Quelle tragen |
| Verweise auf `ecosystem` in der Nutzlast | **0** — der Typ ist freigegeben, aber niemand schreibt ihn, und die Nutzlast lädt ihn nicht (`AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES` kennt ihn nicht) |

**Wie es heute liegt.** Seit dem 26.08.2026 liegen die Quellen einer Landschaft an ihrer BESCHRIFTUNG (`region` +
`map_features.public_id`): der Beschriftungsdialog montiert das Bauteil dort, der Landschaften-Editor montiert es
ebenfalls auf die (primäre) Beschriftung (`region.label_public_id`, `html/landschaften-editor.html:2152`), und der
Flächendialog auf der Karte hat gar keinen Kasten mehr (`mountEcosystemAreaSources` ist eine leere Hülle). Die Karte
liest genau diese Liste (`renderFeatureSourceLine("region", label.publicId)` in `map-features-labels.js`, dazu das
Kanon-Etikett mit demselben Schlüssel).

**Warum das die falsche Ablage ist.** Eine Landschaft ohne Beschriftung (646) kann keine Quelle tragen; eine
Landschaft mit drei Beschriftungen trägt dieselbe Quelle dreimal (165 Dubletten); wer im Landschaften-Editor eine
Quelle einträgt, schreibt sie in Wahrheit an ein Label, das er nicht sieht — und der Wiki-Publikationsabgleich schreibt
Quellen für `region`-Artikel ebenfalls an die Beschriftungen (`publication-sync.php:1168`: `region → label`,
`wiki_region.wiki_key`).

---

## 2 · Die Regeln

1. **Die Quelle gehört zur Landschaft.** Eine an eine Fläche gebundene Beschriftung hat KEINE eigenen Quellen; ihre
   Quellen sind die der Fläche: `entity_type = ecosystem`, `entity_public_id = ecosystem_region.public_id`.
2. **Eine freie Beschriftung behält ihre Quellen** (`region` + `map_features.public_id`) — 189 Beschriftungen, darunter
   Berggipfel, Vulkane und Flüsse, die nie eine Fläche haben.
3. **Nie beides.** Ein Objekt liest genau EINE Liste. Die Weiche ist `properties.ecosystem_region_public_id` der
   Beschriftung — an EINER Stelle im Browser (`avesmapsLabelQuellenSchluessel(label)` → `{type, id}`) und an EINER
   Stelle im Server (`avesmapsLabelSourceKey`), und alle Leser und Schreiber fragen sie.
4. **Wird eine freie Beschriftung an eine Fläche gebunden, wandern ihre Quellen zur Fläche** (zusammengeführt,
   Dubletten fallen). Beim Lösen bleiben sie an der Fläche: sie beschrieben die Landschaft, nicht das Schild. Die
   Wanderung sitzt in EINER Funktion, die alle Bindungs-Schreiber rufen.
5. **Der Wiki-Publikationsabgleich zielt für `region`-Artikel auf die Fläche**, wenn die passende Beschriftung
   gebunden ist — sonst zöge der nächste Lauf die 6.811 Verweise wieder an die Labels zurück und „nie beides"
   wäre nach einem Klick auf „Syncen" gebrochen.
6. **Quellen stehen unten** (Owner 03.09.2026) — im Beschriftungsdialog, im Flächendialog und im Landschaften-Editor.
7. **Die Migration ist eine Übernahme-Vorschau:** Trockenlauf mit Zahlen, scharf nur ausdrücklich, Admin, gedeckelt —
   dieselbe Bauform wie der Sammel-Takeover der Altquellen (`takeover_other_sources`).

---

## 3 · Was gebaut wird

### 3.1 Nutzlast: `ecosystem` reist mit

`AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES` bekommt `ecosystem` (Katalog-Sammelabfrage und Verweise gleichermaßen —
sie teilen die Liste). Das Kanon-Etikett entsteht je Schlüssel aus den Verweisen (`avesmapsFeatureSourcesDeriveKanon`)
und bekommt damit `ecosystem:<id>` von selbst. Die Flächen selbst kommen weiter aus `api/app/ecosystem-areas.php`;
sie brauchen keine eigene Quellenliste im Rumpf — der Browser liest `__featureSourceRefs["ecosystem:<id>"]`.

### 3.2 Browser: EINE Weiche, drei Leser, drei Schreiber

`js/map-features/label-quellen-schluessel.js` (rein, kein DOM): `avesmapsLabelQuellenSchluessel(label)` liefert
`{ type: "ecosystem", id: label.ecosystemRegionPublicId }` für gebundene, `{ type: "region", id: label.publicId }` für
freie Beschriftungen. Leser: die Datenbox der Beschriftung (`renderFeatureSourceLine`), ihr Kanon-Etikett
(`kanonMarkup`) und der Flächendialog. Schreiber (Mounts): Beschriftungsdialog (Kasten „Quellen" — bei gebundener
Beschriftung mit der Zeile „Quellen der Landschaft „<Name>" — sie gelten für die Fläche und alle ihre Beschriftungen"),
Flächendialog (`mountEcosystemAreaSources` wird wieder ein Mount, auf `ecosystem` + `region.public_id`),
Landschaften-Editor (Mount auf `ecosystem` + `region.public_id` — auch für die 646 Flächen ohne Beschriftung; der
Satz „Quellen hängen an der Beschriftung" fällt).

### 3.3 Server: Bindung wandert die Quellen

`avesmapsEcosystemQuellenZurFlaeche(PDO, string $labelPublicId, string $regionPublicId)`: verschiebt alle
`feature_sources`-Zeilen `(region, label)` nach `(ecosystem, region)`; steht die Quelle dort schon, fällt die
Label-Zeile (Seiten/Abdeckung der Fläche gewinnen). 💣 Kein `UPDATE IGNORE`, kein Upsert — `DELETE` der Dubletten,
dann glattes `UPDATE` (die MySQL/SQLite-Regel aus dem Eigene-Knoten-Umbau). Gerufen von JEDEM Bindungs-Schreiber:
`update_label`/`create_label` mit `ecosystem_region_public_id` (`features.php`), das Zuweisen aus dem Panel
(`ecosystem.php:2867`) und `label_public_id` an der Fläche (`ecosystem.php:2732`). Ein Test zählt die Aufrufer.

### 3.4 Wiki-Publikationsabgleich

`avesmapsPublicationReconcile…` löst `region`-Ziele wie bisher über `wiki_region.wiki_key` an den Labels auf und
BILDET DANN AB: ist das Label gebunden, wird das Ziel `(ecosystem, region_public_id)` — mehrere gebundene Labels
derselben Fläche fallen auf EIN Ziel zusammen (`array_unique`). Freie Labels bleiben `(region, label)`. Die
Löschregel des Abgleichs (schreibt/löscht nur `origin = wiki_publication`) bleibt unberührt.

### 3.5 Migration: `takeover_label_sources`

Admin-Aktion im Quellen-Endpunkt, Trockenlauf als Vorgabe: zählt gebundene Beschriftungen mit Quellen, Ziel-Flächen,
Verweise vor/nach Zusammenführung, Dubletten, und zeigt eine Stichprobe; scharf (`apply: true`) ruft sie je Label
`avesmapsEcosystemQuellenZurFlaeche` — je Label eine Transaktion, gedeckelt, Fehler gemeldet. Erwartet: 487 Labels →
477 Flächen, 6.976 → 6.811 Verweise. `map_revision` bumpt einmal am Ende (die Nutzlast ändert sich für jeden).

### 3.6 Reihenfolge des Ausrollens (jeder Schritt einzeln live, Owner-Blick)

1. Nutzlast + Weiche + Leser (lesen beide Listen richtig, es liegt noch alles an den Labels: sichtbar ändert sich
   NICHTS) — zusammen mit Schreibern und Abgleich in EINEM Commit, weil ein Schreiber auf `ecosystem` ohne Leser
   unsichtbar schriebe.
2. Migration: Trockenlauf in der Owner-Sitzung, Zahlen gegen §1, dann scharf; danach Nutzlast prüfen
   (`region:`-Verweise an gebundenen Labels = 0, `ecosystem:` = 477 Flächen).

---

## 4 · Was NICHT gebaut wird

- Kein Umzug der 189 freien Beschriftungen — sie haben keine Fläche.
- Keine Quellen an Klimabändern (`kind = klima`) — sie sind abgeleitet, nicht gepflegt.
- Kein Nachziehen der Statuskreise: die zwei Bits der Region (Label zugewiesen / Fläche zugewiesen) messen
  Wiki-Zuweisung, nicht Quellen.
- Keine Anzeige der Flächenquellen im Flächen-Tooltip — der Tooltip trägt heute nur Territoriumsquellen; wer die
  Landschaft nachlesen will, klickt die Beschriftung oder den Flächendialog.

---

## 5 · Was bindet

| Zusage | Wächter |
|---|---|
| EINE Weiche je Seite (Browser `avesmapsLabelQuellenSchluessel`, Server `avesmapsLabelSourceKey`), alle Leser und Mounts rufen sie | `js/map-features/__tests__/label-quellen-schluessel.test.js` (ausgeführt), Verdrahtungstests je Fläche |
| `ecosystem` in `AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES`; Kanon je Schlüssel | `api/_internal/app/__tests__/quellen-landschaft-nutzlast-test.php` |
| Bindung wandert die Quellen, alle Bindungs-Schreiber rufen die eine Funktion; Dubletten per DELETE, kein Upsert | `api/_internal/app/__tests__/quellen-zur-flaeche-test.php` (SQLite, ausgeführt; Aufrufer gezählt) |
| Abgleich zielt auf die Fläche, wenn gebunden; mehrere Labels → ein Ziel | `api/_internal/wiki/__tests__/publication-ziel-landschaft-test.php` |
| Migration: Trockenlauf schreibt nichts, scharf nur `apply: true`, Admin, gedeckelt | `api/_internal/app/__tests__/quellen-label-takeover-test.php` |

---

## 6 · Abnahmeliste

- 💣 **Erst Leser, dann Umzug** — ein Verweis, den kein Leser kennt, ist eine unsichtbare Quelle (die Falle der leeren
  Flächenkästen vom 26.08.2026, in die andere Richtung).
- 💣 **Der Abgleich MUSS mitziehen**, sonst holt der nächste „Syncen" alles zurück an die Labels.
- 💣 **Dubletten per DELETE, dann UPDATE** — `uq_feature_source (entity_type, entity_public_id, source_id)` bricht
  sonst beim ersten Umzug einer Quelle, die die Fläche schon hat.
- ⚠️ Beim Lösen einer Bindung bleiben die Quellen an der Fläche — gewollt, und im Dialog gesagt.
- ⚠️ Der Beschriftungsdialog einer gebundenen Beschriftung sagt, WOHIN er schreibt („Quellen der Landschaft …").
- 🔴 **Abnahme heißt Ablauf** (Owner-Sitzung): gebundene Beschriftung öffnen → Quelle eintragen → Flächendialog derselben
  Landschaft: sie ist da → zweite Beschriftung derselben Fläche: sie ist da → dort ✕: überall weg. Freie Beschriftung:
  Quelle bleibt bei ihr. Landschaft ohne Beschriftung: der Kasten steht, Eintragen wirkt.

---

## 7 · Offene Fragen an den Owner

1. **Wanderung beim Binden** (Regel 4): Quellen einer freien Beschriftung wandern beim Binden zur Fläche und bleiben beim
   Lösen dort. Einverstanden — oder sollen sie beim Lösen zurück ans Schild?
2. **Anzeige an der gebundenen Beschriftung:** ihre Datenbox zeigt die Quellen der Landschaft (also nach dem Umzug
   dieselben wie heute). Einverstanden?
