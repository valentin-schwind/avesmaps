import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { verifyPathRuns, type RunCheck } from "../src/derive/verify-path-runs.ts";

/**
 * Der Wächter `abgeleitet` in `verify:path-runs` (MCS-028, 2026-10-06).
 *
 * 💣 Anlass: Der Prüfer hatte keinen. Alle sechs Prüfungen haben die Form `X.length === 0`, und vier
 * davon lesen ausschliesslich aus `path_label_run`. Bei LEERER Tafel finden sie nichts und sagen
 * „bestanden"; ein abgebrochener `derive:path-runs` wäre unbemerkt geblieben. Dieselbe Lage, gegen
 * die `verify-runs.ts` seinen Wächter bekommen hat.
 *
 * 🪤 „Soll einen Lauf haben" heisst bei den Wegen etwas anderes als bei den Regionen. Dort ist es
 * `region.label_curve_enabled`; hier gibt es keinen solchen Schalter, massgeblich ist die Bedingung
 * der Ableitung selbst: `path.is_active AND path.label_visible`, gruppiert nach (`name`, `subtype`).
 * Der erste Fall unten hält genau das fest.
 *
 * ⭐ Geprüft wird in einer EIGENEN Kartendomäne. `verifyPathRuns` liest sonst den ganzen Bestand;
 * eine leere Tafel liesse sich am echten `aventuria` nicht herstellen, ohne ihn zu löschen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const DOMAIN = "verify-path-runs-abgeleitet";
const QUELLE = "test:verify-path-runs-abgeleitet";

/** Dieselbe Kennung zweimal eingesetzt waere ein stiller Treffer; jede Kette hat ihre eigene. */
const STRASSE = "00000000-0000-4000-8000-00000000a101";
const PFAD = "00000000-0000-4000-8000-00000000a102";
const STEIG = "00000000-0000-4000-8000-00000000a103";

function checkOf(checks: readonly RunCheck[], name: string): RunCheck {
    const hit = checks.find((entry) => entry.name === name);
    if (!hit) {
        throw new Error(`Pruefung ${name} fehlt: ${checks.map((entry) => entry.name).join(", ")}`);
    }
    return hit;
}

describeWithDatabase("verify:path-runs, Waechter abgeleitet", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await database`
            INSERT INTO map_domain
            SELECT (jsonb_populate_record(NULL::map_domain, to_jsonb(m) || ${database.json({ id: DOMAIN })})).*
            FROM map_domain m WHERE m.id = 'aventuria'
            ON CONFLICT (id) DO NOTHING
        `;
        await database`DELETE FROM path_label_run WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM path WHERE source_system = ${QUELLE}`;

        // Zwei Ketten tragen DENSELBEN Namen in verschiedener Art. Genau das kommt im Bestand vor
        // („Eisenstrasse" und „Walsachstrasse" in je vier Arten, gemessen 2026-10-06), und genau
        // daran muss sich der Befund unterscheiden lassen.
        const line = (x1: number, y1: number, x2: number, y2: number): string =>
            `LINESTRING(${String(x1)} ${String(y1)}, ${String(x2)} ${String(y2)})`;
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active, label_visible)
            VALUES
                (${STRASSE}, ${DOMAIN}, 'Pruefstrasse', 'Weg',
                 ST_SetSRID(ST_GeomFromText(${line(100, 100, 140, 100)}), 0), ${QUELLE}, TRUE, TRUE),
                (${PFAD}, ${DOMAIN}, 'Pruefstrasse', 'Pfad',
                 ST_SetSRID(ST_GeomFromText(${line(100, 110, 140, 110)}), 0), ${QUELLE}, TRUE, TRUE),
                (${STEIG}, ${DOMAIN}, 'Pruefsteig', 'Pfad',
                 ST_SetSRID(ST_GeomFromText(${line(100, 120, 140, 120)}), 0), ${QUELLE}, TRUE, TRUE)
        `;
    });

    afterAll(async () => {
        await database`DELETE FROM path_label_run WHERE map_domain_id = ${DOMAIN}`;
        await database`DELETE FROM path WHERE source_system = ${QUELLE}`;
        await database`DELETE FROM map_domain WHERE id = ${DOMAIN}`;
        await database.end({ timeout: 5 });
    });

    it("🔴 leere Tafel: abgeleitet faellt, waehrend die vier zaehlenden Pruefungen gruen bleiben", async () => {
        await database`DELETE FROM path_label_run WHERE map_domain_id = ${DOMAIN}`;

        const report = await verifyPathRuns(database, DOMAIN);
        const abgeleitet = checkOf(report.checks, "abgeleitet");

        expect(abgeleitet.passed).toBe(false);
        expect(abgeleitet.detail).toContain("0 von 3 Ketten mit sichtbarem Namen");
        expect(abgeleitet.detail).toContain("0 Instanzen");
        expect(abgeleitet.detail).toContain("3 ohne Lauf");

        // 💣 Das ist der Befund, der den Waechter noetig gemacht hat: Ohne ihn stuende hier
        // ausschliesslich „bestanden" — vier Pruefungen, die nur aus `path_label_run` lesen,
        // finden in einer leeren Tafel nichts und halten das fuer Ordnung.
        for (const name of [
            "auf_der_sichtbaren_linie",
            "satz_vollzaehlig",
            "zoombaender_ueberschneidungsfrei",
            "laenge_reicht_fuer_den_namen",
        ]) {
            expect(checkOf(report.checks, name).passed, `${name} ist bei leerer Tafel gruen`).toBe(true);
        }

        // Und `abgeleitet` steht VOR ihnen: wer die Ausgabe von oben liest, sieht den Bestand zuerst.
        expect(report.checks[0]?.name).toBe("abgeleitet");
    });

    it("🔴 die fehlenden Ketten stehen namentlich und vollstaendig da, mit Art und oeffentlicher Kennung", async () => {
        await database`DELETE FROM path_label_run WHERE map_domain_id = ${DOMAIN}`;

        const report = await verifyPathRuns(database, DOMAIN);
        const findings = checkOf(report.checks, "abgeleitet").findings ?? [];

        // Vollstaendig, nicht als Stichprobe von fuenf.
        expect(findings).toHaveLength(3);
        // 🪤 Der Name allein benennt die Kette nicht: „Pruefstrasse" steht zweimal da und ist nur
        // ueber die Art und die Kennung auseinanderzuhalten.
        expect(findings).toContain(`ohne Lauf: Pruefstrasse (Weg, 1 Teilstück, ${STRASSE})`);
        expect(findings).toContain(`ohne Lauf: Pruefstrasse (Pfad, 1 Teilstück, ${PFAD})`);
        expect(findings).toContain(`ohne Lauf: Pruefsteig (Pfad, 1 Teilstück, ${STEIG})`);
        expect(findings.filter((row) => row.startsWith("ohne Lauf: Pruefstrasse ("))).toHaveLength(2);
    });

    it("🔴 mit Bestand urteilt abgeleitet ueber > 0 und nennt die uebrigen Ketten weiter als Befund", async () => {
        await database`DELETE FROM path_label_run WHERE map_domain_id = ${DOMAIN}`;
        await database`
            INSERT INTO path_label_run (
                name, subtype, map_domain_id, part, instance, instance_count,
                run_min_zoom, run_max_zoom, name_width_px, geom, source_fingerprint, algorithm_version
            ) VALUES (
                'Pruefstrasse', 'Weg', ${DOMAIN}, 0, 0, 1, 8, 8, 80,
                ST_SetSRID(ST_GeomFromText('LINESTRING(110 100, 130 100)'), 0), 'test', '1'
            )
        `;

        const report = await verifyPathRuns(database, DOMAIN);
        const abgeleitet = checkOf(report.checks, "abgeleitet");

        expect(abgeleitet.passed).toBe(true);
        expect(abgeleitet.detail).toContain("1 von 3 Ketten mit sichtbarem Namen");
        expect(abgeleitet.detail).toContain("1 Instanzen");
        expect(abgeleitet.detail).toContain("2 ohne Lauf");
        // Die beschriftete Kette steht NICHT mehr im Befund, die gleichnamige andere Art schon.
        const findings = abgeleitet.findings ?? [];
        expect(findings).toHaveLength(2);
        expect(findings.some((row) => row.includes("(Weg,"))).toBe(false);
        expect(findings.some((row) => row.includes("Pruefstrasse (Pfad,"))).toBe(true);
    });

    it("🔴 ein Weg ohne label_visible zaehlt nicht mit: massgeblich ist die Bedingung der ABLEITUNG", async () => {
        await database`DELETE FROM path_label_run WHERE map_domain_id = ${DOMAIN}`;
        await database`UPDATE path SET label_visible = FALSE WHERE public_id = ${STEIG}`;
        try {
            const vorher = checkOf((await verifyPathRuns(database, DOMAIN)).checks, "abgeleitet");
            expect(vorher.detail).toContain("0 von 2 Ketten mit sichtbarem Namen");
            expect(vorher.findings ?? []).toHaveLength(2);

            // Dieselbe Gegenprobe fuer `is_active`: beides zusammen ist die Bedingung aus
            // `derivePathRuns`, und der Waechter darf keine andere zaehlen.
            await database`UPDATE path SET is_active = FALSE WHERE public_id = ${PFAD}`;
            const danach = checkOf((await verifyPathRuns(database, DOMAIN)).checks, "abgeleitet");
            expect(danach.detail).toContain("0 von 1 Ketten mit sichtbarem Namen");
            expect(danach.findings ?? []).toHaveLength(1);
        } finally {
            await database`UPDATE path SET label_visible = TRUE WHERE public_id = ${STEIG}`;
            await database`UPDATE path SET is_active = TRUE WHERE public_id = ${PFAD}`;
        }
    });
});
