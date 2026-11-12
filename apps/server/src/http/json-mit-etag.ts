import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { etagMatches } from "../media/delivery.ts";

/**
 * Lesende Listen der Editoren mit schwachem ETag (Orte, Landschaften, Wege, Kraftlinien, Herrschaftsgebiete): einmal serialisieren,
 * denselben Text für ETag und Körper (WI-0235, Review S8-15). Vorher stand dieselbe Hashfunktion in fünf Dateien, und jede Route
 * serialisierte die Liste zweimal (am Rechner 7,5 ms für die Ortsliste, rund 14 ms für alle vier großen beim Editorstart).
 *
 * 🪤 Der ETag kommt aus dem Inhalt, nicht aus einer Revision: Die Ortsliste liest rund elf Tafeln, und Medien- und Wiki-Änderungen
 * laufen nicht über `map_event`. Ein Revisions-ETag lieferte still einen veralteten Stand als 304.
 */
export function inhaltsEtag(text: string): string {
    return `W/"${createHash("sha256").update(text).digest("base64url").slice(0, 32)}"`;
}

/** Antwortet mit dem JSON von `inhalt`, oder mit 304, wenn der Browser genau diesen Stand schon hat (packen tut Nginx, Block E). */
export function sendeMitEtag(request: FastifyRequest, reply: FastifyReply, inhalt: unknown): FastifyReply {
    const body = JSON.stringify(inhalt);
    const etag = inhaltsEtag(body);
    void reply.header("cache-control", "private, no-cache").header("etag", etag);
    if (etagMatches(request.headers["if-none-match"], etag)) return reply.code(304).send();
    void reply.type("application/json; charset=utf-8");
    return reply.send(body);
}
