# Resume Prompt: Derived Territory Geometry

Diesen Prompt verwenden, falls die urspruengliche ChatGPT-Konversation nicht mehr laedt oder der Kontext verloren geht.

```text
Du arbeitest am Repository `valentin-schwind/avesmaps` auf dem Default-Branch `master`.

Avesmaps ist eine interaktive Fantasy-Karte fuer Aventurien/DSA. Die App nutzt ein statisches HTML/CSS/JS-Frontend mit Leaflet auf einer Bildkarte sowie eine PHP/API + SQL-Datenbank fuer politische Herrschaftsgebiete. Das Projekt soll fuer DSA-Spieler, Spielleiter und Weltenbauer praktisch nutzbar bleiben und nicht wie ein ueberladenes GIS wirken.

Wichtig: Lies vor jeder Implementierung den aktuellen Repository-Stand ein. Arbeite Github-Connector-freundlich. Nutze keine anderen Branches, sofern nicht ausdruecklich verlangt. Wenn du Dateien aenderst, erklaere genau, welche Dateien du anfasst und warum. Halte Dateien klein und splitte neue Logik lieber in eigene Module, statt bestehende Dateien unnoetig aufzublaehen.

Die geplante Aufgabe ist in `docs/derived-territory-geometry-plan.md` dokumentiert. Lies diese Datei zuerst vollstaendig.

Ziel der Aufgabe:

Detailgeometrien bleiben die redaktionelle Quelle. Uebergeordnete Herrschaftsgebiete sollen ihre sichtbaren Aussengrenzen automatisch aus den Unterflaechen ableiten. Beispiel: Nicht Deutschland manuell zeichnen, sondern Bundeslaender pflegen und Deutschland als Union daraus erzeugen. Fuer Avesmaps: Provinzen/Baronien/Detailflaechen bleiben in `political_territory_geometry`; Reiche, Koenigreiche, Provinzverbuende oder andere Parent-Territorien bekommen automatisch erzeugte Aussengrenzen in einer neuen Tabelle.

Datenmodell:

Bestehende Tabelle bleibt unveraendert:

- `political_territory_geometry`
- enthaelt manuell/redaktionell gepflegte Detailgeometrien
- `source = editor`, `legacy`, `manual`, `editor-assignment`, `editor-split`, usw.

Neue Tabelle:

- `political_territory_derived_geometry`
- enthaelt automatisch berechnete Parent-/Reichs-Aussengrenzen
- benoetigt mindestens:
  - `id`
  - `public_id`
  - `territory_id`
  - `geometry_geojson`
  - `label_lng`
  - `label_lat`
  - `min_zoom`
  - `max_zoom`
  - `source_revision` oder `source_signature`
  - `generated_at`
  - `is_active`
  - `created_by`
  - `updated_by`
  - `created_at`
  - `updated_at`
- optional sinnvoll: `min_x`, `min_y`, `max_x`, `max_y` fuer BBox-Filter.

UI-Plan:

Im bestehenden Herrschaftsgebiet-Editor soll ein neues Panel `Geometrie` entstehen.

Inhalt:

- Checkbox `Aussengrenzen darstellen`
- Checkbox `Fuer alle Unterregionen erzeugen`
- Zoom von/bis
- Thumbnail der erzeugten Geometrie, falls sinnvoll moeglich
- Status-/Fehleranzeige

Verhalten:

Wenn `Aussengrenzen darstellen` aktiviert wird:

- Das aktuell ausgewaehlte Breadcrumb-Territorium ist das Ziel.
- Aus dessen relevanten Unterflaechen wird automatisch eine Aussengrenze gebildet.
- Die Union wird clientseitig mit `polygonClipping.union(...)` erzeugt.
- Das Ergebnis wird sofort als Vorschau auf der Karte angezeigt.
- Das Thumbnail zeigt die resultierende Landesgrenze verkleinert.

Wenn `Fuer alle Unterregionen erzeugen` aktiviert wird:

- Nicht nur fuer das aktuell ausgewaehlte Breadcrumb-Territorium wird eine derived geometry erzeugt.
- Auch fuer untergeordnete Parent-Territorien mit eigenen Kindern werden derived geometries erzeugt.
- Territorien der untersten Stufe brauchen normalerweise keine derived geometries.

Wichtige Regel:

Derived geometry wird nur gebraucht, wenn die sichtbare Flaeche eines Territoriums nicht direkt aus genau einer eigenen `political_territory_geometry` gerendert werden soll.

Deaktivieren:

Es muss weiterhin moeglich sein, `Aussengrenzen darstellen` abzuschalten. Dann wird die derived geometry fuer dieses Territorium deaktiviert oder geloescht, und das Parent-Territorium wird in der entsprechenden Zoomstufe nicht als abgeleitete Aussengrenze gerendert.

Client-Union:

Nutze vorhandene Client-Helfer, sofern passend:

- `window.polygonClipping.union(...)`
- `normalizeClippingMultiPolygon(...)`
- `clippingMultiPolygonToGeoJson(...)`
- `regionEntryToClippingMultiPolygon(...)`

Pruefe aber, ob die im Client geladenen Geometrien vollstaendig genug sind. Falls nicht, ergaenze eine API-Read-Funktion, die alle Quellgeometrien fuer ein Zielterritorium bzw. dessen Unterbaum liefert.

Backend/API:

Die politische API ist modularisiert. Relevante Dateien beim letzten Stand waren:

- `api/app/political-territories.php` als duenne Einstiegdatei
- `api/_internal/political/territories-endpoint.php`
- `api/_internal/political/territory.php`
- `api/_internal/political/assignment.php`
- `api/_internal/political/territories-layer.php`
- `api/_internal/political/territories-geometry.php`
- `api/_internal/political/territories-write.php`
- `api/_internal/political/territories-support.php`

Geplante API-Actions:

- `get_derived_geometry`
- `save_derived_geometry`
- `delete_derived_geometry`

Optional spaeter:

- `list_derived_geometries`
- `rebuild_derived_geometry`

Empfohlene Architektur:

- Neue Tabelle in `avesmapsPoliticalEnsureTables(...)` in `territory.php` anlegen.
- Neues Modul `api/_internal/political/territories-derived-geometry.php` fuer Fetch/Upsert/Delete/Response-Helfer anlegen.
- Dieses Modul in `territories-endpoint.php` require'n.
- Endpoint-Match um die neuen Actions erweitern.
- `territories-layer.php` so erweitern, dass aktive derived geometries in passenden Zoomstufen als politische Features ausgeliefert werden.
- Derived Features klar markieren, z. B. `source = political_territory_derived`, `feature_type = political_territory`, `is_derived_geometry = true`.

Labelposition:

Fuer derived geometries soll `label_lng`/`label_lat` gespeichert werden. Bevorzugt Polylabel / Pole of Inaccessibility. Fallback: bisherige Bounding-Box-Mitte. Die bestehende Funktion `avesmapsPoliticalComputeGeometryLabelCenter(...)` berechnet aktuell nur Bounding-Box-Mitte und kann verbessert werden.

Client-Dateien, die wahrscheinlich relevant sind:

- `index.html` fuer das neue Panel im `region-edit-form`
- `js/map-features/map-features.js` fuer Editorfluss, Vorschau und Speichern
- `js/map-features/map-features-political-territory-repository.js` fuer API-Aufrufe
- `js/map-features/map-features-region-rendering.js` fuer Rendering
- `js/map-features/map-features-region-feature-normalization.js` fuer Feature-Normalisierung
- `js/map-features/map-features-region-geometry-helpers.js` fuer GeoJSON/Clipping-Konvertierung
- `js/map-features/map-features-region-boolean-geometry.js` fuer Boolean-Operationen

Arbeitsweise:

1. Zuerst aktuellen Stand von `master` lesen.
2. `docs/derived-territory-geometry-plan.md` lesen.
3. Pruefen, ob sich relevante Dateien seit der Dokumentation geaendert haben.
4. Kleine, nachvollziehbare Commits machen.
5. Nach jedem groesseren Schritt `docs/derived-territory-geometry-plan.md` oder ein Arbeitsprotokoll aktualisieren.
6. Nach Aenderungen konkret sagen:
   - welche Dateien geaendert wurden
   - welche neue API/DB-Struktur entstanden ist
   - wie lokal getestet werden soll
   - welche PowerShell-Schritte der Nutzer ausfuehren soll

Aktueller fachlicher Konsens:

- Detailflaechen bleiben Quelle.
- Parent-Aussengrenzen werden automatisch als derived geometries gespeichert.
- Unterste Territorien brauchen normalerweise keine derived geometries.
- Die Union wird clientseitig mit `polygonClipping.union(...)` erzeugt.
- Das neue Editor-Panel heisst `Geometrie`.
- `Aussengrenzen darstellen` aktiviert Vorschau und Speichern der derived geometry.
- `Fuer alle Unterregionen erzeugen` erzeugt auch fuer untergeordnete Parent-Territorien derived geometries.
- Deaktivieren muss moeglich bleiben, damit ein Parent in einer Zoomstufe nicht als Aussengrenze gerendert wird.

Setze die Implementierung schrittweise um. Beginne nicht blind mit grossen Aenderungen, sondern lies zuerst den aktuellen Stand und erstelle dann den kleinsten sauberen Patch.
```
