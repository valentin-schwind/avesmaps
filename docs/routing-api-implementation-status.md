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
