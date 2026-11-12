import { describe, expect, it } from "vitest";
import { baueKartenSvg } from "../src/karten-export/svg/bauer.ts";
import type { KartenSvgDaten } from "../src/karten-export/svg/daten.ts";
import type { Flaeche } from "../src/karten-export/svg/geometrie.ts";
import {
    KARTEN_SVG_EBENEN,
    KARTEN_SVG_GLATT,
    KARTEN_SVG_ROH,
    type KartenSvgOptionen,
} from "../src/karten-export/svg/optionen.ts";

/**
 * Der SVG-Bauer der Karte (WI-0280 K2): reine Funktionstests mit Festwerten, ohne Datenbank und ohne Dateisystem.
 *
 * Pflichtfälle in Anlehnung an Legacys `svg-export-build.test.js` und die Abnahme `tools/svg-export/abzug-pruefung.js` (Mirror):
 * wohlgeformtes XML, `viewBox`/`width`/`height`, Ebenenreihenfolge, Abwahl einer Ebene, jede Vokabel steht im Vokabular, Pfadbefehle nur
 * `M L Z` (roh) bzw. `M L C Z` (glatt), Gebiete auch geglättet eckig, Escaping, Passmarken je Ebene, gleiche Bytes bei gleichen Eingaben.
 *
 * 🪤 Ein Test, der den Schalter nicht setzt, prüft den Schalter nicht: Die Eindeutigkeit der ids lief in Legacy an einem Dokument OHNE
 * Passmarken (Befund der Bild-Pipeline 18.08.2026). Hier prüft jeder Fall das Dokument, das den Schalter wirklich trägt.
 */

// ---- Eine kleine, aber vollständige Karte -------------------------------------------------------------------------------

/** Ein Rechteck als Fläche (Kartenkoordinaten, y nach Norden). */
function rechteck(x0: number, y0: number, x1: number, y1: number): Flaeche {
    return [
        [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    ];
}

/** Ein Rechteck mit rechteckigem Loch: Der Punkt in der Mitte liegt NICHT in der Fläche. */
function rahmen(x0: number, y0: number, x1: number, y1: number, loch: number): Flaeche {
    const [aussen] = rechteck(x0, y0, x1, y1)[0] ?? [];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    return [
        [
            aussen ?? [],
            [
                [mx - loch, my - loch],
                [mx + loch, my - loch],
                [mx + loch, my + loch],
                [mx - loch, my + loch],
                [mx - loch, my - loch],
            ],
        ],
    ];
}

const SCHWIERIGER_NAME = "Fels & <Fluss> \"Zwei\" 'drei'";

const DATEN: KartenSvgDaten = {
    staende: { kartenfassung: "16", landschaftsfassung: "12", importstand: "2026-10-31T20:43:58Z" },
    flaechen: [
        {
            kennung: "tropisch",
            landschaft: "",
            name: "Tropische Zone",
            ebene: "klima",
            typ: "tropisch",
            flaeche: rechteck(0, 0, 1024, 300),
        },
        {
            kennung: "a-region",
            landschaft: "l-region",
            name: "Aventurien",
            ebene: "derographisch",
            typ: "region",
            flaeche: rechteck(10, 10, 1000, 1000),
        },
        {
            kennung: "a-wald",
            landschaft: "l-wald",
            name: "Salamandersteine",
            ebene: "vegetation",
            typ: "wald",
            flaeche: rechteck(100, 100, 200, 200),
        },
        {
            kennung: "a-bergwald",
            landschaft: "l-bergwald",
            name: "Bergwald",
            ebene: "vegetation",
            typ: "wald",
            flaeche: rechteck(121, 121, 139, 139),
        },
        {
            kennung: "a-urwald",
            landschaft: "l-urwald",
            name: SCHWIERIGER_NAME,
            ebene: "vegetation",
            typ: "urwald",
            flaeche: rechteck(700, 100, 760, 160),
        },
        {
            kennung: "a-neu",
            landschaft: "l-neu",
            name: "Zeile\neins\u0001",
            ebene: "vegetation",
            typ: "neue_art",
            flaeche: rechteck(800, 100, 830, 130),
        },
        {
            kennung: "a-gebirge",
            landschaft: "l-gebirge",
            name: "Amdeggynmassiv",
            ebene: "topographie",
            typ: "gebirge",
            flaeche: rahmen(120, 120, 180, 180, 10),
        },
        {
            kennung: "a-meer",
            landschaft: "l-meer",
            name: "Perlenmeer",
            ebene: "topographie",
            typ: "meer",
            flaeche: rechteck(600, 600, 900, 900),
        },
        {
            kennung: "a-see",
            landschaft: "l-see",
            name: "Angbarer See",
            ebene: "topographie",
            typ: "see",
            flaeche: rechteck(300, 300, 340, 340),
        },
    ],
    gebiete: [
        { kennung: "t-kosch", name: "Fürstentum Kosch", typ: "Fürstentum", flaeche: rechteck(120, 120, 260, 260) },
        { kennung: "t-albern", name: "Albernia", typ: "Königreich", flaeche: rechteck(400, 700, 500, 800) },
    ],
    wege: [
        {
            kennung: "w-reich",
            name: "Reichsstraße 2",
            art: "Reichsstrasse",
            bach: false,
            beschriftung: true,
            punkte: [
                [100, 100],
                [300, 250],
                [500, 260],
                [520, 400],
            ],
        },
        {
            kennung: "w-fluss",
            name: "Großer Fluss",
            art: "Flussweg",
            bach: false,
            beschriftung: true,
            punkte: [
                [310, 320],
                [420, 380],
                [600, 640],
            ],
        },
        {
            kennung: "w-bach",
            name: "Mühlbach",
            art: "Flussweg",
            bach: true,
            beschriftung: false,
            punkte: [
                [200, 500],
                [220, 520],
                [260, 530],
            ],
        },
        {
            kennung: "w-see",
            name: "Südmeerroute",
            art: "Seeweg",
            bach: false,
            beschriftung: true,
            punkte: [
                [620, 620],
                [880, 880],
            ],
        },
        {
            kennung: "w-pfad",
            name: "",
            art: "Pfad",
            bach: false,
            beschriftung: true,
            punkte: [
                [10, 10],
                [20, 30],
            ],
        },
    ],
    kraftlinien: [
        {
            kennung: "k-nord",
            name: "Kraftlinie Nord",
            punkte: [
                [10, 10],
                [200, 400],
            ],
        },
    ],
    orte: [
        { kennung: "o-gareth", name: "Gareth", art: "metropole", x: 551.625, y: 532.969, beschriftung: true },
        { kennung: "o-punin", name: "Punin", art: "metropole", x: 518.25739, y: 441.22919, beschriftung: true },
        { kennung: "o-dorf", name: "Fels & Fluss", art: "dorf", x: 150, y: 150, beschriftung: false },
        { kennung: "o-kreuz", name: "Furt", art: "crossing", x: 420, y: 330, beschriftung: true },
    ],
    landmarken: [
        { kennung: "m-fall", name: "Donnerfall", art: "wasserfall", x: 400, y: 500, hoehe: null },
        { kennung: "m-gipfel", name: "Drachenzahn", art: "berggipfel", x: 125, y: 125, hoehe: 9000 },
    ],
    beschriftungen: [{ kennung: "b-mittelreich", name: "Mittelreich", x: 420, y: 520 }],
    gipfel: [{ x: 125, y: 125, hoehe: 9000 }],
};

const ERSTELLT = "2026-11-05T00:00:00.000Z";
const STEMPEL = { erstellt: ERSTELLT };

const roh = (aenderung: Partial<KartenSvgOptionen> = {}) =>
    baueKartenSvg(DATEN, { ...KARTEN_SVG_ROH, ...aenderung }, STEMPEL);
const glatt = (aenderung: Partial<KartenSvgOptionen> = {}) =>
    baueKartenSvg(DATEN, { ...KARTEN_SVG_GLATT, ...aenderung }, STEMPEL);

// ---- Hilfen der Prüfung -------------------------------------------------------------------------------------------------

/** Ein einfacher Prüfer ohne XML-Bibliothek: ausgeglichene Tags, eindeutige Attribute, nur maskierter Text. Befunde, leer wenn in Ordnung. */
function pruefeWohlgeformt(svg: string): string[] {
    const befunde: string[] = [];
    if (!svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')) befunde.push("Kopf");
    if (!svg.endsWith("</svg>\n")) befunde.push("Schluss");
    const stapel: string[] = [];
    let wurzeln = 0;
    const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/gu;
    for (const treffer of svg.matchAll(tag)) {
        const [, schliessend, name = "", attribute = "", leer] = treffer;
        const namen = [...attribute.matchAll(/\s([\w:.-]+)="/gu)].map((a) => a[1]);
        if (new Set(namen).size !== namen.length) befunde.push(`doppeltes Attribut in <${name}>`);
        if (schliessend) {
            if (stapel.pop() !== name) befunde.push(`</${name}> ohne Gegenstück`);
        } else if (!leer) {
            if (stapel.length === 0) wurzeln += 1;
            stapel.push(name);
        }
    }
    if (stapel.length > 0) befunde.push(`offen geblieben: ${stapel.join(",")}`);
    if (wurzeln !== 1) befunde.push(`Wurzeln: ${String(wurzeln)}`);
    // Was nach dem Entfernen aller Tags übrig bleibt, ist Text: Er darf kein `<` und kein rohes `&` tragen.
    const text = svg.replace('<?xml version="1.0" encoding="UTF-8"?>', "").replace(tag, "");
    if (text.includes("<") || text.includes(">")) befunde.push("nicht maskiertes Zeichen im Text");
    if (/&(?!(?:amp|lt|gt|quot|#\d+);)/u.test(svg)) befunde.push("nicht maskiertes &");
    // Zeichen, die XML 1.0 nicht kennt (auch nicht als Verweis).
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(svg)) befunde.push("Steuerzeichen");
    return befunde;
}

function entmaskiere(text: string): string {
    return text
        .replace(/&#(\d+);/gu, (_, zahl: string) => String.fromCodePoint(Number(zahl)))
        .replace(/&lt;/gu, "<")
        .replace(/&gt;/gu, ">")
        .replace(/&quot;/gu, '"')
        .replace(/&amp;/gu, "&");
}

interface Vokabular {
    felder: Record<string, string>;
    arten: Record<string, { de: string; en: string }>;
    ebenen: Record<string, { de: string; en: string }>;
    typen: Record<string, { de: string; en: string; anzahl: number; unbeschrieben?: boolean }>;
    klimabaender: { typ: string; y_von: number; y_bis: number }[];
    kombinationen: {
        typ: string;
        relief: string;
        klima: string;
        gipfelhoehe: number | "";
        anzahl: number;
        flaeche: number;
    }[];
    reihenfolge: string;
}

function liesVokabular(svg: string): Vokabular {
    const treffer = /<desc id="avm-vokabular">([^<]*)<\/desc>/u.exec(svg);
    expect(treffer, "Vokabular im Kopf").not.toBeNull();
    return JSON.parse(entmaskiere(treffer?.[1] ?? "")) as Vokabular;
}

/** Alle Werte eines `avm:`-Attributs an Elementen (nicht an der Wurzel). */
function werte(svg: string, attribut: string): string[] {
    const ohneWurzel = svg.slice(svg.indexOf("</metadata>"));
    return [...ohneWurzel.matchAll(new RegExp(` avm:${attribut}="([^"]*)"`, "gu"))].map((t) => entmaskiere(t[1] ?? ""));
}

/** Alle Pfadbefehle (Buchstaben) in `d=`-Attributen. */
function befehle(svg: string): Set<string> {
    const gefunden = new Set<string>();
    for (const t of svg.matchAll(/ d="([^"]*)"/gu))
        for (const b of (t[1] ?? "").match(/[A-Za-z]/gu) ?? []) gefunden.add(b);
    return gefunden;
}

/**
 * Der Teil des Dokuments zwischen dem Beginn einer Ebene und dem Beginn der nächsten.
 * 💣 Gesucht wird die nächste EBENE, nicht irgendeine Gruppe: Auch Untergruppen heißen `layer-landschaften-wald`.
 */
function ebene(svg: string, id: string): string {
    const von = svg.indexOf(`<g id="${id}"`);
    expect(von, `Ebene ${id}`).toBeGreaterThanOrEqual(0);
    const rest = svg.slice(von + 1);
    const bis = rest.search(/<g id="layer-(?:landschaften|gebiete|wege|kraftlinien|orte|beschriftungen)"/u);
    return bis < 0 ? rest : rest.slice(0, bis);
}

/** Die Pfaddaten des Elements mit dieser `avm:id`. */
function pfadVon(svg: string, kennung: string): string {
    const treffer = new RegExp(`<path[^>]*avm:id="${kennung}"[^>]* d="([^"]*)"`, "u").exec(svg);
    expect(treffer, `Pfad ${kennung}`).not.toBeNull();
    return treffer?.[1] ?? "";
}

const EBENEN_IDS = [
    "layer-landschaften",
    "layer-gebiete",
    "layer-wege",
    "layer-kraftlinien",
    "layer-orte",
    "layer-beschriftungen",
] as const;

// ---- Der Rahmen ---------------------------------------------------------------------------------------------------------

describe("Rahmen und Wohlgeformtheit", () => {
    it("ist wohlgeformt, roh wie geglättet, in beiden Dialekten, mit allem was schwierig ist", () => {
        for (const dialekt of ["inkscape", "illustrator"] as const) {
            for (const [name, fassung] of [
                ["roh", roh],
                ["glatt", glatt],
            ] as const) {
                const svg = fassung({ dialekt, passmarken: true }).svg;
                expect(pruefeWohlgeformt(svg), `${name} ${dialekt}`).toEqual([]);
                // Gruppen ausgeglichen, auch mit Passmarken (Legacys `nimm()` setzt sie vor das letzte `</g>`).
                expect((svg.match(/<g[\s>]/gu) ?? []).length).toBe((svg.match(/<\/g>/gu) ?? []).length);
            }
        }
    });

    it("trägt viewBox 0 0 1024 1024 und die gewählte Größe in width/height; der Zeichenraum bleibt immer 1024", () => {
        const standard = roh().svg;
        expect(standard).toContain('viewBox="0 0 1024 1024" width="32768" height="32768"');
        const klein = roh({ groessePx: 2048 }).svg;
        expect(klein).toContain('viewBox="0 0 1024 1024" width="2048" height="2048"');
        expect(klein).toContain('avm:einheit_px="2"');
        expect(standard).toContain('avm:einheit_px="32"');
        // Ungültige Größen werden in den Wertebereich geholt, nie gezeichnet.
        expect(roh({ groessePx: 3 }).svg).toContain('width="256" height="256"');
        expect(roh({ groessePx: Number.NaN }).svg).toContain('width="32768" height="32768"');
    });

    it("hält die Namensräume und die Lizenz im Kopf", () => {
        const svg = roh().svg;
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('xmlns:avm="https://avesmaps.de/ns/export/1"');
        expect(svg).toContain('xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"');
        expect(svg).toMatch(/<metadata>[\s\S]*avesmaps\.de[\s\S]*Kartenpaket\/Lizenz[\s\S]*<\/metadata>/u);
        // 💣 Der Illustrator-Dialekt führt keinen inkscape:-Namensraum und keine inkscape:-Attribute.
        const illustrator = roh({ dialekt: "illustrator" }).svg;
        expect(illustrator).not.toMatch(/inkscape|sodipodi/u);
        expect(svg).toContain('inkscape:groupmode="layer"');
    });

    it("stempelt die Fassung und sagt wahr, ob geglättet ist", () => {
        const kopf = roh().svg.slice(0, 1200);
        expect(kopf).toContain('avm:kartenfassung="16"');
        expect(kopf).toContain('avm:landschaftsfassung="12"');
        expect(kopf).toContain(`avm:exportiert="${ERSTELLT}"`);
        expect(kopf).toContain('avm:importstand="2026-10-31T20:43:58Z"');
        expect(kopf).toContain('avm:geglaettet="nein"');
        expect(kopf).toContain('avm:flaechen_geglaettet="nein"');
        const glattKopf = glatt().svg.slice(0, 1200);
        expect(glattKopf).toContain('avm:geglaettet="ja"');
        expect(glattKopf).toContain('avm:flaechen_geglaettet="ja"');
        // Nur Wege geglättet: Die Wurzelattribute sind die Wahrheit je Linie und Fläche.
        const nurWege = baueKartenSvg(DATEN, { ...KARTEN_SVG_ROH, glattWege: true }, STEMPEL).svg.slice(0, 1200);
        expect(nurWege).toContain('avm:geglaettet="ja"');
        expect(nurWege).toContain('avm:flaechen_geglaettet="nein"');
    });

    it("ohne Semantik: keine avm:-Attribute, kein Namensraum, kein Vokabular, keine Stempel", () => {
        const svg = roh({ semantik: false }).svg;
        expect(svg).not.toContain("avm:");
        expect(svg).not.toContain("avm-vokabular");
        expect(pruefeWohlgeformt(svg)).toEqual([]);
        expect(svg).toContain('id="layer-orte"');
    });
});

// ---- Ebenen -------------------------------------------------------------------------------------------------------------

describe("Ebenen", () => {
    it("zeichnet die sechs Ebenen von unten nach oben, in der Ordnung des Vertrags", () => {
        const svg = roh().svg;
        const stellen = EBENEN_IDS.map((id) => svg.indexOf(`<g id="${id}"`));
        expect(stellen.every((stelle) => stelle > 0)).toBe(true);
        expect([...stellen].sort((a, b) => a - b)).toEqual(stellen);
        expect(EBENEN_IDS.map((id) => id.replace("layer-", ""))).toEqual([...KARTEN_SVG_EBENEN]);
        // Die Reihenfolge der Liste in den Einstellungen ändert die Zeichenreihenfolge nicht.
        expect(roh({ ebenen: [...KARTEN_SVG_EBENEN].reverse() }).svg).toBe(svg);
    });

    it("lässt eine abgewählte Ebene weg, samt allem, was nur zu ihr gehört", () => {
        for (const weg of KARTEN_SVG_EBENEN) {
            const ergebnis = roh({ ebenen: KARTEN_SVG_EBENEN.filter((ebeneName) => ebeneName !== weg) });
            expect(ergebnis.svg, weg).not.toContain(`<g id="layer-${weg}"`);
            expect(
                Object.keys(ergebnis.zaehler).filter((k) => !k.includes("/")),
                weg,
            ).not.toContain(weg);
            expect(pruefeWohlgeformt(ergebnis.svg), weg).toEqual([]);
        }
        expect(roh({ ebenen: [] }).svg).not.toContain("<g ");
        expect(pruefeWohlgeformt(roh({ ebenen: [] }).svg)).toEqual([]);
    });

    it("🔴 legt die Flüsse und den Bach UNTER die Wasserflächen und ÜBER den Wald, nicht in die Wege", () => {
        const svg = roh().svg;
        const landschaften = ebene(svg, "layer-landschaften");
        const fluss = landschaften.indexOf('id="wege-flussweg"');
        const bach = landschaften.indexOf('id="wege-bach"');
        expect(fluss).toBeGreaterThan(landschaften.indexOf('id="layer-landschaften-wald"'));
        expect(fluss).toBeLessThan(landschaften.indexOf('id="layer-landschaften-see"'));
        expect(fluss).toBeLessThan(landschaften.indexOf('id="layer-landschaften-meer"'));
        expect(bach).toBeGreaterThan(fluss);
        expect(bach).toBeLessThan(landschaften.indexOf('id="layer-landschaften-see"'));
        const wege = ebene(svg, "layer-wege");
        expect(wege).not.toContain('id="wege-flussweg"');
        expect(wege).not.toContain('id="wege-bach"');
        // Jeder Weg steht genau einmal in der Datei.
        expect((svg.match(/avm:id="w-fluss"/gu) ?? []).length).toBe(1);
        // Ohne Wege bleibt kein Fluss zurück; ohne Landschaften bleiben die Flüsse in den Wegen.
        const ohneLandschaften = roh({ ebenen: ["wege"] }).svg;
        expect(ohneLandschaften).toContain('id="wege-flussweg"');
        expect(roh({ ebenen: ["landschaften"] }).svg).not.toContain('avm:kind="weg"');
    });

    it("hängt die Flüsse ans Ende der Landschaften, wenn es gar kein Wasser gibt", () => {
        const ohneWasser: KartenSvgDaten = {
            ...DATEN,
            flaechen: DATEN.flaechen.filter((f) => f.typ !== "see" && f.typ !== "meer"),
        };
        const svg = baueKartenSvg(ohneWasser, KARTEN_SVG_ROH, STEMPEL).svg;
        const landschaften = ebene(svg, "layer-landschaften");
        expect(landschaften).toContain('id="wege-flussweg"');
        expect(pruefeWohlgeformt(svg)).toEqual([]);
    });

    it("ordnet die Wegarten wie die Karte: Wasser unten, die Reichsstraße oben", () => {
        const wege = ebene(roh().svg, "layer-wege");
        const stellen = ["wege-seeweg", "wege-pfad", "wege-reichsstrasse"].map((id) => wege.indexOf(`id="${id}"`));
        expect(stellen.every((s) => s > 0)).toBe(true);
        expect([...stellen].sort((a, b) => a - b)).toEqual(stellen);
    });

    it("baut Orte nach Klasse, Landmarken danach, und kennt eine unbekannte Ortsklasse", () => {
        const orte = ebene(roh().svg, "layer-orte");
        expect(orte.indexOf('id="orte-metropole"')).toBeLessThan(orte.indexOf('id="orte-dorf"'));
        expect(orte.indexOf('id="orte-dorf"')).toBeLessThan(orte.indexOf('id="orte-crossing"'));
        expect(orte.indexOf('id="orte-crossing"')).toBeLessThan(orte.indexOf('id="orte-landmarke-berggipfel"'));
        expect(orte.indexOf('id="orte-landmarke-berggipfel"')).toBeLessThan(
            orte.indexOf('id="orte-landmarke-wasserfall"'),
        );
    });

    it("🔴 führt Landmarken als avm:kind=landmarke in der Ortsebene, mit eigener Höhe und ohne Ausdehnung", () => {
        const svg = roh().svg;
        const landmarken = [...svg.matchAll(/<circle[^>]*avm:kind="landmarke"[^>]*>/gu)].map((t) => t[0]);
        expect(landmarken).toHaveLength(2);
        expect(landmarken.every((kreis) => !kreis.includes("avm:radius"))).toBe(true);
        expect(
            landmarken.some(
                (kreis) => kreis.includes('avm:type="berggipfel"') && kreis.includes('avm:eigene_hoehe="9000"'),
            ),
        ).toBe(true);
        expect(
            landmarken.some((kreis) => kreis.includes('avm:type="wasserfall"') && !kreis.includes("eigene_hoehe")),
        ).toBe(true);
        // Nur in der Ortsebene, nirgends sonst.
        expect(ebene(svg, "layer-orte")).toContain('avm:kind="landmarke"');
        for (const id of EBENEN_IDS.filter((i) => i !== "layer-orte"))
            expect(ebene(svg, id)).not.toContain('avm:kind="landmarke"');
        // Orte tragen ihre Ausdehnung, gerechnet aus Meilen: Metropole 5,5 Meilen Durchmesser = 0,9167 Einheiten Radius.
        expect(svg).toMatch(/avm:kind="ort"[^>]*avm:type="metropole"[^>]*avm:radius="0\.9167"/u);
        expect(svg).toMatch(/avm:type="dorf"[^>]*avm:radius="0\.0833"/u);
        expect(svg).toMatch(/avm:type="crossing"[^>]*avm:radius="0\.1"/u);
    });

    it("zählt die Elemente je Ebene und je Gruppe, die Flüsse bei den Wegen", () => {
        const { zaehler } = roh();
        expect(zaehler["landschaften"]).toBe(9);
        expect(zaehler["landschaften/wald"]).toBe(2);
        expect(zaehler["gebiete"]).toBe(2);
        expect(zaehler["wege"]).toBe(5);
        expect(zaehler["wege/Flussweg"]).toBe(1);
        expect(zaehler["wege/Bach"]).toBe(1);
        expect(zaehler["kraftlinien"]).toBe(1);
        expect(zaehler["orte"]).toBe(6);
        expect(zaehler["orte/Metropole"]).toBe(2);
        expect(zaehler["orte/Landmarke Wasserfall"]).toBe(1);
        // Orte mit Beschriftung (Gareth, Punin, Kreuzung; das Dorf hat sie abgeschaltet) + Wege mit Namen und Beschriftung (Reich, Fluss,
        // Seeweg; der Bach hat sie abgeschaltet, der Pfad keinen Namen) + ein freier Name und zwei Landmarken.
        expect(zaehler["beschriftungen/Orte"]).toBe(3);
        expect(zaehler["beschriftungen/Wege"]).toBe(3);
        expect(zaehler["beschriftungen/Gebiete"]).toBe(3);
        expect(zaehler["beschriftungen"]).toBe(9);
        expect(Object.keys(roh({ ebenen: ["orte"] }).zaehler).filter((k) => !k.includes("/"))).toEqual(["orte"]);
    });
});

// ---- Vokabular ----------------------------------------------------------------------------------------------------------

describe("Vokabular", () => {
    it("🔴 erklärt jede Vokabel, die die Datei benutzt (Typ, Art, Ebene, Klima, Relief, Attributnamen)", () => {
        for (const fassung of [roh, glatt]) {
            const svg = fassung().svg;
            const vokabular = liesVokabular(svg);
            for (const typ of werte(svg, "type")) expect(vokabular.typen[typ], `Typ ${typ}`).toBeDefined();
            for (const art of werte(svg, "kind")) expect(vokabular.arten[art], `Art ${art}`).toBeDefined();
            for (const stufe of werte(svg, "ebene")) expect(vokabular.ebenen[stufe], `Ebene ${stufe}`).toBeDefined();
            for (const wert of [...werte(svg, "klima"), ...werte(svg, "relief")]) {
                expect(vokabular.typen[wert], `Klima/Relief ${wert}`).toBeDefined();
            }
            const benutzt = new Set(
                [...svg.slice(svg.indexOf("</metadata>")).matchAll(/ avm:([a-z_]+)="/gu)].map((t) => t[1]),
            );
            for (const name of benutzt)
                expect(vokabular.felder[name ?? ""], `Attribut avm:${name ?? ""}`).toBeTypeOf("string");
        }
    });

    it("🔴 erklärt auch, wenn die Landschaften nicht in der Datei stehen (Klima und Relief stehen an Wegen und Orten)", () => {
        const svg = roh({ ebenen: ["wege", "orte"] }).svg;
        const vokabular = liesVokabular(svg);
        const kontexte = [...werte(svg, "klima"), ...werte(svg, "relief")];
        expect(kontexte.length).toBeGreaterThan(0);
        for (const wert of kontexte) expect(vokabular.typen[wert]?.de, wert).toBeTruthy();
        // Gezählt wird nur, was als Typ geschrieben ist; ein reiner Kontextwert hat Anzahl 0.
        expect(vokabular.typen["tropisch"]?.anzahl).toBe(0);
    });

    it("führt einen Typ ohne Beschreibung trotzdem, als unbeschrieben", () => {
        const { typen } = liesVokabular(roh().svg);
        expect(typen["neue_art"]).toEqual({ de: "neue_art", en: "", anzahl: 1, unbeschrieben: true });
        expect(typen["Fürstentum"]?.unbeschrieben).toBe(true);
        expect(typen["crossing"]?.unbeschrieben).toBe(true);
        expect(typen["wald"]).toEqual({ de: "Wald", en: "dense forest", anzahl: 2 });
        expect(typen["urwald"]?.en).toBe("primeval forest");
        expect(typen["wasserfall"]?.en).toBe("waterfall");
    });

    it("zählt die Typen aus dem, was wirklich geschrieben wurde", () => {
        const svg = roh().svg;
        const { typen } = liesVokabular(svg);
        for (const [typ, eintrag] of Object.entries(typen)) {
            const geschrieben = werte(svg, "type").filter((wert) => wert === typ).length;
            expect(eintrag.anzahl, typ).toBeLessThanOrEqual(geschrieben);
            if (eintrag.anzahl > 0) expect(eintrag.anzahl, typ).toBe(geschrieben);
        }
        // Der Bach ist eine ANZEIGE-Art: in den Daten ein Flussweg mit Merkmal, in der Datei ein eigener Typ.
        expect(typen["Bach"]?.anzahl).toBe(1);
        expect(typen["Flussweg"]?.anzahl).toBe(1);
    });

    it("sagt die Malreihenfolge zu und führt Klimabänder und Kombinationen nach Fläche sortiert", () => {
        const vokabular = liesVokabular(roh().svg);
        expect(vokabular.reihenfolge).toMatch(/Dokumentordnung/u);
        expect(vokabular.klimabaender).toEqual([{ typ: "tropisch", y_von: 724, y_bis: 1024 }]);
        const flaechen = vokabular.kombinationen.map((k) => k.flaeche);
        expect([...flaechen].sort((a, b) => b - a)).toEqual(flaechen);
        // Der Bergwald liegt im Gebirge (Gipfel 9000 m) in den Tropen; der Wald mit dem Loch in der Mitte hat kein Relief.
        expect(vokabular.kombinationen).toContainEqual({
            typ: "wald",
            relief: "gebirge",
            klima: "tropisch",
            gipfelhoehe: 9000,
            anzahl: 1,
            flaeche: 324,
        });
        expect(vokabular.kombinationen).toContainEqual({
            typ: "wald",
            relief: "",
            klima: "tropisch",
            gipfelhoehe: "",
            anzahl: 1,
            flaeche: 10000,
        });
    });

    it("gibt den Fakten Kontext: Klima, Relief und Höhe am Ort, ohne Deutung", () => {
        const svg = roh().svg;
        expect(svg).toMatch(/avm:id="a-bergwald"[^>]*avm:klima="tropisch" avm:relief="gebirge" avm:hoehe="9000"/u);
        // 💣 Löcher zählen: Die Mitte von „Salamandersteine“ liegt im Loch des Gebirges, also kein Relief und keine Höhe.
        const wald = /<path[^>]*avm:id="a-wald"[^>]*>/u.exec(svg)?.[0] ?? "";
        expect(wald).toContain('avm:klima="tropisch"');
        expect(wald).not.toContain("avm:relief");
        expect(wald).not.toContain("avm:hoehe");
        // Ein Ort im Norden, außerhalb der Tropen, hat kein Klima.
        expect(/<circle[^>]*avm:id="o-gareth"[^>]*>/u.exec(svg)?.[0]).not.toContain("avm:klima");
    });
});

// ---- Pfade --------------------------------------------------------------------------------------------------------------

describe("Pfadbefehle und Glättung", () => {
    it("🔴 roh: nur M, L und Z, absolut", () => {
        expect([...befehle(roh().svg)].sort()).toEqual(["L", "M", "Z"]);
    });

    it("🔴 glatt: nur M, L, C und Z, absolut, und es gibt Kurven", () => {
        const befehlssatz = [...befehle(glatt().svg)].sort();
        expect(befehlssatz).toEqual(["C", "L", "M", "Z"]);
        // L bleibt, wo es nichts zu runden gibt: Gebiete und die Kraftlinie.
        expect(ebene(glatt().svg, "layer-landschaften")).toContain("C");
    });

    it("🔴 Herrschaftsgebiete bleiben auch in der geglätteten Fassung eckig", () => {
        for (const spannung of [0, 0.5, 1]) {
            const gebiete = ebene(glatt({ spannung }).svg, "layer-gebiete");
            expect(gebiete).toContain(' d="M');
            expect(gebiete).not.toMatch(/ d="[^"]*C/u);
        }
        expect(ebene(roh().svg, "layer-gebiete")).toBe(ebene(glatt().svg, "layer-gebiete"));
    });

    it("glättet Wege und Flächen unabhängig voneinander, die Kraftlinien nie", () => {
        const nurWege = baueKartenSvg(DATEN, { ...KARTEN_SVG_ROH, glattWege: true }, STEMPEL).svg;
        expect(pfadVon(nurWege, "w-reich")).toContain("C");
        expect(pfadVon(nurWege, "w-fluss")).toContain("C");
        expect(pfadVon(nurWege, "a-wald")).not.toContain("C");
        const nurFlaechen = baueKartenSvg(DATEN, { ...KARTEN_SVG_ROH, glattFlaechen: true }, STEMPEL).svg;
        expect(pfadVon(nurFlaechen, "a-wald")).toContain("C");
        expect(pfadVon(nurFlaechen, "w-reich")).not.toContain("C");
        expect(pfadVon(nurFlaechen, "w-fluss")).not.toContain("C");
        // Die Kraftlinie ist schon eine abgetastete Kurve der Karte und wird nie noch einmal gerundet.
        expect(pfadVon(glatt().svg, "k-nord")).not.toContain("C");
    });

    it("spiegelt y: Der Südrand der Karte steht unten", () => {
        const svg = roh().svg;
        // Gareth (551,625 / 532,969) liegt bei x = 551,63 und y = 1024 − 532,969 = 491,03.
        expect(svg).toMatch(/avm:id="o-gareth"[^>]*cx="551\.63" cy="491\.03"/u);
        // Das Klimaband y 0…300 (Süden) steht im unteren Drittel des Zeichenraums.
        expect(svg).toContain('d="M0 1024L1024 1024L1024 724L0 724L0 1024Z"');
    });

    it("schreibt ein Loch als zweiten Teilpfad derselben Fläche, mit evenodd an der Gruppe", () => {
        const svg = roh().svg;
        const gebirge = /<path[^>]*avm:id="a-gebirge"[^>]* d="([^"]*)"/u.exec(svg)?.[1] ?? "";
        expect((gebirge.match(/M/gu) ?? []).length).toBe(2);
        expect((gebirge.match(/Z/gu) ?? []).length).toBe(2);
        expect(svg).toMatch(/id="layer-landschaften-gebirge"[^>]*fill-rule="evenodd"/u);
    });
});

// ---- Namen und ids ------------------------------------------------------------------------------------------------------

describe("Namen, Maskierung und ids", () => {
    it("🔴 maskiert Namen in Attributen und Textinhalten und wirft Zeichen weg, die XML nicht kennt", () => {
        const svg = roh().svg;
        expect(svg).toContain("Fels &amp; &lt;Fluss&gt; &quot;Zwei&quot; 'drei'");
        expect(svg).not.toContain("Fels & <");
        // Zeilenwechsel im Namen wird ein Zeichenverweis, das Steuerzeichen fällt weg.
        expect(svg).toContain("Zeile&#10;eins");
        expect(svg).not.toContain("\u0001");
        expect(pruefeWohlgeformt(svg)).toEqual([]);
        // Auch im Vokabular, das ein JSON in einem Textknoten ist.
        expect(liesVokabular(svg).typen["wald"]).toBeDefined();
    });

    it("vergibt jede id genau einmal, mit und ohne Passmarken, in beiden Dialekten", () => {
        for (const dialekt of ["inkscape", "illustrator"] as const) {
            for (const passmarken of [false, true]) {
                const svg = roh({ dialekt, passmarken }).svg;
                const ids = [...svg.matchAll(/ id="([^"]*)"/gu)].map((t) => t[1]);
                expect(new Set(ids).size, `${dialekt} ${String(passmarken)}`).toBe(ids.length);
            }
        }
    });

    it("hält die ids gleichnamiger Dinge auseinander, die Wegbeschriftung zeigt auf eine vorhandene Linie", () => {
        const doppelt: KartenSvgDaten = {
            ...DATEN,
            landmarken: [],
            orte: [
                { kennung: "o1", name: "Gareth", art: "dorf", x: 10, y: 10, beschriftung: true },
                { kennung: "o2", name: "Gareth", art: "dorf", x: 20, y: 20, beschriftung: true },
            ],
        };
        for (const dialekt of ["inkscape", "illustrator"] as const) {
            const svg = baueKartenSvg(doppelt, { ...KARTEN_SVG_ROH, dialekt }, STEMPEL).svg;
            const ids = [...svg.matchAll(/<circle id="([^"]*)"/gu)].map((t) => t[1]);
            expect(ids).toHaveLength(2);
            expect(new Set(ids).size).toBe(2);
        }
        const svg = roh().svg;
        for (const t of svg.matchAll(/<textPath href="#([^"]*)"/gu)) {
            expect(svg, `Verweis auf ${t[1] ?? ""}`).toContain(` id="${t[1] ?? ""}"`);
        }
        // Namenlose und abgeschaltete Wege bekommen keine Wegbeschriftung; der Bach hat sie abgeschaltet.
        expect((svg.match(/<textPath /gu) ?? []).length).toBe(3);
        expect(ebene(svg, "layer-beschriftungen")).not.toContain("Mühlbach");
    });

    it("lässt Orte ohne Beschriftung ohne Beschriftung, den Kreis behält er", () => {
        const svg = roh().svg;
        expect(ebene(svg, "layer-beschriftungen")).not.toMatch(/<text[^>]*>Fels &amp; Fluss<\/text>/u);
        expect(svg).toMatch(/<circle[^>]*avm:id="o-dorf"/u);
    });
});

// ---- Passmarken, Striche, Bytes -----------------------------------------------------------------------------------------

describe("Passmarken, Strichstärke und Bytegleichheit", () => {
    it("setzt in JEDE Ebene vier deckende Passmarken, innen und mit eigenen ids", () => {
        const svg = roh({ passmarken: true }).svg;
        for (const id of EBENEN_IDS) {
            const teil = ebene(svg, id);
            expect(teil, id).toContain(`id="${id}-passmarken"`);
            for (const nummer of [1, 2, 3, 4]) expect(teil, id).toContain(`id="${id}-passmarke-${String(nummer)}"`);
            expect((teil.match(/<rect /gu) ?? []).length, id).toBe(4);
            // Die Passmarken stehen INNEN: Nach ihnen kommt nur noch das Schließen der Ebene.
            expect(
                teil
                    .replace(/<\/svg>\s*$/u, "")
                    .trimEnd()
                    .endsWith("</g>\n</g>"),
                id,
            ).toBe(true);
        }
        expect(svg).toContain('fill="#ff00ff"');
        // Kante = ein Bildpunkt bei 32768: vier Quadrate in den vier Ecken der Leinwand.
        expect(svg).toContain('<rect id="layer-orte-passmarke-1" x="0" y="0" width="0.03125" height="0.03125"/>');
        expect(svg).toContain(
            '<rect id="layer-orte-passmarke-4" x="1023.96875" y="1023.96875" width="0.03125" height="0.03125"/>',
        );
        expect(roh().svg).not.toContain("passmarke");
    });

    it("rechnet die Strichstärken aus dem Regler, ohne Fließkommarauschen, der Bach als halber Fluss", () => {
        const normal = roh().svg;
        expect(normal).toMatch(/avm:type="Flussweg"[^>]*avm:breite="0\.094" avm:mantel_breite="0\.156"/u);
        expect(normal).toMatch(/avm:type="Bach"[^>]*avm:breite="0\.047" avm:mantel_breite="0\.078"/u);
        expect(normal).toMatch(/avm:type="Reichsstrasse"[^>]*avm:breite="0\.125" avm:mantel_breite="0\.203"/u);
        expect(normal).toContain('stroke-width="0.094"');
        const doppelt = roh({ strichProzent: 200 }).svg;
        expect(doppelt).toMatch(/avm:type="Flussweg"[^>]*avm:breite="0\.188"/u);
        expect(doppelt).toContain('stroke-width="0.188"');
        const hundertzehn = roh({ strichProzent: 110 }).svg;
        expect(hundertzehn).toMatch(/avm:type="Reichsstrasse"[^>]*avm:breite="0\.1375"/u);
        // Außerhalb des Bereichs wird geklemmt: nie Strich 0 oder negativ.
        expect(roh({ strichProzent: -50 }).svg).toMatch(/avm:type="Reichsstrasse"[^>]*avm:breite="0\.0063"/u);
    });

    it("🔴 liefert bei gleichen Eingaben dieselben Bytes, und die Zeit ist der einzige Unterschied", () => {
        expect(roh().svg).toBe(roh().svg);
        expect(glatt().svg).toBe(glatt().svg);
        const anders = baueKartenSvg(DATEN, KARTEN_SVG_ROH, { erstellt: "2027-01-01T00:00:00.000Z" }).svg;
        expect(anders).not.toBe(roh().svg);
        expect(anders.replace("2027-01-01T00:00:00.000Z", ERSTELLT)).toBe(roh().svg);
        // Eine Kopie der Daten ergibt dasselbe, auch bei umgekehrter Reihenfolge der Schlüssel in den Optionen.
        const kopie = JSON.parse(JSON.stringify(DATEN)) as KartenSvgDaten;
        expect(baueKartenSvg(kopie, { ...KARTEN_SVG_ROH }, STEMPEL).svg).toBe(roh().svg);
        // Die Eingaben bleiben unverändert (ein Bau sortiert nichts in ihnen um).
        expect(JSON.stringify(DATEN)).toBe(JSON.stringify(kopie));
    });

    it("hat zwei feste Fassungen, die sich in genau der Glättung unterscheiden", () => {
        const { glattWege, glattFlaechen, ...restGlatt } = KARTEN_SVG_GLATT;
        const { glattWege: rohWege, glattFlaechen: rohFlaechen, ...restRoh } = KARTEN_SVG_ROH;
        expect([glattWege, glattFlaechen, rohWege, rohFlaechen]).toEqual([true, true, false, false]);
        expect(restGlatt).toEqual(restRoh);
        expect(KARTEN_SVG_ROH).toMatchObject({
            dialekt: "inkscape",
            groessePx: 32768,
            semantik: true,
            passmarken: false,
            strichProzent: 100,
            spannung: 0.5,
        });
        expect(KARTEN_SVG_ROH.ebenen).toEqual(KARTEN_SVG_EBENEN);
    });

    it("lässt die Spannung wirken: 0 legt die Kurve auf den Polygonzug zurück", () => {
        const gerade = glatt({ spannung: 0 }).svg;
        const gewoelbt = glatt({ spannung: 1 }).svg;
        expect(gerade).not.toBe(gewoelbt);
        expect(gerade).toMatch(/avm:id="w-reich"[^>]* d="M100 924C100 924 300 774 300 774/u);
    });
});
