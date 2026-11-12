import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { socialBildUrteile } from "../src/community/social/bild-urteil.ts";
import { ausgeschaltet, inhaltsstandFuer, istAus, leseInhaltsstand } from "../src/system/inhaltsstand.ts";
import { cleanMediaFixtures, insertAsset } from "./support/media-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Inhaltsschalter, gelesen als Jobs-Rolle (WI-0278), so wie auf dem VPS: Wegwerf-Cluster mit den Rollen und ALLEN Vorlagen unter
 * `apps/server/src/db/*.psql`. Die Jobs-Rolle hat an keiner Tafel von `avesmaps_auth` ein Recht (`auth-grants.psql`).
 *
 * 🔴 **Anlass (2026-11-03):** Der erste Beitrag mit Bild scheiterte in allen vier Kanälen mit „Die Rechte des Bildes lassen keinen Beitrag
 * (mehr) zu“, obwohl das Bild gemeinfrei und geprüft war. `inhaltsstandFuer` liest im Auftrag ohne Store, und die Abfrage verband
 * `avesmaps_auth.person` (Namen der Personen). Das Lesen scheiterte mit 42501, der Rückfall hieß `unknown`, und `failure: closed` schaltete
 * jede Bildrolle aus. Lokal und in den übrigen Tests fiel es nicht auf, weil dort als Eigentümer gelesen wird. Behoben in eab42f40b
 * (`{ personen: false }`); dieser Test hält fest, dass die Jobs-Rolle den wirklichen Stand sieht und dass er auch wirkt.
 */

const ENV = "inhaltsjobs";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Inhaltsschalter als Jobs-Rolle ohne Anmeldeschema (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let bild = "";

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        // Ein Bild wie der Upload im Hub: Kategorie `social_post`, gemeinfrei, geprüft, mit veröffentlichter Datei.
        const asset = await insertAsset(cluster.migrator, {
            ref: "jobs-rolle-bild",
            rights: { basis: "public_domain", clearance: "cleared", creator: "Vali" },
        });
        await cluster.migrator`UPDATE media_asset SET asset_type = 'social_post' WHERE id = ${asset.id}`;
        bild = asset.publicId;
    }, 240_000);

    afterAll(async () => {
        if (cluster) await cleanMediaFixtures(cluster.migrator).catch(() => undefined);
        await cluster?.stop();
    }, 60_000);

    const schalter = (key: string, enabled: boolean) =>
        cluster!.migrator`
            INSERT INTO content_switch (key, enabled, changed_by_label) VALUES (${key}, ${enabled}, 'cli:wi-0278')
            ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled
        `;

    it("🔴 die Voraussetzung: die Jobs-Rolle liest das Anmeldeschema nicht, und das Lesen mit Namen scheitert dort", async () => {
        // Ohne diese Zeile prüfte der Test unten nichts mehr, sobald die Jobs-Rolle das Recht bekäme.
        await expect(cluster!.jobs`SELECT display_name FROM avesmaps_auth.person LIMIT 1`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(leseInhaltsstand(cluster!.jobs)).rejects.toMatchObject({ code: "42501" });
    });

    it("🔴 ohne Store liest die Jobs-Rolle den wirklichen Stand: aus der Datenbank, nichts gilt als aus", async () => {
        const stand = await inhaltsstandFuer(cluster!.jobs);
        expect(stand.source).toBe("database");
        expect(ausgeschaltet(stand)).toEqual([]);
        // Was „unknown“ wäre: jede Bildrolle aus (`failure: closed`).
        expect(istAus(stand, "media.role.social_post")).toBe(false);
        expect(istAus(stand, "media.role.coat")).toBe(false);
    });

    it("🔴 sie sieht auch einen wirklich ausgeschalteten Schalter, und nur ihn", async () => {
        await schalter("media.role.social_post", false);
        try {
            const stand = await inhaltsstandFuer(cluster!.jobs);
            expect(stand.source).toBe("database");
            expect(ausgeschaltet(stand)).toEqual(["media.role.social_post"]);
            expect(stand.zeilen.get("media.role.social_post")?.changedBy).toBe("cli:wi-0278");
        } finally {
            await cluster!.migrator`DELETE FROM content_switch WHERE key = 'media.role.social_post'`;
        }
    });

    it("🔴 der Sende-Auftrag: dasselbe Urteil über das Bild wie der Eigentümer, nicht „switched_off“", async () => {
        const alsEigentuemer = (await socialBildUrteile(cluster!.migrator, [bild])).get(bild);
        expect(alsEigentuemer, "Vorbedingung: das Bild ist erlaubt").toMatchObject({ erlaubt: true });
        const alsJobs = (await socialBildUrteile(cluster!.jobs, [bild])).get(bild);
        expect(alsJobs).toEqual(alsEigentuemer);
    });

    it("🔴 und es bleibt ein Notschalter: steht die Bildrolle wirklich auf aus, lässt die Jobs-Rolle das Bild nicht hinaus", async () => {
        await schalter("media.role.social_post", false);
        try {
            const urteil = (await socialBildUrteile(cluster!.jobs, [bild])).get(bild);
            expect(urteil).toMatchObject({ erlaubt: false, grund: "switched_off" });
        } finally {
            await cluster!.migrator`DELETE FROM content_switch WHERE key = 'media.role.social_post'`;
        }
        expect((await socialBildUrteile(cluster!.jobs, [bild])).get(bild)).toMatchObject({ erlaubt: true });
    });
});
