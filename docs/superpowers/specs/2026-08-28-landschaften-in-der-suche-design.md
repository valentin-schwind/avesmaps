# Landschaften in der Suche — Entwurf

**Stand:** 2026-08-28 · **Status:** Entwurf, wartet auf eine Owner-Entscheidung (§3)
**Anlass:** Owner, wörtlich: „Ceälan die inselfläche wird nicht in der spotlightsuche gelistet.
die fläche hat kein label, sollte aber eigentlich in der suche auftauchen."

---

## 1. Der Befund

Eine Landschaft (`ecosystem_region`) ist **nirgends** ein Suchobjekt.

- **Client:** `buildSpotlightSearchEntries` (`js/ui/spotlight-search.js`) baut aus
  `locationMarkers`, `labelMarkers`, `regionPolygons` (Herrschaftsgebiete), Wegen und
  Kraftlinien. Keine Landschaft.
- **Server:** `api/app/map-search.php` führt neun Quellen — Siedlung, Label,
  Herrschaftsgebiet, Kraftlinie, Weg, Karte, Literatur, Vorkommen, „nicht auf der Karte".
  Das Wort `ecosystem` kommt in der Datei **nicht vor**.

Gefunden wird eine Landschaft deshalb ausschließlich über **ihre Beschriftung**. Ceälan hat
keine — der eine Treffer, der kommt, ist das gleichnamige Vulkan-*Label*, ein anderes Objekt
an einer anderen Stelle.

🪤 **Und eine Kleinigkeit, die täuscht:** `ecosystem_region.label_public_id` ist bei Ceälan
**nicht leer** — es zeigt auf ein Label, das im Kartenbestand nicht mehr existiert. Die Fläche
behauptet also eine Beschriftung, während `region_label_count` 0 sagt. Live sind **3** Flächen
in diesem Zustand. Das ist ein eigener, kleiner Aufräumpunkt, keine Ursache dieses Befunds.

---

## 2. Was gemessen wurde (live, 28.08.2026)

| | Anzahl |
|---|---|
| Landschaftsregionen mit mindestens einer Fläche | **1308** |
| davon mit Wiki-Schlüssel | 416 |
| davon mit einem echten (nicht automatisch vergebenen) Namen | 645 |
| davon ohne jede Beschriftung | 592 |
| **davon, deren Name auf KEINER ihrer Beschriftungen steht** | **28** |

🔴 **Die letzte Zeile ist die einzige, die zählt.** Die 592 ohne Beschriftung klingen groß, aber
**564** davon heißen `Wald-001`, `See-047`, `Fläche-021` — automatisch vergebene Namen, genau die
Kategorie, die der Owner bei den Wegen schon ausgeschlossen hat („Generik-Namen wie
`Reichsstrasse-4903`"). Und die 617 übrigen echt benannten sind längst auffindbar: ihr Name steht
auf einer ihrer Beschriftungen.

Übrig bleiben **28 Landschaften**, davon:

- **8 Klimabänder** („Polare Zone", „Boreale Zone", „Tropische Zone", …) — abgeleitete Bänder,
  keine gezeichneten Landschaften.
- **20 echte Landschaften**, 7 davon mit Wiki-Artikel: Finsterkamm · Nebelmoor · **Ceälan** ·
  Gorische Wüste · Obergorien · Fenn · Wacht · Bargenta · Mittelaventurien · …

Der Befund ist also klein und scharf umrissen — er ist **kein** Massenproblem.

---

## 3. 🔧 DIE EINE ENTSCHEIDUNG (Owner)

**Was soll in der Suche auftauchen?**

| | Menge | Preis |
|---|---|---|
| **A — nur mit Wiki-Artikel** | 7 | Kein neuer Riegel nötig, exakt die Wege-Regel. Aber „Bargenta" und „Mittelaventurien" bleiben unauffindbar. |
| **B — jede echt benannte Landschaft** ⭐ | 20 | Deckt den gemeldeten Fall und alle Geschwister. Braucht den Auto-Namen-Riegel serverseitig (§5). |
| **C — B plus die Klimabänder** | 28 | „Polare Zone" wird suchbar. Ein Band ist aber keine Landschaft, die man anfliegt — es zieht sich über den halben Kontinent. |

⭐ **Empfehlung: B.** Sie beantwortet die Meldung vollständig, ohne dass ein Klimaband als
Suchtreffer erscheint, den niemand sinnvoll anspringen kann.

---

## 4. Wo es gebaut wird

🔴 **Serverseitig, als achte Quelle in `api/app/map-search.php`** — nicht im Client.

Der Grund ist Daten, nicht Geschmack: Landschaftsflächen reisen **nicht** in der Kartennutzlast.
Sie liegen hinter `api/app/ecosystem-areas.php` und werden nur geladen, wenn die Landschaften-Ebene
aktiv ist (der Kommentar in `js/ui/spotlight-search-focus.js` sagt es zweimal). Ein Client-Bauer
fände sie also je nach Ansicht mal und mal nicht — dieselbe Fehlerklasse wie der flackernde
Vorkommen-Statuskreis, der genau deshalb serverseitig gerechnet wird (AGENTS.md §11).

Vorbild ist `offmap-search.php`: eine Datei, deren reiner Teil ohne Datenbank prüfbar ist, plus
ein Sammler. Der Abschnitt läuft durch `avesmapsCollectSearchSection` (Kappung an einer Stelle) mit
demselben Deckel wie die übrigen — **5**.

**Kosten:** eine Abfrage über `ecosystem_region` (1308 Zeilen), kein Join in die Geometrie.

---

## 5. 💣 Der Auto-Namen-Riegel — die einzige echte Falle

Bei Variante B muss der Server wissen, ob ein Name automatisch vergeben wurde. Der Zustand ist
**dreiwertig** und die Hälfte davon liegt schon serverseitig:

| Merker `properties_json.auto_name` | Bedeutung | wer weiß es heute |
|---|---|---|
| `true` | ausdrücklich automatisch | `avesmapsEcosystemRegionAutoName` (PHP) ✅ |
| `false` | ausdrücklich von Hand | dieselbe Funktion ✅ |
| fehlt (`null`) | nie entschieden → **am Namen ablesen** | **nur** `isEcosystemRegionAutoName` (JS) ❌ |

Der Rückfall ist das Problem: er lebt ausschließlich im Browser
(`js/map-features/map-features-ecosystem-naming.js`), und der Altbestand trägt den Merker
überwiegend nicht.

🔴 **Nicht abschreiben — ableiten.** Die JS-Regel prüft „Name == `<Artbezeichnung>-<Ziffern>`", und
die Artbezeichnung steht dem Server als `region_type_label` bereits zur Verfügung. Der Riegel ist
damit eine Regel über **vorhandene Daten**, keine importierte Wortliste:

```
auto  :=  auto_name === true
       || (auto_name === null  &&  name  ~  '^' || type_label || '-[0-9]+$')
```

⚠️ **Und ein Test hält beide Seiten gegeneinander** — dieselbe Vorsichtsmaßnahme wie bei
`avesmapsFoldToAscii` / `tools/wikidump/test-ascii-fold.php`: eine Liste von Namen, die beide
Umsetzungen gleich beantworten müssen. Ohne den ist es die zweite Wahrheit, vor der AGENTS.md §5
warnt.

⚠️ **Die sichere Richtung ist „lieber verstecken":** im Zweifel gilt ein Name als automatisch. Ein
fehlender Treffer ist ärgerlich, 564 Zeilen `Wald-001` in der Suche machen sie unbenutzbar.

---

## 6. Was ein Treffer tut

Die Maschinerie ist **schon da** und muss nicht erfunden werden:

- `api/app/ecosystem-areas.php` nimmt seit dem 14.08.2026 einen `?regions=`-Filter — genau für den
  Fall „ich habe eine Regions-ID und will ihre Flächen".
- `fetchSpotlightLandscapeAreasByRegion` und `ecosystemAreaLatLngs`
  (`js/ui/spotlight-search-focus.js`) holen und zeichnen sie bereits.

Ein Treffer der neuen Art (`kind: "landscape"`) bekommt also:

1. Fokus auf die Bounds der Flächen dieser Region (`focusSpotlightBounds`),
2. die Hervorhebung, die die Vorkommen-Treffer schon benutzen,
3. die Ansicht **Landschaften** — 🔴 sonst fliegt die Karte an eine Stelle, an der nichts zu sehen
   ist: in der Standardansicht ist die Ebene aus. Dasselbe tut `focusSpotlightLabel` bereits
   (`setSelectedMapLayerMode("deregraphic")`).

⚠️ **Und die Infobox:** ein Landschafts-Treffer sollte dasselbe Panel öffnen, das ein Klick auf die
Fläche öffnet (`avesmapsShowRegionInInfopanel` bzw. der Landschafts-Zweig). Wird das ausgelassen,
fliegt die Suche irgendwohin und sagt nichts — der Zustand, den `focusSpotlightLabel` heute für
Labels **ohne** Wiki-Zuweisung hat (siehe §8).

---

## 7. 💣 Weitere Fallen

- **Die Beschriftung bleibt ihr eigener Treffer.** Ein Label und seine Region sind zwei Objekte;
  wer sie zusammenlegt, verliert die Stelle, an der die Beschriftung steht. Doppelte Zeilen werden
  **nicht** dadurch vermieden, dass man Labels ausblendet, sondern dadurch, dass die neue Quelle nur
  liefert, was auf keiner ihrer Beschriftungen steht (§2, die 28).
- **`region_label_count` ist die verlässliche Zahl, `label_public_id` nicht** — drei Flächen zeigen
  ins Leere (§1).
- **Kein Namensvergleich mit Klammerzusätzen.** Die Frage lautet „heißt die Region so?", nicht
  „welcher Anflugpunkt ist gemeint?" — dieselbe Trennung wie beim Vorkommen-Statuskreis.
- **Der Deckel gehört in die Antwort.** Wie bei `truncated` in `ecosystem-areas.php`: eine gekappte
  Liste, die aussieht wie eine vollständige, ist schlimmer als eine kurze.

---

## 8. 🚩 Nebenbefund, nicht Teil dieses Entwurfs

`focusSpotlightLabel` öffnet das Infopanel **nur**, wenn das Label eine Wiki-Zuweisung hat
(`labelHasWikiRegion`). Live nachgestellt: der Suchtreffer „Ceälan · Vulkan" fliegt hin und lässt
das Panel auf dem vorigen Inhalt stehen. Der Kartenklick hat dieses Tor seit dem
Verborgene-Orte-Umbau nicht mehr — die beiden Wege sind auseinandergelaufen. Eigener Befund, eigene
Entscheidung.
