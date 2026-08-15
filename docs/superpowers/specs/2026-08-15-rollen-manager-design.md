# Vier Rollen — Entwurf

**Stand:** 2026-08-15 · **Owner-Entscheide:** 2026-08-15 (§2) · **Status:** Entwurf, wartet auf GO
**Vorgeschichte:** Session „Reviewer-Rollen Zugriff und Berechtigungen", 01.08.2026 — analysiert,
freigegeben bis zum letzten Satz, nie begonnen.

---

## 1. Worum es geht

Aus drei Rollen werden vier:

| Rolle | Soll dürfen |
|---|---|
| **admin** | alles |
| **manager** | alles, was ein Editor kann — **plus** Mails lesen/beantworten und im Namen des Projekts veröffentlichen |
| **editor** | die Karte pflegen |
| **reviewer** | alles **ansehen** und Meldungen entgegennehmen |

Das sind zwei Aufträge in einem, und sie gehören zusammen:

1. **Der alte (01.08.2026):** Der Reviewer hat keine Tür. Die Rolle existiert überall im System —
   gültige Rolle, eigene Fähigkeit, Präsenzliste, Handbuch-Versprechen — nur hineinkommen kann sie
   nirgends. Sie wurde gebaut, dokumentiert und nie angeschlossen.
2. **Der neue (15.08.2026):** Es sind zu viele Editoren geworden. Der Zugang zum echten `info@`-
   Postfach und das Veröffentlichen nach draußen sollen nicht mehr an „ist Editor" hängen.

Der zweite löst nebenbei den schwersten Einwand gegen den ersten — siehe §6.

---

## 2. Was der Owner entschieden hat (15.08.2026)

| Frage | Entscheid |
|---|---|
| Was kann ein Manager? | Alles, was ein Editor kann, **plus** Mails lesen/beantworten |
| Wer darf Social-Media-Beiträge absetzen? | **Nur ein Manager** (und Admin). Wörtlich: *„nur ein manager kann auch social media posts absetzen"* |
| Wer wird Manager? | **nottel, moritz, drachenschuppe** |
| Wann wird gebaut? | Erst wenn **alle anderen Sessions stumm** sind |

Aus dem alten Auftrag unverändert gültig:

| Frage | Entscheid |
|---|---|
| Was darf ein Reviewer? | Alles **ansehen**, Meldungen entgegennehmen — sonst nichts |

---

## 3. Wie das Rechtesystem heute funktioniert

Erfreulich klein und an einer Stelle: [api/_internal/auth.php](../../../api/_internal/auth.php).

* Eine Rollenliste `AVESMAPS_AUTH_ROLES` = `admin, editor, reviewer`.
* Eine **reine Funktion** `avesmapsUserCan($user, $capability)` — ein `match` mit vier Fähigkeiten:
  `admin`, `edit`, `review`, `social`. `default => false`, also fällt Unbekanntes zu.
* Jeder Endpunkt fragt über `avesmapsRequireUserWithCapability(...)` genau dort.
* Die Rollenauswahl im Admin-Bereich baut sich **aus derselben Liste** ([admin/index.php:166](../../../admin/index.php:166)) —
  eine neue Rolle erscheint dort von allein.
* `users.role` ist `VARCHAR(20)`. „manager" passt. ⛔ **Keine Migration, kein DDL.**

Zwei Türen, und nur zwei: `/edit/` verlangt `edit`, `/admin/` verlangt `admin`.

### 3.1 💣 Der Reviewer hat keine Tür

[edit/index.php:23](../../../edit/index.php:23) verlangt `edit`, und ein Reviewer hat kein `edit`.
Die Admin-Oberfläche legt bereitwillig ein Konto an, das nachweislich nirgends hineinkommt, und sagt
das nicht. Die Zeile steht seit `b3913f4f` (06.05.2026, „Add protected edit login shell") unverändert
da — die einzigen zwei weiteren Commits, die sie berühren, sind Repository-Wiederherstellungen, keine
Änderungen. Es gibt keinen Hinweis, dass die Rolle je funktioniert hat.

Dazu lügt die Fehlermeldung: [edit/index.php:29](../../../edit/index.php:29) wirft für **beide** Fälle
denselben Satz aus — falsches Passwort und unzureichende Rolle sind von außen nicht unterscheidbar,
und die gültige Sitzung wird sofort weggeworfen. Das hat den Owner am 01.08. zwei Passwortwechsel
gekostet, die nie das Problem waren.

### 3.2 💣 `review` ist kein Leserecht, sondern ein Sammelbegriff

Das ist der Befund, der den Umbau teuer macht. Die Fähigkeit `review` sitzt vor **12 Endpunkten** —
und dahinter steht nicht nur Lesen. Die WikiSync-Endpunkte verriegeln die **ganze Datei** mit
`review` und verteilen dahinter:

| Endpunkt | Aktionen hinter `review`, die schreiben |
|---|---|
| [wiki/settlements.php](../../../api/edit/wiki/settlements.php) | `assign_to`, `clear_assign`, `bulk_connect`, `crawl_buildings`, `crawl_building_type`, `enrich_details`, `bulk_record_ruins`, `bulk_record_coats`, **`localize_coats` (schreibt Dateien auf den Server)** |
| [wiki/paths.php](../../../api/edit/wiki/paths.php) | `start_run`, `crawl_step`, `clear`, `assign`, `clear_assign`, `assign_all` |
| [wiki/regions.php](../../../api/edit/wiki/regions.php) | `start_run`, `crawl_step`, `clear`, `assign`, `assign_labels`, `assign_all` |
| [wiki/settlement-coat-upload.php](../../../api/edit/wiki/settlement-coat-upload.php) | Wappen-Upload |
| [wiki/settlement-images.php](../../../api/edit/wiki/settlement-images.php) | Bildzuordnung + -löschung |

Gemessen am 01.08. mit der Sonde: **11 Endpunkte** würde ein Reviewer heute passieren, 19 weisen ihn
mit 403 ab. Der Riegel an der Tür ist derzeit das Einzige, was ihn von den 11 abhält.

⭐ **Die Hausform für die Reparatur existiert schon.** [reports/locations.php](../../../api/edit/reports/locations.php)
ist ebenfalls nur `review`-verriegelt und prüft für seine zwei schreibenden Aktionen **innen** noch
einmal `edit` — mit ausführlich begründetem Kommentar an beiden Stellen (Z. 318 ff., Z. 424 ff.).
Genau dieses Muster wird auf die Tabelle oben angewendet. **Kein Umbenennen von `review`**, keine
neue Leserechts-Fähigkeit, keine Änderung an 12 Aufrufern.

---

## 4. Das Zielmodell

Fünf Fähigkeiten, eine davon neu, eine verengt:

| Fähigkeit | heute | künftig | Bedeutung |
|---|---|---|---|
| `admin` | admin | admin | Konten, Backup, SVG-Abzug, Diagnose |
| `edit` | admin, editor | admin, **manager**, editor | die Karte pflegen |
| `review` | admin, editor, reviewer | admin, **manager**, editor, reviewer | ansehen + Meldungen/Bewertungen entgegennehmen |
| `social` | admin, editor | admin, **manager** ⬅ **verengt** | im Namen des Projekts veröffentlichen |
| `mail` | — | admin, **manager** ⬅ **neu** | das `info@`-Postfach lesen und beantworten |

Und die Rollen dagegen gelesen:

| | admin | manager | editor | reviewer |
|---|:--:|:--:|:--:|:--:|
| Karte bearbeiten | ✅ | ✅ | ✅ | — |
| Ansehen, Meldungen annehmen | ✅ | ✅ | ✅ | ✅ |
| Mails | ✅ | ✅ | — | — |
| Social Media | ✅ | ✅ | — | — |
| Konten, Backup | ✅ | — | — | — |

⭐ **Dass `social` seinen eigenen Namen hat, zahlt sich jetzt aus.** Die Verengung kostet **eine
Zeile** in `avesmapsUserCan` und **keinen einzigen Aufrufer** — alle sechs Social-Endpunkte fragen
längst `avesmapsUserCan(…, 'social')`. Das ist wörtlich der Grund, aus dem die Fähigkeit am
10.08.2026 nicht als Alias von `edit` gebaut wurde. Der neue `mail`-Riegel wird nach demselben
Muster gebaut, damit die nächste Verschiebung genauso billig ist.

### 4.1 Was sich wo ändert

| # | Stelle | Änderung |
|---|---|---|
| 1 | `api/_internal/auth.php` | `manager` in die Rollenliste; `edit`/`review` um `manager`; `social` verengen; `mail` neu |
| 2 | die 5 Endpunkte aus §3.2 | schreibende Aktionen innen mit `edit` nachriegeln (Muster: `reports/locations.php`) |
| 3 | `api/edit/mail/mailbox.php:14` | `edit` → `mail` |
| 4 | `edit/index.php` | Tür für `review`; ehrliche Fehlermeldung; Read-only-Oberfläche ohne `edit` |
| 5 | `api/edit/map/presence.php:273` | `role IN ('admin','editor','reviewer')` → `manager` mit aufnehmen |
| 6 | `api/edit/wiki/selftest.php:84` | `in_array($role, ['admin','editor'])` → `manager` mit aufnehmen |
| 7 | `js/app/session.js` | `mail` in **drei** handgeschriebene Fähigkeitslisten; Mail-Reiter verriegeln |
| 8 | `AGENTS.md` §11 + Kommentar in `auth.php` | die „admin UND editor"-Begründung von 11.08. umschreiben |

Nicht angefasst: `html/editor-handbuch.html` (§9 — gehört der nächtlichen Routine; nur ein
Commit-Betreff, der die sichtbare Wirkung nennt).

---

## 5. Reihenfolge — die eigentliche Absicherung

Jeder Schritt ist **für sich** sicher und für sich zurücknehmbar.

**1. Die Rolle entsteht.** `manager` in Liste und `match`. Wirkung auf den Bestand: **null** —
niemand hat die Rolle. Der Admin-Bereich bietet sie ab jetzt an.

> 🔧 **DU, nach Schritt 1:** nottel, moritz und drachenschuppe im Admin-Bereich auf „manager"
> stellen. **Drei Auswahlfelder, sonst nichts.**

**2. Schreiben hinter `review` zusperren** (§3.2). Wirkung: **null** — der Reviewer kommt noch nicht
herein, und Editor/Admin/Manager tragen `edit`.

**3. Mails und Social verengen.**

> 💣 **Dieser Schritt darf NICHT vor Schritt 1+2 laufen.** Verengt man `social` auf
> `admin|manager`, während es noch keinen einzigen Manager gibt, stehen die drei in der Lücke und
> der Hub ist für alle außer dem Owner zu. Die Reihenfolge ist der ganze Punkt: **erst die Rolle,
> dann die Zuweisung, dann die Verengung.**

**4. Die Tür.** Reviewer darf nach `/edit/`, ehrliche Fehlermeldung, Read-only-Oberfläche. **Erst
hier wird nach außen überhaupt etwas sichtbar.** Macht dieser Schritt Ärger, stellt sein Rücknehmen
exakt den heutigen Zustand her — und der ist bekanntermaßen sicher, nur unbrauchbar.

---

## 6. Die Fallen

1. 💣 **`grep editor` ist unbrauchbar.** Über zwanzig Treffer, und fast alle sind *Herkunftsangaben
   in Daten* — `source='editor'`, `origin='editor'`, `actor_type='editor'` in Politik-Geometrie,
   Analytics, Social-Store, Wege-Verlauf. Wer die Liste abarbeitet, ändert Datenwerte statt Rechte.
   **Echte Rollenprüfungen außerhalb von `auth.php` sind genau zwei:** `presence.php:273` und
   `selftest.php:84`.
2. 💣 **Beide umgehen `avesmapsUserCan`.** Ein Manager wäre in der Onlineliste für alle anderen
   Editoren **unsichtbar** und käme nicht an den Selbsttest-Läufer. Das ist die Sorte Fehler, die
   erst auffällt, wenn jemand fragt „warum sieht mich keiner".
3. 💣 **Die Fähigkeitsliste steht im Browser dreimal von Hand** ([session.js](../../../js/app/session.js):29, :43, :57).
   Eine neue Fähigkeit, die dort nicht mitwandert, fällt stumm auf „darf nicht" — der Riegel fällt
   absichtlich geschlossen aus, also gibt es keine Fehlermeldung, nur eine Funktion, die fehlt.
4. 💣 **Die Social-Öffnung vom 11.08. ist an zwei Stellen ausführlich begründet** — in `AGENTS.md`
   §11 und als Kommentarblock in `auth.php:91-99`. Beide behaupten nach diesem Umbau das Gegenteil.
   Totes Recht im Haus ist teuer (§8 der `AGENTS.md` sagt, warum): ein Prüfer, der der alten Zeile
   folgt, meldet die neue, richtige Fassung als Abweichung.
5. 💣 **`avesmapsOptionalUser()` gibt nur bei `edit` einen Benutzer zurück** ([auth.php:148](../../../api/_internal/auth.php:148)).
   Manager ist damit versorgt, **ein Reviewer erschiene in der Besucherstatistik als anonymer
   Gast**. Bewusst entscheiden, nicht übersehen.
6. 💣 **`session-payload-test.php` vergleicht die Fähigkeiten als exaktes Array — an fünf Stellen**
   (Z. 40, 53, 57, 63, 70: anonym, admin, editor, reviewer, unbekannte Rolle). Ein neuer Schlüssel
   `mail` bricht **alle fünf** — **das ist gewollt** und der billigste Stolperdraht, den wir haben.
   Nicht „reparieren", sondern um `mail` und um die Zeile für den Manager erweitern.
7. 💣 **Kein Benutzername geht ins Repo.** Die drei Zuweisungen sind drei Auswahlfelder im
   Admin-Bereich nach dem Deploy. Wer „nottel" in eine PHP-Datei schreibt, baut eine Rechteliste,
   die niemand mehr im Admin-Bereich ändern kann.
8. ⚠️ **Parallelbetrieb:** die Session „E-Mail-Archivierung einrichten" arbeitet gerade an genau der
   Datei, deren Riegel Schritt 3 umstellt (`mailbox.php`). Deshalb der Halt.
9. 🔴 **Das Handbuch verspricht die Rollen** („reviewer — darf Meldungen und Bewertungen prüfen",
   `editor-handbuch.html:338`). Es gehört der nächtlichen Routine `avesmaps-handbuch-pflege`
   (`AGENTS.md` §9). **Nicht anfassen** — nur der Commit-Betreff nennt die sichtbare Wirkung, damit
   die Routine es findet.

### 6.1 ⭐ Was der neue Auftrag am alten repariert

Der alte Auftrag führte unter **R10** einen Datenschutz-Vorbehalt: „alles einsehen" gäbe Reviewern
das Kontakt-Postfach mit Klarnamen und Mailadressen Dritter. Er wurde damals als bewusst in Kauf
genommene Owner-Entscheidung markiert.

**Dieser Vorbehalt entfällt.** Sobald `mail` eine eigene Fähigkeit ist, die nur Admin und Manager
tragen, sieht ein Reviewer das Postfach nicht — und ein Editor auch nicht mehr. Die Reduktion, die
der Owner aus einem anderen Grund verlangt hat, macht die Tür für den Reviewer erst sauber
aufmachbar.

---

## 7. Wie geprüft wird

**Vor dem Push, ohne Datenbank, ohne Anmeldung:** die Sonde aus dem alten Auftrag. Sie ist mit ihrer
Session verschwunden, ihr Rezept steht in den Notizen und wird neu gebaut:

```
AVESMAPS_DB_DRIVER=mysql AVESMAPS_DB_HOST=127.0.0.1 AVESMAPS_DB_PORT=1 …
php -d session.save_path=<tmp> probe.php
```

Eine vorgeschriebene Sitzungsdatei simuliert jede Rolle; ihre ID reist als
`$_COOKIE[session_name()]`.

* ⭐ **Der tote Port `:1` ist der Trick, nicht ein Schönheitsfehler:** käme der Code je an der
  Datenbank an, stirbt er sofort sichtbar — die Sonde kann ein „Gate greift" nicht vortäuschen.
* 💣 **400 ist NIEMALS ein Beweis für „durchgelassen".** Genau daran hat sich die Sonde am 01.08.
  einmal selbst belogen (`source-merge.php` liest den Rumpf **vor** der Prüfung). Auflösung
  spaltenweise: gibt dieselbe Datei anonym 401, liegt das Gate vor dem Rumpf. Statisch geprüft war
  das **1 von 38** Endpunkten.
* `php://input` ist in der CLI **leer** — nur `php://stdin` trägt die Daten.

**Dazu:** eine Tabellenprüfung über **alle** Rolle × Fähigkeit-Kombinationen (4 × 5 = 20). Die
Funktion ist rein, das kostet nichts und schließt R2 aus dem alten Auftrag — einen Fehler, der
Editoren aussperrt — vollständig aus.

**Und das ganze Testfeld vor dem Push**, nicht die eigenen Tests (`AGENTS.md` §9, samt der 21
`tools/wikidump/test-*.php`, die das übliche Muster nicht findet).

### 7.1 Was lokal nicht beweisbar bleibt

Es gibt keine lokale Datenbank. Alles **hinter** dem Gate — ob ein Reviewer eine Meldung tatsächlich
annehmen kann, ob die Listen laden, ob ein Manager im Hub veröffentlicht — ist erst live prüfbar,
nach Schritt 4. Das Frontend-Verhalten gehört in den Browser, nicht in die Sonde.

⚠️ **Read-only im Frontend ist unbegrenzt** (~50 Module). Ein Anspruch auf Vollständigkeit wäre
gelogen. Der **Server bleibt die einzige Autorität**; das Frontend bekommt ein Hinweisband und die
Sperre der primären Schreibknöpfe, und was nicht abgedeckt ist, wird benannt statt behauptet.

---

## 8. Offen

* 🔧 **Der Live-Durchstich am Ende:** eine echte Meldung mit einem echten Reviewer-Konto annehmen —
  oder nur mit ungültigen IDs prüfen? Empfehlung: der echte Durchstich an **einer** selbst erzeugten
  Testmeldung, weil §7.1 sonst ungeprüft bleibt.
* Nebenbefund vom 01.08., außerhalb dieses Auftrags und als eigene Aufgabe abgelegt: die Anmeldung
  hat **keine Versuchsbremse**, und die Antwortzeit verrät zuverlässig, ob ein Konto existiert
  (0,075 s gegen 0,315 s — Faktor 4).
