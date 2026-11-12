import { ZOOMBAENDER_URL, zoombandSpur, type AdminZoombaender, type Zoomspanne } from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Zoombänder ohne Server (WI-0221): ein kleiner Nachbau von `GET`/`POST /api/admin/system/zoombaender` mit Revision und den Regeln,
 * die der Reiter sichtbar machen muss. Die echten Routen samt Rechten und Protokoll prüft `apps/server/test/zoombaender.test.ts` auf einem
 * Wegwerf-Cluster.
 */
export function zoombaenderStand(zeilen: AdminZoombaender["zeilen"] = []): AdminZoombaender {
    return { now: new Date().toISOString(), revision: 3, source: "database", zeilen, unknownKeys: [] };
}

export interface ZoombaenderServer {
    state: AdminZoombaender;
    posts: Record<string, unknown>[];
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

const fehler = (status: number, code: string) => ({ status, body: { error: { code, message: "vom Nachbau" } } });

export function zoombaenderServer(initial: AdminZoombaender = zoombaenderStand()): ZoombaenderServer {
    const server: ZoombaenderServer = {
        state: structuredClone(initial),
        posts: [],
        handle(call) {
            if (call.path !== ZOOMBAENDER_URL) return undefined;
            if (call.method === "GET") return { status: 200, body: { ...server.state, now: new Date().toISOString() } };
            const body = call.body ?? {};
            server.posts.push(body);
            if (body["baseRevision"] !== server.state.revision) return fehler(409, "edit_conflict");
            const aenderungen = body["aenderungen"] as { id: string; spanne: Zoomspanne | null }[];
            for (const { id, spanne } of aenderungen) {
                const spur = zoombandSpur(id);
                if (spur === undefined) return fehler(400, "unknown_zoom_band");
                if (spur.nurAnsicht !== undefined) return fehler(409, "zoom_band_view_only");
                const rest = server.state.zeilen.filter((zeile) => zeile.id !== id);
                server.state.zeilen =
                    spanne === null
                        ? rest
                        : [...rest, { id, spanne, changedAt: new Date().toISOString(), changedBy: "Rondrikan" }];
            }
            server.state.zeilen.sort((a, b) => a.id.localeCompare(b.id));
            server.state.revision = (server.state.revision ?? 0) + 1;
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
        },
    };
    return server;
}
