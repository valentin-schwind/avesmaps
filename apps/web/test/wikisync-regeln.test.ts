import { beforeEach, describe, expect, it } from "vitest";
import {
    WIKISYNC_BEGRIFFE_URL,
    WIKISYNC_KLIMAZONEN,
    WIKISYNC_LAGE_RICHTUNGEN,
    WIKISYNC_LANDSCHAFTSARTEN,
    WIKISYNC_REGELN_FLAECHEN_URL,
    WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL,
    WIKISYNC_REGELN_FLAECHE_ZURUECK_URL,
    WIKISYNC_REGELN_UEBERNEHMEN_URL,
    WIKISYNC_REGELN_URL,
    WIKISYNC_REGELN_ZURUECK_URL,
    WIKISYNC_REGEL_ARTEN,
    WIKISYNC_REGEL_GRUENDE,
    WIKISYNC_REGEL_STATUS,
    WIKISYNC_REGEL_TYPEN,
    type WikisyncBegriff,
    type WikisyncRegelBedingung,
    type WikisyncRegelBeziehung,
    type WikisyncRegelLage,
    type WikisyncRegelOffeneFlaeche,
    type WikisyncRegelVorschlag,
} from "@avesmaps3d/shared";
import type { Need } from "../src/auth/bestaetigen.ts";
import { isMessageKey, LOCALES, ladeTafel, locale, t } from "../src/i18n/i18n.ts";
import { createWikisync } from "../src/wikisync/wikisync.ts";
import { anzahl, weitereLadenText, zahl } from "../src/wikisync/wikisync-text.ts";
import {
    alleVonPillen,
    PILLEN_EBENEN,
    bedingungGruppen,
    bedingungKurz,
    bedingungTeile,
    begriffMarke,
    grundName,
    lageSchluessel,
    lageTeile,
    lageText,
    offeneFlaecheFuer,
    pilleName,
    pillenGruppen,
    pillenVorschlaege,
    regelKurz,
    regelZusammenfassung,
    richtungName,
    sperreName,
    typName,
    vorschlagKreis,
    vorschlagKurz,
} from "../src/wikisync/wikisync-regeln-text.ts";

/**
 * Die Fenster „Regelvorschläge“ und „Begriffstafel“ (WI-0253 §24), ohne Dom: die Sätze zu den Bedingungen und Pillen (`wikisync-regeln-text.ts`) und das Speichern im Reiter
 * (`wikisync.ts`). Der Server hier ist nachgebaut: Er hält die Begriffstafel samt Revision, prüft `baseRevision` wie die Route (409 `edit_conflict`), verlangt auf Wunsch den
 * Passkey und nimmt die Übernahme der Regeln entgegen.
 *
 * - **Soll:** Jede Änderung der Begriffstafel geht SOFORT hinaus (kein Speichern-Knopf), zwei Klicks hintereinander bilden eine Reihe mit steigender Revision, ein Passkey wird nur einmal
 *   gefragt; übernommen wird nur, was ausgewählt ist.
 * - **Problemfälle:** eine Fläche, die es noch nicht gibt („!“, „wartet“); `ohne` als dritte Verknüpfung; ein Wort ohne Pille (mehrdeutig); jeder Grund und jede Pille hat einen Namen
 *   in der Sprachtafel (sonst stünde ein Schlüssel auf dem Schirm).
 */

beforeEach(() => {
    locale.value = "de";
});

type Verknuepfung = WikisyncRegelBedingung["verknuepfung"];

const flaeche = (name: string, extra: Partial<NonNullable<WikisyncRegelBedingung["flaeche"]>> = {}) => ({
    name,
    kennung: "0190c0a0-0000-7000-8000-000000000001",
    offen: false,
    titel: name,
    kandidat: null,
    ...extra,
});

const bedingung = (extra: Partial<WikisyncRegelBedingung> = {}): WikisyncRegelBedingung => ({
    verknuepfung: "und",
    flaeche: null,
    arten: [],
    klima: null,
    woerter: [],
    rueckfragen: [],
    ...extra,
});

const beziehung = (
    bedingungen: WikisyncRegelBedingung[],
    extra: Partial<WikisyncRegelBeziehung> = {},
): WikisyncRegelBeziehung => ({
    beziehung: "verbreitung",
    status: "neu",
    bedingungen,
    bisher: null,
    teile: [],
    bisherId: null,
    ...extra,
});

const vorschlag = (
    regeln: WikisyncRegelBeziehung[],
    extra: Partial<WikisyncRegelVorschlag> = {},
): WikisyncRegelVorschlag => ({
    id: 1,
    eintrag: { id: "0190c0a0-0000-7000-8000-000000000002", name: "Wirselkraut", art: "flora" },
    artikel: "Wirselkraut",
    typ: "vollstaendig",
    status: "neu",
    wartet: false,
    vorgewaehlt: true,
    waehlbar: true,
    sperre: null,
    original: [],
    regeln,
    ...extra,
});

describe("Regelvorschläge: die Sätze zu Bedingungen und Regeln", () => {
    it("liest eine Bedingung in ihren vier Formen: Arten in einer Fläche, Arten überall, die Fläche selbst, nur Klima", () => {
        const wald = { ebene: "vegetation", art: "wald" };
        const steppe = { ebene: "vegetation", art: "steppe" };
        expect(bedingungTeile(bedingung({ arten: [wald, steppe], flaeche: flaeche("Aranien") })).form).toBe(
            "flaeche_arten",
        );
        expect(bedingungKurz(bedingung({ arten: [wald, steppe], flaeche: flaeche("Aranien") }))).toBe(
            "Wald oder Steppe · Aranien",
        );
        expect(bedingungTeile(bedingung({ arten: [wald] })).form).toBe("ueberall_arten");
        expect(bedingungKurz(bedingung({ arten: [wald] }))).toBe("Wald");
        expect(bedingungTeile(bedingung({ flaeche: flaeche("Aranien") })).form).toBe("flaeche");
        expect(bedingungKurz(bedingung({ flaeche: flaeche("Aranien") }))).toBe("Aranien");
        expect(bedingungKurz(bedingung({ klima: { von: "gemaessigt", bis: "tropisch" } }))).toBe(
            "Klima Gemäßigte Zone bis Tropische Zone",
        );
        expect(bedingungKurz(bedingung())).toBe("ohne Angabe");
    });

    it("🔴 Eine Fläche, die es noch nicht gibt, trägt „!“ in der Kurzform und ihren Wiki-Namen", () => {
        const offen = bedingung({
            arten: [{ ebene: "topographie", art: "tal" }],
            flaeche: flaeche("Südaventurien", { kennung: null, offen: true, kandidat: "Südaventurien (Region)" }),
        });
        expect(bedingungTeile(offen).flaeche).toEqual({
            name: "Südaventurien",
            offen: true,
            kandidat: "Südaventurien (Region)",
            titel: "Südaventurien",
        });
        expect(bedingungKurz(offen)).toBe("Tal · ! Südaventurien");
    });

    it("🔴 Wirselkraut: `ohne` ist die dritte Verknüpfung und steht als OHNE in der Kette", () => {
        const regel = beziehung([
            bedingung({ flaeche: flaeche("Aventurien") }),
            bedingung({ verknuepfung: "ohne", flaeche: flaeche("Maraskan") }),
            bedingung({ verknuepfung: "oder", flaeche: flaeche("Myranor") }),
        ]);
        expect(regelKurz(regel)).toBe("Aventurien OHNE Maraskan ODER Myranor");
        expect(regelKurz(beziehung([]))).toBe("Keine Bedingung.");
    });

    it("🔴 Wüstenskorpion: ODER-Bedingungen mit denselben Arten stehen in einer Zeile, Arten einmal, doppelte Flächen einmal mit Zahl, „!“ bleibt an der offenen Fläche", () => {
        const arten = [
            { ebene: "vegetation", art: "steppe" },
            { ebene: "vegetation", art: "wueste" },
        ];
        const regel = beziehung([
            bedingung({ arten, flaeche: flaeche("Khôm") }),
            bedingung({ arten, flaeche: flaeche("Khôm"), verknuepfung: "oder" }),
            bedingung({
                arten,
                flaeche: flaeche("Mhanadistan", { kennung: null, offen: true }),
                verknuepfung: "oder",
            }),
            bedingung({ arten, flaeche: flaeche("Aranien"), verknuepfung: "oder" }),
            bedingung({ arten, flaeche: flaeche("Fruchtbare Sichel"), verknuepfung: "oder" }),
            bedingung({ arten, flaeche: flaeche("Balash"), verknuepfung: "oder" }),
        ]);
        const erwartet = "Steppe oder Wüste · Khôm (2 Flächen), ! Mhanadistan, Aranien, Fruchtbare Sichel, Balash";
        expect(regelKurz(regel)).toBe(erwartet);
        expect(vorschlagKurz(vorschlag([regel]))).toBe(erwartet);
        // Nur die Anzeige fasst zusammen: Die Kette der Daten bleibt, die Zusammenfassung steht über ihr.
        expect(regel.bedingungen).toHaveLength(6);
        expect(bedingungGruppen(regel.bedingungen)).toHaveLength(1);
        expect(regelZusammenfassung(regel)).toBe(erwartet);
    });

    it("🔴 Kajubo: dieselbe lange Artenliste steht einmal, dann die Flächen mit Komma", () => {
        const arten = [
            { ebene: "topographie", art: "flachkueste" },
            { ebene: "topographie", art: "kueste" },
            { ebene: "topographie", art: "steilkueste" },
            { ebene: "vegetation", art: "dschungel" },
            { ebene: "vegetation", art: "wald" },
        ];
        const regel = beziehung([
            bedingung({ arten, flaeche: flaeche("Altoum") }),
            bedingung({ arten, flaeche: flaeche("Altoum"), verknuepfung: "oder" }),
            bedingung({ arten, flaeche: flaeche("Souram"), verknuepfung: "oder" }),
            bedingung({ arten, flaeche: flaeche("West-Souram"), verknuepfung: "oder" }),
        ]);
        expect(regelKurz(regel)).toBe(
            "Flachküste oder Küste oder Steilküste oder Dschungel oder Wald · Altoum (2 Flächen), Souram, West-Souram",
        );
    });

    it("🔴 UND und OHNE brechen die Gruppe, ebenso andere Arten oder anderes Klima; ein ODER hinter UND oder OHNE bleibt für sich", () => {
        const wald = [{ ebene: "vegetation", art: "wald" }];
        const steppe = [{ ebene: "vegetation", art: "steppe" }];
        const zone = (von: string, bis: string) => ({ von, bis });
        const w = (name: string, verknuepfung: Verknuepfung, extra: Partial<WikisyncRegelBedingung> = {}) =>
            bedingung({ arten: wald, flaeche: flaeche(name), verknuepfung, ...extra });
        // OHNE bricht, und das ODER dahinter gehört zu allem davor („A OHNE B ODER C“ ist nicht „A OHNE B, C“).
        expect(
            regelKurz(
                beziehung([
                    w("A", "und"),
                    w("B", "oder"),
                    w("C", "ohne"),
                    w("D", "oder"),
                    w("E", "oder"),
                    w("F", "ohne"),
                ]),
            ),
        ).toBe("Wald · A, B OHNE Wald · C ODER Wald · D, E OHNE Wald · F");
        // Zwei OHNE hintereinander bleiben zwei.
        expect(regelKurz(beziehung([w("A", "und"), w("B", "ohne"), w("C", "ohne")]))).toBe(
            "Wald · A OHNE Wald · B OHNE Wald · C",
        );
        // UND mitten in der Kette bricht ebenfalls.
        expect(regelKurz(beziehung([w("A", "und"), w("B", "oder"), w("C", "und"), w("D", "oder")]))).toBe(
            "Wald · A, B UND Wald · C ODER Wald · D",
        );
        // Andere Arten und anderes Klima trennen.
        expect(
            regelKurz(
                beziehung([
                    w("A", "und"),
                    w("B", "oder"),
                    bedingung({ arten: steppe, flaeche: flaeche("C"), verknuepfung: "oder" }),
                    bedingung({ arten: steppe, flaeche: flaeche("D"), verknuepfung: "oder" }),
                ]),
            ),
        ).toBe("Wald · A, B ODER Steppe · C, D");
        expect(
            regelKurz(
                beziehung([
                    w("A", "und", { klima: zone("polar", "boreal") }),
                    w("B", "oder", { klima: zone("polar", "boreal") }),
                    w("C", "oder", { klima: zone("boreal", "gemaessigt") }),
                ]),
            ),
        ).toBe(
            "Wald · A, B · Klima Polare Zone bis Boreale Zone ODER Wald · C · Klima Boreale Zone bis Gemäßigte Zone",
        );
        // Ohne Fläche gibt es nichts aufzulisten: Bedingungen ohne Fläche werden nicht zusammengefasst.
        const ueberall = (verknuepfung: Verknuepfung) => bedingung({ arten: wald, verknuepfung });
        expect(regelKurz(beziehung([ueberall("und"), ueberall("oder")]))).toBe("Wald ODER Wald");
        // Nichts zu fassen: kein Satz über der Kette.
        expect(regelZusammenfassung(beziehung([w("A", "und"), w("B", "ohne")]))).toBeNull();
        // Eine offene Fläche, die doppelt vorkommt, trägt „!“ und die Zahl.
        const offen = (verknuepfung: Verknuepfung) =>
            bedingung({ arten: wald, flaeche: flaeche("Süd", { kennung: null, offen: true }), verknuepfung });
        expect(regelKurz(beziehung([offen("und"), offen("oder")]))).toBe("Wald · ! Süd (2 Flächen)");
    });

    it("Die Zahl der Flächen steht in der Sprache der Seite (Polnisch hat drei Formen)", () => {
        const wald = [{ ebene: "vegetation", art: "wald" }];
        const reihe = (n: number) =>
            beziehung(
                Array.from({ length: n }, (_, i) =>
                    bedingung({ arten: wald, flaeche: flaeche("Süd"), verknuepfung: i === 0 ? "und" : "oder" }),
                ),
            );
        locale.value = "en";
        expect(regelKurz(reihe(2))).toMatch(/Süd \(2 areas\)$/u);
        locale.value = "pl";
        expect(regelKurz(reihe(2))).toMatch(/Süd \(2 obszary\)$/u);
        expect(regelKurz(reihe(5))).toMatch(/Süd \(5 obszarów\)$/u);
    });

    it("zeigt in der Liste die erste Beziehung mit einer Regel und deutet weitere an", () => {
        const eine = vorschlag([beziehung([bedingung({ flaeche: flaeche("Aranien") })])]);
        expect(vorschlagKurz(eine)).toBe("Aranien");
        const zwei = vorschlag([
            beziehung([bedingung({ flaeche: flaeche("Aranien") })], { beziehung: "herkunft" }),
            beziehung([bedingung({ flaeche: flaeche("Thorwal") })]),
        ]);
        expect(vorschlagKurz(zwei)).toBe("Herkunft: Aranien …");
        expect(vorschlagKurz(vorschlag([]))).toBe("keine Regel");
    });

    it("🔴 Der Kreis der Zeile: ● vorgewählt, ◐ wählbar nach Prüfung, ○ nicht wählbar", () => {
        expect(vorschlagKreis({ waehlbar: true, vorgewaehlt: true })).toBe("voll");
        expect(vorschlagKreis({ waehlbar: true, vorgewaehlt: false })).toBe("halb");
        expect(vorschlagKreis({ waehlbar: false, vorgewaehlt: false })).toBe("leer");
    });

    it("nennt jeden Grund, jede Art, jeden Status und jede Sperre in der Sprachtafel (kein Schlüssel auf dem Schirm)", () => {
        for (const grund of WIKISYNC_REGEL_GRUENDE) {
            expect(isMessageKey(`admin.wikisync.regeln.grund.${grund}`), grund).toBe(true);
            expect(grundName(grund)).not.toContain("admin.wikisync");
        }
        for (const typ of WIKISYNC_REGEL_TYPEN) expect(typName(typ)).not.toContain("admin.wikisync");
        for (const art of WIKISYNC_REGEL_ARTEN)
            expect(isMessageKey(`admin.wikisync.regeln.art.${art}`), art).toBe(true);
        for (const status of WIKISYNC_REGEL_STATUS)
            expect(isMessageKey(`admin.wikisync.regeln.status.${status}`), status).toBe(true);
        for (const sperre of ["manuell", "redaktion", "nichts"])
            expect(sperreName(sperre)).not.toContain("admin.wikisync");
        expect(sperreName(null)).toBe("");
    });
});

const GARETH = "0190c0a0-0000-7000-8000-00000000b001";
const HAVENA = "0190c0a0-0000-7000-8000-00000000b002";
const lage = (richtung: WikisyncRegelLage["richtung"], ...namen: string[]): WikisyncRegelLage => ({
    richtung,
    orte: namen.map((name, i) => ({ kennung: i === 0 ? GARETH : HAVENA, name, x: 400 + i * 100, y: 700 })),
});

describe("Regelvorschläge: die Lage zu einer Linie in Sätzen", () => {
    it("🔴 liest die Lage in Worten: ein Ort „südlich von Gareth“, zwei Orte „südlich der Linie Gareth–Havena“; die vier Richtungen haben ihren Namen", () => {
        expect(lageText(lage("sued", "Gareth"))).toBe("südlich von Gareth");
        expect(lageText(lage("nord", "Gareth"))).toBe("nördlich von Gareth");
        expect(lageText(lage("ost", "Gareth", "Havena"))).toBe("östlich der Linie Gareth–Havena");
        expect(lageText(lage("west", "Gareth", "Havena"))).toBe("westlich der Linie Gareth–Havena");
        expect(WIKISYNC_LAGE_RICHTUNGEN.map(richtungName)).toEqual(["nördlich", "südlich", "östlich", "westlich"]);
    });

    it("🔴 die Lage in Stücken setzt nur die Namen der Orte als Ort; die Wörter dazwischen sind die der Sprache", () => {
        expect(lageTeile(lage("sued", "Gareth"))).toEqual([
            { text: "südlich von ", ort: false },
            { text: "Gareth", ort: true },
        ]);
        expect(lageTeile(lage("nord", "Gareth", "Havena"))).toEqual([
            { text: "nördlich der Linie ", ort: false },
            { text: "Gareth", ort: true },
            { text: "–", ort: false },
            { text: "Havena", ort: true },
        ]);
    });

    it("🔴 in jeder Sprache der Seite stehen beide Orte im Satz, ganz, ohne Platzhalter und ohne Markierung; die Stücke ergeben denselben Satz", async () => {
        try {
            for (const sprache of LOCALES) {
                await ladeTafel(sprache);
                locale.value = sprache;
                for (const richtung of WIKISYNC_LAGE_RICHTUNGEN) {
                    for (const l of [lage(richtung, "Gareth"), lage(richtung, "Gareth", "Havena")]) {
                        const satz = lageText(l);
                        const wo = `${sprache} ${richtung} ${String(l.orte.length)}`;
                        for (const o of l.orte) expect(satz, wo).toContain(o.name);
                        expect(satz, wo).not.toMatch(/[{}]|[\uE000\uE001]|admin\.wikisync/u);
                        const stuecke = lageTeile(l);
                        expect(stuecke.map((x) => x.text).join(""), wo).toBe(satz);
                        // Genau die Orte stehen als Ort da, in der Reihenfolge, die die Sprache wählt.
                        expect(
                            stuecke
                                .filter((x) => x.ort)
                                .map((x) => x.text)
                                .sort(),
                            wo,
                        ).toEqual(l.orte.map((o) => o.name).sort());
                        // Der Rest ist nicht leer: Jede Sprache sagt die Richtung.
                        expect(
                            stuecke.some((x) => !x.ort && x.text.trim() !== ""),
                            wo,
                        ).toBe(true);
                    }
                }
            }
        } finally {
            locale.value = "de";
        }
    });

    it("🔴 liest eine Bedingung mit Lage in ihren Formen: nur Lage („alles …“ im Satz, die Lage allein in der Kurzform), Arten in einer Fläche, Arten überall, die Fläche selbst, Klima", () => {
        const wald = { ebene: "vegetation", art: "wald" };
        const sued = lage("sued", "Gareth");
        expect(bedingungTeile(bedingung({ lage: sued })).form).toBe("lage");
        expect(bedingungTeile(bedingung({ lage: sued })).lage).toBe("südlich von Gareth");
        expect(bedingungTeile(bedingung()).lage).toBeNull();
        expect(bedingungKurz(bedingung({ lage: sued }))).toBe("südlich von Gareth");
        expect(bedingungKurz(bedingung({ arten: [wald], lage: sued }))).toBe("Wald · südlich von Gareth");
        expect(bedingungKurz(bedingung({ arten: [wald], flaeche: flaeche("Aventurien"), lage: sued }))).toBe(
            "Wald · Aventurien · südlich von Gareth",
        );
        expect(bedingungKurz(bedingung({ flaeche: flaeche("Aventurien"), lage: sued }))).toBe(
            "Aventurien · südlich von Gareth",
        );
        // Mit Klima zuerst die Lage, dann das Klima, in jeder Form gleich.
        const klima = { von: "gemaessigt", bis: "tropisch" };
        expect(bedingungKurz(bedingung({ lage: sued, klima }))).toBe(
            "südlich von Gareth · Klima Gemäßigte Zone bis Tropische Zone",
        );
        expect(bedingungKurz(bedingung({ arten: [wald], lage: sued, klima }))).toBe(
            "Wald · südlich von Gareth · Klima Gemäßigte Zone bis Tropische Zone",
        );
        // Die Form hängt weiter an Arten, Fläche und Klima; die Lage ändert sie nur, wo sonst nichts da ist.
        expect(bedingungTeile(bedingung({ arten: [wald], lage: sued })).form).toBe("ueberall_arten");
        expect(bedingungTeile(bedingung({ lage: sued, klima })).form).toBe("klima");
        expect(bedingungTeile(bedingung({ flaeche: flaeche("Aventurien"), lage: sued })).form).toBe("flaeche");
    });

    it("🔴 die Regel in einer Zeile nennt die Lage jeder Bedingung; „zwischen A und B“ (zwei Bedingungen mit UND) liest sich als zwei Lagen", () => {
        const zwischen = beziehung([
            bedingung({ lage: lage("sued", "Gareth") }),
            bedingung({
                verknuepfung: "und",
                lage: { ...lage("nord", "Havena"), orte: [{ kennung: HAVENA, name: "Havena", x: 0, y: 0 }] },
            }),
        ]);
        expect(regelKurz(zwischen)).toBe("südlich von Gareth UND nördlich von Havena");
    });

    it("🔴 ODER-Bedingungen mit gleichen Arten fassen nur zusammen, wo auch die Lage gleich ist", () => {
        const wald = [{ ebene: "vegetation", art: "wald" }];
        const f = (name: string, l?: WikisyncRegelLage) =>
            bedingung({
                arten: wald,
                flaeche: flaeche(name),
                verknuepfung: "oder",
                ...(l === undefined ? {} : { lage: l }),
            });
        const kopf = bedingung({ arten: wald, flaeche: flaeche("Aranien") });
        // Gleiche Lage: eine Gruppe.
        expect(bedingungGruppen([kopf, f("Thorwal")]).map((g) => g.length)).toEqual([2]);
        const mitLage = (name: string, l: WikisyncRegelLage) => ({ ...f(name), lage: l });
        const kopfLage = { ...kopf, lage: lage("sued", "Gareth") };
        expect(bedingungGruppen([kopfLage, mitLage("Thorwal", lage("sued", "Gareth"))]).map((g) => g.length)).toEqual([
            2,
        ]);
        // Verschiedene Lage (oder eine ohne): getrennte Gruppen, die Anzeige fasst nichts Falsches zusammen.
        expect(bedingungGruppen([kopfLage, mitLage("Thorwal", lage("nord", "Gareth"))]).map((g) => g.length)).toEqual([
            1, 1,
        ]);
        expect(bedingungGruppen([kopfLage, f("Thorwal")]).map((g) => g.length)).toEqual([1, 1]);
        expect(bedingungGruppen([kopf, mitLage("Thorwal", lage("sued", "Gareth"))]).map((g) => g.length)).toEqual([
            1, 1,
        ]);
    });

    it("der Fingerabdruck der Lage: Richtung und Kennungen, klein und sortiert (A–B ist B–A); ohne Lage leer", () => {
        expect(lageSchluessel(undefined)).toBe("");
        expect(lageSchluessel(lage("sued", "Gareth"))).toBe(`sued:${GARETH}`);
        expect(lageSchluessel(lage("ost", "Gareth", "Havena"))).toBe(`ost:${GARETH},${HAVENA}`);
        const vertauscht = lage("ost", "Gareth", "Havena");
        vertauscht.orte.reverse();
        expect(lageSchluessel(vertauscht)).toBe(`ost:${GARETH},${HAVENA}`);
    });

    it("die Rückfrage „lage“ hat ihren Satz in der Sprachtafel", () => {
        expect(grundName("lage")).toBe("Lage aus dem Wiki gelesen: Orte prüfen");
    });
});

describe("Begriffstafel: die Pillen", () => {
    it("🔴 Jede Landschaftsart und jede Klimazone hat einen Namen in der Sprachtafel; die Gruppe der Pille ist die Ebene oder Klima", () => {
        for (const eintrag of WIKISYNC_LANDSCHAFTSARTEN)
            expect(isMessageKey(`landscape.type.${eintrag.art}`), eintrag.art).toBe(true);
        for (const zone of WIKISYNC_KLIMAZONEN) expect(isMessageKey(`climate.zone.${zone}`), zone).toBe(true);
        const alle = alleVonPillen();
        expect(alle).toHaveLength(WIKISYNC_LANDSCHAFTSARTEN.length + WIKISYNC_KLIMAZONEN.length);
        expect(alle.find((option) => option.pille === "vegetation|wald")).toMatchObject({
            name: "Wald",
            gruppe: "Vegetation",
            ebene: "vegetation",
        });
        expect(alle.find((option) => option.pille === "zone|tropisch")).toMatchObject({
            name: "Tropische Zone",
            gruppe: "Klima",
            ebene: "klima",
        });
        expect(pilleName("topographie|huegelland")).toBe("Hügelland");
    });

    it("🔴 Autovervollständigung: Anfang des Namens vor Teilstück, die Ebene zählt, Vergebene fehlen", () => {
        const alle = alleVonPillen();
        const tippe = (text: string, vergeben: string[] = []) =>
            pillenVorschlaege(text, vergeben, alle).map((o) => o.pille);
        expect(tippe("wald")[0]).toBe("vegetation|wald");
        expect(tippe("wald")).toContain("vegetation|urwald");
        expect(tippe("wald").indexOf("vegetation|wald")).toBeLessThan(tippe("wald").indexOf("vegetation|urwald"));
        expect(tippe("wald", ["vegetation|wald"])).not.toContain("vegetation|wald");
        expect(tippe("tropisch")).toContain("zone|tropisch");
        // Die Gruppe zählt: „klima“ nennt die Zonen, „topographie“ ihre Arten.
        expect(tippe("klima").every((pille) => pille.startsWith("zone|"))).toBe(true);
        expect(tippe("topographie")).toContain("topographie|gebirge");
        expect(tippe("  ")).toHaveLength(alle.length);
        expect(tippe("zzzz")).toEqual([]);
    });

    /**
     * Vali 2026-10-27: „ich kann nur Vegetation auswählen“. Die Auswahl schnitt ohne Suchtext nach vierzehn Einträgen ab, und das waren genau die Arten der Vegetation; Topographie, Regionen und Klimazonen kamen nie.
     * Soll: Ohne Text steht JEDE noch freie Pille da, nach Gruppen geordnet (Vegetation, Topographie, Regionen, Klimazonen), die Namen der Gruppen aus den Sprachtafeln.
     */
    it("🔴 Ohne Suchtext zeigt die Auswahl ALLE freien Pillen, nach Gruppen: Vegetation, Topographie, Regionen, Klimazonen", () => {
        const alle = alleVonPillen();
        const gruppen = pillenGruppen("", [], alle);
        expect(gruppen.map((g) => g.ebene)).toEqual(["vegetation", "topographie", "derographisch", "klima"]);
        expect(gruppen.map((g) => g.ebene)).toEqual([...PILLEN_EBENEN]);
        expect(gruppen.map((g) => g.name)).toEqual(["Vegetation", "Topographie", "Regionen", "Klimazonen"]);
        // Jede Pille steht da, keine zweimal und keine unter der falschen Überschrift.
        expect(gruppen.flatMap((g) => g.optionen)).toHaveLength(alle.length);
        expect(new Set(gruppen.flatMap((g) => g.optionen.map((o) => o.pille))).size).toBe(alle.length);
        for (const gruppe of gruppen) for (const option of gruppe.optionen) expect(option.ebene).toBe(gruppe.ebene);
        const pillen = (ebene: string) => gruppen.find((g) => g.ebene === ebene)?.optionen.map((o) => o.pille) ?? [];
        expect(pillen("vegetation")).toHaveLength(14);
        expect(pillen("topographie")).toContain("topographie|gebirge");
        expect(pillen("topographie")).toContain("topographie|meer");
        expect(pillen("derographisch")).toEqual([
            "derographisch|region",
            "derographisch|inselgruppe",
            "derographisch|kontinent",
            "derographisch|sonstiges",
        ]);
        expect(pillen("klima")).toEqual(WIKISYNC_KLIMAZONEN.map((zone) => `zone|${zone}`));
        // Die Pfeiltasten laufen über die Gruppen hinweg: Die flache Liste ist die Reihenfolge der Gruppen, ohne Überschriften.
        expect(pillenVorschlaege("", [], alle).map((o) => o.pille)).toEqual(
            gruppen.flatMap((g) => g.optionen.map((o) => o.pille)),
        );
        // Vergebenes fehlt, eine leere Gruppe fehlt ganz.
        const ohneKlima = pillenGruppen(
            "",
            WIKISYNC_KLIMAZONEN.map((zone) => `zone|${zone}`),
            alle,
        );
        expect(ohneKlima.map((g) => g.ebene)).toEqual(["vegetation", "topographie", "derographisch"]);
        expect(pillenGruppen("", ["vegetation|wald"], alle)[0]?.optionen.map((o) => o.pille)).not.toContain(
            "vegetation|wald",
        );
    });

    /**
     * Regeleditor (WI-0254 `--weiter`): `wikisync-pillen-wahl.vue` nimmt die Pillen als Prop `optionen`. Die Bedingung einer Regel wählt nur Landschaftsarten, die Klimazonen hat der Streifen;
     * die Auswahl rechnet mit derselben Liste wie die Begriffstafel, nur mit weniger Pillen.
     */
    it("die Auswahl mit eigener Liste (Regeleditor): ohne Klimazonen bleiben die drei Ebenen der Landschaftsarten, die Suche findet auch über den Namen der Ebene", () => {
        const arten = alleVonPillen().filter((option) => option.ebene !== "klima");
        const gruppen = pillenGruppen("", [], arten);
        expect(gruppen.map((g) => g.ebene)).toEqual(["vegetation", "topographie", "derographisch"]);
        expect(gruppen.flatMap((g) => g.optionen)).toHaveLength(WIKISYNC_LANDSCHAFTSARTEN.length);
        expect(pillenVorschlaege("", [], arten).some((o) => o.pille.startsWith("zone|"))).toBe(false);
        // „Vegetation“ nennt alle Arten der Ebene, „Wald“ zuerst Wald und Urwald; Klimazonen kommen auch mit „klima“ nicht.
        expect(pillenGruppen("vegetation", [], arten)[0]?.optionen).toHaveLength(14);
        expect(
            pillenGruppen("wald", [], arten)[0]
                ?.optionen.map((o) => o.pille)
                .slice(0, 2),
        ).toEqual(["vegetation|wald", "vegetation|urwald"]);
        expect(pillenGruppen("klima", [], arten)).toEqual([]);
    });

    it("🔴 Mit Suchtext sind die Treffer gruppiert, in jeder Gruppe Anfang vor Enthalten; die Gruppe zählt mit", () => {
        const alle = alleVonPillen();
        const wald = pillenGruppen("wald", [], alle);
        expect(wald.map((g) => g.ebene)).toEqual(["vegetation"]);
        expect(wald[0]?.optionen.map((o) => o.pille).slice(0, 2)).toEqual(["vegetation|wald", "vegetation|urwald"]);
        // „e“ trifft in mehreren Gruppen; die Gruppen stehen trotzdem in der festen Reihenfolge.
        const e = pillenGruppen("e", [], alle);
        expect(e.length).toBeGreaterThan(2);
        const reihenfolge = e.map((g) => PILLEN_EBENEN.indexOf(g.ebene));
        expect(reihenfolge).toEqual([...reihenfolge].sort((a, b) => a - b));
        for (const gruppe of e) {
            const namen = gruppe.optionen.map((o) => o.name.toLocaleLowerCase());
            const ersteEnthalten = namen.findIndex((n) => !n.startsWith("e"));
            if (ersteEnthalten >= 0) for (const n of namen.slice(ersteEnthalten)) expect(n.startsWith("e")).toBe(false);
        }
        // Die Überschrift zählt: „Klimazonen“ und „Klima“ nennen die Zonen, „Regionen“ die Arten darunter.
        expect(pillenGruppen("klimazonen", [], alle).map((g) => g.ebene)).toEqual(["klima"]);
        expect(pillenGruppen("regionen", [], alle).map((g) => g.ebene)).toEqual(["derographisch"]);
        expect(pillenGruppen("zzzz", [], alle)).toEqual([]);
    });

    it("🔴 Ein mehrdeutiges Wort ohne Pille ist markiert, ein entschiedenes nicht mehr", () => {
        const wort = (extra: Partial<WikisyncBegriff>): WikisyncBegriff => ({
            wort: "gewässer",
            formen: ["gewässer", "gewässern"],
            pillen: [],
            startwert: [],
            lage: "offen",
            eigen: false,
            gesehen: 12,
            hinweis: null,
            geaendertAm: null,
            geaendertVon: null,
            ...extra,
        });
        expect(begriffMarke(wort({}))?.lage).toBe("offen");
        expect(begriffMarke(wort({ pillen: ["topographie|see"], eigen: true }))).toBeNull();
        expect(begriffMarke(wort({ lage: "gleichwertig", pillen: ["vegetation|wald"] }))).toBeNull();
        expect(begriffMarke(wort({ lage: "luecke" }))?.lage).toBe("luecke");
        expect(begriffMarke(wort({ lage: "neu" }))?.lage).toBe("neu");
    });
});

// ── Der Reiter: Speichern und Übernehmen ────────────────────────────────────────────────────────────────────────────────────────────

interface BegriffeWelt {
    revision: number;
    posts: { url: string; body: Record<string, unknown> }[];
    passkey: boolean;
    passkeyNoetig: boolean;
    ablehnen: Response | undefined;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const fehler = (status: number, code: string, details?: Record<string, unknown>): Response =>
    json({ error: { code, message: code, details } }, status);
const QUITTUNG = { environment: "staging", affected: [], derivedWork: [], warnings: [] };

function server(optionen: { passkeyNoetig?: boolean } = {}) {
    const welt: BegriffeWelt = {
        revision: 3,
        posts: [],
        passkey: false,
        passkeyNoetig: optionen.passkeyNoetig ?? false,
        ablehnen: undefined,
    };
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
        const text = String(url);
        const pfad = text.split("?")[0] ?? "";
        await new Promise((fertig) => setTimeout(fertig, 1));
        if (init?.method !== "POST") {
            if (pfad === WIKISYNC_BEGRIFFE_URL)
                return json({
                    jetzt: "2026-10-27T08:00:00Z",
                    revision: welt.revision,
                    quelle: "datenbank",
                    gesamt: 0,
                    offset: 0,
                    limit: 1,
                    zahlen: {},
                    lauf: null,
                    woerter: [],
                });
            return json({});
        }
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        welt.posts.push({ url: pfad, body });
        if (welt.passkeyNoetig && !welt.passkey) return fehler(403, "reauth_required", { need: "passkey" });
        if (welt.ablehnen !== undefined) return welt.ablehnen;
        if (pfad === WIKISYNC_BEGRIFFE_URL) {
            if (body["baseRevision"] !== welt.revision) return fehler(409, "edit_conflict");
            welt.revision += 1;
        }
        return json(QUITTUNG);
    }) as typeof fetch;
    return { welt, fetcher };
}

function seite(optionen: { passkeyNoetig?: boolean; passkeyGeben?: boolean } = {}) {
    const s = server({ passkeyNoetig: optionen.passkeyNoetig ?? false });
    const fragen: Need[] = [];
    const ws = createWikisync({
        fetcher: s.fetcher,
        ask: async (need) => {
            fragen.push(need);
            s.welt.passkey = optionen.passkeyGeben ?? true;
            return s.welt.passkey;
        },
    });
    return { ...s, fragen, ws };
}

/**
 * Vali 2026-10-27: „Weitere 1.307 laden“ stand auf dem Knopf, geladen wurden 100. Soll: Der Text nennt, was der Klick lädt, und was noch aussteht; die letzte Seite sagt, wie viele es noch sind.
 * Problemfälle: genau eine Seite übrig, genau ein Eintrag übrig, eine Sprache mit mehr Zählformen (Polnisch), Tausendertrenner der Sprache.
 */
describe("Nachladen: der Text des Knopfes sagt, was er lädt", () => {
    it('🔴 mehr als eine Seite übrig: "100 weitere laden · noch 1.307"', () => {
        expect(weitereLadenText(100, 1407, 100)).toBe("100 weitere laden · noch 1.307");
        expect(weitereLadenText(0, 101, 100)).toBe("100 weitere laden · noch 101");
    });

    it("🔴 letzte Seite: die Restzahl, nicht die Seitengröße", () => {
        expect(weitereLadenText(1400, 1407, 100)).toBe("Letzte 7 laden");
        expect(weitereLadenText(1307, 1407, 100)).toBe("Letzte 100 laden");
        expect(weitereLadenText(1406, 1407, 100)).toBe("Letzten laden");
        // Mehr geladen als es gibt (die Liste schrumpfte beim Nachladen): kein negativer Rest.
        expect(weitereLadenText(5, 3, 100)).toBe("Letzte 0 laden");
    });

    it("🔴 Der Text folgt der Sprache der Seite, Polnisch hat seine Zählformen", async () => {
        await ladeTafel("en");
        await ladeTafel("pl");
        locale.value = "en";
        expect(weitereLadenText(0, 1307, 100)).toBe("Load 100 more · 1,307 left");
        expect(weitereLadenText(1300, 1307, 100)).toBe("Load the last 7");
        expect(weitereLadenText(1306, 1307, 100)).toBe("Load the last one");
        locale.value = "pl";
        expect(weitereLadenText(1305, 1307, 100)).toBe("Wczytać ostatnie 2");
        expect(weitereLadenText(1300, 1307, 100)).toBe("Wczytać ostatnich 7");
        expect(weitereLadenText(1306, 1307, 100)).toBe("Wczytać ostatni");
        expect(weitereLadenText(0, 1307, 100)).toContain("(100)");
    });
});

describe("Begriffstafel: jede Änderung speichert sofort", () => {
    it("🔴 Eine Pille geht mit der gelesenen Revision hinaus; ↺ schickt `zuruecksetzen`", async () => {
        const { ws, welt } = seite();
        await ws.ladeBegriffe({ limit: 1 });
        const ergebnis = await ws.begriffeSpeichern({ wort: "wald", pillen: ["vegetation|wald", "vegetation|urwald"] });
        expect(ergebnis.ok).toBe(true);
        expect(welt.posts).toHaveLength(1);
        expect(welt.posts[0]?.body).toMatchObject({
            baseRevision: 3,
            aenderungen: [{ wort: "wald", pillen: ["vegetation|wald", "vegetation|urwald"] }],
        });
        await ws.begriffeSpeichern({ wort: "wald", zuruecksetzen: true });
        expect(welt.posts[1]?.body).toMatchObject({
            baseRevision: 4,
            aenderungen: [{ wort: "wald", zuruecksetzen: true }],
        });
    });

    it("🔴 Zwei Klicks hintereinander bilden eine Reihe: die zweite Änderung geht mit der Revision NACH der ersten, kein 409", async () => {
        const { ws, welt } = seite();
        await ws.ladeBegriffe({ limit: 1 });
        const erste = ws.begriffeSpeichern({ wort: "wald", pillen: ["vegetation|wald"] });
        const zweite = ws.begriffeSpeichern({ wort: "steppe", pillen: ["vegetation|steppe"] });
        const dritte = ws.begriffeSpeichern({ wort: "tal", pillen: ["topographie|tal"] });
        const ergebnisse = await Promise.all([erste, zweite, dritte]);
        expect(ergebnisse.map((e) => e.ok)).toEqual([true, true, true]);
        expect(welt.posts.map((post) => post.body["baseRevision"])).toEqual([3, 4, 5]);
        expect(welt.revision).toBe(6);
    });

    it("🔴 Eine Funktion läuft erst, wenn die Reihe an der Änderung ist, und `null` heißt: nichts zu schicken (Erfolg ohne Anfrage)", async () => {
        const { ws, welt } = seite();
        await ws.ladeBegriffe({ limit: 1 });
        const beide = [
            ws.begriffeSpeichern({ wort: "wald", pillen: ["vegetation|wald"] }),
            ws.begriffeSpeichern(() => null),
        ];
        const [erste, nichts] = await Promise.all(beide);
        expect(erste?.ok).toBe(true);
        expect(nichts).toEqual({ ok: true, problems: [] });
        expect(welt.posts).toHaveLength(1);
    });

    it("🔴 Der Passkey wird einmal gefragt (Production), danach geht die Reihe ohne Frage weiter", async () => {
        const { ws, welt, fragen } = seite({ passkeyNoetig: true });
        await ws.ladeBegriffe({ limit: 1 });
        const ergebnisse = await Promise.all([
            ws.begriffeSpeichern({ wort: "wald", pillen: ["vegetation|wald"] }),
            ws.begriffeSpeichern({ wort: "tal", pillen: ["topographie|tal"] }),
        ]);
        expect(ergebnisse.map((e) => e.ok)).toEqual([true, true]);
        expect(fragen).toHaveLength(1);
        expect(welt.revision).toBe(5);
    });

    it("🔴 Nie still: Lehnt der Server ab oder bricht der Passkey ab, steht die Ablehnung im Ergebnis und die Revision bleibt", async () => {
        const abgelehnt = seite();
        await abgelehnt.ws.ladeBegriffe({ limit: 1 });
        abgelehnt.welt.ablehnen = fehler(400, "validation_failed", { reason: "pille_unbekannt", row: "wald" });
        const ergebnis = await abgelehnt.ws.begriffeSpeichern({ wort: "wald", pillen: ["vegetation|wald"] });
        expect(ergebnis.ok).toBe(false);
        expect(ergebnis.problems.map((p) => p.key)).toEqual(["admin.wikisync.tafel.fehler.pille_unbekannt"]);
        expect(abgelehnt.welt.revision).toBe(3);

        const abgebrochen = seite({ passkeyNoetig: true, passkeyGeben: false });
        await abgebrochen.ws.ladeBegriffe({ limit: 1 });
        const nein = await abgebrochen.ws.begriffeSpeichern({ wort: "wald", pillen: ["vegetation|wald"] });
        expect(nein.ok).toBe(false);
        expect(nein.problems.map((p) => p.key)).toEqual(["admin.system.error.notConfirmed"]);
    });

    it("meldet einen bewegten Stand als Konflikt, statt über die Änderung eines anderen zu schreiben", async () => {
        const { ws, welt } = seite();
        await ws.ladeBegriffe({ limit: 1 });
        welt.revision = 9;
        const ergebnis = await ws.begriffeSpeichern({ wort: "wald", pillen: ["vegetation|wald"] });
        expect(ergebnis.ok).toBe(false);
        expect(ergebnis.conflict).toBeDefined();
    });
});

describe("Regelvorschläge: lesen, übernehmen, zurücknehmen", () => {
    it("liest die Liste mit Filtern, die nur gesetzte Teile in die Adresse nehmen", async () => {
        const urls: string[] = [];
        const ws = createWikisync({
            fetcher: (async (url: RequestInfo | URL) => {
                urls.push(String(url));
                return json({
                    jetzt: "x",
                    lauf: null,
                    zahlen: null,
                    gesamt: 0,
                    offset: 0,
                    limit: 100,
                    facetten: { art: {}, typ: {}, status: {} },
                    vorgewaehlt: [],
                    vorschlaege: [],
                    uebernahmen: [],
                });
            }) as typeof fetch,
        });
        await ws.ladeRegeln({ limit: 100, offset: 0, typ: "vollstaendig", q: "Wirsel" });
        await ws.ladeRegeln({});
        expect(urls[0]).toBe(`${WIKISYNC_REGELN_URL}?limit=100&offset=0&typ=vollstaendig&q=Wirsel`);
        expect(urls[1]).toBe(WIKISYNC_REGELN_URL);
    });

    it("🔴 Übernommen wird nur, was ausgewählt ist: der Lauf und genau diese Kennungen gehen hinaus; Warnungen erscheinen je Grund einmal", async () => {
        const posts: Record<string, unknown>[] = [];
        const ws = createWikisync({
            fetcher: (async (url: RequestInfo | URL, init?: RequestInit) => {
                if (init?.method !== "POST") return json({});
                expect(String(url)).toBe(WIKISYNC_REGELN_UEBERNEHMEN_URL);
                posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
                return json({
                    ...QUITTUNG,
                    warnings: [
                        { code: "regel_besteht", message: "a" },
                        { code: "regel_besteht", message: "b" },
                        { code: "manuell", message: "c" },
                        { code: "unbekannter_code_ohne_satz", message: "d" },
                    ],
                });
            }) as typeof fetch,
        });
        const ergebnis = await ws.regelnUebernehmen(7, [11, 12, 15]);
        expect(posts).toHaveLength(1);
        expect(posts[0]).toMatchObject({ lauf: 7, vorschlaege: [11, 12, 15] });
        expect(ergebnis.ok).toBe(true);
        expect(ergebnis.problems.map((p) => p.key)).toEqual([
            "admin.wikisync.fehler.regel_besteht",
            "admin.wikisync.fehler.manuell",
        ]);
        expect(ergebnis.problems.map((p) => t(p.key))).toEqual([
            "Einige Regeln gab es schon.",
            "Regeln der Redaktion bleiben, wie sie sind.",
        ]);
    });

    it("🔴 Eine Ablehnung (veraltete Vorschau, geänderte Begriffstafel, Legacy-Bereich) steht mit ihrem Satz da", async () => {
        const antwort = (code: string) =>
            createWikisync({ fetcher: (async () => fehler(409, code)) as typeof fetch }).regelnUebernehmen(1, [1]);
        for (const code of ["vorschau_veraltet", "begriffe_geaendert", "gehoert_legacy"]) {
            const ergebnis = await antwort(code);
            expect(ergebnis.ok, code).toBe(false);
            expect(
                ergebnis.problems.map((p) => p.key),
                code,
            ).toEqual([`admin.wikisync.fehler.${code}`]);
        }
    });

    it("nimmt eine Übernahme zurück, und eine zweite Rücknahme wird mit ihrem Satz abgewiesen", async () => {
        const posts: Record<string, unknown>[] = [];
        let schon = false;
        const ws = createWikisync({
            fetcher: (async (url: RequestInfo | URL, init?: RequestInit) => {
                if (init?.method !== "POST") return json({});
                expect(String(url)).toBe(WIKISYNC_REGELN_ZURUECK_URL);
                posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
                if (schon) return fehler(409, "schon_zurueckgenommen");
                schon = true;
                return json(QUITTUNG);
            }) as typeof fetch,
        });
        expect((await ws.regelnZuruecknehmen(4)).ok).toBe(true);
        const zweite = await ws.regelnZuruecknehmen(4);
        expect(zweite.ok).toBe(false);
        expect(zweite.problems.map((p) => p.key)).toEqual(["admin.wikisync.fehler.schon_zurueckgenommen"]);
        expect(posts).toEqual([expect.objectContaining({ uebernahme: 4 }), expect.objectContaining({ uebernahme: 4 })]);
    });

    it("🔴 „Neu ableiten“ reiht die Vorschau nur der Vorkommen ein", async () => {
        const bodies: Record<string, unknown>[] = [];
        const ws = createWikisync({
            fetcher: (async (_url: RequestInfo | URL, init?: RequestInit) => {
                if (init?.method === "POST") bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
                return json(init?.method === "POST" ? QUITTUNG : {});
            }) as typeof fetch,
        });
        expect((await ws.vorschauVorkommen()).ok).toBe(true);
        expect(bodies[0]).toMatchObject({ bereiche: ["vorkommen"] });
    });
});

/**
 * Eine Fläche gleichen Namens ohne Wiki-Schlüssel bekommt ihren Artikel (WI-0253 §25), ohne Dom: welche offene Fläche zu welcher Bedingung gehört (der Knopf „zuweisen“ steht nur dort) und was der Reiter
 * hinausschickt. Der Server hier ist nachgebaut; er prüft nichts selbst (das tut der Server der Anwendung, `wikisync-regeln.test.ts` dort).
 *
 * - **Soll:** Der Knopf steht an der Bedingung, deren Artikel UND Kandidat die Übersicht kennt (klein, getrimmt wie in der Ableitung); „Transysilien (Region)“ trägt die Fläche „Transysilien“. Zugeschickt
 *   werden die Kennung der Fläche und der Titel des Artikels; in Production fragt der Server den Passkey, einmal.
 * - **Problemfälle:** eine Bedingung ohne Kandidat (kein Knopf, nichts wird geraten), ein anderer Artikel, eine mehrdeutige oder schon zugewiesene Fläche (kein Knopf, ein Satz statt dessen), jede Ablehnung
 *   des Servers hat ihren Satz in der Sprachtafel.
 */
describe("Offene Flächen: eine Fläche gleichen Namens ohne Wiki-Schlüssel bekommt ihren Artikel", () => {
    const KENNUNG = "0190c0a0-0000-7000-8000-0000000000f1";
    const eintrag = (extra: Partial<WikisyncRegelOffeneFlaeche> = {}): WikisyncRegelOffeneFlaeche => ({
        titel: "Südaventurien",
        name: "Südaventurien",
        kennung: KENNUNG,
        vorschlaege: 130,
        zustand: "zuweisbar",
        zuruecknehmbar: false,
        zugewiesenAm: null,
        zugewiesenVon: null,
        ...extra,
    });
    const offen = (titel: string, kandidat: string | null): WikisyncRegelBedingung =>
        bedingung({ flaeche: flaeche(titel, { kennung: null, offen: true, titel, kandidat }) });

    it("🔴 Zur Bedingung gehört die offene Fläche mit demselben Artikel und demselben Kandidaten (klein, getrimmt); ohne Kandidat gibt es keine", () => {
        expect(offeneFlaecheFuer(offen("Südaventurien", "Südaventurien"), [eintrag()])).toEqual(eintrag());
        // Der Große Fluss: der Artikel groß geschrieben, die Fläche klein.
        const fluss = eintrag({ titel: "Der Große Fluss", name: "Der große Fluss" });
        expect(offeneFlaecheFuer(offen("Der Große Fluss", "Der große Fluss"), [fluss])).toEqual(fluss);
        expect(offeneFlaecheFuer(offen("der große fluss ", "Der große Fluss"), [fluss])).toEqual(fluss);
        // Transysilien (Region): Der Artikel trägt den Klammerzusatz, die Fläche nicht.
        const trans = eintrag({ titel: "Transysilien (Region)", name: "Transysilien" });
        expect(offeneFlaecheFuer(offen("Transysilien (Region)", "Transysilien"), [eintrag(), trans])).toEqual(trans);
        // Nichts wird geraten: ohne Kandidat kein Treffer, bei anderem Artikel oder anderem Namen auch nicht.
        expect(offeneFlaecheFuer(offen("Südaventurien", null), [eintrag()])).toBeUndefined();
        expect(offeneFlaecheFuer(offen("Nordaventurien", "Südaventurien"), [eintrag()])).toBeUndefined();
        expect(offeneFlaecheFuer(offen("Südaventurien", "Nordaventurien"), [eintrag()])).toBeUndefined();
        // Eine Bedingung, die nicht wartet, und eine ohne Fläche.
        expect(offeneFlaecheFuer(bedingung({ flaeche: flaeche("Aranien") }), [eintrag()])).toBeUndefined();
        expect(offeneFlaecheFuer(bedingung(), [eintrag()])).toBeUndefined();
        expect(offeneFlaecheFuer(offen("Südaventurien", "Südaventurien"), [])).toBeUndefined();
    });

    it("🔴 Zuweisen schickt die Kennung der Fläche und den Titel des Artikels; Zurücknehmen nur die Kennung; die Übersicht liest der Reiter ohne Schreiben", async () => {
        const posts: { url: string; body: Record<string, unknown> }[] = [];
        const gelesen: string[] = [];
        const ws = createWikisync({
            fetcher: (async (url: RequestInfo | URL, init?: RequestInit) => {
                if (init?.method !== "POST") {
                    gelesen.push(String(url));
                    return json({ jetzt: "2026-10-27T08:00:00Z", lauf: 12, flaechen: [eintrag()] });
                }
                posts.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
                return json({ ...QUITTUNG, warnings: [{ code: "kein_wiki_stand", message: "x" }] });
            }) as typeof fetch,
        });
        expect((await ws.ladeRegelFlaechen()).flaechen).toEqual([eintrag()]);
        expect(gelesen).toEqual([WIKISYNC_REGELN_FLAECHEN_URL]);
        expect(posts).toEqual([]);

        const ergebnis = await ws.flaecheZuweisen(KENNUNG, "Südaventurien");
        expect(posts).toHaveLength(1);
        expect(posts[0]?.url).toBe(WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL);
        expect(posts[0]?.body).toMatchObject({ flaeche: KENNUNG, titel: "Südaventurien" });
        expect(typeof posts[0]?.body["operationId"]).toBe("string");
        // Der Hinweis „noch kein Wiki-Stand“ ist kein Fehler: Die Zuweisung gilt, der Satz steht dabei.
        expect(ergebnis.ok).toBe(true);
        expect(ergebnis.problems.map((p) => p.key)).toEqual(["admin.wikisync.fehler.kein_wiki_stand"]);

        await ws.flaecheZuruecknehmen(KENNUNG);
        expect(posts[1]?.url).toBe(WIKISYNC_REGELN_FLAECHE_ZURUECK_URL);
        expect(posts[1]?.body).toMatchObject({ flaeche: KENNUNG });
        expect(posts[1]?.body["titel"]).toBeUndefined();
    });

    it("🔴 Jede Ablehnung des Servers hat ihren Satz in der Sprachtafel; ein Passkey wird gefragt, wo der Server ihn verlangt", async () => {
        const codes = [
            "flaeche_hat_schluessel",
            "kein_kandidat",
            "titel_vergeben",
            "mehrdeutig",
            "nicht_zuruecknehmbar",
            "flaeche_weg",
            "kein_lauf",
        ];
        for (const code of codes) {
            const ws = createWikisync({ fetcher: (async () => fehler(409, code)) as typeof fetch });
            const ergebnis = await ws.flaecheZuweisen(KENNUNG, "Südaventurien");
            expect(ergebnis.ok, code).toBe(false);
            expect(
                ergebnis.problems.map((p) => p.key),
                code,
            ).toEqual([`admin.wikisync.fehler.${code}`]);
            expect(isMessageKey(`admin.wikisync.fehler.${code}`), code).toBe(true);
        }
        // Production: Der Server verlangt den frischen Passkey; die Seite fragt einmal und sendet danach.
        const { ws, welt, fragen } = seite({ passkeyNoetig: true });
        const ergebnis = await ws.flaecheZuweisen(KENNUNG, "Südaventurien");
        expect(ergebnis.ok).toBe(true);
        expect(fragen).toHaveLength(1);
        expect(welt.posts.map((p) => p.url)).toEqual([
            WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL,
            WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL,
        ]);
        // Bricht die Bestätigung ab, steht das im Ergebnis, und nichts ist zugewiesen.
        const nein = seite({ passkeyNoetig: true, passkeyGeben: false });
        const abgebrochen = await nein.ws.flaecheZuweisen(KENNUNG, "Südaventurien");
        expect(abgebrochen.ok).toBe(false);
        expect(abgebrochen.problems.map((p) => p.key)).toEqual(["admin.system.error.notConfirmed"]);
    });

    it("🔴 Die Sätze zu den Flächen stehen in der Sprachtafel und setzen Namen, Artikel und Zahl ein", () => {
        expect(t("admin.wikisync.regeln.flaechen.zuweisen", { name: "Südaventurien" })).toBe(
            "„Südaventurien“ zuweisen",
        );
        expect(
            t("admin.wikisync.regeln.flaechen.frage", { name: "Südaventurien", titel: "Südaventurien (Region)" }),
        ).toBe("Die Fläche „Südaventurien“ auf der Karte bekommt den Wiki-Artikel „Südaventurien (Region)“.");
        expect(t("admin.wikisync.regeln.flaechen.folge")).toBe("Danach neu ableiten.");
        expect(t("admin.wikisync.regeln.flaechen.titel", { flaechen: anzahl.flaechen(11) })).toBe(
            "11 Flächen gibt es auf der Karte ohne Wiki-Schlüssel",
        );
        expect(t("admin.wikisync.regeln.flaechen.titel", { flaechen: anzahl.flaechen(1) })).toBe(
            "1 Fläche gibt es auf der Karte ohne Wiki-Schlüssel",
        );
        expect(t("admin.wikisync.regeln.flaechen.warten", { n: zahl(1307) })).toBe("wartende Vorschläge: 1.307");
    });
});
