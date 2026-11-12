import { effectScope, type EffectScope } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type {
    InhalteKorporaAnfrage,
    InhalteKorpusAendernBody,
    InhalteKorpusAnlegenBody,
    InhalteKorpusEintrag,
    InhalteKorpusQuelle,
    InhalteKorpusWirkung,
    InhalteKorpusWirkungBody,
    OperationReceipt,
} from "@avesmaps3d/shared";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import type { InhalteClient } from "../src/inhalte/inhalte-client.ts";
import { createKorporaSteuerung, type KorporaSteuerung } from "../src/inhalte/inhalte-korpora-steuerung.ts";

/**
 * Der Reiter „Korpora“ im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 4) mit einem falschen Client statt des Servers: der Filter nach Anzeigeform, Speichern
 * mit Revision und dem Geänderten, „Wirkung prüfen“, die Rückfrage ab zehn Quellen (409 `corpus_confirm_required`), der Konflikt mit „eigene anwenden“ und
 * das Anlegen mit einer bekannten Domain. Die Rechnung am Entwurf prüft `inhalte-korpora-modell.test.ts`, den Server `apps/server/test/inhalte-korpora.test.ts`.
 */
const quelle = (n: number, teil: Partial<InhalteKorpusQuelle> = {}): InhalteKorpusQuelle => ({
    id: `00000000-0000-4000-8000-00000000090${String(n)}`,
    title: `Seite ${String(n)}`,
    url: `https://www.beispiel.de/seite-${String(n)}`,
    sourceType: "sonstiges",
    isOfficial: false,
    uses: n,
    abweichend: [],
    ...teil,
});

function korpus(n: number, teil: Partial<InhalteKorpusEintrag> = {}): InhalteKorpusEintrag {
    return {
        id: `00000000-0000-4000-8000-00000000c00${String(n)}`,
        revision: 1,
        key: `beispiel${String(n)}.de`,
        label: `Angebot ${String(n)}`,
        form: "belegstelle",
        sourceType: null,
        isOfficial: null,
        lizenzAussage: "unrecorded",
        lizenzKey: null,
        attribution: null,
        editorNote: null,
        herkunft: "legacy",
        schreibtDurch: true,
        quellen: [quelle(1), quelle(2)],
        quellenGesamt: 2,
        traegerGesamt: 3,
        abweichendGesamt: 0,
        lizenzen: [{ key: "cc-by-sa-3.0", name: "CC BY-SA 3.0" }],
        ...teil,
    };
}

const quittung = (id: string, revision: number): OperationReceipt => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "test",
    affected: [{ kind: "corpus", id, revision }],
    derivedWork: [],
    warnings: [],
});

const wirkung = (teil: Partial<InhalteKorpusWirkung> = {}): InhalteKorpusWirkung => ({
    form: "belegstelle",
    schreibtDurch: true,
    quellenGesamt: 2,
    traegerGesamt: 3,
    aendernGesamt: 2,
    felder: [{ feld: "sourceType", wert: "briefspiel", aendern: 2, ueberschreibt: 1 }],
    bestaetigungAb: 10,
    bestaetigungNoetig: false,
    ...teil,
});

interface FalscherServer {
    client: InhalteClient;
    korpora: Map<string, InhalteKorpusEintrag>;
    gesendet: { id: string; body: InhalteKorpusAendernBody }[];
    angelegt: InhalteKorpusAnlegenBody[];
    listenAnfragen: InhalteKorporaAnfrage[];
    wirkungAnfragen: { id: string; body: InhalteKorpusWirkungBody }[];
    /** Das nächste Speichern gibt 409 `edit_conflict` zurück. */
    konflikt: boolean;
    /** Speichern ohne `bestaetigt` gibt 409 `corpus_confirm_required` zurück (die Änderung trifft ab zehn Quellen). */
    bestaetigungVerlangt: boolean;
    /** Anlegen trifft eine bekannte Domain: 409 `corpus_exists`. */
    vorhandenBeiAnlegen: string | undefined;
}

function falscherServer(...liste: InhalteKorpusEintrag[]): FalscherServer {
    const server: FalscherServer = {
        client: undefined as never,
        korpora: new Map(liste.map((k) => [k.id, k])),
        gesendet: [],
        angelegt: [],
        listenAnfragen: [],
        wirkungAnfragen: [],
        konflikt: false,
        bestaetigungVerlangt: false,
        vorhandenBeiAnlegen: undefined,
    };
    const nein = (): Promise<never> => Promise.reject(new Error("nicht gebraucht"));
    server.client = {
        liste: nein,
        quelle: nein,
        adresse: nein,
        ziele: () => Promise.resolve({ items: [] }),
        anlegen: nein,
        aendern: nein,
        werke: nein,
        werk: nein,
        werkAnlegen: nein,
        werkAendern: nein,
        vorkommen: nein,
        vorkommenEintrag: nein,
        vorkommenZiele: () => Promise.resolve({ items: [] }),
        vorkommenFlaechen: () => Promise.resolve({ items: [] }),
        vorkommenOrte: () => Promise.resolve({ items: [] }),
        vorkommenUmriss: () => Promise.reject(new Error("nicht gebraucht")),
        vorkommenAnlegen: nein,
        vorkommenAendern: nein,
        regelTextPruefen: nein,
        regelTextUebernehmen: nein,
        vorkommenAlsText: nein,
        korpora: (anfrage) => {
            server.listenAnfragen.push(anfrage);
            const alle = [...server.korpora.values()].filter(
                (k) =>
                    anfrage.form === undefined ||
                    (anfrage.form === "unentschieden" ? k.form === "" : k.form === anfrage.form),
            );
            return Promise.resolve({
                total: alle.length,
                items: alle.map((k) => ({
                    id: k.id,
                    key: k.key,
                    title: k.label === "" ? k.key : k.label,
                    form: k.form,
                    quellen: k.quellenGesamt,
                    herkunft: k.herkunft,
                })),
                zahlen: { aktiv: server.korpora.size, editor: 0 },
            });
        },
        korpus: (id) => {
            const k = server.korpora.get(id);
            return k === undefined ? Promise.reject(new Error("fehlt")) : Promise.resolve(structuredClone(k));
        },
        korpusAnlegen: (body) => {
            server.angelegt.push(body);
            if (server.vorhandenBeiAnlegen !== undefined) {
                return Promise.resolve({
                    ok: false,
                    status: 409,
                    fehler: {
                        code: "corpus_exists",
                        message: "Für diese Domain gibt es schon einen Korpus.",
                        details: { corpusId: server.vorhandenBeiAnlegen, active: true },
                    },
                });
            }
            const neu = korpus(9, {
                id: "00000000-0000-4000-8000-00000000c009",
                key: body.key,
                label: body.label ?? "",
                herkunft: "editor",
                form: "",
                schreibtDurch: false,
                quellen: [],
                quellenGesamt: 0,
            });
            server.korpora.set(neu.id, neu);
            return Promise.resolve({ ok: true, status: 200, quittung: { ...quittung(neu.id, 1), publicId: neu.id } });
        },
        korpusWirkung: (id, body): Promise<SchreibAntwort<InhalteKorpusWirkung>> => {
            server.wirkungAnfragen.push({ id, body });
            return Promise.resolve({
                ok: true,
                status: 200,
                quittung: wirkung({ bestaetigungNoetig: server.bestaetigungVerlangt }),
            });
        },
        korpusAendern: (id, body): Promise<SchreibAntwort<OperationReceipt>> => {
            server.gesendet.push({ id, body });
            const k = server.korpora.get(id)!;
            if (server.konflikt || body.baseRevision !== k.revision) {
                return Promise.resolve({
                    ok: false,
                    status: 409,
                    fehler: {
                        code: "edit_conflict",
                        message: "Veraltet.",
                        details: {
                            currentRevision: k.revision,
                            changedBy: { displayName: "Anna" },
                            changedAt: "2026-10-26T08:00:00Z",
                        },
                    },
                });
            }
            if (server.bestaetigungVerlangt && body.bestaetigt !== true) {
                return Promise.resolve({
                    ok: false,
                    status: 409,
                    fehler: {
                        code: "corpus_confirm_required",
                        message: "Bitte bestätigen.",
                        details: { quellen: 14, aendern: 12, traeger: 5 },
                    },
                });
            }
            k.revision += 1;
            if (body.fields.label !== undefined) k.label = body.fields.label;
            if (body.fields.sourceType !== undefined) k.sourceType = body.fields.sourceType;
            return Promise.resolve({ ok: true, status: 200, quittung: quittung(id, k.revision) });
        },
    };
    return server;
}

let scope: EffectScope | undefined;
function baue(server: FalscherServer): KorporaSteuerung {
    scope = effectScope();
    return scope.run(() =>
        createKorporaSteuerung({
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

async function waehleErsten(s: KorporaSteuerung, n = 1): Promise<void> {
    s.ladeListeNeu();
    await warte(() => s.liste.value !== undefined, "Liste");
    s.waehle(korpus(n).id);
    await warte(() => s.korpus.value?.id === korpus(n).id, `Korpus ${String(n)}`);
}

describe("Filter nach Anzeigeform", () => {
    it("🔴 ein Wechsel des Filters lädt die Liste mit der Anzeigeform neu; „alle“ fragt ohne", async () => {
        const server = falscherServer(
            korpus(1),
            korpus(2, { form: "werk", schreibtDurch: false }),
            korpus(3, { form: "", schreibtDurch: false }),
        );
        const s = baue(server);
        s.ladeListeNeu();
        await warte(() => s.liste.value?.items.length === 3, "alle");
        expect(server.listenAnfragen.at(-1)?.form).toBeUndefined();
        s.anzeigeform.value = "werk";
        await warte(() => s.liste.value?.items.length === 1, "nur Werke");
        expect(server.listenAnfragen.at(-1)?.form).toBe("werk");
        s.anzeigeform.value = "unentschieden";
        await warte(() => s.liste.value?.items[0]?.id === korpus(3).id, "unentschieden");
        expect(server.listenAnfragen.at(-1)?.form).toBe("unentschieden");
        s.anzeigeform.value = "alle";
        await warte(() => s.liste.value?.items.length === 3, "wieder alle");
        expect(server.listenAnfragen.at(-1)?.form).toBeUndefined();
    });
});

describe("Auswahl", () => {
    it("🔴 ein Entwurf mit Änderungen wandert nie auf einen anderen Korpus: erst die Frage, dann Wechsel oder Bleiben", async () => {
        const server = falscherServer(korpus(1), korpus(2));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("label", "Neu");
        expect(s.geaendert.value).toBe(true);
        s.waehle(korpus(2).id);
        expect(s.wechselWunsch.value).toBe(korpus(2).id);
        expect(s.gewaehlt.value).toBe(korpus(1).id);
        s.bleibe();
        expect(s.stand.value?.felder.label).toBe("Neu");
        s.waehle(korpus(2).id);
        s.bestaetigeWechsel();
        await warte(() => s.korpus.value?.id === korpus(2).id, "Korpus 2");
        expect(s.geaendert.value).toBe(false);
        expect(s.stand.value?.felder.label).toBe("Angebot 2");
    });
});

describe("Speichern", () => {
    it("schickt die Revision des gesehenen Stands mit den geänderten Feldern; danach steht der neue Stand da", async () => {
        const server = falscherServer(korpus(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("label", "Weiden-Wiki");
        s.setzeFeldWert("sourceType", "briefspiel");
        expect(s.anzahl.value).toBe(2);
        await s.speichern();
        expect(server.gesendet).toHaveLength(1);
        expect(server.gesendet[0]!.body).toMatchObject({
            baseRevision: 1,
            fields: { label: "Weiden-Wiki", sourceType: "briefspiel" },
        });
        expect(server.gesendet[0]!.body.bestaetigt).toBeUndefined();
        await warte(() => s.zustand.value.art === "gespeichert", "gespeichert");
        expect(s.korpus.value?.revision).toBe(2);
        expect(s.geaendert.value).toBe(false);
    });

    it("🔴 der Name des Angebots darf leer sein: Viele Legacy-Korpora haben keinen, und die Domain steht dann vorn", async () => {
        const server = falscherServer(korpus(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("label", "");
        await s.speichern();
        expect(server.gesendet).toHaveLength(1);
        expect(server.gesendet[0]!.body.fields).toEqual({ label: "" });
    });

    it("🔴 bei einem Werk geht keine Vorgabe zum Server, auch wenn der Entwurf sie ändert", async () => {
        const server = falscherServer(korpus(1, { form: "werk", schreibtDurch: false }));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "roman");
        s.setzeFeldWert("attribution", "X");
        expect(s.geaendert.value).toBe(false);
        await s.speichern();
        expect(server.gesendet).toHaveLength(0);
    });

    it("🔴 weg von der Belegstelle nimmt der Entwurf die Vorgabe auf den gespeicherten Stand zurück; der Körper trägt nur die Form", async () => {
        const server = falscherServer(korpus(1, { sourceType: "briefspiel" }));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "roman");
        s.setzeFormWert("werk");
        expect(s.stand.value?.felder.sourceType).toBe("briefspiel");
        await s.speichern();
        expect(server.gesendet[0]!.body.fields).toEqual({ form: "werk" });
    });

    it("🔴 409: der Entwurf bleibt; „eigene anwenden“ legt die eigenen Felder auf den fremden Stand", async () => {
        const server = falscherServer(korpus(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "roman");
        // Die andere Seite hat inzwischen den Namen geändert.
        const fremd = server.korpora.get(korpus(1).id)!;
        fremd.revision = 2;
        fremd.label = "Fremder Name";
        await s.speichern();
        expect(s.zustand.value.art).toBe("konflikt");
        if (s.zustand.value.art !== "konflikt") return;
        expect(s.zustand.value.wer).toBe("Anna");
        expect(s.zustand.value.beide).toEqual([]);
        expect(s.stand.value?.felder.sourceType).toBe("roman");
        await s.eigeneAnwenden();
        expect(s.korpus.value?.revision).toBe(2);
        expect(s.stand.value?.felder.label).toBe("Fremder Name");
        expect(s.stand.value?.felder.sourceType).toBe("roman");
        await s.speichern();
        expect(server.gesendet.at(-1)?.body).toMatchObject({ baseRevision: 2, fields: { sourceType: "roman" } });
    });

    it("🔴 409: ändert die andere Seite die Form, überschneiden sich die eigenen Vorgabefelder damit", async () => {
        const server = falscherServer(korpus(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "roman");
        const fremd = server.korpora.get(korpus(1).id)!;
        fremd.revision = 2;
        fremd.form = "werk";
        fremd.schreibtDurch = false;
        await s.speichern();
        expect(s.zustand.value.art).toBe("konflikt");
        if (s.zustand.value.art !== "konflikt") return;
        expect(s.zustand.value.beide).toEqual(["sourceType"]);
    });
});

describe("Wirkung prüfen", () => {
    it("🔴 rechnet mit den Feldern des Entwurfs (nichts wird geschrieben) und legt die Rechnung unter den Entwurf", async () => {
        const server = falscherServer(korpus(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "briefspiel");
        const fertig = s.pruefeWirkung();
        expect(s.wirkung.value.art).toBe("laedt");
        await fertig;
        expect(server.wirkungAnfragen).toHaveLength(1);
        expect(server.wirkungAnfragen[0]).toMatchObject({
            id: korpus(1).id,
            body: { fields: { sourceType: "briefspiel" } },
        });
        expect(s.wirkung.value).toMatchObject({ art: "da", wirkung: { aendernGesamt: 2 } });
        expect(server.gesendet).toHaveLength(0);
    });

    it("🔴 eine weitere Änderung am Entwurf macht die Rechnung ungültig", async () => {
        const server = falscherServer(korpus(1));
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "briefspiel");
        await s.pruefeWirkung();
        expect(s.wirkung.value.art).toBe("da");
        s.setzeFeldWert("sourceType", "roman");
        await warte(() => s.wirkung.value.art === "aus", "Rechnung verworfen");
    });
});

describe("Rückfrage ab zehn Quellen", () => {
    it("🔴 verlangt der Server die Bestätigung, fragt das Fenster mit den Zahlen und der Rechnung, statt zu schreiben", async () => {
        const server = falscherServer(korpus(1));
        server.bestaetigungVerlangt = true;
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "briefspiel");
        await s.speichern();
        expect(s.rueckfrage.value).toEqual({ quellen: 14, aendern: 12, traeger: 5 });
        expect(s.zustand.value).toMatchObject({ art: "abgelehnt", code: "corpus_confirm_required" });
        // Die Rechnung gehört zur Frage: Das Fenster zeigt je Feld, was sich ändert.
        await warte(() => s.wirkung.value.art === "da", "Rechnung zur Frage");
        // Der Entwurf bleibt unangetastet.
        expect(s.stand.value?.felder.sourceType).toBe("briefspiel");
        expect(s.korpus.value?.revision).toBe(1);
    });

    it("🔴 „Auf n Quellen schreiben“ schickt dieselbe Änderung mit der Bestätigung und räumt die Frage ab", async () => {
        const server = falscherServer(korpus(1));
        server.bestaetigungVerlangt = true;
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "briefspiel");
        await s.speichern();
        await s.schreibeTrotzdem();
        expect(s.rueckfrage.value).toBeUndefined();
        expect(server.gesendet).toHaveLength(2);
        expect(server.gesendet[1]!.body).toMatchObject({ bestaetigt: true, fields: { sourceType: "briefspiel" } });
        await warte(() => s.zustand.value.art === "gespeichert", "gespeichert");
        expect(s.korpus.value?.revision).toBe(2);
        // Die Bestätigung gilt nur für diesen einen Versuch.
        s.setzeFeldWert("sourceType", "roman");
        await s.speichern();
        expect(server.gesendet.at(-1)?.body.bestaetigt).toBeUndefined();
    });

    it("„Zurück zum Entwurf“ räumt die Frage ab und schreibt nichts", async () => {
        const server = falscherServer(korpus(1));
        server.bestaetigungVerlangt = true;
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "briefspiel");
        await s.speichern();
        s.bleibeBeimEntwurf();
        expect(s.rueckfrage.value).toBeUndefined();
        expect(s.zustand.value.art).toBe("bereit");
        expect(s.geaendert.value).toBe(true);
        expect(server.gesendet).toHaveLength(1);
    });

    it("eine weitere Änderung am Entwurf macht die Frage ungültig", async () => {
        const server = falscherServer(korpus(1));
        server.bestaetigungVerlangt = true;
        const s = baue(server);
        await waehleErsten(s);
        s.setzeFeldWert("sourceType", "briefspiel");
        await s.speichern();
        expect(s.rueckfrage.value).toBeDefined();
        s.setzeFeldWert("sourceType", "roman");
        await warte(() => s.rueckfrage.value === undefined, "Frage verworfen");
    });
});

describe("Anlegen", () => {
    it("legt einen Korpus mit der bereinigten Domain und dem Namen an und wählt ihn", async () => {
        const server = falscherServer(korpus(1));
        const s = baue(server);
        s.ladeListeNeu();
        await warte(() => s.liste.value !== undefined, "Liste");
        s.oeffneAnlegen();
        await s.legeAn("  Neu-Beispiel.DE. ", " Neues Angebot ");
        expect(server.angelegt).toEqual([
            { operationId: "00000000-0000-4000-8000-000000000002", key: "neu-beispiel.de", label: "Neues Angebot" },
        ]);
        expect(s.anlegen.value.art).toBe("aus");
        await warte(() => s.korpus.value?.id === "00000000-0000-4000-8000-00000000c009", "neuer Korpus gewählt");
    });

    it("ohne Namen geht kein Name mit", async () => {
        const server = falscherServer();
        const s = baue(server);
        s.oeffneAnlegen();
        await s.legeAn("neu.de", "   ");
        expect(server.angelegt[0]).not.toHaveProperty("label");
    });

    it("🔴 eine bekannte Domain legt nichts an, sondern wählt den vorhandenen Korpus", async () => {
        const server = falscherServer(korpus(1), korpus(2));
        server.vorhandenBeiAnlegen = korpus(2).id;
        const s = baue(server);
        s.ladeListeNeu();
        await warte(() => s.liste.value !== undefined, "Liste");
        s.oeffneAnlegen();
        await s.legeAn("beispiel2.de", "");
        expect(s.anlegen.value).toMatchObject({ art: "abgelehnt", code: "corpus_exists" });
        await warte(() => s.korpus.value?.id === korpus(2).id, "vorhandener Korpus gewählt");
    });
});
