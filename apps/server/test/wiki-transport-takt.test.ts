import { spawn } from "node:child_process";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeTaktOrt } from "../src/wiki/transport/ort.ts";
import { erzeugeSchutz } from "../src/wiki/transport/schutz.ts";
import { erzeugeTakt } from "../src/wiki/transport/takt.ts";
import { neuerOrdner } from "./support/wiki-dump-fixture.ts";

/**
 * Der Takt und der Schutz der Wiki-Anfragen (WI-0253 B-1, B1-Vertrag): mindestens 20 s plus Jitter zwischen zwei Anfragen, über Prozessgrenzen,
 * geschlossen bei kaputtem Vermerk. Die Tests laufen mit 120 ms statt 20 s; die Logik ist dieselbe, nur die Zahl ist kleiner.
 *
 * - **Soll:** aufeinanderfolgende Plätze, auch bei zwei Aufträgen zugleich und in mehreren Prozessen; der nicht wartende Zweig weist ab, ohne
 *   zu reservieren.
 * - **Problemfälle:** Vermerk fehlt, ist kaputt oder liegt absurd weit vorn; Ordner nicht nutzbar; Sperre hängt; 403, 429 und Fehlerketten
 *   pausieren für alle.
 * - Kein Aufruf an das Wiki: Hier gibt es keinen Client, nur Takt und Schutz.
 */

const ABSTAND = 120;
let wurzel: Awaited<ReturnType<typeof neuerOrdner>>;
let zaehler = 0;

beforeAll(async () => {
    wurzel = await neuerOrdner("wiki-takt-test");
});
afterAll(async () => {
    await wurzel.weg();
});

/** Ein frischer Ordner je Test. */
async function frischerOrdner(): Promise<string> {
    zaehler += 1;
    const pfad = join(wurzel.pfad, `t${String(zaehler)}`);
    await mkdir(pfad, { recursive: true });
    return pfad;
}

function takte(
    verzeichnis: string | undefined,
    extra: { jetzt?: () => number; sperreWartetMs?: number; sperreVeraltetMs?: number } = {},
) {
    const ort = erzeugeTaktOrt({ verzeichnis, ...extra });
    return { ort, takt: erzeugeTakt(ort, { abstandMs: ABSTAND, jitterMaxMs: 0 }) };
}

describe("Takt: der Abstand", () => {
    it("🔴 ohne Vermerk wartet schon die erste Anfrage einen vollen Abstand (sichere Richtung), jede weitere im Abstand dahinter", async () => {
        const ordner = await frischerOrdner();
        const { takt } = takte(ordner);
        const start = Date.now();
        const erster = await takt.nimm();
        expect(erster.vermerk).toBe("fehlt");
        expect(Date.now() - start).toBeGreaterThanOrEqual(ABSTAND - 15);
        const zweiter = await takt.nimm();
        const dritter = await takt.nimm();
        expect(zweiter.vermerk).toBe("gueltig");
        expect(zweiter.platzMs - erster.platzMs).toBeGreaterThanOrEqual(ABSTAND);
        expect(dritter.platzMs - zweiter.platzMs).toBeGreaterThanOrEqual(ABSTAND);
        // Der Vermerk hält den zuletzt vergebenen Platz.
        expect(Number((await readFile(join(ordner, "letzte-anfrage"), "utf8")).trim())).toBe(dritter.platzMs);
    });

    it("der Jitter kommt auf den Abstand, nie davon ab", async () => {
        const ordner = await frischerOrdner();
        const ort = erzeugeTaktOrt({ verzeichnis: ordner });
        const takt = erzeugeTakt(ort, { abstandMs: 100, jitterMaxMs: 50, zufall: () => 0.999 });
        const a = await takt.nimm();
        const b = await takt.nimm();
        expect(b.platzMs - a.platzMs).toBeGreaterThanOrEqual(100);
        expect(b.platzMs - a.platzMs).toBeLessThanOrEqual(151);
    });

    it("🔴 zwei Aufträge zugleich: aufeinanderfolgende Plätze, und keiner hält den anderen auf der Sperre fest", async () => {
        const ordner = await frischerOrdner();
        // Zwei getrennte Orte auf demselben Ordner: wie zwei Worker in zwei Umgebungen.
        const a = takte(ordner).takt;
        const b = takte(ordner).takt;
        const start = Date.now();
        const plaetze = await Promise.all([a.nimm(), b.nimm(), a.nimm(), b.nimm()]);
        const sortiert = plaetze.map((platz) => platz.platzMs).sort((x, y) => x - y);
        for (let index = 1; index < sortiert.length; index += 1) {
            expect((sortiert[index] ?? 0) - (sortiert[index - 1] ?? 0)).toBeGreaterThanOrEqual(ABSTAND);
        }
        // Vier Plätze im Abstand brauchen vier Abstände, nicht mehr: Wer wartet, schläft ohne Sperre.
        expect(Date.now() - start).toBeLessThan(4 * ABSTAND + 1500);
    });

    it("🔴 über Prozessgrenzen: drei Prozesse mit je drei Plätzen halten den Abstand untereinander", async () => {
        const ordner = await frischerOrdner();
        const skript = fileURLToPath(new URL("./support/wiki-takt-kind.ts", import.meta.url));
        const lauf = (): Promise<{ platzMs: number; aufgewachtMs: number }[]> =>
            new Promise((fertig, fehler) => {
                const kind = spawn(process.execPath, [skript, ordner, String(ABSTAND), "3"], {
                    stdio: ["ignore", "pipe", "pipe"],
                    windowsHide: true,
                });
                let aus = "";
                let err = "";
                kind.stdout.on("data", (stueck: Buffer) => (aus += stueck.toString("utf8")));
                kind.stderr.on("data", (stueck: Buffer) => (err += stueck.toString("utf8")));
                kind.once("close", (code) => {
                    if (code !== 0) fehler(new Error(`Kindprozess endete mit ${String(code)}: ${err.slice(0, 400)}`));
                    else fertig(JSON.parse(aus) as { platzMs: number; aufgewachtMs: number }[]);
                });
            });
        const ergebnisse = (await Promise.all([lauf(), lauf(), lauf()])).flat();
        expect(ergebnisse).toHaveLength(9);
        const plaetze = ergebnisse.map((eintrag) => eintrag.platzMs).sort((x, y) => x - y);
        for (let index = 1; index < plaetze.length; index += 1) {
            expect((plaetze[index] ?? 0) - (plaetze[index - 1] ?? 0), `Platz ${String(index)}`).toBeGreaterThanOrEqual(
                ABSTAND,
            );
        }
        // Aufgewacht ist keiner vor seinem Platz (eine Timer-Ungenauigkeit von wenigen Millisekunden abgerechnet).
        for (const eintrag of ergebnisse) expect(eintrag.aufgewachtMs).toBeGreaterThanOrEqual(eintrag.platzMs - 5);
    }, 30_000);
});

describe("Takt: geschlossen statt ungedrosselt", () => {
    it("🔴 ein kaputter Vermerk gilt als „eben war eine Anfrage“, nie als null, und wird dabei geheilt", async () => {
        for (const kaputt of ["", "abc", "17.5", "-5", "12", "99999999999999999999"]) {
            const ordner = await frischerOrdner();
            await writeFile(join(ordner, "letzte-anfrage"), kaputt);
            const { takt } = takte(ordner);
            const urteil = await takt.versuche();
            expect(urteil, JSON.stringify(kaputt)).toMatchObject({ frei: false, vermerk: "kaputt" });
            expect(Number((await readFile(join(ordner, "letzte-anfrage"), "utf8")).trim()), kaputt).toBeGreaterThan(
                1_700_000_000_000,
            );
            const platz = await takt.nimm();
            expect(platz.wartetMs, kaputt).toBeGreaterThan(0);
        }
    });

    it("ein Platz absurd weit in der Zukunft (verstellte Uhr, Handarbeit) ist kaputt, nicht Warteschlange", async () => {
        const ordner = await frischerOrdner();
        await writeFile(join(ordner, "letzte-anfrage"), String(Date.now() + ABSTAND * 500));
        const { takt } = takte(ordner);
        const platz = await takt.nimm();
        expect(platz.vermerk).toBe("zu_weit_vorn");
        expect(platz.wartetMs).toBeLessThanOrEqual(ABSTAND);
    });

    it("🔴 kein Ordner eingerichtet, oder nicht anlegbar: nichts geht hinaus (takt_nicht_nutzbar)", async () => {
        const { takt } = takte(undefined);
        await expect(takt.nimm()).rejects.toMatchObject({ code: "takt_nicht_nutzbar" });
        await expect(takt.versuche()).rejects.toMatchObject({ code: "takt_nicht_nutzbar" });
        // Ein Ordner „unter“ einer Datei lässt sich nicht anlegen.
        const datei = join(wurzel.pfad, "ist-eine-datei");
        await writeFile(datei, "x");
        await expect(takte(join(datei, "unter")).takt.nimm()).rejects.toMatchObject({ code: "takt_nicht_nutzbar" });
    });

    it("🔴 hängt die Sperre, scheitert die Anfrage geschlossen (takt_sperre), statt ohne sie zu laufen", async () => {
        const ordner = await frischerOrdner();
        await writeFile(join(ordner, "takt.lock"), "fremd");
        const { takt } = takte(ordner, { sperreWartetMs: 150 });
        await expect(takt.nimm()).rejects.toMatchObject({ code: "takt_sperre", wiederholbar: true });
    });

    it("eine liegengebliebene Sperre (abgestürzter Prozess) wird nach ihrer Frist weggeräumt", async () => {
        const ordner = await frischerOrdner();
        const sperre = join(ordner, "takt.lock");
        await writeFile(sperre, "alt");
        await utimes(sperre, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
        const { takt } = takte(ordner, { sperreVeraltetMs: 1000 });
        await expect(takt.versuche()).resolves.toMatchObject({ frei: false });
    });
});

describe("Takt: der nicht wartende Zweig („Platz frei?“)", () => {
    it("🔴 weist ab, wenn der Platz belegt ist, und reserviert dabei NICHTS", async () => {
        const ordner = await frischerOrdner();
        const vermerk = join(ordner, "letzte-anfrage");
        const { takt } = takte(ordner);
        // Die letzte Anfrage liegt lange zurück: frei, und der Platz ist jetzt genommen.
        await writeFile(vermerk, String(Date.now() - 10 * ABSTAND));
        const erster = await takt.versuche();
        expect(erster.frei).toBe(true);
        const nachErstem = await readFile(vermerk, "utf8");
        // Der zweite Aufruf unmittelbar danach: belegt, mit Restzeit, und der Vermerk bleibt BYTEGLEICH.
        const zweiter = await takt.versuche();
        expect(zweiter).toMatchObject({ frei: false, vermerk: "gueltig" });
        expect((zweiter as { freiInMs: number }).freiInMs).toBeGreaterThan(0);
        expect((zweiter as { freiInMs: number }).freiInMs).toBeLessThanOrEqual(ABSTAND);
        for (let nummer = 0; nummer < 5; nummer += 1) await takt.versuche();
        expect(await readFile(vermerk, "utf8")).toBe(nachErstem);
        // Nach dem Abstand ist er wieder frei: viele Abweisungen haben den Takt nicht nach hinten geschoben.
        await new Promise((fertig) => setTimeout(fertig, ABSTAND + 20));
        expect((await takt.versuche()).frei).toBe(true);
    });

    it("`freiInMs` liest nur: ohne Vermerk eine volle Wartezeit, ohne etwas anzulegen", async () => {
        const ordner = await frischerOrdner();
        const { takt } = takte(ordner);
        expect(await takt.freiInMs()).toBeGreaterThan(ABSTAND - 10);
        await expect(readFile(join(ordner, "letzte-anfrage"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    });
});

describe("Schutz: Pause und Unterbrecher für alle Prozesse", () => {
    function schutzMit(ordner: string, uhr: { jetzt: number }) {
        const ort = erzeugeTaktOrt({ verzeichnis: ordner, jetzt: () => uhr.jetzt });
        return erzeugeSchutz(ort, {
            pause403Ms: 60_000,
            pause429MinMs: 5_000,
            unterbrecherSchwelle: 3,
            unterbrecherPauseMs: 10_000,
        });
    }

    it("🔴 403: eine lange Pause, die ein anderer Prozess auch sieht; nach ihrem Ende geht es wieder", async () => {
        const ordner = await frischerOrdner();
        const uhr = { jetzt: 1_800_000_000_000 };
        const a = schutzMit(ordner, uhr);
        const b = schutzMit(ordner, uhr);
        await a.meldeFehler("gesperrt");
        await expect(b.pruefeFrei()).rejects.toMatchObject({
            code: "pausiert",
            bis: uhr.jetzt + 60_000,
            wiederholbar: true,
        });
        uhr.jetzt += 59_999;
        await expect(b.pruefeFrei()).rejects.toMatchObject({ code: "pausiert" });
        uhr.jetzt += 2;
        await expect(b.pruefeFrei()).resolves.toBeUndefined();
    });

    it("429: mindestens die genannte Wartezeit, mindestens das Minimum; eine längere Pause bleibt, wenn eine kürzere dazukommt", async () => {
        const ordner = await frischerOrdner();
        const uhr = { jetzt: 1_800_000_000_000 };
        const schutz = schutzMit(ordner, uhr);
        expect((await schutz.meldeFehler("gedrosselt", 1_000)).pauseBisMs).toBe(uhr.jetzt + 5_000);
        expect((await schutz.meldeFehler("gedrosselt", 30_000)).pauseBisMs).toBe(uhr.jetzt + 30_000);
        const lang = await schutz.meldeFehler("gesperrt");
        expect((await schutz.meldeFehler("gedrosselt", null)).pauseBisMs).toBe(lang.pauseBisMs);
    });

    it("🔴 Unterbrecher: drei Fehler in Folge öffnen ihn; danach öffnet EIN weiterer Fehler ihn wieder, ein Erfolg schließt ihn", async () => {
        const ordner = await frischerOrdner();
        const uhr = { jetzt: 1_800_000_000_000 };
        const schutz = schutzMit(ordner, uhr);
        await schutz.meldeFehler("serverfehler");
        await schutz.meldeFehler("serverfehler");
        await expect(schutz.pruefeFrei()).resolves.toBeUndefined();
        await schutz.meldeFehler("serverfehler");
        await expect(schutz.pruefeFrei()).rejects.toMatchObject({ code: "pausiert" });
        expect((await schutz.lage()).grund).toBe("unterbrecher");
        uhr.jetzt += 10_001;
        await expect(schutz.pruefeFrei()).resolves.toBeUndefined();
        // Halboffen: ein einziger Fehler genügt.
        await schutz.meldeFehler("serverfehler");
        await expect(schutz.pruefeFrei()).rejects.toMatchObject({ code: "pausiert" });
        uhr.jetzt += 10_001;
        await schutz.meldeErfolg();
        expect((await schutz.lage()).fehlerFolge).toBe(0);
        await schutz.meldeFehler("serverfehler");
        await expect(schutz.pruefeFrei()).resolves.toBeUndefined();
    });

    it("ein zerstörter Zustand ist keine Dauersperre (der Takt gilt unabhängig davon weiter)", async () => {
        const ordner = await frischerOrdner();
        await writeFile(join(ordner, "schutz.json"), "{kaputt");
        const schutz = schutzMit(ordner, { jetzt: 1_800_000_000_000 });
        await expect(schutz.pruefeFrei()).resolves.toBeUndefined();
        expect(await schutz.lage()).toEqual({ pauseBisMs: null, grund: null, fehlerFolge: 0 });
    });
});
