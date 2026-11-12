import { describe, expect, it } from "vitest";
import {
    WIKISYNC_DUMP_URL,
    type WikisyncAuftrag,
    type WikisyncDumpHolen,
    type WikisyncStand,
} from "@avesmaps3d/shared";
import { createWikisync } from "../src/wikisync/wikisync.ts";
import {
    dumpHolenSperre,
    dumpLage,
    dumpPlanZeile,
    holenLetzteZeile,
    holenSatz,
    naechsterDumpAbruf,
} from "../src/wikisync/wikisync-text.ts";

/**
 * Die Zeile „Quellstand“ mit „Dump holen“ (WI-0253 §22; Vali 2026-10-27: „das stimmt ja nicht, wir haben ihn heute mittag zusammen geholt“). Ohne Vue: Was die Zeile über ein Holen sagt (wartet auf die
 * Abholung, läuft mit Stufe und Prozent, Ende mit dem Satz des Betriebs), wann der nächste planmäßige Abruf ist, warum der Knopf gesperrt ist, und was der Klick an den Server schickt.
 */

const JETZT = new Date("2026-10-27T10:00:00.000Z");
const VALI = "Vali";

const holenAuftrag = (extra: Partial<WikisyncAuftrag> = {}): WikisyncAuftrag => ({
    art: "wiki_dump_holen",
    zustand: "QUEUED",
    phase: null,
    fortschritt: null,
    eingereihtAm: "2026-10-27T09:59:00.000Z",
    gestartetAm: null,
    ausgeloestVon: VALI,
    ...extra,
});

function stand(
    optionen: { dumpHolen?: Partial<WikisyncDumpHolen>; auftraege?: WikisyncAuftrag[]; datei?: string | null } = {},
): WikisyncStand {
    const datei = optionen.datei === undefined ? "dewa_dump_small-20261026T112915.xml.bz2" : optionen.datei;
    return {
        jetzt: JETZT.toISOString(),
        dump: {
            ordner: true,
            datei,
            geholtAm: datei === null ? null : "2026-10-26T10:29:15.000Z",
            groesse: datei === null ? null : 47_703_643,
            stand: datei === null ? null : "2026-10-26",
            seiten: datei === null ? null : 254_052,
            sha256: datei === null ? null : "a".repeat(64),
            vollstaendig: datei === null ? null : true,
            namensraeume: [],
        },
        kategorienDatei: { datei: null, geholtAm: null, groesse: null, stand: null },
        dumpHolen: { erlaubt: true, grund: null, letzter: null, ...optionen.dumpHolen },
        vorschau: null,
        tafelRevision: 1,
        auftraege: optionen.auftraege ?? [],
    };
}

describe("Dump holen: der Stand eines Holens in der Zeile", () => {
    it("🔴 ohne Holen zeigt die Zeile den Dump im Ordner; ein wartendes sagt „wartet auf die Abholung“, mit der Person", () => {
        const ruhig = dumpLage(stand(), JETZT, false);
        expect(ruhig.kreis).toBe("voll");
        expect(ruhig.unter).toMatch(/Geholt .+ · Stand des Dumps 26\.10\.2026 · 254\.052 Seiten · geprüft/u);

        const wartet = dumpLage(stand({ auftraege: [holenAuftrag({ wartetAuf: "abholung" })] }), JETZT, false);
        expect(wartet).toEqual({
            kreis: "halb",
            unter: "Dump holen: Wartet auf die Abholung durch den Server · ausgelöst von Vali",
            ton: "leise",
        });
        // Ohne benennbaren Grund: einfach die Warteschlange; hinter dem Legacy-Zug: sagt das.
        expect(holenSatz(holenAuftrag(), JETZT)).toBe("Wartet in der Warteschlange · ausgelöst von Vali");
        expect(holenSatz(holenAuftrag({ wartetAuf: "legacy_zug" }), JETZT)).toBe(
            "Wartet, bis der Import fertig ist · ausgelöst von Vali",
        );
        // Eine Auslösung ohne Person (ein Auftrag ohne Akteur) nennt keinen.
        expect(holenSatz(holenAuftrag({ ausgeloestVon: null, wartetAuf: "abholung" }), JETZT)).toBe(
            "Wartet auf die Abholung durch den Server",
        );
    });

    it("🔴 ein laufendes Holen nennt die Stufe des Korridors und den Fortschritt; eine unbekannte Stufe wird nicht erfunden", () => {
        const laeuft = holenAuftrag({
            zustand: "RUNNING",
            phase: "holen",
            fortschritt: 0.1,
            gestartetAm: "2026-10-27T09:59:30.000Z",
        });
        expect(dumpLage(stand({ auftraege: [laeuft] }), JETZT, false).unter).toMatch(
            /^Dump holen: Läuft seit .+ · Abruf beim Wiki · 10 % · ausgelöst von Vali$/u,
        );
        expect(holenSatz({ ...laeuft, phase: "pruefen", fortschritt: 0.7 }, JETZT)).toMatch(/ · Prüfen · 70 % /u);
        expect(holenSatz({ ...laeuft, phase: "ablegen", fortschritt: 0.9 }, JETZT)).toMatch(/ · Ablegen · 90 % /u);
        // Noch ohne Stufe und ohne Fortschritt: nur „Läuft seit …“.
        expect(holenSatz({ ...laeuft, phase: null, fortschritt: null }, JETZT)).toMatch(
            /^Läuft seit [^·]+ · ausgelöst von Vali$/u,
        );
        expect(holenSatz({ ...laeuft, phase: "etwas_neues" }, JETZT)).not.toContain("etwas_neues");
    });

    it("das Ende des jüngsten Holens: fertig mit dem Satz des Betriebs, gescheitert mit Grund, abgebrochen ohne Grund; ohne Holen keine Zeile", () => {
        expect(holenLetzteZeile(stand(), JETZT)).toBeNull();
        const letzter = (extra: Partial<NonNullable<WikisyncDumpHolen["letzter"]>>): WikisyncStand =>
            stand({
                dumpHolen: {
                    letzter: {
                        status: "fertig",
                        beendetAm: "2026-10-27T09:58:00.000Z",
                        ausgeloestVon: VALI,
                        meldung: null,
                        ...extra,
                    },
                },
            });

        const fertig = holenLetzteZeile(letzter({ meldung: "Dump unverändert" }), JETZT);
        expect(fertig?.ton).toBe("leise");
        expect(fertig?.text).toMatch(/^Letztes Holen .+ · Dump unverändert · ausgelöst von Vali$/u);
        // Ohne Satz des Betriebs steht nur, dass und wann.
        expect(holenLetzteZeile(letzter({ ausgeloestVon: null }), JETZT)?.text).toMatch(/^Letztes Holen [^·]+$/u);

        const gescheitert = holenLetzteZeile(
            letzter({ status: "fehlgeschlagen", meldung: "Dump nicht geholt: HTTP 401 (Zugang falsch)" }),
            JETZT,
        );
        expect(gescheitert?.ton).toBe("fehler");
        expect(gescheitert?.text).toMatch(
            /^Letztes Holen gescheitert .+ · Dump nicht geholt: HTTP 401 \(Zugang falsch\) · ausgelöst von Vali$/u,
        );

        const abgebrochen = holenLetzteZeile(letzter({ status: "abgebrochen" }), JETZT);
        expect(abgebrochen?.ton).toBe("warnung");
        expect(abgebrochen?.text).toMatch(
            /^Letztes Holen abgebrochen .+ · ohne genannten Grund · ausgelöst von Vali$/u,
        );
    });
});

describe("Dump holen: der nächste planmäßige Abruf (am 2. um 05:00 Berliner Zeit)", () => {
    const wann = (iso: string) => naechsterDumpAbruf(new Date(iso));

    it("🔴 heute ist der 27. Oktober: der nächste ist der 2. November um 05:00; am Monatsersten ist es der 2. desselben Monats", () => {
        expect(wann("2026-10-27T10:00:00.000Z")).toEqual({ datum: "02.11.2026", zeit: "05:00" });
        expect(wann("2026-10-01T10:00:00.000Z")).toEqual({ datum: "02.10.2026", zeit: "05:00" });
    });

    it("die Grenze liegt bei 05:00 in BERLIN, nicht in der Zeitzone des Browsers (Sommerzeit UTC+2, Winterzeit UTC+1)", () => {
        // 2. Oktober, Sommerzeit: 04:59 Berlin = 02:59 UTC, 05:00 Berlin = 03:00 UTC.
        expect(wann("2026-10-02T02:59:00.000Z").datum).toBe("02.10.2026");
        expect(wann("2026-10-02T03:00:00.000Z").datum).toBe("02.11.2026");
        // 2. November, Winterzeit: 04:59 Berlin = 03:59 UTC, 05:00 Berlin = 04:00 UTC.
        expect(wann("2026-11-02T03:59:00.000Z").datum).toBe("02.11.2026");
        expect(wann("2026-11-02T04:00:00.000Z").datum).toBe("02.12.2026");
    });

    it("über den Jahreswechsel: im Dezember der 2. Januar, am späten 31. Dezember (UTC) schon der 1. Januar in Berlin", () => {
        expect(wann("2026-12-15T12:00:00.000Z").datum).toBe("02.01.2027");
        expect(wann("2026-12-31T23:30:00.000Z").datum).toBe("02.01.2027");
        expect(wann("2027-01-01T12:00:00.000Z").datum).toBe("02.01.2027");
    });

    it("die Zeile steht nur, wo es einen Abruf gibt: nicht lokal, nicht in einer Umgebung, die den Dump nicht holen darf", () => {
        expect(dumpPlanZeile(stand(), JETZT, false)).toBe("Nächster planmäßiger Abruf: 02.11.2026, 05:00");
        expect(dumpPlanZeile(stand(), JETZT, true)).toBeNull();
        expect(dumpPlanZeile(stand({ dumpHolen: { erlaubt: false, grund: "release" } }), JETZT, false)).toBeNull();
    });
});

describe("Dump holen: warum der Knopf gesperrt ist", () => {
    const RECHT = "Nur mit dem Recht „Wiki-Dump holen“.";
    const sperre = (s: WikisyncStand, extra: { darf?: boolean; lokal?: boolean } = {}) =>
        dumpHolenSperre(s, { darf: extra.darf ?? true, lokal: extra.lokal ?? false, rechtSatz: RECHT });

    it("🔴 ohne Recht der Satz zum Recht; lokal der vorhandene Satz „Lokal gibt es keine Wiki-Abrufe“; sonst geht er", () => {
        expect(sperre(stand())).toBeUndefined();
        expect(sperre(stand(), { darf: false })).toBe(RECHT);
        expect(sperre(stand(), { lokal: true })).toMatch(/^Lokal gibt es keine Wiki-Abrufe/u);
    });

    it("🔴 auf Stage und Production nennt der Server den echten Grund; lokal bleibt es bei „lokal“, auch wenn der Server es so meldet", () => {
        expect(sperre(stand({ dumpHolen: { erlaubt: false, grund: "release" } }))).toBe(
            "Den Dump holt der Server nur mit einem echten Release.",
        );
        expect(sperre(stand({ dumpHolen: { erlaubt: false, grund: "ordner" } }))).toBe(
            "Auf diesem Server ist kein Dump-Ordner eingerichtet.",
        );
        expect(sperre(stand({ dumpHolen: { erlaubt: false, grund: "umgebung" } }))).toMatch(/^Lokal gibt es keine/u);
    });

    it("🔴 ein Holen, das wartet oder läuft, sperrt den zweiten Klick und sagt es; hinter dem Legacy-Zug sagt es das", () => {
        const wartet = stand({ auftraege: [holenAuftrag({ wartetAuf: "abholung" })] });
        expect(sperre(wartet)).toBe("Das Holen des Dumps wartet schon oder läuft.");
        expect(sperre(stand({ auftraege: [holenAuftrag({ zustand: "RUNNING" })] }))).toBe(
            "Das Holen des Dumps wartet schon oder läuft.",
        );
        expect(sperre(stand({ auftraege: [holenAuftrag({ wartetAuf: "legacy_zug" })] }))).toBe(
            "Wartet, bis der Import fertig ist",
        );
        // Andere Aufträge des WikiSync sperren den Knopf nicht.
        expect(
            sperre(stand({ auftraege: [holenAuftrag({ art: "wiki_vorschau", zustand: "RUNNING" })] })),
        ).toBeUndefined();
    });
});

describe("Dump holen: was der Klick schickt", () => {
    const QUITTUNG = { environment: "staging", affected: [], derivedWork: [], warnings: [] };

    it("🔴 EINE Anfrage an die Route des Dumps, nur mit der Kennung der Operation; in Production fragt die Oberfläche über „Kurz bestätigen“ und wiederholt einmal", async () => {
        const posts: { pfad: string; body: unknown }[] = [];
        let passkey = false;
        const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
            await Promise.resolve();
            if (init?.method !== "POST") return new Response("{}", { status: 200 });
            posts.push({ pfad: String(url), body: typeof init.body === "string" ? JSON.parse(init.body) : null });
            if (!passkey) {
                return new Response(
                    JSON.stringify({ error: { code: "reauth_required", message: "x", details: { need: "passkey" } } }),
                    { status: 403 },
                );
            }
            return new Response(JSON.stringify(QUITTUNG), { status: 200 });
        }) as typeof fetch;
        const ws = createWikisync({
            fetcher,
            ask: async () => {
                passkey = true;
                return true;
            },
        });
        const ergebnis = await ws.dumpHolen();
        expect(ergebnis.ok).toBe(true);
        expect(posts.map((post) => post.pfad)).toEqual([WIKISYNC_DUMP_URL, WIKISYNC_DUMP_URL]);
        expect(Object.keys(posts[0]!.body as object)).toEqual(["operationId"]);
        expect(ws.ergebnis.value).toMatchObject({ wo: "dump", result: { ok: true } });
    });

    it("🔴 lehnt der Server ab (läuft schon, kein Release, kein Ordner), steht der Satz an der Zeile des Dumps", async () => {
        for (const code of ["dump_holen_laeuft", "abruf_gesperrt", "dump_ordner_fehlt"]) {
            const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
                await Promise.resolve();
                if (init?.method !== "POST") return new Response("{}", { status: 200 });
                return new Response(JSON.stringify({ error: { code, message: "x" } }), { status: 409 });
            }) as typeof fetch;
            const ws = createWikisync({ fetcher, ask: async () => false });
            const ergebnis = await ws.dumpHolen();
            expect(ergebnis.ok, code).toBe(false);
            expect(ws.ergebnis.value?.wo, code).toBe("dump");
            expect(ergebnis.problems, code).toEqual([{ key: `admin.wikisync.fehler.${code}` }]);
        }
    });
});
