import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { LEICHTE_ARTEN, istSchwer } from "../src/jobs/dirigent/plan.ts";
import { JOB_HANDLERS, JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { JOB_KIND_CATALOG, claimsSlot, expectedMemoryMb, knowsKind } from "../src/jobs/kinds.ts";
import { wikiNamespaceTafel } from "@avesmaps3d/shared";
import {
    leseDumpEingabe,
    leseVorschauEingabe,
    runWikiDumpEinlesenJob,
    runWikiVorschauJob,
    type JobTafel,
} from "../src/jobs/wiki-dump-jobs.ts";
import { wikiAbrufErlaubt, wikiKonfiguration } from "../src/wiki/config.ts";
import { WikiTransportFehler } from "../src/wiki/transport/fehler.ts";
import { erzeugeWikiClient } from "../src/wiki/transport/client.ts";
import { berechneVorschau, gesuchteTitel, type Zuweisung } from "../src/wiki/vorschau/vergleich.ts";
import { titelAusWikiAdresse } from "../src/wiki/vorschau/adresse.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import type { PlanObjekt } from "../src/wiki/abgleich/plan.ts";
import type { VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import {
    baueDump,
    baueKategorienSql,
    findeBzip2,
    neuerOrdner,
    packeBz2,
    schreibeKategorienDatei,
    type FixtureSeite,
} from "./support/wiki-dump-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die zwei lesenden Jobarten des WikiSync (WI-0253 B-1): `wiki_dump_einlesen` und `wiki_vorschau`. Beide lesen nur, rufen das Wiki nicht an
 * und haben weder Route noch Knopf.
 *
 * - **Soll:** Manifest und Zählungen als Ergebnis; die Vorschau zählt gefunden, umgeleitet und „nicht im Dump“ NUR für Zuweisungen mit
 *   gespeicherter Wiki-Adresse, je Art getrennt.
 * - **Problemfall Eigenkennungen (Vali 2026-10-25):** Eine Kennung ohne Wiki-Adresse zählt nie als „nicht im Dump“; sie bekommt eine ruhige
 *   Zahl je Art und wird sonst nicht angefasst. Im Zweifel (nur ein Titel, eine fremde Adresse) gilt Eigenkennung.
 * - **Problemfälle:** abgeschnittener Dump, fehlender Ordner, Dateiname mit Pfad.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function context(input: Record<string, unknown>): JobContext & { phasen: string[] } {
    const phasen: string[] = [];
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: (name) => {
            phasen.push(name);
            return Promise.resolve();
        },
        checkpoint: () => undefined,
        phasen,
    };
}

async function jobFehler(arbeit: Promise<unknown>): Promise<JobFailure> {
    try {
        await arbeit;
    } catch (fehler) {
        if (fehler instanceof JobFailure) return fehler;
        throw fehler;
    }
    throw new Error("kein Fehler");
}

const SEITEN: FixtureSeite[] = [
    { titel: "Gareth", ns: 0, text: "Hauptstadt" },
    { titel: "Reichsstadt Gareth", ns: 0, weiterleitung: "Gareth" },
    { titel: "Inoffiziell:Apfeldorn", ns: 222, text: "Ein Dorf", zeit: "2026-10-01T08:30:00Z" },
    { titel: "Elf:Volk", ns: 220, text: "x" },
    { titel: "Ilaris:Vorteil", ns: 444, text: "x" },
    { titel: "Kategorie:Orte", ns: 14, text: "" },
    { titel: "Kategorie:Städte", ns: 14, text: "" },
    { titel: "Vorlage:Pol", ns: 10, text: "{{{1}}}" },
];

describe("wiki_vorschau: die Kategorien-Datei (WI-0294)", () => {
    const lade = (): Promise<Zuweisung[]> => Promise.resolve(ZUWEISUNGEN);
    type Abgelegt = Parameters<VorschauAblage["schreibe"]>[0];
    /** Ein Ordner mit dem Dump der Tests und einer Kategorien-Datei; Gareth (Seite 1000) ist eine Metropole und steht in der Kategorie Hafen. */
    async function mitDatei(
        zeilen: { von: number; nach: string; art?: "page" | "subcat" | "file" }[] = [
            { von: 1000, nach: "Metropole_(Siedlungsgröße)" },
            { von: 1000, nach: "Aventurien" },
            { von: 1000, nach: "Hafen" },
        ],
        optionen: { stand?: string; abschneiden?: number } = {},
    ): Promise<{ pfad: string; weg(): Promise<void> }> {
        const o = await neuerOrdner("wiki-vorschau-kategorien");
        // Gareth trägt eine Infobox: Ohne sie nähme der Plan das Objekt wegen `infobox_kaputt` aus dem Vergleich der Kategorien.
        const dump = [
            { titel: "Gareth", ns: 0, text: "{{Infobox Siedlung\n|Name=Gareth\n}}\nGareth." },
            ...SEITEN.slice(1),
        ];
        await writeFile(join(o.pfad, "dewa_dump_small_20261001.xml"), baueDump(dump));
        await schreibeKategorienDatei(
            join(o.pfad, "dump_categorylinks-20261009.sql.gz"),
            baueKategorienSql(zeilen, { stand: optionen.stand ?? "2026-10-09  4:13:37" }),
            optionen.abschneiden === undefined ? {} : { abschneiden: optionen.abschneiden },
        );
        return o;
    }
    const gareth = (): PlanObjekt => ({
        bereich: "ort",
        objektArt: "place",
        id: "o-gareth",
        name: "Gareth",
        adresse: "https://de.wiki-aventurica.de/wiki/Gareth",
        zustand: "zugewiesen",
        herkunft: "unknown",
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: null,
        schnappschussUnbekannt: new Set(),
    });
    /** Eine Ablage, die nichts speichert, sondern den Lauf festhält. */
    function ablageMit(objekte: PlanObjekt[], abgelegt: Abgelegt[], fehllaeufe: string[] = []): VorschauAblage {
        return {
            ladeObjekte: () => Promise.resolve(objekte),
            ladeBekannteTitel: () => Promise.resolve(new Set<string>()),
            ladeWikisyncBereiche: () => Promise.resolve(new Set(["ort"] as const)),
            schreibe: (eingabe) => {
                abgelegt.push(eingabe);
                return Promise.resolve(abgelegt.length);
            },
            schreibeFehllauf: (_eingabe, fehler) => {
                fehllaeufe.push(fehler);
                return Promise.resolve();
            },
            ausloeser: () => Promise.resolve(null),
        };
    }

    it("🔴 liest die Datei neben dem Dump: Pin mit Name, Prüfsumme, Stand der Endzeile und Zeilen; die Ortsgröße steht als Planzeile im Lauf", async () => {
        const o = await mitDatei();
        try {
            const abgelegt: Abgelegt[] = [];
            const kontext = context({ bereiche: ["ort"] });
            const ergebnis = await runWikiVorschauJob(kontext, {
                environment: { WIKI_DUMP_ROOT: o.pfad },
                ladeZuweisungen: lade,
                ablage: ablageMit([gareth()], abgelegt),
            });
            expect(kontext.phasen).toEqual([
                "zuweisungen",
                "kategorien",
                "dump",
                "kategorien_lesen",
                "vergleichen",
                "ablegen",
            ]);
            expect(ergebnis["quelle"]).toMatchObject({
                kategorien: { datei: "dump_categorylinks-20261009.sql.gz", stand: "2026-10-09T04:13:37Z", zeilen: 3 },
            });
            expect(abgelegt).toHaveLength(1);
            expect(abgelegt[0]!.quelle.kategorien).toMatchObject({
                datei: "dump_categorylinks-20261009.sql.gz",
                stand: "2026-10-09T04:13:37Z",
                zeilen: 3,
            });
            expect(abgelegt[0]!.quelle.kategorien!.sha256).toMatch(/^[0-9a-f]{64}$/u);
            const felder = abgelegt[0]!.plan.zeilen.filter(
                (z) => z.feld === "settlement_class" || z.feld === "building_type",
            );
            // Die Kategorie Hafen steht in Legacys Liste der Arten, auch wenn sie keine Unterkategorie von „Bauwerk nach Art“ ist: Gareth bekommt sie als Art.
            expect(felder.map((z) => [z.objektName, z.feld, z.neu])).toEqual([
                ["Gareth", "settlement_class", "metropole"],
                ["Gareth", "building_type", "Hafen"],
            ]);
        } finally {
            await o.weg();
        }
    });

    it("🔴 eine abgeschnittene Datei hält den Auftrag an (kategorien_unvollstaendig, nicht wiederholbar), legt nichts ab und vermerkt einen Fehllauf", async () => {
        const grosse = Array.from({ length: 3_000 }, (_, i) => ({ von: 20_000 + i, nach: `Kategorie_${String(i)}` }));
        const o = await mitDatei(grosse, { abschneiden: 40 });
        try {
            const abgelegt: Abgelegt[] = [];
            const fehllaeufe: string[] = [];
            const fehler = await jobFehler(
                runWikiVorschauJob(context({ bereiche: ["ort"] }), {
                    environment: { WIKI_DUMP_ROOT: o.pfad },
                    ladeZuweisungen: lade,
                    ablage: ablageMit([gareth()], abgelegt, fehllaeufe),
                }),
            );
            expect([fehler.code, fehler.retryable]).toEqual(["kategorien_unvollstaendig", false]);
            expect(abgelegt).toEqual([]);
            expect(fehllaeufe).toHaveLength(1);
        } finally {
            await o.weg();
        }
    });

    it("Dump und Datei weit auseinander (über 14 Tage): ein Befund mit der Zahl der Tage, kein Halt; ohne Bereiche mit Kategorien wird die Datei gar nicht gelesen", async () => {
        const o = await mitDatei(undefined, { stand: "2026-11-09  4:13:37" });
        try {
            const ergebnis = await runWikiVorschauJob(context({ bereiche: ["ort"] }), {
                environment: { WIKI_DUMP_ROOT: o.pfad },
                ladeZuweisungen: lade,
            });
            expect(ergebnis["befunde"]).toEqual(expect.arrayContaining([{ code: "kategorien_abstand", tage: 39 }]));
            const kontext = context({ bereiche: ["weg"] });
            const ohne = await runWikiVorschauJob(kontext, {
                environment: { WIKI_DUMP_ROOT: o.pfad },
                ladeZuweisungen: lade,
            });
            expect(kontext.phasen).not.toContain("kategorien_lesen");
            expect(ohne["quelle"]).toMatchObject({ kategorien: null });
            expect(JSON.stringify(ohne["befunde"])).not.toContain("kategorien");
        } finally {
            await o.weg();
        }
    });

    it("dieselbe Datei ergibt dieselben Zeilen (Wiederholung)", async () => {
        const o = await mitDatei();
        try {
            const zeilen: unknown[] = [];
            for (let lauf = 0; lauf < 2; lauf += 1) {
                const abgelegt: Abgelegt[] = [];
                await runWikiVorschauJob(context({ bereiche: ["ort"] }), {
                    environment: { WIKI_DUMP_ROOT: o.pfad },
                    ladeZuweisungen: lade,
                    ablage: ablageMit([gareth()], abgelegt),
                });
                zeilen.push(abgelegt[0]!.plan.zeilen);
            }
            expect(zeilen[1]).toEqual(zeilen[0]);
        } finally {
            await o.weg();
        }
    });
});

const wiki = (pfad: string): string => `https://de.wiki-aventurica.de/wiki/${pfad}`;
const zuweisung = (art: string, extra: Partial<Zuweisung>): Zuweisung => ({
    art,
    wikiUrl: null,
    wikiTitel: null,
    ns: null,
    istWeiterleitung: false,
    ...extra,
});

const ZUWEISUNGEN: Zuweisung[] = [
    zuweisung("siedlung", { wikiUrl: wiki("Gareth"), wikiTitel: "Gareth", ns: 0 }),
    zuweisung("siedlung", {
        wikiUrl: wiki("Reichsstadt_Gareth"),
        wikiTitel: "Reichsstadt Gareth",
        ns: 0,
        istWeiterleitung: true,
    }),
    zuweisung("siedlung", { wikiUrl: wiki("Inoffiziell%3AApfeldorn"), wikiTitel: "Inoffiziell:Apfeldorn", ns: 222 }),
    zuweisung("siedlung", { wikiUrl: wiki("Gibt_es_nicht"), wikiTitel: "Gibt es nicht", ns: 0 }),
    zuweisung("siedlung", { wikiUrl: wiki("gareth"), ns: 0 }),
    zuweisung("siedlung", { wikiUrl: wiki("Gareth"), ns: 222 }),
    zuweisung("weg", { wikiUrl: wiki("Reichsstrasse_1"), wikiTitel: "Reichsstrasse 1", ns: 0 }),
    // Eigenkennungen: ein Titel ohne Adresse, nichts, eine fremde Adresse, ein Wirt, der nur so aussieht.
    zuweisung("weg", { wikiTitel: "Reichsstrasse 1" }),
    zuweisung("gebiet", {}),
    zuweisung("gebiet", { wikiUrl: "https://www.garetien.de/wiki/Gareth", wikiTitel: "Gareth" }),
    zuweisung("landschaft", {
        wikiUrl: "https://de.wiki-aventurica.de.angreifer.example/wiki/Gareth",
        wikiTitel: "Gareth",
    }),
];

let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
let env: NodeJS.ProcessEnv;
const bzip2 = findeBzip2();

beforeAll(async () => {
    ordner = await neuerOrdner("wiki-jobs-test");
    await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(SEITEN));
    env = { WIKI_DUMP_ROOT: ordner.pfad, ...(bzip2 === null ? {} : { WIKI_BZIP2_PFAD: bzip2 }) };
});
afterAll(async () => {
    await ordner.weg();
});

describe("WikiSync-Jobarten: Katalog und Einstufung", () => {
    it("🔴 beide sind bekannte Arten der Queue mit Handler, LEICHT, ohne Sperre der Domäne und ohne Speicherschlüssel", () => {
        for (const art of ["wiki_dump_einlesen", "wiki_vorschau"]) {
            const spec = JOB_KIND_CATALOG[art];
            expect(spec, art).toMatchObject({
                kind: art,
                version: 1,
                origin: "queued",
                holdsSharedDomainLock: false,
                threads: 1,
            });
            expect(knowsKind(art, 1), art).toBe(true);
            expect(JOB_HANDLERS[art], art).toBeTypeOf("function");
            expect(spec?.memoryKey({}, null), art).toBeNull();
            expect(expectedMemoryMb(spec!, {}, null, testJobsConfig(), null), art).toBe(0);
            expect(claimsSlot(art), art).toBe(true);
            expect(LEICHTE_ARTEN.has(art), art).toBe(true);
            expect(istSchwer(art), art).toBe(false);
        }
    });

    it("die Einstellungen: Dump-Ordner, Takt-Ordner, bzip2 und Zugangsdatei; der Dump-Ordner lokal (Windows) mit Vorgabe, der Takt nie", () => {
        expect(wikiKonfiguration({}, "win32")).toEqual({
            dumpWurzel: "C:/avesmaps3d-data/wiki-dump",
            // 🔴 Keine Vorgabe für den Takt, auch lokal nicht: ohne Ordner geht keine Wiki-Anfrage hinaus.
            taktWurzel: undefined,
            bzip2: "bzip2",
            zugangsdatei: undefined,
        });
        expect(wikiKonfiguration({}, "linux")).toMatchObject({ dumpWurzel: undefined, taktWurzel: undefined });
        expect(
            wikiKonfiguration(
                {
                    WIKI_DUMP_ROOT: " /srv/wiki ",
                    WIKI_TAKT_ROOT: "/srv/takt",
                    WIKI_BZIP2_PFAD: "/usr/bin/bzip2",
                    WIKI_BOT_ZUGANG_DATEI: "/etc/wiki.json",
                },
                "linux",
            ),
        ).toEqual({
            dumpWurzel: "/srv/wiki",
            taktWurzel: "/srv/takt",
            bzip2: "/usr/bin/bzip2",
            zugangsdatei: "/etc/wiki.json",
        });
    });

    it("die Eingabe wird streng geprüft: höchstens `datei`, ein Text", () => {
        expect(leseDumpEingabe({})).toEqual({ datei: undefined });
        expect(leseDumpEingabe({ datei: "a.xml" })).toEqual({ datei: "a.xml" });
        for (const kaputt of [{ datei: 5 }, { datei: "a.xml", ordner: "/" }, { umgebung: "production" }]) {
            expect(() => leseDumpEingabe(kaputt as Record<string, unknown>)).toThrowError(JobFailure);
        }
    });
});

/** Eine Tafel der Umgebung mit Revision, wie der Auftrag sie liest: Kategorie (14) als Inhaltsraum, Ilaris (444) darf Kartenobjekte liefern. */
const UMGEBUNGSTAFEL: JobTafel = {
    revision: 7,
    quelle: "datenbank",
    namensraeume: wikiNamespaceTafel([
        { ns: 14, praefix: "Kategorie", kanon: "inoffiziell", einsammeln: false, bezeichner: "Kat" },
        { ns: 444, praefix: "Ilaris", kanon: "inoffiziell", einsammeln: true, bezeichner: "Wiki Aventurica" },
    ]),
};

describe("wiki_dump_einlesen", () => {
    it("🔴 legt Manifest und Zählungen je Namensraum als Ergebnis ab; Räume ohne Zeile in der Vorgabe sind ein Befund mit Nummer und Zahl", async () => {
        const kontext = context({});
        const ergebnis = await runWikiDumpEinlesenJob(kontext, { environment: env });
        expect(kontext.phasen).toEqual(["lesen"]);
        expect(ergebnis["manifest"]).toMatchObject({
            datei: "dewa_dump_small_20261001.xml",
            stand: { wert: "2026-10-01", quelle: "dateiname" },
            vollstaendig: true,
            seiten: 8,
            weiterleitungen: 1,
        });
        const manifest = ergebnis["manifest"] as { sha256: string; namensraeume: { nr: number; seiten: number }[] };
        expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(manifest.namensraeume.map((raum) => [raum.nr, raum.seiten])).toEqual([
            [0, 2],
            [10, 1],
            [14, 2],
            [220, 1],
            [222, 1],
            [444, 1],
        ]);
        expect(ergebnis["befunde"]).toEqual([
            { code: "namensraum_unbekannt", nr: 10, name: null, seiten: 1 },
            { code: "namensraum_unbekannt", nr: 14, name: "Kategorie", seiten: 2 },
        ]);
    });

    it("🔴 Manifest und Befunde lesen die Tafel der UMGEBUNG, nicht die Vorgabe, und nennen ihre Revision", async () => {
        const ergebnis = await runWikiDumpEinlesenJob(context({}), {
            environment: env,
            ladeTafel: () => Promise.resolve(UMGEBUNGSTAFEL),
        });
        const raeume = (
            ergebnis["manifest"] as {
                namensraeume: { nr: number; inTafel: boolean; kanon: string | null; traegtKartenobjekte: boolean }[];
            }
        ).namensraeume;
        const raum = (nr: number) => raeume.find((eintrag) => eintrag.nr === nr);
        // 14 steht in dieser Umgebung in der Tafel (Vorgabe: nein), 444 sammelt Kartenobjekte (Vorgabe: nein).
        expect(raum(14)).toMatchObject({ inTafel: true, kanon: "inoffiziell", traegtKartenobjekte: false });
        expect(raum(444)).toMatchObject({ inTafel: true, kanon: "inoffiziell", traegtKartenobjekte: true });
        expect(raum(10)).toMatchObject({ inTafel: false, kanon: null });
        expect(ergebnis["befunde"]).toEqual([{ code: "namensraum_unbekannt", nr: 10, name: null, seiten: 1 }]);
        expect(ergebnis["tafel"]).toEqual({ revision: 7, quelle: "datenbank" });
        // Ohne Datenbank im Auftrag gilt die Vorgabe, mit Revision null.
        const ohne = await runWikiDumpEinlesenJob(context({}), { environment: env });
        expect(ohne["tafel"]).toEqual({ revision: null, quelle: "vorgabe" });
    });

    it.skipIf(bzip2 === null)(
        "liest auch die gepackte Datei (über bzip2) und nimmt ohne Namen die jüngste im Ordner",
        async () => {
            const gepackt = await neuerOrdner("wiki-jobs-bz2");
            try {
                const xml = join(gepackt.pfad, "roh.xml");
                await writeFile(xml, baueDump(SEITEN));
                await packeBz2(bzip2 as string, xml, join(gepackt.pfad, "dewa_dump_small.xml.bz2"));
                const ergebnis = await runWikiDumpEinlesenJob(context({ datei: "dewa_dump_small.xml.bz2" }), {
                    environment: { WIKI_DUMP_ROOT: gepackt.pfad, WIKI_BZIP2_PFAD: bzip2 as string },
                });
                expect(ergebnis["manifest"]).toMatchObject({
                    datei: "dewa_dump_small.xml.bz2",
                    seiten: 8,
                    vollstaendig: true,
                });
            } finally {
                await gepackt.weg();
            }
        },
    );

    it("🔴 ein abgeschnittener Dump liefert das Manifest MIT dem Befund dump_unvollstaendig, nicht als kleiner Dump", async () => {
        const abgeschnitten = await neuerOrdner("wiki-jobs-abgeschnitten");
        try {
            await writeFile(join(abgeschnitten.pfad, "dump.xml"), baueDump(SEITEN, { abgeschnitten: true }));
            const ergebnis = await runWikiDumpEinlesenJob(context({}), {
                environment: { WIKI_DUMP_ROOT: abgeschnitten.pfad },
            });
            expect(ergebnis["manifest"]).toMatchObject({ vollstaendig: false });
            expect((ergebnis["befunde"] as { code: string }[])[0]).toEqual({ code: "dump_unvollstaendig" });
        } finally {
            await abgeschnitten.weg();
        }
    });

    it("kein Ordner, keine Datei, ein Pfad statt eines Namens: der Auftrag scheitert mit klarem Code und ohne Wiederholung", async () => {
        const leer = await jobFehler(
            runWikiDumpEinlesenJob(context({}), { environment: { WIKI_DUMP_ROOT: join(ordner.pfad, "nicht-da") } }),
        );
        expect([leer.code, leer.retryable]).toEqual(["dump_fehlt", false]);
        const pfad = await jobFehler(runWikiDumpEinlesenJob(context({ datei: "../x.xml" }), { environment: env }));
        expect([pfad.code, pfad.retryable]).toEqual(["datei_ungueltig", false]);
        const unbekannt = await jobFehler(
            runWikiDumpEinlesenJob(context({ datei: "gibt-es-nicht.xml" }), { environment: env }),
        );
        expect(unbekannt.code).toBe("dump_fehlt");
        // Ohne jede Meldung eines Pfades auf der Statusseite.
        for (const fehler of [leer, pfad, unbekannt]) expect(fehler.message).not.toContain(ordner.pfad);
    });
});

describe("wiki_vorschau: der Vergleich (rein)", () => {
    it("die Adresse hinter dem Titel: beide Formen des Wikis, einmal dekodiert, nur Adressen des Wikis", () => {
        expect(titelAusWikiAdresse(wiki("Reichsstadt_Gareth"))).toBe("Reichsstadt Gareth");
        expect(titelAusWikiAdresse(wiki("Inoffiziell%3AApfeldorn#Geschichte"))).toBe("Inoffiziell:Apfeldorn");
        expect(titelAusWikiAdresse(wiki("Inoffiziell:Trutzbach/Zollhaus"))).toBe("Inoffiziell:Trutzbach/Zollhaus");
        expect(titelAusWikiAdresse("https://de.wiki-aventurica.de/de/index.php?title=Gareth_(Stadt)&action=raw")).toBe(
            "Gareth (Stadt)",
        );
        // Genau EINMAL dekodiert: %253A ist der Text „%3A“, kein Doppelpunkt.
        expect(titelAusWikiAdresse(wiki("Inoffiziell%253AApfeldorn"))).toBe("Inoffiziell%3AApfeldorn");
        for (const keine of [
            null,
            "",
            "gareth",
            "/wiki/Gareth",
            "ftp://de.wiki-aventurica.de/wiki/Gareth",
            "https://www.garetien.de/wiki/Gareth",
            "https://de.wiki-aventurica.de.angreifer.example/wiki/Gareth",
            "https://xwiki-aventurica.de/wiki/Gareth",
            "https://de.wiki-aventurica.de/wiki/",
            "https://de.wiki-aventurica.de/",
        ]) {
            expect(titelAusWikiAdresse(keine), String(keine)).toBeNull();
        }
    });

    it("🔴 ohne Wiki-Adresse sucht eine Zuweisung gar nichts im Dump (auch nicht über den gespeicherten Titel allein)", () => {
        expect(gesuchteTitel(zuweisung("weg", { wikiTitel: "Reichsstrasse 1" }))).toEqual([]);
        expect(gesuchteTitel(zuweisung("gebiet", {}))).toEqual([]);
        expect(gesuchteTitel(zuweisung("siedlung", { wikiUrl: wiki("gareth"), wikiTitel: "Gareth" }))).toEqual([
            "gareth",
            "Gareth",
        ]);
    });

    it("🔴 die Zahlen: nur Zuweisungen mit Adresse werden gegen den Dump geprüft, Eigenkennungen zählen nie als „nicht im Dump“, je Art getrennt", () => {
        const gesucht = new Set(ZUWEISUNGEN.flatMap(gesuchteTitel));
        const dump = {
            seiten: 8,
            vollstaendig: true,
            kopf: null,
            neuesteRevision: null,
            namensraeume: new Map<number, number>(),
            gefunden: new Map(
                SEITEN.filter((seite) => gesucht.has(seite.titel)).map((seite) => [
                    seite.titel,
                    { ns: seite.ns, weiterleitung: seite.weiterleitung ?? null },
                ]),
            ),
        };
        const zahlen = berechneVorschau(ZUWEISUNGEN, dump);
        expect(zahlen).toMatchObject({
            zuweisungen: 11,
            mitAdresse: 7,
            kennungOhneWikiAdresse: 4,
            gefunden: 4,
            umgeleitet: 1,
            umgeleitetBereitsVermerkt: 1,
            nichtImDump: 2,
            namensraumAbweichend: 1,
        });
        // Die Summen gehen auf.
        expect(zahlen.mitAdresse).toBe(zahlen.gefunden + zahlen.umgeleitet + zahlen.nichtImDump);
        expect(zahlen.zuweisungen).toBe(zahlen.mitAdresse + zahlen.kennungOhneWikiAdresse);
        expect(zahlen.nachArt).toEqual({
            siedlung: {
                zuweisungen: 6,
                mitAdresse: 6,
                kennungOhneWikiAdresse: 0,
                gefunden: 4,
                umgeleitet: 1,
                nichtImDump: 1,
            },
            weg: {
                zuweisungen: 2,
                mitAdresse: 1,
                kennungOhneWikiAdresse: 1,
                gefunden: 0,
                umgeleitet: 0,
                nichtImDump: 1,
            },
            gebiet: {
                zuweisungen: 2,
                mitAdresse: 0,
                kennungOhneWikiAdresse: 2,
                gefunden: 0,
                umgeleitet: 0,
                nichtImDump: 0,
            },
            landschaft: {
                zuweisungen: 1,
                mitAdresse: 0,
                kennungOhneWikiAdresse: 1,
                gefunden: 0,
                umgeleitet: 0,
                nichtImDump: 0,
            },
        });
    });
});

describe("wiki_vorschau: der Auftrag", () => {
    const lade = (): Promise<Zuweisung[]> => Promise.resolve(ZUWEISUNGEN);

    it("🔴 liefert nur Zahlen und Befunde: Quelle mit Prüfsumme, Zahlen je Art, unbekannte Namensräume; schreibt und ruft nichts", async () => {
        const kontext = context({});
        const ergebnis = await runWikiVorschauJob(kontext, { environment: env, ladeZuweisungen: lade });
        // Ohne Kategorien-Datei im Ordner gelingt die Vorschau trotzdem (WI-0294): Die Phase `kategorien_lesen` entfällt, ein Befund sagt es.
        expect(kontext.phasen).toEqual(["zuweisungen", "kategorien", "dump", "vergleichen"]);
        expect(ergebnis["quelle"]).toMatchObject({
            datei: "dewa_dump_small_20261001.xml",
            stand: { wert: "2026-10-01", quelle: "dateiname" },
            seiten: 8,
        });
        expect((ergebnis["quelle"] as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(ergebnis["zahlen"]).toMatchObject({
            zuweisungen: 11,
            mitAdresse: 7,
            nichtImDump: 2,
            kennungOhneWikiAdresse: 4,
            umgeleitet: 1,
            gefunden: 4,
        });
        // Räume, die die Vorgabe nicht kennt, mit Nummer und Zahl der Seiten (Befund, kein Fehler).
        expect(ergebnis["befunde"]).toEqual([
            { code: "namensraum_unbekannt", nr: 10, name: null, seiten: 1 },
            { code: "namensraum_unbekannt", nr: 14, name: "Kategorie", seiten: 2 },
            { code: "kategorien_datei_fehlt" },
        ]);
        expect(ergebnis["quelle"]).toMatchObject({ kategorien: null });
        // Das Ergebnis enthält keine Texte und keine Kennungen der Objekte, nur Zahlen.
        expect(JSON.stringify(ergebnis)).not.toContain("Hauptstadt");
        // C: Ohne Datenbank im Auftrag und ohne Ablage entsteht kein Lauf (die Läufe liegen in der Datenbank), die Zahlen der Zuweisungen gibt es trotzdem.
        expect(ergebnis["lauf"]).toBeNull();
    });

    it("C und D-1: die Eingabe der Vorschau – Datei, Bereiche, Auslöser – wird streng geprüft, ein unbekanntes Feld (auch das frühere legacyBereiche: den Besitzer sagt der Schalter) ist ein Eingabefehler", () => {
        const alle = [
            "ort",
            "weg",
            "gebiet",
            "region",
            "gipfel",
            "kraftlinie",
            "literatur",
            "quelle",
            "vorkommen",
            "sprachen",
        ];
        expect(leseVorschauEingabe({})).toEqual({
            datei: undefined,
            bereiche: alle,
            ausgeloestVon: undefined,
        });
        expect(
            leseVorschauEingabe({
                datei: "a.xml",
                bereiche: ["weg", "ort"],
                ausgeloestVon: "Vali",
            }),
        ).toEqual({ datei: "a.xml", bereiche: ["ort", "weg"], ausgeloestVon: "Vali" });
        for (const kaputt of [
            { bereiche: [] },
            { bereiche: ["orte"] },
            { bereiche: "ort" },
            // Welche Bereiche der Legacy-Zug noch liefert, steht nicht mehr in der Eingabe (WI-0253 D-1): Das sagt der Schalter der Umgebung.
            { legacyBereiche: ["ort"] },
            { legacyBereiche: [] },
            { ausgeloestVon: "" },
            { ausgeloestVon: "x".repeat(81) },
            { datei: "../a.xml/", ordner: "/" },
            { umgebung: "production" },
        ]) {
            expect(() => leseVorschauEingabe(kaputt as Record<string, unknown>), JSON.stringify(kaputt)).toThrowError(
                JobFailure,
            );
        }
    });

    it("🔴 die Befunde der Vorschau folgen der Tafel der Umgebung, und ihre Revision steht im Ergebnis (eine andere macht die Vorschau veraltet)", async () => {
        const ergebnis = await runWikiVorschauJob(context({}), {
            environment: env,
            ladeZuweisungen: lade,
            ladeTafel: () => Promise.resolve(UMGEBUNGSTAFEL),
        });
        expect(ergebnis["befunde"]).toEqual([
            { code: "namensraum_unbekannt", nr: 10, name: null, seiten: 1 },
            { code: "kategorien_datei_fehlt" },
        ]);
        expect(ergebnis["tafel"]).toEqual({ revision: 7, quelle: "datenbank" });
        const spaeter = await runWikiVorschauJob(context({}), {
            environment: env,
            ladeZuweisungen: lade,
            ladeTafel: () => Promise.resolve({ ...UMGEBUNGSTAFEL, revision: 8 }),
        });
        expect((spaeter["tafel"] as { revision: number }).revision).not.toBe(
            (ergebnis["tafel"] as { revision: number }).revision,
        );
    });

    it("🔴 ein abgeschnittener Dump rechnet nichts: Er ließe jede Seite hinter der Bruchstelle als „nicht im Dump“ erscheinen", async () => {
        const abgeschnitten = await neuerOrdner("wiki-vorschau-abgeschnitten");
        try {
            await writeFile(join(abgeschnitten.pfad, "dump.xml"), baueDump(SEITEN, { abgeschnitten: true }));
            const fehler = await jobFehler(
                runWikiVorschauJob(context({}), {
                    environment: { WIKI_DUMP_ROOT: abgeschnitten.pfad },
                    ladeZuweisungen: lade,
                }),
            );
            expect([fehler.code, fehler.retryable]).toEqual(["dump_unvollstaendig", false]);
        } finally {
            await abgeschnitten.weg();
        }
    });

    it("kein Dump im Ordner: der Auftrag scheitert vor jeder Datenbankabfrage", async () => {
        let gefragt = false;
        const fehler = await jobFehler(
            runWikiVorschauJob(context({}), {
                environment: { WIKI_DUMP_ROOT: join(ordner.pfad, "nicht-da") },
                ladeZuweisungen: () => {
                    gefragt = true;
                    return lade();
                },
            }),
        );
        expect(fehler.code).toBe("dump_fehlt");
        expect(gefragt).toBe(false);
    });
});

describeWithDatabase("wiki_vorschau: die gespeicherten Zuweisungen aus der Testdatenbank", { timeout: 60_000 }, () => {
    let database: Database;
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns, is_redirect)
            VALUES
              ('siedlung', ${ids[0] as string}, 'wiki:gareth', 'https://de.wiki-aventurica.de/wiki/Gareth', 'Gareth', 0, false),
              ('weg', ${ids[1] as string}, 'wiki:inoffiziell-apfeldorn', 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Apfeldorn', 'Inoffiziell:Apfeldorn', 222, true),
              ('gebiet', ${ids[2] as string}, 'wiki:eigene-kennung', NULL, NULL, NULL, false)
        `;
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, is_active, retired_at, retired_origin)
            VALUES ('siedlung', ${ids[3] as string}, 'wiki:stillgelegt', 'https://de.wiki-aventurica.de/wiki/Stillgelegt', false, now(), 'import')
        `;
    });
    afterAll(async () => {
        await database`DELETE FROM wiki_key_assignment WHERE object_public_id = ANY(${ids}::uuid[])`;
        await database.end({ timeout: 5 });
    });

    it("liest die aktiven Zuweisungen mit Art, Adresse, Titel, Namensraum und Weiterleitungsvermerk, ohne Key und ohne Objektkennung", async () => {
        const alle = await ladeZuweisungen(database);
        const unsere = alle.filter(
            (zeile) =>
                zeile.wikiUrl?.includes("Gareth") === true ||
                zeile.wikiUrl?.includes("Apfeldorn") === true ||
                zeile.art === "gebiet",
        );
        expect(unsere).toContainEqual({
            art: "siedlung",
            wikiUrl: wiki("Gareth"),
            wikiTitel: "Gareth",
            ns: 0,
            istWeiterleitung: false,
        });
        expect(unsere).toContainEqual({
            art: "weg",
            wikiUrl: wiki("Inoffiziell:Apfeldorn"),
            wikiTitel: "Inoffiziell:Apfeldorn",
            ns: 222,
            istWeiterleitung: true,
        });
        expect(unsere).toContainEqual({
            art: "gebiet",
            wikiUrl: null,
            wikiTitel: null,
            ns: null,
            istWeiterleitung: false,
        });
        // Stillgelegtes fehlt, und kein Feld der Zeilen trägt einen Key oder eine Kennung.
        expect(alle.some((zeile) => zeile.wikiUrl?.includes("Stillgelegt") === true)).toBe(false);
        expect(Object.keys(alle[0] ?? {}).sort()).toEqual(["art", "istWeiterleitung", "ns", "wikiTitel", "wikiUrl"]);
    });
});

describe("die harte Sperre für echte Wiki-Abrufe", () => {
    const echt = { AVESMAPS_ENV: "staging", RELEASE_ID: "r-2026-10-25", WIKI_TAKT_ROOT: "/srv/wiki-takt" };

    it("🔴 erlaubt nur Stage oder Production mit echtem Release und benanntem Takt-Ordner", () => {
        expect(wikiAbrufErlaubt(echt)).toEqual({ erlaubt: true });
        expect(wikiAbrufErlaubt({ ...echt, AVESMAPS_ENV: "production" })).toEqual({ erlaubt: true });
        const grund = (env: NodeJS.ProcessEnv) => {
            const urteil = wikiAbrufErlaubt(env);
            return urteil.erlaubt ? null : urteil.grund;
        };
        // Der Entwicklungsrechner: nichts gesetzt, oder der Ordner gesetzt, aber keine Umgebung.
        expect(grund({})).toBe("umgebung");
        expect(grund({ WIKI_TAKT_ROOT: "/x" })).toBe("umgebung");
        for (const umgebung of ["development", "test", "Staging", ""]) {
            expect(grund({ ...echt, AVESMAPS_ENV: umgebung }), umgebung).toBe("umgebung");
        }
        // Production-Name, aber kein echtes Release (ein lokaler Server mit AVESMAPS_ENV=production).
        expect(grund({ ...echt, AVESMAPS_ENV: "production", RELEASE_ID: "dev" })).toBe("release");
        const ohneRelease: NodeJS.ProcessEnv = { ...echt };
        delete ohneRelease["RELEASE_ID"];
        expect(grund(ohneRelease)).toBe("release");
        // Echtes Release, aber kein Takt-Ordner.
        expect(grund({ ...echt, WIKI_TAKT_ROOT: "  " })).toBe("takt");
    });

    it("🔴 lokal wirft der Client-Erzeuger, ohne dass eine Anfrage entsteht; mit eigenem Testserver (apiUrl) bleibt er nutzbar", () => {
        let angefragt = 0;
        const fetchStub = ((): Promise<Response> => {
            angefragt += 1;
            return Promise.reject(new Error("darf nie geschehen"));
        }) as typeof fetch;
        for (const environment of [{}, { AVESMAPS_ENV: "development" }, { ...echt, RELEASE_ID: "dev" }]) {
            let fehler: unknown;
            try {
                erzeugeWikiClient({ taktVerzeichnis: "/x", environment, fetch: fetchStub });
            } catch (error) {
                fehler = error;
            }
            expect(fehler).toBeInstanceOf(WikiTransportFehler);
            expect((fehler as WikiTransportFehler).code).toBe("abruf_gesperrt");
        }
        expect(angefragt).toBe(0);
        // Stage mit echtem Release: der Erzeuger gibt einen Client her (er fragt auch dann nichts, bevor jemand ihn ruft).
        expect(() => erzeugeWikiClient({ taktVerzeichnis: "/x", environment: echt, fetch: fetchStub })).not.toThrow();
        // Ein Test, der einen eigenen Server meint, ist nicht berührt.
        expect(() =>
            erzeugeWikiClient({
                taktVerzeichnis: "/x",
                environment: {},
                apiUrl: "http://127.0.0.1:1/api.php",
                fetch: fetchStub,
            }),
        ).not.toThrow();
        expect(angefragt).toBe(0);
    });
});
