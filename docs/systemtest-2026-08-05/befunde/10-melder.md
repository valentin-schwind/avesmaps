# Agent 10 — Der Melder: was ein DSA-Fan absetzen kann und was davon ankommt

## Kern

- **Eine verworfene Meldung wird dem Menschen als Erfolg gemeldet.** Honigtopf, Spamwort,
  „zu schnell getippt" und Stundengrenze antworten alle mit `ok:true` und **demselben Satz**
  wie ein echter Treffer. Der Melder sieht 2,2 Sekunden „Karteneintrag wurde gemeldet." und
  hat nichts mehr in der Hand (B1) — live erzeugt und live verloren.
- **Umgekehrt merkt es ein Bot sofort:** echt = **201**, verworfen = **200**; beim
  Kontaktformular unterscheiden sich sogar die Sätze („Danke! Deine Nachricht ist
  angekommen." gegen „Nachricht wurde gesendet."). Genau das, was der Kommentar an der
  Stelle ausschließen will (B2).
- **Die Stundengrenze zählt Änderungsvorschläge mit.** Fünf Zeilen je IP und Stunde — mein
  Angbar-Vorschlag war eine davon; die sechste Meldung verschwand. Wer als guter Mitarbeiter
  fünf Korrekturen schickt, kann danach keinen Ort mehr melden (B3, live an der Grenze
  gemessen). Der angemeldete Editor ist **nicht** ausgenommen: der Endpunkt kennt keine
  Anmeldung, die Grenze hängt allein an der IP.
- **Man findet den Weg nicht.** Auf dem leeren Startbild gibt es keinen einzigen sichtbaren
  Hinweis; „Hier melden…" steckt im Rechtsklickmenü (B4). Und nach dem Absenden erfährt man
  weder eine Nummer noch, wie es weitergeht (B5).
- **Englisch bricht mitten im Formular ab:** sechs `data-i18n`-Schlüssel fehlen, der ganze
  Quellenblock bleibt deutsch (B7); Serverfehler kommen ohnehin nur auf Deutsch — und ohne
  Umlaute („Die Ortsgroesse ist ungueltig.", B6).
- Bewertungen sind **sofort öffentlich, ungeprüft**, und die Orts-ID wird nie geprüft (B9).

---

## Was ich abgesetzt habe (Prüfmaßstab für Agent 11)

Alle Zeiten UTC (Serverzeit = UTC+2). **Fünf** Zeilen sind in `map_reports` gelandet,
**eine** in `map_reviews`, **eine** in `contact_message`. Drei Anfragen haben absichtlich
nichts erzeugt — sie sind der Gegenbeweis.

| # | Zeit (UTC) | Weg | Art / `report_type` | Bezeichner | Was drinsteht | Erwartung im Editor |
|---|---|---|---|---|---|---|
| 1 | 05:42:21 | **UI, angemeldet** — Rechtsklick → „Hier melden…" | `location` / `kleinstadt`, mode `new` | Name **`ZZ-Systemtest Ambosshain`**, lat 536.135 / lng 457.125 | Quelle „ZZ-Systemtest Quellenband (erfunden, nur Test)", S. 42-43, Typ `sonstiges`, nicht offiziell; Melder „ZZ-Systemtest Melder (Agent 10)"; Wiki `https://de.wiki-aventurica.de/wiki/Angbar`; Kommentar beginnt „ZZ-Systemtest: Bitte NICHT anlegen." | **muss da sein**, Status `neu`, HTTP 201 |
| 2 | 05:45:00 | **UI, angemeldet** — Infopanel Angbar → „Änderungen vorschlagen" | `location` / `grossstadt`, **mode `change`** | Name **`Angbar`**, `entity_type=settlement`, `entity_public_id=7b162e58-6ffc-5afe-909c-adfa4c053506` | **keine Quelle** (im Änderungsmodus zulässig); Kommentar beginnt „ZZ-Systemtest (bitte verwerfen, keine echte Korrektur): … Einwohnerzahl … 1041 BF …" | **muss da sein**, als Änderung erkennbar, mit Bezug auf Angbar |
| 3 | 05:47:15 | **anonym**, `fetch(credentials:"omit")` | `location`, Ortsgröße/Quelle/Position fehlen | `ZZ-Systemtest Pflichtfeldprobe` | — | **darf NICHT da sein** (HTTP 400 „Die Ortsgroesse ist ungueltig.") |
| 4 | 05:47:28 | **anonym**, Honigtopf `website` gefüllt | `location` / `dorf` | `ZZ-Systemtest Honigtopf Dorf` | vollständig gültig, nur `website` gesetzt | **darf NICHT da sein** (HTTP 200, Erfolgsmeldung) |
| 5 | 05:47:56 | **anonym** | `comment` | **`ZZ-Systemtest Ratenprobe 1`**, lat 700 / lng 300 | Kommentar „…Ratenprobe 1 von hoechstens 4…" | muss da sein, HTTP 201 |
| 6 | 05:48:04 | **anonym** | `comment` | **`ZZ-Systemtest Ratenprobe 2`**, lat 701 / lng 301 | absichtlich 1 Einheit neben Nr. 5 | muss da sein **und `review_note='Moegliches Duplikat.'` tragen** (Duplikatprüfung: ±2 Koordinaten, levenshtein ≤ 2) |
| 7 | 05:48:13 | **anonym** | `comment` | **`ZZ-Systemtest Ratenprobe 3`**, lat 250 / lng 800 | die fünfte Zeile der Stunde | muss da sein, **ohne** Duplikat-Vermerk |
| 8 | 05:48:28 | **anonym** | `location` / `dorf` | `ZZ-Systemtest Ratengrenze Probe`, lat 640 / lng 520 | mit Quelle „ZZ-Systemtest Quellenband, S. 7", offiziell | **darf NICHT da sein** — sechste Meldung der Stunde, still verworfen (HTTP 200, Erfolgstext) |
| R | 07:50:13 (Server) | **UI, angemeldet** — Infopanel → „★ Bewertung schreiben" | `map_reviews` **id 121** | Ort **Angbar** `7b162e58-…-adfa4c053506`, Autor `ZZ-Systemtest (Agent 10)`, **3 Sterne** | „ZZ-Systemtest vom 05.08.2026 — bitte loeschen…", Datum automatisch „5. Rondra 1049 BF" | **sofort öffentlich sichtbar** — 🔧 **DU/Agent 11: verbergen oder löschen** |
| K1 | ~05:51 | **anonym**, Honigtopf | `contact_message` | `ZZ-Systemtest Honigtopf` | — | **darf NICHT da sein** (HTTP 200) |
| K2 | ~05:52 | **UI** — Hinweise → Kontakt → „Nachricht senden" | `contact_message` + **Mail an den Betreiber** | Absender `ZZ-Systemtest (Agent 10)`, ohne E-Mail | „ZZ-Systemtest vom 05.08.2026 — bitte ignorieren und loeschen…" | muss da sein, HTTP 201 |

**Acht** POSTs auf `report-location.php` (Vorgabe: höchstens acht), davon fünf mit Wirkung.
Zwei auf `contact.php`, einer auf `location-reviews.php`. Alles im SPURENBUCH.

---

### B1 Eine still verworfene Meldung wird dem Melder als Erfolg gemeldet — der Beitrag ist weg, und niemand erfährt es
- **Kategorie:** AKUT
- **Fundstelle:** api/app/report-location.php:83-88 (Spam/Honigtopf), :98-103 (Stundengrenze),
  :234-238 (`elapsed_ms < 3000`), :327-331 (Spamwort + Nur-Link-Kommentar);
  Gegenstück im Client js/app/api-client.js:69-79 und js/review/review-report-flow.js:218-229
- **Beobachtung:** Vier verschiedene Filter beenden die Verarbeitung mit
  `avesmapsJsonResponse(200, ['ok'=>true, 'message'=>'Karteneintrag wurde gemeldet.'])` —
  **wörtlich derselbe Satz**, den ein wirklich gespeicherter Bericht bekommt (:184-187).
  Der Client prüft nur `responsePayload.ok !== true`, also nicht den Statuscode; er schließt
  das Fenster, leert das Formular und zeigt einen grünen Toast. Für einen Menschen ist eine
  verworfene Meldung von einer angekommenen **nicht zu unterscheiden**, und weil das Formular
  dabei geleert wird, ist auch der getippte Text weg. Betroffen sind nicht nur Bots:
  - wer sechs Meldungen in einer Stunde schickt (B3),
  - wer im Kommentar **nur** einen Link stehen lässt (`avesmapsIsLinkOnlyText`, :417-425) —
    naheliegend, wenn man den Wiki-Artikel als Beleg anfügen will,
  - wer eines der sieben Spamwörter benutzt (`casino, crypto, viagra, loan, betting, porn,
    seo`), geprüft über Name, Quellen, Wiki-Link, Kommentar **und Melder-Pseudonym**,
  - wer das Fenster offen hatte und in unter drei Sekunden abschickt.
- **Erwartet:** Der Bot-Pfad darf schweigen — der Mensch nicht. Zwei Wege, die sich nicht
  ausschließen: (a) den Statuscode als Wahrheit nehmen und im Client zwischen 201 und 200
  unterscheiden („angekommen" gegen „konnten wir gerade nicht annehmen — bitte später
  erneut"); (b) die Fälle trennen, die ein Mensch auslöst (Stundengrenze, Nur-Link-Kommentar)
  und dafür eine **echte** Rückmeldung geben, statt sie in den Spam-Eimer zu werfen.
  Mindestens: das Formular beim Absenden nicht leeren, bevor 201 zurück ist.
- **Beleg:** Live gegen avesmaps.de. Honigtopf-Probe (`website` gefüllt, sonst vollständig
  gültig) → **HTTP 200**, Körper `{"ok":true,"message":"Karteneintrag wurde gemeldet."}`.
  Echte Meldung „ZZ-Systemtest Ambosshain" über das Formular → **HTTP 201**, Körper
  **zeichengleich**. Toast im DOM danach abgelesen: `#copy-feedback-toast` =
  „Karteneintrag wurde gemeldet.", Fenster geschlossen, `location-report-name` leer.
  Die sechste Meldung derselben Stunde („ZZ-Systemtest Ratengrenze Probe", mit Quelle) →
  ebenfalls **200 + Erfolgstext**, keine Zeile angelegt.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (Statuscode auswerten) bis mittel (Fälle sauber trennen)

### B2 Der stille Filter ist nicht still: 201 gegen 200 verrät jedem Bot, was durchkam
- **Kategorie:** KANN
- **Fundstelle:** api/app/report-location.php:84 / :99 (200) gegen :184 (201);
  api/app/contact.php:32 / :40 (200, „Nachricht wurde gesendet.") gegen :81-84
  (201, „Danke! Deine Nachricht ist angekommen.") — samt Kommentar Zeile 31:
  „Silently accept so bots get no signal about what was filtered."
- **Beobachtung:** Der Zweck der Konstruktion ist, dem Absender kein Signal zu geben. Das
  Signal steht aber im Statuscode: **201 = gespeichert, 200 = weggeworfen**. Beim
  Kontaktformular ist es noch deutlicher — dort unterscheiden sich zusätzlich die **Texte**.
  Ein Spammer braucht keine zwei Versuche, um das zu merken; er variiert, bis er 201 sieht,
  und hat damit den Filter kartiert. Der Mensch, für den die Ununterscheidbarkeit gedacht
  war, bemerkt sie dagegen nie (B1). Die Schutzwirkung ist also genau verkehrt herum verteilt.
- **Erwartet:** Wenn still, dann still: derselbe Statuscode und derselbe Text für den
  angenommenen und den verworfenen Fall (und die Unterscheidung nur im Serverprotokoll).
  Oder — besser, siehe B1 — die Ehrlichkeit gegenüber dem Menschen wählen und den
  Spam-Filter nicht auf Verschleierung bauen.
- **Beleg:** Vier eigene Anfragen, Statuscode und Körper mitgeschrieben:
  Meldung echt → `201 {"ok":true,"message":"Karteneintrag wurde gemeldet."}`;
  Meldung Honigtopf → `200 {"ok":true,"message":"Karteneintrag wurde gemeldet."}`;
  Kontakt echt → `201 {"ok":true,"message":"Danke! Deine Nachricht ist angekommen."}`;
  Kontakt Honigtopf → `200 {"ok":true,"message":"Nachricht wurde gesendet."}`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 Die Stundengrenze zählt Änderungsvorschläge mit — fünf Korrekturen, und der nächste Ortsvorschlag verschwindet
- **Kategorie:** AKUT
- **Fundstelle:** api/app/report-location.php:98 (`$mapReport['report_mode'] !== 'change' &&
  avesmapsReportRateLimitExceeded(...)`) gegen :436-448 (`avesmapsReportRateLimitExceeded`
  zählt **alle** Zeilen mit diesem `ip_hash`, ohne `report_mode`-Filter) und :158-182
  (auch Änderungsberichte werden mit `ip_hash` geschrieben)
- **Beobachtung:** Der Kommentar bei Zeile 95-97 begründet die Ausnahme so: „an active
  contributor legitimately files several in a row". Die Ausnahme gilt aber nur für die
  **Prüfung**, nicht für die **Zählung** — jeder Änderungsvorschlag füllt den Eimer weiter.
  Folge: wer fünf Korrekturen an bestehenden Orten schickt (das erklärte Wunschverhalten),
  darf danach eine Stunde lang **keinen neuen Ort mehr melden**; sein Vorschlag wird still
  verworfen (B1). Zwei weitere Eigenschaften derselben Stelle:
  - Der Eimer hängt **allein an der IP** (`hash_hmac('sha256', avesmapsClientIpAddress(), …)`,
    :427-434). Ein Haushalt, ein Verein, ein Uni-Netz, ein Mobilfunk-CGNAT teilen sich fünf
    Meldungen pro Stunde.
  - **Der angemeldete Editor ist nicht ausgenommen.** `report-location.php` ruft an keiner
    Stelle eine Anmelde- oder Rechteprüfung auf; für den Endpunkt ist ein eingeloggter Admin
    derselbe Besucher wie ein Fremder.
- **Erwartet:** `avesmapsReportRateLimitExceeded` soll zählen, was es begrenzt — also
  `AND report_mode <> 'change'`. Und die Grenze sollte, wo eine Anmeldung vorliegt, an das
  Konto statt an die IP gehängt werden.
- **Beleg:** Die Grenze **live abgetastet**, mit genau sechs schreibenden Anfragen. Reihenfolge
  und Ergebnis: (1) Ortsmeldung über das Formular, angemeldet → 201; (2) Änderungsvorschlag
  Angbar über das Formular, angemeldet → 201; (3)(4)(5) je eine anonyme Kommentarmeldung
  (`credentials:"omit"`) → 201, 201, 201; (6) anonyme Ortsmeldung → **200 ohne Zeile**.
  Daraus folgt zweierlei zwingend: der Eimer stand vorher auf 0 und wurde durch genau diese
  fünf Zeilen gefüllt — also **hat der Änderungsvorschlag mitgezählt** (sonst hätte er bei 4
  gestanden und Nr. 6 wäre durchgegangen) — und **die beiden angemeldeten Meldungen zählen in
  denselben IP-Eimer wie die anonymen** (sonst wären erst drei Zeilen dagewesen).
- **Sicherheit:** BELEGT
- **Aufwand:** klein (die `AND`-Bedingung) bis mittel (Konto statt IP)

### B4 Auf der Karte gibt es keinen sichtbaren Weg, einen fehlenden Ort zu melden
- **Kategorie:** KANN
- **Fundstelle:** https://avesmaps.de/ — Startbild; Einstieg nur über
  `.map-context-menu__item[data-context-action="report-location"]` (Rechtsklick),
  Erklärtext dazu in index.html:2219 (`legal.communityReports.body`)
- **Beobachtung:** Ich habe alle sichtbaren Knöpfe und Links des Startbildes ausgelesen: DE/EN,
  hell/dunkel, Ansichtswähler, sechs Ortsklassen-Symbole, Routenplaner, Zoom, „Hinweise". Kein
  einziger nennt Melden, Beitragen, Mitmachen oder Fehler. Der einzige Weg zu einer **neuen**
  Meldung ist ein **Rechtsklick auf die Karte** — ohne Mauszeiger-Hinweis, ohne Erwähnung in
  den Bedienhilfen, ohne Tastenbefehl. Das Hinweise-Fenster erwähnt Community-Meldungen zwar
  (Karte „Inhalte und Datenquellen" → „Wegedaten, Wiki-Abgleich, Community-Meldungen"), aber
  der Absatz dahinter ist reiner Rechtstext („werden nicht automatisch veröffentlicht … Mit
  dem Absenden einer Meldung wird keine Veröffentlichung zugesagt … Art. 6 Abs. 1 lit. a und f
  DSGVO"). Er sagt, was mit einer Meldung geschieht — **nie, wo man sie absetzt**.
  Zum Ausgleich, und das ist gut gelöst: hat man erst einmal einen Ort angeklickt, stehen im
  Infopanel drei sichtbare Beitrags-Knöpfe („Änderungen vorschlagen", „★ Bewertung schreiben",
  „Karte vorschlagen"). Nur der Weg für das, was **noch nicht auf der Karte ist**, fehlt.
- **Erwartet:** Ein sichtbarer Einstieg — eine Zeile im Hinweise-Fenster („Etwas fehlt?
  Rechtsklick auf die Stelle → ‚Hier melden…'"), ein Eintrag in den Bedienhilfen, oder ein
  kleiner Knopf neben „Hinweise". Der Rechtsklick darf der schnelle Weg bleiben; er darf nur
  nicht der einzige sein.
- **Beleg:** Im Browser gezählt: alle `button, a, [role=button], summary` mit sichtbarer
  Box gefiltert auf `/meld|vorschlag|kontakt|hinweis|impressum|fehler|beitrag/i` → einziger
  sichtbarer Treffer `#legal-button` („Hinweise", unten rechts bei x 2472 / y 1171 von
  2560 × 1215); „Hier melden…" nur als unsichtbarer Knoten (`width 0`). Rechtsklick auf die
  Karte → Menü mit sechs sichtbaren Einträgen, darunter „Hier melden…". Rechtstext aus
  index.html:2219 gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B5 Nach dem Absenden bleiben 2,2 Sekunden Toast — keine Nummer, kein Nachlesen, kein Ausgang
- **Kategorie:** KANN
- **Fundstelle:** js/review/review-report-flow.js:222-225 zusammen mit
  js/map-features/map-features.js:208-229 (`showFeedbackToast`, Timeout **2200 ms**)
- **Beobachtung:** Die gesamte Rückmeldung für einen Beitrag ist ein Einblender von
  2,2 Sekunden mit dem Satz „Karteneintrag wurde gemeldet.". Danach ist das Fenster zu, das
  Formular geleert und nichts mehr da: **keine Vorgangsnummer**, keine Kopie, kein Ort zum
  Nachschauen, keine Möglichkeit, über den Ausgang benachrichtigt zu werden — das Formular
  hat nicht einmal ein E-Mail-Feld, nur „Dein Name/Pseudonym (optional)". Wer den Toast
  verpasst (anderer Bildschirmbereich, Hintergrundtab, kurz weggeschaut), weiß nicht, ob
  seine halbe Stunde Recherche angekommen ist — und kann es nirgends nachprüfen. Das trifft
  zusammen mit B1: ausgerechnet der verlorene Fall sieht genauso aus.
  Die Einleitung des Fensters sagt immerhin „Alle Meldungen werden gesammelt und geprüft" —
  das ist der einzige Hinweis auf ein „danach", und er steht **vor** dem Absenden.
- **Erwartet:** Eine bleibende Bestätigung im Fenster statt eines Einblenders, mit einer
  Kennung, die man notieren kann; optional ein E-Mail-Feld für die Rückmeldung „übernommen /
  nicht übernommen" (der Rechtstext sagt ausdrücklich, dass keine Veröffentlichung zugesagt
  ist — dann ist die Absage die eigentlich wichtige Nachricht).
- **Beleg:** Nach dem Absenden von „ZZ-Systemtest Ambosshain" im DOM abgelesen:
  `#copy-feedback-toast` = „Karteneintrag wurde gemeldet.", Breite 0 (schon ausgeblendet),
  `#location-report-dialog` geschlossen, Namensfeld leer. Timeout-Wert aus
  map-features.js:228 (`}, 2200)`). Formularfelder aufgezählt: kein E-Mail-Feld.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 Die Serverfehler des Meldeformulars sind deutsch ohne Umlaute — und benennen Felder, die der Melder nie gesehen hat
- **Kategorie:** KANN
- **Fundstelle:** api/app/report-location.php:242, 247, 254, 262, 297 und api/\_internal/
  bootstrap.php:288, :298; angezeigt über js/app/api-client.js:5-11 (`apiErrorMessage`
  gibt `error.message` **wörtlich** zurück) → js/review/review-report-flow.js:228
- **Beobachtung:** Alle Absagen des Servers erreichen den Melder unverändert im Fenster:
  „Bitte einen Namen angeben.", „Die Art der Meldung ist **ungueltig**.",
  „Die **Ortsgroesse** ist **ungueltig**.", „Bitte mindestens eine Quelle angeben.",
  „Die **Koordinate lat** ist **ungueltig**.", „Der Wiki-Link muss mit http:// oder https://
  beginnen.". Drei Dinge daran:
  1. **Die ae/oe/ue-Umschreibung des Hausstils gilt für Kommentare, nicht für das, was im
     Fenster steht** — AGENTS.md §11 schreibt genau diesen Satz für den Änderungsverlauf auf.
     Hier steht er in einem Dialog, den ein Leser vor sich hat.
  2. „**lat**" ist ein interner Feldname. Das Fenster beschriftet die Stelle mit „POSITION".
  3. Eine **fehlende** Angabe wird als „ungueltig" gemeldet, nicht als fehlend — und es wird
     immer nur die erste genannt. Wer Ortsgröße, Quelle und Position vergisst, arbeitet drei
     Absagen nacheinander ab.
  Zusätzlich sind diese Sätze **nur deutsch**: `i18n-en.js` enthält keinen einzigen davon,
  und `apiErrorMessage` reicht sie unübersetzt durch. Ein englischsprachiger Besucher bekommt
  im ansonsten übersetzten Formular eine deutsche Fehlermeldung.
- **Erwartet:** Echte Umlaute in allem, was der Server als `message` an den Browser gibt;
  Feldnamen aus der Oberfläche statt aus dem Schema; „fehlt" statt „ungueltig", wenn etwas
  fehlt. Für Englisch: entweder maschinenlesbaren `error.code` im Client auf einen
  i18n-Schlüssel abbilden (die Codes gibt es schon: `invalid_request`, `conflict`) oder die
  Sätze in die Stringtabelle aufnehmen.
- **Beleg:** Eigene anonyme Anfrage (`credentials:"omit"`) mit Name, aber ohne Ortsgröße,
  Quelle und Position → **HTTP 400**, Körper
  `{"ok":false,"error":{"code":"invalid_request","message":"Die Ortsgroesse ist ungueltig."}}`.
  Die übrigen Sätze aus den genannten Zeilen gelesen. Übersetzungslücke geprüft:
  `grep -c '"Ortsgroesse\|existiert bereits\|Koordinate"' js/app/i18n-en.js` → 0.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B7 Im englischen Meldeformular bleibt der ganze Quellenblock deutsch — sechs `data-i18n`-Schlüssel fehlen in der Stringtabelle
- **Kategorie:** KANN
- **Fundstelle:** index.html:1035 (`report.sectionReport`), :1092 (`report.sectionSources`),
  :1094 (`report.sourcesLabel`), :1113 (`#report-source-kind`, ganz ohne `data-i18n`),
  :1113 (`report.sourceOfficialLabel`), :1114 (`report.sourceAdd`), :1120
  (`report.sectionMore`) — gegen js/app/i18n-en.js;
  dazu js/review/review-locations.js:64 und js/review/review-report-flow.js:262
- **Beobachtung:** Das Formular trägt die Schlüssel ordentlich im Markup — nur stehen sie in
  `i18n-en.js` nicht drin, also fällt die Schicht auf den deutschen Originaltext zurück. Im
  englischen Fenster stehen dadurch nebeneinander: „Report a map entry", „Type of entry \*",
  „Name of the new entry \*" — und **„Ich habe folgende Meldung"**, **„Ich habe folgende
  Quellen"**, **„Quellen \* (mind. eine — Regionalband, Abenteuer, …)"**, **„Noch keine Quelle
  hinzugefügt."**, **„+ Quelle hinzufügen"**, **„offiziell"**, **„Weiteres"**. Das
  Abdeckungs-Auswahlfeld `#report-source-kind` hat **überhaupt kein `data-i18n`** — seine vier
  Einträge („Abdeckung: Standardquelle", „Ausführliche Quellen", „Ergänzende Quellen",
  „Erwähnungen") und sein `title` sind bauartbedingt unübersetzbar. Und
  `report.statusNoSource` — die Absage „Bitte mindestens eine Quelle angeben (Name genügt)",
  also die **wahrscheinlichste** Fehlermeldung dieses Formulars — fehlt ebenfalls.
  Getroffen ist damit genau die Pflichtangabe, an der ein englischsprachiger Beitragender
  hängenbleibt.
  Nebenbei: `report.toastSubmitted` („Map entry has been reported.") existiert zwar, kann aber
  nie erscheinen — `finalizeLocationReportSubmission` benutzt `message || tr(…)`, und der
  Server liefert **immer** einen deutschen `message`. Der englische Erfolgstoast ist toter Code.
- **Erwartet:** Die sechs fehlenden Schlüssel plus `report.statusNoSource` nachtragen, dem
  Abdeckungs-Auswahlfeld Schlüssel geben, und den Toast auf den i18n-Text statt auf die
  Serverantwort setzen (dann wirkt auch der vorhandene englische Satz).
- **Beleg:** Alle `data-i18n="report.*"` aus index.html gezogen und gegen `i18n-en.js`
  geprüft: fehlend sind `report.sectionMore`, `report.sectionReport`, `report.sectionSources`,
  `report.sourceAdd`, `report.sourceOfficialLabel`, `report.sourcesLabel`; zusätzlich
  `report.statusNoSource` (aus review-report-flow.js:262) → `grep -c` jeweils **0**.
  Im Browser unter `?lang=en` das Fenster geöffnet und die Textknoten ausgelesen — dieselben
  dreizehn deutschen Zeichenketten standen dort.
  ⚠️ **Ehrlich dazu:** ich habe in diesem englischen Durchgang zunächst geglaubt, das
  Meldefenster öffne ohne Position. Das war **mein** Fehler — mein synthetischer Rechtsklick
  hatte das Kontextmenü gar nicht geöffnet, ich habe ein nie befülltes Formular abgeschickt
  und die korrekte Absage „The selected position is invalid." als Bug gelesen. Der
  Übersetzungsbefund oben hängt nicht daran: er ist am Quelltext bewiesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B8 Ein Kommentar, der nur aus dem Beleglink besteht, wirft die ganze Meldung weg
- **Kategorie:** KANN
- **Fundstelle:** api/app/report-location.php:327 (`|| avesmapsIsLinkOnlyText($comment)`)
  und :417-425
- **Beobachtung:** Besteht das Kommentarfeld nach Abzug aller `https?://…` nur noch aus
  Leerraum, gilt die **komplette** Meldung als Spam und verschwindet — mit Erfolgsmeldung
  (B1). Das ist als Spamregel nachvollziehbar, trifft aber ein sehr naheliegendes echtes
  Verhalten: Man hat den Wiki-Artikel offen, kopiert die Adresse und setzt sie in
  „Kommentar (zur näheren Beschreibung)". Dass daneben ein eigenes Feld „Wiki-Aventurica Link"
  steht, hilft nicht — es ist optional und heißt anders. Name, Ortsgröße, Position und Quelle
  können vollständig und sauber ausgefüllt sein; die Meldung ist trotzdem weg.
- **Erwartet:** Die Nur-Link-Regel auf den Fall anwenden, in dem **nichts anderes** an der
  Meldung Substanz hat — oder den Kommentar in diesem Fall verwerfen und die Meldung
  behalten. Alternativ das Feld beschriften („bitte in eigenen Worten; Links gehören ins
  Feld darüber").
- **Beleg:** Codestelle gelesen; `preg_replace('/https?:\/\/\S+/iu', '', …)` und danach
  `=== ''`. Nicht live ausgelöst — mein Meldebudget war ausgeschöpft.
- **Sicherheit:** BELEGT (gelesen), Auswirkung auf echte Melder PLAUSIBEL
- **Aufwand:** klein

### B9 Bewertungen sind sofort und ungeprüft öffentlich, und die Orts-ID wird nie geprüft
- **Kategorie:** AKUT
- **Fundstelle:** api/app/location-reviews.php:54-57 (`location` wird nur auf „nicht leer"
  geprüft), :97-114 (Einfügen mit `is_hidden = 0`), api/\_internal/reviews.php:122-147
  (`WHERE is_hidden = 0 AND is_spam = 0` — sonst nichts)
- **Beobachtung:** Zwei getrennte Punkte an derselben Stelle:
  1. **Keine Moderation vor der Veröffentlichung.** Eine Bewertung ist in derselben Sekunde
     für jeden Besucher lesbar. Das Fenster sagt das offen („Bewertungen erscheinen sofort.")
     — es ist also eine Entscheidung, keine Panne. Der Filter davor ist eine
     Teilzeichenketten-Liste (`casino, crypto, viagra, loan, betting, porn, sex, seo, http://,
     https://, www.`) über nur zwei Felder. Alles andere steht sofort auf der Karte, an einem
     benannten Ort, bis ein Mensch es entfernt. Die einzige Bremse ist dieselbe
     IP-Stundengrenze wie bei den Meldungen (5).
     Nebenwirkung der Substring-Prüfung: ein Wort wie „Sextant" enthält „sex" — die Bewertung
     wird als Spam abgelegt, ist unsichtbar, und der Schreiber bekommt „Danke für deine
     Bewertung!" (dieselbe Familie wie B1).
  2. **`location_public_id` wird nie gegen `map_features` geprüft.** Jede Zeichenkette bis 64
     Zeichen wird als Ort akzeptiert. Damit lassen sich beliebig viele Zeilen anlegen, die zu
     keinem Ort gehören — für niemanden sichtbar, für keinen Editor auffindbar (er sieht
     Bewertungen am Ort), aber in der Tabelle und in jeder Sicherung.
- **Erwartet:** Zu 1: bewusst so — dann gehört ein Hinweis in die Betriebsdoku, **wie schnell**
  jemand einschreiten kann; wenigstens eine Benachrichtigung an den Betreiber bei jeder neuen
  Bewertung. Zu 2: ein `SELECT 1 FROM map_features WHERE public_id = :pid AND is_active = 1`
  vor dem Einfügen — zwei Zeilen.
- **Beleg:** Live erzeugt: über das Infopanel von Angbar eine Bewertung mit 3 Sternen
  abgesetzt (`POST /api/app/location-reviews.php` → **201**). Unmittelbar danach **anonym**
  gelesen: `GET …/location-reviews.php?location=7b162e58-…-adfa4c053506` mit
  `credentials:"omit"` → `{"average":3,"count":1}`, erste Bewertung **id 121**, Autor
  „ZZ-Systemtest (Agent 10)", `created_at 2026-08-05 07:50:13`. Zwischen Absenden und
  öffentlicher Sichtbarkeit lag kein Zwischenschritt. Die fehlende Prüfung der Orts-ID am
  Quelltext gelesen (nicht ausgenutzt — ich habe keine erfundene ID geschrieben).
- **Sicherheit:** BELEGT (Punkt 1 live, Punkt 2 gelesen)
- **Aufwand:** klein (ID-Prüfung) bis mittel (Moderationsablauf)

### B10 Jeder Ortsvorschlag lädt die gesamte Ortstabelle in PHP und vergleicht sie Name für Name
- **Kategorie:** KANN
- **Fundstelle:** api/app/report-location.php:486-524 (`avesmapsLocationNameExists`),
  aufgerufen in :92
- **Beobachtung:** Für jede Meldung mit `report_type = 'location'` läuft
  `SELECT name FROM map_features WHERE feature_type='location' AND is_active=1` **ohne
  Grenze**, das Ergebnis wird vollständig nach PHP geholt, und für jede Zeile wird
  `avesmapsNormalizeDuplicateText` ausgeführt — `mb_strtolower` plus ein Unicode-`preg_replace`.
  Danach dasselbe noch einmal über alle offenen Meldungen. Bei der in AGENTS.md §11 genannten
  Größenordnung von 4.653 Orten sind das rund 4.700 Regex-Läufe je Vorschlag, nur um
  festzustellen, ob der Name schon existiert. Das ist eine Schreiboperation und damit selten —
  aber es ist genau die Bauart, die AGENTS.md §10 an anderer Stelle als Hotspot führt, und sie
  ist vermeidbar: die Normalisierung ist deterministisch und ließe sich als Spalte mit Index
  ablegen, oder wenigstens auf Kandidaten mit gleicher Länge einschränken.
- **Erwartet:** Normalisierten Namen einmal beim Schreiben ablegen (`name_normalized`,
  Index), dann ist die Prüfung ein einzelner `SELECT … WHERE name_normalized = ?`.
- **Beleg:** Codestelle gelesen; Ortszahl aus AGENTS.md §11 („571 von 4.653") übernommen, nicht
  selbst gezählt. Laufzeit habe ich **nicht** gemessen — dafür hätte ich eine weitere Meldung
  absetzen müssen, und mein Budget war aufgebraucht.
- **Sicherheit:** BELEGT (Code), Größenordnung PLAUSIBEL
- **Aufwand:** mittel

### B11 Jede Meldung führt neun Schema-Abfragen aus, bevor sie geschrieben wird
- **Kategorie:** KANN
- **Fundstelle:** api/app/report-location.php:526-589 (`avesmapsEnsureMapReportsTable`),
  aufgerufen in :91
- **Beobachtung:** Vor dem eigentlichen `INSERT` laufen bei **jeder** Meldung: ein
  `CREATE TABLE IF NOT EXISTS`, **sieben** `SHOW COLUMNS FROM map_reports LIKE …`
  (`reporter_name`, `ip_hash`, `sources_json`, `report_mode`, `entity_type`,
  `entity_public_id`, `payload_json`) und ein `SHOW INDEX FROM map_reports`. Das ist das
  Selbstheilungsmuster des Hauses und auf einem Schreibpfad weit weniger schlimm als auf einem
  Lesepfad — aber es sind neun Metadaten-Abfragen für eine Zeile, und die Liste wächst mit
  jeder künftigen Spalte. Sie macht die Datei außerdem ohne lebende Datenbank untestbar,
  dieselbe Beobachtung, die AGENTS.md §11 für den Änderungsverlauf als Grund nennt, DDL aus
  dem Lesepfad herauszuhalten.
- **Erwartet:** Einmal je Prozess merken (statische Sperre) oder das Nachrüsten in ein
  Wartungsskript verschieben, das der Betreiber nach einem Deploy einmal anstößt.
- **Beleg:** Funktion gelesen und die Aufrufe gezählt (7 × `avesmapsEnsureMapReportColumn`,
  1 × `avesmapsEnsureMapReportIndex`, 1 × `CREATE TABLE IF NOT EXISTS`).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B12 Ein Änderungsvorschlag wird mit „Karteneintrag wurde gemeldet." bestätigt
- **Kategorie:** KANN
- **Fundstelle:** api/app/report-location.php:186 (eine einzige Erfolgsmeldung für alle
  `report_mode`) gegen die Fensterüberschrift „Änderung vorschlagen – Angbar", gesetzt in
  js/review/review-locations.js:351 (`applyChangeSuggestionContext`)
- **Beobachtung:** Das Fenster heißt „Änderung vorschlagen – Angbar", die Einleitung sagt
  „Schlage eine Änderung an diesem Element vor", das Kommentarfeld heißt „Was soll geändert
  werden? \*" — und die Bestätigung sagt dann „**Karteneintrag wurde gemeldet.**". Für den
  Leser klingt das, als hätte er einen neuen Eintrag angelegt statt eine Korrektur
  vorgeschlagen. Kleinigkeit, aber sie steht am einzigen Punkt, an dem die Anwendung
  überhaupt etwas bestätigt (B5).
- **Erwartet:** Eine zweite Zeichenkette für `report_mode = 'change'`, etwa
  „Änderungsvorschlag wurde gesendet."
- **Beleg:** Änderungsvorschlag zu Angbar live abgesetzt (HTTP 201); Antwortkörper
  `{"ok":true,"message":"Karteneintrag wurde gemeldet."}`, Toast im DOM gleichlautend.
  Fenstertexte im geöffneten Dialog abgelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## Was ausdrücklich gut ist (kein Befund)

- **Das Änderungs-Formular ist sorgfältig gebaut.** Aus dem Infopanel heraus öffnet es mit
  Überschrift „Änderung vorschlagen – Angbar", **gesperrten** Feldern für Art und Ortsgröße
  (grau, nicht anfassbar), vorbelegtem Namen, `entity_type=settlement` und
  `entity_public_id=7b162e58-…`, die Quellenpflicht wird zu „Quellen (optional)" und das
  Kommentarfeld heißt „Was soll geändert werden? \*". Die Kopfzeilen von
  `js/review/review-locations.js` erklären sogar, warum die gesperrten Felder über
  `formElement.elements` und nicht über `FormData` gelesen werden — genau die Falle, die den
  Bericht sonst zu einer Siedlungsmeldung machen würde.
- **Die clientseitige Prüfung verschwendet keine Anfrage.** Leeres Formular → native
  Browserblase „Fülle dieses Feld aus." am Namensfeld, **kein** POST. Nur Name → „Bitte
  mindestens eine Quelle angeben (Name genügt)." in Rotbraun (`data-status="error"`,
  `role="status"`, `aria-live="polite"`), Fokus springt ins Quellenfeld, **kein** POST.
- **Eine ins Eingabefeld getippte Quelle geht mit**, auch ohne „+ Quelle hinzufügen" zu
  drücken — ich hatte den umgekehrten Fehler erwartet und ihn nicht gefunden.
- **Der Honigtopf des Kontaktformulars ist sauber:** `<div class="legal-contact__hp"
  aria-hidden="true">` mit `tabindex="-1"`, `autocomplete="off"`, bei x = −9130 aus dem Bild
  geschoben. Ein Screenreader läuft nicht hinein.
- **Das Bewertungsfenster ist ehrlich:** „Bewerte Angbar mit 1–5 Sternen und einem kurzen
  Kommentar (max. 200 Zeichen). **Bewertungen erscheinen sofort.**" — es verspricht keine
  Prüfung, die es nicht gibt. Zeichenzähler (`119/200`), Sternehinweis („3 von 5"), und das
  aventurische Datum wird automatisch gesetzt („5. Rondra 1049 BF").
- **Der Rechtstext zu Community-Meldungen ist vollständig** (keine Zusage auf
  Veröffentlichung, Rechtsgrundlage genannt) — er steht nur an einer Stelle, die niemand
  sucht, der etwas melden will (B4).

## Grenzen dieses Laufs (ehrlich benannt)

- Mein Browsertab war den ganzen Lauf über **nicht der aktive** (`visibilityState "hidden"`).
  Folge: `computer`-Screenshots liefen zeitweise in 30-s-Timeouts, und ab der zweiten Hälfte
  kamen meine Rechtsklicks nicht mehr auf der Karte an. **Ein Befund ist daraus nicht
  geworden** — siehe die Selbstkorrektur unter B7. Drei Screenshots sind gelungen und im
  Bericht benannt (`ss_8698n50dm` Meldeformular, `ss_9573u22qh` Änderungsformular,
  `ss_2780wcl76` Bewertungsformular); der Chrome-MCP legt keine Bilddateien ab.
- **`credentials:"omit"` ist bei `report-location.php` wirkungslos** — der Endpunkt liest
  nirgends eine Sitzung. Ich habe es dennoch überall benutzt, wo es der Auftrag verlangte, und
  im Ergebnis den Gegenbeweis: die angemeldeten und die anonymen Meldungen landen im selben
  IP-Eimer (B3). Die Annahme im Auftrag („der Endpunkt nimmt Editoren vom Rate-Limit aus")
  trifft nicht zu; ausgenommen sind **Änderungsberichte**, nicht Editoren.
- **Nicht geprüft:** Kartenvorschlag („Karte vorschlagen") und Fundort-Meldung — beide gehen
  über denselben Endpunkt mit eigenem `payload_json`, hätten aber je eine weitere Meldung
  gekostet. Ebenso ungetestet: der 409-Pfad („Ein Ort mit diesem Namen existiert bereits"),
  die Spamwortliste live, und alles hinter dem Editor (gehört Agent 11).
- **Ich habe im Editor nichts angefasst**, keinen Sync, keinen Massenlauf, kein Backup.

## Serverzustand

Durchgehend gesund. Elf Schreibanfragen (8 × `report-location.php`, 2 × `contact.php`,
1 × `location-reviews.php`) und ein knappes Dutzend Lesezugriffe, alle unter zwei Sekunden,
kein 5xx, kein Timeout, keine Wiederholung. Der Kartenaufbau lief mit 11 486 Features und
sauberer Konsole. Ich habe bewusst einzeln und mit Abstand gesendet, nie in einer Schleife.
