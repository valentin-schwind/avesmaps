# Stabilitaetsvermerk: Feature-State-Split

## 1. Umfang

Der Feature-State-Block wurde aus `js/map-features.js` in eine eigene klassische Script-Datei ausgelagert.

Code-Commit:

```text
699faf19cf571ab9531dace52e0559d4e318f30d
Split map features feature state helpers
```

Neue Datei:

```text
js/map-features-feature-state.js
```

Geaendert:

```text
index.html
js/map-features-feature-state.js
js/map-features.js
```

## 2. Verschobene Funktionen

1:1 verschoben wurden:

- `updateRevisionFromEditResponse`
- `getLocalFeatureRevision`
- `withExpectedRevision`
- `acquireFeatureSoftLock`
- `releaseFeatureSoftLock`

Nicht verschoben wurden:

- `applyMapFeatureEditResult`
- `applyLiveMapFeatureUpdate`
- `removeLiveFeature`
- Location-/Path-/Label-/Region-Lifecycle-Funktionen
- Dialog-/Review-Submit-Flows
- API-Funktionen

## 3. Script-Reihenfolge

`index.html` laedt die neue Datei im Map-Features-Block nach `js/map-features-display-mode.js` und vor `js/map-features-share-pin.js`:

```html
<script src="js/map-features-display-mode.js"></script>
<script src="js/map-features-feature-state.js"></script>
<script src="js/map-features-share-pin.js"></script>
```

Damit bleibt die klassische globale Script-Tag-Architektur erhalten. Es wurden keine ES-Module, keine Imports und keine Exports eingefuehrt.

## 4. Pruefung

Syntaxpruefung lokal bestanden:

```text
node --check js/map-features-feature-state.js
node --check js/map-features.js
```

Beide Befehle liefen erfolgreich mit Exit Code 0 und ohne Ausgabe.

Arbeitsbaum nach Commit und Push lokal sauber:

```text
git status --short
```

war leer.

## 5. Smoke

Betreiber-Smoke nach dem Push:

```text
alles wirkt normal
```

Damit gilt der Feature-State-Split als stabil.

## 6. Stabilitaetsregel

Der Feature-State-Split bleibt stabil. Die Datei `js/map-features-feature-state.js` soll nicht ohne neue Boundary erweitert werden.

Insbesondere nicht nachtraeglich in diese Datei verschieben ohne eigene Analyse:

- Feature-Response-Dispatcher
- `applyMapFeatureEditResult`
- `applyLiveMapFeatureUpdate`
- `removeLiveFeature`
- Location-/Path-/Label-/Region-Lifecycle

## 7. Naechster Kandidat

Naechster Boundary-Kandidat fuer weitere `js/map-features.js`-Entschlackung:

```text
Location-Marker-Rendering / Sichtbarkeit
```

Dafuer sollte ein eigenes Boundary-Dokument angelegt werden, bevor Code geaendert wird.
