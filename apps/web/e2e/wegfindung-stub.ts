import {
    WEGFINDUNG_FREIGABE_URL,
    WEGFINDUNG_URL,
    wegfindungAmKnopf,
    wegfindungGrenzen,
    wegfindungWert,
    type AdminWegfindung,
} from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Kenngrößen der Wegfindung ohne Server (WI-0153): ein Nachbau von `GET`/`POST /api/admin/system/wegfindung` und der
 * Freigabe samt Revision, Grenzen und Zurücksetzen. Die echten Routen prüft `apps/server/test/wegfindung-einstellungen.test.ts`.
 *
 * 🔴 Gespeichert wird nur, was verstellt ist — der Nachbau hält darum dieselbe Liste wie die Tafel: nur Abweichungen.
 * 🔴 Und er hält BEIDE Zahlen je Zeile, nach derselben Regel wie der Server (WI-0153 Schnitt 6): Für die Kennungen am
 * Knopf (Folge `netz`) schreibt nur die Freigabe `applied` fort — ohne sie bleibt die Änderung „noch nicht gerechnet“.
 * Für alle anderen ist `applied` gleich `value`: Sie gelten ohne Knopf.
 */
export function wegfindungStand(): AdminWegfindung {
    return {
        now: new Date().toISOString(),
        revision: 4,
        source: "database",
        rows: [],
        unknownKeys: [],
        appliedAt: null,
        appliedBy: null,
        appliedJob: null,
        appliedJobState: null,
        seaGraph: { derivedAt: "2026-10-10T20:31:00.000Z", stale: false, job: null, jobState: null },
    };
}

export interface WegfindungServer {
    state: AdminWegfindung;
    posts: Record<string, unknown>[];
    /** Die Anfragen an den Freigabeweg, getrennt von den Schreibwegen der Felder. */
    freigaben: Record<string, unknown>[];
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

export function wegfindungServer(initial: AdminWegfindung = wegfindungStand()): WegfindungServer {
    const quittung = (operationId: unknown, derivedWork: unknown[] = []) => ({
        operationId,
        status: "applied",
        environment: "staging",
        affected: [],
        derivedWork,
        warnings: [],
    });
    const server: WegfindungServer = {
        state: structuredClone(initial),
        posts: [],
        freigaben: [],
        handle(call) {
            if (call.path === WEGFINDUNG_FREIGABE_URL) {
                const body = call.body ?? {};
                server.freigaben.push(body);
                if (body["baseRevision"] !== server.state.revision) {
                    return { status: 409, body: { error: { code: "edit_conflict", message: "vom Nachbau" } } };
                }
                // Wie der Server (WI-0153 7b): ohne offenen Wert gibt es nur dann etwas frei, wenn der Seegraph veraltet ist und seine
                // Ableitung nicht schon wartet. Eine veraltete Ableitung reiht der Knopf vor dem Neuladen ein.
                const seeVeraltet = server.state.seaGraph.stale && server.state.seaGraph.jobState !== "QUEUED";
                if (!server.state.rows.some((row) => row.value !== row.applied) && !seeVeraltet) {
                    return { status: 409, body: { error: { code: "nothing_to_apply", message: "vom Nachbau" } } };
                }
                // Der gespeicherte Stand wird der gerechnete — nur für die Werte am Knopf; zurückgesetzte Zeilen
                // verschwinden dabei ganz.
                server.state.rows = server.state.rows
                    .map((row) => (wegfindungAmKnopf(row.id) ? { ...row, applied: row.value } : row))
                    .filter((row) => row.value !== null);
                server.state.revision = (server.state.revision ?? 0) + 1;
                server.state.appliedAt = new Date().toISOString();
                server.state.appliedBy = "Rondrikan";
                server.state.appliedJob = "11111111-2222-3333-4444-555555555555";
                server.state.appliedJobState = "QUEUED";
                const vorarbeit = seeVeraltet
                    ? [{ kind: "sea_derive", jobId: "66666666-7777-4888-8999-000000000000", state: "queued" }]
                    : [];
                if (seeVeraltet)
                    server.state.seaGraph = { ...server.state.seaGraph, job: vorarbeit[0]!.jobId, jobState: "QUEUED" };
                return {
                    status: 200,
                    body: quittung(body["operationId"], [
                        ...vorarbeit,
                        { kind: "routing_reload", jobId: server.state.appliedJob, state: "queued" },
                    ]),
                };
            }
            if (call.path !== WEGFINDUNG_URL) return undefined;
            if (call.method === "GET") return { status: 200, body: { ...server.state, now: new Date().toISOString() } };
            const body = call.body ?? {};
            server.posts.push(body);
            if (body["baseRevision"] !== server.state.revision) {
                return { status: 409, body: { error: { code: "edit_conflict", message: "vom Nachbau" } } };
            }
            const wert = wegfindungWert(String(body["id"]));
            if (wert === undefined)
                return { status: 400, body: { error: { code: "unknown_setting", message: "vom Nachbau" } } };
            const value = body["value"];
            if (value !== null) {
                const grenzen = wegfindungGrenzen(wert);
                if (typeof value !== "number" || value < grenzen.min || value > grenzen.max)
                    return { status: 400, body: { error: { code: "value_out_of_range", message: "vom Nachbau" } } };
            }
            // Am Knopf bleibt der gerechnete Wert, wie er ist (Verstellen ändert ihn nicht, auch Zurücksetzen nicht);
            // ohne Knopf gilt die neue Zahl sofort, also trägt die Zeile sie in beiden Feldern.
            const vorher = server.state.rows.find((row) => row.id === wert.id)?.applied ?? null;
            const amKnopf = wegfindungAmKnopf(wert.id);
            const applied = amKnopf ? vorher : typeof value === "number" ? value : null;
            const rows = server.state.rows.filter((row) => row.id !== wert.id);
            if (typeof value === "number") {
                rows.push({ id: wert.id, value, applied, changedAt: new Date().toISOString(), changedBy: "Rondrikan" });
            } else if (applied !== null) {
                rows.push({ id: wert.id, value: null, applied, changedAt: null, changedBy: null });
            }
            server.state.rows = rows.sort((a, b) => a.id.localeCompare(b.id));
            server.state.revision = (server.state.revision ?? 0) + 1;
            return { status: 200, body: quittung(body["operationId"]) };
        },
    };
    return server;
}
