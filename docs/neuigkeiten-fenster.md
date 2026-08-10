# Das Fenster „Neuigkeiten"

**Live seit 2026-08-03** · Mockup der Abstimmung: `docs/changelog-mockup.html`

Die Meilensteine des Projekts, erzählt für Leser, die weder Commits noch Code kennen.

> Dieses Dokument stand bis zum 2026-08-10 vollständig in **AGENTS.md §11** — in einem
> Abschnitt namens „Documentation index", der damit auf 35 KB gewachsen war und in jede
> Sitzung geladen wurde. Der Index nennt jetzt nur noch die Fallen beim Namen und zeigt
> hierher. Inhaltlich ist nichts weggefallen.

---

## 1. Die Beschriftung heißt anders als der Code

🔴 **Bis zum 09.08.2026 hieß das Fenster „Änderungsverlauf".** Umbenannt wurde
ausschließlich die **Beschriftung**: Fenstertitel, Kachelknopf, aria-Label, Fehlersatz
und die deutschen Gegenstücke in `i18n-en.js`.

**Alles andere heißt weiter `changelog`:** Dateiname, CSS-Klassen, ids, die
**i18n-Schlüssel selbst** (`changelog.*`), der Endpunkt und die Tabelle
`changelog_entry`.

Dieselbe Trennung wie beim Literatur-Umbau und aus demselben Grund: **der Deploy löscht
nie** (AGENTS.md §10). Eine umgetaufte Adresse liesse eine noch gecachte `index.html`
ins Leere greifen.

💣 **Und deshalb ist `verlauf:` kein Commit-Scope für dieses Fenster.** Am 2026-08-08
trugen zwei Commits (`284cd3a2`, `b3042199`) den Scope `fix(verlauf):` für den
Changelog — dasselbe Wort, unter dem der **Wiki-Kurs-Sync der Wege** läuft
(`api/_internal/wiki/path-verlauf.php`, `verlauf_cases`, `apply_verlauf_case`,
`wiki_path_verlauf_case_status`, Memory `verlauf-sync-implementation`). Seit der
Umbenennung heißt der Scope `neuigkeiten:` bzw. `changelog:`. Wer „Verlauf" zurückholt,
macht `git log --grep` und `git grep` für beide Features unbrauchbar.

## 2. Wo man hinkommt

Zwei Öffner:

- **Hinweise → Kachel „Was ist neu?"**, direkt unter der Discord-Kachel, als deren
  Zwilling.
- **Seit 09.08.2026 der Eckknopf „Neuigkeiten"** links neben „Hinweise", unten rechts
  an der Karte.

Der Fokus kehrt zu dem Öffner zurück, der das Fenster aufgemacht hat.

### 💣 Die Ecke ist EIN Bund

`#map-corner-actions`: das Positionieren gehört dem **Behälter**, nicht mehr
`#legal-button`. Sonst wanderte nur einer der beiden Knöpfe mit, wenn die Infobox
aufgeht.

Wird es eng (offene Infobox auf schmalem Schirm), **stapelt** der Bund: „Neuigkeiten"
nach oben, „Hinweise" bleibt unten am Rand. Wie hoch der Bund baut, sagt **eine** Zahl:
`--avesmaps-corner-stack`. Der Leaflet-Zoom darüber rechnet seinen Abstand daraus,
statt wie früher eine abgeschriebene `bottom: 52px` zu tragen.

⚠️ **Die Zahl hängt an `:root`, nicht an `.avesmaps-infopanel-mode` allein.** Die Klasse
sitzt an `<html>` **und** `<body>`, und die body-Kopie überschrieb die Ausnahme für den
schmalen Fall — der Zoom saß dann auf der oberen Knopfreihe. So gemessen, dann behoben.
Siehe Memory `infopanel-mode-klasse-an-html-und-body`.

Bewacht von `js/app/__tests__/map-corner-actions.test.js`.

## 3. Die Teile

| Was | Wo |
|---|---|
| Fenster | `#changelog-overlay` — `js/app/changelog-dialog.js`, `css/components/changelog-dialog.css` |
| Lesepfad | `GET /api/app/changelog.php` |
| Schreibpfad | `POST /api/edit/map/changelog.php` (`list`/`save`/`delete`, capability `edit`) |
| Logik + Startbestand | `api/_internal/app/changelog.php` |

## 4. 💣 Zwei Quellen, eine Rangfolge

Die Tabelle `changelog_entry` ist die Wahrheit, **sobald sie steht**. Solange sie fehlt
**oder leer ist**, antwortet der Lesepfad aus der Konstante `avesmapsChangelogSeed()`
(42 Meilensteine).

Das ist Absicht, aus zwei Gründen: der Verlauf steht sofort nach dem Deploy, und der
Lesepfad braucht **kein DDL** — das liefe sonst bei jedem Besucher, der die Hinweise
öffnet, und machte die Datei ohne lebende Datenbank untestbar.

Angelegt und geseedet wird **ausschließlich im Schreibpfad**, und
`avesmapsChangelogSeedIfEmpty()` füllt **nur eine leere Tabelle** — ein von Hand
nachgeschärfter Eintrag wird nie von der Konstante überfahren.

## 5. 💣 Die Einträge sind Fliesstext, also mit echten Umlauten

Die ae/oe/ue-Umschreibung des Hausstils gilt für **Kommentare**, nicht für das, was im
Fenster steht. `changelog-test.php` bewacht genau das — die Saat war beim Bau schon
einmal umgeschrieben worden.

Übersetzt wird nur der **Rahmen** (`changelog.*` in `i18n-en.js`); die Einträge selbst
bleiben deutsch. Projektgeschichte ist Inhalt, keine Oberfläche.

## 6. 💣 `overflow-anchor: none` am Scroll-Kasten ist tragend

Ohne es steht der frisch geöffnete Verlauf beim **ältesten** Eintrag: das
Scroll-Anchoring zieht den Kasten mit, wenn „Lade …" durch 42 Einträge ersetzt wird.

## 7. Gepflegt wird er von einer Routine

Die Routine **„Avesmaps feature updates"** (alle 2 Tage, 10:00) hängt an: `list` liefert
ihr `latest_source_ref` — den Commit, bis zu dem der Verlauf reicht —, `save` ergänzt.

### 💣 Die Routine hat keine Session, sie hat nur ihr App-Token

Bis 2026-08-08 verlangte der Schreibpfad **ausschließlich eine Session**. Damit konnte
ihn **niemand** rufen: es gibt ausser der Routine keinen Aufrufer — keine Oberfläche
verlinkt ihn, `git grep "edit/map/changelog"` über `js/` und `edit/` ist leer. So stand
der Verlauf fünf Tage nach seinem Start noch unangetastet auf der Saat:
`source: "seed"`, 42 Einträge, jüngster 03.08.

**Das fiel nicht auf, weil ein Verlauf aus der Konstante genau wie ein gepflegter
aussieht.**

Seither nimmt der Endpunkt **zwei Ausweise**: Session mit capability `edit` **oder** ein
Token im Header `X-Avesmaps-Token`.

### 🔴 Das Token hat einen EIGENEN Schlüssel

`$config['changelog']['app_token']` in `api/config.local.php` — **nicht den von
Discord.**

Die erste Fassung lieh sich `discord.app_token`, weil das keine neue Konfigurationszeile
kostete; der Owner hat das noch am selben Tag umgedreht, und zu Recht: damit hätte ein
Token, das bis dahin nur in einen Chat-Kanal schreiben durfte, **öffentlich sichtbaren
Text in die Webanwendung** geschrieben. Zwei Befugnisse an einem Schlüssel lassen sich
weder einzeln tauschen noch einzeln sperren, und ein Leck auf der einen Seite öffnet die
andere mit.

Deshalb hat der Verlauf auch seine **eigene** Prüfung
(`avesmapsChangelogTokenMatches()`, `hash_equals` + beidseitiger Leer-Riegel) statt
`avesmapsDiscordCheckAppToken()`. Drei Zeilen doppelt sind der Preis dafür, dass die
beiden Türen nichts voneinander wissen.

⚠️ **Fehlt der Schlüssel, fällt der Weg ZU, nicht auf** — dann bleibt nur die Session.

⚠️ **Das Token darf weniger als ein Mensch:** nur `list` und `save`
(`AVESMAPS_CHANGELOG_TOKEN_ACTIONS` + `avesmapsChangelogTokenMayRun()`), **niemals
`delete`**. Ein abhandengekommenes Token soll ergänzen können, nicht ausräumen, und die
Routine hat zum Löschen keinen Grund.

Gelesen wird es **nur aus dem Header**, nie aus `?token=` wie in `report-post.php`: eine
Adresszeile steht im Server-Log.

Bewacht von `api/_internal/app/__tests__/changelog-token-gate-test.php` (sechs Mutationen
rot, darunter der totgelegte Riegel `if (false && …)` und der Rückfall auf den
Discord-Schlüssel).

### 💣 Falle beim Schreiben solcher Quelltext-Zusicherungen

In dieser Datei haben nacheinander **drei** davon zuerst auf den erklärenden
**Kommentar** angeschlagen statt auf den Code (`AVESMAPS_CHANGELOG_TOKEN_ACTIONS`,
`discord`, `hash_equals`) — beim Quelltext-Test ist die Prosa Teil des Suchraums.

**Nie auf einen Bezeichner prüfen, immer auf den Aufruf samt Argumenten.**

---

Verwandt: `docs/changelog-mockup.html`, Memory `infopanel-mode-klasse-an-html-und-body`,
`discord-changelog-format`, `verlauf-sync-implementation` (das *andere* „Verlauf").
