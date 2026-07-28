# V7 — Grenzimport aus den Territorien — Instruction

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:executing-plans` (oder
> `superpowers:subagent-driven-development`). Schritte tragen `- [ ]` zum Abhaken.
> **Eigener Worktree auf `origin/master`.**

**Stand:** 2026-07-28. **Auftraggeber:** Owner. **Vorgänger:** V4a ✅ (`1bfd4f53`),
Landschaften-Editor ✅ (eigener Plan, `2026-07-27-landschaften-editor.md`).
Maßstab: `docs/oekosystem-editor-verhalten.md`, `docs/superpowers/plans/2026-07-24-landschaften.md`
(Zeile V7), AGENTS.md §12.

**Ziel:** Eine Landschaftsfläche aus **vorhandenen Territoriengrenzen** erzeugen, statt sie
nachzuzeichnen. Rechtsklick auf die Karte → Hierarchiebaum mit Häkchen → die gewählten
Geometrien **vereinigen**, **vereinfachen** und als neue Fläche einfügen.

---

## 0. Die eine Regel, die alles andere trägt

🔴 **KOPIE, NIE VERKNÜPFUNG.** Die eingefügte Fläche ist ab dem Einfügen ein eigenständiges
Objekt in `ecosystem_area`. Sie merkt sich **nicht**, aus welchen Territorien sie entstand,
und sie folgt ihnen **nicht**, wenn dort jemand eine Grenze verschiebt.

Das ist kein Versehen, sondern der Unterschied zwischen den beiden Ebenen: eine politische
Grenze *ist* eine Linie und wird verhandelt; ein Waldrand ist keine Grenze, Wald läuft in
Steppe aus (`oekosystem-editor-verhalten.md` §5). Eine mitwandernde Landschaftsgrenze wäre
eine stille Lüge — der Wald zöge um, weil eine Baronie neu vermessen wurde.

> ⚠️ Wer hier eine `source_territory_id`-Spalte einführen will: **erst mit dem Owner reden.**
> Das ist eine andere Funktion („abgeleitete Landschaftsgrenze"), nicht diese.

---

## 1. Was schon liegt — und deshalb NICHT gebaut wird

Der Großteil ist da. Wer das übersieht, baut ihn nach.

| Baustein | Zustand |
|---|---|
| **Territoriengeometrie laden** | ✅ `loadAllTerritoryGeometry()` in `js/map-features/map-features-settlement-territory-assign.js` — liefert `[{feature, territory_public_id, area}]` |
| **Vereinigen** | ✅ `ecosystemBooleanGeometry("union", a, b)` in `js/map-features/map-features-ecosystem-boolean.js`, unit-getestet, multipolygon-fest |
| **Vereinfachen** | ✅ **`js/map-features/map-features-ecosystem-simplify.js`** (gebaut 2026-07-28) — Douglas-Peucker über `L.LineUtil.simplify`, in KARTENkoordinaten, mit Vorschau-Dialog und Regler |
| **Fläche + Region anlegen** | ✅ `create_region` / `create_area` (`api/edit/map/ecosystem.php`); `geometry_geojson` nimmt Polygon **oder** MultiPolygon, prüft Form, begrenzt auf 0..1024, rechnet die bbox über **alle** Teile |
| **Schreibkanal** | ✅ `postEcosystemEdit(action, payload)` (`map-features-ecosystem-region-store.js`) |
| **Kontextmenü** | ✅ `js/map-features/map-features-ecosystem-context-action.js` — dort hängen „Neue Vegetation/Topographie/Derographische Region" |
| **Auto-Name** | ✅ `nextEcosystemRegionAutoName(artLabel, existingNames)` (`map-features-ecosystem-naming.js`) |

### 1.1 Zum Vereinfachen im Besonderen

`map-features-ecosystem-simplify.js` löst genau das Problem, das V7 sonst hätte. Sein Kopf
sagt zwei Dinge, die hier **wörtlich** gelten:

- **Keine neue Bibliothek.** Leaflet bringt Douglas-Peucker mit (`L.LineUtil.simplify`).
- 💣 **Gerechnet wird in Kartenkoordinaten (0..1024), nicht in Bildschirmpunkten.** Sonst
  hinge das Ergebnis am Zoom, unter dem der Dialog zufällig offen war.

Brauchbar ist `simplifyGeometry(geometry, strength)` (`:124`) — es zerlegt Polygon wie
MultiPolygon und gibt denselben Typ zurück. 🔴 Der Regler steuert die **Punktzahl**, nicht die
Toleranz (Owner-Entscheid, zweite Fassung). **Erst die Datei lesen, dann entscheiden**, ob V7
die Funktion aufruft oder den Dialog nach dem Einfügen öffnet.

---

## 2. Gemessen — nicht schätzen, das ist schon erledigt

Aus dem Hauptplan (V7-Zeile):

- **120 Territorien vereinigen = 47,7 ms.** Die Rechnung ist kein Performance-Problem.
- **500 Flächen à 800 Ecken = 14,8 MB** bei ungerundeten Koordinaten. **`round(…, 4)` beim
  Schreiben halbiert das.** Das ist der Grund für die Vereinfachung, nicht Ästhetik.

Am 2026-07-28 am Live-Bestand nachgemessen (Landschaften-Editor-Sitzung):

- **945 verschiedene Territorien** über die Zoomstufen 0–6 (je Stufe 982–988 Merkmale).
- Von 945 Namen beginnen **713** mit ihrem exakten `territory_type`.

---

## 3. Fallen, die schon zugebissen haben

💣 **Territorien sind ZOOM-GEBÄNDERT.** Ein einzelner `?action=layer`-Aufruf liefert die
meisten **nicht**. Die vier gesuchten Baronien einer Prüfung tauchten erst ab **Zoom 4** auf.
`loadAllTerritoryGeometry` fächert deshalb über 0–6 auf und entdoppelt nach
`territory_public_id`. **Nicht durch einen einzelnen Aufruf ersetzen.**

💣 **Die Entdopplung behält EINE Geometrie je Gebiet** — „erste Zoomstufe, die es zeigt,
gewinnt". Aggregat **oder** roh, je nachdem was der Layer für dieses Gebiet zeigt; beide
zugleich gibt dieser Weg nicht her. `properties.is_aggregate` sagt, welche es wurde.

💣 **Sieben Anfragen an den Politik-Layer.** CLAUDE.md verbietet, diesen Endpunkt zu schleifen
— er hat einmal die PHP-Worker gesättigt und wie ein DB-Ausfall ausgesehen. Der Fächer muss
**hinter einer ausdrücklichen Aktion** bleiben und je Sitzung höchstens einmal laufen. Der
Landschaften-Editor hält es so (Kachel „Zugehörigkeit rechnen"), und er legt das Ergebnis in
einen nach `ecosystem_revision` geschlüsselten Zwischenspeicher.

💣 **Der Territoriumsname trägt seinen Rang schon.** 713 von 945 beginnen mit ihrem Typ; der
Rest sind Vollnamen wie „Alanfanisches Imperium". Ein vorangestellter Typ ergibt „Baronie
Baronie Schneehag". Im Landschaften-Editor steht dafür `territoryLabel()` — abschreiben.

💣 **`ecosystemGeometryBounds` liefert snake_case** `{min_x, min_y, max_x, max_y}` — wie das
`bounds`-Feld der API — und **`null`** bei leerer Geometrie. Als `{minX, …}` gelesen ergibt es
lautlos `NaN`.

💣 **`ecosystemBooleanGeometry` WIRFT bei leerem Ergebnis** („Die Operation ergibt keine
Fläche."). Bei einer Vereinigung getrennter Gebiete ist das kein Fehlerfall, aber der Aufruf
muss ihn fangen.

💣 **Koordinaten:** GeoJSON speichert `[x, y]`, Leaflet `L.CRS.Simple` nutzt `[lat, lng] =
[y, x]`. Bewusst tauschen (AGENTS.md §5).

---

## 4. Regeln

1. 🔴 **Keine politische Datei wird BESCHRIEBEN.** Lesen ist seit dem 2026-07-28 vom Owner
   freigegeben (`api/app/political-territories.php?action=layer`) — Schreiben nicht, nie.
2. 🔴 **Jede eingefügte Fläche bekommt ihre EIGENE Region** (`oekosystem-editor-verhalten.md`
   §4). Sonst trägt sie den Namen einer fremden, und ein Umbenennen trifft beide.
3. 🔴 **`wiki_region_key` entsteht serverseitig** aus `wiki_url`. Der Client schickt nie einen.
4. **`round(…, 4)` beim Schreiben** — siehe §2, das halbiert die Nutzlast.
5. **Deutsch in der Oberfläche, Englisch in Code, Kommentaren und Commits.** Neue UI-Strings
   zusätzlich in `js/app/i18n-en.js`.
6. **Jeder neue Top-Level-Name vor dem Commit gegen `grep` über `js/`** — 164 klassische
   `<script>`-Tags teilen einen globalen Scope.
7. **Geteilter Arbeitsbaum:** nie `git add -A`, nur eigene Pfade einzeln.
8. **Abnahme im Browser**, nicht „Tests grün". Es gibt keine lokale Datenbank; jeder DB-Pfad
   ist nur live prüfbar. Ein `?demo=1`-Pfad mit Attrappen ist das Mittel der Wahl — der
   Landschaften-Editor und der Kraftlinien-Editor haben je einen.
9. 💣 **Karten-Gesten nur mit ECHTEN DOM-Ereignissen prüfen.** `map.fire("click")` umgeht die
   Leaflet-Ebene und beweist nichts. Bei einem Kontextmenü heißt das: `contextmenu` auf dem
   Layer-Element, nicht auf der Karte.
10. **PHP-Tests brauchen `-d extension=mbstring`**, sonst scheitert alles an `mb_strlen`.
    Zwei Fehlschläge (`adventure-resolve-candidates`, `source-search`) sind vorbestehend —
    vor dem Loslegen gegen die Basis gegenprüfen, nicht sich zurechnen lassen.

---

## 5. Offene Fragen — ✅ vom Owner beantwortet 2026-07-28, VOR dem Bau

| Frage | Antwort |
|---|---|
| **1. Welche Ebene?** | **Der Dialog fragt, vorausgewählt „Derographische Region".** Ein Menüeintrag statt drei; die Wahl steht neben der Auswahl, die sie betrifft. |
| **2. Aggregat oder roh?** | **Nehmen, was der Layer zeigt.** Keine zweite Anfrage an den Politik-Layer. Jede Baumzeile sagt, welche Geometrie es wurde (*„Außengrenze"* / *„Grenze"*), statt eine Wahl vorzutäuschen. |
| **3. Wann vereinfachen?** | **Danach, im vorhandenen Dialog.** Erst einfügen, dann öffnet „Fläche vereinfachen" von selbst — mit Regler, Vorschau und „vorher → nachher". Kein zweiter Regler im Import-Dialog. |

*(Der Originaltext der drei Fragen steht unten, damit die Begründung nachlesbar bleibt.)*

## 5a. Die Fragen im Wortlaut

1. **Welche Ebene bekommt die neue Fläche?** Derographische Region, Vegetation oder
   Topographie? Der naheliegende Fall ist *derographisch* (politische Grenzen folgen oft
   Landschaftsgrenzen), aber das ist eine Vermutung. Der Kontextmenü-Eintrag muss es wissen —
   oder der Dialog muss fragen.
2. **Aggregat oder rohe Geometrie?** Bei einem Container-Territorium zeigt der Layer die
   abgeleitete Außengrenze (`is_aggregate: true`). Für „nimm das Herzogtum" ist das vermutlich
   das Gewünschte — aber die Entdopplung lässt keine Wahl (§3). Ob das reicht, entscheidet
   der Owner.
3. **Wann wird vereinfacht?** Sofort beim Einfügen mit einer festen Stärke, oder öffnet sich
   danach der vorhandene Vereinfachen-Dialog mit Vorschau? Letzteres zeigt dem Editor, was er
   verliert — die Begründung, die in `map-features-ecosystem-simplify.js` steht.

---

## 6. Aufgaben

- [x] **1 — Die drei Fragen aus §5 klären.** ✅ Vom Owner beantwortet, vor dem ersten Handgriff — die
      Antworten stehen in §5.
- [x] **2 — Baum-Auswahl.** `js/map-features/map-features-ecosystem-territory-import.js` hängt einen
      vierten Eintrag („Grenze aus Territorien …") in das Untermenü „Hier hinzufügen" und öffnet
      `#ecosystem-import-overlay`: Ebenenwahl, Suchfeld, Hierarchiebaum aus `parent_public_id` mit
      Häkchen und Teilzustand. Beschriftung nach dem `territoryLabel()`-Muster (wortgleiche
      Abschrift). Waisen werden Wurzeln, Zyklen sind bewacht. Der Fächer läuft nur hier, je Sitzung
      einmal — ein **leeres** Ergebnis wird ausdrücklich nicht gemerkt, und zwei Öffnen während des
      Ladens teilen sich einen Fächer.
- [x] **3 — Vereinigen und Vereinfachen.** Gefaltete `ecosystemBooleanGeometry("union", …)` über die
      Auswahl; ein Fehlschlag nennt das Gebiet, an dem es scheiterte. Die Vereinigung liegt als
      Vorschau auf der Karte (kein Schleier über dem Fenster, wie beim Vereinfachen-Dialog), die
      Statuszeile nennt Gebiete, Teile, Ecken und KB — **vor** dem Schreiben. Vereinfacht wird nach
      Entscheid 3 im vorhandenen Dialog.
- [x] **4 — Einfügen.** `create_region` (eigene Region je Fläche, Auto-Name, keine Art, kein
      `wiki_url`) + `create_area` mit `round(…, 4)` + Karten-Label wie beim Zeichnen. Eine Region aus
      einem gescheiterten Versuch wird gehalten, damit ein zweiter Anlauf keine zweite anlegt.
- [x] **5 — Abnahme im Browser.** Mit Attrappen (`?demo=1`) über **echte** DOM-Ereignisse:
      `contextmenu` auf dem Kartencontainer → Eintrag sichtbar → Klick → Dialog, Baum, Kaskade,
      Teilzustand, Suche, Vorschau an den richtigen Weltkoordinaten, Escape. Der Schreibweg mit
      gestubbtem `postEcosystemEdit` (echter Code-Pfad, sichtbare Nutzlasten) bis in den geöffneten
      Vereinfachen-Dialog. Maßstab am Livebestand nachgestellt (946 Gebiete): öffnen 9 ms,
      vereinigen 29 ms, filtern 3 ms. **Ecken:** 56 Baronien = 2240 roh → 552 vereinigt → 405/275/
      150/37 bei Regler 25/50/75/100. **Nutzlast:** 15,0 KB ungerundet → 10,1 KB gerundet (−33 %,
      nicht die im Plan behauptete Hälfte) → 2,8 KB bei Regler 75.
      ✅ **Live vom Owner abgenommen 2026-07-28** („geil funktioniert"). Nachgereicht: die Glyphe des
      Menüeintrags (`352189e2`) — ohne sie entsteht das `::before` nicht und die BESCHRIFTUNG rutscht
      in die 1,45em-Symbolspalte (gemessen 12 statt 41 px). Wer hier einen Eintrag anhängt, braucht
      immer auch eine Regel in `css/components/map-context-menu.css`.
- [x] **6 — Doku.** `docs/oekosystem-editor-verhalten.md` §4a beschreibt den Weg; die V7-Zeile in
      `2026-07-24-landschaften.md` ist abgehakt und trägt die gemessenen Zahlen.

---

## 7. Nicht Gegenstand

- **Ein Massen-`copy_regions`.** Durch V4 ausdrücklich **gestrichen**.
- **„Senden an …"** — nach V3.6 vorgezogen und erledigt.
- **Eine mitwandernde Verknüpfung** zu den Quellterritorien (§0).
