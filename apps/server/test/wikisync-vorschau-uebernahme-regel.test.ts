import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { wikiNamespaceTafel } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    GRUND_KEIN_WIKI_STAND,
    berechnePlan,
    gesuchteTitelAus,
    hatWikiStand,
    type LokalerWert,
    type Plan,
    type PlanObjekt,
    type PlanZeile,
} from "../src/wiki/abgleich/plan.ts";
import { entscheideZeilen } from "../src/wiki/abgleich/uebernahme/entscheiden.ts";
import { kraftlinieSchreiber } from "../src/wiki/abgleich/uebernahme/kraftlinie.ts";
import type { VorschauZeile } from "../src/wiki/abgleich/uebernahme/protokoll.ts";
import { sammleSeiten } from "../src/wiki/dump/seiten-sammler.ts";
import { baueDump, findeBzip2, neuerOrdner } from "./support/wiki-dump-fixture.ts";

/**
 * Vorschau und Übernahme folgen EINER Regel (WI-0253, erster Lauf auf der Stage 2026-10-26): Die Vorschau sagte bei „Wasserscheide“ und „Septima“ je zwei Übernahmen, die Übernahme schrieb
 * nichts und meldete vier Befunde (`kein_schnappschuss`). ➜ Ursache: Von den fünf Abschnitten je Linie hingen zwei nur mit einer Adresse am Artikel (`address_only`, kein Wiki-Stand). Die Vorschau
 * rechnete ihnen einen leeren Istwert zu („neu“, Eigentümer wiki, Wirkung übernommen); die Übernahme legt an einem Objekt ohne Wiki-Stand nie einen an und ließ die Zeile liegen.
 *
 * Sie widersprachen sich, weil jede ihre eigene Bedingung hatte. Jetzt gibt es die Regel (`hatWikiStand`, `plan.ts`) einmal:
 * - **Ohne Wiki-Stand** ist die Zeile des Felds schon in der Vorschau ein Befund (Wirkung befund, Grund genannt), nie eine Übernahme; die Übernahme überspringt sie still.
 * - **Ein Abschnitt, der nur mit der Adresse am Artikel seiner Linie hängt**, erbt den Stand seiner Linie (`ladeKraftlinien`, wie der Leser); er vergleicht dann wie die anderen Abschnitte, und die
 *   Vorschau meldet nichts, wo der Stand schon dem Wiki gleicht.
 */

const TAFEL = wikiNamespaceTafel();
const bzip2 = findeBzip2();
const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;
const WIKI_TEXT = "Die Wasserscheide ist eine regionale Kraftlinie.";

let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
let dumpPfad: string;
beforeAll(async () => {
    ordner = await neuerOrdner("wikisync-regel");
    dumpPfad = join(ordner.pfad, "dewa_dump_small_20261001.xml");
    await writeFile(
        dumpPfad,
        baueDump([
            {
                titel: "Wasserscheide",
                ns: 0,
                text: `{{Infobox Kraftlinie\n|Name=Wasserscheide\n|Stärke=regional\n}}\n${WIKI_TEXT}`,
            },
        ]),
    );
});
afterAll(async () => {
    await ordner.weg();
});

const lokal = (wert: string | null, vermerk: LokalerWert["vermerk"]): LokalerWert => ({
    zustand: wert === null ? "kein" : "text",
    wert,
    vermerk,
});

interface Stand {
    /** `null`: kein Wiki-Stand (nur eine Adresse). */
    description: string | null | undefined;
    geerbt?: boolean;
}

let zaehler = 0;
function abschnitt(optionen: {
    zustand?: PlanObjekt["zustand"];
    beschreibung?: LokalerWert;
    stand: Stand;
}): PlanObjekt {
    zaehler += 1;
    const id = `a1000000-0000-4000-8000-${String(zaehler).padStart(12, "0")}`;
    return {
        bereich: "kraftlinie",
        objektArt: "powerline",
        id,
        name: "Wasserscheide",
        adresse: wiki("Wasserscheide"),
        zustand: optionen.zustand ?? "zugewiesen",
        herkunft: "unknown",
        hauptzuweisung: true,
        lokal: new Map([
            ["name", lokal("Wasserscheide", "kein")],
            ["description", optionen.beschreibung ?? lokal(null, "kein")],
        ]),
        schnappschuss:
            optionen.stand.description === undefined
                ? null
                : new Map<string, string | null>([
                      ["name", "Wasserscheide"],
                      ["staerke", "regional"],
                      ["affinitaet", null],
                      ["laenge", null],
                      ["regionen", null],
                      ["verlauf", null],
                      ["description", optionen.stand.description],
                  ]),
        schnappschussUnbekannt: new Set(),
        ...(optionen.stand.geerbt === true ? { schnappschussGeerbt: true } : {}),
    };
}

async function plane(objekte: readonly PlanObjekt[]): Promise<Plan> {
    const gelesen = await sammleSeiten(dumpPfad, gesuchteTitelAus(objekte), TAFEL, bzip2 === null ? {} : { bzip2 });
    return berechnePlan({
        bereiche: ["kraftlinie"],
        objekte,
        dump: { gefunden: gelesen.gefunden, kandidaten: [] },
        tafel: TAFEL,
        legacyBereiche: new Set(),
        bekannteTitel: new Set(),
    });
}

/** Die Zeilen der Vorschau, wie die Übernahme sie aus dem Lauf liest. */
function alsLaufZeilen(plan: Plan): VorschauZeile[] {
    return plan.zeilen.flatMap((zeile: PlanZeile, index): VorschauZeile[] =>
        zeile.feld === null
            ? []
            : [
                  {
                      id: index + 1,
                      bereich: zeile.bereich,
                      objektArt: zeile.objektArt,
                      objektId: zeile.objektId,
                      objektName: zeile.objektName,
                      objekte: zeile.objekte,
                      objektIds: zeile.objektIds,
                      artikel: zeile.artikel,
                      feld: zeile.feld,
                      alt: zeile.alt,
                      altZustand: zeile.altZustand,
                      neu: zeile.neu,
                      neuZustand: zeile.neuZustand,
                      eigentuemer: zeile.eigentuemer,
                      wirkung: zeile.wirkung,
                  },
              ],
    );
}

const karte = (objekte: readonly PlanObjekt[]): Map<string, PlanObjekt> => new Map(objekte.map((o) => [o.id, o]));
const uebernehmeVon = (plan: Plan, objekte: readonly PlanObjekt[]) =>
    entscheideZeilen("kraftlinie", alsLaufZeilen(plan), karte(objekte), kraftlinieSchreiber);

describe("Der Fall der Stage: fünf Abschnitte, zwei nur mit Adresse", () => {
    const dreiMitStand = (): PlanObjekt[] => [
        abschnitt({ stand: { description: WIKI_TEXT } }),
        abschnitt({ stand: { description: WIKI_TEXT } }),
        abschnitt({ stand: { description: WIKI_TEXT } }),
    ];

    it("🔴 ohne die Regel sagte die Vorschau „2 Übernahmen“ und die Übernahme schrieb nichts: die zwei Abschnitte ohne Stand sind jetzt ein Befund, und beide sind sich einig", async () => {
        const objekte = [
            ...dreiMitStand(),
            abschnitt({ zustand: "nur_adresse", stand: { description: undefined } }),
            abschnitt({ zustand: "nur_adresse", stand: { description: undefined } }),
        ];
        const plan = await plane(objekte);
        const beschreibung = plan.zeilen.filter((zeile) => zeile.feld === "description");
        // Eine Zeile für die zwei Abschnitte ohne Stand; die drei mit Stand stimmen schon.
        expect(beschreibung).toHaveLength(1);
        expect(beschreibung[0]).toMatchObject({
            objekte: 2,
            alt: null,
            neu: WIKI_TEXT,
            eigentuemer: "wiki",
            status: "neu",
            wirkung: "befund",
            befund: null,
            grund: GRUND_KEIN_WIKI_STAND,
        });
        expect(plan.zahlen.kraftlinie).toMatchObject({ uebernommen: 0, befunde: 1 });

        // Die Übernahme tut daraufhin nichts und meldet auch nichts dazu: Die Vorschau hat es schon gesagt.
        const entscheidung = uebernehmeVon(plan, objekte);
        expect(entscheidung.schritte).toEqual([]);
        expect(entscheidung.befunde).toEqual([]);
    });

    it("🔴 hängen sie am Artikel ihrer Linie, erben sie deren Stand: die Vorschau meldet nichts, die Übernahme nichts", async () => {
        const objekte = [
            ...dreiMitStand(),
            abschnitt({ zustand: "nur_adresse", stand: { description: WIKI_TEXT, geerbt: true } }),
            abschnitt({ zustand: "nur_adresse", stand: { description: WIKI_TEXT, geerbt: true } }),
        ];
        const plan = await plane(objekte);
        expect(plan.zeilen.filter((zeile) => zeile.feld === "description")).toEqual([]);
        expect(plan.zahlen.kraftlinie).toMatchObject({ uebernommen: 0, befunde: 0 });
        const entscheidung = uebernehmeVon(plan, objekte);
        expect(entscheidung.schritte).toEqual([]);
        expect(entscheidung.befunde).toEqual([]);
    });

    it("🔴 hat sich das Wiki bewegt, übernimmt EINE Zeile alle fünf Abschnitte; der Stand wird nur dort geschrieben, wo er hingehört", async () => {
        const eigen = lokal("Alte Beschreibung", "wiki");
        const objekte = [
            ...[0, 1, 2].map(() => abschnitt({ beschreibung: eigen, stand: { description: "Alte Beschreibung" } })),
            ...[0, 1].map(() =>
                abschnitt({
                    zustand: "nur_adresse",
                    beschreibung: eigen,
                    stand: { description: "Alte Beschreibung", geerbt: true },
                }),
            ),
        ];
        const plan = await plane(objekte);
        const beschreibung = plan.zeilen.filter((zeile) => zeile.feld === "description");
        expect(beschreibung).toHaveLength(1);
        expect(beschreibung[0]).toMatchObject({ objekte: 5, wirkung: "uebernommen", eigentuemer: "wiki" });
        expect(plan.zahlen.kraftlinie).toMatchObject({ uebernommen: 1 });

        const entscheidung = uebernehmeVon(plan, objekte);
        expect(entscheidung.befunde).toEqual([]);
        // Die eigene Spalte folgt dem Wiki an allen fünf Abschnitten (auch denen ohne eigenen Stand: Der Name bindet die Linie, die Beschreibung folgt ihr).
        const jeObjekt = (id: string) => entscheidung.schritte.find((schritt) => schritt.objekt.id === id);
        for (const o of objekte) expect(jeObjekt(o.id)?.wirksam, o.id).toMatchObject({ nachher: WIKI_TEXT });
        // Den Wiki-Stand schreiben nur die drei Abschnitte, denen er gehört; die zwei, die ihn erben, haben dort nichts zu schreiben.
        expect(objekte.map((o) => jeObjekt(o.id)?.schnappschuss !== undefined)).toEqual([
            true,
            true,
            true,
            false,
            false,
        ]);
        // Berührt (offene Entwürfe bekommen 409) sind alle fünf Abschnitte der Linie.
        expect(entscheidung.beruehrt).toHaveLength(5);
    });

    it("hatWikiStand: nur ein Objekt mit Schnappschuss hat einen (ein geerbter zählt)", () => {
        expect(hatWikiStand(abschnitt({ stand: { description: "x" } }))).toBe(true);
        expect(hatWikiStand(abschnitt({ stand: { description: "x", geerbt: true } }))).toBe(true);
        expect(hatWikiStand(abschnitt({ zustand: "nur_adresse", stand: { description: undefined } }))).toBe(false);
    });
});

describe("Die Regel gilt für jedes Feld und jeden Zustand: was die Vorschau übernehmen nennt, lehnt die Übernahme nicht ab", () => {
    const BESCHREIBUNGEN: readonly [string, LokalerWert][] = [
        ["kein Wert", lokal(null, "kein")],
        ["eigener Wert, Vermerk wiki", lokal("Alt", "wiki")],
        ["eigener Wert, Vermerk manual", lokal("Eigen", "manual")],
        ["eigener Wert, kein Vermerk", lokal("Unbekannt", "kein")],
    ];
    const STAENDE: readonly [string, Stand][] = [
        ["kein Stand", { description: undefined }],
        ["Stand gleicht dem Wiki", { description: WIKI_TEXT }],
        ["Stand weicht ab", { description: "Alt" }],
        ["geerbter Stand, weicht ab", { description: "Alt", geerbt: true }],
    ];
    for (const zustand of ["zugewiesen", "nur_adresse"] as const) {
        for (const [beschreibungName, beschreibung] of BESCHREIBUNGEN) {
            for (const [standName, stand] of STAENDE) {
                // Ein geerbter Stand gibt es nur an einem Abschnitt mit Adresse, dessen Linie einen hat (ein weiterer Abschnitt mit eigenem Stand folgt unten).
                it(`${zustand} · ${beschreibungName} · ${standName}`, async () => {
                    const objekte = [abschnitt({ zustand, beschreibung, stand })];
                    if (stand.geerbt === true) {
                        objekte.push(abschnitt({ stand: { description: stand.description } }));
                    }
                    const plan = await plane(objekte);
                    const entscheidung = uebernehmeVon(plan, objekte);
                    for (const zeile of plan.zeilen.filter((z) => z.feld !== null)) {
                        if (zeile.wirkung !== "uebernommen") {
                            // Eine Zeile, die die Vorschau nicht übernehmen nennt, fasst die Übernahme nicht an: Sie schreibt nichts daran und meldet nichts dazu.
                            const ids = new Set(zeile.objektIds);
                            expect(
                                entscheidung.schritte.filter(
                                    (schritt) => ids.has(schritt.objekt.id) && schritt.feld === zeile.feld,
                                ),
                                `${zeile.feld}: ${zeile.wirkung}`,
                            ).toEqual(
                                // Ausnahme: der Wiki-Wert hinter ↺ wird IMMER geschrieben, auch wo der eigene Wert bleibt.
                                entscheidung.schritte.filter(
                                    (schritt) =>
                                        ids.has(schritt.objekt.id) &&
                                        schritt.feld === zeile.feld &&
                                        schritt.wirksam === undefined &&
                                        schritt.schnappschuss !== undefined,
                                ),
                            );
                            continue;
                        }
                        // Was die Vorschau übernehmen nennt, lehnt die Übernahme nicht ab …
                        const ablehnungen = entscheidung.befunde.filter((befund) => befund.feld === zeile.feld);
                        expect(ablehnungen, `${zeile.feld}: Vorschau übernimmt`).toEqual([]);
                        // … und es ist etwas zu tun (ein Schritt an mindestens einem Objekt der Zeile).
                        const ids = new Set(zeile.objektIds);
                        expect(
                            entscheidung.schritte.some(
                                (schritt) => ids.has(schritt.objekt.id) && schritt.feld === zeile.feld,
                            ),
                            `${zeile.feld}: ein Schritt`,
                        ).toBe(true);
                    }
                });
            }
        }
    }
});
