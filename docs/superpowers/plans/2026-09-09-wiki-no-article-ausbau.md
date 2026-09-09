# `properties.wiki_no_article` global ausbauen — Bauplan

> **Für agentische Arbeiter:** Dieser Plan wird Schritt für Schritt abgearbeitet.
> Jeder der vier Schritte geht EINZELN live (AGENTS.md §9) und ist für sich konsistent.

**Ziel:** Der Merker `properties.wiki_no_article` verschwindet aus Avesmaps — Häkchen, Feld, alle
Leser und Schreiber, plus die Bestandsdaten. Wer sich früher des Merkers bediente, fragt künftig
die **Wiki-Zuweisung** ab (das Nest `wiki_settlement` / `wiki_path` / `wiki_region` /
`wiki_powerline`, Feld `wiki_key` bzw. `wiki_url`) — **nie** `properties.wiki_url`.

**Warum es ihn gab (damit ihn niemand wieder einführt):** Er war der Notausgang gegen das
Namensraten der Kartennutzlast (Discord #38). Bis zum 08.09.2026 füllte
`avesmapsEnrichMapFeatureWikiUrl` die Adresse aus dem NAMEN des Objekts; eine gelöste Zuweisung kam
beim nächsten Lesen zurück, also brauchte es eine zweite, negative Aussage. Commit `420f12cfc` hat
das Raten zurückgebaut — „Trennen" hält seither von allein. Der Merker hat keinen Gegenstand mehr.

**Owner-Entscheid:** 09.09.2026, nach Durchsicht aller 10 Träger.

**Preis, vom Owner gesehen und akzeptiert:** Die Unterscheidung „nachgesehen, es gibt nichts" gegen
„hat noch niemand angesehen" fällt. Die 10 waren vom Prüfhaken schon markiert, nur ruhiger;
vollständig ausgenommen waren sie nur in der Konfliktliste. Das ist gewollt — nicht „reparieren".

---

## Global Constraints

- **Geteilter Checkout.** Nur eigene Pfade stagen, nie `git add -A`. `git add` und `git commit` in
  EINEM Zug — eine Prüfung dazwischen hat schon einen fremden Commit-Betreff gekostet.
- **Push über den Wegwerf-Worktree**, nie Rebase im Hauptbaum (AGENTS.md §9).
- **Vor jedem Push das GANZE Testfeld**, nach dem Muster des Deploy-Workflows, parallel, und die
  Dateizahl gegenzählen (`… -print0 | tr -dc '\0' | wc -c`). Ein viel zu kleiner Zähler ist der
  einzige Unterschied zwischen einem blinden und einem grünen Lauf.
  Vorbestehend rot ist genau einer: `tools/linkcheck/link-url-test.php` (echter DNS-Abruf).
- **Vor dem Push `gh run list --limit 3`** — ein `pending` Lauf wird vom nächsten Push abgebrochen,
  und seine Dateien lädt dann nie jemand hoch.
- **Nichts geht live, ohne dass der Owner Diff und Messung gesehen hat.**
- **Regex-Massenersetzungen:** Skript per Write in den Scratchpad, nie `php -r` aus der Shell; bei
  0 Ersetzungen gar nicht erst speichern. `preg_replace` gibt bei einem Kompilierfehler `null`
  zurück — zurückgeschrieben leert das die Datei (so am 08.09.2026 `repair.php` zerstört).
- **Wenn ein Schritt nicht in einem Zug fertig wird: zurücknehmen und den Plan hinterlassen.**
  Ein halbfertiger Umbau macht das Deploy-Tor für fremde Sitzungen rot.
- **Agenten dürfen nicht:** `git checkout/stash/restore/reset`, committen, pushen, schwere
  Live-Endpunkte in Schleife.

---

## Bestandsaufnahme (gemessen 09.09.2026)

Die Zahlen der Aufgabenstellung waren teils zu klein. Unabhängig nachgezählt.

⭐ **Über zwei Messwege bestätigt:** `rg -l --hidden -g '!.git'` und `git grep -l` geben für
`wiki_no_article` beide **67 Dateien**. Ein voller `grep -r` findet 703 — die Differenz liegt
vollständig in `.claude/worktrees/` (631) und `.superpowers/` (4), beides in `.gitignore` und
**null davon von git verfolgt**. Wer das Inventar nachzählt, nimmt `git grep`, nicht `grep -r`:
sonst sind fünf Sechstel der Treffer Wegwerf-Kopien.

| Behauptung der Aufgabe | gemessen |
|---|---|
| ~47 Nicht-Test-Dateien, ~20 Tests | **60 Codedateien / 39 Tests / 14 Doku** — mit dem vollständigen Mustersatz (`no_article` ohne Präfix, `no-wiki-checked`, die Beschriftungen) |
| 23 Codestellen in `features.php` | **50 Codezeilen** + 14 Kommentarzeilen, verteilt auf 13 Funktionsblöcke |
| Häkchen an ZWEI Oberflächen | ✅ stimmt: `wiki-assign-registry.js:218` (Ort), `:364` (Landschaftslabel); die anderen sechs stehen dort ausdrücklich auf `false` |
| DREI bedeutungsgebende Leser | unvollständig — **mindestens vier weitere** |
| ZWEI Leser gegenstandslos | **beide Hälften falsch** (siehe unten) |
| acht Datenwege `wiki-assign-*.js` | **sechs** — `wiki-assign-diff.js` trägt null, die Kraftlinie liegt inline im HTML, das Landschaftslabel hat keine eigene Datei |
| Schreiber in 6 PHP-Dateien | **mindestens drei fehlen** |

### Die Leser, vollständig — und ob die Prüfung wirklich kollabiert

Die Annahme „in den meisten Fällen kollabiert die Prüfung, weil ‚hat eine Zuweisung?' eine Zeile
darüber schon gefragt wird" hält **an keiner der drei genannten Stellen** ganz.

| Datei:Zeile | Rolle | Kollabiert? |
|---|---|---|
| `js/map-features/wiki-zuweisung.js:71/112/127` | dritter Zustand `GEPRUEFT` | **teilweise.** Die Zuweisung steht wirklich eine Zeile darüber — aber `avesmapsWikiZuweisungMarkiert:150` gibt für `OFFEN` **und** `GEPRUEFT` `true` zurück. Es kollabiert die FARBE, nicht die Sichtbarkeit: die 6 „geprüften" Orte gehen von blass auf voll rot, sie verschwinden nicht. |
| `api/_internal/conflicts/rules.php:106` + `:640` | Ausnahme von „Kein Wiki-Schlüssel" | **nein.** `:640` wird nur erreicht, wenn `:631` schon festgestellt hat, dass es keine Adresse gibt. Genau dort trennt der Merker „nie nachgesehen" von „nachgesehen, gibt es nicht". Fällt er, kommen die 10 zurück auf die Beobachtungsliste — **vom Owner gesehen und gewollt.** |
| `api/_internal/app/feature-sources.php:3109` | Riegel 1 der Segment-Erbschaft | **nein — aber heute wirkungslos.** Riegel 3 (`:3104`) subsumiert ihn nicht: ein Träger hat per Widerspruchsriegel keine Adresse, steht also nie in `$namespaces`. Die Erbschaft gilt jedoch `path`-only, und **keiner der 10 Träger ist ein Weg** (6 Orte, 5 Kraftliniensegmente). Betrifft **0 Objekte**. |
| `api/_internal/wiki/locations.php:1026` | „Widerspruch ist eine Änderung" | **ja, ersatzlos** — der Widerspruch kann ohne Merker nicht mehr entstehen. |
| `api/_internal/wiki/powerlines.php:197/210/282` | `clear_no_article` | **ja, ersatzlos** — samt der Meldung `no_article_reopened`, die bis `api/edit/wiki/dump.php:800` und `js/review/review-wiki-sync.js:2098` reist. |
| `api/app/map-features.php:1368` | Riegel im Anreicherer | 🔴 **Die Aufgabe nennt ihn „gegenstandslos". Der Kommentar direkt darüber sagt wörtlich das Gegenteil:** „⚠️ Punkt 2 wehrt seit diesem Umbau nichts mehr ab und bleibt trotzdem stehen: der Merker ist eine Aussage, kein Notbehelf, **er wird anderswo gelesen** … Wer ihn hier streicht, streicht keine tote Zeile." Seine Begründung ist die Existenz der anderen Leser — sie entfällt erst, wenn die weg sind. **Er fällt deshalb ZULETZT (Schritt 3), nicht zuerst.** |
| `avesmapsAssertWikiClaimNotContradictory` | Widerspruchsriegel beim SCHREIBEN | Steht in **`api/_internal/map/wiki-claim.php:23`**, nicht in `features.php` (die ruft nur: `:1486`, `:1968`, `:2769`, `:3562`; dazu `ecosystem.php:2246`). Er hat mit dem Rateweg nichts zu tun, sondern verbietet den Zustand „Adresse UND Merker". Die ganze Datei wird tot. |

### Was die Aufgabenstellung nicht nennt

- **`api/_internal/map/wiki-claim.php`** — eine eigene geteilte Datei, wird komplett tot.
- **`avesmapsAssertPowerlineWikiClaimNotContradictory`** (`features.php:1967`) — ein ZWEITER Assert
  neben dem geteilten, nur für Kraftlinien.
- **`js/ui/wiki-massenzuweisung.js:103/121/127`** — die Rückfrage der Massenzuweisung nennt den
  Merker im Text und rechnet `no_article_flag` in „unberührt" ein.
- **`api/_internal/audit-detail.php:48`** — `'wiki_no_article' => 'Wiki-Merker'`.
- **`js/map-features/__tests__/wiki-zuweisung-verdrahtung.test.js:114/118`** — nagelt Token und
  Klasse fest, trägt aber **kein einziges Merker-Wort** und taucht in keiner Merker-Suche auf.
  (Genau die Falle: ein Suchmuster, das eine Schreibweise voraussetzt, findet die andere nie.)
- **CSS des dritten Zustands:** `css/components/editor-page.css:799`,
  `css/components/region-sync.css:249`, `css/features/review-panel.css:857`.
- **`repair.php:37`** (die Konstante) und **`:486`** (ein zweites `unset`).

### 💣 Der Merker steckt in ARCHIVEN — die werden NICHT angefasst

Am Dump vom 08.09.2026 je Tabelle gezählt:

| Tabelle | Vorkommen | Behandlung |
|---|---|---|
| `map_features` | **11** (10 nach der Korrektur von Altenau am 09.09.) | **wird bereinigt** (Schritt 4) |
| `wiki_sync_cases` (`details_json`) | 18 | **Archiv — unberührt** |
| `map_feature_legacy_properties` | 6 | **Archiv — unberührt** (Migrations-Backup, kein Code liest sie) |
| `map_audit_log` | 3 | **Archiv — unberührt** |

Hausregel, in diesem Projekt zweimal bezahlt (AGENTS.md §10, Sprungpunkt-Eintrag §11):
*ein Protokoll ist ein Archiv, sonst wäre es keins.* Ein „gründliches" Aufräumen, das die
Schnappschüsse mitnimmt, fälscht den Verlauf. **Deshalb bleibt auch `audit-detail.php:48` stehen** —
er übersetzt die historischen Zeilen, die weiterhin `wiki_no_article` nennen.

### Die 11 Träger, mit Zuweisung nachgemessen

| id | Art | Name | Zuweisung? |
|---|---|---|---|
| 7081 | location/gebaeude | Turm Erlenbruch (Finsterkamm) | keine |
| 7356 | powerline | Hursachquelle | keine |
| 7933 | location/dorf | Ochsenweide (am Bodrin) | keine |
| 9714 | location/dorf | Auengrund (Mauterndorf) | keine |
| 9792 | location/dorf | Altenau | **NEST `wiki_settlement`** — genau der Widerspruch, am 09.09. korrigiert |
| 11305–11308 | powerline ×4 | Drachenblick | keine |
| 18508 | location/dorf | Efferding | keine |
| 18773 | location/dorf | Einhornen | keine |

**Keiner der verbleibenden 10 hat eine Zuweisung** — die Aufgabe stimmt hier. Kein Träger ist ein
`path`; die Weg-Erbschaft in `feature-sources.php` ist damit heute gegenstandslos.

⚠️ Der Dump ist vom 08.09.; **vor Schritt 4 wird gegen die LIVE-Datenbank gemessen**, nicht gegen
den Dump.

---

## 🔧 DU: drei Entscheidungen vor dem ersten Commit

1. **`citymap.no_article` — mit ausbauen oder stehen lassen?**
   Das ist eine **eigene Datenbankspalte** (`api/_internal/app/citymaps.php:420/421`, Inline-DDL,
   **nicht in `sql/`**), kein `properties.wiki_no_article`. Gelesen von
   `citymap-article-assign.php:209/253` (`skipped['no_article_flag']`, `AND no_article = 0`) und
   `citymaps.php:1295/1348/1365`.
   **Vorschlag: OUT.** Andere Ablage, andere Objektart, eigener Schreibweg — und der Auftrag nennt
   `properties.wiki_no_article`. Soll sie auch fallen, ist das ein eigener Umbau mit Spaltenlöschung.
2. **`html/editor-handbuch.html` (7 Stellen: `:533`, `:711`, `:1290`, `:1296`, `:1297`, `:1486`,
   `:1498`).** AGENTS.md §9 sagt: **nicht im Vorbeigehen editieren** — das Handbuch gehört der
   nächtlichen Routine `avesmaps-handbuch-pflege`.
   **Vorschlag: nicht anfassen**, stattdessen in jedem Commit-Betreff die editor-sichtbare Wirkung
   benennen, damit die Routine sie findet.
3. **Historische Audit-Zeilen `action = 'conflict_no_article'`** bleiben in `map_audit_log` stehen.
   **Vorschlag: `audit-detail.php:48` behalten**, sonst zeigt der Änderungsverlauf für alte Zeilen
   einen rohen Feldnamen.

---

## Schritt 1 — Leser, beide Häkchen, das Verb (EIN Commit)

**Warum zusammen:** Ein Knopf, der ein Feld schreibt, das niemand mehr liest, ist eine Falle.
Fällt der letzte bedeutungsgebende Leser, muss das Verb im selben Commit fallen.

**Dateien**
- `js/map-features/wiki-zuweisung.js` — `AVESMAPS_WIKI_ZUWEISUNG_GEPRUEFT` fällt; Ort, Weg und
  Beschriftung kollabieren auf genau die Form, die `avesmapsWikiZuweisungFlaeche` schon hat;
  `avesmapsWikiZuweisungMarkiert` wird `zustand === OFFEN`. Der Kopfkommentar verliert die
  Zustandstafel und bekommt die Begründung, **warum es den Merker gab** — damit ihn niemand
  wieder einführt.
- `js/map-features/map-features-wiki-zuweisung-check.js` — `MARKE_GEPRUEFT` fällt.
- `css/base/tokens.css:338`, `css/features/location-popups-markers.css:966/969` — der Token
  `--color-check-no-wiki-checked` und die Klasse `--no-wiki-checked` fallen.
  ⚠️ **`--color-check-no-wiki` (ohne `-checked`) BLEIBT** — den trägt der Prüfhaken generell
  (`location-popups-markers.css:958`, `index.html:3204`).
- `api/_internal/conflicts/rules.php` — `:73` (`@return`-Vertrag), `:106` (`no_article` im
  Zeilenbau), `:640` (die Ausnahme), `:732` (Verbliste), `:751` (Verb-Beschreibung).
- `api/_internal/app/feature-sources.php:3109` — Riegel 1 fällt; der Kommentarblock `:3070` wird
  auf die verbleibenden **zwei** Riegel umgeschrieben. 💣 **Keine Zahl in den Kommentar schreiben** —
  eine Zahl liest sich wie eine vollständige Liste (die Lehre steht in AGENTS.md an vier Stellen).
- `api/_internal/conflicts/repair.php` — `:37` Konstante, `:227` Parameter, `:327-330`, `:344`
  (Audit-Aktion `conflict_no_article` entfällt für NEUE Zeilen), `:486`, `:760` Doku, `:778`
  Whitelist, `:849` Aufrufstelle.
- `js/review/review-conflicts.js:967/969/1251` — Knopf „Kein Wiki-Eintrag" fällt.
- `js/ui/wiki-assign-registry.js:218` und `:364` — `keinArtikelHaken: true`: **die Zeile fällt
  ganz**, nicht auf `false` setzen (sechs Objektarten führen sie ausdrücklich als `false` — beim
  finalen Ausbau in Schritt 2 fallen die auch).
- `js/ui/wiki-massenzuweisung.js:103/121/127` — Rückfragetext ohne Merker.

**Tests (umschreiben)**
`wiki-zuweisung.test.js`, `wiki-zuweisung-verdrahtung.test.js`, `conflict-rules-test.php`,
`conflict-keeper-test.php`, `conflict-repair-reach-test.php`, `conflict-dublette-verben.test.js`,
`wiki-massenzuweisung.test.js`, `kanon-etikett-test.php` (Fixture `:423`).

**Neu:** `api/_internal/conflicts/__tests__/kein-wiki-eintrag-ist-weg-test.php` — ein
**Rückbau-Wächter**, der beim Namen nennt, dass der Modus `no_wiki` und der Merker nicht
zurückkehren dürfen, und den Owner-Entscheid samt Begründung ausgibt. Vorbild: der Wächter des
Kartenarchiv-Tokens (§11) — ein Kommentar allein hält das nicht auf.

**Messung vor dem Commit**
- Die 6 „geprüften" Orte gehen von blass auf voll rot — **im Browser** gegen die Live-Karte
  gegenprüfen, als Besucher UND im Editor.
- `wiki.missing_key` wächst um die 10 Träger — am Bestand nachrechnen, nicht schätzen.
- 💣 **Kein `PAYLOAD_VERSION`-Bump:** dieser Schritt fasst `api/app/map-features.php` nicht an.

**Schritte**
- [x] 1.1 Tests zuerst umschreiben, laufen lassen → müssen ROT werden (Beleg, dass sie greifen).
- [x] 1.2 Leser und Verb entfernen; jede Kommentar-Begründung nachziehen, keine toten Verweise.
- [x] 1.3 Rückbau-Wächter schreiben, Mutationsprobe an ihm fahren.
- [x] 1.4 GANZES Testfeld parallel, beide Workflow-Muster, Dateizahl gegenzählen.
- [x] 1.5 Agent: Diff gegnerisch widerlegen.
- [x] 1.6 `usability-konsistenz` + `usability-design`.
- [ ] 1.7 Owner sieht Diff und Messung → `git add` + `git commit` in EINEM Zug, Push über Worktree.

### Was die drei Prüfagenten gefunden haben (und wie es behoben ist)

| Befund | Behoben durch |
|---|---|
| **Kollateraler Testverlust:** beim Streichen der 285 Merker-Zeilen fielen Zusicherungen mit, die nichts mit dem Merker zu tun hatten — `buildLocationEditPayload` wurde danach von KEINEM Test mehr ausgeführt | die Sync-Einzelübernahme und beide Payload-Bauer sind wieder aufgesetzt (`wiki-assign-ort.test.js`), belegt per `git grep` |
| **Tautologie:** die neue Zusicherung in `weg-merker-reichweite-test.php` §6 war zeichengleich mit der Vor-Zusicherung; der Kommentar behauptete eine Kausalität, die die Namens-Zusammenfassung gar nicht liefert | Kommentar sagt jetzt, was der Abschnitt belegt (die Liste bleibt UNVERÄNDERT) und was nicht (die Reichweite); dazu ein `$nachZentrum == $vorZentrum` |
| **Kommentar widerspricht dem Code:** „Die Signatur behält ihren Parameter" über einer Signatur ohne Parameter | selbst gefunden und korrigiert, bevor der Bericht kam |
| **Tote Begründungen:** elf Stellen behaupteten weiter, der Merker werde „gelesen"/„gesetzt", zwei davon wörtlich die Gegenthese („NICHT aus der Zuweisung ableitbar") | alle elf datiert umgeschrieben (`repair.php` ×4, `wiki-assign-registry.js` ×3, `wiki-assign-{ort,weg}.js`, `review-{locations,labels}.js`, `wiki-sync-settlement-editor.html`, `review-panel.css`) |
| **Vakuum-Zusicherung:** `no_wiki` stand nie in `actions`, die Prüfung war schon vorher grün | als Vorwärts-Riegel benannt, mit dem Hinweis, was den Knopf wirklich bewacht |
| **Fehlender eigener Wächter** (der Plan hatte ihn versprochen) | `kein-wiki-eintrag-ist-weg-test.php` gebaut; gegen den HEAD-Stand gefahren: **9 Zusicherungen greifen**, gegen den neuen Stand null |
| **Mehr als 10 möglich:** die Kraftlinien-Vererbung ist der letzte Setzer auf `true` | als 💣 in Schritt 4 notiert; die Reihenfolge trägt es (Setzer fällt in Schritt 3, vor der Bereinigung) |
| **`konfliktmanagement-design.md` nennt das Verb sechsmal** | datierter Nachtrag im Kopf; der Entwurfstext selbst bleibt unverändert (Hausregel: nicht rückwirkend schönen) |

**Messung Schritt 1:** 511 JS-Dateien 0 rot · 402 PHP-Dateien 1 rot (`link-url-test.php`,
vorbestehender DNS-Abruf, per `git diff` als unberührt belegt). Kein `ASSET_VERSION`-, kein
`?v=`- und kein `PAYLOAD_VERSION`-Bump nötig — je einzeln gegengeprüft.

---

## Schritt 2 — Transport aus dem geteilten Bauteil und den sechs Datenwegen

**Dateien**
- `js/ui/wiki-assign.js` — `keinArtikel` / `kein_artikel` / `kein_artikel_geaendert` aus Modell,
  Texttafel (`:199/200`), Häkchenbau (`:618-625`), Zustand (`:1082/1228/1238/1426/1600/1605`),
  `lies()` (`:1688/1700`) und dem Vertrag im Kopfkommentar (`:24/95/115-125/162`).
  💣 Der Vertrag im Kopf ist die eigentliche Arbeit: `lies()` verspricht dort fünf Schlüssel, und
  wer einen davon still streicht, lässt die Datenwege ins Leere greifen.
- Die **sechs** Datenwege: `wiki-assign-{karte,landschaft,literatur,ort,territorium,weg}.js` —
  dort fallen auch die verbliebenen `keinArtikelHaken: false`.
- Inline-Fassung der Kraftlinie: `html/wiki-sync-powerline-editor.html:695/710`.
- Weitere Oberflächen-Transporte: `html/{landschaften,wiki-sync-settlement,citymap}-editor.html`,
  `js/review/review-{settlement,label,path}-wiki.js`, `js/review/review-{locations,labels}.js`,
  `js/pages/wege-editor.js:693/1693`,
  `js/map-features/map-features-{labels,location-editing,ecosystem-properties}.js`,
  `js/routing/routing.js:183`.
- CSS des dritten Zustands: `editor-page.css:799`, `region-sync.css:249`, `review-panel.css:857`.

**Tests:** die zehn `wiki-assign-*.test.js`, `ort-wiki-override-form.test.js`,
`label-wiki-override-kette.test.js`, `landschaft-autoname-merker.test.js`.

⚠️ **`ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` bumpen**, wenn ein dynamisch
geladenes Editor-Blatt dabei ist (AGENTS.md §7).
⚠️ **`.php`-Seiten, die Assets laden, tragen ihre `?v=` von Hand** — Gegenprobe kostet nichts:
`grep -n '?v=' <die .php-Seite, die deine Datei lädt>`.

**Schritte**
- [x] 2.1 Tests umschreiben → ROT.
- [x] 2.2 Transport entfernen, Kopf-Vertrag von `wiki-assign.js` nachziehen.
- [x] 2.3 `ASSET_VERSION` / `?v=` geprüft — **kein Bump nötig** (alle geänderten Dateien werden vom
      Deploy automatisch gestempelt; keine ist Quelle des gescopten Bauprodukts).
- [x] 2.4 Ganzes Testfeld.
- [x] 2.5 Agent widerlegt den Diff.
- [ ] 2.6 Owner → Commit + Push.

### Was der Prüfagent gefunden hat (elf Befunde, alle behoben)

| Befund | Behoben durch |
|---|---|
| 💣 **Die Karten-Bedingung war NICHT äquivalent.** `citymap.no_article` ist eine eigene Spalte und bleibt; bis hierher löschte eine Zuweisung sie über `kein_artikel_geaendert`. Mein Ersatz fragte nur „steht ein Artikel da" — das hätte bei **jedem** Speichern einer Karte mit Artikel UND Merker die Spalte mitgeschickt, also dort, wo vorher nie etwas mitreiste | zweiter Bezugspunkt `ceWikiZugewiesen`, gesetzt im `zuweisen:`-Rückruf; Bedingung ist jetzt „trug die Spalte UND wurde in dieser Sitzung zugewiesen". Der fehlende Testfall ist ergänzt und **gegen die falsche Bedingung gefahren: er wird rot** |
| 🪤 **Die tragende Begründung war falsch.** Drei Stellen begründeten die Zurückhaltung mit „die Entscheidung des Konfliktzentrums" — das fasst `citymap.no_article` **nie** an (`grep citymap repair.php` → 0). Seit dem 16.08.2026 setzt die Spalte überhaupt niemand mehr auf 1 | Begründung in Editor und Test korrigiert; die Zurückhaltung bleibt, ihr Grund ist ein anderer |
| **`zeichneSchreibzustand` hatte keinen Aufrufer mehr** — der teilweise Zeichenweg existierte nur für das Häkchen | gefallen, mit einer Notiz, was ein künftiger zweiter Auslöser wieder braucht |
| **Zwei Tests riefen `setLabelWikiRegion` mit alter Arität** — folgenlos, aber der falsche Vertrag | mitgezogen |
| **VAKUUM in `wiki-assign-landschaft.test.js`** — das `true` landete seit der Signaturänderung als `fieldOrigins` und wurde verworfen; die Zeile maß denselben Fall wie die drei darüber | gestrichen, mit der Begründung an ihrer Stelle |
| 💣 **Kein ausführender Wächter für `buildLabelEditPayload`** — für Ort, Region und Kraftlinie gab es je einen, für den Label-Rumpf keinen. **Das ist die Wiederholung des Schritt-1-Fehlers** | sechs ausgeführte Zusicherungen ergänzt (drei Hakenlagen × update/create) |
| **Umgedrehte PHP-Zusicherung las Kommentare mit** — als „steht drin" egal, als „steht NICHT drin" wird jeder künftige Kommentar zum falschen Roten | Kommentarfilter ergänzt, wie ihn der Nachbartest längst hat |
| **Sieben verwaiste Kommentarblöcke**, die sich nach dem Löschen an die nächste Zeile gehängt hatten (zweimal stand „ein WERT, keine Lesefunktion" unmittelbar über „eine LESEFUNKTION, kein Wert" — beide über demselben Feld) | alle aufgelöst |
| **Weitere tote Begründungen** in nicht geänderten Dateien | die im Umfang liegenden korrigiert |
| **Tote dritte Spalte** in `MARKER_ERZEUGER` | 🪤 **stand als „entfernt" hier und war es NICHT** — nur ihr Gebrauch war weg, die Spalte blieb samt erklärendem Kommentar stehen. Gefunden vom Prüfagenten nach Schritt 3, dort wirklich entfernt. ⭐ Ein Häkchen im Plan ist keine Messung: eine tote Spalte in einer Tafel sieht wie eine Zusicherung aus. |
| **Weichere JS-Zusicherung als die PHP-Wächter** (`!== true` gegen „Schlüssel ganz verboten") | angeglichen |

**Messung Schritt 2:** JS 0 rot · PHP 1 rot (`link-url-test.php`, vorbestehender DNS-Abruf).

---

## Schritt 3 — die Schreiber

**Dateien**
- `api/_internal/map/features.php` — 50 Codezeilen in 13 Blöcken, dazu
  `avesmapsAssertPowerlineWikiClaimNotContradictory` (`:1967`) und die Kraftlinien-Erbschaft
  (`:2100/2101`).
- **`api/_internal/map/wiki-claim.php` — die Datei fällt ganz**, samt ihrer fünf Aufrufstellen
  (`features.php:1486/1968/2769/3562`, `ecosystem.php:2246`).
- `api/_internal/wiki/{settlements,paths,regions,powerlines,locations}.php` — einschließlich
  **`locations.php:999` (`unset`) und `:1026`** sowie
  **`powerlines.php:197/210/282/283/299/317`** (`clear_no_article` und `no_article_reopened`,
  letzteres bis `api/edit/wiki/dump.php:800` und `js/review/review-wiki-sync.js:2098`).
- `api/_internal/app/{ecosystem,curve-label-store}.php`,
  `api/_internal/import/garetien-uebernahme.php`, `api/_internal/map/field-origins.php`,
  `api/edit/map/{paths-editor,powerlines}.php`.
- **Zuletzt in diesem Schritt:** `api/app/map-features.php:1368` — jetzt ist seine ausdrücklich
  notierte Begründung („er wird anderswo gelesen") wirklich entfallen. Der Kommentarblock darüber
  wird mit umgeschrieben, sonst bleibt eine Rangfolge stehen, deren Punkt 1 es nicht mehr gibt.

**Tests:** die neun `*-no-article-test.php` (mehrere fallen ganz),
`powerline-{inherit,claim}-test.php`, `weg-merker-reichweite-test.php`,
`wikisync-fall-no-article-test.php`, `wiki-url-aus-der-zuweisung-test.php`,
`ecosystem-{wiki-no-article,label-wiki-durchtrag,auto-name-merker}-test.php`,
`curve-label-store-test.php`.

💣 **`AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` (heute 23) — Entscheidung MIT Messung.**
Dieser Schritt ändert den Inhalt von `api/app/map-features.php`, ohne ein Kartenobjekt anzufassen;
ohne Bump sieht kein warmer Besucher den Fix, und im Editor fällt das nie auf. **Aber:** die 10
Träger haben weder Nest noch flache Adresse, der Riegel wehrt also nachweislich nichts ab. Vorher
die Nutzlast vorher/nachher vergleichen. Ändert sie sich nicht, den Bump **begründet weglassen**
statt jedem warmen Besucher 3 MB aufzuerlegen; ändert sie sich, bumpen.

**Schritte**
- [x] 3.1 Tests umschreiben → ROT (13 rot: 12 Merker-Tests + der vorbestehende DNS-Test).
- [x] 3.2 Schreiber entfernen, `wiki-claim.php` löschen, beide Asserts abbauen.
- [x] 3.3 Nutzlast vorher/nachher vergleichen, Bump-Entscheidung schriftlich begründen → **kein Bump**.
- [x] 3.4 Ganzes Testfeld: **399 PHP / 511 JS, nur der vorbestehende `link-url-test.php` rot.**
- [x] 3.5 Agent widerlegt den Diff — **zwei Agenten, und sie haben geliefert** (siehe unten).
- [ ] 3.6 Owner → Commit + Push.

### 💣 Was die Prüfagenten gefunden haben — nachdem das Testfeld grün war

⭐ **Die Lehre über allem: ein grünes Testfeld sagt nichts über KOMMENTARE.** Von den Befunden war
keiner ein roter Test. Zusammen waren es rund **zwei Dutzend** Stellen.

🔴 **Der schwerste: ein Kommentar, der den Merker ZURÜCKBESTELLT.** In `ecosystem.php` stand ein
18-Zeilen-Abschnittskopf „Der dritte Zustand", darin wörtlich: *„Wer die Landschaften ins
Konfliktzentrum aufnimmt, findet ihn bereits geschrieben vor — er muss nur gelesen werden."* Das ist
keine tote Zeile, das ist eine **Bauanweisung an den nächsten Leser**, genau das Feld wieder
anzuschließen, das dieser Umbau entfernt. Ein Kommentar, der eine Funktion verspricht, ist teurer als
toter Code — er überlebt jeden Testlauf.

💣 **Zwei Stellen, an denen der CODE eine Form trägt, weil ein Test sie erzwang.**
`garetien-uebernahme.php` schreibt an zwei Stellen absichtlich `array_merge(…, bedingt-leer)` statt
einer Feldzuweisung, *„weil `label-wiki-no-article-test.php` den GANZEN api/-Baum nach genau dieser
Schreibweise scannt"*. Diesen Scanner habe ich in diesem Schritt gelöscht. Wer das liest, glaubt an
einen Riegel, den es nicht gibt; wer die Form „aufräumt", weiß nicht, warum sie so war. ⭐ Die Form
bleibt (unbestellter Umbau), der Zwang ist benannt als weggefallen.

💣 **VIER Vakuum-Zusicherungen — sie waren auch gegen HEAD grün.** Selbst nachgemessen, nicht dem
Agenten geglaubt:
- `weg-merker-reichweite-test.php` §8 suchte `avesmapsConflictRepairSpansNameGroup(` im Rumpf des
  Schreibwegs. Den rief er **nie selbst** — er rief `avesmapsApplyPathWikiNoArticleToNameGroup(`, und
  *die* fragte die Weiche. ⭐ Repariert auf `NameGroup(`, gegengemessen: gegen HEAD **rot**, jetzt grün.
- §4b schickte dem Spion **seinen eigenen Suchstring** als Gegenprobe und belegte damit nur, dass
  `str_contains` funktioniert. Der Zähler fängt nur noch einen byte-genauen Revert — das steht jetzt
  dort, statt ihn als „früheste Stelle" auszugeben.
- `ort-wiki-no-article-test.php` prüfte zweimal auf einen Zustand, den es nie gab (der Merker lebte
  vollständig in `avesmapsApplyPointWikiFields`, nie in den Rümpfen der Schreibwege).

💣 **Und die Fehlerklasse ein ZWEITES Mal:** `avesmapsBuildLineStringFeatureResponse` hatte seine
einzigen direkten Läufe im gelöschten `weg-wiki-no-article-test.php` — danach **null** Test-Aufrufer,
obwohl der Kartendialog die Antwort per `{...alt, ...neu}` einmischt. Ich hatte nach dem MERKER
gezählt, nicht nach dem BAUER. Nachgeholt als Abschnitt 9.

🔴 **Die Bump-Entscheidung stand auf dem DUMP, während dieser Plan für Schritt 4 ausdrücklich eine
LIVE-Messung vorschreibt — derselbe doppelte Maßstab, den er anderswo anprangert.** Behoben, siehe
oben: 0 von 12.318, live gezählt.

🪤 **Ein Häkchen in diesem Plan war eine Behauptung, keine Messung:** die tote dritte Spalte in
`MARKER_ERZEUGER` stand als „entfernt" da und war es nicht.

⚠️ **Für den Commit-Betreff (AGENTS.md §9):** `js/review/review-wiki-sync.js` verliert eine
**editor-sichtbare** Meldezeile des Kraftlinien-Syncs („im Wiki aufgetaucht, Markierung ‚kein
Artikel' aufgehoben"). Der Betreff muss diese Wirkung benennen, nicht nur „Schreiber entfernt".

### Was Schritt 3 gekostet hat, und was dabei herauskam

🔴 **Der PAYLOAD_VERSION-Bump ist WEGGEBLIEBEN, und zwar LIVE gemessen.** Erst lief der echte
Anreicherungs-Code mit und ohne Riegel gegen alle 11 Merker-Träger des Dumps vom 08.09.2026:
`Traeger geprueft: 11 / davon Nutzlast VERSCHIEDEN: 1 → Altenau`.
🪤 **Das war die richtige Rechnung an der falschen Grundlage, und ein Prüfagent hat den doppelten
Maßstab gefunden:** dieser Plan schreibt für die Bestandsreparatur ausdrücklich eine LIVE-Messung vor
(„nie gegen den Dump"), während die Bump-Entscheidung auf einem Dump vom Vortag stand — zwischen
Dump und dem Fall des Häkchens konnte jeder Editor weitere Träger anlegen.
⭐ **Die Live-Messung braucht keine Datenbank und genau EINE Anfrage.** Solange der Riegel steht, ist
ein Träger exakt ein Objekt, dessen ZUWEISUNGSNEST eine Adresse trägt, während die flache `wiki_url`
leer bleibt — nichts anderes kann das verhindern. Das ist die vollständige Menge derer, deren
Nutzlast sich ändern würde. Gemessen am 09.09.2026 an der Live-Nutzlast, Revision 119767:
**0 von 12.318 Objekten.** Die Nutzlast ist Byte für Byte dieselbe → ein Bump hätte jedem warmen
Besucher rund 3 MB für nichts gekostet. Die Begründung steht im Kopf von `api/app/map-features.php`.

💣 **VIER TESTDATEIEN SIND GEFALLEN, und die Begründung ist nicht „sie waren rot".** Gemessen wurde
je Datei, welche PRODUKTIVFUNKTION sie noch AUSFÜHRT (eine Textprobe zählt nicht als Abdeckung):
`ecosystem-wiki-no-article-test.php` · `label-wiki-no-article-test.php` ·
`kraftlinie-wiki-no-article-test.php` · `weg-wiki-no-article-test.php` — alle vier führten
ausschließlich Funktionen aus, die es nicht mehr gibt.
🔴 **Und ZWEI sind ausdrücklich stehengeblieben, obwohl ihr Name den Merker trägt**, weil sie die
EINZIGE ausführende Abdeckung eines Schreibwegs sind (nachgezählt):
`wikisync-fall-no-article-test.php` → `avesmapsWikiSyncUpdateLocationFeature` (der dritte Schreiber
von `properties.wiki_url`) · `weg-merker-reichweite-test.php` → `avesmapsUpdatePathFeatureDetails`.
Beide sind auf das umgeschrieben, was sie ohne den Merker noch messen. **Die Dateinamen bleiben** —
`git log --follow` findet den Merker sonst nie wieder.

⭐ **Der Rückbau-Wächter hat einen BAUMLAUF bekommen, und der ersetzt die Namensliste.** Statt vier
Oberflächen aufzuzählen, zählt `kein-wiki-eintrag-ist-weg-test.php` §6 jetzt über den ganzen Baum:
PHP unter `api/` (ohne Tests) **genau 1** Fundstelle im kommentarfreien Quelltext —
`api/_internal/audit-detail.php`, der Übersetzer historischer Protokollzeilen, der bleibt —, und
`js/` + `html/` + `css/` **null**. Gemessen 09.09.2026: 348 bzw. 405 Dateien. Die Bauform ist von
`label-wiki-no-article-test.php` geerbt, das genau daran einmal gescheitert war (feste Zwei-Datei-
Liste, ein sechster Zuweiser lief ungesehen durch, EXIT 0). 💣 Der Selbsttest des Kommentar-Entferners
steht daneben: auf der Browser-Seite gibt es keine erlaubte Fundstelle mehr, die beweist, dass er
überhaupt noch etwas durchlässt — ohne ihn wäre der ganze Abschnitt ein Vakuum.

🪤 **Fünf Stellen, die der Diff selbst nicht gezeigt hat und die einzeln gesucht werden mussten:**
- `api/edit/map/powerlines.php:68` — ein Kommentar „Der dritte Zustand MUSS hier stehen" stand nach
  dem Wegfall der Projektion über `wiki_powerline` und beschrieb damit die falsche Zeile.
- `api/_internal/wiki/powerlines.php` — `$forceWrite` war eine tote Variable, ihre zweite
  Schreibbedingung damit ein toter Zweig; `$counts[...]` hing an einer Bedingung, die nie mehr
  falsch werden kann. Beides zusammengezogen, die Signaturzeilen (`clear_no_article`,
  `no_article_reopened`) nachgezogen.
- `js/map-features/__tests__/landschaft-autoname-merker.test.js` — ein **FREMDER** Test nagelte die
  REIHENFOLGE zweier `properties_json`-Schreiber fest, und einer davon war der Merker. Die Regel
  lebt weiter (an seine Stelle ist die Feldherkunft getreten), also wurde der Name nachgezogen und
  die Zusicherung nicht gestrichen. 🪤 Ihr Rückbau-Zusatz war beim ersten Anlauf rot, weil er
  Fließtext las und an der Begründung über der gefallenen Zeile anschlug — der Helfer dagegen stand
  im Kopf derselben Datei und war nicht benutzt.
- `api/_internal/map/__tests__/weg-merker-reichweite-test.php` — `features.php` band
  `conflicts/repair.php` früher selbst ein, **für den Verbund-Schreiber des Merkers**. Mit ihm fiel
  die Einbindung, und der Test stand vor einer undefinierten Funktion. Er holt sie sich jetzt selbst.
- Zwei Zusicherungen waren an einer ANNAHME gebaut statt an einer Messung und wurden erst rot, dann
  gemessen: `map_revision` ist ein GLOBALER Kartenstempel (der Seed setzt 7, der erste Schreibvorgang
  vergibt die 2 — eine `>`-Probe ist dort falsch), und im Kraftlinien-Entscheider wird sehr wohl
  geschrieben, nur aus einem anderen Grund (`cleared`, weil der Name nicht trifft).

🔴 **DIE FEINSTE REGEL DES SCHRITTS, an vier Stellen einzeln festgenagelt: kein Schreibpfad räumt
den Altbestand-Merker nebenbei weg.** Zwischen Schritt 1 und Schritt 3 tat 》Trennen《 das noch — als
Rest der alten Weiche, „damit jedes Trennen einen Träger nebenbei heilt". Das ist zurückgenommen:
ein Schreibpfad, der nebenbei aufräumt, macht aus dem Ausbau eine verstreute zweite Reparatur und
verändert die Bestandszahl bei jedem Klick, während **Schritt 4 sie messen soll**. Zugesichert ist
es jetzt in BEIDE Richtungen (weder wegräumen noch anlegen) in `conflict-repair-reach-test.php` §6,
`ort-wiki-no-article-test.php` §1, `wikisync-fall-no-article-test.php` §1 und
`powerline-claim-test.php`.

---

## Schritt 4 — der Bestand

**Admin-Aktion**, Vorbild `avesmapsFeatureSourcesTakeoverAll` (`feature-sources.php:788`):
**Trockenlauf als Vorgabe**, gedeckelt, je Zeile eine eigene Transaktion, Fehler gemeldet statt
geschluckt, EIN Revisions-Bump am Ende. **Kein blindes `UPDATE`.**

- **Nur `map_features.properties_json`.** Nicht `wiki_sync_cases`, nicht
  `map_feature_legacy_properties`, nicht `map_audit_log` — Archive (siehe oben).
- Der Trockenlauf nennt die **erwartete Zahl vor dem Lauf: 10**. Weicht sie ab, wird nicht
  gefahren, sondern gemessen. (Der Trockenlauf ist die Messung, die kein Test leisten kann — 1070
  statt der erwarteten ~50 entlarvten beim Wegquellen-Lauf eine ganze fremde Datenklasse.)
- 💣 **ES KÖNNEN MEHR ALS 10 SEIN, und die 10 sind KEINE Obergrenze.**
  `avesmapsPowerlineInheritedLineFields` (`api/_internal/map/features.php:2100/2101`) vererbt
  `wiki_no_article => true` auf **jedes neu angehängte Kraftliniensegment** — und 5 der 10 Träger
  sind Kraftliniensegmente (Hursachquelle, Drachenblick ×4). Zieht ein Editor zwischen Schritt 1
  und Schritt 3 eine dieser Linien weiter, entstehen NEUE Träger eines Feldes, das niemand mehr
  liest.
  ⚠️ Für das Ergebnis ist das harmlos: der Setzer fällt in **Schritt 3**, also VOR der Bereinigung
  in Schritt 4 — die Reihenfolge trägt das schon. Aber die Zahl wird **live gemessen**, nie gegen
  den Dump vom 08.09.2026 festgeschrieben. Und Schritt 3 fasst diese Vererbung ausdrücklich mit an;
  sie ist nach Schritt 1 der **einzige verbliebene Erzeuger von `true`**.
- `updated_at` unangetastet, wie bei `repair_geometry_bounds`.
- 💣 **Der `Ensure`-Helfer läuft VOR der Transaktion, nie darin** — DDL committet in MySQL implizit;
  genau das hat den Landschafts-Umzug am 03.09.2026 489 Fehlschläge melden lassen, obwohl alles
  umgezogen war.

**Schritte**
- [ ] 4.1 Test gegen SQLite-Fixture: Trockenlauf zählt und schreibt nichts, scharf schreibt,
      Archive bleiben unberührt, Deckel greift.
- [ ] 4.2 Aktion bauen.
- [ ] 4.3 Ganzes Testfeld.
- [ ] 4.4 Agent widerlegt den Diff.
- [ ] 4.5 🔧 **DU:** Trockenlauf fahren, Zahl gegen 10 halten, dann scharf.
- [ ] 4.6 Gegenprobe: 0 verbleibende Träger in `map_features`. Commit + Push.

---

## Danach

- [ ] `AGENTS.md` §11: der Merker verschwindet aus den Einträgen, die ihn als lebende Regel führen
      (Statuskreis, Kanon-Etikett, Konfliktzentrum, Wiki-Zuweisung, Übernahme-Vorschau) — **mit der
      Begründung, warum es ihn gab**, damit ihn niemand wieder einführt.
- [ ] Memory `wiki-no-article-ausbau-stand.md` auf „erledigt" ziehen, die Lehre behalten.
- [ ] `html/editor-handbuch.html` **nicht** anfassen — die Commit-Betreffe nennen die Wirkung, die
      nächtliche Routine schreibt die Abschnitte um.
