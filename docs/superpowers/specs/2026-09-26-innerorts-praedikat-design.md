# Innerorts als eigenes Prädikat — Entwurf

**Stand:** 26.09.2026 · **Mockup:** `docs/innerorts-mockup.html` · Vorgänger: Stätten löschen und umhängen
(`docs/superpowers/specs/2026-09-26-staetten-loeschen-umhaengen-design.md`, live `6ac6b381f`).

## 1. Owner-Entscheide (26.09.2026)

1. **„Innerorts ist ein unabhängiges Prädikat"** = „gehört zu Stadt X", unabhängig davon, ob das Objekt einen
   Punkt auf der Karte hat. Suche und Wegfindung springen auf den Punkt, wenn es einen gibt, sonst auf die Stadt.
   🔴 Die Regel „auf der Karte ⇒ nicht innerorts" ist gestrichen und wird nie gebaut.
2. **Variante B, präzisiert vom Owner:** *„initial [aus dem Wiki]. so war es bisher (Innerorts war für uns nie
   editierbar). wenn es einen manuellen override gibt, gilt der override (wie bei anderen eigenschaften kann ich den
   original-ort aber wiederherstellen)"* — also das **Wiki-Override-Muster**: Wert aus dem Wiki, von Hand
   überschreibbar, mit `↺` zurück auf den Wiki-Stand. Und: *„stadtviertel behalten immer ihre quelle/ihren
   wiki-eintrag"* — beim Von-der-Karte-Nehmen bleibt die Wiki-Zuweisung am Objekt.
3. Owner, wörtlich: *„stadtviertel und gebäude können die eigenschaft ‚innerorts' haben … im editor müsste also bei
   Ortsgröße ‚Stadtviertel' oder ‚Gebäude/Stätte' die Option ‚Innerorts' auftauchen, wo ich dann die stadt
   festlegen kann"* — in „Ort bearbeiten" **und** im Ortseditor.
4. *„wenn es gelöscht wird, soll es automatisch wieder zur stätte von gareth werden und wenn es jemand wieder
   platziert wieder raus"* — umgesetzt als **zwei Kacheln** (Owner: „zwei einträge"): **„Von der Karte nehmen"**
   (bleibt Stätte) und **„Ort löschen"** (ganz weg).
5. Anlass: **Neu-Gareth** — ein Stadtviertel-Punkt (`b331154a-…`), heute ohne Wiki-Zuweisung und ohne
   Ortszugehörigkeit, obwohl der Artikel eindeutig ist (`{{Register Siedlung}}`, „ist ein Stadtteil [[Gareth]]s").
   Owner: *„eigentlich sollte wiki-sync das auch automatisch zuweisen"* → Schritt 3 (§7a).
6. *„du kannst gerne ‚Stätte zum Kartenpunkt' machen"* → §4.3. *„das [⊕] brauchen wir"* → §6.2.

## 2. Begriffe und Bestand (gemessen 26.09.2026, Kartennutzlast)

| | Anzahl | trägt heute eine Ortszugehörigkeit? |
|---|---|---|
| Kartenpunkte `gebaeude` + `stadtviertel` | 1258 (davon 1 Stadtviertel: Neu-Gareth) | **keiner** |
| davon mit Wiki-Zuweisung | 161 | nur indirekt: 32 mit Wiki-Standort/-Lage |
| gespeicherte Stätten (`settlement_place`) | ≈ 273 | ja, `settlement_public_id` |
| aus dem Wiki abgeleitete Stätten | ≈ 3544 | ja, per Scope-Klassifikator |

⚠️ Der Filter „Lage: innerorts/außerorts" im Ortseditor ist **kein** Feld am Punkt, sondern eine Text-Heuristik
über den Wiki-Standort (`api/_internal/wiki/place-scope.php`). Er bleibt, wie er ist.

## 3. Datenmodell — ein Objekt, eine Ablage

Ein Punkt der Ortsgröße `gebaeude` oder `stadtviertel` trägt in `properties_json`:

```json
"innerorts": { "ort": "<public_id der Stadt>" }
"field_origins": { "innerorts": "wiki" | "manual" }
```

- **Fehlt der Schlüssel** → der Punkt gehört zu keinem Ort (Ausgangszustand aller 1258, bis der Admin-Lauf §5 den
  Wiki-Stand einträgt).
- **Herkunft** über das vorhandene `field_origins` (Wiki-Override-Muster, `api/_internal/map/field-origins.php`):
  `wiki` = aus dem Artikel übernommen und wird mit ihm nachgezogen, `manual` = von Hand, gilt, bis jemand `↺` drückt.
- **Nur diese zwei Ortsgrößen.** Wechselt die Ortsgröße auf Dorf … Metropole, wird `innerorts` beim Speichern
  entfernt (dieselbe Regel wie bei „Art", die nur Gebäude trägt).
- **Die Stadt ist ein Kartenpunkt der Siedlungsklassen Dorf … Metropole**, nie der Punkt selbst. Der Name wird
  beim Lesen aus dem Stadtpunkt geholt, nicht mitgespeichert (umbenannte Städte behalten ihre Stätten).
- **Kein zweiter Ablageort.** Wird ein Punkt „von der Karte genommen", bleibt er **derselbe Datensatz**
  (`is_active = 0`, Position, Wiki-Zuweisung und Quellen unverändert) und trägt zusätzlich
  `"innerorts": { "ort": "…", "von_der_karte": true }`. Es entsteht **keine** Kopie in `settlement_place` —
  zwei Kopien würden auseinanderlaufen, und „Rückgängig" müsste beide zurückholen.
- `settlement_place` bleibt für die Stätten ohne je eine Kartenposition (Garetien-Import). Zwei Quellen für die
  Stättenliste also: gespeicherte Stätten **und** innerorts-Punkte.

## 4. Die Gesten

### 4.1 Kachelband der Infobox (nur Editoren)

Heute: `Ort verschieben ✥ · Bearbeiten ⚙ · Ort löschen ✕`. **Neu**, nur bei einem Punkt mit `innerorts`:

| Kachel | Zeichen | Wirkung |
|---|---|---|
| **Von der Karte nehmen** | `⊖` | Rückfrage „„Neu-Gareth“ von der Karte nehmen? Es bleibt als Stätte von Gareth erhalten und kann dort wieder auf die Karte gesetzt werden." → `is_active = 0`, `innerorts.von_der_karte = true`. Meldung: „„Neu-Gareth“ ist jetzt Stätte von Gareth." |
| Ort löschen | `✕` | wie bisher (`is_active = 0`, **ohne** Merker) — der Punkt ist dann auch keine Stätte. Die Rückfrage nennt es: „„Neu-Gareth“ wirklich löschen? Es wird auch nicht als Stätte von Gareth geführt." |

- Die neue Kachel steht **vor** „Ort löschen" und ist **nicht** rot (sie ist umkehrbar).
- 🔴 **`⊖` „von der Karte nehmen" und `⊕` „auf der Karte zeigen"** (das Fadenkreuz des Änderungsverlaufs) sind ein Paar gleicher Breite. Gemessen im Browser: `○` misst zwar 9,7 px, zeichnet aber winzig (dieselbe Falle wie `⌖`); `⊖`/`⊕` je 16,3 px. `●` für „Auf die Karte setzen" ist im Kartenmenü schon „Neuer Ort".
- Server: neue Aktion `take_off_map` in `api/edit/map/features.php` (neben `delete_feature`), eigene
  Bibliotheksfunktion; sie verweigert, wenn der Punkt kein `innerorts` trägt, und läuft wie das Löschen durch
  Sperre, Kraftlinien-Riegel und Protokoll (`map_audit_log`, Aktion `take_off_map`, mit Vorher-Schnappschuss —
  damit wirkt „Rückgängig" im Änderungsverlauf ohne Sonderfall).

### 4.2 Auf die Karte setzen

- Im Stätten-Kasten (siehe §6) trägt ein von der Karte genommener Punkt den Knopf **`●` Auf die Karte setzen**.
- Wirkung: `is_active = 1`, Merker `von_der_karte` weg, **an der alten Position** (die Zeile hat sie nie
  verloren). Danach fliegt die Karte hin; verschieben geht wie immer mit „Ort verschieben".
  Im Ortseditor-iframe fliegt die Karte des Elternfensters, falls erreichbar; sonst nur die Meldung.
- Server: Aktion `put_on_map` — nur für Punkte mit `von_der_karte = true`; Protokoll wie oben.
- Gespeicherte Stätten ohne Position (Garetien): eigener Weg, §4.3.

### 4.3 Stätte zum Kartenpunkt (gespeicherte Stätten ohne Position)

- Im Stätten-Kasten bekommt eine gespeicherte Stätte (Garetien-Import) ebenfalls **`●` Auf die Karte setzen**.
- Wirkung (Server, eine Transaktion): neuer Kartenpunkt mit Name, Ortsgröße `gebaeude` (Stadtviertel, wenn die
  Art „Stadtviertel“ ist), `place_kind` aus der Art, Wiki-Adresse, `innerorts.ort` = ihre Stadt
  (Herkunft `manual`), Position = **Punkt der Stadt, leicht versetzt**; die Quellen wandern mit
  (`feature_sources`: `settlement_place` → `settlement` mit der neuen Kennung, Dubletten per DELETE, portabel wie
  bei `avesmapsEigenerKnotenBindungSetzen`); die Stätte wird deaktiviert. Protokoll `create_point` samt Verweis.
- Danach fliegt die Karte hin und startet „Ort verschieben" für den neuen Punkt — der Editor zieht ihn an die
  richtige Stelle.
- Rückweg: „Von der Karte nehmen" (§4.1) — ab dann ist es ein innerorts-Punkt, keine gespeicherte Stätte mehr.

### 4.4 Rückgängig

„Rückgängig" im Änderungsverlauf stellt Zeile und `properties_json` aus dem Vorher-Schnappschuss wieder her
(`avesmapsUndoAuditChange`) — für `take_off_map` und `put_on_map` gilt damit dieselbe Mechanik wie für das
Löschen, ohne zweite Ablage, die mitgenommen werden müsste.

## 5. Das Feld „Innerorts" — Wiki-Stand, Override, ↺

- **Wo:** „Ort bearbeiten" (`index.html`, `#location-edit-dialog`) direkt unter Ortsgröße/Art; Ortseditor
  (`html/wiki-sync-settlement-editor.html`) im Raster „Identität" unter Ortsgröße.
- **Sichtbar nur bei Ortsgröße Stadtviertel oder Besondere Bauwerke/Stätten**; beim Wechsel der Ortsgröße
  sofort ein-/ausgeblendet (dieselbe Stelle wie `syncLocationEditPlaceKindAvailability`).
- **Der Wiki-Stand** ist die Stadt, die der zugewiesene Artikel nennt: „Stadtteil von X" (Kategorie bzw.
  Stadtteil-Weiterleitung), sonst der Standort/die Lage der Infobox, wenn der Scope-Klassifikator ihn eindeutig
  **in** eine Stadt auf der Karte legt (`inside`). Welches Feld der Wiki-Datensatz dafür trägt, legt der Bauplan
  am Code fest (bei Neu-Gareth: Register-Eintrag, Text „ein Stadtteil [[Gareth]]s").
- **Anzeige — genau das Override-Muster der übrigen Wiki-Felder** (`.k.ovr`, `.wiki-alt`, `.dt-old`, `.dt-reset`,
  `js/ui/wiki-feld-herkunft.js`):
  - Wert aus dem Wiki: „**Gareth** · Metropole", Beschriftung normal.
  - Von Hand überschrieben: Beschriftung braun, neuer Wert, daneben der Wiki-Stand durchgestrichen und `↺`
    („Auf Wiki-Stand zurücksetzen").
  - Ändern: Ortssuche wie beim Umhängen (`action: orte`); `✕` löst die Zugehörigkeit (= Override „keiner").
- **Schreiber** (alle über denselben Stempler `avesmapsFieldOriginsStempeln`, keine Abschrift):
  1. Speichern im Editor → `manual` (bzw. `wiki`, wenn per `↺` der Wiki-Stand übernommen wurde).
  2. Wiki-Zuweisung eines Artikels (Hand oder WikiSync) → Wiki-Stand setzen, **außer** die Herkunft ist `manual`.
  3. Admin-Lauf `innerorts_aus_wiki` für den Bestand (Trockenlauf als Vorgabe, gedeckelt; überspringt `manual`).
- 🔴 **Gespeichert ist, was gilt** — auch der Wiki-Stand steht im Feld. Kein Leser (Nutzlast, Suche, Wegfindung,
  Löschen) rechnet ihn zur Laufzeit nach; nur die Schreiber lesen den Artikel.

## 6. Die Stättenliste

### 6.1 Kartennutzlast (`in_settlement_places`)

Neue dritte Quelle: **aktive und von der Karte genommene innerorts-Punkte**. Jeder Eintrag bekommt zwei Felder:

| Feld | Bedeutung |
|---|---|
| `public_id` | nur bei innerorts-Punkten (die anderen haben keinen Kartenbezug) |
| `auf_der_karte` | `true` = aktiver Punkt (Sprung möglich), sonst fehlt es |

- Ein **gelöschter** Punkt (ohne Merker) erscheint nicht.
- 🔴 **Ein Objekt, ein Eintrag:** eine aus dem Wiki abgeleitete Stätte, deren Artikel einem innerorts-Punkt
  derselben Stadt zugewiesen ist, fällt zugunsten des Punkts heraus (die Hilfen
  `avesmapsInnerortsArtikelSchluessel/…KartenArtikel/…OhneKartenpunkte` stehen dafür bereit — sie filtern hier die
  **Ableitung**, nie den Punkt).
- `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` + 1 (Wertänderung der Nutzlast). Das Setzen/Lösen von `innerorts` und
  beide Gesten schreiben `map_features` und drehen damit `map_revision` ohnehin.

### 6.2 Infobox der Stadt

Die Zeile „Stätten" bleibt, wie sie ist; Einträge mit `auf_der_karte` bekommen hinter dem Namen ein **`⊕`**
(dasselbe Fadenkreuz wie im Änderungsverlauf), das auf den Punkt fliegt und seine Infobox öffnet. Das ist die
einzige sichtbare Änderung für Besucher.

### 6.3 Stätten-Kasten (Editor)

Zeigt künftig drei Sorten — dieselbe Zeile (`.avm-row`), andere Knöpfe:

| Sorte | Zeile 2 | Knöpfe |
|---|---|---|
| innerorts-Punkt **auf der Karte** | „Stadtviertel · auf der Karte" + `⊕` | `⇄` (Stadt ändern) |
| innerorts-Punkt **von der Karte genommen** | „Stadtviertel · nicht auf der Karte" | `●` Auf die Karte setzen · `⇄` · `✕` (endgültig löschen: Merker weg, bleibt gelöscht) |
| gespeicherte Stätte | Link „garetien.de ↗" | `●` (§4.3) · `⇄` · `✕` |

- `⇄` bei Punkten setzt `innerorts.ort` um (dieselbe Falte, dieselbe Ortssuche).
- Ein Punkt auf der Karte hat kein `✕` hier — gelöscht wird auf der Karte, wo man sieht, was man löscht.
- Endpunkt `api/edit/map/settlement-places.php`: `list` liefert die Punkte mit `art: "punkt"`; `move`/`delete`
  unterscheiden an der Kennung, ob eine Stätte oder ein Punkt gemeint ist; neue Aktion `put_on_map` delegiert an
  denselben Server-Weg wie §4.2.

## 7. Suche und Wegfindung

- **Suche:** ein aktiver innerorts-Punkt ist ein normaler Kartentreffer (wie heute) mit Zusatz „in Gareth"; ein von
  der Karte genommener erscheint als Innerorts-Treffer „Neu-Gareth in Gareth · nicht auf der Karte" und springt
  auf die Stadt (vorhandene Bauform `kind: in_settlement`). Doppelte Treffer (Ableitung + Punkt) fallen wie in §6.1.
- **Wegfindung:** die Wegpunkt-Vorschläge lesen schon `in_settlement_places` und routen Innerorts-Einträge zur
  Stadt; ein aktiver Punkt ist ein normaler Wegpunkt. Durch §6.1 funktioniert beides ohne eigenen Umbau — der
  Plan prüft es nur (heute filtert die Liste Innerorts-Einträge mit gleichem Namen wie ein Kartenort heraus).

## 7a. WikiSync weist Stadtviertel und Bauwerke ihrem Artikel zu (Schritt 3)

Owner: *„eigentlich sollte wiki-sync das auch automatisch zuweisen"*. Ein Stadtviertel-/Bauwerk-Punkt ohne
Zuweisung bekommt den Artikel, wenn **Name und Stadt** eindeutig zusammenpassen (Punkt „Neu-Gareth" nahe Gareth ↔
Artikel „Neu-Gareth", Stadtteil von Gareth). Name allein genügt nicht (1254 Bauwerke, viele Namen mehrfach).
Vor dem Bau messen, wie viele Punkte so eindeutig finden; Ausführung über die Übernahme-Vorschau des Syncs
(zeigen, dann anhaken). Mit der Zuweisung schreibt Schreiber 2 (§5) den Wiki-Stand von „Innerorts".

## 8. Reihenfolge

1. **Schritt 1:** Feld „Innerorts" mit Wiki-Stand/Override/↺, Admin-Lauf, Kacheln „Von der Karte nehmen" /
   „Ort löschen", „Auf die Karte setzen", Stättenliste mit `⊕`, Stätten-Kasten mit drei Sorten, Suche.
2. **Schritt 2:** Stätte zum Kartenpunkt (§4.3).
3. **Schritt 3:** WikiSync-Zuweisung (§7a).

Jeder Schritt geht einzeln live.

## 9. Bewusst NICHT

- Keine automatische Ortszugehörigkeit aus der Lage auf der Karte (Nähe) — ein Mensch entscheidet (Owner: B).
- Kein Laufzeit-Nachrechnen des Wiki-Stands (§5) — er wird geschrieben, nicht gelesen.
- Der Filter „Lage" des Ortseditors bleibt unverändert.
- Kein `innerorts` für Dorf … Metropole.

## 10. Prüfung

- **PHP:** Feld schreiben/entfernen samt Zielprüfung; `take_off_map`/`put_on_map` (Riegel, Merker, Protokoll,
  Undo stellt beides zurück); Nutzlast-Bauer mit drei Quellen und der Dopplungsregel; Endpunkt der Stätten mit
  Punkten; Admin-Lauf Trockenlauf/scharf.
- **JS (ausgeführt):** Feld ein-/ausblenden je Ortsgröße, Vorschlag übernehmen, Kacheln nur bei `innerorts`,
  Stätten-Kasten drei Sorten, `⊕`-Sprung in der Infobox, Suchtreffer-Bauformen.
- **Live (Owner):** Neu-Gareth → (Wiki zuweisen, Innerorts zeigt Gareth aus dem Wiki) → Override und ↺ → → in Gareths Stätten mit `⊕` → „Von der Karte nehmen" → Suche
  springt auf Gareth → im Kasten `●` → wieder auf der Karte; „Rückgängig" im Änderungsverlauf je Schritt.
