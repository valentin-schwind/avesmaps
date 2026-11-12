# Entwickler-API, Fassung 1 (WI-0303 P7)

Für Werkzeuge, die mit der Karte von Avesmaps arbeiten: alle Orte, ein Ort mit Wiki-Artikel und Gebieten, die Suche nach Orten und eine Reise
zwischen Orten. **Ohne Schlüssel und ohne Anmeldung**, für jede Herkunft offen: Jede Antwort trägt `Access-Control-Allow-Origin: *`, eine
Webseite auf einer fremden Domain kann die Wege also direkt aus dem Browser rufen. Der Browser schickt dabei nie Cookies mit; ein Aufruf
sieht genau, was `curl` sieht.

🔴 Das ist ein Vertrag nach außen (Planung Kap. 4.27, 11.15). Felder kommen nur dazu, keines ändert seine Bedeutung; was sich sonst ändern
müsste, wird `/api/v2`. Werte, bei denen „Neue Werte können dazukommen“ steht (`art`, `hinweise`), muss ein Client tolerant lesen: einen
unbekannten Wert überspringen, nicht abbrechen. Quelle der Schemata: `packages/shared/src/entwickler-api.ts`; maschinenlesbar als
OpenAPI 3.1 unter `GET /api/v1/openapi.json`.

```bash
curl --fail-with-body "https://avesmaps.de/api/v1/suche?q=Gareth"
```

```bash
curl --fail-with-body "https://avesmaps.de/api/v1/route?von=Gareth&nach=Perricum&ueber=Hartsteen"
```

| Weg | Antwort |
|---|---|
| `GET /api/v1/orte` | `{ vertrag, anzahl, orte[] }`: alle sichtbaren Orte, je Ort `id`, `name`, `art`, `x`, `y`, nach Namen sortiert |
| `GET /api/v1/orte/{id}` | `{ vertrag, id, name, art, x, y, wiki?, gebiete? }`: `wiki` ist `{ url, titel? }` in Wiki Aventurica; `gebiete` sind Ketten vom größten zum kleinsten Gebiet (`[[{ id, name, art? }]]`), mehr als eine, wo Ansprüche nebeneinanderstehen |
| `GET /api/v1/suche?q=…[&limit=…]` | `{ vertrag, anfrage, treffer[], gekuerzt }`: Orte, deren Name zur Anfrage passt, die besten zuerst; je Treffer dieselben Felder wie in der Liste. Vorgabe 10 Treffer, höchstens 20; unter zwei Zeichen leer |
| `GET /api/v1/route?von=…&nach=…` | eine Reise, siehe unten |
| `GET /api/v1/openapi.json` | dieser Vertrag als OpenAPI 3.1 |

**Orte** haben eine dauerhafte Kennung (`id`, UUID). `art` ist die Ortsklasse: `metropole`, `grossstadt`, `stadt`, `kleinstadt`, `dorf`,
`gebaeude`, `stadtviertel` und weitere; neue Werte können dazukommen. Verborgene Orte stehen in keiner Liste und keiner Suche; über ihre
Kennung sind sie zu lesen und zu bereisen, wie auf der Karte.

**Koordinaten** sind Karteneinheiten auf der gezeichneten Karte, keine Länge und Breite: `x` wächst nach Osten, `y` nach Norden, beide
von 0 bis 1024, der Ursprung liegt in der Südwestecke. Eine Einheit sind 3 Meilen. Leaflet mit `L.CRS.Simple` erwartet `[y, x]`.

## Reise

| Parameter | Bedeutung |
|---|---|
| `von`, `nach` | Pflicht. Die Kennung eines Ortes oder sein genauer Name. Groß- und Kleinschreibung und Akzente sind egal, solange genau ein Ort passt |
| `ueber` | Zwischenhalte in Reihenfolge, getrennt mit `~` (Ortsnamen enthalten Kommas), höchstens 10. Ein Halt ist Pflicht, keine Vorliebe: Die Reise geht von Halt zu Halt |
| `optimierung` | `schnellste` (Vorgabe) oder `kuerzeste` |
| `wege` | Welche Wege erlaubt sind, kommagetrennt aus `land`, `fluss`, `see`; Vorgabe alle drei. Querfeldein gehört zu `land` |

Gerechnet wird wie in der Vorgabe des Reiseplaners auf der Karte: als Reisegruppe zu Fuß, auf Flüssen mit dem Flusssegler, auf See mit dem
Lastensegler, 8 Reisestunden je Tag an Land.

| Feld | Bedeutung |
|---|---|
| `gefunden` | `false`, wenn es keine Route gibt; das ist eine Antwort, kein Fehler. `grund` sagt dann `kein_zusammenhang` oder `gesperrt` |
| `orte` | die Orte der Reise in Reihenfolge (`id`, `name`) |
| `meilen` | die ganze Strecke |
| `reisestunden`, `raststunden`, `gesamtstunden`, `reisetage` | die reine Reisezeit, die Rast dazwischen, beides zusammen, und die Tage |
| `stundenProTag` | die Reisestunden je Tag an Land, mit denen gerechnet wurde |
| `etappen[]` | je Etappe `art` (Wegart, etwa `Reichsstrasse`, `Strasse`, `Weg`, `Pfad`, `Seeweg`, `Querfeldein`), `mittel` (das Reisemittel), `wege` (Namen der Wege), `von` und `nach` (`x`, `y`), `meilen`, `reisestunden`, `raststunden` |
| `linie` | der Verlauf der ganzen Reise als `[x, y]`-Punkte |
| `hinweise` | `querfeldein` (ein Stück führt ohne Weg über Land), `keine_freie_see` (die See war erlaubt, aber für das Schiff gibt es hier keine Seefahrt); neue Werte können dazukommen |

Strecken und Zeiten sind auf zwei Stellen gerundet.

## Fehler

Fehler kommen als `{ "error": { "code": "…", "message": "…", "details": { … } } }`; `details` nur, wo es unten steht. Entscheiden Sie am
`code`, nie am Satz.

| Fehler | Bedeutung |
|---|---|
| `400 validation_failed` | Die Anfrage passt nicht zum Vertrag; `details.issues` nennt die Stellen (`path`, `rule`), nie den Wert |
| `404 not_found` | Diesen Ort gibt es nicht |
| `404 place_not_found` | Ein Ort der Reise ist unbekannt oder sein Name nicht eindeutig; `details.feld` ist `von`, `nach` oder `ueber`, bei `ueber` mit `details.index` (ab 0) |
| `410 api_gone` | Die alte Schnittstelle (siehe unten); `details.doku` und `details.nachfolger` sagen, wo es weitergeht |
| `422 route_too_large` | Die Reise ist größer, als eine Antwort sein darf |
| `429` | Zu viele Anfragen von dieser Adresse; `Retry-After` sagt, wann es weitergeht. Kommt vom Webserver; lesen Sie den Status, nicht den Rumpf |
| `503 server_busy`, `503 routing_unavailable`, `503 database_unavailable` | Gerade nicht bedienbar; `Retry-After` sagt, wann es weitergeht |

## Grenzen

Ohne Schlüssel schützt allein die Drossel des Webservers vor Last: Reisen und übrige Wege haben je Adresse eigene Grenzen pro Minute, darüber
antwortet er `429` mit `Retry-After`. Bitte zwischenspeichern: `GET /api/v1/orte` darf 5 Minuten alt sein, ein einzelner Ort 1 Minute
(`Cache-Control`).

## Die alte Schnittstelle

Die Entwickler-API von Avesmaps Legacy gibt es nicht mehr. `POST /api/route/`, `POST /api/route.php` und `GET /api/locations/` antworten
`410 api_gone` mit dem Nachfolger: `GET /api/v1/route` für die Reise, `GET /api/v1/orte` für die Ortsliste. Was sich geändert hat:

- Die Reise ist ein `GET` mit Parametern statt eines `POST` mit JSON; `from`, `to`, `via` heißen `von`, `nach`, `ueber`.
- Ein Ort ist über seine Kennung oder seinen genauen Namen anzugeben; die Kennung ist sicherer, Namen können sich ändern.
- Felder heißen deutsch, Strecken stehen in Meilen statt in Karteneinheiten.
- Fehler kommen ohne `ok`-Feld; der HTTP-Status sagt, ob es geklappt hat.

## Lizenz

Die Antworten enthalten Namen, Lagen und Gebiete aus der Karte und dem Schwarzen Auge. Sie stehen nicht unter der Lizenz des Quelltexts;
was gilt, steht in `LEGAL.md` und `NOTICE.md` des Zweigs `avesmaps3d` im öffentlichen Repository.
