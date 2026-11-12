import type { ApiHerkunft } from "@avesmaps3d/shared";

/**
 * Woher eine Anfrage kommt und welche alten Legacy-Pfade sie trifft (WI-0307, Handover Claudios 2026-11-10 `api-nutzung-status`).
 * Rein, damit ein Test es ohne Server prüft; der Zähler (`api-zaehler.ts`) legt daraus seine Posten an.
 */

/** Unsere eigenen Seiten. Dazu die Rechneradressen der Entwicklung, damit der lokale Stapel nicht als fremde Seite zählt. */
const EIGENE_HOSTS = new Set([
    "avesmaps.de",
    "www.avesmaps.de",
    "stage.avesmaps.de",
    "localhost",
    "127.0.0.1",
    "[::1]",
]);

/** Was als Hostname einer fremden Seite stehen darf; alles andere wird `anders`. */
const HOSTNAME = /^[a-z0-9.-]{1,100}$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export interface Herkunft {
    herkunft: ApiHerkunft;
    /** Nur bei `fremde_seite`: der Hostname, nie Pfad oder Abfrage. */
    seite?: string;
}

/**
 * Die Herkunft aus den Kopfzeilen der Anfrage.
 *
 * 1. `Origin`, sonst `Referer` (ein `Origin: null` zählt wie keiner): Hostname einer unserer Seiten → `eigene_seite`, ein anderer →
 *    `fremde_seite` mit dem Hostnamen.
 * 2. Sonst `Sec-Fetch-Site`: `same-origin` oder `same-site` → `eigene_seite`, `cross-site` → `fremde_seite` ohne Namen (`unbekannt`).
 * 3. Sonst `ohne_seite` (Skripte, Apps, Bots, auch eine im Browser getippte Adresse, `Sec-Fetch-Site: none`).
 *
 * 💣 **Schritt 2 ist nötig, nicht Zierde:** Stage und Production schicken `Referrer-Policy: no-referrer` (`stage-headers-base.conf`, Production
 * kopiert es). Ein Abruf unserer eigenen Seite trägt deshalb keinen Referer, und ein GET derselben Herkunft auch kein `Origin`. Ohne
 * `Sec-Fetch-Site` stünde fast die ganze eigene Karte unter `ohne_seite`. Diese Kopfzeile setzt nur der Browser; ein Skript kann sie fälschen,
 * aber das gilt für den Referer genauso. Alte Browser ohne sie (Safari vor 16.4) zählen als `ohne_seite`, Absender `Browser`.
 *
 * 🪤 Eine IP-Adresse als Hostname wird `ip-adresse`: In `api_metric` stehen keine Adressen.
 */
export function herkunftAus(
    origin: string | undefined,
    referer: string | undefined,
    secFetchSite?: string | undefined,
): Herkunft {
    const quelle = [origin, referer].map((wert) => wert?.trim() ?? "").find((wert) => wert !== "" && wert !== "null");
    if (quelle !== undefined) {
        let host: string;
        try {
            host = new URL(quelle).hostname.toLowerCase();
        } catch {
            return { herkunft: "fremde_seite", seite: "anders" };
        }
        if (EIGENE_HOSTS.has(host)) return { herkunft: "eigene_seite" };
        return { herkunft: "fremde_seite", seite: seiteAusHost(host) };
    }
    const abruf = secFetchSite?.trim().toLowerCase();
    if (abruf === "same-origin" || abruf === "same-site") return { herkunft: "eigene_seite" };
    if (abruf === "cross-site") return { herkunft: "fremde_seite", seite: "unbekannt" };
    return { herkunft: "ohne_seite" };
}

function seiteAusHost(host: string): string {
    if (IPV4.test(host) || host.startsWith("[")) return "ip-adresse";
    return HOSTNAME.test(host) ? host : "anders";
}

/**
 * Die Dateien unter `/api/app/` der Legacy-Oberfläche (Discovery-Mirror `96dda99b4`, 2026-11-01). Legacy ist eingefroren, die Liste
 * ändert sich nicht mehr; ein anderer Name wird `andere`, damit ein Scanner keine neuen Zeilen anlegt.
 */
const LEGACY_APP_DATEIEN = new Set([
    "api-metrics.php",
    "changelog.php",
    "citymaps.php",
    "coat.php",
    "contact.php",
    "ecosystem-areas.php",
    "ecosystem-display.php",
    "ecosystem-regions.php",
    "feature-sources-export.php",
    "feature-sources.php",
    "game-literature.php",
    "heartbeat.php",
    "link-status.php",
    "location-reviews-export.php",
    "location-reviews.php",
    "lore-export.php",
    "lore.php",
    "map-features.php",
    "map-revision.php",
    "map-search.php",
    "media-export.php",
    "path-landscapes.php",
    "place-kinds.php",
    "political-derived-geometry-debug.php",
    "political-territories-export.php",
    "political-territories.php",
    "political-territory-display-sync.php",
    "political-territory-wiki.php",
    "political-zoom-coverage-debug.php",
    "report-location.php",
    "session.php",
    "share-link.php",
    "source-coverage.php",
    "source-search.php",
    "staetten-rohquellen-export.php",
    "territory-detail.php",
    "track.php",
    "uploads-export.php",
    "visitor-metrics.php",
    "what-is-here.php",
    "wiki-linkziele-export.php",
    "wiki-redirects-export.php",
    "wiki-siedlungen-export.php",
    "wiki-zuordnung-export.php",
    "zoom-bands.php",
]);

export interface LegacyPfad {
    /** Der Name in `anfrage`: einer der drei alten API-Pfade oder `legacy-oberflaeche`. */
    weg: string;
    /** Die Dimension in `legacy`: derselbe Pfad, bei der Oberfläche `/api/app/<datei>`. */
    pfad: string;
}

/**
 * Ein alter Legacy-Pfad, nach Methode und Pfad ohne Abfrage. Die alte Entwickler-API (Legacy `api/README.md`): `/api/route.php`,
 * `/api/locations/` und `POST /api/route/`; dazu `/api/app/*.php`, die Aufrufe offener oder zwischengespeicherter Legacy-Seiten.
 *
 * Gelesen wird vor der Route: Baut WI-0303 für die drei alten Wege Antworten mit 410, behalten sie hier denselben Namen.
 */
export function legacyPfad(methode: string | undefined, pfad: string): LegacyPfad | undefined {
    if (pfad === "/api/route.php") return { weg: pfad, pfad };
    if (pfad === "/api/locations/" || pfad === "/api/locations") {
        return { weg: "/api/locations/", pfad: "/api/locations/" };
    }
    // Unsere eigene Route kennt nur GET; ein POST darauf ist der alte Weg, auch ohne den Schrägstrich am Ende.
    if (methode?.toUpperCase() === "POST" && (pfad === "/api/route/" || pfad === "/api/route")) {
        return { weg: "POST /api/route/", pfad: "POST /api/route/" };
    }
    const datei = /^\/api\/app\/([^/]+)$/.exec(pfad)?.[1];
    if (datei !== undefined && datei.endsWith(".php")) {
        return { weg: "legacy-oberflaeche", pfad: `/api/app/${LEGACY_APP_DATEIEN.has(datei) ? datei : "andere"}` };
    }
    return undefined;
}
