import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { derivePathRuns } from "../src/derive/path-runs.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { updatePathStreet } from "../src/editor/path-update.ts";
import type { AreaEventJob } from "../src/jobs/area-events.ts";
import { ketteAus, wegnamenNachSpeichern } from "../src/jobs/weg-folgen-job.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Wegnamen folgen jeder Wege-Operation (WI-0177; Entscheid der Editor-Orchestrierung 2026-10-17, (a); Migration 0156), so wie auf
 * dem VPS: Wegwerf-Cluster mit Migrations-, App- und Jobs-Rolle und den Vorlagen. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: Eine Umbenennung lässt den alten Namen auf der Karte stehen (die alte Kette wird nicht neu gerechnet); jede Speicherung
 * legt einen eigenen Auftrag an statt mit dem wartenden derselben Kette zu fahren; zwei Ketten teilen sich einen Auftrag; die Anwendung
 * darf die Art nicht einreihen (`job_enqueue`, 42501); die Jobs-Rolle darf `path_label_run` nicht schreiben; die App-Rolle schreibt
 * abgeleitete Läufe selbst; nach dem Lauf lädt keine Karte neu.
 */

const ENV = "wegfolg";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const A = "a1770177-0000-4000-8000-0000000007a1";
const B = "a1770177-0000-4000-8000-0000000007a2";

interface Auftrag {
    id: string;
    public_id: string;
    input_ref: Record<string, unknown>;
    wartet_s: number;
}

describeWithCluster("Wegnamen nach einer Wege-Operation (WI-0177, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    const actor: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
    const auftraege = async (): Promise<Auftrag[]> =>
        cluster!.admin<Auftrag[]>`
            SELECT id::text, public_id::text, input_ref,
                   round(extract(epoch FROM (not_before - queued_at)))::int AS wartet_s
              FROM job WHERE kind = 'path_label_runs' ORDER BY id
        `;
    const laeufe = async (name: string): Promise<number> =>
        (await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM path_label_run WHERE name = ${name}`)[0]!
            .n;
    const revisionen = async () =>
        cluster!.admin<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM path WHERE public_id = ANY(${[A, B]}::uuid[])
             ORDER BY public_id
        `;
    const benenne = async (name: string) =>
        updatePathStreet(cluster!.app, actor, A, {
            operationId: randomUUID(),
            sections: (await revisionen()).map((z) => ({ publicId: z.id, baseRevision: z.revision })),
            name,
        });

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        // Eine lange Straße aus zwei Abschnitten, damit der Name hineinpasst.
        for (const [id, x] of [
            [A, 100],
            [B, 400],
        ] as const)
            await cluster.admin`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
                VALUES (${id}, 'aventuria', 'Alter Handelsweg', 'Strasse', TRUE, FALSE,
                        ST_GeomFromText(${`LINESTRING(${String(x)} 500, ${String(x + 300)} 500)`}, 0), 'test')
            `;
        await derivePathRuns(cluster.migrator);
    }, 240_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 eine Umbenennung reiht in ihrer Transaktion je Kette einen Auftrag ein: die alte UND die neue, 10 s Sammelzeit", async () => {
        expect(await laeufe("Alter Handelsweg")).toBeGreaterThan(0);
        const quittung = await benenne("Neuer Handelsweg");
        expect(quittung.derivedWork.filter((w) => w.kind === "path_label_runs")).toHaveLength(2);
        const jetzt = await auftraege();
        expect(
            jetzt.map((a) => a.input_ref).sort((a, b) => String(a["name"]).localeCompare(String(b["name"]))),
        ).toEqual([
            { name: "Alter Handelsweg", subtype: "Strasse" },
            { name: "Neuer Handelsweg", subtype: "Strasse" },
        ]);
        expect(jetzt.every((a) => a.wartet_s === 10)).toBe(true);
    });

    it("🔴 eine weitere Speicherung an derselben Kette fährt mit dem wartenden Auftrag", async () => {
        const vorher = (await auftraege()).length;
        await benenne("Neuer Handelsweg ");
        await benenne("Neuer Handelsweg");
        expect((await auftraege()).length).toBe(vorher);
    });

    it("🔴 als Jobs-Rolle: die alte Kette verliert ihre Läufe, die neue bekommt sie; die Karten hören `map.changed`", async () => {
        const job = (name: string): AreaEventJob => {
            const auftrag = jetzt.find((a) => a.input_ref["name"] === name)!;
            return {
                id: Number(auftrag.id),
                publicId: auftrag.public_id,
                kind: "path_label_runs",
                mapDomainId: "aventuria",
            };
        };
        const jetzt = await auftraege();
        await wegnamenNachSpeichern(cluster!.jobs, job("Alter Handelsweg"), {
            name: "Alter Handelsweg",
            subtype: "Strasse",
        });
        expect(await laeufe("Alter Handelsweg")).toBe(0);
        const bericht = await wegnamenNachSpeichern(cluster!.jobs, job("Neuer Handelsweg"), {
            name: "Neuer Handelsweg",
            subtype: "Strasse",
        });
        expect(bericht).toMatchObject({ chains: 1 });
        expect(await laeufe("Neuer Handelsweg")).toBeGreaterThan(0);
        const [ereignis] = await cluster!.admin<{ payload: Record<string, unknown> }[]>`
            SELECT payload FROM job_event WHERE kind = 'map.changed' ORDER BY seq DESC LIMIT 1
        `;
        expect(ereignis?.payload).toMatchObject({ operation: "path_label_runs" });
    });

    it("🔴 die App-Rolle schreibt `path_label_run` nicht; die Jobs-Rolle schon; eine kaputte Eingabe ist nicht wiederholbar", async () => {
        for (const recht of ["INSERT", "DELETE"]) {
            const [app] = await cluster!.admin<{ darf: boolean }[]>`
                SELECT has_table_privilege(${cluster!.roles.app}, 'path_label_run', ${recht}) AS darf
            `;
            const [jobs] = await cluster!.admin<{ darf: boolean }[]>`
                SELECT has_table_privilege(${cluster!.roles.jobs}, 'path_label_run', ${recht}) AS darf
            `;
            expect({ recht, app: app?.darf, jobs: jobs?.darf }).toEqual({ recht, app: false, jobs: true });
        }
        expect(() => ketteAus({ name: "X" })).toThrow(/name, subtype/);
        expect(ketteAus({ name: "", subtype: "Weg" })).toEqual({ name: "", subtype: "Weg" });
    });
});
