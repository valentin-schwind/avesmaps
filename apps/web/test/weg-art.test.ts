import { describe, expect, it, vi } from "vitest";
import type { EditorPathStreet } from "@avesmaps3d/shared";
import type { Teil } from "../src/map/geometrie/geometrie";
import {
    createWegArt,
    felderAus,
    kurveAus,
    mitRichtung,
    mitRichtungUmgekehrt,
    mitWegartFuerAlle,
    mitWegartTeil,
    wegartWaehlbar,
    type WegForm,
    type WegStand,
} from "../src/wegeditor/weg-art";
import { mitMittel } from "../src/wegeditor/reisemittel";
import { mitHerkunft } from "../src/fenster/wiki-feld";

/**
 * Die Straße als Art des gemeinsamen Entwurfs (WI-0177 W5b, O3). Problemfälle: „Fertig“ schreibt nur den markierten Abschnitt statt
 * aller; ein unveränderter Name wird mitgeschickt; gemischtes „Name auf der Karte“ wird ungefragt zu ja oder nein; ein Flussweg bekommt
 * eine Landwegart; ein Konflikt wirft die eigenen Felder weg oder überschreibt fremde; eine kaputte Sicherung wird geladen. Zur Kurve
 * (W5b Schritt 3): Eine unbewegte Kurve wird mitgeschickt; ein Mitgezogener schreibt gegen eine falsche Revision; die Kurve eines
 * fremden Abschnitts geht mit; „Anwenden“ legt eine eigene Kurve still über eine fremde. Zum Tunnel (Migration 0172): Das Kästchen
 * eines Abschnitts schreibt auch an den anderen; ein Konflikt wirft das eigene Kästchen weg oder überschreibt ein fremdes. Zur
 * Karawanenroute (Migration 0174): Das Kennzeichen geht nicht mit oder an einen Flussweg; „gemischt“ wird als Wegtyp geschrieben; ein
 * Konflikt verliert den eigenen Haken. Zum Wegtyp je Abschnitt (Schritt 3): Die Tafel schreibt den Wegtyp an alle statt an die
 * gewählten; ein Flussweg wird Landweg; „gemischt“ wird als Wegtyp geschrieben; der Weg zurück schreibt doch; die Wegart oben lässt
 * einzelne Abschnitte stehen; ein Konflikt verliert den eigenen Wegtyp.
 */

const A = "0b0b0b0b-0000-4000-8000-0000000000a1";
const B = "0b0b0b0b-0000-4000-8000-0000000000a2";
const STRASSE: EditorPathStreet = {
    id: A,
    name: "Halwartsstieg",
    subtype: "Strasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: null,
    segments: [
        { id: A, revision: 3, labelVisible: true, wiki: false, points: 4 },
        { id: B, revision: 5, labelVisible: false, wiki: false, points: 3 },
    ],
};
const start: WegStand = { felder: felderAus(STRASSE), form: undefined };
const OHNE_LISTE = { liste: null, domaene: null, fenster: {} };
const mit = (felder: Partial<WegStand["felder"]>): WegStand => ({
    felder: { ...start.felder, ...felder },
    form: undefined,
});

describe("Art der Straße (W5b)", () => {
    const art = createWegArt(vi.fn() as never);

    it("🔴 EINE Operation mit ALLEN Abschnitten und ihren Revisionen; nur was sich ändert", () => {
        expect(art.operation(STRASSE, start, mit({ name: " Halwartsstieg " }), "op")).toBeUndefined();
        expect(art.operation(STRASSE, start, mit({ name: "Neuer Stieg", subtype: "Pfad" }), "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3 },
                { publicId: B, baseRevision: 5 },
            ],
            name: "Neuer Stieg",
            subtype: "Pfad",
        });
    });

    it("🔴 gemischtes „Name auf der Karte“ bleibt gemischt, bis jemand den Haken setzt; dann gilt er allen", () => {
        expect(art.operation(STRASSE, start, mit({ name: "X" }), "op")).not.toHaveProperty("labelVisible");
        expect(art.operation(STRASSE, start, mit({ labelVisible: true }), "op")).toMatchObject({ labelVisible: true });
    });

    it("🔴 Fluss, Bach und Landweg sind wählbar (Plan Fluss/Bach), Seewege nicht; der Bach geht als Flussweg mit bach", () => {
        expect(wegartWaehlbar("Strasse")).toBe(true);
        expect(wegartWaehlbar("Flussweg")).toBe(true);
        expect(wegartWaehlbar("Bach")).toBe(true);
        expect(wegartWaehlbar("Seeweg")).toBe(false);
        const fluss: EditorPathStreet = { ...STRASSE, subtype: "Flussweg" };
        const s0: WegStand = { felder: felderAus(fluss), form: undefined };
        expect(
            art.operation(
                fluss,
                s0,
                { ...s0, felder: { ...mitWegartFuerAlle(s0.felder, "Strasse"), subtype: "Strasse" } },
                "op",
            ),
        ).toMatchObject({
            subtype: "Strasse",
        });
        expect(
            art.operation(
                fluss,
                s0,
                { ...s0, felder: { ...mitWegartFuerAlle(s0.felder, "Strasse"), subtype: "Strasse" } },
                "op",
            ),
        ).not.toHaveProperty("bach");
        // Zum Bach: Wegtyp Flussweg, bach; vom Bach zurück zum Fluss: bach false.
        const zumBach = { ...mitWegartFuerAlle(s0.felder, "Bach"), subtype: "Bach" };
        expect(art.operation(fluss, s0, { ...s0, felder: zumBach }, "op")).toMatchObject({
            subtype: "Flussweg",
            bach: true,
        });
        const bach: EditorPathStreet = { ...fluss, isBach: true };
        const b0: WegStand = { felder: felderAus(bach), form: undefined };
        expect(b0.felder.subtype).toBe("Bach");
        const zumFluss = { ...mitWegartFuerAlle(b0.felder, "Flussweg"), subtype: "Flussweg" };
        expect(art.operation(bach, b0, { ...b0, felder: zumFluss }, "op")).toMatchObject({
            subtype: "Flussweg",
            bach: false,
        });
        // Über die Domäne hinweg fallen die Reisemittel auf die Vorgabe der neuen Art.
        const geschrieben = { liste: ["riverBarge"], domaene: null, fenster: {}, geschrieben: true as const };
        const mitBooten = { ...s0.felder, reisen: { [A]: geschrieben, [B]: geschrieben } };
        expect(mitWegartFuerAlle(mitBooten, "Strasse").reisen[A]).toEqual(OHNE_LISTE);
        expect(mitWegartFuerAlle(mitBooten, "Flussweg").reisen[A]).toEqual(geschrieben);
    });

    it("🔴 Konflikt: eigene Felder auf den neuen Stand, fremde bleiben; geändert und fremd nennen die Teile", () => {
        const jetzt = {
            ...STRASSE,
            subtype: "Reichsstrasse",
            segments: STRASSE.segments.map((s) => ({ ...s, revision: s.revision + 1 })),
        };
        const eigener = mit({ name: "Neuer Stieg" });
        expect(art.geaendert(STRASSE, eigener)).toEqual(["name"]);
        // Die Revisionen der Abschnitte haben sich bewegt: Auch die Form kann fremd geändert sein (die Straße kennt keine Punkte).
        expect(art.fremde(STRASSE, jetzt)).toEqual(["wegart", "form"]);
        expect(art.fremde(STRASSE, { ...STRASSE, subtype: "Reichsstrasse" })).toEqual(["wegart"]);
        expect(art.aufNeuenStand(STRASSE, jetzt, eigener).felder).toEqual({
            name: "Neuer Stieg",
            subtype: "Reichsstrasse",
            labelVisible: null,
            mark: null,
            tunnel: { [A]: false, [B]: false },
            reisen: { [A]: OHNE_LISTE, [B]: OHNE_LISTE },
            arten: { [A]: "Reichsstrasse", [B]: "Reichsstrasse" },
            richtung: { [A]: null, [B]: null },
            weitere: { [A]: [], [B]: [] },
            herkunft: {},
        });
        // Auf dem neuen Stand mit den neuen Revisionen.
        expect(
            art.operation(
                jetzt,
                { felder: felderAus(jetzt), form: undefined },
                art.aufNeuenStand(STRASSE, jetzt, eigener),
                "op",
            ),
        ).toMatchObject({ sections: [{ baseRevision: 4 }, { baseRevision: 6 }], name: "Neuer Stieg" });
    });

    it("🔴 ein Griff ist kein Name (WI-0105): das Feld steht leer, geschrieben wird erst, was jemand einträgt", () => {
        const griff = { ...STRASSE, name: "Pfad-3443", subtype: "Pfad" };
        const s0: WegStand = { felder: felderAus(griff), form: undefined };
        expect(s0.felder.name).toBe("");
        expect(art.operation(griff, s0, { ...s0, felder: { ...s0.felder, subtype: "Weg" } }, "op")).not.toHaveProperty(
            "name",
        );
        expect(art.operation(griff, s0, { ...s0, felder: { ...s0.felder, name: "Koschpfad" } }, "op")).toMatchObject({
            name: "Koschpfad",
        });
    });

    it("🔴 Tunnel: nur der Abschnitt, dessen Kästchen sich bewegt hat; zurück auf den alten Stand schreibt nichts", () => {
        const roehre = mit({ tunnel: { [A]: false, [B]: true } });
        expect(art.operation(STRASSE, start, roehre, "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3 },
                { publicId: B, baseRevision: 5, tunnel: true },
            ],
        });
        expect(art.geaendert(STRASSE, roehre)).toEqual(["tunnel"]);
        expect(art.operation(STRASSE, start, mit({ tunnel: { [A]: false, [B]: false } }), "op")).toBeUndefined();
        // Gelesen: Der Abschnitt nennt `tunnel` nur, wenn er einer ist.
        expect(
            felderAus({ ...STRASSE, segments: [{ ...STRASSE.segments[0]!, tunnel: true }, STRASSE.segments[1]!] })
                .tunnel,
        ).toEqual({
            [A]: true,
            [B]: false,
        });
    });

    it("🔴 Tunnel im Konflikt: das eigene Kästchen bleibt, ein fremdes kommt aus dem neuen Stand", () => {
        const fremd = {
            ...STRASSE,
            segments: [{ ...STRASSE.segments[0]!, tunnel: true as const, revision: 4 }, STRASSE.segments[1]!],
        };
        const eigener = mit({ tunnel: { [A]: false, [B]: true } });
        expect(art.fremde(STRASSE, fremd)).toEqual(["tunnel", "form"]);
        expect(art.aufNeuenStand(STRASSE, fremd, eigener).felder.tunnel).toEqual({ [A]: true, [B]: true });
    });

    it("🔴 Reisemittel (Migration 0208, F16 „A“): nur der geänderte Abschnitt, ganz; der alte Stand schreibt nichts; im Konflikt bleibt das eigene", () => {
        const ohneKarren = mitMittel(start.felder.reisen[B]!, "Strasse", "cart", false);
        expect(ohneKarren.geschrieben).toBe(true);
        const stand = mit({ reisen: { ...start.felder.reisen, [B]: ohneKarren } });
        expect(art.geaendert(STRASSE, stand)).toEqual(["reisen"]);
        expect(art.operation(STRASSE, start, stand, "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3 },
                {
                    publicId: B,
                    baseRevision: 5,
                    reisen: {
                        liste: [
                            "groupFoot",
                            "lightWalker",
                            "groupHorse",
                            "lightRider",
                            "caravan",
                            "wagon",
                            "horseCarriage",
                            "sleigh",
                        ],
                        fenster: {},
                    },
                },
            ],
        });
        expect(art.operation(STRASSE, start, mit({ reisen: { ...start.felder.reisen } }), "op")).toBeUndefined();
        // Ein anderer schrieb inzwischen den anderen Abschnitt: Das eigene bleibt, das fremde kommt aus dem neuen Stand.
        const seine = { liste: ["groupFoot"], domaene: "land", fenster: {}, geschrieben: true as const };
        const fremd: EditorPathStreet = {
            ...STRASSE,
            segments: [{ ...STRASSE.segments[0]!, revision: 4, reisen: seine }, STRASSE.segments[1]!],
        };
        expect(art.fremde(STRASSE, fremd)).toEqual(["reisen", "form"]);
        expect(art.aufNeuenStand(STRASSE, fremd, stand).felder.reisen).toEqual({ [A]: seine, [B]: ohneKarren });
    });

    it('🔴 Karawanenroute: der Haken schreibt das Kennzeichen aller Abschnitte, ohne ihn ""; nie an einem Flussweg', () => {
        expect(art.operation(STRASSE, start, mit({ mark: "karawanenroute" }), "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3 },
                { publicId: B, baseRevision: 5 },
            ],
            mark: "karawanenroute",
        });
        expect(art.geaendert(STRASSE, mit({ mark: "karawanenroute" }))).toEqual(["kennzeichen"]);
        const route: EditorPathStreet = { ...STRASSE, mark: "karawanenroute" };
        expect(felderAus(route).mark).toBe("karawanenroute");
        const ohne = art.operation(
            route,
            { felder: felderAus(route), form: undefined },
            { felder: { ...felderAus(route), mark: null }, form: undefined },
            "op",
        );
        expect(ohne).toMatchObject({ mark: "" });
        const fluss: EditorPathStreet = { ...STRASSE, subtype: "Flussweg" };
        const flussStart = { felder: felderAus(fluss), form: undefined };
        expect(
            art.operation(
                fluss,
                flussStart,
                { felder: { ...flussStart.felder, mark: "karawanenroute" }, form: undefined },
                "op",
            ),
        ).toBeUndefined();
    });

    it("🔴 eine Karawanenroute auf mehreren Wegtypen: die Wegart steht auf „gemischt“ und wird erst mit einem Wegtyp geschrieben", () => {
        const route: EditorPathStreet = {
            ...STRASSE,
            mark: "karawanenroute",
            subtypes: ["Strasse", "Pfad"],
            segments: STRASSE.segments.map((teil, i) => ({ ...teil, subtype: i === 0 ? "Strasse" : "Pfad" })),
        };
        const routeStart: WegStand = { felder: felderAus(route), form: undefined };
        expect(routeStart.felder.subtype).toBe("");
        expect(
            art.operation(route, routeStart, { felder: { ...routeStart.felder, name: "Neu" }, form: undefined }, "op"),
        ).not.toHaveProperty("subtype");
        expect(
            art.operation(
                route,
                routeStart,
                { felder: { ...routeStart.felder, subtype: "Wuestenpfad" }, form: undefined },
                "op",
            ),
        ).toMatchObject({ subtype: "Wuestenpfad" });
    });

    it("🔴 Wegtyp je Abschnitt (Schritt 3): die Tafel schreibt nur die gewählten, „gemischt“ nie; alle gleich geht als Wegart der Straße", () => {
        // (2) auf Pfad: Die Wegart oben steht gemischt, ihre Herkunft ist manual; nur B nennt seinen Wegtyp.
        const zwei = mitWegartTeil(start.felder, [B], "Pfad");
        expect(zwei.arten).toEqual({ [A]: "Strasse", [B]: "Pfad" });
        expect(zwei.subtype).toBe("");
        expect(zwei.herkunft.subtype).toBe("manual");
        expect(art.geaendert(STRASSE, mit(zwei))).toEqual(["wegart"]);
        expect(art.operation(STRASSE, start, mit(zwei), "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3 },
                { publicId: B, baseRevision: 5, subtype: "Pfad" },
            ],
        });
        // Auch (1) auf Pfad: Alle sind gleich, die Wegart gilt der Straße.
        const beide = mitWegartTeil(zwei, [A], "Pfad");
        expect(beide.subtype).toBe("Pfad");
        expect(art.operation(STRASSE, start, mit(beide), "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3 },
                { publicId: B, baseRevision: 5 },
            ],
            subtype: "Pfad",
        });
        // Zurück auf den alten Stand schreibt nichts; „gemischt“ ist kein Wegtyp.
        expect(art.operation(STRASSE, start, mit(mitWegartTeil(zwei, [B], "Strasse")), "op")).toBeUndefined();
        expect(mitWegartTeil(zwei, [A], "")).toBe(zwei);
        // Die Wegart oben setzt alle.
        const oben = mitWegartFuerAlle(mitHerkunft(zwei, "subtype", "Weg", "manual"), "Weg");
        expect(oben.arten).toEqual({ [A]: "Weg", [B]: "Weg" });
        expect(art.operation(STRASSE, start, mit(oben), "op")).toMatchObject({ subtype: "Weg" });
    });

    it("🔴 Wegtyp je Abschnitt über Land und Wasser (Plan Fluss/Bach): der Fluss wird Landweg, der Landweg Bach; geschrieben wird nur, was sich bewegt", () => {
        const gemischt: EditorPathStreet = {
            ...STRASSE,
            subtypes: ["Strasse", "Flussweg"],
            segments: [
                { ...STRASSE.segments[0]!, subtype: "Strasse", art: "Strasse" },
                { ...STRASSE.segments[1]!, subtype: "Flussweg", art: "Flussweg" },
            ],
        };
        const s0: WegStand = { felder: felderAus(gemischt), form: undefined };
        expect(s0.felder.arten).toEqual({ [A]: "Strasse", [B]: "Flussweg" });
        // Nur der Fluss wird Pfad: je Abschnitt.
        const zwei = mitWegartTeil(s0.felder, [B], "Pfad");
        expect(zwei.arten).toEqual({ [A]: "Strasse", [B]: "Pfad" });
        expect(art.operation(gemischt, s0, { felder: zwei, form: undefined }, "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3 },
                { publicId: B, baseRevision: 5, subtype: "Pfad" },
            ],
        });
        // Die Straße wird Bach: je Abschnitt Flussweg mit bach; der Fluss wird nur Bach.
        const bach = mitWegartTeil(s0.felder, [A, B], "Bach");
        expect(bach.subtype).toBe("Bach");
        expect(art.operation(gemischt, s0, { felder: bach, form: undefined }, "op")).toMatchObject({
            subtype: "Flussweg",
            bach: true,
        });
        expect(mitWegartFuerAlle(s0.felder, "Weg").arten).toEqual({ [A]: "Weg", [B]: "Weg" });
    });

    it("🔴 Wegtyp je Abschnitt im Konflikt: der eigene bleibt, ein fremder kommt aus dem neuen Stand", () => {
        const stand = mit(mitWegartTeil(start.felder, [B], "Pfad"));
        const fremd: EditorPathStreet = {
            ...STRASSE,
            subtypes: ["Weg", "Strasse"],
            segments: [
                { ...STRASSE.segments[0]!, revision: 4, subtype: "Weg", art: "Weg" },
                { ...STRASSE.segments[1]!, subtype: "Strasse", art: "Strasse" },
            ],
        };
        expect(art.aufNeuenStand(STRASSE, fremd, stand).felder.arten).toEqual({ [A]: "Weg", [B]: "Pfad" });
    });

    it("🔴 Fließrichtung je Abschnitt (Schritt 4): nur an einem Fluss; umkehren dreht das Feld, offen bleibt offen; geschrieben nur, was sich bewegt", () => {
        const fluss: EditorPathStreet = {
            ...STRASSE,
            subtype: "Flussweg",
            segments: [
                { ...STRASSE.segments[0]!, art: "Flussweg", flowDirection: "forward" },
                { ...STRASSE.segments[1]!, art: "Flussweg" },
            ],
        };
        const s0: WegStand = { felder: felderAus(fluss), form: undefined };
        expect(s0.felder.richtung).toEqual({ [A]: "forward", [B]: null });
        const um = mitRichtungUmgekehrt(s0.felder, [A, B]);
        expect(um.richtung).toEqual({ [A]: "reverse", [B]: null });
        expect(art.geaendert(fluss, { felder: um, form: undefined })).toEqual(["richtung"]);
        expect(art.operation(fluss, s0, { felder: um, form: undefined }, "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3, flowDirection: "reverse" },
                { publicId: B, baseRevision: 5 },
            ],
        });
        const gesetzt = mitRichtung(s0.felder, [B], "forward");
        expect(art.operation(fluss, s0, { felder: gesetzt, form: undefined }, "op")).toMatchObject({
            sections: [{ publicId: A }, { publicId: B, flowDirection: "forward" }],
        });
        // Am Landweg: keine Richtung.
        expect(mitRichtung(start.felder, [A], "forward").richtung[A]).toBeNull();
        // Wird der Fluss zum Landweg, geht keine Richtung mit.
        const zuLand = { ...mitWegartFuerAlle(um, "Strasse"), subtype: "Strasse" };
        expect(art.operation(fluss, s0, { felder: zuLand, form: undefined }, "op")?.sections[0]).not.toHaveProperty(
            "flowDirection",
        );
    });

    it("die Sicherung im Browser nimmt nur einen heilen Stand", () => {
        const s = art.sicherung!;
        expect(s.ein(s.aus(mit({ name: "Gesichert" })))?.felder.name).toBe("Gesichert");
        expect(s.ein(s.aus(mit({ tunnel: { [A]: true, [B]: false } })))?.felder.tunnel).toEqual({
            [A]: true,
            [B]: false,
        });
        expect(s.ein({ felder: { name: 3 } })).toBeUndefined();
        // Eine Sicherung ohne Tunnel (vor Migration 0172) oder mit einem kaputten Kästchen ist nicht heil.
        expect(s.ein({ felder: { name: "x", subtype: "Weg", labelVisible: true } })).toBeUndefined();
        expect(
            s.ein({ felder: { name: "x", subtype: "Weg", labelVisible: true, tunnel: { [A]: "ja" } } }),
        ).toBeUndefined();
        expect(s.ein(null)).toBeUndefined();
        // Der Wegtyp je Abschnitt geht mit; eine Sicherung ohne ihn (vor Schritt 3) ist nicht heil.
        const zwei = mit(mitWegartTeil(start.felder, [B], "Pfad"));
        expect(s.ein(s.aus(zwei))?.felder.arten).toEqual({ [A]: "Strasse", [B]: "Pfad" });
        const alt = Object.fromEntries(Object.entries(start.felder).filter(([feld]) => feld !== "arten"));
        expect(s.ein({ felder: alt })).toBeUndefined();
    });

    it('🔴 Herkunft (WI-0225 §7): ↺ geht als { revert: "wiki" }, Getipptes als Wert; die Herkunft allein schreibt nichts', () => {
        const zurueck = mit({ name: "Kronweg", herkunft: { name: "wiki" } });
        expect(art.operation(STRASSE, start, zurueck, "op")?.name).toEqual({ revert: "wiki" });
        expect(art.operation(STRASSE, start, mit({ name: "Kronweg", herkunft: { name: "manual" } }), "op")?.name).toBe(
            "Kronweg",
        );
        expect(
            art.operation(
                STRASSE,
                start,
                mit({ subtype: "Reichsstrasse", mark: "karawanenroute", herkunft: { subtype: "wiki", mark: "wiki" } }),
                "op",
            ),
        ).toMatchObject({ subtype: { revert: "wiki" }, mark: { revert: "wiki" } });
        expect(art.operation(STRASSE, start, mit({ herkunft: { name: "wiki" } }), "op")).toBeUndefined();
        // Die Straße rechnet sie aus den Abschnitten: wiki nur, wenn alle; ein manual macht manual; sonst kein Vermerk.
        const aus = (a?: "wiki" | "manual", b?: "wiki" | "manual") =>
            felderAus({
                ...STRASSE,
                segments: [
                    { ...STRASSE.segments[0]!, ...(a ? { herkunft: { name: a } } : {}) },
                    { ...STRASSE.segments[1]!, ...(b ? { herkunft: { name: b } } : {}) },
                ],
            }).herkunft;
        expect(aus("wiki", "wiki")).toEqual({ name: "wiki" });
        expect(aus("wiki", "manual")).toEqual({ name: "manual" });
        expect(aus("wiki")).toEqual({});
        // Im Konflikt behält das eigene Feld seine Herkunft, ein fremdes nimmt die neue.
        const fremd = {
            ...STRASSE,
            segments: STRASSE.segments.map((s) => ({
                ...s,
                revision: s.revision + 1,
                herkunft: { subtype: "manual" as const },
            })),
        };
        expect(art.aufNeuenStand(STRASSE, fremd, zurueck).felder.herkunft).toEqual({ name: "wiki", subtype: "manual" });
        // Die Sicherung trägt die Herkunft; ohne sie ist der Stand nicht heil.
        const s = art.sicherung!;
        expect(s.ein(s.aus(zurueck))?.felder.herkunft).toEqual({ name: "wiki" });
        expect(s.ein({ felder: { ...start.felder, herkunft: { name: "wikipedia" } } })).toBeUndefined();
    });

    it("liest unter dem Anker; 404 heißt: die Straße gibt es nicht", async () => {
        const fetcher = vi.fn(async () => new Response("", { status: 404 }));
        await expect(createWegArt(fetcher as never).lade(A, new AbortController().signal)).resolves.toBeNull();
        expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toBe(`/api/editor/paths/${A}/street`);
    });
});

const teil = (objekt: string, punkte: [number, number][], revision: number, name = "Halwartsstieg"): Teil => ({
    objekt,
    name,
    nr: 0,
    art: "linie",
    punkte: punkte.map(([x, y]) => ({ x, y })),
    revision,
});
const NACHBAR = "0b0b0b0b-0000-4000-8000-0000000000c1";
const URSPRUNG = {
    teil: teil(
        B,
        [
            [0, 0],
            [10, 0],
            [20, 0],
        ],
        5,
    ),
    nachbarn: [
        teil(
            NACHBAR,
            [
                [10, 0],
                [10, 10],
            ],
            7,
            "Seitenweg",
        ),
    ],
};
const ruhig: WegForm = { ...URSPRUNG, ursprung: URSPRUNG };
/** Der mittlere Stützpunkt nach (10|4) gezogen, der Seitenweg zieht mit. */
const gezogen: WegForm = {
    ursprung: URSPRUNG,
    teil: teil(
        B,
        [
            [0, 0],
            [10, 4],
            [20, 0],
        ],
        5,
    ),
    nachbarn: [
        teil(
            NACHBAR,
            [
                [10, 4],
                [10, 10],
            ],
            7,
            "Seitenweg",
        ),
    ],
};

describe("Kurve als Form der Straße (W5b Schritt 3)", () => {
    const art = createWegArt(vi.fn() as never);

    it("🔴 eine unbewegte Kurve schreibt nichts; eine gezogene ihre Punkte und je Mitgezogenem von wo nach wo gegen SEINE Revision", () => {
        expect(kurveAus(ruhig)).toBeUndefined();
        expect(kurveAus(gezogen)).toEqual({
            publicId: B,
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 4 },
                { x: 20, y: 0 },
            ],
            carried: [{ pathId: NACHBAR, index: 0, baseRevision: 7, from: { x: 10, y: 0 }, to: { x: 10, y: 4 } }],
        });
        // Zurückgezogen, wo er lag: nichts zu schreiben.
        expect(kurveAus({ ...gezogen, teil: URSPRUNG.teil, nachbarn: URSPRUNG.nachbarn })).toBeUndefined();
    });

    it("🔴 EINE Operation: Felder und Kurve zusammen, die Kurve allein; nie die Kurve eines fremden Abschnitts", () => {
        const s0: WegStand = { felder: start.felder, form: ruhig };
        expect(art.operation(STRASSE, s0, s0, "op")).toBeUndefined();
        expect(art.operation(STRASSE, s0, { felder: start.felder, form: gezogen }, "op")).toEqual({
            operationId: "op",
            sections: [
                { publicId: A, baseRevision: 3 },
                { publicId: B, baseRevision: 5 },
            ],
            shape: kurveAus(gezogen),
        });
        expect(
            art.operation(STRASSE, s0, { felder: { ...start.felder, name: "Neuer Stieg" }, form: gezogen }, "op"),
        ).toMatchObject({ name: "Neuer Stieg", shape: { publicId: B } });
        const fremd: WegForm = { ...gezogen, teil: { ...gezogen.teil, objekt: NACHBAR } };
        expect(art.operation(STRASSE, s0, { felder: start.felder, form: fremd }, "op")).toBeUndefined();
    });

    it("🔴 geändert nennt die Form, sobald die Kurve woanders liegt; der Konflikt behält die eigene Kurve", () => {
        expect(art.geaendert(STRASSE, { felder: start.felder, form: ruhig })).toEqual([]);
        expect(art.geaendert(STRASSE, { felder: start.felder, form: gezogen })).toEqual(["form"]);
        const jetzt = { ...STRASSE, segments: STRASSE.segments.map((s) => ({ ...s, revision: s.revision + 1 })) };
        const neu = art.aufNeuenStand(STRASSE, jetzt, { felder: start.felder, form: gezogen });
        expect(neu.form).toBe(gezogen);
        // Auf dem neuen Stand schreibt der Abschnitt gegen seine neue Revision aus `sections`.
        expect(art.operation(jetzt, { felder: felderAus(jetzt), form: ruhig }, neu, "op")).toMatchObject({
            sections: [{ baseRevision: 4 }, { baseRevision: 6 }],
            shape: { publicId: B },
        });
    });

    it("die Sicherung im Browser trägt die Form samt Ursprung und Vereinfachung; eine kaputte Form verwirft den Stand", () => {
        const s = art.sicherung!;
        const vereinfacht: WegForm = { ...gezogen, vereinfacht: { von: URSPRUNG.teil.punkte, staerke: 4 } };
        const zurueck = s.ein(JSON.parse(JSON.stringify(s.aus({ felder: start.felder, form: vereinfacht }))));
        expect(zurueck?.form).toEqual(vereinfacht);
        expect(s.ein({ felder: start.felder, form: { teil: { objekt: B } } })).toBeUndefined();
        expect(s.ein({ felder: start.felder })?.form).toBeUndefined();
    });

    it("🔴 die Quittung von „Fertig“ bleibt lesbar (woran die Enden danach hängen)", async () => {
        const quittung = {
            operationId: "op",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
            ends: { start: { kind: "free" }, end: { kind: "free" } },
        };
        const fetcher = vi.fn(async () => Response.json(quittung));
        const mitQuittung = createWegArt(fetcher as never);
        expect(mitQuittung.quittung()).toBeUndefined();
        const antwort = await mitQuittung.schreibe(A, { operationId: "op", sections: [], shape: kurveAus(gezogen)! });
        expect(antwort.ok).toBe(true);
        expect(mitQuittung.quittung()?.ends).toEqual(quittung.ends);
    });
});
