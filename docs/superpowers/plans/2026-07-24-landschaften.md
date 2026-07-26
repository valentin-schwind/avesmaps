# Landschaften — Implementierungsplan

> **Für agentische Arbeiter:** Dieser Plan ist in **sechs eigenständige Vorhaben**
> geschnitten. Jedes ist für sich nützlich und wird **einzeln beauftragt**. Ein Agent
> bearbeitet **eine Aufgabe je Sitzung**; nach jeder Abnahme beginnt eine neue Sitzung.
> Sub-Skill: `superpowers:subagent-driven-development`.

**Stand:** 2026-07-25, zweite Überarbeitung nach der Rollen-Prüfung gegen HEAD `b9e4bf1c`.

**Grundlage** (das jeweils neuere Dokument gewinnt bei jedem Widerspruch):
- `docs/superpowers/specs/2026-07-25-landschaften-planpruefung-2.md` — **der zweite
  Prüfbericht** (Datenbank / Editor / öffentlicher Betrieb). **Er ist der neueste und
  gewinnt.** Enthält in §G die Owner-Entscheidungen vom 2026-07-25.
- `docs/superpowers/specs/2026-07-24-landschaften-planpruefung.md` — der erste Prüfbericht.
- `docs/superpowers/specs/2026-07-24-landschaften-machbarkeitsanalyse.md` (inkl. §8) —
  die Begründungen. Ihre Zahlen sind überholt, siehe die Zahlen-Tabelle unten.
- Vorarbeit: `docs/oekosystem-*.md`, Demo `html/landschaften-modell.html`.

**Owner-Entscheidungen 2026-07-25** — sie sind getroffen, nicht mehr offen:

| | Entscheidung | Wirkung im Plan |
|---|---|---|
| **1** | **Eine Region trägt mehrere Flächen**, und eine einzelne Fläche darf selbst ein MultiPolygon sein. | `is_trial` wandert auf die Fläche (V2.1); **V3.0b ist neu** und Pflicht; Lesepfad joint; V3.6 braucht ein Ziel-Region-Konzept. |
| **2** | Owner-Entscheidung 4 des Masterplans (*„Diagnostics endpoints: stay public"*) **wird aufgehoben**. | V-1 ist freigegeben und trägt den Nachzug im Masterplan. |
| **3** | Sichtbarkeit der Erprobung: `?landschaften=1` genügt, keine JS-Injektion. | V1.1 Schritt 6 bleibt im Markup. |
| **4** | Der F5-Zustand wird repariert. | ✅ **live** seit `d22bd828`+`9d8d844c` (2026-07-24). Rest: `?landschaften=1` in `ignoredParams` → V1.1 Schritt 1. |

**Ziel:** Eine Kartenebene „Landschaften" im Edit-Modus, in der Editoren
Vegetations-, Topographie- und Regionsflächen zeichnen — als Grundlage für
Reisezeit-Wirkung, Fundort-Anzeige und Suche.

**Architektur:** Eigene Tabellen, eigener Endpunkt, eigener Revisionszähler, eigene
Leaflet-Pane, eigene Zeichenschicht. Die politische Ebene wird **gelesen und
abgeschrieben**, nie aufgerufen und nie verändert.

**Technik:** Vanilla JS ohne Build, Leaflet 1.9.4 (`L.CRS.Simple`), PHP 8 + MySQL/PDO
auf STRATO Shared Hosting, `polygon-clipping` (bereits im Haus).

---

## Namensgebung

**Code englisch, Oberfläche deutsch** (AGENTS.md §8). Eine Sache, ein Wort:

| Schicht | Name |
|---|---|
| Tabellen | `ecosystem_region`, `ecosystem_area`, `ecosystem_region_type`, `ecosystem_revision` |
| Endpunkte | `api/app/ecosystem-areas.php`, `api/edit/map/ecosystem.php` |
| Quellen-Whitelist | `entity_type = 'ecosystem'` |
| JS-Dateien | `js/map-features/map-features-ecosystem-*.js` |
| Globale Namen | `ecosystemLayers`, `syncEcosystemVisibility`, `ecosystemPane`, `IS_ECOSYSTEM_ENABLED` |
| Moduswert | `mapLayerMode=ecosystem` |
| **Oberfläche** | „Landschaften (Erprobung)" |
| **Query-Flag** | **`?landschaften=1`** |

> Das Flag ist die **eine bewusste Ausnahme**: Es steht in dem Link, den der Owner den
> Editoren schickt, ist also Oberfläche und bleibt deutsch. Alles andere ist Code.
>
> Die `kind`-Werte `derographisch | vegetation | topographie` bleiben ebenfalls deutsch —
> sie sind **Domänenvokabular** wie `PATH_SUBTYPE_KEYS` (AGENTS.md §2). „Derographisch"
> ist eine Wiki-Aventurica-Kategorie, kein übersetzbares Wort.

---

## Globale Regeln

Diese gelten in **jeder** Aufgabe, ohne dass sie dort wiederholt werden.

1. 🔴 **Politische Dateien werden nicht bearbeitet und nicht zur Laufzeit aufgerufen.**
   Nicht `js/map-features/map-features-region-*`, nicht `js/territory/*`, nicht
   `api/_internal/political/*`. Erlaubt ist ausschließlich **lesen und abschreiben**.
   Auch die „reine Mathematik" nicht — ein Aufruf koppelt in die Gegenrichtung.
   Prüfung: `git status` zeigt keine politische Datei.
2. 🔴 **Quellen laufen über `sources` + `feature_sources`.**
   `CREATE TABLE ecosystem_source` ist verboten (AGENTS.md §5).
3. 🔴 **Ein Flächen-Save fasst `map_revision` niemals an.** Eigener Zähler
   `ecosystem_revision`, eigener ETag, eigener Endpunkt. Begründung: ~2.000
   Speichervorgänge während des Zeichenfeldzugs × **29,65 MB** Payload-Invalidierung
   für jeden Besucher.

   > 🪤 **Geprüft wird das an `revision`, nicht an der Byte-Zahl.** Die Nutzlast driftet
   > durch gewöhnliche Editorarbeit dauernd (gemessen: **+4.557 B an einem Tag**, ohne
   > jede Landschaft) — eine Byte-Probe schlägt immer an und beweist nichts. Der Wächter
   > ist das Feld **`revision`** im Payload-Kopf; genau daraus wird der ETag gesät
   > (`api/app/map-features.php:225–228`).
   >
   > 💣 **Der zweite Schreibpfad ist `feature_sources`.** `avesmapsNextMapRevision()` wird
   > auch von `api/_internal/app/feature-sources.php:428` (Quelle hinzufügen), `:468`
   > (entfernen) und `:512` gerufen — der Kommentar bei `:421–427` sagt warum: die
   > Quellenliste *„rides in the ETag-cached map-features payload"*. Deshalb ist **V2.4
   > hinter V4 verschoben**.
4. 🔴 **Der Totmannschalter greift an sechs Stellen** — Modus-Eintrag, öffentlicher
   Lesepfad (serverseitig, Zeilen verlassen die Box nicht), Routing-Wirkung, Payload,
   **`api/app/feature-sources.php`** (keine Auth, kein Kill-Switch, Allowlist `:33`) und
   **der Segmentschalter** (V3.0 — die Vorlage `map-features-political-timeline.js:19`
   hat zwei Tore, nicht eins).
   `?landschaften=1` ist ein **Client**-Flag und sichert nichts; die Sicherung ist
   `app_setting['ecosystem_enabled']`.

   > ⚠️ **Der Payload liest `feature_sources` ohne `entity_type`-Filter**
   > (`api/app/map-features.php:754–761`, Katalog `:722–731`). Live reiten dort heute
   > 10.721 Refs und 1.526 Katalogeinträge mit. Ein `ecosystem`-Eintrag in der Allowlist
   > tritt damit **am Kill-Switch vorbei** nach außen — dieselbe Lücke, die `citymap`
   > bereits hat. Deshalb V2.4 hinter V4.
5. **Geteilter Arbeitsbaum:** nie `git add -A`. Nur eigene Pfade einzeln stagen.
   Eigener Worktree empfohlen. 💣 **`index.html` trägt gerade fremde unkommittierte
   Arbeit** — deshalb nennt dieser Plan für `index.html` **keine Zeilennummern,
   sondern Anker** (den Text, neben dem eingefügt wird).
6. **Jeder neue Top-Level-Name wird vor dem Commit gegen `grep` über `js/` geprüft.**
   164 klassische `<script>`-Tags teilen einen globalen Scope; ein doppelter `const`
   killt eine Datei still, und Node-Tests sehen das prinzipiell nie.
7. **Abnahme im Browser, nie „Tests grün".** Konsole auf `SyntaxError` prüfen und
   `typeof window.<neuerGlobal>` abfragen. Es gibt **keine lokale Datenbank**
   (`api/config.local.php` fehlt) — jeder DB-Pfad ist nur live prüfbar.
8. **Deutsch in der Oberfläche, Englisch in Code, Kommentaren und Commits.** Neue
   UI-Strings gehören zusätzlich in `js/app/i18n-en.js`.
9. **Kein `?v=` von Hand.** Ausnahme: `edit/index.php` und `ASSET_VERSION` in
   `js/territory/territory-editor-inline-host.js`.
10. 🔴 **NICHT aufrufen:** `GET /api/route/?diagnostic=graph-data`,
    `?diagnostic=route-name-data`, `?diagnostic=dijkstra-data`,
    `?diagnostic=location-node-data`, `?diagnostic=map-data`, `?diagnostic=network-data`.
    **Alle sechs** lösen `avesmapsLoadRouteMapData` aus (62 MB resident, Peak 152 MB);
    `graph-data` zusätzlich acht Graphbauten. Keiner davon ist „leicht".

---

## Zahlen (gemessen 2026-07-25, zweiter Prüfbericht §D)

Diese ersetzen alle älteren Angaben. Wo Analyse oder erster Prüfbericht abweichen, gilt
diese Tabelle.

| | alt | **gemessen 2026-07-25** |
|---|---:|---:|
| Payload roh | „~14 MB" → 29.646.676 B | **29.651.233 B** |
| `revision` (Top-Level, der ETag-Same) | — | **35.074** |
| Features gesamt | 10.746 | **10.745** |
| ⤷ `location` / `crossing` / `junction` | — | 2.608 / 798 / 1.125 |
| Landschafts-Labels | 538 | **540** |
| ⤷ derographisch / topographie / vegetation | 234/180/119 | **234 / 181 / 119** |
| ⤷ `berggipfel` | 33 | **34** (auf 61 `gebirge`) |
| ⤷ `tundra` | 0 | **0** — bestätigt |
| ⤷ **`ebene`** | **0** | 🪤 **1** — „Zwergenpforte", mit Wiki-Link |
| Orte im Routing-Sinn | 4.531 | **4.531** |
| routingfähige Wege | 5.515 | **5.512** |
| Powerline-Zeilen | 162 | **162** = 1,51 % |
| `source_catalog` / `feature_sources` im Payload | — | **1.526** / **10.721** |
| `map-features-region-*.js` | 20 Dateien | **19**, 4.104 Z., **172** Deklarationen |
| `filter-menu.js` / `review-wiki-sync.js` | 238 / 3.192 Z. | **237** / **3.298** Z. |

**Abgeleitete Zahlen — die alten waren nicht mitgezogen:**

| stand da | woher | **richtig** |
|---|---|---|
| „**282** Zwillinge" | 166 + 116 aus der Tabelle von 07-17 | 181 + 119 = 300, ohne die 34 `berggipfel` (Punkte, keine Flächen) = **266** |
| „V5 nimmt **147** Flächen ab" | alte Zahlen ohne `wueste` | `insel` 95 + `see` 46 + `kueste` 2 + `kontinent` 2 + `wueste` 4 = **149** |
| „**500** Flächen" | — | 234 + 181 + 119 − 34 = **500** ✅ |

> Die 266 trägt V3.6, die 149 trägt V5. **Keine der beiden ist stabil genug, um eine
> Aufgabe allein zu begründen** — sie ändern sich mit jedem WikiSync-Lauf.

---

## Der Schnitt

| | Vorhaben | Ergebnis | Umfang |
|---|---|---|---|
| **V-1** | Diagnosen absichern | ✅ **erledigt 2026-07-25** (`886efeee`), abgenommen | ~60 Z. |
| **V0** | Routing entlasten | ✅ **erledigt 2026-07-25** (`7dfd6016`), abgenommen | ~220 Z. |
| **V1** | Die Ebene existiert | Modus umschaltbar, leer, Flag wirkt | ~320 Z. |
| **V2** | Daten und API | ✅ **erledigt 2026-07-26** (`956d53ee`+`9c3926d6`), abgenommen | ~1.520 Z. |
| **V3** | Zeichnen und Anzeigen | Fläche entsteht **mit Region und Namen**, wird geladen, überlebt Reload | ~1.950 Z. |
| **V4** | Abnahme + Messung | **2 × 10 Flächen, Zeit gestoppt** | kein Code |
| **V4a** | Quellen anschließen (ex V2.4) | `entity_type='ecosystem'` | ~10 Z. |

> **V-1 bis V4 sind das ganze erste Vorhaben.** Alles Weitere wird **neu beauftragt**,
> wenn echte Flächen auf der Karte liegen und sich das Zeichnen gut anfühlt.

**Zwei Verschiebungen gegenüber der ersten Überarbeitung** (Entscheidungen 1 und die
Payload-Befunde):

- **V3.0b ist neu und Pflicht.** Entscheidung 1 („eine Region, mehrere Flächen") heißt,
  dass der Zeichenvorgang wissen muss, in welche Region die Fläche geht. Ohne eine
  Regionsauswahl entstehen namenlose Zeilen. **+150–250 Z.**
- **V2.4 → V4a, hinter die Messung.** Die Quellen-Allowlist öffnet zwei Türen (Regel 3
  und Regel 4) und kauft vor V6 nichts — vor dem Landschaftseditor kann niemand eine
  Quelle anhängen.

---

# V-1 — Diagnosen absichern ✅ ERLEDIGT

> ✅ **Live seit 2026-07-25, Commit `886efeee`.** Abnahme durch den Owner:
> `?diagnostic=map-data` → **401**, `?diagnostic=network-data` → **401**,
> `POST /api/route/` → **200**, `GET /api/locations/` → **200**. `graph-data` blieb
> ungetestet (so vorgesehen). Der Masterplan-Nachzug ist mit im selben Commit.
>
> 🪤 **Der Code-Schnipsel in Schritt 2 nannte die Variable falsch:** `$diagnostic`
> existiert in `api/route/index.php` nicht, die Datei heißt sie `$routeDiagnostic`.
> Unter PHP 8 wäre der undefinierte Name `null` gewesen, `null !== ''` also **wahr** —
> die Sperre hätte bei *jeder* Anfrage gegriffen, auch bei `POST /api/route/`, und
> genau den Vertrag gebrochen, den Schritt 4 schützt. Gebaut wurde mit dem echten
> Namen. Wer den Schnipsel unten liest: er ist die einzige nicht korrigierte Stelle.

> ⚠️ **Dies ist eine Änderung an öffentlichem Bestandsverhalten** (heute 200, danach
> 401) und hat mit den Landschaften nichts zu tun. Deshalb ein eigenes Vorhaben mit
> eigener Abnahme — und unabhängig freigebbar.
>
> 🔴 **Es hebt Owner-Entscheidung 4 auf** (`docs/refactoring-masterplan.md:73`,
> festgeschrieben 2026-06-13: *„Diagnostics endpoints: stay public. … M1 still closes the
> exception-payload leaks (content, not access)."*). **Owner hat sie am 2026-07-25
> aufgehoben** — eine Begründung war nie festgehalten, und die 62 MB je Aufruf hatte
> damals niemand gemessen. Der Nachzug im Masterplan ist Teil dieser Aufgabe (Schritt 6).
>
> Der **Vertrag** ist nicht betroffen: `api/README.md:95` — *„They are not part of the
> stable external API contract."*
>
> ⚠️ **Die Entscheidung deckt mehr ab, als diese Aufgabe anfasst.** Das Inventar bei
> `refactoring-masterplan.md:79–92` listet außerdem
> `api/app/political-derived-geometry-debug.php`, sieben `political-territories.php?action=`-Zweige,
> `?debug_errors=1` an zwei Stellen und die öffentliche `html/political-boundary-diagnostics.html`.
> **V-1 schließt nur die sechs Routing-Zweige.** Der politische Rest ist der teurere Teil
> und gehört in eine eigene Aufgabe — hier nur benannt, nicht mitgemeint.
>
> ✅ **Kein interner Aufrufer.** `grep` über `js/`, `html/`, `tools/`, `index.html` nach
> `diagnostic=`: **0 Treffer**. `sitemap.xml` hat ein einziges `<loc>`, `robots.txt`
> sperrt nur `/admin/`.

### Aufgabe V-1.1 — Alle sechs Diagnose-Zweige hinter die Fähigkeitsprüfung

**Dateien:** Ändern `api/route/index.php:24–310`

**Warum alle sechs, nicht drei:** Der Plan behauptete früher, `map-data` und
`network-data` seien „leicht". Das ist falsch — **jeder** der sechs Zweige ruft
`avesmapsLoadRouteMapData`:

| Zweig | Zeile | Volltabellen-Scan |
|---|---|---|
| `map-data` | `:25` | `:26` |
| `network-data` | `:46` | `:47` |
| `location-node-data` | `:64` | `:70` |
| `route-name-data` | `:104` | `:133` |
| `dijkstra-data` | `:126` | `:157` |
| `graph-data` | `:156` | `:160` + acht Graphbauten |

Gemessen: 62 MB resident, Peak 152 MB je Aufruf; `graph-data` zusätzlich 11,3 s bei
10.000 Knoten. Unauthentifiziert, ohne Rate-Limit, und `api/route/` hat **kein**
`.htaccess` (`api/diagnostics/` hat eins).

> 💣 **Die erste Fassung dieser Aufgabe war nicht lauffähig** — drei unabhängige Fehler in
> fünf Zeilen, und `catch (Throwable)` bei `api/route/index.php:341–342` hätte sie zu
> **500 statt 401** verschluckt. Alle drei sind unten aufgelöst.

- [x] **Schritt 1: `auth.php` einbinden.** `api/route/index.php:5–10` lädt bootstrap,
      request, map-data, network-data, graph, response — **nicht** `auth.php`. Ohne
      zusätzliches `require_once` ist die Funktion undefiniert.

```php
// api/route/index.php, zu den bestehenden requires (:5-10)
require_once __DIR__ . '/../_internal/auth.php';
```

- [x] **Schritt 2: Die GET-Weiche gemeinsam absichern**

```php
// api/route/index.php, VOR der Zweig-Auswertung.
// Alle sechs Diagnosen laden die komplette Feature-Tabelle (gemessen 62 MB resident,
// Peak 152 MB). Sie sind Werkzeuge fuer Entwickler, nicht Teil der oeffentlichen API --
// der stabile Vertrag ist POST / und GET /api/locations/.
if ($diagnostic !== '') {
    avesmapsRequireUserWithCapability('edit');
}
```

> 🔴 **EIN Parameter, kein `$pdo`.** Die Signatur ist
> `avesmapsRequireUserWithCapability(string $capability): array` (`api/_internal/auth.php:94`).
> Ein Aufruf mit zweien ist ein `TypeError`.
>
> 🔴 **Und es gibt in dieser Datei kein `$pdo`.** `$pdo` und `avesmapsCreatePdo` kommen in
> `api/route/index.php` **null mal** vor — die Verbindung entsteht erst *innerhalb*
> `avesmapsLoadRouteMapData` (`api/_internal/routing/map-data.php:6`). Es gibt hier nichts
> zu prüfen und nichts abzuwarten; die Weiche darf ganz vorn stehen.

- [x] **Schritt 3: 🔧 DU (Owner): Abnahme**

Ohne Session, je ein einzelner Aufruf (nicht in einer Schleife):
```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://avesmaps.de/api/route/?diagnostic=map-data"
```
Erwartet: **401** — nicht 403 (angemeldet ohne Recht) und vor allem **nicht 500**
(dann greift einer der drei Fehler oben). Ebenso für `network-data`. **`graph-data` NICHT
testen** — wenn die Sperre wider Erwarten nicht greift, hängt der Aufruf 11 Sekunden und
sättigt den Pool.

- [x] **Schritt 4:** `POST /api/route/` mit einer bekannten Route — **unverändert 200**.
      Die stabile öffentliche API darf sich nicht ändern. Ebenso
      `GET /api/locations/` — der **zweite** Vertragsendpunkt, der über
      `avesmapsLoadRouteMapData` denselben Pfad benutzt (`api/locations/index.php:26`).
- [x] **Schritt 5: Den Masterplan nachziehen.** In `docs/refactoring-masterplan.md`
      Entscheidung 4 (`:73`) als **am 2026-07-25 aufgehoben** kennzeichnen und im Inventar
      (`:79–92`) vermerken, welche Zweige jetzt geschützt sind und welche noch offen
      stehen. Eine eingefrorene Entscheidung stillschweigend zu überholen ist genau die
      Sorte Drift, gegen die der Masterplan geschrieben wurde.
- [x] **Schritt 6: Commit** — `fix(routing): gate all six route diagnostics behind edit capability`

---

# V0 — Routing entlasten ✅ ERLEDIGT

> ✅ **Live seit 2026-07-25.** Commits `a2e4f7c1` (V0.1), `9ef22032` (V0.2), `2b9a70e8`
> (V0.3), `7dfd6016` (V0.4). Abnahme durch den Owner: Wegpunkt-Route im Browser
> (`?route=Gareth&route=Ferdok&route=Havena` — der Wegpunkt-Parameter heißt `route` und
> wird wiederholt), Segmentanzeige stimmt, Konsole ohne Fehler.
>
> **Der Netzlauf, den der Kasten unten verlangt, ist gefahren:** 5 echte Routen × mit und
> ohne `minimize_transfers`, je einzeln vor und nach dem Umbau — **10/10 byte-gleich**.
> `map_revision` beide Male **38061**, der Vergleich also gültig und nicht von fremder
> Editorarbeit verwischt. `GET /api/locations/` ebenfalls byte-gleich (**4546** Orte), was
> V0.3 direkt abdeckt. Tempo: **2,273 s → 1,095 s** im Mittel (**2,08×**, −52 %).
>
> 🪤 **Die Reihenfolgen-Falle (Punkt 5) war real, nicht theoretisch.** Gegen die echten
> Live-Orte gemessen liegen **234 Paare** in einem gemeinsamen Toleranzfenster, und ein
> Zellenlauf *ohne* „kleinster Index gewinnt" weicht bei **778 von 22.730** Sonden von der
> linearen Suche ab. Mit dem Tie-Break: **0 von 59.098**. Ohne diesen Punkt wäre V0.1
> lautlos falsch geworden.
>
> 🪤 **Das Settled-Set trägt zusätzlich eine Distanzschranke.** Es speichert die Distanz
> der letzten Expansion und überspringt nur, wenn diese nicht besser war als die aktuelle.
> Damit ist der Übersprung **beweisbar** verhaltensgleich statt nur empirisch: alle
> Relaxationen des übersprungenen Durchlaufs wären ≥ den bereits erzeugten, und
> `$distances` fällt monoton. Gegenprobe: 1600 Vergleiche über 400 Zufallsgraphen gegen
> eine wörtliche Kopie der alten Funktion, `found`/`cost`/`node_ids`/`edge_ids` überall
> gleich. Der Abbruch am Ziel ist wie vorgesehen **nur bei `!minimize_transfers`** aktiv.
>
> 🪤 **`api/route/index.php:312` in V0.4 stimmte nicht mehr:** durch V-1 liegt der
> POST-Zweig bei **`:321`**. Die Fähigkeitsprüfung für `?diagnostic=` davor blieb
> unangetastet.
>
> ⚠️ **V0 hat keinen Totmannschalter** — der gehört zu den Landschaften ab V1. Die vier
> Änderungen sind seit dem Deploy für **jeden** Besucher aktiv, auch für geteilte
> `?s=`-Links, die serverseitig neu gerechnet werden. Genau deshalb war der Netzlauf und
> nicht ein Fixture-Test der Nachweis.

**Warum:** Der Routing-Pfad trägt heute einen ~983-ms-Posten je Anfrage, und bei
4.531 Orten (statt der gemessenen 3.949 von damals) wächst er weiter. Terrain würde
ihn multiplizieren. Dieses Vorhaben ist **auch dann richtig, wenn die Landschaften nie
kommen**.

> 🔴 **Für V0.1 UND V0.2: ein `?s=`-Link ist ein Rezept, kein Ergebnis.**
>
> | Stufe | Fundstelle |
> |---|---|
> | Wegpunkte gehen als **Namen** in die Query | `js/map-features/map-features-layer-state.js:236` |
> | `minimizeTransfers` reist mit | `:277–279` |
> | Der Teilen-Knopf nimmt genau diese Query | `js/app/share-link.js:58–59` |
> | Der Server legt sie ab | `api/app/share-link.php:128` → `map_share_links.target_query` |
> | **Kein Verfall** | DDL `api/app/share-link.php:19–31`: kein `expires_at`, kein Cleanup |
>
> Jeder geteilte Link wird beim Öffnen **serverseitig neu gerechnet**
> (`api/_internal/routing/response.php:167–170`). Eine Verhaltensdrift in V0.1
> (Reihenfolge bei zwei Orten im selben Toleranzfenster) oder V0.2 (Abbruch am Ziel)
> **verschiebt still eine Route, die jemand vor Wochen geteilt hat** — der Link löst
> weiter auf und zeichnet weiter eine Route, nur eine andere.
>
> **Deshalb ist der Nachweis beider Aufgaben ein Netzlauf, kein Fixture-Test:** dieselben
> **5–10 echten Routen** vor und nach dem Umbau, Antworten gespeichert, Byte-Vergleich.
> Einzelne Aufrufe, keine Schleife. Die Narbe steht im eigenen Haus
> (`docs/oekosystem-instruction.md:217`: *„Neuberechnen andere Reisezeiten liefern und
> Routen lautlos verschieben"*) und in Analyse §8.9 (2026-06-20: *„Mein isolierter
> Mock-Test hat das NICHT gefunden"*).

### Aufgabe V0.1 — Zellindex für die Endpunktsuche

> 💣 **Diese Aufgabe war in der ersten Planfassung funktionsunfähig** und ihr eigener
> Test hätte das nicht gemerkt (Prüfbericht §1.1). Die vier Fehler und ein fünfter,
> beim Nachlesen gefundener, sind unten einzeln aufgelöst.

**Dateien:**
- Ändern: `api/_internal/routing/client-graph.php:620–633` (die Suche)
- Ändern: `api/_internal/routing/client-graph.php:61–67` (dort wird gebaut)
- Ändern: `api/_internal/routing/client-graph.php:98` (Signatur der Aufrufer-Funktion)
- Ändern: **drei** Aufrufstellen: `:103`, `:104`, **`:400`**
- Ändern: `api/_internal/routing/client-graph.php:390` (Signatur von
  `avesmapsCollectClientSeaBoundLocationNames`)
- Test: `tools/routing/test-client-graph-endpoint-index.php` (neu)

**Was tatsächlich im Code steht** (nachgelesen, nicht übernommen):

```php
// :620  ZWEI Parameter, gibt den Ortssatz oder null zurueck
function avesmapsFindClientLocationAtPathEndpoint(array $locations, array $point): ?array

// :625-630  Tschebyschow-Test, KEIN Radius: ein offenes 1,0 x 1,0-Kaestchen
foreach ($locations as $location) {
    if (abs((float) $location['route_y'] - (float) $y) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD
        && abs((float) $location['route_x'] - (float) $x) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD) {
        return $location;      // <-- der ERSTE Treffer in $locations-Reihenfolge
    }
}
```

**Fünf Dinge, die stimmen müssen:**

| # | | |
|---|---|---|
| 1 | **`route_x` / `route_y`, nicht `coordinates`** | Ein Ortssatz aus `network-data.php:134–141` hat `id, public_id, name, subtype, geometry, properties`. Die Routing-Koordinaten entstehen erst bei `client-graph.php:53–54`. Ein Index über `$location['coordinates']` bliebe **leer** → Graph ohne Kanten → jede Route „nicht gefunden". |
| 2 | **Die Signatur ändert sich** | Sie bekommt den Index als dritten Parameter. Alle **drei** Aufrufstellen mitziehen — `:400` liegt in `avesmapsCollectClientSeaBoundLocationNames` und ist leicht zu übersehen; ein vergessener Aufruf ist ein **PHP-Fatal**, kein Testfehler. |
| 3 | **Es gibt schon einen Index** | `$locationCoordinateIndex` (`:61–67`) mit **exakten** Schlüsseln `%.5f:%.5f`, Wert = der Ortssatz selbst. Er dient den Innenknoten-Splits und wird bei `:79` weitergereicht. Der neue heißt **`$locationCellIndex`** und hat eine andere Struktur (Zelle → **Liste von Indizes**). |
| 4 | **Der Toleranzwert ist `AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD`** (`client-graph.php:5`), **nicht** `THRESHOLD` aus `js/config.js:2` — PHP liest die JS-Datei nie. Beide sind zufällig `0.5`; der Kommentar bei `js/config.js:3–6` nennt sogar `0.15` und ist selbst veraltet. |
| 5 | 💣 **Die Reihenfolge ist Verhalten** | Die lineare Suche liefert den **ersten** Treffer in `$locations`-Reihenfolge. Ein Zellindex läuft in Zellreihenfolge und liefert bei zwei nahe beieinander liegenden Orten **einen anderen**. Deshalb speichert der Index **Indizes**, und die Suche gibt den mit dem **kleinsten** zurück. *(Diesen Punkt hat auch der Prüfbericht nicht — er fällt nur auf, wenn man die Schleife wörtlich liest.)* |

**9 Zellen genügen — mit null Reserve.** Schlüssel `round(c·2)` ⇒ Zellbreite `0,5`;
die Toleranz ist damit **eine volle Zellbreite**. Aus `|Δc| < 0,5` folgt
`round(2c_loc) − round(2c) ∈ {−1, 0, +1}`. Steigt die Toleranz je über `0,5`, reichen
9 Zellen **stillschweigend** nicht mehr — deshalb Schritt 4.

- [x] **Schritt 1: Die lineare Referenz als eigene Funktion herausziehen**

```php
// tools/routing/test-client-graph-endpoint-index.php
// Die Referenz ist eine WOERTLICHE Kopie der Schleife von vor dem Umbau -- sie ist der
// Massstab, gegen den die indizierte Suche antritt, und darf nie mitoptimiert werden.
function avesmapsFindClientLocationLinearReference(array $locations, array $point): ?array {
    $x = filter_var($point[0] ?? null, FILTER_VALIDATE_FLOAT);
    $y = filter_var($point[1] ?? null, FILTER_VALIDATE_FLOAT);
    if ($x === false || $y === false) return null;
    foreach ($locations as $location) {
        if (abs((float) $location['route_y'] - (float) $y) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD
            && abs((float) $location['route_x'] - (float) $x) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD) {
            return $location;
        }
    }
    return null;
}
```

- [x] **Schritt 2: Den Test schreiben — mit den drei Fällen, die wirklich beißen**

```php
require_once __DIR__ . '/../../api/_internal/routing/client-graph.php';

// (1) Realistische Streuung. route_x/route_y -- NICHT 'coordinates'.
$locations = [];
for ($i = 0; $i < 4500; $i++) {
    $locations[] = [
        'name' => "Ort$i",
        'route_x' => (($i * 7) % 1024) + 0.13,
        'route_y' => (($i * 13) % 1024) + 0.37,
    ];
}
// (2) Zwei Orte im selben Toleranzfenster -- faengt die Reihenfolgen-Falle (#5).
$locations[] = ['name' => 'ZwillingA', 'route_x' => 500.00, 'route_y' => 500.00];
$locations[] = ['name' => 'ZwillingB', 'route_x' => 500.30, 'route_y' => 500.30];

$index = avesmapsBuildClientLocationCellIndex($locations);
$mismatches = [];

// (3) Sonden bei +-0.4999: exakt an der Toleranzgrenze, wo eine zu kleine
//     Nachbarschaft (nur 4 statt 9 Zellen) auffliegt. +-0.2 wuerde es NICHT zeigen.
foreach ($locations as $loc) {
    foreach ([[0.4999, 0.0], [-0.4999, 0.0], [0.0, 0.4999], [0.4999, -0.4999], [0.0, 0.0]] as $d) {
        $probe  = [$loc['route_x'] + $d[0], $loc['route_y'] + $d[1]];
        $linear = avesmapsFindClientLocationLinearReference($locations, $probe);
        $hashed = avesmapsFindClientLocationAtPathEndpoint($locations, $index, $probe);
        if (($linear['name'] ?? null) !== ($hashed['name'] ?? null)) {
            $mismatches[] = sprintf('%s @ %+.4f/%+.4f: linear=%s indiziert=%s',
                $loc['name'], $d[0], $d[1], $linear['name'] ?? 'null', $hashed['name'] ?? 'null');
        }
    }
}
// (4) 1000 Punkte, die GARANTIERT daneben liegen -- der Fehlschlag muss auch stimmen.
for ($i = 0; $i < 1000; $i++) {
    $probe  = [2000.0 + $i, 3000.0 + $i];
    $linear = avesmapsFindClientLocationLinearReference($locations, $probe);
    $hashed = avesmapsFindClientLocationAtPathEndpoint($locations, $index, $probe);
    if (($linear['name'] ?? null) !== ($hashed['name'] ?? null)) { $mismatches[] = "Fehlschlag $i"; }
}

assert($mismatches === [], "Abweichungen:\n" . implode("\n", array_slice($mismatches, 0, 10)));
echo "OK: " . (count($locations) * 5 + 1000) . " Sonden deckungsgleich\n";
```

- [x] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 tools/routing/test-client-graph-endpoint-index.php
```
Erwartet: `Call to undefined function avesmapsBuildClientLocationCellIndex`

⚠️ **Ohne `-d zend.assertions=1` prüft `assert()` gar nichts** und der Test meldet grün.

- [x] **Schritt 4: Index bauen — mit Zusicherung über die Rasterweite**

```php
// Zellbreite 0.5 = die Endpunkt-Toleranz. Ein Treffer liegt damit in der eigenen oder
// einer der acht Nachbarzellen, nie weiter -- 9 Zellen statt 4.531 Orten.
// Die Zusicherung ist kein Zierrat: waechst die Toleranz je ueber die Zellbreite,
// reichen 9 Zellen nicht mehr, und die Suche wuerde still Treffer verlieren.
const AVESMAPS_ROUTE_CLIENT_CELL_SIZE = 0.5;

function avesmapsBuildClientLocationCellIndex(array $locations): array {
    assert(AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD <= AVESMAPS_ROUTE_CLIENT_CELL_SIZE,
        'Endpunkt-Toleranz groesser als die Zellbreite -- 3x3 Zellen reichen nicht mehr.');

    $index = [];
    foreach ($locations as $i => $location) {
        $x = filter_var($location['route_x'] ?? null, FILTER_VALIDATE_FLOAT);
        $y = filter_var($location['route_y'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($x === false || $y === false) continue;
        $key = ((int) round($x / AVESMAPS_ROUTE_CLIENT_CELL_SIZE)) . ':'
             . ((int) round($y / AVESMAPS_ROUTE_CLIENT_CELL_SIZE));
        $index[$key][] = $i;          // INDIZES, nicht Ortssaetze -- siehe Suche
    }
    return $index;
}
```

- [x] **Schritt 5: Die Suche ersetzen — Reihenfolge erhalten**

```php
function avesmapsFindClientLocationAtPathEndpoint(array $locations, array $cellIndex, array $point): ?array {
    $x = filter_var($point[0] ?? null, FILTER_VALIDATE_FLOAT);
    $y = filter_var($point[1] ?? null, FILTER_VALIDATE_FLOAT);
    if ($x === false || $y === false) return null;

    $cx = (int) round($x / AVESMAPS_ROUTE_CLIENT_CELL_SIZE);
    $cy = (int) round($y / AVESMAPS_ROUTE_CLIENT_CELL_SIZE);

    // Die lineare Suche lieferte den ERSTEN Treffer in $locations-Reihenfolge. Ueber
    // Zellen gelaufen waere die Reihenfolge eine andere -- bei zwei Orten im selben
    // Toleranzfenster kaeme ein anderer heraus. Deshalb: kleinster Index gewinnt.
    $best = null;
    for ($dx = -1; $dx <= 1; $dx++) {
        for ($dy = -1; $dy <= 1; $dy++) {
            foreach ($cellIndex[($cx + $dx) . ':' . ($cy + $dy)] ?? [] as $i) {
                if ($best !== null && $i >= $best) continue;
                $location = $locations[$i];
                if (abs((float) $location['route_y'] - $y) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD
                    && abs((float) $location['route_x'] - $x) < AVESMAPS_ROUTE_CLIENT_ENDPOINT_THRESHOLD) {
                    $best = $i;
                }
            }
        }
    }
    return $best === null ? null : $locations[$best];
}
```

- [x] **Schritt 6: Die vier Signatur-/Aufrufstellen nachziehen**

```php
// :61-67  neben dem vorhandenen $locationCoordinateIndex, nicht statt ihm
$locationCellIndex = avesmapsBuildClientLocationCellIndex($locations);

// :73   avesmapsAddClientCompatiblePathConnection(..., $locationCellIndex, ...)
// :79   avesmapsCollectClientSeaBoundLocationNames($networkData, $locations,
//                                                  $locationCoordinateIndex, $locationCellIndex)
// :103  avesmapsFindClientLocationAtPathEndpoint($locations, $cellIndex, $coordinates[0])
// :104  avesmapsFindClientLocationAtPathEndpoint($locations, $cellIndex, $coordinates[$count - 1])
// :400  avesmapsFindClientLocationAtPathEndpoint($locations, $cellIndex, $endpoint)
```

- [x] **Schritt 7: Beide Tests laufen lassen**

```bash
php -d zend.assertions=1 tools/routing/test-client-graph-endpoint-index.php
php -d zend.assertions=1 tools/routing/test-client-graph-flow.php
```
Erwartet: beide `OK`. Der Flow-Test ist das Schutzgeländer für die Flussrichtung.

- [x] **Schritt 8: Commit**

```bash
git add api/_internal/routing/client-graph.php tools/routing/test-client-graph-endpoint-index.php
git commit -m "perf(routing): cell-index the endpoint lookup instead of scanning all locations"
```

- [x] **Schritt 9: 🔧 DU (Owner): Live-Abnahme**

Eine Route mit Wegpunkten planen (die zerlegt der Client in N−1 POSTs — dort schlägt
der Gewinn am stärksten durch) und mit einer vor dem Umbau gespeicherten Antwort
vergleichen. **Segmentliste identisch**, nur schneller. Einzelne Aufrufe, keine Schleife.

### Aufgabe V0.2 — Dijkstra: Abbruch am Ziel

**Dateien:** Ändern `api/_internal/routing/client-graph.php:743–763`

> 🔴 **Nicht so einfach wie die Vorlage.** Der Heap trägt
> `['node' => …, 'transport' => …]`, und bei `minimizeTransfers` (`:753`) hängen die
> Kantenkosten **vom eingehenden Transportmittel** ab. `$distances[$node]` ist dann
> kein gültiges Label. **Ein Settled-Set, das nur nach Knoten schlüsselt, ändert das
> Ergebnis.** Die Vorlage `graph.php:522` hat gar kein Transportkonzept und taugt
> nicht als Beweis.

> 💣 **Die erste Fassung hatte die beiden Hälften vertauscht.** Sie stellte den Abbruch
> am Ziel unbedingt in Schritt 2 („bei nicht-negativen Kanten immer korrekt, unabhängig
> vom Transportmodell") und hängte das Settled-Set an eine Bedingung. **Der Satz ist
> falsch**, und zwar genau unter der Bedingung, vor der der Kasten oben warnt:
>
> ```php
> $currentDistance = $distances[$currentNode] ?? INF;   // :747  das LABEL, nicht die Prioritaet
> …
> if ($minimizeTransfers && $currentTransport !== null && $transport !== $currentTransport)
>     $weight += AVESMAPS_ROUTE_CLIENT_TRANSFER_PENALTY;  // :753  Kosten am EINGEHENDEN Mittel
> $queue->insert(['node' => $neighbor, 'transport' => $transport], -$alternative);  // :759
> ```
>
> Der Abbruch am Ziel ist nur sicher, wenn die Prioritäten entlang der Extraktionen
> monoton wachsen. Hier tun sie das nicht: ein **veralteter** Heap-Eintrag für `u`
> (eingereiht mit Priorität 10) wird beim Auspacken mit dem inzwischen kleineren
> `$distances[u] = 7` gerechnet — und mit **seinem eigenen** `transport`. Die daraus
> entstehende Relaxation `7 + w` kann unter der Priorität liegen, bei der das Ziel bereits
> extrahiert wurde. Die Vorlage `graph.php:522` hat kein Transportkonzept und beweist nichts.

- [x] **Schritt 1: Netzlauf-Grundlinie aufnehmen.** 5–10 echte Routen (siehe Kasten am
      Anfang von V0), je einmal **mit** und **ohne** `minimize_transfers`, Antworten
      gespeichert. Einzelne Aufrufe, keine Schleife. **Das ist der Maßstab, nicht ein
      Fixture-Test.**
- [x] **Schritt 2: Settled-Set — die sichere Hälfte zuerst.** Geschlüsselt nach
      **`(node, transport)`**, nicht nach `node`. Ohne `minimizeTransfers` ist das
      äquivalent zum Knoten-Schlüssel; mit `minimizeTransfers` ist es der einzige
      korrekte Schlüssel. Netzlauf: alle Antworten byte-gleich.
- [x] **Schritt 3: Abbruch am Ziel — nur, wenn er sich beweisen lässt.** Zulässig
      **ohne** `minimizeTransfers`. Mit `minimizeTransfers` erst dann, wenn der Netzlauf
      aus Schritt 1 ihn deckt — **im Zweifel weglassen.** Das Settled-Set bringt bereits
      den Großteil, und eine still verschobene Route kostet mehr als die Millisekunden.
- [x] **Schritt 4:** `tools/routing/test-client-graph-flow.php` grün **und** der Netzlauf
      byte-gleich.
- [x] **Schritt 5: Commit** — `perf(routing): settle dijkstra nodes per (node, transport) instead of revisiting them`

### Aufgabe V0.3 — Typfilter in der Ladequery

**Dateien:** Ändern `api/_internal/routing/map-data.php:41`

> **Ehrliche Größenordnung: 162 von 10.746 Zeilen = 1,51 %.** Das ist keine
> „Entlastung", sondern Hygiene. Und nur `network-data.php:92` trägt das Argument —
> `:76` wirft **Labels** weg, nicht Powerlines.

- [x] **Schritt 1:** `AND feature_type <> 'powerline'` ergänzen. Verhaltensgleich.
- [x] **Schritt 2:** Flow-Tests grün.
- [x] **Schritt 3: Commit** — `perf(routing): stop loading the 162 powerline rows the graph discards`

### Aufgabe V0.4 — Zeitlimit im Routing-Endpunkt

**Dateien:** Ändern `api/route/index.php` (vor dem POST-Zweig, `:312`)

- [x] **Schritt 1:** `@set_time_limit(30);` ergänzen. `api/route/index.php` ruft es
      **nie** — als einziger schwerer Pfad; im Rest von `api/` gibt es 33 Aufrufe in
      21 Dateien.
- [x] **Schritt 2: Commit** — `fix(routing): give the route endpoint an explicit time limit`

---

# V1 — Die Ebene existiert

**Fertig, wenn:** Umschalten auf „Landschaften (Erprobung)" zeigt die Karte
vollständig **inklusive Territoriengrenzen**, die eigene Pane existiert und ist leer,
hin- und zurückschalten beschädigt die politische Ebene nicht, und **ohne**
`?landschaften=1` ist alles wie heute.

### Aufgabe V1.1 — Flag und Modus

> 🔴 **Es sind acht Stellen, nicht fünf.** Fehlt eine der ersten fünf, fällt der Modus
> **stumm** auf `deregraphic` zurück. Fehlen die letzten drei, erscheint der Modus —
> aber ohne Grenzen und ohne Territoriumsdaten.

| # | Stelle | HEAD | Wirkung, wenn vergessen |
|---|---|---|---|
| 1 | `<option>` in der Modusliste | `index.html`, **Anker:** die Zeile mit `value="powerlines"` | Eintrag fehlt |
| 2 | Whitelist | `js/map-features/map-features-display-mode.js:155` | stummer Rückfall |
| 3 | Icon | `js/config.js:509–516` | Combobox ohne Bild |
| 4 | Übersetzung | `js/app/i18n-en.js:79–86` | `?lang=en` zeigt den Schlüssel |
| 5 | Standardmodus **(nicht ändern!)** | `js/config.js:483` | — |
| 6 | `applyFrontendLayerModeDefaults` | `map-features-display-mode.js:212–234`, Aufzählung `:232` | **harmlos** — aber nur, weil `:213` bei `IS_EDIT_MODE` vorher aussteigt. Bewusst nichts tun, nicht übersehen. |
| 7 | `BOUNDARY_OVERLAY_MODES` | `map-features-boundary-canvas-overlay.js:485`, Abbruch `:487–489` | **Grenz-Canvas zeichnet nichts** |
| 8 | `TERRITORY_BOUNDARY_MODES` | `map-features-political-territory-loader.js:15`, geprüft `:556` und `:600` | **Territoriumsdaten werden gar nicht geladen** |

> **Nebenbefund zu Falle 1 (V1.3):** Weil `schedulePoliticalTerritoryLayerReload` bei
> `:600` aussteigt, greift „`regionPolygons` wird bei jedem `moveend` geleert" im
> **neuen** Modus gar nicht — solange 8 nicht gesetzt ist. Der Rat (eigene Registry)
> bleibt trotzdem richtig; sobald 8 gesetzt ist, greift die Falle wieder voll.

**Dateien:**
- Ändern: `js/config.js` (neben `IS_EDIT_MODE`, `:198`)
- Ändern: `index.html` (Anker: `<option value="powerlines">`)
- Ändern: `js/map-features/map-features-display-mode.js:155`
- Ändern: `js/config.js:509–516`, `js/app/i18n-en.js:79–86`
- Ändern: `js/map-features/map-features.js:31` (Muster: es *disabled*, entfernt nicht)
- Ändern: `js/map-features/map-features-boundary-canvas-overlay.js:485` **und `:42`**
- Ändern: `js/map-features/map-features-political-territory-loader.js:15`

- [ ] **Schritt 1: Flag lesen**

```js
// js/config.js, direkt unter IS_EDIT_MODE (:198)
// Totmannschalter, Client-Seite. Das ist reine Sichtbarkeit -- die Absicherung des
// Lesepfads sitzt serverseitig in app_setting['ecosystem_enabled'] (V2.2). Das Flag
// heisst deutsch, weil es in dem Link steht, den der Owner den Editoren schickt.
const IS_ECOSYSTEM_ENABLED = INITIAL_SEARCH_PARAMS.get("landschaften") === "1";
```

> 🔴 **Zusätzlich `"landschaften"` in `ignoredParams`** (`map-features-layer-state.js`,
> im Set der `hasPlannerStateSearchParams()`, wo seit `d22bd828` schon `_v` steht). Das
> Flag ist Infrastruktur, kein mitgebrachter Zustand — ohne diese eine Zeile schaltet
> `?landschaften=1` den Editor-Zustands-Restore ab (genau die Regression, die `d22bd828`
> für `_v` behoben hat), der Modus fiele auf `deregraphic` zurück und **der Reload-Test in
> V3.5 schlüge fehl**. Der Kommentar am Set nennt `landschaften` bereits als den nächsten
> Kandidaten.

- [ ] **Schritt 2: `<option>` einfügen** — direkt nach der `powerlines`-Zeile:

```html
<option value="ecosystem" data-i18n="view.mode.ecosystem">Landschaften (Erprobung)</option>
```

- [ ] **Schritt 3: Whitelist erweitern — an das Flag gekoppelt** (`display-mode.js:155`)

```js
// "ecosystem" NUR aufnehmen, wenn der Modus ueberhaupt erlaubt ist. Sonst laesst ein
// fremder Link ?mapLayerMode=ecosystem einen anonymen Besucher in einen Modus, den die
// Combobox gar nicht anzeigen kann (Schritt 6) -- der Weg dorthin ist layer-state.js:101.
const allowedModes = ["none", "political", "deregraphic", "powerlines", "original"];
if (IS_EDIT_MODE && IS_ECOSYSTEM_ENABLED) { allowedModes.push("ecosystem"); }
const normalizedMode = allowedModes.includes(mode) ? mode : DEFAULT_PLANNER_STATE.mapLayerMode;
```

> 🔴 **Das ist die eigentliche Sperre, nicht Schritt 6.** Ohne sie läuft
> `?mapLayerMode=ecosystem` aus einem fremden Link über `layer-state.js:101` durch, und
> was dann passiert, hängt nur noch davon ab, was mit dem `<option>` geschehen ist —
> beide Varianten sind kaputt (siehe Schritt 6).

- [ ] **Schritt 4: Icon und Übersetzung** (`config.js:509`, `i18n-en.js:79`)

- [ ] **Schritt 5: Die beiden Grenz-Konstanten erweitern**

```js
// map-features-political-territory-loader.js:15
const TERRITORY_BOUNDARY_MODES = ["political", "deregraphic", "ecosystem"];

// map-features-boundary-canvas-overlay.js:485
const BOUNDARY_OVERLAY_MODES = ["political", "deregraphic", "ecosystem"];

// map-features-boundary-canvas-overlay.js:42 -- Grenzen beim Zeichnen dezent,
// wie in Regionen/Kraftlinien: halbe Deckkraft, duenne Aussenlinie.
const BOUNDARY_WEAK_MODES = ["deregraphic", "powerlines", "ecosystem"];
```

- [ ] **Schritt 6: Option abschalten, wenn das Flag fehlt — `disabled`, NICHT `remove`**

```js
// js/map-features/map-features.js, VOR initializeTransportIconSelects() (:32).
// Muss davor laufen -- die Combobox baut sich aus den <option>-Elementen.
// disabled, nicht remove: dasselbe Muster wie :31 fuer "political".
if (!IS_EDIT_MODE || !IS_ECOSYSTEM_ENABLED) {
    $("#mapLayerModeSelect option[value='ecosystem']").prop("disabled", true);
}
```

> 💣 **Die erste Fassung machte `.prop("disabled", true).remove()` — beides zugleich, und
> beide Hälften versagen verschieden.** Das zitierte Vorbild (`map-features.js:31`) macht
> **nur** `disabled`.
>
> | Variante | was der anonyme Besucher bekommt |
> |---|---|
> | nur `disabled`, **ohne** Schritt 3 | jQuery setzt `option.selected` auch auf einer *disabled* Option — das Attribut sperrt die Benutzerauswahl, nicht die programmatische. `getSelectedMapLayerMode()` liefert `"ecosystem"`, er ist **im Modus**, inklusive der in Schritt 5 erweiterten `TERRITORY_BOUNDARY_MODES`. |
> | mit `remove()` | `.val("ecosystem")` trifft keine Option → `selectedIndex = -1`. Die Karte fällt auf `deregraphic` zurück (`display-mode.js:128`), aber `syncTransportControl` (`js/ui/ui-controls.js:364–377`) findet keine Option: **die Beschriftung wird nie aktualisiert, keine Option bekommt `is-active`/`aria-selected`** — eine Combobox, die gar keine Auswahl anzeigt. |
>
> **`disabled` + Schritt 3 ist die einzige Kombination, die beides schließt.** Die Option
> bleibt im Markup — Owner-Entscheidung 3 (2026-07-25): der Name im Quelltext ist in Ordnung,
> keine JS-Injektion.

- [ ] **Schritt 7: 🔧 DU (Owner): Browser-Abnahme, nicht Codelesen**

Mit `?edit=1&landschaften=1`: Eintrag da, umschalten funktioniert, **Territoriengrenzen
sind sichtbar**, Konsole leer. In der Konsole `getSelectedMapLayerMode()` — muss
`"ecosystem"` liefern, nicht `"deregraphic"`. Ohne `landschaften=1`: Eintrag weg.

- [ ] **Schritt 8: Commit** — `feat(ecosystem): add the map mode behind ?landschaften=1`

### Aufgabe V1.2 — Anzeige-Häkchen für Labels und Grenzen

**Dateien:**
- Ändern: `index.html` (Anker: die Zeile mit `id="togglePathsControl"`)
- Ändern: `js/map-features/map-features.js:47–53` (sichtbar schalten)
- Ändern: `js/map-features/map-features-labels.js:493–505` (`shouldShowLabelMarker`,
  Modusprüfung bei `:501`)
- Ändern: `js/map-features/map-features-boundary-canvas-overlay.js:487–489`

**Warum eigenständig nützlich:** Beim Zeichnen stehen Labels und Territoriengrenzen im
Weg — beim Landschaften-Zeichnen *und* beim Territorien-Zeichnen. Dieser Baustein
bleibt nützlich, auch wenn die Landschaften nie fertig werden.

> **Die Haken übersteuern den Modus in beide Richtungen.** Beim Zeichnen von Maraskan
> will man die Territoriengrenzen **sehen** (als Vorlage für den späteren Grenzimport),
> beim Feinzeichnen einer Küste will man sie weg. Ohne V1.1 Schritt 5 wären sie im
> neuen Modus ohnehin unsichtbar — die beiden Aufgaben hängen zusammen.

- [ ] **Schritt 1: Häkchen einfügen** (nach `togglePathsControl`)

```html
<label id="toggleMapLabelsControl" hidden><input type="checkbox" id="toggleMapLabels" checked /> Labels</label>
<label id="toggleTerritoryBordersControl" hidden><input type="checkbox" id="toggleTerritoryBorders" checked /> Grenzen</label>
```

- [ ] **Schritt 2: Nur im Edit-Modus sichtbar schalten** (`map-features.js:47–53`,
      neben `#togglePathsControl`)

- [ ] **Schritt 3: Labels übersteuern — nur den MODUS, nicht die anderen drei Bedingungen**

`shouldShowLabelMarker` (`js/map-features/map-features-labels.js:493–505`) ist **ein
einziges `return` aus vier UND-verknüpften Bedingungen**:

```js
return getSelectedMapLayerMode() === "deregraphic"
    && bandZoom >= minZoom                                              // :502  Zoomband
    && bandZoom <= maxZoom                                              // :503
    && isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);  // :504  Viewport-Culling
```

```js
// RICHTIG: nur den ersten Faktor uebersteuern.
const editorOverride = IS_EDIT_MODE && document.getElementById("toggleMapLabels")?.checked === true;
return (getSelectedMapLayerMode() === "deregraphic" || editorOverride)
    && bandZoom >= minZoom
    && bandZoom <= maxZoom
    && isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);
```

> 💣 **Die erste Fassung setzte ein `return box.checked` davor** — das hebelt **alle vier**
> Bedingungen aus. Mit gesetztem Haken lägen im Edit-Modus alle Label-Marker auf jeder
> Zoomstufe auf der Karte, und `scheduleLabelCollisionResolution()` (`:524`) liefe über
> den ganzen Satz. Das ist kein Häkchen mehr, das ist ein Performance-Unfall.
>
> ⚠️ **Die Funktion läuft pro Label pro Sync** (`syncLabelVisibility` `:520–525`,
> `syncLabelIcons` `:527–537`, beide bei jedem Zoom und jedem Move). **Kein
> `document.getElementById` je Label** — den **Wert** einmal je Sync-Lauf lesen und
> durchreichen. (Das **Element** zu cachen ist die falsche Reparatur: es hängt in einem
> `hidden`-Container, der beim Moduswechsel umgeschaltet wird.)

- [ ] **Schritt 4: Grenzen übersteuern — in BEIDE Richtungen**

```js
// map-features-boundary-canvas-overlay.js, an der BOUNDARY_OVERLAY_MODES-Pruefung (:485-489)
// IS_EDIT_MODE ist hier garantiert da: js/config.js laedt bei index.html:1644, diese Datei
// bei :1778, und die Pruefung laeuft erst zur Aufrufzeit. Kein typeof-Guard noetig.
const editorOverride = IS_EDIT_MODE ? document.getElementById("toggleTerritoryBorders")?.checked : null;
if (editorOverride === false) { return; }                              // Haken aus -> immer weg
if (editorOverride !== true && !BOUNDARY_OVERLAY_MODES.includes(mode)) { return; }  // sonst wie bisher
```

> Die erste Fassung übersteuerte nur in Richtung **aus** — im Widerspruch zu ihrer eigenen
> Ansage („in **beide** Richtungen"). Ein gesetzter Haken in `none` oder `powerlines`
> hätte weiterhin nichts gezeichnet.
- [ ] **Schritt 5:** Beide Haken lösen ein Neuzeichnen aus — `change`-Listener, der
      `syncLabelVisibility()` bzw. den Overlay-Redraw ruft.
- [ ] **Schritt 6: 🔧 DU (Owner):** Haken aus → Labels bzw. Grenzen weg, im
      **politischen**, im **Standard-** und im **neuen** Modus. Ohne `?edit=1` sind
      beide Haken nicht da und nichts ändert sich.
- [ ] **Schritt 7: Commit** — `feat(edit): toggle map labels and territory borders independently of the mode`

### Aufgabe V1.3 — Eigene Pane und eigene Registry

**Dateien:**
- Ändern: `js/app/bootstrap.js:16–44` (Pane anlegen)
- Ändern: `js/app/runtime-state.js` (eigene Registry)
- Erstellen: `js/map-features/map-features-ecosystem-visibility.js`
- Ändern: `index.html` (Anker: die `<script>`-Zeile der Kraftlinien-Datei)

> 🔴 **Drei Fallen, alle bestätigt:**
> 1. `regionPolygons` **nicht** mitbenutzen — `clearRenderedRegionLayers()`
>    (`map-features-region-rendering.js:150`) leert es bei `:156`.
> 2. `syncRegionVisibility` **nicht** erweitern — zweimal definiert
>    (`political-region-visibility.js:1` und `loader.js:473`); der Loader gewinnt
>    (Guard `:469`) und installiert **dreimal zeitverzögert** (`:591`, `[0, 50, 250]`).
> 3. Eigene Funktionsnamen — `map-features-region-vertex-detach-edit.js` überschreibt
>    **sieben** `window.*`-Handler zur Laufzeit, nachgeladen aus
>    `route-priority-queue.js:66–77`. Ein gleichnamiger Name killt **die politische Ebene**.

- [ ] **Schritt 1:** Pane `ecosystemPane`, z-index **250**. Belegung geprüft:
      `regionsPane` 200, nächste Belegung 300 (Schraffur) — **201–299 ist frei**.
      *(V3.0 teilt sie später in drei — 250/251/252 —, weil `pointer-events` eine
      Pane-Eigenschaft ist. Hier genügt eine.)*
- [ ] **Schritt 2:** `ecosystemLayers = []` in `runtime-state.js`.
- [ ] **Schritt 3:** `syncEcosystemVisibility()` schreiben und in
      `setSelectedMapLayerMode()` (`display-mode.js:184–189`) einhängen.
- [ ] **Schritt 4: Namensprüfung**

```bash
grep -rn "ecosystemLayers\|syncEcosystemVisibility\|ecosystemPane\|IS_ECOSYSTEM_ENABLED\|activeEcosystemLayerKind\|activeEcosystemRegionId" js/ index.html --include=* | grep -v "ecosystem-"
```
Erwartet: keine Treffer außerhalb der eigenen Dateien. *(Am 2026-07-25 für die **neuen**
`ecosystem*`-Namen bestätigt — der Plan hat nach dem ersten Prüfbericht von `landschaften*`
auf `ecosystem*` umbenannt; alle sechs Namen sowie `ecosystem_region`/`ecosystem_area`/
`ecosystem_revision`/`avesmapsNextEcosystemRevision`/`ecosystem_enabled`: je 0 Treffer über
`js/`, `api/`, `index.html`. Die Zeichenfolge „ecosystem" kommt heute nirgends vor.)*

- [ ] **Schritt 5: 🔧 DU (Owner):** Umschalten hin und zurück, dann eine politische
      Territoriumsecke ziehen — sie muss sich noch bewegen. Karte **schwenken**
      (nicht zoomen), denn `clearRenderedRegionLayers` hängt an `moveend`.
- [ ] **Schritt 6: Commit** — `feat(ecosystem): own pane, own registry, own visibility sync`

---

# V2 — Daten und API ✅ ERLEDIGT

> ✅ **Live seit 2026-07-26.** Commits `956d53ee` (V2.1–V2.3 zusammen) und `9c3926d6`
> (Nachtrag, s. u.). **Abnahme durch den Owner, alle drei Prüfpunkte:** Schema mit
> `ecosystem_region_type` = **4 / 5 / 7 = 16** Zeilen; ohne Session und mit
> ausgeschaltetem Flag `{"ok":true,"areas":[],"ecosystem_enabled":false}`; Flag umgelegt,
> Region + Fläche angelegt, erster Save **200**, zweiter Save mit veraltetem
> `expected_revision` **409** statt stillem Verlust; Audit-Log fünf Zeilen in der
> richtigen Reihenfolge; Aufräumen zurück auf `areas: []`.
>
> **Die Kernregel hält, statisch bewiesen:** `avesmapsNextMapRevision` kommt in den drei
> V2-Dateien **null mal als Aufruf** vor (zwei Treffer, beide Kommentare). Der Zähler
> lief in der Abnahme sauber 1 → 6 durch, ohne Lücke — der fehlgeschlagene Save hat
> keine Revision verbraucht, weil der Wächter vor dem Hochzählen wirft.
>
> 🪤 **`set_enabled` legte die Tabellen nicht an.** Die Aktion schrieb nur die
> `app_setting`-Zeile; das Schema wäre erst beim ersten *Schreib*aufruf oder beim ersten
> Lesen *nach* dem Einschalten entstanden. Damit war Schritt 2 („Endpunkt einmal aufrufen,
> dann phpMyAdmin") **nicht durchführbar** — man legt das Flag um und findet ein leeres
> Schema. Behoben in `9c3926d6`: das Schema entsteht bei der bewussten Owner-Aktion.
> *Nebenbefund:* V2.1 Schritt 2 war ohnehin erst nach V2.3 erreichbar — V2.1 liefert eine
> Bibliothek ohne Aufrufer.
>
> 💣 **DDL beendet eine offene Transaktion still.** `promote_trial` schrieb
> `app_setting['ecosystem_trial']` *innerhalb* der Transaktion — und
> `avesmapsAppSettingSet` legt zuerst seine Tabelle an. MySQL committet bei jedem
> `CREATE TABLE` implizit, auch bei einem No-op, und hätte Audit-Zeilen und Soft-Deletes
> aus der Reichweite des `rollBack()` genommen. Die Zeile steht jetzt **nach** dem Commit;
> das Fenster ist selbstheilend. **Hausregel für jeden Schreib-Handler: kein DDL zwischen
> `beginTransaction()` und `commit()`** — das betrifft `*EnsureTables` **und** jeden
> `avesmapsAppSetting*`-Aufruf.
>
> **Sechs Abweichungen von den Schnipseln, jede baut deren erklärte Absicht:**
>
> | | |
> |---|---|
> | `COLLATE=utf8mb4_unicode_ci` auf allen fünf Tabellen | Der Schnipsel nannte nur `CHARSET`. Aber `label_public_id` und `wiki_region_key` existieren zum **Joinen** gegen `map_features` bzw. die Wiki-Tabellen, und die sind sämtlich `unicode_ci` (`sql/schema.sql`, 20 von 20). Ein Cross-Collation-Join liefert „Illegal mix" oder still 0 Zeilen — die Narbe, die `feature_sources` trägt. Nachträglich nur per `ALTER` heilbar. |
> | `DATETIME(3)` mit `DEFAULT CURRENT_TIMESTAMP(3)` / `ON UPDATE` | Der Schnipsel schrieb `DATETIME NOT NULL` ohne Default — das weist jedes INSERT ab, das die Spalte auslässt, und Sekundengenauigkeit kollidiert über ~2.000 Speichervorgänge. Beide geometrieführenden Nachbarn machen es so. |
> | `expected_revision` ist **Pflicht** statt optional | Die Vorlage `avesmapsAssertFeatureCanBeEdited` lässt sie weg-lassbar. Genau so greift ein Wächter still nicht — und es gibt keinen Altbestands-Aufrufer, den Pflicht brechen könnte. Dazu `SELECT … FOR UPDATE`, damit der Vergleich atomar statt nur optimistisch ist. |
> | Kein `FOREIGN KEY` auf `region_id` | Der Bestand hat **null** FK-Constraints (0 in `sql/schema.sql`; `dump-hybrid-state.php:90` sagt es ausdrücklich). `create_area` weist eine unbekannte oder inaktive Region stattdessen ab. |
> | Drahtfeld heißt `region_public_id` (`region_id` als Alias) | `create_region` gibt eine `public_id` zurück, keinen internen FK — und interne Ids verlassen die Box nirgends in diesem Haus. |
> | `ecosystem_geometry_audit_log` führt `area_public_id` / `region_public_id` als Spalten | Die politische Vorlage hält die Identität nur im `before_json`, weshalb dort „wer hat DIESE Fläche gelöscht" ein `JSON_EXTRACT`-Scan ist. |
>
> **Ein Commit statt drei:** die Bibliothek trägt V2.1, V2.2 und V2.3, und pfadgenaues
> Stagen kann eine Datei nicht teilen; eine halbe Bibliothek liefe nicht.
>
> ⭐ **Was V3 wissen muss.** Drahtformat ist **GeoJSON `[x, y]`, ungetauscht** — die
> Leaflet-Vertauschung `[lat,lng] = [y,x]` macht der Client, nicht die API. Offene Ringe
> schließt der Server. `create_area` verlangt `region_public_id`;
> `update_area_geometry`/`delete_area` verlangen `expected_revision` (fehlt → **400**,
> veraltet → **409**). Der Lesepfad liefert je Fläche `geometry_revision` — genau das muss
> der Client beim nächsten Speichern zurückschicken. `is_trial` steht per **DEFAULT 0** an
> der Fläche; „Erprobung läuft" ist `app_setting['ecosystem_trial']` (Default `'1'`).
> Der Schalter `ecosystem_enabled` ist seit der Abnahme **an**.

**Fertig, wenn:** Eine Fläche lässt sich per API anlegen, lesen, ändern und weich
löschen — **ohne Karte**, mit `curl` verifizierbar. Und der Kill-Switch lässt sich
**umlegen**, nicht nur lesen.

### Aufgabe V2.1 — Tabellen und Revisionszähler

**Dateien:** Erstellen `api/_internal/app/ecosystem.php` (Inline-DDL, selbstheilend)

```sql
CREATE TABLE IF NOT EXISTS ecosystem_region (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL DEFAULT '',
  kind VARCHAR(16) NOT NULL,               -- derographisch | vegetation | topographie
  region_type VARCHAR(40) NULL,
  origin VARCHAR(8) NOT NULL DEFAULT 'own',
  wiki_region_key VARCHAR(190) NULL,       -- IMMER via avesmapsPoliticalSlug(), s. u.
  wiki_url VARCHAR(500) NULL,
  label_public_id CHAR(36) NULL,           -- Bruecke zur map_features-Label-Zeile, s. u.
  properties_json JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ecosystem_region_public_id (public_id),
  KEY idx_ecosystem_region_kind_active (kind, is_active),
  KEY idx_ecosystem_region_wiki (wiki_region_key),
  KEY idx_ecosystem_region_label (label_public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecosystem_area (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  region_id INT UNSIGNED NOT NULL,
  geometry_geojson JSON NOT NULL,          -- Polygon ODER MultiPolygon (Owner-Entscheidung 1)
  min_x DECIMAL(10,4) NOT NULL, min_y DECIMAL(10,4) NOT NULL,
  max_x DECIMAL(10,4) NOT NULL, max_y DECIMAL(10,4) NOT NULL,
  geometry_revision INT UNSIGNED NOT NULL DEFAULT 1,
  is_trial TINYINT(1) NOT NULL DEFAULT 0,  -- Erprobungsphase, an der FLAECHE (s. u.)
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ecosystem_area_public_id (public_id),
  KEY idx_ecosystem_area_region (region_id, is_active),
  KEY idx_ecosystem_area_trial (is_trial, is_active),
  KEY idx_ecosystem_area_bbox (min_x, min_y, max_x, max_y)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecosystem_region_type (
  kind VARCHAR(16) NOT NULL,
  type_key VARCHAR(40) NOT NULL,
  label VARCHAR(190) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (kind, type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Eigener Zaehler. Spiegelt map_revision (api/_internal/map/features.php:2531-2545),
-- ist aber davon UNABHAENGIG -- das ist der ganze Zweck: ein Flaechen-Save darf die
-- ~29,65-MB-Payload (Feld `revision` im Payload-Kopf) nicht invalidieren.
CREATE TABLE IF NOT EXISTS ecosystem_revision (
  id TINYINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

```php
// Woertlich nach dem Muster von avesmapsNextMapRevision (features.php:2531).
function avesmapsNextEcosystemRevision(PDO $pdo): int {
    $pdo->exec('INSERT INTO ecosystem_revision (id, revision) VALUES (1, 2)
                ON DUPLICATE KEY UPDATE revision = revision + 1');
    $statement = $pdo->query('SELECT revision FROM ecosystem_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        throw new RuntimeException('Die Landschafts-Revision konnte nicht gelesen werden.');
    }
    return (int) $revision;
}

function avesmapsReadEcosystemRevision(PDO $pdo): int {
    $statement = $pdo->query('SELECT revision FROM ecosystem_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    return $revision === false ? 1 : (int) $revision;
}
```

**Sechs Abweichungen von der ersten Fassung — jede einzeln begründet:**

| # | | Warum |
|---|---|---|
| 1 | **`is_trial` sitzt auf `ecosystem_area`, nicht auf der Region** | Owner-Entscheidung 1: eine Region trägt mehrere Flächen. Auf der Region wäre `promote_trial discard` unbrauchbar — **eine** misslungene Fläche würde 40 gute derselben Region mitreißen, und eine bereits übernommene Region würde jede neue Fläche als „alt" ausgeben. |
| 2 | **`DEFAULT 0`, nicht `1`** | Ein `DEFAULT 1` überlebt die Erprobung: nach `promote_trial keep` steht alles auf 0, die nächste Fläche bekommt wieder eine 1, und ein zweiter `discard` — Monate später, aus einem Skript — löscht sie weich. Der Zustand „Erprobung läuft" gehört in **eine** Zeile: `app_setting['ecosystem_trial']`, vom Client beim Anlegen gelesen. |
| 3 | **`JSON` statt `LONGTEXT`** | Das **ganze Haus** speichert Geometrie als `JSON`: `map_features.geometry_json` (`sql/schema.sql:71`), `political_territory_geometry` (`api/_internal/political/territory.php:65`), `political_territory_derived_geometry` (`sql/schema.sql:440`), `adventure_place`/`citymap_place`. `LONGTEXT` kommt in `api/` zweimal vor und nie für Geometrie. MySQL validiert `JSON` beim Schreiben; `LONGTEXT` nimmt auch ein halbes Polygon — die Zeile existiert, die bbox ist gefüllt, die Fläche ist weg, und man kann in SQL **nicht einmal fragen, ob die Geometrie parst**. Mit `JSON` gibt es `JSON_VALID` und „stimmt die gespeicherte bbox noch zur Geometrie?". Nach Entscheidung 1 zusätzlich: `JSON_LENGTH` beantwortet „wie viele Teile hat diese Fläche?". |
| 4 | **`created_by`/`updated_by` als `BIGINT UNSIGNED`** | Eine `users.id`, wie im ganzen Haus (`sql/schema.sql:81–82`, `:381–382`). Der Audit-Leser holt den Namen per `LEFT JOIN users ON users.id = …` (`api/edit/map/audit-log.php:62`); ein `VARCHAR(190)`-Klartextname ist nicht joinbar, nicht umbenennbar und nimmt jeden Müll. |
| 5 | **`label_public_id` als Brücke** | Die 540 Landschafts-Labels existieren bereits als `map_features`-Zeilen mit Name, Position und Wiki-Bezug (Allowlist `api/_internal/map/features.php:767`). Ohne diese Spalte trägt „Farindel" seine Identität **zweimal**, mit zwei unabhängig pflegbaren Wiki-Links, und die einzige Brücke wäre Namensgleichheit — die in diesem Projekt keine Identität ist. Muster: `citymap_place.target_public_id`/`target_wiki_key` (`api/_internal/app/citymaps.php:192–193`). V5 und V8 brauchen sie. |
| 6 | **`idx_ecosystem_region_trial` entfällt**, `idx_ecosystem_area_trial` kommt | folgt aus 1. |

> ⚠️ **`wiki_region_key` ist keine freie Wahl.** Er wird **ausschließlich** über
> `avesmapsPoliticalSlug()` (`api/_internal/political/territory.php:1060`) →
> `avesmapsFoldToAscii()` (`api/_internal/text/ascii-fold.php:87`) abgeleitet — die feste
> Tabelle, die den **Server** nachbildet (Umlaute falten auf `'?'`: `Fürstentum Kosch` →
> `f-rstentum-kosch`). Nicht `iconv//TRANSLIT`, nicht „schöner". Wer das ändert, bricht
> jeden Join, der einen solchen Schlüssel benutzt (AGENTS.md §5, zwei Schutztests).
> Solange keine Aufgabe die Spalte **schreibt**, bleibt sie leer — das ist in Ordnung,
> aber sie darf nicht nebenbei anders befüllt werden.

**Keine Spalten für:** `min_zoom`/`max_zoom`, `parent_id`, `valid_from_bf`/`valid_to_bf`,
kein `relief`-Feld.

> 💣 **`CREATE TABLE IF NOT EXISTS` heilt nur den Erstfall.** Kommt später eine Spalte
> dazu, passiert **nichts** — auf einer Tabelle, die es schon gibt, ist die Anweisung ein
> No-op. Das Haus löst das mit einem `information_schema`-geführten `ALTER`; wer hier eine
> Spalte nachrüstet, muss dasselbe Muster benutzen und darf sich nicht auf die DDL
> verlassen. **Das ist der Grund, die sechs Punkte oben JETZT zu bauen und nicht später.**

**Vokabular als Seed** (drei getrennte Listen, keine gefilterte Gemeinsamkeitsliste):
- `derographisch`: region, insel, kontinent, sonstiges
- `topographie`: gebirge, see, meer, kueste, huegelland
- `vegetation`: wald, suempfe_moore, steppe, tundra, auenlandschaft, wueste, graslandschaft

> `tundra` ist dabei, obwohl es **0 Labels** hat: der Typ steht in der Allowlist
> (`api/_internal/map/features.php:767`) und kann jederzeit auftreten.
>
> 🪤 **`ebene` bleibt draußen — aber die Begründung hat sich geändert.** Die erste Fassung
> stützte sich auf „0 Labels, bestätigt". Am 2026-07-25 gemessen: **ein** Label trägt den
> Subtyp, **„Zwergenpforte"** (`735a89f2-…`), mit Wiki-Link. Der Typ bleibt trotzdem
> draußen — das Argument war nie die Stückzahl, sondern dass kein Faktor `ebene` von
> „normal" unterscheidet. **Folge, ausdrücklich in Kauf genommen:** die Zwergenpforte
> bekommt vorerst keine Landschaftsfläche. Sobald ein Tempofaktor sie rechtfertigt, ist es
> eine Seed-Zeile.
>
> `berggipfel` (34 Labels) und `fluss` (5) fehlen ebenfalls und bleiben es: Punkte
> bzw. Linien, keine Flächen. `berggipfel` gehört zu V8.

- [x] **Schritt 1:** DDL schreiben, Seed einspielen, beide Revisions-Funktionen.

      ⚠️ **Seed als `INSERT IGNORE`, nicht `ON DUPLICATE KEY UPDATE`.** Die Tabelle hat
      `is_active`; das im Repo häufigste Upsert-Muster (u. a. `app-setting.php:41–42`)
      würde jede Deaktivierung beim nächsten Endpunkt-Aufruf stillschweigend rückgängig
      machen. Vorbild für die richtige Form: `api/_internal/app/citymaps.php:1652`.

- [x] **Schritt 2: 🔧 DU (Owner):** Endpunkt einmal aufrufen, in phpMyAdmin prüfen:
      vier Tabellen, `ecosystem_region_type` hat **16** Zeilen (4 + 5 + 7).
- [x] **Schritt 3: Commit** — `feat(ecosystem): schema, type vocabulary and an independent revision counter`

### Aufgabe V2.2 — Öffentlicher Lesepfad mit eigenem ETag

**Dateien:** Erstellen `api/app/ecosystem-areas.php` — **zwei** Vorlagen, je eine Hälfte:

| Hälfte | Vorlage |
|---|---|
| Aufbau, Kill-Switch, Antwortform | `api/app/citymaps.php` |
| **ETag und 304** | **`api/app/map-features.php`** |

> 🪤 **`api/app/citymaps.php` hat gar kein ETag** (selbst nachgesehen: 0 Treffer für
> `ETag`/`304`/`If-None-Match`) — es antwortet immer mit dem vollen Katalog (`:75–83`).
> Die erste Fassung nannte es als alleinige Vorlage und hätte den Bauer bei genau der
> Sache leer ausgehen lassen, um die es geht.
>
> **`api/app/map-features.php` ist der einzige Endpunkt mit ETag — und er ist bbox-fähig**
> (`:132–142`). Er beantwortet die Frage „ETag global oder am bbox-Parameter?" mit
> **beidem** (`:225–228`):
>
> ```php
> $seed = (string)($queryParams['since_revision'] ?? '') . '|' . (string)($queryParams['bbox'] ?? '');
> return 'W/"mf-' . AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION . '-' . $revision . '-' . substr(hash('sha1',$seed),0,10) . '"';
> ```
>
> **Genau so hier:** `ecosystem_revision` × bbox-String. Ein ETag nur aus der Revision
> wäre für einen bbox-gefilterten Endpunkt falsch.

> 🔴 Der Kill-Switch wird **vor** dem Read geprüft — die Zeilen dürfen die Box nicht
> verlassen. Muster: `api/app/citymaps.php:43–45` (Kommentar `:40–42`), Verbindung eine
> Zeile davor (`:38`, `avesmapsCreatePdo` — im Schnipsel unten weggelassen, nicht vergessen).
>
> ⚠️ **Der Kill-Switch-Check ist selbst eine DDL-Runde.** `avesmapsAppSettingGet`
> (`api/_internal/app/app-setting.php:28–34`) ruft als **Erstes**
> `avesmapsAppSettingEnsureTable` (`:17–26`, `CREATE TABLE IF NOT EXISTS`) — auf einem
> öffentlichen Pfad, auch im ausgeschalteten Zustand. Das ist das Muster, das AGENTS.md §10
> als Hotspot führt und das M6 schon einmal entfernt hat („DDL out of cache-hit path").
> Hier tolerierbar, weil der Endpunkt selten und nur im Edit-Modus gerufen wird — **aber
> bewusst, nicht versehentlich.** Wird er je öffentlich, gehört der Check hinter den ETag.

```php
// Eigener Revisionszaehler, eigener ETag. NIEMALS avesmapsNextMapRevision() --
// das invalidiert die ~29,65-MB-Payload fuer jeden Besucher, und der Zeichenfeldzug sind
// ~2.000 Speichervorgaenge. Begruendung wortgleich in api/app/citymaps.php:13-14.
const AVESMAPS_ECOSYSTEM_SETTING = 'ecosystem_enabled';

// Default '0': AUS, bis der Owner ihn umlegt. avesmapsAppSettingGet nimmt den Default
// als ARGUMENT (app-setting.php:28) -- die "default-an"-Konvention bei :14-15 ist
// eine Empfehlung, kein Zwang.
if (avesmapsAppSettingGet($pdo, AVESMAPS_ECOSYSTEM_SETTING, '0') === '0') {
    avesmapsJsonResponse(200, ['ok' => true, 'areas' => [], 'ecosystem_enabled' => false]);
}
```

- [x] **Schritt 1:** Endpunkt mit bbox-Filter (`min_x/min_y/max_x/max_y`).

      🔴 **Der Read joint auf die aktive Region** (Owner-Entscheidung 1: `kind` steht auf
      `ecosystem_region`, nicht auf der Fläche):

      ```sql
      SELECT a.*, r.kind, r.name, r.region_type
        FROM ecosystem_area a
        INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
       WHERE a.is_active = 1 AND <bbox> ...
      ```

      Der `INNER JOIN` mit `r.is_active = 1` beantwortet zugleich „aktive Fläche unter
      gelöschter Region": **unsichtbar**. Hausmuster:
      `api/_internal/political/territories-derived-geometry-plan.php:238–241`,
      `territories-claims.php:199`. Nur `WHERE a.is_active = 1` wäre der Fehler.

- [x] **Schritt 2:** ETag = **`ecosystem_revision` × bbox-String** (Muster
      `map-features.php:225–228`, s. o.), 304 bei Übereinstimmung.
- [x] **Schritt 3: 🔧 DU (Owner):** Ohne Session, Flag noch nicht umgelegt:
      `{"ok":true,"areas":[],"ecosystem_enabled":false}`.
- [x] **Schritt 4: Commit** — `feat(ecosystem): public read endpoint with its own revision and kill switch`

### Aufgabe V2.3 — Schreibender Endpunkt

**Dateien:** Erstellen `api/edit/map/ecosystem.php` (Vorlage: `api/edit/map/citymaps.php`,
145 Z., POST-only, `match($action)`, Fähigkeitsprüfung an **einer** Stelle, **ohne**
DDL-Präambel)

Aktionen: `create_region`, `update_region`, `delete_region`, `create_area`,
`update_area_geometry`, `delete_area`, **`set_enabled`**, **`promote_trial`**.

> **`set_enabled` ist Pflicht, nicht Kür.** Ohne sie bleibt `ecosystem_enabled`
> für immer `'0'`, der Lesepfad dauerhaft leer und V3 nicht abnehmbar. Muster:
> `api/_internal/app/citymaps.php` (`set_citymaps_enabled`).

**Jede schreibende Aktion ruft am Ende `avesmapsNextEcosystemRevision($pdo)`** —
und **niemals** `avesmapsNextMapRevision`.

**Nicht** vom politischen Endpunkt übernehmen: `PATCH` für alles, DDL bei jedem
Aufruf, `getMessage()`-Lecks.

> 🔴 **Zwei Sachen, die die erste Fassung nicht hatte** (zweiter Prüfbericht C1/C2):
>
> **(a) Optimistischer Wächter auf `update_area_geometry` und `delete_area`.** Ohne ihn
> gewinnt bei zwei gleichzeitigen Speichervorgängen der zweite vollständig, der erste ist
> **weg — ohne Meldung, ohne Konflikt, ohne Spur.** Das ist kein Randfall: V3.0 zeigt alle
> drei Ebenen gleichzeitig, V3.6 kopiert, und der Plan rechnet mit ~2.000 Speichervorgängen.
> Der Client schickt `expected_revision`, der Endpunkt vergleicht gegen
> `ecosystem_area.geometry_revision` und antwortet bei Abweichung **409**, statt zu
> überschreiben. ~6 Zeilen, exakt das Muster von
> `avesmapsAssertFeatureCanBeEdited` (`api/_internal/map/features.php:1007–1011`). Sperren
> (`map_feature_locks`) sind für eine Erprobung mit zwei Editoren verzichtbar; der Wächter
> nicht — er ist der Unterschied zwischen „409, lad neu" und stillem Datenverlust. **Das
> gibt `geometry_revision` endlich einen Leser** (sonst ist die Spalte Dekoration).
>
> **(b) Audit-Log.** Beide geometrieführenden Nachbarn haben eins — `map_audit_log`
> (`sql/schema.sql:106`) und `political_territory_geometry_audit_log`
> (`api/_internal/political/territory.php:91`) —, und die Editor-Oberfläche „Änderungen"
> mischt **genau diese zwei und keine dritte** (`js/review/review-panels-change-log.js:42–45`).
> Ohne ein `ecosystem_geometry_audit_log` ist „wer hat diese Fläche gelöscht, und wie sah
> sie vorher aus?" nachts per SQL **nicht beantwortbar** — `updated_by` kennt nur den
> Letzten, und `delete_region` überschreibt ihn auf allen Flächen mit dem Bulk-Auslöser.
> `before_json`/`after_json`/`actor_user_id` wie die Vorbilder. **~40 Z.**, und sie gehören
> in V2.3, nicht in eine spätere Aufgabe — ein Save ohne Audit ist unwiederbringlich.

- [x] **Schritt 1:** Verteiler + `create_region` / `create_area`, je mit `curl`-Abnahme.

      🔴 **`create_area` verlangt eine `region_id`** (Owner-Entscheidung 1). Der Endpunkt
      prüft, dass sie auf eine **aktive** Region zeigt, sonst 400 — sonst entsteht eine
      Waise, die der Lesepfad-JOIN unsichtbar macht und die niemand je wieder findet.
      `create_region` gibt die neue `public_id` zurück, damit der Client sie an das
      folgende `create_area` hängen kann. **`geometry_geojson` nimmt Polygon UND
      MultiPolygon** — beim Schreiben validieren (`JSON_VALID` reicht nicht, GeoJSON-Form
      prüfen) und die bbox über **alle** Teile rechnen.

- [x] **Schritt 2:** `update_region` / `update_area_geometry` (bbox beim Schreiben über
      alle Teile mitrechnen, `geometry_revision` hochzählen, **`expected_revision`
      prüfen** — Wächter (a); Audit-Zeile schreiben — (b)).
- [x] **Schritt 3:** `delete_region` / `delete_area`, beide weich.

      🔴 **`delete_region` nimmt seine Flächen in EINER Transaktion mit** (`BEGIN` …
      `is_active=0` auf Region und ihren Flächen … `COMMIT`). Muster
      `api/_internal/app/adventures.php:1284–1293`. Ohne Transaktion bleibt bei einem
      Abbruch eine halb gelöschte Region zurück.

- [x] **Schritt 4:** `set_enabled` — schreibt `app_setting['ecosystem_enabled']`.
      ⚠️ `api/_internal/app/app-setting.php` **explizit requiren**: ein bloßer
      `function_exists`-Guard verschluckt den Schreibvorgang sonst lautlos (dieselbe
      Falle wie bei `lore-sync.php`).
- [x] **Schritt 5:** `promote_trial` — **auf `ecosystem_area`**, nicht auf der Region
      (Entscheidung 1): `keep` setzt `is_trial = 0` für alle Erprobungsflächen, `discard`
      löscht sie weich. Zwei Modi, ein Parameter. Zusätzlich: `app_setting['ecosystem_trial']`
      ausschalten, damit neue Flächen nicht wieder als Erprobung entstehen.
- [x] **Schritt 6: 🔧 DU (Owner):** Flag umlegen, Lesepfad prüft jetzt echte Zeilen.
      Zwei Editoren, dieselbe Fläche, zweiter Save mit veraltetem `expected_revision` →
      **409**, nicht stiller Verlust.
- [x] **Schritt 7: Commit** — `feat(ecosystem): write endpoint incl. optimistic guard, audit log, kill switch and trial promotion`

> **V2.4 „Quellen anschließen" ist als V4a hinter die Messung gewandert.** Begründung
> unter V4a am Ende des ersten Vorhabens — kurz: die Allowlist-Zeile öffnet zwei Löcher im
> Totmannschalter (Globale Regeln 3 und 4) und kauft vor V6 nichts, weil vor dem
> Landschaftseditor niemand eine Quelle anhängt.

---

# V3 — Zeichnen und Anzeigen

**Fertig, wenn:** Eine mit Klicks gezeichnete Fläche wird gespeichert, **nach einem
Reload wieder geladen und gezeichnet**, überlebt Kartenschwenk — und `git status`
zeigt **keine** politische Datei.

> 💣 **V3.0 ist neu und war die Lücke der ersten Fassung.** Ohne sie kann V3 sein
> eigenes Fertigkriterium nicht erfüllen: keine Aufgabe lud jemals vorhandene Flächen.
> Die Analyse hatte dafür eine eigene Stufe (§6, L2 „Darstellung", ~450 Z.); im
> Plan-Schnitt war sie ersatzlos verschwunden, und die Selbstprüfung merkte es nicht.

### Aufgabe V3.0 — Laden, Rendern und der Ebenen-Umschalter ✅ ERLEDIGT

> ✅ **Live seit 2026-07-26.** Commits `56bd2f91` (Kern), `f986c48b` und `52d47f9d`
> (Optik nach der Abnahme). **Abnahme durch den Owner:** drei per API angelegte Flächen,
> eine je Ebene, erscheinen nach Reload alle drei; Auswahl funktioniert in **allen drei**
> Ebenen („topographie(auswahl) geht, derographie(auswahl) geht", Vegetation nachgereicht);
> „standard → landschaften → standard" übersteht den Moduswechsel.
>
> 🪤 **Vier Stellen, an denen der Plan seine eigene Ansage verfehlt hätte:**
> 1. Schritt 3 verlangt Entdopplung nach `public_id`, `ecosystemLayers` war aber ein
>    **Array** (`runtime-state.js`). Jetzt eine `Map`.
> 2. `activeEcosystemLayerKind` mit „vegetation" vorbelegt wäre **nie ungültig** gewesen —
>    der localStorage-Lesepfad wäre nie erreicht worden und der Schalter hätte sein
>    Gedächtnis verloren. Startet leer; „vegetation" ist jetzt der Fallback des Lesens.
> 3. `pointer-events: none` auf der Pane genügt **nicht**. Leaflets eigene Regel
>    `.leaflet-pane > svg path.leaflet-interactive` schaltet Klicks bei Spezifität (0,2,2)
>    wieder an; der naheliegende Zwei-Klassen-Selektor verliert und die blassen Ebenen
>    schlucken weiter Klicks — genau der Fehler, gegen den die drei Panes existieren.
>    Der Selektor trägt deshalb `.leaflet-pane` mit.
> 4. **Deckkraft darf nicht an der Pane hängen.** Pane-Deckkraft *multipliziert* sich mit
>    der Füllung des Pfads; die Owner-Matrix unten nennt absolute Werte, „40 %" wäre also
>    40 % von etwas anderem geworden. Füllung/Kontur sitzen auf den **Pfaden**, die Pane
>    trägt nur die Zustandsklasse — `pointer-events` bleibt Pane-Eigenschaft, und
>    Umschalten baut weiterhin keinen Layer neu.
>
> **Optik-Matrix, Owner 2026-07-26** (Füllung / Kontur), in `css/features/ecosystem-layer.css`
> als **eine** Tabelle aus vererbten Custom-Properties — nicht ein zweites Mal in JS:
>
> | | ruhend | aktiv | ausgewählt |
> |---|---|---|---|
> | derographisch | 0 % / 70 % | 40 % / 70 % | 70 % / 100 % |
> | vegetation | 50 % / 70 % | 70 % / 80 % | 90 % / 100 % |
> | topographie | 50 % / 70 % | 70 % / 80 % | 90 % / 100 % |
>
> Eine ruhende derographische Fläche ist **nur Kontur**: sie markiert einen Behälter, und
> ein Behälter darf die Karte nicht einfärben, auf der jemand anderes zeichnet. Auswahl ist
> ein Deckkraft-Schritt, kein zweiter Farbton. Farben: derographisch **grau**, topographie
> **braungrau** (Platzhalter bis zur Höhenkarte, hoch → weiß), vegetation **ein Ton je
> `region_type`** (Wald/Auen/Gras/Steppe/Wüste/Sümpfe/Tundra), per Regel aus dem `type_key`
> aufgelöst — ein neu gesäter Typ braucht nur seinen Token, keine Liste im Client.
>
> 🪤 **Verifikationsfalle, zweimal reingefallen:** Die `fill-opacity`/`opacity`-Übergänge
> **frieren im unsichtbaren MCP-Browser-Pane ein**, `getComputedStyle` liefert dort den
> START-Wert. Wer die Matrix nachmisst, schaltet den Übergang für die Messung ab.

**Dateien:** Erstellen `js/map-features/map-features-ecosystem-loader.js`,
`js/map-features/map-features-ecosystem-rendering.js`,
`js/map-features/map-features-ecosystem-layer-switch.js`;
ändern `index.html` (Anker: `<div id="political-timeline">`), `js/app/runtime-state.js`

> 🔴 **Alle drei Ebenen sind von Anfang an sichtbar** (Owner-Entscheidung). Das ist
> keine Bequemlichkeit, sondern der Trick, mit dem Überlappung harmlos wird:
>
> | | Darstellung | nimmt Klicks |
> |---|---|---|
> | **aktive** Ebene | voll, mit Griffen | **ja** |
> | die beiden **ruhenden** | blass, ohne Griffe | **nein** |
>
> Man zeichnet das Gebirge und **sieht dabei**, wo der Wald liegt — aber es entsteht
> nie die Frage „welches Polygon habe ich erwischt", weil immer nur eine Ebene
> antwortet. Technisch: `pointer-events: none` plus halbe Deckkraft auf den ruhenden
> Panes.

**Der Umschalter sitzt dort, wo im politischen Modus der Jahres-Slider steht.**
`#political-timeline` hängt an `getSelectedMapLayerMode() === "political"`
(`js/map-features/map-features-political-timeline.js:9`) — der neue Segmentschalter
bekommt dieselbe Stelle mit der Gegenbedingung `=== "ecosystem"`. Beide sind damit nie
gleichzeitig da, und es gibt keinen Layoutsprung.

> 🔴 **Die Vorlage hat ZWEI Sichtbarkeits-Tore, nicht eins** (Totmannschalter-Stelle 6):
> `map-features-political-timeline.js:19` — `showTimeline = isPoliticalMode && (interactive || readOnly)`,
> `interactive` = `IS_EDIT_MODE || …` (`:15`). Der Segmentschalter braucht die
> Gegenbedingung **und** das Edit-Tor: `mode === "ecosystem" && IS_EDIT_MODE && IS_ECOSYSTEM_ENABLED`.
> Nur `mode === "ecosystem"` würde ihn einem anonymen Besucher zeigen, der per fremdem
> Link in den Modus geraten ist.
>
> 💣 **§12: der Segmentschalter erbt keine Farbe von der Vorlage.** `political-timeline.css:15–20`
> kodiert `#b79d7d`, `rgba(250,243,236,0.96)`, `#3f3428`, `border-radius: 8px`, `z-index: 1000`
> **hart** — wer „dieselbe Stelle" kopiert, kopiert fünf §12-Verstöße mit. Der Schalter
> nimmt Tokens (`--color-*`, `--radius-md`, `--z-map-ui` = `css/base/tokens.css:249`,
> Fokus `--color-focus`/`--focus-ring` `:194–197`). Rollenmodell: `role="tablist"` mit
> `aria-label` und Pfeiltasten-Navigation — zwei Vorlagen im Haus, `index.html:935`
> (`region-sync__viewtabs`) und `:1267` (`political-territory-tabs`). Tastaturbedienung ist
> bei einem Werkzeug, das 500-mal benutzt wird, keine Kür.

> **Drei Panes, nicht eine.** V1.3 legt `ecosystemPane` bei z-index 250 an; hier kommen
> `ecosystemPaneDerographisch` (250), `-Vegetation` (251) und `-Topographie` (252)
> dazu. Anders ließe sich „aktiv voll, ruhend blass **und** klickdurchlässig" nicht
> sauber trennen — `pointer-events` ist eine Pane-Eigenschaft, keine Layer-Eigenschaft.
> 201–299 ist frei, die nächste Belegung liegt bei 300.

- [x] **Schritt 1:** Segmentschalter „Derographische Region · Vegetation · Topographie"
      neben `#political-timeline` einfügen, sichtbar nur bei `mode === "ecosystem"`.
      Aktive Ebene in `activeEcosystemLayerKind` (`runtime-state.js`), gemerkt in
      `localStorage`; beim ersten Mal **Vegetation** (dort liegt die meiste Arbeit).
- [x] **Schritt 2:** Loader — `fetch` auf `api/app/ecosystem-areas.php` mit der
      aktuellen bbox, nur wenn `getSelectedMapLayerMode() === "ecosystem"`. Holt
      **alle drei** `kind` in einem Aufruf, nicht drei Aufrufe.
- [x] **Schritt 3:** An `moveend` und `zoomend` hängen, mit **eigenem** Debounce.
      🔴 **Nicht** `schedulePoliticalTerritoryLayerReload` mitbenutzen.

      💣 **Vor dem Rendern entdoppeln — nach `public_id`.** Das politische Vorbild räumt
      bei **jedem** `moveend` alles ab (`clearRenderedRegionLayers`,
      `map-features-region-rendering.js:150–163`); V1.3 verbietet, das mitzunehmen (es
      fasst `regionPolygons` an), nennt aber keinen Ersatz. Ohne Schlüsselung nach
      `public_id` liegt nach dem dritten Schwenk **jede Fläche dreimal** in
      `ecosystemLayers` — der Ruckler, der bei Fläche 5 keiner sieht und bei 300 alle. Also:
      geladene Flächen nach `public_id` in einer Map halten, beim Reload nur Neues rendern
      und Verschwundenes entfernen.
- [x] **Schritt 4:** Rendern in die Pane des jeweiligen `kind`, Layer in
      `ecosystemLayers` registrieren. Farbe je `kind` (drei Töne aus
      `css/base/tokens.css`; bei Bedarf Token **anlegen**, nie Hex hartkodieren —
      AGENTS.md §12).
- [x] **Schritt 5:** Umschalten setzt `pointer-events` und Deckkraft der drei Panes —
      **ohne** neu zu laden und **ohne** eine laufende Bearbeitung zu verwerfen. Eine
      offene Bearbeitung wird vorher abgeschlossen und gespeichert.
- [x] **Schritt 6:** Beim Verlassen des Modus aufräumen — eigene Registry leeren,
      `regionPolygons` **nicht anfassen**.
- [x] **Schritt 7: 🔧 DU (Owner):** Drei per `curl` angelegte Flächen (eine je Ebene)
      erscheinen nach Reload **alle drei**, zwei davon blass. Umschalten wechselt,
      welche voll ist. Ein Klick auf eine blasse Fläche wählt sie **nicht** aus.
      Schwenken und Moduswechsel hin und zurück überstehen es.
- [x] **Schritt 8: Commit** — `feat(ecosystem): load and render all three layers, with the active one in front`

### Aufgabe V3.0b — Regionsauswahl (Owner-Entscheidung 1) ✅ ERLEDIGT, Oberfläche zieht um

> ✅ **Live seit 2026-07-26**, Commits `6468f454` und `6808a11f`. Owner hat Region
> „Farinedel" (Vegetation) angelegt und drei Flächen hineingehängt; sie hängen alle an
> derselben Region.
>
> 🔴 **Owner-Entscheidung 2026-07-26, direkt nach der Abnahme:** *„die ‚aktive Region…' und
> ‚neue Region' braucht es nicht oben bei der Toggle-Auswahl. Wir haben in der seitlichen
> Liste ja schon eine komplette Übersicht über alle Regionen, du kannst dich gern dessen
> bedienen und die Anzeige erweitern / ergänzen (z. B. Farindelwald automatisch selektieren
> + Flächen listen)."*
>
> Die **Kopfleisten-Auswahl entfällt damit** — sie war ausdrücklich „der herausgelöste,
> unverzichtbare Kern von V6", und V6 hat jetzt eine Heimat: die Liste **WikiSync →
> Regionen** (`js/review/review-region-sync.js`, 457 Z., Endpunkt
> `/api/edit/wiki/regions.php`, 1843 Regionen · 543 Karten-Labels). ⚠️ **Nicht löschen,
> bevor der Ersatz steht:** ohne eine Zielregion kann V3.2 keine Fläche anlegen
> (`create_area` weist eine fehlende `region_public_id` mit 400 ab).
>
> ⭐ **Die Brücke existiert schon und ist geprüft.** `ecosystem_region.wiki_region_key`
> entsteht seit diesem Commit serverseitig über die **wortgleiche Abschrift** von
> `avesmapsPoliticalSlug` — dieselbe Ableitung, die `wiki_region_staging.wiki_key`
> geschlüsselt hat (`api/_internal/wiki/regions.php:507`). Eine Wiki-Regionszeile und eine
> Landschaftsregion sind also **heute schon über einen Gleichheitsvergleich** verbindbar,
> ohne neue Spalte und ohne zweite Ableitung. Der Unit-Test vergleicht beide Ableitungen
> über 18 Eingaben (Umlaute, ß, Akzente, leer, überlang) — er ist das Einzige, was die
> Abschrift vor stillem Auseinanderdriften schützt.
>
> **Was bleibt und weiterbenutzt wird:** die Aktion `list_regions`
> (`api/edit/map/ecosystem.php`, fähigkeitsgeprüft, liefert die aktiven Regionen eines
> `kind` mit Flächenzahl **plus** die `region_type`-Wortliste), `activeEcosystemRegionId`
> (je `kind`, localStorage) und die Revisions-Invalidierung: jeder Schreibvorgang hebt
> `ecosystem_revision`, der Flächen-Loader sieht das im Payload-Kopf und holt die
> Regionsliste genau dann neu — sonst nie. Ohne die stand nach zwei gezeichneten Flächen
> weiter „0 Flächen" in der Zeile.

**Dateien:** Erstellen `js/map-features/map-features-ecosystem-region-picker.js`;
ändern `index.html` (Anker: der Segmentschalter aus V3.0)

> 🔴 **Ohne diese Aufgabe erzeugt V3.2 namenlose Geometrie.** Entscheidung 1 („eine
> Region trägt mehrere Flächen") heißt: der Zeichenvorgang muss wissen, in **welche**
> Region die neue Fläche geht. `create_area` verlangt eine `region_id` (V2.3 Schritt 1);
> der volle Landschaftseditor mit drei Spalten (V6) ist **nicht** Teil dieses Vorhabens.
> Diese Aufgabe ist das Minimum, das V3 sein Fertigkriterium („eine **benannte** Fläche")
> überhaupt erreichbar macht — der herausgelöste, unverzichtbare Kern von V6.

**Verhalten:** Neben dem Segmentschalter eine schmale Auswahl **„aktive Region"** für den
gerade aktiven `kind`. Zwei Wege, mehr nicht:

- **bestehende Region wählen** — Liste der aktiven Regionen dieses `kind`
  (`GET`-Ergänzung am Lesepfad oder eigener schlanker Endpunkt; **nicht** den Politik-Layer
  fragen). Eine neu gezeichnete Fläche hängt sich an die aktive Region.
- **neue Region anlegen** — kleiner Dialog: Name (Pflicht), `region_type` (aus
  `ecosystem_region_type` für diesen `kind`), optional Wiki-Zuweisung. Ruft
  `create_region`, macht die neue Region sofort zur aktiven.

- [x] **Schritt 1:** Auswahl-Element + „neue Region"-Dialog, token-basiert, tastaturbedienbar,
      i18n-Schlüssel für die neuen Strings (`js/app/i18n-en.js`).
- [x] **Schritt 2:** `activeEcosystemRegionId` in `runtime-state.js`, je `kind` getrennt
      gemerkt (Wechsel des Segmentschalters wechselt auch die aktive Region), in
      `localStorage`.
- [x] **Schritt 3:** Wiki-Zuweisung schreibt `wiki_region_key` **ausschließlich** über
      `avesmapsPoliticalSlug()` (serverseitig, im `create_region`/`update_region`-Handler)
      — nie im Client slugifizieren (AGENTS.md §5).
- [x] **Schritt 4: 🔧 DU (Owner):** Neue Region „Farindel" (Vegetation) anlegen, zwei
      getrennte Flächen hineinzeichnen (V3.2), Reload — **beide** hängen an derselben
      Region, tragen denselben Namen. Region wechseln, dritte Fläche zeichnet in die andere.
- [x] **Schritt 5: Commit** — `feat(ecosystem): pick or create the region a drawn area belongs to`

> **Rückweg aus der falschen Ebene** (zweiter Prüfbericht C6): Diese Aufgabe liefert ihn
> nicht vollständig — Verschieben einer Fläche zwischen Ebenen bleibt V3.6 („Senden an …")
> + Löschen. Was sie liefert, ist die **Auswahl vor** dem Zeichnen, sodass der häufige
> Fall (falsche Ebene aktiv) gar nicht erst entsteht. Ein `delete_area`-Knopf am
> Kontextmenü der Fläche (V3.4) schließt den Rest — ✅ **gebaut und abgenommen 2026-07-26**.

### Aufgabe V3.1 — Geometriehelfer, ringfähig von Anfang an ✅ ERLEDIGT

> ✅ **Live seit 2026-07-26, Commit `491e8562`.** Test:
> `node js/map-features/__tests__/ecosystem-geometry.test.js`.
>
> 🪤 **Die Hälfte dieser Aufgabe war schon gebaut.** Das geforderte „`inPoly` über alle
> Ringe, Außen/Loch nach GeoJSON" ist `pointInGeometry`
> (`js/map-features/map-features-point-in-polygon.js`): loch- und multipolygonfähig,
> abhängigkeitsfrei, unit-getestet („in hole => outside") und von `index.html` bereits
> geladen. Ein zweites Punkt-in-Polygon wäre genau die Dublette gewesen, vor der
> AGENTS.md warnt — die Ebene benutzt das vorhandene, der neue Test prüft es gegen die
> Anforderung des Plans, und gebaut wurde nur, was fehlte. **Merke für die Folgeaufgaben:
> Die Bestandsprüfung gehört VOR das Schreiben, nicht danach.**
>
> 💣 **Die Plausibilitätsprüfung der Reparatur liegt auf den GRENZEN, nicht auf der
> Fläche.** Die Schleifen-Fläche („bowtie") hat als Shoelace-Wert die **Differenz** ihrer
> beiden Lappen — bei gleich großen Lappen also 0 —, während die korrekte Reparatur ihre
> **Summe** liefert (im Test 50). Eine Regel „das Ergebnis darf nicht größer werden" würde
> also genau den Fall abweisen, für den die Funktion existiert. Was nicht passieren kann:
> dass das Ergebnis die Bounding-Box der Eingabe verlässt.

**Dateien:** Erstellen `js/map-features/map-features-ecosystem-geometry.js`
(Vorlage **lesen**: `map-features-region-geometry-helpers.js`, 405 Z. → ~180 Z.)

> 💣 **Multipolygone und Löcher von Anfang an.** Der Prototyp
> (`landschaften-modell.html`) arbeitet mit **einem** Ring (`inPoly` :381,
> `distEdge` :389). Das reicht für eine Vorführung, nicht für den Farindel:
>
> | Funktion | muss | sonst |
> |---|---|---|
> | `inPoly` | über alle Ringe, Außen/Loch nach GeoJSON | eine Lichtung zählt als Wald |
> | `distEdge` | Minimum über **alle** Ringe, auch Lochränder | ein Buckel ragt ins Loch → Höhe am Lochrand ≠ 0 → Klippe. Bricht die Invariante, auf der das ganze Höhenfeld ruht — und fällt erst bei Flächen mit Löchern auf, also spät. |

**Nicht mitkopieren:** `applySharedBoundaryVertexMove` — Landschaften erben nichts, und
ein Waldrand ist keine geteilte Grenze. Überlappung und Verschachtelung sind **erlaubt
und normal** (Schneckenkamm liegt in den Windhagbergen).

⚠️ `polygon-clipping` **wirft** bei degenerierter Geometrie (selbst gemessen). Ein
`try/catch` plus eine Plausibilitätsprüfung (Flächenvergleich, Muster
`map-features-region-boolean-geometry.js:37–63`) gehören von Anfang an dazu.

- [x] **Schritt 1: Test für Ringfähigkeit** — Punkt in der Lichtung ist **draußen**;
      `distEdge` nahe dem Lochrand ist **klein**, nicht groß.
- [x] **Schritt 2–4:** Implementieren, Test grün, Namensprüfung per `grep`.
- [x] **Schritt 5: Commit** — `feat(ecosystem): ring-aware geometry helpers (holes and multipolygons)`

### Aufgabe V3.2 — Klick-für-Klick-Zeichenwerkzeug ✅ ERLEDIGT

> ✅ **Live seit 2026-07-26, Commit `1a825a2e`.** **Abnahme durch den Owner:** Escape lässt
> nichts liegen — der Lesepfad meldete nach dem Abbruch unverändert 6 Flächen bei 6
> gezeichneten, Server und Karte also einig; und „Fläche zeichnen geht".
>
> 💣 **Ein Doppelklick feuert `click, click, dblclick`.** Ungebremst setzt die
> Abschlussgeste zwei zusätzliche Ecken, die zweite ein Pixel neben der ersten — ein Sporn
> an **jeder** Fläche. Der Echo-Klick wird nach Ort und Zeit verworfen (< 350 ms, ≤ 6 px),
> `doubleClickZoom` ist für die Dauer aus, sonst zoomt der Abschluss mit.
>
> 💣 **Ein Klick auf eine BESTEHENDE Fläche ist beim Zeichnen eine Ecke, keine Auswahl.**
> Der Klick-Handler der Fläche steigt in diesem Zustand früh aus — ohne auszuwählen **und
> ohne das Ereignis zu stoppen**, sonst ließe sich nie über eine vorhandene Fläche
> zeichnen. Überlappung und Verschachtelung sind hier der Normalfall (Schneckenkamm liegt
> in den Windhagbergen), nicht die Ausnahme.
>
> ⭐ **Ohne aktive Region führt der Abschluss in den Dialog und HÄLT den Umriss fest** —
> nicht in einen Save, den der Server mit 400 beantwortet. Nach `create_region` wird
> gespeichert; auch ein fehlgeschlagener Save behält den Umriss, damit eine andere Region
> gewählt werden kann, statt neu zu zeichnen.
>
> ⚠️ **Für V3.3:** die Griffe NICHT direkt aus dem Abschluss öffnen — der zweite Klick des
> abschließenden Doppelklicks träfe einen gerade erschienenen Griff, und dessen Vorlage
> löscht bei Doppelklick eine Ecke und speichert.

**Dateien:** Erstellen `js/map-features/map-features-ecosystem-draw.js`
(Vorlage **lesen**: `js/map-features/map-features-path-creation.js:58–104`)

> 🔴 **Die teuerste Einzelentscheidung des Vorhabens.** Es gibt heute **kein**
> Zeichenwerkzeug: `createRegionAt()` (`map-features-region-crud.js:158`) legt ein
> Sechseck mit `radius = 10` an, speichert sofort und erzwingt bei `:159`
> `setSelectedMapLayerMode("political")`. Wer den Farindel damit umfährt, verbiegt
> sechs Ecken und teilt Kanten — 3–5 Minuten je Fläche, also 42 Stunden für 500.
> Klick-für-Klick sind 1–2 Minuten, also 17.

**Verhalten:** Klick setzt einen Punkt, Vorschaulinie läuft mit, **Doppelklick oder
Enter** schließt ab, **Escape** bricht ab. Gespeichert wird **erst beim Abschluss** —
damit entstehen keine „Sechseck-Leichen".

> 💣 **Zwei Dinge, die die Vorlage NICHT liefert:**
> 1. **Die mitlaufende Vorschaulinie ist Neubau.** `path-creation.js:58–104` hat **keinen**
>    `mousemove`-Handler; `updatePendingPathCreationLine()` (`:36–56`) zeichnet nur durch
>    die **bereits gesetzten** Punkte, `handlePendingPathCreationClick` hängt an
>    `map.on("click")` (`:71`). Das Gummiband gegen die Mausposition muss selbst gebaut
>    werden — und es ist der Teil, der das Zeichnen erträglich macht.
> 2. **Die Vorlage ist blau.** `#1452F7` **hart** bei `:28` und `:48` — wörtlich kopiert
>    wandert das in die neue Ebene, gegen AGENTS.md §12. Farbe aus einem Token.
>
> ⚠️ **Doppelklick-Kollision.** V3.3 baut den Vertex-Editor nach einer Vorlage, deren
> Doppelklick eine **Ecke löscht und speichert** (`edit-handles.js:62–66`, `:84–97`).
> Öffnet der Zeichen-Abschluss sofort die Bearbeitung (`region-crud.js:199` tut das), kann
> der zweite Klick des abschließenden Doppelklicks den frisch erschienenen Griff treffen.
> Abschluss und Editier-Öffnung entkoppeln (ein Tick Verzögerung, oder Editor erst bei
> nächstem Einzelklick).

- [x] **Schritt 1–6:** Analog `startPathCreationAt`, aber ohne Graph-Knoten-Bindung und
      mit Polygon-Abschluss (mindestens drei Punkte). Die neue Fläche bekommt die
      `region_id` der **aktiven Region** (V3.0b); ist keine aktiv, führt der Abschluss in
      den „neue Region"-Dialog statt in einen fehlschlagenden Save.
- [x] **Schritt 7: 🔧 DU (Owner):** Eine Fläche zeichnen, mit Escape abbrechen — es
      darf **nichts** im Bestand liegen (`curl` auf den Lesepfad).
- [x] **Schritt 8: Commit** — `feat(ecosystem): click-to-draw polygons instead of nudging a hexagon`

### Aufgabe V3.3 — Vertex-Editor: gebündelt speichern, Undo ✅ ERLEDIGT

> ✅ **Live seit 2026-07-26**, Commits `22eaa047` (Kern) sowie `56f14662`, `6964faed`,
> `ca6dcf95`, `40460668`, `fb20099a` und `298413ef` (Owner-Nachbesserungen nach der Sicht auf
> der Live-Seite). **Abnahme durch den Owner:** *„strg-z verhält sich jetzt glaub richtig, wir
> können weitermachen."*
>
> 🔴 **Der Schnipsel unten war FALSCH und still gefährlich.** Er rief `isTextEditingTarget` —
> die Funktion heißt `isTextEditingShortcutTarget` (`review-panels-change-log.js:355`). Wörtlich
> übernommen wirft der Capture-Listener einen ReferenceError **vor** `preventDefault()`, die
> Taste fällt zur jQuery-Bindung durch, und Strg+Z macht während einer Geometrie-Bearbeitung
> serverseitig den letzten Änderungs-Log-Eintrag rückgängig statt einen Eckzug. Kein Fehler auf
> dem Bildschirm, echter Datenverlust woanders. Der Schnipsel ist unten korrigiert.
>
> **Vier Owner-Entscheidungen haben diese Aufgabe während der Umsetzung verändert** — die
> Absätze darunter sind entsprechend berichtigt, damit der Plan nicht das Gegenteil des Codes
> behauptet:
>
> 1. **Die „ruhige Statuszeile" entfällt.** Ein eigener Chip wurde gebaut und wieder entfernt:
>    *„dein neues toast-system ist albern, du hättest die normalen toasts/chips verwenden
>    können."* Meldungen laufen über `showFeedbackToast`; die Griffe auf der Karte sind die
>    Dauer-Anzeige „hier wird bearbeitet", eine zweite daneben ist Möblierung.
> 2. **Bearbeiten hängt am DOPPELKLICK auf die Fläche, nicht an der Auswahl** (einfacher Klick
>    wählt nur aus, Doppelklick daneben beendet, ESC oder Klick auf leere Karte lässt los).
>    Das löst zugleich die Kollision, vor der V3.2 warnt: bei „Auswahl öffnet die Griffe" hebt
>    der ERSTE Klick eines Doppelklicks die Griffe und der zweite landet auf einem gerade
>    erschienenen — und Doppelklick auf einen Griff löscht eine Ecke.
> 3. **Strg+Z verlässt das Audit-System ganz.** Owner-Regel: *„das audit system … kann von jedem
>    rückgängig gemacht werden -> aber NUR durch den klick auf ‚Rückgängig', nicht mit strg-Z."*
>    Die jQuery-Bindung in `bootstrap.js` ist entfernt, ebenso `handleChangeLogUndoShortcut`,
>    `undoLastChangeLogEntry` und `getLatestUndoableChangeLogEntry`. 💣 Grund aus der Praxis:
>    „der neueste noch rückgängig-machbare Eintrag" rückt weiter, sobald einer als erledigt
>    markiert ist — drei Anschläge fraßen sich **abwärts durch die Historie**, zwei davon in
>    fremde Ortsänderungen. Ein „Wiederherstellen"-Knopf an `undo_*`-Einträgen ist nachgerüstet
>    (`63e2d35e`, `e63c7d20`); der gehört nicht in diesen Plan, sondern ins Audit-System.
> 4. **Strg+Klick auf eine Kante setzt VIER Ecken** (Vorlagen-Körnung), **Doppelklick auf eine
>    Kante setzt EINE** genau dort. Damit ist der Einwand des Plans („vier ist die falsche
>    Körnung") beantwortet statt überstimmt: vier ist nicht mehr die einzige Option.
>
> 🪤 **Zwei Dinge, die nur der Browser zeigen konnte:**
> 1. **Löschen hängt an einem NATIVEN `dblclick`-Listener.** Leaflet liefert Markerereignisse
>    über den Kartencontainer aus, also schneidet das nötige `disableClickPropagation` die
>    Leaflet-Ebene vorher ab. Deshalb trägt die Vorlage **beide** Listener
>    (`edit-handles.js:62` und `:72`) — nur der native läuft. Wer beim Abschreiben „die
>    Dublette aufräumt", baut ein stumm kaputtes Löschen.
> 2. **Kein Loader-Haken für „mein Layer wurde neu gebaut" nötig** — er wäre toter Code.
>    `removeEcosystemAreaLayer` wählt bereits ab, und das Abwählen schließt die Sitzung **mit
>    Flush**. Genau das rettet die Ecke, die kurz vor dem Wegschwenken gezogen wurde.
>
> 💣 **Die Bündel-Falle, die der Plan richtig vorhergesagt hat:** Nach jedem Save ist
> `geometry_revision` serverseitig eins höher. Der zweite gebündelte Save derselben Sitzung
> **muss** den neuen Wert schicken — aus `result.area.geometry_revision`, nie aus dem Loader.
>
> ⚠️ **Beim Zeichnen und Bearbeiten ist der Rest der Karte klickdurchlässig** (`fb20099a`,
> Owner): Flüsse und Labels bleiben sichtbar, fangen aber keine Klicks mehr ab. Nicht nur die
> Labels lagen im Weg — Griffe liegen bei z 520, darüber `marker-pane` 600 und `labels-pane`
> 650, darunter aber über den Flächen Wege 400 / Route 450 / Orte 500, die den Strg-Klick auf
> eine Kante stehlen. Regel deshalb „alle Panes aus, drei zurückgeben", nicht eine Pane-Liste.
>
> 🔧 **Bewusst NICHT gebaut:** „Strg beim Ziehen eines Vertex löst vom Snap" (Owner-Wunsch,
> Territorien-Verhalten). Es gibt in dieser Ebene **kein Snapping**, also nichts zu lösen;
> Owner am 2026-07-26: *„snapping brauchen wir erstmal nicht."* Die Anforderung ist im Kopf von
> `map-features-ecosystem-edit.js` vermerkt, samt der Kollision: Strg auf einer KANTE heißt
> „vier Ecken", Strg auf einem GRIFF soll „Snap ignorieren" heißen.

**Dateien:** Erstellen `js/map-features/map-features-ecosystem-edit.js`

Drei Abweichungen von der Vorlage, alle gemessen begründet:

- **Gebündeltes Speichern.** Heute ist jede gezogene Ecke ein eigener POST plus ein
  Toast (2.200 ms Standzeit, **ein** Platz — `map-features.js:181`), und
  `edit-handles.js:56–59` speichert zusätzlich **jede** vom
  `applySharedBoundaryVertexMove` betroffene Nachbarregion. Hier: **800 ms nach dem
  letzten Loslassen**, ein Schreibvorgang. ~~Zustand in einer ruhigen Statuszeile.~~
  **Berichtigt (Owner, Entscheidung 1 oben):** Zustand über den **Haus-Toast**
  `showFeedbackToast`, kein eigenes Bauteil. Der ursprüngliche Absatz verwies auf
  `#open-path-ends-chip` als Vorbild zum Wiederverwenden-oder-exakt-Nachbauen; nachgebaut
  wurde er und flog wieder raus. Es sind kurze, seltene Meldungen — und die Griffe auf der
  Karte sind bereits die Dauer-Anzeige „hier wird bearbeitet".
- ~~**Strg+Klick auf eine Kante setzt EINE Ecke.**~~ **Berichtigt (Owner, Entscheidung 4
  oben): ZWEI Körnungen, zwei Gesten.** **Strg+Klick setzt VIER** — die Vorlagen-Körnung
  (`subdivideRegionEditHoveredEdge`, `edge-controls.js:209`, Aufrufe `:67`/`:171`; zur
  Laufzeit wirksam ist `map-features-region-vertex-detach-edit.js:461`) —, **Doppelklick auf
  die Kante setzt EINE**, genau an der gezielten Stelle. Der ursprüngliche Einwand richtete
  sich dagegen, dass vier die *einzige* Option ist; mit beiden Gesten trifft er nicht mehr zu.
  Die überfahrene Kante wird gestrichelt markiert (mit Strg zusätzlich die Vierer-Vorschau),
  und zwar die ganze Sitzung lang — die Vorlage zeigt sie nur bei gedrücktem Strg (`:33`),
  was reicht, solange Strg die einzige Kantengeste ist.
- **Undo-Stapel**, 20 Schritte, im Speicher. Jedes Undo, das eine bereits geschriebene
  Geometrie ändert, löst einen **neuen** Save aus; ein Undo über den letzten Save hinaus
  (Stapel leer) ist ein No-op. Ein Vierer-Fächer geht als **ein** Schritt zurück.

> 🔴 **Strg+Z ist im Edit-Modus bereits vergeben.** `handleChangeLogUndoShortcut`
> (`js/review/review-panels-change-log.js:364–376`) macht den letzten
> Änderungs-Log-Eintrag **serverseitig** rückgängig und konsumiert die Taste mit
> `preventDefault()` + `stopPropagation()`. Gebunden bei `js/app/bootstrap.js:430–433`
> per **jQuery, also Bubble-Phase**.
>
> ~~**Entscheidung (Owner):** Strg+Z gehört dem Geometrie-Stapel **nur, solange eine
> Landschaftsfläche in Bearbeitung ist** — sonst weiter dem Audit-Undo.~~
>
> 🔴 **ÜBERHOLT (Owner 2026-07-26, Entscheidung 3 oben): Strg+Z erreicht das Audit-System
> überhaupt nicht mehr.** Die jQuery-Bindung ist entfernt. Die Taste gehört jetzt der ganzen
> Landschaften-Ebene: mit offener Bearbeitung nimmt sie einen Eckzug zurück, ohne sagt sie
> ausdrücklich, dass **nichts** passiert ist. Grund für „ganze Ebene statt nur offene Sitzung":
> ein Anschlag kurz nach dem Abwählen fiel sonst durch — daneben greifen kostet hier nichts und
> dort etwas Unwiederbringliches.
>
> **Umsetzung:** ein nativer `keydown`-Listener in der **Capture-Phase** auf `document`, der
> `stopImmediatePropagation()` ruft — dasselbe Muster wie
> `map-features-settlement-context-action.js:114–116` (dort ein Klick; die Phase ist der Punkt).
> Heute konkurriert nichts mehr um die Taste; die Capture-Phase bleibt, damit ein später
> hinzugefügter Handler nicht still Eckzüge geschenkt bekommt.

```js
// map-features-ecosystem-edit.js -- KORRIGIERTE Fassung (die urspruengliche rief
// isTextEditingTarget; die Funktion heisst isTextEditingShortcutTarget, siehe oben).
document.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    if (key !== "z" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) { return; }
    if (isEcosystemEditTextTarget(event.target)) { return; }   // ruft isTextEditingShortcutTarget, typeof-gewacht
    const session = activeEcosystemGeometryEdit;
    const inEcosystemMode = typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive();
    if (!session && !inEcosystemMode) { return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (session) { undoEcosystemGeometryStep(); return; }
    sayEcosystemEdit("Keine Fläche in Bearbeitung — es wurde nichts rückgängig gemacht. …");
}, true);
```

> ⚠️ **Undo muss nach dem Save auch den Server erreichen.** Der Stapel liegt im Speicher.
> Nimmt ein Undo einen Eckzug zurück, der bereits gebündelt gespeichert wurde (800 ms),
> muss es einen **neuen** `update_area_geometry` auslösen — sonst ist die Karte richtig und
> die Datenbank falsch, und die Abnahme (Schritt 9) prüft nur den Bildschirm. Ein Undo, das
> über den letzten Save hinaus zurückgeht (Stapel leer), ist ein No-op, kein Fehler.

- [x] **Schritt 1–8:** Handler, Bündelung, Undo-Stapel (jedes Undo, das eine gespeicherte
      Geometrie ändert, schreibt erneut), je mit Test.
      Test: `node js/map-features/__tests__/ecosystem-edit.test.js` (Ringmathematik: schließende
      Dublette, Einfügen einzeln und als Vierer-Fächer, Lösch-Boden, nächste Kante über Löcher und
      Multipolygone, Tiefkopie und Deckel des Undo-Stapels). Er hat beim Schreiben einen echten
      Fehler gefunden: Ecke 0 riss den Ring auf, weil die Geschlossenheit **nach** dem Schreiben
      geprüft wurde. Das Zustandsbehaftete (Bündelung, Revisions-Übergabe, Undo→Server) ist im
      Browser gegen gestubbtes `postEcosystemEdit` geprüft — es braucht Leaflet, DOM und fetch.
- [x] **Schritt 9: 🔧 DU (Owner):** Strg+Z **während** einer Bearbeitung nimmt einen
      Eckzug zurück — **und der Lesepfad zeigt danach denselben Stand** (nicht nur der
      Bildschirm). ~~Strg+Z **ohne** offene Bearbeitung macht weiter den letzten
      Änderungs-Log-Eintrag rückgängig — unverändert.~~ **Der zweite Satz ist überholt**
      (Entscheidung 3 oben): Strg+Z ohne offene Bearbeitung macht jetzt **nichts** und sagt das
      auch. Abgenommen: *„strg-z verhält sich jetzt glaub richtig, wir können weitermachen."*
- [x] **Schritt 10: Commit** — `feat(ecosystem): vertex editing with batched saves and a scoped undo stack`

### Aufgabe V3.4 — Kontextmenü ✅ ERLEDIGT

> ✅ **Live seit 2026-07-26, Commit `2821fd1f`.** **Abnahme durch den Owner:** *„fläche löschen
> geht."* — geprüft wurde damit ausdrücklich der Lösch-Rückweg (das Kernstück von Schritt 6);
> die Modus-Sichtbarkeit ist gegen die Live-Bedingung gemessen, aber nicht eigens bestätigt.
>
> **Der Dateizettel oben stimmte nicht — es sind fünf, nicht einer.** Was tatsächlich nötig war,
> und jeweils warum:
>
> | Datei | warum sie doch dran musste |
> |---|---|
> | `map-features-ecosystem-context-action.js` | die IIFE selbst (466 Z.) |
> | `index.html` | **eine** Zeile: das `<script>`-Tag. Es gibt keinen Build und keinen Lader für `map-features/*` — „ohne `index.html`" kann nur „ohne Menü-Umbau" heißen, und so ist es umgesetzt (Textanker, nicht Zeilennummer). |
> | `css/components/map-context-menu.css` | 4 Glyphenregeln, s. u. — ohne sie rutscht das Label in die 1,45-em-Spalte |
> | `map-features-ecosystem-rendering.js` | `layer.on("contextmenu")` → gewachter Aufruf, wie V3.3 sich dort eingehängt hat |
> | `map-features-ecosystem-draw.js` | `startEcosystemAreaDrawing({startLatLng})`, s. „erste Ecke" |
>
> 🪤 **`data-ecosystem-kind` war NICHT benutzbar** — der naheliegende Attributname.
> `syncEcosystemLayerSwitchControls` fragt **dokumentweit**
> `querySelectorAll("[data-ecosystem-kind]")` (`map-features-ecosystem-layer-switch.js:76`) und
> stempelt `is-active` / `aria-selected` / `tabindex` auf **jeden** Treffer. Ein Menüeintrag mit
> diesem Attribut wäre still als vierter Reiter des Segmentschalters behandelt worden. Deshalb
> `data-ecosystem-new-kind`.
>
> 🪤 **Ein injizierter `.map-context-menu__item` braucht eine `::before`-Glyphenregel.** Die
> Grundregel ist `grid-template-columns: 1.45em minmax(0,1fr) auto`; ohne `content` wird das
> `::before` **nicht erzeugt**, und dann wird der Beschriftungstext selbst zum ersten
> Rasterelement — in einer 1,45 em breiten Spalte, mit `white-space: nowrap`. Deshalb gehört zu
> jedem neuen Eintrag eine Zeile in `map-context-menu.css`; dasselbe gilt für V3.6.
>
> 💣 **Löschen schließt eine offene Eckenbearbeitung OHNE Flush** (`{flush: false}`). Mit Flush
> würde der gebündelte Save (800 ms) nach dem Löschen auf eine Zeile mit `is_active = 0` treffen
> und als Fehlermeldung über eine Fläche zurückkommen, die der Editor gerade absichtlich
> entfernt hat. Im Browser gegengeprüft: es geht **genau ein** Aufruf raus, `delete_area`.
>
> ⭐ **Der rechtsgeklickte Punkt wird die erste Ecke.** Die Einträge sitzen im Untermenü „Hier
> hinzufügen" — ohne das wären sie die einzigen darin, die ignorieren, wo sie geöffnet wurden.
> Der Knopf „Fläche zeichnen" startet unverändert leer.
>
> **Nicht gebaut, absichtlich:** das Flächenmenü hat **einen** Eintrag. „Senden an …" hängt V3.6
> daran, „Ecken bearbeiten" bleibt beim Doppelklick (V3.3).
>
> 🪤 **Drei Prüffallen, alle im unsichtbaren Browser-Bereich** (Einzelheiten samt Rezept in der
> Sitzungsnotiz `leaflet-synthetic-drag-target-trap`):
> 1. Die Panes starten **0×0**, also liefert `document.elementFromPoint` `null`.
>    `resize_window{preset:"desktop"}` hilft nicht — explizite Maße setzen, dann
>    `map.invalidateSize()`.
> 2. Danach lag die Fläche außerhalb des Ausschnitts und `map.setView` bewegte nichts. **Lösung:
>    nicht hit-testen** — das Ereignis direkt auf `layer.getElement()` feuern, Leaflet findet sein
>    Ziel über `e.target`.
> 3. `<option value="political">` ist **ohne DB `disabled`**, und der jQuery-Getter überspringt
>    disabled: `getSelectedMapLayerMode()` bleibt auf dem alten Wert, während `select.value` schon
>    steht. Zum Prüfen `option.disabled = false` setzen.
>
> ⭐ **`stopImmediatePropagation` beweist man am verhinderten Seiteneffekt:** dass der Klick auf
> den Menüeintrag **keine** Zeichen-Ecke setzte (ein Punkt, nicht zwei), ist der Nachweis, dass er
> die jQuery-Delegation nie erreicht hat. Direkt abfragbar ist es nicht.

**Dateien:** Erstellen `js/map-features/map-features-ecosystem-context-action.js`
(Vorlage **lesen**: `map-features-settlement-context-action.js`)

> **Ohne `index.html` und ohne `REGION_CONTEXT_ACTIONS` anzufassen.** Eine eigenständige
> IIFE injiziert ihre Einträge und fängt Klicks in der **Capture-Phase mit
> `stopImmediatePropagation()`** ab, bevor die jQuery-Delegation greift. Das ist auch
> deshalb richtig, weil `index.html` gerade fremde offene Arbeit trägt.

Drei Einträge im **Karten**-Kontextmenü: „Neue Derographische Region", „Neue Vegetation",
„Neue Topographie" — jeder **schaltet die Ebene mit**. Und „Neues Herrschaftsgebiet" wird
ausgeblendet, außer der Modus ist `political`.

> 💣 **Es gibt DREI Kontextmenüs, und V3.6 braucht ein viertes, das hier entsteht.**
>
> | Menü | wo | woran |
> |---|---|---|
> | `#map-context-menu` | `index.html:247`, Untermenü „Hier hinzufügen" `:249–256` | Rechtsklick auf leere Karte |
> | `#region-context-menu` | `index.html:267–278`, **flach** | `polygon.on("contextmenu")`, **politische** Polygone (`map-features.js:491–504`) |
> | **Flächen-Kontextmenü Landschaften** | **existiert nicht** | muss hier gebaut werden |
>
> Die drei „Neue …"-Einträge gehören ins **Karten**-Menü. **Der Rechtsklick auf eine
> Landschaftsfläche** braucht ein eigenes Menü — und das ist die Voraussetzung für „Senden
> an …" (V3.6) **und** für den Lösch-Rückweg (V3.0b-Schluss). Es hier gleich mitbauen,
> mit `delete_area` als erstem Eintrag; V3.6 hängt „Senden an …" daran.

- [x] **Schritt 1–4:** Injektion der drei Karten-Einträge, Handler, Ebenen-Umschaltung,
      Ausblendung von „Neues Herrschaftsgebiet".
- [x] **Schritt 5: Flächen-Kontextmenü** für Landschaftsflächen anlegen, erster Eintrag
      **„Fläche löschen"** (`delete_area`, weich) — der Rückweg aus einer falsch
      platzierten Fläche.
      Test: `node js/map-features/__tests__/ecosystem-context-menu.test.js` (Sichtbarkeits-Entscheid
      je Modus, Bau der Lösch-Anfrage, Bestätigungstext). 💣 Er hat beim Schreiben **mich** statt den
      Code korrigiert: die Behauptung „ein String-`geometry_revision` muss abgewiesen werden" ist
      falsch — der Server castet in **beiden** Pfaden `(int)`
      (`api/_internal/app/ecosystem.php:543` und `:1203`), Abweisen hätte ein funktionierendes
      Löschen in „nicht mehr geladen" verwandelt. Abgewiesen wird, was der Server mit 400
      beantwortet: fehlend, 0, leer, gebrochen. Der Zustandsbehaftete Teil (Menü-DOM, Capture-Phase,
      Löschpfad, 409) ist im Browser gegen gestubbtes `postEcosystemEdit` geprüft.
- [x] **Schritt 6: 🔧 DU (Owner):** Im politischen Modus ist „Neues Herrschaftsgebiet"
      da, im neuen Modus nicht. Rechtsklick auf eine Fläche zeigt „Fläche löschen"; danach
      ist sie weg (Reload). — Abgenommen: *„fläche löschen geht."*
- [x] **Schritt 7: Commit** — `feat(ecosystem): map-menu create entries plus a per-area menu with delete`

### Aufgabe V3.5 — Erprobungs-Hinweis

**Dateien:** Erstellen `js/map-features/map-features-ecosystem-intro.js`

> **Eine Warnung ohne Konsequenz wird weggeklickt** — und die Editoren legen
> erfahrungsgemäß sofort los. Deshalb dreiteilig: der Moduseintrag heißt dauerhaft
> „Landschaften (Erprobung)"; der erste Dialog nennt **konkrete Schritte** statt
> einer Bitte um Vorsicht; und jede in dieser Phase entstandene Fläche trägt
> `is_trial = 1` (auf `ecosystem_area`, gesteuert über `app_setting['ecosystem_trial']`),
> sodass am Ende **eine** Entscheidung reicht.

> ✅ **Der „Lade neu"-Schritt trägt jetzt — die Editor-Persistenz ist live** (Commits
> `d22bd828` + `9d8d844c`, 2026-07-24). `_v` steht in `ignoredParams`, der Modus überlebt
> F5, Ausschnitt und Zoom auch. **Ein Punkt bleibt für V1.1 zu tun:** `?landschaften=1`
> gehört aus demselben Grund wie `_v` in `ignoredParams` (`map-features-layer-state.js`,
> Kommentar steht am Set), sonst schaltet das Flag den Restore wieder ab und der Modus
> fällt auf `deregraphic`. Mit dieser einen Zeile in V1.1 hält der Reload-Test unten.

```
Zeichne eine einzige Fläche. Verschiebe die Karte. Lade neu. Ist sie noch da?
Erst wenn das sitzt, die zweite. Bitte noch keine Serie — das Werkzeug ist neu,
und was jetzt entsteht, kann sich noch als falsch erweisen.
```

- [ ] **Schritt 1–3:** Dialog (einmalig, `localStorage` — im Projekt gibt es kein
      „schon-gesehen"-Muster, das ist Neubau), Statuszeile (das Chip aus V3.3),
      `is_trial`-Weitergabe: der Client liest `app_setting['ecosystem_trial']` und schickt
      `is_trial` an jede `create_area`-Aktion.
- [ ] **Schritt 4: Commit** — `feat(ecosystem): trial-phase notice with concrete steps`

### Aufgabe V3.6 — „Senden an …"

> **Vorgezogen aus V7** (Owner-Entscheidung). Die Analyse nennt das Übernehmen von
> Geometrie „die wichtigste einzelne Funktion des ganzen Editors" (§4.4) — es hinter
> die V4-Messung zu schieben hieße, die Zahl, an der alles hängt, ohne das Werkzeug zu
> erheben, das die ~266 Zwillingsflächen halbieren soll.

**Dateien:** Erstellen `js/map-features/map-features-ecosystem-transfer.js` — hängt „Senden
an …" an das **Flächen-Kontextmenü aus V3.4**.

**Verhalten:** Rechtsklick auf eine Fläche → „Senden an …" → die beiden anderen Ebenen.
**Kopie, keine Verknüpfung** — verschiebt später jemand die Quelle, darf sich die
Kopie nicht mitbewegen. Nach dem Kopieren springt der Editor **in die Kopie**: andere
Ebene aktiv, Kopie ausgewählt, Panel offen.

> 🔴 **In WELCHE Region der Zielebene?** (Owner-Entscheidung 1). Eine Kopie braucht eine
> `region_id` der Zielebene — sonst entsteht dort doch wieder eine namenlose Einzelregion.
> Voreinstellung: eine **neue** Region der Zielebene, benannt wie die Quelle (der häufige
> Fall: „Farindel"-Vegetation → „Farindel"-Topographie). Der Dialog bietet zusätzlich „an
> bestehende Region anhängen" für den Fall, dass das Ziel schon existiert.

> 💣 **Der Einzel-Handgriff ist NICHT das Werkzeug für ~266 Zwillinge.** Gerechnet
> (geschätzt): Rechtsklick + Menü + Ziel + Roundtrip + Sprung in die Kopie + Zurückschalten
> ≈ **15–18 s reiner Overhead je Fläche**, also **~70–80 Minuten reines Menü** für alle
> Zwillinge, bevor eine Ecke angepasst ist. Der richtige Massenbetrieb ist ein
> serverseitiges `copy_regions(kind_from → kind_to)` über eine Auswahl — **ein** Handgriff,
> Muster `promote_trial`. Das ist aber **nicht Teil dieses Vorhabens**: V3.6 liefert den
> Einzel-Handgriff für die Ausnahme und für die V4-Messung (Durchgang B); der Stapelbetrieb
> wird nach V4 beauftragt, wenn die Messung zeigt, dass er sich lohnt. **Hier nur benannt,
> damit V4 weiß, dass es den teuren Weg misst, nicht den späteren billigen.**

- [ ] **Schritt 1–4:** „Senden an …" am Flächenmenü, Ziel-Region (neu/bestehend), Kopie
      über den Schreibendpunkt (neue `public_id`, kein Verweis auf die Quelle),
      Ebenenwechsel, Auswahl der Kopie.
- [ ] **Schritt 5: 🔧 DU (Owner):** Eine Vegetationsfläche in die Topographie senden,
      dort eine Ecke ziehen — das Original bleibt unverändert.
- [ ] **Schritt 6: Commit** — `feat(ecosystem): send a drawn area to the other two layers as a copy`

---

# V4 — Abnahme und Messung

**Kein Code.** Diese Stufe entscheidet, ob alles Weitere gebaut wird.

- [ ] **🔧 DU (Owner): Zweimal zehn Flächen — getrennt Zeit stoppen.**

| Durchgang | was | wonach gefragt ist |
|---|---|---|
| **A** | 10 Flächen **neu gezeichnet** (V3.2), **inkl. Benennen + Region + Wiki** | Wie teuer ist eine **fertige** Fläche von Hand? |
| **B** | 10 Flächen per **„Senden an …"** (V3.6) übernommen und angepasst | Wie viel spart das Übernehmen wirklich? |

> Das sind die beiden Zahlen, an denen alles hängt. Bei **5 Minuten** je Fläche in
> Durchgang A sind es 42 Stunden für 500 — es wird nicht fertig. Bei **2 Minuten** sind
> es 17 — es wird. Und Durchgang B sagt, ob die ~266 Zwillinge halb so teuer sind wie
> behauptet oder fast genauso teuer.
>
> Drei Flächen fühlen sich mit jedem Werkzeug gut an. Zwanzig nicht.

> 🪤 **Zwei Dinge, die die erste Fassung dieser Messung verschwieg:**
> 1. **Die Zeichenzeit ist nicht die Gesamtzeit.** Klick-für-Klick spart die Geometrie
>    (gemessen plausibel: 1–2 min statt 3–5). Aber Benennen, `region_type`, Wiki-Zuweisung
>    (V3.0b) und das Wiederfinden der nächsten Stelle sind **+1,2–1,9 min je Fläche**, die
>    es vorher gar nicht gab. Realistisch also eher **500 × ~3 min ≈ 25 h** als 17.
>    **Durchgang A misst die fertige Fläche, nicht nur die Geometrie** — sonst misst V4
>    2 Minuten und die Wirklichkeit sind 3.
> 2. **Die ersten zehn sind die leichtesten.** Inseln und Seen sind klein und rundlich;
>    `region`/`wald`/`gebirge`/`meer` sind groß und zerklüftet. Und V5 nimmt genau die
>    leichte Klasse ganz aus der Hand. **Die zehn Messflächen sind aus dem schweren Rest zu
>    wählen** (Wald, Gebirge, Sumpf), nicht aus den Inseln — sonst ist die Zahl geschönt.

- [ ] **Messungen, die vor der nächsten Stufe feststehen müssen:**

| Frage | Verfahren |
|---|---|
| Knoten- und Kantenzahl des Graphen | **Nicht** über die Diagnose-Endpunkte. Nach V-1 sind sie fähigkeitsgeschützt — eingeloggt **ein** Aufruf von `?diagnostic=graph-data`, oder besser eine `SELECT COUNT(*)`. |
| Weicht die Route zwischen den Engines heute schon ab? | Eine Route über einen Weg **mit innerem Knoten**, mit und ohne `?clientrouting=1`. Der Server splittet (`client-graph.php:148–157`), der Client nicht (`route-graph-routing.js:109–112`). Entscheidet, ob die Paritätsforderung gestrichen wird. |
| Invalidiert ein Flächen-Save die Payload? | 🪤 **NICHT über die Byte-Zahl.** Die driftet durch gewöhnliche Editorarbeit dauernd (gemessen: +4.557 B an einem Tag). `curl -s https://avesmaps.de/api/app/map-features.php`, im Scratchpad das Feld **`revision`** lesen (heute 35.074), einen Flächen-Save auslösen, erneut lesen. **Bleibt `revision` gleich, hält Regel 3.** Ändert sie sich, ruft ein Landschafts-Pfad `avesmapsNextMapRevision`. |
| Wie viele Querfeldein-Strecken entstehen real? | Entscheidet, ob A\* vorberechenbar ist. |

- [ ] **Entscheidung über die Erprobungsflächen:** `promote_trial` mit `keep` oder
      `discard`. Ein Aufruf, kein Aufräumen von Hand.

---

# V4a — Quellen anschließen (ex V2.4, hinter die Messung verschoben)

> **Warum hinter V4:** Die Allowlist-Zeile öffnet zwei Löcher im Totmannschalter, und vor
> dem Landschaftseditor (V6) kann ohnehin niemand eine Quelle an eine Fläche hängen. Vor
> V4 kauft sie nichts und kostet zwei Risiken.
>
> 💣 **Beide müssen mitgelöst werden, sonst bleibt V4a offen:**
> 1. **`avesmapsNextMapRevision` im Quellen-Schreibpfad.**
>    `api/_internal/app/feature-sources.php:428`/`:468`/`:512` bumpt bei jedem Add/Remove
>    die globale Kartenrevision (Regel 3). Für `ecosystem` gehört dort ein Zweig, der
>    stattdessen `avesmapsNextEcosystemRevision` ruft — oder der Beleg, dass Quellen an
>    Landschaftsflächen die Frontend-Payload nicht berühren und der Bump entfallen darf.
> 2. **Der Payload liest `feature_sources` ohne `entity_type`-Filter**
>    (`api/app/map-features.php:754–761`). Ein `ecosystem`-Ref träte am Kill-Switch vorbei
>    nach außen. Entweder den Payload-Read auf die freigeschalteten Typen einschränken,
>    oder den öffentlichen `api/app/feature-sources.php` denselben `ecosystem_enabled`-Check
>    vorschalten wie dem Lesepfad.

**Dateien:** Ändern `api/edit/map/feature-sources.php`, `api/app/feature-sources.php`
(+ der Payload-/Revisions-Pfad aus den zwei Punkten oben)

> **Vier Stellen, nicht zwei.** Beide Dateien haben ein Array **und** eine
> Fehlermeldung im Klartext — und die Meldungen sind schon heute veraltet: sie zählen
> sechs Typen auf, das Array trägt **sieben** (`powerline` fehlt in beiden Meldungen).

| Datei | Array | Meldung |
|---|---|---|
| `api/edit/map/feature-sources.php` | `:49` | `:52` |
| `api/app/feature-sources.php` | `:33` | `:36` |

- [ ] **Schritt 1:** `'ecosystem'` in beide Arrays.
- [ ] **Schritt 2:** Beide Fehlermeldungen aus dem Array **generieren** statt sie von
      Hand zu pflegen: `implode(', ', $allowedTypes)`.
- [ ] **Schritt 3:** Die zwei Kill-Switch-/Revisions-Löcher oben schließen.
- [ ] **Schritt 4: 🔧 DU (Owner):** Bei ausgeschaltetem `ecosystem_enabled` liefert
      `GET /api/app/feature-sources.php?entity_type=ecosystem&…` **nichts nach außen**, und
      ein Quellen-Save an einer Fläche lässt das Payload-`revision` **unverändert**.
- [ ] **Schritt 5: Commit** — `feat(ecosystem): join the shared source system without leaking past the kill switch or bumping map_revision`

---

# Danach — Skizze, noch nicht beauftragt

Jedes dieser Vorhaben bekommt einen **eigenen Plan**, geschrieben erst wenn V4
abgenommen ist.

| | Vorhaben | Bemerkung |
|---|---|---|
| **V5** | Kachel-Ableitung Land/Wasser | Einmaliges Skript, keine Oberfläche. Nimmt **149 Flächen** ganz aus der Handarbeit (`insel` 95 + `see` 46 + `kueste` 2 + `kontinent` 2 + `wueste` 4 = 149 — die alte „147" summierte die neuen Posten nicht), macht aus 35 `meer` Schneidearbeit, gibt 61 `gebirge` einen Startumriss. **Genau diese leichte Klasse darf nicht in die V4-Messung** (sie verzerrt sie nach unten). Werkzeugkette im Nachbarrepo (`27_polygonize_town_tiles.py`). ⚠️ `dsa5-atlas/` nicht anfassen — Ulisses-Material. |
| **V6** | Landschaftseditor (3 Spalten) | Realistisch **1.800–2.600 Z.** Vorlage nur `html/wiki-sync-powerline-editor.html:60` (`display:grid`) — der „Vorbild"-Siedlungseditor verstößt bei `:75`/`:78` selbst dagegen. Zwei Sitzungen. |
| **V7** | Grenzimport aus den Territorien | Rechtsklick → Hierarchiebaum mit Häkchen → Geometrien vereinigen und einfügen (Kopie, nie Verknüpfung), danach **vereinfachen** (Douglas-Peucker) — sonst schleppt eine Landschaftsgrenze politische Vertex-Dichte mit. Gemessen: 120 Territorien vereinigen = 47,7 ms; 500 Flächen à 800 Ecken = 14,8 MB (bei ungerundeten Koordinaten; `round(…,4)` beim Schreiben halbiert das). *(„Senden an …" ist nach V3.6 vorgezogen; ein Massen-`copy_regions` für die ~266 Zwillinge ist die andere offene Vorarbeit.)* |
| **V8** | Topographie / Höhenfeld | Buckelsumme portieren (`cellHash` :402, `level` :413, `peakWindow` :452, `rawArea` :464, `buildArea` :491, `hAt` :578). 💣 **`sampleRoute()` :637 nicht übernehmen** — feste Schrittweite, keine Klemmen. 💣 **Enthaltensein-Fensterung** statt `max` oder Summe. Eigene Stufe: Gipfel-Sichtbarkeitsregel (öffentliche Bestandsänderung!). Basis heute: **34 Gipfel auf 61 Gebirge**. |
| **V9** | Vorberechnung Wege × Flächen | `path_ecosystem` (PK `(path_id, area_id, seq)`, `BIGINT` nicht `VARCHAR(36)`), `path_ecosystem_state`. bbox-Vorfilter als **SQL-Join**. Sperre, Budget (4 s, **nicht** 28), `set_time_limit`, serverseitiger Cursor ohne `OFFSET`, Idempotenz. 💣 Leasing-Falle (`api/_internal/app/citymaps.php:323–325`). Auf **5.512** Wegen entsprechend länger als die gemessenen 30–45 s. |
| **V10** | „Führt durch" + Flora am Segment | `buildRouteLegPopupHtml` (`route-plan.js:196`, Zeilen-Helfer `:210`, letzte Zeile `:222`), `buildLoreMarkup` (`lore.js:417`). ⚠️ Nur über den DOM-Observer laden, nie beim Markup-Bau. |
| **V11** | Terrain auf Kantengewichte | Die gefährlichste Stufe. **Drei** Slice-Stellen: `client-graph.php:144`, `:157`, **`:534–553`** (Geschwindigkeits-Rekonstruktion `$originalDistance / $originalTime` bei `:538`). Einheitenfalle (×3 → ×23). Klemme `[0,5…4,0]`, **nicht** die Flussgrenze erben. `from`/`to` bleiben in gespeicherter Orientierung (`:207–211`, Verlauf-Sync!). Nachweis ist ein **Netzlauf**, kein Fixture-Test. Zwei Sitzungen. |
| **V12** | Geschwindigkeitsvektoren | Muster: `map-features-river-flow-arrows.js`, edit-only. Versatz **senkrecht** zur Segmentrichtung. Prototyp: 34 px Abstand, `len = 5 + 20·min(1,3, spd)` (`:702–710`). |
| **V13** | Querfeldein: Wasser meiden | ~50 Z., liefert 90 % des A\*-Nutzens: eine Querfeldein-Kante, die ein `meer`/`see`-Polygon schneidet, entsteht gar nicht erst. |
| **V14** | A\* für Querfeldein | Nur clientseitig, on demand. Erst nach der Messung aus V4. |
| **V15** | Spotlight-Schnittmenge | **Vertagt.** Braucht gezeichnete Vegetationsflächen und `relation='vorkommen'` in `lore_place` (`lore-edit.php:121` hat den Wert bereits freigeschaltet, der Sync schreibt ihn nie). |

---

## Selbstprüfung

**Abdeckung.** Die Analyse nennt zehn Bausteine (A–J) plus die Ergänzungen aus §8:
A → V1 · B → V3 · C → V6 · D → V8 · E → V9 · F → V11 · G → V12 · H → V10 · I → V15 ·
J → V13/V14. Anzeige-Häkchen → V1.2 · „Senden an …" → **V3.6** · Grenzimport → V7 ·
Kachel-Ableitung → V5 · Erprobungsphase → V3.5 · Routing-Entlastung → V0 ·
Diagnose-Absicherung → **V-1**.

**Erzeuger-Prüfung** (die Lücke der ersten Fassung — jetzt in **beide** Richtungen:
Verbraucher ohne Erzeuger *und* Spalte ohne Schreiber):

| gebraucht von | Name | erzeugt von |
|---|---|---|
| Regel 3, V2.2 | `ecosystem_revision` + `avesmapsNextEcosystemRevision` | **V2.1** ✅ |
| V2.2 | `app_setting['ecosystem_enabled']` **umlegen** | **V2.3 Schritt 4** ✅ |
| V4 | Oberfläche für `promote_trial` | **V2.3 Schritt 5** ✅ |
| V3 Fertigkriterium | Laden + Rendern vorhandener Flächen | **V3.0** ✅ |
| V0.2 | Netzlauf-Grundlinie (kein Fixture-Test) | **V0.2 Schritt 1** ✅ |
| V4 Durchgang B | „Senden an …" | **V3.6** ✅ |
| **V3.2 (`create_area` braucht `region_id`), V3.6** | **`activeEcosystemRegionId` + Regionsauswahl** | **V3.0b** ✅ |
| V3.0/V3.4 („welche Ebene ist aktiv?") | `activeEcosystemLayerKind` + Segmentschalter | **V3.0 Schritt 1** ✅ |
| V3.6, V4 Durchgang A | Flächen-Kontextmenü (Träger für „Senden an …" und „löschen") | **V3.4 Schritt 5** ✅ |
| V3.5 („Lade neu"-Test) | Editor-Zustand überlebt F5 | ✅ **live** (`d22bd828`+`9d8d844c`); Rest: `?landschaften=1` in `ignoredParams` → **V1.1 Schritt 1** |
| V2.3 (Wächter), V3.3 (Undo) | `geometry_revision` als **gelesener** `expected_revision` | **V2.3 Schritt 2** ✅ |
| „wer hat gelöscht?" | `ecosystem_geometry_audit_log` | **V2.3** ✅ |
| V5, V8 | `label_public_id`-Brücke zur Label-Zeile | **V2.1** ✅ |

**Spalte ohne Schreiber** (die andere Richtung): `wiki_region_key`, `wiki_url` schreibt
**V3.0b Schritt 3** (via `avesmapsPoliticalSlug`). `properties_json`, `origin` bleiben
vorerst ungeschrieben — bewusst, kein Verbraucher vor V6; sie stehen im Schema, damit die
selbstheilende DDL sie nicht später per `ALTER` nachrüsten muss (siehe V2.1).

**Typkonsistenz.** `kind` durchgehend `derographisch|vegetation|topographie`.
`is_trial` sitzt auf **`ecosystem_area`** (V2.1), gesteuert über `app_setting['ecosystem_trial']`
(V3.5 Client-Weitergabe, V2.3 `promote_trial`, V4 Entscheidung) — **nicht** auf der Region.
`AVESMAPS_ECOSYSTEM_SETTING` in V2.2 und V2.3. Geometrie überall **`JSON`**, Polygon
**und** MultiPolygon. `avesmapsBuildClientLocationCellIndex` / `$locationCellIndex`
durchgehend — **nicht** zu verwechseln mit dem vorhandenen `$locationCoordinateIndex`
(`client-graph.php:61`).

**Reihenfolge-Vertrag** (durch die Entscheidungen enger geworden):
V-1 · V0 (Netzlauf!) · V1 · V2 · **Persistenz-Auftrag** · V3.0 · **V3.0b** · V3.1 · V3.2 ·
V3.3 · V3.4 · V3.5 · V3.6 · V4 · V4a. V3.0b **vor** V3.2 (sonst namenlose Geometrie),
Persistenz-Auftrag **vor** V3.5 (sonst scheitert der Reload-Test), V4a **nach** V4.

**Offen und bewusst offen:** die konkreten Tempo-Faktoren je Typ (gehören den Editoren),
die Buckelzahl des Gebirgskörpers (V8, wegen der Jensen-Steuer kein Schönheitsregler),
und die Entscheidung über die Paritätsforderung (fällt nach der Messung in V4).
