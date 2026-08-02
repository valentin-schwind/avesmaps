# Spotlight-Suche: Abenteuer und Vorkommen (Entwurf)

**Stand:** 2026-08-02 · **Herkunft:** Fortsetzung von Discord-Fall **#57**
(`docs/superpowers/specs/2026-08-02-spotlight-kartensammlungen-design.md`, §6 und §9 verweisen
ausdrücklich auf diese Runde). Owner-Freigabe des Entwurfs am 2026-08-02.

Die Kartensammlung ist seit dem 2026-08-02 als **vierte** Suchquelle live. Dieser Entwurf hängt die
**fünfte und sechste** ein — Abenteuer und Vorkommen (Flora/Fauna/Waren) — nach demselben Muster,
und verallgemeinert dabei die Karten-Mechanik, statt sie ein zweites und drittes Mal zu schreiben.

---

## 1. Datenlage — gemessen, nicht geschätzt

Alle Zahlen live erhoben am 2026-08-02 (Einzelabrufe, keine Schleifen; Umlaute explizit
UTF-8-kodiert gesendet).

### 1.1 Abenteuer: der Bestand trägt

`GET /api/app/adventures.php` → **1.352 Abenteuer**, `adventures_enabled: true`.

| Feld | gefüllt |
|---|---|
| `title`, `wiki_url`, `product_type` | 1352 / 1352 |
| `edition` | 1314 (97 %) |
| `cover_url` | 1097 (81 %) |
| `genre` | 960 (71 %) |
| `complexity_pl` / `complexity_gm` | 877 / 820 |
| `series` | 805 (59 %) |
| `contained_in` | 488 (36 %) |
| **`bf_year` / `bf_label`** | **6 (0 %)** |
| **`isbn`** | **0** |

💣 **`bf_year` und `isbn` sind als Suchtext und als Sortierachse unbrauchbar.** `{{Infobox Produkt}}`
führt keine BF-Jahreszahl (`api/_internal/wiki/adventure-sync.php` sagt es ausdrücklich), also füllt
der Wiki-Sync das Feld nie. Die einzige gefüllte Zeitachse ist `edition` — dieselbe, auf der der
Abenteuer-Dialog schon „neueste zuerst" sortiert (`avesmapsCompareAdventureRecency`).

### 1.2 Abenteuer: Orte und Rollen

**2.734 Ortszuweisungen** auf 1.168 Abenteuer (86 %); im Schnitt 2,3 Orte, Maximum 22.

| | |
|---|---|
| Rollen | `play` 1568 · `start` 1166 |
| Zielarten | `settlement` 1000 · `region` 981 · **`unresolved` 429** · `territory` 302 · `path` 22 |
| mit `target_public_id` | 2305 von 2734 (84 %) |

Je Abenteuer:

| | Abenteuer |
|---|---|
| mit **aufgelöstem `start`-Ort** | **976 (72 %)** |
| mit irgendeinem aufgelösten Ort | 1056 (78 %) |
| nur `play` aufgelöst, `start` fehlt/unaufgelöst | 80 |
| **ohne jedes Sprungziel** | **296 (22 %)** |
| hat `start` **und** `play` | 768 |
| hat **nur** `play` | **4** |

Zielart des ersten aufgelösten `start`-Orts: `settlement` 526 · `region` 311 · `territory` 134 ·
`path` 5.

### 1.3 💣 Abenteuer: das Gattungswort flutet härter als bei den Karten

Das Wort **„abenteuer" steckt in 1.040 von 1.352** Einträgen (Titel/Art/Genre/Reihe zusammen),
„gruppenabenteuer" in 756, „szenario" in 522. Bei den Karten waren es 331 von 455. Ohne Deckelung
mauert eine einzige Eingabe die ganze Trefferliste zu — die Deckelung ist hier kein Feinschliff,
sondern die Bedingung, unter der das Feature überhaupt versendbar ist.

Zweite Folge: bei 1.040 gleich bewerteten Treffern entscheidet allein die **Zweitsortierung**, welche
fünf man sieht. Ohne sie wären es fünf zufällige.

### 1.4 Vorkommen: der Bestand ist groß, die Ortsangabe dünn

`GET /api/app/lore.php?catalog=1` → **5.104 Einträge**.

| Art | Einträge | Schalter |
|---|---|---|
| `ware` | 2531 | an |
| `fauna` | 1382 | an |
| `flora` | 1004 | an |
| `spezies` | 187 | **aus** (`lore_kind_spezies_enabled`, Default aus) |

Stichprobe 500 Einträge, Ortsangaben gegen den Live-Kartenbestand geprüft (11.270 Kartenobjekte aus
`map-features.php`, dazu die Territorien):

| | Anteil |
|---|---|
| genau **ein** Ort auf der Karte | 33 % |
| **mehrere** Orte auf der Karte | 20 % |
| Orte da, aber **keiner** auf der Karte | 15 % |
| **gar keine** Ortsangabe | 31 % |

💣 **Nur gut die Hälfte der Vorkommen hat überhaupt etwas, das die Karte zeigen kann.** Von 718
Ortsangaben lösen 403 auf ein Label auf, 36 auf einen Ort, 26 auf ein Territorium — 253 (35 %) auf
gar nichts. Häufigste Angabe: **„Aventurien" (106×)**, also der ganze Kontinent; dahinter „Myranor"
(31×), „Südaventurien" (21×), „Mittelaventurien" (15×), „Nordaventurien" (9×) — allesamt keine
Kartenobjekte.

Ein Teil der unauflösbaren Angaben ist gar kein Ort: „Alchimist", „Angrosch-Kirche", „Archäopag"
stehen im selben Wiki-Feld wie echte Orte. Daran ist nichts zu reparieren; die Suche muss damit
leben.

### 1.5 💣 Was hier „Region" heißt, ist auf der Karte ein PUNKT

Der Live-Kartenbestand: 2.708 Orte, 5.714 Wege, 1.235 Verzweigungen, 792 Kreuzungen, **658 Labels**,
163 Kraftlinien — und **null** `map_features`-Regionen. Alle 658 Labels haben `Point`-Geometrie; 526
tragen `wiki_region.wiki_key`.

Die „Regionen", in denen ein Vorkommen laut Wiki vorkommt (Echsensümpfe, Herz des Kontinents, Khôm,
Nebelmoor), sind genau diese **Label-Punkte**. Flächen gibt es nur für politische Herrschaftsgebiete
(eigene Ebene) und für Landschaften (Ökosystem-Ebene, nicht standardmäßig geladen).

**Konsequenz für die Hervorhebung:** „alle Regionen hervorheben" heißt technisch „jeden gefundenen
Punkt markieren und auf die gemeinsame Ausdehnung fliegen" — nicht „Flächen einfärben". Wer eine
Flächenfärbung erwartet, würde bei den Vorkommen fast nie eine sehen.

### 1.6 Der Rückweg ist datenseitig da — aber ohne aufgelöstes Ziel

`lore_place` trägt `entry_wiki_key`, **`place_wiki_key`**, `place_title`, `relation`, `sort_order` —
und **kein** `target_kind`/`target_public_id`. Anders als `citymap_place` und `adventure_place` hat
ein Vorkommens-Ort also **nie** eine aufgelöste Kartenreferenz. Die Zuordnung passiert erst beim
Lesen, über den Wiki-Schlüssel des Kartenobjekts.

Das ist keine Lücke, die dieser Auftrag schließt — es ist der Grund, warum die Auflösung beim
**Client** liegt (§4.3).

---

## 2. Zuschnitt

**In diesem Auftrag:**

- **A** — die Karten-Mechanik wird zu **einem** Weg für alle Abschnittsquellen verallgemeinert (§3)
- **B** — Abenteuer als fünfte Suchquelle, spoilerfrei per Konstruktion (§4.1/§4.2)
- **C** — Vorkommen als sechste Suchquelle, mit Hervorhebung mehrerer Orte (§4.3)

**Nicht in diesem Auftrag:**

- Die Normalisierungs-Divergenz zwischen Server (`ue`) und Client (`u`) bleibt unangetastet —
  Begründung unverändert im Karten-Entwurf, §7.
- Die Wort-UND-Regel wird **nicht** angefasst. Sie ist live, sie ist getestet, und beide Seiten
  benutzen sie bereits. Dieser Auftrag hängt Quellen ein, er ändert keine Bewertung.
- Kein neuer Dialog, kein neuer Rechtsklick-Eintrag.
- Die Vorkommens-Ortsangaben werden **nicht** bereinigt oder nachgepflegt.

---

## 3. Teil A — eine Mechanik statt dreier

Die Kartensammlung hat drei Dinge eingeführt, die Abenteuer und Vorkommen wortgleich brauchen:

1. eine **gedeckelte Sektion außerhalb des 20er-Limits**, mit Überschrift, Gesamtzahl und
   Ausklappzeile,
2. einen **Treffer ohne eigene Geometrie**, der die Position eines zugewiesenen Kartenobjekts erbt,
3. die Übersetzung **Ortsart → Lookup-Schlüssel des Clients**
   (`settlement→location`, `territory→region`, `region→region|label`, `path→path`).

Alle drei werden verallgemeinert, statt kopiert:

| heute | künftig |
|---|---|
| `spotlightCitymapPlaceLookupKeys` | `spotlightPlaceLookupKeys` — unverändert in der Sache, ehrlich im Namen |
| `buildCitymapSpotlightEntry` | `buildPlaceBoundSpotlightEntry(result, kind)` — Karten **und** Abenteuer |
| `focusSpotlightCitymapPlace` | `focusSpotlightPlaceEntry` — dieselbe Delegation an die vier vorhandenen Focus-Helfer |
| fest verdrahteter `citymap`-Abschnitt in `renderSpotlightSearchResults` | `SPOTLIGHT_SEARCH_SECTIONS`, eine Liste aus `{kind, label, moreLabel}` |
| `entry.kind !== "citymap"` beim 20er-Schnitt | `!SPOTLIGHT_SECTION_KINDS.has(entry.kind)` |

**Warum das kein Nebenprojekt ist:** die Alternative wäre dreimal dieselbe if-Kette in
`resolveBackendSpotlightEntries`, dreimal derselbe Abschnittskopf in `renderSpotlightSearchResults`
und dreimal derselbe 20er-Schnitt-Filter. Die dritte Kopie ist die, bei der eine davon vergessen
wird — und der Fehler ist stumm (Falle 4, §6).

Die Vorkommen laufen **nicht** über `buildPlaceBoundSpotlightEntry`: sie haben mehrere Ziele statt
eines. Sie benutzen aber dieselbe Sektions-Mechanik und dieselbe Lookup-Tabelle.

---

## 4. Teil B und C — die beiden Quellen

### 4.1 Abenteuer: die Suche kennt nur den Beginn

**Regel:** Suchtexte und Sprungziel eines Abenteuers stammen **ausschließlich** aus seinen
`role='start'`-Orten. `role='play'` kommt in der Suche nicht vor — weder als Text noch als Ziel noch
als Beschriftung.

**Warum:** „beginnt hier" ist spoilerfrei, „spielt hier" ist der Spoiler. Diese Regel gibt es schon,
und das Infopanel setzt sie mit einem Schleier durch
(`avesmapsSpoilerVeilMarkup`, `adventures.spoilerVeil`). Eine Trefferzeile hat keinen Schleier: sie
steht offen in einer Liste, die man beim Tippen von etwas ganz anderem gezeigt bekommt. Die einzige
Fassung, die dort **nicht** verraten kann, ist die, die den Spielort gar nicht erst kennt.

**Was das kostet, gemessen:** 4 Abenteuer haben ausschließlich `play`-Orte; 80 haben einen
aufgelösten `play`-Ort, aber keinen aufgelösten `start`-Ort. Diese 84 bleiben über Titel, Reihe,
Genre und Art auffindbar, sind aber **nicht anspringbar** — genau wie die 296 ohne jeden Ort. Der
Preis für die Spoilerfreiheit sind also 84 von 1.352 Sprungzielen (6 %).

**Suchtexte:** `title` · `series` · `contained_in` · `product_type`-Schlüssel **und** -Beschriftung ·
`genre` · `edition` · `raw_name` des ersten `start`-Orts.

💣 **Art muss auf Schlüssel *und* Beschriftung matchen** — dieselbe Falle wie bei den Karten-Typen
(§4.2 des Karten-Entwurfs). Die Tabelle spiegelt `avesmapsAdventureProductTypeLabel`, **erweitert um
`kampagnenband` und `metaband`**: beide sind live vergeben (27 + 5), fehlen aber in der
Client-Tabelle und fallen dort auf den Rohschlüssel zurück.

`complexity_*`, `fshop_code`, `link_*`, `isbn`, `bf_*` bleiben draußen: entweder leer (§1.1) oder
keine Sucheingabe, die je ein Mensch tippt.

**Anzeige:** Name = `title`. Typzeile = Art-Beschriftung + Edition („Gruppenabenteuer · DSA5").
Hinweiszeile = „beginnt in \<Ort\>" bzw. „kein Ort auf der Karte".

⚠️ Die Edition gehört in die Typzeile, weil **29 Titel doppelt vergeben** sind („Silvanas Befreiung"
3×, „Zukunft im Sand" 3×). Ohne sie stehen zwei identische Zeilen untereinander.

**Sortierung im Abschnitt:** anspringbar vor nicht anspringbar → Score → **Edition absteigend** →
Titel. Die Edition ist die Recency-Achse, die der Abenteuer-Dialog schon benutzt; die gleiche
Reihenfolge in zwei Oberflächen ist kein Zufall, sondern Absicht (§1.3).

**Sprungziel:** der erste aufgelöste `start`-Ort (`sort_order`), über dieselbe Ortsart-Übersetzung
wie die Karten. Der Treffer fliegt hin und öffnet die Infobox des Orts — dort steht das Abenteuer
bereits unter „beginnt hier". Kein zweiter Navigationsweg. Ein Abenteuer hat keine eigene
Detailoberfläche, auf die man stattdessen springen könnte: der Abenteuer-Dialog ist ORTS-bezogen.

### 4.2 Abenteuer: Herkunft der Daten

Server-seitig in `map-search.php`, als fünfte Quelle. Not-Aus `adventures_enabled` gilt.

💣 **`avesmapsAdventuresEnabled()` darf hier NICHT benutzt werden** — es liest über
`avesmapsAppSettingGet`, das bei **jedem** Aufruf `CREATE TABLE IF NOT EXISTS app_setting` ausführt.
Auf einem tastenanschlag-getakteten öffentlichen Pfad ist das genau die DDL-Last, die AGENTS.md §10
dem PHP-Pool-Vorfall vom 2026-07-17 zuschreibt. Richtig ist
`avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_ADVENTURES_SETTING, '1') !== '0'` — dieselbe Zeile,
die die Kartensammlung seit `ec45e5e7` benutzt.

### 4.3 Vorkommen: mehrere Ziele, hervorgehoben statt angesprungen

**Regel:** ein Vorkommens-Treffer fliegt auf die **gemeinsame Ausdehnung aller** seiner gefundenen
Orte und **hebt jeden einzelnen hervor**. Bei genau einem Ort ist das schlicht ein Sprung.

Die Mechanik ist nicht neu: ein Weg-Treffer highlightet heute schon **alle** seine Segmente
(`spotlightHighlightLayer`, `SPOTLIGHT_PATH_HIGHLIGHT_STYLE`, `highlightSpotlightPaths`). Neu ist nur
die Geometrieart — Punkte und Polygone statt Linien.

- **Label / Ort** (Punktgeometrie, §1.5): ein `L.circleMarker` im selben Gold, im selben
  `routePane`.
- **Herrschaftsgebiet** (Polygone): die Umrisse der gerenderten Polygone.
- Die Ebene richtet sich nach dem **ersten** gefundenen Ort — Label → `deregraphic` +
  `syncLabelVisibility()`, Herrschaftsgebiet → `political`. Dieselbe Regel, die die vorhandenen
  Focus-Helfer je für sich anwenden.

💣 **Kein neues Farbliteral.** Die Hervorhebung erbt `SPOTLIGHT_PATH_HIGHLIGHT_STYLE`; das enthält
den einen Gold-Wert, den es dafür schon gibt (AGENTS.md §12).

**Wer auflöst — und warum nicht der Server.** `lore_place` hat kein aufgelöstes Ziel (§1.6), nur
`place_wiki_key` und `place_title`. Der Server schickt beide **unaufgelöst** mit; der Client hält
ohnehin jedes geladene Kartenobjekt samt Wiki-Schlüssel (`label.wikiRegion.wiki_key`,
`location.wikiSettlement.wiki_key`) und ist der Einzige, der weiß, was **jetzt** auf der Karte liegt.
Das ist dieselbe Aufteilung wie bei den Karten (Falle 2), nur strenger: dort konnte der Server
wenigstens „nie aufgelöst" melden, hier kann er gar nichts melden.

**Auflösungsreihenfolge im Client**, deterministisch und dokumentiert:

1. exakter `place_wiki_key` gegen den Wiki-Schlüssel eines Kartenobjekts,
2. normalisierter `place_title` gegen den Namen,
3. normalisierter `place_title` **ohne Klammerzusatz** gegen den Namen
   („Bornland (Region)" → „Bornland" — live geprüft: trifft).

Bei Namensgleichheit gewinnt **Label vor Herrschaftsgebiet vor Ort**. Grund: 403 von 465
auflösbaren Ortsangaben sind Labels; ein Vorkommen „in Thorwal" meint die Landschaft, nicht das Dorf.

**Suchtexte:** `name` · Art-Beschriftung („Flora", „Fauna", „Ware", „Spezies") · `gruppe` · `typ` ·
`place_title` aller Orte.

💣 `gruppe` und `typ` tragen **Wiki-Markup**: `[[Fisch]]`, `[[Parfüm]]`. Die eckigen Klammern müssen
raus, sonst trifft „fisch" zwar (enthalten), aber „[[fisch]]" ist als Suchtext gleichwertig zu einem
Namen — und ein Nutzer, der „parfüm" tippt, bekommt eine Zeile, deren Zusammenhang er nicht sieht.
`lebensraum` (78 von 500) und `continent` bleiben draußen.

**Anzeige:** Name = `name`. Typzeile = Art-Beschriftung. Hinweiszeile = die gefundenen Orte im
Klartext, bis zu drei, dann „+N" — „Khôm · Nebelmoor · Aventurien". Ohne gefundenen Ort: „kein Ort
auf der Karte".

Die Ortsnamen gehören in die Zeile, weil sie **die Antwort auf die gestellte Frage sind**: wer
„Chonchinis" tippt, will wissen, wo es die gibt. Steht es in der Liste, muss er nicht einmal
klicken.

**Sortierung im Abschnitt:** mit Ortsangabe vor ohne → Score → Name. Der Server kann „mit
Ortsangabe" über `place_count > 0` sagen; ob der Ort auf der Karte liegt, entscheidet erst der
Client.

**Einträge ohne Ort bleiben in der Liste** (Owner-Entscheid 2026-08-02), hinten und gekennzeichnet.
„Das Ding gibt es, wo ist unbekannt" ist mehr wert als kein Treffer — und weil sie hinten stehen,
verdrängen sie nie einen anspringbaren aus den fünf Plätzen.

### 4.4 Vorkommen: Herkunft der Daten und Not-Aus

Server-seitig in `map-search.php`, als sechste Quelle, zwei Abfragen (Einträge, dann Orte für genau
diese Schlüssel) — **kein N+1**, dieselbe Form wie `avesmapsLoreReadCatalog`.

💣 **Der Not-Aus ist PRO ART**, nicht global: `lore_kind_<art>_enabled`, Default an außer `spezies`
(`avesmapsLoreKindDefaultEnabled`). Live ist `spezies` aus — 187 Einträge, die die Suche **nicht**
zeigen darf. Auch hier gilt §4.2: `avesmapsLoreKindEnabled()` läuft über `avesmapsAppSettingGet` und
damit über die DDL, und `avesmapsLoreEnabledKinds()` ruft es **viermal**. Gelesen wird DDL-frei, in
einer Abfrage über alle vier Schlüssel.

⚠️ Zusätzlich ruft `avesmapsLoreReadCatalog` gleich zu Beginn `avesmapsLoreEnsureContinentColumn` —
eine `ALTER TABLE`-Prüfung. Die Suche benutzt diese Funktion deshalb **nicht**, sondern eine eigene,
schlanke Lesefunktion.

---

## 5. Was die Trefferliste dadurch wird

Bis zu drei Abschnitte unterhalb der Kartenobjekte, jeder nur sichtbar, wenn er Treffer hat, jeder
auf **5** gedeckelt, alle drei **außerhalb** des 20er-Limits:

```
Kartenobjekte (max. 20, unverändert)
── Kartensammlung   7 ──   max. 5   … und N weitere Karten
── Abenteuer       45 ──   max. 5   … und N weitere Abenteuer
── Vorkommen        2 ──   max. 5   … und N weitere Vorkommen
```

Reihenfolge der Abschnitte = Reihenfolge in `SPOTLIGHT_SEARCH_SECTIONS`; die Sortierordnung bekommt
`citymap: 6, adventure: 7, lore: 8`.

⚠️ Überschriften und Ausklappzeilen tragen **kein** `data-spotlight-result-index` — sonst zählt die
Pfeiltasten-Navigation sie als Treffer mit. Gilt schon, bleibt.

---

## 6. Die vier Fallen, ausdrücklich adressiert

| Falle | Wo sie hier zuschlägt | Was dagegen steht |
|---|---|---|
| **1 — die Suche existiert zweimal** | Diese Runde ändert **keine Bewertungslogik**. Beide Quellen sind server-only, wie die Karten. | In der Prüfung explizit: die vorhandenen Scoring-Tests (Server + Client) müssen unverändert grün bleiben. |
| **2 — Ortsart ≠ Lookup-Kind** | Abenteuer hängen an denselben vier Ortsarten wie Karten; Vorkommen haben gar kein aufgelöstes Ziel. | `spotlightPlaceLookupKeys` (getestet) für Abenteuer; für Vorkommen löst ausschließlich der Client auf (§4.3). |
| **3 — Not-Aus über `avesmapsXEnabled()`** | `adventures_enabled` **und** vier `lore_kind_*_enabled`. | `avesmapsAppSettingGetWithoutDdl`, für die Lore-Schlüssel in EINER Abfrage. Zusätzlich: `avesmapsLoreReadCatalog` wird umgangen (ALTER-TABLE-Prüfung). |
| **4 — unbekannter `kind` fällt lautlos durch** | Zwei neue Arten in einer if-Kette **ohne** `default`. | `selectSpotlightSearchEntry` bekommt beide Zweige, und die Prüfung klickt live je einen Treffer jeder Art. |

---

## 7. Prüfung

**Einheitentests (rein, ohne DB):**

- Abenteuer-Sucheinträge: Art matcht auf Schlüssel **und** Beschriftung (`kampagnenband`/`metaband`
  eingeschlossen) · nur `start`-Orte erscheinen in Suchtext und Ziel, ein `play`-Ort **nirgends** ·
  Typzeile trägt Art + Edition · ein Abenteuer ohne aufgelösten `start`-Ort ist
  `unresolved` · Sortierung: anspringbar vor nicht anspringbar, dann Edition absteigend.
- Vorkommen-Sucheinträge: Wiki-Markup ist aus `gruppe`/`typ` entfernt · Ortstitel sind Suchtext ·
  abgeschaltete Arten (`spezies`) kommen nicht vor · `place_count = 0` rangiert hinten.
- Client: `spotlightPlaceLookupKeys` unverändert (der vorhandene Test wird umbenannt, nicht
  geschwächt) · die Vorkommens-Ortsauflösung trifft über Wiki-Schlüssel, über Namen und über den
  Namen ohne Klammerzusatz · bei Namensgleichheit gewinnt Label vor Ort.
- Beide vorhandenen Scoring-Tests laufen unverändert grün.

**Gegen den Live-Bestand (Einzelproben, keine Schleifen):**

- `stadtabenteuer gareth` → findet Abenteuer, deren Genre „Stadtabenteuer" und deren Beginn Gareth
  ist (offline simuliert: 14 Treffer). Das ist der Mehrwort-Fall, für den die Wort-UND-Suche gebaut
  wurde.
- `alraune` → Vorkommen mit mehreren Orten; Klick hebt Khôm, Nebelmoor und Aventurien hervor.
- `gareth` → Kartenobjekte oben, dann drei Abschnitte, jeder höchstens 5.
- `spezies`-Einträge tauchen **nirgends** auf, solange der Schalter aus ist.
- Eine Stichprobe Einwort-Suchen liefert dieselben Kartenobjekt-Treffer wie vorher.
- **Antwortzeit vorher/nachher** an derselben Eingabe (§8).

---

## 8. Das Risiko, das benannt gehört

`map-search.php` läuft **tastenanschlag-getaktet** und lädt heute schon `map_features` vollständig
(11.270 Zeilen inklusive `properties_json`), die politischen Gebiete, die Innerorts-Objekte und 455
Karten. Dazu kommen künftig ~1.350 Abenteuer + ~1.170 Beginn-Orte und ~4.900 Vorkommen + ~7.000
Ortszeilen — grob **6.500 zusätzliche, aber schmale Zeilen**.

Relativ ist das wenig (die vorhandene `map_features`-Abfrage ist um ein Vielfaches schwerer), aber
behauptet ist es damit nicht. Deshalb: **Antwortzeit vor und nach dem Deploy an derselben Eingabe
messen** und die Zahl berichten. Verschlechtert sie sich spürbar, ist die nächste Stufe ein
SQL-Vorfilter auf dem ersten Suchwort — nicht in diesem Auftrag, aber vorgedacht.

---

## 9. Offene Punkte

- Die Vorkommens-Ortsangaben enthalten Nicht-Orte („Alchimist", „Angrosch-Kirche"). Das ist eine
  Datenfrage im Wiki-Sync, keine Suchfrage.
- „Aventurien" als Vorkommens-Ort (106× in 500) hebt den ganzen Kontinent hervor. Technisch richtig,
  inhaltlich nichtssagend — ob solche Rang-3-Angaben ausgeblendet gehören, ist eine Owner-Frage für
  später (das Infopanel blendet sie beim Vorkommen-Feature bereits aus).
- Die Normalisierungs-Divergenz aus dem Karten-Entwurf §1.5 bleibt offen und ungemessen.
