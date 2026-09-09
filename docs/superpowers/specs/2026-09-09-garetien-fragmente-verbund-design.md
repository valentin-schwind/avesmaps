# Fragmente zu einem Objekt zusammenlegen — Entwurf

**Stand:** 2026-09-09 · **Auftraggeber:** Owner · **Mockup:** `docs/garetien-fragmente-mockup.html`
**Vorgänger:** `docs/superpowers/specs/2026-09-06-garetien-importer-stage-design.md` (die Stage),
`…/2026-08-27-garetien-importer-fenster-auftrag.md` (das Fenster).
**Abbau-Vertrag gilt unverändert:** alles hier lebt in `js/review/review-garetien-*.js`,
`css/components/garetien-importer.css`, `api/_internal/import/` und dem `garetien`-Zweig von
`api/edit/wiki/sync-plan.php` — nichts außerhalb lernt die Staging-Tabellen kennen.

---

## 0 · Owner-Entscheide vom 09.09.2026

1. **Vorschlag + Bestätigung.** „Holen & Rechnen" ERKENNT die Verbünde und markiert sie;
   zusammengelegt wird auf der Stage, per Klick. Nicht automatisch beim Rechnen. ✅
2. **Gemischte Verbünde:** nur die erzeugenden Fragmente werden ein Objekt. Ein `deckt_sich`-Fragment
   bleibt, was es ist — eine Quelle am vorhandenen Objekt. Der Entscheid vom 31.08.2026 („es gibt
   neu oder nix — kein verändern, kein ersetzen") bleibt unangetastet. ✅
3. **Ein Klick, Name danach änderbar.** „Zusammenlegen" macht sofort ein Stage-Objekt mit dem
   Stammnamen; korrigiert wird im vorhandenen Namensfeld. Kein Bestätigungsfenster. ✅
4. **Ein Objekt, N Flächen** — keine harte Geometrie-Vereinigung. Owner: „Ja: ein Objekt,
   N Flächen". ✅
5. **Solange ein Objekt „offen" ist, bleiben Darstellung sowie Wiki & Quellen ausgeblendet.**
   Owner wörtlich: *„die sind alle auf der stage erst wichtig"*. ✅
6. **Mehr Struktur:** die Einzelansicht bekommt benannte Blöcke statt einer flachen Folge. ✅

---

## 1 · Ziel

Garetien.de liefert viele Objekte in Stücken: „Silker Hain 1, 2, 3, 4" ist **ein** Wald, nicht vier.
Der Importer soll solche Verbünde erkennen, sie auf Klick zu einem Objekt zusammenlegen und den
Vorgang so buchen, dass er fragmentweise rückgängig zu machen ist.

**Nicht-Ziel:** eine Polygon-Vereinigung im Importer (§10), eine neue Tabelle, ein neuer Endpunkt,
ein neuer `change_type`, ein Eingriff in `entity_key`.

---

## 2 · Die Messung

Grundlage: der Dump vom 08.09.2026, **Lauf 20 mit 8.349 Zeilen**. Gruppiert nach *Ebene + Typ +
Stamm*, Zieltyp aus `AVESMAPS_GARETIEN_TYP_MAP` — **nicht** aus der Ebene.

| Menge | Verbünde | Zeilen | Ergebnis |
|---|---:|---:|---|
| **rein erzeugend, mit Ordnungsmarke** | **41** | **115** | `region` 22 / `path` 19 → **74 Objekte weniger** |
| nur `deckt_sich` | 7 | 44 | nichts zusammenzulegen |
| gemischt | 8 | 31 | nur die 18 erzeugenden werden ein Objekt |
| Ziel `label` (Berggipfel) · `location` (Ortschaften) | **0** | 0 | gibt es nicht |

Größte Verbünde: `GfReichsforst 1–21` (17), `Reichsforst 1–15` (15), `Wald im Koschgebirge 1–15`
(15), `Gre 1–12` (12).

🔴 **Es gibt nichts hart zu vereinigen, und das ist gemessen.** Über alle 22 `region`-Verbünde:
**0 von 174** Fragmentpaaren berühren sich, überlappen oder teilen eine Ecke. Engster Randabstand
0,30 Meilen (Weissenborner Forst), Median 3,34, Maximum 23,23 (Gardelforst).

⚠️ **Das bestehende „Unterflächen verschmelzen" würde alle 22 ablehnen** — es antwortet in genau
diesem Fall „Diese Unterflächen berühren einander nicht — es gibt nichts zu verschmelzen."
(`map-features-ecosystem-geometry-ops.js`).

---

## 3 · Die Erkennung

Eine reine Funktion `avesmapsGaretienVerbuende(array $zeilen): array`, gerufen beim Planbau
**hinter** `avesmapsGaretienZeilenBenennen` — dort sind Artikel und Anzeige bereits entschieden,
und der Name ist das einzige Signal (§4).

| Regel | Begründung, am Bestand gemessen |
|---|---|
| Gruppiert wird nach **Ebene + Typ + Stamm** | ein Wald und ein Hügel gleichen Namens sind nie ein Verbund |
| **Mindestens ein Fragment** trägt eine Ordnungsmarke | wirft `A`, `B`, `C`, `Pfad` heraus — Wege, die wirklich so heißen |
| **Ziel `location` und `label` nie** — der Zieltyp kommt aus `AVESMAPS_GARETIEN_TYP_MAP`, nicht aus der Ebene | zwei Dörfer namens „Lilienhof" sind zwei Dörfer; ein Berggipfel ist ein Punkt. ⚠️ Entfernt am heutigen Bestand **0** Gruppen — die Ordnungsmarke schließt sie schon aus. Bleibt als Riegel für den Tag, an dem der Export „Lilienhof 1" liefert |
| Marken: `1` · `1a` · `Reichsforst1` (ohne Trenner) · `N/S/O/W/NO/…` · `Nord/Süd/Ost/West/Mitte` · `I–XV` · `(2)` | alle vier Formen kommen live vor |

💣 **Ein Fragment OHNE Marke gehört dazu, wenn ein Geschwister eine trägt.** **20 der 22**
Wege-Verbünde sehen so aus: `Alkenstieg` + `Alkenstieg 2`. Eine Regel, die nur numerierte Zeilen
einsammelt, findet die Hälfte des Verbunds nicht.

💣 **Doppelte Marken und Lücken sind normal.** `Wald am Amboss` trägt `SO, SO, NW`; `Waldstein`
trägt `2, 5, 7`. Kein Zähler, der 1..n erwartet.

💣 **Nähe ist KEINE Gegenprobe.** Median-Abstand 3,34 Meilen, Maximum 215 Meilen (`Gre 1–12`).
Verstreut ist der Normalfall, nicht der Verdachtsfall.

Jedes Item bekommt in `after` zwei Felder: `verbund_stamm` und `verbund_n`.

⭐ **Nebeneffekt:** `avesmapsGaretienWikiLandschaftZuweisung` sucht dann nach „Silker Hain" statt
nach „Silker Hain 1" — die Wiki-Zuweisung trifft besser.

---

## 4 · Warum der Name das einzige Signal ist

Über alle 58 Namensgruppen gezählt:

| Feld | taugt es als Klammer? |
|---|---|
| `artikel` | bindet **4 von 58**. Bei **34** an allen Fragmenten leer, bei **20** verschieden |
| `extra` | 797 von 8.349 gesetzt, Inhalt `pop=500!level=Junker` — Einwohner und Rang, nie eine Gruppen-ID |
| `lodmin/lodmax` | in 40 von 58 gleich — aber das ist ein Zoomband, keine Identität |

Silker Hain 1–4: `artikel` leer, `namensraum` leer, `extra` leer.

---

## 5 · Der Verbund auf der Stage

Die Stage ist Client-Zustand (`zustand.anzeige`, `Map` Schlüssel → Objekt). Ein Verbund ist ein
**Eintrag darin**, der mehrere Server-Objekte vertritt; die Fragmente stehen als Kindzeilen darunter
und lassen sich einzeln herausnehmen (`✕`).

🔴 **Die Einstellungen gehören dem Verbund, nicht dem Fragment.** Heute liegt
`_garetienEingabenZustand` je Objektschlüssel; vier Fragmente hätten vier Sätze, drei würden beim
Import lautlos verworfen, und welcher gewinnt, hinge an der Reihenfolge der Items. Von außen sähe
das aus wie „die Einstellung wurde ignoriert".

💣 **Unter den Überschriften „Fläche" und „Beschriftung" stehen drei Felder, die an der REGION
hängen** — bei einem Objekt mit einer Fläche fällt das nie auf, bei vier ist es die ganze Frage:

| Überschrift | Feld | landet in |
|---|---|---|
| Fläche | für Klicks gesperrt | `ecosystem_region.is_locked` |
| Beschriftung | Kurvenbeschreibung | `ecosystem_region.curve_label` |
| Beschriftung | Anzahl Beschriftungen | `ecosystem_region.curve_label_max` |

⭐ `avesmapsCurveRefreshCacheForRegion` sammelt bereits **alle** aktiven Flächen einer Region —
eine Region mit vier Flächen ist dort kein Sonderfall.

---

## 6 · Der Import

Jedes Item trägt in `jeItem` ein `verbund`. `avesmapsGaretienUebernehmen` liest `$jeItem` bereits je
Item und verarbeitet `ORDER BY id`:

- **Das erste Item** (kleinste `sync_plan_item.id`) legt Label + Region + erste Fläche an.
- **Die folgenden** rufen nur `avesmapsCreateEcosystemArea` mit der `region_public_id` des Anführers.
- **Bei einem Weg** entfällt das: dort setzt der Verbund allein `$nach['name']` auf den Stamm; die
  Abschnitte gruppieren sich über `wpGroupKeyOf` von selbst.

⚠️ Die Übernahme läuft gestückelt (`$budget`). Ein Nachzügler in einem späteren Häppchen findet
seinen Anführer über den Vermerk (§7) — derselbe Weg, den die laufübergreifende Rücknahme heute
schon geht.

⚠️ **Die Beschriftung sitzt auf dem Schwerpunkt des Anführer-Fragments**, nicht in der Mitte des
Ganzen. Bei „Wald im Koschgebirge" (15 Fragmente über 71 Karteneinheiten) fällt das auf. Sie ist
verschiebbar wie jede Beschriftung — aber es gehört gesagt, statt entdeckt zu werden.

---

## 7 · Der Vermerk — und „Übernommen"

💣 **Nicht aus der Namensregel.** Würde der Reiter „Übernommen" die Verbünde beim Anzeigen neu
ausrechnen, zeigte er nach jeder Änderung der Erkennungsregel eine andere Gruppierung als die, die
tatsächlich geschrieben wurde. Der Verbund wird deshalb **beim Schreiben vermerkt**, dort wo heute
schon die angelegte `public_id` steht:

```
apply_note:  area:<flächen-id> | region:<region-id> | verbund:<stamm>
```

**Zwei Ebenen, und sie bleiben getrennt:**

| Ebene | Einheit | warum |
|---|---|---|
| **Buchführung** (`sync_decision`) | die Garetien-Zeile — vier Einträge | Der `entity_key` gehört der Zeile. Würde der Verbund ihn ersetzen, verlöre jede spätere Änderung der Erkennungsregel die ganze Arbeitsliste — das ist die Schlüsselwanderung, die am 01.09.2026 einen 502 gekostet hat |
| **Ansicht** (Reiter „Übernommen") | der Verbund — eine Zeile | Der Editor hat eine Entscheidung getroffen, also sieht er eine. Gespeist aus dem Vermerk, nicht aus der Regel |

---

## 8 · Rückgängig

💣 **Der heutige Rücknahmeweg würde bei einem Verbund alles mitreißen.** Für `ziel = 'region'` ruft
`avesmapsGaretienRuecknahmeAusfuehren` heute `avesmapsDeleteEcosystemRegion` — und das nimmt
**Beschriftung + Region + ALLE Flächen** in einer Transaktion mit. Vier Fragmente in einer Region:
die Rücknahme *eines* löschte alle vier. Mit gültiger Antwort, ohne Fehlermeldung.

⭐ **Die Reparatur ist klein, weil das Haus den Fall schon gelöst hat.**
`avesmapsDeleteEcosystemArea` löscht eine Fläche und trägt die Kaskade in sich: *„Was that the
region's last area? Then the region and its labels go with it. […] Every client gesture that makes
an area disappear routes through delete_area."*

| Handgriff | was passiert |
|---|---|
| ↩ an einem Fragment | seine `ecosystem_area` geht; Region, Beschriftung und Geschwister bleiben |
| ↩ am **letzten** Fragment | Region und Beschriftung gehen automatisch mit, in derselben Transaktion |
| „Ganzen Verbund zurücknehmen" | alle auf einmal; die Zeilen stehen danach wieder auf „Offen" |
| beim Weg | unverändert: jedes Fragment hat seine eigene `map_features`-Zeile |

🔴 **Kein Anführer-Sonderfall.** Der Anführer existiert nur beim *Anlegen*; beim Zurücknehmen sind
alle Fragmente gleich.

---

## 9 · Die Struktur der Einzelansicht

Heute läuft die rechte Spalte als flache Folge von acht Abschnitten durch, und die **Identität ist
geteilt**: Form und Art stehen in der Mitte im Kasten, der Name ganz unten in „Dieses Objekt".

**Drei Phasen, sieben Blöcke** — die Reihenfolge, in der ein Editor ohnehin denkt:

| Phase | Block | Inhalt | sichtbar |
|---|---|---|---|
| **Befund** | **A · Auf der Karte** | ✦ Zentrieren · Garetien/Avesmaps · Abschnitte + Deckung · der Grund | immer |
| | **B · Verbund** | die Fragmente, „Verbund auflösen" | nur bei einem Verbund |
| **Bauplan** | **C · Identität** | **Name · Form · Art** | Form/Art immer, Name nur auf der Stage |
| | **D · Darstellung** | Fläche · Beschriftung (Nodix, Größe, Priorität, Zoomband, Kurve, Auf Karte anzeigen) · je nach Form: Höhe, Flussrichtung, Endkreuzungen, Ruine, Verborgen | **nur Stage** |
| | **E · Wiki & Quellen** | Wiki-Landschaft, Quelle, Verweise | **nur Stage** |
| **Handlung** | **F · Einfügen** | Als Quelle einfügen · Neu einfügen · die Knöpfe | Häkchen nur auf der Stage |
| | **G · Weiter importieren** | Typ-Auswahl · „Imports in der Nähe wählen" · Umkreis | mit Geometrie |

🔴 **Solange „offen", bleiben D und E ausgeblendet** (Owner-Entscheid 5). Auf dem Reiter Offen
entscheidet ein Editor zwei Dinge — *überhaupt?* und *als was?* Größe, Priorität, Zoomband,
Kurvenbeschreibung, „für Klicks gesperrt", Wiki und Quellen beantworten keine davon; sie stehen dort
nur im Weg, bei jeder der 8237 Zeilen. **Gemessen: 1388 → 786 px, 43 % kürzer.**

⭐ Das ist keine Ausnahme, sondern die Verallgemeinerung einer Regel, die es schon gibt: Name und
die zwei Häkchen erscheinen seit dem 09.09.2026 ebenfalls nur auf der Stage
(`garetienEinfuegeHakenMarkup`). Daraus wird ein Satz: **Offen zeigt die Entscheidung, die Stage die
Einstellungen.**

⚠️ **Was der Umbau wirklich verschiebt, ist wenig:** der Name wandert nach oben zu Form und Art, der
Grund zu der Abschnittsliste, die er erklärt, und die Nähe-Zeile bekommt eine Überschrift. Alles
andere steht, wo es steht — es bekommt einen Namen und eine Trennlinie.

⚠️ **Gruppiert wird über Überschrift und Trennlinie, nicht über Rahmen** (AGENTS.md §12). Sieben
gerahmte Kästen wären ein Formular aus Kästen; sieben Überschriften mit einer Linie darüber sind
eine Gliederung.

---

## 10 · Was ausdrücklich nicht gebaut wird

- **Keine Polygon-Vereinigung im Importer.** Sie hätte an diesen Daten keine Wirkung (§2), bräuchte
  eine Bibliothek, die es in PHP hier nicht gibt (`polygon-clipping` lebt im Browser), und machte
  die fragmentweise Rücknahme unmöglich.
- **Keine neue Tabelle, kein neuer Endpunkt, kein neuer `change_type`.** Der Verbund ist eine
  Einstellung je Item, wie die Zielwahl.
- **Kein Eingriff in `entity_key`.** Vier Zeilen, vier Schlüssel, vier Grabsteine.
- **Kein automatisches Zusammenlegen beim Rechnen.**
- **Keine neue Bauform.** Regler, Vorgabemarke, Gruppenüberschriften, Bindungshinweis,
  Sicht-Knöpfe, Abschnittshäkchen, 💣-Kasten, Auswahlleiste, Handlungsleiste und Nähe-Zeile bleiben,
  wie sie sind. Der Verbund fügt **einen** Knopf hinzu.

---

## 11 · Offene Punkte

- 🔧 Ob die Buchstaben A–G in der Oberfläche bleiben oder nur im Mockup — sie kosten Platz und sagen
  einem Editor nichts, der die Blöcke ohnehin sieht.
- 🔧 Ob ein **aufgelöster** Verbund sich merken muss, dass er nicht wieder vorgeschlagen wird.
- 🔧 Die Position der Beschriftung bei weit verstreuten Verbünden (§6).
- 🔧 **Die Kurvenbeschreibung über getrennte Fragmente.** Der Rechner nimmt alle Flächen einer Region
  entgegen, aber niemand hat je eine Kurve über vier Stücke gesehen, die 0,3 bis 3 Meilen
  auseinanderliegen. Vorschlag: bei einem Verbund **aus**, bis jemand sie im Landschaften-Editor
  ausdrücklich einschaltet und ansieht.
- 🔧 Ob der Kasten die drei Region-Felder auch ohne Verbund als solche markiert.
