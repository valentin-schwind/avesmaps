# Karten-API, Fassung 1 (WI-0280)

Für Werkzeuge, die Karten von Avesmaps holen: alle Kartenserien als PNG und die Vektorkarte als SVG, immer im ZIP. Einen Schlüssel stellt aus, wer das Fenster sehen darf: Admins, Betreiber und Editoren mit der Sonderrolle Kartograph (Hauptmenü › „Karten herunterladen …“ › „Weitergeben“); er gilt nur für die angehakten Karten, nur in dieser Umgebung und bis zu seinem Ablauf.

🔴 Das ist ein Vertrag nach außen (Planung Kap. 4.27, 11.15). Felder kommen nur dazu, keines ändert seine Bedeutung; was sich sonst ändern müsste, wird `/api/v2`. Quelle der Schemata: `packages/shared/src/karten-export.ts`. Der Vertragstest: `apps/server/test/karten-export.test.ts`.

```bash
curl --fail-with-body -H "Authorization: Bearer $AVESMAPS_KEY" https://avesmaps.de/api/v1/karten
```

```bash
curl --fail-with-body -C - -H "Authorization: Bearer $AVESMAPS_KEY" -o karten.zip "https://avesmaps.de/api/v1/karten/paket.zip?ids=original,svg-roh"
```

| Weg | Antwort |
|---|---|
| `GET /api/v1/karten` | `{ vertrag, jetzt, laeuftAb, karten[] }`: was dieser Schlüssel darf, je Karte `id`, `art` (`png`, `svg`), `name`, `beschreibung`, `datei`, `bytes` (`null`: liegt hier nicht vor), `stand`, `fassung`, `pixel`, `sha256`, `nurEditoren` |
| `GET /api/v1/karten/{id}.zip` | eine Karte im ZIP |
| `GET /api/v1/karten/paket.zip?ids=a,b` | mehrere Karten in einem ZIP |
| `GET /api/v1/karten/svg-export[?smooth=1]` | die Vektorkarte ohne ZIP als `image/svg+xml`: roh (`svg-roh`) oder mit `?smooth=1` geglättet (`svg-glatt`); der Schlüssel braucht die jeweilige Kennung. Nachfolger von Legacys `api/svg-export.php`, für die Terrain-Pipeline |

**Kennungen:** die Kartenserien (`original`, `old`, `modern`, neue kommen von selbst dazu), `svg-roh`, `svg-glatt`, eigene Abzüge `svg-eigen-<12 Hex>`.

**Anmeldung:** nur im Kopf, `Authorization: Bearer avk_…`, nie in der Adresse. Fremde Browser-Seiten bekommen keine CORS-Kopfzeilen: Ein Schlüssel gehört nicht in eine Webseite.

**Das ZIP** ist ungepackt (PNG ist schon gepackt) und für dieselben Dateien byte-gleich. Es enthält die Dateien, `LIZENZ.txt` und das DSA-Fanprojekt-Logo; die Lizenz des Kartenpakets verlangt bei jeder Verbreitung die Lizenz oder ihre volle Adresse.

| Kopfzeile | Bedeutung |
|---|---|
| `ETag`, `X-Avesmaps-SHA256` | dieselbe Prüfsumme des ZIP; `If-None-Match` nimmt beide Formen und antwortet `304` |
| `Accept-Ranges`, `Range` | Fortsetzen eines abgebrochenen Downloads (`206`, sonst `416`) |
| `X-Avesmaps-Kartenfassung` | die Fassung der Karte, wenn ein SVG dabei ist |
| `X-Avesmaps-Variante`, `X-Avesmaps-Quelle`, `X-Avesmaps-Exported-At`, `Last-Modified` | nur bei `svg-export`: `roh` oder `glatt`; wer den Abzug erzeugt hat (`routine`, `manuell`); wann |

| Fehler | Bedeutung |
|---|---|
| `401 unauthorized` | Schlüssel fehlt, falsch, abgelaufen oder widerrufen; mit Absicht nicht zu unterscheiden |
| `403 not_in_scope` | Dieser Schlüssel gilt nicht für diese Karte |
| `404 export_not_available` | Die Datei liegt auf diesem Server nicht vor. Es gibt nie ein kleineres oder ersatzweise anderes ZIP |
| `400 invalid_request` | Die Kennungen sind ungültig |
| `416 range_not_satisfiable` | Der Bereich liegt außerhalb der Datei |
| `429 too_many_requests` | Gerade laufen zu viele Downloads; `Retry-After` sagt, wann es weitergeht |

Fehler kommen als `{ "error": { "code": "…", "message": "…" } }`. Ausnahme `svg-export`: Fehlt der Abzug, antwortet er `404` wie Legacy flach mit
`{ "error": "export_not_available" | "smooth_export_not_available", "message": "…" }` und liefert nie ersatzweise die andere Fassung.

## Die Vektorkarte

Namensraum `xmlns:avm="https://avesmaps.de/ns/export/1"`, Vokabular wie in Legacy (`docs/svg-export-semantik-uebergabe.md` im Legacy-Repository) und dazu: `viewBox="0 0 1024 1024"`, Abbildung `x_svg = x`, `y_svg = 1024 − y` auf `aventuria-v1`, bei 32.768 px also deckungsgleich mit den PNGs. Jedes Element trägt `avm:kind`, `avm:type`, wo zutreffend `avm:ebene`, `avm:klima`, `avm:relief`, `avm:hoehe`, `avm:name`. `<desc id="avm-vokabular">` im Kopf erklärt als JSON jede Vokabel, die die Datei benutzt.

- `svg-roh`: Stützpunkte wie in den Daten, nur `M L Z`.
- `svg-glatt`: Kurven wie auf der Karte, nur `M L C Z` (absolut). Herrschaftsgebiete bleiben eckig: Eine gerundete Grenze verschiebt Land zwischen Reichen. `avm:geglaettet` und `avm:flaechen_geglaettet` im Wurzelelement sagen, was gilt.
- Neu gegenüber Legacy: `avm:kind="landmarke"` in der Orts-Ebene, `avm:landschaft`, `avm:eigene_hoehe`, `avm:importstand`, im Vokabular `arten` und `ebenen`.
- Anders als in Legacy: Herrschaftsgebiete tragen ihre echte Art (`avm:type="Baronie"`) in der feinsten Stufe statt `region` für die großen Reiche. Seewege und verborgene Orte stehen nicht drin, Wege ohne echten Namen haben keine Beschriftung. Die Klimabänder heißen `avm:id="polar"` statt einer UUID.

Die festen Abzüge entstehen täglich, wenn sich die Karte geändert hat; sie liegen also höchstens einen Tag hinter ihr. Ob sich etwas geändert hat, sagt `fassung` in der Liste, ohne dass man etwas laden muss.
