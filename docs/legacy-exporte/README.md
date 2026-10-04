# Legacy-Exporte E1–E5 für Avesmaps3D — Beispielantworten

Auftrag von Avesmaps3D vom 04.10.2026 (`project-control/legacy-requests/2026-10-04-infopanel-domaenen-und-medien-exporte.md`
im Repo avesmaps3D), freigegeben vom Betreiber. Die vollständige Beschreibung der Felder steht in `api/README.md`,
Abschnitt „Legacy exports for Avesmaps3D (E1–E5)".

Jede Datei hier ist eine **gekürzte** Antwort: Kopf, Zähler, zwei Einträge je Liste. Sie stammt aus den Testdaten,
nicht aus der laufenden Instanz, und enthält keine echten Personendaten (Login-Namen, Notizen und Urheber sind
Platzhalter). Die Form der Beispiele prüft der jeweilige Test gegen die wirkliche Ausgabe der Bibliothek: kommt ein
Feld dazu oder fällt eines weg, wird der Test rot, bis das Beispiel nachgezogen ist.

| Datei | Endpunkt | Export | Test |
|---|---|---|---|
| `feature-sources-export.beispiel.json` | `GET /api/app/feature-sources-export.php` | E1+ | `api/_internal/app/__tests__/quellen-export-test.php` |
| `wiki-redirects-export.beispiel.json` | `GET /api/app/wiki-redirects-export.php` | E1++ | `api/_internal/app/__tests__/quellen-export-test.php` |
| `lore-export.beispiel.json` | `GET /api/app/lore-export.php` | E2, E2+ | `api/_internal/app/__tests__/lore-export-test.php` |
| `location-reviews-export.beispiel.json` | `GET /api/app/location-reviews-export.php` | E3 | `api/_internal/app/__tests__/bewertungen-export-test.php` |
| `political-territories-export.beispiel.json` | `GET /api/app/political-territories-export.php` | E4 | `api/_internal/app/__tests__/political-territories-export-detail-test.php` |
| `media-export.beispiel.json` | `GET /api/app/media-export.php` | E5 A (öffentlich) | `api/_internal/app/__tests__/medien-export-test.php` |
| `media-export-migration.beispiel.json` | `GET /api/edit/migration/media-export.php` | E5 B, E5+ (nur Admin) | `api/_internal/app/__tests__/medien-export-test.php` |

E1 (`wiki_key` am Quellenkatalog der Kartennutzlast) braucht kein eigenes Beispiel: der Katalogeintrag einer
URL-losen Publikation sieht jetzt so aus —
`"1234": {"url": "", "label": "Geographia Aventurica", "type": "regionalspielhilfe", "official": true, "wiki_key": "wiki:geographia-aventurica"}`.
Ohne Wiki-Schlüssel fehlt das Feld (wie Lizenz und Namensnennung).

Der schreibfreie Katalog-GET der Kartensammlung (`GET /api/app/citymaps.php`) ändert seine Antwort nicht; sein Test ist
`api/_internal/app/__tests__/citymaps-get-schreibfrei-test.php`.

⚠️ Ein Abruf gegen die laufende Instanz und ein produktiver Datenzug brauchen einen eigenen Zuruf des Betreibers —
je Quelle und Zug höchstens ein Abruf, nie in einer Schleife.
