import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    RELEASE_SPERRE_MAX_MS,
    VERWAIST_NACH_MS,
    bankOrdner,
    lageZeilen,
    liesLage,
    nimmBank,
    pruefeReleaseSperre,
    releaseLaeufeOrdner,
    verwaistGrund,
    type Halter,
    type Lage,
} from "../../../scripts/dev/pruefbank.ts";

/**
 * Die Prüfbank (`scripts/dev/pruefbank.ts`, Betreiber 2026-10-17 „die sitzungen können ruhig aufeinander warten“): schwere Testläufe auf
 * diesem Rechner warten aufeinander. Problemfälle: zwei Läufe gleichzeitig; eine Sperre ohne lebenden Prozess; eine Sperre, die ein
 * hängender Lauf nie freigibt; ein Lauf, der die Sperre eines anderen wegnimmt; ein Lauf, der nicht warten soll.
 */
/**
 * Ohne `lage`: Die Fälle sollen nicht vom Arbeitsspeicher des Rechners abhängen, auf dem sie laufen. Ohne Warten auf den Release-Test: Die Fälle
 * sollen nicht davon abhängen, ob auf diesem Rechner gerade einer läuft (die eigenen Fälle dazu nennen die Sperre ausdrücklich).
 */
const POLL = { pollMs: 5, meldeAlleMs: 30, lage: () => undefined, wartetAufReleaseTest: false } as const;
/** Wie `POLL`, aber eine Bank, die auf den Release-Test wartet (nur noch mit `AVESMAPS_PRUEFBANK_WARTET_AUF_RELEASE=1`). */
const POLL_MIT_RELEASE = { pollMs: 5, meldeAlleMs: 30, lage: () => undefined, wartetAufReleaseTest: true } as const;
const GB = 1024 ** 3;
const lage = (ramFreiGb: number, platzFreiGb: number): Lage => ({
    ramFrei: ramFreiGb * GB,
    ramGesamt: 32 * GB,
    platzFrei: platzFreiGb * GB,
    platzGesamt: 1000 * GB,
    platte: "C:\\",
});
const datei = (ordner: string): string => join(ordner, "pruefbank.json");
const halter = (aenderung: Partial<Halter> = {}): Halter => ({
    pid: process.pid,
    sitzung: "fremd",
    art: "vor-dem-push --tests",
    commit: "ffff0000",
    seit: new Date().toISOString(),
    token: "fremdes-token",
    ...aenderung,
});
const warte = (ms: number): Promise<void> => new Promise((fertig) => setTimeout(fertig, ms));
/** Die PID eines Prozesses, der sicher nicht mehr läuft. */
function totePid(): number {
    return spawnSync(process.execPath, ["-e", ""]).pid;
}

describe("Prüfbank", () => {
    let ordner = "";
    let zeilen: string[] = [];
    const sag = (zeile: string): void => {
        zeilen.push(zeile);
    };
    // 🪤 Die Umgebung des Aufrufers gehört nicht in diese Fälle: `AVESMAPS_PRUEFBANK_VORRANG=1 node scripts/dev/vor-dem-push.ts --tests`
    // erbt die Variable in `npm test` und machte vier Fälle rot (Wege-Sitzung 2026-10-17); ebenso `AVESMAPS_PRUEFBANK=aus`.
    const BANK_UMGEBUNG = [
        "AVESMAPS_PRUEFBANK",
        "AVESMAPS_PRUEFBANK_VORRANG",
        "AVESMAPS_PRUEFBANK_DIR",
        "AVESMAPS_PRUEFBANK_ART",
    ] as const;
    let gesichert: Partial<Record<(typeof BANK_UMGEBUNG)[number], string>> = {};
    beforeEach(() => {
        gesichert = {};
        for (const name of BANK_UMGEBUNG) {
            const wert = process.env[name];
            if (wert !== undefined) gesichert[name] = wert;
            delete process.env[name];
        }
        ordner = mkdtempSync(join(tmpdir(), "pruefbank-"));
        zeilen = [];
    });
    afterEach(() => {
        rmSync(ordner, { recursive: true, force: true });
        for (const name of BANK_UMGEBUNG) {
            const wert = gesichert[name];
            if (wert === undefined) delete process.env[name];
            else process.env[name] = wert;
        }
    });

    it("ist frei: nimmt die Sperre ohne zu warten und gibt sie wieder frei", async () => {
        const bank = await nimmBank({
            ...POLL,
            ordner,
            sag,
            sitzung: "a",
            art: "vor-dem-push --tests",
            commit: "aaaa1111",
        });
        expect(bank.gehalten).toBe(true);
        expect(zeilen).toEqual([]);
        const eintrag = JSON.parse(readFileSync(datei(ordner), "utf8")) as Halter;
        expect(eintrag).toMatchObject({ pid: process.pid, sitzung: "a", commit: "aaaa1111" });
        bank.gibFrei();
        expect(existsSync(datei(ordner))).toBe(false);
        bank.gibFrei(); // mehrfach rufbar
    });

    it("🔴 ist belegt: der Zweite wartet, sagt auf wen, und kommt erst nach der Freigabe dran", async () => {
        const erste = await nimmBank({
            ...POLL,
            ordner,
            sag,
            sitzung: "a",
            art: "vor-dem-push --tests",
            commit: "aaaa1111",
        });
        let dran = false;
        const zweite = nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "Browserlauf" }).then((bank) => {
            dran = true;
            return bank;
        });
        await warte(80);
        expect(dran, "der Zweite darf nicht vorbei").toBe(false);
        expect(zeilen[0]).toMatch(
            /wartet auf den Prüflauf von a \(vor-dem-push --tests, Commit aaaa1111, PID \d+\) seit \d\d:\d\d/,
        );
        expect(zeilen.length, "nicht eine Zeile je Abfrage, sondern je Meldeabstand").toBeLessThan(6);
        erste.gibFrei();
        const bank = await zweite;
        expect(bank.gehalten).toBe(true);
        expect(zeilen.at(-1)).toMatch(/dran nach \d+ s/);
        expect(JSON.parse(readFileSync(datei(ordner), "utf8"))).toMatchObject({ sitzung: "b" });
        bank.gibFrei();
        expect(existsSync(datei(ordner))).toBe(false);
    });

    it("🔴 eine Sperre ohne lebenden Prozess ist verwaist und wird übernommen", async () => {
        writeFileSync(datei(ordner), JSON.stringify(halter({ pid: totePid(), sitzung: "abgestuerzt" })));
        const bank = await nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "x" });
        expect(bank.gehalten).toBe(true);
        expect(zeilen.join("\n")).toMatch(/Sperre von abgestuerzt .* übernommen: Prozess \d+ läuft nicht mehr/);
        bank.gibFrei();
    });

    it("🔴 eine Sperre über zwei Stunden ist verwaist, auch wenn ihr Prozess läuft", async () => {
        writeFileSync(datei(ordner), JSON.stringify(halter({ sitzung: "haengt" })));
        const spaeter = (): number => Date.now() + VERWAIST_NACH_MS + 60_000;
        const bank = await nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "x", jetzt: spaeter });
        expect(bank.gehalten).toBe(true);
        expect(zeilen.join("\n")).toMatch(/Sperre von haengt .* übernommen: älter als 120 min/);
        bank.gibFrei();
    });

    it("🔴 gibt nie die Sperre eines anderen frei", async () => {
        const bank = await nimmBank({ ...POLL, ordner, sag, sitzung: "a", art: "x" });
        // Ein anderer hat inzwischen übernommen (etwa weil man zu lange hing): seine Sperre steht.
        writeFileSync(datei(ordner), JSON.stringify(halter({ sitzung: "neuer-halter", token: "anderes-token" })));
        bank.gibFrei();
        expect(JSON.parse(readFileSync(datei(ordner), "utf8"))).toMatchObject({ sitzung: "neuer-halter" });
    });

    it("🔴 ein halb geschriebener Eintrag wird nicht sofort weggenommen, ein alter schon", async () => {
        writeFileSync(datei(ordner), '{ "pid": ');
        let dran = false;
        const wartend = nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "x" }).then((bank) => {
            dran = true;
            return bank;
        });
        await warte(60);
        expect(dran, "frisch angelegt: Zeit zum Fertigschreiben lassen").toBe(false);
        const vorLangem = new Date(Date.now() - 60_000);
        utimesSync(datei(ordner), vorLangem, vorLangem);
        const bank = await wartend;
        expect(bank.gehalten).toBe(true);
        bank.gibFrei();
    });

    it("🔴 ausgeschaltet (Option oder AVESMAPS_PRUEFBANK=aus): stellt sich nicht an, auch bei belegter Bank", async () => {
        const belegt = await nimmBank({ ...POLL, ordner, sag, sitzung: "a", art: "x" });
        const ohne = await nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "x", aus: true });
        expect(ohne.gehalten).toBe(false);
        process.env["AVESMAPS_PRUEFBANK"] = "aus";
        try {
            const ueberUmgebung = await nimmBank({ ...POLL, ordner, sag, sitzung: "c", art: "x" });
            expect(ueberUmgebung.gehalten).toBe(false);
        } finally {
            delete process.env["AVESMAPS_PRUEFBANK"];
        }
        ohne.gibFrei();
        expect(JSON.parse(readFileSync(datei(ordner), "utf8"))).toMatchObject({ sitzung: "a" });
        belegt.gibFrei();
    });

    it("der Ordner kommt aus AVESMAPS_PRUEFBANK_DIR, sonst neben `claims`", () => {
        expect(bankOrdner({ AVESMAPS_PRUEFBANK_DIR: "D:\\x" })).toBe("D:\\x");
        expect(bankOrdner({})).toBe("C:\\avesmaps3d-data\\pruefbank");
    });

    it("🔴 angesagte Haltezeit: ein lebender, langer Lauf wird nach zwei Stunden nicht übernommen, erst nach seinem `bis`", () => {
        const jetzt = Date.now();
        const lang = halter({
            seit: new Date(jetzt - 3 * 3_600_000).toISOString(),
            bis: new Date(jetzt + 3_600_000).toISOString(),
        });
        expect(
            verwaistGrund(lang, jetzt, () => true),
            "Sammellauf 2026-10-19: lebt und ist angesagt",
        ).toBeUndefined();
        expect(verwaistGrund({ ...lang, bis: new Date(jetzt - 1000).toISOString() }, jetzt, () => true)).toMatch(
            /über die angesagte Zeit/,
        );
        expect(
            verwaistGrund(lang, jetzt, () => false),
            "tot bleibt tot",
        ).toMatch(/läuft nicht mehr/);
    });

    it("🔴 haltHoechstensMs steht als `bis` in der Sperre und hält einen Wartenden über die zwei Stunden hinaus fern", async () => {
        let uhr = Date.now();
        const lang = await nimmBank({
            ...POLL,
            ordner,
            sag,
            sitzung: "sammellauf",
            art: "Sammellauf",
            haltHoechstensMs: 4 * 3_600_000,
            jetzt: () => uhr,
        });
        const eintrag = JSON.parse(readFileSync(datei(ordner), "utf8")) as Halter;
        expect(Date.parse(eintrag.bis ?? "") - Date.parse(eintrag.seit)).toBe(4 * 3_600_000);
        uhr += 3 * 3_600_000; // drei Stunden später, der Lauf lebt
        let dran = false;
        const zweiter = nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "x", jetzt: () => uhr }).then((bank) => {
            dran = true;
            return bank;
        });
        await warte(60);
        expect(dran, "kein Übernehmen nach zwei Stunden").toBe(false);
        lang.gibFrei();
        (await zweiter).gibFrei();
    });

    it("verwaistGrund: lebender, junger Halter gilt; toter und alter nicht", () => {
        const jetzt = Date.now();
        expect(verwaistGrund(halter(), jetzt, () => true)).toBeUndefined();
        expect(verwaistGrund(halter(), jetzt, () => false)).toMatch(/läuft nicht mehr/);
        expect(
            verwaistGrund(halter({ seit: new Date(jetzt - VERWAIST_NACH_MS - 1).toISOString() }), jetzt, () => true),
        ).toMatch(/älter als/);
        expect(
            verwaistGrund(halter({ seit: "kaputt" }), jetzt, () => true),
            "ein unlesbares Datum macht nicht verwaist",
        ).toBeUndefined();
    });

    it("🔴 Lage: eine Zeile mit freiem RAM und Platz, bei knappem Rechner eine Warnung dazu, nie ein Halt", async () => {
        const zeilenMit = async (werte: Lage | undefined): Promise<{ zeilen: string[]; gehalten: boolean }> => {
            const eigene: string[] = [];
            const bank = await nimmBank({
                ...POLL,
                ordner,
                sag: (z) => eigene.push(z),
                sitzung: "a",
                art: "x",
                lage: () => werte,
            });
            bank.gibFrei();
            return { zeilen: eigene, gehalten: bank.gehalten };
        };
        const gut = await zeilenMit(lage(20, 300));
        expect(gut.zeilen).toHaveLength(1);
        expect(gut.zeilen[0]).toMatch(/Rechner: RAM frei 20 von 32 GB, C:\\ frei 300 von 1\.000 GB \(30 %\)/);
        const wenigRam = await zeilenMit(lage(5.9, 300));
        expect(wenigRam.zeilen).toHaveLength(2);
        expect(wenigRam.zeilen[1]).toMatch(/Rechner knapp \(weniger als 8 GB RAM frei\).*kein Urteil über den Commit/);
        const wenigPlatz = await zeilenMit(lage(20, 49));
        expect(wenigPlatz.zeilen[1]).toMatch(/Rechner knapp \(weniger als 5 % Platz auf C:\\ frei\)/);
        const beides = await zeilenMit(lage(5.9, 49));
        expect(beides.zeilen[1]).toMatch(/weniger als 8 GB RAM frei, weniger als 5 % Platz/);
        for (const fall of [wenigRam, wenigPlatz, beides])
            expect(fall.gehalten, "Warnen heißt nicht anhalten").toBe(true);
        expect((await zeilenMit(undefined)).zeilen, "ohne Angabe vom Betriebssystem keine Zeile").toEqual([]);
    });

    it("lageZeilen: genau an der Grenze ist der Rechner nicht knapp; liesLage liefert echte Werte", () => {
        expect(lageZeilen(lage(8, 50))).toHaveLength(1);
        expect(lageZeilen(lage(7.99, 50))).toHaveLength(2);
        expect(lageZeilen(lage(8, 49.9))).toHaveLength(2);
        const echt = liesLage();
        expect(echt).toBeDefined();
        expect(echt!.ramFrei).toBeGreaterThan(0);
        expect(echt!.ramGesamt).toBeGreaterThanOrEqual(echt!.ramFrei);
        expect(echt!.platzGesamt).toBeGreaterThanOrEqual(echt!.platzFrei);
    });

    it("🔴 Reihenfolge: Wer zuerst wartet, kommt zuerst dran, auch wenn ein späterer öfter nachfragt", async () => {
        const erste = await nimmBank({ ...POLL, ordner, sag, sitzung: "a", art: "x" });
        const reihenfolge: string[] = [];
        const alt = nimmBank({ ...POLL, pollMs: 40, ordner, sag, sitzung: "alt", art: "x" }).then((bank) => {
            reihenfolge.push("alt");
            return bank;
        });
        await warte(25);
        const jung = nimmBank({ ...POLL, pollMs: 1, ordner, sag, sitzung: "jung", art: "x" }).then((bank) => {
            reihenfolge.push("jung");
            return bank;
        });
        await warte(25);
        erste.gibFrei();
        const bankAlt = await alt;
        await warte(30);
        expect(reihenfolge, "der Jüngere darf nicht vorbei, solange der Ältere hält").toEqual(["alt"]);
        bankAlt.gibFrei();
        (await jung).gibFrei();
        expect(reihenfolge).toEqual(["alt", "jung"]);
        expect(zeilen.join("\n")).toMatch(/Platz 2 in der Warteschlange/);
    });

    it("🔴 Vorrang: ein Hotfix kommt vor die Wartenden, verdrängt aber den laufenden Halter nicht", async () => {
        const halterBank = await nimmBank({ ...POLL, ordner, sag, sitzung: "haelt", art: "x" });
        const reihenfolge: string[] = [];
        const gewoehnlich = nimmBank({ ...POLL, ordner, sag, sitzung: "wartet", art: "x" }).then((bank) => {
            reihenfolge.push("wartet");
            return bank;
        });
        await warte(25);
        const hotfix = nimmBank({ ...POLL, ordner, sag, sitzung: "hotfix", art: "x", vorrang: true }).then((bank) => {
            reihenfolge.push("hotfix");
            return bank;
        });
        await warte(40);
        expect(reihenfolge, "der Halter bleibt Halter, auch gegen einen Hotfix").toEqual([]);
        expect(zeilen.join("\n")).toMatch(/mit Vorrang angestellt/);
        halterBank.gibFrei();
        const bankHotfix = await hotfix;
        await warte(30);
        expect(reihenfolge, "der Hotfix vor dem Älteren").toEqual(["hotfix"]);
        bankHotfix.gibFrei();
        (await gewoehnlich).gibFrei();
        expect(reihenfolge).toEqual(["hotfix", "wartet"]);
    });

    it("🔴 `seit` der Sperre zählt ab dem Bekommen, nicht ab dem Anstellen: Wer lange wartete, wird nicht gleich überholt", async () => {
        const erste = await nimmBank({ ...POLL, ordner, sag, sitzung: "a", art: "x" });
        const basis = Date.now();
        let versatz = 0;
        const uhrB = (): number => basis + versatz;
        const zweite = nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "x", jetzt: uhrB });
        await warte(30);
        // In einem Zug (keine Abfrage dazwischen): drei Stunden sind vergangen, A gibt frei.
        versatz = 3 * 60 * 60 * 1000;
        erste.gibFrei();
        const bankB = await zweite;
        const eintrag = JSON.parse(readFileSync(datei(ordner), "utf8")) as Halter;
        expect(Math.abs(Date.parse(eintrag.seit) - (basis + versatz)), "seit = Zeitpunkt des Bekommens").toBeLessThan(
            1000,
        );
        // Ein Dritter (eine Minute später) hält B für lebendig und wartet.
        let dran = false;
        const dritte = nimmBank({
            ...POLL,
            ordner,
            sag,
            sitzung: "c",
            art: "x",
            jetzt: () => basis + versatz + 60_000,
        }).then((bank) => {
            dran = true;
            return bank;
        });
        await warte(50);
        expect(dran, "B hält seit einer Minute, nicht seit drei Stunden").toBe(false);
        bankB.gibFrei();
        (await dritte).gibFrei();
    });

    it("🔴 ein Ticket ohne lebenden Prozess hält niemanden auf und wird weggeräumt", async () => {
        const schlange = join(ordner, "warteschlange");
        mkdirSync(schlange, { recursive: true });
        const tot = join(schlange, "000000000000001-tot.json");
        writeFileSync(tot, JSON.stringify(halter({ pid: totePid(), sitzung: "abgestuerzt", token: "tot" })));
        const bank = await nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "x" });
        expect(bank.gehalten).toBe(true);
        expect(existsSync(tot)).toBe(false);
        bank.gibFrei();
    });

    it("🔴 ein älteres Ticket eines lebenden Prozesses hat Vorrang, auch bei freier Sperre", async () => {
        const schlange = join(ordner, "warteschlange");
        mkdirSync(schlange, { recursive: true });
        const vorrang = join(schlange, "000000000000001-vorrang.json");
        writeFileSync(vorrang, JSON.stringify(halter({ sitzung: "wartet-laenger", token: "vorrang" })));
        let dran = false;
        const spaeter = nimmBank({ ...POLL, ordner, sag, sitzung: "b", art: "x" }).then((bank) => {
            dran = true;
            return bank;
        });
        await warte(60);
        expect(dran, "der Ältere ist noch nicht dran gewesen").toBe(false);
        rmSync(vorrang);
        const bank = await spaeter;
        expect(bank.gehalten).toBe(true);
        bank.gibFrei();
    });

    it("nach dem Anstellen liegt kein eigenes Ticket mehr in der Warteschlange", async () => {
        const bank = await nimmBank({ ...POLL, ordner, sag, sitzung: "a", art: "x" });
        expect(readdirSync(join(ordner, "warteschlange"))).toEqual([]);
        bank.gibFrei();
    });

    // Der Vorlauf von `vor-dem-push` (Lint, shared-Bau, Typcheck; Hauptorchestrierung 2026-10-18): dieselbe Bank mit zwei Plätzen.
    const VORLAUF = { ...POLL, plaetze: 2, titel: "Vorlauf" } as const;

    it("🔴 zwei Plätze: zwei kommen sofort dran, der Dritte wartet, nennt beide und rückt nach, sobald einer frei wird", async () => {
        const a = await nimmBank({ ...VORLAUF, ordner, sag, sitzung: "a", art: "Typcheck", commit: "aaaa1111" });
        const b = await nimmBank({ ...VORLAUF, ordner, sag, sitzung: "b", art: "Typcheck" });
        expect(zeilen, "die ersten beiden warten nicht").toEqual([]);
        expect(
            readdirSync(ordner)
                .filter((n) => n.startsWith("platz-"))
                .sort(),
        ).toEqual(["platz-1.json", "platz-2.json"]);
        expect(existsSync(datei(ordner)), "die Datei der Prüfbank bleibt unberührt").toBe(false);
        let dran = false;
        const c = nimmBank({ ...VORLAUF, ordner, sag, sitzung: "c", art: "Typcheck" }).then((bank) => {
            dran = true;
            return bank;
        });
        await warte(80);
        expect(dran, "der Dritte darf nicht dazu").toBe(false);
        expect(zeilen[0]).toMatch(
            /^ {2}Vorlauf: wartet auf den Prüflauf von a \(Typcheck, Commit aaaa1111, PID \d+\) seit \d\d:\d\d und b \(Typcheck, PID \d+\) seit \d\d:\d\d; als Nächster dran\.$/,
        );
        b.gibFrei();
        const bank = await c;
        expect(bank.gehalten).toBe(true);
        expect(zeilen.at(-1)).toMatch(/^ {2}Vorlauf: dran nach \d+ s\.$/);
        expect(JSON.parse(readFileSync(join(ordner, "platz-2.json"), "utf8"))).toMatchObject({ sitzung: "c" });
        a.gibFrei();
        bank.gibFrei();
        expect(readdirSync(ordner).filter((n) => n.startsWith("platz-"))).toEqual([]);
    });

    it("🔴 zwei Plätze: nur die ersten zwei Tickets dürfen; der Vierte bleibt hinter dem Dritten, auch wenn ein Platz frei wird", async () => {
        const a = await nimmBank({ ...VORLAUF, ordner, sag, sitzung: "a", art: "x" });
        const b = await nimmBank({ ...VORLAUF, ordner, sag, sitzung: "b", art: "x" });
        const reihenfolge: string[] = [];
        const c = nimmBank({ ...VORLAUF, ordner, sag, sitzung: "c", art: "x" }).then((bank) => {
            reihenfolge.push("c");
            return bank;
        });
        await warte(30);
        const d = nimmBank({ ...VORLAUF, ordner, sag, sitzung: "d", art: "x" }).then((bank) => {
            reihenfolge.push("d");
            return bank;
        });
        await warte(30);
        expect(zeilen.join("\n")).toMatch(/Vorlauf: wartet auf .*; Platz 2 in der Warteschlange\./);
        a.gibFrei();
        const cBank = await c;
        await warte(40);
        expect(reihenfolge, "d wartet weiter, beide Plätze sind belegt (b und c)").toEqual(["c"]);
        b.gibFrei();
        const dBank = await d;
        expect(reihenfolge).toEqual(["c", "d"]);
        cBank.gibFrei();
        dBank.gibFrei();
    });

    it("🔴 zwei Plätze: ein Platz ohne lebenden Prozess ist verwaist und wird übernommen, die Zeile trägt den Titel", async () => {
        writeFileSync(
            join(ordner, "platz-1.json"),
            JSON.stringify(halter({ pid: totePid(), sitzung: "abgestuerzt", token: "tot" })),
        );
        writeFileSync(join(ordner, "platz-2.json"), JSON.stringify(halter({ sitzung: "lebt", token: "lebt" })));
        const bank = await nimmBank({ ...VORLAUF, ordner, sag, sitzung: "neu", art: "x" });
        expect(bank.gehalten).toBe(true);
        expect(zeilen.join("\n")).toMatch(
            /Vorlauf: Sperre von abgestuerzt .* übernommen: Prozess \d+ läuft nicht mehr/,
        );
        expect(JSON.parse(readFileSync(join(ordner, "platz-2.json"), "utf8"))).toMatchObject({ sitzung: "lebt" });
        bank.gibFrei();
        expect(
            JSON.parse(readFileSync(join(ordner, "platz-2.json"), "utf8")),
            "nie den Platz eines anderen freigeben",
        ).toMatchObject({
            sitzung: "lebt",
        });
    });

    // Der lokale Release-Test (`release-runner.ts`) hält die Sperre `<Datenwurzel>\release-werkzeug\.release-runs\aktiv` (ein Ordner). Die Bank wartet auf
    // einen lebenden Lauf, ohne dass ein Modell nachfragt, und lässt sich von einer toten Sperre nicht ewig halten (Befund WI-0248, Lauf f80bb5c83).
    describe("Release-Test", () => {
        const SHA = "f80bb5c83b26169683def09cc8fb27c9717a0e4c";
        let laeufe = "";
        beforeEach(() => {
            laeufe = join(ordner, "release-werkzeug", ".release-runs");
            mkdirSync(laeufe, { recursive: true });
        });
        const sperre = (): string => join(laeufe, "aktiv");
        const mitSperre = (): void => mkdirSync(sperre());
        const ohneSperre = (): void => rmSync(sperre(), { recursive: true, force: true });
        const optionen = (lebtRunner: () => boolean | undefined) =>
            ({ ...POLL_MIT_RELEASE, ordner, sag, releaseLaeufe: laeufe, lebtRunner }) as const;

        it("die Sperre liegt neben dem Bankordner, im Werkzeugklon des Release-Tests", () => {
            expect(releaseLaeufeOrdner("C:\\avesmaps3d-data\\pruefbank")).toBe(
                join("C:\\avesmaps3d-data", "release-werkzeug", ".release-runs"),
            );
        });

        it("🔴 Entscheidung warten oder nicht: ohne Sperre keine; mit lebendem Runner warten; ohne Runner tot; bei unlesbarer Prozessliste erst nach der Zeitgrenze tot", () => {
            const stand = () => ({ sha: SHA, start: "2026-10-24T07:49:56.678Z", schritt: "browser-2" });
            expect(pruefeReleaseSperre(laeufe, { lebtRunner: () => true }), "kein Lauf, keine Sperre").toEqual({
                zustand: "keine",
            });
            mitSperre();
            expect(pruefeReleaseSperre(laeufe, { lebtRunner: () => true, stand })).toEqual({
                zustand: "laeuft",
                ...stand(),
            });
            expect(pruefeReleaseSperre(laeufe, { lebtRunner: () => false, stand })).toMatchObject({
                zustand: "tot",
                grund: expect.stringMatching(/release-runner\.ts/) as unknown,
            });
            // `undefined`: Die Prozessliste ließ sich nicht lesen. Das ist kein Beweis für tot, also warten, bis die Zeitgrenze des Runners um ist.
            expect(pruefeReleaseSperre(laeufe, { lebtRunner: () => undefined, stand })).toMatchObject({
                zustand: "laeuft",
            });
            const spaeter = (): number => Date.now() + RELEASE_SPERRE_MAX_MS + 60_000;
            expect(pruefeReleaseSperre(laeufe, { lebtRunner: () => undefined, jetzt: spaeter, stand })).toMatchObject({
                zustand: "tot",
                grund: expect.stringMatching(/Stunden alt/) as unknown,
            });
            expect(
                pruefeReleaseSperre(laeufe, { lebtRunner: () => true, jetzt: spaeter, stand }),
                "auch ein lebender, hängender Runner hält nicht über seine eigene Zeitgrenze hinaus",
            ).toMatchObject({ zustand: "tot" });
        });

        it("🔴 ein lebender Release-Test hält die Bank: sie wartet, schreibt wenige Zeilen, worauf, und kommt nach seinem Ende von selbst dran", async () => {
            mitSperre();
            let dran = false;
            const wartend = nimmBank({ ...optionen(() => true), sitzung: "b", art: "Browserlauf" }).then((bank) => {
                dran = true;
                return bank;
            });
            await warte(100);
            expect(dran, "die Bank ist frei, aber der Release-Test läuft").toBe(false);
            expect(existsSync(datei(ordner)), "die Bank wird nicht einmal genommen").toBe(false);
            expect(zeilen[0]).toMatch(/^ {2}Prüfbank: wartet auf den Release-Test\b/);
            expect(zeilen.length, "nicht eine Zeile je Abfrage, sondern je Meldeabstand").toBeLessThan(6);
            ohneSperre();
            const bank = await wartend;
            expect(bank.gehalten).toBe(true);
            expect(zeilen.at(-1)).toMatch(/dran nach \d+ s/);
            bank.gibFrei();
        });

        it("🔴 die Wartezeile nennt Commit, Schritt und Beginn des laufenden Release-Tests aus seinem Laufordner", async () => {
            mitSperre();
            const lauf = join(laeufe, SHA);
            mkdirSync(lauf);
            writeFileSync(
                join(lauf, "status.json"),
                JSON.stringify({
                    version: 3,
                    sha: SHA,
                    status: "laeuft",
                    start: "2026-10-24T07:49:56.678Z",
                    teile: [],
                }),
            );
            writeFileSync(join(lauf, "browser-2.log"), "");
            const wartend = nimmBank({ ...optionen(() => true), sitzung: "b", art: "x" });
            await warte(60);
            ohneSperre();
            (await wartend).gibFrei();
            expect(zeilen[0]).toMatch(/\(Commit f80bb5c83b26, Schritt browser-2, seit \d\d:\d\d\)/);
        });

        it("🔴 eine tote Sperre (kein Runner lebt) hält die Bank nicht: eine Zeile, kein Warten, nichts entsperrt", async () => {
            mitSperre();
            const bank = await nimmBank({ ...optionen(() => false), sitzung: "b", art: "x" });
            expect(bank.gehalten, "nicht gewartet").toBe(true);
            expect(zeilen.filter((z) => /kein Release-Lauf lebt/.test(z))).toHaveLength(1);
            expect(zeilen.join("\n")).toMatch(/ich warte nicht und entsperre nicht/);
            expect(
                existsSync(sperre()),
                "die Sperre bleibt stehen: Wegräumen ist Sache dessen, der sie geprüft hat",
            ).toBe(true);
            bank.gibFrei();
        });

        it("🔴 die Antwort „tot“ gilt für diese Sperre: ein neuer Lauf kurz danach wird wieder abgewartet", async () => {
            let lebt = false;
            mitSperre();
            const erste = await nimmBank({ ...optionen(() => lebt), sitzung: "a", art: "x" });
            erste.gibFrei();
            // Die alte Sperre verschwindet, ein neuer Lauf legt seine an (anderer Zeitstempel) und lebt.
            ohneSperre();
            await warte(20);
            lebt = true;
            mitSperre();
            let dran = false;
            const zweite = nimmBank({ ...optionen(() => lebt), sitzung: "b", art: "x" }).then((bank) => {
                dran = true;
                return bank;
            });
            await warte(60);
            expect(dran, "der frische Lauf darf nicht als tot gelten, weil die alte Sperre es war").toBe(false);
            ohneSperre();
            (await zweite).gibFrei();
        });

        it("🔴 ohne Schalter wartet keine Bank auf den Release-Test, auch die schwere nicht (Betreiber 2026-10-24: Tests legen die Entwicklung nicht lahm)", async () => {
            mitSperre();
            delete process.env["AVESMAPS_PRUEFBANK_WARTET_AUF_RELEASE"];
            for (const plaetze of [1, 2]) {
                // Ohne `wartetAufReleaseTest`: die Vorgabe der Bank.
                const bank = await nimmBank({
                    pollMs: POLL_MIT_RELEASE.pollMs,
                    meldeAlleMs: POLL_MIT_RELEASE.meldeAlleMs,
                    lage: POLL_MIT_RELEASE.lage,
                    ordner,
                    sag,
                    releaseLaeufe: laeufe,
                    lebtRunner: () => true,
                    plaetze,
                    titel: "Bank",
                    sitzung: "a",
                    art: "Typcheck",
                });
                expect(bank.gehalten, `${String(plaetze)} Platz/Plätze`).toBe(true);
                bank.gibFrei();
            }
            expect(zeilen).toEqual([]);
        });

        it("AVESMAPS_PRUEFBANK=aus ignoriert auch den Release-Test", async () => {
            mitSperre();
            process.env["AVESMAPS_PRUEFBANK"] = "aus";
            try {
                const bank = await nimmBank({ ...optionen(() => true), sitzung: "a", art: "x" });
                expect(bank.gehalten).toBe(false);
                expect(zeilen).toEqual([]);
            } finally {
                delete process.env["AVESMAPS_PRUEFBANK"];
            }
        });
    });

    it("lageZeilen trägt den Titel der Bank", () => {
        expect(lageZeilen(lage(20, 300), "Vorlauf")[0]).toMatch(/^ {2}Vorlauf: Rechner: RAM frei 20 von 32 GB/);
        expect(lageZeilen(lage(20, 300))[0]).toMatch(/^ {2}Prüfbank: Rechner:/);
    });
});
