# Verwaiste Außenhüllen — Entwurf

**Stand:** 16.08.2026 · **Owner:** *„es darf doch auf der map keine elemente geben über die ich
keine kontrolle mehr habe"* · **Entscheide:** Rechtsklick bietet „Außenhülle löschen" an · hart
gelöscht wird, wenn nichts mehr da ist, was sie erzeugen könnte.

## 1. Der Befund

Gemeldet als „Herrschaftsgebiet 1008 ist nicht anklickbar". Gemeint war der **Name**:
Territorium 2434, `public_id 80c55480-6a4e-4abc-aa8c-4d868f570031`, „Neues Herrschaftsgebiet (1008)".
Sein Zustand, live gemessen:

| | |
|---|---|
| eigene Geometrie | **keine** — `action=geometries` liefert `geometries: []` |
| Kinder | **keine** — `descendant_territory_count: 0` |
| abgeleitete Außengrenze | **eine**, `fb4034c7-…`, `source_count: 0` |
| `parent_id` / `min_zoom` / `max_zoom` | alle `null`, `is_active: 1` |

Es besteht **ausschließlich aus einer Hülle über nichts**. Damit ist es im Editor unerreichbar:

```js
interactive: IS_EDIT_MODE ? !regionEntry.isDerivedGeometry : (…)   // region-rendering.js:454
```

Abgeleitete Hüllen sind im Bearbeiten-Modus **absichtlich** inert, damit Klicks an die
Quellgeometrien gehen — sonst landet `update_geometry` auf einer Derived-ID und antwortet
„Geometrie nicht gefunden". Die Regel setzt stillschweigend voraus, dass unter der Hülle eine
Quelle liegt. Hier liegt keine.

Gemessen mit `?edit=1`, Zoom 4, Rasterabtastung der Hüllenfläche: `pointer-events: none`, und
**alle 116 sichtbaren Prüfpunkte innerhalb der Hülle treffen den nackten `leaflet-container`**.
Gegenprobe ohne `?edit=1`: `pointer-events: auto`, 100 % der Punkte treffen das Gebiet
(767/767 bei Zoom 3, 305/305 bei 4, 87/87 bei 5) — im Frontend füllt es `#a64b7d` bei 0,7 über der
Inselgruppe, für jeden Besucher sichtbar, ohne Label, ohne Zoom-Band (`min/max_zoom` beide `null`,
also auf **jeder** Stufe).

**Ausmaß:** von 133 Hüllen bei Zoom 4 hat **genau eine** keine Quelle. Es ist ein Einzelfall — aber
die Lücke, durch die er kam, steht offen.

## 2. Woher das Loch kommt

Die Regel existiert bereits. `avesmapsPoliticalDeactivateDerivedGeometryForTerritoryChain`
deaktiviert die Hülle eines Gebiets **und seiner Vorfahren**, sobald eine Geometrie oder ein
Territorium gelöscht wird. Aufgerufen wird sie von genau zwei Stellen:

- [`territories-geometry.php:468`](../../../api/_internal/political/territories-geometry.php) — Geometrie löschen
- [`territories-write.php:590`](../../../api/_internal/political/territories-write.php) — Territorium löschen

💣 **`purge_unassigned_geometries` ist die dritte und ruft sie nicht.** Der Bulk-Knopf „Alle
endgültig löschen" setzt ein rohes Statement ab:

```sql
DELETE g FROM political_territory_geometry g
LEFT JOIN political_territory t ON t.id = g.territory_id
WHERE t.id IS NULL OR t.name LIKE 'Neues Herrschaftsgebiet%'
```

Er löscht also genau die Quellflächen der Platzhalter-Gebiete und lässt Territorium *und* Hülle
stehen. **Dieselbe Lehre wie bei den vier Querfeldein-Erzeugern (AGENTS.md §11): eine Regel, die
zwei von drei Löschwegen bindet, ist keine Regel.**

🪤 Belegbar ist der Weg nicht — Löschzeitpunkte stehen nirgends. Er ist der einzige im Code, auf dem
Quellen verschwinden und die Hülle bleibt.

## 3. Warum der Aufräumer ihn nicht findet

`geometry_inventory` liest **eine** Tabelle:

```sql
FROM political_territory_geometry g
LEFT JOIN political_territory t ON t.id = g.territory_id
```

[`territories-geometry-inventory.php:44`](../../../api/_internal/political/territories-geometry-inventory.php)
— plus die Legacy-Regionen aus `map_features`. `political_territory_derived_geometry` kommt darin
nicht vor. Der Scanner übersieht die Hülle nicht, er schaut strukturell woanders hin.

💣 **Und er kappt, bevor gefiltert wird.** Serverseitig `array_slice($geometries, 0, 500)`, sortiert
nach `((max_x-min_x)*(max_y-min_y)) DESC`; der Client filtert erst danach auf Waisen. Weil Waisen
klein sind, fallen sie hinten heraus — im Fenster steht heute „25 verwaiste Kontur(en)
(**6 gelistet**)", und alle sechs Sichtbaren tragen dieselbe Fläche 346, weil sie auf der 500er-Kante
liegen. Die Zeile sagt die Wahrheit und ist trotzdem unbrauchbar: es gibt keinen Weg zu den anderen
19.

⭐ Nebenbei ist genau diese Sortierung der Beweis, dass 2434 **keine** Quellzeile hat, auch keine
inaktive: seine Hülle misst 64 × 92 (Fläche ≈ 5.886), die gelisteten Waisen 20 × 17 (346). Eine
Quellzeile dieser Größe stünde nicht hinten, sondern als **erste Zeile** im Fenster.

## 4. Das Gesetz

Was die Karte zeichnet, muss im Editor erreichbar sein — und was nicht mehr erreichbar ist, steht in
einer Liste, aus der es entfernt werden kann.

Zwei Griffe, unabhängig voneinander wirksam: der Klick (damit der vorhandene Fall bedienbar wird)
und der Aufräumer (damit kein neuer unbemerkt bleibt).

## 5. Teil 1 — Der Klick

⭐ **Was der Owner unter a) wollte, existiert bereits.** Das Rechtsklick-Menü trägt „Löschen"
([`index.html:349`](../../../index.html)), und für einen abgeleiteten Eintrag führt es über
[`map-features-region-context-menu.js:105`](../../../js/map-features/map-features-region-context-menu.js)
nach `deleteDerivedRegionGeometry` → `deleteDerivedGeometryTree`. Der Eintrag funktioniert. Er kommt
nur nie zum Zug, weil das Polygon inert ist — dann erreicht es auch der **Rechts**klick nicht.

**(1) Die Bedingung.** [`region-rendering.js:454`](../../../js/map-features/map-features-region-rendering.js) —
im Bearbeiten-Modus ist eine abgeleitete Hülle interaktiv, wenn sie keine Quellgeometrie hat:

```js
interactive: IS_EDIT_MODE
    ? (!regionEntry.isDerivedGeometry || regionEntry.derivedHasNoSources)
    : (…unverändert…)
```

⭐ **Das Signal liegt schon im Payload — keine Server-Zeile.** Jede Hülle trägt
`derived_source_geometry_public_ids`, serverseitig in zwei Abfragen aufgelöst
([`territories-derived-layer.php:63`](../../../api/_internal/political/territories-derived-layer.php)),
beide mit `is_active = 1` auf Geometrie und Territorium. Gemessen bei Zoom 4: 133 Hüllen, davon eine
mit leerer Liste; Winhall 8, Kosch 32, Támenev 1, Câbas 1. Die Feature-Normalisierung muss das Feld
nach `regionEntry.derivedHasNoSources` durchreichen.

💣 **Dieses Signal MUSS vom Server kommen und darf nicht im Browser gezählt werden.** „Im Layer liegt
nur die Hülle" trifft bei Zoom 4 auf **114** Gebiete zu, und **111 davon sind kerngesund** — ihre
Quellflächen sind bei diesem Zoom nur nicht ausgeliefert. Wer im Browser zählt, erklärt Kosch,
Weiden und Nordmarken zu Geistern. Bei Támenev und Câbas ist mir genau das passiert, bis die
Einzelabfrage je 1 eigene Geometrie zeigte.

**(2) Das Menü.** `openRegionContextMenu` zeigt für eine quellenlose Hülle nur, was zutrifft:
**„Außenhülle löschen"**, „Territoriumseditor öffnen", „Infobox anzeigen". Die übrigen acht
(Grenzen bearbeiten, Verschieben, Zerschneiden, Vereinigen, Ausschneiden ×3, Herauslösen) gehören
einer Quellfläche, die es hier nicht gibt. ⚠️ Das Muster steht schon da — `extract` wird in
derselben Funktion bereits so ein- und ausgeblendet; kein zweiter Mechanismus.

Der Eintrag `delete` heißt bei einer Hülle **„Außenhülle löschen"** statt „Löschen". 🔴 Umbenannt
wird die **Beschriftung**, nicht die Kennung: `data-region-context-action="delete"` bleibt, sonst
verliert der Handler in `map-features-region-context-menu.js` seinen Anker.

**(3) Der Linksklick.** [`map-features.js:525`](../../../js/map-features/map-features.js) sagt heute
„Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich)
anklicken." Für einen Geist ist der Satz falsch — es gibt keine. Dort ein eigener Satz, der auf den
Rechtsklick zeigt.

## 6. Teil 2 — Der Aufräumer

**(1) Server.** `geometry_inventory` liefert zusätzlich `derived_orphans`: jede aktive Zeile aus
`political_territory_derived_geometry`, deren Gebiet **samt Nachfahren über `parent_id`** keine
aktive Quellgeometrie hat. Dieselbe mengenbasierte Rechnung wie im Layer — zwei Abfragen plus
Hüllenbildung im Speicher, **kein N+1**. Dazu die dangling-Fälle: eine Hülle, deren `territory_id`
auf kein Territorium mehr zeigt.

💣 **„Hülle ohne Quelle" wird EINMAL gerechnet, nicht dreimal.** Scanner (§6), Bulk-Knopf (§6.4)
und Hart/Weich-Weiche (§7) fragen dieselbe Funktion — sonst driften drei Kopien derselben Regel
auseinander, und die Liste zeigt etwas anderes, als der Knopf löscht. Das ist die Falle aus §2 in
ihrer nächsten Gestalt.

⚠️ **Für Hüllen entfällt der Platzhalter-Filter.** Bei Konturen listet der Client nur
territoriumslose und `Neues Herrschaftsgebiet%` — echte Papierkorb-Gebiete bleiben absichtlich
draußen. Eine Hülle ohne Quelle ist dagegen **immer** falsch, egal wie das Gebiet heißt.

**(2) Der Deckel.** Das Fenster fordert `&limit=2000` an (Servermaximum). Ohne das lügt die Liste
weiter, und zwar nach Fläche sortiert, also systematisch bei den Kleinen — genau den Waisen.

**(3) Die Liste.** Hüllen stehen in derselben Liste, in der Spalte, in der bei Konturen die `source`
steht, mit **„Außengrenze"** gekennzeichnet, und mit eigenem Löschknopf (`delete_derived_geometry`
statt `hard_delete_geometry`). Die Kopfzeile zählt beide Arten.

**(4) Der Bulk-Knopf.** „Alle endgültig löschen" nimmt die Hüllen mit — indem
`purge_unassigned_geometries` nach seinem `DELETE` über die vorhandene Ketten-Funktion geht statt an
ihr vorbei. 💣 Sonst zählt die Kopfzeile wieder mehr, als der Knopf tut, und das ist der Fehler aus
§3 in neuer Kleidung.

## 7. Teil 3 — Hart löschen, wenn nichts sie erzeugen kann

🔴 Owner-Entscheid: *„hart wenn nix mehr da ist was sie erzeugen könnte"*.

`avesmapsPoliticalDeleteDerivedGeometryForTerritory` bekommt eine Weiche:

| Lage | Wirkung |
|---|---|
| Gebiet samt Nachfahren hat **keine** aktive Quellfläche | echtes `DELETE FROM political_territory_derived_geometry` |
| sonst | unverändert `is_active = 0` |

Begründung der zweiten Zeile: solange Quellen existieren, kann „Grenzen berechnen" die Hülle
jederzeit neu erzeugen — die Deaktivierung ist dort der richtige, umkehrbare Zustand. Dieselbe
Weiche gilt im Löschknopf des Aufräumfensters und im Bulk-Knopf.

⚠️ **Hart heißt ohne Rückweg.** Die Deaktivierung *war* das Sicherheitsnetz. Tragfähig ist die Regel
nur, weil sie ausschließlich Hüllen trifft, die ohnehin niemand mehr zurückrechnen kann; für alles
andere bleibt der weiche Weg. Die Weiche ist damit die einzige Stelle, an der über „hart" entschieden
wird — sie darf nicht in die Aufrufer kopiert werden.

## 8. Was NICHT dazugehört

- **Kein Verstecken.** Eine Fläche nicht zu zeichnen, heißt nicht, sie unter Kontrolle zu haben — es
  macht Geister schwerer zu finden, nicht leichter. Der Frontend-Pfad bleibt unberührt; ist die
  Hülle gelöscht, ist sie überall weg.
- **Kein neues Kaskaden-Löschen.** Es existiert (§2); es wird nur an der dritten Stelle angeschlossen.
- **Kein Wächter über alle Ebenen.** Der Zuschnitt bleibt bei den Herrschaftsgebieten: dort liegt
  die einzige gezeichnete Geometrie, die nicht direkt bearbeitbar ist. Orte, Wege, Regionen und
  Landschaften sind über ihre Editoren erreichbar. Ein allgemeiner Abgleich Karte ↔ Editorlisten
  wäre ein eigenes Vorhaben.

## 9. Absicherung

**PHP** (`api/_internal/political/__tests__/`):

- Hülle ohne Quelle erscheint in `derived_orphans`; Hülle mit Quelle erscheint **nicht**.
- Hülle, deren Gebiet nur über Nachfahren Quellen hat, erscheint nicht (die Hüllenbildung greift).
- Hülle mit dangling `territory_id` erscheint.
- `purge_unassigned_geometries` nimmt quellenlose Hüllen mit; Hüllen mit Quelle bleiben.
- Die Hart/Weich-Weiche trifft in beiden Lagen richtig.

**JS** (`js/map-features/__tests__/`):

- 💣 Die Interaktiv-Bedingung mit **Gegenprobe**: eine Hülle ohne Quellen ist im Bearbeiten-Modus
  interaktiv, eine Hülle mit Quellen (Kosch-/Winhall-Fall) bleibt inert. Ohne diese zweite
  Zusicherung kippen die 111 gesunden Aggregate mit.
- Das Menü zeigt für eine quellenlose Hülle genau drei Einträge, und `delete` heißt dort
  „Außenhülle löschen".

**Abnahme als ABLAUF, nicht als Messtabelle** (AGENTS.md §9): Rechtsklick auf den Geist bei der
Inselgruppe (Hülle um lat 429–521 / lng 139–203) → „Außenhülle löschen" → weg von der Karte, weg aus
der Besucheransicht, und danach zeigt das Aufräumfenster **25 statt 6** und keine quellenlose Hülle
mehr.

⚠️ Editor-sichtbare Änderung: der Commit-Betreff muss die Wirkung benennen (neuer Menüeintrag,
Aufräumfenster listet Außengrenzen) — das Handbuch pflegt die nächtliche Routine daraus, nicht diese
Sitzung.
