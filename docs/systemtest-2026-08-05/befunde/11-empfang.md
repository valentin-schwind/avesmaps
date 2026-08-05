# Agent 11 — Der Empfang: was drinnen von draußen ankommt, und was davon rückgängig zu machen ist

## Kern

- **Sofortaufgabe erledigt:** Bewertung id 121 (Angbar) verborgen, am Ende gelöscht. Der Weg
  existiert, liegt aber drei Klicks tief: **Editor → Meldungen → Bewertungen**.
- **Der Hinweg ist in Ordnung, der Rückweg nicht.** Umlaute, „…", `—`, `&` und Zeilenumbrüche
  überstehen Formular → DB → Editor zeichengleich, `<b>` bleibt Text (kein XSS), neu gegen
  Korrektur ist erkennbar, der Duplikat-Vermerk wird korrekt gesetzt.
- **Eine verarbeitete Meldung verschwindet spurlos** (B2): der Endpunkt zeigt nur `status='neu'`,
  es gibt keine Liste erledigter Meldungen und **keinen Audit-Eintrag** (B3). Zwei eigene
  Meldungen sind mir unter der Hand verschwunden — wer sie wie entschied, ist nicht feststellbar.
- **Die stille Verwerfung habe ich selbst erzeugt** (B1): volles Formular, grünes
  „Karteneintrag wurde gemeldet." — **keine Zeile**. Ursache: die Stundengrenze.
- **Löschen lässt Quellenverweise zurück** (B5): nach „Ort löschen" liefert der **öffentliche**
  `feature-sources.php` die Quelle des gelöschten Ortes weiter aus.
- **Rückgängig ist technisch gut** — feldgenauer Wächter, mehrfaches Rückgängig + Wiederherstellen
  trifft exakt den Ausgangszustand. **Erzählt wird es falsch** (B6/B7): nie das WAS, immer der
  HEUTIGE Name, „Rückgängig gemacht" bleibt stehen, wenn es das nicht mehr ist.
- Der `Moegliches Duplikat.`-Vermerk wird berechnet, gespeichert — und **nie angezeigt** (B4).
- **Kein Rückkanal zum Melder** (B10): das Meldeformular hat kein E-Mail-Feld.

---

## Meldung → angekommen?

Zeile für Zeile gegen `befunde/10-melder.md`, Abgleich am 2026-08-05 ab 08:2x Serverzeit.

| # (Agent 10) | Erwartung | Vorgefunden | Urteil |
|---|---|---|---|
| 1 `ZZ-Systemtest Ambosshain` (location/new) | muss da sein, Status `neu` | **id 273**, `status neu`, alle Felder zeichengleich: Name, Melder, lat 536.135 / lng 457.125, Wiki-Link, Kommentar, Quelle mit `pages` | ✅ angekommen — **aber während meiner Sitzung von fremder Hand verarbeitet und damit unsichtbar geworden** (B2) |
| 2 `Angbar` (location/**change**) | muss da sein, als Änderung erkennbar | **nicht in der Liste** (Endpunkt liefert nur `status='neu'`). Zeile existiert (ID-Lücke 274–277 + Stundenzähler, s. u.), ist aber nirgends sichtbar | ❌ nicht prüfbar — B2 |
| 3 `ZZ-Systemtest Pflichtfeldprobe` | darf NICHT da sein | nicht vorhanden | ✅ korrekt |
| 4 `ZZ-Systemtest Honigtopf Dorf` | darf NICHT da sein | nicht vorhanden | ✅ korrekt |
| 5 `Ratenprobe 1` (comment) | muss da sein | nicht in der Liste (s. #2) | ❌ nicht prüfbar — B2 |
| 6 `Ratenprobe 2` | muss `review_note='Moegliches Duplikat.'` tragen | nicht in der Liste. **Nachgestellt mit eigenen Meldungen 279/280:** der Vermerk **wird gesetzt** — und **nirgends angezeigt** (B4) | ⚠️ Mechanik ✅, Anzeige ❌ |
| 7 `Ratenprobe 3` | muss da sein, ohne Vermerk | nicht in der Liste (s. #2) | ❌ nicht prüfbar — B2 |
| 8 `ZZ-Systemtest Ratengrenze Probe` | darf NICHT da sein | nicht vorhanden | ✅ korrekt |
| R Bewertung id 121 | sofort öffentlich | war öffentlich; **verborgen** (anonym `count:0`), am Ende **gelöscht** (114 → 113) | ✅ entfernt |
| K1 Kontakt-Honigtopf | darf NICHT da sein | keine Mail im Postfach | ✅ korrekt |
| K2 Kontaktnachricht | muss da sein | **uid 13** im Postfach, 5.8.2026 07:52:53, Text zeichengleich inkl. „…" und „—" | ✅ angekommen |

**Dass Agent 10s fünf Zeilen alle existieren, ist belegt, nicht vermutet:** meine eigene,
vollständige Meldung um 08:20 wurde von der Stundengrenze still verworfen — die zählt
`COUNT(*) … ip_hash … INTERVAL 1 HOUR ≥ 5`, also müssen zu diesem Zeitpunkt genau fünf Zeilen
derselben IP existiert haben. Sichtbar war eine. Die nächste vergebene ID war **278**, also
sind **274–277** verbraucht.

**Was NICHT verstümmelt war:** Umlaute (`äöü ÄÖÜ ß`), Halbgeviert `–`, Geviert `—`,
Anführungen `„…"`, `&`, drei Zeilen mit `\n`. Alles zeichengleich in DB und Editor.
`<b>kein HTML</b>` erscheint als Text — kein XSS. Koordinaten, Melder-Pseudonym,
Wiki-Link, Quellentyp und Seitenangabe kommen vollständig an. Ob eine Meldung ein
**neuer Ort** oder eine **Korrektur** ist, ist am Eintrag klar erkennbar
(„Änderung an: Angbar (settlement · 7b162e58-…)", Knopf heißt „Bearbeiten" statt „Anlegen").
Der Zeitpunkt stimmt (07:42:23 Server = 05:42:21 UTC).

---

## Aktion → Audit → rückgängig → sauber?

| Aktion (alle über die Oberfläche) | Im Änderungsprotokoll? | WER/WANN/WAS? | Rückgängig? | Danach wirklich sauber? |
|---|---|---|---|---|
| Ort anlegen (`create_point`, 53969) | ✅ 53969 | WER ✅ WANN ✅ **WAS ❌** („Ort erstellt" + heutiger Name) | ✅ Knopf vorhanden | — |
| Ort umbenennen (`update_point`, 53974) | ✅ 53974 | WER ✅ WANN ✅ **WAS ❌** (nicht erkennbar, dass es eine Umbenennung war) | ✅ | ✅ Name exakt zurück |
| Ortsgröße Dorf→Kleinstadt (53981) | ✅ 53981 | WER ✅ WANN ✅ **WAS ❌** (Eintrag zeigt `dorf`, sobald rückgängig) | ✅ | ✅ Typ exakt zurück |
| 2× Rückgängig hintereinander (53983, 53985) | ✅ als eigene Einträge | ✅ inkl. `undone_by`/`undo_audit_id` | — | ✅ Zustand = Anlegezeitpunkt |
| Wiederherstellen in **falscher** Reihenfolge | — | — | **verweigert** mit klarem Satz | ✅ **richtig so** — feldgenauer Wächter |
| Wiederherstellen in richtiger Reihenfolge (53988, 53990) | ✅ | ✅ | — | ✅ Zustand exakt wie vor den Rückgängigs |
| **Ort löschen** (`delete_feature`, 53991) | ✅ | ✅ | ✅ vollständig (`undo_delete_feature`) | ❌ **Quellenverweis bleibt, öffentlich abrufbar** (B5) |
| Quellenverweis über ✕ entfernen | ❌ **kein Eintrag** | — | ❌ kein Weg zurück | ✅ Verweis weg, **Katalogzeile bleibt** (uses 0) |
| **Meldung verwerfen** (id 280) | ❌ **kein Eintrag** | — | ❌ **kein Weg zurück, keine Liste** | Zeile bleibt in `map_reports`, unsichtbar |
| **Meldung annehmen** (id 279 → Ort) | ✅ nur `create_point` 53996 | Bezug zur Meldung fehlt | Ort ✅, Meldungsstatus ❌ | Zeile bleibt, unsichtbar |
| **Bewertung verbergen** (id 121) | ❌ **kein Eintrag** | — | ✅ „Einblenden" | ✅ |
| **Bewertung löschen** (id 121) | ❌ **kein Eintrag** | — | ❌ endgültig | ✅ |

---

### B1 Eine vollständig ausgefüllte Meldung verschwindet hinter einem grünen Erfolgston — von mir live erzeugt
- **Kategorie:** AKUT
- **Fundstelle:** api/app/report-location.php:97-102 (Stundengrenze) und :436-448
  (`avesmapsReportRateLimitExceeded`); Gegenstück js/review/review-locations.js (Formular wird
  beim Absenden geleert)
- **Beobachtung:** Ich habe auf der öffentlichen Karte über Rechtsklick → „Hier melden…" ein
  vollständiges Formular ausgefüllt (Kleinstadt `ZZ-Systemtest Öhlmühle & Straß`, Position
  487.524/477.125, Quelle mit Link und Seitenangabe, Pseudonym, Wiki-Link, dreizeiliger
  Kommentar) und auf „Melden" geklickt. Das Fenster schloss sich, das Formular war geleert, und
  im DOM stand `#copy-feedback-toast` = **„Karteneintrag wurde gemeldet."**. In `map_reports`
  entstand **keine Zeile** — die Liste zeigte davor und danach dieselben zwei Meldungen.
  Ursache war die Stundengrenze: die Zeilen von Agent 10 lagen noch innerhalb der Stunde.
  Das ist Agent 10s B1/B3, aber diesmal **nicht per `fetch`, sondern über das echte Formular**,
  ohne dass etwas Verdächtiges getippt wurde. Der Melder verliert seinen getippten Text und
  erfährt nichts.
- **Erwartet:** Der Statuscode ist die Wahrheit (201 gegen 200) — der Client muss ihn
  unterscheiden. Und: das Formular erst leeren, wenn 201 zurück ist.
- **Beleg:** Live gegen avesmaps.de, 2026-08-05 ~08:20 Serverzeit. Toast aus dem DOM gelesen;
  `GET /api/edit/reports/locations.php` davor und danach — beide Male nur `256:Dommel` und
  `273:ZZ-Systemtest Ambosshain`. Danach mit einem **Änderungsvorschlag** (von der Grenze
  ausgenommen, :97) gegengeprobt: der ging als id 278 sofort durch.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B2 Eine verarbeitete Meldung ist unauffindbar — es gibt keine Liste, keinen Verlauf, keinen Beleg
- **Kategorie:** AKUT
- **Fundstelle:** api/edit/reports/locations.php:58-91 (`avesmapsListLocationReportsForReview`,
  `WHERE status = :status` mit fest `'neu'`, kein Parameter); js/config.js:450 (einziger
  Lesepfad der Oberfläche)
- **Beobachtung:** Der Meldungs-Reiter kennt genau einen Zustand: offen. Sobald „Anlegen" oder
  „Verwerfen" gedrückt wurde — oder jemand anders es tat —, ist die Meldung aus jeder
  Oberfläche verschwunden. Es gibt keinen Filter, keinen Reiter „erledigt", keine Suche nach
  ID, keinen Export. Zusammen mit B3 (kein Audit) heißt das: **niemand kann nachträglich
  feststellen, ob eine Meldung angenommen oder abgelehnt wurde, von wem, wann und warum** —
  obwohl die Spalten `reviewed_by`, `reviewed_at`, `review_note` genau dafür gefüllt werden.
  Praktische Folge, zweimal an eigenen Objekten erlebt: Meldung 273 war um 08:2x offen und um
  08:3x weg; mein eigener Änderungsvorschlag 278 war um 08:38 offen und um 08:57 weg. In beiden
  Fällen habe ich die Meldung nicht angefasst, und es gibt keine Stelle, an der ich nachsehen
  könnte, was mit ihr geschah.
- **Erwartet:** Der Endpunkt nimmt `status` als Parameter, die Oberfläche bekommt einen zweiten
  Reiter „erledigt" mit Entscheider, Zeitpunkt und Vermerk. Das ist eine Zeile SQL und eine
  Liste — die Daten liegen bereits.
- **Beleg:** Quelltext gelesen (`'status' => 'neu'` hart im `execute`, keine Alternative).
  Live: `GET /api/edit/reports/locations.php` liefert zu jedem Zeitpunkt nur offene Meldungen;
  nach meinem „Verwerfen" von id 280 war sie aus der Antwort verschwunden und über keinen
  Aufruf wieder erreichbar. Dass die Zeilen fortbestehen, folgt aus der Stundengrenze (B1) und
  der lückenlosen ID-Vergabe 273 → 278.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 Meldungs- und Bewertungs-Moderation schreibt nichts ins Änderungsprotokoll
- **Kategorie:** AKUT
- **Fundstelle:** api/edit/reports/locations.php:156-207 (`avesmapsUpdateLocationReportReviewStatus`)
  und api/edit/reviews.php:101-111 (hide/unhide/delete) — beide ohne Audit-Aufruf;
  Gegenstück api/edit/map/audit-log.php (nur `map_audit_log`, das nur Kartenobjekte kennt)
- **Beobachtung:** Vier Schreibvorgänge, die eine fremde Meinung öffentlich machen oder
  verwerfen — Meldung annehmen, Meldung ablehnen, Bewertung verbergen, Bewertung endgültig
  löschen —, hinterlassen **keinen Eintrag im „Änderungen"-Reiter**. Wer eine
  Community-Bewertung löscht, tut das unbeobachtet; es gibt keinen Weg, das später
  festzustellen. Zum Vergleich: das Verschieben eines Labels um drei Pixel wird protokolliert.
- **Erwartet:** Dieselben vier Aktionen erzeugen einen Protokolleintrag mit Konto, Zeitpunkt,
  Objekt und Entscheidung. Bei der Bewertung ist zusätzlich fraglich, ob „endgültig löschen"
  überhaupt die richtige Voreinstellung ist — `is_hidden` gibt es bereits.
- **Beleg:** Beide Dateien vollständig gelesen. Live: nach „Verwerfen" von Meldung 280
  (≈08:59) lagen im Protokoll zwischen 53993 (08:57:38, thomas) und 53994 (09:00:02, thomas)
  **keine** neuen Einträge; nach dem Löschen von Bewertung 121 (≈09:1x) ist der jüngste
  Eintrag unverändert 54000 (09:05:48, mein Ortslöschen).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B4 Der berechnete Duplikat-Vermerk wird gespeichert und niemals angezeigt
- **Kategorie:** AKUT
- **Fundstelle:** api/app/report-location.php:103-106 (setzt `review_note='Moegliches Duplikat.'`)
  und api/edit/reports/locations.php:83 (liefert `review_note` aus) gegen **js/** — die
  Zeichenkette `review_note` kommt im gesamten Frontend **nicht vor**
- **Beobachtung:** Der Server macht genau die Arbeit, die eine Redaktion braucht: er erkennt,
  dass eine neue Meldung einer offenen sehr ähnlich ist (±2 Koordinaten, Levenshtein ≤ 2), und
  schreibt einen Vermerk in die Zeile. Der Vermerk reist mit der API-Antwort mit. Die
  Oberfläche liest ihn nie. Der Prüfer sieht zwei fast gleiche Meldungen untereinander und muss
  selbst darauf kommen. Dasselbe Feld nimmt `update_status` auch entgegen (`review_note` im
  Payload) — es gibt aber keine Oberfläche, die eines schreibt. Das Feld ist in der Anwendung
  in **beide** Richtungen tot.
- **Erwartet:** Eine Zeile im Meldungseintrag, sichtbar markiert („⚠ mögliches Duplikat"),
  idealerweise mit Verweis auf die Meldung, die gemeint ist.
- **Beleg:** Live nachgestellt: zwei anonyme Meldungen `ZZ-Systemtest Dupprobe A` (300/150) und
  `… B` (301/151), beide 201. `GET /api/edit/reports/locations.php` → id 280 trägt
  `"review_note": "Moegliches Duplikat."`. Im gerenderten Eintrag steht:
  „ZZ-Systemtest Dupprobe B / Dorf · 301.000, 151.000 / … / Anlegen / Verwerfen" — kein
  Vermerk. `document.body.innerText.split('Moegliches Duplikat').length-1` = **0**.
  `grep -rn "review_note" js/` → **kein Treffer**.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B5 Das Löschen eines Ortes lässt seine Quellenverweise stehen — öffentlich abrufbar
- **Kategorie:** AKUT
- **Fundstelle:** api/app/feature-sources.php (öffentlicher Lesepfad, kein `is_active`-Filter)
  gegen den Löschweg in api/_internal/map/features.php (`delete_feature` setzt `is_active=0`,
  fasst `feature_sources` nicht an)
- **Beobachtung:** Ich habe einen Ort mit einer verknüpften Quelle angelegt und ihn über
  „Ort löschen" entfernt. Der Ort ist aus Karte und Suche verschwunden. Der **öffentliche**
  Endpunkt `GET /api/app/feature-sources.php?entity_type=settlement&entity_public_id=…`
  liefert die Quelle danach **unverändert weiter** — auch für einen anonymen Besucher. Der
  gemeinsame Quellenkatalog zählt den gelöschten Ort weiter als Nutzung (`uses: 1`). Weil das
  Löschen weich ist, räumt auch nichts später auf: der Verweis bleibt, solange die Zeile lebt.
  Ein anderer Agent hat dasselbe Muster gemeldet; hier ist es an der Siedlung reproduziert.
- **Erwartet:** Entweder der Löschvorgang deaktiviert die Verweise mit (und die Wiederherstellung
  holt sie zurück — sie ist ja vollständig), oder der öffentliche Lesepfad filtert auf aktive
  Objekte. Der Katalogzähler darf nur aktive Verwendungen zählen.
- **Beleg:** Live, 2026-08-05. Vor dem Löschen: `sources:[{label:"ZZ-Systemtest Quellenband
  (Agent 11)", url:"…/ZZ-Systemtest-Quelle-Agent11"}]`, Katalog `uses:1`. Nach „Ort löschen"
  (Toast „Ort gelöscht.", Audit 53991, `map-search.php?q=ZZ-Systemtest` → `results: []`):
  derselbe Aufruf mit `credentials:'omit'` liefert **dieselbe Quelle**, Katalog weiter `uses:1`.
  Erst nachdem ich den Ort wiederhergestellt, die Quelle im Editor über „✕" gelöst und den Ort
  erneut gelöscht hatte, war der Verweis weg.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 Das Änderungsprotokoll sagt nie, WAS geändert wurde — und erzählt die Vergangenheit mit heutigen Werten
- **Kategorie:** KANN
- **Fundstelle:** api/edit/map/audit-log.php:83-105 (`avesmapsNormalizeAuditRow`:
  `'name' => (string) ($row['name'] ?? …)`, `'feature_subtype' => (string) ($row['feature_subtype'] ?? …)`
  — beides aus `map_features`, also aus dem **aktuellen** Stand); `before_json`/`after_json`
  werden zwar gelesen (:84-85), aber ausschließlich für die Kartenposition verwendet (:107-125)
  und **nie an den Client geschickt**
- **Beobachtung:** Ein Eintrag lautet „Ort geändert / <Name> / valentin · 2026-08-05 08:38:47.452".
  Welches Feld sich wie geändert hat, steht nirgends — obwohl beide Schnappschüsse in der
  Datenbank liegen. Zwei Folgen:
  1. Zwei völlig verschiedene Änderungen (Umbenennung; Dorf→Kleinstadt) sehen im Protokoll
     **identisch** aus.
  2. Weil Name und Art aus dem Live-Datensatz kommen, trägt **jeder** Eintrag den heutigen
     Namen. Nach einer Umbenennung behauptet auch der Anlege-Eintrag von vorher den neuen
     Namen — die Umbenennung ist im Protokoll unsichtbar geworden.
- **Erwartet:** Die Antwort enthält die geänderten Felder als Vorher/Nachher-Paare
  (die Schnappschüsse liegen bereits vor), und der Eintrag zeigt den Namen **zum Zeitpunkt
  der Änderung**, nicht den von heute.
- **Beleg:** Live nachvollzogen. Eintrag 53969 (`create_point`, 08:34:36) wurde angelegt, als
  der Ort `ZZ-Systemtest Ortsprobe (Agent 11)` hieß; nach der Umbenennung zeigte derselbe
  Eintrag `ZZ-Systemtest Ortsprobe ÄNDERUNG 1 (Agent 11)`. Eintrag 53981 war die Änderung
  `dorf → kleinstadt` und zeigte nach dem Rückgängigmachen `feature_subtype: dorf`.
  Antwortfelder des Endpunkts: `id, action, created_at, username, undone, undone_at,
  undone_username, undo_audit_id, can_undo, public_id, feature_type, feature_subtype, name,
  focus` — kein Diff.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B7 Nach einem wiederhergestellten Rückgängig behauptet das Protokoll weiter „Rückgängig gemacht"
- **Kategorie:** KANN
- **Fundstelle:** api/edit/map/audit-log.php:88 (`$isUndone = undone_at !== ''`) — die Marke
  am ursprünglichen Eintrag wird nie geräumt, wenn der **Rückgängig-Eintrag selbst** rückgängig
  gemacht wird; Anzeige in js/review/review-panels.js (Beschriftung „Rückgängig: " + Aktion)
- **Beobachtung:** Drei zusammenhängende Kleinigkeiten, alle im selben Ablauf:
  1. Eintrag 53974 (Umbenennung) steht als „Rückgängig gemacht von valentin" — obwohl die
     Umbenennung nach dem Wiederherstellen wieder **in Kraft** ist. Das Protokoll sagt das
     Gegenteil des Zustands.
  2. Die Beschriftungen stapeln sich: „Rückgängig: Ort geändert" → „Rückgängig: Rückgängig:
     Ort geändert". Eine Ebene tiefer wäre sie dreifach. Das ist für einen Menschen nicht mehr
     lesbar; das Protokoll müsste „Wiederhergestellt: Ort geändert" sagen.
  3. Der Knopf „Wiederherstellen" wird auch dort angeboten, wo der Server ihn ablehnt: mein
     Klick auf Eintrag 53983 brachte „Diese Änderung kann nicht unabhängig rückgängig gemacht
     werden, weil das Objekt inzwischen erneut geändert wurde." Der Wächter ist **richtig** —
     `can_undo` weiß nur nichts von ihm, prüft nur `!$isUndone`.
- **Erwartet:** `undone_at` wird beim Wiederherstellen geräumt (oder die Anzeige folgt der
  Kette); die Beschriftung wechselt statt zu stapeln; `can_undo` berücksichtigt denselben
  Feldvergleich, den `avesmapsAssertUndoPatchStillCurrent` ohnehin macht.
- **Beleg:** Live an eigenen Objekten. Kette: 53969 create → 53974 rename → 53981 Typ →
  53983 undo(53981) → 53985 undo(53974) → 53988 undo(53985) → 53990 undo(53983).
  Nach 53988 zeigte die Oberfläche für 53974 weiter „Rückgängig gemacht von valentin", während
  der Name `…ÄNDERUNG 1…` live war; 53988 trug die Beschriftung „Rückgängig: Rückgängig: Ort
  geändert". Der abgelehnte Klick auf 53983 ist mit Toast belegt, derselbe Klick nach 53988
  ging durch.
- **Sicherheit:** BELEGT
- **Aufwand:** klein
- **Ausdrücklich gut:** der Wächter selbst (api/_internal/map/features.php:490-508) vergleicht
  **feldgenau** gegen den Nachher-Schnappschuss. Dadurch ist Rückgängig ordnungsunabhängig,
  wo es sicher ist, und verweigert, wo es nicht sicher ist. Mehrfaches Rückgängig und
  anschließendes Wiederherstellen haben bei mir **exakt** den Ausgangszustand hergestellt.

### B8 Der Wunschtext des Melders landet ungefiltert in der öffentlichen Beschreibung des Ortes
- **Kategorie:** AKUT
- **Fundstelle:** js/review/review-report-flow.js:11-16 (Annahme-Weg: Kommentar + Quellenzeilen
  in `#location-edit-description`) und :78-86 (Änderungs-Weg: „— Community-Änderungswunsch von
  X:" wird der Beschreibung **vorangestellt**)
- **Beobachtung:** Beide Wege füllen dasselbe Feld: die Beschreibung, die später in der Infobox
  öffentlich steht. Es gibt kein getrenntes, internes Feld für den Wunsch. Drückt der Prüfer
  einfach „Speichern" — der naheliegendste Handgriff überhaupt —, wird die Anrede an die
  Redaktion zum Beschreibungstext des Ortes, samt Kopfzeile und Melder-Pseudonym. Bei mir
  standen nach „Anlegen" wörtlich im Beschreibungsfeld:
  „ZZ-Systemtest Duplikatprobe – bitte verwerfen.\n\nQuelle: ZZ-Systemtest Quellenband
  (Agent 11), S. 12" — und beim Änderungsvorschlag „— Community-Änderungswunsch von
  ZZ-Systemtest Redaktion (Agent 11):" gefolgt vom ganzen Wunschtext.
- **Erwartet:** Der Wunsch gehört in einen sichtbaren, aber **nicht speichernden** Kasten neben
  dem Formular („Das hat der Melder geschrieben"), nicht in das Feld, das veröffentlicht wird.
  Die Quellen-Ersatzzeile („Quelle: X, S. Y") gehört ebenfalls dorthin, bis ein Mensch sie
  bestätigt.
- **Beleg:** Live an beiden Wegen. Änderungsvorschlag id 278 → „Bearbeiten" → Feldinhalt aus
  dem DOM gelesen, Klasse `field--change-proposed`. Meldung id 279 → „Anlegen" → Feldinhalt
  gelesen, danach gespeichert: der Ort wurde mit genau diesem Text angelegt (Audit 53996) und
  von mir sofort wieder gelöscht.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B9 „Mail beantworten" wird auch bei Nachrichten ohne Absenderadresse angeboten — die Antwort ginge an das eigene Postfach
- **Kategorie:** KANN
- **Fundstelle:** api/edit/mail/mailbox.php:39-44 (`$replyRecipient` = `replyToEmail` sonst
  `fromEmail`; die 422-Sperre greift nur, wenn **beide** leer sind) und api/app/contact.php:238-246
  (ohne E-Mail des Absenders bleibt `From:` = `Avesmaps Kontakt <info@avesmaps.de>`)
- **Beobachtung:** Das Kontaktformular erlaubt das Absenden ohne E-Mail-Adresse. Die daraus
  erzeugte Mail kommt vom eigenen Absender. Im Postfach steht sie deshalb als
  „Avesmaps Kontakt <info@avesmaps.de>" — der Name des Schreibers taucht in der Liste
  **gar nicht** auf, man muss die Nachricht öffnen. Und der Knopf „Mail beantworten" ist
  vorhanden wie bei jeder anderen: Eine Antwort ginge an `info@avesmaps.de`, also zurück ins
  eigene Postfach, ohne dass der Editor einen Hinweis bekäme. Es fehlt die Auskunft „dieser
  Absender hat keine Adresse hinterlassen".
- **Erwartet:** Ist `replyTo`/`from` die eigene Adresse, wird der Knopf ausgegraut mit dem Satz
  „ohne Absenderadresse — Antwort nicht möglich". Zusätzlich sollte die Liste den im Text
  stehenden Namen zeigen.
- **Beleg:** Live gelesen. `GET /api/edit/mail/mailbox.php?action=message&uid=13` liefert
  `"fromEmail":"info@avesmaps.de","replyTo":"info@avesmaps.de"`, während im Text
  „Name: ZZ-Systemtest (Agent 10) / E-Mail: (keine angegeben)" steht. Zum Vergleich zeigt
  uid 11 „Tina Hagner (kanzler@nordmarken.de) <info@avesmaps.de>". Der Knopf „Mail beantworten"
  ist in der geöffneten Nachricht vorhanden und aktiv; ein Klick brachte die Formularmeldung
  „Bitte Text eingeben." — **es wurde keine Mail versendet**.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B10 Es gibt überhaupt keinen Rückkanal zum Melder — das Formular fragt nie nach einer Adresse
- **Kategorie:** ZUKUNFT
- **Fundstelle:** index.html:1033-1120 (`<form id="location-report-form">`: Position, Art,
  Ortsgröße, Name, Quellen, Pseudonym, Wiki-Link, Kommentar — **kein E-Mail-Feld**) gegen
  api/edit/reports/locations.php (Statuswechsel ohne jede Benachrichtigung)
- **Beobachtung:** Ein Melder erfährt nie, was aus seinem Beitrag wurde. Es gibt keine Nummer,
  keine Bestätigungsmail, keinen Statuslink, und die Redaktion hätte selbst dann keinen Weg,
  ihn zu erreichen, wenn sie wollte. Aus Sicht des Empfangs heißt das: **ich sehe nicht, ob
  der Melder eine Rückmeldung bekommt, weil es keine gibt.** Bei einer Ablehnung ist das
  besonders unglücklich — der Beitrag war Arbeit, und die einzige Antwort ist Schweigen.
  (Das Kontaktformular kann eine Adresse aufnehmen; das Meldeformular nicht.)
- **Erwartet:** Optionales E-Mail-Feld (klar als freiwillig gekennzeichnet, mit Zweckangabe)
  und eine kurze Nachricht bei Annahme/Ablehnung; wenigstens aber eine Vorgangsnummer im
  Erfolgsdialog, die der Melder nennen kann.
- **Beleg:** Formular vollständig ausgelesen (Feldliste oben), beide Ablaufwege live durchlaufen
  (Annahme id 279, Ablehnung id 280) — in keinem Schritt wurde nach einer Adresse gefragt oder
  etwas versendet.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B11 Seitenangaben erscheinen als „S. S. 42-43", weil das Kürzel dreimal fest im Code steht
- **Kategorie:** KANN
- **Fundstelle:** js/review/review-panels.js:291 (`` ` (S. ${source.pages})` ``),
  js/review/review-locations.js:77 (`S. ${…}`), js/review/review-report-flow.js:15
  (`, S. ${…}`) gegen index.html:1099 (Eingabefeld, Platzhalter „Seite(n)")
- **Beobachtung:** Das Feld heißt „Seite(n)". Wer dort — völlig naheliegend — „S. 42-43"
  einträgt, sieht seinen Beleg im Editor als „(S. S. 42-43)". Der Wert wird unverändert
  gespeichert, das Kürzel dreimal unabhängig davorgesetzt.
- **Erwartet:** Entweder ein führendes „S."/„S "/„Seite" beim Speichern abschneiden, oder das
  Kürzel gar nicht voranstellen und den Platzhalter auf „z. B. 42–43" ändern.
- **Beleg:** Meldung id 273 (Agent 10) trägt `"pages": "S. 42-43"`; der gerenderte Eintrag im
  Editor lautete wörtlich „ZZ-Systemtest Quellenband (erfunden, nur Test) **(S. S. 42-43)** ·
  gemeldet von …" (aus `.review-report__source` ausgelesen).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B12 Die Infobox zeigt nach Umbenennen und nach Löschen weiter den alten Stand
- **Kategorie:** KANN
- **Fundstelle:** Oberfläche `.avesmaps-infopanel` (Infobox rechts) nach „Speichern" bzw.
  „Ort löschen". Die Speicher-Rückschreibung `applyFeatureResponseToMarker`
  (js/map-features/map-features-location-editing.js:208-…) pflegt Marker und Popup nach
  (`wasPopupOpen`), die **Infobox** aber offensichtlich nicht — die genaue Codestelle habe ich
  nicht festgenagelt.
- **Beobachtung:** Zwei Stellen, an denen die Oberfläche behauptet, es sei nichts geschehen:
  1. Nach dem Umbenennen eines Ortes stand in der offenen Infobox weiter der **alte** Name
     (das Bearbeiten-Fenster hatte korrekt den neuen).
  2. Nach „Ort löschen" blieb die Infobox mit Namen, Bild, Knöpfen **und der Quellenzeile**
     stehen, als gäbe es den Ort noch — inklusive „Ort löschen", das nun ins Leere zeigt.
- **Erwartet:** Speichern aktualisiert die offene Infobox; Löschen schließt sie.
- **Beleg:** Live, beides per Bildschirmfoto und DOM festgehalten. Nach dem Umbenennen zeigte
  `.avesmaps-infopanel` „ZZ-Systemtest Ortsprobe (Agent 11)", während
  `#location-edit-name` bereits „…ÄNDERUNG 1…" enthielt. Nach dem Löschen (Toast „Ort gelöscht.",
  `map-search.php` leer) zeigte die Infobox den Ort unverändert weiter.
- **Sicherheit:** BELEGT (die Beobachtung; die genaue Codeursache ist PLAUSIBEL, nicht geprüft)
- **Aufwand:** klein

### B13 `contact_message` ist eine Nur-Schreib-Tabelle, und das Postfach kann nichts löschen
- **Kategorie:** KANN
- **Fundstelle:** api/app/contact.php:44 (INSERT) und :162 (`FROM contact_message` — nur die
  Ratenzählung liest sie) gegen api/edit/mail/mailbox.php:19-104 (Aktionen `inbox`, `sent`,
  `reply`, `image`, `ping`, `message` — **kein Löschen**)
- **Beobachtung:** Jede Kontaktnachricht wird doppelt abgelegt: als Zeile in `contact_message`
  (mit `ip_hash` und `user_agent`) und als Mail im IMAP-Postfach. Gelesen wird im Editor
  ausschließlich das Postfach. Die Tabellenzeile sieht nie jemand, und es gibt keine
  Oberfläche, die sie löscht — auch nicht, wenn jemand darum bittet. Und selbst die Mail lässt
  sich im Editor nicht entfernen; dafür muss man an das echte Mailkonto.
  Das ist der Grund, warum ich Agent 10s Kontaktnachricht nicht wegbekommen habe.
- **Erwartet:** Entweder die Tabelle nur als kurzlebige Ratenzählung führen (Inhalt nicht
  speichern), oder sie im Editor sichtbar und löschbar machen. Ein Löschen im Postfach wäre
  ohnehin nützlich.
- **Beleg:** Beide Dateien gelesen; `grep -rn "DELETE FROM contact_message" api/` ohne Treffer.
  Live: Nachricht uid 13 im Postfach vorhanden und lesbar, keine Löschmöglichkeit in der
  Oberfläche.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B14 Verwaiste Quellen bleiben für immer im gemeinsamen Katalog stehen
- **Kategorie:** KANN
- **Fundstelle:** api/app/source-search.php (Katalogliste mit `uses`) gegen
  api/edit/map/feature-sources.php — es gibt Aktionen zum Verknüpfen und Lösen, aber keine,
  die eine Katalogzeile entfernt
- **Beobachtung:** Löst man den letzten Verweis auf eine Quelle, bleibt die Zeile im
  gemeinsamen Katalog mit `uses: 0` zurück. Sie taucht weiterhin in der
  Quellen-Vervollständigung auf, die jeder Editor beim Tippen sieht. Ein Tippfehler oder ein
  Testeintrag ist damit dauerhaft. Meine eigene Testquelle
  `ZZ-Systemtest Quellenband (Agent 11)` (`source_id 1224935`) steht jetzt genau so da —
  ich bekomme sie über keine Oberfläche weg.
- **Erwartet:** Entweder Katalogzeilen mit `uses = 0` aus der Vervollständigung ausblenden,
  oder eine Aufräumaktion im Editor (Liste „nicht verwendete Quellen" mit Löschknopf).
- **Beleg:** Live: `GET /api/app/source-search.php?q=ZZ-Systemtest` liefert nach dem Lösen des
  Verweises weiterhin `{"source_id":1224935, …, "uses":0}`. Endpunkt-Aktionen gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## Was ich nicht wegbekommen habe

Alles Folgende habe ich **versucht** zu entfernen; es gibt dafür in der Oberfläche keinen Weg.

| Rückstand | Wo | Warum nicht entfernbar |
|---|---|---|
| **8 Zeilen in `map_reports`** (id 273–280): Agent 10s fünf Meldungen + meine drei (278 Änderung, 279 angenommen, 280 abgelehnt) | Tabelle `map_reports`, Status ≠ `neu` | Der Editor kennt nur offene Meldungen (B2). Kein Filter, keine Liste, kein Löschknopf. Die Zeilen enthalten Melder-Pseudonym, `ip_hash` und `user_agent`. |
| **Kontaktnachricht von Agent 10** | Mail **uid 13** im Postfach + eine Zeile in `contact_message` | Das Postfach kann nicht löschen; die Tabelle liest und löscht keine Oberfläche (B13). 🔧 **DU:** uid 13 direkt im Mailkonto löschen. |
| **Katalogeintrag `sources` id 1224935** (`ZZ-Systemtest Quellenband (Agent 11)`, `uses 0`) | gemeinsamer Quellenkatalog | Keine Aktion zum Löschen einer Katalogzeile (B14). Erscheint weiter in der Quellen-Vervollständigung aller Editoren. |
| **Audit-Einträge 53969, 53974, 53981, 53983, 53985, 53988, 53990, 53991, 53996, 53997, 53998, 53999, 54000** | `map_audit_log` | Das Protokoll ist bewusst unveränderlich — kein Befund, nur zur Kenntnis: die ZZ-Systemtest-Namen stehen dauerhaft im „Änderungen"-Reiter. |

**Sauber weggeräumt:** Bewertung 121 (gelöscht, 114 → 113, Angbar öffentlich `count:0`) ·
beide angelegten Orte (`bf389163-…`, `1237d306-…`, Suche leer) · deren Quellenverknüpfungen
(`feature-sources.php` liefert `[]`) · keine offene ZZ-Systemtest-Meldung mehr in der
Warteschlange. Die echte Community-Meldung **id 256 „Dommel" habe ich nicht angefasst.**

**Am Browser des Owners zurückgesetzt:** Farbschema (versehentlich auf hell geschaltet →
wieder `dark`), Kartenmodus (auf „Standard" gestellt → wieder „Landschaften"),
`window.confirm` (für die Werkzeugkette überschrieben → wiederhergestellt).

---

## Anmerkung zur Prüfumgebung (kein Avesmaps-Befund)

1. **Drei bis vier fremde Editoren haben während meiner Sitzung live geschrieben**
   (`begomir`, `thomas`, `nics`, `valentin` — 200 Protokolleinträge in acht Stunden).
   Das ist der Grund, warum zwei meiner Prüfobjekte unter der Hand verarbeitet wurden. Es hat
   den Test nicht verfälscht — im Gegenteil, es hat B2 doppelt belegt —, aber jede Aussage
   über „war vorher nicht da" ist entsprechend vorsichtig formuliert.
2. **Bestätigungsdialoge (`window.confirm`) blockieren die Fernsteuerung**, weil sie im
   Browser-Prozess laufen und die Werkzeugkette nur den Renderer erreicht. Ich habe
   `window.confirm` deshalb protokollierend überschrieben (und am Ende wiederhergestellt).
   Die Dialoge **funktionieren**: aufgezeichnet wurden u. a. „ZZ-Systemtest Ortsprobe
   ÄNDERUNG 1 (Agent 11) wirklich löschen?", „ZZ-Systemtest Dupprobe B wirklich verwerfen?"
   und „Diese Bewertung wirklich endgültig löschen?" — jeder nennt das Objekt beim Namen,
   was gut ist.
3. **Serverzustand am Ende:** antwortbereit, kein Ausfall. Einzelproben:
   `session.php` 73 ms, `map-search.php?q=Gareth` 1357 ms (200) — deutlich über der
   Grundlinie von 0,50 s aus `befunde/0-koordination.md`, was zu drei gleichzeitig
   schreibenden Editoren passt. Keine teure Aktion ausgelöst (kein Dump, kein Sync, kein
   Backup, kein Massenlauf).
