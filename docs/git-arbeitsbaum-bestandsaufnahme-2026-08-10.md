# Bestandsaufnahme des Git-Arbeitsbaums

**Stand:** 2026-08-10 · **Status:** Bericht. **Nichts gelöscht, nichts umgebaut.**
Alles hier ist gemessen, nicht geschätzt.

Anlass: eine Selbstdiagnose auf Bitte des Owners. Die Frage war, was im Arbeitsbaum
Arbeit ist und was Rückstand.

> ⚠️ **Dieser Bericht trug zuerst das Datum 2026-08-08 — das war falsch** (aus den
> Zeitstempeln der Routinen abgeleitet statt abgelesen). Datum, Dateiname und die
> Rettungs-Tags sind auf den 10.08. korrigiert.

> 💣 **Und die Zahlen darin haben sich während der Aufnahme selbst geändert.** Um 09:0x
> standen 52 registrierte Worktrees und 2,08 GB, um 09:3x noch 16 und 0,72 GB — eine
> Nachbarsitzung hat in der Zwischenzeit aufgeräumt. Wer aus einer solchen Aufnahme
> später Entscheidungen ableitet, misst zuerst neu. Die Kommandos dafür stehen unten.

---

## 0. Kurzfassung (Messung 2026-08-10, ~09:35)

| Befund | Zahl |
|---|---|
| Worktrees registriert | 20 (16 unter `.claude/worktrees/`, + Hauptbaum + 3 im Temp) |
| Belegter Platz `.claude/worktrees/` | **0,72 GB** in 16.452 Dateien |
| Verwaiste Verzeichnisse | **7 — alle leer (0 Dateien)** |
| Lokale Branches | 118, davon **100 in `origin/master` enthalten** |
| Commits, die **nirgends** in master stehen | **15** (16 Einträge, einer doppelt), auf 8 Branches — als Tag gesichert |

Der Projektzustand selbst ist gesund: keine getrackte Datei ungesichert geändert,
**122 PHP- und 93 JS-Tests grün**.

---

## 1. Gesicherte Commits

Vor jeder späteren Aufräumung sind die acht Branch-Spitzen getaggt, die noch nicht in
`origin/master` enthaltene Commits tragen. Solange diese Tags stehen, kann kein
`git branch -D` und keine Garbage Collection die Arbeit einziehen.

```
rettung/2026-08-10/gallant-mahavira-709025
rettung/2026-08-10/youthful-goodall-666497
rettung/2026-08-10/nice-shamir-e6fdb3
rettung/2026-08-10/worktree-landschaften-v5
rettung/2026-08-10/zealous-zhukovsky-86f583
rettung/2026-08-10/worktree-bridge-cse_01JYY642N1hvNDqJ5ogFBdT4
rettung/2026-08-10/worktree-agent-a1aaa9a54a7a0aa03
rettung/2026-08-10/keen-kapitsa-a325e8
```

Die Tags sind **lokal**. Sie wandern nicht mit `git push` mit — das ist Absicht,
sie sind ein Sicherungsnetz, kein Veröffentlichungsstand.

> ⚠️ **Nur 8 von 118 Branches tragen überhaupt noch etwas.** Andere sehen im
> `git branch --no-merged` so aus, als hätten sie Arbeit, weil sie **gesquasht** in
> master gelandet sind: `worktree-hierher-reisen` meldet 9 Commits „voraus", von denen
> `git cherry` **null** als fehlend erkennt. Wer nach Commit-Zahl aufräumt statt nach
> `git cherry`, hält Leichen für Arbeit — und wer nach `--no-merged` löscht, verliert
> umgekehrt nichts, aber räumt auch nichts auf.

## 2. Die 15 ungesicherten Commits

| Datum | Commit | Branch |
|---|---|---|
| 2026-08-07 | `test(sync): a compute step is drivable at last -- the plan DDL is split by driver` | gallant-mahavira-709025 |
| 2026-08-03 | `fix(landschaften): eine Klimazone steht nicht mehr zwischen den Waeldern in "Fuehrt durch"` | youthful-goodall-666497 |
| 2026-08-03 | `fix(landschaften): ein Klimaband bietet keine Verben an, die es gleich ablehnen wuerde` | youthful-goodall **und** nice-shamir |
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
Meeres- und Seen-Ableitung samt Rollback-Ledger, seit dem 29.07. liegengeblieben. Das ist
die einzige Stelle in dieser Liste, die nach einer zusammenhängenden, unfertigen
Funktion aussieht und nicht nach einem Einzelfix. Im Worktree liegt zusätzlich
`tools/ecosystem/ledger-meer.json.bak`, uncommittet.

`fix(wappen): CC0 is a waiver` verdient einen eigenen Blick: die Memory
`coat-public-domain-policy` hält fest, dass öffentlich nur `public_domain` angezeigt
wird — dieser Commit erweitert die Regel um CC0 und ist seit dem 17.07. draußen.

## 3. Verwaiste Verzeichnisse

Sieben Verzeichnisse unter `.claude/worktrees/` sind git **nicht mehr bekannt**, stehen
aber noch auf der Platte:

```
changelog-token            daily-fixes-2026-07-17     fahrplan-fix
keen-kapitsa-a325e8        quirky-hypatia-02d9b8      quizzical-galileo-485ec5
vorkommen-flaeche
```

**Alle sieben sind leer — 0 Dateien, 0 Byte.** Es steht keine Arbeit darin.

💣 **Trotzdem sind sie nicht harmlos.** Weil git sie nicht mehr als Worktree führt, sucht
jeder Aufruf darin nach oben weiter und findet `C:/GIT/avesmaps/.git`. Ein
`git -C .claude/worktrees/fahrplan-fix status` meldet daher **den Hauptbaum** — beim
Messen kam für alle sieben derselbe Wert heraus, ohne jeden Hinweis darauf, dass die
Frage gar nicht beantwortet wurde. Dieselbe Fehlerklasse, die der `.gitignore`-Kommentar
schon einmal festhält (zwei Sitzungen zählten Treffer über 57 Kopien, ohne es zu merken).

Löschen ist gefahrlos (leere Ordner), aber es ist eine Entscheidung des Owners.

## 4. Branches

**118** lokal, davon **100** vollständig in `origin/master` enthalten. Von den übrigen 18
tragen nur die 8 aus Abschnitt 2 wirklich etwas.

## 5. Worktrees mit echter unfertiger Arbeit

| Worktree | Was |
|---|---|
| `bridge-cse_0173oLVUu4UCzBE3nMks4mga` | `shoplinks.py`, `abenteuer-liste*.txt`, `abenteuer-shop-import.sql`, `report.csv` — der Shoplink-Crawl |
| `landschaften-v5` | `tools/ecosystem/ledger-meer.json.bak` |
| `drachenflug-summe` | drei `verify-route-*.html` |

Alles andere sind `.claude/`-Ordner oder `verify-*`-Seiten.

## 6. ✅ `water-trial-test.php` lag mit gemischten Zeilenenden im Commit

`api/_internal/routing/__tests__/water-trial-test.php` meldete sich in **sechs**
Worktrees als geändert — 86 Einfügungen, 86 Löschungen, also die ganze Datei. Der Inhalt
war identisch; nach `tr -d '\r'` waren Blob und Arbeitskopie Byte für Byte gleich.

Ursache: die **committete** Fassung hatte *gemischte* Zeilenenden (CRLF **und** LF), die
Arbeitskopie reine CRLF. Mit `* text=auto` und `*.php text` checkt git auf Windows nativ
mit CRLF aus — und verglich das gegen einen Blob, der so nie normalisiert wurde.

Das kostete nicht Speicher, sondern Vertrauen in `git status` — und `git status` zuerst zu
lesen ist die Regel, an der in diesem Repo das selektive Stagen hängt (AGENTS.md §9).

**Behoben** per `git add --renormalize`; der Test läuft weiter grün.

## 7. Was daraus folgt

Nach Wirkung geordnet, alles offen:

1. **Die 7 leeren Waisen löschen.** Kein Datenverlust möglich, beendet eine Klasse
   stiller Fehlmessungen.
2. **`worktree-landschaften-v5` entscheiden.** Sechs Commits vom 28./29.07., die einzige
   zusammenhängende unfertige Funktion. Weiterbauen oder verwerfen — liegenlassen ist die
   einzige Option, die nichts entscheidet.
3. **`fix(wappen): CC0 is a waiver` entscheiden.** Berührt eine Anzeige-Policy.
4. **100 gemergte Branches löschen.** Kosmetik, aber die Branch-Liste ist unlesbar.
5. **Registrierte Worktrees abbauen**, je Worktree gegen Abschnitt 5 geprüft.

> Die Tags aus Abschnitt 1 sind die Voraussetzung für 4 und 5. Solange sie stehen, ist
> keine dieser Aufräumungen unumkehrbar.

## 8. Neu messen

```
git tag -l 'rettung/*'                                        # was gesichert ist
git branch --merged origin/master --list 'claude/*' 'worktree-*'   # gefahrlos löschbar
git worktree list                                             # was git kennt
ls .claude/worktrees/                                         # was auf der Platte steht
```

Die Differenz der letzten beiden Zeilen sind die Waisen aus Abschnitt 3.
Ob ein Branch wirklich etwas trägt, sagt **nur** `git cherry origin/master <branch>`.
