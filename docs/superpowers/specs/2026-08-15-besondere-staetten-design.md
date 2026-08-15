# Besondere Stätten: Akademien, Tempel, Werften — Entwurf

> Stand: 2026-08-15 · Anlass: Discord-Ideen **#54** (Tempel/Schreine, Drachenschuppe,
> 27.07.), **#59** (Brücke/Fähre/Furt, Thomas, 02.08.), **#60** (Akademien, Nottel,
> 03.08.) · Owner-Auftrag: „alle mit in unsere Liste aufnehmen, innerorts/außerorts
> prüfen, in die Suche"

## 1. Der Befund, der den Auftrag verschiebt

Der Auftrag lautete „diese zehn Wiki-Listen aufnehmen". Gemessen am Livebestand ist
**das meiste längst drin** — eine einzige Weiche wirft den Rest weg.

Live-Probe gegen `api/app/map-search.php` (15.08.2026):

| Suchbegriff | Antwort |
|---|---|
| Feuersturm-Tempel | ✅ `kind=in_settlement` |
| Beleman-Werft | ✅ `kind=in_settlement` |
| Celissabrücke | ✅ `kind=in_settlement` |
| Belhankaner Kontor | ✅ `kind=in_settlement` |
| Akademie der Erscheinungen | ❌ **kein Treffer** |

Die vier Treffer sind `Infobox Bauwerk`. Der Fehlschlag ist
`Infobox Lehreinrichtung` — und die kennt
`avesmapsWikiDumpClassifyEntityKind` (`api/_internal/wiki/dump-entity-scan.php:205`)
nicht. Sie prüft `bauwerk | festung | burg`, alles andere fällt auf `''` und wird
verworfen. **198 Artikel** tragen diese Infobox.

🔴 Das ist wörtlich die Fehlerklasse, die im Kommentar daneben schon steht
(„the same gate that once swallowed ~430 adventures", `:187`) — nur eine Zeile
tiefer und noch offen.

## 2. Die zehn Listen, gemessen

Erhoben über `list=categorymembers` und `list=embeddedin` gegen
`https://de.wiki-aventurica.de/de/api.php` (nie über die Wiki-Suche, siehe
[[wege-innerorts-erkennung-messung]]).

| Liste | Artikel | Infobox | Lage heute |
|---|---|---|---|
| Tempel | 95 + **680** in 27 Götter-Unterkategorien | Bauwerk | läuft |
| Schrein | 29 | Bauwerk | läuft |
| Heiligtum | 41 + 64 in 18 Unterkategorien | Bauwerk | läuft |
| Kontor | 58 | Bauwerk | läuft |
| Werft | 12 | Bauwerk | läuft |
| Brücke | 40 | Bauwerk | läuft |
| **Magierakademie** | **72** | **Lehreinrichtung** | **fällt durch** |
| **Kriegerakademie** | **25** | **Lehreinrichtung** | **fällt durch** |
| **Lehreinrichtung, übrige** | **~101** (13 weitere Schularten) | **Lehreinrichtung** | **fällt durch** |
| Handelsgesellschaft | 78 | **Organisation** | kein Ort |
| Bankhaus | 5 | **Organisation** | kein Ort |
| Furt | 3 | **Region** | kein Bauwerk |
| Fähre | **0** | — | existiert nicht |

Zum Vergleich der Größenordnung: 2397 Artikel tragen `Infobox Bauwerk`, 1423
`Infobox Organisation`, 198 `Infobox Lehreinrichtung`.

### Die Lehreinrichtungen brauchen fast nichts außer der Weiche

Sie sind gebaut wie ein Bauwerk, nur unter anderem Namen:

```
Akademie der Erscheinungen   |Art=[[Magierakademie]]  |Standort=[[Grangor]]: [[Alt-Grangor]]
Drachenstreiter-Akademie     |Art=[[Kriegerakademie]] |Standort=[[Birkholt]]
Horaskais. Kadettenanstalt   |Art=[[Kadettenschule]]  |Standort=[[Grangor]]: [[Grangorella]]
```

`Standort=` liest `avesmapsWikiDumpParseBuildingPage` bereits (`:811`, Feldliste
`['standort','lage','ort']`), und der vorhandene Art-Fallback (`:775-781`) macht aus
`Art=[[Magierakademie]]` die Ortsart. Der Lage-Klassifikator arbeitet unverändert
weiter — es ist dieselbe Ortskette, die er seit 27.07. bewertet.

### Fast alles liegt innerorts — der Lage-Check ist keine Hürde

Die Sorge, die Hälfte müsse erst von Hand platziert werden, ist gemessen widerlegt.
Das Wiki führt eine Kategorie `Bauwerk in <Ort>`:

| | Artikel | mit Ortszuordnung | ohne |
|---|---|---|---|
| Rondra-Tempel | 89 | 84 | 5 |
| Rahja-Tempel | 47 | 47 | 0 |
| Schrein | 29 | 26 | 3 |

Damit trägt der vorhandene „springt auf seine Stadt"-Weg
(`api/_internal/app/in-settlement-search.php`) das Feature. **Kein
Platzierungsprojekt.** Die 8 ortlosen Fälle bleiben unsichtbar, bis ein Editor sie
setzt — das ist der Status quo für jedes außerorts-Bauwerk und kein neuer Mangel.

## 3. Was gebaut wird

### Phase 1 — die Weiche öffnen (#60)

`Lehreinrichtung` als vierte anerkannte Bauwerks-Infobox.

💣 **Die Bedingung steht ZWEIMAL, wortgleich:**

| Stelle | Datei |
|---|---|
| Klassifizierung | `dump-entity-scan.php:205` (`avesmapsWikiDumpClassifyEntityKind`) |
| Parser-Riegel | `dump-entity-scan.php:753` (`avesmapsWikiDumpParseBuildingPage`) |

Wer nur die erste anfasst, bekommt eine Seite, die als BUILDING klassifiziert wird
und danach am Parser stirbt — ohne Fehlermeldung, weil der Riegel ein sauberes
`kept=false` mit Begründung zurückgibt. Der Bauplan fasst beide in einem Schritt an
und prüft mit einem Test, dass sie sich nicht wieder auseinanderentwickeln.

⚠️ **`Infobox Geschäft` bleibt draußen.** Sie kam bei genau einem Kontor vor
(„Elemitischer Kontor"). Ein Riegel wird nicht für einen Einzelfall geöffnet; er
taucht in der Fehlliste des Laufs auf und ist damit sichtbar.

Dazu die fehlenden Katalognamen **ans Ende** von
`AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES`
(`api/_internal/wiki/place-kinds.php`) — 🔴 die ersten 24 Einträge sind tragende
Reihenfolge und werden nicht berührt:

```
Magierakademie, Kriegerakademie, Kadettenschule, Gelehrtenschule, Kampfschule,
Kapitänsschule, Gladiatorenschule, Handwerkerschule, Kunstschule, Kurtisanenschule,
Novadi-Rechtsschule, Schwertgesellenschule, Universität, Fakultät, Schule,
Lehreinrichtung, Werft, Furt
```

⚠️ `Akademie` und `Kontor` stehen bereits im Katalog — nicht doppelt eintragen.
`Handelssitz` **fällt weg**: die Handelsgesellschaften sind Organisationen (Phase 3),
und eine Ortsart ohne Objekte ist tote Vokabel.

**Ergebnis:** 198 Ausbildungsstätten in der Suche, jede mit Sprung auf ihren Ort.
Nottels Auftrag, wörtlich erfüllt.

### Phase 2 — die Gottheit als dritte Achse (#54)

Drachenschuppes Frage lautet nicht „zeig mir Tempel", sondern *„wo liegt der nächste
\[Gottheit]-Schrein? Gibt es in Darpatien Rahja-Schreine außerhalb von Rommilys?"*
Das ist eine Frage nach der **Gottheit**, und die kennt avesmaps heute nicht: der
`building_type` sagt bei allen 680 Götter-Tempeln gleichlautend „Tempel".

**Die Gottheit wird ein eigenes Feld, keine Ortsart.** Dieselbe Trennung, die schon
Ortsgröße (`feature_subtype`) von Ortsart (`properties.place_kind`) trennt:

| Achse | Ort | Beispielwert |
|---|---|---|
| Ortsgröße | `map_features.feature_subtype` | `gebaeude` |
| Ortsart | `map_features.properties.place_kind` | `Tempel` |
| **Gottheit** | **`wiki_sync_pages.deity`** | **`Rahja`** |

🔴 **EINE Quelle, kein Editor-Feld — die Gottheit gehört dem Wiki.** Sie steht in der
Registry und nirgends sonst. Das ist kein Sonderweg, sondern genau der Weg, den
`building_type` schon geht: `api/app/map-features.php:470-475` heftet die
Registry-Werte beim Ausliefern an `properties.wiki_settlement`, gefunden über den
Wiki-Titel. Ein `properties.deity` daneben wäre eine zweite Wahrheit, die
auseinanderläuft — und ein Editor-Feld für 775 Stätten wäre Handarbeit für etwas, das
die Kategorie schon weiß.

Damit hat sie **zwei Leser und einen Schreiber**:

| Leser | Weg |
|---|---|
| Innerorts-Treffer (die Masse: 775 Tempel) | liest `wiki_sync_pages` direkt (`in-settlement-search.php:47`) |
| platzierte Stätte (Karte, Infobox) | bekommt sie über die Anreicherung in `map-features.php:470` als `wiki_settlement.deity` |

⚠️ Die Registry-Abfrage in `in-settlement-search.php:47` holt heute vier Spalten; sie
holt danach fünf. Der `try/catch` darum ist Absicht (fehlende Spalte darf die
Kartensuche nicht fällen) — er verschluckt aber auch einen Tippfehler im Spaltennamen
lautlos. Der Test dazu füttert deshalb die reine Funktion, nicht die Abfrage.

Gegen 27 neue Ortsarten (`Rondra-Tempel`, `Rahja-Tempel`, …) spricht Gemessenes,
nicht Geschmack: „Rahja-Schrein" und „Rahja-Tempel" wären zwei unverbundene Arten,
und die 29 Schreine hätten gar keine — sie haben keine Götter-Kategorie.

💣 **Die Gottheit kommt aus der Kategorie-SCHICHT, nicht aus dem Wikitext.**
Geprüft an vier Artikeln: „Drachentempel" steht laut API in `Kategorie:Rondra-Tempel`,
sein Wikitext enthält **keinen** `[[Kategorie:Rondra-Tempel]]`-Link — die Kategorie
kommt über eine Vorlage. `avesmapsWikiSettlementMatchBuildingType` liest aber literale
Kategorien aus dem Wikitext (`dump-entity-scan.php:774`). Der Dump-Pfad kann die
Gottheit deshalb **prinzipiell nicht sehen**. Sie muss über
`avesmapsWikiDumpCategoryFetchBuildingTypeMap`
(`api/_internal/wiki/dump-category-layer.php:276`) kommen — und die steht heute auf
**Tiefe 0**, weshalb die 680 Götter-Tempel brachliegen.

💣 **Die Gottheit ist MEHRWERTIG.** Der Feuersturm-Tempel steht in
`Ingerimm-Tempel` **und** `Rondra-Tempel`; „Schrein der Rondra und des Kor" sagt es
im Namen. Ein einzelner String verliert hier lautlos die Hälfte — das Feld ist eine
Liste, und die Anzeige nennt die erste.

💣 **`search_texts` trägt heute NUR den Titel** (`in-settlement-search.php:239`).
Ein Feld, das nicht dort steht, ist für die Suche nicht vorhanden: „rahja" fände die
47 Rahja-Tempel auch dann nicht, wenn ihr Typ „Rahja-Tempel" hieße. Die Gottheit muss
ausdrücklich in `search_texts`.
⚠️ Der Kommentar darüber (`:237`) verbietet den STADTNAMEN an dieser Stelle — sonst
fände „Mengbilla" seine 32 Innerorts-Objekte doppelt. Die Gottheit ist der andere
Fall: sie gehört dem Objekt, nicht seinem Behälter.

**Die Zuordnung Kategorie → Gottheit sind Daten, keine Logik** — 27 Tempel- plus 18
Heiligtum-Kategorien in einer Tabelle, nach dem Muster von `place-kinds.php` als
eigene kleine reine Datei (`api/_internal/wiki/deities.php`), ohne DB und ohne DDL.
Nicht algorithmisch aus dem Namen ableiten: `Rastullah-Bethaus`, `Oktrale` und
`Rur und Gror-Tempel` brechen jede Regel, die man sich für die anderen 24 ausdenkt.

**Anzeige.** `locationTypeLabelForDisplay`
(`js/map-features/map-features-location-marker-entry.js:23`) setzt die Typzeile heute
aus `placeKind > building_type > Ortsgröße`. Die Gottheit tritt davor, wenn beide da
sind: `Rahja` + `Tempel` → **„Rahja-Tempel"**. Fehlt eine von beiden, bleibt alles
wie heute.

## 4. Was NICHT gebaut wird — und warum

**#59 ist zu zwei Dritteln gegenstandslos.** Das ist ein Befund, kein Versäumnis:

- **Brücken (40)** laufen bereits; „Celissabrücke" ist live findbar.
- **Fähren gibt es nicht.** `Kategorie:Fähre` hat 0 Artikel, `Fährstation` einen.
- **Furten sind `Infobox Region`**, keine Bauwerke — und es sind 3. `Furt` kommt als
  Ortsart-Vokabel mit (Phase 1), damit ein Editor eine Furt so benennen kann. Eine
  Kategorie-Ernte für drei Artikel, die im Regionen-Zweig hängen, lohnt nicht.

**Phase 3 — Organisations-Sitze — bekommt einen eigenen Entwurf.**
Handelsgesellschaften (78) und Bankhäuser (5) sind `Infobox Organisation`: sie haben
kein `Standort=`, sondern `Hauptsitz=` **und** `Weitere Sitze=`. Die Nordlandbank
allein nennt 30 Sitze plus 4 ehemalige. Das ist *eine Organisation an N Orten* — ein
anderes Datenmodell als alles oben, mit eigener Frage nach Zeitbezug („ehemals",
„seit 1039 BF"). Es an Phase 1 zu hängen hieße, 198 sofort nutzbare Akademien auf ein
ungelöstes Modell warten zu lassen.

**Zwei Nachbarbaustellen bleiben liegen**, ausdrücklich benannt statt stillschweigend
übergangen:

- 🔧 Die Kategorie `Bauwerk in <Ort>` verortet 84 von 89 Rondra-Tempeln — möglicherweise
  verlässlicher als unser `Standort=`-Parser. Sie zu nutzen hieße, den Lage-Klassifikator
  um eine zweite Quelle zu erweitern; das ist eine eigene Messung gegen die
  Grundwahrheit, kein Nebenprodukt.
- 🔧 Die 8 Stätten ohne jede Ortszuordnung (5 Rondra-Tempel, 3 Schreine) bleiben
  unsichtbar, bis ein Editor sie platziert.

## 5. Fallen in einer Liste

| # | Falle | Wo |
|---|---|---|
| 1 | Die Bauwerks-Bedingung steht **doppelt** — Klassifizierung UND Parser | `dump-entity-scan.php:205` + `:753` |
| 2 | Die Gottheit steht **nicht im Wikitext**, nur in der API-Kategorie | `dump-category-layer.php:276` |
| 3 | Die Gottheit ist **mehrwertig** (Doppelweihungen) | Feldtyp |
| 4 | Ein Feld außerhalb von `search_texts` ist **für die Suche nicht vorhanden** | `in-settlement-search.php:239` |
| 5 | Die ersten **24** Katalogeinträge sind tragende Reihenfolge (Dump) | `place-kinds.php:79` |
| 6 | `in_settlement` hat **Rang 5** und wird auf `$limit` gekappt — 47 Rahja-Tempel konkurrieren mit den 20 Plätzen | `map-search.php:354` + `:523` |
| 7 | Tiefe 1 heißt **45 zusätzliche Wiki-Abfragen** je Lauf — auf STRATO messen, nicht schätzen | AGENTS.md §9 |

**Zu Falle 6:** bei „rahja" gibt es kaum echte Kartenobjekte, die Tempel kommen also
durch. Bei „tempel" (775 Stück) nicht. Ob das eine eigene Sektion nach dem Muster von
`SPOTLIGHT_SEARCH_SECTIONS` braucht, wird **gemessen entschieden**, nachdem Phase 2
Daten hat — nicht vorher gebaut. Der Owner hat „keine neue Oberfläche" gewählt.

## 6. Abnahme

Kein Maß, sondern Handgriffe (AGENTS.md §9):

**Phase 1**
1. „akademie der erscheinungen" in die Suche tippen → Treffer erscheint, Zeile sagt
   „Magierakademie in Grangor", Klick fliegt auf Grangor.
2. „drachenstreiter" → Treffer, springt auf Birkholt.
3. Ein Ort, der vorher ging (Feuersturm-Tempel), geht unverändert.
4. Die Fehlliste des Laufs nennt `Infobox Geschäft`/`Infobox Organisation` als
   verworfen — der Riegel ist noch da, nur breiter.

**Phase 2**
5. „rahja" → mehrere Rahja-Tempel in verschiedenen Orten, nicht nur Rommilys.
6. Feuersturm-Tempel öffnen → Typzeile nennt eine der beiden Gottheiten, nicht „Tempel".
7. Ein Tempel ohne Götter-Kategorie zeigt weiter „Tempel", nichts Leeres.

⚠️ Beides wirkt erst nach **„📥 Dump holen" UND danach „Syncen"** (🔧 Owner, in dieser
Reihenfolge). Der Code ändert nicht die Datenbank, sondern was der nächste Lauf einsammelt.

💣 **„Syncen" allein reicht nicht, und das sieht man ihm nicht an.** Der Fix sitzt im
**Dump-Pfad** (`avesmapsWikiDumpParseBuildingPage`); „Syncen" (`sync_kind`) liest nur die
Sandbox-Zeilen des **neuesten fertigen Dump-Laufs**. Stammt der von vor dem Fix, enthält
er keine Lehreinrichtung — und der Sync läuft sauber durch, ohne etwas zu finden. Dazu
kommt: die Suche verlangt ein gefülltes `standort`, und das schreibt ausschließlich der
Dump-Pfad; der Online-Crawl (`settlements.php:1004`) hat die Bauwerks-Infobox nie gelesen.
Am 15.08.2026 kostete genau das einen Fehlalarm.

## 7. Tests

Alle ohne Datenbank und ohne Browser, wie die Nachbarn:

| Test | Sichert |
|---|---|
| `dump-entity-scan`-Ergänzung | `Infobox Lehreinrichtung` klassifiziert **und** parst; die zwei Bedingungen nennen dieselben vier Namen |
| `place-kinds`-Test (vorhanden) | die ersten 24 Einträge byte-genau unverändert |
| neuer `deities`-Test | 45 Kategorien → Gottheit; Mehrfachweihung liefert beide; unbekannte Kategorie liefert nichts |
| `in-settlement-search`-Test | Gottheit steht in `search_texts`; der Stadtname weiterhin **nicht** |
| Anzeige-Test (JS) | `Rahja` + `Tempel` → „Rahja-Tempel"; fehlt eins, bleibt die heutige Zeile |

💣 Vor dem Push läuft das **ganze** Testfeld, nicht nur diese — mit
`mbstring`/`pdo_sqlite`/`gd`, sonst melden 45 fremde Tests rot (AGENTS.md §9).

## 8. Reihenfolge

Phase 1 geht **allein** live und wird angesehen, bevor Phase 2 beginnt (AGENTS.md §9:
sichtbare Änderungen einzeln). Phase 1 ist für sich vollständig — 198 Stätten in der
Suche —, und sie trägt kein Stück von Phase 2 vor sich her.
