# Kartensammlung / WikiSync — E2E-Verifikation + Dubletten-Bug (Bündel)

> Arbeitsbrief für diesen Worktree. Alle Punkte hängen zusammen: sie betreffen die
> **Kartensammlung (citymap) + ihren Wiki-Sync**, und alle wurden „heute gebaut, aber nie
> end-to-end gegen die echte DB/den echten Dump geprüft". Der Dubletten-Bug ist genau das,
> was eine echte E2E-Prüfung ans Licht gebracht hat.

## Reihenfolge (wichtig)

1. **Dubletten-Bug zuerst** (Priorität 1). Er MUSS vor jedem nächsten „Karten syncen" gelöst
   sein, sonst legt der Sync neue Dubletten an.
2. Danach die **E2E-Durchläufe** der heute gebauten Features.

STRATO-Vorsicht (AGENTS.md §9): **nie** teure Endpoints in der Schleife proben — ein Request
genügt. „Dump holen" / „Karten syncen" sind **Owner-getriggert**.

---

## Priorität 1 — Kartensammlungs-Dubletten (der echte offene Bug)

**Symptom (Owner):** doppelte Einträge, z. B. **„Stadtplan von Al'Anfa (Al'Anfa und der
tiefe Süden)"** 2×. Live gemessen (Editor-Liste `POST /api/edit/map/citymaps.php {action:'list'}`,
~419 Karten): **24 Doppelgruppen, 49 Zeilen, 25 überzählig — 23 wiki + 1 manual.** Eine Gruppe 3×
(*Stadtplan von Havena (AGF)*). Systematischer **Wiki-Sync**-Fehler.

Der Unit-Test „2. Lauf legt KEINE Dubletten an" war grün — aber der **DB-Weg lief nie** in der
Prüfung. In der Realität legt der 2. Lauf **doch** welche an. Das ist der Kern.

### 🔧 Owner-SQL zuerst (rein lesend, phpMyAdmin)
Der Editor zeigt `wiki_key`/`created_at` NICHT — die entscheidende Abfrage ist nur direkt möglich:
```sql
SELECT id, wiki_key, origin, created_at FROM citymap
WHERE title IN ("Stadtplan von Al'Anfa (Al'Anfa und der tiefe Süden)","Stadtplan von Havena (AGF)")
ORDER BY title, created_at;
SHOW INDEX FROM citymap WHERE Key_name = 'uq_citymap_wiki_key';
```
Zeigt: **gleiche vs. verschiedene** `wiki_key`, **ein Lauf vs. mehrere** (`created_at`),
**ob der Unique-Key `uq_citymap_wiki_key` existiert.**

### Mechanik (Code: `api/_internal/wiki/citymap-sync.php`)
- Dedup über `wiki_key = <index>:slug(stadt):slug(quelle):variante` (deterministisch,
  `avesmapsCitymapWikiKey`).
- `citymap.wiki_key` hat einen UNIQUE KEY `uq_citymap_wiki_key` — aber via self-healing ALTER,
  und **der Guard prüft nur, ob die SPALTE existiert, nicht ob der KEY existiert.** ⇒ wäre der
  ADD-UNIQUE-KEY je fehlgeschlagen (z. B. weil schon Dubletten da waren), wird er nie erneut
  versucht → kein Unique-Key.
- Reconcile: `SELECT … WHERE wiki_key=:wk LIMIT 1` → UPDATE sonst INSERT.
- Removal (`avesmapsCitymapRemoveVanished`) löscht wiki-Zeilen, deren `wiki_key` nicht im
  Staging-Katalog steht.

⇒ Eine Wiki-Dublette überlebt nur, wenn **beide `wiki_key` im Katalog stehen** (Parser gibt
dieselbe Karte unter **zwei `variant`-Werten** aus → zwei Keys, gleicher Titel) **ODER** der
Unique-Key wurde nie angewandt.

### Fix-Pfade (je nach SQL-Ergebnis)
- **Verschiedene Keys (Varianten):** im Parser klären, warum eine Karte zwei Varianten bekommt
  (Identität fixen). Aufräumen passiert dann von selbst — der alte Key wird verwaist, Removal
  löscht ihn beim nächsten Sync.
- **Unique-Key fehlt:** Dubletten zuerst löschen, dann den Guard auf **Key**-Existenz erweitern
  (nicht nur Spalte) und den Unique-Key nachziehen → strukturell unmöglich.

Die 1 manuelle Dublette („Al'Anfa und das Regengebirge") = separater Fall (Hand-Doppelanlage
oder adoptiert).

Memory: `citymaps-duplicate-entries`, `citymaps-wiki-sync-recon`, `citymaps-multilinks`.

---

## Priorität 2 — E2E-Durchläufe (heute gebaut, nie durchgezogen)

„E2E" heißt hier jeweils: **echtes „Dump holen" → betreffenden Sync/Autoget fahren → in der
DB/Live-UI prüfen, dass das Ergebnis stimmt** (nicht nur der grüne Unit-Test).

1. **Karten-Wiki-Sync — 2. Lauf legt Dubletten an.** = die Wurzel von Priorität 1; nach dem
   Dedup-Fix hier die E2E-Invariante bestätigen: zweiter „Karten syncen"-Lauf legt **0** neue
   Zeilen an. Memory: `citymaps-wiki-sync-recon`.
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
