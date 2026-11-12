import { describe, expect, it, vi } from "vitest";
import type { EditorPowerlineDetail, MapHistoryEntry } from "@avesmaps3d/shared";
import type { NimmErgebnis } from "../src/editor-sperre/sperre";
import { createBearbeitung } from "../src/fenster/bearbeitung";
import { createKraftlinieArt } from "../src/kraftlinieneditor/kraftlinie-art";
import { ruecknahmeFamilie, ruecknahmeZiel } from "../src/aenderungen/aenderung-ruecknahme";
import { createKraftlinieVerlaufsArt } from "../src/kraftlinieneditor/kraftlinie-verlauf";

/**
 * Der Verlauf der Kraftlinie (WI-0205; Anschluss an `fenster/entwurf-verlauf.ts`), seit WI-0265 B6b ohne eigenes Zurückspielen: Der Server nimmt zurück
 * (`ruecknahme-kraftlinie.ts`), der Anschluss nennt nur die Adresse. Problemfälle: Ein Eintrag, den der Server kennt, bekommt keine Adresse (kein ↺); einer, den er nicht kennt
 * (Anlegen, ein Nodix), bekommt eine; der Verlauf spielt doch noch selbst zurück; die Bearbeitung liest nach ↺ nicht neu; nach ↺ schreibt der Verlauf unter einem Anker, den es auf
 * der Karte nicht mehr gibt.
 */

const A1 = "a1a1a1a1-0000-4000-8000-000000000001";
const A2 = "a1a1a1a1-0000-4000-8000-000000000002";
const P = "c1c1c1c1-0000-4000-8000-000000000002";
const NEU = "c1c1c1c1-0000-4000-8000-000000000009";

const LINIE: EditorPowerlineDetail = {
    id: A1,
    name: "Ley von Gareth",
    circle: "voll",
    shape: "strang",
    segments: [
        { id: A1, from: "g", to: P, curve: 20, labelVisible: false, revision: 4, description: "Eine Ader." },
        { id: A2, from: P, to: NEU, curve: null, labelVisible: false, revision: 6, description: "Eine Ader." },
    ],
    nodes: [],
};

const eintrag = (
    objects: MapHistoryEntry["objects"],
    source: MapHistoryEntry["source"] = "editor",
): MapHistoryEntry => ({
    operationId: "e1e1e1e1-0000-4000-8000-000000000001",
    seq: 12,
    at: "2026-10-17T10:00:00.000Z",
    operation: "powerline.update_line",
    source,
    actor: { kind: "person", name: "Thomas" },
    objects,
});
const geaendert = (id: string, changes: MapHistoryEntry["objects"][number]["changes"]) => ({
    kind: "powerline" as const,
    id,
    action: "powerline.updated",
    revisionBefore: 3,
    revisionAfter: 4,
    changes,
});

describe("Verlauf der Kraftlinie (seit B6b über den Server)", () => {
    it("🔴 der Anschluss spielt nichts mehr selbst zurück: ↺ sagt immer `nicht`, die Adresse nennt die Linie des Verlaufs", () => {
        const art = createKraftlinieVerlaufsArt();
        const e = eintrag([
            geaendert(A1, { name: { before: "Ley", after: "Ley von Gareth" }, curve: { before: null, after: 20 } }),
            geaendert(A2, { name: { before: "Ley", after: "Ley von Gareth" } }),
        ]);
        expect(art.ruecknahme(e, LINIE, "op")).toEqual({ art: "nicht" });
        expect(art.ruecknahmeZiel?.(e, A1)).toEqual({ familie: "powerline", id: A1 });
    });

    it("🔴 jede Art, die der Server kennt, bekommt eine Adresse: Felder, Form, angefügt, herausgenommen, jeder Wechsel des Stands (auch für mehrere Linien), eine Rücknahme", () => {
        const art = createKraftlinieVerlaufsArt();
        const stand = (operation: string, aktion: string): MapHistoryEntry => ({
            ...eintrag([
                { ...geaendert(A1, { active: { before: true, after: false } }), action: aktion },
                { ...geaendert(A2, { active: { before: true, after: false } }), action: aktion },
            ]),
            operation,
        });
        const faelle: [string, MapHistoryEntry][] = [
            ["Felder", eintrag([geaendert(A1, { labelVisible: { before: true, after: false } })])],
            ["Form", eintrag([geaendert(A1, { to: { before: P, after: NEU }, curve: { before: null, after: 5 } })])],
            [
                "angefügt",
                eintrag([
                    geaendert(A1, {}),
                    {
                        ...geaendert(A2, { active: { after: true } }),
                        action: "powerline.created",
                        revisionBefore: null,
                    },
                ]),
            ],
            ["herausgenommen", eintrag([geaendert(A1, {}), { ...geaendert(A2, {}), action: "powerline.removed" }])],
            ["abgenommen", stand("powerline.take_off_map", "powerline.taken_off_map")],
            ["wieder auf der Karte", stand("powerline.put_on_map", "powerline.put_on_map")],
            ["entfernt", stand("powerline.retire", "powerline.retired")],
            ["zurückgeholt", stand("powerline.restore", "powerline.restored")],
            ["eine Rücknahme des Stands", stand("powerline.restore_series", "powerline.retired")],
            [
                "eine Rücknahme der Linie",
                {
                    ...eintrag([geaendert(A1, { name: { before: "A", after: "B" } })]),
                    operation: "powerline.restore_series",
                },
            ],
        ];
        for (const [name, e] of faelle) {
            expect(ruecknahmeFamilie(e), name).toBe("powerline");
            expect(art.ruecknahmeZiel?.(e, A1), name).toEqual({ familie: "powerline", id: A1 });
        }
    });

    it("🔴 B8b: das Anlegen einer Linie hat seither eine Adresse; was der Server hier nicht kennt, nicht: alles am Kraftlinienpunkt (eigene Familie), ein Eintrag aus gemischten Aktionen", () => {
        const art = createKraftlinieVerlaufsArt();
        const angelegt = {
            ...eintrag([{ ...geaendert(A1, {}), action: "powerline.created" }]),
            operation: "powerline.create",
        };
        const punktBewegt: MapHistoryEntry = {
            ...eintrag([
                { kind: "nodix", id: P, action: "nodix.moved", revisionBefore: 1, revisionAfter: 2, changes: {} },
            ]),
            operation: "nodix.move",
        };
        const gemischt: MapHistoryEntry = {
            ...eintrag([
                { ...geaendert(A1, {}), action: "powerline.taken_off_map" },
                { ...geaendert(A2, {}), action: "powerline.retired" },
            ]),
            operation: "powerline.retire",
        };
        expect(ruecknahmeFamilie(angelegt)).toBe("powerline");
        expect(art.ruecknahmeZiel?.(angelegt, A1)).toEqual({ familie: "powerline", id: A1 });
        // Der Kraftlinienpunkt ist eine Familie für sich (Adresse `nodix`), nicht Teil des Verlaufs einer Linie.
        expect(ruecknahmeFamilie(punktBewegt)).toBe("nodix");
        for (const e of [punktBewegt, gemischt]) expect(art.ruecknahmeZiel?.(e, A1), e.operation).toBeUndefined();
    });

    it("🔴 die Adresse des globalen Reiters „Änderungen“: ein Abschnitt der Linie im Eintrag", () => {
        const e = eintrag([geaendert(A2, { labelVisible: { before: true, after: false } })]);
        expect(ruecknahmeZiel(e)).toEqual({ familie: "powerline", id: A2 });
    });

    it("🔴 nahm ↺ den Anker heraus, schreiben Verlauf und Bearbeitung danach unter dem kleinsten Abschnitt, den die Quittung nennt", async () => {
        const urls: string[] = [];
        const fetcher = vi.fn(async (eingabe: RequestInfo | URL) => {
            urls.push(String(eingabe));
            const quittung = {
                operationId: "op",
                status: "applied",
                environment: "test",
                affected: [{ kind: "powerline", id: A2, revision: 7 }],
                derivedWork: [],
                warnings: [],
            };
            return new Response(JSON.stringify(quittung), { status: 200 });
        });
        const folge = { anker: undefined };
        const verlauf = createKraftlinieVerlaufsArt(fetcher, folge);
        const art = createKraftlinieArt(fetcher, folge);
        const e = eintrag([geaendert(A1, {})]);
        expect(verlauf.ruecknahmeZiel?.(e, A1)).toEqual({ familie: "powerline", id: A1 });
        verlauf.nachRuecknahme?.({
            mapRevision: 9,
            affected: [
                { kind: "powerline", id: A2 },
                { kind: "powerline", id: P },
                { kind: "place", id: A1 },
            ],
        });
        expect(folge.anker).toBe(A2);
        // Der Verlauf nennt die Adresse jetzt unter dem neuen Anker, die Bearbeitung schreibt unter ihm.
        expect(verlauf.ruecknahmeZiel?.(e, A1)).toEqual({ familie: "powerline", id: A2 });
        await art.schreibe(A1, { operationId: "op", segments: [{ id: A1, baseRevision: 4, remove: true as const }] });
        expect(urls).toEqual([`/api/editor/powerlines/${A2}/update`]);
    });

    it("die Herkunft von Name und Beschreibung steht nicht als eigene Zeile da; zur Linie gehören nur ihre Abschnitte", () => {
        const art = createKraftlinieVerlaufsArt();
        expect(art.herkunft).toBe("powerline");
        const fremd = eintrag([geaendert("ffffffff-0000-4000-8000-000000000001", { curve: { before: 1, after: 2 } })]);
        expect(art.gehoert(fremd.objects[0]!, LINIE)).toBe(false);
        expect(art.gehoert(geaendert(A2, {}), LINIE)).toBe(true);
        expect(art.url(A1)).toBe(`/api/editor/powerlines/${A1}/history`);
    });

    it("🔴 nach ↺ liest die Bearbeitung den neuen Stand (`neuLesen`), aber nie mitten in einer Bearbeitung", async () => {
        let gelesen: EditorPowerlineDetail = LINIE;
        const fetcher = vi.fn(async () => new Response(JSON.stringify(gelesen), { status: 200 }));
        const sperre = {
            nimm: vi.fn(async (): Promise<NimmErgebnis> => ({ art: "genommen", sperre: {} as never })),
            gib: vi.fn(),
            beiVerlust: () => () => undefined,
        };
        const bearbeitung = createBearbeitung(createKraftlinieArt(fetcher), { id: A1, titel: "Ley", sperre });
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        gelesen = { ...LINIE, name: "Ley", segments: LINIE.segments.map((a) => ({ ...a, revision: a.revision + 1 })) };
        await bearbeitung.neuLesen();
        expect(bearbeitung.detail.value?.name).toBe("Ley");
        expect(bearbeitung.stand.value?.felder.name).toBe("Ley");
        // Mitten in einer Bearbeitung bleibt der Entwurf, wie er ist.
        bearbeitung.feld((f) => ({ ...f, name: "Mein Name" }), "name");
        gelesen = { ...LINIE, name: "Von Thomas" };
        await bearbeitung.neuLesen();
        expect(bearbeitung.detail.value?.name).toBe("Ley");
        expect(bearbeitung.stand.value?.felder.name).toBe("Mein Name");
        bearbeitung.destroy();
    });

    it("🔴 gibt es die Linie beim Neulesen nicht mehr, heißt der Zustand „fehlt“ (wie beim Laden)", async () => {
        let antwort = (): Response => new Response(JSON.stringify(LINIE), { status: 200 });
        const fetcher = vi.fn(async () => antwort());
        const sperre = { nimm: vi.fn(), gib: vi.fn(), beiVerlust: () => () => undefined };
        const bearbeitung = createBearbeitung(createKraftlinieArt(fetcher), { id: A1, titel: "Ley", sperre });
        await vi.waitFor(() => expect(bearbeitung.zustand.value.art).toBe("bereit"));
        antwort = () => new Response("{}", { status: 404 });
        await bearbeitung.neuLesen();
        expect(bearbeitung.zustand.value.art).toBe("fehlt");
        bearbeitung.destroy();
    });
});
