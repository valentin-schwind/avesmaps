import { wikiNamespaceTafel, type WikisyncOrtsrolle } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";
import type { ZielInfo } from "../src/wiki/abgleich/ortsrolle.ts";
import { berechnePlan, type LokalerWert, type PlanObjekt, type PlanZeile } from "../src/wiki/abgleich/plan.ts";
import {
    baueWuensche,
    leseLoreOrtWert,
    loreOrtWert,
    ortszeilenFeld,
    planeOrtszeilen,
    type LoreBestand,
    type LoreWunsch,
    type LoreZeile,
} from "../src/wiki/abgleich/vorkommen.ts";
import type { GelesenerDumpArtikel, KandidatNeuerArtikel } from "../src/wiki/dump/seiten-sammler.ts";
import { rollenImFeld } from "../src/wiki/abgleich/ortsrolle.ts";
import { VORKOMMEN_FELDER } from "../src/wiki/infobox/vorkommen.ts";

/**
 * Die Ortszeilen der Vorkommen im Plan (WI-0253, Scheibe Vorkommen, §23), rein.
 *
 * - **Soll:** Jeder Wikilink eines Ortsfelds bleibt eine Ortszeile mit Rolle; neue werden angelegt, nicht mehr genannte still gelegt – nur bei belegter Wiki-Herkunft. Manuelle Zeilen, Ziele der
 *   Redaktion und Tombstones bleiben und leben nie wieder auf; was der WikiSync selbst still legte, lebt mit der nächsten Nennung wieder auf. Ein Eintrag der Redaktion gehört samt Liste der Redaktion.
 * - **Bestand ohne Rolle gilt als Ort** und bekommt nur eine Zeile, wenn das Wiki etwas anderes sagt.
 * - **Weiterleitungen** am Ziel werden aufgelöst (Legacy: nie); der Bericht zählt, wie oft.
 */

const tafel = wikiNamespaceTafel();
const wikiUrl = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

const zeile = (
    id: string,
    schluessel: string,
    optionen: Partial<LoreZeile> & { beziehung?: string } = {},
): LoreZeile => ({
    id,
    schluessel,
    titel: schluessel,
    beziehung: "verbreitung",
    stelle: 0,
    zustand: "active",
    stillVon: null,
    herkunft: "wiki",
    rolle: null,
    ...optionen,
});
const bestand = (zeilen: LoreZeile[], redaktion = false, art = "fauna"): LoreBestand => ({ art, zeilen, redaktion });
const wunsch = (schluessel: string, rolle: WikisyncOrtsrolle = "ort", extra: Partial<LoreWunsch> = {}): LoreWunsch => ({
    beziehung: "verbreitung",
    schluessel,
    urschluessel: schluessel,
    titel: schluessel,
    stelle: 0,
    rolle,
    grund: rolle === "ort" ? null : "Grund",
    ...extra,
});
const plane = (wuensche: LoreWunsch[], b: LoreBestand, legacy = false) =>
    planeOrtszeilen(wuensche, b, ["verbreitung"], legacy);
const ohneFeld = (e: ReturnType<typeof plane>["entscheidungen"]) =>
    e.map((x) => ({
        alt: x.alt === null ? null : `${x.alt.schluessel}:${x.alt.rolle}`,
        neu: x.neu === null ? null : `${x.neu.schluessel}:${x.neu.rolle}`,
        eigentuemer: x.eigentuemer,
        wirkung: x.wirkung,
        status: x.status,
    }));

describe("WikiSync Vorkommen: Feld und Wert einer Ortszeile", () => {
    it("das Feld ist klein, höchstens 64 Zeichen und trägt die Beziehung; der Wert lässt sich zurücklesen, auch mit einem Punkt im Titel", () => {
        const feld = ortszeilenFeld("verbreitung", "a".repeat(180));
        expect(feld).toMatch(/^[a-z][a-z0-9_]*$/u);
        expect(feld.length).toBeLessThanOrEqual(64);
        expect(ortszeilenFeld("verbreitung", "x")).not.toBe(ortszeilenFeld("herkunft", "x"));
        const wert = { titel: "Bornland · (Region)", rolle: "teil" as const, schluessel: "bornland-region" };
        expect(leseLoreOrtWert(loreOrtWert(wert))).toEqual(wert);
        expect(leseLoreOrtWert("kaputt")).toBeNull();
        expect(leseLoreOrtWert("Titel · unbekannt · schluessel")).toBeNull();
    });
});

describe("WikiSync Vorkommen: die Wünsche des Artikels", () => {
    const ziele: Record<string, ZielInfo> = {
        Thorwal: { weiterleitung: "Thorwal (Region)" },
        "Thorwal (Region)": { infobox: "Region", eltern: ["Aventurien"] },
        Weiden: { infobox: "Region", eltern: ["Aventurien"] },
    };
    const wissen = { info: (t: string) => ziele[t], istFlaeche: () => false };
    const rollen = (feld: string) => new Map([["verbreitung" as const, rollenImFeld(feld, wissen)]]);

    it("löst Weiterleitungen am Ziel auf und zählt sie; zwei Links auf dasselbe Ziel sind EIN Wunsch, und ein Ort gewinnt", () => {
        const orte = [
            { titel: "Thorwal", schluessel: "thorwal", beziehung: "verbreitung" as const, stelle: 0 },
            { titel: "Weiden", schluessel: "weiden", beziehung: "verbreitung" as const, stelle: 1 },
            { titel: "Thorwal (Region)", schluessel: "thorwal-region", beziehung: "verbreitung" as const, stelle: 2 },
        ];
        const { wuensche, weiterleitungen } = baueWuensche(
            orte,
            rollen("[[Thorwal]], [[Weiden]], nördliches [[Thorwal (Region)]]"),
            wissen,
        );
        // „Thorwal“ führt über die Weiterleitung auf „Thorwal (Region)“: derselbe Schlüssel wie der dritte Link.
        expect(wuensche.map((w) => [w.schluessel, w.urschluessel, w.rolle, w.stelle])).toEqual([
            ["thorwal-region", "thorwal", "ort", 0],
            ["weiden", "weiden", "ort", 1],
        ]);
        expect(weiterleitungen).toBe(1);
    });

    it("die Rolle kommt aus dem Feld: ein Teil, ein Ausgenommener; ohne Auskunft ein Ort", () => {
        const orte = [
            { titel: "Weiden", schluessel: "weiden", beziehung: "verbreitung" as const, stelle: 0 },
            { titel: "Thorwal (Region)", schluessel: "thorwal-region", beziehung: "verbreitung" as const, stelle: 1 },
            { titel: "Nirgendwo", schluessel: "nirgendwo", beziehung: "verbreitung" as const, stelle: 2 },
        ];
        const { wuensche } = baueWuensche(orte, rollen("nördliches [[Weiden]], nicht [[Thorwal (Region)]]"), wissen);
        expect(wuensche.map((w) => [w.schluessel, w.rolle])).toEqual([
            ["weiden", "teil"],
            ["thorwal-region", "ausgenommen"],
            ["nirgendwo", "ort"],
        ]);
    });
});

describe("WikiSync Vorkommen: die Ortszeilen gegen den Bestand", () => {
    it("🔴 Bestand ohne Rolle gilt als Ort: keine Zeile, wenn das Wiki Ort sagt; eine Zeile, wenn es etwas anderes sagt", () => {
        const b = bestand([zeile("1", "weiden"), zeile("2", "perricum")]);
        const e = plane([wunsch("weiden"), wunsch("perricum", "bezugspunkt")], b);
        expect(e.zahlen).toMatchObject({ gleich: 1, angelegt: 0, stillgelegt: 0 });
        expect(ohneFeld(e.entscheidungen)).toEqual([
            {
                alt: "perricum:ort",
                neu: "perricum:bezugspunkt",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
                status: "geaendert",
            },
        ]);
        expect(e.entscheidungen[0]!.grund).toContain("Grund");
    });

    it("🔴 eine neue Nennung wird angelegt (mit Rolle), eine nicht mehr genannte still gelegt – nur bei belegter Wiki-Herkunft", () => {
        const b = bestand([
            zeile("1", "weiden"),
            zeile("2", "gone-wiki"),
            zeile("3", "gone-unbekannt", { herkunft: "unbekannt" }),
            zeile("4", "gone-manuell", { herkunft: "manual" }),
        ]);
        const e = plane([wunsch("weiden"), wunsch("neu", "volk")], b);
        expect(e.zahlen).toMatchObject({ gleich: 1, angelegt: 1, stillgelegt: 1 });
        expect(ohneFeld(e.entscheidungen)).toEqual([
            { alt: null, neu: "neu:volk", eigentuemer: "wiki", wirkung: "uebernommen", status: "neu" },
            { alt: "gone-wiki:ort", neu: null, eigentuemer: "wiki", wirkung: "uebernommen", status: "zu_entfernen" },
            // Ohne belegte Herkunft bleibt die Zeile, ein Befund; die manuelle Zeile sieht der Abgleich nicht.
            {
                alt: "gone-unbekannt:ort",
                neu: null,
                eigentuemer: "unbekannt",
                wirkung: "befund",
                status: "zu_entfernen",
            },
        ]);
    });

    it("🔴 Tombstone, von der Redaktion gelöste und vom Legacy-Zug entfernte Zeile leben nie auf; was der WikiSync still legte, lebt auf", () => {
        const b = bestand([
            zeile("1", "tomb", { zustand: "suppressed", stillVon: "editor" }),
            zeile("2", "redaktion", { zustand: "retired", stillVon: "editor" }),
            zeile("3", "zug", { zustand: "retired", stillVon: "import" }),
            zeile("4", "eigen", { zustand: "retired", stillVon: "wikisync" }),
        ]);
        const e = plane([wunsch("tomb"), wunsch("redaktion"), wunsch("zug"), wunsch("eigen", "teil")], b);
        expect(ohneFeld(e.entscheidungen)).toEqual([
            { alt: null, neu: "tomb:ort", eigentuemer: "unterdrueckt", wirkung: "befund", status: "unterdrueckt" },
            { alt: null, neu: "redaktion:ort", eigentuemer: "unterdrueckt", wirkung: "befund", status: "unterdrueckt" },
            { alt: null, neu: "zug:ort", eigentuemer: "unbekannt", wirkung: "befund", status: "neu" },
            { alt: null, neu: "eigen:teil", eigentuemer: "wiki", wirkung: "uebernommen", status: "neu" },
        ]);
        expect(e.zahlen.angelegt).toBe(1);
        // Die Rückfrage steht im Grund jeder Zeile mit der Rolle „teil“.
        expect(e.entscheidungen[3]!.grund).toContain("Rückfrage");
    });

    it("eine Zeile ohne belegte Herkunft ist unbelegt: weicht ihre Rolle ab, ein Befund; eine manuelle Zeile sieht der Abgleich nicht", () => {
        const b = bestand([zeile("1", "a", { herkunft: "unbekannt" }), zeile("2", "b", { herkunft: "manual" })]);
        const e = plane([wunsch("a", "volk"), wunsch("b", "volk")], b);
        expect(ohneFeld(e.entscheidungen)).toEqual([
            { alt: "a:ort", neu: "a:volk", eigentuemer: "unbekannt", wirkung: "befund", status: "geaendert" },
        ]);
    });

    it("🔴 ein Eintrag der Redaktion gehört samt Liste der Redaktion: jede Abweichung ist eigen, nichts wird still gelegt", () => {
        const b = bestand([zeile("1", "weiden"), zeile("2", "gone")], true);
        const e = plane([wunsch("weiden", "teil"), wunsch("neu")], b);
        expect(ohneFeld(e.entscheidungen)).toEqual([
            { alt: "weiden:ort", neu: "weiden:teil", eigentuemer: "manual", wirkung: "eigen", status: "geaendert" },
            { alt: null, neu: "neu:ort", eigentuemer: "manual", wirkung: "eigen", status: "neu" },
            { alt: "gone:ort", neu: null, eigentuemer: "manual", wirkung: "eigen", status: "zu_entfernen" },
        ]);
        expect(e.zahlen).toMatchObject({ angelegt: 0, stillgelegt: 0 });
    });

    it("🔴 eine Weiterleitung am Ziel ersetzt die Zeile des alten Schlüssels (die alte still, die neue an) – nur bei belegter Herkunft", () => {
        const w = wunsch("thorwal-region", "ort", { urschluessel: "thorwal", titel: "Thorwal" });
        const wiki = plane([w], bestand([zeile("1", "thorwal")]));
        expect(ohneFeld(wiki.entscheidungen)).toEqual([
            {
                alt: "thorwal:ort",
                neu: "thorwal-region:ort",
                eigentuemer: "wiki",
                wirkung: "uebernommen",
                status: "geaendert",
            },
        ]);
        expect(wiki.zahlen).toMatchObject({ angelegt: 1, stillgelegt: 1 });
        const unbelegt = plane([w], bestand([zeile("1", "thorwal", { herkunft: "unbekannt" })]));
        expect(ohneFeld(unbelegt.entscheidungen)).toEqual([
            {
                alt: "thorwal:ort",
                neu: "thorwal-region:ort",
                eigentuemer: "unbekannt",
                wirkung: "befund",
                status: "geaendert",
            },
        ]);
        // Die alte Zeile wird nicht noch einmal als „nicht mehr genannt“ gemeldet.
        expect(unbelegt.entscheidungen).toHaveLength(1);
        // Gibt es die Zeile unter dem neuen Schlüssel schon, ist nichts zu tun außer dem Rest.
        const schonDa = plane([w], bestand([zeile("1", "thorwal-region")]));
        expect(schonDa.entscheidungen).toEqual([]);
    });

    it("solange der Legacy-Zug den Bereich liefert, ist alles nur Vorschau: nichts wird angelegt oder still gelegt", () => {
        const e = plane([wunsch("neu")], bestand([zeile("1", "gone")]), true);
        expect(ohneFeld(e.entscheidungen)).toEqual([
            { alt: null, neu: "neu:ort", eigentuemer: "legacy", wirkung: "befund", status: "neu" },
            { alt: "gone:ort", neu: null, eigentuemer: "legacy", wirkung: "befund", status: "zu_entfernen" },
        ]);
        expect(e.zahlen).toMatchObject({ angelegt: 0, stillgelegt: 0 });
    });

    it("Zeilen anderer Beziehungen und ungeklärte Namen der Redaktion sieht der Abgleich nicht", () => {
        const b = bestand([
            zeile("1", "gone", { beziehung: "vorkommen" }),
            { ...zeile("2", "x"), schluessel: null, titel: "Irgendwo", herkunft: "manual" },
        ]);
        expect(plane([], b).entscheidungen).toEqual([]);
    });
});

describe("WikiSync Vorkommen: der Plan eines Bereichs", () => {
    const WIKI_SEITE = (titel: string, text: string): GelesenerDumpArtikel => ({
        titel,
        ns: 0,
        weiterleitung: null,
        text,
    });
    const eigen = (feld: string, wert: string | null, vermerk: LokalerWert["vermerk"]): [string, LokalerWert] => [
        feld,
        wert === null
            ? vermerk === "manual"
                ? { zustand: "leer", wert: "", vermerk: "manual" }
                : { zustand: "kein", wert: null, vermerk: "kein" }
            : { zustand: "text", wert, vermerk },
    ];
    const objekt = (
        id: string,
        titel: string,
        zeilen: LoreZeile[],
        optionen: { redaktion?: boolean; art?: string; stand?: [string, string | null][]; unbekannt?: string[] } = {},
    ): PlanObjekt & { lokal: Map<string, LokalerWert> } => ({
        bereich: "vorkommen",
        objektArt: "lore",
        id,
        name: titel,
        adresse: wikiUrl(titel),
        zustand: "zugewiesen",
        herkunft: optionen.redaktion === true ? "editor" : null,
        hauptzuweisung: true,
        lokal: new Map<string, LokalerWert>([
            eigen("name", titel, optionen.redaktion === true ? "manual" : "wiki"),
            // Ein Eintrag der Redaktion führt jedes Feld als eigene Entscheidung, ein leeres als bewusst leer (ladeVorkommen).
            eigen("gruppe", null, optionen.redaktion === true ? "manual" : "kein"),
            eigen("typ", null, optionen.redaktion === true ? "manual" : "kein"),
            eigen("lebensraum", null, optionen.redaktion === true ? "manual" : "kein"),
            eigen("synonyme", null, optionen.redaktion === true ? "manual" : "kein"),
            eigen("continent", null, optionen.redaktion === true ? "manual" : "kein"),
        ]),
        schnappschuss: new Map(optionen.stand ?? []),
        schnappschussUnbekannt: new Set(optionen.unbekannt ?? VORKOMMEN_FELDER),
        vorkommen: bestand(zeilen, optionen.redaktion === true, optionen.art ?? "fauna"),
    });
    const ziele = new Map<string, ZielInfo>([
        ["Weiden", { infobox: "Region", eltern: ["Aventurien"] }],
        ["Perricum", { infobox: "Siedlung", eltern: ["Aranien"] }],
        ["Havena (Siedlung)", { infobox: "Siedlung", eltern: ["Aventurien"] }],
        ["Maraskan", { infobox: "Region", eltern: ["Aventurien"] }],
        ["Wald", { kategorien: ["Vegetationszone"] }],
    ]);
    const lauf = (
        objekte: PlanObjekt[],
        seiten: GelesenerDumpArtikel[],
        kandidaten: KandidatNeuerArtikel[] = [],
        legacy = false,
    ) =>
        berechnePlan({
            bereiche: ["vorkommen"],
            objekte,
            dump: {
                gefunden: new Map(seiten.map((s) => [s.titel, [s]])),
                kandidaten,
                ziele,
            },
            tafel,
            legacyBereiche: legacy ? new Set(["vorkommen"]) : new Set(),
            bekannteTitel: new Set(objekte.map((o) => o.name.toLowerCase())),
        });
    const nachFeld = (zeilen: PlanZeile[]) => Object.fromEntries(zeilen.map((z) => [z.feld ?? "-", z]));

    const ARTIKEL = [
        "{{Infobox Tierart",
        "|Name=Rotkehlchen",
        "|Art=[[Vogel]]",
        "|Vorkommen=[[Wald]]",
        "|Verbreitung=[[Weiden]], [[Aventurien]] nicht [[Maraskan]], südlich der Linie [[Perricum]] und [[Havena (Siedlung)|Havena]]",
        "}}",
    ].join("\n");

    it("🔴 Felder, Wiki-Stand und Ortszeilen mit Rollen in einem Lauf; Zahlen je Rolle", () => {
        const o = objekt("l1", "Rotkehlchen", [zeile("1", "weiden"), zeile("2", "maraskan"), zeile("3", "alt")]);
        const plan = lauf([o], [WIKI_SEITE("Rotkehlchen", ARTIKEL)]);
        const z = nachFeld(plan.zeilen);
        // Felder des Eintrags: Gruppe und Lebensraum füllt das Wiki (leer, ohne Vermerk), der Name stimmt.
        expect(z["gruppe"]).toMatchObject({
            neu: "[[Vogel]]",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            status: "neu",
        });
        expect(z["lebensraum"]).toMatchObject({ neu: "[[Wald]]" });
        expect(z["name"]).toBeUndefined();
        // Der Wiki-Stand: die Rohtexte der Infobox, nur im Stand.
        expect(z["roh_verbreitung"]).toMatchObject({ eigentuemer: "wiki", wirkung: "uebernommen", status: "neu" });
        expect(z["roh_vorkommen"]).toMatchObject({ neu: "[[Wald]]" });
        // Ortszeilen: Maraskan wird ausgenommen (Rolle), Perricum und Havena Bezugspunkte (angelegt), Aventurien angelegt, die alte still gelegt.
        const orte = plan.zeilen.filter((x) => x.feld?.startsWith("ortszeile_") === true);
        expect(
            orte.map((x) => [
                x.alt === null ? null : leseLoreOrtWert(x.alt)?.schluessel,
                x.neu === null ? null : leseLoreOrtWert(x.neu)?.rolle,
                x.status,
            ]),
        ).toEqual([
            // In der Reihenfolge des Artikels: Weiden stimmt (keine Zeile), Aventurien ist neu, Maraskan wird ausgenommen, Perricum und Havena sind Endpunkte der Linie.
            [null, "ort", "neu"],
            ["maraskan", "ausgenommen", "geaendert"],
            [null, "bezugspunkt", "neu"],
            [null, "bezugspunkt", "neu"],
            ["alt", null, "zu_entfernen"],
        ]);
        expect(plan.zahlen["vorkommen"]).toMatchObject({
            objekte: 1,
            mitAdresse: 1,
            gefunden: 1,
            rollen: { ort: 2, ausgenommen: 1, bezugspunkt: 2 },
            angelegt: 3,
            stillgelegt: 1,
            rueckfragen: 0,
            weiterleitungen: 0,
        });
    });

    it("🔴 ein Wiki-Stand, der dem Wiki gleicht, macht Eigenes still: keine Dauerbefunde, wenn das Wiki sich nicht bewegt hat", () => {
        const stand: [string, string | null][] = [
            ["name", "Rotkehlchen"],
            ["gruppe", "[[Vogel]]"],
            ["typ", null],
            ["lebensraum", "[[Wald]]"],
            ["synonyme", null],
            ["continent", null],
            [
                "roh_verbreitung",
                "[[Weiden]], [[Aventurien]] nicht [[Maraskan]], südlich der Linie [[Perricum]] und [[Havena (Siedlung)|Havena]]",
            ],
            ["roh_herkunft", null],
            ["roh_regionen", null],
            ["roh_vorkommen", "[[Wald]]"],
        ];
        // Die Redaktion hat Gruppe und Lebensraum anders gesetzt (mit Vermerk manual) und dazu einen Wert ohne Vermerk (Synonyme).
        const o = objekt("l1", "Rotkehlchen", [], { stand, unbekannt: [] });
        o.lokal.set("gruppe", { zustand: "text", wert: "Singvogel", vermerk: "manual" });
        o.lokal.set("lebensraum", { zustand: "text", wert: "Wälder", vermerk: "kein" });
        const still = lauf([o], [WIKI_SEITE("Rotkehlchen", ARTIKEL)]);
        const felder = still.zeilen.filter((x) => x.feld !== null && !x.feld.startsWith("ortszeile_"));
        expect(felder).toEqual([]);
        // Dieselbe Welt ohne Wiki-Stand: Der eigene Wert ist ein Befund (ohne Vermerk) und der eigene (mit Vermerk) eine Nachricht.
        const o2 = objekt("l1", "Rotkehlchen", []);
        o2.lokal.set("gruppe", { zustand: "text", wert: "Singvogel", vermerk: "manual" });
        o2.lokal.set("lebensraum", { zustand: "text", wert: "Wälder", vermerk: "kein" });
        const z = nachFeld(lauf([o2], [WIKI_SEITE("Rotkehlchen", ARTIKEL)]).zeilen);
        expect(z["gruppe"]).toMatchObject({ eigentuemer: "manual", wirkung: "eigen" });
        expect(z["lebensraum"]).toMatchObject({ eigentuemer: "unbekannt", wirkung: "befund" });
    });

    it("🔴 ein Eintrag der Redaktion bleibt ihr: Felder und Liste sind eigen", () => {
        const o = objekt("l1", "Rotkehlchen", [zeile("1", "weiden")], { redaktion: true });
        const z = lauf([o], [WIKI_SEITE("Rotkehlchen", ARTIKEL)]).zeilen.filter(
            (x) => x.feld !== null && !x.feld.startsWith("roh_"),
        );
        expect(z.length).toBeGreaterThan(0);
        for (const x of z) expect(x.wirkung === "eigen" || x.wirkung === "befund").toBe(true);
        expect(z.every((x) => x.eigentuemer === "manual")).toBe(true);
    });

    it("die Art ändert sich nie: Eine andere Infobox ist ein Befund, die Felder werden nicht verglichen", () => {
        const o = objekt("l1", "Rotkehlchen", [zeile("1", "weiden")], { art: "flora" });
        const plan = lauf([o], [WIKI_SEITE("Rotkehlchen", ARTIKEL)]);
        expect(plan.zeilen).toHaveLength(1);
        expect(plan.zeilen[0]).toMatchObject({ befund: "infobox_kaputt", grund: "andere_art:fauna", feld: null });
    });

    it("ein Artikel mit einer der vier Infoboxen, den kein Eintrag kennt, ist ein Befund „neuer Artikel“; angelegt wird nichts", () => {
        const o = objekt("l1", "Rotkehlchen", []);
        const kandidaten: KandidatNeuerArtikel[] = [
            { titel: "Rotkehlchen", ns: 0, infobox: "Tierart", art: "vorkommen" },
            { titel: "Blaumeise", ns: 0, infobox: "Tierart", art: "vorkommen" },
            { titel: "Inoffiziell:Wolpertinger", ns: 222, infobox: "Tierart", art: "vorkommen" },
        ];
        const plan = lauf([o], [WIKI_SEITE("Rotkehlchen", ARTIKEL)], kandidaten);
        const neu = plan.zeilen.filter((x) => x.befund === "neuer_artikel");
        expect(neu.map((x) => x.objektName)).toEqual(["Blaumeise", "Inoffiziell:Wolpertinger"]);
        expect(plan.zahlen["vorkommen"]).toMatchObject({ neueArtikel: 2 });
    });

    it("ohne die Auskunft über Linkziele (der Vergleich EINES Artikels) rechnet der Plan die Ortszeilen nicht, wohl die Felder", () => {
        const o = objekt("l1", "Rotkehlchen", [zeile("1", "weiden")]);
        const plan = berechnePlan({
            bereiche: ["vorkommen"],
            objekte: [o],
            dump: { gefunden: new Map([["Rotkehlchen", [WIKI_SEITE("Rotkehlchen", ARTIKEL)]]]), kandidaten: [] },
            tafel,
            bekannteTitel: new Set(["rotkehlchen"]),
        });
        expect(plan.zeilen.some((x) => x.feld?.startsWith("ortszeile_") === true)).toBe(false);
        expect(plan.zeilen.some((x) => x.feld === "gruppe")).toBe(true);
    });

    it("Wiederholung: derselbe Dump und dieselben Objekte ergeben dieselben Zeilen", () => {
        const o = objekt("l1", "Rotkehlchen", [zeile("1", "weiden"), zeile("3", "alt")]);
        const a = lauf([o], [WIKI_SEITE("Rotkehlchen", ARTIKEL)]);
        const b = lauf([o], [WIKI_SEITE("Rotkehlchen", ARTIKEL)]);
        expect(b).toEqual(a);
    });
});
