# Strukturbefund 2026-08-24

Bestandsaufnahme am Stand `9ed1ccd`. Gemessen, nicht geschätzt — jede Zahl in diesem
Dokument ist mit einem Befehl reproduzierbar, der danebensteht.

Der Befund in einem Satz: **das Projekt ist nicht unordentlich, es ist blind.** Die
Bausubstanz ist besser als ihr Ruf (Tokendisziplin greift, Namenskollisionen sind
praktisch weg, die M0–M7-Arbeit ist echt). Was fehlt, ist eine Rückmeldung, die schneller
ist als der Owner. Jeder Fehler der letzten zwei Wochen ist auf demselben Weg ans Licht
gekommen: die Live-Seite, ein Satz vom Owner, ein Rückbau.

---

## 1. Der Stand in Zahlen

| | |
|---|---|
| JS (ohne third-party) | 169.151 Zeilen, 278 Dateien |
| PHP | 174.411 Zeilen, 560 Dateien |
| CSS | 32.441 Zeilen, 76 Dateien |
| Skript-Tags in `index.html` | **249**, 5,46 MB unkomprimiert |
| Testfeld | 511 Tests, **alle grün**, 35 s Laufzeit |
| Commits letzte 14 Tage | 50 — davon **19 `fix`, 1 Revert** |

Die letzte Zeile ist die wichtigste: **40 % der Arbeit der letzten zwei Wochen war
Nacharbeit.** `api/app/map-features.php` hat 4 Fix-Commits auf 2 neue bekommen,
`api/_internal/wiki/settlements.php` 3 auf 2, `api/_internal/app/coat-display.php` 3 auf 2.

```
git log --since="14 days ago" --pretty=%s | sed -E 's/^([a-z-]+).*/\1/' | sort | uniq -c
```

Das ist keine Schlamperei. Das ist die Kennzahl eines Regelkreises, dessen einziger
Sensor ein Mensch mit einem Telefon ist.

---

## 2. Die vier strukturellen Ursachen

### 2.1 Fehler werden verschluckt — 310 von 621 catch-Blöcken (50 %)

```
php -d zend.assertions=1 api/_internal/__tests__/stumme-catches-test.php
→ 310 von 621 stumm (Stand vor dem 24.08.), 26 error_log im GANZEN Backend
```

`api/app/map-features.php` — der Endpunkt, dessen Ausfall die Karte für jeden Besucher
leert — trug allein **10** davon. `api/_internal/map/features.php` 22, `lore.php` 13,
`citymap-sync.php` 10.

🪤 **Die erste Messung dieses Berichts sagte 289, und sie war falsch.** Sie zählte mit einem
Regex, und ein Regex sieht Kommentare als Code — in *beide* Richtungen: ein Beispiel
`} catch (Throwable) { return []; }` in einem Docblock zählte als stummer Block, und jeder
catch, dessen **Kommentar** das Wort `throw` oder `error_log` enthielt, galt als behandelt.
Die token-genaue Zählung (`token_get_all`) liegt bei **310**. Der Bestand ist also 21 Blöcke
schlechter als zuerst berichtet — und als Sperrklinke hätte die Regex-Fassung genau diese 21
als Wachstum durchgelassen.

Was das kostet, steht wörtlich in der Revert-Botschaft von `91587cd`:

> Es ist also ein Laufzeitfehler im neuen Wappen-Pfad, den map-features.php in seinem
> eigenen `catch (Throwable)` verschluckt. **🔧 NICHT DIAGNOSTIZIERT, nur zurückgebaut.**

Der Deploy war grün, 505 Tests waren grün, die Karte war tot, und der Grund war von
außen nicht ermittelbar. Derselbe Mechanismus steht in AGENTS.md dreimal als eigene
Lehre: die HY093-Falle von „Was ist hier?" (`ok:true` mit leerem Inhalt), der inerte
`catch { return []; }` bei den Vorkommen, die stille MySQL-Kürzung der Tempowerte.

**Es sind nicht drei Lehren. Es ist eine.** Eine Absage ohne Grund ist von „hier ist
nichts" nicht zu unterscheiden — und ein Projekt, dessen Daten überwiegend „hier ist
nichts" bedeuten dürfen, kann diesen Unterschied nirgends selbst bemerken.

### 2.2 Das Testfeld prüft Quelltext, nicht Verhalten

| | |
|---|---|
| JS-Tests, die **nur Quelltext lesen und regexen** | 101 von 240 (42 %) |
| Tests, die auf CSS-/HTML-**Text** regexen | 101 |
| Tests, die einen **Endpunkt ausführen** | **0** |
| Tests, die gegen **MySQL** laufen | **0** (73 gegen SQLite) |

Ein Testfeld aus 511 grünen Tests, das in 35 Sekunden durchläuft, ist ein Geschenk —
und es kann die zwei Fehlerklassen, die tatsächlich live gehen, prinzipiell nicht sehen:

* **Laufzeitfehler im Endpunkt.** Nichts im Feld ruft je `api/app/map-features.php` auf.
  Der 500er wäre von einem einzigen `curl` gefallen.
* **MySQL-gegen-SQLite.** AGENTS.md dokumentiert den Fall selbst: eine Umbauform, die
  SQLite akzeptiert und MySQL mit Error 1093 ablehnt, wurde **von einem grünen Test
  erzwungen**. Der Test hat die Regression nicht verhindert, er hat sie verlangt.

🪤 **Und die Rauchtest-Ebene existiert bereits — sie ist nur ausgeschaltet.**
`tools/svg-export/__tests__/endpunkt-ablauf.js` fährt einen echten `php -S` und geht 10
HTTP-Schritte durch. Sie heißt bewusst nicht `*.test.js`, „damit ein Portproblem nicht
das Deploy-Tor schließt". Das war 2026-08-23 eine vernünftige Einzelentscheidung und ist
heute der Grund, warum die einzige Bauform, die den Revert verhindert hätte, nirgends läuft.

### 2.3 Sechs handgeschriebene Linter statt eines Linters

| Datei | Zeilen | Was sie in Wahrheit ist |
|---|---|---|
| `api/_internal/app/__tests__/map-features-variablen-scope-test.php` | 333 | `no-undef` |
| `js/app/__tests__/details-summary-scope.test.js` | 229 | Scope-Prüfung |
| `api/_internal/map/__tests__/const-vor-benutzung-test.php` | 147 | „use before define" |
| `js/app/__tests__/css-comment-balance.test.js` | 110 | CSS-Parser |
| `js/app/__tests__/scope-hint.test.js` | 108 | Quelltext-Regex |
| `js/ui/__tests__/inline-script-syntax.test.js` | 81 | `node --check` |
| **Summe** | **1.008** | |

Und der Bug vom 24.08. („das Menü bei Orte bearbeiten lässt sich nicht öffnen"): zwei
`function setCoatsMenuOpen` in derselben Datei, der Klick-Handler doppelt registriert,
der zweite schloss, was der erste öffnete. Die Commit-Botschaft sagt selbst, warum kein
Test es sah — *„eine Anwesenheitsprüfung kann eine Verdopplung grundsätzlich nicht sehen"* —
und die Antwort darauf war ein **weiterer** Zähltest.

Der Name dieser Regel ist `no-redeclare`. Sie ist seit 2013 in ESLint eingebaut. Das
Projekt hat stattdessen zum siebten Mal einen Einzelfall festgenagelt.

**Das ist das Muster hinter der Nacharbeitsquote:** auf jeden Fehler antwortet ein Test
für *genau diesen Fehler*, nie ein Riegel für seine *Klasse*. Das Testfeld wächst linear
mit den Vorfällen, die Fehlerklassen bleiben.

Es gibt **weder ESLint noch PHPStan noch `php -l` noch `node --check`** im Repo oder im
Deploy-Tor.

### 2.4 Der größte God-File des Projekts ist eine HTML-Datei

M5 hat die sichtbaren `.js`-Riesen zerlegt — gründlich und gut dokumentiert. Übersehen
wurde dabei, wo der meiste Code wirklich liegt:

| Datei | Zeilen ges. | davon **Inline-JS** |
|---|---|---|
| `html/wiki-sync-settlement-editor.html` | 5.063 | **4.314** |
| `html/landschaften-editor.html` | 2.668 | 2.499 |
| `html/game-literature-editor.html` | 2.311 | 1.697 |
| `html/citymap-editor.html` | 2.266 | 1.626 |
| `html/wiki-sync-monitor.html` | 1.854 | 1.435 |
| **Summe über alle Seiten** | | **13.988 Zeilen Inline-JS** (+ 2.152 Inline-CSS) |

4.314 Zeilen Inline-JS sind mehr, als `review-wiki-sync.js` vor dem Split hatte. Dieser
Code ist für jedes Werkzeug unsichtbar: kein Linter sieht ihn, kein Test kann ihn
`require`n, keine Suche nach Dateinamen findet ihn, und keine Wiederverwendung ist
möglich. **Der Doppel-Handler-Bug vom 24.08. lebte genau dort** (`5882e0d` entfernt 21 Zeilen aus
`html/wiki-sync-settlement-editor.html`) — und `inline-script-syntax.test.js` existiert
nur, weil dieser Code für jedes andere Werkzeug unsichtbar ist.

---

## 3. Drei weitere Befunde, geringer im Rang

### 3.1 Kein Trichter für Anfragen im Frontend

`js/app/api-client.js` hat 635 Zeilen und wird von **einer** Datei genutzt. **61 Dateien
rufen `fetch(` direkt.** Genutzt wird davon in der Breite nur `apiErrorMessage` (29 Dateien).

Folge: jede Aufrufstelle erfindet ihre Fehlerbehandlung neu, 25 Dateien tragen ein
`.catch(() => [] / null)` (48 Stellen). AGENTS.md nennt genau diesen Griff bei der
Wiki-Zuweisung als den Vertragsbruch, der die echte Zuweisung löscht — *„eine Zusage, die
mit nichts auflöst, ist der schlimmere Fall"*. Der Riegel steht heute in **einem** Bauteil.
Es gibt keinen Ort, an dem er für alle stünde.

### 3.2 Jeder anonyme Besucher lädt den Editor mit

```
5.458 KB JS über 249 Dateien  —  davon 1.510 KB (28 %) aus js/review, js/territory, js/pages
```

53 Skripte aus `js/review/` stehen in `index.html`. Ein Besucher, der die Karte ansieht,
lädt den WikiSync-Panel, die Sozial-Netz-Oberfläche und die Konfliktliste vollständig mit.
AGENTS.md vermerkt das für die Wiki-Zuweisung („sieben neue Skripte, 212 KB") als
Einzelfall — es ist der Normalfall.

Zugleich ist die Skriptliste in `index.html` ein von Hand gepflegter Ladereihenfolge-Vertrag
über 249 Zeilen. Jedes neue Modul verlängert ihn, und die Reihenfolge ist nirgends geprüft.

### 3.3 AGENTS.md ist zur Hälfte unlesbar geworden

| | |
|---|---|
| AGENTS.md gesamt | 132.748 Bytes ≈ **33.200 Tokens** |
| davon §11 „Documentation index" | 101.992 Bytes — **77 %** |
| längster Einzeleintrag („Hierher reisen") | 15.004 Bytes ≈ 3.700 Tokens |

§11 heißt „Index" und ist keiner. Es ist ein Vorfallsarchiv: 40 Feature-Erzählungen mit
je 5–15 KB, ineinander verschachtelt, mit Korrekturen der Korrekturen („🪤 hier stand
bis 15.08. das Gegenteil").

**Der Preis ist doppelt.** Erstens zahlt jede Sitzung ~33.000 Tokens, bevor sie eine Zeile
Code gesehen hat — bei 200k Kontext ein Sechstel, und in einer langen Sitzung genau das,
was am Ende fehlt. Zweitens, und schwerer: ein Text dieser Länge wird überflogen, und ein
überflogener Warnhinweis wirkt nicht. Der Beleg steht in AGENTS.md selbst:

> Zwei der vier Regressionen vom 10.08. standen **wörtlich als Warnung im eigenen
> Entwurf** und wurden nicht gebaut. Es fehlte kein Wissen, sondern das Abhaken.

Das ist die richtige Diagnose mit der falschen Konsequenz. Die Konsequenz war, mehr
Prosa zu schreiben. Was fehlt, ist nicht Disziplin beim Lesen, sondern dass die 💣-Zeilen
dort stehen, wo man sie beim Arbeiten *nicht umgehen kann* — im Testfeld, nicht im Fließtext.

### 3.4 Was gut ist (damit es nicht wegrationalisiert wird)

* **Tokendisziplin greift.** 4.539 `var(--…)`-Verwendungen gegen 190 verirrte Hex-Werte in
  25 Dateien. Die in AGENTS.md genannten „1000+ hardcoded hex across 38 CSS files" sind
  abgearbeitet. 137 `!important` auf 32k Zeilen CSS ist wenig.
* **Namenskollisionen sind praktisch weg.** 3.492 globale Bezeichner im Browser-Scope,
  davon genau **5** doppelt vergeben. Bei 249 Skripten ohne Modulsystem ist das
  bemerkenswert.
* **Das Deploy-Tor existiert und funktioniert.** Dass ein roter Test nichts hochlädt, ist
  die richtige Bauform; die Kommentare darin sind die beste Dokumentation im Repo.
* **Die Fehleranalysen sind exzellent.** Die Revert-Botschaft von `91587cd` nennt Beleg,
  Gegenprobe, Verdacht und offene Frage getrennt. Das Problem ist nicht die Denkschärfe,
  es ist, dass sie erst *nach* dem Livegang zum Einsatz kommt.

---

## 4. Lösungsansätze

Vier Stufen, nach Verhältnis von Wirkung zu Risiko sortiert. Stufe 0 und 1 sind für den
Besucher **unsichtbar** und fallen damit nicht unter die Einzeln-live-Regel (§9).

### Stufe 0 — Sehen, was schiefgeht ✅ **umgesetzt 24.08.2026**

**0a · Ein Diagnose-Trichter** (`2a80c4b`, `2a50bd3`). Zwei Funktionen in
`api/_internal/bootstrap.php`:

```php
} catch (Throwable $fehler) { return avesmapsSchlucke($fehler, 'kontext', []); }
} catch (Throwable $fehler) { avesmapsSchluckProtokoll($fehler, 'kontext'); … }
```

Regel danach: **ein `catch` antwortet, wirft weiter, oder geht durch den Trichter.** Kein
vierter Fall. Alle **zehn** Stellen in `map-features.php` sind umgestellt — der Endpunkt hat
jetzt null stumme catches und liefert dabei exakt dieselben Rückfälle wie vorher.

🔴 **In zwei Commits, und das ist tragend.** `bootstrap.php` beschreibt in seinem eigenen
Kommentar das Fenster: der Deploy lädt Datei für Datei per SFTP, ohne Staging, und STRATOs
opcache prüft jede Datei einzeln mit 2–4 Minuten Verzug. Ginge ein Aufrufer vor seiner
Bibliothek live, riefe `map-features.php` minutenlang eine undefinierte Funktion — ein Fatal
auf dem meistgerufenen Endpunkt, also der Ausfall vom 24.08. noch einmal, diesmal durch das
Werkzeug gegen ihn. **Erst `2a80c4b` live und den Lauf abwarten, dann `2a50bd3`.**

💣 Zwei Deckel gegen das geteilte Protokoll von STRATO: derselbe Fall einmal je Prozess
(Schlüssel aus Kontext + Klasse + Fundstelle, **nicht** aus der Meldung — die kann eine
wechselnde ID tragen), und höchstens 20 verschiedene Fälle je Prozess.

**0b · Drei Sperrklinken** (`47208f5`). Sie verlangen keine Verbesserung, sie verbieten eine
Verschlechterung: stumme catches ≤ 300, Dateien mit direktem `fetch(` ≤ 60, Inline-JS-Zeilen
≤ 13.988. Beide Tests tragen eine **Selbstprobe** („findet der Zähler überhaupt noch etwas?"),
und die hat sich sofort bezahlt gemacht — die erste Fassung nahm `dirname(__DIR__)` und zählte
damit nur `api/_internal`: 345 statt 621 Blöcke, grün und wertlos. Sinkt ein Wert, gibt es
einen **Hinweis statt eines Fehlschlags**; in einem geteilten Arbeitsbaum soll niemandes
Verbesserung rot sein.

**0c · Syntaxprüfung im Deploy-Tor** (`2d403d3`). Vor jedem Test, 606 PHP- und 535
JS-Dateien, zusammen rund acht Sekunden — im bestehenden Testschritt, weil php-cli dort schon
installiert ist. Der `const`-Fatal vom 19.08. wäre hier gefallen.

⚠️ **Was Stufe 0 nicht kann:** einen Laufzeitfehler. Der Ausfall vom 24.08. war syntaktisch
einwandfrei. Er wäre jetzt *diagnostizierbar* — verhindert wird er erst durch Stufe 1.

### Stufe 1 — Die zwei blinden Flecken schließen (CI-only, unsichtbar)

**1a · Rauchtests gegen echte Endpunkte** ✅ **umgesetzt 24.08.2026** (`4020907`, `47f49ec`).
`tools/rauchtest/` fährt einen eigenen `php -S` und fragt **jeden** Endpunkt einmal mit GET an
— 91 Stück in 0,5 Sekunden. Geprüft wird vierfach: der Rumpf ist nicht leer, kein 404, keine
ausgelaufene PHP-Meldung im Rumpf, und die Hülle des Vertrags (`ok:true`, oder `ok:false`
**mit** `error.code`). Er läuft ohne Workflow-Änderung im Tor mit — das Muster
`tools/**/__tests__/*.test.js` findet ihn von selbst.

🔴 **Die Liste wird entdeckt, nicht gepflegt.** Eine Handliste veraltet beim ersten neuen
Endpunkt und ist dann grün, weil sie das Neue gar nicht kennt. Genau **eine** dokumentierte
Ausnahme von der JSON-Hülle: `api/app/coat.php`, ein Bild-Proxy, der in seiner eigenen
Kopfzeile sagt „Liefert Bild-Bytes (kein JSON)" — auf leeren Rumpf wird er trotzdem geprüft.

🚩 **Sein erster Lauf fand fünf Endpunkte mit HTTP 500 und null Bytes:** die drei unter
`api/edit/admin/`, `import-geo.php` und `kartenarchiv.php`. Alle fünf riefen
`avesmapsLoadApiConfig()` **bar** auf Dateiebene, während die übrigen zwanzig ihn im `try`
haben — ohne `config.local.php` also ein Fatal mit leerem Rumpf. Live fällt das heute nicht
auf, weil die Konfiguration da ist; es fällt genau dann auf, wenn sie einmal fehlt, und dann
ohne jeden Hinweis. Repariert in `4020907`, jetzt 503 `service_unavailable` wie überall sonst.

💣 **Was er fängt — und die Grenze gehört dazu:**

| | |
|---|---|
| ✔ Parse-Fehler, fehlendes `require`, undefinierte Funktion (der opcache-Fensterfall), `const` nach Benutzung | gemessen: HTTP 500 mit **0 Bytes** — und `php -l` sieht davon nur den ersten |
| ✔ der halbe Fatal: HTTP 200, gültiges JSON **und** eine Warning davor | fällt sonst niemandem auf, weil die Antwort sich parsen lässt |
| ✘ ein Laufzeitfehler **innerhalb** des try-Blocks | der Ausfall vom 24.08. lieferte eine saubere Hülle — **diesen Test hätte er nicht gerissen** |

Die letzte Zeile ist eine Korrektur an diesem Bericht: hier stand, 1a hätte den Revert
gefangen. Hätte er nicht. Dafür braucht es 1b.

**1b · MySQL im Testfeld.** GitHub Actions bietet einen MySQL-Service-Container ohne
Zusatzkosten. Erst damit kann der Rauchtest `ok:true` verlangen statt nur „antwortet
strukturiert" — und erst dann ist die Klasse geschlossen, an der der 24.08. gescheitert ist.
Zugleich fällt die Error-1093-Klasse weg. Die 73 SQLite-Fixtures bleiben; sie hören nur auf,
die einzige Wahrheit zu sein.

⚠️ **Zwei Dinge sind vorher zu prüfen** (stehen auch im Kopf des Rauchtests): ob ein
Edit-Endpunkt *vor* `avesmapsRequireUserWithCapability` Arbeit verrichtet — dann darf er nicht
blind angefragt werden —, und ob `api/edit/wiki/dump.php` dabei anfängt, einen 40-MB-Dump zu
holen.

**1c · ESLint + PHPStan (Stufe 1–2), nur in CI.** Ersetzt die 1.008 Zeilen Ersatz-Linter
durch eine Konfigurationsdatei und fängt dabei die ganze Klasse statt des Einzelfalls:
`no-redeclare` (Doppel-Handler, 24.08.), `no-undef` (Scope-Fehler, 24.08.),
`no-unused-vars`, `no-fallthrough`.

💣 **Mit einer Einschränkung, und sie ist genau der Punkt aus §2.4:** der Doppel-Handler
stand in `html/wiki-sync-settlement-editor.html`, also im Inline-JS. Dorthin sieht ESLint
nur mit `eslint-plugin-html` — oder gar nicht, solange der Code inline bleibt. Die
Linter-Abdeckung ist damit erst nach Stufe 3.1 vollständig.

🔴 **Das bricht „no build step" nicht.** Ausgeliefert wird weiterhin unveränderter
Quelltext; `package.json` trägt ausschließlich `devDependencies`, `npm ci` läuft im
Workflow, `node_modules/` steht nicht in der Deploy-Allowlist.

### Stufe 2 — Das Gedächtnis benutzbar machen (unsichtbar, ein halber Tag)

**2a · §11 aufteilen.** AGENTS.md behält §1–§10 und §12 (~8.000 Tokens statt 33.200).
§11 wird zu einem echten Index: **eine Zeile je Feature** mit Pfad. Die 40 Erzählungen
ziehen nach `docs/features/<name>.md` — inhaltlich unverändert, nur getrennt.

Der Gewinn ist nicht Ästhetik. Eine Sitzung, die an den Kraftlinien arbeitet, lädt dann
`docs/features/kraftlinien.md` und nicht die Geschichte des Social-Media-Hubs. Konkret:
~25.000 Tokens mehr Arbeitsspeicher pro Sitzung, und Warnungen, die man findet, statt
solcher, an denen man vorbeiscrollt.

**2b · Die 💣-Zeilen wandern, wo sie können, ins Testfeld.** Jede Zeile, die als Regel
formuliert ist („nur diese zwei Hüllen", „der Riegel steht in allen vier Erzeugern",
„keine ID-Regel auf einer Listenzeile"), ist ein Kandidat für eine Sperrklinke. Eine
Regel im Fließtext ist eine Bitte; dieselbe Regel als roter Test ist eine Regel.

### Stufe 3 — Bausubstanz (teils sichtbar, Owner-Freigabe, einzeln live)

Nach Wirkung geordnet, jede für sich lieferbar:

1. **Inline-JS aus `html/*.html` herausziehen**, beginnend beim Ortseditor (4.314 Zeilen
   → `js/pages/ortseditor-*.js`). Danach ist der größte Editor des Projekts zum ersten
   Mal linter- und testbar, und `inline-script-syntax.test.js` wird überflüssig.
   ⚠️ `ASSET_VERSION` bzw. die Stempelkette beachten (§7).
2. **Rollenpakete für die Skriptliste.** `index.html` lädt die öffentliche Menge; die 63
   Editor-Skripte kommen erst nach der Anmeldung nach — die Maschinerie dafür steht
   bereits in `territory-editor-inline-host.js`. Spart jedem Besucher 1,5 MB und macht
   den Ladereihenfolge-Vertrag zu Daten statt zu 249 handgepflegten Zeilen.
3. **Ein Anfragen-Trichter im Frontend.** Ein `avesmapsAnfrage()`, das bei `!response.ok`
   und bei `ok:false` **wirft** und niemals einen leeren Rückfall auflöst. Bestehende
   Aufrufer wandern nach und nach; die Sperrklinke aus 0b hält die Zahl.

---

## 5. Empfehlung

**Stufe 0 und Stufe 1a sind umgesetzt (24.08.2026). Als nächstes 1b und 1c.** Zusammen sind sie für den Besucher unsichtbar
und hätten — soweit von hier aus prüfbar — den Revert vom 24.08., den Doppel-Handler, den
Scope-Fehler und den `const`-Fatal vom 19.08. allesamt vor dem Push gefangen.

🔴 **Beim Zusammenführen nach `master`:** `2a80c4b` (der Trichter) muss vor `2a50bd3` (seinen
Aufrufern) deployt sein — siehe Stufe 0a. Ein einzelner Push beider Commits fällt in das
opcache-Fenster.

Danach Stufe 2, weil sie jede folgende Sitzung billiger macht.

Stufe 3 ist echte Bausubstanz und kann warten — sie wird deutlich leichter, sobald 0 und
1 stehen, denn dann sagt einem etwas anderes als die Live-Seite, ob ein Umbau
funktioniert hat.

> Ein Satz zum Mitnehmen: das Projekt hat sich angewöhnt, aus jedem Vorfall eine
> **Erzählung** zu machen. Erzählungen sind gut für Menschen und teuer für Maschinen.
> Aus dem gleichen Vorfall eine **Sperrklinke** zu machen, kostet einmal mehr Arbeit und
> danach nie wieder Aufmerksamkeit.
