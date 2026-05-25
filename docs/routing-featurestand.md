# Routing-Featurestand

Stand: 2026-05-25

Dieses Dokument beschreibt den aktuellen Routing-Stand von Avesmaps nach der Umstellung auf serverseitige Routenberechnung mit clientseitiger Kartenanzeige.

## Zielzustand

Die normale Routenplanung soll serverseitig berechnet werden. Das Frontend zeigt die Serverroute anschließend mit den lokalen Kartensegmenten an, damit Darstellung, Hervorhebung, Tooltips und Routenplan weiterhin zur Leaflet-/GeoJSON-Kartenlogik passen.

Der alte Client-Router bleibt als Referenz und Fallback erhalten.

## Relevante URLs

```text
https://avesmaps.de/?route=Gareth&route=Tuzak
```

Normalmodus. Die Route wird vom Server berechnet und im Frontend angezeigt.

```text
https://avesmaps.de/?clientrouting=1&route=Gareth&route=Tuzak
```

Client-Fallback. Die Route wird vollständig im Browser mit der alten Clientlogik berechnet.

```text
https://avesmaps.de/?serverrouting=1&route=Gareth&route=Tuzak
```

Servermodus mit Debug-Ausgabe. Die angezeigte Route kommt vom Server. Zusätzlich werden Diagnoseinformationen in der Browser-Console ausgegeben.

```text
https://avesmaps.de/?serverrouting=1&clientrouting=1&route=Gareth&route=Tuzak
```

Clientanzeige mit Serververgleich. Die Karte zeigt die Clientroute, während die Serverroute als Probe/Diagnose mitläuft.

## URL-State

Die technischen Routing-Flags bleiben beim Synchronisieren des Planner-State erhalten:

- `serverrouting=1`
- `clientrouting=1`

Damit springt eine URL wie `?clientrouting=1&route=Gareth&route=Tuzak` nicht mehr automatisch auf die normale Server-URL zurück.

## Serverroute im Frontend

Der Server liefert eine Route über `api/route.php`. Das Frontend wandelt die Serverantwort in lokale Anzeigeobjekte um.

Der Adapter löst Serversegmente robust gegen lokale `pathData` auf. Unterstützte Segment-IDs sind:

- `edge_id`
- `path_id`
- `id`
- `feature_id`
- `public_id`

Die sichtbare Knotenliste für die Plananzeige wird bevorzugt aus Segmentdaten aufgebaut:

- `from_node`
- `to_node`

`debug.node_ids` dient nur noch als Fallback. Es ist für Diagnose nützlich, aber nicht die primäre Quelle für sichtbare Routenplan-Beschriftungen.

Explizite Leg-Endpunkte werden im Servermodus hart gesetzt. Bei einer URL wie:

```text
?route=Gareth&route=Tuzak&route=Paavi
```

sind die sichtbaren Teilabschnitte logisch:

- Gareth -> Tuzak
- Tuzak -> Paavi

Diese Wegpunkte dürfen nicht durch benachbarte Häfen, Markierungen oder Debug-Knoten ersetzt werden.

## Routenplan-Anzeige

Die Routenplan-Anzeige aggregiert zusammenhängende Wasserabschnitte, ohne wichtige Stationen zu verschlucken.

### Markierungen und Kreuzungen

Interne Markierungen/Kreuzungen auf Flüssen und Seewegen sind keine sichtbaren Abschnittsgrenzen. Sie werden in der Planansicht übersprungen, solange kein echter Ort, expliziter Wegpunkt oder Transportwechsel erreicht wird.

Fehlerbild, das vermieden werden soll:

```text
Flussweg über Natter (...) von Markierung bis Markierung
```

oder:

```text
Flussweg über Gardel (...) von Rindsfurt bis Rindsfurt
```

### Flüsse

Zusammenhängende Flusswegsegmente werden über interne Markierungen hinweg aggregiert. Wenn sich der Flussname ändert, werden die Namen gesammelt und gemeinsam angezeigt.

Beispiel:

```text
Flussweg über Gardel, Natter, Darpat (...) von Rindsfurt bis Perricum ...
```

Die unterschiedlichen Flussnamen bleiben also sichtbar, aber die rein technischen Zwischenmarkierungen erzeugen keine eigenen Planzeilen.

### Seewege und Häfen

Seewege werden ebenfalls über interne Markierungen aggregiert. Echte Häfen und explizite Wegpunkte dürfen aber nicht verschluckt werden.

Beispiel mit explizitem Wegpunkt `Tuzak`:

```text
https://avesmaps.de/?route=Gareth&route=Tuzak&route=Paavi
```

Der Seeweg darf nicht als ein einziger Abschnitt erscheinen:

```text
Seeweg (...) von Perricum bis Neersand
```

Stattdessen muss `Tuzak` sichtbar bleiben:

```text
Seeweg (...) von Perricum bis Tuzak
Seeweg (...) von Tuzak bis Neersand
```

### Transportwechsel

Ein Transportmittelwechsel ist eine harte Abschnittsgrenze. Wenn sich das Transportmittel ändert, wird ein neuer Routenplan-Eintrag erzeugt, auch wenn beide Segmente grundsätzlich Wassersegmente sind.

## Debug-Ausgabe

Bei `serverrouting=1` bleiben die Diagnoseausgaben in der Console aktiv. Relevante Logzeilen sind unter anderem:

```text
Server-Routing-Probe Vergleich
Server-Routing-Probe Paritaet
Server-Routing-Probe Fehlende Client-Segmente
Server-Routing-Probe Fehlende Client-Segmente JSON
Server-Routing-Probe Server-IDs
Server-Routing-Probe Server-Segmente
Server-Routing-Probe Ergebnis
```

Der Debugmodus soll beim Vergleich von Client- und Serverroute helfen, ohne die normale Kartenanzeige für Nutzer zu verändern.

## Wichtige Commits

- `5fc403c` - Preserve routing mode URL flags
- `a4ec7e1` - Show hidden route crossings as markers
- `911636a` - Aggregate water route plan labels
- `5c7083a` - Resolve server route display fallbacks
- `ae71df9` - Keep route waypoints in water plan
- `dc74da0` - Stabilize server route display nodes

## Aktueller Teststand

Getestete Referenzrouten aus der Entwicklung:

```text
https://avesmaps.de/?route=Gareth&route=Tuzak
https://avesmaps.de/?clientrouting=1&route=Gareth&route=Tuzak
https://avesmaps.de/?route=Gareth&route=Tuzak&route=Paavi
https://avesmaps.de/?clientrouting=1&route=Gareth&route=Tuzak&route=Paavi
```

Erwartung:

- Serverroute und Clientroute müssen im Plan fachlich vergleichbar sein.
- Explizite Wegpunkte wie `Tuzak` müssen sichtbar bleiben.
- Markierungen/Kreuzungen dürfen die Plananzeige nicht dominieren.
- Flussnamen sollen erhalten bleiben, auch wenn mehrere Flüsse zu einem Reiseabschnitt aggregiert werden.
- Transportwechsel müssen sichtbar trennen.

## Noch zu prüfen

- Mehrpunkt-Routen mit mehreren expliziten Häfen.
- Wechsel zwischen verschiedenen See- oder Flusstransportmitteln.
- Routen mit Land-Wasser-Land-Wechseln.
- Routen, bei denen ein expliziter Wegpunkt selbst eine Markierungsnähe oder Hafen-Sonderposition hat.
- Verhalten bei deaktivierten Transportdomänen, z. B. Fluss oder See ausgeschaltet.
