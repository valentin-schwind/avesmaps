import { fileURLToPath } from "node:url";
import type { WikisyncBereichZahlen } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schreibeLauf, type LaufEingabe } from "../src/wiki/abgleich/ablage.ts";
import type { PlanZitat } from "../src/wiki/abgleich/plan.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Zitate des Wikis je Quelle und Objekt (WI-0254 §12, Migration 0251, Tafel `wikisync_quelle_zitat`) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS:
 * Der Lauf der Vorschau (Jobs-Rolle) legt sie in derselben Transaktion ab wie seine Planzeilen, die App liest sie nur.
 *
 * 🔴 Problemfälle: Die Zeilen fallen mit dem Lauf (die zwei jüngsten je Bereich bleiben); fehlt der Jobs-Rolle das Recht (Stage und Production, bis Claudio die Rechte einspielt),
 * scheitert der Lauf NICHT, sondern steht ohne Zitate da und nennt ihre Zahl (`zahlen.quelle.zitateUebersprungen`, ohne `zitate`); ein Lauf ohne den Bereich `quelle` hat keine;
 * die App schreibt nie, die Jobs-Rolle nur INSERT; die Tafel kennt die Träger, die der Plan liefert (und `lore` für die Vorkommen), und nur drei Arten der Nennung.
 */

const ENV = "wzitate";
const grants = [fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url))];
const describeWithCluster = postgresBin ? describe : describe.skip;

const uuid = (nummer: number): string => `a0000000-0000-4000-8000-${String(nummer).padStart(12, "0")}`;

const ZAHLEN: WikisyncBereichZahlen = {
    objekte: 0,
    mitAdresse: 0,
    kennungOhneWikiAdresse: 0,
    gefunden: 0,
    umgeleitet: 0,
    nichtImDump: 0,
    mehrdeutig: 0,
    gesperrt: 0,
    felderGelesen: 0,
    unveraendert: 0,
    uebernommen: 0,
    eigen: 0,
    befunde: 0,
    neueArtikel: 0,
    neueArtikelNurZahl: 0,
};

const ZITATE: PlanZitat[] = [
    {
        traegerArt: "place",
        traegerId: uuid(1),
        quelle: `url:${"a".repeat(64)}`,
        art: "ausfuehrlich",
        seiten: "40, 145",
        notiz: "Zerstörung",
        artikel: "Gareth",
    },
    {
        traegerArt: "path",
        traegerId: uuid(2),
        quelle: "wikipub:der-rabenkrieg",
        art: "erwaehnung",
        seiten: null,
        notiz: null,
        artikel: "Reichsstraße 1",
    },
    {
        traegerArt: "territory",
        traegerId: uuid(3),
        quelle: "wikipub:das-horasreich",
        art: "ergaenzend",
        seiten: "7",
        notiz: null,
        artikel: "Herzogtum Weiden",
    },
];

function lauf(bereiche: LaufEingabe["bereiche"], zitate: PlanZitat[]): LaufEingabe {
    const zahlen = Object.fromEntries(bereiche.map((bereich) => [bereich, { ...ZAHLEN }]));
    return {
        bereiche,
        parserVersion: "wikisync-parser-test",
        jobPublicId: null,
        ausgeloestVon: null,
        ausgeloestLabel: "test",
        quelle: { datei: "dump.xml", sha256: "a".repeat(64), stand: null, seiten: 1 },
        tafelRevision: null,
        plan: { zeilen: [], zahlen, zitate },
    };
}

describeWithCluster(
    "WikiSync: die Zitate des Wikis je Quelle und Objekt (Wegwerf-Cluster, Rollen wie auf dem VPS)",
    () => {
        let cluster: VpsCluster | undefined;

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, grants);
        }, 180_000);

        afterAll(async () => {
            await cluster?.stop();
        });

        const zeilen = async (laufId: number) =>
            cluster!.admin<
                {
                    traeger_art: string;
                    traeger_id: string;
                    quelle_key: string;
                    art: string;
                    seiten: string | null;
                    notiz: string | null;
                    artikel: string;
                }[]
            >`
            SELECT traeger_art, traeger_id::text, quelle_key, art, seiten, notiz, artikel
              FROM wikisync_quelle_zitat WHERE lauf_id = ${laufId} ORDER BY traeger_art, traeger_id
        `;
        const zahlenDesLaufs = async (laufId: number) =>
            (
                await cluster!.admin<{ zahlen: Record<string, Record<string, unknown>> }[]>`
                SELECT zahlen FROM wikisync_lauf WHERE id = ${laufId}
            `
            )[0]!.zahlen;

        it("🔴 Der Lauf legt die Zitate in seiner Transaktion ab, ein Lauf ohne den Bereich quelle keine", async () => {
            const id = await schreibeLauf(cluster!.jobs, lauf(["quelle"], ZITATE));
            expect(await zeilen(id)).toEqual([
                {
                    traeger_art: "path",
                    traeger_id: uuid(2),
                    quelle_key: "wikipub:der-rabenkrieg",
                    art: "erwaehnung",
                    seiten: null,
                    notiz: null,
                    artikel: "Reichsstraße 1",
                },
                {
                    traeger_art: "place",
                    traeger_id: uuid(1),
                    quelle_key: `url:${"a".repeat(64)}`,
                    art: "ausfuehrlich",
                    seiten: "40, 145",
                    notiz: "Zerstörung",
                    artikel: "Gareth",
                },
                {
                    traeger_art: "territory",
                    traeger_id: uuid(3),
                    quelle_key: "wikipub:das-horasreich",
                    art: "ergaenzend",
                    seiten: "7",
                    notiz: null,
                    artikel: "Herzogtum Weiden",
                },
            ]);
            // Die Zahl steht am Bereich, auch wo sie 0 ist: Wer die Zitate liest, nimmt nur einen Lauf mit `zitate`.
            expect((await zahlenDesLaufs(id))["quelle"]).toMatchObject({ zitate: 3 });
            expect((await zahlenDesLaufs(id))["quelle"]).not.toHaveProperty("zitateUebersprungen");

            const leer = await schreibeLauf(cluster!.jobs, lauf(["quelle"], []));
            expect(await zeilen(leer)).toEqual([]);
            expect((await zahlenDesLaufs(leer))["quelle"]).toMatchObject({ zitate: 0 });

            const ort = await schreibeLauf(cluster!.jobs, lauf(["ort"], []));
            expect(await zeilen(ort)).toEqual([]);
            expect(Object.keys(await zahlenDesLaufs(ort))).toEqual(["ort"]);
            expect((await zahlenDesLaufs(ort))["ort"]).not.toHaveProperty("zitate");
        });

        it("🔴 Die Zeilen fallen mit ihrem Lauf: Es bleiben die zwei jüngsten fertigen Läufe des Bereichs", async () => {
            const ersterId = await schreibeLauf(cluster!.jobs, lauf(["quelle"], ZITATE));
            const zweiter = await schreibeLauf(cluster!.jobs, lauf(["quelle"], ZITATE.slice(0, 2)));
            const dritter = await schreibeLauf(cluster!.jobs, lauf(["quelle"], ZITATE.slice(0, 1)));
            expect(await zeilen(ersterId)).toEqual([]);
            expect(await zeilen(zweiter)).toHaveLength(2);
            expect(await zeilen(dritter)).toHaveLength(1);
            const verwaist = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM wikisync_quelle_zitat z WHERE NOT EXISTS (SELECT 1 FROM wikisync_lauf l WHERE l.id = z.lauf_id)
        `;
            expect(verwaist[0]?.n).toBe(0);
        });

        it("🔴 Fehlt der Jobs-Rolle das Recht, scheitert der Lauf nicht: Er steht ohne Zitate da und nennt ihre Zahl", async () => {
            const c = cluster!;
            await c.admin.unsafe(`REVOKE INSERT ON wikisync_quelle_zitat FROM ${c.roles.jobs}`);
            try {
                const id = await schreibeLauf(c.jobs, lauf(["quelle"], ZITATE));
                expect(await zeilen(id)).toEqual([]);
                const zahlen = (await zahlenDesLaufs(id))["quelle"];
                expect(zahlen).toMatchObject({ zitateUebersprungen: 3 });
                expect(zahlen).not.toHaveProperty("zitate");
                // Der Lauf selbst steht da: fertig, im Bericht sichtbar.
                const kopf = await c.admin<{ status: string }[]>`SELECT status FROM wikisync_lauf WHERE id = ${id}`;
                expect(kopf[0]?.status).toBe("fertig");
            } finally {
                await c.regrant();
            }
            // Mit dem Recht legt der nächste Lauf sie wieder ab.
            const spaeter = await schreibeLauf(c.jobs, lauf(["quelle"], ZITATE));
            expect(await zeilen(spaeter)).toHaveLength(3);
        });

        it("🔴 Rechte: Die App liest nur, die Jobs-Rolle legt an und sonst nichts", async () => {
            const c = cluster!;
            expect(await c.granted(c.roles.app, "wikisync_quelle_zitat")).toEqual(["SELECT"]);
            const jobs = await c.granted(c.roles.jobs, "wikisync_quelle_zitat");
            expect(jobs).toEqual(expect.arrayContaining(["SELECT", "INSERT"]));
            expect(jobs).not.toContain("UPDATE");
            expect(jobs).not.toContain("DELETE");
            const anweisungen = [
                `INSERT INTO wikisync_quelle_zitat (lauf_id, traeger_art, traeger_id, quelle_key, art, artikel) VALUES (1, 'place', '${uuid(9)}', 'k', 'ausfuehrlich', 'A')`,
                "UPDATE wikisync_quelle_zitat SET seiten = '1'",
                "DELETE FROM wikisync_quelle_zitat",
            ];
            expect(await c.codesAs(c.app, anweisungen)).toEqual(["42501", "42501", "42501"]);
            expect(await c.codesAs(c.jobs, anweisungen.slice(1))).toEqual(["42501", "42501"]);
            // Aufgeräumt wird trotzdem: Der Fremdschlüssel des Laufs räumt auf, ohne DELETE-Recht an der Tafel.
            const id = await schreibeLauf(c.jobs, lauf(["quelle"], ZITATE));
            await c.admin`DELETE FROM wikisync_lauf WHERE id = ${id}`;
            expect(await zeilen(id)).toEqual([]);
        });

        it("Die Tafel kennt die Träger des Plans und das Vorkommen (lore), drei Arten der Nennung und keine Doppelten", async () => {
            const c = cluster!;
            const id = await schreibeLauf(c.jobs, lauf(["quelle"], []));
            const einfuegen = (art: string, traeger: string, nennung = "ausfuehrlich") =>
                `INSERT INTO wikisync_quelle_zitat (lauf_id, traeger_art, traeger_id, quelle_key, art, artikel) VALUES (${String(id)}, '${art}', '${traeger}', 'k', '${nennung}', 'A')`;
            expect(
                await c.codesAs(c.admin, [
                    einfuegen("lore", uuid(5)),
                    einfuegen("peak", uuid(5)),
                    einfuegen("area", uuid(5)),
                    // Kein Träger der Tafel, keine Art der Nennung.
                    einfuegen("powerline", uuid(5)),
                    einfuegen("place", uuid(5), "gesehen"),
                    // Dieselbe Quelle am selben Träger im selben Lauf gibt es nur einmal.
                    `${einfuegen("place", uuid(5))}; ${einfuegen("place", uuid(5))}`,
                ]),
            ).toEqual(["ok", "ok", "ok", "23514", "23514", "23505"]);
        });
    },
);
