import { describe, expect, it, vi } from "vitest";
import type {
    EditorLock,
    EditorLockPart,
    EditorLockTarget,
    EditorMoveTargets,
    EditorPlaceDetail,
    EditorPlaceRow,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { handgriffZeilen } from "../src/editor-menu/action.ts";
import { ortHandgriffe, ortSubjekt, type OrtLage, type OrtWirkung } from "../src/editor-menu/handgriffe-ort.ts";
import type { EditorSperre, NimmErgebnis } from "../src/editor-sperre/sperre.ts";
import { setzeText } from "../src/ortseditor/entwurf.ts";
import { createOrtBearbeitung, type BearbeitungsSperre, type OrtApi } from "../src/ortseditor/ort-bearbeitung.ts";
import { createOrtSetzen, type SetzenApi } from "../src/ortseditor/ort-setzen.ts";
import { createOrtSperre } from "../src/ortseditor/ort-sperre.ts";
import { createOrtVerschieben, type VerschiebeApi, type VerschiebeKarte } from "../src/ortseditor/ort-verschieben.ts";
import type { Zug } from "../src/ortseditor/verschieben.ts";

/**
 * Der Ort an der gemeinsamen Sperre (EDIT-0003 §4, WI-0208): „Ort verschieben“ und das Bearbeiten im Ortseditor sperren den Ort; hält
 * ein anderer ihn, kommt der Hinweis, und der Modus beginnt nicht. Geprüft ohne Server: Der Baustein `editor-sperre/sperre.ts` ist
 * hier ein Ersatz, der zählt, was er gefragt und freigegeben hat.
 */

const ORT = "7527ed5b-303a-57af-926e-ed41a8b82dfc";

function sperreVon(wer: string, teil: EditorLockPart = "form"): EditorLock {
    return {
        kind: "place",
        id: ORT,
        part: teil,
        person: { id: "11111111-1111-4111-8111-111111111111", name: wer },
        since: "2026-10-16T07:32:00Z",
        heartbeatAt: "2026-10-16T07:41:00Z",
        own: wer === "ich",
    };
}

/** Der Baustein als Ersatz: `fremd` hält den Ort ein anderer; `verliere` meldet den Verlust wie der Herzschlag. */
function bausteinErsatz(fremd: string | undefined = undefined) {
    const gefragt: { ziel: EditorLockTarget; teil: EditorLockPart }[] = [];
    const freigegeben: EditorLockTarget[] = [];
    const hoerer = new Set<(ziel: EditorLockTarget) => void>();
    const zustand = { fremd };
    const baustein: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust"> = {
        nimm(ziel, teil): Promise<NimmErgebnis> {
            gefragt.push({ ziel, teil });
            return Promise.resolve(
                zustand.fremd === undefined
                    ? { art: "genommen", sperre: sperreVon("ich", teil) }
                    : { art: "gesperrt", sperre: sperreVon(zustand.fremd, teil) },
            );
        },
        gib: (ziel) => void freigegeben.push(ziel),
        beiVerlust(h) {
            hoerer.add(h);
            return () => hoerer.delete(h);
        },
    };
    return {
        baustein,
        gefragt,
        freigegeben,
        zustand,
        verliere: () => hoerer.forEach((h) => h({ kind: "place", id: ORT })),
    };
}

function saetze(ort: ReturnType<typeof createOrtSperre>): BearbeitungsSperre {
    return {
        ort,
        gesperrt: (sperre) =>
            `🔒 ${sperre.person.name} bearbeitet ${sperre.part === "form" ? "die Form" : "die Eigenschaften"}`,
        fehler: "nicht gesperrt",
        verloren: "Sperre abgelaufen",
    };
}

function ort(revision = 7): EditorPlaceDetail {
    return {
        publicId: ORT,
        revision,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: { x: 450.2, y: 535.64 },
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: null, origin: null, wiki: null },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: null, origin: null, wiki: null },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: null,
        pathEnds: [],
    };
}

/** Die Antwort des Servers ist verarbeitet: Erst dann hält das Fenster den Ort. */
const antwortDa = (): Promise<void> => new Promise((fertig) => setTimeout(fertig, 0));

const quittung = (revision: number): OperationReceipt => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "development",
    affected: [{ kind: "place", id: ORT, revision }],
    derivedWork: [],
    warnings: [],
    mapRevision: 57,
});

describe("Ort an der Sperre: der Zähler je Ort", () => {
    it("🔴 zwei Halter am selben Ort: EINE Frage an den Server, frei erst, wenn beide fertig sind", async () => {
        const b = bausteinErsatz();
        const sperre = createOrtSperre(b.baustein);
        const verschieben = {};
        const fenster = {};
        expect((await sperre.nimm(ORT, "form", verschieben)).art).toBe("genommen");
        expect((await sperre.nimm(ORT, "felder", fenster)).art).toBe("genommen");
        expect(b.gefragt).toHaveLength(1);
        sperre.gib(ORT, verschieben);
        expect(b.freigegeben).toEqual([]);
        sperre.gib(ORT, fenster);
        expect(b.freigegeben).toEqual([{ kind: "place", id: ORT }]);
    });

    it("zwei Fragen zugleich gehen als EINE an den Server", async () => {
        const b = bausteinErsatz();
        const sperre = createOrtSperre(b.baustein);
        const [eins, zwei] = await Promise.all([sperre.nimm(ORT, "form", {}), sperre.nimm(ORT, "felder", {})]);
        expect([eins.art, zwei.art]).toEqual(["genommen", "genommen"]);
        expect(b.gefragt).toHaveLength(1);
    });

    it("ein Halter, der nie hielt, gibt nichts frei; ein Verlust meldet den Ort und vergisst alle Halter", async () => {
        const b = bausteinErsatz();
        const sperre = createOrtSperre(b.baustein);
        sperre.gib(ORT, {});
        expect(b.freigegeben).toEqual([]);
        const gemeldet: string[] = [];
        sperre.beiVerlust((id) => gemeldet.push(id));
        const wer = {};
        await sperre.nimm(ORT, "form", wer);
        b.verliere();
        expect(gemeldet).toEqual([ORT]);
        // Der Server hält die Sperre nicht mehr; ein spätes `gib` fragt ihn nicht noch einmal.
        sperre.gib(ORT, wer);
        expect(b.freigegeben).toEqual([]);
    });
});

describe("Ort an der Sperre: „Ort verschieben“", () => {
    function aufbau(fremd?: string) {
        const b = bausteinErsatz(fremd);
        const ortSperre = createOrtSperre(b.baustein);
        let losgelassen: ((zug: Zug) => void) | undefined;
        // Kein Zug läuft: Esc beendet den Modus.
        const abbrechen = vi.fn(() => false);
        const api: VerschiebeApi = {
            ort: () => Promise.resolve(ort(7)),
            ziele: () => Promise.resolve({ radius: 50, freeEnds: [] } satisfies EditorMoveTargets),
            verschiebe: () => Promise.resolve({ ok: true, quittung: quittung(8) }),
        };
        const karte: VerschiebeKarte = {
            zeige: vi.fn(),
            ein: vi.fn((_start, los: (zug: Zug) => void) => {
                losgelassen = los;
                return { abbrechen, setze: vi.fn(), sperre: vi.fn(), aus: vi.fn() };
            }),
            geaendert: vi.fn(),
        };
        const steuerung = createOrtVerschieben({
            api,
            karte,
            ladefehler: "nicht geladen",
            neueKennung: () => "op-9",
            sperre: saetze(ortSperre),
        });
        return { b, ortSperre, steuerung, karte, abbrechen, los: (zug: Zug) => losgelassen?.(zug) };
    }
    const zug: Zug = { ort: { x: 430, y: 520 }, getrennt: false, eingerastet: undefined };

    it("🔴 hält ein anderer den Ort, beginnt der Modus nicht, und die Meldung sagt, wer ihn bearbeitet", async () => {
        const t = aufbau("Thomas");
        await t.steuerung.starte("f1", ORT);
        expect(t.karte.ein).not.toHaveBeenCalled();
        expect(t.steuerung.laufend.value).toBeUndefined();
        expect(t.steuerung.meldung.value).toMatchObject({ art: "abgelehnt", satz: "🔒 Thomas bearbeitet die Form" });
        expect(t.b.gefragt).toEqual([{ ziel: { kind: "place", id: ORT }, teil: "form" }]);
    });

    it("🔴 ist der Ort frei, sperrt der Modus ihn als Form und gibt ihn nach „Fertig“ frei", async () => {
        const t = aufbau();
        await t.steuerung.starte("f1", ORT);
        expect(t.steuerung.laufend.value?.art).toBe("zieht");
        expect(t.b.freigegeben).toEqual([]);
        // Loslassen ist ein Schritt im Entwurf und gibt nichts frei; erst „Fertig“ schreibt und beendet (EDIT-0003 G4).
        t.los(zug);
        expect(t.b.freigegeben).toEqual([]);
        await t.steuerung.fertig();
        await vi.waitFor(() => expect(t.steuerung.meldung.value?.art).toBe("quittung"));
        expect(t.b.freigegeben).toEqual([{ kind: "place", id: ORT }]);
    });

    it("Esc gibt den Ort frei; ein Fenster mit Entwurf am selben Ort hält ihn weiter", async () => {
        const t = aufbau();
        const fenster = {};
        await t.ortSperre.nimm(ORT, "felder", fenster);
        await t.steuerung.starte("f1", ORT);
        expect(t.steuerung.abbrechen()).toBe(true);
        expect(t.b.freigegeben).toEqual([]);
        t.ortSperre.gib(ORT, fenster);
        expect(t.b.freigegeben).toEqual([{ kind: "place", id: ORT }]);
    });

    it("geht die Sperre beim Ziehen verloren, endet der Modus ohne zu senden, und die Meldung sagt es", async () => {
        const t = aufbau();
        await t.steuerung.starte("f1", ORT);
        t.b.verliere();
        expect(t.abbrechen).toHaveBeenCalledOnce();
        expect(t.steuerung.laufend.value).toBeUndefined();
        expect(t.steuerung.meldung.value).toMatchObject({ art: "abgelehnt", satz: "Sperre abgelaufen" });
    });
});

describe("Ort an der Sperre: Bearbeiten im Ortseditor", () => {
    function aufbau(fremd?: string) {
        const b = bausteinErsatz(fremd);
        const ortSperre = createOrtSperre(b.baustein);
        const gesendet: unknown[] = [];
        let revision = 7;
        const api: OrtApi = {
            ort: () => Promise.resolve(ort(revision)),
            speichereOrt: (_id, body) => {
                gesendet.push(body);
                revision += 1;
                return Promise.resolve({ ok: true, quittung: quittung(revision) });
            },
        };
        const bearbeitung = createOrtBearbeitung(ORT, api, () => "op-3", saetze(ortSperre));
        return { b, ortSperre, bearbeitung, gesendet };
    }

    it("🔴 die erste Änderung sperrt den Ort als Eigenschaften; nach dem Speichern ist er wieder frei", async () => {
        const t = aufbau();
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value.art).toBe("bereit"));
        expect(t.b.gefragt).toEqual([]);
        t.bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.5"));
        t.bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.50"));
        await vi.waitFor(() => expect(t.b.gefragt).toEqual([{ ziel: { kind: "place", id: ORT }, teil: "felder" }]));
        await t.bearbeitung.speichern();
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value.art).toBe("gespeichert"));
        expect(t.gesendet).toHaveLength(1);
        expect(t.b.freigegeben).toEqual([{ kind: "place", id: ORT }]);
    });

    it("🔴 hält ein anderer den Ort, nimmt sie die Änderung zurück, und die Leiste sagt, wer ihn bearbeitet", async () => {
        const t = aufbau("Thomas");
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value.art).toBe("bereit"));
        t.bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.500"));
        await vi.waitFor(() =>
            expect(t.bearbeitung.zustand.value).toMatchObject({
                art: "abgelehnt",
                satz: "🔒 Thomas bearbeitet die Eigenschaften",
            }),
        );
        expect(t.bearbeitung.ungespeichert.value).toBe(false);
        await t.bearbeitung.speichern();
        expect(t.gesendet).toEqual([]);
    });

    it("Verwerfen gibt den Ort frei; ein verlorener Ort behält den Entwurf und sperrt beim Speichern neu", async () => {
        const t = aufbau();
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value.art).toBe("bereit"));
        t.bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.500"));
        await vi.waitFor(() => expect(t.b.gefragt).toHaveLength(1));
        t.bearbeitung.verwerfen();
        // Kam die Antwort erst nach dem Verwerfen, gibt sie den Ort gleich wieder frei.
        await vi.waitFor(() => expect(t.b.freigegeben).toHaveLength(1));

        t.bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.600"));
        await vi.waitFor(() => expect(t.b.gefragt).toHaveLength(2));
        await antwortDa();
        t.b.verliere();
        expect(t.bearbeitung.zustand.value).toMatchObject({ art: "abgelehnt", satz: "Sperre abgelaufen" });
        expect(t.bearbeitung.ungespeichert.value).toBe(true);
        await t.bearbeitung.speichern();
        expect(t.b.gefragt).toHaveLength(3);
        expect(t.gesendet).toHaveLength(1);
    });

    it("schließt das Fenster mit Entwurf, wird der Ort frei", async () => {
        const t = aufbau();
        await vi.waitFor(() => expect(t.bearbeitung.zustand.value.art).toBe("bereit"));
        t.bearbeitung.aendere((e) => setzeText(e, "einwohner", "2.500"));
        await vi.waitFor(() => expect(t.b.gefragt).toHaveLength(1));
        t.bearbeitung.destroy();
        // Ob die Antwort vor oder nach dem Schließen kam: Der Ort wird frei.
        await vi.waitFor(() => expect(t.b.freigegeben).toEqual([{ kind: "place", id: ORT }]));
    });
});

describe("Ort an der Sperre: gesperrte Handgriffe (WI-0215)", () => {
    const lage =
        (sperre?: EditorLock): (() => OrtLage) =>
        () => ({
            rechte: [
                "use_editor_menu",
                "edit_map_objects",
                "edit_map_geometry",
                "edit_territories",
                "edit_landscapes",
                "edit_territory_form",
                "edit_landscape_form",
                "edit_mountains",
            ],
            bearbeiten: { mapEditing: "testwelt" },
            laeuft: false,
            sperreVon: (id) => (sperre !== undefined && id === ORT ? sperre : undefined),
        });
    const wirkung = (): OrtWirkung => ({ bearbeiten: vi.fn(), verschieben: vi.fn(), verbergen: vi.fn() });
    const gruende = (l: () => OrtLage): Record<string, string | undefined> =>
        Object.fromEntries(
            handgriffZeilen(ortHandgriffe(l, wirkung()), ortSubjekt({ id: ORT, name: "Gratenfels" }), "karte").map(
                (zeile) => [zeile.id, zeile.grund],
            ),
        );

    it("🔴 hält ein anderer den Ort, steht „Ort verschieben“ gesperrt mit „Wird gerade bearbeitet.“", () => {
        expect(gruende(lage(sperreVon("Rondrikan")))["ort-verschieben"]).toBe("sperre.grund");
        expect(gruende(lage())["ort-verschieben"]).toBeUndefined();
    });
});

describe("Ort an der Sperre: „● Auf der Karte setzen“ (WI-0215)", () => {
    const OHNE: EditorPlaceRow = {
        key: ORT,
        origin: "ohne-lage",
        name: "Weiler",
        circle: "leer",
        assignment: "none",
        subtype: "dorf",
    };
    const WIKI: EditorPlaceRow = { ...OHNE, key: "wiki:weiler", origin: "wiki" };

    function aufbau(fremd?: string) {
        const b = bausteinErsatz(fremd);
        const ortSperre = createOrtSperre(b.baustein);
        const verschoben: string[] = [];
        let klick: ((punkt: { x: number; y: number }) => void) | undefined;
        const ein = vi.fn((gesetzt: (punkt: { x: number; y: number }) => void) => {
            klick = gesetzt;
            return { aus: vi.fn() };
        });
        const api: SetzenApi = {
            ort: (id) => Promise.resolve({ publicId: id, revision: 4 } as EditorPlaceDetail),
            lege: () => Promise.resolve({ ok: true, quittung: quittung(8) }),
            verschiebe: (id) => {
                verschoben.push(id);
                return Promise.resolve({ ok: true, quittung: quittung(5) });
            },
        };
        const setzen = createOrtSetzen({
            api,
            ladefehler: "nicht geladen",
            karte: { ein, geaendert: vi.fn() },
            gesetzt: vi.fn(),
            sperre: saetze(ortSperre),
        });
        return { b, setzen, ein, verschoben, klick: (punkt: { x: number; y: number }) => klick?.(punkt) };
    }

    it("🔴 hält ein anderer den Ort ohne Lage, wartet der Modus nicht auf den Klick, und die Meldung nennt ihn", async () => {
        const t = aufbau("Rondrikan");
        t.setzen.starte("f1", OHNE);
        await vi.waitFor(() =>
            expect(t.setzen.meldung.value).toMatchObject({
                art: "abgelehnt",
                satz: "🔒 Rondrikan bearbeitet die Form",
            }),
        );
        expect(t.ein).not.toHaveBeenCalled();
        expect(t.setzen.laufend.value).toBeUndefined();
    });

    it("🔴 frei: erst gesperrt, dann wartet der Modus; nach dem Setzen ist der Ort frei", async () => {
        const t = aufbau();
        t.setzen.starte("f1", OHNE);
        await vi.waitFor(() => expect(t.setzen.laufend.value?.art).toBe("wartet"));
        expect(t.b.gefragt).toEqual([{ ziel: { kind: "place", id: ORT }, teil: "form" }]);
        t.klick({ x: 10, y: 20 });
        await vi.waitFor(() => expect(t.setzen.meldung.value?.art).toBe("gesetzt"));
        expect(t.verschoben).toEqual([ORT]);
        expect(t.b.gefragt).toHaveLength(1);
        expect(t.b.freigegeben).toEqual([{ kind: "place", id: ORT }]);
    });

    it("aus der Liste gezogen (ohne Modus) sperrt das Setzen selbst; gesperrt sendet es nichts", async () => {
        const frei = aufbau();
        await frei.setzen.setze(OHNE, { x: 10, y: 20 }, "f1");
        expect(frei.verschoben).toEqual([ORT]);
        expect(frei.b.freigegeben).toHaveLength(1);
        const besetzt = aufbau("Rondrikan");
        await besetzt.setzen.setze(OHNE, { x: 10, y: 20 }, "f1");
        expect(besetzt.verschoben).toEqual([]);
        expect(besetzt.setzen.meldung.value).toMatchObject({ art: "abgelehnt" });
    });

    it("Esc gibt den Ort frei; ein Wiki-Eintrag ist noch kein Ort und fragt keine Sperre", async () => {
        const t = aufbau();
        t.setzen.starte("f1", OHNE);
        await vi.waitFor(() => expect(t.setzen.laufend.value?.art).toBe("wartet"));
        expect(t.setzen.abbrechen()).toBe(true);
        expect(t.b.freigegeben).toEqual([{ kind: "place", id: ORT }]);
        const wiki = aufbau("Rondrikan");
        wiki.setzen.starte("f1", WIKI);
        expect(wiki.setzen.laufend.value?.art).toBe("wartet");
        expect(wiki.b.gefragt).toEqual([]);
    });
});
