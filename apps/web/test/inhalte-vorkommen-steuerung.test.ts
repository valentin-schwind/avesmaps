import { effectScope, type EffectScope } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type {
    InhalteQuellenAnfrage,
    InhalteVorkommen,
    InhalteVorkommenAendernBody,
    InhalteVorkommenAnlegenBody,
    InhalteVorkommenAnfrage,
    InhalteVorkommenOrt,
    InhalteVorkommenQuelle,
    InhalteVorkommenRegel,
    InhalteVorkommenWikiVorschlag,
    InhalteVorkommenZiel,
    OperationReceipt,
    WikisyncRegelBedingung,
} from "@avesmaps3d/shared";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import type { InhalteClient } from "../src/inhalte/inhalte-client.ts";
import { meldeInhalte } from "../src/inhalte/inhalte-melde.ts";
import { createVorkommenSteuerung, type VorkommenSteuerung } from "../src/inhalte/inhalte-vorkommen-steuerung.ts";

/**
 * Der Reiter „Vorkommen“ im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 3) mit einem falschen Client statt des Servers: der Unterreiter der
 * Liste, Speichern mit Revision und dem Geänderten (Felder, Ortszeilen, Quellen), der Konflikt mit „eigene anwenden“ und die beiden Suchen
 * (Ziele der Ortszeilen, Quellen des Katalogs), dazu die Regeln des Regeleditors (Speichern, Vorschlag übernehmen, ↶, Konflikt) und die Suche nach Flächen. Die Rechnung am Entwurf prüft `inhalte-vorkommen-modell.test.ts`, den Server
 * `apps/server/test/inhalte-vorkommen.test.ts`.
 */
const ort = (n: number, teil: Partial<InhalteVorkommenOrt> = {}): InhalteVorkommenOrt => ({
    rowId: String(n),
    relation: "verbreitung",
    wikiKey: `ort-${String(n)}`,
    name: `Ort ${String(n)}`,
    keyClass: "other",
    targetState: "resolved",
    rolle: "ort",
    treffer: [],
    trefferGesamt: 0,
    state: "active",
    ursprung: "wiki",
    herkunft: "legacy",
    ...teil,
});

const quelle = (n: number, teil: Partial<InhalteVorkommenQuelle> = {}): InhalteVorkommenQuelle => ({
    sourceId: `00000000-0000-4000-8000-00000000050${String(n)}`,
    title: `Quelle ${String(n)}`,
    sourceType: "regionalspielhilfe",
    offiziell: true,
    referenceKind: null,
    pages: null,
    note: null,
    state: "active",
    ursprung: "wiki",
    herkunft: "legacy",
    ...teil,
});

function eintrag(n: number, teil: Partial<InhalteVorkommen> = {}): InhalteVorkommen {
    return {
        id: `00000000-0000-4000-8000-00000000f00${String(n)}`,
        revision: 1,
        wikiKey: `eintrag-${String(n)}`,
        name: `Eintrag ${String(n)}`,
        art: "fauna",
        gruppe: null,
        lebensraum: null,
        synonyme: null,
        editorNote: null,
        ursprung: "wiki",
        herkunft: "legacy",
        aktiv: true,
        feldUrsprung: {},
        orte: [ort(1), ort(2)],
        regeln: [],
        quellen: [quelle(1)],
        ...teil,
    };
}

const regel = (n: number, teil: Partial<InhalteVorkommenRegel> = {}): InhalteVorkommenRegel => ({
    ruleId: String(n),
    relation: "verbreitung",
    ursprung: "wiki",
    state: "active",
    bedingungen: [{ joinOp: "und", arten: [{ ebene: "vegetation", art: "wald" }] }],
    ruleKey: n.toString(16).padStart(64, "0"),
    ...teil,
});

const wb = (teil: Partial<WikisyncRegelBedingung> = {}): WikisyncRegelBedingung => ({
    verknuepfung: "und",
    flaeche: null,
    arten: [{ ebene: "vegetation", art: "steppe" }],
    klima: null,
    woerter: [],
    rueckfragen: [],
    ...teil,
});

const wikiVorschlag = (
    teil: Partial<InhalteVorkommenWikiVorschlag["regeln"][number]> = {},
): InhalteVorkommenWikiVorschlag => ({
    lauf: 4,
    am: null,
    veraltet: false,
    typ: "unvollstaendig",
    vorgewaehlt: false,
    sperre: null,
    original: [],
    regeln: [
        {
            beziehung: "verbreitung",
            status: "geaendert",
            schluessel: "9".repeat(64),
            bedingungen: [wb()],
            teile: [],
            bisherIds: ["1"],
            aktuell: true,
            ...teil,
        },
    ],
});

const quittung = (id: string, revision: number): OperationReceipt => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "test",
    affected: [{ kind: "lore", id, revision }],
    derivedWork: [],
    warnings: [],
});

const ziel = (n: number): Extract<InhalteVorkommenZiel, { kind: string }> => ({
    kind: "place",
    carrierId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    name: `Ziel ${String(n)}`,
    wikiKey: `ziel-${String(n)}`,
});

interface FalscherServer {
    client: InhalteClient;
    eintraege: Map<string, InhalteVorkommen>;
    gesendet: { id: string; body: InhalteVorkommenAendernBody }[];
    angelegt: InhalteVorkommenAnlegenBody[];
    listenAnfragen: InhalteVorkommenAnfrage[];
    zielAnfragen: string[];
    quellenAnfragen: InhalteQuellenAnfrage[];
    flaechenAnfragen: string[];
    orteAnfragen: string[];
    umrissAnfragen: number;
    /** Der Umriss scheitert (404 oder ein Fehler), bis es wieder `false` ist. */
    umrissFehlt: boolean;
    /** Das nächste Speichern gibt 409 `edit_conflict` zurück, bis es wieder `false` ist. */
    konflikt: boolean;
    /** Das nächste Speichern wird mit 400 und diesem Code abgelehnt (etwa `regel_besteht`), bis es wieder `undefined` ist. */
    ablehnung: { code: string; message: string } | undefined;
}

function falscherServer(...liste: InhalteVorkommen[]): FalscherServer {
    const server: FalscherServer = {
        client: undefined as never,
        eintraege: new Map(liste.map((e) => [e.id, e])),
        gesendet: [],
        angelegt: [],
        listenAnfragen: [],
        zielAnfragen: [],
        quellenAnfragen: [],
        flaechenAnfragen: [],
        orteAnfragen: [],
        umrissAnfragen: 0,
        umrissFehlt: false,
        konflikt: false,
        ablehnung: undefined,
    };
    server.client = {
        liste: (anfrage) => {
            server.quellenAnfragen.push(anfrage);
            return Promise.resolve({
                total: 1,
                items: [
                    {
                        id: "00000000-0000-4000-8000-000000000777",
                        title: "Gefundene Quelle",
                        sourceType: "sonstiges",
                        uses: 0,
                        herkunft: "legacy",
                        stillgelegt: false,
                    },
                ],
                zahlen: { aktiv: 1, editor: 0, stillgelegt: 0 },
            });
        },
        quelle: () => Promise.reject(new Error("nicht gebraucht")),
        adresse: () => Promise.reject(new Error("nicht gebraucht")),
        ziele: () => Promise.resolve({ items: [] }),
        anlegen: () => Promise.reject(new Error("nicht gebraucht")),
        aendern: () => Promise.reject(new Error("nicht gebraucht")),
        werke: () => Promise.reject(new Error("nicht gebraucht")),
        werk: () => Promise.reject(new Error("nicht gebraucht")),
        werkAnlegen: () => Promise.reject(new Error("nicht gebraucht")),
        werkAendern: () => Promise.reject(new Error("nicht gebraucht")),
        korpora: () => Promise.reject(new Error("nicht gebraucht")),
        korpus: () => Promise.reject(new Error("nicht gebraucht")),
        korpusAnlegen: () => Promise.reject(new Error("nicht gebraucht")),
        korpusWirkung: () => Promise.reject(new Error("nicht gebraucht")),
        korpusAendern: () => Promise.reject(new Error("nicht gebraucht")),
        vorkommen: (anfrage) => {
            server.listenAnfragen.push(anfrage);
            const alle = [...server.eintraege.values()].filter(
                (e) => anfrage.art === undefined || e.art === anfrage.art,
            );
            return Promise.resolve({
                total: alle.length,
                items: alle.map((e) => ({
                    id: e.id,
                    title: e.name,
                    art: e.art,
                    verknuepfungen: e.orte.filter((o) => o.state === "active").length,
                    herkunft: e.herkunft,
                    stillgelegt: !e.aktiv,
                })),
                zahlen: { aktiv: server.eintraege.size, editor: 0, stillgelegt: 0 },
            });
        },
        vorkommenEintrag: (id) => {
            const e = server.eintraege.get(id);
            return e === undefined ? Promise.reject(new Error("fehlt")) : Promise.resolve(structuredClone(e));
        },
        vorkommenZiele: (text) => {
            server.zielAnfragen.push(text);
            return Promise.resolve({ items: [ziel(1)] });
        },
        vorkommenFlaechen: (text) => {
            server.flaechenAnfragen.push(text);
            return Promise.resolve({
                items: [
                    {
                        kennung: "0190c0a0-0000-7000-8000-00000000a001",
                        name: "Aranien",
                        ebene: "derographisch",
                        art: "region",
                    },
                ],
            });
        },
        vorkommenOrte: (text) => {
            server.orteAnfragen.push(text);
            return Promise.resolve({
                items: [
                    {
                        kennung: "0190c0a0-0000-7000-8000-00000000b001",
                        name: "Gareth",
                        art: "metropole",
                        x: 400,
                        y: 700,
                    },
                ],
            });
        },
        vorkommenUmriss: () => {
            server.umrissAnfragen += 1;
            return server.umrissFehlt
                ? Promise.reject(new Error("404"))
                : Promise.resolve({ pfad: "M0 0L10 0L10 -10Z", rahmen: { x0: 0, x1: 10, y0: 0, y1: 10 } });
        },
        vorkommenAnlegen: (body) => {
            server.angelegt.push(body);
            const neu = eintrag(9, {
                id: "00000000-0000-4000-8000-00000000f009",
                wikiKey: null,
                name: body.name,
                art: body.art,
                orte: [],
                quellen: [],
                ursprung: "manual",
                herkunft: "editor",
            });
            server.eintraege.set(neu.id, neu);
            return Promise.resolve({ ok: true, status: 200, quittung: { ...quittung(neu.id, 1), publicId: neu.id } });
        },
        vorkommenAendern: (id, body): Promise<SchreibAntwort<OperationReceipt>> => {
            server.gesendet.push({ id, body });
            const e = server.eintraege.get(id)!;
            if (server.ablehnung !== undefined) {
                return Promise.resolve({ ok: false, status: 400, fehler: server.ablehnung });
            }
            if (server.konflikt || body.baseRevision !== e.revision) {
                return Promise.resolve({
                    ok: false,
                    status: 409,
                    fehler: {
                        code: "edit_conflict",
                        message: "Veraltet.",
                        details: {
                            currentRevision: e.revision,
                            changedBy: { displayName: "Anna" },
                            changedAt: "2026-10-26T08:00:00Z",
                        },
                    },
                });
            }
            e.revision += 1;
            if (body.fields?.name !== undefined) e.name = body.fields.name;
            return Promise.resolve({ ok: true, status: 200, quittung: quittung(id, e.revision) });
        },
        regelTextPruefen: () => Promise.reject(new Error("nicht gebraucht")),
        regelTextUebernehmen: () => Promise.reject(new Error("nicht gebraucht")),
        vorkommenAlsText: () => Promise.reject(new Error("nicht gebraucht")),
    };
    return server;
}

let scope: EffectScope | undefined;
function baue(server: FalscherServer): VorkommenSteuerung {
    scope = effectScope();
    return scope.run(() =>
        createVorkommenSteuerung({
            client: server.client,
            entprellMs: 0,
            neueOperationId: () => "00000000-0000-4000-8000-000000000002",
        }),
    )!;
}
afterEach(() => {
    scope?.stop();
    scope = undefined;
});

const warte = async (bedingung: () => boolean, grund: string): Promise<void> => {
    for (let i = 0; i < 100; i += 1) {
        if (bedingung()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`nicht eingetreten: ${grund}`);
};

async function waehleErsten(s: VorkommenSteuerung, n = 1): Promise<void> {
    s.ladeListeNeu();
    await warte(() => s.liste.value !== undefined, "Liste");
    s.waehle(eintrag(n).id);
    await warte(() => s.eintrag.value?.id === eintrag(n).id, `Eintrag ${String(n)}`);
}

describe("Unterreiter", () => {
    it("🔴 ein Wechsel des Unterreiters lädt die Liste mit der Art neu; „Alle“ fragt ohne Art", async () => {
        const server = falscherServer(eintrag(1), eintrag(2, { art: "flora" }));
        const s = baue(server);
        s.ladeListeNeu();
        await warte(() => s.liste.value?.items.length === 2, "alle");
        expect(server.listenAnfragen.at(-1)?.art).toBeUndefined();
        s.unter.value = "flora";
        await warte(() => s.liste.value?.items.length === 1, "nur Flora");
        expect(server.listenAnfragen.at(-1)?.art).toBe("flora");
        expect(s.zeilen.value[0]?.title).toBe("Eintrag 2");
        s.unter.value = "alle";
        await warte(() => s.liste.value?.items.length === 2, "wieder alle");
        expect(server.listenAnfragen.at(-1)?.art).toBeUndefined();
    });
});

describe("Auswahl", () => {
    it("🔴 ein Entwurf mit Änderungen wandert nie auf einen anderen Eintrag: erst die Frage, dann Wechsel oder Bleiben", async () => {
        const server = falscherServer(eintrag(1), eintrag(2));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("gruppe", "Fisch");
        expect(s.geaendert.value).toBe(true);
        s.waehle(eintrag(2).id);
        expect(s.wechselWunsch.value).toBe(eintrag(2).id);
        expect(s.gewaehlt.value).toBe(eintrag(1).id);
        s.bleibe();
        expect(s.stand.value?.felder.gruppe).toBe("Fisch");
        s.waehle(eintrag(2).id);
        s.bestaetigeWechsel();
        await warte(() => s.eintrag.value?.id === eintrag(2).id, "Eintrag 2");
        expect(s.geaendert.value).toBe(false);
        expect(s.stand.value?.felder.gruppe).toBe("");
    });
});

describe("Speichern", () => {
    it("schickt die Revision des gesehenen Stands mit Feldern, Ortszeilen und Quellen; danach steht der neue Stand da", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("name", "Aal");
        s.haengeZielAn(ziel(3), "herkunft");
        s.loeseOrt("2");
        s.haengeQuelleAn({ sourceId: "00000000-0000-4000-8000-000000000777", title: "Gefundene Quelle" });
        s.aendereQuelleAngaben(quelle(1).sourceId, { pages: "129" });
        expect(s.anzahl.value).toBe(5);
        await s.speichern();
        expect(server.gesendet).toHaveLength(1);
        expect(server.gesendet[0]!.body).toMatchObject({
            baseRevision: 1,
            fields: { name: "Aal" },
            orte: [
                { op: "remove", rowId: "2" },
                { op: "add", kind: "place", carrierId: ziel(3).carrierId, relation: "herkunft" },
            ],
            quellen: [
                { op: "update", sourceId: quelle(1).sourceId, pages: "129" },
                { op: "add", sourceId: "00000000-0000-4000-8000-000000000777" },
            ],
        });
        await warte(() => s.zustand.value.art === "gespeichert", "gespeichert");
        expect(s.eintrag.value?.revision).toBe(2);
        expect(s.geaendert.value).toBe(false);
    });

    it("🔴 „↺ Wiki-Wert“ setzt Art, Fundstelle und Notiz des Zitats in den ENTWURF (ein Schritt, ↶ nimmt ihn zurück); geschrieben wird erst mit Speichern", async () => {
        const server = falscherServer(
            eintrag(1, {
                quellen: [quelle(1, { referenceKind: "erwaehnung", pages: "1", note: "alt" })],
                quellenWiki: { laufId: 5, dumpStand: null, beendetAm: null },
            }),
        );
        const s = baue(server);
        await waehleErsten(s);
        const id = quelle(1).sourceId;
        // Tippen in der Fundstelle und danach „Wiki-Wert“ sind zwei Schritte: Das ↺ verschmilzt nicht mit dem Tippen.
        s.aendereQuelleAngaben(id, { pages: "12" });
        s.stelleQuelleWikiHer(id, { referenceKind: "ausfuehrlich", pages: "88", note: "{{R5}} Zoo" });
        expect(s.stand.value?.quellen[0]).toMatchObject({
            referenceKind: "ausfuehrlich",
            pages: "88",
            note: "{{R5}} Zoo",
        });
        expect(server.gesendet).toHaveLength(0);
        s.zurueck();
        expect(s.stand.value?.quellen[0]).toMatchObject({ referenceKind: "erwaehnung", pages: "12", note: "alt" });
        s.wieder();
        await s.speichern();
        expect(server.gesendet[0]!.body).toMatchObject({
            quellen: [{ op: "update", sourceId: id, referenceKind: "ausfuehrlich", pages: "88", note: "{{R5}} Zoo" }],
        });
    });

    it("ein leerer Name geht nicht zum Server", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("name", "   ");
        await s.speichern();
        expect(server.gesendet).toHaveLength(0);
        expect(s.zustand.value).toMatchObject({ art: "abgelehnt", code: "titel_leer" });
    });

    it("🔴 409: der Entwurf bleibt; „eigene anwenden“ legt Ortszeilen und Quellen auf den fremden Stand", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        await waehleErsten(s);
        s.haengeZielAn(ziel(3), "verbreitung");
        s.loeseOrt("1");
        s.haengeQuelleAn({
            sourceId: "00000000-0000-4000-8000-000000000777",
            title: "Gefundene Quelle",
            sourceType: "roman",
            url: "https://a.example/q",
        });
        // Die andere Seite hat inzwischen den Namen geändert und eine Ortszeile gelöst.
        const fremd = server.eintraege.get(eintrag(1).id)!;
        fremd.revision = 2;
        fremd.name = "Fremder Name";
        fremd.orte = [ort(1), ort(2, { state: "suppressed" })];
        await s.speichern();
        await warte(() => s.zustand.value.art === "konflikt", "Konflikt");
        const z = s.zustand.value;
        if (z.art !== "konflikt") throw new Error("kein Konflikt");
        expect(z.wer).toBe("Anna");
        // Die Überschneidung nennt Zeile 1 nicht: Nur der Entwurf hat sie angefasst.
        expect(z.beide).toEqual([]);
        expect(s.stand.value?.orte.some((o) => o.neu)).toBe(true);
        await s.eigeneAnwenden();
        expect(s.zustand.value.art).toBe("bereit");
        expect(s.eintrag.value?.revision).toBe(2);
        expect(s.stand.value?.felder.name).toBe("Fremder Name");
        // Die eigenen Änderungen liegen auf dem fremden Stand: Zeile 1 gelöst, das neue Ziel und die Quelle angehängt.
        expect(s.stand.value?.orte.find((o) => o.rowId === "1")?.state).toBe("suppressed");
        expect(s.stand.value?.orte.some((o) => o.neu && o.wikiKey === "ziel-3")).toBe(true);
        expect(s.stand.value?.quellen.some((q) => q.neu)).toBe(true);
        // Typ und Adresse der angehängten Quelle überleben das Übertragen; „offiziell“ weiß erst der Server.
        expect(s.stand.value?.quellen.find((q) => q.neu)).toMatchObject({
            sourceType: "roman",
            url: "https://a.example/q",
            offiziell: null,
        });
        expect(s.anzahl.value).toBe(3);
        await s.speichern();
        expect(server.gesendet.at(-1)?.body.baseRevision).toBe(2);
        await warte(() => s.zustand.value.art === "gespeichert", "gespeichert");
    });

    it("„fremden Stand übernehmen“ verwirft den Entwurf", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("name", "Mein Name");
        server.konflikt = true;
        await s.speichern();
        await warte(() => s.zustand.value.art === "konflikt", "Konflikt");
        await s.fremdenUebernehmen();
        expect(s.zustand.value.art).toBe("bereit");
        expect(s.geaendert.value).toBe(false);
        expect(s.stand.value?.felder.name).toBe("Eintrag 1");
    });
});

describe("Regeln (Regeleditor)", () => {
    it("🔴 eine neue Regel wirkt im Entwurf und geht erst mit „Speichern“ als regeln-add hinaus; danach steht der neue Stand da", async () => {
        const server = falscherServer(eintrag(1, { regeln: [regel(1), regel(2, { relation: "herkunft" })] }));
        const s = baue(server);
        await waehleErsten(s);
        expect(s.stand.value?.regeln).toHaveLength(2);
        s.uebernimmRegel({ relation: "regionen", bedingungen: [wb()] });
        expect(s.anzahl.value).toBe(1);
        expect(s.geaendert.value).toBe(true);
        expect(server.gesendet).toEqual([]);
        await s.speichern();
        expect(server.gesendet).toHaveLength(1);
        expect(server.gesendet[0]!.body).toMatchObject({
            baseRevision: 1,
            regeln: [
                {
                    op: "add",
                    relation: "regionen",
                    bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "vegetation", art: "steppe" }] }],
                },
            ],
        });
        expect(server.gesendet[0]!.body).not.toHaveProperty("fields");
        await warte(() => s.zustand.value.art === "gespeichert", "gespeichert");
        expect(s.geaendert.value).toBe(false);
    });

    it("eine Änderung, die nichts ändert, ist kein Schritt: ↶ bleibt gesperrt", async () => {
        const server = falscherServer(eintrag(1, { regeln: [regel(1)] }));
        const s = baue(server);
        await waehleErsten(s);
        s.uebernimmRegel({
            schluessel: "1",
            relation: "verbreitung",
            bedingungen: [wb({ arten: [{ ebene: "vegetation", art: "wald" }] })],
        });
        expect(s.kannZurueck.value).toBe(false);
        expect(s.anzahl.value).toBe(0);
        s.loescheRegel("99");
        expect(s.kannZurueck.value).toBe(false);
    });

    it("🔴 ↶ nimmt die geänderte Regel zurück, ↷ holt sie wieder; Verwerfen räumt alles ab", async () => {
        const server = falscherServer(eintrag(1, { regeln: [regel(1)] }));
        const s = baue(server);
        await waehleErsten(s);
        s.uebernimmRegel({ schluessel: "1", relation: "verbreitung", bedingungen: [wb()] });
        expect(s.stand.value?.regeln[0]).toMatchObject({ neu: true, ursprung: "manual", ersetzt: { ruleId: "1" } });
        s.zurueck();
        expect(s.stand.value?.regeln[0]).toMatchObject({ neu: false, ruleId: "1" });
        expect(s.geaendert.value).toBe(false);
        s.wieder();
        expect(s.stand.value?.regeln[0]?.neu).toBe(true);
        s.verwerfen();
        expect(s.stand.value?.regeln[0]).toMatchObject({ neu: false, ruleId: "1" });
        expect(s.anzahl.value).toBe(0);
    });

    it("🔴 ein Vorschlag des Wikis wird erst mit „Speichern“ eine Regel, ersetzt die bisherige und lässt den Eintrag selbst unberührt", async () => {
        const server = falscherServer(eintrag(1, { regeln: [regel(1)], wikiVorschlag: wikiVorschlag() }));
        const s = baue(server);
        await waehleErsten(s);
        s.uebernimmVorschlag(0);
        await s.speichern();
        const body = server.gesendet[0]!.body;
        expect(body.regeln).toEqual([
            {
                op: "add",
                relation: "verbreitung",
                bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "vegetation", art: "steppe" }] }],
                ersetzt: "1",
            },
        ]);
        // R6: Eine Regeländerung macht den Eintrag nicht zu einem der Redaktion; nichts davon im Körper.
        expect(body).not.toHaveProperty("fields");
        expect(body).not.toHaveProperty("orte");
    });

    it("eine Regel löschen geht als remove hinaus; ↺ Wiki-Fassung holt die Fassung, auf der eine Regel von Hand beruht", async () => {
        const basis = { schluessel: "7".repeat(64), bedingungen: [wb()] };
        const server = falscherServer(
            eintrag(1, {
                regeln: [regel(1), regel(5, { ursprung: "manual", relation: "herkunft", wikiBasis: basis })],
            }),
        );
        const s = baue(server);
        await waehleErsten(s);
        s.loescheRegel("1");
        s.stelleRegelWikiHer("5");
        await s.speichern();
        expect(server.gesendet[0]!.body.regeln).toEqual([
            { op: "remove", ruleId: "1" },
            {
                op: "add",
                relation: "herkunft",
                bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "vegetation", art: "steppe" }] }],
                ersetzt: "5",
            },
        ]);
    });

    it("🔴 409: „eigene anwenden“ legt die Regeländerung auf den fremden Stand; die Überschneidung nennt nur, was beide trafen", async () => {
        const server = falscherServer(eintrag(1, { regeln: [regel(1), regel(2, { relation: "herkunft" })] }));
        const s = baue(server);
        await waehleErsten(s);
        s.uebernimmRegel({ schluessel: "1", relation: "verbreitung", bedingungen: [wb()] });
        s.uebernimmRegel({ relation: "regionen", bedingungen: [wb({ klima: { von: "polar", bis: "polar" } })] });
        // Die andere Seite hat inzwischen Regel 2 stillgelegt und den Namen geändert.
        const fremd = server.eintraege.get(eintrag(1).id)!;
        fremd.revision = 2;
        fremd.name = "Fremder Name";
        fremd.regeln = [regel(1), regel(2, { relation: "herkunft", state: "suppressed" })];
        await s.speichern();
        await warte(() => s.zustand.value.art === "konflikt", "Konflikt");
        const z = s.zustand.value;
        if (z.art !== "konflikt") throw new Error("kein Konflikt");
        // Der Entwurf hat nur Regel 1 angefasst und eine neue angelegt; die andere Seite nur Regel 2.
        expect(z.eigene).toContain("regel:1");
        expect(z.fremde).toEqual(["name", "regel:2"]);
        expect(z.beide).toEqual([]);
        await s.eigeneAnwenden();
        expect(s.zustand.value.art).toBe("bereit");
        expect(s.eintrag.value?.revision).toBe(2);
        const regeln = s.stand.value?.regeln ?? [];
        expect(regeln.find((r) => r.ruleId === "2")?.state).toBe("suppressed");
        expect(regeln.find((r) => r.neu && r.ersetzt?.ruleId === "1")).toBeDefined();
        expect(regeln.find((r) => r.neu && r.relation === "regionen")).toBeDefined();
        expect(s.anzahl.value).toBe(2);
        await s.speichern();
        expect(server.gesendet.at(-1)?.body.baseRevision).toBe(2);
        expect(server.gesendet.at(-1)?.body.regeln).toHaveLength(2);
    });

    it("beide Seiten haben dieselbe Regel getroffen: Das ist eine Überschneidung", async () => {
        const server = falscherServer(eintrag(1, { regeln: [regel(1)] }));
        const s = baue(server);
        await waehleErsten(s);
        s.loescheRegel("1");
        const fremd = server.eintraege.get(eintrag(1).id)!;
        fremd.revision = 2;
        fremd.regeln = [regel(1, { state: "suppressed" })];
        await s.speichern();
        await warte(() => s.zustand.value.art === "konflikt", "Konflikt");
        const z = s.zustand.value;
        if (z.art !== "konflikt") throw new Error("kein Konflikt");
        expect(z.beide).toEqual(["regel:1"]);
    });

    it("🔴 400 `regel_besteht`: Gespeichert wurde nichts, der Entwurf bleibt, die Ablehnung trägt den Code (die Oberfläche sagt es verständlich); die nächste Änderung räumt sie ab", async () => {
        const server = falscherServer(eintrag(1, { regeln: [regel(1)] }));
        const s = baue(server);
        await waehleErsten(s);
        s.uebernimmRegel({ relation: "herkunft", bedingungen: [wb()] });
        server.ablehnung = { code: "regel_besteht", message: "Rule exists." };
        await s.speichern();
        expect(s.zustand.value).toMatchObject({ art: "abgelehnt", code: "regel_besteht" });
        expect(s.geaendert.value).toBe(true);
        expect(s.stand.value?.regeln.some((r) => r.neu)).toBe(true);
        // Ablehnung ist kein Konflikt: Der Entwurf wird nicht angefasst, und eine weitere Änderung räumt den Hinweis ab.
        s.loescheRegel("1");
        expect(s.zustand.value.art).toBe("bereit");
        server.ablehnung = undefined;
        await s.speichern();
        await warte(() => s.zustand.value.art === "gespeichert", "gespeichert");
        expect(server.gesendet.at(-1)?.body.regeln?.map((r) => r.op)).toEqual(["remove", "add"]);
    });

    it("die Suche nach Flächen fragt ab zwei Zeichen und nimmt die Treffer in die Liste; leeren räumt auf", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        s.flaechenText.value = "A";
        await new Promise((r) => setTimeout(r, 20));
        expect(server.flaechenAnfragen).toEqual([]);
        s.flaechenText.value = "Aranien";
        await warte(() => s.flaechenTreffer.value.length === 1, "Flächen");
        expect(server.flaechenAnfragen).toEqual(["Aranien"]);
        expect(s.flaechenTreffer.value[0]).toMatchObject({ name: "Aranien", ebene: "derographisch" });
        s.leereFlaechen();
        expect(s.flaechenText.value).toBe("");
        expect(s.flaechenTreffer.value).toEqual([]);
    });
});

describe("Lage zu einer Linie: Orte und Umriss", () => {
    it("🔴 die Suche nach Orten fragt schon ohne Text (dann stehen Metropolen und Großstädte da), getippt entprellt; leeren räumt auf", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        // Das Feld bekommt den Fokus, ohne dass jemand tippt: Die Liste soll nicht leer bleiben.
        s.sucheOrte("");
        await warte(() => s.orteTreffer.value.length === 1, "Orte ohne Text");
        expect(server.orteAnfragen).toEqual([""]);
        expect(s.orteTreffer.value[0]).toMatchObject({ name: "Gareth", art: "metropole" });
        // Dieselbe Frage noch einmal (Fokus verloren und wieder da): nichts Neues, die Treffer stehen schon.
        s.sucheOrte("");
        await new Promise((r) => setTimeout(r, 20));
        expect(server.orteAnfragen).toEqual([""]);
        s.sucheOrte("Gar");
        await warte(() => server.orteAnfragen.length === 2, "getippt");
        expect(server.orteAnfragen).toEqual(["", "Gar"]);
        s.leereOrte();
        expect(s.orteTreffer.value).toEqual([]);
    });

    it("🔴 der Umriss wird EINMAL geholt, auch wenn mehrere Felder ihn wollen; fehlt er, bleibt das Feld ohne Skizze, und ein späterer Aufruf versucht es neu", async () => {
        const server = falscherServer(eintrag(1));
        server.umrissFehlt = true;
        const s = baue(server);
        s.ladeUmriss();
        s.ladeUmriss();
        await warte(() => server.umrissAnfragen >= 1, "erste Anfrage");
        await new Promise((r) => setTimeout(r, 20));
        expect(server.umrissAnfragen).toBe(1);
        expect(s.umriss.value).toBeUndefined();
        server.umrissFehlt = false;
        s.ladeUmriss();
        await warte(() => s.umriss.value !== undefined, "Umriss");
        expect(s.umriss.value?.rahmen).toEqual({ x0: 0, x1: 10, y0: 0, y1: 10 });
        s.ladeUmriss();
        await new Promise((r) => setTimeout(r, 20));
        expect(server.umrissAnfragen).toBe(2);
    });

    it("🔴 lehnt der Server eine Lage ab (stiller Ort), steht sein Satz da und der Entwurf bleibt", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        await waehleErsten(s);
        s.uebernimmRegel({
            relation: "verbreitung",
            bedingungen: [
                wb({
                    arten: [],
                    lage: {
                        richtung: "sued",
                        orte: [{ kennung: "0190c0a0-0000-7000-8000-00000000b001", name: "Gareth", x: 400, y: 700 }],
                    },
                }),
            ],
        });
        server.ablehnung = { code: "validation_failed", message: "Dieser Ort ist still gelegt." };
        await s.speichern();
        expect(s.zustand.value).toMatchObject({
            art: "abgelehnt",
            code: "validation_failed",
            satz: "Dieser Ort ist still gelegt.",
        });
        expect(s.geaendert.value).toBe(true);
        // Gesendet wurde die Lage mit den Kennungen der Orte.
        expect(server.gesendet.at(-1)?.body.regeln?.[0]).toMatchObject({
            op: "add",
            bedingungen: [{ lage: { richtung: "sued", orte: ["0190c0a0-0000-7000-8000-00000000b001"] } }],
        });
    });
});

describe("Anlegen und ungeklärter Name (Vali wählte B am Gate)", () => {
    it("legt einen Eintrag ohne Wiki-Artikel an, lädt die Liste neu und wählt ihn; der Name geht ohne Leerraum, die Art mit", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        s.ladeListeNeu();
        await warte(() => s.liste.value !== undefined, "Liste");
        s.oeffneAnlegen();
        expect(s.anlegen.value.art).toBe("offen");
        await s.legeAn("  Moosbart ", "flora");
        expect(server.angelegt).toHaveLength(1);
        expect(server.angelegt[0]).toMatchObject({ name: "Moosbart", art: "flora" });
        await warte(() => s.eintrag.value?.id === "00000000-0000-4000-8000-00000000f009", "neuer Eintrag gewählt");
        expect(s.eintrag.value?.wikiKey).toBeNull();
        expect(s.anlegen.value.art).toBe("aus");
        expect(s.zeilen.value.map((z) => z.title)).toContain("Moosbart");
    });

    it("🔴 ein ungeklärter Name geht als Ziel mit dem Namen zum Server, neben einem Kartenobjekt; nach „eigene anwenden“ bleibt er angehängt", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        await waehleErsten(s);
        s.haengeNamenAn("Ein Dorf im Norden", "herkunft");
        s.haengeZielAn(ziel(3), "verbreitung");
        expect(s.anzahl.value).toBe(2);
        // Die andere Seite war schneller (anderer Name): „eigene anwenden“ legt beide Ortszeilen auf den fremden Stand.
        const fremd = server.eintraege.get(eintrag(1).id)!;
        fremd.revision = 2;
        fremd.name = "Fremder Name";
        await s.speichern();
        await warte(() => s.zustand.value.art === "konflikt", "Konflikt");
        await s.eigeneAnwenden();
        expect(s.stand.value?.orte.some((o) => o.neu && o.wikiKey === null && o.name === "Ein Dorf im Norden")).toBe(
            true,
        );
        expect(s.stand.value?.orte.some((o) => o.neu && o.wikiKey === "ziel-3")).toBe(true);
        await s.speichern();
        expect(server.gesendet.at(-1)?.body.orte).toEqual([
            { op: "add", name: "Ein Dorf im Norden", relation: "herkunft" },
            { op: "add", kind: "place", carrierId: ziel(3).carrierId, relation: "verbreitung" },
        ]);
    });
});

describe("Suchen", () => {
    it("die Zielsuche fragt ab zwei Zeichen und nimmt die Vorschläge in die Liste; leeren räumt auf", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        s.zielText.value = "G";
        await new Promise((r) => setTimeout(r, 20));
        expect(server.zielAnfragen).toEqual([]);
        s.zielText.value = "Gareth";
        await warte(() => s.zielTreffer.value.length === 1, "Ziele");
        expect(server.zielAnfragen).toEqual(["Gareth"]);
        s.leereZiele();
        expect(s.zielText.value).toBe("");
        expect(s.zielTreffer.value).toEqual([]);
    });

    it("die Quellensuche fragt den Katalog der Quellen (aktive, nach Titel, höchstens acht)", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        s.quelleText.value = "Hesinde";
        await warte(() => s.quelleTreffer.value.length === 1, "Quellen");
        expect(server.quellenAnfragen[0]).toMatchObject({ q: "Hesinde", limit: 8, sort: "title", stand: "aktiv" });
        s.leereQuellen();
        expect(s.quelleTreffer.value).toEqual([]);
    });
});

describe("Zurückgenommen aus „Änderungen“ (WI-0265 B6g2)", () => {
    /** Zählt, wie oft der Reiter Liste und Eintrag liest. */
    function zaehle(server: FalscherServer): { liste: number; eintrag: number } {
        const gelesen = { liste: 0, eintrag: 0 };
        const liste = server.client.vorkommen.bind(server.client);
        const eines = server.client.vorkommenEintrag.bind(server.client);
        server.client.vorkommen = (...argumente) => {
            gelesen.liste += 1;
            return liste(...argumente);
        };
        server.client.vorkommenEintrag = (...argumente) => {
            gelesen.eintrag += 1;
            return eines(...argumente);
        };
        return gelesen;
    }

    it("🔴 liest die Liste und den gewählten Eintrag neu, wenn die Rücknahme ihn berührte (auch ein Eintrag aus „Regeln als Text“, der nur mit anderen berührt wurde); eine andere Art oder ein anderer Eintrag lässt den Eintrag in Ruhe", async () => {
        const server = falscherServer(eintrag(1), eintrag(2));
        const s = baue(server);
        await waehleErsten(s);
        const gelesen = zaehle(server);

        meldeInhalte([{ kind: "work", id: eintrag(1).id }]);
        await new Promise((r) => setTimeout(r, 30));
        expect(gelesen).toEqual({ liste: 0, eintrag: 0 });
        // Ein anderer Eintrag (die Übernahme von „Regeln als Text“ berührte mehrere): nur die Liste liest neu.
        meldeInhalte([{ kind: "lore", id: eintrag(2).id }]);
        await warte(() => gelesen.liste === 1, "Liste neu");
        expect(gelesen.eintrag).toBe(0);

        // Der gewählte Eintrag: Liste UND Eintrag lesen neu, der neue Stand steht da.
        const e = server.eintraege.get(eintrag(1).id)!;
        e.name = "Zurückgenommen";
        e.revision += 1;
        meldeInhalte([
            { kind: "lore", id: eintrag(2).id },
            { kind: "lore", id: eintrag(1).id },
        ]);
        await warte(() => s.eintrag.value?.revision === 2, "Eintrag neu gelesen");
        expect(s.eintrag.value?.name).toBe("Zurückgenommen");
        expect(gelesen.eintrag).toBe(1);
        expect(s.geaendert.value).toBe(false);
    });

    it("🔴 ein Entwurf mit Änderungen bleibt, wie er ist: der Eintrag wird nicht ersetzt, das nächste Speichern ist ein gewöhnlicher Konflikt", async () => {
        const server = falscherServer(eintrag(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("gruppe", "Meine Änderung");
        const gelesen = zaehle(server);

        const e = server.eintraege.get(eintrag(1).id)!;
        e.revision += 1;
        meldeInhalte([{ kind: "lore", id: eintrag(1).id }]);
        await new Promise((r) => setTimeout(r, 30));
        expect(gelesen.eintrag).toBe(0);
        expect(s.eintrag.value?.revision).toBe(1);
        expect(s.stand.value?.felder.gruppe).toBe("Meine Änderung");
        await s.speichern();
        expect(s.zustand.value.art).toBe("konflikt");
    });
});
