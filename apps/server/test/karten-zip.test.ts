import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planeZip, zipStrom, type ZipEintrag } from "../src/karten-export/zip.ts";

/**
 * Das ZIP der Karten (WI-0280), ohne Server: Ein eigener kleiner Leser nimmt die Bytes auseinander, wie es ein Entpacker tut, über das zentrale Verzeichnis vom Ende her. Einmal von
 * Hand gegen `tar` und Pythons `zipfile` geprüft, siehe WI-0280 §6; hier steht, was jede Änderung halten muss.
 */

const ZEIT = new Date("2026-09-23T09:17:10.000Z");

async function bytes(strom: AsyncIterable<unknown>): Promise<Buffer> {
    const teile: Buffer[] = [];
    for await (const teil of strom) teile.push(teil as Buffer);
    return Buffer.concat(teile);
}

interface Gelesen {
    name: string;
    methode: number;
    crc: number;
    groesse: number;
    versatz: number;
    daten: Buffer;
}

function leseZip(zip: Buffer): Gelesen[] {
    const ende = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(ende).toBe(zip.length - 22);
    const anzahl = zip.readUInt16LE(ende + 10);
    let stelle = zip.readUInt32LE(ende + 16);
    const aus: Gelesen[] = [];
    for (let i = 0; i < anzahl; i += 1) {
        expect(zip.readUInt32LE(stelle)).toBe(0x02014b50);
        const namenLaenge = zip.readUInt16LE(stelle + 28);
        const extra = zip.readUInt16LE(stelle + 30);
        const versatz = zip.readUInt32LE(stelle + 42);
        const name = zip.subarray(stelle + 46, stelle + 46 + namenLaenge).toString("utf8");
        const groesse = zip.readUInt32LE(stelle + 24);
        expect(zip.readUInt32LE(versatz)).toBe(0x04034b50);
        const start = versatz + 30 + zip.readUInt16LE(versatz + 26) + zip.readUInt16LE(versatz + 28);
        aus.push({
            name,
            methode: zip.readUInt16LE(stelle + 10),
            crc: zip.readUInt32LE(stelle + 16),
            groesse,
            versatz,
            daten: zip.subarray(start, start + groesse),
        });
        stelle += 46 + namenLaenge + extra;
    }
    return aus;
}

describe("das ZIP der Karten", () => {
    let ordner: string;
    let eintraege: ZipEintrag[];
    const inhalt = Buffer.from("PNG-Ersatz ".repeat(50_000));
    const text = Buffer.from("Lizenz mit Ümläut\r\n", "utf8");

    beforeAll(async () => {
        ordner = await mkdtemp(join(tmpdir(), "karten-zip-"));
        await writeFile(join(ordner, "karte.png"), inhalt);
        eintraege = [
            {
                name: "avesmaps-modern-32768px.png",
                bytes: inhalt.length,
                crc32: crc32(inhalt),
                zeit: ZEIT,
                inhalt: { art: "datei", pfad: join(ordner, "karte.png") },
            },
            {
                name: "LIZENZ.txt",
                bytes: text.length,
                crc32: crc32(text),
                zeit: ZEIT,
                inhalt: { art: "puffer", daten: text },
            },
        ];
    });

    afterAll(() => rm(ordner, { recursive: true, force: true }));

    it("liefert unverändert lesbare Dateien mit stimmender Prüfsumme, ohne Packen", async () => {
        const plan = planeZip(eintraege);
        const zip = await bytes(zipStrom(plan, 0, plan.bytes - 1));
        expect(zip.length).toBe(plan.bytes);
        const gelesen = leseZip(zip);
        expect(gelesen.map((g) => g.name)).toEqual(["avesmaps-modern-32768px.png", "LIZENZ.txt"]);
        expect(gelesen.every((g) => g.methode === 0)).toBe(true);
        expect(gelesen[0]!.daten.equals(inhalt)).toBe(true);
        expect(gelesen[1]!.daten.equals(text)).toBe(true);
        for (const g of gelesen) expect(crc32(g.daten)).toBe(g.crc);
    });

    it("trägt die Zeit der Datei als DOS-Zeit und UTF-8-Namen", async () => {
        const plan = planeZip(eintraege);
        const zip = await bytes(zipStrom(plan, 0, plan.bytes - 1));
        expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
        const datum = zip.readUInt16LE(12);
        expect(datum >> 9).toBe(2026 - 1980);
        expect((datum >> 5) & 0xf).toBe(9);
        expect(datum & 0x1f).toBe(23);
    });

    it("setzt einen Abbruch an jeder Stelle byte-genau fort", async () => {
        const plan = planeZip(eintraege);
        const ganz = await bytes(zipStrom(plan, 0, plan.bytes - 1));
        for (const schnitt of [1, 29, 30, 100, 300_000, plan.bytes - 30, plan.bytes - 1]) {
            const vorn = await bytes(zipStrom(plan, 0, schnitt - 1));
            const hinten = await bytes(zipStrom(plan, schnitt, plan.bytes - 1));
            expect(Buffer.concat([vorn, hinten]).equals(ganz)).toBe(true);
        }
    });

    it("zählt, was geliefert wurde", async () => {
        const plan = planeZip(eintraege);
        let summe = 0;
        await bytes(zipStrom(plan, 10, plan.bytes - 1, (n) => (summe += n)));
        expect(summe).toBe(plan.bytes - 10);
    });

    it("dieselben Dateien ergeben dieselbe Prüfsumme, eine andere Datei eine andere", () => {
        expect(planeZip(eintraege).sha256).toBe(planeZip(eintraege).sha256);
        const anders = [{ ...eintraege[0]!, crc32: 1 }, eintraege[1]!];
        expect(planeZip(anders).sha256).not.toBe(planeZip(eintraege).sha256);
    });

    it("nimmt ZIP64 erst ab 4 GiB und rechnet die Größe richtig", () => {
        const klein = planeZip(eintraege);
        const viel = 6 * 1024 ** 3;
        const gross = planeZip([
            { name: "a.png", bytes: viel, crc32: 7, zeit: ZEIT, inhalt: { art: "datei", pfad: "gibt-es-nicht" } },
            { name: "b.png", bytes: 5, crc32: 8, zeit: ZEIT, inhalt: { art: "puffer", daten: Buffer.alloc(5) } },
        ]);
        expect(klein.bytes).toBeLessThan(2 ** 32);
        expect(gross.bytes).toBeGreaterThan(viel);
        const puffer = gross.stuecke.filter((s) => s.art === "puffer");
        const schluss = puffer.at(-1)!;
        if (schluss.art !== "puffer") throw new Error("kein Puffer");
        // Satz und Zeiger von ZIP64 stehen vor dem gewöhnlichen Schluss.
        expect(schluss.daten.readUInt32LE(0)).toBe(0x06064b50);
        expect(schluss.daten.readUInt32LE(56)).toBe(0x07064b50);
        expect(schluss.daten.readUInt32LE(76)).toBe(0x06054b50);
        expect(Number(schluss.daten.readBigUInt64LE(48))).toBe(
            schluss.start - (schluss.daten.length === 98 ? Number(schluss.daten.readBigUInt64LE(40)) : 0),
        );
    });
});
