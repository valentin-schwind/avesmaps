# Recon: Kartensammlung — die fehlenden Pipeline-Stufen 1+2 (Dump → Sync)

**Datum:** 2026-07-16 · **Status:** RECHERCHE, nicht gebaut. Vorstufe zu einer eigenen Sitzung.
**Owner-Entscheidung:** Stadtplanindex **und** Kartenindex. Kategorie-Baum vorerst nicht.

Dies ist kein Design-Doc, sondern der **Befund**: was im Wiki wirklich steht, gemessen am 2026-07-16 über
`https://de.wiki-aventurica.de/de/api.php`. Damit die nächste Sitzung nicht dieselben zwei Stunden
nochmal untersucht — und damit die Fehler, die ich beim Schätzen gemacht habe, nicht wiederholt werden.

## 1. Der Rahmen (Owner-Korrektur, und sie ist wichtig)

Das hier ist **kein „Link-Synchronisierung anbauen"**. Es sind die **fehlenden ersten zwei Stufen** der
Pipeline, die dieses Projekt überall fährt:

```
Dump ziehen  ->  syncen (Staging -> override-sicher abgleichen)  ->  manuell pflegen (Overrides)
   Stufe 1              Stufe 2                                          Stufe 3
```

Bei der Kartensammlung wurde **Stufe 3 zuerst** gebaut (Editor, Aufgabe C). 1+2 fehlen. Die Vorlage steht
fertig daneben:

| Stufe | Abenteuer (existiert) | Karten (zu bauen) |
|---|---|---|
| 1 Dump | `AVESMAPS_WIKI_DUMP_PHASE_ADVENTURES = 'adventures'` in `api/_internal/wiki/dump-hybrid-driver.php:129` → `wiki_adventure_catalog`, `wiki_adventure_place_staging` | Phase `citymaps` → `wiki_citymap_catalog`, `wiki_citymap_place_staging` |
| 2 Sync | Aktion `sync_adventures` in `api/edit/wiki/dump.php` (Lock + Heartbeat + Segment/Cursor), schreibt/löscht **nur** `origin='wiki'` | Aktion `sync_citymaps` |
| 3 Pflege | `html/adventure-editor.html` | `html/citymap-editor.html` ✅ |

**Datenquelle ist der DUMP**, nicht die API. Der Betreiber sagt: *Dump bevorzugen, API ok, **keine
HTML-Crawls*** (`docs/`-Policy + Memory `wiki-aventurica-dump-policy`). Das Hybrid-Muster ist:
Wikitext aus dem Dump (`offline.wiki-aventurica.de/dump/dewa_dump_small.xml.bz2`), Kategorien online.
Diese Recherche hat die API benutzt, um **hinzuschauen** — als Datenquelle wäre sie der falsche Weg.

## 2. Was auf den Seiten wirklich steht

### 2.1 „Aventurischer Atlas" — FÄLLT RAUS

Kein Index. Eine **Produktseite** mit `{{Infobox Produkt}}` (6152 Zeichen, 0 Tabellen) — also ein Buch.
`Der Aventurische Atlas` ist ein Fanprojekt-Glossareintrag (1025 Zeichen, 0 Tabellen). Beide enthalten
keine Kartenliste.
`Aventurischer Kartenindex` ist ein **Redirect** auf `Kartenindex` — keine vierte Liste.

### 2.2 Stadtplanindex — eine KONKORDANZ, keine Bildersammlung

34402 Zeichen, 939 Zeilen, 7 Tabellen, 531 Wikilinks.
Abschnitte: `Aventurische Städte` · `Myranische Städte` · **`neue Liste - Aventurische Städte`** ·
`neue Liste - Myranische Städte` · `Legende` · `Bearbeitungshinweise` · `Links`

**⚠️ ZWEI ÜBERLAPPENDE LISTEN.** Alte und „neue Liste" führen dieselben Städte (beide: Al'Anfa). Beide zu
syncen gäbe Dubletten. **Offene Entscheidung: welche gewinnt.**

**alt** — Wikilinks, aber arm:
```
!Stadt | Stadtplan (Farbe) | Stadtplan (s/w) | Umgebungskarte
| [[Abilacht]] || [[Landkartenset Die Siebenwindküste]], [[Die Siebenwindküste|VG2]] || ||
```
Spalte 1 ist ein **echter Wikilink** → unser Resolver greift direkt. Die Spaltenwahl kodiert `is_color`.

**neu** — reicher, aber Klartext statt Links:
```
!Stadt | Quelle | Farbe | Format | Maßstab | Notiz | Künstler
| Al'Anfa || IdDM, Al'Anfa und der tiefe Süden || Farbe || A2/- || Ja/- || - || Ina Kramer
```
Mapping auf unser Modell: Stadt → `citymap_place` · Quelle → `feature_sources` · Farbe/sw → `is_color`
· Notiz „Mit Legende" → `is_labeled` · Künstler → `author` · Format/Maßstab → `note`.

**⚠️ PARALLEL-ARRAYS.** Mehrfachquellen werden als `/`-getrennte Parallel-Listen kodiert (`A2/-`,
`Ja/-/-/-` zu 4 Quellen). Bricht, sobald jemand eine Spalte anders zählt. Braucht einen Parser, der bei
Längen-Mismatch **aufgibt statt zu raten**.

**Kein `map_url`, keine Bilder.** Das Ergebnis ist „Stadtplan von Abilacht, Quelle: Die Siebenwindküste
(VG2), farbig, von Ina Kramer" — ein Verweis. Das ist **erlaubt** (§3.1: nur Titel + Quelle sind Pflicht)
und rechtlich unbedenklich: Fakten, keine Bilder. Die Karte rendert dann ohne Link (`aria-disabled`).

### 2.3 Kartenindex — zwei sehr verschiedene Hälften

18735 Zeichen, 6 Tabellen, 190 Wikilinks.
Abschnitte: `Derekarten` · `Myranorkarten` · `Aventurienkarten` · `DSA5-Regionalkartenwerk` ·
`DSA4-Regionalkartenwerk` · `DSA3-Regionalkartenwerk` · `Links`

**⚠️ MEINE ERSTE EINSCHÄTZUNG WAR FALSCH.** Ich hatte „Ortsbezug nur Prosa, würde ich zurückstellen"
geschrieben — nach einer Stichprobe der **ersten** Tabelle (Weltkarten). Der Owner hat überstimmt und lag
richtig. Die Regionalkartenwerk-Abschnitte sehen ganz anders aus:

```
!Nr. | Karte | Publikation(en) | Veröffentlichungsdatum
| |[[:Datei:Karten Landkartenset Die Streitenden Königreiche.jpg|Politische Karte der Streitenden Königreiche (A2)]]
```
Spalte „Karte" ist ein **Dateilink**; der Titel nennt die **Region** („Die Streitenden Königreiche"), die
**Art** („Politische Karte" → `politisch`, „Übersichtskarte" → `uebersicht`) und das **Format** (A2).
Auflösbar.

Nur die *Aventurienkarten*/*Derekarten*-Tabellen sind kontinentweit und ortlos:
```
!Beschreibung | Abmessungen | Maßstab | Publikation(en) | Erstveröffentlichung
| Aventurien-Hexkarte || 43 x 57 cm || ca. 1:6.400.000 || [[Abenteuer Ausbau-Spiel]] || 1985
```
`Abmessungen` ist **cm, nicht px** — gehört nicht in `width_px`/`height_px` (die sind Pixel), sondern in
`note`. **Offene Frage:** woran hängen kontinentweite Karten? An nichts? An einem Wurzel-Territorium?

### 2.4 Der Kategorie-Baum — vorerst NICHT gewählt, aber hier notiert

`Kategorie:Karte` verzweigt in `Grundriss` · `Inoffizielle Karte` · `Kampfplan` · `Kartenskizze` ·
`Lageplan` · `Landkarte` (+ `Stadtplan`, `Stadtplanausschnitt`). Blätter enthalten **Dateien**:
`Datei:Alriksfurt beschriftet.jpg`, `Datei:Dunkelstedt 1034.jpg`.

Gemessen: Stadtplan **47** · Grundriss **43** · Kartenskizze **20** · Stadtplanausschnitt **13** ·
Kartenpaket Datei **115** · „Kartentyp nicht erkannt" **190** · „Kartenkategorie nicht erkannt" **261**.

**Die Kategorienamen SIND unsere `AVESMAPS_CITYMAP_TYPE_KEYS`** (grundriss/lageplan/stadtplan/skizze) —
die Spec hat sie offensichtlich von dort. Auch `derographisch` klärt sich: es kommt vom „Projekt
Derographische Datensammlung", das der Kartenindex verlinkt. **Diese Wiki-Seite existiert nicht (mehr)** —
der Link ist tot.

Der Ortsname steckt im **Dateinamen** („Alriksfurt beschriftet" → Resolver), „beschriftet" → `is_labeled`,
„bunt" → `is_color`. Fährt auf der Wappen-Maschinerie, die es schon gibt.
**Warum zurückgestellt:** Wiki-Kartendateien sind größtenteils © Ulisses → nach der Wappen-Regel
(`coat-public-domain-policy`) öffentlich nur `public_domain`. Viel holen, wenig zeigen.

## 3. Was VOR dem Bauen entschieden werden muss

1. **Stadtplanindex: alte oder „neue Liste"?** Beide führen dieselben Städte. Die neue ist reicher
   (Künstler, Format, Notiz), die alte hat echte Wikilinks statt Klartext-Ortsnamen.
2. **Kontinentweite Karten** (Aventurienkarten/Derekarten) — welcher Ort? Oder ortlos, und damit nirgends
   sichtbar?
3. **Titel-Erzeugung.** Der Stadtplanindex hat keine Kartentitel, nur „Stadt + Quelle". Also
   generieren („Stadtplan von Al'Anfa (Al'Anfa und der tiefe Süden)")? Der `wiki_key` für die
   Idempotenz muss daraus stabil ableitbar sein — **sonst legt jeder Sync Dubletten an.**
4. **`origin='wiki'` ins Vokabular.** Heute kennt `citymap.origin` nur `manual|community`.

## 4. Fallen, die schon feststehen

- ✅ **BEHOBEN (`5a4ec69`, dieselbe Sitzung):** `avesmapsSuppressCitymapPlace` tombstonte nur
  `origin='community'` und **hart-löschte alles andere**. Ein `wiki`-Ort wäre gelöscht und vom nächsten
  Sync auferstanden — genau der Bug, gegen den der Tombstone existiert. Die Regel ist jetzt „alles außer
  `manual` wird tombstoned", damit die nächste Herkunft nicht daran denken muss.
- **`avesmapsCitymapsEnsureTables` läuft bei JEDEM öffentlichen Read.** Neue Staging-Tabellen gehören
  **nicht** dort hinein, sondern in eine eigene `EnsureStagingTables` auf dem Sync-Pfad — sonst zahlt
  jeder Seitenaufruf für DDL, das nur der Owner braucht (vgl. AGENTS.md §10, `territories-endpoint.php`).
- **Der Reconcile darf `feature_sources` nur mit `origin='wiki_publication'` anfassen** — das Muster steht
  im Publikations-Sync. Manuelle/suppressed Quellen bleiben unberührt.
- **Zwei Editoren, ein Button.** Der Sync-Trigger gehört in den Karteneditor (Muster `#aeSyncBtn` →
  `window.parent.startWikiSyncAdventuresSync()`), nicht ins Menüband.

## 5. Was diese Recherche NICHT geklärt hat

- Ob Stadtplanindex/Kartenindex **im Dump** genauso aussehen wie über die API (sollten sie — derselbe
  Wikitext — aber ungeprüft).
- Wie viele der ~500 Stadtplanindex-Zeilen sich **tatsächlich auflösen** (Resolver gegen echte
  Siedlungen). Das entscheidet über den Wert und ist in einer Stunde messbar.
- Ob die `Legende`-Abkürzungen (`[[Das Land des Schwarzen Auges|Land]]`) in den Quellenspalten der
  **alten** Liste vorkommen und dort aufgelöst werden müssen.
