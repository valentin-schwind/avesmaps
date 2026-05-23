# Routing Transport Smoke Checklist

## 1. Zweck

- Diese Checkliste dient manuellen Regressionstests nach Routing-/Transport-Refactorings (insbesondere `createGraph`, `getTransportOption`, `isTransportAllowedForPath`, `getSyntheticRouteConfig`, `calculateRoute`).
- Massgebliche Testumgebung ist [https://avesmaps.de/](https://avesmaps.de/) oder eine vollstaendig konfigurierte API-Umgebung mit SQL-Daten.
- `python -m http.server` reicht nur fuer statische UI-/Asset-Checks, nicht fuer vollstaendige SQL-/Routingtests.

## 2. Vorbereitung

- Browser-Konsole oeffnen.
- Seite hart neu laden (Cache umgehen).
- Sicherstellen, dass SQL-/Kartendaten geladen sind.
- Nach jedem Testfall auf neue Warnungen/Fehler achten.
- Besonders relevante Warnungen:
  - `Keine Transportoption ...`
  - `Geschwindigkeit ... nicht definiert`
  - `Kein Segment gefunden fuer Verbindung ...`
  - `Keine Route ...` / leere Route (falls sichtbar)

## 3. Baseline-Routing

Testfaelle:

- Einfache Route zwischen zwei bekannten Orten berechnen.
- Auf `kuerzeste Route` schalten und berechnen.
- Auf `schnellste Route` schalten und berechnen.
- Nach Aenderung der Optionen dieselbe Route erneut berechnen.

Erwartete Beobachtung:

- Route wird gezeichnet.
- Etappenliste aktualisiert sich.
- Keine neuen Konsolenfehler.

## 4. Umstiege minimieren

Testfaelle:

- Gleiche Route mit `Umstiege minimieren` aus.
- Gleiche Route mit `Umstiege minimieren` an.

Erwartete Beobachtung:

- Route bleibt berechenbar.
- Eine andere Route ist akzeptabel.
- Keine zusaetzlichen Fehler-/Warnmeldungen.

## 5. Transportarten aktivieren/deaktivieren

Testfaelle:

- Land aktiviert/deaktiviert.
- Fluss aktiviert/deaktiviert.
- See aktiviert/deaktiviert.
- Kombinierte Faelle:
  - nur Land
  - nur Fluss
  - nur See
  - Land + Fluss
  - Land + See

Erwartete Beobachtung:

- Routen aendern sich plausibel oder sind (falls logisch) nicht verfuegbar.
- Keine unerwarteten JavaScript-Fehler.

## 6. Transportmittel wechseln

Testfaelle:

- Landtransport wechseln (z. B. zu Fuss / Pferd / Kutsche, soweit UI vorhanden).
- Flusstransport wechseln (soweit UI vorhanden).
- Seetransport wechseln (soweit UI vorhanden).

Erwartete Beobachtung:

- Bei `schnellste Route` kann sich Reisezeit/Route aendern.
- Bei `kuerzeste Route` bleibt die Wegwahl plausibel.

## 7. Datenregeln aus SQL

Pruefpunkte:

- `allowed_transports`
- `transport_domain`
- Fallback ueber `getDefaultTransportDomainForPathSubtype`

Erwartung:

- Pfade werden nicht benutzt, wenn der gewaehlte Transport laut Daten nicht erlaubt ist.

## 8. Spezialfall Wuestenpfad + horseCarriage

- Falls ein bekannter Wuestenpfad-Testfall existiert: hier konkrete Start-/Zielorte ergaenzen.
- Wenn kein konkreter Ort bekannt ist: als TODO offen lassen.

TODO:

- Konkreten reproduzierbaren Wuestenpfad-Fall dokumentieren.

Erwartung:

- `horseCarriage` darf `Wuestenpfad` nicht verwenden.

## 9. Synthetische Querfeldein-Verbindungen

Testfaelle:

- Eine Route testen, die bekanntermassen synthetische Verbindung nutzen kann.
- Danach Landtransport deaktivieren und erneut testen.

Erwartete Beobachtung:

- Mit passendem Landtransport: Route/Segment wird erzeugt.
- Ohne Landtransport: synthetische Verbindung wird uebersprungen oder Route ist nicht verfuegbar.
- Keine Warnung `Kein Segment gefunden fuer Verbindung synthetic-...`.

## 10. Nach jedem Refactoring dokumentieren

Nutze diese Tabelle nach jedem relevanten Commit:

| Datum | Commit | Getestete Faelle | Ergebnis | Offene Auffaelligkeiten |
| --- | --- | --- | --- | --- |
| YYYY-MM-DD | abcdef0 | z. B. 3, 4, 5, 9 | OK / NOK | kurze Notiz |

## 11. Bezug zu allgemeinem Smoke-Test

- Diese Detail-Checkliste ergaenzt den allgemeinen Smoke-Test in `docs/stabilization-smoke-test.md`.

