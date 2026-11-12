import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
    KURZINFO_URL,
    Kurzinfo,
    ReleaseVoll,
    VERLAUF_ANZEIGE,
    VERSIONEN_URL,
    VersionParams,
    VersionenListe,
} from "@avesmaps3d/shared";
import type { FastifyBaseLogger } from "fastify";
import { ADMIN_ERRORS, noStore } from "../auth/admin-guard.ts";
import { protect, sessionOnly } from "../auth/plugin.ts";
import { ApiError } from "../http/api-error.ts";
import {
    kurzVon,
    leseVerlauf,
    verlaufVon,
    neueVersionVon,
    laufendesRelease,
    leseReleases,
    vollVon,
    type GeleseneReleases,
} from "../versionen/lesen.ts";

/**
 * „Versionen“ und die Kurzinfo „Was ist neu?“ (WI-0137, VERSION-0001 §3). Nur lesen, aus `config/releases/` des laufenden Release.
 *
 *     GET /api/admin/system/versionen          laufendes Release mit Commits, frühere kurz          view_operations
 *     GET /api/admin/system/versionen/:stamm   Commits eines früheren Release (Aufklappen)          view_operations
 *     GET /api/version/kurzinfo[?seit=<sha>]   Neuerungen seit dem Stand des Tabs, sonst Kurzinfo   Sitzung
 *
 * Nach einem Deploy fragt die alte Seite den schon neuen Server: Die Kurzinfo ist dann genau die der neuen Version, auf die „Neue Version“
 * zeigt. Sitzung statt öffentlich, weil „Neue Version“ nur Angemeldete sehen (WI-0136 §3.4).
 */

/** Eine kaputte Datei steht einmal im Log, nicht bei jeder Anfrage. */
function melde(log: FastifyBaseLogger, gemeldet: Set<string>, gelesen: GeleseneReleases): GeleseneReleases {
    for (const datei of gelesen.kaputt) {
        if (gemeldet.has(datei)) continue;
        gemeldet.add(datei);
        log.warn({ datei }, "Release-Notizen: Datei passt nicht zum Schema, ausgelassen");
    }
    return gelesen;
}

export const versionenRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const gemeldet = new Set<string>();
    const lies = async () => melde(app.log, gemeldet, await leseReleases());

    app.get(
        VERSIONEN_URL,
        { ...protect("view_operations"), schema: { response: { 200: VersionenListe, ...ADMIN_ERRORS } } },
        async () => {
            const gelesen = await lies();
            const verlauf = verlaufVon(await leseVerlauf(), VERLAUF_ANZEIGE);
            // Laufend ist die Datei des laufenden Stands, nicht die jüngste (`laufendesRelease`); alle anderen stehen darunter.
            const laufend = laufendesRelease(gelesen, app.config.releaseId);
            return {
                releaseId: app.config.releaseId,
                laufend: laufend === undefined ? null : vollVon(laufend),
                frueher: gelesen.releases
                    .filter((release) => release !== laufend)
                    .reverse()
                    .map(kurzVon),
                ...(verlauf === null ? {} : { verlauf }),
            };
        },
    );

    app.get(
        `${VERSIONEN_URL}/:stamm`,
        {
            ...protect("view_operations"),
            schema: { params: VersionParams, response: { 200: ReleaseVoll, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const release = (await lies()).releases.find((eintrag) => eintrag.stamm === request.params.stamm);
            if (release === undefined) throw new ApiError(404, "not_found", "Dieses Release gibt es hier nicht.");
            return vollVon(release);
        },
    );
};

/** `?seit=<sha>`: der Stand des offenen Tabs (WI-0137, „Neue Version“ zeigt die Neuerungen seitdem). */
const KurzinfoQuery = Type.Object(
    { seit: Type.Optional(Type.String({ pattern: "^[0-9a-f]{7,40}$" })) },
    { additionalProperties: false },
);

export const kurzinfoRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    const gemeldet = new Set<string>();
    app.get(
        KURZINFO_URL,
        { ...sessionOnly(), schema: { querystring: KurzinfoQuery, response: { 200: Kurzinfo, ...ADMIN_ERRORS } } },
        async (request) => {
            if ((await request.auth.session()) === undefined) {
                throw new ApiError(401, "unauthenticated", "Dafür ist eine Anmeldung nötig.");
            }
            return neueVersionVon(
                melde(app.log, gemeldet, await leseReleases()),
                await leseVerlauf(),
                app.config.releaseId,
                request.query.seit,
            );
        },
    );
};
