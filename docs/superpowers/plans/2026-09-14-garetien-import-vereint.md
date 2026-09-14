# Garetien-Importer vereint — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe umzusetzen.
> Die Schritte tragen Checkboxen (`- [ ]`) zur Nachverfolgung.

**Ziel:** Der Garetien-Importer wird ein Werkzeug mit **einer** Regel — auf „Offen" wird entschieden,
auf der Stage eingestellt, nur der Fußknopf schreibt —, und der schon gebaute Verbund (Fragmente zu
einer Fläche zusammenlegen) wird darin richtig: erkannt ohne Fehltreffer, zusammengelegt nur auf der
Stage, gezählt als das, was entsteht, und zurücknehmbar ohne Waisen.

**Architektur:** Server und Client bleiben, wie sie geschnitten sind. Der Server lernt, den Stamm als
Namen zu setzen, einen gescheiterten Anführer aufzuräumen und „Neu + Ergänzung desselben Objekts" nur mit
ausdrücklicher Bestätigung anzunehmen. Der Client ersetzt zwei widersprüchliche Häkchen durch **eine
Zielwahl**, führt die Verbund-Entscheidung **am Stage-Eintrag** statt in einem losen `Set`, filtert die
Stage selbst und gliedert die Einzelansicht in sieben Blöcke. Keine neue Tabelle, kein neuer Endpunkt,
`entity_key` bleibt je Garetien-Zeile.

**Tech-Stack:** PHP 8 (strict types, PDO) · Vanilla JS ohne Build · CSS-Tokens ·
Assert-Tests (`php -d zend.assertions=1`) und `node <test>.js`.

**Entwurf:** `docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md`
**Mockup:** `docs/garetien-import-vereint-mockup.html`
**Vorgänger, deren Stand dieser Plan voraussetzt:** `docs/superpowers/plans/2026-09-09-garetien-fragmente-verbund.md`
(Aufgaben 1–10 gebaut; seine Aufgabe 11 geht in Aufgabe 11 dieses Plans auf) ·
Workflow-Befunde `docs/superpowers/plans/2026-09-12-garetien-importer-befunde.md`

## Globale Randbedingungen

- **Arbeitsort:** der Zweig `garetien-fragmente-verbund` in **seinem eigenen Worktree**, nie der geteilte
  Hauptcheckout `C:\GIT\avesmaps` — der trägt fremde, unfertige Arbeit anderer Sitzungen.
- **Abbau-Vertrag:** Nichts außerhalb von `api/_internal/import/` und `js/review/review-garetien-*.js`
  darf `garetien_import_row` oder `garetien_import_run` kennen. Gewacht von
  `api/_internal/import/__tests__/garetien-abbau-waechter-test.php`.
- **Keine neue Tabelle, kein neuer Endpunkt, kein neuer `change_type`.** Neu ist genau ein
  `error.code`: `garetien_beides_unbestaetigt` (Aufgabe 8), im Envelope
  `{ "ok": false, "error": { "code": …, "message": … } }`.
- **`entity_key` bleibt je Garetien-Zeile.** Vier Fragmente = vier Schlüssel = vier `sync_decision`-Zeilen.
- **Kommentare, Commit-Nachrichten und Doku auf DEUTSCH** (AGENTS.md §8); `error.code`-Werte englisch.
- **Jeden Bezeichner am echten Code nachprüfen**, bevor er benutzt wird. Die Zeilenangaben in diesem Plan
  galten am 14.09.2026 auf `df8d9ec4c` und verrutschen mit jeder Aufgabe.
- **Tests führen den Code AUS.** JS über `js/review/__tests__/helfer/garetien-testumgebung.js`
  (`ladeImporter`), PHP über die SQLite-Prüfstände der Garetien-Tests. Eine Zusicherung, die nur Quelltext
  per Regex liest, war im Vorgänger-Plan **viermal** ein Vakuum.
- ⚠️ **SQLite kennt MySQL-Einschränkungen nicht** (Error 1093; DDL beendet eine Transaktion implizit).
  Geht beides nicht, gilt MySQL, und ein Kommentar an der Stelle sagt warum (AGENTS.md §9).
- **Kein `mb_*` im Schreibweg** — ohne mbstring ist das ein Fatal mit leerem Rumpf.
- **CSS kommt zeichengleich aus dem Mockup**; die VERTRAG-Marken setzt der Commit, der die Regel baut.
  Eine Marke auf ungebautem CSS macht `tools/mockup-vertrag` im Deploy-Tor rot.
- **Commit-Nachricht immer per Heredoc mit gequotetem Begrenzer** (`git commit -F- <<'EOF'`), nie `-m` —
  Backticks in `-m` sind Kommando-Substitution und nach dem Push nicht mehr zu reparieren.
- **Nur eigene Pfade stagen**, einzeln. Nie `git add -A`, `git add .`, `git commit -a`.
- 🔴 **Aufträge an Sub-Agenten verbieten `git checkout`, `git stash`, `git restore`, `git reset`.** Im
  Vorgänger-Plan haben Bauer das zweimal trotzdem getan.
- **PHP-Tests brauchen die Erweiterungen**, sonst melden 45 Tests falsch rot:
  `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll <test>`
- **Vor jedem Push das GANZE Testfeld, nach dem Muster des Workflows, parallel.** 💣 Die äußere Klammer um
  beide Gruppen ist tragend — ohne sie fährt `find` nur die zweite Gruppe und meldet „null rot":
  ```bash
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > rot-js.txt
  find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
  find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > rot-php.txt
  ```
  Die Dateizahlen gegen den Workflow gegenzählen (14.09.2026: 553 JS, 411 PHP). Vorbestehend rot:
  `api/_internal/linkcheck/__tests__/link-url-test.php` (echter DNS-Abruf). In einer CRLF-Arbeitskopie
  zusätzlich `js/review/__tests__/quellen-abdeckung-ziel.test.js` — mit LF grün, kein Befund.
- **Sichtbare Oberflächenänderungen gehen EINZELN live** (AGENTS.md §9): ein Commit bzw. eine Aufgabe, ein
  Push, der Blick des Owners, dann die nächste. Sichtbar sind die Aufgaben **4, 5, 7, 9, 10, 11, 12**.
- **Vor dem Push `gh run list --limit 3` lesen** — ein `in_progress` und ein `pending` heißen warten; ein
  zweiter Push ersetzt den wartenden Lauf, und dessen Dateien lädt nie jemand hoch.
- **Nach jedem Push, der die Karte berührt:** die Live-Seite **als Besucher** laden (ohne `edit=1`) und die
  Konsole lesen.

---

## Dateiübersicht

| Datei | Verantwortung | Aufgaben |
|---|---|---|
| `api/_internal/import/garetien-verbund.php` | reine Erkennung: Marke, Stamm, Gruppen | 1 |
| `api/_internal/import/garetien-plan.php` | Planbau: Urteil an die Erkennung, `verbund_n` je Gruppe, Name = Stamm | 1, 2 |
| `api/_internal/import/garetien-uebernahme.php` | Anführer/Teil, Aufräumen, Wiki an der Region, Quelle bis zur letzten Fläche, Riegel „beides", „Nur Quelle" | 2, 3, 8 |
| `api/_internal/import/garetien-liste.php` | Faltung laufübergreifend, Filter „nur Verbünde" | 4, 5 |
| `api/edit/wiki/sync-plan.php` | die Tür des Imports: Riegel-Antwort | 8 |
| `api/_internal/import/garetien-wiki-nachzug.php` | **neu** — der Bestandslauf: Auswahl, Urteil, Trockenlauf, Schreiben über den Hausschreiber | 13 |
| `api/edit/map/garetien-import.php` | Admin-Aktion `wiki_nachzug` | 13 |
| `js/review/review-garetien-importer.js` | Stage-Filter, Verbund am Stage-Eintrag, Offen-Knopf, Zählung, Zielwahl, Vorschlag, Blöcke, Leisten | 4–7, 9–12 |
| `css/components/garetien-importer.css` | `.gi-ziel*`, `.gi-insert__row--aus` (9) · `.gi-block*` (11) · `.gi-ziel-marke`, `.gi-listkopf*` (12) | 9, 11, 12 |
| `index.html` | Fußleiste ohne „Alle wählen" | 12 |
| `docs/garetien-import-vereint-mockup.html` | je eine VERTRAG-Marke um die Regeln, die eine Aufgabe baut | 9, 11, 12 |

## Reihenfolge

| # | Aufgabe | Seite | sichtbar | setzt voraus |
|---|---|---|---|---|
| 1 | Erkennung korrigieren | Server | — | — |
| 2 | Name = Stamm, Wiki-Schlüssel an der Region | Server | — | 1 |
| 3 | Anführer räumt auf; Quelle fällt mit der letzten Fläche | Server | — | 2 |
| 4 | „Übernommen" faltet laufübergreifend | Server + Client | ja | 1 |
| 5 | Suche und Filter auf der Stage; „nur Verbünde" | Client (+ Liste) | ja | 1 |
| 6 | Der Verbund lebt am Stage-Eintrag | Client | — | 5 |
| 7 | Offen: ein Knopf; Zusammenlegen nur in Block B; Zählung | Client | ja | 6 |
| 8 | Zielwahl im Server: Riegel „beides", „Nur Quelle + Artikel" | Server | — | 3 |
| 9 | Zielwahl im Client | Client | ja | 7, 8 |
| 10 | Offen ohne Einstellfelder | Client | ja | 9 |
| 11 | Die Einzelansicht in sieben Blöcken | Client + CSS | ja | 10 |
| 12 | Liste und Leisten | Client + CSS + `index.html` | ja | 11 |
| 13 | Der Bestand: Wiki-Schlüssel an importierten Flächen nachziehen | Server (Admin-Lauf) | — | 2 |

⚠️ **Gekoppelt, aus dem Bau der Entwürfe:** Aufgabe 6 und 7 gehen nur **gemeinsam** live (nach 6 allein legt
der alte Knopf „Verbund auf die Stage" nichts mehr auf) · Aufgabe 8 geht **nie vor** 9 live (der heutige
Client schickt bei „Neu einfügen" an einem Deckungsfall Zusatz + Ergänzung ohne `beides` → 422) · der
**Lauf** aus Aufgabe 13 erst, wenn Aufgabe 2 und 13 live sind.

---

## Aufgabe 1: Erkennung korrigieren

**Deckt Entwurf §6.1 ab** (Fehler 2, 3, 4, 5 aus §1). Innenumbau — kein Blick nötig.

- 💣 **`strtoupper` kennt in PHP 8 nur ASCII:** aus „Süd" wird „SüD", die Liste `AVESMAPS_GARETIEN_VERBUND_HIMMEL` führt „SÜD". Gehoben wird mit `strtr` vor dem `strtoupper`, **nie** mit `mb_strtoupper` (Fatal ohne mbstring). Fundstelle `garetien-verbund.php`, `avesmapsGaretienVerbundMarke` (~:32).
- 🔴 **Der Urteils-Filter braucht ZWEI Durchgänge im Planbau.** `avesmapsGaretienBaueSyncPlan` (`garetien-plan.php` ~:1602–1700) rief die Erkennung bisher VOR dem Abgleich über Zeilen, deren SELECT `urteil` nie liest — der Filter war dort tot. Jetzt: erst jede Zeile beurteilen und das Urteil schreiben, dabei `$benannt[$index]['urteil'] = $urteil['status']` setzen, DANN Verbünde erkennen, DANN Items bauen. Wer die Durchgänge wieder zusammenlegt, macht den Filter wieder tot (Abschnitt N fängt das, Mutationsprobe M4).
- ⚠️ **Ausgeschlossen werden `deckt_sich` UND `uebersprungen`** (`AVESMAPS_GARETIEN_VERBUND_URTEILE_AUS`). Der Vertrag nennt nur `deckt_sich`; der Entwurf §6.1 sagt „nur erzeugende Zeilen (neu/widerspricht/zweifel)", und ein vom Abgleich übersprungenes Fragment erzeugt nichts, blähte aber `verbund_n` auf. Eine Zeile **ohne** `urteil`-Feld zählt weiter mit („nicht beurteilt" ist nicht „deckt sich").
- 🔴 **Eine Rechnung, zwei Sichten.** Stamm (für den Namen) und Gruppenschlüssel (für `verbund_n`) kommen aus derselben internen Funktion `avesmapsGaretienVerbundMitglieder` — zwei Schleifen liefen beim nächsten Filter auseinander. Die zwei öffentlichen Namen aus dem Vertrag bleiben.
- ⚠️ **Ein Einzelbuchstabe ist keine Marke mehr — aber N, S, O, W, M (Himmelsrichtung) und I, V, X (römisch) bleiben es**, sie stehen in ihren Listen und werden vorher gefragt. „Pfad M" und „Pfad X" bleiben also Verbund-Kandidaten.
- ⚠️ Die Warnungen `Undefined array key "anlass"` beim Testlauf sind vorbestehend (Abschnitt H des Tests baut ein Urteil ohne `anlass`) und kein Signal.
- **Bestand:** Keiner betroffen. `verbund_stamm`/`verbund_n` entstehen nur in einem neuen Planlauf; der Verbund-Zweig war nie live, kein live gebautes `after_json` trägt die Felder. Die Urteilsspalte `garetien_import_row.urteil` wird wie bisher je Zeile geschrieben (Abschnitt N prüft es).

**Dateien:**
- Ändern: `api/_internal/import/garetien-verbund.php` (`avesmapsGaretienVerbundMarke` ~:32, `avesmapsGaretienVerbuende` ~:103)
- Ändern: `api/_internal/import/garetien-plan.php` (`avesmapsGaretienBaueSyncPlan` ~:1602–1700)
- Test: `api/_internal/import/__tests__/garetien-verbund-test.php`

**Schnittstellen:**
- Nutzt: `avesmapsGaretienUeberspringGrund(array $zeile): ?string` (garetien-abgleich.php:414), `avesmapsGaretienMappeTyp(string $typ): ?array`, `avesmapsGaretienVerbundStamm(string $name): array`, `avesmapsGaretienFindeBestand(PDO, array $zeile, array $ziel): array`, `avesmapsGaretienPlanTestPdo(): PDO`, `avesmapsGaretienKandidatenVergessen(): void`
- Liefert: `avesmapsGaretienVerbundMarke(string $stueck): ?string` (nie mehr `'buchstabe'`) · `avesmapsGaretienVerbuende(array $zeilen): array<int,string>` (Index → Stamm) · NEU `avesmapsGaretienVerbundGruppen(array $zeilen): array<int,string>` (Index → `ebene|typ|stamm`) · intern NEU `avesmapsGaretienVerbundMitglieder(array $zeilen): array<int,array{stamm:string,gruppe:string}>` · Konstante `AVESMAPS_GARETIEN_VERBUND_URTEILE_AUS = ['deckt_sich', 'uebersprungen']`
- Zeilenfeld: `$zeile['urteil']` = Status des Abgleichs (dieselbe Bedeutung wie die Spalte `garetien_import_row.urteil`)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

In `api/_internal/import/__tests__/garetien-verbund-test.php` den Docblock der Hilfsfunktion `verbundZeile` (Zeilen 10–12) ersetzen:

```php
 * ⚠️ OHNE `urteil`-Feld -- eine unbeurteilte Zeile zaehlt mit. Den Urteils-Filter (nie
 * `deckt_sich`) pruefen die Faelle L und N; den Uebersprung-Filter Fall G. Ohne `geo_art`/`geo`
 * gilt eine Zeile als platziert (avesmapsGaretienZeilePunkte liefert dann [], und [] gilt als
 * "auf der Karte").
```

(ersetzt die drei Zeilen, die mit ` * ⚠️ Kein `urteil`-Feld mehr -- der Filter fragt avesmapsGaretienUeberspringGrund() und liest` beginnen).

Dann VOR der letzten Zeile `echo "OK -- garetien-verbund\n";` einfügen:

```php
// =================================================================================================
// J. DIE HIMMELSRICHTUNG IN JEDER SCHREIBUNG (Entwurf 14.09.2026, Fehler 2)
// =================================================================================================
// 💣 `strtoupper('Süd')` ergibt `SüD` -- PHP 8 kennt dort nur ASCII, und die Liste fuehrt `SÜD`.
// „Farindel Nord" wurde erkannt, „Farindel Süd" nicht; die zwei Fragmente fielen in zwei Stamm-
// Gruppen, und jede hatte nur EIN Mitglied -- also gar kein Verbund.
assert(avesmapsGaretienVerbundMarke('Süd') === 'himmelsrichtung', 'J: "Süd" ist eine Himmelsrichtung');
assert(avesmapsGaretienVerbundMarke('süd') === 'himmelsrichtung', 'J: klein geschrieben ebenso');
assert(avesmapsGaretienVerbundMarke('SÜD') === 'himmelsrichtung', 'J: gross geschrieben ebenso');
assert(avesmapsGaretienVerbundMarke('Sued') === 'himmelsrichtung', 'J: und umschrieben ebenso');
assert(avesmapsGaretienVerbundStamm('Farindel Süd') === ['Farindel', 'Süd', 'himmelsrichtung'],
    'J: der Stamm von "Farindel Süd": ' . json_encode(avesmapsGaretienVerbundStamm('Farindel Süd'), JSON_UNESCAPED_UNICODE));
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Farindel Nord'),
    verbundZeile('Waelder', 'Wald', 'Farindel Süd'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [0 => 'Farindel', 1 => 'Farindel'],
    'J: Nord und Süd bilden EINEN Verbund: ' . json_encode(avesmapsGaretienVerbuende($zeilen), JSON_UNESCAPED_UNICODE));

// =================================================================================================
// K. EIN EINZELBUCHSTABE IST KEINE MARKE (Fehler 3)
// =================================================================================================
// „Pfad A" und „Pfad B" sind zwei Pfade, kein Verbund „Pfad" -- Verbund-Entwurf §3 schliesst genau
// das aus. ⚠️ Die Himmelsrichtungen N/S/O/W/M und die roemischen Ziffern I/V/X bleiben Marken: sie
// stehen in ihren Listen und werden VOR dem (weggefallenen) Buchstaben-Fall gefragt.
assert(avesmapsGaretienVerbundMarke('A') === null, 'K: "A" ist keine Marke');
assert(avesmapsGaretienVerbundMarke('b') === null, 'K: "b" ist keine Marke');
assert(avesmapsGaretienVerbundMarke('N') === 'himmelsrichtung', 'K: Gegenprobe -- "N" bleibt eine Himmelsrichtung');
assert(avesmapsGaretienVerbundMarke('V') === 'roemisch', 'K: Gegenprobe -- "V" bleibt eine roemische Ziffer');
assert(avesmapsGaretienVerbundMarke('1a') === 'zahl+buchstabe', 'K: Gegenprobe -- "1a" bleibt Zahl mit Buchstabe');
assert(avesmapsGaretienVerbundStamm('Pfad A') === ['Pfad A', null, 'ohne'],
    'K: "Pfad A" hat keine Marke: ' . json_encode(avesmapsGaretienVerbundStamm('Pfad A')));
$zeilen = [
    verbundZeile('Wege', 'Pfad', 'Pfad A'),
    verbundZeile('Wege', 'Pfad', 'Pfad B'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'K: "Pfad A" und "Pfad B" sind kein Verbund');

// =================================================================================================
// L. NUR ERZEUGENDE ZEILEN SIND MITGLIED -- nie `deckt_sich` (Fehler 5, Verbund-Owner 09.09./2)
// =================================================================================================
// 🔴 Das Feld `urteil` traegt den STATUS des Abgleichs (dieselbe Bedeutung wie die Spalte
// `garetien_import_row.urteil`). Die Aufrufstelle im Planbau setzt es seit diesem Umbau VOR der
// Erkennung -- vorher las ihr SELECT es nie, und der Filter war dort tot.
$mitUrteil = static fn(string $ebene, string $typ, string $anzeige, string $urteil): array
    => verbundZeile($ebene, $typ, $anzeige) + ['urteil' => $urteil];
$zeilen = [
    $mitUrteil('Waelder', 'Wald', 'Silker Hain 1', 'neu'),
    $mitUrteil('Waelder', 'Wald', 'Silker Hain 2', 'deckt_sich'),
    $mitUrteil('Waelder', 'Wald', 'Silker Hain 3', 'zweifel'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [0 => 'Silker Hain', 2 => 'Silker Hain'],
    'L: das deckende Fragment ist KEIN Mitglied, die zwei erzeugenden schon: ' . json_encode(avesmapsGaretienVerbuende($zeilen)));
$zeilen = [
    $mitUrteil('Wege', 'Pfad', 'Alkenstieg', 'deckt_sich'),
    $mitUrteil('Wege', 'Pfad', 'Alkenstieg 2', 'neu'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [],
    'L: bleibt nach dem Filter nur EIN erzeugendes Fragment, ist es kein Verbund');
$zeilen = [
    $mitUrteil('Waelder', 'Wald', 'Grenzwald 1', 'widerspricht'),
    $mitUrteil('Waelder', 'Wald', 'Grenzwald 2', 'uebersprungen'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [],
    'L: ein vom Abgleich uebersprungenes Fragment erzeugt nichts und zaehlt ebenso wenig');

// =================================================================================================
// M. DIE GRUPPE IST EBENE + TYP + STAMM -- und verbund_n zaehlt JE GRUPPE (Fehler 4)
// =================================================================================================
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Silker Hain 1'),
    verbundZeile('Waelder', 'Wald', 'Silker Hain 2'),
    verbundZeile('Berge', 'Huegel', 'Silker Hain 1'),
    verbundZeile('Berge', 'Huegel', 'Silker Hain 2'),
    verbundZeile('Berge', 'Huegel', 'Silker Hain 3'),
];
$gruppen = avesmapsGaretienVerbundGruppen($zeilen);
assert($gruppen === [
    0 => 'Waelder|Wald|Silker Hain', 1 => 'Waelder|Wald|Silker Hain',
    2 => 'Berge|Huegel|Silker Hain', 3 => 'Berge|Huegel|Silker Hain', 4 => 'Berge|Huegel|Silker Hain',
], 'M: Zeilenindex -> Gruppenschluessel: ' . json_encode($gruppen, JSON_UNESCAPED_UNICODE));
assert(array_count_values($gruppen) === ['Waelder|Wald|Silker Hain' => 2, 'Berge|Huegel|Silker Hain' => 3],
    'M: je Gruppe gezaehlt, nicht je Stamm (das waeren 5 und 5)');
assert(array_keys(avesmapsGaretienVerbuende($zeilen)) === array_keys($gruppen),
    'M: beide Funktionen nennen DIESELBEN Mitglieder -- eine Regel, zwei Sichten');
assert(avesmapsGaretienVerbundGruppen([verbundZeile('Wege', 'Pfad', 'Pfad A')]) === [],
    'M: ohne Verbund eine leere Zuordnung');

// =================================================================================================
// N. DIE AUFRUFSTELLE -- avesmapsGaretienBaueSyncPlan WIRKLICH gefahren
// =================================================================================================
// 💣 Die reinen Faelle darueber waren schon einmal gruen, waehrend der Filter an der echten
// Aufrufstelle tot war (der SELECT las `urteil` nie). Deshalb baut dieser Abschnitt einen ganzen
// Plan auf dem geteilten Pruefstand und liest die Items.
$pdoN = avesmapsGaretienPlanTestPdo();
$zeileN = $pdoN->prepare("INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)
                          VALUES (1, 'ggp', ?, ?, ?, '', '', ?, '', '', '', 'koordinaten', ?, '')");
$ringN = static fn(int $x): string => $x . ' -12000, ' . ($x + 800) . ' -12700, ' . ($x + 200) . ' -13400, ' . $x . ' -12000';
// Zwei Wald-Fragmente und drei Huegel-Fragmente DESSELBEN Stamms -- zwei Gruppen.
$zeileN->execute(['Waelder', 101, 'Wald', 'Silker Hain 1', $ringN(5000)]);
$zeileN->execute(['Waelder', 102, 'Wald', 'Silker Hain 2', $ringN(9000)]);
$zeileN->execute(['Berge', 103, 'Huegel', 'Silker Hain 1', $ringN(13000)]);
$zeileN->execute(['Berge', 104, 'Huegel', 'Silker Hain 2', $ringN(17000)]);
$zeileN->execute(['Berge', 105, 'Huegel', 'Silker Hain 3', $ringN(21000)]);
// „Alke" (zeile_nr 1 des Pruefstands) deckt sich mit dem Bestandsfluss `vorhanden-1`. „Alke 2"
// liegt weit weg -- ohne den Filter waeren beide ein Verbund „Alke".
$zeileN->execute(['Gewaesser', 106, 'Bach', 'Alke 2', '95000 -45000, 96000 -46000, 97000 -47000']);
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdoN, 1, 7);
$itemsN = $pdoN->query('SELECT label, after_json FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$nachLabelN = static function (array $items, string $beginn): array {
    $raus = [];
    foreach ($items as $item) {
        if (str_starts_with((string) $item['label'], $beginn)) {
            $raus[] = json_decode((string) $item['after_json'], true);
        }
    }

    return $raus;
};
$waldN = $nachLabelN($itemsN, 'Silker Hain 1 (Wald)');
$huegelN = $nachLabelN($itemsN, 'Silker Hain 1 (Huegel)');
assert(count($waldN) === 1 && count($huegelN) === 1,
    'N (Testaufbau): je ein Item fuer das Wald- und das Huegel-Fragment: ' . json_encode(array_column($itemsN, 'label'), JSON_UNESCAPED_UNICODE));
assert(($waldN[0]['verbund_stamm'] ?? null) === 'Silker Hain' && ($waldN[0]['verbund_n'] ?? null) === 2,
    'N: der Wald-Verbund zaehlt ZWEI (seine Gruppe), nicht fuenf (den Stamm): ' . json_encode($waldN[0], JSON_UNESCAPED_UNICODE));
assert(($huegelN[0]['verbund_n'] ?? null) === 3,
    'N: der Huegel-Verbund zaehlt DREI: ' . json_encode($huegelN[0]['verbund_n'] ?? null));
$alkeZweiN = $nachLabelN($itemsN, 'Alke 2');
assert($alkeZweiN !== [], 'N (Testaufbau): "Alke 2" bekommt Items');
foreach ($alkeZweiN as $nachAlke) {
    assert(!array_key_exists('verbund_stamm', $nachAlke),
        'N: "Alke 2" ist KEIN Verbund-Mitglied -- sein einziges Geschwister deckt sich mit unserem Fluss: '
        . json_encode($nachAlke, JSON_UNESCAPED_UNICODE));
}
foreach ($nachLabelN($itemsN, 'Alke') as $nachAlke) {
    assert(!array_key_exists('verbund_stamm', $nachAlke),
        'N: und die Ergaenzungs-Items der deckenden „Alke" tragen ebenso keinen Verbund');
}
// Das Urteil steht nach dem Umbau weiterhin an JEDER Zeile -- die zwei Durchgaenge duerfen das
// Schreiben nicht verlieren.
$urteilAlkeN = $pdoN->query("SELECT urteil FROM garetien_import_row WHERE anzeige = 'Alke'")->fetchColumn();
assert($urteilAlkeN === 'deckt_sich', 'N: das Urteil der Zeile wird weiterhin geschrieben: ' . var_export($urteilAlkeN, true));
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll api/_internal/import/__tests__/garetien-verbund-test.php
```
Erwartet (im Wegwerf-Worktree gesehen): `PHP Fatal error:  Uncaught AssertionError: J: "Süd" ist eine Himmelsrichtung in …garetien-verbund-test.php` (davor drei vorbestehende Warnungen `Undefined array key "anlass"`).

- [ ] **Schritt 3: Umsetzen**

**3a.** In `api/_internal/import/garetien-verbund.php` die ganze Funktion `avesmapsGaretienVerbundMarke` (samt ihrer Einzeilen-Docblock-Zeile `/** Ist dieses Zeichen-Stueck eine Ordnungsmarke, und welcher Art? */`) ersetzen durch:

```php
/**
 * Die Urteile des Abgleichs, deren Zeile NIE Mitglied eines Verbunds ist.
 *
 * 🔴 NUR ERZEUGENDE ZEILEN (Verbund-Owner 09.09.2026/2): ein Fragment, das sich mit einem Objekt
 * von uns DECKT, bleibt eine Quelle an diesem Objekt und wird nicht Teil einer neuen Flaeche.
 * `uebersprungen` erzeugt gar nichts -- mitgezaehlt blaehte es nur `verbund_n` auf.
 */
const AVESMAPS_GARETIEN_VERBUND_URTEILE_AUS = ['deckt_sich', 'uebersprungen'];

/** Ist dieses Zeichen-Stueck eine Ordnungsmarke, und welcher Art? */
function avesmapsGaretienVerbundMarke(string $stueck): ?string
{
    // 💣 UMLAUTFEST, OHNE mb_*. `strtoupper` kennt in PHP 8 nur ASCII: aus „Süd" wurde „SüD", die
    // Liste fuehrt „SÜD", und „Farindel Süd" fiel aus seinem Verbund (Entwurf 14.09.2026, Fehler 2).
    // Die drei Umlaute werden VOR dem Hochsetzen von Hand gehoben; ein `mb_strtoupper` waere ohne
    // mbstring ein Fatal mit leerem Rumpf.
    $gross = strtoupper(strtr($stueck, ['ü' => 'Ü', 'ö' => 'Ö', 'ä' => 'Ä']));
    if (preg_match('/^\d{1,3}$/', $stueck) === 1) {
        return 'zahl';
    }
    if (preg_match('/^\d{1,3}[a-zA-Z]$/', $stueck) === 1) {
        return 'zahl+buchstabe';
    }
    if (in_array($gross, AVESMAPS_GARETIEN_VERBUND_ROEMISCH, true)) {
        return 'roemisch';
    }
    if (in_array($gross, AVESMAPS_GARETIEN_VERBUND_HIMMEL, true)) {
        return 'himmelsrichtung';
    }
    // 🔴 KEIN EINZELBUCHSTABE (Fehler 3). „Pfad A" und „Pfad B" sind zwei Pfade, kein Verbund
    // „Pfad" -- Verbund-Entwurf §3 schliesst genau das aus. Die Buchstaben, die eine Ordnung
    // tragen (N, S, O, W, M, I, V, X), stehen in den zwei Listen darueber und sind dort schon gefragt.

    return null;
}
```

**3b.** In derselben Datei die ganze Funktion `avesmapsGaretienVerbuende` samt ihrem Docblock (ab `/**` über ` * Welche Zeilen gehoeren zu einem Verbund?` bis zum Dateiende) ersetzen durch:

```php
/**
 * Die Mitglieder aller Verbuende -- die EINE Rechnung hinter avesmapsGaretienVerbuende und
 * avesmapsGaretienVerbundGruppen.
 *
 * 💣 EIN FRAGMENT OHNE MARKE GEHOERT DAZU, wenn ein Geschwister eine traegt: 20 der 22
 * Wege-Verbuende sind `Alkenstieg` + `Alkenstieg 2`. Deshalb wird ZUERST nach Stamm gruppiert
 * und ERST DANN gefragt, ob die Gruppe ueberhaupt eine Marke enthaelt.
 * 💣 Doppelte Marken (`SO, SO, NW`) und Luecken (`2, 5, 7`) sind normal -- es wird NICHT
 * gezaehlt, ob 1..n vollstaendig ist.
 * 🔴 ZWEI OEFFENTLICHE SICHTEN, EINE RECHNUNG. Der Stamm (fuer den Namen) und der Gruppenschluessel
 * (fuer `verbund_n`) kommen aus DERSELBEN Schleife -- zwei Schleifen liefen beim naechsten Filter
 * auseinander, und dann zaehlte `verbund_n` Zeilen, die gar nicht Mitglied sind.
 *
 * @param list<array<string,mixed>> $zeilen benannte Zeilen, optional mit `urteil` (Status des Abgleichs)
 * @return array<int,array{stamm:string,gruppe:string}>
 */
function avesmapsGaretienVerbundMitglieder(array $zeilen): array
{
    $gruppen = [];
    foreach ($zeilen as $i => $zeile) {
        // Dieselbe EINE Instanz, die auch der Hauptlauf fragt (avesmapsGaretienUeberspringen) --
        // eine zweite Wahrheit ueber „wird uebersprungen" liefe beim naechsten Grund auseinander.
        if (avesmapsGaretienUeberspringGrund($zeile) !== null) {
            continue;
        }
        // 🔴 NUR ERZEUGENDE ZEILEN (Entwurf 14.09.2026, Fehler 5). Das Feld `urteil` setzt die
        // Aufrufstelle avesmapsGaretienBaueSyncPlan seit diesem Umbau AUS DEM ABGLEICH, bevor sie
        // hierher fragt. 💣 Bis dahin las ihr SELECT die Spalte nie, und der Filter war an genau
        // dieser Stelle tot -- wer die zwei Durchgaenge dort wieder zusammenlegt, macht ihn wieder tot.
        // ⚠️ Eine Zeile OHNE `urteil` zaehlt mit: die reinen Faelle kennen kein Urteil, und „nicht
        // beurteilt" ist nicht „deckt sich".
        if (in_array((string) ($zeile['urteil'] ?? ''), AVESMAPS_GARETIEN_VERBUND_URTEILE_AUS, true)) {
            continue;
        }
        $zuordnung = avesmapsGaretienMappeTyp((string) ($zeile['typ'] ?? ''));
        if ($zuordnung === null) {
            continue;
        }
        // 🔴 Der Zieltyp kommt aus der Zuordnungstabelle, NIE aus der Ebene: ein `Berg` liegt in
        // der Ebene „Berge" und ist trotzdem ein `label` (ein Punkt).
        if (in_array((string) ($zuordnung['ziel'] ?? ''), AVESMAPS_GARETIEN_VERBUND_ZIELE_AUS, true)) {
            continue;
        }
        $name = trim((string) ($zeile['anzeige'] ?? '')) !== ''
            ? (string) $zeile['anzeige']
            : (string) ($zeile['artikel'] ?? '');
        [$stamm, , $art] = avesmapsGaretienVerbundStamm($name);
        if ($stamm === '') {
            continue;
        }
        $schluessel = (string) ($zeile['ebene'] ?? '') . '|' . (string) ($zeile['typ'] ?? '') . '|' . $stamm;
        $gruppen[$schluessel][] = ['i' => $i, 'stamm' => $stamm, 'art' => $art];
    }

    $raus = [];
    foreach ($gruppen as $schluessel => $mitglieder) {
        if (count($mitglieder) < 2) {
            continue;
        }
        $hatMarke = false;
        foreach ($mitglieder as $m) {
            if ($m['art'] !== 'ohne') {
                $hatMarke = true;
                break;
            }
        }
        if (!$hatMarke) {
            continue;
        }
        foreach ($mitglieder as $m) {
            $raus[$m['i']] = ['stamm' => $m['stamm'], 'gruppe' => (string) $schluessel];
        }
    }
    ksort($raus);

    return $raus;
}

/**
 * Welche Zeilen gehoeren zu einem Verbund, und unter welchem Stamm?
 *
 * @param list<array<string,mixed>> $zeilen benannte Zeilen (avesmapsGaretienZeilenBenennen)
 * @return array<int,string> Zeilenindex => Stamm; nur Zeilen, die wirklich zu einem Verbund gehoeren
 */
function avesmapsGaretienVerbuende(array $zeilen): array
{
    return array_map(
        static fn(array $mitglied): string => $mitglied['stamm'],
        avesmapsGaretienVerbundMitglieder($zeilen)
    );
}

/**
 * Zu welcher GRUPPE gehoert jede Verbund-Zeile? Schluessel `ebene|typ|stamm`.
 *
 * 🔴 `verbund_n` IST DIE GROESSE DIESER GRUPPE, NICHT DES STAMMS (Entwurf 14.09.2026, Fehler 4).
 * Gruppiert wurde laengst nach Ebene + Typ + Stamm, gezaehlt aber nach Stamm allein -- ein Wald
 * „Silker Hain 1..2" neben einem Huegelland „Silker Hain 1..3" trug dann „5 Fragmente".
 *
 * @param list<array<string,mixed>> $zeilen benannte Zeilen (avesmapsGaretienZeilenBenennen)
 * @return array<int,string> Zeilenindex => Gruppenschluessel; nur Verbund-Mitglieder
 */
function avesmapsGaretienVerbundGruppen(array $zeilen): array
{
    return array_map(
        static fn(array $mitglied): string => $mitglied['gruppe'],
        avesmapsGaretienVerbundMitglieder($zeilen)
    );
}
```

**3c.** In `api/_internal/import/garetien-plan.php`, `avesmapsGaretienBaueSyncPlan`: den Block direkt hinter `$benannt = avesmapsGaretienZeilenBenennen(...)` bis einschließlich `foreach ($benannt as $index => $zeile) {` ersetzen:

```php
    $benannt = avesmapsGaretienZeilenBenennen($pdo, $importRunId, $stmt->fetchAll(PDO::FETCH_ASSOC));

    // 🔴 ZWEI DURCHGAENGE, UND DIE TRENNUNG IST TRAGEND (Entwurf 14.09.2026, Fehler 5). Der Verbund
    // darf nur ERZEUGENDE Zeilen zaehlen -- ein Fragment, das sich mit einem Objekt von uns deckt,
    // bleibt eine Quelle daran (Verbund-Owner 09.09.2026/2). Ob eine Zeile sich deckt, weiss erst
    // der Abgleich. Bis zu diesem Umbau lief die Erkennung VOR dem Abgleich ueber Zeilen, deren
    // SELECT `urteil` nie las, und ihr Filter war tot. Deshalb: erst jede Zeile beurteilen (und das
    // Urteil schreiben), dann die Verbuende erkennen, dann die Items bauen.
    $anzahl = 0;
    $uebersprungen = [];
    $urteile = [];
    foreach ($benannt as $index => $zeile) {
```

(entfernt werden damit die vier Zeilen `// 🔴 EINMAL je Lauf …`, `// sich kann nicht wissen …`, `$verbuende = avesmapsGaretienVerbuende($benannt);`, `$verbundGroesse = array_count_values($verbuende);` sowie die alten Zeilen `$anzahl = 0;` / `$uebersprungen = [];`).

Dann in derselben Schleife den Block ab dem Ende des `avesmapsGaretienSchreibeUrteil(...)`-Aufrufs ersetzen — alt:

```php
            $nenntTreffer && $urteil['abstand'] !== null ? (float) $urteil['abstand'] : null
        );
        if ($urteil['status'] === 'uebersprungen') {
            continue;
        }
        // 🔴 DER VIERTE AUSGANG. `deckt_sich` erzeugte bis zum 27.08.2026 gar nichts -- und genau
```

neu:

```php
            $nenntTreffer && $urteil['abstand'] !== null ? (float) $urteil['abstand'] : null
        );
        // Das Urteil reist an der Zeile zur Verbund-Erkennung -- dieselbe Bedeutung wie die Spalte
        // `garetien_import_row.urteil`, die gerade geschrieben wurde.
        $benannt[$index]['urteil'] = (string) $urteil['status'];
        if ($urteil['status'] === 'uebersprungen') {
            continue;
        }
        $urteile[$index] = ['ziel' => $ziel, 'urteil' => $urteil];
    }

    // 🔴 EINMAL je Lauf ueber ALLE Zeilen -- die Gruppe entsteht nur im Ganzen, eine Zeile fuer
    // sich kann nicht wissen, ob sie Geschwister hat.
    $verbuende = avesmapsGaretienVerbuende($benannt);
    // 🔴 GEZAEHLT WIRD JE GRUPPE (ebene|typ|stamm), NICHT JE STAMM -- Fehler 4 des Entwurfs.
    $verbundGruppen = avesmapsGaretienVerbundGruppen($benannt);
    $verbundGroesse = array_count_values($verbundGruppen);

    foreach ($urteile as $index => $beurteilt) {
        $zeile = $benannt[$index];
        $ziel = $beurteilt['ziel'];
        $urteil = $beurteilt['urteil'];
        // 🔴 DER VIERTE AUSGANG. `deckt_sich` erzeugte bis zum 27.08.2026 gar nichts -- und genau
```

und etwas weiter unten in derselben (jetzt zweiten) Schleife:

```php
        $verbund = isset($verbuende[$index], $verbundGruppen[$index])
            ? ['stamm' => $verbuende[$index], 'n' => $verbundGroesse[$verbundGruppen[$index]]]
            : null;
```

(ersetzt `$verbund = isset($verbuende[$index]) ? ['stamm' => $verbuende[$index], 'n' => $verbundGroesse[$verbuende[$index]]] : null;`). Der Rest der Schleife (`$eintraege = avesmapsGaretienEintraegeFuerUrteil(...)` bis `avesmapsSyncPlanAddItem`) bleibt wörtlich, ebenso `avesmapsSyncPlanFinishBuild` danach.

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

```bash
P="php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll"
for t in garetien-verbund-test garetien-plan-test garetien-innerorts-test garetien-liste-test garetien-verbund-liste-test garetien-abschnitte-vollstaendig-test; do $P api/_internal/import/__tests__/$t.php 2>&1 | tail -1; done
```
Erwartet: `OK -- garetien-verbund` · `OK: 134 Pruefungen` · `OK: 95 Pruefungen` · `OK: 115 Pruefungen` · `OK -- garetien-verbund-liste` · `OK: 62 Pruefungen`. Kein fremder Test nagelt das alte Verhalten fest (gemessen, ganzes PHP-Feld grün bis auf `linkcheck/__tests__/link-url-test.php`).

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-verbund.php
git add api/_internal/import/garetien-plan.php
git add api/_internal/import/__tests__/garetien-verbund-test.php
git commit -F- <<'EOF'
fix(garetien): die Verbund-Erkennung zaehlt nur erzeugende Fragmente, je Gruppe

Vier Fehler der Erkennung, alle am Zweig gemessen: "Süd" wurde nie erkannt
(strtoupper kennt nur ASCII), ein Einzelbuchstabe galt als Marke ("Pfad A" +
"Pfad B" = ein Verbund), verbund_n zaehlte je Stamm statt je Gruppe, und ein
deckendes Fragment wurde Mitglied -- der Urteils-Filter war an der echten
Aufrufstelle tot, weil der SELECT des Planbaus `urteil` nie las.

Der Planbau beurteilt jetzt erst alle Zeilen, erkennt dann die Verbuende und
baut danach die Items. Stamm und Gruppe kommen aus EINER Rechnung.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 2: Name = Stamm, Wiki-Schlüssel an der Region

**Deckt Entwurf §6.3 und §6.6 ab** (Fehler 1). Innenumbau — kein Blick nötig (die sichtbare Folge, ein Verbund heißt wie sein Stamm, erreicht die Karte erst über den Client aus Aufgabe 6).

- 🔴 **Der Server setzt den Stamm selbst**, sobald `verbund` im Rumpf steht und kein Handname gewählt ist — in `avesmapsGaretienNameUebersteuern` (`garetien-plan.php` ~:260), der EINEN Stelle, von der jeder Anleger `$nach['name']` liest (Fläche, ihr Label, Weg, Wiki-Zuweisung). Kein zweiter Weg im Flächen- oder Wege-Zweig.
- ⚠️ **Nur für die Ziele `region` und `path`** (`AVESMAPS_GARETIEN_VERBUND_NAME_ZIELE`). Ein Punktziel bekommt den Stamm nie. `avesmapsGaretienNameUebersteuern` läuft auch für `changed`-Items; dort ist ein Name wirkungslos, weil `avesmapsGaretienErgaenzungAnwenden` jedes Feld außer `quelle` verweigert (`AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT = false`).
- 💣 **Die Konstante steht VOR der Funktion**, die sie liest: PHP hebt Funktionen, aber keine Konstanten auf Dateiebene (`const-vor-benutzung-test.php`).
- 💣 **An die Region reist die ADRESSE, nie ein Schlüssel.** `avesmapsCreateEcosystemRegion` (`app/ecosystem.php` :2814) liest `wiki_region_key` nicht, sondern leitet ihn in `avesmapsEcosystemReadRegionFields` (:2076–2080) über `avesmapsEcosystemWikiRegionKey` aus `wiki_url` ab. `avesmapsGaretienWikiLandschaftZuweisung` liefert das Objekt aus `avesmapsWikiRegionBuildAssignObject` (`wiki/regions.php` :786), das `wiki_url` trägt.
- ⚠️ **Nur der Anführer** schreibt die Region; ein Teil legt nur seine Fläche an (`$anRegionPublicId`-Zweig, unverändert).
- 💣 **Fremder Test:** `garetien-verbund-uebernahme-test.php` Abschnitt G (~:462–467) liest die Flächenzahl je Region über den Regionsnamen `'AXwald 1'`/`'A_wald 1'` — seit dem Stamm heißen sie `'AXwald'`/`'A_wald'`. Nachgezogen in Schritt 4.
- **Bestand:**
  - *Name = Stamm:* kein Bestand betroffen. `verbund` im Rumpf schickt nur der Client des Verbund-Zweigs, der nie live war; jeder live übernommene Rumpf ist ohne `verbund` (Abschnitt S prüft es).
  - *Wiki-Schlüssel an der Region:* **wirkt nur für künftige Importe.** Jede vor dem Deploy importierte Fläche mit Wiki-Treffer behält den Stand „Beschriftung trägt `properties.wiki_region`, Region trägt `wiki_url`/`wiki_region_key` = NULL" — Kanon und Statuskreis der Fläche sehen sie als unzugewiesen, die neuen daneben als zugewiesen. Der Durchtrag des Hauses wandert nur **abwärts** (Fläche → Beschriftung, `avesmapsEcosystemPushWikiRegionToLabels`, AGENTS.md §11), heilt das also nicht. ✅ **Nachgezogen wird der Bestand in Aufgabe 13** (Owner 14.09.2026: „ja, mit Trockenlauf"); die Zählabfrage über alle Vermerkformen steht dort in Schritt 6a — eine Abfrage, die nur `apply_note` als nackte `public_id` vergleicht, zählt die neueren Vermerke `area:… | region:…` nicht mit und ist nur eine Untergrenze.

**Dateien:**
- Ändern: `api/_internal/import/garetien-plan.php` (`avesmapsGaretienNameUebersteuern` ~:260)
- Ändern: `api/_internal/import/garetien-uebernahme.php` (`avesmapsGaretienFlaecheAnlegen` ~:837–844)
- Test: `api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php` (neue Abschnitte O, P, S; Abschnitt G nachgezogen)

**Schnittstellen:**
- Nutzt: `avesmapsGaretienWikiLandschaftZuweisung(PDO $pdo, string $name, string $subtyp): ?array` (liefert u. a. `wiki_url`), `avesmapsCreateEcosystemRegion(PDO $pdo, array $payload, int $userId): array`, `avesmapsEcosystemWikiRegionKey(string $wikiUrl): ?string`, `avesmapsWikiSyncCreateMatchKey(string $value): string`, `avesmapsGaretienApplyStep(PDO, int $runId, int $userId, ?array $user, ?int $budget, ?array $itemIds, ?array $einstellungen, ?array $jeItem): array`, `avesmapsGaretienVerbundAngelegt(array $item): string` (garetien-liste.php :372), die Prüfstand-Helfer der Datei (`avesmapsGaretienVerbundUebernahmeTestPdo`, `avesmapsGaretienVerbundTestFragment`, `avesmapsGaretienVerbundTestRing`)
- Liefert: `avesmapsGaretienNameUebersteuern(array $nach, ?array $einstellungen): array` (Signatur unverändert, neue Regel) · Konstante `AVESMAPS_GARETIEN_VERBUND_NAME_ZIELE = ['region', 'path']` · Test-Helfer `avesmapsGaretienVerbundTestWeg(PDO, int $runId, string $label, int $nr, array $linie): int` und `avesmapsGaretienVerbundTestFragmentMitArtikel(PDO, int $runId, string $label, int $nr, array $ring, string $artikelUrl): int` (Aufgabe 3 benutzt den zweiten)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

In `api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php` NACH der letzten Zeile `echo "OK -- garetien-ruecknahme-label-abfrage-gebunden (Fixrunde 1, Befund 3)\n";` anhängen:

```php

// =================================================================================================
// O. NAME = STAMM (Entwurf 14.09.2026, Fehler 1) -- Flaeche UND Weg, im SERVER gesetzt
// =================================================================================================
//
// 💣 Der Verbund-Entwurf sagte „Name = Stamm" dreimal zu (§0.3, §3, §6), gebaut war es nie: die
// Region hiess „Silker Hain 1", die Wiki-Suche fragte `silkerhain1`, und zwei Wegabschnitte
// „Alkenstieg" + „Alkenstieg 2" blieben zwei Wege. Eine Sperre nur im Browser ist keine -- der
// Server setzt den Stamm selbst, sobald `verbund` im Rumpf steht und kein Name gewaehlt ist.

/** Ein 'new'-Weg-Item -- dieselbe Form wie avesmapsGaretienVerbundTestFragment, nur als Linie. */
function avesmapsGaretienVerbundTestWeg(PDO $pdo, int $runId, string $label, int $nr, array $linie): int
{
    $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                   VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1)")
        ->execute([
            $runId,
            'ggp:Wege:Weg:#' . $nr,
            $label,
            json_encode([
                'herkunft' => 'garetien', 'ziel' => 'path', 'subtyp' => 'Weg', 'kind' => null,
                'name' => $label, 'geometry' => ['type' => 'LineString', 'coordinates' => $linie],
            ], JSON_UNESCAPED_UNICODE),
        ]);

    return (int) $pdo->lastInsertId();
}

// --- O1. Die Flaeche: Region UND Beschriftung heissen wie der Stamm.
$pdoO = avesmapsGaretienVerbundUebernahmeTestPdo();
$runO = avesmapsSyncPlanStartRun($pdoO, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-o');
$itemO1 = avesmapsGaretienVerbundTestFragment($pdoO, $runO, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$itemO2 = avesmapsGaretienVerbundTestFragment($pdoO, $runO, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
$ergebnisO = avesmapsGaretienUebernehmen($pdoO, $runO, [$itemO1, $itemO2], ['id' => 7], null, [
    $itemO1 => ['verbund' => 'Silker Hain'],
    $itemO2 => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisO['fehler'] === [], 'O1: keine Fehler: ' . json_encode($ergebnisO['fehler'], JSON_UNESCAPED_UNICODE));
$regionNameO = $pdoO->query('SELECT name FROM ecosystem_region')->fetchAll(PDO::FETCH_COLUMN);
assert($regionNameO === ['Silker Hain'], 'O1: die Region heisst wie der STAMM, nicht wie das erste Fragment: '
    . json_encode($regionNameO, JSON_UNESCAPED_UNICODE));
$labelNameO = $pdoO->query("SELECT name FROM map_features WHERE feature_type = 'label'")->fetchAll(PDO::FETCH_COLUMN);
assert($labelNameO === ['Silker Hain'], 'O1: die Beschriftung ebenso: ' . json_encode($labelNameO, JSON_UNESCAPED_UNICODE));

// --- O2. Ein von Hand gewaehlter Name schlaegt den Stamm.
$pdoO2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runO2 = avesmapsSyncPlanStartRun($pdoO2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-o2');
$itemO21 = avesmapsGaretienVerbundTestFragment($pdoO2, $runO2, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$ergebnisO2 = avesmapsGaretienUebernehmen($pdoO2, $runO2, [$itemO21], ['id' => 7], null, [
    $itemO21 => ['verbund' => 'Silker Hain', 'name' => 'Silberner Hain'],
]);
assert($ergebnisO2['fehler'] === [], 'O2: keine Fehler: ' . json_encode($ergebnisO2['fehler'], JSON_UNESCAPED_UNICODE));
assert($pdoO2->query('SELECT name FROM ecosystem_region')->fetchColumn() === 'Silberner Hain',
    'O2: der Handname gewinnt -- „Name danach aenderbar" (Verbund-Owner 09.09.2026/3)');

// --- O3. Der Weg: beide Abschnitte heissen wie der Stamm, und damit ist es EIN Weg
//         (`name:<Wegart>:<Stamm>`, wpGroupKeyOf). Ein Abschnitt OHNE Verbund behaelt seinen Namen.
$pdoO3 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runO3 = avesmapsSyncPlanStartRun($pdoO3, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-o3');
$wegO1 = avesmapsGaretienVerbundTestWeg($pdoO3, $runO3, 'Alkenstieg', 11, [[100.0, 100.0], [120.0, 110.0]]);
$wegO2 = avesmapsGaretienVerbundTestWeg($pdoO3, $runO3, 'Alkenstieg 2', 12, [[300.0, 300.0], [320.0, 310.0]]);
$wegO3 = avesmapsGaretienVerbundTestWeg($pdoO3, $runO3, 'Bruchweg 2', 13, [[500.0, 500.0], [520.0, 510.0]]);
$ergebnisO3 = avesmapsGaretienUebernehmen($pdoO3, $runO3, [$wegO1, $wegO2, $wegO3], ['id' => 7], null, [
    $wegO1 => ['verbund' => 'Alkenstieg'],
    $wegO2 => ['verbund' => 'Alkenstieg'],
    $wegO3 => [],
]);
assert($ergebnisO3['fehler'] === [], 'O3: keine Fehler: ' . json_encode($ergebnisO3['fehler'], JSON_UNESCAPED_UNICODE));
$wegNamenO3 = $pdoO3->query("SELECT name FROM map_features WHERE feature_type = 'path' ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
assert($wegNamenO3 === ['Alkenstieg', 'Alkenstieg', 'Bruchweg 2'],
    'O3: beide Verbund-Abschnitte tragen den Stamm, der dritte seinen eigenen Namen: '
    . json_encode($wegNamenO3, JSON_UNESCAPED_UNICODE));

// --- O4. Ein Punktziel bekommt den Stamm NIE -- ein Verbund wird eine Flaeche oder ein Weg.
$nachPunkt = avesmapsGaretienNameUebersteuern(['ziel' => 'label', 'name' => 'Zwillingsgipfel 1'], ['verbund' => 'Zwillingsgipfel']);
assert($nachPunkt['name'] === 'Zwillingsgipfel 1', 'O4: ein Berggipfel behaelt seinen Namen: ' . $nachPunkt['name']);
$nachOrt = avesmapsGaretienNameUebersteuern(['ziel' => 'location', 'name' => 'Lilienhof 1'], ['verbund' => 'Lilienhof']);
assert($nachOrt['name'] === 'Lilienhof 1', 'O4: ein Ort ebenso');
$ohneRumpf = avesmapsGaretienNameUebersteuern(['ziel' => 'region', 'name' => 'Silker Hain 1'], null);
assert($ohneRumpf['name'] === 'Silker Hain 1', 'O4: ohne Rumpf bleibt der Vorschlag');

echo "OK -- garetien-verbund-name-stamm (Entwurf 14.09.2026, Fehler 1)\n";

// =================================================================================================
// P. DER WIKI-SCHLUESSEL LANDET AN DER REGION -- gesucht mit dem Stamm
// =================================================================================================
//
// 🔴 Die Wiki-Zuweisung sucht mit `$nach['name']` -- also erst seit O mit dem Stamm. Bis dahin
// fragte sie `silkerhain1`, fand nichts, und keiner der vier Teile bekam einen Artikel.
// 💣 UND SIE HING NUR AM SCHILD. Die Region traegt bei einem Verbund vier Flaechen, an ihr haengen
// Kanon und Statuskreis. ⚠️ avesmapsCreateEcosystemRegion liest keinen Schluessel, sondern leitet ihn
// aus `wiki_url` ab (avesmapsEcosystemReadRegionFields) -- die Uebernahme reicht deshalb die ADRESSE
// des Treffers weiter, nie einen selbst gebauten Schluessel.
$pdoP = avesmapsGaretienVerbundUebernahmeTestPdo();
// ⚠️ Nur die Spalten, die avesmapsGaretienWikiLandschaftVorschlag/-Zuweisung lesen
// (`SELECT wiki_key, name, art ... WHERE match_key`, dann `SELECT *` fuer das Zuweisungsobjekt).
$pdoP->exec('CREATE TABLE wiki_region_staging (wiki_key TEXT PRIMARY KEY, title TEXT, name TEXT, match_key TEXT,
    art TEXT, wiki_url TEXT, continent TEXT, region_parent TEXT, synonyms_json TEXT, neighbors_json TEXT)');
$wikiUrlP = 'https://de.wiki-aventurica.de/wiki/Silker_Hain';
$pdoP->prepare('INSERT INTO wiki_region_staging (wiki_key, title, name, match_key, art, wiki_url) VALUES (?, ?, ?, ?, ?, ?)')
    ->execute(['silker-hain', 'Silker Hain', 'Silker Hain', avesmapsWikiSyncCreateMatchKey('Silker Hain'), 'Wald', $wikiUrlP]);
$runP = avesmapsSyncPlanStartRun($pdoP, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-p');
$itemP1 = avesmapsGaretienVerbundTestFragment($pdoP, $runP, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$itemP2 = avesmapsGaretienVerbundTestFragment($pdoP, $runP, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
$ergebnisP = avesmapsGaretienUebernehmen($pdoP, $runP, [$itemP1, $itemP2], ['id' => 7], null, [
    $itemP1 => ['verbund' => 'Silker Hain'],
    $itemP2 => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisP['fehler'] === [], 'P: keine Fehler: ' . json_encode($ergebnisP['fehler'], JSON_UNESCAPED_UNICODE));
$regionP = $pdoP->query('SELECT wiki_url, wiki_region_key FROM ecosystem_region')->fetchAll(PDO::FETCH_ASSOC);
assert(count($regionP) === 1, 'P (Testaufbau): genau eine Region');
assert($regionP[0]['wiki_url'] === $wikiUrlP,
    'P: die REGION traegt die Adresse des Treffers: ' . json_encode($regionP[0], JSON_UNESCAPED_UNICODE));
assert($regionP[0]['wiki_region_key'] !== null
    && $regionP[0]['wiki_region_key'] === avesmapsEcosystemWikiRegionKey($wikiUrlP),
    'P: und den daraus ABGELEITETEN Schluessel -- dieselbe Faltung wie jeder andere Schreiber: '
    . json_encode($regionP[0], JSON_UNESCAPED_UNICODE));
$labelPropsP = json_decode((string) $pdoP->query("SELECT properties_json FROM map_features WHERE feature_type = 'label'")->fetchColumn(), true);
assert(($labelPropsP['wiki_region']['wiki_key'] ?? null) === 'silker-hain',
    'P: die Beschriftung behaelt ihre Zuweisung: ' . json_encode($labelPropsP['wiki_region'] ?? null, JSON_UNESCAPED_UNICODE));

// --- P2. Ohne Treffer bleibt die Region ohne Artikel -- kein erfundener Schluessel.
$pdoP2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runP2 = avesmapsSyncPlanStartRun($pdoP2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-p2');
$itemP21 = avesmapsGaretienVerbundTestFragment($pdoP2, $runP2, 'Nirgendwald 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
avesmapsGaretienUebernehmen($pdoP2, $runP2, [$itemP21], ['id' => 7], null, [$itemP21 => ['verbund' => 'Nirgendwald']]);
$regionP2 = $pdoP2->query('SELECT wiki_url, wiki_region_key FROM ecosystem_region')->fetch(PDO::FETCH_ASSOC);
assert($regionP2['wiki_url'] === null && $regionP2['wiki_region_key'] === null,
    'P2: ohne Treffer weder Adresse noch Schluessel: ' . json_encode($regionP2));

echo "OK -- garetien-verbund-wiki-an-der-region (Entwurf 14.09.2026, §6.6)\n";

// =================================================================================================
// S. DER BESTAND (Owner 14.09.2026) -- was vor diesem Deploy uebernommen oder abgelehnt wurde
// =================================================================================================
//
// 🔴 Der Importer ist live, der Verbund-Zweig war es nie. Ein Item von dort traegt ein `after_json`
// OHNE `verbund_stamm`/`verbund_n`, einen NACKTEN Vermerk (die public_id der Region) und keinen
// `verbund` im Rumpf -- „Alle angezeigten einfuegen" schickte nie Einstellungen. Nichts davon wird
// migriert; jeder Leser behandelt das Fehlende als „kein Verbund".
// Der Leser des Reiters „Uebernommen" (avesmapsGaretienVerbundAngelegt) wohnt in der Arbeitsliste.
require_once __DIR__ . '/../garetien-liste.php';

/** Ein Flaechen-Fragment MIT eigenem Artikel -- damit avesmapsGaretienQuellenAnlegen wirklich verknuepft. */
function avesmapsGaretienVerbundTestFragmentMitArtikel(PDO $pdo, int $runId, string $label, int $nr, array $ring, string $artikelUrl): int
{
    $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                   VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1)")
        ->execute([
            $runId,
            'ggp:Waelder:Wald:#' . $nr,
            $label,
            json_encode([
                'herkunft' => 'garetien', 'ziel' => 'region', 'kind' => 'vegetation', 'subtyp' => 'wald',
                'name' => $label, 'geometry' => ['type' => 'Polygon', 'coordinates' => [$ring]],
                'artikel_quelle' => [
                    'url' => $artikelUrl, 'label' => $label . ' auf garetien.de', 'source_type' => 'briefspiel',
                    'origin' => 'garetien', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de',
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

    return (int) $pdo->lastInsertId();
}

// --- S1. Ein Einzelobjekt wie aus dem Bestand: der Name bleibt, und es bleibt zuruecknehmbar.
$pdoS = avesmapsGaretienVerbundUebernahmeTestPdo();
$runS = avesmapsSyncPlanStartRun($pdoS, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-s');
$itemS1 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoS, $runS, 'Muehlsee 2', 1, avesmapsGaretienVerbundTestRing(100, 100),
    'https://www.garetien.de/index.php/Muehlsee');
$abgelehntS = avesmapsGaretienVerbundTestFragment($pdoS, $runS, 'Schilfsee 2', 2, avesmapsGaretienVerbundTestRing(300, 300));
// Die abgelehnte Zeile: so, wie die Tuer 'decline' sie hinterlaesst -- abgehakt, Entscheidung dauerhaft.
$pdoS->prepare('UPDATE sync_plan_item SET selected = 0 WHERE id = ?')->execute([$abgelehntS]);
$pdoS->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (?, 'ggp:Waelder:Wald:#2', 'new', '2026-09-01 10:00:00')")
    ->execute([AVESMAPS_GARETIEN_PLAN_KIND]);

// Der Weg ueber die echte Tuer-Funktion, mit BEIDEN ids -- wie ein alter Client, der nur ids schickt.
$schrittS = avesmapsGaretienApplyStep($pdoS, $runS, 7, ['id' => 7], null, [$itemS1, $abgelehntS], null, null);
assert($schrittS['fehler'] === [] && $schrittS['applied'] === 1,
    'S1: der Bestand-Weg (ohne Rumpf) legt genau das eine angehakte Objekt an: ' . json_encode($schrittS, JSON_UNESCAPED_UNICODE));
assert($pdoS->query('SELECT name FROM ecosystem_region')->fetchAll(PDO::FETCH_COLUMN) === ['Muehlsee 2'],
    'S1: ohne `verbund` im Rumpf bleibt der Name des Vorschlags -- kein Stamm, kein „Muehlsee"');
$abgelehntZeileS = $pdoS->query('SELECT selected, apply_state FROM sync_plan_item WHERE id = ' . $abgelehntS)->fetch(PDO::FETCH_ASSOC);
assert((int) $abgelehntZeileS['selected'] === 0 && $abgelehntZeileS['apply_state'] === null,
    'S1: die ABGELEHNTE Zeile bleibt unberuehrt: ' . json_encode($abgelehntZeileS));
assert($pdoS->query("SELECT declined_at FROM sync_decision WHERE entity_key = 'ggp:Waelder:Wald:#2'")->fetchColumn() === '2026-09-01 10:00:00',
    'S1: und ihre Ablehnung steht');

// Der Vermerk, wie der LIVE-Stand ihn schreibt: die nackte public_id der Region.
$regionS = avesmapsGaretienVermerkLesen((string) $pdoS->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemS1)->fetchColumn())['region'];
$pdoS->prepare('UPDATE sync_plan_item SET apply_note = ? WHERE id = ?')->execute([$regionS, $itemS1]);
$zeileS1 = $pdoS->query('SELECT apply_state, apply_note FROM sync_plan_item WHERE id = ' . $itemS1)->fetch(PDO::FETCH_ASSOC);
assert(avesmapsGaretienVerbundAngelegt($zeileS1) === '',
    'S1: ANZEIGBAR -- der Reiter „Uebernommen" liest einen nackten Vermerk als „kein Verbund"');
$rS1 = avesmapsGaretienRuecknahmeAusfuehren($pdoS, $runS, [$itemS1], ['id' => 7]);
assert($rS1['fehler'] === [] && $rS1['zurueckgenommen'] === 1,
    'S1: ZURUECKNEHMBAR wie vorher: ' . json_encode($rS1['fehler'], JSON_UNESCAPED_UNICODE));
assert((int) $pdoS->query("SELECT is_active FROM ecosystem_region WHERE public_id = '" . $regionS . "'")->fetchColumn() === 0,
    'S1: die Region ist weg');
assert($pdoS->query("SELECT declined_at FROM sync_decision WHERE entity_key = 'ggp:Waelder:Wald:#2'")->fetchColumn() === '2026-09-01 10:00:00',
    'S1: die Ablehnung ueberlebt auch die Ruecknahme des Nachbarn');

// --- S2. Ein Vermerk „area:… | region:…" OHNE `verbund:` ist ein Einzelobjekt, kein Anfuehrer.
$pdoS2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runS2 = avesmapsSyncPlanStartRun($pdoS2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-s2');
$itemS21 = avesmapsGaretienVerbundTestFragment($pdoS2, $runS2, 'Tannwald 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
avesmapsGaretienUebernehmen($pdoS2, $runS2, [$itemS21], ['id' => 7], null, [$itemS21 => []]);
$itemS22 = avesmapsGaretienVerbundTestFragment($pdoS2, $runS2, 'Tannwald 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
avesmapsGaretienUebernehmen($pdoS2, $runS2, [$itemS22], ['id' => 7], null, [$itemS22 => ['verbund' => 'Tannwald']]);
assert((int) $pdoS2->query('SELECT COUNT(*) FROM ecosystem_region WHERE is_active = 1')->fetchColumn() === 2,
    'S2: ein Bestands-Objekt ohne `verbund:` im Vermerk wird nie Anfuehrer eines spaeteren Verbunds');

echo "OK -- garetien-verbund-bestand (Owner 14.09.2026)\n";
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
```
Erwartet (gesehen): alle alten `OK -- …`-Zeilen, dann `PHP Fatal error:  Uncaught AssertionError: O1: die Region heisst wie der STAMM, nicht wie das erste Fragment: ["Silker Hain 1"]`.

- [ ] **Schritt 3: Umsetzen**

**3a.** In `api/_internal/import/garetien-plan.php` direkt VOR dem Docblock, der mit ` * Der von Hand geaenderte NAME eines Vorschlags (Owner 09.09.2026:` beginnt, einfügen:

```php
/**
 * Die Ziele, an denen ein Verbund-Stamm der Name wird -- dieselben zwei, die zusammengelegt werden
 * duerfen (Entwurf 14.09.2026, §6.3). ⚠️ VOR der Funktion, die sie liest: PHP hebt Funktionen, aber
 * keine Konstanten auf Dateiebene (AGENTS.md, const-vor-benutzung-test.php).
 */
const AVESMAPS_GARETIEN_VERBUND_NAME_ZIELE = ['region', 'path'];

```

Dann das Ende dieses Docblocks und die Funktion ersetzen — alt:

```php
 * ⚠️ Leer heisst „nicht geaendert", nie „loesche den Namen": ein namenloses Kartenobjekt waere im
 * Editor nicht wiederzufinden.
 */
function avesmapsGaretienNameUebersteuern(array $nach, ?array $einstellungen): array
{
    $name = avesmapsNormalizeSingleLine((string) ($einstellungen['name'] ?? ''), 190);
    if ($name === '') {
        return $nach;
    }
    $nach['name'] = $name;

    return $nach;
}
```

neu:

```php
 * ⚠️ Leer heisst „nicht geaendert", nie „loesche den Namen": ein namenloses Kartenobjekt waere im
 * Editor nicht wiederzufinden.
 *
 * 🔴 UND EIN ZUSAMMENGELEGTER VERBUND HEISST WIE SEIN STAMM (Entwurf 14.09.2026, Fehler 1). Steht
 * `verbund` im Rumpf und ist KEIN Name gewaehlt, wird der Stamm der Name -- „Silker Hain", nicht
 * „Silker Hain 1". Der Client schickt ihn als Vorbelegung; der Server setzt ihn trotzdem selbst,
 * denn eine Sperre nur im Browser ist keine.
 * 💣 DARAN HAENGT MEHR ALS DIE BESCHRIFTUNG: die Wiki-Zuweisung sucht mit diesem Namen
 * (avesmapsGaretienWikiLandschaftZuweisung fragte bis dahin `silkerhain1`), und zwei Wegabschnitte
 * werden erst ueber denselben Namen EIN Weg (`name:<Wegart>:<Stamm>`, wpGroupKeyOf).
 * ⚠️ Der Handname gewinnt (Verbund-Owner 09.09.2026/3: „Name danach aenderbar"), und ein Punktziel
 * bekommt den Stamm nie -- ein Verbund wird eine Flaeche oder ein Weg
 * (AVESMAPS_GARETIEN_VERBUND_NAME_ZIELE).
 */
function avesmapsGaretienNameUebersteuern(array $nach, ?array $einstellungen): array
{
    $name = avesmapsNormalizeSingleLine((string) ($einstellungen['name'] ?? ''), 190);
    if ($name === '') {
        $stamm = avesmapsNormalizeSingleLine((string) ($einstellungen['verbund'] ?? ''), 190);
        if ($stamm === '' || !in_array((string) ($nach['ziel'] ?? ''), AVESMAPS_GARETIEN_VERBUND_NAME_ZIELE, true)) {
            return $nach;
        }
        $name = $stamm;
    }
    $nach['name'] = $name;

    return $nach;
}
```

**3b.** In `api/_internal/import/garetien-uebernahme.php`, `avesmapsGaretienFlaecheAnlegen`, den Aufruf von `avesmapsCreateEcosystemRegion` ersetzen — alt:

```php
    $region = avesmapsCreateEcosystemRegion($pdo, array_merge([
        'name' => (string) $nach['name'],
        'auto_name' => false,
        'kind' => (string) $nach['kind'],
        'region_type' => (string) $nach['subtyp'],
        'label_public_id' => $labelId,
    ], avesmapsGaretienRegionUebersteuerung($einstellungen)), $userId);
```

neu:

```php
    // 🔴 DER WIKI-SCHLUESSEL GEHOERT AUCH AN DIE REGION (Entwurf 14.09.2026, §6.6). Die Region traegt
    // bei einem Verbund N Flaechen, und an ihr haengen Kanon und Statuskreis -- nur am Schild waere
    // die Landschaft fuer beide unzugewiesen.
    // 💣 GEREICHT WIRD DIE ADRESSE, NIE EIN SCHLUESSEL: avesmapsCreateEcosystemRegion leitet
    // `wiki_region_key` selbst aus `wiki_url` ab (avesmapsEcosystemReadRegionFields), ueber die feste
    // Faltungstafel. Ein hier gebauter Schluessel waere die zweite Faltung (AGENTS.md §5).
    // ⚠️ Ohne Treffer bleibt das Feld WEG -- dieselbe Regel wie am Schild.
    $wikiAdresse = trim((string) ($wikiZuweisung['wiki_url'] ?? ''));
    $region = avesmapsCreateEcosystemRegion($pdo, array_merge([
        'name' => (string) $nach['name'],
        'auto_name' => false,
        'kind' => (string) $nach['kind'],
        'region_type' => (string) $nach['subtyp'],
        'label_public_id' => $labelId,
    ], $wikiAdresse !== '' ? ['wiki_url' => $wikiAdresse] : [], avesmapsGaretienRegionUebersteuerung($einstellungen)), $userId);
```

(`$wikiZuweisung` ist in derselben Funktion ~:822 bereits berechnet.)

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

Nach Schritt 3 fällt der eigene Test an einer FREMDEN Zusicherung (gesehen): `AssertionError: G: "AXwald" bleibt bei EINER Flaeche (nicht faelschlich mit A_wald verschmolzen), bekommen: FEHLT`. Nachziehen in `garetien-verbund-uebernahme-test.php`, Abschnitt G (~:462–467) — alt:

```php
assert((int) ($flaechenJeRegionG['AXwald 1'] ?? -1) === 1,
    'G: "AXwald" bleibt bei EINER Flaeche (nicht faelschlich mit A_wald verschmolzen), bekommen: '
    . ($flaechenJeRegionG['AXwald 1'] ?? 'FEHLT'));
assert((int) ($flaechenJeRegionG['A_wald 1'] ?? -1) === 2,
    'G: "A_wald" hat BEIDE eigenen Fragmente zusammengefuehrt, bekommen: '
    . ($flaechenJeRegionG['A_wald 1'] ?? 'FEHLT'));
```

neu:

```php
// ⚠️ Seit dem 14.09.2026 heisst eine Verbund-Region wie ihr STAMM (garetien-plan.php,
// avesmapsGaretienNameUebersteuern), nicht mehr wie ihr erstes Fragment -- die Schluessel dieser
// Tafel sind deshalb „AXwald" und „A_wald", nicht „AXwald 1" und „A_wald 1".
assert((int) ($flaechenJeRegionG['AXwald'] ?? -1) === 1,
    'G: "AXwald" bleibt bei EINER Flaeche (nicht faelschlich mit A_wald verschmolzen), bekommen: '
    . ($flaechenJeRegionG['AXwald'] ?? 'FEHLT'));
assert((int) ($flaechenJeRegionG['A_wald'] ?? -1) === 2,
    'G: "A_wald" hat BEIDE eigenen Fragmente zusammengefuehrt, bekommen: '
    . ($flaechenJeRegionG['A_wald'] ?? 'FEHLT'));
```

(Die SQL-Abfrage darüber heißt weiter `er.name AS leader_name` — ihr Wert ist jetzt der Stamm.)

```bash
P="php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll"
for t in garetien-verbund-uebernahme-test garetien-einstellungen-je-item-test garetien-uebernahme-test garetien-verbund-test; do $P api/_internal/import/__tests__/$t.php 2>&1 | grep -E "^OK|Fatal" | tail -1; done
```
Erwartet: `OK -- garetien-verbund-bestand (Owner 14.09.2026)` · `OK (29 Pruefungen)` · `OK: 453 Pruefungen` · `OK -- garetien-verbund`.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-plan.php
git add api/_internal/import/garetien-uebernahme.php
git add api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
git commit -F- <<'EOF'
fix(garetien): ein zusammengelegter Verbund heisst wie sein Stamm, die Region traegt den Wiki-Artikel

Der Verbund-Entwurf sagte "Name = Stamm" zu, gebaut war es nie: die Region hiess
"Silker Hain 1", die Wiki-Suche fragte `silkerhain1`, zwei Wegabschnitte blieben
zwei Wege. Der Server setzt den Stamm jetzt selbst, wenn `verbund` im Rumpf
steht und kein Name gewaehlt ist -- nur fuer Flaeche und Weg, der Handname gewinnt.

Der Anfuehrer reicht die Adresse des Wiki-Treffers an die Region weiter;
avesmapsCreateEcosystemRegion leitet den Schluessel daraus selbst ab.
Bestand: vor dem Deploy importierte Flaechen behalten die Zuweisung nur am Schild.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 3: Der Anführer räumt auf; die Quelle der Region fällt mit der letzten Fläche

**Deckt Entwurf §6.6 und §6.7 ab** (Fehler 7 und 9). Innenumbau — kein Blick nötig.

- 💣 **Schritt 2 und 3 des Anführers sind ZWEI Transaktionen.** `avesmapsCreateEcosystemRegion` und `avesmapsCreateEcosystemArea` (`app/ecosystem.php` :2814, :4466) rollen je nur sich zurück. Gemessen am Zweig (Trigger auf Schritt 3): 2 aktive Regionen (eine leer), 2 Labels. Aufgeräumt wird über dieselben Hausfunktionen wie jede Rücknahme — `avesmapsDeleteEcosystemRegion` (:3524, nimmt die Labels über `avesmapsEcosystemDeleteLabels` mit) bzw. `avesmapsDeleteMapFeature` (`map/features.php` :3755) für ein Label ohne Region —, danach wird der **ursprüngliche** Fehler weitergeworfen; das Item bleibt `failed` mit dem echten Grund.
- 💣 **MySQL: keine offene Transaktion beim Aufräumen.** Die gescheiterte Hausfunktion hat ihre Transaktion schon zurückgerollt; `avesmapsDeleteEcosystemRegion` ruft `avesmapsEcosystemEnsureTables` (DDL) VOR ihrem `beginTransaction`. Innerhalb einer offenen Transaktion würde MySQL beim DDL implizit committen — **SQLite kennt das nicht**, der Test sähe es nie. `avesmapsGaretienUebernehmen` öffnet keine äußere Transaktion; so muss es bleiben.
- ⚠️ **Das Label wird nur gelöscht, wenn es danach noch aktiv ist** — die Regionslöschung nimmt es über die Kaskade (`AVESMAPS_ECOSYSTEM_CASCADE_ENABLED`) schon mit, ein zweiter Löschversuch auf eine inaktive Zeile würde den echten Grund überdecken. Scheitert das Aufräumen selbst, steht es hinter dem ersten Grund in der Meldung.
- 🔴 **`avesmapsGaretienRegionAktiveFlaechen` ist die EINE Frage für zwei Leser**: die Anführer-Suche `avesmapsGaretienVerbundRegion` (~:700; ein Teil hängt sich nie an eine aktive, aber leere Region) und die Rücknahme. Gefragt wird die Tabelle, nie `region_deleted` aus der Kaskade (abschaltbar).
- 🔴 **Die Quelle der Region fällt NACH dem Löschen, in einem eigenen Fang.** Davor gelöst und das Löschen scheitert, stünde eine sichtbare Landschaft ohne Lizenzangabe da. Scheitert nur das Lösen, wird es als `fehler` benannt, das Item geht trotzdem auf „Offen" (das Objekt ist schon weg). Gelöst wird über `avesmapsGaretienQuelleRuecknahmeLoesen` am Ziel `avesmapsGaretienQuellenZiel('region', <Region>)` = `ecosystem:<Region>` — dort hängen nur Garetien-Verknüpfungen der Fragmente DIESER Region, „alle" ist also genau richtig, sobald die letzte Fläche weg ist. Die `sources`-Zeile bleibt (Abschnitt R prüft es).
- ⚠️ Der Abbruch wird im Test mit einem **SQLite-Trigger** erzwungen (`RAISE(ABORT, …)`), dieselbe Technik wie `scratchpad/merge/server/s3-s6-ablauf.php`.
- ⚠️ **Nicht behoben** (Entwurf §6.9): die zwei Races ohne Sperre.
- **Bestand:**
  - *Aufräumen des Anführers:* wirkt nur für künftige Übernahmen. Waisen aus früheren Läufen gibt es live nicht, weil der Verbund-Zweig nie live war; ein live gescheitertes Einzelobjekt kann aber dieselbe Waise hinterlassen haben (Label + leere Region, Schritt 3 gescheitert). Zählbar mit:
    ```sql
    SELECT COUNT(*) FROM ecosystem_region r
     WHERE r.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM ecosystem_area a WHERE a.region_id = r.id AND a.is_active = 1);
    ```
    (zählt alle leeren aktiven Regionen, nicht nur Import-Waisen). Keine Reparatur gebaut.
  - *Quellen-Lösen:* **ändert das Verhalten auch am Bestand.** Die Rücknahme einer VOR dem Deploy importierten Fläche (nackter Vermerk) löst jetzt ihre Garetien-Verknüpfung mit (Abschnitt R3) — vorher blieb sie an der inaktiven Region stehen. Was **vor** dem Deploy schon zurückgenommen wurde, behält diese verwaiste Verknüpfung. Zahl steht in keinem Code und keiner Doku; zählbar mit:
    ```sql
    SELECT COUNT(*) FROM feature_sources fs
      JOIN ecosystem_region r ON r.public_id = fs.entity_public_id
     WHERE fs.entity_type = 'ecosystem' AND fs.origin = 'garetien' AND r.is_active = 0;
    ```
    Keine Reparatur gebaut. Ein zurückgenommenes Objekt bleibt anzeig- und zurücknehmbar wie vorher (Abschnitte S1, R3).

**Dateien:**
- Ändern: `api/_internal/import/garetien-uebernahme.php` (neue Funktion `avesmapsGaretienRegionAktiveFlaechen` hinter `avesmapsGaretienQuelleRuecknahmeLoesen` ~:337; `avesmapsGaretienVerbundRegion` ~:700; `avesmapsGaretienFlaecheAnlegen` ~:837–856 + neue Funktion `avesmapsGaretienFlaecheAufraeumen` dahinter; `avesmapsGaretienRuecknahmeAusfuehren` Region-Zweig ~:2758–2770)
- Test: `api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php` (neue Abschnitte Q, R)

**Schnittstellen:**
- Nutzt: `avesmapsDeleteEcosystemRegion(PDO $pdo, array $payload, int $userId): array`, `avesmapsDeleteMapFeature(PDO $pdo, array $payload, array $user): array`, `avesmapsGaretienQuelleRuecknahmeLoesen(PDO $pdo, string $entityType, string $entityPublicId, int $userId): int`, `avesmapsGaretienQuellenZiel(string $ziel, string $objektPublicId): array`, `avesmapsGaretienVermerkLesen(string $note): array`, Test-Helfer `avesmapsGaretienVerbundTestFragmentMitArtikel` (Aufgabe 2, Abschnitt S)
- Liefert: NEU `avesmapsGaretienRegionAktiveFlaechen(PDO $pdo, string $regionPublicId): int` · NEU `avesmapsGaretienFlaecheAufraeumen(PDO $pdo, array $user, int $userId, string $labelId, string $regionId, Throwable $abbruch): never` · `avesmapsGaretienFlaecheAnlegen(...)` Signatur und Rückgabe unverändert · `avesmapsGaretienRuecknahmeAusfuehren` liefert bei gelöster Region-Quelle einen Eintrag `ecosystem:<Region>` in `quellen_neu`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

In `api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php` NACH der letzten Zeile `echo "OK -- garetien-verbund-bestand (Owner 14.09.2026)\n";` anhängen:

```php

// =================================================================================================
// Q. EIN GESCHEITERTER ANFUEHRER HINTERLAESST NICHTS (Entwurf 14.09.2026, Fehler 7)
// =================================================================================================
//
// 💣 Der Anfuehrer legt in DREI Hausfunktionen an (Label, Region, Flaeche), und jede hat ihre eigene
// Transaktion. Scheiterte Schritt 3, blieben Beschriftung und eine LEERE Region als Waise stehen --
// und weil sein Item `failed` war, fand der naechste Teil keinen Anfuehrer und legte eine ZWEITE
// Region desselben Namens an. Nichts davon war ruecknehmbar: die Waise hing an keinem `done`-Vermerk.
// Gemessen am Zweig (scratchpad s3-s6-ablauf.php, S6a): 2 aktive Regionen, 2 aktive Labels.
// ⚠️ Der Abbruch wird mit einem SQLite-Trigger erzwungen -- dieselbe Stelle, an der auf MySQL eine
// Schluesselverletzung oder ein abgebrochener Worker den Schritt beenden.

/** Wie viele Zeilen sind aktiv? Region, Flaeche, Beschriftung -- die drei Dinge, die ein Anfuehrer anlegt. */
function avesmapsGaretienVerbundTestBestand(PDO $pdo): array
{
    return [
        'regionen' => (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_region WHERE is_active = 1')->fetchColumn(),
        'flaechen' => (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_area WHERE is_active = 1')->fetchColumn(),
        'labels' => (int) $pdo->query("SELECT COUNT(*) FROM map_features WHERE feature_type = 'label' AND is_active = 1")->fetchColumn(),
        'leere_regionen' => (int) $pdo->query(
            'SELECT COUNT(*) FROM ecosystem_region r WHERE r.is_active = 1
               AND NOT EXISTS (SELECT 1 FROM ecosystem_area a WHERE a.region_id = r.id AND a.is_active = 1)'
        )->fetchColumn(),
    ];
}

// --- Q1. Schritt 3 (die Flaeche) des Anfuehrers scheitert.
$pdoQ = avesmapsGaretienVerbundUebernahmeTestPdo();
$pdoQ->exec("CREATE TRIGGER abbruch_schritt3 BEFORE INSERT ON ecosystem_area WHEN NEW.min_x = 100
             BEGIN SELECT RAISE(ABORT, 'simulierter Abbruch Schritt 3'); END");
$runQ = avesmapsSyncPlanStartRun($pdoQ, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-q');
$itemQ1 = avesmapsGaretienVerbundTestFragment($pdoQ, $runQ, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$itemQ2 = avesmapsGaretienVerbundTestFragment($pdoQ, $runQ, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
$itemQ3 = avesmapsGaretienVerbundTestFragment($pdoQ, $runQ, 'Silker Hain 3', 3, avesmapsGaretienVerbundTestRing(300, 300));
$ergebnisQ = avesmapsGaretienUebernehmen($pdoQ, $runQ, [$itemQ1, $itemQ2, $itemQ3], ['id' => 7], null, [
    $itemQ1 => ['verbund' => 'Silker Hain'],
    $itemQ2 => ['verbund' => 'Silker Hain'],
    $itemQ3 => ['verbund' => 'Silker Hain'],
]);
assert(count($ergebnisQ['fehler']) === 1 && $ergebnisQ['fehler'][0]['item'] === $itemQ1
    && str_contains($ergebnisQ['fehler'][0]['grund'], 'simulierter Abbruch Schritt 3'),
    'Q1: der Anfuehrer scheitert und nennt den ECHTEN Grund: ' . json_encode($ergebnisQ['fehler'], JSON_UNESCAPED_UNICODE));
$stateQ1 = $pdoQ->query('SELECT apply_state FROM sync_plan_item WHERE id = ' . $itemQ1)->fetchColumn();
assert($stateQ1 === 'failed', 'Q1: sein Item steht auf failed: ' . var_export($stateQ1, true));
$bestandQ = avesmapsGaretienVerbundTestBestand($pdoQ);
assert($bestandQ === ['regionen' => 1, 'flaechen' => 2, 'labels' => 1, 'leere_regionen' => 0],
    'Q1: GENAU EINE Region mit den zwei uebrigen Flaechen und EIN Label -- keine Waise des Anfuehrers: '
    . json_encode($bestandQ));
$noteQ2 = avesmapsGaretienVermerkLesen((string) $pdoQ->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemQ2)->fetchColumn());
$noteQ3 = avesmapsGaretienVermerkLesen((string) $pdoQ->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemQ3)->fetchColumn());
assert($noteQ2['region'] !== '' && $noteQ2['region'] === $noteQ3['region'],
    'Q1: Fragment 2 wurde der neue Anfuehrer, Fragment 3 haengt an SEINER Region');

// --- Q2. Schritt 2 (die Region) scheitert -- das Label ist da schon angelegt.
$pdoQ2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$pdoQ2->exec("CREATE TRIGGER abbruch_schritt2 BEFORE INSERT ON ecosystem_region WHEN NEW.name = 'Bruchwald'
              BEGIN SELECT RAISE(ABORT, 'simulierter Abbruch Schritt 2'); END");
$runQ2 = avesmapsSyncPlanStartRun($pdoQ2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-q2');
$itemQ21 = avesmapsGaretienVerbundTestFragment($pdoQ2, $runQ2, 'Bruchwald 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
$ergebnisQ2 = avesmapsGaretienUebernehmen($pdoQ2, $runQ2, [$itemQ21], ['id' => 7], null, [
    $itemQ21 => ['verbund' => 'Bruchwald'],
]);
assert(count($ergebnisQ2['fehler']) === 1 && str_contains($ergebnisQ2['fehler'][0]['grund'], 'simulierter Abbruch Schritt 2'),
    'Q2: der Schritt-2-Abbruch wird gemeldet: ' . json_encode($ergebnisQ2['fehler'], JSON_UNESCAPED_UNICODE));
assert(avesmapsGaretienVerbundTestBestand($pdoQ2) === ['regionen' => 0, 'flaechen' => 0, 'labels' => 0, 'leere_regionen' => 0],
    'Q2: die schon angelegte Beschriftung ist wieder weg: ' . json_encode(avesmapsGaretienVerbundTestBestand($pdoQ2)));

// --- Q3. Ein Teil haengt sich NIE an eine Region ohne aktive Flaeche.
// Der Anfuehrer ist `done`, danach verliert seine Region ihre Flaeche OHNE Kaskade (ein Abbruch
// mitten in einem Aufraeumen, oder ein Handgriff an der Datenbank) -- die Region steht aktiv und leer.
$pdoQ3 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runQ3 = avesmapsSyncPlanStartRun($pdoQ3, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-q3');
$itemQ31 = avesmapsGaretienVerbundTestFragment($pdoQ3, $runQ3, 'Leerwald 1', 1, avesmapsGaretienVerbundTestRing(100, 100));
avesmapsGaretienUebernehmen($pdoQ3, $runQ3, [$itemQ31], ['id' => 7], null, [$itemQ31 => ['verbund' => 'Leerwald']]);
$regionQ3Alt = avesmapsGaretienVermerkLesen((string) $pdoQ3->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemQ31)->fetchColumn())['region'];
$pdoQ3->exec('UPDATE ecosystem_area SET is_active = 0');
$itemQ32 = avesmapsGaretienVerbundTestFragment($pdoQ3, $runQ3, 'Leerwald 2', 2, avesmapsGaretienVerbundTestRing(200, 200));
$ergebnisQ3 = avesmapsGaretienUebernehmen($pdoQ3, $runQ3, [$itemQ32], ['id' => 7], null, [$itemQ32 => ['verbund' => 'Leerwald']]);
assert($ergebnisQ3['fehler'] === [], 'Q3: keine Fehler: ' . json_encode($ergebnisQ3['fehler'], JSON_UNESCAPED_UNICODE));
$regionQ3Neu = avesmapsGaretienVermerkLesen((string) $pdoQ3->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemQ32)->fetchColumn())['region'];
assert($regionQ3Neu !== '' && $regionQ3Neu !== $regionQ3Alt,
    'Q3: Fragment 2 haengt NICHT an der leeren Region, es wird selbst Anfuehrer');

echo "OK -- garetien-verbund-anfuehrer-raeumt-auf (Entwurf 14.09.2026, Fehler 7)\n";

// =================================================================================================
// R. DIE QUELLE DER REGION FAELLT ERST MIT DER LETZTEN FLAECHE (Fehler 9)
// =================================================================================================
//
// 🔴 Alle Fragmente eines Verbunds haengen ihre Garetien-Quelle an DIESELBE Stelle -- die Region
// (`ecosystem:<region_public_id>`). Die Ruecknahme EINES Fragments darf sie den uebrigen nicht
// nehmen; die Ruecknahme des LETZTEN muss sie loesen, sonst bleibt eine Verknuepfung an einer
// geloeschten Region zurueck, und ein erneuter Import haengt sie an eine neue.
// Der Helfer avesmapsGaretienVerbundTestFragmentMitArtikel steht in Abschnitt S.

$artikelR = 'https://www.garetien.de/index.php/Silker_Hain';
$pdoR = avesmapsGaretienVerbundUebernahmeTestPdo();
$runR = avesmapsSyncPlanStartRun($pdoR, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-r');
$itemR1 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoR, $runR, 'Silker Hain 1', 1, avesmapsGaretienVerbundTestRing(100, 100), $artikelR);
$itemR2 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoR, $runR, 'Silker Hain 2', 2, avesmapsGaretienVerbundTestRing(200, 200), $artikelR);
$ergebnisR = avesmapsGaretienUebernehmen($pdoR, $runR, [$itemR1, $itemR2], ['id' => 7], null, [
    $itemR1 => ['verbund' => 'Silker Hain'],
    $itemR2 => ['verbund' => 'Silker Hain'],
]);
assert($ergebnisR['fehler'] === [], 'R (Testaufbau): keine Fehler: ' . json_encode($ergebnisR['fehler'], JSON_UNESCAPED_UNICODE));
$regionR = avesmapsGaretienVermerkLesen((string) $pdoR->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemR1)->fetchColumn())['region'];
$verknuepfungenR = static fn(): int => (int) $pdoR->query(
    "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'ecosystem' AND entity_public_id = '" . $regionR . "' AND origin = 'garetien'"
)->fetchColumn();
assert($verknuepfungenR() === 1, 'R (Testaufbau): die Region traegt die Garetien-Quelle: ' . $verknuepfungenR());

$rR2 = avesmapsGaretienRuecknahmeAusfuehren($pdoR, $runR, [$itemR2], ['id' => 7]);
assert($rR2['fehler'] === [] && $rR2['zurueckgenommen'] === 1, 'R: Fragment 2 zurueck: ' . json_encode($rR2['fehler'], JSON_UNESCAPED_UNICODE));
assert($verknuepfungenR() === 1,
    'R: 💣 die Region traegt noch Fragment 1 -- ihre Quelle bleibt stehen: ' . $verknuepfungenR());

$rR1 = avesmapsGaretienRuecknahmeAusfuehren($pdoR, $runR, [$itemR1], ['id' => 7]);
assert($rR1['fehler'] === [] && $rR1['zurueckgenommen'] === 1, 'R: Fragment 1 zurueck: ' . json_encode($rR1['fehler'], JSON_UNESCAPED_UNICODE));
assert($verknuepfungenR() === 0,
    'R: mit der LETZTEN Flaeche faellt die Quelle der Region: ' . $verknuepfungenR());
$nachtragR = array_values(array_filter($rR1['quellen_neu'],
    static fn(array $e): bool => $e['entity_type'] === 'ecosystem' && $e['public_id'] === $regionR));
assert(count($nachtragR) === 1 && $nachtragR[0]['sources'] === [],
    'R: und der Browser erfaehrt es -- die Liste der Region ist jetzt leer: ' . json_encode($rR1['quellen_neu'], JSON_UNESCAPED_UNICODE));
$sourcesR = (int) $pdoR->query('SELECT COUNT(*) FROM sources')->fetchColumn();
assert($sourcesR === 1, 'R: 🔴 NUR die Verknuepfung, NIE die geteilte Katalogzeile: ' . $sourcesR);

// --- R2. Eine Flaeche OHNE Verbund: ihre Ruecknahme ist immer die letzte, die Quelle faellt mit.
$pdoR2 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runR2 = avesmapsSyncPlanStartRun($pdoR2, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-r2');
$itemR21 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoR2, $runR2, 'Muehlsee', 1, avesmapsGaretienVerbundTestRing(100, 100),
    'https://www.garetien.de/index.php/Muehlsee');
avesmapsGaretienUebernehmen($pdoR2, $runR2, [$itemR21], ['id' => 7], null, [$itemR21 => []]);
$regionR2 = avesmapsGaretienVermerkLesen((string) $pdoR2->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemR21)->fetchColumn())['region'];
$rR21 = avesmapsGaretienRuecknahmeAusfuehren($pdoR2, $runR2, [$itemR21], ['id' => 7]);
assert($rR21['fehler'] === [] && $rR21['zurueckgenommen'] === 1, 'R2: zurueck: ' . json_encode($rR21['fehler'], JSON_UNESCAPED_UNICODE));
$restR2 = (int) $pdoR2->query("SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'ecosystem' AND entity_public_id = '" . $regionR2 . "'")->fetchColumn();
assert($restR2 === 0, 'R2: die Quelle der einzelnen Flaeche faellt mit ihrer Region: ' . $restR2);

// --- R3. DER BESTAND (Owner 14.09.2026): ein NACKTER Vermerk, wie jeder vor dem Deploy uebernommene.
// ⚠️ DIE EINE VERHALTENSAENDERUNG AM BESTAND: auch hier faellt die Garetien-Quelle jetzt mit. Vorher
// blieb sie als Verknuepfung an der inaktiven Region stehen -- unsichtbar, aber ein Rest.
$pdoR3 = avesmapsGaretienVerbundUebernahmeTestPdo();
$runR3 = avesmapsSyncPlanStartRun($pdoR3, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'lauf-r3');
$itemR31 = avesmapsGaretienVerbundTestFragmentMitArtikel($pdoR3, $runR3, 'Altsee', 1, avesmapsGaretienVerbundTestRing(100, 100),
    'https://www.garetien.de/index.php/Altsee');
avesmapsGaretienUebernehmen($pdoR3, $runR3, [$itemR31], ['id' => 7]);
$regionR3 = avesmapsGaretienVermerkLesen((string) $pdoR3->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $itemR31)->fetchColumn())['region'];
$pdoR3->prepare('UPDATE sync_plan_item SET apply_note = ? WHERE id = ?')->execute([$regionR3, $itemR31]);
$rR31 = avesmapsGaretienRuecknahmeAusfuehren($pdoR3, $runR3, [$itemR31], ['id' => 7]);
assert($rR31['fehler'] === [] && $rR31['zurueckgenommen'] === 1,
    'R3: der alte Vermerk bleibt zuruecknehmbar: ' . json_encode($rR31['fehler'], JSON_UNESCAPED_UNICODE));
$restR3 = (int) $pdoR3->query("SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'ecosystem' AND entity_public_id = '" . $regionR3 . "'")->fetchColumn();
assert($restR3 === 0, 'R3: und seine Quelle faellt mit der Region: ' . $restR3);

echo "OK -- garetien-verbund-quelle-faellt-mit-der-letzten-flaeche (Entwurf 14.09.2026, Fehler 9)\n";
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
```
Erwartet (gesehen): `PHP Fatal error:  Uncaught AssertionError: Q1: GENAU EINE Region mit den zwei uebrigen Flaechen und EIN Label -- keine Waise des Anfuehrers: {"regionen":2,"flaechen":2,"labels":2,"leere_regionen":1}`.

- [ ] **Schritt 3: Umsetzen**

Alle Änderungen in `api/_internal/import/garetien-uebernahme.php`.

**3a.** Direkt hinter der Funktion `avesmapsGaretienQuelleRuecknahmeLoesen` (vor dem Kommentar `// 🔴 DER Z5-INDEX -- dieselbe Stelle, an der js/map-features/ecosystem-display.js die`) einfügen:

```php
/**
 * Wie viele AKTIVE Flaechen traegt diese Region noch? 0 auch dann, wenn es die Region nicht (mehr) gibt.
 *
 * 🔴 EINE FRAGE, ZWEI LESER: die Anfuehrer-Suche (ein Teil haengt sich nie an eine leere Region) und
 * die Ruecknahme (die Quelle der Region faellt erst mit der letzten Flaeche). Gefragt wird die
 * TABELLE, nie eine Rueckgabe der Kaskade -- die ist abschaltbar (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED).
 */
function avesmapsGaretienRegionAktiveFlaechen(PDO $pdo, string $regionPublicId): int
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM ecosystem_area a JOIN ecosystem_region r ON r.id = a.region_id'
        . ' WHERE r.public_id = :p AND a.is_active = 1'
    );
    $stmt->execute([':p' => $regionPublicId]);

    return (int) $stmt->fetchColumn();
}

```

**3b.** In `avesmapsGaretienVerbundRegion`, in der Schleife über `$notizen` — alt:

```php
        if ((string) $zeile['kind'] !== $kind || (string) ($zeile['region_type'] ?? '') !== $regionType) {
            continue;   // Befund E: gleicher Stamm, andere Art -- kein Anfuehrer fuer DIESES Fragment.
        }

        return $region;
```

neu:

```php
        if ((string) $zeile['kind'] !== $kind || (string) ($zeile['region_type'] ?? '') !== $regionType) {
            continue;   // Befund E: gleicher Stamm, andere Art -- kein Anfuehrer fuer DIESES Fragment.
        }
        // 🔴 EIN TEIL HAENGT SICH NIE AN EINE REGION OHNE AKTIVE FLAECHE (Entwurf 14.09.2026, §6.6).
        // Eine aktive, aber leere Region ist ein Rest -- ein abgebrochenes Aufraeumen oder ein
        // Handgriff an der Datenbank. Wer sich daran haengt, macht aus dem Rest einen Verbund, den
        // niemand gezeichnet hat; ohne Treffer wird dieses Fragment selbst Anfuehrer.
        if (avesmapsGaretienRegionAktiveFlaechen($pdo, $region) === 0) {
            continue;   // leer: kein Anfuehrer fuer DIESES Fragment.
        }

        return $region;
```

**3c.** In `avesmapsGaretienFlaecheAnlegen` den Schluss der Funktion (Stand nach Aufgabe 2) ersetzen — alt, ab `$wikiAdresse`:

```php
    $wikiAdresse = trim((string) ($wikiZuweisung['wiki_url'] ?? ''));
    $region = avesmapsCreateEcosystemRegion($pdo, array_merge([
        'name' => (string) $nach['name'],
        'auto_name' => false,
        'kind' => (string) $nach['kind'],
        'region_type' => (string) $nach['subtyp'],
        'label_public_id' => $labelId,
    ], $wikiAdresse !== '' ? ['wiki_url' => $wikiAdresse] : [], avesmapsGaretienRegionUebersteuerung($einstellungen)), $userId);
    $regionId = avesmapsGaretienPublicIdAus($region, 'Die Region');
    $flaeche = avesmapsCreateEcosystemArea($pdo, [
        'region_public_id' => $regionId,
        'geometry' => $nach['geometry'],
    ], $userId);

    return [
        'public_id' => $regionId,
        'entity_type' => 'region',
        'label_public_id' => $labelId,
        'area_public_id' => avesmapsGaretienPublicIdAus($flaeche, 'Die Flaeche'),
    ];
}
```

neu:

```php
    $wikiAdresse = trim((string) ($wikiZuweisung['wiki_url'] ?? ''));
    // 💣 SCHRITT 2 UND 3 SIND ZWEI TRANSAKTIONEN, NICHT EINE (Entwurf 14.09.2026, Fehler 7). Jede
    // Hausfunktion rollt nur SICH zurueck. Scheiterte die Flaeche, standen Beschriftung und eine
    // LEERE Region als Waise da -- an keinem `done`-Vermerk, also von keiner Ruecknahme erreichbar,
    // und der naechste Teil des Verbunds legte eine zweite Region desselben Namens an.
    // 🔴 Deshalb raeumt der Anfuehrer selbst auf, ueber DIESELBEN Hausfunktionen, die jede Ruecknahme
    // benutzt, und wirft den Fehler weiter: das Item bleibt `failed`, der Grund bleibt der echte.
    $regionId = '';
    try {
        $region = avesmapsCreateEcosystemRegion($pdo, array_merge([
            'name' => (string) $nach['name'],
            'auto_name' => false,
            'kind' => (string) $nach['kind'],
            'region_type' => (string) $nach['subtyp'],
            'label_public_id' => $labelId,
        ], $wikiAdresse !== '' ? ['wiki_url' => $wikiAdresse] : [], avesmapsGaretienRegionUebersteuerung($einstellungen)), $userId);
        $regionId = avesmapsGaretienPublicIdAus($region, 'Die Region');
        $flaeche = avesmapsCreateEcosystemArea($pdo, [
            'region_public_id' => $regionId,
            'geometry' => $nach['geometry'],
        ], $userId);
        $flaecheId = avesmapsGaretienPublicIdAus($flaeche, 'Die Flaeche');
    } catch (Throwable $abbruch) {
        avesmapsGaretienFlaecheAufraeumen($pdo, $user, $userId, $labelId, $regionId, $abbruch);
    }

    return [
        'public_id' => $regionId,
        'entity_type' => 'region',
        'label_public_id' => $labelId,
        'area_public_id' => $flaecheId,
    ];
}

/**
 * Was ein gescheiterter Anfuehrer schon angelegt hat, wieder wegnehmen -- und dann den Fehler werfen.
 *
 * 🔴 DIE HAUSFUNKTIONEN, KEIN EIGENES UPDATE. avesmapsDeleteEcosystemRegion nimmt die Region samt
 * ihren Beschriftungen in EINER Transaktion mit (dieselbe, die die Ruecknahme einer Einzelflaeche
 * nimmt); die Beschriftung allein -- Schritt 2 scheiterte, es gibt keine Region -- geht ueber
 * avesmapsDeleteMapFeature. Beide schreiben ihr Protokoll, beide heben die Revision.
 * ⚠️ Die Beschriftung wird NUR geloescht, wenn sie danach noch aktiv ist: die Regionsloeschung nimmt
 * sie ueber die Kaskade schon mit (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED), und ein zweiter Loeschversuch
 * auf eine inaktive Zeile waere ein Fehler, der den echten Grund ueberdeckt.
 * 💣 KEINE OFFENE TRANSAKTION: jede der zwei Hausfunktionen oeffnet ihre eigene, und die gescheiterte
 * Anlage hat ihre bereits zurueckgerollt. Das Ensure-DDL darin laeuft deshalb ausserhalb jeder
 * Transaktion -- auf MySQL committete es eine offene sonst implizit (AGENTS.md §11, Quellen-Umbau).
 * 💣 Scheitert das Aufraeumen selbst, bleibt der ERSTE Fehler der Grund, und das Aufraeumen steht
 * dahinter -- ein Editor muss erfahren, dass eine Waise geblieben ist.
 */
function avesmapsGaretienFlaecheAufraeumen(PDO $pdo, array $user, int $userId, string $labelId, string $regionId, Throwable $abbruch): never
{
    $aufraeumFehler = [];
    if ($regionId !== '') {
        try {
            avesmapsDeleteEcosystemRegion($pdo, ['public_id' => $regionId], $userId);
        } catch (Throwable $fehler) {
            $aufraeumFehler[] = 'Region ' . $regionId . ': ' . $fehler->getMessage();
        }
    }
    if ($labelId !== '') {
        $aktiv = $pdo->prepare('SELECT is_active FROM map_features WHERE public_id = :p LIMIT 1');
        $aktiv->execute([':p' => $labelId]);
        if ((int) $aktiv->fetchColumn() === 1) {
            try {
                avesmapsDeleteMapFeature($pdo, ['public_id' => $labelId], $user);
            } catch (Throwable $fehler) {
                $aufraeumFehler[] = 'Beschriftung ' . $labelId . ': ' . $fehler->getMessage();
            }
        }
    }
    if ($aufraeumFehler === []) {
        throw $abbruch;
    }

    throw new RuntimeException(
        $abbruch->getMessage() . ' -- Aufraeumen unvollstaendig: ' . implode('; ', $aufraeumFehler),
        0,
        $abbruch
    );
}
```

(Die Fehlermeldung des Aufräumens ist nicht gekappt; `avesmapsGaretienUebernehmen` kappt jeden Grund bereits auf 300 Zeichen, bevor er `apply_note` oder die Antwort erreicht.)

**3d.** In `avesmapsGaretienRuecknahmeAusfuehren`, im Zweig `elseif ($ziel === 'region')`, direkt nach dem `else`-Aufruf von `avesmapsDeleteEcosystemRegion` — alt:

```php
                    avesmapsDeleteEcosystemRegion($pdo, ['public_id' => $zielId], (int) ($user['id'] ?? 0));
                }
            } else {
```

neu:

```php
                    avesmapsDeleteEcosystemRegion($pdo, ['public_id' => $zielId], (int) ($user['id'] ?? 0));
                }
                // 🔴 DIE GARETIEN-QUELLE DER REGION FAELLT ERST MIT DER LETZTEN FLAECHE (Entwurf
                // 14.09.2026, Fehler 9). Alle Fragmente eines Verbunds haengen sie an DIESELBE Stelle
                // (`ecosystem:<region>`) -- die Ruecknahme EINES darf sie den uebrigen nicht nehmen.
                // Gezaehlt werden die aktiven Flaechen NACH dem Loeschen, nie der Rueckgabewert der
                // Kaskade: die ist abschaltbar (AVESMAPS_ECOSYSTEM_CASCADE_ENABLED), die Frage nicht.
                // ⚠️ NACH dem Loeschen, nicht davor: scheiterte das Loeschen nach dem Loesen, stuende
                // eine sichtbare Landschaft ohne ihre Lizenzangabe da -- die teurere Richtung.
                // ⚠️ In einem EIGENEN Fang: das Objekt ist zu diesem Zeitpunkt schon weg. Ein Fehler
                // beim Loesen wird benannt, haelt das Item aber nicht auf „done" fest -- sonst boete
                // die Liste eine Ruecknahme an, die nur noch an „Flaeche existiert nicht mehr" scheitert.
                $regionDerFlaeche = avesmapsGaretienVermerkLesen($publicId)['region'];
                try {
                    if ($regionDerFlaeche !== '' && avesmapsGaretienRegionAktiveFlaechen($pdo, $regionDerFlaeche) === 0) {
                        [$quellArt, $quellId] = avesmapsGaretienQuellenZiel('region', $regionDerFlaeche);
                        avesmapsGaretienQuelleRuecknahmeLoesen($pdo, $quellArt, $quellId, (int) ($user['id'] ?? 0));
                        $beruehrt[$quellArt . ':' . $quellId] = ['entity_type' => $quellArt, 'public_id' => $quellId];
                    }
                } catch (Throwable $quellFehler) {
                    $fehler[] = [
                        'item' => $itemId,
                        'grund' => mb_substr('zurueckgenommen, aber die Quelle der Region blieb haengen: '
                            . $quellFehler->getMessage(), 0, 300, 'UTF-8'),
                    ];
                }
            } else {
```

(`mb_substr` hier ist die Kappung, die dieselbe Funktion an allen übrigen `fehler[]`-Stellen schon benutzt; es liegt im Rücknahme-Lesepfad, nicht im Anlegen. ⚠️ Wer „kein `mb_*`" streng liest, ersetzt es durch `substr(…, 0, 300)` — dann kann mitten in einem Umlaut geschnitten werden.)

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

```bash
P="php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll"
for t in garetien-verbund-uebernahme-test garetien-uebernahme-test garetien-einstellungen-je-item-test; do $P api/_internal/import/__tests__/$t.php 2>&1 | grep -E "^OK|Fatal" | tail -1; done
```
Erwartet: `OK -- garetien-verbund-quelle-faellt-mit-der-letzten-flaeche (Entwurf 14.09.2026, Fehler 9)` · `OK: 453 Pruefungen` · `OK (29 Pruefungen)`. Kein fremder Test nagelt das alte Verhalten fest (im Wegwerf-Worktree gegen das ganze PHP-Feld gefahren). Mutationsproben gefahren, alle gefangen: Aufräumen entfernt (Q1), Label-Löschen entfernt (Q2), Leer-Prüfung entfernt (Q3), Quelle nie gelöst (R), Quelle bei jeder Fläche gelöst (R, Zwischenstand).

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-uebernahme.php
git add api/_internal/import/__tests__/garetien-verbund-uebernahme-test.php
git commit -F- <<'EOF'
fix(garetien): ein gescheiterter Anfuehrer raeumt auf, die Quelle der Region faellt mit der letzten Flaeche

Scheiterte beim Anfuehrer eines Verbunds Region oder Flaeche, blieben Label und
eine leere Region als Waise stehen, und der naechste Teil legte eine zweite Region
an. Die Uebernahme raeumt jetzt ueber avesmapsDeleteEcosystemRegion bzw.
avesmapsDeleteMapFeature auf und wirft den echten Fehler weiter; ein Teil haengt
sich nie an eine Region ohne aktive Flaeche.

Die Ruecknahme loest die Garetien-Quelle der Region, sobald keine aktive Flaeche
mehr steht -- auch fuer vor dem Deploy importierte Flaechen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---


---

## Aufgabe 4: „Übernommen" faltet laufübergreifend

**Deckt Entwurf §1 Fehler 8, §6.8 ab.** Sichtbar (an der Liste „Übernommen") — einzeln live, mit Blick des Owners.

💣 **`apply_state = 'done'` stirbt mit dem Lauf.** Nach „Holen & Rechnen" stehen die frischen Items auf `null`; `verbund_angelegt` las nur sie (`api/_internal/import/garetien-liste.php`, Objektbau ~:792) und die Faltung verschwand. Gelesen werden jetzt zusätzlich die `done`-Vermerke der früheren Läufe — EINE Abfrage je Listenabruf, keine Schleife je Objekt (STRATO).

🔴 **Der laufende Lauf entscheidet, sobald er ein übernommenes Item trägt — auch ohne `verbund:` im Vermerk.** Ein zurückgenommenes und danach einzeln übernommenes Fragment ist kein Verbund mehr. Unter mehreren früheren Läufen entscheidet der jüngste, der das Objekt übernommen hat. Ein zurückgenommenes Item trägt keinen Vermerk mehr (`garetien-uebernahme.php` setzt `apply_state = NULL, apply_note = NULL`), dann rückt der ältere nach.

⚠️ `avesmapsSyncPlanAufraeumen` (`api/_internal/wiki/sync-plan.php` :997) löscht nur Items mit `apply_state IS NULL` — übernommene Items überholter Läufe bleiben, und genau von ihnen lebt die neue Abfrage.

💣 **Der Vermerk trägt nur den Stamm.** Seit er aus allen Läufen kommt, liegen auf „Übernommen" Verbünde aus Wochen nebeneinander; ein Wald und ein Hügel gleichen Stammes fielen im Browser zu EINER Zeile zusammen. Der Faltschlüssel im Client ist deshalb `ebene|typ|stamm` — für `garetienUebernommenFalten` UND `garetienUebernommenMitglieder` (ein Schlüssel, zwei Leser).

**Bestand:** Keine Migration. Ein Objekt, das vor dem Verbund-Umbau übernommen wurde (nackter Vermerk = nur eine `public_id`, oder `area:… | region:…` ohne `verbund:`), liefert `''` und steht als eigene Zeile — der Test fährt genau das mit einer alten Einzelübernahme und einer abgelehnten Zeile.

**Dateien:**
- Ändern: `api/_internal/import/garetien-liste.php` (neu `avesmapsGaretienVerbundAngelegtLaufuebergreifend` + `avesmapsGaretienVerbundVermerkeFruehererLaeufe` nach `avesmapsGaretienVerbundAngelegt` ~:372; Aufruf vor Schritt 4 ~:593; `verbund_angelegt` im Objektbau ~:792)
- Ändern: `js/review/review-garetien-importer.js` (`garetienUebernommenFalten` ~:1961, neu `garetienUebernommenFaltSchluessel`, `garetienUebernommenMitglieder` ~:1991)
- Test: `api/_internal/import/__tests__/garetien-verbund-liste-laeufe-test.php` (neu)
- Test: `js/review/__tests__/garetien-uebernommen-falten-schluessel.test.js` (neu)

**Schnittstellen:**
- Nutzt: `avesmapsGaretienVerbundAngelegt(array $item): string`, `avesmapsGaretienVermerkLesen(string $note): array{area,region,verbund}`, `avesmapsGaretienObjektSchluessel(string $entityKey): string`, `AVESMAPS_GARETIEN_PLAN_KIND`
- Liefert: `avesmapsGaretienVerbundAngelegtLaufuebergreifend(array $items, string $frueher): string` · `avesmapsGaretienVerbundVermerkeFruehererLaeufe(PDO $pdo, int $planRunId): array<string,string>` (Objektschlüssel → Stamm) · Objektfeld `verbund_angelegt` laufübergreifend · JS `garetienUebernommenFaltSchluessel(objekt): string` (`""` ohne Vermerk)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `api/_internal/import/__tests__/garetien-verbund-liste-laeufe-test.php`:

```php
<?php

declare(strict_types=1);

// Aufgabe 4 (Garetien-Importer vereint): „Übernommen" faltet einen Verbund LAUFÜBERGREIFEND.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §1 Fehler 8, §6.8
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-liste-laeufe-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-uebernahme.php';
require_once __DIR__ . '/../garetien-liste.php';

// =================================================================================================
// A. Die reine Entscheidung: der LAUFENDE Lauf entscheidet, sobald er ein uebernommenes Item traegt.
// =================================================================================================

$done = static fn(string $note): array => ['apply_state' => 'done', 'apply_note' => $note];
$offen = ['apply_state' => null, 'apply_note' => ''];

assert(avesmapsGaretienVerbundAngelegtLaufuebergreifend([$offen], 'Silker Hain') === 'Silker Hain',
    'ohne uebernommenes Item im laufenden Lauf gilt der Vermerk des frueheren Laufs');
assert(avesmapsGaretienVerbundAngelegtLaufuebergreifend([], 'Silker Hain') === 'Silker Hain',
    'auch ganz ohne Item im laufenden Lauf');
assert(avesmapsGaretienVerbundAngelegtLaufuebergreifend(
    [$offen, $done(avesmapsGaretienVerbundVermerk('a', 'r', 'Neu-Stamm'))], 'Silker Hain') === 'Neu-Stamm',
    'ein Vermerk des laufenden Laufs schlaegt den frueheren');
// 💣 EIN EINZELN UEBERNOMMENES OBJEKT IST KEIN VERBUND MEHR -- auch wenn es frueher einer war.
assert(avesmapsGaretienVerbundAngelegtLaufuebergreifend([$done('region-neu')], 'Silker Hain') === '',
    'ein uebernommenes Item OHNE Verbund im laufenden Lauf entscheidet -- der alte Vermerk zaehlt nicht');

// =================================================================================================
// B. Der ECHTE Aufbau ueber zwei und drei Laeufe.
// =================================================================================================

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$alke = static function (PDO $pdo): array {
    foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
        if ($o['name'] === 'Alke') {
            return $o;
        }
    }
    throw new RuntimeException('Alke nicht gefunden');
};
$basisItemDesOffenenLaufs = static function (PDO $pdo): int {
    $lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
    assert($lauf !== null, 'Vorbedingung: ein offener Lauf');
    $ids = $pdo->prepare(
        "SELECT id FROM sync_plan_item WHERE run_id = :r AND entity_key LIKE 'ggp:Gewaesser:Bach:Garetien:Alke!Alke%' ORDER BY id"
    );
    $ids->execute([':r' => (int) $lauf['id']]);
    $alle = $ids->fetchAll(PDO::FETCH_COLUMN);
    assert(count($alle) === 2, 'Vorbedingung: die Alke traegt zwei Items, nicht ' . count($alle));
    return (int) $alle[1];   // ORDER BY id: erst die Ergaenzung, dann das Basis-Item
};
$setze = static function (PDO $pdo, int $id, ?string $state, ?string $note): void {
    $pdo->prepare('UPDATE sync_plan_item SET apply_state = :s, apply_note = :n WHERE id = :id')
        ->execute([':s' => $state, ':n' => $note, ':id' => $id]);
};

// Lauf 1: die Alke ist als Teil des Verbunds „Alke-Verbund" uebernommen.
$idLauf1 = $basisItemDesOffenenLaufs($pdo);
$setze($pdo, $idLauf1, 'done', avesmapsGaretienVerbundVermerk('area-1', 'region-1', 'Alke-Verbund'));
assert($alke($pdo)['verbund_angelegt'] === 'Alke-Verbund', 'Vorbedingung: im selben Lauf gefaltet');

// 🔴 BESTAND (Vertrag „Der Bestand", Owner 14.09.2026): der Importer ist live. Im selben alten Lauf
// liegen ein EINZELN uebernommenes Objekt mit NACKTEM Vermerk (nur eine public_id, die Form vor dem
// Verbund-Umbau) und eine ABGELEHNTE Zeile. Beide muessen nach dem naechsten Lauf unveraendert je
// EINE Zeile bleiben -- kein Verbund, kein Fehler, kein neuer Stand.
$lauf1 = (int) avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
$itemVon = static function (PDO $pdo, int $lauf, string $muster): array {
    $stmt = $pdo->prepare('SELECT id, entity_key, change_type FROM sync_plan_item WHERE run_id = :r AND entity_key LIKE :m ORDER BY id');
    $stmt->execute([':r' => $lauf, ':m' => $muster]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    assert(is_array($zeile), 'Vorbedingung: ein Item fuer ' . $muster);
    return $zeile;
};
$gardel = $itemVon($pdo, $lauf1, 'ggp:Gewaesser:Fluss:Garetien:Gardel!Gardel%');
$setze($pdo, (int) $gardel['id'], 'done', 'region-gardel-alt');
$muehlsee = $itemVon($pdo, $lauf1, 'ggp:Gewaesser:See:Garetien:Muehlsee%');
// ⚠️ Direkt geschrieben: avesmapsSyncPlanRecordDecline ist MySQL-Syntax (ON DUPLICATE KEY, UTC_TIMESTAMP).
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (:k, :e, :c, '2026-09-01 10:00:00')")
    ->execute([':k' => AVESMAPS_GARETIEN_PLAN_KIND, ':e' => $muehlsee['entity_key'], ':c' => $muehlsee['change_type']]);

// 💣 FEHLER 8: nach „Holen & Rechnen" stehen die frischen Items auf `apply_state = null` -- der
// Reiter las nur sie und verlor die Faltung. Der Vermerk des ALTEN Laufs muss durchdringen.
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
$nachNeuemLauf = $alke($pdo);
assert($nachNeuemLauf['verbund_angelegt'] === 'Alke-Verbund',
    'nach einem neuen Lauf faltet „Uebernommen" weiter aus dem Vermerk des frueheren Laufs: '
    . json_encode($nachNeuemLauf['verbund_angelegt']));

$nachName = static function (PDO $pdo, string $name): array {
    $treffer = array_values(array_filter(
        avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'],
        static fn(array $o): bool => $o['name'] === $name
    ));
    assert(count($treffer) === 1, $name . ' steht genau EINMAL in der Liste, nicht ' . count($treffer) . '-mal');
    return $treffer[0];
};
$gardelNeu = $nachName($pdo, 'Gardel');
assert($gardelNeu['stand'] === 'uebernommen', 'BESTAND: das einzeln uebernommene Objekt bleibt „uebernommen": ' . $gardelNeu['stand']);
assert($gardelNeu['verbund_angelegt'] === '', 'BESTAND: ein nackter alter Vermerk ist KEIN Verbund');
// ⚠️ Der Name ist der ARTIKEL („Muehlsee"), nicht die Anzeige („Mühlsee") -- Fall #118.
$muehlseeNeu = $nachName($pdo, 'Muehlsee');
assert($muehlseeNeu['stand'] === 'abgelehnt', 'BESTAND: die abgelehnte Zeile bleibt abgelehnt: ' . $muehlseeNeu['stand']);
assert($muehlseeNeu['verbund_angelegt'] === '', 'BESTAND: und wird nirgends einem Verbund zugeschlagen');
$uebernommen = avesmapsGaretienArbeitsliste($pdo, 1, ['stand' => 'uebernommen'])['objekte'];
assert(count(array_filter($uebernommen, static fn(array $o): bool => $o['name'] === 'Gardel')) === 1,
    'BESTAND: auf dem Reiter „Uebernommen" steht das alte Einzelobjekt als eine Zeile');

// Lauf 2 uebernimmt die Alke EINZELN (nach einer Ruecknahme, ohne Verbund) -- der juengste Lauf entscheidet.
$idLauf2 = $basisItemDesOffenenLaufs($pdo);
assert($idLauf2 !== $idLauf1, 'Vorbedingung: der zweite Lauf hat eigene Items');
$setze($pdo, $idLauf2, 'done', 'region-einzeln');
assert($alke($pdo)['verbund_angelegt'] === '',
    'uebernimmt der laufende Lauf das Objekt ohne Verbund, gilt der alte Vermerk nicht mehr');

// Lauf 3: jetzt liegen ZWEI fruehere Laeufe vor -- der juengere (Lauf 2, ohne Verbund) entscheidet,
// nicht der aeltere (Lauf 1, mit Verbund).
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
assert($alke($pdo)['verbund_angelegt'] === '',
    'unter mehreren frueheren Laeufen entscheidet der JUENGSTE, der das Objekt uebernommen hat: '
    . json_encode($alke($pdo)['verbund_angelegt']));

// Ein zurueckgenommenes Item traegt keinen Vermerk mehr (garetien-uebernahme.php setzt
// `apply_state = NULL, apply_note = NULL`) -- dann rueckt der aeltere Lauf nach.
$setze($pdo, $idLauf2, null, null);
assert($alke($pdo)['verbund_angelegt'] === 'Alke-Verbund',
    'ist der Vermerk des juengeren Laufs zurueckgenommen, gilt wieder der aeltere');

// Ein Objekt ganz ohne frueheren Vermerk bleibt leer.
foreach (avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte'] as $o) {
    if ($o['name'] === 'Gardel') {
        assert($o['verbund_angelegt'] === '', 'die Gardel war nie Teil eines Verbunds');
    }
}

echo "OK -- garetien-verbund-liste-laeufe\n";
```

Datei `js/review/__tests__/garetien-uebernommen-falten-schluessel.test.js`:

```js
// Aufgabe 4 (Garetien-Importer vereint, 14.09.2026): „Übernommen" faltet laufübergreifend -- und
// dann darf der STAMM allein nicht mehr falten.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §6.8
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-uebernommen-falten-schluessel.test.js
//
// 💣 DER VERMERK TRAEGT NUR DEN STAMM (`verbund:<stamm>`, garetien-uebernahme.php). Seit der
// Server die Vermerke ALLER Laeufe liest, liegen im Reiter „Uebernommen" Verbuende aus Wochen
// nebeneinander -- ein Wald „Silker Hain" und ein Huegel „Silker Hain" fielen mit dem Stamm
// allein zu EINER Zeile zusammen, und ihr Haekchen waehlte beide. Dieselbe Regel wie beim
// Verbundschluessel (garetienVerbundSchluessel): Ebene UND Typ gehoeren hinein.
// ⚠️ Gemessen am ECHTEN Renderweg (avesmapsGaretienListeHolen -> #garetien-list), nicht am Quelltext.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api, dom } = ladeImporter(["garetien-listcol", "garetien-tabs"]);

function fragment(key, ebene, typ, stamm) {
	return { key: key, name: key, ebene: ebene, typ: typ, verbund_angelegt: stamm, stand: "uebernommen" };
}

// ---- A. Die reinen Funktionen ------------------------------------------------------------------
{
	const objekte = [
		fragment("wald1", "Waelder", "Wald", "Silker Hain"),
		fragment("huegel1", "Berge", "Huegel", "Silker Hain"),
		fragment("wald2", "Waelder", "Wald", "Silker Hain"),
		fragment("huegel2", "Berge", "Huegel", "Silker Hain"),
	];
	const gefaltet = api.garetienUebernommenFalten(objekte);
	gleich(gefaltet.map((o) => o.key).join(","), "wald1,huegel1",
		"gleicher Stamm, verschiedene Ebene/Typ -> ZWEI Zeilen, nicht eine");
	gleich(api.garetienUebernommenMitglieder(objekte[0], objekte).map((o) => o.key).join(","), "wald1,wald2",
		"🔴 die Mitglieder der gefalteten Zeile folgen DEMSELBEN Schluessel -- sonst waehlte das "
		+ "Haekchen des Waldes den Huegel mit");
	gleich(api.garetienUebernommenMitglieder(objekte[1], objekte).map((o) => o.key).join(","), "huegel1,huegel2",
		"und die Huegel-Zeile traegt nur ihre Huegel");
}

// Ohne Vermerk bleibt jedes Objekt sein eigenes Mitglied -- auch bei gleicher Ebene und gleichem Typ.
{
	const a = fragment("a", "Waelder", "Wald", "");
	const b = fragment("b", "Waelder", "Wald", "");
	gleich(api.garetienUebernommenFalten([a, b]).length, 2, "Objekte ohne Vermerk falten nie");
	gleich(api.garetienUebernommenMitglieder(a, [a, b]).length, 1, "und haben sich selbst als einziges Mitglied");
}

// ---- B. Der echte Renderweg ---------------------------------------------------------------------
function zeilenSchluessel() {
	const treffer = dom.html("#garetien-list").match(/data-key="[^"]*"/g) || [];
	return treffer.map((t) => t.slice('data-key="'.length, -1));
}

(async function () {
	api.garetienReiterSetzen("uebernommen");
	const objekte = [
		fragment("wald1", "Waelder", "Wald", "Silker Hain"),
		fragment("wald2", "Waelder", "Wald", "Silker Hain"),
		fragment("huegel1", "Berge", "Huegel", "Silker Hain"),
	];
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7, reiter: {} }) });
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
	gleich(zeilenSchluessel().join(","), "wald1,huegel1",
		"auf „Uebernommen\" stehen Wald-Verbund und Huegel gleichen Stammes als zwei Zeilen");
	gleich((dom.html("#garetien-list").match(/2 Fragmente/g) || []).length, 1,
		"die Marke zaehlt nur die Mitglieder IHRES Verbunds: der Wald traegt „2 Fragmente\", der Huegel keine");

	console.log("OK: " + checks + " Pruefungen (garetien-uebernommen-falten-schluessel)");
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-liste-laeufe-test.php
node js/review/__tests__/garetien-uebernommen-falten-schluessel.test.js
```
Erwartet (im Wegwerf-Worktree gesehen): `PHP Fatal error:  Uncaught Error: Call to undefined function avesmapsGaretienVerbundAngelegtLaufuebergreifend()` und `AssertionError [ERR_ASSERTION]: gleicher Stamm, verschiedene Ebene/Typ -> ZWEI Zeilen, nicht eine` (actual `'wald1'`, expected `'wald1,huegel1'`).

- [ ] **Schritt 3: Umsetzen**

In `api/_internal/import/garetien-liste.php`:

**Stelle 1** — ersetze:

```php
    return avesmapsGaretienVermerkLesen((string) ($item['apply_note'] ?? ''))['verbund'];
}
```

durch:

```php
    return avesmapsGaretienVermerkLesen((string) ($item['apply_note'] ?? ''))['verbund'];
}

/**
 * Der angelegte Verbund eines Objekts, LAUFUEBERGREIFEND. REIN -- kein I/O.
 *
 * 💣 FEHLER 8 (Entwurf 2026-09-14 §1): `apply_state = 'done'` stirbt mit dem Lauf. Nach jedem
 * „Holen & Rechnen" stehen die frischen Items auf `null`, und der Reiter „Uebernommen" las nur
 * sie -- die Faltung eines Verbunds verschwand, obwohl er genau so auf der Karte liegt.
 * 🔴 DER LAUFENDE LAUF ENTSCHEIDET, SOBALD ER EIN UEBERNOMMENES ITEM TRAEGT -- auch wenn dessen
 * Vermerk KEINEN Verbund nennt. Ein zurueckgenommenes und danach einzeln uebernommenes Fragment
 * ist kein Verbund mehr; der alte Vermerk wuerde es sonst weiter mit seinen Geschwistern falten.
 * Erst ohne jedes uebernommene Item gilt `$frueher` (avesmapsGaretienVerbundVermerkeFruehererLaeufe).
 * ⚠️ Innerhalb des laufenden Laufs gewinnt weiter der ERSTE Vermerk -- dieselbe Regel wie bisher.
 *
 * @param list<array{apply_state:?string, apply_note:string}> $items
 */
function avesmapsGaretienVerbundAngelegtLaufuebergreifend(array $items, string $frueher): string
{
    $hatUebernommenes = false;
    foreach ($items as $item) {
        if ((string) ($item['apply_state'] ?? '') !== 'done') {
            continue;
        }
        $hatUebernommenes = true;
        $stamm = avesmapsGaretienVerbundAngelegt($item);
        if ($stamm !== '') {
            return $stamm;
        }
    }

    return $hatUebernommenes ? '' : $frueher;
}

/**
 * Die Verbund-Vermerke aller FRUEHEREN Laeufe dieser Art: Objektschluessel => Stamm (oder '').
 *
 * 🔴 JE OBJEKT ENTSCHEIDET DER JUENGSTE FRUEHERE LAUF, der es uebernommen hat -- sortiert wird
 * deshalb nach `run_id DESC`, und sobald ein Objekt einem Lauf zugeordnet ist, zaehlen aeltere
 * Laeufe nicht mehr. Innerhalb dieses Laufs gewinnt der erste Vermerk mit Verbund (`id ASC`).
 * ⚠️ Ein zurueckgenommenes Item traegt keinen Vermerk mehr (die Ruecknahme setzt
 * `apply_state = NULL, apply_note = NULL`), faellt also von selbst heraus -- dann rueckt der
 * naechstaeltere Lauf nach.
 * ⚠️ `avesmapsSyncPlanAufraeumen` loescht nur Items mit `apply_state IS NULL`; uebernommene
 * Items ueberholter Laeufe bleiben stehen, und genau von ihnen lebt diese Abfrage.
 * ⚠️ EINE Abfrage je Listenabruf, ueber `idx_sync_plan_run_kind_state` und
 * `idx_sync_plan_item_apply` -- keine Schleife je Objekt (AGENTS.md §10, STRATO).
 *
 * @return array<string, string>
 */
function avesmapsGaretienVerbundVermerkeFruehererLaeufe(PDO $pdo, int $planRunId): array
{
    $stmt = $pdo->prepare(
        "SELECT i.run_id, i.entity_key, i.apply_note FROM sync_plan_item i"
        . " JOIN sync_plan_run r ON r.id = i.run_id"
        . " WHERE r.kind = :k AND i.run_id <> :aktuell AND i.apply_state = 'done'"
        . " AND i.apply_note IS NOT NULL AND i.apply_note <> ''"
        . " ORDER BY i.run_id DESC, i.id ASC"
    );
    $stmt->execute([':k' => AVESMAPS_GARETIEN_PLAN_KIND, ':aktuell' => $planRunId]);

    $laufJeObjekt = [];
    $raus = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $schluessel = avesmapsGaretienObjektSchluessel((string) $zeile['entity_key']);
        $lauf = (int) $zeile['run_id'];
        if (!array_key_exists($schluessel, $laufJeObjekt)) {
            $laufJeObjekt[$schluessel] = $lauf;
            $raus[$schluessel] = '';
        }
        if ($laufJeObjekt[$schluessel] !== $lauf || $raus[$schluessel] !== '') {
            continue;
        }
        $raus[$schluessel] = avesmapsGaretienVermerkLesen((string) $zeile['apply_note'])['verbund'];
    }

    return $raus;
}
```

**Stelle 2** — ersetze:

```php
    // 4. Objekte MIT Item bauen -- Name/Typ/Wiki/Ebene/Geometrie/Wiki-Link aus dem after des
```

durch:

```php
    // 🔴 Aufgabe 4 (2026-09-14): die Verbund-Vermerke der FRUEHEREN Laeufe, EINMAL je Listenbau.
    $fruehereVerbuende = avesmapsGaretienVerbundVermerkeFruehererLaeufe($pdo, $planRunId);

    // 4. Objekte MIT Item bauen -- Name/Typ/Wiki/Ebene/Geometrie/Wiki-Link aus dem after des
```

**Stelle 3** — ersetze:

```php
            // Entwurf §7: „Uebernommen" zeigt einen Verbund als EINE Zeile. Der ERSTE Vermerk
            // gewinnt -- alle Fragmente eines Verbunds tragen denselben Stamm, und der Reiter
            // braucht nur einen.
            'verbund_angelegt' => (static function (array $items): string {
                foreach ($items as $i) {
                    $stamm = avesmapsGaretienVerbundAngelegt($i);
                    if ($stamm !== '') {
                        return $stamm;
                    }
                }
                return '';
            })($items),
```

durch:

```php
            // Entwurf §7: „Uebernommen" zeigt einen Verbund als EINE Zeile. Der ERSTE Vermerk
            // gewinnt -- alle Fragmente eines Verbunds tragen denselben Stamm, und der Reiter
            // braucht nur einen.
            // 🔴 LAUFUEBERGREIFEND (Aufgabe 4, 2026-09-14, Fehler 8): ohne uebernommenes Item im
            // laufenden Lauf gilt der Vermerk des juengsten frueheren Laufs.
            'verbund_angelegt' => avesmapsGaretienVerbundAngelegtLaufuebergreifend(
                $items,
                $fruehereVerbuende[$key] ?? ''
            ),
```

In `js/review/review-garetien-importer.js`:

**Stelle 1** — ersetze:

```js
	function garetienUebernommenFalten(objekte) {
		const gesehen = new Set();
		return (objekte || []).filter(function (o) {
			const stamm = String((o && o.verbund_angelegt) || "");
			if (stamm === "") { return true; }
			if (gesehen.has(stamm)) { return false; }
			gesehen.add(stamm);
			return true;
		});
	}
```

durch:

```js
	function garetienUebernommenFalten(objekte) {
		const gesehen = new Set();
		return (objekte || []).filter(function (o) {
			const schluessel = garetienUebernommenFaltSchluessel(o);
			if (schluessel === "") { return true; }
			if (gesehen.has(schluessel)) { return false; }
			gesehen.add(schluessel);
			return true;
		});
	}

	/*
	 * REIN: unter welchem Schluessel faltet „Uebernommen" dieses Objekt -- "" ohne Vermerk.
	 *
	 * 💣 DER VERMERK TRAEGT NUR DEN STAMM, UND SEIT AUFGABE 4 (14.09.2026) KOMMT ER AUS ALLEN
	 * LAEUFEN. Ein Wald und ein Huegel gleichen Stammes fielen mit dem Stamm allein zu EINER Zeile
	 * zusammen, und ihr Haekchen waehlte beide. Ebene und Typ gehoeren deshalb hinein -- dieselbe
	 * Regel und dieselbe Begruendung wie beim Verbundschluessel (garetienVerbundSchluessel).
	 * 🔴 EIN Schluessel fuer beide Leser: garetienUebernommenFalten UND garetienUebernommenMitglieder.
	 */
	function garetienUebernommenFaltSchluessel(objekt) {
		const o = objekt || {};
		const stamm = String(o.verbund_angelegt || "");
		if (stamm === "") { return ""; }
		return String(o.ebene || "") + "|" + String(o.typ || "") + "|" + stamm;
	}
```

**Stelle 2** — ersetze:

```js
	function garetienUebernommenMitglieder(objekt, objekte) {
		if (!objekt) { return []; }
		const stamm = String(objekt.verbund_angelegt || "");
		if (stamm === "") { return [objekt]; }
		return (objekte || []).filter(function (o) {
			return String((o && o.verbund_angelegt) || "") === stamm;
		});
	}
```

durch:

```js
	function garetienUebernommenMitglieder(objekt, objekte) {
		if (!objekt) { return []; }
		const schluessel = garetienUebernommenFaltSchluessel(objekt);
		if (schluessel === "") { return [objekt]; }
		return (objekte || []).filter(function (o) {
			return garetienUebernommenFaltSchluessel(o) === schluessel;
		});
	}
```

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-verbund-liste-laeufe-test.php
node js/review/__tests__/garetien-uebernommen-falten-schluessel.test.js
node js/review/__tests__/garetien-uebernommen-falten.test.js
node js/review/__tests__/garetien-uebernommen-verbund-haekchen.test.js
for t in api/_internal/import/__tests__/garetien-*-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```
Erwartet: `OK -- garetien-verbund-liste-laeufe`, `OK: 7 Pruefungen (garetien-uebernommen-falten-schluessel)`, `OK: 14 Pruefungen (garetien-uebernommen-falten)`, `OK: 34 Pruefungen (garetien-uebernommen-verbund-haekchen)`; beide Schleifen ohne `ROT:` (in einer CRLF-Arbeitskopie ggf. der bekannte `quellen-abdeckung-ziel.test.js`). Kein fremder Test ändert sich.

Mutationsprobe (gesehen): `$fruehereVerbuende[$key] ?? ''` → `''` macht den PHP-Test rot mit „nach einem neuen Lauf faltet „Uebernommen" weiter aus dem Vermerk des frueheren Laufs: """.

🔧 DU: Reiter „Übernommen" nach einem „Holen & Rechnen" öffnen — ein zusammengelegt übernommener Verbund steht weiter als EINE Zeile; alte Einzelübernahmen und abgelehnte Objekte stehen unverändert je als eine Zeile.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-liste.php
git add js/review/review-garetien-importer.js
git add api/_internal/import/__tests__/garetien-verbund-liste-laeufe-test.php
git add js/review/__tests__/garetien-uebernommen-falten-schluessel.test.js
git commit -F- <<'EOF'
ui(garetien-importer): „Übernommen" zeigt einen Verbund auch nach „Holen & Rechnen" als eine Zeile

Der Reiter las den Verbund-Vermerk nur aus dem laufenden Lauf; apply_state
stirbt mit dem Lauf, und nach jedem Holen & Rechnen zerfiel die Faltung
(Fehler 8). Jetzt gelten auch die Vermerke frueherer Laeufe -- der laufende
entscheidet, sobald er ein uebernommenes Item traegt, sonst der juengste
fruehere. Eine Abfrage je Listenabruf.

Im Browser faltet der Reiter nach Ebene|Typ|Stamm: der Vermerk traegt nur den
Stamm, und ein Wald und ein Huegel gleichen Namens fielen sonst zusammen.
Alte Vermerke ohne verbund: bleiben lesbar und falten nie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 5: Suche und Filter wirken auf der Stage; Filter „nur Verbünde"

**Deckt Entwurf §1 Widerspruch 7, §7 (Suche, Objekttyp, „nur Verbünde") und §6.6 (Trockenlauf der Wege-Verbünde) ab.** Sichtbar — einzeln live, mit Blick des Owners.

💣 **Die Sperre fallen zu lassen genügt nicht.** Gefiltert wird nur am Server; die Stage-Antwort entsteht im Browser (`garetienStageAntwortBauen`, RULING R5) und las keinen Filter. Ohne `garetienStageFilterAnwenden` wären Suchfeld und Trichter bedienbar und wirkungslos — der Test misst deshalb die gerenderten ZEILEN über den echten `input`-Zuhörer und den `applyFilter`-Ruf, nicht `disabled`.

🔴 **Alle Abschnitte des Trichters wirken auf der Stage** (Ebene, Objekttyp, Urteil, Wiki, „nur mehrteilig", „nur Verbünde", Suche) — mit derselben Semantik wie `avesmapsGaretienListeObjektPasstFilter` (leere Liste = kein Filter). Ein sichtbarer Chip „Urteil: neu", der auf der Stage nichts tut, wäre derselbe Fehler wie die gefallene Sperre. Gefiltert wird nur die LISTE: Karte, Fußknopf und „Alle zentrieren" lesen weiter `avesmapsGaretienStageListe()`; `reiter.stage` bleibt die Größe der ganzen Stage.

🔴 **`garetienStageFilterSperreSetzen` heißt jetzt `garetienStageHinweisSetzen`** und blendet nur noch den Hinweis ein — ohne den Satz „Suche und Filter wirken hier nicht". Kein `disabled = false` zum Zurücksetzen: niemand setzt es noch.

💣 **Die Naht Browser → Endpunkt.** Der Browser schickt `nur_verbuende` als ZAHL (1/0). Ein `=== true` wie bei `nur_mehrteilig` (`api/edit/map/garetien-import.php` ~:210) verwürfe die 1 still, und der Filter täte auf den Server-Reitern nichts — dieselbe Klasse wie `anzahl` bis zum 31.08.2026. Der neue PHP-Test FÜHRT den Ausdruck des Endpunkts aus (`eval` auf den eigenen Quelltext, begründet im Test).

💣 **Kein Kommentar im Listen-Literal, und der Aktionsname nie wörtlich im Kommentar darüber.** `garetien-endpunkt-test.php` (~:277) sucht die Listen-Rümpfe am wörtlichen `action: "liste"` und liest ab dort ein Bytefenster — Literal und dahinter angehängte Felder. Gemessen: mit der neuen Zeile lag `rumpf.anzahl` 3 Bytes hinter dem alten 600-Byte-Fenster (Wächter meldete „der Deckel reist nicht mit"), ein Kommentar im Literal schob es weiter hinaus, und ein wörtlicher Aktionsname im Kommentar zählte als dritter Rumpf. Das Fenster wird auf 900 Bytes geweitet; das ist eine Messgrenze, keine Aussage über den Rumpf.

💣 **Bestand: „nur Verbünde" ist auf einem alten Lauf IMMER leer.** Jeder Lauf von vor der Verbund-Erkennung trägt in `after_json` weder `verbund_stamm` noch `verbund_n` (keine Migration). Ohne eigenen Satz stünde dort „Keine Objekte in dieser Ansicht." und der Editor hielte den Filter für kaputt. Der Server zählt deshalb vor dem Filtern `verbund_objekte` über den ganzen Lauf, und die leere Liste sagt:
- `verbund_objekte === 0` (oder Feld fehlt): **„In diesem Lauf ist kein Verbund erkannt. Verbünde erkennt „Holen & Rechnen“ — ein Lauf, der vor dieser Erkennung gerechnet wurde, trägt noch keine."**
- sonst: **„Kein Verbund in dieser Ansicht — ein anderer Filter oder der Reiter blendet sie aus."**
- ohne „nur Verbünde" unverändert „Keine Objekte in dieser Ansicht."

⚠️ Die Facettenzahlen im Trichter zählen weiterhin den LAUF, nicht die Stage — auf dem Reiter „Stage" passen sie nicht zur Liste. Bewusst nicht geändert (eine im Browser gerechnete Zahl aus einer Teilmenge wäre die zweite Wahrheit).

**Bestand:** Keine Reparatur. Auf einem alten Lauf ist „nur Verbünde" leer und sagt warum; erst das nächste „Holen & Rechnen" (nach Aufgabe 1) füllt `verbund_n`. Suche und die übrigen Filter wirken auf alten wie neuen Stage-Objekten gleich.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (Skelett-Hinweis ~:1709; `garetienStageFilterSperreSetzen` ~:1885 → `garetienStageHinweisSetzen`; `avesmapsGaretienListeRendern` ~:2032 und leere Liste ~:2062; neu `garetienStageFilterAnwenden` + `garetienLeereListeText`, `garetienStageAntwortBauen` ~:2349; `avesmapsGaretienListeHolen` ~:2386; `AVESMAPS_GARETIEN_NUR_LABEL` ~:2476; `garetienNurZeigenOptionen` ~:2521; `garetienFilterAnwenden` ~:2629; Export ~:9685)
- Ändern: `api/_internal/import/garetien-liste.php` (`avesmapsGaretienListeObjektPasstFilter` ~:457, `avesmapsGaretienArbeitsliste` ~:926/:956/:1021)
- Ändern: `api/edit/map/garetien-import.php` (`liste`-Zweig ~:210)
- Test: `js/review/__tests__/garetien-anzeige-filtersperre.test.js` (umgedreht, ganz ersetzt)
- Test: `api/_internal/import/__tests__/garetien-liste-nur-verbuende-test.php` (neu)
- Fremd: `api/_internal/import/__tests__/garetien-endpunkt-test.php` (Bytefenster ~:278)

**Schnittstellen:**
- Nutzt: `zustand.filter`, `garetienFilterState.nur`, `avesmapsGaretienStageListe(): object[]`, `avmFilterMenuAttach(toggleId, menuId, abschnitte, applyFilter, label)`, `avesmapsGaretienListeObjektPasstFilter(array $objekt, array $filter): bool`
- Liefert: `garetienStageFilterAnwenden(objekte: Array, filter: object): Array` · `zustand.filter.nurVerbuende: boolean` (Trichterwert `verbuende`, Beschriftung „nur Verbünde") · Listen-Rumpf `nur_verbuende: 1|0` · Filterfeld `nur_verbuende: bool` (LISTE) · Antwortfeld `verbund_objekte: int` · `garetienLeereListeText(filter, antwort): string` · `garetienStageHinweisSetzen(): void` (ersetzt `garetienStageFilterSperreSetzen`)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/review/__tests__/garetien-anzeige-filtersperre.test.js` (ersetzt die alte Datei ganz — sie prüfte die Sperre):

```js
// Aufgabe 5 (Garetien-Importer vereint, 14.09.2026): Suche und Filter WIRKEN auf der Stage.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §1 Widerspruch 7, §7
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-anzeige-filtersperre.test.js
//
// 🔴 DIESE DATEI PRUEFTE BIS ZUM 14.09.2026 DAS GEGENTEIL: RULING R7 sperrte Suchfeld und
// Filterknopf auf dem Reiter „Stage" und schrieb „Suche und Filter wirken hier nicht" daneben.
// Der Owner-Entscheid (Workflow, Usability) hat das umgedreht; der Dateiname bleibt, damit die
// Geschichte an EINER Stelle steht.
// 💣 DIE SPERRE FALLEN ZU LASSEN GENUEGT NICHT (Entwurf §7): gefiltert wurde nur auf dem Server,
// die Stage-Antwort entsteht im Browser (garetienStageAntwortBauen) und las keinen Filter. Ohne
// Filter im Browser waeren Suchfeld und Knopf bedienbar und wirkungslos -- deshalb misst dieser
// Test die gerenderten ZEILEN, nicht nur `disabled`.
// ⚠️ Gefahren wird der ECHTE Weg: der Reiterklick, der `input`-Zuhoerer des Suchfelds und der
// `applyFilter`-Ruf, den avmFilterMenuAttach bekommt -- nie ein direkter Aufruf der Renderfunktion.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(bedingung, warum) { assert.ok(bedingung, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

// Der geteilte Trichter (js/ui/filter-menu.js) laeuft unter Node nicht -- seine Attrappe merkt sich
// genau das, was der Importer ihm uebergibt: die Abschnitte und den applyFilter-Ruf.
let angemeldeterFilterRuf = null;
let angemeldeteAbschnitte = null;
global.avmFilterMenuAttach = function (toggleId, menuId, abschnitte, applyFilter) {
	angemeldeteAbschnitte = abschnitte;
	angemeldeterFilterRuf = applyFilter;
	return function () {};
};

const { api, dom, ELEMENTE } = ladeImporter([
	"garetien-listcol", "garetien-tabs", "garetien-search", "garetien-filter-toggle",
	"garetien-filter-menu", "garetien-anzeige-hinweis", "garetien-neutral-hinweis",
	"garetien-detailcol", "garetien-chips",
]);

const SUCHE = ELEMENTE["garetien-search"];
const FILTER_TOGGLE = ELEMENTE["garetien-filter-toggle"];
const HINWEIS = ELEMENTE["garetien-anzeige-hinweis"];
const TABS = ELEMENTE["garetien-tabs"];

function klickTab(stand) {
	const knopf = { getAttribute: (n) => (n === "data-stand" ? stand : null) };
	const ziel = { closest: (sel) => (sel === ".avm-tab" ? knopf : null) };
	(TABS._hoerer.click || []).forEach((fn) => fn({ target: ziel }));
}
function zeilenSchluessel() {
	const treffer = dom.html("#garetien-list").match(/data-key="[^"]*"/g) || [];
	return treffer.map((t) => t.slice('data-key="'.length, -1)).join(",");
}
function warten(ms) { return new Promise((r) => setTimeout(r, ms)); }

// =================================================================================================
// A. Die REINE Regel -- dieselbe Semantik wie avesmapsGaretienListeObjektPasstFilter (Server).
// =================================================================================================
wahr(typeof api.garetienStageFilterAnwenden === "function", "garetienStageFilterAnwenden fehlt im Export");

const hain1 = { key: "h1", name: "Silker Hain 1", typ: "Wald", ebene: "Waelder", urteil: "neu",
	wiki: "ggp", abschnitte: [], verbund_stamm: "Silker Hain", verbund_n: 2 };
const hain2 = { key: "h2", name: "Silker Hain 2", typ: "Wald", ebene: "Waelder", urteil: "widerspruch",
	wiki: "ggp", abschnitte: [], verbund_stamm: "Silker Hain", verbund_n: 2 };
const heide = { key: "hd", name: "Silker Heide", typ: "Heide", ebene: "Waelder", urteil: "neu",
	wiki: "ggp", abschnitte: [{ public_id: "a" }, { public_id: "b" }] };
const natter = { key: "n", name: "Natter", typ: "Fluss", ebene: "Gewaesser", urteil: "deckt_sich",
	wiki: "kosch", abschnitte: [] };
const alle = [hain1, hain2, heide, natter];
const schluessel = (liste) => liste.map((o) => o.key).join(",");

gleich(schluessel(api.garetienStageFilterAnwenden(alle, {})), "h1,h2,hd,n", "ohne Filter bleibt alles");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { suche: "  HEIDE " })), "hd",
	"Suche: Teiltreffer im Namen, Gross/klein egal, Leerraum getrimmt");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { typ: ["Wald"] })), "h1,h2", "Objekttyp");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { typ: [] })), "h1,h2,hd,n",
	"eine LEERE Liste heisst „kein Filter\", nicht „nichts passt\" -- wie am Server");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { nurVerbuende: true })), "h1,h2",
	"nur Verbuende: verbund_n >= 2");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { ebene: ["Gewaesser"] })), "n",
	"🔴 auch Ebene wirkt -- ein sichtbarer Chip, der nichts tut, waere derselbe Fehler wie die Sperre");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { urteil: ["widerspruch"] })), "h2", "Urteil");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { wiki: ["kosch"] })), "n", "Wiki");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { nur_mehrteilig: true })), "hd", "nur mehrteilig");
gleich(schluessel(api.garetienStageFilterAnwenden(alle, { suche: "silker", typ: ["Wald"], nurVerbuende: true })),
	"h1,h2", "die Bedingungen gelten zugleich");

// =================================================================================================
// B. Der echte Weg auf dem Reiter „Stage".
// =================================================================================================
(async function () {
	// Erster Aufbau (Reiter „offen"): das Skelett wird verdrahtet, der Trichter angemeldet.
	api.avesmapsGaretienListeRendern({ objekte: [], reiter: {}, bilanz: {}, gesamt: 0, facetten: {} });
	wahr(typeof angemeldeterFilterRuf === "function", "der Filtertrichter wurde angemeldet");

	api.avesmapsGaretienStageHinzufuegen(alle);
	klickTab("stage");
	gleich(SUCHE.disabled, false, "🔴 auf dem Reiter Stage ist die Suche bedienbar");
	gleich(FILTER_TOGGLE.disabled, false, "und der Filterknopf ebenso");
	gleich(zeilenSchluessel(), "h1,h2,hd,n", "ohne Filter stehen alle vier Stage-Objekte da");
	wahr(!api.garetienListeSkelettMarkup().includes("wirken hier nicht"),
		"der Satz „Suche und Filter wirken hier nicht\" ist gefallen");
	gleich(HINWEIS.hidden, false, "der Hinweis der Stage steht weiter da -- nur ohne den falschen Satz");

	// Die Suche: der ECHTE `input`-Zuhoerer, entprellt.
	SUCHE.value = "hain";
	(SUCHE._hoerer.input || []).forEach((fn) => fn());
	await warten(300);
	gleich(zeilenSchluessel(), "h1,h2", "💣 die Suche WIRKT auf der Stage -- nicht nur bedienbar");
	gleich(api.avesmapsGaretienStageListe().length, 4, "und die Stage selbst bleibt unangetastet");

	// Objekttyp ueber den applyFilter-Ruf des Trichters.
	SUCHE.value = "";
	(SUCHE._hoerer.input || []).forEach((fn) => fn());
	await warten(300);
	api.garetienFilterState.typ.add("Heide");
	angemeldeterFilterRuf();
	gleich(zeilenSchluessel(), "hd", "der Objekttyp-Filter WIRKT auf der Stage");
	api.garetienFilterState.typ.clear();

	// „nur Verbuende": die Option steht im Abschnitt „Nur zeigen" und wirkt.
	const nurAbschnitt = angemeldeteAbschnitte.filter((a) => a.menuId === "garetien-filter-nur-menu")[0];
	const nurOptionen = nurAbschnitt.getOptions();
	wahr(nurOptionen.some((o) => o.value === "verbuende" && o.label === "nur Verbünde"),
		"„nur Verbünde\" steht unter „Nur zeigen\": " + JSON.stringify(nurOptionen));
	api.garetienFilterState.nur.add("verbuende");
	angemeldeterFilterRuf();
	gleich(zeilenSchluessel(), "h1,h2", "„nur Verbünde\" wirkt auf der Stage");
	wahr(api.garetienChipsMarkup(api.garetienFilterState).includes("nur Verbünde"),
		"und der Chip nennt ihn beim Namen");

	// Auf einem Server-Reiter reist er im Rumpf mit -- als `nur_verbuende: 1`.
	let rumpf = null;
	global.fetch = function (adresse, optionen) {
		rumpf = JSON.parse(optionen.body);
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: [], reiter: {}, bilanz: {}, facetten: {} }) });
	};
	klickTab("offen");
	await warten(0);
	wahr(rumpf !== null, "der Server-Reiter fragt den Server");
	gleich(rumpf.nur_verbuende, 1, "🔴 der liste-Rumpf traegt `nur_verbuende: 1`");

	// 💣 BESTAND: ein Lauf von vor der Verbund-Erkennung traegt keine Verbund-Felder -- „nur Verbünde"
	// ist dort IMMER leer. Der Editor muss lesen, warum, nicht „Keine Objekte in dieser Ansicht.".
	// Die Antwort oben nennt `verbund_objekte` gar nicht (wie eine Antwort von vor diesem Umbau).
	wahr(dom.html("#garetien-list").includes("In diesem Lauf ist kein Verbund erkannt."),
		"leere „nur Verbünde\"-Liste auf einem Lauf ohne Verbuende sagt, dass erst „Holen & Rechnen\" sie erkennt: "
		+ dom.html("#garetien-list"));
	wahr(dom.html("#garetien-list").includes("Holen &amp; Rechnen"), "und nennt den Knopf beim Namen (escaped)");
	global.fetch = function (adresse, optionen) {
		rumpf = JSON.parse(optionen.body);
		return Promise.resolve({ json: () => Promise.resolve({
			ok: true, objekte: [], reiter: {}, bilanz: {}, facetten: {}, verbund_objekte: 3 }) });
	};
	angemeldeterFilterRuf();
	await warten(0);
	wahr(dom.html("#garetien-list").includes("Kein Verbund in dieser Ansicht"),
		"kennt der Lauf Verbuende, sagt die leere Liste, dass ein Filter oder Reiter sie ausblendet: "
		+ dom.html("#garetien-list"));

	api.garetienFilterState.nur.clear();
	angemeldeterFilterRuf();
	await warten(0);
	wahr(dom.html("#garetien-list").includes("Keine Objekte in dieser Ansicht."),
		"ohne „nur Verbünde\" bleibt der gewohnte Satz");
	gleich(rumpf.nur_verbuende, 0, "ohne den Haken reist `nur_verbuende: 0` -- der Endpunkt liest daraus „kein Filter\"");

	console.log(`garetien-anzeige-filtersperre: ${checks} Pruefungen bestanden.`);
})().catch((fehler) => { console.error(fehler); process.exitCode = 1; });
```

Datei `api/_internal/import/__tests__/garetien-liste-nur-verbuende-test.php`:

```php
<?php

declare(strict_types=1);

// Aufgabe 5 (Garetien-Importer vereint, 14.09.2026): der Filter „nur Verbünde" auf den Server-Reitern.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §7
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-nur-verbuende-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-uebernahme.php';
require_once __DIR__ . '/../garetien-liste.php';

// =================================================================================================
// A. Die Bibliothek: `nur_verbuende` laesst nur Objekte mit verbund_n >= 2 durch.
// =================================================================================================

$basis = ['ebene' => 'Waelder', 'typ' => 'Wald', 'urteil' => 'neu', 'wiki' => 'ggp', 'stand' => 'offen',
          'abschnitte' => [], 'items' => [], 'name' => 'Silker Hain 1'];
$verbund = ['key' => 'v'] + $basis + ['verbund_stamm' => 'Silker Hain', 'verbund_n' => 4];
$einzeln = ['key' => 'e'] + $basis;   // wie am Server: ohne Verbund fehlt das Feld GANZ
$halb = ['key' => 'h'] + $basis + ['verbund_stamm' => 'Silker Hain', 'verbund_n' => 1];

assert(avesmapsGaretienListeObjektPasstFilter($verbund, ['nur_verbuende' => true]) === true,
    'ein Verbund-Fragment passt');
assert(avesmapsGaretienListeObjektPasstFilter($einzeln, ['nur_verbuende' => true]) === false,
    'ein Objekt ohne Verbund faellt heraus -- das Feld fehlt, und das ist KEIN Fehler');
assert(avesmapsGaretienListeObjektPasstFilter($halb, ['nur_verbuende' => true]) === false,
    'verbund_n unter 2 ist kein Verbund');
assert(avesmapsGaretienListeObjektPasstFilter($einzeln, ['nur_verbuende' => false]) === true,
    'ohne den Filter bleibt alles');
assert(avesmapsGaretienListeObjektPasstFilter($einzeln, []) === true, 'und ohne den Schluessel ebenso');
// 🔴 `keys` IST EIN NACHSCHLAG, KEIN FILTER -- er schlaegt auch diesen.
assert(avesmapsGaretienListeObjektPasstFilter($einzeln, ['nur_verbuende' => true, 'keys' => ['e']]) === true,
    'der Stage-Nachschlag (`keys`) findet auch ein Objekt ohne Verbund');

// =================================================================================================
// B. 💣 DIE NAHT: der Browser schickt `nur_verbuende: 1` -- eine ZAHL. Ein Endpunkt, der wie bei
// `nur_mehrteilig` auf `=== true` prueft, verwirft sie still, und der Filter taete auf den
// Server-Reitern NICHTS (dieselbe Klasse wie `anzahl` bis zum 31.08.2026). Der Ausdruck des
// Endpunkts wird deshalb AUSGEFUEHRT, nicht gelesen.
// =================================================================================================

$roh = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php'));
$code = '';
foreach (token_get_all($roh) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $code .= is_array($token) ? $token[1] : $token;
}
$treffer = [];
assert(preg_match("~'nur_verbuende'\s*=>\s*(.+?),\n~", $code, $treffer) === 1,
    'der liste-Zweig des Endpunkts liest `nur_verbuende`');
// ⚠️ `eval` IST HIER GEWOLLT UND UNGEFAEHRLICH: ausgewertet wird ausschliesslich ein Ausdruck aus
// dem eigenen Repo-Quelltext (dem liste-Zweig des Endpunkts), nie eine Eingabe von aussen -- und nur
// so wird die Umwandlung WIRKLICH gefahren statt per Regex behauptet.
$lies = static function (array $payload) use ($treffer): mixed {
    return eval('return ' . $treffer[1] . ';');
};
assert($lies(['nur_verbuende' => 1]) === true, 'die 1 aus dem Browser wird zu `true`: ' . $treffer[1]);
assert($lies(['nur_verbuende' => true]) === true, 'ein `true` ebenso');
assert($lies([]) === false, 'ein fehlendes Feld heisst „kein Filter"');
assert($lies(['nur_verbuende' => 0]) === false, 'eine 0 ebenso');
assert($lies(['nur_verbuende' => 'ja']) === false, 'und ein beliebiger Text schaltet nichts ein');

// =================================================================================================
// C. 💣 BESTAND: ein Lauf von vor der Verbund-Erkennung. Sein after_json traegt weder verbund_stamm
// noch verbund_n (der Pruefstand von garetien-plan.php hat keine nummerierten Fragmente -- genau
// dieser Zustand). „nur Verbünde" ist dort leer, KEIN Fehler, und `verbund_objekte` sagt 0 --
// daraus baut der Browser den Satz „In diesem Lauf ist kein Verbund erkannt".
// =================================================================================================

$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$alt = avesmapsGaretienArbeitsliste($pdo, 1, []);
assert($alt['verbund_objekte'] === 0, 'ein Lauf ohne Verbund-Felder zaehlt 0: ' . json_encode($alt['verbund_objekte']));
$altNur = avesmapsGaretienArbeitsliste($pdo, 1, ['nur_verbuende' => true]);
assert($altNur['objekte'] === [] && $altNur['gesamt'] === 0, 'und „nur Verbünde" ist dort leer, ohne Fehler');
assert($altNur['verbund_objekte'] === 0, 'die Zahl steht auch in der gefilterten Antwort');
assert($altNur['reiter']['offen'] === $alt['reiter']['offen'], 'die Reiterzahlen zaehlen den Lauf, nicht den Filter');

// Zwei Fragmente eines Verbunds dazu -- so, wie ein NEUER Planlauf sie schreibt.
$planRunId = (int) avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND)['id'];
foreach ([1, 2] as $nr) {
    avesmapsSyncPlanAddItem($pdo, $planRunId, [
        'entity_key' => 'ggp:Waelder:Wald:Garetien:Silker Hain ' . $nr . '!Silker Hain ' . $nr,
        'entity_public_id' => null,
        'change_type' => 'new',
        'label' => 'Silker Hain ' . $nr,
        'after' => ['typ' => 'Wald', 'wiki' => 'ggp', 'ebene' => 'Waelder', 'name' => 'Silker Hain ' . $nr,
                    'ziel' => 'region', 'verbund_stamm' => 'Silker Hain', 'verbund_n' => 2],
        'selected' => 0,
    ]);
}
$neu = avesmapsGaretienArbeitsliste($pdo, 1, ['nur_verbuende' => true]);
assert($neu['verbund_objekte'] === 2, 'zwei Fragmente zaehlen als zwei Verbund-Objekte: ' . json_encode($neu['verbund_objekte']));
assert(array_column($neu['objekte'], 'name') === ['Silker Hain 1', 'Silker Hain 2'],
    '„nur Verbünde" zeigt genau die Fragmente: ' . json_encode(array_column($neu['objekte'], 'name')));
assert(count(avesmapsGaretienArbeitsliste($pdo, 1, [])['objekte']) === count($alt['objekte']) + 2,
    'ohne den Filter bleiben die alten Zeilen unveraendert daneben stehen');

echo "OK -- garetien-liste-nur-verbuende\n";
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-anzeige-filtersperre.test.js
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-liste-nur-verbuende-test.php
```
Erwartet (gesehen): `AssertionError [ERR_ASSERTION]: garetienStageFilterAnwenden fehlt im Export` und `PHP Fatal error:  Uncaught AssertionError: ein Objekt ohne Verbund faellt heraus -- das Feld fehlt, und das ist KEIN Fehler`.

- [ ] **Schritt 3: Umsetzen**

In `js/review/review-garetien-importer.js`:

**Stelle 1** — ersetze:

```js
			// RULING R7 (Fix-Runde 1): auf dem Reiter „Anzeigen" wirken Suche und Filtertrichter
			// NICHT (Entwurf §3.1) -- das muss ERKENNBAR sein, nicht nur wahr. Steht standardmaessig
			// `hidden`; garetienStageFilterSperreSetzen() schaltet Text UND die `disabled`-Sperre
			// von Suchfeld/Filterknopf gemeinsam (siehe dort).
			// 🔴 DER SATZ BESCHREIBT HEUTE, NICHT DEN ENTWURF (Fixrunde 2, C1). Bis dahin stand hier
			// „— gefiltert wird nach Name und Typ." und damit das GEGENTEIL der drei Zeilen darueber:
			// garetienStageFilterSperreSetzen() sperrt Suchfeld und Filterknopf auf genau diesem
			// Reiter, der Editor las also ein Versprechen und sah daneben zwei ausgegraute
			// Bedienelemente. Der Entwurf (§3.1) will dieses Filtern wirklich -- gebaut hat es keine
			// Aufgabe dieses Plans; es kommt als eigene Aufgabe nach. Bis dahin sagt der Satz, was
			// stimmt: ein Hinweis, der mehr verspricht als die Oberflaeche kann, ist schlimmer als
			// keiner.
			+ '<p class="gi-anzeigehinweis" id="garetien-anzeige-hinweis" hidden>Was hier steht, liegt auf '
			+ 'der Karte und wird mit „Stage importieren" angelegt — Suche und Filter wirken hier nicht.</p>'
```

durch:

```js
			// 🔴 Aufgabe 5 (Entwurf 2026-09-14 §7): der Hinweis der Stage OHNE den Satz „Suche und
			// Filter wirken hier nicht". Er stand da, solange RULING R7 Suchfeld und Filterknopf auf
			// diesem Reiter sperrte -- mit der Sperre faellt der Satz, sonst behauptete er das
			// Gegenteil dessen, was die Liste darunter tut (garetienStageFilterAnwenden).
			// ⚠️ Startet `hidden`; garetienStageHinweisSetzen() blendet ihn auf dem Reiter „Stage" ein.
			+ '<p class="gi-anzeigehinweis" id="garetien-anzeige-hinweis" hidden>Was hier steht, liegt auf '
			+ 'der Karte und wird mit „Stage importieren" angelegt.</p>'
```

**Stelle 2** — ersetze:

```js
	// RULING R7 (Fix-Runde 1): auf dem Reiter „Anzeigen" wirken Suche und Filtertrichter nicht
	// (Entwurf §3.1) -- das muss ERKENNBAR sein. Gesperrt werden Suchfeld UND Filterknopf per
	// `disabled` (nicht nur ein `title`: ein deaktiviertes Element bekommt in Chrome keine
	// Zeigerereignisse und zeigt seinen `title` nie -- dasselbe Mittel wie beim gesperrten
	// Fussknopf), der Grund steht SICHTBAR daneben (`.gi-anzeigehinweis`).
	// ⚠️ Aufgerufen bei JEDEM Render, nicht nur beim Reiterwechsel: beide Renderwege (der echte
	// Serverabruf UND der „Stage"-Zweig aus avesmapsGaretienListeHolen, RULING R5) muenden in
	// avesmapsGaretienListeRendern -- eine Regel, die nur einen von beiden bindet, ist keine Regel.
	// Damit ist auch der Rueckweg gesichert: ein Reiterwechsel ZURUECK auf einen Server-Reiter
	// rendert erneut und gibt beide Elemente sicher wieder frei.
	function garetienStageFilterSperreSetzen() {
		if (!hasDocument) { return; }
		const gesperrt = zustand.stand === "stage";
		const sucheEl = document.getElementById("garetien-search");
		if (sucheEl) { sucheEl.disabled = gesperrt; }
		const filterToggleEl = document.getElementById("garetien-filter-toggle");
		if (filterToggleEl) { filterToggleEl.disabled = gesperrt; }
		// Der Zustand des Trichter-Panels ist ausschliesslich sein `hidden` (kein zweiter
		// Modulzustand daneben, s.o. bei Aufgabe 12) -- ein zufaellig offenes Panel schliesst also
		// mit, sobald gesperrt wird.
		if (gesperrt) {
			const filterMenuEl = document.getElementById("garetien-filter-menu");
			if (filterMenuEl) { filterMenuEl.hidden = true; }
		}
		const hinweisEl = document.getElementById("garetien-anzeige-hinweis");
		if (hinweisEl) { hinweisEl.hidden = !gesperrt; }
	}
```

durch:

```js
	// 🔴 Aufgabe 5 (Entwurf 2026-09-14 §7, Widerspruch 7): HIER STAND BIS ZUM 14.09.2026
	// `garetienStageFilterSperreSetzen` -- sie sperrte Suchfeld und Filterknopf auf dem Reiter
	// „Stage" (RULING R7). Der Owner-Entscheid hat das umgedreht: Suche und Filter WIRKEN auf der
	// Stage (garetienStageFilterAnwenden). Geblieben ist nur der Hinweis.
	// ⚠️ Aufgerufen bei JEDEM Render, nicht nur beim Reiterwechsel: beide Renderwege (der echte
	// Serverabruf UND der „Stage"-Zweig aus avesmapsGaretienListeHolen, RULING R5) muenden in
	// avesmapsGaretienListeRendern -- eine Regel, die nur einen von beiden bindet, ist keine Regel.
	// 💣 KEIN `disabled` MEHR, AUCH KEIN ZURUECKSETZEN: niemand setzt es noch. Ein `= false` hier
	// waere ein zweiter Erzeuger fuer einen Zustand, den es nicht mehr gibt.
	function garetienStageHinweisSetzen() {
		if (!hasDocument) { return; }
		const hinweisEl = document.getElementById("garetien-anzeige-hinweis");
		if (hinweisEl) { hinweisEl.hidden = zustand.stand !== "stage"; }
	}
```

**Stelle 3** — ersetze:

```js
		// RULING R7: Suche/Filtertrichter sperren + sichtbar begruenden, wenn der Reiter
		// „Anzeigen" aktiv ist -- und bei jedem anderen Reiter wieder freigeben.
		garetienStageFilterSperreSetzen();
```

durch:

```js
		// Aufgabe 5 (2026-09-14): nur noch der Hinweis der Stage -- die Sperre von Suche und
		// Filtertrichter ist gefallen, beide wirken auf jedem Reiter.
		garetienStageHinweisSetzen();
```

**Stelle 4** — ersetze:

```js
	// 🔴 RULING R5 (Aufgabe 2, Luecke im Plan): der Reiter „Anzeigen" ist die CLIENT-Menge und wird
	// NIE beim Server erfragt -- `stand: "stage"` steht nicht in AVESMAPS_GARETIEN_SERVER_STAENDE,
	// ein `stand: "stage"` im Rumpf waere ein Filter auf einen Wert, den
	// `avesmapsGaretienListeObjektStand` nie liefert, und die Liste bliebe fuer immer leer.
	// Diese reine Funktion baut die "Antwort" aus der Stage nach, damit
	// avesmapsGaretienListeRendern denselben Weg nimmt wie nach einem echten Abruf -- kein
	// zweiter Rendercode fuer einen vierten Reiter.
	// 🔴 „Anzeigen" FILTERT NICHT (Entwurf §3.1): Suche und Filtertrichter wirken nur auf die drei
	// Server-Reiter, sonst laeuft die Liste der Karte auseinander -- deshalb liest diese Funktion
	// weder `zustand.filter` noch sonst einen Server-Wert.
	// ⚠️ Die uebrigen drei Reiterzahlen (offen/abgelehnt/uebernommen) und die Bilanz des LAUFS
	// kommen unveraendert aus der letzten echten Serverantwort -- „Anzeigen" hat davon keine
	// eigene Fassung, sie ist die einzige Zahl, die hier ueberschrieben wird.
	function garetienStageAntwortBauen(letzteAntwort) {
		const objekte = avesmapsGaretienStageListe();
		const vorher = letzteAntwort || {};
		return {
			objekte: objekte,
			gesamt: objekte.length,
			bilanz: vorher.bilanz || {},
			// `stage` hier auf die eigene Groesse gesetzt -- die Stage filtert nicht, es gibt
			// also kein "von M" zu nennen. ⚠️ Die Bilanzzeile, die diesen Unterschied einst zeigte
			// (avesmapsGaretienBalanceZeileText), ist seit Punkt 1 des Fuenf-Punkte-Briefs
			// 30.08.2026 entfernt; das Feld selbst bleibt Teil der "Antwort"-Form dieser Funktion.
			reiter: Object.assign({}, vorher.reiter || {}, { stage: objekte.length }),
			facetten: vorher.facetten || {},
			angehakt: vorher.angehakt || {},
		};
	}
```

durch:

```js
	/*
	 * REIN: Suche und Filter auf die Objekte der STAGE anwenden (Aufgabe 5, Entwurf 2026-09-14 §7).
	 *
	 * 💣 DIESELBE SEMANTIK WIE DER SERVER (avesmapsGaretienListeObjektPasstFilter, garetien-liste.php):
	 * eine LEERE Liste heisst „kein Filter", die Suche ist ein getrimmter Teiltreffer im Namen,
	 * Gross/klein egal. Die Stage-Antwort entsteht im Browser und fragt den Server nie
	 * (RULING R5) -- ohne diese Regel waeren Suchfeld und Trichter bedienbar und wirkungslos.
	 * 🔴 ALLE Abschnitte des Trichters wirken, nicht nur Suche und Objekttyp: ein sichtbarer Chip
	 * „Urteil: neu", der auf der Stage nichts tut, waere derselbe Fehler wie die gefallene Sperre.
	 * ⚠️ `nurVerbuende` heisst hier camelCase (so steht es in `zustand.filter`); am Server-Rumpf
	 * reist es als `nur_verbuende: 1` (avesmapsGaretienListeHolen).
	 * ⚠️ Gefiltert wird die LISTE, nie die Stage selbst und nie die Karte: Karte, Fussknopf und
	 * „Alle zentrieren" lesen weiter avesmapsGaretienStageListe() -- importiert wird die ganze Stage.
	 */
	function garetienStageFilterAnwenden(objekte, filter) {
		const f = filter || {};
		const suche = String(f.suche || "").trim().toLowerCase();
		const listenfelder = ["ebene", "typ", "urteil", "wiki"];
		return (objekte || []).filter(function (o) {
			if (!o) { return false; }
			for (let i = 0; i < listenfelder.length; i++) {
				const erlaubt = Array.isArray(f[listenfelder[i]]) ? f[listenfelder[i]].map(String) : [];
				if (erlaubt.length > 0 && erlaubt.indexOf(String(o[listenfelder[i]] || "")) === -1) {
					return false;
				}
			}
			if (f.nur_mehrteilig === true && (o.abschnitte || []).length <= 1) { return false; }
			if (f.nurVerbuende === true && !(Number(o.verbund_n || 0) >= 2)) { return false; }
			if (suche !== "" && String(o.name || "").toLowerCase().indexOf(suche) === -1) { return false; }
			return true;
		});
	}

	/*
	 * REIN: der Satz einer LEEREN Liste (Aufgabe 5, 14.09.2026, Owner-Nachtrag zum Bestand).
	 *
	 * 💣 „NUR VERBÜNDE" AUF EINEM ALTEN LAUF IST IMMER LEER, UND DAS IST KEIN FEHLER. Jeder Lauf,
	 * der vor der Verbund-Erkennung gerechnet wurde, traegt in `after_json` weder `verbund_stamm`
	 * noch `verbund_n` -- es gibt keine Migration (Vertrag, „Der Bestand"). Ohne diesen Satz stuende
	 * dort „Keine Objekte in dieser Ansicht." und der Editor hielte den Filter fuer kaputt.
	 * 🔴 DIE ZAHL KOMMT VOM SERVER (`verbund_objekte`, vor dem Filtern ueber den ganzen Lauf gezaehlt,
	 * garetien-liste.php) -- im Browser liegt nur die gefilterte Seite, und aus der liesse sich
	 * „der Lauf kennt keine" nicht von „die Filter blenden sie aus" unterscheiden.
	 * ⚠️ Fehlt das Feld (eine Antwort von vor diesem Umbau), gilt 0 -- dieselbe Aussage wie ein alter Lauf.
	 */
	function garetienLeereListeText(filter, antwort) {
		if (!(filter && filter.nurVerbuende === true)) { return "Keine Objekte in dieser Ansicht."; }
		if (Number((antwort && antwort.verbund_objekte) || 0) === 0) {
			return "In diesem Lauf ist kein Verbund erkannt. Verbünde erkennt „Holen & Rechnen“ — "
				+ "ein Lauf, der vor dieser Erkennung gerechnet wurde, trägt noch keine.";
		}
		return "Kein Verbund in dieser Ansicht — ein anderer Filter oder der Reiter blendet sie aus.";
	}

	// 🔴 RULING R5 (Aufgabe 2, Luecke im Plan): der Reiter „Stage" ist die CLIENT-Menge und wird
	// NIE beim Server erfragt -- `stand: "stage"` steht nicht in AVESMAPS_GARETIEN_SERVER_STAENDE,
	// ein `stand: "stage"` im Rumpf waere ein Filter auf einen Wert, den
	// `avesmapsGaretienListeObjektStand` nie liefert, und die Liste bliebe fuer immer leer.
	// Diese Funktion baut die "Antwort" aus der Stage nach, damit avesmapsGaretienListeRendern
	// denselben Weg nimmt wie nach einem echten Abruf -- kein zweiter Rendercode fuer einen vierten Reiter.
	// 🔴 SEIT AUFGABE 5 (14.09.2026) FILTERT SIE: Suche und Trichter wirken auch hier
	// (garetienStageFilterAnwenden). Hier stand bis dahin „die Stage filtert nicht, sonst laeuft die
	// Liste der Karte auseinander" -- die Karte liest weiterhin die GANZE Stage, nur die Liste folgt dem Filter.
	// ⚠️ `reiter.stage` bleibt die Groesse der ganzen Stage -- die Reiterzahl nennt, was dort liegt,
	// nicht, was der Filter gerade zeigt (avesmapsGaretienTabsMarkup liest ohnehin `zustand.stage.size`).
	// ⚠️ Die uebrigen drei Reiterzahlen und die Bilanz des LAUFS kommen unveraendert aus der letzten
	// echten Serverantwort.
	function garetienStageAntwortBauen(letzteAntwort) {
		const stage = avesmapsGaretienStageListe();
		const objekte = garetienStageFilterAnwenden(stage, zustand.filter);
		const vorher = letzteAntwort || {};
		return {
			objekte: objekte,
			gesamt: objekte.length,
			bilanz: vorher.bilanz || {},
			reiter: Object.assign({}, vorher.reiter || {}, { stage: stage.length }),
			facetten: vorher.facetten || {},
			angehakt: vorher.angehakt || {},
			// Die Zahl des LAUFS, nicht der Stage -- sie beantwortet „kennt dieser Lauf Verbünde?"
			// (garetienLeereListeText).
			verbund_objekte: vorher.verbund_objekte,
		};
	}
```

**Stelle 5** — ersetze:

```js
				: '<p class="avm-empty">Keine Objekte in dieser Ansicht.</p>';
```

durch:

```js
				: '<p class="avm-empty">' + avesmapsGaretienEscape(garetienLeereListeText(zustand.filter, a)) + "</p>";
```

**Stelle 6** — ersetze:

```js
		const rumpf = {
			action: "liste",
			run_id: zustand.importRunId,
```

durch:

```js
		// 🔴 Aufgabe 5 (2026-09-14): `nur_verbuende` reist als ZAHL (1/0); der Endpunkt wandelt
		// ausdruecklich um (garetien-import.php).
		// 💣 KEIN KOMMENTAR IM LITERAL DARUNTER, UND DER AUFRUFNAME NIE WOERTLICH IN DIESEM KOMMENTAR:
		// garetien-endpunkt-test.php sucht die Listen-Rumpfe am woertlichen Aktionsnamen und liest ab
		// dort ein festes Bytefenster -- Literal UND die dahinter angehaengten Felder (`anzahl`). Ein
		// Kommentar im Literal schob `anzahl` aus dem Fenster, ein woertlicher Aktionsname hier
		// zaehlte als dritter Rumpf. Beides am 14.09.2026 so gemessen.
		const rumpf = {
			action: "liste",
			run_id: zustand.importRunId,
```

**Stelle 7** — ersetze:

```js
			nur_mehrteilig: filter.nur_mehrteilig === true,
			stand: stand,
		};
```

durch:

```js
			nur_mehrteilig: filter.nur_mehrteilig === true,
			nur_verbuende: filter.nurVerbuende ? 1 : 0,
			stand: stand,
		};
```

**Stelle 8** — ersetze:

```js
	const AVESMAPS_GARETIEN_NUR_LABEL = { mehrteilig: "nur mit mehreren Abschnitten" };
```

durch:

```js
	const AVESMAPS_GARETIEN_NUR_LABEL = {
		mehrteilig: "nur mit mehreren Abschnitten",
		// Aufgabe 5 (2026-09-14): zugleich der Trockenlauf der Verbund-Erkennung (Entwurf §6.6).
		verbuende: "nur Verbünde",
	};
```

**Stelle 9** — ersetze:

```js
		return [
			{ value: "mehrteilig", label: garetienNurZeigenLabel("mehrteilig") },
		];
```

durch:

```js
		return [
			{ value: "mehrteilig", label: garetienNurZeigenLabel("mehrteilig") },
			{ value: "verbuende", label: garetienNurZeigenLabel("verbuende") },
		];
```

**Stelle 10** — ersetze:

```js
		zustand.filter.nur_mehrteilig = garetienFilterState.nur.has("mehrteilig");
```

durch:

```js
		zustand.filter.nur_mehrteilig = garetienFilterState.nur.has("mehrteilig");
		zustand.filter.nurVerbuende = garetienFilterState.nur.has("verbuende");
```

**Stelle 11** — ersetze:

```js
			// RULING R7 (Fix-Runde 1): Suche/Filtertrichter sperren + sichtbar begruenden
			garetienStageFilterSperreSetzen,
```

durch:

```js
			// Aufgabe 5 (2026-09-14): Suche und Filter WIRKEN auf der Stage -- die Sperre (RULING R7) ist gefallen.
			garetienStageHinweisSetzen,
			garetienStageFilterAnwenden,
			garetienLeereListeText,
```

In `api/_internal/import/garetien-liste.php`:

**Stelle 1** — ersetze:

```php
    if (($filter['nur_mehrteilig'] ?? false) === true && count($objekt['abschnitte']) <= 1) {
        return false;
    }
```

durch:

```php
    if (($filter['nur_mehrteilig'] ?? false) === true && count($objekt['abschnitte']) <= 1) {
        return false;
    }
    // 🔴 Aufgabe 5 (2026-09-14): „nur Verbünde" -- zugleich der Trockenlauf der Erkennung, bevor die
    // Wege-Verbünde live gehen (Entwurf §6.6). ⚠️ Ein Objekt OHNE Verbund traegt `verbund_n` gar
    // nicht (avesmapsGaretienArbeitslisteObjekte haengt es nur an einen Verbund) -- das `?? 0` ist
    // deshalb der Normalfall, kein Rueckfall fuer kaputte Daten.
    if (($filter['nur_verbuende'] ?? false) === true && (int) ($objekt['verbund_n'] ?? 0) < 2) {
        return false;
    }
```

**Stelle 2** — ersetze:

```php
 *              suche?:string, nur_ungehakt?:bool, nur_mehrteilig?:bool, stand?:string,
```

durch:

```php
 *              suche?:string, nur_ungehakt?:bool, nur_mehrteilig?:bool, nur_verbuende?:bool, stand?:string,
```

**Stelle 1** — ersetze:

```php
        'facetten' => ['ebene' => [], 'typ' => [], 'urteil' => [], 'wiki' => [], 'typ_kategorie' => []],
        'angehakt' => ['new' => 0, 'changed' => 0],
    ];
```

durch:

```php
        'facetten' => ['ebene' => [], 'typ' => [], 'urteil' => [], 'wiki' => [], 'typ_kategorie' => []],
        'angehakt' => ['new' => 0, 'changed' => 0],
        'verbund_objekte' => 0,
    ];
```

**Stelle 2** — ersetze:

```php
    $reiter = ['offen' => 0, 'vorgemerkt' => 0, 'abgelehnt' => 0, 'uebernommen' => 0];
    foreach ($objekte as $objekt) {
```

durch:

```php
    $reiter = ['offen' => 0, 'vorgemerkt' => 0, 'abgelehnt' => 0, 'uebernommen' => 0];
    // 🔴 Aufgabe 5 (2026-09-14): wie viele Objekte DIESES LAUFS gehoeren zu einem Verbund -- VOR dem
    // Filtern gezaehlt, wie die Facetten. Der Browser braucht die Zahl fuer den Satz einer leeren
    // „nur Verbünde"-Liste (garetienLeereListeText): 0 heisst „dieser Lauf kennt keine", und genau
    // das ist jeder Lauf von vor der Verbund-Erkennung -- sein after_json traegt die Felder nicht.
    $verbundObjekte = 0;
    foreach ($objekte as $objekt) {
        if ((int) ($objekt['verbund_n'] ?? 0) >= 2) {
            $verbundObjekte++;
        }
```

**Stelle 3** — ersetze:

```php
        'facetten' => $facetten,
        'angehakt' => ['new' => $angehaktNeu, 'changed' => $angehaktGeaendert],
    ];
}
```

durch:

```php
        'facetten' => $facetten,
        'angehakt' => ['new' => $angehaktNeu, 'changed' => $angehaktGeaendert],
        'verbund_objekte' => $verbundObjekte,
    ];
}
```

In `api/edit/map/garetien-import.php`:

**Stelle 1** — ersetze:

```php
            'nur_mehrteilig' => ($payload['nur_mehrteilig'] ?? false) === true,
```

durch:

```php
            'nur_mehrteilig' => ($payload['nur_mehrteilig'] ?? false) === true,
            // 🔴 Aufgabe 5 (2026-09-14): der Browser schickt `nur_verbuende: 1` -- eine ZAHL. Ein
            // `=== true` wie eine Zeile darueber verwuerfe sie still, und „nur Verbünde" taete auf
            // den Server-Reitern nichts. Ausgefuehrt geprueft in garetien-liste-nur-verbuende-test.php.
            'nur_verbuende' => in_array($payload['nur_verbuende'] ?? null, [1, '1', true], true),
```

Fremder Test `api/_internal/import/__tests__/garetien-endpunkt-test.php` (sein 600-Byte-Fenster reichte nach der neuen Rumpfzeile nicht mehr bis `rumpf.anzahl`; ohne diese Zeile meldet er „der Deckel reist mit -- sonst prueft der Rest dieses Abschnitts nichts"):

**Stelle 1** — ersetze:

```php
    $stueck = substr($browser, $von, 600);
```

durch:

```php
    // 🔴 900 STATT 600 (Aufgabe 5, 14.09.2026): mit `nur_verbuende` im Literal lag `rumpf.anzahl`
    // 3 Bytes hinter dem alten Fenster -- der Waechter meldete „der Deckel reist nicht mit", obwohl
    // er reiste. Das Fenster ist eine Messgrenze, keine Aussage ueber den Rumpf.
    $stueck = substr($browser, $von, 900);
```

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

```bash
node js/review/__tests__/garetien-anzeige-filtersperre.test.js
node js/review/__tests__/garetien-anzeige-menge.test.js
node js/review/__tests__/garetien-filtertrichter.test.js
P="php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll"
$P api/_internal/import/__tests__/garetien-liste-nur-verbuende-test.php
$P api/_internal/import/__tests__/garetien-endpunkt-test.php
$P api/_internal/import/__tests__/garetien-liste-test.php
for t in api/_internal/import/__tests__/garetien-*-test.php; do $P "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```
Erwartet: `garetien-anzeige-filtersperre: 30 Pruefungen bestanden.`, `OK -- garetien-liste-nur-verbuende`, `OK: garetien-endpunkt-test`, `OK: 115 Pruefungen` (liste-test); Schleifen ohne `ROT:`.

Nahtprobe (gesehen): die Zeile `'nur_verbuende' => …` im Endpunkt entfernen → `garetien-endpunkt-test.php` meldet „DER ENDPUNKT LIEST NICHT, WAS DER BROWSER SCHICKT -- verloren gehen: nur_verbuende", `garetien-liste-nur-verbuende-test.php` meldet „der liste-Zweig des Endpunkts liest `nur_verbuende`". Mutationsprobe: `garetienStageFilterAnwenden(stage, zustand.filter)` → `stage` macht den JS-Test rot mit „💣 die Suche WIRKT auf der Stage -- nicht nur bedienbar".

🔧 DU: Auf „Stage" nach einem Namen suchen und nach Objekttyp filtern — die Liste folgt, die Karte zeigt weiter die ganze Stage. Auf „Offen" „Filter ▾ → Nur zeigen → nur Verbünde" wählen: auf dem heutigen (alten) Lauf muss „In diesem Lauf ist kein Verbund erkannt. …" stehen; nach dem nächsten „Holen & Rechnen" die 19 Wege-Verbünde darin ansehen.

- [ ] **Schritt 5: Committen**

```bash
git add js/review/review-garetien-importer.js
git add api/_internal/import/garetien-liste.php
git add api/edit/map/garetien-import.php
git add js/review/__tests__/garetien-anzeige-filtersperre.test.js
git add api/_internal/import/__tests__/garetien-liste-nur-verbuende-test.php
git add api/_internal/import/__tests__/garetien-endpunkt-test.php
git commit -F- <<'EOF'
ui(garetien-importer): Suche und Filter wirken auf der Stage, neuer Filter „nur Verbünde"

Suchfeld und Filtertrichter waren auf dem Reiter Stage gesperrt. Die Sperre
faellt, und die Stage-Antwort filtert jetzt selbst -- mit derselben Semantik
wie der Server, ueber alle Abschnitte des Trichters. Karte und Fussknopf
lesen weiter die ganze Stage.

„Nur zeigen → nur Verbünde" filtert auf verbund_n >= 2, im Browser wie am
Server (nur_verbuende reist als 1/0, der Endpunkt wandelt ausdruecklich um).
Auf einem Lauf von vor der Verbund-Erkennung ist die Liste leer und sagt
warum; der Server zaehlt dafuer verbund_objekte ueber den ganzen Lauf.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 6: Der Verbund lebt am Stage-Eintrag

**Deckt Entwurf §1 Widerspruch 2, Fehler 6 und 10, §6.3 (Riegel, Vorbelegung aus dem größten Fragment, Name = Stamm im Namensfeld), §6.4 und §6.6 (Kurvenbeschreibung eines Verbunds vorbelegt aus) ab.** Innenumbau — kein eigener Blick nötig. ⚠️ **Aber NICHT allein live:** zwischen Aufgabe 6 und 7 steht auf „Offen" noch der alte Knopf „Verbund auf die Stage (n)", und der legt nach dieser Aufgabe nichts mehr auf. Aufgabe 6 und 7 gehen in EINEM Push live; der Owner-Blick ist der von Aufgabe 7.

💣 **Ein Feld am Objekt überlebt die Stage nicht.** `avesmapsGaretienStageAuffrischen` ersetzt die gespeicherte Fassung nach jedem Schreibvorgang durch die frische vom Server, und Stage und `zustand.objekte` teilen dieselbe Referenz. Deshalb wird jeder Wert von `zustand.stage` ein EINTRAG `{ objekt, zusammen }`. ⚠️ Wer `zustand.stage` direkt liest (heute: Hinzufügen, Leeren, Entfernen, Liste, Auffrischen, Nachschlagen — alle hier umgebaut), bekommt Einträge; alle übrigen Leser gehen über `avesmapsGaretienStageListe()`/`avesmapsGaretienStageHat()`.

🔴 **Zusammengelegt heißt: mindestens zwei Mitglieder auf der Stage, und JEDES trägt `zusammen`.** Ein neu aufgelegter Eintrag trägt `false` — ein Fragment, das nach „Stage leeren" einzeln wieder aufgelegt wird, ist nicht still verschmolzen (K1). Ein schon liegender Eintrag behält seine Entscheidung.

🔴 **Unter zwei löst die TÜR auf** (`avesmapsGaretienStageEntfernen`), nicht der ✕: auch „Von der Stage nehmen", die Auswahlleiste und der Nachschlag nach einem Lauf (`garetienStageNachschlagen`, der jetzt ebenfalls durch die Tür geht) nehmen Einträge herunter. Aufgelöst heißt: alle `zusammen = false` UND die Einstellungen unter dem Verbundschlüssel fallen (Fehler 10).

💣 **Der Riegel steht im Zusammenlegen selbst** (`garetienVerbundZusammenlegbar`), nicht nur am Knopf — `disabled` ist die Anzeige. Massgeblich ist die Form, die der Verbund BEKÄME: zusammengelegt die Wahl am Verbundschlüssel, sonst die des größten Mitglieds auf der Stage.

💣 **Fehler 6:** `garetienZielWahlZu` und `garetienEingabenZustandZu` belegen einen zusammengelegten Verbund aus `garetienEinstellungsVorlage` vor = dem größten Mitglied auf der Stage (meiste Punkte, Gleichstand kleinster Schlüssel), nie aus dem zuerst berührten.

💣 **Name = Stamm auch im CLIENT.** Aufgabe 2 setzt serverseitig den Stamm, wenn `verbund` im Rumpf steht und KEIN Handname. Das Namensfeld (`data-gi-feld="einfuegeName"`, Wert aus `garetienNameFuerImport`) zeigte bei einem zusammengelegten Verbund aber den Namen eines Fragments („Silker Hain 3") — die Oberfläche sagte etwas anderes, als angelegt wird. Jetzt ist die Vorgabe eines zusammengelegten Verbunds `objekt.verbund_stamm`; ein getippter Name gewinnt; nach „Verbund auflösen" fällt ein getippter Verbundname mit, und jedes Fragment zeigt wieder seinen eigenen. Am Code geprüft: `garetienEingabenFuerServer` hängt `name` nur an, wenn `garetienNameWahlZu` etwas liefert, und `garetienEingabenAendern` schreibt nur beim Tippen — die Vorgabe reist also NIE als Handname. 🔴 Wer die Vorgabe je in den Namensspeicher schreibt, nimmt dem Server die Stamm-Regel.

🔴 **Die Kurvenbeschreibung eines zusammengelegten Verbunds startet aus** (Entwurf §6.6, Mockup Szene 4). Die Vorgabe kommt aus `garetienEingabenGrundwerte` (~:4012, `curveLabel: false` für JEDES Objekt, keine Vorgabe der Art); `garetienEingabenZustandZu` setzt sie beim ersten Zugriff am Verbundschlüssel ausdrücklich auf `false`. Ein Häkchen des Editors gewinnt — es schreibt in genau diesen Zustand. ⚠️ Heute ist die Regel gleichwertig zur Grundvorgabe; sie hält das Verhalten fest, falls eine Art je eine Kurven-Vorgabe bekommt (Mutationsprobe unten).

💣 **Die Beschriftungs-Vorschau (`gi-label-vorschau`) zeigt, was angelegt wird — EINE Beschriftung je zusammengelegtem Verbund, mit dem Namen des Namensfelds.** Am Code gemessen: der Stempel (`garetienVorschauLabelStempeln`, ~:2519) stempelte JEDES Objekt der gezeichneten Menge, der Zeichner (`garetienVorschauBeschriftungen`, `review-garetien-karte.js` ~:1373) malt je gestempeltem Objekt einen Marker — vier Fragmente ergaben vier Namen, und der Text kam aus `objekt.name` (`review-garetien-label-vorschau.js` ~:119). Am Server legt nur der **Anführer** (kleinste `sync_plan_item.id`, Entwurf §6.6) Beschriftung und Region an, auf SEINEM Mittelpunkt (Entwurf §10); die übrigen hängen nur Flächen an. Deshalb: `garetienVerbundAnfuehrer(schluessel)` wählt unter den Mitgliedern auf der Stage das mit der kleinsten Neu-Item-Nummer, nur es wird gestempelt, und der Text wird über einen neuen fünften Parameter `name` in die reine Regel HEREINGEREICHT — aus `garetienNameFuerImport`, derselben Quelle wie das Namensfeld (keine zweite Rechnung). ⚠️ Das gilt auch ohne Verbund: ein getippter Handname steht jetzt in der Vorschau (vorher nicht). ⚠️ Der Name zieht die Karte nach — **entprellt** (250 ms, wie das Suchfeld), weil ein Kartenlauf die ganze Menge neu zeichnet; `einfuegeName` steht dafür in `AVESMAPS_GARETIEN_VORSCHAU_FELDER`. ⚠️ Kosten: die Anführer-Weiche läuft nur für Verbund-Mitglieder und zählt dabei die Stage — Mitglieder × Stagegröße Schlüsselvergleiche je Kartenlauf.

🔴 **`AVESMAPS_GARETIEN_VERBUND_WEGE_FREI = false`** (bei den Konstanten nach `AVESMAPS_GARETIEN_HAKEN_KLICK` ~:231): solange `false`, ist ein Weg-Verbund gesperrt mit „Wege-Verbünde sind noch nicht freigegeben.". Gelesen wird `_garetienVerbundWegeFrei`, initialisiert aus der Konstante; der Setzer steht NUR unter `__test` — ein `const` lässt sich im Test nicht umstellen, und `__test` ist in dieser Datei der Ort für reine Testzugänge. Die Freigabe bleibt genau die eine Zeile.

💣 **„Stage leeren" und ein neuer Lauf vergessen nur, was AM OBJEKT hängt — nie, was dem FENSTER gehört.** `garetienEinstellungenVergessen()` (gerufen aus `avesmapsGaretienStageLeeren()` und am Beginn von `garetienLaufStarten`, nach dem Doppelklick-Riegel) ruft `garetienVerbundVergessen`, `garetienNameWahlVergessen`, `garetienInnerortsWahlVergessen`, `garetienZielWahlVergessen`, `garetienEinfuegeWahlVergessen`. **`garetienUmkreisVergessen` steht bewusst NICHT darin:** der Umkreis ist fensterweit (wie Typwahl der Nähe und Zeilengrenze), und zurückgesetzt stellte der Editor ihn nach jedem Import neu ein (Entscheid 14.09.2026 nach „Einstellungsmöglichkeiten, Usability"). ⭐ **Wer einen neuen Speicher baut, ordnet ihn am Kommentar über `garetienEinstellungenVergessen` ein:** hängt er am Einstellungs- oder Objektschlüssel, gehört sein Vergessen-Aufruf in diese Liste (kann er am Verbundschlüssel liegen, zusätzlich in die Speicherlisten von `garetienVerbundVergessen`/`garetienVerbundEinstellungenVergessen`); gehört er dem Fenster, bleibt er draußen. `_garetienEingabenZustand` hat keine eigene Vergessen-Funktion; seine Verbund-Einträge räumt `garetienVerbundVergessen`. Der Test sichert beides: Objekt-Einstellungen fallen, der Umkreis bleibt.

🔧 **Bis Aufgabe 9** gibt es keine Zielwahl „karte": `garetienVerbundZusammenlegbar` prüft die Form über `garetienZielWahlZu(objekt).ziel` (der Bestand kennt kein `.form`). **Aufgabe 9 erweitert die Bedingung um `garetienZielwahlZu(objekt) === "karte"`** und trägt `garetienZielwahlVergessen` in `garetienEinstellungenVergessen` sowie ihren Speicher in die Speicherlisten von `garetienVerbundEinstellungenVergessen`/`garetienVerbundVergessen` ein.

**Bestand:** Die Stage lebt nur im Browser; nichts wird gespeichert oder migriert. Objekte eines alten Laufs tragen keine Verbund-Felder, `garetienVerbundSchluessel` ist `""`, sie können nie zusammengelegt werden.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`zustand.stage` ~:164; Konstante nach ~:231; `avesmapsGaretienStageHinzufuegen` ~:240; `avesmapsGaretienStageLeeren` ~:265; `avesmapsGaretienStageEntfernen`/`…Liste` ~:279; `avesmapsGaretienStageAuffrischen` ~:319; `garetienStageNachschlagen` ~:370; Verbund-Block `_garetienVerbundZusammen` ~:1468–1505; `garetienEingabenZustandZu` ~:3745 (Vorlage aus dem größten, Kurve aus); `garetienLaufStarten` ~:3067; `garetienNameFuerImport` ~:4963 (Vorgabe Stamm); neu `garetienVerbundAnfuehrer` und `garetienVorschauLabelStempeln` ~:2519 (eine Beschriftung, Name hereingereicht); `AVESMAPS_GARETIEN_VORSCHAU_FELDER` ~:4331 und Namenszweig in `garetienEingabenAendern` ~:4412 (entprellt nachziehen) `garetienZielWahlZu` ~:5218; `garetienVerbundKlick` ~:7573; `garetienVerbundWegKlick` ~:7583; Export ~:9692 und `__test` ~:9983)
- Ändern: `js/review/review-garetien-label-vorschau.js` (`garetienVorschauLabelAus` ~:103, fünfter Parameter `name`)
- Test: `js/review/__tests__/garetien-verbund-stage-eintrag.test.js` (neu)
- Fremd: `garetien-label-vorschau-zeichnen.test.js`, `garetien-verbund-stage.test.js`, `garetien-verbund-klick.test.js`, `garetien-verbund-einstellungen.test.js`, `garetien-verbund-fragment-weg.test.js`, `garetien-verbund-rumpf.test.js` (alle unter `js/review/__tests__/`)

**Schnittstellen:**
- Nutzt: `garetienVerbundSchluessel(objekt): string`, `garetienVerbundMitglieder(schluessel, objekte): object[]`, `garetienZielVorbelegung(objekt)`, `garetienEingabenGrundwerte(objekt)`, `garetienUnserBeschriftung(objekt): string`, die Vergessen-Funktionen der Objekt-Einstellungen (`garetienVerbundVergessen`, `garetienNameWahlVergessen`, `garetienInnerortsWahlVergessen`, `garetienZielWahlVergessen`, `garetienEinfuegeWahlVergessen`)
- Liefert: `zustand.stage: Map<string, {objekt, zusammen: boolean}>` · `garetienVerbundIstZusammen(schluessel: string): boolean` · `garetienVerbundZusammenlegen(schluessel: string, objekte: Array): number` (liest `objekte` nicht) · `garetienVerbundAufloesen(schluessel: string): void` · `garetienVerbundGroesstes(schluessel: string, objekte: Array): object|null` · `garetienVerbundZusammenlegbar(objekt): {ok: boolean, grund: string}` · `garetienNameFuerImport(objekt): string` (zusammengelegt: Handname, sonst `verbund_stamm`) · `garetienVerbundAnfuehrer(schluessel): object|null` · `garetienVorschauLabelAus(objekt, wahl, eingaben, gewaehlt, name)` (fehlt `name`, gilt `objekt.name`) · Eingabenzustand am Verbundschlüssel startet mit `curveLabel: false` · `garetienVerbundKlick` meldet zusätzlich `{handlung: "verbund_gesperrt", schluessel, grund}` · `AVESMAPS_GARETIEN_VERBUND_WEGE_FREI = false` · intern `garetienVerbundStageEintraege(schluessel)`, `garetienVerbundEinstellungenVergessen(schluessel)`, `garetienEinstellungenVergessen()`, `garetienEinstellungsVorlage(objekt)` · `__test.AVESMAPS_GARETIEN_VERBUND_WEGE_FREI`, `__test.garetienVerbundWegeFreiSetzen(wert)`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/review/__tests__/garetien-verbund-stage-eintrag.test.js`:

```js
// Aufgabe 6 (Garetien-Importer vereint, 14.09.2026): der Verbund lebt am STAGE-EINTRAG.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §1 Widerspruch 2,
//          Fehler 6 und 10, §6.3, §6.4
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-stage-eintrag.test.js
//
// 💣 DER BEFUND (K1): die Entscheidung „zusammengelegt" lag in einem losen `Set` von Verbundschluesseln.
// Sie ueberlebte „Stage leeren" und neue Laeufe und verschmolz spaeter EINZELN aufgelegte Fragmente
// still -- und „Verbund auflösen" liess die Einstellungen des Verbunds liegen (Fehler 10).
// 🔴 Gemessen wird ueber das ECHTE Modul, nie am Quelltext.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter();

function fragment(nr, punkte, extra) {
	return Object.assign({
		key: "ggp:silkerhain:" + nr, name: "Silker Hain " + nr, ebene: "Waelder", typ: "Wald",
		urteil: "neu", stand: "offen", ziel: "region", subtyp: "wald", kind: "vegetation",
		verbund_stamm: "Silker Hain", verbund_n: 4,
		geometrie: Array.from({ length: punkte }, (_, i) => [i, i]),
		items: [{ id: 100 + nr, change_type: "new" }],
	}, extra || {});
}
function zuruecksetzen() {
	api.avesmapsGaretienStageLeeren();
	api.__test.garetienVerbundWegeFreiSetzen(api.__test.AVESMAPS_GARETIEN_VERBUND_WEGE_FREI);
}
// Dieselbe winzige DOM-Attrappe wie in garetien-verbund-klick.test.js.
function ziel(attribute) {
	const knoten = {
		disabled: false,
		getAttribute(name) { return Object.prototype.hasOwnProperty.call(attribute, name) ? attribute[name] : null; },
	};
	knoten.closest = (auswahl) => ((auswahl === '[data-handlung="verbund"]' && attribute["data-handlung"] === "verbund")
		|| (auswahl === "[data-verbund-weg]" && "data-verbund-weg" in attribute) ? knoten : null);
	return knoten;
}

["garetienVerbundGroesstes", "garetienVerbundZusammenlegbar"].forEach((n) =>
	wahr(typeof api[n] === "function", n + " fehlt im Export"));
gleich(api.__test.AVESMAPS_GARETIEN_VERBUND_WEGE_FREI, false,
	"🔴 Wege-Verbuende sind ab Werk NICHT freigegeben -- die Freigabe nach dem Owner-Blick ist genau diese Zeile");

// =================================================================================================
// A. Zusammenlegen legt NICHT auf -- es markiert die Eintraege, die schon auf der Stage liegen.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2, m3] = [fragment(1, 11), fragment(2, 6), fragment(3, 14)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	gleich(api.garetienVerbundIstZusammen(s), false, "aufgelegt ist nicht zusammengelegt");
	gleich(api.garetienVerbundZusammenlegen(s, [m1, m2, m3]), 2,
		"Rueckgabe = Zahl der Mitglieder AUF DER STAGE -- m3 liegt nicht dort");
	gleich(api.avesmapsGaretienStageHat(m3.key), false, "💣 Zusammenlegen legt nichts auf");
	gleich(api.garetienVerbundIstZusammen(s), true, "zwei markierte Eintraege sind ein zusammengelegter Verbund");

	// Ein NEU aufgelegtes Mitglied traegt `zusammen = false` -- der Verbund ist damit nicht mehr ganz zusammen.
	api.avesmapsGaretienStageHinzufuegen([m3]);
	gleich(api.garetienVerbundIstZusammen(s), false,
		"ein spaeter aufgelegtes Fragment ist nicht still verschmolzen: nicht JEDER Eintrag traegt `zusammen`");
	gleich(api.garetienVerbundZusammenlegen(s, []), 3, "erneutes Zusammenlegen nimmt es mit");
	gleich(api.garetienVerbundIstZusammen(s), true, "jetzt wieder zusammen");
}

// Weniger als zwei auf der Stage: nichts zu legen.
zuruecksetzen();
{
	const m1 = fragment(1, 11);
	api.avesmapsGaretienStageHinzufuegen([m1]);
	gleich(api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), [m1, fragment(2, 6)]), 0,
		"ein einzelnes Fragment auf der Stage legt nichts zusammen");
	gleich(api.garetienVerbundIstZusammen(api.garetienVerbundSchluessel(m1)), false, "und gilt nicht als zusammen");
	gleich(api.garetienVerbundZusammenlegen("", [m1]), 0, "ein leerer Schluessel legt nichts zusammen");
}

// =================================================================================================
// B. 💣 K1: „Stage leeren" nimmt die Entscheidung MIT -- einzeln wieder aufgelegt ist nicht zusammen.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(s, [m1, m2]);
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([m1]);
	api.avesmapsGaretienStageHinzufuegen([m2]);
	gleich(api.garetienVerbundIstZusammen(s), false,
		"💣 nach „Stage leeren\" einzeln aufgelegte Fragmente sind NICHT zusammengelegt");
	gleich(api.garetienEingabenFuerServer(m1) && api.garetienEingabenFuerServer(m1).verbund, undefined,
		"und der Rumpf traegt deshalb auch keinen `verbund` -- der Server legt keine gemeinsame Region an");
}

// =================================================================================================
// C. Herunternehmen: der Rest bleibt zusammen -- unter zwei ist der Verbund aufgeloest.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2, m3] = [fragment(1, 11), fragment(2, 6), fragment(3, 14)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2, m3]);
	api.garetienVerbundZusammenlegen(s, []);
	api.garetienNameWahlSetzen(m1, "Silker Forst");
	api.avesmapsGaretienStageEntfernen([m2.key]);
	gleich(api.garetienVerbundIstZusammen(s), true, "zwei verbliebene Mitglieder bleiben zusammen");
	gleich(api.garetienNameWahlZu(m1), "Silker Forst", "und behalten die Einstellungen des Verbunds");
	api.avesmapsGaretienStageEntfernen([m3.key]);
	gleich(api.garetienVerbundIstZusammen(s), false, "unter zwei ist der Verbund aufgeloest");
	api.avesmapsGaretienStageHinzufuegen([m2, m3]);
	gleich(api.garetienVerbundIstZusammen(s), false, "wieder aufgelegte Fragmente sind nicht zusammengelegt");
	api.garetienVerbundZusammenlegen(s, []);
	gleich(api.garetienNameWahlZu(m1), "",
		"💣 der Fall unter zwei loest in der TUER auf -- samt Einstellungen, nicht nur am ✕-Knopf");
}

// =================================================================================================
// D. Fehler 10: „Verbund auflösen" nimmt die Einstellungen des Verbunds mit.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(s, []);
	api.garetienNameWahlSetzen(m1, "Silker Forst");
	gleich(api.garetienNameWahlZu(m2), "Silker Forst", "Vorbedingung: die Wahl gehoert dem Verbund");
	gleich(api.garetienVerbundAufloesen(s), undefined, "garetienVerbundAufloesen gibt nichts zurueck (void)");
	gleich(api.garetienVerbundIstZusammen(s), false, "aufgeloest");
	gleich(api.avesmapsGaretienStageHat(m1.key) && api.avesmapsGaretienStageHat(m2.key), true,
		"die Fragmente bleiben auf der Stage");
	api.garetienVerbundZusammenlegen(s, []);
	gleich(api.garetienNameWahlZu(m1), "",
		"💣 wer danach wieder zusammenlegt, findet den alten Namen NICHT mehr vor");
}

// =================================================================================================
// E. Fehler 6: die Vorbelegung kommt aus dem GROESSTEN Fragment, nie aus dem zuerst beruehrten.
// =================================================================================================
zuruecksetzen();
{
	const klein = fragment(1, 3, { ebene: "Berge", typ: "Huegel", ziel: "label", subtyp: "berggipfel", kind: "" });
	const gross = fragment(2, 20, { ebene: "Berge", typ: "Huegel", ziel: "region", subtyp: "huegel", kind: "topographie" });
	const gleichGross = fragment(0, 20, { ebene: "Berge", typ: "Huegel", ziel: "region", subtyp: "huegel", kind: "topographie" });
	const s = api.garetienVerbundSchluessel(klein);

	gleich(api.garetienVerbundGroesstes(s, [klein, gross]).key, gross.key, "das Mitglied mit den meisten Punkten");
	gleich(api.garetienVerbundGroesstes(s, [klein, gross, gleichGross]).key, gleichGross.key,
		"Gleichstand: der kleinste Schluessel");
	gleich(api.garetienVerbundGroesstes(s, []), null, "ohne Mitglieder: null");

	gleich(api.garetienZielWahlZu(klein).ziel, "label", "Vorbedingung: das kleine Fragment allein waere ein Gipfel");
	api.avesmapsGaretienStageHinzufuegen([klein, gross]);
	gleich(api.garetienVerbundZusammenlegen(s, []), 2, "zusammengelegt");
	gleich(api.garetienZielWahlZu(klein).ziel, "region",
		"💣 der zusammengelegte Verbund wird eine Flaeche -- vorbelegt aus dem GROESSTEN, obwohl das kleine zuerst beruehrt wurde");
	gleich(api.garetienZielWahlZu(klein).subtyp, "huegel", "samt Art");
}

// =================================================================================================
// F. Zusammenlegbar: nur „auf die Karte" als Flaeche oder Weg -- und Wege erst nach der Freigabe.
// =================================================================================================
zuruecksetzen();
{
	const [f1, f2] = [fragment(1, 11), fragment(2, 6)];
	gleich(JSON.stringify(api.garetienVerbundZusammenlegbar(f1)), JSON.stringify({ ok: true, grund: "" }),
		"eine Flaeche ist zusammenlegbar");

	// ⚠️ EIGENE SCHLUESSEL: die Zielwahl wird je Schluessel zwischengespeichert, und ein Weg unter dem
	// Schluessel der Flaeche darueber laese deren Wahl.
	const weg = (nr) => fragment(nr, 8, { key: "ggp:weg:" + nr, ebene: "Wege", typ: "Pfad", ziel: "path", subtyp: "Pfad", kind: "" });
	const [w1, w2] = [weg(1), weg(2)];
	const gesperrt = api.garetienVerbundZusammenlegbar(w1);
	gleich(gesperrt.ok, false, "🔴 ein Weg ist gesperrt, solange die Konstante `false` ist");
	gleich(gesperrt.grund, "Wege-Verbünde sind noch nicht freigegeben.", "und sagt warum");
	api.avesmapsGaretienStageHinzufuegen([w1, w2]);
	gleich(api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(w1), []), 0,
		"💣 der Riegel steht im Zusammenlegen selbst -- `disabled` ist nur die Anzeige");
	api.__test.garetienVerbundWegeFreiSetzen(true);
	gleich(api.garetienVerbundZusammenlegbar(w1).ok, true, "mit freigegebenen Wegen ist der Weg zusammenlegbar");
	gleich(api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(w1), []), 2, "und wird zusammengelegt");
	zuruecksetzen();

	const gipfel = (nr) => fragment(nr, 3, { key: "ggp:gipfel:" + nr, ebene: "Berge", typ: "Berg", ziel: "label", subtyp: "berggipfel", kind: "" });
	const g = api.garetienVerbundZusammenlegbar(gipfel(1));
	gleich(g.ok, false, "ein Verbund, der als Punkt ankaeme, ist keiner");
	wahr(g.grund.indexOf("Fläche oder ein Weg") !== -1 && g.grund.indexOf("berggipfel") !== -1,
		"der Grund nennt Regel und gewaehlte Form: " + g.grund);
	gleich(api.garetienVerbundZusammenlegbar({ key: "x", name: "Weidicht" }).ok, false, "ohne Verbund: nicht zusammenlegbar");
	void f2;
}

// =================================================================================================
// G. Die zwei Klick-Verteiler.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2, m3] = [fragment(1, 11), fragment(2, 6), fragment(3, 14)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	const e1 = api.garetienVerbundKlick({ target: ziel({ "data-handlung": "verbund", "data-key": m1.key }) }, [m1, m2, m3]);
	gleich(e1.handlung, "verbund_zusammengelegt", "erster Klick legt zusammen");
	gleich(e1.anzahl, 2, "mit den zwei Mitgliedern auf der Stage");
	gleich(api.avesmapsGaretienStageHat(m3.key), false, "und legt m3 NICHT auf");
	const e2 = api.garetienVerbundKlick({ target: ziel({ "data-handlung": "verbund", "data-key": m1.key }) }, [m1, m2, m3]);
	gleich(e2.handlung, "verbund_aufgeloest", "zweiter Klick loest auf");
	gleich(api.garetienVerbundIstZusammen(s), false, "aufgeloest");

	api.avesmapsGaretienStageEntfernen([m2.key]);
	const e3 = api.garetienVerbundKlick({ target: ziel({ "data-handlung": "verbund", "data-key": m1.key }) }, [m1, m2, m3]);
	gleich(e3.handlung, "verbund_gesperrt", "mit nur einem Fragment auf der Stage ist nichts zusammenzulegen");
	wahr(e3.grund !== "", "und der Verteiler nennt den Grund: " + e3.grund);

	api.avesmapsGaretienStageHinzufuegen([m2]);
	api.garetienVerbundZusammenlegen(s, []);
	const weg = api.garetienVerbundWegKlick({ target: ziel({ "data-verbund-weg": m2.key }) }, [m1, m2, m3]);
	gleich(weg.aufgeloest, true, "der ✕ des vorletzten Fragments loest den Verbund auf");
	gleich(api.garetienVerbundIstZusammen(s), false, "und die Entscheidung ist fort");
}

// =================================================================================================
// I. Name = Stamm, Beschriftungs-Vorschau und Kurvenbeschreibung -- bei einem ZUSAMMENGELEGTEN Verbund
// (Entwurf §6.3, §6.6, §10). Gemessen am FELD (das Markup, das der Editor sieht), am RUMPF (was der
// Server bekommt) UND an der VORSCHAU (was die Karte zeigt) -- alle drei muessen dasselbe sagen.
// Getippt wird ueber den ECHTEN Zuhoerer garetienEingabenAendern.
// ⚠️ Als async-Funktion, weil die Vorschau dem getippten Namen ENTPRELLT folgt; gerufen am Anfang
// des async-Laufs von Abschnitt H.
// =================================================================================================
function feldWert(markup, feld) {
	const eingabe = (markup.match(new RegExp('<input[^>]*data-gi-feld="' + feld + '"[^>]*>')) || [""])[0];
	if (eingabe === "") { return null; }
	if (/type="checkbox"/.test(eingabe)) { return / checked/.test(eingabe); }
	return (eingabe.match(/value="([^"]*)"/) || [null, ""])[1];
}
function eingabeEreignis(feld, werte) {
	return { target: Object.assign({
		getAttribute: (n) => (n === "data-gi-feld" ? feld : null),
		hasAttribute: (n) => n === "data-gi-feld",
	}, werte) };
}
const namensfeld = (o) => feldWert(api.garetienEinfuegeHakenMarkup(o), "einfuegeName");
// Die Vorschau: die REINE Regel wird geladen wie in index.html (vor dem Zeichnen), der Stempel laeuft im Fenster.
const vorschauRegel = require("../review-garetien-label-vorschau.js");
const VORSCHAU = api.AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL;
function vorschau(menge) {
	return (menge || []).filter((o) => o && o[VORSCHAU])
		.map((o) => o.key + "=" + o[VORSCHAU].text + "@" + o[VORSCHAU].punkt[0]).join(" | ");
}

async function abschnittI() {
	global.garetienVorschauLabelAus = vorschauRegel.garetienVorschauLabelAus;
	global.AVESMAPS_GARETIEN_VORSCHAU_ARTEN = vorschauRegel.AVESMAPS_GARETIEN_VORSCHAU_ARTEN;
	let gezeichnet = null;
	global.window.avesmapsGaretienKarteZeigen = function (menge) { gezeichnet = menge; };

	zuruecksetzen();
	{
		// m1: 11 Punkte, Mittelpunkt x=5, Item 101 -- der Anfuehrer. m2: 6 Punkte, x=2.5, Item 102.
		const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
		const alle = [m1, m2];
		const s = api.garetienVerbundSchluessel(m1);
		api.avesmapsGaretienStageHinzufuegen(alle);
		gleich(namensfeld(m1), "Silker Hain 1", "Gegenprobe: nicht zusammengelegt traegt jedes Fragment seinen Namen");
		gleich(vorschau(api.avesmapsGaretienAufDerKarte(alle)), "ggp:silkerhain:1=Silker Hain 1@5 | ggp:silkerhain:2=Silker Hain 2@2.5",
			"Gegenprobe: nicht zusammengelegt zwei Beschriftungen -- es entstehen zwei Objekte");

		// Lage 1: zusammengelegt, nichts getippt.
		api.garetienVerbundZusammenlegen(s, []);
		gleich(namensfeld(m1), "Silker Hain", "💣 zusammengelegt zeigt das Namensfeld den STAMM");
		gleich(namensfeld(m2), "Silker Hain", "an jedem Fragment");
		const rumpf1 = api.garetienEingabenFuerServer(m1);
		gleich("name" in rumpf1, false,
			"💣 die Vorgabe reist NICHT als Handname -- sonst naehme der Server sie und nie den Stamm: " + JSON.stringify(rumpf1));
		gleich(rumpf1.verbund, "Silker Hain", "der Rumpf traegt den Verbund, der Server setzt den Stamm");
		gleich(vorschau(api.avesmapsGaretienAufDerKarte(alle)), "ggp:silkerhain:1=Silker Hain@5",
			"🔴 die Vorschau zeigt EINE Beschriftung mit dem Stamm -- am Anfuehrer (kleinste Item-Nummer), auf SEINEM Mittelpunkt");

		// Lage 2: der Editor tippt einen Namen -- er gewinnt, am ganzen Verbund, und die Karte folgt.
		api.garetienDetailWaehlen(m1.key, alle);
		gezeichnet = null;
		api.garetienEingabenAendern(eingabeEreignis("einfuegeName", { type: "text", value: "Silker Forst" }), alle);
		gleich(namensfeld(m2), "Silker Forst", "ein getippter Name gewinnt und gilt dem ganzen Verbund");
		gleich(api.garetienEingabenFuerServer(m2).name, "Silker Forst", "und reist als Handname");
		await new Promise((fertig) => setTimeout(fertig, 300));
		wahr(gezeichnet !== null, "💣 die Karte zieht nach dem Tippen nach (entprellt) -- sonst zeigte sie den alten Namen");
		gleich(vorschau(gezeichnet), "ggp:silkerhain:1=Silker Forst@5", "und ihre Beschriftung traegt den getippten Namen");

		// Lage 3: aufgeloest -- jedes Fragment zeigt wieder seinen eigenen Namen, und es gibt wieder zwei Beschriftungen.
		api.garetienVerbundAufloesen(s);
		gleich(namensfeld(m1), "Silker Hain 1", "nach „Verbund auflösen\" wieder der eigene Name");
		gleich(namensfeld(m2), "Silker Hain 2", "an jedem Fragment");
		const rumpf3 = api.garetienEingabenFuerServer(m2);
		gleich(rumpf3 && ("name" in rumpf3 || "verbund" in rumpf3), false,
			"und der Rumpf traegt weder Namen noch Verbund: " + JSON.stringify(rumpf3));
		gleich(vorschau(api.avesmapsGaretienAufDerKarte(alle)), "ggp:silkerhain:1=Silker Hain 1@5 | ggp:silkerhain:2=Silker Hain 2@2.5",
			"und die Vorschau zeigt wieder beide eigenen Namen");
		api.garetienDetailWaehlen(null, alle);
	}

	zuruecksetzen();
	{
		const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
		// BESTAND: ein Einzelobjekt ohne Verbund-Felder.
		const einzeln = { key: "ggp:weidicht", name: "Weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
			stand: "offen", ziel: "region", subtyp: "wald", kind: "vegetation", geometrie: [[0, 0], [1, 1]],
			items: [{ id: 300, change_type: "new" }] };
		const alle = [m1, m2, einzeln];
		api.avesmapsGaretienStageHinzufuegen(alle);
		api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), []);

		gleich(api.garetienEingabenZustandZu(m1).curveLabel, false, "🔴 die Kurvenbeschreibung eines Verbunds startet aus");
		gleich(feldWert(api.garetienEingefuegtWirdMarkup(m1), "curveLabel"), false, "und das Haekchen im Kasten steht aus");
		gleich(api.garetienEingabenFuerServer(m1).curve_label, false, "und der Rumpf sagt es");
		gleich(api.garetienEingabenZustandZu(einzeln).curveLabel, api.garetienEingabenGrundwerte(einzeln).curveLabel,
			"ein Einzelobjekt behaelt die unveraenderte Vorgabe");

		api.garetienDetailWaehlen(m1.key, alle);
		api.garetienEingabenAendern(eingabeEreignis("curveLabel", { type: "checkbox", checked: true }), alle);
		gleich(feldWert(api.garetienEingefuegtWirdMarkup(m2), "curveLabel"), true,
			"ein Haekchen des Editors gewinnt -- am ganzen Verbund");
		gleich(api.garetienEingabenFuerServer(m2).curve_label, true, "und reist mit");
		api.garetienDetailWaehlen(null, alle);
	}
	delete global.window.avesmapsGaretienKarteZeigen;
}

// =================================================================================================
// H. „Stage leeren" und ein neuer Lauf vergessen die Einstellungen AM OBJEKT -- und nie, was dem
//    FENSTER gehoert: der Umkreis bleibt (Entscheid 14.09.2026, sonst stellt der Editor ihn nach
//    jedem Import neu ein).
// =================================================================================================
function einstellungenSetzen(o) {
	api.garetienNameWahlSetzen(o, "Handname");
	api.garetienUmkreisSetzen("naehe", 12);
	api.garetienZielWahlZu(o).subtyp = "sumpf";
	api.garetienInnerortsWahlSetzen(o, "stadt-1");
	api.garetienEinfuegeWahlSetzen(o, "quelle", false);
}
function einstellungenSindVergessen(o, wo) {
	gleich(api.garetienNameWahlZu(o), "", wo + ": Name vergessen");
	gleich(api.garetienUmkreisZu("naehe"), 12, wo + ": 🔴 der Umkreis gehoert dem FENSTER und bleibt stehen");
	gleich(api.garetienZielWahlZu(o).subtyp, "wald", wo + ": Zielwahl vergessen");
	gleich(api.garetienInnerortsWahlZu(o), "", wo + ": Innerorts-Wahl vergessen");
	gleich(api.garetienEinfuegeWahl(o).quelle, true, wo + ": Haekchen-Wahl vergessen");
}
const einzeln = {
	key: "ggp:weidicht", name: "Weidicht", ebene: "Waelder", typ: "Wald", ziel: "region", subtyp: "wald",
	innerorts: { kandidaten: [{ public_id: "stadt-1", name: "Wandleth", meilen: 1 }] },
	items: [{ id: 1, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"] }],
};
zuruecksetzen();
einstellungenSetzen(einzeln);
gleich(api.garetienNameWahlZu(einzeln), "Handname", "Vorbedingung: gesetzt");
gleich(api.garetienInnerortsWahlZu(einzeln), "stadt-1", "Vorbedingung: Innerorts gesetzt");
gleich(api.garetienEinfuegeWahl(einzeln).quelle, false, "Vorbedingung: Haekchen gesetzt");
api.avesmapsGaretienStageLeeren();
einstellungenSindVergessen(einzeln, "Stage leeren");

(async function () {
	await abschnittI();
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), []);
	einstellungenSetzen(einzeln);
	await api.garetienLaufStarten(
		function () { return Promise.resolve({ run_id: 0, fehler: [] }); },
		["ggp:Gewaesser"], function () {}, function () { return Promise.resolve(null); }
	);
	einstellungenSindVergessen(einzeln, "neuer Lauf");
	gleich(api.garetienVerbundIstZusammen(api.garetienVerbundSchluessel(m1)), false,
		"ein neuer Lauf nimmt die Entscheidung „zusammengelegt\" mit");
	gleich(api.avesmapsGaretienStageHat(m1.key), true, "die Stage selbst bleibt liegen -- sie wird nachgeschlagen");

	api.garetienUmkreisVergessen();
	zuruecksetzen();
	console.log(`garetien-verbund-stage-eintrag: ${checks} Pruefungen bestanden.`);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-verbund-stage-eintrag.test.js
```
Erwartet (gesehen): `AssertionError [ERR_ASSERTION]: garetienVerbundGroesstes fehlt im Export`

- [ ] **Schritt 3: Umsetzen**

In `js/review/review-garetien-importer.js`:

**Stelle 1** — ersetze:

```js
		// 🔴 Eine `Map` und nicht ein Objekt: sie haelt die Einfuegereihenfolge zu, und ein
		// Objektschluessel wie „constructor" kann ihr nichts anhaben.
		stage: new Map(),
```

durch:

```js
		// 🔴 Eine `Map` und nicht ein Objekt: sie haelt die Einfuegereihenfolge zu, und ein
		// Objektschluessel wie „constructor" kann ihr nichts anhaben.
		// 🔴 AUFGABE 6 (14.09.2026): JEDER WERT IST EIN EINTRAG `{ objekt, zusammen }`, nicht das Objekt
		// selbst. `zusammen` ist die Entscheidung „dieser Verbund ist zusammengelegt" (Entwurf §6.4) --
		// sie lebt und stirbt mit dem Eintrag. Ein Feld AM OBJEKT waere nach dem naechsten
		// avesmapsGaretienStageAuffrischen still fort (die Stage bekommt dort die frische Serverfassung)
		// und schriebe sich ueber die geteilte Referenz bis in `zustand.objekte` durch.
		// ⚠️ Gelesen wird die Stage NUR ueber avesmapsGaretienStageListe/-Hat; wer `zustand.stage`
		// direkt liest, bekommt Eintraege, keine Objekte.
		stage: new Map(),
```

**Stelle 2** — ersetze:

```js
			// ⚠️ Ein bereits liegendes Objekt wird ERSETZT, nicht uebersprungen: die frischere
			// Fassung kommt aus der letzten Serverantwort und kann ein geaendertes Urteil tragen.
			// Die Reihenfolge bleibt trotzdem die des ERSTEN Einfuegens -- `Map.set` auf einen
			// vorhandenen Schluessel sortiert nicht um.
			zustand.stage.set(String(o.key), o);
```

durch:

```js
			// ⚠️ Ein bereits liegendes Objekt wird ERSETZT, nicht uebersprungen: die frischere
			// Fassung kommt aus der letzten Serverantwort und kann ein geaendertes Urteil tragen.
			// Die Reihenfolge bleibt trotzdem die des ERSTEN Einfuegens -- der Eintrag bleibt derselbe.
			// 🔴 AUFGABE 6: EIN NEU AUFGELEGTER EINTRAG TRAEGT `zusammen = false`. Ein Fragment, das nach
			// „Stage leeren" einzeln wieder aufgelegt wird, ist NICHT zusammengelegt (K1, Entwurf §6.4).
			// Ein schon liegender Eintrag behaelt seine Entscheidung -- er wird nicht neu aufgelegt.
			const eintrag = zustand.stage.get(String(o.key));
			if (eintrag) {
				eintrag.objekt = o;
			} else {
				zustand.stage.set(String(o.key), { objekt: o, zusammen: false });
			}
```

**Stelle 3** — ersetze:

```js
	function avesmapsGaretienStageLeeren() {
		zustand.stage.clear();
		// ⚠️ Die Marken gehen MIT. Sonst traegt ein spaeter wieder hereingeholtes Objekt eine
		// Entscheidung aus einer Sitzung, an die sich niemand mehr erinnert.
		zustand.nurIhre.clear();
		return zustand.stage.size;
	}
```

durch:

```js
	function avesmapsGaretienStageLeeren() {
		zustand.stage.clear();
		// ⚠️ Die Marken gehen MIT. Sonst traegt ein spaeter wieder hereingeholtes Objekt eine
		// Entscheidung aus einer Sitzung, an die sich niemand mehr erinnert.
		zustand.nurIhre.clear();
		// 🔴 AUFGABE 6 (Fehler 10): UND DIE EINSTELLUNGEN GEHEN MIT -- dieselbe Begruendung. Die
		// Vergessen-Funktionen hatten bis zum 14.09.2026 keinen einzigen Produktivaufrufer.
		garetienEinstellungenVergessen();
		return zustand.stage.size;
	}
```

**Stelle 4** — ersetze:

```js
	function avesmapsGaretienStageEntfernen(schluessel) {
		let entfernt = 0;
		(schluessel || []).forEach(function (s) {
			const key = String(s);
			if (zustand.stage.delete(key)) { entfernt++; }
			zustand.nurIhre.delete(key);
		});
		return entfernt;
	}

	function avesmapsGaretienStageListe() {
		return Array.from(zustand.stage.values());
	}
```

durch:

```js
	// 🔴 AUFGABE 6 (Entwurf §6.3): BLEIBEN VON EINEM VERBUND WENIGER ALS ZWEI MITGLIEDER LIEGEN, IST ER
	// AUFGELOEST -- samt seiner Einstellungen. Hier und nicht im ✕-Verteiler: auch „Von der Stage
	// nehmen", die Auswahlleiste und der Nachschlag nach einem Lauf nehmen Eintraege herunter, und
	// eine Regel, die einen von vier Erzeugern bindet, ist keine Regel.
	function avesmapsGaretienStageEntfernen(schluessel) {
		let entfernt = 0;
		const betroffen = new Set();
		(schluessel || []).forEach(function (s) {
			const key = String(s);
			const eintrag = zustand.stage.get(key);
			if (eintrag) {
				const verbund = garetienVerbundSchluessel(eintrag.objekt);
				if (verbund !== "") { betroffen.add(verbund); }
				zustand.stage.delete(key);
				entfernt++;
			}
			zustand.nurIhre.delete(key);
		});
		betroffen.forEach(function (verbund) {
			if (garetienVerbundStageEintraege(verbund).length < 2) { garetienVerbundAufloesen(verbund); }
		});
		return entfernt;
	}

	function avesmapsGaretienStageListe() {
		return Array.from(zustand.stage.values(), function (eintrag) { return eintrag.objekt; });
	}
```

**Stelle 5** — ersetze:

```js
			if (zustand.stage.has(schluessel)) { zustand.stage.set(schluessel, o); }
```

durch:

```js
			// Aufgabe 6: der EINTRAG bleibt, nur sein Objekt wird frisch -- `zusammen` ueberlebt das.
			const eintrag = zustand.stage.get(schluessel);
			if (eintrag) { eintrag.objekt = o; }
```

**Stelle 6** — ersetze:

```js
				if (!o) {
					zustand.stage.delete(s);
					zustand.nurIhre.delete(s);
					verschwunden.push(s);
```

durch:

```js
				if (!o) {
					// Aufgabe 6: ueber die EINE Tuer -- sie loest einen Verbund auf, der dabei unter zwei faellt.
					avesmapsGaretienStageEntfernen([s]);
					verschwunden.push(s);
```

**Stelle 7** — ersetze:

```js
					zustand.stage.delete(s);
					zustand.nurIhre.delete(s);
					fertig.push(s);
```

durch:

```js
					avesmapsGaretienStageEntfernen([s]);
					fertig.push(s);
```

**Stelle 8** — ersetze:

```js
				zustand.stage.set(s, o);
```

durch:

```js
				zustand.stage.get(s).objekt = o;
```

**Stelle 9** — ersetze:

```js
	const AVESMAPS_GARETIEN_HAKEN_KLICK = "avesmapsGaretienKarteKlick";
```

durch:

```js
	const AVESMAPS_GARETIEN_HAKEN_KLICK = "avesmapsGaretienKarteKlick";

	/*
	 * Sind Wege-Verbuende freigegeben? (Aufgabe 6, Entwurf 2026-09-14 §6.6)
	 *
	 * 🔴 AB WERK NEIN. Zusammengelegte Wege-Abschnitte heissen nach dem Import wie ihr Stamm und
	 * werden damit EIN Weg (`name:<Wegart>:<Stamm>`). Ob „X" und „X 2" bei Wegen wirklich derselbe
	 * Weg sind, kann nur der Bestand sagen -- der Owner sieht die 19 Wege-Verbuende im Filter
	 * „nur Verbünde", BEVOR das live geht. Die Freigabe ist GENAU DIESE EINE ZEILE.
	 * ⚠️ Gelesen wird `_garetienVerbundWegeFrei` (darunter), damit ein Test beide Werte fahren kann,
	 * ohne den Quelltext umzuschreiben -- der Setzer steht nur unter `__test`.
	 */
	const AVESMAPS_GARETIEN_VERBUND_WEGE_FREI = false;
	let _garetienVerbundWegeFrei = AVESMAPS_GARETIEN_VERBUND_WEGE_FREI;
```

**Stelle 10** — ersetze:

```js
	// Welche Verbuende sind ZUSAMMENGELEGT? Ein Set von Verbundschluesseln.
	// 🔴 Der Zustand ist die MENGE, nicht ein Feld am Objekt: die Liste wird nach jedem
	// Schreibvorgang ersetzt (avesmapsGaretienStageAuffrischen), ein Feld waere still fort --
	// dieselbe Begruendung wie bei `zustand.nurIhre`.
	let _garetienVerbundZusammen = new Set();

	// 🔧 UNGEWIRT: es gibt (Stand Aufgabe 4) keine Stelle im Produktivcode, die einen Laufwechsel
	// meldet -- `garetienNameWahlVergessen` ist aus demselben Grund exportiert, aber ebenfalls
	// nirgends verdrahtet (siehe deren Definition). Export hier aus Symmetrie, damit eine spaetere
	// Aufgabe beide an derselben Stelle anschliessen kann.
	function garetienVerbundVergessen() { _garetienVerbundZusammen = new Set(); }

	function garetienVerbundIstZusammen(schluessel) {
		return _garetienVerbundZusammen.has(String(schluessel || ""));
	}

	// „Verbund auf die Stage" -- legt ALLE Mitglieder des Verbunds auf die Stage und merkt sich
	// den Verbund als zusammengelegt.
	//
	// 🔴 GEHT DURCH avesmapsGaretienStageHinzufuegen, SCHREIBT NIE SELBST AUF `zustand.stage`.
	// Ein gewoehnlicher Weg in die Anzeige hebt dort die „nur ihre"-Marke auf (Kommentar an deren
	// Definition) -- und "Verbund auf die Stage" IST so ein Weg, keine Ausnahme davon. Ein zweiter
	// Schreibweg waere ein zweiter Erzeuger fuer „kommt auf die Stage" und liesse die Leerschluessel-
	// Wache genau dort aus, wo sie gebraucht wird (AGENTS.md: „eine Regel, die einen von zwei
	// Erzeugern bindet, ist keine Regel").
	function garetienVerbundZusammenlegen(schluessel, objekte) {
		const s = String(schluessel || "");
		if (s === "") { return 0; }
		const mitglieder = garetienVerbundMitglieder(s, objekte);
		avesmapsGaretienStageHinzufuegen(mitglieder);
		_garetienVerbundZusammen.add(s);
		return mitglieder.length;
	}

	// „Verbund aufloesen" -- nimmt nur die MERKUNG zurueck, die Objekte bleiben auf der Stage.
	function garetienVerbundAufloesen(schluessel) {
		return _garetienVerbundZusammen.delete(String(schluessel || ""));
	}
```

durch:

```js
	// ---- Aufgabe 6 (Entwurf 2026-09-14 §6.3/§6.4): DER VERBUND LEBT AM STAGE-EINTRAG -----------------
	//
	// 💣 HIER STAND BIS ZUM 14.09.2026 EIN LOSES `Set` VON VERBUNDSCHLUESSELN (K1). Es ueberlebte
	// „Stage leeren" und neue Laeufe, verschmolz spaeter EINZELN aufgelegte Fragmente still und war
	// nach F5 fort. Jetzt steht die Entscheidung am Eintrag (`zustand.stage`, `{ objekt, zusammen }`)
	// und stirbt mit ihm.

	/* Die Stage-Eintraege eines Verbunds, in der Reihenfolge der Stage. */
	function garetienVerbundStageEintraege(schluessel) {
		const s = String(schluessel || "");
		if (s === "") { return []; }
		return Array.from(zustand.stage.values()).filter(function (eintrag) {
			return garetienVerbundSchluessel(eintrag.objekt) === s;
		});
	}

	/*
	 * Zusammengelegt heisst: MINDESTENS ZWEI Mitglieder auf der Stage, und JEDES traegt `zusammen`.
	 * 💣 „jedes", nicht „irgendeins": ein nach dem Zusammenlegen aufgelegtes Fragment traegt
	 * `zusammen = false` und ist damit nicht still verschmolzen -- der Verbund muss neu gelegt werden.
	 */
	function garetienVerbundIstZusammen(schluessel) {
		const eintraege = garetienVerbundStageEintraege(schluessel);
		return eintraege.length >= 2 && eintraege.every(function (eintrag) { return eintrag.zusammen === true; });
	}

	/*
	 * „Zusammenlegen (n)" -- markiert die Mitglieder, die AUF DER STAGE liegen. Rueckgabe: deren Zahl,
	 * 0 bei weniger als zwei oder wenn der Verbund nicht zusammenlegbar ist.
	 *
	 * 🔴 ES LEGT NICHTS AUF (Owner 09.09./1 und 12.09./5: zusammengelegt wird auf der Stage, per
	 * Klick). Die Mitglieder kommen aus der Stage selbst, nie aus `objekte`: die Stage ist filter-
	 * und seitenunabhaengig, die Liste nicht. `objekte` bleibt Teil der Signatur und wird nicht gelesen.
	 * 💣 DER RIEGEL STEHT HIER, NICHT NUR AM KNOPF: `disabled` ist die Anzeige, dies der Riegel.
	 */
	function garetienVerbundZusammenlegen(schluessel, objekte) {
		const eintraege = garetienVerbundStageEintraege(schluessel);
		if (eintraege.length < 2) { return 0; }
		if (!garetienVerbundZusammenlegbar(eintraege[0].objekt).ok) { return 0; }
		eintraege.forEach(function (eintrag) { eintrag.zusammen = true; });
		return eintraege.length;
	}

	/*
	 * „Verbund auflösen (n)" -- die Fragmente bleiben auf der Stage, die Entscheidung faellt.
	 * 🔴 UND DIE EINSTELLUNGEN DES VERBUNDS FALLEN MIT (Fehler 10): wer danach wieder zusammenlegt,
	 * faengt bei der Vorbelegung an, nicht bei einem Namen von vorhin.
	 */
	function garetienVerbundAufloesen(schluessel) {
		garetienVerbundStageEintraege(schluessel).forEach(function (eintrag) { eintrag.zusammen = false; });
		garetienVerbundEinstellungenVergessen(schluessel);
	}

	/*
	 * Die Einstellungen EINES Verbunds vergessen -- alles, was unter seinem Schluessel liegt.
	 * ⚠️ `_garetienInnerortsWahl` fehlt mit Absicht: sie liegt am Objektschluessel, nie am Verbund.
	 */
	function garetienVerbundEinstellungenVergessen(schluessel) {
		const s = String(schluessel || "");
		if (s === "") { return; }
		[_garetienZielWahl, _garetienNameWahl, _garetienEingabenZustand, _garetienEinfuegeWahl].forEach(function (speicher) {
			delete speicher[s];
		});
	}

	/*
	 * ALLE Verbund-Entscheidungen vergessen: jeder Eintrag verliert `zusammen`, und jede Einstellung
	 * unter einem Verbundschluessel faellt. Einer der Vergessen-Aufrufe von garetienEinstellungenVergessen.
	 * ⚠️ `_garetienEingabenZustand` hat keine eigene Vergessen-Funktion -- seine Verbund-Eintraege
	 * raeumt DIESE Funktion, sonst kaeme eine Groesse eines laengst aufgeloesten Verbunds zurueck.
	 */
	function garetienVerbundVergessen() {
		zustand.stage.forEach(function (eintrag) { eintrag.zusammen = false; });
		[_garetienZielWahl, _garetienNameWahl, _garetienEingabenZustand, _garetienEinfuegeWahl].forEach(function (speicher) {
			Object.keys(speicher).forEach(function (key) {
				if (key.indexOf("verbund:") === 0) { delete speicher[key]; }
			});
		});
	}

	/*
	 * „Stage leeren" und ein neuer Lauf: die Einstellungen AM OBJEKT vergessen (Entwurf §6.4, Fehler 10).
	 * 🔴 ZWEI SORTEN SPEICHER, UND NUR EINE FAELLT HIER. Was an einem Objekt oder Verbund haengt (Name,
	 * Form und Ziel, Eingaben, Einfuege- und Innerorts-Wahl, Verbund-Entscheidung) gehoert zu dem, was auf
	 * der Stage lag, und geht mit ihr. Was dem FENSTER gehoert (`_garetienUmkreis`, die Typwahl der Naehe,
	 * die Zeilengrenze) ueberlebt -- sonst stellte der Editor den Umkreis nach jedem Import neu ein
	 * (Entscheid 14.09.2026 nach den Owner-Massstaeben „Einstellungsmoeglichkeiten, Usability").
	 * ⭐ WER EINEN NEUEN SPEICHER BAUT, ORDNET IHN HIER EIN: haengt er am Einstellungs- oder Objektschluessel,
	 * gehoert sein Vergessen-Aufruf in diese Liste -- und kann er am Verbundschluessel liegen, zusaetzlich in
	 * die Speicherlisten von garetienVerbundVergessen und garetienVerbundEinstellungenVergessen. Gehoert er
	 * dem Fenster, bleibt er draussen. Hier steht bewusst keine Zahl: eine Zahl liest sich wie eine
	 * vollstaendige Liste, und niemand zaehlt nach (AGENTS.md §11).
	 */
	function garetienEinstellungenVergessen() {
		garetienVerbundVergessen();
		garetienNameWahlVergessen();
		garetienInnerortsWahlVergessen();
		garetienZielWahlVergessen();
		garetienEinfuegeWahlVergessen();
	}

	/*
	 * REIN: das groesste Mitglied eines Verbunds -- die meisten Punkte, bei Gleichstand der kleinste
	 * Schluessel. `null` ohne Mitglieder.
	 * 💣 FEHLER 6: bis zum 14.09.2026 bestimmte das ZUERST BERUEHRTE Fragment die Form fuer alle; war
	 * es klein genug fuer einen Berggipfel, schickte der ganze Verbund `ziel: label`, und es entstand
	 * gar kein Verbund.
	 */
	function garetienVerbundGroesstes(schluessel, objekte) {
		let bestes = null;
		let bestePunkte = -1;
		garetienVerbundMitglieder(schluessel, objekte).forEach(function (m) {
			const punkte = Array.isArray(m.geometrie) ? m.geometrie.length : 0;
			if (punkte > bestePunkte || (punkte === bestePunkte && String(m.key) < String(bestes.key))) {
				bestes = m;
				bestePunkte = punkte;
			}
		});
		return bestes;
	}

	/*
	 * Aus WELCHEM Objekt wird die Vorbelegung eines Objekts gerechnet? Sein eigenes -- ausser es
	 * gehoert zu einem zusammengelegten Verbund, dann das groesste Mitglied auf der Stage.
	 * Leser: garetienZielWahlZu und garetienEingabenZustandZu (die zwei Vorbelegungen am
	 * Einstellungsschluessel).
	 */
	function garetienEinstellungsVorlage(objekt) {
		const verbund = garetienVerbundSchluessel(objekt);
		if (verbund === "" || !garetienVerbundIstZusammen(verbund)) { return objekt; }
		return garetienVerbundGroesstes(verbund, avesmapsGaretienStageListe()) || objekt;
	}

	/*
	 * Laesst sich dieser Verbund zusammenlegen? `{ ok, grund }` -- der Grund steht sichtbar am Knopf.
	 *
	 * 🔴 NUR ALS FLAECHE ODER WEG (Entwurf §6.3): „Ein Verbund, der als Punkt ankommt, ist keiner."
	 * 🔴 WEGE ERST NACH DER FREIGABE (AVESMAPS_GARETIEN_VERBUND_WEGE_FREI).
	 * ⚠️ Massgeblich ist die Form, die der Verbund bekaeme: zusammengelegt die Wahl am
	 * Verbundschluessel, sonst die des GROESSTEN Mitglieds auf der Stage -- aus ihm wird nach dem
	 * Zusammenlegen vorbelegt (Fehler 6).
	 * 🔧 BIS AUFGABE 9 gibt es keine Zielwahl „karte": geprueft wird die Form (`garetienZielWahlZu(massgeblich).ziel`).
	 * Aufgabe 9 erweitert die Bedingung um `garetienZielwahlZu(objekt) === "karte"`.
	 */
	function garetienVerbundZusammenlegbar(objekt) {
		const schluessel = garetienVerbundSchluessel(objekt);
		if (schluessel === "") { return { ok: false, grund: "Dieses Objekt gehört zu keinem Verbund." }; }
		const massgeblich = garetienVerbundIstZusammen(schluessel)
			? objekt
			: (garetienVerbundGroesstes(schluessel, avesmapsGaretienStageListe()) || objekt);
		const form = String(garetienZielWahlZu(massgeblich).ziel || "");
		if (form === "region") { return { ok: true, grund: "" }; }
		if (form === "path") {
			return _garetienVerbundWegeFrei
				? { ok: true, grund: "" }
				: { ok: false, grund: "Wege-Verbünde sind noch nicht freigegeben." };
		}
		const gewaehlt = garetienUnserBeschriftung(massgeblich) || form || "keine Form";
		return { ok: false, grund: "Ein Verbund wird eine Fläche oder ein Weg — gewählt ist „" + gewaehlt + "“." };
	}
```

**Stelle 11** — ersetze:

```js
		const key = garetienEinstellungsSchluessel(objekt);
		if (!_garetienEingabenZustand[key]) {
			_garetienEingabenZustand[key] = garetienEingabenGrundwerte(objekt);
		}
```

durch:

```js
		const key = garetienEinstellungsSchluessel(objekt);
		if (!_garetienEingabenZustand[key]) {
			// Aufgabe 6 (Fehler 6): ein zusammengelegter Verbund belegt aus seinem GROESSTEN Mitglied vor.
			const grundwerte = garetienEingabenGrundwerte(garetienEinstellungsVorlage(objekt));
			// 🔴 Aufgabe 6 (Entwurf §6.6): die Kurvenbeschreibung eines ZUSAMMENGELEGTEN Verbunds startet AUS
			// -- ueber vier Stuecke, die Meilen auseinanderliegen, hat noch niemand eine Kurve gesehen;
			// eingeschaltet wird sie im Landschaften-Editor. Ein Haekchen des Editors gewinnt: es schreibt in
			// genau diesen Zustand, und der wird nur beim ERSTEN Zugriff angelegt.
			// ⚠️ Der Schluessel ist genau dann nicht der eigene, wenn der Verbund zusammengelegt ist.
			// ⚠️ Heute ist die Grundvorgabe fuer JEDES Objekt aus (garetienEingabenGrundwerte); die Zeile
			// haelt die Verbund-Regel fest, falls eine Art je eine Kurven-Vorgabe bekommt.
			if (key !== String((objekt && objekt.key) || "")) { grundwerte.curveLabel = false; }
			_garetienEingabenZustand[key] = grundwerte;
		}
```

**Stelle 12** — ersetze:

```js
		if (!_garetienZielWahl[key]) {
			_garetienZielWahl[key] = garetienZielVorbelegung(objekt);
		}
```

durch:

```js
		if (!_garetienZielWahl[key]) {
			// 💣 Aufgabe 6 (Fehler 6): ein zusammengelegter Verbund belegt aus seinem GROESSTEN Mitglied
			// vor, nie aus dem zuerst beruehrten -- sonst macht ein kleines Fragment den Verbund zum Gipfel.
			_garetienZielWahl[key] = garetienZielVorbelegung(garetienEinstellungsVorlage(objekt));
		}
```

**Stelle 13** — ersetze:

```js
		const schluessel = garetienVerbundSchluessel(objekt);
		if (schluessel === "") { return null; }
		if (garetienVerbundIstZusammen(schluessel)) {
			garetienVerbundAufloesen(schluessel);
			return { handlung: "verbund_aufgeloest", schluessel: schluessel };
		}
		const n = garetienVerbundZusammenlegen(schluessel, objekte || []);
		return { handlung: "verbund_zusammengelegt", schluessel: schluessel, anzahl: n };
	}
```

durch:

```js
		const schluessel = garetienVerbundSchluessel(objekt);
		if (schluessel === "") { return null; }
		if (garetienVerbundIstZusammen(schluessel)) {
			garetienVerbundAufloesen(schluessel);
			return { handlung: "verbund_aufgeloest", schluessel: schluessel };
		}
		// 🔴 Aufgabe 6: Zusammenlegen LEGT NICHT AUF -- es markiert, was schon auf der Stage liegt.
		const n = garetienVerbundZusammenlegen(schluessel, objekte || []);
		if (n === 0) {
			// 💣 Ein „Nein" zaehlt als GEFUNDEN (kein `null`) -- sonst fiele derselbe Klick weiter zu
			// garetienHandlungKlick durch. Der Grund reist mit.
			const grund = garetienVerbundStageEintraege(schluessel).length < 2
				? "Von diesem Verbund liegen weniger als zwei Fragmente auf der Stage."
				: garetienVerbundZusammenlegbar(objekt).grund;
			return { handlung: "verbund_gesperrt", schluessel: schluessel, grund: grund };
		}
		return { handlung: "verbund_zusammengelegt", schluessel: schluessel, anzahl: n };
	}
```

**Stelle 14** — ersetze:

```js
	 * Nimmt GENAU DIESES EINE Fragment von der Stage -- `avesmapsGaretienStageEntfernen` ist das
	 * exakte Gegenstück zu `avesmapsGaretienStageHinzufuegen`, mit dem `garetienVerbundZusammenlegen`
	 * die Mitglieder überhaupt erst hinaufgelegt hat. Der Knopf „Verbund auflösen" bleibt daneben
	 * stehen und trifft den GANZEN Verbund (nur die Merkung); dieser Knopf trifft nur EIN Mitglied
	 * (die Stage selbst).
	 *
	 * 🔴 BLEIBEN DANACH WENIGER ALS ZWEI MITGLIEDER AUF DER STAGE, FÄLLT DIE MERKUNG MIT
	 * (`garetienVerbundAufloesen`): ein Verbund aus einem Stück ist keiner mehr -- dieselbe Regel
	 * wie bei `garetienVerbundMarkeMarkup`/`garetienVerbundBlockMarkup` (`n < 2`). Ohne das bliebe
	 * `_garetienVerbundZusammen` für einen Schlüssel gesetzt, dessen letztes verbliebenes Mitglied
	 * `garetienEinstellungsSchluessel` dann fälschlich weiter auf den VERBUND-Schlüssel zeigen
	 * ließe statt auf sein eigenes.
	 * ⚠️ Gezählt wird über die STAGE (`avesmapsGaretienStageHat` je Mitglied), NICHT über die Länge
	 * von `garetienVerbundMitglieder`: die volle Gruppe aus `objekte` schrumpft durch dieses
	 * Herausnehmen nicht (sie kommt vom Server bzw. vom aktuellen Reiter) -- nur die Stage tut es.
	 */
	function garetienVerbundWegKlick(ereignis, objekte) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		const knopf = ziel.closest("[data-verbund-weg]");
		if (!knopf || knopf.disabled) { return null; }
		const schluesselFragment = String(knopf.getAttribute("data-verbund-weg") || "");
		if (schluesselFragment === "") { return null; }
		const objekt = garetienObjektNach(schluesselFragment, objekte);
		const verbund = objekt ? garetienVerbundSchluessel(objekt) : "";
		avesmapsGaretienStageEntfernen([schluesselFragment]);
		let aufgeloest = false;
		if (verbund !== "") {
			const verbleibend = garetienVerbundMitglieder(verbund, objekte || []).filter(function (m) {
				return avesmapsGaretienStageHat(m.key);
			}).length;
			if (verbleibend < 2) { aufgeloest = garetienVerbundAufloesen(verbund); }
		}
		return { handlung: "verbund_fragment_entfernt", key: schluesselFragment, verbund: verbund,
			aufgeloest: aufgeloest };
	}
```

durch:

```js
	 * Nimmt GENAU DIESES EINE Fragment von der Stage -- ueber `avesmapsGaretienStageEntfernen`, die
	 * EINE Tuer herunter. Der Knopf „Verbund auflösen" daneben trifft den GANZEN Verbund (nur die
	 * Entscheidung); dieser Knopf trifft nur EIN Mitglied (die Stage selbst).
	 *
	 * 🔴 AUFGABE 6: DAS AUFLOESEN UNTER ZWEI STEHT JETZT IN DER TUER (avesmapsGaretienStageEntfernen),
	 * nicht mehr hier -- „Von der Stage nehmen", die Auswahlleiste und der Nachschlag nach einem Lauf
	 * nehmen ebenfalls herunter. Hier wird nur noch gemeldet, ob die Entscheidung dabei gefallen ist.
	 * ⚠️ Das Objekt wird zuerst in `objekte` gesucht, sonst am Stage-Eintrag: die Liste kann gefiltert
	 * sein (Aufgabe 5), der ✕ steht trotzdem an einem Fragment, das auf der Stage liegt.
	 */
	function garetienVerbundWegKlick(ereignis, objekte) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return null; }
		const knopf = ziel.closest("[data-verbund-weg]");
		if (!knopf || knopf.disabled) { return null; }
		const schluesselFragment = String(knopf.getAttribute("data-verbund-weg") || "");
		if (schluesselFragment === "") { return null; }
		const eintrag = zustand.stage.get(schluesselFragment);
		const objekt = garetienObjektNach(schluesselFragment, objekte) || (eintrag ? eintrag.objekt : null);
		const verbund = objekt ? garetienVerbundSchluessel(objekt) : "";
		const warZusammen = verbund !== "" && garetienVerbundIstZusammen(verbund);
		avesmapsGaretienStageEntfernen([schluesselFragment]);
		return { handlung: "verbund_fragment_entfernt", key: schluesselFragment, verbund: verbund,
			aufgeloest: warZusammen && !garetienVerbundIstZusammen(verbund) };
	}
```

**Stelle 15** — ersetze:

```js
	function garetienVorschauLabelStempeln(objekte) {
		if (typeof garetienVorschauLabelAus !== "function") { return objekte; }
		return (objekte || []).map(function (o) {
			if (!o) { return o; }
```

durch:

```js
	/*
	 * Welches Mitglied eines zusammengelegten Verbunds legt beim Import Beschriftung und Region an?
	 *
	 * 🔴 DASSELBE WIE AM SERVER: das Item mit der KLEINSTEN sync_plan_item.id (Entwurf §6.6). apply arbeitet
	 * die Items in id-Reihenfolge ab; das erste Fragment findet keine Region und legt Beschriftung und
	 * Region an, alle weiteren haengen nur ihre Flaeche daran (avesmapsGaretienVerbundRegion). Die
	 * Beschriftung sitzt deshalb auf dem Mittelpunkt DIESES Fragments (Entwurf §10), und die Vorschau zeigt
	 * sie genau dort -- EINE, nicht eine je Fragment.
	 * ⚠️ Gezaehlt werden die Neu-Items (garetienNeuItems); ein Mitglied ohne Item-Nummer kommt nach allen
	 * anderen, bei Gleichstand entscheidet der kleinste Schluessel.
	 */
	function garetienVerbundAnfuehrer(schluessel) {
		let bester = null;
		let besteId = Infinity;
		garetienVerbundStageEintraege(schluessel).forEach(function (eintrag) {
			const ids = garetienNeuItems(eintrag.objekt).map(function (item) { return Number(item && item.id); })
				.filter(function (id) { return id > 0; });
			const id = ids.length > 0 ? Math.min.apply(null, ids) : Infinity;
			if (bester === null || id < besteId
				|| (id === besteId && String(eintrag.objekt.key) < String(bester.key))) {
				bester = eintrag.objekt;
				besteId = id;
			}
		});
		return bester;
	}

	function garetienVorschauLabelStempeln(objekte) {
		if (typeof garetienVorschauLabelAus !== "function") { return objekte; }
		return (objekte || []).map(function (o) {
			if (!o) { return o; }
			// 🔴 Aufgabe 6: EIN zusammengelegter Verbund legt EINE Beschriftung an -- am Anfuehrer. Die
			// uebrigen Fragmente bleiben als Flaeche gezeichnet, ohne eigenen Namen; vier Namen auf der
			// Karte zeigten etwas anderes, als angelegt wird.
			const verbund = garetienVerbundSchluessel(o);
			if (verbund !== "" && garetienVerbundIstZusammen(verbund)
				&& String(o.key) !== String((garetienVerbundAnfuehrer(verbund) || {}).key)) {
				return o;
			}
```

**Stelle 16** — ersetze:

```js
			const beschreibung = garetienVorschauLabelAus(o, wahl, garetienEingabenZustandZu(o),
				o[AVESMAPS_GARETIEN_FELD_GEWAEHLT] === true);
```

durch:

```js
			// 🔴 Aufgabe 6: der TEXT kommt aus DERSELBEN Quelle wie das Namensfeld (garetienNameFuerImport)
			// -- Handname, bei einem zusammengelegten Verbund sonst der Stamm. Hereingereicht, keine zweite
			// Rechnung in der Regel.
			const beschreibung = garetienVorschauLabelAus(o, wahl, garetienEingabenZustandZu(o),
				o[AVESMAPS_GARETIEN_FELD_GEWAEHLT] === true, garetienNameFuerImport(o));
```

**Stelle 17** — ersetze:

```js
	const AVESMAPS_GARETIEN_VORSCHAU_FELDER = [
		"showName", "size", "priority", "minZoom", "maxZoom", "zielForm", "zielArt",
	];
```

durch:

```js
	const AVESMAPS_GARETIEN_VORSCHAU_FELDER = [
		"showName", "size", "priority", "minZoom", "maxZoom", "zielForm", "zielArt",
		// Aufgabe 6 (14.09.2026): der Name steht in der Beschriftung -- entprellt nachgezogen, siehe
		// garetienEingabenAendern.
		"einfuegeName",
	];
	let _garetienNameVorschauTimer = null;
```

**Stelle 18** — ersetze:

```js
		if (feld === "einfuegeName") {
			garetienNameWahlSetzen(objekt, ziel.value);
			return;
		}
```

durch:

```js
		if (feld === "einfuegeName") {
			garetienNameWahlSetzen(objekt, ziel.value);
			// 🔴 Aufgabe 6: die Beschriftungs-Vorschau zeigt den Namen und zieht nach -- ENTPRELLT, weil
			// ein Kartenlauf die ganze Menge neu zeichnet und das hier je Tastendruck liefe (die Warnung
			// an AVESMAPS_GARETIEN_VORSCHAU_FELDER). Dieselbe Frist wie das Suchfeld der Liste.
			if (_garetienNameVorschauTimer) { clearTimeout(_garetienNameVorschauTimer); }
			_garetienNameVorschauTimer = setTimeout(function () {
				_garetienNameVorschauTimer = null;
				garetienVorschauNachziehen(feld);
			}, 250);
			return;
		}
```

**Stelle 19** — ersetze:

```js
	/* REIN: der Name, den dieses Objekt beim Import bekommt -- Handeingabe, sonst der Vorschlag. */
	function garetienNameFuerImport(objekt) {
		const eigen = garetienNameWahlZu(objekt);
		return eigen !== "" ? eigen : String((objekt && objekt.name) || "");
	}
```

durch:

```js
	/*
	 * REIN: der Name, den dieses Objekt beim Import bekommt -- Handeingabe, sonst die Vorgabe.
	 *
	 * 🔴 Aufgabe 6 (Entwurf §6.3, §6.6): DIE VORGABE EINES ZUSAMMENGELEGTEN VERBUNDS IST SEIN STAMM. Der
	 * Server setzt den Stamm selbst, wenn der Rumpf einen Verbund und KEINEN Handnamen traegt (Aufgabe 2).
	 * Zeigte das Namensfeld hier den Namen eines Fragments („Silker Hain 3"), sagte die Oberflaeche etwas
	 * anderes, als angelegt wird.
	 * 💣 DIE VORGABE REIST NIE ALS HANDNAME. garetienEingabenFuerServer haengt den Namen nur an, wenn
	 * garetienNameWahlZu etwas liefert -- ein unveraendertes Feld schickt nichts, und der Server nimmt den
	 * Stamm. Wer die Vorgabe in den Namensspeicher schriebe, naehme dem Server seine Stamm-Regel.
	 * ⚠️ Nach „Verbund auflösen" faellt ein getippter Verbundname mit (garetienVerbundEinstellungenVergessen),
	 * und jedes Fragment zeigt wieder seinen eigenen Namen.
	 */
	function garetienNameFuerImport(objekt) {
		const eigen = garetienNameWahlZu(objekt);
		if (eigen !== "") { return eigen; }
		const verbund = garetienVerbundSchluessel(objekt);
		if (verbund !== "" && garetienVerbundIstZusammen(verbund)) { return String(objekt.verbund_stamm || ""); }
		return String((objekt && objekt.name) || "");
	}
```

**Stelle 20** — ersetze:

```js
		garetienLaufLaeuft = true;
		garetienLaufMeldung = "";
```

durch:

```js
		garetienLaufLaeuft = true;
		// 🔴 Aufgabe 6 (Entwurf §6.4): ein NEUER LAUF nimmt die Entscheidungen und Einstellungen mit.
		// Die Stage selbst bleibt -- sie wird nach dem Rechnen nachgeschlagen (garetienStageNachschlagen).
		garetienEinstellungenVergessen();
		garetienLaufMeldung = "";
```

**Stelle 21** — ersetze:

```js
			garetienVerbundIstZusammen,
			garetienVerbundVergessen,
```

durch:

```js
			garetienVerbundIstZusammen,
			garetienVerbundVergessen,
			// Aufgabe 6 (2026-09-14): der Verbund am Stage-Eintrag
			garetienVerbundGroesstes,
			garetienVerbundZusammenlegbar,
```

**Stelle 22** — ersetze:

```js
			__test: {
				garetienImportFormenText,
```

durch:

```js
			__test: {
				// Aufgabe 6 (2026-09-14): die Freigabe der Wege-Verbuende -- die Konstante zum Vergleichen,
				// der Setzer, damit ein Test beide Werte fahren kann, ohne den Quelltext umzuschreiben.
				AVESMAPS_GARETIEN_VERBUND_WEGE_FREI,
				garetienVerbundWegeFreiSetzen: function (wert) { _garetienVerbundWegeFrei = wert === true; },
				garetienImportFormenText,
```

In `js/review/review-garetien-label-vorschau.js`:

**Stelle 1** — ersetze:

```js
	 * @param gewaehlt ist die Zeile dieses Objekts offen? -- HEREINGEREICHT, nicht selbst gelesen
	 */
	function garetienVorschauLabelAus(objekt, wahl, eingaben, gewaehlt) {
```

durch:

```js
	 * @param gewaehlt ist die Zeile dieses Objekts offen? -- HEREINGEREICHT, nicht selbst gelesen
	 * @param name     der Name, unter dem das Objekt angelegt wird (garetienNameFuerImport) -- HEREINGEREICHT;
	 *                 fehlt er, gilt `objekt.name` (so rufen die Regeltests)
	 */
	function garetienVorschauLabelAus(objekt, wahl, eingaben, gewaehlt, name) {
```

**Stelle 2** — ersetze:

```js
		var text = String(objekt.name || "").trim();
```

durch:

```js
		// 🔴 Aufgabe 6 (Garetien-Importer vereint, 14.09.2026): der Text ist der Name, unter dem ANGELEGT
		// wird -- ein Handname, bei einem zusammengelegten Verbund sonst der Stamm. Er wird hereingereicht,
		// nicht hier gerechnet: das Fenster kennt Handname und Verbund, diese Datei soll beides nicht kennen
		// (dieselbe Lehre wie beim Weiss, `gewaehlt`).
		var text = String(name === undefined ? (objekt.name || "") : (name || "")).trim();
```

Die sechs fremden Tests nageln das alte Verhalten fest („Zusammenlegen legt auf", Fixtures ohne `ziel`, `Aufloesen` meldet `true`). Nach der Umsetzung fallen sie so (gesehen): `garetien-verbund-einstellungen` „Testaufbau: beide Fragmente liegen auf der Stage", `garetien-verbund-fragment-weg` „Vorbedingung: der Verbund liegt zusammen", `garetien-verbund-klick` „zusammengelegt: „Verbund auflösen (n)“", `garetien-verbund-rumpf` „Testaufbau: jetzt zusammengelegt", `garetien-verbund-stage` „zwei Mitglieder -- 'c' gehoert nicht zum Verbund", `garetien-label-vorschau-zeichnen` „⚠️ DREI Ausgaenge von garetienEingabenAendern …" (`4 !== 3`). Neue Zusicherungen:

`js/review/__tests__/garetien-label-vorschau-zeichnen.test.js` (Abschnitt 10):

**Stelle 1** — ersetze:

```js
gleich((importerQuelle.match(/garetienVorschauNachziehen\(feld\);/g) || []).length, 3,
	"⚠️ DREI Ausgaenge von garetienEingabenAendern fuehren an beschriftungsrelevanten Feldern vorbei "
	+ "(Formwahl, Haekchen, Zahl) -- fehlt einer, wirkt genau dieses Feld erst spaeter");
```

durch:

```js
// 🔴 Aufgabe 6 (Garetien-Importer vereint, 14.09.2026): der NAME steht in der Beschriftung und zieht
// seither ebenfalls nach -- entprellt, im Namenszweig. Dass er es wirklich tut, faehrt
// garetien-verbund-stage-eintrag.test.js (Abschnitt I) aus; hier bleibt nur die Zaehlung der Ausgaenge.
gleich((importerQuelle.match(/garetienVorschauNachziehen\(feld\);/g) || []).length, 4,
	"⚠️ VIER Ausgaenge von garetienEingabenAendern fuehren an beschriftungsrelevanten Feldern vorbei "
	+ "(Formwahl, Haekchen, Zahl, Name) -- fehlt einer, wirkt genau dieses Feld erst spaeter");
wahr(/AVESMAPS_GARETIEN_VORSCHAU_FELDER\s*=\s*\[[^\]]*"einfuegeName"/.test(importerQuelle),
	"„einfuegeName\" fehlt in der Liste der nachziehenden Felder");
```

`js/review/__tests__/garetien-verbund-einstellungen.test.js`:

**Stelle 1** — ersetze:

```js
    const verbund = { ebene: "region", typ: "wald", verbund_stamm: "Pruefwald-Fixrunde1",
        verbund_n: 2 };
```

durch:

```js
    // Aufgabe 6 (14.09.2026): Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
    const verbund = { ebene: "region", typ: "wald", verbund_stamm: "Pruefwald-Fixrunde1",
        verbund_n: 2, ziel: "region", subtyp: "wald" };
```

**Stelle 2** — ersetze:

```js
    assert.strictEqual(api.garetienVerbundZusammenlegen(schluessel, [m1, m2]), 2,
        "Testaufbau: beide Fragmente liegen auf der Stage");
```

durch:

```js
    // 🔴 Aufgabe 6: Zusammenlegen legt NICHT mehr auf -- erst auflegen, dann zusammenlegen.
    api.avesmapsGaretienStageHinzufuegen([m1, m2]);
    assert.strictEqual(api.garetienVerbundZusammenlegen(schluessel, [m1, m2]), 2,
        "Testaufbau: beide Fragmente liegen auf der Stage und sind zusammengelegt");
```

`js/review/__tests__/garetien-verbund-rumpf.test.js`:

**Stelle 1** — ersetze:

```js
	const verbund = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: 2 };
```

durch:

```js
	// Aufgabe 6 (14.09.2026): Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
	const verbund = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: 2,
		ziel: "region", subtyp: "wald" };
```

**Stelle 2** — ersetze:

```js
	api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
	assert.ok(api.garetienVerbundIstZusammen(schluessel), "Testaufbau: jetzt zusammengelegt");
```

durch:

```js
	// 🔴 Aufgabe 6: Zusammenlegen legt NICHT mehr auf -- erst auflegen, dann zusammenlegen.
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
	assert.ok(api.garetienVerbundIstZusammen(schluessel), "Testaufbau: jetzt zusammengelegt");
```

**Stelle 3** — ersetze:

```js
	api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
	api.garetienNameWahlSetzen(m1, "Silker Forst");
```

durch:

```js
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
	api.garetienNameWahlSetzen(m1, "Silker Forst");
```

`js/review/__tests__/garetien-verbund-klick.test.js` (Aufgabe 7 ersetzt die Datei danach ganz):

**Stelle 1** — ersetze:

```js
	const basis = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: n };
```

durch:

```js
	// Aufgabe 6 (14.09.2026): Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
	const basis = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: n,
		ziel: "region", subtyp: "wald" };
```

**Stelle 2** — ersetze:

```js
		const schluessel = api.garetienVerbundSchluessel(m1);
		api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
```

durch:

```js
		const schluessel = api.garetienVerbundSchluessel(m1);
		// 🔴 Aufgabe 6: Zusammenlegen legt NICHT mehr auf -- erst auflegen, dann zusammenlegen.
		api.avesmapsGaretienStageHinzufuegen([m1, m2]);
		api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
```

**Stelle 3** — ersetze:

```js
	// Ein Klick auf den Knopf: legt zusammen.
	const ergebnis1 = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	wahr(Boolean(ergebnis1), "der erste Klick legt zusammen und meldet ein Ergebnis");
	gleich(ergebnis1.handlung, "verbund_zusammengelegt", "und benennt die Richtung");
	gleich(api.garetienVerbundIstZusammen(schluesselC), true,
		"der Verbund gilt jetzt als zusammengelegt");
	gleich(api.avesmapsGaretienStageHat(c1.key), true, "und BEIDE Mitglieder liegen auf der Stage");
	gleich(api.avesmapsGaretienStageHat(c2.key), true, "…auch das zweite, nicht nur das angeklickte");
```

durch:

```js
	// 🔴 Aufgabe 6 (14.09.2026): der Klick LEGT NICHT AUF. Mit nur einem Fragment auf der Stage ist
	// nichts zusammenzulegen -- das „Nein" zaehlt als gefunden und nennt den Grund.
	api.avesmapsGaretienStageHinzufuegen([c1]);
	const gesperrt = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(gesperrt.handlung, "verbund_gesperrt", "ein Fragment auf der Stage: gesperrt, kein Auflegen");
	gleich(api.avesmapsGaretienStageHat(c2.key), false, "💣 und das zweite Fragment bleibt, wo es war");

	// Beide auf der Stage: der Klick legt zusammen.
	api.avesmapsGaretienStageHinzufuegen([c2]);
	const ergebnis1 = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	wahr(Boolean(ergebnis1), "der erste Klick legt zusammen und meldet ein Ergebnis");
	gleich(ergebnis1.handlung, "verbund_zusammengelegt", "und benennt die Richtung");
	gleich(api.garetienVerbundIstZusammen(schluesselC), true,
		"der Verbund gilt jetzt als zusammengelegt");
	gleich(api.avesmapsGaretienStageHat(c1.key), true, "beide Mitglieder liegen weiter auf der Stage");
	gleich(api.avesmapsGaretienStageHat(c2.key), true, "auch das zweite");
```

`js/review/__tests__/garetien-verbund-fragment-weg.test.js`:

**Stelle 1** — ersetze:

```js
	const basis = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: n };
```

durch:

```js
	// Aufgabe 6 (14.09.2026): Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
	const basis = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: n,
		ziel: "region", subtyp: "wald" };
```

**Stelle 2** — ersetze:

```js
	api.garetienVerbundZusammenlegen(schluessel, vier);
```

durch:

```js
	// 🔴 Aufgabe 6: Zusammenlegen legt NICHT mehr auf -- erst auflegen, dann zusammenlegen.
	api.avesmapsGaretienStageHinzufuegen(vier);
	api.garetienVerbundZusammenlegen(schluessel, vier);
```

**Stelle 3** — ersetze:

```js
	api.garetienVerbundZusammenlegen(schluesselZwei, zwei);
```

durch:

```js
	api.avesmapsGaretienStageHinzufuegen(zwei);
	api.garetienVerbundZusammenlegen(schluesselZwei, zwei);
```

**Stelle 4** — ersetze:

```js
	// =============================================================================================
	// D. Der Null-Fragment-Fall: das letzte auf der Stage verbliebene Mitglied selbst wird
	// entfernt -- auch dann faellt die Merkung, keine Ausnahme fuer "0 statt 1".
	// =============================================================================================
	const eins = fragmente(2);
	const schluesselEins = api.garetienVerbundSchluessel(eins[0]);
	api.garetienVerbundZusammenlegen(schluesselEins, eins);
	// Das zweite Mitglied vorab wieder von der Stage nehmen (simuliert: schon vorher entfernt).
	api.avesmapsGaretienStageEntfernen([eins[1].key]);
	wahr(api.avesmapsGaretienStageHat(eins[0].key), "Vorbedingung: genau ein Mitglied auf der Stage");

	const ergebnisNull = api.garetienVerbundWegKlick(
		{ target: ziel({ "data-verbund-weg": eins[0].key }) }, eins);
	gleich(ergebnisNull.aufgeloest, true, "0 verbliebene Mitglieder loesen die Merkung ebenso auf");
	gleich(api.garetienVerbundIstZusammen(schluesselEins), false, "die Merkung ist weg");
	zuruecksetzen();
```

durch:

```js
	// =============================================================================================
	// D. 🔴 Aufgabe 6 (14.09.2026): das Aufloesen unter zwei steht in der TUER
	// (avesmapsGaretienStageEntfernen), nicht im ✕ -- auch „Von der Stage nehmen" und der Nachschlag
	// nach einem Lauf nehmen herunter. Faellt der Verbund dort, hat der spaetere ✕ nichts mehr aufzuloesen.
	// =============================================================================================
	const eins = fragmente(2);
	const schluesselEins = api.garetienVerbundSchluessel(eins[0]);
	api.avesmapsGaretienStageHinzufuegen(eins);
	api.garetienVerbundZusammenlegen(schluesselEins, eins);
	api.avesmapsGaretienStageEntfernen([eins[1].key]);
	gleich(api.garetienVerbundIstZusammen(schluesselEins), false,
		"„Von der Stage nehmen\" des vorletzten Fragments loest den Verbund schon in der Tuer auf");
	wahr(api.avesmapsGaretienStageHat(eins[0].key), "das letzte Mitglied bleibt auf der Stage");

	const ergebnisNull = api.garetienVerbundWegKlick(
		{ target: ziel({ "data-verbund-weg": eins[0].key }) }, eins);
	gleich(ergebnisNull.aufgeloest, false, "der ✕ danach hat nichts mehr aufzuloesen -- und meldet das ehrlich");
	gleich(api.avesmapsGaretienStageHat(eins[0].key), false, "das Fragment ist trotzdem herunter");
	zuruecksetzen();
```

**Stelle 5** — ersetze:

```js
	api.garetienVerbundZusammenlegen(schluesselG, [g1, g2]);
```

durch:

```js
	api.avesmapsGaretienStageHinzufuegen([g1, g2]);
	api.garetienVerbundZusammenlegen(schluesselG, [g1, g2]);
```

`js/review/__tests__/garetien-verbund-stage.test.js` (Abschnitt 2):

**Stelle 1** — ersetze:

```js
// ---- 2b. Zusammenlegen legt GENAU die Mitglieder auf die Stage, das fremde Objekt nicht ---------
const n = modul.garetienVerbundZusammenlegen(VERBUND, [o1, o2, fremd]);
gleich(n, 2, "zwei Mitglieder -- 'c' gehoert nicht zum Verbund");
gleich(modul.avesmapsGaretienStageHat("a"), true, "erstes Mitglied liegt jetzt auf der Stage");
gleich(modul.avesmapsGaretienStageHat("b"), true, "zweites Mitglied liegt jetzt auf der Stage");
gleich(modul.avesmapsGaretienStageHat("c"), false,
    "das fremde Objekt (kein Mitglied des Verbunds) bleibt draussen");
gleich(modul.garetienVerbundIstZusammen(VERBUND), true,
    "nach dem Zusammenlegen gilt der Verbund als zusammengelegt");
```

durch:

```js
// 🔴 AUFGABE 6 (14.09.2026): Zusammenlegen LEGT NICHT MEHR AUF -- es markiert die Eintraege, die
// schon auf der Stage liegen, und verlangt die Form Flaeche oder Weg. Die Fixtures tragen dafuer
// `ziel`; die ausfuehrliche Pruefung der neuen Regel steht in garetien-verbund-stage-eintrag.test.js.
const f1 = Object.assign({}, o1, { ziel: "region", subtyp: "wald" });
const f2 = Object.assign({}, o2, { ziel: "region", subtyp: "wald" });

// ---- 2b. Zusammenlegen markiert GENAU die Mitglieder auf der Stage, das fremde Objekt nicht -----
modul.avesmapsGaretienStageHinzufuegen([f1, f2]);
const n = modul.garetienVerbundZusammenlegen(VERBUND, [f1, f2, fremd]);
gleich(n, 2, "zwei Mitglieder auf der Stage -- 'c' gehoert nicht zum Verbund");
gleich(modul.avesmapsGaretienStageHat("c"), false,
    "das fremde Objekt (kein Mitglied des Verbunds) bleibt draussen");
gleich(modul.garetienVerbundIstZusammen(VERBUND), true,
    "nach dem Zusammenlegen gilt der Verbund als zusammengelegt");
modul.avesmapsGaretienStageLeeren();
modul.avesmapsGaretienStageHinzufuegen([f1]);
gleich(modul.garetienVerbundZusammenlegen(VERBUND, [f1, f2]), 0,
    "💣 liegt nur EIN Mitglied auf der Stage, wird nichts zusammengelegt -- und nichts aufgelegt");
gleich(modul.avesmapsGaretienStageHat("b"), false, "das zweite Mitglied bleibt, wo es war");
```

**Stelle 2** — ersetze:

```js
// ---- 2d. Aufloesen nimmt NUR die Merkung zurueck -- die Objekte bleiben auf der Stage ------------
modul.garetienVerbundZusammenlegen(VERBUND, [o1, o2, fremd]);
gleich(modul.garetienVerbundAufloesen(VERBUND), true,
    "Aufloesen eines wirklich zusammengelegten Verbunds meldet true");
```

durch:

```js
// ---- 2d. Aufloesen nimmt NUR die Entscheidung zurueck -- die Objekte bleiben auf der Stage -------
modul.avesmapsGaretienStageHinzufuegen([f1, f2]);
modul.garetienVerbundZusammenlegen(VERBUND, [f1, f2, fremd]);
gleich(modul.garetienVerbundAufloesen(VERBUND), undefined,
    "Aufloesen gibt seit Aufgabe 6 nichts mehr zurueck (void)");
```

**Stelle 3** — ersetze:

```js
// ---- 2e. Ein nie zusammengelegter Verbund meldet false beim Aufloesen ---------------------------
gleich(modul.garetienVerbundAufloesen("verbund:nie-zusammengelegt"), false,
    "Aufloesen eines Verbunds, der nie zusammengelegt wurde, meldet false");
```

durch:

```js
// ---- 2e. Ein nie zusammengelegter Verbund laesst sich gefahrlos aufloesen ------------------------
gleich(modul.garetienVerbundAufloesen("verbund:nie-zusammengelegt"), undefined,
    "Aufloesen eines Verbunds, der nie zusammengelegt wurde, wirft nicht");
```

**Stelle 4** — ersetze:

```js
modul.avesmapsGaretienStageLeeren();
modul.garetienVerbundZusammenlegen(VERBUND, [o1, o2]);
const zweiterVerbund = "verbund:Berge|Huegel|Silker Hain";
modul.garetienVerbundZusammenlegen(zweiterVerbund, [huegel]);
```

durch:

```js
modul.avesmapsGaretienStageLeeren();
const zweiterVerbund = "verbund:Berge|Huegel|Silker Hain";
const h1 = Object.assign({}, huegel, { ziel: "region", subtyp: "huegel" });
const h2 = Object.assign({}, h1, { key: "d2" });
modul.avesmapsGaretienStageHinzufuegen([f1, f2, h1, h2]);
modul.garetienVerbundZusammenlegen(VERBUND, []);
modul.garetienVerbundZusammenlegen(zweiterVerbund, []);
```

**Stelle 5** — ersetze:

```js
modul.avesmapsGaretienStageLeeren();
const leererSchluessel = Object.assign({}, o1, { key: "" });
const nLeer = modul.garetienVerbundZusammenlegen(VERBUND, [leererSchluessel, o2]);
gleich(nLeer, 2,
    "die Rueckgabe zaehlt MITGLIEDER (zwei), nicht Stage-Eintraege -- der Vertrag aus Aufgabe 4 "
    + "bleibt bestehen, auch wenn ein Mitglied die Stage nicht erreicht");
gleich(modul.avesmapsGaretienStageHat(""), false,
    "ein Mitglied mit leerem Schluessel landet NICHT auf der Stage -- dieselbe Wache wie in "
    + "avesmapsGaretienStageHinzufuegen");
gleich(modul.avesmapsGaretienStageHat("b"), true,
    "…das zweite, gueltige Mitglied liegt trotzdem auf der Stage");
```

durch:

```js
// 🔴 Aufgabe 6: die Rueckgabe zaehlt jetzt Stage-EINTRAEGE -- ein Mitglied mit leerem Schluessel
// erreicht die Stage nie (Wache in avesmapsGaretienStageHinzufuegen), also bleibt nur eins, und
// eins ist kein Verbund.
modul.avesmapsGaretienStageLeeren();
const leererSchluessel = Object.assign({}, f1, { key: "" });
modul.avesmapsGaretienStageHinzufuegen([leererSchluessel, f2]);
gleich(modul.avesmapsGaretienStageHat(""), false,
    "ein Mitglied mit leerem Schluessel landet NICHT auf der Stage");
gleich(modul.garetienVerbundZusammenlegen(VERBUND, [leererSchluessel, f2]), 0,
    "und mit dem einen gueltigen Mitglied allein ist nichts zusammenzulegen");
```

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

```bash
for t in garetien-verbund-stage-eintrag garetien-verbund-stage garetien-verbund-klick garetien-verbund-einstellungen garetien-verbund-fragment-weg garetien-verbund-rumpf garetien-verbund-detail garetien-anzeige-menge garetien-stage-nachschlagen garetien-menueband garetien-name-aendern garetien-einfuege-haken garetien-eingefuegt-wird garetien-label-vorschau garetien-label-vorschau-stempel garetien-label-vorschau-zeichnen; do node js/review/__tests__/$t.test.js 2>&1 | tail -1; done
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```
Erwartet: `garetien-verbund-stage-eintrag: 86 Pruefungen bestanden.`, `garetien-verbund-stage: 25 …`, `garetien-verbund-klick: 31 …`, `OK -- garetien-verbund-einstellungen`, `garetien-verbund-fragment-weg: 35 …`, `garetien-verbund-rumpf: 6 …`; Feldlauf ohne `ROT:`.

Mutationsproben (gesehen, alle gefangen): Stempel ohne hereingereichten Namen · Stempel ohne Anführer-Weiche (zwei Beschriftungen) · Anführer = größte Item-Nummer (Beschriftung am falschen Mittelpunkt) · Namenszweig ohne Nachziehen · `einfuegeName` fehlt in der Feldliste · Regel ignoriert den Namen · Namensvorgabe ohne Stamm („💣 zusammengelegt zeigt das Namensfeld den STAMM", actual `'Silker Hain 1'`) · Handname gewinnt nicht · Grundvorgabe der Kurve an UND Verbund-Regel entfernt („🔴 die Kurvenbeschreibung eines Verbunds startet aus") · `garetienUmkreisVergessen()` wieder in `garetienEinstellungenVergessen` · neuer Eintrag `zusammen: true` · `every` → `some` · „Stage leeren" ohne Vergessen · Zusammenlegen ohne Riegel · Vorbelegung aus dem Objekt statt aus dem größten · neuer Lauf ohne Vergessen · Entfernen ohne Auflösen unter zwei · Auflösen ohne Einstellungen · Wege immer frei. ⚠️ Ehrlich gesagt: „Kurvenregel entfernt" allein und „Grundvorgabe an" allein bleiben grün — heute ist die Grundvorgabe ohnehin aus; erst beide zusammen zeigen, dass die Regel trägt.

- [ ] **Schritt 5: Committen**

```bash
git add js/review/review-garetien-importer.js
git add js/review/review-garetien-label-vorschau.js
git add js/review/__tests__/garetien-verbund-stage-eintrag.test.js
git add js/review/__tests__/garetien-label-vorschau-zeichnen.test.js
git add js/review/__tests__/garetien-verbund-stage.test.js
git add js/review/__tests__/garetien-verbund-klick.test.js
git add js/review/__tests__/garetien-verbund-einstellungen.test.js
git add js/review/__tests__/garetien-verbund-fragment-weg.test.js
git add js/review/__tests__/garetien-verbund-rumpf.test.js
git commit -F- <<'EOF'
fix(garetien-importer): „zusammengelegt" lebt am Stage-Eintrag und stirbt mit ihm

Die Entscheidung lag in einem losen Set von Verbundschluesseln: sie ueberlebte
„Stage leeren" und neue Laeufe und verschmolz spaeter einzeln aufgelegte
Fragmente still (K1). Jetzt traegt jeder Stage-Eintrag `zusammen`; ein neu
aufgelegter traegt false, unter zwei Mitgliedern loest die Tuer auf, samt der
Einstellungen des Verbunds (Fehler 10).

Das Namensfeld eines zusammengelegten Verbunds zeigt den Stamm (die Vorgabe
reist nie als Handname), die Kartenvorschau EINE Beschriftung mit demselben
Namen am Anfuehrer, seine Kurvenbeschreibung startet aus.

Zusammenlegen legt nichts mehr auf und ist gesperrt, wenn der Verbund keine
Flaeche wird -- Wege erst mit AVESMAPS_GARETIEN_VERBUND_WEGE_FREI. Vorbelegt
wird aus dem groessten Fragment (Fehler 6). Stage leeren und ein neuer Lauf
vergessen die Einstellungen am Objekt; der Umkreis gehoert dem Fenster und
bleibt. Geht zusammen mit Aufgabe 7 live.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 7: Offen: ein Knopf auf die Stage; Verbund-Knopf nur in Block B; Zählung

**Deckt Entwurf §1 Widerspruch 8, §4, §6.3 (Knopf auf der Stage), §6.5 und §9 „Offen"/„Verbund" (Zusammenlegen nur auf der Stage, Zählung) ab.** Sichtbar — einzeln live (zusammen mit Aufgabe 6), mit Blick des Owners.

🔴 **„Auf die Stage" an einem Fragment nimmt die übrigen ERZEUGENDEN Fragmente mit** (Urteil `neu`, `widerspruch`, `zweifel`), einzeln — zusammengelegt wird nichts. Unterzeile und Klick lesen DIESELBE Liste (`garetienVerbundWeitereErzeugende`), sonst verspräche der Knopf etwas anderes, als er tut.

💣 **Kein `deckt_sich`-Fragment und kein Zusatz-Objekt kommt mit.** Das `deckt_sich` ist nach Owner 09.09./2 kein Mitglied (der Server lässt es seit Aufgabe 1 gar nicht erst Mitglied werden, der Client prüft trotzdem); ein Objekt, dessen einziger Weg das Zusatz-Item ist, braucht seine eigene Rückfrage (`garetienStageKlick`) und käme sonst still auf die Stage.

⚠️ **Die Unterzeile zählt, was DAZUKOMMT** — schon aufgelegte Mitglieder zählen nicht („mit 1 weiteren Fragment", Einzahl). Gesucht wird in der Liste des aktuellen Reiters; ein von einem Filter ausgeblendetes Fragment kommt nicht mit und wird nicht gezählt.

🔴 **Der Knopf `verbund` fällt aus `garetienHandlungen`** und steht in Block B (`garetienVerbundBlockMarkup`), sobald mindestens zwei Mitglieder auf der Stage liegen: „Zusammenlegen (n)" bzw. „Verbund auflösen (n)", Akzentrahmen (`btn btn--accent` in `.gi-acts__knoepfe`). Gesperrt mit Grundzeile `.gi-acts__grund` — ein `disabled`-Knopf zeigt seinen `title` in Chrome nie. „Verbund auflösen" ist nie gesperrt. `garetienHandlungsRumpf` schließt `verbund` weiter aus (der Knopf trägt weiter `data-handlung="verbund"`).

🔴 **Block B nimmt seine Mitglieder aus Liste UND Stage** (`garetienVerbundPool`): seit Aufgabe 5 kann die Stage-Liste gefiltert sein, und ohne die Stage verschwände der Block, sobald die Suche ein Fragment ausblendet. Der ✕ steht nur an Fragmenten auf der Stage (auf „Offen" ist Block B reine Anzeige, Entwurf §3); die dritte Rasterzelle bleibt dann ein leeres `<span>` — `.gi-seg` hat drei Spalten.

🔴 **Fußknopf und Rückfrage zählen, was ENTSTEHT** (`garetienStageZusammenfassung`): ein zusammengelegter Verbund ist EIN Objekt. Beschriftung „Stage importieren · 5 Objekte", „· 2 Objekte aus 5 Zeilen", „· 1 Objekt aus 4 Zeilen", „· nichts auf der Stage", „· nichts zu importieren". `anzahl` bleibt die Zahl der importierten Zeilen (Sperre `anzahl < 1` unverändert). Die Rückfrage nennt jeden Verbund beim Namen (Handname, sonst Stamm) und behält die Warnung vor Änderungen ohne Rückweg (Schadensfall 30.08.2026). ⚠️ Die Rückfrage stellt `garetienFussknopfEinfuegenKlick` (~:9196), nicht `garetienFussknopfKlick` — der bleibt unverändert.

⚠️ Nach „Auf die Stage" mit mitgenommenen Fragmenten meldet die Statuszeile „Auf die Stage: <Name> mit n weiteren Fragmenten." (Mockup §3) — NACH dem Neuzeichnen, sonst setzte `garetienStatusRuhe` sie sofort zurück.

⚠️ Block B trägt weiter die Überschrift `.gi-sec` — die Blöcke A–G baut Aufgabe 11; sie übernimmt Knopf-, ✕- und Pool-Logik aus diesem Bauer unverändert.

**Bestand:** Objekte eines alten Laufs haben keine Verbund-Felder: keine Unterzeile, kein Block B, jedes zählt als ein Objekt. Die statische Beschriftung des Fußknopfs in `index.html` wechselt von „Stage importieren (0)" auf „Stage importieren · nichts auf der Stage".

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienVerbundBlockMarkup` ~:1542 samt neu `garetienVerbundPool`, `AVESMAPS_GARETIEN_VERBUND_ERZEUGEND`, `garetienVerbundWeitereErzeugende`; `garetienStageKnopfBauen` ~:6901; `garetienHandlungen` Verbund-Knopf ~:6972–6995; `garetienStageKlick` ~:7549; neu `garetienStageZusammenfassung` und `garetienUebernahmeKnopfZustand` ~:8612; `garetienEinfuegenRueckfrageText` ~:9175; `garetienFussknopfEinfuegenKlick` ~:9196; Verdrahtung des Detail-Klicks ~:9399; Export ~:9917)
- Ändern: `index.html` (`#garetien-apply` ~:4301)
- Test: `js/review/__tests__/garetien-verbund-block-zaehlung.test.js` (neu)
- Fremd: `garetien-verbund-klick.test.js` (ganz ersetzt), `garetien-verbund-detail.test.js` (ganz ersetzt), `garetien-verbund-zeile-nicht-klickbar.test.js`, `garetien-fussknopf-dom.test.js`, `garetien-uebernahme-blatt.test.js`, `garetien-zusatz-auf-die-stage.test.js`, `garetien-anzeige-menge.test.js`, `garetien-vokabular.test.js`

**Schnittstellen:**
- Nutzt: `garetienVerbundSchluessel`, `garetienVerbundMitglieder`, `garetienVerbundIstZusammen`, `garetienVerbundZusammenlegbar(objekt): {ok, grund}` (Aufgabe 6), `garetienStageVorhaben(objekt)`, `garetienStageItems(objekt)`, `garetienNameWahlZu(objekt)`, `garetienAnzahlText(anzahl, einzahl, mehrzahl)`, `garetienStatusSetzen(text, ton, aktion)`
- Liefert: `garetienStageKnopfBauen(objekt).zeile2` = „mit n weiteren Fragment(en)" oder `""` · `garetienStageKlick(…)` meldet `{handlung: "stage", objekt, groesse, weitere: number}` · `garetienVerbundBlockMarkup(objekt, objekte): string` (exportiert) · `garetienStageZusammenfassung(stageObjekte: Array): {objekte: number, zeilen: number, verbuende: Array<{name: string, teile: number}>}` · `garetienUebernahmeKnopfZustand(stageObjekte)` zusätzlich `.zusammenfassung` · `garetienEinfuegenRueckfrageText(zusammenfassung): string`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/review/__tests__/garetien-verbund-block-zaehlung.test.js`:

```js
// Aufgabe 7 (Garetien-Importer vereint, 14.09.2026): „Auf die Stage“ nimmt die Fragmente mit, der
// Verbund-Knopf steht nur in Block B, und Fussknopf und Rueckfrage zaehlen, was ENTSTEHT.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §1 Widerspruch 8, §4, §6.3, §6.5
// Mockup:  docs/garetien-import-vereint-mockup.html Szenen 2, 3, 4
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-block-zaehlung.test.js
//
// 🔴 Gemessen am ECHTEN Modul und seinem Markup -- `zustand.objekte` entsteht ueber die echte Tuer
// (avesmapsGaretienListeHolen mit gefaelschtem `fetch`), wie in garetien-verbund-klick.test.js.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter(["garetien-apply", "garetien-apply-hint"]);

function fragment(nr, extra) {
	return Object.assign({
		key: "ggp:silkerhain:" + nr, name: "Silker Hain " + nr, ebene: "Waelder", typ: "Wald",
		urteil: "neu", stand: "offen", ziel: "region", subtyp: "wald", kind: "vegetation",
		verbund_stamm: "Silker Hain", verbund_n: 4,
		geometrie: Array.from({ length: 5 + nr }, (_, i) => [i, i]),
		items: [{ id: 100 + nr, change_type: "new" }],
	}, extra || {});
}
// BESTAND: ein Objekt aus einem Lauf von vor der Verbund-Erkennung -- ohne verbund_stamm/verbund_n.
const heide = { key: "ggp:silkerheide", name: "Silker Heide", ebene: "Waelder", typ: "Heide", urteil: "neu",
	stand: "offen", ziel: "region", subtyp: "heide", items: [{ id: 200, change_type: "new" }] };

async function mitObjekten(objekte) {
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7, reiter: {} }) });
	};
	api.garetienReiterSetzen("offen");
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
}
function stageKlick(objekt, objekte) {
	const knopf = { disabled: false, getAttribute: (n) => ({ "data-handlung": "stage", "data-key": objekt.key })[n] || null };
	return api.garetienStageKlick({ target: { closest: () => knopf } }, objekte, function () { return true; });
}
function zuruecksetzen() {
	api.avesmapsGaretienStageLeeren();
	api.__test.garetienVerbundWegeFreiSetzen(false);
}

["garetienStageZusammenfassung", "garetienVerbundBlockMarkup"].forEach((n) =>
	wahr(typeof api[n] === "function", n + " fehlt im Export"));

(async function () {
	// =============================================================================================
	// A. „Auf die Stage“ an einem Fragment: EIN Knopf, die Unterzeile sagt, wie viele mitkommen.
	// =============================================================================================
	const [f1, f2, f3, f4] = [fragment(1), fragment(2, { urteil: "widerspruch" }), fragment(3, { urteil: "zweifel" }), fragment(4)];
	// 💣 Ein deckt_sich-Fragment gleichen Stammes ist KEIN Mitglied (Owner 09.09./2) -- der Server
	// schickt es seit Aufgabe 1 nicht mehr als Mitglied; der Client prueft es trotzdem.
	const deckt = fragment(5, { urteil: "deckt_sich" });
	const alle = [f1, f2, f3, f4, deckt, heide];
	// ⚠️ Block B zeigt, was der SERVER als Mitglied schickt -- seit Aufgabe 1 nie ein deckt_sich-Fragment.
	const ohneDeckt = [f1, f2, f3, f4, heide];
	zuruecksetzen();
	await mitObjekten(alle);

	gleich(api.garetienStageKnopfBauen(f1).zeile2, "mit 3 weiteren Fragmenten",
		"vier erzeugende Fragmente: das angeklickte und drei weitere -- das deckt_sich-Fragment zaehlt nicht");
	gleich(api.garetienStageKnopfBauen(heide).zeile2, "", "BESTAND: ein Objekt ohne Verbund-Felder hat keine Unterzeile");
	wahr(api.garetienHandlungen(f1).every((k) => k.name !== "verbund"),
		"🔴 der Knopf „verbund“ steht nicht mehr in der Handlungsleiste: " + api.garetienHandlungen(f1).map((k) => k.name).join(","));

	const ergebnis = stageKlick(f1, alle);
	gleich(ergebnis.handlung, "stage", "der Klick legt auf");
	gleich(ergebnis.weitere, 3, "und meldet die drei mitgenommenen Fragmente");
	gleich([f1, f2, f3, f4].every((f) => api.avesmapsGaretienStageHat(f.key)), true, "alle vier liegen auf der Stage");
	gleich(api.avesmapsGaretienStageHat(deckt.key), false, "💣 das deckt_sich-Fragment wird nicht mit aufgelegt");
	gleich(api.garetienVerbundIstZusammen(api.garetienVerbundSchluessel(f1)), false,
		"🔴 zusammengelegt wird dabei NICHTS (Owner 09.09./1, 12.09./5)");
	gleich(api.garetienStageKnopfBauen(f2).zeile2, "", "auf der Stage traegt der Knopf („Von der Stage nehmen“) keine Unterzeile");

	// Schon aufgelegte Mitglieder zaehlen nicht als „weitere“ -- die Unterzeile sagt, was DAZUKOMMT.
	api.avesmapsGaretienStageEntfernen([f1.key, f2.key]);
	gleich(api.garetienStageKnopfBauen(f1).zeile2, "mit 1 weiteren Fragment",
		"f3 und f4 liegen schon da, nur f2 kaeme dazu -- und die Einzahl stimmt");

	// =============================================================================================
	// B. Block B: der Knopf erscheint erst mit ZWEI Fragmenten auf der Stage.
	// =============================================================================================
	zuruecksetzen();
	gleich(api.garetienVerbundBlockMarkup(f1, ohneDeckt).indexOf('data-handlung="verbund"'), -1,
		"auf „Offen“ ohne Fragment auf der Stage: kein Knopf");
	gleich(api.garetienVerbundBlockMarkup(f1, ohneDeckt).indexOf("gi-seg__weg"), -1,
		"und kein ✕ -- es gibt nichts von der Stage zu nehmen (Block B ist dort nur Anzeige)");
	gleich(api.garetienVerbundBlockMarkup(heide, ohneDeckt), "", "BESTAND: ohne Verbund-Felder kein Block");

	api.avesmapsGaretienStageHinzufuegen([f1]);
	const einer = api.garetienVerbundBlockMarkup(f1, ohneDeckt);
	gleich(einer.indexOf('data-handlung="verbund"'), -1, "ein Fragment auf der Stage: noch kein Knopf");
	gleich((einer.match(/data-verbund-weg="/g) || []).length, 1, "aber sein ✕");

	api.avesmapsGaretienStageHinzufuegen([f2]);
	const zwei = api.garetienVerbundBlockMarkup(f1, ohneDeckt);
	wahr(/<button class="btn btn--accent" type="button" data-handlung="verbund" data-key="ggp:silkerhain:1">Zusammenlegen \(2\)<\/button>/.test(zwei),
		"zwei Fragmente auf der Stage: „Zusammenlegen (2)“, Akzentrahmen, bedienbar: " + zwei);
	wahr(api.garetienDetailMarkup(f1, null, false).indexOf('data-handlung="verbund"') !== -1,
		"und der Knopf steht in der echten Detailspalte");

	api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(f1), []);
	const zusammen = api.garetienVerbundBlockMarkup(f1, ohneDeckt);
	wahr(zusammen.indexOf(">Verbund auflösen (2)</button>") !== -1, "zusammengelegt: „Verbund auflösen (2)“");
	wahr(zusammen.indexOf("zusammengelegt · 4 Fragmente") !== -1, "und die Notiz sagt es");

	// Gesperrt MIT Grundzeile: ein Weg, solange Wege-Verbuende nicht freigegeben sind.
	zuruecksetzen();
	const [w1, w2] = [1, 2].map((nr) => fragment(nr, { key: "ggp:weg:" + nr, ebene: "Wege", typ: "Pfad", ziel: "path", subtyp: "Pfad" }));
	api.avesmapsGaretienStageHinzufuegen([w1, w2]);
	const weg = api.garetienVerbundBlockMarkup(w1, [w1, w2]);
	wahr(/data-handlung="verbund"[^>]*disabled/.test(weg), "ein Weg: der Knopf ist gesperrt");
	wahr(weg.indexOf('<p class="gi-acts__grund"><span>Wege-Verbünde sind noch nicht freigegeben.</span></p>') !== -1,
		"und der Grund steht SICHTBAR darunter, nicht nur im title: " + weg);

	// =============================================================================================
	// C. Die Zaehlung: ein zusammengelegter Verbund ist EIN Objekt.
	// =============================================================================================
	zuruecksetzen();
	const ohneVorschlag = { key: "ggp:leer", name: "Leer", items: [] };
	gleich(JSON.stringify(api.garetienStageZusammenfassung([f1, f2, f3, f4, heide])),
		JSON.stringify({ objekte: 5, zeilen: 5, verbuende: [] }),
		"nicht zusammengelegt: fuenf Objekte -- ehrlich, wer jetzt importiert, bekommt vier Waelder");
	api.avesmapsGaretienStageHinzufuegen([f1, f2, f3, f4, heide, ohneVorschlag]);
	api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(f1), []);
	gleich(JSON.stringify(api.garetienStageZusammenfassung(api.avesmapsGaretienStageListe())),
		JSON.stringify({ objekte: 2, zeilen: 5, verbuende: [{ name: "Silker Hain", teile: 4 }] }),
		"zusammengelegt: 2 Objekte aus 5 Zeilen -- das Objekt ohne Vorschlag zaehlt nirgends");
	api.garetienNameWahlSetzen(f1, "Silker Forst");
	gleich(api.garetienStageZusammenfassung(api.avesmapsGaretienStageListe()).verbuende[0].name, "Silker Forst",
		"der Verbund heisst, wie er importiert wird -- mit Handnamen");

	const knopf = api.garetienUebernahmeKnopfZustand(api.avesmapsGaretienStageListe());
	gleich(knopf.beschriftung, "Stage importieren · 2 Objekte aus 5 Zeilen", "der Fussknopf zaehlt, was entsteht");
	gleich(knopf.anzahl, 5, "`anzahl` bleibt die Zahl der importierten Zeilen");
	gleich(api.garetienUebernahmeKnopfZustand([f1, f2, f3, f4]).beschriftung, "Stage importieren · 1 Objekt aus 4 Zeilen",
		"ein Verbund allein: 1 Objekt aus 4 Zeilen");
	gleich(api.garetienUebernahmeKnopfZustand([heide]).beschriftung, "Stage importieren · 1 Objekt", "ohne Verbund keine Zeilenangabe");
	gleich(api.garetienUebernahmeKnopfZustand([]).beschriftung, "Stage importieren · nichts auf der Stage", "leer");
	gleich(api.garetienUebernahmeKnopfZustand([ohneVorschlag]).beschriftung, "Stage importieren · nichts zu importieren",
		"auf der Stage, aber nichts, was entstuende");

	// =============================================================================================
	// D. Die Rueckfrage nennt den Verbund beim Namen -- und die Warnung bleibt.
	// =============================================================================================
	const text = api.garetienEinfuegenRueckfrageText(api.garetienStageZusammenfassung(api.avesmapsGaretienStageListe()));
	wahr(text.indexOf("Wirklich 2 Objekte aus 5 Zeilen von der Stage in die Karte einfügen?") === 0, "der Hauptsatz zaehlt Objekte: " + text);
	wahr(text.indexOf("Zusammengelegt: „Silker Forst“ mit 4 Teilen.") !== -1, "und nennt den Verbund beim Namen: " + text);
	wahr(text.indexOf("Für Änderungen an bestehenden Objekten (Name, Quelle, Geometrie) gibt es keinen Rückweg.") !== -1,
		"🔴 die Warnung vor der unumkehrbaren Handlung bleibt (Schadensfall 30.08.2026)");
	gleich(api.garetienEinfuegenRueckfrageText({ objekte: 1, zeilen: 1, verbuende: [] }).indexOf("Zusammengelegt"), -1,
		"ohne Verbund kein Verbund-Satz");

	// Der Fussknopf fragt mit GENAU dieser Zusammenfassung.
	let gefragt = "";
	await api.garetienFussknopfEinfuegenKlick(7, function (satz) { gefragt = satz; return false; });
	gleich(gefragt, text, "der Fussknopf reicht die Zusammenfassung der Stage an die Rueckfrage");

	zuruecksetzen();
	console.log(`garetien-verbund-block-zaehlung: ${checks} Pruefungen bestanden.`);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-verbund-block-zaehlung.test.js
```
Erwartet (gesehen): `AssertionError [ERR_ASSERTION]: garetienStageZusammenfassung fehlt im Export`

- [ ] **Schritt 3: Umsetzen**

In `js/review/review-garetien-importer.js`:

**Stelle 1** — ersetze:

```js
	function garetienVerbundBlockMarkup(objekt, objekte) {
		const schluessel = garetienVerbundSchluessel(objekt);
		if (schluessel === "") { return ""; }
		const mitglieder = garetienVerbundMitglieder(schluessel, objekte || []);
		if (mitglieder.length < 2) { return ""; }
		const zeilen = mitglieder.map(function (m) {
			return '<div class="gi-seg gi-seg--verbund"><span></span>'
				+ '<span class="gi-seg__name">' + avesmapsGaretienEscape(m.name || "")
				+ '<span class="gi-seg__zahl">' + ((m.geometrie || []).length) + " Punkte</span></span>"
				+ '<button class="btn gi-seg__weg" type="button" data-verbund-weg="'
				+ avesmapsGaretienEscape(m.key || "") + '" title="Aus dem Verbund nehmen">✕</button>'
				+ "</div>";
		}).join("");

		return '<p class="gi-sec">Verbund<span class="gi-sec__note">'
			+ mitglieder.length + " Fragmente</span></p>" + zeilen;
	}
```

durch:

```js
	/*
	 * Aufgabe 7 (Entwurf 2026-09-14 §6.3): der KNOPF DES VERBUNDS STEHT HIER, in Block B -- und nur,
	 * wenn mindestens zwei Fragmente auf der Stage liegen. Bis dahin stand „Verbund auf die Stage (n)"
	 * in der Handlungsleiste auf „Offen" und legte in EINEM Klick auf UND verschmolz (Widerspruch 8).
	 *
	 * 🔴 DIE MITGLIEDER KOMMEN AUS DER LISTE UND DER STAGE (garetienVerbundPool): seit Aufgabe 5 kann die
	 * Liste auf der Stage gefiltert sein -- ohne die Stage verschwaende der Block, sobald die Suche ein
	 * Fragment ausblendet, obwohl es auf der Stage liegt.
	 * 🔴 DER ✕ NUR AN EINEM FRAGMENT AUF DER STAGE. Er nimmt von der Stage; an einem Fragment, das dort
	 * nicht liegt, taete er nichts, und auf „Offen" ist Block B reine Anzeige (Entwurf §3). Die dritte
	 * Rasterzelle bleibt dann ein leeres `<span>` -- `.gi-seg` hat drei Spalten, und eine fehlende
	 * Zelle zoege den naechsten Knoten hinein.
	 * ⚠️ GESPERRT MIT GRUNDZEILE, nie nur mit `title`: ein `disabled`-Knopf bekommt in Chrome keine
	 * Zeigerereignisse und zeigt seinen `title` nie (dieselbe Regel wie am Fussknopf).
	 * ⚠️ „Verbund auflösen" ist nie gesperrt -- aufloesen geht immer, die Pruefung gilt dem Zusammenlegen.
	 */
	function garetienVerbundBlockMarkup(objekt, objekte) {
		const schluessel = garetienVerbundSchluessel(objekt);
		if (schluessel === "") { return ""; }
		const mitglieder = garetienVerbundMitglieder(schluessel, garetienVerbundPool(objekte));
		if (mitglieder.length < 2) { return ""; }
		const zeilen = mitglieder.map(function (m) {
			const liegt = avesmapsGaretienStageHat(m.key);
			return '<div class="gi-seg gi-seg--verbund"><span></span>'
				+ '<span class="gi-seg__name">' + avesmapsGaretienEscape(m.name || "")
				+ '<span class="gi-seg__zahl">' + ((m.geometrie || []).length) + " Punkte</span></span>"
				+ (liegt
					? '<button class="btn gi-seg__weg" type="button" data-verbund-weg="'
						+ avesmapsGaretienEscape(m.key || "") + '" title="Von der Stage nehmen">✕</button>'
					: "<span></span>")
				+ "</div>";
		}).join("");

		const aufDerStage = mitglieder.filter(function (m) { return avesmapsGaretienStageHat(m.key); }).length;
		const zusammen = garetienVerbundIstZusammen(schluessel);
		let knopf = "";
		if (aufDerStage >= 2) {
			const pruefung = zusammen ? { ok: true, grund: "" } : garetienVerbundZusammenlegbar(objekt);
			const beschriftung = (zusammen ? "Verbund auflösen (" : "Zusammenlegen (") + aufDerStage + ")";
			knopf = '<div class="gi-acts__knoepfe"><button class="btn btn--accent" type="button"'
				+ ' data-handlung="verbund" data-key="' + avesmapsGaretienEscape((objekt && objekt.key) || "") + '"'
				+ (pruefung.ok ? "" : ' disabled title="' + avesmapsGaretienEscape(pruefung.grund) + '"')
				+ ">" + avesmapsGaretienEscape(beschriftung) + "</button></div>"
				+ (pruefung.ok ? "" : '<p class="gi-acts__grund"><span>' + avesmapsGaretienEscape(pruefung.grund)
					+ "</span></p>");
		}

		return '<p class="gi-sec">Verbund<span class="gi-sec__note">'
			+ (zusammen ? "zusammengelegt · " : "") + mitglieder.length + " Fragmente</span></p>" + zeilen + knopf;
	}

	/*
	 * REIN genug: die Objekte, in denen ein Verbund seine Mitglieder sucht -- die Liste, dann die Stage,
	 * je Schluessel einmal. Die Liste zuerst: sie traegt die Fassung des aktuellen Reiters.
	 */
	function garetienVerbundPool(objekte) {
		const gesehen = new Set();
		return (objekte || []).concat(avesmapsGaretienStageListe()).filter(function (o) {
			if (!o) { return false; }
			const schluessel = String(o.key);
			if (gesehen.has(schluessel)) { return false; }
			gesehen.add(schluessel);
			return true;
		});
	}

	/*
	 * Die Fragmente, die „Auf die Stage" an diesem Objekt MITNIMMT (Aufgabe 7, Entwurf §4).
	 *
	 * 🔴 NUR ERZEUGENDE (Urteil neu, widerspruch, zweifel): ein `deckt_sich`-Fragment desselben Namens
	 * ist KEIN Mitglied (Owner 09.09./2). Der Server laesst es seit Aufgabe 1 gar nicht erst Mitglied
	 * werden; der Client prueft es trotzdem, weil ein Lauf von vor diesem Umbau alles enthalten kann.
	 * 💣 KEIN ZUSATZ-OBJEKT: eines, dessen einziger Weg nach vorn das Zusatz-Item ist, kommt nur nach
	 * seiner EIGENEN Rueckfrage auf die Stage (garetienStageKlick) -- mitgenommen waere es still.
	 * ⚠️ Was schon auf der Stage liegt, zaehlt nicht: die Unterzeile sagt, was DAZUKOMMT.
	 * ⚠️ Gesucht wird in der hereingereichten Liste (dem aktuellen Reiter) -- ein Fragment, das ein Filter
	 * ausblendet, kommt nicht mit, und die Unterzeile zaehlt es deshalb auch nicht.
	 */
	const AVESMAPS_GARETIEN_VERBUND_ERZEUGEND = ["neu", "widerspruch", "zweifel"];

	function garetienVerbundWeitereErzeugende(objekt, objekte) {
		const schluessel = garetienVerbundSchluessel(objekt);
		if (schluessel === "") { return []; }
		const eigen = String((objekt && objekt.key) || "");
		return garetienVerbundMitglieder(schluessel, objekte).filter(function (m) {
			return String(m.key) !== eigen
				&& !avesmapsGaretienStageHat(m.key)
				&& AVESMAPS_GARETIEN_VERBUND_ERZEUGEND.indexOf(String(m.urteil || "")) !== -1
				&& garetienStageVorhaben(m) !== "zusatz";
		});
	}
```

**Stelle 2** — ersetze:

```js
		const name = aufDerStage ? "entstagen" : "stage";
		return {
			name: name,
			beschriftung: aufDerStage ? "Von der Stage nehmen" : "Auf die Stage",
			// 🔴 KEINE UNTERZEILE MEHR (Owner 09.09.2026): „auf der stage ist auf der stage, erst
			// dann entscheide ich ob es nur die quelle ergänzt“. Sie behauptete, was der Import tun
			// wird -- das sagen jetzt die zwei Häkchen darüber, und die SIND der Schreibumfang
			// (garetienStageItems liest dasselbe garetienEinfuegeWahl).
			zeile2: "",
```

durch:

```js
		const name = aufDerStage ? "entstagen" : "stage";
		// 🔴 Aufgabe 7 (Entwurf §4): „Auf die Stage" an einem Fragment nimmt die uebrigen erzeugenden
		// Fragmente seines Verbunds mit -- EINZELN, zusammengelegt wird dabei nichts.
		const weitere = aufDerStage ? 0 : garetienVerbundWeitereErzeugende(o, zustand.objekte || []).length;
		return {
			name: name,
			beschriftung: aufDerStage ? "Von der Stage nehmen" : "Auf die Stage",
			// 🔴 KEINE UNTERZEILE, AUSSER EIN VERBUND KOMMT MIT (Owner 09.09.2026: „auf der stage ist auf
			// der stage, erst dann entscheide ich ob es nur die quelle ergänzt“). Was der IMPORT tut, sagt
			// die Einstellung auf der Stage; was dieser KLICK tut, sagt die Zeile (Mockup §2).
			zeile2: weitere === 0 ? ""
				: "mit " + weitere + (weitere === 1 ? " weiteren Fragment" : " weiteren Fragmenten"),
```

**Stelle 3** — ersetze:

```js
		avesmapsGaretienStageHinzufuegen([objekt]);
		return { handlung: "stage", objekt: objekt, groesse: zustand.stage.size };
	}
```

durch:

```js
		// 🔴 Aufgabe 7: die uebrigen erzeugenden Fragmente kommen mit -- DIESELBE Liste wie die
		// Unterzeile des Knopfs (garetienStageKnopfBauen), sonst verspraeche er etwas anderes als er tut.
		const weitere = garetienVerbundWeitereErzeugende(objekt, objekte);
		avesmapsGaretienStageHinzufuegen([objekt].concat(weitere));
		return { handlung: "stage", objekt: objekt, groesse: zustand.stage.size, weitere: weitere.length };
	}
```

**Stelle 4** — ersetze:

```js
		// Aufgabe 8: der EINE Knopf, den der Verbund der Oberflaeche hinzufuegt.
		// 🔴 Ton `accent`, nicht gefuellt: die eine gefuellte Handlung dieses Fensters ist
		// „Stage importieren" (AGENTS.md §12), und gefuellt-gruen waere von `.btn--done`
		// („alles vorgemerkt") nicht zu unterscheiden.
		// 🔴 `ids` bleibt leer und der Knopf hat KEINEN Rumpf (garetienHandlungsRumpf schliesst
		// „verbund" aus, wie „stage"/„entstagen" -- er geht durch die EIGENE Tuer
		// garetienVerbundKlick, nie durch die geteilte Uebernahme-Vorschau).
		const verbundSchluessel = garetienVerbundSchluessel(o);
		if (verbundSchluessel !== "") {
			const n = garetienVerbundMitglieder(verbundSchluessel, zustand.objekte || []).length;
			const zusammen = garetienVerbundIstZusammen(verbundSchluessel);
			knoepfe.push({
				name: "verbund",
				beschriftung: (zusammen ? "Verbund auflösen (" : "Verbund auf die Stage (") + n + ")",
				zeile2: "",
				ton: "accent",
				ids: [],
				angehakt: 0,
				gesamt: 0,
				erledigt: false,
				disabled: n < 2,
				grund: n < 2 ? "Von diesem Verbund liegt nur ein Fragment in der Liste." : "",
			});
		}
		return knoepfe;
```

durch:

```js
		// 🔴 Aufgabe 7 (14.09.2026): HIER STAND DER KNOPF „Verbund auf die Stage (n)" -- er legte auf
		// „Offen" in EINEM Klick auf UND verschmolz (Widerspruch 8). Er steht jetzt in Block B
		// (garetienVerbundBlockMarkup) und nur auf der Stage; „Auf die Stage" nimmt die Fragmente mit.
		return knoepfe;
```

**Stelle 5** — ersetze:

```js
	function garetienUebernahmeKnopfZustand(stageObjekte) {
		const liste = stageObjekte || [];
		const mitVorschlag = liste.filter(function (o) {
			return o && garetienStageItems(o).length > 0;
		}).length;
		return {
			anzahl: mitVorschlag,
			gesamt: liste.length,
			beschriftung: "Stage importieren (" + mitVorschlag + " von " + liste.length + ")",
```

durch:

```js
	/*
	 * REIN: was „Stage importieren" entstehen laesst (Aufgabe 7, Entwurf §6.5).
	 *
	 * 🔴 EIN ZUSAMMENGELEGTER VERBUND IST EIN OBJEKT -- „1 Objekt aus 4 Zeilen", nie „4 Objekte".
	 * `zeilen` zaehlt die Stage-Objekte, die ueberhaupt etwas importieren (dieselbe Filterung wie der
	 * Schreibumfang, garetienStageItems); ein Objekt ohne Vorschlag zaehlt nirgends.
	 * ⚠️ Der Name eines Verbunds ist der, unter dem er importiert wird: die Handeingabe am
	 * Verbundschluessel, sonst der Stamm (Aufgabe 2: Name = Stamm).
	 */
	function garetienStageZusammenfassung(stageObjekte) {
		const liste = (stageObjekte || []).filter(function (o) {
			return o && garetienStageItems(o).length > 0;
		});
		const verbuende = {};
		const reihenfolge = [];
		let objekte = 0;
		liste.forEach(function (o) {
			const schluessel = garetienVerbundSchluessel(o);
			if (schluessel !== "" && garetienVerbundIstZusammen(schluessel)) {
				if (!verbuende[schluessel]) {
					verbuende[schluessel] = { name: garetienNameWahlZu(o) || String(o.verbund_stamm || ""), teile: 0 };
					reihenfolge.push(schluessel);
					objekte++;
				}
				verbuende[schluessel].teile++;
				return;
			}
			objekte++;
		});
		return {
			objekte: objekte,
			zeilen: liste.length,
			verbuende: reihenfolge.map(function (schluessel) { return verbuende[schluessel]; }),
		};
	}

	function garetienUebernahmeKnopfZustand(stageObjekte) {
		const liste = stageObjekte || [];
		const zusammenfassung = garetienStageZusammenfassung(liste);
		const mitVorschlag = zusammenfassung.zeilen;
		// 🔴 Aufgabe 7 (Entwurf §6.5): der Knopf zaehlt, was ENTSTEHT. Hier stand bis zum 14.09.2026
		// „(n von m)" -- bei einem zusammengelegten Verbund versprach das vier Objekte fuer eines.
		let folge;
		if (liste.length === 0) {
			folge = "nichts auf der Stage";
		} else if (zusammenfassung.objekte === 0) {
			folge = "nichts zu importieren";
		} else {
			folge = garetienAnzahlText(zusammenfassung.objekte, "Objekt", "Objekte")
				+ (zusammenfassung.zeilen > zusammenfassung.objekte ? " aus " + zusammenfassung.zeilen + " Zeilen" : "");
		}
		return {
			anzahl: mitVorschlag,
			gesamt: liste.length,
			zusammenfassung: zusammenfassung,
			beschriftung: "Stage importieren · " + folge,
```

**Stelle 6** — ersetze:

```js
	function garetienEinfuegenRueckfrageText(anzahl) {
		return "Wirklich " + anzahl + (anzahl === 1 ? " Objekt" : " Objekte")
			+ " von der Stage in die Karte einfügen?\n\n"
			+ "Neu angelegte Objekte lassen sich über „Zurücknehmen“ wieder entfernen. Für "
			+ "Änderungen an bestehenden Objekten (Name, Quelle, Geometrie) gibt es keinen Rückweg.";
	}
```

durch:

```js
	// 🔴 Aufgabe 7 (Entwurf §6.5): sie nimmt die ZUSAMMENFASSUNG (garetienStageZusammenfassung), nicht
	// mehr eine Zahl, und nennt jeden zusammengelegten Verbund beim Namen -- „1 Fläche mit 4 Teilen",
	// nie „4 Objekte".
	function garetienEinfuegenRueckfrageText(zusammenfassung) {
		const z = zusammenfassung || {};
		const objekte = Number(z.objekte) || 0;
		const zeilen = Number(z.zeilen) || 0;
		const verbuende = Array.isArray(z.verbuende) ? z.verbuende : [];
		let text = "Wirklich " + garetienAnzahlText(objekte, "Objekt", "Objekte")
			+ (zeilen > objekte ? " aus " + zeilen + " Zeilen" : "")
			+ " von der Stage in die Karte einfügen?";
		if (verbuende.length > 0) {
			text += "\n\nZusammengelegt: " + verbuende.map(function (v) {
				return "„" + String(v.name || "") + "“ mit "
					+ garetienAnzahlText(Number(v.teile) || 0, "Teil", "Teilen");
			}).join(", ") + ".";
		}
		return text + "\n\nNeu angelegte Objekte lassen sich über „Zurücknehmen“ wieder entfernen. Für "
			+ "Änderungen an bestehenden Objekten (Name, Quelle, Geometrie) gibt es keinen Rückweg.";
	}
```

**Stelle 7** — ersetze:

```js
		if (typeof fragen === "function" && !fragen(garetienEinfuegenRueckfrageText(stand.anzahl))) {
```

durch:

```js
		if (typeof fragen === "function" && !fragen(garetienEinfuegenRueckfrageText(stand.zusammenfassung))) {
```

**Stelle 8** — ersetze:

```js
				if (garetienStageKlick(ereignis, zustand.objekte, garetienFragen)) {
					garetienStageNeuZeichnen();
					garetienDetailRendern(zustand.objekte);
					return;
				}
				// Aufgabe 8: „Verbund auf die Stage“/„Verbund auflösen“ -- derselbe Zug wie der
```

durch:

```js
				const stageErgebnis = garetienStageKlick(ereignis, zustand.objekte, garetienFragen);
				if (stageErgebnis) {
					const mitgenommen = Number(stageErgebnis.weitere || 0);
					// 💣 Die Meldung steht NACH dem Neuzeichnen -- avesmapsGaretienListeRendern ruft
					// garetienStatusRuhe und setzte sie sonst sofort zurueck (Aufgabe 7, Mockup §3).
					Promise.resolve(garetienStageNeuZeichnen()).then(function () {
						if (mitgenommen > 0 && stageErgebnis.objekt) {
							garetienStatusSetzen("Auf die Stage: " + String(stageErgebnis.objekt.name || "")
								+ " mit " + mitgenommen + (mitgenommen === 1 ? " weiteren Fragment." : " weiteren Fragmenten."),
							"ok", null);
						}
					});
					garetienDetailRendern(zustand.objekte);
					return;
				}
				// Aufgabe 7: „Zusammenlegen“/„Verbund auflösen“ in Block B -- derselbe Zug wie der
```

**Stelle 9** — ersetze:

```js
			garetienEinfuegenRueckfrageText,
```

durch:

```js
			garetienEinfuegenRueckfrageText,
			// Aufgabe 7 (2026-09-14): was entsteht -- und Block B mit dem Verbund-Knopf
			garetienStageZusammenfassung,
			garetienVerbundBlockMarkup,
```

In `index.html`:

**Stelle 1** — ersetze:

```html
id="garetien-apply" disabled>Stage importieren (0)</button>
```

durch:

```html
id="garetien-apply" disabled>Stage importieren · nichts auf der Stage</button>
```

Die fremden Tests nageln die alte Beschriftung „(n von m)", den Knopf in der Handlungsleiste und den `vm`-Schnitt des Blocks fest. Nach der Umsetzung fallen sie so (gesehen): `garetien-fussknopf-dom` „💣 der Knopf traegt „n von m" …" (actual `'Stage importieren · 1 Objekt'`), `garetien-uebernahme-blatt` „der Knopf traegt „n von m" -- zwei der drei Angezeigten haben ein Item", `garetien-zusatz-auf-die-stage` „Expected values to be strictly equal" (actual `'Stage importieren · 1 Objekt'`), `garetien-anzeige-menge` „1 von 3 -- nur `mitVorschlag` traegt ein Item", `garetien-vokabular` „der Fuss traegt genau die vier Knoepfe der GANZEN STAGE, in dieser Reihenfolge", `garetien-verbund-klick` „der Verbund-Knopf steht in der Leiste", `garetien-verbund-detail` und `garetien-verbund-zeile-nicht-klickbar` `ReferenceError: garetienVerbundPool is not defined`. Neue Zusicherungen:

`js/review/__tests__/garetien-fussknopf-dom.test.js`:

**Stelle 1** — ersetze:

```js
gleich(KNOPF.textContent, "Stage importieren (1 von 3)",
	"💣 der Knopf traegt „n von m\" -- nicht mehr nur EINE Zahl -- nur `mitVorschlagOffen` traegt "
	+ "ein Item, die zwei anderen sind angezeigt, aber nicht einfuegbar");
```

durch:

```js
gleich(KNOPF.textContent, "Stage importieren · 1 Objekt",
	"💣 der Knopf zaehlt, was ENTSTEHT (Aufgabe 7, 14.09.2026) -- nur `mitVorschlagOffen` traegt "
	+ "ein Item, die zwei anderen liegen auf der Stage, entstehen aber nicht");
```

**Stelle 2** — ersetze:

```js
gleich(KNOPF.textContent, "Stage importieren (0 von 1)",
	"ein angezeigtes Objekt ohne Vorschlag zaehlt bei m mit, nie bei n");
```

durch:

```js
gleich(KNOPF.textContent, "Stage importieren · nichts zu importieren",
	"ein Objekt ohne Vorschlag liegt auf der Stage, entsteht aber nicht");
```

**Stelle 3** — ersetze:

```js
"die leere Stage nennt zwei Nullen"
```

durch:

```js
"die leere Stage sagt es in Worten"
```

**Stelle 4** — ersetze:

```js
"die Gegenprobe zum Ausgangspunkt: der Knopf steht wirklich auf (0 von 0), bevor die Liste laeuft"
```

durch:

```js
"die Gegenprobe zum Ausgangspunkt: der Knopf steht wirklich auf „nichts auf der Stage\", bevor die Liste laeuft"
```

**Stelle 5** — ersetze:

```js
gleich(KNOPF.textContent, "Stage importieren (1 von 2)",
	"💣 der Listenlauf liest jetzt die ANZEIGE-MENGE -- 1 von 2, obwohl die Antwort selbst gar "
```

durch:

```js
gleich(KNOPF.textContent, "Stage importieren · 1 Objekt",
	"💣 der Listenlauf liest jetzt die ANZEIGE-MENGE -- 1 Objekt, obwohl die Antwort selbst gar "
```

**Stelle 6** — ersetze (alle 4 Vorkommen):

```js
"Stage importieren (0 von 0)"
```

durch:

```js
"Stage importieren · nichts auf der Stage"
```

`js/review/__tests__/garetien-uebernahme-blatt.test.js`:

**Stelle 1** — ersetze:

```js
gleich(knopfVoll.beschriftung, "Stage importieren (2 von 3)",
	"der Knopf traegt „n von m\" -- zwei der drei Angezeigten haben ein Item");
```

durch:

```js
gleich(knopfVoll.beschriftung, "Stage importieren · 2 Objekte",
	"der Knopf zaehlt, was entsteht (Aufgabe 7) -- zwei der drei Objekte haben ein Item");
```

**Stelle 2** — ersetze:

```js
gleich(knopfLeer.beschriftung, "Stage importieren (0 von 1)", "und sagt die Null auch");
```

durch:

```js
gleich(knopfLeer.beschriftung, "Stage importieren · nichts zu importieren", "und sagt es auch");
```

**Stelle 3** — ersetze:

```js
gleich(garetienUebernahmeKnopfZustand(undefined).beschriftung, "Stage importieren (0 von 0)",
	"…und nennt zwei Nullen, keine Ausnahme");
```

durch:

```js
gleich(garetienUebernahmeKnopfZustand(undefined).beschriftung, "Stage importieren · nichts auf der Stage",
	"und sagt es in Worten, keine Ausnahme");
```

`js/review/__tests__/garetien-zusatz-auf-die-stage.test.js`:

**Stelle 1** — ersetze:

```js
gleich(stand.beschriftung, "Stage importieren (1 von 1)");
```

durch:

```js
gleich(stand.beschriftung, "Stage importieren · 1 Objekt");
```

**Stelle 2** — ersetze:

```js
gleich(stand.beschriftung, "Stage importieren (0 von 1)");
```

durch:

```js
gleich(stand.beschriftung, "Stage importieren · nichts zu importieren");
```

`js/review/__tests__/garetien-anzeige-menge.test.js`:

**Stelle 1** — ersetze:

```js
gleich(stand.beschriftung, "Stage importieren (1 von 3)",
	"1 von 3 -- nur `mitVorschlag` traegt ein Item");
```

durch:

```js
gleich(stand.beschriftung, "Stage importieren · 1 Objekt",
	"1 Objekt -- nur `mitVorschlag` traegt ein Item (Aufgabe 7: gezaehlt wird, was entsteht)");
```

**Stelle 2** — ersetze:

```js
	"Stage importieren (0 von 0)", "die leere Anzeige nennt zwei Nullen, keine Ausnahme");
```

durch:

```js
	"Stage importieren · nichts auf der Stage", "die leere Stage sagt es in Worten, keine Ausnahme");
```

**Stelle 3** — ersetze:

```js
gleich(standGemischt.beschriftung, "Stage importieren (1 von 2)",
```

durch:

```js
gleich(standGemischt.beschriftung, "Stage importieren · 1 Objekt",
```

**Stelle 4** — ersetze:

```js
	+ "weiterhin, `nurGeometrie` weiterhin nicht -- 1 von 2, nicht 2 von 2");
```

durch:

```js
	+ "weiterhin, `nurGeometrie` weiterhin nicht -- 1 Objekt, nicht 2");
```

`js/review/__tests__/garetien-vokabular.test.js`:

**Stelle 1** — ersetze:

```js
["Alle wählen", "Stage leeren", "Alle zentrieren", "Stage importieren (0)"],
```

durch:

```js
["Alle wählen", "Stage leeren", "Alle zentrieren", "Stage importieren · nichts auf der Stage"],
```

`js/review/__tests__/garetien-verbund-zeile-nicht-klickbar.test.js` (Abschnitt A):

**Stelle 1** — ersetze:

```js
// `garetienVerbundBlockMarkup` braucht `zustand.objekte` (siehe garetien-verbund-fragment-weg.
// test.js Abschnitt F); hier reicht der isolierte Bauer per `vm`, wie schon in
// garetien-verbund-detail.test.js -- er ist ohnehin nicht exportiert.
const vm = require("vm");
const quelle = fs.readFileSync(path.join(__dirname, "..", "review-garetien-importer.js"), "utf8");
function schneide(name) {
	const a = quelle.indexOf("function " + name);
	assert.ok(a > -1, name + " fehlt");
	return quelle.slice(a, quelle.indexOf("\n\t}", a) + 3);
}
const kontext = { avesmapsGaretienEscape: (s) => String(s) };
vm.createContext(kontext);
vm.runInContext(
	schneide("garetienVerbundSchluessel") + "\n"
	+ schneide("garetienVerbundMitglieder") + "\n"
	+ schneide("garetienVerbundIstZusammen") + "\n"
	+ "let _garetienVerbundZusammen = new Set();\n"
	+ schneide("garetienVerbundBlockMarkup") + "\n"
	+ "this.block = garetienVerbundBlockMarkup;", kontext);

const markup = kontext.block(objekte[0], objekte);
```

durch:

```js
// 🔴 Aufgabe 7 (14.09.2026): der Bauer ist exportiert und liest die STAGE -- die Fragmente liegen
// darauf, damit ihr ✕ (und damit die ganze Zeilenform) wirklich gezeichnet wird. Der `vm`-Schnitt von
// vorher kannte die Stage nicht und fiele mit einem ReferenceError um.
api.avesmapsGaretienStageHinzufuegen(objekte);
const markup = api.garetienVerbundBlockMarkup(objekte[0], objekte);
```

`js/review/__tests__/garetien-verbund-klick.test.js` (ganz ersetzt):

```js
// Aufgabe 8 des Garetien-Fragmente-Verbunds -- der Verbund-Knopf, samt seinem EIGENEN
// Klick-Verteiler (garetienVerbundKlick).
// Brief:   .superpowers/sdd/2026-09-09-garetien-fragmente-verbund/task-8-brief.md
//
// 🔴 UMGEBAUT AM 14.09.2026 (Garetien-Importer vereint, Aufgaben 6 und 7): der Knopf heisst
// „Zusammenlegen (n)" / „Verbund auflösen (n)", steht NICHT mehr in der Handlungsleiste, sondern in
// Block B (garetienVerbundBlockMarkup), und erst, wenn mindestens zwei Fragmente auf der Stage liegen.
// Zusammenlegen LEGT NICHT MEHR AUF -- es markiert die Stage-Eintraege.
//
// 🔴 EIGENE ERGAENZUNG DER URSPRUENGLICHEN SITZUNG: JEDES `data-handlung`-Ziel laeuft am Ende durch
// `garetienHandlungKlick`; `garetienHandlungsRumpf` schliesst "verbund" ausdruecklich aus. Ohne den
// EIGENEN Verteiler bliebe der Klick wortlos. Dieser Test faehrt deshalb GENAU DEN Verteiler, den die
// Verdrahtung im Fenster zuerst ruft: `garetienVerbundKlick`.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-klick.test.js

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter();

// Eine winzige DOM-Attrappe: `closest` sucht sich selbst gegen den einen Selektor dieses Knopfs.
function ziel(attribute, optionen) {
	const knoten = Object.assign({
		disabled: false,
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(attribute, name) ? attribute[name] : null;
		},
	}, optionen || {});
	knoten.closest = function (auswahl) {
		if (auswahl === '[data-handlung="verbund"]'
			&& attribute["data-handlung"] === "verbund") { return knoten; }
		return null;
	};
	return knoten;
}

function fragmente(n) {
	// Aufgabe 6: Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
	const basis = { ebene: "Waelder", typ: "Wald", verbund_stamm: "Silker Hain", verbund_n: n,
		ziel: "region", subtyp: "wald", urteil: "neu", stand: "offen" };
	return Array.from({ length: n }, (_, i) => Object.assign(
		{ key: "ggp:silkerhain:" + i, name: "Silker Hain " + (i + 1) }, basis));
}

function zuruecksetzen() {
	api.avesmapsGaretienStageLeeren();
}

// REIN: `zustand.objekte` per die ECHTE Tuer setzen -- die Liste entsteht ausschliesslich in
// `avesmapsGaretienListeHolen`, also wird `global.fetch` einmal ersetzt und zurueckgesetzt.
async function mitObjekten(objekte, tun) {
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({
			json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7 }),
		});
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
	tun();
}

(async function () {
	// =============================================================================================
	// A. 🔴 Aufgabe 7: der Knopf steht NICHT in garetienHandlungen, sondern in Block B -- und erst mit
	// zwei Fragmenten auf der Stage.
	// =============================================================================================
	zuruecksetzen();
	const [m1, m2] = fragmente(2);
	await mitObjekten([m1, m2], function () {
		gleich(api.garetienHandlungen(m1).filter((k) => k.name === "verbund").length, 0,
			"die Handlungsleiste traegt keinen Verbund-Knopf mehr");
		gleich(api.garetienVerbundBlockMarkup(m1, [m1, m2]).indexOf('data-handlung="verbund"'), -1,
			"ohne Fragment auf der Stage steht auch in Block B keiner");

		api.avesmapsGaretienStageHinzufuegen([m1, m2]);
		const block = api.garetienVerbundBlockMarkup(m1, [m1, m2]);
		wahr(block.indexOf('<button class="btn btn--accent" type="button" data-handlung="verbund" data-key="ggp:silkerhain:0">Zusammenlegen (2)</button>') !== -1,
			"zwei auf der Stage: „Zusammenlegen (2)“, Akzentrahmen, bedienbar: " + block);

		api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), [m1, m2]);
		wahr(api.garetienVerbundBlockMarkup(m1, [m1, m2]).indexOf(">Verbund auflösen (2)</button>") !== -1,
			"zusammengelegt: „Verbund auflösen (n)“");
	});
	zuruecksetzen();

	// Ein Verbund mit nur EINEM Mitglied auf der Stage zeigt keinen Knopf -- „Zusammenlegen" ohne
	// einen zweiten Partner ist keins.
	const [nurEines, zweites] = fragmente(2);
	await mitObjekten([nurEines, zweites], function () {
		api.avesmapsGaretienStageHinzufuegen([nurEines]);
		gleich(api.garetienVerbundBlockMarkup(nurEines, [nurEines, zweites]).indexOf('data-handlung="verbund"'), -1,
			"ein einzelnes Fragment auf der Stage: kein Knopf");
	});
	zuruecksetzen();

	// Ein Objekt ohne Verbund bekommt GAR KEINEN Verbund-Knopf.
	const einzeln = { key: "ggp:weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
		abschnitte: [], items: [] };
	await mitObjekten([einzeln], function () {
		const namen = api.garetienHandlungen(einzeln).map((k) => k.name);
		wahr(!namen.includes("verbund"), "kein Verbund -> kein Knopf: " + namen.join(", "));
		gleich(api.garetienVerbundBlockMarkup(einzeln, [einzeln]), "", "und kein Block");
	});
	zuruecksetzen();

	// =============================================================================================
	// B. garetienHandlungsRumpf schliesst "verbund" aus -- er geht NIE durch die geteilte Tuer
	// =============================================================================================

	const [b1] = fragmente(2);
	gleich(api.garetienHandlungsRumpf("verbund", b1, 7), null,
		"🔴 „verbund“ schickt nichts an die geteilte Uebernahme-Vorschau -- eigene Tuer, "
		+ "garetienVerbundKlick");
	zuruecksetzen();

	// =============================================================================================
	// C. Der Klick-Verteiler garetienVerbundKlick -- gemessen am ERGEBNIS.
	// =============================================================================================

	const [c1, c2] = fragmente(2);
	const schluesselC = api.garetienVerbundSchluessel(c1);

	gleich(api.garetienVerbundKlick({ target: ziel({}) }, [c1, c2]), null,
		"ein Klick neben den Knopf loest nichts aus");
	gleich(api.garetienVerbundIstZusammen(schluesselC), false, "und aendert auch nichts");

	gleich(api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }, { disabled: true }) },
		[c1, c2]), null, "ein gesperrtes Element schickt nichts -- die Anzeige-Sperre gilt auch hier");

	// 🔴 Aufgabe 6: der Klick LEGT NICHT AUF. Mit nur einem Fragment auf der Stage ist nichts
	// zusammenzulegen -- das „Nein" zaehlt als gefunden und nennt den Grund.
	api.avesmapsGaretienStageHinzufuegen([c1]);
	const gesperrt = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(gesperrt.handlung, "verbund_gesperrt", "ein Fragment auf der Stage: gesperrt, kein Auflegen");
	gleich(api.avesmapsGaretienStageHat(c2.key), false, "💣 und das zweite Fragment bleibt, wo es war");

	api.avesmapsGaretienStageHinzufuegen([c2]);
	const ergebnis1 = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(ergebnis1.handlung, "verbund_zusammengelegt", "der Klick legt zusammen und benennt die Richtung");
	gleich(api.garetienVerbundIstZusammen(schluesselC), true, "der Verbund gilt jetzt als zusammengelegt");

	const ergebnis2 = api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": c1.key }) }, [c1, c2]);
	gleich(ergebnis2.handlung, "verbund_aufgeloest", "der zweite Klick loest auf");
	gleich(api.garetienVerbundIstZusammen(schluesselC), false, "die Entscheidung ist zurueckgenommen");
	gleich(api.avesmapsGaretienStageHat(c1.key) && api.avesmapsGaretienStageHat(c2.key), true,
		"💣 die Objekte bleiben auf der Stage -- „Aufloesen“ nimmt nur die Entscheidung");
	zuruecksetzen();

	const [d1, d2] = fragmente(2);
	gleich(api.garetienVerbundKlick(
		{ target: ziel({ "data-handlung": "verbund", "data-key": "gibtesnicht" }) }, [d1, d2]),
		null, "ein unbekannter Schluessel trifft kein Objekt");
	gleich(api.garetienVerbundKlick({}, []), null, "ein Ereignis ohne Ziel schickt nichts");
	gleich(api.garetienVerbundKlick({ target: {} }, []), null, "ein Ziel ohne `closest` schickt nichts");

	// =============================================================================================
	// D. Die VERDRAHTUNG in garetienDetailMarkup: Block und Knopf stehen in der echten Spalte.
	// =============================================================================================

	const [e1, e2] = fragmente(2);
	await mitObjekten([e1, e2], function () {
		api.avesmapsGaretienStageHinzufuegen([e1, e2]);
		const spalte = api.garetienDetailMarkup(e1, null, false);
		wahr(spalte.indexOf('<p class="gi-sec">Verbund') > -1,
			"der Verbund-Block steht in der echten Detailspalte: " + spalte.slice(0, 400));
		wahr(spalte.indexOf('data-handlung="verbund"') > -1, "und der Knopf „Zusammenlegen“ darin");
		const iVerbund = spalte.indexOf('<p class="gi-sec">Verbund');
		const iWasBeiUns = spalte.indexOf("Was bei uns an derselben Stelle liegt");
		wahr(iVerbund > -1 && iWasBeiUns > -1 && iVerbund < iWasBeiUns,
			"der Verbund-Block steht VOR „Was bei uns an derselben Stelle liegt“");
	});
	zuruecksetzen();

	const solo = { key: "ggp:weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
		abschnitte: [], items: [] };
	await mitObjekten([solo], function () {
		const spalte = api.garetienDetailMarkup(solo, null, false);
		wahr(spalte.indexOf('<p class="gi-sec">Verbund') === -1, "ohne Verbund erscheint kein Verbund-Block");
	});
	zuruecksetzen();

	console.log(`garetien-verbund-klick: ${checks} Pruefungen bestanden.`);
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
```

`js/review/__tests__/garetien-verbund-detail.test.js` (ganz ersetzt):

```js
// Aufgabe 8 des Garetien-Fragmente-Verbunds -- der Block „Verbund" in der Einzelansicht.
// Auftrag: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md §9 (Block B)
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-detail.test.js
//
// 🔴 UMGEBAUT AM 14.09.2026 (Garetien-Importer vereint, Aufgabe 7): der Bauer liest seither die STAGE
// (✕ nur an Fragmenten, die dort liegen; der Knopf erst ab zwei) -- ein `vm`-Schnitt ohne Modulzustand
// kann ihn nicht mehr fahren. Er ist exportiert und wird am echten Modul AUSGEFUEHRT, nicht per Regex
// gelesen.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter();
const block = api.garetienVerbundBlockMarkup;

const objekte = [1, 2, 3, 4].map((i) => ({
	key: "k" + i, name: "Silker Hain " + i, ebene: "Waelder", typ: "Wald", ziel: "region", subtyp: "wald",
	verbund_stamm: "Silker Hain", verbund_n: 4, geometrie: new Array(10 + i).fill([0, 0]),
}));

api.avesmapsGaretienStageLeeren();

// Ohne Verbund: kein Block.
assert.strictEqual(block({ key: "x", name: "Weidicht" }, []), "");

// Mit Verbund, nichts auf der Stage: vier Zeilen, KEIN ✕ (auf „Offen" ist Block B reine Anzeige).
const offen = block(objekte[0], objekte);
assert.ok(offen.indexOf("Silker Hain 1") > -1);
assert.ok(offen.indexOf("Silker Hain 4") > -1);
assert.strictEqual((offen.match(/gi-seg__weg/g) || []).length, 0, "ohne Stage kein ✕");
assert.strictEqual((offen.match(/class="gi-seg gi-seg--verbund"><span><\/span>/g) || []).length, 4,
	"vier Zeilen mit leerer erster Zelle");

// Alle vier auf der Stage: jede Zeile traegt ihren ✕.
api.avesmapsGaretienStageHinzufuegen(objekte);
const m = block(objekte[0], objekte);
assert.strictEqual((m.match(/gi-seg__weg/g) || []).length, 4, "es fehlt ein ✕");

// 💣 Die Punktzahl steht IM Namen, nicht in einer eigenen Rasterzelle -- sonst braucht die Zeile
// mit Knopf eine zweite Rasterreihe und wird doppelt so hoch (gemessen 46 statt 28 px).
assert.ok(m.indexOf("gi-seg__zahl") > -1, "die Punktzahl steht in einer eigenen Zelle");
assert.strictEqual((m.match(/gi-seg__gap/g) || []).length, 0, "eine vierte Rasterzelle bricht die Zeile um");

// ⚠️ Ein Verbund mit nur EINEM Mitglied ist keiner mehr -- dieselbe Regel wie bei
// garetienVerbundMarkeMarkup (`n < 2`).
api.avesmapsGaretienStageLeeren();
assert.strictEqual(block(objekte[0], [objekte[0]]), "", "ein einzelnes Fragment ist kein Verbund mehr");

// Der ✕ traegt den SCHLUESSEL des Fragments, nicht seinen Namen.
api.avesmapsGaretienStageHinzufuegen(objekte);
assert.ok(m.indexOf('data-verbund-weg="k1"') > -1, "der erste Knopf traegt den Schluessel k1");
assert.ok(m.indexOf('data-verbund-weg="k4"') > -1, "der vierte Knopf traegt den Schluessel k4");

// Escaping: der Name geht durch den ECHTEN Escaper des Moduls.
const boese = objekte.map((o, i) => (i === 0 ? Object.assign({}, o, { name: "<Silker> Hain 1" }) : o));
const mBoese = block(boese[0], boese);
assert.ok(!mBoese.includes("<Silker>"), "der Fragmentname wird escaped: " + mBoese);
assert.ok(mBoese.includes("&lt;Silker"), "und escaped landet er auch wirklich im Markup: " + mBoese);

api.avesmapsGaretienStageLeeren();
console.log("OK -- garetien-verbund-detail");
```

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

```bash
for t in garetien-verbund-block-zaehlung garetien-verbund-klick garetien-verbund-detail garetien-verbund-zeile-nicht-klickbar garetien-verbund-fragment-weg garetien-fussknopf-dom garetien-uebernahme-blatt garetien-zusatz-auf-die-stage garetien-anzeige-menge garetien-vokabular garetien-vorwaertsknopf garetien-einfuege-haken garetien-handlungen; do node js/review/__tests__/$t.test.js 2>&1 | tail -1; done
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
```
Erwartet: `garetien-verbund-block-zaehlung: 37 Pruefungen bestanden.`, alle übrigen OK; Feldlauf ohne `ROT:`; Dateizahl gegen das Workflow-Muster gezählt (im Wegwerf-Worktree nach allen vier Aufgaben: 546).

Mutationsproben (gesehen, alle gefangen): Urteilsfilter entfernt · schon aufgelegte zählen mit · Klick nimmt nichts mit · Verbund zählt je Teil · Rückfrage mit `stand.anzahl` · Knopf ab einem Fragment · Knopf nie gesperrt · ✕ immer.

🔧 DU: Auf „Offen" ein Fragment wählen — der Knopf sagt „Auf die Stage · mit n weiteren Fragmenten", die Statuszeile nach dem Klick ebenso. Auf „Stage" in Block B „Zusammenlegen (n)" drücken → Knopf wird „Verbund auflösen (n)", Fußknopf „Stage importieren · 1 Objekt aus n Zeilen"; bei einem Weg steht der Knopf gesperrt mit „Wege-Verbünde sind noch nicht freigegeben.". „Stage importieren" drücken und in der Rückfrage „Zusammengelegt: „<Stamm>“ mit n Teilen." lesen — dann Abbrechen.

- [ ] **Schritt 5: Committen**

```bash
git add js/review/review-garetien-importer.js
git add index.html
git add js/review/__tests__/garetien-verbund-block-zaehlung.test.js
git add js/review/__tests__/garetien-verbund-klick.test.js
git add js/review/__tests__/garetien-verbund-detail.test.js
git add js/review/__tests__/garetien-verbund-zeile-nicht-klickbar.test.js
git add js/review/__tests__/garetien-fussknopf-dom.test.js
git add js/review/__tests__/garetien-uebernahme-blatt.test.js
git add js/review/__tests__/garetien-zusatz-auf-die-stage.test.js
git add js/review/__tests__/garetien-anzeige-menge.test.js
git add js/review/__tests__/garetien-vokabular.test.js
git commit -F- <<'EOF'
ui(garetien-importer): „Auf die Stage" nimmt die Fragmente mit, „Zusammenlegen" steht in Block B, der Fußknopf zählt Objekte

Auf „Offen" legte „Verbund auf die Stage (n)" in einem Klick auf und
verschmolz. Jetzt nimmt „Auf die Stage" an einem Fragment die uebrigen
erzeugenden Fragmente einzeln mit und sagt es in der zweiten Zeile; ein
deckt_sich- oder Zusatz-Objekt kommt nicht mit.

„Zusammenlegen (n)" / „Verbund auflösen (n)" steht in Block B, sobald zwei
Fragmente auf der Stage liegen, gesperrt mit sichtbarem Grund. Fussknopf und
Rueckfrage zaehlen, was entsteht: „Stage importieren · 1 Objekt aus 4 Zeilen",
und die Rueckfrage nennt jeden Verbund beim Namen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```


---

## Aufgabe 8: Zielwahl im Server: Riegel „beides", „Nur Quelle + Artikel"

**Deckt Entwurf §5 ab** (Server-Riegel „zusätzlich zu X", „Stätte in X"/„Nur Quelle + Artikel an X" im Server). Innenumbau — kein Blick nötig. ⚠️ Aber **nicht vor Aufgabe 9 live** — siehe den 💣 zur Reihenfolge.

- 🔴 **Der Riegel steht an der Tür**, `api/edit/wiki/sync-plan.php` im Zweig `apply` (~:260–273), **nach** dem Lesen von `$garetienJeItem` und **vor** `avesmapsWikiDumpLockAcquireOrThrow` — eine Absage darf die Pipeline-Sperre nicht halten. Antwort `avesmapsErrorResponse(422, 'garetien_beides_unbestaetigt', …)` (Envelope `{ok:false, error:{code,message}}`, bootstrap.php :521).
- 🔴 **„Dasselbe Objekt" = `avesmapsGaretienObjektSchluessel(entity_key)`** (`garetien-plan.php` :337). Ein Neu-Item ist `change_type = 'new'` — dazu gehört das Zusatz-Item „trotzdem neu", das die nackte Objektbasis trägt; ein Ergänzungs-Item ist `change_type = 'changed'` mit `…|ergaenzung|<public_id>` (`avesmapsGaretienErgaenzungsEintraege`, plan.php ~:948). Bestätigt ist nur, wenn **jedes** beteiligte Item `beides === true` trägt (strikt; `"true"`/`1` zählen nicht).
- ⚠️ **Gezählt wird nur, was dieses `apply` schreiben würde** (`selected = 1 AND apply_state IS NULL`, dieselbe Menge wie `avesmapsGaretienPendingItemsScoped` ~:1148) — **Abweichung vom Vertrag**, begründet mit dem Bestand: eine abgelehnte (abgehakte) Ergänzung macht kein Paar und bleibt abgelehnt; ein in einem früheren Häppchen übernommenes Item ebenso wenig. Ohne diesen Filter müsste ein Editor eine Ablehnung zurücknehmen, um ein Objekt neu anzulegen.
- 💣 **REIHENFOLGE: Aufgabe 8 nicht vor Aufgabe 9 live schalten.** Der heutige Client schickt bei „Neu einfügen" an einem sich deckenden Objekt Zusatz- UND Ergänzungs-Item ohne `beides` (K6, Entwurf §1c/4) — ab Aufgabe 8 antwortet die Tür darauf 422. Das ist der gewollte Riegel, aber bis Aufgabe 9 hat der Client keinen Weg, `beides` zu schicken; „Neu einfügen" an einem Deckungsfall wäre so lange gesperrt.
- 💣 **Der Vermerk eines „Nur Quelle"-Items ist NIE die nackte `public_id` der Siedlung.** Die Rücknahme eines `new`-Items mit Ziel `location` (Bauwerke) fällt bei nacktem Vermerk auf `avesmapsDeleteMapFeature($publicId)` (`avesmapsGaretienRuecknahmeAusfuehren` ~:2710) — sie **löschte die Stadt**. Deshalb `nur_quelle:<siedlung>` (`avesmapsGaretienNurQuelleVermerk`) und ein eigener Rücknahme-Zweig VOR allen Löschwegen. **Vertragserweiterung**: der Vertrag nennt die Rücknahme nicht; ohne sie wäre das Item gefährlich bzw. nicht zurücknehmbar.
- 🔴 **Die Rücknahme löst NUR den Artikel dieses Objekts** (`avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse`, über `sources.url_hash` = `avesmapsFeatureSourceHash`), nie alle Garetien-Quellen der Siedlung — dort hängen auch ihre eigene und die anderer Bauwerke (dieselbe Klasse wie Entwurf-Fehler 9). ⚠️ Hatte das Bauwerk keinen Artikel, hing die Sammelquelle des Wirts; sie bleibt bei der Rücknahme stehen, weil die Stadt dieselbe Adresse selbst tragen kann.
- ⚠️ **`innerorts_nur_quelle: true` allein ist ebenfalls ein Innerorts-Wunsch** (`avesmapsGaretienInnerortsGewuenscht`) — sonst fiele das Objekt still auf die Karte.
- 💣 **Eine ausdrücklich gewählte Siedlung gilt — oder das Item bricht LAUT ab** (Nachtrag Koordinator, Befund aus Aufgabe 9). `avesmapsGaretienInnerortsAusVorschlag` (~:2154) fiel bisher STILL auf die Vorauswahl zurück, wenn `innerorts_public_id` nicht in `befund.kandidaten` stand — genau der Fall einer Siedlung, die erst der Umkreis-Spinner gefunden hat: die Zielwahl hätte „Stätte in Rallerfurt" gezeigt, angelegt worden wäre sie in der Vorauswahl. Jetzt entscheidet EINE Funktion, `avesmapsGaretienInnerortsSiedlung`: gewählt → genau diese Siedlung, wenn sie **existiert, aktiv ist und keine Bauwerksklasse** (`avesmapsIstBauwerksklasse`) trägt, auch außerhalb der Kandidaten; sonst `RuntimeException` mit deutschem Satz („… liegt nicht (mehr) auf der Karte -- es wird keine andere genommen."), das Item wird `failed`, **nie** eine andere Siedlung. Nicht gewählt (alter Client, Bestand) → Vorauswahl des Laufs wie bisher; bei „Nur Quelle" muss auch sie aktiv auf der Karte liegen. `avesmapsGaretienInnerortsAusVorschlag` ist seither nur noch die Vorauswahl (ein Parameter weniger).
- ⚠️ **Die Bauwerks-Sperre ist eine Ergänzung** zum Nachtrag: der Kandidaten-Riegel ließ bisher nur Siedlungen zu (`avesmapsGaretienSiedlungsFamilie`); ohne sie bände ein Rumpf eine Stätte an einen Turm.
- 💣 **Fremder Test:** `garetien-innerorts-test.php` Abschnitt G (~:341–357) nagelt den stillen Rückfall fest („eine Stadt, die NICHT in den Kandidaten steht, faellt auf die Vorauswahl zurueck"; „ein Lauf VOR dem 07.09.2026 … dort kann keine Wahl gelten"). Wird in Schritt 1c umgedreht.
- ⚠️ **„Nur Quelle" zählt nicht als `applied`**, sondern als `angelegt_je_form.quelle` (wie eine Ergänzung): „1 Objekt importiert" behauptete sonst ein Kartenobjekt, das es nicht gibt.
- ⚠️ Der Reiter „Übernommen" zeigt ein „Nur Quelle"-Objekt als „übernommen" **ohne** den Zusatz „innerorts" — `innerorts_uebernommen` (garetien-liste.php ~:1247) fragt `settlement_place`, und dort entsteht nichts. Die Anzeige gehört zu Aufgabe 9/12.
- **Bestand:** Ein `apply` des bisherigen Clients ändert sich nur im K6-Fall (422, siehe oben). Ein vor dem Deploy übernommenes Kartenobjekt mit nacktem Vermerk bleibt zurücknehmbar wie vorher (Test: Praiostempel); eine abgelehnte Zeile bleibt abgelehnt und löst den Riegel nicht aus (Test B2). `nur_quelle:`-Vermerke gibt es im Bestand nicht. Keine Reparatur nötig.

**Dateien:**
- Ändern: `api/_internal/import/garetien-uebernahme.php` (`avesmapsGaretienInnerortsGewuenscht` ~:2115 + neue Funktionen dahinter; `avesmapsGaretienInnerortsAusVorschlag` ~:2154 + neue Funktion `avesmapsGaretienInnerortsSiedlung` dahinter; `avesmapsGaretienUebernehmen` Innerorts-Weiche ~:1853–1900 und Zählung ~:2029; `avesmapsGaretienRuecknahmeAusfuehren` ~:2708)
- Ändern: `api/edit/wiki/sync-plan.php` (`case 'apply'`, Garetien-Block ~:260–273)
- Ändern: `api/edit/map/garetien-import.php` (nur Kommentar ~:284–285)
- Neu: `api/_internal/import/__tests__/garetien-beides-riegel-test.php`
- Test: `api/_internal/import/__tests__/garetien-uebernahme-test.php` (neue Abschnitte „NUR QUELLE" und „GEWAEHLTE SIEDLUNG" vor dem Schluss-`echo`)
- Test (fremd, umgedreht): `api/_internal/import/__tests__/garetien-innerorts-test.php` (Abschnitt G ~:341–357)

**Schnittstellen:**
- Nutzt: `avesmapsGaretienObjektSchluessel(string $entityKey): string`, `avesmapsGaretienAnzeigeNameAusSchluessel(string $entityKey): string` (plan.php :381), `avesmapsGaretienInnerortsAusVorschlag(array $nach, ?array $einstellungen = null): ?array`, `avesmapsGaretienQuellenZiel(string $ziel, string $objektPublicId): array` (`'location'` → `['settlement', id]`), `avesmapsGaretienArtikelQuelleAusItem(array $nach, string $entityKey): ?array`, `avesmapsRemoveFeatureSource(PDO, string $entityType, string $publicId, int $sourceId, int $userId): array`, `avesmapsFeatureSourceHash(string $url, string $wikiKey = ''): string`, `avesmapsEnsureFeatureSourceTables(PDO): void`, `avesmapsErrorResponse(int, string, string, array = []): never`
- Liefert: NEU `avesmapsGaretienBeidesRiegel(array $items, array $jeItem): ?string` (rein; `$items` = Zeilen mit `id`, `entity_key`, `change_type`, optional `label`) · NEU `avesmapsGaretienBeidesPruefen(PDO $pdo, int $runId, array $itemIds, ?array $jeItem): ?string` · NEU `avesmapsGaretienInnerortsNurQuelle(?array $einstellungen): bool` · NEU `avesmapsGaretienNurQuelleVermerk(string $siedlungPublicId): string` / `avesmapsGaretienNurQuelleAusVermerk(string $note): string` · Konstante `AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK = 'nur_quelle:'` · NEU `avesmapsGaretienSiedlungLesen(PDO $pdo, string $publicId): ?array{name:string, klasse:string, aktiv:bool}` · NEU `avesmapsGaretienInnerortsSiedlung(PDO $pdo, array $nach, ?array $einstellungen, string $label, bool $mussAufDerKarteLiegen = false): array{public_id:string, name:string}` (wirft `RuntimeException`) · GEÄNDERT `avesmapsGaretienInnerortsAusVorschlag(array $nach): ?array` (nur noch die Vorauswahl des Laufs; der zweite Parameter entfällt) · Nutzt zusätzlich `avesmapsIstBauwerksklasse(?string $klasse): bool` (`api/_internal/ortsklassen.php` :56) · NEU `avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse(PDO $pdo, string $entityType, string $entityPublicId, string $url, int $userId): int` · Rumpf je Item: `beides: true`, `innerorts_nur_quelle: true` · Tür: 422 `garetien_beides_unbestaetigt`

- [ ] **Schritt 1: Die fehlschlagenden Tests schreiben**

**1a.** Neue Datei `api/_internal/import/__tests__/garetien-beides-riegel-test.php`:

```php
<?php

declare(strict_types=1);

// Der Riegel „beides" (Entwurf docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §5).
//
// 💣 Ein `apply`, das fuer DASSELBE Objekt ein Neu-Item UND ein Ergaenzungs-Item traegt, legt eine
// Dublette an und haengt zugleich die Garetien-Quelle an den Bestand (K6). Das darf nur geschehen,
// wenn der Editor die Wahl „Auf die Karte -- zusaetzlich zu X" ausdruecklich getroffen hat -- und
// das steht im Rumpf als `beides: true` an JEDEM beteiligten Item. Eine Sperre nur im Browser ist
// keine: die Tuer (api/edit/wiki/sync-plan.php) weist das `apply` mit 422 ab.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll \
//           api/_internal/import/__tests__/garetien-beides-riegel-test.php

require_once __DIR__ . '/../garetien-uebernahme.php';

$pruefungen = 0;

// =================================================================================================
// A. Der reine Riegel
// =================================================================================================
// Die Schluessel, wie der Planbau sie baut: das Zusatz-Item traegt die nackte Objektbasis
// (avesmapsGaretienErgaenzungsEintraege klont die Vorlage), das Ergaenzungs-Item haengt
// `|ergaenzung|<public_id>` an (avesmapsGaretienAbschnittsEintrag).
$basis = 'ggp:Gewaesser:Fluss:Garetien:Natter!Natter';
$zusatz = ['id' => 11, 'entity_key' => $basis, 'change_type' => 'new'];
$ergaenzung = ['id' => 12, 'entity_key' => $basis . '|ergaenzung|w-1', 'change_type' => 'changed'];
$ergaenzung2 = ['id' => 13, 'entity_key' => $basis . '|ergaenzung|w-2', 'change_type' => 'changed'];

$grund = avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], []);
assert(is_string($grund) && str_contains($grund, 'Natter'),
    'A: Neu + Ergaenzung desselben Objekts ohne Bestaetigung wird abgewiesen, und der Grund nennt das Objekt: ' . var_export($grund, true));
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], [11 => ['beides' => true]]) !== null,
    'A: EINE Bestaetigung reicht nicht -- beide Items muessen sie tragen');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], [12 => ['beides' => true]]) !== null,
    'A: auch nicht die am Ergaenzungs-Item allein');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], [11 => ['beides' => true], 12 => ['beides' => true]]) === null,
    'A: mit beiden Bestaetigungen geht es durch -- ohne diese Ausnahme wiese der Riegel genau die Wahl ab, die ihn braucht');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung], [11 => ['beides' => 'true'], 12 => ['beides' => 1]]) !== null,
    'A: 💣 nur ein echtes `true` bestaetigt -- "true" und 1 sind keine ausdrueckliche Wahl');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung, $ergaenzung2],
    [11 => ['beides' => true], 12 => ['beides' => true]]) !== null,
    'A: ein ZWEITES Ergaenzungs-Item ohne Bestaetigung faellt ebenso');
assert(avesmapsGaretienBeidesRiegel([$zusatz, $ergaenzung, $ergaenzung2],
    [11 => ['beides' => true], 12 => ['beides' => true], 13 => ['beides' => true]]) === null,
    'A: alle drei bestaetigt: durch');
$pruefungen += 7;

assert(avesmapsGaretienBeidesRiegel([$zusatz], []) === null, 'A: ein Neu-Item allein braucht keine Bestaetigung');
assert(avesmapsGaretienBeidesRiegel([$ergaenzung, $ergaenzung2], []) === null, 'A: Ergaenzungen allein ebenso wenig');
$fremd = ['id' => 21, 'entity_key' => 'ggp:Gewaesser:Fluss:Garetien:Gardel!Gardel', 'change_type' => 'new'];
assert(avesmapsGaretienBeidesRiegel([$fremd, $ergaenzung], []) === null,
    'A: Neu an einem ANDEREN Objekt und Ergaenzung an diesem sind kein Paar');
assert(avesmapsGaretienBeidesRiegel([], []) === null, 'A: nichts, kein Einwand');
$pruefungen += 4;

// =================================================================================================
// B. Der Leser der Tuer -- gegen echte Zeilen, nur die ids DIESES Laufs
// =================================================================================================
$pdo = avesmapsGaretienPlanTestPdo();
$lauf = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'beides-riegel');
$fremderLauf = avesmapsSyncPlanStartRun($pdo, 'citymap', 7, 'fremd');
$legeAn = $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, after_json, selected)
                         VALUES (?, ?, NULL, ?, ?, '{}', 1)");
$legeAn->execute([$lauf, $basis, 'new', 'Natter (Fluss) zusaetzlich anlegen']);
$idZusatz = (int) $pdo->lastInsertId();
$legeAn->execute([$lauf, $basis . '|ergaenzung|w-1', 'changed', 'Natter (Fluss) Quelle']);
$idErgaenzung = (int) $pdo->lastInsertId();
$legeAn->execute([$fremderLauf, $basis . '|ergaenzung|w-9', 'changed', 'fremd']);
$idFremd = (int) $pdo->lastInsertId();

assert(is_string(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idErgaenzung], null)),
    'B: die Tuer liest die Zeilen selbst und weist das Paar ohne `einstellungen_je_item` ab');
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idErgaenzung],
    [$idZusatz => ['beides' => true], $idErgaenzung => ['beides' => true]]) === null,
    'B: mit beiden Bestaetigungen laesst sie es durch');
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idFremd], null) === null,
    'B: 💣 eine id aus einem FREMDEN Lauf zaehlt nicht mit -- sonst koennte sie ein Paar vortaeuschen');
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz], null) === null,
    'B: das Neu-Item allein ist kein Paar');
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [], null) === null, 'B: ohne ids kein Einwand');
$pruefungen += 5;

// --- B2. DER BESTAND (Owner 14.09.2026): eine ABGELEHNTE Zeile bleibt abgelehnt.
// 🔴 Gezaehlt wird nur, was dieses `apply` wirklich schreiben wuerde -- dieselbe Menge wie
// avesmapsGaretienPendingItemsScoped (`selected = 1 AND apply_state IS NULL`). Eine abgelehnte
// Ergaenzung (die Tuer 'decline' hakt sie ab, sync-plan.php) wird nicht uebernommen; sie mit einem
// Neu-Item desselben Objekts zum Paar zu zaehlen, wiese ein `apply` ab, das gar keine Dublette mit
// Quelle am Bestand erzeugen kann -- und zwaenge den Editor, eine Ablehnung zurueckzunehmen.
$pdo->prepare('UPDATE sync_plan_item SET selected = 0 WHERE id = ?')->execute([$idErgaenzung]);
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (?, ?, 'changed', '2026-09-01 10:00:00')")
    ->execute([AVESMAPS_GARETIEN_PLAN_KIND, $basis . '|ergaenzung|w-1']);
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idErgaenzung], null) === null,
    'B2: eine abgelehnte (abgehakte) Ergaenzung ist kein Teil des Paars');
$declinedB2 = $pdo->query("SELECT declined_at FROM sync_decision WHERE entity_key = '" . $basis . "|ergaenzung|w-1'")->fetchColumn();
assert($declinedB2 === '2026-09-01 10:00:00', 'B2: und die Ablehnung steht unberuehrt: ' . var_export($declinedB2, true));
// Ein bereits UEBERNOMMENES Item eines frueheren Haeppchens zaehlt ebenso nicht mehr mit.
$pdo->prepare("UPDATE sync_plan_item SET selected = 1, apply_state = 'done', apply_note = 'w-1' WHERE id = ?")->execute([$idErgaenzung]);
assert(avesmapsGaretienBeidesPruefen($pdo, $lauf, [$idZusatz, $idErgaenzung], null) === null,
    'B2: ein schon uebernommenes Item (apply_state done) ist kein Teil des Paars');
$pruefungen += 3;

// =================================================================================================
// C. Die Tuer benutzt den Riegel -- VOR der Sperre und VOR dem Verteiler
// =================================================================================================
// 🔴 Eine Quelltext-Tatsache, weil der Vertrag sie verlangt (422 `garetien_beides_unbestaetigt`,
// Envelope ueber avesmapsErrorResponse). Kommentarfrei ueber den Tokenizer, zeilenendenneutral
// (AGENTS.md §9: hier CRLF, im Deploy-Tor LF).
$quelltext = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/wiki/sync-plan.php'));
$code = '';
foreach (token_get_all($quelltext) as $token) {
    if (is_array($token)) {
        if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $code .= $token[1];
        continue;
    }
    $code .= $token;
}
$applyAb = strpos($code, "case 'apply':");
$declinedAb = strpos($code, "case 'declined':");
assert($applyAb !== false && $declinedAb !== false && $applyAb < $declinedAb, 'C (Testaufbau): der apply-Zweig steht in sync-plan.php');
$apply = substr($code, $applyAb, $declinedAb - $applyAb);
$riegelPos = strpos($apply, 'avesmapsGaretienBeidesPruefen($pdo, $runId, $garetienItemIds, $garetienJeItem)');
assert($riegelPos !== false,
    'C: die Tuer ruft den Riegel mit dem Lauf, den ids UND den Handeingaben je Item');
assert(preg_match("~avesmapsErrorResponse\(\s*422\s*,\s*'garetien_beides_unbestaetigt'~", $apply) === 1,
    'C: und antwortet 422 mit dem Maschinencode garetien_beides_unbestaetigt');
$jeItemPos = strpos($apply, '$garetienJeItem = avesmapsGaretienEinstellungenJeItemAusRumpf(');
$sperrePos = strpos($apply, 'avesmapsWikiDumpLockAcquireOrThrow(');
$verteilerPos = strpos($apply, "'garetien' => avesmapsGaretienApplyStep(");
assert($jeItemPos !== false && $jeItemPos < $riegelPos,
    'C: der Riegel steht NACH dem Lesen der Handeingaben -- sonst prueft er gegen null');
assert($sperrePos !== false && $riegelPos < $sperrePos,
    'C: und VOR der Pipeline-Sperre -- eine Absage darf die Sperre nicht halten');
assert($verteilerPos !== false && $riegelPos < $verteilerPos, 'C: und VOR dem Verteiler, der schreibt');
$pruefungen += 6;

echo "OK: {$pruefungen} Pruefungen\n";
```

**1b.** In `api/_internal/import/__tests__/garetien-uebernahme-test.php` direkt VOR der letzten Zeile `echo "OK: {$pruefungen} Pruefungen\n";` (hinter dem Innerorts-Abschnitt, der mit `'dieselbe Zeile lebt wieder: ' . json_encode($staetteWieder));` und `$pruefungen += 6;` endet) einfügen:

```php
// =================================================================================================
// „NUR QUELLE + ARTIKEL AN X" -- keine Staette, nur die Quelle an der Siedlung
// (Entwurf docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §5, 🔧 „neu im Server")
// =================================================================================================
// 🔴 Die kleinere Antwort auf denselben Innerorts-Befund (Workflow-Owner 12.09.2026/7). Die
// Garetien-Quelle und der Artikel haengen an der SIEDLUNG (`settlement`, dieselbe Weiche wie ein
// Ort, avesmapsGaretienQuellenZiel), und es entsteht keine Zeile -- weder in `settlement_place`
// noch in `map_features`.
$pdoI->exec("INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_json, properties_json, is_active)
             VALUES ('stadt-wandleth', 'location', 'stadt', 'Wandleth', '{\"type\":\"Point\",\"coordinates\":[520,520]}', '{}', 1)");
// Die Stadt traegt schon ihre EIGENE Garetien-Quelle -- sie darf die Ruecknahme unten ueberleben.
avesmapsGaretienQuelleAnlegen($pdoI, 'settlement', 'stadt-wandleth', [
    'url' => 'https://www.garetien.de/index.php/Garetien:Wandleth', 'label' => 'Wandleth auf garetien.de',
    'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de',
], 7);
$garetienQuellenWandleth = static fn(): int => (int) $pdoI->query(
    "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'settlement' AND entity_public_id = 'stadt-wandleth' AND origin = 'garetien'"
)->fetchColumn();
assert($garetienQuellenWandleth() === 1, 'NQ (Testaufbau): Wandleth traegt seine eigene Quelle');
$featuresVorNq = (int) $pdoI->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
$staettenVorNq = (int) $pdoI->query('SELECT COUNT(*) FROM settlement_place')->fetchColumn();

avesmapsSyncPlanAddItem($pdoI, $laufI, $baueBauwerk('Wandlether Hesindetempel', $befundWandleth));
$hesindeId = $itemIdVon($pdoI, 'Wandlether Hesindetempel (Probe)');
$eNq = avesmapsGaretienUebernehmen($pdoI, $laufI, [$hesindeId], ['id' => 7], null, [
    $hesindeId => ['innerorts' => true, 'innerorts_nur_quelle' => true],
]);
assert($eNq['fehler'] === [], 'NQ: ohne Fehler: ' . json_encode($eNq['fehler'], JSON_UNESCAPED_UNICODE));
assert($eNq['angelegt'] === 0, '🔴 NQ: es wird NICHTS angelegt -- „N Objekte importiert" waere eine Falschaussage: ' . $eNq['angelegt']);
assert($eNq['angelegt_je_form']['quelle'] === 1 && $eNq['angelegt_je_form']['settlement_place'] === 0,
    'NQ: gezaehlt als Quelle, nicht als Staette: ' . json_encode($eNq['angelegt_je_form']));
assert((int) $pdoI->query('SELECT COUNT(*) FROM settlement_place')->fetchColumn() === $staettenVorNq,
    'NQ: KEINE Staette');
assert((int) $pdoI->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === $featuresVorNq,
    'NQ: und kein Kartenobjekt -- auch kein stiller Rueckfall auf die Karte');
assert($garetienQuellenWandleth() === 2, 'NQ: Wandleth traegt jetzt AUCH den Artikel des Tempels: ' . $garetienQuellenWandleth());
$nqNachtrag = array_values(array_filter($eNq['quellen_neu'],
    static fn(array $e): bool => $e['entity_type'] === 'settlement' && $e['public_id'] === 'stadt-wandleth'));
assert(count($nqNachtrag) === 1, 'NQ: der Browser bekommt die Quellenliste der Siedlung: ' . json_encode($eNq['quellen_neu'], JSON_UNESCAPED_UNICODE));
$itemNq = $pdoI->query('SELECT apply_state, apply_note FROM sync_plan_item WHERE id = ' . $hesindeId)->fetch(PDO::FETCH_ASSOC);
assert($itemNq['apply_state'] === 'done' && $itemNq['apply_note'] === avesmapsGaretienNurQuelleVermerk('stadt-wandleth'),
    '💣 NQ: der Vermerk ist NICHT die nackte public_id der Stadt -- die Ruecknahme loeschte sonst die Stadt: ' . json_encode($itemNq));
$pruefungen += 9;

// --- `innerorts_nur_quelle` ALLEIN ist ebenfalls ein Innerorts-Wunsch, nie ein Rueckfall auf die Karte.
avesmapsSyncPlanAddItem($pdoI, $laufI, $baueBauwerk('Wandlether Phextempel', $befundWandleth));
$phexId = $itemIdVon($pdoI, 'Wandlether Phextempel (Probe)');
$ePhex = avesmapsGaretienUebernehmen($pdoI, $laufI, [$phexId], ['id' => 7], null, [
    $phexId => ['innerorts_nur_quelle' => true],
]);
assert($ePhex['fehler'] === [] && $ePhex['angelegt'] === 0 && $ePhex['angelegt_je_form']['quelle'] === 1,
    'NQ: nur_quelle ohne `innerorts` haengt ebenso nur die Quelle an: ' . json_encode($ePhex, JSON_UNESCAPED_UNICODE));
assert((int) $pdoI->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === $featuresVorNq,
    'NQ: und legt ebenso kein Kartenobjekt an');
$pruefungen += 2;

// --- 💣 Eine Siedlung, die es nicht mehr gibt, bekommt keine Quelle -- das Item scheitert laut.
avesmapsSyncPlanAddItem($pdoI, $laufI, $baueBauwerk('Verlorener Tempel', ['public_id' => 'stadt-verschwunden', 'name' => 'Verschwunden', 'meilen' => 0.1]));
$verlorenId = $itemIdVon($pdoI, 'Verlorener Tempel (Probe)');
$eVerloren = avesmapsGaretienUebernehmen($pdoI, $laufI, [$verlorenId], ['id' => 7], null, [
    $verlorenId => ['innerorts' => true, 'innerorts_nur_quelle' => true],
]);
assert(count($eVerloren['fehler']) === 1 && str_contains($eVerloren['fehler'][0]['grund'], 'Verschwunden'),
    'NQ: eine verschwundene Siedlung wird beim Namen genannt: ' . json_encode($eVerloren['fehler'], JSON_UNESCAPED_UNICODE));
assert((int) $pdoI->query("SELECT COUNT(*) FROM feature_sources WHERE entity_public_id = 'stadt-verschwunden'")->fetchColumn() === 0,
    'NQ: und bekommt keine Verknuepfung');
$pruefungen += 2;

// --- Die Ruecknahme loest NUR die Quelle DIESES Tempels -- und loescht die Stadt NICHT.
$rNq = avesmapsGaretienRuecknahmeAusfuehren($pdoI, $laufI, [$hesindeId], ['id' => 7]);
assert($rNq['fehler'] === [] && $rNq['zurueckgenommen'] === 1,
    'NQ-Ruecknahme: gelingt: ' . json_encode($rNq, JSON_UNESCAPED_UNICODE));
assert((int) $pdoI->query("SELECT is_active FROM map_features WHERE public_id = 'stadt-wandleth'")->fetchColumn() === 1,
    '💣 NQ-Ruecknahme: die STADT steht noch');
$verbleibend = $pdoI->query(
    "SELECT s.url FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
      WHERE fs.entity_type = 'settlement' AND fs.entity_public_id = 'stadt-wandleth' AND fs.origin = 'garetien' ORDER BY s.url"
)->fetchAll(PDO::FETCH_COLUMN);
assert($verbleibend === [
    'https://www.garetien.de/index.php/Garetien:Wandleth',
    'https://www.garetien.de/index.php/Garetien:Wandlether%20Phextempel',
], '🔴 NQ-Ruecknahme: die eigene Quelle der Stadt und die des Phextempels bleiben, nur die des Hesindetempels faellt: '
    . json_encode($verbleibend));
assert($pdoI->query('SELECT apply_state FROM sync_plan_item WHERE id = ' . $hesindeId)->fetchColumn() === null,
    'NQ-Ruecknahme: das Item ist zurueck auf offen');
$pruefungen += 4;

// --- DER BESTAND (Owner 14.09.2026): ein Kartenobjekt mit NACKTEM Vermerk bleibt zuruecknehmbar wie vorher.
// Der Praiostempel oben wurde ohne Einstellungen auf die Karte uebernommen -- sein Vermerk ist die
// nackte public_id, genau wie jedes vor diesem Deploy uebernommene Objekt. Die neue Weiche fuer
// „Nur Quelle" darf ihn nicht abfangen.
$notePraios = (string) $pdoI->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $praiosId)->fetchColumn();
assert($notePraios !== '' && !str_contains($notePraios, ':') && avesmapsGaretienNurQuelleAusVermerk($notePraios) === '',
    'Bestand (Testaufbau): der Praiostempel traegt einen nackten Vermerk: ' . $notePraios);
$rPraios = avesmapsGaretienRuecknahmeAusfuehren($pdoI, $laufI, [$praiosId], ['id' => 7]);
assert($rPraios['fehler'] === [] && $rPraios['zurueckgenommen'] === 1,
    'Bestand: das Kartenobjekt mit altem Vermerk laesst sich zuruecknehmen: ' . json_encode($rPraios, JSON_UNESCAPED_UNICODE));
assert((int) $pdoI->query("SELECT is_active FROM map_features WHERE public_id = '" . $notePraios . "'")->fetchColumn() === 0,
    'Bestand: und es ist von der Karte -- ueber denselben Loeschweg wie vorher');
assert((int) $pdoI->query("SELECT is_active FROM map_features WHERE public_id = 'stadt-wandleth'")->fetchColumn() === 1,
    'Bestand: die Stadt daneben bleibt stehen');
$pruefungen += 4;

// =================================================================================================
// EINE AUSDRUECKLICH GEWAEHLTE SIEDLUNG GILT -- oder das Item bricht LAUT ab (Entwurf 14.09.2026, §5)
// =================================================================================================
// 💣 Bis zum 14.09.2026 fiel eine gewaehlte Siedlung, die nicht in `kandidaten` des Laufs stand, STILL
// auf die Vorauswahl zurueck -- genau der Fall einer Siedlung, die erst der Umkreis-Spinner gefunden
// hat. Die Zielwahl haette „Staette in Rallerfurt" gezeigt, angelegt worden waere sie in Wandleth.
// `$befundWandleth` traegt gar keine `kandidaten`: jede Wahl hier liegt AUSSERHALB der Liste des Laufs.
$pdoI->exec("INSERT INTO map_features (public_id, feature_type, feature_subtype, name, geometry_json, properties_json, is_active) VALUES
    ('stadt-rallerfurt', 'location', 'kleinstadt', 'Rallerfurt', '{\"type\":\"Point\",\"coordinates\":[540,540]}', '{}', 1),
    ('stadt-abgerissen', 'location', 'dorf', 'Abgerissen', '{\"type\":\"Point\",\"coordinates\":[560,560]}', '{}', 0),
    ('geb-wachturm', 'location', 'gebaeude', 'Wachturm', '{\"type\":\"Point\",\"coordinates\":[545,545]}', '{}', 1)");
$staetteVon = static fn(string $name): array|false => $pdoI->query(
    'SELECT settlement_public_id, settlement_name FROM settlement_place WHERE name = ' . $pdoI->quote($name)
)->fetch(PDO::FETCH_ASSOC);
$quellenAn = static fn(string $siedlung): int => (int) $pdoI->query(
    "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'settlement' AND origin = 'garetien' AND entity_public_id = " . $pdoI->quote($siedlung)
)->fetchColumn();
$quellenWandlethVorW = $quellenAn('stadt-wandleth');

// --- W1. Staette in der GEWAEHLTEN Siedlung.
avesmapsSyncPlanAddItem($pdoI, $laufI, $baueBauwerk('Rallerfurter Traviatempel', $befundWandleth));
$w1 = $itemIdVon($pdoI, 'Rallerfurter Traviatempel (Probe)');
$eW1 = avesmapsGaretienUebernehmen($pdoI, $laufI, [$w1], ['id' => 7], null, [
    $w1 => ['innerorts' => true, 'innerorts_public_id' => 'stadt-rallerfurt'],
]);
assert($eW1['fehler'] === [] && $eW1['angelegt_je_form']['settlement_place'] === 1,
    'W1: die Staette entsteht: ' . json_encode($eW1, JSON_UNESCAPED_UNICODE));
$sW1 = $staetteVon('Rallerfurter Traviatempel');
assert($sW1 !== false && $sW1['settlement_public_id'] === 'stadt-rallerfurt' && $sW1['settlement_name'] === 'Rallerfurt',
    '🔴 W1: sie haengt an der GEWAEHLTEN Siedlung, nicht an der Vorauswahl Wandleth: ' . json_encode($sW1));
$pruefungen += 2;

// --- W2. Nur Quelle an der GEWAEHLTEN Siedlung.
avesmapsSyncPlanAddItem($pdoI, $laufI, $baueBauwerk('Rallerfurter Efferdtempel', $befundWandleth));
$w2 = $itemIdVon($pdoI, 'Rallerfurter Efferdtempel (Probe)');
$eW2 = avesmapsGaretienUebernehmen($pdoI, $laufI, [$w2], ['id' => 7], null, [
    $w2 => ['innerorts' => true, 'innerorts_nur_quelle' => true, 'innerorts_public_id' => 'stadt-rallerfurt'],
]);
assert($eW2['fehler'] === [] && $eW2['angelegt'] === 0 && $quellenAn('stadt-rallerfurt') === 1,
    'W2: die Quelle haengt an Rallerfurt: ' . json_encode($eW2, JSON_UNESCAPED_UNICODE));
assert($quellenAn('stadt-wandleth') === $quellenWandlethVorW, 'W2: und NICHT an Wandleth');
assert((string) $pdoI->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $w2)->fetchColumn() === avesmapsGaretienNurQuelleVermerk('stadt-rallerfurt'),
    'W2: der Vermerk nennt die gewaehlte Siedlung');
$pruefungen += 3;

// --- W3. 💣 Die gewaehlte Siedlung liegt NICHT (mehr) auf der Karte: lauter Abbruch, keine andere.
foreach ([
    'Tempel am Abriss' => ['innerorts' => true, 'innerorts_public_id' => 'stadt-abgerissen'],
    'Quelle am Abriss' => ['innerorts' => true, 'innerorts_nur_quelle' => true, 'innerorts_public_id' => 'stadt-abgerissen'],
] as $nameW3 => $rumpfW3) {
    avesmapsSyncPlanAddItem($pdoI, $laufI, $baueBauwerk($nameW3, $befundWandleth));
    $w3 = $itemIdVon($pdoI, $nameW3 . ' (Probe)');
    $eW3 = avesmapsGaretienUebernehmen($pdoI, $laufI, [$w3], ['id' => 7], null, [$w3 => $rumpfW3]);
    assert(count($eW3['fehler']) === 1 && str_contains($eW3['fehler'][0]['grund'], 'Abgerissen')
        && str_contains($eW3['fehler'][0]['grund'], 'keine andere'),
        'W3 (' . $nameW3 . '): der Grund nennt die gewaehlte Siedlung und sagt, dass nicht ausgewichen wird: '
        . json_encode($eW3['fehler'], JSON_UNESCAPED_UNICODE));
    assert($pdoI->query('SELECT apply_state FROM sync_plan_item WHERE id = ' . $w3)->fetchColumn() === 'failed',
        'W3 (' . $nameW3 . '): das Item steht auf failed');
    assert($staetteVon($nameW3) === false, 'W3 (' . $nameW3 . '): KEINE Staette -- auch nicht in Wandleth');
    assert($quellenAn('stadt-abgerissen') === 0 && $quellenAn('stadt-wandleth') === $quellenWandlethVorW,
        'W3 (' . $nameW3 . '): und keine Quelle, weder an der gewaehlten noch an der Vorauswahl');
    $pruefungen += 4;
}

// --- W4. Ein Bauwerk ist keine Siedlung -- auch nicht, wenn es ausdruecklich gewaehlt wurde.
avesmapsSyncPlanAddItem($pdoI, $laufI, $baueBauwerk('Turmkapelle', $befundWandleth));
$w4 = $itemIdVon($pdoI, 'Turmkapelle (Probe)');
$eW4 = avesmapsGaretienUebernehmen($pdoI, $laufI, [$w4], ['id' => 7], null, [
    $w4 => ['innerorts' => true, 'innerorts_public_id' => 'geb-wachturm'],
]);
assert(count($eW4['fehler']) === 1 && str_contains($eW4['fehler'][0]['grund'], 'Bauwerk') && $staetteVon('Turmkapelle') === false,
    'W4: ein Bauwerk als Wirt wird laut abgewiesen: ' . json_encode($eW4['fehler'], JSON_UNESCAPED_UNICODE));
$pruefungen++;

// --- W5. BESTAND: ohne `innerorts_public_id` (alter Client) gilt weiter die Vorauswahl des Laufs.
avesmapsSyncPlanAddItem($pdoI, $laufI, $baueBauwerk('Wandlether Tsatempel', $befundWandleth));
$w5 = $itemIdVon($pdoI, 'Wandlether Tsatempel (Probe)');
$eW5 = avesmapsGaretienUebernehmen($pdoI, $laufI, [$w5], ['id' => 7], ['innerorts' => true]);
$sW5 = $staetteVon('Wandlether Tsatempel');
assert($eW5['fehler'] === [] && $sW5 !== false && $sW5['settlement_public_id'] === 'stadt-wandleth',
    'W5: ohne Wahl entsteht die Staette wie bisher in der Vorauswahl: ' . json_encode([$eW5['fehler'], $sW5], JSON_UNESCAPED_UNICODE));
$pruefungen++;
```

**1c. Fremder Test umgedreht:** in `api/_internal/import/__tests__/garetien-innerorts-test.php`, Abschnitt G (~:341–357), den Block von `require_once __DIR__ . '/../garetien-uebernahme.php';` bis einschließlich `$pruefungen += 5;` ersetzen. Alt nagelt den stillen Rückfall fest:

```php
assert((avesmapsGaretienInnerortsAusVorschlag($nachMitListe, ['innerorts_public_id' => 'stadt-erfunden'])['public_id'] ?? null) === 'stadt-wandleth',
    '💣 eine Stadt, die NICHT in den Kandidaten steht, faellt auf die Vorauswahl zurueck -- nie durch');
```

Neu (der ganze Block):

```php
require_once __DIR__ . '/../garetien-uebernahme.php';
$nachMitListe = $rondraNach;
// 🔴 UMBAU 14.09.2026 (Entwurf 2026-09-14-garetien-import-vereint-design.md §5): die Wahl wird nicht
// mehr gegen `kandidaten` des LAUFS geprueft, sondern gegen die KARTE. Bis dahin fiel eine gewaehlte
// Siedlung, die der Umkreis-Spinner erst nach dem Planbau gefunden hatte, STILL auf die Vorauswahl
// zurueck -- die Zielwahl sagte „Staette in Rallerfurt", angelegt wurde sie woanders.
// avesmapsGaretienInnerortsAusVorschlag ist seither NUR die Vorauswahl des Laufs.
assert((avesmapsGaretienInnerortsAusVorschlag($nachMitListe)['public_id'] ?? null) === 'stadt-wandleth',
    'ohne Wahl gilt die Vorauswahl -- wie vor dem 07.09.2026');
assert(avesmapsGaretienInnerortsAusVorschlag(['innerorts' => []]) === null, 'und ohne Befund gibt es keine');
assert((avesmapsGaretienInnerortsSiedlung($pdo, $nachMitListe, ['innerorts_public_id' => 'dorf-aue'], 'Wandlether Rondratempel')['name'] ?? null) === 'Aue',
    'eine Wahl aus der Liste gilt: der Editor entscheidet sich fuer das naehere Dorf');
assert((avesmapsGaretienInnerortsSiedlung($pdo, $nachMitListe, ['innerorts_public_id' => 'stadt-neuling'], 'Wandlether Rondratempel')['name'] ?? null) === 'Neuling',
    '🔴 eine Wahl AUSSERHALB der Kandidaten des Laufs gilt, wenn die Siedlung aktiv auf der Karte liegt (Umkreis-Spinner, frischer Nachschlag)');
$ohneListe = ['innerorts' => ['public_id' => 'stadt-wandleth', 'name' => 'Wandleth', 'meilen' => 0.09]];
assert((avesmapsGaretienInnerortsSiedlung($pdo, $ohneListe, ['innerorts_public_id' => 'dorf-aue'], 'Tempel')['public_id'] ?? null) === 'dorf-aue',
    'auch an einem Lauf VOR dem 07.09.2026 (ohne `kandidaten`) gilt die ausdrueckliche Wahl');
assert((avesmapsGaretienInnerortsSiedlung($pdo, ['innerorts' => []], ['innerorts_public_id' => 'dorf-aue'], 'Tempel')['public_id'] ?? null) === 'dorf-aue',
    'und ohne jeden Befund des Planbaus ebenso -- genau der Fall des Umkreis-Spinners');
assert((avesmapsGaretienInnerortsSiedlung($pdo, $nachMitListe, ['innerorts' => true], 'Tempel')['public_id'] ?? null) === 'stadt-wandleth',
    'BESTAND: ohne `innerorts_public_id` bleibt die Vorauswahl des Laufs');
// 💣 DER RIEGEL WIRFT, ER WEICHT NIE AUS. Ohne ihn bände ein beliebiger Anfragerumpf eine Staette an
// eine beliebige public_id; mit Rueckfall landete sie still in einer Siedlung, die niemand gewaehlt hat.
$wirft = static function (callable $f): string {
    try {
        $f();
    } catch (RuntimeException $e) {
        return $e->getMessage();
    }

    return '';
};
$grundErfunden = $wirft(static fn() => avesmapsGaretienInnerortsSiedlung($pdo, $nachMitListe, ['innerorts_public_id' => 'stadt-erfunden'], 'Wandlether Rondratempel'));
assert(str_contains($grundErfunden, 'nicht') && str_contains($grundErfunden, 'Wandlether Rondratempel'),
    '💣 eine Siedlung, die es nicht gibt, bricht LAUT ab -- kein Rueckfall auf die Vorauswahl: ' . $grundErfunden);
$grundBauwerk = $wirft(static fn() => avesmapsGaretienInnerortsSiedlung($pdo, $nachMitListe, ['innerorts_public_id' => 'geb-rahja'], 'Wandlether Rondratempel'));
assert(str_contains($grundBauwerk, 'Bauwerk'),
    '🔴 ein Bauwerk ist kein Wirt -- dieselbe Regel wie avesmapsGaretienSiedlungsFamilie: ' . $grundBauwerk);
$grundOhneBefund = $wirft(static fn() => avesmapsGaretienInnerortsSiedlung($pdo, ['innerorts' => []], ['innerorts' => true], 'Tempel'));
assert(str_contains($grundOhneBefund, 'Innerorts-Befund'), 'ohne Wahl und ohne Befund: der bisherige Grund: ' . $grundOhneBefund);
$pruefungen += 11;
```

(`$pdo` ist der Prüfstand aus Abschnitt C; `dorf-aue`, `stadt-neuling` und `geb-rahja` liegen dort bereits in `map_features`.)

- [ ] **Schritt 2: Tests fahren, Fehlschlag sehen**

```bash
P="php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll"
$P api/_internal/import/__tests__/garetien-beides-riegel-test.php
$P api/_internal/import/__tests__/garetien-uebernahme-test.php
$P api/_internal/import/__tests__/garetien-innerorts-test.php
```
Erwartet (gesehen): `PHP Fatal error:  Uncaught Error: Call to undefined function avesmapsGaretienBeidesRiegel()` · `PHP Fatal error:  Uncaught AssertionError: 🔴 NQ: es wird NICHTS angelegt -- „N Objekte importiert" waere eine Falschaussage: 1` (heute legt `innerorts` eine Stätte an und zählt sie) · `PHP Fatal error:  Uncaught Error: Call to undefined function avesmapsGaretienInnerortsSiedlung()`.

- [ ] **Schritt 3: Umsetzen**

**3a.** In `api/_internal/import/garetien-uebernahme.php` die Funktion `avesmapsGaretienInnerortsGewuenscht` ersetzen und die neuen Funktionen direkt dahinter setzen — alt:

```php
function avesmapsGaretienInnerortsGewuenscht(?array $einstellungen): bool
{
    // 🔴 NUR AUF AUSDRUECKLICHEN WUNSCH. „Alle angezeigten einfuegen" schickt gar keine
    // Einstellungen -- ein Sammellauf legt also NIE eine Staette an, sondern immer das, was er
    // bisher angelegt hat. Der Knopf „Innerorts einfuegen (X)" ist eine Einzelhandlung, und das
    // ist der Owner-Entscheid: der Importer schlaegt vor, er entscheidet nicht.
    return is_array($einstellungen) && ($einstellungen['innerorts'] ?? false) === true;
}
```

neu:

```php
function avesmapsGaretienInnerortsGewuenscht(?array $einstellungen): bool
{
    // 🔴 NUR AUF AUSDRUECKLICHEN WUNSCH. „Alle angezeigten einfuegen" schickt gar keine
    // Einstellungen -- ein Sammellauf legt also NIE eine Staette an, sondern immer das, was er
    // bisher angelegt hat. Der Knopf „Innerorts einfuegen (X)" ist eine Einzelhandlung, und das
    // ist der Owner-Entscheid: der Importer schlaegt vor, er entscheidet nicht.
    // 🔴 „NUR QUELLE + ARTIKEL AN X" IST EBENFALLS EIN INNERORTS-WUNSCH (Entwurf 14.09.2026, §5).
    // Stuende `innerorts_nur_quelle` allein im Rumpf und zaehlte hier nicht, fiele das Objekt still
    // auf die KARTE zurueck -- genau der Rueckfall, den der Innerorts-Zweig ausdruecklich verbietet.
    return is_array($einstellungen)
        && (($einstellungen['innerorts'] ?? false) === true || ($einstellungen['innerorts_nur_quelle'] ?? false) === true);
}

/**
 * Soll der Innerorts-Befund NUR Quelle und Artikel an die Siedlung haengen -- ohne Staette? REIN.
 *
 * 🔴 Die kleinere Antwort auf denselben Befund (Workflow-Owner 12.09.2026/7): keine neue Zeile,
 * weder in `settlement_place` noch in `map_features`. ⚠️ Nur ein echtes `true` zaehlt.
 */
function avesmapsGaretienInnerortsNurQuelle(?array $einstellungen): bool
{
    return is_array($einstellungen) && ($einstellungen['innerorts_nur_quelle'] ?? false) === true;
}

/**
 * Der Vermerk eines „Nur Quelle"-Items. 💣 NIE DIE NACKTE public_id DER SIEDLUNG: die Ruecknahme
 * eines 'new'-Items mit Ziel `location` loescht die public_id aus dem Vermerk ueber
 * avesmapsDeleteMapFeature -- sie naehme die STADT von der Karte, an die nur eine Quelle gehaengt
 * wurde. Das Praefix macht den Vermerk fuer jeden Loeschweg unverwechselbar.
 * ⚠️ avesmapsGaretienVermerkLesen liest ihn als „kein Verbund, keine Region" (unbekanntes Feld) --
 * der Artikel-Nachzug und der Verbund-Leser gehen damit an ihm vorbei, wie gewollt.
 */
const AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK = 'nur_quelle:';

function avesmapsGaretienNurQuelleVermerk(string $siedlungPublicId): string
{
    return AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK . $siedlungPublicId;
}

/** Die Siedlung aus einem „Nur Quelle"-Vermerk, sonst ''. REIN. */
function avesmapsGaretienNurQuelleAusVermerk(string $note): string
{
    $n = trim($note);

    return str_starts_with($n, AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK)
        ? trim(substr($n, strlen(AVESMAPS_GARETIEN_NUR_QUELLE_VERMERK)))
        : '';
}

/**
 * Ein Ort der Karte, so wie er JETZT dasteht -- oder null, wenn es ihn nicht gibt.
 *
 * 💣 Der Innerorts-Befund ist ein SCHNAPPSCHUSS des Planbaus. Eine seither geloeschte Stadt bekaeme
 * sonst eine Staette oder eine Verknuepfung, die kein Leser je findet -- und die Quelle mit ihrer
 * Lizenzangabe waere verloren, ohne dass es jemand merkt.
 * ⚠️ Gelesen wird OHNE `is_active`-Filter: ein geloeschter Ort soll im Abbruchgrund beim NAMEN
 * genannt werden, nicht als nackte public_id.
 *
 * @return ?array{name:string, klasse:string, aktiv:bool}
 */
function avesmapsGaretienSiedlungLesen(PDO $pdo, string $publicId): ?array
{
    $stmt = $pdo->prepare(
        "SELECT name, feature_subtype, is_active FROM map_features WHERE public_id = :p AND feature_type = 'location' LIMIT 1"
    );
    $stmt->execute([':p' => $publicId]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($zeile)) {
        return null;
    }

    return [
        'name' => (string) ($zeile['name'] ?? ''),
        'klasse' => (string) ($zeile['feature_subtype'] ?? ''),
        'aktiv' => (int) ($zeile['is_active'] ?? 0) === 1,
    ];
}

/**
 * Die Garetien-Verknuepfung EINER Adresse an EINEM Objekt loesen -- nicht alle des Objekts.
 *
 * 🔴 AN EINER SIEDLUNG HAENGEN MEHRERE GARETIEN-QUELLEN: ihre eigene und die jedes Bauwerks, das
 * „Nur Quelle + Artikel" an sie gehaengt hat. avesmapsGaretienQuelleRuecknahmeLoesen loest ALLE mit
 * `origin = 'garetien'` -- die Ruecknahme EINES Tempels naehme der Stadt so ihre eigene Quelle und
 * die aller anderen Tempel (dieselbe Klasse wie Fehler 9 des Entwurfs vom 14.09.2026).
 * ⚠️ Verglichen wird ueber `url_hash` (avesmapsFeatureSourceHash), dieselbe Kennung, unter der der
 * Katalog die Adresse beim Anlegen abgelegt hat. NUR die Verknuepfung faellt, nie die `sources`-Zeile.
 *
 * @return int Zahl der geloesten Verknuepfungen
 */
function avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse(PDO $pdo, string $entityType, string $entityPublicId, string $url, int $userId): int
{
    $url = trim($url);
    if ($url === '') {
        return 0;
    }
    avesmapsEnsureFeatureSourceTables($pdo);

    $stmt = $pdo->prepare(
        'SELECT fs.source_id FROM feature_sources fs JOIN sources s ON s.id = fs.source_id'
        . ' WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.origin = :o AND s.url_hash = :h'
    );
    $stmt->execute([
        't' => $entityType,
        'id' => $entityPublicId,
        'o' => AVESMAPS_GARETIEN_SOURCE_ORIGIN,
        'h' => avesmapsFeatureSourceHash($url),
    ]);

    $geloest = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $sourceId) {
        avesmapsRemoveFeatureSource($pdo, $entityType, $entityPublicId, (int) $sourceId, $userId);
        $geloest++;
    }

    return $geloest;
}

/**
 * DER RIEGEL „BEIDES" -- REIN (Entwurf 2026-09-14-garetien-import-vereint-design.md §5).
 *
 * 💣 Ein `apply` mit einem Neu-Item (`change_type = 'new'`, auch das Zusatz-Item „trotzdem neu") UND
 * einem Ergaenzungs-Item (`changed`) DESSELBEN Objekts legt eine Dublette an UND haengt die
 * Garetien-Quelle an den Bestand (K6: „Neu einfuegen" schaltete `quelle` zwangsweise mit an). Das ist
 * nur als ausdrueckliche Wahl „Auf die Karte -- zusaetzlich zu X" erlaubt, und die steht als
 * `beides: true` im Rumpf JEDES beteiligten Items.
 * ⚠️ Ohne die Ausnahme wiese der Riegel genau die Wahl ab, die ihn braucht.
 * 🔴 „Dasselbe Objekt" ist die Objektbasis (avesmapsGaretienObjektSchluessel) -- dieselbe Formel, an
 * der Arbeitsliste und Rueckfall-Suche ein Objekt erkennen, keine zweite.
 * ⚠️ Nur ein echtes `true` bestaetigt: "true" oder 1 kommen nicht aus der Zielwahl.
 *
 * @param list<array{id:int|string, entity_key:string, change_type:string, label?:string}> $items
 * @param array<int, array> $jeItem die Handeingaben je Item (avesmapsGaretienEinstellungenJeItemAusRumpf)
 * @return ?string der Grund der Absage, oder null
 */
function avesmapsGaretienBeidesRiegel(array $items, array $jeItem): ?string
{
    $jeBasis = [];
    foreach ($items as $item) {
        $basis = avesmapsGaretienObjektSchluessel((string) ($item['entity_key'] ?? ''));
        $jeBasis[$basis]['arten'][(string) ($item['change_type'] ?? '')] = true;
        $jeBasis[$basis]['ids'][] = (int) ($item['id'] ?? 0);
        if (!isset($jeBasis[$basis]['label'])) {
            $jeBasis[$basis]['label'] = (string) ($item['label'] ?? '');
        }
    }
    foreach ($jeBasis as $basis => $gruppe) {
        if (!isset($gruppe['arten']['new'], $gruppe['arten']['changed'])) {
            continue;
        }
        foreach ($gruppe['ids'] as $id) {
            if ((($jeItem[$id] ?? [])['beides'] ?? null) === true) {
                continue;
            }
            $name = avesmapsGaretienAnzeigeNameAusSchluessel((string) $basis);
            if ($name === '') {
                $name = $gruppe['label'] !== '' ? $gruppe['label'] : (string) $basis;
            }

            return 'Fuer "' . $name . '" stehen ein neues Objekt UND eine Quelle am bestehenden im selben Import'
                . ' -- das braucht die ausdrueckliche Wahl "Auf die Karte -- zusaetzlich" (beides).';
        }
    }

    return null;
}

/**
 * Der Riegel „beides" an der Tuer: die Zeilen dieses Laufs selbst lesen, dann rein pruefen.
 *
 * 🔴 GEZAEHLT WIRD NUR, WAS DIESES `apply` SCHREIBEN WUERDE -- dieselbe Menge wie
 * avesmapsGaretienPendingItemsScoped (`selected = 1 AND apply_state IS NULL`). Eine ABGELEHNTE Zeile
 * (die Tuer 'decline' hakt sie ab) bleibt abgelehnt und macht kein Paar; ein in einem frueheren
 * Haeppchen schon uebernommenes Item ebenso wenig.
 * 💣 Gefiltert wird auf den LAUF -- eine fremde id koennte sonst ein Paar vortaeuschen.
 * ⚠️ KEIN DDL: die Tuer hat den Lauf gerade gelesen, die Tabelle steht.
 *
 * @param list<int> $itemIds
 * @param ?array<int, array> $jeItem
 */
function avesmapsGaretienBeidesPruefen(PDO $pdo, int $runId, array $itemIds, ?array $jeItem): ?string
{
    $itemIds = array_values(array_unique(array_filter(
        array_map('intval', $itemIds),
        static fn(int $id): bool => $id > 0
    )));
    if ($runId <= 0 || $itemIds === []) {
        return null;
    }
    $platzhalter = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt = $pdo->prepare(
        'SELECT id, entity_key, change_type, label FROM sync_plan_item'
        . ' WHERE run_id = ? AND id IN (' . $platzhalter . ') AND selected = 1 AND apply_state IS NULL'
    );
    $stmt->execute(array_merge([$runId], $itemIds));

    return avesmapsGaretienBeidesRiegel($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [], $jeItem ?? []);
}
```

**3b.** In derselben Datei die Funktion `avesmapsGaretienInnerortsAusVorschlag` samt dem Schluss ihres Docblocks ersetzen — alt ab der Docblock-Zeile ` * 🔴 UND SEIT DEM 07.09.2026 DARF DER EDITOR WAEHLEN (Owner: „sind in der Naehe mehrere soll ein` bis zum Ende der Funktion (`return ($publicId !== '' && $name !== '') ? … : null;` und `}`); neu:

```php
 * 🔴 SEIT DEM 14.09.2026 IST DAS NUR NOCH DIE VORAUSWAHL DES LAUFS. Die Wahl des Editors
 * (`innerorts_public_id`) prueft avesmapsGaretienInnerortsSiedlung gegen die KARTE, nicht mehr
 * gegen die `kandidaten` dieses Vorschlags -- siehe die Begruendung dort.
 *
 * @return array{public_id:string, name:string}|null
 */
function avesmapsGaretienInnerortsAusVorschlag(array $nach): ?array
{
    $befund = $nach['innerorts'] ?? null;
    if (!is_array($befund)) {
        return null;
    }

    $publicId = trim((string) ($befund['public_id'] ?? ''));
    $name = trim((string) ($befund['name'] ?? ''));

    return ($publicId !== '' && $name !== '') ? ['public_id' => $publicId, 'name' => $name] : null;
}

/**
 * IN WELCHE SIEDLUNG gehoert die Staette bzw. die Quelle? Die EINE Stelle, die das entscheidet.
 *
 * 🔴 EINE AUSDRUECKLICHE WAHL GILT (Entwurf 2026-09-14-garetien-import-vereint-design.md §5). Steht
 * `innerorts_public_id` im Rumpf, wird GENAU diese Siedlung genommen -- auch wenn sie nicht in den
 * `kandidaten` des Laufs steht. Das ist der Normalfall des Umkreis-Spinners: er findet Siedlungen,
 * die der Planbau (5 Meilen) nie gesehen hat, und die frische Kandidatenliste
 * (avesmapsGaretienInnerortsKandidatenFrisch) kennt Siedlungen, die es beim Planbau noch nicht gab.
 * 💣 BIS ZUM 14.09.2026 FIEL EINE SOLCHE WAHL STILL AUF DIE VORAUSWAHL ZURUECK. Die Zielwahl haette
 * „Staette in Rallerfurt" gezeigt, angelegt worden waere sie in Wandleth -- eine Handlung, die etwas
 * anderes tut, als sie sagt.
 * 💣 GEPRUEFT WIRD SIE TROTZDEM, NUR AN DER KARTE: der Ort muss existieren, AKTIV sein und eine
 * SIEDLUNG (kein Bauwerk, avesmapsIstBauwerksklasse -- dieselbe Regel wie
 * avesmapsGaretienSiedlungsFamilie). Sonst bricht das Item LAUT ab, mit einem Satz, der die Wahl
 * beim Namen nennt -- und es wird NIE eine andere Siedlung genommen.
 * ⚠️ OHNE WAHL (alter Client, Bestand, Sammellauf) gilt die Vorauswahl des Laufs wie bisher. Sie wird
 * nur bei „Nur Quelle" an der Karte geprueft (`$mussAufDerKarteLiegen`): eine Staette legt
 * avesmapsSettlementPlaceAdd seit jeher auch an einer Vorauswahl an, und das bleibt fuer den Bestand
 * so.
 *
 * @return array{public_id:string, name:string}
 * @throws RuntimeException wenn es keine gueltige Siedlung gibt
 */
function avesmapsGaretienInnerortsSiedlung(PDO $pdo, array $nach, ?array $einstellungen, string $label, bool $mussAufDerKarteLiegen = false): array
{
    $gewaehlt = trim((string) ($einstellungen['innerorts_public_id'] ?? ''));
    if ($gewaehlt !== '') {
        $siedlung = avesmapsGaretienSiedlungLesen($pdo, $gewaehlt);
        $genannt = ($siedlung !== null && $siedlung['name'] !== '') ? $siedlung['name'] : $gewaehlt;
        if ($siedlung === null || !$siedlung['aktiv']) {
            throw new RuntimeException(
                'Die gewaehlte Siedlung "' . $genannt . '" fuer "' . $label . '" liegt nicht (mehr) auf der Karte'
                . ' -- es wird keine andere genommen. Die Zielwahl muss neu gesetzt werden.'
            );
        }
        if (avesmapsIstBauwerksklasse($siedlung['klasse'])) {
            throw new RuntimeException(
                'Die gewaehlte Siedlung "' . $genannt . '" fuer "' . $label . '" ist ein Bauwerk, keine Siedlung'
                . ' -- es wird keine andere genommen. Die Zielwahl muss neu gesetzt werden.'
            );
        }

        return ['public_id' => $gewaehlt, 'name' => $siedlung['name']];
    }

    $vorauswahl = avesmapsGaretienInnerortsAusVorschlag($nach);
    if ($vorauswahl === null) {
        throw new RuntimeException(
            'Fuer "' . $label . '" gibt es keinen Innerorts-Befund'
            . ' -- der Vorschlag stammt aus einem Lauf vor dem 02.09.2026 oder es liegt'
            . ' keine Ortschaft innerhalb von '
            . rtrim(rtrim(number_format(AVESMAPS_GARETIEN_INNERORTS_MEILEN, 1, ',', ''), '0'), ',')
            . ' Meilen. Ein "Holen & Rechnen" rechnet den Befund neu.'
        );
    }
    if ($mussAufDerKarteLiegen) {
        $siedlung = avesmapsGaretienSiedlungLesen($pdo, $vorauswahl['public_id']);
        if ($siedlung === null || !$siedlung['aktiv']) {
            throw new RuntimeException(
                'Die Siedlung "' . $vorauswahl['name'] . '" liegt nicht mehr auf der Karte'
                . ' -- die Quelle von "' . $label . '" haette kein Ziel.'
            );
        }
    }

    return $vorauswahl;
}
```

(Die Messwerte und Namen des alten Docblocks darüber — „GELESEN, NICHT GERECHNET", „⚠️ Beides muss da sein" — bleiben stehen.)

**3c.** In `avesmapsGaretienUebernehmen` die Innerorts-Weiche im `try` des Anlegens ersetzen — alt:

```php
            $innerortsOrt = null;
            if (avesmapsGaretienInnerortsGewuenscht($rumpfDesItems)) {
                $innerortsOrt = avesmapsGaretienInnerortsAusVorschlag($nach, $rumpfDesItems);
                if ($innerortsOrt === null) {
                    throw new RuntimeException(
                        'Fuer "' . $item['label'] . '" gibt es keinen Innerorts-Befund'
                        . ' -- der Vorschlag stammt aus einem Lauf vor dem 02.09.2026 oder es liegt'
                        . ' keine Ortschaft innerhalb von '
                        . rtrim(rtrim(number_format(AVESMAPS_GARETIEN_INNERORTS_MEILEN, 1, ',', ''), '0'), ',')
                        . ' Meilen. Ein "Holen & Rechnen" rechnet den Befund neu.'
                    );
                }
            }
```

neu:

```php
            $innerortsOrt = null;
            // 🔴 „NUR QUELLE + ARTIKEL AN X" (Entwurf 14.09.2026, §5): derselbe Befund, die kleinere
            // Antwort -- keine Staette, keine neue Zeile, nur die Quelle an der Siedlung.
            $nurQuelle = false;
            if (avesmapsGaretienInnerortsGewuenscht($rumpfDesItems)) {
                $nurQuelle = avesmapsGaretienInnerortsNurQuelle($rumpfDesItems);
                // 🔴 WELCHE SIEDLUNG, ENTSCHEIDET EINE STELLE (avesmapsGaretienInnerortsSiedlung): die
                // ausdrueckliche Wahl, wenn es eine gibt -- sonst die Vorauswahl des Laufs. Sie WIRFT,
                // statt auf eine andere Siedlung auszuweichen. „Nur Quelle" verlangt zusaetzlich, dass
                // auch die Vorauswahl noch auf der Karte liegt (die Quelle haette sonst kein Ziel).
                $innerortsOrt = avesmapsGaretienInnerortsSiedlung($pdo, $nach, $rumpfDesItems, (string) $item['label'], $nurQuelle);
            }
```

**3d.** Etwas weiter unten — alt:

```php
            $quellePublicId = null;
            if ($innerortsOrt !== null) {
```

neu:

```php
            $quellePublicId = null;
            if ($nurQuelle) {
                // 🔴 „NUR QUELLE + ARTIKEL AN X": die Quelle geht an die SIEDLUNG, ueber dieselbe
                // Weiche wie bei einem Ort (avesmapsGaretienQuellenZiel, `settlement`), und es
                // entsteht KEINE Zeile. Die Siedlung kommt aus DERSELBEN Pruefung wie bei der Staette
                // (avesmapsGaretienInnerortsSiedlung, oben): aktiv auf der Karte, eine Siedlung -- bei
                // „Nur Quelle" auch dann, wenn es die Vorauswahl des Laufs ist.
                [$entityType, $quellePublicId] = avesmapsGaretienQuellenZiel('location', (string) $innerortsOrt['public_id']);
                $publicId = $quellePublicId;
                // 💣 NIE die nackte public_id als Vermerk -- die Ruecknahme loeschte sonst die Stadt.
                $vermerk = avesmapsGaretienNurQuelleVermerk($quellePublicId);
            } elseif ($innerortsOrt !== null) {
```

**3e.** Hinter der Weiche (nach dem Flächen-Zweig) — alt:

```php
            $angelegt++;
            $neueQuellen = avesmapsGaretienQuellenAnlegen(
                $pdo, $entityType, $quellePublicId, $nach, $userId, (string) $item['entity_key']
            );
            if ($neueQuellen > 0) {
```

neu:

```php
            // 🔴 „NUR QUELLE" LEGT NICHTS AN -- es zaehlt wie eine Ergaenzung: als `quelle`, nie als
            // `applied`. „1 Objekt importiert" behauptete sonst ein Kartenobjekt, das es nicht gibt.
            if (!$nurQuelle) {
                $angelegt++;
            }
            $neueQuellen = avesmapsGaretienQuellenAnlegen(
                $pdo, $entityType, $quellePublicId, $nach, $userId, (string) $item['entity_key']
            );
            if ($nurQuelle && $neueQuellen > 0) {
                $jeForm['quelle']++;
            }
            if ($neueQuellen > 0) {
```

(`avesmapsGaretienItemAbschliessen(..., 'done', $vermerk ?? $publicId, $userId)` darunter bleibt unverändert und schreibt den `nur_quelle:`-Vermerk.)

**3f.** In `avesmapsGaretienRuecknahmeAusfuehren`, `new`-Zweig — alt:

```php
            if ($ziel !== 'region' && avesmapsSettlementPlaceExists($pdo, $publicId)) {
                avesmapsSettlementPlaceDeactivate($pdo, $publicId, (int) ($user['id'] ?? 0));
            } elseif ($ziel === 'path' || $ziel === 'location' || $ziel === 'label') {
```

neu:

```php
            // 🔴 „NUR QUELLE + ARTIKEL AN X" ZUERST (Entwurf 14.09.2026, §5). Der Vermerk nennt die
            // SIEDLUNG, an die nur eine Quelle gehaengt wurde -- sie darf von keinem Loeschweg
            // darunter erreicht werden (`location` fuehrte sonst zu avesmapsDeleteMapFeature).
            // 🔴 GELOEST WIRD NUR DER ARTIKEL DIESES OBJEKTS (avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse):
            // an der Stadt haengen auch ihre eigene Quelle und die anderer Bauwerke.
            // ⚠️ Ohne eigenen Artikel hing die Sammelquelle des Wirts -- dieselbe Adresse, die die Stadt
            // selbst tragen kann. Sie bleibt stehen: lieber eine Quelle zu viel als die Lizenzangabe
            // der Stadt genommen.
            $nurQuelleSiedlung = avesmapsGaretienNurQuelleAusVermerk($publicId);
            if ($nurQuelleSiedlung !== '') {
                $artikel = avesmapsGaretienArtikelQuelleAusItem(is_array($nach) ? $nach : [], (string) $item['entity_key']);
                if ($artikel !== null) {
                    [$quellArt, $quellId] = avesmapsGaretienQuellenZiel('location', $nurQuelleSiedlung);
                    avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse($pdo, $quellArt, $quellId, (string) $artikel['url'], (int) ($user['id'] ?? 0));
                    $beruehrt[$quellArt . ':' . $quellId] = ['entity_type' => $quellArt, 'public_id' => $quellId];
                }
            } elseif ($ziel !== 'region' && avesmapsSettlementPlaceExists($pdo, $publicId)) {
                avesmapsSettlementPlaceDeactivate($pdo, $publicId, (int) ($user['id'] ?? 0));
            } elseif ($ziel === 'path' || $ziel === 'location' || $ziel === 'label') {
```

(`$nach` ist in dieser Schleife vor dem `try` bereits dekodiert.)

**3g.** In `api/edit/wiki/sync-plan.php`, `case 'apply':`, Garetien-Block — alt:

```php
                $garetienEinstellungen = avesmapsGaretienEinstellungenAusRumpf($payload);
                $garetienJeItem = avesmapsGaretienEinstellungenJeItemAusRumpf($payload);
            }
```

neu:

```php
                $garetienEinstellungen = avesmapsGaretienEinstellungenAusRumpf($payload);
                $garetienJeItem = avesmapsGaretienEinstellungenJeItemAusRumpf($payload);
                // 🔴 DER RIEGEL „BEIDES" (Entwurf 2026-09-14-garetien-import-vereint-design.md §5).
                // Ein Neu-Item UND ein Ergaenzungs-Item DESSELBEN Objekts in einem `apply` legen eine
                // Dublette an und haengen die Quelle zugleich an den Bestand -- das geschieht nur auf
                // die ausdrueckliche Wahl „Auf die Karte -- zusaetzlich zu X" (`beides: true` an jedem
                // beteiligten Item). Eine Sperre nur im Browser ist keine.
                // ⚠️ VOR der Pipeline-Sperre: eine Absage darf sie nicht halten. Und NACH dem Lesen der
                // Handeingaben, sonst prueft der Riegel gegen null.
                $garetienBeidesGrund = avesmapsGaretienBeidesPruefen($pdo, $runId, $garetienItemIds, $garetienJeItem);
                if ($garetienBeidesGrund !== null) {
                    avesmapsErrorResponse(422, 'garetien_beides_unbestaetigt', $garetienBeidesGrund);
                }
            }
```

(`$pdo` und `$runId` stehen zu diesem Zeitpunkt; der Lauf ist oben bereits als `open` und `kind` geprüft.)

**3h.** In `api/edit/map/garetien-import.php` (Aktion `innerorts_kandidaten`, ~:284–285) den Kommentar nachziehen, der auf den gefallenen Kandidaten-Riegel verweist — alt:

```php
    // schreibt nichts; die Wahl, die daraus folgt, geht durch `apply` und wird DORT noch einmal
    // gegen die Kandidaten des Vorschlags geprueft (avesmapsGaretienInnerortsAusVorschlag).
```

neu:

```php
    // schreibt nichts; die Wahl, die daraus folgt, geht durch `apply` und wird DORT gegen die Karte
    // geprueft (avesmapsGaretienInnerortsSiedlung: aktiv, eine Siedlung, sonst lauter Abbruch).
```

- [ ] **Schritt 4: Tests fahren, grün sehen — und die fremden Tests**

```bash
P="php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll"
for t in garetien-beides-riegel-test garetien-uebernahme-test garetien-innerorts-test garetien-endpunkt-test garetien-einstellungen-je-item-test garetien-liste-test garetien-verbund-uebernahme-test; do $P api/_internal/import/__tests__/$t.php 2>&1 | grep -E "^OK|Fatal" | tail -1; done
node js/review/__tests__/garetien-innerorts-knopf.test.js
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```
Erwartet: `OK: 25 Pruefungen` · `OK: 489 Pruefungen` · `OK: 101 Pruefungen` · `OK: garetien-endpunkt-test` · `OK (29 Pruefungen)` · `OK: 115 Pruefungen` · `OK -- garetien-verbund-quelle-faellt-mit-der-letzten-flaeche (Entwurf 14.09.2026, Fehler 9)`; der JS-Test (erwähnt `avesmapsGaretienInnerortsAusVorschlag` nur in einem Meldungstext) bleibt grün; Dateizahl **408** (Worktree-Stand nach allen vier Aufgaben; maßgeblich ist der eigene Zähllauf); einzige `ROT:`-Zeile `api/_internal/linkcheck/__tests__/link-url-test.php` (vorbestehend, DNS). Der einzige fremde Test, der das alte Verhalten festnagelte, ist `garetien-innerorts-test.php` Abschnitt G (in Schritt 1c umgedreht). JS-Feld (543 Dateien) unberührt grün.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/import/garetien-uebernahme.php
git add api/edit/wiki/sync-plan.php
git add api/edit/map/garetien-import.php
git add api/_internal/import/__tests__/garetien-beides-riegel-test.php
git add api/_internal/import/__tests__/garetien-uebernahme-test.php
git add api/_internal/import/__tests__/garetien-innerorts-test.php
git commit -F- <<'EOF'
feat(garetien): der Server weist Neu + Quelle am Bestand ohne "beides" ab und kennt "Nur Quelle + Artikel"

Ein apply, das fuer dasselbe Objekt ein Neu-Item und ein Ergaenzungs-Item traegt,
legte still eine Dublette an UND haengte die Quelle an den Bestand. Die Tuer
antwortet jetzt 422 garetien_beides_unbestaetigt, ausser jedes beteiligte Item
traegt `beides: true`; gezaehlt wird nur, was dieses apply wirklich schreibt.

`innerorts_nur_quelle` haengt Quelle und Artikel an die Siedlung und legt keine
Staette an; der Vermerk `nur_quelle:<siedlung>` schuetzt die Stadt vor jeder
Ruecknahme. Eine gewaehlte Siedlung gilt jetzt auch ausserhalb der Kandidaten des
Laufs, wenn sie aktiv auf der Karte liegt -- sonst bricht das Item laut ab, statt
still in der Vorauswahl zu landen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---


---

## Aufgabe 9: Zielwahl im Client — eine Wahl statt zwei Häkchen, „Innerorts einfügen“ fällt

**Deckt Entwurf §2 (Einzel-Schreibweg fällt), §5 (die Zielwahl) und die Client-Hälfte von §6.3/§6.4 ab** (Zusammenlegen nur mit „Auf die Karte“; die Wahl stirbt mit „Stage leeren“). Sichtbar — einzeln live, mit Blick des Owners.

💣 **Zwei Namen, die sich nur im „w“ unterscheiden.** `garetienZielWahlZu` (großes W, JS:5218) ist die FORM und liefert `{ziel, subtyp, kind}`; das neue `garetienZielwahlZu` (kleines w) ist das ZIEL und liefert eine Zeichenkette. Beide Namen stehen so im Vertrag. Der Test hält fest, dass es zwei Funktionen mit zwei Rückgabetypen sind; `garetien-verbund-einstellungen.test.js` sucht mit voller Signatur `function garetienZielwahlZu(objekt)`.

💣 **„Auf die Karte“ nimmt bei einem Objekt, das sich deckt, NUR das Zusatz-Item** (`garetienZielKarteItems`) — nie zugleich das Ergänzungs-Item. Das ist der Riegel vom Schadensfall 30.08.2026 (Kommentar an `garetienStageVorhaben`, JS:6235–6250). Beides zusammen gibt es nur über „zusätzlich“.

💣 **Das Ergänzungs-Item bekommt bei „zusätzlich“ NUR `{beides: true}`.** Ein Rumpf mit `ziel` formte über `avesmapsGaretienZielUebersteuern` (PLAN:271) die Geometrie eines BESTEHENDEN Objekts um; ohne `ziel`/`subtyp` kehrt die Funktion unverändert zurück (PLAN:275–277, nachgelesen). `name` reist ebenfalls nie an ein Ergänzungs-Item.

💣 **Die Rückfrage steht in `garetienFussknopfEinfuegenKlick` (JS:9191), nicht in `garetienFussknopfKlick` (JS:9146).** Die Vertragszeile nennt die zweite; die ist die reine Kette ohne `fragen`. „Zusätzlich“ fragt ZUERST, danach die allgemeine Rückfrage; ohne `fragen` wird ein „zusätzlich“ nicht importiert.

🔴 **Die Zielwahl erscheint nur an Objekten mit `stand === "offen"`, die auf der Stage liegen** (`garetienZielwahlMarkup`, `garetienZielNameZeile`). Übernommene und abgelehnte Objekte zeigen weiter Anzeige/Rücknahme bzw. „Wieder vorschlagen“ — je eine Bestands-Fixture im Test (Abschnitt I).

⚠️ **„Stätte in X“ hängt an der GEWÄHLTEN Form** (`garetienInnerortsMoeglich`, JS:5073: Ort + Bauwerksklasse) und an mindestens einer Siedlung. Stellt jemand danach die Form um, zählt die stehengebliebene Wahl nicht mehr — `garetienZielwahlZu` prüft die Möglichkeit bei jedem Lesen, nicht nur beim Zeichnen.

⚠️ **„— auf die Karte —“ fällt aus dem Siedlungsfeld** (`garetienInnerortsZeileMarkup`, JS:5183). Das Feld wählt nur noch WELCHE Siedlung, ist abgeblendet, solange weder „Stätte“ noch „Nur Quelle + Artikel“ gewählt ist, und steht mitsamt Umkreis-Spinner unter der Zielwahl. Aus „Eingefügt wird“ verschwindet es — zweimal gezeichnet trügen zwei Felder dieselbe `id`.

⚠️ **Übergangsort bis Aufgabe 11:** die Zielwahl und das Namensfeld stehen in der Handlungsleiste (`garetienHandlungsMarkup`, JS:7145), genau wo die Häkchen standen; Form/Art bleiben in „Eingefügt wird“ und werden abgeblendet (`gi-insert__row--aus` + `disabled` + Grund). Die Gestalt der Zielwahl kommt in DIESER Aufgabe (Schritt 3i): die Regeln `.gi-ziel*` und `.gi-insert__row--aus` zeichengleich aus dem Mockup, gebunden durch einen Vertragsblock. Solange die Liste in der umbrechenden flex-Zeile `.gi-acts` steht, braucht sie zusätzlich `.gi-acts > .gi-ziel { flex: 1 0 100%; }` — außerhalb des Vertrags; Aufgabe 11 entfernt sie beim Umzug in Block C.

🔴 **Das Namensfeld (`data-gi-feld="einfuegeName"`) wird NICHT an einer neuen Stelle angelegt — es bleibt bis Aufgabe 11 in der Handlungsleiste.** Heute baut es `garetienEinfuegeHakenMarkup` (JS:6851, Namenszeile :6870) als erste Zeile über den zwei Häkchen; die Leiste steht in `garetienDetailMarkup` über „Eingefügt wird“ (JS:5982). Mit den Häkchen fällt die Funktion. Ihre Namenszeile heißt jetzt `garetienZielNameZeile` — dieselbe `garetienEingefuegtWirdTextZeile(o, "Name", "einfuegeName", garetienNameFuerImport(o), …)` — und hat genau einen Aufrufer: die Rückgabe von `garetienHandlungsMarkup`, an der Stelle von `garetienEinfuegeHakenMarkup(objekt)`, direkt unter der Zielwahl und über `.gi-acts__knoepfe`. Gezählt am gebauten Modul über `garetienDetailMarkup`, acht Lagen: auf der Stage genau **ein** Feld, in der Leiste unter der Zielwahl — bedienbar bei „Auf die Karte“, „Stätte“ und „zusätzlich“, abgeblendet und gesperrt bei einer Ergänzung —; ohne Vorschlag, auf „Offen“, übernommen und abgelehnt **keins**. ⚠️ Aufgabe 11 (Schritt 3e) ersetzt diese Rückgabe samt `garetienZielwahlMarkup(objekt) + garetienZielNameZeile(objekt)` durch Block F und legt das Feld in `garetienIdentitaetMarkup` (Block C) an. Bleibt der Aufruf stehen, stehen Zielwahl und Name zweimal da.

💣 **Kontrast der zweiten Zeile — im Mockup korrigiert, bevor gebunden wurde (14.09.2026).** Die erste Fassung (Wäsche beim Überfahren und Wählen, zweite Zeile gedämpft) erreichte im dunklen Thema AA nicht: überfahren 3,98:1, gewählt 3,07:1 (Warnzeile 4,40:1) — Soll 4,5:1 bei 11px. Jetzt: überfahren nur ein Rahmen `--color-border-strong`, die gewählte Option nimmt in der zweiten Zeile `--color-text` — gerechnet gewählt hell 11,9:1, dunkel 5,8:1; ungewählt und überfahren hell 5,6–6,6:1, dunkel 5,8–8,3:1. Die Regeln stehen so zeichengleich im Mockup; Schritt 4k misst im Browser nach. ⚠️ Der Rahmen `--color-accent` der gewählten Option hat hell nur 2,49:1 gegen das Panel (Nicht-Text) — die Auswahl tragen Radiopunkt und Wäsche; er bleibt, weil `.avm-row.is-selected` im Haus dieselbe Farbe trägt.

🔴 **Nachträge an Aufgabe 6** (Schritt 3h): `garetienVerbundZusammenlegbar` prüft zuerst die Zielwahl an JEDEM aufgelegten Mitglied; `garetienEinstellungenVergessen` ruft `garetienZielwahlVergessen` statt des gefallenen `garetienEinfuegeWahlVergessen`; in den zwei Speicherlisten (`garetienVerbundEinstellungenVergessen`, `garetienVerbundVergessen`) ersetzt `_garetienZielwahl` das gefallene `_garetienEinfuegeWahl` — sonst wirft das erste „Stage leeren“ einen `ReferenceError`.

💣 **`zustand.stage` hält seit Aufgabe 6 Einträge `{objekt, zusammen}`.** Keine Zeile dieser Aufgabe liest `zustand.stage` direkt; gelesen wird über `avesmapsGaretienStageHat`, `avesmapsGaretienStageListe` (liefert die Objekte) und in Schritt 3h über `garetienVerbundStageEintraege` (liefert die Einträge).

**Bestand:** Keine Migration, nichts Gespeichertes — die Zielwahl ist Sitzungszustand im Browser wie die Häkchen vorher. Ein Lauf vor dem 28.08.2026 trägt kein `change_type` je Item: dort steht nur „Nichts — nur ansehen“ zur Wahl (vorher fehlten die Häkchen bzw. waren gesperrt — dieselbe sichere Richtung). Ein Lauf vor dem 07.09.2026 trägt einen Innerorts-Befund ohne `kandidaten`: „Stätte“ geht dann über die Vorauswahl (`garetienInnerortsKandidatenVon`, unverändert). Ergänzungs-Items ohne `abschnitt` ergeben „Quelle am bestehenden Objekt ergänzen“ statt eines Namens. ⚠️ **Uneinheitlich wird:** an ÜBERNOMMENEN Bauwerken fällt die gesperrte Zeile „Innerorts — auf die Karte —“ ersatzlos weg; wo das Objekt liegt, sagt weiter der Satz „Liegt als Stätte in …“ bzw. „Liegt bereits auf der Karte“ (`garetienEingefuegtWirdUebernommenHinweis`, unverändert).

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` — Häkchen-Block → Zielwahl (`_garetienEinfuegeWahl` ~:6272 bis `garetienStageItems` ~:6380), `garetienStageZeile2` ~:6811 + `garetienEinfuegeHakenMarkup` ~:6851, `garetienHandlungen` ~:6942, `garetienHandlungsMarkup` ~:7217, `garetienEingabenAendern` ~:4095, `garetienEingabenFuerServer` ~:4232, `garetienEingabenFuerServerOhneName` ~:4247, `garetienInnerortsZiel` ~:5153, `garetienInnerortsZeileMarkup` ~:5183, `garetienZielWahlMarkup` ~:5282, `garetienEingefuegtWirdMarkup` ~:5321/5345, `garetienEingefuegtWirdTextZeile` ~:3842, Handlungs-Tafeln ~:6087/6126/6396/6511/6561/6603, `garetienNeuKlick` ~:7894 (fällt), Verdrahtung ~:9382, `garetienFussknopfEinfuegenKlick` ~:9191, `garetienStageEinstellungenJeItem` ~:8775, `module.exports` ~:9861/9908/9917
- Ändern: `css/components/garetien-importer.css` — Vertragsblock der Zielwahl HINTER `.gi-insert__row` (:981) und VOR „Aufgabe 15: die Handlungsleiste“ (:1259), eingesetzt vor „Eingefügt wird -> Eingabefelder“ (:996); dahinter die Übergangsregel `.gi-acts > .gi-ziel`
- Ändern: `docs/garetien-import-vereint-mockup.html` — die Kopfkommentare :22–23 und :402–403, die Vertragsmarken um die Zielwahl-Regeln (:420–434)
- Test (unverändert, bindet mit): `tools/mockup-vertrag/__tests__/mockup-vertrag.test.js` (der neue Block) · `js/review/__tests__/garetien-handlungen.test.js` Abschnitt J (die Stelle des Blocks)
- Test (neu): `js/review/__tests__/garetien-zielwahl-ziele.test.js`
- Test (gelöscht, ersetzt): `js/review/__tests__/garetien-einfuege-haken.test.js`
- Tests (nachgezogen): `garetien-innerorts-knopf.test.js`, `garetien-vorwaertsknopf.test.js`, `garetien-name-aendern.test.js`, `garetien-verbund-einstellungen.test.js`, `garetien-zusatz-auf-die-stage.test.js`, `garetien-import-verdrahtung.test.js`, `garetien-stage-nachschlagen.test.js`, `garetien-handlungen.test.js` (nur ein Kommentar) — alle unter `js/review/__tests__/`

**Schnittstellen:**
- Nutzt:
  - `garetienEinstellungsSchluessel(objekt): string` (JS:1519; ab Aufgabe 6 mit dem Verbund am Stage-Eintrag)
  - `garetienVerbundZusammenlegbar(objekt): {ok: boolean, grund: string}` (Aufgabe 6; Wege über `AVESMAPS_GARETIEN_VERBUND_WEGE_FREI`)
  - `garetienVerbundStageEintraege(schluessel): {objekt, zusammen}[]` (Aufgabe 6)
  - `garetienEinstellungenVergessen(): void` (Aufgabe 6; gerufen von `avesmapsGaretienStageLeeren()` und am Laufbeginn)
  - `avesmapsGaretienStageListe(): Objekt[]` (Aufgabe 6: die Objekte der Einträge)
  - `garetienUebernahmeKnopfZustand(stageObjekte): {anzahl, gesamt, zusammenfassung, beschriftung, gesperrt, hinweis}` (Aufgabe 7; `anzahl` = Zeilen — der Test liest nur `anzahl` und `gesperrt`)
  - `garetienStageZusammenfassung(stageObjekte)` (Aufgabe 7) zählt über `garetienStageItems` — „Stätte“ zählt damit, „Nichts“ nicht
  - `garetienEinfuegenRueckfrageText(zusammenfassung): string` (Aufgabe 7) — die zweite Frage, `fragen(garetienEinfuegenRueckfrageText(stand.zusammenfassung))`
  - Server (Aufgabe 8): `einstellungen_je_item[id].beides === true`, `.innerorts_nur_quelle === true`; 422 `garetien_beides_unbestaetigt`
  - unverändert: `garetienHakenItems`, `garetienItemIstZusatz`, `garetienItemAnlass`, `garetienInnerortsMoeglich`, `garetienInnerortsKandidatenVon`, `garetienInnerortsWahlZu`, `garetienEingabeId`, `garetienNameFuerImport`, `garetienUnserBeschriftung`, `AVESMAPS_GARETIEN_FORMEN`, `AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG.neu`
- Liefert:
  - `const AVESMAPS_GARETIEN_ZIELE = ["karte", "staette", "nur_quelle", "ergaenzen", "zusaetzlich", "nichts"]`
  - `garetienZieleMoeglich(objekt): string[]` — Vorbelegung zuerst, dann Reihenfolge der Konstante
  - `garetienZielwahlZu(objekt): string` · `garetienZielwahlSetzen(objekt, wert): void` · `garetienZielwahlVergessen(): void`
  - `garetienZielwahlMarkup(objekt): string` — `.gi-ziel` + Siedlung/Umkreis; `""` außer bei `stand === "offen"` auf der Stage
  - `garetienZielwahlTexte(objekt, wert): {t1: string, t2: string, warn: boolean}` (Aufgabe 10 und 11 lesen `t1`)
  - `garetienZielwahlAusGrund(objekt): string` — `""` für „karte“/„zusaetzlich“, sonst der Abblend-Grund
  - `garetienZielNameZeile(objekt): string` · `garetienZielKarteItems(objekt): Item[]` · `garetienErgaenzungZiel(objekt): {name: string, abschnitte: number}`
  - `garetienStageItems(objekt): Item[]` · `garetienStageZeile2(objekt, aufDerStage): string` (neue Texte; `aufDerStage` ohne Wirkung)
  - `garetienZusaetzlichObjekte(objekte): Objekt[]` · `garetienZusaetzlichRueckfrageText(objekte): string`
  - `garetienZielWahlMarkup(objekt, deaktiviert, ausGrund): string` (dritter Parameter neu) · `garetienEingefuegtWirdTextZeile(…, deaktiviert, aus)` (siebter Parameter neu)
  - fällt: `garetienEinfuegeWahl`, `garetienEinfuegeWahlSetzen`, `garetienEinfuegeWahlVergessen`, `garetienEinfuegeHakenMarkup`, `garetienNeuMoeglich`, `garetienQuelleMoeglich`, `garetienNeuItems`, `garetienNeuKlick` (samt Verdrahtung und den `innerorts`-Einträgen der Handlungs-Tafeln)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben** — neue Datei `js/review/__tests__/garetien-zielwahl-ziele.test.js`:

```js
// Aufgabe 9 des Bauplans „Garetien-Importer vereint" (14.09.2026): die ZIELWAHL im Client.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §5
// Mockup:  docs/garetien-import-vereint-mockup.html, Szenen 3 und 5
//
// 🔴 ERSETZT garetien-einfuege-haken.test.js. Die zwei Häkchen „Als Quelle einfügen" / „Neu
// einfügen" sind Werte EINER Liste geworden; ihre Zusicherungen (Vorbelegung, der Schreibumfang
// folgt der Anzeige, vor der Stage steht nichts) stehen hier gegen die Zielwahl.
//
// 💣 DIE KERNZUSICHERUNG (Abschnitt C): für JEDEN der sechs Zielwerte, welche Item-IDs
// `garetienStageItems` liefert und welcher `einstellungen_je_item`-Rumpf daraus entsteht -- an drei
// Objekten, die die drei Lagen eines Laufs abbilden. GEFAHREN, nicht gelesen: in diesem Vorhaben
// war eine Quelltext-Zusicherung viermal ein Vakuum.
//
// 🔴 BESTAND (Owner 14.09.2026, Abschnitt I): der Importer ist live. Ein übernommenes und ein
// abgelehntes Objekt zeigen weiter, was sie vorher zeigten -- und KEINE Zielwahl.
//
// ⚠️ Abschnitt G und H setzen Aufgabe 6 voraus (`garetienVerbundZusammenlegbar`, die
// `…Vergessen`-Aufrufe in `avesmapsGaretienStageLeeren`).
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-zielwahl-ziele.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, dom } = ladeImporter(["garetien-apply", "garetien-apply-hint", "garetien-listcol", "garetien-sheet"]);

let n = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); n++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); n++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); n++; };

// =================================================================================================
// Die drei Lagen eines Laufs -- jede OHNE `verbund_stamm`/`verbund_n`, so wie jeder Lauf vor dem
// Deploy (Bestand).
// =================================================================================================
// 1. Ein Fluss, der sich mit sechs unserer Abschnitte deckt: sechs Ergänzungs-Items + ein Zusatz-Item
//    (Mockup §5 rechts). ⚠️ Am Item steht nur die `public_id` des Abschnitts -- der Name kommt aus
//    `objekt.abschnitte`, wie in der echten Listenantwort.
function natter() {
	const abschnitte = [];
	const items = [];
	for (let i = 0; i < 6; i++) {
		const abschnitt = { public_id: "Flussweg-44" + i, name: "Natter" };
		abschnitte.push(abschnitt);
		items.push({ id: 11 + i, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"],
			abschnitt: { public_id: abschnitt.public_id } });
	}
	items.push({ id: 17, change_type: "new", anlass: "zusatz", felder: [] });
	return { key: "ggp:Gewaesser:Fluss:Garetien:Natter!Natter", stand: "offen", urteil: "ergaenzung",
		name: "Natter", typ: "Fluss", ziel: "path", subtyp: "Flussweg", kind: "",
		geometrie: [[1, 1], [2, 2]], abschnitte: abschnitte, items: items };
}
// 2. Ein neues Bauwerk mit zwei Siedlungen im Umkreis (Mockup §5 links).
function burg() {
	return { key: "ggp:Bauwerke:Burg:Garetien:Burg Finster!Burg Finster", stand: "offen", urteil: "neu",
		name: "Burg Finster", typ: "Burg", ziel: "location", subtyp: "gebaeude", kind: "",
		geometrie: [[100, 100]], abschnitte: [],
		innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8,
			kandidaten: [
				{ public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8, nennt_name: false },
				{ public_id: "dorf-rallerfurt", name: "Rallerfurt", meilen: 2.1, nennt_name: false },
			] },
		items: [{ id: 21, change_type: "new", anlass: "", felder: ["quelle"] }] };
}
// 3. Ein Objekt ohne jeden Vorschlag.
function perz() {
	return { key: "ggp:Ortschaften:Dorf:Garetien:Perz!Perz", stand: "offen", urteil: "uebersprungen",
		name: "Perz", typ: "Dorf", ziel: "location", subtyp: "dorf", geometrie: [[5, 5]],
		abschnitte: [], items: [] };
}

const ids = (o) => api.garetienStageItems(o).map((i) => i.id).sort((a, b) => a - b);
const jeItem = (o) => api.garetienStageEinstellungenJeItem([o]);
function frisch() {
	api.garetienZielwahlVergessen();
	api.garetienZielWahlVergessen();
	api.garetienInnerortsWahlVergessen();
	api.garetienNameWahlVergessen();
	api.avesmapsGaretienStageLeeren();
}
function feldEreignis(feld, wert) {
	return { target: {
		getAttribute: (name) => (name === "data-gi-feld" ? feld : null),
		hasAttribute: (name) => name === "data-gi-feld",
		value: wert, checked: true, type: feld === "zielwahl" ? "radio" : "select-one",
	} };
}

// =================================================================================================
// A. Die Konstante, die Namen -- und was gefallen ist
// =================================================================================================
tief(api.AVESMAPS_GARETIEN_ZIELE, ["karte", "staette", "nur_quelle", "ergaenzen", "zusaetzlich", "nichts"],
	"die sechs Zielwerte des Vertrags, in dieser Reihenfolge");
frisch();
gleich(typeof api.garetienZielwahlZu(natter()), "string",
	"💣 garetienZielwahlZu (kleines w) ist das ZIEL und liefert eine Zeichenkette");
gleich(typeof api.garetienZielWahlZu(natter()), "object",
	"💣 …garetienZielWahlZu (großes W) bleibt die FORM und liefert ein Objekt -- zwei Funktionen");
["garetienEinfuegeWahl", "garetienEinfuegeWahlSetzen", "garetienEinfuegeWahlVergessen",
	"garetienEinfuegeHakenMarkup", "garetienNeuMoeglich", "garetienQuelleMoeglich", "garetienNeuItems",
	"garetienNeuKlick",
].forEach((name) => gleich(api[name], undefined, "🔴 " + name + " ist gefallen"));

// =================================================================================================
// B. Was zur Wahl steht -- und die Vorbelegung
// =================================================================================================
frisch();
tief(api.garetienZieleMoeglich(natter()), ["ergaenzen", "karte", "zusaetzlich", "nichts"],
	"Natter (deckt sich): die Vorbelegung vorne, wie im Mockup §5 rechts");
tief(api.garetienZieleMoeglich(burg()), ["karte", "staette", "nur_quelle", "nichts"],
	"Burg Finster (Bauwerk, zwei Siedlungen): wie im Mockup §5 links");
tief(api.garetienZieleMoeglich(perz()), ["nichts"],
	"🔴 ohne Vorschlag gibt es nur „Nichts\" -- „Auf die Karte\" täte hier still nichts");
gleich(api.garetienZielwahlZu(natter()), "ergaenzen", "deckt sich -> „Quelle an X ergänzen\"");
gleich(api.garetienZielwahlZu(burg()), "karte",
	"💣 eine gefundene Stadt ist KEINE Vorbelegung -- sonst legte der Import still ~350 Stätten an");
gleich(api.garetienZielwahlZu(perz()), "nichts", "ohne Vorschlag: „Nichts\"");

// 💣 Eine unmögliche Wahl zählt nie.
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "staette");
	gleich(api.garetienZielwahlZu(o), "ergaenzen", "💣 „Stätte\" gibt es beim Fluss nicht -> Vorbelegung");
	const b = burg();
	api.garetienZielwahlSetzen(b, "quatsch");
	gleich(api.garetienZielwahlZu(b), "karte", "ein unbekannter Wert wird verworfen");
	api.garetienZielwahlSetzen(b, "staette");
	gleich(api.garetienZielwahlZu(b), "staette", "Gegenprobe: am Bauwerk hält „Stätte\"");
	const form = api.garetienZielWahlZu(b);
	form.ziel = "region"; form.subtyp = "wald"; form.kind = "vegetation";
	gleich(api.garetienZielwahlZu(b), "karte",
		"💣 mit der Form „Fläche\" gibt es keine Stätte mehr -- die stehengebliebene Wahl zählt nicht");
}

// =================================================================================================
// C. DER KERN -- sechs Zielwerte × drei Lagen: Item-IDs und `einstellungen_je_item`
// =================================================================================================
// ---- karte ----------------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "karte");
	tief(ids(o), [17], "karte · Natter: NUR das Zusatz-Item -- 💣 nie zugleich die sechs Ergänzungen");
	const r = jeItem(o);
	tief(Object.keys(r), ["17"], "karte · Natter: ein Rumpf, am Zusatz-Item: " + JSON.stringify(r));
	gleich(r["17"].ziel, "path", "…mit der gewählten Form");
	gleich(r["17"].subtyp, "Flussweg", "…und Art");
	gleich("beides" in r["17"], false, "🔴 ohne „zusätzlich\" kein `beides`");
	gleich("innerorts" in r["17"], false, "…und kein innerorts");

	const b = burg();
	api.garetienZielwahlSetzen(b, "karte");
	tief(ids(b), [21], "karte · Burg: das Neu-Item");
	const rb = jeItem(b);
	tief(Object.keys(rb), ["21"]);
	gleich(rb["21"].ziel, "location", "karte · Burg: ein Kartenpunkt");
	gleich("innerorts" in rb["21"], false, "💣 eine gefundene Stadt macht aus „Auf die Karte\" keine Stätte");

	const p = perz();
	api.garetienZielwahlSetzen(p, "karte");
	tief(ids(p), [], "karte · Perz: unmöglich -> nichts");
	tief(jeItem(p), {}, "…und kein Rumpf");
}
// ---- staette --------------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "staette");
	tief(ids(o), [11, 12, 13, 14, 15, 16], "staette · Natter: unmöglich -> die Vorbelegung (Ergänzung)");
	tief(jeItem(o), {}, "…und eine Ergänzung trägt keinen Rumpf, wie bisher");

	const b = burg();
	api.garetienZielwahlSetzen(b, "staette");
	tief(ids(b), [21], "staette · Burg: dasselbe Neu-Item -- ein anderer Zielort, kein anderer Vorschlag");
	tief(jeItem(b), { "21": { innerorts: true, innerorts_public_id: "stadt-wandleth" } },
		"💣 staette · Burg: GENAU diese zwei Werte -- kein `ziel`, sonst formte der Server die Geometrie "
		+ "für ein Ziel um, das nie gebaut wird");

	const p = perz();
	api.garetienZielwahlSetzen(p, "staette");
	tief(ids(p), [], "staette · Perz: nichts");
}
// ---- nur_quelle -----------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "nur_quelle");
	tief(ids(o), [11, 12, 13, 14, 15, 16], "nur_quelle · Natter: unmöglich -> Vorbelegung");

	const b = burg();
	api.garetienZielwahlSetzen(b, "nur_quelle");
	api.garetienNameWahlSetzen(b, "Burg Finsterstein");
	tief(ids(b), [21], "nur_quelle · Burg: das Neu-Item trägt den Auftrag");
	tief(jeItem(b), { "21": { innerorts: true, innerorts_public_id: "stadt-wandleth", innerorts_nur_quelle: true } },
		"🔴 nur_quelle · Burg: innerorts UND innerorts_nur_quelle -- und ⚠️ KEIN Name aus einer früheren Wahl");

	const p = perz();
	api.garetienZielwahlSetzen(p, "nur_quelle");
	tief(ids(p), [], "nur_quelle · Perz: nichts");
}
// ---- ergaenzen ------------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "ergaenzen");
	tief(ids(o), [11, 12, 13, 14, 15, 16], "ergaenzen · Natter: die sechs Ergänzungs-Items, OHNE das Zusatz-Item");
	tief(jeItem(o), {},
		"💣 ergaenzen · Natter: kein Rumpf -- mit `ziel` formte der Server ein BESTEHENDES Objekt um");

	const b = burg();
	api.garetienZielwahlSetzen(b, "ergaenzen");
	tief(ids(b), [21], "ergaenzen · Burg: unmöglich -> Vorbelegung (Karte)");

	const p = perz();
	api.garetienZielwahlSetzen(p, "ergaenzen");
	tief(ids(p), [], "ergaenzen · Perz: nichts");
}
// ---- zusaetzlich ----------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "zusaetzlich");
	tief(ids(o), [11, 12, 13, 14, 15, 16, 17], "zusaetzlich · Natter: Zusatz- UND Ergänzungs-Items");
	const r = jeItem(o);
	tief(Object.keys(r).sort(), ["11", "12", "13", "14", "15", "16", "17"],
		"🔴 zusaetzlich · Natter: JEDES der sieben Items trägt einen Eintrag: " + JSON.stringify(r));
	gleich(r["17"].beides, true, "…das Zusatz-Item bestätigt `beides`");
	gleich(r["17"].ziel, "path", "…und trägt seine Form");
	[11, 12, 13, 14, 15, 16].forEach((id) => {
		tief(r[String(id)], { beides: true },
			"💣 zusaetzlich · Ergänzung " + id + ": NUR der Riegel -- nie `ziel`, nie `name`");
	});
	tief(api.garetienStageUebernahmeIds([o]).sort((a, b) => a - b), [11, 12, 13, 14, 15, 16, 17],
		"der Schreibumfang folgt der Wahl");
	tief(api.garetienStageAnhakenIds([o]).sort((a, b) => a - b), [11, 12, 13, 14, 15, 16, 17],
		"💣 …und das Anhaken auch -- ein nie angehaktes Item erreicht `apply` nie");

	const b = burg();
	api.garetienZielwahlSetzen(b, "zusaetzlich");
	tief(ids(b), [21], "zusaetzlich · Burg: unmöglich -> Karte");
	gleich("beides" in (jeItem(b)["21"] || {}), false, "…ohne `beides`");

	const p = perz();
	api.garetienZielwahlSetzen(p, "zusaetzlich");
	tief(ids(p), [], "zusaetzlich · Perz: nichts");
}
// ---- nichts ---------------------------------------------------------------------------------------
frisch();
[natter(), burg(), perz()].forEach((o) => {
	api.garetienZielwahlSetzen(o, "nichts");
	tief(ids(o), [], "nichts · " + o.name + ": keine Items");
	tief(jeItem(o), {}, "nichts · " + o.name + ": kein Rumpf");
	tief(api.garetienStageUebernahmeIds([o]), [], "nichts · " + o.name + ": nicht im Schreibumfang");
});

// =================================================================================================
// D. Die Zählung -- „Stätte in X" wird gezählt
// =================================================================================================
frisch();
{
	const b = burg();
	api.garetienZielwahlSetzen(b, "staette");
	const stand = api.garetienUebernahmeKnopfZustand([b]);
	gleich(stand.anzahl, 1, "💣 „Stätte in X\" wird vom Fußknopf gezählt -- bis zum 14.09.2026 stand dort „0 von 1\"");
	gleich(stand.gesperrt, false, "…und er ist bedienbar");
	api.garetienZielwahlSetzen(b, "nichts");
	gleich(api.garetienUebernahmeKnopfZustand([b]).anzahl, 0, "„Nichts\" wird nicht gezählt");
}

// =================================================================================================
// F. Das Markup und der Klick -- ausgeführt, wie im Browser
// =================================================================================================
frisch();
{
	const b = burg();
	gleich(api.garetienZielwahlMarkup(b), "", "🔴 vor der Stage steht keine Zielwahl");
	api.avesmapsGaretienStageHinzufuegen([b]);
	let mk = api.garetienZielwahlMarkup(b);
	wahr(mk.includes('<div class="gi-ziel" role="radiogroup" aria-label="Was daraus wird">'),
		"auf der Stage: die Radio-Liste des Mockups: " + mk);
	gleich((mk.match(/class="gi-ziel__option/g) || []).length, 4, "vier Optionen");
	wahr(/value="karte" data-gi-feld="zielwahl" checked/.test(mk), "vorgewählt ist „Auf die Karte\"");
	wahr(/gi-ziel__option is-gewaehlt"><input type="radio"[^>]*value="karte"/.test(mk),
		"…und die gewählte Option trägt is-gewaehlt");
	wahr(mk.includes('<span class="gi-ziel__t1">Stätte in „Wandleth“</span>'), "„Stätte in X\" nennt X");
	wahr(mk.includes('<span class="gi-ziel__t2">0,80 Meilen · nicht auf der Karte, gelistet in der Infobox des Ortes.</span>'),
		"…mit Entfernung und Folge");
	wahr(mk.includes('<span class="gi-ziel__t1">Nur Quelle + Artikel an „Wandleth“</span>'), "„Nur Quelle + Artikel an X\"");
	wahr(!mk.includes("gi-ziel__option--warn"), "keine Warnung am Bauwerk");
	wahr(mk.includes('data-gi-feld="innerorts"') && mk.includes('data-gi-umkreis="innerorts"'),
		"Siedlung und Umkreis stehen darunter");
	wahr(mk.includes('class="gi-insert__row gi-insert__row--aus">Siedlung'),
		"⚠️ solange „Auf die Karte\" gilt, ist die Siedlung ABGEBLENDET, nicht ausgeblendet");
	gleich(mk.indexOf("— auf die Karte —"), -1, "🔴 „— auf die Karte —\" gibt es im Siedlungsfeld nicht mehr");

	api.garetienDetailWaehlen(b.key, [b]);
	api.garetienEingabenAendern(feldEreignis("zielwahl", "nichts"), [b]);
	gleich(dom.el("#garetien-apply").disabled, true, "„Nichts\": der Fußknopf sperrt sich sofort");
	api.garetienEingabenAendern(feldEreignis("zielwahl", "staette"), [b]);
	gleich(api.garetienZielwahlZu(b), "staette", "der Klick auf das Radio setzt die Wahl");
	gleich(dom.el("#garetien-apply").disabled, false,
		"💣 …und der Fußknopf zählt SOFORT neu -- sonst stünde „0 von 1\" neben „Stätte in X\"");
	mk = api.garetienZielwahlMarkup(b);
	wahr(/gi-ziel__option is-gewaehlt"><input type="radio"[^>]*value="staette"/.test(mk), "…und die Liste zeigt sie");
	wahr(mk.includes('class="gi-insert__row">Siedlung'), "…und die Siedlung ist jetzt bedienbar");

	api.garetienEingabenAendern(feldEreignis("innerorts", "dorf-rallerfurt"), [b]);
	wahr(api.garetienZielwahlMarkup(b).includes("Stätte in „Rallerfurt“"), "die Siedlung wechselt X in der Zielwahl");
	tief(jeItem(b), { "21": { innerorts: true, innerorts_public_id: "dorf-rallerfurt" } },
		"⭐ …und die gewählte Siedlung reist mit");
	gleich(api.garetienStageZeile2(b, true), "Stätte in „Rallerfurt“", "die Ziel-Marke sagt dasselbe");

	const leiste = api.garetienHandlungsMarkup(b);
	wahr(!leiste.includes("einfuegeNeu") && !leiste.includes("einfuegeQuelle"), "🔴 die zwei Häkchen sind weg");
	wahr(leiste.indexOf('class="gi-ziel"') !== -1 && leiste.indexOf('class="gi-ziel"') < leiste.indexOf("gi-acts__knoepfe"),
		"die Zielwahl steht über der Knopfzeile");
	tief(api.garetienHandlungen(b).map((k) => k.name), ["entstagen", "ablehnen"],
		"🔴 kein „Innerorts einfügen\" mehr -- auch nicht mit Befund");
	const nameId = "gi-feld-" + b.key + "-einfuegeName";
	wahr(leiste.includes('gi-insert__row" for="' + nameId + '"'), "bei „Stätte\" ist der Name bedienbar");

	api.avesmapsGaretienStageHinzufuegen([b]);
	const kasten = api.garetienEingefuegtWirdMarkup(b);
	wahr(kasten.includes('class="gi-insert__row gi-insert__row--aus">Form') && kasten.includes("gilt nicht für eine Stätte"),
		"⚠️ Form und Art werden bei „Stätte\" abgeblendet, mit Grund: " + kasten);
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(kasten), "…und gesperrt");
	wahr(/data-gi-feld="isRuined"[^>]* disabled/.test(kasten),
		"⚠️ …und die Darstellung des Ortes ebenso -- eine Stätte steht nicht auf der Karte");
	gleich(kasten.indexOf('data-gi-feld="innerorts"'), -1,
		"💣 die Siedlung steht NICHT noch einmal im Kasten -- zwei Felder trügen dieselbe id");
}
frisch();
{
	const o = natter();
	api.avesmapsGaretienStageHinzufuegen([o]);
	const mk = api.garetienZielwahlMarkup(o);
	wahr(mk.includes('<span class="gi-ziel__t1">Quelle an „Natter“ ergänzen</span>'), "⭐ die Zeile nennt das Ziel: " + mk);
	wahr(mk.includes("An 6 Abschnitte."), "⭐ …und die Zahl");
	wahr(mk.indexOf('value="ergaenzen"') < mk.indexOf('value="karte"'), "die Vorbelegung steht vorne");
	wahr(/gi-ziel__option gi-ziel__option--warn"><input type="radio"[^>]*value="zusaetzlich"/.test(mk),
		"💣 „zusätzlich\" trägt die Warnung");
	wahr(mk.includes("Auf die Karte — zusätzlich zu „Natter“"), "…und nennt, wozu zusätzlich");
	const name = api.garetienZielNameZeile(o);
	wahr(name.includes("gi-insert__row--aus") && name.includes(" disabled"),
		"⚠️ bei einer Ergänzung ist der Name abgeblendet, nicht ausgeblendet: " + name);
	gleich(api.garetienStageZeile2(o, true), "Quelle an „Natter“ (6 Abschnitte)", "Ziel-Marke: Ziel und Zahl");
	api.garetienZielwahlSetzen(o, "zusaetzlich");
	gleich(api.garetienStageZeile2(o, true), "zusätzlich als Weg · Flussweg", "Ziel-Marke bei „zusätzlich\"");
	api.garetienZielwahlSetzen(o, "karte");
	gleich(api.garetienStageZeile2(o, false), "als Weg · Flussweg", "Ziel-Marke bei „Auf die Karte\"");
}
frisch();
{
	const p = perz();
	api.avesmapsGaretienStageHinzufuegen([p]);
	const mk = api.garetienZielwahlMarkup(p);
	gleich((mk.match(/class="gi-ziel__option/g) || []).length, 1, "ohne Vorschlag: eine Option");
	wahr(mk.includes("Nichts — nur ansehen") && /value="nichts" data-gi-feld="zielwahl" checked/.test(mk),
		"🔴 „nur Ansicht\" bleibt gesagt -- als gewählte Option");
	gleich(api.garetienZielNameZeile(p), "", "ohne Vorschlag kein Namensfeld");
	gleich(api.garetienStageZeile2(p, true), "nur Ansicht");
}

// =================================================================================================
// G. (Aufgabe 6) Zusammenlegen geht nur mit „Auf die Karte"
// =================================================================================================
frisch();
{
	const fragment = (key, id) => ({ key: key, stand: "offen", urteil: "neu", name: key, ebene: "ggp:Waelder",
		typ: "Wald", ziel: "region", subtyp: "wald", kind: "vegetation", verbund_stamm: "Silker Hain",
		verbund_n: 2, geometrie: [[0, 0], [1, 0], [1, 1]], abschnitte: [],
		items: [{ id: id, change_type: "new", anlass: "", felder: ["quelle"] }] });
	const m1 = fragment("sh1", 31);
	const m2 = fragment("sh2", 32);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	gleich(api.garetienVerbundZusammenlegbar(m1).ok, true, "Auf die Karte + Fläche: zusammenlegbar");
	api.garetienZielwahlSetzen(m1, "nichts");
	const z = api.garetienVerbundZusammenlegbar(m1);
	gleich(z.ok, false, "💣 mit „Nichts\" ist ein Verbund nicht zusammenlegbar");
	wahr(z.grund.includes("Nichts — nur ansehen") && !z.grund.includes(" bei „"),
		"…und der Grund nennt die Wahl: " + z.grund);
	api.garetienZielwahlSetzen(m1, "karte");
	api.garetienZielwahlSetzen(m2, "nichts");
	const z2 = api.garetienVerbundZusammenlegbar(m1);
	gleich(z2.ok, false,
		"💣 auch ein ANDERES Mitglied mit „Nichts\" sperrt -- nach dem Zusammenlegen fiele seine Wahl still auf „Auf die Karte\"");
	wahr(z2.grund.includes("Nichts — nur ansehen") && z2.grund.includes("bei „sh2“"),
		"…und der Grund nennt das Fragment, an dem es hängt: " + z2.grund);
}

// =================================================================================================
// H. (Aufgabe 6) Die Wahl stirbt mit „Stage leeren" -- nicht mit dem Herunternehmen
// =================================================================================================
frisch();
{
	const b = burg();
	api.avesmapsGaretienStageHinzufuegen([b]);
	api.garetienZielwahlSetzen(b, "staette");
	api.avesmapsGaretienStageEntfernen([b.key]);
	gleich(api.garetienZielwahlZu(b), "staette", "⚠️ die Wahl überlebt das Herunternehmen");
	api.avesmapsGaretienStageHinzufuegen([b]);
	api.avesmapsGaretienStageLeeren();
	gleich(api.garetienZielwahlZu(b), "karte", "🔴 …aber nicht „Stage leeren\" (Entwurf §6.4)");
}

// =================================================================================================
// I. BESTAND -- übernommen und abgelehnt bleiben, wie sie sind
// =================================================================================================
frisch();
{
	// Ein übernommenes Einzelobjekt mit altem, nacktem Vermerk -- ohne verbund-Felder.
	const uebernommen = { key: "ggp:Waelder:Wald:Garetien:Alter Forst!Alter Forst", stand: "uebernommen",
		urteil: "neu", name: "Alter Forst", typ: "Wald", ziel: "region", subtyp: "wald", kind: "vegetation",
		geometrie: [[0, 0], [1, 0], [1, 1]], abschnitte: [], innerorts_uebernommen: false,
		items: [{ id: 41, change_type: "new", anlass: "", felder: ["quelle"], selected: 1, apply_state: "done",
			apply_note: "Wald-1234" }] };
	api.avesmapsGaretienStageHinzufuegen([uebernommen]);
	gleich(api.garetienZielwahlMarkup(uebernommen), "", "🔴 ein übernommenes Objekt bekommt keine Zielwahl");
	gleich(api.garetienZielNameZeile(uebernommen), "", "…und kein Namensfeld");
	gleich(api.garetienHandlungen(uebernommen)[0].name, "ruecknahme", "…und behält seine Rücknahme");
	wahr(api.garetienEingefuegtWirdUebernommenHinweis(uebernommen).includes("Liegt bereits auf der Karte"),
		"…und seinen Satz");
	const kasten = api.garetienEingefuegtWirdMarkup(uebernommen);
	gleich(kasten.indexOf("gi-insert__row--aus"), -1, "⚠️ der Kasten bleibt gesperrt OHNE Abblend-Zeile");
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(kasten), "…aber gesperrt wie vorher");

	// Eine abgelehnte Zeile -- auch wenn sie noch auf der Stage läge.
	const abgelehnt = { key: "ggp:Waelder:Wald:Garetien:Abgewiesen!Abgewiesen", stand: "abgelehnt",
		urteil: "neu", name: "Abgewiesen", ziel: "region", subtyp: "wald", geometrie: [[0, 0], [1, 0], [1, 1]],
		abschnitte: [], items: [{ id: 51, change_type: "new", anlass: "", felder: ["quelle"] }] };
	api.avesmapsGaretienStageHinzufuegen([abgelehnt]);
	tief(api.garetienHandlungen(abgelehnt).map((k) => k.name), ["wieder"], "🔴 abgelehnt: genau „Wieder vorschlagen\"");
	gleich(api.garetienZielwahlMarkup(abgelehnt), "", "…und keine Zielwahl");
}

// =================================================================================================
// E. Die Rückfrage vor „zusätzlich" -- und der Rumpf, der beim Server ankommt (asynchron)
// =================================================================================================
async function pruefeImport() {
	const echtesFetch = global.fetch;
	const angefragt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		angefragt.push(rumpf);
		let daten = { ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} };
		if (rumpf.action === "select") { daten = { ok: true }; }
		if (rumpf.action === "apply") {
			daten = { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1, remaining: 0,
				skipped: 0, declined: 0, fehler: [] };
		}
		return Promise.resolve({ json: () => Promise.resolve(daten) });
	};
	try {
		frisch();
		const o = natter();
		api.avesmapsGaretienStageHinzufuegen([o]);
		api.garetienZielwahlSetzen(o, "zusaetzlich");
		const text = api.garetienZusaetzlichRueckfrageText([o]);
		wahr(text.startsWith("Zusätzlich anlegen?"), "die Rückfrage fragt: " + text);
		wahr(text.includes("Neues Objekt „Natter“ anlegen UND die Garetien-Quelle an „Natter“ (6 Abschnitte) hängen."),
			"💣 …und nennt beides beim Namen, mit Zahl: " + text);
		tief(api.garetienZusaetzlichObjekte([o, burg(), perz()]).map((x) => x.name), ["Natter"],
			"nur die „zusätzlich\"-Objekte");

		const gefragt = [];
		await api.garetienFussknopfEinfuegenKlick(4711, (t) => { gefragt.push(t); return false; });
		tief(gefragt, [text], "🔴 vor dem Import wird GENAU diese Frage gestellt");
		gleich(angefragt.length, 0, "💣 ein „Abbrechen\" schickt NICHTS");
		await api.garetienFussknopfEinfuegenKlick(4711);
		gleich(angefragt.length, 0, "💣 ohne Rückfragemöglichkeit wird „zusätzlich\" nicht importiert");

		gefragt.length = 0;
		await api.garetienFussknopfEinfuegenKlick(4711, (t) => { gefragt.push(t); return true; });
		gleich(gefragt.length, 2, "mit „OK\": erst „zusätzlich\", dann die allgemeine Rückfrage");
		gleich(gefragt[0], text, "…in dieser Reihenfolge");
		const apply = angefragt.filter((a) => a.action === "apply")[0];
		wahr(apply && apply.einstellungen_je_item, "der apply-Rumpf trägt einstellungen_je_item: " + JSON.stringify(apply));
		gleich(apply.einstellungen_je_item["17"].beides, true, "🔴 das Zusatz-Item bestätigt `beides` beim Server");
		tief(apply.einstellungen_je_item["11"], { beides: true }, "🔴 …und das Ergänzungs-Item ebenso");
		tief(apply.ids.slice().sort((a, b) => a - b), [11, 12, 13, 14, 15, 16, 17], "…mit allen sieben Items");

		// Ohne „zusätzlich" gibt es keine zweite Frage -- und die Stätte kommt an.
		frisch();
		angefragt.length = 0;
		const b = burg();
		api.avesmapsGaretienStageHinzufuegen([b]);
		api.garetienZielwahlSetzen(b, "staette");
		gefragt.length = 0;
		await api.garetienFussknopfEinfuegenKlick(4711, (t) => { gefragt.push(t); return true; });
		gleich(gefragt.length, 1, "ohne „zusätzlich\" nur die allgemeine Rückfrage");
		const applyB = angefragt.filter((a) => a.action === "apply")[0];
		tief(applyB.ids, [21], "💣 „Stätte in X\" ERREICHT den Server");
		tief(applyB.einstellungen_je_item, { "21": { innerorts: true, innerorts_public_id: "stadt-wandleth" } },
			"…mit genau diesem Rumpf");
	} finally {
		global.fetch = echtesFetch;
		frisch();
	}
}

pruefeImport().then(() => {
	console.log("OK -- garetien-zielwahl-ziele: " + n + " Zusicherungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exitCode = 1;
});
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```sh
node js/review/__tests__/garetien-zielwahl-ziele.test.js
```

Erwartet (Exit 1): `AssertionError [ERR_ASSERTION]: die sechs Zielwerte des Vertrags, in dieser Reihenfolge` mit `+ undefined`.

- [ ] **Schritt 3a: Die Zielwahl selbst** — in `js/review/review-garetien-importer.js`. Alle Anker unten sind eindeutig; die Datei ist in der Arbeitskopie CRLF, also Blöcke nicht per Zeilen-Regex, sondern als Ganzes ersetzen.

**Ersetzen** in `review-garetien-importer.js`: den Block von `// ---- Die zwei Häkchen: „Als Quelle einfügen" und „Neu einfügen" (Owner 09.09.2026) ------------` bis einschließlich `.concat(wahl.quelle ? garetienQuelleItems(objekt) : []); ⏎ }` (121 Zeilen, samt der Leerzeile danach) durch:

```js
	// ---- Die Zielwahl: EINE Wahl statt zwei Häkchen (Entwurf 2026-09-14 §5) ----------------------
	//
	// 🔴 DIE HÄKCHEN „Als Quelle einfügen" / „Neu einfügen" (09.09.2026) SIND GEFALLEN -- als
	// Häkchen. Ihre Werte sind jetzt Werte EINER Liste. Gemessen am 14.09.2026 (Widerspruch 4 des
	// Entwurfs): „Neu einfügen" schaltete die Quelle ZWANGSWEISE mit an -- ein Klick legte die
	// Dublette an UND hängte garetien.de an unser bestehendes Objekt, bei 334 Objekten des Laufs 73,
	// ohne Rückfrage und ohne Riegel im Server.
	// 🔴 „Zusätzlich zu X" ist seither eine EIGENE, benannte Wahl -- mit Rückfrage vor dem Import
	// (garetienZusaetzlichRueckfrageText) und dem Riegel `beides` im Server
	// (avesmapsGaretienBeidesRiegel, Aufgabe 8).
	//
	// 💣 ZWEI NAMEN, DIE SICH NUR IM „w" UNTERSCHEIDEN. `garetienZielWahlZu` (großes W) ist die FORM
	// samt Art und liefert ein Objekt `{ziel, subtyp, kind}`; `garetienZielwahlZu` (kleines w) ist
	// das ZIEL und liefert eine Zeichenkette aus AVESMAPS_GARETIEN_ZIELE. Beide Namen stehen so im
	// Schnittstellen-Vertrag des Bauplans vom 14.09.2026. Wer sucht, sucht mit Groß-/Kleinschreibung.
	//
	// ⚠️ DIE WAHL ÜBERLEBT DAS HERUNTERNEHMEN (sie hängt am Einstellungsschlüssel, nicht am Markup) --
	// aber nicht „Stage leeren" und keinen neuen Lauf: garetienZielwahlVergessen gehört zu den
	// `…Vergessen`-Funktionen, die dort gerufen werden (Entwurf §6.4).
	const AVESMAPS_GARETIEN_ZIELE = ["karte", "staette", "nur_quelle", "ergaenzen", "zusaetzlich", "nichts"];

	let _garetienZielwahl = {};

	function garetienZielwahlVergessen() { _garetienZielwahl = {}; }

	// REIN: die ECHTEN Neu-Items -- `change_type: 'new'`, ohne Geometrie-Item und ohne Zusatz-Item.
	// ⚠️ Das Geometrie-Item bleibt draußen (kein Ersetzen, Owner 31.08.2026).
	function garetienZielNeuItems(objekt) {
		return ((objekt && objekt.items) || []).filter(function (item) {
			return String((item && item.change_type) || "") === "new"
				&& garetienItemAnlass(item) !== "geometrie"
				&& !garetienItemIstZusatz(item);
		});
	}

	// REIN: die Zusatz-Items („trotzdem neu anlegen" -- garetien-plan.php hängt eines an jedes
	// Objekt, das sich deckt).
	function garetienZielZusatzItems(objekt) {
		return ((objekt && objekt.items) || []).filter(garetienItemIstZusatz);
	}

	// REIN: die Ergänzung an einem BESTEHENDEN Objekt (AVESMAPS_GARETIEN_ERGAENZUNG_FELDER ist genau
	// `['quelle']`) -- das Ergänzungs-Item.
	function garetienQuelleItems(objekt) {
		return garetienHakenItems(objekt).filter(function (item) {
			return String((item && item.change_type) || "") !== "new";
		});
	}

	// REIN: die Items, die ein NEUES Objekt anlegen -- die echten Neu-Items, und NUR wenn es keine
	// gibt, das Zusatz-Item.
	// 🔴 DER RIEGEL VOM 30.08.2026 STEHT DAMIT AN EINER STELLE: ein Objekt, das sich deckt, legt über
	// „Auf die Karte" sein Zusatz-Item an -- und NIE zugleich das Ergänzungs-Item. Beides zusammen
	// gibt es nur über „zusätzlich", und das ist eine eigene Wahl.
	function garetienZielKarteItems(objekt) {
		const neu = garetienZielNeuItems(objekt);
		return neu.length > 0 ? neu : garetienZielZusatzItems(objekt);
	}

	// REIN: welche Ziele es für dieses Objekt GIBT -- in der Reihenfolge von AVESMAPS_GARETIEN_ZIELE.
	// 🔴 „Auf die Karte" steht nur da, wenn es etwas anzulegen gibt. Der Entwurf sagt „immer, auch bei
	// Innerorts-Befund" -- gemeint ist: eine gefundene Stadt nimmt es nie weg (Owner 12.09./7). Ein
	// Objekt ganz ohne Neu- oder Zusatz-Item hätte sonst eine Wahl, die still nichts täte.
	// ⚠️ „Stätte" und „Nur Quelle + Artikel" hängen an der GEWÄHLTEN Form (garetienInnerortsMoeglich:
	// Ort + Bauwerksklasse) und an mindestens einer Siedlung im Umkreis.
	function garetienZieleMoeglichMenge(objekt) {
		const karte = garetienZielKarteItems(objekt).length > 0;
		const ergaenzung = garetienQuelleItems(objekt).length > 0;
		const innerorts = karte && garetienInnerortsMoeglich(objekt)
			&& garetienInnerortsKandidatenVon(objekt).length > 0;
		const gibt = {
			karte: karte,
			staette: innerorts,
			nur_quelle: innerorts,
			ergaenzen: ergaenzung,
			zusaetzlich: karte && ergaenzung,
			nichts: true,
		};
		return AVESMAPS_GARETIEN_ZIELE.filter(function (wert) { return gibt[wert] === true; });
	}

	// REIN: die Vorbelegung -- „Quelle an X ergänzen", wenn sich das Objekt deckt (ein Ergänzungs-Item
	// und kein echtes Neu-Item), sonst „Auf die Karte". Das ist die Vorbelegung der Häkchen vom
	// 09.09.2026, nur ohne den stillen Zusatz.
	// ⚠️ Eine gefundene Stadt ist KEINE Vorbelegung: „Keine Automatik. Der Importer schlägt vor, er
	// entscheidet nicht." -- rund 350 Objekte tragen einen Innerorts-Befund.
	function garetienZielwahlVorbelegung(objekt) {
		const menge = garetienZieleMoeglichMenge(objekt);
		if (menge.indexOf("ergaenzen") !== -1 && garetienZielNeuItems(objekt).length === 0) {
			return "ergaenzen";
		}
		return menge.indexOf("karte") !== -1 ? "karte" : "nichts";
	}

	// REIN: die Werte, die zur Wahl stehen -- die Vorbelegung zuerst, dann die übrigen in der
	// Reihenfolge der Konstante. So stehen die drei Szenen des Mockups genau so da, wie sie gezeichnet
	// sind (Silker Hain: Karte · Nichts; Burg Finster: Karte · Stätte · Nur Quelle · Nichts; Natter:
	// Ergänzen · Karte · Zusätzlich · Nichts).
	function garetienZieleMoeglich(objekt) {
		const menge = garetienZieleMoeglichMenge(objekt);
		const vorne = garetienZielwahlVorbelegung(objekt);
		return [vorne].concat(menge.filter(function (wert) { return wert !== vorne; }));
	}

	// REIN: die gespeicherte Wahl -- sonst die Vorbelegung.
	// 💣 EINE UNMÖGLICHE WAHL ZÄHLT NIE. Wer „Stätte" wählt und danach die Form auf Fläche stellt,
	// hätte sonst eine Wahl, die niemand mehr sieht -- und der Import legte trotzdem eine Stätte an.
	// Deshalb wird die Möglichkeit HIER geprüft, nicht nur beim Zeichnen.
	// ⚠️ Die Vorbelegung wird NICHT abgelegt: dieselbe Funktion beantwortet auch „Offen", und dort
	// darf das bloße Ansehen keinen Zustand erzeugen.
	function garetienZielwahlZu(objekt) {
		const key = garetienEinstellungsSchluessel(objekt);
		const gespeichert = key !== "" ? String(_garetienZielwahl[key] || "") : "";
		if (gespeichert !== "" && garetienZieleMoeglichMenge(objekt).indexOf(gespeichert) !== -1) {
			return gespeichert;
		}
		return garetienZielwahlVorbelegung(objekt);
	}

	// Die Zielwahl setzen -- der EINE Schreiber von `_garetienZielwahl`. Ein unbekannter Wert wird
	// verworfen, statt als Wahl liegenzubleiben.
	function garetienZielwahlSetzen(objekt, wert) {
		const key = garetienEinstellungsSchluessel(objekt);
		const w = String(wert || "");
		if (key === "" || AVESMAPS_GARETIEN_ZIELE.indexOf(w) === -1) { return; }
		_garetienZielwahl[key] = w;
	}

	/*
	 * Die Innerorts-Wahl setzen -- der EINE Schreiber von `_garetienInnerortsWahl`.
	 *
	 * ⚠️ SEIT DEM 14.09.2026 WÄHLT SIE NUR NOCH DIE SIEDLUNG, nicht mehr „innerorts ja/nein": das sagt
	 * die Zielwahl („Stätte in X", „Nur Quelle + Artikel an X"). "" heißt „die Vorauswahl".
	 */
	function garetienInnerortsWahlSetzen(objekt, publicId) {
		const key = String((objekt && objekt.key) || "");
		if (key !== "") { _garetienInnerortsWahl[key] = String(publicId || ""); }
	}

	// REIN: die Items, die die STAGE für dieses Objekt übernimmt -- aus der Zielwahl.
	// 💣 SIE IST DIE EINE QUELLE. Anzeige (Zielwahl, garetienStageZeile2), Zählung
	// (garetienUebernahmeKnopfZustand) und Schreibumfang (garetienStageUebernahmeIds) lesen dieselbe
	// Funktion -- genau die Trennung, an der Befund B3 (07.09.2026) gescheitert war.
	// 🔴 „Stätte" und „Nur Quelle + Artikel" nehmen DIESELBEN Items wie „Auf die Karte": sie sind ein
	// anderer Zielort für denselben Vorschlag. Was daraus wird, sagt der Rumpf je Item
	// (garetienEingabenFuerServerOhneName).
	function garetienStageItems(objekt) {
		switch (garetienZielwahlZu(objekt)) {
		case "karte":
		case "staette":
		case "nur_quelle":
			return garetienZielKarteItems(objekt);
		case "ergaenzen":
			return garetienQuelleItems(objekt);
		case "zusaetzlich":
			return garetienZielKarteItems(objekt).concat(garetienQuelleItems(objekt));
		default:
			return [];
		}
	}

```

- [ ] **Schritt 3b: Die Anzeige — Zielwahl-Markup, Namensfeld, Ziel-Marke, Siedlung**

**Ersetzen** in `review-garetien-importer.js`: den Block von `` // 🔴 FIXRUNDE 1, BEFUND B3: DIESE ZEILE FRAGT `garetienStageVorhaben`, NICHT MEHR `` bis einschließlich `return raus; ⏎ }` (95 Zeilen, samt der Leerzeile danach) durch:

```js
	// REIN: WORAN eine Ergänzung hängt -- der Name unseres getroffenen Objekts (nur, wenn alle
	// getroffenen Abschnitte gleich heißen) und die Zahl der Abschnitte.
	// ⭐ „Die Zeile nennt Ziel und Zahl" (Entwurf §5): „Quelle an „Natter" (6 Abschnitte)", nie
	// „Als Quelle einfügen" -- das Häkchen vom 09.09.2026 nannte weder das eine noch das andere
	// (Befund `quelle-ohne-ziel`).
	// ⚠️ Der Name kommt vom Abschnitt am Item, sonst aus `objekt.abschnitte` -- manche Antworten tragen
	// am Item nur die `public_id`.
	function garetienErgaenzungZiel(objekt) {
		const o = objekt || {};
		const namenJeId = {};
		(o.abschnitte || []).forEach(function (a) {
			const pid = String((a && a.public_id) || "");
			if (pid !== "") { namenJeId[pid] = String((a && a.name) || "").trim(); }
		});
		const ids = [];
		const namen = [];
		garetienQuelleItems(o).forEach(function (item) {
			const a = (item && item.abschnitt) || null;
			const pid = String((a && a.public_id) || "");
			if (pid === "" || ids.indexOf(pid) !== -1) { return; }
			ids.push(pid);
			const name = String((a && a.name) || namenJeId[pid] || "").trim();
			if (name !== "" && namen.indexOf(name) === -1) { namen.push(name); }
		});
		return { name: namen.length === 1 ? namen[0] : "", abschnitte: ids.length };
	}

	// REIN: die zwei Zeilen EINER Zielwahl-Option -- `{ t1, t2, warn }` (Mockup §3–§5).
	// 🔴 „Zusätzlich" trägt `warn`: es ist die eine Wahl, nach der zwei Objekte gleichen Namens auf der
	// Karte stehen.
	function garetienZielwahlTexte(objekt, wert) {
		const o = objekt || {};
		const ziel = garetienErgaenzungZiel(o);
		const bestand = ziel.name !== "" ? "„" + ziel.name + "“" : "";
		const stadt = garetienInnerortsZiel(o);
		switch (wert) {
		case "karte":
			return {
				t1: "Auf die Karte",
				t2: garetienZieleMoeglichMenge(o).indexOf("ergaenzen") !== -1
					? "Statt der Ergänzung ein eigenes neues Objekt; "
						+ (bestand !== "" ? bestand : "das bestehende Objekt") + " bleibt unberührt."
					: "Ein neues Objekt der gewählten Form.",
				warn: false,
			};
		case "staette": {
			const kandidat = garetienInnerortsKandidatenVon(o).filter(function (k) {
				return String(k.public_id || "") === stadt.public_id;
			})[0];
			const meilen = kandidat ? Number(kandidat.meilen) : NaN;
			return {
				t1: "Stätte in „" + stadt.name + "“",
				t2: (Number.isFinite(meilen) ? garetienZahlText(meilen) + " Meilen · " : "")
					+ "nicht auf der Karte, gelistet in der Infobox des Ortes.",
				warn: false,
			};
		}
		case "nur_quelle":
			return {
				t1: "Nur Quelle + Artikel an „" + stadt.name + "“",
				t2: "Kein Objekt. Quelle und Artikel an den bestehenden Ort.",
				warn: false,
			};
		case "ergaenzen":
			return {
				t1: bestand !== "" ? "Quelle an " + bestand + " ergänzen" : "Quelle am bestehenden Objekt ergänzen",
				t2: (ziel.abschnitte > 0
					? "An " + garetienAnzahlText(ziel.abschnitte, "Abschnitt", "Abschnitte") + ". " : "")
					+ "Unser Objekt bleibt, wie es ist.",
				warn: false,
			};
		case "zusaetzlich":
			return {
				t1: "Auf die Karte — zusätzlich zu " + (bestand !== "" ? bestand : "dem bestehenden Objekt"),
				t2: "⚠️ Beides: neues Objekt UND Quelle an " + (bestand !== "" ? bestand : "das bestehende Objekt")
					+ ". Nur, wenn es wirklich zwei sind — mit Rückfrage.",
				warn: true,
			};
		default:
			return {
				t1: "Nichts — nur ansehen",
				t2: "Bleibt auf der Stage, wird nicht importiert und nicht gezählt.",
				warn: false,
			};
		}
	}

	// REIN: warum Name, Form, Art und Darstellung für DIESES Ziel nicht gelten -- "" heißt „sie
	// gelten". ⚠️ ABGEBLENDET, NICHT AUSGEBLENDET (Entwurf §3): sonst springt die Spalte bei jedem
	// Wechsel der Zielwahl.
	function garetienZielwahlAusGrund(objekt) {
		switch (garetienZielwahlZu(objekt)) {
		case "karte":
		case "zusaetzlich":
			return "";
		case "staette":
			return "gilt nicht für eine Stätte";
		case "nur_quelle":
			return "gilt nicht für „Nur Quelle + Artikel“";
		case "ergaenzen":
			return "gilt nicht für eine Ergänzung";
		default:
			return "wird nicht importiert";
		}
	}

	// REIN: die Zielwahl als Radio-Liste `.gi-ziel` (Mockup §3–§5) -- oder "", solange das Objekt
	// nicht auf der Stage liegt.
	// 🔴 ERST AUF DER STAGE (Owner 09.09.2026 und 12.09.2026/2): auf „Offen" steht der Vorschlag als
	// Text, geändert wird er erst hier.
	// ⚠️ Siedlung und Umkreis stehen DIREKT darunter (garetienInnerortsZeileMarkup): sie geben „Stätte
	// in X" und „Nur Quelle + Artikel an X" ihr X, und der Umkreis-Spinner steht bei jedem Bauwerk,
	// auch ohne Treffer (Entwurf §5).
	// 💣 Der Radio-`name` ist JE OBJEKT verschieden (garetienEingabeId): zwei Radio-Gruppen mit
	// demselben Namen in einem Dokument sind EINE Gruppe, und ein Klick nähme der anderen ihre Wahl.
	function garetienZielwahlMarkup(objekt) {
		const o = objekt || {};
		if (String(o.stand || "") !== "offen") { return ""; }
		if (!avesmapsGaretienStageHat(o.key)) { return ""; }
		const gewaehlt = garetienZielwahlZu(o);
		const gruppe = garetienEingabeId(o, "zielwahl");
		const optionen = garetienZieleMoeglich(o).map(function (wert) {
			const text = garetienZielwahlTexte(o, wert);
			const an = wert === gewaehlt;
			return '<label class="gi-ziel__option' + (text.warn ? " gi-ziel__option--warn" : "")
				+ (an ? " is-gewaehlt" : "") + '">'
				+ '<input type="radio" name="' + gruppe + '" value="' + avesmapsGaretienEscape(wert) + '"'
				+ ' data-gi-feld="zielwahl"' + (an ? " checked" : "") + ">"
				+ '<span class="gi-ziel__t1">' + avesmapsGaretienEscape(text.t1) + "</span>"
				+ '<span class="gi-ziel__t2">' + avesmapsGaretienEscape(text.t2) + "</span></label>";
		}).join("");
		return '<div class="gi-ziel" role="radiogroup" aria-label="Was daraus wird">' + optionen + "</div>"
			+ garetienInnerortsZeileMarkup(o, false);
	}

	// REIN: das Namensfeld unter der Zielwahl -- oder "", wenn es gar nichts anzulegen gibt.
	// ⚠️ ABGEBLENDET, NICHT AUSGEBLENDET, wenn das gewählte Ziel keinen Namen braucht (eine Ergänzung,
	// „Nur Quelle + Artikel", „Nichts"): so springt die Spalte beim Umschalten nicht (Mockup §5, Natter).
	function garetienZielNameZeile(objekt) {
		const o = objekt || {};
		if (String(o.stand || "") !== "offen" || !avesmapsGaretienStageHat(o.key)) { return ""; }
		if (garetienZieleMoeglichMenge(o).length === 1) { return ""; }
		const zielwahl = garetienZielwahlZu(o);
		const aus = !(zielwahl === "karte" || zielwahl === "zusaetzlich" || zielwahl === "staette");
		return garetienEingefuegtWirdTextZeile(o, "Name", "einfuegeName", garetienNameFuerImport(o), "", aus, aus);
	}

	/*
	 * REIN: was die Stage mit diesem Objekt vorhat, in einer Zeile -- der Text der Ziel-Marke
	 * (Aufgabe 12 setzt ihn in die Listenzeile).
	 *
	 * 🔴 SEIT DEM 14.09.2026 LIEST SIE DIE ZIELWAHL, nicht mehr `garetienStageVorhaben`: was die Zeile
	 * sagt und was der Import tut, kommen damit aus derselben Weiche (garetienStageItems).
	 * ⚠️ `aufDerStage` bleibt als Parameter stehen, ändert den Text aber nicht mehr -- „liegt als …"
	 * war die Unterzeile eines Knopfes, der seit dem 09.09.2026 keine mehr trägt.
	 * ⚠️ Die GEWÄHLTE Form und Art (garetienZielWahlZu, garetienUnserBeschriftung), nicht der rohe
	 * Vorschlag -- sonst sagte die Zeile „als Fläche", während der Kasten „Berggipfel" zeigt.
	 */
	function garetienStageZeile2(objekt, aufDerStage) {
		void aufDerStage;
		const zielwahl = garetienZielwahlZu(objekt);
		if (zielwahl === "nichts") { return "nur Ansicht"; }
		if (zielwahl === "staette") { return "Stätte in „" + garetienInnerortsZiel(objekt).name + "“"; }
		if (zielwahl === "nur_quelle") { return "nur Quelle an „" + garetienInnerortsZiel(objekt).name + "“"; }
		if (zielwahl === "ergaenzen") {
			const ziel = garetienErgaenzungZiel(objekt);
			const zahl = ziel.abschnitte > 0 ? garetienAnzahlText(ziel.abschnitte, "Abschnitt", "Abschnitte") : "";
			if (ziel.name !== "") { return "Quelle an „" + ziel.name + "“" + (zahl !== "" ? " (" + zahl + ")" : ""); }
			return zahl !== "" ? "Quelle an " + zahl : "Quelle am bestehenden Objekt";
		}
		const formKey = String(garetienZielWahlZu(objekt).ziel || "");
		const form = (AVESMAPS_GARETIEN_FORMEN.filter(function (f) { return f.key === formKey; })[0] || {}).label || "";
		const art = garetienUnserBeschriftung(objekt);
		const teile = [form];
		if (art !== "" && art !== form) { teile.push(art); }
		const als = teile.filter(function (t) { return t !== ""; }).join(" · ") || "Vorschlag dieses Laufs";
		return (zielwahl === "zusaetzlich" ? "zusätzlich als " : "als ") + als;
	}

```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
			// 🔴 ZWEI ZEILEN, UND DIE HAEKCHEN STEHEN OBEN (Owner 09.09.2026: „Von der Stage
			// nehmen + Ablehnen soll in eine 2. Zeile unter die checkboxen"). Die Knoepfe bekommen
			// dafuer eine eigene Huelle -- ohne sie stehen sie als Geschwister der Haekchen-Absaetze
			// da, und der Flex-Umbruch der Leiste kann sie neben einen Haken ziehen.
			+ garetienEinfuegeHakenMarkup(objekt)
```

neu:

```js
			// 🔴 ZWEI ZEILEN, UND DIE ZIELWAHL STEHT OBEN (Owner 09.09.2026: „Von der Stage nehmen +
			// Ablehnen soll in eine 2. Zeile unter die checkboxen" -- die Häkchen sind seit dem 14.09.2026
			// die Zielwahl). Die Knoepfe bekommen dafuer eine eigene Huelle -- ohne sie stuenden sie als
			// Geschwister der Optionen da, und der Flex-Umbruch der Leiste zoege sie daneben.
			+ garetienZielwahlMarkup(objekt) + garetienZielNameZeile(objekt)
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
function garetienEingefuegtWirdTextZeile(objekt, beschriftung, feld, wert, platzhalter, deaktiviert) {
		const id = garetienEingabeId(objekt, feld);
		return '<label class="location-report-form__field location-report-form__field--zeile gi-insert__row" for="'
```

neu:

```js
function garetienEingefuegtWirdTextZeile(objekt, beschriftung, feld, wert, platzhalter, deaktiviert, aus) {
		const id = garetienEingabeId(objekt, feld);
		// ⚠️ `aus` (14.09.2026): abgeblendet statt ausgeblendet -- siehe garetienZielNameZeile.
		return '<label class="location-report-form__field location-report-form__field--zeile gi-insert__row'
			+ (aus ? " gi-insert__row--aus" : "") + '" for="'
```

**Ersetzen** in `review-garetien-importer.js`: den Block von `/*` bis einschließlich `+ spinner; ⏎ }` (74 Zeilen, samt der Leerzeile danach) durch:

```js
	/*
	 * REIN: die Siedlung, an die eine Innerorts-Übernahme JETZT ginge -- die gewählte, sonst die
	 * Vorauswahl des Servers, sonst die nächste Siedlung der Liste. `{public_id:"", name:""}`, wenn es
	 * keine gibt.
	 *
	 * 💣 EIN Leser für die Zielwahl-Zeile („Stätte in X"), die Ziel-Marke und den Anfragerumpf. Stünde
	 * die Auflösung an jeder dieser Stellen einzeln, sagte die Zeile „Stätte in Wandleth", während die
	 * Anfrage „Aue" mitschickt.
	 * ⚠️ SEIT DEM 14.09.2026 MIT DER NÄCHSTEN SIEDLUNG ALS LETZTEM RÜCKFALL: steht die Vorauswahl nicht
	 * (mehr) in der Liste -- der Umkreis-Spinner hat sie frisch nachgeschlagen --, stünde sonst
	 * „Stätte in „"" ohne Namen da.
	 * 🔧 Serverseitig fällt eine Siedlung, die NICHT in den Kandidaten des LAUFS steht, still auf dessen
	 * Vorauswahl zurück (avesmapsGaretienInnerortsAusVorschlag) -- eine per Spinner gefundene Siedlung
	 * erreicht den Server damit nicht. Das ist ein Befund für den Server, kein Rückfall hier.
	 */
	function garetienInnerortsZiel(objekt) {
		const kandidaten = garetienInnerortsKandidatenVon(objekt);
		const finde = function (publicId) {
			return kandidaten.filter(function (k) { return String(k.public_id || "") === publicId; })[0] || null;
		};
		const wahl = garetienInnerortsWahlZu(objekt);
		if (wahl !== "") {
			const treffer = finde(wahl);
			if (treffer) { return { public_id: wahl, name: String(treffer.name || "") }; }
		}
		const befund = (objekt && objekt.innerorts) || null;
		const befundId = befund && typeof befund === "object" ? String(befund.public_id || "").trim() : "";
		const befundName = befund && typeof befund === "object" ? String(befund.name || "").trim() : "";
		if (befundName !== "" && finde(befundId)) { return { public_id: befundId, name: befundName }; }
		if (kandidaten.length > 0) {
			return { public_id: String(kandidaten[0].public_id || ""), name: String(kandidaten[0].name || "") };
		}
		return { public_id: "", name: "" };
	}

	/*
	 * REIN: Siedlung und Umkreis unter der Zielwahl -- oder "", wenn das Objekt keine Innerorts-Frage
	 * hat (garetienInnerortsMoeglich: Ort + Bauwerksklasse).
	 *
	 * 🔴 SEIT DEM 14.09.2026 GIBT ES „— auf die Karte —" HIER NICHT MEHR. „Auf die Karte" ist eine
	 * Zielwahl, und eine zweite Stelle, die dasselbe entscheidet, wäre genau die Divergenz, an der die
	 * Häkchen gescheitert sind. Das Feld wählt nur noch, WELCHE Siedlung.
	 * ⚠️ ABGEBLENDET, solange das Ziel keine Siedlung braucht („Auf die Karte", „Nichts") -- nicht
	 * ausgeblendet, sonst springt die Spalte beim Umschalten.
	 * 🔴 DER SPINNER STEHT BEI JEDEM BAUWERK, auch ohne Treffer: fände die Suche bei 5 Meilen nichts,
	 * wäre sonst auch das Feld weg, mit dem man sie auf 12 stellt.
	 */
	function garetienInnerortsZeileMarkup(objekt, deaktiviert) {
		if (!garetienInnerortsMoeglich(objekt)) { return ""; }
		const kandidaten = garetienInnerortsKandidatenVon(objekt);
		// ⚠️ An einem übernommenen Objekt ist nichts mehr zu suchen -- dort kein Spinner.
		const spinner = deaktiviert ? "" : '<p class="gi-insert__row">'
			+ garetienUmkreisSpinnerMarkup("innerorts", "Umkreis") + "</p>";
		if (kandidaten.length === 0) {
			return '<p class="gi-insert__row">Innerorts <span class="gi-insert__val gi-insert__hint">'
				+ "keine Siedlung innerhalb von " + garetienZahlText(garetienUmkreisZu("innerorts"))
				+ " Meilen</span></p>" + spinner;
		}
		const zielwahl = garetienZielwahlZu(objekt);
		const aktiv = !deaktiviert && (zielwahl === "staette" || zielwahl === "nur_quelle");
		const gewaehlt = garetienInnerortsZiel(objekt).public_id;
		const optionen = kandidaten.map(function (k) {
			const pid = String(k.public_id || "");
			return '<option value="' + avesmapsGaretienEscape(pid) + '"'
				+ (pid === gewaehlt ? " selected" : "") + ">"
				+ avesmapsGaretienEscape(garetienInnerortsKandidatText(k)) + "</option>";
		});
		return '<p class="gi-insert__row' + (aktiv ? "" : " gi-insert__row--aus") + '">Siedlung '
			+ '<span class="gi-insert__val"><select class="gi-insert__select" data-gi-feld="innerorts" id="'
			+ garetienEingabeId(objekt, "innerorts") + '"' + (aktiv ? "" : " disabled") + ">"
			+ optionen.join("") + "</select></span></p>"
			+ spinner;
	}

```

- [ ] **Schritt 3c: Eingabe und Anfragerumpf**

**Ersetzen** in `review-garetien-importer.js`: den Block von `// 🔴 DIE INNERORTS-WAHL BAUT DIE SPALTE NEU, wie die Zielwahl darunter -- sie entscheidet,` bis einschließlich `return; ⏎ }` (24 Zeilen) durch:

```js
		// 🔴 DIE ZIELWAHL BAUT DIE SPALTE NEU: sie entscheidet, welche Felder darunter gelten (abgeblendet
		// oder nicht) und welche Items der Import schreibt -- und der Fußknopf zählt danach neu, sonst
		// stünde dort „0 von 1" neben einem Objekt, das „Stätte in X" gewählt hat.
		// ⚠️ Ein Radio meldet `input` nur beim Einschalten -- `value` ist also immer die neue Wahl.
		if (feld === "zielwahl") {
			garetienZielwahlSetzen(objekt, ziel.value);
			garetienDetailRendern(objekte || zustand.objekte || []);
			garetienUebernahmeKnopfSetzen(avesmapsGaretienStageListe());
			return;
		}
		// Der von Hand geaenderte Name. ⚠️ KEIN Neuzeichnen: der Kasten wuerde beim Tippen unter dem
		// Zeiger neu gebaut und der Fokus waere nach dem ersten Buchstaben weg.
		if (feld === "einfuegeName") {
			garetienNameWahlSetzen(objekt, ziel.value);
			return;
		}
		// Die Siedlung für „Stätte in X" / „Nur Quelle + Artikel an X". Neu gezeichnet wird, weil ihr
		// Name in der Zielwahl steht.
		if (feld === "innerorts") {
			const key = String(objekt.key || "");
			if (key !== "") { garetienInnerortsWahlSetzen(objekt, ziel.value); }
			garetienDetailRendern(objekte || zustand.objekte || []);
			return;
		}
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
		const name = garetienNameWahlZu(objekt);
		const mitName
```

neu:

```js
		// ⚠️ „Nur Quelle + Artikel" legt kein Objekt an -- ein Name, der dort aus einer früheren Wahl
		// liegengeblieben ist, reist nicht mit.
		const name = garetienZielwahlZu(objekt) === "nur_quelle" ? "" : garetienNameWahlZu(objekt);
		const mitName
```

**Ersetzen** in `review-garetien-importer.js`: den Block von `// 🔴 EINE GEWÄHLTE STADT SCHLÄGT ALLES ANDERE -- und deshalb steht sie VOR der Zielwahl.` bis einschließlich `return { innerorts: true, innerorts_public_id: innerorts }; ⏎ }` (15 Zeilen) durch:

```js
		// 🔴 „STÄTTE IN X" UND „NUR QUELLE + ARTIKEL AN X" SCHLAGEN ALLES ANDERE -- und deshalb stehen sie
		// VOR der Formwahl. Eine Stätte entsteht auf der Karte gar nicht; Form, Art, Nodix und Strömung
		// beschreiben ein Kartenobjekt, das es nicht geben wird.
		// 💣 UND ES REIST KEIN `ziel` MIT. `avesmapsGaretienZielUebersteuern` läuft serverseitig VOR der
		// Innerorts-Weiche (garetien-uebernahme.php) und formte die Geometrie für ein Ziel um, das nie
		// gebaut wird.
		// ⭐ SEIT DEM 14.09.2026 ENTSCHEIDET DIE ZIELWAHL, nicht mehr das Siedlungsfeld. Bis dahin hieß
		// eine gewählte Stadt „innerorts" -- und der Fußknopf sprang dabei auf „0 von 1", weil
		// `garetienNeuMoeglich` das Neu-Item wegnahm (Befund `stadt-unimportierbar`).
		const zielwahl = garetienZielwahlZu(objekt);
		if (zielwahl === "staette" || zielwahl === "nur_quelle") {
			const innerortsRumpf = { innerorts: true, innerorts_public_id: garetienInnerortsZiel(objekt).public_id };
			// 🔴 „Nur Quelle + Artikel": der Server hängt Quelle und Artikel an die Siedlung und legt
			// KEINE Stätte an (Aufgabe 8, `innerorts_nur_quelle`).
			if (zielwahl === "nur_quelle") { innerortsRumpf.innerorts_nur_quelle = true; }
			return innerortsRumpf;
		}
```

**Ersetzen** in `review-garetien-importer.js`: den Block von `function garetienStageEinstellungenJeItem(objekte) {` bis einschließlich `return raus; ⏎ }` (16 Zeilen, samt der Leerzeile danach) durch:

```js
	function garetienStageEinstellungenJeItem(objekte) {
		const raus = {};
		(objekte || []).forEach(function (objekt) {
			if (!objekt) { return; }
			const rumpf = garetienEingabenFuerServer(objekt);
			// 🔴 „ZUSÄTZLICH" BESTÄTIGT SICH AN BEIDEN ITEMS (Entwurf §5, Aufgabe 8). Der Server weist ein
			// `apply` ab, das für dasselbe Objekt ein Neu- und ein Ergänzungs-Item trägt -- außer BEIDE
			// tragen `beides: true` (avesmapsGaretienBeidesRiegel). Ohne diese Ausnahme wiese der Riegel
			// genau die Wahl ab, die ihn braucht.
			const beides = garetienZielwahlZu(objekt) === "zusaetzlich";
			garetienStageItems(objekt).forEach(function (item) {
				const id = Number(item && item.id);
				if (!(id > 0)) { return; }
				// 🔴 DAS HAUS-PRAEDIKAT, keine vierte Abschrift von `change_type === 'new'`.
				if (AVESMAPS_GARETIEN_ITEMS_JE_HANDLUNG.neu(item)) {
					if (rumpf || beides) {
						raus[String(id)] = beides ? Object.assign({}, rumpf || {}, { beides: true }) : rumpf;
					}
					return;
				}
				// 💣 DAS ERGÄNZUNGS-ITEM BEKOMMT NUR DEN RIEGEL, NIE DEN RUMPF: mit `ziel` formte
				// `avesmapsGaretienZielUebersteuern` die Geometrie eines BESTEHENDEN Objekts um (siehe die
				// Verengung oben). `{beides: true}` trägt weder `ziel` noch `name`.
				if (beides) { raus[String(id)] = { beides: true }; }
			});
		});
		return raus;
	}

```

- [ ] **Schritt 3d: Form, Art und Darstellung abblenden; die Siedlung wandert aus dem Kasten**

**Ersetzen** in `review-garetien-importer.js`: den Block von `` // REIN: die zwei Auswahlfelder. `deaktiviert` sperrt sie an einem bereits übernommenen Objekt -- `` bis einschließlich `+ bauen("zielArt", artListe, wahl.subtyp) + "</span></p>"; ⏎ }` (30 Zeilen, samt der Leerzeile danach) durch:

```js
	// REIN: die zwei Auswahlfelder. `deaktiviert` sperrt sie an einem bereits übernommenen Objekt --
	// dieselbe Regel wie für jedes andere Feld dieses Kastens (Owner 30.08.2026, Punkt 6a).
	// 🔴 `ausGrund` (14.09.2026): nicht "" heißt, das gewählte ZIEL braucht keine Form („Stätte in X",
	// eine Ergänzung, „Nichts"). Die Zeilen werden dann ABGEBLENDET (`gi-insert__row--aus`, gesperrt,
	// mit Grund) statt ausgeblendet -- sonst springt die Spalte bei jedem Wechsel (Mockup §5).
	function garetienZielWahlMarkup(objekt, deaktiviert, ausGrund) {
		const wahl = garetienZielWahlZu(objekt);
		const formen = garetienMoeglicheFormen(objekt);
		// ⚠️ Eine Form, die die Geometrie nicht hergibt, steht nicht in der Liste -- die gewählte
		// aber immer, sonst zeigte das Feld etwas anderes an als das, was gilt.
		const formListe = formen.some(function (f) { return f.key === wahl.ziel; })
			? formen
			: formen.concat([{ key: wahl.ziel, label: wahl.ziel }]);
		const arten = garetienArtenFuerForm(wahl.ziel);
		const artListe = arten.some(function (a) { return a.key === wahl.subtyp; })
			? arten
			: arten.concat([{ key: wahl.subtyp, label: wahl.subtyp, kind: wahl.kind }]);
		const grund = String(ausGrund || "");
		const gesperrt = (deaktiviert || grund !== "") ? " disabled" : "";
		const zeile = grund !== "" ? "gi-insert__row gi-insert__row--aus" : "gi-insert__row";
		const bauen = function (feld, liste, gewaehlt) {
			return '<select class="gi-insert__select" data-gi-feld="' + feld + '"'
				+ ' id="' + garetienEingabeId(objekt, feld) + '"' + gesperrt + ">"
				+ liste.map(function (e) {
					return '<option value="' + avesmapsGaretienEscape(e.key) + '"'
						+ (e.key === gewaehlt ? " selected" : "") + ">"
						+ avesmapsGaretienEscape(e.label) + "</option>";
				}).join("") + "</select>";
		};
		return '<p class="' + zeile + '">Form <span class="gi-insert__val">'
			+ bauen("zielForm", formListe, wahl.ziel) + "</span>"
			+ (grund !== "" ? '<span class="gi-insert__unit">' + avesmapsGaretienEscape(grund) + "</span>" : "")
			+ "</p>"
			+ '<p class="' + zeile + '">Art <span class="gi-insert__val">'
			+ bauen("zielArt", artListe, wahl.subtyp) + "</span></p>";
	}

```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
		const uebernommen = String(objekt.stand || "") === "uebernommen";
		let markup = '<p class="gi-sec">Eingefügt wird</p>'
```

neu:

```js
		const uebernommen = String(objekt.stand || "") === "uebernommen";
		// 🔴 AUF DER STAGE ENTSCHEIDET DIE ZIELWAHL, OB DIE FELDER GELTEN (14.09.2026). Eine Stätte, eine
		// Ergänzung oder „Nichts" legt kein Kartenobjekt an -- Form, Art und Darstellung werden dann
		// abgeblendet, nicht ausgeblendet. ⚠️ Ein übernommenes Objekt bleibt, wie es war: gesperrt, ohne
		// Grund-Zeile (Bestand, Owner 14.09.2026).
		const ausGrund = (!uebernommen && avesmapsGaretienStageHat(objekt.key)) ? garetienZielwahlAusGrund(objekt) : "";
		const gesperrt = uebernommen || ausGrund !== "";
		let markup = '<p class="gi-sec">Eingefügt wird</p>'
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
			+ garetienZielWahlMarkup(objekt, uebernommen);
```

neu:

```js
			+ garetienZielWahlMarkup(objekt, uebernommen, ausGrund);
```

**Ersetzen** in `review-garetien-importer.js`: den Block von `// 🔴 DIREKT UNTER FORM UND ART, weil sie dieselbe Frage beantwortet („was entsteht?")` bis einschließlich `markup += garetienEingefuegtWirdWegMarkup(objekt, subtyp, uebernommen); ⏎ }` (16 Zeilen) durch:

```js
		// ⚠️ SIEDLUNG UND UMKREIS STEHEN SEIT DEM 14.09.2026 UNTER DER ZIELWAHL (garetienZielwahlMarkup),
		// nicht mehr hier: sie geben „Stätte in X" ihr X, und zweimal gezeichnet trügen zwei Felder
		// dieselbe `id`. An einem ÜBERNOMMENEN Bauwerk fällt die gesperrte Zeile ersatzlos weg -- wo es
		// liegt, sagt weiter der Satz darüber (garetienEingefuegtWirdUebernommenHinweis).
		if (ziel === "region") {
			markup += garetienEingefuegtWirdFlaecheMarkup(objekt, gesperrt);
			markup += garetienEingefuegtWirdBeschriftungMarkup(objekt, subtyp, true, gesperrt);
		} else if (ziel === "label") {
			markup += garetienEingefuegtWirdBeschriftungMarkup(objekt, subtyp, false, gesperrt);
		} else if (ziel === "location") {
			markup += garetienEingefuegtWirdOrtMarkup(objekt, subtyp, gesperrt);
		} else if (ziel === "path") {
			markup += garetienEingefuegtWirdWegMarkup(objekt, subtyp, gesperrt);
		}
```

- [ ] **Schritt 3e: „Innerorts einfügen“ fällt — Knopf, Tafeln, Klickverteiler, Verdrahtung**

**Ersetzen** in `review-garetien-importer.js`: den Block von `const namen = (AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL[String(o.urteil || "")] || ["ablehnen"]).slice();` bis einschließlich `namen.splice(stelle + 1, 0, "innerorts"); ⏎ }` (23 Zeilen) durch:

```js
		const namen = (AVESMAPS_GARETIEN_HANDLUNGEN_JE_URTEIL[String(o.urteil || "")] || ["ablehnen"]).slice();
		// 🔴 „Innerorts einfügen (X)" IST AM 14.09.2026 GEFALLEN. Er war der einzige Knopf, der ohne
		// Rückfrage in die Karte schrieb -- schon auf „Offen", neben einem Tooltip, der verspricht, dass
		// nichts geschrieben wird, bis „Stage importieren" gedrückt ist (Befund `innerorts-sofort`).
		// Was er konnte, kann die Zielwahl („Stätte in X"), und die geht über die Stage.
```

**Entfernen** in `review-garetien-importer.js`:

```js
		// ⚠️ Die Stadt fehlt hier mit Absicht: sie hängt am OBJEKT, nicht an der Handlung, und
		// wird in garetienHandlungBauen angehängt -- dieselbe Bauform wie „Bei „Rakula" …".
		innerorts: "Innerorts einfügen",
```

**Entfernen** in `review-garetien-importer.js`:

```js
		// 🔴 „Innerorts einfügen" steht NEUTRAL daneben (Entwurf §4). Grün kodiert in diesem
		// Fenster „legt etwas auf der Karte an" -- und genau das tut diese Handlung NICHT: sie
		// legt eine Stätte in einer Stadt an, ohne Kartenposition. Zwei grüne Knöpfe
		// nebeneinander behaupteten außerdem, es gebe zwei gleichrangige Hauptwege; es gibt einen
		// Hauptweg und eine begründete Alternative.
```

**Entfernen** in `review-garetien-importer.js`:

```js
		// 🔴 DIESELBE MENGE WIE „neu", und deshalb dasselbe Prädikat statt einer zweiten Kopie:
		// „innerorts" ist kein anderer Vorschlag, sondern ein anderer ZIELORT für denselben. Zwei
		// wortgleiche Bedingungen liefen beim ersten Zusatz auseinander.
		innerorts: function (item) { return String((item && item.change_type) || "") === "new"; },
```

**Entfernen** in `review-garetien-importer.js`:

```js
		case "innerorts":
			return "Legt " + benannt + " als besondere Stätte in „" + garetienInnerortsZiel(o).name
				+ "\" an — OHNE Position auf der Karte. Es erscheint dort in der Infobox der Stadt "
				+ "und in der Suche, nicht als eigener Punkt.";
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
if (name === "neu" || name === "innerorts") {
```

neu:

```js
if (name === "neu") {
```

**Entfernen** in `review-garetien-importer.js`:

```js
		// 🔴 DER ORTSNAME STEHT IM KNOPF, nicht im Hilfetext (Entwurf §4). Der Editor entscheidet
		// nicht „innerorts ja/nein", sondern „innerorts IN WANDLETH" -- und wenn die Stadt falsch
		// ist, sieht er es, bevor er drückt. Das ist der einzige Riegel, den diese Handlung hat.
		if (name === "innerorts") {
			beschriftung += " (" + garetienInnerortsZiel(objekt).name + ")";
		}
```

**Entfernen** in `review-garetien-importer.js`: den Block von `function garetienNeuKlick(ereignis, objekte, runId, fragen) {` bis einschließlich `}); ⏎ }` (102 Zeilen, samt der Leerzeile danach).

**Entfernen** in `review-garetien-importer.js`:

```js
				// Aufgabe 8: „Neu einfügen“ schreibt wirklich (garetienNeuKlick). Er steht VOR
				// garetienHandlungKlick und meldet per Rückgabewert, ob er den Klick übernommen hat --
				// dann bleibt garetienHandlungKlick für dasselbe Ereignis aus, sonst hätte derselbe
				// Knopf zwei Erzeuger (AGENTS.md §11).
				// 🔴 Meldung B (30.08.2026): `garetienFragen` reist seither MIT -- „trotzdem neu
				// anlegen“ (Zusatz-Item) braucht eine Rückfrage, der normale Neuzugang weiterhin
				// keine.
				if (garetienNeuKlick(ereignis, zustand.objekte, zustand.planRunId, garetienFragen)) { return; }
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
Nur an den ZWEI Einfuege-Aufrufstellen (garetienNeuKlick/innerorts, garetienFussknopfEinfuegenKlick)
```

neu:

```js
Nur an der Einfuege-Aufrufstelle (garetienFussknopfEinfuegenKlick; „Innerorts einfügen“ fiel am 14.09.2026)
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
	// `einstellungen` (Owner 30.08.2026, Kasten „Wird eingefügt") gilt ALLEN Items eines Aufrufs und
	// ist deshalb nur dort erlaubt, wo der Aufruf auf GENAU EIN Objekt skopiert ist: heute
	// ausschließlich `garetienNeuKlick` („Innerorts einfügen", das damit `{innerorts: true}`
	// schickt -- `avesmapsGaretienInnerortsGewuenscht` entscheidet ausschließlich daraus).
```

neu:

```js
	// `einstellungen` (Owner 30.08.2026, Kasten „Wird eingefügt") gilt ALLEN Items eines Aufrufs und
	// ist deshalb nur dort erlaubt, wo der Aufruf auf GENAU EIN Objekt skopiert ist. 🔴 Seit dem
	// 14.09.2026 hat er KEINEN Aufrufer mehr: der letzte, „Innerorts einfügen", ist gefallen, und eine
	// Stätte reist über `einstellungenJeItem` (garetienEingabenFuerServerOhneName).
```

- [ ] **Schritt 3f: Die Rückfrage vor „zusätzlich“**

**Einfügen** in `review-garetien-importer.js`, direkt **vor** der Zeile `// Die DOM-Hälfte des Fußknopfs: fragt nach, sperrt sich, trägt seinen Stand IN der`:

```js
	// REIN: die Objekte der Stage, deren Zielwahl „zusätzlich" ist.
	function garetienZusaetzlichObjekte(objekte) {
		return (objekte || []).filter(function (o) { return o && garetienZielwahlZu(o) === "zusaetzlich"; });
	}

	/*
	 * REIN: die Rückfrage vor einem Import mit mindestens einem „zusätzlich" -- sie NENNT JEDES solche
	 * Objekt beim Namen (Entwurf §5: „Neues Objekt „Natter" anlegen UND die Garetien-Quelle an das
	 * bestehende „Natter" hängen?").
	 *
	 * 💣 „ZUSÄTZLICH ZU X" IST NIE MEHR STILL. Bis zum 14.09.2026 war es die Folge eines Häkchens, und
	 * ein Klick legte bei 334 Objekten die Dublette an UND ergänzte das bestehende Objekt.
	 * ⚠️ Ein „Abbrechen" importiert NICHTS -- anders als die Mengen-Rückfrage beim Auflegen, die nur die
	 * betroffenen Objekte liegen lässt: hier ist der Fehler mit einem Klick auf der Stage behoben, ein
	 * halber Import dagegen nicht mehr mit einem Klick.
	 */
	function garetienZusaetzlichRueckfrageText(objekte) {
		const liste = objekte || [];
		const zeilen = liste.map(function (o) {
			const neu = garetienNameFuerImport(o).trim() || "(ohne Namen)";
			const ziel = garetienErgaenzungZiel(o);
			const bestand = ziel.name !== "" ? "„" + ziel.name + "“" : "das bestehende Objekt";
			const zahl = ziel.abschnitte > 1
				? " (" + garetienAnzahlText(ziel.abschnitte, "Abschnitt", "Abschnitte") + ")" : "";
			return "• Neues Objekt „" + neu + "“ anlegen UND die Garetien-Quelle an " + bestand + zahl + " hängen.";
		});
		return (liste.length === 1 ? "Zusätzlich anlegen?" : liste.length + " Objekte zusätzlich anlegen?")
			+ "\n\n" + zeilen.join("\n") + "\n\n"
			+ "Danach steht jeweils ein zweites Objekt gleichen Namens auf der Karte. "
			+ "Mit „Abbrechen“ wird nichts importiert — das Ziel lässt sich auf der Stage umstellen.";
	}

```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
		const stand = garetienUebernahmeKnopfZustand(stageObjekte);
		if (stand.gesperrt) { return Promise.resolve(null); }
```

neu:

```js
		const stand = garetienUebernahmeKnopfZustand(stageObjekte);
		if (stand.gesperrt) { return Promise.resolve(null); }
		// 💣 „ZUSÄTZLICH" FRAGT ZUERST, und OHNE `fragen` wird nicht importiert: es ist die eine Wahl,
		// nach der zwei Objekte gleichen Namens auf der Karte stehen (Entwurf §5).
		const zusaetzlich = garetienZusaetzlichObjekte(stageObjekte);
		if (zusaetzlich.length > 0
			&& (typeof fragen !== "function" || !fragen(garetienZusaetzlichRueckfrageText(zusaetzlich)))) {
			return Promise.resolve(null);
		}
```

- [ ] **Schritt 3g: Exporte**

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
			garetienStageItems,
			garetienEinfuegeWahl,
			garetienEinfuegeWahlSetzen,
			garetienEinfuegeWahlVergessen,
			garetienNeuMoeglich,
			garetienQuelleMoeglich,
			garetienNeuItems,
			garetienQuelleItems,
			garetienInnerortsWahlSetzen,
			garetienEinfuegeHakenMarkup,
```

neu:

```js
			garetienStageItems,
			// 14.09.2026 (Bauplan „Garetien-Importer vereint", Aufgabe 9): die Zielwahl -- EINE Wahl
			// statt der zwei Häkchen.
			AVESMAPS_GARETIEN_ZIELE,
			garetienZieleMoeglich,
			garetienZielwahlZu,
			garetienZielwahlSetzen,
			garetienZielwahlVergessen,
			garetienZielwahlMarkup,
			garetienZielwahlTexte,
			garetienZielwahlAusGrund,
			garetienZielNameZeile,
			garetienZielKarteItems,
			garetienErgaenzungZiel,
			garetienQuelleItems,
			garetienInnerortsWahlSetzen,
```

**Entfernen** in `review-garetien-importer.js`:

```js
			garetienNeuKlick,
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
			garetienEinfuegenRueckfrageText,
```

neu:

```js
			garetienEinfuegenRueckfrageText,
			// 14.09.2026: die Rückfrage vor „zusätzlich"
			garetienZusaetzlichObjekte,
			garetienZusaetzlichRueckfrageText,
```

- [ ] **Schritt 3h: Die Nachträge an Aufgabe 6** — alle in Code, den Aufgabe 6 angelegt hat (Anker aus `plan-teil-stage.md`, Aufgabe 6).

In `garetienVerbundZusammenlegbar(objekt)` **einfügen**, direkt nach der Zeile `if (schluessel === "") { return { ok: false, grund: "Dieses Objekt gehört zu keinem Verbund." }; }`:

```js
		// 🔴 AUFGABE 9: ERST DIE ZIELWAHL -- an JEDEM aufgelegten Mitglied. Ein Verbund wird eine Fläche
		// oder ein Weg AUF DER KARTE (Entwurf §6.3); „Stätte", eine Ergänzung oder „Nichts" legen keine
		// Region an, in die mehrere Teile gehören.
		// 💣 JEDES Mitglied, nicht nur das größte: nach dem Zusammenlegen liest die Zielwahl am
		// Verbundschlüssel, und ein „Nichts" an einem kleineren Fragment fiele dabei STILL auf „Auf die
		// Karte" zurück. Der Grund nennt deshalb auch das Fragment, an dem es hängt.
		const ohneKarte = garetienVerbundStageEintraege(schluessel)
			.map(function (eintrag) { return eintrag.objekt; })
			.filter(function (m) { return garetienZielwahlZu(m) !== "karte"; })[0] || null;
		if (ohneKarte) {
			const gewaehltZiel = garetienZielwahlTexte(ohneKarte, garetienZielwahlZu(ohneKarte)).t1;
			const beiFragment = String(ohneKarte.key) === String((objekt || {}).key)
				? "" : " bei „" + String(ohneKarte.name || ohneKarte.key || "") + "“";
			return { ok: false, grund: "Ein Verbund wird eine Fläche oder ein Weg auf der Karte — gewählt ist „"
				+ gewaehltZiel + "“" + beiFragment + "." };
		}
```

Im Kommentar über derselben Funktion **ersetzen** — alt:

```js
	 * 🔧 BIS AUFGABE 9 gibt es keine Zielwahl „karte": geprueft wird die Form (`garetienZielWahlZu(massgeblich).ziel`).
	 * Aufgabe 9 erweitert die Bedingung um `garetienZielwahlZu(objekt) === "karte"`.
```

neu:

```js
	 * 🔴 AUFGABE 9 (14.09.2026): VOR der Form steht die Zielwahl -- an JEDEM aufgelegten Mitglied muss
	 * „Auf die Karte" gewählt sein (Begründung am Block im Rumpf).
```

In `garetienVerbundEinstellungenVergessen(schluessel)` **und** in `garetienVerbundVergessen()` — dieselbe Zeile, beide Male — **ersetzen**:

```js
		[_garetienZielWahl, _garetienNameWahl, _garetienEingabenZustand, _garetienEinfuegeWahl].forEach(function (speicher) {
```

durch:

```js
		[_garetienZielWahl, _garetienNameWahl, _garetienEingabenZustand, _garetienZielwahl].forEach(function (speicher) {
```

In `garetienEinstellungenVergessen()` **ersetzen**: `garetienEinfuegeWahlVergessen();` durch `garetienZielwahlVergessen();`.

💣 Alle drei Nachträge sind Pflicht: `_garetienEinfuegeWahl` und `garetienEinfuegeWahlVergessen` gibt es nach Schritt 3a nicht mehr — ein stehengebliebener Bezug wirft beim ersten „Stage leeren“ oder „Verbund auflösen“ einen `ReferenceError`. ⚠️ `_garetienInnerortsWahl` gehört weiterhin NICHT in die Listen (sie liegt am Objektschlüssel, nie am Verbund). ⚠️ „Verbund auflösen (n)“ bleibt ungesperrt: Aufgabe 7 fragt `garetienVerbundZusammenlegbar` in `garetienVerbundBlockMarkup` nur, solange NICHT zusammengelegt ist — nachgelesen.

- [ ] **Schritt 3i: Die Gestalt der Zielwahl — erst der Vertrag, dann die Regeln**

Die Zielwahl geht nicht als ungestaltete Radioliste live: ihre Regeln kommen zeichengleich aus dem Mockup, und im selben Commit bindet sie ein Vertragsblock (`tools/mockup-vertrag`, läuft im Deploy-Tor).

3i-1. Im Mockup die zwei Kopfkommentare umschreiben, die „keine bindende Marke“ behaupten (:22–23 und :402–403), und die Marken NUR um die Zielwahl-Regeln setzen — `.gi-ziel*` und `.gi-insert__row--aus` (heute :420–434). `.gi-block*` davor bindet Aufgabe 11 in einem eigenen Block, `.gi-ziel-marke` dahinter Aufgabe 12. Die ersten zwei Nadeln beginnen hinter dem Emoji am Zeilenanfang; das Mockup schreibt „…" mit geradem Schlusszeichen (72 zu 0).

**Ersetzen** in `garetien-import-vereint-mockup.html` —

alt:

```html
ENTWURF ZUR ABNAHME. Trägt bewusst KEINE bindende Marke für tools/mockup-vertrag — gebunden
      wird, was der Owner freigibt, und erst dann.
```

neu:

```html
FREIGEGEBEN 14.09.2026. Bindend (tools/mockup-vertrag, Deploy-Tor) sind nur die Regeln zwischen
      den Vertragsmarken im Abschnitt „NEU" — jede kam im Commit, der sie gebaut hat.
```

**Ersetzen** in `garetien-import-vereint-mockup.html` —

alt:

```html
Keine VERTRAG-Marke, solange der Owner nicht abgenommen hat: eine Marke auf ungebautes CSS
      macht tools/mockup-vertrag im Deploy-Tor rot. Gebunden wird im Commit, der die Regel baut.
```

neu:

```html
Eine Vertragsmarke auf ungebautes CSS macht tools/mockup-vertrag im Deploy-Tor rot. Gebunden
      wird deshalb im Commit, der die Regel baut: Aufgabe 9 die Zielwahl und die abgeblendete Zeile,
      Aufgabe 11 die Blöcke, Aufgabe 12 Ziel-Marke und Listenkopf.
```

**Einfügen** in `garetien-import-vereint-mockup.html`, direkt **vor** der Zeile `/* Die Zielwahl. Eine Liste ohne Rahmen (§12): die Wahl ist die Zeile, nicht ein Kasten um sie. */`:

```html
/* ══ VERTRAG: css/components/garetien-importer.css ══ Die Zielwahl (Aufgabe 9, 14.09.2026).
   Jede Eigenschaft bis zur Endmarke steht zeichengleich in der Produktionsdatei (tools/mockup-vertrag). */
```

**Einfügen** in `garetien-import-vereint-mockup.html`, direkt **vor** der Zeile `/* Das Ziel in der Listenzeile — der Text kommt aus garetienStageZeile2 (heute ohne Aufrufer). */`:

```html
/* ══ VERTRAG ENDE ══ */

```

💣 Keiner der zwei neuen Kopfkommentare trägt das Großwort mit Doppelpunkt, und im gebundenen Teil steht die Endmarke nirgends im Fließtext: `tools/mockup-vertrag/mockup-vertrag.js:54` liest `/*`, dann beliebigen Text ohne `*`, dann `VERTRAG:` als Anfangsmarke, und :63 nimmt das nächste `VERTRAG ENDE` als Ende.

3i-2. Den Vertrag fahren, Fehlschlag sehen:

```sh
node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js
```

Erwartet (Exit 1): `MOCKUP-VERTRAG VERLETZT:`, darunter `garetien-import-vereint-mockup.html gegen css/components/garetien-importer.css:` und als erste Zeilen `.gi-ziel { display } fehlt in der Produktionsdatei (Mockup: flex)` und `.gi-ziel { flex-direction } fehlt in der Produktionsdatei (Mockup: column)`, danach jede weitere zugesagte Eigenschaft.

3i-3. Die Regeln in die Produktionsdatei — zeichengleich, mit den Hausmarken wie in `css/components/fenster.css` (:46/:183; das Werkzeug liest nur das Mockup, die Marken sagen dem nächsten Leser, dass hier gebunden ist).

🔴 **Die Stelle ist tragend: HINTER `.gi-insert__row` (:981) und VOR `/* ---- Aufgabe 15: die Handlungsleiste` (:1259).** Hinter, weil `.gi-insert__row--aus` gleich spezifisch ist und die spätere Regel gewinnt. Vor, weil Abschnitt J von `garetien-handlungen.test.js` (:722) ab „Aufgabe 15“ bis ans Dateiende schneidet und dort jedes `\d+px` verbietet — `18px`, `2px 0 0` und `1px` machten ihn rot. Gegenprobe gefahren: an dieser Stelle grün, ans Dateiende verschoben rot (`keine hartkodierten Abstaende -- nur --space-*/--radius-*`). Eingesetzt wird direkt vor dem Abschnitt „Eingefügt wird -> Eingabefelder“ (:996):

**Einfügen** in `garetien-importer.css`, direkt **vor** der Zeile `/* ---- Aufgabe „Eingefügt wird -> Eingabefelder" (30.08.2026, Owner: „warum darf ich das nicht`:

```css
/* ══ VERTRAG: css/components/garetien-importer.css ══
   🔴 DIE ZIELWAHL (Bauplan „Garetien-Importer vereint", Aufgabe 9). Alles zwischen diesen Marken steht
   zeichengleich in docs/garetien-import-vereint-mockup.html (tools/mockup-vertrag/__tests__/
   mockup-vertrag.test.js, laeuft im Deploy-Tor). Wer hier einen Wert aendert, aendert ihn im Mockup mit
   -- oder der Test wird rot.
   ⚠️ Aufgabe 11 bindet `.gi-block` und seine Teile in einem ZWEITEN Block auf diese Datei; das Werkzeug
   prueft jeden Block fuer sich. */

/* Die Zielwahl. Eine Liste ohne Rahmen (§12): die Wahl ist die Zeile, nicht ein Kasten um sie. */
.gi-ziel { display: flex; flex-direction: column; gap: 1px; margin: 0 0 var(--space-4); }
.gi-ziel__option { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: start;
	gap: var(--space-2) var(--space-4); padding: var(--space-2) var(--space-4); border: 1px solid transparent;
	border-radius: var(--radius-md); cursor: pointer; }
.gi-ziel__option:hover { border-color: var(--color-border-strong); }
.gi-ziel__option input { margin: 2px 0 0; accent-color: var(--color-accent-brown); }
.gi-ziel__option.is-gewaehlt { background: var(--color-active-wash); border-color: var(--color-accent); }
.gi-ziel__t1 { font-size: var(--font-size-small); font-weight: var(--font-weight-bold); color: var(--color-text-strong); }
.gi-ziel__t2 { grid-column: 2; font-size: var(--font-size-caption); color: var(--color-text-muted); }
.gi-ziel__option--warn .gi-ziel__t2 { color: var(--color-warning-soft-text); }
/* 💣 Die zweite Zeile einer GEWAEHLTEN Option nimmt die volle Textfarbe: auf der Waesche erreichte das
   gedaempfte Grau im dunklen Thema nur 3,07:1 (Warnzeile 4,40:1) -- Soll 4,5:1 bei 11px. Deshalb auch
   KEINE Waesche beim Ueberfahren (dort 3,98:1), sondern ein kraeftigerer Rahmen. */
.gi-ziel__option.is-gewaehlt .gi-ziel__t2 { color: var(--color-text); }

/* Abgeblendet, nicht ausgeblendet: das Feld bleibt stehen, damit die Spalte nicht springt. */
.gi-insert__row--aus { color: var(--color-disabled-text); }
.gi-insert__row--aus > span:first-child { color: var(--color-disabled-text); }

/* ══ VERTRAG ENDE ══ */

/* Uebergangsort bis Aufgabe 11: die Zielwahl steht in der Handlungsleiste, und `.gi-acts` ist eine
   umbrechende flex-ZEILE -- ohne volle Basis schrumpfte die Liste auf ihre Inhaltsbreite und zoege die
   naechste Zeile daneben (dieselbe Regel wie `.gi-acts .gi-insert__row` weiter unten).
   ⚠️ Ausserhalb des Vertrags: das Mockup zeigt die Liste in Block C, nicht in der Leiste.
   🔧 Aufgabe 11 entfernt diese Regel, wenn die Zielwahl in Block C umzieht. */
.gi-acts > .gi-ziel { flex: 1 0 100%; }

```

⚠️ **Keine spätere Regel der Datei greift in die Zielwahl** — nachgesehen hinter dem Block: `input` kommt nur als `.gi-insert__row--edit input[type="checkbox"]` und unter `.gi-insert .label-edit-*` vor, `span:first-child` gar nicht, und `.gi-acts` (:1274) setzt nur `display`, `flex-wrap`, `gap`. 💣 `.gi-insert__row--edit label { display: inline-flex }` (0,1,1) schlüge `.gi-ziel__option { display: grid }` (0,1,0): die Zielwahl darf nie IN einer `.gi-insert__row--edit` stehen. Hier steht sie direkt in `.gi-acts`.

3i-4. Den Vertrag grün sehen, die Handlungsleiste mit:

```sh
node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js
node js/review/__tests__/garetien-handlungen.test.js
```

Erwartet: `OK -- 17 Zusicherungen, … Mockups geprueft, davon M mit Vertrag.` — M ist die Zahl vor diesem Schritt plus 1 (im Wegwerf-Lauf 11 → 12) —, und `garetien-handlungen` mit Exit 0.

💣 **Jedes `var(--…)` der Regeln ist in `css/base/tokens.css` definiert** — nachgeschlagen, 15 Tokens. Die neun Farben `--color-border-strong`, `--color-text`, `--color-active-wash`, `--color-accent`, `--color-accent-brown`, `--color-text-strong`, `--color-text-muted`, `--color-warning-soft-text`, `--color-disabled-text` tragen einen hellen Wert in `:root` und einen dunklen in `:root[data-theme="dark"]`; `--space-2`, `--space-4`, `--radius-md`, `--font-size-small`, `--font-size-caption`, `--font-weight-bold` sind themenunabhängig und stehen nur in `:root`. Die Literale (`1px`, `2px 0 0`, `18px`, `transparent`) sind Maße bzw. kein Farbwert und stehen so im Mockup.

⚠️ **Zwei Blöcke auf eine Datei gehen.** `vertragsBloecke` sucht nach jeder Anfangsmarke die nächste Endmarke, `vertragPruefen` hält jeden Block einzeln gegen die ganze Datei — am Werkzeug nachgeprüft. Aufgabe 11 setzt ihren Block für `.gi-block*` davor; jede Endmarke muss vor der nächsten Anfangsmarke stehen, sonst verschluckt ein Block den anderen.

3j. **Die tote Abblend-Regel des gefallenen Knopfs streichen.** Mit „Innerorts einfügen" fällt der einzige Träger von `[data-handlung="innerorts"]`; die Regel, die beim Überfahren dieses Knopfs den Kasten abblendete, trifft danach nichts mehr (gefunden beim Entwurf der Aufgabe 11). Abgeblendet wird ab jetzt über `.gi-insert__row--aus` aus 3i. Kein Test liest die Regel (`git grep` über `js` und `tools`: 0 Treffer).

**Löschen** in `css/components/garetien-importer.css` (heute ~:1029–1050) — der ganze Block von

```css
/* „Innerorts einfügen" blendet den Kasten ab, statt ihn zu verstecken (Entwurf
 * docs/superpowers/specs/2026-09-02-innerorts-import-design.md §4).
```

bis einschließlich

```css
.gi-win .avm-col:has(.gi-acts [data-handlung="innerorts"]:hover) .gi-insert,
.gi-win .avm-col:has(.gi-acts [data-handlung="innerorts"]:focus-visible) .gi-insert {
	opacity: .5;
	transition: opacity 120ms ease;
}
```

Gegenprobe: `grep -n 'data-handlung="innerorts"' css/components/garetien-importer.css js/review/review-garetien-importer.js` liefert danach nichts.

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

4a. Den ersetzten Test löschen: `git rm js/review/__tests__/garetien-einfuege-haken.test.js` (seine Zusicherungen — Vorbelegung, Schreibumfang folgt der Anzeige, nichts vor der Stage — stehen in Abschnitt B/C/F des neuen Tests).

4b. `js/review/__tests__/garetien-innerorts-knopf.test.js` — Knopf und `garetienNeuKlick` sind gefallen; das Siedlungsfeld wählt nur noch die Siedlung, die Stätte die Zielwahl:

**Ersetzen** in `garetien-innerorts-knopf.test.js` —

alt:

```js
// „Innerorts einfügen (Stadt)" -- der zweite Knopf neben „Neu einfügen" im Garetien Importer.
// Entwurf: docs/superpowers/specs/2026-09-02-innerorts-import-design.md §4
```

neu:

```js
// Innerorts im Garetien Importer -- Befund-Leser, Siedlungsfeld und der Weg einer Staette.
// Entwurf: docs/superpowers/specs/2026-09-02-innerorts-import-design.md §4
// 🔴 SEIT DEM 14.09.2026 OHNE DEN KNOPF „Innerorts einfügen (Stadt)": er schrieb ohne Rueckfrage in die
// Karte (Befund `innerorts-sofort`). Die Staette waehlt jetzt die Zielwahl („Stätte in X",
// docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §5).
```

**Ersetzen** in `garetien-innerorts-knopf.test.js` —

alt:

```js
// UND der Klickverteiler garetienNeuKlick mit einer fetch-Attrappe -- gemessen am ERGEBNIS, an der
// Folge der Anfragen, die wirklich hinausgehen (dieselbe Bauform wie garetien-handlungen.test.js).
```

neu:

```js
// UND der Weg der Wahl bis in den Anfragerumpf -- ausgefuehrt ueber garetienEingabenAendern, nicht
// am Quelltext gelesen. Den Ablauf ueber den Fussknopf faehrt garetien-import-verdrahtung.test.js (B).
```

**Ersetzen** in `garetien-innerorts-knopf.test.js` —

alt:

```js
["garetienInnerortsOrt", "garetienHandlungen", "garetienHandlungTitel", "garetienNeuKlick",
```

neu:

```js
["garetienInnerortsOrt", "garetienHandlungen", "garetienHandlungTitel", "garetienHandlungsRumpf",
	"garetienZielwahlSetzen", "garetienZielwahlMarkup", "avesmapsGaretienStageHinzufuegen",
	"avesmapsGaretienStageLeeren", "garetienZielwahlVergessen",
```

**Ersetzen** in `garetien-innerorts-knopf.test.js`: den Block von `// B. Die Knopfleiste` bis einschließlich `} ⏎ // =================================================================================================` (154 Zeilen) durch:

```js
// B. Die Knopfleiste -- „Innerorts einfügen (X)" IST GEFALLEN (14.09.2026)
// =================================================================================================
// 🔴 Er war der einzige Knopf, der ohne Rueckfrage in die Karte schrieb -- schon auf „Offen", neben
// einem Tooltip, der verspricht, dass nichts geschrieben wird, bis „Stage importieren" gedrueckt ist.
// Was er konnte, kann die Zielwahl („Stätte in X"), und die geht ueber die Stage -- gefahren in
// garetien-zielwahl-ziele.test.js (C, E) und garetien-import-verdrahtung.test.js (B).
tief(namen(mitBefund), ["stage", "ablehnen"], "🔴 auch MIT Befund steht kein Innerorts-Knopf mehr da");
tief(namen(ohneBefund), ["stage", "ablehnen"], "ohne Befund ebenso");
tief(namen(altLauf), ["stage", "ablehnen"], "ein alter Lauf ebenso");
gleich(mod.garetienHandlungsRumpf("innerorts", mitBefund, 7), null,
	"💣 und die TUER bleibt zu, auch wenn jemand „innerorts\" von Hand schickt");
gleich(mod.garetienHandlungTitel("innerorts", mitBefund), "", "…und es gibt keinen Tooltip mehr dafuer");

// =================================================================================================
```

**Ersetzen** in `garetien-innerorts-knopf.test.js` —

alt:

```js
	innerorts: {
		public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09,
		kandidaten: [
```

neu:

```js
	stand: "offen",
	innerorts: {
		public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09,
		kandidaten: [
```

**Ersetzen** in `garetien-innerorts-knopf.test.js` —

alt:

```js
	const zeile = mod.garetienInnerortsZeileMarkup(mitListe, false);
	wahr(zeile.includes('data-gi-feld="innerorts"'), "das Feld traegt seinen Namen: " + zeile);
	wahr(zeile.indexOf("— auf die Karte —") !== -1, "der erste Eintrag ist „auf die Karte\"");
	wahr(/<option value=""[^>]* selected/.test(zeile),
		"💣 UND ER IST VORAUSGEWAEHLT. Eine vorbelegte Stadt legte beim naechsten „Stage importieren\" "
		+ "fuer dreihundert Objekte stillschweigend Staetten an, statt Kartenpunkte: " + zeile);
	wahr(zeile.indexOf("Aue · 0,03 Meilen") < zeile.indexOf("Wandleth · 0,09 Meilen"),
		"beide Staedte stehen drin, in der Reihenfolge des Servers");
	wahr(!zeile.includes("Wird als Stätte in"),
		"...und solange nichts gewaehlt ist, behauptet nichts eine Staette");
	wahr(mod.garetienInnerortsZeileMarkup(mitListe, true).includes(" disabled"),
		"an einem uebernommenen Objekt ist das Feld gesperrt, wie jedes andere des Kastens");
```

neu:

```js
	const zeile = mod.garetienInnerortsZeileMarkup(mitListe, false);
	wahr(zeile.includes('data-gi-feld="innerorts"'), "das Feld traegt seinen Namen: " + zeile);
	gleich(zeile.indexOf("— auf die Karte —"), -1,
		"🔴 SEIT DEM 14.09.2026 KEIN „— auf die Karte —\": das entscheidet die Zielwahl, nicht dieses Feld");
	wahr(zeile.includes('class="gi-insert__row gi-insert__row--aus">Siedlung')
		&& /data-gi-feld="innerorts"[^>]* disabled/.test(zeile),
		"💣 solange die Zielwahl „Auf die Karte\" ist, ist die Siedlung ABGEBLENDET -- eine vorbelegte Stadt "
		+ "legte beim naechsten „Stage importieren\" sonst still Staetten an: " + zeile);
	wahr(zeile.indexOf("Aue · 0,03 Meilen") < zeile.indexOf("Wandleth · 0,09 Meilen"),
		"beide Staedte stehen drin, in der Reihenfolge des Servers");
	wahr(/<option value="stadt-wandleth" selected>/.test(zeile),
		"vorgewaehlt ist die Vorauswahl des Servers -- nicht die naechste Siedlung");
	wahr(!zeile.includes("Wird als Stätte in"),
		"...und das Feld behauptet keine Staette -- das sagt die Zielwahl selbst");
	wahr(mod.garetienInnerortsZeileMarkup(mitListe, true).includes(" disabled"),
		"an einem uebernommenen Objekt ist das Feld gesperrt, wie jedes andere des Kastens");
```

**Ersetzen** in `garetien-innerorts-knopf.test.js`: den Block von `// --- Mit Wahl: der ECHTE Weg, ueber garetienEingabenAendern ----------------------------` bis einschließlich `wahr(mod.garetienInnerortsZeileMarkup(mitListe, false).includes("OHNE Position auf der Karte"), ⏎ "und die Zeile darunter sagt, was das heisst -- sonst behauptet der Kasten weiter „Form: Ort\"");` (34 Zeilen) durch:

```js
	// --- Mit Wahl: der ECHTE Weg, ueber garetienEingabenAendern ----------------------------
	// 🔴 AUSGEFUEHRT, NICHT GELESEN: ein Regex auf den Quelltext kennt keinen Geltungsbereich, und
	// genau daran ist am 03.09.2026 eine Regression zwei Stunden lang unbemerkt live gestanden
	// (AGENTS.md §11, „Die Landschaft traegt die Quellen").
	// ⚠️ Das Objekt liegt dafuer auf der Stage: dort -- und nur dort -- ist die Einzelansicht einstellbar.
	mod.avesmapsGaretienStageHinzufuegen([mitListe]);
	mod.garetienDetailWaehlen(mitListe.key, [mitListe]);
	const feld = (name, wert) => ({ target: {
		getAttribute: (a) => (a === "data-gi-feld" ? name : null),
		hasAttribute: (a) => a === "data-gi-feld",
		value: wert,
	} });
	mod.garetienEingabenAendern(feld("innerorts", "dorf-aue"), [mitListe]);
	gleich(mod.garetienInnerortsWahlZu(mitListe), "dorf-aue", "die Wahl liegt neben dem DOM und haelt");
	gleich(mod.garetienInnerortsZiel(mitListe).name, "Aue", "🔴 und der Leser nennt jetzt SIE");
	wahr(!("innerorts" in mod.garetienEingabenFuerServer(mitListe)),
		"💣 EINE GEWAEHLTE SIEDLUNG ALLEIN IST KEINE STAETTE -- das sagt erst die Zielwahl");
	mod.garetienEingabenAendern(feld("zielwahl", "staette"), [mitListe]);
	// 💣 AN DER ZIELWAHL SELBST GEMESSEN, nicht nur am Leser dahinter: sagte die Zeile „Stätte in
	// Wandleth", waehrend die Anfrage „dorf-aue" schickt, waere genau die Verwechslung zurueck, gegen die
	// der Ortsname ueberhaupt in der Zeile steht (Mutationsprobe 07.09.2026, damals am Knopf).
	wahr(mod.garetienZielwahlMarkup(mitListe).includes("Stätte in „Aue“"),
		"die Zielwahl traegt die gewaehlte Siedlung: " + mod.garetienZielwahlMarkup(mitListe));
	const mitWahl = mod.garetienEingabenFuerServer(mitListe);
	tief(mitWahl, { innerorts: true, innerorts_public_id: "dorf-aue" },
		"⭐ DADURCH WIRKT INNERORTS UEBER DIE STAGE: " + JSON.stringify(mitWahl));
	wahr(!("ziel" in mitWahl),
		"💣 UND KEIN `ziel`: avesmapsGaretienZielUebersteuern laeuft serverseitig VOR der "
		+ "Innerorts-Weiche und formte die Geometrie fuer ein Ziel um, das nie gebaut wird");
	wahr(mod.garetienInnerortsZeileMarkup(mitListe, false).includes('class="gi-insert__row">Siedlung'),
		"und mit „Stätte\" ist die Siedlung bedienbar");
```

**Ersetzen** in `garetien-innerorts-knopf.test.js` —

alt:

```js
	gleich(mod.garetienInnerortsZiel(mitListe).name, "Wandleth", "...und der Knopf faellt auf die Vorauswahl zurueck");
	mod.garetienDetailWaehlen(null, []);
	mod.garetienInnerortsWahlVergessen();
```

neu:

```js
	gleich(mod.garetienInnerortsZiel(mitListe).name, "Wandleth", "...und der Leser faellt auf die Vorauswahl zurueck");
	mod.garetienDetailWaehlen(null, []);
	mod.garetienInnerortsWahlVergessen();
	mod.garetienZielwahlVergessen();
	mod.avesmapsGaretienStageLeeren();
```

**Ersetzen** in `garetien-innerorts-knopf.test.js` —

alt:

```js
pruefeKlick().then(() => {
	pruefeUebernommen();
	pruefeAuswahlfeld();
	console.log("OK: " + checks + " Pruefungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
```

neu:

```js
Promise.resolve().then(() => {
	pruefeUebernommen();
	pruefeAuswahlfeld();
	console.log("OK: " + checks + " Pruefungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
```

4c. `js/review/__tests__/garetien-vorwaertsknopf.test.js` — „nur Ansicht“ sagt die Zielwahl, „Innerorts einfügen“ steht nicht mehr neben dem Vorwärtsknopf:

**Ersetzen** in `garetien-vorwaertsknopf.test.js` —

alt:

```js
	// 🔴 SEIT 09.09.2026 STEHT „Neu einfügen“ WIEDER IM MARKUP -- aber als HAEKCHEN, nicht
	// als Knopf (Owner: „sollten das häkchen sein“). Der Unterschied ist der ganze Grund, warum
	// der Knopf am 07.09.2026 fiel: er legte SOFORT an und umging die Stage. Das Häkchen
	// entscheidet nur, was die Stage mitnimmt -- der Weg ueber „Stage importieren“ bleibt
	// erzwungen. ⚠️ Geprueft wird deshalb das HANDLUNGSATTRIBUT, nicht mehr die Zeichenkette.
```

neu:

```js
	// 🔴 SEIT 14.09.2026 GIBT ES AUCH DIE HAEKCHEN NICHT MEHR -- „Neu einfügen" ist ein Wert der
	// Zielwahl („Auf die Karte"). Geprueft wird weiter das HANDLUNGSATTRIBUT: kein Knopf umgeht die Stage.
```

**Ersetzen** in `garetien-vorwaertsknopf.test.js` —

alt:

```js
sagen die zwei Haekchen -- der Knopf behauptet nichts mehr.
```

neu:

```js
sagt die Zielwahl -- der Knopf behauptet nichts mehr.
```

**Ersetzen** in `garetien-vorwaertsknopf.test.js` —

alt:

```js
// 🔴 SEIT 09.09.2026 SAGT ES DER KASTEN, NICHT DER KNOPF (garetienEinfuegeHakenMarkup).
// Der Satz durfte nicht ersatzlos fallen: ohne ihn sieht ein Objekt ohne Vorschlag aus wie eines
// mit, nur ohne Haekchen -- und das liest sich wie ein Fehler.
// 🔴 UND ERST AUF DER STAGE (Owner 09.09.2026). Davor steht im Kasten gar nichts: die Frage
// „was soll eingefuegt werden" stellt sich erst, wenn das Objekt aufliegt.
wahr(api.garetienEinfuegeHakenMarkup(offenOhneVorschlag) === "",
	"vor der Stage zeigt der Kasten nichts");
api.avesmapsGaretienStageHinzufuegen([offenOhneVorschlag]);
wahr(api.garetienEinfuegeHakenMarkup(offenOhneVorschlag).includes("nur Ansicht"),
	"auf der Stage sagt der Kasten „nur Ansicht\"");
```

neu:

```js
// 🔴 SEIT 14.09.2026 SAGT ES DIE ZIELWAHL (garetienZielwahlMarkup), NICHT MEHR EIN HAEKCHEN-KASTEN.
// Der Satz durfte nicht ersatzlos fallen: ohne ihn sieht ein Objekt ohne Vorschlag aus wie eines mit.
// 🔴 UND ERST AUF DER STAGE (Owner 09.09.2026).
wahr(api.garetienZielwahlMarkup(offenOhneVorschlag) === "",
	"vor der Stage zeigt die Zielwahl nichts");
api.avesmapsGaretienStageHinzufuegen([offenOhneVorschlag]);
wahr(api.garetienZielwahlMarkup(offenOhneVorschlag).includes("Nichts — nur ansehen"),
	"auf der Stage sagt die Zielwahl „Nichts — nur ansehen\"");
```

**Ersetzen** in `garetien-vorwaertsknopf.test.js` —

alt:

```js
dort liegt, sagen die Haekchen darueber.
```

neu:

```js
dort liegt, sagt die Zielwahl darueber.
```

**Ersetzen** in `garetien-vorwaertsknopf.test.js`: den Block von `// 5. 🔴 „Innerorts einfügen (Stadt)" BLEIBT -- und das ist eine gemessene Abweichung vom Brief.` bis einschließlich `wahr(knopf(innerorts, "innerorts").beschriftung.includes("Wandleth"), ⏎ "und nennt die Stadt weiterhin im Knopf");` (14 Zeilen) durch:

```js
// 5. 🔴 „Innerorts einfügen (Stadt)" IST GEFALLEN (14.09.2026) -- die Zielwahl „Stätte in X" traegt
//    die Staette ueber die Stage (Entwurf 2026-09-14 §2, Befund `innerorts-sofort`).
// =================================================================================================
const innerorts = {
	key: "e", stand: "offen", urteil: "neu", name: "Tempel des Praios",
	innerorts: { name: "Wandleth", public_id: "Ort-9" },
	items: [{ id: 3, change_type: "new" }],
};
tief(namen(innerorts), ["stage", "ablehnen"],
	"🔴 auch MIT Befund nur der Vorwaertsknopf -- kein Einzel-Schreibweg an der Stage vorbei");
```

4d. `js/review/__tests__/garetien-name-aendern.test.js` — das Namensfeld steht in der Handlungsleiste unter der Zielwahl:

**Ersetzen** in `garetien-name-aendern.test.js` —

alt:

```js
pruefe(api.garetienEinfuegeHakenMarkup(o) === "", "vor der Stage kein Kasten und kein Namensfeld");
```

neu:

```js
// 🔴 Seit dem 14.09.2026 steht das Namensfeld unter der Zielwahl in der Handlungsleiste.
pruefe(!api.garetienHandlungsMarkup(o).includes('data-gi-feld="einfuegeName"'), "vor der Stage kein Namensfeld");
```

**Ersetzen** in `garetien-name-aendern.test.js` —

alt:

```js
let mk = api.garetienEinfuegeHakenMarkup(o);
```

neu:

```js
let mk = api.garetienHandlungsMarkup(o);
```

4e. `js/review/__tests__/garetien-verbund-einstellungen.test.js` — der fünfte Speicher ist die Zielwahl; der Verhaltensteil legt vor dem Zusammenlegen auf (Aufgabe 6):

**Ersetzen** in `garetien-verbund-einstellungen.test.js` —

alt:

```js
    // 🪤 "garetienEinfuegeWahl" ist PRAEFIX von "garetienEinfuegeWahlVergessen" (weiter oben in
    // der Datei definiert) und von "garetienEinfuegeWahlSetzen" -- ein blosser Namenslauf faende
    // per `indexOf` die FALSCHE (fruehere) Funktion und der Test waere vakuum. Die volle Signatur
    // mit Parameter macht die Fundstelle eindeutig.
    { name: "garetienEinfuegeWahl", sucheAls: "function garetienEinfuegeWahl(objekt)" }
```

neu:

```js
    // 🔴 14.09.2026: der FUENFTE Speicher ist die ZIELWAHL (vorher die zwei Haekchen,
    // `garetienEinfuegeWahl`). 🪤 `garetienZielwahlZu` unterscheidet sich von `garetienZielWahlZu`
    // (Zeile darueber) NUR im „w" -- `indexOf` ist gross/klein-empfindlich, die volle Signatur mit
    // Parameter haelt die Fundstelle trotzdem eindeutig.
    { name: "garetienZielwahlZu", sucheAls: "function garetienZielwahlZu(objekt)" }
```

**Ersetzen** in `garetien-verbund-einstellungen.test.js` —

alt:

```js
["garetienNameWahlSetzen", "garetienEinfuegeWahlSetzen"]
```

neu:

```js
["garetienNameWahlSetzen", "garetienZielwahlSetzen"]
```

**Ersetzen** in `garetien-verbund-einstellungen.test.js`: den Block von `// Fixrunde 1 -- Verhaltenszusicherung: der FUENFTE Speicher teilt sich wirklich` bis einschließlich `"OHNE Zusammenlegung bleibt m2 bei seiner eigenen (unangetasteten) Vorbelegung"); ⏎ })();` (64 Zeilen) durch:

```js
// Verhaltenszusicherung: der FUENFTE Speicher (seit 14.09.2026 die Zielwahl) teilt sich wirklich
// =================================================================================================
//
// Die Quelltextpruefung oben zeigt nur, dass die richtige FUNKTION gerufen wird -- sie belegt nicht,
// dass zwei Fragmente eines zusammengelegten Verbunds ihre Wahl WIRKLICH teilen und zwei NICHT
// zusammengelegte ihre eigene behalten. Dafuer laeuft das echte Modul.
//
// 🔴 Beide Fragmente tragen ein Neu-Item -- ihre Vorbelegung ist „karte"; umgeschaltet wird auf
// „nichts", damit der gepruefte Wert vom Ausgangswert unterscheidbar ist.
const { api } = ladeImporter();

function garetienZweiFragmente() {
    // Aufgabe 6: Zusammenlegen verlangt die Form Flaeche -- ohne `ziel` waere es gesperrt.
    const verbund = { ebene: "region", typ: "wald", verbund_stamm: "Pruefwald-Fixrunde1",
        verbund_n: 2, ziel: "region", subtyp: "wald" };
    const item = [{ id: 1, change_type: "new", anlass: "", felder: ["quelle"] }];
    return [
        Object.assign({ key: "ggp:pruefwald:eins", items: item }, verbund),
        Object.assign({ key: "ggp:pruefwald:zwei", items: item }, verbund),
    ];
}

function aufraeumen() {
    // ⚠️ Seit Aufgabe 6 lebt „zusammengelegt" am Stage-Eintrag und stirbt mit „Stage leeren";
    // `garetienVerbundVergessen` wird gerufen, solange es die Funktion gibt.
    if (typeof api.garetienVerbundVergessen === "function") { api.garetienVerbundVergessen(); }
    api.garetienZielwahlVergessen();
    api.avesmapsGaretienStageLeeren();
}

// ---- Zusammengelegt: die Wahl an EINEM Mitglied gilt am ANDEREN --------------------------------
(function () {
    aufraeumen();
    const [m1, m2] = garetienZweiFragmente();
    const schluessel = api.garetienVerbundSchluessel(m1);
    assert.ok(schluessel !== "", "Testaufbau: die zwei Fragmente bilden einen Verbund");
    // ⚠️ Erst auflegen, dann zusammenlegen -- seit Aufgabe 6 legt Zusammenlegen nicht mehr selbst auf.
    api.avesmapsGaretienStageHinzufuegen([m1, m2]);
    assert.strictEqual(api.garetienVerbundZusammenlegen(schluessel, [m1, m2]), 2,
        "Testaufbau: beide Fragmente liegen auf der Stage und sind zusammengelegt");
    assert.ok(api.garetienVerbundIstZusammen(schluessel),
        "Testaufbau: der Verbund gilt als zusammengelegt");

    assert.strictEqual(api.garetienZielwahlZu(m2), "karte",
        "Testaufbau: die Vorbelegung ist „karte\", bevor irgendwer etwas waehlt");

    api.garetienZielwahlSetzen(m1, "nichts");
    assert.strictEqual(api.garetienZielwahlZu(m2), "nichts",
        "zusammengelegter Verbund: die Wahl an EINEM Fragment gilt am ANDEREN");
})();

// ---- Ohne Zusammenlegung: jedes Fragment behaelt seine eigene Wahl -----------------------------
(function () {
    aufraeumen();
    const [m1, m2] = garetienZweiFragmente();
    const schluessel = api.garetienVerbundSchluessel(m1);
    assert.ok(!api.garetienVerbundIstZusammen(schluessel),
        "Testaufbau: derselbe Verbund ist diesmal NICHT zusammengelegt");

    api.garetienZielwahlSetzen(m1, "nichts");
    assert.strictEqual(api.garetienZielwahlZu(m1), "nichts", "m1 traegt seine eigene Wahl");
    assert.strictEqual(api.garetienZielwahlZu(m2), "karte",
        "OHNE Zusammenlegung bleibt m2 bei seiner eigenen (unangetasteten) Vorbelegung");
})();
```

4f. `js/review/__tests__/garetien-zusatz-auf-die-stage.test.js` — die Ziel-Marke liest die Zielwahl:

**Ersetzen** in `garetien-zusatz-auf-die-stage.test.js`: den Block von `// 3. DER KNOPF SAGT JETZT DIE WAHRHEIT -- vier Lagen, vier zweite Zeilen.` bis einschließlich `gleich(garetienStageKnopfBauen(nurZusatz).zeile2, "", ⏎ "…und der Bauer reicht sie NICHT mehr durch -- das sagen die Haekchen");` (16 Zeilen) durch:

```js
// 3. DIE ZIEL-MARKE SAGT, WAS DER IMPORT TUT -- seit dem 14.09.2026 aus der ZIELWAHL.
// =================================================================================================
// 🔴 garetienStageZeile2 liest garetienZielwahlZu -- dieselbe Weiche wie garetienStageItems. „liegt als …"
// ist gefallen: der Text haengt nicht mehr daran, ob das Objekt aufliegt.
gleich(garetienStageZeile2(echtNeu, false), "als Fläche · suempfe_moore");
gleich(garetienStageZeile2(nurZusatz, false), "als Weg · Flussweg",
	"🔴 das Zusatz-Objekt OHNE Ergaenzung: Vorbelegung „Auf die Karte\" -- „zusätzlich\" ist seit dem "
	+ "14.09.2026 eine eigene WAHL, und die gibt es nur neben einer Ergaenzung (garetien-zielwahl-ziele.test.js)");
gleich(garetienStageZeile2(nurZusatz, true), "als Weg · Flussweg", "…auf und neben der Stage derselbe Text");
gleich(garetienStageZeile2(gemischt, false), "Quelle am bestehenden Objekt",
	"💣 die gemischte Lage legt NICHTS an -- „als Fläche\" waere die Beschreibung einer anderen Handlung");
gleich(garetienStageZeile2(nurErgaenzung, false), "Quelle am bestehenden Objekt");
gleich(garetienStageZeile2(ohneAlles, false), "nur Ansicht");
gleich(garetienStageKnopfBauen(nurZusatz).zeile2, "",
	"…und der Knopf reicht sie NICHT durch -- das sagt die Zielwahl");
```

4g. `js/review/__tests__/garetien-import-verdrahtung.test.js` — Abschnitt B fährt „Stätte in X“ über den Fußknopf statt über `garetienNeuKlick`:

**Ersetzen** in `garetien-import-verdrahtung.test.js` —

alt:

```js
// fehlt, oder der Fehlschlag-Filter fehlt. Diese Datei führt BEIDE Klickverteiler
// (garetienFussknopfEinfuegenKlick, garetienNeuKlick) mit einer `fetch`-Attrappe wirklich aus, wie
```

neu:

```js
// fehlt, oder der Fehlschlag-Filter fehlt. Diese Datei führt den Klickverteiler
// garetienFussknopfEinfuegenKlick mit einer `fetch`-Attrappe wirklich aus -- seit dem 14.09.2026 auch
// für „Stätte in X" (garetienNeuKlick ist mit „Innerorts einfügen" gefallen) --, wie
```

**Ersetzen** in `garetien-import-verdrahtung.test.js`: den Block von `// B. „Neu einfügen": derselbe Mechanismus am ANDEREN Klickverteiler` bis einschließlich `global.fetch = echtesFetch; ⏎ }` (114 Zeilen) durch:

```js
// B. „Stätte in X" über den Fußknopf -- derselbe Mechanismus, seit dem 14.09.2026 über die Zielwahl
// =================================================================================================
// 🔴 BIS ZUM 14.09.2026 FUHR DIESER ABSCHNITT DEN EINZELKNOPF „Innerorts einfügen" (garetienNeuKlick).
// Der Knopf ist gefallen (er schrieb ohne Rückfrage in die Karte); die Stätte geht jetzt über den EINEN
// Schreibweg „Stage importieren" -- und genau das wird hier gemessen: select → apply → Meldung → Rückgängig.
// 💣 Das Objekt trägt einen Innerorts-Befund UND die Bauwerks-Form -- ohne beides steht „Stätte" gar nicht
// zur Wahl, und die Zielwahl fiele still auf „Auf die Karte" zurück.
function staetteObjekt(key, itemId) {
	return {
		key: key, stand: "offen", urteil: "neu", name: "Tempel " + itemId, typ: "Tempel",
		ziel: "location", subtyp: "gebaeude", geometrie: [[1, 1]], abschnitte: [],
		innerorts: { name: "Wandleth", public_id: "Ort-9", meilen: 0.4,
			kandidaten: [{ name: "Wandleth", public_id: "Ort-9", meilen: 0.4, nennt_name: true }] },
		items: [{ id: itemId, change_type: "new", selected: 0 }],
	};
}

async function pruefeStaetteErfolg() {
	const { api, dom } = ladeImporter(EXTRA_IDS);
	const objekt = staetteObjekt("neu:1", 901);
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([objekt]);
	api.garetienZielwahlSetzen(objekt, "staette");

	const f = machFetch(function (rumpf) {
		if (rumpf.action === "select") { return { ok: true }; }
		if (rumpf.action === "apply") {
			return {
				ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1, remaining: 0,
				skipped: 0, declined: 0, fehler: [],
				angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 1, quelle: 0 },
			};
		}
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") { return { ok: true, objekte: [] }; }
		if (rumpf.action === "liste") { return listeAntwortMitRuheBilanz(); }
		if (rumpf.action === "ruecknahme") { return { ok: true, zurueckgenommen: 1, fehler: [] }; }
		throw new Error("unerwartet: " + rumpf.action);
	});
	const echtesFetch = global.fetch;
	global.fetch = f.fn;

	await api.garetienFussknopfEinfuegenKlick(4711, function () { return true; });

	const apply = f.angefragt.filter(function (a) { return a.rumpf.action === "apply"; });
	gleich(apply.length, 1, "genau ein apply");
	tief(apply[0].rumpf.einstellungen_je_item, { "901": { innerorts: true, innerorts_public_id: "Ort-9" } },
		"💣 „Stätte in X\" erreicht den Server -- bis zum 14.09.2026 sprang der Fußknopf hier auf „0 von 1\"");
	const text1 = dom.text("#garetien-status-text");
	wahr(text1.includes("importiert"), "die Stätte meldet über garetienImportMeldung: " + text1);
	wahr(!text1.includes("mit Vorschlag"), "…und nicht die Ruhe-Bilanz: " + text1);
	gleich(dom.text("#garetien-status-aktion"), "Rückgängig", "und bietet Rückgängig an");

	f.angefragt.length = 0;
	dom.klick("#garetien-status-aktion");
	await tick(); await tick(); await tick();
	const ruecknahme = f.angefragt.filter(function (a) { return a.rumpf.action === "ruecknahme"; });
	gleich(ruecknahme.length, 1, "ein Ruecknahme-Aufruf");
	tief(ruecknahme[0].rumpf.ids, [901], "mit der einen new-id dieses Objekts");

	global.fetch = echtesFetch;
}

async function pruefeStaetteScheitert() {
	const { api, dom, ELEMENTE } = ladeImporter(EXTRA_IDS);
	const objekt = staetteObjekt("neu:2", 902);
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([objekt]);
	api.garetienZielwahlSetzen(objekt, "staette");

	const f = machFetch(function (rumpf) {
		if (rumpf.action === "select") { return { ok: true }; }
		if (rumpf.action === "apply") {
			return {
				ok: true, done: true, applied: 0, deleted: 0, stale: 0, processed: 1, remaining: 0,
				skipped: 1, declined: 0, fehler: [{ item: 902, grund: "Y" }],
				angelegt_je_form: { path: 0, bach: 0, region: 0, label: 0, location: 0, settlement_place: 0, quelle: 0 },
			};
		}
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") { return { ok: true, objekte: [] }; }
		if (rumpf.action === "liste") { return listeAntwortMitRuheBilanz(); }
		throw new Error("unerwartet: " + rumpf.action);
	});
	const echtesFetch = global.fetch;
	global.fetch = f.fn;

	await api.garetienFussknopfEinfuegenKlick(4711, function () { return true; });

	const text1 = dom.text("#garetien-status-text");
	wahr(text1.includes("nicht importiert"), "der Fehlschlag steht in der Meldung: " + text1);
	// 🔴 Befund 3: das EINZIGE Item ist gescheitert -- KEIN "Rückgängig" anbieten.
	gleich(ELEMENTE["garetien-status-aktion"].hidden, true, "kein Link, wenn alles gescheitert ist");
	gleich(dom.text("#garetien-status-aktion"), "", "…und ohne Beschriftung");

	global.fetch = echtesFetch;
}
```

**Ersetzen** in `garetien-import-verdrahtung.test.js` —

alt:

```js
// Meldung darf NICHT verschluckt werden. Beide Klickverteiler, sonst bindet die Regel nur einen
// von zwei Erzeugern.
```

neu:

```js
// Meldung darf NICHT verschluckt werden. Seit dem 14.09.2026 gibt es nur noch EINEN Erzeuger (den
// Fußknopf) -- die Probe am gefallenen garetienNeuKlick ist mit ihm entfallen.
```

**Entfernen** in `garetien-import-verdrahtung.test.js`: den Block von `async function pruefeNeuKlickListenfehler() {` bis einschließlich `global.fetch = echtesFetch; ⏎ }` (36 Zeilen, samt der Leerzeile danach).

**Ersetzen** in `garetien-import-verdrahtung.test.js` —

alt:

```js
pruefeFussknopf()
	.then(pruefeNeuKlickErfolg)
	.then(pruefeNeuKlickScheitert)
	.then(pruefeFussknopfListenfehler)
	.then(pruefeNeuKlickListenfehler)
```

neu:

```js
pruefeFussknopf()
	.then(pruefeStaetteErfolg)
	.then(pruefeStaetteScheitert)
	.then(pruefeFussknopfListenfehler)
```

4h. `js/review/__tests__/garetien-stage-nachschlagen.test.js` — eine Aufrufstelle weniger:

**Ersetzen** in `garetien-stage-nachschlagen.test.js` —

alt:

```js
	// Und die Nachfolgerin steht wirklich an allen fuenf erwarteten Stellen: Definition, Export,
	// und den drei Aufrufen (garetienLaufStarten, garetienNeuKlick, garetienFussknopfEinfuegenKlick).
	// Faellt eine davon auf die alte Bereinigung zurueck, sinkt die Zaehlung unter 5.
	const vorkommen = quelle.split("garetienStageNachschlagen").length - 1;
	wahr(vorkommen >= 5,
		"garetienStageNachschlagen sollte an mindestens 5 Stellen stehen (Definition, Export, "
		+ "drei Aufrufe) -- gefunden: " + vorkommen);
```

neu:

```js
	// Und die Nachfolgerin steht wirklich an allen VIER erwarteten Stellen: Definition, Export und den
	// zwei Aufrufen (garetienLaufStarten, garetienFussknopfEinfuegenKlick). 🔴 Bis zum 14.09.2026 waren es
	// fuenf -- der dritte Aufruf stand in garetienNeuKlick und ist mit „Innerorts einfügen" gefallen.
	// Faellt eine davon auf die alte Bereinigung zurueck, sinkt die Zaehlung unter 4.
	const vorkommen = quelle.split("garetienStageNachschlagen").length - 1;
	wahr(vorkommen >= 4,
		"garetienStageNachschlagen sollte an mindestens 4 Stellen stehen (Definition, Export, "
		+ "zwei Aufrufe) -- gefunden: " + vorkommen);
```

**Ersetzen** in `garetien-stage-nachschlagen.test.js`: den Block von `// D. Fixrunde 2 (07.09.2026), D2+D3: dieselbe Endezu-Ende-Probe wie Abschnitt C, jetzt an den` bis einschließlich `//    Schluesselmengen bereits rein getestet (Abschnitt A2); hier zaehlt fuer den Fussknopf nur ⏎ //    Zusicherung 1.` (16 Zeilen) durch:

```js
// D. Fixrunde 2 (07.09.2026), D2+D3: dieselbe Endezu-Ende-Probe wie Abschnitt C, an der
//    EINFUEGE-Aufrufstelle garetienFussknopfEinfuegenKlick.
//    🔴 14.09.2026: die zweite Aufrufstelle (garetienNeuKlick/„innerorts") ist mit „Innerorts einfügen"
//    gefallen -- und mit ihr die einzige Ende-zu-Ende-Probe der Zusicherung „ein FREMDES fertiges Objekt
//    bleibt gemeldet". Am Fussknopf laesst sie sich nicht nachstellen (er verarbeitet per Definition die
//    GANZE Stage); die Filterung selbst bleibt an beliebigen Schluesselmengen rein getestet (Abschnitt A2).
```

**Entfernen** in `garetien-stage-nachschlagen.test.js`: den Block von `// Ein Klick-Ereignis fuer garetienNeuKlick("innerorts") -- derselbe minimalistische Aufbau wie in` bis einschließlich `} ⏎ }` (68 Zeilen, samt der Leerzeile danach).

**Entfernen** in `garetien-stage-nachschlagen.test.js`:

```js
	.then(function () { return pruefeAnschlussNeuKlick(api, dom); })
```

4i. `js/review/__tests__/garetien-handlungen.test.js` — nur der Kommentar, der auf den gefallenen Weg zeigt:

**Ersetzen** in `garetien-handlungen.test.js` —

alt:

```js
// (Owner-Punkt 12: angelegt wird ueber „Stage importieren"). Denselben Ablauf (select → apply → liste, mit Riegel und Knopfsperre) faehrt weiterhin garetien-innerorts-knopf.test.js ueber „Innerorts einfügen" -- den EINEN Aufrufer, der garetienNeuKlick noch hat.
```

neu:

```js
// (Owner-Punkt 12: angelegt wird ueber „Stage importieren"). Denselben Ablauf (select → apply → liste) faehrt seit dem 14.09.2026 garetien-import-verdrahtung.test.js ueber „Stätte in X" am Fußknopf -- garetienNeuKlick ist mit „Innerorts einfügen" gefallen.
```

4j. Fahren:

```sh
node js/review/__tests__/garetien-zielwahl-ziele.test.js
for t in garetien-innerorts-knopf garetien-vorwaertsknopf garetien-name-aendern garetien-verbund-einstellungen garetien-zusatz-auf-die-stage garetien-import-verdrahtung garetien-stage-nachschlagen garetien-handlungen; do node js/review/__tests__/$t.test.js >/dev/null 2>&1 && echo "gruen: $t" || echo "ROT: $t"; done
node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```

Erwartet: `OK -- garetien-zielwahl-ziele: 144 Zusicherungen`, acht Mal `gruen`, der Vertrag `OK -- 17 Zusicherungen, …` (wie 3i-4), im ganzen Feld **keine** `ROT:`-Zeile. Die Dateizahl ist die Zahl nach Aufgabe 8 plus 1 (neu) minus 1 (gelöscht) — gegen das Muster aus `.github/workflows/deploy-avesmaps-strato.yml` gegenzählen. ⚠️ `js/review/__tests__/quellen-abdeckung-ziel.test.js` ist in einer CRLF-Arbeitskopie vorbestehend rot, kein Befund.

4k. **Im Browser ansehen, hell UND dunkel** (Umschalter der Seite, oder in der Konsole `document.documentElement.dataset.theme = "dark"`, zurück mit `"light"`). Auf der Stage einen Fluss öffnen, der sich mit unserem deckt: „Auf die Karte — zusätzlich zu …“ ist die Warnzeile (`.gi-ziel__option--warn`). Die zweite Zeile ungewählt, beim Überfahren und gewählt ansehen und in den DevTools messen (Farbwähler → Kontrast). Gerechnet über `--color-panel`:

| zweite Zeile | ungewählt | überfahren | gewählt |
|---|---|---|---|
| Warnzeile hell | 6,62:1 | 6,62:1 | 11,9:1 (volle Textfarbe) |
| Warnzeile dunkel | 8,31:1 | 8,31:1 | 5,8:1 (volle Textfarbe) |
| graue Zeile hell | 5,60:1 | 5,60:1 | 11,9:1 |
| graue Zeile dunkel | 5,79:1 | 5,79:1 | 5,8:1 |

(Überfahren trägt seit dem 14.09.2026 keine Wäsche mehr, nur den Rahmen `--color-border-strong` — deshalb gleich „ungewählt". Die gewählte Option nimmt in der zweiten Zeile `--color-text`. Die erste Fassung mit Wäsche lag dunkel bei 3,98:1 überfahren und 3,07:1 gewählt.)

Die erste Zeile bleibt in beiden Themen darüber (dunkel gewählt 6,31:1). Liegt die Leiste auf einem anderen Grund als `--color-panel`, gilt die Messung im Browser, nicht die Tabelle. Außerdem prüfen: die Liste steht in voller Breite in der Leiste (Übergangsregel), der Radiopunkt sitzt neben der ersten Zeile, das Namensfeld steht genau einmal unter der Zielwahl, und bei einer Ergänzung sind Name, Form und Art grau und gesperrt. 💣 **Liegt ein gemessener Wert unter 4,5:1, NICHT im CSS nachbessern** — der Vertrag würde rot, und wer ihn über eine geänderte Marke grün macht, nimmt dem Mockup die Bindung. Mit Bild dem Owner melden; die Korrektur geht ins Mockup und in die Produktion zugleich.

- [ ] **Schritt 5: Committen**

```sh
git add js/review/review-garetien-importer.js css/components/garetien-importer.css docs/garetien-import-vereint-mockup.html js/review/__tests__/garetien-zielwahl-ziele.test.js js/review/__tests__/garetien-innerorts-knopf.test.js js/review/__tests__/garetien-vorwaertsknopf.test.js js/review/__tests__/garetien-name-aendern.test.js js/review/__tests__/garetien-verbund-einstellungen.test.js js/review/__tests__/garetien-zusatz-auf-die-stage.test.js js/review/__tests__/garetien-import-verdrahtung.test.js js/review/__tests__/garetien-stage-nachschlagen.test.js js/review/__tests__/garetien-handlungen.test.js && git commit -F- <<'EOF'
ui(garetien-importer): eine Zielwahl statt zwei Häkchen -- „Innerorts einfügen“ fällt, „zusätzlich“ fragt nach

Auf der Stage wählt der Editor je Objekt EIN Ziel: Auf die Karte · Stätte in X · Nur Quelle +
Artikel an X · Quelle an X ergänzen · Auf die Karte zusätzlich zu X · Nichts. Die Häkchen „Als
Quelle einfügen“/„Neu einfügen“ und der Knopf „Innerorts einfügen (X)“ sind gefallen.

- „Neu einfügen“ schaltete die Quelle zwangsweise mit an: ein Klick legte die Dublette an UND
  ergänzte das bestehende Objekt (334 Objekte des Laufs 73). „Zusätzlich“ ist jetzt eine eigene
  Wahl, fragt vor dem Import und bestätigt `beides` an beiden Items (Riegel im Server).
- „Stätte in X“ erreicht den Server und wird vom Fußknopf gezählt (vorher „0 von 1“).
- „Innerorts einfügen“ schrieb ohne Rückfrage in die Karte, schon auf „Offen“.
- Siedlung und Umkreis stehen unter der Zielwahl; „— auf die Karte —“ gibt es im Siedlungsfeld
  nicht mehr. Form, Art und Darstellung werden abgeblendet, wenn das Ziel kein Kartenobjekt baut.
- Die Zielwahl trägt ihre Gestalt aus docs/garetien-import-vereint-mockup.html, gebunden durch
  einen Vertragsblock auf css/components/garetien-importer.css. Die zwei Kopfkommentare des
  Mockups sagen nicht mehr, dass nichts gebunden sei.

Bestand: übernommene und abgelehnte Objekte bekommen keine Zielwahl. An übernommenen Bauwerken
fällt die gesperrte Innerorts-Zeile weg; der Satz „Liegt als Stätte in …“ bleibt.

Tests: garetien-zielwahl-ziele.test.js ersetzt garetien-einfuege-haken.test.js; acht fremde Tests
nachgezogen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git log -1 --format=%B | head -3
```

(Die Löschung aus Schritt 4a steht per `git rm` schon im Index und landet damit im selben Commit. Vor dem Commit `git status` lesen: nur diese dreizehn Pfade dürfen vorgemerkt sein, fremde Dateien bleiben liegen.)

🔧 **DU:** Nach dem Deploy auf der Stage drei Objekte öffnen — einen Fluss, der sich mit unserem deckt (vorne „Quelle an „X“ ergänzen“ mit Abschnittszahl, „Auf die Karte — zusätzlich zu „X““ darunter), ein Bauwerk neben einer Siedlung („Stätte in „X““ wählen: der Fußknopf wird bedienbar, die Siedlung lässt sich umstellen und der Name in der Option wandert mit) und ein Objekt ohne Vorschlag (nur „Nichts — nur ansehen“). Dann am Fluss „zusätzlich“ wählen und „Stage importieren“ drücken: die erste Rückfrage nennt beide Objekte beim Namen — **mit „Abbrechen“ beantworten**. Prüfen, dass „Innerorts einfügen“ nirgends mehr steht. Dasselbe im dunklen Thema ansehen: die zweite Zeile der gewählten Option muss gut lesbar sein (gerechnet 5,8:1) — liest sie sich schwach, ist es ein Auftrag fürs Mockup, nicht fürs CSS. ⚠️ Ein echter „zusätzlich“-Import braucht den Server aus Aufgabe 8.

## Aufgabe 10: „Offen“ ohne Einstellfelder — der Vorschlag als Text

**Deckt Entwurf §2 (Zeile „Offen“: ansehen, nichts einstellen), §3 (Block C auf „Offen“, D/E weg) und §9 „Offen“, Zeilen 1–2 ab.** Sichtbar — einzeln live, mit Blick des Owners.

💣 **Der Riegel steht VOR `garetienEingabenZustandZu`** (JS:4044). Schon dessen erster Aufruf LEGT den Eingabezustand an; ein Riegel dahinter liesse einen Zustand zurück, der beim nächsten Auflegen gälte. Der Test fährt dafür Zahl, Häkchen, Name, Form und Zielwahl an einem nicht aufgelegten Objekt — und die Gegenprobe auf der Stage.

⚠️ **Nur `data-gi-feld` wird verworfen, `data-gi-umkreis` nicht.** Der Umkreis-Spinner ist ein Auswahlwerkzeug für die Liste (Block G) und bleibt auf „Offen“ bedienbar; `garetien-umkreis-spinner.test.js` (Abschnitt E) fährt ihn an einem nicht aufgelegten Objekt und fängt einen zu weiten Riegel.

🔴 **Übernommene Objekte behalten ihren Zweig.** Sie liegen nie auf der Stage; die Weiche ist deshalb „nicht übernommen UND nicht auf der Stage“ — ein übernommenes Objekt zeigt weiter Form/Art gesperrt und den alten Hinweis (Bestands-Fixture, Abschnitt D).

⚠️ **Der Vorschlag steht auch ohne Neu-Item da** — eine Ergänzung („Quelle an „X“ ergänzen“) oder „Nichts“ ist genauso eine Auskunft. `garetien-eingefuegt-wird.test.js` hielt „ohne Vorschlag kein Kasten“ fest; auf der Stage gilt die Regel weiter.

⚠️ **Eine Wahl, die auf der Stage gesetzt und nach dem Herunternehmen stehengeblieben ist, erscheint auf „Offen“ als Vorschlag.** Gewollt: sie ist genau das, was beim nächsten Auflegen gilt — bis „Stage leeren“ oder ein neuer Lauf sie vergisst (Aufgabe 6/9).

⚠️ **Übergangsort bis Aufgabe 11:** `garetienVorschlagMarkup` steht im alten Rahmen `<div class="gi-insert"><p class="gi-sec">Eingefügt wird</p>…</div>`; Aufgabe 11 setzt sie in Block C „Ziel & Identität · Vorschlag“.

**Bestand:** Keine Migration. ⚠️ **Uneinheitlich wird:** eine ABGELEHNTE Zeile zeigte bisher bedienbare Form/Art-Auswahlfelder (deren Wahl nirgends wirkte) und zeigt jetzt den Vorschlag als Text; ihr Knopf „Wieder vorschlagen“ bleibt unverändert. Übernommene Objekte sind unverändert.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` — `garetienVorschlagMarkup` neu vor `garetienEingefuegtWirdMarkup` (~:5310), dessen Kopf und der alte „Offen“-Zweig (~:5326–5339), `garetienEingabenAendern` (~:4044), `module.exports` (~:9755)
- Test (neu): `js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js`
- Tests (nachgezogen): `js/review/__tests__/garetien-eingefuegt-wird.test.js`, `js/review/__tests__/garetien-bloecke.test.js`

**Schnittstellen:**
- Nutzt: `garetienZielwahlZu(objekt): string` und `garetienZielwahlTexte(objekt, wert): {t1, t2, warn}` (Aufgabe 9) · `garetienZielWahlZu(objekt): {ziel, subtyp, kind}` · `garetienUnserBeschriftung(objekt): string` · `garetienWikiLabel(wert): string` · `avesmapsGaretienStageHat(schluessel): boolean` · `AVESMAPS_GARETIEN_FORMEN`
- Liefert: `garetienVorschlagMarkup(objekt): string` — `.gi-insert__row` mit `<span>Ziel|Form|Art</span><span class="gi-insert__val">…</span>` (Art mit `.gi-insert__hint` „aus „Typ“ (garetien.de)“), dazu `<p class="gi-why">Erst auf der Stage einstellbar.</p>`; Form und Art nur bei „karte“/„zusaetzlich“ · `garetienEingabenAendern(ereignis, objekte): void` ignoriert jedes `data-gi-feld` eines nicht aufgelegten Objekts

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben** — neue Datei `js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js`:

```js
// Aufgabe 10 des Bauplans „Garetien-Importer vereint" (14.09.2026): „Offen" ohne Einstellfelder.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §2, §3 (Block C)
// Mockup:  docs/garetien-import-vereint-mockup.html, Szene 2
//
// Owner 12.09.2026: „bei ‚offen' sollten bspw keine einstellungen am label vorgenommen werden" und
// „der Vorschlag ist sichtbar, geändert wird er erst auf der Stage".
//
// 💣 ZWEI HÄLFTEN, UND BEIDE MÜSSEN STEHEN. Das Markup (A) zeigt kein Feld mehr -- aber ein Feld, das
// noch im DOM steht (eine Ansicht, die vor dem Herunternehmen gezeichnet wurde), riefe
// garetienEingabenAendern trotzdem. Deshalb der Riegel dort (C), gefahren mit echten Ereignissen.
//
// 🔴 BESTAND (Owner 14.09.2026, Abschnitt D): ein übernommenes Objekt zeigt weiter, was es zeigte;
// eine abgelehnte Zeile behält „Wieder vorschlagen".
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
// Die Vorgabetafeln ECHT geladen -- ohne sie klafft ecosystem-display.js als blanker Bezeichner, sobald
// der Kasten einer Fläche auf der Stage wirklich gebaut wird (Vorbild: garetien-bloecke.test.js).
vm.runInThisContext(fs.readFileSync(path.join(WURZEL, "js/map-features/ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" });
vm.runInThisContext(fs.readFileSync(path.join(WURZEL, "js/map-features/location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" });
global.avesmapsLabelArtName = require(path.join(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const { ladeImporter } = require("./helfer/garetien-testumgebung.js");
const { api } = ladeImporter(["garetien-detailcol"]);

let n = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); n++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); n++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); n++; };

// ---- Fixtures -- jede OHNE verbund-Felder, wie jeder Lauf vor dem Deploy ------------------------
function wald() {
	return { key: "ggp:Waelder:Wald:Garetien:Silker Heide!Silker Heide", stand: "offen", urteil: "neu",
		name: "Silker Heide", typ: "Wald", wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
		geometrie: [[0, 0], [2, 0], [2, 2], [0, 2]], abschnitte: [],
		quelle: { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
			license: "cc-by-nc-sa-3.0", source_type: "briefspiel" },
		items: [{ id: 61, change_type: "new", anlass: "", felder: ["quelle"] }] };
}
function natter() {
	return { key: "ggp:Gewaesser:Fluss:Garetien:Natter!Natter", stand: "offen", urteil: "ergaenzung",
		name: "Natter", typ: "Fluss", wiki: "ggp", ziel: "path", subtyp: "Flussweg",
		geometrie: [[1, 1], [2, 2]], abschnitte: [{ public_id: "Flussweg-1", name: "Natter" }],
		items: [
			{ id: 71, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"], abschnitt: { public_id: "Flussweg-1" } },
			{ id: 72, change_type: "new", anlass: "zusatz", felder: [] },
		] };
}
function perz() {
	return { key: "ggp:Ortschaften:Dorf:Garetien:Perz!Perz", stand: "offen", urteil: "uebersprungen",
		name: "Perz", typ: "Dorf", ziel: "location", subtyp: "dorf", geometrie: [[5, 5]], abschnitte: [], items: [] };
}
function frisch() {
	api.garetienZielwahlVergessen();
	api.garetienZielWahlVergessen();
	api.garetienNameWahlVergessen();
	api.avesmapsGaretienStageLeeren();
}
function ereignis(feld, wert, typ) {
	return { target: {
		getAttribute: (name) => (name === "data-gi-feld" ? feld : null),
		hasAttribute: (name) => name === "data-gi-feld",
		value: wert, checked: wert === true, type: typ || "select-one",
	} };
}

// =================================================================================================
// A. „Offen": der Vorschlag als Text -- und kein einziges Einstellfeld
// =================================================================================================
frisch();
{
	const o = wald();
	const mk = api.garetienEingefuegtWirdMarkup(o);
	wahr(mk.includes('<p class="gi-insert__row"><span>Ziel</span><span class="gi-insert__val">Auf die Karte</span></p>'),
		"Ziel als Text: " + mk);
	wahr(mk.includes('<p class="gi-insert__row"><span>Form</span><span class="gi-insert__val">Fläche</span></p>'),
		"Form als Text");
	wahr(mk.includes('<p class="gi-insert__row"><span>Art</span><span class="gi-insert__val">Wald</span> '
		+ '<span class="gi-insert__hint">aus „Wald“ (garetien.de)</span></p>'),
		"Art als Text, mit ihrer Herkunft (Mockup §2)");
	wahr(mk.includes('<p class="gi-why">Erst auf der Stage einstellbar.</p>'), "…und der Satz, wo man es ändert");
	gleich(/data-gi-feld=/.test(mk), false, "🔴 kein data-gi-feld im Kasten: " + mk);
	gleich(/<select|<input/.test(mk), false, "🔴 kein Auswahlfeld, kein Eingabefeld");
	gleich(mk.indexOf("Darstellung sowie Wiki"), -1, "der alte Hinweis auf Block D/E ist ersetzt");

	const spalte = api.garetienDetailMarkup(o, null, false);
	gleich((spalte.match(/data-gi-feld=/g) || []).length, 0,
		"🔴 die GANZE rechte Spalte trägt auf „Offen\" kein data-gi-feld (Entwurf §9, erste Zeile)");
	wahr(spalte.includes("Erst auf der Stage einstellbar."), "…und der Vorschlag steht darin");
	wahr(spalte.includes('data-gi-umkreis="naehe"'),
		"⚠️ Block G bleibt bedienbar -- der Umkreis wählt ZEILEN aus, er stellt nichts am Objekt ein");
}
frisch();
{
	const mk = api.garetienEingefuegtWirdMarkup(natter());
	wahr(mk.includes('<span>Ziel</span><span class="gi-insert__val">Quelle an „Natter“ ergänzen</span>'),
		"eine Ergänzung nennt ihr Ziel -- auch ohne Neu-Item steht der Kasten da: " + mk);
	gleich(mk.indexOf("<span>Form</span>"), -1, "⚠️ …ohne Form: eine Ergänzung baut kein Objekt");
	const mp = api.garetienEingefuegtWirdMarkup(perz());
	wahr(mp.includes('<span>Ziel</span><span class="gi-insert__val">Nichts — nur ansehen</span>'),
		"ohne Vorschlag: „Nichts — nur ansehen\"");
}

// =================================================================================================
// B. „Stage": dasselbe Objekt, jetzt aufgelegt -- die Felder sind zurück
// =================================================================================================
frisch();
{
	const o = wald();
	api.avesmapsGaretienStageHinzufuegen([o]);
	const mk = api.garetienEingefuegtWirdMarkup(o);
	wahr(/data-gi-feld="zielForm"/.test(mk) && !/data-gi-feld="zielForm"[^>]* disabled/.test(mk),
		"auf der Stage ist die Form bedienbar");
	gleich(mk.indexOf("Erst auf der Stage einstellbar."), -1, "…und der Satz ist weg");
	wahr(mk.includes("Wiki und Quellen"), "…und Block E steht da");
}

// =================================================================================================
// C. DER RIEGEL -- ein Feld eines nicht aufgelegten Objekts wird ignoriert
// =================================================================================================
frisch();
{
	const o = wald();
	let karteGezeichnet = 0;
	global.window.avesmapsGaretienKarteZeigen = function () { karteGezeichnet++; };
	api.garetienDetailWaehlen(o.key, [o]);
	// ⚠️ Das Auswählen zeichnet die Karte SELBST (Zentrieren/Hervorheben) -- gezählt wird erst danach.
	karteGezeichnet = 0;

	api.garetienEingabenAendern(ereignis("zielForm", "label"), [o]);
	gleich(api.garetienZielWahlZu(o).ziel, "region", "💣 „Offen\": die Form bleibt, wie sie vorgeschlagen ist");
	api.garetienEingabenAendern(ereignis("zielwahl", "nichts", "radio"), [o]);
	gleich(api.garetienZielwahlZu(o), "karte", "💣 „Offen\": die Zielwahl bleibt");
	api.garetienEingabenAendern(ereignis("einfuegeName", "Silker Forst", "text"), [o]);
	gleich(api.garetienNameWahlZu(o), "", "💣 „Offen\": kein Name");
	api.garetienEingabenAendern(ereignis("size", "30", "number"), [o]);
	gleich(karteGezeichnet, 0, "💣 …und die Vorschau auf der Karte zieht NICHT nach");
	api.garetienEingabenAendern(ereignis("isLocked", true, "checkbox"), [o]);
	gleich(api.garetienEingabenZustandZu(o).isLocked, false, "💣 …und kein Häkchen");
	gleich(api.garetienEingabenZustandZu(o).size !== 30, true, "💣 …und keine Zahl");

	// Gegenprobe -- sonst wäre jede Zeile darüber auch mit einem Handler grün, der gar nichts tut.
	api.avesmapsGaretienStageHinzufuegen([o]);
	api.garetienEingabenAendern(ereignis("zielForm", "label"), [o]);
	gleich(api.garetienZielWahlZu(o).ziel, "label", "Gegenprobe Stage: die Form ändert sich");
	wahr(karteGezeichnet > 0, "Gegenprobe Stage: …und die Vorschau zieht nach");
	api.garetienEingabenAendern(ereignis("einfuegeName", "Silker Forst", "text"), [o]);
	gleich(api.garetienNameWahlZu(o), "Silker Forst", "Gegenprobe Stage: der Name hält");
	delete global.window.avesmapsGaretienKarteZeigen;
	api.garetienDetailWaehlen(null, []);
}

// =================================================================================================
// D. BESTAND -- übernommen und abgelehnt
// =================================================================================================
frisch();
{
	// Ein übernommenes Objekt liegt nicht auf der Stage -- es zeigt, was es vor dem Umbau zeigte.
	const uebernommen = Object.assign(wald(), { key: "ggp:Waelder:Wald:Garetien:Alter Forst!Alter Forst",
		name: "Alter Forst", stand: "uebernommen", innerorts_uebernommen: false,
		items: [{ id: 81, change_type: "new", anlass: "", felder: ["quelle"], selected: 1, apply_state: "done",
			apply_note: "Wald-1234" }] });
	const mk = api.garetienEingefuegtWirdMarkup(uebernommen);
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(mk), "🔴 übernommen: Form gesperrt wie vorher: " + mk);
	wahr(mk.includes("Darstellung sowie Wiki"), "…mit dem Hinweis von vorher");
	gleich(mk.indexOf("Erst auf der Stage einstellbar."), -1, "…und NICHT als Vorschlag");
	wahr(mk.includes("Liegt bereits auf der Karte"), "…und mit seinem Satz");
	gleich(api.garetienHandlungen(uebernommen)[0].name, "ruecknahme", "…und seiner Rücknahme");

	// Eine abgelehnte Zeile: „Wieder vorschlagen" bleibt; Auswahlfelder hatte sie nie wirksam.
	const abgelehnt = Object.assign(wald(), { key: "ggp:Waelder:Wald:Garetien:Abgewiesen!Abgewiesen",
		name: "Abgewiesen", stand: "abgelehnt" });
	tief(api.garetienHandlungen(abgelehnt).map((k) => k.name), ["wieder"], "🔴 abgelehnt: genau „Wieder vorschlagen\"");
	const ma = api.garetienEingefuegtWirdMarkup(abgelehnt);
	gleich(/data-gi-feld=/.test(ma), false, "⚠️ abgelehnt: der Vorschlag als Text statt wirkungsloser Felder");
	wahr(ma.includes("Erst auf der Stage einstellbar."), "…mit demselben Satz wie auf „Offen\"");
}

console.log("OK -- garetien-offen-ohne-einstellfelder: " + n + " Zusicherungen");
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```sh
node js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js
```

Erwartet (Exit 1): `AssertionError [ERR_ASSERTION]: Ziel als Text: <div class="gi-insert"><p class="gi-sec">Eingefügt wird</p>…<select class="gi-insert__select" data-gi-feld="zielForm" …` — auf „Offen“ steht noch die bedienbare Formwahl.

- [ ] **Schritt 3: Umsetzen** — in `js/review/review-garetien-importer.js`:

**Einfügen** in `review-garetien-importer.js`, direkt **vor** der Zeile `function garetienEingefuegtWirdMarkup(objekt) {`:

```js
	/*
	 * REIN: der Vorschlag eines NICHT aufgelegten Objekts -- Ziel · Form · Art als TEXT (Entwurf §3,
	 * Block C; Mockup §2).
	 *
	 * 🔴 AUF „OFFEN" STEHT KEIN EINSTELLFELD (Owner 12.09.2026/1 und /2: „der Vorschlag ist sichtbar,
	 * geändert wird er erst auf der Stage"). Bis hierher standen Form und Art dort als bedienbare
	 * Auswahl -- und der Zustand, den sie anlegten, galt beim späteren Import (Befund „Auf „Offen" sind
	 * 16 Einstellfelder bedienbar — und die Karte folgt").
	 * ⚠️ Gelesen wird DIESELBE Weiche wie auf der Stage (garetienZielwahlZu, garetienZielWahlZu,
	 * garetienUnserBeschriftung): was hier steht, ist genau das, was nach „Auf die Stage" vorbelegt ist.
	 * ⚠️ Form und Art nur, wenn das Ziel ein Kartenobjekt baut -- bei einer Ergänzung oder „Nichts"
	 * gäbe es keine Form, die gälte.
	 */
	function garetienVorschlagMarkup(objekt) {
		const o = objekt || {};
		const zielwahl = garetienZielwahlZu(o);
		const zeile = function (beschriftung, wert, hinweis) {
			return '<p class="gi-insert__row"><span>' + avesmapsGaretienEscape(beschriftung) + "</span>"
				+ '<span class="gi-insert__val">' + avesmapsGaretienEscape(wert) + "</span>"
				+ (hinweis !== "" ? ' <span class="gi-insert__hint">' + avesmapsGaretienEscape(hinweis) + "</span>" : "")
				+ "</p>";
		};
		let raus = zeile("Ziel", garetienZielwahlTexte(o, zielwahl).t1, "");
		if (zielwahl === "karte" || zielwahl === "zusaetzlich") {
			const formKey = String(garetienZielWahlZu(o).ziel || "");
			const form = (AVESMAPS_GARETIEN_FORMEN.filter(function (f) { return f.key === formKey; })[0] || {}).label || "";
			if (form !== "") { raus += zeile("Form", form, ""); }
			const art = garetienUnserBeschriftung(o);
			if (art !== "") {
				const ihr = String(o.typ || "").trim();
				const quelle = garetienWikiLabel(String(o.wiki || ""));
				raus += zeile("Art", art,
					ihr === "" ? "" : "aus „" + ihr + "“" + (quelle !== "" ? " (" + quelle + ")" : ""));
			}
		}
		return raus + '<p class="gi-why">Erst auf der Stage einstellbar.</p>';
	}

```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
	function garetienEingefuegtWirdMarkup(objekt) {
		if (!objekt || !garetienEingefuegtWirdHatVorschlag(objekt)) { return ""; }
```

neu:

```js
	function garetienEingefuegtWirdMarkup(objekt) {
		if (!objekt) { return ""; }
		// 🔴 NICHT AUF DER STAGE, NICHT ÜBERNOMMEN: DER VORSCHLAG ALS TEXT (Aufgabe 10, 14.09.2026). Und das
		// auch für ein Objekt ohne Neu-Item -- eine Ergänzung („Quelle an X ergänzen") oder „Nichts" ist
		// genauso eine Auskunft darüber, was nach „Auf die Stage" daraus würde.
		if (String(objekt.stand || "") !== "uebernommen" && !avesmapsGaretienStageHat(objekt.key)) {
			return '<div class="gi-insert"><p class="gi-sec">Eingefügt wird</p>' + garetienVorschlagMarkup(objekt) + "</div>";
		}
		if (!garetienEingefuegtWirdHatVorschlag(objekt)) { return ""; }
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
		// 🔴 SOLANGE „OFFEN", BLEIBEN DARSTELLUNG UND WIKI & QUELLEN AUSGEBLENDET (Owner
		// 09.09.2026: „die sind alle auf der stage erst wichtig"). Auf dem Reiter Offen
		// entscheidet ein Editor zwei Dinge -- ueberhaupt? und als was? Groesse, Prioritaet,
		// Zoomband, Kurvenbeschreibung, „fuer Klicks gesperrt", Wiki und Quellen beantworten
		// keine davon; sie stehen dort nur im Weg, bei jeder der 8237 Zeilen.
		// ⭐ Dieselbe Regel gilt schon fuer Name und die zwei Haekchen
		// (garetienEinfuegeHakenMarkup) -- aus der Ausnahme wird hier die Regel.
		// ⚠️ Form und Art bleiben: sie sind die Antwort auf „als was?" und gehoeren damit zur
		// Entscheidung, nicht zur Einstellung.
		if (!avesmapsGaretienStageHat(objekt.key)) {
```

neu:

```js
		// 🔴 BIS HIERHER KOMMT EIN NICHT AUFGELEGTES OBJEKT NUR NOCH, WENN ES ÜBERNOMMEN IST (Aufgabe 10,
		// 14.09.2026): „Offen" kehrt oben mit dem Vorschlag als Text zurück. Ein übernommenes Objekt zeigt
		// weiter, was es vor dem Umbau zeigte -- Form und Art gesperrt, Darstellung sowie Wiki & Quellen
		// ausgeblendet (Bestand, Owner 14.09.2026).
		if (!avesmapsGaretienStageHat(objekt.key)) {
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
		const eingaben = garetienEingabenZustandZu(objekt);
		const feld = ziel.getAttribute("data-gi-feld");
```

neu:

```js
		const feld = ziel.getAttribute("data-gi-feld");
		// 🔴 AUF „OFFEN" WIRD NICHTS EINGESTELLT (Owner 12.09.2026: „bei ‚offen' sollten bspw keine
		// einstellungen am label vorgenommen werden"). Der Riegel steht HIER, nicht nur im Markup: ein Feld,
		// das noch im DOM steht (eine Einzelansicht, gezeichnet vor dem Herunternehmen), legte sonst einen
		// Zustand an, der beim nächsten Auflegen gälte, und zöge die Vorschau auf der Karte nach.
		// 💣 VOR `garetienEingabenZustandZu`: schon dessen erster Aufruf LEGT den Zustand an.
		// ⚠️ NUR `data-gi-feld`: der Umkreis-Spinner (`data-gi-umkreis`) ist ein Auswahlwerkzeug für die
		// LISTE, keine Eigenschaft des Objekts, und bleibt auch auf „Offen" bedienbar (Entwurf §3, Block G).
		if (feld !== null && feld !== "" && !avesmapsGaretienStageHat(objekt.key)) { return; }
		const eingaben = garetienEingabenZustandZu(objekt);
```

**Ersetzen** in `review-garetien-importer.js` —

alt:

```js
			garetienEingefuegtWirdMarkup,
```

neu:

```js
			garetienEingefuegtWirdMarkup,
			// 14.09.2026 (Aufgabe 10): der Vorschlag als Text auf „Offen"
			garetienVorschlagMarkup,
```

- [ ] **Schritt 4: Test fahren, grün sehen — und die fremden Tests**

4a. `js/review/__tests__/garetien-eingefuegt-wird.test.js` — Abschnitt B unterscheidet „Offen“ und Stage; H2 und J legen ihr Objekt auf, bevor sie Felder ändern:

**Ersetzen** in `garetien-eingefuegt-wird.test.js` —

alt:

```js
gleich(garetienEingefuegtWirdMarkup({ items: [] }), "", "ohne Vorschlag gibt es keinen Kasten -- eine "
	+ "Ueberschrift ueber nichts ist keine Auskunft (dieselbe Regel wie bei garetienQuellenMarkup)");
```

neu:

```js
// 🔴 SEIT DEM 14.09.2026 (Aufgabe 10, „Garetien-Importer vereint") STEHT AUF „OFFEN" AUCH OHNE
// VORSCHLAG EIN KASTEN: der Vorschlag als Text („Nichts — nur ansehen"). Ob etwas anzulegen ist, IST dort
// die Auskunft -- und ein Kasten ohne Einstellfeld.
const ohneVorschlagOffen = garetienEingefuegtWirdMarkup({ key: "gi-ohne:1", items: [] });
wahr(ohneVorschlagOffen.includes("Nichts — nur ansehen") && !/data-gi-feld=/.test(ohneVorschlagOffen),
	"auf „Offen\": der Vorschlag als Text, kein Feld: " + ohneVorschlagOffen);
// Auf der Stage bleibt die alte Regel.
const ohneVorschlagStage = { key: "gi-ohne:2", items: [] };
avesmapsGaretienStageHinzufuegen([ohneVorschlagStage]);
gleich(garetienEingefuegtWirdMarkup(ohneVorschlagStage), "", "auf der Stage: ohne Vorschlag gibt es "
	+ "keinen Kasten -- eine Ueberschrift ueber nichts ist keine Auskunft (dieselbe Regel wie bei garetienQuellenMarkup)");
```

**Ersetzen** in `garetien-eingefuegt-wird.test.js` —

alt:

```js
const objektH2 = { key: "gi-spiegel:1", subtyp: "huegelland", ziel: "region" };
```

neu:

```js
const objektH2 = { key: "gi-spiegel:1", subtyp: "huegelland", ziel: "region" };
// 🔴 Seit dem 14.09.2026 (Aufgabe 10) wird nur an einem AUFGELEGTEN Objekt eingestellt -- auf „Offen"
// verwirft garetienEingabenAendern jedes Feld.
avesmapsGaretienStageHinzufuegen([objektH2]);
```

**Ersetzen** in `garetien-eingefuegt-wird.test.js` —

alt:

```js
garetienDetailWaehlen(objektJ.key, [objektJ]);
```

neu:

```js
// 🔴 Aufgelegt, denn auf „Offen" wird seit dem 14.09.2026 nichts eingestellt (Aufgabe 10; der Riegel
// selbst ist in garetien-offen-ohne-einstellfelder.test.js gefahren).
avesmapsGaretienStageHinzufuegen([objektJ]);
garetienDetailWaehlen(objektJ.key, [objektJ]);
```

4b. `js/review/__tests__/garetien-bloecke.test.js` — Abschnitt A erwartet Form/Art als Text:

**Ersetzen** in `garetien-bloecke.test.js` —

alt:

```js
wahr(mOffen.includes('data-gi-feld="zielForm"') && mOffen.includes('data-gi-feld="zielArt"'),
	"Form und Art muessen auch auf 'Offen' stehen -- sie beantworten 'ueberhaupt?' und 'als was?': "
	+ mOffen);
wahr(mOffen.includes("Darstellung sowie Wiki") && mOffen.includes("erscheinen, sobald das")
	&& mOffen.includes("Objekt auf der Stage liegt"),
	"der erklaerende Hinweistext fehlt auf 'Offen': " + mOffen);
```

neu:

```js
// 🔴 SEIT DEM 14.09.2026 (Aufgabe 10, „Garetien-Importer vereint") stehen Form und Art auf „Offen" als
// TEXT, nicht als Auswahl (Owner 12.09.2026: „der Vorschlag ist sichtbar, geändert wird er erst auf
// der Stage").
wahr(mOffen.includes('<span>Form</span><span class="gi-insert__val">Fläche</span>')
	&& mOffen.includes('<span>Art</span><span class="gi-insert__val">'),
	"Form und Art stehen auch auf 'Offen' -- sie beantworten 'ueberhaupt?' und 'als was?', als Text: "
	+ mOffen);
wahr(!/data-gi-feld=/.test(mOffen), "…und kein einziges Einstellfeld: " + mOffen);
wahr(mOffen.includes("Erst auf der Stage einstellbar."),
	"der erklaerende Satz steht auf 'Offen': " + mOffen);
```

**Ersetzen** in `garetien-bloecke.test.js` —

alt:

```js
wahr(!mStage.includes("erscheinen, sobald das Objekt auf der Stage liegt"),
	"der Hinweistext darf auf der Stage nicht mehr stehen: " + mStage);
```

neu:

```js
wahr(!mStage.includes("Erst auf der Stage einstellbar."),
	"der Satz darf auf der Stage nicht mehr stehen: " + mStage);
```

4c. Fahren:

```sh
node js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js
for t in garetien-eingefuegt-wird garetien-bloecke garetien-umkreis-spinner garetien-zielwahl garetien-detailspalte-reihenfolge garetien-zielwahl-ziele; do node js/review/__tests__/$t.test.js >/dev/null 2>&1 && echo "gruen: $t" || echo "ROT: $t"; done
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```

Erwartet: `OK -- garetien-offen-ohne-einstellfelder: 33 Zusicherungen`, sechs Mal `gruen`, im ganzen Feld keine `ROT:`-Zeile; Dateizahl = Zahl nach Aufgabe 9 plus 1.

- [ ] **Schritt 5: Committen**

```sh
git add js/review/review-garetien-importer.js js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js js/review/__tests__/garetien-eingefuegt-wird.test.js js/review/__tests__/garetien-bloecke.test.js && git commit -F- <<'EOF'
ui(garetien-importer): „Offen“ zeigt Ziel, Form und Art als Text -- eingestellt wird erst auf der Stage

Auf „Offen“ steht in „Eingefügt wird“ jetzt der Vorschlag als Text („Ziel · Form · Art“, mit
„Erst auf der Stage einstellbar.“) statt bedienbarer Auswahlfelder. Owner 12.09.2026: „bei ‚offen'
sollten bspw keine einstellungen am label vorgenommen werden“.

- garetienEingabenAendern verwirft jedes Feld eines Objekts, das nicht auf der Stage liegt -- vor
  dem Anlegen des Eingabezustands, damit nichts zurückbleibt, und ohne die Vorschau nachzuziehen.
- Der Umkreis-Spinner bleibt auf „Offen“ bedienbar (er wählt Zeilen, er stellt nichts ein).
- Der Vorschlag steht auch bei Ergänzungen und Objekten ohne Vorschlag da.

Bestand: übernommene Objekte zeigen unverändert Form/Art gesperrt; abgelehnte Zeilen zeigen den
Vorschlag als Text statt wirkungsloser Auswahlfelder, „Wieder vorschlagen“ bleibt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git log -1 --format=%B | head -3
```

🔧 **DU:** Nach dem Deploy auf „Offen“ eine Fläche öffnen: in „Eingefügt wird“ stehen Ziel, Form und Art als Text mit „Erst auf der Stage einstellbar.“ — kein Auswahlfeld mehr; „Imports in der Nähe wählen“ samt Umkreis bleibt bedienbar. Dasselbe Objekt auf die Stage legen: die Felder sind zurück. Ein übernommenes Objekt öffnen: Form und Art gesperrt wie vorher. Eine abgelehnte Zeile öffnen: Vorschlag als Text, „Wieder vorschlagen“ steht da.


---

## Aufgabe 11: Die Einzelansicht in sieben Blöcken — Umbau der rechten Spalte

**Deckt Entwurf §3 ab** (dazu §6.3 „gilt dem ganzen Verbund", §9 „Einzelansicht und Leisten", erste Zeile; Mockup §2 bis §4 und §6). Sichtbar — einzeln live, mit Blick des Owners.

**Umbau, nicht Neubau.** Die rechte Spalte trägt heute sechs Überschriften in drei Bauformen (`.gi-sec`, die Unterzeilen von „Eingefügt wird", der Kopf von `.gi-acts`) und einen Werkzeugblock außerhalb des Rollkastens. Erfunden wird nichts — jeder heutige Abschnitt wandert in genau einen Block (Fundstellen am Zweig `df8d9ec4c`; nach den Aufgaben 5 bis 10 verschoben):

| Block | Titel | was heute dort steht und hineinwandert |
|---|---|---|
| — | Kopf | Name und Metazeile (`garetienDetailMetaMarkup`) — bleibt, **kein** Block |
| **A** | Auf der Karte | „✦ Zentrieren" und die zwei Sicht-Knöpfe (bisher im Kopf, `garetienDetailMarkup` :5926–5933) · „Was bei uns an derselben Stelle liegt" (`.gi-sec` :5953 — ihre Notiz „n Abschnitte · Deckung Median …" wird die Blocknotiz) · die Abschnittszeilen `.gi-seg` · der 💣-Kasten `.gi-bomb` · „Der Grund" (`.gi-sec` :5965, jetzt `<b>Der Grund:</b>` im Satz) · **auf „Übernommen"** der Satz „Liegt bereits auf der Karte …" (bisher im Kasten „Eingefügt wird", `garetienEingefuegtWirdUebernommenHinweis`) |
| **B** | Verbund | `garetienVerbundBlockMarkup` mit Zeilen, ✕, Knopf „Zusammenlegen (n)", Grundzeile und Pool aus Aufgabe 7 — nur die Überschrift `.gi-sec` wird Blockkopf |
| **C** | Ziel & Identität | aus „Eingefügt wird" (`garetienEingefuegtWirdMarkup`, nach Aufgabe 10 ~:5405): Typzeile und Form/Art (`garetienZielWahlMarkup(objekt, deaktiviert, ausGrund)` — seit Aufgabe 9 abgeblendet mit Grund) · auf „Offen" und „Abgelehnt" `garetienVorschlagMarkup` (Aufgabe 10) · **aus der Handlungsleiste** (Stand nach Aufgabe 9, Rückgabe von `garetienHandlungsMarkup` ~:7402): die Zielwahl `garetienZielwahlMarkup` samt Siedlung und Umkreis-Spinner und das Namensfeld `garetienZielNameZeile` — beide stehen danach genau einmal, in C |
| **D** | Darstellung | aus „Eingefügt wird": die Felder der gewählten Form — Fläche, Beschriftung, Ort, Weg (:5346–5355) |
| **E** | Wiki & Quellen | aus „Eingefügt wird", Unterabschnitt „Wiki und Quellen" (:5356–5371): `garetienQuellenMarkup`, Wiki-Landschaft, manuelle Suche |
| **F** | Handlung | `garetienHandlungsMarkup` — die Leiste „Dieses Objekt" (~:7389), **ohne** die Zielwahl und das Namensfeld, die Aufgabe 9 dort über die Knöpfe gesetzt hat (sie ziehen nach C) |
| **G** | Weiter importieren | `garetienNaeheMarkup` — bisher Geschwister UNTER `.gi-detail` (:5984), jetzt ihr letztes Kind |

**Je Reiter** (Owner-Nachtrag 14.09.2026: die Blöcke gelten auf allen vier Reitern). B nur bei einem Verbund.

| Reiter | Blöcke | was sich zeigt |
|---|---|---|
| Offen | A (B) C F G | C als Text, kein Einstellfeld; D und E fehlen |
| Stage | A (B) C D E F G | Zielwahl · Name · Form · Art; was das Ziel nicht braucht, steht grau und gesperrt |
| Abgelehnt | A (B) C F G | wie Offen; F trägt „Wieder vorschlagen" |
| Übernommen | A (B) F | C, D, E und G fehlen; A sagt, wo es liegt und ob es zurückgeht; F trägt „Zurücknehmen" |

**Bestand.** Keine Migration, keine neue Datenfrage — die Blöcke lesen dieselben Felder wie heute. Ein Lauf ohne `verbund_stamm`/`verbund_n` zeigt keinen Block B (`garetienVerbundSchluessel` liefert `""`). Der Test fährt je ein **übernommenes** Objekt eines solchen Laufs (Blöcke A und F, F „Zurücknehmen") und ein **abgelehntes** (A, C, F „Wieder vorschlagen", G). ⚠️ An einem übernommenen Objekt verschwinden damit die gesperrten Felder von „Eingefügt wird" (Punkt 6a vom 30.08.2026). Bestellt im Owner-Nachtrag vom 14.09.2026 und im Mockup §6 („Blöcke C bis E fehlen"); der Entwurf §3 sagte dort noch „nur Anzeige" — im Koordinator-Blick behalten.

🔴 **Die Buchstaben fluchten nur, wenn jeder Block ein direktes Kind von `.gi-detail` ist.** `.gi-detail` trägt `scrollbar-gutter: stable both-edges` (garetien-importer.css:522); was außerhalb steht — heute `garetienNaeheMarkup` —, liegt um die Rinnenbreite weiter links. Deshalb wandert G in die Ansicht, und `.gi-win .avm-col > .gi-naehe` (:1503) fällt. Der Test prüft die Tiefe jedes Blocks.

💣 **`.gi-detail > .gi-acts` (:1286, Spezifität 0,2,0) überstimmt `.gi-block` (0,1,0).** Stehen gelassen bekäme F `margin-top: 8px` statt 12 — ein Block, der enger an seinem Vorgänger klebt als alle anderen. `tools/mockup-vertrag` sieht das nicht, er prüft Deklarationen, keine Spezifität. Die Regel fällt; gegengemessen in Schritt 5.

💣 **Die Stelle des Vertragsblocks: hinter der Zielwahl (Aufgabe 9), unmittelbar VOR dem Abschnitt „Aufgabe 15: die Handlungsleiste" (~:1292).** Gleich spezifisch gewinnt die spätere Regel, und `tools/mockup-vertrag` prüft nur Deklarationen. Dahinter stehen nur noch `.gi-acts` (display, flex-wrap, gap), `.gi-acts__titel` (flex, padding-top, border-top), `.gi-acts__grund`, `.gi-acts__knoepfe` und `.gi-naehe` — keine setzt an einem Element eines Blocks eine Eigenschaft der Blockregeln. Abschnitt 10 des Tests zerlegt jede Regel dahinter und hält das fest (Mutation `.gi-acts { margin-top: 0 }` → rot). Noch später geht nicht: `garetien-handlungen.test.js:717` schneidet die Datei ab „Aufgabe 15" bis zum Ende und verbietet jedes `\d+px`; der Kreis (`width`/`height: 18px`) ist ein Pixelmaß, das der Vertrag bindet. Ans Ende gesetzt fiel dieser fremde Test rot — im ersten Probelauf passiert.

🔴 **Die Zielwahl-Regeln (`.gi-ziel*`) und `.gi-insert__row--aus` baut Aufgabe 9 samt ihrer Vertragsmarke** (Zuschnitt des Koordinators, 14.09.2026: sonst ginge die Zielwahl in ihrem eigenen Push ungestaltet live). Diese Aufgabe setzt sie voraus: C und D blenden über `.gi-insert__row--aus` ab. ⚠️ Die Regel ist gleich spezifisch wie `.gi-insert__row` (:981) und gewinnt nur, weil sie dahinter steht — Abschnitt 10 des Tests hält die Reihenfolge fest und fängt damit auch eine falsch einsortierte Regel aus Aufgabe 9.

💣 **Zielwahl und Namensfeld ziehen aus der Leiste in Block C — jedes Feld genau einmal.** Nach Aufgabe 9 trägt die Rückgabe von `garetienHandlungsMarkup` `+ garetienZielwahlMarkup(objekt) + garetienZielNameZeile(objekt)` über den Knöpfen (~:7402). C ruft beide, F verliert sie. Stünden sie in beiden Blöcken, gäbe es Radio-Gruppe, Siedlung (`data-gi-feld="innerorts"`), Umkreis (`id="garetien-umkreis-innerorts"`) und Namensfeld je zweimal — mit derselben id. Der Test zählt jedes davon in der ganzen Spalte.

🔴 **`garetienZielNameZeile` bleibt — mit genau einem Aufrufer, `garetienIdentitaetMarkup`.** Durch den Umzug wird sie nicht tot: C ruft sie, statt die Regel „welches Ziel braucht einen Namen" ein zweites Mal hinzuschreiben (Aufgabe 9: bedienbar bei `karte`/`zusaetzlich`/`staette`, sonst abgeblendet; leer, wenn nur „Nichts" zur Wahl steht). Der Export bleibt, `garetien-zielwahl-ziele.test.js` fährt sie direkt (Abschnitte F und I). Ihr Kommentar nennt den neuen Aufrufer (3e).

💣 **`.gi-acts > .gi-ziel` (Übergangsregel aus Aufgabe 9, ~:1022–1027) und `.gi-acts .gi-insert__row` (~:1467–1474) fallen.** Die erste sagt selbst „Aufgabe 11 entfernt diese Regel"; die zweite trug die Eingabezeilen der Leiste (bis Aufgabe 9 die Häkchen, danach das Namensfeld), und nach dem Umzug steht dort keine mehr. Stehen gelassen wären es tote Regeln, die der Nächste für geltend hält.

⚠️ **Zwei, später drei Vertragsblöcke im selben Mockup zeigen auf dieselbe Produktionsdatei** (Aufgabe 9: Zielwahl, 11: Blöcke, 12: Listenkopf). Am Werkzeug geprüft: `vertragsBloecke` liefert jeden Block einzeln, `vertragPruefen` hält jeden gegen die ganze Datei, eine Verletzung im mittleren Block meldet genau diesen. Die Blöcke dürfen sich nur nicht überlappen — jede Endmarke steht vor der nächsten Anfangsmarke.

💣 **`.gi-sec` und `.gi-sec__note` (:807, :819) fallen.** Nach dem Umbau baut sie niemand mehr (`git grep gi-sec` außerhalb dieser zwei Dateien: nur Tests); stehen gelassen wären sie tote Regeln, die der Nächste für geltend hält. Eine `.gi-sec` IM Block zöge zudem eine zweite Trennlinie mitten hinein — deshalb bekommt auch `garetienQuellenMarkup` (:3586) `.gi-insert__sub`.

💣 **D und E tragen `gi-insert` am Block.** Die Regler sind unter `.gi-insert` verengt (`.gi-insert .label-edit-sliderrow` …, :1170–1190); ohne die Klasse erbt der Regler 9/10 px Polster aus location-report-dialog.css, und die Vorgabemarke sitzt neben der Spur. Dafür hat `garetienBlockMarkup` den optionalen sechsten Parameter `zusatz` (Vertragsergänzung, Notizen); F braucht ihn ebenso für `gi-acts`.

💣 **`garetienZielwahlZu` (Aufgabe 9, liefert einen `string`) und `garetienZielWahlZu` (heute, liefert `{ziel, subtyp, kind}`) unterscheiden sich in EINEM Großbuchstaben.** C fragt beide: die Zielwahl die kleine, Form/Art die große. Verwechselt vergliche der Code ein Objekt mit `"karte"` und blendete alles ab — Abschnitt 3 des Tests fängt das.

⚠️ **Abgeblendet heißt gesperrt UND grau — und in C tun es die Bauer von Aufgabe 9.** Name (`garetienZielNameZeile`), Form und Art (`garetienZielWahlMarkup` mit `garetienZielwahlAusGrund`; der Grund steht in der Form-Zeile) und Siedlung (`garetienInnerortsZeileMarkup`) blenden sich selbst ab. `garetienZeilenAbblenden` bleibt nur für D, dessen vier Bauer keinen Abblend-Parameter kennen: es färbt, gesperrt wird über ihr `deaktiviert`. Ob D gilt, entscheidet dieselbe Weiche wie Form und Art (`garetienZielwahlAusGrund(objekt) !== ""`) — keine zweite Zielliste.

⚠️ **D bleibt in voller Höhe stehen, grau und gesperrt.** Das Mockup (§5, „Burg Finster") zeichnet dort eine einzige Zeile „Beschriftung — eine Stätte steht nicht auf der Karte". Eine Zeile statt der Felder ließe die Spalte bei jedem Wechsel der Zielwahl springen (Entwurf §3: abgeblendet, nicht ausgeblendet) — Owner-Frage in den Notizen.

⚠️ **Der Umkreis-Spinner steht bei jedem Bauwerk** (Entwurf §5) — in der Zielwahl (`garetienInnerortsZeileMarkup`, Aufgabe 9). C hängt keinen zweiten an; der Test zählt den Umkreis, seine id und die Siedlung je genau einmal.

⚠️ **Drei Tests aus den Aufgaben 9 und 10 macht der Umzug rot** — sie werden in Schritt 4 als fremde Tests mit neuer Zusicherung nachgezogen: `garetien-zielwahl-ziele.test.js` (Abschnitt F sucht Zielwahl und Namensfeld in der Leiste und verlangt keine Siedlung im Kasten; Abschnitt I erwartet am übernommenen Objekt den gesperrten Kasten), `garetien-offen-ohne-einstellfelder.test.js` (B sucht „Wiki und Quellen", D den gesperrten Kasten am übernommenen Objekt) und `garetien-name-aendern.test.js` (sucht das Namensfeld in der Leiste).

🔴 **Kein `ASSET_VERSION`, kein `?v=` von Hand.** Das CSS hängt an `css/styles.css` (@import), das Skript an `index.html` — der Deploy stempelt beides (AGENTS.md §7).

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (Stand nach Aufgabe 10: `garetienEingefuegtWirdMarkup` ~:5405 ersetzt, vier Nachbarn davor; `garetienBlockMarkup` neu vor `// REIN: die ganze rechte Spalte.` ~:5986; `garetienDetailMarkup` ~:6003 ersetzt; Rückgabe von `garetienVerbundBlockMarkup` (Stand nach Aufgabe 7); `garetienQuellenMarkup` ~:3622; Kommentar und Rückgabe von `garetienHandlungsMarkup` ~:7389–7403; Kommentar über `garetienZielNameZeile` ~:7060; Exporte)
- Ändern: `css/components/garetien-importer.css` (`.gi-sec` :807, `.gi-sec__note` :819, `.gi-acts > .gi-ziel` ~:1022–1027, `.gi-detail > .gi-acts` ~:1313–1323, `.gi-acts .gi-insert__row` ~:1467–1474 und `.gi-win .avm-col > .gi-naehe` ~:1536 fallen; Kommentar über `.gi-naehe`; Vertragsblock neu vor „Aufgabe 15: die Handlungsleiste" ~:1292)
- Ändern: `docs/garetien-import-vereint-mockup.html` (Vertragsmarken um :407–419)
- Test: `js/review/__tests__/garetien-detailspalte-reihenfolge.test.js` (ganz ersetzt)
- Fremde Tests: `garetien-bloecke.test.js` (ganz ersetzt), `garetien-eingefuegt-wird.test.js`, `garetien-einzelansicht.test.js`, `garetien-handlungen.test.js`, `garetien-vorwaertsknopf.test.js`, `garetien-verbund-klick.test.js`, `garetien-naehe-markieren.test.js`, `garetien-name-aendern.test.js`, `garetien-zielwahl-ziele.test.js`, `garetien-offen-ohne-einstellfelder.test.js`

**Schnittstellen:**
- Nutzt: CSS `.gi-ziel*` und `.gi-insert__row--aus` samt Vertragsmarke (A9) · `garetienZielwahlMarkup(objekt): string` (Radioliste samt Siedlung und Umkreis; `""` außerhalb der Stage), `garetienZielNameZeile(objekt): string`, `garetienZielwahlAusGrund(objekt): string`, `garetienZielWahlMarkup(objekt, deaktiviert, ausGrund): string`, `garetienZielwahlZu(objekt): string`, `garetienZielwahlSetzen(objekt, wert): void`, `garetienZielwahlVergessen(): void` (A9) · `garetienVorschlagMarkup(objekt): string` (A10) · `garetienVerbundIstZusammen(schluessel: string): boolean`, `garetienVerbundZusammenlegen(schluessel: string, objekte: Array): number`, `garetienVerbundAufloesen(schluessel: string): void` (A6) · `garetienVerbundBlockMarkup(objekt, objekte)` mit den lokalen `zeilen`, `knopf`, `zusammen` (A7) · vorhanden: `garetienZielWahlZu(objekt): {ziel, subtyp, kind}`, `garetienTypText(objekt)`, `garetienEingefuegtWirdHatVorschlag(objekt)`, `garetienEingefuegtWirdFlaecheMarkup(objekt, d)`, `…BeschriftungMarkup(objekt, subtyp, mitKurve, d)`, `…OrtMarkup(objekt, subtyp, d)`, `…WegMarkup(objekt, subtyp, d)`, `garetienQuellenMarkup(objekt)`, `garetienWikiLandschaftStand(objekt)`, `garetienEingefuegtWirdUebernommenHinweis(objekt)`, `garetienNaeheMarkup(objekt)`, `garetienHandlungen(objekt)`
- Liefert: `garetienBlockMarkup(buchstabe: string, titel: string, inhalt: string, notiz: string, erster: boolean, zusatz?: {blockKlasse?: string, kopfKlasse?: string}): string` · `garetienZeilenAbblenden(markup: string): string` · `garetienIdentitaetMarkup(objekt): string` · `garetienDarstellungMarkup(objekt, deaktiviert: boolean): string` · `garetienWikiQuellenMarkup(objekt): string` · `garetienEingefuegtWirdMarkup(objekt): string` (liefert jetzt die Blöcke C, D, E) · `garetienHandlungsMarkup(objekt): string` (Block F, ohne Zielwahl und Namensfeld)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/review/__tests__/garetien-detailspalte-reihenfolge.test.js` wird ganz ersetzt. Die alte Fassung prüfte, dass `<div class="gi-acts">` vor „Eingefügt wird" steht — beide Zeichenketten gibt es danach nicht mehr, und ihre Frage („steht die Leiste in der rollenden Ansicht?") beantwortet jetzt Abschnitt 2 über die Tiefe.

```js
// Die Einzelansicht in sieben Bloecken (Bauplan 2026-09-14, Aufgabe 11; Entwurf §3, Mockup §2 bis §6).
//
// 🔴 GEMESSEN WIRD DAS ERGEBNIS, NICHT DER QUELLTEXT. Jede Zusicherung ruft garetienDetailMarkup
// wirklich auf und liest Bloecke, Buchstaben und Titel aus dem GEBAUTEN Markup. Der erste Entwurf
// dieser Aufgabe (Bauplan 2026-09-09) suchte die Titel per indexOf im Quelltext -- ein Titel in
// einem Kommentar haette ihn gruen gemacht, waehrend die Spalte etwas ganz anderes zeigt.
// 🔴 DER BESTAND (Owner 14.09.2026): der Importer ist live. Je ein uebernommenes und ein
// abgelehntes Objekt aus einem Lauf OHNE verbund-Felder laufen mit (Abschnitte 6 und 7).
// ⚠️ Pixel misst dieser Test nicht -- ob die Buchstaben FLUCHTEN, sagt nur der Browser (Bauplan,
// Aufgabe 11 Schritt 5). Hier steht, was die Flucht voraussetzt: jeder Block ist ein direktes Kind
// von `.gi-detail`, und keine spaetere Regel ueberstimmt den Block (Abschnitt 10).
//
// Ausführen: node js/review/__tests__/garetien-detailspalte-reihenfolge.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

// 💣 Die Vorgabetafeln ECHT laden, BEVOR das Modul kommt -- ohne sie klafft ecosystem-display.js als
// blanker Bezeichner, sobald Block D wirklich gebaut wird (Vorbild garetien-bloecke.test.js).
global.document = global.document || { documentElement: {}, getElementById() { return null; },
	addEventListener() {}, querySelectorAll() { return []; } };
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };
["js/map-features/ecosystem-display.js", "js/map-features/location-zoom-bands.js"].forEach(function (datei) {
	vm.runInThisContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), { filename: datei });
});
global.avesmapsLabelArtName = require(path.join(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const { api } = ladeImporter();
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }
function gleich(ist, soll, was) { n++; assert.strictEqual(ist, soll, was); }

// ---- Lesehilfen: die Bloecke eines GEBAUTEN Markups ------------------------------------------------
function bloecke(markup) {
	const raus = [];
	const muster = /<div class="(gi-block(?: [^"]*)?)"><p class="gi-block__kopf(?: [^"]*)?"><span class="gi-block__zahl">([^<]*)<\/span>([^<]*)/g;
	let t;
	while ((t = muster.exec(markup)) !== null) {
		raus.push({ klasse: t[1], buchstabe: t[2], titel: t[3], stelle: t.index });
	}
	return raus;
}
function buchstaben(markup) { return bloecke(markup).map(function (b) { return b.buchstabe; }).join(""); }
function inhalt(markup, buchstabe) {
	const liste = bloecke(markup);
	const i = liste.findIndex(function (b) { return b.buchstabe === buchstabe; });
	if (i === -1) { return null; }
	return markup.slice(liste[i].stelle, i + 1 < liste.length ? liste[i + 1].stelle : markup.length);
}
function tiefe(markup, stelle) {
	const davor = markup.slice(0, stelle);
	return (davor.match(/<div\b/g) || []).length - (davor.match(/<\/div>/g) || []).length;
}
function gesperrt(markup, merkmal) {
	return new RegExp(merkmal + '[^>]*\\bdisabled\\b').test(markup);
}
function zahl(markup, muster) { return (markup.match(muster) || []).length; }

// ---- Fixtures ----------------------------------------------------------------------------------------
const QUELLE = { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
	license: "cc-by-nc-sa-3.0", source_type: "briefspiel" };
function fragment(nr) {
	return {
		key: "ggp:Waelder:Wald:Garetien:Silker Hain " + nr + "!Silker Hain " + nr,
		name: "Silker Hain " + nr, typ: "Wald", ebene: "Waelder", stand: "offen", urteil: "neu",
		wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
		grund: "nichts desselben Typs in der Nähe", verbund_stamm: "Silker Hain", verbund_n: 2,
		geometrie: [[1, 1], [2, 1], [2, 2]], quelle: QUELLE, abschnitte: [],
		items: [{ id: 30 + nr, change_type: "new", anlass: "", felder: ["quelle"] }],
	};
}
const f1 = fragment(1);
const f2 = fragment(2);
// Ein Bauwerk mit einer Siedlung im Umkreis -- nur daran GIBT es die Stätte (eine unmoegliche Wahl
// zaehlt nie, garetienZielwahlZu).
const bauwerk = {
	key: "ggp:Sonstiges:Burg:Garetien:Burg Finster!Burg Finster", name: "Burg Finster", typ: "Burg",
	ebene: "Sonstiges", stand: "offen", urteil: "neu", wiki: "ggp", ziel: "location", subtyp: "gebaeude",
	kind: "", geometrie: [[3, 3]], quelle: QUELLE, abschnitte: [],
	innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8,
		kandidaten: [{ public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8, nennt_name: false }] },
	items: [{ id: 77, change_type: "new", anlass: "" }],
};
// 🔴 BESTAND: ein Lauf von VOR dem Deploy -- kein `verbund_stamm`, kein `verbund_n`.
const uebernommen = {
	key: "ggp:Waelder:Wald:Garetien:Dunkelforst!Dunkelforst", name: "Dunkelforst", typ: "Wald",
	ebene: "Waelder", stand: "uebernommen", urteil: "neu", wiki: "ggp", ziel: "region", subtyp: "wald",
	kind: "vegetation", geometrie: [[5, 5], [6, 5], [6, 6]], quelle: QUELLE, abschnitte: [],
	items: [{ id: 901, change_type: "new", anlass: null, apply_state: "done" }],
};
const abgelehnt = {
	key: "ggp:Waelder:Wald:Garetien:Moosgrund!Moosgrund", name: "Moosgrund", typ: "Wald",
	ebene: "Waelder", stand: "abgelehnt", urteil: "neu", wiki: "ggp", ziel: "region", subtyp: "wald",
	kind: "vegetation", geometrie: [[8, 8], [9, 8], [9, 9]], quelle: QUELLE, abschnitte: [],
	items: [{ id: 902, change_type: "new", anlass: null }],
};

// `zustand.objekte` gibt es nur ueber die echte Tuer (Vorbild garetien-verbund-klick.test.js).
async function mitObjekten(objekte) {
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7 }) });
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
}

(async function () {
	api.avesmapsGaretienStageLeeren();
	await mitObjekten([f1, f2, bauwerk, uebernommen, abgelehnt]);

	// ---- 1. OFFEN: A B C F G -- D und E fehlen, C traegt nur Text -----------------------------------
	const offen = api.garetienDetailMarkup(f1, null, false);
	gleich(buchstaben(offen), "ABCFG", "auf „Offen\" die Bloecke A B C F G: " + buchstaben(offen));
	const titel = {};
	bloecke(offen).forEach(function (b) { titel[b.buchstabe] = b.titel; });
	gleich(titel.A, "Auf der Karte", "A heisst „Auf der Karte\"");
	gleich(titel.B, "Verbund", "B heisst „Verbund\"");
	gleich(titel.C, "Ziel &amp; Identität", "C heisst „Ziel & Identität\"");
	gleich(titel.F, "Handlung", "F heisst „Handlung\"");
	gleich(titel.G, "Weiter importieren", "G heisst „Weiter importieren\"");
	const cOffen = inhalt(offen, "C");
	pruefe(cOffen.indexOf(api.garetienVorschlagMarkup(f1)) !== -1,
		"C traegt auf „Offen\" den Vorschlag als Text (Aufgabe 10): " + cOffen);
	pruefe(!/data-gi-feld|<select|<input/.test(cOffen),
		"🔴 auf „Offen\" steht in C KEIN Einstellfeld (Owner 12.09.2026): " + cOffen);
	pruefe(cOffen.includes('<span class="gi-block__note">Vorschlag</span>'), "C sagt, dass es ein Vorschlag ist");
	pruefe(inhalt(offen, "A").includes("<b>Der Grund:</b> nichts desselben Typs in der Nähe"),
		"der Grund ist in Block A gewandert");
	pruefe(inhalt(offen, "A").includes("✦ Zentrieren"), "„✦ Zentrieren\" steht in A");
	pruefe(inhalt(offen, "G").includes('class="gi-naehe"'), "„Imports in der Nähe wählen\" ist Block G");
	pruefe(inhalt(offen, "F").includes('data-handlung="stage"'), "F traegt den Vorwaertsknopf");
	pruefe(!/class="gi-sec[ "]/.test(offen), "💣 keine `.gi-sec` mehr -- sie zoege eine zweite Linie in einen Block");

	// ---- 2. STAGE: A B C D E F G ---------------------------------------------------------------------
	api.avesmapsGaretienStageHinzufuegen([f1, f2]);
	const stage = api.garetienDetailMarkup(f1, null, false);
	gleich(buchstaben(stage), "ABCDEFG", "auf der Stage alle sieben: " + buchstaben(stage));
	const cStage = inhalt(stage, "C");
	const iZiel = cStage.indexOf('class="gi-ziel"');
	const iName = cStage.indexOf('data-gi-feld="einfuegeName"');
	const iForm = cStage.indexOf('data-gi-feld="zielForm"');
	pruefe(iZiel !== -1 && iName !== -1 && iForm !== -1 && cStage.includes('data-gi-feld="zielArt"'),
		"C traegt Zielwahl, Name, Form und Art: " + cStage);
	pruefe(iZiel < iName && iName < iForm, "in dieser Reihenfolge");
	// 💣 JEDES FELD GENAU EINMAL: Zielwahl und Namensfeld standen von Aufgabe 9 bis hierher in der Leiste.
	// Zweimal gezeichnet truegen zwei Felder dieselbe id.
	gleich(zahl(stage, /data-gi-feld="einfuegeName"/g), 1, "das Namensfeld steht genau einmal in der Spalte");
	gleich(zahl(stage, /role="radiogroup"/g), 1, "die Zielwahl steht genau einmal in der Spalte");
	pruefe(!/data-gi-feld=/.test(inhalt(stage, "F")), "🔴 F traegt kein Einstellfeld mehr: " + inhalt(stage, "F"));
	pruefe(inhalt(stage, "D").includes("für Klicks gesperrt"), "D traegt die Felder der Flaeche");
	pruefe(inhalt(stage, "E").includes("Die Quelle, die mitreist") && inhalt(stage, "E").includes("Wiki-Landschaft"),
		"E traegt Quelle und Wiki-Landschaft");
	const klasse = {};
	bloecke(stage).forEach(function (b) { klasse[b.buchstabe] = b.klasse; });
	gleich(klasse.A, "gi-block gi-block--erster", "A ist der erste Block");
	gleich(klasse.D, "gi-block gi-insert", "💣 D traegt gi-insert -- die Regler sind darunter verengt");
	gleich(klasse.E, "gi-block gi-insert", "E ebenso");
	gleich(klasse.F, "gi-block gi-acts", "F traegt gi-acts am Block selbst");
	gleich(zahl(stage, /class="gi-block[ "]/g), bloecke(stage).length, "kein Block ohne Buchstaben");
	gleich(zahl(stage, /gi-block--erster/g), 1, "genau EIN erster Block");
	pruefe(stage.startsWith('<div class="gi-detail">') && stage.endsWith("</div>"), "eine rollende Ansicht");
	bloecke(stage).forEach(function (b) {
		gleich(tiefe(stage, b.stelle), 1, "🔴 Block " + b.buchstabe + " ist direktes Kind von .gi-detail");
	});

	// ---- 3. Abgeblendet, nicht ausgeblendet ------------------------------------------------------------
	// ⚠️ Nur mit Zielen, die es fuer DIESES Objekt gibt -- an einer Flaeche „Nichts" und „Auf die Karte".
	api.garetienZielwahlSetzen(f1, "nichts");
	const nichts = api.garetienDetailMarkup(f1, null, false);
	gleich(buchstaben(nichts), "ABCDEFG", "⚠️ ein anderes Ziel nimmt keinen Block weg -- die Spalte springt nicht");
	pruefe(gesperrt(inhalt(nichts, "C"), 'data-gi-feld="einfuegeName"'), "bei „Nichts\" ist der Name gesperrt");
	pruefe(gesperrt(inhalt(nichts, "C"), 'data-gi-feld="zielForm"'), "…und die Form");
	pruefe(inhalt(nichts, "C").includes("gi-insert__row--aus"), "…und die Zeilen sind abgeblendet");
	pruefe(inhalt(nichts, "D").includes("gi-insert__row--aus")
		&& gesperrt(inhalt(nichts, "D"), 'id="' + api.garetienEingabeId(f1, "isLocked") + '"'),
		"D bleibt stehen, grau und gesperrt");
	api.garetienZielwahlSetzen(f1, "karte");
	const karte = api.garetienDetailMarkup(f1, null, false);
	pruefe(!karte.includes("gi-insert__row--aus"), "die Gegenprobe: „Auf die Karte\" blendet nichts ab");
	pruefe(!gesperrt(inhalt(karte, "C"), 'data-gi-feld="einfuegeName"'), "…und sperrt nichts");
	api.garetienZielwahlVergessen();

	// ---- 4. Zusammengelegt: C sagt, wem die Einstellungen gelten ----------------------------------------
	const schluessel = api.garetienVerbundSchluessel(f1);
	api.garetienVerbundZusammenlegen(schluessel, [f1, f2]);
	pruefe(inhalt(api.garetienDetailMarkup(f1, null, false), "C")
		.includes('<span class="gi-block__note">gilt dem ganzen Verbund</span>'), "C sagt „gilt dem ganzen Verbund\"");
	api.garetienVerbundAufloesen(schluessel);

	// ---- 5. Das Bauwerk: Siedlung und Umkreis in C, genau einmal -- und die Stätte ----------------------
	api.avesmapsGaretienStageHinzufuegen([bauwerk]);
	const mBau = api.garetienDetailMarkup(bauwerk, null, false);
	gleich(zahl(inhalt(mBau, "C"), /data-gi-umkreis="innerorts"/g), 1,
		"💣 der Innerorts-Umkreis steht in C, genau einmal: " + inhalt(mBau, "C"));
	gleich(zahl(mBau, /id="garetien-umkreis-innerorts"/g), 1, "und keine zweite gleiche id");
	gleich(zahl(mBau, /data-gi-feld="innerorts"/g), 1, "die Siedlung steht genau einmal -- in C");
	api.garetienZielwahlSetzen(bauwerk, "staette");
	gleich(api.garetienZielwahlZu(bauwerk), "staette", "Testvoraussetzung: am Bauwerk mit Siedlung gibt es die Stätte");
	const staette = api.garetienDetailMarkup(bauwerk, null, false);
	pruefe(!gesperrt(inhalt(staette, "C"), 'data-gi-feld="einfuegeName"'), "eine Stätte behaelt ihren Namen");
	pruefe(gesperrt(inhalt(staette, "C"), 'data-gi-feld="zielForm"') && inhalt(staette, "C").includes("gilt nicht für eine Stätte"),
		"…aber nicht ihre Form -- mit Grund");
	pruefe(inhalt(staette, "D").includes("gi-insert__row--aus") && gesperrt(inhalt(staette, "D"), 'data-gi-feld="isRuined"'),
		"…und D steht grau und gesperrt da");
	api.garetienZielwahlVergessen();

	// ---- 6. BESTAND: ein uebernommenes Objekt eines alten Laufs -- A und F, C bis E fehlen ---------------
	const mUeb = api.garetienDetailMarkup(uebernommen, null, false);
	gleich(buchstaben(mUeb), "AF", "🔴 uebernommen: nur A und F (Owner 14.09.2026): " + buchstaben(mUeb));
	pruefe(inhalt(mUeb, "F").includes('data-handlung="ruecknahme"') && inhalt(mUeb, "F").includes("Zurücknehmen"),
		"F traegt „Zurücknehmen\"");
	pruefe(inhalt(mUeb, "A").includes("Liegt bereits auf der Karte."), "der Satz, wo es liegt, steht in A");
	api.avesmapsGaretienStageHinzufuegen([uebernommen]);
	gleich(buchstaben(api.garetienDetailMarkup(uebernommen, null, false)), "AF",
		"⚠️ auch auf der Stage (bis garetienStageNachschlagen es abraeumt) keine Einstellbloecke");

	// ---- 7. BESTAND: eine abgelehnte Zeile -- A C F G, F traegt „Wieder vorschlagen" ---------------------
	const mAbg = api.garetienDetailMarkup(abgelehnt, null, false);
	gleich(buchstaben(mAbg), "ACFG", "🔴 abgelehnt: A C F G: " + buchstaben(mAbg));
	pruefe(inhalt(mAbg, "F").includes('data-handlung="wieder"'), "F traegt „Wieder vorschlagen\"");
	pruefe(!inhalt(mAbg, "F").includes('data-handlung="stage"'), "und nichts, das sie auf die Stage legt");
	pruefe(!/data-gi-feld|<select/.test(inhalt(mAbg, "C")), "C bleibt Text");

	// ---- 8. Ohne Auswahl kein Block -------------------------------------------------------------------------
	gleich(bloecke(api.garetienDetailMarkup(null)).length, 0, "ohne Auswahl steht der Hinweissatz, kein Block");

	// ---- 9. Der Bauer selbst ---------------------------------------------------------------------------------
	gleich(api.garetienBlockMarkup("C", "Ziel & Identität", "", "Vorschlag", false), "", "ohne Inhalt kein Block");
	gleich(api.garetienBlockMarkup("A", "T<", "<i>x</i>", "N&", true),
		'<div class="gi-block gi-block--erster"><p class="gi-block__kopf"><span class="gi-block__zahl">A</span>'
		+ 'T&lt;<span class="gi-block__note">N&amp;</span></p><i>x</i></div>', "Titel und Notiz escaped, erster Block");
	gleich(api.garetienBlockMarkup("F", "Handlung", "i", "", false, { blockKlasse: "gi-acts", kopfKlasse: "gi-acts__titel" }),
		'<div class="gi-block gi-acts"><p class="gi-block__kopf gi-acts__titel"><span class="gi-block__zahl">F</span>'
		+ "Handlung</p>i</div>", "Zusatzklassen an Block und Kopf");
	gleich(api.garetienZeilenAbblenden('<p class="gi-insert__row">a</p><p class="gi-insert__row gi-insert__row--edit">b</p>'
		+ '<label class="x gi-insert__row" for="y">'),
		'<p class="gi-insert__row gi-insert__row--aus">a</p><p class="gi-insert__row gi-insert__row--aus gi-insert__row--edit">b</p>'
		+ '<label class="x gi-insert__row gi-insert__row--aus" for="y">', "abgeblendet wird die Grundklasse, nie ein Modifikator");

	// ---- 10. Das CSS ---------------------------------------------------------------------------------------
	const roh = fs.readFileSync(path.join(WURZEL, "css/components/garetien-importer.css"), "utf8").replace(/\r\n/g, "\n");
	const css = roh.replace(/\/\*[\s\S]*?\*\//g, "");
	const block = (css.match(/\.gi-block\s*\{[^}]*\}/) || [""])[0];
	pruefe(block !== "", "die Regel .gi-block fehlt -- die Proben darunter messen sonst nichts");
	pruefe(/border-top:\s*1px solid var\(--color-divider\)/.test(block), "gruppiert wird ueber die Trennlinie");
	pruefe(!/border(-radius)?\s*:/.test(block.replace(/border-top/g, "")), "⚠️ und nie ueber einen Rahmen (§12)");
	pruefe(/\.gi-block\.gi-acts\s*\{[^}]*padding-left:\s*0/.test(css), "F nimmt ein Eigenpolster von .gi-acts zurueck");
	pruefe(!/\.gi-detail\s*>\s*\.gi-acts\s*\{/.test(css), "💣 `.gi-detail > .gi-acts` ist weg -- sie ueberstimmte .gi-block");
	pruefe(!/\.avm-col\s*>\s*\.gi-naehe\s*\{/.test(css), "💣 `.gi-win .avm-col > .gi-naehe` ist weg -- G steht in .gi-detail");
	pruefe(!/\.gi-sec(__note)?\s*\{/.test(css), "`.gi-sec` ist als tote Regel mitgegangen");
	pruefe(!/\.gi-acts\s*>\s*\.gi-ziel\s*\{/.test(css) && !/\.gi-acts\s+\.gi-insert__row\s*\{/.test(css),
		"💣 `.gi-acts > .gi-ziel` und `.gi-acts .gi-insert__row` sind weg -- in der Leiste steht keine Eingabe mehr");
	pruefe(/\.gi-block__zahl\s*\{[^}]*font-size:\s*var\(--font-size-caption\)/.test(css), "die Zahl im Kreis steht auf 11 px");
	// ⚠️ Die Regel baut Aufgabe 9; dieser Block setzt sie voraus (Abschnitt 3) und haelt ihre Stelle fest.
	pruefe(css.search(/\.gi-insert__row--aus\s*\{/) > css.search(/\.gi-insert__row\s*\{/),
		"⚠️ .gi-insert__row--aus (Aufgabe 9) steht HINTER .gi-insert__row -- gleich spezifisch, die spaetere gewinnt");

	// 💣 DIE STELLE DES BLOCKS: hinter der Zielwahl (Aufgabe 9), vor „Aufgabe 15" -- und keine Regel DAHINTER
	// setzt an einem Element eines Blocks eine Eigenschaft des Blocks. Gleich spezifisch gewinnt die spaetere,
	// und tools/mockup-vertrag prueft nur Deklarationen. Ausgefuehrt, nicht gelesen: jede Regel wird zerlegt.
	const stelle = roh.search(/^\.gi-block\s*\{/m);
	pruefe(stelle > roh.search(/^\.gi-ziel\s*\{/m) && stelle < roh.indexOf("Aufgabe 15: die Handlungsleiste"),
		"der Block steht hinter der Zielwahl (Aufgabe 9) und vor „Aufgabe 15\"");
	const lang = function (eigenschaft) {
		const e = eigenschaft.trim().toLowerCase();
		if (e === "margin" || e === "padding") { return ["top", "right", "bottom", "left"].map(function (s) { return e + "-" + s; }); }
		if (e === "border") { return ["top", "right", "bottom", "left"].map(function (s) { return "border-" + s; }); }
		const teil = e.match(/^(border-(?:top|right|bottom|left))-(?:width|style|color)$/);
		return [teil ? teil[1] : e];
	};
	const regeln = [];
	roh.slice(stelle).replace(/\/\*[\s\S]*?\*\//g, "").replace(/([^{}]+)\{([^{}]*)\}/g, function (_, sel, rumpf) {
		regeln.push({ sel: sel.trim(), props: rumpf.split(";").map(function (d) { return d.split(":")[0]; })
			.filter(function (d) { return d.trim() !== ""; }).reduce(function (a, p) { return a.concat(lang(p)); }, []) });
		return "";
	});
	const eigen = function (selektor) { return (regeln.find(function (r) { return r.sel === selektor; }) || { props: [] }).props; };
	pruefe(eigen(".gi-block").indexOf("margin-top") !== -1 && eigen(".gi-block__kopf").indexOf("margin-bottom") !== -1,
		"die Probe kennt die Eigenschaften der Blockregeln -- sonst faende sie nie etwas");
	const elemente = [
		{ klassen: ["gi-block", "gi-acts"], props: eigen(".gi-block") },
		{ klassen: ["gi-block", "gi-insert"], props: eigen(".gi-block") },
		{ klassen: ["gi-block__kopf", "gi-acts__titel"], props: eigen(".gi-block__kopf") },
	];
	const ueberstimmt = [];
	regeln.forEach(function (r) {
		r.sel.split(",").forEach(function (teil) {
			if (/gi-block/.test(teil)) { return; }
			const rechts = teil.trim().split(/[\s>+~]+/).pop() || "";
			const klassen = (rechts.match(/\.[\w-]+/g) || []).map(function (k) { return k.slice(1); });
			elemente.forEach(function (el) {
				if (klassen.length === 0 || !klassen.every(function (k) { return el.klassen.indexOf(k) !== -1; })) { return; }
				r.props.forEach(function (p) {
					if (el.props.indexOf(p) !== -1) { ueberstimmt.push(teil.trim() + " { " + p + " }"); }
				});
			});
		});
	});
	gleich(ueberstimmt.join(" · "), "", "💣 keine spaetere Regel ueberstimmt einen Block");

	console.log("OK -- garetien-detailspalte-reihenfolge (" + n + " Zusicherungen)");
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-detailspalte-reihenfolge.test.js
```

Erwartet: `AssertionError [ERR_ASSERTION]: auf „Offen" die Bloecke A B C F G: ` — mit leerer Folge, weil es noch keinen Blockkopf gibt. Gesehen im Probelauf auf `garetien-fragmente-verbund` mit den eingespielten Aufgaben 9 und 10 (Code aus `plan-teil-ziel.md`).

- [ ] **Schritt 3: Umsetzen**

**3a — die Blöcke C, D, E.** Ersetze `function garetienEingefuegtWirdMarkup(objekt) { … }` (nach Aufgabe 10 ~:5405–5474: Offen-Zweig mit `garetienVorschlagMarkup`, dann Form/Art mit `ausGrund` und die Felder der Form) vollständig durch den folgenden Abschnitt — vier Funktionen stehen davor:

```js
	// REIN: blendet jede `.gi-insert__row` eines fertigen Markups ab (`.gi-insert__row--aus`) -- fuer
	// Block D, dessen Felder aus vier Bauern kommen, die keinen Abblend-Parameter kennen.
	// ⚠️ Der Vorausblick `(?=[\s"])` trifft die Grundklasse, nie ihre Modifikatoren: in
	// `gi-insert__row gi-insert__row--edit` bekommt nur die erste den Zusatz.
	// 💣 Die Felder selbst sperrt der AUFRUFER ueber das `deaktiviert` der Bauer -- diese Funktion
	// faerbt nur. Ein grauer, aber bedienbarer Regler waere schlimmer als ein bunter.
	function garetienZeilenAbblenden(markup) {
		return String(markup || "").replace(/(class="[^"]*\bgi-insert__row)(?=[\s"])/g, "$1 gi-insert__row--aus");
	}

	/*
	 * REIN: der INHALT von Block C „Ziel & Identität" (Entwurf 2026-09-14 §3).
	 *
	 * 🔴 AUF „OFFEN" UND „ABGELEHNT" NUR TEXT (Owner 12.09.2026: „der Vorschlag ist sichtbar,
	 * geändert wird er erst auf der Stage"). garetienVorschlagMarkup (Aufgabe 10) traegt kein
	 * einziges Einstellfeld.
	 * 🔴 AUF DER STAGE: Zielwahl samt Siedlung und Umkreis · Name · Typzeile · Form · Art (Mockup §3–§5).
	 * Zielwahl und Name standen von Aufgabe 9 bis hierher ueber der Knopfleiste (garetienHandlungsMarkup);
	 * sie beantworten die Frage dieses Blocks („was entsteht?"), nicht die der Handlung.
	 * 💣 JEDES FELD GENAU EINMAL. Zielwahl, Siedlung, Umkreis und Name tragen ids (garetienEingabeId);
	 * stuenden sie auch in F, gaebe es zwei Elemente mit derselben id.
	 * ⚠️ ABGEBLENDET WIRD IN DEN BAUERN VON AUFGABE 9, nicht hier: garetienZielNameZeile (Name),
	 * garetienZielWahlMarkup mit `ausGrund` (Form und Art samt „gilt nicht für …"),
	 * garetienInnerortsZeileMarkup (Siedlung). Eine zweite Regel an dieser Stelle liefe beim naechsten
	 * Zielwert auseinander.
	 * ⚠️ Fuer ein UEBERNOMMENES Objekt fragt diese Funktion niemand: garetienEingefuegtWirdMarkup
	 * steigt vorher aus (Bestand, Owner 14.09.2026 -- C bis E fehlen).
	 */
	function garetienIdentitaetMarkup(objekt) {
		if (!objekt) { return ""; }
		const o = objekt;
		if (!avesmapsGaretienStageHat(o.key)) {
			return garetienVorschlagMarkup(o);
		}
		// Der Umkreis-Spinner steht bei jedem Bauwerk IN der Zielwahl (garetienInnerortsZeileMarkup) --
		// hier kommt kein zweiter dazu.
		let inhalt = garetienZielwahlMarkup(o) + garetienZielNameZeile(o);
		if (!garetienEingefuegtWirdHatVorschlag(o)) { return inhalt; }
		// ⚠️ Die Typzeile („Wald (garetien.de) → Wald (Avesmaps)") bleibt die EINZIGE Stelle, an der sie
		// steht (Fuenf-Punkte-Brief 30.08.2026, Punkt 4) -- sie erklaert die zwei Felder darunter.
		inhalt += '<p class="gi-why gi-insert__kopf">' + avesmapsGaretienEscape(garetienTypText(o)) + "</p>"
			+ garetienZielWahlMarkup(o, false, garetienZielwahlAusGrund(o));
		return inhalt;
	}

	// REIN: der INHALT von Block D „Darstellung" -- die Felder der GEWÄHLTEN Form (seit 01.09.2026
	// entscheidet die Wahl, nicht der Vorschlag: eine Fläche hat andere Felder als ein Gipfel).
	// ⚠️ `deaktiviert` sperrt jedes Feld; abgeblendet wird beim Aufrufer.
	function garetienDarstellungMarkup(objekt, deaktiviert) {
		const wahl = garetienZielWahlZu(objekt);
		const ziel = String(wahl.ziel || "");
		const subtyp = String(wahl.subtyp || "");
		if (ziel === "region") {
			return garetienEingefuegtWirdFlaecheMarkup(objekt, deaktiviert)
				+ garetienEingefuegtWirdBeschriftungMarkup(objekt, subtyp, true, deaktiviert);
		}
		if (ziel === "label") {
			return garetienEingefuegtWirdBeschriftungMarkup(objekt, subtyp, false, deaktiviert);
		}
		if (ziel === "location") {
			return garetienEingefuegtWirdOrtMarkup(objekt, subtyp, deaktiviert);
		}
		if (ziel === "path") {
			return garetienEingefuegtWirdWegMarkup(objekt, subtyp, deaktiviert);
		}
		return "";
	}

	// REIN: der INHALT von Block E „Wiki & Quellen".
	// 🔴 DER STAND DER WIKI-LANDSCHAFT KOMMT AUS DEM SPEICHER, NICHT FEST AUS DEM WARTETEXT: dieses
	// Markup wird bei jedem `garetienDetailRendern` neu gebaut, und der Lader feuert je Objekt nur
	// einmal (siehe `_garetienWikiLandschaftErgebnis`). Fest gesetzt stuende hier fuer immer
	// „wird gesucht …".
	function garetienWikiQuellenMarkup(objekt) {
		let markup = garetienQuellenMarkup(objekt);
		if (String(garetienZielWahlZu(objekt).ziel || "") === "region") {
			const wikiLandschaftStand = garetienWikiLandschaftStand(objekt);
			markup += '<p class="gi-insert__row" id="' + garetienWikiLandschaftPlatzhalterId(objekt) + '">'
				+ 'Wiki-Landschaft <span class="gi-insert__val">'
				+ avesmapsGaretienEscape(wikiLandschaftStand === null ? "wird gesucht …" : wikiLandschaftStand.text)
				+ "</span></p>"
				// KORREKTUR B: die manuelle Suche -- verborgen, bis der automatische Treffer oben als
				// leer/mehrdeutig/fehlgeschlagen feststeht (garetienWikiSucheBeiBedarfZeigen).
				+ '<div id="' + garetienWikiSucheHostId(objekt) + '" hidden></div>';
		}
		return markup;
	}

	/*
	 * Die Bloecke C, D und E -- was aus dem Objekt wird (Entwurf 2026-09-14 §3).
	 *
	 * 🔴 SOLANGE ES NICHT AUF DER STAGE LIEGT, GIBT ES NUR C (Owner 09.09.2026: „die sind alle auf der
	 * stage erst wichtig"). Auf „Offen" entscheidet ein Editor zwei Dinge -- ueberhaupt? und als was?
	 * Darstellung, Wiki und Quellen beantworten keine davon.
	 * 🔴 EIN UEBERNOMMENES OBJEKT BEKOMMT KEINEN DER DREI (Bestand, Owner 14.09.2026; Mockup §6). Bis
	 * dahin zeigte der Kasten dort alle Felder gesperrt (Punkt 6a vom 30.08.2026) -- sie liessen sich
	 * nirgends mehr aendern, und geaendert wird ein angelegtes Objekt auf der Karte. Der Satz, wo es
	 * liegt und ob es zurueckgeht, ist in Block A gewandert (garetienDetailMarkup).
	 * ⚠️ Der Name der Funktion bleibt: vier Testdateien und der Wiki-Landschaft-Lader messen an ihr,
	 * und „was eingefügt wird" ist genau das, was C bis E beschreiben.
	 * 💣 D UND E TRAGEN `gi-insert` AM BLOCK. Die Reglerzeilen sind in garetien-importer.css unter
	 * `.gi-insert` verengt (`.gi-insert .label-edit-sliderrow` …); ohne die Klasse bekaeme der Regler
	 * die geteilte Polsterung aus location-report-dialog.css, und seine Vorgabemarke saesse neben der
	 * Spur (garetienSliderMarkePosition rechnet mit 0 px Polster).
	 * ⚠️ D BLEIBT IN VOLLER HOEHE STEHEN, grau und gesperrt, wenn das Ziel keine Darstellung braucht.
	 * Das Mockup (§5, „Burg Finster") zeichnet dort eine einzige Zeile -- eine Zeile statt der Felder
	 * liesse die Spalte bei jedem Wechsel der Zielwahl springen (Entwurf §3: abgeblendet, nicht
	 * ausgeblendet).
	 */
	function garetienEingefuegtWirdMarkup(objekt) {
		if (!objekt) { return ""; }
		if (String(objekt.stand || "") === "uebernommen") { return ""; }
		const aufDerStage = avesmapsGaretienStageHat(objekt.key);
		const verbund = garetienVerbundSchluessel(objekt);
		let notiz = "";
		if (!aufDerStage) {
			notiz = "Vorschlag";
		} else if (verbund !== "" && garetienVerbundIstZusammen(verbund)) {
			notiz = "gilt dem ganzen Verbund";
		}
		let markup = garetienBlockMarkup("C", "Ziel & Identität", garetienIdentitaetMarkup(objekt), notiz, false);
		if (!aufDerStage || !garetienEingefuegtWirdHatVorschlag(objekt)) { return markup; }
		// 🔴 DIESELBE WEICHE WIE FORM UND ART IN C (garetienZielwahlAusGrund, Aufgabe 9): "" heisst „gilt".
		// Eine eigene Liste „welche Ziele brauchen eine Darstellung" waere die zweite Wahrheit.
		const aus = garetienZielwahlAusGrund(objekt) !== "";
		const darstellung = garetienDarstellungMarkup(objekt, aus);
		markup += garetienBlockMarkup("D", "Darstellung",
			aus ? garetienZeilenAbblenden(darstellung) : darstellung, "", false, { blockKlasse: "gi-insert" });
		markup += garetienBlockMarkup("E", "Wiki & Quellen", garetienWikiQuellenMarkup(objekt), "", false,
			{ blockKlasse: "gi-insert" });
		return markup;
	}
```

**3b — der Blockbauer.** Unmittelbar vor dem Kommentar `// REIN: die ganze rechte Spalte.` (~:5986):

```js
	/*
	 * REIN: EIN Block der Einzelansicht -- Buchstabe, Titel, optionale Notiz, Inhalt
	 * (Entwurf 2026-09-14 §3, Mockup §2 bis §4).
	 *
	 * 🔴 DIE BUCHSTABEN BLEIBEN UND FLUCHTEN (Owner 09.09.2026: „bleiben — mach sie nur
	 * einheitlich"). JEDER Blockkopf entsteht hier. Ein zweiter, handgeschriebener Kopf -- etwa fuer
	 * die Handlungsleiste -- waere genau die Stelle, an der ein Buchstabe einrueckt, ohne dass es im
	 * Quelltext auffaellt.
	 * ⚠️ Gruppiert wird ueber Ueberschrift und TRENNLINIE, nie ueber einen Rahmen (AGENTS.md §12).
	 * ⚠️ Ein Block ohne Inhalt entfaellt ganz -- eine Ueberschrift ueber nichts behauptet einen
	 * Abschnitt, den es nicht gibt. Jeder Aufrufer darf seinen Inhalt deshalb ungeprueft hereinreichen.
	 * 💣 `erster` statt `:first-of-type`: vor Block A stehen Name und Metazeile, und der Namenskopf
	 * IST ein `<div>` -- `:first-of-type` traefe ihn und nie Block A.
	 * ⭐ `zusatz` (optional) haengt Klassen an Block und Kopf: `gi-acts` an F (Flexreihe und
	 * Grundzeile haengen daran), `gi-insert` an D und E (die Reglerzeilen sind in
	 * garetien-importer.css unter `.gi-insert` verengt und verloeren ohne die Klasse ihre Polsterung).
	 */
	function garetienBlockMarkup(buchstabe, titel, inhalt, notiz, erster, zusatz) {
		if (String(inhalt || "") === "") { return ""; }
		const z = zusatz || {};
		const blockKlasse = "gi-block" + (erster === true ? " gi-block--erster" : "")
			+ (String(z.blockKlasse || "") === "" ? "" : " " + String(z.blockKlasse));
		const kopfKlasse = "gi-block__kopf"
			+ (String(z.kopfKlasse || "") === "" ? "" : " " + String(z.kopfKlasse));
		const notizMarkup = String(notiz || "") === "" ? ""
			: '<span class="gi-block__note">' + avesmapsGaretienEscape(notiz) + "</span>";
		return '<div class="' + blockKlasse + '"><p class="' + kopfKlasse + '">'
			+ '<span class="gi-block__zahl">' + avesmapsGaretienEscape(buchstabe) + "</span>"
			+ avesmapsGaretienEscape(titel) + notizMarkup + "</p>" + inhalt + "</div>";
	}
```

**3c — die Spalte.** Ersetze `function garetienDetailMarkup(objekt, sicht, unsereVorhanden) { … }` (~:6003–6087) vollständig:

```js
	function garetienDetailMarkup(objekt, sicht, unsereVorhanden) {
		if (!objekt) {
			return '<div class="gi-detail"><p class="avm-empty">Wähle links eine Zeile — hier steht'
				+ " dann, was bei uns an derselben Stelle liegt.</p></div>";
		}
		const abschnitte = objekt.abschnitte || [];
		const gruppen = garetienAbschnittsGruppen(abschnitte);

		// 🔴 Der Kopf ist KEIN Block. Er traegt keinen Buchstaben, weil er nichts gliedert: er nennt,
		// WORUEBER die Bloecke darunter sprechen. Die Typ-Zuordnung steht nicht hier, sondern in
		// Block C (Fuenf-Punkte-Brief 30.08.2026, Punkt 4 -- dieselbe Angabe zweimal auf dem
		// Bildschirm waere die Duplikation aus AGENTS.md §5).
		const kopf = '<div class="gi-detail__head">'
			+ '<h4 class="gi-detail__name">' + avesmapsGaretienEscape(objekt.name || "") + "</h4>"
			+ "</div>" + garetienDetailMetaMarkup(objekt);

		// ---- A · Auf der Karte ---------------------------------------------------------------------
		// ⚠️ Ohne Geometrie gaebe es nichts anzufliegen -- dann stehen weder „✦ Zentrieren" noch die
		// zwei Sicht-Knoepfe da. Sie schalten, was auf der Karte liegt, und ein Bedienelement, das an
		// der geoeffneten Zeile nichts bewirkt, ist eine sichtbare Stoerung.
		let aufDerKarte = "";
		if (Array.isArray(objekt.geometrie) && objekt.geometrie.length > 0) {
			aufDerKarte += '<button class="gi-show" type="button" data-key="'
				+ avesmapsGaretienEscape(objekt.key || "") + '">'
				+ "✦ Zentrieren</button>";
			aufDerKarte += garetienSichtLeisteMarkup(sicht, unsereVorhanden === undefined
				? garetienUnsereVorhanden([objekt])
				: unsereVorhanden, abschnitte.length === 0);
		}
		// Die Notiz traegt, was bis zum 14.09.2026 unter „Was bei uns an derselben Stelle liegt" stand.
		// 🔴 Der Deckungsgrad kommt vom SERVER: er IST das Ergebnis des Abgleichs, im Browser
		// nachgerechnet waere er die zweite Wahrheit ueber „wie gut deckt sich das".
		// ⚠️ `null` heisst „nicht gemessen" und ist nicht dasselbe wie 0 (= liegt genau darauf).
		let notiz = garetienAnzahlText(abschnitte.length, "Abschnitt", "Abschnitte");
		if (gruppen.gesamt >= 2) {
			notiz += " · " + gruppen.gesamt + " verschiedene Objekte";
		}
		if (typeof objekt.deckung === "number" && isFinite(objekt.deckung)) {
			notiz += " · Deckung Median " + garetienZahlText(objekt.deckung);
		}
		aufDerKarte += abschnitte.length === 0
			? '<p class="gi-why">Zu diesem Objekt steht kein Abschnitt von uns im Vorschlag.</p>'
			: abschnitte.map(function (abschnitt) {
				return garetienAbschnittMarkup(objekt, abschnitt);
			}).join("");
		aufDerKarte += garetienDetailBombeMarkup(objekt, gruppen);
		// Der Grund kommt fertig vom Server (garetien-abgleich.php baut den Satz). Ohne Grund steht
		// auch das Wort nicht da -- ein Abschnitt, der nur leer sein kann, luegt.
		// 💣 KEINE eigene Ueberschrift mehr: eine `.gi-sec` zoege eine zweite Trennlinie mitten in
		// Block A, und eine Linie gliedert in dieser Spalte BLOECKE, nicht Saetze.
		const grund = String(objekt.grund || "").trim();
		if (grund !== "") {
			aufDerKarte += '<p class="gi-why"><b>Der Grund:</b> ' + avesmapsGaretienEscape(grund) + "</p>";
		}
		// 🔴 EIN UEBERNOMMENES OBJEKT SAGT HIER, WO ES LIEGT UND OB ES ZURUECKGEHT (Punkt 6b, Owner
		// 30.08.2026). Der Satz stand bis zum 14.09.2026 im Kasten „Eingefügt wird"; der faellt fuer ein
		// uebernommenes Objekt ganz weg (Bestand, Owner 14.09.2026: C bis E fehlen), und „Auf der Karte"
		// ist genau die Frage, die er beantwortet. Fuer jeden anderen Stand liefert er "".
		aufDerKarte += garetienEingefuegtWirdUebernommenHinweis(objekt);

		// ---- G · Weiter importieren ----------------------------------------------------------------
		// ⚠️ Ein Werkzeug fuer die LISTE („Imports in der Nähe wählen"), keine Einstellung dieses
		// Objekts -- deshalb darf es als einziger Block auch auf „Offen" bedienbar sein (Entwurf §3).
		// Ein uebernommenes Objekt bekommt es nicht: dort gibt es nichts mehr weiter zu importieren.
		// 💣 G STEHT SEIT DEM 14.09.2026 IN `.gi-detail`, nicht mehr als Geschwister darunter. Als
		// Geschwister lag sein Kopf ausserhalb der Bildlaufrinne (`scrollbar-gutter: stable
		// both-edges`) und damit um die Rinnenbreite weiter links als A–F -- die Buchstaben fluchteten
		// nicht. `.gi-win .avm-col > .gi-naehe` ist dafuer entfernt (eine tote Regel liest der naechste
		// als geltend).
		const weiter = String(objekt.stand || "") === "uebernommen"
			? ""
			: garetienBlockMarkup("G", "Weiter importieren", garetienNaeheMarkup(objekt), "", false);

		// 🔴 DIE REIHENFOLGE IST DIE GLIEDERUNG (Entwurf 2026-09-14 §3): was da liegt (A, B), was
		// daraus wird (C, D, E), was jetzt passiert (F, G). D und E gibt es nur auf der Stage -- das
		// entscheidet garetienEingefuegtWirdMarkup, nicht diese Funktion.
		// ⚠️ Der Verbund-Block fragt `zustand.objekte`: ein Fragment ohne eigene Geometrie bleibt
		// Mitglied und muss B trotzdem zeigen koennen.
		return '<div class="gi-detail">' + kopf
			+ garetienBlockMarkup("A", "Auf der Karte", aufDerKarte, notiz, true)
			+ garetienVerbundBlockMarkup(objekt, zustand.objekte || [])
			+ garetienEingefuegtWirdMarkup(objekt)
			+ garetienHandlungsMarkup(objekt)
			+ weiter
			+ "</div>";
	}
```

**3d — Block B.** In `garetienVerbundBlockMarkup` ersetze die Rückgabe, wie Aufgabe 7 sie hinterlässt,

```js
		return '<p class="gi-sec">Verbund<span class="gi-sec__note">'
			+ (zusammen ? "zusammengelegt · " : "") + mitglieder.length + " Fragmente</span></p>" + zeilen + knopf;
```

durch

```js
		// 🔴 SEIT DEM 14.09.2026 BLOCK B „Verbund" (Entwurf 2026-09-14 §3). Kein `erster`: vor ihm
		// steht immer Block A. Was hinter der Ueberschrift verkettet wird -- die Zeilen, der Knopf und
		// seine Grundzeile aus Aufgabe 7 --, ist sein Inhalt.
		return garetienBlockMarkup("B", "Verbund", zeilen + knopf,
			(zusammen ? "zusammengelegt · " : "") + mitglieder.length + " Fragmente", false);
```

**3e — Block F.** In `garetienHandlungsMarkup` ersetze den Kommentarblock ab `// 💣 DIE LEISTE SAGT, FUER WEN SIE GILT` bis einschließlich der Rückgabe (nach Aufgabe 9 ~:7389–7403). Die Rückgabe trägt dort `+ garetienZielwahlMarkup(objekt) + garetienZielNameZeile(objekt)` über den Knöpfen — beide fallen hier weg, C ruft sie (3a):

```js
		// 💣 DIE LEISTE SAGT, FUER WEN SIE GILT (Owner-Meldung 07.09.2026: „ablehnen geht generell
		// nicht"). Sie gehoert dem Objekt der EINZELANSICHT, und ein Klick auf ein HAEKCHEN wechselt
		// die nicht -- der Owner hakte „Gramfeldermoor" an, rechts stand „Briskenmoor", und abgelehnt
		// wurde Briskenmoor. Die Unterscheidung wird STRUKTURELL getroffen (dieses Objekt ↔ die
		// Auswahlleiste links ↔ die Stage im Fuss), nicht durch den Namen jedes einzelnen Knopfs.
		// 🔴 SEIT DEM 14.09.2026 IST SIE BLOCK F „Handlung" (Entwurf §3; hiess „Dieses Objekt", im
		// Verbund-Entwurf „Einfügen"). Zielwahl und Namensfeld, die Aufgabe 9 hier ueber die Knoepfe
		// gesetzt hatte, stehen seither in Block C (garetienIdentitaetMarkup): F traegt nur noch, was
		// JETZT passiert. 💣 Hier ein zweites Mal gezeichnet, trueged zwei Felder dieselbe id.
		// 💣 `gi-acts` SITZT AM BLOCK SELBST: die Flexreihe (Titel, Knoepfe, Grund je auf eigener
		// Zeile) haengt an ihr. `.gi-block.gi-acts` nimmt ein Eigenpolster zurueck, das `.gi-acts`
		// tragen kann (im Mockup `--avm-ribbon-pad`) -- sonst rueckte der Buchstabe F ein.
		return garetienBlockMarkup("F", "Handlung",
			'<div class="gi-acts__knoepfe">' + knopfMarkup + "</div>" + grundZeile, "", false,
			{ blockKlasse: "gi-acts", kopfKlasse: "gi-acts__titel" });
```

Im Kommentar über `function garetienZielNameZeile(objekt) {` (Aufgabe 9, ~:7060) ersetze die erste Zeile

```js
	// REIN: das Namensfeld unter der Zielwahl -- oder "", wenn es gar nichts anzulegen gibt.
```

durch

```js
	// REIN: das Namensfeld unter der Zielwahl in Block C -- oder "", wenn es gar nichts anzulegen gibt.
	// 🔴 SEIN EINZIGER AUFRUFER IST garetienIdentitaetMarkup (seit Aufgabe 11, 14.09.2026; davor die
	// Handlungsleiste). Er bleibt eine eigene Funktion, weil hier die Regel steht, welches Ziel einen
	// Namen braucht -- in Block C nachgeschrieben, stuende sie zweimal.
```

**3f — die Quellen in Block E.** In `garetienQuellenMarkup` (~:3622) ersetze `		return '<p class="gi-sec">'` durch

```js
		// ⚠️ Eine Unterzeile, keine `.gi-sec` mehr: sie steht seit dem 14.09.2026 IN Block E, und eine
		// zweite Trennlinie mitten im Block laese sich wie ein eigener Abschnitt.
		return '<p class="gi-insert__sub">'
```

**3g — Exporte.** Hinter `garetienDetailMarkup,` im `module.exports`:

```js
			garetienBlockMarkup,
			garetienZeilenAbblenden,
			garetienIdentitaetMarkup,
			garetienDarstellungMarkup,
			garetienWikiQuellenMarkup,
```

**3h — CSS** (`css/components/garetien-importer.css`):

1. `.gi-sec { … }` (:807) und `.gi-sec__note { … }` (:819) fallen; an ihre Stelle:

```css
/* 🪴 `.gi-sec` ist am 14.09.2026 gefallen (Aufgabe 11): jede Ueberschrift der Einzelansicht ist
   seither ein Blockkopf (`.gi-block__kopf`). Eine `.gi-sec` IM Block zoege eine zweite Trennlinie
   mitten hinein. */
```

2. Der Kommentar ab `/* 🔴 SEIT 09.09.2026 ROLLT SIE MIT, statt unten zu kleben` samt der Regel `.gi-detail > .gi-acts { … }` (~:1313–1323) fällt; an seine Stelle:

```css
/* 💣 `.gi-detail > .gi-acts` IST AM 14.09.2026 GEFALLEN (Aufgabe 11). Seit die Leiste Block F ist,
   setzt `.gi-block` sie ab -- und die alte Regel (0,2,0) schlug `.gi-block` (0,1,0): F bekam 8 statt
   12 px Aussenabstand und stand damit enger an E als jeder andere Block an seinem Vorgaenger. */
```

3. `.gi-win .avm-col > .gi-naehe { … }` (~:1536) fällt; an ihre Stelle:

```css
/* 💣 `.gi-win .avm-col > .gi-naehe` IST AM 14.09.2026 GEFALLEN (Aufgabe 11): „Weiter importieren" ist
   Block G IN `.gi-detail`. Als Geschwister darunter lag ihr Kopf ausserhalb der Bildlaufrinne
   (`scrollbar-gutter: stable both-edges`) und fluchtete nicht mit A bis F. */
```

4. Im Kommentar über `.gi-naehe {` ersetzt diese vier Zeilen die zwei Absätze ab ` * 🔴 GESCHWISTER von `.gi-acts`` bis vor ` */`:

```css
 * 🔴 SEIT DEM 14.09.2026 BLOCK G „Weiter importieren" (Entwurf 2026-09-14 §3) -- ein Kind von
 *    `.gi-detail` wie die uebrigen sechs. Trennlinie und Einzug kommen vom Block, nicht von hier.
 * 🔴 Es bleibt ein Werkzeug fuer die LISTE, keine Einstellung dieses Objekts -- deshalb als
 *    einziger Block auch auf „Offen" bedienbar.
```

5. Die Übergangsregel aus Aufgabe 9 fällt ersatzlos: ab `/* Uebergangsort bis Aufgabe 11:` samt `.gi-acts > .gi-ziel { flex: 1 0 100%; }` (~:1022–1027) bis ausschließlich `/* ---- Aufgabe „Eingefügt wird -> Eingabefelder`.

6. Der Kommentar ab `/* Die zwei Einfuege-Haekchen und die Knopfreihe darunter` samt `.gi-acts .gi-insert__row { flex: 1 0 100%; }` (~:1467–1474), bis ausschließlich `.gi-acts__knoepfe {`, wird zu:

```css
/* Die Knopfreihe (Owner 09.09.2026: „Von der Stage nehmen + Ablehnen soll in eine 2. Zeile …").
   🔴 `flex: 1 0 100%` wie beim Titel darueber -- .gi-acts ist eine flex-ZEILE, dort ist die
   Basis die BREITE. (In einer flex-SPALTE waere dieselbe Zeile die Hoehe und wuerde den Kasten
   aufblasen -- die Falle, die den Routenplaner am 05.09.2026 am Telefon zerlegt hat.)
   🪴 `.gi-acts .gi-insert__row` und `.gi-acts > .gi-ziel` sind am 14.09.2026 gefallen (Aufgabe 11):
   Zielwahl und Namensfeld stehen seither in Block C, in der Leiste steht keine Eingabezeile mehr. */
```

7. **Unmittelbar vor** dem Kommentar `/* ---- Aufgabe 15: die Handlungsleiste` (~:1292) — also hinter dem Zielwahl-Block der Aufgabe 9 (~:996–1020) und hinter jeder Regel, die `.gi-insert` trägt. Das ist die späteste Stelle vor der px-Sperre von `garetien-handlungen.test.js`, und dahinter setzt keine Regel eine Eigenschaft der Blöcke (siehe oben, „Die Stelle des Vertragsblocks"):

```css
/* ══ VERTRAG: css/components/garetien-importer.css ══ gebunden von docs/garetien-import-vereint-mockup.html
   (Aufgabe 11 des Bauplans 2026-09-14): die sieben Bloecke der Einzelansicht. Geaendert wird ein Wert IM
   MOCKUP, der Produktivcode zieht nach -- nie umgekehrt; tools/mockup-vertrag haelt beide im Deploy-Tor
   gegeneinander. Die Zielwahl und die abgeblendete Zeile bindet ein eigener Block (Aufgabe 9).
   ⚠️ Das Werkzeug prueft DEKLARATIONEN, keine Spezifitaet. Zwei Regeln dieser Datei haetten die Bloecke
   ueberstimmt und sind deshalb im selben Umbau gefallen: `.gi-detail > .gi-acts` (0,2,0 gegen `.gi-block`
   0,1,0 -- F bekam 8 statt 12 px Aussenabstand) und `.gi-win .avm-col > .gi-naehe` (G stand ausserhalb
   der Bildlaufrinne und damit weiter links). Gegengemessen wird im Browser (Bauplan, Aufgabe 11 Schritt 5).
   💣 Die Zahl im Kreis steht auf `--font-size-caption` (11 px), nicht auf den 9 px des Verbund-Mockups --
   9 px liegen unter der Untergrenze aus AGENTS.md §12. Der Kreis waechst dafuer auf 18 px.
   💣 DIE STELLE IST TRAGEND: hinter der Zielwahl (Aufgabe 9) und unmittelbar VOR dem Abschnitt der
   Handlungsleiste (Aufgabe 15). Gleich spezifisch gewinnt die spaetere Regel -- dahinter stehen deshalb
   nur Regeln, die an keinem Element eines Blocks eine Eigenschaft dieses Blocks setzen (`.gi-acts`,
   `.gi-acts__titel`, `.gi-acts__grund`, `.gi-acts__knoepfe`, `.gi-naehe`; ausgefuehrt geprueft in
   garetien-detailspalte-reihenfolge.test.js, Abschnitt 10). Noch spaeter geht nicht:
   garetien-handlungen.test.js haelt alles ab „Aufgabe 15" an dessen Regeln (keine px-Werte), und der
   Kreis ist ein Pixelmass, das der Vertrag bindet. */
.gi-block {
	margin-top: var(--space-10);
	padding-top: var(--space-6);
	border-top: 1px solid var(--color-divider);
}

.gi-block--erster {
	margin-top: 0;
	padding-top: 0;
	border-top: 0;
}

.gi-block.gi-acts {
	padding-left: 0;
	padding-right: 0;
}

.gi-block__kopf {
	display: flex;
	align-items: center;
	gap: var(--space-6);
	margin: 0 0 var(--space-4);
	font-size: var(--font-size-caption);
	letter-spacing: .06em;
	text-transform: uppercase;
	color: var(--color-accent-brown);
	font-weight: var(--font-weight-bold);
}

.gi-block__zahl {
	flex: none;
	width: 18px;
	height: 18px;
	display: grid;
	place-items: center;
	border: 1px solid var(--color-accent-brown);
	border-radius: 50%;
	font-size: var(--font-size-caption);
	line-height: 1;
	letter-spacing: 0;
}

.gi-block__note {
	margin-left: auto;
	letter-spacing: 0;
	text-transform: none;
	font-weight: var(--font-weight-regular);
	color: var(--color-text-muted);
}
/* ══ VERTRAG ENDE ══ */
```

**3i — Mockup** (`docs/garetien-import-vereint-mockup.html`, Zeilenende LF). Die zwei Kopfkommentare, die „keine bindende Marke" behaupteten, und die Marke um die Zielwahl hat Aufgabe 9 gesetzt. Hier nur die Marke um die Blöcke:

1. Unmittelbar vor `/* Die Blöcke A–G. 💣 Die Zahl im Kreis …` (:407):

```css
/* ══ VERTRAG: css/components/garetien-importer.css ══ Aufgabe 11 des Bauplans 2026-09-14 — die Blöcke A–G.
   Geändert wird ein Wert HIER; der Produktivcode zieht nach, nie umgekehrt. */
```

2. Unmittelbar hinter der Regel `.gi-block__note { … }` (:418–419), also vor der Anfangsmarke der Zielwahl aus Aufgabe 9 (`/* ══ VERTRAG: css/components/garetien-importer.css ══ Die Zielwahl (Aufgabe 9, 14.09.2026).`, :421), eine Zeile:

```css
/* ══ VERTRAG ENDE ══ */
```

💣 Die Endmarke muss VOR der Anfangsmarke der Zielwahl (Aufgabe 9) stehen — `vertragsBloecke` sucht nach jeder Anfangsmarke die NÄCHSTE Endmarke; ohne sie verschluckte der Block der Aufgabe 11 die Zielwahl-Regeln bis zu deren Ende, und die Doppelung fiele nicht auf. 💣 Kein anderer Kommentar im Mockup darf das Wort mit Doppelpunkt tragen oder die Endmarke im Fließtext nennen — `tools/mockup-vertrag` liest beides als Marke.

- [ ] **Schritt 4: Test fahren, grün sehen — fremde Tests, Vertragstest**

Fremde Tests nachziehen. Der Alttext ist jeweils der Stand nach den Aufgaben 5 bis 10 (`garetien-verbund-klick.test.js` nach Aufgabe 7, die ihn ganz ersetzt; `garetien-verbund-detail.test.js` und `garetien-verbund-zeile-nicht-klickbar.test.js` fährt Aufgabe 7 am exportierten Bauer — sie brauchen hier nichts).

**`js/review/__tests__/garetien-bloecke.test.js`** — ganz ersetzt:

```js
// Die Bloecke C, D und E der Einzelansicht (Bauplan 2026-09-14, Aufgabe 11) -- was aus dem Objekt wird.
//
// 🔴 D (Darstellung) und E (Wiki & Quellen) gibt es nur auf der Stage (Owner 09.09.2026: „die sind
// alle auf der stage erst wichtig"); auf „Offen" steht allein C, und zwar als Text.
// 🔴 Ein uebernommenes Objekt bekommt KEINEN der drei Bloecke (Bestand, Owner 14.09.2026).
//
// 🔴 FIXRUNDE 1 (Pruefbefund vom 09.09.2026) gilt weiter: die Funktion wird WIRKLICH gerufen, und
// geprueft wird das gebaute Markup. Eine Fassung, die nur Quelltext las, liess eine vollstaendig
// umgekehrte Regel gruen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-bloecke.test.js
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet -- `global.document`
// muss deshalb VOR dem `require` stehen.

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

function macheElement(id) {
	return {
		id: id, hidden: false, innerHTML: "", textContent: "",
		disabled: false, checked: false, value: "",
		addEventListener() {},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}
const ELEMENTE = {};
["garetien-detailcol", "garetien-list"].forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);
global.avesmapsLabelArtName =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienEingefuegtWirdMarkup,
	garetienVorschlagMarkup,
	avesmapsGaretienStageHinzufuegen,
	avesmapsGaretienStageHat,
} = mod;

wahr(typeof garetienEingefuegtWirdMarkup === "function", "garetienEingefuegtWirdMarkup fehlt im Export");
wahr(typeof garetienVorschlagMarkup === "function", "garetienVorschlagMarkup fehlt im Export (Aufgabe 10)");

// Die Buchstaben eines gebauten Markups, in ihrer Reihenfolge.
function buchstaben(markup) {
	return (markup.match(/<span class="gi-block__zahl">([^<]*)<\/span>/g) || [])
		.map((t) => t.replace(/<[^>]*>/g, "")).join("");
}

// =================================================================================================
// Fixture: eine Flaeche (ziel='region') -- sie traegt D (Flaeche + Beschriftung) und E (Wiki-Landschaft)
// und ist damit die schaerfste Probe fuer die Stage-Weiche.
// =================================================================================================

const huegel = {
	key: "ggp:Berge:Huegel:Garetien:Bloecketesthuegel", name: "Bloecketesthuegel", typ: "Huegel",
	subtyp: "huegelland", kind: "topographie", ziel: "region", wiki: "ggp", stand: "offen",
	quelle: { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
		license: "cc-by-nc-sa-3.0", source_type: "briefspiel" },
	abschnitte: [],
	items: [{ id: 1, change_type: "new", anlass: null }],
};

gleich(avesmapsGaretienStageHat(huegel.key), false,
	"Testvoraussetzung: das Objekt darf beim Start nicht auf der Stage liegen");

// =================================================================================================
// A. OFFEN -- nur Block C, und C ist Text
// =================================================================================================

const mOffen = garetienEingefuegtWirdMarkup(huegel);
gleich(buchstaben(mOffen), "C", "auf „Offen\" steht allein Block C: " + mOffen);
wahr(mOffen.includes('<span class="gi-block__zahl">C</span>Ziel &amp; Identität'), "Block C heisst „Ziel & Identität\"");
wahr(mOffen.includes(garetienVorschlagMarkup(huegel)), "C traegt den Vorschlag als Text");
wahr(!/data-gi-feld/.test(mOffen), "🔴 auf „Offen\" kein Einstellfeld: " + mOffen);
wahr(!mOffen.includes("für Klicks gesperrt") && !mOffen.includes("Größe"),
	"die Felder von Block D fehlen auf „Offen\"");
wahr(!mOffen.includes("Wiki-Landschaft") && !mOffen.includes("Die Quelle, die mitreist"),
	"Block E fehlt auf „Offen\"");

// =================================================================================================
// B. STAGE -- C, D und E
// =================================================================================================

avesmapsGaretienStageHinzufuegen([huegel]);
gleich(avesmapsGaretienStageHat(huegel.key), true, "das Objekt muss jetzt auf der Stage liegen");

const mStage = garetienEingefuegtWirdMarkup(huegel);
gleich(buchstaben(mStage), "CDE", "auf der Stage C, D und E: " + buchstaben(mStage));
wahr(mStage.includes('data-gi-feld="zielForm"') && mStage.includes('data-gi-feld="zielArt"'),
	"Form und Art stehen in C: " + mStage);
wahr(mStage.includes('class="gi-insert__sub">Fläche<') && mStage.includes("für Klicks gesperrt"),
	"Block D (Flaeche) erscheint auf der Stage");
wahr(mStage.includes('<span class="gi-block__zahl">E</span>Wiki &amp; Quellen') && mStage.includes("Wiki-Landschaft"),
	"Block E (Wiki & Quellen, samt Wiki-Landschaft) erscheint auf der Stage");
wahr(!mStage.includes("Erst auf der Stage einstellbar."), "der Vorschlags-Satz steht auf der Stage nicht mehr");

// =================================================================================================
// C. UEBERNOMMEN (Bestand) -- keiner der drei Bloecke, auch nicht auf der Stage
// =================================================================================================

const huegelUebernommen = Object.assign({}, huegel, {
	key: "ggp:Berge:Huegel:Garetien:Bloecketesthuegel-uebernommen", stand: "uebernommen",
	items: [{ id: 2, change_type: "new", anlass: null, apply_state: "done" }],
});
gleich(garetienEingefuegtWirdMarkup(huegelUebernommen), "", "uebernommen: kein Block C, D oder E");
avesmapsGaretienStageHinzufuegen([huegelUebernommen]);
gleich(garetienEingefuegtWirdMarkup(huegelUebernommen), "", "⚠️ auch wenn es noch auf der Stage liegt");

console.log("OK -- garetien-bloecke (" + checks + " Zusicherungen)");
```

**`js/review/__tests__/garetien-eingefuegt-wird.test.js`** — Ueberschrift C. Ersetze

```js
wahr(mHuegel.includes("Eingefügt wird"), "die Ueberschrift fehlt");
```

durch:

```js
// 🔴 Seit dem 14.09.2026 heisst der Kasten nicht mehr „Eingefügt wird": er ist in die Bloecke C, D und E
// der Einzelansicht zerfallen (Bauplan 2026-09-14, Aufgabe 11).
wahr(mHuegel.includes('<span class="gi-block__zahl">C</span>Ziel &amp; Identität'), "die Ueberschrift von Block C fehlt");
```

**`js/review/__tests__/garetien-eingefuegt-wird.test.js`** — Ueberschrift E Huegel. Ersetze

```js
wahr(mHuegel.includes("Wiki und Quellen"), "die Unterueberschrift fehlt");
```

durch:

```js
wahr(mHuegel.includes('<span class="gi-block__zahl">E</span>Wiki &amp; Quellen'), "die Ueberschrift von Block E fehlt");
```

**`js/review/__tests__/garetien-eingefuegt-wird.test.js`** — Ueberschrift E Weg. Ersetze

```js
wahr(mWeg.includes("Wiki und Quellen") && mWeg.includes("Die Quelle, die mitreist"),
```

durch:

```js
wahr(mWeg.includes('<span class="gi-block__zahl">E</span>Wiki &amp; Quellen') && mWeg.includes("Die Quelle, die mitreist"),
```

**`js/review/__tests__/garetien-eingefuegt-wird.test.js`** — Ort uebernommen. Ersetze ab der Zeile

```js
// ---- Punkt 6a: ein UEBERNOMMENER Ort ist angelegt
```

bis ausschließlich

```js
// Keine "Vorgabe der Art"-Behauptung
```

durch:

```js
// ---- Punkt 6a (Stand 14.09.2026): ein UEBERNOMMENER Ort traegt KEINEN Einstellblock mehr (Bestand,
// Owner: an einem uebernommenen Objekt fehlen die Bloecke C bis E). Bis dahin standen hier sechs
// gesperrte Bedienelemente; wo es liegt und ob es zurueckgeht, steht seither in Block A
// (garetien-detailspalte-reihenfolge.test.js, Abschnitt 6).
const ortUebernommen = Object.assign({}, ort, {
	key: "ggp:Sonstiges:Dorf:Garetien:Testdorf-uebernommen", stand: "uebernommen",
});
avesmapsGaretienStageHinzufuegen([ortUebernommen]);
gleich(garetienEingefuegtWirdMarkup(ortUebernommen), "",
	"ein uebernommener Ort traegt keinen Einstellblock, auch auf der Stage");
```

**`js/review/__tests__/garetien-eingefuegt-wird.test.js`** — Weg uebernommen. Ersetze ab der Zeile

```js
// ---- Punkt 6a: ein UEBERNOMMENER Weg ist angelegt
```

bis ausschließlich

```js
// ====
```

durch:

```js
// ---- Punkt 6a (Stand 14.09.2026): ein UEBERNOMMENER Weg traegt KEINEN Einstellblock mehr (Bestand, Owner).
const wegUebernommen = Object.assign({}, weg, {
	key: "ggp:Gewaesser:Fluss:Garetien:Testfluss-uebernommen", stand: "uebernommen",
});
avesmapsGaretienStageHinzufuegen([wegUebernommen]);
gleich(garetienEingefuegtWirdMarkup(wegUebernommen), "",
	"ein uebernommener Weg traegt keinen Einstellblock, auch auf der Stage");
```

**`js/review/__tests__/garetien-eingefuegt-wird.test.js`** — M-Kopf. Ersetze

```js
// M. Ein UEBERNOMMENES Objekt (Fuenf-Punkte-Brief 30.08.2026, Punkt 6) -- ALLE Felder werden reine
//    Anzeige, UND ein Hinweis sagt, ob es sich zuruecknehmen laesst (und wenn nicht, warum).
```

durch:

```js
// M. Ein UEBERNOMMENES Objekt (Fuenf-Punkte-Brief 30.08.2026, Punkt 6; Bestand, Owner 14.09.2026) --
//    keine Bloecke C bis E, und ein Hinweis in Block A sagt, ob es sich zuruecknehmen laesst.
```

**`js/review/__tests__/garetien-eingefuegt-wird.test.js`** — M-Rumpf. Ersetze ab der Zeile

```js
const mHuegelFaehig = garetienEingefuegtWirdMarkup(huegelUebernommenFaehig);
```

bis ausschließlich

```js
pruefeWikiLandschaftVerdrahtung().then(
```

durch:

```js
const mHuegelFaehig = garetienEingefuegtWirdMarkup(huegelUebernommenFaehig);
// Nur Block A der Spalte -- F traegt denselben Ruecknahme-Grund, und eine Probe ueber die ganze Spalte
// waere durch F gruen, auch wenn A den Satz verloere.
const nurA = (spalte) => spalte.slice(0, spalte.indexOf('<span class="gi-block__zahl">F</span>'));

// ---- 6a: SEIT DEM 14.09.2026 KEINE BLOECKE C BIS E MEHR (Bestand, Owner). Bis dahin zeigte der Kasten
// die echten Steuerelemente gesperrt -- sie liessen sich nirgends mehr aendern und sagten nur, was beim
// Einfuegen galt. Geaendert wird ein angelegtes Objekt auf der Karte.
gleich(mHuegelFaehig, "", "ein uebernommenes Objekt traegt keinen Einstellblock, auch auf der Stage: " + mHuegelFaehig);

// ---- DIE DIFFERENZ, ohne die die Zeile darueber Vakuum waere: DASSELBE Objekt, NICHT übernommen und auf
// der Stage, hat seine Felder BEDIENBAR.
const huegelOffen = Object.assign({}, huegel, { key: "ggp:Berge:Huegel:Garetien:Testhuegel-offen" });
avesmapsGaretienStageHinzufuegen([huegelOffen]);
const mHuegelOffen = garetienEingefuegtWirdMarkup(huegelOffen);
gleich(istDeaktiviert(mHuegelOffen, garetienEingabeId(huegelOffen, "isLocked")), false,
	"ohne 'uebernommen' ist dasselbe Häkchen da und bedienbar");
gleich(istDeaktiviert(mHuegelOffen, garetienEingabeId(huegelOffen, "size")), false,
	"ohne 'uebernommen' ist dasselbe Zahlenfeld da und bedienbar");

// ---- 6b: der Hinweis -- seit dem 14.09.2026 in Block A der Einzelansicht („Auf der Karte" ist genau seine
// Frage). Er liest DIESELBE Regel wie der Rücknahme-Knopf in Block F.
const spalteFaehig = mod.garetienDetailMarkup(huegelUebernommenFaehig, null, false);
wahr(nurA(spalteFaehig).includes("Liegt bereits auf der Karte."),
	"der Hinweis in Block A sagt, dass es schon auf der Karte liegt: " + spalteFaehig);
wahr(nurA(spalteFaehig).includes("Kann mit „Zurücknehmen&quot; wieder entfernt werden."),
	"und dass es sich zurücknehmen lässt -- derselbe Knopfname wie in Block F");
gleich(garetienEingefuegtWirdUebernommenHinweis(huegelOffen), "",
	"ohne 'uebernommen' gibt es keinen Hinweis -- er wäre eine Behauptung über etwas, das nicht gilt");

// ---- 6b, DIE GEGENPROBE: NICHT rücknahmefähig -- WORTGLEICH zum Rücknahme-Knopf, nicht neu formuliert.
// Ein 'changed'-Item hat ein bestehendes Objekt verändert, das 'new'-Zusatz-Item wurde nie angewendet.
const huegelUebernommenUnfaehig = Object.assign({}, huegel, {
	key: "ggp:Berge:Huegel:Garetien:Testhuegel-uebernommen-unfaehig",
	stand: "uebernommen",
	items: [
		{ id: 902, change_type: "changed", felder: ["name"], apply_state: "done" },
		{ id: 903, change_type: "new", anlass: "zusatz", apply_state: "offen" },
	],
});
const spalteUnfaehig = mod.garetienDetailMarkup(huegelUebernommenUnfaehig, null, false);
wahr(nurA(spalteUnfaehig).includes("Liegt bereits auf der Karte."),
	"auch hier steht in A, dass es schon auf der Karte liegt");
wahr(nurA(spalteUnfaehig).includes("Verändert ein bestehendes Objekt — nicht rücknehmbar."),
	"und WARUM es sich nicht zurücknehmen lässt -- wortgleich zum Rücknahme-Knopf");
gleich(
	garetienEingefuegtWirdUebernommenHinweis(huegelUebernommenUnfaehig).includes(
		mod.garetienRuecknahmeBauen(huegelUebernommenUnfaehig).grund
	),
	true,
	"der Hinweis liest WIRKLICH garetienRuecknahmeBauen -- zwei Fassungen derselben Auskunft liefen "
		+ "an diesem Fenster schon einmal auseinander"
);
gleich(garetienEingefuegtWirdMarkup(huegelUebernommenUnfaehig), "", "und auch hier kein Einstellblock");
```

**`js/review/__tests__/garetien-einzelansicht.test.js`** — kein Abschnitt. Ersetze

```js
// Kein Abschnitt: die Ueberschrift steht trotzdem da und sagt, dass nichts da ist.
wahr(boese.includes("Was bei uns an derselben Stelle liegt"),
	"die Ueberschrift steht auch dann, wenn nichts getroffen wurde");
```

durch:

```js
// Kein Abschnitt: Block A steht trotzdem da und sagt, dass nichts da ist. Seit dem 14.09.2026 heisst
// seine Ueberschrift „Auf der Karte", die Zahl steht in der Notiz (Bauplan 2026-09-14, Aufgabe 11).
wahr(boese.includes('<span class="gi-block__zahl">A</span>Auf der Karte<span class="gi-block__note">0 Abschnitte</span>'),
	"Block A steht auch dann, wenn nichts getroffen wurde");
wahr(boese.includes("Zu diesem Objekt steht kein Abschnitt von uns im Vorschlag."), "und sagt, dass nichts da ist");
```

**`js/review/__tests__/garetien-einzelansicht.test.js`** — gi-sec-CSS. Ersetze

```js
// Seitenrand liefe unter die Bildlaufleiste. `.gi-sec` darf deshalb keinen negativen Rand tragen.
const secBlock = (css.match(/\.gi-sec\s*\{[^}]*\}/) || [""])[0];
wahr(secBlock !== "", "der .gi-sec-Block fehlt -- die Gegenprobe misst sonst eine leere Zeichenkette");
```

durch:

```js
// Seitenrand liefe unter die Bildlaufleiste. Der Block (`.gi-block`, seit dem 14.09.2026 statt `.gi-sec`)
// darf deshalb keinen negativen Rand tragen.
const secBlock = (css.match(/\.gi-block\s*\{[^}]*\}/) || [""])[0];
wahr(secBlock !== "", "der .gi-block-Block fehlt -- die Gegenprobe misst sonst eine leere Zeichenkette");
```

**`js/review/__tests__/garetien-handlungen.test.js`** — Leiste ist Block F. Ersetze

```js
wahr(/^<div class="gi-acts">/.test(leiste), "die Leiste ist ein .gi-acts");
```

durch:

```js
// 🔴 SEIT DEM 14.09.2026 IST DIE LEISTE BLOCK F „Handlung" (Bauplan 2026-09-14, Aufgabe 11) -- und traegt
// `gi-acts` weiter am Block selbst.
wahr(/^<div class="gi-block gi-acts"><p class="gi-block__kopf gi-acts__titel"><span class="gi-block__zahl">F<\/span>Handlung</.test(leiste),
	"die Leiste ist Block F und traegt weiter .gi-acts: " + leiste.slice(0, 200));
```

**`js/review/__tests__/garetien-handlungen.test.js`** — F in der Spalte. Ersetze

```js
wahr(spalte.indexOf('<div class="gi-acts">') > spalte.indexOf('<div class="gi-detail">'),
	'💣 und INNERHALB der rollenden Ansicht -- sonst klebt sie wieder am Fuss');
// ⚠️ Das Kleben haengt am Selektor `.gi-win .avm-col > .gi-acts` (DIREKTES Kind der Spalte). Als
// Kind von `.gi-detail` greift er nicht mehr; wer die Leiste je zurueckschoebe, holte es zurueck.
wahr(!/<\/div><div class="gi-acts">/.test(spalte),
	'und NICHT mehr als Geschwister hinter dem schliessenden div');
```

durch:

```js
// 🔴 SEIT DEM 14.09.2026 IST SIE BLOCK F. Gemessen wird die TIEFE, nicht ein Nachbarzeichen: hinter dem
// `</div>` des vorigen Blocks steht sie jetzt immer, und ein Muster wie `</div><div class="gi-…">` traefe
// das zu Recht.
const stelleF = spalte.indexOf('<div class="gi-block gi-acts">');
const davorF = spalte.slice(0, stelleF);
wahr(stelleF > spalte.indexOf('<div class="gi-detail">'),
	'💣 und INNERHALB der rollenden Ansicht -- sonst klebt sie wieder am Fuss');
gleich((davorF.match(/<div\b/g) || []).length - (davorF.match(/<\/div>/g) || []).length, 1,
	'und als direktes Kind von .gi-detail, nicht als Geschwister dahinter');
```

**`js/review/__tests__/garetien-handlungen.test.js`** — Absatzregel. Ersetze

```js
wahr(/\.gi-detail\s*>\s*\.gi-acts\s*\{[^}]*border-top/.test(acts),
	'die Handlungsleiste rollt mit und ist durch eine Trennlinie abgesetzt');
```

durch:

```js
// 🔴 SEIT DEM 14.09.2026 SETZT DER BLOCK SIE AB (`.gi-block`), nicht mehr eine eigene Regel:
// `.gi-detail > .gi-acts` (0,2,0) schlug `.gi-block` (0,1,0) und gab F andere Abstaende als A bis E.
// ⚠️ Gesucht wird in der GANZEN Datei: der Block-Abschnitt steht VOR diesem (er traegt Pixelmasse, die
// der Mockup-Vertrag bindet, und fiele sonst unter die px-Probe darueber).
wahr(/\.gi-block\s*\{[^}]*border-top/.test(css) && !/\.gi-detail\s*>\s*\.gi-acts\s*\{/.test(css),
	'die Handlungsleiste ist Block F und durch dessen Trennlinie abgesetzt -- die eigene Regel ist weg');
```

**`js/review/__tests__/garetien-vorwaertsknopf.test.js`** — Ueberschrift F. Ersetze ab der Zeile

```js
// ⚠️ Im Markup steht „Dieses Objekt" in Satzschreibung
```

bis ausschließlich

```js
// =
```

durch:

```js
// ⚠️ Im Markup steht „Handlung" in Satzschreibung -- die Versalien macht `.gi-block__kopf`
//    (text-transform: uppercase), wie bei den uebrigen sechs Bloecken. Bis zum 14.09.2026 hiess die
//    Ueberschrift „Dieses Objekt" (Bauplan 2026-09-14, Aufgabe 11).
const markup = garetienHandlungsMarkup(offenMitVorschlag);
wahr(markup.includes('<span class="gi-block__zahl">F</span>Handlung</p>'), "die Ueberschrift steht ueber der Leiste");
wahr(markup.indexOf("Handlung</p>") < markup.indexOf("data-handlung"),
	"…und zwar VOR dem ersten Knopf");
wahr(markup.includes('class="gi-block__kopf gi-acts__titel"'),
	"in derselben Form wie jeder andere Blockkopf");
```

**`js/review/__tests__/garetien-naehe-markieren.test.js`** — F-Klasse. Ersetze

```js
const posActs = ganzesMarkup.indexOf('class="gi-acts"');
```

durch:

```js
const posActs = ganzesMarkup.indexOf('class="gi-block gi-acts"');
```

**`js/review/__tests__/garetien-name-aendern.test.js`** — Namensfeld in C. Ersetze

```js
// 🔴 Seit dem 14.09.2026 steht das Namensfeld unter der Zielwahl in der Handlungsleiste.
pruefe(!api.garetienHandlungsMarkup(o).includes('data-gi-feld="einfuegeName"'), "vor der Stage kein Namensfeld");
api.avesmapsGaretienStageHinzufuegen([o]);
let mk = api.garetienHandlungsMarkup(o);
```

durch:

```js
// 🔴 Seit dem 14.09.2026 steht das Namensfeld unter der Zielwahl in Block C „Ziel & Identität"
// (garetienIdentitaetMarkup, Aufgabe 11) -- zwischen Aufgabe 9 und 11 stand es in der Handlungsleiste.
pruefe(!api.garetienIdentitaetMarkup(o).includes('data-gi-feld="einfuegeName"'), "vor der Stage kein Namensfeld");
api.avesmapsGaretienStageHinzufuegen([o]);
let mk = api.garetienIdentitaetMarkup(o);
pruefe(!api.garetienHandlungsMarkup(o).includes('data-gi-feld="einfuegeName"'),
	"…und die Handlungsleiste traegt es nicht mehr -- zwei Felder truegen dieselbe id");
```

**`js/review/__tests__/garetien-zielwahl-ziele.test.js`** — Zielwahl in Block C. Ersetze

```js
	wahr(leiste.indexOf('class="gi-ziel"') !== -1 && leiste.indexOf('class="gi-ziel"') < leiste.indexOf("gi-acts__knoepfe"),
		"die Zielwahl steht über der Knopfzeile");
```

durch:

```js
	// 🔴 SEIT AUFGABE 11 (14.09.2026) STEHEN ZIELWAHL UND NAME IN BLOCK C „Ziel & Identität", nicht mehr über
	// der Knopfzeile: sie beantworten, was entsteht, nicht, was jetzt passiert.
	const blockC = api.garetienIdentitaetMarkup(b);
	wahr(blockC.indexOf('class="gi-ziel"') !== -1 && leiste.indexOf('class="gi-ziel"') === -1,
		"die Zielwahl steht in Block C, nicht in der Leiste: " + leiste);
```

**`js/review/__tests__/garetien-zielwahl-ziele.test.js`** — Name in Block C. Ersetze

```js
	wahr(leiste.includes('gi-insert__row" for="' + nameId + '"'), "bei „Stätte\" ist der Name bedienbar");
```

durch:

```js
	wahr(blockC.includes('gi-insert__row" for="' + nameId + '"') && !leiste.includes(nameId),
		"bei „Stätte\" ist der Name bedienbar -- in Block C, nicht in der Leiste");
```

**`js/review/__tests__/garetien-zielwahl-ziele.test.js`** — Siedlung genau einmal. Ersetze

```js
	gleich(kasten.indexOf('data-gi-feld="innerorts"'), -1,
		"💣 die Siedlung steht NICHT noch einmal im Kasten -- zwei Felder trügen dieselbe id");
```

durch:

```js
	// Seit Aufgabe 11 ist der Kasten die Blöcke C, D und E -- die Zielwahl samt Siedlung steht in C.
	gleich((kasten.match(/data-gi-feld="innerorts"/g) || []).length, 1,
		"💣 die Siedlung steht GENAU EINMAL im Kasten -- zwei Felder trügen dieselbe id");
	gleich((kasten.match(/data-gi-feld="einfuegeName"/g) || []).length, 1, "💣 …und das Namensfeld ebenso");
```

**`js/review/__tests__/garetien-zielwahl-ziele.test.js`** — Bestand ohne Einstellblock. Ersetze

```js
	const kasten = api.garetienEingefuegtWirdMarkup(uebernommen);
	gleich(kasten.indexOf("gi-insert__row--aus"), -1, "⚠️ der Kasten bleibt gesperrt OHNE Abblend-Zeile");
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(kasten), "…aber gesperrt wie vorher");
```

durch:

```js
	// 🔴 Seit Aufgabe 11 (Bestand, Owner 14.09.2026) trägt ein übernommenes Objekt KEINEN Einstellblock:
	// die Blöcke C bis E fehlen, geändert wird es auf der Karte. Der Satz steht in Block A.
	gleich(api.garetienEingefuegtWirdMarkup(uebernommen), "", "⚠️ …und keinen Einstellblock mehr, auch nicht gesperrt");
```

**`js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js`** — Block E. Ersetze

```js
	wahr(mk.includes("Wiki und Quellen"), "…und Block E steht da");
```

durch:

```js
	// Seit Aufgabe 11 (14.09.2026) ist „Wiki und Quellen" der Block E „Wiki & Quellen".
	wahr(mk.includes('<span class="gi-block__zahl">E</span>Wiki &amp; Quellen'), "…und Block E steht da");
```

**`js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js`** — Bestand uebernommen. Ersetze

```js
	const mk = api.garetienEingefuegtWirdMarkup(uebernommen);
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(mk), "🔴 übernommen: Form gesperrt wie vorher: " + mk);
	wahr(mk.includes("Darstellung sowie Wiki"), "…mit dem Hinweis von vorher");
	gleich(mk.indexOf("Erst auf der Stage einstellbar."), -1, "…und NICHT als Vorschlag");
	wahr(mk.includes("Liegt bereits auf der Karte"), "…und mit seinem Satz");
```

durch:

```js
	// 🔴 SEIT AUFGABE 11 (14.09.2026, Bestand, Owner): KEIN Einstellblock mehr -- die Blöcke C bis E fehlen,
	// der Satz, wo es liegt und ob es zurückgeht, steht in Block A.
	const mk = api.garetienEingefuegtWirdMarkup(uebernommen);
	gleich(mk, "", "🔴 übernommen: kein Einstellblock, auch nicht gesperrt: " + mk);
	const spalteUeb = api.garetienDetailMarkup(uebernommen, null, false);
	gleich(spalteUeb.indexOf("Erst auf der Stage einstellbar."), -1, "…und NICHT als Vorschlag");
	wahr(spalteUeb.includes("Liegt bereits auf der Karte"), "…und mit seinem Satz, in Block A");
```

**`js/review/__tests__/garetien-verbund-klick.test.js`** — Block B in der Spalte (Stand nach Aufgabe 7). Ersetze

```js
		wahr(spalte.indexOf('<p class="gi-sec">Verbund') > -1,
			"der Verbund-Block steht in der echten Detailspalte: " + spalte.slice(0, 400));
		wahr(spalte.indexOf('data-handlung="verbund"') > -1, "und der Knopf „Zusammenlegen“ darin");
		const iVerbund = spalte.indexOf('<p class="gi-sec">Verbund');
		const iWasBeiUns = spalte.indexOf("Was bei uns an derselben Stelle liegt");
		wahr(iVerbund > -1 && iWasBeiUns > -1 && iVerbund < iWasBeiUns,
			"der Verbund-Block steht VOR „Was bei uns an derselben Stelle liegt“");
```

durch:

```js
		wahr(spalte.indexOf('<span class="gi-block__zahl">B</span>Verbund') > -1,
			"der Verbund-Block steht in der echten Detailspalte: " + spalte.slice(0, 400));
		wahr(spalte.indexOf('data-handlung="verbund"') > -1, "und der Knopf „Zusammenlegen“ darin");
		// 🔴 SEIT DEM 14.09.2026 steht der Verbund als Block B HINTER Block A „Auf der Karte"
		// (Bauplan 2026-09-14, Aufgabe 11): erst, was da liegt, dann, woraus es besteht.
		const iVerbund = spalte.indexOf('<span class="gi-block__zahl">B</span>Verbund');
		const iAufDerKarte = spalte.indexOf('<span class="gi-block__zahl">A</span>Auf der Karte');
		wahr(iVerbund > -1 && iAufDerKarte > -1 && iAufDerKarte < iVerbund,
			"der Verbund-Block steht HINTER Block A");
```

**`js/review/__tests__/garetien-verbund-klick.test.js`** — ohne Verbund kein B (Stand nach Aufgabe 7). Ersetze

```js
		wahr(spalte.indexOf('<p class="gi-sec">Verbund') === -1, "ohne Verbund erscheint kein Verbund-Block");
```

durch:

```js
		wahr(spalte.indexOf('<span class="gi-block__zahl">B</span>') === -1, "ohne Verbund erscheint kein Verbund-Block");
```


```bash
node js/review/__tests__/garetien-detailspalte-reihenfolge.test.js
for t in garetien-bloecke garetien-eingefuegt-wird garetien-einzelansicht garetien-handlungen garetien-vorwaertsknopf garetien-verbund-klick garetien-verbund-detail garetien-verbund-zeile-nicht-klickbar garetien-verbund-fragment-weg garetien-naehe-markieren garetien-name-aendern garetien-zielwahl garetien-zielwahl-ziele garetien-offen-ohne-einstellfelder garetien-wiki-suche garetien-karte; do node js/review/__tests__/$t.test.js 2>&1 | tail -1; done
node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```

Erwartet: `OK -- garetien-detailspalte-reihenfolge (77 Zusicherungen)`, `OK -- garetien-bloecke (17 Zusicherungen)`, `OK -- garetien-zielwahl-ziele: 144 Zusicherungen`, `OK -- garetien-offen-ohne-einstellfelder: 32 Zusicherungen`, `OK -- 16 Zusicherungen` (name-aendern), alle übrigen OK; der Vertragstest meldet einen Vertrag mehr als vor dem Commit; im Feld kein `ROT:` (in einer CRLF-Arbeitskopie vorbestehend `quellen-abdeckung-ziel.test.js`). Die Dateizahl gegen das Muster aus `.github/workflows/deploy-avesmaps-strato.yml` zählen.

Probelauf (Wegwerf-Worktree auf `garetien-fragmente-verbund` @ `9fccacfbc`, die Aufgaben 9 und 10 aus `plan-teil-ziel.md` eingespielt — samt deren Wegwerf-Stubs für Aufgabe 6 —; die Aufgaben 1 bis 8 sonst nicht gebaut): vorher **544 Dateien, 0 rot**; Schritt 2 rot wie angegeben; danach 77 Zusicherungen grün, Feld **544 Dateien, 0 rot**; Vertragstest **12 → 13** Verträge. Mutationsproben mit Byte-Gegenprobe, **12 von 12 gefangen**: G außerhalb von `.gi-detail` · `.gi-detail > .gi-acts` zurück · Übernommen-Satz nicht in A · Übernommen bekommt C bis E · Abblenden färbt nicht · D ohne `gi-insert` · D blendet nie ab · Zielwahl und Name bleiben zusätzlich in F · Name fehlt in C · Zielwahl zweimal in C · `.gi-acts { margin-top: 0 }` überstimmt F · Übergangsregel `.gi-acts > .gi-ziel` bleibt; dazu `.gi-block__zahl { width: 16px }` → Vertragstest rot mit „Mockup 18px -- Produktion 16px". LF-Spiegel (wie `actions/checkout`): alle berührten Garetien-Tests grün. Block B in der Rückgabeform nach Aufgabe 7 (3d) lief im ersten Probelauf (mit Attrappen) grün — auf dem Stand nach 9 und 10 nicht erneut gefahren.

- [ ] **Schritt 5: Im Browser messen**

Vor dem Commit, im eigenen Wegwerf-Worktree — der Importer braucht auf der Live-Seite eine Editor-Sitzung. Zwei Hilfsskripte in den eigenen Scratchpad, **nicht** ins Repo.

`messseite.js` baut eine Seite aus dem echten Markup (`garetienDetailMarkup`, `garetienListeSkelettMarkup`, `garetienZeileMarkup`) und dem echten CSS (`css/styles.css` samt @import-Kette) und misst sich selbst:

```js
"use strict";
// Baut eine Messseite aus dem ECHTEN Markup (garetienDetailMarkup, garetienListeSkelettMarkup,
// garetienZeileMarkup) und dem ECHTEN CSS (css/styles.css samt @import-Kette). Keine Nachbildung.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const W = path.resolve(process.argv[2]);

global.document = { documentElement: {}, getElementById() { return null; }, addEventListener() {}, querySelectorAll() { return []; } };
global.window = { location: { search: "", hostname: "", protocol: "http:" } };
["js/map-features/ecosystem-display.js", "js/map-features/location-zoom-bands.js"].forEach(function (f) {
	vm.runInThisContext(fs.readFileSync(path.join(W, f), "utf8"), { filename: f });
});
global.avesmapsLabelArtName = require(path.join(W, "js/ui/label-arten.js")).avesmapsLabelArtName;
const { ladeImporter } = require(path.join(W, "js/review/__tests__/helfer/garetien-testumgebung.js"));
const { api } = ladeImporter();

const QUELLE = { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de", license: "cc-by-nc-sa-3.0", source_type: "briefspiel" };
function flaeche(name, extra) {
	return Object.assign({ key: "ggp:Waelder:Wald:Garetien:" + name + "!" + name, name: name, typ: "Wald", ebene: "Waelder",
		stand: "offen", urteil: "neu", wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
		grund: "0,9 Meilen von „Silkwald“ · anderer Name", geometrie: [[1, 1], [2, 1], [2, 2]], quelle: QUELLE,
		abschnitte: [], items: [{ id: name.length, change_type: "new", anlass: "" }] }, extra || {});
}
const f1 = flaeche("Silker Hain 1", { verbund_stamm: "Silker Hain", verbund_n: 2 });
const f2 = flaeche("Silker Hain 2", { verbund_stamm: "Silker Hain", verbund_n: 2 });
const heide = flaeche("Silker Heide");
const alt = flaeche("Dunkelforst", { stand: "uebernommen", items: [{ id: 901, change_type: "new", anlass: null, apply_state: "done" }] });
// Ein Bauwerk mit Siedlungen im Umkreis, als „Stätte" gewählt: C trägt Zielwahl, Siedlung, Umkreis und Name,
// D steht grau und gesperrt.
const burg = { key: "ggp:Bauwerke:Burg:Garetien:Burg Finster!Burg Finster", name: "Burg Finster", typ: "Burg", ebene: "Bauwerke",
	stand: "offen", urteil: "neu", wiki: "ggp", ziel: "location", subtyp: "gebaeude", kind: "",
	grund: "keine Siedlung dieses Namens", geometrie: [[3, 3]], quelle: QUELLE, abschnitte: [],
	innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8,
		kandidaten: [{ public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8, nennt_name: false },
			{ public_id: "dorf-rallerfurt", name: "Rallerfurt", meilen: 2.1, nennt_name: false }] },
	items: [{ id: 21, change_type: "new", anlass: "" }] };

(async function () {
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: [f1, f2, heide, alt, burg], plan_run_id: 7 }) });
	};
	await api.avesmapsGaretienListeHolen();
	api.avesmapsGaretienStageHinzufuegen([f1, f2, burg]);
	api.garetienZielwahlSetzen(burg, "staette");

	function liste(objekte, marken, text, zahl) {
		const zeilen = objekte.map(function (o, i) { return api.garetienZeileMarkup(o, i === 0, marken[i] || ""); }).join("");
		return api.garetienListeSkelettMarkup()
			.replace('<div class="avm-scroll gi-list" id="garetien-list"></div>', '<div class="avm-scroll gi-list">' + zeilen + "</div>")
			.replace(' id="garetien-alle" disabled>', ' id="garetien-alle">')
			.replace('<span id="garetien-alle-text">alle 0</span>', "<span>" + text + "</span>")
			.replace('<span class="gi-listkopf__zahl" id="garetien-alle-zahl"></span>', '<span class="gi-listkopf__zahl">' + zahl + "</span>")
			.replace(/ id="[^"]*"/g, "");
	}
	function fenster(fall, links, rechts) {
		return '<div class="gi-win avm-fenster avm-fenster--werkzeug" data-fall="' + fall + '" style="position:relative;inset:auto;'
			+ 'transform:none;margin:0 0 24px;width:1000px;height:760px;max-height:none">'
			+ '<div class="avm-fenster__kopf"><span class="avm-fenster__griff">⁝⁝</span><h2 class="avm-fenster__titel">Garetien Importer — '
			+ fall + "</h2></div>"
			+ '<div class="avm-cols avm-cols--2" style="flex:1 1 auto;min-height:0"><div class="avm-col">' + links + '</div><div class="avm-col">'
			+ rechts + "</div></div>"
			+ '<div class="gi-foot avm-fenster__fuss"><button class="btn" type="button">Stage leeren</button></div></div>';
	}
	const stageMarken = [api.garetienStageZeile2(f1, true), api.garetienStageZeile2(f2, true)];
	const seiten = [
		fenster("offen", liste([heide, f1, f2], ["", "auf der Stage", "auf der Stage"], "alle 3", "3 von 8237"),
			api.garetienDetailMarkup(heide, null, false)),
		fenster("stage", liste([f1, f2], stageMarken, "alle 2", "2 auf der Stage · 2 Objekte"),
			api.garetienDetailMarkup(f1, null, false)),
		fenster("uebernommen", liste([alt], [""], "alle 1", "1 von 92"),
			api.garetienDetailMarkup(alt, null, false)),
		fenster("staette", liste([burg], [api.garetienStageZeile2(burg, true)], "alle 1", "3 auf der Stage · 3 Objekte"),
			api.garetienDetailMarkup(burg, null, false)),
	].join("");
	const html = '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Messseite Bloecke</title>'
		+ '<link rel="stylesheet" href="css/components/region-sync.css"><link rel="stylesheet" href="css/styles.css">'
		+ "<style>body{margin:20px;background:var(--color-page-bg)} #messung{font:12px/1.35 Consolas,monospace;white-space:pre-wrap;"
		+ "background:#fff;color:#000;border:1px solid #999;padding:8px;margin:0 0 16px;width:1000px}</style></head><body>"
		+ '<pre id="messung">misst …</pre>' + seiten
		+ "<script>window.addEventListener('load',function(){setTimeout(function(){"
		+ "var r=function(x){return Math.round(x*100)/100};"
		+ "var aus=[].map.call(document.querySelectorAll('.gi-win'),function(win){"
		+ "var d=win.querySelector('.gi-detail');var dr=d.getBoundingClientRect();"
		+ "var k=[].slice.call(d.querySelectorAll('.gi-block__kopf'));"
		+ "var b=[].slice.call(d.querySelectorAll(':scope > .gi-block'));"
		+ "var lk=win.querySelector('.gi-listkopf input[type=checkbox]');var zh=win.querySelector('.avm-row > input[type=checkbox]');"
		+ "return win.dataset.fall+': '+k.map(function(x){return x.querySelector('.gi-block__zahl').textContent}).join('')"
		+ "+' | kopfLinks='+k.map(function(x){return r(x.getBoundingClientRect().left-dr.left)}).join(',')"
		+ "+' | zahl='+k.map(function(x){var z=x.querySelector('.gi-block__zahl').getBoundingClientRect();return r(z.width)+'x'+r(z.height)}).join(',')"
		+ "+' | polster='+getComputedStyle(d).paddingLeft+' rinne='+r((d.offsetWidth-d.clientWidth)/2)"
		+ "+' | aussen(margin/padding/border)='+b.map(function(x){var s=getComputedStyle(x);return s.marginTop+'/'+s.paddingTop+'/'+s.borderTopWidth}).join(',')"
		+ "+' | zahlSchrift='+(k[0]?getComputedStyle(k[0].querySelector('.gi-block__zahl')).fontSize:'-')"
		+ "+' | kopfStil='+(function(){var s=k.map(function(x){var c=getComputedStyle(x);return c.fontSize+'/'+c.letterSpacing+'/'+c.textTransform+'/'+c.fontWeight+'/'+c.marginBottom+'/'+c.color});"
		+ "return s.every(function(v){return v===s[0]})?'einheitlich '+s[0]:'VERSCHIEDEN '+s.join(' ; ')})()"
		+ "+' | doppelteIds='+(function(){var ids={};var d2=[];[].forEach.call(d.querySelectorAll('[id]'),function(e){if(ids[e.id]){d2.push(e.id)}ids[e.id]=1});return d2.length?d2.join(','):'keine'})()"
		+ "+' | listkopfHaken='+(lk?r(lk.getBoundingClientRect().left)+' '+r(lk.getBoundingClientRect().width)+'x'+r(lk.getBoundingClientRect().height):'-')"
		+ "+' zeilenHaken='+(zh?r(zh.getBoundingClientRect().left)+' '+r(zh.getBoundingClientRect().width)+'x'+r(zh.getBoundingClientRect().height):'-')"
		+ "+' fensterBreite='+r(win.getBoundingClientRect().width)});"
		+ "document.getElementById('messung').textContent=aus.join('\\n');},300)});</script>"
		+ "</body></html>";
	fs.writeFileSync(path.join(W, "messung-bloecke.html"), html);
	console.log("geschrieben: " + path.join(W, "messung-bloecke.html"));
})().catch(function (e) { console.error(e); process.exit(1); });
```

`statisch.js` ist ein Wegwerf-Server nur für diese Seite — eine lokale Datei lässt im Browser-Werkzeug keine Seitenskripte zu:

```js
"use strict";
// Wegwerf-Server NUR fuer die Messseite: liefert Dateien aus einem Verzeichnis, sonst nichts.
const http = require("http");
const fs = require("fs");
const path = require("path");
const WURZEL = path.resolve(process.argv[2]);
const PORT = Number(process.argv[3] || 8765);
const TYPEN = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
	".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };
http.createServer(function (anfrage, antwort) {
	const teil = decodeURIComponent(String(anfrage.url || "/").split("?")[0]);
	const datei = path.resolve(WURZEL, "." + teil);
	if (!datei.startsWith(WURZEL)) { antwort.writeHead(403); antwort.end(); return; }
	fs.readFile(datei, function (fehler, inhalt) {
		if (fehler) { antwort.writeHead(404); antwort.end(); return; }
		antwort.writeHead(200, { "Content-Type": TYPEN[path.extname(datei)] || "application/octet-stream" });
		antwort.end(inhalt);
	});
}).listen(PORT, "127.0.0.1", function () { console.log("bereit auf " + PORT); });
```

```bash
node <scratchpad>/messseite.js <wegwerf-worktree>
node <scratchpad>/statisch.js <wegwerf-worktree> 8765     # Bash im Hintergrund
```

Dann im Browser-Werkzeug `http://127.0.0.1:8765/messung-bloecke.html` öffnen und `document.getElementById('messung').textContent` lesen. Die Seite rechnet je Fenster: die Buchstabenfolge, `kopfLinks` (linke Kante jedes `.gi-block__kopf` minus linke Kante von `.gi-detail`), Kreisgröße, Polster, Rinne (`(offsetWidth − clientWidth) / 2`), `margin-top/padding-top/border-top` jedes Blocks, das Schriftbild jedes Kopfes (`kopfStil`: Größe, Sperrung, Versalien, Gewicht, Abstand nach unten, Farbe) und doppelte ids in `.gi-detail`. Das vierte Fenster zeigt ein Bauwerk mit zwei Siedlungen im Umkreis, als „Stätte" gewählt — Zielwahl, Siedlung, Umkreis und Name stehen in C.

Erwartet — so gemessen am 14.09.2026 im Browser-Werkzeug (Gerätepixel 1,5):

- `offen: ACFG` · `stage: ABCDEFG` · `uebernommen: AF` · `staette: ACDEFG`
- `kopfLinks` je Fenster **alle gleich**: `24` = Polster 14 + Rinne 10. Bei klassischer Bildlaufleiste ohne Skalierung 29 (14 + 15). **Die Gleichheit ist die Zusicherung, nicht die Zahl.**
- Kreis `18x18`, Schrift `11px`
- jeder Block außer A `12px/8px/<ein Gerätepixel>` — **F eingeschlossen**; mit der alten `.gi-detail > .gi-acts` stünde dort `8px/8px`.
- `kopfStil=einheitlich 11px/0.66px/uppercase/700/6px/rgb(122, 90, 58)` in jedem Fenster, F (`gi-acts__titel`) eingeschlossen — `VERSCHIEDEN …` hieße, eine spätere Regel überstimmt einen Kopf
- `doppelteIds=keine` in jedem Fenster, auch in „staette"

Danach `document.documentElement.setAttribute('data-theme','dark')` und ansehen: Kreis und Kopf in `--color-accent-brown`, Trennlinien zwischen den Blöcken, kein Rahmen um einen Block. Server beenden (TaskStop), Seite löschen.

Nach dem Deploy, in der Sitzung des Owners, dieselbe Frage am echten Fenster (Konsole oder `javascript_tool`):

```js
(() => { const d = document.querySelector("#garetien-detailcol .gi-detail"); const l = d.getBoundingClientRect().left;
  return [...d.querySelectorAll(":scope > .gi-block > .gi-block__kopf")]
    .map((k) => k.textContent.slice(0, 1) + " " + Math.round((k.getBoundingClientRect().left - l) * 100) / 100); })()
```

Erwartet: je Block ein Eintrag, alle mit derselben Zahl.

- [ ] **Schritt 6: Committen**

```bash
git status
git add js/review/review-garetien-importer.js
git add css/components/garetien-importer.css
git add docs/garetien-import-vereint-mockup.html
git add js/review/__tests__/garetien-detailspalte-reihenfolge.test.js
git add js/review/__tests__/garetien-bloecke.test.js
git add js/review/__tests__/garetien-eingefuegt-wird.test.js
git add js/review/__tests__/garetien-einzelansicht.test.js
git add js/review/__tests__/garetien-handlungen.test.js
git add js/review/__tests__/garetien-vorwaertsknopf.test.js
git add js/review/__tests__/garetien-verbund-klick.test.js
git add js/review/__tests__/garetien-naehe-markieren.test.js
git add js/review/__tests__/garetien-name-aendern.test.js
git add js/review/__tests__/garetien-zielwahl-ziele.test.js
git add js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js
git commit -F- <<'EOF'
ui(garetien-importer): die Einzelansicht gliedert sich in sieben Bloecke A bis G -- Auf der Karte, Verbund, Ziel & Identitaet, Darstellung, Wiki & Quellen, Handlung, Weiter importieren

Umbau der rechten Spalte, kein Neubau: jeder Abschnitt wandert in genau einen
Block. Der Kasten "Eingefuegt wird" zerfaellt in C (Ziel, Name, Form, Art),
D (Darstellung) und E (Wiki & Quellen); "Dieses Objekt" wird F "Handlung";
"Imports in der Naehe waehlen" wird G und steht jetzt IN der rollenden Ansicht.
D und E gibt es nur auf der Stage. Was das gewaehlte Ziel nicht braucht, steht
grau und gesperrt da, statt zu verschwinden.

Ein uebernommenes Objekt zeigt nur noch A und F -- der Satz, wo es liegt und ob
es zurueckgeht, steht in A.

Zielwahl und Namensfeld ziehen aus der Handlungsleiste in C und stehen dort
genau einmal; F traegt nur noch die Knoepfe.

Die Buchstaben fluchten: alle Bloecke sind direkte Kinder von .gi-detail.
.gi-detail > .gi-acts (0,2,0) ueberstimmte .gi-block und faellt,
.gi-win .avm-col > .gi-naehe, .gi-sec, .gi-acts .gi-insert__row und die
Uebergangsregel .gi-acts > .gi-ziel fallen als tote Regeln.
Das Mockup bindet die Bloecke per Vertragsmarke.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git log -1 --format=%B
```

🔧 **DU:** Im Importer vier Objekte ansehen, hell und dunkel: eines auf „Offen" (Blöcke A C F G, in C kein Feld, nur „Erst auf der Stage einstellbar."), dasselbe auf der Stage (sieben Blöcke, die Buchstaben in einer senkrechten Flucht; Zielwahl und Namensfeld stehen in C, F trägt nur Knöpfe; Ziel auf „Nichts — nur ansehen" stellen → Name, Form, Art und Darstellung werden grau und bleiben stehen), ein Bauwerk mit Siedlung im Umkreis auf der Stage („Stätte in …" wählen → die Siedlung wird bedienbar, der Name bleibt, die Form sagt „gilt nicht für eine Stätte", D steht grau) und eines auf „Übernommen" (nur A und F; in A „Liegt bereits auf der Karte …").

---

## Aufgabe 12: Liste und Leisten — „alle n" im Listenkopf, das Ziel in der Zeile

**Deckt Entwurf §7 ab** (dazu §9 „Kein Knopf steht in zwei Leisten; „alle n" ist ein Häkchen im Listenkopf", „Die Zeile sagt, ob das Objekt auf der Stage liegt", „Die Zeile trägt ihr Ziel"; Mockup §2 bis §4 und §7). Sichtbar — einzeln live, mit Blick des Owners.

**Umbau, nicht Neubau** (Fundstellen am Zweig `df8d9ec4c`):

| heute | wird |
|---|---|
| Knopf `#garetien-mark-all` „Alle wählen (n)" in der Fußleiste (`index.html:4269`), verdrahtet in `bindFenster` (:9487–9497), beschriftet von `garetienAlleWaehlenKnopfSetzen` (:667) aus `garetienAlleWaehlenZustand` (:652) | Häkchen `#garetien-alle` „alle n" im neuen Listenkopf `.gi-listkopf` des Skeletts, unmittelbar über `#garetien-list` (:1724), verdrahtet mit dem Skelett (`garetienListeSkelettVerdrahten` :1783). **Dieselbe** Wahl `avesmapsGaretienAlleWaehlen(zustand.objekte)`; dazu das Lösen `avesmapsGaretienAlleAbwaehlen` |
| die Zahl „(n)" im Knopf | „alle n" am Häkchen, rechts die Zahl: „n von m" bzw. auf der Stage „n auf der Stage · k Objekte" |
| zweite Zeile `.avm-row__l2` = Urteil · Grund (`garetienZeileMarkup` :1566) | davor die Ziel-Marke `.gi-ziel-marke`: auf „Stage" `garetienStageZeile2(objekt, true)` (bis hierher ohne Aufrufer), auf „Offen" „auf der Stage" |
| Fußleiste: Alle wählen · Stage leeren · Alle zentrieren · Stage importieren | Stage leeren · Alle zentrieren · Stage importieren |

**Je Reiter.** Der Listenkopf steht auf allen vier Reitern, und „alle n" wählt auf jedem, was „Alle wählen" dort gewählt hat: die gerenderten `zustand.objekte` — auf „Übernommen" also auch die Mitglieder einer gefalteten Zeile. Die Ziel-Marke gibt es nur auf „Stage" und „Offen".

**Bestand.** Keine Datenfrage — die Auswahl ist Client-Zustand. Der Test fährt „Übernommen" (zwei Objekte) und „Abgelehnt" (eines) eines Laufs ohne Verbund-Felder über die echte Tür und hält die gewählte Menge gegen `avesmapsGaretienAlleWaehlen`.

💣 **Ein Zeilenhaken muss den Listenkopf mitnehmen.** Die Auswahl ändert sich an den Zustandsänderern, die `garetienAuswahlleisteAuffrischen` (:483) rufen — dort hängt der Listenkopf mit dran. Ohne das stünde „alle n" nach einem einzelnen Haken auf dem alten Stand. `garetien-auswahlleiste-folgt.test.js:78` zählt diese Aufrufe (heute 5); `avesmapsGaretienAlleAbwaehlen` ist der sechste.

💣 **Genau ein `change`-Zuhörer.** Das Skelett wird einmal gebaut (`garetienListeSkelettSicherstellen`, `dataset.giSkelett`), deshalb gehört der Zuhörer dorthin und nicht in `bindFenster`. Ein zweiter Zuhörer nähme im selben Klick zurück, was der erste tat — die Doppelanmeldung aus AGENTS.md §11. Der Test zählt `_hoerer.change`.

💣 **Lösen löst nur die Zeilen dieser Liste**, nie die ganze Auswahl — `avesmapsGaretienAuswahlAufheben` wäre falsch: was ein Filter gerade ausblendet, bleibt gewählt (Owner 08.09.2026, `avesmapsGaretienAuswahlAufDieStage` :606).

💣 **`indeterminate` ist eine Eigenschaft, kein Attribut** (dieselbe Falle wie `data-part` an den Zeilen) — `garetienAlleWaehlenKnopfSetzen` setzt sie bei jedem Aufruf.

⚠️ **`change`, nicht `click`:** auch die Leertaste schaltet, und `checked` ist dann schon gesetzt. Die Richtung darf hier aus `checked` kommen — anders als bei den Item-Haken (`garetienPlanAusItems`), denn die Auswahl hat keinen Serverstand.

💣 **Das Mockup legt die Zeilen direkt in die Spalte, die Produktion in `.avm-scroll`** (editor-body.css:156: 1 px Rahmen, `--space-2` Polster; dazu 1 px Rahmen je Zeile, editor-row.css). Mit den Vertragswerten allein saß das Häkchen „alle n" gemessen **9,33 px** links der Zeilenhäkchen. Ausgeglichen wird in einer freien Regel neben dem Vertragsblock (Außenabstand `--space-2`, 2 px durchsichtiger Rahmen) — der Vertrag ist eine Untergrenze, sein Polster bleibt unberührt. Gegengemessen: 50,67 gegen 50, ein Gerätepixel.

⚠️ **Spezifität:** `.gi-listkopf label` (0,1,1) trifft im Fenster auf keine andere Label-Regel (gesucht in editor-body.css, fenster.css, css/base); `.gi-win .avm-row > input[type="checkbox"]` (:317) trifft das Listenkopf-Häkchen nicht — deshalb die eigene Regel mit denselben Maßen. Die freie `.gi-listkopf`-Regel nennt nur Eigenschaften, die der Vertragsblock nicht nennt.

💣 **Auch dieser Block steht VOR „Aufgabe 15: die Handlungsleiste"** — 14 px am Häkchen, `garetien-handlungen.test.js:722`.

🔴 **Mit dieser Aufgabe ist die letzte Regel des Mockup-Abschnitts „NEU" gebaut** (Koordinator 14.09.2026). Sein Kopf (:397–405) sagt bis hierher „alles darunter gibt es im Produktivcode NOCH NICHT" und zählt die Klassen auf; die Übersicht §8 („Was gebaut werden muss") führt sie als „NEU". Beides zieht dieser Commit nach (3m). 💣 Der neue Kopf nennt das Großwort nicht mit Doppelpunkt und die Endmarke nicht im Fließtext — `tools/mockup-vertrag` läse beides als Marke; der Vertragstest in Schritt 4 fährt das.

⚠️ **Der Name `garetienAlleWaehlenKnopfSetzen` bleibt**, obwohl dort kein Knopf mehr steht: drei Aufrufer, und ein zweiter Name für dieselbe Stelle wäre die Doppelung.

⚠️ **`#garetien-mark-all` kennen außer `index.html` und dem Modul nur drei Tests** (`git grep`, am Zweig): `garetien-auswahlleiste.test.js:14`, `garetien-vokabular.test.js:332`, `garetien-zentrieren-und-reiter.test.js:52` — alle nachgezogen; keine CSS-Regel nennt die Kennung.

⚠️ **Nach Aufgabe 6 hält `zustand.stage` Einträge `{objekt, zusammen}`.** Diese Aufgabe liest davon nur `zustand.stage.size` und sonst `avesmapsGaretienStageListe()`/`avesmapsGaretienStageHat()` — kein direkter Wertzugriff.

🔴 Kein `?v=` von Hand in `index.html` (AGENTS.md §7).

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienAuswahlleisteAuffrischen` ~:483; `garetienAlleWaehlenZustand` ~:652 und `garetienAlleWaehlenKnopfSetzen` ~:667 ersetzt, `avesmapsGaretienAlleAbwaehlen`, `garetienListkopfZahlText`, `garetienListkopfAendern` neu; Kommentar ~:682–687; `garetienZeileZielMarke` neu vor ~:1560; `garetienZeileMarkup` ~:1566; Skelett ~:1724; `garetienListeSkelettVerdrahten` ~:1858; `avesmapsGaretienListeRendern` ~:2060 und ~:2104; `bindFenster` ~:9487–9497; Exporte ~:9936)
- Ändern: `index.html` (~:4265–4278)
- Ändern: `css/components/garetien-importer.css` (Vertragsblock und freie Regeln neu vor „Aufgabe 15: die Handlungsleiste")
- Ändern: `docs/garetien-import-vereint-mockup.html` (Vertragsmarken um :443–450 im Stand nach Aufgabe 11; Kopf des Abschnitts „NEU" :397–405; Übersicht §8)
- Test: `js/review/__tests__/garetien-listkopf.test.js` (neu)
- Fremde Tests: `garetien-anzeige-menge.test.js`, `garetien-vokabular.test.js`, `garetien-auswahlleiste.test.js`, `garetien-zentrieren-und-reiter.test.js`, `garetien-liste-zeile.test.js`, `garetien-auswahlleiste-folgt.test.js`

**Schnittstellen:**
- Nutzt: `garetienStageZeile2(objekt, aufDerStage): string` (A9) · `garetienStageZusammenfassung(stageObjekte: Array): {objekte, zeilen, verbuende}` (A7) · `avesmapsGaretienStageListe(): object[]`, `avesmapsGaretienStageHat(key): boolean` (A6) · vorhanden: `avesmapsGaretienAlleWaehlen(objekte): number`, `avesmapsGaretienAuswahlHat(schluessel): boolean`, `garetienAuswahlleisteAuffrischen()`, `garetienStageNeuZeichnen()`, `garetienAnzahlText(anzahl, einzahl, mehrzahl)`, `garetienListeSkelettSicherstellen()`
- Liefert: `garetienZeileMarkup(objekt, istAusgewaehlt, zielMarke?: string): string` · `garetienZeileZielMarke(objekt, stand: string, aufDerStage: boolean): string` · `garetienAlleWaehlenZustand(objekte, stand, istGewaehlt?: (schluessel) => boolean): {anzahl, beschriftung: "alle n", gesperrt, alleGewaehlt, teilweise}` · `garetienListkopfZahlText(anzahl, gesamt, stand, objektZahl?): string` · `garetienAlleWaehlenKnopfSetzen(objekte, reiter): object|null` · `avesmapsGaretienAlleAbwaehlen(objekte): number` · `garetienListkopfAendern(feld, objekte): number|null` · Kennungen `#garetien-listkopf`, `#garetien-alle`, `#garetien-alle-text`, `#garetien-alle-zahl`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neu: `js/review/__tests__/garetien-listkopf.test.js`

```js
// Liste und Leisten (Bauplan 2026-09-14, Aufgabe 12; Entwurf §7, Mockup §2 bis §4 und §7).
//
// 🔴 GEMESSEN AM ABLAUF: die Liste wird ueber die echte Tuer gezeichnet (avesmapsGaretienListeHolen),
// das Skelett dabei wirklich verdrahtet, und das Haekchen „alle n" ueber seinen echten `change`-Zuhoerer
// geschaltet. Eine Zusicherung, die nur `includes("garetien-alle")` am Quelltext fragte, bliebe gruen,
// wenn niemand den Zuhoerer anmeldet.
// 🔴 BESTAND (Owner 14.09.2026): „alle n" waehlt auf „Übernommen" und „Abgelehnt" genau das, was
// „Alle wählen" dort gewaehlt hat -- gemessen mit Objekten eines Laufs OHNE verbund-Felder.
//
// Ausführen: node js/review/__tests__/garetien-listkopf.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const { api, dom, ELEMENTE } = ladeImporter([
	"garetien-listcol", "garetien-tabs", "garetien-search", "garetien-chips", "garetien-neutral-hinweis",
	"garetien-anzeige-hinweis", "garetien-detailcol", "garetien-auswahlleiste", "garetien-apply",
	"garetien-apply-hint", "garetien-zentrieren-alle", "garetien-anzeige-clear", "garetien-filter-toggle",
	"garetien-filter-menu", "garetien-alle", "garetien-alle-text", "garetien-alle-zahl",
]);
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }
function gleich(ist, soll, was) { n++; assert.strictEqual(ist, soll, was); }
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;").replace(/'/g, "&#039;");

function objekt(name, extra) {
	return Object.assign({
		key: "ggp:Waelder:Wald:Garetien:" + name + "!" + name, name: name, typ: "Wald", ebene: "Waelder",
		stand: "offen", urteil: "neu", wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
		grund: "nichts in 2 Meilen", abschnitte: [], items: [{ id: 1, change_type: "new", anlass: "" }],
	}, extra || {});
}
// Die Liste ueber die echte Tuer -- `zustand.objekte` hat keinen Setter (Vorbild garetien-verbund-klick).
async function holen(stand, objekte, reiter) {
	api.garetienReiterSetzen(stand);
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({
			ok: true, objekte: objekte, plan_run_id: 7, reiter: reiter || {},
		}) });
	};
	try { await api.avesmapsGaretienListeHolen(); } finally { global.fetch = echterFetch; }
}
// Ein Klick, wie ihn der Browser zustellt: erst `checked`, dann `change`.
function schalte(an) {
	const haken = ELEMENTE["garetien-alle"];
	haken.checked = an;
	(haken._hoerer.change || []).forEach(function (fn) { fn({ target: haken }); });
}
function zeileVon(html, o) {
	const i = html.indexOf('data-key="' + esc(o.key) + '"');
	const j = html.indexOf('<div class="avm-row"', i + 1);
	return i === -1 ? "" : html.slice(i, j === -1 ? html.length : j);
}

(async function () {
	// ---- 1. Das Skelett: der Listenkopf steht zwischen Suche und Liste, „Alle wählen" nirgends mehr ----
	const skelett = api.garetienListeSkelettMarkup();
	const iKopf = skelett.indexOf('<div class="gi-listkopf" id="garetien-listkopf">');
	pruefe(iKopf !== -1, "der Listenkopf steht im Skelett");
	pruefe(skelett.indexOf('<input type="checkbox" id="garetien-alle"') > iKopf, "mit dem Haekchen „alle n\"");
	pruefe(iKopf > skelett.indexOf('class="gi-searchrow"') && iKopf < skelett.indexOf('id="garetien-list"'),
		"zwischen Suche und Liste");
	const html = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");
	pruefe(!html.includes('id="garetien-mark-all"'), "💣 der Knopf „Alle wählen\" ist aus der Fussleiste gefallen");
	const quelle = fs.readFileSync(path.join(WURZEL, "js/review/review-garetien-importer.js"), "utf8");
	pruefe(!quelle.includes('getElementById("garetien-mark-all")'), "und niemand sucht ihn mehr");

	// ---- 2. Der Stand des Haekchens -----------------------------------------------------------------------
	const a = objekt("Silker Heide");
	const b = objekt("Silker Hain 3");
	const c = objekt("Weidicht");
	const keins = api.garetienAlleWaehlenZustand([a, b], "offen", () => false);
	gleich(keins.beschriftung, "alle 2", "die Beschriftung traegt die Zahl der Zeilen");
	gleich(keins.alleGewaehlt || keins.teilweise, false, "nichts gewaehlt: weder gesetzt noch halb");
	const halb = api.garetienAlleWaehlenZustand([a, b], "offen", (k) => k === a.key);
	gleich(halb.teilweise && !halb.alleGewaehlt, true, "eine von zwei: halb");
	const voll = api.garetienAlleWaehlenZustand([a, b], "offen", () => true);
	gleich(voll.alleGewaehlt && !voll.teilweise, true, "beide: gesetzt");
	gleich(api.garetienAlleWaehlenZustand([], "stage").gesperrt, true, "eine leere Liste sperrt");
	gleich(api.garetienAlleWaehlenZustand([a], "stage").gesperrt, false, "auf der Stage nicht gesperrt (Owner-Punkt 18)");

	// ---- 3. Die Zahl --------------------------------------------------------------------------------------
	gleich(api.garetienListkopfZahlText(5, 8237, "offen"), "5 von 8237", "Server-Reiter: n von m");
	gleich(api.garetienListkopfZahlText(3, 0, "abgelehnt"), "3 von 3", "ohne Reiterzahl nie „3 von 0\"");
	gleich(api.garetienListkopfZahlText(5, 5, "stage", 2), "5 auf der Stage · 2 Objekte", "Stage: Zeilen und Objekte");
	gleich(api.garetienListkopfZahlText(3, 5, "stage", 1), "3 von 5 auf der Stage · 1 Objekt", "gefilterte Stage");
	gleich(api.garetienListkopfZahlText(0, 0, "offen"), "", "ohne Zeilen keine Zahl");

	// ---- 4. Die Ziel-Marke --------------------------------------------------------------------------------
	gleich(api.garetienZeileZielMarke(a, "stage", true), api.garetienStageZeile2(a, true),
		"auf der Stage traegt die Zeile den Text von garetienStageZeile2");
	gleich(api.garetienZeileZielMarke(a, "offen", true), "auf der Stage", "auf „Offen\": liegt es dort?");
	gleich(api.garetienZeileZielMarke(a, "offen", false), "", "…und sonst nichts");
	gleich(api.garetienZeileZielMarke(a, "uebernommen", true) + api.garetienZeileZielMarke(a, "abgelehnt", true), "",
		"auf „Übernommen\" und „Abgelehnt\" keine Marke");
	const zeile = api.garetienZeileMarkup(a, false, "als <Fläche>");
	pruefe(zeile.includes('<span class="avm-row__l2"><span class="gi-ziel-marke">als &lt;Fläche&gt;</span> · <span class="u '),
		"die Marke steht VORN in der zweiten Zeile, escaped: " + zeile);
	pruefe(!api.garetienZeileMarkup(a, false).includes("gi-ziel-marke"), "ohne Marke keine leere Huelle");

	// ---- 5. ABLAUF auf der Stage ----------------------------------------------------------------------------
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([a, b]);
	await holen("stage", []);
	pruefe(zeileVon(dom.html("#garetien-list"), a)
		.includes('<span class="gi-ziel-marke">' + esc(api.garetienStageZeile2(a, true)) + "</span>"),
		"auf der Stage traegt jede Zeile ihr Ziel: " + dom.html("#garetien-list"));
	gleich(dom.text("#garetien-alle-text"), "alle 2", "der Listenkopf zaehlt die Zeilen");
	gleich(dom.text("#garetien-alle-zahl"), "2 auf der Stage · 2 Objekte", "…und die Objekte");
	const haken = ELEMENTE["garetien-alle"];
	gleich((haken._hoerer.change || []).length, 1,
		"💣 genau EIN change-Zuhoerer -- ein zweiter naehme im selben Klick zurueck, was der erste tat");
	gleich(haken.checked === true || haken.disabled === true, false, "vor dem Klick: frei und nicht gesetzt");
	api.avesmapsGaretienAuswahlUmschalten("ggp:fremd!fremd", null);
	schalte(true);
	pruefe(api.avesmapsGaretienAuswahlHat(a.key) && api.avesmapsGaretienAuswahlHat(b.key), "„alle 2\" waehlt beide");
	gleich(haken.checked && !haken.indeterminate, true, "…und steht danach gesetzt");
	api.avesmapsGaretienAuswahlUmschalten(b.key);
	gleich(!haken.checked && haken.indeterminate, true,
		"ein einzelner Zeilenhaken nimmt den Listenkopf mit auf „teilweise\" (garetienAuswahlleisteAuffrischen)");
	schalte(false);
	pruefe(!api.avesmapsGaretienAuswahlHat(a.key) && !api.avesmapsGaretienAuswahlHat(b.key),
		"abgewaehlt werden die Zeilen dieser Liste");
	pruefe(api.avesmapsGaretienAuswahlHat("ggp:fremd!fremd"), "⚠️ …und nur sie: was die Liste nicht zeigt, bleibt gewaehlt");

	// ---- 6. ABLAUF auf „Offen": die Marke „auf der Stage" und „n von m" --------------------------------------
	await holen("offen", [a, c], { offen: 57 });
	pruefe(zeileVon(dom.html("#garetien-list"), a).includes('<span class="gi-ziel-marke">auf der Stage</span>'),
		"die Zeile auf „Offen\" sagt, dass sie auf der Stage liegt");
	pruefe(!zeileVon(dom.html("#garetien-list"), c).includes("gi-ziel-marke"), "…eine andere nicht");
	gleich(dom.text("#garetien-alle-zahl"), "2 von 57", "n von m");

	// ---- 7. BESTAND: auf „Übernommen" und „Abgelehnt" waehlt „alle n", was „Alle wählen" dort waehlte ----
	const bestand = [
		["uebernommen", [objekt("Dunkelforst", { stand: "uebernommen" }), objekt("Eichengrund", { stand: "uebernommen" })]],
		["abgelehnt", [objekt("Moosgrund", { stand: "abgelehnt" })]],
	];
	for (const [stand, liste] of bestand) {
		await holen(stand, liste, { [stand]: liste.length });
		api.avesmapsGaretienAuswahlAufheben();
		api.avesmapsGaretienAlleWaehlen(liste);
		const messlatte = liste.filter((o) => api.avesmapsGaretienAuswahlHat(o.key)).map((o) => o.key).join("|");
		api.avesmapsGaretienAuswahlAufheben();
		schalte(true);
		gleich(liste.filter((o) => api.avesmapsGaretienAuswahlHat(o.key)).map((o) => o.key).join("|"), messlatte,
			"auf „" + stand + "\" waehlt „alle n\" dieselbe Menge wie avesmapsGaretienAlleWaehlen");
		gleich(dom.text("#garetien-alle-zahl"), liste.length + " von " + liste.length, "Zahl auf „" + stand + "\"");
		pruefe(!dom.html("#garetien-list").includes("gi-ziel-marke"), "keine Ziel-Marke auf „" + stand + "\"");
	}

	// ---- 8. Das CSS ---------------------------------------------------------------------------------------
	const css = fs.readFileSync(path.join(WURZEL, "css/components/garetien-importer.css"), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "");
	pruefe(/\.gi-listkopf\s*\{[^}]*border-bottom:\s*1px solid var\(--color-divider\)/.test(css),
		"der Listenkopf setzt sich mit der Trennlinie ab, nicht mit einem Rahmen");
	pruefe(/\.gi-ziel-marke\s*\{[^}]*color:\s*var\(--color-accent-brown\)/.test(css), "die Marke traegt den Akzent");
	pruefe(/\.gi-listkopf input\[type="checkbox"\]\s*\{[^}]*width:\s*14px/.test(css),
		"das Haekchen traegt die Masse der Zeilenhaekchen");

	console.log("OK -- garetien-listkopf (" + n + " Zusicherungen)");
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
node js/review/__tests__/garetien-listkopf.test.js
```

Erwartet: `AssertionError [ERR_ASSERTION]: der Listenkopf steht im Skelett` (gesehen im Probelauf auf dem Stand nach Aufgabe 11).

- [ ] **Schritt 3: Umsetzen**

**3a — „alle n", sein Stand, seine Zahl.** Ersetze in `js/review/review-garetien-importer.js` alles ab dem Kommentar `// REIN: Beschriftung + Sperre des Knopfes „Alle markieren"` (heute :632) bis ausschließlich `// ---- Owner-Auftrag B (30.08.2026): „Keines markieren"` (heute :678) — also `garetienAlleWaehlenZustand` und `garetienAlleWaehlenKnopfSetzen` samt Kommentaren — durch:

```js
	// „alle n" im Listenkopf, das Gegenstueck: nimmt GENAU diese Zeilen wieder aus der Auswahl.
	// 🔴 Ein Haekchen, das sich setzen, aber nicht loesen laesst, ist kein Haekchen. Geloest werden NUR
	// die uebergebenen Zeilen, nie die ganze Auswahl: was ein Filter gerade ausblendet, bleibt gewaehlt --
	// dieselbe Regel wie beim Waehlen (Owner 08.09.2026, siehe avesmapsGaretienAuswahlAufDieStage).
	function avesmapsGaretienAlleAbwaehlen(objekte) {
		let geloest = 0;
		(objekte || []).forEach(function (o) {
			if (!o || o.key === undefined || o.key === null || o.key === "") { return; }
			if (zustand.auswahl.delete(String(o.key))) { geloest++; }
		});
		garetienAuswahlleisteAuffrischen();
		return geloest;
	}

	/*
	 * REIN: der Stand des Haekchens „alle n" im Listenkopf (Bauplan 2026-09-14, Aufgabe 12).
	 *
	 * 🔴 BIS ZUM 14.09.2026 WAR ES DER KNOPF „Alle wählen (n)" IM FUSS (Aufgabe 10, Owner 29.08.2026).
	 * Er ist in den Listenkopf gewandert (Entwurf §7): die Fussleiste gehoert ausnahmslos der GANZEN
	 * Stage, und „alle" meint die Zeilen DIESER Liste. Die Semantik je Reiter bleibt UNVERAENDERT
	 * (Bestand, Owner 14.09.2026): gewaehlt wird, was avesmapsGaretienAlleWaehlen mit den gerenderten
	 * Objekten waehlt -- auf „Übernommen" also auch die Mitglieder einer gefalteten Zeile.
	 * ⚠️ `stand` reist weiter mit und wird bewusst NICHT gelesen: die Sperre auf dem Reiter „Stage" ist
	 * am 07.09.2026 gefallen (Owner-Punkt 18: „alle wählen geht auch nicht auf der stage"). Gesperrt
	 * bleibt nur die LEERE Liste -- „alle von nichts" ist ein Klick fuer nichts.
	 * ⚠️ `istGewaehlt` (`(schluessel) => bool`) kommt HEREIN, damit die Funktion ohne Modulzustand
	 * pruefbar bleibt. Ohne ihn gilt nichts als gewaehlt.
	 * ⚠️ OHNE Hinweistext (Owner 30.08.2026: „verbraucht nur platz") -- das graue Haekchen mit „alle 0"
	 * sagt es.
	 */
	function garetienAlleWaehlenZustand(objekte, stand, istGewaehlt) {
		void stand;
		const liste = (objekte || []).filter(function (o) {
			return o && o.key !== undefined && o.key !== null && o.key !== "";
		});
		const hat = typeof istGewaehlt === "function" ? istGewaehlt : function () { return false; };
		const gewaehlt = liste.filter(function (o) { return hat(String(o.key)); }).length;
		return {
			anzahl: liste.length,
			beschriftung: "alle " + liste.length,
			gesperrt: liste.length === 0,
			alleGewaehlt: liste.length > 0 && gewaehlt === liste.length,
			teilweise: gewaehlt > 0 && gewaehlt < liste.length,
		};
	}

	/*
	 * REIN: die Zahl rechts im Listenkopf.
	 *
	 * Auf den Server-Reitern „n von m": m ist die Zahl im Reitertitel, n die der gerenderten Zeilen
	 * (Suche und „Angezeigte Zeilen" verkleinern sie). Auf der Stage „n auf der Stage · k Objekte": k aus
	 * garetienStageZusammenfassung (Aufgabe 7), weil ein zusammengelegter Verbund EIN Objekt aus mehreren
	 * Zeilen ist -- dieselbe Zaehlung wie im Fussknopf, nie eine zweite.
	 * ⚠️ Ohne Zeilen und ohne Gesamtzahl steht nichts da -- „0 von 0" ist keine Auskunft.
	 */
	function garetienListkopfZahlText(anzahl, gesamt, stand, objektZahl) {
		const n = Number(anzahl) || 0;
		const m = Number(gesamt) || 0;
		if (n === 0 && m === 0) { return ""; }
		if (String(stand || "") === "stage") {
			let text = (n === m ? String(m) : n + " von " + m) + " auf der Stage";
			if (typeof objektZahl === "number" && isFinite(objektZahl)) {
				text += " · " + garetienAnzahlText(objektZahl, "Objekt", "Objekte");
			}
			return text;
		}
		return n + " von " + Math.max(n, m);
	}

	// Die DOM-Haelfte dazu -- Haekchen, Text und Zahl an EINER Stelle, damit sie nie auseinanderlaufen.
	// ⚠️ Der Name blieb, obwohl hier kein Knopf mehr steht: er hat drei Aufrufer, und ein zweiter Name fuer
	// dieselbe Stelle waere die Doppelung, vor der AGENTS.md §11 warnt.
	// 💣 `indeterminate` ist eine EIGENSCHAFT, kein Attribut (dieselbe Falle wie `data-part` an den Zeilen)
	// -- sie wird hier direkt am Element gesetzt, bei jedem Aufruf neu.
	function garetienAlleWaehlenKnopfSetzen(objekte, reiter) {
		if (!hasDocument) { return null; }
		const stand = garetienAlleWaehlenZustand(objekte, zustand.stand, avesmapsGaretienAuswahlHat);
		const haken = document.getElementById("garetien-alle");
		if (haken) {
			haken.checked = stand.alleGewaehlt;
			haken.indeterminate = stand.teilweise;
			haken.disabled = stand.gesperrt;
		}
		const text = document.getElementById("garetien-alle-text");
		if (text) { text.textContent = stand.beschriftung; }
		const zahl = document.getElementById("garetien-alle-zahl");
		if (zahl) {
			const aufDerStage = zustand.stand === "stage";
			zahl.textContent = garetienListkopfZahlText(
				stand.anzahl,
				aufDerStage ? zustand.stage.size : Number((reiter || {})[zustand.stand] || 0),
				zustand.stand,
				aufDerStage ? garetienStageZusammenfassung(avesmapsGaretienStageListe()).objekte : undefined
			);
		}
		return stand;
	}

	/*
	 * Das Haekchen „alle n" wurde umgeschaltet -- gibt die Zahl der geaenderten Zeilen zurueck, oder
	 * `null`, wenn das Haekchen fehlt oder gesperrt ist.
	 * 🔴 Die Richtung kommt aus `checked`, das der Browser beim Klick schon gesetzt hat. Bei den
	 * Item-Haken ist genau das verboten (garetienPlanAusItems: der SERVERSTAND entscheidet) -- hier
	 * nicht: die Auswahl ist ein reiner Client-Zustand, es gibt keine zweite Buchhaltung.
	 * ⚠️ Ein halb gesetztes Haekchen schaltet der Browser beim Klick auf „an": ein Klick auf „teilweise"
	 * waehlt also alle, die aufbauende Richtung.
	 */
	function garetienListkopfAendern(feld, objekte) {
		if (!feld || feld.disabled) { return null; }
		return feld.checked
			? avesmapsGaretienAlleWaehlen(objekte || [])
			: avesmapsGaretienAlleAbwaehlen(objekte || []);
	}
```

**3b — die Kommentare im Abschnitt „Owner-Auftrag B".** Ersetze `gilt -- „Alle wählen", „Stage leeren",` durch `gilt -- „Stage leeren",` und die zwei Zeilen

```js
	// ⚠️ „Alle wählen" BLEIBT dagegen im Fuss: die Leiste erscheint erst, wenn schon etwas gewaehlt
	// ist, und kann den Knopf, der die erste Auswahl macht, deshalb gar nicht tragen.
```

durch

```js
	// 🔴 „Alle wählen" hat den Fuss am 14.09.2026 ebenfalls verlassen: es ist das Haekchen „alle n" im
	// Listenkopf (Bauplan 2026-09-14, Aufgabe 12) -- dort steht es VOR der ersten Auswahl, was die
	// Leiste nicht konnte.
```

**3c — der Listenkopf folgt der Auswahl.** In `garetienAuswahlleisteAuffrischen` (heute :483) hinter den Aufruf `garetienAuswahlleisteSetzen(…);`:

```js
		// Aufgabe 12 (14.09.2026): das Haekchen „alle n" haengt an derselben Auswahl. Ohne diese Zeile
		// stuende es nach einem einzelnen Zeilenhaken auf dem alten Stand, bis die Liste neu gezeichnet wird.
		garetienAlleWaehlenKnopfSetzen(zustand.objekte, zustand.letzteAntwort ? zustand.letzteAntwort.reiter : null);
```

**3d — die Ziel-Marke.** Unmittelbar vor dem Kommentar `// 🔴 Aufgabe 2 (Entwurf §3.2): das Haekchen ist ein reiner MARKER` (heute :1560):

```js
	/*
	 * REIN: die Ziel-Marke einer Listenzeile (Bauplan 2026-09-14, Aufgabe 12; Entwurf §7).
	 *
	 * Auf dem Reiter „Stage": was aus dem Objekt wird -- der Text von garetienStageZeile2 (Aufgabe 9),
	 * der bis hierher keinen Aufrufer hatte. Auf „Offen": „auf der Stage", wenn es dort liegt. Auf den
	 * uebrigen Reitern nichts -- dort gibt es keine Stage-Frage.
	 * ⚠️ `aufDerStage` kommt HEREIN (avesmapsGaretienStageHat an der Aufrufstelle), damit die Funktion
	 * ohne Modulzustand pruefbar bleibt.
	 */
	function garetienZeileZielMarke(objekt, stand, aufDerStage) {
		if (!objekt) { return ""; }
		const s = String(stand || "");
		if (s === "stage") { return garetienStageZeile2(objekt, true); }
		if (s === "offen" && aufDerStage === true) { return "auf der Stage"; }
		return "";
	}
```

**3e — die Zeile.** `function garetienZeileMarkup(objekt, istAusgewaehlt) {` wird `function garetienZeileMarkup(objekt, istAusgewaehlt, zielMarke) {`, und unmittelbar vor `return '<div class="avm-row" data-key="' …` (heute :1587):

```js
		// Aufgabe 12 (14.09.2026): die Ziel-Marke steht VORN in der zweiten Zeile (Entwurf §7) --
		// garetienZeileZielMarke rechnet sie, diese Funktion bleibt rein und bekommt sie herein.
		// ⚠️ NEBEN dem Urteil, nie im Namen: `.avm-row__name` ellipsiert, und eine Marke darin
		// verschwaende hinter den drei Punkten (AGENTS.md §11).
		const marke = String(zielMarke || "");
		if (marke !== "") {
			l2 = '<span class="gi-ziel-marke">' + avesmapsGaretienEscape(marke) + "</span> · " + l2;
		}
```

**3f — das Skelett.** In `garetienListeSkelettMarkup` unmittelbar vor `+ '<div class="avm-scroll gi-list" id="garetien-list"></div>'` (heute :1724):

```js
			// Aufgabe 12 (14.09.2026): der LISTENKOPF -- „alle n" als Haekchen und die Zahl der Zeilen.
			// 🔴 Er ersetzt den Knopf „Alle wählen" im Fuss (Entwurf §7: die Fussleiste gehoert der GANZEN
			// Stage). Ein GESCHWISTER der Liste, kein Kind: im Rollkasten rollte er bei 500 Zeilen weg.
			// ⚠️ Der Text steht in einem eigenen <span>: ein `textContent` am <label> loeschte das Haekchen mit.
			+ '<div class="gi-listkopf" id="garetien-listkopf">'
			+ '<label for="garetien-alle"><input type="checkbox" id="garetien-alle" disabled>'
			+ '<span id="garetien-alle-text">alle 0</span></label>'
			+ '<span class="gi-listkopf__zahl" id="garetien-alle-zahl"></span>'
			+ "</div>"
```

**3g — die Verdrahtung.** In `garetienListeSkelettVerdrahten` unmittelbar vor `const sucheEl = document.getElementById("garetien-search");` (heute :1858 — ⚠️ derselbe Satz steht ein zweites Mal in der Hinweis-Funktion von Aufgabe 5, gemeint ist der in `garetienListeSkelettVerdrahten`):

```js
		// Aufgabe 12 (14.09.2026): „alle n" im Listenkopf. `change`, nicht `click`: auch die Leertaste
		// schaltet ein Haekchen, und `change` kommt erst, wenn der Browser `checked` gesetzt hat.
		// 🔴 Danach dasselbe Neuzeichnen wie beim Knopf, den es ersetzt (bis 14.09.2026 in bindFenster).
		const alleEl = document.getElementById("garetien-alle");
		if (alleEl) {
			alleEl.addEventListener("change", function () {
				if (garetienListkopfAendern(alleEl, zustand.objekte) === null) { return; }
				garetienStageNeuZeichnen();
			});
		}
```

**3h — das Rendern.** In `avesmapsGaretienListeRendern` wird `return garetienZeileMarkup(zeileObjekt, alleGewaehlt);` (heute :2060) zu

```js
					return garetienZeileMarkup(zeileObjekt, alleGewaehlt, garetienZeileZielMarke(
						zeileObjekt, zustand.stand, avesmapsGaretienStageHat(zeileObjekt.key)));
```

und `garetienAlleWaehlenKnopfSetzen(objekte);` (heute :2104) zu `garetienAlleWaehlenKnopfSetzen(objekte, a.reiter);`.

**3i — `bindFenster`.** Der Block ab `// Aufgabe 10: „Alle markieren" -- derselbe Zug wie die zwei Knoepfe darunter (reine` bis ausschließlich `// 🔴 Fixrunde 1 (D2), 07.09.2026: „Auswahl aufheben" (#garetien-mark-none) ist aus dem Fuss` (heute :9487–9497, samt `markAlleBtn`) fällt; an seine Stelle:

```js
		// 🪴 „Alle wählen" (#garetien-mark-all) wurde bis zum 14.09.2026 hier verdrahtet. Es ist als
		// Haekchen „alle n" in den Listenkopf gewandert und haengt seither am Skelett
		// (garetienListeSkelettVerdrahten) -- der Listenkopf entsteht mit ihm, nicht beim Start.
```

**3j — Exporte.** Hinter `garetienAlleWaehlenZustand,` (heute :9936):

```js
			avesmapsGaretienAlleAbwaehlen,
			garetienListkopfZahlText,
			garetienListkopfAendern,
			garetienZeileZielMarke,
```

**3k — `index.html`.** Der Kommentar ab `<!-- Aufgabe 10 (Owner 29.08.2026): „Alle markieren" markiert` samt `<button class="btn" type="button" id="garetien-mark-all">Alle wählen</button>` (heute :4265–4269) fällt; an seine Stelle:

```html
				<!-- 🪴 „Alle wählen" (#garetien-mark-all) stand bis zum 14.09.2026 hier. Es ist als Häkchen
				     „alle n" in den Listenkopf gewandert (Bauplan 2026-09-14, Aufgabe 12): die Fußleiste
				     gehört ausnahmslos der GANZEN Stage. -->
```

Im Kommentar „FIXRUNDE 1 (D2, 07.09.2026)" darunter ersetze

```html
				     daneben. Der Fuß behält, was der GANZEN STAGE gilt: Alle wählen · Stage leeren ·
				     Alle zentrieren · Stage importieren.
				     ⚠️ „Alle wählen" BLEIBT hier: die Leiste erscheint erst, wenn schon etwas
				     gewählt ist, und kann den Knopf, der die erste Auswahl macht, nicht tragen. -->
```

durch

```html
				     daneben. Der Fuß behält, was der GANZEN STAGE gilt: Stage leeren · Alle zentrieren ·
				     Stage importieren. „Alle wählen" ist seit dem 14.09.2026 das Häkchen im Listenkopf —
				     dort steht es VOR der ersten Auswahl, was die Auswahlleiste nicht konnte. -->
```

**3l — CSS.** In `css/components/garetien-importer.css` unmittelbar vor dem Kommentar `/* ---- Aufgabe 15: die Handlungsleiste` (also hinter dem Block der Aufgabe 11):

```css
/* ══ VERTRAG: css/components/garetien-importer.css ══ gebunden von docs/garetien-import-vereint-mockup.html
   (Aufgabe 12 des Bauplans 2026-09-14): die Ziel-Marke der Listenzeile und der Listenkopf „alle n".
   ⚠️ Er steht VOR dem Abschnitt der Handlungsleiste, nicht am Dateiende -- aus demselben Grund wie der
   Block der Aufgabe 11 darueber. */
.gi-ziel-marke {
	color: var(--color-accent-brown);
	font-weight: var(--font-weight-bold);
}

.gi-listkopf {
	display: flex;
	align-items: center;
	gap: var(--space-6);
	padding: var(--space-2) var(--space-4) var(--space-4);
	font-size: var(--font-size-caption);
	color: var(--color-text-muted);
	border-bottom: 1px solid var(--color-divider);
	margin-bottom: var(--space-2);
}

.gi-listkopf label {
	display: inline-flex;
	align-items: center;
	gap: var(--space-4);
}

.gi-listkopf__zahl { margin-left: auto; }
/* ══ VERTRAG ENDE ══ */

/* Frei, nicht im Vertrag (er ist eine Untergrenze): der Listenkopf FLUCHTET mit den Zeilen darunter.
   💣 Das Mockup legt die Zeilen direkt in die Spalte; hier stehen sie in `.avm-scroll` (editor-body.css:
   1 px Rahmen, `--space-2` Polster) und tragen selbst 1 px Rahmen (editor-row.css). Ohne Ausgleich sass
   das Haekchen „alle n" 9,33 px links der Zeilenhaekchen (Messseite 14.09.2026, Geraetepixel 1,5).
   Ausgeglichen wird mit Aussenabstand und durchsichtigem Rahmen -- das Polster gehoert dem Vertrag.
   ⚠️ Die 2 px sind die zwei Rahmen (Liste + Zeile), keine freie Zahl: wer einen davon aendert, zieht
   diese Zeile mit. */
.gi-listkopf {
	margin-left: var(--space-2);
	margin-right: var(--space-2);
	border-left: 2px solid transparent;
	border-right: 2px solid transparent;
}

/* Das Haekchen traegt die Masse der Zeilenhaekchen (`.gi-win .avm-row > input[type="checkbox"]`),
   auch deren Browser-Aussenabstand -- ohne die Regel stuende ein Systemhaekchen in Systemfarbe ueber
   einer Spalte aus 14-px-Haekchen in der Akzentfarbe. */
.gi-listkopf input[type="checkbox"] {
	flex: none;
	width: 14px;
	height: 14px;
	accent-color: var(--color-check-accent);
}
```

**3m — Mockup.** Ersetze

```css
/* Das Ziel in der Listenzeile — der Text kommt aus garetienStageZeile2 (heute ohne Aufrufer). */
```

(:443) durch

```css
/* ══ VERTRAG: css/components/garetien-importer.css ══ Aufgabe 12 des Bauplans 2026-09-14 — Ziel-Marke der
   Listenzeile und Listenkopf „alle n". Geändert wird ein Wert HIER; der Produktivcode zieht nach, nie umgekehrt. */
/* Das Ziel in der Listenzeile — der Text kommt aus garetienStageZeile2 (seit Aufgabe 12 mit Aufrufer). */
```

und hinter `.gi-listkopf__zahl { margin-left: auto; }` (:450) eine Zeile `/* ══ VERTRAG ENDE ══ */`. ⚠️ Die zweite `.gi-listkopf`-Regel des Mockups weiter oben (:166, Abschnitt „Spalten, Reiter, Liste") bleibt außerhalb der Marke — sie ist die überholte Mockup-Hilfe, gebunden ist die im Abschnitt „NEU".

Der Kopf des Abschnitts „NEU" (:397–405): ersetze die Zeilen ab `   NEU IN DIESEM MOCKUP (14.09.2026) — alles darunter gibt es im Produktivcode NOCH NICHT.` bis ausschließlich der Schlusszeile aus `═` (`   ══════…══ */`) durch:

```css
   NEU IN DIESEM MOCKUP (14.09.2026) — die Regeln dieses Abschnitts sind gebaut; bindend sind die
   Vertragsblöcke darunter (tools/mockup-vertrag, Deploy-Tor): Aufgabe 11 die Blöcke, Aufgabe 9 die
   Zielwahl und die abgeblendete Zeile, Aufgabe 12 Ziel-Marke und Listenkopf. Jeder Block kam im
   Commit, der seine Regeln gebaut hat; was außerhalb eines Blocks steht, bindet nichts (Mockup-Hilfen
   und Nachbildungen vorhandener Regeln) — Übersicht im Abschnitt 8.
   🔴 Geändert wird ein gebundener Wert HIER; die Produktionsdatei zieht nach, nie umgekehrt.
```

Die Übersicht unter `<h2>8 · Was gebaut werden muss — Bauteil für Bauteil</h2>`, rechte Spalte, fünf Zellen:

```html
<td><span class="neu">NEU</span> — Aufgabe 11 des Verbund-Plans, nie gebaut; die Zahl hier auf 11 px statt 9</td>
<td><span class="neu">NEU</span> — die Zielwahl</td>
<td><span class="neu">NEU</span> — das Ziel in der Zeile; Text aus <code>garetienStageZeile2</code></td>
<td><span class="neu">NEU</span> — „alle n"</td>
<td><span class="neu">NEU</span> — abgeblendete Zeile</td>
```

werden in dieser Reihenfolge zu

```html
<td>gebaut in Aufgabe 11 — die Zahl auf 11 px statt der 9 des Verbund-Mockups</td>
<td>gebaut in Aufgabe 9 — die Zielwahl</td>
<td>gebaut in Aufgabe 12 — das Ziel in der Zeile; Text aus <code>garetienStageZeile2</code></td>
<td>gebaut in Aufgabe 12 — „alle n"</td>
<td>gebaut in Aufgabe 9 — abgeblendete Zeile</td>
```

Danach steht im Mockup kein „NOCH NICHT" und kein `class="neu"` mehr (`grep -c`, beide 0). ⚠️ Die Regel `.neu` im `<style>` und ihre Zeile „nur Mockup" in §8 bleiben — ungenutzt, aber außerhalb jedes Vertragsblocks.

- [ ] **Schritt 4: Test fahren, grün sehen — fremde Tests, Vertragstest**

Fremde Tests nachziehen (Alttext wie nach den Aufgaben 5 bis 7; `garetien-vokabular.test.js` trägt nach Aufgabe 7 die Fußknopf-Beschriftung „Stage importieren · nichts auf der Stage"; `garetien-liste-zeile.test.js` behält nach Aufgabe 5 `gi-anzeigehinweis`, weil der Hinweis-Absatz bleibt):

**`js/review/__tests__/garetien-anzeige-menge.test.js`** — Beschriftung 3. Ersetze

```js
	gleich(standDrei.beschriftung, "Alle wählen (3)", "die Zahl der gerenderten Zeilen steht im Knopf");
```

durch:

```js
	// 🔴 Seit dem 14.09.2026 das Haekchen „alle n" im Listenkopf (Bauplan 2026-09-14, Aufgabe 12).
	gleich(standDrei.beschriftung, "alle 3", "die Zahl der gerenderten Zeilen steht am Haekchen im Listenkopf");
```

**`js/review/__tests__/garetien-anzeige-menge.test.js`** — Beschriftung 0. Ersetze

```js
	gleich(standLeer.beschriftung, "Alle wählen (0)",
```

durch:

```js
	gleich(standLeer.beschriftung, "alle 0",
```

**`js/review/__tests__/garetien-vokabular.test.js`** — mark-all weg. Ersetze

```js
// ⚠️ Geblieben ist `garetien-mark-all`: die Leiste erscheint erst, wenn schon etwas gewaehlt ist,
// und kann den Knopf, der die ERSTE Auswahl macht, deshalb nicht tragen.
// =================================================================================================
["garetien-mark-all"].forEach((id) => {
	wahr(garetienHtmlTeil.includes('id="' + id + '"'),
		"die Kennung " + id + " muss weiterhin im Markup des Garetien-Fensters stehen");
});
```

durch:

```js
// 🔴 Und seit dem 14.09.2026 auch `garetien-mark-all`: „Alle wählen" ist als Haekchen „alle n" in den
// Listenkopf gewandert (Bauplan 2026-09-14, Aufgabe 12) -- dort steht es VOR der ersten Auswahl, was die
// Auswahlleiste nicht konnte. Das Haekchen hat eine eigene Kennung (`garetien-alle`) im Skelett.
// =================================================================================================
["garetien-mark-all"].forEach((id) => {
	wahr(!garetienHtmlTeil.includes('id="' + id + '"'),
		"die Kennung " + id + " ist mit dem Umzug in den Listenkopf gefallen");
});
```

**`js/review/__tests__/garetien-vokabular.test.js`** — Fuss drei Knoepfe (Stand nach Aufgabe 7). Ersetze

```js
		["Alle wählen", "Stage leeren", "Alle zentrieren", "Stage importieren · nichts auf der Stage"],
		"der Fuss traegt genau die vier Knoepfe der GANZEN STAGE, in dieser Reihenfolge");
```

durch:

```js
		["Stage leeren", "Alle zentrieren", "Stage importieren · nichts auf der Stage"],
		"der Fuss traegt genau die drei Knoepfe der GANZEN STAGE, in dieser Reihenfolge -- „Alle wählen\" "
		+ "steht seit dem 14.09.2026 als Haekchen im Listenkopf");
```

**`js/review/__tests__/garetien-auswahlleiste.test.js`** — Kennungen. Ersetze

```js
const { api, dom } = ladeImporter(["garetien-auswahlleiste", "garetien-mark-all",
```

durch:

```js
const { api, dom } = ladeImporter(["garetien-auswahlleiste", "garetien-alle", "garetien-alle-text", "garetien-alle-zahl",
```

**`js/review/__tests__/garetien-zentrieren-und-reiter.test.js`** — Kennungen. Ersetze

```js
	"garetien-mark-all", "garetien-anzeige-clear",
```

durch:

```js
	"garetien-anzeige-clear",
```

**`js/review/__tests__/garetien-liste-zeile.test.js`** — Skelett-Reihenfolge. Ersetze

```js
gleich(oben.join(","),
	"avm-tabs,gi-searchrow,gi-anzeigehinweis,gi-chips,gi-neutral-hinweis,avm-scroll,gi-auswahlleiste",
	"die linke Spalte hat SIEBEN Geschwister in dieser Reihenfolge -- stehen Chips, Neutral-Hinweis "
	+ "oder Liste IN der `.gi-searchrow`, legt deren `display: flex` sie nebeneinander");
checks++;
```

durch:

```js
// 🔴 Seit dem 14.09.2026 (Bauplan 2026-09-14, Aufgabe 12) steht der Listenkopf `.gi-listkopf` („alle n")
// unmittelbar UEBER der Liste -- ein Geschwister, kein Kind: im Rollkasten rollte er bei 500 Zeilen weg.
gleich(oben.join(","),
	"avm-tabs,gi-searchrow,gi-anzeigehinweis,gi-chips,gi-neutral-hinweis,gi-listkopf,avm-scroll,gi-auswahlleiste",
	"die linke Spalte hat ACHT Geschwister in dieser Reihenfolge -- stehen Chips, Neutral-Hinweis "
	+ "oder Liste IN der `.gi-searchrow`, legt deren `display: flex` sie nebeneinander");
checks++;
wahr(oben.indexOf("gi-listkopf") === oben.indexOf("avm-scroll") - 1, "der Listenkopf steht direkt ueber der Liste");
checks++;
```

**`js/review/__tests__/garetien-auswahlleiste-folgt.test.js`** — Aufrufzahl. Ersetze

```js
pruefe(rufe === 5,
	"fünf Aufrufe -- zwei Ausgänge des Umschalters, alle wählen, aufheben, Verbund-Umschalter: " + rufe);
```

durch:

```js
// 🔴 6, seit dem 14.09.2026 (Bauplan 2026-09-14, Aufgabe 12): „alle n" im Listenkopf LOEST die Auswahl
// auch wieder (avesmapsGaretienAlleAbwaehlen) -- ein Aenderer mehr, derselbe Auffrischer.
pruefe(rufe === 6,
	"sechs Aufrufe -- zwei Ausgänge des Umschalters, alle wählen, alle abwählen, aufheben, Verbund-Umschalter: " + rufe);
```


```bash
node js/review/__tests__/garetien-listkopf.test.js
for t in garetien-anzeige-menge garetien-vokabular garetien-auswahlleiste garetien-auswahlleiste-folgt garetien-zentrieren-und-reiter garetien-liste-zeile garetien-filtertrichter garetien-handlungen garetien-innerorts-knopf garetien-verbund-marke garetien-anzeige-filtersperre garetien-detailspalte-reihenfolge; do node js/review/__tests__/$t.test.js 2>&1 | tail -1; done
node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"'
```

Erwartet: `OK -- garetien-listkopf (44 Zusicherungen)`, alle übrigen OK; der Vertragstest meldet einen Vertrag mehr als nach Aufgabe 11; im Feld kein `ROT:` (in einer CRLF-Arbeitskopie vorbestehend `quellen-abdeckung-ziel.test.js`); die Dateizahl ist eins höher als nach Aufgabe 11.

Probelauf (Wegwerf-Worktree auf `9fccacfbc`, aufgesetzt auf Aufgabe 11 und die eingespielten Aufgaben 9 und 10; für `garetienStageZusammenfassung` aus Aufgabe 7 eine Wegwerf-Attrappe, die jedes aufgelegte Objekt als eine Zeile zählt): Schritt 2 rot wie angegeben; danach 44 Zusicherungen grün; Feld **545 Dateien, 0 rot**; Vertragstest **13 → 14**; im Mockup kein „NOCH NICHT" und kein `class="neu"` mehr. Mutationsproben mit Byte-Gegenprobe, **8 von 8 gefangen**: Zuhörer doppelt angemeldet · Auffrischen vergisst den Listenkopf · Abwählen leert die ganze Auswahl · Rendern reicht keine Marke herein · Marke auch auf „Übernommen" · Stage-Zahl ohne Objekte · Listenkopf-Häkchen ohne Zeilenmaße · Vertragswert `padding` der Liste weicht ab (Vertragstest). LF-Spiegel (wie `actions/checkout`): alle berührten Garetien-Tests grün.

- [ ] **Schritt 5: Im Browser messen**

Dieselbe Messseite wie in Aufgabe 11, Schritt 5 (`messseite.js` baut den Listenkopf und die Zeilen mit Ziel-Marke schon mit). Die Messzeile trägt je Fenster `listkopfHaken=<links> <Breite>x<Höhe>` und `zeilenHaken=<links> <Breite>x<Höhe>`.

Erwartet — so gemessen am 14.09.2026 (Gerätepixel 1,5):

- `listkopfHaken=50.67 14x14 zeilenHaken=50 14x14` — höchstens ein Gerätepixel auseinander. Ohne die freie `.gi-listkopf`-Regel stand dort `40.67`.
- auf der Stage trägt jede Zeile vorn die braune Marke (Text aus `garetienStageZeile2`), auf „Offen" die aufgelegten Zeilen „auf der Stage", die übrigen keine
- die Trennlinie unter dem Listenkopf reicht von der linken bis zur rechten Kante des Listenkastens

In beiden Themen ansehen (`data-theme`), dann Server beenden und Seite löschen.

Nach dem Deploy, in der Sitzung des Owners:

```js
(() => { const h = document.getElementById("garetien-alle").getBoundingClientRect().left;
  const z = document.querySelector("#garetien-list .avm-row > input[type=checkbox]");
  return { listenkopf: h, zeile: z ? z.getBoundingClientRect().left : null,
    fussKnoepfe: [...document.querySelectorAll("#garetien-importer .gi-foot > .btn, #garetien-importer .gi-foot__main > .btn")].map((b) => b.textContent.trim()) }; })()
```

Erwartet: `listenkopf` und `zeile` höchstens ein Gerätepixel auseinander; `fussKnoepfe` ohne „Alle wählen".

- [ ] **Schritt 6: Committen**

```bash
git status
git add js/review/review-garetien-importer.js
git add index.html
git add css/components/garetien-importer.css
git add docs/garetien-import-vereint-mockup.html
git add js/review/__tests__/garetien-listkopf.test.js
git add js/review/__tests__/garetien-anzeige-menge.test.js
git add js/review/__tests__/garetien-vokabular.test.js
git add js/review/__tests__/garetien-auswahlleiste.test.js
git add js/review/__tests__/garetien-auswahlleiste-folgt.test.js
git add js/review/__tests__/garetien-zentrieren-und-reiter.test.js
git add js/review/__tests__/garetien-liste-zeile.test.js
git commit -F- <<'EOF'
ui(garetien-importer): "Alle wählen" wird das Haekchen "alle n" im Listenkopf, und jede Zeile traegt vorn ihr Ziel

Die Fussleiste gehoert jetzt ausnahmslos der ganzen Stage: Stage leeren,
Alle zentrieren, Stage importieren. "Alle wählen" steht als Haekchen ueber der
Liste, waehlt auf jedem Reiter dieselbe Menge wie vorher, loest sie mit einem
zweiten Klick wieder (nur die Zeilen dieser Liste) und zeigt "teilweise",
sobald ein einzelner Zeilenhaken fehlt. Rechts daneben: "n von m" bzw.
"n auf der Stage · k Objekte".

Auf der Stage traegt jede Zeile vorn ihr Ziel (garetienStageZeile2, bis hierher
ohne Aufrufer), auf "Offen" die aufgelegten Zeilen "auf der Stage".

Das Mockup bindet Ziel-Marke und Listenkopf per Vertragsmarke. Das Haekchen
fluchtet mit den Zeilenhaekchen: die Liste steht in .avm-scroll, das Mockup
ohne -- ausgeglichen in einer freien Regel (gemessen 9,33 px -> 0,67).

Damit ist der Abschnitt "NEU" des Mockups ganz gebaut: sein Kopf und die
Uebersicht in Abschnitt 8 sagen jetzt "gebaut in Aufgabe N".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git log -1 --format=%B
```

🔧 **DU:** Auf „Offen" das Häkchen „alle n" über der Liste anklicken — alle Zeilen haken sich an; einen Zeilenhaken abnehmen → das Kopfhäkchen steht auf „teilweise"; noch einmal klicken → alle wieder an, dann ab. Die Fußleiste trägt kein „Alle wählen" mehr. Ein Objekt auflegen: auf „Offen" steht in seiner Zeile vorn „auf der Stage", auf „Stage" sein Ziel in Braun. Auf „Übernommen" wählt „alle n" dieselben Zeilen wie früher „Alle wählen". Hell und dunkel.

---


---

## Aufgabe 13: Der Bestand — Wiki-Schlüssel an importierten Flächen nachziehen (Admin-Lauf mit Trockenlauf)

**Deckt Entwurf §7a ab.** Innenumbau — wirkt erst, wenn der Owner den Lauf fährt.

- 🔴 **Kein zweiter Schreibweg.** Geschrieben wird je Region über `avesmapsAssignEcosystemWikiRegion` (`api/_internal/app/ecosystem.php` :2627) — denselben Hausschreiber wie der Panel-Knopf „Fläche zuweisen". Er leitet `wiki_region_key` aus der ADRESSE ab (:2642–2643), schreibt die Protokollzeile `assign_wiki_region` (:2698), führt den Durchtrag an die Beschriftungen (:2716–2718) und läuft in seiner eigenen Transaktion (:2683), den Ensure davor (:2631). ⚠️ `avesmapsUpdateEcosystemRegion` (:3226) ist nicht die Tür: ein Teil-Update mit Auto-Name-, Feldherkunft-, Kurven-, Zeiger- und Art-Nebenwegen (:3238–3348) — für ein reines Zuweisen der falsche Erzeuger.
- 💣 **Die Adresse muss DENSELBEN Schlüssel ergeben, den die Beschriftung trägt.** Sonst vergleicht der Durchtrag (:3812) ungleich und schreibt der Beschriftung ein NEUES Nest — aus dem Staging unter dem abgeleiteten Schlüssel oder als nacktes `{wiki_key, wiki_url}` (:3737). Aus dem Nachzug würde eine stille Umzuweisung. Solche Regionen werden nicht angeboten (`adresse_passt_nicht`), ebenso Adressen, die `avesmapsNormalizeOptionalUrl` ablehnt (`api/_internal/bootstrap.php` :368).
- 💣 **Die Bibliothek öffnet keine Transaktion und ruft keinen Ensure-Helfer.** Der Trockenlauf darf in keine Tabelle schreiben, und `avesmapsEcosystemEnsureTables` sät Artzeilen (`avesmapsEcosystemSeedRegionTypes`, ecosystem.php :1084). Im scharfen Lauf macht der Hausschreiber den Ensure selbst, VOR seiner Transaktion (MySQL: DDL = impliziter COMMIT, AGENTS.md §11). SQLite kennt den impliziten COMMIT nicht — Abschnitt G des Tests prüft das deshalb am Quelltext.
- ⚠️ **Abweichung vom Auftrag „map_revision genau einmal am Ende": KEIN eigener Stempel.** Der Hausschreiber hebt je Region `ecosystem_revision` Zeile 1 UND 2 (`avesmapsNextEcosystemRevision`, :1327, `$mapPayloadChanged = true`). Zeile 2 steckt über `avesmapsClimateReadStamp` (`api/_internal/app/climate-membership.php` :373) im ETag der Kartennutzlast (`api/app/map-features.php` :285), Zeile 1 im ETag der Flächen (`api/app/ecosystem-areas.php`), aus dem der Prüfhaken `area.wiki_region_key` liest (`js/map-features/wiki-zuweisung.js` :22). `map_revision` hebt er absichtlich nicht (Kopf :2624: „must never reach avesmapsNextMapRevision()"); nur der Durchtrag tut es, und nur, wenn er wirklich eine Beschriftung schreibt. Ein zusätzlicher `map_revision`-Stempel wäre ein Stempel ohne Schreibvorgang auf `map_features`.
- 🔴 **Welche Regionen:** Vermerke aller `sync_plan_item` mit `sync_plan_run.kind = 'garetien'`, `change_type = 'new'`, `apply_state = 'done'`, über ALLE Läufe; gelesen nur über `avesmapsGaretienVermerkLesen` (`api/_internal/import/garetien-uebernahme.php` :610) — nackte `public_id`, `area:… | region:…`, `… | verbund:…`. „Ziel Fläche" entscheidet der Nachschlag in `ecosystem_region`, nicht `after_json.ziel`: die Formwahl beim Import kann den Vorschlag geändert haben. Ein Vermerk ohne Region (Ort, Weg, Gipfel, `nur_quelle:`) zählt als `andere_ziele`.
- ⚠️ **Die Bestands-SQL aus Aufgabe 2 zählt nur nackte Vermerke** (`r.public_id IN (SELECT i.apply_note …)`) und ist damit nur eine Untergrenze. Schritt 6 bringt die Abfrage für alle Formen.
- 🔴 **Nie überschreiben, nie Zurückgenommenes.** `region_inaktiv` · `schon_gesetzt` · `anderer_schluessel` (Region und Beschriftung nennen verschiedene Artikel — benannt in `widersprueche`, nie angefasst) · `beschriftung_fehlt` · `beschriftung_ohne_wiki` · `adresse_passt_nicht`. 🪤 Unmittelbar vor dem Schreiben wird die Region neu gelesen: der Hausschreiber fragt nicht, ob inzwischen ein Editor zugewiesen hat (`inzwischen_erledigt`). Das Fenster dazwischen ist Millisekunden breit, nicht null (Klasse „read-then-write", Entwurf §6.9).
- ⚠️ **Nur Admins, zweimal.** Der Endpunkt nennt `wiki_nachzug` im engen Riegel (`api/edit/map/garetien-import.php` :81) — der eine `avesmapsRequireUserWithCapability`-Aufruf bleibt (`garetien-endpunkt-test.php` :74). Die Bibliothek prüft `avesmapsUserCan($user, 'admin')` selbst, damit ein künftiger Aufrufer die Regel erbt. `auth.php` lädt sie per `require_once`; der Endpunkt lädt `auth.php` vorher blank — die sichere Reihenfolge.
- 💣 **Fremder Test:** `garetien-endpunkt-test.php` :179 verbot das WORT `'apply'`, gemeint war die Übernahme-TÜR. `$payload['apply']` ist der Schalter aller Bestandsläufe (`repair_geometry_bounds`, `takeover_label_sources`, `verteile_wegquellen`); ein anderer Name in EINEM von vier wäre die Falle beim Tippen. Präzisiert, und enger als vorher (keine Aktion `apply`, kein `avesmapsGaretienApplyStep(`, `'apply'` genau einmal und nur im Zweig `wiki_nachzug`). Ohne 3c fällt der Test dort (gesehen).
- ⚠️ **Rücknahme je Region** über das Fenster „Änderungen" (Landschaften), keine Sammelgeste. 💣 Das Protokoll kappt je Person (`avesmapsPruneActorAcrossAuditLogs`, ecosystem.php :2023, Grenze `AVESMAPS_AUDIT_KEEP_PER_ACTOR` in `api/_internal/audit-prune.php`): ein Lauf über mehr Regionen als diese Grenze verdrängt die ältesten Protokollzeilen des Owners — auch frühere Handarbeit — und macht sie unumkehrbar.
- ⚠️ **Kein Kanon-Etikett an Flächen:** der Kanon-Leser kennt `ecosystem` nicht (AGENTS.md §11). Die Stichprobe in Schritt 6 prüft Prüfhaken und Statuskreis.
- ⚠️ Fehlertexte: eine `InvalidArgumentException` des Hausschreibers (benennt das Feld) geht in die Antwort, jeder andere Fehler nur ins Protokoll (AGENTS.md §10, M1). Der Lauf geht mit der nächsten Region weiter.

**Dateien:**
- Neu: `api/_internal/import/garetien-wiki-nachzug.php`
- Neu: `api/_internal/import/__tests__/garetien-wiki-nachzug-test.php`
- Ändern: `api/edit/map/garetien-import.php` (require ~:22, enger Admin-Riegel ~:81, Zweig nach `runs` ~:118)
- Ändern (fremder Test): `api/_internal/import/__tests__/garetien-endpunkt-test.php` (~:179)

**Schnittstellen:**
- Nutzt: `avesmapsAssignEcosystemWikiRegion(PDO $pdo, array $payload, int $userId): array` (Rumpf `region_public_ids`, `wiki_url`, `dry_run: false`, `confirm: 'apply'`) · `avesmapsGaretienVermerkLesen(string $note): array{area,region,verbund}` · `avesmapsEcosystemWikiRegionKey(string $wikiUrl): ?string` · `avesmapsNormalizeOptionalUrl(?string $value, int $maxLength, string $fieldLabel): string` · `avesmapsUserCan(array $user, string $capability): bool` · `AVESMAPS_GARETIEN_PLAN_KIND`. Im Test zusätzlich `avesmapsGaretienUebernehmen`, `avesmapsSyncPlanStartRun`, `avesmapsEnsureSyncPlanTablesSqlite`, `avesmapsWikiSyncCreateMatchKey` — und Aufgabe 2 (der Test verlangt, dass ein NEUER Import den Schlüssel an der Region trägt).
- Liefert:
  - `avesmapsGaretienWikiNachzug(PDO $pdo, array $user, bool $trockenlauf = true, int $deckel = AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL, int $abId = 0): array` — Antwort: `dry_run`, `vermerke`, `andere_ziele`, `geprueft`, `wuerde_setzen`, `uebersprungen` (alle sechs Gründe, auch mit 0), `stichprobe` (≤ 20: `region_id`, `public_id`, `name`, `wiki_key`, `wiki_url`), `widersprueche` (≤ 20: `region_id`, `public_id`, `name`, `region_schluessel`, `beschriftung_schluessel`), `ab_id`, `deckel`, `gesetzt`, `inzwischen_erledigt`, `fehler` (`region_id`, `public_id`, `name`, `grund`), `cursor` (?int), `remaining`
  - `avesmapsGaretienWikiNachzugUrteil(array $region, ?array $label): array{grund:string, wiki_key:string, wiki_url:string}` (rein)
  - `avesmapsGaretienWikiNachzugVermerkRegionen(PDO $pdo): list<string>` · `avesmapsGaretienWikiNachzugZeilenJe(PDO $pdo, string $sql, array $ids): array`
  - Konstanten `AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL = 200`, `…_DECKEL_MAX = 1000`, `…_STICHPROBE = 20`, `…_IN_BLOCK = 500`, `…_GRUENDE`
  - Endpunkt-Aktion `wiki_nachzug` an `POST /api/edit/map/garetien-import.php` (Rumpf: `apply` — nur Boolean `true` ist scharf —, `limit`, `ab_id`), nur `admin`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `api/_internal/import/__tests__/garetien-wiki-nachzug-test.php`:

```php
<?php

declare(strict_types=1);

// Aufgabe 13 des Bauplans „Garetien-Importer vereint" (14.09.2026): DER BESTAND.
// Den Wiki-Schluessel an Flaechen nachziehen, die ein Garetien-Import angelegt hat, BEVOR Aufgabe 2
// ihn selbst an die Region schrieb. Owner 14.09.2026: „ja, wiki-schluessel nachziehen mit trockenlauf".
//
// 🔴 DER TEST FUEHRT DEN LAUF AUS -- gegen einen Bestand, der mit der ECHTEN Uebernahme angelegt und
// danach auf den Stand vor Aufgabe 2 zurueckgedreht wird (Region ohne Schluessel, Beschriftung mit).
// So traegt die Beschriftung genau das Nest, das avesmapsWikiRegionBuildAssignObject baut, und keine
// Handattrappe davon.
//
// ⚠️ SQLite kennt EINE MySQL-Eigenschaft nicht, an der dieser Lauf haengt: DDL beendet in MySQL eine
// offene Transaktion mit einem impliziten COMMIT. Dass der Lauf weder eine Transaktion oeffnet noch
// einen Ensure-Helfer ruft, prueft deshalb Abschnitt G am QUELLTEXT, nicht der Ablauf.
//
// Lauf aus dem Repo-Wurzelverzeichnis:
//   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll api/_internal/import/__tests__/garetien-wiki-nachzug-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../garetien-wiki-nachzug.php';

// Minimaler SQLite-Pruefstand -- dieselbe Uebersetzungs-Naht wie garetien-verbund-uebernahme-test.php,
// gekuerzt auf das, was dieser Ablauf anfasst (keine Artikelquellen, also keine sources-Upserts).
final class AvesmapsGaretienWikiNachzugTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        foreach (['map_revision', 'ecosystem_revision'] as $tabelle) {
            if (str_contains($statement, 'INTO ' . $tabelle) && str_contains($statement, 'ON DUPLICATE KEY UPDATE')) {
                // ⚠️ MEHRZEILIG uebersetzt, nicht auf Zeile 1 verkuerzt: avesmapsNextEcosystemRevision hebt
                // Zeile 1 UND Zeile 2 (`VALUES (1, 2), (2, 2)`), und Zeile 2 ist die, die das ETag der
                // Kartennutzlast liest (avesmapsClimateReadStamp). Abschnitt D prueft genau sie.
                $statement = str_replace(
                    'ON DUPLICATE KEY UPDATE revision = revision + 1',
                    'ON CONFLICT(id) DO UPDATE SET revision = ' . $tabelle . '.revision + 1',
                    $statement
                );
            }
        }
        if (str_contains($statement, 'AUTO_INCREMENT')
            || str_contains($statement, 'ENGINE=InnoDB')
            || str_starts_with(ltrim($statement), 'ALTER TABLE')) {
            return 0;
        }

        return parent::exec(str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $statement));
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false
    {
        if (str_contains($query, 'information_schema')) {
            return parent::query('SELECT 1 AS ok');
        }

        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$args);
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'information_schema')) {
            preg_match_all('~:[a-zA-Z_][a-zA-Z0-9_]*~', $query, $treffer);
            $namen = array_unique($treffer[0]);
            $ersatz = $namen === [] ? 'SELECT 1 AS ok'
                : 'SELECT 1 AS ok WHERE ' . implode(' IS NOT NULL AND ', $namen) . ' IS NOT NULL';

            return parent::prepare($ersatz);
        }
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        $query = str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query);
        $query = str_replace("ESCAPE '\\\\'", "ESCAPE '\\'", $query);
        if (str_contains($query, 'INSERT INTO app_setting') && str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $query = 'INSERT INTO app_setting (setting_key, setting_value) VALUES (:k, :v)
                      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value';
        }

        return parent::prepare($query, $options);
    }
}

function avesmapsGaretienWikiNachzugTestPdo(): PDO
{
    $pdo = new AvesmapsGaretienWikiNachzugTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT, feature_subtype TEXT,
        name TEXT, geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL, sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 1, created_by INTEGER NULL, updated_by INTEGER NULL)');
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');
    $pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL,
        action TEXT, actor_user_id INTEGER NULL, before_json TEXT, after_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, undone_at TEXT NULL, undone_by INTEGER NULL,
        undone_by_log_id INTEGER NULL, operation_id TEXT NULL, operation_label TEXT NULL)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT,
        kind TEXT, region_type TEXT, origin TEXT DEFAULT \'own\', wiki_region_key TEXT, wiki_url TEXT,
        label_public_id TEXT, properties_json TEXT, stack_order INTEGER DEFAULT 0, is_locked INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1, created_by INTEGER NULL, updated_by INTEGER NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, region_id INTEGER,
        geometry_geojson TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, geometry_revision INTEGER DEFAULT 1,
        is_trial INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_by INTEGER NULL, updated_by INTEGER NULL,
        terrain_grain REAL NULL, terrain_levels INTEGER NULL, terrain_avg_height REAL NULL, terrain_mean_height REAL NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    $pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT,
        sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, affects_paths INTEGER DEFAULT 1,
        offroad_factor REAL DEFAULT 1.0, terrain_speed_factor REAL NULL, terrain_grain REAL NULL,
        terrain_levels INTEGER NULL, terrain_avg_height REAL NULL, terrain_mean_height REAL NULL,
        PRIMARY KEY (kind, type_key))');
    $pdo->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE ecosystem_geometry_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT, actor_user_id INTEGER NULL, area_public_id TEXT NULL, region_public_id TEXT NULL,
        before_json TEXT, after_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        undone_at TEXT NULL, undone_by INTEGER NULL, undone_by_log_id INTEGER NULL, operation_id TEXT NULL, operation_label TEXT NULL)');
    $pdo->exec("INSERT INTO ecosystem_region_type (kind, type_key, label) VALUES ('vegetation', 'wald', 'Wald')");
    $pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT UNIQUE,
        wiki_key TEXT NULL, label TEXT, source_type TEXT, is_official INTEGER DEFAULT 0, created_by INTEGER NULL,
        license TEXT NOT NULL DEFAULT \'\', attribution TEXT NOT NULL DEFAULT \'\',
        own_fields TEXT NOT NULL DEFAULT \'\', created_at TEXT DEFAULT "2026-01-01")');
    $pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
        entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT DEFAULT 'approved',
        created_by INTEGER NULL, origin TEXT DEFAULT 'manual', reference_kind TEXT NULL, pages TEXT NULL,
        note TEXT NULL, created_at TEXT NOT NULL DEFAULT \"2026-01-01 00:00:00\",
        UNIQUE(entity_type, entity_public_id, source_id))");
    // ⚠️ Nur die Spalten, die avesmapsGaretienWikiLandschaftVorschlag/-Zuweisung lesen.
    $pdo->exec('CREATE TABLE wiki_region_staging (wiki_key TEXT PRIMARY KEY, title TEXT, name TEXT, match_key TEXT,
        art TEXT, wiki_url TEXT, continent TEXT, region_parent TEXT, synonyms_json TEXT, neighbors_json TEXT)');
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    return $pdo;
}

/** Der GANZE Inhalt aller Tabellen -- „schreibt in keine Tabelle" wird gemessen, nicht an einer Liste. */
function avesmapsGaretienWikiNachzugTestStand(PDO $pdo): string
{
    $stand = [];
    $tabellen = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        ->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tabellen as $tabelle) {
        $stand[$tabelle] = $pdo->query('SELECT * FROM "' . $tabelle . '" ORDER BY rowid')->fetchAll(PDO::FETCH_ASSOC);
    }

    return (string) json_encode($stand, JSON_UNESCAPED_UNICODE);
}

/** Ein Artikel im Wiki-Staging; die Adresse traegt dieselbe Seite, aus der der Schluessel folgt. */
function avesmapsGaretienWikiNachzugTestArtikel(PDO $pdo, string $name): string
{
    $url = 'https://de.wiki-aventurica.de/wiki/' . str_replace(' ', '_', $name);
    $pdo->prepare('INSERT INTO wiki_region_staging (wiki_key, title, name, match_key, art, wiki_url) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([avesmapsEcosystemWikiRegionKey($url), $name, $name, avesmapsWikiSyncCreateMatchKey($name), 'Wald', $url]);

    return $url;
}

/**
 * Ein Flaechen-Item anlegen UND mit der echten Uebernahme importieren.
 *
 * @return array{item:int, region:string, region_id:int, area:string, label:string}
 */
function avesmapsGaretienWikiNachzugTestImport(PDO $pdo, int $runId, string $name, int $nr, array $rumpf = []): array
{
    $o = 20.0 + $nr * 40.0;
    $ring = [[$o, $o], [$o + 20, $o], [$o + 20, $o + 20], [$o, $o + 20], [$o, $o]];
    $pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, before_json, after_json, override_json, selected)
                   VALUES (?, ?, NULL, 'new', ?, NULL, ?, NULL, 1)")
        ->execute([
            $runId,
            'ggp:Waelder:Wald:#' . $nr,
            $name,
            json_encode([
                'herkunft' => 'garetien', 'ziel' => 'region', 'kind' => 'vegetation', 'subtyp' => 'wald',
                'name' => $name, 'geometry' => ['type' => 'Polygon', 'coordinates' => [$ring]],
            ], JSON_UNESCAPED_UNICODE),
        ]);
    $item = (int) $pdo->lastInsertId();
    $ergebnis = avesmapsGaretienUebernehmen($pdo, $runId, [$item], ['id' => 7], null, [$item => $rumpf]);
    assert($ergebnis['fehler'] === [], "Aufbau: {$name} legt an: " . json_encode($ergebnis['fehler'], JSON_UNESCAPED_UNICODE));

    $vermerk = avesmapsGaretienVermerkLesen((string) $pdo->query('SELECT apply_note FROM sync_plan_item WHERE id = ' . $item)->fetchColumn());
    $region = avesmapsGaretienWikiNachzugTestRegion($pdo, $vermerk['region']);

    return [
        'item' => $item,
        'region' => $vermerk['region'],
        'region_id' => (int) $region['id'],
        'area' => $vermerk['area'],
        'label' => (string) $region['label_public_id'],
    ];
}

function avesmapsGaretienWikiNachzugTestRegion(PDO $pdo, string $publicId): array
{
    $stmt = $pdo->prepare('SELECT * FROM ecosystem_region WHERE public_id = ?');
    $stmt->execute([$publicId]);
    $zeile = $stmt->fetch(PDO::FETCH_ASSOC);
    assert(is_array($zeile), 'Aufbau: Region ' . $publicId . ' existiert');

    return $zeile;
}

function avesmapsGaretienWikiNachzugTestLabelJson(PDO $pdo, string $publicId): string
{
    $stmt = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = ?');
    $stmt->execute([$publicId]);

    return (string) $stmt->fetchColumn();
}

function avesmapsGaretienWikiNachzugTestZahl(PDO $pdo, string $sql): int
{
    return (int) $pdo->query($sql)->fetchColumn();
}

// =================================================================================================
// A. DER BESTAND -- mit der echten Uebernahme angelegt, dann auf den Stand VOR Aufgabe 2 gedreht
// =================================================================================================
$admin = ['id' => 7, 'role' => 'admin'];
$pdo = avesmapsGaretienWikiNachzugTestPdo();
$run = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 7, 'bestand');
$urls = [];
foreach (['Silker Hain', 'Tannwald', 'Muehlwald', 'Grenzforst', 'Schattenwald', 'Eichenhain', 'Birkenwald',
    'Fichtenwald', 'Erlenwald', 'Kiefernwald', 'Handwald'] as $artikel) {
    $urls[$artikel] = avesmapsGaretienWikiNachzugTestArtikel($pdo, $artikel);
}
// ⚠️ „Nirgendwald" steht bewusst NICHT im Staging: seine Beschriftung bekommt keinen Treffer.

$a = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Silker Hain', 1);
$b = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Tannwald', 2);
$c = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Muehlwald', 3);
$v1 = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Grenzforst 1', 4, ['verbund' => 'Grenzforst']);
$v2 = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Grenzforst 2', 5, ['verbund' => 'Grenzforst']);
$inaktiv = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Schattenwald', 6);
$schon = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Eichenhain', 7);
$anders = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Birkenwald', 8);
$ohneWiki = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Nirgendwald', 9);
$ohneLabel = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Fichtenwald', 10);
$falscheAdresse = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Erlenwald', 11);
$f = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Kiefernwald', 12);
$hand = avesmapsGaretienWikiNachzugTestImport($pdo, $run, 'Handwald', 13);

// Vorbedingungen: Aufgabe 2 ist gebaut (Schluessel an der Region), der Verbund ist EINE Region.
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $schon['region'])['wiki_region_key'] === 'eichenhain',
    'A (Vorbedingung): ein NEUER Import traegt den Schluessel an der Region -- Aufgabe 2 ist gebaut');
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $ohneWiki['region'])['wiki_region_key'] === null,
    'A (Vorbedingung): ohne Treffer kein Schluessel');
assert($v1['region'] === $v2['region'] && $v2['label'] === $v1['label'], 'A (Vorbedingung): der Verbund ist EINE Region mit EINER Beschriftung');

// Der Stand VOR Aufgabe 2: Region leer, Beschriftung traegt ihr Nest weiter.
$zurueck = $pdo->prepare('UPDATE ecosystem_region SET wiki_url = NULL, wiki_region_key = NULL WHERE public_id = ?');
foreach ([$a, $b, $c, $v1, $inaktiv, $ohneLabel, $falscheAdresse, $f, $hand] as $objekt) {
    $zurueck->execute([$objekt['region']]);
}
// Die drei Vermerkformen, die im Bestand vorkommen: nackt (A), `area:… | region:…` OHNE `verbund:` (B),
// und die heutige Form `area:… | region:… | verbund:…` (C leer, Verbund mit Stamm).
$pdo->prepare('UPDATE sync_plan_item SET apply_note = ? WHERE id = ?')->execute([$a['region'], $a['item']]);
$pdo->prepare('UPDATE sync_plan_item SET apply_note = ? WHERE id = ?')
    ->execute(['area:' . $b['area'] . ' | region:' . $b['region'], $b['item']]);
// Die Uebersprung-Faelle.
$pdo->prepare('UPDATE ecosystem_region SET is_active = 0 WHERE public_id = ?')->execute([$inaktiv['region']]);
$andereUrl = 'https://de.wiki-aventurica.de/wiki/Anderer_Forst';
$pdo->prepare('UPDATE ecosystem_region SET wiki_url = ?, wiki_region_key = ? WHERE public_id = ?')
    ->execute([$andereUrl, avesmapsEcosystemWikiRegionKey($andereUrl), $anders['region']]);
$pdo->prepare('UPDATE map_features SET is_active = 0 WHERE public_id = ?')->execute([$ohneLabel['label']]);
$props = json_decode(avesmapsGaretienWikiNachzugTestLabelJson($pdo, $falscheAdresse['label']), true);
$props['wiki_region']['wiki_url'] = 'https://de.wiki-aventurica.de/wiki/Ganz_Anders';
$pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')
    ->execute([json_encode($props, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $falscheAdresse['label']]);

// 🔴 FREMDE DATENKLASSEN, die NIE mitgezaehlt werden duerfen -- alle zeigen auf „Handwald", eine
// aktive Region mit leerem Schluessel und Beschriftung MIT Treffer. Zaehlte eine davon mit, stiege
// `wuerde_setzen` von 5 auf 6.
// (1) Die Region selbst traegt keinen Garetien-Vermerk mehr (von Hand gezeichnet oder zurueckgenommen).
$pdo->prepare('UPDATE sync_plan_item SET apply_state = NULL, apply_note = NULL WHERE id = ?')->execute([$hand['item']]);
// (2) Eine ERGAENZUNG ('changed') an ihr -- die Region hat der Import nicht angelegt.
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label, after_json, selected, apply_state, apply_note)
               VALUES (?, 'ggp:Waelder:Wald:#90', ?, 'changed', 'Handwald', '{}', 1, 'done', ?)")
    ->execute([$run, $hand['region'], $hand['region']]);
// (3) Ein uebernommenes 'new' einer FREMDEN Vorschau-Art.
$pdo->exec("INSERT INTO sync_plan_run (kind, state) VALUES ('citymap', 'open')");
$fremderLauf = (int) $pdo->lastInsertId();
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, after_json, selected, apply_state, apply_note)
               VALUES (?, 'karte:1', 'new', 'Karte', '{}', 1, 'done', ?)")
    ->execute([$fremderLauf, $hand['region']]);
// (4) Ein uebernommenes 'new' dieses Imports, dessen Vermerk auf KEINE Region zeigt (Gipfel, Ort, Weg).
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, after_json, selected, apply_state, apply_note)
               VALUES (?, 'ggp:Berge:Berggipfel:#91', 'new', 'Hoher Stein', '{}', 1, 'done', ?)")
    ->execute([$run, $hand['label']]);
// (5) Eine ABGELEHNTE Zeile -- nie uebernommen, Entscheidung dauerhaft.
$pdo->prepare("INSERT INTO sync_plan_item (run_id, entity_key, change_type, label, after_json, selected)
               VALUES (?, 'ggp:Waelder:Wald:#14', 'new', 'Ablehnwald', '{}', 0)")
    ->execute([$run]);
$abgelehnt = (int) $pdo->lastInsertId();
$pdo->prepare("INSERT INTO sync_decision (kind, entity_key, change_type, declined_at) VALUES (?, 'ggp:Waelder:Wald:#14', 'new', '2026-09-01 10:00:00')")
    ->execute([AVESMAPS_GARETIEN_PLAN_KIND]);

echo "OK -- garetien-wiki-nachzug: Bestand aufgebaut\n";

// =================================================================================================
// B. DER TROCKENLAUF IST DIE VORGABE -- er zaehlt, nennt Gruende, zeigt eine Stichprobe, schreibt nichts
// =================================================================================================
$standVorher = avesmapsGaretienWikiNachzugTestStand($pdo);
$t1 = avesmapsGaretienWikiNachzug($pdo, $admin);
assert(avesmapsGaretienWikiNachzugTestStand($pdo) === $standVorher, 'B: der Trockenlauf schreibt in KEINE Tabelle');
assert($t1['dry_run'] === true, 'B: ohne Angabe ist es ein Trockenlauf');
assert($t1['vermerke'] === 13, 'B: 13 uebernommene Neu-Zeilen dieses Imports mit Vermerk, bekommen: ' . $t1['vermerke']);
assert($t1['andere_ziele'] === 1, 'B: EIN Vermerk zeigt auf keine Region (der Gipfel), bekommen: ' . $t1['andere_ziele']);
assert($t1['geprueft'] === 11, 'B: 11 verschiedene Regionen -- der Verbund zaehlt EINMAL, bekommen: ' . $t1['geprueft']);
assert($t1['wuerde_setzen'] === 5, 'B: fuenf Kandidaten (nackt, ohne verbund:, heutige Form, Verbund, Kiefernwald), bekommen: '
    . $t1['wuerde_setzen']);
assert($t1['uebersprungen'] === [
    'region_inaktiv' => 1, 'schon_gesetzt' => 1, 'anderer_schluessel' => 1,
    'beschriftung_fehlt' => 1, 'beschriftung_ohne_wiki' => 1, 'adresse_passt_nicht' => 1,
], 'B: je Grund genau eine Region: ' . json_encode($t1['uebersprungen']));
assert($t1['wuerde_setzen'] + array_sum($t1['uebersprungen']) === $t1['geprueft'],
    'B: jede gepruefte Region hat GENAU ein Urteil -- keine faellt durch');
assert(array_column($t1['stichprobe'], 'name') === ['Silker Hain', 'Tannwald', 'Muehlwald', 'Grenzforst', 'Kiefernwald'],
    'B: die Stichprobe nennt die Kandidaten nach Region-id: ' . json_encode(array_column($t1['stichprobe'], 'name'), JSON_UNESCAPED_UNICODE));
assert($t1['stichprobe'][0]['region_id'] === $a['region_id'] && $t1['stichprobe'][0]['wiki_key'] === 'silker-hain'
    && $t1['stichprobe'][0]['wiki_url'] === $urls['Silker Hain'],
    'B: eine Stichprobenzeile traegt Region-id, Schluessel und Adresse: ' . json_encode($t1['stichprobe'][0], JSON_UNESCAPED_UNICODE));
assert(count($t1['widersprueche']) === 1 && $t1['widersprueche'][0]['name'] === 'Birkenwald'
    && $t1['widersprueche'][0]['region_schluessel'] === 'anderer-forst'
    && $t1['widersprueche'][0]['beschriftung_schluessel'] === 'birkenwald',
    'B: der Widerspruch wird BENANNT, nicht nur gezaehlt: ' . json_encode($t1['widersprueche'], JSON_UNESCAPED_UNICODE));
assert($t1['gesetzt'] === 0 && $t1['fehler'] === [] && $t1['cursor'] === null && $t1['remaining'] === 5,
    'B: ein Trockenlauf setzt nichts, und `remaining` nennt, was ein scharfer Lauf vor sich haette');
$t1ab = avesmapsGaretienWikiNachzug($pdo, $admin, true, 200, $c['region_id']);
assert($t1ab['remaining'] === 2 && array_column($t1ab['stichprobe'], 'name') === ['Grenzforst', 'Kiefernwald'],
    'B: `ab_id` verschiebt Stichprobe und Rest, nie die Zaehlung: ' . json_encode($t1ab['stichprobe'], JSON_UNESCAPED_UNICODE));
assert($t1ab['wuerde_setzen'] === 5, 'B: die Zaehlung bleibt die ganze');
assert(avesmapsGaretienWikiNachzugTestStand($pdo) === $standVorher, 'B: auch der Trockenlauf mit `ab_id` schreibt nichts');

// Das Urteil ist REIN -- zwei Grenzfaelle ohne Datenbank.
$regionOhne = ['is_active' => 1, 'wiki_region_key' => null];
$regionMit = ['is_active' => 1, 'wiki_region_key' => 'eichenhain'];
$labelOhneNest = ['is_active' => 1, 'feature_type' => 'label', 'properties_json' => '{}'];
$labelFtp = ['is_active' => 1, 'feature_type' => 'label',
    'properties_json' => json_encode(['wiki_region' => ['wiki_key' => 'x', 'wiki_url' => 'ftp://de.wiki-aventurica.de/wiki/X']])];
assert(avesmapsGaretienWikiNachzugUrteil($regionMit, $labelOhneNest)['grund'] === 'schon_gesetzt',
    'B: Region mit Schluessel, Beschriftung ohne -- die Region ist fertig, nichts zu setzen');
assert(avesmapsGaretienWikiNachzugUrteil($regionOhne, $labelFtp)['grund'] === 'adresse_passt_nicht',
    'B: eine Adresse, die der Hausschreiber ablehnen wuerde, wird gar nicht erst angeboten');
assert(avesmapsGaretienWikiNachzugUrteil($regionOhne, null)['grund'] === 'beschriftung_fehlt', 'B: ohne Beschriftung nichts');

echo "OK -- garetien-wiki-nachzug: Trockenlauf\n";

// =================================================================================================
// C. NUR ADMINS -- auch der Trockenlauf, und ohne einen Schreibvorgang
// =================================================================================================
foreach ([['id' => 8, 'role' => 'editor'], ['id' => 9, 'role' => 'reviewer'], ['id' => 10]] as $wer) {
    foreach ([true, false] as $trocken) {
        $abgewiesen = false;
        try {
            avesmapsGaretienWikiNachzug($pdo, $wer, $trocken);
        } catch (RuntimeException $abbruch) {
            $abgewiesen = str_contains($abbruch->getMessage(), 'Administratoren');
        }
        assert($abgewiesen, 'C: ' . json_encode($wer) . ' wird abgewiesen (' . ($trocken ? 'Trockenlauf' : 'scharf') . ')');
    }
}
assert(avesmapsGaretienWikiNachzugTestStand($pdo) === $standVorher, 'C: die Abweisung hat nichts geschrieben');

echo "OK -- garetien-wiki-nachzug: Admin-Riegel der Bibliothek\n";

// =================================================================================================
// D. SCHARF, BLOCKWEISE -- je Region der Hausschreiber, nie ueberschreiben, Fehler gemeldet
// =================================================================================================
$mapRevisionVorher = avesmapsGaretienWikiNachzugTestZahl($pdo, 'SELECT revision FROM map_revision WHERE id = 1');
$ecoZeile2Vorher = avesmapsGaretienWikiNachzugTestZahl($pdo, 'SELECT revision FROM ecosystem_revision WHERE id = 2');
$itemsVorher = json_encode($pdo->query('SELECT * FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
$entscheidungVorher = json_encode($pdo->query('SELECT * FROM sync_decision')->fetchAll(PDO::FETCH_ASSOC));
$labelsVorher = [];
foreach (['a' => $a, 'b' => $b, 'c' => $c, 'v' => $v1, 'f' => $f] as $k => $objekt) {
    $labelsVorher[$k] = avesmapsGaretienWikiNachzugTestLabelJson($pdo, $objekt['label']);
}
$unberuehrtVorher = [];
foreach ([$inaktiv, $schon, $anders, $ohneWiki, $ohneLabel, $falscheAdresse, $hand] as $objekt) {
    $unberuehrtVorher[$objekt['region']] = avesmapsGaretienWikiNachzugTestRegion($pdo, $objekt['region']);
}

// 🪤 Ein Editor weist „Tannwald" zu, WAEHREND der Lauf „Silker Hain" schreibt -- nachgestellt ueber einen
// Trigger. Der Lauf muss das beim Schreiben von Tannwald sehen und stehen lassen.
$pdo->exec("CREATE TRIGGER wiki_nachzug_test_nachbar AFTER UPDATE OF wiki_url ON ecosystem_region
    WHEN NEW.public_id = '{$a['region']}'
    BEGIN
        UPDATE ecosystem_region SET wiki_url = 'https://de.wiki-aventurica.de/wiki/Fremder_Hain', wiki_region_key = 'fremder-hain'
         WHERE public_id = '{$b['region']}';
    END");
$s1 = avesmapsGaretienWikiNachzug($pdo, $admin, false, 2);
$pdo->exec('DROP TRIGGER wiki_nachzug_test_nachbar');
assert($s1['dry_run'] === false, 'D: `false` ist scharf');
assert($s1['gesetzt'] === 1 && $s1['inzwischen_erledigt'] === 1 && $s1['fehler'] === [],
    'D: Block 1 setzt Silker Hain, laesst Tannwald stehen: ' . json_encode($s1, JSON_UNESCAPED_UNICODE));
assert($s1['cursor'] === $b['region_id'] && $s1['remaining'] === 3,
    'D: Deckel 2 -- der Cursor steht hinter dem zweiten Kandidaten, drei bleiben: ' . json_encode([$s1['cursor'], $s1['remaining']]));
$regionA = avesmapsGaretienWikiNachzugTestRegion($pdo, $a['region']);
assert($regionA['wiki_url'] === $urls['Silker Hain'] && $regionA['wiki_region_key'] === 'silker-hain',
    'D: die Region traegt Adresse UND abgeleiteten Schluessel: ' . json_encode($regionA, JSON_UNESCAPED_UNICODE));
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $b['region'])['wiki_region_key'] === 'fremder-hain',
    'D: 🔴 der Schluessel, den ein Editor inzwischen gesetzt hat, wird NIE ueberschrieben');
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $c['region'])['wiki_region_key'] === null,
    'D: was hinter dem Deckel liegt, bleibt fuer den naechsten Block');
assert(avesmapsGaretienWikiNachzugTestZahl($pdo, 'SELECT revision FROM ecosystem_revision WHERE id = 2') > $ecoZeile2Vorher,
    'D: der Hausschreiber stempelt die Landschaften-Revision -- Zeile 2 ist die, die das ETag der Kartennutzlast liest');

// Block 2, fortgesetzt hinter dem Cursor -- und „Kiefernwald" scheitert in der Datenbank.
$pdo->exec("CREATE TRIGGER wiki_nachzug_test_abbruch BEFORE UPDATE OF wiki_url ON ecosystem_region
    WHEN NEW.public_id = '{$f['region']}'
    BEGIN SELECT RAISE(ABORT, 'Testabbruch'); END");
$logDatei = (string) tempnam(sys_get_temp_dir(), 'gwn');
$logVorher = ini_set('error_log', $logDatei);
$s2 = avesmapsGaretienWikiNachzug($pdo, $admin, false, 200, (int) $s1['cursor']);
ini_set('error_log', (string) $logVorher);
assert($s2['gesetzt'] === 2 && $s2['inzwischen_erledigt'] === 0,
    'D: Block 2 setzt Muehlwald und den Verbund -- der Fehler haelt den Lauf nicht an: ' . json_encode($s2, JSON_UNESCAPED_UNICODE));
assert(count($s2['fehler']) === 1 && $s2['fehler'][0]['region_id'] === $f['region_id'] && $s2['fehler'][0]['name'] === 'Kiefernwald',
    'D: der Fehlschlag wird MIT Namen gemeldet: ' . json_encode($s2['fehler'], JSON_UNESCAPED_UNICODE));
assert(!str_contains($s2['fehler'][0]['grund'], 'Testabbruch'),
    'D: ein Datenbanktext geht nicht in die Antwort (AGENTS.md §10, M1)');
assert(str_contains((string) file_get_contents($logDatei), 'Testabbruch'), 'D: ... sondern ins Protokoll -- gemeldet, nicht geschluckt');
@unlink($logDatei);
assert($pdo->inTransaction() === false, 'D: nach dem Fehlschlag steht keine Transaktion offen');
assert($s2['cursor'] === $f['region_id'] && $s2['remaining'] === 0, 'D: der Block lief bis zum Ende');
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $v1['region'])['wiki_region_key'] === 'grenzforst',
    'D: der Verbund bekommt seinen Schluessel EINMAL, an seiner einen Region');
assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $f['region'])['wiki_region_key'] === null,
    'D: die gescheiterte Region bleibt leer -- ihre Transaktion ist zurueckgerollt');
$pdo->exec('DROP TRIGGER wiki_nachzug_test_abbruch');

echo "OK -- garetien-wiki-nachzug: scharf, blockweise\n";

// =================================================================================================
// E. WIEDERHOLBAR -- der zweite Lauf findet nur, was scheiterte, der dritte nichts
// =================================================================================================
$t2 = avesmapsGaretienWikiNachzug($pdo, $admin);
assert($t2['wuerde_setzen'] === 1 && array_column($t2['stichprobe'], 'name') === ['Kiefernwald'],
    'E: der naechste Trockenlauf findet genau die gescheiterte Region: ' . json_encode($t2['stichprobe'], JSON_UNESCAPED_UNICODE));
assert($t2['uebersprungen']['schon_gesetzt'] === 4 && $t2['uebersprungen']['anderer_schluessel'] === 2,
    'E: die gesetzten zaehlen jetzt als fertig, Tannwald als Widerspruch: ' . json_encode($t2['uebersprungen']));
$s3 = avesmapsGaretienWikiNachzug($pdo, $admin, false);
assert($s3['gesetzt'] === 1 && $s3['fehler'] === [] && $s3['remaining'] === 0, 'E: die Wiederholung setzt sie');
$t3 = avesmapsGaretienWikiNachzug($pdo, $admin);
assert($t3['wuerde_setzen'] === 0 && $t3['remaining'] === 0 && $t3['stichprobe'] === [],
    'E: danach findet der Trockenlauf NICHTS mehr: ' . json_encode($t3, JSON_UNESCAPED_UNICODE));
$standLeer = avesmapsGaretienWikiNachzugTestStand($pdo);
$s4 = avesmapsGaretienWikiNachzug($pdo, $admin, false);
assert($s4['gesetzt'] === 0 && $s4['cursor'] === null && $s4['remaining'] === 0, 'E: ein scharfer Lauf ohne Kandidaten tut nichts');
assert(avesmapsGaretienWikiNachzugTestStand($pdo) === $standLeer, 'E: ... und schreibt nichts, auch keinen Stempel');

// Was der ganze Lauf NICHT angefasst hat.
assert(avesmapsGaretienWikiNachzugTestZahl($pdo, 'SELECT revision FROM map_revision WHERE id = 1') === $mapRevisionVorher,
    'E: 🔴 KEIN Stempel auf die Kartenrevision -- die Beschriftungen trugen ihren Schluessel schon, der Durchtrag schrieb nichts');
foreach (['a' => $a, 'b' => $b, 'c' => $c, 'v' => $v1, 'f' => $f] as $k => $objekt) {
    assert(avesmapsGaretienWikiNachzugTestLabelJson($pdo, $objekt['label']) === $labelsVorher[$k],
        "E: die Beschriftung ({$k}) bleibt Byte fuer Byte, wie sie war");
}
foreach ($unberuehrtVorher as $publicId => $zeile) {
    assert(avesmapsGaretienWikiNachzugTestRegion($pdo, $publicId) === $zeile,
        'E: eine uebersprungene oder fremde Region bleibt unberuehrt: ' . $zeile['name']);
}
assert(json_encode($pdo->query('SELECT * FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC)) === $itemsVorher,
    'E: 🔴 keine Migration -- kein Vermerk, kein Zustand, keine Zeile der Vorschau veraendert');
assert(json_encode($pdo->query('SELECT * FROM sync_decision')->fetchAll(PDO::FETCH_ASSOC)) === $entscheidungVorher,
    'E: die Ablehnung steht unveraendert');
assert((int) $pdo->query('SELECT selected FROM sync_plan_item WHERE id = ' . $abgelehnt)->fetchColumn() === 0,
    'E: die abgelehnte Zeile bleibt abgehakt');
$protokoll = $pdo->query("SELECT region_public_id FROM ecosystem_geometry_audit_log WHERE action = 'assign_wiki_region' ORDER BY id")
    ->fetchAll(PDO::FETCH_COLUMN);
assert($protokoll === [$a['region'], $c['region'], $v1['region'], $f['region']],
    'E: je gesetzter Region GENAU eine Protokollzeile des Hausschreibers (im Fenster „Aenderungen" zuruecknehmbar): '
    . json_encode($protokoll));

echo "OK -- garetien-wiki-nachzug: wiederholbar\n";

// =================================================================================================
// G. AM QUELLTEXT -- was SQLite nicht zeigen kann, und die Tuer
// =================================================================================================
$nurCode = static function (string $php): string {
    $stuecke = [];
    foreach (token_get_all($php) as $token) {
        if (is_array($token)) {
            if (!in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                $stuecke[] = $token[1];
            }
            continue;
        }
        $stuecke[] = $token;
    }

    return implode('', $stuecke);
};
$bibliothek = $nurCode(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../garetien-wiki-nachzug.php')));
assert(str_contains($bibliothek, 'avesmapsAssignEcosystemWikiRegion('), 'G: geschrieben wird ueber den Hausschreiber');
foreach (['beginTransaction', 'commit(', 'rollBack(', 'EnsureTables', 'EnsureSyncPlanTables', 'CREATE TABLE', 'avesmapsNextMapRevision(', 'avesmapsNextEcosystemRevision('] as $verboten) {
    assert(stripos($bibliothek, $verboten) === false,
        "G: 💣 die Bibliothek enthaelt kein `{$verboten}` -- Transaktion, DDL und Stempel gehoeren dem Hausschreiber "
        . '(in MySQL beendet DDL eine offene Transaktion mit implizitem COMMIT, SQLite zeigt das nie)');
}
assert(preg_match('~\bUPDATE\s~i', $bibliothek) !== 1, 'G: kein eigenes UPDATE -- kein zweiter Schreibweg fuer den Schluessel einer Region');

$endpunkt = $nurCode(str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../../../edit/map/garetien-import.php')));
assert(preg_match('~require_once[^;]*import/garetien-wiki-nachzug\.php~', $endpunkt) === 1, 'G: der Endpunkt laedt die Bibliothek mit require_once');
$adminListe = [];
if (preg_match('~in_array\(\$action,\s*\[([^\]]*)\],\s*true\)~', $endpunkt, $treffer) === 1) {
    $adminListe = array_map(static fn (string $t): string => trim($t, " '\"\n\t"), explode(',', $treffer[1]));
}
assert(in_array('wiki_nachzug', $adminListe, true),
    'G: 🔴 `wiki_nachzug` steht im ENGEN Admin-Riegel des Endpunkts -- ein Editor bekommt 403: ' . implode(', ', $adminListe));
$zweigAb = strpos($endpunkt, "\$action === 'wiki_nachzug'");
assert($zweigAb !== false, 'G: der Endpunkt hat den Zweig');
assert($zweigAb > (int) strpos($endpunkt, 'avesmapsCreatePdo('), 'G: der Zweig steht hinter dem Datenbankaufbau');
$naechsterZweig = strpos($endpunkt, "\$action === ", $zweigAb + 20);
$zweig = substr($endpunkt, $zweigAb, $naechsterZweig === false ? null : $naechsterZweig - $zweigAb);
assert(str_contains($zweig, "(\$payload['apply'] ?? false) === true"), 'G: scharf NUR mit dem Boolean `apply: true`');
assert(str_contains($zweig, 'avesmapsGaretienWikiNachzug(') && str_contains($zweig, '!$scharf'),
    'G: der Zweig reicht den Trockenlauf als Vorgabe durch');

echo "OK -- garetien-wiki-nachzug (Aufgabe 13, Bestand)\n";
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll api/_internal/import/__tests__/garetien-wiki-nachzug-test.php
```
Erwartet (gesehen): `PHP Warning:  require_once(…\api\_internal\import\__tests__/../garetien-wiki-nachzug.php): Failed to open stream: No such file or directory` und `PHP Fatal error:  Uncaught Error: Failed opening required '…/garetien-wiki-nachzug.php'`, Exit-Code 255.

- [ ] **Schritt 3: Umsetzen**

**3a.** Neue Datei `api/_internal/import/garetien-wiki-nachzug.php`:

```php
<?php

declare(strict_types=1);

// DER BESTAND: den Wiki-Schluessel an Flaechen nachziehen, die ein Garetien-Import angelegt hat, BEVOR
// die Uebernahme ihn selbst an die Region schrieb (Aufgabe 2 des Bauplans vom 14.09.2026).
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §7a.
// Owner 14.09.2026: „ja, wiki-schluessel nachziehen mit trockenlauf".
//
// 🔴 DER BEFUND: bis Aufgabe 2 landete der Wiki-Treffer eines Imports nur an der BESCHRIFTUNG
// (`properties.wiki_region`), die REGION blieb leer (`ecosystem_region.wiki_url`/`wiki_region_key`
// = NULL). Der Pruefhaken „Keine Wiki-Zuweisung" und der Statuskreis lesen die Flaeche -- fuer sie sind
// diese Landschaften unzugewiesen, die neu importierten daneben zugewiesen. Der Durchtrag des Hauses
// wandert nur ABWAERTS (Flaeche -> Beschriftung, avesmapsEcosystemPushWikiRegionToLabels) und heilt das
// nie von selbst.
//
// 🔴 KEIN ZWEITER SCHREIBWEG. Geschrieben wird ueber avesmapsAssignEcosystemWikiRegion -- denselben
// Hausschreiber wie der Panel-Knopf „Flaeche zuweisen". Er leitet den Schluessel aus der ADRESSE ab (nie
// aus einem hier gebauten Schluessel), schreibt die Protokollzeile `assign_wiki_region` (im Fenster
// „Aenderungen" je Flaeche zuruecknehmbar), fuehrt den Durchtrag an die Beschriftungen, stempelt die
// Landschaften-Revision -- und jede Region laeuft in SEINER eigenen Transaktion.
//
// 💣 DIESE DATEI OEFFNET KEINE TRANSAKTION UND RUFT KEINEN ENSURE-HELFER. Der Trockenlauf darf in keine
// Tabelle schreiben, und avesmapsEcosystemEnsureTables saet Artzeilen nach
// (avesmapsEcosystemSeedRegionTypes). Den Ensure macht im scharfen Lauf der Hausschreiber selbst, VOR
// seiner Transaktion -- in MySQL beendet DDL eine offene Transaktion mit einem impliziten COMMIT
// (AGENTS.md §11, der Sammel-Umzug der Beschriftungsquellen). Festgenagelt am Quelltext in
// garetien-wiki-nachzug-test.php, Abschnitt G, weil SQLite den impliziten COMMIT nicht kennt.
//
// ⚠️ KEIN EIGENER STEMPEL, AUCH NICHT AM ENDE. Der Hausschreiber hebt je Region `ecosystem_revision`
// Zeile 1 UND 2 (avesmapsNextEcosystemRevision, `$mapPayloadChanged = true`); Zeile 2 steckt ueber
// avesmapsClimateReadStamp im ETag der Kartennutzlast (api/app/map-features.php), Zeile 1 im ETag der
// Flaechen (api/app/ecosystem-areas.php). `map_revision` hebt er NICHT, und das mit Absicht (Kopf von
// avesmapsAssignEcosystemWikiRegion: „must never reach avesmapsNextMapRevision()") -- nur der Durchtrag
// tut es, und nur, wenn er wirklich eine Beschriftung schreibt. Ein zusaetzlicher map_revision-Stempel
// hier waere ein Stempel ohne Schreibvorgang auf map_features und entwertete die ~21 MB fuer nichts.
//
// 🔴 DER IMPORTER IST EIN GERUEST (Abbau-Vertrag, garetien-abbau-waechter-test.php). Diese Datei liegt
// deshalb unter api/_internal/import/ und verschwindet mit ihm. Sie liest sync_plan_*, ecosystem_region
// und map_features -- keine garetien_import-Tabelle.

require_once __DIR__ . '/garetien-uebernahme.php';
// ⚠️ avesmapsUserCan wohnt in auth.php. Der Endpunkt laedt auth.php BLANK in seiner ersten Zeile und
// diese Datei danach -- `require_once` erkennt die schon geladene Datei und laedt nichts zweimal. Die
// Falle waere die UMGEKEHRTE Reihenfolge (erst require_once, danach ein blankes require: „Cannot
// redeclare", 500 mit leerem Rumpf).
require_once __DIR__ . '/../auth.php';

/** Wie viele Regionen ein scharfer Lauf hoechstens anfasst, wenn der Aufrufer nichts sagt. */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL = 200;
/** Die harte Obergrenze je Aufruf -- ein `limit: 100000` aus der Konsole bleibt ein Block. */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL_MAX = 1000;
/** Wie viele Zeilen Stichprobe und Widersprueche hoechstens zeigen. Die ZAEHLUNG ist davon unberuehrt. */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_STICHPROBE = 20;
/** Wie viele public_ids eine IN-Liste hoechstens traegt. */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_IN_BLOCK = 500;
/**
 * Die Gruende, aus denen eine Region NICHT gesetzt wird -- in der Reihenfolge, in der das Urteil sie
 * prueft. Die Antwort traegt sie immer vollstaendig, auch mit 0: eine fehlende Zeile laese sich wie
 * „diesen Fall gibt es nicht".
 */
const AVESMAPS_GARETIEN_WIKI_NACHZUG_GRUENDE = [
    'region_inaktiv',
    'schon_gesetzt',
    'anderer_schluessel',
    'beschriftung_fehlt',
    'beschriftung_ohne_wiki',
    'adresse_passt_nicht',
];

/**
 * Das Urteil ueber EINE Region -- REIN, ohne Datenbank.
 *
 * 🔴 NIE UEBERSCHREIBEN. Traegt die Region schon einen Schluessel, ist sie fertig (`schon_gesetzt`) --
 * oder sie widerspricht ihrer Beschriftung (`anderer_schluessel`). Beides fasst dieser Lauf nicht an:
 * welcher von zwei Artikeln gilt, entscheidet ein Mensch.
 * 🔴 ZURUECKGENOMMEN ODER GELOESCHT HEISST NIE: eine inaktive Region wird nicht beschrieben.
 * 💣 DIE ADRESSE MUSS DENSELBEN SCHLUESSEL ERGEBEN, DEN DIE BESCHRIFTUNG TRAEGT. Der Hausschreiber leitet
 * den Schluessel der Region aus der Adresse ab, und sein Durchtrag vergleicht ihn danach mit der
 * Beschriftung: waeren sie verschieden, schriebe er der Beschriftung ein NEUES Nest -- gebaut aus dem
 * Staging unter dem abgeleiteten Schluessel oder, wenn es den dort nicht gibt, als nacktes
 * `{wiki_key, wiki_url}`. Aus einem Nachzug wuerde eine stille Umzuweisung. Deshalb wird eine solche
 * Region gar nicht erst angeboten (`adresse_passt_nicht`), ebenso eine Adresse, die der Hausschreiber
 * ablehnen wuerde (avesmapsNormalizeOptionalUrl: nur http/https).
 *
 * @param array $region Zeile aus ecosystem_region (mindestens is_active, wiki_region_key).
 * @param ?array $label Die gebundene Beschriftung (map_features-Zeile) oder null.
 * @return array{grund:string, wiki_key:string, wiki_url:string}
 */
function avesmapsGaretienWikiNachzugUrteil(array $region, ?array $label): array
{
    $raus = ['grund' => '', 'wiki_key' => '', 'wiki_url' => ''];
    if ((int) ($region['is_active'] ?? 0) !== 1) {
        $raus['grund'] = 'region_inaktiv';
        return $raus;
    }

    $labelAktiv = is_array($label)
        && (int) ($label['is_active'] ?? 0) === 1
        && (string) ($label['feature_type'] ?? '') === 'label';
    $nest = [];
    if ($labelAktiv) {
        $properties = json_decode((string) ($label['properties_json'] ?? ''), true);
        $nest = is_array($properties) && is_array($properties['wiki_region'] ?? null) ? $properties['wiki_region'] : [];
    }
    $labelSchluessel = trim((string) ($nest['wiki_key'] ?? ''));
    $raus['wiki_key'] = $labelSchluessel;

    if (trim((string) ($region['wiki_region_key'] ?? '')) !== '') {
        $raus['grund'] = ($labelSchluessel !== '' && $labelSchluessel !== trim((string) $region['wiki_region_key']))
            ? 'anderer_schluessel'
            : 'schon_gesetzt';
        return $raus;
    }
    if (!$labelAktiv) {
        $raus['grund'] = 'beschriftung_fehlt';
        return $raus;
    }
    if ($labelSchluessel === '') {
        $raus['grund'] = 'beschriftung_ohne_wiki';
        return $raus;
    }

    try {
        $adresse = avesmapsNormalizeOptionalUrl((string) ($nest['wiki_url'] ?? ''), 500, 'wiki_url');
    } catch (InvalidArgumentException) {
        $adresse = '';
    }
    if ($adresse === '' || avesmapsEcosystemWikiRegionKey($adresse) !== $labelSchluessel) {
        $raus['grund'] = 'adresse_passt_nicht';
        return $raus;
    }

    $raus['grund'] = 'setzen';
    $raus['wiki_url'] = $adresse;

    return $raus;
}

/**
 * Die Region hinter JEDEM uebernommenen Neu-Vermerk dieses Imports, ueber ALLE Laeufe.
 *
 * 🔴 ALLE VERMERKFORMEN, UND NUR UEBER DEN EINEN LESER: eine nackte public_id (der Live-Stand), `area:… |
 * region:…` ohne `verbund:` und `area:… | region:… | verbund:…` -- avesmapsGaretienVermerkLesen kennt
 * alle drei. Ein eigener Zerleger hier waere der vierte Leser desselben Formats.
 * 🔴 NUR `change_type = 'new'`: eine Ergaenzung ('changed') haengt eine Quelle an eine Region, die der
 * Import NICHT angelegt hat; ihr Schluessel gehoert dem, der sie gezeichnet hat.
 * ⚠️ Eine zurueckgenommene Zeile ist hier nicht mehr zu sehen (die Ruecknahme setzt apply_state und
 * apply_note auf NULL), eine abgelehnte war nie `done`.
 * ⚠️ Auch ein Vermerk eines Orts, Wegs oder Gipfels liefert eine „Region" -- die public_id seines
 * Kartenobjekts. Welche davon wirklich eine Landschaftsregion ist, entscheidet erst der Nachschlag.
 *
 * @return list<string> je Vermerk die gelesene Region ('' ohne)
 */
function avesmapsGaretienWikiNachzugVermerkRegionen(PDO $pdo): array
{
    $stmt = $pdo->prepare(
        "SELECT i.apply_note FROM sync_plan_item i
           JOIN sync_plan_run r ON r.id = i.run_id
          WHERE r.kind = :k AND i.change_type = 'new' AND i.apply_state = 'done'
            AND i.apply_note IS NOT NULL AND i.apply_note <> ''
          ORDER BY i.id ASC"
    );
    $stmt->execute(['k' => AVESMAPS_GARETIEN_PLAN_KIND]);

    $raus = [];
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) ?: [] as $vermerk) {
        $raus[] = avesmapsGaretienVermerkLesen((string) $vermerk)['region'];
    }

    return $raus;
}

/**
 * Zeilen je public_id, in IN-Bloecken.
 *
 * ⚠️ `{ids}` ist KEIN PDO-Platzhalter, sondern die Stelle, an der die `?`-Liste eingesetzt wird.
 * 💣 Die Schluessel werden ausdruecklich zu Strings: eine public_id aus Ziffern wuerde als Array-Schluessel
 * sonst zur Zahl, und ein `===` gegen den Vermerk fiele durch.
 *
 * @param list<string> $ids
 * @return array<string, array>
 */
function avesmapsGaretienWikiNachzugZeilenJe(PDO $pdo, string $sql, array $ids): array
{
    $raus = [];
    $eindeutig = array_values(array_unique(array_filter(array_map('strval', $ids), static fn (string $id): bool => $id !== '')));
    foreach (array_chunk($eindeutig, AVESMAPS_GARETIEN_WIKI_NACHZUG_IN_BLOCK) as $block) {
        $stmt = $pdo->prepare(str_replace('{ids}', implode(', ', array_fill(0, count($block), '?')), $sql));
        $stmt->execute($block);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
            $raus[(string) $zeile['public_id']] = $zeile;
        }
    }

    return $raus;
}

/**
 * Der Lauf. Trockenlauf ist die VORGABE.
 *
 * Trockenlauf: zaehlt ueber den GANZEN Bestand, nennt je Grund, zeigt Stichprobe und Widersprueche,
 * schreibt in keine Tabelle. Scharf: nimmt die Kandidaten mit Region-id groesser `$abId` in
 * aufsteigender Reihenfolge, hoechstens `$deckel`, und reicht jede einzeln an den Hausschreiber.
 *
 * 🔴 DIE ZAEHLUNG IST IMMER DIE GANZE, `$abId` VERSCHIEBT NUR STICHPROBE, BLOCK UND `remaining` -- sonst
 * saehe man bei einer Fortsetzung eine kleinere Zahl und hielte sie fuer den Bestand.
 * 🔴 WIEDERHOLBAR: ein gesetzter Kandidat ist beim naechsten Lauf `schon_gesetzt`. Ein gescheiterter
 * bleibt Kandidat -- ein zweiter Trockenlauf ab 0 findet genau ihn.
 * 🪤 UNMITTELBAR VOR DEM SCHREIBEN WIRD DIE REGION NEU GELESEN. Zwischen Befund und Schreiben kann ein
 * Editor sie zugewiesen oder geloescht haben, und der Hausschreiber fragt das nicht -- er schriebe seine
 * Adresse ueber die des Editors. Ein solcher Fall zaehlt als `inzwischen_erledigt`. ⚠️ Das Fenster
 * dazwischen ist nicht null (read-then-write, dieselbe Klasse wie Entwurf §6.9), nur Millisekunden breit.
 *
 * @param array $user Der angemeldete Benutzer. 🔴 Nur `admin` -- auch fuer den Trockenlauf.
 * @return array<string, mixed>
 */
function avesmapsGaretienWikiNachzug(
    PDO $pdo,
    array $user,
    bool $trockenlauf = true,
    int $deckel = AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL,
    int $abId = 0
): array {
    // 🔴 DER RIEGEL STEHT AUCH HIER, nicht nur am Endpunkt: ein kuenftiger zweiter Aufrufer erbt ihn,
    // statt ihn vergessen zu koennen.
    if (!avesmapsUserCan($user, 'admin')) {
        throw new RuntimeException('Das Nachziehen der Wiki-Schluessel ist Administratoren vorbehalten.');
    }
    $deckel = $deckel > 0 ? min(AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL_MAX, $deckel) : AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL;
    $abId = max(0, $abId);
    $userId = (int) ($user['id'] ?? 0);

    $vermerkRegionen = avesmapsGaretienWikiNachzugVermerkRegionen($pdo);
    $regionen = avesmapsGaretienWikiNachzugZeilenJe(
        $pdo,
        'SELECT id, public_id, name, is_active, wiki_region_key, wiki_url, label_public_id
           FROM ecosystem_region WHERE public_id IN ({ids})',
        $vermerkRegionen
    );
    $andereZiele = 0;
    foreach ($vermerkRegionen as $regionId) {
        if (!isset($regionen[$regionId])) {
            $andereZiele++;
        }
    }
    uasort($regionen, static fn (array $x, array $y): int => (int) $x['id'] <=> (int) $y['id']);

    $labels = avesmapsGaretienWikiNachzugZeilenJe(
        $pdo,
        "SELECT public_id, feature_type, is_active, properties_json
           FROM map_features WHERE feature_type = 'label' AND public_id IN ({ids})",
        array_map(static fn (array $r): string => (string) ($r['label_public_id'] ?? ''), $regionen)
    );

    $uebersprungen = array_fill_keys(AVESMAPS_GARETIEN_WIKI_NACHZUG_GRUENDE, 0);
    $kandidaten = [];
    $widersprueche = [];
    foreach ($regionen as $region) {
        $label = $labels[(string) ($region['label_public_id'] ?? '')] ?? null;
        $urteil = avesmapsGaretienWikiNachzugUrteil($region, $label);
        if ($urteil['grund'] === 'setzen') {
            $kandidaten[] = [
                'region_id' => (int) $region['id'],
                'public_id' => (string) $region['public_id'],
                'name' => (string) $region['name'],
                'wiki_key' => $urteil['wiki_key'],
                'wiki_url' => $urteil['wiki_url'],
            ];
            continue;
        }
        $uebersprungen[$urteil['grund']]++;
        if ($urteil['grund'] === 'anderer_schluessel' && count($widersprueche) < AVESMAPS_GARETIEN_WIKI_NACHZUG_STICHPROBE) {
            $widersprueche[] = [
                'region_id' => (int) $region['id'],
                'public_id' => (string) $region['public_id'],
                'name' => (string) $region['name'],
                'region_schluessel' => (string) $region['wiki_region_key'],
                'beschriftung_schluessel' => $urteil['wiki_key'],
            ];
        }
    }

    $offen = array_values(array_filter($kandidaten, static fn (array $k): bool => $k['region_id'] > $abId));
    $ergebnis = [
        'dry_run' => $trockenlauf,
        'vermerke' => count($vermerkRegionen),
        'andere_ziele' => $andereZiele,
        'geprueft' => count($regionen),
        'wuerde_setzen' => count($kandidaten),
        'uebersprungen' => $uebersprungen,
        'stichprobe' => array_slice($offen, 0, AVESMAPS_GARETIEN_WIKI_NACHZUG_STICHPROBE),
        'widersprueche' => $widersprueche,
        'ab_id' => $abId,
        'deckel' => $deckel,
        'gesetzt' => 0,
        'inzwischen_erledigt' => 0,
        'fehler' => [],
        'cursor' => null,
        'remaining' => count($offen),
    ];
    if ($trockenlauf) {
        return $ergebnis;
    }

    $block = array_slice($offen, 0, $deckel);
    foreach ($block as $kandidat) {
        $ergebnis['cursor'] = $kandidat['region_id'];
        try {
            $jetzt = avesmapsGaretienWikiNachzugZeilenJe(
                $pdo,
                'SELECT public_id, is_active, wiki_region_key FROM ecosystem_region WHERE public_id IN ({ids})',
                [$kandidat['public_id']]
            )[$kandidat['public_id']] ?? null;
            if (!is_array($jetzt) || (int) $jetzt['is_active'] !== 1 || trim((string) ($jetzt['wiki_region_key'] ?? '')) !== '') {
                $ergebnis['inzwischen_erledigt']++;
                continue;
            }
            // Dieselben ZWEI Signale wie der Panel-Knopf (avesmapsEcosystemAssignIsDryRun): der
            // Hausschreiber geht nur mit `dry_run === false` UND `confirm === 'apply'` scharf.
            avesmapsAssignEcosystemWikiRegion($pdo, [
                'region_public_ids' => [$kandidat['public_id']],
                'wiki_url' => $kandidat['wiki_url'],
                'dry_run' => false,
                'confirm' => 'apply',
            ], $userId);
            $ergebnis['gesetzt']++;
        } catch (InvalidArgumentException $abbruch) {
            // Eigene Pruefung des Hausschreibers, benennt das Feld -- darf nach draussen.
            $ergebnis['fehler'][] = [
                'region_id' => $kandidat['region_id'],
                'public_id' => $kandidat['public_id'],
                'name' => $kandidat['name'],
                'grund' => mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8'),
            ];
        } catch (Throwable $abbruch) {
            // 🔴 Gemeldet, nicht geschluckt -- aber der Datenbanktext geht ins Protokoll, nicht in die
            // Antwort (AGENTS.md §10, Meilenstein M1). Der Lauf geht mit der naechsten Region weiter.
            error_log('garetien-wiki-nachzug: Region ' . $kandidat['public_id'] . ': ' . $abbruch->getMessage());
            $ergebnis['fehler'][] = [
                'region_id' => $kandidat['region_id'],
                'public_id' => $kandidat['public_id'],
                'name' => $kandidat['name'],
                'grund' => 'Die Region konnte nicht geschrieben werden (Einzelheiten im Fehlerprotokoll).',
            ];
        }
    }
    $ergebnis['remaining'] = count($offen) - count($block);

    return $ergebnis;
}
```

**3b.** In `api/edit/map/garetien-import.php` drei Stellen ersetzen.

Das `require` — alt:

```php
require_once __DIR__ . '/../../_internal/import/garetien-wiki-landschaft.php';
```

neu:

```php
require_once __DIR__ . '/../../_internal/import/garetien-wiki-landschaft.php';
// Aufgabe 13 (14.09.2026): der Bestandslauf `wiki_nachzug` -- nur Admins, siehe den Zweig unten.
require_once __DIR__ . '/../../_internal/import/garetien-wiki-nachzug.php';
```

Der enge Admin-Riegel (~:81) — alt:

```php
    if (in_array($action, ['ebenen', 'probe', 'fetch', 'upload', 'plan'], true)
```

neu:

```php
    // 🔴 `wiki_nachzug` (Aufgabe 13, 14.09.2026) gehoert dazu: er schreibt den Wiki-Schluessel an
    // Regionen des ganzen Garetien-Bestands, die niemand gerade vor sich hat -- und schon sein
    // Trockenlauf zeigt Befunde ueber den ganzen Bestand. Die Bibliothek prueft `admin` ein zweites Mal.
    if (in_array($action, ['ebenen', 'probe', 'fetch', 'upload', 'plan', 'wiki_nachzug'], true)
```

Der Zweig, direkt hinter `runs` (~:118) — alt:

```php
    if ($action === 'runs') {
        avesmapsJsonResponse(200, ['ok' => true, 'runs' => avesmapsGaretienListeLaeufe($pdo)]);
    }
```

neu:

```php
    if ($action === 'runs') {
        avesmapsJsonResponse(200, ['ok' => true, 'runs' => avesmapsGaretienListeLaeufe($pdo)]);
    }

    // --- Aufgabe 13 (Owner 14.09.2026: „ja, wiki-schluessel nachziehen mit trockenlauf"): DER BESTAND.
    // Flaechen, die ein Import VOR Aufgabe 2 angelegt hat, tragen den Wiki-Treffer nur an der
    // Beschriftung; dieser Lauf schreibt ihn ueber den Hausschreiber an die Region
    // (avesmapsGaretienWikiNachzug, api/_internal/import/garetien-wiki-nachzug.php).
    // 🔴 NUR ADMINS -- der enge Riegel oben nennt `wiki_nachzug`.
    // 🔴 TROCKENLAUF IST DIE VORGABE; scharf NUR mit dem Boolean `apply: true` (dieselbe Bauform wie
    // repair_geometry_bounds und takeover_label_sources -- der String "true" bleibt ein Trockenlauf).
    // `limit` deckelt den Block (Vorgabe 200, hoechstens 1000), `ab_id` setzt hinter dem `cursor` der
    // letzten Antwort fort.
    // ⚠️ Keine Oberflaeche: gefahren wird aus der Browser-Konsole (Bauplan Aufgabe 13, Schritt 6).
    if ($action === 'wiki_nachzug') {
        $scharf = ($payload['apply'] ?? false) === true;
        avesmapsJsonResponse(200, ['ok' => true] + avesmapsGaretienWikiNachzug(
            $pdo,
            $user,
            !$scharf,
            (int) ($payload['limit'] ?? AVESMAPS_GARETIEN_WIKI_NACHZUG_DECKEL),
            (int) ($payload['ab_id'] ?? 0)
        ));
    }
```

⚠️ Der Zweig steht bewusst NICHT direkt hinter `liste`: `garetien-endpunkt-test.php` misst den `liste`-Zweig bis zum nächsten `$action === ` (:305–316).

**3c.** In `api/_internal/import/__tests__/garetien-endpunkt-test.php` (~:179) den Tür-Wächter präzisieren — alt:

```php
assert(!str_contains($quelle, "'apply'"), 'der Import-Endpunkt hat keine eigene Uebernahme-Tuer');
```

neu:

```php
// 🔴 PRAEZISIERT 14.09.2026 (Bauplan Aufgabe 13): die Zeile pruefte bis dahin das WORT `'apply'`,
// gemeint war die TUER. Der Bestandslauf `wiki_nachzug` liest `$payload['apply']` als Schalter
// „scharf" -- dieselbe Bauform wie repair_geometry_bounds, takeover_label_sources und
// verteile_wegquellen; ein anderer Schaltername in EINEM von vier Bestandslaeufen waere die Falle beim
// Tippen in der Konsole. Die Tuer bleibt verboten, und enger als vorher: keine Aktion `apply`, kein
// Aufruf des Uebernahme-Schrittes, und `'apply'` steht GENAU EINMAL da -- im Zweig `wiki_nachzug`.
assert(preg_match("~\\\$action\\s*===\\s*'apply'~", $quelle) !== 1, 'der Import-Endpunkt hat keine eigene Uebernahme-Tuer');
assert(!str_contains($quelle, 'avesmapsGaretienApplyStep('), 'und ruft den Uebernahme-Schritt nicht selbst');
assert(substr_count($quelle, "'apply'") === 1,
    "'apply' steht genau EINMAL im Endpunkt, als Schalter des Bestandslaufs -- gezaehlt: " . substr_count($quelle, "'apply'"));
$wikiNachzugAb = strpos($quelle, "\$action === 'wiki_nachzug'");
$wikiNachzugBis = $wikiNachzugAb === false ? false : strpos($quelle, "\$action === ", $wikiNachzugAb + 20);
$applyPos = strpos($quelle, "\$payload['apply']");
assert($wikiNachzugAb !== false && $applyPos !== false && $applyPos > $wikiNachzugAb
    && ($wikiNachzugBis === false || $applyPos < $wikiNachzugBis),
    "... und zwar als \$payload['apply'] INNERHALB des Zweigs `wiki_nachzug`");
```

(Ohne 3c fällt `garetien-endpunkt-test.php` nach 3b mit `AssertionError: der Import-Endpunkt hat keine eigene Uebernahme-Tuer` an :179 — gesehen.)

- [ ] **Schritt 4: Test fahren, grün sehen — und das PHP-Feld**

```bash
P="php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll"
$P api/_internal/import/__tests__/garetien-wiki-nachzug-test.php
for t in garetien-endpunkt-test garetien-abbau-waechter-test garetien-verbund-uebernahme-test; do $P api/_internal/import/__tests__/$t.php 2>&1 | tail -1; done
```
Erwartet (gesehen):
```
OK -- garetien-wiki-nachzug: Bestand aufgebaut
OK -- garetien-wiki-nachzug: Trockenlauf
OK -- garetien-wiki-nachzug: Admin-Riegel der Bibliothek
OK -- garetien-wiki-nachzug: scharf, blockweise
OK -- garetien-wiki-nachzug: wiederholbar
OK -- garetien-wiki-nachzug (Aufgabe 13, Bestand)
OK: garetien-endpunkt-test
OK: garetien_import steht in 15 Dateien, alle innerhalb von api/_internal/import/.
OK -- garetien-verbund-bestand (Owner 14.09.2026)
```

Dann das ganze PHP-Feld, mit Gegenzählung:
```bash
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > rot-feld.txt; cat rot-feld.txt
```
Erwartet (gesehen auf Zweigstand `9fccacfbc` + Aufgabe 2 + diese Aufgabe): **408** Dateien, einzige Zeile `ROT: api/_internal/linkcheck/__tests__/link-url-test.php` (vorbestehend, DNS). ⚠️ Die Zahl wächst mit jeder Aufgabe davor — maßgeblich ist der eigene Zähllauf.

- [ ] **Schritt 5: Committen**

```bash
git status --short
git add api/_internal/import/garetien-wiki-nachzug.php
git add api/_internal/import/__tests__/garetien-wiki-nachzug-test.php
git add api/edit/map/garetien-import.php
git add api/_internal/import/__tests__/garetien-endpunkt-test.php
git commit -F- <<'EOF'
feat(garetien): Bestandslauf zieht den Wiki-Schluessel an importierte Flaechen nach

Bis Aufgabe 2 landete der Wiki-Treffer eines Garetien-Imports nur an der
Beschriftung; die Region blieb ohne Schluessel, und Pruefhaken wie Statuskreis
lesen die Flaeche. Die Admin-Aktion `wiki_nachzug` am Import-Endpunkt zieht ihn
nach: Trockenlauf als Vorgabe (zaehlt je Grund, Stichprobe, schreibt nichts),
scharf nur mit `apply: true`, blockweise mit `limit`/`ab_id`, wiederholbar.

Geschrieben wird je Region ueber avesmapsAssignEcosystemWikiRegion -- denselben
Hausschreiber wie "Flaeche zuweisen", mit Protokoll und eigener Transaktion.
Nie ueberschrieben werden Regionen mit Schluessel, inaktive, und solche, deren
Beschriftungsadresse nicht zum Schluessel passt. Nichts aendert sich sichtbar,
bis der Owner den Lauf faehrt.

Der Tuer-Waechter in garetien-endpunkt-test.php prueft jetzt die Tuer statt
des Wortes 'apply'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git log -1 --format=%B
```

- [ ] **Schritt 6: Der Lauf** — erst nachdem Aufgabe 2 live ist

⚠️ **Voraussetzungen:** Aufgabe 2 UND diese Aufgabe sind live (Remote-SHA geprüft, Deploy-Lauf grün: `gh run list --limit 3`). Ohne Aufgabe 2 legt jeder weitere Import wieder Regionen ohne Schlüssel an, und der Lauf wäre nie fertig. Niemand importiert gerade (sonst läuft `inzwischen_erledigt` hoch und `vermerke` wandert zwischen den Zählungen). Nur EIN Tab.

**6a. Die erwartete Zahl — lesend, in phpMyAdmin, VOR dem Trockenlauf.**

```sql
-- V: uebernommene Neu-Zeilen dieses Imports mit Vermerk -- muss t.vermerke GENAU treffen
SELECT COUNT(*) AS v
  FROM sync_plan_item i JOIN sync_plan_run p ON p.id = i.run_id
 WHERE p.kind = 'garetien' AND i.change_type = 'new' AND i.apply_state = 'done'
   AND i.apply_note IS NOT NULL AND i.apply_note <> '';

-- E: Regionen dieser Vermerke ohne Schluessel, deren aktive Beschriftung einen traegt
SELECT COUNT(*) AS e
  FROM ecosystem_region r
  JOIN map_features l ON l.public_id = r.label_public_id AND l.feature_type = 'label' AND l.is_active = 1
 WHERE r.is_active = 1
   AND (r.wiki_region_key IS NULL OR r.wiki_region_key = '')
   AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.properties_json, '$.wiki_region.wiki_key')), '') NOT IN ('', 'null')
   AND r.public_id IN (
       SELECT TRIM(CASE WHEN LOCATE('region:', i.apply_note) > 0
                        THEN SUBSTRING_INDEX(SUBSTRING_INDEX(i.apply_note, 'region:', -1), '|', 1)
                        ELSE i.apply_note END) COLLATE utf8mb4_unicode_ci
         FROM sync_plan_item i JOIN sync_plan_run p ON p.id = i.run_id
        WHERE p.kind = 'garetien' AND i.change_type = 'new' AND i.apply_state = 'done'
          AND i.apply_note IS NOT NULL AND i.apply_note <> '');
```

⚠️ Das `COLLATE` ist tragend: `sync_plan_item` steht auf der Server-Vorgabekollation, `ecosystem_region` auf `utf8mb4_unicode_ci` — ohne es droht „Illegal mix of collations". Wirft `JSON_EXTRACT` „Invalid JSON text", liegt eine kaputte Beschriftungszeile vor; dann gilt nur die Zahl des Trockenlaufs. Einmal ausführen, nicht wiederholt (STRATO).

**Aussprechen, bevor der Trockenlauf läuft:** „V ist ___, E ist ___." Die Bestands-SQL aus Aufgabe 2 zählt nur nackte Vermerke und liegt deshalb höchstens bei E.

**6b. Trockenlauf — Browser-Konsole auf avesmaps.de, als Admin angemeldet.**

```js
const nachzug = async (rumpf) => {
  const antwort = await fetch('/api/edit/map/garetien-import.php', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'wiki_nachzug', ...rumpf }),
  });
  const daten = await antwort.json();
  if (!antwort.ok || daten.ok !== true) throw new Error(JSON.stringify(daten));
  return daten;
};
const t = await nachzug({});
console.log({ dry_run: t.dry_run, vermerke: t.vermerke, andere_ziele: t.andere_ziele, geprueft: t.geprueft, wuerde_setzen: t.wuerde_setzen });
console.table(t.uebersprungen);
console.table(t.stichprobe);
console.table(t.widersprueche);
```

Prüfen, in dieser Reihenfolge:
- `t.dry_run === true`.
- `t.vermerke === V`. Weicht es ab, stimmt die Auswahl nicht — **nicht scharf fahren**.
- `t.wuerde_setzen + t.uebersprungen.adresse_passt_nicht === E`. 💣 **Ist `wuerde_setzen` größer als E, ist eine fremde Datenklasse mitgekommen — nicht scharf fahren**, Antwort an den Koordinator.
- `t.wuerde_setzen + Summe(t.uebersprungen) === t.geprueft`, und `t.geprueft <= t.vermerke - t.andere_ziele`.
- `t.stichprobe`: drei Namen im Landschaften-Editor öffnen — die Beschriftung zeigt jeweils genau den Artikel aus `wiki_key`.
- `t.widersprueche`: jede Zeile ist eine Region, deren Artikel dem ihrer Beschriftung widerspricht. Der Lauf fasst sie nicht an; ansehen und von Hand entscheiden.
- 💣 Liegt `wuerde_setzen` über der Protokollgrenze je Person (`AVESMAPS_AUDIT_KEEP_PER_ACTOR = 200`, `api/_internal/audit-prune.php` :60; gezählt über alle Protokolle des Kontos), verdrängt der scharfe Lauf die ältesten Protokollzeilen des Owners, und die sind danach nicht mehr zurücknehmbar. ⚠️ Der Vorgabedeckel ist ebenfalls 200: schon EIN voller Block füllt das Kontingent. Bei mehr als 200 den Owner vorher fragen, ob ältere eigene Änderungen noch zurückgenommen werden sollen.

🔧 **DU:** die Zahlen laut bestätigen („V = t.vermerke, E = t.wuerde_setzen + adresse_passt_nicht, keine fremde Klasse") und freigeben.

**6c. Scharf, in Blöcken — erst ein kleiner Block zum Messen.**

```js
console.time('block1');
let s = await nachzug({ apply: true, limit: 25, ab_id: 0 });
console.timeEnd('block1');
console.log(s.gesetzt, s.inzwischen_erledigt, s.fehler.length, s.cursor, s.remaining);
if (s.fehler.length) console.table(s.fehler);
```

Dauert der Block deutlich mehr als 10 s, bei `limit: 25` bleiben; sonst mit `limit: 100` fortsetzen:

```js
let ab = s.cursor ?? 0, runde = 1;
while (s.remaining > 0) {
  await new Promise((r) => setTimeout(r, 2000)); // STRATO: PHP-Arbeiter zwischen den Bloecken freigeben
  s = await nachzug({ apply: true, limit: 100, ab_id: ab });
  runde++;
  console.log(`Block ${runde}: gesetzt ${s.gesetzt}, inzwischen erledigt ${s.inzwischen_erledigt}, Fehler ${s.fehler.length}, remaining ${s.remaining}`);
  if (s.fehler.length) console.table(s.fehler);
  ab = s.cursor ?? ab;
}
```

⚠️ Nacheinander, nie parallel und nie in zwei Tabs. Die Summe aller `gesetzt` + `inzwischen_erledigt` + Fehler ergibt `t.wuerde_setzen`.

**6d. Gegenprobe.**

```js
const t2 = await nachzug({});
console.log({ wuerde_setzen: t2.wuerde_setzen, schon_gesetzt: t2.uebersprungen.schon_gesetzt });
console.table(t2.stichprobe);
```

- `t2.wuerde_setzen === 0` — oder genau die Zahl der gemeldeten Fehler (dieselben Namen). Dann einmal `await nachzug({ apply: true })` und erneut `t2` prüfen.
- `t2.uebersprungen.schon_gesetzt === t.uebersprungen.schon_gesetzt + Summe(gesetzt)`.
- E aus 6a noch einmal: jetzt `=== t2.uebersprungen.adresse_passt_nicht` (plus offene Fehler).

**6e. Stichprobe auf der Karte** — drei Namen aus `t.stichprobe`, Seite neu laden (der ETag der Flächen folgt `ecosystem_revision`):
- Anzeige-Menü → Prüfen → „Keine Wiki-Zuweisung" in der Landschaften-Ansicht: die rote Kontur der Fläche ist weg (`area.wiki_region_key`, `js/map-features/wiki-zuweisung.js`).
- WikiSync → Regionen: der Statuskreis des Artikels trägt jetzt die rechte Hälfte („mindestens eine zugewiesene Fläche"), zusammen mit dem Label also voll.
- Flächendialog: der Kasten „Wiki-Landschaft" zeigt den Artikel.
- Fenster „Änderungen" (Landschaften): je Region eine Zeile „Wiki-Landschaft zugewiesen"; eine davon zurücknehmen und wieder zuweisen — die Rücknahme wirkt nur auf diese eine Fläche.
- ⚠️ Kanon: Flächen tragen kein Kanon-Etikett (der Kanon-Leser kennt `ecosystem` nicht) — dort ändert sich nichts, und das ist richtig.


---

## Abschluss

### A · Schlussprüfung des ganzen Zweigs

- [ ] **Das GANZE Testfeld**, mit den Befehlen aus den Globalen Randbedingungen, Dateizahlen gegengezählt.
- [ ] **Ein frischer Prüfer auf `opus`** über `git diff a04ffc929..HEAD` — der ganze Zweig, also auch die
  zehn Aufgaben des Verbund-Plans. Sein Auftrag: jede Zeile der Abnahmeliste in Entwurf §9 **am Code**
  abhaken oder als nicht erfüllt melden, mit Fundstelle.
- [ ] **`usability-konsistenz`** (Entwurf gegen Diff, gekoppelte Werte) und **`mockup-treue`**
  (`docs/garetien-import-vereint-mockup.html` gegen die gebaute Oberfläche). Beide Aufträge verbieten
  `git checkout`, `git stash`, `git restore`, `git reset`.
- [ ] **Die getragenen Punkte des Verbund-Ledgers** entscheiden oder ausdrücklich weitertragen: der
  unerreichbare `$zuordnung === null`-Riegel · die „Undefined array key anlass"-Warnungen aus
  `garetien-plan.php` · die zwei read-then-write-Races (Entwurf §6.9).

### B · Nach master — in sechs Pushes, jeder mit dem Blick des Owners

Der Zweig trägt die zehn Verbund-Aufgaben, die nie live waren, und die zwölf dieses Plans. Einzelne alte
Zwischenstände (der Knopf „Verbund auf die Stage" auf „Offen", Form und Art auf „Offen" bedienbar) werden
von späteren Aufgaben wieder zurückgenommen — deshalb geht der Zweig **nicht Commit für Commit** live, sondern
an den Grenzen, an denen die Oberfläche einen abgenommenen Zustand zeigt:

| Push | Bereich | was der Owner danach sieht |
|---|---|---|
| **1** | `a04ffc929..` Ende von **Aufgabe 7** | Fragment-Marke in der Liste · Suche und Filter auf der Stage, „nur Verbünde" · „Auf die Stage" nimmt die Fragmente mit · „Zusammenlegen (n)" in Block B · Fußknopf und Rückfrage zählen Objekte · „Übernommen" eine Zeile je Verbund |
| **2** | Aufgaben **8 + 9** (+ der Code von **13**, ohne Lauf) | die Zielwahl statt der zwei Häkchen; „Innerorts einfügen" ist weg; „zusätzlich" fragt nach |
| **3** | Aufgabe **10** | „Offen" ohne Einstellfelder, Vorschlag als Text |
| **4** | Aufgabe **11** | sieben Blöcke A–G, Buchstaben fluchten |
| **5** | Aufgabe **12** | Ziel in der Zeile, „alle n" im Listenkopf, Fußleiste ohne „Alle wählen" |
| **6** | die Wege-Freigabe (unten, C) | Wege-Verbünde lassen sich zusammenlegen |

🔧 **Die Nachbesserungswelle nach der Schlussprüfung** (Commits `11f233572`/`63179e29c`/`c6e5af4c0`)
geht NICHT als eigener Push — jeder Commit wandert per Cherry-Pick in den Push, dessen Code er
korrigiert: **W1** (MySQL-Syntaxfehler der Trägerabfrage, `11f233572`) und **W2** (Hinweise als
„[object Object]", `63179e29c`) treffen Code aus Aufgabe 8/9/13 und gehen deshalb mit **Push 2**.
**W3 + G1** (`c6e5af4c0`, ein Commit) korrigieren `garetienWikiLandschaftBeiBedarfLaden` und
`garetienVerbundBlockMarkup` und gehen mit **Push 4**, NICHT mit Push 1. 🔴 Hier stand „passt sauber
auf Push 1", weil beide Funktionen schon am Ende von Aufgabe 7 stehen — gemessen stimmt das nicht:
`git merge-tree` meldet für `c6e5af4c0` auf `06307b1de` (Ende Push 1) einen Konflikt in
`js/review/review-garetien-importer.js`, auf `a99eac27e` (Ende Push 4) setzt er sauber auf. Dass eine
Funktion schon existiert, heißt nicht, dass ein späterer Commit auf ihren frühen Stand passt.

**So wird jeder Push gefahren** (AGENTS.md §9, Wegwerf-Worktree — der Hauptbaum bleibt unberührt):

- [ ] `git fetch origin` · `gh run list --limit 3` lesen; ein `in_progress` und ein `pending` heißen warten.
- [ ] Wegwerf-Worktree auf dem aktuellen master:
  ```bash
  git -C C:/GIT/avesmaps worktree add --detach "$SCRATCH/pushwt" origin/master
  cd "$SCRATCH/pushwt"
  git cherry-pick <erster-commit-des-bereichs>^..<letzter-commit-des-bereichs>
  ```
  Bei einem Konflikt: abbrechen (`git cherry-pick --abort`), nicht im Wegwerf-Worktree improvisieren —
  der Zweig wird zuerst mit master abgeglichen, dann neu begonnen.
- [ ] **Im Wegwerf-Worktree das GANZE Testfeld** (Dateizahl gegenzählen). Rot heißt: kein Push.
- [ ] `git push origin HEAD:master`, dann Remote-SHA prüfen, dann den Deploy-Lauf abwarten (1–2 min).
- [ ] `git -C C:/GIT/avesmaps worktree remove "$SCRATCH/pushwt"` und `worktree prune`.
- [ ] **Live gegenmessen:** die ausgelieferte `js/review/review-garetien-importer.js` enthält die neue
  Funktion (`fetch(url + '?cb=' + Date.now())` gegen `fetch(url)`, AGENTS.md §7) · die Live-Seite **als
  Besucher** laden (ohne `edit=1`) und die Konsole lesen.
- [ ] **Der Ablauf im Browser**, mit angemeldeter Sitzung, an genau den Handgriffen des Pushs (unten, D).
- [ ] 🔧 **DU:** der Blick. Erst danach der nächste Push.

### C · Die Wege-Freigabe

🔧 **DU, nach Push 1:** Im Importer auf „Offen" den Filter **„nur Verbünde"** setzen, Objekttyp auf die
Wege-Typen einschränken und die **19 Wege-Verbünde** ansehen. Die Frage ist allein: sind „X" und „X 2"
bei Wegen wirklich **derselbe** Weg? Nur dann bekommt „Zusammenlegen" bei Wegen den Stamm als Namen.

- [ ] Ja → die Freigabe ist eine Zeile (die Konstante, mit der Aufgabe 6 Wege sperrt, auf `true`), ein
  Commit `feat(garetien-importer): Wege-Verbuende lassen sich zusammenlegen`, Push 6.
- [ ] Nein oder nur teilweise → die Konstante bleibt `false`; die Frage, welche Wege zusammengehören,
  wird ein eigenes Vorhaben.

### C2 · Der Wiki-Nachzug (Aufgabe 13, Schritt 6) — nach Push 2

- [ ] Trockenlauf aus der Konsole der angemeldeten Sitzung (Befehl in Aufgabe 13, Schritt 6). **Vorher die
  erwartete Zahl aussprechen** — die Zählabfrage aus Schritt 6a liefert sie; eine viel größere Zahl im
  Trockenlauf heißt, dass eine fremde Datenklasse mitgekommen ist.
- [ ] 🔧 **DU, bevor scharf gefahren wird:** Das Änderungsprotokoll hält **200 Zeilen je Person**
  (`AVESMAPS_AUDIT_KEEP_PER_ACTOR`). Setzt der Lauf unter deinem Namen mehr Schlüssel, als in dieser Grenze
  Platz haben, verdrängt er deine **ältesten** Protokollzeilen — auch frühere Handarbeit, die danach nicht
  mehr zurücknehmbar ist. Liegt `wuerde_setzen` nahe an 200 oder darüber: hinnehmen, oder den Lauf über ein
  zweites Admin-Konto fahren.
- [ ] Scharf, Fortsetzung bis `remaining: 0`, Gegenprobe: ein zweiter Trockenlauf meldet `wuerde_setzen: 0`;
  Stichprobe auf der Karte (Prüfhaken „Keine Wiki-Zuweisung" und Statuskreis der Fläche).

### D · Der Ablauf — Abnahme heißt Ablauf, nicht Maß

Mit angemeldeter Sitzung auf der Live-Seite. ⚠️ **Jeder Import schreibt in die echte Karte**: die Abläufe
laufen an einem einzigen, gekennzeichneten Objekt und werden am Ende über „Zurücknehmen" wieder entfernt.
Was ein Emulator nicht beantworten kann (echtes Touch-Verhalten), wird als offene Frage gemeldet.

- [ ] **Push 1:** „Holen & Rechnen" → Filter „nur Verbünde" setzen: es bleiben nur Zeilen mit der
  Fragment-Marke „⧉ n Fragmente" stehen, keine Einzelobjekte mehr (🔧 SCHLUSSWELLE G2, richtiggestellt:
  die Reiter-Zahl neben „Offen" bleibt dabei der SERVER-Gesamtwert des Reiters — `a.reiter`, unabhängig
  vom Filter — und wandert mit dem Filter NICHT mit; ein Zahlenvergleich gegen die Statuszeile
  [`garetienStatusRuhe`, die keine Verbund-Zahl nennt] ist erst ab Push 5 möglich, wenn der Listenkopf
  „alle n" aus Aufgabe 12 die Zahl der SICHTBAREN Zeilen zählt) → einen Flächen-Verbund auf „Offen"
  wählen → „Auf die Stage" nennt „mit n weiteren Fragmenten" und legt alle auf → auf der Stage suchen:
  das Suchfeld filtert die Stage → Block B „Zusammenlegen (n)" → Fußknopf „· 1 Objekt aus n Zeilen" →
  „Stage leeren" → **ein** Fragment einzeln auflegen: es ist **nicht** zusammengelegt → erneut alle
  auflegen, zusammenlegen, importieren → die Rückfrage nennt „1 Fläche „Stamm" mit n Teilen" → auf der
  Karte **eine** Beschriftung mit dem Stamm, n Flächen, Wiki-Zuweisung an der Fläche → „Übernommen"
  zeigt **eine** Zeile → „Holen & Rechnen" → immer noch eine Zeile → 🔧 SCHLUSSWELLE G3 (richtiggestellt:
  das fragmentweise ↩ in Block B und „Ganzen Verbund zurücknehmen" in Block F entstehen erst mit
  `a99eac27e`/Push 4, siehe dort) → zurücknehmen über den auf diesem Stand VERFÜGBAREN Weg —
  „Zurücknehmen" in Block F an einem der Fragmente, bzw. Mengen-Rücknahme über die Auswahlleiste für
  alle n: nichts bleibt, auch keine leere Region.
- [ ] **Push 2:** ein Bauwerk neben einer Stadt: „Stätte in X" wählen → Fußknopf zählt es → importieren →
  die Stätte steht in der Infobox von X → zurücknehmen · „Nur Quelle + Artikel an X" → keine Stätte,
  die Quelle steht an X → zurücknehmen · ein Objekt, das sich deckt: Vorbelegung „Quelle an X ergänzen" →
  „zusätzlich zu X" → die Rückfrage nennt beide → Abbrechen: nichts geschrieben. 🔧 SCHLUSSWELLE W1/W2:
  eine Rücknahme an einer Siedlung (Quellen-Ergänzung, „Nur Quelle") wirft nicht mehr (der ESCAPE-
  Syntaxfehler ist behoben) · ein „schon vorhanden"-Hinweis zeigt seinen Satz, nicht „[object Object]".
- [ ] **Push 3:** auf „Offen" lässt sich an keinem Objekt ein Feld der rechten Spalte ändern (außer
  Block G); nach „Auf die Stage" erscheinen die Felder.
- [ ] **Push 4:** alle Blockköpfe per `getBoundingClientRect().left` gemessen — eine Zahl. 🔧 SCHLUSSWELLE
  G3, hierher verschoben (entsteht erst mit `a99eac27e`): an einem übernommenen, zusammengelegten
  Verbund ↩ an einem Fragment in Block B → Region, Beschriftung und Garetien-Quelle DIESES Fragments
  bleiben, die übrigen Fragmente auch → „Ganzen Verbund zurücknehmen" in Block F → nichts bleibt, auch
  keine leere Region.
- [ ] **Push 5:** das Häkchen „alle n" wählt genau die sichtbaren Zeilen; die Fußleiste trägt drei Knöpfe.

### E · Danach

- [ ] **Gedächtnis:** `garetien-import-projekt.md` bekommt den Stand (was live ist, die Wege-Entscheidung,
  die getragenen Punkte).
- [ ] **AGENTS.md §11** bekommt einen Eintrag „Der Garetien-Importer: Zielwahl, Verbund, Stage" mit den
  Regeln, die über diesen Plan hinaus gelten: eine Zielwahl statt unabhängiger Häkchen · die
  Verbund-Entscheidung lebt am Stage-Eintrag · Neu + Ergänzung desselben Objekts nur mit `beides` ·
  die Stage filtert im Browser · nur der Fußknopf schreibt.
- [ ] **Das Handbuch nicht anfassen** — die nächtliche Routine liest die Commit-Betreffe (AGENTS.md §9).
- [ ] 🔧 **Offen beim Owner, nicht in diesem Plan:** (a) die verwaisten Garetien-Quellen früher
  zurückgenommener Flächen (Entwurf §7a) — aufräumen oder stehen lassen; (b) `avesmapsGaretienArtikelQuellenNachtragen`
  hängt den Artikel einer **Stätte** an `settlement:<stätten-id>`, wo ihn kein Leser findet (vorbestehend,
  beim Lesen gefunden, nicht gemessen); (c) ein „Nur Quelle"-Objekt erscheint auf „Übernommen" ohne
  Innerorts-Zusatz.
- [ ] **Aufräumen:** alle Wegwerf-Worktrees (`git worktree list`), dann `superpowers:finishing-a-development-branch`.

---

## Anhang · Bauhinweise aus dem Entwurf der Aufgaben

Jede Aufgabe wurde vor dem Schreiben dieses Plans in einem Wegwerf-Worktree gebaut und getestet (rot ohne, grün mit Umsetzung, Mutationsproben). Was dabei vom Schnittstellen-Vertrag abwich, welche Annahmen über Nachbaraufgaben galten und was gemessen wurde, steht hier — für den Bauer, der eine Aufgabe übernimmt und wissen muss, warum sie so aussieht.

### Aufgaben 1, 2, 3 und 8 (Server)

**Wo der Vertrag am Code nicht passte — und wie gelöst**

1. **Aufgabe 1, Urteil an der Aufrufstelle.** Der SELECT des Planbaus liest `urteil` nicht, und das Urteil entsteht erst in der Schleife (`avesmapsGaretienFindeBestand`). Gelöst durch zwei Durchgänge in `avesmapsGaretienBaueSyncPlan`: beurteilen + schreiben + `$benannt[$index]['urteil']` setzen, dann Erkennung, dann Items. Die Reihenfolge der `sync_plan_item`-Zeilen bleibt die Zeilenreihenfolge.
2. **Aufgabe 1, ausgeschlossene Urteile.** Vertrag: nur `deckt_sich`. Gebaut: `deckt_sich` und `uebersprungen` (Entwurf §6.1 „nur erzeugende Zeilen"). Zusätzlich eine interne Funktion `avesmapsGaretienVerbundMitglieder`, damit Stamm und Gruppe aus EINER Rechnung kommen; die zwei Vertragsnamen sind dünne Sichten darauf.
3. **Aufgabe 2, Zeilennummer.** `app/ecosystem.php:2076–2080` ist `avesmapsEcosystemReadRegionFields`, nicht `avesmapsCreateEcosystemRegion` (:2814) — die Aussage „leitet `wiki_region_key` aus `wiki_url` ab" stimmt.
4. **Aufgabe 2, Name = Stamm nur für `region`/`path`.** Der Vertrag sagt „Fläche und Weg"; umgesetzt als Konstante `AVESMAPS_GARETIEN_VERBUND_NAME_ZIELE` in `avesmapsGaretienNameUebersteuern` (PLAN, nicht UEB).
5. **Aufgabe 3, Quellen-Lösen.** Der Branch (und `origin/master`) löste bei der Rücknahme eines `new`-Flächen-Items die Garetien-Quelle **gar nicht** — `avesmapsGaretienQuelleRuecknahmeLoesen` hat nur einen Aufrufer, den `changed`-Quelle-Zweig (Branch ~:2602, master :2316). „Fehler 9" des Entwurfs beschreibt also einen Zustand, den der Code nicht hat; gebaut ist die Zusage selbst („fällt erst mit der letzten Fläche"). Folge für den Bestand steht im Abschnitt.
6. **Aufgabe 3, zusätzliche Riegel.** `avesmapsGaretienVerbundRegion` prüft jetzt auch „mindestens eine aktive Fläche" (neue Funktion `avesmapsGaretienRegionAktiveFlaechen`, geteilt mit der Rücknahme).
7. **Aufgabe 8, drei Vertragserweiterungen, alle aus Fehlerfreiheit/Bestand:**
   - Der Tür-Leser `avesmapsGaretienBeidesPruefen` (neu, der Vertrag nennt nur den reinen Riegel) zählt nur `selected = 1 AND apply_state IS NULL` — sonst bliebe eine abgelehnte Zeile nicht folgenlos abgelehnt.
   - „Nur Quelle" braucht einen eigenen Vermerk `nur_quelle:<siedlung>` und einen Rücknahme-Zweig; mit nacktem Vermerk hätte die Rücknahme über `avesmapsDeleteMapFeature` die **Stadt** gelöscht. Gelöst wird nur der Artikel dieses Objekts (neue Funktion `avesmapsGaretienQuelleRuecknahmeLoesenFuerAdresse`).
   - `innerorts_nur_quelle` allein gilt als Innerorts-Wunsch.
   - **Nachtrag (Befund aus Aufgabe 9):** eine gewählte `innerorts_public_id` gilt jetzt gegen die KARTE statt gegen `kandidaten` des Laufs (neue Funktion `avesmapsGaretienInnerortsSiedlung`); nicht aktiv oder Bauwerk → lauter Abbruch, nie eine andere Siedlung. Die im ersten Entwurf genannte `avesmapsGaretienSiedlungAktiv` gibt es dafür **nicht mehr** — ersetzt durch `avesmapsGaretienSiedlungLesen(PDO, string): ?array{name, klasse, aktiv}`, weil der Abbruchgrund den Namen auch einer gelöschten Siedlung nennen soll. `avesmapsGaretienInnerortsAusVorschlag(array $nach)` verliert seinen zweiten Parameter. Die Bauwerks-Sperre ist meine Ergänzung. Der Kommentar in `api/edit/map/garetien-import.php` (~:285), der auf den alten Kandidaten-Riegel verwies, ist nachgezogen.
8. **Vertragszeilen `avesmapsGaretienApplyStep :1291`, `avesmapsGaretienUebernehmen :1667`, `avesmapsGaretienInnerortsGewuenscht :2115`, sync-plan apply :234–311** stimmten am Branch-Stand. Die Riegel-Prüfung sitzt in der Tür, nicht in `avesmapsGaretienApplyStep` (dort gäbe es nur 400 über `InvalidArgumentException`).

**Annahmen**

- Aufgaben 2 und 3 teilen dieselbe Testdatei; der Helfer `avesmapsGaretienVerbundTestFragmentMitArtikel` steht in Aufgabe 2 (Abschnitt S) und wird in Aufgabe 3 (Abschnitt R) benutzt. Die Dateireihenfolge O, P, S, Q, R ist genau so im Wegwerf-Worktree gefahren (grün).
- Die Zwischenstände „nur Aufgabe 1", „1+2", „1+2+3" wurden nicht einzeln ausgecheckt; jeder Rot-Befund wurde in dieser Reihenfolge gesehen, bevor die jeweilige Umsetzung dazukam, und die Umsetzungen jeder Aufgabe wurden danach einzeln per Mutationsprobe zurückgenommen (siehe unten).
- `mb_substr` im Fehlerpfad der Rücknahme (Aufgabe 3, 3d) folgt dem Muster der Nachbarzeilen derselben Funktion; es liegt nicht im Anlegen.
- Die SQL-Abfragen unter „Bestand" sind MySQL-Lesabfragen für den Owner, nicht gefahren.

**Offene Risiken**

- 💣 **Aufgabe 8 darf nicht vor Aufgabe 9 live gehen:** der heutige Client schickt bei „Neu einfügen" an einem Deckungsfall Zusatz + Ergänzung ohne `beides` → 422.
- ⚠️ Ein „Nur Quelle"-Objekt erscheint auf „Übernommen" ohne den Zusatz „innerorts" (`innerorts_uebernommen` fragt `settlement_place`) — Client-Aufgaben 9/12.
- ⚠️ Vorbestehend, nicht in diesem Plan: `avesmapsGaretienArtikelQuellenNachtragen` behandelt den Vermerk einer **Stätte** (`settlement_place`-public_id, Ziel `location`) als Siedlung und hängt den Artikel an `settlement:<stätten-id>` — ein Leser findet diese Zeile nie. Gefunden beim Lesen, nicht gemessen.
- ⚠️ Nichts lief gegen MySQL. Die implizite-Commit-Falle (DDL in Transaktion) ist beim Aufräumen des Anführers geprüft: keine äußere Transaktion, jede Hausfunktion ruft ihr Ensure vor `beginTransaction`.
- ⚠️ Die Races aus Entwurf §6.9 bleiben.

**Was im Wegwerf-Worktree rot/grün lief (Zahlen)**

- Ausgangsstand (`df8d9ec4c`): verbund 1×OK, verbund-uebernahme OK, innerorts 95, einstellungen-je-item 29, endpunkt OK, plan 134, uebernahme 453.
- Rot vor der Umsetzung: A1 `J: "Süd" ist eine Himmelsrichtung` · A2 `O1: … ["Silker Hain 1"]` · A3 `Q1: … {"regionen":2,"flaechen":2,"labels":2,"leere_regionen":1}` · A8 `Call to undefined function avesmapsGaretienBeidesRiegel()` und `NQ: es wird NICHTS angelegt … : 1`; Nachtrag `Call to undefined function avesmapsGaretienInnerortsSiedlung()` (innerorts- und uebernahme-Test).
- Nachtrag „gewählte Siedlung": Wegwerf-Worktree neu aufgesetzt (die Änderungen der vier Aufgaben aus den gesicherten Diffs wieder eingespielt, vorher denselben grünen Stand nachgemessen: verbund OK, verbund-uebernahme OK, riegel 25, uebernahme 474, innerorts 95, endpunkt OK), dann gebaut. 6 weitere Mutationsproben, alle gefangen: Wahl ignoriert (W1 und innerorts G), inaktive Wahl genommen (W3), Bauwerk als Wirt (W4 und innerorts G), Nur-Quelle-Vorauswahl ungeprüft (NQ „Verlorener Tempel"). Eine Probe traf wegen CRLF erst 0×, mit `\r\n` nachgefahren.
- Nach der Umsetzung A2 fiel der fremde Abschnitt G (`"AXwald" … bekommen: FEHLT`), nachgezogen.
- Mutationsproben (je eine Ersetzung, Byte-Gegenprobe beim Zurücksetzen, alle zurück): **A1 5/5 gefangen**, **A2 4/4**, **A3 5/5** (+1 Nachprobe nach Umbau auf die geteilte Flächen-Zählung), **A8 17/17** (11 vor, 6 nach dem Nachtrag; mehrzeilige Proben trafen wegen CRLF zuerst 0×, einzeilig bzw. mit `\r\n` nachgefahren).
- Endstand: garetien-beides-riegel 25 · garetien-uebernahme 489 · verbund-uebernahme alle Abschnitte bis „Fehler 9" OK · verbund OK · plan 134 · innerorts 101 · liste 115 · einstellungen 29 · endpunkt OK · JS garetien-innerorts-knopf grün.
- Ganzes PHP-Feld nach Workflow-Muster: **408 Dateien**, rot nur `api/_internal/linkcheck/__tests__/link-url-test.php`. JS-Feld nach Workflow-Muster: **543 Dateien**, nichts rot.
- Wegwerf-Worktree entfernt, `git worktree prune` gefahren.

### Aufgaben 4 bis 7 (Stage)

**Vertragsabweichungen und wie gelöst**
1. **A4 — neue Namen:** `avesmapsGaretienVerbundAngelegtLaufuebergreifend` und `avesmapsGaretienVerbundVermerkeFruehererLaeufe` (PHP), `garetienUebernommenFaltSchluessel` (JS). Regel „der laufende Lauf entscheidet, sobald er ein übernommenes Item trägt, sonst der jüngste frühere" — ohne sie falteten nach Rücknahme und Einzel-Neuimport alte Vermerke weiter. Der JS-Faltschlüssel wurde `ebene|typ|stamm`, weil der Vermerk nur den Stamm trägt.
2. **A5 — `garetienStageFilterSperreSetzen` heißt `garetienStageHinweisSetzen`** (Export mitgeändert). Der Hinweis-Absatz bleibt, nur ohne den Satz.
3. **A5 — Filter-Umfang größer als der Vertrag:** `garetienStageFilterAnwenden` wendet alle Trichter-Abschnitte an (Ebene, Urteil, Wiki, nur mehrteilig zusätzlich zu Suche/Typ/nur Verbünde). Begründung: ein Chip ohne Wirkung wäre der Fehler, den die Aufgabe beseitigt.
4. **A5 — `nur_verbuende` reist immer als `1`/`0` im Literal** (Vertrag: „angehängt als 1"). Grund: `garetien-endpunkt-test.php` misst ein festes Bytefenster; als angehängte Zeile verschwand `rumpf.anzahl` daraus. Das Fenster des fremden Tests wurde 600 → 900 geweitet. Der Endpunkt wandelt mit `in_array(…, [1, '1', true], true)` um.
5. **A5 — LISTE liest `verbund_n` am Objekt**, nicht in `after` (am Objekt steht es seit dem Objektbau ~:808). **Neues Antwortfeld `verbund_objekte`** und neue Funktion `garetienLeereListeText` für den Owner-Nachtrag zum Bestand.
6. **A6 — `zustand.stage` hält Einträge `{objekt, zusammen}`.** Jeder künftige direkte Leser (Aufgaben 8–12) muss `.objekt` nehmen oder besser `avesmapsGaretienStageListe()`/`…Hat()` benutzen.
7. **A6 — `garetienVerbundZusammenlegen` liest `objekte` nicht** (Mitglieder kommen aus der Stage, die filterunabhängig ist) und trägt den Riegel selbst; **`garetienVerbundAufloesen` vergisst zusätzlich die Einstellungen des Verbunds** (Fehler 10); **`avesmapsGaretienStageEntfernen` löst unter zwei auf**. `garetienVerbundKlick` meldet neu `verbund_gesperrt` mit Grund.
8. **A6 — `garetienVerbundZusammenlegbar` prüft `.ziel`**, nicht `.form` (der Bestand kennt kein `.form`), und nimmt vor dem Zusammenlegen die Form des größten Mitglieds auf der Stage.
9. **A6 — Wege-Freigabe testbar** über `let _garetienVerbundWegeFrei` (aus der Konstante) und `__test.garetienVerbundWegeFreiSetzen` — `__test` ist in dieser Datei der Ort für reine Testzugänge; die Freigabe bleibt die eine Konstantenzeile.
10. **A7 — die Unterzeile zählt nur, was dazukommt** (Vertrag: Mitglieder − 1); gleich, solange nichts aufliegt. Zusatz-Objekte kommen nicht mit. Einzahl „mit 1 weiteren Fragment".
10b. **A6 — Name = Stamm im Client und Kurve aus beim Verbund** (Nachtrag des Koordinators): `garetienNameFuerImport` liefert bei einem zusammengelegten Verbund ohne Handnamen `verbund_stamm`; der Rumpf trägt dann keinen `name` (am Code geprüft). Die Kurvenregel ist heute gleichwertig zur Grundvorgabe `curveLabel: false` und nur zusammen mit einer geänderten Grundvorgabe mutationsfest — so im Abschnitt benannt. Die Beschriftungs-Vorschau (Nachtrag) zeigt EINE Beschriftung je zusammengelegtem Verbund, am Anführer (kleinste Neu-Item-Nummer, wie am Server), mit dem Text aus `garetienNameFuerImport` über einen fünften Parameter von `garetienVorschauLabelAus`; der Name zieht die Karte entprellt nach. Nebenwirkung, gewollt: auch ein Einzelobjekt zeigt seinen getippten Handnamen in der Vorschau. Fremder Test `garetien-label-vorschau-zeichnen.test.js` zählt jetzt vier Nachzieh-Ausgänge.
10a. **A6 — `garetienUmkreisVergessen` wird NICHT gerufen** (Vertrag: alle sechs). Entscheid des Koordinators vom 14.09.2026: „Stage leeren" und ein neuer Lauf setzen nur Objekt- und Verbund-Einstellungen zurück, der fensterweite Umkreis bleibt; der Test sichert beides, der Kommentar über `garetienEinstellungenVergessen` sagt, wo der nächste Speicher eingeordnet wird.
11. **A7 — `garetienUebernahmeKnopfZustand` liefert zusätzlich `zusammenfassung`**; `anzahl` bleibt die Zeilenzahl. Die Rückfrage stellt `garetienFussknopfEinfuegenKlick`, `garetienFussknopfKlick` bleibt unverändert. Die Rückfrage sagt „„X“ mit n Teilen", nicht „die Fläche „X"" — die Formbezeichnung hängt an der Zielwahl (Aufgabe 9/11).

**Annahmen über andere Gruppen**
- **Aufgabe 1** liefert `verbund_stamm`/`verbund_n` nur für erzeugende Zeilen; der Client-Filter auf Urteil (A7) ist nur Absicherung. `verbund_objekte` (A5) zählt, was Aufgabe 1 schreibt.
- **Aufgabe 2** liest weiter `verbund` im Rumpf — `garetienEingabenFuerServer` ist unverändert und hängt ihn nur an einen zusammengelegten Verbund.
- **Aufgabe 9:** Bedingung `garetienZielwahlZu(objekt) === "karte"` in `garetienVerbundZusammenlegbar` ergänzen; `garetienZielwahlVergessen` in `garetienEinstellungenVergessen` eintragen; den neuen Speicher in die Speicherlisten von `garetienVerbundEinstellungenVergessen` und `garetienVerbundVergessen` aufnehmen; `garetienStageZusammenfassung` zählt über `garetienStageItems` — „Nichts — nur ansehen" zählt damit von selbst nicht.
- **Aufgaben 9 und 11** verlegen das Namensfeld (heute in `garetienEinfuegeHakenMarkup`) in Block C: sein Wert muss weiter aus `garetienNameFuerImport` kommen, und die Vorgabe darf nie in den Namensspeicher geschrieben werden. `garetienStageZusammenfassung` (A7) rechnet den Verbundnamen heute als `garetienNameWahlZu(o) || verbund_stamm` — gleichwertig; wer ihn anfasst, nimmt `garetienNameFuerImport`.
- **Aufgabe 11** baut Block B in `.gi-block` um und übernimmt Knopf, Grundzeile, ✕-nur-auf-der-Stage und `garetienVerbundPool` aus `garetienVerbundBlockMarkup`.
- **Aufgabe 12** entfernt `#garetien-mark-all`: die Erwartung in `garetien-vokabular.test.js` (von A7 auf „Stage importieren · nichts auf der Stage" gesetzt) ändert sich dann erneut.
- **A6 und A7 gehen gemeinsam live** (zwischen beiden legt der alte Offen-Knopf nichts mehr auf).

**Bestand (dem Owner vorlegen)**
- „nur Verbünde" ist auf dem heutigen Lauf leer, bis nach Aufgabe 1 neu gerechnet wird — mit Satz, ohne Reparatur.
- Übernahmen vor dem Verbund-Vermerk falten nie; das ist richtig, sie waren kein Verbund.

**Was lief (Wegwerf-Worktree auf `df8d9ec4c`, Aufgaben 1–3 dort nicht gebaut)**
- Rot vor jeder Umsetzung wie in Schritt 2 angegeben; danach grün.
- JS-Feld nach Workflow-Muster: 543 Dateien vorher, 546 nachher (3 neue), **0 rot** nach jeder der vier Aufgaben.
- PHP-Feld nach Workflow-Muster: 409 Dateien, rot nur der bekannte `api/_internal/linkcheck/__tests__/link-url-test.php` (DNS); alle `garetien-*-test.php` grün.
- Mutationsproben: A4 1/1, A5 2/2 (Filter + Endpunkt-Naht), A6 19/19 gefangen (dazu zwei Einzelmutationen der Kurvenregel, die heute gleichwertig und deshalb grün sind), A7 8/8 gefangen; die Mutationen wurden byte-gleich zurückgenommen.
- Ein Befund aus dem Bau, der im Plan steckt: der erste Test zu A6 ließ „Entfernen ohne Auflösen" überleben — Abschnitt C prüft seither, dass die Einstellungen in der TÜR fallen.

### Aufgaben 9 und 10 (Zielwahl)

**Vertragsabweichungen (am Code begründet):**
1. **„Auf die Karte“ steht nicht „immer“ zur Wahl, sondern nur, wenn es ein Neu- oder Zusatz-Item gibt.** Ein Objekt ohne beides (z. B. „übersprungen“) hätte sonst eine Option, die still nichts täte; dort gibt es nur „Nichts“. Die Entwurfszeile „immer, auch bei Innerorts-Befund“ ist so gelesen: eine Stadt nimmt sie nie weg.
2. **`garetienZieleMoeglich` stellt die Vorbelegung vorne**, danach die Konstanten-Reihenfolge — so stehen alle drei Mockup-Szenen exakt da (Natter: Ergänzen · Karte · Zusätzlich · Nichts).
3. **`innerorts`/`innerorts_nur_quelle` entstehen in `garetienEingabenFuerServerOhneName`**, nicht in `garetienStageEinstellungenJeItem` — dort entstand der Innerorts-Rumpf schon; `beides` hängt `…JeItem` an (betrifft zwei Items). Der Rumpf, der ankommt, ist derselbe; der Kern-Test prüft ihn wörtlich.
4. **Die Rückfrage sitzt in `garetienFussknopfEinfuegenKlick`**, nicht in `garetienFussknopfKlick` (die reine Kette hat kein `fragen`). Ohne `fragen` wird ein „zusätzlich“ nicht importiert.
5. **`garetienStageZeile2` ignoriert `aufDerStage`** (Signatur bleibt für Aufgabe 12); die Texte sind die des Vertrags, ergänzt um „nur Quelle an „X““ und „Quelle am bestehenden Objekt“ (Ergänzung ohne Abschnittsnamen).
6. **Zusätzlich exportiert:** `garetienZielwahlTexte`, `garetienZielwahlAusGrund`, `garetienZielNameZeile`, `garetienZielKarteItems`, `garetienErgaenzungZiel`, `garetienZusaetzlichObjekte`, `garetienVorschlagMarkup`. Gefallen zusätzlich zum Vertrag: `garetienNeuItems` (zählte das Zusatz-Item mit — neben `garetienZielNeuItems` eine Falle), `garetienNeuMoeglich`, `garetienQuelleMoeglich` und die `innerorts`-Einträge der Handlungs-Tafeln.
7. **`garetienInnerortsZiel` hat einen dritten Rückfall** (die nächste Siedlung der Liste, wenn die Vorauswahl nicht mehr darin steht); vorher stand dann „Stätte in „““ ohne Namen da.
8. **`garetienVerbundZusammenlegbar` prüft die Zielwahl an JEDEM aufgelegten Mitglied**, nicht nur an `objekt` (Vertrag und Hinweis in `plan-teil-stage.md`): nach dem Zusammenlegen liest die Zielwahl am Verbundschlüssel, ein „Nichts“ an einem kleineren Fragment fiele sonst still auf „Auf die Karte“ zurück. Der Grund nennt das Fragment („… bei „Silker Hain 2““).

**Endstände von Aufgabe 5–8, abgeglichen mit `plan-teil-stage.md` (Nachricht des Koordinators):**
- A5: `garetienStageFilterSperreSetzen` heißt `garetienStageHinweisSetzen` — von Aufgabe 9/10 nicht benutzt.
- A6: `zustand.stage` hält `{objekt, zusammen}`. Aufgabe 9/10 lesen die Stage nur über `avesmapsGaretienStageHat`/`…Liste`/`…Hinzufuegen`/`…Entfernen`/`…Leeren` und `garetienVerbundStageEintraege`; in keiner aufgezeichneten Ersetzung steht `zustand.stage`. Die Nachträge an `garetienEinstellungenVergessen` und den zwei Speicherlisten stehen in Schritt 3h — ohne sie wäre `_garetienEinfuegeWahl` nach Aufgabe 9 ein `ReferenceError`.
- A6: `garetienVerbundZusammenlegbar` prüft die Form am größten Mitglied, Wege über `AVESMAPS_GARETIEN_VERBUND_WEGE_FREI`. Die Zielwahl-Prüfung steht davor (Vertragsabweichung 8). Abschnitt G des Kern-Tests nutzt eine Fläche und braucht `__test.garetienVerbundWegeFreiSetzen` nicht.
- A6: `garetienVerbundZusammenlegen` legt nicht mehr auf; die Tests legen vorher auf. In `garetien-verbund-einstellungen.test.js` liegen die zwei Stellen von Aufgabe 6 INNERHALB des Blocks, den Aufgabe 9 ersetzt — der Ersatz trägt beide (Fixture mit `ziel: "region"`, Auflegen vor dem Zusammenlegen).
- A7: `garetienUebernahmeKnopfZustand` liefert `anzahl` (= Zeilen) und `zusammenfassung`; die neue Rückfrage steht zwischen `if (stand.gesperrt)` und A7s `fragen(garetienEinfuegenRueckfrageText(stand.zusammenfassung))`. `garetienStageZusammenfassung` zählt über `garetienStageItems` — „Stätte“ zählt, „Nichts“ nicht, ohne weitere Zeile. „Verbund auflösen“ ist in A7s Block B nie gesperrt (nachgelesen). `garetienStageKnopfBauen` trägt eine Unterzeile nur an Verbund-Mitgliedern; die Tests dieser Aufgaben prüfen `zeile2 === ""` nur an Nicht-Mitgliedern. A7s Eingriff in `garetien-zusatz-auf-die-stage.test.js` (§4) überschneidet sich nicht mit dem von Aufgabe 9 (§3); die Export-Zeile `garetienEinfuegenRueckfrageText,` bleibt als Anker eindeutig.
- A8: der Riegel nimmt `{beides: true}` an einem `changed`-Item ohne `ziel` an und verlangt es an BEIDEN Items; `innerorts_nur_quelle` wird nur zusammen mit `innerorts: true` gelesen.
- **Im Wegwerf-Worktree waren Aufgabe 5–8 nicht gebaut.** Für Abschnitt G/H des Kern-Tests stand dort ein Stub im MODUL, nicht im Test (dort hätte er genau den Aufgabe-9-Anteil nicht geprüft): `garetienZielwahlVergessen()` in `avesmapsGaretienStageLeeren`, ein Ersatz für `garetienVerbundStageEintraege` und ein `garetienVerbundZusammenlegbar` aus dem **wörtlichen** 3h-Block plus vereinfachter Formprüfung. Die Stage hielt dort noch Objekte statt Einträge.

**Server-Befunde (nicht gebaut, gehören zu Aufgabe 8 oder einem eigenen Vorhaben):**
- 💣 `avesmapsGaretienInnerortsAusVorschlag` (UEB:2154) fällt STILL auf die Vorauswahl des Laufs zurück, wenn die gewählte Siedlung nicht in `befund.kandidaten` steht — genau der Fall einer Siedlung, die erst der Umkreis-Spinner gefunden hat. Die Zielwahl zeigt „Stätte in „Rallerfurt““, angelegt würde die Stätte in der Vorauswahl. Vorbestehend (das Auswahlfeld bot solche Siedlungen schon an), aber mit „Stätte in X“ jetzt sichtbar behauptet.
- Ohne Befund im Lauf (nur per Spinner gefundene Siedlungen) bricht das Item laut ab („keinen Innerorts-Befund“) — laut, nicht still.

**Für Aufgabe 11/12:**
- **Zuschnitt (Koordinator, nach `plan-teil-bloecke.md` Notiz 6):** die Regeln `.gi-ziel*` und `.gi-insert__row--aus` samt Vertragsmarke baut **Aufgabe 9** (Schritt 3i), ebenso die zwei umgeschriebenen Mockup-Kopfkommentare (Wortlaut aus Notiz 6). Aufgabe 11 bindet nur `.gi-block*`, in einem ZWEITEN Block auf dieselbe Datei, dessen Endmarke vor der Anfangsmarke der Zielwahl steht.
- ⚠️ **Die Übergangsregel `.gi-acts > .gi-ziel { flex: 1 0 100%; }`** (hinter der Endmarke) nennt `plan-teil-bloecke.md` Schritt 3h nicht. Aufgabe 11 muss sie beim Umzug in Block C streichen, sonst bleibt eine tote Regel.
- 🔧 **Owner:** im dunklen Thema erreicht die zweite Zeile einer überfahrenen oder gewählten Option AA nicht (Tabelle in Schritt 4k). Eine Korrektur ist eine Mockup-Änderung.
- ⚠️ Der Kopf des Mockup-Abschnitts „NEU“ (:397–400) sagt weiter „alles darunter gibt es im Produktivcode NOCH NICHT“ und zählt `.gi-ziel*`/`.gi-insert__row--aus` mit. Nach Aufgabe 9 stimmt das für diese zwei nicht mehr — nicht angefasst, weil nicht bestellt; am saubersten zieht Aufgabe 12 den Satz nach, wenn die letzte Regel gebaut ist.
- 11 zieht aus der Handlungsleiste in Block C um: `garetienZielwahlMarkup(objekt)` (Radioliste + Siedlung/Umkreis), `garetienZielWahlMarkup(objekt, uebernommen, ausGrund)`; auf „Offen“ `garetienVorschlagMarkup(objekt)` (trägt „Erst auf der Stage einstellbar.“ selbst). Block D wird heute nur über `disabled` abgeblendet; die einzeilige Form des Mockups (§5a „Beschriftung — eine Stätte steht nicht auf der Karte“) ist Aufgabe 11.
- 🔴 **Das Namensfeld zwischen 9 und 11:** Aufgabe 9 legt es nicht neu an; es steht wie heute in der Handlungsleiste, jetzt unter der Zielwahl (`garetienZielNameZeile`, einziger Aufrufer die Rückgabe von `garetienHandlungsMarkup`). Am gebauten Modul über `garetienDetailMarkup` gezählt: auf der Stage genau eins, sonst keins. In 11/3e muss die ersetzte Rückgabe `+ garetienZielwahlMarkup(objekt) + garetienZielNameZeile(objekt)` mitnehmen — ihr Satz „`garetienEinfuegeHakenMarkup(objekt)` hat Aufgabe 9 daraus schon gestrichen“ stimmt, an seiner Stelle steht dieser Aufruf. Danach hat `garetienZielNameZeile` keinen Aufrufer: streichen samt Export. Der Kommentar an `garetienIdentitaetMarkup` („Der Name stand bis Aufgabe 9 in den zwei Einfuege-Haekchen“) müsste heißen „bis Aufgabe 11 in der Handlungsleiste“.
- ⚠️ **Aufgabe 11 macht `garetien-zielwahl-ziele.test.js` rot** — ihr Probelauf fuhr mit Attrappen ohne diesen Test. Abschnitt F sucht Zielwahl und Namensfeld in `garetienHandlungsMarkup` (Z. 314–321) und verlangt, dass `garetienEingefuegtWirdMarkup` kein `data-gi-feld="innerorts"` trägt (Z. 330; nach 11 steht die Siedlung in Block C); Z. 344, 361 und 420 rufen `garetienZielNameZeile`. Umzustellen auf `garetienIdentitaetMarkup` bzw. `garetienEingefuegtWirdMarkup`. `garetien-name-aendern.test.js` (Schritt 4d, sucht in `garetienHandlungsMarkup`) sieht Notiz „Annahmen A9“ von 11 schon vor.
- 12 setzt `garetienStageZeile2(objekt, true)` in die Ziel-Marke. Der Verbund-Text „1 Fläche aus 4 Teilen“ (Mockup §4) liefert sie NICHT — das braucht `garetienStageZusammenfassung` (Aufgabe 7).

**Rot/grün, gemessen im Wegwerf-Worktree (Zweig `garetien-fragmente-verbund`, HEAD `df8d9ec4c`):**
- Ausgangslage: 543 JS-Testdateien nach dem Workflow-Muster, **0 rot** (auch `quellen-abdeckung-ziel.test.js` war dort grün).
- Aufgabe 9: Kern-Test ohne Umsetzung rot (`die sechs Zielwerte …`, `+ undefined`); mit Umsetzung **144 Zusicherungen grün**. Danach im Feld genau **8 rot**, alle vorhergesagt (`einfuege-haken`, `import-verdrahtung`, `innerorts-knopf`, `name-aendern`, `stage-nachschlagen`, `verbund-einstellungen`, `vorwaertsknopf`, `zusatz-auf-die-stage`); nach dem Nachziehen **543 Dateien, 0 rot**. Mutationsprobe mit SHA-256-Gegenprobe: **19 von 19 gefangen** (darunter „Zusammenlegbar prüft nur das eigene Objekt“).
- Aufgabe 10: Kern-Test ohne Umsetzung rot (`Ziel als Text …`); mit Umsetzung **33 Zusicherungen grün**. Danach **2 rot** (`bloecke`, `eingefuegt-wird`); nach dem Nachziehen **544 Dateien, 0 rot**. Mutationen: **8 von 8 gefangen** (darunter „Riegel nach dem Anlegen des Zustands“ und „Riegel sperrt den Umkreis-Spinner“).
- LF-Gegenprobe (Spiegel mit entfernten `\r`, wie `actions/checkout`): alle 16 berührten bzw. benachbarten Garetien-Tests grün.
- **Schritt 3i, eigener Lauf auf dem Zweigstand `9fccacfbc`** (Nachträge des Koordinators; `js`, `css`, `tools` gleich `df8d9ec4c`): Mockup mit neuen Kopfkommentaren und Marken, ohne Regeln → `mockup-vertrag.test.js` **rot** (`.gi-ziel { display } fehlt …`, `.gi-ziel { flex-direction } fehlt …` und jede weitere Eigenschaft); mit Regeln **grün** (`76 Mockups geprueft, davon 12 mit Vertrag`, vorher 11). `garetien-handlungen.test.js` an der Stelle grün, mit dem Block ans Dateiende verschoben rot (Abschnitt J), Datei danach SHA-256-gleich zurück. Darauf Aufgabe 9 vollständig eingespielt (Modul, Stubs für Aufgabe 6, fremde Tests): Kern-Test 144 grün, JS-Feld **543 Dateien, 0 rot**. Das Namensfeld per Einmalprobe über `garetienDetailMarkup` in acht Lagen gezählt (Stage: je eins, in der Leiste unter der Zielwahl; ohne Vorschlag, Offen, übernommen, abgelehnt: keins). Die Kontraste sind gerechnet, nicht im Browser gemessen (Schritt 4k). Die fünf Ersetzungen von 3i sind mitgeschnitten und zeichengleich zum gefahrenen Stand.
- **Plan = gefahrener Code:** jede Ersetzung dieses Abschnitts ist beim Einspielen mitgeschnitten und hier eingesetzt; die Anwendung auf den HEAD-Stand unterscheidet sich vom gefahrenen Modul nur in den Stub-Zeilen für Aufgabe 6 (37 Zeilen: der Vergessen-Aufruf, der Ersatz für `garetienVerbundStageEintraege`, `garetienVerbundZusammenlegbar` samt wörtlichem 3h-Block, ein Export); die Tests sind zeichengleich. Nach dem Abgleich mit Aufgabe 6/7 erneut gefahren: 544 Dateien, 0 rot.

### Aufgaben 11 und 12 (Blöcke und Leisten)

**Angeglichen an den echten Endstand von Aufgabe 9** (Nachtrag 14.09.2026, Punkte 1–5)
1. **Zielwahl und Namensfeld in Block C, je genau einmal.** `garetienIdentitaetMarkup` ruft `garetienZielwahlMarkup` (samt Siedlung und Umkreis) und `garetienZielNameZeile`; die Rückgabe von `garetienHandlungsMarkup` verliert beide (3e). Der Test zählt Radio-Gruppe, Namensfeld, Siedlung und Umkreis-id je einmal in der Spalte und verlangt F ohne `data-gi-feld`.
2. **`.gi-acts > .gi-ziel` gestrichen** (3h, Punkt 5) — und mit ihr `.gi-acts .gi-insert__row` (Punkt 6), die nach dem Umzug ebenfalls keine Zeile mehr trifft. Abschnitt 10 des Tests verlangt beide weg.
3. **`garetienZielNameZeile` begründet behalten:** sie wird nicht tot, C ist ihr einziger Aufrufer — die Regel „welches Ziel braucht einen Namen" steht so nur einmal. Der Export bleibt (`garetien-zielwahl-ziele.test.js` fährt sie direkt); ihr Kommentar nennt den Aufrufer (3e).
4. **Fremde Tests aus 9 und 10 mit neuer Zusicherung:** `garetien-zielwahl-ziele.test.js` F (Zielwahl und Name in `garetienIdentitaetMarkup`, nicht in der Leiste; Siedlung und Namensfeld im Kasten genau einmal) und I (übernommen: kein Einstellblock) — weiter 144 Zusicherungen; `garetien-offen-ohne-einstellfelder.test.js` B (Block E „Wiki & Quellen") und D (übernommen: kein Block, der Satz steht in A) — 32; `garetien-name-aendern.test.js` (Namensfeld in C, nicht in der Leiste) — 16.
5. **Die CSS-Stelle:** `.gi-block*` unmittelbar vor „Aufgabe 15: die Handlungsleiste", hinter der Zielwahl (~:996–1020) und jeder `.gi-insert`-Regel. Dahinter nur `.gi-acts`, `.gi-acts__titel`, `.gi-acts__grund`, `.gi-acts__knoepfe`, `.gi-naehe` — keine setzt an einem Blockelement eine Eigenschaft der Blockregeln (Abschnitt 10 zerlegt jede Regel; Mutation `.gi-acts { margin-top: 0 }` → rot). Später geht nicht (px-Sperre von `garetien-handlungen.test.js`). Im Browser: Kopfstil in allen vier Fenstern einheitlich.

**Vertragsabweichungen und wie gelöst**
6. **A11 — `garetienBlockMarkup` hat einen sechsten, optionalen Parameter** `zusatz = {blockKlasse, kopfKlasse}`: F braucht `gi-acts`, D und E `gi-insert` (Regler-Verengung). Die fünf Vertragsparameter sind unverändert.
7. **A11 — neue Namen:** `garetienZeilenAbblenden`, `garetienIdentitaetMarkup`, `garetienDarstellungMarkup`, `garetienWikiQuellenMarkup`. Die drei Konstanten des ersten Entwurfs sind gefallen — Aufgabe 9 trägt diese Regeln selbst (`garetienZielNameZeile`, `garetienZielwahlAusGrund`). `garetienEingefuegtWirdMarkup` behält seinen Namen und liefert C, D, E.
8. **A11 — Abblenden:** C über die Bauer von Aufgabe 9; D grau und gesperrt, sobald `garetienZielwahlAusGrund` nicht leer ist; E immer bedienbar.
9. **A11 — Übernommen zeigt nur A und F** (Owner-Nachtrag; Entwurf §3 sagte „nur Anzeige"). Das dreht zwei Zusicherungen aus 9 und 10 um (gesperrter Kasten am übernommenen Objekt, siehe 4); G fehlt dort ebenfalls (Mockup §6).
10. **A11 — gefallen:** `.gi-sec`, `.gi-sec__note`, `.gi-detail > .gi-acts`, `.gi-win .avm-col > .gi-naehe`, `.gi-acts > .gi-ziel`, `.gi-acts .gi-insert__row`. G steht in `.gi-detail`.
11. **A12 — neue Namen und Signaturen:** `garetienZeileMarkup(objekt, istAusgewaehlt, zielMarke)`, `garetienZeileZielMarke`, `garetienListkopfZahlText`, `garetienListkopfAendern`, `avesmapsGaretienAlleAbwaehlen`. `garetienAlleWaehlenZustand` bekommt `istGewaehlt` und liefert `{anzahl, beschriftung: "alle n", gesperrt, alleGewaehlt, teilweise}`; `garetienAlleWaehlenKnopfSetzen(objekte, reiter)` behält den Namen. „alle n" löst auch (Häkchen statt Knopf).
12. **A12 — freie Ausrichtungsregel** am Listenkopf, weil die Liste in der Produktion in `.avm-scroll` steht — gemessen 50,67 gegen 50 (ohne sie 40,67).
13. **A12 — Mockup-Kopf „NEU" und §8 nachgezogen** (Nachtrag): Kopf ohne Großwort mit Doppelpunkt, §8 „gebaut in Aufgabe 9/11/12"; danach 0 × „NOCH NICHT", 0 × `class="neu"`, Vertragstest grün. Die ungenutzte Regel `.neu` bleibt stehen.

**Offen für den Owner**
- **D bei „Stätte", „Ergänzung", „Nur Quelle", „Nichts":** gebaut ist die volle Höhe, grau und gesperrt; Mockup §5 zeichnet eine Zeile („Beschriftung — eine Stätte steht nicht auf der Karte"). Begründung: die Spalte springt nicht (Entwurf §3). Soll die Mockup-Zeile gelten, ändern sich 3a und Abschnitt 5 des Tests.
- A12: das Mockup zeigt auf der Stage „Ziel · Urteil" **ohne** Grund — gebaut ist Marke · Urteil · Grund. Die Zahl im Listenkopf zeigt das Mockup in zwei Fassungen („5 auf der Stage · 5 mit Ziel", „5 Zeilen · 2 Objekte"); gebaut „n von m" bzw. „n auf der Stage · k Objekte".

**Befund am Stand nach Aufgabe 9** (nicht in 11/12 behoben)
- `.gi-win .avm-col:has(.gi-acts [data-handlung="innerorts"]:hover) .gi-insert` samt `:focus-visible`-Zwilling (~:1062–1083) ist tot: der Knopf „Innerorts einfügen" fällt mit Aufgabe 9. Gehört dort gestrichen.

**Annahmen über 5–8** (abgeglichen mit `plan-teil-stage.md`)
- **A5:** der Hinweis-Absatz `gi-anzeigehinweis` bleibt im Skelett — die Skelett-Reihenfolge in `garetien-liste-zeile.test.js` gilt so. `garetienStageHinweisSetzen` wird hier nicht gerufen.
- **A6:** `zustand.stage` hält `{objekt, zusammen}`; gelesen wird nur `.size` und über `avesmapsGaretienStageListe`/`…Hat`.
- **A7:** `garetienVerbundBlockMarkup` endet mit `… + zeilen + knopf` und kennt `zusammen` — 3d ersetzt genau diese Rückgabe; `garetien-verbund-detail`/`-zeile-nicht-klickbar` fahren den exportierten Bauer; `garetien-vokabular.test.js` trägt „Stage importieren · nichts auf der Stage"; `garetienStageZusammenfassung(…).objekte` zählt über `garetienStageItems`.
- **A9 und A10 sind keine Annahme mehr:** Code, CSS, Mockup-Marke und Tests aus `plan-teil-ziel.md` liefen im Worktree.

**Was lief** (Wegwerf-Worktree `garetien-fragmente-verbund` @ `9fccacfbc`, Mockup und Entwurf wie im Koordinator-Worktree; A9 und A10 aus `plan-teil-ziel.md` eingespielt samt deren Stubs für A6; für A12 eine Wegwerf-Attrappe `garetienStageZusammenfassung`; A1–A8 sonst nicht gebaut)
- Nach A9 und A10: **544 Dateien, 0 rot**.
- A11: Schritt 2 rot („auf „Offen" die Bloecke A B C F G: "); danach **77** Zusicherungen, Feld **544 / 0 rot**, Vertrag 12 → 13, Mutationen **12/12** mit Byte-Gegenprobe, Vertragsprobe `width: 16px` rot.
- A12: Schritt 2 rot („der Listenkopf steht im Skelett"); danach **44** Zusicherungen, Feld **545 / 0 rot**, Vertrag 13 → 14, Mutationen **8/8**.
- LF-Spiegel: die 20 berührten Garetien-Tests und der Vertragstest grün.
- Browser (Messseite, echtes Markup und CSS, Gerätepixel 1,5, Fenster offen/stage/uebernommen/staette): `kopfLinks` je Fenster überall 24, Kreis 18×18 bei 11 px, jeder Block nach A `12px/8px/0,67px` (F eingeschlossen), Kopfstil einheitlich, keine doppelte id; Listenkopf-Häkchen 50,67 gegen 50. Dunkles Thema nur gerechnet, nicht angesehen (der Screenshot lief in eine Zeitüberschreitung): Kopffarbe `rgb(201, 169, 126)`, Fenstergrund `rgb(49, 46, 38)` — der Blick in Schritt 5 steht noch aus.
- Block B in der Rückgabeform nach Aufgabe 7 (3d): nur im ersten Probelauf mit Attrappen gefahren, nicht auf dem Stand nach 9 und 10.- Nicht gefahren: PHP-Feld (keine PHP-Datei berührt); nichts gegen die echte Datenbank, nichts auf der Live-Seite.

### Aufgabe 13 (Bestand)

- **Abweichung 1: kein `map_revision`-Stempel am Ende.** Der Hausschreiber stempelt je Region `ecosystem_revision` Zeile 1 und 2, und Zeile 2 steckt über `avesmapsClimateReadStamp` im ETag von `map-features.php`; `map_revision` hebt nur der Durchtrag, wenn er wirklich eine Beschriftung schreibt. Im Test belegt: `map_revision` bleibt über den ganzen Lauf gleich, `ecosystem_revision` Zeile 2 steigt. Ein eigener Schlussstempel wäre ein Stempel ohne Schreibvorgang. Wer ihn trotzdem will: eine Zeile `avesmapsNextMapRevision($pdo)` bei `gesetzt > 0` — dann aber Abschnitt G und E des Tests anpassen.
- **Abweichung 2: fremder Test präzisiert** (`garetien-endpunkt-test.php` :179), statt den Schalter umzubenennen oder den Scanner zu umgehen. Die Alternative wäre `scharf: true` statt `apply: true` — dann gälte in einem von vier Bestandsläufen ein anderer Schaltername. Der präzisierte Wächter ist enger als der alte (Mutation M13: eine zweite `apply`-Tür fällt weiterhin).
- **Abweichung 3: der Admin-Riegel steht zweimal** (Endpunkt-Liste + Bibliothek). Die Bibliothek lädt `auth.php` per `require_once` — sicher, weil der Endpunkt es vorher blank lädt; wer die Bibliothek je von einer Datei laden lässt, die `auth.php` danach blank lädt, bekommt „Cannot redeclare".
- **Annahme:** „Ziel Fläche" wird über den Nachschlag in `ecosystem_region` entschieden, nicht über `after_json.ziel` (die Formwahl beim Import kann die Form geändert haben). `nur_quelle:`-Vermerke aus Aufgabe 8 liefern keine Region und zählen als `andere_ziele`.
- **Aufgabe 2 nachziehen:** ihr Bestands-Absatz sagt „Keine Reparatur gebaut" und nennt eine SQL, die nur nackte Vermerke zählt (Untergrenze). Beides sollte auf Aufgabe 13 und die SQL aus Schritt 6a zeigen.
- **Gebaut und gemessen auf** Zweig `garetien-fragmente-verbund` @ `9fccacfbc` **plus nur Aufgabe 2** (ihre Codeblöcke aus `plan-teil-server.md` eingespielt, deren Tests grün). Aufgaben 1 und 3–12 lagen NICHT darunter. Der Test ruft `avesmapsGaretienUebernehmen($pdo, $runId, [$item], ['id' => 7], null, [$item => $rumpf])` wie Aufgabe 2 — ändert eine spätere Aufgabe diese Signatur oder die Flächen-Anlage (Aufgabe 3 Aufräumen, Aufgabe 8 Rumpf), muss dieser Test mitgezogen werden.
- **Rot/grün:** rot vor der Umsetzung (require-Fatal, Exit 255, gesehen) · grün danach: 6 `OK`-Zeilen (63 `assert`-Aufrufe im Quelltext, mehrere in Schleifen) · Nachbarn grün: `garetien-endpunkt-test`, `garetien-abbau-waechter-test` (15 Dateien), `garetien-verbund-uebernahme-test` · Feld **408** PHP-Dateien, rot nur `link-url-test.php` · **Mutationen 14 von 14 gefangen** (ohne `change_type`-Filter, ohne `kind`-Filter, ohne Neu-Lesen, Widerspruch als „schon gesetzt", ohne Adressprüfung, ohne Bibliotheks-Riegel, inaktive nicht ausgenommen, `ab_id` wirkungslos, `remaining` 0, Trockenlauf schreibt, DB-Text in der Antwort, Endpunkt ohne Admin-Eintrag, zweite `apply`-Tür, scharf ohne Boolean), jede Byte-genau zurückgesetzt.
- **Getragen, nicht behoben:** das read-then-write-Fenster zwischen Neu-Lesen und Schreiben (Millisekunden, §6.9-Klasse). Und: `adresse_passt_nicht`-Regionen werden nur gezählt, nicht gelistet — will der Owner sie sehen, ist das eine Stichprobenliste mehr.
- Wegwerf-Worktree `wt-bestand` entfernt, `worktree prune` gefahren; `wt-verbund` unberührt.
