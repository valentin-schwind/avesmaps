# Versteckte Orte — Entwurf

**Stand:** 2026-08-15 · **Owner-Entscheide:** 2026-08-15 (§2) · **Status:** Entwurf, freigegeben

---

## 1. Worum es geht

Ein Ort bekommt ein drittes Merkmal neben *Nodix* und *Ruine*: **versteckt**.

> Wer den Namen kennt, findet ihn; wer nur über die Karte scrollt, nicht.

Versteckt heißt konkret drei Dinge, und nur diese drei:

1. **Die Karte zeichnet ihn nicht** — weder Markierung noch Namensschild.
2. **Die Routenfindung fährt ihn nicht an** — er ist kein Ausstieg, kein Brückenkopf, kein
   Zwischenziel, das sich von selbst ergibt.
3. **Er bleibt auffindbar** — über Spotlight und die Wegpunktsuche, unter seinem Namen.

Der Owner, wörtlich: *„wenn kein weg hinfuehrt, ist das meiste eine bewusste entscheidung, weil der
ort versteckt und vergessen wurde"* — und, ebenso wörtlich: *„versteckt kann auch sein, was auf einem
weg liegt."*

🔴 **Das Verstecken hängt NICHT an der Weganbindung.** Es ist ein eigenes, von Hand gesetztes
Merkmal. Ein Ort mitten an der Reichsstraße kann versteckt sein, ein Ort ohne jeden Weg muss es
nicht. Wer die beiden koppelt, baut eine Ableitung, die der Editor nicht mehr übersteuern kann.

Bei der Gelegenheit erbt **Ruine** dieselbe Darstellungsform im Spotlight (§5).

---

## 2. Was der Owner entschieden hat (15.08.2026)

| Frage | Entscheid | Folge |
|---|---|---|
| Startzustand | **Nichts ändert sich.** Feld steht überall auf „nicht versteckt". | ⛔ **Kein Migrationslauf.** Die ursprünglich erwogene Einmal-Setzung „alle Orte ohne Weganbindung auf versteckt" ist **verworfen**. Am Tag 1 sieht die Karte exakt aus wie heute. |
| Nach dem Fund | **Bleibt für diesen Besuch sichtbar.** | Aufgedeckt wird sitzungsweit, nicht dauerhaft. Ein Neuladen versteckt ihn wieder. Kein `localStorage`, kein URL-Parameter, kein Serverzustand. |
| Vorbeifahren | **Still vorbei.** | Liegt er an einer Straße, fährt die Reise hindurch; sein Name steht nicht in der Etappenliste. |

Zwei weitere Punkte habe ich selbst entschieden und dem Owner angesagt:

* **Editoren bekommen einen Haken „Versteckte Orte"** im Auge-Menü, neben „Nodices" und
  „Unverbunden". Ohne ihn könnte niemand mehr sehen, was er versteckt hat.
* **Die Wegpunktsuche bietet versteckte Orte an**, gekennzeichnet — sonst wäre sie strenger als das
  Spotlight, das der Owner ausdrücklich mit „Versteckt"-Zeile haben will. Beides sind Suchen, kein
  Scrollen über die Karte.

---

## 3. Das Feld

Ein Merkmal, überall gleich benannt, dem Muster von `is_nodix`/`is_ruined` folgend:

| Ebene | Name |
|---|---|
| Speicher | `properties_json.is_hidden` in `map_features` |
| API (lesen/schreiben) | `is_hidden` |
| Frontend-Objekt | `location.isHidden` |
| Auge-Menü | `#toggleHidden` / `#toggleHiddenControl` |

⚠️ **Es ist keine Spalte.** `is_nodix` und `is_ruined` liegen im JSON-Blob `properties_json`, nicht
als eigene Spalten (`api/_internal/map/features.php:3006-3007`) — nur die *Wiki*-Siedlungstabelle hat
eine echte `is_ruined`-Spalte (`api/_internal/wiki/settlements.php:50`). Es gibt also **keine DDL,
kein `ALTER TABLE`, keine Migration.** Ein Feld, das in keiner Zeile steht, liest sich als `false`.

⚠️ **Der Wert wird IMMER geschrieben, auch `false`** — genau wie seine beiden Nachbarn. Die Variante
„nur bei `true` schreiben" spart am Vollbestand rund 79 KB in einer 21-MB-Nutzlast (0,4 %) und kauft
sich dafür eine Falle ein: das Zurücknehmen müsste den Schlüssel *entfernen* statt ihn zu setzen, und
ein vergessenes `unset` sähe aus wie ein Speichern, das nichts tut. Nicht wert.

⭐ **Die Kartennutzlast braucht keine Zeile Code.** `api/app/map-features.php:436-496` reicht
`properties_json` unverändert durch; nur `svg_id` wird gestrichen
(`avesmapsNormalizeLegacyMapFeatureProperties`, :518). Ein neuer Schlüssel erreicht den Browser von
allein.

### 3.1 Wo das Feld durchgereicht werden muss

Diese Stellen tragen `is_nodix`/`is_ruined` heute und bekommen `is_hidden` daneben:

* `api/_internal/map/features.php` — Schreibpfad `:1273-1274`, Antwortbau `:1329-1330` und `:1360-1361`,
  Anlegen `:2330`, Teilaktualisierung `:2455-2456`, Punkt-Antwort `:3006-3007`.
* `js/map-features/map-features-location-editing.js` — `:274`, `:379` und die Nutzlast in
  `applyLiveLocationFeature` (~`:412`).
* `html/wiki-sync-settlement-editor.html` — Detailzeile `:1277`, Formularhaken `:1393/:1395`,
  Speichernutzlast `:1646-1647`.
* `js/routing/routing.js:109-110` — von der Nutzlast in `locationData`.

🔴 **Und eine Stelle mehr, die keinen der beiden trägt:**
`avesmapsBuildRouteLocationData` (`api/_internal/routing/network-data.php:222-245`) baut die
Ortsobjekte des Routers aus einer **ausgeschriebenen Feldliste** — `id`, `public_id`, `name`,
`subtype`, `feature_type`, `geometry`, `properties`. `is_nodix` und `is_ruined` stehen dort **nicht**,
weil der Router sie nie brauchte. `is_hidden` **muss** hinein, sonst kommt das Merkmal im Graphbau
nie an und der ganze Riegel aus §6 ist gebaut und wirkungslos. Das ist die Zeile, die man beim
Abschreiben von `is_ruined` garantiert übersieht.

---

## 4. Die Karte

### 4.1 Wo der Riegel sitzt

Zwei Funktionen entscheiden, ob ein Ort gezeichnet wird, und beide bekommen dieselbe Weiche:

* `shouldShowLocationMarker` (`js/map-features/map-features-location-marker-rendering.js:226`)
* `shouldShowLocationNameLabel` (`js/map-features/map-features-location-name-labels.js:38`)

Ein versteckter Ort wird **nicht** gezeichnet, **außer**:

1. der Editor-Haken „Versteckte Orte" ist an (nur `IS_EDIT_MODE`), **oder**
2. er ist in dieser Sitzung aufgedeckt (§4.3), **oder**
3. er ist der per Suche angepinnte Ort (`nearestLookupPinnedMarkerEntry`, schon vorhanden).

### 4.2 Wo der Riegel in der Kaskade steht

💣 **NACH den Prüfhaken, VOR allem anderen.** `shouldShowLocationMarker` hat eine feste Rangfolge:
Siedlungseditor-Filter → angepinnter Ort → Prüfhaken-Fund → Kreuzungen → Kraftlinien →
Hauptstädte → Ortsgrößen. Der Versteckt-Riegel gehört **hinter den Prüfhaken-Fund und vor die
Kreuzungsweiche**.

Der Grund steht schon im Bestand: *„Ein Prüfhaken ZEIGT seine Funde"* (Owner 2026-08-14,
Kommentarblock bei `:190`). Ein versteckter Ort **ohne Weganbindung** ist weiterhin eine
Anbindungslücke und muss seinen pinken Ring bekommen — sonst versteckt das neue Merkmal Befunde vor
genau dem Editor, der sie sucht. Stünde der Riegel darüber, wäre „versteckt" ein Weg, den Prüfhaken
stillzulegen.

⚠️ Umgekehrt gilt: **im Kraftlinien-Modus schlägt „versteckt" den Nodix-Zweig.** Ein versteckter
Nodix ist versteckt. Wer beides will, hakt „Versteckte Orte" an.

### 4.3 Die Aufdeckung

Ein Laufzeit-`Set` von `publicId`s, `avesmapsRevealedHiddenLocationIds`, in
`js/app/runtime-state.js` neben `nearestLookupPinnedMarkerEntry`. Nicht gespeichert, nicht in der
URL, nicht auf dem Server. Ein Neuladen leert es.

Gefüllt wird es an genau **drei** Stellen, und alle drei sind „jemand hat den Namen ausdrücklich
eingegeben":

1. ein Spotlight-Treffer wird gewählt,
2. ein Wegpunkt wird gesetzt (getippt, aus der Vorschlagsliste, oder aus einem geteilten Link),
3. ein geteilter Link adressiert den Ort direkt (`?pin=`).

⚠️ **Aufgedeckt wird ADDITIV, nie geleert.** Der Owner hat „bleibt für diesen Besuch sichtbar"
gewählt — die Menge wächst über die Sitzung. Ein Wegpunkt, der wieder entfernt wird, nimmt seine
Aufdeckung **nicht** zurück: man hat den Ort gefunden, das lässt sich nicht ungeschehen machen, und
ein Ort, der beim Löschen eines Wegpunkts von der Karte verschwindet, sähe wie ein Fehler aus.

### 4.4 Der Editor-Haken

`#toggleHidden` im Auge-Menü, nach demselben Muster wie `#toggleNodix`:

* Beschriftung „Versteckte Orte", Zeile `#toggleHiddenControl` in `index.html` (neben `:2510`),
  `hidden` bis der Editmodus ihn freischaltet (`js/app/bootstrap.js:379-384`).
* Standard `false` in `DEFAULT_PLANNER_STATE` (`js/config.js:682-684`).
* URL-Parameter nur im Editmodus (`js/map-features/map-features-layer-state.js:109-111`, `:285-301`).
* `change`-Handler neben den anderen (`js/map-features/map-features.js:137-145`).
* Der Ring-freie Fall: ein versteckter Ort trägt **keine** eigene Markierung, kein eigenes Symbol. Er
  sieht aus wie jeder andere Ort — der Haken ist die Auskunft, nicht die Optik. (Ein vierter Rington
  neben pink und türkis würde die Bedeutung der Prüfhaken verwässern; die *Auskunft* „versteckt"
  steht in der Infobox und im Spotlight.)

---

## 5. Spotlight und Wegpunktsuche

### 5.1 Die dritte Zeile

```
Feenplatz                      BESONDERES BAUWERK / STÄTTE
                                                 Versteckt
```

⭐ **Das ist kein neuer Mechanismus.** `spotlightResultMarkup`
(`js/ui/spotlight-search.js:851-873`) hat den Hinweis-Platz seit den Innerorts-Treffern: ein
`<span class="spotlight-search__result-hint">` als `display:block` **innerhalb** der Typangabe.
Ortstreffer haben ihn bisher nie belegt.

⚠️ **Die dritte Zeile steht rechts unter der Typangabe, nicht linksbündig unter dem Namen.** Die
Trefferzeile ist ein Grid `minmax(0,1fr) auto` — Name links, Typspalte rechts. Die Owner-Skizze
stapelt die drei Angaben untereinander; gebaut wird die vorhandene Form, weil die Alternative eine
zweite Trefferzeilen-Rezeptur wäre (siehe AGENTS.md §11: „Die Listenzeile — es gibt ZWEI, und das ist
die Obergrenze").

Belegt wird sie für **beide** Merkmale:

| Zustand | dritte Zeile |
|---|---|
| Ruine | `Ruine` |
| versteckt | `Versteckt` |
| beides | `Ruine · Versteckt` |

Ein Trenner, kein Umbruch — die Zeile bleibt einzeilig (`white-space: nowrap`, siehe §5.2).

i18n-Schlüssel `spotlight.hidden` und `spotlight.ruined`, deutsche Vorgabe im Aufruf
(AGENTS.md §8: nicht inline übersetzen, in die Tabelle legen).

### 5.2 Zwei CSS-Fallen, beide gemessen

💣 **Die Verbreiterung hängt an der falschen Bedingung.**
`css/components/spotlight-search.css:101` verbreitert die Typspalte von 150 px auf 240 px — aber die
Regel lautet `.spotlight-search__result--not-on-map .spotlight-search__result-type`, und diese Klasse
kommt von `entry.notOnMap`. Ein versteckter Ort **ist** auf der Karte (er hat einen echten Punkt), er
bekäme die Klasse also nicht — und die Ellipse bei 150 px fräße genau das Wort „Versteckt", das die
Zeile rechtfertigt.

Die Bedingung ist in Wahrheit **„dieser Treffer hat zwei Zeilen"**, nicht „dieser Treffer liegt
woanders". Also: eine Klasse `.spotlight-search__result--two-line`, gesetzt wenn `hintText` nicht
leer ist, und die 240-px-Regel hängt daran. `--not-on-map` behält seine eigene Aufgabe (der
gedämpfte Ton für Treffer, die woanders hinspringen) und verliert nur die Breite.

⚠️ **`white-space` bleibt `nowrap`.** Der Kommentarblock über der Regel begründet das ausführlich:
mit `normal` fällt die `auto`-Spalte auf ihre Minimalbreite (gemessen 69 px statt 120 px), beide
Angaben brechen um, die Zeile wird 54 px statt 27 px hoch. Die zwei Zeilen entstehen durch
`display:block` am Hinweis, nicht durch Umbruch.

💣 **Der Hinweis steht auf 10 px und damit unter der Untergrenze.** `:109` setzt
`font-size: 10px`. AGENTS.md §12 kennt eine 11-px-Untergrenze, und §11 nennt genau diesen Fehler als
Wanderfehler beim Abschreiben (`.se-row-type`/`.se-row-l2`). Ich hebe ihn auf **11 px**. Das ist eine
Korrektur an einer bestehenden Regel, keine neue — sie betrifft auch die vorhandenen
Innerorts-Hinweise, und das ist beabsichtigt.

### 5.3 Die Divergenz, die ich NICHT anfasse

🪤 Es gibt bereits ein „(Ruine)" im Bestand: `locationTypeLabelForDisplay`
(`js/map-features/map-features-location-marker-entry.js:13-41`) hängt es an die Typzeile der Infobox.
Es liest **`wikiSettlement.is_ruined`**, also das aus dem Wiki gecrawlte Feld — **nicht** das eigene
`is_ruined` des Kartenpunkts. Und es hängt nur an einer *Art* (Ortsart oder Bauwerkstyp), nie an der
bloßen Ortsgröße.

Die neue Spotlight-Zeile liest das **eigene** Feld des Kartenpunkts. Die beiden können also
auseinanderlaufen: ein Kartenpunkt mit `is_ruined = true` ohne verbundene Wiki-Siedlung bekommt die
Spotlight-Zeile, aber kein „(Ruine)" in der Infobox.

**Das bleibt so.** Der Kommentar über der Funktion sagt es selbst: *„Beides wäre vertretbar zu
ändern — aber nicht nebenbei in einem Commit, der die Typzeile umbaut."* Dasselbe gilt hier. Die
Divergenz wird benannt, nicht heimlich geheilt. 🔧 **Owner-Frage für später:** soll die Infobox das
eigene Feld lesen?

### 5.4 Wegpunktsuche

Die Wegpunkt-Vorschläge sind **jQuery UI**, nicht die Spotlight-Komponente
(`initializeWaypointAutocomplete`, `js/map-features/map-features-waypoints.js:310`). Dort gibt es
keine dritte Zeile — die Liste besteht aus `{label, value}`-Paaren
(`getWaypointAutocompleteSource`, `:185-220`).

Die Kennzeichnung reist deshalb im **Label**, nach dem Muster, das dort schon steht: das
Innerorts-Objekt zeigt `Schänke Schnapsfass (Imdal)` und schreibt `Imdal` ins Feld. Analog:
`Feenplatz (versteckt)` als Label, `Feenplatz` als Wert.

💣 **Niemals einen blanken String zurückgeben** — jQuery UI normalisiert die ganze Liste am **ersten**
Eintrag (`_normalize: t[0].label && t[0].value ? t : map(…)`). Steht ein `{label, value}`-Paar vorn,
gehen blanke Strings unverändert durch und erscheinen als `[object Object]`. Der Bestand hält das
schon ein (Kommentar bei `:212`); die neue Zeile darf es nicht brechen.

---

## 6. Der Router — die gefährliche Hälfte

### 6.1 Was NICHT geht

💣 **Einen versteckten Ort aus der Ortsliste des Graphbaus zu streichen, zerstört Straßen.**

`avesmapsAddClientCompatiblePathConnection` (`api/_internal/routing/client-graph.php:173`) sucht für
beide Enden eines Wegs den Ort, der dort liegt — und bei `:180` steht:

```php
if (!is_array($startNode) || !is_array($endNode)) return;
```

**Ein Weg, dessen Endpunkt auf keinem bekannten Ort liegt, wird komplett verworfen.** Wer den
versteckten Ort aus `$locations` nimmt, löscht damit *jede Straße, die an ihm endet* — und wenn zwei
Straßen sich an ihm treffen, zerfällt der Graph, worauf der Notbrückenbauer eine ×25-Querfeldein-Kante
darüberlegt. Aus „ein Ort wird nicht angefahren" würde „die Gegend ist nicht mehr erreichbar".

Dasselbe gilt für den Innen-Vertex-Split (`:203-222`): ein versteckter Ort **an** einer Straße muss
weiter als Knoten in ihr sitzen. Sonst wäre er, obwohl er buchstäblich auf der Straße liegt, nur über
einen Querfeldein-Sprung erreichbar — absurd, und teuer.

🔴 **Also: der versteckte Ort bleibt vollständig im Graphen.** An der Verbindungsstruktur ändert sich
**nichts**. Kein Weg wird anders gebaut, kein Knoten fällt weg, keine Kante ändert ihr Gewicht.

### 6.2 Was stattdessen geht: die Kandidatenliste

Was ein versteckter Ort verliert, ist nicht seine Existenz im Graphen, sondern seine Rolle als
**Kandidat**. Vier Erzeuger wählen Orte aus, um synthetische Kanten an sie zu hängen:

| Erzeuger | Datei | Was er wählt |
|---|---|---|
| `avesmapsFindNearestOffroadExitNodes` | `offroad-leg.php:60` | die 12 nächsten Ortschaften als Querfeldein-Ausstieg |
| `avesmapsConnectClientCompatibleDetachedGraphComponents` | `client-graph.php:649` | Ortspaare für Notbrücken zwischen Graphinseln |
| `avesmapsConnectClientRouteWaypointsToNearestLandPath` | `client-graph.php:762` | **nur Wegpunkte** — muss weiter funktionieren |
| `avesmapsConnectOffroadPoints` / Umweg-Sehnen | `offroad-leg.php`, `detour.php` | Sehnen zwischen Routenknoten |

**Der Riegel ist eine einzige gefilterte Liste, einmal gerechnet:**

```
candidate_locations = alle Orte
                      − versteckte Orte
                      + versteckte Orte, die in DIESER Anfrage
                        from / to / via sind
```

Gerechnet in `avesmapsBuildClientCompatibleRouteGraph` (`client-graph.php:111`), wo `$locations`
ohnehin in einer Schleife entsteht (`:113-128`), und **zurückgegeben** als
`$result['candidate_locations']` neben `graph` und `statistics`.

⭐ **Warum das ein Riegel und nicht vier ist.** Die Filterung passiert an *einer* Stelle; die
Erzeuger bekommen sie als Argument. Entscheidend ist die zweite Hälfte: **die ungefilterte Liste
verlässt den Graphbau nicht mehr.** Heute holt sich `response.php:239` die rohe Liste direkt aus
`$routeNetworkData['locations']` und reicht sie an die Querfeldein-Anbindung — genau daran wäre der
Riegel vorbeigelaufen. Künftig steht dort `$clientGraph['candidate_locations']`. Ein fünfter Erzeuger,
den es morgen gibt, greift nach dem, was der Graphbau herausgibt, und bekommt die gefilterte Liste,
ohne davon zu wissen.

💣 **Das ist die Falle vom 14.08.2026, wörtlich wiederholt.** Damals hatten die Querfeldein-Kanten
vier Erzeuger und die Verkehrsmittel-Sperre stand in zweien; die Kutsche fuhr über die Wiese. Der
Kommentar dort sagte „ERZEUGER 1 VON 2" — **und die Zahl war die eigentliche Falle**, denn eine Zahl
liest sich wie eine vollständige Liste. Die Kommentare hier tragen deshalb **keine Zahl**, sondern
den Satz: *die gefilterte Liste kommt aus dem Graphbau; wer die rohe Ortsliste anfasst, baut ein
Loch.*

⚠️ **Warum die Wegpunkte in der Liste bleiben müssen.**
`avesmapsConnectClientRouteWaypointsToNearestLandPath` (`:762-800`) sucht sich seine Namen selbst aus
`$request['from']`, `$request['to']`, `$request['via']`, schlägt sie aber in
`avesmapsBuildClientCompatibleLocationLookup($locations)` nach. Bekäme sie eine Liste ohne den
versteckten Wegpunkt, fiele der Ort bei `if (!is_array($location)) continue;` heraus — und ein
versteckter Ort ohne Weganbindung wäre als Ziel **unerreichbar**, also genau der Fall kaputt, den §1
ausdrücklich erhalten will. Deshalb ist die Ausnahme Teil der Filterregel, nicht ein Nachtrag beim
Aufrufer.

### 6.3 Was der Riegel NICHT ist

🔴 **Kein Eingriff in Dijkstra, kein Gewicht, keine Kostenänderung.** Der versteckte Ort ist ein
normaler Knoten mit normalen Kanten. Führt die beste Route über ihn, führt sie über ihn.

🔴 **Kein zweiter Riegel im Browser.** `createGraph` (`js/routing/route-graph-routing.js:230`) baut
zwar einen Graphen, wird für Routing aber nur bei `?clientrouting=1` erreicht
(`shouldUseServerPrimaryRouting`, `js/routing/route-engine.js:19-21`) — eine Debug-Hintertür. Sein
zweiter Aufrufer ist der **Prüfhaken-Index** (`computeLocationConnectivityIndex`, `:378`), und der
muss versteckte Orte **weiter sehen**: ein versteckter Ort ohne Weganbindung ist ein Editorbefund
(§4.2). Der JS-Graph bleibt also unangetastet — und das ist eine Entscheidung, keine Auslassung.

⚠️ **Orte ohne Weganbindung und ihre ×25-Notkanten bleiben unberührt** (Owner 15.08.2026). Kein
Entwurf, keine Absenkung des Faktors, keine Berührung der Wegfindung selbst.

---

## 7. Die Etappenliste

Der Owner hat „still vorbei" gewählt. Liegt ein versteckter Ort an einer Straße, ist er ein
Knoten der Route — die Straße ist an ihm geteilt (§6.1) —, und die Etappenliste nennt ihn.

Der Bestand hat dafür schon einen Reiniger: `cleanRoutePlanNoiseEntries`
(`js/routing/route-plan.js:616`) entscheidet an `isRoutePlanMarkerName` (`:547`), ob eine Etappe
geschlossen oder in die vorige absorbiert wird — heute für `Kreuzung` und `Markierung`.

Das Prädikat wird erweitert: **auch ein versteckter, in dieser Sitzung nicht aufgedeckter Ort ist
Lärm.** „Luring → Feenplatz → Spinnried" wird zu „Luring → Spinnried".

⚠️ **Genau dieselbe Aufdeckungsmenge wie §4.3**, keine zweite. Ein versteckter Ort, den man
ausdrücklich als Wegpunkt gesetzt hat, ist aufgedeckt und steht damit ganz normal in der Liste — was
er auch muss, sonst verschwände das eigene Reiseziel aus dem Reiseplan.

💣 **Die Reihenfolge ist tragend.** `nameRoutePlanTransferPoints` (`:734`) läuft **nach**
`cleanRoutePlanNoiseEntries`, weil jene an `isRoutePlanMarkerName(open.endName)` entscheidet, ob eine
Etappe schließt — der Kommentar bei `:727` sagt es ausdrücklich. Die Erweiterung ändert daran nichts,
darf die Reihenfolge aber auch nicht anrühren.

⚠️ `routePlanPlaceMarkup` (`:555`) nutzt dasselbe Prädikat für die Verlinkbarkeit. Ein absorbierter
Ort erreicht die Markup-Stufe gar nicht; ein aufgedeckter ist kein Lärm und bleibt verlinkbar. Beide
Fälle sind damit richtig, ohne eine zweite Abfrage.

---

## 8. Abnahme

💣 **Ablauf, nicht Maß** (AGENTS.md §9). Die Abnahme ist eine Folge von Handgriffen am lebenden
Objekt, keine Zahlentabelle:

1. Einen Ort mit Weganbindung im Siedlungseditor auf **versteckt** setzen, speichern.
2. Karte neu laden → **Markierung und Name sind weg**, an der Stelle ist Pergament.
3. Über die Stelle scrollen, hineinzoomen → er bleibt weg (kein Zoom deckt ihn auf).
4. Namen ins **Spotlight** tippen → er erscheint, **dritte Zeile „Versteckt"** ist lesbar und nicht
   abgeschnitten.
5. Treffer wählen → Karte springt hin, **Markierung ist da** (aufgedeckt).
6. Ihn als **Wegpunkt** setzen, Route dorthin planen → Route kommt an, Reiseplan nennt ihn.
7. Einen **zweiten** versteckten Ort anlegen, der **an einer Straße** liegt; eine Route quer darüber
   planen → er steht **nicht** in der Etappenliste, die Route ist unverändert lang.
8. Seite neu laden → beide sind wieder versteckt.
9. Als Editor **„Versteckte Orte"** anhaken → beide erscheinen; Haken weg → beide weg.
10. Eine Ruine im Spotlight suchen → dritte Zeile **„Ruine"**.
11. **Hell und dunkel** ansehen (AGENTS.md §12).

⚠️ Was ein Emulator nicht beantworten kann (echtes Touch-Verhalten am Telefon), wird als offene Frage
gemeldet, nicht als bestanden.

### 8.1 Tests

| Test | Was er festhält |
|---|---|
| `api/_internal/routing/__tests__/versteckte-orte-test.php` | ein versteckter Ort steht **nicht** in `candidate_locations`; als `to` der Anfrage steht er **doch** darin; sein Weg existiert weiterhin im Graphen (der Befund aus §6.1); die Route zu ihm kommt an |
| `js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js` | nicht gezeichnet · gezeichnet bei Editor-Haken · gezeichnet wenn aufgedeckt · Prüfhaken-Fund schlägt den Riegel |
| `js/ui/__tests__/spotlight-versteckt-zeile.test.js` | dritte Zeile bei versteckt, bei Ruine, bei beidem (`Ruine · Versteckt`); `--two-line` gesetzt |
| `js/routing/__tests__/versteckte-etappe.test.js` | versteckter Durchgangsort fällt aus der Etappenliste; aufgedeckter bleibt |

💣 **Vor dem Push läuft das GANZE Testfeld**, JS und PHP, mit den Erweiterungen aus AGENTS.md §9 —
ohne `mbstring`/`pdo_sqlite`/`gd` melden 45 Tests fälschlich rot. Vorbestehend rot bleibt genau
einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).

---

## 9. Was diese Änderung nicht anfasst

* **Die Wegfindung selbst.** Sie funktioniert (Owner 15.08.2026).
* **Orte ohne Weganbindung und die ×25-Notkanten.** Gewollt, am 15.08.2026 ausgemessen, bleibt.
* **Der Querfeldein-Abgangspunkt** (live 15.08.2026) und seine Kandidatenauswahl. Der Riegel filtert
  nur die *Ortschaften* in dieser Auswahl; die Fußpunkte und Wegvertices gehören einem Weg, nicht
  einem Ort, und können nicht versteckt sein.
* **Der JS-Routinggraph** und der Prüfhaken-Index (§6.3).
* **Die Wiki-Siedlungstabelle.** `is_hidden` ist ein Merkmal des Kartenpunkts, nichts, was aus dem
  Wiki käme. Kein WikiSync-Feld, kein Abgleich, kein Konfliktdetektor.
* **`html/editor-handbuch.html`.** Gehört der nächtlichen Routine (AGENTS.md §9); meine Pflicht ist
  ein Commit-Betreff, der die sichtbare Wirkung benennt.

---

## 10. Reihenfolge und Sichtbarkeit

💣 **Sichtbare Änderungen gehen EINZELN live, und der Owner sieht jede** (AGENTS.md §9). Diese
Änderung hat drei sichtbare Oberflächen, und sie gehören in drei Schritte:

1. **Feld + Editor + Karte** — der Haken im Siedlungseditor, der Haken im Auge-Menü, das
   Nicht-Zeichnen. Ohne diesen Schritt gibt es nichts zu verstecken.
2. **Spotlight + Wegpunktsuche** — die dritte Zeile, die Aufdeckung, die beiden CSS-Korrekturen.
   Erst jetzt ist ein versteckter Ort wiederfindbar; deshalb **muss** dieser Schritt dem ersten
   zeitnah folgen.
3. **Router + Etappenliste** — die Kandidatenliste und der Reiniger. Unsichtbar, bis jemand eine
   Route plant, die ihn berührt.

⚠️ Bis Schritt 2 live ist, ist ein versteckter Ort **nicht wiederfindbar**. Der Owner soll deshalb
zwischen 1 und 2 nichts verstecken — oder 1 und 2 laufen als ein Paar hintereinander, mit seinem
Blick dazwischen.

🔧 **DU (Owner):** nach jedem der drei Schritte draufschauen. Die Reihenfolge ist so gewählt, dass
nach jedem Schritt ein sinnvoller Zustand steht.
