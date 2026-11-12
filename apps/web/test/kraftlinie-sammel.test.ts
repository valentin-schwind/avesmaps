import { describe, expect, it, vi } from "vitest";
import type {
    EditorPowerlineDetail,
    EditorPowerlineRow,
    OperationReceipt,
    PowerlineSammelStandBody,
    PowerlineSammelWikiBody,
    WikiArtikel,
} from "@avesmaps3d/shared";
import { createKraftlinieSammel, eigeneJeFeld } from "../src/kraftlinieneditor/kraftlinie-sammel";

/**
 * Die Mehrfachauswahl der Kraftlinien (WI-0238, EDIT-0003 T57): Was die Sammelansicht liest, zählt und schreibt. Problemfälle: ↺ zählt
 * eine Linie ohne Artikel oder eine, die schon dem Wiki folgt, als „eigener Wert“; „Fertig“ schreibt gegen andere Abschnitte oder
 * Revisionen als die gelesenen; „Entfernen …“ schreibt je Linie eine eigene Operation oder vergisst Abschnitte; nach einem Konflikt
 * schreibt die Auswahl wieder gegen den alten Stand.
 */

const A = "a8a8a8a8-0000-4000-8000-000000000001";
const A2 = "a8a8a8a8-0000-4000-8000-000000000002";
const B = "a8a8a8a8-0000-4000-8000-000000000003";
const C = "a8a8a8a8-0000-4000-8000-000000000004";

const ARTIKEL: WikiArtikel = {
    key: "basiliuslinie",
    url: "https://de.wiki-aventurica.de/wiki/Basiliuslinie",
    name: "Basiliuslinie",
    werte: { name: "Basiliuslinie", description: "Aus dem Wiki." },
};

function linie(
    id: string,
    name: string,
    abschnitte: readonly string[],
    teil: Partial<EditorPowerlineDetail> = {},
    revision = 3,
): EditorPowerlineDetail {
    return {
        id,
        name,
        circle: "voll",
        shape: "strang",
        segments: abschnitte.map((s, i) => ({
            id: s,
            from: `k${String(i)}`,
            to: `k${String(i + 1)}`,
            curve: null,
            labelVisible: true,
            revision: revision + i,
            description: "Eigene Zeile.",
        })),
        nodes: [],
        description: "Eigene Zeile.",
        ...teil,
    };
}
const zeile = (id: string, name: string): EditorPowerlineRow =>
    ({ id, name, circle: "voll", shape: "strang", segments: 1, nodes: 2 }) as EditorPowerlineRow;

const QUITTUNG: OperationReceipt = {
    operationId: "op",
    status: "applied",
    environment: "test",
    affected: [],
    derivedWork: [],
    warnings: [],
    mapRevision: 91,
};

/** Ein Server: GET liest die Linien (nach `stand` je Aufruf), POST nimmt den Körper und antwortet mit `antwort`. */
function server(linien: Map<string, EditorPowerlineDetail>, antwort: () => Response = () => Response.json(QUITTUNG)) {
    const gesendet: { url: string; body: unknown }[] = [];
    const gelesen: string[] = [];
    const fetcher = vi.fn(async (eingabe: string | URL | Request, init?: RequestInit) => {
        const url = String(eingabe);
        if (init?.method === "POST") {
            gesendet.push({ url, body: JSON.parse(String(init.body)) });
            return antwort();
        }
        const id = url.slice(url.lastIndexOf("/") + 1);
        gelesen.push(id);
        const gefunden = linien.get(id);
        return gefunden === undefined ? new Response("{}", { status: 404 }) : Response.json(gefunden);
    });
    return { fetcher, gesendet, gelesen };
}

describe("Mehrfachauswahl der Kraftlinien (WI-0238)", () => {
    it("🔴 ↺ zählt nur Linien mit eigenem Wert: ohne Artikel nicht, dem Wiki folgend nicht", () => {
        const eigen = linie(A, "Alter Name", [A], { article: ARTIKEL });
        // Folgt dem Wiki: keine eigene Beschreibung (leer folgt dem Wiki), Herkunft wiki, Name wie im Artikel.
        const { description: _eigene, ...folgtDetail } = linie(B, "Basiliuslinie", [B], { article: ARTIKEL });
        const { description: _zeile, ...abschnitt } = folgtDetail.segments[0]!;
        void _eigene;
        void _zeile;
        const folgt: EditorPowerlineDetail = {
            ...folgtDetail,
            segments: [{ ...abschnitt, herkunft: { name: "wiki", description: "wiki" } }],
        };
        const ohne = linie(C, "Ohne Artikel", [C]);
        expect(eigeneJeFeld([eigen, folgt, ohne])).toEqual({ name: 1, description: 1 });
    });

    it("🔴 „Fertig“ nach ↺ schreibt EINE Operation über alle, mit den gelesenen Abschnitten und Revisionen; danach neu lesen", async () => {
        const linien = new Map([
            [A, linie(A, "Alter Name", [A, A2], { article: ARTIKEL }, 5)],
            [B, linie(B, "Zweite", [B], { article: ARTIKEL }, 8)],
        ]);
        const { fetcher, gesendet, gelesen } = server(linien);
        const geschrieben = vi.fn();
        const sammel = createKraftlinieSammel([A, B], { fetcher, zeilen: () => [], geschrieben });
        await vi.waitFor(() => expect(sammel.details.value.size).toBe(2));
        sammel.entwurf.aufWiki("name");
        sammel.entwurf.aufWiki("description");
        expect(sammel.entwurf.lage.value.ungespeichert).toBe(2);
        await sammel.entwurf.fertig();
        expect(gesendet).toHaveLength(1);
        expect(gesendet[0]!.url).toBe("/api/editor/powerlines/sammel/wiki");
        const body = gesendet[0]!.body as PowerlineSammelWikiBody;
        expect(body.felder).toEqual(["name", "description"]);
        expect(body.lines).toEqual([
            {
                anker: A,
                segments: [
                    { id: A, baseRevision: 5 },
                    { id: A2, baseRevision: 6 },
                ],
            },
            { anker: B, segments: [{ id: B, baseRevision: 8 }] },
        ]);
        expect(geschrieben).toHaveBeenCalledWith(QUITTUNG);
        expect(sammel.entwurf.zustand.value.art).toBe("gespeichert");
        await vi.waitFor(() => expect(gelesen).toEqual([A, B, A, B]));
        sammel.destroy();
    });

    it("🔴 „Entfernen …“ schreibt EINE Operation (`powerline.retire` oder `powerline.take_off_map`) über alle Linien", async () => {
        const linien = new Map([
            [A, linie(A, "Eins", [A, A2])],
            [B, linie(B, "Zwei", [B])],
        ]);
        const { fetcher, gesendet } = server(linien);
        const geschrieben = vi.fn();
        const sammel = createKraftlinieSammel([A, B], {
            fetcher,
            zeilen: () => [zeile(A, "Eins"), zeile(B, "Zwei"), zeile(C, "Drei")],
            geschrieben,
        });
        // Noch nicht gelesen: nichts geht raus.
        expect(await sammel.entferne("loeschen")).toBeTypeOf("string");
        expect(gesendet).toEqual([]);
        await vi.waitFor(() => expect(sammel.details.value.size).toBe(2));
        expect(sammel.zeilen().map((z) => z.name)).toEqual(["Eins", "Zwei"]);
        expect(await sammel.entferne("loeschen")).toBeUndefined();
        expect(await sammel.entferne("abnehmen")).toBeUndefined();
        const [loeschen, abnehmen] = gesendet.map((g) => g.body as PowerlineSammelStandBody);
        expect(gesendet[0]!.url).toBe("/api/editor/powerlines/sammel/stand");
        expect(loeschen!.wechsel).toBe("powerline.retire");
        expect(abnehmen!.wechsel).toBe("powerline.take_off_map");
        expect(loeschen!.lines.map((l) => [l.anker, l.segments.length])).toEqual([
            [A, 2],
            [B, 1],
        ]);
        expect(loeschen!.operationId).not.toBe(abnehmen!.operationId);
        expect(geschrieben).toHaveBeenCalledTimes(2);
        sammel.destroy();
    });

    it("🔴 💣 ein Konflikt (409) liest die Auswahl neu, und der nächste Versuch schreibt gegen den neuen Stand", async () => {
        const linien = new Map([
            [A, linie(A, "Eins", [A], {}, 3)],
            [B, linie(B, "Zwei", [B], {}, 3)],
        ]);
        let konflikt = true;
        const { fetcher, gesendet } = server(linien, () =>
            konflikt
                ? Response.json({ error: { code: "edit_conflict", message: "geändert" } }, { status: 409 })
                : Response.json(QUITTUNG),
        );
        const sammel = createKraftlinieSammel([A, B], { fetcher, zeilen: () => [], geschrieben: vi.fn() });
        await vi.waitFor(() => expect(sammel.details.value.size).toBe(2));
        linien.set(B, linie(B, "Zwei", [B], {}, 9));
        const satz = await sammel.entferne("loeschen");
        expect(satz).toBeTypeOf("string");
        await vi.waitFor(() => expect(sammel.details.value.get(B)?.segments[0]?.revision).toBe(9));
        konflikt = false;
        expect(await sammel.entferne("loeschen")).toBeUndefined();
        const zweiter = gesendet[1]!.body as PowerlineSammelStandBody;
        expect(zweiter.lines.find((l) => l.anker === B)?.segments).toEqual([{ id: B, baseRevision: 9 }]);
        sammel.destroy();
    });

    it("🔴 B6h2: `neuLesen` liest die Revisionen neu und lässt den Entwurf stehen; „Fertig“ schreibt danach gegen den neuen Stand", async () => {
        const linien = new Map([
            [A, linie(A, "Alter Name", [A], { article: ARTIKEL }, 5)],
            [B, linie(B, "Zweite", [B], { article: ARTIKEL }, 8)],
        ]);
        const { fetcher, gesendet } = server(linien);
        const sammel = createKraftlinieSammel([A, B], { fetcher, zeilen: () => [], geschrieben: vi.fn() });
        await vi.waitFor(() => expect(sammel.details.value.size).toBe(2));
        sammel.entwurf.aufWiki("name");
        expect(sammel.entwurf.lage.value.ungespeichert).toBe(1);

        // Eine Rücknahme über den Server hat die Linie B weitergezählt.
        linien.set(B, linie(B, "Zweite", [B], { article: ARTIKEL }, 9));
        await sammel.neuLesen();
        expect(sammel.details.value.get(B)?.segments[0]?.revision).toBe(9);
        expect(sammel.entwurf.lage.value.ungespeichert).toBe(1);

        await sammel.entwurf.fertig();
        const body = gesendet[0]!.body as PowerlineSammelWikiBody;
        expect(body.lines.find((l) => l.anker === B)?.segments).toEqual([{ id: B, baseRevision: 9 }]);
        sammel.destroy();
    });

    it("🔴 B6h2: ein früheres, langsameres Lesen überschreibt das spätere nicht; ein Lesefehler geht mit dem nächsten guten Lesen", async () => {
        const linien = new Map<string, EditorPowerlineDetail>([[A, linie(A, "Eins", [A], {}, 3)]]);
        let halte: (() => void) | undefined;
        const tor = new Promise<void>((frei) => (halte = frei));
        let erster = true;
        const fetcher = vi.fn(async (eingabe: string | URL | Request) => {
            const id = String(eingabe).slice(String(eingabe).lastIndexOf("/") + 1);
            const stand = linien.get(id);
            // Das erste Lesen hat den alten Stand schon in der Hand, kommt aber erst an, wenn das zweite fertig ist.
            if (erster) {
                erster = false;
                await tor;
            }
            return stand === undefined ? new Response("{}", { status: 404 }) : Response.json(stand);
        });
        const sammel = createKraftlinieSammel([A], { fetcher, zeilen: () => [], geschrieben: vi.fn() });
        linien.set(A, linie(A, "Eins", [A], {}, 9));
        await sammel.neuLesen();
        expect(sammel.details.value.get(A)?.segments[0]?.revision).toBe(9);
        halte!();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        expect(sammel.details.value.get(A)?.segments[0]?.revision).toBe(9);
        expect(sammel.ladeFehler.value).toBe(false);

        // Eine Linie, die es nicht mehr gibt, ist ein Lesefehler; sobald sie wieder da ist, ist er weg.
        linien.delete(A);
        await sammel.neuLesen();
        expect(sammel.ladeFehler.value).toBe(true);
        linien.set(A, linie(A, "Eins", [A], {}, 10));
        await sammel.neuLesen();
        expect(sammel.ladeFehler.value).toBe(false);
        expect(sammel.details.value.get(A)?.segments[0]?.revision).toBe(10);
        sammel.destroy();
    });
});
