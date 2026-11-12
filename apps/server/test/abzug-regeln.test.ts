import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbzugPlan, istSichererMedienPfad, type AbzugRegeln } from "@avesmaps3d/shared";
import { leseKatalog, type Katalog } from "../src/abzug/katalog.ts";
import { baueAbzugPlan, ladeFolge, platzhalterFuer, pruefeRegeln, psqlSkript } from "../src/abzug/plan.ts";
import {
    ladeRegeln,
    mitgenommeneTafeln,
    parseRegeln,
    regelnPruefsumme,
    type GeladeneRegeln,
} from "../src/abzug/regeln.ts";
import { listeTar, tarStrom, tarText } from "../src/abzug/tar.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { tarBytes } from "./support/abzug-export.ts";

/**
 * Der Wächter des Abzugs (WI-0251): `config/abzug/regeln.json` gegen das Schema nach allen Migrationen.
 *
 * Problemfälle: eine neue Tafel ohne Eintrag (rot), eine genannte Tafel oder Spalte, die es nicht gibt, eine Spalte, die nicht leer werden darf
 * (NOT NULL, Primärschlüssel, CHECK), ein Fremdschlüssel einer mitgenommenen Tafel auf eine weggelassene, eine weggelassene Tafel, die auf Ersetztes
 * zeigt. Soll: die Datei der Regeln ist vollständig und stimmig, der Plan läuft (jeder Befehl wird einmal ausgeführt), Eltern stehen vor Kindern.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const wurzel = fileURLToPath(new URL("../../..", import.meta.url));

function kopie(regeln: AbzugRegeln): AbzugRegeln {
    return JSON.parse(JSON.stringify(regeln)) as AbzugRegeln;
}

describe("Abzug: Regeln, Reihenfolge und Tar (ohne Datenbank)", () => {
    it("die Datei der Regeln ist gültig, und die Prüfsumme kennt keine Zeilenenden", () => {
        const geladen = ladeRegeln();
        expect(Object.keys(geladen.regeln.tafeln).length).toBeGreaterThan(100);
        expect(geladen.regeln.schemataWeglassen).toHaveProperty("avesmaps_auth");
        expect(geladen.regeln.schemataWeglassen).toHaveProperty("avesmaps_kanal");
        expect(geladen.regeln.schemataWeglassen).toHaveProperty("avesmaps_ops");
        expect(regelnPruefsumme("a\r\nb\r\n")).toBe(regelnPruefsumme("a\nb\n"));
        expect(geladen.pruefsumme).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("🔴 weist kaputte Regeln ab, statt sie hinzunehmen", () => {
        expect(() => parseRegeln("{")).toThrow(/kein gültiges JSON/u);
        expect(() => parseRegeln('{"format":"anderes"}')).toThrow(/entsprechen nicht dem Schema/u);
        const kaputt = { ...ladeRegeln().regeln, tafeln: { place: { art: "mitnehmen" } } };
        expect(() => parseRegeln(JSON.stringify(kaputt))).toThrow(/entsprechen nicht dem Schema/u);
        const unbekannt = { ...ladeRegeln().regeln, tafeln: { "public.x": { art: "vielleicht" } } };
        expect(() => parseRegeln(JSON.stringify(unbekannt))).toThrow(/entsprechen nicht dem Schema/u);
        // Ohne den Block der Mediendateien sind die Regeln unvollständig.
        const ohneMedien: Record<string, unknown> = { ...ladeRegeln().regeln };
        delete ohneMedien["medien"];
        expect(() => parseRegeln(JSON.stringify(ohneMedien))).toThrow(/entsprechen nicht dem Schema/u);
    });

    it("🔴 ein Medienpfad darf den Ordner nie verlassen: nur Schlüssel der vier Speicherklassen, ohne Rückwärtsschritt, Laufwerk oder Strich", () => {
        const hash = "ab".repeat(32);
        for (const gut of [
            `published/sha256/ab/ab/${hash}.webp`,
            `private/source/sha256/ab/ab/${hash}.jpg`,
            `master/sha256/ab/ab/${hash}.png`,
            `derivatives/sha256/ab/ab/${hash}.png`,
        ]) {
            expect(istSichererMedienPfad(gut), gut).toBe(true);
        }
        for (const schlecht of [
            "",
            "/etc/passwd",
            "published/../../etc/passwd",
            "published/./a.webp",
            "published//a.webp",
            "published/a/../b.webp",
            "published\\a.webp",
            "C:/Windows/system32/x.dll",
            "c:evil.webp",
            "published/a.webp/",
            "private/evidence/sha256/ab/ab/x.pdf",
            "private/kanal/00000000-0000-0000-0000-000000000000/original.png",
            "incoming/x.webp",
            "published/.versteckt",
            "published/a b.webp",
            "published/a\u0000.webp",
            `published/${"x".repeat(260)}.webp`,
            "published",
            "../published/a.webp",
        ]) {
            expect(istSichererMedienPfad(schlecht), schlecht).toBe(false);
        }
        expect(istSichererMedienPfad(42)).toBe(false);
        expect(istSichererMedienPfad(undefined)).toBe(false);
    });

    it("lädt Eltern vor Kindern, hält Kreise beisammen und meldet sie", () => {
        const { folge, zyklen } = ladeFolge(
            ["k", "e", "a", "b", "z1", "z2"],
            [
                { von: "k", nach: "e" },
                { von: "e", nach: "a" },
                { von: "b", nach: "a" },
                { von: "z1", nach: "z2" },
                { von: "z2", nach: "z1" },
                { von: "z1", nach: "a" },
                { von: "k", nach: "k" },
                { von: "k", nach: "fremd" },
            ],
        );
        expect(zyklen).toEqual([["z1", "z2"]]);
        const nr = (name: string): number => folge.indexOf(name);
        expect(folge).toHaveLength(6);
        expect(nr("a")).toBeLessThan(nr("e"));
        expect(nr("e")).toBeLessThan(nr("k"));
        expect(nr("a")).toBeLessThan(nr("b"));
        expect(nr("a")).toBeLessThan(nr("z1"));
        expect(Math.abs(nr("z1") - nr("z2"))).toBe(1);
        // Dieselbe Eingabe, dieselbe Reihenfolge (der Plan muss stabil sein).
        expect(ladeFolge(["b", "a"], []).folge).toEqual(["a", "b"]);
    });

    it("kennt Platzhalter nur für uuid und Text", () => {
        expect(platzhalterFuer("uuid")).toBe("00000000-0000-0000-0000-000000000000");
        expect(platzhalterFuer("text")).toBe("(entfernt)");
        expect(platzhalterFuer("character varying(80)")).toBe("(entfernt)");
        expect(platzhalterFuer("bigint")).toBeNull();
    });

    it("🔴 liest Namen über 100 Zeichen in allen drei Formen: ustar-Präfix, GNU-Langname und PAX, und keinen Kopf davor oder danach falsch", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-tar-"));
        try {
            const hash = "cd".repeat(32);
            const lang = `medien/private/source/sha256/cd/cd/${hash}.jpg`; // 103 Zeichen: über dem Namensfeld
            const ohneTeilung = `medien/${"x".repeat(130)}`; // kein / zum Teilen: nur GNU oder PAX
            expect(lang.length).toBeGreaterThan(100);
            for (const form of ["auto", "prefix", "gnu", "pax"] as const) {
                const pfad = join(ordner, `${form}.tar`);
                const dateien = [
                    { name: "manifest.json", daten: Buffer.from("{}\n") },
                    { name: lang, daten: Buffer.alloc(700, 1) },
                    { name: "tafeln/public.kurz.bin", daten: Buffer.alloc(3, 2) },
                    ...(form === "prefix" ? [] : [{ name: ohneTeilung, daten: Buffer.alloc(513, 3) }]),
                    { name: "ende.bin", daten: Buffer.alloc(0) },
                ];
                writeFileSync(pfad, tarBytes(dateien, form));
                const eintraege = await listeTar(pfad);
                expect(
                    eintraege.map((e) => [e.name, e.groesse]),
                    form,
                ).toEqual(dateien.map((d) => [d.name, d.daten.length]));
                const inhalt: Buffer[] = [];
                for await (const stueck of tarStrom(pfad, eintraege[1]!)) inhalt.push(stueck as Buffer);
                expect(Buffer.concat(inhalt), form).toEqual(Buffer.alloc(700, 1));
            }
            // Eine Verknüpfung liest der Leser nicht, er sagt es.
            const link = tarBytes([{ name: "x", daten: Buffer.alloc(0) }]);
            link.write("2", 156, "latin1");
            let summe = 0;
            link.fill(32, 148, 156);
            for (const byte of link.subarray(0, 512)) summe += byte;
            link.write(`${summe.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
            const verknuepfung = join(ordner, "link.tar");
            writeFileSync(verknuepfung, link);
            await expect(listeTar(verknuepfung)).rejects.toThrow(/wird nicht gelesen/u);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("liest ein Tar mit wahlfreiem Zugriff: Namen, Größen, Inhalt, auch leere Dateien", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "abzug-tar-"));
        try {
            const pfad = join(ordner, "a.tar");
            writeFileSync(
                pfad,
                tarBytes([
                    { name: "manifest.json", daten: Buffer.from('{"a":1}\n') },
                    { name: "tafeln/public.leer.bin", daten: Buffer.alloc(0) },
                    { name: "tafeln/public.gross.bin", daten: Buffer.alloc(1300, 7) },
                ]),
            );
            const eintraege = await listeTar(pfad);
            expect(eintraege.map((e) => [e.name, e.groesse])).toEqual([
                ["manifest.json", 8],
                ["tafeln/public.leer.bin", 0],
                ["tafeln/public.gross.bin", 1300],
            ]);
            expect(await tarText(pfad, eintraege[0]!)).toBe('{"a":1}\n');
            const stuecke: Buffer[] = [];
            for await (const stueck of tarStrom(pfad, eintraege[2]!)) stuecke.push(stueck as Buffer);
            expect(Buffer.concat(stuecke)).toEqual(Buffer.alloc(1300, 7));
            const leer: Buffer[] = [];
            for await (const stueck of tarStrom(pfad, eintraege[1]!)) leer.push(stueck as Buffer);
            expect(Buffer.concat(leer).length).toBe(0);
            // Abgeschnitten oder kein Tar: ein Fehler, kein falsches Lesen.
            const abgeschnitten = join(ordner, "b.tar");
            writeFileSync(abgeschnitten, tarBytes([{ name: "x.bin", daten: Buffer.alloc(5000) }]).subarray(0, 2000));
            await expect(listeTar(abgeschnitten)).rejects.toThrow(/abgeschnitten/u);
            const text = join(ordner, "c.tar");
            writeFileSync(text, "kein Tar".repeat(200));
            await expect(listeTar(text)).rejects.toThrow(/kein Tar/u);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });
});

describeWithDatabase("Abzug: Regeln gegen das Schema (PostgreSQL)", { timeout: 120_000 }, () => {
    let db: Database;
    let katalog: Katalog;
    let geladen: GeladeneRegeln;

    beforeAll(async () => {
        db = createDatabase(testDatabaseUrl!, { max: 2 });
        await migrate(db);
        katalog = await leseKatalog(db);
        geladen = ladeRegeln();
    });

    afterAll(async () => {
        await db.end({ timeout: 5 });
    });

    it("🔴 jede Tafel nach allen Migrationen ist eingeordnet, und jede genannte Tafel und Spalte stimmt", () => {
        // Rot heißt: eine Tafel ist neu (oder fällt weg) und braucht ihre Zeile in config/abzug/regeln.json; der Text nennt sie.
        expect(pruefeRegeln(katalog, geladen.regeln).map((befund) => befund.text)).toEqual([]);
        // Der Katalog kennt die Tafeln der Anwendung, aber keine Tafel einer Erweiterung.
        expect(katalog.tafeln.has("public.place")).toBe(true);
        expect(katalog.tafeln.has("public.spatial_ref_sys")).toBe(false);
        expect(katalog.tafeln.has("avesmaps_auth.person")).toBe(true);
    });

    it("🔴 jeder Freitext einer Reisebild-Einreichung reist verdeckt: Beschreibung, Name, wartende Beschreibung und Nachricht der Redaktion (WI-0272 Review I4)", () => {
        // Freitext eines Besuchers oder der Redaktion. Eine neue Textspalte ist hier entweder Freitext (dann verdeckt) oder bekommt ihre Einordnung.
        const kein = new Set([
            "contribution_kind",
            "state",
            "reference_kind",
            "reference_key",
            "creation_kind",
            "usage_grant",
            "terms_version",
            "map_domain_id",
        ]);
        const regel = geladen.regeln.tafeln["public.media_submission"];
        expect(regel?.art).toBe("mitnehmen");
        const verdeckt = new Set(regel?.verdecken ?? []);
        const freitext = (katalog.tafeln.get("public.media_submission")?.spalten ?? [])
            .filter((spalte) => spalte.typ === "text" && !kein.has(spalte.name))
            .map((spalte) => spalte.name)
            .sort();
        expect(freitext).toEqual(["attribution_name", "description", "editor_message", "pending_description"]);
        expect(freitext.filter((name) => !verdeckt.has(name))).toEqual([]);
    });

    it("🔴 nie mit: Konten, Kanal, Betrieb, Statistik, Aufträge, Glocke, Protokolle, Sperren, Teilen-Links", () => {
        const mit = new Set(mitgenommeneTafeln(geladen.regeln));
        for (const tafel of [
            "public.job",
            "public.job_event",
            "public.job_dependency",
            "public.benachrichtigung",
            "public.system_state",
            "public.system_sample",
            "public.system_hour",
            "public.api_metric",
            "public.client_error_diagnosis",
            "public.visitor_metric",
            "public.visitor_live",
            "public.visitor_daily_seen",
            "public.map_audit_event",
            "public.map_operation",
            "public.media_audit_event",
            "public.media_operation",
            "public.editor_lock",
            "public.share_link",
            "public.media_rights_evidence",
        ]) {
            expect(mit.has(tafel), tafel).toBe(false);
            expect(katalog.tafeln.has(tafel), `${tafel} gibt es nicht mehr: Regel streichen`).toBe(true);
        }
        expect([...mit].filter((tafel) => !tafel.startsWith("public."))).toEqual([]);
        // Kartendaten kommen alle mit, auch abgeleitete Geländeergebnisse.
        for (const tafel of [
            "public.place",
            "public.path",
            "public.region",
            "public.territory",
            "public.terrain_domain_raster",
            "public.terrain_raster",
            "public.media_asset",
        ]) {
            expect(mit.has(tafel), tafel).toBe(true);
        }
    });

    it("🔴 verborgene und zurückgehaltene Bewertungen kommen nicht mit, auch ihr Text nicht (Fachkonzept §10.3)", () => {
        const tafel = baueAbzugPlan(katalog, geladen, "staging").tafeln.find((t) => t.tafel === "public.place_review");
        expect(tafel?.abfrage.endsWith(` WHERE "zustand" NOT IN ('verborgen', 'zurueckgehalten')`)).toBe(true);
        expect(tafel?.copy).toContain("NOT IN ('verborgen', 'zurueckgehalten')");
    });

    it("🔴 jeder Wächter schlägt an: neue Tafel, falscher Name, Spalte, die nicht leer werden darf, Verweise", () => {
        const befunde = (aendere: (regeln: AbzugRegeln) => void): string[] => {
            const regeln = kopie(geladen.regeln);
            aendere(regeln);
            return pruefeRegeln(katalog, regeln).map((befund) => befund.code);
        };
        expect(befunde((r) => void delete r.tafeln["public.place"])).toContain("nicht_eingeordnet");
        const auslassen = (tafel: string, spalte: string): string[] =>
            befunde((r) => {
                r.tafeln[tafel] = { ...r.tafeln[tafel]!, ohneZeilen: { spalte, nicht: ["x"] } };
            });
        expect(auslassen("public.place_review", "gibt_es_nicht")).toContain("ohne_zeilen");
        expect(auslassen("public.place", "name")).toContain("ohne_zeilen");
        // Die Mediendateien: Die Tafel muss mitkommen, die drei Spalten müssen es geben.
        expect(befunde((r) => void (r.medien.tafel = "public.media_rights_evidence"))).toContain("medien_tafel");
        expect(befunde((r) => void (r.tafeln["public.media_file"] = { art: "weglassen", grund: "Probe" }))).toContain(
            "medien_tafel",
        );
        expect(befunde((r) => void (r.medien.schluessel = "gibt_es_nicht"))).toContain("medien_spalte");
        expect(befunde((r) => void (r.medien.groesse = "variant"))).toContain("medien_spalte");
        expect(befunde((r) => void (r.tafeln["public.gibt_es_nicht"] = { art: "mitnehmen" }))).toContain(
            "unbekannte_tafel",
        );
        expect(befunde((r) => void (r.tafeln["avesmaps_auth.person"] = { art: "mitnehmen" }))).toContain(
            "schema_doppelt",
        );
        expect(
            befunde((r) => void (r.tafeln["public.place"] = { art: "mitnehmen", leeren: ["gibt_es_nicht"] })),
        ).toContain("spalte_fehlt");
        // NOT NULL, Primärschlüssel und CHECK sind keine Kandidaten fürs Leeren.
        expect(befunde((r) => void (r.tafeln["public.place"] = { art: "mitnehmen", leeren: ["name"] }))).toContain(
            "spalte_nicht_nullbar",
        );
        expect(
            befunde(
                (r) => void (r.tafeln["public.media_rights"] = { art: "mitnehmen", leeren: ["reviewed_by_person"] }),
            ),
        ).toContain("spalte_in_pruefung");
        // Verdeckt wird nur uuid und Text, nie ein Fremdschlüssel.
        expect(befunde((r) => void (r.tafeln["public.place"] = { art: "mitnehmen", verdecken: ["id"] }))).toEqual(
            expect.arrayContaining(["verdecken_typ"]),
        );
        expect(
            befunde((r) => void (r.tafeln["public.place"] = { art: "mitnehmen", verdecken: ["migration_run_id"] })),
        ).toContain("verdecken_verweis");
        expect(
            befunde(
                (r) => void (r.tafeln["public.place"] = { art: "mitnehmen", leeren: ["name"], verdecken: ["name"] }),
            ),
        ).toContain("spalte_doppelt");
        // map_domain bleibt nur, weil es als vorausgesetzt gilt; media_rights_evidence verweist auf Ersetztes und muss lokal mit geleert werden.
        expect(befunde((r) => void delete r.tafeln["public.map_domain"]!.vorausgesetzt)).toContain(
            "verweis_auf_weggelassene",
        );
        expect(befunde((r) => void delete r.tafeln["public.media_rights_evidence"]!.lokalLeeren)).toContain(
            "verweis_von_weggelassener",
        );
        expect(befunde((r) => void (r.tafeln["public.job"] = { art: "weglassen", leeren: ["actor_ref"] }))).toContain(
            "leeren_bei_weglassen",
        );
        expect(() =>
            baueAbzugPlan(
                katalog,
                {
                    ...geladen,
                    regeln: Object.assign(kopie(geladen.regeln), {
                        tafeln: Object.fromEntries(
                            Object.entries(geladen.regeln.tafeln).filter(([name]) => name !== "public.place"),
                        ),
                    }),
                },
                "staging",
            ),
        ).toThrow(/public\.place: keine Einordnung/u);
    });

    it("🔴 der Plan führt nur mit, was die Regeln sagen, in einer Reihenfolge, die lokal ladbar ist, und jeder Befehl läuft", async () => {
        const plan = baueAbzugPlan(katalog, geladen, "production");
        expect(Value.Check(AbzugPlan, plan)).toBe(true);
        expect(plan.quelle).toBe("production");
        // Die Mediendateien: welche Zeilen zu welchen Dateien führen.
        expect(plan.medien).toMatchObject({
            tafel: "public.media_file",
            verzeichnis: "medien/",
            wurzel: "MEDIA_ROOT",
            verzeichnisse: ["private/source", "master", "derivatives", "published"],
        });
        expect(plan.medien.abfrage).toBe(
            'SELECT "storage_key" AS pfad, "byte_size"::bigint AS groesse, "sha256" AS sha256 FROM "public"."media_file" ORDER BY "storage_key"',
        );
        expect(plan.tafeln.some((tafel) => tafel.tafel === "public.media_rights_evidence")).toBe(false);
        expect(plan.tafeln.map((tafel) => tafel.tafel).sort()).toEqual(mitgenommeneTafeln(geladen.regeln).sort());
        expect(plan.regeln.pruefsumme).toBe(geladen.pruefsumme);
        expect(plan.zyklen.map((kreis) => [...kreis].sort())).toEqual(
            expect.arrayContaining([["public.map_label", "public.region"]]),
        );
        // Eltern vor Kindern, außer im Kreis.
        const platz = new Map(plan.tafeln.map((tafel, nummer) => [tafel.tafel, nummer]));
        const imKreis = new Set(plan.zyklen.flat());
        for (const fk of katalog.fremdschluessel) {
            if (fk.von === fk.nach || !platz.has(fk.von) || !platz.has(fk.nach)) continue;
            if (imKreis.has(fk.von) && imKreis.has(fk.nach)) continue;
            expect(platz.get(fk.nach)!, `${fk.nach} vor ${fk.von}`).toBeLessThan(platz.get(fk.von)!);
        }
        // Nichts Errechnetes und kein Personenfeld im Klartext.
        const gebiet = plan.tafeln.find((tafel) => tafel.tafel === "public.territory_area")!;
        expect(gebiet.spalten.map((spalte) => spalte.name)).not.toContain("is_valid");
        expect(plan.tafeln.find((tafel) => tafel.tafel === "public.map_setting")!.abfrage).toContain(
            'NULL::uuid AS "changed_by"',
        );
        expect(plan.tafeln.find((tafel) => tafel.tafel === "public.media_ingest")!.abfrage).toContain(
            `CASE WHEN "actor_person_id" IS NULL THEN NULL ELSE '00000000-0000-0000-0000-000000000000'::uuid END AS "actor_person_id"`,
        );
        // Jeder Befehl läuft gegen die Datenbank, in einer lesenden Transaktion.
        await db.begin("isolation level repeatable read read only", async (tx) => {
            for (const tafel of plan.tafeln) {
                let bytes = 0;
                for await (const stueck of await tx.unsafe(tafel.copy).readable()) bytes += (stueck as Buffer).length;
                expect(bytes, tafel.tafel).toBeGreaterThanOrEqual(21); // Kopf (19) und Schlussmarke (2) auch bei leerer Tafel
            }
            await tx.unsafe(plan.abfragen.migrationen);
            await tx.unsafe(plan.abfragen.kartendomaenen);
            await tx.unsafe(plan.medien.abfrage);
        });
        // Das psql-Skript hat eine Transaktion und je Tafel eine Zeile `\copy`.
        const skript = psqlSkript(plan);
        const kopien = skript.split("\n").filter((zeile) => zeile.startsWith("\\copy "));
        // Je Tafel eine Zeile, dazu die Liste der Mediendateien aus derselben Transaktion (eine CSV neben den Tafeln, nicht im Tar).
        expect(kopien).toHaveLength(plan.tafeln.length + 1);
        expect(kopien.at(-1)).toBe(`\\copy (${plan.medien.abfrage}) TO 'medien-liste.csv' WITH (FORMAT csv)`);
        expect(skript).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
        expect(skript.trimEnd().endsWith("COMMIT;")).toBe(true);
    });

    it("das Werkzeug `scripts/ops/abzug-plan.ts` gibt denselben Plan aus und liest nur", () => {
        const aufruf = (...argumente: string[]) =>
            spawnSync(
                process.execPath,
                [
                    "--import",
                    new URL("../../../scripts/dev/shared-aus-quellen.mjs", import.meta.url).href,
                    join(wurzel, "scripts", "ops", "abzug-plan.ts"),
                    ...argumente,
                ],
                { cwd: wurzel, env: { ...process.env, DATABASE_URL: testDatabaseUrl! }, encoding: "utf8" },
            );
        const json = aufruf("--quelle", "staging");
        expect(json.status, json.stderr).toBe(0);
        const plan = JSON.parse(json.stdout) as AbzugPlan;
        expect(Value.Check(AbzugPlan, plan)).toBe(true);
        expect(plan.quelle).toBe("staging");
        expect(plan.tafeln.length).toBe(mitgenommeneTafeln(geladen.regeln).length);
        const skript = aufruf("--quelle", "production", "--psql");
        expect(skript.status, skript.stderr).toBe(0);
        expect(skript.stdout).toContain("\\copy (SELECT ");
        // Die Mediendateien: Zählung je Speicherklasse auf der Fehlerausgabe, je Zeile `pfad<TAB>groesse<TAB>sha256` auf der Standardausgabe.
        const medien = aufruf("--quelle", "staging", "--medien");
        expect(medien.status, medien.stderr).toBe(0);
        expect(medien.stderr).toMatch(/zusammen: \d+ Zeilen/u);
        for (const zeile of medien.stdout.split("\n").filter((z) => z !== "")) {
            expect(zeile.split("\t")[0], zeile).toSatisfy((pfad: string) => istSichererMedienPfad(pfad));
        }
        // Eine unbekannte Quelle und fehlende Verbindung sind Aufruffehler (Status 2), kein halber Plan.
        expect(aufruf("--quelle", "development").status).toBe(2);
        const ohneVerbindung = spawnSync(
            process.execPath,
            [
                "--import",
                new URL("../../../scripts/dev/shared-aus-quellen.mjs", import.meta.url).href,
                join(wurzel, "scripts", "ops", "abzug-plan.ts"),
                "--quelle",
                "staging",
            ],
            { cwd: wurzel, env: { ...process.env, DATABASE_URL: "" }, encoding: "utf8" },
        );
        expect(ohneVerbindung.status).toBe(2);
        expect(ohneVerbindung.stdout).toBe("");
    });
});
