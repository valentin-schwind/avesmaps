# Übergabe — der Hauptbaum steht wieder, und vier alte Fixes sind eingeholt

**Stand:** 26.08.2026, nachts. Alles Genannte ist live oder ausdrücklich geparkt.

## Ausgangslage

Der `master` im Hauptbaum (`C:/GIT/avesmaps`) war seit dem **18.08.** eine Parallellinie:
**97 voraus / 421 zurück**. Im Arbeitsbaum lagen neun geänderte Dateien aus einem abgebrochenen
Merge. Eine Sitzung lief parallel — in einem Worktree, nicht hier.

💣 **Die Zahl „97 voraus" war die eigentliche Falle.** `git cherry -v origin/master HEAD` trennt
sie per patch-id: **90 lagen inhaltlich längst in origin** (andere Sitzungen hatten sie aus ihren
Worktrees gepusht, nur der Zeiger hier wurde nie nachgezogen), **7 waren echt lokal**, und beim
Reset verschwunden wären davon **3**. Ohne diese Messung liest sich `97 voraus` wie „97 Commits
fremder Arbeit auf dem Spiel" — die Lähmung, die den Baum überhaupt zwei Wochen treiben ließ.

🪤 **Der Arbeitsbaum zeigte RÜCKWÄRTS.** Alle neun Dateien trugen dieselbe mtime, vier Sekunden
nach dem letzten Commit — das schreibt Git, kein Editor. Fünf waren byte-identisch mit
`origin/master`, drei waren **ältere** origin-Stände vom 18./21.08.; ein Commit darauf wäre ein
stiller Rückbau gewesen. Echte Arbeit steckte in **einer** Datei.

🪤 **Und „untracked" hieß meist nicht „ungesichert":** fünf Testdateien standen als `??` da und
lagen in `origin/master` byte-identisch — nur der Parallellinie unbekannt. Mit dem Reset lösten sie
sich von selbst auf. Von 16 `??`-Einträgen blieben 6 übrig.

## Was live gegangen ist

| Commit | Was |
|---|---|
| `f858be7d` | `tiles/original` + `tiles/stylized_upscale` ignoriert — 109.217 Kacheldateien standen als untracked im Baum. 💣 `tiles/stylized/` deckt `tiles/stylized_upscale/` **nicht** ab: kein Präfix-Match |
| `48d3782b` | **„Regel löschen" lief live nie durch** — `:id` zweimal im selben Literal, MySQL lehnt das mit `HY093` ab (`EMULATE_PREPARES => false`). Dazu der repoweite Wächter `sql-platzhalter-einmalig-test.php` |
| `fa904776` | **„Label löschen" sagt wieder, dass die Fläche mitgeht** (Fälle #80/#81) — drei Zustände statt zwei, und der Löschweg holt jetzt die Regionslisten, wie seine zwei harmlosen Nachbarn längst |
| `8228c607` | Der Wächter zu Fall #83 — die Mechanik, mit der ein zweites gleichnamiges Punkt-Label auf **keiner** Zoomstufe erscheint |

Alle vier Deploys grün.

## Der Stand der vier alten Zweige

- **`fix/bug80-label-loeschen`** → nachgezogen (`fa904776`). Nicht per cherry-pick: 360 Commits
  Abstand, Zieldateien weiterentwickelt; von Hand übertragen, Tests mitgenommen.
- **`claude/loving-elion-b6cd26`** (der Vorkommen-Fix) → nachgezogen (`48d3782b`), 422 Commits
  Abstand. Statt nur der gemeldeten Stelle lief der Wächter über den Bestand: **2118 SQL-Literale
  in 629 Dateien, genau zwei Treffer** — die gemeldete und eine Fixture, die dieselbe Form vorlebte.
- **`fix/bug84-wiki-zuweisen`** → **war längst drüben**, anders committet. Nichts zu tun.
  ⚠️ `git cherry` sagt nur, ob der *Patch* in origin liegt, nicht ob der *Bug* behoben ist.
- **`fix/bug83-berg-labels`** → der Bug ist **erledigt, auf Datenebene**: das Duplikat `aafcf138`
  steht nicht mehr in `map_features`, übrig ist ein „Drei Schwestern" (`cc223529`, Band 4..7).
  Der Test brach nur an einer fehlenden Ladezeile (`label-placement.js`, Abhängigkeit seit
  `46dd00b5` vom 22.08. — zwei Tage nach dem Test). Er bleibt als **Mechanik**-Wächter stehen.

Damit tragen die vier Zweige nichts Offenes mehr.

## Geparkt, nicht verloren

🔴 **`geparkt/generische-landschaftsnamen`** (lokal **und** auf origin) — Entwurf, Umsetzungsplan,
Mockup und der **fertige, rote** Wächter der gestoppten Sitzung „Generische Landschaften
ausblenden". Der Test existiert nirgends sonst; die fünf Worktrees mit den Landschaften-Docs haben
nur Entwurf und Plan.

💣 **Er darf so nicht auf `master`:** gegen origin gibt `isEcosystemRegionAutoName("Fläche-101",
"Wald")` `false` zurück, der Wächter erwartet `true` — nach §9 würde er **jeden** Deploy blockieren,
für alle Sitzungen. Was fehlt, steht im Test: `ecosystemAutoNamePattern` prüft nur `^<Art>-\d+$`,
und `Fläche` ist `ECOSYSTEM_AUTO_NAME_FALLBACK` — immer generisch, egal was die Art sagt.
Live gemessen 25.08.: 36 der 37 „Fläche-NNN"-Regionen haben inzwischen eine Art und behalten
darum ihr Kartenlabel.

    git show geparkt/generische-landschaftsnamen -- js/map-features/__tests__/ecosystem-naming.test.js

✅ **Die beiden Sicherungen des Resets sind am 26.08.2026 geloescht** — auf Owner-Entscheid, nachdem
belegt war, dass sie nichts Einzigartiges mehr halten: `sicherung/hauptbaum-master-2026-08-26`
(Zweig, war `afc1ba8e`) und `sicherung/arbeitsbaum-2026-08-26` (Tag, war `db6fc762`). Der Beleg,
Stück für Stück: von 97 Commits lagen 90 per patch-id in origin, 4 weitere per Betreff; die
restlichen 3 sind die Landschaften-Docs, deren vier Dateien **byte-identisch** im Parkzweig liegen.
Vom Arbeitsbaum-Tag waren 5 der 9 Dateien identisch mit der origin-Spitze, 1 lag im Parkzweig, und
die 3 übrigen sind **ältere Stände aus origins Historie** (`35ce3f14`, `2c7c7ebb`, `3b79a599`) —
Reste des abgebrochenen Merges, kein Fund. ⚠️ Beide Objekte bleiben über den reflog noch rund
90 Tage erreichbar (`git cat-file -t afc1ba8e`).

## Offen

- 🔧 Das Landschaften-Vorhaben wird fortgesetzt — der Fix zum roten Wächter fehlt noch.
- 🔧 Vier Karteileichen unter `AppData/Local/Temp` (`wt-pre-h3`, `wt-cmdialog`, `pb-phase4`,
  `maxg`): keine eigenen Commits, Inhalt gelöscht, Verzeichnis noch da. `git worktree prune`
  fasst sie **nicht** an — dafür bräuchte es `git worktree remove` je Eintrag.
- Sechs ungetrackte Dateien im Hauptbaum (`.claude/launch.json`, das Wappen-Mockup, drei
  `sql/db-speicher-*.sql`, ein `img/qrcode_*.png` vom 13. Juli). Keine stört das Testfeld.

## Zwei Fallen fürs nächste Mal

💣 **Ein geretteter Test wird IMMER erst gefahren, bevor er committet wird.** Der eine Fund mit
echter Arbeit war ein fertiger Wächter ohne Fix — rot, und auf `master` ein Deploy-Tor für alle.

💣 **Ein Test, der das DATEISYSTEM scannt, wird von ungetrackten Dateien rot.**
`wiki-drossel-alle-erzeuger-test.php` meldete `api/discord/sapi-probe.php` — eine Sonde einer
beendeten Sitzung, die nie ins Repo kommt. Lokal rot, im Repo grün. Die bekannte Rot-Liste aus §9
ist damit länger als dort steht: `linkcheck/link-url-test.php` **plus** jeder Scan-Test, solange
ungetrackte Dateien herumliegen. (Die Sonde ist am 26.08. gelöscht, der Test ist wieder grün.)
