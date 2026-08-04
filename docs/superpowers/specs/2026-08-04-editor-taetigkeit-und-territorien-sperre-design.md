# Editor-Tätigkeit sichtbar machen + Territorien exklusiv — Entwurf

**Datum:** 2026-08-04
**Status:** vom Owner abgenommen (Brainstorming 2026-08-04)

## 1. Das Problem

Es gibt inzwischen acht Editoren mit verschiedenen Zuständigkeiten. Die Präsenz-Anzeige
(Editor-Panel → Reiter „Status") zeigt heute nur **wer** online ist, nicht **woran** jemand
sitzt. Und für die Territorien gibt es überhaupt keinen Schutz: zwei Editoren können
gleichzeitig am selben Herrschaftsbaum arbeiten, und wer zuletzt speichert, gewinnt.

Einzelne Karten-Objekte (ein Weg, ein Ort) sind bereits geschützt — `map_feature_locks`,
Sperre je `public_id` mit Ablaufzeit. Das ist objektfein und trägt dort. Für einen
zusammenhängenden Baum, in dem ein Speichern auf Eltern und Geschwister durchschlägt
(vgl. die Albenhus/Zwerch-Anomalie in AGENTS.md §10), reicht Objektfeinheit nicht.

## 2. Owner-Entscheide (nicht neu verhandeln)

1. **Der Zweite kommt rein, darf aber nur schauen.** Nicht aussperren (Nachschauen ist der
   häufigere Grund, den Editor zu öffnen), nicht bloß warnen (löst das Problem nicht).
2. **Nur Territorien** bekommen die harte Sperre. Wörtlich: „der rest ist nicht wirklich
   zusammenhängend." Landschaften waren im Vorschlag, wurden bewusst gestrichen.
3. **Bereich plus konkretes Ding** in der Anzeige — „Territorien: Fürstentum Kosch", nicht
   nur „Territorien".

## 3. Die tragende Entscheidung: die Sperre ist ABGELEITET, nicht gespeichert

**Es gibt keine Sperrtabelle, keinen Erwerb, keine Freigabe.** Wer die Territorien offen hat,
steht ohnehin in `editor_presence` — mit dem Bereich, den er gerade bearbeitet. Der Besitzer
des Schreibrechts wird bei jeder Anfrage **aus genau diesen Zeilen berechnet**: von allen,
die den Bereich `territories` gemeldet haben und deren Lebenszeichen frisch ist, gewinnt der,
der zuerst da war.

Das ist dasselbe Muster wie beim Konfliktzentrum (AGENTS.md §11: „Conflicts are computed,
never stored"), und es räumt drei Fehlerklassen von vornherein ab:

- **Keine verwaisten Sperren.** Es gibt nichts, was hängenbleiben könnte. Tab zu, Browser
  abgestürzt, Strom weg — nach Ablauf der Frist ist der Platz frei, ohne Aufräumer, ohne Cron.
- **Kein Wettlauf.** Es gibt kein „Erwerben", das zwei gleichzeitig gewinnen könnten. Die
  Entscheidung fällt bei jeder Anfrage neu aus denselben Daten, mit einem totalen
  Ordnungskriterium (`activity_since`, bei Gleichstand `user_id`) — also für alle Beteiligten
  identisch.
- **Kein Freigeben-Vergessen.** Der Bereichswechsel *ist* die Freigabe.

💣 **Der Preis, den man kennen muss:** die Sperre ist damit nur so gut wie das Lebenszeichen.
Deshalb ist die Bereichsfrist großzügiger als die Online-Frist (siehe §4) und deshalb muss der
Standalone-Editor mit-melden (§7).

## 4. Datenmodell

`editor_presence` bekommt drei Spalten (per `ALTER TABLE` nachgerüstet — die Tabelle existiert
live, `CREATE TABLE IF NOT EXISTS` allein rüstet nichts nach):

| Spalte | Typ | Bedeutung |
|---|---|---|
| `activity_area` | `VARCHAR(40) NULL` | Bereichsschlüssel, serverseitig gegen eine Whitelist geprüft |
| `activity_label` | `VARCHAR(190) NULL` | das konkrete Ding, z. B. „Fürstentum Kosch" |
| `activity_since` | `DATETIME(3) NULL` | wann dieser **Bereich** betreten wurde |

⚠️ **Jede Spalte einzeln prüfen und nachrüsten**, nicht „wenn eine fehlt, alle drei" — sonst
scheitert eine halb migrierte Tabelle stumm (vgl. Memory `ddl-retrofit-seed-guard-per-column`).

💣 **`activity_since` darf nur beim Bereichs-WECHSEL neu gesetzt werden.** Wenn jeder
Lebenszeichen-Schreibvorgang es mitzieht, ist der Besitzer immer der zuletzt Eingetroffene —
also genau das Gegenteil von „wer zuerst da war". Das Label darf sich frei ändern (man
wechselt ja das Territorium), der Zeitstempel nicht. Umgesetzt im `ON DUPLICATE KEY UPDATE`:

```sql
activity_since = IF(activity_area <=> VALUES(activity_area), activity_since, VALUES(activity_since))
```

(`<=>` statt `=`, damit `NULL` gegen `NULL` als gleich zählt.)

**Zwei Fristen, mit Absicht verschieden:**

- `AVESMAPS_EDITOR_PRESENCE_ONLINE_SECONDS = 90` — bleibt, wie es ist (die grüne Punkt-Anzeige).
- `AVESMAPS_EDITOR_ACTIVITY_CLAIM_SECONDS = 180` — neu, gilt nur für den Bereichsanspruch.

Der Anspruch überlebt also einen kurzen Aussetzer, den die Online-Anzeige schon als „weg"
zeigt. Das ist gewollt: der Besitzer hat womöglich ungespeicherte Arbeit im Editor, und auf
STRATO ist ein verpasster Request kein Beweis für Abwesenheit. Die Anzeige bleibt trotzdem
ehrlich — sie sagt dann „Valentin (zuletzt vor 2 Min gesehen) bearbeitet die Territorien".

**Bereichs-Whitelist** — genau die acht Editoren, die es gibt (Schlüssel serverseitig,
Beschriftungen im Frontend): `territories`, `paths`, `ecosystem`, `settlements`, `powerlines`,
`citymaps`, `adventures`, `wikisync`. Alles andere wird zu `NULL` — die Liste im Panel soll
nicht mit Freitext befüllbar sein. Panel-Reiter (Meldungen, Konflikte, Vorkommen) melden
nichts: sie sind Ansichten, kein geöffneter Editor.

## 5. Serverseite

### 5.1 Neue Bibliothek `api/_internal/map/editor-activity.php`

Eine Verantwortung: „wer beansprucht gerade welchen Bereich". Wird von **zwei** Endpunkten
gebraucht (Präsenz-Poll und Territorien-Schreibtor), gehört deshalb weder in den einen noch
in den anderen.

```php
avesmapsNormalizeEditorActivityArea(?string $area): ?string   // Whitelist, sonst null
avesmapsReadEditorAreaClaim(PDO $pdo, string $area): ?array   // ['user_id','username','seconds_since_activity','seconds_since_seen'] oder null
avesmapsAssertEditorAreaClaim(PDO $pdo, string $area, array $user): void  // wirft, wenn ein ANDERER hält
```

Die Besitzer-Abfrage:

```sql
SELECT user_id, username,
       TIMESTAMPDIFF(SECOND, activity_since, NOW(3)) AS seconds_since_activity,
       TIMESTAMPDIFF(SECOND, last_seen, NOW(3))      AS seconds_since_seen
FROM editor_presence
WHERE activity_area = :area
  AND last_seen >= DATE_SUB(NOW(3), INTERVAL 180 SECOND)
ORDER BY activity_since ASC, user_id ASC
LIMIT 1
```

`activity_since` selbst verlässt den Server nie — nur die Differenz (§5.3).

### 5.2 Das Schreibtor für Territorien

**Alle 30 schreibenden Territorien-Aktionen laufen durch eine einzige Stelle**:
`api/_internal/political/territories-endpoint.php:178`, direkt nach
`avesmapsRequireUserWithCapability('edit')`. Genau dort — und nur dort — steht künftig
`avesmapsAssertEditorAreaClaim($pdo, 'territories', $user)`.

⭐ Das ist der Grund, warum dieser Entwurf klein bleibt: eine Zeile deckt `create_territory`,
`update_geometry`, `save_hierarchy`, `assign_capital`, `undo_audit_change` und 25 weitere ab,
und keine künftige Aktion kann die Prüfung vergessen, weil sie vor dem `match` steht.

**Eine Ausnahme:** `geometry_operation_debug` rechnet nur (kein `$pdo`, kein `$user`) und
bleibt frei — sonst kann der Zweite nicht einmal nachrechnen, was er ohnehin nur ansieht.

Fehlerantwort bei fremdem Anspruch: **HTTP 409**, `error.code = 'territory_locked'`,
Message deutsch und fertig zum Anzeigen („Valentin bearbeitet gerade die Territorien. Deine
Änderung wurde nicht gespeichert.").

💣 **Die serverseitige Prüfung ist die Sperre. Der ausgegraute Knopf ist nur Höflichkeit.**
Ohne §5.2 wäre das ganze Feature Dekoration, die ein zweiter Tab, ein alter Client oder ein
`curl` umgeht.

### 5.3 `api/edit/map/presence.php`

- Nimmt im POST-Rumpf `area` und `label` entgegen (heute wird dort ein `path` geschickt, das
  der Server **wegwirft** — der ersetzt sich damit).
- Schreibt sie mit dem Lebenszeichen (§4).
- Liefert in der Antwort zusätzlich:
  - je Nutzer in `users[]`: `activity_area`, `activity_label`, `seconds_since_activity`
  - neu auf oberster Ebene: `territory_claim` — `null` oder
    `{user_id, username, seconds_since_activity, seconds_since_seen, is_mine}`

💣 **Zeitangaben immer als Sekunden-Abstand, nie als Zeitstempel.** `activity_since` ist
MySQL-Serverzeit; ein Client, der daraus „seit 14:20" rechnet, liegt um die Zeitzonen-
differenz daneben. Der Server liefert die Differenz, der Client formatiert lokal.

⚠️ Der lazy-Ensure-Pfad in `presence.php` (Tabelle nur bei echtem Fehlen anlegen, eingeführt
2026-07-25 gegen die Poll-Last) bleibt **unangetastet**. Das Nachrüsten der drei Spalten läuft
im selben `catch`-Zweig mit, nicht auf dem heißen Pfad.

## 6. Clientseite

### 6.1 Die Meldefunktion

Eine gemeinsame Funktion im Hauptdokument (`js/review/review-panels.js`, wo der Heartbeat
schon lebt):

```js
avesmapsSetEditorActivity(area, label)   // merkt sich beides und schickt SOFORT ein Lebenszeichen
```

„Sofort" ist wichtig: wer die Territorien öffnet, soll nicht bis zu 30 Sekunden warten, um zu
erfahren, ob er schreiben darf.

### 6.2 Wer ruft sie auf

- **Territorien (eingebettet):** `openPoliticalTerritoryEditor()` /
  `closePoliticalTerritoryEditor()` in `js/territory/territory-editor-link.js:167` — der eine
  Ort, an dem dieser Editor auf- und zugeht. Er läuft im **selben Dokument** wie der Heartbeat
  (der Inline-Host zieht per `DOMParser` nur `.app-container` herein), also direkter Aufruf,
  keine Frame-Brücke. ⚠️ Nicht von der Memory-Notiz `edit-shell-iframe-globals-trap` verwirren
  lassen: die betrifft die `/edit/`-Hülle, nicht diesen Editor.
- **Die sechs iframe-Editoren** (Wege, Landschaften, Siedlungen, Kraftlinien, Karten,
  Abenteuer): die Overlay-Hülle wird im Hauptdokument gebaut
  (`review-*-list.js`, Muster `avm-editor-overlay`), also meldet **die Hülle** den Bereich beim
  Öffnen und `null` beim Schließen. Für sie sind **keine iframe-Änderungen nötig**.
- **Das konkrete Ding** kennt nur der iframe-Inhalt. Er schickt es per `postMessage` an den
  Host: `{ type: 'avesmaps:editor-activity', label }`. Der Host akzeptiert die Nachricht nur
  bei `event.origin === window.location.origin` und nur, wenn er selbst gerade einen Bereich
  offen hat — er übernimmt also nie einen Bereich aus einer fremden Nachricht.
- **Kein zweiter Poll.** Die Editoren melden *Zustandsänderungen*; verschickt wird alles über
  das eine bestehende 30-Sekunden-Lebenszeichen. Auf STRATO ist ein zusätzlicher
  Dauer-Request je offenem Editor genau das, was 2026-07-25 abgestellt wurde.

### 6.3 Die Anzeige im Reiter „Status"

`renderPresenceUserGroup` hängt hinter die bestehende Meta-Zeile (`Rolle · online · vor 2 Min`)
die Tätigkeit an: `Admin · online · Territorien: Fürstentum Kosch`. Ohne gemeldeten Bereich
bleibt die Zeile exakt wie heute.

### 6.4 Das Hinweis-Band im Territorien-Editor

Ein Band ganz oben in `.app-container` von `html/political-territory-editor.html`:

> 🔒 **Valentin bearbeitet gerade die Territorien** (seit 14:20). Du kannst alles ansehen,
> aber nicht speichern.

⭐ **Eine Stelle, zwei Oberflächen:** der Inline-Host übernimmt genau `.app-container`, also
erscheint dasselbe Band im eingebetteten Editor *und* im Standalone.

„Seit 14:20" steht bewusst dabei. Ohne die Zeit ist „besetzt" eine Sackgasse; mit ihr sieht
man, ob jemand arbeitet oder nur einen Tab offen gelassen hat, und kann ihn anschreiben.
Berechnet aus `seconds_since_activity` gegen die lokale Uhr (§5.3).

Wirkung auf die Bedienung, solange ein anderer hält:
- `#saveButton` bekommt `disabled` und einen Titel mit demselben Grund.
- Alles Lesende bleibt: Baum, Suche, Filter, Geometrie-Ansicht, Wappen, Wiki-Links.
- Sobald der Andere geht, macht das nächste Lebenszeichen (≤ 30 s) den Knopf wieder scharf,
  mit einer kurzen Meldung „Die Territorien sind jetzt frei."
- Tokens statt Literale (AGENTS.md §12): das Band nutzt die vorhandenen Statustöne, keine
  neuen Hex-Werte.

⚠️ **Änderung an Editor-Assets ⇒ `ASSET_VERSION` in
`js/territory/territory-editor-inline-host.js` bumpen** (AGENTS.md §7), sonst serviert der
Browser das alte Editor-Markup. Ebenso `?v=` in `edit/index.php`, falls `edit.css` mit dran muss.

## 7. Der Standalone-Editor muss mitmachen

`html/political-territory-editor.html` schickt heute gar kein Lebenszeichen. Ohne Änderung
hätte er `activity_area = NULL`, wäre nie Besitzer — und §5.2 würde ihm **jedes Speichern
verweigern**. Er bekommt deshalb denselben schlanken Heartbeat.

Damit ein Fehler dort trotzdem nicht die Arbeit blockiert, ist die Serverregel bewusst
asymmetrisch formuliert: **es wird nur abgelehnt, wenn ein ANDERER einen frischen Anspruch
hält.** Hält niemand einen, darf jeder schreiben. Wer nichts meldet, verliert also nur den
Schutz — nie die Fähigkeit zu arbeiten.

## 8. Bewusst weggelassen

- **Kein „Übernehmen"-Knopf für Admins.** Solange der Anspruch nach drei Minuten von selbst
  verfällt und man sieht, wer drinsitzt, wäre das ein Knopf, der fremde Arbeit wegwirft.
  Später leicht nachrüstbar.
- **Keine Sperre für die anderen sieben Editoren** (Owner-Entscheid 2).
- **Keine Benachrichtigung**, wenn frei wird — der nächste Poll erledigt das binnen 30 s.
- **Keine Historie**, wer wann welchen Bereich hielt. `map_audit_log` schreibt bereits mit,
  wer was geändert hat.

## 9. Was geprüft wird

**Unit (PHP, SQLite):**
- Besitzerwahl: ältester gewinnt; bei gleichem `activity_since` entscheidet `user_id`;
  abgelaufene Zeilen (`last_seen` älter als die Frist) zählen nicht mit; leere Menge → `null`.
- `avesmapsAssertEditorAreaClaim`: eigener Anspruch → durch; fremder → wirft; **kein**
  Anspruch → durch (§7).
- `activity_since` bleibt bei gleichem Bereich stehen und springt beim Wechsel — der Punkt aus
  §4, an dem sich das Feature sonst still selbst aufhebt.
- Whitelist: unbekannter Bereich → `null`.

**Unit (JS, Node):** die reine Entscheidungsfunktion für den Editor-Zustand
(`darf schreiben / nur lesen`) aus der echten Quelldatei extrahiert, nicht nachgebaut.

**Live nach Deploy (Einzelrequests, nie in Schleife — AGENTS.md §9):** Territorien in zwei
Browser-Profilen öffnen; im zweiten muss Band + gesperrter Knopf erscheinen, ein erzwungener
Schreibversuch muss 409 liefern; nach Schließen des ersten muss der zweite binnen 30 s frei
werden.

## 10. Ehrliche Kalibrierung

- Die Sperre ist **kooperativ innerhalb einer Frist**, keine Transaktion. Zwei Requests, die
  in derselben Millisekunde ankommen, während der Anspruch gerade verfällt, können theoretisch
  beide durchgehen. Bei drei Editoren und einem 30-Sekunden-Takt ist das kein reales Risiko;
  eine echte Serialisierung (`SELECT … FOR UPDATE` über den Territorienbaum) wäre auf STRATO
  teurer als das Problem.
- Die Anzeige „woran sitzt jemand" hinkt bis zu 30 Sekunden hinterher. Für die Frage „soll ich
  jetzt anfangen?" reicht das; als Echtzeit-Kollaboration ist es nicht gemeint.
- Der Fall „Editor lässt den Tab offen und geht zu Tisch" blockiert weiter. Das ist gewollt
  (er könnte ungespeicherte Arbeit haben) und wird über die „seit"-Angabe erträglich gemacht,
  nicht über einen Automatismus.
