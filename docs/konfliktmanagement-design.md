# Konfliktmanagement — Gesamtkonzept

> Stand: 2026-07-20 · Status: **Entwurf, nicht gebaut** · Auslöser: Discord #38
> Entwurf der Oberfläche: `verify-konfliktzentrum.html` (lokale Entwurfsdatei im
> Wurzelverzeichnis, wie die übrigen `verify-*.html` **nicht** eingecheckt)
>
> Gegengelesen am 2026-07-20: 41 Code-Behauptungen geprüft, 14 waren falsch,
> veraltet oder überzogen. Alle Korrekturen sind eingearbeitet und im Text mit
> „⚠️ Korrektur nach Gegenprüfung" bzw. in §7 durch die Spalte *Stand* markiert.
> **Die zwei kräftigsten Negativaussagen des ersten Entwurfs waren beide falsch**
> (`sync_type` „nie geschrieben", Regions-Typkonflikt „zeigt nirgends").

## 1. Warum

Avesmaps führt Daten aus zwei Welten zusammen: die eigene Karte und das Wiki
Aventurica. Überall dort, wo beide Seiten dasselbe Ding beschreiben, können sie
sich widersprechen. Heute wird ein solcher Widerspruch entweder

- gar nicht bemerkt (der Server rät still etwas zusammen), oder
- bemerkt, aber nirgends angezeigt (eine Prüffunktion existiert, ihr Ergebnis
  landet in keiner Oberfläche), oder
- angezeigt, aber nur für Siedlungen und nur direkt nach einem Sync-Lauf.

Das Ziel ist **ein Ort, an dem Editoren alle Widersprüche sehen und selbst
auflösen können** — objektartübergreifend, jederzeit, ohne Owner.

### Der Auslöser, als Beleg

Am 2026-07-20 ergab eine Messung am Live-Payload: **12 Gruppen mit 30 Orten**
teilen sich einen Wiki-Link, 20 davon sind falsch. Kein einziger dieser Fälle
stand in einer Oberfläche. Sieben entstehen bei jedem Seitenaufruf neu, dreizehn
stehen so in der Datenbank. Gleichzeitig tragen **119 Orte** einen Wiki-Link, den
nie jemand bestätigt hat.

## 2. Die Leitentscheidung: Konflikte werden berechnet, nicht gelagert

Heute schreibt ein Sync-Lauf Fälle in `wiki_sync_cases`. Das ist eine
Momentaufnahme: was danach passiert, fehlt; was der Server zur Laufzeit
zusammenrät, taucht nie auf. Genau deshalb waren die 30 Dubletten unsichtbar.

**Neu: Eine Regel berechnet den Konflikt aus dem aktuellen Datenstand. Persistiert
wird ausschließlich die Entscheidung des Editors.**

Das ist kein neues Muster, sondern das bereits im Repo bewährte:

| Speicher | Muster |
|---|---|
| `wiki_sync_cases` | vollständig persistiert, an einen Lauf gekoppelt |
| `political_capital_case_status` | „offen" wird berechnet, nur Zurückstellen/Archivieren persistiert |
| `wiki_path_verlauf_case_status` | dito, **plus `course_hash`**: ändert sich das Wiki, öffnet sich ein zurückgestellter Fall von selbst |

Der dritte ist die Vorlage. Wir verallgemeinern ihn.

Folgen:
- Ein behobener Konflikt verschwindet von allein. Keine Karteileichen.
- Ein neu entstandener erscheint sofort, ohne Sync-Lauf.
- Ein zurückgestellter kommt zurück, sobald sich die zugrundeliegenden Fakten ändern.

## 3. Sind die Fälle deterministisch auffindbar?

**Ja, vollständig.** Die Messung vom 2026-07-20 benutzte vier Regeln, alle ohne
jede Bewertung:

| Befund | Regel | Bereits vorhanden? |
|---|---|---|
| 12 geteilte Links | Gruppierung über `properties_json->'$.wiki_url'` | SQL — aber ⚠ JSON-Pfad **ohne Index** |
| 7 „entsteht neu" vs. 13 „gespeichert" | `avesmapsWikiSyncCreateMatchKey(name)` gegen den Schlüssel des Zieltitels | Funktion existiert (`sync.php:233`) |
| 7 Fremdlinks | Host der URL ist nicht das Wiki | Zeichenkettenprüfung |
| 13 Namensabweichungen | derselbe Schlüsselvergleich | s.o. |
| 2 Tippfehler (`Nebensjepengurken`) | Ähnlichkeitsmaß | `similar_text` + `AVESMAPS_WIKI_FUZZY_CUTOFF` existieren |

⚠️ **`wiki_url` ist keine Spalte.** Der Wert steckt in `map_features.properties_json`
(`sql/schema.sql:64-86` kennt kein solches Feld). Jede Regel, die darauf gruppiert,
ist ein **voller Tabellenscan über einen JSON-Pfad** — auf STRATO relevant. Deshalb
läuft die Prüfung als angestoßener Lauf mit Fortschritt („Neu prüfen"), **nicht**
bei jedem Öffnen des Dialogs, und schon gar nicht pro Request.

Nicht deterministisch war einzig die **Bewertung** — ob `Arralcor-Höhle →
Arralcor-Höhen` sachlich falsch ist. Das ist exakt die Entscheidung, die ein
menschlicher Editor treffen soll. **Erkennen ist Maschinenarbeit, Entscheiden ist
Editorenarbeit.** Diese Trennlinie ist das Fundament des ganzen Konzepts.

## 4. Aufbau

### 4.1 Regel-Registry

Vorbild ist `avesmapsLinkCheckProviders` (`api/_internal/linkcheck/providers.php:25`)
— eine echte objektartübergreifende Registry mit Sammlern je Objektart. Ein
zweites, ebenso brauchbares Vorbild ist das Mehrquellen-System:
`avesmapsFeatureSourceLink(PDO, string $entityType, …)` (`feature-sources.php:219`)
verteilt bereits über settlement / region / path / territory.

```php
[
  'id'       => 'settlement.wiki_url.shared',
  'entity'   => 'settlement',
  'label'    => 'Mehrere Orte teilen einen Wiki-Link',
  'hint'     => 'Ein Wiki-Artikel kann nur zu einem Ort gehören.',
  'severity' => 'error',            // error | divergence | unverified
  'detect'   => fn(PDO $pdo): array => [...],
  'actions'  => ['pick_one', 'unlink', 'no_wiki', 'defer', 'ignore'],
]
```

Eine Regel liefert Konflikte in einer einheitlichen Form:

```php
[
  'rule_id'  => 'settlement.wiki_url.shared',
  'parties'  => [                       // n Beteiligte, Objektarten duerfen sich mischen
     ['type' => 'settlement', 'id' => '…', 'label' => 'Feste Hohenstein'],
     ['type' => 'settlement', 'id' => '…', 'label' => 'Feste Hohenstein (Weiden)'],
  ],
  'title', 'severity', 'facts', 'candidates', 'fields',
]
```

Die Objektart-Filter der Oberfläche lesen `parties` — ein Konflikt zwischen einer
Siedlung und einem Territorium taucht deshalb unter beiden auf.

### 4.2 Fingerabdruck statt Lauf-Kopplung

```
fingerprint = sha256(rule_id | entity_id | die widersprüchlichen Fakten)
```

Die Entscheidung hängt am Fingerabdruck. Ändern sich die Fakten, ändert sich der
Fingerabdruck, und der Konflikt öffnet sich automatisch neu. Das ist der
`course_hash`-Trick, verallgemeinert.

### 4.3 Ein neuer Tabellensatz — genau einer

```sql
conflict_decision (
  id            BIGINT UNSIGNED AUTO_INCREMENT,
  rule_id       VARCHAR(80)  NOT NULL,
  fingerprint   CHAR(64)     NOT NULL,   -- deckt ALLE Beteiligten + die Fakten ab
  decision      VARCHAR(20)  NOT NULL,   -- resolved | deferred | ignored
  subject_type  VARCHAR(30)  NOT NULL,   -- Hauptbeteiligter, nur zum Nachschlagen
  subject_id    VARCHAR(64)  NOT NULL,   -- public_id | uuid | wiki_key, IMMER Text
  acted_type    VARCHAR(30) NULL,        -- woran die Entscheidung tatsaechlich schrieb
  acted_id      VARCHAR(64) NULL,
  detail_json   JSON NULL,               -- u. a. die vollstaendige Beteiligtenliste
  reviewed_at   DATETIME(3),
  reviewed_by   BIGINT UNSIGNED NULL,
  UNIQUE KEY uq (rule_id, fingerprint),
  KEY idx_subject (subject_type, subject_id)
)
```

`subject_id` ist bewusst **Text**: `missing_capital` hat bereits bewiesen, dass
Ganzzahl-IDs nicht verallgemeinern (dort ist es eine UUID, und die Oberfläche
muss deshalb heute auf `source: 'political'` verzweigen).

### Ein Konflikt hat Beteiligte, nicht ein Objekt

Owner-Hinweis 2026-07-20: **es gibt Konflikte zwischen Siedlungen und Territorien.**
Ein Konflikt ist deshalb nie „ein Objekt hat ein Problem", sondern **eine Regel über
n Beteiligten** — und die können verschiedene Objektarten haben. Beispiele:

- eine Siedlung ist einem Territorium zugeordnet, dessen Geometrie sie gar nicht enthält
- eine Hauptstadt liegt außerhalb ihres eigenen Reiches
- ein Abenteuer-Ort zeigt auf eine gelöschte Siedlung

Deshalb ist die **Identität eines Konflikts `(rule_id, fingerprint)`** und nicht
`(rule_id, Objekt)`. Der Fingerabdruck deckt alle Beteiligten mit ab; `subject_*` ist
nur ein Index zum Nachschlagen („was hängt an diesem Ort?"), `acted_*` hält fest, wo
die Entscheidung tatsächlich hingeschrieben hat — bei „Hauptstadt falsch" kann das je
nach Entscheidung das Territorium **oder** die Siedlung sein.

> 💡 Das kostet nichts, weil **Konflikte berechnet und nicht abgefragt** werden (§2).
> Der Erkenner liefert sie im Speicher — Hunderte, nicht Millionen. Filtern nach
> Objektart ist damit ein Array-Filter über die Beteiligtenliste, keine Datenbank-
> Abfrage. Ein Konflikt mit einer Siedlung und einem Territorium erscheint unter
> **beiden** Objektarten, ohne dass es dafür eine Verknüpfungstabelle braucht.

### 4.4 Was mit `wiki_sync_cases` passiert

**Nichts — zunächst.** Die Tabelle bleibt, der Sync-Lauf schreibt weiter. Sie
wird schlicht *eine Quelle unter mehreren* in der Registry, genau so wie
`missing_capital` heute schon clientseitig dazugemischt wird
(`review-wiki-sync.js:101-110`). Keine Migration, kein Datenverlust, kein
Big-Bang.

> ⚠️ `wiki_sync_cases.sync_type` wird bei **jedem** INSERT geschrieben — aber
> immer auf die fest verdrahtete Konstante `AVESMAPS_WIKI_SYNC_TYPE_LOCATION`
> (`locations-helpers.php:494`, `:503`) und **nie wieder gelesen** (alle
> `WHERE sync_type`-Klauseln im Repo zielen auf `wiki_sync_runs`, nicht auf
> `_cases`). Dieselbe Konstante ist auch der **erste Bestandteil von `case_key`**
> (`locations.php:616-623`). Die Identität der Tabelle ist damit strukturell auf
> Orte festgelegt — das ist der Grund, warum der neue Entscheidungsspeicher
> separat ist.

## 5. Das Entscheidungs-Vokabular

Acht Verben, objektartunabhängig. Jede Regel gibt an, welche sie anbietet.

| Verb | Bedeutung | Schreibt |
|---|---|---|
| **Übernehmen** | Wiki gewinnt — je Feld oder komplett | den Wert |
| **Behalten** | Unseres gewinnt | einen echten Override, damit es nicht wiederkommt |
| **Auswählen** | Bei N Kandidaten: wer behält die Verknüpfung | Verknüpfung + Trennung der übrigen |
| **Trennen** | Verknüpfung entfernen | löscht die Verknüpfung |
| **Umhängen** | Der Link ist gültig, steht nur im falschen Feld | verschiebt ihn nach „Andere Quelle" |
| **Kein Wiki-Eintrag** | Es gibt dort nichts, hör auf zu suchen | eine **negative Aussage** |
| **Zurückstellen** | Zu wenig Information für eine fundierte Entscheidung | Entscheidung + Fingerabdruck |
| **Ignorieren** | Bewusst so gelassen | Entscheidung → Status *archiviert* |

**Umhängen** ist Owner-entschieden (2026-07-20): die sieben
`herzogtum-weiden.net`-Links sind gültige Quellen im falschen Feld. „Andere
Quelle" meint dabei die **Oberflächen-Bezeichnung**; technisches Ziel ist das
Mehrquellen-System `feature_sources`, nicht das abgelöste `other_source`-Feld.

> ⚠️ Korrektur nach Gegenprüfung: `avesmapsFeatureSourcesTakeoverOtherSource`
> (`feature-sources.php:244`) ist dafür **nicht** verwendbar — die Funktion ist
> fest auf den Alt-Schlüssel `other_source` verdrahtet (`:259`, `:269`) und steigt
> für Territorien früh aus (`:246`). Die passenden Bausteine sind die beiden
> Aufrufe, die sie umschließt: `avesmapsFeatureSourceUpsert` und
> `avesmapsFeatureSourceLink` (`:267-268`) — letzterer setzt bereits von sich aus
> `origin = 'manual'` (`:219`), genau was hier gebraucht wird.

## 5a. Der Statusbegriff

Vier Status, vom Owner definiert (2026-07-20). Entscheidend: **Status ist keine
gespeicherte Spalte, sondern ergibt sich aus zwei unabhängigen Fragen** — besteht
der Konflikt gerade noch, und hat ein Mensch schon entschieden?

| Besteht der Konflikt? | Entscheidung | Status | Bedeutung |
|---|---|---|---|
| ja | keine | **offen** | sollte gemacht werden |
| ja | zurückgestellt | **zurückgestellt** | zu wenig Information |
| ja | entschieden / ignoriert | **archiviert** | bewusst so gelassen, Konflikt besteht weiter |
| nein | vorhanden | **erledigt** | Daten sind repariert, der Fall bleibt als Historie |

Das löst den Widerspruch zwischen „Konflikte werden berechnet" und „bei *erledigt*
ist nur noch der Fall da": Der **Erkenner** beantwortet die linke Spalte, der
**Entscheidungssatz** die mittlere. Erst zusammen ergeben sie den Status.

Zwei Folgen, die bewusst so sind:

- **Archiviert bleibt sichtbar und wiederherstellbar.** Genau wie in der heutigen
  Konfliktlösung (`reopen_case`) kann ein Editor nachsehen und den Fall
  zurückholen, um ihn doch zu lösen.
- **Ändern sich die Fakten, wird aus *archiviert* wieder *offen*.** Der
  Fingerabdruck passt dann nicht mehr, die alte Entscheidung gilt nicht für den
  neuen Sachverhalt. Dasselbe gilt für *zurückgestellt*.
- **Wer die Daten außerhalb des Werkzeugs repariert, erzeugt keine Historie.** Ohne
  Entscheidungssatz ist ein verschwundener Konflikt schlicht keiner mehr. Wollten
  wir auch das als *erledigt* sehen, müssten wir jeden je gesehenen Konflikt
  wegschreiben — das wäre wieder die Momentaufnahme, die wir gerade abschaffen.

Ein Ignorieren gilt **für alle Editoren**, nicht pro Person (Owner, 2026-07-20).

### Wer hat entschieden

Bei *erledigt*, *zurückgestellt* und *archiviert* steht der Editor dabei, der die
Entscheidung getroffen hat, mit Datum — als Zeile am Fall: „zurückgestellt von
Valentin · 20.07.". Die Felder dafür sind bereits im Entwurf (`reviewed_by`,
`reviewed_at`, §4.3) und im Bestand vorhanden (`wiki_sync_cases` führt beide
mit, `political_capital_case_status` ebenfalls). Zu ergänzen ist nur die
Auflösung auf den Anzeigenamen und die Darstellung.

Bei *offen* steht dort nichts — es hat ja noch niemand entschieden.

**„Kein Wiki-Eintrag" ist der wichtigste Neuzugang.** Heute löscht ein geleertes
Feld den Schlüssel (`api/_internal/map/features.php:1137`), und die Anreicherung
kann „bewusst geleert" nicht von „nie gesetzt" unterscheiden — deshalb kommt ein
gelöschter Link zurück. Das ist die eigentliche Wurzel von #38.

### Overrides bleiben erhalten

Die Vorlage existiert und ist erprobt: `adventure.field_origins_json`. Ein Feld
mit `origin = 'manual'` wird vom Wiki-Abgleich übersprungen
(`avesmapsAdventureReconcileEntity`, Vertrag im Docblock `adventure-sync.php:546-548`,
Prüfung z. B. `:579`), Orte werden nur mit `WHERE origin = 'wiki'` angefasst
(`:638`, `:650`), `status = 'suppressed'` ist ein Grabstein, der nie wiederbelebt wird.
Dieselbe Mechanik gilt für Publikationsquellen und Karten. **Wir erfinden nichts
— wir ziehen sie auf die übrigen Objektarten durch.**

## 6. Die Oberfläche

Ein Knopf **„⚖️ Konflikte"** direkt neben **„📥 Dump holen"** (`index.html:345-357`),
mit einer Dauerzeile darunter („36 offen · 83 ungeprüft"). Er öffnet einen Dialog.

> ⚠️ Korrektur nach Gegenprüfung: Das zweizeilige `.btn2`-Muster (`.t1`/`.t2`)
> existiert **nicht** in `index.html` und auch nicht in `css/`. Es lebt als
> `.ae-btn2` ausschließlich im `<style>`-Block von
> `html/adventure-editor.html:71-83`. Der Nachbarknopf „Dump holen"
> (`index.html:352`) benutzt `wiki-sync-panel__start`. Für P0 heißt das: entweder
> an `wiki-sync-panel__start` anschließen, oder die Zweizeiligkeit erst als
> gemeinsame Klasse nach `css/` heben. **Der Entwurf zeigt die Zweizeiligkeit —
> sie ist also Arbeit, kein vorhandenes Muster.**

```
┌ Konflikte ───────────────── geprüft vor 2 Min · 9 Regeln ── [Neu prüfen] [×] ┐
│ Objektart      │  ●16 Fehler   ●20 Abweichungen   ○83 ungeprüft              │
│  Alle    119   │                                                             │
│  Siedlungen119 │  ● Mehrere Orte teilen einen Wiki-Link      12 Gr · 30 Orte │
│  Territorien 4 │    Ein Wiki-Artikel kann nur zu einem Ort gehören.          │
│  Wege       12 │    ┌ Feste Hohenstein ───────────────────────────────────┐  │
│  Regionen    7 │    │ Ort 1 bestätigt      │ Ort 2 keine Verbindung       │  │
│  …             │    │ Feste Hohenstein     │ Feste Hohenstein (Weiden)    │  │
│                │    │ [Ort 1 behält][Ort 2 behält][Kein Wiki-Eintrag] …   │  │
│ Schweregrad    │    └─────────────────────────────────────────────────────┘  │
│ Status         │  ● Weicht vom Wiki ab                          20 Objekte   │
│  offen      36 │    Feld | Avesmaps | Wiki | Übernehmen   ← Zeile für Zeile  │
│  zurückgest. 4 │  ○ Link nie bestätigt                  ◀ 12 von 83 ▶        │
│  erledigt   61 │    Havena → Havena       [Bestätigen][Trennen][Zurückst.]   │
│  archiviert  7 │    Warteschlange — der nächste Fall rückt nach              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Drei Dinge sind bewusst so:

1. **Gruppiert nach Regel, nicht nach Objekt.** Ein Editor arbeitet eine Sorte
   Problem am Stück ab — das ist schneller und die Entscheidungen werden
   konsistenter.
2. **Keine Sammelaktionen für Entscheidungen — jeder Fall wird einzeln
   entschieden** (Owner, 2026-07-20). Die Regel trennt sauber zwischen zweierlei:
   wo es **etwas zu entscheiden gibt**, entscheidet ein Mensch je Fall; wo
   **nichts widersprüchlich ist**, darf weiterhin ein Lauf durchziehen (siehe
   „Alle sauberen anwenden" bei den Wegen, §8 P4). Massen-Zurückstellen und
   Massen-Archivieren gibt es nicht — das sind Entscheidungen.

   Damit 83 Einzelentscheidungen trotzdem zumutbar bleiben, ist die
   Gruppe „Link nie bestätigt" eine **Warteschlange statt einer Liste**: ein Fall
   groß im Fokus, Zähler „12 von 83", die Entscheidungsknöpfe immer sichtbar
   (kein Aufklappen), Tastaturkürzel, und nach der Entscheidung rückt der nächste
   Fall nach, ohne dass die Seite springt. Die Geschwindigkeit kommt aus dem
   Ablauf, nicht aus einem Sammelknopf.
3. **Die Felddivergenz ist eine Tabelle mit einer Entscheidung je Zeile**, plus
   „Alle übernehmen" und „Nur Wiki-Link übernehmen". Von Hand gepflegte Felder
   sind sichtbar gesperrt (🔒) statt still überschrieben.

### Was dabei repariert wird

- `matches.slice(0, 2)` (`review-wiki-sync-cases.js:561`) zeigt bei einer Dublette
  nur die ersten **zwei** Orte. „Das Erbe von Blaustein" hat fünf. **Alle zeigen.**
- Es gibt kein Blättern; alle Fälle werden gerendert. **Blättern einbauen.**
- Archivierte Fälle sammeln sich laufübergreifend für immer an
  (`locations.php:691`). Das ist mit dem Statusbegriff aus §5a **richtig so** —
  archiviert heißt „bewusst so gelassen, Konflikt besteht weiter", und das muss
  nachschlagbar bleiben. Also **nicht** abschneiden, sondern **blättern**.
- Die Sortierreihenfolge der Fallarten steht an **drei** Stellen und widerspricht
  sich (SQL `locations.php:694`, PHP `locations-helpers.php:12`, JS
  `review-wiki-sync-cases.js:349`). **Eine Quelle.**

## 7. Die Regeln zum Start

Viele Prüfungen existieren bereits — aber **weniger, als ich zunächst behauptet
habe**. Nach der Gegenprüfung unterscheidet diese Tabelle drei Zustände sauber:
*fertig* (Aufzählfunktion vorhanden, nur ohne Warteschlange), *Teil* (etwas
existiert, taugt aber nicht direkt als Erkenner) und *neu*.

| Objektart | Regel | Stand |
|---|---|---|
| Siedlung | mehrere Orte teilen einen Wiki-Link | **neu**; überschneidet sich teils mit `duplicate_wiki_title` (`locations.php:526-537`), das aber über Namens-Match statt über gespeicherte `wiki_url` geht |
| Siedlung | Link ohne bestätigte Verbindung | **neu** |
| Siedlung | Link zeigt auf Nicht-Wiki-Domain | **neu** |
| Siedlung | Name weicht vom Zielartikel ab | **neu**, nutzt `similar_text` (`locations.php:420`) + `AVESMAPS_WIKI_FUZZY_CUTOFF` |
| Siedlung | bestätigt verbunden, aber kein Link sichtbar | **neu** |
| Siedlung | die 11 bestehenden Fallarten | **fertig** — `wiki_sync_cases` |
| Territorium | fehlende Hauptstadt | **fertig** — `avesmapsPoliticalListCapitalCases` (`territories-read.php:183`) |
| Territorium | Hierarchie-Divergenz | **fertig** — `avesmapsWikiSyncMonitorHierarchyDiff` (`sync-monitor-model.php:513`) |
| Territorium | Geometrie-Kollision | **Teil** — `…ReadGeometryCollision` (`territories-geometry-inventory.php:216`) ist eine **Punktprobe** und braucht `x`/`y`; ein Erkenner muss alle Fälle aufzählen können |
| Territorium | verwaiste Außengrenzen | **Teil** — liegt woanders: `territories-debug.php:232-268` (`orphaned_active_derived`) |
| Territorium | Anzeige-Vererbung (Albenhus/Zwerch) | **fertig** — `…CompareDisplaySnapshotToGlobal` (`territories-debug.php:354`) |
| Weg | Verlauf geändert · Konflikt · Ort fehlt · nicht routbar | **fertig, aber eigene Oberfläche** (`review-path-sync.js`) — ⚠ siehe §8 P4 |
| Weg | Befahrbarkeit fehlt | **neu** — es existiert keinerlei Prüfung |
| Region | Art ≠ Label-Subtyp | **fertig und bereits sichtbar** — `avesmapsWikiRegionTypeConflict` (`regions.php:85`) wird mit ⚠-Präfix gerendert (`review-region-sync.js:219-222`) und lässt die Massenzuordnung das Paar überspringen (`regions.php:816-818`) |
| Region | dieselbe Wiki-Region mehrfach zugeordnet | **fertig** — `…ReadMapLabelsByWikiRegion` (`regions.php:916`) |
| Abenteuer | unaufgelöste Orte | **fertig** — `adventure-resolve.php` |
| Karte | Dubletten | **erledigt** — `avesmapsCitymapDedupeByWikiKey` (`citymap-sync.php:612`); der Bug wurde am 2026-07-18 mit `84b52c42` behoben |
| Quelle | `wiki_key`-Kollision | **fertig** — `avesmapsSourceWikiKeyReport` (`feature-sources.php:546`), löst über drei Wege auf (stored / hash / url), nur ohne Oberfläche |
| Wappen | Lizenz unbekannt | **neu** — `…CountPendingLicenses` (`sync-monitor-licenses.php:189`) liefert nur ein `COUNT(*)`; die aufzählende Abfrage fehlt ganz |
| **Siedlung × Territorium** | Ort liegt außerhalb des Territoriums, dem er zugeordnet ist | **neu** — erste objektartübergreifende Regel; Geometrie liegt in `political_territory_geometry` |
| **Siedlung × Territorium** | Hauptstadt liegt außerhalb ihres eigenen Reiches | **neu**, ergänzt `missing_capital` (das nur *fehlende* findet, nicht *falsche*) |
| **Abenteuer × Siedlung** | Abenteuer-Ort zeigt auf eine gelöschte Siedlung | **Teil** — `adventure-resolve.php` löst auf, meldet aber keinen Bruch |

## 8. Umsetzung in Stufen

Jede Stufe ist für sich nützlich und einzeln lieferbar.

**P0 — Umzug.** Knopf „Konflikte" ins Menüband, Dialog anlegen, die bestehende
Konfliktlösung unverändert hineinziehen. Kein Verhalten ändert sich; sie liegt
nur nicht mehr versteckt im Siedlungen-Reiter. Dazu die Zwei-Orte-Grenze
aufheben.

**P1 — Motor.** Regel-Registry, `conflict_decision`, Fingerabdruck, „Neu prüfen"
mit Fortschritt im Knopf. Die sechs Siedlungsregeln aus §7. Ab hier sind die
119 Fälle bearbeitbar.

**P2 — Vokabular.** Die sieben Verben, insbesondere „Kein Wiki-Eintrag", plus die
Felddivergenz-Tabelle mit „Alle übernehmen" / „Nur Wiki-Link übernehmen" und
gesperrten Handfeldern.

**P3 — Anreicherung entschärfen.** Der Server rät nicht mehr, wenn der Ortsname
einen Klammerzusatz trägt. Damit hört der Nachschub auf (7 Fälle sofort weg).
Erst nach P2, damit „Kein Wiki-Eintrag" als Auffangnetz bereitsteht.

**P4 — Übrige Objektarten anschließen.** Territorien, Wege, Regionen. Überwiegend
Verdrahtung vorhandener Prüfungen — mit zwei Ausnahmen, die vorher entschieden
werden müssen:

- ✅ **Entschieden (Owner, 2026-07-20):** Von den bestehenden Wege-Sammelaktionen
  (`review-path-sync.js:17`) bleibt **„Alle sauberen anwenden"**
  (`avesmapsWikiPathVerlaufApplyCleanCases`, `path-verlauf.php:1600`) — ein
  konfliktfreier Fall enthält keine Entscheidung, nur eine übernommene
  Wiki-Änderung, und der Lauf ist bereits gestückelt. **Massen-Zurückstellen und
  Massen-Archivieren fallen weg.**
- ⚠ Territorien brauchen für Geometrie-Kollision und verwaiste Außengrenzen je
  einen **aufzählenden** Erkenner; das Vorhandene ist eine Punktprobe (§7).

**P5 — Rest + Handbuch.** Abenteuer, Karten, Quellen, Wappen (dort fehlt die
aufzählende Abfrage, §7). Abschnitt im Editor-Handbuch, `Stand:` datieren.

## 9. Bewusst nicht enthalten

- **Kein automatisches Auflösen.** Die Maschine findet, der Mensch entscheidet.
  Genau das automatische Zusammenraten hat #38 verursacht.
- **Kein Ersatz der bestehenden Sync-Läufe.** Sie bleiben, wie sie sind.
- **Keine KI im Erkennungspfad.** Alle Regeln sind SQL oder vorhandene
  PHP-Funktionen — nachvollziehbar, testbar, wiederholbar.
- **Keine neue Objektart-Sonderlogik in der Oberfläche.** Heute verzweigt sie an
  sechs Stellen auf einzelne Fallarten; das war der Grund, warum sie nicht
  wachsen konnte.

## 10. Owner-Entscheidungen (2026-07-20)

1. **Fremdlinks sind „Andere Quelle".** Die Regel bietet *Umhängen* an, nicht
   *Trennen* — der Link bleibt erhalten, wechselt nur ins Mehrquellen-System.
2. **Keine Sammelaktionen.** Jeder Fall wird einzeln gelöst. Die Oberfläche
   antwortet darauf mit einer Warteschlange (§6).
3. **Statusmodell wie in §5a**, Ignorieren führt zu *archiviert* und bleibt
   wiederherstellbar. Gilt für alle Editoren, nicht pro Person.
4. **Bei *erledigt*, *zurückgestellt* und *archiviert* steht der entscheidende
   Editor mit Datum am Fall** (§5a).
5. **Sammelaktionen nur ohne Entscheidungsgehalt.** „Alle sauberen anwenden"
   (Wege) bleibt; Massen-Zurückstellen und Massen-Archivieren fallen weg (§8 P4).

Siehe auch: `docs/refactoring-masterplan.md`, `docs/territories.md`,
`html/editor-handbuch.html`.
