# V8 — Topographie / Höhenfeld — Instruction

> ✅ **VOLLSTÄNDIG GEBAUT am 2026-07-28.** Alle zehn Aufgaben abgehakt, 36/36 JS-Tests
> und die PHP-Tests grün. Vier Stellen wichen beim Bauen bewusst vom Plan ab; jede trägt
> ihre Begründung an Ort und Stelle (Aufgabe 2 Schritt 5, Aufgabe 4 Kopf, Aufgabe 6
> Schritt 3, Aufgabe 9). 🔴 **Noch nicht vom Owner live abgenommen** — der Zweig ist
> weder gemerged noch gepusht.

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:executing-plans` (oder
> `superpowers:subagent-driven-development`). Schritte tragen `- [ ]` zum Abhaken.
> **Eigener Worktree auf `origin/master`.**

**Stand:** 2026-07-28. **Auftraggeber:** Owner. **Vorgänger:** V7 ✅ (Grenzimport, live
abgenommen). Maßstab: `docs/oekosystem-editor-leitfaden.md` §1.4,
`docs/oekosystem-editor-verhalten.md` §8/§9, `docs/oekosystem-instruction.md` §4.2,
`docs/superpowers/plans/2026-07-24-landschaften.md` (Zeile V8), AGENTS.md §5/§7/§9/§12.

**Ziel:** Ein `berggipfel`-Label trägt seine **Höhe** selbst, ist in der Topographie-Ebene
sichtbar und ziehbar, und aus den Gipfeln entsteht das **Höhenfeld** einer Gebirgsfläche
(Buckelsumme aus dem Prototyp `html/landschaften-modell.html`).

---

## 0. Die zwei Regeln, die alles andere tragen

🔴 **EIN OBJEKT, ZWEI ANSICHTEN.** Der Gipfel ist eine Zeile in `map_features`
(`feature_type='label'`, `feature_subtype='berggipfel'`). Die Topographie-Ebene *referenziert*
sie, sie kopiert sie nicht. Wer den Gipfel in der einen Ansicht verschiebt, verschiebt ihn in
der anderen — es gibt **keinen Synchronisationspfad, weil es nichts zu synchronisieren gibt**.

> 💣 Wer hier eine `ecosystem_peak`-Tabelle oder ein `peaks`-Array an der Fläche einführen
> will: **nicht.** Das ist die zweite Positionsliste, und sie driftet ab dem ersten Tag.

🔴 **KEIN GIPFEL VERSCHWINDET.** Owner-Entscheid vom 2026-07-28, wörtlich: *„Kein Gipfel darf
verschwinden. Gipfel sind teil der Topographie - mit oder ohne WikiLink."*

Das **widerspricht dem geschriebenen Stand** und hebt ihn auf:

| Stelle | sagt heute | gilt ab jetzt |
|---|---|---|
| `oekosystem-editor-leitfaden.md` §1.4 (Z. 187–191) | wiki-lose `berggipfel` erscheinen **nicht** auf der Karte | gestrichen |
| `oekosystem-editor-verhalten.md` §8 (Z. 494–495) | „auch die ohne Wiki-Eintrag, die auf der öffentlichen Karte nicht erscheinen" | gestrichen |

V8 nimmt der öffentlichen Karte **nichts** weg. Die Sichtbarkeit von Labels bleibt exakt wie
heute. Wer im Verlauf dieses Plans eine Sichtbarkeitsbedingung an `wiki_url` einbaut, hat den
Auftrag verfehlt — siehe Aufgabe 10, die den Widerspruch in der Doku aufräumt.

---

## 1. Was schon liegt — und deshalb NICHT gebaut wird

Der größere Teil steht. Wer das übersieht, baut ihn nach.

| Baustein | Zustand |
|---|---|
| **Höhe speichern** | ✅ **Keine Migration, keine neue Aktion.** `update_label` nimmt `properties_json` entgegen (`api/_internal/map/features.php:343`) und **mischt**: es liest die vorhandenen Eigenschaften (`:2239`) und setzt Einzelschlüssel. Ein neues Feld überlebt jedes fremde Speichern. |
| **Label schreiben** | ✅ `create_label` / `update_label` / `move_label` (`api/edit/map/features.php:50–52`) |
| **Randabstand** | ✅ `distanceToEcosystemEdge(point, geometry)` (`js/map-features/map-features-ecosystem-geometry.js:70`) — läuft über **alle** Ringe **inklusive Löcher** (`:40–52`), mit Segment-Klemme (`:57`). Unit-getestet. **Das ist der Ersatz für `distEdge` des Prototyps.** |
| **Punkt-in-Fläche** | ✅ `pointInGeometry(point, geometry)` — ⚠️ **nicht** im Geometriemodul, sondern in **`js/map-features/map-features-point-in-polygon.js:26`** (eine frühere Fassung dieses Plans behauptete „im selben Modul"; am 2026-07-28 berichtigt). Kennt Löcher, Polygon und MultiPolygon; `point` ist **`[x, y]`**. Test: `js/map-features/__tests__/point-in-polygon.test.js` |
| **Bounds** | ✅ `ecosystemGeometryBounds(geometry)` → **snake_case** `{min_x, min_y, max_x, max_y}`, `null` bei leer |
| **Label-Dialog (Standard-Layer)** | ✅ `js/review/review-labels.js` — `populateLabelEditForm` `:16`, `buildLabelEditPayload` `:287` (wählt `update_label`/`create_label` bei `:290`) |
| **Landschaften-Panel** | ✅ `js/map-features/map-features-ecosystem-properties.js` — spricht bereits `update_label` (`:550`, `:656`) |
| **Kontextmenü** | ✅ `js/map-features/map-features-ecosystem-context-action.js` — Untermenü „Hier hinzufügen", Klicks werden in der **Capture-Phase** abgefangen (Kopf des Moduls) |
| **Ebenenumschaltung** | ✅ `activeEcosystemLayerKind` (`js/map-features/map-features-ecosystem-layer-switch.js:42`, gesetzt `:295`) |
| **Flächen zeichnen** | ✅ `js/map-features/map-features-ecosystem-rendering.js` — `buildEcosystemAreaLayer` `:221`, `ecosystemAreaLatLngs` `:75` |
| **Revision** | ✅ `avesmapsNextEcosystemRevision(PDO)` (`api/_internal/app/ecosystem.php:260`) |
| **Attrappen-Muster** | ✅ `js/map-features/map-features-ecosystem-territory-import.js:87` (`?demo`), Attrappen ab `:959` |
| **Testablage** | ✅ `js/map-features/__tests__/ecosystem-*.test.js` (8 Stück), Lauf: `node js/map-features/__tests__/<name>.test.js` |

### 1.1 Der Prototyp

`html/landschaften-modell.html` läuft. **Zu portieren, zeilengenau (am 2026-07-28 nachgeprüft):**

| Funktion | Zeile | Rolle |
|---|---|---|
| `cellHash` | `:402` | Zellweiser Hash — die Lage eines Buckels hängt nur an (Saat, Stufe, Zellindex). Deshalb bleibt beim Verfeinern alles stehen. |
| `level` | `:413` | Eine stratifizierte Stufe: ein verwackelter Buckel je Gitterzelle |
| `peakWindow` | `:452` | Fenster, das das Rauschen am Gipfel auf null zieht — **mit Steigung null** |
| `rawArea` | `:464` | Höhe einer Fläche an einer Stelle: Gipfel + gefenstertes Rauschen |
| `buildArea` | `:491` | Baut Buckel, Index, Dämpfung, Maske |
| `hAt` | `:578` | ⚠️ **Nur als Vorlage lesen, NICHT übernehmen** — siehe Falle 2 |

---

## 2. Gemessen — am Livebestand, nicht geschätzt

**2026-07-28, je ein einzelner Abruf** (`api/app/map-features.php`, `api/app/ecosystem-areas.php`
— CLAUDE.md verbietet das Schleifen, ein Abruf je Endpunkt ist die Vorgabe).

### 2.1 Die Doku war an vier Stellen falsch

| | behauptet | **gemessen** |
|---|---|---|
| `berggipfel`-Labels | 23 (`oekosystem-instruction.md:207`) · 34 (V8-Zeile) · 34 (`api/_internal/app/ecosystem.php:65`) | **62** |
| `gebirge`-**Labels** | 60 (V5-Zeile) · 61 (V8-Zeile) | **68** (alle wiki-verknüpft) |
| `gebirge`-**Flächen** | nirgends genannt | **2** |

> 💣 **Die alten Zahlen zählten `gebirge`-LABELS und nannten sie „Gebirge".** Ein Label ist ein
> Schriftzug, keine Fläche. Wer „61 Gebirge" liest und ein Höhenfeld für 61 Flächen plant,
> plant für 59 Flächen, die es nicht gibt. Aufgabe 10 korrigiert alle vier Stellen.

### 2.2 Der Untergrund

390 → 391 Ökosystem-Flächen, davon **295 `topographie`**:

| `region_type` | Anzahl |
|---|---|
| `see` | 292 |
| `gebirge` | **2** — „Finsterkamm" (32 Ecken) und „Random Berge" (10 Ecken) |
| `kueste` | 1 |

- **Beide `gebirge`-Flächen tragen `is_trial: true`.** Das Höhenfeld muss Erprobungsflächen
  zeichnen, sonst zeigt die Abnahme nichts.
- **Die beiden überlappen sich** (bbox-Schnitt), liegen aber nicht ineinander. Damit ist der
  Fall, um den es geht — zwei Gebirge verschmelzen zu einem Zug —, **live prüfbar**. Genau
  dafür hat der Owner „Random Berge" angelegt.
- Vollständige Verschachtelung gibt es im Bestand nur unter Seen (3 Paare in der
  „Siebenwind-Küste"), bei Gebirgen nicht. Sie braucht nach dem Owner-Entscheid (Falle 2)
  auch keine eigene Behandlung — überlappen und verschmelzen ist der Normalfall.

### 2.3 Die Gipfel

- **62** `berggipfel`-Labels. **Kein einziges** trägt heute ein höhenartiges Feld.
- Wiki-Verknüpfung: top-level `wiki_url` **36** · verschachtelt `wiki_region.wiki_url` **45** ·
  irgendeines **52** · keines **10**. *(Nur noch Bestandskunde — der Owner-Entscheid in §0
  macht die Unterscheidung für die Sichtbarkeit bedeutungslos.)*
- **5 von 62** liegen in einer Topographie-Fläche, alle fünf im Finsterkamm.
- 🪤 **Doppelte Namen im Bestand:** „Horndrachenfels" ×2, „Amran Thjalgyn" ×2. Der Name ist
  **kein** Schlüssel. Überall `public_id` verwenden.

---

## 3. Fallen

💣 **1 — `sampleRoute()` `:637` NICHT übernehmen.** Feste Schrittweite (`L / 3`), keine Klemmen.
V8 braucht es nicht; V11 wird es brauchen und bekommt dann eine eigene, geklemmte Fassung.

💣 **2 — Flächen SUMMIEREN sich, und das Gipfelfenster gilt GLOBAL.** `hAt` `:578` summiert über
alle Flächen, die eine Stelle enthalten (*„Überlappen sich zwei Gebirge, addieren sich ihre
Felder"*) — **das ist richtig und bleibt**. Weil jede Fläche an ihrem eigenen Rand auf 0
ausläuft, sind in der Überlappung beide Felder nahe ihrem Fuß; die Summe türmt dort nichts,
sie füllt den Sattel. Genau das ist die Überblendung zweier Züge.

> 🔴 **Owner-Entscheid 2026-07-28, zweite Runde:** *„sie brauchen sich nicht zu schachteln/zu
> fenstern. die überlappung und verschmelzung zu einem zug ist ok."* Eine frühere Fassung
> dieses Plans baute einen Enthaltensein-Wald mit Eltern/Kind-Fensterung. **Der ist gestrichen.**
> Wer ihn wiedererfindet, baut einen Sonderfall für ein Problem, das die Fußhöhe-0-Invariante
> schon löst.

Was **bleibt**, ist eine einzige lokale Regel: der Prototyp fenstert das Rauschen am Gipfel auf
null (`peakWindow` `:452`) und klemmt den Gipfelradius am Gipfelabstand (`sep`, `:500–502`) —
beides aber **nur innerhalb einer Fläche**. Liegt der Gipfelpunkt der einen Fläche in der
anderen, addiert sich deren Feld dazu: der Editor tippt 3.000 und die Karte zeigt 4.200. Beides
muss deshalb **über alle Flächen hinweg** gerechnet werden. Aufgabe 7.

💣 **3 — `distEdge` des Prototyps kennt nur EINEN Ring** (`:390` ff.). Eine Fläche mit Loch
bekäme dort Buckel, die ins Loch ragen, und die Fußhöhe-0-Invariante bricht — **sichtbar erst
spät**, weil das Loch meist weit vom nächsten Gipfel liegt. `distanceToEcosystemEdge` macht es
bereits richtig und ist unit-getestet. **Benutzen, nicht nachbauen.**

💣 **4 — `update_label` überschreibt die Darstellungswerte bedingungslos.** `size`, `rotation`,
`min_zoom`, `max_zoom`, `priority`, `is_nodix` werden aus dem Payload gesetzt, ohne zu prüfen,
ob der Aufrufer sie mitschickt (`features.php:2244–2249`). Ein „nur die Höhe"-Aufruf würde ein
Label auf Standardgrößen zurückwerfen.

> Das ist **kein hypothetischer Fall.** Genau daran ist am **2026-07-28** `other_source`
> gestorben: der Aufruf lief unbedingt, der Dialog verlor das Feld, und jedes Speichern löschte
> die gespeicherte Quelle (`features.php:2265–2268`). Das Schutzmuster steht direkt daneben
> (`:2254`, `:2257`, `:2269`, `:2278`): **`array_key_exists`, sonst nichts anfassen.** Die Höhe
> bekommt denselben Schutz.

💣 **5 — Ein neuer Kontextmenü-Eintrag braucht IMMER eine Glyphenregel** in
`css/components/map-context-menu.css`. Ohne `content` entsteht das `::before` nicht und die
**Beschriftung rutscht in die 1,45em-Symbolspalte** (in V7 gemessen: 12 statt 41 px). Die Datei
führt die Glyphen ab `:56`.

💣 **6 — Koordinaten.** GeoJSON speichert `[x, y]`, Leaflet `L.CRS.Simple` nutzt
`[lat, lng] = [y, x]`. Bewusst tauschen (AGENTS.md §5). Das Höhenfeld rechnet durchgehend in
**Kartenkoordinaten 0..1024**, nie in Bildschirmpunkten — sonst hinge das Ergebnis am Zoom.

💣 **7 — `rauschen === 0` fragen, nicht `rauschen > 0`.** Der Prototyp sagt warum (`:485–487`):
bei `NaN` ist `> 0` falsch, und ein Rechenfehler würde sich in eine **stumm flache Landschaft**
verwandeln statt sich zu zeigen. *„Genau das ist einmal passiert."* Wortgleich übernehmen.

💣 **8 — Zwei Revisionen, zwei Zuständigkeiten.** `ecosystem_revision` darf **nie**
`avesmapsNextMapRevision()` erreichen (`api/_internal/app/ecosystem.php:840`) — das entwertete
die ~21 MB Kartennutzlast für jeden Besucher. Eine **Gipfeländerung ist aber beides**: eine
`map_features`-Zeile (also `map_revision`, wie jede Labeländerung heute schon) **und** ein
Auslöser für die Ökosystem-Neuberechnung. Aufgabe 9 löst das **ohne** neue Kopplung im
Ökosystem-Endpunkt.

💣 **9 — Globaler Scope.** 164 klassische `<script>`-Tags teilen sich einen Namensraum; ein
zweites top-level `const` desselben Namens macht die Seite still kaputt. **Jeder neue
Top-Level-Name vor dem Commit gegen `grep -rn "<name>" js/`.**

⚠️ **10 — `region_type` ist in der Flächen-Nutzlast vorhanden** (`api/app/ecosystem-areas.php`
liefert es je Fläche, am 2026-07-28 nachgesehen). Ältere Notizen behaupten das Gegenteil —
für **diese** Nutzlast stimmt es nicht. Trotzdem defensiv lesen: `see` ist der Normalfall,
`gebirge` die Ausnahme.

---

## 4. Regeln

1. 🔴 **Kein Gipfel verschwindet** (§0). Keine Sichtbarkeitsbedingung an `wiki_url`.
2. 🔴 **Keine zweite Positionsliste** (§0). Die Höhe wohnt in `properties_json` des Labels.
3. 🔴 **Keine politische Datei wird BESCHRIEBEN.** Lesen ist seit 2026-07-28 freigegeben.
4. **Deutsch in der Oberfläche, Englisch in Code, Kommentaren und Commits.** Neue Strings der
   **öffentlichen** Oberfläche zusätzlich in `js/app/i18n-en.js`.
   ⚠️ **Editor-Oberflächen sind NICHT lokalisiert** (am 2026-07-28 nachgeprüft: der Label-Dialog
   hat null `data-i18n`, und `i18n-en.js` kennt keinen einzigen Editor-Begriff). Dort **keinen**
   Schlüssel anlegen — er wäre an nichts angeschlossen. Erst prüfen, dann ergänzen.
5. **Kein `?v=` von Hand.** `js/map-features/*` und `js/review/*` hängen an `index.html`, der
   Deploy stempelt sie. `ASSET_VERSION` in `territory-editor-inline-host.js` ist **nicht**
   betroffen — V8 fasst keine dynamisch geladenen Editor-Dateien an.
6. **Farben, Radien und Trenner nur aus `css/base/tokens.css`** (AGENTS.md §12). Kein Blau.
7. **Geteilter Arbeitsbaum:** nie `git add -A`, nur eigene Pfade einzeln.
8. **Abnahme im Browser**, nicht „Tests grün". Es gibt keine lokale Datenbank; jeder DB-Pfad ist
   nur live prüfbar. `?demo=1` mit Attrappen ist das Mittel.
9. 💣 **Karten-Gesten nur mit ECHTEN DOM-Ereignissen.** `map.fire("click")` umgeht die
   Leaflet-Ebene und beweist nichts. Ziehen heißt `mousedown`/`mousemove`/`mouseup` auf dem
   **Layer-Element**, nicht auf der Karte.
10. **JS-Tests:** `node js/map-features/__tests__/<name>.test.js`.
    **PHP-Tests:** `php -d extension=mbstring -d zend.assertions=1 <datei>` — ohne
    `zend.assertions=1` prüft `assert()` **nichts**. `adventure-resolve-candidates` und
    `source-search` sind **vorbestehend rot**; vor dem Loslegen gegen die Basis gegenprüfen.

---

## 5. Offene Fragen — ✅ vom Owner beantwortet 2026-07-28, VOR dem Bau

| Frage | Antwort |
|---|---|
| **1. Wo liegt der Schnitt?** | **Gipfel und Buckelsumme zusammen.** Wörtlich: *„wenn du mehrere gebirgspolygone willst, kann ich testweise welche machen, aber es sollte definitiv zusammen implementiert werden"*. Der Owner hat daraufhin „Random Berge" angelegt (2. Fläche). |
| **2. Gipfel-Sichtbarkeitsregel?** | **Gestrichen.** *„Kein Gipfel darf verschwinden. Gipfel sind teil der Topographie - mit oder ohne WikiLink."* Siehe §0. |
| **3. Wo wird die Höhe eingetragen?** | **In beiden Oberflächen** — Label-Editor im Standard-Layer **und** Landschaften-Panel. Beide schreiben dieselbe Zeile über `update_label`. |

---

## 6. Der Feldname

**`height_schritt`** in `properties_json` des Labels.

Nicht `height`: V11 trägt eine dokumentierte **Einheitenfalle** (×3 → ×23,
`2026-07-24-landschaften.md` V11-Zeile). Ein Feld ohne Einheit im Namen lädt genau dazu ein.
*Schritt* ist Domäneninhalt wie `BF` und wird nicht übersetzt (AGENTS.md §8).

**Wertebereich:** `null` (nicht gesetzt) oder eine endliche Zahl in `[0, 20000]`. Die Obergrenze
ist ein **Tippfehlerschutz** (eine Null zu viel), keine Lore-Aussage. Negatives wird abgelehnt.

> 🔴 **Standardhöhe 5.000 Schritt** (Owner-Entscheid 2026-07-28, nach dem Bau):
> *„gib den gipfeln ne standardhöhe von 5000 schritt, aber die müssen wir natürlich editieren
> können. sobald ein ort ‚Gipfel/Vulkan' ist, kriegt er einen slider"*.
>
> Zwei Stellen, ein Wert: `ECOSYSTEM_HEIGHT_DEFAULT` im Höhenmodul (womit die Karte einen
> unerfassten Gipfel zeichnet) und der Regler im Label-Dialog (womit er vorbelegt ist). Sie
> müssen übereinstimmen — sonst zeigt das Feld etwas anderes an, als die Karte rechnet.
>
> 🪤 Der Standard greift **nur bei leerem Feld**. Ein Gipfel mit erfasster Höhe behält sie, auch
> wenn der Dialog nur geöffnet wird; alles andere wäre stiller Datenverlust bei jedem Blick.

---

## 7. Aufgaben

### Aufgabe 1: Server nimmt die Höhe entgegen

**Dateien:** `api/_internal/map/features.php` (ändern, bei `:2249` und in `create_label`) ·
`api/_internal/map/__tests__/label-height-test.php` (neu)

**Erzeugt:** `avesmapsReadOptionalPeakHeight(mixed $value): ?float` — `null` bei leer/ungültig,
sonst der geklemmte Wert.

- [x] **Schritt 1: Den Test schreiben, der fehlschlägt.**

```php
<?php
declare(strict_types=1);
require_once __DIR__ . '/../features.php';

assert(avesmapsReadOptionalPeakHeight(null) === null, 'null stays null');
assert(avesmapsReadOptionalPeakHeight('') === null, 'empty string clears the field');
assert(avesmapsReadOptionalPeakHeight('  ') === null, 'blank string clears the field');
assert(avesmapsReadOptionalPeakHeight(3000) === 3000.0, 'plain number survives');
assert(avesmapsReadOptionalPeakHeight('3000') === 3000.0, 'numeric string survives');
assert(avesmapsReadOptionalPeakHeight('3000,5') === 3000.5, 'German decimal comma is accepted');
assert(avesmapsReadOptionalPeakHeight(-1) === null, 'negative is rejected, not clamped to 0');
assert(avesmapsReadOptionalPeakHeight(20001) === 20000.0, 'typo guard clamps the upper end');
assert(avesmapsReadOptionalPeakHeight('abc') === null, 'garbage is rejected');
assert(avesmapsReadOptionalPeakHeight(INF) === null, 'non-finite is rejected');
echo "label-height: all assertions passed\n";
```

- [x] **Schritt 2: Lauf, er muss fehlschlagen.**
      `php -d extension=mbstring -d zend.assertions=1 api/_internal/map/__tests__/label-height-test.php`
      Erwartet: `Call to undefined function avesmapsReadOptionalPeakHeight`.

- [x] **Schritt 3: Die Leserin schreiben**, neben `avesmapsReadOptionalOtherSource` in
      `api/_internal/map/features.php`:

```php
// A peak's own height, in Schritt. Optional: null means "not recorded", which is NOT the same as
// zero -- an unrecorded peak falls back to a default when the height field is built, a peak
// recorded as 0 does not. The upper bound is a typo guard (one zero too many), not lore.
function avesmapsReadOptionalPeakHeight(mixed $value): ?float {
    if ($value === null || (is_string($value) && trim($value) === '')) {
        return null;
    }
    if (is_string($value)) {
        $value = str_replace(',', '.', trim($value));
    }
    if (!is_numeric($value)) {
        return null;
    }
    $height = (float) $value;
    if (!is_finite($height) || $height < 0) {
        return null;
    }

    return min($height, 20000.0);
}
```

- [x] **Schritt 4: Den bewachten Zweig einhängen** in `avesmapsUpdateLabelFeature`, direkt nach
      dem `other_source`-Block (`:2276`). 💣 **`array_key_exists`, nie `??`** — Falle 4:

```php
        // 💣 Only when the caller sends the key. Same rule as other_source above: a save that does
        // not mention the height must not erase it. See the 2026-07-28 incident in that comment.
        if (array_key_exists('height_schritt', $payload)) {
            $height = avesmapsReadOptionalPeakHeight($payload['height_schritt']);
            if ($height === null) {
                unset($properties['height_schritt']);
            } else {
                $properties['height_schritt'] = $height;
            }
        }
```

- [x] **Schritt 5: Denselben Zweig in `avesmapsCreateLabelFeature`** einhängen, damit ein über
      „Höhenpunkt setzen" angelegter Gipfel seine Höhe sofort mitbringen kann. Stelle: dort, wo
      `create_label` die übrigen `properties` zusammensetzt.

- [x] **Schritt 6: Tests laufen lassen.**
      `php -d extension=mbstring -d zend.assertions=1 api/_internal/map/__tests__/label-height-test.php`
      Erwartet: `all assertions passed`.

- [x] **Schritt 7: Commit.**

```bash
git add api/_internal/map/features.php api/_internal/map/__tests__/label-height-test.php
git commit -m "feat(labels): accept an optional height_schritt on peak labels without clobbering display values"
```

---

### Aufgabe 2: Die Höhe im Label-Dialog (Standard-Layer)

**Dateien:** `js/review/review-labels.js` (ändern: `populateLabelEditForm` `:16`,
`buildLabelEditPayload` `:287`) · das Dialog-Markup, das der Dialog befüllt (im selben Modul
gesucht) · `js/app/i18n-en.js` (ergänzen)

**Verbraucht:** `height_schritt` aus Aufgabe 1.

- [x] **Schritt 1: Das Feld ins Dialog-Markup**, als eigene Zeile mit Trenner nach dem Muster
      der Nachbarfelder. Beschriftung **„Höhe (Schritt)"**, `name="height_schritt"`,
      `type="number"`, `min="0"`, `max="20000"`, `step="1"`, leer erlaubt. Farben und Radien nur
      aus `css/base/tokens.css`.

- [x] **Schritt 2: Nur für `berggipfel` zeigen.** Die Zeile wird ein-/ausgeblendet, wenn sich
      `feature_subtype` ändert — dieselbe Mechanik, mit der der Dialog heute schon
      typabhängige Teile schaltet (`applyLabelTypeVocabulary` `:110`). Bei jedem anderen Subtyp
      bleibt sie verborgen **und der Schlüssel wird nicht gesendet** (Falle 4).

- [x] **Schritt 3: Befüllen.** In `populateLabelEditForm` den vorhandenen Wert aus
      `labelEntry.properties.height_schritt` in das Feld schreiben; fehlt er, bleibt es leer.
      **Leer ≠ 0.**

- [x] **Schritt 4: Senden.** In `buildLabelEditPayload` den Schlüssel **nur dann** in die
      Nutzlast legen, wenn der Subtyp `berggipfel` ist:

```js
	// 💣 Only ever send the key for peaks, and only when the row is actually in the form. The server
	// treats a present key as "the caller means it" (array_key_exists), so sending it for a
	// non-peak label would write a height onto something that has no business carrying one.
	if (payload.feature_subtype === "berggipfel") {
		const rawHeight = String(formData.get("height_schritt") ?? "").trim();
		payload.height_schritt = rawHeight === "" ? null : rawHeight;
	}
```

- [x] **Schritt 5: ~~`js/app/i18n-en.js` ergänzen~~ — ENTFÄLLT, am 2026-07-28 nachgeprüft.**
      Der Label-Dialog trägt **null** `data-i18n`-Attribute (230 gibt es in `index.html`, keines
      in diesem Dialog), und `i18n-en.js` enthält **keinen einzigen** Editor-Begriff — weder
      „Priorität" noch „Nodix". Die i18n-Schicht deckt die **öffentliche** App ab; die
      Editor-Oberflächen sind bewusst nur deutsch. Ein Schlüssel hier wäre der einzige
      Editor-String in der Tabelle und an nichts angeschlossen.
      **Regel 4 gilt also für öffentliche Oberflächen, nicht für Editor-Dialoge** — für
      Aufgaben 3 und 5 ebenso zu prüfen, statt sie mechanisch zu ergänzen.

- [x] **Schritt 6: Im Browser prüfen** (`?edit=1`, ohne Login prüfbar): Dialog an einem
      `berggipfel` öffnen → Zeile da; an einem `wald`-Label → Zeile weg. Subtyp im offenen
      Dialog umstellen → Zeile erscheint/verschwindet. Nutzlast über einen gestubbten
      Schreibweg sichtbar machen und zeigen, dass `height_schritt` **nur** beim Gipfel drin ist.

- [x] **Schritt 7: Commit.**

```bash
git add js/review/review-labels.js js/app/i18n-en.js
git commit -m "feat(labels): let the label dialog record a peak height in Schritt"
```

---

### Aufgabe 3: Die Höhe im Landschaften-Panel

**Dateien:** `js/map-features/map-features-ecosystem-properties.js` (ändern) ·
`js/app/i18n-en.js`

Dasselbe Feld, dieselbe Zeile in der Datenbank, andere Oberfläche (Owner-Entscheid 3).

- [x] **Schritt 1:** Im Panel einen Abschnitt „Gipfel" ergänzen, der die Gipfel **innerhalb der
      gewählten Fläche** listet (Name, Höhe). Gefunden über den bbox-Vorfilter: Punkt-Labels
      haben `min_x = max_x`, ihre bbox **ist** ihre Position (`oekosystem-editor-leitfaden.md`
      §1.4, Z. 218–219). Danach exakt mit `pointInGeometry` prüfen.
- [x] **Schritt 2:** Je Zeile ein Höhenfeld mit eigenem Speichern-Knopf und eigener Statuszeile
      — das Muster des Strömungsfaktors bei den Flusswegen
      (`oekosystem-editor-verhalten.md` §9). **Kein Entwurfszustand.**
- [x] **Schritt 3:** Speichern sendet `update_label` mit `public_id` und `height_schritt`.
      💣 Der vorhandene Umbenenn-Pfad schickt den **vollen Darstellungssatz** (`:463`); dieser
      Pfad schickt ihn **auch**, sonst wirft der Server das Label auf Standardgrößen zurück
      (Falle 4 wirkt in beide Richtungen — der Schutz aus Aufgabe 1 deckt nur die Höhe, nicht
      `size`/`priority`). Den vorhandenen Aufruf als Vorlage nehmen, nicht neu erfinden.
- [x] **Schritt 4:** Neue UI-Strings nach `js/app/i18n-en.js`.
- [x] **Schritt 5: Im Browser prüfen** über `?demo=1`: Fläche wählen → Gipfelliste → Höhe
      eintragen → Statuszeile → Nutzlast enthält `public_id`, `height_schritt` **und** den
      Darstellungssatz.
- [x] **Schritt 6: Commit.**

```bash
git add js/map-features/map-features-ecosystem-properties.js js/app/i18n-en.js
git commit -m "feat(ecosystem): edit peak heights from the landscape panel, writing the same label row"
```

---

### Aufgabe 4: Gipfel in der Topographie-Ebene — sichtbar und ziehbar

> 🔴 **BEIM BAUEN GEÄNDERT (2026-07-28): kein neues Modul.** Der Plan sah eine eigene
> Gipfel-Markerebene vor. Beim Lesen des Bestands zeigte sich, dass es sie schon gibt: der
> Label-Layer zeichnet die `berggipfel` bereits, `setLabelMoveActive` schaltet das Ziehen frei
> und `saveLabelPosition` schreibt `move_label` auf dieselbe Zeile. Eine zweite Markerebene
> wäre genau die **zweite Ansicht desselben Objekts**, die §0 verbietet — der vorhandene Marker
> **ist** der Gipfel. Statt eines Moduls also drei Erweiterungen:
>
> 1. `isEcosystemLabelMuted` bekommt eine Ausnahme: ein `berggipfel` ist in der **Topographie**
>    kein fremdes Label, sondern deren Arbeitspunkt.
> 2. `css/features/ecosystem-layer.css` nimmt für ihn die Klickdurchlässigkeit der Labels-Pane
>    zurück (`.map-label--eco-peak`), samt Greifzeiger.
> 3. `syncEcosystemPeakDragging` schaltet das Ziehen an der Ebene fest — ohne den einmaligen
>    Verschiebemodus, weil das Ziehen hier die Hauptarbeit ist und nicht der Sonderfall.

**Dateien:** `js/map-features/map-features-ecosystem-layer-switch.js` ·
`js/map-features/map-features-labels.js` · `css/features/ecosystem-layer.css` — alle **geändert**,
keine neue Datei, kein neuer Script-Tag.

**Erzeugt:** `isEcosystemPeakLabel(publicId)` · `isEcosystemPeakActive(publicId)` ·
`syncEcosystemPeakDragging()`

- [x] **Schritt 1:** Alle `berggipfel`-Labels sammeln — **alle 62, ohne Wiki-Filter** (§0).
      `height` ist `properties.height_schritt ?? null`.
- [x] **Schritt 2:** Sie zeichnen, wenn `activeEcosystemLayerKind === "topographie"`
      (`map-features-ecosystem-layer-switch.js:42`). Bei jeder anderen Ebene nicht.
- [x] **Schritt 3: Ziehen** schreibt `move_label` auf **dieselbe Zeile** — kein eigener
      Speicherpfad, keine Kopie (§0). Beim Loslassen sofort, ohne Nachfrage
      (`oekosystem-editor-verhalten.md` §9).
- [x] **Schritt 4: Klick** öffnet das Panel aus Aufgabe 3 mit Name und Höhe.
- [x] **Schritt 5:** 💣 Neue Top-Level-Namen gegen `grep -rn "collectEcosystemPeaks\|
      renderEcosystemPeakLayer\|refreshEcosystemPeakLayer" js/` prüfen — muss leer sein.
- [x] **Schritt 6: Im Browser prüfen** mit **echten** DOM-Ereignissen (Regel 9): `mousedown` /
      `mousemove` / `mouseup` auf dem **Layer-Element**. Ebene umschalten → Gipfel verschwinden
      und kommen wieder. Prüfen, dass die Standardkarte unverändert bleibt.
- [x] **Schritt 7: Commit.**

```bash
git add js/map-features/map-features-ecosystem-layer-switch.js js/map-features/map-features-labels.js css/features/ecosystem-layer.css
git commit -m "feat(ecosystem): show and drag every peak label in the topography layer"
```

**💣 Zwei Fallen, beim Bauen aufgelaufen und behoben — beide würden sich wiederholen:**

1. **`marker.dragging` entsteht erst in `onAdd`.** In `createLabelMarkerEntry` ist es davor
   `undefined`; `marker.dragging?.enable()` war dort eine **stille Nulloperation** — kein
   Fehler, keine Wirkung, und genau der frisch angelegte Gipfel klebte fest. Der Aufruf muss
   **nach** `syncLabelMarkerVisibility(entry)` stehen.
2. **`dragend` darf einen Dauergipfel nicht stilllegen.** Der vorhandene Handler ruft
   `setLabelMoveActive(entry, false)`; auf einen dauerhaft ziehbaren Gipfel angewandt liesse er
   sich **genau einmal** verschieben. Der Handler steigt für aktive Gipfel vorher aus.

**🪤 Prüffalle (kein Produktfehler):** synthetische `mousemove`/`mouseup` **nie auf `document`**
feuern. Leaflet merkt sich `e.target` als `_lastTarget` und fasst beim Aufräumen dessen
`className` an — `document.className` gibt es nicht, und der Zug stirbt mit
`Cannot read properties of undefined (reading 'baseVal')`. Ziel ist das **Marker-Element**.

---

### Aufgabe 5: „Höhenpunkt setzen" im Kartenkontextmenü

**Dateien:** `js/map-features/map-features-ecosystem-context-action.js` (ändern) ·
`css/components/map-context-menu.css` (ändern) · `js/app/i18n-en.js`

- [x] **Schritt 1:** Einen Eintrag **„Höhenpunkt setzen"** in „Hier hinzufügen" hängen, sichtbar
      nur bei aktiver Topographie-Ebene. „Hier" ist der rechtsgeklickte Punkt (`:214`).
- [x] **Schritt 2:** Er legt per `create_label` ein `berggipfel`-Label an. **Ohne Wiki-Link — und
      es erscheint trotzdem auf der Standardkarte** (§0). Name: der Editor tippt ihn; leer ist
      erlaubt.
- [x] **Schritt 3:** 💣 **Glyphenregel** in `css/components/map-context-menu.css` ergänzen (Falle
      5), im Block ab `:56`. Vorschlag `content: "\25B2"` (▲) — falls belegt (`:60`), eine freie
      Dreiecksvariante wählen und die Wahl im Kommentar begründen.
- [x] **Schritt 4:** Prüfen, dass die Beschriftung **nicht** in die Symbolspalte rutscht:
      `getComputedStyle` auf dem Eintrag, die Textspalte muss ~41 px messen, nicht 12
      (V7-Messung).
- [x] **Schritt 5:** Test in `js/map-features/__tests__/ecosystem-context-menu.test.js`
      erweitern — der Eintrag erscheint bei `topographie` und fehlt bei `vegetation`.
      Lauf: `node js/map-features/__tests__/ecosystem-context-menu.test.js`.
- [x] **Schritt 6: Im Browser prüfen:** echtes `contextmenu`-Ereignis auf dem Kartencontainer.
- [x] **Schritt 7: Commit.**

```bash
git add js/map-features/map-features-ecosystem-context-action.js css/components/map-context-menu.css js/app/i18n-en.js js/map-features/__tests__/ecosystem-context-menu.test.js
git commit -m "feat(ecosystem): add a \"Hoehenpunkt setzen\" context entry with its glyph rule"
```

---

### Aufgabe 6: Das Höhenfeld einer Fläche (Portierung)

**Dateien:** `js/map-features/map-features-ecosystem-height-field.js` (neu) ·
`js/map-features/__tests__/ecosystem-height-field.test.js` (neu) · `index.html`

**Erzeugt:**
- `ecosystemHeightCellHash(seed, level, ix, iy, salt) → [0,1)`
- `buildEcosystemPeakWindow(peaks) → {sample(x, y) → [0,1], separation}`
- `buildEcosystemHeightField(area, peaks, peakWindow, options) → field`
- `sampleEcosystemHeightField(field, x, y, noiseWindow = 1) → Zahl`

**Verbraucht:** `distanceToEcosystemEdge`, `pointInGeometry`, `ecosystemGeometryBounds`.

> 🔴 **Warum das Gipfelfenster ein eigenes Objekt ist und nicht im Feld steckt:** es muss über
> **alle** Flächen gerechnet werden, nicht je Fläche (Falle 2). Aufgabe 7 baut genau **eines**
> und reicht dasselbe an jede Fläche weiter. `noiseWindow` ist deshalb ein Parameter von
> `sampleEcosystemHeightField`, kein gespeicherter Zustand — ohne Angabe `1`, damit eine
> einzelne Fläche für sich testbar bleibt.

- [x] **Schritt 1: Die Tests schreiben, die fehlschlagen.**

```js
const assert = require("assert");
const { buildEcosystemHeightField, sampleEcosystemHeightField, buildEcosystemPeakWindow,
	ecosystemHeightCellHash } = require("../map-features-ecosystem-height-field.js");

const square = { type: "Polygon", coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]] };
const area = { public_id: "a", geometry: square, geometry_revision: 1 };

// One area on its own: build its field with a window over its own peaks, and read it back
// through that same window. Task 7 does exactly this, only with the peaks of EVERY area.
function fieldOf(theArea, peaks, options) {
	const window = buildEcosystemPeakWindow(peaks);
	const built = buildEcosystemHeightField(theArea, peaks, window, options);
	return { built, at: (x, y) => sampleEcosystemHeightField(built, x, y, window.sample(x, y)) };
}

// 1. Deterministic: the same seed gives the same field, always.
assert.strictEqual(ecosystemHeightCellHash(7, 0, 3, 4, 1), ecosystemHeightCellHash(7, 0, 3, 4, 1));
assert.notStrictEqual(ecosystemHeightCellHash(7, 0, 3, 4, 1), ecosystemHeightCellHash(7, 0, 3, 4, 2));

// 2. A peak reads its OWN height at its own position -- the window erases the noise there,
//    and it erases it with ZERO SLOPE, so the high point does not wander off the peak.
const one = fieldOf(area, [{ publicId: "p", x: 50, y: 50, height: 3000 }]);
assert.ok(Math.abs(one.at(50, 50) - 3000) < 1, "the peak carries exactly its own height");
assert.ok(one.at(50, 50) >= one.at(52, 50) && one.at(50, 50) >= one.at(50, 52),
	"the peak is the local maximum, not a point next to it");

// 3. The foot is zero: on the boundary nothing is left. This is the invariant that a
//    single-ring distEdge would break.
for (const [x, y] of [[0, 50], [100, 50], [50, 0], [50, 100]]) {
	assert.strictEqual(one.at(x, y), 0, `edge (${x},${y}) is flat`);
}

// 4. A hole is an edge too. A peak near the hole must not lean into it.
const withHole = { type: "Polygon", coordinates: [
	[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
	[[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]],
] };
const holed = fieldOf({ public_id: "b", geometry: withHole, geometry_revision: 1 },
	[{ publicId: "q", x: 30, y: 50, height: 3000 }]);
assert.strictEqual(holed.at(50, 50), 0, "the hole stays at zero");

// 5. A peak without a recorded height must not poison the field with NaN.
const noHeight = fieldOf(area, [{ publicId: "r", x: 50, y: 50, height: null }]);
assert.ok(Number.isFinite(noHeight.at(50, 50)), "missing height stays finite");

// 6. Refining keeps the coarse shape standing (the whole point of the per-cell hash).
const peak = [{ publicId: "p", x: 50, y: 50, height: 3000 }];
const coarse = fieldOf(area, peak, { levels: 1 });
const fine = fieldOf(area, peak, { levels: 3 });
assert.ok(Math.abs(coarse.at(20, 20) - fine.at(20, 20)) < 0.35 * coarse.at(20, 20) + 1,
	"refining adds detail, it does not grow the mountain");

// 7. Two peaks in ONE area keep their separation: neither bump reaches the other, so each
//    still reads its own number. Task 7 asserts the same across areas.
const twoPeaks = fieldOf(area, [
	{ publicId: "hi", x: 30, y: 50, height: 5000 },
	{ publicId: "lo", x: 70, y: 50, height: 3000 }]);
assert.ok(Math.abs(twoPeaks.at(30, 50) - 5000) < 1, "the high peak stays 5000");
assert.ok(Math.abs(twoPeaks.at(70, 50) - 3000) < 1, "the low peak stays 3000, it is not lifted");

console.log("ecosystem-height-field: all assertions passed");
```

- [x] **Schritt 2: Lauf, er muss fehlschlagen.**
      `node js/map-features/__tests__/ecosystem-height-field.test.js` → `Cannot find module`.

- [x] **Schritt 3: Portieren.** `cellHash` `:402`, `level` `:413`, `peakWindow` `:452`,
      `rawArea` `:464`, `buildArea` `:491` — **wortgleich in der Rechnung**, mit diesen
      Abweichungen:
      - `distEdge` → `distanceToEcosystemEdge(point, geometry)` (Falle 3). Die Prototyp-Fassung
        wird **nicht** mitkopiert.
      - `inPoly(px, py, a.ring)` → `pointInGeometry` — beide Male, in `level` und in `buildArea`.
      - `a.ring` gibt es nicht mehr: die Fläche ist Polygon **oder** MultiPolygon. Die bbox
        kommt aus `ecosystemGeometryBounds` (**snake_case**, Falle in §1).
      - Die Pixelmaske (`:560–570`) und `W`/`H` **entfallen** — das Modul rechnet in
        Kartenkoordinaten `0..1024`, nicht auf einer Leinwand fester Größe (Falle 6).
      - `rauschen === 0` **wortgleich** übernehmen, samt Begründung (Falle 7).
      - Saat: `mesh_seed` aus `public_id + Geometrie-Revision`, deterministisch
        (`oekosystem-instruction.md` §4.2). **Kein `Math.random()`.**
      - Fehlende Höhe: der Prototyp setzt `1000` (`:509`). Übernehmen und **kommentieren**,
        dass das ein Platzhalter ist, kein Messwert.
      - 🔴 **`peakWindow` und `sep` wandern nach draußen.** Im Prototyp sind beide an *eine*
        Fläche gebunden (`a.peakBumps` `:454`, die `sep`-Doppelschleife `:500–502`). Hier
        werden sie zu `buildEcosystemPeakWindow(peaks)`, das **einmal für alle** gebaut wird
        (Falle 2). Es liefert `sample(x, y)` — die Rechnung von `:452–462` **wortgleich** — und
        `separation`, den kleinsten Abstand zwischen zwei Gipfeln.
      - `buildEcosystemHeightField` nimmt das Fenster entgegen und benutzt `separation` für die
        Radiusklemme `Math.min(distanceToEcosystemEdge(...), .72 * separation, 150)` (`:510`).
        💣 **Nur Gipfel INNERHALB der Fläche werden zu Buckeln** (`:508`) — aber **alle** Gipfel
        klemmen und fenstern. Das ist der ganze Unterschied zum Prototyp.
      - Warum `0,72` die Sache trägt: ist jeder Buckelradius kleiner als `0,72 ×` dem Abstand
        zum nächsten Gipfel, dann **reicht kein Gipfelbuckel bis zu einem anderen Gipfel**.
        Damit liest jeder Gipfel genau seine eigene Zahl — ohne jede Sonderbehandlung. Das ist
        der Grund, warum Aufgabe 7 so klein ausfällt.
      - 🔴 **Woher der Rauschpegel kommt.** Der Prototyp zieht ihn aus `a.avg`, einem Regler je
        Fläche (`:532`). Den gibt es hier nicht: die Höhe wohnt am Gipfel (Owner-Entscheid 3),
        nicht an der Fläche. **Abgeleitet statt eingegeben:**
        `avg = 0,4 × niedrigster Gipfel DIESER Fläche`. Damit überragt erfundenes Gelände nie
        einen benannten Gipfel — dieselbe Absicht wie `avgMax = minG` im Prototyp (`:530–531`),
        nur ohne Regler.
        **Eine Fläche ohne Gipfel bekommt kein Feld** und bleibt flach; ein Gebirge ganz ohne
        Stützpunkt zu erfinden wäre genau das „erfundene Geländedetail", vor dem
        `oekosystem-instruction.md` §4.1 warnt.
        ⚠️ `0,4` ist ein **Startwert, nach Augenmaß zu prüfen** (Aufgabe 8, Schritt 5), keine
        gemessene Größe. 💣 Ein `max_height` je Fläche, wie ihn `oekosystem-instruction.md`
        §4.2 voraussetzt, wird **absichtlich nicht** eingeführt — das wäre ein neues Datenfeld
        plus Editor-Oberfläche und ist vom Owner nicht beauftragt. Wenn sich beim Zeichnen
        zeigt, dass Flächen ohne Gipfel gebraucht werden, ist das eine **eigene Frage an den
        Owner**, keine stille Ergänzung.

> 🔴 **BEIM BAUEN GEÄNDERT (2026-07-28): die Dämpfung wandert HINTER alle Stufen.** Der Prototyp
> bestimmt sie allein aus der groben Stufe (`:521–533`) und wendet sie auf die feinen mit an — die
> feinen kommen also **obendrauf**. Er weiß das und mildert es mit ×0,35 statt ×0,5 (`:535–538`),
> behebt es aber nicht. **Hier nachgemessen: derselbe Berg wuchs von 1 auf 3 Stufen um 85 %.**
>
> Das ist genau der Fehler, vor dem `oekosystem-instruction.md` §4.1 warnt — „wie fein modelliere
> ich" darf das Ergebnis nicht verändern, sonst verzerrt die Modellierungstiefe selbst die
> Reisezeiten. Wird über **alle** Stufen gemessen und **einmal** gedämpft, ist `levels` ein reiner
> Detailregler. **Nachher gemessen: 3,8 % Abweichung von 1 auf 4 Stufen** (Mittelwert über die
> Fläche: 867,6 → 900,6 Schritt), und der Gipfel liest weiterhin exakt `3000.000`.
>
> 🪤 Und der zugehörige Test misst den **Mittelwert über die Fläche**, nie einen einzelnen Punkt: an
> einer Stelle SOLL das feinere Feld abweichen, dafür sind die Stufen da. Die erste Fassung verglich
> einen Punkt und schlug an einem korrekten Feld fehl.

- [x] **Schritt 4: Tests laufen lassen**, bis alle zehn grün sind.
- [x] **Schritt 5:** Script-Tag in `index.html`, **nach** `map-features-ecosystem-geometry.js`.
      Namen gegen `grep -rn` über `js/` prüfen (Falle 9).
- [x] **Schritt 6: Commit.**

```bash
git add js/map-features/map-features-ecosystem-height-field.js js/map-features/__tests__/ecosystem-height-field.test.js index.html
git commit -m "feat(ecosystem): port the bump-sum height field, edge distance over all rings"
```

---

### Aufgabe 7: Flächen summieren — mit EINEM Gipfelfenster über alles

**Dateien:** `js/map-features/map-features-ecosystem-height-combine.js` (neu) ·
`js/map-features/__tests__/ecosystem-height-combine.test.js` (neu) · `index.html`

**Erzeugt:**
- `buildEcosystemHeightStack(areas, peaks) → stack` (`peaks` ist die **flache** Liste aller
  Gipfel aus `collectEcosystemPeaks()`, Aufgabe 4 — die Zuordnung zu Flächen passiert hier)
- `sampleEcosystemHeightStack(stack, x, y) → Zahl`

`stack` ist genau:

```js
{
	peakWindow,        // das EINE Objekt aus buildEcosystemPeakWindow(peaks)
	fields,            // Array der Felder aus buildEcosystemHeightField, eines je Fläche MIT Gipfel
	areaIdsByField,    // public_id je Eintrag in `fields`, gleiche Reihenfolge -- Aufgabe 9 braucht
	                   // sie, um gezielt EINE Fläche neu zu bauen statt aller
}
```

💣 `fields` enthält **keinen** Eintrag für gipfellose Flächen (Aufgabe 6). `fields.length` ist
deshalb **nicht** `areas.length` — wer über `areas` indiziert, greift daneben.

Die ganze Regel:

```
W(x,y) = EIN Gipfelfenster über ALLE Gipfel ALLER Flächen      // 0 am Gipfel, 1 weit weg
h(x,y) = Σ über alle Flächen F:  sampleEcosystemHeightField(feld_F, x, y, W(x,y))
```

Mehr nicht. Kein Enthaltensein-Test, kein Baum, keine Eltern-Kind-Fensterung.

**Warum das genügt** — der Punkt, an dem eine frühere Fassung dieses Plans danebenlag:

- **Die Überlappung türmt nicht.** Jede Fläche läuft an ihrem eigenen Rand auf 0 aus. Wo zwei
  sich überlappen, sind **beide** nahe ihrem Fuß; die Summe füllt dort den Sattel, statt zwei
  Gipfelhöhen zu stapeln. Das ist die Überblendung zweier Züge, und sie entsteht von selbst.
- **Wie gut sie aussieht, hängt am Überlappungsstreifen, nicht an der Rechnung.** Schmal →
  sichtbare Kerbe zwischen zwei Bergen. Breit → ein Zug. Das ist eine **Zeichenanleitung**
  (Aufgabe 10 schreibt sie in `oekosystem-editor-verhalten.md`), keine Rechenregel.
- **Der 8.000-Schritt-Turm entsteht nur an einer einzigen Stelle:** wenn der *Gipfelpunkt* der
  einen Fläche in der anderen liegt. Dagegen wirkt die Radiusklemme aus Aufgabe 6: weil jeder
  Gipfelbuckel kleiner ist als `0,72 ×` dem Abstand zum nächsten Gipfel — und `sep` jetzt
  **global** gerechnet wird —, **reicht kein Gipfelbuckel bis zu einem anderen Gipfel**. Das
  Rauschen erledigt `W`. Beides zusammen heißt: **jeder Gipfel liest genau seine eigene Zahl**,
  egal wie viele Flächen sich dort überlagern.
- `W` hat am Gipfel **Steigung null** (`peakWindow` `:452` ist quadratisch im Abstand, nicht
  linear). Bloßes Abschwächen genügte nicht — der Hochpunkt wanderte trotzdem weg.

- [x] **Schritt 1: Die Tests schreiben, die fehlschlagen.**

```js
const assert = require("assert");
const { buildEcosystemHeightStack, sampleEcosystemHeightStack } =
	require("../map-features-ecosystem-height-combine.js");

const box = (x0, y0, x1, y1) => ({ type: "Polygon",
	coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });

// Two ranges that OVERLAP in the strip 80..120 -- the owner's case: they merge into one range.
// The high one is 5000, the low one 3000, and the question the tests answer is what the ground
// does between them.
const high = { public_id: "high", geometry: box(0, 0, 120, 100), geometry_revision: 1 };
const low  = { public_id: "low",  geometry: box(80, 0, 240, 100), geometry_revision: 1 };
const peaks = [
	{ publicId: "ph", x: 40, y: 50, height: 5000 },
	{ publicId: "pl", x: 200, y: 50, height: 3000 },
];
const stack = buildEcosystemHeightStack([high, low], peaks);
const at = (x, y) => sampleEcosystemHeightStack(stack, x, y);

// 1. 💣 THE assertion: each peak reads its OWN number. Not 8000, not 4200, not 5000 for both.
assert.ok(Math.abs(at(40, 50) - 5000) < 1, `the 5000 peak stays 5000, got ${at(40, 50)}`);
assert.ok(Math.abs(at(200, 50) - 3000) < 1, `the 3000 peak stays 3000, got ${at(200, 50)}`);

// 2. A peak inside the OTHER area's footprint still reads its own number. Move the low peak
//    into the overlap strip: two areas cover it, and it must still be exactly 3000.
const overlapped = buildEcosystemHeightStack([high, low], [
	{ publicId: "ph", x: 40, y: 50, height: 5000 },
	{ publicId: "pl", x: 100, y: 50, height: 3000 }]);
const atOverlapped = sampleEcosystemHeightStack(overlapped, 100, 50);
assert.ok(Math.abs(atOverlapped - 3000) < 1,
	`a peak covered by two areas must not be inflated, got ${atOverlapped}`);

// 3. Between the two peaks there is a SADDLE: below both, but clearly above zero. A notch down
//    to nothing would mean two separate mountains, which is what the merge is supposed to avoid.
const saddle = at(120, 50);
assert.ok(saddle < 3000, `the saddle is lower than the lower peak, got ${saddle}`);
assert.ok(saddle > 0, `the saddle is not a notch down to zero, got ${saddle}`);

// 4. No cliff where one area's edge falls inside the other. Crossing the low area's left edge
//    (x = 80) must be smooth, because that area's own field is zero there anyway.
const insideBoth = at(80.5, 50);
const highOnly = at(79.5, 50);
assert.ok(Math.abs(insideBoth - highOnly) < 50,
	`an area edge must not be a cliff (${insideBoth} vs ${highOnly})`);

// 5. Each peak is the local maximum -- the high point does not wander off it.
for (const [px, py] of [[40, 50], [200, 50]]) {
	const here = at(px, py);
	for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
		assert.ok(here >= at(px + dx, py + dy) - 1e-9,
			`peak (${px},${py}) must be the local maximum`);
	}
}

// 6. Outside everything is zero, and an area without any peak stays flat rather than inventing
//    a mountain (see Task 6: the noise level is derived from the peaks of that area).
assert.strictEqual(at(400, 400), 0, "empty ground is flat");
const peakless = buildEcosystemHeightStack(
	[{ public_id: "empty", geometry: box(300, 300, 400, 400), geometry_revision: 1 }], []);
assert.strictEqual(sampleEcosystemHeightStack(peakless, 350, 350), 0,
	"an area with no recorded peak stays flat");

// 7. Deterministic: same input, same answer.
assert.strictEqual(at(120, 50),
	sampleEcosystemHeightStack(buildEcosystemHeightStack([high, low], peaks), 120, 50));

console.log("ecosystem-height-combine: all assertions passed");
```

- [x] **Schritt 2: Lauf, er muss fehlschlagen.**
- [x] **Schritt 3: Den Stapel bauen.** `buildEcosystemHeightStack(areas, peaks)`:
      1. **Ein** `buildEcosystemPeakWindow(peaks)` über **alle** Gipfel — nicht je Fläche.
      2. Je Fläche die Gipfel bestimmen, die in ihr liegen (`pointInGeometry`; bbox-Vorfilter
         über `ecosystemGeometryBounds` davor, das spart den teuren Test für die meisten).
         💣 Ein Gipfel darf in **mehreren** Flächen liegen — das ist erlaubt und wird nicht
         entdoppelt; er wird in jeder zu einem Buckel.
      3. Je Fläche `buildEcosystemHeightField(area, peaks, window, options)` — mit der
         **vollständigen** Gipfelliste, damit Klemme und Fenster global bleiben.
      4. Flächen **ohne** Gipfel bekommen kein Feld und liefern überall 0. Kein erfundenes
         Gebirge ohne einen einzigen Stützpunkt.
- [x] **Schritt 4: Das Abtasten bauen.** `W` **einmal** je Abfragepunkt rechnen, dann über die
      Flächen summieren:

```js
// One window for the whole point, then a plain sum. Areas overlap freely: each is zero at its
// own edge, so an overlap fills the saddle instead of stacking two summits. The window is what
// keeps a named peak reading its own number when several areas cover it.
function sampleEcosystemHeightStack(stack, x, y) {
	const noiseWindow = stack.peakWindow.sample(x, y);
	let height = 0;
	for (let i = 0; i < stack.fields.length; i++) {
		height += sampleEcosystemHeightField(stack.fields[i], x, y, noiseWindow);
	}
	return height;
}
```

      💣 Indizierte Schleife, kein `for..of` — das läuft in der Malschleife
      hunderttausendfach, und jede Iterator-Allokation kostet dort mehr als die Rechnung
      (Prototyp `:576–577`, dort gemessen: 47 ms statt 8,6).

- [x] **Schritt 5: Tests laufen lassen**, bis alle sieben grün sind.
      `node js/map-features/__tests__/ecosystem-height-combine.test.js`
- [x] **Schritt 6:** Script-Tag in `index.html` **nach** `…-height-field.js`. Namen gegen
      `grep -rn "buildEcosystemHeightStack\|sampleEcosystemHeightStack" js/` prüfen — muss leer
      sein.
- [x] **Schritt 7: Commit.**

```bash
git add js/map-features/map-features-ecosystem-height-combine.js js/map-features/__tests__/ecosystem-height-combine.test.js index.html
git commit -m "feat(ecosystem): sum overlapping areas under one global peak window"
```

---

### Aufgabe 8: Das Höhenfeld zeichnen

**Dateien:** `js/map-features/map-features-ecosystem-height-render.js` (neu) · `index.html` ·
`css/base/tokens.css` (nur falls ein Farbton fehlt — **erst Token, dann benutzen**)

- [x] **Schritt 1:** Bei aktiver Topographie-Ebene das Feld über die `gebirge`-Flächen legen.
      **`is_trial`-Flächen mitzeichnen** — beide Livebeispiele sind Erprobungsflächen (§2.2),
      ohne sie zeigt die Abnahme nichts.
- [x] **Schritt 2: Farbrampe.** Die `STOPS` des Prototyps (`:589`) sind warm und passen zur
      Designsprache — aber sie sind **hartkodierte Hex-Werte**. AGENTS.md §12 verbietet das:
      erst Token in `css/base/tokens.css` anlegen, dann über `readEcosystemColorToken`
      (`map-features-ecosystem-rendering.js:45`) lesen. **Kein Blau.**
- [x] **Schritt 3: Bezugshöhe je Fläche**, nicht global (`:602–607`): sonst färbt das Verstellen
      einer Fläche jede andere um.
- [x] **Schritt 4: Budget.** Die Deckel des Prototyps (`ZELLEN_MAX = 240000`,
      `BUCKEL_MAX = 14000`, `:544`) übernehmen. Wo das Budget gegriffen hat, **sagt es die
      Oberfläche**, statt still weniger zu liefern (`:541–543`).
- [x] **Schritt 5: Messen und berichten** — Bildzeit in ms für beide `gebirge`-Flächen, in der
      Abnahme genannt. Keine geschätzte Zahl.
- [x] **Schritt 6: Im Browser prüfen** (`?demo=1` plus die zwei echten Flächen): Ebene an →
      Relief da; Ebene aus → weg; Gipfel ziehen → Feld folgt.
- [x] **Schritt 7: Commit.**

```bash
git add js/map-features/map-features-ecosystem-height-render.js index.html css/base/tokens.css
git commit -m "feat(ecosystem): draw the height field over mountain areas, per-area colour reference"
```

---

### Aufgabe 9: Die Invalidierungskante

**Dateien:** `js/map-features/map-features-ecosystem-peaks.js` (ändern) ·
`js/map-features/map-features-ecosystem-height-render.js` (ändern)

Jede Gipfeländerung — **verschieben, anlegen, löschen, Höhe ändern** — macht das Höhenfeld der
**enthaltenden** Fläche ungültig (`oekosystem-editor-leitfaden.md` Z. 204–207,
`oekosystem-editor-verhalten.md` §8).

- [x] **Schritt 1:** 💣 **Keine neue Server-Kopplung.** `ecosystem_revision` darf `map_revision`
      nicht anfassen und umgekehrt (Falle 8). Die Invalidierung ist in dieser Stufe
      **clientseitig**: nach einem erfolgreichen `move_label` / `create_label` /
      `update_label` an einem `berggipfel` wird das zwischengespeicherte Feld der
      enthaltenden Fläche verworfen und neu gebaut.
- [x] **Schritt 2: Nur die enthaltende Fläche**, nicht alle — „derselbe begrenzte Nachlauf".
      Beim **Verschieben über eine Grenze** sind es **zwei**: die alte und die neue. Ein
      Gipfel, der in keiner Fläche liegt, invalidiert nichts.
- [x] **Schritt 3: Im Browser prüfen:** Gipfel innerhalb einer Fläche ziehen → nur diese wird
      neu gebaut (über einen Zähler oder `console`-Ausgabe belegen). Gipfel aus der Fläche
      heraus ziehen → **beide** betroffenen werden neu gebaut.
- [x] **Schritt 4:** Eine serverseitige Vorberechnung ist **nicht** Gegenstand (§8) — der
      Kommentar im Code sagt das, damit die nächste Sitzung nicht danach sucht.
- [x] **Schritt 5: Commit.**

```bash
git add js/map-features/map-features-ecosystem-peaks.js js/map-features/map-features-ecosystem-height-render.js
git commit -m "fix(ecosystem): rebuild only the affected areas when a peak moves, is added or is edited"
```

---

### Aufgabe 10: Die Doku zieht nach

**Dateien:** `docs/oekosystem-editor-leitfaden.md` · `docs/oekosystem-editor-verhalten.md` ·
`docs/oekosystem-instruction.md` · `docs/superpowers/plans/2026-07-24-landschaften.md` ·
`api/_internal/app/ecosystem.php` (nur der Kommentar `:65`)

⚠️ **`html/editor-handbuch.html` NICHT anfassen** — es gehört der Nachtroutine
`avesmaps-handbuch-pflege` (AGENTS.md §9). Pflicht ist nur eine Commit-Betreffzeile, die die
sichtbare Wirkung nennt; das haben die Aufgaben 2–5 bereits.

- [x] **Schritt 1: Leitfaden §1.4** — die Sichtbarkeitsregel (Z. 187–191) streichen und durch
      den Owner-Entscheid ersetzen: **jeder Gipfel bleibt sichtbar, mit oder ohne Wiki-Eintrag.**
      Die Begründung („mehr Stützpunkte als ein Leser sehen will") **stehen lassen** und den
      Gegenentscheid danebenstellen — die Erwägung war richtig, die Folgerung nicht.
- [x] **Schritt 2: Verhalten §8** — Z. 494–495 („die auf der öffentlichen Karte nicht
      erscheinen") streichen. Die Gestentabelle um „Höhe eintragen" in **beiden** Oberflächen
      ergänzen.
- [x] **Schritt 3: Verhalten §9** — „Höhe — noch nicht gebaut (V8)" (Z. 518) durch den gebauten
      Stand ersetzen: eigenes Feld, eigener Knopf, eigene Statuszeile.
- [x] **Schritt 4: Die Zeichenanleitung aufschreiben**, in `oekosystem-editor-verhalten.md` bei
      §5 („Eine Fläche bearbeiten"). Sie folgt aus der Rechnung und ist das Einzige, was der
      Editor über das Verschmelzen wissen muss:
      > **Sollen zwei Gebirge zu einem Zug verschmelzen, lass sie sich großzügig überlappen.**
      > Jede Fläche läuft an ihrem eigenen Rand auf null aus; im Überlappungsstreifen füllen
      > sich die beiden Füße gegenseitig zum Sattel auf. Ein schmaler Streifen ergibt eine
      > sichtbare Kerbe zwischen zwei Bergen, ein breiter einen durchgehenden Zug. Die Höhen
      > selbst spielen dabei keine Rolle: ein 3.000er neben einem 5.000er zieht diesen nicht
      > herunter, und jeder benannte Gipfel behält seine eingetragene Zahl.
- [x] **Schritt 5: Die vier falschen Zahlen korrigieren** — `oekosystem-instruction.md:207`
      („23 berggipfel auf 60 gebirge"), die V8-Zeile („34 Gipfel auf 61 Gebirge"), die V5-Zeile
      („gebirge (60)") und `api/_internal/app/ecosystem.php:65` („34 labels"). Richtig ist:
      **62 `berggipfel`-Labels, 68 `gebirge`-Labels, 2 `gebirge`-Flächen** (Stand 2026-07-28).
      Dabei **ausdrücklich** dazuschreiben, dass die alten Zahlen Labels zählten und Flächen
      meinten — sonst wird derselbe Fehler nachgezählt.
- [x] **Schritt 6: Die V8-Zeile abhaken** und die gemessenen Zahlen aus Aufgabe 8 eintragen.
      💣 Die Zeile behauptet heute „Enthaltensein-Fensterung statt `max` oder Summe". Das ist
      durch den Owner-Entscheid **überholt** — sie wird auf „Flächen summieren, Gipfelfenster
      global" berichtigt, sonst schickt sie die nächste Sitzung in dieselbe Sackgasse.
- [x] **Schritt 7: Commit.**

```bash
git add docs/oekosystem-editor-leitfaden.md docs/oekosystem-editor-verhalten.md docs/oekosystem-instruction.md docs/superpowers/plans/2026-07-24-landschaften.md api/_internal/app/ecosystem.php
git commit -m "docs(ecosystem): peaks stay visible without a wiki link, and correct four wrong stock counts"
```

---

## 8. Nicht Gegenstand

- **Serverseitige Vorberechnung** des Höhenfelds. Das ist **V9** (`path_ecosystem`), mit
  eigener Sperre, eigenem Budget und eigener Leasing-Falle.
- **Terrain auf Kantengewichte.** Das ist **V11** — die gefährlichste Stufe, drei Slice-Stellen,
  Einheitenfalle, Nachweis ist ein Netzlauf. V8 liefert nur das Feld.
- **Geschwindigkeitsvektoren** (**V12**), **„Führt durch"** (**V10**).
- **`sampleRoute()`.** Gehört zu V11 und wird dort neu geschrieben, nicht kopiert (Falle 1).
- **Ein `relief`-Enum an der Fläche.** Ausdrücklich abgewählt (Leitfaden §1.4, Z. 162–168): es
  wiederholte, was die Gipfel sagen, könnte ihnen widersprechen, und wäre gleichmäßig, wo das
  Gelände es nicht ist.
- **Die fehlenden ~66 `gebirge`-Flächen zeichnen.** V8 baut das Werkzeug; womit es gefüttert
  wird, ist Redaktionsarbeit. Die V5-Kachelableitung greift bei Gebirgen **nicht** (Land/Wasser-
  Schwelle).
- **Eine zweite Positionsliste** in jeder Form (§0).

---

## 9. Fertigkriterium

1. Ein `berggipfel` trägt eine Höhe, eingetragen in **beiden** Oberflächen, und sie überlebt ein
   fremdes Speichern am selben Label.
2. Alle **62** Gipfel sind in der Topographie-Ebene sichtbar und ziehbar; die **Standardkarte
   zeigt weiterhin jeden von ihnen**.
3. „Höhenpunkt setzen" legt einen Gipfel an — mit Glyphe, ohne verrutschte Beschriftung.
4. Das Höhenfeld steht über „Finsterkamm" und „Random Berge", mit **gemessener** Bildzeit.
5. Zwei überlappende Gebirge **verschmelzen**: der 5.000er behält 5.000, der 3.000er behält
   3.000 — **auch wenn er innerhalb beider Flächen liegt** —, und dazwischen liegt ein
   **Sattel** statt einer Kerbe oder eines Turms (Unit-Tests 1–3 in Aufgabe 7).
6. Eine Gipfeländerung baut **nur** die betroffenen Flächen neu.
7. Die Doku widerspricht dem Gebauten nicht mehr — insbesondere nicht bei der Sichtbarkeit.
