import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    GRUND_ANDERE_STELLE,
    leseOrtsWert,
    ortsFeld,
    ortsSchluessel,
    ortsStelle,
    ortsWert,
    planeOrtsliste,
    wunschliste,
    type OrtsBestand,
    type OrtsEntscheidung,
    type OrtsZeile,
} from "../src/wiki/abgleich/ortsliste.ts";
import type { PlanObjekt } from "../src/wiki/abgleich/plan.ts";
import { entscheideOrte } from "../src/wiki/abgleich/uebernahme/ortsliste.ts";
import type { VorschauZeile } from "../src/wiki/abgleich/uebernahme/protokoll.ts";

/**
 * Die Ortslisten der Literatur im WikiSync (WI-0253, Scheibe Ortslisten), rein, ohne Datenbank.
 *
 * - **Soll (Parität mit Legacy):** Für jeden Fall der Fixture ergeben `wunschliste` und `planeOrtsliste` (nur Zeilen des Wikis und der Redaktion, Legacys Welt) dieselbe
 *   Wunschliste und denselben Plan wie Legacys ECHTE Funktionen (`avesmapsGameLiteraturePlacePlan`, `avesmapsGameLiteratureRoleForKind`, die Ablage der Phase `adventures`;
 *   Orakel `scripts/dev/wiki-ortsliste-orakel.php`): neu = add, geändert = update, entfällt = remove. Ein Tombstone ist bei Legacy ein stilles Überspringen, hier ein Befund.
 * - **Gewollte Abweichung** (Fall `abweichung-andere-stelle`): Steht derselbe Ort als Zeile der Redaktion an einer anderen Stelle, legt Legacy ihn ein zweites Mal an, der WikiSync
 *   nicht (Befund „steht an anderer Stelle“).
 * - **Problemfälle über Legacy hinaus:** eine Zeile ohne belegte Herkunft (`unknown`, so steht der öffentliche Katalog auf der Stage) ist ein Befund, nie eine Änderung; ein Werk
 *   der Redaktion ist ganz eigen; ein Bereich des Legacy-Zugs ist „nur Vorschau“; die Übernahme prüft jede Zeile gegen den Stand von jetzt.
 */

interface LegacyZeile {
    id: number;
    sort_order: number;
    raw_name: string;
    role: string;
    origin: "wiki" | "manual";
    status: "approved" | "suppressed";
}
interface Fall {
    id: string;
    productType: string;
    orte: string[];
    aktuell: LegacyZeile[];
    abweichung?: string;
    erwartet: {
        wunsch: { sort_order: number; raw_name: string; role: string }[];
        plan: {
            add: { sort_order: number; raw_name: string; role: string }[];
            update: { id: number; sort_order: number; raw_name: string; role: string }[];
            remove: { id: number }[];
        };
    };
}

const faelle = (
    JSON.parse(
        readFileSync(fileURLToPath(new URL("./fixtures/wiki-ortsliste-orakel.json", import.meta.url)), "utf8"),
    ) as { faelle: Fall[] }
).faelle;

const bestandAus = (aktuell: readonly LegacyZeile[], redaktion = false): OrtsBestand => ({
    redaktion,
    zeilen: aktuell.map((zeile): OrtsZeile => ({
        id: String(zeile.id),
        stelle: zeile.sort_order,
        schluessel: ortsSchluessel(zeile.raw_name),
        name: zeile.raw_name,
        rolle: zeile.role,
        zustand: zeile.status === "suppressed" ? "suppressed" : "active",
        herkunft: zeile.origin,
    })),
});

/** Legacys Plan aus den Entscheidungen: nur, was übernommen würde. */
function alsLegacyPlan(entscheidungen: readonly OrtsEntscheidung[], bestand: OrtsBestand): Fall["erwartet"]["plan"] {
    const zeileVon = (e: OrtsEntscheidung): number =>
        Number(
            bestand.zeilen.find(
                (zeile) =>
                    zeile.zustand === "active" &&
                    zeile.stelle === e.stelle &&
                    zeile.name === e.alt?.name &&
                    zeile.rolle === e.alt.rolle,
            )?.id,
        );
    const plan: Fall["erwartet"]["plan"] = { add: [], update: [], remove: [] };
    for (const e of entscheidungen.filter((kandidat) => kandidat.wirkung === "uebernommen")) {
        if (e.status === "neu" && e.neu !== null)
            plan.add.push({ sort_order: e.stelle, raw_name: e.neu.name, role: e.neu.rolle });
        else if (e.status === "geaendert" && e.neu !== null)
            plan.update.push({ id: zeileVon(e), sort_order: e.stelle, raw_name: e.neu.name, role: e.neu.rolle });
        else if (e.status === "zu_entfernen") plan.remove.push({ id: zeileVon(e) });
    }
    return plan;
}

describe("WikiSync Ortslisten: Wunschliste und Plan gegen Legacy", () => {
    it("die Fixture ist vom Orakel gefüllt", () => {
        expect(faelle.length).toBeGreaterThanOrEqual(20);
        expect(faelle.every((fall) => fall.erwartet !== undefined)).toBe(true);
    });

    for (const fall of faelle) {
        it(`🔴 Parität: ${fall.id}`, () => {
            const wunsch = wunschliste(fall.orte, fall.productType);
            expect(wunsch.map((w) => ({ sort_order: w.stelle, raw_name: w.name, role: w.rolle }))).toEqual(
                fall.erwartet.wunsch,
            );
            const bestand = bestandAus(fall.aktuell);
            const plan = alsLegacyPlan(planeOrtsliste(wunsch, bestand, false), bestand);
            if (fall.abweichung === "andere_stelle") {
                // Legacy legt den Ort ein zweites Mal an; der WikiSync nennt ihn als eigene Zeile an anderer Stelle.
                expect(fall.erwartet.plan.add).toHaveLength(1);
                expect(plan).toEqual({ add: [], update: [], remove: [] });
                expect(planeOrtsliste(wunsch, bestand, false)).toEqual([
                    expect.objectContaining({
                        status: "neu",
                        eigentuemer: "manual",
                        wirkung: "eigen",
                        grund: GRUND_ANDERE_STELLE,
                    }),
                ]);
                return;
            }
            expect(plan).toEqual(fall.erwartet.plan);
        });
    }
});

describe("WikiSync Ortslisten: Herkunft, Redaktion, Legacy-Zug", () => {
    const zeile = (
        id: number,
        stelle: number,
        name: string,
        rolle: string,
        herkunft: OrtsZeile["herkunft"],
    ): OrtsZeile => ({
        id: String(id),
        stelle,
        schluessel: ortsSchluessel(name),
        name,
        rolle,
        zustand: "active",
        herkunft,
    });
    const wunsch = wunschliste(["Gareth", "Punin"], "gruppenabenteuer");

    it("🔴 eine Zeile ohne belegte Herkunft ist ein Befund, nie eine Änderung (so steht die Stage heute)", () => {
        const bestand: OrtsBestand = {
            redaktion: false,
            zeilen: [
                zeile(1, 0, "Gareth", "start", "unbekannt"),
                zeile(2, 1, "Punim", "play", "unbekannt"),
                zeile(3, 2, "Ulva", "play", "unbekannt"),
            ],
        };
        expect(planeOrtsliste(wunsch, bestand, false)).toEqual([
            expect.objectContaining({ stelle: 1, status: "geaendert", eigentuemer: "unbekannt", wirkung: "befund" }),
            expect.objectContaining({ stelle: 2, status: "zu_entfernen", eigentuemer: "unbekannt", wirkung: "befund" }),
        ]);
    });

    it("🔴 eine Zeile ohne belegte Herkunft, die schon stimmt, ist keine Nachricht", () => {
        const bestand: OrtsBestand = {
            redaktion: false,
            zeilen: [zeile(1, 0, "Gareth", "start", "unbekannt"), zeile(2, 1, "Punin", "play", "unbekannt")],
        };
        expect(planeOrtsliste(wunsch, bestand, false)).toEqual([]);
    });

    it("🔴 ein unbelegter Ort an anderer Stelle wird nicht verdoppelt", () => {
        const bestand: OrtsBestand = {
            redaktion: false,
            zeilen: [zeile(1, 0, "Gareth", "start", "wiki"), zeile(2, 4, "Punin", "play", "unbekannt")],
        };
        expect(planeOrtsliste(wunsch, bestand, false)).toEqual([
            expect.objectContaining({
                stelle: 1,
                status: "neu",
                eigentuemer: "unbekannt",
                wirkung: "befund",
                grund: GRUND_ANDERE_STELLE,
            }),
            expect.objectContaining({ stelle: 4, status: "zu_entfernen", eigentuemer: "unbekannt", wirkung: "befund" }),
        ]);
    });

    it("🔴 ein Werk der Redaktion gehört ihr samt Liste: jede Abweichung ist eigen, auch eine Zeile des Wikis", () => {
        const bestand: OrtsBestand = { redaktion: true, zeilen: [zeile(1, 0, "Gareth", "start", "wiki")] };
        expect(planeOrtsliste(wunsch, bestand, false)).toEqual([
            expect.objectContaining({ stelle: 1, status: "neu", eigentuemer: "manual", wirkung: "eigen" }),
        ]);
    });

    it("solange der Legacy-Zug die Literatur fährt, ist alles nur Vorschau", () => {
        const bestand: OrtsBestand = { redaktion: false, zeilen: [zeile(1, 0, "Gareth", "start", "wiki")] };
        expect(planeOrtsliste(wunsch, bestand, true)).toEqual([
            expect.objectContaining({ stelle: 1, status: "neu", eigentuemer: "legacy", wirkung: "befund" }),
        ]);
    });

    it("Feld und Wert der Zeile: ort_<Stelle>, „Name (Rolle)“ hin und zurück, auch mit Klammern im Namen", () => {
        expect(ortsFeld(3)).toBe("ort_3");
        expect(ortsStelle("ort_3")).toBe(3);
        expect(ortsStelle("title")).toBeNull();
        expect(ortsStelle("ort_x")).toBeNull();
        const wert = { name: "Havena (Siedlung)", rolle: "play" };
        expect(ortsWert(wert)).toBe("Havena (Siedlung) (play)");
        expect(leseOrtsWert(ortsWert(wert))).toEqual(wert);
        expect(leseOrtsWert("Havena (Siedlung)")).toBeNull();
        expect(leseOrtsWert(null)).toBeNull();
    });
});

describe("WikiSync Ortslisten: die Übernahme prüft jede Zeile gegen den Stand von jetzt", () => {
    const WERK = "a0000000-0000-4000-9000-000000000001";
    const objekt = (zeilen: OrtsZeile[], redaktion = false): PlanObjekt => ({
        bereich: "literatur",
        objektArt: "work",
        id: WERK,
        name: "Siegelbruch",
        adresse: "https://de.wiki-aventurica.de/wiki/Siegelbruch",
        zustand: "zugewiesen",
        herkunft: null,
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: new Map(),
        schnappschussUnbekannt: new Set(),
        ortsliste: { zeilen, redaktion },
    });
    const zeile = (
        id: number,
        stelle: number,
        name: string,
        rolle: string,
        zustand: OrtsZeile["zustand"] = "active",
    ): OrtsZeile => ({
        id: String(id),
        stelle,
        schluessel: ortsSchluessel(name),
        name,
        rolle,
        zustand,
        herkunft: "wiki",
    });
    const vorschau = (feld: string, alt: string | null, neu: string | null): VorschauZeile => ({
        id: 1,
        bereich: "literatur",
        objektArt: "work",
        objektId: WERK,
        objektName: "Siegelbruch",
        objekte: 1,
        objektIds: [WERK],
        artikel: "Siegelbruch",
        feld,
        alt,
        altZustand: alt === null ? "kein" : "text",
        neu,
        neuZustand: neu === null ? "kein" : "text",
        eigentuemer: "wiki",
        wirkung: "uebernommen",
    });
    const mit = (o: PlanObjekt): Map<string, PlanObjekt> => new Map([[WERK, o]]);

    it("anlegen, umbenennen, Rolle ändern, entfernen: je ein Schritt, wo die Zeile der Vorschau noch dasteht", () => {
        const o = objekt([zeile(1, 0, "Gareth", "play"), zeile(2, 1, "Punim", "play"), zeile(3, 2, "Ulva", "play")]);
        const ergebnis = entscheideOrte(
            [
                vorschau("ort_0", "Gareth (play)", "Gareth (start)"),
                vorschau("ort_1", "Punim (play)", "Punin (play)"),
                vorschau("ort_2", "Ulva (play)", null),
                vorschau("ort_3", null, "Kuslik (play)"),
            ],
            mit(o),
        );
        expect(ergebnis.befunde).toEqual([]);
        expect(ergebnis.schritte.map((s) => s.art)).toEqual(["aendern", "ersetzen", "entfernen", "anlegen"]);
    });

    it("🔴 hat sich die Zeile seit der Vorschau geändert (oder gehört das Werk jetzt der Redaktion), wird nichts geschrieben", () => {
        const geaendert = entscheideOrte(
            [vorschau("ort_1", "Punim (play)", "Punin (play)"), vorschau("ort_2", null, "Kuslik (play)")],
            mit(objekt([zeile(2, 1, "Anders", "play"), zeile(3, 2, "Schon da", "play")])),
        );
        expect(geaendert.schritte).toEqual([]);
        expect(geaendert.befunde.map((b) => [b.feld, b.befund])).toEqual([
            ["ort_1", "seit_vorschau_geaendert"],
            ["ort_2", "seit_vorschau_geaendert"],
        ]);
        const redaktion = entscheideOrte(
            [vorschau("ort_1", "Punim (play)", "Punin (play)")],
            mit(objekt([zeile(2, 1, "Punim", "play")], true)),
        );
        expect(redaktion.schritte).toEqual([]);
        expect(redaktion.befunde[0]?.grund).toBe("Das Werk gehört inzwischen der Redaktion");
    });

    it("🔴 ein Tombstone, der seit der Vorschau entstand, wird nie wiederbelebt", () => {
        const ergebnis = entscheideOrte(
            [vorschau("ort_1", null, "Punin (play)")],
            mit(objekt([zeile(1, 0, "Gareth", "start"), zeile(9, 7, "Punin", "play", "suppressed")])),
        );
        expect(ergebnis.schritte).toEqual([]);
        expect(ergebnis.befunde[0]?.grund).toBe("Die Redaktion hat den Ort inzwischen aus der Liste genommen");
    });

    it("steht schon da, was das Wiki sagt, ist es kein Schritt; eine Zeile, die die Vorschau nicht übernehmen wollte, auch nicht", () => {
        const o = objekt([zeile(1, 0, "Gareth", "start")]);
        const gleich = entscheideOrte([vorschau("ort_0", "Gareth (play)", "Gareth (start)")], mit(o));
        expect(gleich).toEqual({ schritte: [], befunde: [], schonGleich: 1 });
        const befund = entscheideOrte(
            [{ ...vorschau("ort_1", null, "Punin (play)"), eigentuemer: "unbekannt", wirkung: "befund" }],
            mit(o),
        );
        expect(befund).toEqual({ schritte: [], befunde: [], schonGleich: 0 });
    });
});
