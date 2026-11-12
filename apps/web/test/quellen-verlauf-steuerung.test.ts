import { effectScope, type EffectScope } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type {
    InhalteTraegerQuelle,
    InhalteTraegerQuellen,
    InhalteTraegerQuellenBody,
    MapHistoryEntry,
    OperationReceipt,
} from "@avesmaps3d/shared";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import { quellenZeilen, type QuellenZeile } from "../src/fenster/quellen-verlauf-modell.ts";
import { createQuellenVerlauf, type QuellenVerlauf } from "../src/fenster/quellen-verlauf-steuerung.ts";
import type { TraegerQuellenClient } from "../src/fenster/traeger-quellen-steuerung.ts";

/**
 * ↺ an den Zeilen der Quellen im Verlauf (WI-0254 §12) mit einem falschen Client statt des Servers: wann ein Knopf da ist, wann er gesperrt ist, und was beim Zurücknehmen geschieht (den Stand neu lesen, prüfen,
 * EIN Schreiben gegen den heutigen Stand, danach der Verlauf neu). Die Rechnung selbst prüft `quellen-verlauf-modell.test.ts`.
 *
 * Problemfälle: ein ↺, das gegen einen Stand schreibt, der inzwischen anders ist; ein Knopf für jemanden ohne Recht; ein Schreiben, wenn die Prüfung am frisch gelesenen Stand schon durchfällt.
 */

const ORT = "00000000-0000-4000-8000-0000000000a1";
const sid = (nr: number): string => `00000000-0000-4000-8000-00000000060${String(nr)}`;

const quelle = (teil: Partial<InhalteTraegerQuelle> = {}): InhalteTraegerQuelle => ({
    sourceId: sid(1),
    title: "Herz des Reiches",
    sourceType: "regionalspielhilfe",
    offiziell: true,
    url: null,
    referenceKind: "ausfuehrlich",
    pages: "14",
    note: null,
    state: "active",
    updatedAt: "2026-10-28T10:00:00.000Z",
    wiki: null,
    ...teil,
});
const antwortMit = (
    quellen: readonly InhalteTraegerQuelle[],
    teil: Partial<InhalteTraegerQuellen> = {},
): InhalteTraegerQuellen => ({
    traeger: { kind: "place", id: ORT, name: "Gareth", aktiv: true },
    aenderbar: true,
    wiki: null,
    quellen: [...quellen],
    ...teil,
});

/** Der Eintrag „Seiten 12 → 14“ an der Quelle 1. */
const EINTRAG: MapHistoryEntry = {
    operationId: "00000000-0000-4000-8000-0000000000e1",
    seq: 7,
    at: "2026-10-28T10:00:00.000Z",
    operation: "traeger.sources",
    source: "editor",
    actor: { kind: "person", name: "Hesindiane" },
    objects: [
        {
            kind: "place",
            id: ORT,
            action: "place.sources_changed",
            revisionBefore: null,
            revisionAfter: null,
            changes: {
                quellen: {
                    before: [
                        {
                            sourceId: sid(1),
                            title: "Herz des Reiches",
                            state: "active",
                            referenceKind: "ausfuehrlich",
                            pages: "12",
                            note: null,
                        },
                    ],
                    after: [
                        {
                            sourceId: sid(1),
                            title: "Herz des Reiches",
                            state: "active",
                            referenceKind: "ausfuehrlich",
                            pages: "14",
                            note: null,
                        },
                    ],
                },
            },
        },
    ],
};
const ZEILE: QuellenZeile = quellenZeilen(EINTRAG, ORT)[0]!;

const QUITTUNG = { operationId: "x", affected: [], warnings: [] } as unknown as OperationReceipt;
const ok: SchreibAntwort<OperationReceipt> = { ok: true, quittung: QUITTUNG };

interface Server {
    stand: InhalteTraegerQuellen;
    readonly geschrieben: InhalteTraegerQuellenBody[];
    lesungen: number;
    antwort: (body: InhalteTraegerQuellenBody) => SchreibAntwort<OperationReceipt>;
    readonly client: TraegerQuellenClient;
}

function falscherServer(start: InhalteTraegerQuellen): Server {
    const server: Server = {
        stand: start,
        geschrieben: [],
        lesungen: 0,
        antwort: () => ok,
        client: {
            lies: async () => {
                server.lesungen += 1;
                return structuredClone(server.stand);
            },
            schreibe: async (_kind, _id, body) => {
                server.geschrieben.push(structuredClone(body));
                return server.antwort(body);
            },
            suche: async () => [],
        },
    };
    return server;
}

const scopes: EffectScope[] = [];
afterEach(() => {
    while (scopes.length > 0) scopes.pop()?.stop();
});

function baue(
    start: InhalteTraegerQuellen,
    rechte: { recht?: boolean; schreibt?: boolean } = {},
    eintraege: readonly MapHistoryEntry[] = [EINTRAG],
) {
    const server = falscherServer(start);
    let nachAnzahl = 0;
    const scope = effectScope();
    scopes.push(scope);
    const verlauf = scope.run(() =>
        createQuellenVerlauf(() => ({ kind: "place", id: ORT }), {
            eintraege: () => eintraege,
            client: server.client,
            neueOperationId: () => "op-1",
            recht: () => rechte.recht ?? true,
            schreibt: () => rechte.schreibt ?? true,
            nach: () => {
                nachAnzahl += 1;
            },
        }),
    ) as QuellenVerlauf;
    return { server, verlauf, nach: () => nachAnzahl };
}
const bereit = async (v: QuellenVerlauf): Promise<void> => {
    for (let i = 0; i < 20 && v.daten.value === undefined; i += 1) await Promise.resolve();
};

describe("Wann ↺ da ist", () => {
    it("🔴 erst, wenn der Stand der Quellen gelesen ist", async () => {
        const { verlauf } = baue(antwortMit([quelle()]));
        expect(verlauf.plan(ZEILE)).toBeUndefined();
        await bereit(verlauf);
        expect(verlauf.plan(ZEILE)).toEqual({ art: "geht" });
    });

    it("🔴 ohne das Recht, ohne Schreibrecht des Editors oder an einem nicht änderbaren Objekt gibt es keinen Knopf", async () => {
        for (const [rechte, stand] of [
            [{ recht: false }, antwortMit([quelle()])],
            [{ schreibt: false }, antwortMit([quelle()])],
            [{}, antwortMit([quelle()], { aenderbar: false, grund: "still" })],
        ] as const) {
            const { verlauf } = baue(stand, rechte);
            await bereit(verlauf);
            expect(verlauf.plan(ZEILE)).toBeUndefined();
        }
    });

    it("🔴 gesperrt mit Satz, wenn die Quelle seitdem anders dasteht", async () => {
        const { verlauf } = baue(antwortMit([quelle({ pages: "99" })]));
        await bereit(verlauf);
        const plan = verlauf.plan(ZEILE);
        expect(plan?.art).toBe("gesperrt");
        expect(plan?.art === "gesperrt" && plan.satz.length > 0).toBe(true);
    });
});

describe("Zurücknehmen", () => {
    it("🔴 liest den Stand neu, schreibt EINE Änderung gegen den heutigen Stand (vorher), liest wieder und meldet dem Verlauf", async () => {
        const { verlauf, server, nach } = baue(antwortMit([quelle()]));
        await bereit(verlauf);
        server.antwort = () => {
            server.stand = antwortMit([quelle({ pages: "12" })]);
            return ok;
        };
        expect(await verlauf.zuruecknehmen(ZEILE)).toBe(true);
        expect(server.geschrieben).toEqual([
            {
                operationId: "op-1",
                aenderungen: [
                    {
                        op: "update",
                        sourceId: sid(1),
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "14", note: null },
                        referenceKind: "ausfuehrlich",
                        pages: "12",
                        note: null,
                    },
                ],
            },
        ]);
        // gelesen: beim Start, vor dem Schreiben, danach.
        expect(server.lesungen).toBe(3);
        expect(nach()).toBe(1);
        expect(verlauf.sendet.value).toBeUndefined();
        expect(verlauf.daten.value?.quellen[0]?.pages).toBe("12");
    });

    it("💣 hat sich die Quelle zwischen Anzeige und Klick geändert, schreibt nichts: Der Satz steht an der Zeile", async () => {
        const { verlauf, server } = baue(antwortMit([quelle()]));
        await bereit(verlauf);
        // Jemand ändert die Seiten, nachdem der Verlauf den Stand las.
        server.stand = antwortMit([quelle({ pages: "99" })]);
        expect(await verlauf.zuruecknehmen(ZEILE)).toBe(false);
        expect(server.geschrieben).toHaveLength(0);
        expect(verlauf.meldung.value?.schluessel).toBe(ZEILE.schluessel);
        // Der Knopf ist jetzt gesperrt.
        expect(verlauf.plan(ZEILE)?.art).toBe("gesperrt");
    });

    it("409: der Satz nennt wer und wann, der Stand wird neu gelesen", async () => {
        const { verlauf, server } = baue(antwortMit([quelle()]));
        await bereit(verlauf);
        server.antwort = () => {
            server.stand = antwortMit([quelle({ pages: "55" })]);
            return {
                ok: false,
                status: 409,
                fehler: {
                    code: "edit_conflict",
                    message: "Jemand hat das gerade geändert.",
                    details: { changedBy: { displayName: "Alara" }, changedAt: new Date().toISOString() },
                },
            };
        };
        expect(await verlauf.zuruecknehmen(ZEILE)).toBe(false);
        expect(verlauf.meldung.value?.satz).toContain("Alara");
        expect(verlauf.daten.value?.quellen[0]?.pages).toBe("55");
    });

    it("423 und Co.: der Satz des Servers an der Zeile", async () => {
        const { verlauf, server } = baue(antwortMit([quelle()]));
        await bereit(verlauf);
        server.antwort = () => ({
            ok: false,
            status: 423,
            fehler: { code: "map_editing_off", message: "Das Bearbeiten der Karte ist ausgeschaltet." },
        });
        expect(await verlauf.zuruecknehmen(ZEILE)).toBe(false);
        expect(verlauf.meldung.value).toEqual({
            schluessel: ZEILE.schluessel,
            satz: "Das Bearbeiten der Karte ist ausgeschaltet.",
        });
    });

    it("ohne Recht schreibt nichts, auch wenn jemand den Knopf anders erreicht", async () => {
        const { verlauf, server } = baue(antwortMit([quelle()]), { recht: false });
        await bereit(verlauf);
        expect(await verlauf.zuruecknehmen(ZEILE)).toBe(false);
        expect(server.geschrieben).toHaveLength(0);
    });
});

describe("↺ nur an der jüngsten Zeile je Quelle", () => {
    /** Ein älterer Eintrag derselben Quelle: Seiten 10 → 12. */
    const AELTER: MapHistoryEntry = {
        ...EINTRAG,
        operationId: "00000000-0000-4000-8000-0000000000e0",
        seq: 3,
        objects: EINTRAG.objects.map((o) => ({
            ...o,
            changes: {
                quellen: {
                    before: [
                        {
                            sourceId: sid(1),
                            title: "Herz des Reiches",
                            state: "active",
                            referenceKind: "ausfuehrlich",
                            pages: "10",
                            note: null,
                        },
                    ],
                    after: [
                        {
                            sourceId: sid(1),
                            title: "Herz des Reiches",
                            state: "active",
                            referenceKind: "ausfuehrlich",
                            pages: "12",
                            note: null,
                        },
                    ],
                },
            },
        })),
    };
    const alt = quellenZeilen(AELTER, ORT)[0]!;

    it("🔴 die ältere Zeile hat weder Knopf noch Satz, auch wenn sie nicht mehr zum heutigen Stand passt; die jüngste hat den Knopf", async () => {
        const { verlauf } = baue(antwortMit([quelle()]), {}, [AELTER, EINTRAG]);
        await bereit(verlauf);
        expect(verlauf.plan(alt)).toBeUndefined();
        expect(verlauf.plan(ZEILE)).toEqual({ art: "geht" });
    });

    it("🔴 die Reihenfolge der Liste entscheidet nicht, die Folge der Operationen (seq) schon", async () => {
        const { verlauf } = baue(antwortMit([quelle()]), {}, [EINTRAG, AELTER]);
        await bereit(verlauf);
        expect(verlauf.plan(alt)).toBeUndefined();
        expect(verlauf.plan(ZEILE)).toEqual({ art: "geht" });
    });

    it("🔴 gesperrt mit Satz bleibt nur die jüngste Zeile, und nur wenn sie nicht mehr zum heutigen Stand passt; die ältere schweigt weiter", async () => {
        const { verlauf } = baue(antwortMit([quelle({ pages: "99" })]), {}, [AELTER, EINTRAG]);
        await bereit(verlauf);
        expect(verlauf.plan(ZEILE)?.art).toBe("gesperrt");
        expect(verlauf.plan(alt)).toBeUndefined();
    });

    it("🔴 an der älteren Zeile schreibt ↺ auch dann nichts, wenn jemand es anders anstößt", async () => {
        const { verlauf, server } = baue(antwortMit([quelle({ pages: "12" })]), {}, [AELTER, EINTRAG]);
        await bereit(verlauf);
        expect(await verlauf.zuruecknehmen(alt)).toBe(false);
        expect(server.geschrieben).toHaveLength(0);
    });
});

describe("Die Straße eines Wegs", () => {
    // Die Operation hängt am Anker der Straße; gelesen und geschrieben wird unter dem Abschnitt, den das Fenster kennt (hier der zweite).
    const ANKER = "00000000-0000-4000-8000-0000000000b1";
    const ZWEITER = "00000000-0000-4000-8000-0000000000b2";
    const WEG_EINTRAG: MapHistoryEntry = {
        ...EINTRAG,
        objects: EINTRAG.objects.map((o) => ({
            ...o,
            kind: "path" as const,
            id: ANKER,
            action: "path.sources_changed",
        })),
    };
    const wegZeile = quellenZeilen(WEG_EINTRAG, [ANKER, ZWEITER])[0]!;

    function baueWeg(start: InhalteTraegerQuellen, ids: readonly string[] | undefined) {
        const server = falscherServer(start);
        const gelesen: string[] = [];
        const geschrieben: string[] = [];
        const lies = server.client.lies;
        const schreibe = server.client.schreibe;
        server.client.lies = async (kind, id, signal) => {
            gelesen.push(`${kind}/${id}`);
            return lies(kind, id, signal);
        };
        server.client.schreibe = async (kind, id, body) => {
            geschrieben.push(`${kind}/${id}`);
            return schreibe(kind, id, body);
        };
        const scope = effectScope();
        scopes.push(scope);
        const verlauf = scope.run(() =>
            createQuellenVerlauf(() => ({ kind: "path", id: ZWEITER, ids }), {
                eintraege: () => [WEG_EINTRAG],
                client: server.client,
                neueOperationId: () => "op-weg",
                recht: () => true,
                schreibt: () => true,
            }),
        ) as QuellenVerlauf;
        return { server, verlauf, gelesen, geschrieben };
    }

    it("🔴 ↺ an einer Zeile, die am Anker hängt, geht über jeden Abschnitt der Straße und schreibt unter dem Abschnitt des Fensters", async () => {
        const stand = antwortMit([quelle()], {
            traeger: { kind: "path", id: ZWEITER, name: "Reichsstraße", aktiv: true },
        });
        const { verlauf, server, gelesen, geschrieben } = baueWeg(stand, [ANKER, ZWEITER]);
        await bereit(verlauf);
        expect(verlauf.plan(wegZeile)).toEqual({ art: "geht" });
        server.antwort = () => {
            server.stand = antwortMit([quelle({ pages: "12" })], { traeger: stand.traeger });
            return ok;
        };
        expect(await verlauf.zuruecknehmen(wegZeile)).toBe(true);
        expect(geschrieben).toEqual([`path/${ZWEITER}`]);
        expect(gelesen.every((eine) => eine === `path/${ZWEITER}`)).toBe(true);
        expect(server.geschrieben[0]?.aenderungen).toEqual([
            expect.objectContaining({ op: "update", sourceId: sid(1), pages: "12" }),
        ]);
    });

    it("ohne die Kennungen der Straße kennt der Verlauf nur die eine Kennung des Fensters: Ein Eintrag am Anker gehört ihm nicht", async () => {
        const { verlauf } = baueWeg(antwortMit([quelle()]), undefined);
        await bereit(verlauf);
        expect(verlauf.plan(wegZeile)).toBeUndefined();
    });
});
