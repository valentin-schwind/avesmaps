# Bestandsaufnahme des Git-Arbeitsbaums

**Stand:** 2026-08-08 · **Status:** Bericht. **Nichts gelöscht, nichts umgebaut.**
Alles hier ist gemessen, nicht geschätzt.

Anlass: eine Selbstdiagnose auf Bitte des Owners. Der Arbeitsbaum trägt 52 Auschecks,
118 Branches und 56 dauerhaft untracked Dateien — die Frage war, was davon Arbeit ist
und was Rückstand.

---

## 0. Kurzfassung

| Befund | Zahl |
|---|---|
| Worktrees registriert | 52 (+ Hauptbaum + 3 im Temp-Verzeichnis) |
| Belegter Platz `.claude/worktrees/` | **2,08 GB** in 48.376 Dateien |
| Verwaiste Verzeichnisse | **7 — alle leer (0 Dateien)** |
| Lokale Branches | 118, davon **100 in `origin/master` enthalten** |
| Commits, die **nirgends** in master stehen | **15**, auf 8 Branches — als Tag gesichert |
| Dauerhaft untracked in der Wurzel | 51 `verify-*` (5,4 MB) + 5 Auftragsdokumente |

Der Projektzustand selbst ist gesund: `master` = `origin/master` (`b3042199`), keine
getrackte Datei geändert, 122 PHP- und 93 JS-Tests grün.

---

## 1. Gesicherte Commits

Vor jeder späteren Aufräumung sind die acht Branch-Spitzen getaggt, die noch nicht in
master enthaltene Commits tragen. Solange diese Tags stehen, kann kein
`git branch -D` und keine Garbage Collection die Arbeit einziehen.

```
rettung/2026-08-08/gallant-mahavira-709025                    c4ec1790
rettung/2026-08-08/youthful-goodall-666497                    4a0d7813
rettung/2026-08-08/nice-shamir-e6fdb3                         320224c3
rettung/2026-08-08/worktree-landschaften-v5                   bd4f0f6b
rettung/2026-08-08/zealous-zhukovsky-86f583                   6eea70ca
rettung/2026-08-08/worktree-bridge-cse_01JYY642N1hvNDqJ5ogFBdT4  b989ef3a
rettung/2026-08-08/worktree-agent-a1aaa9a54a7a0aa03           3bf9730e
rettung/2026-08-08/keen-kapitsa-a325e8                        577f68fd
```

Die Tags sind **lokal**. Sie wandern nicht mit `git push` mit — das ist Absicht,
sie sind ein Sicherungsnetz, kein Veröffentlichungsstand.

> ⚠️ **Nur 15 von 118 Branches tragen überhaupt noch etwas.** Die anderen sehen im
> `git branch --no-merged` teils so aus, als hätten sie Arbeit, weil sie
> gesquasht in master gelandet sind: `worktree-hierher-reisen` meldet 9 Commits
> „voraus", von denen `git cherry` **null** als fehlend erkennt. Wer nach
> Commit-Zahl aufräumt statt nach `git cherry`, hält Leichen für Arbeit.

## 2. Die 15 ungesicherten Commits

| Datum | Commit | Branch |
|---|---|---|
| 2026-08-07 | `test(sync): a compute step is drivable at last -- the plan DDL is split by driver` | gallant-mahavira-709025 |
| 2026-08-03 | `fix(landschaften): eine Klimazone steht nicht mehr zwischen den Waeldern in "Fuehrt durch"` | youthful-goodall-666497 |
| 2026-08-03 | `fix(landschaften): ein Klimaband bietet keine Verben an, die es gleich ablehnen wuerde` | youthful-goodall / nice-shamir |
| 2026-08-03 | `docs(landschaften): der Entwurf fuer die Klimazone in der Infobox` | youthful-goodall-666497 |
| 2026-07-29 | `feat(ecosystem): step 3 -- the ocean as one area plus 35 named Voronoi cells` | worktree-landschaften-v5 |
| 2026-07-29 | `feat(ecosystem): step 2 -- islands and the mainland` | worktree-landschaften-v5 |
| 2026-07-28 | `feat(ecosystem): the lake rule -- step 1 of the stepwise derivation` | worktree-landschaften-v5 |
| 2026-07-28 | `feat(ecosystem): the lake manifest, and a fifth condition the first run demanded` | worktree-landschaften-v5 |
| 2026-07-28 | `feat(ecosystem): the import writes a run ledger, so it can be taken back` | worktree-landschaften-v5 |
| 2026-07-28 | `feat(ecosystem): a run ledger and a rollback, so an import can be taken back` | worktree-landschaften-v5 |
| 2026-07-17 | `fix(wappen): CC0 is a waiver, so it counts as public domain` | zealous-zhukovsky-86f583 |
| 2026-07-14 | `ui(adventure-editor): match sync-button design to Siedlungseditor's btn2` | bridge-cse_01JYY6… |
| 2026-07-13 | `ui(adventures): cover thumbnail in Abenteuereditor list` | bridge-cse_01JYY6… |
| 2026-07-12 | `fix(planner): stop route-waypoint popups from autoPanning (2nd waypoint never rendered)` | agent-a1aaa9a54a7a0aa03 |
| 2026-07-07 | `fix(map): wiki deep-links match labels client-side via wikiRegion.wiki_url` | keen-kapitsa-a325e8 |

**Der Schwerpunkt ist `worktree-landschaften-v5`** — sechs Commits einer schrittweisen
Meeres-/Seen-Ableitung samt Rollback-Ledger, seit dem 29.07. liegengeblieben. Das ist
die einzige Stelle in dieser Liste, die nach einer zusammenhängenden, unfertigen
Funktion aussieht und nicht nach einem Einzelfix.

`fix(wappen): CC0 is a waiver` verdient einen eigenen Blick: die Memory
`coat-public-domain-policy` hält fest, dass öffentlich nur `public_domain` angezeigt
wird — dieser Commit erweitert die Regel um CC0 und ist seit dem 17.07. nicht in master.

## 3. Verwaiste Verzeichnisse

Sieben Verzeichnisse unter `.claude/worktrees/` sind git **nicht mehr bekannt**, stehen
aber noch auf der Platte:

```
changelog-token            daily-fixes-2026-07-17     fahrplan-fix
keen-kapitsa-a325e8        quirky-hypatia-02d9b8      quizzical-galileo-485ec5
vorkommen-flaeche
```

**Alle sieben sind leer — 0 Dateien, 0 Byte.** Es steht also keine Arbeit darin.

💣 **Trotzdem sind sie nicht harmlos.** Weil git sie nicht mehr als Worktree führt,
sucht jeder Aufruf darin nach oben weiter und findet `C:/GIT/avesmaps/.git`. Ein
`git -C .claude/worktrees/fahrplan-fix status` meldet daher **den Hauptbaum** — beim
Messen kam für alle sieben derselbe Wert (56 untracked Dateien) heraus, ohne jeden
Hinweis darauf, dass die Frage gar nicht beantwortet wurde. Das ist dieselbe
Fehlerklasse, die der `.gitignore`-Kommentar schon einmal festhält (zwei Sitzungen
zählten Treffer über 57 Kopien, ohne es zu merken).

Löschen ist gefahrlos (leere Ordner), aber es ist eine Entscheidung des Owners.

## 4. Branches

- **118** lokal, davon **100** vollständig in `origin/master` enthalten.
- Die verbleibenden 18 sind die 8 aus Abschnitt 2 plus 10, deren Commits gesquasht
  in master liegen.

Liste der gefahrlos löschbaren jederzeit neu erzeugbar mit:

```
git branch --merged origin/master --list 'claude/*' 'worktree-*'
```

## 5. Worktrees mit echter unfertiger Arbeit

Nur diese registrierten Auschecks tragen Änderungen, die nicht bloß Zeilenenden
oder Scratch-Dateien sind:

| Worktree | Was |
|---|---|
| `bridge-cse_0173oLVUu4UCzBE3nMks4mga` | `shoplinks.py`, `abenteuer-liste*.txt`, `abenteuer-shop-import.sql`, `report.csv` — der Shoplink-Crawl |
| `landschaften-v5` | `tools/ecosystem/ledger-meer.json.bak` |
| `drachenflug-summe` | drei `verify-route-*.html` |

Alles andere sind `.claude/`-Ordner, `verify-*`-Seiten oder der Zeilenendenbefund aus
Abschnitt 6.

## 6. 💣 `water-trial-test.php` liegt mit gemischten Zeilenenden im Commit

`api/_internal/routing/__tests__/water-trial-test.php` meldet sich in **sechs**
Worktrees als geändert — mit 86 Einfügungen und 86 Löschungen, also der ganzen Datei.
Der Inhalt ist identisch; nach `tr -d '\r'` sind Blob und Arbeitskopie Byte für Byte
gleich.

Die Ursache steht im Blob selbst: die **committete** Fassung hat *gemischte*
Zeilenenden (CRLF **und** LF), die Arbeitskopie hat reine CRLF. Mit `* text=auto` und
`*.php text` in `.gitattributes` checkt git auf Windows nativ mit CRLF aus — und
vergleicht das gegen einen Blob, der so nie normalisiert wurde.

**Wirkung:** die Datei ist in jedem Ausscheck dauerhaft „geändert", ohne dass jemand
sie angefasst hat. Das kostet nicht Speicher, sondern Vertrauen in `git status` — und
`git status` zuerst zu lesen ist die Regel, an der in diesem Repo das selektive Stagen
hängt (AGENTS.md §9).

**Behebung** (eine Zeile, im Hauptbaum):

```
git add --renormalize api/_internal/routing/__tests__/water-trial-test.php
```

Danach ist der Phantom-Diff in allen sechs Worktrees weg. Noch nicht ausgeführt.

## 7. Was daraus folgt

Nach Wirkung geordnet, alles offen:

1. **Die 7 leeren Waisen löschen.** Kein Datenverlust möglich, beendet eine
   Klasse stiller Fehlmessungen.
2. **`water-trial-test.php` renormalisieren.** Eine Zeile, macht `git status` in sechs
   Auschecks wieder ehrlich.
3. **`worktree-landschaften-v5` entscheiden.** Sechs Commits vom 28./29.07., die
   einzige zusammenhängende unfertige Funktion in der Liste. Weiterbauen oder verwerfen —
   liegenlassen ist die einzige Option, die nichts entscheidet.
4. **`fix(wappen): CC0 is a waiver` entscheiden.** Berührt eine Anzeige-Policy.
5. **100 gemergte Branches löschen.** Reine Kosmetik, aber die Branch-Liste ist
   derzeit unlesbar.
6. **Registrierte Worktrees abbauen.** Gibt den Großteil von 2,08 GB frei; vorher je
   Worktree gegen Abschnitt 5 prüfen.

> Die Tags aus Abschnitt 1 sind die Voraussetzung für 5 und 6. Solange sie stehen,
> ist keine der Aufräumungen unumkehrbar.
