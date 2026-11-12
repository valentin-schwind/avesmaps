import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { WIKI_LINK_TABLES, importWikiLinkTargets } from "../src/migration/wiki-link-targets-import.ts";
import { crossFindings, transformAssignments, transformLinkTargets } from "../src/migration/wiki-link-targets.ts";
import { verifyWikiLinkTargets } from "../src/migration/verify-wiki-link-targets.ts";
import { x1Payload, x2Payload, type X1Spec, type X2Spec } from "./support/wiki-link-fixture.ts";

/**
 * Legacys zwei lesende Exporte X1 (Linkziele je ARTIKEL und Feld) und X2 (Zuordnungstafel Wiki-Key → Objekt) (WI-0063 27.12, Migration 0073, Vertrag
 * `wiki-link-targets.yaml`): erst die reine Umwandlung an Legacys eigenen Beispielantworten (`docs/wiki-linkziele-export.md`, Legacy-Commit `04a85a54f`,
 * Dump-Lauf 155 vom 08.09.2026, abgeschrieben und gekürzt), dann Import, Idempotenz, Ersetzen und Stilllegen, Teilsätze und der Prüfer gegen echtes
 * PostgreSQL. Kein Abruf: die Antworten sind Konstanten.
 */

const link = (
    anzeige: string,
    ziel: string,
    key: string,
    extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
    anzeige,
    ziel,
    art: "wikilink",
    ns: 0,
    ns_name: "",
    ziel_key: key,
    ...extra,
});

/** `{{Pol|X}}` oder `{{Reg|X}}`: Ziel X, `art` `vorlage`. */
const template = (name: "Pol" | "Reg", target: string, key: string): Record<string, unknown> =>
    link(target, target, key, { art: "vorlage", vorlage: name });

// ---- Legacys Beispiele (je Artikel), wörtlich ----------------------------------------------------------------------------------------------------

const GARETH = {
    wiki_key: "wiki:gareth",
    ns: 0,
    ns_name: "",
    seite_art: "settlement",
    seite_titel: "Gareth",
    felder: {
        region: [template("Reg", "Herz des Kontinents", "wiki:herz-des-kontinents")],
        staat: [
            template("Pol", "Baronie Raulsmark", "wiki:baronie-raulsmark"),
            link("Reichsstadt", "Reichsstadt", "wiki:reichsstadt"),
            link("Alt-Gareth", "Alt-Gareth", "wiki:alt-gareth"),
        ],
        oberhaupt: [
            link("Kaiser", "Kaiser", "wiki:kaiser"),
            link("Rohaja von Gareth", "Rohaja von Gareth", "wiki:rohaja-von-gareth"),
            link("Thorn Eisinger", "Thorn Eisinger", "wiki:thorn-eisinger"),
        ],
        verkehrswege: [
            link("Reichsstraßen 2", "Reichsstraße 2", "wiki:reichsstrasse-2"),
            link("3", "Reichsstraße 3", "wiki:reichsstrasse-3"),
            link("Gardel", "Gardel", "wiki:gardel"),
        ],
    },
};

/** Ein Weg in 56 Abschnitten steht in X1 EINMAL: die Abschnitte nennt X2. */
const REICHSSTRASSE_2 = {
    wiki_key: "wiki:reichsstrasse-2",
    ns: 0,
    ns_name: "",
    seite_art: "path",
    seite_titel: "Reichsstraße 2",
    felder: {
        lage: [
            link("Weiden", "Weiden", "wiki:weiden"),
            link("Darpatien", "Darpatien", "wiki:darpatien"),
            link("Garetien", "Herz des Kontinents", "wiki:herz-des-kontinents"),
        ],
        verlauf: [
            link("Seeweg", "Seeweg", "wiki:seeweg"),
            link("Trallop", "Trallop", "wiki:trallop"),
            link("Alte Straße", "Alte Straße", "wiki:alte-strasse"),
        ],
    },
};

const SCHWARZKUPPEN = {
    wiki_key: "wiki:schwarzkuppen",
    ns: 0,
    ns_name: "",
    seite_art: "region",
    seite_titel: "Schwarzkuppen",
    felder: {
        region: [link("Finsterkamm", "Finsterkamm", "wiki:finsterkamm")],
        staat: [link("Grafschaft Heldentrutz", "Grafschaft Heldentrutz", "wiki:grafschaft-heldentrutz")],
        nachbar_n: [link("Gashoker Steppe", "Gashoker Steppe", "wiki:gashoker-steppe")],
        nachbar_no: [
            link("Nebelmoor", "Nebelmoor", "wiki:nebelmoor"),
            link("Neunaugensee", "Neunaugensee", "wiki:neunaugensee"),
        ],
    },
};

const HEXAGRAMM = {
    wiki_key: "wiki:elementares-hexagramm",
    ns: 0,
    ns_name: "",
    seite_art: "powerline",
    seite_titel: "Elementares Hexagramm",
    felder: {
        regionen: [
            link("Finsterkamm", "Finsterkamm", "wiki:finsterkamm"),
            link("Koschberge", "Koschberge", "wiki:koschberge"),
            // „Ambossberge“ ist eine Weiterleitung: der Key ist der der Zielseite.
            link("Ambossberge", "Ambossberge", "wiki:ambossgebirge", {
                weiterleitung_auf: { wiki_key: "wiki:ambossgebirge", titel: "Ambossgebirge", ns: 0, ns_name: "" },
            }),
        ],
        verlauf: [
            link("Unsichtbarer Turm", "Unsichtbarer Turm", "wiki:unsichtbarer-turm"),
            link("Luft", "Luft", "wiki:luft"),
        ],
    },
};

const AMMERNRODEN = {
    wiki_key: "wiki:inoffiziell-ammernroden",
    ns: 222,
    ns_name: "Inoffiziell",
    seite_art: "settlement",
    seite_titel: "Inoffiziell:Ammernroden",
    felder: {
        region: [link("Weiden", "Weiden", "wiki:weiden")],
        nachbar_n: [
            link("Sinopje", "Inoffiziell:Sinopje", "wiki:inoffiziell-sinopje", { ns: 222, ns_name: "Inoffiziell" }),
        ],
        nachbar_nw: [
            link("Kuffertal", "Inoffiziell:Kuffertal", "wiki:inoffiziell-kuffertal", {
                ns: 222,
                ns_name: "Inoffiziell",
            }),
        ],
    },
};

const X1_KOPF = {
    objekte_je_art: {},
    objekte_ohne_schluessel: 0,
    artikel: {
        mit_wikitext: 3056,
        felder_befuellt: 18666,
        felder_mit_link: 17313,
        links_gesamt: 26611,
        links_pipe: 2620,
        links_vorlage: 889,
        ziele_verschieden: 4656,
        ziele_mit_kartenobjekt: 3306,
        ziele_ohne_kartenobjekt: 1350,
    },
    haeufigste_ziele_ohne_kartenobjekt: [{ ziel_key: "wiki:nordaventurien", ziel: "Nordaventurien", links: 112 }],
    vorlagen_in_feldern: { Reichsstadt: 24, Pol: 10 },
    seiten_schluesselkollision: 0,
};

/** X1 aus Legacys Beispielen; der Kopf trägt Legacys Zähler des vollen Dumps. */
function x1Doc(
    artikel: unknown[] = [AMMERNRODEN, GARETH, HEXAGRAMM, REICHSSTRASSE_2, SCHWARZKUPPEN],
    over: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        ok: true,
        map_revision: 164000,
        ecosystem_revision: 141459,
        territories_revision: "pt-x",
        aliase_stempel: "ra-x",
        dump: { run_id: 155, abgeschlossen: "2026-09-08 04:00:00" },
        kopf: X1_KOPF,
        artikel,
        ohne_wikitext: [],
        ...over,
    };
}

const X2_ROWS = [
    {
        public_id: "80558060-4299-54aa-b520-814b10819885",
        art: "siedlung",
        feature_type: "location",
        feature_subtype: "metropole",
        wiki_url: "https://de.wiki-aventurica.de/wiki/Gareth",
        wiki_key: "wiki:gareth",
        wiki_titel: "Gareth",
        ns: 0,
        ns_name: "",
    },
    {
        public_id: "c3b931c5-4a21-51e8-8bf7-076676cfecc5",
        art: "weg",
        feature_type: "path",
        feature_subtype: "Reichsstrasse",
        wiki_url: "https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_2",
        wiki_key: "wiki:reichsstrasse-2",
        wiki_titel: "Reichsstraße 2",
        ns: 0,
        ns_name: "",
    },
    {
        public_id: "ca4054dc-ec9c-5500-bae7-7c5e956d33a2",
        art: "siedlung",
        feature_type: "location",
        feature_subtype: "dorf",
        wiki_url: "https://de.wiki-aventurica.de/wiki/Inoffiziell%3AKleewiesen",
        wiki_key: "wiki:inoffiziell-kleewiesen",
        wiki_titel: "Inoffiziell:Kleewiesen",
        ns: 222,
        ns_name: "Inoffiziell",
    },
    {
        public_id: "5268482e-c2f5-4b67-8f3b-669905e18917",
        art: "gebiet",
        gebietsart: "Tá'akîb",
        wiki_url: "https://de.wiki-aventurica.de/wiki/Inoffiziell%3AT%C3%A1y%C3%A2rret",
        wiki_key: "wiki:inoffiziell-t-y-rret",
        wiki_titel: "Inoffiziell:Táyârret",
        ns: 222,
        ns_name: "Inoffiziell",
    },
];

function x2Doc(objekte: unknown[] = X2_ROWS, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ok: true,
        map_revision: 164000,
        ecosystem_revision: 141459,
        territories_revision: "pt-x",
        aliase_stempel: "ra-x",
        kopf: {
            objekte_mit_zuweisung: objekte.length,
            objekte_ohne_schluessel: 0,
            verschiedene_schluessel: objekte.length,
            je_art: {
                siedlung: { zugewiesen: 2, ohne_zuweisung: 912 },
                weg: { zugewiesen: 1, ohne_zuweisung: 4101 },
                gebiet: { zugewiesen: 1, ohne_zuweisung: 726 },
            },
        },
        objekte,
        ...over,
    };
}

const codes = (findings: readonly { code: string }[]): string[] => findings.map((finding) => finding.code);
const find = <T extends { code: string }>(findings: readonly T[], code: string): T | undefined =>
    findings.find((finding) => finding.code === code);

describe("Umwandlung von X2 (Zuordnungstafel)", () => {
    it("🔴 Legacys Beispiele: Key und Namensraum wörtlich, der Namensraum ist Teil des Keys, `ns` null bleibt null", () => {
        const result = transformAssignments(x2Doc());
        expect(result.skipped).toBe(false);
        expect(result.rows).toEqual([
            {
                art: "siedlung",
                publicId: "80558060-4299-54aa-b520-814b10819885",
                wikiKey: "wiki:gareth",
                wikiUrl: "https://de.wiki-aventurica.de/wiki/Gareth",
                wikiTitle: "Gareth",
                ns: 0,
                nsName: "",
                isRedirect: false,
                redirectTitle: null,
                redirectNs: null,
                redirectNsName: null,
            },
            expect.objectContaining({ art: "weg", wikiKey: "wiki:reichsstrasse-2", wikiTitle: "Reichsstraße 2" }),
            expect.objectContaining({ wikiKey: "wiki:inoffiziell-kleewiesen", ns: 222, nsName: "Inoffiziell" }),
            expect.objectContaining({
                art: "gebiet",
                wikiKey: "wiki:inoffiziell-t-y-rret",
                wikiTitle: "Inoffiziell:Táyârret",
            }),
        ]);
        expect(result.withoutAssignment).toEqual({ siedlung: 912, weg: 4101, gebiet: 726 });
        expect(result.stamps).toEqual({
            mapRevision: 164000,
            ecosystemRevision: 141459,
            territoriesRevision: "pt-x",
            aliasStamp: "ra-x",
        });
    });

    it("ein Objekt ohne Wiki-Adresse (nur ein gespeicherter Key) trägt `ns` null: ein Namensraum wird nicht aus dem Slug geraten", () => {
        const result = transformAssignments(
            x2Doc([
                {
                    public_id: "5268482e-c2f5-4b67-8f3b-669905e18917",
                    art: "gebiet",
                    wiki_url: null,
                    wiki_key: "wiki:elf-volk",
                    wiki_titel: null,
                    ns: null,
                    ns_name: null,
                },
            ]),
        );
        expect(result.rows[0]).toMatchObject({
            wikiKey: "wiki:elf-volk",
            wikiUrl: null,
            wikiTitle: null,
            ns: null,
            nsName: null,
        });
        expect(codes(result.findings)).not.toContain("x2_namespace_unknown");
    });

    it("eine Weiterleitung trägt Titel und Namensraum der Zielseite (null, wo Legacys Dump sie nicht kennt)", () => {
        const result = transformAssignments(
            x2Doc([
                {
                    ...X2_ROWS[0],
                    wiki_key: "wiki:ambossgebirge",
                    weiterleitung_auf: { wiki_key: "wiki:ambossgebirge", titel: null, ns: null, ns_name: null },
                },
                {
                    ...X2_ROWS[1],
                    wiki_key: "wiki:inoffiziell-x",
                    weiterleitung_auf: {
                        wiki_key: "wiki:inoffiziell-x",
                        titel: "Inoffiziell:X",
                        ns: 222,
                        ns_name: "Inoffiziell",
                    },
                },
            ]),
        );
        expect(result.rows[0]).toMatchObject({
            isRedirect: true,
            redirectTitle: null,
            redirectNs: null,
            redirectNsName: null,
        });
        expect(result.rows[1]).toMatchObject({
            isRedirect: true,
            redirectTitle: "Inoffiziell:X",
            redirectNs: 222,
            redirectNsName: "Inoffiziell",
        });
        expect(find(result.findings, "x2_redirect")?.objectCount).toBe(2);
    });

    it("🔴 eine unbrauchbare oder leere Antwort schreibt nichts: source_block_missing, source_empty_catalog (kein Tor)", () => {
        for (const payload of [
            null,
            "x",
            [],
            { ok: false, objekte: X2_ROWS },
            { ok: true },
            { ok: true, objekte: "nein" },
        ]) {
            const result = transformAssignments(payload);
            expect(result.skipped, JSON.stringify(payload)).toBe(true);
            expect(result.rows).toEqual([]);
            expect(codes(result.findings)).toEqual(["source_block_missing"]);
        }
        const empty = transformAssignments({ ok: true, objekte: [] });
        expect(empty.skipped).toBe(true);
        expect(codes(empty.findings)).toEqual(["source_empty_catalog"]);
    });

    it("🔴 ein Objekt ohne Key wird nicht gespeichert und nie aus Adresse oder Name geraten; doppelte und unbrauchbare Objekte werden gemeldet", () => {
        const result = transformAssignments(
            x2Doc([
                X2_ROWS[0],
                { ...X2_ROWS[1], wiki_key: null },
                { ...X2_ROWS[0], wiki_key: "wiki:gareth-zwei" },
                { public_id: "kein-uuid", art: "siedlung", wiki_key: "wiki:x" },
                { public_id: X2_ROWS[2]?.public_id, art: "unbekannt", wiki_key: "wiki:x" },
            ]),
        );
        expect(result.rows.map((row) => row.wikiKey)).toEqual(["wiki:gareth"]);
        expect(find(result.findings, "x2_object_without_key")?.objectCount).toBe(1);
        expect(find(result.findings, "x2_object_duplicate")?.objectCount).toBe(1);
        expect(find(result.findings, "x2_object_unusable")?.objectCount).toBe(2);
    });

    it("der Kopf, der andere Zahlen nennt als die Objekte, ist ein Befund (Information)", () => {
        const result = transformAssignments(
            x2Doc(X2_ROWS, {
                kopf: {
                    objekte_mit_zuweisung: 9,
                    verschiedene_schluessel: 9,
                    je_art: { siedlung: { zugewiesen: 5, ohne_zuweisung: 0 } },
                },
            }),
        );
        const finding = find(result.findings, "x2_kopf_abweichung");
        expect(finding?.notes).toEqual([
            "siedlung: Kopf 5, gelesen 2",
            "gesamt: Kopf 9, gelesen 4",
            "verschiedene Keys: Kopf 9, gelesen 4",
        ]);
    });
});

describe("Umwandlung von X1 (Linkziele je Artikel)", () => {
    it("🔴 Legacys Beispiele: eine Seite je Key, die Links je Feld in der Reihenfolge des Quelltextes, rohes Ziel UND kanonischer Key", () => {
        const result = transformLinkTargets(x1Doc());
        expect(result.skipped).toBe(false);
        expect(result.pages.map((page) => [page.pageKey, page.pageKind, page.ns, page.nsName])).toEqual([
            ["wiki:inoffiziell-ammernroden", "settlement", 222, "Inoffiziell"],
            ["wiki:gareth", "settlement", 0, ""],
            ["wiki:elementares-hexagramm", "powerline", 0, ""],
            ["wiki:reichsstrasse-2", "path", 0, ""],
            ["wiki:schwarzkuppen", "region", 0, ""],
        ]);
        const verkehrswege = result.targets.filter(
            (target) => target.pageKey === "wiki:gareth" && target.field === "verkehrswege",
        );
        expect(verkehrswege.map((t) => [t.position, t.displayText, t.targetRaw, t.targetKey, t.linkArt])).toEqual([
            [0, "Reichsstraßen 2", "Reichsstraße 2", "wiki:reichsstrasse-2", "wikilink"],
            [1, "3", "Reichsstraße 3", "wiki:reichsstrasse-3", "wikilink"],
            [2, "Gardel", "Gardel", "wiki:gardel", "wikilink"],
        ]);
    });

    it("🔴 {{Pol|X}} im Staat und {{Reg|X}} in der Region sind Links: `art` vorlage, der Name der Vorlage, Ziel X, in der Reihenfolge des Quelltextes vor [[Reichsstadt]]", () => {
        const result = transformLinkTargets(x1Doc());
        const staat = result.targets.filter((target) => target.pageKey === "wiki:gareth" && target.field === "staat");
        expect(staat.map((t) => [t.position, t.displayText, t.linkArt, t.linkTemplate, t.targetKey])).toEqual([
            [0, "Baronie Raulsmark", "vorlage", "Pol", "wiki:baronie-raulsmark"],
            [1, "Reichsstadt", "wikilink", null, "wiki:reichsstadt"],
            [2, "Alt-Gareth", "wikilink", null, "wiki:alt-gareth"],
        ]);
        const region = result.targets.filter((target) => target.pageKey === "wiki:gareth" && target.field === "region");
        expect(region).toHaveLength(1);
        expect(region[0]).toMatchObject({
            linkArt: "vorlage",
            linkTemplate: "Reg",
            targetKey: "wiki:herz-des-kontinents",
        });
    });

    it("🔴 der Namensraum bleibt: ein „Inoffiziell:“-Ziel trägt `ns` 222, das rohe Ziel behält das Präfix, der Key das Präfix im Slug", () => {
        const result = transformLinkTargets(x1Doc());
        const sinopje = result.targets.find((target) => target.displayText === "Sinopje");
        expect(sinopje).toMatchObject({
            field: "nachbar_n",
            targetRaw: "Inoffiziell:Sinopje",
            targetKey: "wiki:inoffiziell-sinopje",
            targetNs: 222,
            targetNsName: "Inoffiziell",
        });
        expect(
            result.targets.find((target) => target.displayText === "Weiden" && target.field === "region"),
        ).toMatchObject({
            targetNs: 0,
            targetNsName: "",
        });
        expect(result.pages.find((page) => page.pageKey === "wiki:inoffiziell-ammernroden")).toMatchObject({
            pageTitle: "Inoffiziell:Ammernroden",
            ns: 222,
            nsName: "Inoffiziell",
        });
    });

    it("🔴 eine Weiterleitung („Ambossberge“) trägt den Key der Zielseite und ihre Angaben", () => {
        const result = transformLinkTargets(x1Doc());
        const amboss = result.targets.find((target) => target.displayText === "Ambossberge");
        expect(amboss).toMatchObject({
            targetRaw: "Ambossberge",
            targetKey: "wiki:ambossgebirge",
            isRedirect: true,
            redirectTitle: "Ambossgebirge",
            redirectNs: 0,
            redirectNsName: "",
        });
        expect(result.targets.find((target) => target.displayText === "Koschberge")).toMatchObject({
            isRedirect: false,
            redirectTitle: null,
        });
    });

    it("ein Weg mit vielen Abschnitten steht EINMAL da: der Artikel ist die Einheit, kein Objekt kommt vor", () => {
        const result = transformLinkTargets(x1Doc([REICHSSTRASSE_2]));
        expect(result.pages).toHaveLength(1);
        expect(result.targets).toHaveLength(6);
        expect(codes(result.findings)).not.toContain("x1_article_duplicate");
    });

    it("kommt ein Key doppelt vor (ein Fehler in Legacy), gilt der erste Artikel und der Befund nennt den zweiten", () => {
        const changed = { ...REICHSSTRASSE_2, felder: { lage: [link("Weiden", "Weiden", "wiki:weiden")] } };
        const result = transformLinkTargets(x1Doc([REICHSSTRASSE_2, changed, REICHSSTRASSE_2]));
        expect(result.pages).toHaveLength(1);
        expect(result.targets).toHaveLength(6);
        const finding = find(result.findings, "x1_article_duplicate");
        expect(finding?.objectCount).toBe(2);
        expect(finding?.objects.map((object) => object.name)).toEqual([
            "Reichsstraße 2 (anderer Inhalt)",
            "Reichsstraße 2",
        ]);
    });

    it("🔴 ein Link ohne Key, mit unbekannter Art oder eine Vorlage ohne Namen wird nicht gespeichert und nie aus dem Anzeigetext geraten", () => {
        const broken = {
            ...GARETH,
            felder: {
                verkehrswege: [
                    link("Reichsstraßen 2", "Reichsstraße 2", "wiki:reichsstrasse-2"),
                    { anzeige: "Gardel", ziel: "Gardel", art: "wikilink", ns: 0, ns_name: "" },
                    link("Garether", "Gardel", ""),
                    link("Magisch", "Magisch", "wiki:magisch", { art: "zauber" }),
                    link("Ohne Namen", "Ohne Namen", "wiki:ohne-namen", { art: "vorlage" }),
                    link("Mit Namen", "Mit Namen", "wiki:mit-namen", { vorlage: "Pol" }),
                    link("Gardel", "Gardel", "wiki:gardel"),
                ],
            },
        };
        const result = transformLinkTargets(x1Doc([broken]));
        expect(result.targets.map((target) => [target.position, target.displayText])).toEqual([
            [0, "Reichsstraßen 2"],
            [1, "Gardel"],
        ]);
        expect(find(result.findings, "x1_link_unusable")?.numbers).toEqual({ links: 5 });
    });

    it("andere Vorlagen sind keine Links: der Kopf zählt sie, der Befund hält sie sichtbar", () => {
        const finding = find(transformLinkTargets(x1Doc()).findings, "x1_vorlagen_keine_links");
        expect(finding?.numbers).toEqual({ Reichsstadt: 24, Pol: 10 });
        expect(finding?.message).toContain("nur {{Pol|X}} im Staat und {{Reg|X}} in der Region zählen");
    });

    it("Keys ohne Wikitext stehen mit Grund und Zahl der Objekte im Befund, nie als leere Felder", () => {
        const result = transformLinkTargets(
            x1Doc([GARETH], {
                ohne_wikitext: [
                    { wiki_key: "wiki:al-ghunar", grund: "seite_nicht_im_dump", objekte: 1 },
                    { wiki_key: "wiki:ardism-r", grund: "seitenart_ohne_felder", objekte: 2 },
                ],
            }),
        );
        const finding = find(result.findings, "x1_ohne_wikitext");
        expect(finding?.numbers).toEqual({ seite_nicht_im_dump: 1, seitenart_ohne_felder: 1 });
        expect(finding?.objectCount).toBe(2);
        expect(result.missing).toEqual([
            { wikiKey: "wiki:al-ghunar", reason: "seite_nicht_im_dump", objects: 1 },
            { wikiKey: "wiki:ardism-r", reason: "seitenart_ohne_felder", objects: 2 },
        ]);
        expect(result.pages.map((page) => page.pageKey)).toEqual(["wiki:gareth"]);
    });

    it("ein Feld außerhalb der Positivliste wird gespeichert, wie geliefert, und gemeldet (kein Tor)", () => {
        const withExtra = {
            ...GARETH,
            felder: { ...GARETH.felder, derographie: [link("Weiden", "Weiden", "wiki:weiden")] },
        };
        const result = transformLinkTargets(x1Doc([withExtra]));
        expect(result.targets.some((target) => target.field === "derographie")).toBe(true);
        expect(find(result.findings, "x1_field_unknown")?.notes).toEqual(["settlement.derographie: 1 Artikel"]);
    });

    it("🔴 eine unbrauchbare oder leere Antwort schreibt nichts (die Liste heißt `artikel`, nicht mehr `objekte`)", () => {
        for (const payload of [
            null,
            {},
            { ok: false, artikel: [GARETH] },
            { ok: true, artikel: null },
            { ok: true, objekte: [GARETH] },
        ]) {
            expect(transformLinkTargets(payload).skipped, JSON.stringify(payload)).toBe(true);
        }
        expect(codes(transformLinkTargets({ ok: true, artikel: [] }).findings)).toEqual(["source_empty_catalog"]);
    });

    it("der Kopf zählt je Artikel: weicht er von den gelesenen Seiten ab, ist das ein Befund", () => {
        const finding = find(transformLinkTargets(x1Doc()).findings, "x1_kopf_abweichung");
        // Legacys Zähler stehen für den vollen Dump; die gekürzten Beispiele tragen weniger.
        expect(finding?.notes.some((note) => note.startsWith("links_gesamt: Kopf 26611, gelesen "))).toBe(true);
        expect(finding?.notes.some((note) => note.startsWith("links_vorlage: Kopf 889, gelesen 2"))).toBe(true);
    });

    it("stimmt der Kopf, ist nichts zu melden", () => {
        const full = x1Payload([
            {
                key: "wiki:gareth",
                kind: "settlement",
                title: "Gareth",
                felder: {
                    staat: [
                        { anzeige: "Baronie X", key: "wiki:baronie-x", art: "vorlage", vorlage: "Pol" },
                        { anzeige: "Reichsstadt", key: "wiki:reichsstadt" },
                    ],
                },
            },
        ]);
        expect(codes(transformLinkTargets(full).findings)).toEqual([]);
    });
});

describe("Die zwei Antworten eines Zuges gegeneinander", () => {
    it("gleiche Stände und jeder Artikel von X1 an einem Key der Zuordnung, jeder Key der Zuordnung gelesen oder als ohne Wikitext genannt: nichts zu melden", () => {
        const links = transformLinkTargets(
            x1Doc([GARETH, REICHSSTRASSE_2], {
                ohne_wikitext: [{ wiki_key: "wiki:inoffiziell-kleewiesen", grund: "seite_nicht_im_dump", objekte: 1 }],
            }),
        );
        const assignments = transformAssignments(x2Doc());
        // Das Gebiet braucht keinen Artikel: X1 führt keine Gebiets-Infobox.
        expect(codes(crossFindings(links, assignments))).toEqual([]);
    });

    it("andere Stände, ein Artikel ohne Zuordnung und ein Key ohne Artikel sind Befunde, nie ein Tor", () => {
        const links = transformLinkTargets(x1Doc([GARETH, SCHWARZKUPPEN], { map_revision: 164001 }));
        const assignments = transformAssignments(x2Doc());
        const findings = crossFindings(links, assignments);
        expect(codes(findings)).toEqual(["x1_x2_stand", "x1_article_not_in_x2", "x2_key_without_article"]);
        expect(findings[0]?.numbers).toEqual({ mapRevision: "164001 / 164000" });
        expect(findings[1]?.objects.map((object) => object.publicId)).toEqual(["wiki:schwarzkuppen"]);
        // Die Reichsstraße und Kleewiesen haben keinen Artikel (das Gebiet ist ausgenommen).
        expect(findings[2]?.objects.map((object) => object.publicId)).toEqual([
            "wiki:reichsstrasse-2",
            "wiki:inoffiziell-kleewiesen",
        ]);
    });

    it("fehlt eine Antwort, gibt es nichts zu vergleichen", () => {
        expect(crossFindings(transformLinkTargets(null), transformAssignments(x2Doc()))).toEqual([]);
    });
});

// ---- gegen echtes PostgreSQL --------------------------------------------------------------------------------------------------------------------

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Die Objekte dieser Datei: eigene Kennungen und Keys, damit die Aufräumarbeit genau sie trifft. */
const tid = (n: number): string => `73000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const tkey = (slug: string): string => `wiki:t73-${slug}`;

const ASSIGNMENTS: X2Spec[] = [
    { art: "siedlung", id: tid(1), key: tkey("gareth") },
    { art: "weg", id: tid(2), key: tkey("reichsstrasse-2") },
    { art: "weg", id: tid(3), key: tkey("reichsstrasse-2") },
    { art: "gebiet", id: tid(4), key: tkey("inoffiziell-x"), ns: 222, nsName: "Inoffiziell" },
    { art: "kraftlinie", id: tid(5), key: tkey("hexagramm"), redirect: { titel: "Hexagramm", ns: 0, nsName: "" } },
];
const PAGES: X1Spec[] = [
    {
        key: tkey("gareth"),
        kind: "settlement",
        title: "Gareth",
        felder: {
            staat: [
                { anzeige: "Baronie X", key: tkey("baronie-x"), art: "vorlage", vorlage: "Pol" },
                { anzeige: "Reichsstadt", key: tkey("reichsstadt") },
            ],
            verkehrswege: [
                { anzeige: "2", ziel: "Reichsstraße 2", key: tkey("reichsstrasse-2") },
                { anzeige: "Gardel", key: tkey("gardel") },
            ],
        },
    },
    {
        // Ein Weg mit zwei Abschnitten in X2: ein Artikel in X1.
        key: tkey("reichsstrasse-2"),
        kind: "path",
        title: "Reichsstraße 2",
        felder: { lage: [{ anzeige: "Weiden", key: tkey("weiden") }] },
    },
    {
        key: tkey("hexagramm"),
        kind: "powerline",
        title: "Hexagramm",
        felder: {
            regionen: [
                {
                    anzeige: "Ambossberge",
                    key: tkey("ambossgebirge"),
                    redirect: { titel: "Ambossgebirge", ns: 0, nsName: "" },
                },
            ],
        },
    },
    // Ein Artikel ohne Links: gelesen, nichts verlinkt.
    { key: tkey("leer"), kind: "settlement", title: "Leer", felder: {} },
];

describeWithDatabase("Import und Prüfer der Wiki-Linkziele und der Zuordnung gegen PostgreSQL (WI-0063 27.12)", () => {
    let database: Database;

    async function clean(): Promise<void> {
        await database`DELETE FROM wiki_settlement_traffic_link WHERE snapshot_id IN (SELECT id FROM wiki_settlement_snapshot WHERE wiki_key LIKE 't73-%')`;
        await database`DELETE FROM wiki_settlement_snapshot WHERE wiki_key LIKE 't73-%'`;
        await database`DELETE FROM wiki_link_target WHERE page_id IN (SELECT id FROM wiki_link_page WHERE page_key LIKE 'wiki:t73-%')`;
        await database`DELETE FROM wiki_link_page WHERE page_key LIKE 'wiki:t73-%'`;
        await database`DELETE FROM wiki_key_assignment WHERE object_public_id::text LIKE '73000000-%'`;
        await database`
            DELETE FROM migration_run WHERE data_domain = 'wiki-link-targets'
              AND NOT EXISTS (SELECT 1 FROM wiki_key_assignment WHERE migration_run_id = migration_run.id)
              AND NOT EXISTS (SELECT 1 FROM wiki_link_page WHERE migration_run_id = migration_run.id)
        `;
    }

    const input = (assignments = ASSIGNMENTS, pages = PAGES): { zuordnung: unknown; linkziele: unknown } => ({
        zuordnung: x2Payload(assignments),
        linkziele: x1Payload(pages),
    });
    const written = (report: Awaited<ReturnType<typeof importWikiLinkTargets>>): number =>
        WIKI_LINK_TABLES.reduce(
            (sum, name) =>
                sum + report.tables[name].created + report.tables[name].updated + report.tables[name].retired,
            0,
        );
    const count = async (table: string, where = "TRUE"): Promise<number> =>
        Number(
            (await database.unsafe<{ n: string }[]>(`SELECT count(*)::text AS n FROM ${table} WHERE ${where}`))[0]?.n,
        );

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    }, 120_000);

    beforeEach(clean);

    afterAll(async () => {
        await clean();
        await database.end({ timeout: 5 });
    });

    it("🔴 der erste Lauf legt Zuordnung, Artikel und Links an; ein Artikel je Key, Kinder in der Reihenfolge des Quelltextes samt Art der Links", async () => {
        const report = await importWikiLinkTargets(database, input());
        expect(report.skipped).toEqual({ linkziele: false, zuordnung: false });
        expect(report.tables.wiki_key_assignment).toMatchObject({ created: 5, updated: 0, retired: 0 });
        // Vier Artikel: der Weg mit zwei Abschnitten in X2 ist EIN Artikel.
        expect(report.tables.wiki_link_page).toMatchObject({ created: 4, updated: 0, retired: 0 });
        expect(report.tables.wiki_link_target).toMatchObject({ created: 6, retired: 0 });
        expect(report.stats).toMatchObject({ assignments: 5, distinctKeys: 4, pages: 4, links: 6 });
        expect(report.changed).toBe(true);
        expect(await count("wiki_key_assignment", "is_active AND object_public_id::text LIKE '73000000-%'")).toBe(5);

        const rows = await database<
            {
                field: string;
                position: number;
                display_text: string;
                link_art: string;
                link_template: string | null;
                target_raw: string;
                target_key: string;
            }[]
        >`
            SELECT t.field, t.position, t.display_text, t.link_art, t.link_template, t.target_raw, t.target_key
            FROM wiki_link_target t JOIN wiki_link_page p ON p.id = t.page_id
            WHERE p.page_key = ${tkey("gareth")} ORDER BY t.field, t.position
        `;
        expect(
            rows.map((row) => [
                row.field,
                row.position,
                row.display_text,
                row.link_art,
                row.link_template,
                row.target_raw,
                row.target_key,
            ]),
        ).toEqual([
            ["staat", 0, "Baronie X", "vorlage", "Pol", "Baronie X", tkey("baronie-x")],
            ["staat", 1, "Reichsstadt", "wikilink", null, "Reichsstadt", tkey("reichsstadt")],
            ["verkehrswege", 0, "2", "wikilink", null, "Reichsstraße 2", tkey("reichsstrasse-2")],
            ["verkehrswege", 1, "Gardel", "wikilink", null, "Gardel", tkey("gardel")],
        ]);
        const [leer] = await database<{ n: string }[]>`
            SELECT count(*)::text AS n FROM wiki_link_page p JOIN wiki_link_target t ON t.page_id = p.id WHERE p.page_key = ${tkey("leer")}
        `;
        expect(leer?.n).toBe("0");
        expect(await count("wiki_link_page", `page_key = '${tkey("leer")}' AND is_active`)).toBe(1);
        // Der Namensraum bleibt in der Zuordnung, die Weiterleitung auch.
        const [gebiet] = await database<{ ns: number; ns_name: string }[]>`
            SELECT ns, ns_name FROM wiki_key_assignment WHERE object_public_id = ${tid(4)}::uuid
        `;
        expect(gebiet).toEqual({ ns: 222, ns_name: "Inoffiziell" });
        const [linie] = await database<{ is_redirect: boolean; redirect_title: string | null }[]>`
            SELECT is_redirect, redirect_title FROM wiki_key_assignment WHERE object_public_id = ${tid(5)}::uuid
        `;
        expect(linie).toEqual({ is_redirect: true, redirect_title: "Hexagramm" });
    });

    it("🔴 der zweite Lauf mit denselben Antworten schreibt nichts (Idempotenz)", async () => {
        await importWikiLinkTargets(database, input());
        const again = await importWikiLinkTargets(database, input());
        expect(written(again)).toBe(0);
        expect(again.changed).toBe(false);
        expect(again.tables.wiki_key_assignment.unchanged).toBe(5);
        expect(again.tables.wiki_link_page.unchanged).toBe(4);
        expect(again.tables.wiki_link_target.unchanged).toBe(6);
    });

    it("ändert sich der Satz der Links eines Artikels, wird er ERSETZT, nie angehäuft; ein Link, den Legacy aus dem Feld nimmt, verschwindet", async () => {
        await importWikiLinkTargets(database, input());
        const changed: X1Spec[] = PAGES.map((page) =>
            page.key === tkey("gareth")
                ? {
                      ...page,
                      felder: {
                          verkehrswege: [
                              { anzeige: "Gardel", key: tkey("gardel") },
                              { anzeige: "2", ziel: "Reichsstraße 2", key: tkey("reichsstrasse-2") },
                              { anzeige: "Neu", key: tkey("neu") },
                          ],
                      },
                  }
                : page,
        );
        const report = await importWikiLinkTargets(database, input(ASSIGNMENTS, changed));
        expect(report.tables.wiki_link_target).toMatchObject({ created: 3, retired: 4, unchanged: 2 });
        expect(report.tables.wiki_link_page.unchanged).toBe(4);
        const rows = await database<{ position: number; display_text: string }[]>`
            SELECT t.position, t.display_text FROM wiki_link_target t JOIN wiki_link_page p ON p.id = t.page_id
            WHERE p.page_key = ${tkey("gareth")} ORDER BY t.field, t.position
        `;
        expect(rows.map((row) => row.display_text)).toEqual(["Gardel", "2", "Neu"]);
    });

    it("was ein späterer Satz nicht mehr nennt, wird stillgelegt (nie gelöscht) und kommt mit dem Befund `row_reappeared` zurück", async () => {
        await importWikiLinkTargets(database, input());
        const smaller = await importWikiLinkTargets(
            database,
            input(
                ASSIGNMENTS.filter((row) => row.id !== tid(3)),
                PAGES.filter((page) => page.key !== tkey("hexagramm")),
            ),
        );
        expect(smaller.tables.wiki_key_assignment.retired).toBe(1);
        expect(smaller.tables.wiki_link_page.retired).toBe(1);
        expect(
            await count(
                "wiki_key_assignment",
                `object_public_id = '${tid(3)}'::uuid AND NOT is_active AND retired_origin = 'import'`,
            ),
        ).toBe(1);
        expect(await count("wiki_link_page", `page_key = '${tkey("hexagramm")}' AND NOT is_active`)).toBe(1);
        const back = await importWikiLinkTargets(database, input());
        expect(back.tables.wiki_key_assignment.reappeared).toBe(1);
        expect(codes(back.findings)).toContain("row_reappeared");
        expect(await count("wiki_key_assignment", "object_public_id::text LIKE '73000000-%' AND NOT is_active")).toBe(
            0,
        );
    });

    it("🔴 ohne Zuruf rechnet der Probelauf nur: nichts geschrieben, auch kein Journal", async () => {
        const before = await count("migration_run", "data_domain = 'wiki-link-targets'");
        const report = await importWikiLinkTargets(database, input(), { dryRun: true });
        expect(report.dryRun).toBe(true);
        expect(report.tables.wiki_key_assignment.created).toBe(5);
        expect(await count("wiki_key_assignment", "object_public_id::text LIKE '73000000-%'")).toBe(0);
        expect(await count("migration_run", "data_domain = 'wiki-link-targets'")).toBe(before);
    });

    it("🔴 die Teile sind unabhängig: fehlt X1 oder ist sie unbrauchbar, bleibt alles von X1, X2 läuft; nichts wird stillgelegt", async () => {
        await importWikiLinkTargets(database, input());
        const bad = await importWikiLinkTargets(database, {
            zuordnung: x2Payload(ASSIGNMENTS),
            linkziele: { ok: false },
        });
        expect(bad.skipped).toEqual({ linkziele: true, zuordnung: false });
        expect(codes(bad.findings)).toContain("source_block_missing");
        expect(written(bad)).toBe(0);
        const without = await importWikiLinkTargets(database, { zuordnung: x2Payload(ASSIGNMENTS) });
        expect(without.skipped.linkziele).toBe(true);
        expect(await count("wiki_link_page", "page_key LIKE 'wiki:t73-%' AND is_active")).toBe(4);
        // Beide fehlen: gar kein Lauf, kein Journal.
        const before = await count("migration_run", "data_domain = 'wiki-link-targets'");
        const none = await importWikiLinkTargets(database, { linkziele: null, zuordnung: { ok: true, objekte: [] } });
        expect(none.skipped).toEqual({ linkziele: true, zuordnung: true });
        expect(await count("migration_run", "data_domain = 'wiki-link-targets'")).toBe(before);
        expect(await count("wiki_key_assignment", "object_public_id::text LIKE '73000000-%' AND is_active")).toBe(5);
    });

    it("jeder Lauf schreibt sein Journal mit den Zahlen und den Codes der Befunde", async () => {
        const report = await importWikiLinkTargets(database, input());
        const [run] = await database<
            { data_domain: string; status: string; journal: { tables: Record<string, unknown>; findings: string[] } }[]
        >`
            SELECT data_domain, status, journal FROM migration_run WHERE id = ${report.runId}::uuid
        `;
        expect(run?.data_domain).toBe("wiki-link-targets");
        expect(run?.status).toBe("completed");
        // jsonb ordnet die Schlüssel selbst (nach Länge, dann Name): verglichen wird die Menge.
        expect(Object.keys(run?.journal.tables ?? {}).sort()).toEqual([...WIKI_LINK_TABLES].sort());
        expect(Array.isArray(run?.journal.findings)).toBe(true);
    });

    it("die Datenbank hält die Art der Links zusammen: eine Vorlage braucht ihren Namen, ein Wikilink hat keinen", async () => {
        await importWikiLinkTargets(database, input());
        const [page] = await database<
            { id: string }[]
        >`SELECT id::text FROM wiki_link_page WHERE page_key = ${tkey("gareth")}`;
        const insert = (art: string, name: string | null): Promise<unknown> =>
            database`
                INSERT INTO wiki_link_target (page_id, field, position, display_text, link_art, link_template, target_raw, target_key, target_ns, target_ns_name)
                VALUES (${page?.id as string}, 'tempel', 0, 'X', ${art}, ${name}, 'X', 'wiki:t73-x', 0, '')
            `;
        await expect(insert("vorlage", null)).rejects.toThrow(/wiki_link_target_art_known/);
        await expect(insert("wikilink", "Pol")).rejects.toThrow(/wiki_link_target_art_known/);
        await expect(insert("zauber", null)).rejects.toThrow(/wiki_link_target_art_known/);
    });

    describe("Prüfer", () => {
        it("🔴 bestanden: Zahlen, Spalte für Spalte, Reihenfolge, Struktur; die Auflösung wird mit dem echten Lookup gezählt", async () => {
            await importWikiLinkTargets(database, input());
            const report = await verifyWikiLinkTargets(database, input());
            expect(report.skipped).toBe(false);
            expect(report.passed).toBe(true);
            expect(report.checks.map((entry) => [entry.name, entry.passed])).toEqual([
                ["counts", true],
                ["assignment_rows", true],
                ["page_rows", true],
                ["target_rows", true],
                ["order", true],
                ["structure", true],
                ["resolution", true],
            ]);
            const resolution = report.checks.find((entry) => entry.name === "resolution");
            // Die Testobjekte sind keine Träger: kein Link trifft ein Objekt der Karte.
            expect(resolution?.detail).toContain("6 Links aller Seiten: 0 treffen genau ein Objekt");
            // Die Objekte der Zuordnung gibt es bei uns nicht als Ziel: Befund, kein Tor.
            expect(codes(report.findings)).toContain("x2_object_not_on_map");
            expect(codes(report.findings)).toContain("x1_ziele_ohne_kartenobjekt");
        });

        it("🔴 eine abgeänderte Zeile fällt auf, ohne dass der Lauf anhält (keine fremden Tore)", async () => {
            await importWikiLinkTargets(database, input());
            await database`UPDATE wiki_link_target SET target_key = 'wiki:t73-falsch' WHERE target_key = ${tkey("gardel")}`;
            await database`UPDATE wiki_key_assignment SET wiki_key = 'wiki:t73-falsch' WHERE object_public_id = ${tid(1)}::uuid`;
            const report = await verifyWikiLinkTargets(database, input());
            expect(report.passed).toBe(true);
            const failed = report.checks.filter((entry) => !entry.passed);
            expect(failed.map((entry) => entry.name)).toEqual(["assignment_rows", "target_rows"]);
            expect(failed.every((entry) => entry.blocking === false)).toBe(true);
            expect(failed[1]?.offenders?.[0]).toContain("target_key");
        });

        it("🔴 die alte Verkehrswege-Tafel steht als Befund, nicht als Tor: was X1 nicht trägt, bleibt sichtbar", async () => {
            // Die alte Tafel kennt zwei Links eines Ortes; X1 trägt „2“ → Reichsstraße 2, nicht aber „Garether“ → Gardel.
            const [snapshot] = await database<{ id: string }[]>`
                INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title) VALUES ('t73-gareth', 'https://de.wiki-aventurica.de/wiki/T73_Gareth', 'T73 Gareth')
                RETURNING id::text
            `;
            await database`
                INSERT INTO wiki_settlement_traffic_link (snapshot_id, position, link_text, path_name)
                VALUES (${snapshot?.id as string}, 0, '2', 'Reichsstraße 2'), (${snapshot?.id as string}, 1, 'Garether', 'Gardel')
            `;
            await importWikiLinkTargets(database, input());
            const report = await verifyWikiLinkTargets(database, input());
            const traffic = report.findings.find((finding) => finding.code === "traffic_link_not_in_x1");
            expect(traffic?.numbers).toEqual({ alt: 2, enthalten: 1, fehlend: 1, ohne_seite: 0 });
            expect(report.passed).toBe(true);
        });

        it("ohne Antworten gibt es nichts zu prüfen", async () => {
            const report = await verifyWikiLinkTargets(database, { linkziele: null, zuordnung: { ok: false } });
            expect(report.skipped).toBe(true);
            expect(report.checks).toEqual([]);
        });

        it("keine Tabelle trägt entity_type oder JSON (Struktur)", async () => {
            const columns = await database<{ table_name: string; column_name: string }[]>`
                SELECT table_name, column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = ANY(${[...WIKI_LINK_TABLES]}::text[])
                  AND (column_name = 'entity_type' OR data_type IN ('json', 'jsonb'))
            `;
            expect(columns).toEqual([]);
        });
    });
});
