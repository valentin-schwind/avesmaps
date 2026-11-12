import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { AVENTURIA, parseDisplayHeightPointer } from "@avesmaps3d/shared";
import { displayHeightState } from "../terrain/display-height/pointer.ts";
import { LIVE_HEADER, offersAreaEvents } from "./live-hint.ts";

/**
 * Der Zeiger der Anzeigehöhen (WI-0055, ADR-0012): Gibt es Höhenlinien und Höhenstufen, und zu welchem
 * Gelände? Die Linien und Flächen selbst liefert Martin (`terrain_contour_tile`, `terrain_height_band_tile`).
 * Ohne Zeiger zeigt die Karte keine Höhenlinien, keine Höhenstufen und keine Legende.
 *
 * 🔴 Nur eine Revision, die zum veröffentlichten Gelände und Relief passt (Kapitel 5.32a, Regel 2): Nach einem
 * neuen Gelände, bevor `derive:display-heights` gelaufen ist, antwortet der Zeiger 404 `display_height_stale`,
 * und die Karte zeigt keine alten Linien. 🪤 Neu KODIERTE Kacheln desselben Masters sind kein neues Gelände
 * (WI-0149, `displayHeightState`).
 *
 *     /tiles/terrain/display-height/current.json      welche Revision gilt
 *
 * 🔴 Der Zeiger trägt auch den Hinweis auf den Kanal `area` (`live-hint.ts`, WI-0125), auf jeder Antwort und auch
 * auf einer 404: Eine Karte ohne Grafikkarte liest den Geländezeiger gar nicht erst (WI-0049, Betreiber
 * 2026-09-27 „3: A“) und entdeckt den Kanal nur hier. Höhenlinien und Höhenstufen gibt es dort nämlich trotzdem -
 * es sind flache Linien und Flächen -, und ein Seitenreload ist nie der Weg der Synchronisation (7.29).
 */
export const displayHeightRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const unavailable = { error: { code: "database_unavailable", message: "Datenbank nicht verbunden." } };
    const live = offersAreaEvents(app);

    app.get("/tiles/terrain/display-height/current.json", async (request, reply) => {
        const database = app.database;
        if (!database) {
            return reply.code(503).header("cache-control", "no-store").send(unavailable);
        }
        if (live) reply.header(LIVE_HEADER, "area");
        const state = await displayHeightState(database, AVENTURIA.mapDomain);
        if (state.kind === "none") {
            return reply
                .code(404)
                .header("cache-control", "no-store")
                .send({ error: { code: "no_display_height", message: "Es sind keine Anzeigehöhen abgeleitet." } });
        }
        if (state.kind === "stale") {
            return reply
                .code(404)
                .header("cache-control", "no-store")
                .send({
                    error: {
                        code: "display_height_stale",
                        message:
                            "Die Anzeigehöhen gehören zu einem älteren Gelände oder Relief: erst derive:display-heights.",
                    },
                });
        }
        const body = JSON.stringify(
            parseDisplayHeightPointer({
                schemaVersion: 1,
                revision: state.revision,
                demRevision: state.demRevision,
            }),
        );
        const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
        reply.header("cache-control", "no-cache").header("etag", etag);
        if (request.headers["if-none-match"] === etag) {
            return reply.code(304).send();
        }
        return reply.header("content-type", "application/json; charset=utf-8").send(body);
    });
};
