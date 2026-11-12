import type { Page, Route } from "@playwright/test";
import type { Benachrichtigung, BenachrichtigungListe } from "@avesmaps3d/shared";

/**
 * Die Benachrichtigungen ohne Datenbank (WI-0136 N2): ein kleiner Server im Speicher für `/api/benachrichtigungen` mit ETag, „gelesen“ und
 * der Antwort auf „Fix ist live“. Die echten Routen und die Auslöser im Kanal prüft `apps/server/test/benachrichtigungen.test.ts`.
 */

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;

export function benachrichtigungen(): Benachrichtigung[] {
    return [
        {
            id: 12,
            art: "kanal_fix_live",
            von: { art: "claudio", id: null, name: null },
            ops: "OPS-000127",
            text: "See-321 wird sichtbar",
            frageGeloest: true,
            erstelltAt: ago(6 * MIN),
            gelesenAt: null,
            beantwortetAt: null,
            antwort: null,
            vorgang: { status: "zur_abnahme", abgenommenVon: null, abgenommenAt: null },
        },
        {
            id: 11,
            art: "kanal_uebernommen",
            von: { art: "claudia", id: null, name: null },
            ops: "OPS-000131",
            text: null,
            frageGeloest: false,
            erstelltAt: ago(60 * MIN),
            gelesenAt: null,
            beantwortetAt: null,
            antwort: null,
            vorgang: { status: "bei_claudia", abgenommenVon: null, abgenommenAt: null },
        },
        {
            id: 9,
            art: "kanal_fix_live",
            von: { art: "claudio", id: null, name: null },
            ops: "OPS-000128",
            text: "Abstand der Höhenlinien",
            frageGeloest: false,
            erstelltAt: ago(20 * 60 * MIN),
            gelesenAt: ago(19 * 60 * MIN),
            beantwortetAt: null,
            antwort: null,
            vorgang: { status: "abgenommen", abgenommenVon: "Thomas", abgenommenAt: ago(18 * 60 * MIN) },
        },
    ];
}

export interface BenachrichtigungServer {
    eintraege: Benachrichtigung[];
    posts: { path: string; body: Record<string, unknown> }[];
    /** Gesetzt: die nächste Abfrage scheitert mit diesem Status. */
    fehler: number | null;
}

export async function stubBenachrichtigungen(
    page: Page,
    eintraege: Benachrichtigung[] = benachrichtigungen(),
): Promise<BenachrichtigungServer> {
    const server: BenachrichtigungServer = { eintraege: structuredClone(eintraege), posts: [], fehler: null };
    const liste = (): BenachrichtigungListe => ({
        ungelesen: server.eintraege.filter((e) => e.gelesenAt === null).length,
        eintraege: server.eintraege,
    });
    await page.route("**/api/benachrichtigungen**", async (route: Route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
            route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
        if (request.method() === "GET") {
            if (server.fehler !== null)
                return json(server.fehler, { error: { code: "unavailable", message: "vom Nachbau" } });
            const body = liste();
            const etag = `"n${String(JSON.stringify(body).length)}-${String(body.ungelesen)}-${String(body.eintraege.length)}"`;
            if (request.headers()["if-none-match"] === etag) return route.fulfill({ status: 304, headers: { etag } });
            return json(200, body, { etag });
        }
        const body = request.postDataJSON() as Record<string, unknown>;
        server.posts.push({ path, body });
        if (path.endsWith("/gelesen")) {
            for (const e of server.eintraege)
                if (e.id <= Number(body["bis"]) && e.gelesenAt === null) e.gelesenAt = new Date().toISOString();
            return json(200, { ungelesen: liste().ungelesen });
        }
        const treffer = /\/api\/benachrichtigungen\/(\d+)\/antwort$/u.exec(path);
        const eintrag = server.eintraege.find((e) => e.id === Number(treffer?.[1]));
        if (eintrag === undefined) return json(404, { error: { code: "not_found", message: "vom Nachbau" } });
        if (eintrag.vorgang?.status !== "zur_abnahme")
            return json(409, { error: { code: "kanal_transition", message: "vom Nachbau" } });
        eintrag.antwort = body["antwort"] as "geloest";
        eintrag.beantwortetAt = new Date().toISOString();
        eintrag.vorgang =
            body["antwort"] === "geloest"
                ? { status: "abgenommen", abgenommenVon: "Rondrikan", abgenommenAt: new Date().toISOString() }
                : { status: "in_arbeit", abgenommenVon: null, abgenommenAt: null };
        return json(200, {
            operationId: body["operationId"],
            status: "applied",
            environment: "staging",
            affected: [{ kind: "kanal_vorgang", id: eintrag.ops }],
            derivedWork: [],
            warnings: [],
        });
    });
    return server;
}
