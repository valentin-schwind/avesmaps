# Übergabe: die zwei Online-Phasen des Dump-Laufs unterbrechbar machen

> ✅ **ERLEDIGT 24.08.2026** (`43970a06`, `afca72d2`, `02fdc91d`, alle live). Beide Phasen haben
> ihren Cursor; das Aufrufbudget heißt jetzt `avesmapsWikiDumpOnlineStepCallBudget()` und gilt für
> **alle drei** Online-Phasen. Drossel und User-Agent unangetastet.
> **Offen ist nur noch die Abnahme:** der Klick des Owners auf „Dump holen" (§4).
>
> Vier Dinge, die beim Bauen dazukamen und im Entwurf noch nicht stehen:
> - 💣 **Die Bauwerks-Phase ist ZWEISTUFIG.** Ihre Arbeitsliste kommt selbst von der API
>   (`Bauwerk nach Art` → Unterkategorien) und kostet Abfragen. Stufe 1 löst die Artenliste auf,
>   Stufe 2 holt je Art die Mitglieder; die Weiche steht in `avesmapsWikiDumpHybridBuildingStage()`,
>   und eine **leere Liste wirft auf Stufe 1 zurück** — sonst meldet Stufe 2 mit null Arten sofort
>   `done` und überspringt sämtliche Bauwerke, lautlos.
> - 💣 **Der Upsert der Zustandstabelle behält jetzt je Spalte den ERSTEN Schreiber**
>   (`COALESCE(col, VALUES(col))`, vorher umgekehrt). Über eine Schrittgrenze hinweg kann der
>   Sammler „erster Typ gewinnt" nicht mehr selbst halten — der Feuersturm-Tempel steht in zwei
>   Kategorien. Solange die Phasen in einem Zug liefen, konnte das nie auffallen.
> - 💣 **Die eine `categorymembers`-Seite liegt in `sync.php`**, nicht bei einem der zwei Sammler:
>   `locations.php` und `settlements.php` laden einander **nicht**. Gewacht von
>   `api/_internal/wiki/__tests__/kategorie-seite-ladeweg-test.php` (zwei Halbzeiten in getrennten
>   Prozessen — in EINEM Prozess kann dieser Fehler grundsätzlich nicht auftreten).
> - 🪤 **Der erste Push fiel im Testtor um**, an genau diesem neuen Test: er gab seinem
>   Unterprozess `-d extension=php_mbstring.dll` mit. Das lokale Feld fährt Windows, das Tor
>   fährt **Linux**. Ein Test, der einen eigenen PHP-Prozess startet, darf keine
>   plattformabhängigen ini-Schalter festschreiben. Weil das Tor nichts hochlädt, mussten die
>   Dateien danach per `workflow_dispatch` (Voll-Deploy) nachgeliefert werden.
>
> 🔧 **Und ein Befund nebenan, BEWUSST nicht mitrepariert:** `override_deity` wird von niemandem
> gefüllt. Der Gottheiten-Upsert stand in der Klassen-Phase und las dort einen Schlüssel, den nur
> die **Kontinent**-Phase zurückgibt (`avesmapsWikiDumpCategoryFetchContinentMap()`); er hat immer
> 0 Zeilen geschrieben. Die tote Zeile ist weg, der Befund steht als 🪤 an
> `avesmapsWikiDumpHybridFillClassMapStep()`. Eigene Aufgabe — hier hätte sie den einen Klick,
> der diese Änderung abnimmt, mehrdeutig gemacht.

**Stand:** 24.08.2026, Abend. **Zustand:** „Dump holen" bricht mit **HTTP 502** ab.
**Aufgabe:** `online_class_map` und `online_building_map` bekommen einen Cursor.

---

## 1. Warum das jetzt kaputt ist

Das Wiki Aventurica hat uns am 24.08.2026 einen **eigenen Abschnitt in seiner robots.txt**
gegeben:

```
User-agent: AvesmapsWikiSync
Crawl-delay: 20
Disallow: /wiki/Spezial:  /skins/  /nogo/  /waerror/
```

`/de/api.php` fehlt darin und ist damit für uns **erlaubt** — für `User-agent: *` bleibt es
verboten. Der Preis: **20 Sekunden Abstand zwischen zwei Anfragen**
(`AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS`, `api/_internal/wiki/sync.php`).

Von den sieben Phasen des Laufs sind zwei **nicht unterbrechbar** — sie erledigen ihre
Kategorie-Abfragen in *einem* Schritt:

| Phase | Abfragen | bei 0,6 s (früher) | bei 20 s (heute) |
|---|---|---|---|
| `online_class_map` | ~12 (5 Kategorien mit Fortsetzung) | ~7 s | **~250 s** |
| `online_building_map` | ~25 (1 Unterkategorie-Abfrage + je Art eine) | ~15 s | **~500 s** |

Der Webserver gibt vorher auf → **502 Bad Gateway**. Das kommt *nicht* aus PHP, deshalb kann
auch der Abbruch-Melder nichts sagen: der Prozess wird eine Ebene höher abgeschossen.

⚠️ **Die Drossel ist nicht verhandelbar** — sie ist die Bedingung, unter der uns die API
überhaupt erlaubt ist. Wer sie senkt, um dieses Problem zu umgehen, wirft die Erlaubnis weg.

---

## 2. Was zu tun ist

Beide Phasen bekommen dasselbe Cursor-Muster, das die **Kontinent-Phase** bereits hat.
Abschreiben, nicht neu erfinden.

### Die Vorlage (funktioniert, live, getestet)

| Ebene | Datei | Funktion |
|---|---|---|
| Sammler | `api/_internal/wiki/dump-category-layer.php` | `avesmapsWikiDumpCategoryFetchContinentMap($titles, $cursor, $callBudget, $fetcher)` → `{map, deities, nextCursor, done}` |
| Treiber-Wrapper | `api/_internal/wiki/dump-hybrid-state.php` | `avesmapsWikiDumpHybridFillContinentMapStep(...)` |
| Dispatch + Cursor | `api/_internal/wiki/dump-hybrid-driver.php` | Zweig `online_continent_map`, Cursor in `stats['continent_cursor']` |
| Budget | `api/_internal/wiki/dump-hybrid-driver.php` | `avesmapsWikiDumpContinentMapStepCallBudget()` |

### Die zwei Baustellen

| | Sammler (`dump-category-layer.php`) | Wrapper (`dump-hybrid-state.php`) | Dispatch (`dump-hybrid-driver.php`) |
|---|---|---|---|
| Klassen | `avesmapsWikiDumpCategoryFetchSettlementClassMap()` | `avesmapsWikiDumpHybridFillClassMap()` (~Z. 413) | ~Z. 955 |
| Bauwerke | `avesmapsWikiDumpCategoryFetchBuildingTypeMap()` | `avesmapsWikiDumpHybridFillBuildingMap()` (~Z. 444) | ~Z. 959 |

Das Aufrufbudget je Schritt liefert `avesmapsWikiDumpContinentMapStepCallBudget()` — es rechnet
aus Drossel + Jitter + geschätzter Antwortzeit gegen `AVESMAPS_WIKI_DUMP_STEP_SECONDS` (28) und
ergibt bei 20 s Drossel genau **1 Aufruf je Schritt**. Für die neuen Phasen dieselbe Funktion
nehmen oder eine gleichgebaute; **keine feste Zahl** — genau daran ist es heute zerbrochen.

**Ergebnis danach:** ~12 + ~25 + ~18 Schritte à ~21 s, also rund 20 Minuten für einen vollen
Lauf — einmal im Monat, wenn der neue Dump da ist. In kleinen Häppchen statt in Blöcken.

---

## 3. Fallen — jede hat heute schon jemanden erwischt

💣 **Der Cursor muss ZWEI Dinge tragen.** Die Kontinent-Phase zählt nur Titel; die
Kategorie-Abfragen **paginieren selbst** (`cmcontinue`). Ein Cursor, der nur „welche Kategorie"
merkt, verliert die Fortsetzung mitten in einer großen Kategorie und fängt sie neu an — oder
überspringt sie. Beides fällt erst live auf, weil kleine Fixture-Kategorien nie paginieren.

💣 **Die Testläufe reichen PDO-Attrappen herein**, die den Elternkonstruktor nie aufrufen — an
denen wirft schon `getAttribute()`. Siehe `avesmapsWikiDumpHybridEnsureStateTable()`, wo die
Treiberfrage deshalb in `try/catch` steht.

💣 **Nichts für SQLite verbiegen.** `SHOW COLUMNS` ist MySQL-Sprache und bleibt es; der Test
springt über den Schritt, statt die Produktion herunterzuziehen (AGENTS.md §9).

💣 **Die Stapelgröße einmal je Lauf fragen, nicht je Runde** — sie hängt an der Anmeldung, und
ein Wechsel mitten im Lauf verschiebt den Cursor gegen die gezählten Aufrufe. Kommentar dazu
steht in `avesmapsWikiDumpCategoryFetchContinentMap`.

💣 **Der User-Agent `AvesmapsWikiSync` darf nicht umbenannt werden.** Genau diese Zeichenkette
steht in ihrer robots.txt; eine Version im Namen wirft uns zurück unter `*`, wo die API gesperrt
ist. Der Name ist eine Schnittstelle.

⚠️ **Das ganze Testfeld vor dem Push**, inklusive der 21 Dateien unter `tools/wikidump/`, die
weder in `__tests__` liegen noch auf `-test.php` enden — und mit `-d extension=php_pdo_sqlite.dll`,
sonst laufen die Fixture-Tests gar nicht erst an. Vorbestehend rot ist genau einer:
`linkcheck/link-url-test.php` (echter DNS-Abruf).

---

## 4. Verifikation

**Lokal nicht ausführbar** — der Lauf braucht angemeldete Sitzung, Datenbank und die Live-API.
Der Beweis ist der Klick des Owners auf **„Dump holen"**. Was dabei zu sehen sein muss:

1. Der Abruf ist sofort durch (`304`, kein 40-MB-Transfer).
2. Der Lauf geht durch alle Phasen, in vielen kleinen Schritten.
3. Die Statuszeile bleibt still — steht dort „Bot-Zugang abgelehnt", stimmt das Bot-Passwort nicht.

🔴 **Und wenn wieder etwas schiefgeht, sagt es diesmal seinen Namen:** gefangene Ausnahmen
nennen im Dump-Endpunkt Klasse, Grund, Datei und Zeile; PHP-Abbrüche meldet
`avesmapsRegisterFatalReporter()`. **Nur der 502 bleibt stumm** — der kommt vom Webserver, nicht
von PHP, und bedeutet immer dasselbe: ein Schritt lief zu lange.

---

## 5. Was heute sonst passiert ist (Kontext, nicht Aufgabe)

- **Zugang wiederhergestellt.** Wir hingen in `bot-trap` — ausgelöst durch unsere eigenen
  Wappen-Hotlinks auf `Spezial:Dateipfad` am 20.08. Der Betreiber hat die IP aus fail2ban und der
  htaccess-Sperrliste genommen und uns den robots.txt-Abschnitt gegeben.
- **Bot-Konto steht:** `Avesmaps` mit Bot-Recht, E-Mail bestätigt, Beobachtungsliste mit 17
  Infobox-Vorlagen, Benutzerseite mit `{{Bot-Hinweis}}`, Eintrag in `Wiki Aventurica:Roboter/Liste`.
  Bot-Passwort liegt in `api/config.local.php` **auf dem Server** (nicht im Checkout).
- **Login ist gebaut** und trägt `apihighlimits`: 500 statt 50 Titel je Anfrage. Ohne ihn wäre die
  Kontinent-Phase bei 20 s Drossel über eine Stunde lang — der Login ist tragend, nicht nur nett.
- **Behoben unterwegs:** fehlende Spalte `override_deity` (self-healing Spalten), Dump-Takt
  monatlich statt täglich samt `If-Modified-Since`, sprechende Fehlermeldungen.
- **Offen beim Betreiber:** `categorylinks`-Export („schaue ich mir an"), Cargo (später).
- **Vorgemerkt zum 1. September:** der erste Dump mit Datei- (ns 6) und Inoffiziell-Namensraum
  (ns 222). Erster Handgriff dann ist eine **Messung** der Namensraum-Zahlen, kein Code — und die
  `is_official`-Falle: sie steht fest auf 1, solange nur ns 0 hereinkam.
