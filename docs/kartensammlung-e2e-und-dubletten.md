# Kartensammlung / WikiSync — E2E-Verifikation + Dubletten-Bug (Bündel)

> Arbeitsbrief für diesen Worktree. Alle Punkte hängen zusammen: sie betreffen die
> **Kartensammlung (citymap) + ihren Wiki-Sync**, und alle wurden „heute gebaut, aber nie
> end-to-end gegen die echte DB/den echten Dump geprüft". Der Dubletten-Bug ist genau das,
> was eine echte E2E-Prüfung ans Licht gebracht hat.
>
> ### ⚠️ Aktualisiert 2026-07-20 — der Dubletten-Bug ist BEHOBEN
>
> Der Code-Fix kam am 2026-07-18 mit **`84b52c42`**, also im unmittelbar nächsten Commit
> nach dem, der dieses Dokument angelegt hat (`f304045b`) — nachgezogen wurde es nie.
> Zwei Tage lang stand hier „der echte offene Bug", und genau das hat am 2026-07-20 eine
> Konfliktmanagement-Analyse in die Irre geführt.
>
> **Die frühere Reihenfolge-Anweisung war danach nicht nur veraltet, sondern verkehrt:**
> Sie verlangte, den Bug zu lösen, *bevor* wieder „Karten syncen" läuft. Tatsächlich ist
> ein „Karten syncen"-Lauf jetzt **genau der Aufräumschritt** — er entfernt die
> bestehenden Dubletten (siehe Priorität 1).

## Reihenfolge (wichtig)

1. **🔧 Owner: einmal „Karten syncen" fahren.** Das räumt die bestehenden Dubletten ab.
   Danach die E2E-Invariante prüfen (Priorität 2 Punkt 1).
2. Danach die übrigen **E2E-Durchläufe** der gebauten Features.

STRATO-Vorsicht (AGENTS.md §9): **nie** teure Endpoints in der Schleife proben — ein Request
genügt. „Dump holen" / „Karten syncen" sind **Owner-getriggert**.

---

## Priorität 1 — Kartensammlungs-Dubletten ✅ BEHOBEN (`84b52c42`, 2026-07-18)

**Symptom (Owner):** doppelte Einträge, z. B. **„Stadtplan von Al'Anfa (Al'Anfa und der
tiefe Süden)"** 2×. Live gemessen (Editor-Liste `POST /api/edit/map/citymaps.php {action:'list'}`,
~419 Karten): **24 Doppelgruppen, 49 Zeilen, 25 überzählig — 23 wiki + 1 manual.** Eine Gruppe 3×
(*Stadtplan von Havena (AGF)*). Systematischer **Wiki-Sync**-Fehler.

Der Unit-Test „2. Lauf legt KEINE Dubletten an" war grün — er traf den Fall nicht, weil in den
Testdaten keine Quelle in **beiden** Farbspalten stand.

### Die Ursache (bestätigt)

Von den beiden unten skizzierten Fix-Pfaden war es **der erste: verschiedene Keys durch
Varianten.** Der Stadtplanindex listet dieselbe Karte in der **Farbe**-Spalte *und* der
**s/w**-Spalte derselben Publikation (Havena/AGF sogar dreifach), die neue Liste ergänzt eine
Zeile mit unbekannter Farbe. Alle tragen den identischen Titel „Stadtplan von X (Quelle)" — es
ist **eine** Karte, die Farbe ist Sachangabe, nicht Identität. Der `wiki_key` steckte die Farbe
aber in die Identität (`stadtplan-farbe` vs. `stadtplan-sw`), also entstanden verschiedene
Schlüssel, `avesmapsCitymapDedupeByWikiKey` konnte sie nicht falten, und der Reconcile schrieb
zwei bis drei titelgleiche Zeilen. Das sind die 23 Wiki-Dubletten.

### Der Fix

`avesmapsCitymapStadtplanIdentityVariant` (`citymap-sync.php:129`) faltet
`stadtplan-farbe` / `stadtplan-sw` / `stadtplan` auf **ein** Identitäts-Token `stadtplan`,
das **ausschließlich** für den `wiki_key` benutzt wird. `umgebung` bleibt eine eigene Karte.
Die gespeicherten Felder `variant` und `is_color` bleiben unangetastet; beim Falten gewinnt die
reichere Zeile. Regressionstest: eine Quelle in beiden Farbspalten ergibt jetzt **eine**
Stadtplan-Karte plus **eine** Umgebungskarte statt dreien.

**Kein SQL nötig.** Die bestehenden Dubletten verschwinden beim nächsten „Karten syncen":
die verwaisten Farb-Schlüssel fallen aus dem Katalog, und die Removal-Phase löscht sie
(`origin='wiki'` only — manuelle Zeilen bleiben sicher).

### Was noch offen ist

1. **🔧 Owner: einmal „Karten syncen" fahren.** Erst danach sind die 23 Wiki-Dubletten
   tatsächlich weg. Ob das seit dem 2026-07-18 gelaufen ist, ist hier nicht bekannt.
2. **Die 1 manuelle Dublette** („Al'Anfa und das Regengebirge") ist ein **separater Fall**
   (Hand-Doppelanlage oder adoptiert) und wird vom Fix **nicht** berührt — er fasst nur
   `origin='wiki'` an.
3. **Der Unique-Key-Guard ist weiterhin lückenhaft** und wurde von `84b52c42` nicht angefasst:
   `citymap.wiki_key` bekommt seinen UNIQUE KEY `uq_citymap_wiki_key` per self-healing ALTER,
   aber **der Guard prüft nur, ob die SPALTE existiert, nicht ob der KEY existiert.** Wäre das
   ADD UNIQUE KEY je fehlgeschlagen (etwa weil zu dem Zeitpunkt schon Dubletten dastanden),
   wird es nie erneut versucht. Das ist heute kein akutes Problem mehr — die Identität stimmt
   ja —, aber das strukturelle Sicherheitsnetz fehlt womöglich. Prüfbar mit:
   ```sql
   SHOW INDEX FROM citymap WHERE Key_name = 'uq_citymap_wiki_key';
   ```
   Fehlt er: Dubletten erst abräumen (Punkt 1), dann den Guard auf **Key**-Existenz erweitern
   und den Unique-Key nachziehen.

### Mechanik (zur Einordnung, Code: `api/_internal/wiki/citymap-sync.php`)
- Dedup über `wiki_key = <index>:slug(stadt):slug(quelle):variante` (deterministisch,
  `avesmapsCitymapWikiKey`) — die `variante` ist seit `84b52c42` farbunabhängig.
- Reconcile: `SELECT … WHERE wiki_key=:wk LIMIT 1` → UPDATE sonst INSERT.
- Removal (`avesmapsCitymapRemoveVanished`) löscht wiki-Zeilen, deren `wiki_key` nicht im
  Staging-Katalog steht — das ist der Aufräummechanismus aus Punkt 1.

Memory: `citymaps-duplicate-entries`, `citymaps-wiki-sync-recon`, `citymaps-multilinks`.

---

## Priorität 2 — E2E-Durchläufe (heute gebaut, nie durchgezogen)

„E2E" heißt hier jeweils: **echtes „Dump holen" → betreffenden Sync/Autoget fahren → in der
DB/Live-UI prüfen, dass das Ergebnis stimmt** (nicht nur der grüne Unit-Test).

1. **Karten-Wiki-Sync — E2E-Invariante bestätigen.** Der Dedup-Fix ist drin (`84b52c42`,
   Priorität 1), die Bestätigung am echten Datenweg fehlt: nach dem Aufräum-Lauf ein
   **zweites** „Karten syncen" fahren — es muss **0** neue Zeilen anlegen, und die 23
   titelgleichen Wiki-Dubletten müssen verschwunden sein. Memory: `citymaps-wiki-sync-recon`.
2. **Autoget-Vorschauen.** Massen-Autoget im Karten-Editor. E2E: nach „Dump holen" Vorschauen
   ziehen, prüfen dass Cover landen + Fälligkeit korrekt. ⚠️ Falle (Memory): **Fälligkeit NIE
   auf `thumb_origin` filtern.** Wiki = API statt Crawl. Memory: `citymaps-autoget-vorschauen`.
3. **Community-Fundorte.** Community-Karten-Vorschläge (Task C §3.8). E2E: Vorschlag anlegen →
   review → in `citymap` übernehmen. ⚠️ Falle (Memory): `set_links` **ersetzt** (nicht
   anhängen). NULL = unbekannt ≠ false. Memory: `citymaps-community-fundorte`,
   `citymaps-feature-task-c`.
4. **Abenteuer-Sync.** (Adventures, nicht citymap — aber gleiches „Wiki-Sync-E2E offen"-Muster.)
   E2E: echtes „Dump holen" → „Abenteuer syncen" → `adventure`/`adventure_place` prüfen; Cover
   reiten auf der Wappen-Engine (F-Shop-Referenz-Lizenz, NICHT `public_domain`); own>wiki-Override.
   Reconcile/Parser sind unit-getestet, E2E fehlt. Memory: `adventures-feature-phase1`.

---

## Prozess / Vorsicht
- Antworten auf Deutsch; Code/Commits/API/`error.code` auf Englisch.
- Shared Working Tree: **nie** `git add -A`/`git add .`/`git commit -a` — nur eigene Pfade
  explizit stagen (AGENTS.md §9).
- Kleine, verifizierte Commits; Push löst ~1–2 min Auto-Deploy aus; Remote-SHA prüfen.
- Editor-Assets geändert? `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js` bumpen.
