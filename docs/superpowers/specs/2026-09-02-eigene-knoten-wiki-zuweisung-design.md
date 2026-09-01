# Einem eigenen Knoten nachträglich einen Wiki-Artikel zuweisen

**Stand:** 02.09.2026 · **Betrifft:** Herrschaftsgebiete, Sync-Monitor (`html/wiki-sync-monitor.html`)
**Anlass:** Owner — „derzeit ist es nicht möglich offizielle oder inoffizielle wiki-einträge
nachträglich auf eigene knoten von territorien anzuwenden. beispiel:
`https://de.wiki-aventurica.de/wiki/Inoffiziell:Táyârret`. wir wollen das jetzt erlauben. die keys
müssten im dump sein. die frage ist ob du es sogar schaffst die key korrekt umzubenennen, die daten
nachzuziehen, und alle abhängigkeiten aufzulösen"

---

## 1 · Der Befund — die Pipeline kann es schon, die Zuweisung fehlt

**Der Artikel ist kein Sonderfall.** `Inoffiziell:Táyârret` trägt `{{Infobox Staat}}` (abgerufen
02.09.2026), und `avesmapsWikiDumpClassifyEntityKind` entscheidet über `str_contains($key, 'staat')`
→ `AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY` (`dump-entity-scan.php:208`). Seit dem 01.09.2026
(`30ee4851d`) steht **ns 222 in `AVESMAPS_WIKI_ENTITY_NAMESPACES`**, der Riegel in
`avesmapsWikiDumpClassifyPage` (`dump-entity-scan.php:269`) lässt die Seite also durch. Sie trägt
echte Daten:

| Infobox-Feld | Wert |
|---|---|
| `Name` | Táyârret |
| `Art` | `[[Inoffiziell:Tá'akîb\|Tá'akîb]]` |
| `Hauptstadt` | `[[Inoffiziell:Djáset\|Djáset]]` |
| `Oberhaupt` | Hékatet ni Chentasû |
| `Einwohnerzahl` | 400 |
| `Staat` | `[[Inoffiziell:Káhet Ni Kemi\|Káhet Ni Kemi]]` |

**Der Schlüssel steht fest und ist gemessen, nicht geraten.** `avesmapsPoliticalSlug()` auf den
**vollen Titel** ergibt `wiki:inoffiziell-t-y-rret` (lokal ausgeführt). Das ist derselbe Weg, den die
ns-222-Öffnung gestern schon für die Siedlungen genommen hat (`settlements.php:749`,
`avesmapsPoliticalSlug($title)`) — der Namensraum bleibt im Schlüssel. Hier wird **keine zweite
Schlüsselregel erfunden**; AGENTS.md §5 nennt genau das als Datenmigration über ~10 Tabellen.

**Was fehlt, ist eine Operation, die den `wiki_key` eines Modellknotens ändert.** Es gibt
`create_custom_node` und `delete_custom_node`; letzteres verweigert sich, sobald der Knoten live ist
(`sync-monitor-model.php:828`). Eine Umbenennung gibt es nirgends — `git grep` über
`api/_internal/wiki` findet kein einziges `UPDATE … SET wiki_key`.

**Und der eine vorhandene Artikel-Zuweiser hilft hier nicht.** `review-region-wiki-picker.js`
(Kartendialog „Herrschaftsgebiet bearbeiten") schreibt `political_territory.wiki_id`, woraus der
Server `wiki_key` ableitet. Er fasst die **Live-Zeile** an und lässt `wiki_territory_model` auf dem
alten Schlüssel stehen — Modell und Live liefen danach auseinander.

> 🔴 **Warum der Monitor bisher ausgenommen war.** `js/ui/wiki-assign-territorium.js` hält seit dem
> 16.08.2026 ausdrücklich fest: „Am 16.08.2026 nachgemessen: DORT WIRD NICHTS ZUGEWIESEN. Der
> `wiki_key` IST die Identität eines Monitor-Knotens; es gibt keinen Artikel-Picker." Genau diese
> Aussage kehrt dieser Entwurf um — und deshalb ist die Zuweisung hier **kein Setzen einer
> Referenz, sondern ein Identitätswechsel.**

---

## 2 · Die Owner-Entscheide (02.09.2026)

**(a) Der Wiki-Knoten gewinnt, die eigene Zeile wandert in den Papierkorb.**
Zweimal so entschieden, das zweite Mal nach ausgeschriebener Gegenrechnung. Die Alternative wäre
gewesen, die vorhandene Zeile umzuschlüsseln und ihre `public_id` zu behalten. Der Preis der
getroffenen Wahl steht in §4 und §5: die `public_id` wechselt, also müssen **sechs** Ziele in
derselben Transaktion mitwandern.

**(b) Übernahme-Vorschau je Feld.** Kein pauschales „Wiki gewinnt" und kein pauschales „Handarbeit
bleibt". Die Vorbelegung steht in §3.

**(c) Einzeln UND Sammellauf.** Erst der einzelne Knoten mit Owner-Blick, dann der Lauf über die
Namensgleichen (§6).

---

## 3 · Die Oberfläche

Im **rechten Panel** des Monitors („Wiki-Daten und Eigene Overrides"), sichtbar **nur** an einem
Knoten mit `eigener-knoten:`-Schlüssel: ein Kasten **„Wiki-Artikel zuweisen"**.

**Schritt 1 — Suchen.** Über `political_territory_wiki_test` (Staging des letzten Dump-Laufs) und
`political_territory_wiki` (der gepflegte Spiegel). Je Treffer: Titel · **Kanon-Etikett** · Art ·
Zeitraum · Schlüssel.

> ⭐ Das Kanon-Etikett gibt es seit dem 01.09.2026 (`30ee4851d`, `avesmapsWikiNamespaceIsOfficial`).
> Es ist hier tragend, nicht Zierrat: die Trefferliste mischt Kanon und Fanmaterial, und ein Editor
> muss vor dem Klick sehen, was er sich einhandelt. **Kein eigenes Etikett bauen** — die Funktion
> liefert `?bool`, und `null` heißt „die Frage stellt sich nicht".

**Schritt 2 — Übernahme-Vorschau.** Drei Spalten (Feld · dein Wert · Wiki-Wert) mit Häkchen.
Vorbelegung nach einer Regel, nicht nach Gefühl:

| Lage | Häkchen | Wirkung |
|---|---|---|
| Werte **gleich** | **an** | Der Override fällt still weg; das Feld ist künftig Wiki-gepflegt. *(Táyârret: Hauptstadt „Djáset")* |
| Werte **abweichend** | **aus** | Bleibt „von uns", ankreuzbar. *(Status „Tă'akîb (Baronie)" gegen leeres Wiki-Status)* |
| Bei uns **leer** | **an** | Füllt eine Lücke. *(Oberhaupt, Einwohnerzahl 400)* |

Das ist die Hausregel des Wiki-Overrides vom 17.08.2026, angewandt auf den Sonderfall „bei einem
eigenen Knoten ist **jedes** Feld ein Override". Ohne die erste Zeile käme aus dem Wiki nie etwas an.

Darunter die **Folgenliste im Klartext** — nicht als Zahl, sondern benannt: wie viele Geometrien,
Quellen, Kinder, Ansprüche und Meldungen mitwandern, und dass die alte Zeile in den Papierkorb geht.

**Schritt 3 — Übernehmen.** Eine Transaktion (§4).

> 💣 **Die Rechen-Hälfte schreibt in KEINE Nutztabelle.** Dieselbe Zweiteilung wie bei jedem
> Sync im Haus, festgenagelt nach dem Muster von `sync-plan-purity-test.php`. Eine Vorschau, die
> nebenbei schreibt, ist keine Vorschau.

---

## 4 · Die Wanderung — der Kern

Ziel ist die Territoriumszeile mit `wiki_key = 'wiki:inoffiziell-t-y-rret'`.

> 🔴 **Im Normalfall gibt es sie noch nicht, und das ist kein Sonderfall, sondern die Regel.**
> `avesmapsWikiDumpPersistTerritoryRecords` (`dump-entity-scan.php:1652`) schreibt ausschließlich
> `political_territory_wiki_test` und `wiki_redirect_alias` — **niemals** `wiki_territory_model`,
> `political_territory` oder Geometrie. Ein Dump-Lauf legt also einen Staging-Datensatz an und sonst
> nichts. Die Zielzeile wird deshalb bei Bedarf **angelegt**, aus dem Staging plus den angehakten
> Feldern. Beide Fälle — Ziel existiert / Ziel existiert nicht — laufen durch denselben Code; ein
> zweiter Pfad wäre die Divergenz, die dieser Entwurf gerade beseitigt.

### 4.1 · Die sechs Ziele der `territory_id` / `public_id`

Vollständig gezählt gegen `sql/schema.sql` und `sql/political-territories.sql` — es sind **genau
diese**, und eines hat **zwei Spalten**:

| # | Tabelle | Spalte(n) |
|---|---|---|
| 1 | `political_territory_geometry` | `territory_id` |
| 2 | `political_territory_derived_geometry` | `territory_id` |
| 3 | `political_territory_claim` | `territory_id` **und** `claimant_territory_id` |
| 4 | `political_territory` | `parent_id` **aller Kinder** |
| 5 | `feature_sources` | `entity_public_id` bei `entity_type = 'territory'` |
| 6 | `map_reports` | `entity_public_id` bei `entity_type = 'territory'` |

> ⚠️ `map_reports.entity_public_id` steht **nicht** in `sql/schema.sql` — die Spalte wird zur
> Laufzeit nachgezogen (`api/edit/reports/locations.php:538`,
> `'entity_public_id' => 'VARCHAR(80) NULL AFTER entity_type'`). Wer die Schemadatei als Inventar
> liest, übersieht sie.

**Unberührt bleiben** `political_territory_identity_backup` (ein Sicherungsstand des alten Knotens;
er bleibt auf der Papierkorb-Zeile gültig) und alles, was über `wiki_key` statt über die id geht —
das erledigt 4.2.

### 4.2 · Die Schlüsselwanderung

| Tabelle | Spalte | Von → Nach |
|---|---|---|
| `wiki_territory_model` | `parent_wiki_key` der **Kinder** | `eigener-knoten:knotenNNN` → `wiki:…` |
| `wiki_territory_model` | die Zeile des eigenen Knotens | gelöscht, nachdem `parent_locked` vererbt ist |
| `political_territory_claim` | `claimant_wiki_key` | alt → neu |
| `sync_decision` | `entity_key` | alt → neu |
| `sync_plan_item` | `entity_key` | alt → neu |
| `map_features.properties_json` | `territory_wiki_key` der Siedlungen | alt → neu |
| `wiki_redirect_alias` | neuer Eintrag | alter Slug → neuer kanonischer Schlüssel |

> 💣 **`properties.territory_wiki_key` ist der stille.** Er entsteht per Ray-Cast im
> Siedlungseditor und wird von der **Literatur-Aggregation** (`game-literature-resolve.php:322`) und
> der **Kartennutzlast** (`map-features.php:1097`) gelesen. Ein veralteter Schlüssel dort wirft
> keinen Fehler — die Zuordnung fällt einfach weg. Genau die Fehlerklasse, die AGENTS.md §10 als
> „nicht von ‚nichts war je gespeichert' zu unterscheiden" beschreibt.

### 4.3 · Der Abschluss

7. Slug der Papierkorb-Zeile freigeben (§5.2), dann den sauberen Slug am Ziel vergeben.
8. Alte Zeile `is_active = 0` — der **weiche** Papierkorb, umkehrbar, wie bei den verwaisten
   Außenhüllen (16.08.2026): hart gelöscht wird nur, was niemand mehr erzeugen kann.
9. **Eine** Protokollzeile je Lauf, nicht eine je Ziel.

> 💣 **DAS ALLES GEHT DURCH EINE FUNKTION.** Die Ziele aus 4.1 und 4.2 je an ihrer eigenen
> Aufrufstelle zu erledigen ist die
> Bauform, die dieses Haus schon dreimal bezahlt hat — die Verkehrsmittel-Sperre (14.08.2026, „eine
> Regel, die einen von vier Erzeugern bindet, ist keine Regel"), die Ausstiegsregel (15.08.2026,
> dieselbe Lehre zum zweiten Mal) und die Ketten-Deaktivierung am Sammelknopf (16.08.2026, „zwei von
> drei Löschwegen gebunden ist keine Regel"). **Und im Kommentar steht keine ZAHL** — eine Zahl
> liest sich wie eine vollständige Liste, und niemand zählt nach (AGENTS.md, Konfliktmanagement).

---

## 5 · Vier Fallen, alle nachgemessen

### 5.1 · Der Kraftlinien-Präzedenzfall darf **nicht** abgeschrieben werden

`api/_internal/map/features.php:2479` und `:3939` wandern bereits eine `entity_public_id`:

```php
"UPDATE feature_sources SET entity_public_id = :new
 WHERE entity_type = 'powerline' AND entity_public_id = :old"
```

Ein glattes `UPDATE`, ohne jede Kollisionsbehandlung. **Dort ist das richtig** — bei Kraftlinien
trägt bauartbedingt nur das Ankersegment Quellen („A non-anchor segment carries no sources",
`features.php:3927`), das Ziel hat also nie schon eine Zeile.

💣 **Hier gilt das nicht.** `uq_feature_source (entity_type, entity_public_id, source_id)` bricht,
sobald **beide** Gebiete dieselbe Quelle zitieren — und bei einem eigenen Knoten und seinem
Wiki-Artikel ist genau das der wahrscheinliche Fall. Gebraucht wird Umhängen **plus** Aufräumen der
Dubletten (`UPDATE IGNORE`, dann `DELETE` des Rests), nie ein blankes `UPDATE`.

> 🪤 Das ist die Falle „Selbstzitat ist kein Beleg": *das Haus macht es so* ist zirkulär, sobald der
> Kontext ein anderer ist. Die zwei Stellen sind kein Muster, sie sind ein Sonderfall mit
> ausgeschriebener Begründung.

Dasselbe gilt für `uq_political_territory_claim (territory_id, claimant_territory_id)` — und dort
**doppelt**, weil beide Spalten wandern und ein Anspruch dabei auf sich selbst zeigen könnte
(`territory_id = claimant_territory_id`). Ein Selbstanspruch wird gelöscht, nicht geschrieben.

### 5.2 · Der Slug ist UNIQUE und kennt `is_active` nicht

`uq_political_territory_slug` gilt über **alle** Zeilen. Beide Gebiete heißen „Táyârret" und wollen
den Slug `t-y-rret`. `avesmapsPoliticalUniqueSlug` (`territory.php:773`) zählt über
`avesmapsPoliticalSlugExists`, und das fragt `SELECT COUNT(*) FROM political_territory WHERE slug =
:slug` — **ohne `is_active`**. Ohne Gegenmaßnahme bekäme der überlebende, kanonische Knoten also
`t-y-rret-2`, während der weggeworfene Platzhalter den sauberen Slug behält.

**Also:** erst den Slug der Papierkorb-Zeile freigeben (`<alt>-ersetzt-<id>`), dann den Ziel-Slug
vergeben. In dieser Reihenfolge, in derselben Transaktion.

### 5.3 · `parent_locked` muss erben

Alle Knoten des Kâhet-Teilbaums stehen im Screenshot auf 🔒. Das Wiki sagt
`Staat=[[Inoffiziell:Káhet Ni Kemi]]`; ohne Vererbung der Sperre zöge der nächste
`sync_parent_cache` die Hierarchie um. Die Sperre ist eine **Hand-Entscheidung** und überlebt nach
Hausregel jede Synchronisierung (`wiki_territory_model.parent_locked`, ausgegeben von
`sync-monitor-tree.php:267`) — sie wandert mit auf den neuen Schlüssel.

### 5.4 · Zwei Ansprüche auf denselben Schlüssel

Läuft der Dump-Sync **nach** einer Zuweisung erneut, findet er den Artikel und legt ihn ins Staging
— das ist harmlos, die Zielzeile existiert dann schon und wird nur aktualisiert. Läuft aber jemand
**zweimal die Zuweisung** auf denselben Zielschlüssel (zwei eigene Knoten, ein Artikel), wäre das
eine stille Verschmelzung zweier Gebiete. Der Riegel: der zweite Lauf **verweigert sich** und nennt
den Knoten, der den Schlüssel schon belegt. Kein automatisches Zusammenlegen.

---

## 6 · Der Sammellauf

„Namensgleiche vorschlagen": alle `eigener-knoten:`-Modellknoten gegen die Staaten aus
`political_territory_wiki_test`.

- Verglichen wird der **gefaltete Name** (`avesmapsPoliticalSlug(name)`), **nicht der Titel** — der
  Titel trägt den Namensraum (`Inoffiziell:Táyârret`), der Name nicht (`Táyârret`). Über Titel
  verglichen fände der Lauf **keinen einzigen** Treffer.
- Vorangehakt sind **nur eindeutige 1:1-Treffer**. Zwei Artikel auf einen Namen, oder zwei eigene
  Knoten auf einen Artikel: beide bleiben aus und werden als mehrdeutig benannt.
- Jede Zeile führt durch dieselbe Übernahme-Vorschau und dieselbe eine Funktion aus §4.

---

## 7 · Bauteile

| Datei | Rolle |
|---|---|
| `api/_internal/wiki/eigener-knoten-wiki-bindung.php` | **neu** — die eine Funktion: Vorschau (rein) + Übernahme (Transaktion) |
| `api/edit/wiki/sync-monitor.php` | zwei Aktionen: `preview_wiki_binding`, `apply_wiki_binding` (+ `suggest_wiki_bindings` für den Sammellauf) |
| `html/wiki-sync-monitor.html` | der Kasten im Detailpanel, in der vorhandenen `.dt-*`-Hülle |

> 🔴 **Keine zweite Hülle.** Das Detailpanel hat `.dt-grid`/`.dt-actions`; AGENTS.md nennt zwei
> Hüllen als Obergrenze für die Wiki-Zuweisung (`.dt-*` und `.label-wiki-*`). Der Kasten benutzt die
> vorhandene.

**Warum kein `js/ui/wiki-assign.js`.** Das geteilte Bauteil beantwortet „welcher Wiki-Artikel gehört
zu diesem Objekt" und setzt eine **Referenz**; sein Vertrag ist `laden`/`zuweisen`/`loesen`/
`syncUebernehmen` an einem Objekt, das seine Identität behält. Hier wird die Identität **ersetzt**
und eine zweite Zeile in den Papierkorb geschickt — `loesen` hat hier keine Bedeutung, und
`zuweisen` hätte eine völlig andere Folge als in den elf anderen Oberflächen. Das Bauteil zu
dehnen hieße, seinen Vertrag für alle elf aufzuweichen.

> 🔧 **Das ist eine Entscheidung, keine Gewissheit.** Sollte sich beim Bau zeigen, dass der Vertrag
> trägt, ist die Wiederverwendung die bessere Wahl — dann gehört diese Zeile korrigiert, nicht der
> Code an ihr vorbeigebaut.

---

## 8 · Tests

| Test | Zusicherung |
|---|---|
| `eigener-knoten-wiki-bindung-test.php` | Die Vorschau schreibt in **keine** Nutztabelle (Muster `sync-plan-purity-test.php`) |
| dto. | Die **vollständige Wanderung**: eine Fixture mit Geometrie, Quelle, Kind, Anspruch, Meldung und Siedlungs-`properties` — nach der Übernahme hängt **jedes** davon am neuen Knoten |
| dto. | Die **UNIQUE-Kollision** bei `feature_sources`: beide Gebiete zitieren dieselbe Quelle → ein Treffer bleibt, kein Bruch |
| dto. | Die **Anspruchs-Kollision** und der Selbstanspruch |
| dto. | Der **Slug**: der Überlebende bekommt `t-y-rret`, nicht `t-y-rret-2` |
| dto. | `parent_locked` ist am Ziel gesetzt |
| dto. | Der **zweite Lauf auf denselben Zielschlüssel** verweigert sich und nennt den Belegenden |
| dto. | Die drei Vorbelegungsregeln aus §3 |
| dto. | Der Sammellauf vergleicht den **Namen**, nicht den Titel; Mehrdeutiges bleibt ungehakt |
| `eigener-knoten-wiki-bindung-ziele-test.php` | **Der Zähler:** jedes Wanderungsziel aus §4 kommt im Code vor. Ein Ziel, das jemand hinzufügt, ohne es anzuschließen, bricht diesen Test. Dazu die Verdrahtung des Endpunkts und der Oberfläche |

Der letzte Test ist der wichtigste: er ist der Ersatz für die Zahl, die im Kommentar bewusst fehlt.

> ⭐ **Die Vorschau wird SERVERSEITIG gerechnet, nicht im Browser** — deshalb stehen ihre Tests
> oben bei PHP und nicht als eigene `.test.js`. Der Server hat beide Seiten ohnehin (die Overrides
> aus `wiki_territory_model.metadata_overrides_json` und die Wiki-Zeile aus dem Staging), und die
> Übernahme muss dieselbe Regel kennen wie die Anzeige. Im Browser gerechnet wären es zwei
> Wahrheiten über dieselbe Frage — die Bauform, die dieses Haus bei den Listenzeilen siebenmal
> bezahlt hat.

---

## 9 · Was dieser Entwurf NICHT tut

- **Kein Rückweg per Knopf.** Der Papierkorb holt die alte Zeile zurück, aber Geometrie, Quellen und
  Kinder hängen dann am neuen Knoten. Die Umkehr ist ein zweiter, gespiegelter Lauf — bewusst nicht
  gebaut (Owner 02.09.2026), und deshalb nennt die Bestätigung die Folge beim Namen.
- **Keine Änderung an der Schlüsselregel.** `avesmapsPoliticalSlug` bleibt unangetastet; der
  Namensraum bleibt im Schlüssel, wie bei den Siedlungen seit dem 01.09.2026.
- **Kein Dump-Lauf.** Ob `Inoffiziell:Táyârret` schon im Staging liegt, hängt daran, ob seit dem
  01.09.2026 ein Dump-Sync gelaufen ist. 🔧 **Das ist am lebenden Bestand nachzusehen** — dieser
  Rechner hat weder `config.local.php` noch einen Dump, die Zahl „69 Staat-Seiten in ns 222" stammt
  aus `namespaces.php` und ist hier nicht gegengeprüft.
- **Keine anderen Objektarten.** Wege, Regionen und Orte haben keine eigenen Knoten in diesem Sinn.
