import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/http/api-error.ts";
import {
    ausgabeOrdnerPfad,
    createReleaseTestDienst,
    kindUmgebung,
    klonStarterPfad,
    letztesJson,
    startArgumente,
    starteStarter,
    type StarterAbloeser,
    type StarterAusfuehrer,
} from "../src/system/release-test.ts";
import { releaseTestLokal } from "../src/config.ts";
import { loadAuthConfig } from "../src/auth/config.ts";

/**
 * Der Dienst des Release-Tests (WI-0248 L, `system/release-test.ts`) ohne Datenbank und ohne echten Prozess: Der Aufruf des Starters ist ersetzt.
 * Die Sätze, auf die es ankommt:
 * 1. **Ein alter Starter startet nichts.** Jeder Aufruf außer dem Start selbst trägt `--trocken`; ein Starter ohne `--json` antwortet mit Text und
 *    wird übergangen.
 * 2. **Die Vorprüfung nennt den Starter, der sie als JSON beantwortet hat** (bevorzugt einen, der Startvermerke führt), nur für den Kandidaten, den
 *    die Oberfläche sah. Gestartet wird seit WI-0248 (Vali 2026-10-26) nicht mehr hier, sondern vom Ausführer des Auftrags `release_test` mit
 *    `starteStarter`: abgelöst, ohne `--trocken`.
 * 3. **Das Kind sieht die Umgebung des Servers nicht.**
 * 4. **Der Stand eines Starts kommt aus der Datei des Starters**, nicht aus dem Speicher.
 */

const STAGE = "a".repeat(40);
const AUFTRAG = "b".repeat(40);
const ANDERER = "c".repeat(40);
const KLON = "C:/klon/release-abholer.ts";
const EIGENER = "C:/eigener/release-abholer.ts";

const KANDIDAT = {
    stage: { sha: STAGE, zeit: "2026-10-23T08:00:00Z" },
    auftrag: { sha: AUFTRAG, zeit: "2026-10-23T09:00:00Z", ops: "OPS-000123" },
};

const schritte = (zustand: string) =>
    ["vorbereitung", "installation"].map((id) => ({ id, zustand, erwartetMs: 1000, schaetzung: true }));
const LAUF_KEINER = {
    zustand: "keiner",
    fertigeTeile: [],
    sperre: false,
    jetzt: "2026-10-23T10:00:00.000Z",
    schritte: schritte("offen"),
    erwartetMs: 2000,
    erwartetSchaetzung: true,
    fortschritt: 0,
};

type Antworten = Record<string, unknown>;

/** Ein ersetzter Prozessaufruf: antwortet je nach erstem Argument, schreibt jeden Aufruf mit. */
function ersatz(antworten: Antworten, aufrufe: { starter: string; argumente: string[] }[] = []): StarterAusfuehrer {
    return (starter, argumente) => {
        aufrufe.push({ starter, argumente: [...argumente] });
        const schluessel = argumente.includes("--freigeben")
            ? "freigeben"
            : argumente.includes("--freigabe-beenden")
              ? "beenden"
              : argumente.includes("--bericht")
                ? "bericht"
                : argumente.includes("--kandidat")
                  ? "kandidat"
                  : argumente.includes("--abbrechen")
                    ? "abbrechen"
                    : argumente.includes("--stand")
                      ? "stand"
                      : argumente.includes("--trocken")
                        ? "trocken"
                        : "start";
        const antwort = antworten[`${schluessel}@${starter}`] ?? antworten[schluessel];
        if (antwort instanceof Error) return Promise.reject(antwort);
        const text = typeof antwort === "string" ? antwort : `${JSON.stringify(antwort)}\n`;
        return Promise.resolve({ code: 0, stdout: text });
    };
}

const AUSGABE = "C:/daten/release-abholer";
interface Abgeloest {
    starter: string;
    argumente: string[];
    datei: string;
}

/** Ein ersetzter abgelöster Start: schreibt mit, was der Dienst startet, und lässt den Prozess sofort enden, mit der Antwort `start` als Ausgabe. */
function abloeserAus(antworten: Antworten, protokoll: Abgeloest[]): StarterAbloeser {
    return (starter, argumente, datei) => {
        protokoll.push({ starter, argumente: [...argumente], datei });
        const antwort = antworten[`start@${starter}`] ?? antworten["start"];
        if (antwort instanceof Error) return { pid: undefined, ende: Promise.reject(antwort) };
        const text = typeof antwort === "string" ? antwort : `${JSON.stringify(antwort)}\n`;
        return { pid: 1, ende: Promise.resolve({ code: 0, ausgabe: text }) };
    };
}

function dienst(
    antworten: Antworten,
    o: { jetzt?: () => number; existiert?: (p: string) => boolean; starter?: string } = {},
) {
    const aufrufe: { starter: string; argumente: string[] }[] = [];
    const warn = vi.fn();
    const d = createReleaseTestDienst({
        starter: o.starter,
        ausfuehren: ersatz(antworten, aufrufe),
        klonStarter: KLON,
        eigenerStarter: EIGENER,
        existiert: o.existiert ?? (() => true),
        warn,
        ...(o.jetzt === undefined ? {} : { jetzt: o.jetzt }),
    });
    return { d, aufrufe, warn };
}

const fehlercode = async (arbeit: Promise<unknown>): Promise<{ code: string; status: number }> => {
    try {
        await arbeit;
    } catch (e) {
        if (e instanceof ApiError) return { code: e.code, status: e.statusCode };
        throw e;
    }
    throw new Error("kein Fehler");
};

describe("JSON-Zeile des Starters lesen", () => {
    it("nimmt die letzte nicht leere Zeile, wenn sie ein Objekt ist; Text, Felder und Kaputtes sind keine Antwort", () => {
        expect(letztesJson('{"a":1}\n')).toEqual({ a: 1 });
        expect(letztesJson('Warnung\n{"a":1}\r\n\r\n')).toEqual({ a: 1 });
        expect(letztesJson("gestartet: Release-Test gestartet\n")).toBeUndefined();
        expect(letztesJson("[1,2]")).toBeUndefined();
        expect(letztesJson("{ kaputt")).toBeUndefined();
        expect(letztesJson("")).toBeUndefined();
    });
});

describe("Wo der Starter im Werkzeugklon liegt", () => {
    it("folgt der Datenwurzel des Starters: AVESMAPS_DATEN, sonst C:/avesmaps3d-data", () => {
        expect(klonStarterPfad({})).toBe("C:/avesmaps3d-data/release-werkzeug/scripts/dev/release-abholer.ts");
        expect(klonStarterPfad({ AVESMAPS_DATEN: "D:\\daten\\" })).toBe(
            "D:\\daten/release-werkzeug/scripts/dev/release-abholer.ts",
        );
        expect(klonStarterPfad({ AVESMAPS_DATEN: "D:/daten/" })).toBe(
            "D:/daten/release-werkzeug/scripts/dev/release-abholer.ts",
        );
    });
});

describe("Wo der Starter seine Ausgabe ablegt", () => {
    it("neben seinem Protokoll: <Datenwurzel>/release-abholer", () => {
        expect(ausgabeOrdnerPfad({})).toBe("C:/avesmaps3d-data/release-abholer");
        expect(ausgabeOrdnerPfad({ AVESMAPS_DATEN: "D:\\daten\\" })).toBe("D:\\daten/release-abholer");
    });
});

describe("Umgebung des Kindes", () => {
    it("🔴 gibt das System und die Orte der Werkzeuge weiter, nie DATABASE_URL, Geheimnisse oder die Einstellungen des Servers", () => {
        const aus = kindUmgebung({
            Path: "C:\\Windows",
            SystemRoot: "C:\\Windows",
            LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
            AVESMAPS_DATEN: "D:/daten",
            MARTIN_BIN: "C:/martin.exe",
            PG_BIN_DIR: "C:/pg/bin",
            DATABASE_URL: "postgres://app:geheim@127.0.0.1/db",
            TEST_DATABASE_URL: "postgres://t:t@127.0.0.1/t",
            DISCORD_CLIENT_SECRET: "geheim",
            VISITOR_SALT: "salz",
            RELEASE_ID: "dev",
            AVESMAPS_ENV: "development",
            PORT: "3000",
            NODE_ENV: "development",
        });
        expect(Object.keys(aus).sort()).toEqual(
            ["AVESMAPS_DATEN", "LOCALAPPDATA", "MARTIN_BIN", "PG_BIN_DIR", "Path", "SystemRoot"].sort(),
        );
    });
});

describe("Wo der Release-Test gilt: nur lokal", () => {
    const aus = (env: Record<string, string>) => {
        const umgebung = env as NodeJS.ProcessEnv;
        return releaseTestLokal(umgebung, loadAuthConfig(umgebung));
    };

    it("🔴 lokal auf dem Entwicklungsrechner ja; Stage, Production und jeder Server mit Release nie", () => {
        expect(aus({})).toBe(true);
        expect(aus({ RELEASE_ID: "dev" })).toBe(true);
        expect(aus({ AVESMAPS_ENV: "development" })).toBe(true);
        expect(
            aus({
                AVESMAPS_ENV: "staging",
                RELEASE_ID: "20261023T100000Z-abcdef1",
                PUBLIC_ORIGIN: "https://stage.avesmaps.de",
            }),
        ).toBe(false);
        expect(
            aus({
                AVESMAPS_ENV: "production",
                RELEASE_ID: "20261023T100000Z-abcdef1",
                PUBLIC_ORIGIN: "https://avesmaps.de",
            }),
        ).toBe(false);
        // Ein benanntes Stage ist auch mit RELEASE_ID=dev nicht lokal.
        expect(aus({ AVESMAPS_ENV: "staging", RELEASE_ID: "dev", PUBLIC_ORIGIN: "https://stage.avesmaps.de" })).toBe(
            false,
        );
        // Ein Server mit echtem Release ohne Namen hat keine Anmeldung und keinen Release-Test.
        expect(aus({ RELEASE_ID: "20261023T100000Z-abcdef1" })).toBe(false);
        // Ein echtes Release wird auch mit AVESMAPS_ENV=development nicht lokal.
        expect(aus({ AVESMAPS_ENV: "development", RELEASE_ID: "20261023T100000Z-abcdef1" })).toBe(false);
    });
});

describe("Sicht: Kandidat, Stand, Startvorgang", () => {
    it("liest Stand und Kandidat vom Starter und reicht nur die bekannten Felder weiter", async () => {
        const { d } = dienst({
            kandidat: KANDIDAT,
            stand: { ...LAUF_KEINER, statuspfad: "C:/geheim/status.json", unbekannt: 1 },
        });
        const sicht = await d.sicht();
        expect(sicht).toMatchObject({ verfuegbar: true, fehler: null, kandidat: KANDIDAT, start: null });
        expect(sicht.lauf).toEqual(LAUF_KEINER);
        expect(JSON.stringify(sicht)).not.toContain("geheim");
    });

    it("🔴 jeder Aufruf außer dem Start trägt --trocken, damit ein alter Starter nichts startet", async () => {
        const { d, aufrufe } = dienst({
            kandidat: KANDIDAT,
            stand: LAUF_KEINER,
            trocken: { status: "trocken", grund: "Würde starten.", startvermerk: true, freigabe: true },
            abbrechen: { status: "abbruch-angefordert", grund: "ok" },
        });
        await d.sicht();
        const schein = await d.pruefeStart(STAGE);
        d.verwirf(schein);
        await d.abbrechen(STAGE);
        const nachArt = (muster: string) => aufrufe.filter((a) => a.argumente.includes(muster));
        expect(nachArt("--kandidat").every((a) => a.argumente.includes("--trocken"))).toBe(true);
        expect(nachArt("--abbrechen").every((a) => a.argumente.includes("--trocken"))).toBe(true);
        // Die Sicht liest den Stand, die Vorprüfung noch einmal (die erwartete Dauer für den Auftrag): nur lesend.
        expect(nachArt("--stand")).toHaveLength(2);
        expect(nachArt("--stand").every((a) => a.argumente.join(" ") === "--stand --json")).toBe(true);
        // Die Vorprüfung ist ein Trockenlauf mit Commit.
        expect(aufrufe.some((a) => a.argumente.join(" ") === `--commit ${STAGE} --trocken --json`)).toBe(true);
    });

    it("ohne Starter: nicht verfügbar mit Satz, und nichts wird aufgerufen", async () => {
        const { d, aufrufe } = dienst({}, { existiert: () => false });
        const sicht = await d.sicht();
        expect(sicht).toMatchObject({ verfuegbar: false, lauf: null, kandidat: null });
        expect(sicht.fehler).toContain("nicht gefunden");
        expect(aufrufe).toEqual([]);
    });

    it("🔴 ein älterer Starter (schreibt Text) wird übergangen, der nächste antwortet; der Klon steht zuerst, dieser Checkout danach", async () => {
        const { d, aufrufe } = dienst({
            [`stand@${KLON}`]: "gruen · Commit aaaaaaaaaaaa\n",
            [`kandidat@${KLON}`]: "Stage: kein Stand bekannt\n",
            [`stand@${EIGENER}`]: LAUF_KEINER,
            [`kandidat@${EIGENER}`]: KANDIDAT,
        });
        const sicht = await d.sicht();
        expect(sicht).toMatchObject({ verfuegbar: true, kandidat: KANDIDAT });
        expect(aufrufe.map((a) => a.starter).sort()).toEqual([EIGENER, EIGENER, KLON, KLON].sort());
    });

    it("alle Starter zu alt, oder ein Starter, der sich nicht aufrufen lässt: nicht verfügbar, mit dem Grund", async () => {
        const alt = dienst({ stand: "keiner\n", kandidat: "text\n" });
        const a = await alt.d.sicht();
        expect(a.verfuegbar).toBe(false);
        expect(a.fehler).toContain("zu alt");
        const kaputt = dienst({ stand: new Error("spawn node ENOENT"), kandidat: new Error("spawn node ENOENT") });
        const b = await kaputt.d.sicht();
        expect(b.verfuegbar).toBe(false);
        expect(b.fehler).toContain("nicht aufrufen");
        expect(kaputt.warn).toHaveBeenCalled();
    });

    it("eine fremde Form wird nicht weitergereicht", async () => {
        const { d } = dienst({ kandidat: { stage: 5, auftrag: null }, stand: { zustand: "gruen" } });
        const sicht = await d.sicht();
        expect(sicht.verfuegbar).toBe(false);
        expect(sicht.lauf).toBeNull();
        expect(sicht.kandidat).toBeNull();
        expect(sicht.fehler).toContain("unbekannte Form");
    });

    it("ein Kandidat, der sich nicht lesen ließ (Notizen nicht erreichbar), lässt den Stand des Laufs stehen", async () => {
        const { d } = dienst({ kandidat: { fehler: "Notizen nicht geholt: kein Netz" }, stand: LAUF_KEINER });
        const sicht = await d.sicht();
        expect(sicht.verfuegbar).toBe(true);
        expect(sicht.kandidat).toBeNull();
        expect(sicht.fehler).toContain("Notizen ließen sich nicht lesen");
        expect(sicht.lauf).toEqual(LAUF_KEINER);
    });

    it("🔴 der Kandidat wird höchstens einmal je Minute geholt; ein Fehler wird nicht gemerkt", async () => {
        let t = 1_000_000;
        const { d, aufrufe } = dienst({ kandidat: KANDIDAT, stand: LAUF_KEINER }, { jetzt: () => t });
        const zaehle = () => aufrufe.filter((a) => a.argumente.includes("--kandidat")).length;
        await d.sicht();
        await d.sicht();
        expect(zaehle()).toBe(1);
        t += 60_001;
        await d.sicht();
        expect(zaehle()).toBe(2);
        const fehler = dienst({ kandidat: { fehler: "x" }, stand: LAUF_KEINER });
        await fehler.d.sicht();
        await fehler.d.sicht();
        expect(fehler.aufrufe.filter((a) => a.argumente.includes("--kandidat"))).toHaveLength(2);
    });

    it("🔴 `frisch` holt den Kandidaten sofort neu und gilt danach für die nächsten Aufrufe (der Blick der Karte unmittelbar vor einem Start)", async () => {
        let t = 1_000_000;
        const { d, aufrufe } = dienst({ kandidat: KANDIDAT, stand: LAUF_KEINER }, { jetzt: () => t });
        const zaehle = () => aufrufe.filter((a) => a.argumente.includes("--kandidat")).length;
        await d.sicht();
        await d.sicht();
        expect(zaehle(), "ohne frisch: aus dem Gedächtnis").toBe(1);
        await d.sicht({ frisch: true });
        expect(zaehle(), "mit frisch: neu geholt, obwohl keine Minute vergangen ist").toBe(2);
        await d.sicht();
        expect(zaehle(), "der frisch geholte Stand ersetzt das Gedächtnis").toBe(2);
        t += 1_000;
        await d.sicht({ frisch: false });
        expect(zaehle()).toBe(2);
    });

    it("ein konfigurierter Starter ersetzt die Suche", async () => {
        const { d, aufrufe } = dienst({ kandidat: KANDIDAT, stand: LAUF_KEINER }, { starter: "D:/mein/starter.ts" });
        await d.sicht();
        expect(new Set(aufrufe.map((a) => a.starter))).toEqual(new Set(["D:/mein/starter.ts"]));
    });
});

describe("Start: Vorprüfung, Schein, Hintergrund", () => {
    const grundlage = (
        trocken: unknown,
        start: unknown = { status: "gestartet", grund: "Release-Test gestartet" },
    ) => ({
        kandidat: KANDIDAT,
        stand: LAUF_KEINER,
        // Ein Starter, der die Freigabe kennt (WI-0248); ein Text (alter Starter) bleibt Text.
        trocken:
            typeof trocken === "object" && trocken !== null
                ? { startvermerk: true, freigabe: true, ...trocken }
                : trocken,
        start,
    });

    it("🔴 nur der Kandidat, den die Oberfläche sah: Stage-Stand und Auftrag gelten, jeder andere Stand ist veraltet", async () => {
        const { d } = dienst(grundlage({ status: "trocken", grund: "Würde starten." }));
        d.verwirf(await d.pruefeStart(STAGE));
        d.verwirf(await d.pruefeStart(AUFTRAG));
        expect(await fehlercode(d.pruefeStart(ANDERER))).toEqual({ code: "release_test_stale", status: 409 });
        // Ein Fehler hält nichts offen: danach geht es wieder.
        d.verwirf(await d.pruefeStart(AUFTRAG));
    });

    it("die Vorprüfung des Starters wird zu einem Fachcode: grün, läuft, Sperre ohne Prozess, Fehler, unbekannt", async () => {
        const fall = async (trocken: unknown) => fehlercode(dienst(grundlage(trocken)).d.pruefeStart(STAGE));
        // 🔴 WI-0248: Ein grüner Stand ist kein Fehler mehr: Der Druck gibt ihn frei, ohne neuen Lauf (ausgeliefert wird sein vorhandenes Grün).
        const gruen = await dienst(grundlage({ status: "gruen", grund: "schon grün" })).d.pruefeStart(STAGE);
        expect(gruen).toMatchObject({ commit: STAGE, schonGruen: true, wiederholen: false });
        expect(await fall({ status: "laeuft", grund: "ein Lauf ist aktiv" })).toEqual({
            code: "release_test_laeuft",
            status: 409,
        });
        expect(await fall({ status: "sperre-ohne-prozess", grund: "x" })).toEqual({
            code: "release_test_sperre",
            status: 409,
        });
        expect(await fall({ status: "fehler", grund: "Stand nicht in origin/master" })).toEqual({
            code: "release_test_fehler",
            status: 502,
        });
        expect(await fall({ status: "was-auch-immer" })).toEqual({ code: "release_test_fehler", status: 502 });
    });

    it("ein Kandidat, der sich nicht lesen lässt, und ein Starter, der nicht antwortet, verhindern den Start", async () => {
        const a = dienst({ kandidat: { fehler: "kein Netz" }, stand: LAUF_KEINER });
        expect(await fehlercode(a.d.pruefeStart(STAGE))).toEqual({ code: "release_test_fehler", status: 502 });
        const b = dienst({ kandidat: KANDIDAT, trocken: "alter Text\n" });
        expect(await fehlercode(b.d.pruefeStart(STAGE))).toEqual({ code: "release_test_unavailable", status: 503 });
    });

    it("🔴 die Vorprüfung nennt den Starter mit Startvermerk; gestartet wird mit genau ihm, abgelöst, ohne --trocken und nie über den Aufruf mit Zeitgrenze", async () => {
        const aufrufe: { starter: string; argumente: string[] }[] = [];
        const d = createReleaseTestDienst({
            starter: undefined,
            klonStarter: KLON,
            eigenerStarter: EIGENER,
            existiert: () => true,
            ausfuehren: (starter, argumente) => {
                aufrufe.push({ starter, argumente: [...argumente] });
                if (argumente.includes("--kandidat"))
                    return Promise.resolve({ code: 0, stdout: `${JSON.stringify(KANDIDAT)}\n` });
                if (argumente.includes("--stand"))
                    return Promise.resolve({ code: 0, stdout: `${JSON.stringify(LAUF_KEINER)}\n` });
                // Der Klon ist zu alt: Er antwortet, führt aber keine Startvermerke. Dieser Checkout führt sie.
                return Promise.resolve({
                    code: 0,
                    stdout: `${JSON.stringify(
                        starter === KLON
                            ? { status: "trocken", grund: "Würde starten." }
                            : { status: "trocken", grund: "Würde starten.", startvermerk: true, freigabe: true },
                    )}\n`,
                });
            },
        });
        const schein = await d.pruefeStart(STAGE);
        expect(schein.starter).toBe(EIGENER);
        // Die Vorprüfung startet nichts: Kein Aufruf ohne --trocken.
        expect(aufrufe.some((a) => a.argumente.includes("--commit") && !a.argumente.includes("--trocken"))).toBe(false);
        // Ein zweiter Start, solange der Schein offen ist: abgewiesen, ohne den Starter noch einmal zu fragen.
        const vorher = aufrufe.length;
        expect(await fehlercode(d.pruefeStart(STAGE))).toEqual({ code: "release_test_laeuft", status: 409 });
        expect(aufrufe.length).toBe(vorher);
        d.verwirf(schein);
        // Den Start selbst macht der Ausführer des Auftrags (`jobs/release-test-job.ts`) mit `starteStarter`.
        const abgeloest: Abgeloest[] = [];
        const start = starteStarter(schein.starter, STAGE, false, {
            ausgabeOrdner: AUSGABE,
            abloesen: abloeserAus({ start: { status: "gestartet" } }, abgeloest),
        });
        expect(abgeloest).toEqual([
            {
                starter: EIGENER,
                argumente: ["--commit", STAGE, "--json"],
                datei: join(AUSGABE, `starter-${STAGE.slice(0, 12)}.log`),
            },
        ]);
        await expect(start.ende).resolves.toMatchObject({ code: 0 });
    });

    it("🔴 der Starter, der die Freigabe kennt, wird bevorzugt, auch wenn er hinten steht; kennt keiner sie, startet nichts", async () => {
        const mit = (starter: string, vermerk: boolean) => ({
            [`trocken@${starter}`]: {
                status: "trocken",
                grund: "x",
                ...(vermerk ? { startvermerk: true, freigabe: true } : { startvermerk: true }),
            },
        });
        const nurHinten = dienst({
            kandidat: KANDIDAT,
            stand: LAUF_KEINER,
            ...mit(KLON, false),
            ...mit(EIGENER, true),
        });
        const a = await nurHinten.d.pruefeStart(STAGE);
        expect(a.starter).toBe(EIGENER);
        // Beide wurden gefragt, der Klon zuerst.
        expect(
            nurHinten.aufrufe
                .filter((x) => x.argumente.includes("--trocken") && x.argumente.includes("--commit"))
                .map((x) => x.starter),
        ).toEqual([KLON, EIGENER]);
        // Kennt keiner die Freigabe (beide zu alt), startet nichts: Ein Lauf ohne ihre Kennung ginge nie nach Production (WI-0248).
        const keiner = dienst({ kandidat: KANDIDAT, stand: LAUF_KEINER, ...mit(KLON, false), ...mit(EIGENER, false) });
        expect(await fehlercode(keiner.d.pruefeStart(STAGE))).toEqual({
            code: "release_test_unavailable",
            status: 503,
        });
        // Ein Starter mit Vermerk vorn braucht keine zweite Frage.
        const vorn = dienst({ kandidat: KANDIDAT, stand: LAUF_KEINER, ...mit(KLON, true), ...mit(EIGENER, true) });
        expect((await vorn.d.pruefeStart(STAGE)).starter).toBe(KLON);
        expect(
            vorn.aufrufe.filter((x) => x.argumente.includes("--trocken") && x.argumente.includes("--commit")),
        ).toHaveLength(1);
    });

    it("🔴 ein offener Schein hält jeden zweiten Start und jeden Abbruch auf, bis er verworfen wird (die Route reiht in der Zeit ein)", async () => {
        const { d } = dienst({
            ...grundlage({ status: "trocken", grund: "x" }),
            abbrechen: { status: "abbruch-angefordert", grund: "ok" },
        });
        const schein = await d.pruefeStart(STAGE);
        expect(await fehlercode(d.pruefeStart(AUFTRAG))).toEqual({ code: "release_test_laeuft", status: 409 });
        expect(await fehlercode(d.abbrechen(STAGE))).toEqual({ code: "release_test_laeuft", status: 409 });
        d.verwirf(schein);
        await d.abbrechen(STAGE);
        // Ein verworfener Schein kann nichts mehr verwerfen, was ein neuer hält.
        const neu = await d.pruefeStart(STAGE);
        d.verwirf(schein);
        expect(await fehlercode(d.pruefeStart(STAGE))).toEqual({ code: "release_test_laeuft", status: 409 });
        d.verwirf(neu);
    });

    it("die Vorprüfung nennt die erwartete Dauer des Starters (aus den früheren Läufen) für die Schätzung des Auftrags", async () => {
        const { d } = dienst({
            ...grundlage({ status: "trocken", grund: "x" }),
            stand: { ...LAUF_KEINER, erwartetMs: 4_812_400 },
        });
        const schein = await d.pruefeStart(STAGE);
        expect(schein.erwartetS).toBe(4812);
        d.verwirf(schein);
        const ohne = dienst({
            ...grundlage({ status: "trocken", grund: "x" }),
            stand: { ...LAUF_KEINER, erwartetMs: 0 },
        });
        expect((await ohne.d.pruefeStart(STAGE)).erwartetS).toBeNull();
    });
});

describe("🔴 Der Stand eines Starts steht in der Datei des Starters, nicht im Speicher des Servers", () => {
    const VORGANG = { commit: STAGE, seit: "2026-10-23T17:00:00.000Z", zustand: "baut", grund: null };
    const mitStart = (startvorgang: unknown, lauf: object = {}) => ({
        kandidat: KANDIDAT,
        stand: { ...LAUF_KEINER, ...lauf, ...(startvorgang === undefined ? {} : { startvorgang }) },
    });

    it("eine frische Instanz (der Server wurde neu gestartet) zeigt den Start, den der Starter vermerkt hat; im Lauf steht er nicht", async () => {
        const { d } = dienst(mitStart(VORGANG));
        const sicht = await d.sicht();
        expect(sicht.start).toEqual(VORGANG);
        expect(sicht.lauf).toEqual(LAUF_KEINER);
        expect(JSON.stringify(sicht.lauf)).not.toContain("startvorgang");
        const fehler = { ...VORGANG, zustand: "fehler", grund: "Testpaket nicht gebaut (Exit 1): kein Platz" };
        expect((await dienst(mitStart(fehler)).d.sicht()).start).toEqual(fehler);
        // Ohne Vermerk (kein Start oder ein gelungener): nichts.
        expect((await dienst(mitStart(undefined)).d.sicht()).start).toBeNull();
    });

    it("eine fremde Form des Vermerks macht den Stand unlesbar, nicht den Start", async () => {
        const { d } = dienst(mitStart({ commit: "kurz", zustand: "baut" }));
        const sicht = await d.sicht();
        expect(sicht.verfuegbar).toBe(false);
        expect(sicht.fehler).toContain("unbekannte Form");
    });
});

describe("Abbrechen", () => {
    it("wird nur angefordert, wo ein Test läuft; sonst ein Fachcode", async () => {
        const gut = dienst({ abbrechen: { status: "abbruch-angefordert", grund: "angefordert" } });
        await expect(gut.d.abbrechen(STAGE)).resolves.toBeUndefined();
        expect(gut.aufrufe[0]?.argumente).toEqual(["--abbrechen", STAGE, "--trocken", "--json"]);
        const nichts = dienst({ abbrechen: { status: "kein-lauf", grund: "Für aaaa läuft kein Release-Test" } });
        expect(await fehlercode(nichts.d.abbrechen(STAGE))).toEqual({ code: "release_test_kein_lauf", status: 409 });
        const fehler = dienst({ abbrechen: { status: "fehler", grund: "ABBRUCH nicht angelegt" } });
        expect(await fehlercode(fehler.d.abbrechen(STAGE))).toEqual({ code: "release_test_fehler", status: 502 });
        const alt = dienst({ abbrechen: "text\n" });
        expect(await fehlercode(alt.d.abbrechen(STAGE))).toEqual({ code: "release_test_unavailable", status: 503 });
    });
});

describe("🔴 Rote Teile wiederholen (WI-0248)", () => {
    const grundlage = (trocken: unknown) => ({
        kandidat: KANDIDAT,
        stand: LAUF_KEINER,
        trocken:
            typeof trocken === "object" && trocken !== null
                ? { startvermerk: true, freigabe: true, ...trocken }
                : trocken,
        start: { status: "gestartet", grund: "Release-Test gestartet (Wiederholung)" },
    });

    it("die Vorprüfung fragt den Starter mit --wiederholen und --trocken; gestartet wird mit --wiederholen, abgelöst und ohne --trocken", async () => {
        const { d, aufrufe } = dienst(
            grundlage({
                status: "trocken",
                grund: "Würde wiederholen.",
                startvermerk: true,
                wiederholt: { von: AUFTRAG, uebernehmbar: ["voll"] },
            }),
        );
        const schein = await d.pruefeStart(AUFTRAG, true);
        expect(schein).toMatchObject({ commit: AUFTRAG, wiederholen: true });
        expect(aufrufe.some((a) => a.argumente.join(" ") === `--wiederholen ${AUFTRAG} --trocken --json`)).toBe(true);
        expect(aufrufe.some((a) => a.argumente.includes("--commit"))).toBe(false);
        d.verwirf(schein);
        const abgeloest: Abgeloest[] = [];
        starteStarter(schein.starter, schein.commit, schein.wiederholen, {
            ausgabeOrdner: AUSGABE,
            abloesen: abloeserAus({ start: { status: "gestartet" } }, abgeloest),
        });
        expect(abgeloest[0]?.argumente).toEqual(["--wiederholen", AUFTRAG, "--json"]);
        expect(abgeloest[0]?.argumente).not.toContain("--trocken");
    });

    it("ein gewöhnlicher Start bleibt ein Start mit --commit", async () => {
        const { d } = dienst(grundlage({ status: "trocken", grund: "Würde starten.", startvermerk: true }));
        const schein = await d.pruefeStart(AUFTRAG);
        expect(schein.wiederholen).toBe(false);
        expect(startArgumente(schein.commit, schein.wiederholen, false)).toEqual(["--commit", AUFTRAG, "--json"]);
    });

    it("gibt es keinen früheren, nicht grünen Lauf, ist das ein eigener Fachcode", async () => {
        const { d } = dienst(grundlage({ status: "kein-roter-lauf", grund: "nichts zu wiederholen" }));
        expect(await fehlercode(d.pruefeStart(AUFTRAG, true))).toEqual({
            code: "release_test_kein_roter_lauf",
            status: 409,
        });
        // Ein Fehler hält nichts offen: Ein zweiter Aufruf kommt bis zum Starter.
        expect(await fehlercode(d.pruefeStart(AUFTRAG, true))).toEqual({
            code: "release_test_kein_roter_lauf",
            status: 409,
        });
    });

    it("auch die Wiederholung gilt nur für den Kandidaten, den die Oberfläche sah, und nicht neben einem Lauf oder auf einem grünen Stand", async () => {
        const { d } = dienst(grundlage({ status: "trocken", grund: "x" }));
        expect(await fehlercode(d.pruefeStart(ANDERER, true))).toEqual({ code: "release_test_stale", status: 409 });
        for (const [status, code] of [
            ["laeuft", "release_test_laeuft"],
            ["gruen", "release_test_gruen"],
            ["sperre-ohne-prozess", "release_test_sperre"],
        ] as const)
            expect(await fehlercode(dienst(grundlage({ status, grund: "x" })).d.pruefeStart(AUFTRAG, true))).toEqual({
                code,
                status: 409,
            });
    });
});

describe("🔴 Die Freigabe (WI-0248): der Start schreibt sie, ohne sie startet nichts", () => {
    const KENNUNG = "RT-00000000-0000-4000-8000-000000000001";
    const grundlage = (freigeben: unknown) => ({
        kandidat: KANDIDAT,
        stand: LAUF_KEINER,
        trocken: { status: "trocken", grund: "x", startvermerk: true, freigabe: true },
        freigeben,
        beenden: { status: "geschrieben", grund: "ok", freigabe: true },
    });

    it("schreibt die Freigabe über den Starter der Vorprüfung, mit Stand, Kennung und Person", async () => {
        const { d, aufrufe } = dienst(grundlage({ status: "geschrieben", grund: "ok", freigabe: true }));
        const schein = await d.pruefeStart(STAGE);
        await d.freigeben(schein, KENNUNG, "Vali");
        d.verwirf(schein);
        const [aufruf] = aufrufe.filter((a) => a.argumente.includes("--freigeben"));
        expect(aufruf?.starter).toBe(schein.starter);
        expect(aufruf?.argumente).toEqual([
            "--freigeben",
            STAGE,
            "--kennung",
            KENNUNG,
            "--von",
            "Vali",
            "--trocken",
            "--json",
        ]);
    });

    it("lässt sie sich nicht schreiben (Netz) oder antwortet ein alter Starter, ist das ein Fehler mit Fachcode: Die Route rollt zurück", async () => {
        for (const antwort of [
            { status: "fehler", grund: "push abgewiesen", freigabe: true },
            { status: "trocken", grund: "alter Starter" },
            "alter Text\n",
        ]) {
            const { d } = dienst(grundlage(antwort));
            const schein = await d.pruefeStart(STAGE);
            expect(await fehlercode(d.freigeben(schein, KENNUNG, "Vali"))).toEqual({
                code: "release_test_freigabe",
                status: 503,
            });
            d.verwirf(schein);
        }
    });

    it("Beenden meldet, was geschah, und wirft nicht", async () => {
        const { d, aufrufe } = dienst(grundlage({ status: "geschrieben", freigabe: true }));
        expect(await d.freigabeBeenden(STAGE, KENNUNG, "Abgebrochen von Vali")).toMatchObject({
            status: "geschrieben",
        });
        expect(aufrufe.find((a) => a.argumente.includes("--freigabe-beenden"))?.argumente).toEqual([
            "--freigabe-beenden",
            STAGE,
            "--kennung",
            KENNUNG,
            "--grund",
            "Abgebrochen von Vali",
            "--trocken",
            "--json",
        ]);
    });

    it("der Bericht kommt vom Starter; ohne Ergebnisordner ein eigener Fachcode", async () => {
        const mit = dienst({ bericht: { status: "bericht", sha: STAGE, text: "# Release-Test", ordner: "C:/x" } });
        expect(await mit.d.bericht(STAGE)).toEqual({ commit: STAGE, text: "# Release-Test", ordner: "C:/x" });
        const ohne = dienst({ bericht: { status: "kein-bericht", grund: "kein Ordner" } });
        expect(await fehlercode(ohne.d.bericht(STAGE))).toEqual({ code: "release_test_kein_bericht", status: 404 });
    });
});
