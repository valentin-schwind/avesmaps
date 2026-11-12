import type { AdminSicherung, SicherungTeil } from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Sicherung ohne Datenbank und ohne Claudios Statusdatei (WI-0127 SYS-9): Stände von `GET /api/admin/system/backup` und ein Nachbau
 * von „Sicherung jetzt“. Die echten Routen prüft `apps/server/test/sicherung-routes.test.ts`, den Leser der Statusdatei
 * `apps/server/test/sicherung-status.test.ts` mit Fixture-Dateien.
 */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const later = (ms: number): string => new Date(Date.now() + ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const TEILE: SicherungTeil[] = [
    {
        kind: "db",
        bytes: 48_213_504,
        sha256: "9f2c4be01d77",
        encrypted: true,
        offsite: "dropbox",
        offsiteVerifiedAt: ago(11 * HOUR),
    },
    {
        kind: "roles",
        bytes: 4096,
        sha256: "1a2b3c4d5e6f",
        encrypted: true,
        offsite: "dropbox",
        offsiteVerifiedAt: ago(11 * HOUR),
    },
    {
        kind: "config",
        bytes: 1_832_960,
        sha256: "c0ffee00c0ff",
        encrypted: true,
        offsite: null,
        offsiteVerifiedAt: null,
    },
];

/** Ohne Angabe: die Sicherung von heute Nacht, aktuell, der Knopf geht. */
export function sicherungStand(patch: Partial<AdminSicherung> = {}): AdminSicherung {
    return {
        now: new Date().toISOString(),
        zustand: "aktuell",
        stand: ago(11 * HOUR),
        letzterLauf: {
            startedAt: ago(11 * HOUR + 3 * MINUTE),
            finishedAt: ago(11 * HOUR),
            result: "ok",
            errorCode: null,
            trigger: "timer",
            operationId: null,
        },
        letzteErfolgreiche: ago(11 * HOUR),
        ausserHaus: { eingerichtet: true, geprueftAm: ago(11 * HOUR) },
        probelauf: { at: ago(3 * HOUR), result: "ok" },
        naechsterLauf: later(11 * HOUR),
        aufbewahrung: { local: 3, daily: 7, weekly: 4, monthly: 6 },
        teile: TEILE,
        neueresFormat: false,
        anstossen: { moeglich: true, wartend: null, letzteAntwort: null },
        ...patch,
    };
}

/** Lokal und überall ohne Claudios Datei: nicht eingerichtet, der Knopf aus. */
export function nichtEingerichtet(): AdminSicherung {
    return sicherungStand({
        zustand: "nicht_eingerichtet",
        stand: null,
        letzterLauf: null,
        letzteErfolgreiche: null,
        ausserHaus: { eingerichtet: null, geprueftAm: null },
        probelauf: null,
        naechsterLauf: null,
        aufbewahrung: null,
        teile: [],
        anstossen: { moeglich: false, wartend: null, letzteAntwort: null },
    });
}

export interface SicherungServer {
    state: AdminSicherung;
    starts: Record<string, unknown>[];
    /** Die Wiederherstellungsanträge (WI-0124 K5), wie sie hinausgingen. */
    antraege: Record<string, unknown>[];
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

/** Ein Nachbau: GET liefert den Stand, ein Start legt den Auftrag ab (`wartend`) und antwortet mit der Quittung. */
export function sicherungServer(initial: AdminSicherung = nichtEingerichtet()): SicherungServer {
    const server: SicherungServer = {
        state: structuredClone(initial),
        starts: [],
        antraege: [],
        handle(call) {
            if (call.path === "/api/admin/system/backup/wiederherstellung" && call.method === "POST") {
                const body = call.body ?? {};
                server.antraege.push(body);
                const ops = `OPS-${String(141 + server.antraege.length - 1).padStart(6, "0")}`;
                server.state.wiederherstellung = {
                    ops,
                    status: "neu",
                    beantragtAt: new Date().toISOString(),
                    umfang: body["umfang"] as "datenbank",
                    sicherung:
                        body["sicherung"] === "letzte" ? `letzte:${String(server.state.letzteErfolgreiche)}` : "aelter",
                };
                return {
                    status: 200,
                    body: {
                        operationId: body["operationId"],
                        status: "applied",
                        environment: "staging",
                        affected: [{ kind: "kanal_vorgang", id: ops }],
                        derivedWork: [],
                        warnings: [],
                    },
                };
            }
            if (call.path === "/api/admin/system/backup" && call.method === "GET") {
                return { status: 200, body: { ...server.state, now: new Date().toISOString() } };
            }
            if (call.path === "/api/admin/system/backup/start" && call.method === "POST") {
                const body = call.body ?? {};
                server.starts.push(body);
                if (!server.state.anstossen.moeglich) {
                    return { status: 503, body: { error: { code: "backup_unavailable", message: "vom Nachbau" } } };
                }
                if (server.state.anstossen.wartend !== null) {
                    return { status: 409, body: { error: { code: "backup_pending", message: "vom Nachbau" } } };
                }
                server.state.anstossen.wartend = {
                    operationId: String(body["operationId"]),
                    requestedAt: new Date().toISOString(),
                };
                return {
                    status: 200,
                    body: {
                        operationId: body["operationId"],
                        status: "applied",
                        environment: "staging",
                        affected: [],
                        derivedWork: [],
                        warnings: [],
                    },
                };
            }
            return undefined;
        },
    };
    return server;
}
