import { createHash } from "node:crypto";
import { mkdir, readFile, truncate, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { wikiNamespaceTafel } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { istDumpDateiname, waehleDump } from "../src/wiki/dump/datei.ts";
import { leseDump, type DumpTeil } from "../src/wiki/dump/leser.ts";
import { erzeugeManifest, standAusDateiname } from "../src/wiki/dump/manifest.ts";
import { sammleSeiten } from "../src/wiki/dump/seiten-sammler.ts";
import { DumpFehler, eigeneKopie, entschluessele, leseKopf, leseSeite } from "../src/wiki/dump/xml.ts";
import { baueDump, findeBzip2, neuerOrdner, packeBz2, type FixtureSeite } from "./support/wiki-dump-fixture.ts";

/**
 * Der Dump-Leser des WikiSync (WI-0253 B-1): Seiten im Strom, Kopf, Manifest. Alles an erfundenen Seiten, kein Abruf.
 *
 * - **Soll:** Titel, Namensraum, Weiterleitungsziel, Revision und Text je Seite; Manifest mit Prüfsumme und Zählung je Namensraum.
 * - **Problemfälle:** ein abgeschnittener Dump, eine Datei, die kein Export ist, Zeichen über Puffergrenzen, `bzip2` fehlt oder meldet einen
 *   Fehler.
 * - `.xml.bz2` nur, wenn `bzip2` auf diesem Rechner da ist; sonst ist der Fall übersprungen (sichtbar als „skipped“).
 */

const SEITEN: FixtureSeite[] = [
    { titel: "Gareth", ns: 0, text: "'''Gareth''' liegt am [[Großer Fluss]] & mehr <b>." },
    { titel: "Reichsstadt Gareth", ns: 0, weiterleitung: "Gareth" },
    { titel: "Inoffiziell:Apfeldorn", ns: 222, text: "Ein Dorf", zeit: "2026-10-01T08:30:00Z" },
    { titel: "DSK:Die Schwarze Katze", ns: 218, text: "x" },
    { titel: "Kategorie:Orte", ns: 14, text: "" },
    { titel: "Kategorie:Städte", ns: 14, text: "" },
];

let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
let xml: string;
const bzip2 = findeBzip2();

beforeAll(async () => {
    ordner = await neuerOrdner("wiki-dump-test");
    xml = join(ordner.pfad, "dewa_dump_small_20261001.xml");
    await writeFile(xml, baueDump(SEITEN));
});
afterAll(async () => {
    await ordner.weg();
});

async function alles(
    pfad: string,
    mitText = true,
    programm: string | undefined = bzip2 ?? undefined,
): Promise<DumpTeil[]> {
    const teile: DumpTeil[] = [];
    for await (const teil of leseDump(pfad, { mitText, bzip2: programm })) teile.push(teil);
    return teile;
}

describe("Dump: eine Seite lesen (rein)", () => {
    it("Entitäten und Zeichenverweise, unbekannte bleiben stehen", () => {
        expect(entschluessele("a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos; &#228;&#x4e2d; &unbekannt;")).toBe(
            "a <b> & \"c\" 'd' ä中 &unbekannt;",
        );
    });

    it("Titel, Namensraum, Kennung, Weiterleitung und die LETZTE Revision; ohne Text bleibt der Text leer", () => {
        const block = `
    <title>A &amp; B</title><ns>0</ns><id>12</id>
    <redirect title="Ziel &quot;X&quot;" />
    <revision><id>1</id><timestamp>2026-01-01T00:00:00Z</timestamp><text>alt</text></revision>
    <revision><id>2</id><timestamp>2026-02-02T00:00:00Z</timestamp><text xml:space="preserve">neu &lt;i&gt;</text></revision>`;
        expect(leseSeite(block, true)).toEqual({
            titel: "A & B",
            ns: 0,
            id: 12,
            weiterleitung: 'Ziel "X"',
            revision: { id: 2, zeit: "2026-02-02T00:00:00Z" },
            text: "neu <i>",
        });
        expect(leseSeite(block, false).text).toBe("");
    });

    it("gelöschter Text (`<text deleted=… />`) ist leer; `<title2>` ist nicht `<title>`", () => {
        const seite = leseSeite(
            '<title2>falsch</title2><title>Echt</title><ns>0</ns><revision><id>3</id><text deleted="deleted" /></revision>',
            true,
        );
        expect(seite).toMatchObject({ titel: "Echt", text: "", revision: { id: 3, zeit: null } });
    });

    it("🔴 eine Seite ohne Titel oder Namensraum macht den Export unglaubwürdig: laut, kein Raten von ns 0", () => {
        for (const kaputt of ["<ns>0</ns>", "<title>X</title>", "<title></title><ns>0</ns>"]) {
            expect(() => leseSeite(kaputt, false)).toThrow(DumpFehler);
        }
    });

    it("eine eigene Kopie hat denselben Inhalt, kurz wie lang (der Speicher ist in der Messung belegt, nicht hier)", () => {
        for (const wert of ["", "Ab", "Kahler Schirch (Gipfel) – Höhe 中", "x".repeat(5000)]) {
            expect(eigeneKopie(`<title>${wert}</title>`.slice(7, 7 + wert.length))).toBe(wert);
        }
    });

    it('der Kopf nennt Wiki und Namensräume (`""` im Hauptraum)', () => {
        const kopf = leseKopf(
            '<siteinfo><sitename>W</sitename><generator>MW 1</generator><namespaces><namespace key="0" case="first-letter" /><namespace key="222" case="first-letter">Inoffiziell</namespace></namespaces></siteinfo>',
        );
        expect(kopf).toMatchObject({ sitename: "W", generator: "MW 1", dbname: null });
        expect(kopf.namensraeume).toEqual({ 0: "", 222: "Inoffiziell" });
    });
});

describe("Dump: der Strom über eine Datei", () => {
    it("liest Kopf, alle Seiten in Dateireihenfolge und das Ende als vollständig", async () => {
        const teile = await alles(xml);
        expect(teile[0]).toMatchObject({ art: "kopf", kopf: { sitename: "Testwiki", namensraeume: { 218: "DSK" } } });
        const seiten = teile.flatMap((teil) => (teil.art === "seite" ? [teil.seite] : []));
        expect(seiten.map((seite) => [seite.titel, seite.ns])).toEqual(SEITEN.map((seite) => [seite.titel, seite.ns]));
        expect(seiten[0]?.text).toBe("'''Gareth''' liegt am [[Großer Fluss]] & mehr <b>.");
        expect(seiten[1]).toMatchObject({ weiterleitung: "Gareth", revision: { id: 5001 } });
        expect(teile.at(-1)).toEqual({ art: "ende", vollstaendig: true });
    });

    it("🔴 Zeichen über Puffergrenzen: Seiten über 64 KB mit Umlauten werden unversehrt gelesen", async () => {
        const gross = [
            { titel: "Groß A", ns: 0, text: "ä".repeat(100_000) },
            { titel: "Groß B", ns: 0, text: `x${"ü€".repeat(50_000)}` },
            { titel: "Klein", ns: 0, text: "ok" },
        ];
        const pfad = join(ordner.pfad, "gross.xml");
        await writeFile(pfad, baueDump(gross));
        const seiten = (await alles(pfad)).flatMap((teil) => (teil.art === "seite" ? [teil.seite] : []));
        expect(seiten.map((seite) => seite.text.length)).toEqual([100_000, 100_001, 2]);
        expect(seiten[1]?.text.startsWith("xü€ü€")).toBe(true);
    });

    it("🔴 ein abgeschnittener Dump endet nicht als „vollständig“", async () => {
        const pfad = join(ordner.pfad, "abgeschnitten.xml");
        await writeFile(pfad, baueDump(SEITEN, { abgeschnitten: true }));
        const teile = await alles(pfad);
        expect(teile.at(-1)).toEqual({ art: "ende", vollstaendig: false });
        // Die angefangene letzte Seite wird nicht geliefert.
        expect(teile.filter((teil) => teil.art === "seite")).toHaveLength(SEITEN.length - 1);
    });

    it("eine Datei, die kein Export ist, wird abgewiesen", async () => {
        const pfad = join(ordner.pfad, "nichts.xml");
        await writeFile(pfad, "Dies ist kein Export. ".repeat(500));
        await expect(alles(pfad)).rejects.toMatchObject({ code: "kein_dump" });
        const leer = join(ordner.pfad, "leer.xml");
        await writeFile(leer, "");
        await expect(alles(leer)).rejects.toMatchObject({ code: "kein_dump" });
    });

    it("nie der ganze Dump im Speicher: 20.000 Seiten laufen im Strom durch", async () => {
        const viele: FixtureSeite[] = Array.from({ length: 20_000 }, (_, index) => ({
            titel: `Seite ${String(index)}`,
            ns: index % 50 === 0 ? 222 : 0,
            text: "Text ".repeat(20),
        }));
        const pfad = join(ordner.pfad, "viele.xml");
        await writeFile(pfad, baueDump(viele));
        let gezaehlt = 0;
        let letzte = "";
        for await (const teil of leseDump(pfad, { mitText: false })) {
            if (teil.art === "seite") {
                gezaehlt += 1;
                letzte = teil.seite.titel;
            }
        }
        expect(gezaehlt).toBe(20_000);
        expect(letzte).toBe("Seite 19999");
    });
});

describe("Dump: .xml.bz2 über das Programm bzip2", () => {
    it.skipIf(bzip2 === null)("liest dieselben Seiten wie die entpackte Datei", async () => {
        const bz = join(ordner.pfad, "dewa_dump_small_20261001.xml.bz2");
        await packeBz2(bzip2 as string, xml, bz);
        expect(await alles(bz)).toEqual(await alles(xml));
    });

    it.skipIf(bzip2 === null)(
        "🔴 eine beschädigte .bz2 endet mit einem Fehler von bzip2, nicht als kleiner Dump",
        async () => {
            const bz = join(ordner.pfad, "kaputt.xml.bz2");
            await packeBz2(bzip2 as string, xml, bz);
            await truncate(bz, 120);
            await expect(alles(bz)).rejects.toMatchObject({ name: "DumpFehler" });
        },
    );

    it("🔴 fehlt `bzip2`, sagt die Meldung es klar und nennt die Einstellung", async () => {
        const bz = join(ordner.pfad, "ohne-programm.xml.bz2");
        await writeFile(bz, "BZh9");
        const fehler = await alles(bz, true, join(ordner.pfad, "es-gibt-kein-bzip2")).catch((e: unknown) => e);
        expect(fehler).toMatchObject({ name: "DumpFehler", code: "bzip2_fehlt" });
        expect((fehler as Error).message).toContain("WIKI_BZIP2_PFAD");
    });
});

describe("Dump: Manifest", () => {
    it("Datei, Größe, SHA-256 (gegen die eigene Rechnung), Stand aus dem Dateinamen, Zählung je Namensraum", async () => {
        const manifest = await erzeugeManifest(xml, { bzip2: bzip2 ?? undefined });
        const bytes = await readFile(xml);
        expect(manifest).toMatchObject({
            datei: "dewa_dump_small_20261001.xml",
            groesse: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            stand: { wert: "2026-10-01", quelle: "dateiname" },
            vollstaendig: true,
            seiten: 6,
            weiterleitungen: 1,
            neuesteRevision: "2026-10-01T08:30:00Z",
            wiki: { sitename: "Testwiki", dbname: "testwiki" },
        });
        expect(manifest.namensraeume.map((raum) => [raum.nr, raum.name, raum.seiten, raum.weiterleitungen])).toEqual([
            [0, "", 2, 1],
            [14, "Kategorie", 2, 0],
            [218, "DSK", 1, 0],
            [222, "Inoffiziell", 1, 0],
        ]);
    });

    it("🔴 Kanon und Kartenobjekte sind zwei Fragen; ein Raum außerhalb der Vorgabe ist KEIN Inhalt (kanon null, nicht inoffiziell)", async () => {
        const manifest = await erzeugeManifest(xml, { bzip2: bzip2 ?? undefined });
        const raum = (nr: number) => manifest.namensraeume.find((eintrag) => eintrag.nr === nr);
        expect(raum(0)).toMatchObject({ inTafel: true, kanon: "offiziell", traegtKartenobjekte: true });
        expect(raum(218)).toMatchObject({ inTafel: true, kanon: "offiziell", traegtKartenobjekte: false });
        expect(raum(222)).toMatchObject({ inTafel: true, kanon: "inoffiziell", traegtKartenobjekte: true });
        expect(raum(14)).toMatchObject({ inTafel: false, kanon: null, traegtKartenobjekte: false });
    });

    it("ohne Datum im Namen gilt die jüngste Revision; ohne beides ist der Stand unbekannt (nicht heute)", async () => {
        const pfad = join(ordner.pfad, "ohne-datum.xml");
        await writeFile(pfad, baueDump(SEITEN));
        expect((await erzeugeManifest(pfad)).stand).toEqual({
            wert: "2026-10-01T08:30:00Z",
            quelle: "neueste-revision",
        });
        const leer = join(ordner.pfad, "ohne-seiten.xml");
        await writeFile(leer, baueDump([]));
        expect((await erzeugeManifest(leer)).stand).toEqual({ wert: null, quelle: null });
        expect(standAusDateiname("dump-2026_10_01.xml.bz2")).toBe("2026-10-01");
        expect(standAusDateiname("dewa_dump_small.xml.bz2")).toBeNull();
        expect(standAusDateiname("zahl-123456789012.xml")).toBeNull();
    });

    it("ein abgeschnittener Dump trägt `vollstaendig: false` im Manifest", async () => {
        const pfad = join(ordner.pfad, "abgeschnitten.xml");
        await writeFile(pfad, baueDump(SEITEN, { abgeschnitten: true }));
        expect((await erzeugeManifest(pfad)).vollstaendig).toBe(false);
    });
});

describe("Dump: welche Datei gemeint ist", () => {
    it("nur reine Dateinamen mit Dumpendung, nie ein Pfad", () => {
        for (const gut of ["dewa_dump_small.xml.bz2", "dump.XML", "a.xml"])
            expect(istDumpDateiname(gut), gut).toBe(true);
        for (const schlecht of [
            "",
            "../x.xml",
            "a/b.xml",
            "a\\b.xml",
            ".versteckt.xml",
            "dump.zip",
            " dump.xml",
            "dump.xml.bz2.part",
        ]) {
            expect(istDumpDateiname(schlecht), schlecht).toBe(false);
        }
    });

    it("ohne Namen die jüngste Datei; mit Namen genau diese; kein Ordner, keine Datei: klare Fehler", async () => {
        const wurzel = join(ordner.pfad, "wurzel");
        await mkdir(wurzel);
        await expect(waehleDump(wurzel, undefined)).rejects.toMatchObject({ code: "dump_fehlt" });
        await writeFile(join(wurzel, "alt.xml"), "x");
        await writeFile(join(wurzel, "neu.xml.bz2"), "x");
        await writeFile(join(wurzel, "notiz.txt"), "x");
        await utimes(join(wurzel, "alt.xml"), new Date("2026-01-01"), new Date("2026-01-01"));
        await utimes(join(wurzel, "neu.xml.bz2"), new Date("2026-06-01"), new Date("2026-06-01"));
        expect(await waehleDump(wurzel, undefined)).toBe(join(wurzel, "neu.xml.bz2"));
        expect(await waehleDump(wurzel, "alt.xml")).toBe(join(wurzel, "alt.xml"));
        await expect(waehleDump(wurzel, "../wurzel/alt.xml")).rejects.toMatchObject({ code: "datei_ungueltig" });
        await expect(waehleDump(wurzel, "gibt-es-nicht.xml")).rejects.toMatchObject({ code: "dump_fehlt" });
        await expect(waehleDump(undefined, undefined)).rejects.toMatchObject({ code: "dump_root_fehlt" });
        await expect(waehleDump(join(ordner.pfad, "fehlt"), undefined)).rejects.toMatchObject({ code: "dump_fehlt" });
    });
});

describe("Dump: Seitennummern für die Kategorien-Datei (WI-0294)", () => {
    const seiten: FixtureSeite[] = [
        { titel: "Gareth", ns: 0, id: 101, text: "Text" },
        { titel: "Reichsstadt Gareth", ns: 0, id: 112, weiterleitung: "Gareth" },
        { titel: "Inoffiziell:Apfeldorn", ns: 222, id: 111, text: "Ein Dorf" },
        { titel: "Kategorie:Festung", ns: 14, id: 9003, text: "" },
        { titel: "Kategorie:Hafen", ns: 14, id: 9002, text: "" },
        { titel: "Unbeteiligt", ns: 0, id: 500, text: "x" },
    ];

    it("liefert Titel zu den verlangten Nummern (auch Namensraum 14) und Seiten zu den gesuchten Titeln, sonst nichts", async () => {
        const pfad = join(ordner.pfad, "kategorien-nummern.xml");
        await writeFile(pfad, baueDump(seiten));
        const gelesen = await sammleSeiten(
            pfad,
            new Set(["Gareth", "Reichsstadt Gareth", "Inoffiziell:Apfeldorn", "Gibt es nicht"]),
            wikiNamespaceTafel(),
            { kategorien: { ids: new Set([9003, 9002, 424_242]) } },
        );
        expect(gelesen.kategorien).toBeDefined();
        expect([...(gelesen.kategorien?.titelJeId ?? [])].sort()).toEqual([
            [9002, "Kategorie:Hafen"],
            [9003, "Kategorie:Festung"],
        ]);
        // 🔴 Die Seitennummer ist die der Seite (`<id>` vor der Revision), nie die der Revision (5000 und mehr).
        expect([...(gelesen.kategorien?.seiteJeTitel ?? [])].sort()).toEqual([
            ["Gareth", { id: 101, ns: 0, weiterleitung: false }],
            ["Inoffiziell:Apfeldorn", { id: 111, ns: 222, weiterleitung: false }],
            ["Reichsstadt Gareth", { id: 112, ns: 0, weiterleitung: true }],
        ]);
        // Der Durchgang liest wie sonst: die Seiten sind gezählt, die gesuchten Artikel gefunden.
        expect(gelesen.seiten).toBe(6);
        expect(gelesen.gefunden.get("Gareth")?.[0]?.ns).toBe(0);
    });

    it("ohne die Option bleibt das Ergebnis, wie es war (kein Feld, kein Verzeichnis aller Titel)", async () => {
        const pfad = join(ordner.pfad, "kategorien-ohne-option.xml");
        await writeFile(pfad, baueDump(seiten));
        const gelesen = await sammleSeiten(pfad, new Set(["Gareth"]), wikiNamespaceTafel());
        expect(gelesen.kategorien).toBeUndefined();
    });
});
