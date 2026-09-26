# Stätten löschen und umhängen — Entwurf

**Stand:** 26.09.2026 · **Mockup:** `docs/staetten-kasten-mockup.html` · **Owner-Entscheide:** siehe §1

## 0. Anlass

Der Garetien-Importer ist seit dem 26.09.2026 zurückgebaut (`ae53b0bae`). Er war der **einzige Schreiber**
der Tabelle `settlement_place` („Innerorts einfügen“). Seither lässt sich eine gespeicherte Stätte weder
löschen noch einem anderen Ort zuordnen — gegen die Owner-Regel „es darf auf der Map keine Elemente geben,
über die ich keine Kontrolle mehr habe". Owner, 26.09.2026: *„mach den Lösch-/Umhängeweg für Stätten im
Ortseditor (bei ‚Ort bearbeiten' und im eigentlichen Editor)"*.

## 1. Owner-Entscheide (26.09.2026)

1. **Variante A:** der neue Kasten zeigt nur die **gespeicherten** Stätten, bearbeitbar; darunter eine graue
   Zeile mit der Zahl der aus dem Wiki abgeleiteten.
2. ~~„Orte, die auf der Karte platziert sind, sind nicht innerorts.“~~ 🔴 **Vom Owner am selben Tag
   zurückgenommen:** „innerorts ist ein unabhängiges Prädikat“ (= gehört zu einem Ort), unabhängig davon, ob
   das Objekt einen Kartenpunkt hat; Suche und Wegfindung springen auf den Punkt, wenn es einen gibt, sonst
   auf den Ort. Das ist ein **eigener Auftrag (Teil 2)**, Entscheid dort: ein Kartenpunkt gehört über seinen
   Wiki-Artikel zu einem Ort, dazu ein Feld „gehört zu Ort“, das Editoren setzen und umhängen (Variante B).
   Dieser Entwurf baut nur Löschen und Umhängen gespeicherter Stätten.
3. Nur **Löschen** und **Umhängen**. Kein Umbenennen, keine Art ändern, kein Neuanlegen.
4. **Kein Rückgängig-Knopf.** Gelöscht wird weich (`is_active = 0`), wiederherstellbar nur in der Datenbank.

## 2. Zwei Arten Stätten — gemessen

Die Infobox-Zeile „Stätten“ (`in_settlement_places` in der Kartennutzlast) mischt zwei Herkünfte, die dort
**gleich aussehen und keine Kennung tragen**:

| Herkunft | Quelle | Anzahl (Nutzlast 26.09.2026) | bearbeitbar? |
|---|---|---|---|
| **abgeleitet** | Wiki-Registry (`wiki_sync_pages.standort`, Wege, Organisationen, Stadtteilweiterleitungen), per Scope-Klassifikator einer Stadt zugeordnet | ≈ 3544 | nein — kommt beim nächsten Laden wieder |
| **gespeichert** | `settlement_place`, von einem Menschen einer Stadt zugeordnet (bisher nur der Garetien-Import) | ≈ 273 | **ja — dieser Entwurf** |

## 3. ~~Regel „Kartenpunkt schlägt Innerorts“~~ — entfallen

🔴 **Gestrichen am 26.09.2026** (Owner, siehe §1.2). Sie hätte eine Stätte, deren Artikel einem Kartenpunkt
zugewiesen ist, aus der Stättenliste geworfen — nach dem neuen Modell gehört sie dort hin, nur mit Sprung auf
ihren Punkt. Die gemessenen 11 Fälle (Burg Aarkopf/Salthel …) sind damit kein Fehler, sondern Stoff für Teil 2.
Die reinen Hilfen dafür (`avesmapsInnerortsArtikelSchluessel`, `…KartenArtikel`, `…OhneKartenpunkte`) stehen
bereits in `settlement-places.php`; Teil 2 benutzt sie für die Suche (ein Objekt, ein Treffer).

## 4. Teil 2 — Editor-Endpunkt `api/edit/map/settlement-places.php`

`POST`, Fähigkeit `edit`, Hausumschlag `{ok:true,…}` / `{ok:false,error:{code,message}}`, JSON-Rumpf mit
`action`:

| Aktion | Rumpf | Antwort | Fehlercodes |
|---|---|---|---|
| `list` | `settlement_public_id` | `staetten: [{public_id, name, place_type, wiki_url, origin, gleichnamig_auf_der_karte}]` | `invalid_request` |
| `delete` | `public_id` | `staetten` (die neue Liste des Ortes) | `not_found` |
| `move` | `public_id`, `ziel_public_id` | `staetten` (neue Liste des **alten** Ortes), `ziel_name` | `not_found`, `invalid_target`, `name_taken`, `name_taken_deleted` |
| `orte` | `q` (≥ 2 Zeichen) | `orte: [{public_id, name, subtype, lage}]`, höchstens 12 | `invalid_request` |

- **`list`** liest `settlement_place WHERE settlement_public_id = ? AND is_active = 1`, sortiert nach Name.
  - `gleichnamig_auf_der_karte`: ein aktiver Kartenpunkt **in der Nähe des Ortes** trägt denselben Namen
    (Groß/Klein egal). Reiner Hinweis, nichts wird ausgeblendet. Heute genau ein Fall: Burg Weißenstein.
    ⚠️ „In der Nähe“ heißt: höchstens **5 Karteneinheiten** (= 15 Meilen) vom Punkt des Ortes — eine Stätte
    hat selbst keine Position, ihr Ort schon. Ohne Nähebedingung träfe jede „Burg Weißenstein“ im ganzen
    Kontinent; die Zahl steht als benannte Konstante im Code, nicht als freie Ziffer.
- **`delete`** = vorhandenes `avesmapsSettlementPlaceDeactivate`. Wird zusätzlich `updated_at` gesetzt.
- **`move`** (neu, `avesmapsSettlementPlaceMove`): in einer Transaktion
  1. Stätte lesen (aktiv), sonst `not_found`;
  2. Ziel prüfen: aktiver `map_features`-Punkt mit einer **Siedlungsklasse** (Dorf … Metropole, aus
     `api/_internal/ortsklassen.php`), nicht der eigene Ort, sonst `invalid_target`;
  3. 💣 **Der UNIQUE-Schlüssel `(settlement_public_id, name)` kennt `is_active` nicht.** Liegt am Ziel eine
     *aktive* Stätte gleichen Namens → `name_taken`; eine *gelöschte* → `name_taken_deleted` mit eigener
     Meldung („dort gab es schon eine gelöschte Stätte gleichen Namens“). Kein stilles Überschreiben, kein
     hartes Löschen des Grabsteins.
  4. `UPDATE settlement_place SET settlement_public_id, settlement_name (Name des Zielpunkts), updated_at`.
  - Die **Quellen** der Stätte hängen an ihrer `public_id` (`feature_sources.entity_type =
    'settlement_place'`) und wandern ohne Zutun mit.
- **`orte`**: Namenssuche über aktive `map_features`-Punkte mit Siedlungsklasse, `LIKE` mit Präfix vorn
  gereiht, gedeckelt auf 12; `lage` = die Region/Lage-Angabe des Punktes (zur Unterscheidung
  gleichnamiger Orte, z. B. Weißenstein). Kein Wiki-Registry-Suchpfad — Ziel ist ein Punkt, kein Artikel.
- **Stempel:** `avesmapsSettlementPlaceReadStamp` zählt aktive Zeilen und liest `MAX(updated_at)`.
  Löschen ändert die Zahl, Umhängen das `updated_at` — beides dreht das ETag der Nutzlast.
- ⚠️ `avesmapsSettlementPlaceEnsureSchema` läuft im Schreibweg **vor** der Transaktion (DDL committet in
  MySQL implizit, AGENTS.md §11).
- **Kein Protokolleintrag** im Fenster „Änderungen“ (Owner-Entscheid 4) — bewusst, nicht vergessen.

## 5. Teil 3 — der Kasten „Stätten“ (ein Bauteil, zwei Montagestellen)

**Bauteil:** `js/ui/staetten-kasten.js` + `css/components/staetten-kasten.css`.
`mountStaettenKasten(host, { ortPublicId, ortName, sektion, escape, tr })` — kennt keine Montagestelle.

- **Montagestellen**, jeweils **direkt vor „Quellen“** (Quellen bleiben immer ganz unten, Owner 03.09.2026):
  1. **„Ort bearbeiten“** (`index.html`, `#location-edit-dialog`): ein `.label-edit-section` mit Titel
     „Stätten“, montiert in `review-locations.js` neben dem Quellenkasten — nur bei einem Ort **mit**
     `public_id` (beim Anlegen gibt es keine Stätten).
  2. **Ortseditor** (`html/wiki-sync-settlement-editor.html`, Detailfeld): ein `.dt-grp` „Stätten“ vor
     `.dt-grp` „Quellen“, montiert in `renderSettlementDetail` hinter demselben Rennwächter wie der
     Quellenkasten — nur bei einem Eintrag mit Kartenpunkt (`selectedPublicId`).
- **Sichtbarkeit:** Hat der Ort weder gespeicherte noch abgeleitete Stätten, blendet das Bauteil seine
  `sektion` (Titel + Kasten) aus. Während `list` lädt: Kasten sichtbar mit „Stätten werden geladen …“.
- **Zeile** (die vorhandene `.avm-row`, AGENTS.md §11 „Die Listenzeile — es gibt ZWEI“):
  - Zeile 1: **Name** (fett) · rechts die **Art** (`place_type`, gedämpft).
  - Zeile 2: Wirt der Wiki-Adresse als Link mit `↗` (z. B. „garetien.de ↗“); dahinter, wenn zutreffend,
    der Hinweis in Warnfarbe (`.avm-row__l2.warn`): „gleichnamiger Punkt auf der Karte“.
  - Rechts zwei Symbolknöpfe: **⇄ Umhängen** und **✕ Löschen**. 🔴 **Die Klassen des Quellenkastens
    werden MITBENUTZT, nicht abgeschrieben**: `.fs-row__edit` / `.fs-row__remove` für die Knöpfe,
    `.fs-row--open` an der Zeile für den offenen Zustand von ⇄, `.fs-actions` / `__prim` / `__sek` für die
    Knöpfe der Falte, `.fs-add-note` (`--ok`) für die Meldezeile. `feature-sources.css` ist an beiden
    Montagestellen ohnehin geladen. Neu ist nur, was im Vertragsblock des Mockups steht. Die Zeile selbst
    ist **nicht** anklickbar (kein Hover, kein Zeiger) — sie hat keine Auswahl.
- **Umhängen** klappt unter der Zeile eine Falte auf (immer nur eine Falte offen):
  Suchfeld „Neuer Ort …“ mit der vorhandenen Vorschlagsliste (`attachTypeahead`, `.sac`) gegen
  `action: orte`; Treffer zeigen Name · Ortsklasse · Lage. Nach der Wahl: „„Burg X“ nach **Neuort**
  umhängen?" [Umhängen] [Abbrechen]. Erst der Knopf schreibt.
- **Löschen** klappt dieselbe Falte als Rückfrage auf: „Stätte „Burg X“ löschen? Sie verschwindet aus der
  Infobox von *Ort*; ihre Quellen bleiben an ihr hängen." [Löschen] [Abbrechen].
- **Graue Zeile** unter der Liste (nur wenn > 0): „+ 12 weitere aus dem Wiki — hier nicht bearbeitbar.“
  - Die Zahl kommt aus der **Kartennutzlast im Browser** (`window.avesmapsInSettlementPlaces`, dieselbe
    Liste wie die Infobox): Stätten des Ortes minus die gespeicherten
    (Abgleich über Name). Im Ortseditor-iframe über `window.parent` (gleiche Herkunft).
  - ⚠️ Ist die Liste nicht erreichbar (Seite ohne Karte), **entfällt die Zeile** — sie behauptet nie „0“.
  - Gibt es 0 gespeicherte, aber > 0 abgeleitete Stätten, steht nur die graue Zeile da (der Kasten
    beantwortet „warum finde ich die Stätte aus der Infobox hier nicht“).
- **Nach jedem Schreibvorgang**
  1. zeichnet das Bauteil die Liste aus der **Serverantwort** neu (kein zweiter Zustand im Browser);
  2. zieht es die Kartennutzlast im Browser nach: Eintrag entfernen (Löschen) bzw. `settlement` auf den
     neuen Ortsnamen setzen (Umhängen), dann den Stätten-Index der Infobox verwerfen
     (`avesmapsStaettenIndex = null` — 💣 der Index prüft nur die **Länge** der Liste, ein Umhängen ändert
     sie nicht und bliebe unsichtbar) und das Infopanel auffrischen, falls offen. Im iframe über
     `window.parent`.
  3. meldet es in einer Zeile unter der Liste: „Gelöscht: Burg X.“ / „Umgehängt nach Neuort.“
- **Fehler** stehen in derselben Meldezeile in Warnfarbe, mit dem Satz des Servers; die Falte bleibt offen.

## 6. Was dieser Entwurf bewusst NICHT tut

- Keine abgeleiteten (Wiki-)Stätten bearbeiten — sie gehören über ihren Wiki-Artikel zu ihrem Ort (Teil 2).
- Kein Umbenennen, keine Art, kein Neuanlegen, kein Rückgängig, kein Protokolleintrag (§1).
- Nichts an Suche, Wegfindung und Infobox-Sprüngen — das ist Teil 2 (§1.2).

## 7. Prüfung

- **PHP** (SQLite-Fixture, `api/_internal/app/__tests__/`): `list` samt Namensnachbar-Hinweis;
  `delete`; `move` inkl. `invalid_target` (Kreuzung, eigener Ort, inaktiv), `name_taken`,
  `name_taken_deleted`; Stempel ändert sich bei beiden Schreibwegen; Ensure-vor-Transaktion am Quelltext.
- **JS** (Bauteil **ausgeführt**, nicht gelesen): Zeilen, Hinweise, graue Zeile (mit/ohne erreichbare
  Nutzlast), Falte Umhängen/Löschen, Nachziehen der Nutzlast samt Index-Verwerfen, Fehlerzeile.
- **Verdrahtung:** beide Montagestellen rufen das Bauteil, stehen vor „Quellen“, Ortseditor hinter dem
  Rennwächter; CSS in `css/styles.css` (Hauptseite) und per eigenem `<link>` im Ortseditor gebunden — nicht über `editor-page.css`, die alle sechs Editorseiten lädt.
- **Mockup-Vertrag** bindet `css/components/staetten-kasten.css`.
- **Ablauf live** (Owner-Sitzung): an Burg Weißenstein Hinweis sehen, eine Stätte umhängen und in der
  Infobox beider Orte nachsehen, eine löschen.
