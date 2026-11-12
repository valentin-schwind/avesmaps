import { describe, expect, it, vi } from "vitest";
import type {
    EditorLock,
    EditorLockTarget,
    EditorPowerlineDetail,
    EditorPowerlineTargets,
    OperationReceipt,
    PowerlineUpdateBody,
} from "@avesmaps3d/shared";
import type { NimmErgebnis } from "../src/editor-sperre/sperre";
import { createBearbeitung } from "../src/fenster/bearbeitung";
import { ENTWURF_SCHRITTE } from "../src/fenster/entwurf-kern";
import type { Aenderung, Marke, Teil } from "../src/map/geometrie/geometrie";
import { kraftlinienScheitel } from "../src/map/geometrie/kraftlinie";
import type { GeometrieEingabe, GeometrieModus } from "../src/map/geometrie/modus";
import { createKraftlinieArt } from "../src/kraftlinieneditor/kraftlinie-art";
import { createKraftlinieKurve } from "../src/kraftlinieneditor/kraftlinie-kurve";

/**
 * „Kurve bearbeiten“ am gemeinsamen Entwurf (WI-0205 K8 auf O3; EDIT-0003 T44, T27 (4), (7), §4): die Kurve als Anschluss an die
 * Bearbeitung der Linie, mit echter Bearbeitung und Art, ohne Karte und ohne Server.
 *
 * Problemfälle: Felder und Kurve gehen in zwei Operationen; ↶ nimmt nur Kurvenschritte; die Felder gehen verloren, wenn man die Kurve
 * dazunimmt; die Griffe bleiben nach „Fertig“ oder Esc an; die Sperre eines anderen wird übergangen; ein Ende ins Leere wird ein
 * Schritt (R4); Abhängen verwirft den Entwurf.
 */

const A1 = "a1a1a1a1-0000-4000-8000-000000000001";
const A2 = "a1a1a1a1-0000-4000-8000-000000000002";
const GARETH = "c1c1c1c1-0000-4000-8000-000000000001";
const PUNKT = "c1c1c1c1-0000-4000-8000-000000000002";
const PUNIN = "c1c1c1c1-0000-4000-8000-000000000003";

const LINIE: EditorPowerlineDetail = {
    id: A1,
    name: "Punin–Gareth",
    circle: "voll",
    shape: "strang",
    segments: [
        { id: A1, from: GARETH, to: PUNKT, curve: 12, labelVisible: true, revision: 3 },
        { id: A2, from: PUNKT, to: PUNIN, curve: null, labelVisible: false, revision: 5 },
    ],
    nodes: [
        { id: GARETH, kind: "place", name: "Gareth", x: 100, y: 100, nodix: true, meets: [] },
        { id: PUNKT, kind: "nodix", x: 150, y: 120, nodix: true, meets: [] },
        { id: PUNIN, kind: "place", name: "Punin", x: 200, y: 100, nodix: true, meets: [] },
    ],
};
const ZIELE: EditorPowerlineTargets = { targets: [{ id: GARETH, kind: "place", name: "Gareth", x: 100, y: 100 }] };
const QUITTUNG = {
    operationId: "op",
    status: "applied",
    environment: "test",
    affected: [],
    derivedWork: [],
    warnings: [],
    mapRevision: 42,
} as unknown as OperationReceipt;

function aufbau(optionen: { gesperrt?: boolean } = {}) {
    const gesendet: PowerlineUpdateBody[] = [];
    const fetcher = vi.fn(async (eingabe: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
            gesendet.push(JSON.parse(String(init.body)) as PowerlineUpdateBody);
            return new Response(JSON.stringify(QUITTUNG), { status: 200 });
        }
        return String(eingabe).endsWith(`/${A1}`)
            ? new Response(JSON.stringify(LINIE), { status: 200 })
            : new Response("{}", { status: 404 });
    });
    const genommen: string[] = [];
    const freigegeben: string[] = [];
    const sperre = {
        nimm: vi.fn(async (ziel: EditorLockTarget, teil: EditorLock["part"]): Promise<NimmErgebnis> => {
            genommen.push(`${ziel.kind}:${teil}`);
            const lock = {
                kind: "powerline",
                id: A1,
                part: teil,
                person: { id: "p2", name: "Thomas" },
                since: "2026-10-17T10:00:00Z",
                heartbeatAt: "2026-10-17T10:00:00Z",
                own: false,
            } as EditorLock;
            return optionen.gesperrt === true
                ? { art: "gesperrt", sperre: lock }
                : { art: "genommen", sperre: { ...lock, own: true } };
        }),
        gib: vi.fn((ziel: EditorLockTarget) => void freigegeben.push(ziel.id)),
        beiVerlust: () => () => undefined,
    };
    let nr = 0;
    const bearbeitung = createBearbeitung(createKraftlinieArt(fetcher), {
        id: A1,
        titel: "Punin–Gareth",
        sperre,
        neueKennung: () => `op-${String((nr += 1))}`,
    });
    const modus = {
        aktualisiere: vi.fn(),
        markiere: vi.fn<(m: readonly Marke[]) => void>(),
        sperre: vi.fn<(an: boolean) => void>(),
        abbrechen: vi.fn(() => false),
        aus: vi.fn(),
    } satisfies GeometrieModus;
    let eingabe: GeometrieEingabe | undefined;
    const meldungen: string[] = [];
    const karte = {
        ein: vi.fn((e: GeometrieEingabe) => {
            eingabe = e;
            return modus;
        }),
        zeige: vi.fn(),
    };
    const kurve = createKraftlinieKurve({
        ziele: vi.fn(async () => ZIELE),
        karte,
        fangradius: () => 10,
        melde: (art) => void meldungen.push(art),
    });
    const teil = (id: string): Teil => eingabe!.teile().find((t) => t.objekt === id)!;
    return {
        bearbeitung,
        kurve,
        modus,
        karte,
        gesendet,
        genommen,
        freigegeben,
        meldungen,
        teil,
        eingabe: () => eingabe!,
    };
}

const steuern = (t: Teil, wert: number): Aenderung => ({
    art: "steuern",
    stelle: { objekt: t.objekt, nr: 0, index: -1 },
    teile: [{ ...t, wert }],
    mitgezogen: [],
    treffer: undefined,
    getrennt: false,
});

describe("Kurve bearbeiten am gemeinsamen Entwurf", () => {
    it("🔴 die Kamera holt auch den Scheitel jedes Abschnitts in die freie Karte, nicht nur die Enden (ein Griff wie sie)", async () => {
        const w = aufbau();
        await vi.waitFor(() => expect(w.bearbeitung.zustand.value.art).toBe("bereit"));
        await w.kurve.starte(w.bearbeitung);
        const teile = w.karte.zeige.mock.calls.at(-1)?.[0] as readonly {
            punkte: readonly { x: number; y: number }[];
        }[];
        const punkte = teile.flatMap((t) => t.punkte);
        const gebogen = kraftlinienScheitel({ x: 100, y: 100 }, { x: 150, y: 120 }, 12);
        expect(punkte).toContainEqual(gebogen);
        expect(punkte).toContainEqual({ x: 175, y: 110 });
        expect(punkte).toContainEqual({ x: 100, y: 100 });
    });

    it("🔴 Felder, dann die Kurve: EIN Entwurf, ↶ nimmt den jüngsten Schritt jeder Art, „Fertig“ schreibt EINE Operation", async () => {
        const w = aufbau();
        await vi.waitFor(() => expect(w.bearbeitung.zustand.value.art).toBe("bereit"));
        w.bearbeitung.feld((f) => ({ ...f, description: "Eine Ader." }), "description");
        w.bearbeitung.feldVerlassen();
        await w.kurve.starte(w.bearbeitung);
        expect(w.karte.ein).toHaveBeenCalledOnce();
        expect(w.kurve.laufend.value).toBe(w.bearbeitung);
        // Die Felder bleiben; die Sperre geht von `felder` auf `form`.
        expect(w.bearbeitung.stand.value?.felder.description).toBe("Eine Ader.");
        await vi.waitFor(() => expect(w.genommen).toEqual(["powerline:felder", "powerline:form"]));
        w.eingabe().handbewegung(steuern(w.teil(A2), -20));
        expect(w.bearbeitung.lage.value.ungespeichert).toBe(2);
        // ↶ nimmt den Bogen, ↶ dann das Feld; ↷ ↷ bringt beides wieder.
        w.bearbeitung.zurueck();
        expect(w.teil(A2).wert).toBeUndefined();
        w.bearbeitung.zurueck();
        expect(w.bearbeitung.stand.value?.felder.description).toBe("");
        w.bearbeitung.wieder();
        w.bearbeitung.wieder();
        expect(w.modus.aktualisiere).toHaveBeenCalled();
        await w.bearbeitung.fertig();
        expect(w.gesendet).toEqual([
            {
                operationId: "op-1",
                segments: [
                    { id: A1, baseRevision: 3 },
                    { id: A2, baseRevision: 5, curve: -20 },
                ],
                description: "Eine Ader.",
            },
        ]);
        expect(w.bearbeitung.zustand.value).toMatchObject({ art: "gespeichert", mapRevision: 42 });
        // Geschrieben: Griffe aus, Sperre frei.
        expect(w.modus.aus).toHaveBeenCalledOnce();
        expect(w.kurve.laufend.value).toBeUndefined();
        expect(w.freigegeben).toEqual([A1]);
    });

    it("🔴 ein Ende ins Leere ist kein Schritt (R4), ein Hinweis sagt es; bis 20 Schritte zurück", async () => {
        const w = aufbau();
        await w.kurve.starte(w.bearbeitung);
        const t = w.teil(A1);
        w.eingabe().handbewegung({
            art: "ziehen",
            stelle: { objekt: A1, nr: 0, index: 1 },
            teile: [{ ...t, punkte: [t.punkte[0]!, { x: 170, y: 170 }] }],
            mitgezogen: [],
            treffer: undefined,
            getrennt: false,
        });
        expect(w.bearbeitung.lage.value.ungespeichert).toBe(0);
        expect(w.meldungen).toEqual(["kein-ziel"]);
        for (let i = 1; i <= ENTWURF_SCHRITTE + 3; i += 1) w.eingabe().handbewegung(steuern(w.teil(A1), i));
        let zurueck = 0;
        while (w.bearbeitung.lage.value.zurueck) {
            w.bearbeitung.zurueck();
            zurueck += 1;
        }
        expect(zurueck).toBe(ENTWURF_SCHRITTE);
        expect(w.teil(A1).wert).toBe(3);
    });

    it("🔴 Esc fragt bei Ungeschriebenem, das zweite verwirft und endet; „Verwerfen“ lässt den Modus (F20)", async () => {
        const w = aufbau();
        await w.kurve.starte(w.bearbeitung);
        w.eingabe().handbewegung(steuern(w.teil(A1), 30));
        w.bearbeitung.verwerfen();
        expect(w.teil(A1).wert).toBe(12);
        expect(w.kurve.laufend.value).toBe(w.bearbeitung);
        w.eingabe().handbewegung(steuern(w.teil(A1), 30));
        expect(w.bearbeitung.esc()).toBe(true);
        expect(w.bearbeitung.lage.value.frage).toBe(true);
        expect(w.modus.aus).not.toHaveBeenCalled();
        expect(w.bearbeitung.esc()).toBe(true);
        expect(w.modus.aus).toHaveBeenCalledOnce();
        expect(w.kurve.laufend.value).toBeUndefined();
        expect(w.bearbeitung.lage.value.aktiv).toBe(false);
        expect(w.gesendet).toEqual([]);
    });

    it("🔴 hält ein anderer die Linie, gehen die Griffe gleich wieder aus, und der Fuß nennt ihn", async () => {
        const w = aufbau({ gesperrt: true });
        await w.kurve.starte(w.bearbeitung);
        await vi.waitFor(() => expect(w.bearbeitung.zustand.value).toMatchObject({ art: "gesperrt", wer: "Thomas" }));
        expect(w.modus.aus).toHaveBeenCalledOnce();
        expect(w.kurve.laufend.value).toBeUndefined();
    });

    it("🔴 Nodix herausnehmen und anfügen hängen die Kurve an und sind Schritte im EINEN Entwurf; „Fertig“ schreibt EINE Operation", async () => {
        const w = aufbau();
        await vi.waitFor(() => expect(w.bearbeitung.zustand.value.art).toBe("bereit"));
        expect(await w.kurve.nimmHeraus(w.bearbeitung, PUNKT)).toBe("ok");
        expect(w.kurve.laufend.value).toBe(w.bearbeitung);
        expect(await w.kurve.fuegeAn(w.bearbeitung, PUNIN, GARETH)).toBe("ok");
        expect(w.bearbeitung.lage.value.ungespeichert).toBe(2);
        w.bearbeitung.zurueck();
        expect(w.bearbeitung.lage.value.ungespeichert).toBe(1);
        w.bearbeitung.wieder();
        await w.bearbeitung.fertig();
        expect(w.gesendet).toEqual([
            {
                operationId: "op-1",
                segments: [
                    { id: A1, baseRevision: 3, to: PUNIN },
                    { id: A2, baseRevision: 5, remove: true },
                ],
                add: [{ from: PUNIN, to: GARETH }],
            },
        ]);
    });

    it("Abhängen (Fenster abgelegt) schaltet die Griffe aus und lässt den Entwurf stehen", async () => {
        const w = aufbau();
        await w.kurve.starte(w.bearbeitung);
        w.eingabe().handbewegung(steuern(w.teil(A1), 30));
        w.kurve.haengeAb();
        expect(w.modus.aus).toHaveBeenCalledOnce();
        expect(w.bearbeitung.lage.value).toMatchObject({ aktiv: true, form: false, ungespeichert: 1 });
        expect(w.bearbeitung.stand.value?.form?.teile[0]?.wert).toBe(30);
    });
});
