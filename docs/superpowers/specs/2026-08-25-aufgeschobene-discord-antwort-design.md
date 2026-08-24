# Die aufgeschobene Discord-Antwort — Entwurf

**Stand:** 25.08.2026 · **Anlass:** `/erledigt` lief am 24.08.2026 dreimal (22:50–22:51) in
„Avesmaps hat nicht rechtzeitig reagiert". Beim Nachmessen war die Störung von selbst weg,
alle Schichten gesund, der Code seit dem 13.07.2026 unverändert.

---

## 0. Der Befund, der diesen Entwurf umgeschrieben hat

🔴 **Die naheliegende Umsetzung funktioniert auf STRATO NICHT, und das ist gemessen, nicht vermutet.**

Der Lehrbuchweg lautet: Antwort abschicken, Verbindung schließen, danach weiterarbeiten —
`fastcgi_finish_request()`. Eine temporäre Messdatei hat das am 25.08.2026 gegen den echten
Server geprüft:

```
sapi: cgi-fcgi        has_fastcgi_finish_request: false
Ablauf-Beweis (früh abschließen, dann 3 s schlafen):  HTTP 200 nach 3,07 s
```

STRATO fährt **cgi-fcgi**, nicht PHP-FPM. `fastcgi_finish_request` existiert dort nicht, und
die Ersatzvariante über `Content-Length` + `Connection: close` + `ob_end_flush()` + `flush()`
ist **wirkungslos**: Apache hält die Antwort bis zum Prozessende zurück. Hätte niemand
gemessen, wäre ein Feature gebaut worden, das aussieht wie eine Aufschiebung und keine ist —
und das den nächsten Ausfall zusätzlich verschleiert.

⚠️ `function_exists()` allein hätte als Beleg nicht gereicht: auch mit der Funktion könnte
Apache davor puffern. Deshalb misst der Beweis den **Ablauf** (AGENTS.md §9: „Abnahme heißt
ABLAUF, nicht Maß"), nicht das Vorhandensein.

---

## 1. Warum überhaupt

Discord gibt einer Interaction **3 Sekunden** für die *initiale* Antwort. Der Bot antwortet
heute **synchron**: erst arbeiten, dann antworten. Damit hängt jede Antwort an der Datenbank —
und jede Verzögerung von STRATO wird als kaputter Bot sichtbar.

💣 **Die Meldung nennt keine Schicht.** „Hat nicht rechtzeitig reagiert" erscheint bei Timeout,
bei HTTP 401, bei HTTP 500 und bei leerem Rumpf (Fatal Error) gleichermaßen. Wer sie sieht,
weiß nur, dass *irgendetwas* nicht binnen 3 s eine gültige Antwort war.

Der teuerste Fall ist heute **nicht** `/erledigt`, sondern das **Absenden eines Formulars**
(`/bug`, `/idee`, `/frage`): Es macht einen DB-`INSERT` **und** einen Kanal-Post an die
Discord-API — mit `CURLOPT_TIMEOUT => 8` im selben Aufruf wie die Nutzerantwort. Ist Discords
API einmal träge, ist die 3-Sekunden-Frist garantiert gerissen. Das ist ein latenter Fehler,
der bisher nur nicht zugeschlagen hat.

---

## 2. Was sonst noch gemessen wurde

| Frage | Messung | Ergebnis |
|---|---|---|
| Lebt der Endpunkt? (bootstrap, Config, ext-sodium) | `interactions.php`, 401-Pfad | 0,11 s ✅ |
| DB-Connect + DDL + Lesen auf `discord_cases` | `cases-export.php` (**gleiche Schritte wie `/erledigt`**, nur ohne `UPDATE`) | 0,08 s ✅ |
| Schreibrechte (STRATO-Quotenfalle) | `ecosystem-areas.php` (`INSERT IGNORE` beim Lesen) | HTTP 200 ✅ |
| Kostet ein HTTPS-Selbstaufruf zu viel? | `?mode=selfcall` mit 300 ms Limit | 0,302 s, curl-Fehler 28 = **planmäßig abgebrochen** |
| Überlebt der Gerufene den Abbruch? | Spur nach Abbruch geprüft | **ja** — 2 s gelaufen, Spur geschrieben ✅ |

⭐ **`cases-export.php` ist die Sonde für den `/erledigt`-Pfad**: derselbe `avesmapsCreatePdo`,
dasselbe `avesmapsDiscordEnsureCasesTable`, dieselbe Tabelle. Nur der `UPDATE` fehlt. Wer beim
nächsten Mal wissen will, ob es an der Ablage liegt, fragt ihn — ohne Discord, ohne Signatur.

**Ausgeschlossen und nicht Ursache:** der STRATO-Rechteentzug (bei `ERRMODE_EXCEPTION` würde
ein `1142` eine *sichtbare* Meldung erzeugen, nie einen Timeout) und die Drossel aus
`bootstrap.php` (sie hängt an `contact`, `location-reviews`, `report-location`, `share-link` —
**nicht** am Discord-Endpunkt; geprüft, nicht angenommen).

---

## 3. Die Architektur: zwei Aufrufe

Weil PHP hier nicht antworten und weiterarbeiten kann, wird die Arbeit in einen **eigenen
Aufruf** verlegt:

```
Discord ──> interactions.php  (Aufruf 1, "der Melder")
              1. Signatur prüfen  (wie bisher)
              2. Router fragen: sofort beantwortbar?
                 ja   -> wie bisher antworten, FERTIG
                 nein -> 3. Worker anstoßen: HTTPS an sich selbst,
                            Zeitlimit ~300 ms, Antwort egal
                         4. {"type":5,"data":{"flags":64}} antworten
                            ("Avesmaps denkt nach …")

        ──> discord/worker.php (Aufruf 2, "der Arbeiter")
              5. HMAC prüfen, bootstrap + Config laden
              6. die eigentliche Arbeit (DB, Kanal-Post)
              7. PATCH /webhooks/{application_id}/{token}/messages/@original
                 -> ersetzt "denkt nach" durch das Ergebnis
```

🔴 **Der Nachtrag braucht KEINEN Bot-Token.** `PATCH /webhooks/{application_id}/{interaction_token}/messages/@original`
ist ein Webhook-Pfad; der Interaction-Token authentifiziert ihn. Beide Werte stehen im
Interaction-Rumpf, den Aufruf 1 ohnehin schon hat. Der Bot-Token bleibt damit aus dem ganzen
Nachtragsweg heraus — er wird weiterhin nur für den Kanal-Post gebraucht.

⚠️ Der Interaction-Token ist **15 Minuten** gültig. Das ist reichlich; die Arbeit dauert
Millisekunden.

---

## 4. Was aufgeschoben wird — und was NICHT

💣 **Ein Modal kann nach einem Defer nicht mehr kommen.** Discord erlaubt `MODAL` (Typ 9) nur
als *initiale* Antwort; das Aufschieben verbraucht genau diesen Platz. Wer `/bug` aufschiebt,
hat das Formular für immer verloren.

⭐ **Und genau hier trifft sich die Discord-Regel mit der vorhandenen Architektur:** Der Router
(`avesmapsDiscordRouteInteraction`) ist bereits nebenwirkungsfrei und trennt schon heute
„antworte sofort" von „tu etwas". Die Grenze liegt also nicht neu, sie wird nur benutzt.

| Router-Ausgabe | Befehle | Aufgeschoben? | Warum |
|---|---|---|---|
| `respond` | PING, `/hilfe`, FAQ-Auswahl, **die drei Modal-Öffner**, alle Fehlerfälle | **nein** | kein DB-Zugriff, antwortet aus dem Speicher — und ein Modal *darf* nicht |
| `submit_case` | Absenden von `/bug`, `/idee`, `/frage` | **ja** | DB-`INSERT` + Kanal-Post mit 8 s Limit — der teuerste Pfad |
| `close_case` | `/erledigt` | **ja** | DB-`UPDATE` |
| `list_open_cases` | `/offen` | **ja** | DB-`SELECT` |

🔴 **Owner-Entscheid 25.08.2026: immer aufschieben, keine Sonderfälle.** Ein Verhalten für
alle drei Arbeitspfade, auch wenn die Arbeit oft nur 80 ms dauert. Der Preis ist eine kurz
sichtbare Zwischenstufe („Avesmaps denkt nach …"), der Gewinn ist, dass nie wieder eine
Antwort verloren geht. Keine Heuristik „nur wenn es lange dauert" — die 3 Sekunden laufen ab
dem Eingang, und wer schon arbeitet, hat das Fenster verpasst, bevor er es merkt.

---

## 5. Der Schnitt im Code

Der Prozessor bleibt rein und testbar; die zwei neuen Fähigkeiten kommen wie alles andere
über `$deps` herein (das Muster steht schon: `post`, `insert`, `close`, `open_cases`):

- **`deps['defer']`** — `fn(array $initialeAntwort): void`. Stößt den Worker an und schickt
  die Typ-5-Antwort. Im Test: merkt sich nur, dass und womit gerufen wurde.
- **`deps['followup']`** — `fn(string $appId, string $token, array $antwort): array`. Der
  `PATCH`. Im Test: sammelt den Aufruf.

`avesmapsDiscordProcessRequest` bekommt damit einen zweiten Modus, aber keine zweite Wahrheit:
es entscheidet weiterhin allein anhand der Router-Ausgabe.

💣 **Wenn `defer` gerufen wurde, darf `interactions.php` nichts mehr ausgeben.** Sonst hängt
ein zweiter JSON-Rumpf an einer bereits gesendeten Antwort. Der Rückgabewert muss „ist schon
beantwortet" ausdrücken — nicht durch einen leeren Body, den man mit „nichts zu sagen"
verwechseln kann.

---

## 6. Der Worker und sein Riegel

`api/discord/worker.php` ist ein **öffentlich erreichbarer Endpunkt** und muss so behandelt
werden. Er bekommt die schon geprüfte Interaction weitergereicht — die Ed25519-Signatur ein
zweites Mal zu prüfen ginge nicht (der Rumpf ist ein anderer).

🔴 **Riegel: HMAC über den weitergereichten Rumpf mit dem `app_token`** (`hash_hmac('sha256', …)`,
Vergleich mit `hash_equals` — beides Hausmuster). Ohne ihn könnte jeder mit einem erratenen
Rumpf den Bot Nachrichten schreiben lassen.

💣 **Der Worker muss denselben Startpfad nehmen wie der Melder: `bootstrap.php` UND die Config
laden.** Gemessen am 25.08.2026: der Messendpunkt schrieb ohne geladene Config `23:12:07`,
während der reguläre Pfad `01:12:10` meldete — **zwei Stunden Versatz**. `discord_cases.created_at`
und `solved_at` werden mit `date('Y-m-d H:i:s')` gebildet; ein Worker ohne Config datiert jeden
Fall zwei Stunden in die Vergangenheit, und niemand sieht es, weil die Zeile ja *da* ist.

💣 **Der Anstoß darf nicht am Erfolg hängen.** `curl` bricht planmäßig ins Zeitlimit (Fehler 28
= `CURLE_OPERATION_TIMEDOUT`) — das ist der **Normalfall**, nicht der Fehlerfall. Wer hier auf
`ok` prüft, hält jeden erfolgreichen Anstoß für gescheitert.

⚠️ **`ignore_user_abort(true)` im Worker ist tragend.** Ohne es beendet PHP den Prozess, sobald
der Melder die Verbindung kappt — die Arbeit wäre nie getan. Gemessen wurde es mit dem Flag;
ohne ist es ungetestet und soll es bleiben.

---

## 7. Die Fallen, gesammelt

1. 💣 **Modal nie aufschieben** (§4) — sonst ist das Formular weg.
2. 💣 **Ephemeral wird beim DEFER festgelegt und ist danach nicht mehr änderbar.** Discord:
   beim Typ 5 ist `EPHEMERAL` (64) das einzige gültige Flag. Alle Bot-Antworten sind heute
   ephemer — der Defer muss die 64 also **mitschicken**, sonst wird die Antwort öffentlich,
   und das lässt sich nachträglich nicht mehr einfangen.
3. 💣 **Ein gescheiterter Nachtrag ist schlimmer als der heutige Zustand:** der Nutzer sieht
   dann dauerhaft „denkt nach …" statt einer Fehlermeldung. Der Worker muss deshalb auch im
   Fehlerfall einen `PATCH` schicken — die bestehenden deutschen Fehlertexte aus
   `endpoint.php` wandern mit.
4. 💣 **Zeitzone** (§6) — zwei Stunden, lautlos.
5. 💣 **curl-Fehler 28 ist der Erfolg** (§6).
6. ⚠️ **`PHP_SAPI` ist `cgi-fcgi`** — wer später `fastcgi_finish_request` einbaut, weil es
   „sauberer" ist, baut totes Holz. Der Grund gehört als Kommentar an die Stelle, sonst
   „vereinfacht" der nächste Leser sie zurück (AGENTS.md §9, MySQL-1093-Lehre).
7. ⚠️ **PING (Typ 1) niemals aufschieben** — Discord erwartet PONG. Er läuft über `respond`
   und ist damit automatisch außen vor; das ist Absicht, kein Zufall.

---

## 8. Was das NICHT löst — die ehrliche Grenze

🔴 **Wenn STRATOs PHP-Prozesse gesättigt sind, hilft die Aufschiebung nicht.** Dann wird schon
Aufruf 1 nicht bedient, und die Quittung geht so wenig raus wie heute die Antwort. Die
Aufschiebung schützt gegen *langsame Arbeit*, nicht gegen *keinen freien Prozess*.

⚠️ **Sie macht den Normalfall sogar geringfügig langsamer** — statt ~0,08 s DB-Arbeit steht
ein Anstoß von bis zu 0,3 s im kritischen Pfad. Das ist bewusst in Kauf genommen: 0,3 s merkt
niemand, ein verlorener Befehl schon.

⚠️ **Und sie verdoppelt die PHP-Prozesse pro Befehl** (zwei statt einem). Bei diesem Bot ist
das unerheblich — es sind einzelne Befehle am Tag, keine Last —, aber es ist die Richtung, vor
der AGENTS.md bei STRATO warnt, und es gehört benannt, nicht verschwiegen.

Was am 24.08. wirklich los war, bleibt damit **unbewiesen**: die Störung war beim Nachmessen
weg, und keine Schicht zeigte einen Defekt. Dieser Entwurf beseitigt eine strukturelle
Verwundbarkeit — er erklärt nicht rückwirkend jenen Abend.

---

## 9. Tests

Das Testfeld liegt heute in `tests/discord/` (eigene Konvention, `test_*.php`) und wird über
injizierte `$deps` gefahren — kein Netz, keine DB.

- `defer` wird für `submit_case`/`close_case`/`list_open_cases` gerufen, für `respond` **nicht**
  (die Modal-Öffner sind die scharfe Zusicherung).
- Die Defer-Antwort trägt Typ 5 **und** `flags: 64`.
- Nach einem `defer` gibt der Prozessor keinen zweiten Rumpf aus.
- Der Worker schickt auch im Fehlerfall einen `PATCH` (kein stummes „denkt nach").
- Der HMAC-Riegel weist einen verfälschten Rumpf ab.
- Der Anstoß gilt bei curl-Fehler 28 als **erfolgreich**.

⚠️ **`tests/discord/` liegt außerhalb beider Testmuster des Deploys** (`find api tools …`) und
läuft dort **nicht** mit. Das ist der Grund, warum `test_commands.php` seit dem 13.07.2026 rot
sein konnte, ohne dass es jemandem auffiel (er zählt „five commands", es sind sechs). Wer diese
Tests schreibt, muss sie **von Hand** fahren — oder sie gehören nach
`api/_internal/discord/__tests__/`, wo das Tor sie sieht. **Empfehlung: dorthin.**

---

## 10. Offen

- 🔧 **Der rote `test_commands.php`** — Einzeiler, gehört mitgenommen, sobald das Testfeld
  ohnehin angefasst wird.
- 🔧 **Der Bot-Token-Reset** steht seit Juli offen (Chat-Leak). Für diesen Entwurf ohne Belang
  (der Nachtrag braucht ihn nicht), für den Kanal-Post schon: er ist *best effort*, ein
  ungültiger Token lässt ihn **still** scheitern.
- 🔧 **Ungemessen: wie kurz das Anstoß-Zeitlimit werden darf.** 300 ms sind belegt; ob 150 ms
  noch zuverlässig einen Worker starten, ist es nicht. Im Zweifel bei 300 ms bleiben.
