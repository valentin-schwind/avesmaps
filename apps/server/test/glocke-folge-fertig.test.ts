import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BENACHRICHTIGUNG_ARTEN, WARTESCHLANGE_ARTEN } from "@avesmaps3d/shared";
import { BENACHRICHTIGUNG_JOB_ARTEN } from "../src/jobs/benachrichtigung-job.ts";
import { folgeArt, letzteFolge, meldeFolgeFertig, type FolgeZeile } from "../src/jobs/folge-fertig.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Glocke meldet, dass die eigenen Aufträge abgearbeitet sind (WI-0230; Betreiber 2026-10-19: „wenn die warteschlange abgearbeitet
 * ist, kann sie die glocke benachrichtigen (Warteschlange fertig. Bitte neu laden oder so)“).
 *
 * - Problemfälle: eine Meldung je Auftrag statt je Folge; eine Meldung, während ein Glied der Kette noch wartet; zwei Ausführer melden
 *   dieselbe Folge doppelt; ein fremder oder ein Systemauftrag hält die Meldung auf oder löst sie aus; die Jobs-Rolle darf nicht melden.
 * - Soll: Die Karte lädt alles selbst nach → „fertig“, sonst „neu laden“; ein gescheiterter oder abgebrochener Auftrag → „Fehler“.
 */

const T0 = Date.parse("2026-10-19T05:00:00Z");
const zeile = (
    publicId: string,
    kind: string,
    state: FolgeZeile["state"],
    eingereihtS: number,
    beendetS: number | null,
): FolgeZeile => ({
    publicId,
    kind,
    state,
    queuedAt: new Date(T0 + eingereihtS * 1000),
    finishedAt: beendetS === null ? null : new Date(T0 + beendetS * 1000),
});

describe("Glocke zur fertigen Folge: welche Aufträge eine Folge sind", () => {
    it("🔴 solange einer wartet oder läuft, keine Folge", () => {
        expect(
            letzteFolge([
                zeile("a", "terrain_local", "SUCCEEDED", 0, 30),
                zeile("b", "dem_publish", "QUEUED", 0, null),
            ]),
        ).toBeNull();
        expect(letzteFolge([])).toBeNull();
    });

    it("🔴 die Folge reicht zurück, solange die Aufträge ohne Pause aufeinander folgten; davor beginnt eine andere", () => {
        const folge = letzteFolge([
            zeile("alt", "territory_derive", "SUCCEEDED", -600, -500),
            zeile("a", "territory_derive", "SUCCEEDED", 0, 60),
            zeile("b", "path_label_runs", "SUCCEEDED", 50, 70),
            zeile("c", "territory_derive", "SUCCEEDED", 65, 130),
        ]);
        expect(folge?.map((z) => z.publicId)).toEqual(["c", "b", "a"]);
    });

    it("die Art: alles lädt die Karte selbst → fertig; sonst neu laden; ein Fehlschlag oder Abbruch geht vor", () => {
        expect(folgeArt([{ kind: "territory_derive", state: "SUCCEEDED" }])).toBe("warteschlange_fertig");
        expect(
            folgeArt([
                { kind: "terrain_local", state: "SUCCEEDED" },
                { kind: "path_profile", state: "SUCCEEDED" },
            ]),
        ).toBe("warteschlange_fertig_laden");
        expect(
            folgeArt([
                { kind: "path_profile", state: "SUCCEEDED" },
                { kind: "dem_publish", state: "FAILED" },
            ]),
        ).toBe("warteschlange_fehler");
        expect(folgeArt([{ kind: "land_smooth", state: "CANCELLED" }])).toBe("warteschlange_fehler");
    });

    it("die drei Arten stehen im Katalog der Glocke, aber kein Auftrag der Warteschlange darf sie melden", () => {
        for (const art of ["warteschlange_fertig", "warteschlange_fertig_laden", "warteschlange_fehler"]) {
            expect(BENACHRICHTIGUNG_ARTEN).toContain(art);
            expect(WARTESCHLANGE_ARTEN).toContain(art);
            expect(BENACHRICHTIGUNG_JOB_ARTEN).not.toContain(art);
        }
    });
});

const ENV = "glockefolge";
const vorlagen = ["system-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster(
    "Glocke zur fertigen Folge als Jobs-Rolle (Wegwerf-Cluster wie auf dem VPS)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let person = "";
        let andere = "";

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const neu = async (name: string): Promise<string> => {
                const [row] = await cluster!.admin<{ id: string }[]>`
                INSERT INTO avesmaps_auth.person (display_name, status, created_via) VALUES (${name}, 'active', 'system')
                RETURNING id::text
            `;
                return row!.id;
            };
            person = await neu("Rondrikan");
            andere = await neu("Travine");
        }, 180_000);

        afterAll(async () => {
            await cluster?.stop();
        }, 60_000);

        /** Ein Auftrag mit Zeiten relativ zu jetzt (Sekunden); ohne `beendetS` wartet er. */
        async function auftrag(
            actor: string,
            kind: string,
            eingereihtS: number,
            beendetS?: number,
            state = "SUCCEEDED",
        ) {
            const [row] = await cluster!.admin<{ id: string }[]>`
            INSERT INTO job (kind, map_domain_id, actor_ref, state, queued_at, finished_at)
            VALUES (${kind}, 'aventuria', ${actor}, ${beendetS === undefined ? "QUEUED" : state},
                    now() + make_interval(secs => ${eingereihtS}),
                    ${beendetS === undefined ? null : cluster!.admin`now() + make_interval(secs => ${beendetS})`})
            RETURNING id::text
        `;
            return row!.id;
        }
        const meldungen = () =>
            cluster!.admin<{ art: string; von_art: string; text: string | null }[]>`
            SELECT art, von_art, text FROM benachrichtigung WHERE an_person = ${person}::uuid ORDER BY id
        `;

        it("🔴 eine Folge: nichts, solange ein Glied wartet; danach EINE Meldung, auch wenn zwei Ausführer prüfen", async () => {
            await auftrag(person, "terrain_local", -300, -240);
            const wartend = await auftrag(person, "dem_publish", -300);
            // Ein fremder wartender Auftrag hält die eigene Meldung nicht auf; ein Systemauftrag meldet nichts.
            await auftrag(andere, "territory_derive", -10);
            expect(await meldeFolgeFertig(cluster!.jobs, "staging", person)).toEqual({
                gemeldet: false,
                grund: "laeuft_noch",
            });
            expect(await meldeFolgeFertig(cluster!.jobs, "staging", "jobs-cli")).toEqual({
                gemeldet: false,
                grund: "keine_person",
            });
            await cluster!
                .admin`UPDATE job SET state = 'SUCCEEDED', finished_at = now() - interval '200 seconds' WHERE id = ${wartend}::bigint`;
            const erste = await meldeFolgeFertig(cluster!.jobs, "staging", person);
            const zweite = await meldeFolgeFertig(cluster!.jobs, "staging", person);
            expect(erste).toMatchObject({ gemeldet: true, art: "warteschlange_fertig", auftraege: 2 });
            expect(zweite).toMatchObject({ gemeldet: false, art: "warteschlange_fertig" });
            expect(await meldungen()).toEqual([{ art: "warteschlange_fertig", von_art: "system", text: null }]);
        });

        it("🔴 die nächste Folge meldet neu: mit einem Wegprofil „neu laden“, mit einem Fehlschlag „Fehler“", async () => {
            await auftrag(person, "path_profile", -100, -90);
            expect(await meldeFolgeFertig(cluster!.jobs, "staging", person)).toMatchObject({
                gemeldet: true,
                art: "warteschlange_fertig_laden",
                auftraege: 1,
            });
            await auftrag(person, "land_smooth", -50, -40, "FAILED");
            await auftrag(person, "label_runs", -45, -30);
            expect(await meldeFolgeFertig(cluster!.jobs, "staging", person)).toMatchObject({
                gemeldet: true,
                art: "warteschlange_fehler",
                auftraege: 2,
            });
            expect((await meldungen()).map((m) => m.art)).toEqual([
                "warteschlange_fertig",
                "warteschlange_fertig_laden",
                "warteschlange_fehler",
            ]);
        });
    },
);
