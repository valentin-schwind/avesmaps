# Design: Mehrere Karten-Links + „kostenpflichtig" am Link

**Datum:** 2026-07-17 · **Status:** Schritte 1–4 **GEBAUT** (2026-07-17). Offen: 5 (wartet auf die
Abstimmung mit der Parallel-Session) und 6 (siehe §6 — der Punkt ist nicht so baubar, wie er dasteht).
⚠️ End-to-End ungetestet: keine lokale DB. Unit-getestet sind die Normalisierer (PHP) und
Filter + Anzeige (JS); der DB-Roundtrip „Linkname bleibt nach Reload" braucht einen Owner-Durchlauf.
**Auftraggeber-Zitat:** *„es gibt für viele Karten mehrere quellen, man sieht dann ja welche wo
verfügbar ist und die leute können selber entscheiden wo sie ihre karten hernehmen"*

## 1. Warum

Eine Karte hat heute **einen** `map_url`. Real ist sie oft an mehreren Stellen zu finden: im F-Shop
(kostenpflichtig), auf ihrer Wiki-Seite (frei), in einem Fanprojekt. Der Leser soll sehen, **wo** sie
verfügbar ist, und selbst wählen.

## 2. Die tragende Entscheidung: `is_paid` gehört an den LINK

Owner: *„es kann links geben die zu einer paywall führen (die sind dann kostenpflichtig) und welche die
zu einer freien karte führen"*.

Das entscheidet die Datenfrage — und **verwirft `feature_sources`** als Träger:

- `feature_sources` ist ein **geteilter** Katalog (`url_hash`-dedupliziert). „Al'Anfa und der tiefe
  Süden" ist dort EIN Eintrag, den Karten **und Siedlungen** teilen. Ein Bezahl-Flag daran hinge an der
  **Publikation**, nicht am **Link** — und derselbe Band ist im Shop bezahlt und im Wiki frei.
- Es kennt `source_type`/`is_official`, aber **kein** `is_paid`. Eine Spalte dafür träfe alle Entitäten.

> **Gegenprobe für die nächste Sitzung:** Nicht „feature_sources reicht doch" wiederaufwärmen — das war
> die erste Empfehlung und sie war falsch. Der Grund steht oben.

**Vorlage: `adventure_link`** (`adventure_id, label, url, sort_order, origin, status`) — existiert,
inkl. `set_links`-Endpoint (ersetzt die Liste als Ganzes) und Editor-UI im Abenteuer-Editor.

```sql
CREATE TABLE IF NOT EXISTS citymap_link (
    id INT AUTO_INCREMENT PRIMARY KEY,
    citymap_id INT NOT NULL,
    label VARCHAR(200) NOT NULL,        -- editierbar (Owner-Anforderung)
    url VARCHAR(500) NOT NULL,
    is_paid TINYINT(1) NULL,            -- NULL = unbekannt (Kernregel §3.1), NICHT false
    sort_order INT NOT NULL DEFAULT 0,
    origin VARCHAR(16) NOT NULL DEFAULT 'manual',   -- manual|community|wiki
    status VARCHAR(16) NOT NULL DEFAULT 'approved', -- approved|suppressed (Tombstone)
    KEY idx_citymap_link (citymap_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
```

`citymap.is_paid` **entfällt** (Owner-Entscheidung). ⚠️ Das Feld ist **frische Arbeit der
Parallel-Session** (`387e06f6`, „kostenpflichtig as a sixth property"): Editor-Feld, Tri-State-Control,
Payload, `map-features-citymaps-suggest.js`. **Vorher abstimmen**, sonst rebasen sich zwei Sitzungen
gegenseitig kaputt.

## 3. Anzeige (Frontend)

**Nicht** „Karte / Karte / Karte" und **nicht** „#1 Link zur Karte (online)" — eine Nummer sagt dem
Leser nichts. Der Linktext benennt die **Fundstelle**, der Zusatz die Bedingung:

```
Al'Anfa und der tiefe Süden ↗   (kostenpflichtig)
Wiki-Aventurica ↗
```

- `↗` ist Pflicht für externe Links (AGENTS.md §12).
- „(kostenpflichtig)" **nur** bei `is_paid === true`. Bei `NULL` **nichts** anzeigen — „unbekannt" ist
  eine gültige Antwort, nie ein erfundenes „frei" (Kernregel `citymaps.php`).
- Bei genau einem Link ohne Label: wie heute rendern, keine Liste für ein Element.

## 4. Die zwei Fallen, die der Owner benannt hat

### 4.1 Der Filter muss über ALLE Links greifen

`js/map-features/map-features-citymaps.js:298`:
```js
if (filter.freeOnly && shape.is_paid !== false) { /* ausblenden */ }
```
Liest `is_paid` **von der Karte**. Nach dem Umzug muss die Frage lauten:
**„hat die Karte mindestens einen Link mit `is_paid === false`?"** — eine Karte mit einem freien und
einem bezahlten Link ist im „nur freie"-Filter **sichtbar** (der freie Weg existiert ja).

Betroffen sind mind. 3 Stellen: der Filter (`:298`), die Trait-Anzeige
(`map-features-place-extras.js:415`) und `data-paid` (`:161`) + der Dialog (`citymaps-dialog.js:87`).

### 4.2 Der Linkchecker sieht nur `map_url`

`api/_internal/linkcheck/providers.php:85`:
```sql
SELECT public_id, title, map_url FROM citymap WHERE status = 'approved'
```
Prüft **einen** Link pro Karte. Mit `citymap_link` muss er die Liste lesen, sonst bleiben alle neuen
Links ungeprüft — und der Linkchecker meldet weiterhin „alles grün", während tote Links danebenstehen.

## 5. Was mit `map_url` passiert

`map_url` bleibt als **der Direktlink auf die Karte selbst** (Bild/Online-Version). Grund: Daran hängen
drei Dinge, die eine Liste nicht erben können — `map_license` beschreibt **dieses** Bild, „Autoget"
crawlt **diese** Seite (`thumb_auto_url`), und der Wiki-Sync schreibt sie (Publikations-Wiki-Seite).

Migration: bestehende `map_url` bleiben, wo sie sind. `citymap_link` ist **additiv**.

## 6. Reihenfolge

1. ✅ Schema + `set_links`-Endpoint (Vorlage `adventure_link` 1:1).
2. ✅ Editor: Link-Liste (Label editierbar, URL, `is_paid`-Tri-State, ▲▼) — Vorlage:
   der Abenteuer-Editor hat sie bereits (`aeSyncExtraLinksFromDom`, `state.extraLinks`).
3. ✅ Payload + Frontend-Anzeige (§3).
4. ✅ **Filter (§4.1) und Linkchecker (§4.2)** — die vergisst man sonst, und beide versagen leise.
5. ⏸ `citymap.is_paid` entfernen — **erst nach Abstimmung** mit der Parallel-Session (§2).
6. ⛔ Wiki-Sync als `origin='wiki'` — **so nicht baubar, Owner-Entscheidung nötig** (siehe unten).

### Was beim Bauen dazugelernt wurde

- **Der Karten-Link erbt `is_paid` von der Karte.** `citymap.is_paid` beschrieb immer genau diesen einen
  Link (es war der einzige, als die Spalte kam) — ihn auf den Link zu heben ist die ehrliche Übersetzung
  der Altdaten, keine Erfindung. Genau das macht Schritt 5 zum reinen Datenumzug: alles dahinter fragt
  bereits den LINK, nicht die Karte.
- **Der Editor bearbeitet nur `origin='manual'`.** `set_links` postet eine Liste ohne ids zurück — alles,
  was der Editor SIEHT, würde er als `'manual'` neu anlegen. Ein wiki-eigener Link im Editor-Payload wäre
  nach dem nächsten Speichern doppelt da. Deshalb liest der Detail-Read `origin='manual'` und `set_links`
  löscht auch nur das. Wer Schritt 6 baut, braucht dafür eine Read-only-Sicht + `suppress_link`
  (Vorbild: der approved/suppressed-Umschalter bei `citymap_place`).
- **Falle §4.1 saß tiefer als notiert.** Nicht nur `citymaps.js:298` las die Karte statt der Links:
  `citymaps-dialog.js` filterte über die *magere DOM-Shape* (`links: []`), während die Zeile daneben aus
  dem Katalog rendert. Der Dialog hätte einen freien Link ANGEZEIGT und die Karte trotzdem weggefiltert.
  Beide Pfade teilen sich jetzt `shapeFromCard()`.
- **Die Filterfrage lebt nur im Client.** Eine PHP-Kopie von `avesmapsCitymapHasFreeAccess` wurde gebaut
  und wieder entfernt: der Server liefert den ganzen Katalog, gefiltert wird im Browser — sie hatte keinen
  Aufrufer. Die Regel steht in `map-features-citymaps.js`.

### Zu Schritt 6: der Punkt widerspricht sich selbst

§6.6 sagt „der Wiki-Sync schreibt seinen Publikations-Link künftig als `citymap_link`", §5 sagt „`map_url`
bleibt … der Wiki-Sync schreibt sie". Beides zugleich geht nicht, denn der Sync kennt **genau eine** URL:
`avesmapsCitymapWikiUrlForSource()` liefert die Wiki-Seite der Publikation, und
`avesmapsCitymapReconcilePlan()` schreibt sie nach `map_url` (Owner 2026-07-17: „wenn aus dem wiki, will
ich oben den wiki link"). Ein `citymap_link` daneben wäre **dieselbe URL ein zweites Mal** — der Leser
sähe „Karte ↗" und „Al'Anfa und der tiefe Süden ↗" auf dasselbe Ziel.

`citymap_link` zahlt sich für Wiki-Karten erst aus, wenn der Sync **mehrere** Fundstellen pro Karte kennt.
Solange er das nicht tut, ist Schritt 6 eine Dublette. Die Label-Frage in §7 hängt an derselben Klärung.

## 7. Offen

- **Community-Links?** `origin='community'` ist im Schema vorgesehen, aber das Melde-Formular kennt
  sie nicht. Nicht Teil dieser Spec.
- **Label-Vorschlag beim Wiki-Sync:** „Wiki-Aventurica" oder der Publikationstitel? Der Titel der Karte
  nennt die Publikation bereits — „Wiki-Aventurica" sagt mehr über die Fundstelle.
