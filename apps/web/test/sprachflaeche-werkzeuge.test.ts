import { describe, expect, it, vi } from "vitest";
import type {
    EditorLock,
    EditorLockTarget,
    PinselStrich,
    SpracheEditorFlaecheForm,
    SpracheFlaecheUmformenBody,
} from "@avesmaps3d/shared";
import type { NimmErgebnis } from "../src/editor-sperre/sperre";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import { createFlaecheMalen, teileAusPolygonen } from "../src/landschaftseditor/flaeche-malen";
import { createFlaecheVereinfachen, ohneFesteEcken } from "../src/landschaftseditor/flaeche-vereinfachen";
import { createFlaecheVerschieben } from "../src/landschaftseditor/flaeche-verschieben";
import { landschaftFlaechen } from "../src/landschaftseditor/landschaft-flaechen";
import type { GeometrieEingabe } from "../src/map/geometrie/modus";
import type { Punkt } from "../src/map/geometrie/geometrie";
import { createSprachflaecheForm, laufKennung } from "../src/spracheditor/sprachflaeche-form";
import { createSprachflaechenWerkzeuge, sprachflaecheArt } from "../src/spracheditor/sprachflaeche-werkzeuge";

/**
 * Die Werkzeuge der Form an einer Teilfläche einer Sprache (WI-0261 Stufe 2): dieselben Modi wie an der Fläche der Derographie, mit der Teilfläche als
 * Quelle. Problemfälle: Ein Werkzeug schreibt schon beim Absetzen oder je Strich statt erst mit „Fertig“; „Fertig“ schreibt mehr als EINE Operation, nur
 * ein Stück der Form oder gegen die falsche Revision; der Strich geht an die Landschaft oder nennt die Teilfläche nicht; nach dem Schreiben liest das Fenster
 * nicht nach, die Sperre bleibt gehalten; ein Konflikt oder eine fremde Sperre bleibt ohne Hinweis; ohne Recht beginnt ein Modus; Vereinfachen hält Ecken
 * fest, die keine Nachbarin teilt, oder nennt Nachbarn und Flüsse.
 *
 * Konflikt und abgelaufene Sperre (EDIT-0003 §3b R1): Der Entwurf geht verloren; es bleibt nur „Verwerfen und neu starten“; „überschreiben“ schreibt
 * gegen die alte Revision; „übernehmen“ lässt den Modus stehen. „Teilfläche bearbeiten“ schreibt an der Bearbeitung vorbei oder hat einen eigenen Entwurf.
 */

const S = "5d2c0000-0000-4000-8000-000000000001";
const F = "5d2c0000-0000-4000-8000-0000000000f1";
const KENNUNG = laufKennung(S, F);
const RECHTECK: [number, number][] = [
    [500, 500],
    [540, 500],
    [540, 520],
    [500, 520],
];
const p = (x: number, y: number): Punkt => ({ x, y });

const formVon = (polygons: [number, number][][][], revision = 4, aktiv = true): SpracheEditorFlaecheForm => ({
    id: F,
    sprache: S,
    revision,
    herkunft: "sprachenkarte",
    quelleRevision: "q1",
    aktiv,
    polygons,
});

const quittung = {
    status: "applied",
    affected: [
        { kind: "sprache", id: S, revision: 2 },
        { kind: "sprache_flaeche", id: F, revision: 5 },
    ],
    derivedWork: [{ kind: "sprache_treffer", jobId: "job-1", state: "queued" }],
    warnings: [],
    mapRevision: 9,
} as const;

function aufbau(
    optionen: { darf?: boolean; sperre?: "gesperrt"; antworten?: SchreibAntwort[]; sperreErst?: Promise<void> } = {},
) {
    const antworten = [...(optionen.antworten ?? [])];
    let gelesen = formVon([[RECHTECK]]);
    const umgeformt: SpracheFlaecheUmformenBody[] = [];
    const striche: { id: string; flaeche: string; body: PinselStrich }[] = [];
    const daten = {
        form: vi.fn(async () => gelesen),
        flaecheUmformen: vi.fn(async (_id: string, _flaeche: string, body: SpracheFlaecheUmformenBody) => {
            umgeformt.push(body);
            return antworten.shift() ?? ({ ok: true, quittung } as unknown as SchreibAntwort);
        }),
        flaechePinsel: vi.fn(async (id: string, flaeche: string, body: PinselStrich) => {
            striche.push({ id, flaeche, body });
            return {
                ok: true as const,
                quittung: {
                    polygons: [
                        [
                            [
                                [500, 500],
                                [560, 500],
                                [560, 520],
                                [500, 520],
                            ],
                        ],
                    ] as [number, number][][][],
                },
            };
        }),
    };
    const freigegeben: string[] = [];
    const sperre = {
        nimm: vi.fn(async (ziel: EditorLockTarget, teil: EditorLock["part"]): Promise<NimmErgebnis> => {
            await optionen.sperreErst;
            const lock: EditorLock = {
                kind: "sprache",
                id: ziel.id,
                part: teil,
                person: { id: "p2", name: "Thomas" },
                since: "2026-10-31T10:00:00Z",
                heartbeatAt: "2026-10-31T10:00:00Z",
                own: optionen.sperre !== "gesperrt",
            };
            return optionen.sperre === "gesperrt"
                ? { art: "gesperrt", sperre: lock }
                : { art: "genommen", sperre: lock };
        }),
        gib: vi.fn((ziel: EditorLockTarget) => void freigegeben.push(ziel.id)),
        beiVerlust: (zuhoerer: (ziel: EditorLockTarget) => void) => {
            verlust.push(zuhoerer);
            return () => undefined;
        },
        liste: async () => [],
    };
    const verlust: ((ziel: EditorLockTarget) => void)[] = [];
    const gespeichert = vi.fn();
    const geaendert = vi.fn();
    const melde = vi.fn();
    const konflikt = vi.fn();
    const werkzeuge = createSprachflaechenWerkzeuge({
        daten,
        sperre,
        werkzeug: "spracheditor",
        darf: () => optionen.darf ?? true,
        geaendert,
        gespeichert,
        konflikt,
        melde,
    });
    // Die Landschaft der Modi kommt hier nie zum Zug: Jeder Start nennt die Quelle der Sprache.
    const landschaft = {
        daten: {
            landschaft: () => Promise.reject(new Error("Landschaft")),
            ziele: () => Promise.reject(new Error("Landschaft")),
        },
        ebenen: () => [],
        bearbeitung: () => undefined,
    };
    let zeiger: { bewege(punkt: Punkt): void; klick(punkt: Punkt): void } | undefined;
    const verschieben = createFlaecheVerschieben({
        ...landschaft,
        karte: {
            an(_bild, z) {
                zeiger = z;
                return { aktualisiere: vi.fn(), aus: vi.fn() };
            },
            zeige: vi.fn(),
        },
    });
    const malen = createFlaecheMalen({
        ...landschaft,
        strich: () => Promise.reject(new Error("Landschaft")),
        karte: { an: () => ({ aktualisiere: vi.fn(), aus: vi.fn() }), zeige: vi.fn() },
    });
    const vereinfachen = createFlaecheVereinfachen({
        ...landschaft,
        karte: {
            vorschau: () => ({
                aktualisiere: vi.fn(),
                markiere: vi.fn(),
                sperre: vi.fn(),
                abbrechen: () => false,
                aus: vi.fn(),
            }),
            zeige: async () => undefined,
            massstab: () => 1,
        },
    });
    let eingabe: GeometrieEingabe | undefined;
    const formGespeichert = vi.fn();
    const form = createSprachflaecheForm({
        werkzeuge,
        fangradius: () => 10,
        sperre,
        karte: {
            ein(e) {
                eingabe = e;
                return {
                    aktualisiere: vi.fn(),
                    markiere: vi.fn(),
                    sperre: vi.fn(),
                    abbrechen: () => false,
                    aus: vi.fn(),
                };
            },
            zeige: vi.fn(),
            geaendert: vi.fn(),
        },
        gespeichert: formGespeichert,
    });
    return {
        werkzeuge,
        form,
        formGespeichert,
        eingabe: () => eingabe!,
        konflikt,
        verliereSperre: () => {
            for (const zuhoerer of verlust) zuhoerer({ kind: "sprache", id: S });
        },
        daten,
        umgeformt,
        striche,
        sperre,
        freigegeben,
        gespeichert,
        geaendert,
        melde,
        verschieben,
        malen,
        vereinfachen,
        zeiger: () => zeiger!,
        setzeGelesen: (neu: SpracheEditorFlaecheForm) => (gelesen = neu),
    };
}

const naechsterSchritt = () => new Promise<void>((fertig) => queueMicrotask(fertig));

describe("Die Art der Teilfläche: „Fertig“ ist sprache_flaeche.reshape", () => {
    const art = sprachflaecheArt({ form: async () => formVon([[RECHTECK]]), flaecheUmformen: vi.fn() }, S, F);
    const d = formVon([[RECHTECK]]);
    const stand = (punkte: [number, number][]) => ({
        teile: [
            {
                objekt: F,
                name: "",
                nr: 0,
                art: "ring" as const,
                punkte: punkte.map(([x, y]) => p(x, y)),
                revision: 4,
            },
        ],
        nachbarn: [],
    });

    it("🔴 die ganze Form gegen die Revision der Teilfläche; ohne Änderung nichts; Felder gibt es keine", async () => {
        const start = { felder: null, form: stand(RECHTECK) };
        expect(art.operation(d, start, start, "op")).toBeUndefined();
        const verschoben = RECHTECK.map(([x, y]) => [x + 10, y] as [number, number]);
        expect(art.operation(d, start, { felder: null, form: stand(verschoben) }, "op")).toEqual({
            operationId: "op",
            baseRevision: 4,
            polygons: [[verschoben]],
        });
        expect(art.geaendert(d, { felder: null, form: stand(verschoben) })).toEqual(["form"]);
        expect(art.geaendert(d, start)).toEqual([]);
        expect(art.fremde(d, formVon([[RECHTECK]], 5))).toEqual(["form"]);
        expect(art.felder(d)).toBeNull();
    });

    it("nach einem Pinselstrich fassen die Stücke die Ringe zu Polygonen; eine stillgelegte Teilfläche gibt es nicht", async () => {
        const start = { felder: null, form: stand(RECHTECK) };
        const vorlage = start.form.teile[0]!;
        const zwei = teileAusPolygonen(
            [
                [RECHTECK],
                [
                    [
                        [600, 600],
                        [610, 600],
                        [605, 610],
                    ],
                ],
            ],
            vorlage,
        );
        expect(art.operation(d, start, { felder: null, form: { teile: zwei, nachbarn: [] } }, "op")?.polygons).toEqual([
            [RECHTECK],
            [
                [
                    [600, 600],
                    [610, 600],
                    [605, 610],
                ],
            ],
        ]);
        const still = sprachflaecheArt(
            { form: async () => formVon([[RECHTECK]], 4, false), flaecheUmformen: vi.fn() },
            S,
            F,
        );
        expect(await still.lade(KENNUNG, new AbortController().signal)).toBeNull();
    });
});

describe("Dieselben Modi an der Teilfläche, EIN Entwurf, EINE Operation", () => {
    it("🔴 Verschieben: Absetzen ist ein Schritt im Entwurf, erst „Fertig“ schreibt EIN reshape; danach liest das Fenster nach, die Sperre ist frei", async () => {
        const t = aufbau();
        await t.verschieben.starte(KENNUNG, F, p(510, 510), t.werkzeuge.quelle("Garethi · Teilfläche 1"));
        const lauf = t.verschieben.laufend.value!;
        expect(lauf).toMatchObject({ phase: "bereit", name: "Garethi · Teilfläche 1", haengt: true, areaId: F });
        expect(lauf.quelle.werkzeug).toBe("spracheditor");
        t.zeiger().klick(p(520, 510));
        expect(lauf.bearbeitung!.lage.value.ungespeichert).toBe(1);
        // Gesperrt wird die Sprache, Teil „form“; geschrieben ist noch nichts.
        expect(t.sperre.nimm).toHaveBeenCalledWith({ kind: "sprache", id: S }, "form");
        expect(t.daten.flaecheUmformen).not.toHaveBeenCalled();
        // Solange das Werkzeug läuft, ruht das Fenster der Sprache (Leiste der Felder, Knöpfe an den Flächen).
        expect(t.werkzeuge.laeuft.value).toBe(S);

        await lauf.bearbeitung!.fertig();
        expect(t.daten.flaecheUmformen).toHaveBeenCalledTimes(1);
        expect(t.daten.flaecheUmformen.mock.calls[0]!.slice(0, 2)).toEqual([S, F]);
        expect(t.umgeformt[0]).toMatchObject({
            baseRevision: 4,
            polygons: [[RECHTECK.map(([x, y]) => [x + 10, y])]],
        });
        expect(t.verschieben.laufend.value).toBeUndefined();
        expect(t.verschieben.meldung.value).toEqual({ art: "gespeichert", name: "Garethi · Teilfläche 1" });
        expect(t.gespeichert).toHaveBeenCalledWith(S, F);
        expect(t.geaendert).toHaveBeenCalledWith(9);
        expect(t.freigegeben).toEqual([S]);
        expect(t.melde).not.toHaveBeenCalled();
        expect(t.werkzeuge.laeuft.value).toBeUndefined();
    });

    it("🔴 Malen: der Strich rechnet an der Teilfläche der Sprache (nichts geschrieben), „Fertig“ schreibt die neue Form als EIN reshape", async () => {
        const t = aufbau();
        await t.malen.starte(KENNUNG, F, "malen", t.werkzeuge.quelle("Garethi"));
        await t.malen.strich([p(540, 510), p(560, 510)], 0.5);
        expect(t.striche).toHaveLength(1);
        expect(t.striche[0]).toMatchObject({
            id: S,
            flaeche: F,
            body: { mode: "malen", radius: 20, polygons: [[RECHTECK]] },
        });
        expect(t.striche[0]!.body).not.toHaveProperty("areaId");
        expect(t.daten.flaecheUmformen).not.toHaveBeenCalled();
        await t.malen.laufend.value!.bearbeitung!.fertig();
        expect(t.umgeformt).toEqual([
            {
                operationId: expect.any(String),
                baseRevision: 4,
                polygons: [
                    [
                        [
                            [500, 500],
                            [560, 500],
                            [560, 520],
                            [500, 520],
                        ],
                    ],
                ],
            },
        ]);
    });

    it("Vereinfachen hält an einer Sprache keine Ecke fest: keine Nachbarn, keine Flüsse (E2, E4)", async () => {
        const t = aufbau();
        const zackig: [number, number][] = [];
        for (let i = 0; i < 20; i++) zackig.push([500 + i * 2, i % 2 === 0 ? 500 : 500.2]);
        zackig.push([540, 520], [500, 520]);
        t.setzeGelesen(formVon([[zackig]]));
        await t.vereinfachen.starte(KENNUNG, t.werkzeuge.quelle("Garethi"));
        expect(t.vereinfachen.laufend.value).toMatchObject({ phase: "bereit", fest: 0, allesFest: false });
        expect(t.vereinfachen.laufend.value!.nachher).toBeLessThan(zackig.length);
        expect(t.daten.flaecheUmformen).not.toHaveBeenCalled();
    });

    it("🔴 Konflikt beim Schreiben (R1): der Entwurf bleibt, das Fenster kommt an die Teilfläche, „überschreiben“ schreibt die eigene Form gegen den neuen Stand", async () => {
        const t = aufbau({
            antworten: [
                {
                    ok: false,
                    status: 409,
                    fehler: {
                        code: "edit_conflict",
                        message: "geändert",
                        details: { changedBy: { displayName: "Thomas" } },
                    },
                },
            ],
        });
        await t.verschieben.starte(KENNUNG, F, p(510, 510), t.werkzeuge.quelle("Garethi"));
        t.zeiger().klick(p(520, 510));
        const bearbeitung = t.verschieben.laufend.value!.bearbeitung!;
        // Inzwischen hat ein anderer die Teilfläche geändert (Revision 5).
        t.setzeGelesen(formVon([[RECHTECK.map(([x, y]) => [x, y + 3] as [number, number])]], 5));
        await bearbeitung.fertig();
        expect(bearbeitung.zustand.value).toMatchObject({
            art: "konflikt",
            grund: "fremd",
            wer: "Thomas",
            beide: ["form"],
        });
        expect(bearbeitung.lage.value.ungespeichert).toBe(1);
        expect(t.konflikt).toHaveBeenCalledWith(S, F);
        expect(t.werkzeuge.bearbeitungVon(S)?.zustand.value.art).toBe("konflikt");
        expect(t.werkzeuge.bearbeitungVon("andere")).toBeUndefined();
        expect(t.melde).not.toHaveBeenCalled();
        expect(t.verschieben.laufend.value).toBeDefined();

        await t.werkzeuge.bearbeitungVon(S)!.eigeneAnwenden(true);
        expect(t.umgeformt.map((body) => [body.baseRevision, body.polygons])).toEqual([
            [4, [[RECHTECK.map(([x, y]) => [x + 10, y])]]],
            [5, [[RECHTECK.map(([x, y]) => [x + 10, y])]]],
        ]);
        expect(t.gespeichert).toHaveBeenCalledWith(S, F);
        expect(t.verschieben.laufend.value).toBeUndefined();
    });

    it("🔴 „übernehmen“ verwirft den eigenen Entwurf und beendet den Modus; nach abgelaufener Sperre nimmt „anwenden“ sie neu und schreibt", async () => {
        const t = aufbau({
            antworten: [{ ok: false, status: 409, fehler: { code: "edit_conflict", message: "geändert" } }],
        });
        await t.verschieben.starte(KENNUNG, F, p(510, 510), t.werkzeuge.quelle("Garethi"));
        t.zeiger().klick(p(520, 510));
        t.setzeGelesen(formVon([[RECHTECK]], 5));
        await t.verschieben.laufend.value!.bearbeitung!.fertig();
        await t.werkzeuge.bearbeitungVon(S)!.fremdenUebernehmen();
        expect(t.verschieben.laufend.value).toBeUndefined();
        expect(t.umgeformt).toHaveLength(1);

        const weg = aufbau();
        await weg.verschieben.starte(KENNUNG, F, p(510, 510), weg.werkzeuge.quelle("Garethi"));
        weg.zeiger().klick(p(520, 510));
        await new Promise((fertig) => setTimeout(fertig, 0));
        weg.verliereSperre();
        const bearbeitung = weg.werkzeuge.bearbeitungVon(S)!;
        expect(bearbeitung.zustand.value).toMatchObject({ art: "konflikt", grund: "sperre", eigene: ["form"] });
        expect(weg.konflikt).toHaveBeenCalledWith(S, F);
        expect(bearbeitung.lage.value.ungespeichert).toBe(1);
        const genommen = weg.sperre.nimm.mock.calls.length;
        await bearbeitung.eigeneAnwenden();
        expect(weg.sperre.nimm.mock.calls.length).toBe(genommen + 1);
        expect(weg.umgeformt).toEqual([
            expect.objectContaining({ baseRevision: 4, polygons: [[RECHTECK.map(([x, y]) => [x + 10, y])]] }),
        ]);
    });

    it("eine fremde Sperre beim Start beendet den Modus mit Hinweis", async () => {
        const fremd = aufbau({ sperre: "gesperrt" });
        await fremd.verschieben.starte(KENNUNG, F, p(510, 510), fremd.werkzeuge.quelle("Garethi"));
        await vi.waitFor(() => expect(fremd.verschieben.laufend.value).toBeUndefined());
        expect(fremd.melde).toHaveBeenCalledWith(expect.stringContaining("Thomas"), "warning");
    });

    it("ohne Recht beginnt nichts; endet der Modus, endet die Bearbeitung und gibt die Sperre frei", async () => {
        const ohne = aufbau({ darf: false });
        await ohne.verschieben.starte(KENNUNG, F, p(510, 510), ohne.werkzeuge.quelle("Garethi"));
        expect(ohne.verschieben.laufend.value).toBeUndefined();
        expect(ohne.daten.form).not.toHaveBeenCalled();

        const t = aufbau();
        await t.verschieben.starte(KENNUNG, F, p(510, 510), t.werkzeuge.quelle("Garethi"));
        t.zeiger().klick(p(520, 510));
        // Die Sperre ist genommen, bevor der Modus endet.
        await new Promise((fertig) => setTimeout(fertig, 0));
        t.verschieben.beende();
        await naechsterSchritt();
        expect(t.freigegeben).toEqual([S]);
        expect(t.daten.flaecheUmformen).not.toHaveBeenCalled();

        // Esc gleich nach dem Start, bevor die Sperre da ist: Kommt sie danach, geht sie sofort zurück.
        let sperreDa = (): void => undefined;
        const spaet = aufbau({ sperreErst: new Promise<void>((da) => (sperreDa = da)) });
        await spaet.verschieben.starte(KENNUNG, F, p(510, 510), spaet.werkzeuge.quelle("Garethi"));
        expect(spaet.verschieben.abbrechen()).toBe(true);
        expect(spaet.verschieben.laufend.value).toBeUndefined();
        await naechsterSchritt();
        expect(spaet.freigegeben).toEqual([]);
        sperreDa();
        await vi.waitFor(() => expect(spaet.freigegeben).toEqual([S]));
    });
});

describe("„Teilfläche bearbeiten“ am selben Entwurf", () => {
    it("🔴 eine gezogene Ecke ist ein Schritt der Bearbeitung; „Fertig“ der Bearbeitung schreibt EIN reshape; der Hinweis kommt, der Modus endet", async () => {
        const t = aufbau();
        await t.form.starteAn(S, F, "Garethi · Teilfläche 1");
        expect(t.form.laufend.value).toMatchObject({ phase: "bereit", name: "Garethi · Teilfläche 1" });
        const bearbeitung = t.form.bearbeitung.value!;
        // Derselbe Entwurf wie der der Werkzeuge: Konfliktkasten und Fuß im Fenster stehen an ihm.
        expect(t.werkzeuge.bearbeitungVon(S)?.zustand).toBe(bearbeitung.zustand);
        const teil = t.eingabe().teile()[0]!;
        const gezogen = { ...teil, punkte: teil.punkte.map((q, i) => (i === 0 ? p(q.x - 5, q.y) : q)) };
        t.eingabe().handbewegung({
            art: "ziehen",
            stelle: { objekt: F, nr: 0, index: 0 },
            teile: [gezogen],
            mitgezogen: [],
            treffer: undefined,
            getrennt: false,
        });
        expect(bearbeitung.lage.value).toMatchObject({ aktiv: true, ungespeichert: 1 });
        expect(t.form.laufend.value!.ungespeichert).toBe(1);
        expect(t.daten.flaecheUmformen).not.toHaveBeenCalled();
        t.form.zurueck();
        expect(bearbeitung.lage.value.ungespeichert).toBe(0);
        t.form.wieder();

        await bearbeitung.fertig();
        expect(t.umgeformt).toEqual([
            {
                operationId: expect.any(String),
                baseRevision: 4,
                polygons: [[RECHTECK.map(([x, y], i) => (i === 0 ? [x - 5, y] : [x, y]))]],
            },
        ]);
        expect(t.formGespeichert).toHaveBeenCalledWith("Garethi · Teilfläche 1");
        expect(t.gespeichert).toHaveBeenCalledWith(S, F);
        expect(t.form.laufend.value).toBeUndefined();
        await naechsterSchritt();
        expect(t.werkzeuge.bearbeitungVon(S)).toBeUndefined();
    });

    it("ohne Recht beginnt nichts; Esc ohne Änderung beendet Modus und Bearbeitung", async () => {
        const ohne = aufbau({ darf: false });
        await ohne.form.starteAn(S, F, "Garethi");
        expect(ohne.form.laufend.value).toBeUndefined();

        const t = aufbau();
        await t.form.starteAn(S, F, "Garethi");
        expect(t.form.abbrechen()).toBe(true);
        expect(t.form.laufend.value).toBeUndefined();
        await naechsterSchritt();
        expect(t.werkzeuge.bearbeitungVon(S)).toBeUndefined();
    });
});

describe("Gesten und Zahlen von „Fläche vereinfachen“ nennen nur, was an der Art gilt", () => {
    const tafeln = { de, en, fr, it: itTafel, es, nl, pl, sv, da };

    it("🔴 ohne Nachbarn und Flüsse fällt der Teil zu den festen Ecken weg, aus den vorhandenen Bausteinen", () => {
        expect(ohneFesteEcken(de["landschaftseditor.vereinfachen.gesten"])).toBe(
            "Regler: Stärke, die Karte zeigt es sofort · gestrichelt der alte Umriss · Enter schreibt · Esc fragt",
        );
        expect(ohneFesteEcken(de["landschaftseditor.vereinfachen.gestenFinger"])).toBe("Regler: Stärke");
        expect(ohneFesteEcken(de["landschaftseditor.vereinfachen.zahlen"])).toBe("{vorher} → {nachher} Stützpunkte");
    });

    it("🔴 in jeder Tafel steht der Teil zu den festen Ecken an zweiter Stelle", () => {
        for (const [sprache, tafel] of Object.entries(tafeln)) {
            const teile = (schluessel: keyof typeof de): string[] => tafel[schluessel].split(" · ");
            expect(teile("landschaftseditor.vereinfachen.gesten"), sprache).toHaveLength(5);
            expect(teile("landschaftseditor.vereinfachen.gestenFinger"), sprache).toHaveLength(2);
            expect(teile("landschaftseditor.vereinfachen.zahlen"), sprache).toHaveLength(2);
            expect(teile("landschaftseditor.vereinfachen.zahlen")[1], sprache).toContain("{fest}");
            expect(teile("landschaftseditor.vereinfachen.zahlen")[0], sprache).not.toContain("{fest}");
        }
    });

    it("die Landschaft sagt ja, die Sprache nein", () => {
        const t = aufbau();
        expect(t.werkzeuge.quelle("Garethi").mitNachbarn).toBe(false);
        const landschaft = landschaftFlaechen({
            daten: { landschaft: async () => null, ziele: async () => null },
            ebenen: () => [],
            bearbeitung: () => undefined,
        });
        expect(landschaft.mitNachbarn).toBe(true);
    });
});
