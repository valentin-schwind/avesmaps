import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AVENTURIA } from "@avesmaps3d/shared";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { mitTestWerten, resolveTerrainRecipe } from "../src/terrain/auswahl.ts";
import { bereinigt, mitTest, TestWerteFehler } from "../src/terrain/domain/recipe-test.ts";
import { AVENTURIA_TERRAIN_RECIPES, parseTerrainRecipe, recipeFingerprint } from "../src/terrain/domain/recipes.ts";
import { readHoehenmodell } from "../src/terrain/hoehenmodell-lesen.ts";
import {
    gerechnetMit,
    offeneFassung,
    setzeTestWerte,
    sperreTest,
    testStand,
} from "../src/terrain/hoehenmodell-test.ts";
import { nimmAb } from "../src/terrain/hoehenmodell.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „19 (Test)“ live einstellbar (WI-0240; Betreiber 2026-10-19: „ergänz denen namen der 19 mit (Test). alle änderungen die wir mit test
 * machen soll automatisch passieren wenn wir was machen oder wenn jemand auf aktivieren geklickt haben. wir ändern eigenschaften von test
 * 19 live auf der stage bis das modell brauchbare ergebnisse liefert.“).
 *
 * Problemfälle: Die Werte wirken auf Production oder auf eine abgenommene Fassung; ein Wert gleich der Datei ändert den Fingerabdruck (dann
 * rechnete ein Zurücksetzen alles neu, und ein Master aus der Datei gälte nicht mehr); der Stand, der als Datei ins Repository geht,
 * rechnet nicht bytegleich; ein Setzen unter gewählter 19 rechnet nicht neu, unter gewählter 18 dagegen schon; nach der Abnahme lässt sich
 * noch etwas ändern; die App-Rolle darf die Werte löschen oder den Verlauf ändern.
 *
 * Fassung 19 ist seit 2026-11-07 abgenommen; der Test prüft die Werkstatt an einer gedachten offenen 19 (`support/offene-fassung.ts`).
 */
vi.mock("../src/terrain/domain/recipes.ts", async (importOriginal) =>
    (await import("./support/offene-fassung.ts")).mitOffenerFassung19(await importOriginal()),
);

const F18 = AVENTURIA_TERRAIN_RECIPES.get(18)!;
const F19 = AVENTURIA_TERRAIN_RECIPES.get(19)!;
const ENV = "rezepttest";
const PERSON = "7e570000-0000-4000-8000-0000000002ac";
const grants = fileURLToPath(new URL("../src/db/hoehenmodell-grants.psql", import.meta.url));
const describeWithCluster = postgresBin ? describe : describe.skip;

describe("Werte über der Datei (WI-0240, ohne Datenbank)", () => {
    it("🔴 ohne Werte die Datei selbst; ein Wert gleich der Datei fällt weg und ändert nichts am Fingerabdruck", () => {
        expect(mitTest(F19, {})).toBe(F19);
        const gleich = bereinigt(F19, {
            regler: { continentalHeight: F19.generator.continentalHeight },
            presets: {
                typen: { kammgebirge: { werte: { sattel: F19.gebirgsPresets!.typen.kammgebirge.werte.sattel } } },
            },
        });
        expect(gleich).toEqual({});
        expect(recipeFingerprint(mitTest(F19, gleich))).toBe(recipeFingerprint(F19));
    });

    it("🔴 Regler und Gebirgs-Presets wirken; der Stand als Datei rechnet bytegleich (der Master der Stage bleibt gültig)", () => {
        const werte = bereinigt(F19, {
            regler: { continentalHeight: 320, flankGrade: 0.05 },
            presets: {
                typen: { kammgebirge: { werte: { sattel: 0.9 }, muster: "zellen" } },
                hoehenstufen: { hochgebirge: 2400 },
            },
        });
        const wirksam = mitTest(F19, werte);
        expect(wirksam.generator.continentalHeight).toBe(320);
        expect(wirksam.riverValley.flankGrade).toBe(0.05);
        expect(wirksam.gebirgsPresets!.typen.kammgebirge).toMatchObject({ werte: { sattel: 0.9 }, muster: "zellen" });
        expect(wirksam.gebirgsPresets!.hoehenstufen.hochgebirge).toBe(2400);
        expect(F19.generator.continentalHeight).not.toBe(320);
        // Der Weg ins Repository: der Stand als Datei (JSON mit Einzug), wieder geladen, trägt denselben Inhaltsfingerabdruck.
        const datei = parseTerrainRecipe(JSON.parse(`${JSON.stringify(wirksam, null, 4)}\n`));
        expect(recipeFingerprint(datei)).toBe(recipeFingerprint(wirksam));
        expect(recipeFingerprint(wirksam)).not.toBe(recipeFingerprint(F19));
    });

    it("weist Unfreigegebenes und Werte außerhalb der Grenzen ab", () => {
        expect(() => mitTest(F19, { regler: { geheim: 1 } })).toThrow(TestWerteFehler);
        expect(() => mitTest(F19, { regler: { iterations: 1.5 } })).toThrow(/ganze/);
        expect(() => mitTest(F19, { regler: { flankGrade: 2 } })).toThrow(/größer/);
        expect(() => mitTest(F19, { presets: { typen: { atlantis: { werte: { sattel: 1 } } } } })).toThrow(
            /Gebirgstyp/,
        );
        // Preset-Werte in den Grenzen des Gebirge-Reiters (das Schema der Datei prüft nur „Zahl“).
        expect(() => mitTest(F19, { presets: { typen: { karst: { werte: { sattel: 0.2 } } } } })).toThrow(/kleiner/);
        expect(() => mitTest(F19, { presets: { typen: { karst: { werte: { hypsometrie: 0.8 } } } } })).toThrow(
            /größer/,
        );
        expect(() => mitTest(F19, { presets: { typen: { karst: { werte: { stufen: 2.5 } } } } })).toThrow(/ganze/);
        expect(
            mitTest(F19, { presets: { typen: { karst: { werte: { koernung: 100 } } } } }).gebirgsPresets?.typen.karst
                .werte.koernung,
        ).toBe(100);
        expect(() => mitTest(F18, { presets: { hoehenstufen: { hochgebirge: 2000 } } })).toThrow(
            /keine Gebirgs-Presets/,
        );
    });

    it("🔴 Typwerte des Rückennetzes: stellbar, bereinigt, begrenzt, und nie im Fingerabdruck der Fassung (WI-0246)", () => {
        // 19 führt sie; ohne sie wäre der Fingerabdruck derselbe (kein Lauf ohne Wirkung, wenn sie hinzukamen).
        expect(F19.gebirgsPresets!.typen.schild.rueckennetz).toBeDefined();
        const ohne = structuredClone(F19);
        for (const preset of Object.values(ohne.gebirgsPresets!.typen)) delete preset.rueckennetz;
        expect(recipeFingerprint(ohne)).toBe(recipeFingerprint(F19));
        const werte = { presets: { typen: { schild: { rueckennetz: { "form.grat": 0.2, "struktur.welle": 20 } } } } };
        const mit = mitTest(F19, werte);
        expect(mit.gebirgsPresets!.typen.schild.rueckennetz!.form.grat).toBe(0.2);
        expect(recipeFingerprint(mit)).toBe(recipeFingerprint(F19));
        // Gleich der Datei fällt weg (Welle 20 ist der Wert des Schilds).
        expect(bereinigt(F19, werte)).toEqual({
            presets: { typen: { schild: { rueckennetz: { "form.grat": 0.2 } } } },
        });
        expect(() => mitTest(F19, { presets: { typen: { schild: { rueckennetz: { "form.grat": 0.5 } } } } })).toThrow(
            TestWerteFehler,
        );
        expect(() =>
            mitTest(F19, { presets: { typen: { schild: { rueckennetz: { "struktur.abstand": 3 } } } } }),
        ).toThrow(TestWerteFehler);
    });

    it("🔴 alle übrigen Werte je Pfad: wirken, fallen gleich der Datei weg, Regler und Technik nur über ihren Weg", () => {
        const werte = {
            rezept: { "generator.detail.wavelength": 5, "vegetation.wald.runoff": 0.6, "generator.timeStep": 1 },
        };
        const mit = mitTest(F19, werte);
        expect(mit.generator.detail.wavelength).toBe(5);
        expect(mit.vegetation["wald"]!.runoff).toBe(0.6);
        expect(recipeFingerprint(mit)).not.toBe(recipeFingerprint(F19));
        // Zeitschritt 1 ist der Wert der Datei.
        expect(bereinigt(F19, werte)).toEqual({
            rezept: { "generator.detail.wavelength": 5, "vegetation.wald.runoff": 0.6 },
        });
        for (const falsch of [
            { "generator.seed": 1 },
            { "generator.size": 2048 },
            { "generator.streamPowerK": 0.1 },
            { "generator.detail.octaves": 2.5 },
            { "generator.lakes.bedQuantile": 2 },
            { "vegetation.wald.landform.minimum": 10 },
        ])
            expect(() => mitTest(F19, { rezept: falsch })).toThrow(TestWerteFehler);
    });

    it("„Wirksam“ nennt die Revision, mit der der Master gerechnet ist; ein fremder Stand ergibt keine", () => {
        const zwei = { regler: { continentalHeight: 330 } };
        const verlauf = [
            { revision: 2, werte: zwei },
            { revision: 1, werte: { regler: { continentalHeight: 320 } } },
        ];
        const stand = (r: Parameters<typeof recipeFingerprint>[0]) => ({ version: 19, stand: recipeFingerprint(r) });
        expect(gerechnetMit(F19, stand(F19), verlauf)).toBe(0);
        expect(gerechnetMit(F19, stand(mitTest(F19, zwei)), verlauf)).toBe(2);
        expect(gerechnetMit(F19, stand(mitTest(F19, { regler: { continentalHeight: 999 } })), verlauf)).toBeNull();
        expect(gerechnetMit(F19, { version: 18, stand: recipeFingerprint(F19) }, verlauf)).toBeNull();
        expect(gerechnetMit(F19, { version: 19, stand: null }, verlauf)).toBeNull();
    });

    it("🔴 auf Production (Profil abgenommen) gilt allein die Datei", async () => {
        const db = {} as never;
        expect(await mitTestWerten(db, AVENTURIA.mapDomain, F19, "abgenommen")).toBe(F19);
        // Eine abgenommene Fassung trägt nie Testwerte (18 steht unter accepted): kein Lesen der Datenbank.
        expect(await mitTestWerten(db, AVENTURIA.mapDomain, F18, "voll")).toBe(F18);
        expect(offeneFassung()?.version).toBe(19);
    });
});

describeWithCluster("„19 (Test)“ mit den Rechten der App (Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    const domain = AVENTURIA.mapDomain;
    const actor = { personId: null, label: "Testprobe", actorRef: PERSON };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [grants]);
        await seedMapDomains(cluster.migrator);
    }, 240_000);
    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    const ketten = async () =>
        (await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM job WHERE kind = 'terrain_full'`)[0]!.n;
    const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string };
        }
    };

    it("🔴 setzen unter gewählter 18: gespeichert mit Verlauf, keine Rechnung; das Rezept von 18 bleibt die Datei", async () => {
        const app = cluster!.app;
        const vorher = await ketten();
        const gesetzt = await app.begin((tx) =>
            setzeTestWerte(tx, {
                domain,
                werte: { regler: { continentalHeight: 320 } },
                baseRevision: 0,
                reason: "Probe",
                actor,
                profil: "voll",
            }),
        );
        expect(gesetzt).toEqual({ version: 19, revision: 1, job: null });
        expect(await ketten()).toBe(vorher);
        expect(await resolveTerrainRecipe(app, domain)).toBe(F18);
        const [ereignis] = await cluster!.admin<{ vorher: unknown; nachher: unknown }[]>`
            SELECT vorher, nachher FROM terrain_recipe_test_event WHERE version = 19 ORDER BY id DESC LIMIT 1
        `;
        expect(ereignis).toEqual({ vorher: {}, nachher: { regler: { continentalHeight: 320 } } });
        // Alte Revision: Konflikt.
        expect(
            await fehler(
                app.begin((tx) =>
                    setzeTestWerte(tx, { domain, werte: {}, baseRevision: 0, reason: "alt", actor, profil: "voll" }),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        // Production: gar nicht.
        expect(
            await fehler(
                app.begin((tx) =>
                    setzeTestWerte(tx, {
                        domain,
                        werte: {},
                        baseRevision: 1,
                        reason: "x",
                        actor,
                        profil: "abgenommen",
                    }),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "terrain_test_unavailable" });
    });

    it("🔴 unter gewählter 19 wirken die Werte überall und jedes Setzen reiht die volle Kette ein; der Stand ist die wirksame Fassung", async () => {
        const app = cluster!.app;
        await cluster!.admin`
            INSERT INTO terrain_recipe_choice (map_domain_id, version, previous_version) VALUES (${domain}, 19, 18)
            ON CONFLICT (map_domain_id) DO UPDATE SET version = 19, previous_version = 18
        `;
        const wirksam = await resolveTerrainRecipe(app, domain);
        expect(wirksam.version).toBe(19);
        expect(wirksam.generator.continentalHeight).toBe(320);
        const vorher = await ketten();
        const gesetzt = await app.begin((tx) =>
            setzeTestWerte(tx, {
                domain,
                werte: { regler: { continentalHeight: 330 } },
                baseRevision: 1,
                reason: "höher",
                actor,
                profil: "voll",
            }),
        );
        expect(gesetzt.job).not.toBeNull();
        expect(await ketten()).toBe(vorher + 1);
        const stand = await testStand(app, domain, "voll");
        expect(stand!.generator.continentalHeight).toBe(330);
        expect(recipeFingerprint(stand!)).toBe(recipeFingerprint(await resolveTerrainRecipe(app, domain)));
        // Alles auf die Datei zurück: wieder genau die Datei (gleicher Fingerabdruck).
        await app.begin((tx) =>
            setzeTestWerte(tx, { domain, werte: {}, baseRevision: 2, reason: "zurück", actor, profil: "voll" }),
        );
        expect(recipeFingerprint(await resolveTerrainRecipe(app, domain))).toBe(recipeFingerprint(F19));
        const modell = await readHoehenmodell(app, domain, "voll");
        expect(modell.test).toMatchObject({
            version: 19,
            name: "Fassung 19 (Test)",
            revision: 3,
            gesperrt: false,
            werte: {},
            // Im Wegwerf-Cluster liegt kein Master: keine gerechnete Revision.
            gerechnet: null,
        });
        expect(modell.test!.verlauf.map((e) => e.revision)).toEqual([3, 2, 1]);
        // Je Eintrag davor und danach: so zeigt die Oberfläche alt → neu und nimmt eine Revision zurück.
        expect(modell.test!.verlauf[0]).toMatchObject({ vorher: { regler: { continentalHeight: 330 } }, werte: {} });
    });

    it("🔴 Typwerte des Rückennetzes: ohne Gebirge mit Kamm dieses Typs keine Rechnung, mit einem die volle Kette (WI-0246)", async () => {
        const app = cluster!.app;
        const vorher = await ketten();
        const ohneKamm = await app.begin((tx) =>
            setzeTestWerte(tx, {
                domain,
                werte: { presets: { typen: { schild: { rueckennetz: { "form.grat": 0.2 } } } } },
                baseRevision: 3,
                reason: "Grat am Schild",
                actor,
                profil: "voll",
            }),
        );
        expect(ohneKamm.job).toBeNull();
        expect(await ketten()).toBe(vorher);
        // Das wirksame Rezept trägt den Wert, sein Fingerabdruck bleibt der der Datei: Kein Master wird ungültig.
        const wirksam = await resolveTerrainRecipe(app, domain);
        expect(wirksam.gebirgsPresets!.typen.schild.rueckennetz!.form.grat).toBe(0.2);
        expect(recipeFingerprint(wirksam)).toBe(recipeFingerprint(F19));
        // Ein Schild mit gezeichnetem Kamm: jetzt wirkt die Änderung.
        const [region] = await cluster!.admin<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES ('00000000-0000-4000-8000-0000000246c1', ${domain}, 'Probe Schild', 'topographie', 'gebirge', true)
            RETURNING id::text
        `;
        const [flaeche] = await cluster!.admin<{ id: string }[]>`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES ('00000000-0000-4000-8000-0000000246c2', ${domain}, ${Number(region!.id)}, ST_MakeEnvelope(500, 500, 512, 508, 0), true)
            RETURNING id::text
        `;
        await cluster!.admin`
            INSERT INTO terrain_control (area_id, map_domain_id, source_system, gebirgstyp)
            VALUES (${Number(flaeche!.id)}, ${domain}, 'avesmaps3d', 'schild')
        `;
        await cluster!.admin`
            INSERT INTO terrain_ridge_edge (area_id, map_domain_id, ordinal, rang, geom)
            VALUES (${Number(flaeche!.id)}, ${domain}, 0, 'haupt', ST_GeomFromText('LINESTRING(502 504, 510 504)', 0))
        `;
        const mitKamm = await app.begin((tx) =>
            setzeTestWerte(tx, {
                domain,
                werte: { presets: { typen: { schild: { rueckennetz: { "form.grat": 0.25 } } } } },
                baseRevision: 4,
                reason: "noch mehr Grat",
                actor,
                profil: "voll",
            }),
        );
        // Eingereiht (ein wartender Lauf aus dem Fall davor nimmt es mit; dann bleibt die Zahl der Ketten).
        expect(mitKamm.job).not.toBeNull();
        // Ein anderer Typ ohne Kamm bleibt ohne Rechnung.
        const andererTyp = await app.begin((tx) =>
            setzeTestWerte(tx, {
                domain,
                werte: {
                    presets: {
                        typen: {
                            schild: { rueckennetz: { "form.grat": 0.25 } },
                            karst: { rueckennetz: { "struktur.welle": 9 } },
                        },
                    },
                },
                baseRevision: 5,
                reason: "Karst",
                actor,
                profil: "voll",
            }),
        );
        expect(andererTyp.job).toBeNull();
        await cluster!.admin`DELETE FROM terrain_ridge_edge WHERE area_id = ${Number(flaeche!.id)}`;
        await cluster!.admin`
            INSERT INTO terrain_hollow_point (area_id, map_domain_id, ordinal, geom)
            VALUES (${Number(flaeche!.id)}, ${domain}, 0, ST_GeomFromText('POINT(506 504)', 0))
        `;
        const nurMulde = await app.begin((tx) =>
            setzeTestWerte(tx, {
                domain,
                werte: { presets: { typen: { schild: { rueckennetz: { "form.grat": 0.3 } } } } },
                baseRevision: 6,
                reason: "Schild mit Mulde",
                actor,
                profil: "voll",
            }),
        );
        expect(nurMulde.job).not.toBeNull();
        await app.begin((tx) =>
            setzeTestWerte(tx, { domain, werte: {}, baseRevision: 7, reason: "zurück", actor, profil: "voll" }),
        );
    });

    it("🔴 nach der Abnahme stehen die Werte fest; die App darf Werte nicht löschen und den Verlauf nicht ändern", async () => {
        const app = cluster!.app;
        await app.begin(async (tx) => {
            await nimmAb(tx, { domain, version: 19, reason: "gut", actor });
            await sperreTest(tx, domain, 19);
        });
        expect(
            await fehler(
                app.begin((tx) =>
                    setzeTestWerte(tx, {
                        domain,
                        werte: { regler: { continentalHeight: 340 } },
                        baseRevision: 3,
                        reason: "zu spät",
                        actor,
                        profil: "voll",
                    }),
                ),
            ),
        ).toMatchObject({ statusCode: 409, code: "terrain_test_closed" });
        expect((await readHoehenmodell(app, domain, "voll")).test?.gesperrt).toBe(true);
        expect(
            await cluster!.codesAs(app, [
                "DELETE FROM terrain_recipe_test",
                "UPDATE terrain_recipe_test_event SET grund = 'x'",
                "DELETE FROM terrain_recipe_test_event",
            ]),
        ).toEqual(["42501", "42501", "42501"]);
    });
});
