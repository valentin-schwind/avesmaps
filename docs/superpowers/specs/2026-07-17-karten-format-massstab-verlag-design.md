# Kartensammlung: Format, Maßstab und Verlag als eigene Felder

Stand 2026-07-17. Owner-freigegeben. Gehört zu `2026-07-16-kartensammlung-wiki-sync-design.md`;
Code: `api/_internal/wiki/citymap-sync.php`, `api/_internal/wiki/publication-parsing.php`,
`api/_internal/app/citymaps.php`.

## 1. Das Problem

Der Sync schreibt Format und Maßstab der „neuen Liste" des Stadtplanindex als **Freitext** in
`citymap.note`:

    Format: A4 · Maßstab: Ja · Mit Nummern

Damit sind drei verschiedene Dinge in einer Zeichenkette verklebt: eine Blattgröße, eine Ja/Nein-Frage
und eine echte Notiz. Nichts davon ist filterbar, sortierbar oder im Editor einzeln korrigierbar, und
`note` — das Feld für „Mit Legende" — ist als Notizfeld praktisch unbenutzbar geworden.

Dazu kommt: die Wiki-Zeile „Erschienen bei" (der **Verlag**) erreicht uns gar nicht.

## 2. Messung (2026-07-17, echter Wikitext via `?action=raw`)

Diese Zahlen tragen jede Entscheidung unten. **Nicht neu erheben.**

### Stadtplanindex, „neue Liste", 230 Zeilen

Spalten: `Stadt | Quelle | Farbe | Format | Maßstab | Notiz | Künstler`

| Spalte „Maßstab" | Anzahl |
|---|---|
| `-` (unbekannt) | 81 |
| `Ja` | 70 |
| `Nein` | 36 |
| **`Forum`** | **24** |
| Parallel-Arrays (`Ja/-`, `Nein/-/-`, …) | 18 |
| `Mit Nummern` | 1 |

| Spalte „Format" | Anzahl |
|---|---|
| `-` (unbekannt) | 115 |
| `A4` / `A5` / `A3` / `A2` | 40 |
| cm-Maße (`33,5x25,5`, `ca. 8,5 x 8,5 cm`, `13cm breit`) | 74 |
| **`Nein`** | **1** |

**Die Owner-Vorgabe ist bestätigt: „Maßstab" enthält Ja/Nein, keinen Maßstab.** `has_scale` ist richtig,
`scale VARCHAR` wäre falsch gewesen.

**⚠️ Korrektur an `citymaps-wiki-sync-recon`:** dort steht, `Andergast` schreibe „Forum" in die
Maßstab-Spalte — als **einzelner** kaputter Wert. Es sind **24 Zeilen**. Das ist kein Tippfehler,
sondern ein systematisch eingetragener Wert, dessen Bedeutung wir nicht kennen (Andergast, Avestreu,
Ayshabad, Baburin, Brechtnow …). Er darf deshalb erst recht nicht stillschweigend verschwinden.

`Boronia` ist ein **Spaltenversatz im Wiki**, kein Parse-Fehler bei uns:

    | Boronia||Stunden des Schweigens||sw||Nein||Mit Nummern||mit Nummern||-
                                            ^^^^ gehört in Maßstab  ^^^^ gehört in Notiz

Die Zeile hat 7 Zellen (die Recon-Aussage stimmt), aber ihr **Inhalt** ist um eins verschoben. Nicht
reparieren: wir kopieren korrekt, das Wiki hat den Fehler.

### Kartenindex — die Spalte „Maßstab" heißt hier gleich und meint etwas anderes

`avesmapsCitymapParseKartenindex` liefert **56 Karten** (8 Kontinent, 48 regional). Die
Kontinent-Tabellen führen **echte Maßstäbe**:

    |Aventurien-Hexkarte ||43 x 57 cm ||ca. 1:6.400.000 ||[[Abenteuer Ausbau-Spiel]] ||1985
    |Karte der Handelszonen Aventuriens ||17,4 x 23,5 cm ||1:12.750.000 ||[[Geographia Aventurica]] …

5 von 8 nennen einen. **Damit hatten beide Memories recht** — `citymaps-wiki-sync-recon` („Ja/Nein")
beschreibt den Stadtplanindex, `citymaps-redesign-datenlage` („Maßstab: 1:12.750.000") den Kartenindex.
Ein Feld muss beide Seiten tragen.

**⚠️ Zweite Korrektur: es gibt keine Derekarten.** Alle 8 Kontinentkarten sind `place=Aventurien`; die 5
Derekarten (Welt-Karte, Naqshare Derane, …) werden **komplett verschluckt**. Ihre Tabelle hat nur **4
Spalten** (kein „Maßstab") und ihre Publikationsliste steht auf **eigenen Zeilen**:

    |'''Welt-Karte'''<br />… || 17 x 12 cm ||
    *[[Das Land des Schwarzen Auges]]
    ||November 1990

Der Parser arbeitet zeilenweise, sieht in der ersten Zeile nur 3 Zellen, findet keine Quelle und
verwirft die Zeile. `citymaps-wiki-sync-recon` behauptet, die Derekarten kämen als `unresolved` an —
sie kommen gar nicht an. **Außerhalb dieses Auftrags**, nur festgehalten: es sind 5 ortlose Weltkarten,
die an keiner Siedlung je erschienen wären, und ein mehrzeiliger Tabellenparser ist ein eigener Umbau.

### Verlag — variiert, ist ein Wikilink, kann mehrere nennen

`{{Infobox Produkt}}` auf der **Buch**-Seite, Parametername `Verlag` (an vier echten Seiten geprüft):

| Seite | `|Verlag=` |
|---|---|
| Geographia Aventurica | `[[Fanpro]]` |
| Abenteuer Ausbau-Spiel | `[[Schmidt Spiele]] & [[Droemer Knaur]]` |
| Die Dunklen Zeiten | `[[Ulisses]]` |

**Der Verlag ist nicht immer Ulisses.** Drei Stichproben, drei Verlage — das Feld trägt echte
Information und gehört sichtbar in die Zeile (Owner-Entscheidung 2026-07-17). Der Wert ist Wikitext-
Markup und muss durch `avesmapsWikiStripWikiInlineMarkup`; er kann mehrere Verlage nennen.

## 3. Datenmodell

| Spalte | Typ | Inhalt |
|---|---|---|
| `citymap.format` | `VARCHAR(120) NULL` | „A2", „33,5x25,5", „43 x 57 cm" |
| `citymap.has_scale` | `TINYINT(1) NULL` | siebtes Tri-Bool |
| `citymap.publisher` | `VARCHAR(160) NULL` | „Fanpro", „Schmidt Spiele & Droemer Knaur" |
| `wiki_publication_catalog.publisher` | `VARCHAR(160) NULL` | die Herkunft des Verlags |
| `wiki_citymap_catalog.format` / `.has_scale` | wie oben | Staging |

**`NULL = unbekannt ≠ false`** (Kernregel §3.1, `api/_internal/app/citymaps.php`). `has_scale` folgt dem
Muster der sechs vorhandenen Tri-Bools exakt; `format`/`publisher` folgen `author`.

**`format`, nicht `width_px`:** das Wiki liefert Zentimeter und DIN-Namen, `width_px` sind Pixel. Die
Kartenindex-Spalte „Abmessungen" ist **dieselbe Sache** unter anderem Namen („43 x 57 cm" vs.
„33,5x25,5") und geht deshalb ebenfalls nach `format` — sonst landete ein und dieselbe Angabe je nach
Wiki-Seite in zwei verschiedenen Spalten.

**`publisher` an der Karte, nicht nur an der Publikation** (Owner-Entscheidung): der Sync kopiert ihn
beim Reconcile aus dem Publikationskatalog auf die Karte — genau wie er es mit `map_url` längst tut.
Damit ist die Override-Sicherheit gratis (ein Feldname mehr in `avesmapsCitymapReconcilePlan`) und der
Editor kann ihn pro Karte korrigieren. Der Weg über den **geteilten** `source_catalog` (der auch
Siedlungen bedient) wäre der größere Eingriff und nähme dem Editor die Korrekturmöglichkeit.

## 4. Die Maßstab-Regel

Eine reine Funktion `avesmapsCitymapScaleFromCell(string $cell): array{has_scale:?int, text:?string}`:

| Zelle | `has_scale` | `text` (→ `note`) |
|---|---|---|
| `Ja` | `1` | — |
| `Nein` | `0` | — |
| `1:12.750.000`, `ca. 1:6.400.000` | `1` | der Maßstab |
| `Forum`, `Mit Nummern` | `NULL` | der Wert |
| `-`, leer | `NULL` | — |

Zwei Entscheidungen stecken darin:

**Ein dastehender Maßstab beweist einen Maßstab** → `has_scale = 1`. Der String selbst bleibt sichtbar,
weil `has_scale` ihn nicht fassen kann: „1:12.750.000" ist mehr Information als „ja".

**Unbekanntes bleibt sichtbar** (Owner-Entscheidung): „Forum" landet als Text in `note`, `has_scale`
bleibt `NULL`. Wegwerfen würde 24 Zeilen eines Wiki-Fehlers unsichtbar machen — und damit auch nie
reparierbar. Sichtbar bleiben heißt: jemand kann es im Wiki richtigstellen.

## 5. Der Verlag kostet keinen neuen Crawl

`avesmapsWikiParseProductInfobox` parst den `{{Infobox Produkt}}`-Block der Buchseite **bereits** —
`Verlag` steht nur nicht in seiner Parameterliste. Der Wert wird heute also weggeworfen, nicht ungeholt.
Dasselbe Muster wie beim F-Shop-Link (`5ff93457`): die Antwort lag längst in unserer eigenen DB.

Weg: `|Verlag=` → `avesmapsWikiStripWikiInlineMarkup` → `wiki_publication_catalog.publisher` →
`avesmapsCitymapPublisherForSource($pdo, $sourceRaw)` (gebaut wie `avesmapsCitymapWikiUrlForSource`) →
`citymap.publisher`.

**🔧 Der Owner muss „Dump holen" erneut fahren**, bevor „Karten syncen" den Verlag kennt: die Spalte
wird beim Dump-Lauf gefüllt, nicht beim Reconcile.

## 6. Override-Sicherheit

Unverändert: `avesmapsCitymapReconcilePlan` bekommt die drei Felder in seine `$fields`-Liste, sonst
nichts. `status='suppressed'` → skip, `origin != 'wiki'` → skip. Ein Edit an einer Wiki-Karte adoptiert
sie zu `origin='manual'`, danach lässt der Sync sie los. Ein wiederholter Sync bleibt ein echtes No-op.

## 7. Anzeige

- `format` und `publisher` → Faktenzeile (`__facts`), neben Gültigkeit/Auflösung/Urheber.
- `has_scale === true` → Merkmal „mit Maßstab" (`__traits`). **Kein „ohne Maßstab"** bei `false`: das
  liest sich als Mangel, nicht als Datenlage (§3.1, wie bei `is_color`).
- `note` zeigt nur noch echte Notizen — plus die unparsbaren Maßstab-Werte aus §4.

Der Editor bekommt `ceField("Format")`, `ceField("Verlag")` und `ceTri("Maßstab")`.

## 8. Selbstheilung statt Migration

Die ~94 Karten mit „Format: A4 · Maßstab: Ja" in `note` brauchen **kein** Migrationsskript: der nächste
Sync-Lauf schreibt `note` neu (der Parser setzt „Format:"/„Maßstab:" nicht mehr hinein) und füllt die
neuen Spalten. Das gilt für `origin='wiki'`; von Hand editierte Karten behalten ihren Freitext, weil der
Sync sie nicht anfasst — das ist die Override-Sicherheit, kein Fehler.

## 9. Fallen

- **`html/citymap-editor.html` wird dynamisch geladen** → `ASSET_VERSION` in
  `js/territory/territory-editor-inline-host.js` bumpen (AGENTS.md §7).
- **`avesmapsCitymapToRenderShape` ist eine Whitelist** — ein Feld, das dort fehlt, erreicht die Zeile nie.
- **Öffentlicher Katalog = explizite Spaltenliste, Editor-Read = `SELECT *`** → eine vergessene Spalte
  ist im Editor sichtbar und beim Leser stumm weg.
- **Zwei Tests werden absichtlich rot:** `citymap-report-test.php` (geschlossene Key-Whitelist) und
  `citymaps-render.test.js:183` (erwartet exakt „farbig · offiziell"). Beide sind eingebaute Bremsen.
- **Kein E2E ohne Owner:** keine lokale DB. Beweisbar sind die reinen Parser/Plan-Funktionen.
