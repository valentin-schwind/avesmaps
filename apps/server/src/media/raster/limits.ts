/**
 * Die Grenzen der Rasterpipeline (WI-0063 MEDIA-M7, `project-control/migration/contracts/media.yaml` → `entschieden_m7`).
 *
 * 🔴 D2 ist ein Betreiberentscheid (2026-10-04, Messbericht `wi0063-media-m7-bildbibliothek-2026-10-04.md` Abschnitt 8):
 * 6 MiB Raster, 512 KiB SVG, 16 MP, 8192 px Kantenlänge. Diese Grenzen dürfen abweisen; eine neue steht hier erst nach einer
 * Entscheidung des Betreibers.
 */
export const RASTER_LIMITS = {
    /** Höchstgröße einer Rasterdatei (PNG, JPEG, GIF, WebP) in Bytes: 6 MiB. */
    maxRasterBytes: 6 * 1024 * 1024,
    /** Höchstgröße einer SVG-Datei in Bytes: 512 KiB. */
    maxSvgBytes: 512 * 1024,
    /** Höchstzahl der Pixel je Bild: 16 MP (4000 × 4000; nimmt 12-MP-Telefonfotos auf). */
    maxPixels: 16_000_000,
    /** Längste Kante in Pixeln. */
    maxEdge: 8192,
} as const;

/**
 * Die Grenzen für ein PDF als Kartenquelle (WI-0275 Stufe A, Vorgabe des Betreibers: bis 50 MB). Nur für die Rollen der Kartensammlung;
 * Raster bleiben bei 6 MiB (D2). Das PDF bleibt privat, gerastert wird nur Seite 1.
 */
export const PDF_LIMITS = {
    /** Höchstgröße einer PDF-Datei in Bytes: 50 MiB. */
    maxBytes: 50 * 1024 * 1024,
    /** Längste Kante des Rasters der ersten Seite in Pixeln (zusätzlich gilt die Pixelgrenze von 16 MP). */
    maxRasterEdge: 4096,
    /** Zeitgrenze für das Rastern, Sekunden (ein PDF, das den Dekoder festhält). */
    timeoutSeconds: 60,
} as const;

/** Die größte Datei, die die Pipeline je liest: der Aufrufer prüft die Größe VOR dem Lesen (`MediaStore.read`). */
export const MAX_SOURCE_BYTES: number = Math.max(
    RASTER_LIMITS.maxRasterBytes,
    RASTER_LIMITS.maxSvgBytes,
    PDF_LIMITS.maxBytes,
);

/**
 * Die Einstellungen der Bildbibliothek (Claudios Bedingungen, `handovers/2026-10-04-media-m7-sharp-antwort.md`): ein
 * libvips-Arbeitsthread, kein Operationscache. Auf einem geteilten VPS (Foundry, PostgreSQL, Fastify) nimmt sich libvips
 * sonst jeden Kern und hält Speicher fest.
 */
export const RASTER_ENGINE = {
    concurrency: 1,
    /**
     * Zeitgrenze für das Rendern eines Bildes, Sekunden (WI-0063 26.19: „Verarbeitungszeit begrenzen“). Eine technische
     * Sicherung gegen ein Bild, das den Dekoder festhält, keine Qualitätsregel: der teuerste gemessene Fall (16 MP verlustfrei)
     * braucht lokal gut 3 s.
     */
    timeoutSeconds: 60,
} as const;
