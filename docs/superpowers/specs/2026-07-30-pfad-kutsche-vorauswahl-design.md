# Kutsche auf Pfaden: nicht mehr vorausgewählt (Design)

**Datum:** 2026-07-30 · **Auftraggeber:** Owner · **Maßstab:** AGENTS.md §9
(Shared Tree, keine Handbuch-Bearbeitung), §7 (Asset-Versionierung)

## 1. Auftrag

Zwei Teile, vom Owner am 2026-07-30 beauftragt:

1. Im Wege-Editor soll beim Wegtyp **Pfad** das Häkchen **Kutsche** nicht mehr
   vorausgewählt sein.
2. Im Bestand soll die Kutsche bei **allen** Pfaden entfernt werden.

Ausdrücklich **kein** hartes Verbot: „es gibt theoretisch Pfade, wo man eine
Kutsche durchbekommt, die kenne ich jetzt noch nicht, deswegen will ich die
Option anbieten" (Owner). Das Kästchen bleibt also anklickbar; die Editoren
schalten die Kutsche dort wieder an, wo sie durchkommt.

**Nicht im Auftrag:** Gebirgspass. Er sieht in den Daten genauso aus (95 Zeilen
mit Kutsche, 76 ohne Liste) und ist sachlich derselbe Fall, bleibt aber
draußen, bis der Owner ihn verlangt.

## 2. Ausgangslage im Code

Zwei Begriffe stecken heute in **einer** Funktion. `getTransportOptionsForPathSubtype()`
(`js/review/review-paths.js`) beantwortet gleichzeitig

- *welche* Transportmittel ein Wegtyp anbietet und
- *welche* davon vorausgewählt sind,

und `syncPathTransportOptions()` benutzt das eine Ergebnis für beides: für
`hidden`/`disabled` **und** für `checked`. Beim Wüstenpfad fallen die beiden
Begriffe zusammen (die Kutsche wird gar nicht angeboten), deshalb ist es bisher
nicht aufgefallen. Der Pfad braucht sie getrennt.

Die Regel „gespeicherte Liste schlägt Vorgabe" steht **viermal**:

| Ort | Funktion |
|---|---|
| Editor-Dialog | `getPathAllowedTransports()` — `js/review/review-paths.js` |
| Client-Router | `isTransportAllowedForPath()` — `js/routing/route-engine.js` |
| Server-Router (live primär) | `avesmapsIsClientTransportAllowedForPath()` / `avesmapsClientRoutePathAllowedTransports()` — `api/_internal/routing/client-graph.php` |
| Speichern | `avesmapsReadAllowedTransports()` — `api/_internal/map/features.php` |

Alle vier müssen dasselbe sagen, sonst zeigt der Dialog etwas anderes als der
Router fährt.

## 3. Datenlage (gemessen am Livebestand, ein Seitenaufruf, 2026-07-30)

> **Korrektur 2026-07-30 nach dem SQL-Lauf:** die Zahlen unten sind am **Karten-Payload**
> gemessen, und `api/app/map-features.php` filtert `is_active = 1`. In der Tabelle stehen
> **910** Pfade mit gespeicherter Kutsche: 793 aktive plus **117 inaktive**, die die Karte
> nie ausliefert. Die SQL repariert beide — eine später wieder aktivierte Zeile darf die
> Kutsche nicht zurückschmuggeln.

1503 **aktive** Pfade:

| Zustand | Anzahl | Schreibvorgang nötig |
|---|---|---|
| gespeicherte Liste **mit** Kutsche | 793 | ja |
| gespeicherte Liste **ohne** Kutsche | 65 | nein |
| **keine** Liste hinterlegt (Vorgabe greift) | 645 | nein — die neue Vorgabe erledigt es |

- **790 der 793** tragen genau die volle Sechser-Vorgabe: dort hat nie jemand
  etwas abgewählt, die Vorgabe wurde nur mitgespeichert.
- **3** sind echte Teilauswahlen, die die Kutsche bewusst behalten
  (`caravan, groupFoot, lightWalker, lightRider` + Kutsche ×2; `lightWalker` +
  Kutsche ×1). Sie verlieren sie mit — der Auftrag sagt „alle".
- Alle 793 haben `transport_domain='land'`; die Sonderform „leere Liste ohne
  Domain" (26 Wüstenpfade, Altlast vom 2026-05-11) gibt es bei Pfaden nicht.

**Wirkung auf Routen** (simuliert mit `createGraph`, `landOption:'horseCarriage'`):
Die Kutsche verliert 1429 Kanten, 1028 Orte haben danach keinen echten
Kutschenweg mehr. **Kein Ort wird unerreichbar** (4675 vorher, 4675 nachher) —
Querfeldein überbrückt. Kutschenrouten werden länger und langsamer, nie
unmöglich.

## 4. Entwurf

### 4.1 Zwei Begriffe trennen

`js/map-features/map-features-path-domain.js` wird der gemeinsame Ort für die
Wegtyp-Transport-Regel. Dorthin **wandern** (aus `review-paths.js`, Originale
werden gelöscht — eine zweite `function`-Deklaration desselben Namens gewinnt
sonst lautlos):

- `getDefaultTransportDomainForPathSubtype(subtype)` — unverändert
- `getTransportOptionsForPathSubtype(subtype)` — **angeboten**, unverändert
  (Pfad: alle sechs Landmittel; Wüstenpfad: fünf)

Dazu **neu**:

- `getDefaultAllowedTransportsForPathSubtype(subtype)` — **vorausgewählt**.
  Gleich der angebotenen Liste, außer beim Pfad: dort ohne `horseCarriage`.
- `resolvePathAllowedTransports(properties)` — die eine Fassung der Regel
  „gespeicherte Liste (auch die leere) schlägt Vorgabe; leere Liste **ohne**
  `transport_domain` ist keine Entscheidung". Fällt sie auf die Vorgabe zurück,
  liefert sie die **vorausgewählte** Liste, nicht die angebotene.

Der Datei-Wechsel ist nicht Kosmetik: `map-features-path-domain.js` ist frei von
Nebenwirkungen und wird von **beiden** Test-Harnischen geladen, `route-engine.js`
ruft dagegen auf oberster Ebene `installServerPrimaryRouting()` auf und lässt
sich nicht in eine vm-Realm laden. Die Regel liegt damit dort, wo sie prüfbar
ist.

### 4.2 Die vier Aufrufer

- `syncPathTransportOptions()` benutzt ab jetzt **zwei** Listen: die angebotene
  für `hidden`/`disabled`, die vorausgewählte für `checked`. Beim Pfad ist die
  Kutsche dadurch sichtbar und anklickbar, aber leer.
- `getPathAllowedTransports()` und `isTransportAllowedForPath()` werden dünne
  Aufrufer von `resolvePathAllowedTransports()`. Das harte Wüstenpfad-Verbot in
  `isTransportAllowedForPath()` bleibt; **für den Pfad kommt kein solches
  Verbot** — eine gespeicherte Liste mit Kutsche gilt.
- `avesmapsClientRoutePathAllowedTransports()` (PHP): liefert im Null-Fall nicht
  mehr `null`, sondern die vorausgewählte Liste des Wegtyps. Für jeden Wegtyp
  außer Pfad ist das genau das bisherige Verhalten.
- `avesmapsReadAllowedTransports()` (PHP): nur der Zweig „keine Liste
  mitgeschickt" ändert sich (Vorgabe = vorausgewählte Liste). Der
  Wüstenpfad-Filter bleibt; eine mitgeschickte Kutsche auf einem Pfad wird
  weiter gespeichert.

Client und Server bleiben getrennte Fassungen mit Querverweis-Kommentaren, wie
schon heute beim Wüstenpfad — `client-graph.php` und `features.php` sind
verschiedene Bibliotheken. Beide Fassungen werden einzeln testgedeckt.

### 4.3 Der Bulk

Eine einmalige, versionierte SQL-Datei `sql/pfad-kutsche-entfernen.sql` nach dem
Vorbild von `sql/burg-locations-to-gebaeude.sql`; der Owner führt sie in
phpMyAdmin aus.

- `JSON_REMOVE(properties_json, JSON_UNQUOTE(JSON_SEARCH(…, 'one',
  'horseCarriage', NULL, '$.allowed_transports[*]')))` auf
  `feature_type='path' AND feature_subtype='Pfad'`
- **zwei** eigenständige `UPDATE`s, mit **einem** `map_revision`-Hochzähler (nicht 910)
- **idempotent**: der zweite Lauf trifft nichts mehr, weil die `WHERE`-Bedingung
  auf denselben `JSON_SEARCH` prüft
- **kein** Audit-Log-Eintrag pro Zeile — 910 Einträge würden das
  Rückgängig-Machen zumüllen (`audit-undo-redo`: Strg+Z frisst die Historie
  abwärts)

> **Korrektur 2026-07-30:** die erste Fassung klammerte beide Anweisungen in eine
> Transaktion und trug die neue Revision über die Sitzungsvariable `@next_revision`
> (übernommen aus `sql/burg-locations-to-gebaeude.sql`). In phpMyAdmin ausgeführt hat sie
> **nichts** geändert: danach trug keine einzige `map_features`-Zeile eine erhöhte
> Revision, und der Server ließ die Kutsche weiter über `path-4973`.
> `map_features.revision` ist `BIGINT UNSIGNED NOT NULL` — eine leere Variable bringt das
> `UPDATE` zum Scheitern und rollt die Transaktion zurück, was genau zum Befund passt.
> Die Variable ist unnötig: beide Anweisungen lesen `map_revision` jetzt direkt, ohne
> Transaktionsklammer, und werden einzeln ausgeführt.

Die 645 Pfade ohne Liste bleiben unangetastet. „Nichts hinterlegt" ist die
ehrliche Aussage, und genau das Vollschreiben von Zeilen ohne Liste ist am
2026-05-11 bei den Wüstenpfaden schiefgegangen (`normalize_wuestenpfad_transports`
schrieb `[]` statt der gemeinten Liste und keine Domain — 26 Zeilen mussten
später geheilt werden).

## 5. Tests

- `js/review/__tests__/path-transport-options.test.js` erweitern: Pfad bietet
  sechs an, wählt fünf vor; eine gespeicherte Liste mit Kutsche bleibt gültig;
  Wüstenpfad unverändert.
- Neuer Test für `resolvePathAllowedTransports()` im selben Harnisch (lädt
  `config.js` → `map-features-path-domain.js`, beide nebenwirkungsfrei).
- `api/_internal/routing/__tests__/transport-restriction-test.php` erweitern:
  Pfad ohne Liste lehnt die Kutsche ab, erlaubt die anderen fünf; Pfad mit
  gespeicherter Kutsche erlaubt sie. **Mit `-d zend.assertions=1`** ausführen,
  sonst prüft `assert()` nichts.
- Neuer PHP-Test für `avesmapsReadAllowedTransports()` (Speicherzweig).

## 6. Was ausdrücklich nicht passiert

- Kein `ASSET_VERSION`-Hochzählen: keine der Dateien ist ein dynamisch
  geladenes Editor-Asset (AGENTS.md §7).
- Keine Bearbeitung von `html/editor-handbuch.html` (AGENTS.md §9) — die
  Nachtroutine macht das. Pflicht ist nur eine Commit-Betreffzeile, die die
  sichtbare Wirkung nennt.
- Kein Wegtyp außer Pfad.
- Kein neues Editor-Werkzeug für den Bulk: die SQL-Datei ist der etablierte Weg.

## 7. Abnahme

1. Tests grün (JS + PHP, PHP mit `zend.assertions=1`).
2. Dialog: Wegtyp Pfad wählen → Kutsche sichtbar, nicht angehäkelt; anklickbar;
   nach Speichern und Wiederöffnen noch gesetzt.
3. Nach dem SQL-Lauf des Owners am Livebestand nachmessen: Pfade mit
   `horseCarriage` in `allowed_transports` = **0**, Pfade ohne Liste weiterhin
   645.
4. Eine Kutschenroute über einen vorher genutzten Pfad rechnet neu und weicht
   aus, statt zu scheitern.
