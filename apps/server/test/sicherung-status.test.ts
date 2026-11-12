import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUFTRAG_DATEI, entferneAuftrag, leseAuftrag, schreibeAuftrag } from "../src/system/sicherung.ts";
import { UEBERFAELLIG_MS, backupZustand, createBackupStatusReader } from "../src/system/status-files.ts";

/**
 * Die Sicherung ohne Datenbank (WI-0127 SYS-9, SYS-0001 §3.6, §6.5, §9e): Claudios Statusdatei aus Fixture-Dateien in allen sechs Zuständen,
 * die Leseregeln (fehlt heißt „nicht eingerichtet“, kaputt heißt „unbekannt“ mit EINER Warnung, fremde und höhere Formate, 30 s
 * Zwischenspeicher) und die Auftragsdatei (genau zwei Felder, atomar, nur die eigene wird zurückgenommen).
 */

const FIXTURES = resolve(import.meta.dirname, "fixtures/sicherung");
const fixture = (name: string): string => join(FIXTURES, `${name}.json`);
const VOR_DEM_NAECHSTEN = new Date("2026-10-10T15:00:00Z");

const temps: string[] = [];
async function temp(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "sicherung-"));
    temps.push(dir);
    return dir;
}
afterEach(async () => {
    while (temps.length > 0) await rm(temps.pop()!, { recursive: true, force: true });
});

async function zustand(file: string | undefined, now: Date = VOR_DEM_NAECHSTEN): Promise<string> {
    const gelesen = await createBackupStatusReader(file).read();
    if (gelesen.art === "fehlt") return "nicht_eingerichtet";
    if (gelesen.art === "unlesbar") return "unbekannt";
    return backupZustand(gelesen.stand, now);
}

describe("Statusdatei der Sicherung: sechs Zustände aus Fixture-Dateien (§6.5)", () => {
    it("🔴 nicht eingerichtet ohne Variable und ohne Datei, kein Fehler", async () => {
        expect(await zustand(undefined)).toBe("nicht_eingerichtet");
        expect(await zustand("")).toBe("nicht_eingerichtet");
        expect(await zustand(fixture("gibt-es-nicht"))).toBe("nicht_eingerichtet");
    });

    it("🔴 aktuell, läuft, fehlgeschlagen, überfällig, unbekannt", async () => {
        expect(await zustand(fixture("aktuell"))).toBe("aktuell");
        expect(await zustand(fixture("laeuft"))).toBe("laeuft");
        expect(await zustand(fixture("fehlgeschlagen"))).toBe("fehlgeschlagen");
        // `next_run_at` 2026-10-11T01:30Z: bis 2 h danach aktuell, danach überfällig.
        const naechster = Date.parse("2026-10-11T01:30:00Z");
        expect(await zustand(fixture("aktuell"), new Date(naechster + UEBERFAELLIG_MS))).toBe("aktuell");
        expect(await zustand(fixture("aktuell"), new Date(naechster + UEBERFAELLIG_MS + 1))).toBe("ueberfaellig");
        // Ein gescheiterter Lauf bleibt gescheitert, auch wenn der nächste überfällig ist.
        expect(await zustand(fixture("fehlgeschlagen"), new Date(naechster + 3 * UEBERFAELLIG_MS))).toBe(
            "fehlgeschlagen",
        );
        expect(await zustand(fixture("fremd"))).toBe("unbekannt");
        const dir = await temp();
        await writeFile(join(dir, "status.json"), '{"schema_version": 1, "updated_at": ');
        expect(await zustand(join(dir, "status.json"))).toBe("unbekannt");
    });

    it("das Lesemodell aus der Datei: Felder, gekürzte Prüfsumme, jüngste Prüfung außer Haus, die letzte Antwort", async () => {
        const gelesen = await createBackupStatusReader(fixture("aktuell")).read();
        expect(gelesen.art).toBe("gelesen");
        if (gelesen.art !== "gelesen") return;
        expect(gelesen.stand).toMatchObject({
            stand: "2026-10-10T03:33:12Z",
            letzterLauf: { result: "ok", trigger: "timer", operationId: null, errorCode: null },
            letzteErfolgreiche: "2026-10-10T03:33:12Z",
            ausserHaus: { eingerichtet: true, geprueftAm: "2026-10-10T03:33:11Z" },
            probelauf: { at: "2026-10-10T11:05:00Z", result: "ok" },
            naechsterLauf: "2026-10-11T01:30:00Z",
            aufbewahrung: { local: 3, daily: 7, weekly: 4, monthly: 6 },
            neueresFormat: false,
            letzteAnfrage: { result: "zu_frueh" },
        });
        expect(gelesen.stand.teile.map((teil) => [teil.kind, teil.bytes, teil.sha256, teil.offsite])).toEqual([
            ["db", 48213504, "9f2c4be01d77", "dropbox"],
            ["roles", 4096, "1a2b3c4d5e6f", "dropbox"],
            ["config", 1832960, "c0ffee00c0ff", null],
        ]);
        // Kein Freitext aus der Datei geht weiter (der Text des Probelaufs bleibt auf dem Server).
        expect(JSON.stringify(gelesen.stand)).not.toContain("Personen");
    });

    it("„Sicherung jetzt“: läuft mit der eigenen operation_id, Antwort „angenommen“", async () => {
        const gelesen = await createBackupStatusReader(fixture("laeuft")).read();
        if (gelesen.art !== "gelesen") throw new Error(gelesen.art);
        expect(gelesen.stand.letzterLauf).toMatchObject({
            result: "running",
            trigger: "manual",
            operationId: "8b0e2f4c-6a1d-4e3b-9c5f-7d8a9b0c1d2e",
        });
        expect(gelesen.stand.letzteAnfrage).toEqual({
            operationId: "8b0e2f4c-6a1d-4e3b-9c5f-7d8a9b0c1d2e",
            at: "2026-10-10T14:05:02Z",
            result: "angenommen",
        });
    });

    it("tolerant: höhere schema_version wird gemeldet, falsche Werte heißen null statt 0, Unbekanntes fällt weg", async () => {
        const gelesen = await createBackupStatusReader(fixture("neuer")).read();
        if (gelesen.art !== "gelesen") throw new Error(gelesen.art);
        expect(gelesen.stand.neueresFormat).toBe(true);
        expect(gelesen.stand.teile).toEqual([
            { kind: "db", bytes: null, sha256: null, encrypted: true, offsite: "dropbox", offsiteVerifiedAt: null },
        ]);
        expect(gelesen.stand.ausserHaus).toEqual({ eingerichtet: null, geprueftAm: null });
        expect(gelesen.stand.aufbewahrung).toBeNull();
        expect(gelesen.stand.probelauf).toBeNull();
        expect(gelesen.stand.letzteAnfrage).toEqual({ operationId: "x", at: "2026-10-10T14:02:00Z", result: null });
        expect(backupZustand(gelesen.stand, VOR_DEM_NAECHSTEN)).toBe("aktuell");
    });

    it("30 s Zwischenspeicher je Instanz; eine kaputte Datei warnt einmal, nicht je Anfrage", async () => {
        const dir = await temp();
        const file = join(dir, "status.json");
        await writeFile(file, await readFile(fixture("aktuell"), "utf8"));
        let jetzt = 0;
        const warnungen: string[] = [];
        const reader = createBackupStatusReader(file, { clock: () => jetzt, warn: (line) => warnungen.push(line) });
        expect((await reader.read()).art).toBe("gelesen");
        await writeFile(file, "kaputt");
        jetzt = 29_999;
        expect((await reader.read()).art).toBe("gelesen");
        jetzt = 30_000;
        expect((await reader.read()).art).toBe("unlesbar");
        jetzt = 60_000;
        expect((await reader.read()).art).toBe("unlesbar");
        expect(warnungen).toEqual(["Statusdatei der Sicherung hat keine lesbare Form"]);
    });
});

describe("Auftragsdatei für „Sicherung jetzt“ (§9e)", () => {
    it("🔴 genau zwei Felder, atomar, das Verzeichnis entsteht bei Bedarf; keine Reste", async () => {
        const dir = join(await temp(), "shared", "requests");
        await schreibeAuftrag(dir, "8b0e2f4c-6a1d-4e3b-9c5f-7d8a9b0c1d2e", new Date("2026-10-10T14:05:00Z"));
        expect(await readdir(dir)).toEqual([AUFTRAG_DATEI]);
        expect(JSON.parse(await readFile(join(dir, AUFTRAG_DATEI), "utf8"))).toEqual({
            operation_id: "8b0e2f4c-6a1d-4e3b-9c5f-7d8a9b0c1d2e",
            requested_at: "2026-10-10T14:05:00.000Z",
        });
        expect(await leseAuftrag(dir)).toEqual({
            operationId: "8b0e2f4c-6a1d-4e3b-9c5f-7d8a9b0c1d2e",
            requestedAt: "2026-10-10T14:05:00.000Z",
        });
    });

    it("ohne Auftrag null; zurückgenommen wird nur der eigene", async () => {
        const dir = await temp();
        expect(await leseAuftrag(dir)).toBeNull();
        await schreibeAuftrag(dir, "eigen", new Date());
        await entferneAuftrag(dir, "fremd");
        expect((await leseAuftrag(dir))?.operationId).toBe("eigen");
        await entferneAuftrag(dir, "eigen");
        expect(await leseAuftrag(dir)).toBeNull();
    });

    it("scheitert das Schreiben (das Verzeichnis ist eine Datei), wirft es und lässt nichts liegen", async () => {
        const base = await temp();
        await writeFile(join(base, "datei"), "x");
        await expect(schreibeAuftrag(join(base, "datei", "requests"), "x", new Date())).rejects.toThrow();
        expect(await readdir(base)).toEqual(["datei"]);
    });
});
