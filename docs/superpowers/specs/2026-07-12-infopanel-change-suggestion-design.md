# Design: „Änderung vorschlagen" im Infopanel (Community-Meldung)

**Datum:** 2026-07-12
**Status:** Entwurf zur Freigabe
**Betrifft:** Infopanel (Siedlung / Region / Weg / Territorium), Meldeformular, `api/app/report-location.php`

## 1. Ziel

Im Infopanel-Button-Band jedes Elements (Siedlung, Region, Weg, Territorium) gibt es
einen Button **„Änderung vorschlagen"** mit Brief-Icon. Ein Klick öffnet das bestehende
Meldeformular im **Änderungsmodus**: das angeklickte Element ist bereits vorausgewählt,
sodass ein Besucher gezielt eine Korrektur/Änderung an diesem konkreten Element vorschlagen
kann. Meldungen landen wie bisher in `map_reports` und werden von Editoren im Review-Panel
geprüft.

Dies ist die Community-Meldung, die im Abenteuer-/Quellen-Kontext als `origin=community`
bekannt ist — hier aber allgemein für Element-Änderungen.

## 2. Leitentscheidungen (vom Owner bestätigt)

- **Wiederverwenden statt neu bauen:** derselbe Dialog (`location-report-overlay`),
  dieselbe Formularlogik (`js/review/review-locations.js`) und derselbe Endpoint
  (`api/app/report-location.php`) — erweitert um einen „Änderungsmodus". Kein Parallel-Neubau.
- **Vorauswahl:** Kategorie (`report_type`) **und** Name sind gesperrt und aus dem Element
  vorausgefüllt. Zusätzlich reist die **Element-Referenz** (`entity_type` + `entity_public_id`)
  versteckt mit, damit der Editor sieht: es geht um das bestehende Element.
- **Größe editierbar:** Bei Siedlungen bleibt das Größen-Feld **editierbar** (vorausgefüllt
  mit dem aktuellen Ortstyp) — eine Größenänderung (z. B. „Dorf → Stadt") darf vorgeschlagen
  werden.
- **Beschreibung Pflicht, Quellen optional** im Änderungsmodus (eine Korrektur wie „Name
  falsch geschrieben" braucht keine Quelle).
- **Neue Kategorien:** `report_type` bekommt **„Herrschaftsgebiet"** (Territorium) und
  **„Weg/Straße"** (`fluss` bleibt separat für Flüsse).
- **Sichtbarkeit:** Button auf **allen vier** Elementtypen **immer** sichtbar (auch ohne
  Wiki-Link, auch für nicht eingeloggte Besucher). Wege erhalten dafür erstmals ein
  öffentliches Button-Band.
- **Icon:** `img/menu/brief.webp` (Owner liefert das Asset; Stil wie `linkteilen.webp`).

## 3. Element → Vorauswahl-Mapping

| Element | Renderer (heute) | `entity_type` | `report_type` (gesperrt) | Größe |
|---|---|---|---|---|
| Siedlung | `locationActionsMarkup()` (`js/ui/popups.js`) | `settlement` | `location` | editierbar, vorausgefüllt aus `location.locationType` |
| Region (geografisch) | Region-Infobox (`createRegionCompactTooltipMarkup`) | `region` | `region` | ausgeblendet |
| Territorium (politisch) | dieselbe Infobox, erkannt an `regionEntry.territoryPublicId` | `territory` | `territorium` | ausgeblendet |
| Weg / Straße / Pfad | `createPathPopupMarkup()` (`js/map-features/map-features-path-rendering.js`) | `path` | `weg` | ausgeblendet |

**Element-ID-Quellen:**
- Siedlung: `markerEntry.publicId`, Name `markerEntry.name`, Ortstyp `markerEntry.location.locationType`.
- Region: `regionEntry.publicId`.
- Territorium: `regionEntry.territoryPublicId` (vorhanden ⇒ Territorium, sonst Region).
- Weg: `getPathPublicId(path)`, Name `getPathDisplayName(path)`.

**Koordinaten:** Der Endpoint erzwingt `lat`/`lng` im Bereich 0–1024. Der Button gibt den
Anker des Elements mit, falls vorhanden (Siedlung: Marker-Koordinaten); sonst fällt die
Öffnungslogik auf die aktuelle **Kartenmitte** (`map.getCenter()`, geklammert auf 0–1024)
zurück. Die Koordinate dient nur als grober Ortungshinweis für den Editor.

## 4. Frontend-Änderungen

### 4.1 Button-Markup — `js/ui/popups.js`
Neue Funktion `suggestChangeActionButtonMarkup(ctx)` analog zu `sharePlaceActionButtonMarkup`:

```js
function suggestChangeActionButtonMarkup({ entityType, entityId, name, reportType, size = "", lat = "", lng = "" }) {
    if (!entityType || !name) return "";
    return popupActionButtonMarkup({
        label: tr("popup.suggestChange", "Änderung vorschlagen"),
        iconMarkup: '<img class="location-popup__action-img" src="img/menu/brief.webp?v=1" alt="" width="20" height="20" />',
        attributes: {
            "data-popup-action": "suggest-change",
            "data-entity-type": entityType,
            "data-entity-id": entityId || undefined,
            "data-name": name,
            "data-report-type": reportType,
            "data-size": size || undefined,
            "data-lat": lat === "" ? undefined : String(lat),
            "data-lng": lng === "" ? undefined : String(lng),
        },
    });
}
```

Eingebaut in:
- `locationActionsMarkup()` — Siedlung, immer.
- Region-/Territoriums-Infobox — Region vs. Territorium anhand `territoryPublicId`.
- `createPathPopupMarkup()` — Wege bekommen ein `locationPopupActionsMarkup([...])`-Band
  **auch außerhalb des Edit-Modus** (bisher `IS_EDIT_MODE ? ... : ""`).

### 4.2 Klick-Dispatch — `js/routing/routing.js`
Im delegierten `.location-popup__action-button`-Handler:

```js
if (action === "suggest-change") {
    openChangeSuggestionDialog({
        entityType: this.dataset.entityType || "",
        entityId: this.dataset.entityId || "",
        name: this.dataset.name || "",
        reportType: this.dataset.reportType || "sonstiges",
        size: this.dataset.size || "",
        lat: this.dataset.lat || "",
        lng: this.dataset.lng || "",
    });
    return;
}
```

### 4.3 Dialog-Öffnung — `js/review/review-locations.js`
Neue Funktion `openChangeSuggestionDialog(ctx)` (parallel zu `openLocationReportDialog`):

1. `resetLocationReportForm()` + `updateLocationReportDialogAvailability()`.
2. **Änderungsmodus setzen** (verstecktes Feld `report_mode = "change"`, plus
   `entity_type`, `entity_public_id`).
3. Kategorie `report_type` = `ctx.reportType`, Select **`disabled`** (gesperrt).
4. Name = `ctx.name`, Input **`readonly`** (gesperrt).
5. Größe: bei `report_type=location` sichtbar + **editierbar**, vorausgefüllt mit
   `sizeSlugFromLocationType(ctx.size)`; sonst ausgeblendet (bestehende
   `syncLocationReportTypeFields`-Logik erweitert um die neuen Typen `weg`/`territorium`/`region`).
6. Koordinaten: `ctx.lat`/`ctx.lng`, sonst Kartenmitte (geklammert).
7. **Beschreibung** (`location-report-comment`): Label → „Was soll geändert werden? *",
   Feld **required**.
8. **Quellen optional** (kein „mind. eine"-Zwang).
9. Titel → „Änderung vorschlagen – ‹Name›", Intro-Text auf Änderungskontext angepasst.
10. Dialog öffnen; Fokus auf das Beschreibungsfeld (nicht den gesperrten Namen).

**Reset/Schließen** (`resetLocationReportForm`) muss den Änderungsmodus vollständig
zurücknehmen: `report_mode = "new"`, `entity_type`/`entity_public_id` leeren, Name
`readonly` entfernen, Kategorie `disabled` entfernen, Titel/Intro/Beschreibungs-Label +
Pflichtstatus zurücksetzen. So bleibt das reguläre „Hier melden…" (Rechtsklick) unverändert.

### 4.4 Formular-HTML — `index.html`
- Neue `<option>`s im `#location-report-type`-Select:
  `<option value="weg">Weg/Straße</option>` und
  `<option value="territorium">Herrschaftsgebiet</option>` (mit `data-i18n`-Keys).
- Drei neue versteckte Inputs: `report_mode`, `entity_type`, `entity_public_id`.

### 4.5 Payload — `buildLocationReportRequestPayload()`
Ergänzt um `report_mode`, `entity_type`, `entity_public_id` (aus den versteckten Inputs).

## 5. Backend — `api/app/report-location.php`

### 5.1 Neue Report-Typen
`AVESMAPS_REPORT_TYPES` erweitern:
```php
'weg'         => ['type' => 'path',      'subtype' => 'weg'],
'territorium' => ['type' => 'territory', 'subtype' => 'territorium'],
```
(Neue resolved `type`-Werte `path`/`territory` erlauben es dem Review-Panel, Änderungs-
Meldungen an Elementen zu unterscheiden; sie durchlaufen nicht den `location`-Größenzweig.)

### 5.2 Änderungsmodus
`avesmapsValidateMapReport` liest zusätzlich:
- `report_mode` ∈ {`new`, `change`} (Default `new`).
- `entity_type` ∈ {`settlement`, `region`, `territory`, `path`} (nur bei `change`; sonst `''`).
- `entity_public_id` (String, normalisiert, optional).

Verhalten bei `report_mode === 'change'`:
- **Duplikat-Namensprüfung überspringen:** `avesmapsLocationNameExists`-409 wird **nicht**
  ausgelöst (das Element existiert ja bereits). Auch der „mögliches Duplikat"-Vermerk aus
  `avesmapsIsNearDuplicateReport` entfällt bzw. ist unschädlich.
- **Quellenpflicht entfällt:** die `if ($sources === [] && $requestedType !== 'comment')`-
  Prüfung wird bei `change` ausgelassen.
- Name bleibt Pflicht (ist im Formular vorausgefüllt).

### 5.3 Persistenz
`map_reports` bekommt drei neue Spalten via bestehendem Self-Healing
(`avesmapsEnsureMapReportColumn` in `avesmapsEnsureMapReportsTable`):
- `report_mode VARCHAR(16) NOT NULL DEFAULT 'new'`
- `entity_type VARCHAR(20) NULL`
- `entity_public_id VARCHAR(80) NULL`

Das `INSERT` schreibt die drei Felder mit.

## 6. Review-Panel (Editor)

Minimaler Umfang: In der Meldungsliste zeigt eine Änderungs-Meldung zusätzlich
**„Änderung an: ‹entity_type› ‹name›"** (aus den neuen Spalten). „Zum Element springen"
(Karte fokussieren via `entity_public_id`) ist ein **optionaler** Zusatz und nicht Teil des
Kern-Umfangs dieser Spec.

## 7. i18n (DE-Default, EN opt-in)

Neue Keys (Deutsch bleibt Default; EN kommt in die Overlay-Tabelle):
- `popup.suggestChange` = „Änderung vorschlagen"
- `report.typeOption.weg` = „Weg/Straße"
- `report.typeOption.territorium` = „Herrschaftsgebiet"
- `report.changeTitle` = „Änderung vorschlagen"
- `report.changeIntro` = Intro-Variante für den Änderungskontext
- `report.changeCommentLabel` = „Was soll geändert werden? *"

## 8. Owner-Aktion

**🔧 DU:** Lege das Brief-Icon als **`img/menu/brief.webp`** ab (aventurisch, Stil wie
`img/menu/linkteilen.webp`). Bis dahin ist der Button funktionsfähig, nur das Icon fehlt
optisch (leeres `alt`).

## 9. Nicht im Umfang (YAGNI)

- Kein neuer Endpoint, keine eigene Änderungs-Tabelle.
- Kein Editor-„Übernehmen"-Flow speziell für Änderungen (Editoren bearbeiten das Element
  weiterhin manuell anhand der Meldung).
- „Zum Element springen" im Review-Panel = optional, nicht Kern.

## 10. Testplan / Verifikation

Verifikation via localhost-Repro (Karten-Screenshots timen wegen Canvas-rAF aus):
1. Button erscheint im Infopanel für Siedlung, Region, Weg, Territorium.
2. Klick öffnet den Dialog mit gesperrtem Namen + gesperrter Kategorie, korrekt gemappt.
3. Siedlung: Größe editierbar und vorausgefüllt; Region/Territorium/Weg: Größe ausgeblendet.
4. Absenden ohne Quelle (change-Modus) ist erlaubt; Beschreibung ist Pflicht.
5. Absenden an einem bestehenden Ortsnamen erzeugt **kein** 409 (Duplikat-Prüfung übersprungen).
6. Datensatz in `map_reports` trägt `report_mode=change`, `entity_type`, `entity_public_id`.
7. Rechtsklick-„Hier melden…" ist unverändert (Name/Kategorie wieder frei, `report_mode=new`).
