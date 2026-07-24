# `wiki_key` ohne `iconv` — deterministische Transliteration (Design)

**Datum:** 2026-07-24 · **Auftraggeber:** Owner · **Bezug:** AGENTS.md §10
(bekannte Fragilitäten), `docs/konfliktmanagement-design.md` (Dump-Bericht)

## 1. Ausgangslage

`avesmapsPoliticalSlug()` (`api/_internal/political/territory.php:1058-1072`)
bildet den `wiki_key` — den Join-Schlüssel zwischen `political_territory`,
`wiki_publication_catalog`, `wiki_adventure_catalog` und einem guten Dutzend
weiterer Tabellen — unter anderem mit

```php
iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $slug)
```

Die Umschrift von `//TRANSLIT` hängt an der **C-Bibliothek des Servers**, nicht
an PHP. Dasselbe Muster steht an vier weiteren Stellen (§4).

**Heute ist nichts kaputt.** Alles, was diese Schlüssel schreibt *und* liest,
läuft auf demselben Server; der Bestand ist in sich stimmig. Die Mine ist die
Zukunft: wechselt STRATO die PHP-Version oder die Systembibliothek, ändert sich
die Form *jedes* Schlüssels mit Sonderzeichen und **jeder Join bricht lautlos** —
dieselbe Fehlerform wie der DPL3→DPL4-Vorfall.

Sichtbar wurde es an drei dauerhaft roten Selbsttests im Dump-Bericht
(`test-wiki-key-derivation`, `test-dump-entities`, `test-dump-reader`): lokal
22/22, 168/168, 25/25 grün — auf dem Server 16/22, 163/168, 24/25. Die Tests
schreiben die Umschrift des Entwicklerrechners als Erwartung fest. Ein dauerhaft
rotes Panel erzieht Redakteure dazu, es zu ignorieren, und entwertet damit genau
das Werkzeug, das Fehler melden soll.

## 2. Der Befund: was der Server wirklich tut

Nicht geraten, sondern **am Live-Bestand gemessen** — ohne Deploy, ohne Login,
über öffentliche Endpunkte:

* `GET /api/app/political-territory-wiki.php?limit=2000` liefert für 1384 Zeilen
  `name` + `wiki_url` + den **gespeicherten** `wiki_key`. Damit lässt sich jede
  Kandidatentabelle gegen den echten Bestand nachrechnen.
* `GET /api/app/adventures.php` liefert einen zweiten, unabhängigen Korpus
  (1352 Abenteuer, 2721 Ortsbezüge mit `target_wiki_key`).

Ergebnis des Differenzialtests über die 1384 Territorien:

| Hypothese für die Faltung | trifft | daneben |
|---|---:|---:|
| **Ligaturen + `?` für den Rest** | **1384** | **0** |
| lokal Windows (`ü` → `"u`) | 1198 | 186 |
| „Grundbuchstabe überlebt" (`ü` → `u`) | 1198 | 186 |

Die Regel ist damit eindeutig bestimmt — es ist **glibc-`iconv` in der
C-Locale**:

* **`æ` → `ae`, `œ` → `oe`** — die Ligaturtabelle (`C-translit.h`) greift.
  Beleg: `Horasiat Hældingard` → `wiki:horasiat-haeldingard`.
* **Alles andere Nicht-ASCII → ein `?`**, also *ein Trennzeichen, kein
  Buchstabe*. Akzentbuchstaben brauchen Locale-Regeln, die in der C-Locale nicht
  geladen sind, und fallen auf das Ersatzzeichen zurück. Belege:
  `Fürstentum Kosch` → `wiki:f-rstentum-kosch`,
  `Bergkönigreich Lorgolosch` → `wiki:bergk-nigreich-lorgolosch`,
  `Baronie Moorbrück` → `wiki:baronie-moorbr-ck`.
* **`ß` → `ss`** steht ohnehin schon als `str_replace` **vor** `iconv` und ist
  längst deterministisch.

Zwei unabhängige Gegenproben:

1. `territory-detail.php?wiki_key=wiki:f-rstentum-kosch` liefert Daten,
   `…?wiki_key=wiki:f-urstentum-kosch` liefert leer.
2. Im Repo listet `territories-read.php:1095` längst defensiv **beide** Formen
   (`'unabhangig', 'unabhngig'`, `'ungeklart', 'ungeklrt'`). Um diese Mine ist
   schon einmal jemand herumgebaut, ohne sie zu benennen.

### 2.1 Das vollständige Zeichenrepertoire

Ein dritter Abruf — `GET /api/app/map-features.php`, die gesamte öffentliche
Kartennutzlast mit Siedlungen, Regionen und Wegen — liefert das erschöpfende
Inventar: **45 verschiedene Nicht-ASCII-Zeichen** im gesamten Bestand.

Nach Häufigkeit: `→ ü ä ß ö` (Emoji) `· ô û Ü â` (Variantenselektor) `î „ “ á –
Ö é ï ú Ä í ÿ ’ ë ê — è` (NBSP) `à ó Ê` (LRM) `… ´ » « ° ‘ ŭ` sowie `æ` aus dem
Territorienkorpus.

**Der entscheidende Punkt:** Für *jedes* dieser Zeichen ist der Unterschied
zwischen „C-translit-Ausgabe" und „`?`" nach dem nachgelagerten `[^a-z0-9]+`
**unsichtbar** — `«`→`<<`, `…`→`...`, `→`→`->`, `–`→`-` sind allesamt
nicht-alphanumerisch und kollabieren zu genau einem Trennzeichen, exakt wie `?`.

Zwei Ausnahmen, und nur zwei:

* **`ß`** → `ss`. Steht bereits als expliziter `str_replace` **vor** `iconv`,
  ist also gar nicht betroffen.
* **`æ`** → `ae`. Gemessen (§2), und die einzige Stelle im gesamten Bestand, an
  der die Ligaturtabelle das Ergebnis tatsächlich verändert.

## 3. Die Entscheidung: Bestand erhalten, nicht umschreiben

**186 von 1384 Zeilen (13 %)** allein in `political_territory_wiki` tragen die
Faltung im Schlüssel. Dieselbe Quote zieht sich durch `political_territory`,
`wiki_territory_model` (1650 Zeilen), `political_territory_wiki_test`,
`wiki_publication_catalog`, `wiki_entity_publication`, `wiki_adventure_catalog`,
`adventure_place.target_wiki_key`, `lore_place.place_wiki_key` (899 eigene
Schlüssel) und `sources.wiki_key` — dazu die Selbstbezüge über `parent_wiki_key`.

Eine Migration würde also vierstellig viele Zeilen über rund zehn Tabellen in
einer Transaktion umschreiben, auf Shared Hosting, ohne Staging-Umgebung — für
rein kosmetisch schönere Schlüssel. Der Auftrag ist, eine stille Mine zu
entschärfen; das leistet die deterministische Tabelle in **beiden** Varianten
gleich gut.

> **Entschieden: Die Tabelle bildet die Server-Form nach. Kein Datenbestand
> ändert sich, Byte für Byte.**

Dass `wiki:f-rstentum-kosch` hässlich ist und Information verliert, kommt als
Kommentar an die Tabelle — nicht als Datenänderung. Wer später schönere
Schlüssel will, führt das als eigenes, bewusstes Migrationsprojekt durch; das
Prüfwerkzeug aus §6 liegt dann schon bereit.

## 4. Umbau

### 4.1 Eine Faltungsfunktion

Neu: `api/_internal/text/ascii-fold.php` mit

```php
function avesmapsFoldToAscii(string $value): string
```

Explizite Tabelle, kein `iconv`, keine Locale, keine Extension außer der ohnehin
verlangten `mbstring`.

**Der Korrektheitskern (aus §2.1):** Ein Eintrag in der Tabelle ist nur dann
ergebnisrelevant, wenn seine Ausgabe `[a-z0-9]` enthält — alles andere kollabiert
nachgelagert ohnehin zu einem Trennzeichen. Die Tabelle führt deshalb **genau die
lateinische Ligaturfamilie**:

```
ß → ss    æ/Æ → ae/AE    œ/Œ → oe/OE    ﬀ → ff    ﬁ → fi    ﬂ → fl
                                        ﬃ → ffi   ﬄ → ffl
```

Das ist die einzige alphanumerisch wirksame Familie mit einer eindeutigen,
implementierungsübergreifend gleichen ASCII-Entsprechung — und `æ` ist der
gemessene Beleg. **Jedes andere Nicht-ASCII-Zeichen → `?`.**

Bewusst *nicht* aufgenommen: Symbol-Umschriften wie `©→(C)` oder `½→ 1/2`. Sie
kommen im gesamten Bestand nicht vor (§2.1), ihre exakte glibc-Ausgabe ist ohne
Messung nicht sicher bekannt, und eine geratene Zeile in einer Tabelle, die
gerade *deshalb* existiert, weil Raten hier schiefgeht, wäre ein Widerspruch in
sich. Sollte je ein `½` in einem Namen auftauchen, liefert die Funktion `?`
statt ` 1/2` — eine bewusst hingenommene, dokumentierte Abweichung ohne
Bestandswirkung.

Groß-/Kleinschreibung: alle fünf Aufrufer rufen vorher `mb_strtolower()`, die
Großformen sind also nur Absicherung.

### 4.2 Fünf Aufrufstellen, je ein Einzeiler

| Stelle | Schema | Wirkung des Tauschs auf dem Server |
|---|---|---|
| `political/territory.php:1062` (`avesmapsPoliticalSlug`) | `wiki_key` | **die Mine** — Ausgabe identisch, Verhalten festgenagelt |
| `wiki/sync.php:248` (`…CreateMatchKeyInternal`) | `match_key` | **die zweite Mine** — dito |
| `political/territories-read.php:1112` (Wurzelschlüssel) | transient | dito |
| `political/wiki-browser-support.php:15` (`makeStableKey`) | transient | **No-op** — Umlaute sind dort schon explizit vorgebildet |
| `app/map-search.php:392` (Suchnormalisierung) | transient | **No-op** — dito |

Die letzten beiden bilden `ä/ö/ü` bereits vorher auf `ae/oe/ue` ab; `iconv` sieht
dort nur Restakzente, und für die ist `?` bereits heute das Ergebnis. Sie kommen
trotzdem mit, damit **kein** `iconv` im Haus bleibt: eine übrig gelassene Stelle
würde bei einem Bibliothekswechsel gegen die festgenagelten Stellen driften — die
Suche fände dann Dinge nicht mehr, die es gibt.

`territories-read.php:1095` behält **beide** Formen in seiner Liste. Sie schadet
nicht und kann Altbestände abdecken.

### 4.3 Reihenfolge im Aufrufer bleibt unangetastet

`str_replace('ß','ss')` läuft weiterhin **vor** der Faltung, ebenso die
Ligaturliste in `sync.php:246`. Der Tausch ersetzt ausschließlich den
`if (function_exists('iconv'))`-Block.

## 5. Tests

**Neu:** `tools/wikidump/test-ascii-fold.php` nagelt die Tabelle über das
vollständige Live-Repertoire aus §2 fest, plus die alphanumerisch relevanten
Sonderfälle aus §4.1. Er wird als elfter Eintrag in `api/edit/wiki/selftest.php`
eingehängt.

**Nachgezogen:** die umlautabhängigen Erwartungen in den drei roten Tests auf die
Server-Form — in `test-wiki-key-derivation.php` sind das exakt die sechs Fälle
b, f, h, q, r, u (daher 16/22), in `test-dump-entities.php` fünf, in
`test-dump-reader.php` einer.

Die „environment-dependent"-Banner in allen drei Dateien werden ersetzt: sie
stimmen nach dem Umbau nicht mehr. Der Banner druckt künftig die Ausgabe der
Faltung, nicht die von `iconv`, und benennt sie als deterministisch.

**Das Abnahmekriterium:** Das Panel steht auf **11/11 grün — lokal und auf dem
Server**, mit denselben Erwartungen. Genau das war vorher unmöglich.

## 6. Beweis, wiederholbar

`tools/wikidump/verify-live-key-parity.php` (Handwerkzeug, nicht im
Selbsttestsatz, weil es Netz braucht): holt den Territorienkorpus in **einer**
Anfrage, rechnet jeden `wiki_key` mit der neuen Faltung nach und meldet
Treffer/Abweichungen. Erwartung: `1384/1384`.

Damit versandet der Beweis aus §2 nicht in einem Chatverlauf, und eine spätere
Migration hat ihr Prüfinstrument schon.

⚠️ Einzelabruf, nie in einer Schleife (AGENTS.md §9, STRATO).

## 7. Was ausdrücklich nicht passiert

* Keine Datenmigration, kein Schema-Eingriff.
* Kein Eingriff in `html/editor-handbuch.html` — das macht die Nachtroutine
  (AGENTS.md §9); die Wirkung steht im Commit-Betreff.
* Keine Änderung an `ASSET_VERSION` — es ist reiner Server-Code, kein
  Editor-Asset.

## 8. Risiko

Gering und begrenzt, und das ist gemessen statt geschätzt:

* Die Ausgabe der neuen Funktion ist auf dem Server für **1384 von 1384**
  Live-Schlüsseln identisch mit der bisherigen.
* Das Zeichenrepertoire des gesamten öffentlichen Bestands ist **vollständig**
  erfasst (45 Zeichen, §2.1). Für 43 davon ist die Faltung ergebnisneutral, für
  `ß` greift der vorgelagerte `str_replace`, für `æ` die gemessene Ligaturzeile.
* Die beiden No-op-Stellen (§4.2) ändern nicht einmal lokal etwas am Endergebnis.

Das Restrisiko ist damit auf ein Zeichen reduziert, das heute nirgends vorkommt,
künftig auftaucht **und** von `C-translit` alphanumerisch abgebildet würde. Es
träfe dann einen neuen Schlüssel, keinen bestehenden — es kann keinen Join
brechen, nur einen Schlüssel etwas kürzer machen.
