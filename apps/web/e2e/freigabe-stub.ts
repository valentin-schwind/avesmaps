import type { Page, Route } from "@playwright/test";
import type { EditorLockRequestState } from "@avesmaps3d/shared";
import { GRATENFELS, GRATENFELS_LAGE } from "./ortseditor-stub.ts";

/**
 * Der Server der Sperren im Speicher, mit der Bitte um Freigabe (WI-0262, OPS-000059): EIN Zustand für zwei Seiten. Der Inhaber (Seite A)
 * nimmt die Sperre am Ort, der Bittende (Seite B) sieht sie, bittet, und die Antworten laufen über denselben Zustand wie am echten Server
 * (`apps/server/src/editor/editor-lock-request.ts`, dort gegen echtes PostgreSQL geprüft). Nichts geht an die Datenbank.
 *
 * Eine Seite meldet sich mit ihrer Person an `stubFreigabe`; welcher Lauf sie ist, lernt der Server aus dem ersten Aufruf (`run`).
 */
export interface Person {
    readonly id: string;
    readonly name: string;
}
export const THOMAS: Person = { id: "c7c7c7c7-0000-4000-8000-0000000000f1", name: "Thomas" };
export const VALENTIN: Person = { id: "c7c7c7c7-0000-4000-8000-0000000000f2", name: "Valentin" };

export interface Bitte {
    id: string;
    von: Person;
    haltenderLauf: string;
    halter: Person;
    stand: EditorLockRequestState;
    erstelltAm: string;
    laeuftAb: string;
}

export interface FreigabeServer {
    sperre?: { halter: Person; lauf: string; teil: string; seit: string } | undefined;
    bitten: Bitte[];
    /** Alle Aufrufe in der Reihenfolge, als `"<Seite> <Methode> <Pfad>"`. */
    aufrufe: string[];
}

export function freigabeServer(): FreigabeServer {
    return { bitten: [], aufrufe: [] };
}

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Die Bitte, wie der Bittende sie sieht: offen nur, solange der Halter sie noch hält und sie nicht abgelaufen ist. */
function standFuerBittenden(server: FreigabeServer, bitte: Bitte): EditorLockRequestState {
    if (bitte.stand !== "open") return bitte.stand;
    if (server.sperre === undefined) return "released";
    return server.sperre.lauf === bitte.haltenderLauf ? "open" : "expired";
}

/** Hängt die Sperren-Routen an eine Seite. Nach `oeffneOrtseditor` aufrufen: Später gesetzte Routen gelten zuerst. */
export async function stubFreigabe(page: Page, server: FreigabeServer, seite: string, wer: Person): Promise<void> {
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift|request|request\/answer))?(\?.*)?$/, (route) => {
        const anfrage = route.request();
        const url = new URL(anfrage.url());
        const pfad = url.pathname.replace("/api/editor/locks", "") || "/";
        server.aufrufe.push(`${seite} ${anfrage.method()} ${pfad}`);
        if (anfrage.method() === "GET") {
            const lauf = url.searchParams.get("run");
            const art = url.searchParams.get("kind");
            const sperre = server.sperre;
            const locks =
                sperre !== undefined && art === "place"
                    ? [
                          {
                              kind: "place",
                              id: GRATENFELS,
                              part: sperre.teil,
                              person: sperre.halter,
                              since: sperre.seit,
                              heartbeatAt: new Date().toISOString(),
                              own: sperre.lauf === lauf,
                              at: GRATENFELS_LAGE,
                          },
                      ]
                    : [];
            const requests = server.bitten
                .filter((b) => b.von.id === wer.id && art === "place")
                .map((b) => ({
                    requestId: b.id,
                    kind: "place",
                    id: GRATENFELS,
                    state: standFuerBittenden(server, b),
                    createdAt: b.erstelltAm,
                    expiresAt: b.laeuftAb,
                }));
            return json(route, 200, requests.length === 0 ? { locks } : { locks, requests });
        }
        const body = (anfrage.postDataJSON() ?? {}) as Record<string, string>;
        if (pfad === "/") {
            if (server.sperre !== undefined && server.sperre.lauf !== body["run"])
                return json(route, 409, {
                    error: {
                        code: "object_locked",
                        message: "gesperrt",
                        details: {
                            lock: {
                                kind: "place",
                                id: GRATENFELS,
                                part: server.sperre.teil,
                                person: server.sperre.halter,
                                since: server.sperre.seit,
                                heartbeatAt: new Date().toISOString(),
                                own: false,
                            },
                        },
                    },
                });
            server.sperre ??= { halter: wer, lauf: body["run"]!, teil: body["part"]!, seit: new Date().toISOString() };
            return json(route, 200, {
                lock: {
                    kind: "place",
                    id: GRATENFELS,
                    part: server.sperre.teil,
                    person: wer,
                    since: server.sperre.seit,
                    heartbeatAt: new Date().toISOString(),
                    own: true,
                },
            });
        }
        if (pfad === "/heartbeat") {
            const eingang = server.bitten
                .filter(
                    (b) => b.stand === "open" && b.haltenderLauf === body["run"] && server.sperre?.lauf === body["run"],
                )
                .map((b) => ({
                    requestId: b.id,
                    kind: "place",
                    id: GRATENFELS,
                    from: b.von,
                    createdAt: b.erstelltAm,
                    expiresAt: b.laeuftAb,
                }));
            return json(route, 200, eingang.length === 0 ? { lost: [] } : { lost: [], requests: eingang });
        }
        if (pfad === "/release") {
            if (server.sperre?.lauf === body["run"]) {
                for (const b of server.bitten)
                    if (b.stand === "open" && b.haltenderLauf === body["run"]) b.stand = "released";
                server.sperre = undefined;
            }
            return route.fulfill({ status: 204 });
        }
        if (pfad === "/request") {
            if (server.sperre === undefined)
                return json(route, 409, { error: { code: "not_locked", message: "frei" } });
            if (server.sperre.lauf === body["run"])
                return json(route, 409, { error: { code: "own_lock", message: "eigene" } });
            const offene = server.bitten.find((b) => b.von.id === wer.id && b.stand === "open");
            const jetzt = Date.now();
            const bitte: Bitte = offene ?? {
                id: `c7c7c7c7-0000-4000-8000-00000000b${String(server.bitten.length + 1).padStart(3, "0")}`,
                von: wer,
                haltenderLauf: server.sperre.lauf,
                halter: server.sperre.halter,
                stand: "open",
                erstelltAm: new Date(jetzt).toISOString(),
                laeuftAb: new Date(jetzt + 5 * 60_000).toISOString(),
            };
            if (offene === undefined) server.bitten.push(bitte);
            const request = {
                requestId: bitte.id,
                kind: "place",
                id: GRATENFELS,
                state: "open",
                createdAt: bitte.erstelltAm,
                expiresAt: bitte.laeuftAb,
            };
            return offene === undefined
                ? json(route, 200, { request })
                : json(route, 409, { error: { code: "request_open", message: "offen", details: { request } } });
        }
        if (pfad === "/request/answer") {
            const bitte = server.bitten.find((b) => b.id === body["requestId"]);
            if (bitte === undefined) return json(route, 404, { error: { code: "request_not_found", message: "?" } });
            if (bitte.haltenderLauf !== body["run"] || bitte.halter.id !== wer.id)
                return json(route, 403, { error: { code: "not_lock_holder", message: "nicht der Inhaber" } });
            if (bitte.stand !== "open" && bitte.stand !== body["answer"])
                return json(route, 409, { error: { code: "request_closed", message: "geschlossen" } });
            if (bitte.stand === "open") {
                bitte.stand = body["answer"] as EditorLockRequestState;
                if (body["answer"] === "released") server.sperre = undefined;
            }
            return route.fulfill({ status: 204 });
        }
        return route.fulfill({ status: 204 });
    });
}

/** Die Bitte läuft ab, als wären fünf Minuten vergangen (der Server setzt es beim Lesen, `ownEditorLockRequests`). */
export function laufeAb(server: FreigabeServer): void {
    for (const b of server.bitten) if (b.stand === "open") b.stand = "expired";
}
