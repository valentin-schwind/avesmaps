# Übergabe — Befund A16 („Kein Weg zurück"), Stand 06.08.2026 abends

Diese Datei löst `handover-2026-08-06.md` ab. Die ist der Stand von **heute früh** und inzwischen
überholt; sie bleibt nur als Protokoll liegen.

**Auftrag des Owners:** „starte 5 in einer neuen Session" — Punkt 5 seiner acht Entscheidungen ist
**A16**.

---

## 1. Der Auftrag, in einem Absatz

Verschiebt man im Editor ein Label um drei Pixel, steht das im Änderungsprotokoll und lässt sich
zurücknehmen. Löscht jemand ein **Abenteuer** oder eine **Stadtkarte**, ist es hart weg — kein
Eintrag, kein Rückgängig. Betroffen sind **5.104 Vorkommen + 1.352 Abenteuer + 457 Karten**.

**Der Entwurf liegt fertig:**
[`docs/superpowers/specs/2026-08-06-a16-aenderungsprotokoll-design.md`](../superpowers/specs/2026-08-06-a16-aenderungsprotokoll-design.md)
(122 Zeilen, sechs Abschnitte, Stufenplan in §4).

**Die zwei Owner-Entscheidungen aus §6 sind beantwortet (06.08.2026):**

| Frage | Antwort |
|---|---|
| Zählen die Notausschalter (`set_*_enabled`) mit? | **Ja** |
| Stufe 1 = die drei Löschungen oder alle 26 Schreibvorgänge? | **Die drei Löschungen** |

Damit ist §6 erledigt und der Bau kann bei §4 Stufe 1 anfangen.

---

## 2. 💣 Die Falle aus §3 — nachgeprüft, sie stimmt

Der Entwurf warnt: die Listenabfrage der Oberfläche verbindet über
`LEFT JOIN map_features ON features.id = audit.feature_id`. Wer dort die Id einer **Karte** oder
eines **Abenteuers** hineinschreibt, trifft ein völlig unbeteiligtes Kartenobjekt — die Id-Räume
sind getrennt, die Zahlen überschneiden sich, und ein `LEFT JOIN` fällt nicht auf: er liefert
einfach eine Zeile mit fremdem Namen.

**Am 06.08.2026 gegengeprüft, alle drei Teile halten:**

| | |
|---|---|
| der `LEFT JOIN` | `api/edit/map/audit-log.php:68`, genau wie beschrieben |
| die Spalte ist nullable | `avesmapsWriteMapAuditLog(PDO $pdo, ?int $featureId, …)` |
| es gibt ein Vorbild im Haus | `api/edit/reports/locations.php` übergibt bereits `null` |

**Regel: `feature_id` bleibt `NULL`** — nicht `0`. Die Identität reist in `after_json`.

---

## 3. ⭐ Was heute gebaut wurde und für A16 unmittelbar nützt

**A39 hat denselben Weg schon gegangen** (Commit `a67b507f`) — das ist die beste Vorlage im Haus:

- `avesmapsLogReportModeration()` wohnt jetzt in `api/_internal/map/report-audit.php` und schreibt
  mit `feature_id = NULL` in **dasselbe** `map_audit_log`.
- Sie kennt einen **Urheber, der kein Mensch ist**: `?array $user`, `null` heisst „Maschine", und der
  Vermerk reist als `after_json.actor_source` mit.
- Der Lesepfad gibt ihn als eigenes Feld `actor_source` heraus (**nicht** in `username`), und
  `js/review/review-panels-change-log.js` macht daraus eine Beschriftung
  (`changeLogEntryActor`, Tabelle `CHANGE_LOG_ACTOR_LABELS`).

👉 **Wer A16 baut, sollte diese vier Stellen lesen, bevor er anfängt.** Karten/Abenteuer/Vorkommen
brauchen exakt dieselben Bausteine, nur mit anderen Aktionsnamen — und die Beschriftungstabelle im
Client ist schon da.

Ausserdem geprüft und gültig: `avesmapsCanUndoAuditAction()` antwortet für unbekannte Aktionen
automatisch „nein", und `avesmapsIsCreateAuditAction()` ist eine **Liste**, kein Präfix-Vergleich —
ein `create_citymap` würde also **nicht** versehentlich rückgängig-fähig.

---

## 4. Wo alles steht

**HEAD = `origin/master`**, Arbeitsbaum sauber, **221/221 Tests grün.**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
    -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll -d extension=php_curl.dll \
    -d extension=php_openssl.dll <test>
```

Die Extensions sind **Pflicht** — ohne sie fallen ~60 Tests aus Umgebungsgründen um.

⚠️ **Eine zweite Sitzung arbeitet im selben Checkout.** Am Abend des 06.08. kamen `d6e561ca` und
`51b82839` von dort (Schriftart der Impressum-Seite, „ohne JavaScript"-Hinweis). AGENTS.md §9 gilt
also scharf: **nie `git add -A`**, immer `git status` zuerst und nur eigene Pfade nach Pfad stagen.

### Die acht Entscheidungen des Owners — sieben erledigt

| | | |
|---|---|---|
| 1 | Bewertungen: Satz getrennt | ✅ `22491b0b` |
| 2 | Besucher-Salt gesetzt | ✅ (Owner) |
| 3 | Impressum: E-Mail, eigene Seite, Link ohne JS | ✅ `21515348` `22d1c1fa` |
| 4 | Kartenarchiv: Links raus **und** `.htaccess`-Riegel | ✅ `57f2dc92` + Owner |
| 6 | `Kreuzung-<id>`, bedingt | ✅ `0185e3d8` |
| 7 | Import-Tür hinterlässt eine Spur | ✅ `a67b507f` |
| 8 | Proxy-Diagnose → A29 entschieden und gebaut | ✅ `6b58d1d3` `6e7dc57b` |
| **5** | **A16 — Änderungsprotokoll** | **← DIESE SITZUNG** |

Ebenfalls heute zugegangen: **A39** (17 Altzeilen richtiggestellt + Audit), **A25**, **A23**,
**A22**, **A24**, **A29**.

---

## 5. Die Arbeitsregeln des Owners

- Ein Commit je Befund · **volle Testsuite vor jedem Commit** · nach dem Push 2–4 Min PHP-Verzögerung
  abwarten, dann **live mit Zahlen** gegenprüfen · Befund im Bericht mit ✅ + Commit + Zahl markieren.
- Nach jeder Auslieferung feindlich gegenprüfen und **die eigenen Funde zuerst** berichten.
- **NIE** einen Endpunkt in einer Schleife abfragen; **nie** Dump/Sync/Autoget/Massenlauf/Backup/
  Linkchecker auslösen (STRATO Shared Hosting).
- Owner-Entscheidungen (Rechtstexte, Löschwege, Veröffentlichung) **nicht selbst treffen** — sammeln
  und mit 🔧 DU: vorlegen.
- Kommentare, Doku, Commit-Nachrichten **englisch**; Antworten an den Owner **deutsch**.
- Bei etwas, das die öffentliche Schnittstelle ändert: **vorher melden und Zahlen zeigen** (so lief
  A13 b).

---

## 6. 🔴 Die Lehre des Tages — sie hat sich zehnmal wiederholt

**Nicht der Code hat gelogen, sondern die Prüfung.** Jedes Mal stand eine Eigenschaft im Kommentar,
die kein Test prüfte:

| Fall | die Mutation, die grün durchging |
|---|---|
| A30 | Vergleicher-Text festgenagelt, aber nicht **welcher Zweig** ihn benutzt (`===` → `!==` blieb grün) |
| A24 | `if (false) { event.preventDefault(); }` — Riegel steht da, wirkt nicht |
| A29-Diagnose | `avesmapsClientIpAddress()` durch eine Nachbildung ersetzt — **fünf Testfälle konnten sie nicht unterscheiden** |
| A29-Endpunkt | Methodenprüfung vor dem Riegel: anonymer POST verriet **405** statt 401 |

**Zwei Werkzeugfallen, die mich mehrfach erwischt haben:**

- 💣 **Eine Mutation, die nicht greift, meldet grün.** Der Arbeitsbaum ist CRLF; mehrzeilige Anker in
  Python/bash treffen ihn oft nicht. **Jede Mutation muss belegen, dass sie auf der Platte gelandet
  ist** — Trefferzahl prüfen, dann erst testen.
- 💣 **Eine Mutation, die das Falsche tut, meldet ebenfalls grün.** Beim Riegel-Tausch hat mein
  Skript den Riegel *direkt vor* die Methodenprüfung gesetzt — also die **richtige** Reihenfolge
  nachgebaut und behauptet, es sei die falsche. Nach dem Schreiben **hinsehen**, nicht nur zählen.

**Die Frage vor jeder Zusicherung:** *Welche einzelne Zeile müsste ich löschen, damit das Feature
verschwindet — und wird dieser Test dann rot?*

⭐ Und die Gegenrichtung, heute bei A39 gelernt: **ein Prüffilter, der enger ist als die
Wirklichkeit, meldet keinen Zweifel, sondern eine falsche Gewissheit.** Meine Beleg-Abfrage suchte
nur nach *Orten*; „Finsterkopp" liegt als *Label* auf der Karte und wäre fast als abgelehnt
etikettiert worden.

---

## 7. 🔧 Was weiterhin beim Owner liegt

- **A10** — (a) Riegel beim Lesen oder (b) Zurücksetzen der toten Zeiger.
- **A17/A18** — Editor-iframes: ausblenden und beim Wiederöffnen neu laden, oder abräumen.
- **A22, zweiter Teil** — es gibt **keinen Weg, eine Bewertung zu melden**. Braucht ein Ziel und eine
  Regel für die Zwischenzeit.
- **A14** — soll `GET /api/locations/` `limit`/`offset` bekommen? Vertragsentscheidung.
- **A13 (a)** — `public_id` statt `Kreuzung-<id>`; (b) ist gebaut, (a) bleibt offen und ist nicht
  dringend.
- **A24** — die kurze Adresse `avesmaps.de/impressum` (eine Zeile in der Wurzel-`.htaccess`, siehe
  [`owner-serverregeln.md`](owner-serverregeln.md) Nr. 2). Nicht gebaut: ein Fehler dort ist eine 500
  für die ganze Seite.
- **A27, A28, A30 (Schreibkanal), A32, A34, A35, A37, A38** — je im Bericht ausformuliert.

Die vollständige Fassung jedes Befundes steht in [`1-akut.md`](1-akut.md); jeder erledigte trägt dort
Commit und Zahlen.
