# Design: Die Community meldet Fundorte einer Karte

**Datum:** 2026-07-17 · **Status:** freigegeben, NICHT gebaut
**Auftraggeber-Zitat:** *„ich möchte an dieser stelle, dass die community neue fundorte der externen map
melden können"* · Umfang-Entscheidung: *„Erst Fundorte, ‚ändern' danach"*

## 1. Warum, und was „Fundort" heißt

Eine Karte steckt an mehreren Stellen (F-Shop, Wiki-Seite, Fanprojekt). Seit den Mehrfach-Links kann
`citymap_link` das abbilden — aber **nur ein Editor** kann Fundorte eintragen. Wer beim Lesen einen
weiteren kennt, hat keinen Weg, ihn loszuwerden. `origin='community'` steht seit dem ersten Tag im Schema
und nichts schreibt es.

**Fundort ≠ Quelle.** Die beiden werden verwechselt (der Owner selbst: *„Fundorte (Quellen?)"*), deshalb
hier festgehalten:

| | Was es ist | Tabelle | Beispiel |
|---|---|---|---|
| **Quelle** | das **Werk**, aus dem die Karte stammt | `feature_sources` (geteilter Katalog) | „Herz des Reiches" |
| **Fundort** | ein **Link**, unter dem man sie bekommt | `citymap_link` (+ `is_paid`) | F-Shop-Seite, Wiki-Seite |

Sie überlappen oft, aber nicht immer: die Wiki-Seite ist ein Fundort und keine Quelle. Das Melde-Formular
fragt heute nach der **Quelle** (Pflicht, genau eine) und nach genau **einem** Karten-Link. Fundorte im
Sinne dieser Spec kennt es nicht.

**Wortwahl:** „Fundort" (Owner). Der Editor sagt heute „Fundstelle" — das wird angeglichen, ein Begriff
für eine Sache.

## 2. Der eigentliche Haken: der Melde-Weg kennt nur „neue Karte"

Ein Vorschlag zu einer **bestehenden** Karte existiert nirgends:

- `citymaps-suggest.js` sendet einen Vorschlag ohne jeden Bezug auf eine Karte.
- `map_reports` (`report_type='citymap'`) hält ihn als „das soll eine Karte werden".
- `avesmapsCreateCitymapFromReport` ruft `avesmapsUpsertCitymap` **ohne `public_id`** — das ist immer ein
  INSERT.

Ein „Fundort zu Karte X" hätte also kein Ziel und legte eine zweite Karte an. **Die Report-Schiene
„Vorschlag zu einer bestimmten Karte" ist der Kern dieser Spec** — sie trägt später das volle
Ändern-Formular (eigene Spec).

## 3. Was gebaut wird

### 3.1 Frontend

Unter der Fundort-Liste der aufgeklappten Zeile ein Button **„+ Neuer Fundort"** (soft/outline —
Hauptaktion der Zeile bleibt die Karte selbst). Er öffnet einen eigenen, schlanken Dialog:

```
Neuer Fundort – Hafenviertel

  Bezeichnung *   [ Wiki-Aventurica            ]   ← die Fundstelle, nicht die Karte
  URL *           [ https://…                  ]
  kostenpflichtig ( unbekannt ▾ )
  [ + weiterer Fundort ]

  Notiz an die Redaktion
  [                                            ]
                                [ Vorschlagen ]
```

Mehrere Fundorte auf einmal (▲▼ braucht es nicht — die Reihenfolge bestimmt der Editor). Der Dialog folgt
`citymaps-suggest.js`: derselbe Endpoint, derselbe Honeypot, dasselbe `elapsed_ms`, dasselbe Rate-Limit.

**`is_paid` darf der Melder setzen** — dieselbe Begründung wie im Karten-Formular: es schaltet nichts frei,
es ist eine Beobachtung („das kostet was"). Vorauswahl `unbekannt`; ein erfundenes „frei" wäre der Fehler,
den §3.1 verbietet.

### 3.2 Transport

Neuer `report_type` **`citymap_link`** in `map_reports`, mit `citymap_public_id` im Payload. Kein neuer
Endpoint: `api/app/report-location.php` nimmt ihn wie die Kartenmeldung entgegen.

Ein pures `avesmapsNormalizeCitymapLinkReportPayload` (Vorbild:
`avesmapsNormalizeCitymapReportPayload`) ist die Allowlist — es gibt `{citymap_public_id, links[], note}`
zurück und **sonst nichts**. Was es nicht zurückgibt, kann keine Spalte erreichen. `origin` und `status`
sind ausdrücklich nicht darin: die sind unsere Entscheidung, nicht die des Melders.

### 3.3 Freigabe

`avesmapsAddCitymapLinksFromReport($pdo, $payload, $user)`, Muster von `avesmapsCreateCitymapFromReport`:

- Gate `edit` (nicht `review`) — der Endpoint selbst ist `review`-gegated, und einen Link an eine
  öffentliche Karte zu schreiben ist ein `edit`. Exakt die Begründung, die schon über
  `avesmapsCreateCitymapFromReport` steht.
- Allowlist auf dem **Rückweg** erneut laufen lassen, nicht nur beim Eingang: die Zeile lag seit dem
  Schreiben in der Tabelle, und das hier ist der letzte Punkt vor der Öffentlichkeit.
- **ADDITIV, niemals ersetzend:** `avesmapsSetCitymapLinks` ist tabu — es ersetzt die ganze Liste und
  würde die Fundorte des Editors löschen. Ein neues `avesmapsAddCitymapLink(…, origin: 'community')`
  hängt an.
- Karte weg oder `status='suppressed'` → 404, Report unangetastet.

### 3.4 Melde-Reiter

Zeigt „**2 neue Fundorte für ‚Hafenviertel'**" mit Bezeichnung, URL, `is_paid` und der Notiz;
Freigeben/Ablehnen wie bei den anderen Meldungen.

### 3.5 Karten-Editor sieht fremde Fundorte (Owner-Entscheidung, gleich mitbauen)

Bis heute zeigt die Editor-Liste **nur `origin='manual'`** — und das ist kein Versehen, sondern die
Konsequenz von `set_links`: der Editor postet seine Liste **ohne ids** zurück, also legt er alles, was er
SIEHT, beim Speichern als `'manual'` neu an. Ein Community-Fundort in der editierbaren Liste wäre nach dem
nächsten Speichern doppelt da (einmal `community`, einmal `manual`).

Solange nichts Nicht-Manuelles schrieb, war das unsichtbar. Mit dieser Spec wird es real: ein freigegebener
Fundort erschiene beim Leser und wäre für den Editor **unsichtbar und nicht mehr entfernbar** — ein
Tippfehler oder ein toter Link bliebe für immer stehen.

Deshalb, in derselben Liste, aber **unterhalb einer Trennlinie und nicht editierbar**:

```
  ▲▼ [ Wiki-Aventurica ][ https://… ][ nein ▾ ] ✕     ← manual: wie gehabt
  ───────────────────────────────────────────────
  Fanprojekt XY ↗   [Community]      [Unterdrücken]   ← fremd: nur lesen
```

- Der Detail-Read liefert fremde Fundorte **getrennt** (`foreign_links`), damit sie gar nicht erst in
  `state.links` landen können — die Trennung ist im Payload, nicht erst in der UI. `set_links` sieht sie
  nie und kann sie folglich nicht duplizieren.
- Neue Action **`suppress_link`**, Vorbild `avesmapsSuppressCitymapPlace` — **Tombstone**
  (`status='suppressed'`), kein DELETE: eine gelöschte Zeile gräbt der nächste Wiki-Sync wieder aus. Die
  Regel dort ist bereits „alles, was NICHT `manual` ist, wird tombstoned" und gilt hier wörtlich.
- Das schließt zugleich die Lücke, die der Wiki-Sync (Mehrfachlink-Spec §6.6) sonst aufgerissen hätte.

## 4. Die Fallen

1. **`set_links` ersetzt.** Die Freigabe MUSS additiv schreiben. `avesmapsSetCitymapLinks` löscht alle
   `origin='manual'`-Zeilen — ein Community-Report, der da durchliefe, wäre ein Datenverlust, den niemand
   bemerkt, bis ein Editor seine Fundorte vermisst.
2. **`origin` kommt nie vom Melder.** Die Allowlist gibt es nicht zurück; die Freigabe stempelt
   `'community'`. Sonst schreibt sich ein Vorschlag als `'manual'` und der Editor hält ihn für seinen.
3. **Fremde Fundorte dürfen `state.links` nie erreichen** (§3.5). Der Detail-Read liefert sie in einem
   eigenen Feld; landeten sie in der editierbaren Liste, dupliziert das nächste Speichern sie als
   `'manual'`. Die Trennung gehört in den Payload, nicht in die UI — eine UI-Regel vergisst man beim
   nächsten Umbau, ein getrenntes Feld nicht.
4. **`suppress_link` tombstoned, es löscht nicht.** Eine gelöschte Wiki-Zeile gräbt der nächste Sync
   wieder aus — genau der Bug, gegen den `avesmapsSuppressCitymapPlace` seine Regel bekam.
5. **Kein Ort-Feld.** Der Vorschlag hängt an einer Karte, nicht an einem Ort. `citymap_place` ist eine
   andere Frage („was zeigt die Karte?") und hat hier nichts zu suchen.

## 5. Test

- `avesmapsNormalizeCitymapLinkReportPayload` ist pure → Unit-Test (`citymap-link-report-test.php`):
  Allowlist hält, `origin`/`status` kommen nicht durch, leere Zeilen fallen raus, halbe Zeilen sind ein
  Fehler, http/https-Gate, Längen.
- Markup des Dialogs → Node-Test.
- Der DB-Weg (melden → im Reiter sehen → freigeben → beim Leser sichtbar) braucht einen Owner-Durchlauf:
  keine lokale DB.

## 6. Bewusst nicht

- **Kein Vorbefüllen, keine anderen Felder.** Das ist das Ändern-Formular und damit die nächste Spec.
- **Keine Quelle im Fundort-Dialog.** Wer eine Publikation nachtragen will, meint die Quelle — ein anderes
  Feld mit anderer Bedeutung (§1). Beides in einem Dialog zu fragen, ist genau die Verwechslung, die diese
  Spec auseinanderhält.
- **Kein ▲▼.** Die Reihenfolge der Fundorte ist eine redaktionelle Entscheidung.
