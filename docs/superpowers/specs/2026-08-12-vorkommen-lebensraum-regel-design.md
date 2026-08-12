# Die Lebensraum-Regel im Vorkommen-Editor

> Entwurf, 12.08.2026 (Fassung 2, nach dem Regeleditor-Mockup). Nichts davon ist gebaut.
> Mockups: **`docs/vorkommen-regeleditor-mockup.html`** (der Editor) und
> `docs/vorkommen-klimazonen-mockup.html` (Einordnung, Schnittmenge, Zahlen) — beide
> rechnen mit echtem Bestand.
> Vorgänger, auf die sich alles stützt: `docs/flora-fauna-handelswaren-design.md`,
> `docs/superpowers/specs/2026-08-03-klimazonen-design.md`,
> `docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md`.

## 1. Warum

Die **Vierblättrige Einbeere** führt live genau einen Ort — „Der Große Fluss" — und
im Freitextfeld `lebensraum` den Satz „ganz Aventurien nördlich des Yaquir". Beides
zusammen sagt: sie wächst im Wald der nördlichen Hälfte. Nur kann das heute niemand
eintragen. Wer es trotzdem will, muss fünfzig Wälder von Hand aufzählen und die
Liste bei jeder neu gezeichneten Fläche nachpflegen.

Die Regel schließt genau diese Lücke: **eine Beschreibung statt einer Aufzählung.**

Sie ist der maschinenlesbare Zwilling des Feldes `lebensraum`. Das Wiki-Feld
`Vorkommen` wird bewusst **nicht** als Ortsangabe gelesen (`AVESMAPS_LORE_PLACE_FIELDS`
in `api/_internal/wiki/lore-parsing.php`) — es nennt Landschaftstypen, keine Orte.
Der Freitext bleibt daneben stehen: er ist die Quelle, die Regel die Auslegung.

## 2. Die Entscheidungen (Owner, 12.08.2026)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Wo steht die Regel? | In **derselben Liste** wie die Orte, als zweiter Eintragstyp |
| 2 | Was trifft eine Regel? | Flächen **und Siedlungen** darin |
| 3 | Flächen in mehreren Klimazonen? | Die **Schnittmenge** zählt und wird in der Suche hervorgehoben |
| 4 | Woher kommt die Zugehörigkeit? | Aus `ecosystem_region_overlap`, also aus „Zugehörigkeit rechnen" |
| 5 | Veraltete Berechnung? | Der Editor **zeigt an, wann zuletzt gerechnet wurde** |
| 6 | Aufbau einer Regel | Eine **Kette von Bedingungen** mit wählbarem **UND / ODER** dazwischen |
| 7 | Felder je Bedingung | Flächenname · Landschaftsart · Klimazone — als **Suchfelder, nicht als Auswahlraster** |
| 8 | Was heißt UND zwischen Bedingungen? | Es wird auf der **Ergebnismenge** ausgewertet, nicht auf der einzelnen Fläche |

Entscheidung 2 kehrt einen früheren Vorschlag um („Regeln treffen nur Flächen").
Sie ist **kein** Widerspruch zur Sammelrichtung „Information steigt auf, sie fällt
nicht herab" (Owner 21.07.2026): die galt der **Hierarchie** — „Taschendrachen gibt
es in Almada" macht Punin nicht zum Drachenort. Hier zählt die **Geometrie**: die
Stadt steht tatsächlich in diesem Wald.

## 3. Die Regel

Eine Regel ist eine **Kette**:

```
Bedingung 1        Flächenname: —            Landschaftsart: Wald      Klima: Boreal … Gemäßigt
   UND
Bedingung 2        Flächenname: —            Landschaftsart: Gebirge   Klima: —
```

- **Innerhalb** einer Bedingung gilt immer UND: die drei Felder sind drei verschiedene
  Fragen an dasselbe Ding („heißt so" · „ist von dieser Art" · „liegt in dieser Zone").
  Ein leeres Feld schränkt nicht ein.
- **Mehrere Arten in einer Bedingung** sind ein ODER — eine Fläche hat immer nur eine.
- **Zwischen** Bedingungen entscheidet der Editor: UND oder ODER.
- Ausgewertet wird **strikt von links nach rechts, ohne Klammern.** Verschachtelung wäre
  eine Abfragesprache; wer sie braucht, legt eine zweite Regel an (Regeln untereinander
  sind ohnehin ein ODER). YAGNI, und es hält den Satz lesbar.

Der Editor schreibt die Kette als Satz aus — das ist die Abnahme der Regel:

> Die Regel liest sich: etwas, das **Wald** ist und im Klima zwischen **Boreale Zone**
> und **Gemäßigte Zone** liegt **und** **Gebirge** ist.

### 3.1 💣 UND wird auf der ERGEBNISMENGE ausgewertet, nicht auf der Fläche

Eine `ecosystem_region` hat genau **ein** `kind` und **einen** `region_type`. Keine
Fläche ist Wald *und* Gebirge. Ein **Ort** dagegen kann in beiden liegen.

Gemessen am Live-Bestand für „Wald (boreal…gemäßigt) UND Gebirge":

| | Flächen | Siedlungen |
|---|---:|---:|
| Bedingung 1 | 50 | 68 |
| Bedingung 2 | 58 | 267 |
| **UND** | **0** | **22** |
| ODER | 108 | 313 |

Die 0 ist **kein Fehler und wird nicht wegdefiniert.** Der Editor zeigt beide Zahlen
nebeneinander, damit man sieht, was man gebaut hat.

Die verworfene Alternative: UND als **Überschneidung zweier Flächen** deuten
(`ecosystem_region_overlap` wüsste es). Sie liefert namenlose Schnittstücke — „der Teil
des Farindel im Finsterkamm" hat keinen Namen, den eine Infobox nennen könnte. Später
additiv nachrüstbar, falls je gebraucht.

### 3.2 💣 Die Klimaspanne wird als ENDPUNKTE gespeichert, nie als Menge

`climate_from` und `climate_to` halten die zwei Zonenschlüssel; die Menge dazwischen
wird beim Lesen über `ecosystem_region_type.sort_order` aufgelöst.

Der Grund steht in der eigenen Geschichte: am 03.08.2026 wurde `trockene_subtropen`
mit `sort_order 55` nachträglich **zwischen** zwei bestehende Zonen eingeschoben. Eine
als Menge gespeicherte Spanne hätte die neue Zone nicht enthalten — still, ohne
Fehlermeldung, in jeder betroffenen Regel. Als Endpunkte wächst die Spanne mit.

Eine Spanne **mit Lücke** ist damit nicht darstellbar. Sie muss es auch nicht sein:
zwei Bedingungen mit ODER sind die Lücke.

### 3.3 💣 Fläche „berührt", Siedlung „liegt drin" — zwei verschiedene Prüfungen

- Eine **Fläche** zählt, sobald sie die Zone berührt. Die Aussage ist „hier wächst es",
  nicht „hier wächst es überall". Schwelle wie in der Zeile „Klimazone":
  `AVESMAPS_CLIMATE_REGION_MIN_SHARE` (5 %).
- Eine **Siedlung** zählt nur, wenn sie **selbst** in der Zone liegt. Sie ist ein Punkt;
  „teilweise" gibt es dort nicht.

Der Unterschied ist nicht theoretisch. Gemessen 12.08.2026:

| Regel | Flächen | Siedlungen **in** den Flächen | Siedlungen **in der Zone** |
|---|---:|---:|---:|
| Gebirge + Boreale Zone | 20 | 125 | **37** |
| Wald + boreal…gemäßigt | 50 | 70 | **68** |

Der Finsterkamm allein trägt 44 Siedlungen, **4** davon in der Borealen Zone.

### 3.4 💣 Identität ist die `public_id`, NIE der Name

Fünf Flächennamen kommen live doppelt vor, vier davon über Ebenen hinweg:

| Name | ist zugleich |
|---|---|
| Nördlicher Eisenwald | `topographie/gebirge` **und** `vegetation/wald` |
| Gorische Wüste | `topographie/gebirge` und `vegetation/wueste` |
| Gratenfelser Becken | `derographisch/region` und `topographie/tiefebene` |
| Grillenbusch | `topographie/huegelland` und `vegetation/graslandschaft` |
| Grauer Wald | zweimal `vegetation/wald` |

Wer Mengen über den Namen bildet, bekommt für „Wald UND Gebirge" einen Treffer, den es
nicht gibt — genau das tat die erste Mockup-Fassung. Deshalb: **das Feld „Flächenname"
speichert eine gewählte `public_id`, nie den getippten Text.**

⚠️ Das betrifft nicht nur die Regel. `lore_place` ordnet Orte bis heute **über den
Namen** zu (so fand die Einbeere „Der Große Fluss": erst `wk:`, dann `nm:`, dann
`nm:` ohne Klammerzusatz — `resolveSpotlightLorePlace` in `js/ui/spotlight-search.js`).
Bei diesen fünf greift die Zuordnung ins Ungefähre. Kein Auftrag dieses Entwurfs, aber
notiert — siehe §11.

## 4. Datenmodell

### 4.1 Drei neue Tabellen

```sql
CREATE TABLE IF NOT EXISTS lore_rule (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    entry_wiki_key  VARCHAR(190) NOT NULL,
    relation        VARCHAR(20) NOT NULL DEFAULT 'verbreitung',
    origin          VARCHAR(16) NOT NULL DEFAULT 'manual',
    status          VARCHAR(16) NOT NULL DEFAULT 'active',
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by      BIGINT UNSIGNED NULL,
    KEY idx_lore_rule_entry (entry_wiki_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lore_rule_term (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rule_id         BIGINT UNSIGNED NOT NULL,
    seq             INT NOT NULL,                  -- 0, 1, 2 … Auswertung von links nach rechts
    join_op         VARCHAR(4) NOT NULL DEFAULT 'und',  -- gilt der Verknüpfung ZUM VORGÄNGER; bei seq = 0 bedeutungslos
    area_public_id  CHAR(36) NULL,                 -- eine bestimmte Fläche; NULL = alle
    climate_from    VARCHAR(60) NULL,              -- NULL = keine Klimaeinschränkung
    climate_to      VARCHAR(60) NULL,
    UNIQUE KEY uq_lore_rule_term (rule_id, seq),
    KEY idx_lore_rule_term_area (area_public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lore_rule_term_type (
    term_id     BIGINT UNSIGNED NOT NULL,
    kind        VARCHAR(20) NOT NULL,              -- derographisch|vegetation|topographie
    region_type VARCHAR(60) NOT NULL,
    PRIMARY KEY (term_id, kind, region_type),
    KEY idx_lore_rule_term_type_lookup (kind, region_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

⚠️ Kollation **explizit** `utf8mb4_unicode_ci` wie `lore_entry` und `lore_place` —
`feature_sources` trägt die Default-Kollation, und ein Spaltenvergleich darüber hinweg
wirft „Illegal mix of collations" (der Fall, den `avesmapsLoreReadCatalog` mit einem
`COLLATE` im Teilquery umgeht).

⚠️ `join_op` gehört der Bedingung, nicht der Regel: eine Kette kann `A und B oder C`
sein. Bei `seq = 0` ist der Wert bedeutungslos und wird beim Lesen ignoriert — er wird
nicht auf NULL gezwungen, weil ein NOT-NULL-Feld mit Vorgabewert weniger Sonderfälle
im Schreibpfad hat als eine Spalte, die manchmal NULL sein muss.

### 4.2 Warum eigene Tabellen und nicht `lore_place`

AGENTS.md §5 warnt zu Recht vor der zweiten Tabelle („wenn du gleich
`CREATE TABLE <feature>_source` schreibst, halt an"). Die Warnung greift hier **nicht**,
und der Unterschied ist benennbar:

> `lore_place` speichert eine **Antwort** — *dieser* Ort.
> `lore_rule` speichert eine **Frage** — *welche* Orte.

Zwei Konsequenzen, die die Trennung erzwingen:

1. Eine Regel hat **keinen** `place_wiki_key`. Der UNIQUE-Schlüssel von `lore_place` ist
   `(entry_wiki_key, place_wiki_key, relation)`; ein synthetischer Schlüssel wie
   `rule:wald+boreal..gemaessigt` müsste auf dem heißen Lesepfad **geparst** werden —
   Struktur in einem String, genau die Falle, die man einmal baut und dreimal repariert.
   Mit einer Kette aus mehreren Bedingungen wäre der String vollends eine Sprache.
2. Der Lesepfad ist ein anderer. `lore_place` wird über `place_wiki_key IN (…)` gelesen;
   eine Regel wird über Art, Zone und Identität **gejoint**. In einer Tabelle müsste die
   heißeste Abfrage des Hauses nach Zeilenform verzweigen.

Was sie sich **teilen**, teilen sie: `relation`, `origin`, `status`, `sort_order` tragen
dieselben Vokabeln, und beide erscheinen in derselben Liste und derselben Infobox-Zeile.

### 4.3 💣 Eine Regel ist IMMER `origin='manual'`

Das Wiki liefert keine Regeln. Wichtiger: `avesmapsLoreReconcile` legt Ortszeilen per
delete+insert neu an und fasst dabei ausschließlich `origin='wiki'` an. Eine Regel mit
`origin='wiki'` wäre bei jedem „Vorkommen syncen" weg. Der Sync bekommt `lore_rule`
gar nicht erst zu sehen — er kennt die Tabellen nicht.

### 4.4 Siedlung → Fläche: `location_ecosystem`

Für Entscheidung 2 fehlt eine Zuordnung, die es noch nicht gibt: **welche Flächen
enthalten diese Siedlung?**

Vorbild ist `path_ecosystem` (Weg → Fläche), gefüllt vom selben Lauf:

```sql
CREATE TABLE IF NOT EXISTS location_ecosystem (
    location_id BIGINT UNSIGNED NOT NULL,
    area_id     BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (location_id, area_id),
    KEY idx_location_ecosystem_area (area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Gefüllt wird sie in „Zugehörigkeit rechnen", als vierte Zeilenart neben `overlap`,
`territory` und den Wegzeilen (`avesmapsPathEcosystemStore`,
`api/_internal/app/path-ecosystem.php`). Der Lauf **ersetzt**, er ergänzt nie —
`avesmapsPathEcosystemBegin` leert die Tabellen und `…Commit` zählt per `COUNT(*)` nach,
was tatsächlich landete. `location_ecosystem` reiht sich in beides ein.

Größenordnung: 2.782 Siedlungen (ohne Kreuzungen), 4.252 Zuordnungen gemessen — kleiner
als `path_ecosystem`.

Die **Klimazone** der Siedlung wird hier **nicht** mitgespeichert. Sie steht schon im
Payload (`avesmapsClimateApplyToFeatures` stempelt jeden Ort mit genau einer Zone) —
eine zweite Ablage wäre eine zweite Wahrheit.

## 5. Lesepfad

`avesmapsLoreReadForPlaces` bleibt, wie es ist, und bekommt einen Zwilling für Regeln.
Die Vereinigung geschieht **nach** beiden Abfragen, in `byKind` — dort, wo schon heute
derselbe Eintrag über mehrere Orte hereinkommen kann.

Ein Regeltreffer bekommt `rank` **1** — dieselbe Sprosse wie ein Untergebiet, und das
mit Absicht: spezifischer als kontinentweit (3), aber nie vor einem Ort, den jemand
ausdrücklich genannt hat (0). Wer „Der Große Fluss" einträgt, meint mehr als „irgendein
Wald". Rang 2 bleibt frei — er trug einmal die Obergebiete und ist bewusst entfallen;
ihn neu zu belegen hieße, dieselbe Zahl zweimal zu erklären.

Die `relation` einer Regel wird wie bei einem Ort gewählt und hat dieselben Werte. Bei
Flora, Fauna und Spezies ist das immer `verbreitung`; nur bei **Waren** ist die Wahl
echt (`herkunft` = „stammt von dort" gegen `verbreitung` = „wird dort gehandelt"). Der
Editor zeigt sie deshalb nur bei `kind = 'ware'`.

Die Frage, die der Lesepfad beantwortet, ist die **umgekehrte** zur Editor-Vorschau:
nicht „welche Flächen trifft diese Regel", sondern „welche Regeln treffen dieses
Objekt". Beides ist derselbe Join, nur von der anderen Seite:

```
Landschaftsfläche  ->  ihr kind/region_type + ihre public_id + ihre Zonen aus ecosystem_region_overlap
Siedlung           ->  ihre Flächen aus location_ecosystem + ihre eigene Zone
Weg / Etappe       ->  ihre Flächen aus path_ecosystem + deren Zonen
Herrschaftsgebiet  ->  seine Flächen aus ecosystem_region_territory
```

Eine Kette wird dabei **je Bedingung** ausgewertet und links nach rechts verknüpft —
dieselbe Reihenfolge wie im Editor, sonst zeigt die Vorschau etwas anderes als die
Infobox.

⚠️ **Keine Geometrie im Lesepfad.** Alle vier Fragen sind Joins über bereits gerechnete
Zeilen. Ein Punkt-in-Polygon zur Lesezeit wäre auf STRATO genau die Last, die
AGENTS.md §10 dem Vorfall vom 17.07.2026 zuschreibt.

### 5.1 💣 Während eines Laufs ist `ecosystem_region_overlap` LEER

`avesmapsPathEcosystemBegin` beginnt mit `DELETE FROM ecosystem_region_overlap`. Solange
der Lauf läuft, beantwortet jede Regel „keine Treffer" — und das sieht in einer Infobox
exakt so aus wie „hier wächst nichts".

Deshalb liest der Regelpfad `ecosystem_assignment_stamp.completed` mit: ist es `0`,
liefert er **gar keinen** Regelabschnitt, statt einen leeren. Nichts zu sagen ist
richtig; das Gegenteil zu behaupten nicht.

## 6. Editor

Die Ortsspalte (`lore-detail__col--places`) bekommt einen zweiten Knopf **„+ Regel"**
neben „+ Ort" und die Regel als gleichrangige Karte in derselben Liste
(`lore-detail__place`) — kein eigener Abschnitt, kein eigener Kasten. Sie zeigt
zugeklappt ihren Satz und die Trefferzahl, aufgeklappt den Regeleditor.

### 6.1 Der Regeleditor

Mockup: **`docs/vorkommen-regeleditor-mockup.html`**. Aufbau:

- **Die Bedingungen untereinander**, dazwischen ein anklickbarer UND/ODER-Wähler auf
  einer Trennlinie — er ist eine Entscheidung, kein Etikett. Darunter „+ Bedingung".
- Je Bedingung drei Felder und eine eigene Trefferzahl im Kopf.
- Rechts daneben **der Rechenweg**: eine Zeile je Bedingung, der Operator dazwischen,
  darunter das Ergebnis — plus die Namen der getroffenen Flächen und Siedlungen.
- Unter allem **der Satz**, den die Kette ergibt.

### 6.2 💣 Suchfelder, kein Auswahlraster

Die erste Fassung zeigte alle 26 Landschaftsarten als Kacheln, nach Ebene gruppiert.
Das war eine Wand, durch die man liest, statt einer Frage, die man beantwortet — und je
Bedingung wiederholte sie sich. Stattdessen:

- **Flächenname** und **Landschaftsart** sind Suchfelder mit Vorschlagsliste.
- Der **Ebenenname ist mitdurchsuchbar**: „topo" wirft die zwölf topographischen Arten
  aus, ohne dass man ihre Namen kennt. Das ist der Ersatz für die Gruppenüberschriften.
- Jeder Vorschlag zeigt **Ebene und Flächenzahl** („Gebirge · Topographie · 58") — man
  weiß vor dem Klick, was man auslöst.
- **Gewähltes wird zur Marke** unter dem Feld, einzeln wegklickbar, und fällt aus den
  Vorschlägen.
- ⚠️ Die **Klimazone bleibt sichtbar** als Streifen der acht Zonen. Sie ist eine Spanne,
  und eine Spanne braucht ihre Nachbarn: aus einer Vorschlagsliste gewählt, wählt man
  über ein Loch, das man nicht sieht.
- Im Bau übernimmt das die vorhandene **jQuery-UI-Autocomplete** (⚠️ siehe die bekannten
  Fallen: gemischte Einträge, und eine Combobox, die einem Dialog den Fokus klaut).

💣 **Zwei Faltungen im Suchschlüssel, nicht eine.** NFD-Strippen macht aus „Wüste" ein
`wuste`, getippt wird aber `wueste`. Beide Seiten laufen zusätzlich durch
`ue/oe/ae -> u/o/a`. Mit nur NFD findet „wueste" die Wüste **nicht** — im Mockup
gemessen, nicht vermutet.

💣 **Ohne eine einzige Einschränkung trifft die Regel alles.** Das ist keine Regel,
sondern ein Versehen — der Speichern-Knopf bleibt aus, und der Riegel steht
**serverseitig**, nicht nur am ausgegrauten Knopf (dieselbe Lehre wie beim Löschriegel
der Übernahme-Vorschau).

⚠️ Auto-benannte Flächen („Wald-001", „Fläche-026") treffen die Regel mit, und in einer
Infobox stünde dann dieser Name. Kein Riegel — sie sind echte Flächen —, aber in der
Trefferliste kursiv, damit man es vor dem Speichern sieht.

### 6.3 „Zuletzt gerechnet" (Entscheidung 5)

Es braucht **keine neue Ablage**: `ecosystem_assignment_stamp` (id = 1) hält bereits
`computed_at`, `computed_by`, `completed`, `overlap_rows` **und** — der eigentliche
Gewinn — `ecosystem_revision` und `map_revision` des Laufs.

Damit sagt der Editor nicht nur *wann*, sondern *ob es noch stimmt*:

```
Stand: 12.08.2026 19:04 · aktuell
Stand: 09.08.2026 22:31 · veraltet, seit 37 Änderungen an den Flächen
Wird gerade gerechnet …
```

Angezeigt an zwei Stellen: am Knopf „Zugehörigkeit rechnen" im Landschaften-Editor
(dort gehört er hin) und klein an der Trefferzahl der Regel (dort fällt er auf).

💣 **Gelesen wird der Stempel mit einem nackten `SELECT`**, nie über
`avesmapsEcosystemEnsureTables`. Dessen `information_schema`-Sonden sind genau die Last,
die `path-ecosystem.php` sich im Kommentarkopf ausdrücklich verbietet (Vorfall
17.07.2026). Fehlt die Tabelle, ist die Antwort „nie gerechnet" — kein 500.

⚠️ Und der Stempel gilt dem **ganzen** Lauf, nicht den Regeln: er steht schon richtig,
bevor es die erste Regel gibt. Hier wird nichts gestempelt, nur gelesen.

## 7. Suche und Hervorhebung

`api/_internal/app/lore-search.php` liefert heute je Eintrag `lore_places` (Titel +
Schlüssel, **unaufgelöst**) und lässt den Client zuordnen. Regeln reihen sich ein: der
Server löst sie über die gerechneten Zeilen zu Flächen auf und schickt sie im selben
Feld. Der Client merkt keinen Unterschied — er hat nie gewusst, woher ein Ort kam.

⚠️ Der Suchpfad ist tastendruck-getaktet und **DDL-frei** (der Kommentarkopf der Datei
begründet das ausführlich). Die Regelauflösung ist ein Join über kleine Tabellen und
777 Flächen; sie darf **keine** `CREATE TABLE IF NOT EXISTS` auslösen.

Die **Hervorhebung** ist die Schnittmenge, nicht die ganze Fläche:
`focusSpotlightLorePlaces` zeichnet bereits Landschaftsflächen
(`upgradeSpotlightLoreHighlightToAreas`). Für einen Regeltreffer wird die Fläche vorher
gegen das Klimaband verschnitten — `polygon-clipping` liegt unter `js/third-party/`.
Beim Finsterkamm ist das der Unterschied zwischen dem ganzen Gebirge und seinem Nordteil.

💣 **y wächst nach NORDEN** (gemessen: polar y 883–1024, tropisch y 0–480), während SVG-
und Bildschirm-y nach unten wachsen. Wer die Verschneidung zeichnet, ohne zu spiegeln,
setzt die Boreale Zone ans Südende. Beim Bau des Mockups genau einmal passiert. Siehe
auch AGENTS.md §5 zur Koordinatenkonvention.

## 8. Zahlen (gemessen 12.08.2026)

Grundlage: je ein Abruf von `/api/app/ecosystem-areas.php` und `/api/locations/`. Die
Klimazuordnung ist per Punktraster genähert; scharf käme sie aus
`ecosystem_region_overlap`.

- **777** Landschaftsflächen mit Art (631 topographie, 131 vegetation, 15 derographisch)
- **58** davon liegen in mehr als einer Klimazone — für die entscheidet §3.3
- **80** Wald-Flächen; „Wald + boreal…gemäßigt" trifft **50**
- Heraus fallen die südlichen: Alkrawald, Alter Wald, Arinkelwald, Bärenforst,
  Byriaforst, Dillwischwald … alle winterfeuchte Subtropen
- **2.782** Siedlungen (ohne Kreuzungen), **4.252** Siedlung-Fläche-Zuordnungen
- Die Beispielregel trifft **68** Siedlungen — 2 der 70 in den Flächen fallen durch die
  Zonenprüfung heraus
- **5** Flächennamen kommen doppelt vor (§3.4)

## 9. Tests

Alle Kernfunktionen sind **rein** (Zeilen rein, Ergebnis raus) und ohne Datenbank
prüfbar — dasselbe Muster wie `avesmapsBuildLoreSearchEntries`.

| Test | Was beißen muss |
|---|---|
| `climate-range-test` | Spanne aus zwei Endpunkten → Zonenmenge. **Mutation:** eine Zone mit `sort_order 55` einschieben; der Test schlägt fehl, wenn sie nicht in `30…40` landet |
| `lore-rule-match-test` | Fläche passt bei Art **und** berührter Zone; passt **nicht** bei richtiger Art in falscher Zone |
| `lore-rule-chain-test` | `A und B oder C` von links nach rechts; **und** der Beweis, dass UND über zwei Arten 0 Flächen, aber die Schnittmenge der Orte liefert |
| `lore-rule-identity-test` | Zwei Flächen gleichen Namens, verschiedene Ebene → das UND liefert **0**, nicht 1. Der Fall „Nördlicher Eisenwald" |
| `lore-rule-place-test` | Siedlung in passender Fläche, aber **außerhalb** der Zone → kein Treffer. Der Finsterkamm-Fall, 4 statt 44 |
| `lore-rule-empty-test` | Regel ohne jede Einschränkung → abgelehnt, serverseitig |
| `lore-rule-stamp-test` | `completed = 0` → **kein** Regelabschnitt, nicht ein leerer |
| `lore-rule-searchkey-test` | „wueste" findet „Wüste"; „wüste" auch |

⚠️ Vor dem Push läuft das **ganze** Testfeld, nicht nur diese acht (AGENTS.md §9).

## 10. Was NICHT dazugehört

- **Klammern / Verschachtelung** in der Kette (§3).
- **UND als Flächen-Überschneidung** („der Teil des Farindel im Finsterkamm") — §3.1.
- **Spannen mit Lücke** — zwei Bedingungen mit ODER sind die Lücke (§3.2).
- **Regeln aus dem Wiki** — das Feld `Vorkommen` bleibt Freitext. Eine Ableitung („Wald"
  im Text → Regel) wäre Raterei mit dem Anschein von Daten.
- **Reise-Wirkung** — eine Regel sagt, wo etwas vorkommt, nicht wie man dort reist.

## 11. Offene Punkte

- 🔧 **Namensbasierte Ortszuordnung in `lore_place`** (§3.4). Betrifft fünf bekannte
  Fälle und ist älter als dieser Entwurf. Eigenes Thema.
- 🔧 Sollen Regeln in der **Vorkommen-Liste** filterbar sein („nur mit Regel")? Der
  Trichter kann es (`docs/superpowers/specs/2026-07-25-vorkommen-filter-design.md`), die
  Facette wäre eine Zeile. Erst sinnvoll, wenn es Regeln gibt.
- 🔧 Auto-benannte Flächen in Infoboxen (§6.2) — eigenes Thema, betrifft nicht nur Regeln.
- 🔧 Ob `location_ecosystem` auch **Kreuzungen** aufnimmt. Vorschlag: nein, sie sind keine
  Orte.
