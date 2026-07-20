# Live-Besucherzahl im Status-Panel — Design

**Datum:** 2026-07-20
**Status:** freigegeben (Owner: „das passt")

## Ziel

Im Editor-Panel unter **Status → Besucher**, direkt über den Zeitraum-Pillen
(7 T / 30 T / 12 M / Alles), eine Zeile mit der **aktuellen** Anwesenheit:

```
● Gerade jetzt          4 Besucher · 1 Editor
   2 aktiv · 1 liest · 1 im Hintergrund
```

Die bestehende Statistik darunter bleibt unverändert — sie beantwortet
„was war", die neue Zeile beantwortet „wer ist jetzt da".

## Ausgangslage

| | vorhanden? |
|---|---|
| **Editoren jetzt online** | ✅ `editor_presence` (Herzschlag alle 30 s, 90-s-Fenster), wird schon gepollt |
| **Besucher jetzt online** | ❌ existiert nicht |

`api/app/track.php` schreibt reine Tages-Aggregate. Ein stiller Leser sendet
**genau einen** Request (den `pageview` beim Laden) und ist danach unsichtbar.
Aus den vorhandenen Daten lässt sich „gerade jetzt" nicht ableiten — es fehlt
ein Zeitstempel pro Besucher.

## Lösung

### Lebenszeichen (neu, Schreibpfad)

Tabelle `visitor_live` — eine Zeile je anwesendem Besucher, räumt sich selbst ab:

```sql
visitor_hash CHAR(64) PRIMARY KEY   -- derselbe anonyme Tages-Hash wie visitor_daily_seen
actor_type   ENUM('visitor','editor')
state        ENUM('active','reading','hidden')
last_seen    DATETIME
```

Endpoint `api/app/heartbeat.php` (öffentlich, sehr klein): Hash bilden,
UPSERT, fertig. **Keine** Zähler, **kein** Geo-Lookup — das bleibt bei
`track.php`. Ein Ping darf die bestehenden Metriken nicht anfassen, sonst
würden Gerät/Sprache/Referrer/Land 60× pro Stunde und Besucher hochgezählt.

Client (`js/app/visitor-tracking.js`, erweitert): Ping alle 60 s, mit Bremsen:

- **nur bei sichtbarem Tab** — versteckte Tabs pingen nicht
- **Stopp nach 15 min ohne Interaktion** — ein über Nacht offener Tab pingt
  nicht bis zum Morgen weiter (begrenzt den Worst Case der Serverlast)
- `pagehide` → `state:'gone'` per `sendBeacon` → Zeile sofort gelöscht
- `visibilitychange → hidden` → ein letzter Ping mit `state:'hidden'`

### Anzeige (Lesepfad, null zusätzliche Requests)

Der Editor pollt im Edit-Mode ohnehin alle 30 s `api/edit/map/presence.php`
für die Editorenliste. Die Besucherzahlen reisen **in dieser Antwort mit**:

```json
"visitors": { "total": 4, "active": 2, "reading": 1, "hidden": 1, "window_seconds": 150 }
```

Editoren-Zahl = `users.filter(is_online)` aus derselben Antwort — schon da.

Fenster 150 s (> Ping-Intervall 60 s), damit ein verschluckter Ping niemanden
fälschlich verschwinden lässt.

## Zustände — was sie ehrlich bedeuten

| Anzeige | Bedeutung |
|---|---|
| **aktiv** | Interaktion in den letzten 2 min (Klick, Taste, Suche, Route) |
| **liest** | Tab sichtbar, aber gerade keine Aktion |
| **im Hintergrund** | Tab liegt hinter einem anderen Fenster |

„im Hintergrund" ist die schwächste Zahl: „Tab weggeklickt" und „Browser
geschlossen" trennt nur das Abschieds-Signal, das nicht jeder Browser
zuverlässig sendet. Sie ist die erste, die entfällt, wenn sie sich als
unzuverlässig erweist.

## Datenschutz

Identität ist der bestehende anonyme Tages-Hash (IP + UA + Tag + Salt); die IP
wird wie bisher **nicht** gespeichert. Die Zeile lebt maximal 15 Minuten, also
deutlich kürzer als das bereits existierende `visitor_daily_seen` (ein Tag).
Das Datenschutzniveau sinkt damit nicht — kein Consent-Bedarf, keine neue
Kategorie personenbezogener Daten.

Bots (UA-Heuristik, wie in `track.php`) werden gar nicht erst erfasst; sie
führen ohnehin kein JavaScript aus.

## Serverlast (STRATO)

Vorher ein Request pro Besuch, nachher einer pro Besucher und Minute. Bei der
aktuellen Größenordnung vernachlässigbar; die beiden Bremsen oben begrenzen
den Worst Case. Der Endpoint macht ein UPSERT auf eine Tabelle mit einer
Handvoll Zeilen. Aufräumen passiert beim Lesen (dort, wo ohnehin jemand
zuschaut) plus stichprobenartig beim Schreiben, damit die Tabelle auch dann
nicht wächst, wenn wochenlang niemand ins Panel sieht.

Der Kill-Switch `AVESMAPS_VISITOR_ANALYTICS_ENABLED` schaltet den Ping mit ab.

## Fehlerverhalten

- Ping schluckt jeden Fehler → immer `{"ok":true}` (wie `track.php`); Tracking
  darf die Seite nie stören.
- Der Live-Block in `presence.php` bekommt einen **eigenen** try/catch. Ein
  Fehler dort darf die Editorenliste nicht mitreißen (Lehre aus dem
  Geo-Reader: ein gemeinsamer catch riss beide Abfragen auf leer).
- Fehlt der Live-Block in der Antwort, bleibt die Zeile ausgeblendet statt
  „0 Besucher" zu behaupten.

## Erwartung

Meistens steht dort „1 Besucher · 1 Editor", oft auch „0 Besucher". Das ist
korrekt und keine Fehlfunktion.

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `api/_internal/analytics/visitor-analytics.php` | DDL + Schreib-/Lese-Helfer |
| `api/app/heartbeat.php` | **neu** — öffentlicher Ping |
| `api/edit/map/presence.php` | `visitors`-Block in der Antwort |
| `js/config.js` | Endpoint-Konstante |
| `js/app/visitor-tracking.js` | Ping-Schleife + Zustandslogik |
| `js/review/review-visitor-analytics.js` | Zeile rendern |
| `js/review/review-panels.js` | Render aus dem Presence-Poll anstoßen |
| `index.html` | Container über `#visitor-pills` |
| `css/components/visitor-analytics.css` | `.va-live` (nur Tokens) |
| `html/editor-handbuch.html` | Status-Abschnitt + `Stand:` |
