import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type {
    InhalteQuellenZeile,
    InhalteTraegerQuelle,
    InhalteTraegerQuellen,
    InhalteTraegerQuellenBody,
    OperationReceipt,
} from "@avesmaps3d/shared";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import {
    createTraegerQuellenSteuerung,
    type TraegerQuellenClient,
    type TraegerQuellenSteuerung,
    type TraegerZiel,
} from "../src/fenster/traeger-quellen-steuerung.ts";

/**
 * Die Quellen eines Kartenobjekts in den Editoren (WI-0254 §12) mit einem falschen Client statt des Servers: Lesen, Sofort-Speichern (jede Handlung EIN Schreiben mit `vorher`), die Sperre der Zeile,
 * die Fehler (409 neu lesen und Eingabe behalten, 423 Satz und Wert bleibt) und das Anhängen. Die Rechnung selbst prüft `traeger-quellen-modell.test.ts`, den Server `apps/server/test/inhalte-traeger-quellen.test.ts`.
 *
 * Problemfälle: ein Schreiben je Taste; ein Schreiben, wo sich nichts geändert hat (und die Notiz mit Vorlage wird durch ihren Klartext überschrieben); `vorher` aus der Anzeige statt dem gelesenen Stand;
 * eine Eingabe, die nach einem Konflikt oder einer Abweisung verschwindet; eine Zeile, die nicht gesperrt ist, während sie schreibt; zwei Schreiben, die einander überholen.
 */

const ORT = "00000000-0000-4000-8000-0000000000a1";
const sid = (nr: number): string => `00000000-0000-4000-8000-00000000060${String(nr)}`;

const quelle = (nr: number, teil: Partial<InhalteTraegerQuelle> = {}): InhalteTraegerQuelle => ({
    sourceId: sid(nr),
    title: `Quelle ${String(nr)}`,
    sourceType: "regionalspielhilfe",
    offiziell: true,
    url: null,
    referenceKind: "ausfuehrlich",
    pages: "130",
    note: "Beschreibt den Hof.",
    state: "active",
    updatedAt: "2026-10-28T10:00:00.000Z",
    wiki: { art: "ausfuehrlich", seiten: "130", notiz: "Beschreibt den Hof." },
    ...teil,
});

const antwortMit = (
    quellen: readonly InhalteTraegerQuelle[],
    teil: Partial<InhalteTraegerQuellen> = {},
): InhalteTraegerQuellen => ({
    traeger: { kind: "place", id: ORT, name: "Gareth", aktiv: true },
    aenderbar: true,
    wiki: { laufId: 7, dumpStand: "2026-10-20", beendetAm: "2026-10-21T03:00:00.000Z" },
    quellen: [...quellen],
    ...teil,
});

const QUITTUNG = { operationId: "x", affected: [], warnings: [] } as unknown as OperationReceipt;
const ok: SchreibAntwort<OperationReceipt> = { ok: true, quittung: QUITTUNG };
const abgelehnt = (
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
): SchreibAntwort<OperationReceipt> => ({
    ok: false,
    status,
    fehler: details === undefined ? { code, message } : { code, message, details },
});

type BeiSchreiben = (
    body: InhalteTraegerQuellenBody,
) => SchreibAntwort<OperationReceipt> | Promise<SchreibAntwort<OperationReceipt>>;

interface Schreiben {
    kind: string;
    id: string;
    body: InhalteTraegerQuellenBody;
}

interface FalscherServer {
    readonly geschrieben: Schreiben[];
    readonly lesungen: number;
    readonly aktuell: InhalteTraegerQuellen;
    setzeStand(neu: InhalteTraegerQuellen): void;
    setzeTreffer(neu: readonly InhalteQuellenZeile[]): void;
    setzeLeseFehler(an: boolean): void;
    /** Was auf ein Schreiben antwortet; sie darf den Stand ändern (`setzeStand`) und auf ein Versprechen warten. */
    beiSchreiben: BeiSchreiben;
    client: TraegerQuellenClient;
}

/** Ein Server aus Speicher: liest, was `stand` ist, schreibt auf Wunsch (`beiSchreiben`) und merkt sich jeden Aufruf. */
function falscherServer(start: InhalteTraegerQuellen): FalscherServer {
    let stand = start;
    const geschrieben: Schreiben[] = [];
    let lesungen = 0;
    let treffer: readonly InhalteQuellenZeile[] = [];
    let leseFehler = false;
    const server: FalscherServer = {
        geschrieben,
        get lesungen() {
            return lesungen;
        },
        get aktuell() {
            return stand;
        },
        setzeStand: (neu: InhalteTraegerQuellen) => {
            stand = neu;
        },
        setzeTreffer: (neu: readonly InhalteQuellenZeile[]) => {
            treffer = neu;
        },
        setzeLeseFehler: (an: boolean) => {
            leseFehler = an;
        },
        beiSchreiben: () => ok,
        client: {
            lies: async () => {
                lesungen += 1;
                if (leseFehler) throw new Error("kaputt");
                return structuredClone(stand);
            },
            schreibe: async (kind, id, body) => {
                geschrieben.push({ kind, id, body: structuredClone(body) });
                return await server.beiSchreiben(body);
            },
            suche: async () => treffer,
        },
    };
    return server;
}

const scopes: EffectScope[] = [];
afterEach(() => {
    while (scopes.length > 0) scopes.pop()?.stop();
});

function baue(start: InhalteTraegerQuellen, leseFehler = false) {
    const server = falscherServer(start);
    server.setzeLeseFehler(leseFehler);
    const ziel = ref<TraegerZiel | undefined>({ kind: "place", id: ORT });
    let nr = 0;
    const scope = effectScope();
    scopes.push(scope);
    const s = scope.run(() =>
        createTraegerQuellenSteuerung(() => ziel.value, {
            client: server.client,
            neueOperationId: () => `op-${String(++nr)}`,
            entprellMs: 0,
        }),
    ) as TraegerQuellenSteuerung;
    return { server, ziel, s };
}

/** Wartet, bis das erste Lesen angekommen ist. */
const bereit = async (s: TraegerQuellenSteuerung): Promise<void> => {
    for (let i = 0; i < 20 && s.daten.value === undefined; i += 1) await Promise.resolve();
};

describe("Lesen", () => {
    it("liest die Quellen des Objekts und zählt die aktiven", async () => {
        const { s, server } = baue(antwortMit([quelle(1), quelle(2, { state: "retired" }), quelle(3)]));
        expect(s.daten.value).toBeUndefined();
        await bereit(s);
        expect(s.daten.value?.quellen).toHaveLength(3);
        expect(s.zahl.value).toBe(2);
        expect(s.lesefehler.value).toBe(false);
        expect(server.lesungen).toBe(1);
    });

    it("scheitert das erste Lesen, steht ein Lesefehler da", async () => {
        const { s } = baue(antwortMit([quelle(1)]), true);
        for (let i = 0; i < 20 && !s.lesefehler.value; i += 1) await Promise.resolve();
        expect(s.lesefehler.value).toBe(true);
        expect(s.daten.value).toBeUndefined();
        expect(s.laedt.value).toBe(false);
    });

    it("scheitert ein späteres Lesen, bleibt die Anzeige stehen (kein Lesefehler über der Liste)", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        server.setzeLeseFehler(true);
        expect(await s.neuLesen()).toBe(false);
        expect(s.lesefehler.value).toBe(false);
        expect(s.daten.value?.quellen).toHaveLength(1);
    });

    it("ein anderes Objekt beginnt von vorn: Daten, Eingaben, Fehler und Sperre sind weg, und es wird neu gelesen", async () => {
        const { s, ziel, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        await s.aendere(sid(1), { pages: "99" });
        expect(s.eingaben.value.get(sid(1))).toEqual({ seiten: "99" });
        const gebiet = "00000000-0000-4000-8000-0000000000b2";
        server.setzeStand(
            antwortMit([quelle(7)], { traeger: { kind: "territory", id: gebiet, name: "Reich", aktiv: true } }),
        );
        ziel.value = { kind: "territory", id: gebiet };
        await nextTick();
        // Die Eingabe des alten Objekts ist weg, bevor die Antwort des neuen da ist.
        expect(s.eingaben.value.size).toBe(0);
        await bereit(s);
        expect(server.lesungen).toBe(2);
        expect(s.daten.value?.traeger.kind).toBe("territory");
        expect(s.daten.value?.quellen.map((q) => q.sourceId)).toEqual([sid(7)]);
    });
});

describe("Sofort speichern", () => {
    it("🔴 die Art speichert beim Wählen: EIN Schreiben mit EINER Änderung und vorher = gelesener Stand, danach wird neu gelesen", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        server.beiSchreiben = () => {
            server.setzeStand(antwortMit([quelle(1, { referenceKind: "ergaenzend" })]));
            return ok;
        };
        await s.aendere(sid(1), { referenceKind: "ergaenzend" });
        expect(server.geschrieben).toHaveLength(1);
        expect(server.geschrieben[0]).toEqual({
            kind: "place",
            id: ORT,
            body: {
                operationId: "op-1",
                aenderungen: [
                    {
                        op: "update",
                        sourceId: sid(1),
                        vorher: {
                            state: "active",
                            referenceKind: "ausfuehrlich",
                            pages: "130",
                            note: "Beschreibt den Hof.",
                        },
                        referenceKind: "ergaenzend",
                    },
                ],
            },
        });
        expect(server.lesungen).toBe(2);
        expect(s.daten.value?.quellen[0]?.referenceKind).toBe("ergaenzend");
        expect(s.fehler.value.size).toBe(0);
    });

    it("🔴 Fundstelle: Tippen schreibt nichts, erst das Verlassen des Felds; ein Schreiben mit dem getippten Wert", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        for (const stand of ["1", "12", "123"]) await s.aendere(sid(1), { pages: stand });
        expect(server.geschrieben).toHaveLength(0);
        expect(s.eingaben.value.get(sid(1))).toEqual({ seiten: "123" });
        server.beiSchreiben = () => {
            server.setzeStand(antwortMit([quelle(1, { pages: "123" })]));
            return ok;
        };
        await s.feldSchluss();
        expect(server.geschrieben).toHaveLength(1);
        expect(server.geschrieben[0]?.body.aenderungen).toEqual([
            {
                op: "update",
                sourceId: sid(1),
                vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "130", note: "Beschreibt den Hof." },
                pages: "123",
            },
        ]);
        // Nach dem Speichern folgt die Zeile dem Server: Die Eingabe ist eingelöst.
        expect(s.eingaben.value.size).toBe(0);
        expect(s.daten.value?.quellen[0]?.pages).toBe("123");
    });

    it("🔴 nur wenn sich der Wert geändert hat: derselbe Wert (auch mit Leerzeichen) schreibt nichts", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        await s.aendere(sid(1), { pages: " 130 " });
        await s.feldSchluss();
        expect(server.geschrieben).toHaveLength(0);
        expect(s.eingaben.value.size).toBe(0);
    });

    it("💣 eine Notiz mit Vorlage, die nur angeschaut wurde, wird nie mit ihrem Klartext überschrieben", async () => {
        const { s, server } = baue(antwortMit([quelle(1, { note: "{{R5}} Seite 12", wiki: null })]));
        await bereit(s);
        // Das Feld zeigt den Klartext; verlässt jemand es unverändert, meldet die Box genau diesen Text.
        await s.aendere(sid(1), { note: "DSA5-Regeln Seite 12" });
        await s.feldSchluss();
        expect(server.geschrieben).toHaveLength(0);
        // Ändert jemand ihn, wird geschrieben, was er tippt.
        await s.aendere(sid(1), { note: "DSA5-Regeln Seite 13" });
        server.beiSchreiben = () => ok;
        await s.feldSchluss();
        expect(server.geschrieben).toHaveLength(1);
        expect(server.geschrieben[0]?.body.aenderungen[0]).toMatchObject({
            op: "update",
            note: "DSA5-Regeln Seite 13",
        });
    });

    it("Lösen, Holen und „Wiki-Wert“ sind je ein Schreiben mit der passenden Operation", async () => {
        const { s, server } = baue(
            antwortMit([
                quelle(1),
                quelle(2, { state: "retired" }),
                quelle(3, { pages: "9", wiki: { art: "erwaehnung", seiten: "12", notiz: null } }),
            ]),
        );
        await bereit(s);
        await s.loese(sid(1));
        await s.stelleHer(sid(2));
        await s.aufWiki(sid(3));
        expect(server.geschrieben.map((x) => x.body.aenderungen[0]?.op)).toEqual(["remove", "restore", "update"]);
        expect(server.geschrieben[2]?.body.aenderungen[0]).toMatchObject({
            sourceId: sid(3),
            referenceKind: "erwaehnung",
            pages: "12",
            note: null,
        });
        // Jede Handlung bekam eine eigene Kennung.
        expect(new Set(server.geschrieben.map((x) => x.body.operationId)).size).toBe(3);
    });

    it("„Wiki-Wert“ verwirft, was in den Feldern der Zeile stand", async () => {
        const { s, server } = baue(
            antwortMit([quelle(1, { pages: "9", wiki: { art: "ausfuehrlich", seiten: "130", notiz: null } })]),
        );
        await bereit(s);
        await s.aendere(sid(1), { pages: "77" });
        server.beiSchreiben = () => ok;
        await s.aufWiki(sid(1));
        expect(s.eingaben.value.size).toBe(0);
    });

    it("🔴 die Zeile ist gesperrt, solange sie schreibt, und frei, sobald gelesen ist", async () => {
        const { s, server } = baue(antwortMit([quelle(1), quelle(2)]));
        await bereit(s);
        let freigabe: (a: SchreibAntwort<OperationReceipt>) => void = () => undefined;
        server.beiSchreiben = () => new Promise((auf) => (freigabe = auf));
        const lauf = s.aendere(sid(1), { referenceKind: null });
        await Promise.resolve();
        await Promise.resolve();
        expect(s.schreibend.value.has(sid(1))).toBe(true);
        // Andere Zeilen bleiben frei.
        expect(s.schreibend.value.has(sid(2))).toBe(false);
        freigabe(ok);
        await lauf;
        expect(s.schreibend.value.size).toBe(0);
    });

    it("🔴 Schreiben läuft nacheinander: das zweite liest `vorher` aus dem Ergebnis des ersten", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        const sperren: (() => void)[] = [];
        server.beiSchreiben = (body) =>
            new Promise((auf) => {
                const aenderung = body.aenderungen[0];
                sperren.push(() => {
                    if (aenderung?.op === "update" && aenderung.referenceKind !== undefined) {
                        server.setzeStand(antwortMit([quelle(1, { referenceKind: aenderung.referenceKind })]));
                    }
                    auf(ok);
                });
            });
        const erstes = s.aendere(sid(1), { referenceKind: "ergaenzend" });
        const zweites = s.aendere(sid(1), { referenceKind: "erwaehnung" });
        await new Promise((r) => setTimeout(r, 0));
        // Das zweite wartet auf das erste.
        expect(server.geschrieben).toHaveLength(1);
        sperren[0]?.();
        await erstes;
        await new Promise((r) => setTimeout(r, 0));
        expect(server.geschrieben).toHaveLength(2);
        expect(server.geschrieben[1]?.body.aenderungen[0]).toMatchObject({
            vorher: { referenceKind: "ergaenzend" },
            referenceKind: "erwaehnung",
        });
        sperren[1]?.();
        await zweites;
        expect(s.schreibend.value.size).toBe(0);
    });
});

describe("Die Felder bleiben bedienbar, während geschrieben wird", () => {
    it("🔴 Fundstelle verlassen und gleich danach die Art ändern: zwei Schreiben in dieser Reihenfolge, das zweite mit vorher nach dem ersten", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        const freigaben: (() => void)[] = [];
        server.beiSchreiben = (body) =>
            new Promise((auf) => {
                const a = body.aenderungen[0];
                freigaben.push(() => {
                    if (a?.op === "update") {
                        const jetzt = server.aktuell.quellen[0]!;
                        server.setzeStand(
                            antwortMit([
                                {
                                    ...jetzt,
                                    ...(a.pages !== undefined ? { pages: a.pages } : {}),
                                    ...(a.referenceKind !== undefined ? { referenceKind: a.referenceKind } : {}),
                                },
                            ]),
                        );
                    }
                    auf(ok);
                });
            });
        await s.aendere(sid(1), { pages: "77" });
        const verlassen = s.feldSchluss();
        // Der erste Klick auf die Art wirkt, obwohl das Schreiben der Fundstelle noch läuft.
        const art = s.aendere(sid(1), { referenceKind: "ergaenzend" });
        await new Promise((r) => setTimeout(r, 0));
        expect(server.geschrieben).toHaveLength(1);
        freigaben[0]?.();
        await verlassen;
        await new Promise((r) => setTimeout(r, 0));
        expect(server.geschrieben).toHaveLength(2);
        freigaben[1]?.();
        await art;
        expect(server.geschrieben.map((x) => x.body.aenderungen[0])).toEqual([
            {
                op: "update",
                sourceId: sid(1),
                vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "130", note: "Beschreibt den Hof." },
                pages: "77",
            },
            {
                op: "update",
                sourceId: sid(1),
                vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "77", note: "Beschreibt den Hof." },
                referenceKind: "ergaenzend",
            },
        ]);
        expect(s.daten.value?.quellen[0]).toMatchObject({ pages: "77", referenceKind: "ergaenzend" });
        expect(s.schreibend.value.size).toBe(0);
    });

    it("🔴 die Notiz verlassen, während die Fundstelle noch schreibt: auch die Notiz wird geschrieben", async () => {
        const { s, server } = baue(antwortMit([quelle(1, { wiki: null })]));
        await bereit(s);
        let erste: (() => void) | undefined;
        server.beiSchreiben = () =>
            new Promise((auf) => {
                if (erste === undefined) erste = () => auf(ok);
                else auf(ok);
            });
        await s.aendere(sid(1), { pages: "77" });
        const einsLauf = s.feldSchluss();
        await s.aendere(sid(1), { note: "Neu." });
        const zweiLauf = s.feldSchluss();
        await new Promise((r) => setTimeout(r, 0));
        erste?.();
        await Promise.all([einsLauf, zweiLauf]);
        expect(server.geschrieben.map((x) => Object.keys(x.body.aenderungen[0] ?? {}).sort())).toEqual([
            ["op", "pages", "sourceId", "vorher"],
            ["note", "op", "sourceId", "vorher"],
        ]);
    });

    it("dasselbe Feld mit demselben Wert schreibt nicht zweimal (Enter, dann Verlassen)", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        let frei: (() => void) | undefined;
        server.beiSchreiben = () => new Promise((auf) => (frei = () => auf(ok)));
        await s.aendere(sid(1), { pages: "77" });
        const enter = s.feldSchluss();
        const verlassen = s.feldSchluss();
        await new Promise((r) => setTimeout(r, 0));
        frei?.();
        await Promise.all([enter, verlassen]);
        expect(server.geschrieben).toHaveLength(1);
    });

    it("🔴 wer weitertippt, während sein Wert schreibt, verliert den neuen Text nicht", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        let frei: (() => void) | undefined;
        server.beiSchreiben = () =>
            new Promise((auf) => {
                frei = () => {
                    server.setzeStand(antwortMit([quelle(1, { pages: "77" })]));
                    auf(ok);
                };
            });
        await s.aendere(sid(1), { pages: "77" });
        const lauf = s.feldSchluss();
        await new Promise((r) => setTimeout(r, 0));
        await s.aendere(sid(1), { pages: "777" });
        frei?.();
        await lauf;
        // Der geschriebene Wert ist eingelöst, der neue Text steht noch im Feld.
        expect(s.eingaben.value.get(sid(1))).toEqual({ seiten: "777" });
        expect(s.daten.value?.quellen[0]?.pages).toBe("77");
    });

    it("die Art lässt Fundstelle und Notiz im Feld stehen, die noch nicht verlassen sind", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        await s.aendere(sid(1), { note: "halbfertig" });
        server.beiSchreiben = () => ok;
        await s.aendere(sid(1), { referenceKind: "erwaehnung" });
        expect(s.eingaben.value.get(sid(1))).toEqual({ notiz: "halbfertig" });
    });
});

describe("Fehler", () => {
    it("🔴 409: neu lesen, die Eingabe bleibt im Feld, der Fehler nennt wer und wann", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        await s.aendere(sid(1), { pages: "77" });
        server.beiSchreiben = () => {
            server.setzeStand(antwortMit([quelle(1, { pages: "55" })]));
            return abgelehnt(409, "edit_conflict", "Jemand hat das gerade geändert.", {
                changedBy: { displayName: "Hesindiane" },
                changedAt: "2026-10-28T10:00:00.000Z",
            });
        };
        await s.feldSchluss();
        expect(s.fehler.value.get(sid(1))).toEqual({
            art: "konflikt",
            wer: "Hesindiane",
            wann: "2026-10-28T10:00:00.000Z",
        });
        // Der Stand des Servers ist da, die Eingabe steht noch im Feld.
        expect(s.daten.value?.quellen[0]?.pages).toBe("55");
        expect(s.eingaben.value.get(sid(1))).toEqual({ seiten: "77" });
        expect(s.schreibend.value.size).toBe(0);
        // Beim nächsten Verlassen des Felds ein neuer Versuch, jetzt gegen den neuen Stand.
        server.beiSchreiben = () => ok;
        await s.feldSchluss();
        expect(server.geschrieben[1]?.body.aenderungen[0]).toMatchObject({ vorher: { pages: "55" }, pages: "77" });
        expect(s.fehler.value.size).toBe(0);
    });

    it("🔴 423, 403, 503 und 400: der Satz des Servers an der Zeile, der Wert bleibt, es wird nicht neu gelesen", async () => {
        for (const [status, code, satz] of [
            [423, "map_editing_off", "Das Bearbeiten der Karte ist ausgeschaltet."],
            [403, "forbidden", "Dafür fehlt das Recht."],
            [503, "map_import_running", "Ein Import läuft."],
            [400, "validation_failed", "Fundstelle zu lang."],
        ] as const) {
            const { s, server } = baue(antwortMit([quelle(1)]));
            await bereit(s);
            await s.aendere(sid(1), { pages: "77" });
            server.beiSchreiben = () => abgelehnt(status, code, satz);
            await s.feldSchluss();
            expect(s.fehler.value.get(sid(1))).toEqual({ art: "satz", satz });
            expect(s.eingaben.value.get(sid(1))).toEqual({ seiten: "77" });
            expect(server.lesungen).toBe(1);
        }
    });

    it("die nächste Handlung an der Zeile räumt den Satz weg", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        server.beiSchreiben = () => abgelehnt(423, "map_editing_off", "Aus.");
        await s.loese(sid(1));
        expect(s.fehler.value.size).toBe(1);
        server.beiSchreiben = () => ok;
        await s.loese(sid(1));
        expect(s.fehler.value.size).toBe(0);
    });

    it("kein Netz: der Satz steht da, nichts geht verloren", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        server.beiSchreiben = () => abgelehnt(0, "network_error", "Keine Verbindung zum Server.");
        await s.aendere(sid(1), { referenceKind: null });
        expect(s.fehler.value.get(sid(1))).toEqual({ art: "satz", satz: "Keine Verbindung zum Server." });
        expect(s.schreibend.value.size).toBe(0);
    });
});

describe("Anhängen", () => {
    const treffer: InhalteQuellenZeile = {
        id: sid(5),
        title: "Neue Quelle",
        sourceType: "abenteuer",
        uses: 3,
        herkunft: "legacy",
        stillgelegt: false,
    };

    it("🔴 hängt an: add mit vorher null, die Suche ist danach leer, die Kennung kommt zurück", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        s.quelleText.value = "neue";
        await new Promise((r) => setTimeout(r, 0));
        server.beiSchreiben = () => {
            server.setzeStand(
                antwortMit([
                    quelle(1),
                    quelle(5, { title: "Neue Quelle", pages: null, note: null, referenceKind: null, wiki: null }),
                ]),
            );
            return ok;
        };
        const id = await s.haengeAn(treffer);
        expect(id).toBe(sid(5));
        expect(server.geschrieben[0]?.body.aenderungen).toEqual([{ op: "add", sourceId: sid(5), vorher: null }]);
        expect(s.quelleText.value).toBe("");
        expect(s.zahl.value).toBe(2);
        expect(s.anhaengenLaeuft.value).toBe(false);
    });

    it("eine gelöste Quelle lässt sich wieder anhängen: vorher ist ihr gelöster Stand", async () => {
        const { s, server } = baue(antwortMit([quelle(5, { state: "retired" })]));
        await bereit(s);
        await s.haengeAn(treffer);
        expect(server.geschrieben[0]?.body.aenderungen[0]).toMatchObject({
            op: "add",
            vorher: { state: "retired" },
        });
    });

    it("🔴 gescheitert: der Satz steht beim Anhängen, die Suche bleibt, es gibt keine Kennung", async () => {
        const { s, server } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        s.quelleText.value = "neue";
        server.beiSchreiben = () => abgelehnt(423, "map_locked", "Gesperrt.");
        expect(await s.haengeAn(treffer)).toBeUndefined();
        expect(s.anhaengenFehler.value).toEqual({ art: "satz", satz: "Gesperrt." });
        expect(s.quelleText.value).toBe("neue");
        expect(s.anhaengenLaeuft.value).toBe(false);
    });
});

describe("Aufräumen", () => {
    it("ein Schreiben, das nach dem Wechsel des Objekts fertig wird, fasst die Anzeige des neuen nicht an", async () => {
        const { s, server, ziel } = baue(antwortMit([quelle(1)]));
        await bereit(s);
        let freigabe: (a: SchreibAntwort<OperationReceipt>) => void = () => undefined;
        server.beiSchreiben = () => new Promise((auf) => (freigabe = auf));
        const lauf = s.loese(sid(1));
        await Promise.resolve();
        await Promise.resolve();
        server.setzeStand(
            antwortMit([quelle(7)], {
                traeger: { kind: "area", id: "00000000-0000-4000-8000-0000000000c3", name: "Wald", aktiv: true },
            }),
        );
        ziel.value = { kind: "area", id: "00000000-0000-4000-8000-0000000000c3" };
        await nextTick();
        await bereit(s);
        freigabe(ok);
        await lauf;
        expect(s.daten.value?.traeger.kind).toBe("area");
        expect(s.fehler.value.size).toBe(0);
        expect(s.schreibend.value.size).toBe(0);
    });
});
