import type { FastifyReply } from "fastify";

/**
 * Ein Signal, das feuert, wenn der Client die Anfrage schließt, bevor die Antwort fertig ist (WI-0065 Nachtrag `bebb4630`,
 * WI-0123): Wer die Antwort nicht mehr abwartet, soll die Datenbank nicht weiter beschäftigen. Das Signal geht an
 * `withStatementTimeout` (`database.ts`), das dann die laufende Abfrage abbricht.
 *
 * 🪤 NICHT `request.signal`: Fastify hängt es an das `close` der ANFRAGE, und das kommt seit Node 16 schon, wenn der Körper
 * gelesen ist, nicht erst, wenn der Client geht. Das `close` der ANTWORT kommt, wenn die Verbindung zu ist, und
 * `writableFinished` unterscheidet das vom gewöhnlichen Ende.
 *
 * `release` gehört in ein `finally`: Danach hört niemand mehr auf die Antwort.
 */
export function watchClientClose(reply: FastifyReply): { signal: AbortSignal; release: () => void } {
    const closed = new AbortController();
    const onClose = (): void => {
        if (!reply.raw.writableFinished) closed.abort();
    };
    reply.raw.once("close", onClose);
    if (reply.raw.destroyed) closed.abort();
    return { signal: closed.signal, release: () => reply.raw.off("close", onClose) };
}
