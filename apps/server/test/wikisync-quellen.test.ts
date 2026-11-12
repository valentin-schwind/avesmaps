import { wikiNamespaceTafel, type InhalteTraegerArt } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import { verknuepfungsHerkunft } from "../src/wiki/abgleich/lokal.ts";
import { berechnePlan, type PlanObjekt, type PlanZeile } from "../src/wiki/abgleich/plan.ts";
import {
    GRUND_GELOEST,
    GRUND_IMPORT_GELOEST,
    GRUND_NEU_VORSCHAU,
    GRUND_NEU_ZITIERT,
    GRUND_NEUE_ADRESSE,
    GRUND_NICHT_IM_KATALOG,
    GRUND_NICHT_MEHR,
    GRUND_NICHT_MEHR_UNBELEGT,
    GRUND_NICHT_MEHR_VORSCHAU,
    GRUND_QUELLE_STILL,
    GRUND_QUELLE_WIEDER,
    GRUND_TOMBSTONE,
    GRUND_VERKNUEPFUNG_WIEDER,
    KATALOG_FELD,
    adressSchluessel,
    katalogWert,
    leseKatalogWert,
    leseQuellenWert,
    planeQuellen,
    platzhalterId,
    quellenWert,
    quellenZiel,
    verwendungAusFeld,
    zitierteNennungen,
    verwendungsFeld,
    type BestehendeQuelle,
    type Produkt,
    type PublikationsKatalog,
    type QuellenVerknuepfung,
} from "../src/wiki/abgleich/quellen.ts";
import { entscheideVerwendungen } from "../src/wiki/abgleich/uebernahme/verwendungen.ts";
import type { VorschauZeile } from "../src/wiki/abgleich/uebernahme/protokoll.ts";
import { lesePublikationen } from "../src/wiki/infobox/publikationen.ts";
import type { GelesenerDumpArtikel } from "../src/wiki/dump/seiten-sammler.ts";

/**
 * Die Publikationen eines Artikels gegen die Verknüpfungen seines Trägers und den Titel der Quelle (WI-0253, Scheibe Quellen), rein: die Entscheidungen von `quellen.ts`, der Plan des
 * Bereichs `quelle` (`plan.ts`) und die Prüfung der Übernahme gegen den Stand von jetzt (`uebernahme/verwendungen.ts`). Die Datenbank-Seite (Übernahme, Rücknahme, Rechte) steht in
 * `wikisync-quellen-uebernahme.test.ts`.
 *
 * 🔴 Problemfälle: Identität nur über `wikipub:` + Legacys Slug oder `url:<sha256>` (Weiterleitung aufgelöst, nie über den Titel der Quelle); bei zwei Nennungen gewinnt die stärkste Art;
 * eine Verknüpfung ohne belegte Herkunft, der Redaktion, eine direkte Quelle und ein Tombstone werden nie geändert oder still gelegt; „neu zitiert“ legt an (samt fehlender Katalogquelle),
 * „nicht mehr zitiert“ legt still, aber nur mit belegter Wiki-Herkunft, „ohne Produktseite“ bleibt Befund; nichts lebt wieder auf, was Redaktion oder Legacy-Zug entfernten;
 * teilen sich Produktseiten eine Shop-Adresse, gibt es keinen Titel des Wikis.
 */

const uuid = (kopf: string, nummer: number): string =>
    `${kopf}0000000-0000-4000-8000-${String(nummer).padStart(12, "0")}`;

const ADRESSE_FLUSS = "https://www.f-shop.de/search?sSearch=12011";
const KATALOG: PublikationsKatalog = {
    produkte: new Map<string, Produkt>([
        ["am-grossen-fluss", { seite: "Am Großen Fluss", ns: 0, titel: "Am Großen Fluss", adresse: ADRESSE_FLUSS }],
        ["der-rabenkrieg", { seite: "Der Rabenkrieg", ns: 0, titel: "Der Rabenkrieg", adresse: null }],
        ["das-horasreich", { seite: "Das Horasreich", ns: 0, titel: "Das Horasreich", adresse: null }],
        ["neues-buch", { seite: "Neues Buch", ns: 0, titel: "Neues Buch", adresse: null }],
        ["tombstone-buch", { seite: "Tombstone Buch", ns: 0, titel: "Tombstone Buch", adresse: null }],
    ]),
    weiterleitungen: new Map([["reich-des-horas", "das-horasreich"]]),
};

const QUELLE = {
    fluss: { id: uuid("5", 1), schluessel: adressSchluessel(ADRESSE_FLUSS), titel: "Am Großen Fluss (alt)" },
    raben: { id: uuid("5", 2), schluessel: "wikipub:der-rabenkrieg", titel: "Der Rabenkrieg" },
    horas: { id: uuid("5", 3), schluessel: "wikipub:das-horasreich", titel: "Das Horasreich" },
    tombstone: { id: uuid("5", 4), schluessel: "wikipub:tombstone-buch", titel: "Tombstone Buch" },
};
const bestehendDerWelt = (): Map<string, BestehendeQuelle> =>
    new Map(
        Object.values(QUELLE).map((quelle) => [quelle.schluessel, { id: quelle.id, titel: quelle.titel, aktiv: true }]),
    );

const TRAEGER = { art: "place" as InhalteTraegerArt, id: uuid("a", 1) };
const ADRESSE_TRAEGER = "https://de.wiki-aventurica.de/wiki/Gareth";

function verknuepfung(
    quelle: { id: string; schluessel: string; titel: string },
    teil: Partial<QuellenVerknuepfung> = {},
): QuellenVerknuepfung {
    return {
        traegerArt: TRAEGER.art,
        traegerId: TRAEGER.id,
        traegerName: "Gareth",
        traegerAdresse: ADRESSE_TRAEGER,
        quelle: quelle.schluessel,
        quelleId: quelle.id,
        titel: quelle.titel,
        art: "ergaenzend",
        seiten: null,
        notiz: null,
        zustand: "active",
        vonRedaktionGeloest: false,
        herkunft: "wiki",
        ...teil,
    };
}

const artikel = (text: string) => lesePublikationen(`== Publikationen ==\n${text}`);

describe("WikiSync Quellen: Identität und Feldnamen", () => {
    it("🔴 Die Quelle folgt aus dem Linktitel über die Weiterleitung: wikipub: + Legacys Slug, mit Shop-Adresse url:<sha256>, nie über den Titel der Quelle", () => {
        expect(quellenZiel("Am Großen Fluss", KATALOG)).toMatchObject({
            schluessel: "am-grossen-fluss",
            quelle: adressSchluessel(ADRESSE_FLUSS),
        });
        expect(quellenZiel("Der_Rabenkrieg#Inhalt", KATALOG)?.quelle).toBe("wikipub:der-rabenkrieg");
        // Eine Weiterleitung führt auf die Produktseite ihres Ziels.
        expect(quellenZiel("Reich des Horas", KATALOG)?.quelle).toBe("wikipub:das-horasreich");
        // Kein Produkt, keine Quelle: auch ein Titel, der wie eine Quelle klingt, ist keine.
        expect(quellenZiel("Archiv der Kräuter/Inhaltsverzeichnis", KATALOG)).toBeNull();
        expect(quellenZiel("Am Großen Fluss (alt)", KATALOG)).toBeNull();
    });

    it("Das Feld einer Verwendung passt in die Tafel des Laufs (klein, höchstens 64 Zeichen) und führt zum Träger zurück", () => {
        for (const art of ["place", "territory", "area", "peak", "path"] as const) {
            const feld = verwendungsFeld(art, "A0000000-0000-4000-8000-0000000000AB");
            expect(feld).toMatch(/^[a-z][a-z0-9_]*$/u);
            expect(feld.length).toBeLessThanOrEqual(64);
            expect(verwendungAusFeld(feld)).toEqual({ art, id: "a0000000-0000-4000-8000-0000000000ab" });
        }
        expect(verwendungAusFeld("title")).toBeNull();
        expect(verwendungAusFeld("verwendung_place_xyz")).toBeNull();
    });

    it("Der Wert Art | Seiten | Notiz kehrt zurück, auch mit einem senkrechten Strich in der Notiz", () => {
        const wert = { art: "ausfuehrlich", seiten: "40, 145", notiz: "Zerstörung | Neuaufbau" };
        expect(leseQuellenWert(quellenWert(wert))).toEqual(wert);
        expect(leseQuellenWert(quellenWert({ art: null, seiten: null, notiz: null }))).toEqual({
            art: null,
            seiten: null,
            notiz: null,
        });
        expect(leseQuellenWert("nur zwei | Teile")).toBeNull();
        expect(leseQuellenWert(null)).toBeNull();
    });
});

describe("WikiSync Quellen: die Publikationen eines Artikels gegen die Verknüpfungen", () => {
    const rechne = (
        text: string,
        verknuepfungen: readonly QuellenVerknuepfung[],
        bereichBeiLegacy = false,
        bestehend = bestehendDerWelt(),
    ) => planeQuellen(artikel(text), TRAEGER, verknuepfungen, KATALOG, bestehend, bereichBeiLegacy);

    it("🔴 Seiten, Notiz und Art einer Verknüpfung des Wikis folgen dem Artikel; stimmt alles, gibt es keine Zeile", () => {
        const ergebnis = rechne(
            "=== Ausführlich ===\n* [[Am Großen Fluss]] Seite 40, '''145''' <small>(Zerstörung)</small>\n=== Erwähnungen ===\n* [[Der Rabenkrieg]] Seite 7",
            [
                verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "40" }),
                verknuepfung(QUELLE.raben, { art: "erwaehnung", seiten: "7" }),
            ],
        );
        expect(ergebnis.entscheidungen).toHaveLength(1);
        expect(ergebnis.entscheidungen[0]).toMatchObject({
            quelleId: QUELLE.fluss.id,
            feld: verwendungsFeld(TRAEGER.art, TRAEGER.id),
            alt: { art: "ergaenzend", seiten: "40", notiz: null },
            neu: { art: "ausfuehrlich", seiten: "40, 145", notiz: "Zerstörung" },
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            status: "geaendert",
        });
        expect(ergebnis.zahlen).toMatchObject({ gelesen: 2, gleich: 1, neuZitiert: 0, nichtMehrZitiert: 0 });
    });

    it("🔴 Bei zwei Nennungen derselben Publikation gewinnt die stärkste Art, und Seiten und Notiz stammen aus ihr (Legacy nahm die erste)", () => {
        const ergebnis = rechne(
            "=== Erwähnungen ===\n* [[Am Großen Fluss]] Seite 9\n=== Ausführlich ===\n* [[Am Großen Fluss]] Seite 40 <small>(Hauptnennung)</small>\n=== Ergänzend ===\n* [[Am Großen Fluss]] Seite 12",
            [verknuepfung(QUELLE.fluss, { art: "erwaehnung", seiten: "9" })],
        );
        expect(ergebnis.entscheidungen).toHaveLength(1);
        expect(ergebnis.entscheidungen[0]?.neu).toEqual({ art: "ausfuehrlich", seiten: "40", notiz: "Hauptnennung" });
        // Gleich stark: die erste.
        const gleichStark = rechne("=== Ausführlich ===\n* [[Am Großen Fluss]] 1\n* [[Am Großen Fluss]] 2", [
            verknuepfung(QUELLE.fluss, { art: "ausfuehrlich", seiten: "1" }),
        ]);
        expect(gleichStark.entscheidungen).toEqual([]);
        expect(gleichStark.zahlen.gleich).toBe(1);
    });

    it("🔴 Ohne belegte Herkunft ist eine Abweichung ein Befund, eine Verknüpfung der Redaktion und eine direkte Quelle bleiben eigen, bei einem Bereich beim Legacy-Zug ist alles nur Vorschau", () => {
        const text = "=== Ausführlich ===\n* [[Am Großen Fluss]] 40\n* [[Der Rabenkrieg]] 7\n* [[Das Horasreich]] 3";
        const verknuepfungen = [
            verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "1", herkunft: "unbekannt" }),
            verknuepfung(QUELLE.raben, { art: "ergaenzend", seiten: "1", herkunft: "manual" }),
            verknuepfung(QUELLE.horas, { art: null, seiten: "1" }),
        ];
        expect(rechne(text, verknuepfungen).entscheidungen.map((e) => [e.quelleId, e.eigentuemer, e.wirkung])).toEqual([
            [QUELLE.fluss.id, "unbekannt", "befund"],
            [QUELLE.raben.id, "manual", "eigen"],
            [QUELLE.horas.id, "manual", "eigen"],
        ]);
        // Beim Legacy-Zug gehört alles dem Zug, auch was das Wiki neu nennt: nur Vorschau.
        const beiLegacy = rechne(text, [verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "1" })], true);
        expect(beiLegacy.entscheidungen.map((e) => [e.quelleId, e.eigentuemer, e.wirkung])).toEqual([
            [QUELLE.fluss.id, "legacy", "befund"],
            [QUELLE.raben.id, "legacy", "befund"],
            [QUELLE.horas.id, "legacy", "befund"],
        ]);
    });

    it("🔴 „Neu zitiert“ wird angelegt, „nicht mehr zitiert“ still gelegt (nur mit belegter Wiki-Herkunft); die Zahlen stehen dabei, der Grund nennt, was mit der Quelle ist", () => {
        const bestehend = bestehendDerWelt();
        bestehend.set("wikipub:neues-buch", { id: uuid("5", 9), titel: "Neues Buch", aktiv: false });
        const ergebnis = rechne(
            "=== Ausführlich ===\n* [[Am Großen Fluss]] 40\n* [[Neues Buch]] 1\n* [[Das Horasreich]] 3\n=== Erwähnungen ===\n* [[Tombstone Buch]] 5",
            [
                verknuepfung(QUELLE.raben, { art: "erwaehnung", seiten: "2" }),
                verknuepfung(QUELLE.horas, { art: "ausfuehrlich", seiten: "9", herkunft: "manual" }),
            ],
            false,
            bestehend,
        );
        const von = (id: string | null) => ergebnis.entscheidungen.filter((e) => e.quelleId === id);
        // Eine Quelle des Katalogs, kein Eintrag am Träger: Die Verknüpfung wird angelegt.
        expect(von(QUELLE.fluss.id)[0]).toMatchObject({
            status: "neu",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            grund: GRUND_NEU_ZITIERT,
            alt: null,
            neu: { art: "ausfuehrlich", seiten: "40", notiz: null },
        });
        expect(von(QUELLE.fluss.id)[0]?.katalog).toBeUndefined();
        expect(von(QUELLE.tombstone.id)[0]).toMatchObject({
            status: "neu",
            wirkung: "uebernommen",
            grund: GRUND_NEU_ZITIERT,
        });
        // Eine Quelle, die jemand anderes still gelegt hat, bleibt still: nichts lebt wieder auf.
        expect(von(uuid("5", 9))[0]).toMatchObject({ status: "neu", wirkung: "befund", grund: GRUND_QUELLE_STILL });
        // Der Rabenkrieg steht im Artikel nicht mehr (wiki-eigene Verknüpfung ohne Nennung): sie wird still gelegt; die der Redaktion (Horasreich) sieht der Abgleich nicht.
        expect(ergebnis.entscheidungen.find((e) => e.status === "zu_entfernen")).toMatchObject({
            quelleId: QUELLE.raben.id,
            neu: null,
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            grund: GRUND_NICHT_MEHR,
        });
        expect(ergebnis.zahlen).toMatchObject({ neuZitiert: 3, nichtMehrZitiert: 1, angelegt: 2, stillgelegt: 1 });
        // Eine Verknüpfung ohne belegte Herkunft bleibt, auch wenn der Artikel sie nicht mehr nennt: ein Befund.
        const unbelegt = rechne("=== Ausführlich ===\n* [[Am Großen Fluss]] 40", [
            verknuepfung(QUELLE.raben, { art: "erwaehnung", seiten: "2", herkunft: "unbekannt" }),
        ]);
        expect(unbelegt.entscheidungen.find((e) => e.status === "zu_entfernen")).toMatchObject({
            eigentuemer: "unbekannt",
            wirkung: "befund",
            grund: GRUND_NICHT_MEHR_UNBELEGT,
        });
        expect(unbelegt.zahlen).toMatchObject({ nichtMehrZitiert: 1, stillgelegt: 0 });
        // Hat die Produktseite inzwischen eine Shop-Adresse, trägt die Quelle im Katalog noch die URL-lose Kennung: ein Befund, es wird nichts angelegt.
        const neueAdresse = rechne(
            "=== Ausführlich ===\n* [[Am Großen Fluss]] 1",
            [],
            false,
            new Map([["wikipub:am-grossen-fluss", { id: uuid("5", 8), titel: "Am Großen Fluss", aktiv: true }]]),
        );
        expect(neueAdresse.entscheidungen[0]).toMatchObject({
            quelleId: uuid("5", 8),
            wirkung: "befund",
            grund: GRUND_NEUE_ADRESSE,
        });
        expect(neueAdresse.zahlen.angelegt).toBe(0);
    });

    it("🔴 Fehlt die Katalogquelle, legt die Übernahme sie mit an: Schlüssel (wikipub: oder url:), Titel, Art der Quelle und „offiziell“ der Produktseite, Adresse nur mit Shop-Link", () => {
        const ADRESSE_HEFT = "https://www.ulisses-ebooks.de/de/product/4711/";
        const katalog: PublikationsKatalog = {
            produkte: new Map<string, Produkt>([
                ...KATALOG.produkte,
                [
                    "inoffiziell-heft",
                    {
                        seite: "Inoffiziell:Heft",
                        ns: 222,
                        titel: "Das Heft",
                        adresse: ADRESSE_HEFT,
                        quellenart: "abenteuer",
                    },
                ],
                ["neues-buch", { seite: "Neues Buch", ns: 0, titel: "Neues Buch", adresse: null, quellenart: "roman" }],
            ]),
            weiterleitungen: KATALOG.weiterleitungen,
        };
        const ergebnis = planeQuellen(
            artikel("=== Ausführlich ===\n* [[Neues Buch]] 1\n* [[Inoffiziell:Heft|Heft]] 2"),
            TRAEGER,
            [],
            katalog,
            new Map(),
            false,
            { offiziell: (ns) => ns !== 222 },
        );
        expect(ergebnis.entscheidungen.map((e) => [e.quelleId, e.wirkung, e.grund, e.katalog])).toEqual([
            [
                null,
                "uebernommen",
                GRUND_NICHT_IM_KATALOG,
                {
                    schluessel: "wikipub:neues-buch",
                    titel: "Neues Buch",
                    quellenart: "roman",
                    offiziell: true,
                    adresse: null,
                },
            ],
            [
                null,
                "uebernommen",
                GRUND_NICHT_IM_KATALOG,
                {
                    schluessel: adressSchluessel(ADRESSE_HEFT),
                    titel: "Das Heft",
                    quellenart: "abenteuer",
                    offiziell: false,
                    adresse: ADRESSE_HEFT,
                },
            ],
        ]);
        // Ohne Angabe der Art gilt sonstiges, ohne Namensraum-Regel offiziell.
        const schlicht = planeQuellen(
            artikel("=== Ausführlich ===\n* [[Neues Buch]] 1"),
            TRAEGER,
            [],
            KATALOG,
            new Map(),
            false,
        );
        expect(schlicht.entscheidungen[0]?.katalog).toMatchObject({ quellenart: "sonstiges", offiziell: true });
        // Der Wert der Zeile kehrt zurück, auch mit senkrechtem Strich in der Adresse; die Platzhalter-Kennung hängt nur am Schlüssel.
        const angaben = ergebnis.entscheidungen[1]!.katalog!;
        expect(leseKatalogWert(katalogWert(angaben), angaben.titel)).toEqual(angaben);
        expect(leseKatalogWert(katalogWert({ ...angaben, adresse: "https://a/b | c" }), "T")?.adresse).toBe(
            "https://a/b | c",
        );
        expect(leseKatalogWert("kaputt | nur zwei", "T")).toBeNull();
        expect(leseKatalogWert("a | b | vielleicht | c", "T")).toBeNull();
        expect(platzhalterId("wikipub:neues-buch")).toBe(platzhalterId("wikipub:neues-buch"));
        expect(platzhalterId("wikipub:neues-buch")).not.toBe(platzhalterId("wikipub:anderes-buch"));
        expect(platzhalterId("wikipub:neues-buch")).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u,
        );
        expect(KATALOG_FELD).toBe("katalog_neu");
    });

    it("🔴 Nichts lebt wieder auf, was die Redaktion, der Legacy-Zug oder ein Tombstone entfernte; nur was der WikiSync selbst still legte (Verknüpfung oder Quelle), kommt mit der nächsten Nennung zurück", () => {
        const text = "=== Ausführlich ===\n* [[Der Rabenkrieg]] 7";
        const von = (verknuepfungen: readonly QuellenVerknuepfung[], bestehend = bestehendDerWelt()) =>
            rechne(text, verknuepfungen, false, bestehend).entscheidungen[0];
        expect(von([verknuepfung(QUELLE.raben, { zustand: "retired", vonWikisyncGeloest: true })])).toMatchObject({
            wirkung: "uebernommen",
            grund: GRUND_VERKNUEPFUNG_WIEDER,
        });
        expect(von([verknuepfung(QUELLE.raben, { zustand: "retired", vonImportGeloest: true })])).toMatchObject({
            wirkung: "befund",
            grund: GRUND_IMPORT_GELOEST,
        });
        expect(von([verknuepfung(QUELLE.raben, { zustand: "retired", vonRedaktionGeloest: true })])).toMatchObject({
            wirkung: "befund",
            grund: GRUND_GELOEST,
        });
        // Eine Quelle, die der WikiSync still legte, lebt mit der Verknüpfung auf; eine fremd still gelegte nicht.
        const wikisyncStill = new Map([
            [
                "wikipub:der-rabenkrieg",
                { id: QUELLE.raben.id, titel: "Der Rabenkrieg", aktiv: false, vonWikisyncStill: true },
            ],
        ]);
        expect(von([], wikisyncStill)).toMatchObject({ wirkung: "uebernommen", grund: GRUND_QUELLE_WIEDER });
        const fremdStill = new Map([
            ["wikipub:der-rabenkrieg", { id: QUELLE.raben.id, titel: "Der Rabenkrieg", aktiv: false }],
        ]);
        expect(von([], fremdStill)).toMatchObject({ wirkung: "befund", grund: GRUND_QUELLE_STILL });
        // Gehört der Bereich noch dem Legacy-Zug, bleibt alles Vorschau: nichts wird angelegt oder still gelegt.
        const beiLegacy = rechne(text, [verknuepfung(QUELLE.fluss, { art: "ausfuehrlich" })], true);
        expect(beiLegacy.entscheidungen.map((e) => [e.status, e.eigentuemer, e.wirkung, e.grund])).toEqual([
            ["neu", "legacy", "befund", GRUND_NEU_VORSCHAU],
            ["zu_entfernen", "legacy", "befund", GRUND_NICHT_MEHR_VORSCHAU],
        ]);
        expect(beiLegacy.zahlen).toMatchObject({ angelegt: 0, stillgelegt: 0 });
    });

    it("🔴 Ein Tombstone und eine von der Redaktion gelöste Verknüpfung leben nie wieder auf", () => {
        const ergebnis = rechne("=== Ausführlich ===\n* [[Tombstone Buch]] 5\n* [[Der Rabenkrieg]] 7", [
            verknuepfung(QUELLE.tombstone, { zustand: "suppressed" }),
            verknuepfung(QUELLE.raben, { zustand: "retired", vonRedaktionGeloest: true }),
        ]);
        expect(ergebnis.entscheidungen.map((e) => [e.quelleId, e.status, e.eigentuemer, e.wirkung, e.grund])).toEqual([
            [QUELLE.tombstone.id, "unterdrueckt", "unterdrueckt", "befund", GRUND_TOMBSTONE],
            [QUELLE.raben.id, "unterdrueckt", "unterdrueckt", "befund", GRUND_GELOEST],
        ]);
        expect(ergebnis.zahlen.neuZitiert).toBe(0);
    });

    it("🔴 Die Quellen einer Straße, die der Wegeditor für die ganze Straße setzte (source_system editor an jedem Abschnitt, WI-0254 Runde 6), gehören der Redaktion: Abweichungen vom Wiki bleiben eigen, eine gelöste Zeile lebt nie wieder auf", () => {
        // Die Herkunft, wie der Lader sie aus der Zeile liest: die Redaktion schlägt auch eine Zeile, die Legacy als Publikation des Wikis führte.
        const vomEditor = verknuepfungsHerkunft({ source_system: "editor", legacy_origin: "wiki_publication" });
        expect(vomEditor).toBe("manual");
        expect(verknuepfungsHerkunft({ source_system: "legacy", legacy_origin: "wiki_publication" })).toBe("wiki");
        const weg = { art: "path" as InhalteTraegerArt, id: uuid("b", 1) };
        const amWeg = (quelle: (typeof QUELLE)[keyof typeof QUELLE], teil: Partial<QuellenVerknuepfung>) =>
            verknuepfung(quelle, { traegerArt: weg.art, traegerId: weg.id, herkunft: vomEditor, ...teil });
        const ergebnis = planeQuellen(
            artikel("=== Ausführlich ===\n* [[Am Großen Fluss]] 40\n* [[Der Rabenkrieg]] 7"),
            weg,
            [
                amWeg(QUELLE.fluss, { art: "erwaehnung", seiten: "1" }),
                amWeg(QUELLE.raben, { zustand: "retired", vonRedaktionGeloest: true }),
            ],
            KATALOG,
            bestehendDerWelt(),
            false,
        );
        expect(ergebnis.entscheidungen.map((e) => [e.quelleId, e.eigentuemer, e.wirkung, e.grund])).toEqual([
            [QUELLE.fluss.id, "manual", "eigen", null],
            [QUELLE.raben.id, "unterdrueckt", "befund", GRUND_GELOEST],
        ]);
        expect(ergebnis.zahlen).toMatchObject({ neuZitiert: 0, nichtMehrZitiert: 0 });
    });

    it("Ein Linkziel ohne Produktseite ergibt keine Quelle, nur eine Zahl und den Linktitel (jedes Ziel einmal)", () => {
        const ergebnis = rechne(
            "=== Ausführlich ===\n* [[Kein Produkt]] 1\n* [[Kein Produkt]] 2\n* [[Archiv der Kräuter]] 3",
            [],
        );
        expect(ergebnis.ohneProduktseite).toEqual(["Kein Produkt", "Archiv der Kräuter"]);
        expect(ergebnis.zahlen).toMatchObject({ ohneProduktseite: 2, gelesen: 0 });
        expect(ergebnis.entscheidungen).toEqual([]);
    });

    it("Seiten und Notiz sind so lang wie Legacys Spalten (120 und 200 Zeichen): der Vergleich liest, was dort stünde", () => {
        const lang = "x".repeat(300);
        const ergebnis = rechne(`=== Ausführlich ===\n* [[Am Großen Fluss]] 1 <small>(${lang})</small>`, [
            verknuepfung(QUELLE.fluss, { art: "ausfuehrlich", seiten: "1", notiz: "x".repeat(200) }),
        ]);
        expect(ergebnis.entscheidungen).toEqual([]);
    });
});

describe("WikiSync Quellen: die Nennungen, die der Lauf als Zitate ablegt (WI-0254 §12)", () => {
    const rechne = (
        text: string,
        bestehend = bestehendDerWelt(),
        verknuepfungen: readonly QuellenVerknuepfung[] = [],
    ) => planeQuellen(artikel(text), TRAEGER, verknuepfungen, KATALOG, bestehend, false);

    it("🔴 Auch wo nichts abweicht, steht die stärkste Nennung je Quelle da: Art, Seiten und Notiz aus der Zeile, die gewinnt, in der Reihenfolge des Artikels", () => {
        const ergebnis = rechne(
            "=== Erwähnungen ===\n* [[Am Großen Fluss]] Seite 9\n=== Ausführlich ===\n* [[Der Rabenkrieg]] 7\n* [[Am Großen Fluss]] Seite 40 <small>(Hauptnennung)</small>\n=== Ergänzend ===\n* [[Am Großen Fluss]] Seite 12",
            bestehendDerWelt(),
            // Die Verknüpfung gleicht der stärksten Nennung: Es gibt keine Entscheidung dazu, die Nennung steht trotzdem da.
            [verknuepfung(QUELLE.fluss, { art: "ausfuehrlich", seiten: "40", notiz: "Hauptnennung" })],
        );
        expect(ergebnis.entscheidungen.map((e) => e.quelleId)).toEqual([QUELLE.raben.id]);
        expect(ergebnis.nennungen).toEqual([
            { quelle: adressSchluessel(ADRESSE_FLUSS), art: "ausfuehrlich", seiten: "40", notiz: "Hauptnennung" },
            { quelle: "wikipub:der-rabenkrieg", art: "ausfuehrlich", seiten: "7", notiz: null },
        ]);
        // Ein Linkziel ohne Produktseite hat keine Nennung.
        expect(rechne("=== Ausführlich ===\n* [[Archiv der Kräuter]] 3").nennungen).toEqual([]);
    });

    it("🔴 Seiten und Notiz stehen so lang da, wie der Vergleich sie liest (120 und 200 Zeichen); fehlende sind null", () => {
        const lang = "x".repeat(300);
        const [nennung] = rechne(
            `=== Ausführlich ===\n* [[Der Rabenkrieg]] ${"9, ".repeat(100)} <small>(${lang})</small>`,
        ).nennungen;
        expect(Array.from(nennung?.seiten ?? "")).toHaveLength(120);
        expect(Array.from(nennung?.notiz ?? "")).toHaveLength(200);
        const [leer] = rechne("=== Erwähnungen ===\n* [[Der Rabenkrieg]]").nennungen;
        expect(leer).toEqual({ quelle: "wikipub:der-rabenkrieg", art: "erwaehnung", seiten: null, notiz: null });
    });

    it("🔴 Der Schlüssel ist der der Quelle, die die Karte hat: die alte Kennung wikipub: trotz neuer Shop-Adresse, sonst der, unter dem der Lauf sie anlegen würde", () => {
        const text = "=== Ausführlich ===\n* [[Am Großen Fluss]] 40\n* [[Neues Buch]] 2";
        // Die Produktseite hat eine Shop-Adresse, die Quelle in der Karte noch die URL-lose Kennung: Die Klappbox verbindet über deren Schlüssel.
        const alt = bestehendDerWelt();
        alt.delete(adressSchluessel(ADRESSE_FLUSS));
        alt.set("wikipub:am-grossen-fluss", { id: uuid("5", 9), titel: "Am Großen Fluss", aktiv: true });
        expect(rechne(text, alt).nennungen.map((n) => n.quelle)).toEqual([
            "wikipub:am-grossen-fluss",
            // „Neues Buch“ gibt es in der Karte nicht: Der Lauf würde sie unter diesem Schlüssel anlegen.
            "wikipub:neues-buch",
        ]);
        // Hat die Karte die Quelle unter dem Schlüssel der Adresse, gilt der.
        expect(rechne(text).nennungen.map((n) => n.quelle)).toEqual([
            adressSchluessel(ADRESSE_FLUSS),
            "wikipub:neues-buch",
        ]);
    });

    it("Eine Nennung steht auch da, wenn die Verknüpfung fehlt oder die Redaktion sie gelöst hat (das bleibt Befund, nichts wird angelegt)", () => {
        const ergebnis = rechne(
            "=== Ausführlich ===\n* [[Der Rabenkrieg]] 7\n* [[Das Horasreich]] 3",
            bestehendDerWelt(),
            [verknuepfung(QUELLE.horas, { zustand: "retired", vonRedaktionGeloest: true })],
        );
        expect(ergebnis.nennungen.map((n) => n.quelle)).toEqual(["wikipub:der-rabenkrieg", "wikipub:das-horasreich"]);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Der Plan des Bereichs
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function quelleObjekt(
    teil: { id: string; schluessel: string; titel: string },
    optionen: { redaktion?: boolean; aktiv?: boolean; verwendungen?: QuellenVerknuepfung[] } = {},
): PlanObjekt {
    const redaktion = optionen.redaktion === true;
    return {
        bereich: "quelle",
        objektArt: "source",
        id: teil.id,
        name: teil.titel,
        adresse: null,
        zustand: "zugewiesen",
        herkunft: redaktion ? "editor" : null,
        hauptzuweisung: true,
        lokal: new Map([["title", { zustand: "text", wert: teil.titel, vermerk: redaktion ? "manual" : "wiki" }]]),
        schnappschuss: new Map(),
        schnappschussUnbekannt: new Set(["title"]),
        quelle: {
            art: "quelle",
            schluessel: teil.schluessel,
            aktiv: optionen.aktiv ?? true,
            redaktion,
            verwendungen: optionen.verwendungen ?? [],
        },
    };
}

function traegerObjekt(
    id: string,
    adresse: string | null,
    verknuepfungen: QuellenVerknuepfung[],
    zustand: PlanObjekt["zustand"] = "zugewiesen",
): PlanObjekt {
    return {
        bereich: "quelle",
        objektArt: "place",
        id,
        name: `Ort ${id.slice(-2)}`,
        adresse,
        zustand,
        herkunft: null,
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: null,
        schnappschussUnbekannt: new Set(),
        quelle: { art: "traeger", traegerArt: "place", verknuepfungen },
    };
}

const seite = (titel: string, text: string, ns = 0): [string, GelesenerDumpArtikel[]] => [
    titel,
    [{ titel, ns, weiterleitung: null, text }],
];

function plane(
    objekte: PlanObjekt[],
    seiten: [string, GelesenerDumpArtikel[]][],
    optionen: { katalog?: PublikationsKatalog | null; legacy?: boolean } = {},
) {
    const katalog = optionen.katalog === null ? undefined : (optionen.katalog ?? KATALOG);
    return berechnePlan({
        bereiche: ["quelle"],
        objekte,
        dump: { gefunden: new Map(seiten), kandidaten: [] },
        tafel: wikiNamespaceTafel(),
        legacyBereiche: new Set(optionen.legacy === true ? ["quelle"] : []),
        bekannteTitel: new Set(),
        ...(katalog === undefined ? {} : { katalog }),
    });
}

const feldZeilen = (zeilen: readonly PlanZeile[], feld: (feld: string) => boolean): PlanZeile[] =>
    zeilen.filter((zeile) => zeile.feld !== null && feld(zeile.feld));

describe("WikiSync Quellen: der Plan des Bereichs", () => {
    const GARETH = uuid("a", 1);
    const HAVENA = uuid("a", 2);
    const text = (publikationen: string): string =>
        `{{Infobox Siedlung\n|Name=X\n}}\n== Publikationen ==\n${publikationen}`;

    it("🔴 Die Zeile gehört der Quelle, ihr Feld ist der Träger, ihr Artikel der des Trägers; der Titel der Quelle folgt der Produktseite, mit der Zahl der Träger", () => {
        const fluss = verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "40" });
        const flussHavena = verknuepfung(QUELLE.fluss, { traegerId: HAVENA, traegerName: "Havena" });
        const objekte = [
            quelleObjekt(QUELLE.fluss, { verwendungen: [fluss, flussHavena] }),
            traegerObjekt(GARETH, ADRESSE_TRAEGER, [fluss]),
            traegerObjekt(HAVENA, "https://de.wiki-aventurica.de/wiki/Havena", [flussHavena]),
        ];
        const plan = plane(objekte, [
            seite("Gareth", text("=== Ausführlich ===\n* [[Am Großen Fluss]] Seite 40, 145")),
            seite("Havena", text("=== Ergänzend ===\n* [[Am Großen Fluss]] ")),
        ]);
        const zeilen = plan.zeilen;
        expect(
            zeilen.map((z) => [z.feld === "title" ? "title" : "verwendung", z.objektId, z.objektArt, z.artikel]),
        ).toEqual([
            ["title", QUELLE.fluss.id, "source", "Am Großen Fluss"],
            ["verwendung", QUELLE.fluss.id, "source", "Gareth"],
        ]);
        expect(zeilen[0]).toMatchObject({
            alt: "Am Großen Fluss (alt)",
            neu: "Am Großen Fluss",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            status: "geaendert",
            // Zwei Träger tragen die Quelle: Eine Titeländerung trifft beide.
            objekte: 2,
            objektIds: [QUELLE.fluss.id],
        });
        expect(zeilen[1]).toMatchObject({
            bereich: "quelle",
            feld: verwendungsFeld("place", GARETH),
            alt: "ergaenzend | 40 | ",
            neu: "ausfuehrlich | 40, 145 | ",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
        });
        expect(plan.zahlen.quelle).toMatchObject({
            objekte: 2,
            mitAdresse: 2,
            gefunden: 2,
            felderGelesen: 3,
            unveraendert: 1,
            uebernommen: 2,
            befunde: 0,
        });
    });

    it("🔴 Der Plan führt die Zitate je Träger und Quelle (Art des Trägers, Kennung, Schlüssel, Artikel), auch wo alles gleich ist; wo kein Artikel lesbar ist, gibt es keine", () => {
        const fluss = verknuepfung(QUELLE.fluss, { art: "ausfuehrlich", seiten: "40" });
        const flussHavena = verknuepfung(QUELLE.fluss, { traegerId: HAVENA, traegerName: "Havena" });
        const objekte = [
            quelleObjekt(QUELLE.fluss, { verwendungen: [fluss, flussHavena] }),
            quelleObjekt(QUELLE.raben),
            traegerObjekt(GARETH, ADRESSE_TRAEGER, [fluss]),
            traegerObjekt(HAVENA, "https://de.wiki-aventurica.de/wiki/Havena", [flussHavena]),
            traegerObjekt(uuid("a", 3), "https://de.wiki-aventurica.de/wiki/Nirgendwo", []),
            traegerObjekt(uuid("a", 4), null, []),
        ];
        const plan = plane(objekte, [
            seite(
                "Gareth",
                text(
                    "=== Ausführlich ===\n* [[Am Großen Fluss]] Seite 40\n* [[Der Rabenkrieg]] 7 <small>(Krieg)</small>",
                ),
            ),
            seite("Havena", text("=== Ergänzend ===\n* [[Am Großen Fluss]] ")),
        ]);
        expect(plan.zitate).toEqual([
            {
                traegerArt: "place",
                traegerId: GARETH,
                quelle: adressSchluessel(ADRESSE_FLUSS),
                art: "ausfuehrlich",
                seiten: "40",
                notiz: null,
                artikel: "Gareth",
            },
            {
                traegerArt: "place",
                traegerId: GARETH,
                quelle: "wikipub:der-rabenkrieg",
                art: "ausfuehrlich",
                seiten: "7",
                notiz: "Krieg",
                artikel: "Gareth",
            },
            {
                traegerArt: "place",
                traegerId: HAVENA,
                quelle: adressSchluessel(ADRESSE_FLUSS),
                art: "ergaenzend",
                seiten: null,
                notiz: null,
                artikel: "Havena",
            },
        ]);
        // Ohne den Katalog der Produktseiten (der Vergleich EINES Artikels) und in einem Lauf ohne den Bereich gibt es keine.
        expect(plane(objekte, [], { katalog: null }).zitate).toEqual([]);
        const ohneQuellen = berechnePlan({
            bereiche: ["ort"],
            objekte: [],
            dump: { gefunden: new Map(), kandidaten: [] },
            tafel: wikiNamespaceTafel(),
            bekannteTitel: new Set(),
        });
        expect(ohneQuellen.zitate).toEqual([]);
    });

    it("🔴 Eine Quelle der Redaktion behält ihren Titel (eigen), Produktseiten mit gleicher Shop-Adresse und verschiedenen Titeln ergeben keinen Titel, nur einen Befund", () => {
        const katalog: PublikationsKatalog = {
            produkte: new Map<string, Produkt>([
                ...KATALOG.produkte,
                ["die-axt", { seite: "Die Axt im Walde", ns: 0, titel: "Die Axt im Walde", adresse: ADRESSE_FLUSS }],
            ]),
            weiterleitungen: KATALOG.weiterleitungen,
        };
        const fluss = verknuepfung(QUELLE.fluss, { art: "ausfuehrlich" });
        const raben = verknuepfung(QUELLE.raben, { art: "erwaehnung" });
        const plan = plane(
            [
                quelleObjekt(QUELLE.fluss, { verwendungen: [fluss] }),
                quelleObjekt(
                    { ...QUELLE.raben, titel: "Rabenkrieg (eigene Fassung)" },
                    { redaktion: true, verwendungen: [raben] },
                ),
                traegerObjekt(GARETH, ADRESSE_TRAEGER, [fluss, raben]),
            ],
            [
                seite(
                    "Gareth",
                    text("=== Ausführlich ===\n* [[Am Großen Fluss]] 1\n=== Erwähnungen ===\n* [[Der Rabenkrieg]] 2"),
                ),
            ],
            { katalog },
        );
        const titel = feldZeilen(plan.zeilen, (feld) => feld === "title");
        expect(titel.map((z) => [z.objektId, z.eigentuemer, z.wirkung, z.status])).toEqual([
            [QUELLE.fluss.id, "unbekannt", "befund", "mehrdeutig"],
            [QUELLE.raben.id, "manual", "eigen", "geaendert"],
        ]);
        expect(titel[0]?.neu).toBeNull();
        expect(titel[0]?.grund).toContain("Am Großen Fluss");
        expect(titel[0]?.grund).toContain("Die Axt im Walde");
    });

    it("🔴 Ohne Umschalten (Legacy-Zug) ist jede Abweichung nur Vorschau; ohne die Produktseiten des Dumps rechnet der Bereich nichts", () => {
        const fluss = verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "40" });
        const objekte = [
            quelleObjekt(QUELLE.fluss, { verwendungen: [fluss] }),
            traegerObjekt(GARETH, ADRESSE_TRAEGER, [fluss]),
        ];
        const seiten = [seite("Gareth", text("=== Ausführlich ===\n* [[Am Großen Fluss]] 40, 145"))];
        const beiLegacy = plane(objekte, seiten, { legacy: true });
        expect(beiLegacy.zeilen.map((z) => [z.eigentuemer, z.wirkung])).toEqual([
            ["legacy", "befund"],
            ["legacy", "befund"],
        ]);
        expect(beiLegacy.zahlen.quelle?.uebernommen).toBe(0);
        const ohneKatalog = plane(objekte, seiten, { katalog: null });
        expect(ohneKatalog.zeilen).toEqual([]);
        expect(ohneKatalog.zahlen.quelle).toMatchObject({ objekte: 1, felderGelesen: 0 });
    });

    it("Artikel, die fehlen, umgeleitet oder mehrdeutig sind, und gesperrte Zuordnungen zählen nur (ihren Befund sagt der Bereich des Trägers); „ohne Produktseite“ steht einmal je Ziel", () => {
        const umleitung: [string, GelesenerDumpArtikel[]] = [
            "Alt",
            [{ titel: "Alt", ns: 0, weiterleitung: "Gareth", text: "" }],
        ];
        const doppelt: [string, GelesenerDumpArtikel[]] = [
            "Doppelt",
            [
                { titel: "Doppelt", ns: 0, weiterleitung: null, text: text("") },
                { titel: "Doppelt", ns: 0, weiterleitung: null, text: text("") },
            ],
        ];
        const plan = plane(
            [
                traegerObjekt(uuid("a", 1), ADRESSE_TRAEGER, []),
                traegerObjekt(uuid("a", 2), "https://de.wiki-aventurica.de/wiki/Fehlt", []),
                traegerObjekt(uuid("a", 3), "https://de.wiki-aventurica.de/wiki/Alt", []),
                traegerObjekt(uuid("a", 4), "https://de.wiki-aventurica.de/wiki/Doppelt", []),
                traegerObjekt(uuid("a", 5), ADRESSE_TRAEGER, [], "getrennt"),
                traegerObjekt(uuid("a", 6), null, []),
                traegerObjekt(uuid("a", 7), "https://de.wiki-aventurica.de/wiki/Zwei", []),
            ],
            [
                seite("Gareth", text("=== Ausführlich ===\n* [[Kein Produkt]] 1\n* [[Archiv]] 2")),
                seite("Zwei", text("=== Ausführlich ===\n* [[Kein Produkt]] 1")),
                umleitung,
                doppelt,
            ],
        );
        expect(plan.zahlen.quelle).toMatchObject({
            objekte: 7,
            mitAdresse: 5,
            kennungOhneWikiAdresse: 1,
            gesperrt: 1,
            gefunden: 2,
            umgeleitet: 1,
            nichtImDump: 1,
            mehrdeutig: 1,
        });
        const ohne = feldZeilen(plan.zeilen, (feld) => feld === "ohne_produktseite");
        expect(ohne.map((z) => [z.objektName, z.objekte, z.objektId, z.wirkung, z.status])).toEqual([
            ["Archiv", 1, null, "befund", "neu"],
            ["Kein Produkt", 2, null, "befund", "neu"],
        ]);
        expect(plan.zeilen).toHaveLength(2);
    });

    it("🔴 Eine Quelle, die der Katalog nicht hat, bekommt EINE Zeile katalog_neu (Platzhalter-Kennung, Wert, Zahl der Verwendungen); ihre Verwendungen tragen dieselbe Kennung; die Zahlen nennen angelegt, still gelegt und neue Quellen", () => {
        const HAVENA = uuid("a", 2);
        const raben = verknuepfung(QUELLE.raben, { art: "erwaehnung", seiten: "2" });
        const objekte = [
            quelleObjekt(QUELLE.raben, { verwendungen: [raben] }),
            traegerObjekt(GARETH, ADRESSE_TRAEGER, [raben]),
            traegerObjekt(HAVENA, "https://de.wiki-aventurica.de/wiki/Havena", []),
        ];
        const plan = plane(objekte, [
            // Gareth nennt den Rabenkrieg nicht mehr und ein neues Buch; Havena nennt dasselbe neue Buch.
            seite("Gareth", text("=== Ausführlich ===\n* [[Neues Buch]] 3")),
            seite("Havena", text("=== Ergänzend ===\n* [[Neues Buch]] 5")),
        ]);
        const platzhalter = platzhalterId("wikipub:neues-buch");
        const katalog = feldZeilen(plan.zeilen, (feld) => feld === KATALOG_FELD);
        expect(katalog).toHaveLength(1);
        expect(katalog[0]).toMatchObject({
            objektId: platzhalter,
            objektIds: [platzhalter],
            objektName: "Neues Buch",
            artikel: "Neues Buch",
            objekte: 2,
            alt: null,
            neu: "wikipub:neues-buch | sonstiges | ja | ",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            status: "neu",
        });
        const verwendungen = feldZeilen(plan.zeilen, (feld) => feld.startsWith("verwendung_"));
        expect(
            verwendungen.map((z) => [z.objektId, z.status, z.wirkung, z.alt === null ? null : "alt", z.neu]),
        ).toEqual([
            [QUELLE.raben.id, "zu_entfernen", "uebernommen", "alt", null],
            [platzhalter, "neu", "uebernommen", null, "ausfuehrlich | 3 | "],
            [platzhalter, "neu", "uebernommen", null, "ergaenzend | 5 | "],
        ]);
        expect(plan.zahlen.quelle).toMatchObject({ angelegt: 2, stillgelegt: 1, quellenAngelegt: 1, uebernommen: 4 });
        // Dieselbe Quelle, die der Katalog schon hat, bekommt keine solche Zeile.
        const vorhanden = plane(
            [...objekte, quelleObjekt({ id: uuid("5", 9), schluessel: "wikipub:neues-buch", titel: "Neues Buch" })],
            [seite("Gareth", text("=== Ausführlich ===\n* [[Neues Buch]] 3"))],
        );
        expect(feldZeilen(vorhanden.zeilen, (feld) => feld === KATALOG_FELD)).toEqual([]);
        expect(vorhanden.zahlen.quelle?.quellenAngelegt).toBe(0);
    });

    it("Derselbe Eingang ergibt dieselben Zeilen in derselben Reihenfolge (Idempotenz)", () => {
        const fluss = verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "40" });
        const objekte = [
            quelleObjekt(QUELLE.fluss, { verwendungen: [fluss] }),
            traegerObjekt(GARETH, ADRESSE_TRAEGER, [fluss]),
        ];
        const seiten = [
            seite("Gareth", text("=== Ausführlich ===\n* [[Am Großen Fluss]] 40, 145\n* [[Neues Buch]] 3")),
        ];
        expect(plane(objekte, seiten)).toEqual(plane(objekte, seiten));
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Zitate der Vorkommen (WI-0254 §12)
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ein Eintrag der Vorkommen (`lore_entry`) als Träger von Zitaten: Er hat keine Verknüpfungen für den Vergleich. */
function vorkommenObjekt(
    id: string,
    adresse: string | null,
    zustand: PlanObjekt["zustand"] = "zugewiesen",
): PlanObjekt {
    return {
        bereich: "quelle",
        objektArt: "lore",
        id,
        name: `Eintrag ${id.slice(-2)}`,
        adresse,
        zustand,
        herkunft: null,
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: null,
        schnappschussUnbekannt: new Set(),
        quelle: { art: "vorkommen" },
    };
}

describe("WikiSync Quellen: die Zitate der Vorkommen (WI-0254 §12)", () => {
    // Nach Kennung sortiert: erst die Alraune, dann der Tatzelwurm.
    const ALRAUNE = uuid("b", 1);
    const TATZELWURM = uuid("b", 2);
    const GARETH = uuid("a", 1);
    const text = (publikationen: string): string =>
        `{{Infobox Tier\n|Name=X\n}}\n== Publikationen ==\n${publikationen}`;
    const ARTIKEL =
        "=== Ausführlich ===\n* [[Der Rabenkrieg]] 7 <small>(Krieg)</small>\n=== Ergänzend ===\n* [[Am Großen Fluss]] Seite 12";

    it("🔴 Dieselbe Rechnung wie die Nennungen des Vergleichs: stärkste Nennung je Quelle, auf 120 und 200 gekürzt, unter dem Schlüssel der Quelle der Karte", () => {
        const lang = "x".repeat(300);
        const zitate = artikel(
            `=== Erwähnungen ===\n* [[Am Großen Fluss]] Seite 9\n=== Ausführlich ===\n* [[Am Großen Fluss]] ${"9, ".repeat(100)} <small>(${lang})</small>\n* [[Der Rabenkrieg]] 7\n* [[Neues Buch]] 2\n* [[Archiv der Kräuter]] 3`,
        );
        // Die Karte hat die Quelle des Flusses noch unter der alten Kennung; „Neues Buch“ hat sie nicht.
        const bestehend = bestehendDerWelt();
        bestehend.delete(adressSchluessel(ADRESSE_FLUSS));
        bestehend.set("wikipub:am-grossen-fluss", { id: uuid("5", 9), titel: "Am Großen Fluss", aktiv: true });

        const nur = zitierteNennungen(zitate, KATALOG, bestehend);
        expect(nur).toEqual(planeQuellen(zitate, TRAEGER, [], KATALOG, bestehend, false).nennungen);
        expect(nur.map((n) => n.quelle)).toEqual([
            "wikipub:am-grossen-fluss",
            "wikipub:der-rabenkrieg",
            "wikipub:neues-buch",
        ]);
        expect(Array.from(nur[0]?.seiten ?? "")).toHaveLength(120);
        expect(Array.from(nur[0]?.notiz ?? "")).toHaveLength(200);
        expect(nur[1]).toEqual({ quelle: "wikipub:der-rabenkrieg", art: "ausfuehrlich", seiten: "7", notiz: null });
        // Ein Linkziel ohne Produktseite ist keine Quelle.
        expect(
            zitierteNennungen(artikel("=== Ausführlich ===\n* [[Archiv der Kräuter]] 3"), KATALOG, bestehend),
        ).toEqual([]);
    });

    it("🔴 Der Plan führt die Zitate der Vorkommen unter traegerArt lore, hinter denen der Karte; Zeilen und Zahlen der anderen Träger bleiben, wie sie sind", () => {
        const fluss = verknuepfung(QUELLE.fluss, { art: "ausfuehrlich", seiten: "40" });
        const karte = [
            quelleObjekt(QUELLE.fluss, { verwendungen: [fluss] }),
            quelleObjekt(QUELLE.raben),
            traegerObjekt(GARETH, ADRESSE_TRAEGER, [fluss]),
        ];
        const seiten = [
            seite("Gareth", text("=== Ausführlich ===\n* [[Am Großen Fluss]] Seite 40, 145")),
            seite("Tatzelwurm", text(ARTIKEL)),
            seite("Alraune", text("=== Erwähnungen ===\n* [[Der Rabenkrieg]]")),
        ];
        const ohne = plane(karte, seiten);
        const mit = plane(
            [
                ...karte,
                vorkommenObjekt(TATZELWURM, "https://de.wiki-aventurica.de/wiki/Tatzelwurm"),
                vorkommenObjekt(ALRAUNE, "https://de.wiki-aventurica.de/wiki/Alraune"),
            ],
            seiten,
        );
        // Zeilen und Zahlen sind dieselben: Die Einträge zählen nicht als Träger, vergleichen nichts und legen nichts an oder still.
        expect(mit.zeilen).toEqual(ohne.zeilen);
        expect(mit.zahlen).toEqual(ohne.zahlen);
        expect(mit.zitate.slice(0, ohne.zitate.length)).toEqual(ohne.zitate);
        expect(mit.zitate.slice(ohne.zitate.length)).toEqual([
            {
                traegerArt: "lore",
                traegerId: ALRAUNE,
                quelle: "wikipub:der-rabenkrieg",
                art: "erwaehnung",
                seiten: null,
                notiz: null,
                artikel: "Alraune",
            },
            {
                traegerArt: "lore",
                traegerId: TATZELWURM,
                quelle: "wikipub:der-rabenkrieg",
                art: "ausfuehrlich",
                seiten: "7",
                notiz: "Krieg",
                artikel: "Tatzelwurm",
            },
            {
                traegerArt: "lore",
                traegerId: TATZELWURM,
                quelle: adressSchluessel(ADRESSE_FLUSS),
                art: "ergaenzend",
                seiten: "12",
                notiz: null,
                artikel: "Tatzelwurm",
            },
        ]);
    });

    it("🔴 Kein Artikel, keine Zitate: ein unterdrückter Eintrag, einer ohne Adresse, ein fehlender, umgeleiteter oder mehrdeutiger Artikel und ein unbekannter Namensraum; ohne die Produktseiten des Dumps nichts", () => {
        const doppelt: [string, GelesenerDumpArtikel[]] = [
            "Doppelt",
            [
                { titel: "Doppelt", ns: 0, weiterleitung: null, text: text(ARTIKEL) },
                { titel: "Doppelt", ns: 0, weiterleitung: null, text: text(ARTIKEL) },
            ],
        ];
        const objekte = [
            vorkommenObjekt(uuid("b", 1), "https://de.wiki-aventurica.de/wiki/Tatzelwurm", "unterdrueckt"),
            vorkommenObjekt(uuid("b", 2), null),
            vorkommenObjekt(uuid("b", 3), "https://de.wiki-aventurica.de/wiki/Fehlt"),
            vorkommenObjekt(uuid("b", 4), "https://de.wiki-aventurica.de/wiki/Alt"),
            vorkommenObjekt(uuid("b", 5), "https://de.wiki-aventurica.de/wiki/Doppelt"),
            vorkommenObjekt(uuid("b", 6), "https://de.wiki-aventurica.de/wiki/Fremd"),
        ];
        const seiten: [string, GelesenerDumpArtikel[]][] = [
            seite("Tatzelwurm", text(ARTIKEL)),
            ["Alt", [{ titel: "Alt", ns: 0, weiterleitung: "Tatzelwurm", text: "" }]],
            doppelt,
            seite("Fremd", text(ARTIKEL), 9999),
        ];
        expect(plane(objekte, seiten).zitate).toEqual([]);
        // Mit lesbarem Artikel gibt es sie; ohne die Produktseiten des Dumps (Vergleich EINES Artikels) nicht.
        const lesbar = [vorkommenObjekt(uuid("b", 7), "https://de.wiki-aventurica.de/wiki/Tatzelwurm")];
        expect(plane(lesbar, seiten).zitate).toHaveLength(2);
        expect(plane(lesbar, seiten, { katalog: null }).zitate).toEqual([]);
        // Beim Legacy-Zug gilt dasselbe: Es sind nur Zitate, kein Eigentum.
        expect(plane(lesbar, seiten, { legacy: true }).zitate).toHaveLength(2);
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Prüfung der Übernahme
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("WikiSync Quellen: die Übernahme prüft jede Zeile gegen den Stand von jetzt", () => {
    const feld = verwendungsFeld(TRAEGER.art, TRAEGER.id);
    const zeile = (teil: Partial<VorschauZeile> = {}): VorschauZeile => ({
        id: 1,
        bereich: "quelle",
        objektArt: "source",
        objektId: QUELLE.fluss.id,
        objektName: QUELLE.fluss.titel,
        objekte: 1,
        objektIds: [QUELLE.fluss.id],
        artikel: "Gareth",
        feld,
        alt: "ergaenzend | 40 | ",
        altZustand: "text",
        neu: "ausfuehrlich | 40, 145 | ",
        neuZustand: "text",
        eigentuemer: "wiki",
        wirkung: "uebernommen",
        ...teil,
    });
    const welt = (verwendung: Partial<QuellenVerknuepfung> = {}, quelle: { aktiv?: boolean } = {}) => {
        const eine = verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "40", ...verwendung });
        return new Map([[QUELLE.fluss.id, quelleObjekt(QUELLE.fluss, { ...quelle, verwendungen: [eine] })]]);
    };

    it("stimmt der Stand mit der Vorschau, wird die Verknüpfung geändert", () => {
        const ergebnis = entscheideVerwendungen([zeile()], welt());
        expect(ergebnis.befunde).toEqual([]);
        expect(ergebnis.schritte).toHaveLength(1);
        expect(ergebnis.schritte[0]).toMatchObject({
            vorher: { art: "ergaenzend", seiten: "40", notiz: null },
            nachher: { art: "ausfuehrlich", seiten: "40, 145", notiz: null },
        });
    });

    it("🔴 Sonst bleibt sie, wie sie ist, und ein Befund sagt warum: geändert, gelöst, der Redaktion, ein anderer Artikel, die Quelle weg oder still", () => {
        const grund = (z: VorschauZeile, w: ReturnType<typeof welt>): string[] =>
            entscheideVerwendungen([z], w).befunde.map((b) => `${b.befund}: ${b.grund}`);
        expect(grund(zeile(), welt({ seiten: "41" }))).toEqual([
            "seit_vorschau_geaendert: Die Verknüpfung hat sich seit der Vorschau geändert",
        ]);
        expect(grund(zeile(), welt({ zustand: "retired" }))).toEqual([
            "seit_vorschau_geaendert: Die Verknüpfung ist inzwischen gelöst",
        ]);
        expect(grund(zeile(), welt({ herkunft: "manual" }))).toEqual([
            "seit_vorschau_geaendert: Die Verknüpfung gehört nicht mehr dem Wiki",
        ]);
        expect(grund(zeile(), welt({ herkunft: "unbekannt" }))).toEqual([
            "seit_vorschau_geaendert: Die Verknüpfung gehört nicht mehr dem Wiki",
        ]);
        expect(grund(zeile(), welt({ traegerAdresse: "https://de.wiki-aventurica.de/wiki/Havena" }))).toEqual([
            "seit_vorschau_geaendert: Das Objekt hängt inzwischen an einem anderen Artikel",
        ]);
        expect(grund(zeile(), welt({ art: null }))).toEqual([
            "seit_vorschau_geaendert: Die Verknüpfung gehört nicht mehr dem Wiki",
        ]);
        expect(grund(zeile(), welt({}, { aktiv: false }))).toEqual([
            "seit_vorschau_geaendert: Die Quelle ist inzwischen stillgelegt",
        ]);
        expect(grund(zeile(), new Map())).toEqual(["seit_vorschau_geaendert: Die Quelle ist nicht mehr im Katalog"]);
        expect(grund(zeile({ feld: verwendungsFeld("territory", TRAEGER.id) }), welt())).toEqual([
            "seit_vorschau_geaendert: Die Verknüpfung gibt es nicht mehr",
        ]);
    });

    it("Steht schon, was das Wiki nennt, ist nichts zu tun; nur Zeilen des Wikis mit Wirkung „übernommen“ zählen, alles andere hat die Vorschau als Befund oder eigenen Wert gezeigt", () => {
        const schon = entscheideVerwendungen([zeile()], welt({ art: "ausfuehrlich", seiten: "40, 145" }));
        expect(schon).toMatchObject({ schritte: [], befunde: [], schonGleich: 1 });
        const andere = [
            zeile({ eigentuemer: "unbekannt", wirkung: "befund" }),
            zeile({ eigentuemer: "manual", wirkung: "eigen" }),
            zeile({ alt: null, altZustand: "kein", neu: null, neuZustand: "kein" }),
            zeile({ feld: "title", alt: "x", neu: "y" }),
        ];
        expect(entscheideVerwendungen(andere, welt())).toMatchObject({ schritte: [], befunde: [], schonGleich: 0 });
    });

    describe("anlegen, still legen, die Quelle anlegen", () => {
        const anlegen = (teil: Partial<VorschauZeile> = {}): VorschauZeile =>
            zeile({ alt: null, altZustand: "kein", neu: "ausfuehrlich | 40 | ", ...teil });
        const stilllegen = (teil: Partial<VorschauZeile> = {}): VorschauZeile =>
            zeile({ alt: "ergaenzend | 40 | ", neu: null, neuZustand: "kein", ...teil });
        /** Die Welt: die Quelle mit den Verwendungen und der Träger mit denselben Verknüpfungen. */
        const traegerWelt = (
            verwendungen: QuellenVerknuepfung[] = [],
            quelle: { aktiv?: boolean; vonWikisyncStill?: boolean } = {},
            adresse: string | null = ADRESSE_TRAEGER,
        ) => {
            const q = quelleObjekt(QUELLE.fluss, { aktiv: quelle.aktiv ?? true, verwendungen });
            if (quelle.vonWikisyncStill === true && q.quelle?.art === "quelle") q.quelle.vonWikisyncStill = true;
            return new Map([
                [QUELLE.fluss.id, q],
                [TRAEGER.id, traegerObjekt(TRAEGER.id, adresse, verwendungen)],
            ]);
        };
        const grund = (z: VorschauZeile, w: ReturnType<typeof traegerWelt>): string[] =>
            entscheideVerwendungen([z], w).befunde.map((b) => `${b.befund}: ${b.grund}`);

        it("🔴 Anlegen: ohne Verknüpfung am Träger entsteht ein Schritt; nicht, wenn es sie inzwischen gibt, wenn jemand sie entfernte oder löste, wenn die Quelle still ist oder der Träger woanders hängt", () => {
            const ergebnis = entscheideVerwendungen([anlegen()], traegerWelt());
            expect(ergebnis.befunde).toEqual([]);
            expect(ergebnis.schritte).toHaveLength(1);
            expect(ergebnis.schritte[0]).toMatchObject({
                art: "anlegen",
                traeger: { art: "place", id: TRAEGER.id },
                nachher: { art: "ausfuehrlich", seiten: "40", notiz: null },
                wiederbeleben: false,
                quelleBeleben: false,
            });
            expect(ergebnis.schritte[0]?.objekt.id).toBe(QUELLE.fluss.id);
            // Es gibt sie inzwischen: gleich ist erledigt, anders ein Befund.
            expect(
                entscheideVerwendungen(
                    [anlegen()],
                    traegerWelt([verknuepfung(QUELLE.fluss, { art: "ausfuehrlich", seiten: "40" })]),
                ),
            ).toMatchObject({ schritte: [], befunde: [], schonGleich: 1 });
            expect(grund(anlegen(), traegerWelt([verknuepfung(QUELLE.fluss, { art: "erwaehnung" })]))).toEqual([
                "seit_vorschau_geaendert: Die Verknüpfung gibt es inzwischen schon",
            ]);
            // Nichts lebt wieder auf, was die Redaktion oder der Legacy-Zug entfernte; der WikiSync belebt seine eigene.
            expect(grund(anlegen(), traegerWelt([verknuepfung(QUELLE.fluss, { zustand: "suppressed" })]))).toEqual([
                "seit_vorschau_geaendert: Die Redaktion hat die Verknüpfung inzwischen entfernt",
            ]);
            for (const teil of [{ vonRedaktionGeloest: true }, { vonImportGeloest: true }]) {
                expect(
                    grund(anlegen(), traegerWelt([verknuepfung(QUELLE.fluss, { zustand: "retired", ...teil })])),
                ).toEqual(["seit_vorschau_geaendert: Die Verknüpfung ist inzwischen von jemand anderem gelöst"]);
            }
            const belebt = entscheideVerwendungen(
                [anlegen()],
                traegerWelt([verknuepfung(QUELLE.fluss, { zustand: "retired", vonWikisyncGeloest: true })]),
            );
            expect(belebt.schritte[0]).toMatchObject({ art: "anlegen", wiederbeleben: true });
            // Die Quelle: still gelegt von jemand anderem bleibt still, vom WikiSync lebt sie auf.
            expect(grund(anlegen(), traegerWelt([], { aktiv: false }))).toEqual([
                "seit_vorschau_geaendert: Die Quelle ist inzwischen stillgelegt",
            ]);
            expect(
                entscheideVerwendungen([anlegen()], traegerWelt([], { aktiv: false, vonWikisyncStill: true }))
                    .schritte[0],
            ).toMatchObject({ art: "anlegen", quelleBeleben: true });
            // Der Träger: anderer Artikel, weg.
            expect(grund(anlegen(), traegerWelt([], {}, "https://de.wiki-aventurica.de/wiki/Havena"))).toEqual([
                "seit_vorschau_geaendert: Das Objekt hängt inzwischen an einem anderen Artikel",
            ]);
            expect(grund(anlegen(), new Map([[QUELLE.fluss.id, quelleObjekt(QUELLE.fluss)]]))).toEqual([
                "seit_vorschau_geaendert: Das Objekt gibt es nicht mehr",
            ]);
            expect(grund(anlegen(), new Map())).toEqual([
                "seit_vorschau_geaendert: Die Quelle ist nicht mehr im Katalog",
            ]);
        });

        it("🔴 Still legen: nur eine aktive Verknüpfung mit belegter Wiki-Herkunft, die noch so dasteht, wie die Vorschau sie sah; eine schon still gelegte ist erledigt", () => {
            const schritt = entscheideVerwendungen(
                [stilllegen()],
                traegerWelt([verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "40" })]),
            );
            expect(schritt.befunde).toEqual([]);
            expect(schritt.schritte[0]).toMatchObject({
                art: "stilllegen",
                vorher: { art: "ergaenzend", seiten: "40", notiz: null },
            });
            const welt2 = (teil: Partial<QuellenVerknuepfung>) =>
                traegerWelt([verknuepfung(QUELLE.fluss, { art: "ergaenzend", seiten: "40", ...teil })]);
            expect(grund(stilllegen(), welt2({ herkunft: "manual" }))).toEqual([
                "seit_vorschau_geaendert: Die Verknüpfung gehört nicht mehr dem Wiki",
            ]);
            expect(grund(stilllegen(), welt2({ herkunft: "unbekannt" }))).toEqual([
                "seit_vorschau_geaendert: Die Verknüpfung gehört nicht mehr dem Wiki",
            ]);
            expect(grund(stilllegen(), welt2({ seiten: "41" }))).toEqual([
                "seit_vorschau_geaendert: Die Verknüpfung hat sich seit der Vorschau geändert",
            ]);
            expect(grund(stilllegen(), welt2({ zustand: "retired", vonRedaktionGeloest: true }))).toEqual([
                "seit_vorschau_geaendert: Die Verknüpfung ist inzwischen gelöst",
            ]);
            expect(
                entscheideVerwendungen([stilllegen()], welt2({ zustand: "retired", vonWikisyncGeloest: true })),
            ).toMatchObject({
                schritte: [],
                befunde: [],
                schonGleich: 1,
            });
            expect(grund(stilllegen(), traegerWelt([], { aktiv: false }))).toEqual([
                "seit_vorschau_geaendert: Die Quelle ist inzwischen stillgelegt",
            ]);
        });

        it("🔴 Die Quelle anlegen: Die Zeile katalog_neu und die Verwendungen derselben Platzhalter-Kennung ergeben EINEN Schritt mit allen Verknüpfungen; gibt es den Schlüssel inzwischen, gilt die bestehende Quelle", () => {
            const angaben = {
                schluessel: "wikipub:neues-buch",
                titel: "Neues Buch",
                quellenart: "roman",
                offiziell: true,
                adresse: null,
            };
            const platzhalter = platzhalterId(angaben.schluessel);
            const zweiter = uuid("a", 2);
            const katalogZeile = anlegen({
                feld: KATALOG_FELD,
                objektId: platzhalter,
                objektIds: [platzhalter],
                objektName: "Neues Buch",
                neu: katalogWert(angaben),
            });
            const link = (traegerId: string): VorschauZeile =>
                anlegen({
                    feld: verwendungsFeld("place", traegerId),
                    objektId: platzhalter,
                    objektIds: [platzhalter],
                    objektName: "Neues Buch",
                    artikel: traegerId === TRAEGER.id ? "Gareth" : "Havena",
                });
            const objekte = new Map<string, PlanObjekt>([
                [TRAEGER.id, traegerObjekt(TRAEGER.id, ADRESSE_TRAEGER, [])],
                [zweiter, traegerObjekt(zweiter, "https://de.wiki-aventurica.de/wiki/Havena", [])],
            ]);
            const ergebnis = entscheideVerwendungen([katalogZeile, link(TRAEGER.id), link(zweiter)], objekte);
            expect(ergebnis.befunde).toEqual([]);
            expect(ergebnis.schritte).toHaveLength(1);
            expect(ergebnis.schritte[0]).toMatchObject({ art: "katalog", angaben });
            expect(ergebnis.schritte[0]?.objekt.id).toBe(platzhalter);
            expect(
                (ergebnis.schritte[0] as { links: { traeger: { id: string } }[] }).links.map(
                    (eintrag) => eintrag.traeger.id,
                ),
            ).toEqual([TRAEGER.id, zweiter]);
            // Ein Träger, der nicht mehr am Artikel hängt, fällt aus der Quelle heraus; bleibt keiner, wird sie nicht angelegt.
            objekte.set(zweiter, traegerObjekt(zweiter, "https://de.wiki-aventurica.de/wiki/Anderswo", []));
            const einer = entscheideVerwendungen([katalogZeile, link(TRAEGER.id), link(zweiter)], objekte);
            expect(einer.befunde.map((b) => b.grund)).toEqual(["Das Objekt hängt inzwischen an einem anderen Artikel"]);
            expect((einer.schritte[0] as { links: unknown[] }).links).toHaveLength(1);
            objekte.set(TRAEGER.id, traegerObjekt(TRAEGER.id, "https://de.wiki-aventurica.de/wiki/Anderswo", []));
            expect(entscheideVerwendungen([katalogZeile, link(TRAEGER.id)], objekte).schritte).toEqual([]);
            // Hat jemand die Quelle inzwischen angelegt (derselbe Schlüssel), gilt sie wie eine bestehende: ein gewöhnlicher Schritt „anlegen“ an ihr.
            const jemand = quelleObjekt({ id: uuid("5", 77), schluessel: angaben.schluessel, titel: "Neues Buch" });
            const mitQuelle = new Map<string, PlanObjekt>([
                [TRAEGER.id, traegerObjekt(TRAEGER.id, ADRESSE_TRAEGER, [])],
                [jemand.id, jemand],
            ]);
            const bestehend = entscheideVerwendungen([katalogZeile, link(TRAEGER.id)], mitQuelle);
            expect(bestehend.schritte).toHaveLength(1);
            expect(bestehend.schritte[0]).toMatchObject({ art: "anlegen" });
            expect(bestehend.schritte[0]?.objekt.id).toBe(jemand.id);
        });
    });
});
