import {
    KARTENEINSTELLUNGEN_URL,
    karteneinstellung,
    karteneinstellungGleich,
    karteneinstellungImRahmen,
    type AdminKarteneinstellungen,
    type KartenWert,
} from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Karteneinstellungen ohne Server (WI-0166): ein Nachbau von `GET`/`POST /api/admin/system/karteneinstellungen` samt
 * Revision, Art, Grenzen und Zurücksetzen. Die echten Routen prüft `apps/server/test/karteneinstellungen.test.ts`.
 *
 * 🔴 Gespeichert wird nur, was verstellt ist — wie in der Tafel; die Vorgabe zu schicken setzt zurück.
 */
export function karteneinstellungenStand(): AdminKarteneinstellungen {
    return { now: new Date().toISOString(), revision: 4, source: "database", rows: [], unknownKeys: [] };
}

export interface KarteneinstellungenServer {
    state: AdminKarteneinstellungen;
    posts: Record<string, unknown>[];
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

const fehler = (status: number, code: string) => ({ status, body: { error: { code, message: "vom Nachbau" } } });

export function karteneinstellungenServer(
    initial: AdminKarteneinstellungen = karteneinstellungenStand(),
): KarteneinstellungenServer {
    const server: KarteneinstellungenServer = {
        state: structuredClone(initial),
        posts: [],
        handle(call) {
            if (call.path !== KARTENEINSTELLUNGEN_URL) return undefined;
            if (call.method === "GET") return { status: 200, body: { ...server.state, now: new Date().toISOString() } };
            const body = call.body ?? {};
            server.posts.push(body);
            if (body["baseRevision"] !== server.state.revision) return fehler(409, "edit_conflict");
            const einstellung = karteneinstellung(String(body["id"]));
            if (einstellung === undefined) return fehler(400, "unknown_setting");
            const value = body["value"] as KartenWert | null;
            if (value !== null && !karteneinstellungImRahmen(einstellung, value))
                return fehler(400, "value_out_of_range");
            const ziel = value !== null && karteneinstellungGleich(value, einstellung.vorgabe) ? null : value;
            const rows = server.state.rows.filter((row) => row.id !== einstellung.id);
            if (ziel !== null) {
                rows.push({
                    id: einstellung.id,
                    // Eine Kurve kommt als gewöhnliche Liste an; die Tafel tippt sie schreibgeschützt.
                    value: ziel as (typeof rows)[number]["value"],
                    changedAt: new Date().toISOString(),
                    changedBy: "Rondrikan",
                });
            }
            server.state.rows = rows.sort((a, b) => a.id.localeCompare(b.id));
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
