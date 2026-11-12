import { effectScope, type EffectScope } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type {
    InhalteWerk,
    InhalteWerkAendernBody,
    InhalteWerkListe,
    InhalteWerkOrt,
    OperationReceipt,
} from "@avesmaps3d/shared";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import type { InhalteClient } from "../src/inhalte/inhalte-client.ts";
import { meldeInhalte } from "../src/inhalte/inhalte-melde.ts";
import { createLiteraturSteuerung, type LiteraturSteuerung } from "../src/inhalte/inhalte-literatur-steuerung.ts";

/**
 * Der gemeinsame Kern der Reiter des Fensters „Inhalte bearbeiten“ (WI-0254) am Beispiel der Literatur: Auswahl mit der Frage bei
 * ungespeicherten Änderungen, Speichern mit Revision, der Konflikt (409) mit „eigene anwenden“ und „fremden übernehmen“, Anlegen.
 * Ein falscher Client ersetzt den Server; die Rechnung am Entwurf prüft `inhalte-literatur-modell.test.ts`.
 */
const ort = (n: number, teil: Partial<InhalteWerkOrt> = {}): InhalteWerkOrt => ({
    rowId: String(n),
    role: "play",
    targetState: "resolved",
    kind: "place",
    carrierId: `00000000-0000-4000-8000-00000000000${String(n)}`,
    name: `Ort ${String(n)}`,
    state: "active",
    ursprung: "legacy",
    herkunft: "legacy",
    ...teil,
});

function werk(n: number, teil: Partial<InhalteWerk> = {}): InhalteWerk {
    return {
        id: `00000000-0000-4000-8000-00000000f00${String(n)}`,
        revision: 1,
        title: `Werk ${String(n)}`,
        productType: "gruppenabenteuer",
        edition: "DSA5",
        series: null,
        bfYear: 1040,
        bfLabel: null,
        genre: null,
        isOfficial: true,
        editorNote: null,
        ursprung: "legacy",
        herkunft: "legacy",
        aktiv: true,
        feldUrsprung: {},
        cover: { gebunden: false },
        orte: [ort(1), ort(2)],
        ...teil,
    };
}

const quittung = (id: string, revision: number): OperationReceipt => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "test",
    affected: [{ kind: "work", id, revision }],
    derivedWork: [],
    warnings: [],
});

interface FalscherServer {
    client: InhalteClient;
    werke: Map<string, InhalteWerk>;
    gesendet: { id: string; body: InhalteWerkAendernBody }[];
    /** Das nächste Speichern gibt diesen Fehler zurück (409 `edit_conflict`), bis es wieder `undefined` ist. */
    konflikt: { rowId?: string } | undefined;
}

function falscherServer(...liste: InhalteWerk[]): FalscherServer {
    const server: FalscherServer = {
        client: undefined as never,
        werke: new Map(liste.map((w) => [w.id, w])),
        gesendet: [],
        konflikt: undefined,
    };
    const zeilen = (): InhalteWerkListe => ({
        total: server.werke.size,
        items: [...server.werke.values()].map((w) => ({
            id: w.id,
            title: w.title,
            productType: w.productType,
            orte: w.orte.filter((o) => o.state === "active").length,
            herkunft: w.herkunft,
            stillgelegt: !w.aktiv,
        })),
        zahlen: { aktiv: server.werke.size, editor: 0, stillgelegt: 0 },
    });
    server.client = {
        liste: () => Promise.reject(new Error("nicht gebraucht")),
        quelle: () => Promise.reject(new Error("nicht gebraucht")),
        adresse: () => Promise.reject(new Error("nicht gebraucht")),
        ziele: () => Promise.resolve({ items: [] }),
        anlegen: () => Promise.reject(new Error("nicht gebraucht")),
        aendern: () => Promise.reject(new Error("nicht gebraucht")),
        werke: () => Promise.resolve(zeilen()),
        werk: (id) => {
            const w = server.werke.get(id);
            return w === undefined ? Promise.reject(new Error("fehlt")) : Promise.resolve(structuredClone(w));
        },
        werkAnlegen: (body) => {
            const neu = werk(9, {
                id: "00000000-0000-4000-8000-00000000f009",
                title: body.title,
                productType: body.productType,
                orte: [],
            });
            server.werke.set(neu.id, neu);
            return Promise.resolve({ ok: true, status: 200, quittung: { ...quittung(neu.id, 1), publicId: neu.id } });
        },
        vorkommen: () => Promise.reject(new Error("nicht gebraucht")),
        vorkommenEintrag: () => Promise.reject(new Error("nicht gebraucht")),
        vorkommenZiele: () => Promise.resolve({ items: [] }),
        vorkommenFlaechen: () => Promise.resolve({ items: [] }),
        vorkommenOrte: () => Promise.resolve({ items: [] }),
        vorkommenUmriss: () => Promise.reject(new Error("nicht gebraucht")),
        vorkommenAnlegen: () => Promise.reject(new Error("nicht gebraucht")),
        vorkommenAendern: () => Promise.reject(new Error("nicht gebraucht")),
        regelTextPruefen: () => Promise.reject(new Error("nicht gebraucht")),
        regelTextUebernehmen: () => Promise.reject(new Error("nicht gebraucht")),
        vorkommenAlsText: () => Promise.reject(new Error("nicht gebraucht")),
        korpora: () => Promise.reject(new Error("nicht gebraucht")),
        korpus: () => Promise.reject(new Error("nicht gebraucht")),
        korpusAnlegen: () => Promise.reject(new Error("nicht gebraucht")),
        korpusWirkung: () => Promise.reject(new Error("nicht gebraucht")),
        korpusAendern: () => Promise.reject(new Error("nicht gebraucht")),
        werkAendern: (id, body): Promise<SchreibAntwort<OperationReceipt>> => {
            server.gesendet.push({ id, body });
            const w = server.werke.get(id)!;
            if (server.konflikt !== undefined || body.baseRevision !== w.revision) {
                return Promise.resolve({
                    ok: false,
                    status: 409,
                    fehler: {
                        code: "edit_conflict",
                        message: "Veraltet.",
                        details: {
                            currentRevision: w.revision,
                            changedBy: { displayName: "Anna" },
                            changedAt: "2026-10-26T08:00:00Z",
                        },
                    },
                });
            }
            w.revision += 1;
            if (body.fields?.title !== undefined) w.title = body.fields.title;
            return Promise.resolve({ ok: true, status: 200, quittung: quittung(id, w.revision) });
        },
    };
    return server;
}

let scope: EffectScope | undefined;
function baue(server: FalscherServer): LiteraturSteuerung {
    scope = effectScope();
    return scope.run(() =>
        createLiteraturSteuerung({
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

describe("Auswahl", () => {
    it("🔴 ein Entwurf mit Änderungen wandert nie auf ein anderes Werk: erst die Frage, dann Wechsel oder Bleiben", async () => {
        const server = falscherServer(werk(1), werk(2));
        const s = baue(server);
        s.ladeListeNeu();
        await warte(() => s.liste.value !== undefined, "Liste");
        s.waehle(werk(1).id);
        await warte(() => s.werk.value?.id === werk(1).id, "Werk 1");
        s.setzeFeldWert("genre", "Stadt");
        expect(s.geaendert.value).toBe(true);
        s.waehle(werk(2).id);
        expect(s.wechselWunsch.value).toBe(werk(2).id);
        expect(s.gewaehlt.value).toBe(werk(1).id);
        s.bleibe();
        expect(s.wechselWunsch.value).toBeUndefined();
        expect(s.stand.value?.felder.genre).toBe("Stadt");
        s.waehle(werk(2).id);
        s.bestaetigeWechsel();
        await warte(() => s.werk.value?.id === werk(2).id, "Werk 2");
        expect(s.geaendert.value).toBe(false);
        expect(s.stand.value?.felder.genre).toBe("");
    });
});

describe("Speichern", () => {
    it("schickt die Revision des gesehenen Stands und nur das Geänderte; danach steht der neue Stand da", async () => {
        const server = falscherServer(werk(1));
        const s = baue(server);
        s.waehleDirekt(werk(1).id);
        await warte(() => s.werk.value !== undefined, "Werk");
        s.setzeFeldWert("title", "Neuer Titel");
        s.schalteStart("2");
        await s.speichern();
        expect(server.gesendet).toHaveLength(1);
        expect(server.gesendet[0]?.body).toMatchObject({
            baseRevision: 1,
            fields: { title: "Neuer Titel" },
            orte: [
                { rowId: "1", role: "play" },
                { rowId: "2", role: "start" },
            ],
        });
        expect(s.zustand.value).toEqual({ art: "gespeichert", revision: 2 });
        expect(s.werk.value?.revision).toBe(2);
        expect(s.geaendert.value).toBe(false);
    });

    it("ein leerer Titel geht nicht zum Server", async () => {
        const server = falscherServer(werk(1));
        const s = baue(server);
        s.waehleDirekt(werk(1).id);
        await warte(() => s.werk.value !== undefined, "Werk");
        s.setzeFeldWert("title", "  ");
        await s.speichern();
        expect(server.gesendet).toHaveLength(0);
        expect(s.zustand.value).toMatchObject({ art: "abgelehnt", code: "titel_leer" });
    });

    it("🔴 409: der Entwurf bleibt, der fremde Stand und die Überschneidung stehen im Zustand; „eigene anwenden“ legt die Änderungen auf den fremden Stand", async () => {
        const server = falscherServer(werk(1));
        const s = baue(server);
        s.waehleDirekt(werk(1).id);
        await warte(() => s.werk.value !== undefined, "Werk");
        // Ein Fremder ändert das Genre und hängt hinten eine Zeile an (Revision 2).
        const fremd = server.werke.get(werk(1).id)!;
        fremd.revision = 2;
        fremd.genre = "Fremd";
        fremd.orte = [...fremd.orte, ort(3, { name: "Ort 3 (fremd)" })];
        s.setzeFeldWert("title", "Mein Titel");
        s.verschiebe("2", -1);
        await s.speichern();
        const z = s.zustand.value;
        expect(z.art).toBe("konflikt");
        if (z.art !== "konflikt") return;
        expect(z.wer).toBe("Anna");
        expect(z.eigene).toEqual(expect.arrayContaining(["title", "orte"]));
        expect(z.fremde).toEqual(expect.arrayContaining(["genre", "orte"]));
        expect(z.beide).toEqual(["orte"]);
        expect(s.stand.value?.felder.title).toBe("Mein Titel");
        // Mit Überschneidung geht „eigene anwenden“ nicht ohne `trotzdem`.
        await s.eigeneAnwenden(false);
        expect(s.zustand.value.art).toBe("konflikt");
        await s.eigeneAnwenden(true);
        expect(s.zustand.value).toEqual({ art: "bereit" });
        expect(s.werk.value?.revision).toBe(2);
        expect(s.stand.value?.felder).toMatchObject({ title: "Mein Titel", genre: "Fremd" });
        // Die eigene Folge gilt, die Zeile des Fremden steht dahinter.
        expect(s.stand.value?.orte.filter((o) => o.state === "active").map((o) => o.rowId)).toEqual(["2", "1", "3"]);
        await s.speichern();
        expect(server.gesendet.at(-1)?.body).toMatchObject({
            baseRevision: 2,
            orte: [
                { rowId: "2", role: "play" },
                { rowId: "1", role: "play" },
                { rowId: "3", role: "play" },
            ],
        });
        expect(s.zustand.value).toMatchObject({ art: "gespeichert" });
    });

    it("„fremden Stand übernehmen“ verwirft den Entwurf", async () => {
        const server = falscherServer(werk(1));
        const s = baue(server);
        s.waehleDirekt(werk(1).id);
        await warte(() => s.werk.value !== undefined, "Werk");
        server.werke.get(werk(1).id)!.revision = 2;
        s.setzeFeldWert("genre", "Meins");
        await s.speichern();
        expect(s.zustand.value.art).toBe("konflikt");
        await s.fremdenUebernehmen();
        expect(s.zustand.value).toEqual({ art: "bereit" });
        expect(s.geaendert.value).toBe(false);
        expect(s.werk.value?.revision).toBe(2);
    });

    it("Verwerfen und ↶ ↷", async () => {
        const server = falscherServer(werk(1));
        const s = baue(server);
        s.waehleDirekt(werk(1).id);
        await warte(() => s.werk.value !== undefined, "Werk");
        s.schalteStart("1");
        s.loese("2");
        expect(s.anzahl.value).toBe(2);
        expect(s.kannZurueck.value).toBe(true);
        s.zurueck();
        s.zurueck();
        expect(s.geaendert.value).toBe(false);
        expect(s.kannWieder.value).toBe(true);
        s.wieder();
        expect(s.stand.value?.orte[0]?.role).toBe("start");
        s.verwerfen();
        expect(s.geaendert.value).toBe(false);
        expect(s.kannZurueck.value).toBe(false);
    });
});

describe("Anlegen", () => {
    it("legt ein Werk an, lädt die Liste neu und wählt das neue Werk", async () => {
        const server = falscherServer(werk(1));
        const s = baue(server);
        s.oeffneAnlegen();
        expect(s.anlegen.value.art).toBe("offen");
        await s.legeAn("Ganz Neu", "roman");
        expect(s.anlegen.value.art).toBe("aus");
        await warte(() => s.werk.value?.title === "Ganz Neu", "neues Werk");
        expect(s.gewaehlt.value).toBe("00000000-0000-4000-8000-00000000f009");
        expect(s.zeilen.value.map((z) => z.title)).toContain("Ganz Neu");
    });
});

describe("Zurückgenommen aus „Änderungen“ (WI-0265 B6g1)", () => {
    /** Zählt, wie oft der Reiter Liste und Werk liest. */
    function zaehle(server: FalscherServer): { liste: number; werk: number } {
        const gelesen = { liste: 0, werk: 0 };
        const liste = server.client.werke.bind(server.client);
        const eines = server.client.werk.bind(server.client);
        server.client.werke = (...argumente) => {
            gelesen.liste += 1;
            return liste(...argumente);
        };
        server.client.werk = (...argumente) => {
            gelesen.werk += 1;
            return eines(...argumente);
        };
        return gelesen;
    }
    /** Der Server hat das Werk zurückgenommen: neuer Titel, höhere Revision (die Rücknahme zählt sie hoch). */
    const zurueckgenommen = (server: FalscherServer, n: number): void => {
        const w = server.werke.get(werk(n).id)!;
        w.title = "Zurückgenommen";
        w.revision += 1;
    };

    it("🔴 liest die Liste und das gewählte Werk neu, wenn die Rücknahme es berührte; ein anderes Werk oder eine andere Art lässt es in Ruhe", async () => {
        const server = falscherServer(werk(1), werk(2));
        const s = baue(server);
        s.ladeListeNeu();
        await warte(() => s.liste.value !== undefined, "Liste");
        s.waehle(werk(1).id);
        await warte(() => s.werk.value?.id === werk(1).id, "Werk 1");
        const gelesen = zaehle(server);

        // Eine Quelle (andere Art) und ein anderes Werk: nichts zu lesen.
        meldeInhalte([{ kind: "source", id: werk(1).id }]);
        meldeInhalte([{ kind: "path", id: werk(1).id }]);
        await new Promise((r) => setTimeout(r, 30));
        expect(gelesen).toEqual({ liste: 0, werk: 0 });
        meldeInhalte([{ kind: "work", id: werk(2).id }]);
        await warte(() => gelesen.liste === 1, "Liste neu");
        expect(gelesen.werk).toBe(0);

        // Das gewählte Werk: die Liste UND das Werk lesen neu, der neue Stand steht da.
        zurueckgenommen(server, 1);
        meldeInhalte([{ kind: "work", id: werk(1).id }]);
        await warte(() => s.werk.value?.revision === 2, "Werk neu gelesen");
        expect(s.werk.value?.title).toBe("Zurückgenommen");
        expect(gelesen.werk).toBe(1);
        expect(gelesen.liste).toBe(2);
        expect(s.geaendert.value).toBe(false);
    });

    it("🔴 ein Entwurf mit Änderungen bleibt, wie er ist: das Werk wird nicht ersetzt, das nächste Speichern ist ein gewöhnlicher Konflikt", async () => {
        const server = falscherServer(werk(1));
        const s = baue(server);
        s.waehleDirekt(werk(1).id);
        await warte(() => s.werk.value !== undefined, "Werk");
        s.setzeFeldWert("genre", "Meine Änderung");
        const gelesen = zaehle(server);

        zurueckgenommen(server, 1);
        meldeInhalte([{ kind: "work", id: werk(1).id }]);
        await new Promise((r) => setTimeout(r, 30));
        // Das Fenster liest das Werk nicht neu: Der Entwurf läge sonst auf einem Stand, den er nie gesehen hat.
        expect(gelesen.werk).toBe(0);
        expect(s.werk.value?.revision).toBe(1);
        expect(s.stand.value?.felder.genre).toBe("Meine Änderung");
        await s.speichern();
        expect(s.zustand.value.art).toBe("konflikt");
    });
});
