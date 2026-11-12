import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, shallowRef } from "vue";
import {
    ROUTE_UNTERWEGS_LIMITS,
    ROUTE_UNTERWEGS_URL,
    type RouteResponse,
    type RouteStage,
    type RouteUnterwegsEintrag,
    type SearchLeuchtAnfrage,
    type SearchLeuchten,
} from "@avesmaps3d/shared";
import { vereinigeLeuchten, vereinigtSchluessel } from "../src/search/leuchten-vereinigen.ts";
import { locale } from "../src/i18n/i18n.ts";
import { leuchtenUrl } from "../src/search/search-client.ts";
import type { SuchLeuchtenZugang } from "../src/search/such-leuchten-steuerung.ts";
import { vorkommenFarbe } from "../src/search/vorkommen-farben.ts";
import { createUnterwegsAuswahl, type UnterwegsAuswahlUmfeld } from "../src/route-planner/unterwegs-auswahl.ts";
import {
    etappenText,
    fetchUnterwegs,
    unterwegsAnfrage,
    unterwegsDeckel,
    unterwegsZahlen,
    unterwegsGruppen,
    useUnterwegs,
    type UnterwegsZeile,
} from "../src/route-planner/unterwegs.ts";

/**
 * „Vorkommen unterwegs“ (WI-0257 S4, S5): die Anfrage an den Server (eine je Route, mit den Wegen und Linien der Etappen), das Modell der Liste (Gruppen, Deckel in den Worten der Infobox, Etappen als
 * Text) und die Auswahl mehrerer Einträge (färbt die Etappen, alle leuchten zusammen über das Leuchten der Suche, das Infopanel folgt, die Wahl endet mit dem Leuchten).
 */

const uuid = (n: number): string => `11111111-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const eintrag = (
    n: number,
    kind: RouteUnterwegsEintrag["kind"],
    name: string,
    etappen: number[],
    gegend?: string,
): RouteUnterwegsEintrag => ({
    id: uuid(n),
    kind,
    name,
    etappen,
    ...(gegend === undefined ? {} : { gegend }),
});

const segment = (publicId: string, synthetic = false, coordinates: [number, number][] = []): unknown => ({
    public_id: publicId,
    synthetic,
    geometry: { type: "LineString", coordinates },
});
const stage = (start: number, count: number): RouteStage =>
    ({ index: 0, segment_start: start, segment_count: count }) as unknown as RouteStage;
const routeOf = (segments: unknown[], ...stages: RouteStage[]): RouteResponse =>
    ({ found: true, segments, stages }) as unknown as RouteResponse;

beforeEach(() => {
    locale.value = "de";
});

describe("Die Anfrage zur Route", () => {
    it("🔴 eine Etappe je Eintrag der Reise, mit ihren Wegen und - nur wo es welche gibt - den Linien ihrer Abschnitte ohne Weg", () => {
        const route = routeOf(
            [
                segment(uuid(1)),
                segment("", true, [
                    [452.841, 590.761],
                    [451.64, 584.78],
                ]),
                segment(uuid(2)),
            ],
            stage(0, 2),
            stage(2, 1),
        );
        expect(unterwegsAnfrage(route)).toEqual({
            stages: [{ paths: [uuid(1)], lines: [[452.84, 590.76, 451.64, 584.78]] }, { paths: [uuid(2)] }],
        });
    });

    it("keine Anfrage ohne Etappen, ohne gefundene Route und über der Schranke des Vertrags", () => {
        expect(unterwegsAnfrage(routeOf([]))).toBeNull();
        expect(unterwegsAnfrage({ ...routeOf([segment(uuid(1))], stage(0, 1)), found: false })).toBeNull();
        const viele = Array.from({ length: ROUTE_UNTERWEGS_LIMITS.stages + 1 }, () => stage(0, 1));
        expect(unterwegsAnfrage(routeOf([segment(uuid(1))], ...viele))).toBeNull();
    });
});

describe("Der Abruf", () => {
    const antwort = (eintraege: RouteUnterwegsEintrag[]): Response =>
        new Response(JSON.stringify({ revision: "0000000000aa", eintraege }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    const busy = (): Response =>
        new Response(JSON.stringify({ error: "busy" }), { status: 503, headers: { "retry-after": "0" } });

    it("🔴 POST auf die Route des Vertrags, EIN Körper, und die Antwort ist die des Servers", async () => {
        const fetcher = vi.fn(() => Promise.resolve(antwort([eintrag(1, "flora", "Wirselkraut", [0])])));
        const got = await fetchUnterwegs({ stages: [{ paths: [] }] }, undefined, fetcher as unknown as typeof fetch);
        expect(got?.eintraege.map((e) => e.name)).toEqual(["Wirselkraut"]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(ROUTE_UNTERWEGS_URL);
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({ stages: [{ paths: [] }] });
    });

    it("eine Absage wegen Last (503 busy) wird still wiederholt; ein anderer Fehler gibt null und keine Meldung", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(busy())
            .mockResolvedValueOnce(antwort([eintrag(1, "ware", "Salz", [1])]));
        const got = await fetchUnterwegs({ stages: [{ paths: [] }] }, undefined, fetcher as unknown as typeof fetch);
        expect(got?.eintraege).toHaveLength(1);
        expect(fetcher).toHaveBeenCalledTimes(2);
        const kaputt = vi.fn(() => Promise.resolve(new Response("{}", { status: 500 })));
        expect(
            await fetchUnterwegs({ stages: [{ paths: [] }] }, undefined, kaputt as unknown as typeof fetch),
        ).toBeNull();
        expect(kaputt).toHaveBeenCalledTimes(1);
    });
});

describe("Die Liste zur gezeigten Route", () => {
    afterEach(() => vi.restoreAllMocks());

    it("🔴 eine Frage je Route; die Antwort gehört der Route, für die gefragt wurde - eine andere zeigt sie nie", async () => {
        const fetcher = vi.fn(() =>
            Promise.resolve(
                new Response(
                    JSON.stringify({ revision: "0000000000aa", eintraege: [eintrag(1, "flora", "Wirselkraut", [0])] }),
                    {
                        status: 200,
                    },
                ),
            ),
        );
        const scope = effectScope();
        const route = shallowRef<RouteResponse | null>(routeOf([segment(uuid(1))], stage(0, 1)));
        const unterwegs = scope.run(() => useUnterwegs(() => route.value, fetcher as unknown as typeof fetch));
        if (unterwegs === undefined) throw new Error("kein Zustand");
        await vi.waitFor(() => expect(unterwegs.liste.value?.map((e) => e.name)).toEqual(["Wirselkraut"]));
        expect(fetcher).toHaveBeenCalledTimes(1);
        // Eine neue Route: bis ihre Antwort da ist, steht nichts Altes da.
        route.value = routeOf([segment(uuid(2))], stage(0, 1));
        expect(unterwegs.liste.value).toBeNull();
        await vi.waitFor(() => expect(unterwegs.liste.value).not.toBeNull());
        expect(fetcher).toHaveBeenCalledTimes(2);
        // Keine Route: keine Frage.
        route.value = null;
        await nextTick();
        expect(unterwegs.liste.value).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(2);
        scope.stop();
    });
});

describe("Das Modell der Liste", () => {
    const eintraege = [
        eintrag(1, "flora", "Wirselkraut", [2, 3], "Kosch"),
        eintrag(2, "ware", "Salz", [0, 1, 2, 4], "Reichsforst"),
        eintrag(3, "flora", "Efeu", [1]),
        eintrag(4, "spezies", "Zwerge", [5]),
        eintrag(5, "fauna", "Bär", [0]),
        eintrag(6, "fauna", "ärmel-Bär", [0]),
    ];

    it("🔴 Gruppen in der Reihenfolge der Infobox (Waren, Fauna, Flora, Spezies), nach Name, die erste Etappe ab 1; eine Art ohne Eintrag fehlt", () => {
        const gruppen = unterwegsGruppen(eintraege);
        expect(gruppen.map((g) => g.kind)).toEqual(["ware", "fauna", "flora", "spezies"]);
        expect(gruppen[2]?.zeilen.map((z) => [z.name, z.ab, z.gegend])).toEqual([
            ["Efeu", 2, ""],
            ["Wirselkraut", 3, "Kosch"],
        ]);
        expect(unterwegsGruppen([eintrag(1, "ware", "Salz", [0])]).map((g) => g.kind)).toEqual(["ware"]);
        expect(unterwegsGruppen([])).toEqual([]);
    });

    it("🔴 der Deckel nennt je Art das Zeichen mit der Zahl, in der Reihenfolge der Infobox; eine Art ohne Eintrag entfällt", () => {
        expect(unterwegsZahlen(unterwegsGruppen(eintraege))).toEqual([
            { kind: "ware", zahl: "1" },
            { kind: "fauna", zahl: "2" },
            { kind: "flora", zahl: "2" },
            { kind: "spezies", zahl: "1" },
        ]);
        expect(
            unterwegsZahlen(unterwegsGruppen([eintrag(1, "flora", "Efeu", [0]), eintrag(2, "ware", "Salz", [0])])),
        ).toEqual([
            { kind: "ware", zahl: "1" },
            { kind: "flora", zahl: "1" },
        ]);
        expect(unterwegsZahlen([])).toEqual([]);
        const viele = Array.from({ length: 1234 }, (_item, at) =>
            eintrag(200 + at, "flora", `Kraut ${String(at)}`, [0]),
        );
        expect(unterwegsZahlen(unterwegsGruppen(viele))).toEqual([{ kind: "flora", zahl: "1.234" }]);
    });

    it("🔴 die Wörter zum Deckel (title, Screenreader) stehen in den Worten der Infobox, Einzahl und Mehrzahl richtig - nie „68 Fauna“", () => {
        expect(unterwegsDeckel(unterwegsGruppen(eintraege))).toBe(
            "1 Handelsware, 2 Tierarten, 2 Pflanzenarten, 1 Spezies",
        );
        const viele = [
            ...Array.from({ length: 18 }, (_item, at) => eintrag(100 + at, "ware", `Ware ${String(at)}`, [0])),
            ...Array.from({ length: 1234 }, (_item, at) => eintrag(200 + at, "flora", `Kraut ${String(at)}`, [0])),
        ];
        expect(unterwegsDeckel(unterwegsGruppen(viele))).toBe("18 Handelswaren, 1.234 Pflanzenarten");
        expect(unterwegsDeckel([])).toBe("");
        locale.value = "en";
        expect(unterwegsDeckel(unterwegsGruppen(eintraege))).toBe(
            "1 trade good, 2 animal species, 2 plant species, 1 species",
        );
    });

    it("Etappen als Text: einzelne, Paare und Bereiche, ab 1", () => {
        expect(etappenText([0])).toBe("1");
        expect(etappenText([1, 2])).toBe("2, 3");
        expect(etappenText([1, 2, 3, 5])).toBe("2 bis 4, 6");
        expect(etappenText([4, 0, 1, 2, 2])).toBe("1 bis 3, 5");
        expect(etappenText([])).toBe("");
    });
});

describe("Die Auswahl mehrerer Einträge (S5)", () => {
    const leuchten = (id: string, teil: Partial<SearchLeuchten> = {}): SearchLeuchten =>
        ({
            titel: id,
            begriff: { name: id, eintrag: id },
            pausiert: false,
            ganz: [],
            angeschnitten: [],
            gebiete: { ganz: [], angeschnitten: [] },
            orte: [],
            gegenden: 0,
            rahmen: null,
            nurKontinent: false,
            ...teil,
        }) as SearchLeuchten;

    const zeile = (n: number, name = `Eintrag ${String(n)}`, etappen: number[] = [n]): UnterwegsZeile => ({
        id: uuid(n),
        name,
        kind: "flora",
        etappen,
        ab: (etappen[0] ?? 0) + 1,
        gegend: "",
    });

    /** Ein Zugang wie `app.vue` ihn bereitstellt: `aktiv` ist der Schlüssel dessen, was leuchtet; die Vereinigung steht sofort (die Antworten sind gemerkt). */
    function zugang(): {
        zugang: SuchLeuchtenZugang;
        aktiv: ReturnType<typeof shallowRef<string | undefined>>;
        vereint: SearchLeuchtAnfrage[][];
    } {
        const aktiv = shallowRef<string | undefined>(undefined);
        const vereint: SearchLeuchtAnfrage[][] = [];
        const z = {
            bild: shallowRef(undefined),
            aktiv: {
                get value() {
                    return aktiv.value;
                },
            },
            waehle: vi.fn(),
            zeige: vi.fn(),
            zeigeVereinigt: (anfragen: readonly SearchLeuchtAnfrage[]) => {
                vereint.push([...anfragen]);
                aktiv.value = anfragen.length === 0 ? undefined : vereinigtSchluessel(anfragen);
                return Promise.resolve(anfragen.length === 0 ? undefined : leuchten("x"));
            },
            leuchtenVon: (anfrage: SearchLeuchtAnfrage) => Promise.resolve(leuchten(anfrage.eintrag ?? "x")),
            beende: () => {
                const war = aktiv.value !== undefined;
                aktiv.value = undefined;
                return war;
            },
        } as unknown as SuchLeuchtenZugang;
        return { zugang: z, aktiv, vereint };
    }

    /** Ein Infopanel wie in `app.vue`: `zeigeEintrag` öffnet den Eintrag und beendet dabei das Leuchten (`present`). */
    function panel(z: SuchLeuchtenZugang): {
        offen: { id: string | undefined };
        geoeffnet: string[];
        umfeld: UnterwegsAuswahlUmfeld;
    } {
        const offen: { id: string | undefined } = { id: undefined };
        const geoeffnet: string[] = [];
        return {
            offen,
            geoeffnet,
            umfeld: {
                zugang: z,
                oeffneEintrag: (id) => {
                    geoeffnet.push(id);
                    offen.id = id;
                    z.beende();
                },
                eintragImPanel: () => offen.id,
            },
        };
    }

    function mount(umfeld: UnterwegsAuswahlUmfeld): {
        auswahl: ReturnType<typeof createUnterwegsAuswahl>;
        stop: () => void;
    } {
        const scope = effectScope();
        const auswahl = scope.run(() => createUnterwegsAuswahl(umfeld));
        if (auswahl === undefined) throw new Error("keine Auswahl");
        return { auswahl, stop: () => scope.stop() };
    }

    it("🔴 mehrere zugleich: alle leuchten zusammen (EINE Vereinigung, ohne Kamera); ein zweiter Klick nimmt einen heraus", async () => {
        const { zugang: z, aktiv, vereint } = zugang();
        const { auswahl, stop } = mount({ zugang: z });
        auswahl.umschalten(zeile(1));
        auswahl.umschalten(zeile(2));
        auswahl.umschalten(zeile(3));
        await nextTick();
        expect(auswahl.zeilen.value.map((z) => z.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
        expect(vereint.at(-1)).toEqual([{ eintrag: uuid(1) }, { eintrag: uuid(2) }, { eintrag: uuid(3) }]);
        expect(aktiv.value).toBe(
            vereinigtSchluessel([{ eintrag: uuid(1) }, { eintrag: uuid(2) }, { eintrag: uuid(3) }]),
        );
        expect(z.waehle).not.toHaveBeenCalled();
        expect(z.zeige).not.toHaveBeenCalled();
        auswahl.umschalten(zeile(2));
        await nextTick();
        expect(auswahl.zeilen.value.map((z) => z.id)).toEqual([uuid(1), uuid(3)]);
        expect(vereint.at(-1)).toEqual([{ eintrag: uuid(1) }, { eintrag: uuid(3) }]);
        auswahl.leere();
        await nextTick();
        expect(auswahl.zeilen.value).toEqual([]);
        expect(aktiv.value).toBeUndefined();
        stop();
    });

    it("🔴 je Eintrag eine Farbe in der Reihenfolge der Wahl: Sie bleibt, solange er gewählt ist, ein Neuer nimmt die erste freie, mit der Wahl enden alle", async () => {
        const { zugang: z } = zugang();
        const farbig: (readonly { farbe: string; name: string; kind: string }[] | undefined)[] = [];
        const vereinige = z.zeigeVereinigt.bind(z);
        (z as { zeigeVereinigt: SuchLeuchtenZugang["zeigeVereinigt"] }).zeigeVereinigt = (anfragen, farben) => {
            farbig.push(farben);
            return vereinige(anfragen, farben);
        };
        const { auswahl, stop } = mount({ zugang: z });
        auswahl.umschalten(zeile(1));
        auswahl.umschalten(zeile(2));
        auswahl.umschalten(zeile(3));
        await nextTick();
        expect([...auswahl.farben.value]).toEqual([
            [uuid(1), 1],
            [uuid(2), 2],
            [uuid(3), 3],
        ]);
        expect(farbig.at(-1)).toEqual([
            { farbe: vorkommenFarbe(1), name: "Eintrag 1", kind: "flora" },
            { farbe: vorkommenFarbe(2), name: "Eintrag 2", kind: "flora" },
            { farbe: vorkommenFarbe(3), name: "Eintrag 3", kind: "flora" },
        ]);
        // Der zweite geht: Die anderen behalten ihre Farbe, der nächste nimmt die frei gewordene.
        auswahl.entferne(uuid(2));
        auswahl.umschalten(zeile(4));
        await nextTick();
        expect([...auswahl.farben.value]).toEqual([
            [uuid(1), 1],
            [uuid(3), 3],
            [uuid(4), 2],
        ]);
        expect(farbig.at(-1)?.map((f) => f.farbe)).toEqual([vorkommenFarbe(1), vorkommenFarbe(3), vorkommenFarbe(2)]);
        auswahl.leere();
        expect(auswahl.farben.value.size).toBe(0);
        stop();
    });

    it("🔴 die Kamera fliegt zu dem Eintrag, den ein Klick hinzunimmt oder öffnet - nie beim Herausnehmen oder Leeren", async () => {
        const { zugang: z } = zugang();
        const fluege: string[] = [];
        const { auswahl, stop } = mount({ zugang: z, fliegeZu: (l) => fluege.push(l.begriff.eintrag ?? "") });
        const ruhe = (): Promise<void> => new Promise((fertig) => setTimeout(fertig, 0));
        auswahl.umschalten(zeile(1));
        await ruhe();
        expect(fluege).toEqual([uuid(1)]);
        auswahl.umschalten(zeile(2));
        await ruhe();
        expect(fluege).toEqual([uuid(1), uuid(2)]);
        // Herausnehmen (Kreis, ✕) fliegt nicht.
        auswahl.umschalten(zeile(2));
        auswahl.entferne(uuid(1));
        await ruhe();
        expect(fluege).toEqual([uuid(1), uuid(2)]);
        // Der Name öffnet die Infobox und fliegt, auch zu einem Eintrag, der nicht gewählt ist; die Wahl bleibt.
        auswahl.umschalten(zeile(3));
        auswahl.oeffne(zeile(4));
        await ruhe();
        expect(fluege).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
        expect(auswahl.zeilen.value.map((z) => z.id)).toEqual([uuid(3)]);
        auswahl.leere();
        await ruhe();
        expect(fluege).toHaveLength(4);
        stop();
    });

    it("🔴 an der Route (Vali 2026-10-31): ein gewählter leuchtet nur, was die Route kreuzt; angewählte Gegenden allein, „Alle an der Route“ wieder alles - nie golden über `waehle`", async () => {
        const { zugang: z, vereint } = zugang();
        const ruhe = (): Promise<void> => new Promise((fertig) => setTimeout(fertig, 0));
        const gegend = (name: string, id: string) => ({
            key: `landschaft:${name}`,
            name,
            kind: "landschaft" as const,
            typ: "wald",
            relation: "regel" as const,
            ziel: { eintrag: uuid(1), landschaften: [id] },
        });
        const alle = [{ eintrag: uuid(1), landschaften: [uuid(11), uuid(12), uuid(13)] }];
        const holeGegenden = vi.fn(async () => ({ gegenden: [gegend("a", uuid(11)), gegend("b", uuid(12))], alle }));
        const { auswahl, stop } = mount({ zugang: z, holeGegenden });
        auswahl.setzeReise({ von: "A", bis: "B", etappen: 1, anfrage: { stages: [{ paths: [] }] } });
        auswahl.umschalten(zeile(1));
        await ruhe();
        expect(holeGegenden).toHaveBeenCalledTimes(1);
        expect(vereint.at(-1)).toEqual(alle);
        expect(auswahl.anDerRoute.value.get(uuid(1))?.gegenden.map((g) => g.name)).toEqual(["a", "b"]);
        // Zwei Gegenden angewählt: nur sie, in EINER Anfrage.
        auswahl.schalteGegend(uuid(1), "landschaft:b");
        auswahl.schalteGegend(uuid(1), "landschaft:a");
        await ruhe();
        expect(vereint.at(-1)).toEqual([{ eintrag: uuid(1), landschaften: [uuid(11), uuid(12)] }]);
        auswahl.alleAnDerRoute(uuid(1));
        await ruhe();
        expect(vereint.at(-1)).toEqual(alle);
        expect(z.waehle).not.toHaveBeenCalled();
        expect(holeGegenden).toHaveBeenCalledTimes(1);
        stop();
    });

    it("🔴 das Infopanel folgt der Wahl: bei einem dessen Infobox, ab zwei der Sammelscreen über dem Anker, bei keinem bleibt es", async () => {
        const { zugang: z } = zugang();
        const { offen, geoeffnet, umfeld } = panel(z);
        const { auswahl, stop } = mount(umfeld);
        auswahl.umschalten(zeile(1));
        expect(geoeffnet).toEqual([uuid(1)]);
        expect(auswahl.ansicht.value).toBe("eintrag");
        // Der zweite: Die Infobox des ersten steht schon vorn, es öffnet nichts neu; der Sammelscreen liegt über ihr.
        auswahl.umschalten(zeile(2));
        expect(geoeffnet).toEqual([uuid(1)]);
        expect(auswahl.ansicht.value).toBe("sammel");
        expect(auswahl.anker.value).toBe(uuid(1));
        // Aus dem Sammelscreen die Infobox des zweiten: Die Wahl bleibt, der Rückweg nennt die Zahl.
        auswahl.oeffne(zeile(2));
        expect(geoeffnet).toEqual([uuid(1), uuid(2)]);
        expect(auswahl.zeilen.value).toHaveLength(2);
        expect(auswahl.rueckweg(uuid(2))).toBe(2);
        expect(auswahl.rueckweg(uuid(1))).toBeUndefined();
        auswahl.zurueck();
        expect(auswahl.ansicht.value).toBe("sammel");
        expect(auswahl.rueckweg(uuid(2))).toBeUndefined();
        // Bleibt einer, zeigt das Panel dessen Infobox.
        auswahl.entferne(uuid(2));
        expect(auswahl.ansicht.value).toBe("eintrag");
        expect(geoeffnet).toEqual([uuid(1), uuid(2), uuid(1)]);
        // Bleibt keiner, bleibt das Panel, wie es ist.
        auswahl.entferne(uuid(1));
        expect(geoeffnet).toEqual([uuid(1), uuid(2), uuid(1)]);
        expect(offen.id).toBe(uuid(1));
        stop();
    });

    it("🔴 der Name öffnet die Infobox und ändert die Auswahl nicht; das Öffnen beendet ihr Leuchten nicht", async () => {
        const { zugang: z, aktiv } = zugang();
        const { geoeffnet, umfeld } = panel(z);
        const { auswahl, stop } = mount(umfeld);
        auswahl.umschalten(zeile(1));
        auswahl.umschalten(zeile(2));
        await nextTick();
        await nextTick();
        const soll = aktiv.value;
        auswahl.oeffne(zeile(7));
        await nextTick();
        await nextTick();
        expect(geoeffnet.at(-1)).toBe(uuid(7));
        expect(auswahl.zeilen.value.map((z) => z.id)).toEqual([uuid(1), uuid(2)]);
        expect(aktiv.value).toBe(soll);
        stop();
    });

    it("🔴 endet das Leuchten anderswo (anderes Subject, Klick ins Leere, neue Suche), endet die Wahl mit - das Panel bleibt", async () => {
        const { zugang: z, aktiv } = zugang();
        const { geoeffnet, umfeld } = panel(z);
        const { auswahl, stop } = mount(umfeld);
        auswahl.umschalten(zeile(1));
        auswahl.umschalten(zeile(2));
        await nextTick();
        await nextTick();
        aktiv.value = undefined;
        await nextTick();
        expect(auswahl.zeilen.value).toEqual([]);
        expect(auswahl.ansicht.value).toBe("eintrag");
        expect(geoeffnet).toEqual([uuid(1)]);
        // Eine neue Suche mit eigenem Leuchten ersetzt es ebenso; die Wahl beendet das fremde Leuchten nicht.
        auswahl.umschalten(zeile(3));
        await nextTick();
        await nextTick();
        aktiv.value = leuchtenUrl({ eintrag: uuid(9) });
        await nextTick();
        expect(auswahl.zeilen.value).toEqual([]);
        expect(aktiv.value).toBe(leuchtenUrl({ eintrag: uuid(9) }));
        stop();
    });

    it("🪤 solange das Leuchten der neuen Wahl noch nicht steht, beendet ein Ende die Wahl nicht", async () => {
        const { zugang: z, aktiv } = zugang();
        z.zeigeVereinigt = () => new Promise(() => undefined);
        const { auswahl, stop } = mount({ zugang: z });
        aktiv.value = leuchtenUrl({ eintrag: uuid(7) });
        auswahl.umschalten(zeile(1));
        await nextTick();
        aktiv.value = undefined;
        await nextTick();
        expect(auswahl.zeilen.value).toHaveLength(1);
        stop();
    });

    it("ohne Zugang färbt die Wahl nur die Etappen; der Abbau beendet das eigene Leuchten, nie ein fremdes", async () => {
        const ohne = mount({});
        ohne.auswahl.umschalten(zeile(1));
        expect(ohne.auswahl.zeilen.value).toHaveLength(1);
        ohne.auswahl.abbauen();
        ohne.stop();

        const { zugang: z, aktiv } = zugang();
        const mit = mount({ zugang: z });
        mit.auswahl.umschalten(zeile(3));
        await nextTick();
        expect(aktiv.value).toBeDefined();
        mit.auswahl.abbauen();
        expect(aktiv.value).toBeUndefined();
        mit.stop();

        const fremd = zugang();
        const dritte = mount({ zugang: fremd.zugang });
        dritte.auswahl.umschalten(zeile(1));
        await nextTick();
        await nextTick();
        fremd.aktiv.value = leuchtenUrl({ eintrag: uuid(5) });
        await nextTick();
        dritte.auswahl.abbauen();
        expect(fremd.aktiv.value).toBe(leuchtenUrl({ eintrag: uuid(5) }));
        dritte.stop();
    });

    it("🔴 die Vereinigung: ganze Gegenden je Kennung einmal, Stücke und Reste alle, Orte je Kennung einmal, ein Rahmen um alles; bei einer die Antwort selbst", () => {
        const a = leuchten(uuid(1), {
            ganz: [uuid(11), uuid(12)],
            orte: [{ id: uuid(21), name: "Gareth", art: "metropole", x: 1, y: 1 }],
            rahmen: { x0: 0, y0: 0, x1: 10, y1: 10 },
            rest: { form: { type: "Polygon", coordinates: [] }, rahmen: { x0: 0, y0: 0, x1: 1, y1: 1 } },
        } as Partial<SearchLeuchten>);
        const b = leuchten(uuid(2), {
            ganz: [uuid(12), uuid(13)],
            orte: [{ id: uuid(21), name: "Gareth", art: "metropole", x: 1, y: 1 }],
            rahmen: { x0: -5, y0: 2, x1: 4, y1: 20 },
        });
        const pausiert = leuchten(uuid(3), { pausiert: true, ganz: [uuid(99)] });
        expect(vereinigeLeuchten([a])).toBe(a);
        expect(vereinigeLeuchten([])).toBeUndefined();
        const v = vereinigeLeuchten([a, b, pausiert]);
        expect(v?.ganz).toEqual([uuid(11), uuid(12), uuid(13)]);
        expect(v?.orte.map((o) => o.id)).toEqual([uuid(21)]);
        expect(v?.rahmen).toEqual({ x0: -5, y0: 0, x1: 10, y1: 20 });
        expect(v?.rest).toBeUndefined();
        expect(v?.angeschnitten).toHaveLength(1);
        expect(v?.pausiert).toBe(false);
        // Der Schlüssel: bei einer die Adresse (die Infobox kennt sie), sonst unabhängig von der Reihenfolge der Wahl.
        expect(vereinigtSchluessel([{ eintrag: uuid(1) }])).toBe(leuchtenUrl({ eintrag: uuid(1) }));
        expect(vereinigtSchluessel([{ eintrag: uuid(1) }, { eintrag: uuid(2) }])).toBe(
            vereinigtSchluessel([{ eintrag: uuid(2) }, { eintrag: uuid(1) }]),
        );
    });
});
