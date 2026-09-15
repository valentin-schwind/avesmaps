# Wiki-Orte ohne Kartenpunkt überschreiben — Innerorts, „Gehört zu" und das ↺

**Owner-Auftrag vom 15.09.2026**, mit zwei Bildern aus „Orte bearbeiten": Ein Ort aus dem Reiter
„Fehlt" zeigt seine Eigenschaften, lässt aber nichts ändern („Nur im Wiki — noch nicht auf der Karte
platziert. Zum Bearbeiten zuerst auf der Karte platzieren."). Innerorts soll sichtbar sein, und zu
welchem Ort ein Gebäude gehört, soll sich überschreiben lassen. Und: überschriebene Felder sollen sich
auf den Wiki-Stand zurücksetzen lassen.

Mockup: `docs/wiki-ort-override-mockup.html`.
Vorgänger, die dieser Entwurf fortschreibt: `2026-08-17-wiki-override-fuer-alle-design.md` (die
Override-Anzeige samt ↺), die Stadtteil-Einträge vom 14.09.2026 (AGENTS.md §11).

## 0 · Die Owner-Entscheide dieses Tages

1. Ein **nicht platzierter** Ort bekommt **Name, Typ, Ruine und Verborgen** als bearbeitbare Felder,
   mit derselben Override-Anzeige wie überall (braune Beschriftung, durchgestrichener Wiki-Stand, ↺).
2. **Innerorts** und **„Gehört zu"** werden sichtbar und überschreibbar — bei platzierten **und**
   nicht platzierten Orten.
3. Das **↺ erscheint auch bei „von uns gesetzt, Wiki leer"** und leert dann das Feld.
4. Eine **verborgene, nicht platzierte Stätte fehlt in der Zeile „Stätten"** ihrer Stadt; per Name
   bleibt sie in der Suche findbar.
5. Innerorts und „Gehört zu" **speichern sofort**, wie das Territorium im selben Abschnitt. Der
   Hinweis dazu heißt nur **„Speichert sofort"**.
6. Der **Kasten „Wiki-Ort"** (Ändern · Sync · Entfernen) gibt es **nur bei platzierten Orten**. Bei
   nicht platzierten bleibt die Zeile „Wiki-Link".
7. Der **Name** eines nicht platzierten Ortes ist ein **Anzeige-Override**; der Wiki-Titel bleibt
   der Schlüssel.

⚠️ Keine Zahl im Titel dieses Abschnitts — die Liste ist im Gespräch von vier auf sieben gewachsen.

## 1 · Ausgangslage, gemessen

Live am 15.09.2026 über die Editor-Sitzung, gegen `origin/master` gegengeprüft:

| | |
|---|---|
| Nicht platzierte Bauwerke | 3.653 |
| davon innerorts / außerorts / unklar | 2.657 / 989 / 7 |
| Platzierte Bauwerke innerorts | 9 (z. B. „Gut Menzheim → Menzheim", „Steile Brücke → Braunsfurt") |
| größte Innerorts-Städte | Gareth 294 · Punin 142 · Al'Anfa 112 · Festum 93 |

**Warum eine „Fehlt"-Zeile heute gesperrt ist.** Sie ist eine Zeile aus `wiki_sync_pages`, dem
Abzug des Wikis; jeder Sync schreibt sie neu. Sie hat keine Zeile in `map_features`, also keine
`public_id` — und jeder Schreibweg des Orts-Editors (Speichern, Wappen, Bilder, Quellen,
Territorium) hängt an der `public_id`. Die Sperre war keine Entscheidung, sondern die Folge von „es
gibt nichts, wohin man schreiben könnte".

**Innerorts ist nirgends gespeichert.** Das Urteil entsteht bei jeder Anfrage aus dem Infobox-Feld
„Standort" (`avesmapsPlaceScopeClassify`, `api/_internal/wiki/place-scope.php`) — gegen die Namen der
Siedlungen, die auf der Karte liegen.

**Warum das ↺ so selten erscheint.** Es ist nicht kaputt (Herkunft wird gestempelt,
`field-origins-test.php` grün). Die Regel in `avesmapsWikiFeldStand` lautet
`abweicht: neu !== "" && alt !== neu` — also nur an fünf Feldern (Name, Typ, Einwohner, Lage,
Herrscher) und nur, wenn das Wiki dort einen Wert hat. Ein Feld, das wir gesetzt haben, während das
Wiki leer ist, wird braun, hat aber kein ↺.

### Nebenbefunde

- 💣 **Die Orts-Editor-Liste gibt das Innerorts-Urteil für „Fehlt"-Zeilen nicht heraus.**
  `avesmapsWikiSettlementEditorList` rechnet `$regScope` und schreibt es nicht in die Zeile. Alle
  3.653 gelten im Browser als „außerorts" (`settlementRowScope` fällt darauf zurück), der Filter
  „Lage" greift auf dem Reiter „Fehlt" nicht. Die Panel-Liste (`…ListLocations`) hat das Feld.
- 🪤 **Der Kasten „Wiki-Ort" zeigt „Ortsgröße: gebaeude"** — den rohen Schlüssel. Das Formular
  darüber übersetzt ihn, der Kasten nicht.
- ⚠️ Die Kartensuche liest die gespeicherten Stätten aus `settlement_place` nicht; nur die Infobox
  tut es. Nicht Teil dieses Umbaus, beim Bau aber im Blick behalten.

## 2 · Die Ablage: eine Override-Zeile je Wiki-Seite

Neue Tabelle `settlement_wiki_override`, dasselbe Muster wie `metadata_overrides_json` beim
Territorium (`set_field_override` / `clear_field_override`, `html/wiki-sync-monitor.html`):

```
settlement_wiki_override (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  normalized_key  VARCHAR(255) NOT NULL UNIQUE,  -- avesmapsWikiSyncCreateMatchKey(title)
  title           VARCHAR(255) NOT NULL,          -- zur Anzeige und Diagnose
  overrides_json  JSON NOT NULL,
  updated_by      INT NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
)
```

Schlüssel in `overrides_json`:

| Schlüssel | Wert | gilt für |
|---|---|---|
| `name` | Text, 1–160 Zeichen | nicht platziert |
| `settlement_class` | ein Schlüssel aus der Typ-Auswahl des Editors | nicht platziert |
| `is_ruined` | `true`/`false` | nicht platziert |
| `is_hidden` | `true`/`false` | nicht platziert |
| `place_scope` | `inside` / `outside` | **beide** |
| `place_settlement_public_id` | `public_id` einer platzierten Siedlung | **beide**, nur bei `inside` |

🔴 **Der Schlüssel ist `normalized_key`**, dieselbe Rechnung, mit der `wiki_sync_pages` schreibt
und beide Listen doppelte Seiten erkennen. Nicht der Titel roh, nicht der Name.

🔴 **Wert gleich Wiki ⇒ der Schlüssel fällt weg**, leeres Objekt ⇒ die Zeile fällt weg. Es bleibt
nichts Braunes stehen, das dasselbe sagt wie das Wiki (Territoriums-Regel `sameBf → clear`).

🔴 **„Gehört zu" merkt sich die `public_id`, nie den Namen** — eine umbenannte Stadt verlöre sonst
alle ihre Stätten, lautlos. Dieselbe Regel steht in `settlement_place`.

🔴 **Innerorts und „Gehört zu" bleiben IMMER an der Wiki-Seite**, auch nach dem Platzieren: sie
beschreiben das Standort-Feld dieser Seite, und alle Leser gehen ohnehin über den Wiki-Titel. Name,
Typ, Ruine und Verborgen wandern beim Platzieren in die Kartenzeile (§5), sonst gäbe es zwei Ablagen
für denselben Ort.

⚠️ **Warum nicht `settlement_place`.** Die Tabelle kann „liegt in X" sagen, nie „liegt nirgends";
ihr Schlüssel ist (Stadt, Name), nicht die Wiki-Seite; Ruine, Typ und Verborgen haben dort keinen
Platz. Sie bleibt, was sie ist: die Ablage für Stätten **ohne** Wiki-Seite (heute der Garetien-Import).

💣 **DDL nur im Schreibweg**, und vor jeder Transaktion (AGENTS.md §10: DDL committet in MySQL
implizit). Leser fallen bei fehlender Tabelle still auf „keine Overrides" zurück — die Karte darf
daran nie ausfallen, dieselbe Regel wie bei `settlement_place`.

⚠️ Wird eine Seite im Wiki umbenannt, verwaist ihr Eintrag. Das hat das Territorium genauso; ein
Waisenbericht ist nicht Teil dieses Umbaus.

## 3 · Der eine Eingang für alle Leser

Das Innerorts-Urteil wird heute an mehreren Stellen je für sich gerechnet. Ein Override, der nur
einen Teil erreicht, ist schlimmer als keiner. Deshalb **eine reine Funktion**:

```
avesmapsSettlementWikiEffektiv(array $registerZeile, ?array $override, array $scopeIndex,
                               array $siedlungenNachPublicId): array
```

Sie liefert je Feld den **wirksamen** Wert, den **Wiki-Wert** und ob ein Override greift:
`name` · `settlement_class` · `is_ruined` · `is_hidden` · `place_scope` · `place_settlement` ·
`place_settlement_public_id`, jeweils mit `_wiki`, dazu `override_felder`.

Regeln, in dieser Reihenfolge:

1. `place_scope` = Override, sonst Wiki-Urteil. `unklar` ist kein wählbarer Wert, nur ein Wiki-Stand.
2. Bei `inside` mit Override-`public_id`: Name der Stadt **aus der Kartenzeile** dieser `public_id`.
   Gibt es sie nicht mehr, **gilt das Wiki-Urteil ganz** (Scope und Stadt) — und die Editor-Liste
   meldet `place_settlement_verwaist`, damit der Editor es sieht.
3. Innerorts gilt nur für **Bauwerksklassen** (`avesmapsIstBauwerksklasse`), gemessen an der
   **wirksamen** Klasse — „eine Stadt liegt nicht in einer Stadt".
4. Der Name ist **nur Anzeige**. Doppelungsschutz (`$seen`), „liegt schon auf der Karte?"
   (`avesmapsIsTitleOnMap`) und der Schlüssel der Override-Zeile rechnen mit dem Wiki-Titel.
   Rechneten sie mit dem Override, erschiene eine umbenannte Seite ein zweites Mal.

Die Leser, die ihn rufen:

| Leser | Stelle | Was der Override dort bewirkt |
|---|---|---|
| Orts-Editor-Liste | `avesmapsWikiSettlementEditorList` | Zeile, Filter „Lage", Formularwerte (behebt den Nebenbefund) |
| Panel-Liste | `avesmapsWikiSettlementListLocations` | derselbe Filter — beide Fenster geben dieselbe Antwort |
| Kartensuche „X in Stadt" | `avesmapsBuildInSettlementSearchEntries` | Treffer springt zur richtigen Stadt oder entfällt; sucht Override-Name **und** Wiki-Titel |
| Zeile „Stätten" der Stadt | `avesmapsBuildInSettlementPlaceList` | richtige Stadt, angezeigter Name; **verborgene nicht platzierte Stätte fehlt** (Entscheid 4) |
| Suche „nicht auf der Karte" | `avesmapsBuildOffmapSearchEntries` | ein auf „außerorts" gesetztes Bauwerk erscheint dort statt als Innerorts-Treffer |

🔴 **Bewusst außen vor:** Wege (`paths.php`) — nicht bestellt. Die Stadtteil-Weiterleitungen
(`wiki_stadtteil_weiterleitung_staging`) — sie stehen nicht in `wiki_sync_pages`, also nicht im
Editor, und sollen dort auch nicht hin (Stand 14.09.2026). Verborgene **platzierte** Bauwerke in
der Stätten-Zeile — Entscheid 4 galt den nicht platzierten.

💣 **Karten-ETag.** Die Stätten-Zeile reist in der Kartennutzlast, und ein Override bewegt kein
Kartenobjekt. Ohne eigenen Stempel bekäme jeder warme Browser sein 304. Der Stempel
(`COUNT|MAX(updated_at)` der Tabelle) wird an den bestehenden `$placesStamp` gehängt; ein leerer
Stempel lässt den Keim zeichengleich (dieselbe Zurückhaltung wie dort).

⚠️ Kosten: eine zusätzliche Abfrage je Listen-, Such- und Nutzlastaufbau, nie je Zeile (AGENTS.md
§9). Die `public_id → Name`-Tafel entsteht aus den `map_features`-Zeilen, die jeder dieser Leser
ohnehin schon hat.

## 4 · Schreibwege

Zwei Aktionen auf `api/edit/wiki/settlements.php`, Fähigkeit `edit`, **gleich benannt wie beim
Territorium**:

- `set_field_override` `{title, fields: {…}}` — setzt mehrere Felder in einem Zug; ein Wert gleich
  dem Wiki-Stand entfernt den Schlüssel. Validiert: Klasse aus der Typ-Liste, Name nicht leer,
  `place_scope ∈ {inside, outside}`, bei `inside` eine `public_id` einer aktiven Siedlung
  (`AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES`), bei `outside` fällt die `public_id` weg.
- `clear_field_override` `{title, fields: [...]}` — nimmt Felder zurück; bei `place_scope` immer
  zusammen mit `place_settlement_public_id`.

Welche Oberfläche welchen Weg nimmt:

| | Name · Typ · Ruine · Verborgen | Innerorts · Gehört zu |
|---|---|---|
| nicht platziert | `set_field_override` über „Speichern"; ↺ füllt nur das Formular | `set_field_override` **sofort**; ↺ = `clear_field_override` sofort |
| platziert | wie heute `update_point` (Herkunft via `field_origins`); **Ruine bekommt ein ↺** | wie nicht platziert, Schlüssel ist der Titel des zugewiesenen Artikels |

⚠️ Ein platzierter Ort **ohne** Wiki-Zuweisung hat keinen Standort und bekommt die zwei Zeilen nicht.

## 5 · Platzieren: die Overrides wandern mit

Platziert wird heute über „Ort anlegen" auf der Karte: `?action=preview` liest die Seite,
`create_point` legt den Punkt an, `assign_to` schreibt das Nest. Daneben verbindet `bulk_connect`
bestehende Punkte. **Beide Schreiber des Nests** (`avesmapsWikiSettlementAssignTo`,
`avesmapsWikiSettlementBulkConnect`) rufen denselben Helfer:

1. Für jedes Feld aus `name`, `settlement_class`, `is_ruined`, `is_hidden` mit Override: trägt die
   Kartenzeile noch den **Wiki-Wert** (oder nichts), wird der Override-Wert geschrieben und bekommt
   die Herkunft `manual`. Trägt sie einen **eigenen** Wert, gewinnt der — er ist die jüngere
   Handlung am konkreten Objekt.
2. Danach fallen diese vier Schlüssel aus der Override-Zeile. `place_scope` und
   `place_settlement_public_id` bleiben (§2).

`?action=preview` liefert die Overrides mit, damit der Anlegedialog Name, Typ, Ruine und Verborgen
schon vorbelegt. 🔧 Im Bauplan am Anlegedialog nachmessen: welche seiner Felder die Vorschau heute
tatsächlich übernimmt.

💣 Ein Helfer, zwei Aufrufer — eine Regel, die einen von zwei Schreibern bindet, ist keine Regel.

## 6 · Oberfläche (Orts-Editor, rechte Spalte)

Nach dem Mockup, §1 und §2:

- **Nicht platziert:** dieselbe Gliederung wie platziert — Identität (Name als Eingabe, Typ als
  Auswahl, Kontinent, Wiki-Link) · Eigenschaften (Ruine, Verborgen) · Speicherleiste ·
  „Lage & Zugehörigkeit" (Innerorts, Gehört zu). Kein Wappen, keine Bilder, keine Quellen, **kein
  Kasten „Wiki-Ort"** (Entscheid 6). Der Satz unten wird: „Nur im Wiki — noch nicht auf der Karte.
  Was du hier änderst, gilt für Liste, Suche und die Stätten der Stadt und wandert beim Platzieren
  mit."
- **Platziert:** „Lage & Zugehörigkeit" bekommt unter dem Territorium die zwei neuen Zeilen.
- **„Gehört zu"** sucht nur unter Siedlungen, die auf der Karte liegen (aus der schon geladenen
  Liste, keine neue Anfrage), und ist nur bei „innerorts" bedienbar.
- Der Abschnittskopf „Lage & Zugehörigkeit" trägt rechts **„Speichert sofort"** (Entscheid 5).
- ⚠️ **Sichtbare Änderung am bestehenden Formular:** die Haken Nodix, Ruine, Verborgen bekommen ihre
  Beschriftung links wie jede andere Zeile (`.dt-grid--wiki`, Owner-Regel „50 % | 50 %"), weil der
  durchgestrichene Wiki-Stand in der linken Hälfte steht.
- **Liste:** die zweite Zeile einer nicht platzierten Bauwerkszeile wird
  „○ nur Wiki · innerorts in Gareth" bzw. „○ nur Wiki · außerorts"; der Filter „Lage" greift auf „Fehlt".

### Das ↺ (Entscheid 3)

- `avesmapsWikiFeldStand` bekommt eine optionale Liste **`leerbar`**: für diese Felder gilt
  zusätzlich `neu === "" && alt !== "" && herkunft === "manual"` als Abweichung, das ↺ leert dann
  das Feld. Die Anzeige des Wiki-Stands ist dort „(leer)".
- Der Ort übergibt `einwohner`, `lage`, `oberhaupt`. **Nie** Name (Pflichtfeld) und **nie** eine
  Auswahl (Typ) — ein leerer Schlüssel ist kein gültiger Wert.
- 🔴 **Herkunft unbekannt + Wiki leer bleibt still.** Werte von vor dem 17.08.2026 tragen keine
  Herkunft; ein ↺ dort leerte fremde Handarbeit mit einem Klick.
- 🔴 **Ohne `leerbar` ändert sich nichts** — Literatur, Landschaft, Beschriftung und Weg rufen
  dieselbe Funktion und bleiben, wie sie sind. Sie einzuschalten ist je eine Zeile; bestellt ist es
  für den Ort.
- **Ruine** läuft durch dieselbe Funktion mit eigener Feldliste; Werte als `"ja"`/`"nein"`, damit
  „nein" ein Wert ist und nicht als leer gilt. Wiki-Stand ist `wiki_sync_pages.is_ruined`, von der
  Liste mitgeliefert (keine Anfrage je Klick).
- Innerorts und „Gehört zu" zeigen ihren Wiki-Stand in derselben Form; das ↺ an „Innerorts" nimmt
  beide zurück.

### Der Kasten „Wiki-Ort" (Nebenbefund)

Die Zeile „Ortsgröße" zeigt die Beschriftung aus der Typ-Liste statt des Schlüssels. Nur die
Anzeige — verglichen und gesynct wird weiter der Schlüssel.

## 7 · Reihenfolge — sichtbar heißt einzeln live (AGENTS.md §9)

1. Liste: Innerorts-Urteil für „Fehlt"-Zeilen herausgeben, zweite Zeile, Filter „Lage" (sichtbar).
2. ↺ mit `leerbar` am Ort (sichtbar).
3. Ablage + Eingang + Leser + ETag-Stempel (unsichtbar, vollständig getestet).
4. Nicht platzierter Ort: Formular, Speichern, ↺ (sichtbar).
5. „Lage & Zugehörigkeit": Innerorts und Gehört zu, platziert und nicht platziert (sichtbar).
6. Platzieren: Übernahme in `assign_to`/`bulk_connect`, Vorschau (unsichtbar bis zum Anlegen).
7. Kasten „Wiki-Ort": Beschriftung der Ortsgröße (sichtbar, klein).

## 8 · Prüfung

- Die Eingangsfunktion **ausgeführt**, nicht gelesen: jede Regel aus §3 als Fall, samt verwaister
  `public_id` und wirksamer Nicht-Bauwerksklasse.
- Jeder Leser aus §3 wird mit einer Override-Zeile **gefahren** und muss die Wirkung zeigen — ein
  Test, der nur „die Funktion wird gerufen" per Regex prüft, ist hier wertlos (Lehre vom 03.09.2026).
- Schreibwege gegen SQLite; kein Upsert-Syntax, der nur auf einer Datenbank läuft.
- Übernahme beim Platzieren für **beide** Schreiber.
- ETag: ändert sich mit einer Override-Zeile, bleibt bei leerem Stempel zeichengleich.
- `avesmapsWikiFeldStand`: `leerbar` greift nur bei `manual`; ohne `leerbar` bytegleiches Ergebnis
  für alle bestehenden Aufrufer.
- Mutationsproben gegen die tragenden Zeilen, dann das **ganze** Testfeld nach dem Muster des
  Workflows.

**Abnahme ist Ablauf:** eine „Fehlt"-Zeile anklicken, Name ändern, speichern, Liste zeigt den neuen
Namen · ↺ am Namen, speichern, alter Name zurück · Innerorts auf „außerorts", Stadt-Infobox öffnen,
Stätte ist weg, Suche findet sie ohne „in Stadt" · „Gehört zu" auf eine andere Stadt, Suchtreffer
springt dorthin · Verborgen an, Stätten-Zeile ohne sie, Suche per Name mit ihr · Ort platzieren,
Name und Typ kommen mit, Innerorts bleibt · an einem platzierten Ort Herrscher selbst setzen, Wiki
leer, ↺ erscheint und leert.

## 9 · Offen, bewusst nicht in diesem Umbau

- Innerorts-Override für **Wege**.
- „Wiki leer"-↺ für Literatur, Landschaft, Beschriftung, Weg (je eine Zeile, nicht bestellt).
- **Protokoll** der Override-Änderungen im Fenster „Änderungen" — die Objektart gibt es dort nicht.
- Waisenbericht für Override-Zeilen, deren Wiki-Seite umbenannt wurde.
- Kartensuche liest `settlement_place` nicht (Nebenbefund).
- Verborgene **platzierte** Bauwerke in der Stätten-Zeile.
