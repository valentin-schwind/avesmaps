# Das Fenster „Garetien Importer" — Bauplan

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe
> umzusetzen. Die Schritte tragen Checkboxen (`- [ ]`).

**Ziel:** Ein verschiebbares Fenster über der laufenden Karte, in dem ein Editor die 289
Gewässerobjekte aus garetien.de / koschwiki.de Objekt für Objekt durchgeht — anhaken, auf der
Karte sehen, übernehmen oder liegenlassen.

**Architektur:** Der Server rechnet, das Fenster zeigt. Urteil, Grund, Geometrie und die Liste
der getroffenen Abschnitte stehen fertig in `sync_plan_item.after_json`; der Browser wählt aus,
blendet ein und schickt Häkchen. Geschrieben wird ausschließlich über die **vorhandene**
Übernahme-Vorschau (`api/edit/wiki/sync-plan.php`, `kind: 'garetien'`).

**Tech-Stack:** PHP 8 (strict types), PDO/MySQL + SQLite-Prüfstand, Tests mit `assert()` unter
`php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll`.
Frontend: vanilla JS ohne Build, Node-Tests mit `node <datei>`. Leaflet 1.9.4.

**Entwurf:** `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md` (der
Auftrag) · `docs/garetien-importer-mockup.html` (**die Vorlage**) ·
`docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md` (die Architektur darunter).
Alle drei zusammen lesen — der Plan argumentiert aus ihnen.

---

## Globale Vorgaben

Gelten für **jede** Aufgabe. Jede Zeile steht wörtlich im Auftrag oder im Mockup.

- 🔴 **KEIN zweiter Schreibweg.** Geschrieben wird nur über `api/edit/wiki/sync-plan.php` mit
  `kind:'garetien'` (`select` · `undecline` · `apply`). `api/edit/map/garetien-import.php` hat
  bewusst **kein** eigenes `apply` und bekommt auch keins. (Auftrag §5.4)
- 🔴 **KEINE zweite Übernahme-Vorschau, KEINE zweite Listenzeile.** Die Arbeitsliste trägt
  `.avm-row` (`css/components/editor-row.css`), die Bilanz kommt aus
  `js/review/review-list-balance.js`, die Übernahme **ist** `js/review/sync-plan-sheet.js`.
  AGENTS.md §11: zwei Zeilenrezepturen, das ist die Obergrenze. (Auftrag §5.4)
- 🔴 **KEINE zweite Rechnung im Browser.** Urteil, Grund und Geometrie (fertig in unseren
  Karteneinheiten) kommen aus `sync_plan_item.after_json`. Der Browser transformiert keine
  Koordinate, misst keinen Abstand und bildet kein Urteil. (Auftrag §5.4)
- 🔴 **NICHTS, WAS SICH NICHT WIEDER ENTFERNEN LÄSST.** Nichts außerhalb von
  `api/_internal/import/` darf `garetien_import_row` oder `garetien_import_run` kennen — kein
  Fremdschlüssel, kein `JOIN`, kein Filter, keine Anzeige, kein Test einer Nutzoberfläche.
  Heute eingehalten: genau **fünf** Dateien, alle im Importer. (Auftrag §5.5)
- 🔴 **Kein Löschweg**, auch nicht „nur fürs Aufräumen". Bis zum Übernehmen ja, danach nie.
  (Auftrag §5.5)
- 🔴 **Die Lizenzanzeige gehört NICHT in den Importer.** `license`/`attribution` sind Spalten auf
  `sources`, gerendert von `js/ui/feature-source-markup.js`; die Sammelangabe ist
  `legal.garetien.body`. Der Importer *schreibt* die Werte einmal beim Übernehmen — mehr nicht.
  Sonst nimmt der Abbau die Namensnennung von 289 Objekten mit: kein Schönheitsfehler, ein
  Lizenzbruch. (Auftrag §5.5)
- 🔴 **Der Knopf „Garetien Importer" ist ZUNÄCHST NUR FÜR ADMINS** (Owner 27.08.2026). Der
  Endpunkt `api/edit/map/garetien-import.php` verlangt ohnehin schon `admin`.
- ⚠️ **Kein blaues Chrome** (AGENTS.md §12). Blau nur, wo Farbe DATEN kodiert — auf der Karte
  (`--color-path-flussweg`), nie im Fenster.
- **Nichts hartkodieren.** Jede Farbe, jeder Radius, jeder Abstand ist ein Token aus
  `css/base/tokens.css`. Kein Token da? Erst das Token, dann benutzen. (AGENTS.md §12)
- **Sprache:** Kommentare, Commit-Betreffe und Doku auf **Deutsch** (AGENTS.md §8).
- **Commit-Scope:** `garetien:` — dasselbe Wort wie in Stufe 1. 💣 Nicht `verlauf:` (gehört dem
  Wiki-Kurs-Sync der Wege), nicht `import:` (zu allgemein).
- 💣 **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9). Die Aufgaben 9–16 sind sichtbar:
  ein Commit, ein Push, der Blick des Owners, dann der nächste. Kein Bündel.
- 💣 **Der Arbeitsbaum ist GETEILT.** Nie `git add -A`, nie `git add .`, nie `git commit -a` —
  immer nur die eigenen Pfade, einzeln benannt. Vorher `git status`; fremde Dateien stehen
  lassen. Bei abgelehntem Push: `fetch` + `rebase origin/master`, nie force.
- 💣 **Vor jedem Push läuft das GANZE Testfeld** mit dem Muster des Workflows, nicht nur die
  eigenen Tests (AGENTS.md §9), parallel:

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste
```

  💣 Die Klammer um **beide** Gruppen ist tragend — ohne sie fährt der Lauf 21 von 312 Dateien
  und meldet „null rot". 💣 Kein `2>&1` auf die Ergebnisdatei. Gegenprobe, die nichts kostet:
  `… -print0 | tr -dc '\0' | wc -c` muss die Zahl aus
  `.github/workflows/deploy-avesmaps-strato.yml` ergeben. PHP analog, mit den drei Erweiterungen.

### 🔴 DAS TOR VOR DEM ERSTEN ECHTEN IMPORT

Der Plan baut das **Fenster**. Das Fenster zeigt Vorschläge und schreibt nichts, bis jemand
„Angehakte übernehmen" drückt. **Bauen und Übernehmen sind trennbar — und sie sind hier
getrennt.**

🔴 **Bevor zum ersten Mal wirklich übernommen wird, müssen diese drei Dinge stehen. Alle drei
sind ausserhalb dieses Plans, und keines ist optional:**

| | Warum | Zahl |
|---|---|---|
| **Der Koordinaten-Fix** (Aufgabe 4b) | importierte Wege landen sonst an der Diagonale gespiegelt | 152 Flusswege in Stufe 1 |
| **Der Wege-Subtyp `Bach`** (Owner 27.08.) | sonst liegen Bäche als **befahrbare** Flusswege in der Karte und müssen einzeln umgetragen werden | **143 von 289** Objekten der Stufe 1 |
| **Die fehlenden Ortsarten** (`Burg`, `Gasthaus`, `Stadtviertel`) | sonst verlieren 568 Bauwerke ihre Art — nachträglich Handarbeit an jedem einzelnen | erst ab Stufe 4 |

⚠️ **Die ersten beiden gelten schon für Stufe 1.** Wer das Fenster fertig baut und dann
„Übernehmen" drückt, ohne sie, richtet genau den Schaden an, gegen den dieses Fenster gebaut
wurde: Objekte, die falsch in der Karte liegen und einzeln von Hand zu reparieren sind.

⭐ Deshalb steht es hier und nicht in einer Notiz: die Aufgaben 9–16 dürfen **gebaut und
angesehen** werden, ohne dass die drei stehen. Nur der Knopf, der schreibt, wartet.

### Gemessene Zahlen — nicht neu herleiten

289 Quellzeilen: **199** neu vorangehakt · **32** ungehakt mit Zweifel · **3** widersprüchlich ·
**49** deckt sich · **6** übersprungen. Plan rechnen: **0,35 s**. Trefferschwelle **2,0**
Karteneinheiten, gemessen zum nächsten **Stützpunkt** (`AVESMAPS_GARETIEN_PROBEPUNKTE = 16`).
Der Große Fluss liegt bei uns in **38** Abschnitten, **158 von 526** Namensgruppen sind
mehrteilig. **25 von 76** Geometrietreffern trugen bei uns keinen Namen. Affin schlägt Warping
(1,24 gegen 2,30 Meilen). **360** Zeilen ohne Position (`2000000 2000000` → 1222 / −115,6), alle
im Kosch, 359 davon auf `kosch/Ortschaften_1`. Die einzige ungemessene Zahl im Mockup ist die
Aufteilung 25 Ergänzung / 24 deckt sich (dort mit ✱); beide zusammen bleiben 49.

---

## Dateiplan

**Server — alles innerhalb des Importers, verschwindet beim Abbau (§5.5):**

| Datei | Verantwortung |
|---|---|
| `api/_internal/import/garetien-abgleich.php` ✏️ | Abschnittsliste + Geometrie zurückgeben · Riegel gegen die 360 ohne Position |
| `api/_internal/import/garetien-plan.php` ✏️ | Der vierte Ausgang · Urteil an die Staging-Zeile · `ebene` in `after` |
| `api/_internal/import/garetien-abruf.php` ✏️ | Zwei Spalten `urteil` + `grund` an `garetien_import_row` |
| `api/_internal/import/garetien-uebernahme.php` ✏️ | Die Zweige `ergaenzung` und `geometrie` |
| `api/_internal/import/garetien-liste.php` ➕ | Die gefilterte Arbeitsliste (Union: `sync_plan_item` + Staging-Urteile) |
| `api/edit/map/garetien-import.php` ✏️ | Aktion `liste` |
| `api/_internal/import/__tests__/garetien-abbau-waechter-test.php` ➕ | Der Wächter aus §5.5 |

**Frontend — geteilte Hausform (bleibt) und Importer-Oberfläche (verschwindet):**

| Datei | Verantwortung |
|---|---|
| `css/components/editor-body.css` ➕ | **Bleibt.** Menüband, Kacheln, Spalten, Reiter, Rollkasten — die fünfte Extraktion nach `editor-row.css` / `map-status-circle.css` / `wiki-override.css` / den `--avm-*`-Token |
| `css/components/editor-page.css` ✏️ | **Bleibt.** `@import` statt der ausgezogenen Blöcke |
| `css/styles.css` ✏️ | **Bleibt** (der `editor-body.css`-Import) · eine Zeile für den Importer, die beim Abbau fällt |
| `css/components/garetien-importer.css` ➕ | Verschwindet. Nur die Hülle `.gi-win` und die Abschnittszeile `.gi-seg` |
| `js/review/review-garetien-importer.js` ➕ | Verschwindet. Knopf, Fenster, Liste, Filter, Einzelansicht, Handlungen |
| `js/review/review-garetien-karte.js` ➕ | Verschwindet. Glow + „Ansicht folgt" |
| `index.html` ✏️ | Verschwindet zeilenweise: ein Knopf, eine Fensterhülle, zwei `<script>` |

---

## 🔧 Drei Entscheidungen für den Owner — VOR Aufgabe 3

Sie stehen im Mockup nicht eindeutig und ändern, was gebaut wird. Der Plan trägt für jede eine
Empfehlung; wird sie bestätigt, ist keine Änderung am Plan nötig.

**A · Wem gehört „Geometrie ersetzen …", wenn das Objekt mehrere Abschnitte trifft?**
Ihre „Natter" trifft fünf. „Ersetze die Geometrie" hat dort kein wohldefiniertes Ziel.
⭐ **Empfehlung:** genau **ein** `changed`-Item je Objekt mit `anlass:'geometrie'`, Ziel ist der
am besten deckende Abschnitt, **immer ungehakt**, immer hinter einer Rückfrage — und erzeugt nur
dann, wenn das Objekt **genau einen** Abschnitt trifft. Bei mehreren ist der Knopf ausgegraut und
sagt warum („5 Abschnitte — welchen?"). Begründung: das Mockup nennt den Sammel-Ersatz selbst die
schlimmste Handlung, die dieses Werkzeug anbieten kann (34 der 37 Widersprüche sind Bäche auf
ihrem Hauptfluss, „Seitenarm der Natter" traf „Natter" auf 0,29).

**B · Zeigt das Übernahme-Blatt 14 Zeilen oder 259?**
Mockup §4 verspricht 14. `openSyncPlanSheet` zeigt heute den ganzen Lauf.
⭐ **Empfehlung:** ja, 14 — **ohne** Serveränderung und **ohne** Änderung am Blatt: das Fenster
gibt `openSyncPlanSheet` einen eigenen `post` mit (die Naht ist vorgesehen,
`syncPlanResolvePost`), der bei `action:'get'` die Zeilen auf `selected === true` filtert und
`counts`/`truncated` aus den Zahlen neu setzt, die die Arbeitsliste ohnehin kennt. `apply` geht
unverändert durch. Aufgabe 16.

**A2 · 🔴 ENTSCHIEDEN 27.08.2026 vom Owner — „Geometrie ersetzen" gilt für ALLE Formen.**
Wörtlich: *„geometrie ersetzen muss es für alle geometrien geben — alle formen von flächen UND
wege/flüsse. ausnahme sind natürlich orte, hier wollen wir nur die position behalten oder
ersetzen."* Damit ist **Ruling R5 zurückgenommen** (es hatte den Zweig auf Wege beschränkt): das
Geometrie-Item entsteht für `path` **und** `region`. Die zwei echten Fehler des Region-Zweigs
werden repariert statt wegdefiniert — Flächen-`public_id` nachschlagen statt der Regions-id, und
die erwartete Revision mitschicken.
⚠️ **Für Stufe 4 (Orte, Punkte) gilt: nur „Position behalten oder ersetzen"** — kein
Geometrie-Ersatz im Sinne einer Linie oder Fläche. Gehört in Stufe 4, nicht hierher.
**A3 · 🔴 ENTSCHIEDEN 27.08.2026 — bei mehreren Abschnitten wird GEZEIGT, nicht geraten.**
Auf die Frage, was bei fünf getroffenen Abschnitten geschieht, wörtlich: *„wir wollen sehen
welche abschnitt das sind. wir wollen DEREN objekt und UNSER objekt SEHEN."*

⭐ **Das ist keine neue Anforderung, sondern die Bestätigung der geplanten:** Aufgabe 13 listet
die getroffenen Abschnitte mit Namen und Deckung, Aufgabe 14 zeichnet **ihre** Geometrie
goldgelb gestrichelt und legt den goldenen Schein unter **unsere** betroffenen Abschnitte.
Genau das ist „deren Objekt und unser Objekt sehen".

🔧 **Was daraus folgt:** die Entscheidung, ob „Geometrie ersetzen" bei mehreren Abschnitten
überhaupt ein Knopf sein soll — und wenn ja, mit welchem Ziel —, fällt **am Bild**, nicht am
Reissbrett. Bis Aufgabe 14 gebaut ist, bleibt der Knopf dort ausgegraut und nennt den Grund
(„5 Abschnitte — welchen?"); danach sieht der Owner den Fall und sagt, was er tun soll.
⚠️ Der Bauplan darf ihn bis dahin **nicht** stillschweigend aktivieren: ein Ersatz ohne
benennbares Ziel ist die Handlung, die aus der Natter ihren Seitenarm macht.

**C · Darf ein Editor (nicht Admin) übernehmen?**
Der Knopf ist admin-only (Owner). `sync-plan.php` ist für alle acht Arten `edit`-gegattert.
⭐ **Empfehlung:** so lassen. Der Riegel sitzt am Fenster; `sync-plan.php` härter zu gattern
hieße, den geteilten Endpunkt für eine Art zu verbiegen. Ohne Fenster gibt es keinen Weg hinein.

---
## Schritt 1 des Owners — Server, unsichtbar, per Test belegt (Aufgaben 1–4)

Diese vier Aufgaben ändern nichts, was ein Besucher sieht. Sie gehen **gemeinsam** in einem
Commit-Block live (kein Einzeln-live-Zwang, AGENTS.md §9 nimmt Innenumbauten aus), aber jede hat
ihren eigenen Test und ihren eigenen Commit.

---

### Aufgabe 1: Die Abschnittsliste zurückgeben

Die Zahlen werden bereits gezählt und dann weggeworfen. `avesmapsGaretienDeckung()` führt
`$treffer[$k]` — wie viele Probepunkte jeder Kandidat abdeckt — und gibt nur `bester` heraus, mit
dem Kommentar „ein Mensch soll einen Namen sehen, nicht eine Liste von achtunddreissig".
**Eine Rückgabe mehr, keine zweite Rechnung.**

**Dateien:**
- Ändern: `api/_internal/import/garetien-abgleich.php` (`avesmapsGaretienDeckung`, ~Zeile 325)
- Test: `api/_internal/import/__tests__/garetien-abgleich-test.php` (ergänzen)

**Schnittstellen:**
- Verbraucht: nichts Neues.
- Erzeugt: `avesmapsGaretienDeckung(array $probe, array $kandidaten): array` gibt zusätzlich
  `'abschnitte' => list<array{index:int, punkte:int}>` zurück — absteigend nach `punkte`,
  `index` ist der Schlüssel in `$kandidaten`. `abstand` und `bester` bleiben unverändert.

- [ ] **Schritt 1: Den fallenden Test schreiben** (ans Ende von `garetien-abgleich-test.php`)

```php
// ---------------------------------------------------------------------------------------------
// Die Abschnittsliste: ihr EINES Objekt laeuft ueber MEHRERE unserer Abschnitte.
//
// 💣 Gemessen am Livebestand: ihre "Natter" trifft fuenf unserer Abschnitte, und die verteilen
// sich auf DREI verschiedene Fluesse. `bester` allein verschweigt das -- ein Mensch, der nur
// "Natter" liest, haelt den Fall fuer einteilig und hakt ihn durch.
$probe = [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]];
$kandidaten = [
    ['public_id' => 'A', 'name' => 'Natter', 'art' => '', 'props' => '',
     'punkte' => [[0.0, 0.1], [1.0, 0.1]],
     'huelle_min_x' => 0.0, 'huelle_max_x' => 1.0, 'huelle_min_y' => 0.1, 'huelle_max_y' => 0.1],
    // 🪤 B liegt bei x = 2,5 und NICHT bei 3,0. Bei 3,0 ist der Probepunkt (2,0) exakt gleich
    // weit von beiden Kandidaten entfernt (1,01 gegen 1,01, bitgleich), und der Gleichstand
    // faellt ueber die Reihenfolge -- das strikte `<` in der Schleife behaelt den zuerst
    // gefundenen. Der Test pruefte dann eine Implementierungseigenheit statt der Deckung, und er
    // kippte, sobald jemand die Schleife umbaut. 2,5 trennt sauber.
    ['public_id' => 'B', 'name' => '', 'art' => '', 'props' => '',
     'punkte' => [[2.5, 0.1]],
     'huelle_min_x' => 2.5, 'huelle_max_x' => 2.5, 'huelle_min_y' => 0.1, 'huelle_max_y' => 0.1],
];
$deckung = avesmapsGaretienDeckung($probe, $kandidaten);

assert(isset($deckung['abschnitte']), 'avesmapsGaretienDeckung gibt keine Abschnittsliste heraus');
assert(count($deckung['abschnitte']) === 2,
    'beide getroffenen Abschnitte gehoeren in die Liste, nicht nur der beste');
// A deckt die zwei linken Probepunkte, B die zwei rechten.
assert($deckung['abschnitte'][0]['index'] === 0, 'die Liste steht nicht absteigend nach Deckung');
assert($deckung['abschnitte'][0]['punkte'] === 2, 'A deckt die zwei linken Probepunkte');
assert($deckung['abschnitte'][1]['index'] === 1, 'B fehlt in der Liste');
assert($deckung['abschnitte'][1]['punkte'] === 2, 'B deckt die zwei rechten Probepunkte');
// ⚠️ `bester` bleibt, was er war -- die Liste ERGAENZT ihn, sie ersetzt ihn nicht.
assert($deckung['bester'] !== null, 'bester darf durch die Ergaenzung nicht verlorengehen');
// Nichts in der Naehe: leere Liste, kein null. Ein Aufrufer soll `foreach` schreiben duerfen.
$leer = avesmapsGaretienDeckung($probe, []);
assert($leer['abschnitte'] === [], 'ohne Kandidaten muss die Abschnittsliste LEER sein, nicht null');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-abgleich-test.php
```

Erwartet: `AssertionError: avesmapsGaretienDeckung gibt keine Abschnittsliste heraus`.

- [ ] **Schritt 3: Die eine Rückgabe ergänzen**

In `avesmapsGaretienDeckung`, am frühen Ausstieg **und** am Ende. Der Kommentarblock über der
Funktion bekommt einen Absatz; der `@return`-Block wird mitgeführt.

```php
// Frueher Ausstieg -- BEIDE Stellen, sonst ist `abschnitte` mal da und mal nicht.
if ($probe === [] || $kandidaten === []) {
    return ['abstand' => INF, 'bester' => null, 'abschnitte' => []];
}
…
if ($naheKandidaten === []) {
    return ['abstand' => INF, 'bester' => null, 'abschnitte' => []];
}
```

Und am Ende, nach dem vorhandenen `arsort($treffer)`:

```php
    // Der GENANNTE Treffer ist der, der die meisten Punkte abdeckt -- ein Mensch soll einen Namen
    // sehen, nicht eine Liste von achtunddreissig.
    arsort($treffer);

    // 🔴 UND DIE LISTE DAHINTER, weil das Fenster sie braucht (Auftrag §4.1): unsere Fluesse
    // liegen in ABSCHNITTEN, ihre nicht. Ihre "Natter" trifft fuenf unserer Abschnitte auf DREI
    // verschiedenen Fluessen; gehakt wird je Abschnitt, nie je Objekt. Ohne diese Zeilen wuerde
    // dieselbe Rechnung im Browser ein zweites Mal gebaut -- die Grenze, die der Auftrag §5.4
    // ausdruecklich zieht.
    // ⚠️ ERGAENZUNG, KEIN ERSATZ: `bester` und `abstand` bleiben unangetastet -- sie haben
    // ihre eigenen Leser.
    // 💣 Hier stand eine ZAHL ("vier Aufrufer"), und sie war falsch: es ist genau einer.
    // Eine Zahl im Kommentar liest sich wie eine vollstaendige Liste, und niemand zaehlt nach --
    // genau daran ist am 14.08.2026 die Verkehrsmittel-Sperre gescheitert (AGENTS.md §11).
    $abschnitte = [];
    foreach ($treffer as $k => $anzahl) {
        $abschnitte[] = ['index' => (int) $k, 'punkte' => (int) $anzahl];
    }

    return [
        'abstand' => $abstaende[$mitte],
        'bester' => $treffer === [] ? null : (int) array_key_first($treffer),
        'abschnitte' => $abschnitte,
    ];
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

Derselbe Befehl. Erwartet: keine Ausgabe, Exit 0.

- [ ] **Schritt 5: Commit**

```bash
git add api/_internal/import/garetien-abgleich.php api/_internal/import/__tests__/garetien-abgleich-test.php
git commit -m "garetien(abgleich): die Abschnittsliste wird nicht mehr weggeworfen"
```

---

### Aufgabe 2: Die getroffenen Abschnitte samt Name und Geometrie

`avesmapsGaretienDeckung` liefert Indizes. Das Fenster braucht daraus `public_id`, Name (oder
leer) und die **Geometrie** — sonst kann der Browser den goldenen Schein nicht unter die richtigen
Stücke legen. `$kandidat['punkte']` liegt bereits vor.

**Dateien:**
- Ändern: `api/_internal/import/garetien-abgleich.php` (`avesmapsGaretienFindeBestand`)
- Test: `api/_internal/import/__tests__/garetien-abgleich-test.php` (ergänzen)

**Schnittstellen:**
- Verbraucht: `avesmapsGaretienDeckung(...)['abschnitte']` aus Aufgabe 1.
- Erzeugt: `avesmapsGaretienFindeBestand(...)` gibt zusätzlich
  `'abschnitte' => list<array{public_id:string, name:string, punkte:int, geometrie:array}>` —
  `geometrie` ist eine flache Punktliste `[[x,y], …]` in **unseren Karteneinheiten**,
  gedeckelt auf `AVESMAPS_GARETIEN_ABSCHNITT_PUNKTE`. Bei `neu` ohne Nachbarn: `[]`.

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
// ---------------------------------------------------------------------------------------------
// Was bei uns an derselben Stelle liegt -- mit Namen UND Geometrie.
//
// 💣 Die Geometrie MUSS mitreisen. Der Schein liegt nur unter den Abschnitten, die das Haekchen
// wirklich aendert; ohne ihre Punkte muesste der Browser sie aus der Karte fischen -- und was er
// geladen hat, haengt an Zoom und Ansicht (die politische Ebene liefert bei Zoom 3 gerade 174 von
// rund 800 Gebieten). Derselbe Grund wie bei `derived_source_geometry_public_ids`.
$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();
$zeile = [
    'wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 1, 'typ' => 'Bach',
    'namensraum' => 'Garetien', 'artikel' => 'Alke', 'anzeige' => 'Alke',
    'geo_art' => 'koordinaten', 'geo' => '20000 10000, 21000 11000, 22000 12000',
];
$urteil = avesmapsGaretienFindeBestand($pdo, $zeile, avesmapsGaretienMappeTyp('Bach'));

assert($urteil['status'] === 'deckt_sich', 'die Fixture-Alke muss weiterhin decken');
assert(isset($urteil['abschnitte']), 'avesmapsGaretienFindeBestand gibt keine Abschnitte heraus');
assert(count($urteil['abschnitte']) === 1, 'die Fixture hat genau einen Bestandsabschnitt');
assert($urteil['abschnitte'][0]['public_id'] === 'vorhanden-1', 'die public_id fehlt');
assert($urteil['abschnitte'][0]['name'] === 'Alke', 'der Name des Abschnitts fehlt');
assert($urteil['abschnitte'][0]['punkte'] > 0, 'die Deckungszahl fehlt');
assert(count($urteil['abschnitte'][0]['geometrie']) === 3,
    'die Geometrie des getroffenen Abschnitts muss mitreisen -- sonst liegt der Schein nirgends');
assert(is_float($urteil['abschnitte'][0]['geometrie'][0][0]),
    'die Geometrie steht in Karteneinheiten als [x,y]-Paare');

// Ein Objekt ohne jeden Nachbarn: LEERE Liste, nie null.
$fern = $zeile;
$fern['geo'] = '900000 -400000, 901000 -401000';
$fern['artikel'] = '';
$fernUrteil = avesmapsGaretienFindeBestand($pdo, $fern, avesmapsGaretienMappeTyp('Bach'));
assert($fernUrteil['status'] === 'neu', 'weit weg heisst neu');
assert($fernUrteil['abschnitte'] === [], 'ohne Nachbarn eine leere Liste, kein null');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Erwartet: `AssertionError: avesmapsGaretienFindeBestand gibt keine Abschnitte heraus`.

- [ ] **Schritt 3: Den Bauer schreiben und in alle vier Rückgabewege einhängen**

Neue Konstante und Funktion, direkt über `avesmapsGaretienFindeBestand`:

```php
/**
 * So viele Stuetzpunkte je Abschnitt reisen mit. Sie sind fuer den goldenen SCHEIN unter unserem
 * Bestand gedacht, nicht fuer eine Vermessung -- und ein Schein braucht die Form, nicht jeden
 * Knick.
 *
 * ⚠️ Die Zahl ist eine NUTZLASTGRENZE, keine Genauigkeitsgrenze. Live gemessen: unsere laengsten
 * Flussabschnitte tragen dreistellige Stuetzpunktzahlen, und ein Objekt kann 13 Abschnitte
 * treffen (Der Grosse Fluss). Ungedeckelt waeren das im schlimmsten Fall einige tausend Paare in
 * EINER after_json -- fuer eine Liste, die 259 solcher Zeilen zeigt.
 */
const AVESMAPS_GARETIEN_ABSCHNITT_PUNKTE = 64;

/**
 * Die getroffenen Abschnitte, wie das Fenster sie braucht: Name (oder leer), Deckung, Geometrie.
 *
 * 🔴 KEINE ZWEITE RECHNUNG. Die Indizes kommen aus `avesmapsGaretienDeckung`, die Punkte aus dem
 * Kandidaten, der ohnehin geladen ist. Hier wird nur umgepackt.
 */
function avesmapsGaretienAbschnitte(array $deckung, array $kandidaten): array
{
    $raus = [];
    foreach ($deckung['abschnitte'] ?? [] as $eintrag) {
        $kandidat = $kandidaten[$eintrag['index']] ?? null;
        if ($kandidat === null) {
            continue;
        }
        $raus[] = [
            'public_id' => (string) $kandidat['public_id'],
            // ⚠️ Ein LEERER Name ist die Auskunft, nicht die Abwesenheit einer Auskunft: 25 von 76
            // Geometrietreffern trugen bei uns gar keinen Namen. Genau die sind der vierte Ausgang.
            'name' => (string) ($kandidat['name'] ?? ''),
            'punkte' => (int) $eintrag['punkte'],
            'geometrie' => avesmapsGaretienProbepunkteN(
                $kandidat['punkte'], AVESMAPS_GARETIEN_ABSCHNITT_PUNKTE
            ),
        ];
    }

    return $raus;
}

/** Gleichmaessig ausgeduennt auf hoechstens `$deckel` Punkte -- die Form von `avesmapsGaretienProbepunkte`, frei waehlbare Zahl. */
function avesmapsGaretienProbepunkteN(array $punkte, int $deckel): array
{
    $anzahl = count($punkte);
    if ($anzahl <= $deckel || $deckel < 2) {
        return $punkte;
    }
    $raus = [];
    for ($i = 0; $i < $deckel; $i++) {
        $raus[] = $punkte[(int) floor($i * ($anzahl - 1) / ($deckel - 1))];
    }

    return $raus;
}
```

💣 **In `avesmapsGaretienFindeBestand` gibt es VIER Rückgabewege**, und `abschnitte` gehört an
alle vier: der `uebersprungen`-Ausstieg, der Artikel-Zweig, der „keine Geometrie"-Ausstieg, der
Geometrie-Zweig und der Schluss-`neu`. Ein Weg ohne `abschnitte` liefert in der Einzelansicht ein
leeres „Was bei uns liegt" — nicht von „da liegt nichts" zu unterscheiden.

- Im `uebersprungen`- und im „keine vergleichbare Geometrie"-Ausstieg: `'abschnitte' => []`.
- Im **Artikel**-Zweig: `'abschnitte' => avesmapsGaretienAbschnitte(avesmapsGaretienDeckung($probe, [$kandidat]), [$kandidat])`
  — der Artikeltreffer wird gegen **genau diesen einen** Kandidaten gemessen, wie schon der
  `abstand` darüber.
- Im **Geometrie**-Zweig und im Schluss-`neu`: `'abschnitte' => avesmapsGaretienAbschnitte($deckung, $kandidaten)`.
  ⚠️ Dafür muss `$deckung` im Schluss-`neu` noch im Gültigkeitsbereich sein — es ist es (`$deckung`
  wird vor der `if`-Verzweigung gerechnet).

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

- [ ] **Schritt 5: Die Zusicherung „alle vier Wege" festnageln**

```php
// 🪤 Ein Rueckgabeweg ohne `abschnitte` liefert in der Einzelansicht ein leeres "Was bei uns
// liegt" -- und das ist von "da liegt nichts" nicht zu unterscheiden. Deshalb wird die Anwesenheit
// des Schluessels an JEDEM Ausgang geprueft, nicht nur an dem, den der Test oben zufaellig nimmt.
foreach ([
    ['Insel', '1 2, 3 4'],                                   // uebersprungen (spaetere Stufe)
    ['Bach', ''],                                            // keine vergleichbare Geometrie
    ['Bach', '20000 10000, 21000 11000, 22000 12000'],       // Geometrie deckt sich
    ['Bach', '900000 -400000, 901000 -401000'],              // neu
] as [$typ, $geo]) {
    $probeZeile = ['wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 9, 'typ' => $typ,
        'namensraum' => '', 'artikel' => '', 'anzeige' => 'Probe',
        'geo_art' => $geo === '' ? 'verweise' : 'koordinaten', 'geo' => $geo];
    $u = avesmapsGaretienFindeBestand($pdo, $probeZeile, avesmapsGaretienMappeTyp($typ));
    assert(array_key_exists('abschnitte', $u) && is_array($u['abschnitte']),
        'Rueckgabeweg fuer Typ ' . $typ . ' vergisst `abschnitte`');
}
```

- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/import/garetien-abgleich.php api/_internal/import/__tests__/garetien-abgleich-test.php
git commit -m "garetien(abgleich): die getroffenen Abschnitte reisen mit Name und Geometrie"
```

---
### Aufgabe 3: Der vierte Ausgang — „haben wir, aber sie wissen mehr"

Der Abgleich kennt drei Ausgänge. Der Fall, den der Owner benannt hat, fällt durch: die
„Angbarer Reichsstraße" ist bei uns „Reichsstraße 3", landet auf `deckt_sich` — und `deckt_sich`
erzeugt **keinen Vorschlag**. Ihr Name und ihr Wiki-Artikel werden weggeworfen.

🔴 **Kein vierter `change_type`.** „Sie wissen mehr" ist inhaltlich ein `changed`; ein vierter
Wert müsste durch `sync-plan.php`, die drei Gruppen des Blattes und deren Tests wandern und
könnte nichts, was `after.anlass` nicht kann.

#### Das Modell — vier Regeln, und sie reproduzieren alle vier Mockup-Fälle

Für jeden getroffenen Abschnitt `A` eines Objekts `O`:

| | |
|---|---|
| `hatQuelle` | `A.public_id` steht schon in `feature_sources` mit `origin='garetien'` |
| `nameLeer` | `A.name === ''` |
| `nameGleich` | `avesmapsGaretienNamenAehnlich(O.anzeige, A.name)` |
| **`einObjekt`** | alle **nichtleeren** Namen der getroffenen Abschnitte sind derselbe |

1. **Lücken-Item** (`anlass:'ergaenzung'`) entsteht, wenn `nameLeer` **oder** `!hatQuelle`.
   `felder` = `['name']` bei `nameLeer`, plus `['quelle']` bei `!hatQuelle`. **Vorangehakt** —
   es füllt nur Leeres. (Owner 16.08.2026: „Vorangehakt ist nur das Füllen einer LÜCKE".)
2. **Umbenennungs-Item** (`anlass:'umbenennung'`) entsteht nur, wenn `!nameLeer && !nameGleich
   && einObjekt`. **Ungehakt**, `before.name` → `after.name` im Klartext, Warnton.
3. Kein Item → der Abschnitt steht als `is-full` da: „nichts zu ersetzen".
4. **Geometrie-Item** (`anlass:'geometrie'`) je Objekt, nur bei **genau einem** getroffenen
   Abschnitt (Entscheidung A). Immer ungehakt.

💣 **`einObjekt` ist der Unterschied zwischen Gardel und der Reichsstraße 3, und ohne ihn ist
einer der beiden falsch.** Ihre „Natter" trifft Natter, Gardel und Darpat — drei Namen, also läuft
ihr Objekt über mehrere unserer; den Gardel „Natter" zu nennen wäre falsch, und er bekommt gar
kein Angebot. Ihre „Angbarer Reichsstraße" trifft sechsmal „Reichsstraße 3" — **ein** Name, also
ist es unser Objekt, und die Umbenennung ist eine sinnvolle Frage. Wer die Regel weglässt, bietet
entweder das Umbenennen des Gardel an (falsch) oder verliert Fall D (den Fall, an dem der Owner
diesen ganzen Ausgang benannt hat).

**Dateien:**
- Ändern: `api/_internal/import/garetien-plan.php`
- Test: `api/_internal/import/__tests__/garetien-plan-test.php` (ergänzen)

**Schnittstellen:**
- Verbraucht: `$urteil['abschnitte']` aus Aufgabe 2.
- Erzeugt:
  - `avesmapsGaretienQuellenBestand(PDO $pdo): array<string,true>` — die Schluessel
    `entity_type|entity_public_id` aller `feature_sources` mit `origin='garetien'`.
    **Eine Abfrage je Lauf**, nicht je Zeile.
    💣 **KEIN `status`-Filter.** Hier stand `status = 'active'` -- das Wort gibt es in
    `feature_sources` nicht: der Hauswert ist `'approved'` (DDL-Vorgabe), der einzige andere
    `'suppressed'`. `'active'` ist das Vokabular des LORE-Systems (`lore_entry`, `lore_place`,
    `lore_rule`), und abgeschrieben haette die Abfrage IMMER leer geliefert -- alle 289 Objekte
    haetten bei jedem Lauf erneut ein vorangehaktes Quellen-Item bekommen, auch nach dem Import.
    🔴 Und gefiltert wird auch nicht auf `'approved'`: `'suppressed'` ist der Grabstein
    einer von HAND entfernten Verknuepfung. Wer ihn ignoriert, bietet genau das wieder an, was
    ein Mensch weggenommen hat -- die Uebersteuerungs-Sicherheit, die das Haus ueberall verlangt.
    Eine Zeile da = die Quelle ist erledigt, egal in welchem Zustand.
    ⚠️ **`entity_type` gehoert in den Schluessel**: `feature_sources` ist ueber
    `(entity_type, entity_public_id, source_id)` eindeutig, und dieser Import schreibt `path`-
    UND `region`-Zeilen. Eine ueber zwei Typen geteilte `public_id` laese sich sonst als
    "Quelle liegt".
  - `avesmapsGaretienErgaenzungsEintraege(array $zeile, array $ziel, array $urteil, array $quellen): list<array>`
    — rein, kein I/O. Liefert die Items nach den vier Regeln oben; jedes hat die Form von
    `avesmapsGaretienPlanEintrag` plus `after.anlass ∈ {ergaenzung, umbenennung, geometrie}`,
    `after.felder`, `after.abschnitt` und `vorwahl_aus`.
  - `avesmapsGaretienEinObjekt(array $abschnitte): bool`

- [ ] **Schritt 1: Den fallenden Test schreiben** (ans Ende von `garetien-plan-test.php`)

```php
// ---------------------------------------------------------------------------------------------
// DER VIERTE AUSGANG: "haben wir -- aber sie wissen mehr" (Auftrag §4).
//
// 🔴 Es gibt keinen vierten change_type. Es ist ein `changed` mit after.anlass.

// -- Fall A/B: ein NAMENLOSER Abschnitt. Die Luecke wird gefuellt, also vorangehakt.
$urteilA = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-1',
    'treffer_name' => '', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.41,
    'abschnitte' => [['public_id' => 'w-1', 'name' => '', 'punkte' => 12, 'geometrie' => [[1.0, 2.0]]]]];
$zeileA = ['wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 1, 'typ' => 'Bach',
    'namensraum' => 'Garetien', 'artikel' => 'Alke', 'anzeige' => 'Alke',
    'geo_art' => 'koordinaten', 'geo' => '20000 10000, 21000 11000'];
$a = avesmapsGaretienErgaenzungsEintraege($zeileA, avesmapsGaretienMappeTyp('Bach'), $urteilA, []);

$luecken = array_values(array_filter($a, static fn($e) => $e['after']['anlass'] === 'ergaenzung'));
assert(count($luecken) === 1, 'ein namenloser Abschnitt muss GENAU ein Luecken-Item ergeben');
assert($luecken[0]['change_type'] === 'changed', 'der vierte Ausgang ist ein changed');
assert($luecken[0]['entity_public_id'] === 'w-1', 'das Ziel ist der ABSCHNITT, nicht das Objekt');
assert(in_array('name', $luecken[0]['after']['felder'], true), 'der leere Name ist eine Luecke');
assert(in_array('quelle', $luecken[0]['after']['felder'], true), 'die fehlende Quelle ist eine Luecke');
assert($luecken[0]['vorwahl_aus'] === false, 'eine Luecke kommt VORANGEHAKT (Owner 16.08.2026)');
assert(array_filter($a, static fn($e) => $e['after']['anlass'] === 'umbenennung') === [],
    'ein LEERER Name wird gefuellt, nicht umbenannt');

// -- Fall C: ihr EINES Objekt laeuft ueber DREI unserer Fluesse.
// 💣 Der Gardel bekommt NICHTS. Ihn "Natter" zu nennen waere falsch, obwohl er getroffen ist.
$urteilC = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-4471',
    'treffer_name' => 'Natter', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.84,
    'abschnitte' => [
        ['public_id' => 'w-4471', 'name' => 'Natter', 'punkte' => 9, 'geometrie' => [[1.0, 1.0]]],
        ['public_id' => 'w-5008', 'name' => 'Gardel', 'punkte' => 6, 'geometrie' => [[2.0, 2.0]]],
        ['public_id' => 'w-6120', 'name' => '', 'punkte' => 1, 'geometrie' => [[3.0, 3.0]]],
    ]];
$zeileC = $zeileA;
$zeileC['artikel'] = 'Natter';
$zeileC['anzeige'] = 'Natter';
$c = avesmapsGaretienErgaenzungsEintraege($zeileC, avesmapsGaretienMappeTyp('Fluss'), $urteilC, []);

assert(avesmapsGaretienEinObjekt($urteilC['abschnitte']) === false,
    'drei Fluesse sind nicht EIN Objekt');
$zielIds = array_map(static fn($e) => $e['entity_public_id'], $c);
assert(!in_array('w-5008', $zielIds, true),
    'der Gardel traegt einen FREMDEN Namen und darf kein Angebot bekommen -- ihre Natter laeuft nur darueber');
$mitName = array_values(array_filter($c,
    static fn($e) => in_array('name', $e['after']['felder'], true)));
assert(count($mitName) === 1, 'genau EIN Abschnitt bekommt einen Namen: der namenlose 6120');
assert($mitName[0]['entity_public_id'] === 'w-6120', 'und zwar der namenlose');
// Der gleichnamige Abschnitt bekommt die Quelle, aber niemals einen neuen Namen.
$natter = array_values(array_filter($c, static fn($e) => $e['entity_public_id'] === 'w-4471'));
assert(count($natter) === 1 && $natter[0]['after']['felder'] === ['quelle'],
    'ein gleichnamiger Abschnitt bekommt die Quelle -- und sonst nichts');

// -- Fall D: ihre "Angbarer Reichsstrasse" trifft SECHSMAL unsere "Reichsstrasse 3".
// Ein Name -> es IST unser Objekt -> die Umbenennung ist eine sinnvolle Frage, aber UNGEHAKT.
$sechs = [];
foreach (range(2210, 2215) as $nr) {
    $sechs[] = ['public_id' => 'w-' . $nr, 'name' => 'Reichsstraße 3', 'punkte' => 3, 'geometrie' => [[1.0, 1.0]]];
}
$urteilD = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-2210',
    'treffer_name' => 'Reichsstraße 3', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.5,
    'abschnitte' => $sechs];
$zeileD = $zeileA;
$zeileD['artikel'] = 'Angbarer Reichsstraße';
$zeileD['anzeige'] = 'Angbarer Reichsstraße';
$d = avesmapsGaretienErgaenzungsEintraege($zeileD, avesmapsGaretienMappeTyp('Bach'), $urteilD, []);

assert(avesmapsGaretienEinObjekt($sechs) === true, 'sechsmal derselbe Name ist EIN Objekt');
$um = array_values(array_filter($d, static fn($e) => $e['after']['anlass'] === 'umbenennung'));
assert(count($um) === 6, 'jeder der sechs Abschnitte bekommt sein eigenes Umbenennungs-Item');
assert($um[0]['vorwahl_aus'] === true,
    'ein vorhandener Name wird NIE stillschweigend ueberschrieben -- ungehakt');
assert($um[0]['before']['name'] === 'Reichsstraße 3', 'alt -> neu im Klartext: das alt fehlt');
assert($um[0]['after']['name'] === 'Angbarer Reichsstraße', 'alt -> neu im Klartext: das neu fehlt');
$nurQuelle = array_values(array_filter($d, static fn($e) => $e['after']['anlass'] === 'ergaenzung'));
assert(count($nurQuelle) === 6,
    'daneben sechs reine Quellen-Items -- das ist der Knopf "Nur Quelle + Artikel (6)"');
assert($nurQuelle[0]['vorwahl_aus'] === false, 'die Quelle ist eine Luecke und kommt vorangehakt');

// -- Nichts zu ersetzen: gleicher Name, Quelle liegt schon.
$fertig = avesmapsGaretienErgaenzungsEintraege($zeileC, avesmapsGaretienMappeTyp('Fluss'),
    ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-4471',
     'treffer_name' => 'Natter', 'grund' => '', 'abstand' => 0.1,
     'abschnitte' => [['public_id' => 'w-4471', 'name' => 'Natter', 'punkte' => 9, 'geometrie' => []]]],
    ['w-4471' => true]);
assert(array_filter($fertig, static fn($e) => $e['after']['anlass'] !== 'geometrie') === [],
    'gleicher Name plus vorhandene Quelle heisst: nichts zu ersetzen');

// -- Der SCHLUESSEL je Item muss eindeutig sein, sonst treffen sich zwei Abschnitte in
// sync_decision und eine Ablehnung gilt fuer beide.
$schluessel = array_map(static fn($e) => $e['entity_key'], $d);
assert(count(array_unique($schluessel)) === count($schluessel),
    'zwei Items mit demselben entity_key teilen sich eine Entscheidung');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/import/__tests__/garetien-plan-test.php
```

Erwartet: `Error: Call to undefined function avesmapsGaretienErgaenzungsEintraege()`.

- [ ] **Schritt 3: `avesmapsGaretienEinObjekt` und den Quellenbestand schreiben**

```php
/**
 * Laeuft ihr Objekt ueber EINES von uns oder ueber mehrere?
 *
 * 💣 DAS IST DER UNTERSCHIED ZWISCHEN GARDEL UND REICHSSTRASSE 3, und ohne ihn ist einer von
 * beiden falsch. Ihre "Natter" trifft Natter, Gardel und Darpat -- drei Namen, also laeuft ihr
 * Objekt ueber mehrere unserer; den Gardel "Natter" zu nennen waere falsch. Ihre "Angbarer
 * Reichsstrasse" trifft sechsmal "Reichsstrasse 3" -- EIN Name, also ist es unser Objekt, und
 * die Umbenennung ist genau die Frage, die der Owner gestellt hat.
 *
 * ⚠️ Leere Namen zaehlen NICHT mit: eine Luecke ist kein zweiter Name. Barun-Ulah traegt seinen
 * Namen siebenmal und hat eine Luecke -- das ist EIN Objekt.
 */
function avesmapsGaretienEinObjekt(array $abschnitte): bool
{
    $namen = [];
    foreach ($abschnitte as $abschnitt) {
        $name = trim((string) ($abschnitt['name'] ?? ''));
        if ($name !== '') {
            $namen[$name] = true;
        }
    }

    return count($namen) <= 1;
}

/**
 * Welche unserer Objekte tragen die Garetien-Quelle bereits?
 *
 * ⚠️ EINE Abfrage je LAUF, nicht je Zeile. 289 Zeilen mit bis zu 13 Abschnitten waeren sonst rund
 * tausend Einzelabfragen fuer eine Frage, deren Antwort sich waehrend des Rechnens nicht aendert.
 * ⚠️ Faellt OFFEN aus: fehlt die Tabelle (frische Installation), gilt "keine Quelle liegt" -- das
 * erzeugt hoechstens ein Item zu viel, und ein Item zu viel ist sichtbar. Ein Item zu WENIG waere
 * eine stillschweigend verlorene Quellenangabe.
 */
function avesmapsGaretienQuellenBestand(PDO $pdo): array
{
    try {
        $stmt = $pdo->query(
            "SELECT DISTINCT entity_type, entity_public_id FROM feature_sources"
            . " WHERE origin = 'garetien'"
        );
    } catch (PDOException) {
        return [];
    }
    $raus = [];
    // 💣 FETCH_ASSOC, nicht FETCH_COLUMN: die Abfrage liest ZWEI Spalten, und
    // FETCH_COLUMN liefert nur die erste -- der Schluessel waere dann das blosse `entity_type`
    // ("path", "region"), also zwei Eintraege fuer den ganzen Bestand. Genau die stille
    // Leermenge, die Ruling R3 beseitigt hat, nur eine Ebene weiter.
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $zeile) {
        $raus[$zeile['entity_type'] . '|' . $zeile['entity_public_id']] = true;
    }

    return $raus;
}
```

- [ ] **Schritt 4: `avesmapsGaretienErgaenzungsEintraege` schreiben**

```php
/**
 * DER VIERTE AUSGANG: "haben wir -- aber sie wissen mehr" (Auftrag §4).
 *
 * 🔴 KEIN vierter change_type. Es ist ein `changed`; `after.anlass` sagt, welcher Art. Ein
 * vierter Wert muesste durch sync-plan.php, die drei Gruppen des Blattes und deren Tests wandern
 * und koennte nichts, was `anlass` nicht kann. ⭐ Und das Blatt stellt ihn schon richtig dar:
 * syncPlanDiffMarkup zeichnet `-- -> Alke` bzw. `Reichsstrasse 3 -> Angbarer Reichsstrasse` aus
 * before/after, ohne eine Zeile Aenderung.
 *
 * 🔴 EIN ABSCHNITT IST EIN EIGENES ITEM. Gehakt wird je Abschnitt, nie je Objekt -- weil ihr
 * eines Objekt ueber mehrere unserer Fluesse laufen kann. Eine Abschnittsauswahl in
 * `override`/`after` waere der zweite Schreibweg, den Auftrag §5.4 verbietet.
 *
 * REIN -- kein I/O. `$quellen` kommt aus avesmapsGaretienQuellenBestand.
 *
 * @param array<string,true> $quellen entity_public_id => true
 * @return list<array>
 */
function avesmapsGaretienErgaenzungsEintraege(array $zeile, array $ziel, array $urteil, array $quellen): array
{
    $abschnitte = $urteil['abschnitte'] ?? [];
    if ($abschnitte === []) {
        return [];
    }
    $ihrName = trim((string) ($zeile['anzeige'] ?? ''));
    $einObjekt = avesmapsGaretienEinObjekt($abschnitte);
    // Der gemeinsame Rumpf (Quelle, Wiki, Beschriftung) steht schon im Neu-Eintrag -- er wird
    // wiederverwendet und nicht abgeschrieben.
    $vorlage = avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil);
    $eintraege = [];

    foreach ($abschnitte as $abschnitt) {
        $publicId = (string) $abschnitt['public_id'];
        $unserName = trim((string) ($abschnitt['name'] ?? ''));
        $nameLeer = $unserName === '';
        $nameGleich = !$nameLeer && avesmapsGaretienNamenAehnlich($ihrName, $unserName);
        $hatQuelle = isset($quellen[$publicId]);

        // 1. Das Luecken-Item: nur Leeres wird gefuellt, deshalb VORANGEHAKT.
        $felder = [];
        if ($nameLeer) {
            $felder[] = 'name';
        }
        if (!$hatQuelle && ($nameLeer || $nameGleich || $einObjekt)) {
            // ⚠️ Eine Quelle bekommt nur, wem sie GEHOERT. Der Gardel liegt zufaellig unter ihrer
            // Natter -- ihre Quelle dort anzuhaengen behauptete, garetien.de beschreibe den Gardel.
            $felder[] = 'quelle';
        }
        if ($felder !== []) {
            $eintraege[] = avesmapsGaretienAbschnittsEintrag(
                $vorlage, $abschnitt, 'ergaenzung', $felder, $ihrName, $unserName, false
            );
        }

        // 2. Das Umbenennungs-Item: ein VORHANDENER Name wird ueberschrieben -- nie stillschweigend.
        if (!$nameLeer && !$nameGleich && $einObjekt) {
            $eintraege[] = avesmapsGaretienAbschnittsEintrag(
                $vorlage, $abschnitt, 'umbenennung', ['name'], $ihrName, $unserName, true
            );
        }
    }

    // 3. Das Geometrie-Item -- genau eins je Objekt, und nur bei GENAU EINEM getroffenen
    // Abschnitt. 💣 Bei mehreren hat "ersetze die Geometrie" kein wohldefiniertes Ziel: ihre
    // Natter trifft fuenf. Und ein pauschales Ersetzen ist die schlimmste Handlung, die dieses
    // Werkzeug anbieten kann -- 34 der 37 Widersprueche sind Baeche, die auf ihrem Hauptfluss
    // liegen; dort ersetzte es die Natter durch ihren Seitenarm, mit gueltiger id und ohne
    // Fehlermeldung. Der Knopf ist dann ausgegraut und sagt, warum.
    if (count($abschnitte) === 1) {
        $eintraege[] = avesmapsGaretienAbschnittsEintrag(
            $vorlage, $abschnitte[0], 'geometrie', ['geometrie'], $ihrName,
            trim((string) ($abschnitte[0]['name'] ?? '')), true
        );
    }

    return $eintraege;
}

/**
 * Ein Item fuer EINEN Abschnitt, aus der gemeinsamen Vorlage.
 *
 * 💣 Der `entity_key` traegt den Abschnitt UND den Anlass. Ohne beides teilten sich zwei Items
 * eine Zeile in `sync_decision` -- und eine Ablehnung des Umbenennens naehme die Quelle mit.
 */
function avesmapsGaretienAbschnittsEintrag(
    array $vorlage, array $abschnitt, string $anlass, array $felder,
    string $ihrName, string $unserName, bool $vorwahlAus
): array {
    $publicId = (string) $abschnitt['public_id'];
    $eintrag = $vorlage;
    $eintrag['entity_key'] = mb_substr($vorlage['entity_key'] . '|' . $anlass . '|' . $publicId, 0, 190, 'UTF-8');
    $eintrag['entity_public_id'] = $publicId;
    $eintrag['change_type'] = 'changed';
    $eintrag['label'] = $ihrName . ' → ' . ($unserName !== '' ? $unserName : 'ohne Namen');
    $eintrag['before'] = ['public_id' => $publicId, 'name' => $unserName];
    $eintrag['after']['anlass'] = $anlass;
    $eintrag['after']['felder'] = $felder;
    $eintrag['after']['abschnitt'] = [
        'public_id' => $publicId,
        'name' => $unserName,
        'punkte' => (int) ($abschnitt['punkte'] ?? 0),
        'geometrie' => $abschnitt['geometrie'] ?? [],
    ];
    // ⚠️ `nachbar` gehoert dem Zufluss und hat hier nichts zu suchen.
    $eintrag['after']['nachbar'] = null;
    $eintrag['vorwahl_aus'] = $vorwahlAus;

    return $eintrag;
}
```

- [ ] **Schritt 5: Den Planbauer die neuen Items schreiben lassen**

In `avesmapsGaretienBaueSyncPlan`: den Quellenbestand einmal laden, und den `deckt_sich`-Zweig
öffnen.

```php
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
    // EINE Abfrage je Lauf -- der vierte Ausgang fragt sonst je Abschnitt nach.
    $quellenBestand = avesmapsGaretienQuellenBestand($pdo);
```

und statt `if ($urteil['status'] === 'deckt_sich' || …) { continue; }`:

```php
        if ($urteil['status'] === 'uebersprungen') {
            continue;
        }
        // 🔴 DER VIERTE AUSGANG. `deckt_sich` erzeugte bis zum 27.08.2026 gar nichts -- und genau
        // dabei gingen ihr Name, ihr Wiki-Artikel und ihre Quelle verloren. 25 von 76
        // Geometrietreffern trugen bei uns keinen Namen.
        $eintraege = $urteil['status'] === 'deckt_sich'
            ? avesmapsGaretienErgaenzungsEintraege($zeile, $ziel, $urteil, $quellenBestand)
            : [avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil)];
        foreach ($eintraege as $eintrag) {
            $schluessel = avesmapsSyncPlanDecisionKey($eintrag['entity_key'], $eintrag['change_type']);
            $eintrag['selected'] = avesmapsSyncPlanDefaultSelected(
                $eintrag['change_type'],
                (int) ($entscheidungen[$schluessel]['skipped_count'] ?? 0)
            );
            // 🔴 Die Hausregel kann nur AUS-, nie EINschalten.
            if ($eintrag['vorwahl_aus']) {
                $eintrag['selected'] = 0;
            }
            unset($eintrag['vorwahl_aus']);
            avesmapsSyncPlanAddItem($pdo, $runId, $eintrag);
            $anzahl++;
        }
```

⚠️ Zusätzlich reist ab jetzt `'ebene' => $zeile['ebene']` in `after` mit
(`avesmapsGaretienPlanEintrag`) — der Filter „Ebene · 18" liest sie, und sie aus dem
`entity_key` zurückzuparsen wäre eine zweite Wahrheit über dasselbe Feld.

- [ ] **Schritt 6: Test laufen lassen, grün bestätigen** — beide Testdateien.

- [ ] **Schritt 7: Commit**

```bash
git add api/_internal/import/garetien-plan.php api/_internal/import/__tests__/garetien-plan-test.php
git commit -m "garetien(plan): der vierte Ausgang -- was sie mehr wissen, faellt nicht mehr durch"
```

---

### Aufgabe 4: Die Übernahme lernt Ergänzung, Umbenennung und Geometrie

Ohne sie ist der vierte Ausgang tot: `avesmapsGaretienUebernehmen` lehnt heute jedes
`change_type !== 'new'` mit „Stufe 1 legt nur an" ab und vermerkt es als `stale`. Ein Editor
hakte an, drückte, und bekäme „6 übersprungen, weil sich der Stand geändert hat" — für etwas, das
nie versucht wurde.

**Dateien:**
- Ändern: `api/_internal/import/garetien-uebernahme.php`
- Test: `api/_internal/import/__tests__/garetien-uebernahme-test.php` (ergänzen)

**Schnittstellen:**
- Verbraucht: `after.anlass`, `after.felder`, `after.abschnitt` aus Aufgabe 3.
- Erzeugt: `avesmapsGaretienErgaenzungAnwenden(PDO $pdo, array $nach, string $publicId, array $user): array{felder:int, quellen:int}`

💣 **DIE TEUERSTE FALLE DIESER AUFGABE: `avesmapsUpdatePathFeatureDetails` ist KEIN
Teil-Update.** Es liest `allowed_transports`, `transport_seasons`, `show_label` und
`feature_subtype` **aus dem Rumpf** und schreibt sie alle. Mit Vorgabewerten gerufen **löscht** es
die Verkehrsmittel und die Saisonfenster eines Flusswegs — lautlos, mit gültiger Antwort. Der
Aufrufer muss den aktuellen Stand lesen und unverändert zurückgeben; geschrieben wird **nur**,
was in `after.felder` steht. Das ist dieselbe Regel wie beim Sammel-Speichern der Weg-Ebene
(AGENTS.md §11: „geschrieben wird NUR, was jemand angefasst hat") und derselbe Fehler wie am
17.08.2026 in `avesmapsUpsertGameLiterature`.
⭐ `avesmapsUpdateEcosystemRegion` hat das Problem **nicht** — es liest nur mitgeschickte Felder
(`avesmapsEcosystemReadRegionFields`). Die Asymmetrie gehört als Kommentar an die Stelle, sonst
„vereinheitlicht" der nächste Leser sie zurück.

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
// ---------------------------------------------------------------------------------------------
// Der vierte Ausgang wird auch UEBERNOMMEN -- sonst haekelt ein Editor an, drueckt, und bekommt
// "uebersprungen, weil sich der Stand geaendert hat" fuer etwas, das nie versucht wurde.
$pdo = avesmapsGaretienPlanTestPdo();
$pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json) VALUES (?,?,?,?,?,?)')
    ->execute(['w-5112', '', 'path', 'Flussweg',
        json_encode(['type' => 'LineString', 'coordinates' => [[10.0, 10.0], [11.0, 11.0]]]),
        json_encode(['allowed_transports' => ['flussschiff'], 'transport_seasons' => ['flussschiff' => ['von' => 3, 'bis' => 10]]])]);

$runId = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, 1, 'test');
avesmapsSyncPlanAddItem($pdo, $runId, [
    'entity_key' => 'ggp:Gewaesser:Bach:Garetien:Alke|ergaenzung|w-5112',
    'entity_public_id' => 'w-5112',
    'change_type' => 'changed',
    'label' => 'Alke → ohne Namen',
    'before' => ['public_id' => 'w-5112', 'name' => ''],
    'after' => ['herkunft' => 'garetien', 'anlass' => 'ergaenzung', 'felder' => ['name', 'quelle'],
        'ziel' => 'path', 'subtyp' => 'Flussweg', 'name' => 'Alke',
        'abschnitt' => ['public_id' => 'w-5112', 'name' => '', 'punkte' => 12, 'geometrie' => []],
        'quelle' => ['url' => 'https://www.garetien.de/index.php?title=Garetien:Alke',
            'label' => 'Briefspiel (Garetien)', 'source_type' => 'briefspiel',
            'origin' => 'garetien', 'license' => 'cc-by-nc-sa-3.0', 'attribution' => 'VolkoV / garetien.de']],
    'override' => [], 'selected' => 1,
]);

$schritt = avesmapsGaretienApplyStep($pdo, $runId, 1, ['id' => 1, 'username' => 'test']);
assert($schritt['done'] === true, 'der Schritt muss fertig werden');
assert($schritt['applied'] === 1, 'die Ergaenzung wurde nicht uebernommen');
assert($schritt['stale'] === 0, 'ein changed darf nicht mehr als "Stufe 1 legt nur an" abgelehnt werden');

$nachher = $pdo->query("SELECT name, properties_json FROM map_features WHERE public_id = 'w-5112'")
    ->fetch(PDO::FETCH_ASSOC);
assert($nachher['name'] === 'Alke', 'die Luecke wurde nicht gefuellt');

// 💣 DIE TEUERSTE ZUSICHERUNG DIESER AUFGABE. avesmapsUpdatePathFeatureDetails ist KEIN
// Teil-Update: mit Vorgabewerten gerufen loescht es Verkehrsmittel und Saisonfenster -- lautlos,
// mit gueltiger Antwort. Geschrieben wird NUR, was in after.felder steht.
$props = json_decode((string) $nachher['properties_json'], true);
assert(($props['allowed_transports'] ?? []) === ['flussschiff'],
    'die Uebernahme hat die Verkehrsmittel des Flusswegs geloescht');
assert(isset($props['transport_seasons']['flussschiff']),
    'die Uebernahme hat die Saisonfenster des Flusswegs geloescht');

// Zweimal uebernehmen aendert nichts ein zweites Mal.
$zweiter = avesmapsGaretienApplyStep($pdo, $runId, 1, ['id' => 1, 'username' => 'test']);
assert($zweiter['applied'] === 0, 'ein vermerktes Item darf nicht noch einmal laufen');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Erwartet: `AssertionError: die Ergaenzung wurde nicht uebernommen` (`applied` ist 0, `stale` 1).

- [ ] **Schritt 3: Den Zweig schreiben**

`avesmapsGaretienUebernehmen`: die Weiche `if ((string) $item['change_type'] !== 'new')` wird
ersetzt.

```php
        $anlass = (string) ($nach['anlass'] ?? '');
        if ((string) $item['change_type'] === 'changed') {
            // 🔴 DER VIERTE AUSGANG. Bis zum 27.08.2026 stand hier "Stufe 1 legt nur an und
            // aendert nichts Vorhandenes" -- richtig, solange es den Ausgang nicht gab, und ab
            // dann genau die Stelle, an der ein angehaktes Item lautlos als `stale` verschwand.
            // ⚠️ `widerspruch` bleibt draussen: Artikel trifft, Geometrie nicht -- das ist eine
            // Frage an einen Menschen und keine Anweisung, unser Objekt zu ueberschreiben.
            if (!in_array($anlass, ['ergaenzung', 'umbenennung', 'geometrie'], true)) {
                $grund = '"' . $item['label'] . '" braucht eine Entscheidung von Hand';
                $fehler[] = ['item' => (int) $item['id'], 'grund' => $grund];
                avesmapsSyncPlanMarkItem($pdo, (int) $item['id'], 'stale', mb_substr($grund, 0, 300, 'UTF-8'));
                continue;
            }
            try {
                $ergebnis = avesmapsGaretienErgaenzungAnwenden(
                    $pdo, $nach, (string) $item['entity_public_id'], $user
                );
                $angelegt += $ergebnis['felder'] > 0 ? 1 : 0;
                $quellen += $ergebnis['quellen'];
                avesmapsSyncPlanMarkItem($pdo, (int) $item['id'], 'done', (string) $item['entity_public_id']);
            } catch (Throwable $abbruch) {
                $fehler[] = ['item' => (int) $item['id'], 'grund' => $abbruch->getMessage()];
                avesmapsSyncPlanMarkItem($pdo, (int) $item['id'], 'failed', mb_substr($abbruch->getMessage(), 0, 300, 'UTF-8'));
            }
            continue;
        }
```

Und der Anwender selbst:

```php
/**
 * Ein vorhandenes Objekt ERGAENZEN -- und zwar nur in den Feldern, die im Vorschlag stehen.
 *
 * 💣 avesmapsUpdatePathFeatureDetails IST KEIN TEIL-UPDATE. Es liest `allowed_transports`,
 * `transport_seasons`, `show_label` und `feature_subtype` aus dem RUMPF und schreibt sie alle.
 * Mit Vorgabewerten gerufen loescht es die Verkehrsmittel und die Saisonfenster eines Flusswegs
 * -- lautlos, mit gueltiger Antwort und gueltiger id. Deshalb wird der aktuelle Stand gelesen und
 * unveraendert zurueckgegeben; geraten wird nichts.
 * ⭐ avesmapsUpdateEcosystemRegion hat das Problem NICHT -- es liest nur mitgeschickte Felder.
 * Die Asymmetrie steht hier, damit sie niemand "vereinheitlicht".
 *
 * 🔴 KEIN EIGENES UPDATE auf map_features. Die Hausschreiber tragen Transaktion, Revision,
 * Sperrpruefung und Protokoll -- ein eigenes UPDATE waere der zweite Erzeuger.
 *
 * @return array{felder:int, quellen:int}
 */
function avesmapsGaretienErgaenzungAnwenden(PDO $pdo, array $nach, string $publicId, array $user): array
{
    $felder = (array) ($nach['felder'] ?? []);
    $userId = (int) ($user['id'] ?? 0);
    $geschrieben = 0;

    if (($nach['ziel'] ?? '') === 'path') {
        $zeile = $pdo->prepare('SELECT name, feature_subtype, properties_json FROM map_features WHERE public_id = :p');
        $zeile->execute([':p' => $publicId]);
        $vorher = $zeile->fetch(PDO::FETCH_ASSOC);
        if ($vorher === false) {
            throw new RuntimeException('Der Abschnitt ' . $publicId . ' existiert nicht mehr.');
        }
        $props = json_decode((string) ($vorher['properties_json'] ?? '{}'), true);
        $props = is_array($props) ? $props : [];

        if (in_array('name', $felder, true)) {
            // ⚠️ JEDES Feld des Hausschreibers reist mit seinem ALTEN Wert mit -- siehe oben.
            avesmapsUpdatePathFeatureDetails($pdo, [
                'public_id' => $publicId,
                'name' => (string) $nach['name'],
                'feature_subtype' => (string) ($vorher['feature_subtype'] ?? 'Flussweg'),
                'show_label' => (bool) ($props['show_label'] ?? false),
                'allowed_transports' => $props['allowed_transports'] ?? null,
                'transport_seasons' => $props['transport_seasons'] ?? null,
                'other_source' => $props['other_source'] ?? null,
            ], $user);
            $geschrieben++;
        }
        if (in_array('geometrie', $felder, true)) {
            avesmapsUpdatePathFeatureGeometry($pdo, [
                'public_id' => $publicId,
                'coordinates' => $nach['geometry']['coordinates'],
            ], $user);
            $geschrieben++;
        }
        $entityType = 'path';
    } else {
        if (in_array('name', $felder, true)) {
            avesmapsUpdateEcosystemRegion($pdo, [
                'public_id' => $publicId,
                'name' => (string) $nach['name'],
                'auto_name' => false,
            ], $userId);
            $geschrieben++;
        }
        if (in_array('geometrie', $felder, true)) {
            avesmapsUpdateEcosystemAreaGeometry($pdo, [
                'public_id' => $publicId,
                'geometry' => $nach['geometry'],
            ], $userId);
            $geschrieben++;
        }
        $entityType = 'region';
    }

    $quellen = 0;
    if (in_array('quelle', $felder, true)
        && avesmapsGaretienQuelleAnlegen($pdo, $entityType, $publicId, (array) ($nach['quelle'] ?? []), $userId)) {
        $quellen = 1;
        $geschrieben++;
    }

    return ['felder' => $geschrieben, 'quellen' => $quellen];
}
```

⚠️ `avesmapsUpdatePathFeatureGeometry` und `avesmapsUpdateEcosystemAreaGeometry` brauchen ihre
Dateien: `garetien-uebernahme.php` lädt `../map/features.php` und `../app/ecosystem.php` bereits.

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

- [ ] **Schritt 5: Der Endpunkt-Kettentest**

💣 `require_once` in `sync-plan.php` bleibt unverändert (`garetien-uebernahme.php` steht schon
drin). Der vorhandene `sync-plan-endpoint-chain-test.php` fährt weiter — laufen lassen, denn er
existiert genau für „irgendwer zieht das schon rein".

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/sync-plan-endpoint-chain-test.php
```

- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/import/garetien-uebernahme.php api/_internal/import/__tests__/garetien-uebernahme-test.php
git commit -m "garetien(uebernahme): Ergaenzung, Umbenennung und Geometrie werden wirklich geschrieben"
```

---
## Schritt 2 des Owners — Riegel, Urteilsspalte, Wächter, Leseliste (Aufgaben 5–8)

---

### Aufgabe 5: Der Riegel gegen die 360 ohne Position

360 Zeilen tragen die Marke `2000000 2000000`, umgerechnet **(1222 / −115,6)** — außerhalb
unserer Karte (0…1024). Alle 360 stehen im Kosch, 359 davon auf `kosch/Ortschaften_1` (72 % dieser
Seite). Volkers Ansage heißt „das Objekt gibt es, auf der Karte liegt es noch nicht". Heute
schriebe der Import sie klaglos; sie wären unsichtbar und unerreichbar.

⚠️ **Die Koordinate ist das Signal, nicht die LOD-Spanne** — 8 der 360 tragen eine andere, und
375 platzierte Zeilen tragen `14!14`. 🔴 Der Riegel gehört in `avesmapsGaretienUeberspringGrund`,
**nicht in die Oberfläche** (Auftrag §3.3). Betrifft Stufe 4, nicht Stufe 1 — die Gewässer sind
alle platziert; er wird trotzdem jetzt gebaut, weil Stufe 4 ihn sonst als Datenschaden bezahlt.

**Dateien:** ändern `api/_internal/import/garetien-abgleich.php` · Test
`api/_internal/import/__tests__/garetien-abgleich-test.php`

**Schnittstellen:** `avesmapsGaretienUeberspringGrund(array $zeile): ?string` bekommt einen
weiteren Zweig. Neu: `avesmapsGaretienLiegtAufDerKarte(array $punkte): bool`.

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
// ---------------------------------------------------------------------------------------------
// 💣 360 Zeilen haben KEINE Position: die Marke `2000000 2000000` wird zu (1222 / -115,6) und
// liegt damit ausserhalb von 0..1024. Alle 360 stehen im Kosch, 359 auf kosch/Ortschaften_1 --
// 72 % dieser Seite. Heute schriebe der Import sie klaglos; sie waeren unsichtbar UND
// unerreichbar, also nicht einmal von Hand zu reparieren.
//
// ⚠️ DIE KOORDINATE IST DAS SIGNAL, nicht die LOD-Spanne: 8 der 360 tragen eine andere, und 375
// platzierte Zeilen tragen `14!14`. Wer die Spanne prueft, verwirft 375 gute und behaelt 8 leere.
$ohne = ['typ' => 'Gasthaus', 'namensraum' => '', 'artikel' => 'Gelber Hund',
    'anzeige' => 'Gelber Hund', 'lodmin' => '14', 'lodmax' => '14',
    'geo_art' => 'koordinaten', 'geo' => '2000000 2000000'];
$grund = avesmapsGaretienUeberspringGrund($ohne);
assert($grund !== null, 'eine Zeile ohne Position muss uebersprungen werden');
assert(str_contains($grund, 'Position'), 'der Grund muss die fehlende Position benennen: ' . (string) $grund);

// Dieselbe LOD-Spanne, aber platziert -- die muss durch (375 solche Zeilen gibt es).
$mit = $ohne;
$mit['typ'] = 'Dorf';
$mit['geo'] = '-203183 -59326, -203100 -59300';
assert(avesmapsGaretienUeberspringGrund($mit) === null || !str_contains(
    (string) avesmapsGaretienUeberspringGrund($mit), 'Position'),
    'eine platzierte Zeile mit 14!14 darf NICHT an der Position scheitern');

// ⚠️ Ein Objekt, das nur mit einem Zipfel ueber den Rand ragt, bleibt drin. Verworfen wird nur,
// was GANZ draussen liegt -- sonst faellt der erste Kuestenverlauf heraus, der die 1024 streift.
assert(avesmapsGaretienLiegtAufDerKarte([[1030.0, 500.0], [1010.0, 500.0]]) === true,
    'ein Zipfel ueber dem Rand ist keine fehlende Position');
assert(avesmapsGaretienLiegtAufDerKarte([[1222.0, -115.6]]) === false,
    'die Marke selbst liegt nicht auf der Karte');
assert(avesmapsGaretienLiegtAufDerKarte([]) === true,
    'ohne Koordinaten entscheidet dieser Riegel NICHT -- ein Verweis-Objekt hat keine eigenen Punkte');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

- [ ] **Schritt 3: Riegel schreiben**

```php
/**
 * Die Kartengrenzen, gegen die "hat dieses Objekt ueberhaupt eine Position?" geprueft wird.
 * Unsere Karte ist 0..1024 (L.CRS.Simple, image bounds). Der Rand ist grosszuegig: verworfen
 * werden soll die MARKE, nicht ein Kuestenverlauf, der die Kante streift.
 */
const AVESMAPS_GARETIEN_KARTE_RAND = 64.0;

/**
 * Liegt wenigstens EIN Punkt auf der Karte?
 *
 * ⚠️ Ein leeres Ergebnis heisst NICHT "nein". Verweis-Objekte (Flaechen aus Grenzzuegen) haben
 * gar keine eigenen Koordinaten, und ein Riegel, der sie verwirft, naehme Stufe 5 mit.
 */
function avesmapsGaretienLiegtAufDerKarte(array $punkte): bool
{
    if ($punkte === []) {
        return true;
    }
    foreach ($punkte as [$x, $y]) {
        if ($x >= -AVESMAPS_GARETIEN_KARTE_RAND && $x <= 1024.0 + AVESMAPS_GARETIEN_KARTE_RAND
            && $y >= -AVESMAPS_GARETIEN_KARTE_RAND && $y <= 1024.0 + AVESMAPS_GARETIEN_KARTE_RAND) {
            return true;
        }
    }

    return false;
}
```

Und in `avesmapsGaretienUeberspringGrund`, **nach** der Namens- und **vor** der Typprüfung (ein
Objekt ohne Position ist auch dann keins, wenn sein Typ zu Stufe 1 gehört):

```php
    // 💣 360 Zeilen haben KEINE Position -- die Marke `2000000 2000000` wird zu (1222 / -115,6).
    // Alle 360 stehen im Kosch, 359 auf kosch/Ortschaften_1 (72 % dieser Seite). Volkers Ansage
    // heisst "das Objekt gibt es, auf der Karte liegt es noch nicht". Importiert waeren sie
    // unsichtbar UND unerreichbar -- nicht einmal von Hand zu reparieren.
    // ⚠️ DIE KOORDINATE IST DAS SIGNAL, nicht die LOD-Spanne (8 der 360 tragen eine andere,
    // und 375 platzierte Zeilen tragen `14!14`).
    if (!avesmapsGaretienLiegtAufDerKarte(avesmapsGaretienZeilePunkte($zeile))) {
        return 'Keine Position -- die Quelle setzt die Marke "noch nicht auf der Karte"';
    }
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 5: Gegenprobe am Livebestand — die Zahl muss 360 sein**

⚠️ Erst nach dem nächsten `fetch`-Lauf möglich; wenn kein Lauf vorliegt, als offener Punkt melden
statt zu raten. Der Riegel ist per Test belegt, die Zahl ist die Bestätigung, nicht der Beweis.

- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/import/garetien-abgleich.php api/_internal/import/__tests__/garetien-abgleich-test.php
git commit -m "garetien(abgleich): 360 Zeilen ohne Position werden nicht mehr importiert"
```

---

### Aufgabe 6: Urteil und Grund an die Staging-Zeile

§5.2 verlangt „deckt sich" (49) und „übersprungen" (6) als **Filterwerte**. Genau diese Zeilen
erzeugen keinen `sync_plan_item` — und `garetien_import_row` hat keine Urteilsspalte. Nach dem
Rechnen ist ihr Grund weg.

⚠️ Die zwei Spalten gehören in die **Staging**-Tabelle und verschwinden mit ihr (§5.5). Nichts
Zusätzliches landet in `sync_plan_item`.

**Dateien:** ändern `api/_internal/import/garetien-abruf.php` (DDL) und `garetien-plan.php`
(Schreiben) · Test `api/_internal/import/__tests__/garetien-staging-test.php`

**Schnittstellen:**
- `garetien_import_row` bekommt `urteil VARCHAR(20) NOT NULL DEFAULT ''` und
  `grund VARCHAR(300) NOT NULL DEFAULT ''`.
- `avesmapsGaretienSchreibeUrteil(PDO $pdo, int $importRunId, int $zeileNr, string $urteil, string $grund): void`

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
// ---------------------------------------------------------------------------------------------
// Das Urteil ueberlebt das Rechnen. Ohne die zwei Spalten sind die 49 "deckt sich" und die 6
// "uebersprungen" nach dem Plan-Lauf nicht mehr auffindbar -- sie erzeugen keinen sync_plan_item,
// und ihr Grund stand nur im Arbeitsspeicher.
$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienEnsureTables($pdo);   // muss auf einer BESTEHENDEN Tabelle nachziehen
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$urteile = $pdo->query('SELECT zeile_nr, urteil, grund FROM garetien_import_row WHERE run_id = 1 ORDER BY zeile_nr')
    ->fetchAll(PDO::FETCH_ASSOC);
$nach = [];
foreach ($urteile as $u) {
    $nach[(int) $u['zeile_nr']] = $u;
}
assert($nach[1]['urteil'] === 'deckt_sich', 'die Alke deckt sich und muss es auch nachher sagen');
assert($nach[1]['grund'] !== '', 'ein Urteil ohne Grund ist eine Zahl, die niemand pruefen kann');
assert($nach[2]['urteil'] === 'neu', 'der Gardel ist neu');
assert($nach[4]['urteil'] === 'uebersprungen', 'der Sammelartikel ist uebersprungen');
assert(str_contains($nach[4]['grund'], 'Sammelartikel'), 'der Grund des Ueberspringens fehlt');
assert($nach[5]['urteil'] === 'uebersprungen', 'die Insel gehoert zu Stufe 3');

// 🔴 Der Plan-Lauf schreibt in KEINE Nutztabelle -- nur in sein EIGENES Staging.
$vorher = $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn();
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === (int) $vorher,
    'das Rechnen hat eine Nutztabelle angefasst');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Erwartet: SQL-Fehler `no such column: urteil`.

- [ ] **Schritt 3: Die zwei Spalten selbstheilend nachziehen**

💣 `CREATE TABLE IF NOT EXISTS` legt an **bestehenden** Tabellen keine Spalte nach — live existiert
`garetien_import_row` bereits. Der Nachzug muss ein `ALTER` sein.
💣 Kein `information_schema`-Test: genau diese Sonde ist die Last, vor der AGENTS.md §10 warnt.
Der `ALTER` wird versucht und sein Duplikat-Fehler geschluckt — ein Round-Trip, kein Katalog.

Ans Ende von `avesmapsGaretienEnsureTables`, hinter das `CREATE`:

```php
    // 💣 Die zwei Spalten kamen SPAETER dazu (27.08.2026), und `CREATE TABLE IF NOT EXISTS` legt
    // an einer bestehenden Tabelle keine Spalte nach. Live steht die Tabelle bereits, also muss
    // der Nachzug ein ALTER sein.
    // ⚠️ Kein information_schema-Test davor: genau diese Sonde auf einem haeufigen Pfad ist die
    // Last, vor der AGENTS.md §10 warnt. Der Duplikat-Fehler ist die Antwort "gibt es schon",
    // und die kostet einen Round-Trip statt einer Katalogabfrage.
    foreach ([
        "ALTER TABLE garetien_import_row ADD COLUMN urteil VARCHAR(20) NOT NULL DEFAULT ''",
        "ALTER TABLE garetien_import_row ADD COLUMN grund VARCHAR(300) NOT NULL DEFAULT ''",
    ] as $sql) {
        try {
            $pdo->exec($sql);
        } catch (PDOException) {
            // Spalte steht schon -- der Normalfall ab dem zweiten Aufruf.
        }
    }
```

⚠️ Derselbe Nachzug gehört in `avesmapsGaretienPlanTestPdo()`s `CREATE TABLE`, damit der
SQLite-Prüfstand dieselbe Form hat (`urteil TEXT NOT NULL DEFAULT ''`, `grund TEXT NOT NULL DEFAULT ''`).

- [ ] **Schritt 4: Das Urteil beim Rechnen schreiben**

```php
/**
 * Das Urteil an die Staging-Zeile -- damit "deckt sich" und "uebersprungen" nach dem Rechnen
 * noch filterbar sind. Sie erzeugen keinen sync_plan_item, und ohne diese zwei Spalten waere ihr
 * Grund im Arbeitsspeicher geblieben.
 *
 * ⚠️ Es steht im STAGING und verschwindet mit ihm (Auftrag §5.5). In sync_plan_item landet
 * dadurch nichts Zusaetzliches.
 */
function avesmapsGaretienSchreibeUrteil(PDO $pdo, int $importRunId, int $zeileNr, string $urteil, string $grund): void
{
    $pdo->prepare('UPDATE garetien_import_row SET urteil = :u, grund = :g WHERE run_id = :r AND zeile_nr = :n')
        ->execute([
            ':u' => mb_substr($urteil, 0, 20, 'UTF-8'),
            ':g' => mb_substr($grund, 0, 300, 'UTF-8'),
            ':r' => $importRunId,
            ':n' => $zeileNr,
        ]);
}
```

In `avesmapsGaretienBaueSyncPlan` an **beiden** Stellen rufen: im Übersprung-Zweig
(`'uebersprungen', $grund`) und nach dem Abgleich (`$urteil['status'], $urteil['grund']`).
💣 Beide, oder es ist keine Regel: der Übersprung-Zweig steht **vor** dem Abgleich und wird sonst
nie erfasst — das sind genau die 6, um die es geht.

⚠️ „deckt sich" heißt ab Aufgabe 3 nicht mehr „kein Eintrag": Zeilen mit Ergänzungs-Items tragen
`urteil = 'deckt_sich'` **und** haben Items. Das Fenster liest den Urteilswert für den Filter und
die Items für die Handlungen — ein Widerspruch ist das nicht, es ist derselbe Sachverhalt aus zwei
Blickwinkeln. Die Liste (Aufgabe 8) zeigt solche Zeilen als **„Ergänzung"**, nicht als „deckt sich".

- [ ] **Schritt 5: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/import/garetien-abruf.php api/_internal/import/garetien-plan.php api/_internal/import/__tests__/garetien-staging-test.php
git commit -m "garetien(staging): Urteil und Grund ueberleben das Rechnen"
```

---

### Aufgabe 7: Der Wächter-Test — der Importer bleibt abbaubar

🔴 Owner 27.08.2026: *„nichts soll so gebaut werden, dass es nicht entfernt werden kann."* Das ist
keine Aufräumnotiz für später, sondern eine Bedingung an den Bau **heute**. Ein Gerüst, das man
erst am Ende abbauen will, ist am Ende festgewachsen — die Verdrahtung entsteht beiläufig, in
einer Abkürzung, die im Moment vernünftig aussieht.

**Dateien:** anlegen `api/_internal/import/__tests__/garetien-abbau-waechter-test.php`

- [ ] **Schritt 1: Den Test schreiben — und zuerst sehen, dass er WIRKLICH etwas prüft**

```php
<?php

declare(strict_types=1);

// 🔴 DER IMPORTER IST EIN GERUEST UND WIRD WIEDER ABGEBAUT (Auftrag §5.5).
// Nichts ausserhalb von api/_internal/import/ darf `garetien_import_row` oder
// `garetien_import_run` kennen -- kein Fremdschluessel, kein JOIN, kein Filter, keine Anzeige,
// kein Test einer Nutzoberflaeche. Dasselbe Muster wie editor-row-single-source.test.js und
// sync-plan-purity-test.php; das Haus fuehrt solche Waechter bereits.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-abbau-waechter-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
$erlaubt = 'api/_internal/import/';

// 💣 NUR VERFOLGTE DATEIEN. Ein repoweiter Verzeichnis-Scan liest die ungetrackte Sonde mit, die
// jemand gerade im Arbeitsbaum liegen hat -- der Test ist dann LOKAL rot und im Repo gruen, und
// die naechste Sitzung sucht einen Fehler, den es nicht gibt.
$verfolgt = [];
exec('git -C ' . escapeshellarg($wurzel) . ' ls-files -z', $roh, $code);
assert($code === 0, 'git ls-files ist fehlgeschlagen -- der Waechter kann so nichts belegen');
foreach (explode("\0", implode("\n", $roh)) as $pfad) {
    $pfad = trim($pfad);
    if ($pfad !== '') {
        $verfolgt[] = $pfad;
    }
}
assert(count($verfolgt) > 100, 'die Dateiliste ist unglaubwuerdig kurz: ' . count($verfolgt));

// ⚠️ Nur ausfuehrbarer Code und Markup. Doku DARF die Tabellen nennen -- der Auftrag und dieser
// Plan tun es auf jeder zweiten Seite, und ein Waechter, der Prosa verbietet, wird abgeschaltet.
$endungen = ['php', 'js', 'mjs', 'css', 'html', 'sql', 'yml', 'yaml'];
$treffer = [];
foreach ($verfolgt as $pfad) {
    $normal = str_replace('\\', '/', $pfad);
    if (str_starts_with($normal, $erlaubt)) {
        continue;
    }
    if (!in_array(strtolower(pathinfo($normal, PATHINFO_EXTENSION)), $endungen, true)) {
        continue;
    }
    $inhalt = @file_get_contents($wurzel . '/' . $normal);
    if ($inhalt !== false && str_contains($inhalt, 'garetien_import')) {
        $treffer[] = $normal;
    }
}

assert($treffer === [], "Der Importer ist festgewachsen. Diese Dateien ausserhalb von "
    . "{$erlaubt} kennen garetien_import_run/-row:\n  " . implode("\n  ", $treffer)
    . "\nDer Abbau (Auftrag §5.5) wuerde sie als Waisen zuruecklassen. Der richtige Griff fuer "
    . "\"woher kam das\" ist feature_sources.origin = 'garetien' -- der ueberlebt den Abbau.");

// 🪤 GEGENPROBE: ein Waechter, der nichts findet, weil er nichts SUCHT, ist gruen und wertlos.
// Genau daran ist am 26.08.2026 ein Testfeld-Lauf gescheitert (leere Ergebnisdatei, eine
// Sekunde Laufzeit, "null rot"). Deshalb wird hier belegt, dass der Scan die Dateien, in denen
// die Tabellen STEHEN DUERFEN, auch wirklich liest.
$drinnen = 0;
foreach ($verfolgt as $pfad) {
    $normal = str_replace('\\', '/', $pfad);
    if (str_starts_with($normal, $erlaubt) && str_ends_with($normal, '.php')
        && str_contains((string) @file_get_contents($wurzel . '/' . $normal), 'garetien_import')) {
        $drinnen++;
    }
}
assert($drinnen >= 3, 'der Waechter findet die Tabellen nicht einmal DORT, wo sie stehen duerfen '
    . "(gefunden: {$drinnen}) -- er sucht also gar nichts");

echo "OK: garetien_import steht in {$drinnen} Dateien, alle innerhalb von {$erlaubt}.\n";
```

- [ ] **Schritt 2: Den Wächter gegen sich selbst prüfen**

Eine Zeile `-- garetien_import_row` versuchsweise in eine Datei außerhalb schreiben (z. B.
`api/app/map-features.php`), den Test fahren, **Rot** sehen, die Zeile wieder entfernen, **Grün**
sehen. 🪤 Ohne diese Gegenprobe ist nicht belegt, dass der Test etwas prüft — genau die Falle, an
der ein grünes Testfeld schon einmal drei Läufe lang geglaubt wurde.

- [ ] **Schritt 3: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/import/__tests__/garetien-abbau-waechter-test.php
```

Erwartet: `OK: garetien_import steht in 4 Dateien, alle innerhalb von api/_internal/import/.`
(vier, weil Aufgabe 8 gleich `garetien-liste.php` dazustellt — vor Aufgabe 8 sind es drei.)

- [ ] **Schritt 4: Commit**

```bash
git add api/_internal/import/__tests__/garetien-abbau-waechter-test.php
git commit -m "garetien(abbau): ein Waechter haelt den Importer entfernbar"
```

---

### Aufgabe 8: Die Arbeitsliste — der Leseweg des Fensters

Das Fenster liest `sync_plan_item` **selbst**, mit Filter — „das ist ihr ganzer Zweck, und 259
Zeilen sind kein Mengenproblem" (Mockup §4). Die vorhandene Vorschau deckelt bei
`AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT = 200` je Gruppe; im Fenster gibt es diese Deckelung nicht.

🔴 Die Aktion sitzt am **Importer**-Endpunkt, nicht an `sync-plan.php`: sie liest
`garetien_import_row` (die 49 + 6 ohne Item), also darf sie nur dort stehen — und sie verschwindet
mit dem Endpunkt. Ein `liste` an `sync-plan.php` wäre ein Zweig, den die anderen sieben Arten
mittragen müssten.

**Dateien:** anlegen `api/_internal/import/garetien-liste.php` · ändern
`api/edit/map/garetien-import.php` · Test `api/_internal/import/__tests__/garetien-liste-test.php`

**Schnittstellen:**
- `avesmapsGaretienObjektSchluessel(string $entityKey): string` — alles vor dem ersten `|`.
- `avesmapsGaretienArbeitsliste(PDO $pdo, int $importRunId, array $filter): array`

```
{
  ok: true,
  plan_run_id: int,
  gesamt: int,                       // Objekte NACH Filter, vor der Deckelung
  objekte: [ {
     key, name, typ, wiki, ebene, urteil, grund,
     abschnitte: [ {public_id, name, punkte, geometrie} ],   // aus after.abschnitt der Items
     geometrie: [[x,y], …],                                   // IHRE Geometrie, aus after.geometry
     wiki_url, lodmin, lodmax, extra,
     items: [ {id, anlass, felder, selected, apply_state, before_name, after_name, abschnitt} ],
     stand: 'offen' | 'vorgemerkt' | 'abgelehnt' | 'uebernommen'
  } ],
  bilanz:  {neu, ergaenzung, zweifel, widerspruch, deckt_sich, uebersprungen},   // der LAUF
  reiter:  {offen, vorgemerkt, abgelehnt, uebernommen},
  facetten:{ebene:{…}, typ:{…}, urteil:{…}, wiki:{…}},                            // Zahlen je Filterwert
  angehakt:{new:int, changed:int}                                                 // fuer Aufgabe 16
}
```

`$filter`: `ebene`, `typ`, `urteil`, `wiki` (je Liste), `suche` (Freitext auf den Namen),
`nur_ungehakt` (bool), `nur_mehrteilig` (bool), `stand`, `versatz`, `anzahl`.

- [ ] **Schritt 1: Den fallenden Test schreiben**

```php
// Die Arbeitsliste: EINE Zeile je Objekt, ihre Items daran -- und die 49 + 6, die gar kein Item
// erzeugen, trotzdem sichtbar.
$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienEnsureTables($pdo);
avesmapsGaretienBaueSyncPlan($pdo, 1, 1);

$liste = avesmapsGaretienArbeitsliste($pdo, 1, []);
assert($liste['gesamt'] >= 6, 'alle sechs Fixture-Zeilen gehoeren in die Liste, auch die ohne Item');
$namen = array_column($liste['objekte'], 'name');
assert(in_array('Alke', $namen, true), 'die Alke deckt sich -- sie erzeugt kein new-Item und muss trotzdem dastehen');
assert(in_array('Llavari', $namen, true), 'der uebersprungene Sammelartikel muss sichtbar bleiben');

// 💣 EINE Zeile je Objekt, nicht je Item. Ihre Natter traegt fuenf Items und ist EINE Zeile.
$schluessel = array_column($liste['objekte'], 'key');
assert(count(array_unique($schluessel)) === count($schluessel), 'ein Objekt steht zweimal in der Liste');

// Der Filter greift SERVERSEITIG -- der Browser rechnet nichts nach.
$nurNeu = avesmapsGaretienArbeitsliste($pdo, 1, ['urteil' => ['neu']]);
foreach ($nurNeu['objekte'] as $o) {
    assert($o['urteil'] === 'neu', 'der Urteilsfilter laesst ' . $o['urteil'] . ' durch');
}
assert($nurNeu['gesamt'] < $liste['gesamt'], 'der Filter hat gar nichts weggenommen');

// Die Facetten zaehlen die Filterwerte -- ohne sie muesste der Browser die ganze Liste laden,
// um "Bach 143" in den Trichter zu schreiben.
assert(($liste['facetten']['wiki']['ggp'] ?? 0) > 0, 'die Wiki-Facette fehlt');
assert(($liste['facetten']['typ']['Bach'] ?? 0) > 0, 'die Typ-Facette fehlt');
assert(($liste['facetten']['ebene']['Gewaesser'] ?? 0) > 0, 'die Ebenen-Facette fehlt');

// ⚠️ Die Facetten zaehlen den LAUF, nicht die gefilterte Sicht -- sonst faellt beim ersten Klick
// jeder andere Wert auf 0 und der Trichter laesst sich nicht mehr oeffnen.
assert($nurNeu['facetten']['typ'] == $liste['facetten']['typ'],
    'die Facettenzahlen duerfen sich mit dem Filter nicht bewegen');

// Der Freitext sucht auf dem NAMEN.
$suche = avesmapsGaretienArbeitsliste($pdo, 1, ['suche' => 'gard']);
assert(count($suche['objekte']) === 1 && $suche['objekte'][0]['name'] === 'Gardel',
    'die Freitextsuche trifft den Namen nicht');

// Die Reiter zaehlen den BEARBEITUNGSSTAND, nicht das Urteil.
assert(isset($liste['reiter']['offen'], $liste['reiter']['vorgemerkt'],
    $liste['reiter']['abgelehnt'], $liste['reiter']['uebernommen']), 'die vier Reiter fehlen');
assert($liste['reiter']['uebernommen'] === 0, 'noch wurde nichts uebernommen');

// 🔴 KEINE Deckelung bei 200 -- das ist der ganze Zweck dieser Liste.
assert(!isset($liste['category_limit']), 'die Arbeitsliste kennt die 200er-Deckelung nicht');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

- [ ] **Schritt 3: `garetien-liste.php` schreiben**

Aufbau, in dieser Reihenfolge — jede Zeile mit ihrem Grund:

1. Den offenen Vorschau-Lauf holen (`avesmapsSyncPlanOpenRun($pdo, 'garetien')`). Keiner da →
   `objekte: []`, `gesamt: 0`; **kein Fehler** — das ist der Normalfall vor dem ersten Rechnen.
2. **Alle** Items des Laufs lesen (`SELECT … FROM sync_plan_item WHERE run_id = :r ORDER BY id`),
   **ohne** `LIMIT`. 💣 Nicht über `avesmapsSyncPlanItems` — die deckelt bei 200 je Gruppe, und
   genau die Deckelung soll hier wegfallen.
3. Nach `avesmapsGaretienObjektSchluessel($entityKey)` gruppieren. Ein Objekt trägt Name, Typ,
   Wiki, Ebene, ihre Geometrie und ihren Wiki-Link aus dem `after` seines **ersten** Items —
   die sind für alle Items eines Objekts identisch.
4. Die Staging-Zeilen dazuholen: `SELECT … FROM garetien_import_row WHERE run_id = :r`. Zeilen,
   deren Objektschlüssel schon aus Schritt 3 kommt, liefern nur `urteil`/`grund` nach; die
   übrigen (49 + 6) werden zu eigenen Objekten **ohne Items**.
   💣 Der Schlüssel muss auf **beiden** Seiten gleich gebaut werden. Er entsteht in
   `avesmapsGaretienPlanEintrag` als `wiki:ebene:typ:seite`; die Liste baut ihn aus derselben
   Formel — als **eine** Funktion `avesmapsGaretienObjektSchluesselAusZeile(array $zeile): string`,
   die auch `avesmapsGaretienPlanEintrag` benutzt. Zwei Formeln laufen beim ersten Sonderzeichen
   auseinander, und dann steht dasselbe Objekt zweimal in der Liste.
5. `urteil` je Objekt: hat es Items mit `anlass ∈ {ergaenzung, umbenennung, geometrie}` →
   **`ergaenzung`**; `anlass === 'zufluss'` → **`zweifel`**; `change_type === 'new'` sonst →
   **`neu`**; `anlass ∈ {artikel_widerspruch, zufluss}` bei `changed` → **`widerspruch`**; kein
   Item → der Staging-Wert (`deckt_sich` / `uebersprungen`).
   ⚠️ Das Urteil der Liste ist damit **feiner** als der Staging-Wert: eine Zeile mit
   `urteil='deckt_sich'` und Ergänzungs-Items heißt in der Liste „Ergänzung". Das ist gewollt —
   der Staging-Wert sagt, was der Abgleich fand, die Liste sagt, was zu tun ist.
6. `stand` je Objekt: irgendein Item `apply_state='done'` → `uebernommen`; alle Items in
   `sync_decision` als `declined` → `abgelehnt`; irgendein Item `selected=1` → `vorgemerkt`;
   sonst `offen`. Objekte ohne Items sind immer `offen`.
7. Facetten **vor** dem Filtern zählen, Objekte **nach** dem Filtern schneiden.
   💣 Facetten aus der gefilterten Sicht zu zählen macht den Trichter unbedienbar: nach dem
   ersten Klick stünde neben jedem anderen Wert eine 0, und niemand fände zurück.
8. `AVESMAPS_GARETIEN_LISTE_MAX = 500` Objekte je Antwort, `versatz` blättert, `gesamt` bleibt
   ehrlich. ⚠️ Bei 259 heute wirkungslos; bei allen 18 Ebenen (8348 Zeilen) trägt es.

- [ ] **Schritt 4: Die Aktion an den Endpunkt hängen**

In `api/edit/map/garetien-import.php`, **hinter** `$pdo`/`avesmapsGaretienEnsureTables` und neben
`runs`:

```php
    // --- Die Arbeitsliste des Fensters. REIN LESEND.
    // 🔴 Sie sitzt HIER und nicht an sync-plan.php: sie liest garetien_import_row (die Zeilen, die
    // gar keinen Vorschlag erzeugen) -- und was diese Tabelle kennt, steht innerhalb des Importers
    // (Auftrag §5.5). Ein `liste` an sync-plan.php muessten die anderen sieben Arten mittragen.
    if ($action === 'liste') {
        $importRun = (int) ($payload['run_id'] ?? 0);
        if ($importRun <= 0) {
            avesmapsErrorResponse(400, 'no_run', 'Es wurde kein Import-Lauf genannt.');
        }
        avesmapsJsonResponse(200, avesmapsGaretienArbeitsliste($pdo, $importRun, [
            'ebene' => (array) ($payload['ebene'] ?? []),
            'typ' => (array) ($payload['typ'] ?? []),
            'urteil' => (array) ($payload['urteil'] ?? []),
            'wiki' => (array) ($payload['wiki'] ?? []),
            'suche' => avesmapsNormalizeSingleLine((string) ($payload['suche'] ?? ''), 120),
            'nur_ungehakt' => ($payload['nur_ungehakt'] ?? false) === true,
            'nur_mehrteilig' => ($payload['nur_mehrteilig'] ?? false) === true,
            'stand' => avesmapsNormalizeSingleLine((string) ($payload['stand'] ?? 'offen'), 20),
            'versatz' => max(0, (int) ($payload['versatz'] ?? 0)),
        ]));
    }
```

💣 `require_once __DIR__ . '/../../_internal/import/garetien-liste.php';` oben ergänzen — ein
fehlendes `require` ist hier ein Fatal Error mit **leerem Rumpf**, und der liest sich im Browser
als Netzfehler („Unexpected end of JSON input"). Genau diese Falle hat der Wege-Editor am
19.08.2026 bezahlt.

- [ ] **Schritt 5: Test laufen lassen, grün bestätigen — beide Testdateien plus den Wächter**
- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/import/garetien-liste.php api/_internal/import/garetien-plan.php api/edit/map/garetien-import.php api/_internal/import/__tests__/garetien-liste-test.php
git commit -m "garetien(liste): die Arbeitsliste des Fensters -- ohne 200er-Deckelung"
```

- [ ] **Schritt 7: Das ganze Testfeld fahren und Schritt 1+2 gemeinsam pushen**

Erst hier wird gepusht — die Aufgaben 1–8 sind unsichtbar und dürfen zusammen live gehen.
💣 Nach dem Push den Lauf **abwarten**: ein zweiter Push, während der erste läuft, bricht dessen
Lauf ab, und ein abgebrochener Lauf lädt **nichts** hoch — dessen Dateien holt danach nie jemand
nach (AGENTS.md §9).

---
## Schritt 3 des Owners — Knopf, Hülle, Liste, Filter, Bilanz, Reiter (Aufgaben 9–12)

🔴 **Ab hier ist alles sichtbar.** Jede Aufgabe geht EINZELN live: ein Commit, ein Push, der
Blick des Owners, dann die nächste (AGENTS.md §9). Kein Bündel — am 10.08.2026 gingen neun
Mobil-Commits am Stück live, vier Regressionen waren darin, und Rückbau war die einzige schnelle
Antwort.

---

### Aufgabe 9: Die Hausformen erreichbar machen (unsichtbar, aber zuerst)

💣 **DER BEFUND, OHNE DEN DIESES FENSTER EINE DRITTE REZEPTUR WIRD.**
Das Mockup nennt für Menüband, Spalten, Reiter und Rollkasten die Bauteile aus
`css/components/editor-page.css` und schreibt „NEU? — nein". Aber **`editor-page.css` wird nur von
den sechs Editor-iframes in `html/` geladen, nie von `index.html`** — und dieses Fenster lebt in
`index.html`, weil es die laufende Karte freigeben muss.

⭐ **Das Haus hat genau diese Reise schon VIERMAL gemacht**, jedes Mal aus demselben Grund und
jedes Mal, weil eine Fläche in `index.html` eine Editorform brauchte:
`--avm-*` → `tokens.css` (15.08.) · `.avm-row` → `editor-row.css` (15.08.) · der Statuskreis →
`map-status-circle.css` (18.08.) · der Wiki-Override → `wiki-override.css` (22.08.). Dies ist die
fünfte. **Abschreiben ist keine Option** — genau daraus ist die Divergenz gewachsen, die die
Vereinheitlichung vom 14.08.2026 beseitigt hat (sieben Zeilenformen, vier davon Abschriften).

⭐ **`.type-filter` muss NICHT wandern**: es steht bereits ein zweites Mal in
`css/features/review-panel.css`, und die lädt `index.html`. (Dass es die Regel zweimal gibt, ist
ein Altbestand — er wird hier nicht mitrepariert und nicht vergrößert.)

**Dateien:**
- Anlegen: `css/components/editor-body.css`
- Ändern: `css/components/editor-page.css` (Blöcke raus, `@import` rein)
- Ändern: `css/styles.css` (`@import`)
- Test: `js/pages/__tests__/editor-body-single-source.test.js`

**Was wandert** (host-unabhängig, kein `.avm-editor-body`-Bezug):
`.avm-ribbon-bar` · `.avm-ribbon` · `.avm-tile` samt `.t1`/`.t2`/`--primary`/`--on` ·
`.avm-cols` · `.avm-col` · `.avm-col__title` · `.avm-col__bar` · `.avm-scroll` · `.avm-scroll--pad` ·
`.avm-tabs` · `.avm-tab` · `.avm-empty` · `.avm-error` · `.avm-pill`

**Was bleibt** in `editor-page.css`: die `:root`-Aliase, `body.avm-editor-body`, der
`:where(.avm-editor-body) input…`-Block, `.rb-menu*`, `.type-filter*`, die Bildlaufleisten — alles
das ist Editor-**Seiten**-Sache.

💣 **DIE FALLE, DIE DIESE AUFGABE KIPPT: die Regeln benutzen lokale Kurznamen.**
`--bg`, `--panel`, `--soft`, `--line`, `--line2`, `--fg`, `--mut`, `--accent`, `--warn`, `--bad`,
`--ok` stehen **ausschließlich** im `:root` von `editor-page.css`. In `index.html` gibt es sie
nicht — und eine ungültige `var()` macht die **ganze Deklaration** ungültig. `.avm-scroll` hätte
dort keinen weißen Grund und keinen Rahmen, `.avm-tab` keine gedämpfte Schrift; alles davon fällt
still auf `inherit` zurück. Genau davor warnt der Kopf von `editor-row.css` wörtlich, weil es
dort schon einmal passiert ist. **Beim Umzug wird jeder Alias durch sein echtes Token ersetzt**
(die Aliase zeigen ohnehin genau darauf, für die Editorseiten ändert sich also nichts):
`--panel`→`--color-panel` · `--soft`→`--color-panel-soft` · `--line`→`--color-border` ·
`--line2`→`--color-border-strong` · `--fg`→`--color-text-strong` · `--mut`→`--color-text-muted` ·
`--warn`→`--color-warning` · `--bad`→`--color-danger` · `--bg`→`--color-page-bg`.

⚠️ **`.avm-cols` bleibt dreispurig** (`repeat(3, …)`) — sechs Editoren stehen darauf. Das Fenster
braucht zwei und bekommt einen **Modifier** in derselben Datei, keine eigene Regel:

```css
/* Zwei Spuren statt drei. Ein MODIFIER, keine zweite Rezeptur: das Fenster „Garetien Importer"
   hat Liste und Einzelansicht nebeneinander und keine dritte Spalte. */
.avm-cols--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
```

- [ ] **Schritt 1: Vorher messen — die Zahl ist der Beweis, nicht das Gefühl**

Den siebten Editor (`html/landschaften-editor.html`) im Vorschau-Server öffnen und notieren:
die drei Spaltenbreiten, die Kachelbreiten des Menübands, die Höhe eines `.avm-scroll`. Das
2026-08-02er Umzug tat genau das („columns 466,66/466,67/466,66 px, five tiles at 269,59-269,61").
🪤 Ohne Vorher-Messung ist „hat sich nichts geändert" eine Behauptung.

- [ ] **Schritt 2: Den Wächter-Test schreiben** (`js/pages/__tests__/editor-body-single-source.test.js`)

Nach dem Vorbild von `editor-row-single-source.test.js`, mit drei Zusicherungen:

```js
// 1. Die Formen stehen GENAU EINMAL -- in editor-body.css, nicht mehr in editor-page.css.
assert.ok(!/^\.avm-cols\s*\{/m.test(editorPageOhneKommentare),
	".avm-cols steht wieder in editor-page.css -- daraus wird die naechste Divergenz.");
// 2. BEIDE Wirte binden die Datei: styles.css fuer index.html, editor-page.css fuer die sechs Seiten.
assert.ok(styles.includes('@import url("components/editor-body.css")'),
	"css/styles.css bindet editor-body.css nicht -- das Fenster in index.html haette keine Form.");
assert.ok(editorPage.includes('@import url("editor-body.css")'),
	"editor-page.css bindet editor-body.css nicht -- die sechs Editorseiten verloeren ihr Menueband.");
// 3. 💣 KEIN lokaler Alias in der geteilten Datei. --panel/--line/--mut existieren nur im :root
// von editor-page.css; in index.html macht eine ungueltige var() die GANZE Deklaration ungueltig,
// und der Rollkasten haette dort still keinen Grund und keinen Rahmen.
const aliase = ["--bg", "--panel", "--soft", "--line", "--line2", "--fg", "--mut", "--accent",
	"--warn", "--bad", "--ok"];
aliase.forEach((alias) => {
	assert.ok(!new RegExp("var\\(\\s*" + alias + "\\s*[,)]").test(editorBody),
		`editor-body.css benutzt den lokalen Alias ${alias}. Der steht nur im :root von `
		+ "editor-page.css und existiert in index.html NICHT -- eine ungueltige var() macht die "
		+ "ganze Deklaration ungueltig, lautlos. Echtes Token benutzen.");
});
```

💣 Vor dem Vergleich die Kommentare strippen (`/\/\*[\s\S]*?\*\//g`) — sonst schlägt der Test an
der Warnung an, die vor dem Muster warnt, und der nächste Leser löscht den Kommentar.
💣 Zeilenendenneutral suchen (`\n\}`, nicht `\r\n\}`): hier ist CRLF, im Deploy-Tor LF.

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen** — `node js/pages/__tests__/editor-body-single-source.test.js`
- [ ] **Schritt 4: Die Datei anlegen und die Blöcke umziehen**

Kopf von `css/components/editor-body.css`:

```css
/* Der gemeinsame Editor-KOERPER — Menüband, Kacheln, Spalten, Reiter, Rollkasten.
 * EINE Datei, weil die Formen an ZWEI Orten gebraucht werden.
 *
 * 💣 Sie standen bis 2026-08-27 in css/components/editor-page.css, und die laden nur die sechs
 *    Editor-SEITEN in html/. Das Fenster „Garetien Importer" lebt aber in index.html — es muss
 *    die laufende Karte freigeben und kann deshalb kein iframe-Editor sein. Ohne diesen Umzug
 *    hätte es die Formen abschreiben müssen, und genau daraus ist die Divergenz gewachsen, die
 *    die Vereinheitlichung vom 14.08.2026 beseitigt hat (sieben Zeilenformen, vier Abschriften).
 *
 * ⭐ Dieselbe Reise wie --avm-* → tokens.css, .avm-row → editor-row.css, der Statuskreis →
 *    map-status-circle.css und der Wiki-Override → wiki-override.css. Die fünfte, aus demselben
 *    Grund. Nicht zurückkopieren.
 *
 * 💣 HIER STEHEN DIE ECHTEN TOKENS, nicht die Kurznamen --mut/--line/--panel. Die sind lokale
 *    Aliase aus editor-page.css und existieren in index.html NICHT; eine ungültige var() macht
 *    die ganze Deklaration ungültig — der Rollkasten hätte dort still keinen Grund und keinen
 *    Rahmen. Die Aliase zeigen ohnehin genau auf diese Tokens, für die sechs Editorseiten ändert
 *    sich also nichts. Gewacht von js/pages/__tests__/editor-body-single-source.test.js.
 */
```

In `editor-page.css` an die Stelle der ausgezogenen Blöcke einen `@import` **ganz oben** (neben
die drei vorhandenen — ein `@import` muss vor jeder Regel stehen) und einen Kommentar, der sagt,
wohin sie gegangen sind. In `css/styles.css` neben `editor-row.css` denselben Import mit derselben
Begründung.

- [ ] **Schritt 5: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 6: Nachher messen — dieselben Zahlen wie in Schritt 1**

🔴 Weicht eine ab, ist der Umzug **nicht** fertig. Der 2026-08-02er Umzug hat vierzehn Maße
gegeneinandergehalten; hier genügen die Spaltenbreiten, die Kachelbreiten und eine Kastenhöhe.
💣 Und der Blick, nicht nur die Zahl: Menüband und Reiter eines Editors **ansehen**, hell und
dunkel (AGENTS.md §9 — „Abnahme heißt ABLAUF, nicht Maß").

- [ ] **Schritt 7: Das ganze Testfeld, dann Commit + Push (unsichtbar, aber eigener Lauf)**

```bash
git add css/components/editor-body.css css/components/editor-page.css css/styles.css js/pages/__tests__/editor-body-single-source.test.js
git commit -m "ui(editor): Menueband, Spalten, Reiter und Rollkasten stehen jetzt EINMAL fuer beide Welten"
```

⚠️ `ASSET_VERSION` bleibt unberührt — das sind keine dynamisch geladenen Editor-Assets (§7).
Der `?v=`-Stempel wird vom Deploy erledigt; **nie von Hand**.

---

### Aufgabe 10: Der Knopf und die Fensterhülle

**Dateien:** ändern `index.html` · anlegen `css/components/garetien-importer.css`,
`js/review/review-garetien-importer.js` · ändern `css/styles.css` (ein `@import`) ·
Test `js/review/__tests__/garetien-fenster-huelle.test.js`

**Schnittstellen (Produziert, für Aufgabe 11–16):**
- `avesmapsGaretienFensterOeffnen()` / `avesmapsGaretienFensterSchliessen()`
- `avesmapsGaretienFensterZustand()` → `{offen, planRunId, importRunId, objekte, auswahl, stand, filter}`
- `avesmapsGaretienRufe(pfad, rumpf)` → `Promise<object>` — **der EINE Sender.** POST, JSON,
  `credentials: "same-origin"`, wirft bei `ok !== true` mit `error.message`.
  💣 Er wird an genau **einer** Stelle geschrieben und von allen Aufrufern benutzt; die zwei
  erlaubten Adressen (`/api/edit/map/garetien-import.php` lesend,
  `/api/edit/wiki/sync-plan.php` schreibend) stehen nur hier. Der Test aus Aufgabe 15 zählt die
  `fetch(`-Vorkommen der Datei — ein dritter wäre der zweite Schreibweg.
- `window.avesmapsGaretienImporter = {oeffnen, schliessen, zustand, rufe}`

- [ ] **Schritt 1: Den fallenden Test schreiben**

```js
// Der Knopf steht unter „Dump holen" und ist NUR fuer Admins da (Owner 27.08.2026).
const html = fs.readFileSync("index.html", "utf8");
assert.ok(html.includes('id="garetien-importer-open"'), "Der Knopf fehlt in index.html.");
const block = html.slice(html.indexOf('class="wiki-sync-dump-central"'));
assert.ok(block.slice(0, block.indexOf("</div>\n\t\t\t\t</div>")).includes("garetien-importer-open"),
	"Der Knopf steht nicht im Block unter „Dump holen" -- der Owner hat genau dort danach gefragt.");
assert.ok(/id="garetien-importer-open"[^>]*hidden/.test(html),
	"Der Knopf muss HIDDEN starten. Der Riegel faellt geschlossen aus: bis die Rechteauskunft da "
	+ "ist -- und fuer immer, wenn sie nie kommt -- gilt „nicht freigeschaltet".");

// Die Huelle ist ein role=dialog mit __head -- damit ist sie ohne eine Zeile Verdrahtung
// verschiebbar (js/ui/dialog-drag.js sucht nach der FORM, nicht nach einer Namensliste).
assert.ok(/id="garetien-importer"[^>]*role="dialog"/.test(html),
	"Die Huelle braucht role=dialog, sonst greift dialog-drag.js nicht.");
assert.ok(html.includes('class="gi-win__head"'),
	"Die Kopfzeile muss auf __head enden -- danach sucht AVESMAPS_DIALOG_DRAG_HANDLES.");

// 🔴 KEIN Scrim, KEIN mittiges Modal: der Owner will die Karte SEHEN, waehrend er die Liste
// durchgeht. Deshalb ist die Huelle NICHT .avm-editor-dialog.
const css = fs.readFileSync("css/components/garetien-importer.css", "utf8");
assert.ok(!/backdrop-filter|\.gi-win__scrim/.test(css),
	"Ein Scrim verdeckt die Karte -- genau das soll dieses Fenster nicht.");
assert.ok(/\.gi-win\s*\{[^}]*position:\s*fixed/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")),
	"Das Fenster schwebt ueber der Karte, es sitzt nicht im Fluss.");

// Der Riegel steht im JS und faellt geschlossen aus.
const js = fs.readFileSync("js/review/review-garetien-importer.js", "utf8");
assert.ok(js.includes("capabilities.admin === true"),
	"Der Knopf muss ausdruecklich auf `=== true` pruefen. Eine als JSON geparste Fehlerseite, "
	+ "eine 1 statt true, ein Proxy mit \"0\" -- alles davon ist truthy.");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Den Knopf ins Markup**

Als dritter `.wiki-sync-dump-solo` neben „📥 Dump holen" und „⚖️ Konflikte":

```html
<!-- Der Kartenimport aus garetien.de / koschwiki.de. 🔴 ZUNAECHST NUR FUER ADMINS (Owner
     27.08.2026) -- deshalb `hidden`, und sichtbar erst, wenn die Sitzungsauskunft `admin`
     bestaetigt (js/review/review-garetien-importer.js). Der Riegel faellt geschlossen aus.
     🔴 Der Knopf, das Fenster und sein CSS verschwinden beim Abbau des Importers restlos
     (Auftrag §5.5) -- deshalb liegen sie in EIGENEN Dateien und nicht verstreut. -->
<div class="wiki-sync-dump-solo">
	<button id="garetien-importer-open" class="wiki-sync-panel__start" type="button" hidden
		title="Öffnet den Garetien Importer: die Objekte aus garetien.de und koschwiki.de, Stück für Stück ansehen und entscheiden. Es wird nichts geschrieben, bis du „Angehakte übernehmen" drückst.">🗺️ Garetien Importer</button>
</div>
```

Und die Hülle als letztes Kind von `<body>`, neben den übrigen Overlays:

```html
<!-- Das Fenster „Garetien Importer". 🔴 KEIN mittiges Modal und KEIN Scrim: der Owner will die
     Karte SEHEN, waehrend er die Liste durchgeht („ich will eine liste in einem dialog fenster
     (zum hin und herschieben)"). .avm-editor-dialog verdeckt sie vollstaendig -- ein Fenster, das
     die Karte freigibt, ist eine andere Sache, nicht eine schlechter eingestellte gleiche.
     ⭐ Verschiebbar OHNE eine Zeile Verdrahtung: js/ui/dialog-drag.js sucht nach der FORM
     ([role=dialog] > [class*="__head"]), nicht nach einer Namensliste. -->
<div id="garetien-importer" class="gi-win" role="dialog" aria-label="Garetien Importer" hidden>
	<div class="gi-win__head">
		<span class="gi-win__grip" aria-hidden="true">⣿⣿</span>
		<h2 class="gi-win__title">Garetien Importer</h2>
		<button class="gi-win__x" type="button" id="garetien-importer-close" aria-label="Schließen">✕</button>
	</div>
	<div class="avm-ribbon" id="garetien-ribbon"></div>
	<p class="gi-runline" id="garetien-runline"></p>
	<div class="avm-cols avm-cols--2">
		<div class="avm-col" id="garetien-listcol"></div>
		<div class="avm-col" id="garetien-detailcol"></div>
	</div>
	<div class="gi-foot">
		<span class="gi-foot__count" id="garetien-foot-count"></span>
		<button class="btn btn--main" type="button" id="garetien-apply" disabled>Angehakte übernehmen</button>
	</div>
	<p class="gi-foot__note">Nichts davon steht in der Karte. „Übernehmen" geht durch die
		vorhandene Übernahme-Vorschau — zweite Bestätigung, Häppchen zu 40, Protokoll.</p>
</div>
```

- [ ] **Schritt 4: Das CSS der Hülle**

Nur das, was **neu** ist — Hülle, Kopf, Laufzeile, Fuß. Alles andere kommt aus `editor-body.css`
und `editor-row.css`. Aus dem Mockup übernommen, mit **echten Tokens**:

```css
/* Das Fenster „Garetien Importer" — die Hülle und die Abschnittszeile. Sonst nichts.
 * 🔴 DIESE DATEI VERSCHWINDET BEIM ABBAU (Auftrag §5.5), samt ihrer einen Zeile in styles.css.
 *    Deshalb steht hier NUR, was es sonst nirgends gibt: Menüband, Kacheln, Spalten, Reiter,
 *    Rollkasten und Listenzeile kommen aus editor-body.css und editor-row.css und bleiben.
 */
.gi-win {
	position: fixed;
	left: var(--space-16);
	top: var(--space-16);
	z-index: var(--z-dialog);
	display: flex;
	flex-direction: column;
	width: min(800px, calc(100vw - 2 * var(--space-16)));
	/* 💣 FESTE Höhe, nicht bloß max-height: der Kasten verteilt seinen Platz auf seine Spalten,
	   und eine Verteilung braucht eine Bezugsgröße. Mit nur max-height fiel die Liste beim ersten
	   Wurf auf NULL zusammen — gemessen beim Zeichnen des Mockups, nicht vermutet.
	   ⚠️ Kleiner als --avm-editor-h: dieses Fenster muss NEBEN der Karte bestehen, nicht statt
	   ihrer. */
	height: min(700px, calc(100vh - 2 * var(--space-16)));
	border: 1px solid var(--color-border-strong);
	border-radius: var(--radius-sm);      /* Hülle sm, Bedienelemente md — Designsprache */
	background: var(--color-panel);
	box-shadow: var(--shadow-dialog);
	font-size: var(--font-size-body);
	line-height: var(--leading-snug);
	color: var(--color-text);
	overflow: hidden;
}
.gi-win[hidden] { display: none; }
```

Dazu `.gi-win__head` (mit `cursor: grab`), `.gi-win__grip`, `.gi-win__title`, `.gi-win__x`,
`.gi-runline`, `.gi-foot`, `.gi-foot__count`, `.gi-foot__note` — Zeile für Zeile aus dem Mockup,
jeder Kurzname durch sein echtes Token ersetzt.

⚠️ **`.gi-win .avm-col + .avm-col { padding: 0 }`** — die rechte Spalte polstert nicht selbst,
das tut die rollende Einzelansicht darin. Specificity 0,3,0 schlägt die geteilte 0,2,0.

- [ ] **Schritt 5: Das Modul mit dem Rechte-Riegel**

```js
/*
 * Das Fenster „Garetien Importer" — Knopf, Hülle, Liste, Einzelansicht, Handlungen.
 *
 * 🔴 DIESE DATEI VERSCHWINDET BEIM ABBAU DES IMPORTERS (Auftrag §5.5). Sie kennt deshalb
 *    `garetien_import_row` nicht und darf es nie: was diese Tabelle kennt, steht innerhalb von
 *    api/_internal/import/. Der Griff für „woher kam das" ist feature_sources.origin.
 * 🔴 SIE RECHNET NICHTS NACH. Urteil, Grund, Geometrie (fertig in Karteneinheiten) und die
 *    getroffenen Abschnitte kommen aus after_json. Der Browser wählt aus, blendet ein und
 *    schickt Häkchen — er transformiert keine Koordinate und bildet kein Urteil.
 * 🔴 UND ER SCHREIBT NUR DURCH EINE TÜR: api/edit/wiki/sync-plan.php mit kind:'garetien'.
 */
"use strict";

// 🔴 Der Riegel fällt GESCHLOSSEN aus: bis die Auskunft da ist — und für immer, wenn sie nie
// kommt — bleibt der Knopf verborgen. Nur echtes `true` zählt; eine als JSON geparste
// Fehlerseite, eine 1 statt true, ein Proxy mit "0" sind alle truthy.
function avesmapsGaretienDarfOeffnen(sitzung) {
	return !!(sitzung && sitzung.capabilities && sitzung.capabilities.admin === true);
}
```

Beim Laden: `window.AvesmapsSession.load().then(…)` → bei `admin` das `hidden` vom Knopf nehmen
und ihn verdrahten. ⚠️ Kein zweiter Rechteweg — dieselbe Auskunft, die `js/app/session.js`
ohnehin einmal holt.

- [ ] **Schritt 6: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 7: Im Browser abnehmen — der ABLAUF, nicht das Maß**

Fenster öffnen · an der Kopfzeile **wirklich verschieben** · die Karte darunter **noch bedienen**
(zoomen, ziehen) · ✕ schließen · hell **und** dunkel. 💣 „Abnahme heißt ABLAUF, nicht Maß"
(AGENTS.md §9): eine Prüfseite, die Rechtecke misst, belegt nur, dass eine Zahl stimmt.

- [ ] **Schritt 8: Commit und EINZELN pushen, dann den Blick des Owners abwarten**

```bash
git add index.html css/styles.css css/components/garetien-importer.css js/review/review-garetien-importer.js js/review/__tests__/garetien-fenster-huelle.test.js
git commit -m "garetien(fenster): der Knopf unter Dump holen und die verschiebbare Huelle"
```

---

### Aufgabe 11: Die Liste — Zeilen, Bilanz, Reiter

**Dateien:** ändern `js/review/review-garetien-importer.js` · Test
`js/review/__tests__/garetien-liste-zeile.test.js`

**Schnittstellen (Produziert, für Aufgabe 12–16):**
- `garetienZeileMarkup(objekt)` → `string` — **rein**, kein DOM-Zugriff, damit der Test sie ohne
  Browser fahren kann.
- `avesmapsGaretienListeHolen()` → `Promise<void>` — holt `action:'liste'` mit dem aktuellen
  Filter und dem aktuellen Reiter, schreibt Liste, Bilanz, Reiterzahlen und Fußzeile neu und
  ruft `avesmapsGaretienKarteZeigen` mit den angehakten Objekten.
  💣 **Der EINE Weg, auf dem die Liste sich ändert.** Jede Handlung endet damit statt mit einer
  Rechnung im Browser: der Server ist die Wahrheit über `selected`, und zwei Buchhaltungen
  laufen beim ersten Abbruch auseinander.
- `avesmapsGaretienAngehakt(changeType)` → `number` — wie viele Items dieses `change_type` im
  **ganzen** Lauf angehakt sind, aus der letzten `liste`-Antwort (`angehakt.new` /
  `angehakt.changed`, Aufgabe 8). ⚠️ Aufgabe 16 braucht die Zahl, um dem Übernahme-Blatt eine
  ehrliche `truncated`-Angabe zu geben — sie darf **nicht** aus den gerade sichtbaren Zeilen
  gerechnet werden, die sind gefiltert.

🔴 **Die Zeile ist `.avm-row`, unverändert.** Name und Typ in `__l1` (`__name` / `__kind`),
Urteil und Grund in der gedämpften `__l2`, das Häkchen davor, hinter dem Namen das ✦ für
„leuchtet gerade". 🪤 **Nicht abschreiben** — beim Abschreiben fällt die Skala: `.se-row-type`
stand nach einer Abschrift auf 10px, unter der 11px-Untergrenze aus AGENTS.md §12, und der Fehler
wanderte von einer Abschrift in die nächste.

⚠️ Das Häkchen ist neu an `.avm-row` (keine der sechs Editorlisten hat eins). Es ist ein
**Modifier**, keine zweite Zeile: `.gi-win .avm-row > input[type=checkbox] { … }` in
`garetien-importer.css`, mit `accent-color: var(--color-check-accent)`.

🔴 **Das dreiwertige Häkchen.** Ein Objekt, dessen Abschnitte teils gehakt sind, zeigt
`indeterminate` (den Strich, nicht den Haken). Anklicken hakt **alle änderbaren** Items an, nie
die unveränderten. ⚠️ `indeterminate` ist eine **Eigenschaft**, kein Attribut — `el.indeterminate
= true` im JS; ein `indeterminate=""` im Markup tut nichts.

🔴 **Zwei Bilanzzeilen, und sie sagen Verschiedenes** (Owner 14.08.2026):
- Die **stille** Zeile ÜBER der Suche (`.gi-runline`) ist die Bilanz des **Laufs** — sie bewegt
  sich beim Filtern nicht.
- Die Zeile UNTER der Suche ist die des **Filters** und kommt aus
  `avesmapsListBalanceText("Objekten", sichtbar, gesamt, "Objekten")`.
  🔴 **`js/review/review-list-balance.js` ist der EINE Erzeuger — nicht nachbauen.** Acht Kopien
  dieser Formel waren in drei Monaten wieder achtfach verschieden.
  ⚠️ Der Dativ: „Objekt" → die Faustregel bildet „Objekten", das stimmt; kein Extra-Argument nötig.
  Das ✦-Stück („✦ 3 leuchten") wird **daneben** gehängt, nicht in die geteilte Formel gerechnet.

🔴 **Die Reiter zeigen den BEARBEITUNGSSTAND, nicht das Urteil**: Offen · Vorgemerkt · Abgelehnt ·
Übernommen. Sie sind `.avm-tabs`/`.avm-tab`. ⚠️ Die aktive Unterstreichung ist
`--color-text-strong` (so steht die Hausform); das Mockup zeichnet sie golden — die **Hausform
gewinnt**, das Mockup nennt den Reiter selbst „nein — nicht neu".

- [ ] **Schritt 1: Den fallenden Test schreiben** — mit diesen Zusicherungen:
  - `garetienZeileMarkup(objekt)` erzeugt genau `avm-row`, `avm-row__text`, `avm-row__l1`,
    `avm-row__name`, `avm-row__kind`, `avm-row__l2` — und **keine** eigene Zeilenklasse.
  - Ein Objekt mit `urteil:'ergaenzung'` trägt `u--erg`, `neu` → `u--neu`, `zweifel` → `u--zweif`,
    `widerspruch` → `u--wider`, `deckt_sich`/`uebersprungen` → `u--deckt`.
  - Ein Objekt mit 5 Abschnitten und 2 angehakten Items ergibt `dreiwertig === true`.
  - Alle Items angehakt → `checked`, keins → weder `checked` noch `indeterminate`.
  - Ein Objekt **ohne** Items (deckt sich / übersprungen) hat ein **deaktiviertes** Häkchen —
    „es gibt nichts zu tun; die Zeile steht nur da, damit die Zahl nachprüfbar bleibt".
  - Die Bilanz ruft `avesmapsListBalanceText` **wirklich** (Spion), statt den Text zu bauen.
  - 💣 Ein Test, der nur das Markup liest, sieht das nicht: der Spion prüft die **Laufzeit**.

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Liste, Bilanz und Reiter bauen** — die linke Spalte füllt:
  `.avm-tabs` · `.gi-searchrow` (Suchfeld + `.type-filter__toggle`) · `.gi-chips` ·
  die Filterbilanz · `.avm-scroll.gi-list` mit den Zeilen.
  Daten aus `action:'liste'` (Aufgabe 8), Filter serverseitig, **nichts** im Browser gerechnet.
- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 5: Im Browser abnehmen** — durch die Liste rollen, Reiter wechseln, tippen und
  sehen, dass sich die **untere** Bilanz bewegt und die **obere** nicht. Hell und dunkel.
- [ ] **Schritt 6: Commit, einzeln pushen, Blick abwarten**

```bash
git commit -m "garetien(fenster): die Arbeitsliste mit Bilanz und den vier Reitern"
```

---

### Aufgabe 12: Der Filtertrichter

Sechs Abschnitte (Auftrag §5.2): **Ebene** (18) · **Objekttyp** (64) · **Urteil** ·
**Wiki** (ggp/kosch) · **Nur zeigen** (nur ungehakte · nur mit mehreren Abschnitten) ·
**Freitext** auf den Namen.

🔴 **`.type-filter` ist die Hausform** und über `css/features/review-panel.css` in `index.html`
bereits da (Aufgabe 9). Kein eigenes Menü, keine zweite Menü-Rezeptur.
⚠️ **Filter über Sortierung** (Designsprache) — und es gibt **keine Sortierung**: „Die Reihenfolge
ist die der Quelle; sie ist der Faden, an dem man sich durch die Liste hangelt. Sortieren
zerschnitte ihn" (Mockup §12).

- [ ] **Schritt 1: Den fallenden Test schreiben**
  - Alle sechs Abschnitte sind im Markup, jeder mit `.type-filter__section-title`.
  - Jede Option trägt ihre Zahl aus `facetten` (`.type-filter__count`).
  - 💣 Die Zahlen bewegen sich **nicht**, wenn ein Filter greift — sie zählen den Lauf. Sonst
    stünde nach dem ersten Klick neben jedem anderen Wert eine 0 und niemand fände zurück.
  - Ein gesetzter Filter erzeugt einen `.gi-chip` mit ✕, und das ✕ nimmt **nur ihn** zurück.
  - Der Knopf trägt die Zahl der aktiven Filter („Filter ▾ (2)") und `is-active`.
- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Bauen** — das Menü aus `facetten`, ein `liste`-Aufruf je Änderung.
  ⚠️ Das Aufklappen ist **kein neuer Mechanismus**: dieselbe `hidden`-Umschaltung wie beim
  Vorkommen-Trichter nebenan. 💣 Der Zustand ist das `hidden` des Panels und **sonst nichts** —
  kein Modulzustand daneben, der auseinanderlaufen kann; genau daran sind das Anzeige-Menü der
  Karte und die Ansichts-Kacheln schon gescheitert.
- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 5: Im Browser abnehmen** — jeden der sechs Abschnitte einmal wirklich benutzen,
  einen Chip wegklicken, hell und dunkel.
- [ ] **Schritt 6: Commit, einzeln pushen, Blick abwarten**

```bash
git commit -m "garetien(fenster): der Filtertrichter mit allen sechs Abschnitten"
```

---
## Schritt 4 des Owners — Einzelansicht und Karte (Aufgaben 13–14)

---

### Aufgabe 13: Die Einzelansicht — das Herzstück

Ein Klick auf eine Zeile zeigt rechts: ihren Namen und Typ · ihren Wiki-Artikel (verlinkt),
LOD-Spanne, Ebene, `extra` · **was bei uns an derselben Stelle liegt** (die Abschnitte, jeder mit
eigenem Häkchen) · den Grund · die Quelle, die mitreist. **Noch keine Handlung** — die Knopfleiste
kommt in Aufgabe 15.

**Dateien:** ändern `js/review/review-garetien-importer.js`, `css/components/garetien-importer.css` ·
Test `js/review/__tests__/garetien-einzelansicht.test.js`

🔴 **`.gi-seg` ist die Abschnittszeile und KEINE dritte Listenrezeptur.** Sie steht nicht in einer
Liste von Objekten, sondern **innerhalb der Einzelansicht EINES Objekts** — so wie `.diff` im
Übernahme-Blatt innerhalb einer Zeile steht. Wer sie als dritte zählt, müsste `.diff` als vierte
zählen. (Mockup §3)

🪤 **Die Spalten sind `grid`, nicht `flex`** — ein `border-box`-Kind kann nicht unter seine eigene
Polsterung schrumpfen, und die gepolsterte Spalte behielte die größere Basis. Rasterspuren kennen
das nicht. Gemessen zweimal falsch (Abenteuer 483/458/458, Karten 459/673/244).

🪤 **`scrollbar-gutter: stable both-edges` in der Einzelansicht ist tragend, nicht Kosmetik.** Mit
einfachem `stable` nimmt die Bildlaufleiste ihre 15 px **nur rechts** — gemessen 12 links gegen 27
rechts. Die Designsprache verlangt gleiche Einzüge („Symmetric insets — left gap equals right
gap"). Nebeneffekt: die Zeilen springen auch dann nicht, wenn ein Objekt mit 13 Abschnitten die
Leiste erscheinen lässt.

⚠️ **Die Trennlinien HIER laufen nicht vollflächig.** Die Ansicht rollt, und ein negativer
Seitenrand liefe unter die Bildlaufleiste. Sie enden bündig mit dem Inhalt — links wie rechts
derselbe Abstand. (Die Vollflächigkeits-Regel der Designsprache gilt Panels, nicht Rollkästen;
dieselbe Ausnahme wie im Fenster „Hinweise".)

⚠️ **Gruppiert wird durch Trennlinie + Überschrift, nicht durch Kästen** (`.gi-sec`,
`--color-accent-strong`, `--font-size-caption`, Versalien). Genau **eine** Behandlung für alle
Geschwisterabschnitte — nie gerahmte neben nackten.

⚠️ **Der Wiki-Link ist auswärts und bekommt das `↗`** — automatisch über die geteilte Regel, nie
von Hand getippt.

Die vier Zustände einer `.gi-seg` (aus `after.felder` des Items, **nicht** im Browser gerechnet):

| Zustand | Klasse | Beschriftung | Häkchen |
|---|---|---|---|
| Lücke: kein Name | `.gi-seg__name.is-empty` | „Name + Quelle" | vorangehakt |
| Lücke: nur Quelle fehlt | — | „Quelle fehlt" | vorangehakt |
| Überschreiben | `.gi-seg.is-overwrite` | alt → neu im Klartext, Warnton | **ungehakt** |
| Nichts zu tun | `.gi-seg.is-full` | „nichts zu ersetzen" | deaktiviert |

- [ ] **Schritt 1: Den fallenden Test schreiben**

```js
// Die Einzelansicht zeigt, WAS BEI UNS an derselben Stelle liegt -- und je Abschnitt ein Haekchen.
const natter = {
	name: "Natter", typ: "Fluss", urteil: "ergaenzung", wiki_url: "https://www.garetien.de/…",
	abschnitte: [
		{ public_id: "w-4471", name: "Natter", punkte: 9 },
		{ public_id: "w-5008", name: "Gardel", punkte: 6 },
		{ public_id: "w-6120", name: "", punkte: 1 },
	],
	items: [
		{ id: 11, anlass: "ergaenzung", felder: ["quelle"], selected: true,
		  abschnitt: { public_id: "w-4471", name: "Natter" } },
		{ id: 12, anlass: "ergaenzung", felder: ["name", "quelle"], selected: true,
		  abschnitt: { public_id: "w-6120", name: "" } },
	],
};
const markup = garetienDetailMarkup(natter);

// 💣 JEDER getroffene Abschnitt steht da -- auch der, an dem sich nichts aendert. Wer nur die
// Items zeichnet, verschweigt den Gardel, und dann sieht der Fall aus wie ein zweiteiliger.
assert.ok(markup.includes("w-4471") && markup.includes("w-5008") && markup.includes("w-6120"),
	"alle drei getroffenen Abschnitte gehoeren in die Einzelansicht");
assert.ok(/gi-seg[^"]*is-full[^"]*"[\s\S]{0,400}Gardel/.test(markup),
	"der Gardel bekommt kein Item und muss als `is-full` dastehen: nichts zu ersetzen");
assert.ok(markup.includes("is-empty"), "ein namenloser Abschnitt wird als Luecke gekennzeichnet");

// Die Zahl im Kasten ist die der ABSCHNITTE, nicht der Items.
assert.ok(/3 Abschnitte/.test(markup), "die Ueberschrift zaehlt die Abschnitte");
assert.ok(/3 verschiedene Flüsse|3 verschiedene/.test(markup),
	"💣 Ihr EINES Objekt laeuft ueber drei unserer Fluesse -- das ist die Auskunft, wegen der es "
	+ "die Einzelansicht ueberhaupt gibt. Ohne sie haelt ein Editor den Fall fuer einteilig.");

// 🔴 Der Browser rechnet NICHTS nach: Grund und Deckung kommen fertig vom Server.
const quelle = fs.readFileSync("js/review/review-garetien-importer.js", "utf8");
assert.ok(!/Math\.sqrt|Math\.hypot/.test(quelle),
	"Ein Abstand im Browser ist die zweite Rechnung, die Auftrag §5.4 verbietet.");

// Ein Ueberschreiben zeigt alt -> neu im KLARTEXT und startet ungehakt.
const strasse = { name: "Angbarer Reichsstraße", typ: "Reichsstrasse", urteil: "ergaenzung",
	abschnitte: [{ public_id: "w-2210", name: "Reichsstraße 3", punkte: 3 }],
	items: [{ id: 21, anlass: "umbenennung", felder: ["name"], selected: false,
		abschnitt: { public_id: "w-2210", name: "Reichsstraße 3" } }] };
const m2 = garetienDetailMarkup(strasse);
assert.ok(m2.includes("is-overwrite"), "ein vorhandener Name traegt den Warnton");
assert.ok(m2.includes("Reichsstraße 3") && m2.includes("Angbarer Reichsstraße"),
	"alt -> neu steht im Klartext -- nichts wird stillschweigend ueberschrieben");
assert.ok(!/is-overwrite[\s\S]{0,200}checked/.test(m2),
	"ein Ueberschreiben startet UNGEHAKT (Owner: vorangehakt ist nur das Fuellen einer Luecke)");

// Und das CSS haelt die zwei Fallen, die beim Zeichnen des Mockups gemessen wurden.
const css = fs.readFileSync("css/components/garetien-importer.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(/scrollbar-gutter:\s*stable\s+both-edges/.test(css),
	"Ohne `both-edges` nimmt die Bildlaufleiste ihre 15px nur rechts -- gemessen 12 links gegen 27 rechts.");
assert.ok(/\.gi-seg\s*\{[^}]*display:\s*grid/.test(css),
	"Die Abschnittszeile ist ein Raster, kein Flex -- ein border-box-Kind schrumpft nicht unter seine Polsterung.");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: `garetienDetailMarkup` und die `.gi-seg`-Regeln bauen**

Reihenfolge im Kasten, aus dem Mockup: Kopf (Name · „Fluss → Flussweg") · Meta-Zeile (Wiki-Link ·
LOD · Ebene · `extra`) · der Knopf „✦ Auf der Karte zeigen — Ansicht folgt" (Aufgabe 14) ·
`.gi-sec` „Was bei uns an derselben Stelle liegt" mit den `.gi-seg` · bei mehreren Flüssen der
`.gi-bomb`-Kasten · `.gi-sec` „Der Grund" · `.gi-sec` „Die Quelle, die mitreist".

⚠️ Der Name bricht mit `hyphens: auto` + `overflow-wrap: break-word` (Designsprache: lange
deutsche Komposita brechen an der Silbe, nicht mitten im Wort).
⚠️ **`.gi-seg__id` steht in der zweiten Rasterzeile** (`grid-column: 2 / span 2`) — Kartentitel
und Abschnittslisten werden lang, und `.avm-row__name` ellipsiert; hier gibt es keine Ellipse,
sondern eine zweite Zeile.

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 5: Im Browser abnehmen** — eine Zeile anklicken, durch die Einzelansicht rollen,
  ein Objekt mit **13** Abschnitten öffnen (Der Große Fluss) und sehen, dass nichts springt.
  Hell und dunkel. 🔧 Was ein Emulator nicht beantwortet, wird als offene Frage gemeldet.
- [ ] **Schritt 6: Commit, einzeln pushen, Blick abwarten**

```bash
git commit -m "garetien(fenster): die Einzelansicht -- was bei uns an derselben Stelle liegt"
```

---

### Aufgabe 14: Die Karte — Glow und „Ansicht folgt"

🔴 **Der Glow hängt am HÄKCHEN, nicht am Knopf — und an mehreren gleichzeitig** (Owner
27.08.2026). Man hakt sich durch die Liste und sieht die Auswahl auf der Karte **wachsen**: „was
habe ich bisher zusammengetragen, und wo liegt es". „Auf der Karte zeigen" bewegt **nur die
Ansicht**.

🔴 **Zwei Mittel, nicht eins** (Mockup §2). Der Schein allein sagt „hervorgehoben"; der Strich
sagt „das ist ihre Fassung, sie steht noch nicht bei uns". Beides ist nötig, weil ihre Linie oft
genau auf unserer liegt — Median **1,24 Meilen** bei 3072 Meilen Kartenbreite. Ein durchgezogener
goldener Strich über einer blauen Linie wäre schlicht ein Ersatz für unsere Linie, und genau das
ist es nicht.
- **ihre** Geometrie: goldgelb **gestrichelt** (`--color-marker-active`, `dashArray`)
- **unsere betroffenen** Abschnitte: ein goldener **Schein** darunter (breite, halbdurchsichtige
  Linie in derselben Farbe)

💣 **Der Schein sitzt NUR unter den Abschnitten, die das Häkchen wirklich ändert.** Bei der Natter
ist das **einer von fünf**. Der ganzen Kette einen Schein zu geben behauptete, alle fünf würden
umbenannt — und das ist genau der Fehler, den die Einzelansicht verhindern soll. Die Quelle
dafür ist `item.abschnitt.public_id` der **angehakten** Items, nie `objekt.abschnitte`.

💣 **`urteil === 'neu'` glüht nicht.** Bei uns liegt dort nichts, also gibt es nichts zu
beleuchten — nur ihre gestrichelte Geometrie (Blutmoor im Mockup).

💣 **GeoJSON ist `[x, y]`, Leaflet `L.CRS.Simple` will `[lat, lng] = [y, x]`.** Die Geometrien in
`after.geometry.coordinates` und `after.abschnitt.geometrie` stehen als `[x, y]` da. Bewusst
tauschen — es ist dieselbe Falle, vor der AGENTS.md §5 warnt, und sie fällt bei einem Objekt nahe
der Diagonale **nicht** auf.

**Dateien:** anlegen `js/review/review-garetien-karte.js` · ändern `index.html` (ein `<script>`),
`js/review/review-garetien-importer.js` · Test `js/review/__tests__/garetien-karte.test.js`

**Schnittstellen (Produziert):**
- `avesmapsGaretienKarteZeigen(objekte)` — die Menge der **angehakten** Objekte, jedes mit seiner
  Geometrie und den public_ids seiner **angehakten** Abschnitte. Idempotent: derselbe Aufruf
  zweimal ergibt dieselben Ebenen.
- `avesmapsGaretienKarteFliegen(objekt)` — nur die Ansicht.
- `avesmapsGaretienKarteAus()` — alles weg (Fenster geschlossen).
- `avesmapsGaretienScheinIds(objekt)` — rein, ohne DOM: die public_ids, die glühen dürfen.

- [ ] **Schritt 1: Den fallenden Test schreiben**

```js
// 💣 Der Schein liegt NUR unter den Abschnitten, die das Haekchen wirklich aendert.
// Ihre Natter trifft fuenf; geaendert wird einer.
const natter = {
	urteil: "ergaenzung",
	abschnitte: [
		{ public_id: "w-4471", geometrie: [[1, 1], [2, 2]] },
		{ public_id: "w-5008", geometrie: [[3, 3], [4, 4]] },
		{ public_id: "w-6120", geometrie: [[5, 5], [6, 6]] },
	],
	items: [
		{ id: 12, selected: true,  abschnitt: { public_id: "w-6120" } },
		{ id: 11, selected: false, abschnitt: { public_id: "w-4471" } },
	],
};
assert.deepStrictEqual(avesmapsGaretienScheinIds(natter), ["w-6120"],
	"Der Schein gehoert NUR den Abschnitten, die das Haekchen aendert. Der ganzen Kette einen zu "
	+ "geben behauptet, alle fuenf wuerden umbenannt.");

// 💣 `neu` glueht nicht -- bei uns liegt dort nichts.
assert.deepStrictEqual(
	avesmapsGaretienScheinIds({ urteil: "neu", abschnitte: [], items: [{ id: 1, selected: true }] }),
	[], "ein neues Objekt hat nichts zu beleuchten");

// 💣 GeoJSON [x,y] -> Leaflet [lat,lng] = [y,x]. Faellt bei einem Objekt nahe der Diagonale NICHT auf.
assert.deepStrictEqual(avesmapsGaretienNachLeaflet([[10, 20], [30, 40]]), [[20, 10], [40, 30]],
	"x und y muessen getauscht werden -- L.CRS.Simple liest [lat, lng].");

// Der Glow haengt am HAEKCHEN und an MEHREREN zugleich (Owner 27.08.2026).
const karte = gefaelschteKarte();
avesmapsGaretienKarteZeigen([natter, blutmoor, alke], karte);
assert.strictEqual(karte.ebenen().length, 3 + 1,
	"drei gestrichelte Geometrien plus EIN Schein -- nur das Blutmoor ist `neu`");

// Haekchen weg -> erlischt SOFORT, und nichts bleibt liegen.
avesmapsGaretienKarteZeigen([], karte);
assert.strictEqual(karte.ebenen().length, 0, "das Erloeschen laesst Leichen zurueck");

// Zweimal derselbe Aufruf ergibt dieselben Ebenen -- sonst stapelt jedes Neuzeichnen der Liste.
avesmapsGaretienKarteZeigen([natter], karte);
const einmal = karte.ebenen().length;
avesmapsGaretienKarteZeigen([natter], karte);
assert.strictEqual(karte.ebenen().length, einmal, "ein zweiter Aufruf stapelt Ebenen");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Bauen**

```js
/*
 * Der goldgelbe Schein des Garetien Importers.
 *
 * 🔴 VERSCHWINDET BEIM ABBAU (Auftrag §5.5) -- eigene Datei, ein <script> in index.html.
 * 🔴 Er rechnet NICHTS: die Geometrien kommen fertig in unseren Karteneinheiten aus after_json.
 */
"use strict";

// Eine eigene Pane, ueber den Wegen (400) und unter den Beschriftungen (475): der Vorschlag muss
// ueber unserer Linie liegen, damit man ihn sieht -- und unter den Ortsnamen, damit er die Karte
// nicht unlesbar macht.
// 💣 `map.getPane` LEGT NICHTS AN, es liefert `undefined` fuer eine Pane, die es nicht gibt, und
// das folgende `.style` wirft. Deshalb erst createPane, dann getPane -- nie umgekehrt.
var AVESMAPS_GARETIEN_PANE = "garetienImportPane";
var AVESMAPS_GARETIEN_PANE_Z = 460;
```

- `avesmapsGaretienNachLeaflet(punkte)` — der Tausch, **eine** Stelle.
- `avesmapsGaretienScheinIds(objekt)` — rein: bei `urteil === 'neu'` leer, sonst die
  `abschnitt.public_id` der Items mit `selected === true`, entdoppelt.
- `avesmapsGaretienKarteZeigen(objekte, karte)` — **erst alles abräumen, dann neu zeichnen**.
  💣 Kein Zustand daneben, der auseinanderlaufen kann: die Ebenengruppe **ist** der Zustand.
- `avesmapsGaretienKarteFliegen(objekt, karte)` — `karte.flyToBounds(L.latLngBounds(punkte), {padding:[40,40]})`.
  🪤 **Messfalle im Browser-Pane:** jeder Leaflet-**Flug** wirft dort NaN — das ist ein Artefakt
  der Pane, kein Fehler im Code. Die Kontrollprobe ist `fitBounds` an derselben Stelle; im echten
  Browser fliegt es.

Verdrahtung im Fenster: nach **jedem** Häkchen-Wechsel und nach jedem Neuzeichnen der Liste
`avesmapsGaretienKarteZeigen(angehakteObjekte)`; beim Schließen `…KarteAus()`.
💣 Auch beim Schließen — sonst bleibt der Schein auf der Karte liegen, und der Besucher sieht
goldene Striche ohne Erklärung.

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 5: Im Browser abnehmen — der ABLAUF**

Drei Objekte nacheinander anhaken und sehen, wie die Auswahl **wächst** · eins wieder abhaken und
sehen, dass es **sofort** erlischt · „Auf der Karte zeigen" drücken und sehen, dass die Ansicht
folgt und der Glow sich **nicht** ändert · das Fenster schließen und sehen, dass **nichts**
liegenbleibt · hell und dunkel. 🔧 Die Deckkraft des Scheins über einer blauen Flusslinie ist die
eine Zahl, die nur das Auge beantwortet — dem Owner ausdrücklich zeigen.

- [ ] **Schritt 6: Commit, einzeln pushen, Blick abwarten**

```bash
git commit -m "garetien(karte): das Haekchen laesst den Vorschlag leuchten, mehrere zugleich"
```

---

## Schritt 5 des Owners — die Handlungen und die Übernahme (Aufgaben 15–16)

---

### Aufgabe 15: Die vier Handlungen

🔴 **„Neu einfügen" erscheint NUR, wo bei uns nichts liegt. Das URTEIL entscheidet, nicht die
Nachbarschaft.** Der Zufluss liegt auf seinem Hauptfluss und ist trotzdem `new` — **34 der 37**
Widersprüche sind genau das. Wer nach „liegt was in der Nähe" fragt, bietet dort „Ersetzen" an,
und ein pauschales Ersetzen ersetzte die Natter durch ihren Seitenarm: mit gültiger id, ohne
Fehlermeldung.

| Urteil | Handlungen | Warum |
|---|---|---|
| `neu` | **Neu einfügen** · Ablehnen | Es liegt nichts da. |
| `zweifel` (Zufluss) | **Neu einfügen** · Ablehnen | Der Nachbar ist der Hauptfluss, ihr Objekt der Seitenarm. Ein neues Objekt, kein Ersatz. |
| `ergaenzung` | **Namen ersetzen (n)** · Nur Quelle + Artikel (n) · Geometrie ersetzen … · Ablehnen | Wir haben es, sie wissen mehr. |
| `widerspruch` | **Geometrie ersetzen …** · Namen ersetzen (n) · Ablehnen | Ihr Artikel trifft, ihre Geometrie nicht. Die Geometriefrage steht vorn. |
| `deckt_sich` · `uebersprungen` | nur **Ablehnen** | Es gibt nichts zu tun; die Zeile steht nur da, damit die Zahl nachprüfbar bleibt. |

⭐ **„Nur Quelle + Artikel" ist kein vierter Knopf zu viel.** Es ist dieselbe Handlung wie „Namen
ersetzen", nur mit abgewählter Namensspalte — und es hakt die `ergaenzung`-Items an, während
„Namen ersetzen" die `umbenennung`-Items anhakt. Sichtbar zu machen, dass man den Gewinn
(Wiki-Artikel, Quelle, Namensnennung) **auch ohne** das Umbenennen haben kann, ist genau der
Punkt, an dem dieser vierte Ausgang steht. Ein Knopf, den man in 25 von 289 Fällen braucht, ist
billiger als eine Regel, die niemand findet.

🔴 **Die Hauptaktion ist gefüllt, alles andere weich/outline** (Designsprache). Im Fenster ist die
EINE gefüllte Handlung „Angehakte übernehmen" im Fuß; die Knöpfe der Einzelansicht sind weich —
eine Zeilenhandlung ist nie die Haupthandlung der Seite. „Ablehnen" trägt `--color-danger` als
**Schrift**, nicht als Füllung.

🔴 **Die Handlungsleiste ist ANGEHEFTET, nicht im Fluss.** Die Entscheidung darf nie hinter einer
Bildlaufleiste liegen — bei 13 Abschnitten wäre sie es.

**Dateien:** ändern `js/review/review-garetien-importer.js`, `css/components/garetien-importer.css` ·
Test `js/review/__tests__/garetien-handlungen.test.js`

- [ ] **Schritt 1: Den fallenden Test schreiben** — die Tabelle oben, Zeile für Zeile:

```js
// 💣 Das URTEIL entscheidet, nicht die Nachbarschaft. Der Zufluss liegt auf seinem Hauptfluss
// und bekommt trotzdem „Neu einfuegen" -- 34 der 37 Widersprueche sind genau dieser Fall.
const zufluss = { urteil: "zweifel", abschnitte: [{ public_id: "w-1", name: "Natter" }],
	items: [{ id: 1, anlass: "zufluss", change_type: "new", selected: false }] };
const knoepfe = garetienHandlungen(zufluss).map((k) => k.name);
assert.ok(knoepfe.includes("neu"), "ein Zufluss ist ein NEUES Objekt");
assert.ok(!knoepfe.includes("name"), "ein Zufluss ersetzt nichts -- unser Nachbar ist der Hauptfluss");
assert.ok(!knoepfe.includes("geometrie"),
	"💣 Ein pauschales Ersetzen ersetzte hier die Natter durch ihren Seitenarm -- gueltige id, "
	+ "keine Fehlermeldung.");

// „Geometrie ersetzen" ist bei mehreren Abschnitten AUSGEGRAUT und sagt warum (Entscheidung A).
const fuenf = { urteil: "ergaenzung",
	abschnitte: [1, 2, 3, 4, 5].map((n) => ({ public_id: "w-" + n, name: "x" })), items: [] };
const geo = garetienHandlungen(fuenf).find((k) => k.name === "geometrie");
assert.ok(geo && geo.disabled === true, "bei fuenf Abschnitten hat „ersetze die Geometrie" kein Ziel");
assert.ok(/5 Abschnitte/.test(geo.grund), "ein ausgegrauter Knopf muss sagen, warum");

// „deckt sich" kann nur abgelehnt werden -- die Zeile steht da, damit die Zahl nachpruefbar bleibt.
assert.deepStrictEqual(garetienHandlungen({ urteil: "deckt_sich", abschnitte: [], items: [] })
	.map((k) => k.name), ["ablehnen"]);

// 🔴 EINE Tuer. Jeder Knopf geht durch sync-plan.php -- nirgends sonst wird geschrieben.
const quelle = fs.readFileSync("js/review/review-garetien-importer.js", "utf8");
const schreibend = quelle.match(/fetch\(\s*["'][^"']*\.php/g) || [];
schreibend.forEach((treffer) => {
	assert.ok(/sync-plan\.php|garetien-import\.php/.test(treffer),
		`Ein zweiter Schreibweg: ${treffer}. Geschrieben wird NUR ueber sync-plan.php mit kind:'garetien'.`);
});
assert.ok(!/garetien-import\.php[\s\S]{0,400}action["']?\s*:\s*["']apply/.test(quelle),
	"Der Import-Endpunkt hat bewusst kein apply -- und bekommt hier auch keins.");

// Eine Ablehnung ist umkehrbar: „Wieder vorschlagen" steht schon im Blatt (data-undecline).
assert.ok(quelle.includes("undecline"), "eine Ablehnung ohne Rueckweg ist ein schwarzes Loch");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Bauen** — `garetienHandlungen(objekt)` ist **rein** und liefert die Liste der
  Knöpfe; das Verdrahten schickt `{action:'select', kind:'garetien', run_id, ids:[…], selected}`.
  „Geometrie ersetzen …" fragt vorher per `window.confirm` und nennt die Folge beim Namen.
  „Ablehnen" schickt `decline` über dieselbe Tür; der Reiter „Abgelehnt" liest sie zurück.
  💣 Nach jedem `select` wird die Liste **neu geholt** (`action:'liste'`) statt im Browser
  nachgerechnet — der Server ist die Wahrheit über `selected`, und zwei Buchhaltungen laufen
  beim ersten Abbruch auseinander.
- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 5: Im Browser abnehmen — die echten Handgriffe, gegen die echte Datenbank**

🔧 **Auftrag §8.6: der Ablauf mit angemeldeter Sitzung ist NIE gelaufen.** Kein Handgriff dieses
Imports hat je gegen die echte Datenbank gearbeitet. Das erste, was hier getan wird, ist deshalb
nicht „289 Objekte durchgehen", sondern **ein** Objekt: anhaken · Glow sehen · Häkchen weg ·
erlöschen sehen · ablehnen · im Reiter „Abgelehnt" wiederfinden · „Wieder vorschlagen" · zurück.

- [ ] **Schritt 6: Commit, einzeln pushen, Blick abwarten**

```bash
git commit -m "garetien(fenster): die vier Handlungen -- vormerken, nie schreiben"
```

---

### Aufgabe 16: „Angehakte übernehmen" durch das vorhandene Blatt

🔴 **Die Übernahme IST `js/review/sync-plan-sheet.js`** — unverändert. Zweite Bestätigung,
Häppchen zu 40, Protokoll, Fortschritt hängen dort. **Läuft beliebig oft**: man kann nach zehn
Objekten übernehmen, das Ergebnis auf der echten Karte hinter dem Fenster ansehen und
weitermachen (Mockup §8, Owner-Entscheid „Probelauf").

**Dateien:** ändern `js/review/review-garetien-importer.js` · Test
`js/review/__tests__/garetien-uebernahme-blatt.test.js`

**Entscheidung B, gebaut:** das Blatt zeigt **nur das Angehakte**. Ohne Serveränderung und ohne
eine Zeile im Blatt — `openSyncPlanSheet` nimmt einen eigenen `post` entgegen
(`syncPlanResolvePost` ist genau diese Naht, „die eine Stelle, an der eine zweite Zeilenquelle
andockt").

```js
/**
 * Der Sender fuer das Uebernahme-Blatt.
 *
 * ⭐ Das Blatt bleibt UNVERAENDERT -- `openSyncPlanSheet` sieht genau dafuer einen eigenen `post`
 * vor. Hier wird nur die Antwort auf `get` beschnitten: das Fenster hat 259 Objekte
 * durchgearbeitet und 14 angehakt; ein Blatt mit 259 Zeilen waere die Umkehrung des Auftrags
 * („objekt fuer objekt entscheiden").
 *
 * 🔴 `apply`, `select` und `undecline` gehen UNVERAENDERT durch. Beschnitten wird ausschliesslich
 * die ANZEIGE -- was uebernommen wird, entscheidet weiterhin `selected` in der Datenbank.
 *
 * 💣 `counts` und `truncated` werden MITGEZOGEN. Liesse man die Serverzahlen stehen, meldete das
 * Blatt „und 245 weitere (sie sind mit ihrem Haekchen gespeichert und werden mit uebernommen)" --
 * fuer 245 Zeilen, die gerade NICHT angehakt sind. Eine Falschaussage ueber eine Uebernahme.
 */
function garetienBlattSender(body) {
	return avesmapsGaretienRufe("/api/edit/wiki/sync-plan.php", body).then(function (antwort) {
		if (body.action !== "get" || !antwort || !antwort.items) {
			return antwort;
		}
		var counts = { new: 0, changed: 0, deleted: 0, total: 0 };
		var truncated = {};
		Object.keys(antwort.items).forEach(function (art) {
			var gehakt = antwort.items[art].filter(function (zeile) { return zeile.selected === true; });
			antwort.items[art] = gehakt;
			counts[art] = gehakt.length;
			counts.total += gehakt.length;
			// ⚠️ Was der Server bei 200 abgeschnitten hat, KANN angehakt sein. Die Zahl kommt aus
			// der Arbeitsliste, die ungedeckelt liest -- nicht aus einer Schaetzung.
			truncated[art] = Math.max(0, avesmapsGaretienAngehakt(art) - gehakt.length);
		});
		antwort.run.counts = counts;
		antwort.truncated = truncated;
		return antwort;
	});
}
```

- [ ] **Schritt 1: Den fallenden Test schreiben**

```js
// Das Blatt zeigt, was angehakt ist -- nicht den ganzen Lauf.
const antwort = await garetienBlattSender({ action: "get", kind: "garetien" });
assert.strictEqual(antwort.items.changed.length, 2, "nur die angehakten Zeilen gehoeren ins Blatt");
assert.strictEqual(antwort.run.counts.total, 3, "die Zahl im Kopf muss die angehakten zaehlen");
assert.strictEqual(antwort.truncated.changed, 0,
	"💣 Stuende hier die Serverzahl, meldete das Blatt „und 245 weitere werden mit uebernommen" "
	+ "fuer Zeilen, die gerade NICHT angehakt sind -- eine Falschaussage ueber eine Uebernahme.");

// `apply` geht UNVERAENDERT durch -- was uebernommen wird, entscheidet `selected` in der Datenbank.
const durch = await garetienBlattSender({ action: "apply", kind: "garetien", run_id: 7 });
assert.strictEqual(durch.beruehrt, undefined, "apply darf nicht angefasst werden");

// 🔴 Das Blatt selbst wurde NICHT veraendert.
const blatt = fs.readFileSync("js/review/sync-plan-sheet.js", "utf8");
assert.ok(!blatt.includes("garetien-import"),
	"Das Blatt darf den Importer nicht kennen -- sonst nimmt der Abbau es mit.");

// Nach der Uebernahme wird die Arbeitsliste neu geholt und der Reiter „Uebernommen" zaehlt mit.
assert.ok(fs.readFileSync("js/review/review-garetien-importer.js", "utf8").includes("onApplied"),
	"ohne onApplied bleibt die Liste nach dem Uebernehmen auf dem alten Stand stehen");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Bauen**

Der Fuß-Knopf `#garetien-apply` trägt die Zahl der Angehakten („Angehakte übernehmen (14)") und
ist bei 0 **deaktiviert**. Er öffnet das Blatt in einem eigenen Mount **über** dem Fenster:

```js
openSyncPlanSheet({
	kind: "garetien",
	mount: document.getElementById("garetien-sheet"),
	post: garetienBlattSender,
	// ⚠️ Nach der Uebernahme MUSS die Arbeitsliste neu geholt werden: die uebernommenen Zeilen
	// tragen jetzt apply_state='done' und gehoeren in den Reiter „Uebernommen". Ohne das steht
	// die Liste auf dem Stand von vorher, und der naechste Klick haekelt etwas an, das schon
	// geschrieben ist.
	onApplied: function () { avesmapsGaretienListeHolen(); },
	onClose: function () { avesmapsGaretienListeHolen(); },
});
```

⚠️ `css/components/sync-plan-sheet.css` ist über `index.html` bereits geladen — kein zweites CSS.
⚠️ Der Mount `#garetien-sheet` liegt **außerhalb** von `.gi-win` (das Fenster hat `overflow:
hidden`, und ein Blatt darin wäre halb abgeschnitten).

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**
- [ ] **Schritt 5: Der Probelauf gegen die echte Datenbank — EIN Objekt**

🔧 Das ist der Moment, an dem dieser Import zum ersten Mal wirklich schreibt.
1. **Ein** Objekt anhaken (ein `neu` ohne Nachbarn — das Blutmoor oder ein namenloser Bach).
2. „Angehakte übernehmen (1)" · das Blatt lesen · bestätigen.
3. Das Fenster wegschieben und das Objekt **auf der Karte** wiederfinden.
4. Seine Infobox öffnen und prüfen, dass die **Quelle** dransteht — mit „Briefspiel (Garetien)",
   der Namensnennung und CC BY-NC-SA 3.0. 💣 Steht sie nicht da, ist der Lizenzweg gebrochen, und
   das ist der einzige Punkt dieses Bauplans, der ein **rechtliches** Problem wäre.
5. Erst danach ein `ergaenzung`-Objekt, und danach prüfen, dass die Verkehrsmittel und
   Saisonfenster des Flusswegs **noch da sind** (die 💣 aus Aufgabe 4).

- [ ] **Schritt 6: Commit, einzeln pushen, Blick abwarten**

```bash
git commit -m "garetien(fenster): Angehakte uebernehmen -- durch das vorhandene Blatt"
```

---

## Selbstprüfung

**Abdeckung des Auftrags:**

| Auftrag | Aufgabe |
|---|---|
| §5.1 Knopf unter „Dump holen" (Owner: nur Admins) | 10 |
| §5.2 Liste, sechs Filter, Bilanzzeile, keine 200er-Deckelung | 8, 11, 12 |
| §5.3 Einzelansicht: Karte, unser Bestand, Abschnitte mit Häkchen, ihre Angaben | 13, 14 |
| §5.4 Keine zweite Tür, keine zweite Vorschau, keine zweite Zeile, keine zweite Rechnung | 9, 11, 15, 16 |
| §5.5 Abbaubarkeit, Wächter-Test, Lizenz bleibt draußen | 7, 10, 16 |
| §4 Der vierte Ausgang | 3, 4 |
| §4.1 Abschnitte: welche, wie heißen sie, welche namenlos | 1, 2, 13 |
| §8.1 vierter Ausgang · §8.2 Positionsriegel · §8.7 Abschnittsliste · §8.8 Urteilsspalte | 3, 5, 1, 6 |
| §8.3 Die 32 Zweifelsfälle beurteilbar machen | 13 |
| §8.6 Ablauf mit angemeldeter Sitzung | 15, 16 |
| Mockup §10 Nr. 1–5 (die fünf Serverteile) | 1, 3, 2, 5, 6 |

**Was der Plan bewusst NICHT tut:**

- **Keine Stufe 2–5.** Wege, Wälder, Berge, Ortschaften und Territorien erben dieses Fenster
  unverändert — sie brauchen nur ihre Zeilen in `AVESMAPS_GARETIEN_TYP_MAP`.
- **Keine Routing-Anbindung.** Kein einziger der 129 neuen Flüsse schließt ans Wegenetz an — null
  von 129, Median 0,663 Karteneinheiten daneben. Gemessen und berichtet, nicht gebaut.
- **Kein Sammelknopf „alle übernehmen".** Das Blatt hat ihn je Gruppe und behält ihn dort; im
  Fenster wäre er die Umkehrung des Auftrags.
- **Keine Sortierung.** Die Reihenfolge ist die der Quelle — der Faden, an dem man sich durch die
  Liste hangelt.
- **Kein „Garetien"-Filter in einer Nutzoberfläche.** Der hätte den Importer überlebt und ihn
  damit festgenagelt.
- **Kein Löschweg.** Auch nicht „nur fürs Aufräumen".
- **`lore.css` wird nicht umgestellt.** Der Vorkommen-Dialog führt mit `.lore-ribbon`/`.lore-btn2`
  eine eigene Fassung des Menübands; sie ist Altbestand, Aufgabe 9 vergrößert sie nicht und
  räumt sie nicht auf. 🔧 Ein Kandidat für später, kein Teil dieses Auftrags.
- **Die zweite `.type-filter`-Fassung** (`review-panel.css` neben `editor-page.css`) bleibt
  stehen — dieselbe Begründung.

**Offene Punkte, die gemeldet und nicht geraten werden:**

- 🔧 Die drei Entscheidungen A/B/C oben.
- 🔧 Die Aufteilung 25 Ergänzung / 24 deckt sich steht erst fest, wenn der vierte Ausgang
  gerechnet hat. Beide Zahlen zusammen bleiben 49.
- 🔧 Die Zahl 360 (Aufgabe 5) ist erst nach dem nächsten `fetch`-Lauf gegenprüfbar.
- 🔧 Die Deckkraft des Scheins über einer blauen Flusslinie beantwortet nur das Auge.
- 🔧 Ob `avesmapsUpdatePathFeatureDetails` live wirklich alle Felder unangetastet lässt, ist per
  SQLite-Test belegt und muss in Aufgabe 16 Schritt 5 an einem echten Flussweg nachgesehen
  werden. 💣 Ein SQLite-Test kann eine MySQL-Regression erzwingen (AGENTS.md §9) — die
  Produktionsform wird **nicht** verbogen, damit ein Test läuft.
