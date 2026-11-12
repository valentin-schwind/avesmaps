import type { AdminSystemzustand } from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Der Systemzustand ohne Server (WI-0127 SYS-8): Stände von `GET /api/admin/system/health`. Die echte Route prüft
 * `apps/server/test/systemzustand-routes.test.ts`, die Rechte `systemzustand-grants.test.ts`.
 */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Ein Verlauf über 24 h mit einer Lücke (Neustart) und einer Spitze, wie auf dem VPS. */
function verlauf(): AdminSystemzustand["verlauf"] {
    const jetzt = Math.floor(Date.now() / (5 * MINUTE)) * 5 * MINUTE;
    return Array.from({ length: 288 }, (_, i) => {
        const at = jetzt - (287 - i) * 5 * MINUTE;
        const luecke = i >= 120 && i < 126;
        const spitze = i === 200 || i === 201 ? 0.9 : i > 270 ? 0.45 : 0;
        return {
            bucket: new Date(at).toISOString(),
            last1: luecke ? null : Math.round((0.16 + 0.05 * Math.sin(i / 9) + spitze) * 100) / 100,
            belegt: luecke ? null : Math.round((3.2 + 0.15 * Math.sin(i / 30)) * GB),
            auslagerung: luecke ? null : 0,
        };
    });
}

/** Ohne Angabe: Stage mit Claudios frischer Statusdatei, alles gesund außer der Sicherung (noch nicht eingerichtet). */
export function systemzustandStand(patch: Partial<AdminSystemzustand> = {}): AdminSystemzustand {
    return {
        now: new Date().toISOString(),
        datei: { zustand: "aktuell", stand: ago(2 * MINUTE), host: "stage-vps", neueresFormat: false },
        komponenten: [
            {
                id: "fastify",
                zustand: "gesund",
                seit: ago(21 * HOUR),
                version: "Release 028ec13 · Node 24.14.1",
                hinweis: null,
            },
            { id: "routing", zustand: "gesund", seit: ago(21 * HOUR - MINUTE), version: "r161832", hinweis: "ready" },
            { id: "jobs", zustand: "gesund", seit: null, version: null, hinweis: "lock_held" },
            {
                id: "postgresql",
                zustand: "gesund",
                seit: ago(24 * DAY),
                version: "18.6 · PostGIS 3.6.0",
                hinweis: null,
            },
            { id: "martin", zustand: "gesund", seit: null, version: null, hinweis: "probe_ok" },
            { id: "nginx", zustand: "gesund", seit: ago(2 * MINUTE), version: null, hinweis: "door_ok" },
            { id: "sicherung", zustand: "unbekannt", seit: null, version: null, hinweis: "backup_not_set_up" },
        ],
        auslastung: {
            last: { eins: 0.18, fuenf: 0.24, fuenfzehn: 0.21 },
            kerne: 4,
            speicher: {
                gesamt: Math.round(7.7 * GB),
                belegt: Math.round(3.4 * GB),
                auslagerung: 0,
                auslagerungGesamt: 2 * GB,
            },
            prozesse: [
                { id: "fastify", rss: 410 * MB },
                { id: "routing", rss: null, imProzess: "fastify", heap: 70 * MB, graph: 180 * MB },
                { id: "jobs", rss: 88 * MB, kinder: { anzahl: 1, rss: Math.round(1.2 * GB) }, stand: null },
            ],
            laufzeit: { system: 23 * 86_400 + 4 * 3600, prozess: 21 * 3600 },
            platten: [
                { id: "kacheln", quelle: "anwendung", gesamt: 232 * GB, frei: 157 * GB },
                { id: "/", quelle: "datei", gesamt: 232 * GB, frei: 157 * GB },
            ],
        },
        verlauf: verlauf(),
        datenbank: {
            groesse: Math.round(1.31 * GB),
            verbindungen: { belegt: 14, erlaubt: 100, reserviert: 3, eigene: { active: 1, idle: 7 } },
            tabellen: [
                { name: "terrain_contour", bytes: 544 * MB },
                { name: "terrain_domain_raster", bytes: 136 * MB },
                { name: "terrain_height_band", bytes: 121 * MB },
                { name: "region_area_smooth", bytes: 114 * MB },
                { name: "path_run", bytes: 61 * MB },
            ],
        },
        groessen: {
            at: ago(40 * MINUTE),
            kacheln: Math.round(14.6 * GB),
            medienVeroeffentlicht: Math.round(0.4 * GB),
            medienPrivat: Math.round(1.5 * GB),
            sicherungenLokal: null,
        },
        tuer: {
            at: ago(2 * MINUTE),
            von: "public",
            proben: [
                { url: "/", erwartet: "302", bekommen: "302", ms: 4 },
                { url: "/anmelden", erwartet: "200", bekommen: "200", ms: 3 },
            ],
        },
        dienste: [
            { name: "nginx", zustand: "active" },
            { name: "martin", zustand: "active" },
        ],
        ...patch,
    };
}

/** Lokal und überall ohne Claudios Datei: Dienste, Tür und Größen unbekannt; Last unter Windows unbekannt. */
export function ohneDatei(): AdminSystemzustand {
    const stand = systemzustandStand();
    return {
        ...stand,
        datei: { zustand: "nicht_eingerichtet", stand: null, host: null, neueresFormat: false },
        komponenten: stand.komponenten.map((entry) =>
            entry.id === "nginx"
                ? { ...entry, zustand: "unbekannt", seit: null, hinweis: "not_set_up" }
                : entry.id === "martin"
                  ? { ...entry, zustand: "unbekannt", hinweis: "not_configured" }
                  : entry,
        ),
        auslastung: {
            ...stand.auslastung,
            last: null,
            platten: stand.auslastung.platten.filter((p) => p.quelle === "anwendung"),
        },
        datenbank: { ...stand.datenbank, verbindungen: null },
        groessen: null,
        tuer: null,
        dienste: [],
    };
}

export function systemzustandAntwort(stand: () => AdminSystemzustand) {
    return (call: AdminCall): { status: number; body: unknown } | undefined =>
        call.method === "GET" && call.path === "/api/admin/system/health"
            ? { status: 200, body: { ...stand(), now: new Date().toISOString() } }
            : undefined;
}
