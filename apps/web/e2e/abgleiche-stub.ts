import type { AdminAbgleiche, AbgleichLauf, AbgleichQuelle, AbgleichZeile } from "@avesmaps3d/shared";
import { ABGLEICH_JOBARTEN } from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Abgleiche ohne Datenbank (WI-0127 SYS-14): Stände von `GET /api/admin/system/abgleiche` und ein Nachbau des Starts für
 * `stubAdmin({ answer })`. Die echten Routen gegen PostgreSQL prüft `apps/server/test/abgleiche-routes.test.ts`.
 */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;

export const RONDRIKAN = { art: "person" as const, name: "Rondrikan" };

export function lauf(patch: Partial<AbgleichLauf> = {}): AbgleichLauf {
    return {
        jobId: "7e570000-0000-4000-8000-0000000000a1",
        state: "SUCCEEDED",
        startedAt: ago(52 * MINUTE),
        finishedAt: ago(41 * MINUTE),
        ausgeloest: RONDRIKAN,
        luecken: [],
        befunde: 12,
        satz: "map169042-eco163884-live20261011t1405z",
        fehler: null,
        ...patch,
    };
}

export function zeile(quelle: AbgleichQuelle, patch: Partial<AbgleichZeile> = {}): AbgleichZeile {
    return { quelle, kreis: "leer", letzter: null, laufend: null, ausfuehrung: "worker", ...patch };
}

/** Der Stand nach einem vollständigen Zug und einem Medienlauf mit einer Lücke. */
export function abgleicheStand(patch: Partial<AdminAbgleiche> = {}): AdminAbgleiche {
    const stand: AdminAbgleiche = {
        now: new Date().toISOString(),
        ausfuehrung: "worker",
        planerAktiv: true,
        zeilen: [
            zeile("legacy", { kreis: "voll", letzter: lauf() }),
            zeile("medien", {
                kreis: "halb",
                letzter: lauf({
                    jobId: "7e570000-0000-4000-8000-0000000000a2",
                    finishedAt: ago(26 * 60 * MINUTE),
                    luecken: ["dateien"],
                    befunde: 3,
                    satz: null,
                    ausgeloest: { art: "ablauf", name: "Medien-Binaerimport" },
                }),
            }),
        ],
        ...patch,
    };
    // Seit SYS-14b steht die Ausführung je Zeile; ein Stand mit `ausfuehrung` und den vorgegebenen Zeilen gilt für alle Zeilen.
    if (patch.ausfuehrung !== undefined && patch.zeilen === undefined) {
        stand.zeilen = stand.zeilen.map((entry) => ({ ...entry, ausfuehrung: patch.ausfuehrung! }));
    }
    return stand;
}

export interface AbgleicheServer {
    state: AdminAbgleiche;
    starts: Record<string, unknown>[];
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

/** Ein Nachbau: GET liefert den Stand, ein Start legt einen wartenden Auftrag an und antwortet mit der Quittung. */
export function abgleicheServer(initial: AdminAbgleiche = abgleicheStand()): AbgleicheServer {
    const server: AbgleicheServer = {
        state: structuredClone(initial),
        starts: [],
        handle(call) {
            if (call.path === "/api/admin/system/abgleiche" && call.method === "GET")
                return { status: 200, body: server.state };
            if (call.path === "/api/admin/system/abgleiche/start" && call.method === "POST") {
                const body = call.body ?? {};
                server.starts.push(body);
                const quelle = body["quelle"];
                const row = server.state.zeilen.find((entry) => entry.quelle === quelle);
                if (row === undefined) return { status: 400, body: { error: { code: "validation", message: "?" } } };
                if (row.laufend?.state === "QUEUED" || row.wartetDanach === true)
                    return { status: 409, body: { error: { code: "sync_running", message: "vom Nachbau" } } };
                const jobId = "7e570000-0000-4000-8000-0000000000b1";
                row.laufend = {
                    jobId,
                    state: "QUEUED",
                    queuedAt: new Date().toISOString(),
                    startedAt: null,
                    phase: null,
                    progress: null,
                    // Wie der Server (`jobs/wartegrund.ts`, WI-0160): ohne Planer nimmt niemand den Auftrag an.
                    waitReason: server.state.planerAktiv === false ? "waits_no_worker" : null,
                    ausgeloest: RONDRIKAN,
                };
                return {
                    status: 200,
                    body: {
                        operationId: body["operationId"],
                        status: "applied",
                        environment: "staging",
                        affected: [],
                        derivedWork: [
                            {
                                kind: ABGLEICH_JOBARTEN[quelle as AbgleichQuelle] ?? "legacy_pull",
                                jobId,
                                state: "queued",
                            },
                        ],
                        warnings:
                            server.state.planerAktiv === false
                                ? [{ code: "planner_inactive", message: "vom Nachbau" }]
                                : [],
                    },
                };
            }
            return undefined;
        },
    };
    return server;
}
