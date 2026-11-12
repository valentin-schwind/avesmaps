import { describe, expect, it } from "vitest";
import {
    WIKISYNC_KLIMAZONEN,
    WIKISYNC_WORT_MUSTER,
    wikisyncPilleGueltig,
    type WikisyncRegelLageOrt,
} from "@avesmaps3d/shared";
import { VORGABE_DATEI } from "../src/wiki/regeln/begriffe-vorgabe.ts";
import {
    BEGRIFFE_VORGABE,
    Begriffstafel,
    familieVon,
    formenDerFamilie,
    grossraumWort,
    pillenGelesen,
} from "../src/wiki/regeln/begriffe.ts";
import { bedSchluessel, leiteAb, regelSchluessel, type Bed } from "../src/wiki/regeln/ableiten.ts";
import { ortsSchluessel, zwischenLagen } from "../src/wiki/regeln/lage.ts";
import type { Flaeche, RegelWissen } from "../src/wiki/regeln/lesen.ts";
import { baueVorschlag, sagtNeues, type BestehendeRegel, type VorschlagDaten } from "../src/wiki/regeln/vorschlag.ts";
import { aufgeloesterTitel, normTitel, type ZielInfo } from "../src/wiki/abgleich/ortsrolle.ts";

/**
 * Die Ableitung der Regelvorschläge (WI-0253 Scheibe Regelvorschläge, §24) – reine Rechnung, ohne Datenbank und ohne Dump.
 *
 * - **Pflichtfälle des Regelbuchs (Abschnitt 6, Akzeptanzkriterium 6):** Wirselkraut (`ohne`, die Reichweite bleibt eine Rückfrage), Aranische Wassernuss („südlich der Linie“ als Teil mit Grund), je ein
 *   vollständiger (Bremse), unvollständiger (Tanne), negierter (Wachtel, Zwiebel) und mehrdeutiger (Krebsschere) Fall.
 * - **F4:** Eine Fläche, die es (noch) nicht gibt, steht als offene Bedingung („!“); der Vorschlag wartet. **F5:** Die Begriffstafel ist die Quelle der Wörter; ein mehrdeutiges Wort startet ohne Pille.
 * - **Familien (F5):** Die Formen EINES Worts (kalt, kalte, kalten, kaltes, kälteren) sind eine Zeile der Begriffstafel; eine Entscheidung unter dem Kopfwort gilt für alle, und die Startwerte einer Familie sind einheitlich.
 * - **Schutz:** eine Regel der Redaktion bleibt, ein Eintrag der Redaktion ist nicht wählbar, eine gleiche Regel ist keine Zeile, eine Regel, die nur Flächen nennt, sagt nichts Neues.
 * - **Lage zu einer Linie (WI-0254, S2):** „südlich von Festum“, „südlich der Linie Havena–Perricum“, „zwischen Riva und Al'Anfa“ werden eine Lage mit Rückfrage `lage`, wo jeder Ort GENAU EINE Siedlung der Karte ist;
 *   alles andere bleibt ein Teil wie ohne Siedlungen im Wissen.
 * - **Großräume (Vali 2026-10-27, Option A):** „Hoher Norden“, „Ewiges Eis“ und „Klirrfrostwüste“ ohne Fläche in der Karte gelten als Klimaspanne innerhalb Aventurien (Rückfrage `grossraum`); eine Fläche mit dem
 *   Wiki-Schlüssel geht vor, leere Pillen in der Tafel schalten den Großraum ab, und ein Großraum ist kein Wort der Wortlesung.
 */

const FLAECHEN: Flaeche[] = [
    { id: "1", kennung: "00000000-0000-4000-8000-000000000001", name: "Aventurien", titel: "Aventurien" },
    { id: "2", kennung: "00000000-0000-4000-8000-000000000002", name: "Meridiana", titel: "Meridiana" },
    { id: "3", kennung: "00000000-0000-4000-8000-000000000003", name: "Orkland", titel: "Orkland" },
    { id: "4", kennung: "00000000-0000-4000-8000-000000000004", name: "Aranien", titel: "Aranien" },
    { id: "5", kennung: "00000000-0000-4000-8000-000000000005", name: "Bornland", titel: "Bornland (Region)" },
    { id: "6", kennung: "00000000-0000-4000-8000-000000000006", name: "Maraskan", titel: "Maraskan" },
    { id: "7", kennung: "00000000-0000-4000-8000-000000000007", name: "Maraskan (Insel)", titel: "Maraskan" },
    { id: "8", kennung: "00000000-0000-4000-8000-000000000008", name: "Thorwal", titel: "Thorwal (Region)" },
    { id: "9", kennung: "00000000-0000-4000-8000-000000000009", name: "Grimmfrostöde", titel: "Grimmfrostöde" },
    { id: "10", kennung: "00000000-0000-4000-8000-000000000010", name: "Nivesenlande", titel: "Nivesenlande" },
];
/** Flächen ohne Wiki-Schlüssel: nur ihr Name ist bekannt. */
const OHNE_SCHLUESSEL: Flaeche[] = [
    { id: "20", kennung: "00000000-0000-4000-8000-000000000020", name: "Der Große Fluss", titel: null },
];

const INFOS: Readonly<Record<string, ZielInfo>> = {
    Orkland: { infobox: "Region", eltern: ["Aventurien"] },
    Weiden: { infobox: "Region", eltern: ["Aventurien"] },
    Meridiana: { infobox: "Region", eltern: ["Aventurien"] },
    Aranien: { infobox: "Region", eltern: ["Aventurien"] },
    "Bornland (Region)": { infobox: "Region", eltern: ["Aventurien"] },
    Maraskan: { infobox: "Region", eltern: ["Aventurien"] },
    Thorwal: { weiterleitung: "Thorwal (Region)" },
    "Thorwal (Region)": { infobox: "Region", eltern: ["Aventurien"] },
    Grimmfrostöde: { infobox: "Region", eltern: ["Aventurien"] },
    Nivesenlande: { infobox: "Region", eltern: ["Aventurien"] },
    // Großräume des Wikis: Regionen ohne Fläche in der Karte.
    "Hoher Norden": { infobox: "Region", eltern: ["Aventurien"] },
    "Ewiges Eis": { infobox: "Region", eltern: ["Aventurien"] },
    Klirrfrostwüste: { infobox: "Region", eltern: ["Aventurien"] },
    Perricum: { infobox: "Siedlung", eltern: ["Aranien"] },
    "Havena (Siedlung)": { infobox: "Siedlung", eltern: ["Aventurien"] },
    "Aventurien (Kontinent)": { weiterleitung: "Aventurien" },
    Festum: { infobox: "Siedlung", eltern: ["Aventurien"] },
    Riva: { infobox: "Siedlung", eltern: ["Aventurien"] },
    "Al'Anfa": { infobox: "Siedlung", eltern: ["Aventurien"] },
    Neuhof: { infobox: "Siedlung", eltern: ["Aventurien"] },
    Yaquir: { infobox: "Fluss", eltern: ["Aventurien"] },
    Glorania: { infobox: "Staat" },
    "Der Große Fluss": { infobox: "Fluss", eltern: ["Aventurien"] },
    // Südaventurien: eine Region ohne Infobox (nur `{{Register Region}}`) und ohne Fläche mit diesem Schlüssel.
    Südaventurien: { register: "Region" },
    Myranor: {},
    "Archipel von Shindrabar": { infobox: "Region", eltern: ["Myranor"] },
    // Landschaftsarten.
    Steppe: { kategorien: ["Vegetationszone"] },
    Wald: { kategorien: ["Vegetationszone"] },
    Sumpf: { kategorien: ["Vegetationszone"] },
    Moor: { weiterleitung: "Sumpf" },
    Graslandschaft: { weiterleitung: "Ebene" },
    Ebene: { kategorien: ["Vegetationszone"] },
};

const nachTitel = new Map<string, Flaeche[]>();
for (const flaeche of FLAECHEN) {
    const schluessel = (flaeche.titel as string).toLowerCase();
    nachTitel.set(schluessel, [...(nachTitel.get(schluessel) ?? []), flaeche]);
}
const nachName = new Map<string, Flaeche[]>();
for (const flaeche of [...FLAECHEN, ...OHNE_SCHLUESSEL]) {
    const schluessel = flaeche.name.toLowerCase();
    nachName.set(schluessel, [...(nachName.get(schluessel) ?? []), flaeche]);
}

/** Die Siedlungen der Karte (Lage zu einer Linie): `y` nach Norden. „Neuhof“ gibt es zweimal (mehrdeutig), „Aranien“ heißt auch ein Dorf (und die Fläche). */
const ort = (nr: number, name: string, x: number, y: number): WikisyncRegelLageOrt => ({
    kennung: `10000000-0000-4000-8000-${String(nr).padStart(12, "0")}`,
    name,
    x,
    y,
});
const ORTE: readonly WikisyncRegelLageOrt[] = [
    ort(1, "Festum", 40, 80),
    ort(2, "Perricum", 70, -40),
    ort(3, "Havena", -30, -20),
    ort(4, "Riva", -60, 140),
    ort(5, "Al'Anfa", 10, -150),
    ort(6, "Neuhof", 0, 0),
    ort(7, "Neuhof", 5, 5),
    ort(8, "Aranien", 20, 20),
    ort(9, "Mengbilla", 200, 10),
    ort(10, "Port Corrad", 90, -60),
];

function wissen(
    abweichungen: ReadonlyMap<string, readonly string[]> = new Map(),
    /** Weitere Flächen mit Wiki-Schlüssel (nur für diesen Fall). */
    zusatz: readonly Flaeche[] = [],
    /** Die Siedlungen der Karte; fehlen sie, liest die Ableitung keine Lage. */
    siedlungen?: readonly WikisyncRegelLageOrt[],
): RegelWissen {
    const jeTitel = new Map<string, readonly Flaeche[]>(nachTitel);
    for (const flaeche of zusatz) {
        const schluessel = (flaeche.titel as string).toLowerCase();
        jeTitel.set(schluessel, [...(jeTitel.get(schluessel) ?? []), flaeche]);
    }
    const basis = {
        info: (titel: string) => INFOS[titel],
        istFlaeche: (titel: string) => jeTitel.has(titel.toLowerCase()),
    };
    return {
        ...basis,
        flaechen: (titel) => jeTitel.get(aufgeloesterTitel(normTitel(titel), basis).toLowerCase()) ?? [],
        flaechenNamen: () => nachName,
        tafel: new Begriffstafel(abweichungen),
        ...(siedlungen === undefined
            ? {}
            : {
                  siedlungen: (name: string) =>
                      siedlungen.filter((kandidat) => ortsSchluessel(kandidat.name) === ortsSchluessel(name)),
              }),
    };
}

interface Fall {
    art?: string;
    verbreitung?: string;
    herkunft?: string;
    regionen?: string;
    vorkommen?: string;
}
const eingabe = (fall: Fall): { art: string; felder: Record<string, string> } => ({
    art: fall.art ?? "fauna",
    felder: {
        ...(fall.verbreitung === undefined ? {} : { roh_verbreitung: fall.verbreitung }),
        ...(fall.herkunft === undefined ? {} : { roh_herkunft: fall.herkunft }),
        ...(fall.regionen === undefined ? {} : { roh_regionen: fall.regionen }),
        ...(fall.vorkommen === undefined ? {} : { roh_vorkommen: fall.vorkommen }),
    },
});

/** Die Kette einer Beziehung als lesbare Zeilen: `verknüpfung Fläche[!] [Arten] (Rückfragen)`. */
function kette(bedingungen: readonly Bed[]): string[] {
    return bedingungen.map((b) =>
        [
            b.verknuepfung,
            b.flaeche === null ? "(überall)" : `${b.flaeche.name}${b.flaeche.offen ? "!" : ""}`,
            `[${b.arten.map((a) => a.art).join("|")}]`,
            b.klima === null ? "" : `${b.klima.von}-${b.klima.bis}`,
            b.lage === undefined ? "" : `${b.lage.richtung}:${b.lage.orte.map((o) => o.name).join("/")}`,
            b.rueckfragen.length === 0 ? "" : `(${b.rueckfragen.join(",")})`,
        ]
            .filter((teil) => teil !== "")
            .join(" "),
    );
}

const leiten = (fall: Fall, abweichungen?: ReadonlyMap<string, readonly string[]>, zusatz?: readonly Flaeche[]) =>
    leiteAb(eingabe(fall), wissen(abweichungen, zusatz));
/** Dasselbe mit den Siedlungen der Karte im Wissen (Lage zu einer Linie). */
const leitenMitOrten = (fall: Fall) => leiteAb(eingabe(fall), wissen(undefined, undefined, ORTE));
const vorschlag = (
    fall: Fall,
    optionen: {
        regeln?: BestehendeRegel[];
        redaktion?: boolean;
        abweichungen?: ReadonlyMap<string, readonly string[]>;
        mitOrten?: boolean;
    } = {},
): VorschlagDaten | null =>
    baueVorschlag(
        optionen.mitOrten === true ? leitenMitOrten(fall) : leiten(fall, optionen.abweichungen),
        {
            id: "e1",
            name: "Eintrag",
            art: fall.art ?? "fauna",
            redaktion: optionen.redaktion ?? false,
            bestand: { wikiKey: "eintrag", regeln: optionen.regeln ?? [] },
        },
        "Eintrag",
    );

describe("Regelvorschläge: die Begriffstafel", () => {
    const tafel = new Begriffstafel();

    it("liest das ganze Wort, den Kopf eines Kompositums und das Bestimmungswort vor einem allgemeinen Kopf", () => {
        expect(tafel.abbildung("Wälder")?.eintrag.pillen).toEqual(["vegetation|wald"]);
        expect(tafel.abbildung("Laubwälder")).toMatchObject({
            form: "",
            eintrag: { wort: "laubwälder", pillen: ["vegetation|wald"] },
        });
        expect(tafel.abbildung("Steppengebiete")?.eintrag.pillen).toEqual(["vegetation|steppe"]);
        // Kompositum über den Kopf am Wortende, wo das Wort selbst nicht in der Tafel steht.
        expect(tafel.abbildung("Eichenhainwälder")).toMatchObject({ form: "kompositum", eintrag: { wort: "wälder" } });
        expect(tafel.abbildung("Wüstenrand")).toMatchObject({ form: "rand", eintrag: { wort: "wüsten" } });
        expect(tafel.abbildung("Nord-")).toBeUndefined();
        expect(tafel.abbildung("gibtesnicht")).toBeUndefined();
    });

    it("🔴 Startwerte: Regenwald ist Dschungel, Küste ist Küste, Flachküste und Steilküste, Heide ist Heideland, Savanne ist Savanne", () => {
        expect(tafel.eintrag("regenwald")?.pillen).toEqual(["vegetation|dschungel"]);
        expect(tafel.eintrag("küste")?.pillen).toEqual([
            "topographie|kueste",
            "topographie|flachkueste",
            "topographie|steilkueste",
        ]);
        // Bis 2026-11-09 eine Näherung auf Graslandschaft, seitdem eine eigene Art (WI-0301).
        expect(tafel.eintrag("heide")).toMatchObject({ pillen: ["vegetation|heideland"], lage: "gleichwertig" });
        expect(tafel.eintrag("heidelandschaften")?.pillen).toEqual(["vegetation|heideland"]);
        expect(tafel.eintrag("savannen")).toMatchObject({ pillen: ["vegetation|savanne"], lage: "gleichwertig" });
        expect(tafel.eintrag("ödland")?.pillen).toEqual(["vegetation|oedland"]);
        expect(tafel.eintrag("bergtundra")?.pillen).toEqual(["vegetation|bergtundra"]);
        // Die Savanne ist Kopf eines Kompositums wie die Steppe.
        expect(tafel.abbildung("Dornsavanne")).toMatchObject({ eintrag: { wort: "savanne" }, form: "kompositum" });
    });

    it("🔴 Mehrdeutige Wörter starten ohne Pille und markiert (Gewässer, Hochland, Ebene, immergrün)", () => {
        for (const wort of ["gewässer", "hochland", "ebene", "immergrüne"]) {
            expect(tafel.eintrag(wort), wort).toMatchObject({ pillen: [], lage: "offen" });
        }
        // Eine Lücke (keine passende Art im Modell) hat ebenfalls keine Pille, und ein Kleinstandort wird übergangen.
        expect(tafel.eintrag("flüsse")).toMatchObject({ pillen: [], lage: "luecke", gruppe: "fluss" });
        expect(tafel.eintrag("unterholz")).toMatchObject({ pillen: [], lage: "uebergehen" });
    });

    it("🔴 Eine Zeile der Umgebung überdeckt den Startwert, eine ungültige Pille wird nie gelesen", () => {
        const eigene = new Begriffstafel(
            new Map([
                ["gewässer", ["topographie|see", "topographie|meer"]],
                ["heide", ["gibt|es-nicht"]],
            ]),
        );
        expect(eigene.eintrag("gewässer")).toMatchObject({
            pillen: ["topographie|see", "topographie|meer"],
            lage: "gleichwertig",
            eigen: true,
        });
        expect(eigene.eintrag("heide")?.pillen).toEqual([]);
        // Ein von Hand angelegtes Wort ohne Startwert.
        const neu = new Begriffstafel(new Map([["dämonisch", ["zone|tropisch"]]]));
        expect(neu.eintrag("dämonisch")).toMatchObject({ pillen: ["zone|tropisch"], vorgabe: null, eigen: true });
    });

    it("Klimazonen ergeben eine Spanne von der kältesten bis zur wärmsten Zone", () => {
        expect(pillenGelesen(["zone|tropisch", "zone|subtropen_winterfeucht", "vegetation|wald"])).toEqual({
            arten: [{ ebene: "vegetation", art: "wald" }],
            klima: { von: "subtropen_winterfeucht", bis: "tropisch" },
        });
        expect(pillenGelesen(["vegetation|wald"]).klima).toBeNull();
    });
});

describe("Regelvorschläge: die Wortfamilien der Begriffstafel", () => {
    const woerter = VORGABE_DATEI.woerter;
    const jeFamilie = new Map<string, typeof woerter>();
    for (const eintrag of woerter) jeFamilie.set(eintrag.familie, [...(jeFamilie.get(eintrag.familie) ?? []), eintrag]);

    it("🔴 Jedes Wort der Startwerte hat eine Familie; ihr Kopfwort ist ein Wort der Startwerte und seine eigene Familie; jede Form steht in genau einer Familie", () => {
        expect(woerter.length).toBe(BEGRIFFE_VORGABE.size);
        for (const eintrag of woerter) {
            expect(eintrag.familie, eintrag.wort).not.toBe("");
            const kopf = BEGRIFFE_VORGABE.get(eintrag.familie);
            expect(kopf, `Kopfwort von ${eintrag.wort}`).toBeDefined();
            expect(kopf?.familie, `Kopfwort ${eintrag.familie}`).toBe(eintrag.familie);
            expect(familieVon(eintrag.wort)).toBe(eintrag.familie);
            expect(formenDerFamilie(eintrag.familie)).toContain(eintrag.wort);
        }
        const alleFormen = [...jeFamilie.keys()].flatMap((kopf) => formenDerFamilie(kopf));
        expect(alleFormen.length).toBe(woerter.length);
        expect(new Set(alleFormen).size).toBe(woerter.length);
        // Das Kopfwort steht vorn.
        for (const kopf of jeFamilie.keys()) expect(formenDerFamilie(kopf)[0]).toBe(kopf);
        // Ein Wort ohne Startwert ist seine eigene Familie.
        expect(familieVon("dämonisch")).toBe("dämonisch");
        expect(formenDerFamilie("dämonisch")).toEqual(["dämonisch"]);
    });

    it("🔴 Die Startwerte einer Familie sind einheitlich: alle Formen haben dieselbe Gruppe, dieselben Pillen und dieselbe Lage", () => {
        for (const [kopf, formen] of jeFamilie) {
            const erste = formen[0];
            for (const form of formen) {
                expect(form.gruppe, `${kopf}: ${form.wort} (Gruppe)`).toBe(erste?.gruppe);
                expect(form.lage, `${kopf}: ${form.wort} (Lage)`).toBe(erste?.lage);
                expect([...form.pillen].sort(), `${kopf}: ${form.wort} (Pillen)`).toEqual(
                    [...(erste?.pillen ?? [])].sort(),
                );
            }
        }
        // Jede Pille der Startwerte gibt es (eine Art oder eine Klimazone).
        for (const eintrag of woerter) {
            for (const pille of eintrag.pillen)
                expect(wikisyncPilleGueltig(pille), `${eintrag.wort}: ${pille}`).toBe(true);
        }
    });

    it("Die Familien, die Vali nannte: Beugungsformen zusammen, verschiedene Wörter getrennt", () => {
        expect(formenDerFamilie("kalt")).toEqual(["kalt", "kalte", "kalten", "kaltes", "kälteren"]);
        expect(familieVon("kälteren")).toBe("kalt");
        expect(familieVon("wärmeren")).toBe("warm");
        expect(familieVon("kühleren")).toBe("kühl");
        expect(familieVon("heißen")).toBe("heiß");
        expect(familieVon("südländischen")).toBe("südländisch");
        expect(familieVon("wäldern")).toBe("wald");
        expect(familieVon("gewässern")).toBe("gewässer");
        expect(familieVon("hochländer")).toBe("hochland");
        expect(familieVon("immergrüner")).toBe("immergrüne");
        expect(familieVon("trockenen")).toBe("trocken");
        // Die Schreibweisen mit ß und ss sind ein Wort.
        expect(familieVon("süsswasser")).toBe("süßwasser");
        expect(familieVon("gemässigten")).toBe("gemäßigt");
        // Verschiedene Wörter bleiben getrennt.
        expect(familieVon("regenwald")).not.toBe(familieVon("wald"));
        expect(familieVon("brackwasser")).not.toBe(familieVon("wasser"));
        expect(familieVon("flachland")).not.toBe(familieVon("ebene"));
        expect(familieVon("wäldchen")).not.toBe(familieVon("wald"));
        // Berge (das Gebirge) und Berg (der Gipfel) haben verschiedene Startwerte und bleiben getrennt.
        expect(familieVon("berge")).toBe("berge");
        expect(familieVon("bergen")).toBe("berg");
    });

    it("🔴 Eine Entscheidung unter dem Kopfwort gilt für alle Formen der Familie", () => {
        const tafel = new Begriffstafel(new Map([["kalt", ["zone|gemaessigt"]]]));
        for (const form of ["kalt", "kalte", "kalten", "kaltes", "kälteren"]) {
            expect(tafel.eintrag(form), form).toMatchObject({
                wort: form,
                familie: "kalt",
                pillen: ["zone|gemaessigt"],
                lage: "gleichwertig",
                eigen: true,
            });
        }
        // Die anderen Familien bleiben, wie sie sind.
        expect(tafel.eintrag("kühl")).toMatchObject({ pillen: ["zone|boreal", "zone|gemaessigt"], eigen: false });
        // Eine ältere Zeile unter einer anderen Form gilt für die Familie, solange das Kopfwort keine eigene hat; die Zeile des Kopfworts geht vor.
        const aelter = new Begriffstafel(new Map([["kalten", ["zone|polar"]]]));
        expect(aelter.eintrag("kalt")).toMatchObject({ pillen: ["zone|polar"], eigen: true });
        const beide = new Begriffstafel(
            new Map([
                ["kalten", ["zone|polar"]],
                ["kalt", ["zone|boreal"]],
            ]),
        );
        expect(beide.eintrag("kaltes")?.pillen).toEqual(["zone|boreal"]);
        // Ein Wort ohne Startwert ist seine eigene Familie.
        const neu = new Begriffstafel(new Map([["dämonisch", ["zone|tropisch"]]]));
        expect(neu.eintrag("dämonisch")).toMatchObject({ familie: "dämonisch", eigen: true });
        expect(neu.eintrag("dämonische")).toBeUndefined();
    });

    it("Die Tafel zählt Familien: je Kopfwort eine, dazu jedes von Hand angelegte Wort", () => {
        const tafel = new Begriffstafel(new Map([["dämonisch", ["zone|tropisch"]]]));
        const familien = tafel.familien();
        expect(familien.length).toBe(jeFamilie.size + 1);
        expect(new Set(familien.map((f) => f.kopf.wort)).size).toBe(familien.length);
        expect(familien.find((f) => f.kopf.wort === "wald")?.formen).toEqual([
            "wald",
            "walde",
            "waldes",
            "wälder",
            "wäldern",
        ]);
        expect(familien.find((f) => f.kopf.wort === "dämonisch")?.formen).toEqual(["dämonisch"]);
        expect(new Begriffstafel().familien().length).toBe(jeFamilie.size);
    });

    it("🔴 Startnäherungen (Claudia 2026-10-27): Tiefland und Dauerfrost, Trockengebiet, die Wetterwörter als Spanne von Klimazonen, allgemeine Klimawörter werden übergangen", () => {
        const tafel = new Begriffstafel();
        const naeherung = (wort: string, pillen: string[]): void => {
            expect(tafel.eintrag(wort), wort).toMatchObject({ pillen, lage: "naeherung", eigen: false });
        };
        for (const wort of ["tiefebene", "tiefebenen", "tiefland", "flachland"])
            naeherung(wort, ["topographie|tiefebene"]);
        for (const wort of ["dauerfrostgebiete", "permafrost"])
            naeherung(wort, ["vegetation|tundra", "vegetation|eislandschaft"]);
        for (const wort of ["trockengebiet", "trockengebiete", "trockengebieten"])
            naeherung(wort, ["vegetation|wueste", "vegetation|steppe"]);
        const warm = ["zone|subtropen_winterfeucht", "zone|trockene_subtropen", "zone|subtropisch", "zone|tropisch"];
        for (const wort of [
            "warm",
            "warme",
            "warmen",
            "warmes",
            "wärmere",
            "wärmeren",
            "südländisch",
            "südländische",
            "südländischen",
        ])
            naeherung(wort, warm);
        for (const wort of ["heiß", "heiße", "heißen"]) naeherung(wort, warm.slice(1));
        for (const wort of ["kalt", "kalte", "kalten", "kaltes", "kälteren"])
            naeherung(wort, ["zone|polar", "zone|subpolar", "zone|boreal"]);
        for (const wort of ["kühl", "kühle", "kühlen", "kühleren"]) naeherung(wort, ["zone|boreal", "zone|gemaessigt"]);
        for (const wort of ["klima", "klimazonen", "breiten"])
            expect(tafel.eintrag(wort), wort).toMatchObject({ pillen: [], lage: "uebergehen", gruppe: "klima" });
        // Jede Pille eines Klimaworts ist eine Klimazone.
        for (const eintrag of woerter.filter((e) => e.gruppe === "klima"))
            for (const pille of eintrag.pillen)
                expect(WIKISYNC_KLIMAZONEN as readonly string[]).toContain(pille.replace("zone|", ""));
    });

    it("🔴 Mehrdeutig und Vali überlassen bleiben genau diese Familien: Gewässer, Wasser, Brackwasser (mit Zusammensetzungen), Hochland, Ebene, immergrün, regengrün", () => {
        const offen = [...jeFamilie.entries()]
            .filter(([, formen]) => formen[0]?.lage === "offen")
            .map(([kopf]) => kopf)
            .sort();
        expect(offen).toEqual(
            [
                // Brackwasser mit seinen Zusammensetzungen ist EINE Familie: Vali entscheidet das Wort einmal.
                "brackwasser",
                "ebene",
                "gewässer",
                "hochland",
                "immergrüne",
                "regengrüner",
                "wasser",
            ].sort(),
        );
        const tafel = new Begriffstafel();
        for (const kopf of offen) expect(tafel.eintrag(kopf), kopf).toMatchObject({ pillen: [], lage: "offen" });
        // Sie behalten ihre Kandidaten.
        for (const kopf of offen) expect(BEGRIFFE_VORGABE.get(kopf)?.kandidaten?.length ?? 0, kopf).toBeGreaterThan(0);
    });

    it("🔴 Die Ableitung liest die Familie: Die Entscheidung am Kopfwort gilt für „kalten“, ein Wetterwort ist eine Rückfrage, ein allgemeines Klimawort wird übergangen", () => {
        const fall = { art: "fauna", verbreitung: "kalte [[Nivesenlande]]" };
        const nachStart = leiten(fall).beziehungen[0]?.bedingungen[0];
        expect(nachStart?.klima).toEqual({ von: "polar", bis: "boreal" });
        expect(nachStart?.rueckfragen).toContain("klima");
        expect(vorschlag(fall)).toMatchObject({ typ: "rueckfrage", vorgewaehlt: false });
        // Die Entscheidung am Kopfwort gilt für die Form „kalte“ im Text.
        const entschieden = leiten(fall, new Map([["kalt", ["zone|gemaessigt"]]])).beziehungen[0]?.bedingungen[0];
        expect(entschieden?.klima).toEqual({ von: "gemaessigt", bis: "gemaessigt" });
        // Ein allgemeines Klimawort sagt nichts und bleibt ohne Lücke.
        const allgemein = leiten({ art: "fauna", verbreitung: "[[Nivesenlande]]", vorkommen: "[[Steppe]]n, Klima" });
        expect(kette(allgemein.beziehungen[0]?.bedingungen ?? [])).toEqual(["und Nivesenlande [steppe]"]);
        expect(allgemein.beziehungen[0]?.teile).toEqual([]);
    });
});

describe("Regelvorschläge: die Ableitung (Pflichtfälle des Regelbuchs)", () => {
    it("🔴 vollständig: Bremse – Sümpfe und Steppe in Meridiana oder Orkland, ohne Rückfrage, vorgewählt", () => {
        const fall = {
            verbreitung: "[[Aventurien]]: [[Meridiana]], [[Orkland]]",
            vorkommen: "[[Sumpf|Sümpfe]], [[Steppe]]n (u.a.)",
        };
        const ableitung = leiten(fall);
        expect(ableitung.bewertung.status).toBe("voll");
        expect(kette(ableitung.beziehungen[0]?.bedingungen ?? [])).toEqual([
            "und Meridiana [steppe|suempfe_moore]",
            "oder Orkland [steppe|suempfe_moore]",
        ]);
        const v = vorschlag(fall);
        expect(v).toMatchObject({
            typ: "vollstaendig",
            status: "neu",
            vorgewaehlt: true,
            waehlbar: true,
            wartet: false,
            sperre: null,
        });
    });

    it("🔴 negiert: Wirselkraut – „außer“ ist die dritte Verknüpfung `ohne`; was nach der Verneinung folgt, bleibt eine Rückfrage; Myranor ist keine Bedingung", () => {
        const fall = {
            art: "flora",
            verbreitung:
                "ganz [[Aventurien]] außer Ewiges Eis und Wüste, entlang des [[Der Große Fluss|Großen Flusses]], [[Bornland (Region)|Bornland]], [[Orkland]], [[Thorwal (Region)|Thorwal]]; [[Myranor]]",
            vorkommen: "ganz Aventurien in [[Steppe]]n und [[Graslandschaft]]en",
        };
        const ableitung = leiten(fall);
        expect(kette(ableitung.beziehungen[0]?.bedingungen ?? [])).toEqual([
            "und Aventurien [graslandschaft|steppe]",
            "ohne (überall) [gletscher|eislandschaft] (ohne)",
            "ohne (überall) [wueste] (ohne)",
            // „entlang“ ist Nähe, und die Fläche ist nur über ihren Namen bekannt: offen (F4).
            "oder Der Große Fluss! [graslandschaft|steppe] (naehe,nach_verneinung)",
            "oder Bornland [graslandschaft|steppe] (nach_verneinung)",
            "oder Orkland [graslandschaft|steppe] (nach_verneinung)",
            "oder Thorwal [graslandschaft|steppe] (nach_verneinung)",
        ]);
        expect(ableitung.beziehungen[0]?.bedingungen[3]?.flaeche).toMatchObject({
            offen: true,
            kandidat: "Der Große Fluss",
            kennung: null,
        });
        const v = vorschlag(fall);
        expect(v).toMatchObject({ typ: "wartet", wartet: true, vorgewaehlt: false, waehlbar: true });
        // Ohne die offene Fläche wäre es der negierte Fall.
        const mitFlaeche = vorschlag({
            ...fall,
            verbreitung: "ganz [[Aventurien]] außer Ewiges Eis und Wüste, [[Bornland (Region)|Bornland]]",
        });
        expect(mitFlaeche).toMatchObject({ typ: "negiert", vorgewaehlt: false, wartet: false });
    });

    it("🔴 negiert: Wachtel – „nicht Maraskan“ nimmt beide Flächen mit dem Schlüssel weg (Region und Insel)", () => {
        const fall = { verbreitung: "[[Aventurien]], nicht [[Maraskan]]" };
        expect(kette(leiten(fall).beziehungen[0]?.bedingungen ?? [])).toEqual([
            "und Aventurien []",
            "ohne Maraskan [] (ohne)",
            "ohne Maraskan (Insel) [] (ohne)",
        ]);
        // „Aventurien ohne Maraskan“ sagt etwas Neues: Die Ortszeilen können keine Ausnahme ausdrücken.
        expect(vorschlag(fall)).toMatchObject({ typ: "negiert", status: "neu" });
    });

    it("🔴 negiert: Zwiebel – hinter „ausgenommen“ geht die Liste weiter; ein Herrschaftsgebiet kann keine Bedingung sein und steht als Teil", () => {
        const ableitung = leiten({
            art: "flora",
            verbreitung: "überall, ausgenommen [[Glorania]], [[Grimmfrostöde]], [[Nivesenlande]]",
        });
        const b = ableitung.beziehungen[0];
        expect(kette(b?.bedingungen ?? [])).toEqual([
            "und Aventurien [] (ueberall)",
            "ohne Grimmfrostöde [] (ohne,nach_verneinung)",
            "ohne Nivesenlande [] (ohne,nach_verneinung)",
        ]);
        expect(b?.teile).toEqual([
            expect.objectContaining({ text: "Glorania", grund: "verneinung", art: "nicht_abbildbar" }),
        ]);
    });

    it("🔴 unvollständig: Aranische Wassernuss – „südlich der Linie“ ist ein Teil mit Grund (kein Ort, keine Richtung in der Regelsprache, F2)", () => {
        const fall = {
            art: "flora",
            verbreitung:
                "häufig in [[Aranien]], südlich der Linie [[Perricum]] und [[Havena (Siedlung)|Havena]] gelegentlich",
            vorkommen: "[[Sumpf|Sümpfe]], Marschen und [[Moor]]e",
        };
        const ableitung = leiten(fall);
        const b = ableitung.beziehungen[0];
        expect(kette(b?.bedingungen ?? [])).toEqual(["und Aranien [suempfe_moore]"]);
        expect(b?.teile.map((t) => t.grund).sort()).toEqual(["bezugspunkt", "linie"]);
        expect(b?.teile[0]?.text).toBe("südlich der Linie Perricum und Havena gelegentlich");
        expect(vorschlag(fall)).toMatchObject({ typ: "unvollstaendig", vorgewaehlt: false, waehlbar: true });
        // Der Wortlaut ist erhalten: Der Teil steht rot, das Gelesene unterstrichen.
        const original = ableitung.original.find((o) => o.feld === "verbreitung");
        expect(original?.teile.map((t) => t.zustand)).toEqual(["ok", "fehler"]);
    });

    it("🔴 unvollständig: Tanne – Thorwal allein sagt nur die Ortszeile; „nördliches Bornland“ ist ein Teil, also kein wählbarer Vorschlag", () => {
        const fall = {
            art: "flora",
            verbreitung:
                "nördliches [[Bornland (Region)|Bornland]], [[Thorwal (Region)|Thorwal]], nördliches [[Weiden|Weiden]]",
        };
        const ableitung = leiten(fall);
        expect(kette(ableitung.beziehungen[0]?.bedingungen ?? [])).toEqual(["und Thorwal []"]);
        expect(sagtNeues(ableitung.beziehungen[0]?.bedingungen ?? [])).toBe(false);
        const v = vorschlag(fall);
        expect(v).toMatchObject({ waehlbar: false, sperre: "nichts", typ: "unvollstaendig" });
        expect(v?.regeln[0]?.teile.map((t) => t.grund)).toEqual(["teilflaeche", "teilflaeche"]);
    });

    it("🔴 mehrdeutig und wartend: Krebsschere – Südaventurien hat keinen Schlüssel (offen), „Gewässer“ keine Pille; mit zwei Pillen in der Tafel ist der Teil weg", () => {
        const fall = { art: "flora", verbreitung: "[[Südaventurien]]", vorkommen: "Gewässer" };
        const ableitung = leiten(fall);
        const b = ableitung.beziehungen[0];
        expect(kette(b?.bedingungen ?? [])).toEqual(["und Südaventurien! []"]);
        expect(b?.teile).toEqual([expect.objectContaining({ text: "Gewässer", grund: "wort_offen" })]);
        expect(vorschlag(fall)).toMatchObject({ typ: "wartet", wartet: true, vorgewaehlt: false });
        // F5: Die Begriffstafel entscheidet. Mit See und Meer ist der Satzteil gelesen; die offene Fläche bleibt offen.
        const entschieden = new Map([["gewässer", ["topographie|see", "topographie|meer"]]]);
        const danach = leiten(fall, entschieden).beziehungen[0];
        expect(kette(danach?.bedingungen ?? [])).toEqual(["und Südaventurien! [meer|see]"]);
        expect(danach?.teile).toEqual([]);
        // Ohne die offene Fläche wäre es der mehrdeutige Fall.
        expect(vorschlag({ art: "flora", verbreitung: "[[Aranien]]", vorkommen: "Gewässer" })).toMatchObject({
            typ: "mehrdeutig",
        });
    });

    it("„[[Aventurien]]: ?“ mit Lebensraum ergibt „Art innerhalb Aventurien“ als Rückfrage; eine andere Welt ergibt keine Aussage", () => {
        const platzhalter = leiten({ art: "flora", verbreitung: "[[Aventurien]]: ?", vorkommen: "[[Wald]]" });
        expect(kette(platzhalter.beziehungen[0]?.bedingungen ?? [])).toEqual([
            "und Aventurien [wald] (platzhalter_art)",
        ]);
        const fremd = leiten({ verbreitung: "[[Myranor]]: [[Archipel von Shindrabar]]" });
        expect(fremd.bewertung).toMatchObject({ status: "ohne_aussage", ohneAussage: "fremd" });
        expect(fremd.beziehungen[0]?.bedingungen).toEqual([]);
        expect(vorschlag({ verbreitung: "[[Myranor]]: [[Archipel von Shindrabar]]" })).toBeNull();
    });

    it("Waren: Herkunft und Verbreitung sind zwei Aussagen und bleiben zwei Regeln", () => {
        const v = vorschlag({ art: "ware", herkunft: "[[Aranien]] ([[Wald]])", verbreitung: "[[Meridiana]]" });
        expect(v?.regeln.map((r) => [r.beziehung, r.status])).toEqual([["herkunft", "neu"]]);
        // „Meridiana“ allein sagt nichts Neues (Ortszeile), „Aranien (Wald)“ trägt eine Art.
        expect(v?.regeln[0]?.bedingungen[0]?.arten).toEqual([{ ebene: "vegetation", art: "wald" }]);
    });
});

describe("Regelvorschläge: gegen die Regeln des Eintrags", () => {
    const fall = {
        verbreitung: "[[Aventurien]]: [[Meridiana]], [[Orkland]]",
        vorkommen: "[[Sumpf|Sümpfe]], [[Steppe]]n",
    };
    const abgeleitet = leiten(fall).beziehungen[0]?.bedingungen ?? [];
    const schluessel = regelSchluessel("eintrag", "verbreitung", abgeleitet);
    const bisher = (herkunft: BestehendeRegel["herkunft"], ruleKey = schluessel): BestehendeRegel => ({
        id: "77",
        beziehung: "verbreitung",
        ruleKey,
        herkunft,
        bedingungen: abgeleitet,
    });

    it("🔴 Eine gleiche, vom Wiki abgeleitete Regel ist keine Zeile; eine andere Kette ist `geaendert`; verschwindet die Aussage, `entfaellt` die Regel", () => {
        expect(vorschlag(fall, { regeln: [bisher("wiki_verbreitung")] })).toBeNull();
        const anders = vorschlag(fall, { regeln: [bisher("wiki_verbreitung", "a".repeat(64))] });
        expect(anders).toMatchObject({ status: "geaendert", waehlbar: true });
        expect(anders?.regeln[0]).toMatchObject({ bisherIds: ["77"], bisherSchluessel: ["a".repeat(64)], schluessel });
        const weg = vorschlag({ verbreitung: "[[Aventurien]]: ?" }, { regeln: [bisher("wiki_verbreitung")] });
        expect(weg).toMatchObject({ status: "entfaellt", waehlbar: true, vorgewaehlt: false });
    });

    it("🔴 Eine manuelle Regel (und eine mit unbekannter Herkunft) bleibt: Der Vorschlag ist `manuell` und nicht wählbar", () => {
        for (const herkunft of ["manual", "unknown"] as const) {
            const v = vorschlag(fall, { regeln: [bisher(herkunft, "b".repeat(64))] });
            expect(v, herkunft).toMatchObject({
                typ: "manuell",
                status: "manuell",
                waehlbar: false,
                vorgewaehlt: false,
                sperre: "manuell",
            });
        }
        // Dieselbe Kette wie die manuelle Regel: nichts zu sagen.
        expect(vorschlag(fall, { regeln: [bisher("manual")] })).toBeNull();
    });

    it("Ein Eintrag der Redaktion gehört ihr samt seinen Regeln: gezeigt, aber nicht wählbar", () => {
        expect(vorschlag(fall, { redaktion: true })).toMatchObject({
            waehlbar: false,
            sperre: "redaktion",
            vorgewaehlt: false,
        });
    });

    it("Die Fingerabdrücke unterscheiden `ohne` von `oder` und eine offene von einer zugewiesenen Fläche", () => {
        const a: Bed = {
            verknuepfung: "und",
            flaeche: { name: "X", id: null, kennung: null, offen: true, titel: "X", kandidat: null },
            arten: [],
            klima: null,
            woerter: [],
            rueckfragen: [],
        };
        const b: Bed = { ...a, verknuepfung: "ohne" };
        const c: Bed = {
            ...a,
            flaeche: { ...a.flaeche!, offen: false, id: "1", kennung: "00000000-0000-4000-8000-000000000001" },
        };
        const schluessel3 = [a, b, c].map((x) =>
            regelSchluessel("e", "verbreitung", [
                { ...a, verknuepfung: "und", flaeche: null, arten: [{ ebene: "vegetation", art: "wald" }] },
                x,
            ]),
        );
        expect(new Set(schluessel3).size).toBe(3);
    });
});

describe("Regelvorschläge: Großräume ohne Fläche (Klimaspanne innerhalb Aventurien)", () => {
    /** Eine Fläche der Karte, die den Artikel „Hoher Norden“ trägt. */
    const hoherNorden: Flaeche = {
        id: "30",
        kennung: "00000000-0000-4000-8000-000000000030",
        name: "Hoher Norden",
        titel: "Hoher Norden",
    };

    it("🔴 [[Hoher Norden]] ohne Fläche mit diesem Schlüssel: eine Bedingung Aventurien mit der Spanne polar bis boreal und der Rückfrage grossraum, die Fläche ist nicht offen", () => {
        const fall = { verbreitung: "[[Hoher Norden]]" };
        const b = leiten(fall).beziehungen[0]?.bedingungen ?? [];
        expect(kette(b)).toEqual(["und Aventurien [] polar-boreal (grossraum)"]);
        expect(b[0]).toMatchObject({
            flaeche: { name: "Aventurien", offen: false, kennung: "00000000-0000-4000-8000-000000000001" },
            klima: { von: "polar", bis: "boreal" },
            woerter: ["hoher-norden"],
            rueckfragen: ["grossraum"],
        });
        // Wegen der Rückfrage ist der Vorschlag wählbar, aber nicht vorgewählt – und er wartet nicht mehr.
        expect(vorschlag(fall)).toMatchObject({
            typ: "rueckfrage",
            wartet: false,
            vorgewaehlt: false,
            waehlbar: true,
        });
    });

    it("🔴 Die drei Startwerte: Hoher Norden polar bis boreal, Ewiges Eis polar, Klirrfrostwüste polar bis subpolar", () => {
        const spanne = (titel: string): string[] =>
            kette(leiten({ verbreitung: `[[${titel}]]` }).beziehungen[0]?.bedingungen ?? []);
        expect(spanne("Hoher Norden")).toEqual(["und Aventurien [] polar-boreal (grossraum)"]);
        expect(spanne("Ewiges Eis")).toEqual(["und Aventurien [] polar-polar (grossraum)"]);
        expect(spanne("Klirrfrostwüste")).toEqual(["und Aventurien [] polar-subpolar (grossraum)"]);
    });

    it("🔴 Trägt eine Fläche der Karte den Artikel „Hoher Norden“, gilt sie: normale Fläche, keine Klimaspanne, keine Rückfrage grossraum", () => {
        const b = leiten({ verbreitung: "[[Hoher Norden]]" }, undefined, [hoherNorden]).beziehungen[0]?.bedingungen;
        expect(kette(b ?? [])).toEqual(["und Hoher Norden []"]);
        expect(b?.[0]).toMatchObject({ klima: null, woerter: [], rueckfragen: [], flaeche: { offen: false } });
    });

    it("🔴 Eine Zeile der Umgebung mit leeren Pillen schaltet den Großraum ab: wieder eine offene Fläche, die Regel wartet", () => {
        const aus = new Map([["hoher-norden", [] as string[]]]);
        const fall = { verbreitung: "[[Hoher Norden]]" };
        expect(kette(leiten(fall, aus).beziehungen[0]?.bedingungen ?? [])).toEqual(["und Hoher Norden! []"]);
        expect(vorschlag(fall, { abweichungen: aus })).toMatchObject({ typ: "wartet", wartet: true });
        // Der Abschalter gilt für diese Zeile, die anderen Großräume bleiben.
        expect(kette(leiten({ verbreitung: "[[Ewiges Eis]]" }, aus).beziehungen[0]?.bedingungen ?? [])).toEqual([
            "und Aventurien [] polar-polar (grossraum)",
        ]);
        // Vali ändert die Pillen wie bei jeder Zeile: Die Ableitung liest die Tafel, wie sie dann ist.
        const anders = new Map([["ewiges-eis", ["zone|polar", "zone|subpolar"]]]);
        expect(kette(leiten({ verbreitung: "[[Ewiges Eis]]" }, anders).beziehungen[0]?.bedingungen ?? [])).toEqual([
            "und Aventurien [] polar-subpolar (grossraum)",
        ]);
    });

    it("🔴 Hat das Glied eigene Arten, gelten sie, und die Klimaspanne kommt vom Großraum", () => {
        const b = leiten({ verbreitung: "[[Wald|Wälder]] im [[Hoher Norden]]" }).beziehungen[0]?.bedingungen ?? [];
        expect(kette(b)).toEqual(["und Aventurien [wald] polar-boreal (grossraum)"]);
        expect(b[0]?.woerter).toEqual(expect.arrayContaining(["hoher-norden"]));
    });

    it("🔴 Hat das Glied ein eigenes Klima, gilt die Schnittmenge der Spannen: „kalt“ (polar bis boreal) im Ewigen Eis ist polar; eine leere Schnittmenge fällt auf den Großraum zurück", () => {
        const kalt = leiten({ verbreitung: "kalte [[Ewiges Eis]]" }).beziehungen[0]?.bedingungen ?? [];
        expect(kette(kalt)).toEqual(["und Aventurien [] polar-polar (klima,grossraum)"]);
        expect(kalt[0]?.woerter).toEqual(expect.arrayContaining(["kalte", "ewiges-eis"]));
        // „kühl“ (boreal bis gemäßigt) im Hohen Norden (polar bis boreal): nur boreal.
        const kuehl = leiten({ verbreitung: "kühle [[Hoher Norden]]" }).beziehungen[0]?.bedingungen ?? [];
        expect(kette(kuehl)).toEqual(["und Aventurien [] boreal-boreal (klima,grossraum)"]);
        // „warm“ im Ewigen Eis: nichts gemeinsam, es gilt die Spanne des Großraums.
        const warm = leiten({ verbreitung: "warme [[Ewiges Eis]]" }).beziehungen[0]?.bedingungen ?? [];
        expect(kette(warm)).toEqual(["und Aventurien [] polar-polar (klima,grossraum)"]);
    });

    it("🔴 ohne Hoher Norden heißt ohne Aventurien in polar bis boreal; die Ausnahme-Liste liest den Großraum ebenso", () => {
        const b = leiten({ verbreitung: "[[Aventurien]], nicht [[Hoher Norden]]" }).beziehungen[0]?.bedingungen ?? [];
        expect(kette(b)).toEqual(["und Aventurien []", "ohne Aventurien [] polar-boreal (ohne,grossraum)"]);
        // Hinter „ausgenommen“ geht die Liste weiter: Der Großraum als zweites Glied ist ebenfalls ausgenommen.
        const liste = leiten({ art: "flora", verbreitung: "überall, ausgenommen [[Nivesenlande]], [[Ewiges Eis]]" });
        expect(kette(liste.beziehungen[0]?.bedingungen ?? [])).toEqual([
            "und Aventurien [] (ueberall)",
            "ohne Nivesenlande [] (ohne)",
            "ohne Aventurien [] polar-polar (ohne,nach_verneinung,grossraum)",
        ]);
    });

    it("🔴 Ohne umgebende Fläche in der Karte gilt die Spanne überall; der Großraum zählt als Wort der Begriffstafel", () => {
        const ohneAventurien = new Map(nachTitel);
        ohneAventurien.delete("aventurien");
        const w: RegelWissen = { ...wissen(), flaechen: (titel) => ohneAventurien.get(titel.toLowerCase()) ?? [] };
        const b = leiteAb(eingabe({ verbreitung: "[[Hoher Norden]]" }), w);
        expect(kette(b.beziehungen[0]?.bedingungen ?? [])).toEqual(["und (überall) [] polar-boreal (grossraum)"]);
        const gezaehlt = leiten({ verbreitung: "[[Hoher Norden]], [[Ewiges Eis]]", vorkommen: "[[Wald]]" }).woerter;
        expect(gezaehlt.get("hoher-norden")).toEqual({ n: 1, tafel: true });
        expect(gezaehlt.get("ewiges-eis")).toEqual({ n: 1, tafel: true });
        // Auch ein abgeschalteter Großraum zählt (die Zeile steht in der Tafel); trägt eine Fläche den Artikel, ist er keiner.
        const aus = new Map([["hoher-norden", [] as string[]]]);
        expect(leiten({ verbreitung: "[[Hoher Norden]]" }, aus).woerter.get("hoher-norden")?.n).toBe(1);
        expect(leiten({ verbreitung: "[[Hoher Norden]]" }, undefined, [hoherNorden]).woerter.has("hoher-norden")).toBe(
            false,
        );
    });

    it("🔴 Ein Großraum ist kein Wort: eintrag kennt ihn nicht, die freie Silbe „wüste“ liest wie zuvor über den Kopf, die Familien listen ihn", () => {
        const tafel = new Begriffstafel();
        for (const wort of ["hoher-norden", "ewiges-eis", "klirrfrostwüste"]) {
            expect(tafel.eintrag(wort), wort).toBeUndefined();
            expect(new RegExp(WIKISYNC_WORT_MUSTER, "u").test(wort), wort).toBe(true);
            const zeile = tafel.familien().find((f) => f.kopf.wort === wort);
            expect(zeile, wort).toMatchObject({ kopf: { gruppe: "grossraum", lage: "naeherung", eigen: false } });
            expect(zeile?.formen).toEqual([wort]);
        }
        // Das freie Wort „Klirrfrostwüste“ liest weiter als Kompositum mit dem Kopf „wüste“ (Wüste).
        expect(tafel.abbildung("Klirrfrostwüste")).toMatchObject({
            form: "kompositum",
            eintrag: { wort: "wüste", pillen: ["vegetation|wueste"] },
        });
        // Über den Titel findet nur grossraum() sie, mit der Umgebung, in der die Spanne gilt.
        expect(tafel.grossraum("Klirrfrostwüste")).toMatchObject({
            wort: "klirrfrostwüste",
            pillen: ["zone|polar", "zone|subpolar"],
            innerhalb: "Aventurien",
        });
        expect(tafel.grossraum("Hoher Norden")?.pillen).toEqual(["zone|polar", "zone|subpolar", "zone|boreal"]);
        expect(tafel.grossraum("Wald")).toBeUndefined();
        expect(tafel.grossraum("Aranien")).toBeUndefined();
        expect(grossraumWort("Hoher  Norden")).toBe("hoher-norden");
        // Leere Pillen der Umgebung schalten ihn ab; die Zeile bleibt in der Tafel (Vali kann sie auf ↺ zurücksetzen).
        const aus = new Begriffstafel(new Map([["hoher-norden", []]]));
        expect(aus.grossraum("Hoher Norden")).toBeUndefined();
        expect(aus.familien().find((f) => f.kopf.wort === "hoher-norden")?.kopf).toMatchObject({
            pillen: [],
            eigen: true,
        });
    });
});

describe("Regelvorschläge: die Lage zu einer Linie (WI-0254)", () => {
    const festum = ORTE[0] as WikisyncRegelLageOrt;
    const perricum = ORTE[1] as WikisyncRegelLageOrt;
    const havena = ORTE[2] as WikisyncRegelLageOrt;
    const riva = ORTE[3] as WikisyncRegelLageOrt;
    const alanfa = ORTE[4] as WikisyncRegelLageOrt;
    const kettenVon = (fall: Fall) => kette(leitenMitOrten(fall).beziehungen[0]?.bedingungen ?? []);

    it("🔴 Rahjalieb: „ganz Aventurien südlich von Festum“ ist Aventurien mit der Lage Süd von Festum und der Rückfrage `lage`", () => {
        const fall = { art: "flora", verbreitung: "ganz [[Aventurien (Kontinent)|Aventurien]] südlich von [[Festum]]" };
        const b = leitenMitOrten(fall).beziehungen[0];
        expect(kette(b?.bedingungen ?? [])).toEqual(["und Aventurien [] sued:Festum (lage)"]);
        expect(b?.bedingungen[0]?.lage).toEqual({ richtung: "sued", orte: [festum] });
        expect(b?.teile).toEqual([]);
        expect(leitenMitOrten(fall).bewertung).toMatchObject({ status: "voll", modus: "rueckfrage" });
        // Eine Rückfrage, nie vorgewählt, aber wählbar.
        expect(vorschlag(fall, { mitOrten: true })).toMatchObject({
            typ: "rueckfrage",
            vorgewaehlt: false,
            waehlbar: true,
            status: "neu",
        });
    });

    it("🔴 Weißer Lotos: „südlich der Linie Havena-Perricum“ innerhalb der Fläche davor, dahinter geht die Liste weiter", () => {
        const fall = {
            art: "flora",
            verbreitung: "[[Aventurien]]: südlich der Linie [[Havena (Siedlung)|Havena]]-[[Perricum]], [[Meridiana]]",
        };
        const b = leitenMitOrten(fall).beziehungen[0];
        expect(kettenVon(fall)).toEqual(["und Aventurien [] sued:Havena/Perricum (lage)", "oder Meridiana []"]);
        // Die Orte stehen in der Reihenfolge der Nennung; der Fingerabdruck sortiert sie (A–B ist B–A).
        expect(b?.bedingungen[0]?.lage?.orte).toEqual([havena, perricum]);
        const erste = b?.bedingungen[0] as Bed;
        const umgekehrt: Bed = { ...erste, lage: { richtung: "sued", orte: [perricum, havena] } };
        expect(bedSchluessel(umgekehrt)).toBe(bedSchluessel(erste));
        expect(regelSchluessel("lotos", "verbreitung", [umgekehrt])).toBe(
            regelSchluessel("lotos", "verbreitung", [erste]),
        );
        // Ohne Lage ist es ein anderer Fingerabdruck.
        const ohneLage: Bed = { ...erste };
        delete ohneLage.lage;
        expect(regelSchluessel("lotos", "verbreitung", [ohneLage])).not.toBe(
            regelSchluessel("lotos", "verbreitung", [erste]),
        );
        expect(b?.teile).toEqual([]);
    });

    it("🔴 Bleiche Alara: „zwischen Riva und Al'Anfa“ sind zwei Bedingungen mit UND (Süd von Riva, Nord von Al'Anfa)", () => {
        const fall = { art: "flora", verbreitung: "[[Aventurien]]: zwischen [[Riva|Riva]] und [[Al'Anfa]]" };
        const b = leitenMitOrten(fall).beziehungen[0];
        expect(kette(b?.bedingungen ?? [])).toEqual([
            "und Aventurien [] sued:Riva (lage)",
            "und (überall) [] nord:Al'Anfa (lage)",
        ]);
        expect(b?.bedingungen[0]?.lage).toEqual({ richtung: "sued", orte: [riva] });
        expect(b?.bedingungen[1]?.lage).toEqual({ richtung: "nord", orte: [alanfa] });
        expect(b?.bedingungen[1]?.flaeche).toBeNull();
        expect(b?.teile).toEqual([]);
        expect(vorschlag(fall, { mitOrten: true })).toMatchObject({ typ: "rueckfrage", vorgewaehlt: false });
    });

    it("🔴 Aranische Wassernuss mit Siedlungen: die Linie wird eine Lage; ohne Siedlungen im Wissen bleibt der Teil wie zuvor", () => {
        const fall = {
            art: "flora",
            verbreitung:
                "häufig in [[Aranien]], südlich der Linie [[Perricum]] und [[Havena (Siedlung)|Havena]] gelegentlich",
            vorkommen: "[[Sumpf|Sümpfe]], Marschen und [[Moor]]e",
        };
        const mit = leitenMitOrten(fall).beziehungen[0];
        expect(kette(mit?.bedingungen ?? [])).toEqual([
            "und Aranien [suempfe_moore]",
            "oder (überall) [suempfe_moore] sued:Perricum/Havena (lage)",
        ]);
        expect(mit?.teile).toEqual([]);
        // Ohne Siedlungen: der alte Fall, Wort für Wort.
        const ohne = leiten(fall).beziehungen[0];
        expect(kette(ohne?.bedingungen ?? [])).toEqual(["und Aranien [suempfe_moore]"]);
        expect(ohne?.teile.map((t) => t.grund).sort()).toEqual(["bezugspunkt", "linie"]);
    });

    it("Die Orte als Klartext: Name oder Name-Name, eine eindeutige Siedlung; ohne Rahmen gilt die Lage überall; ein Schluss wie „selten“ stört nicht", () => {
        expect(kettenVon({ verbreitung: "südlich von Festum" })).toEqual(["und (überall) [] sued:Festum (lage)"]);
        expect(kettenVon({ verbreitung: "[[Aventurien]]: östlich von Port Corrad selten" })).toEqual([
            "und Aventurien [] ost:Port Corrad (lage)",
        ]);
        expect(kettenVon({ verbreitung: "[[Aventurien]]: nördlich der Linie Havena-Perricum" })).toEqual([
            "und Aventurien [] nord:Havena/Perricum (lage)",
        ]);
        expect(kettenVon({ verbreitung: "[[Aventurien]]: westlich der Linie Havena – Perricum" })).toEqual([
            "und Aventurien [] west:Havena/Perricum (lage)",
        ]);
        expect(kettenVon({ verbreitung: "[[Aventurien]]: nördlich einer Linie Riva bis Festum" })).toEqual([
            "und Aventurien [] nord:Riva/Festum (lage)",
        ]);
        // Ein Ortslink ohne Artikel im Wiki (`fehlt`) gilt nach dem Anzeigetext; ein Ort, den die Karte nicht kennt, ist keine Lage.
        expect(kettenVon({ verbreitung: "[[Aventurien]]: südlich von [[Mengbilla (Stadt)|Mengbilla]]" })).toEqual([
            "und Aventurien [] sued:Mengbilla (lage)",
        ]);
        expect(kettenVon({ verbreitung: "[[Aventurien]]: südlich von Gibtesnicht" })).toEqual([]);
    });

    it("🔴 Nie raten: ein doppelter Ortsname, ein Flächenname, ein Fluss, ein Link im Schluss, eine zweite Richtung – alles bleibt ein Teil wie ohne Siedlungen", () => {
        const faelle: Fall[] = [
            // Zwei Dörfer heißen Neuhof.
            { verbreitung: "[[Aventurien]]: südlich von [[Neuhof]]" },
            { verbreitung: "[[Aventurien]]: südlich von Neuhof" },
            { verbreitung: "[[Aventurien]]: südlich der Linie [[Neuhof]]-[[Festum]]" },
            // Der Klartext ist ein Flächenname (und ein Dorf heißt auch so); der Link ist eine Fläche.
            { verbreitung: "[[Aventurien]]: südlich von Aranien" },
            { verbreitung: "[[Aventurien]]: südlich von [[Aranien]]" },
            // Yaquir: ein Fluss, und „des“ ist kein „von“; Eternen: „westlich der“.
            { verbreitung: "ganz [[Aventurien]] nördlich des [[Yaquir]]" },
            { verbreitung: "westlich der [[Eternen]] und des [[Regengebirge]]s, [[Altoum]]" },
            // Teilfläche, nicht Lage.
            { verbreitung: "[[Aventurien]]: [[Koschberge]], nördlicher [[Finsterkamm]]" },
            { verbreitung: "[[Aventurien]]: nordöstlich von [[Festum]]" },
            { verbreitung: "[[Aventurien]]: nördlich davon" },
            { verbreitung: "[[Aventurien]]: südlich von [[Festum]] und [[Riva]]" },
            { verbreitung: "[[Aventurien]]: südlich von [[Festum]] früher" },
            { verbreitung: "[[Aventurien]]: nicht südlich von [[Festum]]" },
            { verbreitung: "[[Aventurien]]: südlich der Linie [[Festum]]" },
            { verbreitung: "[[Aventurien]]: zwischen [[Festum]] und [[Festum]]" },
            { verbreitung: "[[Aventurien]]: zwischen [[Festum]] und [[Perricum]] und [[Riva]]" },
            { verbreitung: "[[Aventurien]]: zwischen [[Neuhof]] und [[Riva]]" },
            // Die Ebene davor ist keine Fläche der Karte („überall“ wäre geraten).
            { verbreitung: "[[Südaventurien]]: südlich von [[Festum]]" },
            // Mehr als eine Fläche im Vorsatz.
            { verbreitung: "[[Meridiana]] und [[Orkland]] südlich von [[Festum]]" },
            // Ein Wort im Vorsatz, das nichts abbildet.
            { verbreitung: "Fischteiche südlich von [[Festum]]" },
        ];
        for (const fall of faelle) {
            const mit = leitenMitOrten(fall);
            const ohne = leiten(fall);
            expect(
                mit.beziehungen.flatMap((b) => b.bedingungen).some((b) => b.lage !== undefined),
                fall.verbreitung,
            ).toBe(false);
            expect(mit.beziehungen, fall.verbreitung).toEqual(ohne.beziehungen);
            expect(mit.bewertung.status, fall.verbreitung).toBe(ohne.bewertung.status);
        }
    });

    it("„zwischen A und B“ nach der Karte: Nord und Süd, wo die Orte eher übereinander liegen, sonst West und Ost; die Nennung entscheidet die Reihenfolge", () => {
        // Riva und Al'Anfa liegen übereinander, Festum und Mengbilla nebeneinander (Mengbilla im Osten).
        expect(zwischenLagen(riva, alanfa).map((l) => `${l.richtung}:${l.orte[0]?.name ?? ""}`)).toEqual([
            "sued:Riva",
            "nord:Al'Anfa",
        ]);
        expect(zwischenLagen(alanfa, riva).map((l) => `${l.richtung}:${l.orte[0]?.name ?? ""}`)).toEqual([
            "nord:Al'Anfa",
            "sued:Riva",
        ]);
        expect(kettenVon({ verbreitung: "[[Aventurien]]: zwischen [[Mengbilla]] und [[Festum]]" })).toEqual([
            "und Aventurien [] west:Mengbilla (lage)",
            "und (überall) [] ost:Festum (lage)",
        ]);
        expect(kettenVon({ verbreitung: "[[Aventurien]]: zwischen [[Festum]] und [[Mengbilla]]" })).toEqual([
            "und Aventurien [] ost:Festum (lage)",
            "und (überall) [] west:Mengbilla (lage)",
        ]);
    });

    it("🔴 „zwischen“ rückt als Paar an den Anfang der Kette; steht eine Verneinung im Weg oder ein zweites Paar da, bleibt der Satzteil ein Teil", () => {
        const nachVorn = leitenMitOrten({
            verbreitung: "[[Meridiana]]; [[Aventurien]]: zwischen [[Riva]] und [[Al'Anfa]]",
        });
        expect(kette(nachVorn.beziehungen[0]?.bedingungen ?? [])).toEqual([
            "und Aventurien [] sued:Riva (lage)",
            "und (überall) [] nord:Al'Anfa (lage)",
            "oder Meridiana []",
        ]);
        // Mit Verneinung in der Kette und das Paar nicht am Anfang: kein Paar, ein Teil mit seinem Grund wie zuvor.
        const fallVerneinung = {
            verbreitung: "überall außer [[Maraskan]]; [[Aventurien]]: zwischen [[Riva]] und [[Al'Anfa]]",
        };
        const verneint = leitenMitOrten(fallVerneinung).beziehungen[0];
        expect(verneint?.bedingungen.some((b) => b.lage !== undefined)).toBe(false);
        expect(verneint?.teile.map((t) => t.grund)).toContain("linie");
        expect(verneint?.bedingungen).toEqual(leiten(fallVerneinung).beziehungen[0]?.bedingungen);
        // Das Paar am Anfang darf eine Verneinung dahinter haben.
        const amAnfang = leitenMitOrten({
            verbreitung: "[[Aventurien]]: zwischen [[Riva]] und [[Al'Anfa]]; [[Meridiana]], nicht [[Maraskan]]",
        });
        expect(kette(amAnfang.beziehungen[0]?.bedingungen ?? []).slice(0, 2)).toEqual([
            "und Aventurien [] sued:Riva (lage)",
            "und (überall) [] nord:Al'Anfa (lage)",
        ]);
        // Ein zweites Paar: das zweite bleibt ein Teil.
        const zwei = leitenMitOrten({
            verbreitung: "[[Aventurien]]: zwischen [[Riva]] und [[Al'Anfa]]; zwischen [[Festum]] und [[Perricum]]",
        }).beziehungen[0];
        expect(kette(zwei?.bedingungen ?? [])).toEqual([
            "und Aventurien [] sued:Riva (lage)",
            "und (überall) [] nord:Al'Anfa (lage)",
        ]);
        expect(zwei?.teile.map((t) => t.grund)).toContain("linie");
    });

    it("Ein Eintrag mit Lage und einem Teil, das sich nicht abbilden lässt, ist unvollständig; dieselbe Regel noch einmal ist keine Zeile, eine andere Lage `geaendert`", () => {
        const mitTeil = vorschlag(
            { verbreitung: "[[Aventurien]]: südlich von [[Festum]], nördliches [[Bornland (Region)|Bornland]]" },
            { mitOrten: true },
        );
        expect(mitTeil).toMatchObject({ typ: "unvollstaendig", vorgewaehlt: false });
        expect(mitTeil?.regeln[0]?.teile.map((t) => t.grund)).toEqual(["teilflaeche"]);
        // Die Lage sagt immer etwas Neues (die Ortszeilen kennen keine Richtung).
        const abgeleitet = leitenMitOrten({ verbreitung: "südlich von Festum" }).beziehungen[0]?.bedingungen ?? [];
        expect(sagtNeues(abgeleitet)).toBe(true);
        const bestehend: BestehendeRegel = {
            id: "9",
            beziehung: "verbreitung",
            ruleKey: regelSchluessel("eintrag", "verbreitung", abgeleitet),
            herkunft: "wiki_verbreitung",
            bedingungen: abgeleitet,
        };
        expect(vorschlag({ verbreitung: "südlich von Festum" }, { mitOrten: true, regeln: [bestehend] })).toBeNull();
        expect(
            vorschlag({ verbreitung: "nördlich von Festum" }, { mitOrten: true, regeln: [bestehend] }),
        ).toMatchObject({ status: "geaendert" });
    });
});
