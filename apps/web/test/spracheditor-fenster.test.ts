import { describe, expect, it, vi } from "vitest";
import type { EditorLock, EditorLockTarget, OperationReceipt, SpracheEditorDetail } from "@avesmaps3d/shared";
import type { NimmErgebnis } from "../src/editor-sperre/sperre.ts";
import { createBearbeitung } from "../src/fenster/bearbeitung.ts";
import type { SchreibAntwort } from "../src/fenster/entwurf-senden.ts";
import { createSpracheArt, schreibenAus, schreibeSprache } from "../src/spracheditor/sprache-art.ts";
import {
    farbeGueltig,
    farbeNormal,
    felderAus,
    felderGrund,
    pilleDazu,
    pilleNach,
    pilleSchieben,
    pilleWeg,
    startfarbe,
    unterschiede,
    type SpracheFelder,
} from "../src/spracheditor/sprache-felder.ts";
import { createSprachSperre } from "../src/spracheditor/sprach-sperre.ts";
import type { SprachenDaten } from "../src/spracheditor/sprachen-daten.ts";
import { vorschauFarbe } from "../src/map/sprachen-vorschau.ts";

/**
 * Das Fenster „Sprachen bearbeiten“ ohne Browser (WI-0261 S5d2; Bauvorlage `fenster-sprachen.js`): die Felder im Entwurf (Pillen ordnen,
 * zuordnen, lösen; Farbe `#rrggbb`), die Rümpfe, die „Fertig“ schickt, die Anzeige eines Konflikts und die geteilte Sperre (das ↺ im Verlauf steht seit WI-0265 B6e in `sprache-verlauf.test.ts`).
 *
 * Problemfälle: Die Pillen gehen nach den Feldern hinaus und scheitern, nachdem Name und Farbe schon geschrieben sind; der zweite Schreibweg
 * geht gegen die alte Revision (409 gegen sich selbst); eine leere Legende wird zum leeren Text statt „keine“; eine Farbe ohne `#` oder in
 * Großbuchstaben geht an den Server; das Ende von „Fläche bearbeiten“ gibt die Sperre frei, während die Felder noch im Entwurf stehen.
 */

const SPRACHE = "5d2c0000-0000-4000-8000-000000000001";
const ARTIKEL = (n: number): string => `5d2c0000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

const pille = (n: number, titel: string): SpracheEditorDetail["wiki"][number] => ({
    id: ARTIKEL(n),
    titel,
    name: titel,
    kurzbeschreibung: null,
    sprachfamilie: "Garethische Sprachen",
    vorstufen: null,
    schrift: "Kusliker Zeichen",
    imWiki: true,
    herkunft: "import",
});

const D: SpracheEditorDetail = {
    id: SPRACHE,
    schluessel: "garethi",
    name: "Garethi",
    legende: null,
    farbe: "#ffb901",
    reihenfolge: 1,
    herkunft: "sprachenkarte",
    revision: 4,
    aktiv: true,
    flaeche: 15000,
    wiki: [pille(1, "Garethi"), pille(2, "Bosparano")],
    teilflaechen: [],
    treffer: { orte: 10, gebiete: 2, regionen: 3, wege: 4, berechnetAt: null, ausstehend: false },
    ueberlappungen: [],
    sperre: null,
};

const quittung = (revision: number, mapRevision?: number): OperationReceipt => ({
    operationId: "op",
    status: "applied",
    environment: "development",
    affected: [{ kind: "sprache", id: SPRACHE, revision }],
    derivedWork: [],
    warnings: [],
    ...(mapRevision === undefined ? {} : { mapRevision }),
});

describe("Die Felder einer Sprache (WI-0261 S5d2)", () => {
    it("🔴 Pillen: dazu ans Ende, nie doppelt; weg; ziehen und ↑ ↓ ordnen um, außerhalb wird geklemmt", () => {
        const a = ["a", "b", "c"];
        expect(pilleDazu(a, "d")).toEqual(["a", "b", "c", "d"]);
        expect(pilleDazu(a, "b")).toBe(a);
        expect(pilleWeg(a, "b")).toEqual(["a", "c"]);
        expect(pilleWeg(a, "x")).toBe(a);
        expect(pilleNach(a, "c", 0)).toEqual(["c", "a", "b"]);
        expect(pilleNach(a, "a", 99)).toEqual(["b", "c", "a"]);
        expect(pilleNach(a, "b", 1)).toBe(a);
        expect(pilleSchieben(a, "b", -1)).toEqual(["b", "a", "c"]);
        expect(pilleSchieben(a, "a", -1)).toBe(a);
        expect(pilleSchieben(a, "b", 1)).toEqual(["a", "c", "b"]);
    });

    it("🔴 Farbe: nur `#rrggbb` gilt, gespeichert klein; ohne `#` getippt wird es ergänzt; ↺ Startwert ist die Legendenfarbe", () => {
        expect(farbeGueltig("#FFB901")).toBe(true);
        expect(farbeGueltig("#ffb90")).toBe(false);
        expect(farbeGueltig("ffb901")).toBe(false);
        expect(farbeGueltig("rot")).toBe(false);
        expect(farbeNormal(" #FFB901 ")).toBe("#ffb901");
        expect(farbeNormal("1BAAD4")).toBe("#1baad4");
        expect(startfarbe("thorwalsch")).toBe("#1baad4");
        expect(startfarbe("kemi")).toBeUndefined();
    });

    it("„Fertig“ ist gesperrt ohne Namen und mit einer Farbe, die keine ist", () => {
        const f = felderAus(D);
        expect(felderGrund(f)).toBeUndefined();
        expect(felderGrund({ ...f, name: "  " })).toBe("spracheditor.grund.name");
        expect(felderGrund({ ...f, farbe: "#12345" })).toBe("spracheditor.grund.farbe");
        expect(unterschiede(f, { ...f, farbe: "#FFB901" })).toEqual([]);
        expect(unterschiede(f, { ...f, wiki: [...f.wiki].reverse(), legende: " " })).toEqual(["wiki"]);
    });
});

describe("Was „Fertig“ schreibt (WI-0261 S5d2)", () => {
    const start = felderAus(D);
    const zweite = () => "op-2";

    it("🔴 nur Geändertes; die Pillen ganz und in ihrer Folge; leere Legende ist „keine“, die Farbe klein", () => {
        expect(schreibenAus(D, start, start, "op-1", zweite)).toBeUndefined();
        expect(
            schreibenAus(D, start, { ...start, name: " Garethi ", farbe: "#FFB901" }, "op-1", zweite),
        ).toBeUndefined();
        expect(
            schreibenAus(
                D,
                { ...start, legende: "Alt" },
                { ...start, legende: "  ", farbe: "#C40304" },
                "op-1",
                zweite,
            ),
        ).toEqual({ baseRevision: 4, felder: { operationId: "op-1", legende: null, farbe: "#c40304" } });
        const umsortiert: SpracheFelder = { ...start, wiki: [ARTIKEL(2), ARTIKEL(1), ARTIKEL(3)] };
        expect(schreibenAus(D, start, { ...umsortiert, name: "Garethi (Mittelreich)" }, "op-1", zweite)).toEqual({
            baseRevision: 4,
            wiki: { operationId: "op-1", artikel: [ARTIKEL(2), ARTIKEL(1), ARTIKEL(3)] },
            felder: { operationId: "op-2", name: "Garethi (Mittelreich)" },
        });
    });

    it("🔴 erst die Pillen, dann die Felder gegen die Revision der ersten Quittung; scheitern die Pillen, ist nichts geschrieben", async () => {
        const aufrufe: string[] = [];
        const daten = {
            setzeWiki: vi.fn(async (_id: string, body: { baseRevision: number }): Promise<SchreibAntwort> => {
                aufrufe.push(`wiki@${String(body.baseRevision)}`);
                return { ok: true, quittung: quittung(5, 70) };
            }),
            aendere: vi.fn(async (_id: string, body: { baseRevision: number }): Promise<SchreibAntwort> => {
                aufrufe.push(`felder@${String(body.baseRevision)}`);
                return { ok: true, quittung: quittung(6) };
            }),
        };
        const body = schreibenAus(D, start, { ...start, name: "Neu", wiki: [ARTIKEL(1)] }, "op-1", zweite)!;
        const antwort = await schreibeSprache(daten, SPRACHE, body);
        expect(aufrufe).toEqual(["wiki@4", "felder@5"]);
        // Die Karte lädt mit der Kachelrevision, die die Pillen brachten, wenn die Felder keine eigene nennen.
        expect(antwort.ok && antwort.quittung.mapRevision).toBe(70);

        aufrufe.length = 0;
        daten.setzeWiki.mockResolvedValueOnce({
            ok: false,
            status: 409,
            fehler: { code: "object_locked", message: "Thomas bearbeitet Thorwalsch." },
        });
        const abgelehnt = await schreibeSprache(daten, SPRACHE, body);
        expect(abgelehnt).toMatchObject({ ok: false, status: 409, fehler: { code: "object_locked" } });
        expect(aufrufe).toEqual([]);
        expect(daten.aendere).toHaveBeenCalledTimes(1);
    });
});

describe("Die Bearbeitung der Sprache im Fenster (WI-0261 S5d2)", () => {
    function aufbau(antworten: SchreibAntwort[]) {
        let gelesen = D;
        const geschrieben: unknown[] = [];
        const daten = {
            sprache: vi.fn(async () => gelesen),
            setzeWiki: vi.fn(async (_id: string, body: unknown) => {
                geschrieben.push(["wiki", body]);
                return antworten.shift() ?? { ok: true as const, quittung: quittung(gelesen.revision + 1) };
            }),
            aendere: vi.fn(async (_id: string, body: unknown) => {
                geschrieben.push(["felder", body]);
                return antworten.shift() ?? { ok: true as const, quittung: quittung(gelesen.revision + 1) };
            }),
        } satisfies Pick<SprachenDaten, "sprache" | "aendere" | "setzeWiki">;
        const genommen: EditorLock["part"][] = [];
        const freigegeben: string[] = [];
        const sperre = {
            nimm: vi.fn(async (ziel: EditorLockTarget, teil: EditorLock["part"]): Promise<NimmErgebnis> => {
                genommen.push(teil);
                return {
                    art: "genommen",
                    sperre: {
                        kind: ziel.kind,
                        id: ziel.id,
                        part: teil,
                        person: { id: "p1", name: "Vali" },
                        since: "2026-10-30T10:00:00Z",
                        heartbeatAt: "2026-10-30T10:00:00Z",
                        own: true,
                    },
                };
            }),
            gib: vi.fn((ziel: EditorLockTarget) => void freigegeben.push(ziel.id)),
            beiVerlust: () => () => undefined,
            liste: async () => [],
        };
        const geteilt = createSprachSperre(sperre);
        let nr = 0;
        const bearbeitung = createBearbeitung(
            createSpracheArt(daten, "lauf-1", () => "op-zwei"),
            {
                id: SPRACHE,
                titel: "Garethi",
                sperre: geteilt.halter(),
                karte: { geaendert: vi.fn() },
                neueKennung: () => `op-${String((nr += 1))}`,
            },
        );
        return {
            bearbeitung,
            daten,
            geschrieben,
            genommen,
            freigegeben,
            geteilt,
            setze: (d: SpracheEditorDetail) => (gelesen = d),
        };
    }
    const bereit = async (b: ReturnType<typeof aufbau>["bearbeitung"]) =>
        vi.waitFor(() => expect(b.zustand.value.art).toBe("bereit"));

    it("🔴 eine Pille zuordnen nimmt die Sperre (Teil `felder`); „Fertig“ schickt die Pillen gegen die gelesene Revision", async () => {
        const t = aufbau([]);
        await bereit(t.bearbeitung);
        expect(t.daten.sprache).toHaveBeenCalledWith(SPRACHE, expect.anything(), "lauf-1");
        t.bearbeitung.feld((f) => ({ ...f, wiki: pilleDazu(f.wiki, ARTIKEL(3)) }));
        await vi.waitFor(() => expect(t.genommen).toEqual(["felder"]));
        expect(t.bearbeitung.lage.value.ungespeichert).toBe(1);
        await t.bearbeitung.fertig();
        expect(t.geschrieben).toEqual([
            ["wiki", { operationId: "op-1", artikel: [ARTIKEL(1), ARTIKEL(2), ARTIKEL(3)], baseRevision: 4 }],
        ]);
        await vi.waitFor(() => expect(t.freigegeben).toEqual([SPRACHE]));
    });

    it("🔴 409 `edit_conflict` steht als Konflikt da (wer, wann, welche Felder), der Entwurf bleibt", async () => {
        const t = aufbau([
            {
                ok: false,
                status: 409,
                fehler: {
                    code: "edit_conflict",
                    message: "Jemand war schneller.",
                    details: { changedBy: { displayName: "Thomas" }, changedAt: "2026-10-30T10:05:00Z" },
                },
            },
        ]);
        await bereit(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, farbe: "#c40304" }));
        t.setze({ ...D, revision: 5, name: "Garethi (Thomas)" });
        await t.bearbeitung.fertig();
        const zustand = t.bearbeitung.zustand.value;
        expect(zustand.art).toBe("konflikt");
        if (zustand.art !== "konflikt") return;
        expect(zustand).toMatchObject({
            grund: "fremd",
            wer: "Thomas",
            eigene: ["farbe"],
            fremde: ["name"],
            beide: [],
        });
        expect(t.bearbeitung.stand.value?.felder.farbe).toBe("#c40304");
    });

    it("409 `lock_required` und `object_locked` stehen mit dem Satz des Servers da, der Entwurf bleibt", async () => {
        const t = aufbau([
            { ok: false, status: 409, fehler: { code: "lock_required", message: "Erst die Sperre nehmen." } },
        ]);
        await bereit(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, name: "Neu" }));
        await t.bearbeitung.fertig();
        expect(t.bearbeitung.zustand.value).toMatchObject({ art: "abgelehnt", code: "lock_required" });
        expect(t.bearbeitung.stand.value?.felder.name).toBe("Neu");
    });

    it("eine Farbe, die keine ist, sperrt „Fertig“ mit Grund und schreibt nichts", async () => {
        const t = aufbau([]);
        await bereit(t.bearbeitung);
        t.bearbeitung.feld((f) => ({ ...f, farbe: "#xyz" }));
        expect(t.bearbeitung.lage.value.grund).toBe("Die Farbe ist keine Farbe der Form #rrggbb.");
        await t.bearbeitung.fertig();
        expect(t.geschrieben).toEqual([]);
    });
});

describe("Die geteilte Sperre einer Sprache (WI-0261 S5d2)", () => {
    it("🔴 frei erst, wenn keiner mehr hält: Felder und „Fläche bearbeiten“ halten dieselbe Sprache; eine Frage zugleich", async () => {
        const gib = vi.fn();
        const nimm = vi.fn(async (ziel: EditorLockTarget, teil: EditorLock["part"]): Promise<NimmErgebnis> => ({
            art: "genommen",
            sperre: {
                kind: ziel.kind,
                id: ziel.id,
                part: teil,
                person: { id: "p1", name: "Vali" },
                since: "",
                heartbeatAt: "",
                own: true,
            },
        }));
        const geteilt = createSprachSperre({ nimm, gib, beiVerlust: () => () => undefined, liste: async () => [] });
        const felder = geteilt.halter();
        const form = geteilt.halter();
        const ziel = { kind: "sprache", id: SPRACHE } as const;
        await Promise.all([felder.nimm(ziel, "felder"), form.nimm(ziel, "form")]);
        expect(nimm).toHaveBeenCalledTimes(1);
        form.gib(ziel);
        expect(gib).not.toHaveBeenCalled();
        expect(geteilt.haelt(SPRACHE)).toBe(true);
        felder.gib(ziel);
        expect(gib).toHaveBeenCalledWith(ziel);
        // `unter` nimmt sie für EINEN Schreibweg und gibt sie danach ab.
        const ergebnis = await geteilt.unter(SPRACHE, async () => "geschrieben");
        expect(ergebnis).toBe("geschrieben");
        expect(gib).toHaveBeenCalledTimes(2);
    });
});

describe("Die Farbe im Entwurf auf der Karte (WI-0261 S5d2)", () => {
    it("nur die Sprache im Entwurf nimmt die neue Farbe, alle anderen die ihrer Kachel", () => {
        expect(vorschauFarbe(undefined)).toEqual(["get", "farbe"]);
        expect(vorschauFarbe({ schluessel: "garethi", farbe: "#c40304" })).toEqual([
            "case",
            ["==", ["get", "schluessel"], "garethi"],
            "#c40304",
            ["get", "farbe"],
        ]);
    });
});
