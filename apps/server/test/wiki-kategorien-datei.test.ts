import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waehleDump } from "../src/wiki/dump/datei.ts";
import {
    entmaskiere,
    istKategorienDateiname,
    leseKategorienZeilen,
    pruefeKategorienDatei,
    waehleKategorienDatei,
    type KategorienZeile,
} from "../src/wiki/kategorien/datei.ts";
import { baueKategorienSql, neuerOrdner, schreibeKategorienDatei } from "./support/wiki-dump-fixture.ts";

/**
 * Die Datei `dump_categorylinks.sql.gz` lesen (WI-0294 Aufgabe 1). Alles an erfundenen Zeilen im Aufbau des echten Auszugs, kein Abruf.
 *
 * - **Soll:** Zeilen mit Seitennummer, Kategorie, Art und Sortierschlüssel; der Stand aus der Endzeile; die jüngste Datei im Ordner.
 * - **Problemfälle:** maskierte Zeichen (`\'`, Gegenschrägstrich, Zeilenwechsel im Sortierschlüssel), mehrere Tupel in einer Zeile, eine abgeschnittene Datei (ohne Endzeile, abgeschnittenes
 *   Gzip, leere Datei), ein anderer Aufbau der Tabelle, eine kaputte Zeile, eine falsche Datei im Ordner.
 */

let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
beforeAll(async () => {
    ordner = await neuerOrdner("kategorien-datei");
});
afterAll(async () => {
    await ordner.weg();
});

async function lies(pfad: string): Promise<KategorienZeile[]> {
    const zeilen: KategorienZeile[] = [];
    for await (const zeile of leseKategorienZeilen(pfad)) zeilen.push(zeile);
    return zeilen;
}

describe("Zeilen lesen", () => {
    it("liest Seitennummer, Kategorie, Art und Sortierschlüssel; Maskierungen sind aufgelöst", async () => {
        const pfad = join(ordner.pfad, "maskiert.sql.gz");
        await schreibeKategorienDatei(
            pfad,
            baueKategorienSql([
                { von: 10, nach: "Metropole_(Siedlungsgröße)" },
                {
                    von: 11,
                    nach: "Chronikereignis_1021_BF",
                    sortierschluessel: "1021 BF/BOR-HES ROTER DIFAR IN AL'ANFA",
                },
                {
                    von: 12,
                    nach: "Zauberei_und_Hexenwerk",
                    sortierschluessel: "ZAUBEREI UND HEXENWERK\nZAUBEREI & HEXENWERK/ERRATA",
                },
                { von: 13, nach: "Kategorie_mit\\Gegenschraegstrich", art: "subcat" },
                { von: 14, nach: "Al'Anfa", art: "file" },
                { von: 15, nach: "Straße_der_Großen_Äpfel" },
            ]),
        );
        const zeilen = await lies(pfad);
        expect(zeilen).toEqual([
            {
                von: 10,
                nach: "Metropole_(Siedlungsgröße)",
                art: "page",
                sortierschluessel: "METROPOLE (SIEDLUNGSGRÖSSE)",
            },
            {
                von: 11,
                nach: "Chronikereignis_1021_BF",
                art: "page",
                sortierschluessel: "1021 BF/BOR-HES ROTER DIFAR IN AL'ANFA",
            },
            {
                von: 12,
                nach: "Zauberei_und_Hexenwerk",
                art: "page",
                sortierschluessel: "ZAUBEREI UND HEXENWERK\nZAUBEREI & HEXENWERK/ERRATA",
            },
            {
                von: 13,
                nach: "Kategorie_mit\\Gegenschraegstrich",
                art: "subcat",
                sortierschluessel: "KATEGORIE MIT\\GEGENSCHRAEGSTRICH",
            },
            { von: 14, nach: "Al'Anfa", art: "file", sortierschluessel: "AL'ANFA" },
            { von: 15, nach: "Straße_der_Großen_Äpfel", art: "page", sortierschluessel: "STRASSE DER GROSSEN ÄPFEL" },
        ]);
    });

    it("liest mehrere Tupel in einer Zeile, auch hinter VALUES", async () => {
        const pfad = join(ordner.pfad, "eine-zeile.sql.gz");
        await schreibeKategorienDatei(
            pfad,
            baueKategorienSql(
                [
                    { von: 1, nach: "Dorf" },
                    { von: 2, nach: "Kleinstadt" },
                    { von: 3, nach: "Großstadt" },
                ],
                { eineZeile: true },
            ),
        );
        expect((await lies(pfad)).map((zeile) => [zeile.von, zeile.nach])).toEqual([
            [1, "Dorf"],
            [2, "Kleinstadt"],
            [3, "Großstadt"],
        ]);
    });

    it("löst die Maskierungen von MySQL auf", () => {
        expect(entmaskiere("Al\\'Anfa")).toBe("Al'Anfa");
        expect(entmaskiere("a\\\\b")).toBe("a\\b");
        expect(entmaskiere("x\\ny\\rz\\0")).toBe("x\ny\rz\0");
        expect(entmaskiere("ohne")).toBe("ohne");
    });
});

describe("Prüfung der Datei", () => {
    it("meldet Stand aus der Endzeile (UTC), Zeilenzahl und Prüfsumme der gepackten Datei", async () => {
        const pfad = join(ordner.pfad, "heil.sql.gz");
        await schreibeKategorienDatei(
            pfad,
            baueKategorienSql(
                [
                    { von: 1, nach: "Dorf" },
                    { von: 2, nach: "Dorf" },
                ],
                { stand: "2026-11-09  4:13:37" },
            ),
        );
        const kopf = await pruefeKategorienDatei(pfad);
        expect(kopf).toMatchObject({
            datei: "heil.sql.gz",
            vollstaendig: true,
            stand: "2026-11-09T04:13:37Z",
            zeilen: 2,
        });
        expect(kopf.sha256).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("meldet eine Datei ohne Endzeile als unvollständig, ohne Zeilen weiterzugeben", async () => {
        const pfad = join(ordner.pfad, "ohne-ende.sql.gz");
        await schreibeKategorienDatei(pfad, baueKategorienSql([{ von: 1, nach: "Dorf" }], { ohneEnde: true }));
        expect(await pruefeKategorienDatei(pfad)).toMatchObject({ vollstaendig: false, stand: null });
        await expect(lies(pfad)).rejects.toMatchObject({ code: "kategorien_unvollstaendig" });
    });

    it("meldet ein abgeschnittenes Gzip, eine leere und eine nicht gepackte Datei als unvollständig", async () => {
        const abgeschnitten = join(ordner.pfad, "abgeschnitten.sql.gz");
        const grosse = Array.from({ length: 4_000 }, (_, index) => ({
            von: index + 1,
            nach: `Kategorie_${String(index)}`,
        }));
        await schreibeKategorienDatei(abgeschnitten, baueKategorienSql(grosse), { abschneiden: 40 });
        expect(await pruefeKategorienDatei(abgeschnitten)).toMatchObject({ vollstaendig: false });
        await expect(lies(abgeschnitten)).rejects.toMatchObject({ code: "kategorien_unvollstaendig" });

        const leer = join(ordner.pfad, "leer.sql.gz");
        await writeFile(leer, "");
        expect(await pruefeKategorienDatei(leer)).toMatchObject({ vollstaendig: false });

        const xml = join(ordner.pfad, "keine-sql.sql.gz");
        await writeFile(xml, "<mediawiki></mediawiki>");
        expect(await pruefeKategorienDatei(xml)).toMatchObject({ vollstaendig: false });
    });

    it("hält an, wenn die Tabelle andere Spalten hat", async () => {
        const pfad = join(ordner.pfad, "anderes-schema.sql.gz");
        await schreibeKategorienDatei(pfad, baueKategorienSql([{ von: 1, nach: "Dorf" }], { spaltenOhneType: true }));
        await expect(pruefeKategorienDatei(pfad)).rejects.toMatchObject({ code: "kategorien_schema_unbekannt" });
    });

    it("hält an, wenn eine Zeile kein Eintrag der Tabelle ist", async () => {
        const pfad = join(ordner.pfad, "kaputt.sql.gz");
        const sql = baueKategorienSql([
            { von: 1, nach: "Dorf" },
            { von: 2, nach: "Kleinstadt" },
        ]).replace("(2,", "(zwei,");
        await writeFile(pfad, gzipSync(Buffer.from(sql, "utf8")));
        await expect(lies(pfad)).rejects.toMatchObject({ code: "kategorien_zeile_unlesbar" });
    });

    it("eine Datei ohne eine einzige Zeile der Tabelle ist unbrauchbar", async () => {
        const pfad = join(ordner.pfad, "ohne-zeilen.sql.gz");
        await schreibeKategorienDatei(pfad, baueKategorienSql([]));
        expect(await pruefeKategorienDatei(pfad)).toMatchObject({ vollstaendig: false, zeilen: 0 });
    });
});

describe("Auswahl im Dump-Ordner", () => {
    it("wählt die jüngste Kategorien-Datei, lehnt Pfade ab und nimmt nie eine XML-Datei", async () => {
        const wurzel = join(ordner.pfad, "wurzel");
        await mkdir(wurzel);
        await expect(waehleKategorienDatei(wurzel, undefined)).rejects.toMatchObject({
            code: "kategorien_datei_fehlt",
        });
        await writeFile(join(wurzel, "dump_categorylinks-2026-11-01.sql.gz"), "x");
        await writeFile(join(wurzel, "dump_categorylinks-2026-11-09.sql.gz"), "x");
        await writeFile(join(wurzel, "dewa_dump_small-2026-11-09.xml.bz2"), "x");
        await writeFile(join(wurzel, "notiz.txt"), "x");
        await utimes(
            join(wurzel, "dump_categorylinks-2026-11-01.sql.gz"),
            new Date("2026-11-01"),
            new Date("2026-11-01"),
        );
        await utimes(
            join(wurzel, "dump_categorylinks-2026-11-09.sql.gz"),
            new Date("2026-11-09"),
            new Date("2026-11-09"),
        );
        await utimes(
            join(wurzel, "dewa_dump_small-2026-11-09.xml.bz2"),
            new Date("2026-11-10"),
            new Date("2026-11-10"),
        );
        expect(await waehleKategorienDatei(wurzel, undefined)).toBe(
            join(wurzel, "dump_categorylinks-2026-11-09.sql.gz"),
        );
        expect(await waehleKategorienDatei(wurzel, "dump_categorylinks-2026-11-01.sql.gz")).toBe(
            join(wurzel, "dump_categorylinks-2026-11-01.sql.gz"),
        );
        await expect(
            waehleKategorienDatei(wurzel, "../wurzel/dump_categorylinks-2026-11-01.sql.gz"),
        ).rejects.toMatchObject({
            code: "datei_ungueltig",
        });
        await expect(waehleKategorienDatei(wurzel, "dewa_dump_small-2026-11-09.xml.bz2")).rejects.toMatchObject({
            code: "datei_ungueltig",
        });
        await expect(waehleKategorienDatei(wurzel, "dump_categorylinks-fehlt.sql.gz")).rejects.toMatchObject({
            code: "kategorien_datei_fehlt",
        });
        await expect(waehleKategorienDatei(undefined, undefined)).rejects.toMatchObject({ code: "dump_root_fehlt" });
        // Der XML-Dump nimmt die SQL-Datei nie: Er wählt die XML-Datei, auch wenn die SQL-Datei jünger ist.
        expect(await waehleDump(wurzel, undefined)).toBe(join(wurzel, "dewa_dump_small-2026-11-09.xml.bz2"));
        await utimes(
            join(wurzel, "dewa_dump_small-2026-11-09.xml.bz2"),
            new Date("2026-01-01"),
            new Date("2026-01-01"),
        );
        expect(await waehleDump(wurzel, undefined)).toBe(join(wurzel, "dewa_dump_small-2026-11-09.xml.bz2"));
        await expect(waehleDump(wurzel, "dump_categorylinks-2026-11-09.sql.gz")).rejects.toMatchObject({
            code: "datei_ungueltig",
        });
    });

    it("erkennt nur reine Dateinamen der Form dump_categorylinks….sql.gz", () => {
        expect(istKategorienDateiname("dump_categorylinks.sql.gz")).toBe(true);
        expect(istKategorienDateiname("dump_categorylinks-20261109T041337Z.sql.gz")).toBe(true);
        expect(istKategorienDateiname("dump_categorylinks.sql.gz.part")).toBe(false);
        expect(istKategorienDateiname("dump_categorylinks.sql")).toBe(false);
        expect(istKategorienDateiname("../dump_categorylinks.sql.gz")).toBe(false);
        expect(istKategorienDateiname("dump_pagelinks.sql.gz")).toBe(false);
        expect(istKategorienDateiname(".dump_categorylinks.sql.gz")).toBe(false);
    });
});
