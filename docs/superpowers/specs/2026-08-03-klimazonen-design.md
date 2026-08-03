# Klimazonen — Entwurf

> **Stand 2026-08-03.** Vom Owner abgenommen (Entwurf gezeigt und durchprobiert).
> Bauplan: `docs/superpowers/plans/2026-08-03-klimazonen.md`.

## 1. Was gebaut wird

Eine **vierte Landschaften-Ebene „Klimazonen"** neben Derographie, Vegetation und
Topographie. Sie zeigt **sieben Bänder**, die die Karte von Nord nach Süd teilen —
von der Polaren Zone oben bis zur Tropischen Zone unten.

Der Owner bearbeitet **nicht die Bänder, sondern die sechs Trennlinien dazwischen**.
Nach jedem Speichern rechnet der Server aus den Linien die sieben Flächen neu.

Dazu, weil im selben Auftrag: **„Derographische Region" heißt ab jetzt
„Derographie"** — im Karten-Umschalter und im Editor-Reiter. Nur die Beschriftung;
der Schlüssel `derographisch` bleibt (er ist Join-Schlüssel in zehn Tabellen).

## 2. Der tragende Satz

> 🔴 **Die sechs Linien sind die Wahrheit. Die sieben Flächen sind abgeleitet.**

Alles Weitere folgt daraus:

- **Keine Überlappung** (Auftrag Punkt 4) ist keine Regel, die geprüft wird, sondern
  Bauart. Ein Band *ist* der Raum zwischen zwei Linien. Es kann weder eine Lücke noch
  eine Doppelbelegung geben, solange sich die Linien nicht kreuzen — und das
  verhindert der Editor beim Ziehen, nicht erst beim Speichern.
- **Die Bänder sind auf der Karte nicht als Polygone bearbeitbar.** Kein Ecken-Ziehen,
  kein Zerschneiden, kein Vereinigen, kein Vereinfachen, kein Löschen. Sonst gäbe es
  zwei Wahrheiten über dieselbe Grenze, und die driften auseinander.
- **Sie sind trotzdem ganz gewöhnliche `ecosystem_area`-Zeilen.** Genau deshalb
  funktionieren Regionen-Editor, „Zugehörigkeit rechnen", Wege-Zuordnung und
  „Führt durch" ohne eigenen Code.

## 3. Die sieben Zonen

Namen und Farben vom Owner abgenommen (2026-08-03). Der **kurze Name** steht auf der
Karte und im Editor, der Zusatz ist Untertitel.

| # | `type_key` | Name | Untertitel | Farbe |
|---|---|---|---|---|
| 1 | `polar` | Polare Zone | Eiswüstenklima | `#E6EEF3` |
| 2 | `subpolar` | Subpolare Zone | Tundrenklima | `#BCD3DC` |
| 3 | `boreal` | Boreale Zone | kaltgemäßigtes Nadelwaldklima | `#8FB6B4` |
| 4 | `gemaessigt` | Gemäßigte Zone | kühl- bis warmgemäßigtes Klima | `#C9CF9B` |
| 5 | `subtropen_winterfeucht` | Winterfeuchte Subtropen | Mittelmeerklima | `#E0C274` |
| 6 | `subtropisch` | Subtropische Zone | trocken-heißes Klima | `#DD9C55` |
| 7 | `tropisch` | Tropische Zone | immerfeuchtes Tropenklima | `#CC6F45` |

Bewusst **keine Grün-Skala**: Grün gehört der Vegetation. Dies ist eine reine
Temperaturskala (Eis → blass → neutral → gold → warm), damit die beiden Ebenen
nebeneinander unterscheidbar bleiben.

Schlüssel sind ASCII-gefaltet wie überall im Haus (`gemaessigt`, nicht `gemäßigt`) —
AGENTS.md §5.

> 🔴 **`sort_order` ist tragend, nicht Kosmetik.** Die Reihenfolge 10…70 sagt, welche
> Zone nördlich welcher liegt, und daraus folgt, welche Trennlinie welches Band
> begrenzt. Wer sie umsortiert, sortiert die Karte um. Dieselbe Falle wie beim
> Ortsart-Katalog (`place-kinds.php`).

## 4. Die sechs Trennlinien

### 4.1 Form

Eine Trennlinie ist ein **GeoJSON LineString**, Positionen `[x, y]` wie überall auf
dem Draht (AGENTS.md §5: Leaflet dreht erst im Client auf `[y, x]`).

Regeln, alle serverseitig geprüft:

| | |
|---|---|
| **erster Punkt** | `x = 0` (linker Kartenrand) |
| **letzter Punkt** | `x = 1024` (rechter Kartenrand) |
| **x streng steigend** | jeder Punkt liegt rechts vom vorigen |
| **y im Bereich** | `0 … 1024` |
| **Anzahl Punkte** | ≥ 2, ≤ 500 |
| **Abstand zum Nachbarn** | ≥ `AVESMAPS_CLIMATE_MIN_GAP` (1,0 Karteneinheiten) an **jeder** Stelle |

> 💣 **„x streng steigend" ist keine Bequemlichkeit, sondern das, was die ganze
> Konstruktion trägt.** Nur so ist jede Linie eine Funktion `y(x)`, nur so lässt sich
> „liegt Linie 3 überall unter Linie 2" exakt prüfen, und nur so entsteht aus zwei
> Linien ein Polygon ohne Selbstüberschneidung. Wer freie Punktreihenfolge zulässt,
> muss stattdessen Linien-Schnitttests bauen und bekommt Bänder, die sich zu
> Achterschleifen falten.

**Norden ist oben, also hohes `y`.** `MAP_BOUNDS = [[0,0],[1024,1024]]` in
`[lat, lng] = [y, x]`, und `L.CRS.Simple` lässt `lat` nach oben wachsen (bestätigt
über `wiki-positionskarte-to-map-coords`: „Y läuft im Wiki nach UNTEN, y bei uns nach
OBEN"). Trennlinie 1 hat damit das **höchste** `y`, Trennlinie 6 das niedrigste.

### 4.2 Wie die Prüfung „überall darunter" exakt läuft

Beide Linien sind stückweise linear und x-monoton. Zwei solche Funktionen können sich
nur zwischen zwei aufeinanderfolgenden Knickstellen kreuzen — und wenn sie es tun,
ist an mindestens einer der beteiligten Knickstellen der Abstand kleiner als am
anderen Ende. Es genügt also, **an der Vereinigung der x-Werte beider Linien** zu
prüfen. Kein Sampling-Raster, keine Toleranzfrage: das Ergebnis ist exakt.

### 4.3 Wie aus n Linien n+1 Flächen werden

Für Band `k` (0-basiert, 0 = Polar):

```
obere Kante = k == 0     ? [[0,1024],[1024,1024]] : Linie k
untere Kante = k == last ? [[0,0],[1024,0]]       : Linie k+1

Ring = obere Kante (x aufsteigend)
     + untere Kante (x absteigend)
     + Ringschluss
```

Das ergibt für jedes Band ein einfaches Polygon, dessen linke und rechte Kante
exakt auf dem Kartenrand liegen. Zwei benachbarte Bänder teilen sich ihre Linie
**punktgleich** — es entsteht kein Spalt, den ein Verschnitt später als „gehört zu
keiner Zone" meldet.

### 4.4 Bänder laufen über die ganze Karte

Owner-Entscheid 2026-08-03: **die Zonen enden nicht an der Küste.** Das Meer hat ein
Klima, und der spätere Effekt soll auch für Seewege gelten. Zusätzlich: an Land
abzuschneiden wäre genau der Moment, in dem die Bänder wieder Lücken bekommen können.

## 5. Datenmodell

### 5.1 Neue Tabelle

```sql
CREATE TABLE IF NOT EXISTS ecosystem_climate_divider (
    seq TINYINT UNSIGNED NOT NULL,        -- 1..n, Norden nach Süden
    geometry_geojson JSON NOT NULL,       -- LineString, [x, y]
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

Sechs Zeilen. `seq = k` trennt Zone `k` (nördlich) von Zone `k+1` (südlich).

`revision` ist der optimistische Wächter, gleiche Bauart wie
`ecosystem_area.geometry_revision`: der Client schickt beim Speichern die Fassung
zurück, die er gelesen hat, und bekommt sonst 409 statt eines stillen Überschreibens.

### 5.2 Bestehende Tabellen

- **`ecosystem_region`** — sieben Zeilen mit `kind = 'klima'`, `region_type` = der
  Zonenschlüssel, `origin = 'own'`, `label_public_id = NULL`.
- **`ecosystem_area`** — je Zone genau **eine** Zeile, `geometry_geojson` = das
  abgeleitete Band.
- **`ecosystem_region_type`** — sieben Saatzeilen `('klima', …)`. `affects_paths`
  bleibt auf dem Standard **1**: anders als `meer` und `kontinent` sagt „dieser Weg
  verläuft in der Tropischen Zone" etwas, und die Rechnung ist billig (eine
  Trennlinie hat Dutzende Ecken, nicht 3.050 wie `Meer-001`).

### 5.3 Kein zweites Quellensystem, kein zweites Flächensystem

Die Zonen bekommen **keine eigene Tabelle für Flächen**. Sie sind
`ecosystem_area`-Zeilen wie jede andere Fläche. Das ist derselbe Grundsatz, den
AGENTS.md §5 für Quellen ausschreibt (`lore_source` als abschreckendes Beispiel) —
nur hier für Flächen. Die Trennlinien bekommen eine eigene Tabelle, weil sie ein
**anderes Ding** sind: eine Linie, kein Polygon, mit eigenen Regeln.

> 💣 Die Trennlinien gehören **nicht** in `map_features`. Dort wären sie Wege —
> routbar, suchbar, im Kartenpayload, mit Label und Infobox. Eine Klimagrenze ist
> keine Straße.

## 6. Saat und Ableitung

### 6.1 `avesmapsEcosystemClimateEnsure(PDO): bool`

Ein Aufruf, idempotent, gibt zurück, ob er etwas geändert hat:

1. Fehlende `klima`-Regionen anlegen (eine je aktiver Zonenart, in `sort_order`).
2. Fehlende Trennlinien anlegen: gerade Linien auf gleichmäßiger Höhe
   (`y = 1024 * (n+1-seq) / (n+1)`), zwei Punkte. Überzählige entfernen.
3. Die Bänder aus den Linien neu rechnen und je Zone die eine Fläche schreiben
   (anlegen oder Geometrie ersetzen).

> 💣 **Läuft NICHT in `avesmapsEcosystemEnsureTables()`.** Die DDL-Selbstheilung hebt
> die Revision nicht — ein dort angelegter Bestand käme bei jedem warmen Client als
> 304 an und wäre unsichtbar. Genau diese Falle hat die Insel/Inselgruppe-Umstellung
> gekostet (`insel-inselgruppe-taxonomie`). Die Saat läuft im **Schreib-Dispatcher**,
> hinter der Fähigkeitsprüfung, und hebt die Revision, wenn sie etwas getan hat.

### 6.2 Reine Funktionen (unit-getestet, ohne DB)

| Funktion | Aufgabe |
|---|---|
| `avesmapsClimateNormalizeDivider(mixed): array` | Form, Randpunkte, x-Monotonie, Grenzen |
| `avesmapsClimateAssertOrder(array $dividers): void` | „jede Linie überall unter ihrer nördlichen Nachbarin", Prüfung nach §4.2 |
| `avesmapsClimateBandGeometry(?array $upper, ?array $lower): array` | zwei Kanten → ein Polygon-Ring (§4.3) |
| `avesmapsClimateDefaultDividers(int $count): array` | gleichmäßige Startaufteilung |

Prüfbar mit `php -d zend.assertions=1` ohne Datenbank — das ist der Punkt, an dem die
Geometrie-Regeln festgenagelt werden, nicht im Browser.

## 7. API

Vier neue Aktionen an `POST /api/edit/map/ecosystem.php` (Fähigkeit `edit`, wie alles
dort):

| Aktion | Wirkung |
|---|---|
| `climate_get` | ruft `ClimateEnsure`, liefert die Trennlinien mit `revision` und die Zonen-Vokabel |
| `climate_save_divider` | eine Linie speichern (`seq`, `geometry_geojson`, `expected_revision`), Reihenfolge prüfen, alle Bänder neu ableiten, Revision heben |
| `climate_reset` | zurück auf die gleichmäßige Startaufteilung |
| — | *kein* `climate_delete`: die Anzahl der Linien folgt aus der Anzahl der Zonen |

Der öffentliche Leseweg `GET /api/app/ecosystem-areas.php` bleibt **unverändert** —
die Bänder kommen als normale Flächen mit `kind = "klima"` heraus. `AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION`
wird trotzdem gehoben: die Form ändert sich zwar nicht, aber ein warmer Client
bekäme über 304 einen Bestand ohne die neue Ebene und zeigte einen leeren Reiter.

## 8. Karte

### 8.1 Umschalter

Vierte Kachel **„Klimazonen"** hinter Topographie. Vierter Wert in `ECOSYSTEM_KINDS`,
`ECOSYSTEM_KIND_LABELS`, `ECOSYSTEM_KIND_PREFIX` (→ „Klima"), `ECOSYSTEM_KIND_PANES`,
`ECOSYSTEM_KIND_COLOR_TOKENS`, `AVESMAPS_ECOSYSTEM_KINDS` (PHP), und eine vierte Pane
in `bootstrap.js` (`ecosystemPaneKlima`, z-index 253).

> 🪤 Der Kommentar an `index.html:627` sagt heute, `AVESMAPS_ECOSYSTEM_KINDS` kenne
> „genau drei Werte — ein vierter gäbe 400". Das gilt weiter für **„Alle"** (das ist
> ein Anzeige-Flag, kein `kind`) und ist mit diesem Bau für `klima` aufgehoben. Der
> Kommentar wird mitgezogen, sonst widerspricht er dem Code.

### 8.2 Darstellung

- Bänder mit ihrer Zonenfarbe, **Füllung 0,18**, Kontur aus.
  Begründung wie bei der derographischen Ebene, die sich aus demselben Grund auf 0,1
  zurücknimmt: eine Fläche, die die halbe Karte deckt, darf den Inhalt nicht zudecken.
- Die **Trennlinien** tragen die Kante — eigene Pane über den Bändern, 2 px, dunkel.
- Der **Zonenname** wird vom Klima-Renderer selbst gezeichnet, am Westrand des Bandes,
  nur solange die Ebene aktiv ist.

> 🔴 **Kein `map_features`-Label für eine Zone.** Ein echtes Karten-Label bräuchte
> einen neuen Subtyp in der Allowlist, liefe durch die Kollisionsauflösung und stünde
> auf der normalen Karte. Der Name gehört zur Ebene, nicht zur Karte.

### 8.3 Was für `klima` gesperrt ist

Jede dieser Stellen bekommt einen Riegel, und jeder Riegel eine Zeile im Test:

| Stelle | Verhalten |
|---|---|
| Kontextmenü „Hier hinzufügen" | **kein** „Neue Klimazone" |
| „Grenze aus Territorien …" | `klima` nicht als Ziel-Ebene wählbar |
| Ecken-Editor (`ecosystem-edit.js`) | öffnet auf einem Band **nicht** |
| Boolesche Verben (vereinigen, zerschneiden, herauslösen, verschieben) | nicht angeboten |
| „Ebene wechseln" (`ecosystem-transfer.js`) | `klima` weder Quelle noch Ziel |
| `delete_area` / `delete_region` (Server) | 400 für `kind = 'klima'` |
| `create_area` / `create_region` (Server) | 400 für `kind = 'klima'` außerhalb der Ableitung |

> 💣 Die Server-Riegel sind die eigentlichen. Ein UI-Riegel schützt vor dem
> Verklicken; er schützt nicht vor einem alten Tab, der eine Aktion noch kennt.

### 8.4 Der Linien-Editor

Neues Modul `js/map-features/map-features-ecosystem-climate.js`. Sichtbar nur, wenn
die Ebene „Klimazonen" aktiv ist **und** `IS_EDIT_MODE` — dieselbe zusätzliche
Bedingung, die auch die Zeichenwege tragen.

| Geste | Wirkung |
|---|---|
| Griff ziehen (Mitte) | frei, geklemmt zwischen den Nachbarlinien und zwischen den x der Nachbarpunkte |
| Griff ziehen (Rand) | **nur senkrecht**, x bleibt 0 bzw. 1024 |
| Klick auf die Linie | setzt einen Punkt an der Klickstelle |
| Doppelklick auf einen mittleren Griff | löscht ihn |
| Doppelklick auf einen Randgriff | **nichts** (er ist Pflicht) |
| Loslassen | speichert diese eine Linie, Server leitet ab, Bänder werden neu gezeichnet |

Griffe benutzen `path-edit-handle-marker` — dieselbe Optik wie Wege-, Regionen- und
Flächen-Editor. Randgriffe zusätzlich `--pinned` (eckig statt rund), damit man sieht,
warum sie sich nicht seitwärts bewegen lassen.

> 💣 **Löschen hängt an einem NATIVEN `dblclick`-Listener**, nicht an
> `marker.on("dblclick")`. Genau daran ist der Flächen-Editor schon einmal gescheitert
> (Kommentar `ecosystem-edit.js:576`, Merkposten `leaflet-marker-dblclick-needs-native-listener`).

> 💣 **Beim `dragend` nicht synchron neu rendern.** Der Kartenpunkt-Editor hat genau
> das gekostet (`kartenpunkt-verschieben`). Speichern anstoßen, Antwort abwarten,
> dann zeichnen.

## 9. Regionen-Editor

- Vierter Reiter **„Klimazonen"** (`data-kind="klima"`). Reiter und Art-Filter sind
  bereits generisch — der Filter „Art" leitet seine Werte aus den geladenen Zeilen ab
  und bietet die sieben Zonen damit von selbst an.
- Spalte 2 „Eigenschaften": Name und Wiki-Eintrag bearbeitbar wie bei jeder Region.
  **Art und Ebene sind festgestellt**, Löschen ist nicht angeboten.
- Spalte 3 „Vorschau & Vorkommen": unverändert.
- **„Zugehörigkeit rechnen"** braucht keinen neuen Code. Sobald die Bänder Flächen
  sind, fällt „dieser Wald liegt zu 87 % in der Gemäßigten Zone" aus demselben
  Verschnitt, den der Knopf ohnehin fährt, und wird als `ecosystem_region_overlap`
  gespeichert. Dasselbe für Wege über `path_ecosystem`.

> ⚠️ **Mengengerüst.** Der Verschnitt prüft jede Region gegen jede. Sieben Bänder mit
> kartenbreitem Umriss bestehen den Rechteck-Vorfilter für fast jede Region, das sind
> also rund `3 × Regionenzahl` zusätzliche Verschnitte — aber gegen ein Polygon mit
> Dutzenden Ecken, nicht gegen `Meer-001` mit 3.050. Die Zahl in der Kachel („Paare
> geprüft / verschnitten") sagt hinterher, was es wirklich war. **Nach dem ersten Lauf
> nachmessen** und, wenn es beißt, `affects_paths` neu bewerten.

## 10. Umbenennung „Derographische Region" → „Derographie"

Vier sichtbare Stellen, ein Schlüssel bleibt:

| Datei | heute |
|---|---|
| `index.html:635` | Kachel im Karten-Umschalter |
| `html/landschaften-editor.html:66` | Reiter im Regionen-Editor |
| `js/map-features/map-features-ecosystem-rendering.js:20` | `ECOSYSTEM_KIND_LABELS.derographisch` |
| `js/app/i18n-en.js:135` | `ecosystem.kind.derographisch` |

`ECOSYSTEM_KIND_PREFIX.derographisch` steht bereits auf „Derographie" — die
Umbenennung gleicht die Anzeige an das an, was die Fenstertitel längst sagen.

> 🔴 **`derographisch` als Wert bleibt überall.** Er steht in `ecosystem_region.kind`,
> `ecosystem_region_type.kind`, in `AVESMAPS_ECOSYSTEM_KINDS`, in Panes, Tokens,
> CSS-Klassen und Tests. Umbenannt wird ausschließlich die Beschriftung.

## 11. Was dieser Bau NICHT tut

- **Kein Reise-Effekt.** Der Owner hat „später einen Effekt" gesagt. Hier entstehen
  die Daten und ihre Zugehörigkeit — nicht die Auswirkung auf Reisezeiten. Das ist
  eine eigene Sitzung, mit eigener Messung.
- **Kein Rückgängig für Trennlinien.** Die Bewegung wird protokolliert
  (`ecosystem_geometry_audit_log`, Aktion `update_climate_divider`), aber
  `undo_change` nimmt sie in dieser Fassung nicht zurück. „Zurücksetzen" gibt es als
  eigene Aktion für alle Linien gemeinsam.
- **Keine Wiki-Anbindung.** Klimazonen sind Modell, nicht Wiki-Bestand. Kein Sync,
  keine `wiki_region_key`-Auflösung, kein Eintrag im Konfliktzentrum.
- **Keine Klimazone in der Infobox** von Orten und Wegen. Kommt mit dem Effekt.
- **Das Handbuch wird nicht angefasst** (AGENTS.md §9). Die Commit-Betreffs nennen die
  sichtbare Wirkung; die nächtliche Routine zieht nach.

## 12. Prüfung

| Was | Wie |
|---|---|
| Geometrie-Regeln (§4) | PHP-Unit-Tests, ohne DB, `zend.assertions=1` |
| Ableitung Linien → Bänder | Unit: n Linien ergeben n+1 lückenlose, disjunkte Bänder; Summe der Flächen = 1024² |
| Reihenfolge-Wächter | Unit: gekreuzte Linien werden abgelehnt, berührende auch |
| Saat idempotent | Unit gegen `pdo_sqlite`, zweimal laufen lassen, zweiter Lauf ändert nichts |
| Riegel (§8.3) | je ein Test, dass `create_area`/`delete_area` mit `kind='klima'` 400 geben |
| Linien-Editor | localhost-Repro nach `verify-ui-fix-via-localhost-repro`: echte Klicks, kein `.click()` |

## 13. Merkposten aus dem Haus, die hier greifen

- `ASSET_VERSION` in `territory-editor-inline-host.js` heben — der Regionen-Editor
  wird dynamisch geladen (AGENTS.md §7).
- Niemals `git add -A`: geteilter Arbeitsbaum, andere Sitzungen haben offene Arbeit.
- Nach dem Push die Remote-SHA prüfen; PHP wirkt auf STRATO 2–4 Minuten verzögert
  (`strato-opcache-verzoegert-php-deploy`).
- Keine hartkodierten Farben — die sieben Zonentöne werden Tokens in
  `css/base/tokens.css` (AGENTS.md §12).

Verwandt: [[oekosystem-terrain-routing]], [[landschaften-flaeche-label-kopplung]],
[[landschaften-editor-siebter]], [[insel-inselgruppe-taxonomie]],
[[ortsart-place-kind-feld]].
