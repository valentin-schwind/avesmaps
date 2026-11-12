import type { AdminContentSwitchRow, AdminContentSwitches } from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Die Inhaltsschalter ohne Server (WI-0127 SYS-10): ein Nachbau von `GET`/`POST /api/admin/system/content-switches` mit Inhaltsrevision.
 * Die echten Routen prüft `apps/server/test/inhaltsschalter.test.ts`.
 */
const zeile = (key: string, group: AdminContentSwitchRow["group"]): AdminContentSwitchRow => ({
    key,
    group,
    enabled: true,
    changedAt: null,
    changedBy: null,
    visible: null,
});

export function inhalteStand(): AdminContentSwitches {
    return {
        now: new Date().toISOString(),
        revision: 4,
        source: "database",
        rows: [
            zeile("media.role.coat", "media_role"),
            zeile("media.role.header", "media_role"),
            zeile("media.role.map_preview", "media_role"),
            zeile("media.role.literature_cover", "media_role"),
            zeile("media.role.photobox", "media_role"),
            zeile("media.role.social_post", "media_role"),
            zeile("media.rights.permission", "media_rights"),
            zeile("media.rights.fan_policy", "media_rights"),
            zeile("media.rights.own_work", "media_rights"),
            zeile("media.rights.public_domain", "media_rights"),
            zeile("media.rights.unclear", "media_rights"),
            zeile("media.license.cc-by", "media_rights"),
            zeile("media.license.cc-by-nc-sa", "media_rights"),
            zeile("media.license.cc-by-sa", "media_rights"),
            zeile("media.license.cc0", "media_rights"),
            zeile("media.license.public-domain", "media_rights"),
            zeile("panel.literature", "panel"),
            zeile("panel.citymaps", "panel"),
            zeile("panel.lore.flora", "panel"),
            zeile("panel.lore.fauna", "panel"),
            zeile("panel.lore.spezies", "panel"),
            zeile("panel.lore.ware", "panel"),
            zeile("panel.reviews", "panel"),
            zeile("map.series.modern", "map"),
            zeile("map.series.original", "map"),
            zeile("route.compute", "map"),
            zeile("map.terrain3d", "map"),
            zeile("visits.count", "betrieb"),
            zeile("photobox.submissions", "betrieb"),
        ],
        unknownKeys: [],
    };
}

export interface InhalteServer {
    state: AdminContentSwitches;
    posts: Record<string, unknown>[];
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

export function inhalteServer(initial: AdminContentSwitches = inhalteStand()): InhalteServer {
    const server: InhalteServer = {
        state: structuredClone(initial),
        posts: [],
        handle(call) {
            if (call.path !== "/api/admin/system/content-switches") return undefined;
            if (call.method === "GET") return { status: 200, body: { ...server.state, now: new Date().toISOString() } };
            const body = call.body ?? {};
            server.posts.push(body);
            if (body["baseRevision"] !== server.state.revision) {
                return { status: 409, body: { error: { code: "edit_conflict", message: "vom Nachbau" } } };
            }
            const row = server.state.rows.find((entry) => entry.key === body["key"]);
            if (row === undefined)
                return { status: 400, body: { error: { code: "unknown_switch", message: "vom Nachbau" } } };
            row.enabled = body["enabled"] === true;
            row.changedAt = new Date().toISOString();
            row.changedBy = "Rondrikan";
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
