# Der Wiki-Override für alle Objektarten — Entwurf

> **Stand 17.08.2026.** Mockup: `docs/wiki-override-mockup.html`.
> Auftrag: `docs/superpowers/prompts/2026-08-17-wiki-overrides-fuer-alle.md`.
> Vorgänger, dessen Infrastruktur dieser Entwurf benutzt:
> `docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md`.

## 0 · Was der Owner will

> „Der Territoriumseditor ist viel besser, weil er mit ‚Editieren' explizit die Textlabels frei
> schaltet und beim Speichern anzeigt, was sich gegenüber dem WikiSync verändert hat. UND ICH KANN
> ES SOGAR ZURÜCKSETZEN."

> „das ist der grund, warum ich wikisync überhaupt haben wollte. weil ich sehen will, **was gesynct
> und was von uns editiert ist**."

Und zur Reichweite, am 17.08.2026:

> „‚alles' ist übertrieben. alles: orte, territorien (gibts schon), regionen, wege, kraftlinien,
> literatur, karten (werden aktuell noch zugewiesen). und **nur bei feldern, die aus dem wiki
> kommen**."

🔴 **Der zweite Satz ist die eigentliche Eingrenzung** und macht den Auftrag klein: nicht „jedes
Feld jedes Editors", sondern genau die Felder, für die es eine Wiki-Entsprechung gibt. Die stehen
bereits abschließend an einer Stelle — im Feldregister `js/ui/wiki-assign-registry.js`, als die
Zeilen mit einem nicht-leeren `karte`.

## 1 · Der Ist-Zustand, gemessen am 17.08.2026

### 1.1 Was das Territorium kann und woher

Die Override-Maske steht in `html/wiki-sync-monitor.html` („Wiki-Daten und Eigene Overrides"), die
Ablage ist `wiki_territory_model.metadata_overrides_json`, die Speicher-Entscheidung ist als reine
Funktion herausgelöst (`js/review/wiki-model-override-save.js`). Drei Bauteile:

| | Bauteil | Stelle |
|---|---|---|
| Abweichung sichtbar | `<span class="dt-old">Wiki</span><span class="dt-arrow">→</span><span class="dt-new">unser</span>` | `renderDetail`, `addF` |
| „von uns" markiert | `.dt-grid .k.ovr` — die Beschriftung wird braun | `k${ov?' ovr':''}` |
| feldweise zurück | `<span class="dt-reset" data-reset="…">↺</span>` → `clear_field_override` | `renderEditForm`, `resetField` |

⚠️ Fehlt eine Seite, steht dort **`(leer)`** — nicht „—" und nicht nichts.

🪤 **Und eine Schwäche des Vorbilds, die nicht mitkopiert wird:** im Bearbeiten-Modus verschwindet
der durchgestrichene Wiki-Wert, weil aus `dt-new` ein `<input>` wird. Die übrigen Editoren sind
ohnehin immer Formulare — dort stehen Durchstreichung, ↺ und Eingabefeld nebeneinander, und der
„Editieren"-Knopf entfällt (Owner 17.08.2026, „auch ohne den editieren knopf").

### 1.2 Welche Felder überhaupt aus dem Wiki kommen

Gezählt im Feldregister, Zeilen mit `karte !== ""`:

| Objektart | Anzahl | Felder |
|---|---:|---|
| ort | 5 | `name` · `feature_subtype` · `einwohner` · `lage` · `oberhaupt` |
| literatur | 10 | `title` · `product_type` · `edition` · `series` · `authors` · `genre` · `complexity_gm` · `complexity_pl` · `fshop_code` · `isbn` |
| landschaft | 2 | `name` · `region_type` |
| landschaftslabel | 2 | `text` · `feature_subtype` |
| weg | 1 (+1) | `feature_subtype`; dazu `name`, den `assign_to` serverseitig auf alle Segmente schreibt |
| territorium | — | hat den Override bereits |
| **kraftlinie** | **0** | vier Wiki-Felder, **kein** bearbeitbares Kartenfeld |
| **karte** | **0** | zwei Wiki-Felder (Seitenart, Kontinent), **kein** Kartenziel |

🔴 **Kraftlinie und Karte bekommen nichts, und das ist eine Messung, keine Auslassung.** Dort landet
kein Wiki-Wert auf einem Kartenfeld, also kann per Definition nichts abweichen und nichts
zurückgesetzt werden. Sobald ein Wert dort ein Ziel bekommt, kostet er dieselbe eine Registerzeile
wie überall (Owner am 17.08. bestätigt).

**Summe: 21 Felder in 5 Objektarten, verteilt auf 8 Oberflächen.**

### 1.3 Wo die Herkunft heute steht — und wo sie lügt

| Ablage | Objektart | Zustand |
|---|---|---|
| `metadata_overrides_json` | territorium | trägt, seit Monaten |
| `field_origins_json` | literatur (`adventure`) | vorhanden, **unbrauchbar** — siehe unten |
| `field_origins_json` | lore (`lore_entry`) | vorhanden, wird von `lore-edit.php` je Feld gesetzt |
| `properties_json` | ort, weg, landschaftslabel (`map_features`), landschaft (`ecosystem_region`) | Spalte da, Herkunft **nicht** geführt |

💣 **`adventure.field_origins_json` ist großzügig bis zur Wertlosigkeit.** `avesmapsUpsertGameLiterature`
(`api/_internal/app/game-literature.php:1008-1013`) setzt `$origins[$field] = 'manual'` für **jedes
Feld, das der Aufrufer mitgeschickt hat** — und `gatherStamm()` im Literatur-Editor schickt bei jedem
Speichern alle mit. Nach **einem einzigen** Speichern trägt jedes Feld „von Hand". Der Massenabgleich
`avesmapsGameLiteratureFieldPlan` (`game-literature-sync.php:58-79`) überspringt daraufhin alles —
funktional die sichere Richtung, als **Auskunft** aber leer.

⭐ **Und die Literatur ist damit trotzdem am weitesten:** sie ist die einzige Objektart, die
`handgesetzt` heute schon füllt (`js/ui/wiki-assign-literatur.js:250`, aus `field_origins`). 🪤 Der
Auftrag sagt, `handgesetzt` werde „von keiner Oberfläche gefüllt" — das war bis zum 16.08.2026 wahr
und ist es seither nicht mehr. Der Satz steht hier, damit die Korrektur nicht verlorengeht.

### 1.4 Wo der Wiki-Stand liegt, gegen den verglichen wird

Alle Objektarten tragen den Wiki-Stand **am Objekt selbst** — es braucht keinen zweiten Abruf:

| Objektart | Wiki-Stand |
|---|---|
| ort | `properties.wiki_settlement` (voller Infobox-Schnappschuss, `avesmapsWikiSettlementAssignTo`) |
| weg | `properties.wiki_path` |
| landschaftslabel | `properties.wiki_region` |
| landschaft | `ecosystem_region.wiki_region_key` → Staging |
| literatur | `wiki_adventure_catalog` über `adventure.wiki_key` |

⚠️ Die vier `wiki_*`-Nester sind die `AVESMAPS_CONFLICT_CLAIM_BLOCKS` (`api/_internal/conflicts/core.php:58`)
— dieselbe Ablage, die das Konfliktzentrum liest. Kein zweites System.

## 2 · Die Entscheidungen

### 2.1 🔴 Die eine Regel, die alles trägt

> **Beim Speichern bekommt jedes Feld, dessen Wert sich WIRKLICH ÄNDERT, eine Herkunft: „Wiki",
> wenn die Anfrage dieses Feld ausdrücklich als Wiki-Übernahme nennt — sonst „von uns". Ein Feld,
> das sich nicht ändert, wird nicht angefasst.**

Beide Hälften sind nötig und beide sind teuer erkauft:

💣 **„nur was sich ändert"** — sonst entsteht genau die Literatur-Lage aus §1.3: ein Formular, das
alle Felder mitschickt, stempelt alle. Wortgleiches Vorbild im Haus, aus demselben Anlass:
`avesmapsWikiModelPlanOverrideSaves` (`js/review/wiki-model-override-save.js:60-65`) — „ein Feld, das
der Benutzer nicht angefasst hat, löst gar nichts aus" (Fall #72).

💣 **„im Zweifel von uns"** — eine falsche „Wiki"-Angabe ließe einen späteren Abgleich eine
Handarbeit überschreiben (Datenverlust); eine falsche „von uns"-Angabe schützt nur zu viel
(Ärgernis). Also: wer nichts sagt, hat von Hand geschrieben.

⚠️ **Folge für die Ladelücke** (AGENTS.md §7): eine gecachte Oberfläche, die den neuen
Payload-Schlüssel noch nicht kennt, stempelt ihre Wiki-Übernahmen als „von uns". Das ist die
harmlose Richtung und heilt sich bei der nächsten Übernahme.

### 2.2 🔴 Warum der Client sagen muss, was er aus dem Wiki genommen hat

Naheliegend wäre: der Server vergleicht den neuen Wert selbst gegen den Wiki-Stand, den er ohnehin
hat, und braucht gar keine Angabe. **Das geht nicht**, und zwar an genau drei Feldern:

`feature_subtype` (Ort), `feature_subtype` (Weg) und `region_type` (Landschaft) sind **abgebildete**
Werte — freier Wikitext → Schlüsselvorrat. Die Abbildungen (`avesmapsWikiAssignOrtOrtsgroesse`,
`avesmapsWikiAssignWegWegtyp`, `avesmapsWikiAssignLandschaftArt`) leben **nur im Browser**, und die
letzte trägt zusätzlich die Ordnung „eigenes Vokabular vor Server-Synonymen". Sie serverseitig
nachzubauen wäre die zweite Wahrheit, die §5 der Hausregeln verbietet.

🔴 Also: **die Anfrage nennt die Felder, die sie aus dem Wiki genommen hat** (`wiki_uebernommen`),
der Server stempelt daraus nur die, deren Wert sich tatsächlich geändert hat. Der Client entscheidet
das WAS, der Server das OB.

### 2.3 🔴 Ablage: `properties.field_origins`, keine neue Spalte

```
properties_json: { …, "field_origins": { "einwohner": "manual", "name": "wiki" } }
```

- **Kein `CREATE TABLE`, kein `ALTER`, keine Migration.** Alle fünf Objektarten haben eine
  Eigenschaftenspalte (`map_features.properties_json`, `ecosystem_region.properties_json`,
  `adventure.field_origins_json`).
- **Der Name ist `field_origins`, englisch**, obwohl der Code deutsch ist (§8): er ist der bereits
  vergebene Hausname derselben Sache (`adventure`, `lore_entry`). Ein zweiter Name für dieselbe
  Sache ist genau das, was §5 verhindert. Die Beschriftungen bleiben deutsch.
- ⚠️ **Ein Feld ohne Eintrag heißt „nicht bekannt", nicht „vom Wiki".** Wie beim
  `wiki_no_article`-Merker wird ein Zustand nur abgelegt, wenn er etwas aussagt — sonst ließe sich
  „nie entschieden" später nicht von „bewusst gesetzt" unterscheiden.
- 🔴 **Kein Einmal-Lauf, keine Rückwirkung.** Am ersten Tag trägt kein Feld eine Herkunft; die
  Oberfläche zeigt dann genau, was heute schon gilt, und füllt sich mit jeder Bearbeitung.

### 2.4 🔴 Was die Zeile zeigt — zwei Zustände, nicht vier

| Was man sieht | heißt |
|---|---|
| Beschriftung **braun** (`.k.ovr`) + durchgestrichener Wiki-Wert + ↺ | Herkunft `manual` — wir haben es gesetzt |
| Beschriftung normal + durchgestrichener Wiki-Wert + ↺ | weicht ab, Herkunft unbekannt |
| nichts | kein Unterschied — oder kein Wiki-Artikel zugewiesen |

🔴 **Kein drittes Abzeichen** (Owner 17.08.2026: „bau doch einfach territorien nach"). Ein erster
Entwurf trug drei Marken (`✎ von uns` · `≠` · `⇣ Wiki`); die mittlere ist redundant zur
Durchstreichung, die dritte stünde an fast jedem gepflegten Feld und wäre reine Verzierung.
Herkunft `wiki` wird **mitgeschrieben, aber nicht angezeigt** — sie wirkt dort, wo sie etwas
ändert: beim Vorhäkeln (§2.6).

### 2.5 🔴 Das ↺ ist die Sync-Übernahme einer einzigen Zeile

Es füllt das Formularfeld mit dem Wiki-Wert und trägt das Feld in `wiki_uebernommen` ein.
Geschrieben wird mit „Speichern", wie bei jeder anderen Änderung.

⭐ **Damit entsteht kein einziger neuer Schreibweg**: dasselbe, was `syncUebernehmen` heute für alle
angehäkelten Zeilen tut (gemessen: `settlementWikiAssignSyncUebernehmen` füllt nur das Formular),
nur für eine Zeile. Kein neuer Endpunkt, keine neue Berechtigung, dieselbe Speicherleiste, dasselbe
„Verwerfen".

💣 **Das ↺ darf nie mit weggekappt werden.** Es steht in derselben Zelle wie der durchgestrichene
Wert; wenn der Platz eng wird, schrumpft der Wert (Auslassungspunkte + Tooltip), nie der Knopf.

### 2.6 🔴 Die Sync-Vorschau wird genau statt vorsichtig

Heute ist **nichts** vorangehakt, sobald auf der Karte ein Wert steht (Owner-Entscheid 16.08.2026,
„konservativ") — begründet damit, dass niemand wissen konnte, ob er von Hand kam. Mit der Herkunft
kann man es wissen. Die Prüfreihenfolge in `avesmapsWikiAssignDiff` wird:

1. gleich → gar nicht gelistet
2. Wiki sagt nichts, Karte hat etwas → gelistet, **nie** gehakt
3. Herkunft `manual` → gelistet, **nie** gehakt („von Hand gesetzt — würde zurückgedreht")
4. **NEU:** Herkunft `wiki` → gelistet und **vorangehakt** („kam zuletzt aus dem Wiki — Auffrischen
   ist gefahrlos")
5. Kartenwert gefüllt, Herkunft unbekannt → gelistet, nicht gehakt (heutiges Verhalten)
6. Kartenwert leer → gelistet und vorangehakt (die Lücke)

⚠️ **Die Reihenfolge IST die Regel** — 3 vor 4 vor 5, vom spezifischsten zum allgemeinsten.
🔴 **Am ersten Tag ändert sich dadurch nichts**: ohne gespeicherte Herkunft greift weder 3 noch 4,
und alles verhält sich wie heute. Der Owner-Entscheid vom 16.08. wird also nicht zurückgedreht,
sondern bekommt das Wissen, das ihm damals gefehlt hat.

### 2.7 Signatur von `avesmapsWikiAssignDiff`

Der vierte Parameter wird von `handgesetzt: string[]` zu `herkunft: {kartenfeld: "manual"|"wiki"}`.

⚠️ **Keine zwei Formen, kein Rückfall auf das Array.** Genau ein Aufrufer außerhalb der Tests
existiert (`js/ui/wiki-assign.js:1328`), und genau ein Datenweg füllt das Feld
(`wiki-assign-literatur.js:250`). Beide werden mitgezogen. Ein toleranter Leser, der beide Formen
nimmt, wäre die Divergenz, auf die dieser Umbau verzichtet.

### 2.8 Das Layout, gemessen

Die Zeile lautet: **Beschriftung · durchgestrichener Wiki-Wert + ↺ · Eingabefeld**, alle
Eingabefelder untereinander (`css/components/editor-page.css:516`: „so the field edges line up
across every group and every editor").

🔴 **Das Eingabefeld bekommt mindestens die HÄLFTE der Rasterbreite** (Owner 17.08.2026); der
Wiki-Stand weicht als Erster. Am Mockup über fünf Breiten gemessen:

| Raster | Feld | Anteil | längster Wiki-Wert („Kosch · Mittelreich", 105 px) |
|---:|---:|---:|---|
| 614 px | 349 px | 57 % | voll |
| 534 px | 269 px | 50 % | voll |
| 426 px | 213 px | 50 % | gekürzt auf 53 px |
| 354 px | 177 px | 50 % | gekürzt auf 17 px |
| 274 px | 109 px | 40 % | verschwindet |

💣 **Die obere Schranke des `clamp()` ist tragend, nicht Zierrat.** Ohne sie fordern die drei
Spalten bei schmalem Fenster mehr als 100 % an und das Raster hängt eine waagerechte Bildlaufleiste
an — bei 300 px gemessen und behoben; in der ersten Rechnung war das ↺ schlicht vergessen.

💣 **Die Auslassungspunkte gehören an den TEXT, nicht an die Zelle.** Standen `overflow:hidden` und
`text-overflow:ellipsis` an der Zelle, wurde der zu lange Wert **hart abgeschnitten** — `ellipsis`
wirkt nur auf das Element, dessen eigener Text überläuft, nie auf ein überlaufendes Kind. Gemessen:
„Kosch · Mittelreich" bei 58 px Spaltenbreite, ohne ein einziges Pünktchen.

🔧 **Ungemessen: wie breit die Detailspalte des Ortseditors live wirklich ist.** Dafür braucht es
eine angemeldete Sitzung. Liegt sie unter 534 px und stört die Kürzung, gibt es genau einen Hebel:
`--avm-field-label-w` für dieses Fenster von 130 auf 96 px — eine gemeinsame Variable, alle Raster
rücken zusammen mit, es bleibt bündig.

💣 **ZWEI Hüllen, und das ist die Obergrenze** — dieselbe Regel wie bei der Wiki-Zuweisung und den
Listenzeilen. Die Editorfenster tragen ein `.dt-grid` (Beschriftung links); die Kartendialoge
tragen gestapelte `.location-report-form__field` (Beschriftung oben, gemessen an
`index.html:1298-1336`). Die zweite Hülle bekommt dieselbe Dreiteilung in ihrer eigenen Bauform —
**abgeschrieben wird die Regel, nicht das CSS.**

## 3 · Die Bauteile

### 3.1 Neu: `js/ui/wiki-feld-herkunft.js` (rein)

```
avesmapsWikiFeldStand(felder, kartenwerte, wikiwerte, herkunft)
  -> { [kartenfeld]: { wikiWert, abweicht: bool, herkunft: "manual"|"wiki"|"" } }
```

Kein DOM, kein `fetch`, kein Zustand — dieselbe Bauform wie `wiki-assign-diff.js`. Er beantwortet
für **jedes** erklärte Feld mit Kartenziel, was die Zeile zeigen soll. Anzeige-Zeilen (`karte: ""`)
kommen nicht vor.

⚠️ Er normalisiert **wortgleich** zu `avesmapsWikiAssignDiffNormalize` (`null`/`undefined` = `""`,
Ränder beschnitten). Zwei Normalisierungen wären zwei Wahrheiten: die Zeile zeigte eine Abweichung,
die die Vorschau nicht listet.

### 3.2 Geändert: `js/ui/wiki-assign-diff.js`

Vierter Parameter wird die Herkunftskarte (§2.7), neue Regel 4 (§2.6).

### 3.3 Geändert: `js/ui/wiki-assign.js`

`laden` gibt statt `handgesetzt: string[]` ein `herkunft: {}` zurück. 🔴 Der Vertrag bleibt
unangetastet: ein `laden`, das im Fehlerfall auflöst statt abzulehnen, bleibt der teuerste Fehler
dieses Bauteils.

### 3.4 Je Objektart: der Datenweg liest die Herkunft

`avesmapsWikiAssign<Art>Zustand` gibt `herkunft` mit heraus — beim Ort aus
`properties.field_origins`, bei der Literatur aus `field_origins` (dort schon vorhanden).

### 3.5 Serverseitig: EIN Stempler je Schreibweg

```php
avesmapsFieldOriginsStempeln(array $bestand, array $vorher, array $nachher, array $ausWiki): array
```

Rein, in `api/_internal/map/field-origins.php`. Vergleicht `$vorher`/`$nachher` feldweise, stempelt
nur die geänderten, `wiki` wenn das Feld in `$ausWiki` steht, sonst `manual`.

💣 **JE SCHREIBWEG EINER, UND DIE ZAHL STEHT NIRGENDS IM KOMMENTAR.** Die Falle vom 14.08.2026
(Verkehrsmittel-Sperre in zwei von vier Erzeugern) und ihre Lehre: eine Zahl im Kommentar liest sich
wie eine vollständige Liste, also sucht niemand weiter. Die Schreibwege werden zur **Laufzeit
gezählt** — ein Test greppt den `api/`-Baum nach den Funktionen, die ein Kartenfeld dieser Objektart
schreiben, und verlangt für jede einen Stempel-Aufruf.

## 4 · Die Reihenfolge

Jede Oberfläche geht **einzeln live** (AGENTS.md §9), der Owner sieht jede.

1. **Ort** — 5 Felder, 2 Oberflächen (Editorfenster + Kartendialog). Der größte Nutzen, und er
   klärt beide Hüllen.
2. **Literatur** — 10 Felder, 1 Oberfläche. Repariert nebenbei die kaputte Herkunft aus §1.3.
3. **Landschaft** — 2 Felder, 2 Oberflächen.
4. **Landschaftslabel** — 2 Felder, 1 Oberfläche.
5. **Weg** — 1 (+1) Feld, 2 Oberflächen. Zuletzt, weil `assign_to` den Namen serverseitig auf den
   ganzen Namensverbund schreibt und das eine eigene Überlegung ist.

## 5 · Abnahme

🔴 **Abnahme heißt ABLAUF, nicht Maß** (§9). Je Oberfläche werden diese Handgriffe wirklich
ausgeführt und benannt:

1. Ein Feld von Hand ändern, speichern, neu laden → Beschriftung braun, Wiki-Wert durchgestrichen.
2. ↺ drücken → Feld trägt den Wiki-Wert, Meldung „noch nicht gespeichert", Durchstreichung weg
   nach dem Speichern.
3. „Verwerfen" nach einem ↺ → alter Stand zurück, Herkunft unverändert.
4. Ein **anderes** Feld speichern → die Herkunft des ersten bleibt stehen (die Fall-#72-Probe).
5. Sync-Vorschau öffnen → ein `wiki`-Feld ist vorangehakt, ein `manual`-Feld nicht.

💣 **Jede neue Zusicherung wird EINZELN mutiert** — Gegenstand kaputtmachen, roten Lauf mit der
echten Meldung festhalten, zurücksetzen. Keine Bündel-Mutation, und die Mutation muss treffen, was
sie treffen soll (die sieben Formen aus dem Auftrag).

## 6 · Was NICHT dazugehört

- **Kraftlinie und Karte** (§1.2) — kein Wiki-Wert auf einem Kartenfeld.
- **Der „Editieren"-Knopf** — die anderen Fenster sind ohnehin Formulare (Owner 17.08.2026).
- **Die Kartenseite des Territoriums** (`political_territory.name/type/parent`, `#region-edit-dialog`):
  `political_territory` hat keine Eigenschaftenspalte, und der vorhandene Override sitzt am
  Wiki-Knoten. Der Owner nennt das Territorium „gibts schon". 🔧 Wer es später will, braucht eine
  Spalte plus einen Schreibweg — eine Owner-Entscheidung, kein Nachtrag.
- **Die Namensvarianten-Ernte** bei den 821 Orten ohne Zuweisung (eigener Auftrag).
