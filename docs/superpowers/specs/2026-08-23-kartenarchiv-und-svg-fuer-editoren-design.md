# SVG-Export für Editoren + das Kartenarchiv hinter dem Login

**Stand:** 23.08.2026 · Owner-Auftrag am selben Tag · Entwurf freigegeben („passt, bau das")

---

## 0 · Worum es geht

Zwei Dinge, die derselbe Personenkreis braucht und die auf derselben Seite landen:

1. **Der SVG-Export ist heute admin-only.** Er soll jedem Editor offenstehen.
2. **Die zwei Kartenarchive antworten mit 403.** Editoren sollen sie wieder herunterladen
   können — angemeldet, nicht öffentlich.

🔴 **Der zweite Punkt ist kein Rechte-Bugfix, sondern eine bewusste Ausnahme von einem
Owner-Entscheid.** Wer hier etwas ändert, muss §1 gelesen haben.

---

## 1 · Warum die Archive zu sind (und was das für diesen Entwurf heißt)

Befund **A25** des Systemtests vom 05.08.2026: im Hinweise-Fenster hingen zwei Downloads —
die Kacheln (161 MB) und die ganze Karte als PNG (1,73 GB) —, beide ohne jeden Riegel,
ausgerechnet in dem Absatz, der die Fanregel-Bindung erklärt. `NOTICE.md` sagt zu, das
Projekt nicht „als reines Bilder- oder Textarchiv" zu betreiben.

Owner-Entscheid 06.08.2026: Links raus (Commit `57f2dc92`), und danach eine von Hand
hochgeladene `uploads/map/.htaccess`, die `*.zip` per `Require all denied` sperrt. Vorlage
im Repository: [`docs/systemtest-2026-08-05/uploads-map.htaccess`](../../systemtest-2026-08-05/uploads-map.htaccess).
Gegengeprüft in beide Richtungen: Archive **403**, Wappen weiterhin **200**.

Gemessen am 23.08.2026: beide URLs antworten weiterhin **403**.

**Die Grenze, auf der dieser Entwurf steht:** nicht „wieder offen", sondern **an benannte,
angemeldete Personen ausgegeben**. Konkret heißt das drei Zusagen:

- 🔴 Die `uploads/map/.htaccess` wird **nicht angefasst**. PHP liest die Datei aus dem
  Dateisystem, nicht über HTTP — der Riegel für alle anderen bleibt scharf.
- 🔴 **Kein Link im öffentlichen Hinweise-Fenster.**
  [`js/app/__tests__/legal-texts.test.js`](../../../js/app/__tests__/legal-texts.test.js)
  bleibt grün, die Zusage in `NOTICE.md` unangetastet.
- 🔴 **Kein nackter Link.** Es gibt keine Adresse, die ohne Sitzung die Datei liefert — das
  war genau der Zustand, den A25 abgestellt hat („wer die Adresse kennt oder im Verlauf
  hat, lädt weiter"). Die verworfene Bauform dazu steht in §7.

---

## 2 · Der SVG-Export für Editoren

`edit/svg-export.php` prüft an zwei Stellen `'admin'` — im POST-Login-Zweig und beim
Aufbau von `$isAdmin`. Beide werden `'edit'`; die Variable heißt `$isEditor`, der
Login-Fehlertext sagt „Editor-Berechtigung", und der Kopfkommentar „ADMIN ONLY, matching
the backup page" wird korrigiert, statt als Unwahrheit stehenzubleiben.

**Belegt, nicht vermutet:** die Seite holt ihre Daten aus `api/app/map-features.php`,
`api/app/political-territories.php?action=layer` und `api/app/ecosystem-areas.php` — alle
drei ohne Anmeldung lesbar (gemessen 23.08.2026: keiner der drei ruft
`avesmapsRequireUserWithCapability`). Der Admin-Riegel schützte dort **keine Daten**; er
war Vorsicht, kein Schutz. Die Öffnung kostet deshalb nichts außer der Zeile selbst.

Im Drei-Strich-Menü ([`edit/index.php`](../../../edit/index.php)) wandert „Karte als SVG"
aus dem Block **Nur Admins** in die erste Gruppe zu „Handbuch". „Datenbank-Backup" und
„Admin" bleiben, wo sie sind — ⚠️ ein voller Dump trägt `users.password_hash`, das ist die
Begründung des Riegels und sie gilt unverändert.

---

## 3 · Der Archiv-Abschnitt auf der SVG-Seite

Eine weitere `.svgx-group` „Originalkarte herunterladen", **dieselbe Bauform** wie „Wie
groß?" und „Glätten?" (Trennlinie + Überschrift, keine Rahmenkästen — `design-language.md`).
Keine neue Formensprache, keine neuen Farbliterale.

💣 **Kein hartkodiertes `v2.05`.** Die Seite listet, was in `uploads/map/` *tatsächlich*
liegt. Die Begründung steht wörtlich in der `.htaccess` des Owners:

> „Gesperrt wird nach ENDUNG, nicht nach Dateiname: die Versionsnummer im Namen (v2.05)
> ändert sich mit jeder neuen Karte, die Endung nicht. Ein Riegel auf den heutigen Namen
> wäre beim nächsten Export lautlos wirkungslos."

Für das **Angebot** gilt derselbe Satz. Gelistet wird mit Name, Größe und Datum, sortiert
nach Namen. Leerer Ordner → ein ehrlicher Satz („In `uploads/map/` liegt derzeit kein
Archiv"), keine leere Liste — die wäre von „kaputt" nicht zu unterscheiden.

Dazu ein Satz, was der Editor damit darf: Arbeitsmaterial, nicht zur Weitergabe.

⚠️ **Serverseitig gerendert, kein `fetch`.** Die Liste entsteht beim Seitenaufbau; die
Downloads sind gewöhnliche `<a href>`. Damit gibt es kein JS, keinen Ladezustand und keinen
zweiten Weg, auf dem die Liste falsch sein könnte. (Der Entwurf sah zunächst eine
`action=list` am Endpunkt vor — sie wäre reines Beiwerk und entfällt.)

---

## 4 · Die Auslieferung

Neu, zwei Dateien:

| Datei | Rolle |
|---|---|
| `api/_internal/map/kartenarchiv.php` | reine Bibliothek: Auflisten, Namensprüfung, Range-Rechnung, Protokoll |
| `api/edit/map/kartenarchiv.php` | Endpunkt: Fähigkeit `edit`, streamt |

### 4.1 Die Namensprüfung

💣 **Der Dateiname kommt vom Client** — das ist eine Pfad-Ausbruchsstelle, keine Formalie.
Drei Riegel, alle drei nötig:

1. `basename()` — nimmt jedem `../` den Weg,
2. Endung muss `.zip` sein,
3. `realpath()` der fertigen Datei muss **innerhalb** des aufgelösten `uploads/map/`
   liegen. Der dritte fängt, was die ersten beiden nicht sehen (Symlinks).

Der Rückfall ist immer `null` → 404, nie eine Ausnahme mit Pfad im Text.

### 4.2 Range

`Accept-Ranges: bytes`; ein `Range: bytes=…` beantwortet **206** mit `Content-Range`, ein
kaputter Bereich **416** mit `Content-Range: bytes */<size>`. Ohne das fängt ein Abbruch
bei 1,73 GB wieder bei null an — bei dieser Dateigröße ist Fortsetzen keine Bequemlichkeit,
sondern die Voraussetzung dafür, dass der Download überhaupt jemals ankommt.

⚠️ Unterstützt wird **ein** Bereich (`bytes=a-b`, `bytes=a-`, `bytes=-n`). Mehrteilige
Bereiche (`bytes=0-99,200-299`) beantwortet der Endpunkt mit der **ganzen Datei** (200) —
das ist erlaubt und spart die `multipart/byteranges`-Maschinerie, die kein Downloader
braucht.

### 4.3 Der Stream

Wie [`api/edit/admin/database-backup.php`](../../../api/edit/admin/database-backup.php):
Puffer leeren, `zlib.output_compression` aus, `set_time_limit(0)`, dann in 256-KB-Häppchen
mit `flush()`. 💣 Transparente Kompression über ein ZIP macht die `Content-Length` zur Lüge
und den Download lautlos kaputt — dieselbe Falle wie beim `.gz` des Backups.

⚠️ **Der Preis, gesehen und angenommen:** ein PHP-Worker ist für die Dauer der Übertragung
belegt. Bei 1,73 GB sind das Minuten bis Stunden. AGENTS.md §10 warnt vor gesättigten
Workern; hier ist es ein Handgriff weniger Personen, kein Automatismus. Owner-Entscheid
23.08.2026.

---

## 5 · Das Protokoll

🪤 **Der erste Vorschlag war falsch und ist verworfen: `map_audit_log` ist kein Archiv.**
[`api/_internal/audit-prune.php`](../../../api/_internal/audit-prune.php) kappt es bei
**jedem** Schreibvorgang auf die jüngsten 200 Zeilen, und aus genau dieser Liste nimmt das
Rückgängigmachen seine Schritte. Gemessen am 18.08.2026: 696 neue Zeilen am Tag. Eine
Download-Zeile dort wäre binnen Stunden weg — und hätte vorher einem Editor einen
Undo-Schritt weggenommen, den die Oberfläche ihm noch anbietet. Das ist kein Protokoll,
das ist Schaden.

Stattdessen eine eigene, winzige Tabelle `map_archive_download` (selbstheilendes DDL wie
im Haus üblich): `id`, `actor_user_id`, `actor_name`, `file_name`, `file_size`,
`created_at`.

- 💣 **Gekappt, aber nicht mitgezählt.** `avesmapsPruneAuditLog` deckelt sie auf die jüngsten
  500 — über `AVESMAPS_AUDIT_PRUNE_CAPPABLE_TABLES`, eine **zweite, weitere** Liste, die für
  diesen Entwurf entstanden ist. Die engere `AVESMAPS_AUDIT_PRUNE_TABLES` trägt seit dem
  22.08.2026 die Regel „**200 je Person über ALLE Protokolle zusammen**" (Owner: „jeder person
  darf max. 200 eintraege haben"). Stünde die Downloadtabelle dort, verdrängte ein geholtes
  Kartenarchiv einem Editor einen seiner 200 Änderungsschritte — und der Trichter der
  Änderungen zählte Downloads mit, also wieder eine Zahl, die die Liste darunter nicht hält.
  Genau der Befund, wegen dessen die Regel entstanden ist. 🪤 Diese Trennung fiel erst beim
  Aufsetzen auf `origin/master` auf: der erste Bau lief gegen einen älteren Stand, in dem die
  Liste nur eine Regel trug.
- 💣 **Eigene Kappung von Beginn an**, jüngste 500. Eine unsichtbare Tabelle ohne Grenze
  ist genau das, was am 18.08.2026 die Datenbank in STRATOs 2-GB-Grenze gefahren und
  schreibgesperrt hat. Die Grenze steht **in der Schreibfunktion**, nicht bei den Aufrufern
  — dieselbe Lehre wie bei `avesmapsWriteMapAuditLog`.
- 💣 **Eine Zeile je DOWNLOAD, nicht je Anfrage.** Ein Downloader mit Fortsetzen stellt
  Dutzende Range-Anfragen; jede zu protokollieren macht aus dem Protokoll Rauschen und
  verdrängt die echten Zeilen aus der Kappung. Geschrieben wird nur, wenn die Anfrage
  **bei Byte 0 beginnt** (kein `Range`-Kopf, oder der Bereich fängt bei 0 an).
- ⚠️ `actor_name` wird **mitgeschrieben**, nicht per JOIN geholt: ein gelöschter Benutzer
  soll die Zeile nicht unlesbar machen.

Das Protokoll hat in dieser Fassung **keine Oberfläche** — es ist ein Beleg, kein Fenster.
Wer hineinsehen will, fragt die Tabelle.

---

## 6 · Tests

| Test | Was er hält |
|---|---|
| `api/_internal/map/__tests__/kartenarchiv-test.php` | Pfad-Ausbruch (`../`, absolut, Nicht-ZIP) → `null`; Range-Rechnung an Anfang/Mitte/Ende/Suffix/ungültig; „genau eine Protokollzeile je Download"; die Kappung greift |
| dieselbe Datei | `svg-export.php` verlangt `edit`, `backup.php` weiterhin `admin` — die zwei Riegel dürfen nicht zusammenrutschen |
| `js/pages/__tests__/hauptleisten-menue.test.js` | „Karte als SVG" steht **nicht mehr** im Admin-Block, „Datenbank-Backup" und „Admin" weiterhin schon |

💣 Die Range-Rechnung ist eine **reine Funktion** und wird auch so getestet — ohne HTTP,
ohne Datei. Ein Test, der dafür einen Server braucht, wird nicht geschrieben und die
Rechnung damit nie geprüft.

---

## 7 · Verworfen

**Weiterleitung auf einen unratbaren Pfad.** Apache läge dann direkt am Ausgang: kein
PHP-Worker, volles Range, nichts zu bauen. Verworfen, weil die Adresse danach ein nackter,
teilbarer Link ist, der sich nie wieder ändert — exakt der Zustand, den A25 abgestellt hat.
Owner-Entscheid 23.08.2026.

**Apache-Riegel gegen ein von PHP gesetztes Cookie.** Technisch möglich (`RewriteCond
%{HTTP_COOKIE}`), aber das Geheimnis stünde in einer `.htaccess`, die nicht aus dem
Repository kommt und bei jeder Rotation von Hand hochmuss. Die Datei, um die es geht, trägt
selbst den Warnsatz „sie kann verlorengehen, ohne dass es auffällt" — noch ein Geheimnis
dort hineinzulegen, macht diesen Satz teurer.

**Nur die Kacheln anbieten (161 MB).** Halbiert das Serverrisiko und lässt weg, worum es
geht.

---

## 8 · Was offen bleibt

- 🔧 **Der Ordner.** Auf dem Server antworten die Archive unter `uploads/map/`; im lokalen
  Baum des Owners liegen sie eine Ebene höher direkt in `uploads/`. Gebaut wird gegen
  `uploads/map/`. Weicht der Server davon ab, sagt es die Seite selbst — sie zeigt dann
  „kein Archiv gefunden" statt eines toten Links.
- 🔧 **Der echte Ablauf gegen die große Datei** ist nicht gemessen: 1,73 GB durch einen
  STRATO-Worker mit Fortsetzen hat hier niemand gefahren. Die Range-Rechnung ist geprüft,
  das Verhalten des Hosts unter Last nicht.
