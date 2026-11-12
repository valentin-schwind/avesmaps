import { describe, expect, it, vi, type Mock } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { LandscapeBooleanPreview, OperationReceipt, SpracheEditorListe } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import { t } from "../src/i18n/i18n";
import { createMitAnderer } from "../src/landschaftseditor/mit-anderer-flaeche";
import { createUnterflaechen } from "../src/landschaftseditor/unterflaechen";
import type { FlaechenSofort } from "../src/map/geometrie/flaechen-quelle";
import type { InteractionOwner, MapInteractionCoordinator } from "../src/map/interaction/types";
import { SPRACHE_FILL_LAYER_ID } from "../src/map/sprachen-layers";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { createSpracheditorSteuerung } from "../src/spracheditor/spracheditor-steuerung";
import type { SprachenDaten } from "../src/spracheditor/sprachen-daten";
import { NEUE_FARBE } from "../src/spracheditor/sprache-felder";
import { NEUE_SPRACHE, sprachKopierPlan, START_WAHL, zielSprachen } from "../src/spracheditor/sprachflaeche-kopieren";
import { sprachflaecheSofort, type SprachflaecheSofortOptionen } from "../src/spracheditor/sprachflaeche-sofort";
import {
    createSpracheVerlaufsArt,
    sprachVerlaufFeldName,
    sprachVerlaufWert,
} from "../src/spracheditor/sprache-verlauf";

/**
 * Die Werkzeuge der Stufe 3 an einer Teilfläche einer Sprache (WI-0261; Betreiber 2026-10-31: „bau weiter“): dieselben Modi wie an der Derographie mit der
 * Teilfläche als Quelle (`sprachflaeche-sofort.ts`), dazu das Blatt „Fläche kopieren“. Problemfälle: Ein Ziel von „Mit anderer Fläche“ ist eine Teilfläche
 * derselben Sprache oder eine aus der Derographie; geschrieben wird ohne die Sperre der Sprache, oder ohne die der anderen, deren Teilfläche stillgelegt wird;
 * ein Fehler ohne Verbindung sieht aus wie ein Satz des Servers; „Alle Unterflächen vereinigen“ hält eine einzelne Teilfläche fest, obwohl die Sprache
 * zusammenhängende hat; die Meldung spricht von einer Landschaft; das Blatt kopiert in die eigene, eine stillgelegte oder eine geratene Sprache.
 *
 * „Unterfläche löschen …“ an einer Sprache fragt nach (Betreiber 2026-10-31: „Ja, nachfragen“): Problemfälle: Es wird geschrieben, bevor die Antwort da ist, oder
 * trotz „Abbrechen“; eine andere Operation fragt auch; die Frage steht nicht an der Sprache mit der Teilfläche gewählt; eine offene Frage bleibt ohne Antwort
 * hängen (Esc, eine neue Frage) und der Modus wartet ewig.
 */

const GARETHI = "5d2c0000-0000-4000-8000-000000000001";
const ORKISCH = "5d2c0000-0000-4000-8000-000000000002";
const TEIL = "5d2c0000-0000-4000-8000-0000000000f1";
const EIGENE = "5d2c0000-0000-4000-8000-0000000000f3";
const FREMD_KLEIN = "5d2c0000-0000-4000-8000-0000000000f4";
const FREMD_GROSS = "5d2c0000-0000-4000-8000-0000000000f5";

const QUITTUNG: OperationReceipt = {
    operationId: "op",
    status: "applied",
    environment: "test",
    affected: [{ kind: "sprache", id: GARETHI, revision: 2 }],
    derivedWork: [],
    warnings: [],
    mapRevision: 21,
} as OperationReceipt;

const QUITTUNG_MIT = (vorher: number, nachher: number) => ({ ...QUITTUNG, partsBefore: vorher, partsAfter: nachher });

const quadrat = (x0: number, y0: number, x1: number, y1: number): [number, number][][] => [
    [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ],
];

function quelleBau(
    ueber: Partial<SprachflaecheSofortOptionen["daten"]> = {},
    frageLoeschen: SprachflaecheSofortOptionen["frageLoeschen"] = vi.fn(async () => true),
) {
    const unter = vi.fn(async (_id: string, schreibe: () => Promise<unknown>) => schreibe());
    const daten = {
        form: vi.fn(async () => ({
            id: TEIL,
            sprache: GARETHI,
            revision: 5,
            herkunft: "redaktion" as const,
            quelleRevision: null,
            aktiv: true,
            polygons: [quadrat(0, 0, 10, 10)],
        })),
        flaecheTeile: vi.fn(async () => ({
            ok: true as const,
            quittung: { ...QUITTUNG, partsBefore: 3, partsAfter: 1 },
        })),
        flaecheSchneiden: vi.fn(async () => ({ ok: true as const, quittung: QUITTUNG })),
        flaecheVorschau: vi.fn(async () => ({ ok: true as const, quittung: {} as LandscapeBooleanPreview })),
        flaecheVerknuepfen: vi.fn(async () => ({ ok: true as const, quittung: QUITTUNG })),
        ...ueber,
    };
    const geschrieben = vi.fn();
    const melde = vi.fn();
    const quelle = sprachflaecheSofort(
        { daten, sperre: { unter } as never, werkzeug: "spracheditor", geschrieben, melde, frageLoeschen },
        { id: GARETHI, flaecheId: TEIL, name: "Garethi · Teilfläche 1", spracheName: "Garethi" },
    );
    return { quelle, daten, unter, geschrieben, melde, frageLoeschen };
}

const feature = (sprache: string, teil: string, area: number) => ({
    properties: { sprache_public_id: sprache, public_id: teil, area, schluessel: "x", name: "X" },
});

describe("Die Teilfläche einer Sprache als Quelle der sofort schreibenden Werkzeuge", () => {
    it("🔴 Ziele nur aus der Ebene der Sprachen, nur Teilflächen ANDERER Sprachen, bei mehreren die kleinste", () => {
        const { quelle } = quelleBau();
        expect(quelle.zielEbenen()).toEqual([SPRACHE_FILL_LAYER_ID]);
        expect(
            quelle.ziel(
                [
                    feature(GARETHI, EIGENE, 1),
                    feature(GARETHI, TEIL, 1),
                    feature(ORKISCH, FREMD_GROSS, 900),
                    feature(ORKISCH, FREMD_KLEIN, 40),
                ],
                TEIL,
            ),
        ).toBe(FREMD_KLEIN);
        // Nur die eigene Sprache darunter (oder eine Fläche ohne Sprache, etwa aus der Derographie): kein Ziel.
        expect(quelle.ziel([feature(GARETHI, EIGENE, 1), { properties: { public_id: "wald" } }], TEIL)).toBeUndefined();
        // Die Kennung kann auch nur die Feature-Id sein (`promoteId`).
        expect(quelle.ziel([{ id: FREMD_GROSS, properties: { sprache_public_id: ORKISCH, area: 5 } }], TEIL)).toBe(
            FREMD_GROSS,
        );
    });

    it("🔴 jeder Schreibweg unter der Sperre der Sprache; legt „Mit anderer Fläche“ die andere still, auch unter der ihrer Sprache", async () => {
        const { quelle, unter, daten } = quelleBau();
        const teile = await quelle.teile(GARETHI, TEIL, {
            operationId: "o1",
            operation: "vereinigen",
            baseRevision: 5,
        });
        expect(teile).toMatchObject({ ok: true, wert: { partsBefore: 3, partsAfter: 1 } });
        expect(unter.mock.calls.map(([id]) => id)).toEqual([GARETHI]);
        expect(daten.flaecheTeile).toHaveBeenCalledWith(GARETHI, TEIL, {
            operationId: "o1",
            operation: "vereinigen",
            baseRevision: 5,
        });
        unter.mockClear();
        await quelle.schneide(GARETHI, TEIL, {
            operationId: "o2",
            baseRevision: 5,
            line: [
                [0, 0],
                [1, 1],
            ],
        });
        expect(unter.mock.calls.map(([id]) => id)).toEqual([GARETHI]);

        // Das Ziel merkt sich seine Sprache beim Zeigen.
        quelle.ziel([feature(ORKISCH, FREMD_KLEIN, 40)], TEIL);
        unter.mockClear();
        const body = { operationId: "o3", baseRevision: 5, targetAreaId: FREMD_KLEIN, targetBaseRevision: 2 };
        await quelle.verknuepfe(GARETHI, TEIL, { ...body, operation: "vereinigen" });
        expect(unter.mock.calls.map(([id]) => id)).toEqual([GARETHI, ORKISCH]);
        unter.mockClear();
        await quelle.verknuepfe(GARETHI, TEIL, { ...body, operation: "schnittmenge" });
        expect(unter.mock.calls.map(([id]) => id)).toEqual([GARETHI]);
        // Die Vorschau schreibt nicht und nimmt keine Sperre.
        unter.mockClear();
        const signal = new AbortController().signal;
        await quelle.vorschau(GARETHI, TEIL, { operation: "vereinigen", targetAreaId: FREMD_KLEIN }, signal);
        expect(unter).not.toHaveBeenCalled();
        expect(daten.flaecheVorschau).toHaveBeenCalledWith(
            GARETHI,
            TEIL,
            { operation: "vereinigen", targetAreaId: FREMD_KLEIN },
            signal,
        );
    });

    it("🔴 eine fremde Sperre und ein Satz des Servers kommen als Satz; ohne Verbindung wirft es (der Modus sagt „nichts ist geschrieben“)", async () => {
        const { quelle, unter } = quelleBau({
            flaecheSchneiden: vi.fn(async () => ({
                ok: false as const,
                status: 0,
                fehler: { code: "network_error", message: "Keine Verbindung zum Server." },
            })),
            flaecheTeile: vi.fn(async () => ({
                ok: false as const,
                status: 400,
                fehler: { code: "validation_failed", message: "Diese Fläche besteht nur aus einer Unterfläche." },
            })),
        });
        await expect(
            quelle.teile(GARETHI, TEIL, { operationId: "o", operation: "vereinigen", baseRevision: 5 }),
        ).resolves.toEqual({ ok: false, satz: "Diese Fläche besteht nur aus einer Unterfläche." });
        await expect(
            quelle.schneide(GARETHI, TEIL, {
                operationId: "o",
                baseRevision: 5,
                line: [
                    [0, 0],
                    [1, 1],
                ],
            }),
        ).rejects.toThrow();
        unter.mockImplementationOnce(async () => ({ art: "gesperrt", sperre: { person: { name: "Anna" } } }) as never);
        const gesperrt = await quelle.teile(GARETHI, TEIL, {
            operationId: "o",
            operation: "vereinigen",
            baseRevision: 5,
        });
        expect(gesperrt.ok).toBe(false);
        expect(!gesperrt.ok && gesperrt.satz).toContain("Anna");
    });

    it("lesen: die Form der Teilfläche unter dem Namen der Leiste; stillgelegt oder fehlend gibt es sie nicht; ein Lesefehler ist ein Satz", async () => {
        const { quelle } = quelleBau();
        await expect(quelle.lies(GARETHI, TEIL)).resolves.toEqual({
            ok: true,
            wert: { name: "Garethi · Teilfläche 1", teile: [quadrat(0, 0, 10, 10)], revision: 5 },
        });
        const weg = quelleBau({ form: vi.fn(async () => null) }).quelle;
        await expect(weg.lies(GARETHI, TEIL)).resolves.toEqual({ ok: true, wert: undefined });
        const fehler = quelleBau({
            form: vi.fn(async () => {
                throw new ApiFailure(500, "unavailable", "Kaputt.");
            }),
        }).quelle;
        await expect(fehler.lies(GARETHI, TEIL)).resolves.toEqual({ ok: false, satz: "Kaputt." });
        const offline = quelleBau({
            form: vi.fn(async () => {
                throw new ApiFailure(0, "network", "Keine Verbindung zum Server.");
            }),
        }).quelle;
        await expect(offline.lies(GARETHI, TEIL)).rejects.toThrow();
    });

    it("🔴 geschrieben: die Seite liest nach mit der Teilfläche gewählt; nach „Mit anderer Fläche“ „gespeichert“ mit dem Namen der Sprache; Sätze von Teilflächen", () => {
        const { quelle, geschrieben, melde } = quelleBau();
        quelle.geschrieben(QUITTUNG, "zerschneiden");
        expect(geschrieben).toHaveBeenLastCalledWith(QUITTUNG, GARETHI, TEIL);
        expect(melde).not.toHaveBeenCalled();
        quelle.geschrieben(QUITTUNG, "mitAnderer");
        expect(melde).toHaveBeenCalledWith(expect.stringContaining("Garethi"), "success");
        expect(quelle.vereinigtMitAnderen).toBe(true);
        expect(quelle.saetze).toEqual({
            herausgeloest: "spracheditor.unterflaechen.herausgeloest",
            geschnitten: "spracheditor.zerschneiden.geschnitten",
        });
    });
});

/** Eine Karte und ein Koordinator ohne MapLibre, für die Modi der Derographie. */
function karte() {
    let owner: InteractionOwner | undefined;
    const interaction = {
        register: (o: InteractionOwner) => {
            owner = o;
            return () => {
                owner = undefined;
            };
        },
    } as unknown as MapInteractionCoordinator;
    const quellen = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    const map = {
        addSource: (id: string) => quellen.set(id, { setData: vi.fn() }),
        getSource: (id: string) => quellen.get(id),
        removeSource: (id: string) => quellen.delete(id),
        addLayer: vi.fn(),
        getLayer: () => ({}),
        removeLayer: vi.fn(),
    } as unknown as MapLibreMap;
    return { map, interaction, owner: () => owner };
}

/** Eine Quelle zum Mitschreiben: Die Modi dürfen nur über sie lesen und schreiben. */
function falscheQuelle(
    teile: [number, number][][][],
): FlaechenSofort & { readonly geschrieben: Mock<FlaechenSofort["geschrieben"]> } {
    return {
        werkzeug: "spracheditor",
        lies: vi.fn(async () => ({ ok: true as const, wert: { name: "Garethi · Teilfläche 1", teile, revision: 5 } })),
        teile: vi.fn(async () => ({ ok: true as const, wert: { ...QUITTUNG, partsBefore: 2, partsAfter: 1 } })),
        schneide: vi.fn(async () => ({ ok: true as const, wert: QUITTUNG })),
        vorschau: vi.fn(async () => ({
            ok: true as const,
            wert: {
                polygons: [],
                targetPolygons: [],
                areaRevision: 5,
                targetAreaRevision: 2,
                targetName: "Orkisch",
                consumesTarget: true,
                targetLandscapeGoes: false,
            },
        })),
        verknuepfe: vi.fn(async () => ({ ok: true as const, wert: QUITTUNG })),
        zielEbenen: () => [SPRACHE_FILL_LAYER_ID],
        ziel: (features) => {
            const id = features[0]?.properties["public_id"];
            return typeof id === "string" ? id : undefined;
        },
        geschrieben: vi.fn<FlaechenSofort["geschrieben"]>(),
        vereinigtMitAnderen: true,
        saetze: {
            herausgeloest: "spracheditor.unterflaechen.herausgeloest",
            geschnitten: "spracheditor.zerschneiden.geschnitten",
        },
    };
}

describe("„Unterfläche löschen …“ fragt an der Sprache nach", () => {
    const loeschen = { operationId: "o", operation: "loeschen" as const, baseRevision: 5, part: 1 };

    it("🔴 bestätigt: erst die Frage zu genau dieser Unterfläche, dann EIN Schreibweg unter der Sperre", async () => {
        let antworte: (ja: boolean) => void = () => undefined;
        const frage = vi.fn(() => new Promise<boolean>((ja) => (antworte = ja)));
        const { quelle, daten, unter } = quelleBau({}, frage);
        const laeuft = quelle.teile(GARETHI, TEIL, loeschen);
        await Promise.resolve();
        expect(frage).toHaveBeenCalledWith(GARETHI, TEIL, 1);
        // Solange die Antwort fehlt, ist nichts geschrieben und keine Sperre genommen.
        expect(daten.flaecheTeile).not.toHaveBeenCalled();
        expect(unter).not.toHaveBeenCalled();
        antworte(true);
        await expect(laeuft).resolves.toMatchObject({ ok: true });
        expect(daten.flaecheTeile).toHaveBeenCalledTimes(1);
        expect(daten.flaecheTeile).toHaveBeenCalledWith(GARETHI, TEIL, loeschen);
        expect(unter.mock.calls.map(([id]) => id)).toEqual([GARETHI]);
    });

    it("🔴 abgebrochen: kein Schreibweg, keine Sperre; der ruhige Satz, und der Modus steht wieder bei der Wahl", async () => {
        const { quelle, daten, unter } = quelleBau(
            {},
            vi.fn(async () => false),
        );
        await expect(quelle.teile(GARETHI, TEIL, loeschen)).resolves.toEqual({
            ok: false,
            satz: t("spracheditor.unterflaechen.bleibt"),
        });
        expect(daten.flaecheTeile).not.toHaveBeenCalled();
        expect(unter).not.toHaveBeenCalled();
    });

    it("nur „löschen“ fragt: vereinigen und herauslösen schreiben ohne Frage", async () => {
        const frage = vi.fn(async () => false);
        const { quelle, daten } = quelleBau({}, frage);
        await quelle.teile(GARETHI, TEIL, { operationId: "a", operation: "vereinigen", baseRevision: 5 });
        await quelle.teile(GARETHI, TEIL, { operationId: "b", operation: "herausloesen", baseRevision: 5, part: 0 });
        expect(frage).not.toHaveBeenCalled();
        expect(daten.flaecheTeile).toHaveBeenCalledTimes(2);
    });

    it("🔴 die Frage steht an der Sprache mit der Teilfläche gewählt (G3); Esc und eine neue Frage antworten der offenen mit nein", async () => {
        const daten = {
            liste: vi.fn(async () => ({ zeilen: [] })),
            sprache: vi.fn(async () => null),
        } as unknown as SprachenDaten;
        const steuerung = createSpracheditorSteuerung(createWerkzeugfenster(undefined), daten);
        const erste = steuerung.frageUnterflaeche({ sprache: GARETHI, flaeche: TEIL, teil: 1 });
        expect(steuerung.auswahl.value).toBe(GARETHI);
        expect(steuerung.flaecheWunsch.value).toMatchObject({ sprache: GARETHI, flaeche: TEIL, frage: false });
        expect(steuerung.unterFrage.value).toEqual({ sprache: GARETHI, flaeche: TEIL, teil: 1 });
        steuerung.antworteUnterflaeche(true);
        await expect(erste).resolves.toBe(true);
        expect(steuerung.unterFrage.value).toBeUndefined();

        const zweite = steuerung.frageUnterflaeche({ sprache: GARETHI, flaeche: TEIL, teil: 0 });
        const dritte = steuerung.frageUnterflaeche({ sprache: ORKISCH, flaeche: EIGENE, teil: 2 });
        await expect(zweite).resolves.toBe(false);
        expect(steuerung.unterFrage.value?.sprache).toBe(ORKISCH);
        expect(steuerung.esc()).toBe(true);
        await expect(dritte).resolves.toBe(false);
        expect(steuerung.unterFrage.value).toBeUndefined();

        const offen = steuerung.frageUnterflaeche({ sprache: GARETHI, flaeche: TEIL, teil: 1 });
        steuerung.destroy();
        await expect(offen).resolves.toBe(false);
    });
});

describe("Die Modi der Derographie mit der Quelle der Sprache", () => {
    const warte = () => new Promise((fertig) => setTimeout(fertig, 0));
    const landschaft = vi.fn(async () => new Response("{}", { status: 500 }));
    const seite = (k: ReturnType<typeof karte>, melde = vi.fn()) => ({
        karte: () => ({ map: k.map, interaction: k.interaction }),
        geschrieben: vi.fn(),
        melde,
        fetcher: landschaft as unknown as typeof fetch,
    });

    it("🔴 „Alle Unterflächen vereinigen“ an einer Teilfläche aus einem Stück fragt den Server (die Sprache nimmt zusammenhängende Teilflächen mit)", async () => {
        const k = karte();
        const melde = vi.fn();
        const modus = createUnterflaechen(seite(k, melde));
        const quelle = falscheQuelle([quadrat(0, 0, 10, 10)]);
        await modus.vereinige({ regionId: GARETHI, areaId: TEIL }, quelle);
        expect(quelle.teile).toHaveBeenCalledWith(
            GARETHI,
            TEIL,
            expect.objectContaining({ operation: "vereinigen", baseRevision: 5 }),
        );
        expect(quelle.geschrieben).toHaveBeenCalledWith(QUITTUNG_MIT(2, 1), "unterflaechen");
        expect(melde).toHaveBeenCalledWith(expect.any(String), "success");
        expect(landschaft).not.toHaveBeenCalled();
    });

    it("🔴 herauslösen an der Sprache: dieselbe Wahl, geschrieben über die Quelle, der Satz der Sprache", async () => {
        const k = karte();
        const melde = vi.fn();
        const modus = createUnterflaechen(seite(k, melde));
        const quelle = falscheQuelle([quadrat(0, 0, 10, 10), quadrat(20, 0, 30, 10)]);
        await modus.starte(
            { regionId: GARETHI, areaId: TEIL, operation: "herausloesen", punkt: { x: 25, y: 5 } },
            quelle,
        );
        expect(modus.laufend.value).toMatchObject({ gewaehlt: 1, name: "Garethi · Teilfläche 1" });
        await modus.bestaetige();
        expect(quelle.teile).toHaveBeenCalledWith(
            GARETHI,
            TEIL,
            expect.objectContaining({ operation: "herausloesen", part: 1 }),
        );
        expect(melde).toHaveBeenLastCalledWith(expect.stringMatching(/Teilfläche|sub-area/i), "success");
        expect(melde.mock.calls.at(-1)?.[0]).not.toMatch(/Landschaft|landscape/i);
        expect(landschaft).not.toHaveBeenCalled();
    });

    it("🔴 „Mit anderer Fläche“: Ziele aus der Ebene der Quelle, geschrieben über sie gegen die Revisionen der Vorschau", async () => {
        const k = karte();
        const modus = createMitAnderer({ ...seite(k), flaechenEbenen: () => ["landscape-fill-vegetation"] });
        const quelle = falscheQuelle([quadrat(0, 0, 10, 10)]);
        modus.starte(
            { regionId: GARETHI, areaId: TEIL, name: "Garethi · Teilfläche 1", operation: "vereinigen" },
            quelle,
        );
        const unter = {
            features: (ebenen: string[]) =>
                ebenen.includes(SPRACHE_FILL_LAYER_ID) ? [feature(ORKISCH, FREMD_KLEIN, 4)] : [],
        };
        k.owner()!.apply("click", {}, unter as never);
        await warte();
        await warte();
        expect(quelle.vorschau).toHaveBeenCalledWith(
            GARETHI,
            TEIL,
            { operation: "vereinigen", targetAreaId: FREMD_KLEIN },
            expect.anything(),
        );
        k.owner()!.apply("click", {}, unter as never);
        await warte();
        await warte();
        expect(quelle.verknuepfe).toHaveBeenCalledWith(GARETHI, TEIL, {
            operationId: expect.any(String),
            operation: "vereinigen",
            baseRevision: 5,
            targetAreaId: FREMD_KLEIN,
            targetBaseRevision: 2,
        });
        expect(quelle.geschrieben).toHaveBeenCalledWith(QUITTUNG, "mitAnderer");
        expect(modus.laufend.value).toBeUndefined();
        expect(landschaft).not.toHaveBeenCalled();
    });
});

describe("Das Blatt „Fläche kopieren“ an einer Sprache", () => {
    const zeilen = [
        { art: "sprache", id: ORKISCH, name: "Orkisch", aktiv: true },
        { art: "sprache", id: GARETHI, name: "Garethi", aktiv: true },
        { art: "sprache", id: "still", name: "Alt-Bosparano", aktiv: false },
        { art: "artikel", id: "artikel", titel: "Tulamidya" },
        { art: "sprache", id: "atak", name: "Atak", aktiv: true },
    ] as unknown as SpracheEditorListe["zeilen"];

    it("🔴 Ziele: andere aktive Sprachen nach Namen; ohne gewähltes Ziel kopiert es nicht", () => {
        expect(zielSprachen(zeilen, GARETHI, "de").map((ziel) => ziel.name)).toEqual(["Atak", "Orkisch"]);
        expect(sprachKopierPlan(START_WAHL)).toEqual({ fehler: "spracheditor.kopieren.zielFehlt" });
        expect(sprachKopierPlan({ ziel: ORKISCH, name: "", loeschen: true })).toEqual({
            ziel: { targetId: ORKISCH, deleteSource: true },
        });
    });

    it("🔴 „Neue Sprache …“: der Name ist Pflicht wie bei „✚ Neue Sprache“ (getrimmt), die Farbe die Vorgabe neuer Sprachen", () => {
        expect(sprachKopierPlan({ ziel: NEUE_SPRACHE, name: "   ", loeschen: false })).toEqual({
            fehler: "spracheditor.grund.name",
        });
        expect(sprachKopierPlan({ ziel: NEUE_SPRACHE, name: "  Neu-Garethi ", loeschen: true })).toEqual({
            ziel: { neueSprache: { name: "Neu-Garethi", farbe: NEUE_FARBE }, deleteSource: true },
        });
    });

    it("🔴 „Kopieren“: EINE Operation unter den Sperren beider Sprachen; danach das Fenster an der Zielsprache mit der Kopie gewählt", async () => {
        const kopie = "5d2c0000-0000-4000-8000-0000000000c1";
        const flaecheKopieren = vi.fn(async () => ({ ok: true as const, quittung: { ...QUITTUNG, flaecheId: kopie } }));
        const daten = {
            liste: vi.fn(async () => ({ zeilen: [] })),
            sprache: vi.fn(async () => null),
            flaecheKopieren,
        } as unknown as SprachenDaten;
        const unter = vi.fn(async (_id: string, schreibe: () => Promise<unknown>) => schreibe());
        const geaendert = vi.fn();
        const steuerung = createSpracheditorSteuerung(createWerkzeugfenster(undefined), daten, undefined, {
            sperre: {
                unter,
                haelt: () => false,
                halter: () => ({
                    nimm: vi.fn(async () => ({ art: "fehler", fehler: new ApiFailure(0, "network", "") })),
                    gib: vi.fn(),
                    beiVerlust: () => () => undefined,
                    liste: async () => [],
                }),
            } as never,
            lauf: "lauf",
            geaendert,
            darfSchreiben: () => true,
        } as never);
        const ergebnis = await steuerung.kopiere(
            GARETHI,
            { id: TEIL, revision: 5 },
            { targetId: ORKISCH, deleteSource: true },
        );
        expect(ergebnis).toMatchObject({ ok: true, id: kopie, mapRevision: 21 });
        expect(unter.mock.calls.map(([id]) => id)).toEqual([GARETHI, ORKISCH]);
        expect(flaecheKopieren).toHaveBeenCalledWith(GARETHI, TEIL, {
            operationId: expect.any(String),
            baseRevision: 5,
            targetId: ORKISCH,
            deleteSource: true,
        });
        expect(geaendert).toHaveBeenCalledWith(21);
        expect(steuerung.auswahl.value).toBe(ORKISCH);
        expect(steuerung.flaecheWunsch.value).toMatchObject({ sprache: ORKISCH, flaeche: kopie, frage: false });
        steuerung.destroy();
    });

    it("🔴 in eine NEUE Sprache: nur die Sperre der Quelle, EIN Schreibweg mit `neueSprache`; danach die Liste neu und das Fenster an der neuen Sprache mit der Kopie", async () => {
        const kopie = "5d2c0000-0000-4000-8000-0000000000c2";
        const neu = "5d2c0000-0000-4000-8000-000000000009";
        const flaecheKopieren = vi.fn(async () => ({
            ok: true as const,
            quittung: { ...QUITTUNG, flaecheId: kopie, spracheId: neu },
        }));
        const liste = vi.fn(async () => ({ zeilen: [] }));
        const daten = { liste, sprache: vi.fn(async () => null), flaecheKopieren } as unknown as SprachenDaten;
        const unter = vi.fn(async (_id: string, schreibe: () => Promise<unknown>) => schreibe());
        const steuerung = createSpracheditorSteuerung(createWerkzeugfenster(undefined), daten, undefined, {
            sperre: {
                unter,
                haelt: () => false,
                halter: () => ({
                    nimm: vi.fn(async () => ({ art: "fehler", fehler: new ApiFailure(0, "network", "") })),
                    gib: vi.fn(),
                    beiVerlust: () => () => undefined,
                    liste: async () => [],
                }),
            } as never,
            lauf: "lauf",
            geaendert: vi.fn(),
            darfSchreiben: () => true,
        } as never);
        const vorher = liste.mock.calls.length;
        const ergebnis = await steuerung.kopiere(
            GARETHI,
            { id: TEIL, revision: 5 },
            { neueSprache: { name: "Neu-Garethi", farbe: NEUE_FARBE }, deleteSource: false },
        );
        expect(ergebnis).toMatchObject({ ok: true, id: kopie });
        expect(unter.mock.calls.map(([id]) => id)).toEqual([GARETHI]);
        expect(flaecheKopieren).toHaveBeenCalledTimes(1);
        expect(flaecheKopieren).toHaveBeenCalledWith(GARETHI, TEIL, {
            operationId: expect.any(String),
            baseRevision: 5,
            neueSprache: { name: "Neu-Garethi", farbe: NEUE_FARBE },
            deleteSource: false,
        });
        expect(liste.mock.calls.length).toBeGreaterThan(vorher);
        expect(steuerung.auswahl.value).toBe(neu);
        expect(steuerung.flaecheWunsch.value).toMatchObject({ sprache: neu, flaeche: kopie });
        steuerung.destroy();
    });
});

describe("Eine Fläche der Derographie in eine Sprache (WI-0261, „Ja, bauen“)", () => {
    const REGION = "5d2c0000-0000-4000-8000-0000000000d1";
    const AREA = "5d2c0000-0000-4000-8000-0000000000d2";
    const KOPIE = "5d2c0000-0000-4000-8000-0000000000d3";
    function aufbau(spracheId: string) {
        const ausLandschaft = vi.fn(async () => ({
            ok: true as const,
            quittung: { ...QUITTUNG, flaecheId: KOPIE, spracheId },
        }));
        const liste = vi.fn(async () => ({ zeilen: [] }));
        const daten = { liste, sprache: vi.fn(async () => null), ausLandschaft } as unknown as SprachenDaten;
        const unter = vi.fn(async (_id: string, schreibe: () => Promise<unknown>) => schreibe());
        const geaendert = vi.fn();
        const steuerung = createSpracheditorSteuerung(createWerkzeugfenster(undefined), daten, undefined, {
            sperre: {
                unter,
                haelt: () => false,
                halter: () => ({
                    nimm: vi.fn(async () => ({ art: "fehler", fehler: new ApiFailure(0, "network", "") })),
                    gib: vi.fn(),
                    beiVerlust: () => () => undefined,
                    liste: async () => [],
                }),
            } as never,
            lauf: "lauf",
            geaendert,
            darfSchreiben: () => true,
        } as never);
        return { steuerung, ausLandschaft, liste, unter, geaendert };
    }

    it("🔴 in eine bestehende Sprache: EIN Schreibweg unter ihrer Sperre; danach Kacheln und Liste neu, das Fenster an ihr mit der neuen Teilfläche", async () => {
        const t = aufbau(ORKISCH);
        const vorher = t.liste.mock.calls.length;
        const ergebnis = await t.steuerung.kopiereAusLandschaft(
            { regionId: REGION, areaId: AREA },
            { targetId: ORKISCH },
        );
        expect(ergebnis).toMatchObject({ ok: true, id: KOPIE, mapRevision: 21 });
        expect(t.unter.mock.calls.map(([id]) => id)).toEqual([ORKISCH]);
        expect(t.ausLandschaft).toHaveBeenCalledTimes(1);
        expect(t.ausLandschaft).toHaveBeenCalledWith({
            operationId: expect.any(String),
            regionId: REGION,
            areaId: AREA,
            targetId: ORKISCH,
        });
        expect(t.geaendert).toHaveBeenCalledWith(21);
        expect(t.liste.mock.calls.length).toBeGreaterThan(vorher);
        expect(t.steuerung.auswahl.value).toBe(ORKISCH);
        expect(t.steuerung.flaecheWunsch.value).toMatchObject({ sprache: ORKISCH, flaeche: KOPIE, frage: false });
        t.steuerung.destroy();
    });

    it("🔴 in eine NEUE Sprache: ohne Sperre; das Fenster an der neuen Sprache aus der Quittung", async () => {
        const neu = "5d2c0000-0000-4000-8000-0000000000d9";
        const t = aufbau(neu);
        await t.steuerung.kopiereAusLandschaft(
            { regionId: REGION, areaId: AREA },
            { neueSprache: { name: "Waldsprache", farbe: NEUE_FARBE } },
        );
        expect(t.unter).not.toHaveBeenCalled();
        expect(t.ausLandschaft).toHaveBeenCalledWith({
            operationId: expect.any(String),
            regionId: REGION,
            areaId: AREA,
            neueSprache: { name: "Waldsprache", farbe: NEUE_FARBE },
        });
        expect(t.steuerung.auswahl.value).toBe(neu);
        expect(t.steuerung.flaecheWunsch.value).toMatchObject({ sprache: neu, flaeche: KOPIE });
        t.steuerung.destroy();
    });

    it("zurücknehmbar über den Server (WI-0265 B8c): Der Anschluss spielt nichts selbst zurück, die Adresse ist die Sprache, und der Verlauf nennt die Quelle mit Namen", () => {
        const eintrag = {
            operation: "sprache.flaeche_aus_landschaft",
            objects: [
                {
                    kind: "sprache_flaeche",
                    id: KOPIE,
                    action: "sprache_flaeche.copied",
                    sprache: { id: ORKISCH },
                    revisionBefore: null,
                    revisionAfter: 1,
                    changes: {},
                },
            ],
        } as unknown as Parameters<ReturnType<typeof createSpracheVerlaufsArt>["ruecknahme"]>[0];
        const art = createSpracheVerlaufsArt();
        expect(art.ruecknahme(eintrag, { id: ORKISCH } as never, "op")).toEqual({ art: "nicht" });
        expect(art.ruecknahmeZiel?.(eintrag, ORKISCH)).toEqual({ familie: "sprache", id: ORKISCH });
        expect(sprachVerlaufFeldName("kopiertAus")).not.toBe("kopiertAus");
        expect(sprachVerlaufWert("kopiertAus", { regionId: REGION, areaId: AREA, name: "Spenderwald" })).toBe(
            "Spenderwald",
        );
    });
});
