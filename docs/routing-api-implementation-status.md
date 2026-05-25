# Routing API Implementation Status

## 2026-05-25 - Schritt 1 (Route Options Extraction)

- Commit: `Extract route option resolution boundary`
- Schritt: Route-Options-Boundary eingefuehrt mit kompatiblem Wrapper.
- Dateien:
  - `js/routing.js`
  - `index.html`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Transportoptionen werden jetzt aus einem Route-Options-Objekt gelesen; unbeabsichtigte Feldabweichungen koennten Pfade ausfiltern.
  - `createGraph` nutzt jetzt optionales `routeOptions`; Aufrufer muessen bei spaeteren Schritten konsistent bleiben.
- Smoke noetig: ja

## 2026-05-25 - Schritt 2A (createGraph Route-Options-Entkopplung)

- Commit: `Decouple createGraph route options from DOM fallback`
- Schritt: `createGraph(routeOptions)` auf explizite Uebergabe umgestellt, ohne impliziten DOM-Fallback.
- Dateien:
  - `js/routing.js`
  - `index.html`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Bei zukuenftigen neuen Aufrufern von `createGraph` muss `routeOptions` explizit uebergeben werden.
  - Fehlende oder unvollstaendige `routeOptions` koennen dazu fuehren, dass Pfade uebersprungen werden.
- Smoke noetig: ja
